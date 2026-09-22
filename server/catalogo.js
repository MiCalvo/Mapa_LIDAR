/**
 * Catálogo de bloques de 2×2 km para el mapa de selección.
 *
 * Un bloque se identifica por huso UTM y esquina inferior izquierda en km
 * (x, y pares). Para cada bloque se combina:
 *   - lo que hay en el PC: terreno ya generado (data/zonas/**.terreno.json) y
 *     LAZ/LAS descargados sin procesar (data/entrada/**),
 *   - lo que se puede descargar: lista de URLs del PNOA de Castilla y León y
 *     listado de teselas de 500 m de geoEuskadi 2017.
 *
 * Los catálogos se descargan una vez y se guardan en data/catalogos/.
 */
import fs from 'node:fs';
import path from 'node:path';

export const BLOQUE_KM = 2;
export const CELDA_KM = 10;

export const FUENTES = {
  cyl: {
    id: 'cyl',
    nombre: 'PNOA-LiDAR Castilla y León (2017–2021)',
    lista: 'https://ss3.scayle.es/lidarcyl/LidarPNOA2_CyL_URLs_20260205.txt',
    web: 'https://open.scayle.es/dataset/lidar-pnoa',
    licencia: 'CC BY 4.0',
    carpetaEntrada: 'pnoa_cyl',
    zona: 'pnoa-cyl',
    res: 1,
  },
  eus: {
    id: 'eus',
    nombre: 'geoEuskadi LiDAR 2017',
    lista: 'https://www.geo.euskadi.eus/lidar/DatosDescarga/LIDAR/LIDAR_2017_ETRS89/',
    web: 'https://www.geo.euskadi.eus/lidar/DatosDescarga/LIDAR/',
    licencia: 'por confirmar',
    carpetaEntrada: 'geoeuskadi_2017',
    zona: 'geoeuskadi-2017',
    res: 2, // densidad baja (≈2–5 pts/m²): a 1 m quedan demasiados huecos
  },
};

export const CNIG = 'https://centrodedescargas.cnig.es/CentroDescargas/lidar-tercera-cobertura';

export const clave = (huso, x, y) => `${huso}_${x}_${y}`;
export const bloqueDe = (m) => Math.floor(m / (BLOQUE_KM * 1000)) * BLOQUE_KM; // metros → km del bloque
export const nombreBloque = (huso, x, y) => `H${huso}_X${x}_Y${y}`;

// ---------------------------------------------------------------------------
// Catálogo de Castilla y León
// ---------------------------------------------------------------------------

/** Regiones cuyos enlaces respondían (HEAD 200) al comprobarlo el 18-sep-2026. */
const REGIONES_OK = new Set(['ne', 'se', 'sw']);

/**
 * Interpreta la lista de URLs del PNOA2 de CyL. Los nombres dan la esquina
 * SUPERIOR izquierda en km: PNOA-2021-CYL-NE-406-4716 cubre x 406–408, y 4714–4716.
 */
export function parsearCyl(texto) {
  const bloques = new Map();
  for (const linea of String(texto).split(/\r?\n/)) {
    const m = /lazfiles\/(\w+)\/PNOA[_-](\d{4})[_-]CYL[_-]\w+[_-](\d+)-(\d+)/.exec(linea);
    if (!m) continue;
    const region = m[1].toLowerCase();
    const anio = Number(m[2]);
    const X = Number(m[3]);
    const Y = Number(m[4]);
    // La región NW mezcla husos: las X altas (> 560 km) son del huso 29.
    const huso = region === 'nw' && X >= 560 ? 29 : 30;
    let url = linea.trim();
    if (!/\.laz$/i.test(url)) url += '.laz';
    const k = clave(huso, X, Y - BLOQUE_KM);
    const lista = bloques.get(k) || [];
    lista.push({ url, anio, region, fichero: url.split('/').pop() });
    bloques.set(k, lista);
  }
  for (const lista of bloques.values()) {
    lista.sort(
      (a, b) =>
        Number(REGIONES_OK.has(b.region)) - Number(REGIONES_OK.has(a.region)) || b.anio - a.anio,
    );
  }
  return bloques;
}

// ---------------------------------------------------------------------------
// Catálogo de geoEuskadi 2017 (teselas de 500 m, nombre = esquina inferior izquierda en hm)
// ---------------------------------------------------------------------------

export function enlacesDeListado(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/href="([^"]+)"/gi)) {
    try {
      out.push(new URL(m[1], base).href);
    } catch {
      /* enlace raro: se ignora */
    }
  }
  return out;
}

