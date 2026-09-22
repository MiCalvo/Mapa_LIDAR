import * as THREE from 'three';

/**
 * Uniformes compartidos por todas las capas de terreno. Se ajustan desde la
 * interfaz y afectan a la vez a todos los bloques cargados.
 */
export const uniformesTerreno = {
  exag: { value: 1.0 }, // exageración vertical del terreno
  exagObj: { value: 1.0 }, // exageración de los objetos (MDS − MDT): árboles, edificios
  luzDir: { value: new THREE.Vector3(-0.5, 0.5, 0.707).normalize() },
  modo: { value: 0 }, // 0 altura (rampa), 1 pendiente, 2 gris, 3 ortofoto
  zBajo: { value: 0 },
  zAlto: { value: 1 },
  isoOn: { value: 1 },
  isoOpacidad: { value: 0.75 },
  // Lista de curvas (máx. MAX_CURVAS): tipo 0 = cada N m, 1 = cota concreta.
  isoN: { value: 0 },
  isoTipo: { value: new Array(8).fill(0) },
  isoValor: { value: new Array(8).fill(5) },
  isoColor: { value: Array.from({ length: 8 }, () => new THREE.Color('#47291a')) },
  isoGrosor: { value: new Array(8).fill(1) },
  isoPatron: { value: new Array(8).fill(0) }, // 0 continua, 1 discontinua, 2 puntos, 3 raya-punto
  // Rampa de color por altura: posiciones 0–1 (entre zBajo y zAlto) y colores.
  rampaN: { value: 0 },
  rampaPos: { value: new Array(8).fill(0) },
  rampaColor: { value: Array.from({ length: 8 }, () => new THREE.Color(0, 0, 0)) },
};

export const MAX_PARADAS = 8;

const colorCrudo = (c, hex) => {
  // Sin gestión de color: el shader usa los valores tal cual.
  const h = /^#?([0-9a-f]{6})$/i.exec(hex || '')?.[1] || '808080';
  const n = parseInt(h, 16);
  c.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
};

/** Rampa de color: [{ pos: 0–1, color: '#rrggbb' }] (se ordena por posición). */
export function fijarRampa(paradas) {
  const u = uniformesTerreno;
  const lista = [...paradas].sort((a, b) => a.pos - b.pos).slice(0, MAX_PARADAS);
  u.rampaN.value = lista.length;
  lista.forEach((p, i) => {
    u.rampaPos.value[i] = Math.min(1, Math.max(0, Number(p.pos) || 0));
    colorCrudo(u.rampaColor.value[i], p.color);
  });
}

export const RAMPA_POR_DEFECTO = [
  { pos: 0, color: '#3b9e9e' },
  { pos: 0.2, color: '#9ec78c' },
  { pos: 0.4, color: '#e3cc80' },
  { pos: 0.6, color: '#d69e5c' },
  { pos: 0.8, color: '#9e735c' },
  { pos: 1, color: '#f7f5f2' },
];
fijarRampa(RAMPA_POR_DEFECTO);

export const MAX_CURVAS = 8;
export const PATRONES = ['continua', 'discontinua', 'puntos', 'raya-punto'];

/**
 * Curvas de nivel a dibujar, en orden (las últimas encima):
 * [{ tipo: 'cada'|'cota', valor (m), color '#rrggbb', grosor (px), patron }]
 */
export function fijarCurvas(lista) {
  const u = uniformesTerreno;
  const validas = lista.filter((c) => Number(c.valor) > 0 || c.tipo === 'cota').slice(0, MAX_CURVAS);
  u.isoN.value = validas.length;
  validas.forEach((c, i) => {
    u.isoTipo.value[i] = c.tipo === 'cota' ? 1 : 0;
    u.isoValor.value[i] = Number(c.valor) || 0;
    colorCrudo(u.isoColor.value[i], c.color || '#47291a');
    u.isoGrosor.value[i] = Math.max(0.5, Math.min(8, Number(c.grosor) || 1));
    u.isoPatron.value[i] = Math.max(0, PATRONES.indexOf(c.patron));
  });
}

