"""LAZ/LAS/COPC → rejillas de terreno para la vista «Terreno» de Mapa LiDAR.

Genera, por bloque, dos modelos de altura en una rejilla regular:

  MDT  modelo digital del terreno: media de los puntos de suelo (clase 2) y agua (9)
  MDS  modelo digital de superficie: máximo de todos los puntos salvo ruido (7, 18)

Las celdas sin puntos (bajo edificios, huecos) se rellenan por interpolación
multirresolución (pirámide + suavizado), sin SciPy.

Salida (junto al nombre base indicado):
  <base>.terreno.json   metadatos (origen, resolución, tamaño, rangos de altura)
  <base>.mdt.bin        Float32 little-endian, fila 0 = sur, columna 0 = oeste, NaN = sin datos
  <base>.mds.bin        idem

Uso:
  python lidar2mdt.py ENTRADA.laz [ENTRADA2.laz ...] --salida data/zonas/<zona> [--res 1.0]
  python lidar2mdt.py T1.laz T2.laz ... --salida D --nombre H30_X498_Y4798 \
         --extension 498000 4798000 500000 4800000 --huso 30      (varias teselas → un bloque)

El nombre base es el de la entrada sin .copc.laz / .laz / .las. Lee por trozos,
así que la memoria depende de la rejilla (≈ 50 MB para 2×2 km a 1 m), no de los puntos.

Requisitos: pip install "laspy[lazrs]" numpy
"""
import argparse
import json
import os
import re
import sys
import time

import laspy
import numpy as np

# En Windows la salida redirigida usa cp1252: se fuerza UTF-8 para que ningún
# carácter del texto (acentos, flechas) haga fallar el proceso al final.
for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

CLASES_SUELO = (2, 9)
CLASES_RUIDO = (7, 18)


def nombre_base(ruta):
    b = os.path.basename(ruta)
    return re.sub(r"(\.copc)?\.la[sz]$", "", b, flags=re.I)


