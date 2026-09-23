/**
 * Rutas de un canal por gravedad entre un manantial (A) y un destino (B).
 *
 * Es la misma idea que un navegador de mapas: el terreno se convierte en una
 * rejilla de nodos y se busca con A* el camino de menor coste. La diferencia es
 * el coste. El canal nunca sube y su pendiente está entre una mínima y una
 * máxima: en cada paso intenta ir a la altura del terreno, pero sin bajar menos
 * de la mínima ni más de la máxima. Cada metro cuesta 1 más un recargo
 * proporcional a la obra que exigiría:
 *   - puente/terraplén si el terreno queda por debajo del canal,
 *   - zanja/túnel si queda por encima,
 * siempre que la diferencia supere la tolerancia. Con recargos distintos se
 * obtienen opciones distintas (menos obra, equilibrada, más directa), y además
 * cada opción nueva penaliza pasar por donde ya pasan las anteriores, como hacen
 * los navegadores para proponer alternativas.
 *
 * Nota: la cota del canal depende del camino, así que A* no garantiza el óptimo
 * exacto; es una aproximación buena y rápida para explorar opciones.
 */

/** Rejilla regular de alturas en la región [x0, y0, x1, y1] con paso R. */
export function rejillaRegion(alt, x0, y0, x1, y1, R) {
  const nx = Math.max(2, Math.ceil((x1 - x0) / R) + 1);
  const ny = Math.max(2, Math.ceil((y1 - y0) / R) + 1);
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const y = y0 + j * R;
    for (let i = 0; i < nx; i += 1) z[j * nx + i] = alt(x0 + i * R, y);
  }
  return { x0, y0, R, nx, ny, z };
}

/** Región de búsqueda alrededor de A y B y paso de rejilla para ~maxNodos nodos. */
export function regionPara(a, b, { margen = 0.6, margenMin = 800, maxNodos = 1.6e6, pasoMin = 3 } = {}) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const m = Math.max(margenMin, dist * margen);
  const x0 = Math.min(a.x, b.x) - m;
  const y0 = Math.min(a.y, b.y) - m;
  const x1 = Math.max(a.x, b.x) + m;
  const y1 = Math.max(a.y, b.y) + m;
  const R = Math.max(pasoMin, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / maxNodos)));
  return { x0, y0, x1, y1, R };
}

// Vecinos: 16 direcciones (8 + saltos de caballo) para no forzar zigzags a 45°.
const VECINOS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];

/** Montículo binario de índices ordenado por una clave Float64. */
class Monticulo {
  constructor(cap) {
    this.idx = new Int32Array(cap);
    this.clave = new Float64Array(cap);
    this.n = 0;
  }
  push(i, k) {
    if (this.n >= this.idx.length) {
      const idx = new Int32Array(this.idx.length * 2);
      const cl = new Float64Array(this.idx.length * 2);
      idx.set(this.idx);
      cl.set(this.clave);
      this.idx = idx;
      this.clave = cl;
    }
    let p = this.n++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.clave[q] <= k) break;
      this.idx[p] = this.idx[q];
      this.clave[p] = this.clave[q];
      p = q;
    }
    this.idx[p] = i;
    this.clave[p] = k;
  }
  pop() {
    const top = this.idx[0];
    const i = this.idx[--this.n];
    const k = this.clave[this.n];
    let p = 0;
    for (;;) {
      let c = 2 * p + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.clave[c + 1] < this.clave[c]) c += 1;
      if (this.clave[c] >= k) break;
      this.idx[p] = this.idx[c];
      this.clave[p] = this.clave[c];
      p = c;
    }
    this.idx[p] = i;
    this.clave[p] = k;
    return top;
  }
}

const nodo = (rej, x, y) => {
  const i = Math.round((x - rej.x0) / rej.R);
  const j = Math.round((y - rej.y0) / rej.R);
  return i >= 0 && j >= 0 && i < rej.nx && j < rej.ny ? j * rej.nx + i : -1;
};

