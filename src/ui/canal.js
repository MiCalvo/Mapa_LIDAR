/**
 * Herramienta «Canal por gravedad».
 *  - Solo manantial: se exploran los dos trazados que salen de él ciñéndose a la
 *    ladera con la pendiente mínima (src/analisis/canal.js).
 *  - Manantial + puntos: el recorrido se hace por tramos. Cada tramo empieza a la
 *    cota a la que llegó el anterior y puede ser:
 *      · canal: se buscan varias rutas, como un navegador (src/analisis/ruta.js,
 *        en un worker), y se elige una;
 *      · sifón: tubería a presión en línea recta entre sus dos puntos.
 *    Si una ruta de canal necesita un puente muy alto, se sugiere convertir ese
 *    trozo en sifón; la decisión es del usuario.
 * Colores: azul = por la ladera; rojo = puente/terraplén; naranja = zanja/túnel;
 * morado = resalto; verde azulado = sifón.
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { trazarCanal } from '../analisis/canal.js';
import { regionPara, rejillaRegion, calcularSifon, sugerirSifones, recortarRuta, desplazarRuta } from '../analisis/ruta.js';
import { uniformesTerreno } from '../viewer/capaTerreno.js';
import { muestreadorSuave, activarHerramienta, desactivarHerramienta, herramientaActiva, crearMarca } from '../viewer/picar.js';

const CLAVE = 'mapaLidar.canal.v3';
const COLORES = { ladera: '#1f6fd1', puente: '#d6453d', zanja: '#e8962c', resalto: '#8e44ad', sifon: '#138d75' };
const GRIS = '#7d8a99';
const COLOR_PUNTO = { manantial: '#0b3d91', intermedio: '#34495e', destino: '#1e8449' };
const FINES = {
  longitud: 'llega a la longitud máxima',
  limite: 'termina en el borde de los datos cargados',
  bucle: 'se cierra sobre sí mismo (zona llana o sin salida)',
  obra: 'se abandona: demasiada obra seguida (valle o cerro que no rodea)',
  'sin-datos': 'sin datos',
};

const fmt = (v, dec = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const km = (m) => (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m)} m`);
const letra = (i, n) => (i === 0 ? 'M' : i === n - 1 ? 'D' : `P${i}`);

function leerOpciones() {
  const def = { pMin: 0.3, pMax: 3, tolerancia: 2, maxKm: 10, resaltos: false, alturaSifon: 50, perdida: 2 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
  } catch {
    return def;
  }
}

export function montarCanal({ boton, panel, escena, avisar }) {
  const opciones = leerOpciones();
  const grupo = new THREE.Group();
  escena.scene.add(grupo);
  /** Puntos del recorrido: [manantial, intermedios…, destino]. */
  let puntos = [];
  /** Un tramo por cada par de puntos seguidos. */
  let tramos = [];
  let exploracion = null;
  let exagDibujada = null;
  let worker = null;
  let generacion = 0;
  let peticiones = 0;
  const pendientes = new Map();

  const guardar = () => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(opciones));
    } catch {
      /* sin almacenamiento */
    }
  };
  const nuevoTramo = (tipo = 'canal') => ({ tipo, rutas: null, elegida: 0, fijo: null, sifon: null, estado: 'pendiente', error: null, sugerencias: [] });

  panel.innerHTML = `
    <div class="cab"><b>Canal por gravedad</b><button class="cerrar" data-c="cerrar" title="Ocultar el canal y volver a la vista">Ocultar</button></div>
    <p class="nota">Marca el <b>manantial</b> para ver por dónde iría el agua ciñéndose a la ladera. Añade
      <b>puntos</b> hasta el destino para trazar el recorrido por tramos: en cada tramo eliges canal o sifón.</p>
    <details class="params"><summary>Parámetros</summary>
      <div class="fila"><label title="El canal nunca baja menos que esto (también es la pendiente de la exploración desde el manantial)">Pendiente mín.</label><input data-o="pMin" type="number" min="0.01" step="any" value="${opciones.pMin}"/><span>m/km</span></div>
      <div class="fila"><label title="El canal nunca baja más deprisa que esto">Pendiente máx.</label><input data-o="pMax" type="number" min="0.01" step="any" value="${opciones.pMax}"/><span>m/km</span></div>
      <div class="fila"><label title="Desnivel entre el terreno y el canal a partir del cual el tramo necesita obra">Tolerancia</label><input data-o="tolerancia" type="number" min="0.2" step="any" value="${opciones.tolerancia}"/><span>m</span></div>
      <div class="fila"><label title="Longitud máxima de la exploración desde el manantial (solo manantial)">Long. explor.</label><input data-o="maxKm" type="number" min="0.1" step="any" value="${opciones.maxKm}"/><span>km</span></div>
      <div class="fila"><label title="Si una ruta necesita un puente de esta altura o más, se sugiere un sifón">Sugerir sifón</label><input data-o="alturaSifon" type="number" min="1" step="any" value="${opciones.alturaSifon}"/><span>m</span></div>
      <div class="fila"><label title="Supuesto: cuánto más baja sale el agua del sifón que entra, por km de tubería. Ajústalo con tus fuentes.">Pérdida sifón</label><input data-o="perdida" type="number" min="0" step="any" value="${opciones.perdida}"/><span>m/km</span></div>
      <label class="casilla"><input data-o="resaltos" type="checkbox" ${opciones.resaltos ? 'checked' : ''}/> Permitir resaltos (caídas bruscas) en los canales</label>
    </details>
    <div class="acciones">
      <button class="prim" data-c="manantial">Manantial</button>
      <button data-c="punto">Añadir punto</button>
      <button data-c="quitar" disabled>Quitar último</button>
      <button data-c="encuadrar" disabled>Encuadrar</button>
      <button data-c="borrar" disabled>Borrar</button>
    </div>
    <div class="leyenda">
      <span><i style="background:${COLORES.ladera}"></i>por la ladera</span>
      <span><i style="background:${COLORES.puente}"></i>puente/terraplén</span>
      <span><i style="background:${COLORES.zanja}"></i>zanja/túnel</span>
      <span><i style="background:${COLORES.resalto}"></i>resalto</span>
      <span><i style="background:${COLORES.sifon}"></i>sifón</span>
    </div>
    <div class="res-canal" data-r></div>`;
  const $ = (s) => panel.querySelector(s);
  const salida = $('[data-r]');

  // ---------------------------------------------------------------- elegir puntos
  function marcarBotones(activo) {
    $('[data-c=manantial]').textContent = activo === 'canal-manantial' ? 'Toca el terreno…' : 'Manantial';
    $('[data-c=punto]').textContent = activo === 'canal-punto' ? 'Toca el terreno…' : 'Añadir punto';
    $('[data-c=manantial]').classList.toggle('prim', activo === 'canal-manantial' || (!activo && !puntos.length));
    $('[data-c=punto]').classList.toggle('prim', activo === 'canal-punto' || (!activo && puntos.length > 0));
  }
  function elegir(cualPedido) {
    const cual = cualPedido === 'punto' && !puntos.length ? 'manantial' : cualPedido;
    const nombre = `canal-${cual}`;
    if (herramientaActiva() === nombre) {
      desactivarHerramienta(nombre);
      marcarBotones(null);
      return;
    }
    activarHerramienta(
      nombre,
      (p) => {
        desactivarHerramienta(nombre);
        if (cual === 'manantial') {
          if (puntos.length) puntos[0] = p;
          else puntos = [p];
          recalcular(0);
        } else {
          puntos.push(p);
          tramos.push(nuevoTramo());
          recalcular(tramos.length - 1);
        }
        marcarBotones(null);
      },
      () => marcarBotones(null),
    );
    marcarBotones(nombre);
  }

  // ---------------------------------------------------------------- cálculo
  const altActual = () => muestreadorSuave(escena);

  function parametros() {
    const pMin = Math.max(0.01, Number(opciones.pMin) || 0.3);
    return {
      pendienteMin: pMin,
      pendienteMax: Math.max(pMin, Number(opciones.pMax) || 3),
      tolerancia: Math.max(0.2, Number(opciones.tolerancia) || 2),
      resaltos: !!opciones.resaltos,
    };
  }
  const umbralSifon = () => Number(opciones.alturaSifon) || 50;

  /** Ruta elegida de un tramo (o el sifón). */
  function elegidaDe(t) {
    if (t.tipo === 'sifon') return t.sifon;
    return t.rutas?.[t.elegida] || null;
  }

  function buscarEnWorker(rej, a, b, o) {
    if (!worker) {
      worker = new Worker(new URL('../analisis/ruta.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const r = pendientes.get(e.data.id);
        if (!r) return;
        pendientes.delete(e.data.id);
        if (e.data.error) r.reject(new Error(e.data.error));
        else r.resolve(e.data.rutas);
      };
    }
    const id = ++peticiones;
    return new Promise((resolve, reject) => {
      pendientes.set(id, { resolve, reject });
      worker.postMessage({ id, rej, a, b, opciones: o }, [rej.z.buffer]);
    });
  }

  /** Recalcula desde el tramo `desde` en adelante (cada uno empieza donde llegó el anterior). */
  async function recalcular(desde = 0) {
    const gen = ++generacion;
    exploracion = null;
    const alt = altActual();
    if (!alt) {
      avisar('Carga primero algún bloque de terreno en 3D.');
      return;
    }
    const o = parametros();
    if (puntos.length === 1) {
      tramos = [];
      exploracion = trazarCanal(alt, {
        x: puntos[0].x,
        y: puntos[0].y,
        pendiente: o.pendienteMin,
        maxLong: Math.max(100, (Number(opciones.maxKm) || 10) * 1000),
        tolerancia: o.tolerancia,
        paso: 2,
      });
      if (!exploracion) avisar('Ese punto está fuera del terreno cargado o en terreno llano: elige otro en una ladera.');
      refrescar();
      return;
    }
    for (let i = desde; i < tramos.length; i += 1) {
      tramos[i].estado = 'pendiente';
      tramos[i].error = null;
      tramos[i].sugerencias = [];
    }
    refrescar();
    for (let i = desde; i < tramos.length; i += 1) {
      if (gen !== generacion) return;
      const t = tramos[i];
      const a = puntos[i];
      const b = puntos[i + 1];
      const prev = i > 0 ? elegidaDe(tramos[i - 1]) : null;
      const z0 = i === 0 ? alt(a.x, a.y) : prev?.zLlegada;
      if (!Number.isFinite(z0)) {
        t.estado = 'error';
        t.error = i === 0 ? 'El manantial está fuera del terreno cargado.' : 'El tramo anterior no tiene ruta.';
        continue;
      }
      if (t.tipo === 'sifon') {
        t.sifon = calcularSifon(alt, a, b, z0, { perdida: Math.max(0, Number(opciones.perdida) || 0) });
        t.estado = t.sifon ? 'listo' : 'error';
        if (!t.sifon) t.error = 'El sifón sale del terreno cargado.';
        refrescar();
        continue;
      }
      if (t.fijo) {
        t.rutas = [desplazarRuta(t.fijo, z0 - t.fijo.zInicio, o.tolerancia)];
        t.elegida = 0;
        t.estado = 'listo';
        t.sugerencias = sugerirSifones(t.rutas[0], { alturaMin: umbralSifon() });
        refrescar();
        continue;
      }
      const zB = alt(b.x, b.y);
      if (!(z0 > zB - o.tolerancia)) {
        t.estado = 'error';
        t.error = `${letra(i + 1, puntos.length)} está más alto (${fmt(zB, 1)} m) que el agua al salir de ${letra(i, puntos.length)} (${fmt(z0, 1)} m): no llega por gravedad.`;
        t.rutas = [];
        refrescar();
        continue;
      }
      t.estado = 'buscando';
      refrescar();
      try {
        const reg = regionPara(a, b);
        const rej = rejillaRegion(alt, reg.x0, reg.y0, reg.x1, reg.y1, reg.R);
        const rutas = await buscarEnWorker(rej, a, b, { ...o, zA: z0 });
        if (gen !== generacion) return;
        t.rutas = rutas;
        t.elegida = Math.min(t.elegida, Math.max(0, rutas.length - 1));
        t.estado = rutas.length ? 'listo' : 'error';
        if (!rutas.length) t.error = 'No se encontró ninguna ruta dentro del terreno cargado.';
        const r = elegidaDe(t);
        t.sugerencias = r ? sugerirSifones(r, { alturaMin: umbralSifon() }) : [];
      } catch (error) {
        if (gen !== generacion) return;
        t.estado = 'error';
        t.error = `Error al buscar rutas: ${error.message}`;
      }
      refrescar();
    }
  }

  /** Convierte en sifón el tramo de puente sugerido `s` del tramo `i`. */
  function convertirEnSifon(i, s) {
    const r = elegidaDe(tramos[i]);
    if (!r) return null;
    const nuevosPuntos = [];
    const nuevosTramos = [];
    if (s.entrada > 0) {
      const antes = nuevoTramo('canal');
      antes.fijo = recortarRuta(r, 0, s.entrada);
      nuevosTramos.push(antes);
      nuevosPuntos.push(s.a);
    }
    nuevosTramos.push(nuevoTramo('sifon'));
    if (s.salida < r.puntos.length - 1) {
      nuevosPuntos.push(s.b);
      nuevosTramos.push(nuevoTramo('canal'));
    }
    puntos.splice(i + 1, 0, ...nuevosPuntos);
    tramos.splice(i, 1, ...nuevosTramos);
    return recalcular(i);
  }

  // ---------------------------------------------------------------- dibujo
  function limpiarDibujo() {
    for (const h of [...grupo.children]) {
      grupo.remove(h);
      h.geometry?.dispose();
      h.material?.dispose();
    }
  }

  function linea(pts, { gris = false, ancho = 4 } = {}) {
    const [ox, oy, oz] = escena.origen;
    const exag = uniformesTerreno.exag.value;
    const elevar = 1.5 + exag;
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    for (const p of pts) {
      // Puente: a la cota del canal (en el aire). Sifón, zanja o ladera: sobre el terreno.
      const z = p.tipo === 'sifon' ? p.zt : Math.max(p.zc, p.zt);
      pos.push(p.x - ox, p.y - oy, (z - oz) * exag + elevar);
      c.set(gris ? GRIS : COLORES[p.tipo] || COLORES.ladera);
      col.push(c.r, c.g, c.b);
    }
    const geo = new LineGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const { clientWidth: w, clientHeight: h } = escena.renderer.domElement;
    const mat = new LineMaterial({ linewidth: ancho, vertexColors: true, worldUnits: false, transparent: gris, opacity: gris ? 0.75 : 1 });
    mat.resolution.set(w, h);
    const l = new Line2(geo, mat);
    l.computeLineDistances();
    l.frustumCulled = false;
    l.renderOrder = gris ? 4 : 5;
    return l;
  }

  function dibujar() {
    limpiarDibujo();
    exagDibujada = uniformesTerreno.exag.value;
    if (!escena.origen) return;
    const alt = altActual();
    if (exploracion) {
      for (const r of exploracion.ramas) if (r.puntos.length > 1) grupo.add(linea(r.puntos));
    }
    for (const t of tramos) {
      if (t.tipo === 'canal' && t.rutas) {
        t.rutas.forEach((r, k) => {
          if (k !== t.elegida && r.puntos.length > 1) grupo.add(linea(r.puntos, { gris: true, ancho: 3 }));
        });
      }
      const sel = elegidaDe(t);
      if (!sel || sel.puntos.length < 2) continue;
      grupo.add(linea(sel.puntos, { ancho: 5 }));
      for (const p of sel.puntos) {
        if (p.tipo === 'resalto') grupo.add(crearMarca(escena, p.x, p.y, p.zc + (p.caida || 0), COLORES.resalto, 11));
      }
    }
    puntos.forEach((p, i) => {
      const z = alt ? alt(p.x, p.y) : NaN;
      if (!Number.isFinite(z)) return;
      const tipo = i === 0 ? 'manantial' : i === puntos.length - 1 ? 'destino' : 'intermedio';
      grupo.add(crearMarca(escena, p.x, p.y, z, COLOR_PUNTO[tipo], tipo === 'intermedio' ? 14 : 18));
    });
  }

  // ---------------------------------------------------------------- textos
  function textoObra(r) {
    const partes = [];
    if (r.puente) partes.push(`puente ${km(r.puente)} (hasta ${fmt(r.maxPuente, 1)} m)`);
    if (r.zanja) partes.push(`zanja/túnel ${km(r.zanja)} (hasta ${fmt(r.maxZanja, 1)} m)`);
    if (r.nResaltos) partes.push(`${r.nResaltos} resalto${r.nResaltos > 1 ? 's' : ''} (${fmt(r.alturaResaltos, 1)} m)`);
    return partes.length ? partes.join(' · ') : 'sin obra: todo por la ladera';
  }

  function htmlTramo(t, i) {
    const n = puntos.length;
    const tol = Number(opciones.tolerancia) || 2;
    let h = `<div class="tramo"><div class="tcab"><b>Tramo ${i + 1}</b><span>${letra(i, n)} → ${letra(i + 1, n)}</span>
      <span class="tipo-tramo"><button data-tipo="canal" data-t="${i}" class="${t.tipo === 'canal' ? 'sel' : ''}">Canal</button><button data-tipo="sifon" data-t="${i}" class="${t.tipo === 'sifon' ? 'sel' : ''}">Sifón</button></span></div>`;
    if (t.estado === 'buscando' || t.estado === 'pendiente') h += `<p class="nota">${t.estado === 'buscando' ? 'Buscando rutas…' : 'En espera…'}</p>`;
    if (t.error) h += `<p class="aviso-canal">${t.error}</p>`;
    if (t.tipo === 'sifon' && t.sifon) {
      const s = t.sifon;
      h += `<div class="info-sifon">Sifón en línea recta: <b>${km(s.longitud)}</b>, profundidad <b>${fmt(s.profundidad, 1)} m</b>
        (≈ ${fmt(s.presionAtm, 1)} atm en el punto más bajo)<br/>
        Entra a ${fmt(s.zInicio, 1)} m y sale a ${fmt(s.zLlegada, 1)} m (pérdida supuesta ${fmt(Number(opciones.perdida) || 0, 1)} m/km).</div>`;
      if (s.sobresale > tol) {
        h += `<p class="aviso-canal">El terreno sobresale hasta ${fmt(s.sobresale, 1)} m por encima de la línea de carga: ahí la tubería necesitaría zanja o túnel. Prueba a mover los puntos.</p>`;
      }
      if (s.margen < -tol) h += `<p class="aviso-canal">La salida queda ${fmt(-s.margen, 1)} m por debajo del suelo en ${letra(i + 1, n)}.</p>`;
    }
    if (t.tipo === 'canal' && t.rutas?.length) {
      if (t.fijo) h += `<p class="nota">Trazado conservado de la ruta anterior. <button class="enlace" data-recalc="${i}">Buscar de nuevo</button></p>`;
      t.rutas.forEach((r, k) => {
        const llega = r.margen >= 0 ? `llega ${fmt(r.margen, 1)} m sobre el suelo` : `llega ${fmt(-r.margen, 1)} m bajo el suelo`;
        h += `<button class="opcion ${k === t.elegida ? 'sel' : ''}" data-t="${i}" data-ruta="${k}">
          <b>${r.perfil?.nombre || 'Trazado'}</b> · ${km(r.longitud)} · baja ${fmt(r.zInicio - r.zLlegada, 1)} m (${fmt(r.pendienteMedia, 2)} m/km)<br/>
          <span class="txt-obra">${textoObra(r)}</span><br/><small>${llega} en ${letra(i + 1, n)}.</small></button>`;
      });
      (t.sugerencias || []).forEach((s, k) => {
        h += `<div class="sug">Posible <b>sifón</b>: puente de ${km(s.longitud)} y hasta ${fmt(s.alturaMax, 1)} m de alto.
          <button data-t="${i}" data-sug="${k}">Convertir en sifón</button></div>`;
      });
    }
    return `${h}</div>`;
  }

  function htmlResumen() {
    const sel = tramos.map(elegidaDe);
    if (!sel.length || sel.some((r) => !r)) return '';
    const tot = { longitud: 0, puente: 0, zanja: 0, nResaltos: 0, alturaResaltos: 0, sifones: 0, sifonL: 0 };
    for (const r of sel) {
      tot.longitud += r.longitud;
      tot.puente += r.puente || 0;
      tot.zanja += r.zanja || 0;
      tot.nResaltos += r.nResaltos || 0;
      tot.alturaResaltos += r.alturaResaltos || 0;
      if (r.tipo === 'sifon') {
        tot.sifones += 1;
        tot.sifonL += r.longitud;
      }
    }
    const ult = sel[sel.length - 1];
    const partes = [];
    if (tot.puente) partes.push(`puente ${km(tot.puente)}`);
    if (tot.zanja) partes.push(`zanja/túnel ${km(tot.zanja)}`);
    if (tot.nResaltos) partes.push(`${tot.nResaltos} resaltos (${fmt(tot.alturaResaltos, 1)} m)`);
    if (tot.sifones) partes.push(`${tot.sifones} sifón${tot.sifones > 1 ? 'es' : ''} (${km(tot.sifonL)})`);
    return `<div class="total"><b>Recorrido completo</b>: ${km(tot.longitud)} · ${partes.length ? partes.join(' · ') : 'sin obra'}<br/>
      <small>El agua llega a ${fmt(ult.zLlegada, 1)} m; el suelo del destino está a ${fmt(ult.zDestino, 1)} m.</small></div>`;
  }

  function pintar() {
    const hay = puntos.length > 0;
    $('[data-c=encuadrar]').disabled = !hay;
    $('[data-c=borrar]').disabled = !hay;
    $('[data-c=quitar]').disabled = puntos.length < 2;
    marcarBotones(herramientaActiva());
    const alt = altActual();
    let html = '';
    puntos.forEach((p, i) => {
      const z = alt ? alt(p.x, p.y) : NaN;
      const tipo = i === 0 ? 'manantial' : i === puntos.length - 1 ? 'destino' : 'intermedio';
      const nombre = i === 0 ? 'Manantial' : i === puntos.length - 1 ? 'Destino' : `Punto ${i}`;
      html += `<p class="man"><i class="pto" style="background:${COLOR_PUNTO[tipo]}"></i><span>${nombre} (${letra(i, puntos.length)}): <b>${fmt(z, 1)} m</b> · X ${fmt(p.x)} · Y ${fmt(p.y)}</span></p>`;
    });
    if (exploracion) {
      exploracion.ramas.forEach((r, i) => {
        if (!r.puntos || r.puntos.length < 2) {
          html += `<div class="rama"><b>Rama ${i + 1}</b>: no avanza (${FINES[r.fin] || r.fin}).</div>`;
          return;
        }
        html += `<div class="rama"><b>Hacia el ${r.rumboGeneral}</b>: ${km(r.longitud)}, baja ${fmt(r.caida, 2)} m (${fmt(r.zInicio, 1)} → ${fmt(r.zFin, 1)} m)<br/>
          ${textoObra(r)}<br/><small>${FINES[r.fin] || r.fin}.</small></div>`;
      });
      html += '<p class="nota">Pulsa «Añadir punto» para marcar el siguiente punto del recorrido (o el destino).</p>';
    }
    html += tramos.map(htmlTramo).join('');
    html += htmlResumen();
    salida.innerHTML = html;
  }

  function refrescar() {
    dibujar();
    pintar();
  }

  function encuadrar() {
    const pts = [...puntos];
    for (const t of tramos) {
      const r = elegidaDe(t);
      if (r) pts.push(...r.puntos);
    }
    if (exploracion) pts.push(...exploracion.ramas.flatMap((r) => r.puntos));
    if (!pts.length || !escena.origen) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [ox, oy, oz] = escena.origen;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2 - ox;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2 - oy;
    const lado = Math.max(400, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const alt = altActual();
    const z = alt ? alt(pts[0].x, pts[0].y) : oz;
    const cz = ((Number.isFinite(z) ? z : oz) - oz) * uniformesTerreno.exag.value;
    escena.controles.target.set(cx, cy, cz);
    escena.camara.position.set(cx, cy - lado * 0.9, cz + lado * 1.0);
    escena.pedirLod();
  }

  // ---------------------------------------------------------------- eventos
  for (const inp of panel.querySelectorAll('[data-o]')) {
    inp.addEventListener('change', () => {
      opciones[inp.dataset.o] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
      guardar();
      if (puntos.length) recalcular(0);
    });
  }
  panel.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.ruta !== undefined) {
      const i = Number(d.t);
      tramos[i].elegida = Number(d.ruta);
      const r = elegidaDe(tramos[i]);
      tramos[i].sugerencias = r ? sugerirSifones(r, { alturaMin: umbralSifon() }) : [];
      if (i + 1 < tramos.length) recalcular(i + 1);
      else refrescar();
      return;
    }
    if (d.tipo) {
      const i = Number(d.t);
      if (tramos[i].tipo !== d.tipo) {
        tramos[i] = nuevoTramo(d.tipo);
        recalcular(i);
      }
      return;
    }
    if (d.sug !== undefined) {
      const i = Number(d.t);
      const s = tramos[i].sugerencias?.[Number(d.sug)];
      if (s) convertirEnSifon(i, s);
      return;
    }
    if (d.recalc !== undefined) {
      const i = Number(d.recalc);
      tramos[i] = nuevoTramo('canal');
      recalcular(i);
      return;
    }
    const c = d.c;
    if (c === 'cerrar') abrir(false);
    if (c === 'manantial' || c === 'punto') elegir(c);
    if (c === 'encuadrar') encuadrar();
    if (c === 'quitar' && puntos.length > 1) {
      puntos.pop();
      tramos.pop();
      if (puntos.length === 1) recalcular(0);
      else {
        generacion += 1;
        refrescar();
      }
    }
    if (c === 'borrar') {
      puntos = [];
      tramos = [];
      exploracion = null;
      generacion += 1;
      refrescar();
    }
  });

  // El panel vive en la pestaña «Canal» del panel derecho (la otra es «Vista»).
  const cuerpoVista = document.getElementById('cuerpo-vista');
  const pestanas = document.querySelectorAll('[data-pd]');
  function pestana(nombre) {
    const canal = nombre === 'canal';
    panel.hidden = !canal;
    if (cuerpoVista) cuerpoVista.hidden = canal;
    for (const b of pestanas) b.classList.toggle('a', b.dataset.pd === nombre);
  }
  /** Abre el canal (pestaña y dibujo) o lo oculta del todo. */
  function abrir(v) {
    pestana(v ? 'canal' : 'vista');
    boton.classList.toggle('activo', v);
    grupo.visible = v;
    if (!v) {
      desactivarHerramienta('canal-manantial');
      desactivarHerramienta('canal-punto');
      marcarBotones(null);
    }
  }
  // Cambiar a «Vista» no oculta el trazado: se puede ajustar el relieve viéndolo.
  for (const b of pestanas) {
    b.addEventListener('click', () => {
      if (b.dataset.pd === 'canal') abrir(true);
      else pestana('vista');
    });
  }
  boton.addEventListener('click', () => abrir(!(grupo.visible && !panel.hidden)));
  grupo.visible = false;

  // Redibujar si cambia la exageración o el tamaño de la vista.
  let tam = '';
  const lienzo = escena.renderer.domElement;
  (function vigilar() {
    const { clientWidth: w, clientHeight: h } = lienzo;
    if (puntos.length && (uniformesTerreno.exag.value !== exagDibujada || `${w}x${h}` !== tam)) {
      tam = `${w}x${h}`;
      dibujar();
    }
    requestAnimationFrame(vigilar);
  })();

  return {
    get estado() {
      return {
        puntos,
        tramos,
        exploracion,
        buscando: tramos.some((t) => t.estado === 'buscando' || t.estado === 'pendiente'),
      };
    },
    /** Para pruebas: fija el recorrido y lo calcula. */
    fijar(lista) {
      puntos = lista.slice();
      tramos = puntos.slice(1).map(() => nuevoTramo());
      return recalcular(0);
    },
    convertirEnSifon,
    abrir,
    /** Pone `p` (UTM) como manantial y abre el panel. */
    ponerManantial(p) {
      abrir(true);
      if (puntos.length) puntos[0] = p;
      else puntos = [p];
      if (puntos.length === 1) tramos = [];
      recalcular(0);
    },
  };
}