export function parsearTeselasEus(urls) {
  const bloques = new Map();
  for (const url of urls) {
    const m = /\/(\d{4})-(\d{5})\.laz$/i.exec(url);
    if (!m) continue;
    const x = Number(m[1]) * 100;
    const y = Number(m[2]) * 100;
    const k = clave(30, bloqueDe(x), bloqueDe(y));
    const lista = bloques.get(k) || [];
    lista.push({ url, x, y, fichero: url.split('/').pop() });
    bloques.set(k, lista);
  }
  return bloques;
}

// ---------------------------------------------------------------------------
// Cabecera LAS (sin descomprimir): extensión y número de puntos
// ---------------------------------------------------------------------------

export function leerCabeceraLas(fichero) {
  const fd = fs.openSync(fichero, 'r');
  try {
    const b = Buffer.alloc(375);
    const leidos = fs.readSync(fd, b, 0, b.length, 0);
    if (leidos < 227 || b.toString('ascii', 0, 4) !== 'LASF') return null;
    const menor = b.readUInt8(25);
    let puntos = b.readUInt32LE(107);
    if (menor >= 4 && leidos >= 255) {
      const p64 = Number(b.readBigUInt64LE(247));
      if (p64 > 0) puntos = p64;
    }
    return {
      version: `${b.readUInt8(24)}.${menor}`,
      puntos,
      xmax: b.readDoubleLE(179),
      xmin: b.readDoubleLE(187),
      ymax: b.readDoubleLE(195),
      ymin: b.readDoubleLE(203),
    };
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Índice de lo que hay en el PC
// ---------------------------------------------------------------------------

function husoDeCrs(crs) {
  const m = /258(29|30|31)|UTM\s*(29|30|31)|huso\s*(29|30|31)/i.exec(String(crs || ''));
  return m ? Number(m[1] || m[2] || m[3]) : null;
}

function leerJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function recorrer(dir, filtro, salida = [], profundidad = Infinity) {
  let entradas = [];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return salida;
  }
  for (const e of entradas) {
    const r = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (profundidad > 0) recorrer(r, filtro, salida, profundidad - 1);
    } else if (filtro(e.name)) salida.push(r);

  }
  return salida;
}

const cacheCabeceras = new Map();

/**
 * Terrenos generados y LAZ sin procesar, con su extensión en metros UTM.
 * `extra`: otras carpetas donde buscar LAZ (p. ej. la carpeta de Descargas del
 * usuario, solo el primer nivel), para que lo bajado a mano desde el CNIG se
 * detecte sin moverlo.
 */
export function indiceLocal({ zonas, entrada, extra = [] }) {
  const terrenos = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(zonas, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    dirs = [];
  }
  for (const d of dirs) {
    const dir = path.join(zonas, d.name);
    const zonaMeta = leerJson(path.join(dir, 'zona.json')) || {};
    const husoZona = husoDeCrs(zonaMeta.crs) ?? zonaMeta.huso ?? 30;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.terreno.json')) continue;
      const m = leerJson(path.join(dir, f));
      if (!m?.origen) continue;
      const [x0, y0] = m.origen;
      terrenos.push({
        zona: d.name,
        bloque: f.replace(/\.terreno\.json$/, ''),
        huso: m.huso ?? husoZona,
        ext: [x0, y0, x0 + m.ancho * m.resolucion, y0 + m.alto * m.resolucion],
      });
    }
  }
  const entradas = [];
  const esLaz = (n) => /\.la[sz]$/i.test(n) && !/\.copc\.laz$/i.test(n);
  const origenes = [{ dir: entrada, etiqueta: '', profundidad: Infinity }, ...extra];
  for (const o of origenes) {
    for (const f of recorrer(o.dir, esLaz, [], o.profundidad ?? 1)) {
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      const k = `${f}|${st.size}|${st.mtimeMs}`;
      if (!cacheCabeceras.has(k)) {
        let cab = null;
        try {
          cab = leerCabeceraLas(f);
        } catch {
          cab = null;
        }
        cacheCabeceras.set(k, cab);
      }
      const cab = cacheCabeceras.get(k);
      if (!cab || !(cab.xmax > cab.xmin)) continue;
      const rel = path.relative(o.dir, f).split(path.sep).join('/');
      entradas.push({
        ruta: f,
        rel: o.etiqueta ? `${o.etiqueta}/${rel}` : rel,
        huso: /h29|hu29|huso.?29|_29n/i.test(f) ? 29 : /h31|hu31|huso.?31|_31n/i.test(f) ? 31 : 30,
        puntos: cab.puntos,
        ext: [cab.xmin, cab.ymin, cab.xmax, cab.ymax],
      });
    }
  }
  return { terrenos, entradas };
}