/**
 * Busca una ruta de A a B.
 * @param rej rejilla de rejillaRegion()
 * @param o { pendienteMin, pendienteMax (m/km; o `pendiente` para ambas), tolerancia (m), pesoPuente, pesoZanja (recargo por
 *            metro de canal y metro de desnivel), penal (Float32Array opcional con
 *            un factor ≥ 1 por nodo), maxIter }
 */
export function buscarRuta(rej, a, b, o = {}) {
  const { nx, ny, R, z } = rej;
  const sMin = (o.pendienteMin ?? o.pendiente ?? 0.3) / 1000;
  const sMax = Math.max(sMin, (o.pendienteMax ?? o.pendiente ?? 3) / 1000);
  const tol = o.tolerancia ?? 2;
  const wP = o.pesoPuente ?? 5;
  const wZ = o.pesoZanja ?? 5;
  const penal = o.penal || null;
  // Resaltos: caídas bruscas del canal hasta el terreno cuando este baja más
  // deprisa que la pendiente máxima. Coste fijo (equivalente en metros de canal)
  // más un tanto por metro de caída.
  const resaltos = !!o.resaltos;
  const costeResalto = o.costeResalto ?? 60;
  const ia = nodo(rej, a.x, a.y);
  const ib = nodo(rej, b.x, b.y);
  if (ia < 0 || ib < 0) return null;
  const zA = o.zA ?? z[ia];
  if (!Number.isFinite(zA) || !Number.isFinite(z[ib])) return null;
  const bi = ib % nx;
  const bj = (ib - bi) / nx;

  const N = nx * ny;
  const g = new Float64Array(N).fill(Infinity);
  const largo = new Float64Array(N);
  const cota = new Float64Array(N); // cota del canal en cada nodo (según el mejor camino)
  const caidaEn = new Float32Array(N); // altura del resalto al llegar a cada nodo (0 si no hay)
  const prev = new Int32Array(N).fill(-1);
  const cerrado = new Uint8Array(N);
  const heap = new Monticulo(1 << 16);
  const h = (i) => {
    const x = i % nx;
    const y = (i - x) / nx;
    return Math.hypot(x - bi, y - bj) * R;
  };
  g[ia] = 0;
  cota[ia] = zA;
  heap.push(ia, h(ia));
  const maxIter = o.maxIter ?? N * 4;
  let iter = 0;
  let encontrado = false;
  while (heap.n > 0 && iter < maxIter) {
    iter += 1;
    const u = heap.pop();
    if (cerrado[u]) continue;
    if (u === ib) {
      encontrado = true;
      break;
    }
    cerrado[u] = 1;
    const ui = u % nx;
    const uj = (u - ui) / nx;
    for (const [di, dj] of VECINOS) {
      const vi = ui + di;
      const vj = uj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= ny) continue;
      const v = vj * nx + vi;
      if (cerrado[v]) continue;
      const zt = z[v];
      if (!Number.isFinite(zt) || zt < -500) continue;
      const l = Math.hypot(di, dj) * R;
      const L = largo[u] + l;
      // Pegado al terreno dentro del margen de pendientes: nunca sube.
      let zc = Math.min(cota[u] - sMin * l, Math.max(cota[u] - sMax * l, zt));
      const dz = zt - zc;
      let c = 1;
      if (dz < -tol) c += wP * (-dz - tol);
      else if (dz > tol) c += wZ * (dz - tol);
      let extra = 0;
      let salto = 0;
      if (resaltos && dz < -tol) {
        // Alternativa: caer de golpe hasta el terreno en este paso.
        const caida = cota[u] - sMax * l - zt;
        const cr = costeResalto + 2 * caida;
        if (cr < l * (c - 1)) {
          c = 1;
          extra = cr;
          salto = caida;
          zc = zt;
        }
      }
      if (penal) c *= penal[v];
      const ng = g[u] + l * c + extra;
      if (ng < g[v]) {
        g[v] = ng;
        largo[v] = L;
        cota[v] = zc;
        caidaEn[v] = salto;
        prev[v] = u;
        heap.push(v, ng + h(v));
      }
    }
  }
  if (!encontrado) return null;

  const idx = [];
  for (let i = ib; i !== -1; i = prev[i]) idx.push(i);
  idx.reverse();
  const puntos = idx.map((i) => {
    const x = i % nx;
    const y = (i - x) / nx;
    const zt = z[i];
    const zc = cota[i];
    const dz = zt - zc;
    const tipo = caidaEn[i] > 0 ? 'resalto' : dz > tol ? 'zanja' : dz < -tol ? 'puente' : 'ladera';
    return { i, x: rej.x0 + x * R, y: rej.y0 + y * R, d: largo[i], zc, zt, tipo, caida: caidaEn[i] };
  });
  return { puntos, coste: g[ib], iteraciones: iter, ...resumenRuta(puntos) };
}

