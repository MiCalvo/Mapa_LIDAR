/**
 * Utilidades comunes para herramientas que trabajan sobre el terreno:
 * muestreadores de altura a partir de los bloques cargados, el punto del
 * terreno bajo el cursor y un gestor sencillo de «herramienta activa» (solo una
 * a la vez recibe los clics sobre la vista 3D).
 */
import * as THREE from 'three';
import { crearMuestreador } from '../analisis/canal.js';
import { PAD, uniformesTerreno } from './capaTerreno.js';

/** Alturas del MDT suavizado que ya usa la vista (con el borde de los vecinos). */
export function muestreadorSuave(escena) {
  const bloques = [];
  for (const t of escena.terrenos.values()) {
    const datos = t.texturaSuave?.image?.data;
    if (!t.mostrado || !t.meta || !datos) continue;
    const res = t.meta.resolucion;
    const [x0, y0] = t.extension;
    bloques.push({ x0: x0 - PAD * res, y0: y0 - PAD * res, res, ancho: t.ancho + 2 * PAD, alto: t.alto + 2 * PAD, datos });
  }
  return bloques.length ? crearMuestreador(bloques) : null;
}

/** Alturas sin suavizar: campo 'datosSuelo' (MDT) o 'datos' (superficie mostrada). */
export function muestreadorCrudo(escena, campo = 'datosSuelo') {
  const bloques = [];
  for (const t of escena.terrenos.values()) {
    const datos = t[campo];
    if (!t.mostrado || !t.meta || !datos) continue;
    const [x0, y0] = t.extension;
    bloques.push({ x0, y0, res: t.meta.resolucion, ancho: t.ancho, alto: t.alto, datos });
  }
  return bloques.length ? crearMuestreador(bloques) : null;
}

/** Bloque de terreno que contiene (x, y), o null. */
export function terrenoEn(escena, x, y) {
  for (const t of escena.terrenos.values()) {
    if (!t.meta || !t.mostrado) continue;
    const [x0, y0, x1, y1] = t.extension;
    if (x >= x0 && y >= y0 && x < x1 && y < y1) return t;
  }
  return null;
}

/** Punto del terreno bajo el cursor (coordenadas UTM): se recorre el rayo de la cámara. */
export function picar(escena, alt, ndc) {
  const o = escena.origen;
  if (!o) return null;
  const exag = uniformesTerreno.exag.value;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, escena.camara);
  const { origin: a, direction: d } = ray.ray;
  const sobre = (t) => {
    const x = a.x + d.x * t;
    const y = a.y + d.y * t;
    const z = alt(x + o[0], y + o[1]);
    return Number.isFinite(z) ? a.z + d.z * t - (z - o[2]) * exag : NaN;
  };
  let t0 = 0;
  let t = 1;
  while (t < 80000) {
    if (sobre(t) <= 0) {
      for (let i = 0; i < 30; i += 1) {
        const m = (t0 + t) / 2;
        if (sobre(m) <= 0) t = m;
        else t0 = m;
      }
      return { x: a.x + d.x * t + o[0], y: a.y + d.y * t + o[1] };
    }
    t0 = t;
    t += Math.max(1, t * 0.004);
  }
  return null;
}

/** Círculo con borde blanco (textura para marcar puntos con THREE.Points). */
const texturas = new Map();
export function texturaPunto(color) {
  if (texturas.has(color)) return texturas.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#ffffff';
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texturas.set(color, tex);
  return tex;
}

/** Marca un punto (x, y, z UTM) que se ve a cualquier distancia. */
export function crearMarca(escena, x, y, z, color, tam = 18) {
  const [ox, oy, oz] = escena.origen;
  const exag = uniformesTerreno.exag.value;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x - ox, y - oy, (z - oz) * exag + 2 + exag * 2], 3));
  const m = new THREE.PointsMaterial({ size: tam, sizeAttenuation: false, map: texturaPunto(color), transparent: true, depthTest: false });
  const p = new THREE.Points(g, m);
  p.renderOrder = 6;
  return p;
}

// ------------------------------------------------------------ herramienta activa
let activa = null; // { nombre, alClicar(p, evento), alCancelar() }

export function activarHerramienta(nombre, alClicar, alCancelar) {
  if (activa && activa.nombre !== nombre) activa.alCancelar?.();
  activa = { nombre, alClicar, alCancelar };
  document.body.dataset.herramienta = nombre;
}

export function desactivarHerramienta(nombre) {
  if (activa && (!nombre || activa.nombre === nombre)) {
    activa = null;
    delete document.body.dataset.herramienta;
  }
}

export const herramientaActiva = () => activa?.nombre || null;

/** Clics (sin arrastre) sobre la vista 3D → herramienta activa. Esc la cancela. */
export function instalarClics(escena, avisar) {
  const lienzo = escena.renderer.domElement;
  let abajo = null;
  lienzo.addEventListener('pointerdown', (e) => {
    abajo = activa ? [e.clientX, e.clientY] : null;
  });
  lienzo.addEventListener('pointerup', (e) => {
    if (!activa || !abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 5) return;
    const alt = muestreadorSuave(escena);
    if (!alt) return avisar('Carga primero algún bloque de terreno en 3D.');
    const r = lienzo.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const p = picar(escena, alt, ndc);
    if (!p) return avisar('No hay terreno bajo ese punto.');
    activa.alClicar(p, e);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activa) {
      const a = activa;
      desactivarHerramienta();
      a.alCancelar?.();
    }
  });
}
