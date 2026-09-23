/**
 * Trazado de un canal por gravedad (acueducto) sobre un modelo del terreno.
 *
 * Desde un punto de partida (manantial) el canal avanza a paso fijo y baja
 * siempre la misma pendiente (m/km). En cada paso elige, entre varias
 * direcciones, aquella en la que el terreno queda más cerca de la cota del
 * canal: así se ciñe a la ladera, como una curva de nivel que va bajando poco a
 * poco. Donde ninguna dirección lo consigue, el canal sigue a su cota y el tramo
 * se marca como obra: «puente» si el terreno queda por debajo (arquería,
 * terraplén) y «zanja» si queda por encima (trinchera, túnel).
 *
 * Todo en metros, en coordenadas planas (UTM). No depende de three.js.
 */

/**
 * Muestreador de alturas sobre varios bloques de rejilla regular.
 * Cada bloque: { x0, y0, res, ancho, alto, datos } — fila 0 = sur, columna 0 =
 * oeste, valor en el centro de cada celda, NaN = sin datos.
 * Devuelve alt(x, y) con interpolación bilineal (NaN fuera de los datos).
 */
export function crearMuestreador(bloques) {
  const lista = bloques.filter((b) => b && b.datos);
  let ultimo = null;
  const buscar = (x, y) => {
    if (ultimo && x >= ultimo.x0 && y >= ultimo.y0 && x < ultimo.x0 + ultimo.ancho * ultimo.res && y < ultimo.y0 + ultimo.alto * ultimo.res) {
      return ultimo;
    }
    for (const b of lista) {
      if (x >= b.x0 && y >= b.y0 && x < b.x0 + b.ancho * b.res && y < b.y0 + b.alto * b.res) {
        ultimo = b;
        return b;
      }
    }
    return null;
  };
  return function alt(x, y) {
    const b = buscar(x, y);
    if (!b) return NaN;
    const fx = Math.min(b.ancho - 1, Math.max(0, (x - b.x0) / b.res - 0.5));
    const fy = Math.min(b.alto - 1, Math.max(0, (y - b.y0) / b.res - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const i1 = Math.min(i + 1, b.ancho - 1);
    const j1 = Math.min(j + 1, b.alto - 1);
    const kx = fx - i;
    const ky = fy - j;
    const d = b.datos;
    const a = d[j * b.ancho + i];
    const c = d[j * b.ancho + i1];
    const e = d[j1 * b.ancho + i];
    const f = d[j1 * b.ancho + i1];
    // Celdas sin datos: NaN o el valor de relleno de las texturas (−10000).
    if (!(a > -500 && c > -500 && e > -500 && f > -500)) return NaN;
    return (a * (1 - kx) + c * kx) * (1 - ky) + (e * (1 - kx) + f * kx) * ky;
  };
}

/** Dirección de máxima subida (radianes, 0 = este) medida a `h` metros. */
export function direccionPendiente(alt, x, y, h = 5) {
  const gx = alt(x + h, y) - alt(x - h, y);
  const gy = alt(x, y + h) - alt(x, y - h);
  if (!(Number.isFinite(gx) && Number.isFinite(gy)) || (gx === 0 && gy === 0)) return null;
  return Math.atan2(gy, gx);
}

const RUMBOS = ['E', 'NE', 'N', 'NO', 'O', 'SO', 'S', 'SE'];
/** Rumbo aproximado (E, NE, N…) de un ángulo en radianes con 0 = este. */
export function rumbo(ang) {
  const i = Math.round(((ang % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 4)) % 8;
  return RUMBOS[i];
}

/**
 * Traza una rama del canal.
 * @param alt función de altura alt(x, y)
 * @param o opciones:
 *   x, y        punto de partida (m)
 *   rumbo0      dirección inicial (rad, 0 = este)
 *   pendiente   m por km (> 0)
 *   paso        longitud de cada paso (m)
 *   maxLong     longitud máxima (m)
 *   tolerancia  desnivel terreno−canal (m) a partir del cual el tramo es obra
 *   giroMax     giro máximo por paso (grados)
 *   maxObra     longitud seguida de obra (m) tras la que se abandona la rama
 * @returns { puntos: [{x, y, d, zc, zt, tipo}], fin, ... }
 *   zc = cota del canal, zt = terreno, tipo = 'ladera' | 'puente' | 'zanja'
 */
export function trazarRama(alt, o) {
  const paso = o.paso ?? 2;
  const s = (o.pendiente ?? 0.5) / 1000;
  const maxLong = o.maxLong ?? 10000;
  const tol = o.tolerancia ?? 2;
  const giroMax = ((o.giroMax ?? 75) * Math.PI) / 180;
  // Giros candidatos: finos cerca de 0° (para ir corrigiendo poco a poco en
  // laderas suaves) y más gruesos hacia el máximo (vaguadas y espolones).
  const nGiros = 30;
  const giros = [0];
  for (let k = 1; k <= nGiros; k += 1) {
    const g = giroMax * (k / nGiros) ** 2;
    giros.push(g, -g);
  }
  const pesoGiro = o.pesoGiro ?? 0.001; // m de desnivel equivalentes por grado girado
  const maxObra = o.maxObra ?? 400;

  let x = o.x;
  let y = o.y;
  const z0 = o.z0 ?? alt(x, y);
  if (!Number.isFinite(z0)) return { puntos: [], fin: 'sin-datos' };
  let zc = z0;
  let rumboAct = o.rumbo0;
  let d = 0;
  let obraSeguida = 0;
  const puntos = [{ x, y, d, zc, zt: z0, tipo: 'ladera' }];

  // Para no volver sobre el propio trazado: rejilla de celdas con los índices de
  // los puntos. Solo cuentan los puntos de más de `edadMin` pasos atrás, así se
  // permiten las horquillas cerradas al rodear una vaguada.
  const radio = paso * 1.4;
  const edadMin = Math.ceil(30 / paso);
  const celda = radio;
  const ocupadas = new Map();
  const marcar = (px, py, idx) => {
    const k = `${Math.floor(px / celda)},${Math.floor(py / celda)}`;
    const l = ocupadas.get(k);
    if (l) l.push(idx);
    else ocupadas.set(k, [idx]);
  };
  const cerca = (px, py, idx) => {
    const cx = Math.floor(px / celda);
    const cy = Math.floor(py / celda);
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        const l = ocupadas.get(`${cx + a},${cy + b}`);
        if (!l) continue;
        for (const k of l) {
          if (idx - k <= edadMin) continue;
          const q = puntos[k];
          if (Math.hypot(q.x - px, q.y - py) < radio) return true;
        }
      }
    }
    return false;
  };
  marcar(x, y, 0);

  let fin = 'longitud';
  while (d < maxLong) {
    const objetivo = zc - s * paso;
    let mejor = null;
    for (const g of giros) {
      const r = rumboAct + g;
      const nx = x + paso * Math.cos(r);
      const ny = y + paso * Math.sin(r);
      const zt = alt(nx, ny);
      if (!Number.isFinite(zt)) continue;
      let coste = Math.abs(zt - objetivo) + pesoGiro * Math.abs((g * 180) / Math.PI);
      if (cerca(nx, ny, puntos.length)) coste += 1e3;
      if (!mejor || coste < mejor.coste) mejor = { coste, nx, ny, zt, r };
    }
    if (!mejor) {
      fin = 'limite';
      break;
    }
    if (mejor.coste >= 1e3) {
      fin = 'bucle';
      break;
    }
    x = mejor.nx;
    y = mejor.ny;
    rumboAct = mejor.r;
    d += paso;
    zc = objetivo;
    const dz = mejor.zt - zc;
    const tipo = dz > tol ? 'zanja' : dz < -tol ? 'puente' : 'ladera';
    puntos.push({ x, y, d, zc, zt: mejor.zt, tipo });
    marcar(x, y, puntos.length - 1);
    obraSeguida = tipo === 'ladera' ? 0 : obraSeguida + paso;
    if (obraSeguida >= maxObra) {
      fin = 'obra';
      break;
    }
  }
  return { puntos, fin, ...resumenRama(puntos, paso) };
}

/** Longitudes y cotas de una rama. */
export function resumenRama(puntos, paso) {
  const n = puntos.length;
  if (!n) return { longitud: 0, caida: 0, puente: 0, zanja: 0 };
  let puente = 0;
  let zanja = 0;
  let maxPuente = 0;
  let maxZanja = 0;
  for (let i = 1; i < n; i += 1) {
    const p = puntos[i];
    const dz = p.zt - p.zc;
    if (p.tipo === 'puente') puente += paso;
    if (p.tipo === 'zanja') zanja += paso;
    maxPuente = Math.max(maxPuente, -dz);
    maxZanja = Math.max(maxZanja, dz);
  }
  const a = puntos[0];
  const b = puntos[n - 1];
  return {
    longitud: b.d,
    caida: a.zc - b.zc,
    zInicio: a.zc,
    zFin: b.zc,
    puente,
    zanja,
    maxPuente,
    maxZanja,
    rumboGeneral: n > 1 ? rumbo(Math.atan2(b.y - a.y, b.x - a.x)) : null,
  };
}

/**
 * Traza el canal hacia los dos lados de la ladera desde el manantial
 * (perpendicular a la máxima pendiente). Devuelve { z0, ramas: [rama, rama] }
 * o null si el punto está fuera de los datos o en terreno llano.
 */
export function trazarCanal(alt, o) {
  const z0 = alt(o.x, o.y);
  if (!Number.isFinite(z0)) return null;
  const sube = direccionPendiente(alt, o.x, o.y, o.radioPendiente ?? 5);
  if (sube === null) return null;
  const ramas = [1, -1].map((lado) => trazarRama(alt, { ...o, z0, rumbo0: sube + (lado * Math.PI) / 2 }));
  return { z0, ramas };
}