def rellenar(z, valido, iter_suavizado=6):
    """Rellena celdas no válidas con una pirámide de medias y suavizado local."""
    if valido.all():
        return z
    if not valido.any():
        return np.full_like(z, np.nan)
    h, w = z.shape
    if h == 1 and w == 1:
        return z
    # Nivel grueso: media de los válidos en bloques 2×2.
    hp, wp = h + (h & 1), w + (w & 1)
    zs = np.zeros((hp, wp), np.float64)
    vs = np.zeros((hp, wp), np.float64)
    zs[:h, :w] = np.where(valido, z, 0)
    vs[:h, :w] = valido
    suma = zs.reshape(hp // 2, 2, wp // 2, 2).sum(axis=(1, 3))
    cuenta = vs.reshape(hp // 2, 2, wp // 2, 2).sum(axis=(1, 3))
    grueso = np.where(cuenta > 0, suma / np.maximum(cuenta, 1), 0)
    grueso = rellenar(grueso, cuenta > 0, iter_suavizado)
    # Subir de nivel con interpolación bilineal (centros de celda).
    yy = (np.arange(h) + 0.5) / 2 - 0.5
    xx = (np.arange(w) + 0.5) / 2 - 0.5
    gh, gw = grueso.shape
    y0 = np.clip(np.floor(yy).astype(int), 0, gh - 1)
    x0 = np.clip(np.floor(xx).astype(int), 0, gw - 1)
    y1 = np.minimum(y0 + 1, gh - 1)
    x1 = np.minimum(x0 + 1, gw - 1)
    ky = np.clip(yy - y0, 0, 1)[:, None]
    kx = np.clip(xx - x0, 0, 1)[None, :]
    arriba = grueso[y0][:, x0] * (1 - kx) + grueso[y0][:, x1] * kx
    abajo = grueso[y1][:, x0] * (1 - kx) + grueso[y1][:, x1] * kx
    fino = arriba * (1 - ky) + abajo * ky
    out = np.where(valido, z, fino)
    # Suavizado de Jacobi solo en los huecos para quitar escalones.
    hueco = ~valido
    for _ in range(iter_suavizado):
        p = np.pad(out, 1, mode="edge")
        media = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        out = np.where(hueco, media, out)
    return out


def quitar_picos(z, umbral=8.0):
    """Baja celdas aisladas que sobresalen más de `umbral` m sobre todos sus vecinos
    (pájaros, cables, ruido no clasificado)."""
    p = np.pad(z, 1, mode="edge")
    vecinos = np.stack([p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx]
                        for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
    tope = vecinos.max(axis=0)
    pico = z > tope + umbral
    return np.where(pico, tope, z), int(pico.sum())


def zona_sin_datos(valido, res, radio_m=20.0):
    """Celdas a más de ~radio_m de cualquier punto (mar, fuera del vuelo). Se
    guardan como NaN y el visor no las dibuja; los huecos pequeños (edificios)
    sí se rellenan."""
    k = max(1, int(round(radio_m / res)))
    h, w = valido.shape
    hp, wp = -(-h // k) * k, -(-w // k) * k
    v = np.zeros((hp, wp), bool)
    v[:h, :w] = valido
    grueso = v.reshape(hp // k, k, wp // k, k).any(axis=(1, 3))
    p = np.pad(grueso, 1)
    cerca = np.zeros_like(grueso)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            cerca |= p[dy:dy + grueso.shape[0], dx:dx + grueso.shape[1]]
    lejos = ~np.repeat(np.repeat(cerca, k, 0), k, 1)[:h, :w]
    return lejos


def procesar(rutas, salida, res, ajuste=10.0, base=None, extension=None, huso=None):
    """Genera un bloque de terreno a partir de uno o varios ficheros.

    Con `extension` = (x0, y0, x1, y1) la rejilla es fija y los puntos de fuera
    se descartan (sirve para unir varias teselas en un bloque de 2×2 km)."""
    if isinstance(rutas, str):
        rutas = [rutas]
    t0 = time.time()
    if extension is not None:
        x0, y0, x1, y1 = extension
    else:
        xmin = ymin = np.inf
        xmax = ymax = -np.inf
        for ruta in rutas:
            with laspy.open(ruta) as f:
                xmin, ymin = min(xmin, f.header.mins[0]), min(ymin, f.header.mins[1])
                xmax, ymax = max(xmax, f.header.maxs[0]), max(ymax, f.header.maxs[1])
        # Rejilla alineada a múltiplos de `ajuste` (y de la resolución) para que
        # bloques vecinos encajen sin huecos aunque el último metro no tenga puntos.
        paso = max(res, np.ceil(ajuste / res) * res) if ajuste > 0 else res
        x0 = np.floor(xmin / paso) * paso
        y0 = np.floor(ymin / paso) * paso
        x1 = np.ceil(xmax / paso - 1e-9) * paso
        y1 = np.ceil(ymax / paso - 1e-9) * paso
    ancho = max(1, int(round((x1 - x0) / res)))
    alto = max(1, int(round((y1 - y0) / res)))
    n = ancho * alto
    suma_t = np.zeros(n, np.float64)
    cuenta_t = np.zeros(n, np.int32)
    max_s = np.full(n, -np.inf, np.float64)
    total = 0
    for k, ruta in enumerate(rutas):
        print(f"PROGRESO {k}/{len(rutas)} {os.path.basename(ruta)}", flush=True)
        with laspy.open(ruta) as f:
            for trozo in f.chunk_iterator(2_000_000):
                x = np.asarray(trozo.x)
                y = np.asarray(trozo.y)
                z = np.asarray(trozo.z)
                c = np.asarray(trozo.classification)
                i = np.floor((x - x0) / res).astype(np.int64)
                j = np.floor((y - y0) / res).astype(np.int64)
                if extension is not None:
                    dentro = (i >= 0) & (i < ancho) & (j >= 0) & (j < alto)
                    i, j, z, c = i[dentro], j[dentro], z[dentro], c[dentro]
                else:
                    i = np.clip(i, 0, ancho - 1)
                    j = np.clip(j, 0, alto - 1)
                celda = j * ancho + i
                suelo = np.isin(c, CLASES_SUELO)
                suma_t += np.bincount(celda[suelo], weights=z[suelo], minlength=n)
                cuenta_t += np.bincount(celda[suelo], minlength=n).astype(np.int32)
                nr = ~np.isin(c, CLASES_RUIDO)
                np.maximum.at(max_s, celda[nr], z[nr])
                total += len(z)
    print(f"PROGRESO {len(rutas)}/{len(rutas)} rejilla", flush=True)
    if total == 0 or not np.isfinite(max_s).any():
        raise SystemExit("ERROR: ningún punto dentro de la extensión pedida")
    valido_t = cuenta_t > 0
    mdt = np.where(valido_t, suma_t / np.maximum(cuenta_t, 1), 0).reshape(alto, ancho)
    valido_t = valido_t.reshape(alto, ancho)
    mdt = rellenar(mdt, valido_t)
    valido_s = np.isfinite(max_s).reshape(alto, ancho)
    mds = np.where(valido_s, max_s.reshape(alto, ancho), 0)
    mds = rellenar(mds, valido_s)
    mds, picos = quitar_picos(mds)
    # El MDS nunca por debajo del terreno.
    mds = np.maximum(mds, mdt)
    lejos = zona_sin_datos(valido_s, res)
    mdt[lejos] = np.nan
    mds[lejos] = np.nan

    base = base or nombre_base(rutas[0])
    os.makedirs(salida, exist_ok=True)
    capas = {}
    for nombre, rej, valido in (("mdt", mdt, valido_t), ("mds", mds, valido_s)):
        fichero = f"{base}.{nombre}.bin"
        rej.astype("<f4").tofile(os.path.join(salida, fichero))
        capas[nombre] = {
            "fichero": fichero,
            "zMin": round(float(np.nanmin(rej)), 3),
            "zMax": round(float(np.nanmax(rej)), 3),
            "p02": round(float(np.nanpercentile(rej, 2)), 3),
            "p98": round(float(np.nanpercentile(rej, 98)), 3),
            "rellenoPct": round(100 * float((~valido & ~lejos).mean()), 2),
            "sinDatosPct": round(100 * float(lejos.mean()), 2),
        }
    meta = {
        "version": 1,
        "fuente": ", ".join(os.path.basename(r) for r in rutas[:20]) + (" …" if len(rutas) > 20 else ""),
        "huso": huso,
        "puntos": int(total),
        "origen": [float(x0), float(y0)],
        "resolucion": res,
        "ancho": ancho,
        "alto": alto,
        "orden": "Float32 LE, fila 0 = sur (y mínima), columna 0 = oeste (x mínima); valor en el centro de la celda; NaN = sin datos",
        "capas": capas,
    }
    with open(os.path.join(salida, f"{base}.terreno.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    print(
        f"{base}: {total:,} puntos -> {ancho}×{alto} celdas a {res} m "
        f"(MDT relleno {capas['mdt']['rellenoPct']} %, MDS {capas['mds']['rellenoPct']} %, {picos} picos quitados) "
        f"en {time.time() - t0:.1f} s",
        flush=True,
    )
    return meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entradas", nargs="+", help="ficheros LAZ/LAS/COPC")
    ap.add_argument("--salida", required=True, help="carpeta de la zona (data/zonas/<zona>)")
    ap.add_argument("--res", type=float, default=1.0, help="tamaño de celda en metros (defecto 1)")
    ap.add_argument("--ajuste", type=float, default=10.0,
                    help="alinea los bordes de la rejilla a múltiplos de estos metros (defecto 10; 0 = no)")
    ap.add_argument("--nombre", help="une todas las entradas en un solo bloque con este nombre base")
    ap.add_argument("--extension", type=float, nargs=4, metavar=("X0", "Y0", "X1", "Y1"),
                    help="rejilla fija en metros UTM; descarta los puntos de fuera")
    ap.add_argument("--huso", type=int, help="huso UTM (se guarda en el .terreno.json)")
    a = ap.parse_args()
    if a.res <= 0:
        sys.exit("--res debe ser positivo")
    if a.nombre:
        # Todas las entradas → un solo bloque.
        procesar(a.entradas, a.salida, a.res, a.ajuste, a.nombre, a.extension, a.huso)
    else:
        for ruta in a.entradas:
            procesar(ruta, a.salida, a.res, a.ajuste, None, a.extension, a.huso)


if __name__ == "__main__":
    main()
