import * as THREE from 'three';
import { Copc } from 'copc';
import { createLazPerf } from 'laz-perf';
import wasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url';
import { colorear } from './colores.js';

let lazPerfPromesa = null;
function lazPerf() {
  lazPerfPromesa ??= createLazPerf({ locateFile: () => wasmUrl });
  return lazPerfPromesa;
}

/** Calidad → error en pantalla permitido (px por espaciado de punto). */
export const CALIDADES = { alta: 1, media: 2.5, baja: 6 };

const material = new THREE.ShaderMaterial({
  uniforms: { tamano: { value: 2.0 }, escala: { value: 1.0 } },
  vertexShader: `
    uniform float tamano;
    uniform float escala;
    attribute vec4 color4;
    varying vec4 vColor;
    void main() {
      vColor = color4;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(tamano * escala / -mv.z, 1.0, 16.0);
    }`,
  fragmentShader: `
    varying vec4 vColor;
    void main() {
      if (vColor.a < 0.5) discard;
      gl_FragColor = vec4(vColor.rgb, 1.0);
    }`,
});

/**
 * Un bloque COPC con nivel de detalle: carga solo los nodos del octree que
 * hacen falta según la distancia a la cámara y el presupuesto de puntos.
 */
export class CapaCopc {
  constructor({ url, nombre, origen, escena, estado }) {
    this.url = url;
    this.nombre = nombre;
    this.origen = origen; // [x, y, z] del sistema local
    this.escena = escena;
    this.estado = estado; // compartido: modo de color, calidad, zMin/zMax…
    this.grupo = new THREE.Group();
    this.escena.add(this.grupo);
    this.nodos = new Map(); // clave → { info, objeto, datos, cargando }
    this.copc = null;
    this.jerarquia = null;
    this.activa = true;
  }

  async abrir() {
    this.copc = await Copc.create(this.url);
    const { nodes, pages } = await Copc.loadHierarchyPage(
      this.url,
      this.copc.info.rootHierarchyPage,
    );
    this.jerarquia = { ...nodes };
    // Páginas adicionales de jerarquía (ficheros grandes de otros conversores).
    for (const pagina of Object.values(pages || {})) {
      const sub = await Copc.loadHierarchyPage(this.url, pagina);
      Object.assign(this.jerarquia, sub.nodes);
    }
    return this;
  }

  get cubo() {
    return this.copc.info.cube;
  }

  /** Nodos a mostrar, por orden de prioridad. */
  seleccionar(camara, altoPantalla, presupuesto) {
    const [x0, y0, z0, x1] = this.cubo;
    const lado = x1 - x0;
    const espaciado = this.copc.info.spacing;
    const umbral = CALIDADES[this.estado.calidad] ?? CALIDADES.media;
    const proyeccion =
      altoPantalla / (2 * Math.tan(THREE.MathUtils.degToRad(camara.fov) / 2));
    const pos = camara.position;
    const salida = [];
    let puntos = 0;
    const cola = [[0, 0, 0, 0]];
    while (cola.length) {
      const [d, x, y, z] = cola.shift();
      const clave = `${d}-${x}-${y}-${z}`;
      const nodo = this.jerarquia[clave];
      if (!nodo || nodo.pointCount === 0) continue;
      if (puntos + nodo.pointCount > presupuesto) continue;
      const tam = lado / 2 ** d;
      const cx = x0 + (x + 0.5) * tam - this.origen[0];
      const cy = y0 + (y + 0.5) * tam - this.origen[1];
      const cz = z0 + (z + 0.5) * tam - this.origen[2];
      const dist = Math.max(
        1,
        Math.hypot(pos.x - cx, pos.y - cy, pos.z - cz) - tam * 0.87,
      );
      salida.push(clave);
      puntos += nodo.pointCount;
      const errorPx = ((espaciado / 2 ** d) * proyeccion) / dist;
      if (errorPx > umbral) {
        for (const [dx, dy, dz] of HIJOS)
          cola.push([d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz]);
      }
    }
    return { claves: salida, puntos };
  }