/** Longitudes de obra y cotas de llegada de una ruta. */
export function resumenRuta(puntos) {
  let puente = 0;
  let zanja = 0;
  let maxPuente = 0;
  let maxZanja = 0;
  let nResaltos = 0;
  let alturaResaltos = 0;
  for (let k = 1; k < puntos.length; k += 1) {
    const p = puntos[k];
    if (p.tipo === 'resalto') {
      nResaltos += 1;
      alturaResaltos += p.caida || 0;
    }
    const l = p.d - puntos[k - 1].d;
    if (p.tipo === 'puente') puente += l;
    if (p.tipo === 'zanja') zanja += l;
    maxPuente = Math.max(maxPuente, p.zc - p.zt);
    maxZanja = Math.max(maxZanja, p.zt - p.zc);
  }
  const a = puntos[0];
  const b = puntos[puntos.length - 1];
  return {
    longitud: b.d,
    zInicio: a.zc,
    zLlegada: b.zc,
    zDestino: b.zt,
    margen: b.zc - b.zt, // > 0: el canal llega por encima del suelo del destino
    pendienteMedia: b.d > 0 ? ((a.zc - b.zc) / b.d) * 1000 : 0, // m/km
    puente,
    zanja,
    maxPuente: Math.max(0, maxPuente),
    maxZanja: Math.max(0, maxZanja),
    nResaltos,
    alturaResaltos,
  };
}

/** Perfiles de las opciones: nombre y recargos por metro de desnivel de obra. */
export const PERFILES = [
  { id: 'obra', nombre: 'Menos obra', peso: 25 },
  { id: 'equilibrada', nombre: 'Equilibrada', peso: 5 },
  { id: 'directa', nombre: 'Más directa', peso: 0.8 },
];

/** Fracción de nodos de `r` que están a ≤ 2 celdas de la ruta `q`. */
function solape(rej, r, q) {
  const cerca = new Set();
  for (const p of q.puntos) {
    const x = p.i % rej.nx;
    const y = (p.i - x) / rej.nx;
    for (let a = -2; a <= 2; a += 1) for (let b = -2; b <= 2; b += 1) cerca.add((y + b) * rej.nx + x + a);
  }
  let n = 0;
  for (const p of r.puntos) if (cerca.has(p.i)) n += 1;
  return n / r.puntos.length;
}

/**
 * Varias opciones de ruta de A a B (hasta perfiles.length). Cada opción nueva
 * encarece un poco los nodos cercanos a las anteriores; si aun así sale casi
 * igual que alguna ya encontrada (≥ 85 % de solape), se descarta.
 */
export function buscarAlternativas(rej, a, b, o = {}) {
  const perfiles = o.perfiles || PERFILES;
  const penal = new Float32Array(rej.nx * rej.ny).fill(1);
  const rutas = [];
  for (const p of perfiles) {
    const r = buscarRuta(rej, a, b, { ...o, pesoPuente: p.peso, pesoZanja: p.peso, penal });
    if (!r) continue;
    if (rutas.some((q) => solape(rej, r, q) >= 0.85)) continue;
    rutas.push({ ...r, perfil: p });
    for (const pt of r.puntos) {
      const x = pt.i % rej.nx;
      const y = (pt.i - x) / rej.nx;
      for (let da = -3; da <= 3; da += 1) {
        for (let db = -3; db <= 3; db += 1) {
          const xi = x + da;
          const yj = y + db;
          if (xi >= 0 && yj >= 0 && xi < rej.nx && yj < rej.ny) penal[yj * rej.nx + xi] = 1.35;
        }
      }
    }
  }
  return rutas;
}