/** Luz a partir de acimut (grados desde el norte, sentido horario) y elevación. */
export function fijarLuz(acimut, elevacion) {
  const a = THREE.MathUtils.degToRad(acimut);
  const e = THREE.MathUtils.degToRad(elevacion);
  uniformesTerreno.luzDir.value.set(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e));
}

const vertexShader = /* glsl */ `
  uniform sampler2D mapa;       // superficie mostrada (MDT o MDS)
  uniform sampler2D mapaSuelo;  // MDT (igual que mapa si se muestra el suelo)
  uniform float exagObj;
  uniform vec2 tam;       // celdas propias (ancho, alto)
  uniform float pad;      // celdas de borde en la textura (copiadas de los bloques vecinos)
  uniform float zRef;     // altura del origen local
  uniform float exag;
  out vec2 vT;            // coordenada en celdas (continua)

  float altura(vec2 t) {
    ivec2 m = ivec2(tam + 2.0 * pad) - 1;
    vec2 c = clamp(t + pad, vec2(0.0), vec2(m));
    vec2 f = floor(c);
    ivec2 i = ivec2(f);
    ivec2 j = min(i + 1, m);
    vec2 k = c - f;
    float a = texelFetch(mapa, i, 0).r;
    float b = texelFetch(mapa, ivec2(j.x, i.y), 0).r;
    float d = texelFetch(mapa, ivec2(i.x, j.y), 0).r;
    float e = texelFetch(mapa, j, 0).r;
    return mix(mix(a, b, k.x), mix(d, e, k.x), k.y);
  }

  // Como altura(), pero ignorando las celdas sin datos (valor < -500) para que
  // los vértices del borde de un hueco no se hundan.
  float alturaVertice(sampler2D tex, vec2 t) {
    ivec2 m = ivec2(tam + 2.0 * pad) - 1;
    vec2 c = clamp(t + pad, vec2(0.0), vec2(m));
    vec2 f = floor(c);
    ivec2 i = ivec2(f);
    ivec2 j = min(i + 1, m);
    vec2 k = c - f;
    vec4 h = vec4(texelFetch(tex, i, 0).r, texelFetch(tex, ivec2(j.x, i.y), 0).r,
                  texelFetch(tex, ivec2(i.x, j.y), 0).r, texelFetch(tex, j, 0).r);
    vec4 w = vec4((1.0 - k.x) * (1.0 - k.y), k.x * (1.0 - k.y), (1.0 - k.x) * k.y, k.x * k.y);
    w *= step(-500.0, h);
    float sw = dot(w, vec4(1.0));
    return sw > 0.0 ? dot(w, h) / sw : zRef;
  }

  void main() {
    // El plano cubre el bloque entero; los valores están en el centro de cada celda.
    vT = uv * tam - 0.5;
    vec3 p = position;
    // En el borde, la altura se interpola con la primera celda del bloque vecino
    // (copiada en el borde de la textura): los dos bloques calculan el mismo valor y
    // la junta queda cerrada.
    // Terreno × exag y, encima, la altura de los objetos (MDS − MDT) × exagObj.
    float suelo = alturaVertice(mapaSuelo, vT);
    float sup = alturaVertice(mapa, vT);
    p.z = (suelo - zRef) * exag + max(sup - suelo, 0.0) * exagObj;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D mapa;
  uniform sampler2D mapaSuave; // MDT suavizado: solo para las curvas de nivel
  uniform sampler2D mapaSuelo;
  uniform sampler2D orto;       // ortofoto PNOA del bloque (si se ha cargado)
  uniform float tieneOrto;
  uniform float exagObj;
  uniform int rampaN;
  uniform float rampaPos[8];
  uniform vec3 rampaColor[8];
  uniform vec2 tam;
  uniform float pad;
  uniform float res;
  uniform float exag;
  uniform vec3 luzDir;
  uniform int modo;
  uniform float zBajo;
  uniform float zAlto;
  uniform float isoOn;
  uniform float isoOpacidad;
  uniform int isoN;
  uniform float isoTipo[8];
  uniform float isoValor[8];
  uniform vec3 isoColor[8];
  uniform float isoGrosor[8];
  uniform float isoPatron[8];
  in vec2 vT;
  out vec4 salida;

  float muestra(sampler2D m_, vec2 t) {
    ivec2 m = ivec2(tam + 2.0 * pad) - 1;
    vec2 c = clamp(t + pad, vec2(0.0), vec2(m));
    vec2 f = floor(c);
    ivec2 i = ivec2(f);
    ivec2 j = min(i + 1, m);
    vec2 k = c - f;
    float a = texelFetch(m_, i, 0).r;
    float b = texelFetch(m_, ivec2(j.x, i.y), 0).r;
    float d = texelFetch(m_, ivec2(i.x, j.y), 0).r;
    float e = texelFetch(m_, j, 0).r;
    return mix(mix(a, b, k.x), mix(d, e, k.x), k.y);
  }
  float altura(vec2 t) { return muestra(mapa, t); }

  // Rampa de color por altura (paradas editables).
  vec3 rampa(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = rampaColor[0];
    for (int i = 1; i < 8; i++) {
      if (i >= rampaN) break;
      float p0 = rampaPos[i - 1];
      float p1 = rampaPos[i];
      if (t >= p0) c = p1 > p0 ? mix(rampaColor[i - 1], rampaColor[i], clamp((t - p0) / (p1 - p0), 0.0, 1.0)) : rampaColor[i];
    }
    return c;
  }

  vec3 porPendiente(float grados) {
    float t = clamp(grados / 45.0, 0.0, 1.0);
    return mix(mix(vec3(0.96, 0.95, 0.88), vec3(0.93, 0.72, 0.35), smoothstep(0.0, 0.5, t)),
               vec3(0.62, 0.22, 0.18), smoothstep(0.5, 1.0, t));
  }

  // Patrón a lo largo de la línea; s en píxeles.
  float patron(float p, float s) {
    if (p > 2.5) { float m = mod(s, 22.0); return (m < 11.0 || (m > 14.0 && m < 17.0)) ? 1.0 : 0.0; }
    if (p > 1.5) return step(mod(s, 7.0), 2.5);
    if (p > 0.5) return step(mod(s, 14.0), 9.0);
    return 1.0;
  }

  // Intensidad (0–1) de la curva i en este píxel.
  float curva(int i, float zs) {
    float g = isoGrosor[i];
    float d;
    float fundido = 1.0;
    if (isoTipo[i] < 0.5) {
      float u = zs / max(isoValor[i], 0.01);
      float w = fwidth(u);
      d = abs(fract(u + 0.5) - 0.5) / max(w, 1e-5);
      // Las curvas periódicas se desvanecen cuando quedan a menos de ~4 px unas de otras.
      fundido = 1.0 - smoothstep(0.12, 0.3, w);
    } else {
      d = abs(zs - isoValor[i]) / max(fwidth(zs), 1e-5);
    }
    return (1.0 - smoothstep(g * 0.5, g * 0.5 + 1.0, d)) * fundido;
  }

  void main() {
    float z = altura(vT);
    if (z < -500.0) discard; // sin datos (mar, fuera del vuelo)
    // Normal por diferencias centrales (un texel = res metros).
    float dzdx = (altura(vT + vec2(1.0, 0.0)) - altura(vT - vec2(1.0, 0.0))) / (2.0 * res);
    float dzdy = (altura(vT + vec2(0.0, 1.0)) - altura(vT - vec2(0.0, 1.0))) / (2.0 * res);
    // Pendiente del suelo (para el sombreado exagerado se separa suelo y objetos).
    float sx = (muestra(mapaSuelo, vT + vec2(1.0, 0.0)) - muestra(mapaSuelo, vT - vec2(1.0, 0.0))) / (2.0 * res);
    float sy = (muestra(mapaSuelo, vT + vec2(0.0, 1.0)) - muestra(mapaSuelo, vT - vec2(0.0, 1.0))) / (2.0 * res);
    vec3 nReal = normalize(vec3(-dzdx, -dzdy, 1.0));
    vec3 n = normalize(vec3(-(sx * exag + (dzdx - sx) * exagObj), -(sy * exag + (dzdy - sy) * exagObj), 1.0));

    // Sombreado: luz principal + tres luces suaves (multidireccional).
    float principal = max(dot(n, luzDir), 0.0);
    vec3 l2 = normalize(vec3(luzDir.y, -luzDir.x, luzDir.z));
    vec3 l3 = normalize(vec3(-luzDir.x, -luzDir.y, luzDir.z));
    vec3 l4 = normalize(vec3(-luzDir.y, luzDir.x, luzDir.z));
    float suave = (max(dot(n, l2), 0.0) + max(dot(n, l3), 0.0) + max(dot(n, l4), 0.0)) / 3.0;
    float sombra = 0.18 + 0.72 * principal + 0.25 * suave;

    vec3 base;
    if (modo == 1) {
      base = porPendiente(degrees(acos(clamp(nReal.z, -1.0, 1.0))));
    } else if (modo == 2) {
      base = vec3(0.86);
    } else if (modo == 3 && tieneOrto > 0.5) {
      // Ortofoto: la imagen cubre el bloque entero (fila 0 = sur tras flipY).
      base = texture(orto, (vT + 0.5) / tam).rgb;
    } else {
      base = rampa((z - zBajo) / max(zAlto - zBajo, 0.01));
    }
    // Con ortofoto el sombreado se suaviza: la foto ya trae sus propias sombras.
    vec3 color = modo == 3 && tieneOrto > 0.5 ? base * mix(1.0, sombra * 1.15, 0.45) : base * sombra;

    if (isoOn > 0.5 && muestra(mapaSuave, vT) > -500.0) {
      float zs = muestra(mapaSuave, vT);
      // Coordenada a lo largo de la curva (perpendicular al gradiente), en píxeles, para los patrones.
      vec2 g = vec2(sx, sy);
      vec2 t = length(g) > 1e-6 ? normalize(vec2(-g.y, g.x)) : vec2(1.0, 0.0);
      vec2 pos = vT * res;
      vec2 fw = fwidth(pos);
      float s = dot(pos, t) / max(0.5 * (fw.x + fw.y), 1e-4);
      for (int i = 0; i < 8; i++) {
        if (i >= isoN) break;
        float a = curva(i, zs) * patron(isoPatron[i], s) * isoOpacidad;
        color = mix(color, isoColor[i], a);
      }
    }
    salida = vec4(pow(color, vec3(1.0 / 1.1)), 1.0);
  }`;

