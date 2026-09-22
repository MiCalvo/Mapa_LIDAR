import { utmAGeo, geoAUtm, husoDe, meridianoCentral } from '../geo/utm.js';
import { abrirAyudaManual } from './manual.js';

/**
 * Mapa de selección por cuadrantes UTM: Península → celdas de 100 km →
 * celdas de 10 km → bloques de 2 km. Mapa base OpenStreetMap (con internet).
 * Todo se maneja con toques y botones (sin rueda).
 */

const TESELAS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TAM = 256;
const HUSOS = [29, 30, 31];
const IBERIA = { lat0: 35.8, lat1: 44.1, lon0: -10.4, lon1: 3.6 };

export const COLOR_ESTADO = {
  listo: '#2e9d62',
  parcial: '#8cc152',
  descargado: '#e8a33d',
  disponible: '#3d85c6',
  'sin-enlace': '#a3adb8',
  'sin-datos': '#d6dde5',
};
export const TEXTO_ESTADO = {
  listo: 'Terreno listo',
  parcial: 'Terreno parcial',
  descargado: 'Descargado, sin procesar',
  disponible: 'Se puede descargar',
  'sin-enlace': 'En catálogo, enlace no disponible',
  'sin-datos': 'Sin descarga automática',
};

const rad = Math.PI / 180;
const mundoX = (lon, z) => ((lon + 180) / 360) * TAM * 2 ** z;
const mundoY = (lat, z) =>
  ((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2) * TAM * 2 ** z;
const lonDeX = (x, z) => (x / (TAM * 2 ** z)) * 360 - 180;
const latDeY = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / (TAM * 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class MapaSelector {
  constructor({ lienzo, panel, alCargar3D, alAviso, alIr3D, alIrMapa, alCambioSeleccion }) {
    this.alIr3D = alIr3D || (() => {});
    this.alIrMapa = alIrMapa || (() => {});
    this.alCambioSeleccion = alCambioSeleccion || (() => {});
    this.lienzo = lienzo;
    this.ctx = lienzo.getContext('2d');
    this.panel = panel;
    this.alCargar3D = alCargar3D;
    this.alAviso = alAviso || (() => {});
    this.vista = { lat: 40.2, lon: -3.7, z: 5.6 };
    this.nivel = { tipo: 'peninsula' };
    this.celdas = new Map(); // `${huso}_${x}_${y}` (10 km) → recuento
    this.celdas100 = new Map();
    this.bloques = []; // bloques de la celda de 10 km actual
    this.seleccion = new Map(); // clave → bloque
    this.trabajos = [];
    this.sistema = null;
    this.catalogos = {};
    this.cnig = '';
    this.teselas = new Map();
    this.zonasClic = [];
    this.animacion = null;
    this.activo = false;
    this.pendiente = true;
    this.modoArea = false; // arrastrar dibuja un rectángulo de selección
    this.rectPantalla = null; // rectángulo que se está dibujando
    this.area = null; // { huso, x0, y0, x1, y1 } en km, ya ajustado a bloques
    this.tabla = null; // { bloques } del área
    this.marca = null; // lugar buscado { lat, lon, nombre }
    this.montarPanel();
    this.capasEl = document.createElement('nav');
    this.capasEl.className = 'capas vidrio';
    this.capasEl.setAttribute('aria-label', 'Nivel del mapa');
    this.capasEl.hidden = true;
    document.body.append(this.capasEl);
    this.ultimo10 = null; // última celda de 10 km visitada
    window.addEventListener('keydown', (e) => {
      if (!this.activo || /input|textarea/i.test(e.target?.tagName || '')) return;
      if (e.key === 'ArrowUp') this.subirNivel();
      else if (e.key === 'ArrowDown') this.bajarNivel();
      else return;
      e.preventDefault();
    });
    this.tablaEl = document.createElement('section');
    this.tablaEl.className = 'tabla-area vidrio';
    this.tablaEl.hidden = true;
    document.body.append(this.tablaEl);
    this.instalarEventos();
    this.pintarPanel();
    const bucle = () => {
      if (this.activo && (this.pendiente || this.animacion)) this.dibujar();
      requestAnimationFrame(bucle);
    };
    requestAnimationFrame(bucle);
  }

  // ------------------------------------------------------------------ datos
  async refrescar() {
    try {
      const resp = await fetch('/api/mapa/resumen');
      if (!(resp.headers.get('content-type') || '').includes('json')) {
        this.catalogos = { aviso: 'el servidor es de una versión anterior' };
        this.alAviso('El servidor que está en marcha es de una versión anterior. Cierra la app con Detener.bat y ábrela de nuevo.');
        this.pintarPanel();
        return;
      }
      const r = await resp.json();
      this.catalogos = r.catalogos || {};
      this.cnig = r.cnig || '';
      this.celdas.clear();
      this.celdas100.clear();
      for (const c of r.celdas || []) {
        this.celdas.set(`${c.huso}_${c.x}_${c.y}`, c);
        const k = `${c.huso}_${Math.floor(c.x / 100) * 100}_${Math.floor(c.y / 100) * 100}`;
        const a = this.celdas100.get(k) || { listo: 0, parcial: 0, descargado: 0, disponible: 0, sinEnlace: 0 };
        for (const p of Object.keys(a)) a[p] += c[p] || 0;
        this.celdas100.set(k, a);
      }
      if (this.nivel.tipo === 'celda10') await this.cargarBloques();
      if (this.tabla) await this.cargarArea();
      const cargando = Object.values(this.catalogos).some((e) => /cargando|pendiente/.test(e));
      clearTimeout(this.tCatalogo);
      if (cargando) this.tCatalogo = setTimeout(() => this.refrescar(), 2000);
    } catch (error) {
      this.alAviso(`No se pudo leer el catálogo: ${error}`);
    }
    this.pendiente = true;
    this.pintarPanel();
  }

  async cargarBloques() {
    const { huso, x, y } = this.nivel;
    // La celda de 10 km y sus 8 vecinas (30×30 km): las de fuera se ven atenuadas pero se pueden elegir.
    const r = await (
      await fetch(`/api/mapa/bloques?huso=${huso}&x0=${x - 10}&y0=${y - 10}&x1=${x + 20}&y1=${y + 20}`)
    ).json();
    if (this.nivel.tipo !== 'celda10' || this.nivel.x !== x || this.nivel.y !== y) return; // se cambió de celda
    this.bloques = r.bloques || [];
    // Actualiza los datos de los bloques seleccionados que estén a la vista.
    for (const b of this.bloques) {
      const k = `${b.huso}_${b.x}_${b.y}`;
      if (this.seleccion.has(k)) this.seleccion.set(k, b);
    }
    this.pendiente = true;
    this.pintarPanel();
  }

  async sondearTrabajos() {
    try {
      const { trabajos } = await (await fetch('/api/mapa/trabajos')).json();
      const antes = this.trabajos.filter((t) => !['hecho', 'error'].includes(t.estado)).length;
      this.trabajos = trabajos || [];
      const ahora = this.trabajos.filter((t) => !['hecho', 'error'].includes(t.estado)).length;
      if (ahora < antes || (antes && !ahora)) {
        await this.refrescar();
        await this.refrescarSeleccion();
      } else if (ahora && this.tabla) await this.cargarArea();
      this.pintarPanel();
      clearTimeout(this.tTrabajos);
      if (ahora) this.tTrabajos = setTimeout(() => this.sondearTrabajos(), 1500);
    } catch {
      /* se reintenta en la próxima acción */
    }
  }

  /** Relee el estado de los bloques seleccionados (p. ej. tras una descarga). */
  async refrescarSeleccion() {
    const sel = [...this.seleccion.values()];
    if (!sel.length) return;
    const huso = sel[0].huso;
    const x0 = Math.min(...sel.map((b) => b.x));
    const y0 = Math.min(...sel.map((b) => b.y));
    const x1 = Math.max(...sel.map((b) => b.x)) + 2;
    const y1 = Math.max(...sel.map((b) => b.y)) + 2;
    try {
      const d = await (await fetch(`/api/mapa/bloques?huso=${huso}&x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}`)).json();
      for (const b of d.bloques || []) {
        const k = `${b.huso}_${b.x}_${b.y}`;
        if (this.seleccion.has(k)) this.seleccion.set(k, b);
      }
    } catch {
      /* se reintenta en el próximo sondeo */
    }
    this.pendiente = true;
    this.pintarPanel();
  }

  /** Encola descargas o procesados de unos bloques concretos. */
  async trabajar(accion, bloques) {
    await fetch('/api/mapa/trabajos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, bloques: bloques.map(({ huso, x, y }) => ({ huso, x, y })) }),
    });
    await this.sondearTrabajos();
    await this.refrescarSeleccion();
  }

  async comprobarSistema(recomprobar = false) {
    try {
      this.sistema = await (await fetch(`/api/sistema${recomprobar ? '?recomprobar' : ''}`)).json();
    } catch {
      this.sistema = null;
    }
    this.pintarPanel();
  }

  // ------------------------------------------------------------------ vista
  abrir() {
    this.activo = true;
    this.lienzo.hidden = false;
    this.panel.hidden = false;
    this.tablaEl.hidden = !this.tabla;
    this.capasEl.hidden = false;
    this.pintarCapas();
    this.redimensionar();
    this.refrescar();
    this.sondearTrabajos();
    if (!this.sistema) this.comprobarSistema();
  }

  cerrar() {
    this.activo = false;
    this.lienzo.hidden = true;
    this.panel.hidden = true;
    this.tablaEl.hidden = true;
    this.pintarCapas(); // la capa «3D» pasa a ser la actual
  }

  redimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = this.lienzo;
    this.lienzo.width = Math.round(w * dpr);
    this.lienzo.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.pendiente = true;
  }

  /** Zona útil de la pantalla (el panel derecho tapa parte). */
  get util() {
    const w = this.lienzo.clientWidth;
    const h = this.lienzo.clientHeight;
    const derecha = w > 900 ? 360 : 0;
    // Con la tabla del área abierta, el mapa útil queda por encima de ella.
    const abajo = this.tabla && this.tablaEl && !this.tablaEl.hidden ? this.tablaEl.offsetHeight + 16 : 0;
    return { x0: 16, y0: 80, x1: w - derecha - 16, y1: Math.max(200, h - abajo - 16) };
  }

  aPantalla(lat, lon, v = this.vista) {
    const u = this.util;
    const cx = (u.x0 + u.x1) / 2;
    const cy = (u.y0 + u.y1) / 2;
    return [mundoX(lon, v.z) - mundoX(v.lon, v.z) + cx, mundoY(lat, v.z) - mundoY(v.lat, v.z) + cy];
  }

  /** Pantalla → [lat, lon]. */
  deAPantalla(sx, sy, v = this.vista) {
    const u = this.util;
    const cx = (u.x0 + u.x1) / 2;
    const cy = (u.y0 + u.y1) / 2;
    return [latDeY(mundoY(v.lat, v.z) + (sy - cy), v.z), lonDeX(mundoX(v.lon, v.z) + (sx - cx), v.z)];
  }

  deUtm(huso, E, N) {
    const [lat, lon] = utmAGeo(E, N, huso);
    return this.aPantalla(lat, lon);
  }

  /** Rectángulo UTM (km) → polígono en pantalla (lados subdivididos: la cuadrícula se curva). */
  poligono(huso, x0, y0, x1, y1, pasos = 4) {
    const p = [];
    const lado = (xa, ya, xb, yb) => {
      for (let i = 0; i < pasos; i += 1) {
        const t = i / pasos;
        p.push(this.deUtm(huso, (xa + (xb - xa) * t) * 1000, (ya + (yb - ya) * t) * 1000));
      }
    };
    lado(x0, y0, x1, y0);
    lado(x1, y0, x1, y1);
    lado(x1, y1, x0, y1);
    lado(x0, y1, x0, y0);
    return p;
  }

  /** Vuela hasta encuadrar un rectángulo UTM (km). */
  volarA(huso, x0, y0, x1, y1, margen = 0.12) {
    const [la0, lo0] = utmAGeo(x0 * 1000, y0 * 1000, huso);
    const [la1, lo1] = utmAGeo(x1 * 1000, y1 * 1000, huso);
    const [la2, lo2] = utmAGeo(x0 * 1000, y1 * 1000, huso);
    const [la3, lo3] = utmAGeo(x1 * 1000, y0 * 1000, huso);
    this.volarAGeo(
      Math.min(la0, la1, la2, la3),
      Math.min(lo0, lo1, lo2, lo3),
      Math.max(la0, la1, la2, la3),
      Math.max(lo0, lo1, lo2, lo3),
      margen,
    );
  }

  volarAGeo(lat0, lon0, lat1, lon1, margen = 0.08) {
    const u = this.util;
    const w = (u.x1 - u.x0) * (1 - 2 * margen);
    const h = (u.y1 - u.y0) * (1 - 2 * margen);
    const z0 = 0;
    const dx = mundoX(lon1, z0) - mundoX(lon0, z0);
    const dy = mundoY(lat0, z0) - mundoY(lat1, z0);
    const z = Math.min(17, Math.log2(Math.min(w / dx, h / dy)));
    const cy = latDeY((mundoY(lat0, z0) + mundoY(lat1, z0)) / 2, z0);
    const cx = lonDeX((mundoX(lon0, z0) + mundoX(lon1, z0)) / 2, z0);
    this.animacion = { desde: { ...this.vista }, hasta: { lat: cy, lon: cx, z }, t0: performance.now(), dur: 750 };
  }

  zoom(factor) {
    this.animacion = null;
    this.vista.z = Math.max(3, Math.min(17, this.vista.z + Math.log2(factor)));
    this.pendiente = true;
  }

  // ------------------------------------------------------------------ navegación
  irA(nivel) {
    this.nivel = nivel;
    if (nivel.tipo === 'peninsula') {
      this.volarAGeo(IBERIA.lat0, IBERIA.lon0, IBERIA.lat1, IBERIA.lon1, 0.03);
    } else if (nivel.tipo === 'celda100') {
      this.volarA(nivel.huso, nivel.x, nivel.y, nivel.x + 100, nivel.y + 100);
    } else {
      this.ultimo10 = { huso: nivel.huso, x: nivel.x, y: nivel.y };
      this.volarA(nivel.huso, nivel.x, nivel.y, nivel.x + 10, nivel.y + 10);
      this.bloques = [];
      this.cargarBloques();
    }
    this.pendiente = true;
    this.pintarPanel();
    this.pintarCapas();
  }

  /** Celda (100 o 10 km) bajo un punto; si hay datos en el huso 30 (CyL al oeste de −6°) se prefiere ese. */
  celdaEn(lat, lon, km) {
    const candidatos = [husoDe(lon)];
    if (!candidatos.includes(30) && lon > -9.5 && lon < 3.5) candidatos.push(30);
    let elegida = null;
    for (const huso of candidatos) {
      const [E, N] = geoAUtm(lat, lon, huso);
      const x = Math.floor(E / (km * 1000)) * km;
      const y = Math.floor(N / (km * 1000)) * km;
      const mapa = km === 100 ? this.celdas100 : this.celdas;
      const c = mapa.get(`${huso}_${x}_${y}`);
      const conDatos = c && c.listo + c.parcial + c.descargado + c.disponible > 0;
      if (!elegida || conDatos) elegida = { huso, x, y };
      if (conDatos) break;
    }
    return elegida;
  }

  subirNivel() {
    if (!this.activo) return this.alIrMapa();
    if (this.nivel.tipo !== 'peninsula') this.atras();
    return undefined;
  }

  bajarNivel() {
    const n = this.nivel;
    if (!this.activo) return undefined;
    if (n.tipo === 'celda10') return this.alIr3D();
    if (n.tipo === 'peninsula') {
      this.irA({ tipo: 'celda100', ...this.celdaEn(this.vista.lat, this.vista.lon, 100) });
    } else if (n.tipo === 'celda100') {
      const u = this.ultimo10;
      if (u && u.huso === n.huso && Math.floor(u.x / 100) * 100 === n.x && Math.floor(u.y / 100) * 100 === n.y) {
        this.irA({ tipo: 'celda10', ...u });
        return;
      }
      // La celda de 10 km con más datos; si no hay, la del centro.
      let mejor = null;
      for (const c of this.celdas.values()) {
        if (c.huso !== n.huso || c.x < n.x || c.x >= n.x + 100 || c.y < n.y || c.y >= n.y + 100) continue;
        const peso = 4 * (c.listo + c.parcial) + 2 * c.descargado + c.disponible;
        if (peso && (!mejor || peso > mejor.peso)) mejor = { peso, x: c.x, y: c.y };
      }
      this.irA({ tipo: 'celda10', huso: n.huso, x: mejor ? mejor.x : n.x + 50, y: mejor ? mejor.y : n.y + 50 });
    }
  }

  irANivel(tipo) {
    if (tipo === '3d') return this.alIr3D();
    if (!this.activo) {
      this.alIrMapa();
      if (tipo === this.nivel.tipo) return undefined;
    }
    const orden = ['peninsula', 'celda100', 'celda10'];
    let actual = orden.indexOf(this.nivel.tipo);
    const destino = orden.indexOf(tipo);
    if (destino < actual) {
      if (tipo === 'peninsula') this.irA({ tipo: 'peninsula' });
      else this.atras();
      return;
    }
    while (actual < destino) {
      this.bajarNivel();
      actual += 1;
    }
    return undefined;
  }

  pintarCapas() {
    const el = this.capasEl;
    if (!el) return;
    const niveles = [
      { tipo: 'peninsula', texto: 'Península', sub: 'husos y 100 km' },
      { tipo: 'celda100', texto: '100 km', sub: 'celdas de 10 km' },
      { tipo: 'celda10', texto: '10 km', sub: 'bloques de 2 km' },
      { tipo: '3d', texto: '3D', sub: 'terreno elegido' },
    ];
    const i = this.activo ? niveles.findIndex((n) => n.tipo === this.nivel.tipo) : 3;
    const capa = (n, k) => {
      const actual = k === i;
      const y = 4 + k * 28;
      const dx = actual ? 14 : 0;
      return `<g class="capa ${actual ? 'actual' : ''}" data-nivel="${n.tipo}" transform="translate(${dx},${y})" role="button" tabindex="0" aria-label="${n.texto}">
        <polygon points="22,0 86,0 64,22 0,22" />
        <text x="100" y="10">${n.texto}</text><text class="sub" x="100" y="21">${n.sub}</text></g>`;
    };
    // De abajo arriba: la capa superior tapa a la de debajo.
    el.innerHTML = `<svg viewBox="0 0 210 114" width="210" height="114">${niveles
      .map((n, k) => [n, k])
      .reverse()
      .map(([n, k]) => capa(n, k))
      .join('')}</svg>
      <div class="flechas"><button data-f="arriba" title="Nivel superior (↑)" ${i === 0 ? 'disabled' : ''}>▲</button><button data-f="abajo" title="Nivel inferior (↓)" ${i === 3 ? 'disabled' : ''}>▼</button></div>`;
    el.querySelectorAll('[data-nivel]').forEach((g) => {
      g.addEventListener('click', () => this.irANivel(g.dataset.nivel));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') this.irANivel(g.dataset.nivel);
      });
    });
    el.querySelector('[data-f=arriba]').addEventListener('click', () => this.subirNivel());
    el.querySelector('[data-f=abajo]').addEventListener('click', () => this.bajarNivel());
  }

  atras() {
    const n = this.nivel;
    if (n.tipo === 'celda10') {
      this.irA({ tipo: 'celda100', huso: n.huso, x: Math.floor(n.x / 100) * 100, y: Math.floor(n.y / 100) * 100 });
    } else if (n.tipo === 'celda100') this.irA({ tipo: 'peninsula' });
  }

  /** ¿El bloque está lejos (otro huso o a más de 20 km) de lo ya seleccionado? */
  lejosDeLaSeleccion(b) {
    for (const o of this.seleccion.values()) {
      if (o.huso !== b.huso || Math.max(Math.abs(o.x - b.x), Math.abs(o.y - b.y)) > 20) return true;
    }
    return false;
  }

  vaciarSeleccion() {
    this.seleccion.clear();
    this.area = null;
    this.tabla = null;
    this.tablaEl.hidden = true;
  }

  alternar(b) {
    const k = `${b.huso}_${b.x}_${b.y}`;
    if (this.seleccion.has(k)) {
      this.seleccion.delete(k);
    } else {
      // Solo se trabaja con una zona a la vez: lo que se seleccione lejos empieza una selección nueva.
      if (this.lejosDeLaSeleccion(b)) {
        this.vaciarSeleccion();
        this.alAviso('Zona nueva: se ha vaciado la selección anterior.');
      }
      this.seleccion.set(k, b);
    }
    this.pendiente = true;
    this.pintarPanel();
  }

  // ------------------------------------------------------------------ eventos
  instalarEventos() {
    let arrastre = null;
    this.lienzo.addEventListener('pointerdown', (e) => {
      this.lienzo.setPointerCapture(e.pointerId);
      this.animacion = null;
      if (this.modoArea) {
        this.rectPantalla = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
        arrastre = { area: true };
        return;
      }
      arrastre = { x: e.clientX, y: e.clientY, lat: this.vista.lat, lon: this.vista.lon, movido: false };
    });
    this.lienzo.addEventListener('pointermove', (e) => {
      if (!arrastre) return;
      if (arrastre.area) {
        this.rectPantalla.x1 = e.offsetX;
        this.rectPantalla.y1 = e.offsetY;
        this.pendiente = true;
        return;
      }
      const dx = e.clientX - arrastre.x;
      const dy = e.clientY - arrastre.y;
      if (Math.hypot(dx, dy) > 5) arrastre.movido = true;
      if (!arrastre.movido) return;
      const z = this.vista.z;
      this.vista.lon = lonDeX(mundoX(arrastre.lon, z) - dx, z);
      this.vista.lat = latDeY(mundoY(arrastre.lat, z) - dy, z);
      this.pendiente = true;
    });
    const soltar = (e) => {
      if (!arrastre) return;
      if (arrastre.area) {
        arrastre = null;
        const r = this.rectPantalla;
        this.rectPantalla = null;
        if (Math.abs(r.x1 - r.x0) > 6 && Math.abs(r.y1 - r.y0) > 6) this.seleccionarArea(r);
        else this.pendiente = true;
        return;
      }
      const clic = !arrastre.movido;
      arrastre = null;
      if (clic) this.clic(e.offsetX, e.offsetY);
    };
    this.lienzo.addEventListener('pointerup', soltar);
    this.lienzo.addEventListener('pointercancel', () => {
      arrastre = null;
      this.rectPantalla = null;
    });
    this.lienzo.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.25 : 0.8);
      },
      { passive: false },
    );
    window.addEventListener('resize', () => this.redimensionar());
  }

  clic(x, y) {
    // Se recorre de arriba abajo: lo último dibujado tiene prioridad.
    for (let i = this.zonasClic.length - 1; i >= 0; i -= 1) {
      const z = this.zonasClic[i];
      if (dentro(z.poli, x, y)) {
        z.accion();
        return;
      }
    }
  }

  // ------------------------------------------------------------------ dibujo
  dibujar() {
    if (this.animacion) {
      const a = this.animacion;
      const t = Math.min(1, (performance.now() - a.t0) / a.dur);
      const k = suave(t);
      this.vista = {
        lat: a.desde.lat + (a.hasta.lat - a.desde.lat) * k,
        lon: a.desde.lon + (a.hasta.lon - a.desde.lon) * k,
        z: a.desde.z + (a.hasta.z - a.desde.z) * k,
      };
      if (t >= 1) this.animacion = null;
    }
    this.pendiente = false;
    const ctx = this.ctx;
    const w = this.lienzo.clientWidth;
    const h = this.lienzo.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#dfeaf4';
    ctx.fillRect(0, 0, w, h);
    this.dibujarTeselas(w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(0, 0, w, h);
    this.zonasClic = [];
    this.zonasClicFinal = [];
    const n = this.nivel;
    if (n.tipo === 'peninsula') this.dibujarPeninsula();
    else if (n.tipo === 'celda100') this.dibujarCelda100(n);
    else this.dibujarCelda10(n);
    this.dibujarArea();
    this.dibujarMarca();
    this.zonasClic.push(...this.zonasClicFinal);
    if (this.rectPantalla) {
      const r = this.rectPantalla;
      ctx.fillStyle = 'rgba(245,158,11,.12)';
      ctx.fillRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.setLineDash([7, 4]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.setLineDash([]);
    }
  }

  /** Bloques del área elegida (los que no se dibujan ya en la celda actual) y su contorno naranja. */
  dibujarArea() {
    if (!this.area) return;
    const ctx = this.ctx;
    const n = this.nivel;
    // Lo que ya se dibuja en el nivel de 10 km (la celda y sus vecinas) no se repite.
    const enCelda = (b) =>
      n.tipo === 'celda10' && b.huso === n.huso && b.x >= n.x - 10 && b.x < n.x + 20 && b.y >= n.y - 10 && b.y < n.y + 20;
    for (const b of this.tabla?.bloques || []) {
      if (enCelda(b)) continue;
      const poli = this.poligono(b.huso, b.x, b.y, b.x + 2, b.y + 2, 1);
      const sel = this.seleccion.has(`${b.huso}_${b.x}_${b.y}`);
      this.trazar(poli);
      ctx.fillStyle = COLOR_ESTADO[b.estado] || COLOR_ESTADO['sin-datos'];
      ctx.globalAlpha = b.estado === 'sin-datos' ? 0.15 : 0.38;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sel ? '#0b2540' : 'rgba(29,52,80,.35)';
      ctx.lineWidth = sel ? 2.5 : 0.8;
      ctx.stroke();
      if (n.tipo === 'celda10') this.zonasClic.push({ poli, accion: () => this.alternar(b) });
    }
    const a = this.area;
    this.trazar(this.poligono(a.huso, a.x0, a.y0, a.x1, a.y1, 6));
    ctx.setLineDash([8, 4]);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  dibujarMarca() {
    if (!this.marca) return;
    const ctx = this.ctx;
    const [x, y] = this.aPantalla(this.marca.lat, this.marca.lon);
    ctx.fillStyle = '#d9344f';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 12, y - 14, x - 9, y - 26, x, y - 26);
    ctx.bezierCurveTo(x + 9, y - 26, x + 12, y - 14, x, y);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y - 17, 3.5, 0, Math.PI * 2);
    ctx.fill();
    this.etiqueta(this.marca.corto, x, y - 38, { tam: 11.5, fondo: 'rgba(217,52,79,.92)', color: '#fff' });
  }

  dibujarTeselas(w, h) {
    const v = this.vista;
    const zi = Math.max(0, Math.min(18, Math.round(v.z)));
    const esc = 2 ** (v.z - zi);
    const u = this.util;
    const cx = (u.x0 + u.x1) / 2;
    const cy = (u.y0 + u.y1) / 2;
    const ox = mundoX(v.lon, zi) - cx / esc;
    const oy = mundoY(v.lat, zi) - cy / esc;
    const n = 2 ** zi;
    const tx0 = Math.floor(ox / TAM);
    const ty0 = Math.max(0, Math.floor(oy / TAM));
    const tx1 = Math.floor((ox + w / esc) / TAM);
    const ty1 = Math.min(n - 1, Math.floor((oy + h / esc) / TAM));
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const x = ((tx % n) + n) % n;
        const img = this.tesela(zi, x, ty);
        const px = (tx * TAM - ox) * esc;
        const py = (ty * TAM - oy) * esc;
        if (img.complete && img.naturalWidth) {
          this.ctx.drawImage(img, px, py, TAM * esc + 0.5, TAM * esc + 0.5);
        }
      }
    }
  }

  tesela(z, x, y) {
    const k = `${z}/${x}/${y}`;
    let img = this.teselas.get(k);
    if (!img) {
      img = new Image();
      img.onload = () => {
        this.pendiente = true;
      };
      img.src = TESELAS.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      this.teselas.set(k, img);
      if (this.teselas.size > 600) this.teselas.delete(this.teselas.keys().next().value);
    }
    return img;
  }

  trazar(poli) {
    const ctx = this.ctx;
    ctx.beginPath();
    poli.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  etiqueta(texto, x, y, { tam = 11, peso = 700, color = '#1d3450', fondo = 'rgba(255,255,255,.8)' } = {}) {
    const ctx = this.ctx;
    ctx.font = `${peso} ${tam}px Nunito, system-ui, sans-serif`;
    const lineas = String(texto).split('\n');
    const ancho = Math.max(...lineas.map((l) => ctx.measureText(l).width)) + 8;
    const alto = lineas.length * (tam + 2) + 4;
    ctx.fillStyle = fondo;
    ctx.beginPath();
    ctx.roundRect(x - ancho / 2, y - alto / 2, ancho, alto, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lineas.forEach((l, i) => ctx.fillText(l, x, y - alto / 2 + 2 + (tam + 2) * (i + 0.5)));
  }

  /** Color de relleno de una celda según lo que contiene. */
  relleno(c, fuerte = false) {
    if (!c) return null;
    const a = fuerte ? 0.5 : 0.35;
    if (c.listo || c.parcial) return `rgba(46,157,98,${a})`;
    if (c.descargado) return `rgba(232,163,61,${a})`;
    if (c.disponible) return `rgba(61,133,198,${a * 0.7})`;
    if (c.sinEnlace) return `rgba(120,130,140,${a * 0.4})`;
    return null;
  }

  dibujarPeninsula() {
    const ctx = this.ctx;
    // Límites de husos (meridianos −6° y 0°).
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(29,52,80,.55)';
    ctx.lineWidth = 1.5;
    for (const lon of [-6, 0]) {
      const [xa, ya] = this.aPantalla(44.5, lon);
      const [xb, yb] = this.aPantalla(35.5, lon);
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const huso of HUSOS) {
      const [x, y] = this.aPantalla(43.95, meridianoCentral(huso) + 1.5);
      this.etiqueta(`Huso ${huso}`, x, y, { tam: 12, fondo: 'rgba(29,52,80,.85)', color: '#fff' });
    }
    for (const huso of HUSOS) {
      const cm = meridianoCentral(huso);
      // Franja del huso, para recortar la cuadrícula (las de husos vecinos se solapan).
      const franja = [];
      for (let lat = 35; lat <= 44.6; lat += 0.4) franja.push(this.aPantalla(lat, cm - 3));
      for (let lat = 44.6; lat >= 35; lat -= 0.4) franja.push(this.aPantalla(lat, cm + 3));
      for (let x = 0; x < 1000; x += 100) {
        for (let y = 3900; y < 4900; y += 100) {
          const c = this.celdas100.get(`${huso}_${x}_${y}`);
          const [lat, lon] = utmAGeo((x + 50) * 1000, (y + 50) * 1000, huso);
          const enHuso = lon >= cm - 3 && lon < cm + 3;
          const enIberia =
            lat > IBERIA.lat0 && lat < IBERIA.lat1 && lon > IBERIA.lon0 && lon < IBERIA.lon1;
          const conDatos = c && (c.listo || c.parcial || c.descargado || c.disponible || c.sinEnlace);
          if (!(conDatos || (enHuso && enIberia))) continue;
          const poli = this.poligono(huso, x, y, x + 100, y + 100, 3);
          ctx.save();
          if (enHuso) {
            this.trazar(franja);
            ctx.clip();
          }
          this.trazar(poli);
          const f = this.relleno(c);
          if (f) {
            ctx.fillStyle = f;
            ctx.fill();
          }
          ctx.setLineDash(enHuso ? [] : [3, 3]);
          ctx.strokeStyle = 'rgba(29,52,80,.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
          const lejosDelBorde = lon > cm - 2.6 && lon < cm + 2.6;
          if (this.vista.z > 6.2 && (lejosDelBorde || (conDatos && !enHuso))) {
            const [px, py] = this.deUtm(huso, (x + 50) * 1000, (y + 50) * 1000);
            const n = (c?.listo || 0) + (c?.parcial || 0);
            const extra = n ? `\n${n} ${n === 1 ? 'listo' : 'listos'}` : '';
            this.etiqueta(`${x}·${y}${extra}`, px, py, { tam: 9.5, peso: 600, fondo: 'rgba(255,255,255,.55)' });
          }
          this.zonasClic.push({ poli, accion: () => this.irA({ tipo: 'celda100', huso, x, y }) });
        }
      }
    }
  }

  dibujarCelda100(n) {
    const ctx = this.ctx;
    // Celdas de 100 km vecinas, tenues y navegables.
    for (let dx = -100; dx <= 100; dx += 100) {
      for (let dy = -100; dy <= 100; dy += 100) {
        if (!dx && !dy) continue;
        const x = n.x + dx;
        const y = n.y + dy;
        const poli = this.poligono(n.huso, x, y, x + 100, y + 100, 4);
        this.trazar(poli);
        ctx.strokeStyle = 'rgba(29,52,80,.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        this.zonasClic.push({ poli, accion: () => this.irA({ tipo: 'celda100', huso: n.huso, x, y }) });
      }
    }
    for (let x = n.x; x < n.x + 100; x += 10) {
      for (let y = n.y; y < n.y + 100; y += 10) {
        const c = this.celdas.get(`${n.huso}_${x}_${y}`);
        const poli = this.poligono(n.huso, x, y, x + 10, y + 10, 2);
        this.trazar(poli);
        const f = this.relleno(c);
        if (f) {
          ctx.fillStyle = f;
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(29,52,80,.3)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        if (c && this.vista.z > 8.3) {
          const [px, py] = this.deUtm(n.huso, (x + 5) * 1000, (y + 5) * 1000);
          const listos = c.listo + c.parcial;
          const t = listos ? `${listos}✓` : c.descargado ? `${c.descargado}↓` : c.disponible ? `${c.disponible}` : '';
          if (t) this.etiqueta(t, px, py, { tam: 9.5, peso: 700, fondo: 'rgba(255,255,255,.6)' });
        }
        this.zonasClic.push({ poli, accion: () => this.irA({ tipo: 'celda10', huso: n.huso, x, y }) });
      }
    }
    this.trazar(this.poligono(n.huso, n.x, n.y, n.x + 100, n.y + 100, 6));
    ctx.strokeStyle = '#1d3450';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  dibujarCelda10(n) {
    const ctx = this.ctx;
    const dentro = (b) => b.x >= n.x && b.x < n.x + 10 && b.y >= n.y && b.y < n.y + 10;
    // Tamaño en pantalla de un bloque (para decidir si caben las etiquetas).
    const [ax, ay] = this.deUtm(n.huso, n.x * 1000, n.y * 1000);
    const [bx, by] = this.deUtm(n.huso, (n.x + 2) * 1000, n.y * 1000);
    const lado = Math.hypot(bx - ax, by - ay);
    // Primero los de fuera (atenuados), luego los de la celda.
    const orden = [...this.bloques.filter((b) => !dentro(b)), ...this.bloques.filter(dentro)];
    for (const b of orden) {
      const interior = dentro(b);
      const poli = this.poligono(b.huso, b.x, b.y, b.x + 2, b.y + 2, 1);
      const k = `${b.huso}_${b.x}_${b.y}`;
      const sel = this.seleccion.has(k);
      this.trazar(poli);
      ctx.fillStyle = COLOR_ESTADO[b.estado] || COLOR_ESTADO['sin-datos'];
      ctx.globalAlpha = (b.estado === 'sin-datos' ? 0.18 : 0.42) * (interior || sel ? 1 : 0.5);
      ctx.fill();
      if (!interior && !sel) {
        // Velo gris para distinguir las vecinas.
        ctx.fillStyle = '#8a97a6';
        ctx.globalAlpha = 0.18;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sel ? '#0b2540' : interior ? 'rgba(29,52,80,.45)' : 'rgba(29,52,80,.22)';
      ctx.lineWidth = sel ? 3.5 : 1;
      ctx.stroke();
      if (interior || sel || lado > 70) {
        const [px, py] = this.deUtm(b.huso, (b.x + 1) * 1000, (b.y + 1) * 1000);
        let sub = '';
        if (b.trabajo && !['hecho', 'error'].includes(b.trabajo.estado)) {
          sub = `\n${b.trabajo.estado} ${Math.round((b.trabajo.progreso || 0) * 100)} %`;
        } else if (b.estado === 'parcial') sub = `\n${Math.round(b.cobertura * 100)} %`;
        this.etiqueta(`${b.x}-${b.y}${sub}`, px, py, {
          tam: interior || sel ? 10 : 9,
          fondo: sel ? 'rgba(11,37,64,.88)' : interior ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.45)',
          color: sel ? '#fff' : interior ? '#1d3450' : '#5b7390',
        });
      }
      this.zonasClic.push({ poli, accion: () => this.alternar(b) });
    }
    this.trazar(this.poligono(n.huso, n.x, n.y, n.x + 10, n.y + 10, 4));
    ctx.strokeStyle = '#1d3450';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Flechas para pasar a la celda de 10 km vecina.
    const flechas = [
      // Sobre el borde de la celda, en la junta entre bloques (x o y par), para no tapar el centro de ninguno.
      { dx: 0, dy: 10, e: [n.x + 4, n.y + 10], r: 0 },
      { dx: 10, dy: 0, e: [n.x + 10, n.y + 4], r: 90 },
      { dx: 0, dy: -10, e: [n.x + 4, n.y], r: 180 },
      { dx: -10, dy: 0, e: [n.x, n.y + 4], r: 270 },
    ];
    for (const f of flechas) {
      const [px, py] = this.deUtm(n.huso, f.e[0] * 1000, f.e[1] * 1000);
      const rad = 13;
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = 'rgba(29,52,80,.85)';
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate((f.r * Math.PI) / 180);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(6, 3);
      ctx.lineTo(-6, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const circ = [];
      for (let i = 0; i < 12; i += 1) {
        circ.push([px + rad * Math.cos((i / 12) * Math.PI * 2), py + rad * Math.sin((i / 12) * Math.PI * 2)]);
      }
      // Se añade al final: tiene prioridad sobre el bloque que haya debajo.
      this.zonasClicFinal.push({
        poli: circ,
        accion: () => this.irA({ tipo: 'celda10', huso: n.huso, x: n.x + f.dx, y: n.y + f.dy }),
      });
    }
  }

  // ------------------------------------------------------------------ buscador
  async buscar(texto) {
    const cont = this.panel.querySelector('.resultados');
    texto = String(texto || '').trim();
    if (texto.length < 2) {
      cont.innerHTML = '';
      return;
    }
    cont.innerHTML = '<p class="nota">Buscando…</p>';
    try {
      const r = await fetch(`/api/buscar?q=${encodeURIComponent(texto)}`);
      if (!(r.headers.get('content-type') || '').includes('json')) throw new Error('reinicia la app (servidor antiguo)');
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const lista = d.resultados || [];
      if (!lista.length) {
        cont.innerHTML = '<p class="nota">Sin resultados.</p>';
        return;
      }
      cont.innerHTML = '';
      for (const l of lista) {
        const b = document.createElement('button');
        b.className = 'resultado';
        b.innerHTML = '<b></b><small></small>';
        b.querySelector('b').textContent = l.corto;
        b.querySelector('small').textContent = `${l.tipo ? `${l.tipo} · ` : ''}${l.nombre}`;
        b.addEventListener('click', () => {
          cont.innerHTML = '';
          this.irALugar(l);
        });
        cont.append(b);
      }
    } catch (error) {
      cont.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'nota aviso';
      p.textContent = `No se pudo buscar: ${error?.message || error}`;
      cont.append(p);
    }
  }

  /** Va a la celda de 10 km del lugar. Elige el huso donde haya datos (CyL usa el 30 también al oeste de −6°). */
  irALugar(l) {
    this.marca = l;
    if (this.seleccion.size) {
      this.vaciarSeleccion();
      this.alAviso('Zona nueva: se ha vaciado la selección anterior.');
    }
    const candidatos = [husoDe(l.lon)];
    if (!candidatos.includes(30) && l.lon > -9.5 && l.lon < 3.5) candidatos.push(30);
    let elegido = null;
    for (const huso of candidatos) {
      const [E, N] = geoAUtm(l.lat, l.lon, huso);
      const x = Math.floor(E / 10000) * 10;
      const y = Math.floor(N / 10000) * 10;
      const c = this.celdas.get(`${huso}_${x}_${y}`);
      const conDatos = c && c.listo + c.parcial + c.descargado + c.disponible > 0;
      if (!elegido || conDatos) elegido = { huso, x, y };
      if (conDatos) break;
    }
    this.irA({ tipo: 'celda10', ...elegido });
  }

  // ------------------------------------------------------------------ selección por área
  alternarModoArea() {
    if (this.nivel.tipo === 'peninsula' && !this.modoArea) {
      this.alAviso('Acércate primero a una celda de 100 km o de 10 km para elegir un área.');
      return;
    }
    this.modoArea = !this.modoArea;
    this.lienzo.classList.toggle('modo-area', this.modoArea);
    this.pintarPanel();
  }

  async seleccionarArea(r) {
    const huso = this.nivel.huso ?? husoDe(this.vista.lon);
    const esquinas = [
      [r.x0, r.y0],
      [r.x1, r.y0],
      [r.x0, r.y1],
      [r.x1, r.y1],
    ].map(([sx, sy]) => {
      const [lat, lon] = this.deAPantalla(sx, sy);
      return geoAUtm(lat, lon, huso);
    });
    const x0 = Math.floor(Math.min(...esquinas.map((e) => e[0])) / 2000) * 2;
    const x1 = Math.ceil(Math.max(...esquinas.map((e) => e[0])) / 2000) * 2;
    const y0 = Math.floor(Math.min(...esquinas.map((e) => e[1])) / 2000) * 2;
    const y1 = Math.ceil(Math.max(...esquinas.map((e) => e[1])) / 2000) * 2;
    const n = ((x1 - x0) / 2) * ((y1 - y0) / 2);
    if (n > 900) {
      this.alAviso(`El área tiene ${n} bloques; como mucho 900. Haz un rectángulo más pequeño.`);
      this.pendiente = true;
      return;
    }
    this.modoArea = false;
    this.lienzo.classList.remove('modo-area');
    this.area = { huso, x0, y0, x1, y1 };
    await this.cargarArea(true);
    // Con la tabla ya abierta, se encuadra el área en el hueco que queda encima.
    requestAnimationFrame(() => this.volarA(huso, x0, y0, x1, y1, 0.06));
  }

  async cargarArea(nueva = false) {
    const a = this.area;
    if (!a) return;
    const r = await fetch(`/api/mapa/bloques?huso=${a.huso}&x0=${a.x0}&y0=${a.y0}&x1=${a.x1}&y1=${a.y1}`);
    const d = await r.json();
    if (d.error) {
      this.alAviso(d.error);
      return;
    }
    this.tabla = { bloques: d.bloques || [] };
    if (nueva) {
      // Un área nueva sustituye a la selección anterior; se marcan los bloques con algo que cargar o bajar.
      this.seleccion.clear();
      for (const b of this.tabla.bloques) {
        if (['listo', 'parcial', 'descargado', 'disponible'].includes(b.estado)) {
          this.seleccion.set(`${b.huso}_${b.x}_${b.y}`, b);
        }
      }
    } else {
      for (const b of this.tabla.bloques) {
        const k = `${b.huso}_${b.x}_${b.y}`;
        if (this.seleccion.has(k)) this.seleccion.set(k, b);
      }
    }
    this.pendiente = true;
    this.pintarPanel();
  }

  cerrarTabla() {
    this.tabla = null;
    this.area = null;
    this.tablaEl.hidden = true;
    this.pendiente = true;
    this.pintarPanel();
  }

  textoOrigen(b) {
    const partes = [];
    for (const f of b.fuentes || []) {
      if (f.fuente === 'cyl') partes.push(`PNOA CyL ${f.anio}${f.ok ? '' : ' (sin enlace)'}`);
      else if (f.fuente === 'eus') partes.push(`geoEuskadi 2017 · ${f.ficheros} teselas`);
    }
    if (b.terrenos?.length) partes.unshift(`en el PC: ${b.terrenos.map((t) => t.zona).filter((z, i, l) => l.indexOf(z) === i).join(', ')}`);
    else if (b.entradas?.length) partes.unshift(`en el PC: ${b.entradas.length} LAZ sin procesar`);
    return partes.join(' · ') || '—';
  }

  pintarTabla() {
    const el = this.tablaEl;
    if (!this.tabla || !this.activo) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const scroll = el.querySelector('.filas')?.scrollTop || 0;
    const bloques = this.tabla.bloques;
    const cuenta = {};
    for (const b of bloques) cuenta[b.estado] = (cuenta[b.estado] || 0) + 1;
    const a = this.area;
    const marcados = bloques.filter((b) => this.seleccion.has(`${b.huso}_${b.x}_${b.y}`));
    const nVer = marcados.filter((b) => ['listo', 'parcial'].includes(b.estado)).length;
    const nBajar = marcados.filter((b) => ['disponible', 'parcial'].includes(b.estado) && b.fuentes?.some((f) => f.ok)).length;
    const nProc = marcados.filter((b) => b.estado === 'descargado').length;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    el.innerHTML = `
      <header><b>Área H${a.huso} · x ${a.x0}–${a.x1} km · y ${a.y0}–${a.y1} km</b>
        <small>${bloques.length} bloques de 2×2 km · ${Object.entries(cuenta)
          .map(([k, v]) => `<i style="background:${COLOR_ESTADO[k]}"></i>${v} ${esc(TEXTO_ESTADO[k].toLowerCase())}`)
          .join(' · ')}</small>
        <button class="mini" data-t="cerrar" title="Cerrar la tabla">✕</button></header>
      <div class="marcar">Marcar: <button data-t="todos">con datos</button><button data-t="listos">solo listos</button><button data-t="bajar">solo descargables</button><button data-t="ninguno">ninguno</button>
        <span class="acc-tabla"><button class="prim" data-a="ver" ${nVer ? '' : 'disabled'}>Cargar en 3D (${nVer})</button><button data-a="descargar" ${nBajar ? '' : 'disabled'}>Descargar y procesar (${nBajar})</button>${nProc ? `<button data-a="procesar">Procesar (${nProc})</button>` : ''}</span></div>
      <div class="filas"><table>
        <thead><tr><th></th><th>Bloque</th><th>Estado</th><th>Terreno</th><th>Origen</th><th>Progreso</th></tr></thead>
        <tbody>${bloques
          .map((b) => {
            const k = `${b.huso}_${b.x}_${b.y}`;
            const t = b.trabajo;
            const prog = t
              ? `<div class="barra"><i style="width:${Math.round((t.progreso || 0) * 100)}%"></i></div><small>${esc(t.estado)}${t.estado === 'error' ? ` · ${esc(t.mensaje)}` : ''}</small>`
              : '';
            return `<tr class="${this.seleccion.has(k) ? 'marcada' : ''}">
              <td><input type="checkbox" data-k="${k}" ${this.seleccion.has(k) ? 'checked' : ''} ${b.estado === 'sin-datos' ? 'disabled' : ''}/></td>
              <td class="mono">${b.x}-${b.y}</td>
              <td class="estado"><i style="background:${COLOR_ESTADO[b.estado]}"></i>${esc(TEXTO_ESTADO[b.estado] || b.estado)}</td>
              <td class="mono">${b.cobertura ? `${Math.round(b.cobertura * 100)} %` : '—'}</td>
              <td class="origen">${esc(this.textoOrigen(b))}${['sin-datos', 'sin-enlace'].includes(b.estado) ? ` <button class="mini" data-manual="${k}">Cómo conseguirlo</button>` : ''}</td>
              <td class="prog">${prog}</td></tr>`;
          })
          .join('')}</tbody></table></div>`;
    el.querySelector('.filas').scrollTop = scroll;
    el.querySelectorAll('input[data-k]').forEach((c) =>
      c.addEventListener('change', () => {
        const b = bloques.find((x) => `${x.huso}_${x.x}_${x.y}` === c.dataset.k);
        if (c.checked) this.seleccion.set(c.dataset.k, b);
        else this.seleccion.delete(c.dataset.k);
        this.pendiente = true;
        this.pintarPanel();
      }),
    );
    el.querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', () => this.accion(btn.dataset.a)));
    el.querySelectorAll('[data-manual]').forEach((btn) =>
      btn.addEventListener('click', () => abrirAyudaManual(bloques.filter((b) => `${b.huso}_${b.x}_${b.y}` === btn.dataset.manual))),
    );
    el.querySelectorAll('[data-t]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const t = btn.dataset.t;
        if (t === 'cerrar') return this.cerrarTabla();
        const filtros = {
          todos: (b) => ['listo', 'parcial', 'descargado', 'disponible'].includes(b.estado),
          listos: (b) => ['listo', 'parcial'].includes(b.estado),
          bajar: (b) => b.estado === 'disponible',
          ninguno: () => false,
        };
        for (const b of bloques) {
          const k = `${b.huso}_${b.x}_${b.y}`;
          if (filtros[t](b)) this.seleccion.set(k, b);
          else this.seleccion.delete(k);
        }
        this.pendiente = true;
        this.pintarPanel();
        return undefined;
      }),
    );
  }

  // ------------------------------------------------------------------ panel
  montarPanel() {
    this.panel.innerHTML = `
      <div class="cab"><b>Elegir zona</b></div>
      <form class="buscador" autocomplete="off">
        <input type="search" name="q" placeholder="Buscar localidad o paraje…" aria-label="Buscar lugar" />
        <button type="submit">Buscar</button>
      </form>
      <div class="resultados"></div>
      <div class="cuerpo dinamico"></div>`;
    this.panel.querySelector('.buscador').addEventListener('submit', (e) => {
      e.preventDefault();
      this.buscar(e.target.q.value);
    });
  }

  migas() {
    const n = this.nivel;
    const partes = [{ texto: 'Península', nivel: { tipo: 'peninsula' } }];
    if (n.tipo !== 'peninsula') {
      const x = Math.floor(n.x / 100) * 100;
      const y = Math.floor(n.y / 100) * 100;
      partes.push({ texto: `H${n.huso} · ${x}·${y} km`, nivel: { tipo: 'celda100', huso: n.huso, x, y } });
    }
    if (n.tipo === 'celda10') partes.push({ texto: `${n.x}·${n.y}`, nivel: n });
    return partes;
  }

  pintarPanel() {
    const p = this.panel;
    if (!p) return;
    const sel = [...this.seleccion.values()];
    const cuenta = (est) => sel.filter((b) => est.includes(b.estado)).length;
    const nListos = cuenta(['listo', 'parcial']);
    const nDescargar = sel.filter((b) => ['disponible', 'parcial'].includes(b.estado) && b.fuentes?.some((f) => f.ok)).length;
    const nProcesar = cuenta(['descargado']);
    const activos = this.trabajos.filter((t) => !['hecho', 'error'].includes(t.estado));
    const recientes = this.trabajos.slice(-6).reverse();
    const py = this.sistema?.python;
    const ayuda = {
      peninsula: 'Toca una celda de 100 km para acercarte.',
      celda100: 'Toca una celda de 10 km. Las vecinas también se pueden tocar.',
      celda10: 'Toca los bloques de 2 km para seleccionarlos (también los de alrededor, en gris). Las flechas llevan a la celda vecina.',
    }[this.nivel.tipo];
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const din = p.querySelector('.dinamico');
    if (!din) return;
    din.innerHTML = `
        <div class="fila-nav">${this.nivel.tipo !== 'peninsula' ? '<button class="mini" data-acc="atras">← Atrás</button>' : ''}
        <nav class="migas">${this.migas()
          .map((m, i) => `<button data-miga="${i}">${esc(m.texto)}</button>`)
          .join('<span>›</span>')}</nav></div>
        <p class="nota">${ayuda}</p>
        <button class="area ${this.modoArea ? 'activa' : ''}" data-acc="area">${this.modoArea ? 'Arrastra sobre el mapa… (cancelar)' : '▭ Seleccionar un área'}</button>
        ${this.tabla ? '<button class="mini" data-acc="tabla">Ver tabla del área</button>' : ''}
        <div class="grp">Leyenda</div>
        <div class="leyenda">${Object.entries(TEXTO_ESTADO)
          .map(([k, t]) => `<span><i style="background:${COLOR_ESTADO[k]}"></i>${t}</span>`)
          .join('')}</div>
        <div class="grp">Selección · ${sel.length} bloque(s)</div>
        ${sel.length ? `<div class="sel">${sel.slice(0, 15).map((b) => `<span title="${esc(TEXTO_ESTADO[b.estado] || '')}"><i style="background:${COLOR_ESTADO[b.estado]}"></i>${b.x}-${b.y}</span>`).join('')}${sel.length > 15 ? `<span>y ${sel.length - 15} más</span>` : ''}</div>` : '<p class="nota">Nada seleccionado.</p>'}
        <div class="acciones">
          <button class="prim" data-acc="ver" ${nListos ? '' : 'disabled'}>Ver en 3D${nListos ? ` (${nListos})` : ''}</button>
          <button data-acc="descargar" ${nDescargar ? '' : 'disabled'}>Descargar y procesar${nDescargar ? ` (${nDescargar})` : ''}</button>
          <button data-acc="procesar" ${nProcesar ? '' : 'disabled'}>Procesar${nProcesar ? ` (${nProcesar})` : ''}</button>
          <button data-acc="limpiar" ${sel.length ? '' : 'disabled'}>Vaciar</button>
        </div>
        ${sel.some((b) => ['sin-datos', 'sin-enlace'].includes(b.estado)) ? `<p class="nota aviso">${sel.filter((b) => ['sin-datos', 'sin-enlace'].includes(b.estado)).length} bloque(s) sin descarga automática. <button class="mini" data-acc="manual">Cómo conseguirlos</button></p>` : ''}
        ${py && !py.ok ? `<div class="aviso-caja"><b>Python</b><p>${py.cmd ? 'Faltan los paquetes para generar el terreno (numpy, laspy, lazrs).' : 'No se encuentra Python 3. Instálalo (python.org o miniforge) y pulsa «Comprobar».'}</p>
          ${py.cmd ? `<button data-acc="instalar" ${this.sistema?.instalando ? 'disabled' : ''}>${this.sistema?.instalando ? 'Instalando…' : 'Instalar paquetes'}</button>` : ''}
          <button data-acc="comprobar">Comprobar</button></div>` : ''}
        ${recientes.length ? `<div class="grp">Descargas${activos.length ? ` · ${activos.length} en curso` : ''}</div>
        <div class="trabajos">${recientes
          .map(
            (t) => `<div class="trab ${t.estado}"><div><b>${t.x}-${t.y}</b> <small>${esc(t.estado)}${t.mensaje ? ` · ${esc(t.mensaje)}` : ''}</small></div>
            <div class="barra"><i style="width:${Math.round((t.progreso || 0) * 100)}%"></i></div></div>`,
          )
          .join('')}</div>` : ''}
        <p class="nota pie">Catálogos: ${Object.entries(this.catalogos)
          .map(([k, v]) => `${k === 'cyl' ? 'Castilla y León' : 'geoEuskadi'} ${esc(v)}`)
          .join(' · ') || '…'}<br/>Mapa y buscador © colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (Nominatim).</p>`;
    din.querySelectorAll('[data-miga]').forEach((b) =>
      b.addEventListener('click', () => this.irA(this.migas()[Number(b.dataset.miga)].nivel)),
    );
    din.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => this.accion(b.dataset.acc)));
    this.pintarTabla();
    this.alCambioSeleccion();
  }

  async accion(acc) {
    const sel = [...this.seleccion.values()];
    if (acc === 'atras') return this.atras();
    if (acc === 'area') return this.alternarModoArea();
    if (acc === 'manual') return abrirAyudaManual(sel.filter((b) => ['sin-datos', 'sin-enlace'].includes(b.estado)));
    if (acc === 'tabla') return this.pintarTabla();
    if (acc === 'limpiar') {
      this.seleccion.clear();
      this.pendiente = true;
      return this.pintarPanel();
    }
    if (acc === 'ver') return this.alCargar3D(terrenosSinSolapes(sel));
    if (acc === 'descargar' || acc === 'procesar') {
      const bloques = sel
        .filter((b) =>
          acc === 'procesar'
            ? b.estado === 'descargado'
            : ['disponible', 'parcial'].includes(b.estado) && b.fuentes?.some((f) => f.ok),
        )
        .map(({ huso, x, y }) => ({ huso, x, y }));
      await fetch('/api/mapa/trabajos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: acc, bloques }),
      });
      await this.sondearTrabajos();
      if (this.nivel.tipo === 'celda10') await this.cargarBloques();
      return undefined;
    }
    if (acc === 'instalar') {
      this.sistema = { ...(this.sistema || {}), instalando: true };
      this.pintarPanel();
      try {
        const r = await (await fetch('/api/sistema/instalar', { method: 'POST' })).json();
        if (r.error) this.alAviso(r.error);
      } finally {
        await this.comprobarSistema(true);
      }
      return undefined;
    }
    if (acc === 'comprobar') return this.comprobarSistema(true);
    return undefined;
  }
}