function interseccion(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Bloques de 2 km que toca una extensión (metros). */
function bloquesQueToca(ext) {
  const out = [];
  const paso = BLOQUE_KM * 1000;
  for (let x = Math.floor(ext[0] / paso) * paso; x < ext[2]; x += paso) {
    for (let y = Math.floor(ext[1] / paso) * paso; y < ext[3]; y += paso) {
      out.push([x / 1000, y / 1000]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estado por bloque
// ---------------------------------------------------------------------------

/**
 * Estado de cada bloque que aparece en algún sitio. Devuelve Map clave → info.
 *   listo       terreno generado cubre ≥ 95 % del bloque
 *   parcial     hay terreno, pero cubre menos
 *   descargado  hay LAZ en data/entrada que cubren el bloque, sin procesar
 *   disponible  se puede descargar de un catálogo
 *   sin-enlace  está en el catálogo pero el enlace no respondía al comprobarlo
 */
export function estados({ local, catalogos }) {
  const info = new Map();
  const obtener = (huso, x, y) => {
    const k = clave(huso, x, y);
    if (!info.has(k)) {
      info.set(k, { huso, x, y, terrenos: [], entradas: [], cobertura: 0, coberturaEntrada: 0, fuentes: [] });
    }
    return info.get(k);
  };
  const areaBloque = (BLOQUE_KM * 1000) ** 2;
  for (const t of local.terrenos) {
    for (const [x, y] of bloquesQueToca(t.ext)) {
      const ext = [x * 1000, y * 1000, (x + BLOQUE_KM) * 1000, (y + BLOQUE_KM) * 1000];
      const a = interseccion(ext, t.ext);
      if (a <= 0) continue;
      const b = obtener(t.huso, x, y);
      b.terrenos.push({ zona: t.zona, bloque: t.bloque, ext: t.ext });
      b.cobertura = Math.min(1, b.cobertura + a / areaBloque);
    }
  }
  for (const e of local.entradas) {
    for (const [x, y] of bloquesQueToca(e.ext)) {
      const ext = [x * 1000, y * 1000, (x + BLOQUE_KM) * 1000, (y + BLOQUE_KM) * 1000];
      const a = interseccion(ext, e.ext);
      if (a <= 0) continue;
      const b = obtener(e.huso, x, y);
      b.entradas.push(e.rel);
      (b.rutas ||= []).push(e.ruta);
      b.coberturaEntrada = Math.min(1, b.coberturaEntrada + a / areaBloque);
    }
  }
  for (const [fuente, mapa] of Object.entries(catalogos)) {
    if (!mapa) continue;
    for (const [k, lista] of mapa) {
      const [huso, x, y] = k.split('_').map(Number);
      const b = obtener(huso, x, y);
      const ok = fuente !== 'cyl' || lista.some((c) => REGIONES_OK.has(c.region));
      b.fuentes.push({ fuente, ficheros: lista.length, ok, anio: lista[0]?.anio ?? 2017 });
    }
  }
  for (const b of info.values()) {
    b.cobertura = Math.round(b.cobertura * 100) / 100;
    b.coberturaEntrada = Math.round(b.coberturaEntrada * 100) / 100;
    if (b.cobertura >= 0.95) b.estado = 'listo';
    else if (b.entradas.length && b.coberturaEntrada >= 0.5) b.estado = 'descargado';
    else if (b.fuentes.some((f) => f.ok)) b.estado = b.cobertura > 0 ? 'parcial' : 'disponible';
    else if (b.cobertura > 0) b.estado = 'parcial';
    else if (b.entradas.length) b.estado = 'descargado';
    else b.estado = 'sin-enlace';
  }
  return info;
}

/** Recuento por celda de 10 km: { huso, x, y, listo, parcial, descargado, disponible, sinEnlace }. */
export function resumen(info) {
  const celdas = new Map();
  for (const b of info.values()) {
    const cx = Math.floor(b.x / CELDA_KM) * CELDA_KM;
    const cy = Math.floor(b.y / CELDA_KM) * CELDA_KM;
    const k = clave(b.huso, cx, cy);
    const c =
      celdas.get(k) ||
      { huso: b.huso, x: cx, y: cy, listo: 0, parcial: 0, descargado: 0, disponible: 0, sinEnlace: 0 };
    if (b.estado === 'sin-enlace') c.sinEnlace += 1;
    else c[b.estado] += 1;
    celdas.set(k, c);
  }
  return [...celdas.values()];
}