/**
 * Suavizado casi gaussiano (dos pasadas de media móvil por eje, con sumas
 * acumuladas: coste fijo por celda). Las curvas de nivel se calculan sobre esta
 * copia para que no sigan cada irregularidad de 1 m. Las celdas sin datos (NaN)
 * no pesan y siguen siendo NaN en la salida.
 */
export function suavizar(datos, ancho, alto, sigma = 1.5) {
  // Dos cajas de radio r dan varianza 2·((2r+1)²−1)/12 ≈ sigma².
  const r = Math.max(1, Math.round((Math.sqrt(6 * sigma * sigma + 1) - 1) / 2));
  let v = new Float32Array(datos.length);
  let w = new Float32Array(datos.length);
  for (let i = 0; i < datos.length; i += 1) {
    const d = datos[i];
    if (d === d) {
      v[i] = d;
      w[i] = 1;
    }
  }
  // Media móvil horizontal (ventana deslizante sobre cada fila).
  const cajaFilas = (src, dst) => {
    for (let y = 0; y < alto; y += 1) {
      const f = y * ancho;
      let acc = 0;
      for (let k = 0; k < r && k < ancho; k += 1) acc += src[f + k];
      for (let x = 0; x < ancho; x += 1) {
        if (x + r < ancho) acc += src[f + x + r];
        if (x - r - 1 >= 0) acc -= src[f + x - r - 1];
        dst[f + x] = acc;
      }
    }
  };
  // Media móvil vertical: acumulador por columnas, recorriendo filas enteras.
  const acc = new Float64Array(ancho);
  const cajaColumnas = (src, dst) => {
    acc.fill(0);
    for (let k = 0; k < r && k < alto; k += 1) {
      const f = k * ancho;
      for (let x = 0; x < ancho; x += 1) acc[x] += src[f + x];
    }
    for (let y = 0; y < alto; y += 1) {
      if (y + r < alto) {
        const f = (y + r) * ancho;
        for (let x = 0; x < ancho; x += 1) acc[x] += src[f + x];
      }
      if (y - r - 1 >= 0) {
        const f = (y - r - 1) * ancho;
        for (let x = 0; x < ancho; x += 1) acc[x] -= src[f + x];
      }
      const f = y * ancho;
      for (let x = 0; x < ancho; x += 1) dst[f + x] = acc[x];
    }
  };
  const tv = new Float32Array(datos.length);
  const tw = new Float32Array(datos.length);
  for (let pasada = 0; pasada < 2; pasada += 1) {
    cajaFilas(v, tv);
    cajaFilas(w, tw);
    cajaColumnas(tv, v);
    cajaColumnas(tw, w);
  }
  const out = new Float32Array(datos.length);
  for (let i = 0; i < datos.length; i += 1) {
    out[i] = w[i] > 1e-6 && datos[i] === datos[i] ? v[i] / w[i] : NaN;
  }
  return out;
}

