import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CapaCopc, materialPuntos } from './capaCopc.js';
import { CapaTerreno, uniformesTerreno } from './capaTerreno.js';

/** Escena 3D: cámara con Z arriba, controles orbitales y bucle de LOD. */
export class Escena {
  constructor(lienzo, estado) {
    this.estado = estado;
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dfeaf4');
    this.camara = new THREE.PerspectiveCamera(55, 1, 0.5, 200000);
    this.camara.up.set(0, 0, 1);
    this.camara.position.set(0, -1500, 1200);
    this.controles = new OrbitControls(this.camara, lienzo);
    this.controles.enableDamping = true;
    this.controles.screenSpacePanning = false;
    this.controles.maxPolarAngle = Math.PI * 0.495;
    this.controles.addEventListener('change', () => this.pedirLod());
    this.bloques = new Map(); // id → { zona, bloque } activos
    this.capas = new Map(); // id → CapaCopc (nube de puntos)
    this.terrenos = new Map(); // id → CapaTerreno
    this.origen = null;
    this.lodPendiente = true;
    this.ocupado = false;
    this.alCambiar = () => {};
    window.addEventListener('resize', () => this.redimensionar());
    this.redimensionar();
    this.renderer.setAnimationLoop(() => this.fotograma());
  }

  redimensionar() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / Math.max(1, h);
    this.camara.updateProjectionMatrix();
    this.pedirLod();
  }

  pedirLod() {
    this.lodPendiente = true;
  }

  get proyeccion() {
    const h = this.renderer.domElement.clientHeight;
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camara.fov) / 2));
  }

  fotograma() {
    if (this.pausa) return; // el mapa de selección tapa la vista 3D
    this.controles.update();
    materialPuntos.uniforms.tamano.value = this.estado.tamanoPunto;
    materialPuntos.uniforms.escala.value = this.proyeccion * 0.35;
    if (this.lodPendiente && !this.ocupado) this.lod();
    this.renderer.render(this.scene, this.camara);
  }

  async lod() {
    this.lodPendiente = false;
    this.ocupado = true;
    try {
      const h = this.renderer.domElement.clientHeight;
      const capas = [...this.capas.values()];
      const presupuesto = this.estado.presupuesto / Math.max(1, capas.length);
      let faltan = 0;
      let puntos = 0;
      for (const capa of capas) {
        const { claves, puntos: p } = capa.seleccionar(this.camara, h, presupuesto);
        puntos += p;
        faltan += await capa.actualizar(claves);
      }
      this.estado.puntosVisibles = puntos;
      if (faltan > 0) this.lodPendiente = true;
      this.alCambiar();
    } finally {
      this.ocupado = false;
    }
  }

  /** ¿Qué se dibuja de un bloque según la vista elegida y lo que tiene disponible? */
  tipoPara(bloque) {
    if (!bloque.terreno) return 'puntos';
    if (!bloque.url) return 'terreno';
    return this.estado.vista === 'puntos' ? 'puntos' : 'terreno';
  }

  async activar(zona, bloque) {
    const id = `${zona.id}/${bloque.id}`;
    if (this.bloques.has(id)) return;
    this.bloques.set(id, { zona, bloque });
    try {
      await this.prepararBloque(id);
    } catch (error) {
      this.desactivar(zona, bloque);
      throw error;
    }
    this.coserBordes();
    this.actualizarRango();
  }

  /** Crea, muestra u oculta las capas de un bloque según la vista actual. */
  async prepararBloque(id) {
    const { bloque } = this.bloques.get(id);
    const tipo = this.tipoPara(bloque);
    if (tipo === 'terreno') {
      this.cerrarPuntos(id);
      let t = this.terrenos.get(id);
      if (!t) {
        t = new CapaTerreno({
          url: new URL(bloque.terreno, window.location.href).href,
          nombre: bloque.nombre,
          origen: this.origen || [0, 0, 0],
          escena: this.scene,
        });
        await t.abrir();
        const primero = !this.origen;
        if (primero) {
          const [x0, y0, x1, y1] = t.extension;
          this.origen = [(x0 + x1) / 2, (y0 + y1) / 2, t.rango('mdt').zMin];
          t.origen = this.origen;
        }
        this.terrenos.set(id, t);
        await t.mostrar(this.estado.superficie);
        if (primero) this.encuadrarTerreno(t);
      } else {
        await t.mostrar(this.estado.superficie);
      }
      t.visible = true;
      if (uniformesTerreno.modo.value === 3) this.asegurarOrto();
    } else {
      const t = this.terrenos.get(id);
      if (t) t.visible = false;
      if (this.capas.has(id)) return;
      const capa = new CapaCopc({
        url: new URL(bloque.url, window.location.href).href,
        nombre: bloque.nombre,
        origen: this.origen || [0, 0, 0],
        escena: this.scene,
        estado: this.estado,
      });
      await capa.abrir();
      if (!this.origen) {
        // Primer bloque: fija el origen local para no perder precisión.
        const [x0, y0, z0, x1, y1] = capa.cubo;
        this.origen = [(x0 + x1) / 2, (y0 + y1) / 2, z0];
        capa.origen = this.origen;
        this.encuadrar(capa);
      }
      const [, , z0] = capa.copc.header.min;
      const [, , z1] = capa.copc.header.max;
      this.estado.zMin = Math.min(this.estado.zMin ?? z0, z0);
      this.estado.zMax = Math.max(this.estado.zMax ?? z1, z1);
      this.capas.set(id, capa);
      capa.recolorear();
      this.pedirLod();
    }
  }

  cerrarPuntos(id) {
    const capa = this.capas.get(id);
    if (!capa) return;
    capa.cerrar();
    this.capas.delete(id);
    this.pedirLod();
  }

  /** Cambia entre terreno y puntos, o entre MDT y MDS, en todos los bloques activos. */
  async aplicarVista() {
    for (const id of this.bloques.keys()) await this.prepararBloque(id);
    this.coserBordes();
    this.actualizarRango();
    this.alCambiar();
  }

  /**
   * Junta cada bloque de terreno visible con sus vecinos (misma resolución y
   * bordes que coinciden) para que no se vean grietas ni saltos en las curvas.
   */
  coserBordes() {
    const visibles = [...this.terrenos.entries()].filter(([, t]) => t.mostrado && t.datos);
    const casi = (a, b) => Math.abs(a - b) < 1e-3;
    for (const [id, t] of visibles) {
      const [x0, y0, x1, y1] = t.extension;
      const res = t.meta.resolucion;
      const vecinos = {};
      for (const [id2, u] of visibles) {
        if (id2 === id || !casi(u.meta.resolucion, res)) continue;
        const [a0, b0, a1, b1] = u.extension;
        const dx = casi(a1, x0) ? -1 : casi(a0, x1) ? 1 : casi(a0, x0) && casi(a1, x1) ? 0 : null;
        const dy = casi(b1, y0) ? -1 : casi(b0, y1) ? 1 : casi(b0, y0) && casi(b1, y1) ? 0 : null;
        if (dx === null || dy === null || (dx === 0 && dy === 0)) continue;
        vecinos[`${dx},${dy}`] = { id: id2, capa: u };
      }
      const firma = Object.entries(vecinos)
        .map(([k, v]) => `${k}=${v.id}:${v.capa.superficie}`)
        .sort()
        .join('|');
      t.componer((dx, dy) => vecinos[`${dx},${dy}`]?.capa || null, firma);
    }
  }

  /** Carga la ortofoto de los bloques de terreno visibles (modo «Ortofoto»). */
  async asegurarOrto() {
    const errores = [];
    await Promise.all(
      [...this.terrenos.values()]
        .filter((t) => t.mostrado && t.meta)
        .map((t) => t.cargarOrto()?.catch((e) => errores.push(e))),
    );
    if (errores.length) this.alErrorOrto?.(errores.length);
  }

  /** Rango de la rampa hipsométrica: común a todos los bloques de terreno visibles. */
  actualizarRango() {
    let bajo = Infinity;
    let alto = -Infinity;
    for (const t of this.terrenos.values()) {
      if (!t.mostrado) continue;
      const r = t.rango(this.estado.superficie);
      bajo = Math.min(bajo, r.p02);
      alto = Math.max(alto, r.p98);
    }
    const m = this.estado.rangoManual;
    if (m && m.max > m.min) {
      uniformesTerreno.zBajo.value = m.min;
      uniformesTerreno.zAlto.value = m.max;
    } else if (Number.isFinite(bajo)) {
      uniformesTerreno.zBajo.value = bajo;
      uniformesTerreno.zAlto.value = Math.max(alto, bajo + 1);
    }
    this.estado.hayTerreno = Number.isFinite(bajo);
  }

  desactivar(zona, bloque) {
    const id = `${zona.id}/${bloque.id}`;
    this.cerrarPuntos(id);
    this.terrenos.get(id)?.cerrar();
    this.terrenos.delete(id);
    this.bloques.delete(id);
    this.coserBordes();
    if (!this.bloques.size) {
      this.origen = null;
      this.estado.zMin = undefined;
      this.estado.zMax = undefined;
    }
    this.actualizarRango();
    this.pedirLod();
  }

  /** Encuadra la unión de varios bloques de terreno. */
  encuadrarTerrenos(lista) {
    const ext = [Infinity, Infinity, -Infinity, -Infinity];
    let zBajo = Infinity;
    for (const t of lista) {
      const [x0, y0, x1, y1] = t.extension;
      ext[0] = Math.min(ext[0], x0);
      ext[1] = Math.min(ext[1], y0);
      ext[2] = Math.max(ext[2], x1);
      ext[3] = Math.max(ext[3], y1);
      zBajo = Math.min(zBajo, t.rango(this.estado.superficie).p02);
    }
    const o = this.origen;
    const cx = (ext[0] + ext[2]) / 2 - o[0];
    const cy = (ext[1] + ext[3]) / 2 - o[1];
    const cz = (zBajo - o[2]) * uniformesTerreno.exag.value;
    const lado = Math.max(ext[2] - ext[0], ext[3] - ext[1]);
    this.controles.target.set(cx, cy, cz);
    this.camara.position.set(cx, cy - lado * 0.8, cz + lado * 0.75);
    this.pedirLod();
  }

  encuadrarTerreno(t) {
    const [x0, y0, x1, y1] = t.extension;
    const o = this.origen;
    const cx = (x0 + x1) / 2 - o[0];
    const cy = (y0 + y1) / 2 - o[1];
    const r = t.rango(this.estado.superficie);
    const cz = (r.p02 - o[2]) * uniformesTerreno.exag.value;
    const lado = Math.max(x1 - x0, y1 - y0);
    this.controles.target.set(cx, cy, cz);
    this.camara.position.set(cx, cy - lado * 0.8, cz + lado * 0.75);
    this.pedirLod();
  }

  encuadrar(capa) {
    const [x0, y0, z0, x1, y1] = capa.cubo;
    const o = this.origen;
    const cx = (x0 + x1) / 2 - o[0];
    const cy = (y0 + y1) / 2 - o[1];
    const cz = capa.copc.header.min[2] - o[2];
    const lado = x1 - x0;
    this.controles.target.set(cx, cy, cz);
    this.camara.position.set(cx, cy - lado * 0.9, cz + lado * 0.7);
    this.pedirLod();
  }

  encuadrarTodo() {
    const terrenos = [...this.terrenos.values()].filter((t) => t.mostrado && t.meta);
    if (terrenos.length) return this.encuadrarTerrenos(terrenos);
    const primera = this.capas.values().next().value;
    if (primera) this.encuadrar(primera);
  }

  recolorear() {
    for (const capa of this.capas.values()) capa.recolorear();
  }

  /** Rumbo de la vista en grados (0 = mirando al norte, 90 = al este). */
  rumbo() {
    const d = this.controles.target.clone().sub(this.camara.position);
    return (THREE.MathUtils.radToDeg(Math.atan2(d.x, d.y)) + 360) % 360;
  }

  /** Gira la cámara alrededor del objetivo para mirar al norte, sin cambiar distancia ni inclinación. */
  orientarNorte() {
    const t = this.controles.target;
    const v = this.camara.position.clone().sub(t);
    const h = Math.hypot(v.x, v.y);
    this.camara.position.set(t.x, t.y - h, this.camara.position.z);
    this.pedirLod();
  }

  /** Zoom sin rueda: acerca/aleja un factor hacia el objetivo. */
  zoom(factor) {
    const t = this.controles.target;
    const v = this.camara.position.clone().sub(t).multiplyScalar(factor);
    if (v.length() < 5 && factor < 1) return;
    this.camara.position.copy(t).add(v);
    this.pedirLod();
  }

  /** Giro sin arrastrar: rota la cámara alrededor del objetivo (grados). */
  girar(grados) {
    const t = this.controles.target;
    const v = this.camara.position.clone().sub(t);
    v.applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(grados));
    this.camara.position.copy(t).add(v);
    this.pedirLod();
  }

  /** Inclinación: sube o baja la cámara manteniendo la distancia. */
  inclinar(grados) {
    const t = this.controles.target;
    const v = this.camara.position.clone().sub(t);
    const r = v.length();
    const horizontal = Math.hypot(v.x, v.y);
    let ang = Math.atan2(v.z, horizontal) + THREE.MathUtils.degToRad(grados);
    ang = Math.min(THREE.MathUtils.degToRad(89), Math.max(THREE.MathUtils.degToRad(3), ang));
    const k = horizontal > 1e-6 ? (r * Math.cos(ang)) / horizontal : 0;
    this.camara.position.set(t.x + v.x * k, t.y + v.y * k, t.z + r * Math.sin(ang));
    this.pedirLod();
  }
}