// ---------------------------------------------------------------------------
// Sifones y tramos
// ---------------------------------------------------------------------------

/**
 * Sifón invertido en línea recta de A a B. El agua entra a la cota zEntrada
 * (depósito de cabecera) y sale en B a zEntrada − pérdida·L (depósito de
 * salida). La tubería va por el suelo. Se comprueba si el terreno sobresale por
 * encima de la línea de carga (ahí la tubería no funcionaría sin excavar).
 * La pérdida de carga es un supuesto del usuario (m por km).
 */
export function calcularSifon(alt, a, b, zEntrada, { perdida = 2, paso = 2 } = {}) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(L / paso));
  const puntos = [];
  let zMin = Infinity;
  let sobresale = -Infinity;
  for (let k = 0; k <= n; k += 1) {
    const f = k / n;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const d = L * f;
    const zt = alt(x, y);
    if (!Number.isFinite(zt)) return null;
    const zc = zEntrada - (perdida / 1000) * d;
    zMin = Math.min(zMin, zt);
    if (k > 0 && k < n) sobresale = Math.max(sobresale, zt - zc);
    puntos.push({ x, y, d, zc, zt, tipo: 'sifon' });
  }
  const zSalida = zEntrada - (perdida / 1000) * L;
  const profundidad = Math.max(0, zEntrada - zMin);
  return {
    tipo: 'sifon',
    puntos,
    longitud: L,
    zInicio: zEntrada,
    zLlegada: zSalida,
    zDestino: puntos[n].zt,
    margen: zSalida - puntos[n].zt,
    profundidad,
    presionAtm: profundidad / 10.33, // columna de agua: ≈ 10,33 m por atmósfera
    sobresale: Math.max(0, sobresale),
    puente: 0,
    zanja: 0,
    nResaltos: 0,
    alturaResaltos: 0,
    maxPuente: 0,
    maxZanja: 0,
    pendienteMedia: L > 0 ? ((zEntrada - zSalida) / L) * 1000 : 0,
  };
}

/**
 * Tramos de puente de una ruta que podrían resolverse con un sifón: tramos
 * seguidos de «puente» cuya altura máxima alcanza `alturaMin`. Devuelve para
 * cada uno los índices del último punto antes (entrada) y del primero después
 * (salida), su longitud y su altura máxima.
 */
export function sugerirSifones(ruta, { alturaMin = 50 } = {}) {
  const p = ruta.puntos;
  const out = [];
  let k = 1;
  while (k < p.length) {
    if (p[k].tipo !== 'puente') {
      k += 1;
      continue;
    }
    const ini = k;
    let alto = 0;
    while (k < p.length && p[k].tipo === 'puente') {
      alto = Math.max(alto, p[k].zc - p[k].zt);
      k += 1;
    }
    const entrada = ini - 1;
    const salida = Math.min(k, p.length - 1);
    if (alto >= alturaMin) {
      out.push({
        entrada,
        salida,
        longitud: p[salida].d - p[entrada].d,
        alturaMax: alto,
        a: { x: p[entrada].x, y: p[entrada].y },
        b: { x: p[salida].x, y: p[salida].y },
      });
    }
  }
  return out;
}

/** Parte de una ruta entre los índices i y j (incluidos), con la distancia desde 0. */
export function recortarRuta(ruta, i, j) {
  const base = ruta.puntos[i].d;
  const puntos = ruta.puntos.slice(i, j + 1).map((p) => ({ ...p, d: p.d - base }));
  return { ...ruta, puntos, ...resumenRuta(puntos) };
}

/** Misma ruta con la cota del canal desplazada dz (y los tipos recalculados). */
export function desplazarRuta(ruta, dz, tol = 2) {
  if (!dz) return ruta;
  const puntos = ruta.puntos.map((p) => {
    const zc = p.zc + dz;
    const d = p.zt - zc;
    const tipo = p.tipo === 'resalto' || p.tipo === 'sifon' ? p.tipo : d > tol ? 'zanja' : d < -tol ? 'puente' : 'ladera';
    return { ...p, zc, tipo };
  });
  return { ...ruta, puntos, ...resumenRuta(puntos) };
}
