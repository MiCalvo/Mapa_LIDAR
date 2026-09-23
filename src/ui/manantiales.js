/**
 * Capa «Manantiales»: puntos conocidos de dos fuentes públicas (IGME, Base de
 * datos de Puntos de Agua; OpenStreetMap, natural=spring). Se ve en el mapa de
 * selección (nivel de 10 km) y en la vista 3D. Al tocar uno se ven sus datos y
 * se puede usar como manantial del canal.
 */
import * as THREE from 'three';
import { utmAGeo, geoAUtm } from '../geo/utm.js';
import { muestreadorSuave, herramientaActiva, texturaPunto } from '../viewer/picar.js';
import { uniformesTerreno } from '../viewer/capaTerreno.js';

const CLAVE = 'mapaLidar.manantiales.v1';
const COLOR = { igme: '#1565c0', osm: '#00897b' };
const NOMBRE = { igme: 'IGME', osm: 'OpenStreetMap' };
const fmt = (v, dec = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function leerPrefs() {
  const def = { activo: false, igme: true, osm: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
  } catch {
    return def;
  }
}

export function montarManantiales({ boton, leyenda, tarjeta, mapa, escena, canal, avisar }) {
  const prefs = leerPrefs();
  const datos = new Map(); // id → manantial
  const estado = { igme: {}, osm: {} }; // por fuente: { cargando, error, demasiado }
  let claveVista = '';
  let enPantalla = 0;
  let aviso = '';
  const guardar = () => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
  };
  const enMapa = () => document.body.dataset.modo === 'mapa';
  const visibles = () => [...datos.values()].filter((p) => prefs[p.fuente]);

  // ---------------------------------------------------------------- zona visible
  function cajaVista() {
    if (enMapa()) {
      if (mapa.nivel?.tipo !== 'celda10') return { lejos: true };
      const c = mapa.lienzo;
      const [n, w] = mapa.deAPantalla(0, 0);
      const [s, e] = mapa.deAPantalla(c.clientWidth, c.clientHeight);
      return { s, w, n, e };
    }
    let caja = null;
    for (const t of escena.terrenos.values()) {
      if (!t.meta || !t.mostrado) continue;
      const huso = t.meta.huso || 30;
      const [x0, y0, x1, y1] = t.extension;
      for (const [x, y] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) {
        const [lat, lon] = utmAGeo(x, y, huso);
        caja = caja
          ? { s: Math.min(caja.s, lat), w: Math.min(caja.w, lon), n: Math.max(caja.n, lat), e: Math.max(caja.e, lon) }
          : { s: lat, w: lon, n: lat, e: lon };
      }
    }
    return caja;
  }

  async function cargar(caja) {
    for (const fuente of ['igme', 'osm']) {
      if (!prefs[fuente]) continue;
      const est = estado[fuente];
      est.cargando = true;
      est.error = null;
      pintarLeyenda();
      try {
        const q = new URLSearchParams({ fuente, s: caja.s.toFixed(5), w: caja.w.toFixed(5), n: caja.n.toFixed(5), e: caja.e.toFixed(5) });
        const r = await fetch(`/api/manantiales?${q}`);
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        est.demasiado = !!j.demasiado;
        for (const p of j.manantiales || []) datos.set(p.id, p);
      } catch (error) {
        est.error = String(error.message || error);
      } finally {
        est.cargando = false;
      }
      redibujar();
    }
  }

  // Cada medio segundo se mira si ha cambiado la zona visible.
  setInterval(() => {
    if (!prefs.activo) return;
    const caja = cajaVista();
    if (!caja) {
      aviso = 'Carga algún bloque de terreno para ver sus manantiales.';
      pintarLeyenda();
      return;
    }
    if (caja.lejos) {
      aviso = 'Acércate al nivel de 10 km para ver los manantiales.';
      pintarLeyenda();
      return;
    }
    aviso = '';
    const clave = [caja.s, caja.w, caja.n, caja.e].map((v) => v.toFixed(3)).join(',') + (prefs.igme ? 'i' : '') + (prefs.osm ? 'o' : '');
    if (clave === claveVista) return;
    claveVista = clave;
    cargar(caja);
  }, 500);

  // ---------------------------------------------------------------- mapa 2D
  mapa.capasExtra = mapa.capasExtra || [];
  mapa.capasExtra.push({
    dibujar(m) {
      if (!prefs.activo || m.nivel?.tipo !== 'celda10') return;
      const ctx = m.ctx;
      const w = m.lienzo.clientWidth;
      const h = m.lienzo.clientHeight;
      let n = 0;
      for (const p of visibles()) {
        const [x, y] = m.aPantalla(p.lat, p.lon);
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        n += 1;
        gota(ctx, x, y, COLOR[p.fuente]);
        const r = 9;
        m.zonasClicFinal.push({
          poli: [[x - r, y - r - 6], [x + r, y - r - 6], [x + r, y + r - 6], [x - r, y + r - 6]],
          accion: () => {
            const b = m.lienzo.getBoundingClientRect();
            mostrarTarjeta(p, b.left + x, b.top + y);
          },
        });
      }
      enPantalla = n;
    },
  });

  function gota(ctx, x, y, color) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 7, y - 8, x - 6, y - 15, x, y - 17);
    ctx.bezierCurveTo(x + 6, y - 15, x + 7, y - 8, x, y);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  // ---------------------------------------------------------------- vista 3D
  const grupo = new THREE.Group();
  escena.scene.add(grupo);
  let enEscena = []; // [{ p, pos: Vector3 }]
  let firma3d = '';

  function construir3D() {
    for (const h of [...grupo.children]) {
      grupo.remove(h);
      h.geometry.dispose();
      h.material.dispose();
    }
    enEscena = [];
    if (!prefs.activo || !escena.origen) return;
    const alt = muestreadorSuave(escena);
    if (!alt) return;
    const [ox, oy, oz] = escena.origen;
    const exag = uniformesTerreno.exag.value;
    const huso = [...escena.terrenos.values()].find((t) => t.meta)?.meta.huso || 30;
    const porFuente = { igme: [], osm: [] };
    for (const p of visibles()) {
      const [x, y] = geoAUtm(p.lat, p.lon, huso);
      const z = alt(x, y);
      if (!Number.isFinite(z)) continue;
      const pos = new THREE.Vector3(x - ox, y - oy, (z - oz) * exag + 3 + exag * 2);
      porFuente[p.fuente].push(pos.x, pos.y, pos.z);
      enEscena.push({ p, pos, x, y, z });
    }
    for (const f of ['igme', 'osm']) {
      if (!porFuente[f].length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(porFuente[f], 3));
      const m = new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, map: texturaPunto(COLOR[f]), transparent: true, depthTest: false });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = 7;
      grupo.add(pts);
    }
    if (!enMapa()) enPantalla = enEscena.length;
  }

  // Reconstruir si cambian los datos, la exageración o los bloques cargados.
  let version = 0;
  function redibujar() {
    version += 1;
    mapa.pendiente = true;
    pintarLeyenda();
  }
  (function vigilar() {
    const f = `${version}|${prefs.activo}|${uniformesTerreno.exag.value}|${[...escena.terrenos.values()].map((t) => (t.texturaSuave ? 1 : 0)).join('')}`;
    if (f !== firma3d) {
      firma3d = f;
      construir3D();
      pintarLeyenda();
    }
    requestAnimationFrame(vigilar);
  })();

  // Clic en 3D: el manantial más cercano al cursor (si no hay otra herramienta activa).
  const lienzo = escena.renderer.domElement;
  let abajo = null;
  lienzo.addEventListener('pointerdown', (e) => {
    abajo = [e.clientX, e.clientY];
  });
  lienzo.addEventListener('pointerup', (e) => {
    if (!prefs.activo || herramientaActiva() || !abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 5) return;
    const r = lienzo.getBoundingClientRect();
    let mejor = null;
    for (const m of enEscena) {
      const v = m.pos.clone().project(escena.camara);
      if (v.z > 1) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - v.y) / 2) * r.height;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < 12 && (!mejor || d < mejor.d)) mejor = { d, m, sx, sy };
    }
    if (mejor) mostrarTarjeta(mejor.m.p, mejor.sx, mejor.sy, mejor.m);
  });

  // ---------------------------------------------------------------- tarjeta y leyenda
  function mostrarTarjeta(p, sx, sy, en3d = null) {
    const filas = [
      ['Tipo', p.tipo],
      ['Fuente', NOMBRE[p.fuente]],
      ['Cota (fuente)', p.cota != null ? `${fmt(p.cota, 1)} m` : '—'],
      en3d ? ['Cota LiDAR', `${fmt(en3d.z, 1)} m`] : null,
      ['Caudal', p.caudal != null ? `${fmt(p.caudal, 2)} l/s` : '—'],
      p.municipio ? ['Municipio', p.municipio] : null,
      p.uso ? ['Uso', p.uso] : null,
      ['Lat, lon', `<code>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</code>`],
    ].filter(Boolean);
    tarjeta.innerHTML = `
      <div class="cab"><b>${p.nombre || 'Manantial sin nombre'}</b><button class="cerrar" data-m="cerrar" aria-label="Cerrar">×</button></div>
      <table>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      <p class="nota">Los datos vienen tal cual de la fuente; la posición y la cota pueden ser aproximadas.</p>
      <div class="acciones">
        ${en3d ? '<button class="prim" data-m="usar">Usar como manantial</button>' : ''}
        ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Ficha en ${NOMBRE[p.fuente]}</a>` : ''}
      </div>`;
    tarjeta.hidden = false;
    const w = tarjeta.offsetWidth;
    const h = tarjeta.offsetHeight;
    tarjeta.style.left = `${Math.min(window.innerWidth - w - 12, sx + 16)}px`;
    tarjeta.style.top = `${Math.min(window.innerHeight - h - 12, Math.max(80, sy - h / 2))}px`;
    tarjeta.onclick = (e) => {
      const c = e.target.closest('[data-m]')?.dataset.m;
      if (c === 'cerrar') tarjeta.hidden = true;
      if (c === 'usar' && en3d) {
        tarjeta.hidden = true;
        canal.ponerManantial({ x: en3d.x, y: en3d.y });
      }
    };
  }

  function pintarLeyenda() {
    leyenda.hidden = !prefs.activo;
    boton.classList.toggle('activo', prefs.activo);
    if (!prefs.activo) return;
    const estados = ['igme', 'osm']
      .filter((f) => prefs[f])
      .map((f) => {
        const e = estado[f];
        if (e.cargando) return `${NOMBRE[f]}: cargando…`;
        if (e.error) return `<span class="err">${NOMBRE[f]}: ${e.error}</span>`;
        if (e.demasiado) return `${NOMBRE[f]}: zona demasiado grande`;
        return '';
      })
      .filter(Boolean);
    leyenda.innerHTML = `
      <b>Manantiales</b>
      <label><input type="checkbox" data-f="igme" ${prefs.igme ? 'checked' : ''}/><i style="background:${COLOR.igme}"></i>IGME</label>
      <label title="OpenStreetMap"><input type="checkbox" data-f="osm" ${prefs.osm ? 'checked' : ''}/><i style="background:${COLOR.osm}"></i>OSM</label>
      <span class="n">${aviso || `${enPantalla} en la vista`}</span>
      ${estados.length ? `<span class="n">${estados.join(' · ')}</span>` : ''}
      <small>IGME · © OpenStreetMap (ODbL)</small>`;
  }
  leyenda.addEventListener('change', (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    prefs[f] = e.target.checked;
    guardar();
    claveVista = '';
    redibujar();
  });

  boton.addEventListener('click', () => {
    prefs.activo = !prefs.activo;
    guardar();
    claveVista = '';
    if (!prefs.activo) tarjeta.hidden = true;
    redibujar();
  });
  pintarLeyenda();

  return {
    get datos() {
      return datos;
    },
    get enEscena() {
      return enEscena;
    },
    mostrarTarjeta,
  };
}