  async cargarNodo(clave) {
    const nodo = this.jerarquia[clave];
    const vista = await Copc.loadPointDataView(this.url, this.copc, nodo, {
      lazPerf: await lazPerf(),
      include: ['X', 'Y', 'Z', 'Classification', 'Intensity', 'Red', 'Green', 'Blue'],
    });
    const n = vista.pointCount;
    const gx = vista.getter('X');
    const gy = vista.getter('Y');
    const gz = vista.getter('Z');
    const gc = vista.getter('Classification');
    const gi = vista.getter('Intensity');
    const tieneRgb = 'Red' in vista.dimensions;
    const gr = tieneRgb ? vista.getter('Red') : null;
    const gg = tieneRgb ? vista.getter('Green') : null;
    const gb = tieneRgb ? vista.getter('Blue') : null;
    const posiciones = new Float32Array(n * 3);
    const datos = {
      rgb: new Uint16Array(n * 3),
      clase: new Uint8Array(n),
      z: new Float32Array(n),
      intensidad: new Uint16Array(n),
    };
    const [ox, oy, oz] = this.origen;
    for (let i = 0; i < n; i += 1) {
      const z = gz(i);
      posiciones[i * 3] = gx(i) - ox;
      posiciones[i * 3 + 1] = gy(i) - oy;
      posiciones[i * 3 + 2] = z - oz;
      datos.z[i] = z;
      datos.clase[i] = gc(i);
      datos.intensidad[i] = gi(i);
      if (tieneRgb) {
        datos.rgb[i * 3] = gr(i);
        datos.rgb[i * 3 + 1] = gg(i);
        datos.rgb[i * 3 + 2] = gb(i);
      }
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    const colores = new Uint8Array(n * 4);
    geometria.setAttribute('color4', new THREE.BufferAttribute(colores, 4, true));
    const objeto = new THREE.Points(geometria, material);
    objeto.frustumCulled = false;
    const entrada = { objeto, datos, n };
    this.colorearNodo(entrada);
    return entrada;
  }

  colorearNodo(entrada) {
    const attr = entrada.objeto.geometry.getAttribute('color4');
    const rgbEscala = this.estado.rgb16 ? 1 / 257 : 1;
    colorear(attr.array, entrada.datos, this.estado.modoColor, {
      zMin: this.estado.zMin,
      zMax: this.estado.zMax,
      rgbEscala,
      clasesVisibles: this.estado.clasesVisibles,
    });
    attr.needsUpdate = true;
  }

  recolorear() {
    for (const entrada of this.nodos.values())
      if (entrada.objeto) this.colorearNodo(entrada);
  }

  /** Aplica una selección: carga lo nuevo, oculta lo que sobra. */
  async actualizar(claves, maxSimultaneas = 4) {
    const quiero = new Set(claves);
    for (const [clave, entrada] of this.nodos) {
      if (!quiero.has(clave) && entrada.objeto) {
        this.grupo.remove(entrada.objeto);
        entrada.objeto.geometry.dispose();
        this.nodos.delete(clave);
      }
    }
    const pendientes = claves.filter((c) => !this.nodos.has(c));
    const lote = pendientes.slice(0, maxSimultaneas);
    await Promise.all(
      lote.map(async (clave) => {
        this.nodos.set(clave, { cargando: true });
        try {
          const entrada = await this.cargarNodo(clave);
          if (!this.activa) return;
          this.nodos.set(clave, entrada);
          this.grupo.add(entrada.objeto);
        } catch (error) {
          console.warn('[Mapa LiDAR] nodo', clave, error);
          this.nodos.delete(clave);
        }
      }),
    );
    return pendientes.length - lote.length;
  }

  cerrar() {
    this.activa = false;
    for (const entrada of this.nodos.values()) {
      if (entrada.objeto) entrada.objeto.geometry.dispose();
    }
    this.nodos.clear();
    this.escena.remove(this.grupo);
  }
}

const HIJOS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

export { material as materialPuntos };