/**
 * Terrenos de los bloques elegidos sin repetir y sin los pequeños que ya tapa
 * otro mayor (p. ej. una muestra de 500 m dentro de un bloque de 2 km).
 */
export function terrenosSinSolapes(bloques) {
  const area = (e) => Math.max(0, e[2] - e[0]) * Math.max(0, e[3] - e[1]);
  const recorte = (e, c) => [Math.max(e[0], c[0]), Math.max(e[1], c[1]), Math.min(e[2], c[2]), Math.min(e[3], c[3])];
  const quedan = new Map();
  for (const b of bloques) {
    const lista = b.terrenos || [];
    // Dentro de cada bloque se descarta el terreno pequeño que ya cubre otro mayor
    // (p. ej. una muestra de 500 m que asoma dentro de un bloque de 2 km).
    const caja = Number.isFinite(b.x) ? [b.x * 1000, b.y * 1000, (b.x + 2) * 1000, (b.y + 2) * 1000] : null;
    for (const t of lista) {
      const et = t.ext && caja ? recorte(t.ext, caja) : t.ext;
      const tapado =
        et &&
        lista.some((u) => {
          if (u === t || !u.ext || area(u.ext) <= area(t.ext)) return false;
          const eu = caja ? recorte(u.ext, caja) : u.ext;
          return area(recorte(et, eu)) >= 0.9 * area(et);
        });
      if (!tapado) quedan.set(`${t.zona}/${t.bloque}`, t);
    }
  }
  return [...quedan.values()];
}

function dentro(poli, x, y) {
  let c = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i, i += 1) {
    const [xi, yi] = poli[i];
    const [xj, yj] = poli[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