/** NaN (sin datos) → -10000: el shader lo descarta sin depender de isnan(). */
export const SIN_DATOS = -10000;

function texturaAlturas(entrada, ancho, alto) {
  const datos = new Float32Array(entrada);
  for (let i = 0; i < datos.length; i += 1) if (datos[i] !== datos[i]) datos[i] = SIN_DATOS;
  const t = new THREE.DataTexture(datos, ancho, alto, THREE.RedFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Celdas de borde que se copian de cada vecino (cubre el radio del suavizado). */
export const PAD = 8;

/**
 * Rejilla propia con un borde de PAD celdas tomado de los bloques vecinos.
 * `vecino(dx, dy)` devuelve la capa vecina (dx, dy ∈ {-1, 0, 1}) o null; sin
 * vecino se repite la celda del borde propio.
 */
export function componerConBorde(datos, ancho, alto, vecino, campo = 'datos') {
  const W = ancho + 2 * PAD;
  const H = alto + 2 * PAD;
  const out = new Float32Array(W * H);
  const cache = new Map();
  const buscar = (dx, dy) => {
    const k = dx * 3 + dy;
    if (!cache.has(k)) cache.set(k, vecino ? vecino(dx, dy) : null);
    return cache.get(k);
  };
  for (let j = 0; j < H; j += 1) {
    const y = j - PAD;
    const dy = y < 0 ? -1 : y >= alto ? 1 : 0;
    for (let i = 0; i < W; i += 1) {
      const x = i - PAD;
      const dx = x < 0 ? -1 : x >= ancho ? 1 : 0;
      let v;
      if (dx === 0 && dy === 0) {
        v = datos[y * ancho + x];
      } else {
        const n = buscar(dx, dy);
        if (n) {
          const nx = dx < 0 ? x + n.ancho : dx > 0 ? x - ancho : x;
          const ny = dy < 0 ? y + n.alto : dy > 0 ? y - alto : y;
          const nd = n[campo] || n.datos;
          v = nx >= 0 && nx < n.ancho && ny >= 0 && ny < n.alto ? nd[ny * n.ancho + nx] : NaN;
        } else {
          const cx = Math.min(ancho - 1, Math.max(0, x));
          const cy = Math.min(alto - 1, Math.max(0, y));
          v = datos[cy * ancho + cx];
        }
      }
      out[j * W + i] = v;
    }
  }
  return out;
}

/** Un bloque de terreno (MDT o MDS) dibujado como malla con altura en textura. */
export class CapaTerreno {
  constructor({ url, nombre, origen, escena }) {
    this.url = url; // .terreno.json
    this.nombre = nombre;
    this.origen = origen;
    this.escena = escena;
    this.meta = null;
    this.superficie = null;
    this.malla = null;
    this.textura = null;
    this.datos = null;
    this.mostrado = true;
    this.activa = true;
  }

  async abrir() {
    const r = await fetch(this.url);
    if (!r.ok) throw new Error(`terreno: HTTP ${r.status}`);
    this.meta = await r.json();
    return this;
  }

  /** Extensión del bloque en coordenadas UTM: [x0, y0, x1, y1]. */
  get extension() {
    const { origen: [x0, y0], resolucion: res, ancho, alto } = this.meta;
    return [x0, y0, x0 + ancho * res, y0 + alto * res];
  }

  rango(superficie) {
    const c = this.meta.capas[superficie] || this.meta.capas.mdt;
    return { zMin: c.zMin, zMax: c.zMax, p02: c.p02 ?? c.zMin, p98: c.p98 ?? c.zMax };
  }

  /** Carga (o cambia) la superficie mostrada: 'mdt' o 'mds'. */
  async leerCapa(nombre) {
    const capa = this.meta.capas[nombre] || this.meta.capas.mdt;
    const binUrl = new URL(capa.fichero, new URL(this.url, window.location.href)).href;
    const r = await fetch(binUrl);
    if (!r.ok) throw new Error(`terreno: HTTP ${r.status} en ${capa.fichero}`);
    const datos = new Float32Array(await r.arrayBuffer());
    if (datos.length !== this.meta.ancho * this.meta.alto) throw new Error('terreno: tamaño de rejilla incorrecto');
    return datos;
  }

  /** Carga (o cambia) la superficie mostrada: 'mdt' o 'mds' (esta necesita también el MDT). */
  async mostrar(superficie) {
    if (this.superficie === superficie && this.datos) return;
    const conObjetos = superficie === 'mds' && this.meta.capas.mds;
    const suelo = this.datosSuelo && this.superficie ? this.datosSuelo : await this.leerCapa('mdt');
    const datos = conObjetos ? await this.leerCapa('mds') : suelo;
    if (!this.activa) return;
    this.datos = datos;
    this.datosSuelo = suelo;
    this.ancho = this.meta.ancho;
    this.alto = this.meta.alto;
    this.firmaBordes = null; // las texturas se hacen en componer(), ya con los vecinos
    this.superficie = superficie;
  }

  crearMalla() {
    const { ancho, alto, resolucion: res } = this.meta;
    const [x0, y0, x1, y1] = this.extension;
    // Vértices: como mucho 1024 por lado; el detalle fino lo pone el sombreado por píxel.
    const segX = Math.min(ancho, 1024);
    const segY = Math.min(alto, 1024);
    const geometria = new THREE.PlaneGeometry(x1 - x0, y1 - y0, segX, segY);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        ...uniformesTerreno,
        mapa: { value: this.textura },
        mapaSuave: { value: this.texturaSuave },
        mapaSuelo: { value: this.texturaSuelo },
        orto: { value: this.texturaOrto || null },
        tieneOrto: { value: this.texturaOrto ? 1 : 0 },
        tam: { value: new THREE.Vector2(ancho, alto) },
        pad: { value: PAD },
        res: { value: res },
        zRef: { value: this.origen[2] },
      },
    });
    this.malla = new THREE.Mesh(geometria, material);
    this.malla.position.set((x0 + x1) / 2 - this.origen[0], (y0 + y1) / 2 - this.origen[1], 0);
    this.malla.frustumCulled = false;
    this.malla.visible = this.mostrado;
    this.escena.add(this.malla);
  }

  /**
   * Rehace las texturas con el borde de los vecinos. `firma` identifica el
   * conjunto de vecinos: si no cambia, no se hace nada.
   */
  componer(vecino, firma) {
    if (!this.datos || firma === this.firmaBordes) return;
    const { ancho, alto } = this;
    const res = this.meta.resolucion;
    const conBorde = componerConBorde(this.datos, ancho, alto, vecino, 'datos');
    const mismo = this.datosSuelo === this.datos;
    const sueloBorde = mismo ? conBorde : componerConBorde(this.datosSuelo, ancho, alto, vecino, 'datosSuelo');
    const W = ancho + 2 * PAD;
    const H = alto + 2 * PAD;
    // Curvas de nivel siempre sobre el suelo suavizado (~2 m de sigma), también con objetos.
    const suave = texturaAlturas(suavizar(sueloBorde, W, H, Math.max(1, 2 / res)), W, H);
    const textura = texturaAlturas(conBorde, W, H);
    const texSuelo = mismo ? textura : texturaAlturas(sueloBorde, W, H);
    this.liberarTexturas();
    this.textura = textura;
    this.texturaSuave = suave;
    this.texturaSuelo = texSuelo;
    if (this.malla) {
      const u = this.malla.material.uniforms;
      u.mapa.value = textura;
      u.mapaSuave.value = suave;
      u.mapaSuelo.value = texSuelo;
    } else {
      this.crearMalla();
    }
    this.firmaBordes = firma;
  }

  /** Pide al servidor la ortofoto PNOA del bloque (se guarda en caché en el PC). */
  cargarOrto(px = 2048) {
    if (this.texturaOrto || this.pidiendoOrto || !this.meta) return this.pidiendoOrto;
    const [x0, y0, x1, y1] = this.extension;
    const huso = this.meta.huso || 30;
    const url = `/api/orto?huso=${huso}&x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}&px=${px}`;
    this.pidiendoOrto = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          if (!this.activa) {
            tex.dispose();
            return resolve(null);
          }
          tex.colorSpace = THREE.NoColorSpace; // valores tal cual, como la rampa
          tex.anisotropy = 8;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          this.texturaOrto = tex;
          if (this.malla) {
            this.malla.material.uniforms.orto.value = tex;
            this.malla.material.uniforms.tieneOrto.value = 1;
          }
          resolve(tex);
        },
        undefined,
        () => reject(new Error('ortofoto no disponible')),
      );
    }).finally(() => {
      this.pidiendoOrto = null;
    });
    return this.pidiendoOrto;
  }

  liberarTexturas() {
    if (this.texturaSuelo && this.texturaSuelo !== this.textura) this.texturaSuelo.dispose();
    this.textura?.dispose();
    this.texturaSuave?.dispose();
  }

  set visible(v) {
    this.mostrado = v;
    if (this.malla) this.malla.visible = v;
  }

  cerrar() {
    this.activa = false;
    this.texturaOrto?.dispose();
    this.texturaOrto = null;
    this.datos = null;
    this.datosSuelo = null;
    if (this.malla) {
      this.escena.remove(this.malla);
      this.malla.geometry.dispose();
      this.malla.material.dispose();
    }
    this.liberarTexturas();
  }
}
