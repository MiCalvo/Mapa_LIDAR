/**
 * Servicio del mapa de selección: catálogos, estado de bloques, cola de
 * descargas y procesado (tools/lidar2mdt.py).
 *
 *   GET  /api/mapa/resumen                  recuento por celda de 10 km
 *   GET  /api/mapa/bloques?huso&x&y         los 25 bloques de una celda de 10 km
 *   POST /api/mapa/trabajos  {bloques:[{huso,x,y}], accion:'descargar'|'procesar'}
 *   GET  /api/mapa/trabajos                 cola y progreso
 *   GET  /api/sistema                       Python y paquetes para procesar
 *   POST /api/sistema/instalar              pip install --user laspy[lazrs] numpy
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FUENTES,
  CNIG,
  CELDA_KM,
  BLOQUE_KM,
  clave,
  nombreBloque,
  parsearCyl,
  parsearTeselasEus,
  enlacesDeListado,
  indiceLocal,
  estados,
  resumen,
} from './catalogo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIAS_CACHE = 30;

export function crearServicio({ raiz = ROOT, zonas, descargar = true } = {}) {
  const dirs = {
    zonas: zonas || path.join(raiz, 'data', 'zonas'),
    entrada: path.join(raiz, 'data', 'entrada'),
    catalogos: path.join(raiz, 'data', 'catalogos'),
    herramienta: path.join(raiz, 'tools', 'lidar2mdt.py'),
    ortofotos: path.join(raiz, 'data', 'ortofotos'),
    // LAZ bajados a mano (CNIG…) que siguen en la carpeta de Descargas: se detectan sin moverlos.
    extra: descargar
      ? ['Downloads', 'Descargas']
          .map((n) => path.join(os.homedir(), n))
          .filter((d, i, l) => l.indexOf(d) === i && fs.existsSync(d))
          .map((d) => ({ dir: d, etiqueta: 'Descargas', profundidad: 0 }))
      : [],
  };
  const catalogos = { cyl: null, eus: null };
  const estadoCatalogos = { cyl: 'pendiente', eus: 'pendiente' };
  let cacheEstados = null;
  let cacheEstadosT = 0;

  // ------------------------------------------------------------------ catálogos
  function leerCache(nombre) {
    const f = path.join(dirs.catalogos, nombre);
    try {
      const st = fs.statSync(f);
      return { texto: fs.readFileSync(f, 'utf8'), edadDias: (Date.now() - st.mtimeMs) / 864e5 };
    } catch {
      return null;
    }
  }
  function guardarCache(nombre, texto) {
    fs.mkdirSync(dirs.catalogos, { recursive: true });
    fs.writeFileSync(path.join(dirs.catalogos, nombre), texto);
  }

  async function cargarCyl() {
    const cache = leerCache('cyl_pnoa2_urls.txt');
    let texto = cache?.texto;
    if (descargar && (!cache || cache.edadDias > DIAS_CACHE)) {
      try {
        const r = await fetch(FUENTES.cyl.lista);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        texto = await r.text();
        guardarCache('cyl_pnoa2_urls.txt', texto);
      } catch (error) {
        if (!texto) throw error;
      }
    }
    if (!texto) throw new Error('sin catálogo');
    catalogos.cyl = parsearCyl(texto);
  }

  async function cargarEus() {
    const cache = leerCache('geoeuskadi_2017.txt');
    let texto = cache?.texto;
    if (descargar && (!cache || cache.edadDias > DIAS_CACHE)) {
      try {
        // En algunos PC Node no valida el certificado https de geo.euskadi.eus (le falta la
        // cadena intermedia, que el navegador sí completa): se reintenta por http.
        let base = FUENTES.eus.lista;
        let r;
        try {
          r = await fetch(base);
        } catch {
          base = base.replace(/^https:/, 'http:');
          r = await fetch(base);
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const hojas = enlacesDeListado(await r.text(), base).filter((u) => /\/\d{3}\/$/.test(u));
        const urls = [];
        let fallos = 0;
        for (const hoja of hojas) {
          try {
            const rh = await fetch(hoja);
            if (!rh.ok) throw new Error(`HTTP ${rh.status}`);
            urls.push(...enlacesDeListado(await rh.text(), hoja).filter((u) => /\.laz$/i.test(u)));
          } catch {
            fallos += 1; // una hoja que falla no invalida el resto
          }
        }
        if (fallos && !urls.length) throw new Error(`no se pudo leer ninguna de las ${hojas.length} hojas`);
        if (!urls.length) throw new Error('listado vacío');
        texto = urls.join('\n');
        guardarCache('geoeuskadi_2017.txt', texto);
      } catch (error) {
        if (!texto) throw error;
      }
    }
    if (!texto) throw new Error('sin catálogo');
    catalogos.eus = parsearTeselasEus(texto.split('\n'));
  }

  async function cargarCatalogos() {
    for (const [id, fn] of [['cyl', cargarCyl], ['eus', cargarEus]]) {
      estadoCatalogos[id] = 'cargando';
      try {
        await fn();
        estadoCatalogos[id] = `ok (${catalogos[id].size} bloques)`;
      } catch (error) {
        const causa = error?.cause?.code || error?.cause?.message;
        estadoCatalogos[id] = `error: ${error?.message || error}${causa ? ` (${causa})` : ''}`;
      }
      cacheEstados = null;
    }
  }
  const promesaCatalogos = cargarCatalogos();

  function todosLosEstados() {
    // El índice local se relee como mucho cada 2 s (lista de ficheros + cabeceras en caché).
    if (!cacheEstados || Date.now() - cacheEstadosT > 2000) {
      cacheEstados = estados({ local: indiceLocal(dirs), catalogos });
      cacheEstadosT = Date.now();
    }
    return cacheEstados;
  }

  // ------------------------------------------------------------------ Python
  let python = null; // { cmd, args, ok, detalle }
  async function probar(cmd, args) {
    return new Promise((resolve) => {
      let out = '';
      let p;
      try {
        p = spawn(cmd, [...args, '-c', 'import sys, numpy, laspy, lazrs; print(sys.executable)'], {
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        });
      } catch {
        resolve(null);
        return;
      }
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('error', () => resolve(null));
      p.on('close', (code) => resolve({ code, out: out.trim() }));
    });
  }
  async function detectarPython(forzar = false) {
    if (python && !forzar) return python;
    const cands = [];
    if (process.env.MAPA_LIDAR_PYTHON) cands.push([process.env.MAPA_LIDAR_PYTHON, []]);
    if (process.platform === 'win32') {
      const home = os.homedir();
      for (const d of ['miniforge3', 'miniconda3', 'anaconda3', 'mambaforge']) {
        cands.push([path.join(home, d, 'python.exe'), []]);
      }
      cands.push(['py', ['-3']], ['python', []]);
    } else {
      cands.push(['python3', []], ['python', []]);
    }
    let primeroQueArranca = null;
    for (const [cmd, args] of cands) {
      if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) continue;
      const r = await probar(cmd, args);
      if (!r) continue;
      if (r.code === 0) {
        python = { cmd, args, ok: true, detalle: r.out.split('\n').pop() };
        return python;
      }
      if (!primeroQueArranca && !/no se reconoce|not recognized|not found/i.test(r.out)) {
        primeroQueArranca = { cmd, args, ok: false, detalle: r.out.split('\n').slice(-1)[0] };
      }
    }
    python = primeroQueArranca || { cmd: null, args: [], ok: false, detalle: 'No se encuentra Python 3' };
    return python;
  }

  function ejecutar(cmd, args, alLinea) {
    return new Promise((resolve, reject) => {
      // UTF-8 forzado: en Windows la salida redirigida de Python usa cp1252 y falla con «→», «×»…
      const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
      const p = spawn(cmd, args, { windowsHide: true, cwd: raiz, env });
      let cola = '';
      let ultimo = '';
      const leer = (d) => {
        cola += d;
        const lineas = cola.split(/\r?\n/);
        cola = lineas.pop();
        for (const l of lineas) {
          if (l.trim()) ultimo = l.trim();
          alLinea?.(l);
        }
      };
      p.stdout.on('data', leer);
      p.stderr.on('data', leer);
      p.on('error', reject);
      p.on('close', (code) => {
        if (cola.trim()) ultimo = cola.trim();
        if (code === 0) resolve(ultimo);
        else reject(new Error(ultimo || `código ${code}`));
      });
    });
  }

  let instalando = null;
  async function instalar() {
    const py = await detectarPython();
    if (!py.cmd) throw new Error('No hay Python 3 instalado. Instálalo (python.org o miniforge) y reinicia la app.');
    instalando ??= ejecutar(py.cmd, [...py.args, '-m', 'pip', 'install', '--user', 'laspy[lazrs]', 'numpy'])
      .then(() => detectarPython(true))
      .finally(() => {
        instalando = null;
      });
    return instalando;
  }

  // ------------------------------------------------------------------ trabajos
  const trabajos = []; // { id, huso, x, y, accion, estado, progreso, mensaje, bytes, total }
  let siguienteId = 1;
  let corriendo = false;

  function encolar(bloques, accion) {
    const nuevos = [];
    for (const b of bloques) {
      const huso = Number(b.huso);
      const x = Number(b.x);
      const y = Number(b.y);
      if (![huso, x, y].every(Number.isFinite)) continue;
      const ya = trabajos.find(
        (t) => t.huso === huso && t.x === x && t.y === y && !['hecho', 'error'].includes(t.estado),
      );
      if (ya) continue;
      const t = { id: siguienteId++, huso, x, y, accion, estado: 'en cola', progreso: 0, mensaje: '' };
      trabajos.push(t);
      nuevos.push(t);
    }
    // Se guardan como mucho los 50 últimos terminados.
    const terminados = trabajos.filter((t) => ['hecho', 'error'].includes(t.estado));
    for (const t of terminados.slice(0, Math.max(0, terminados.length - 50))) trabajos.splice(trabajos.indexOf(t), 1);
    if (!corriendo) correr();
    return nuevos;
  }

  async function correr() {
    corriendo = true;
    try {
      for (;;) {
        const t = trabajos.find((x) => x.estado === 'en cola');
        if (!t) break;
        try {
          await hacer(t);
          t.estado = 'hecho';
          t.progreso = 1;
        } catch (error) {
          t.estado = 'error';
          t.mensaje = String(error?.message || error).slice(0, 400);
        }
        cacheEstados = null;
      }
    } finally {
      corriendo = false;
    }
  }

  async function bajar(url, destino, t, base) {
    if (fs.existsSync(destino)) return 0;
    const r = await fetch(url);
    if (!r.ok || !r.body) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    const total = Number(r.headers.get('content-length')) || 0;
    t.total = (t.total || 0) + total;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const parcial = `${destino}.part`;
    const fh = fs.createWriteStream(parcial);
    try {
      for await (const trozo of r.body) {
        if (!fh.write(trozo)) await new Promise((ok) => fh.once('drain', ok));
        t.bytes = (t.bytes || 0) + trozo.length;
        if (t.total) t.progreso = base + (0.8 * t.bytes) / t.total;
      }
    } finally {
      await new Promise((ok) => fh.end(ok));
    }
    fs.renameSync(parcial, destino);
    return total;
  }

  async function hacer(t) {
    await promesaCatalogos;
    const k = clave(t.huso, t.x, t.y);
    const ext = [t.x * 1000, t.y * 1000, (t.x + BLOQUE_KM) * 1000, (t.y + BLOQUE_KM) * 1000];
    let entradas = [];
    let fuente = null;

    if (t.accion === 'descargar') {
      t.estado = 'descargando';
      if (catalogos.cyl?.has(k)) {
        fuente = FUENTES.cyl;
        let ultimoError = null;
        for (const c of catalogos.cyl.get(k)) {
          const destino = path.join(dirs.entrada, fuente.carpetaEntrada, c.fichero);
          try {
            t.mensaje = c.fichero;
            await bajar(c.url, destino, t, 0);
            entradas = [destino];
            break;
          } catch (error) {
            ultimoError = error;
          }
        }
        if (!entradas.length) {
          throw new Error(
            `El enlace de Castilla y León no responde (${ultimoError?.message || 'error'}). ` +
              'Puede que ese sector (CE/NW) no esté publicado todavía en open.scayle.es.',
          );
        }
      } else if (catalogos.eus?.has(k)) {
        fuente = FUENTES.eus;
        const teselas = catalogos.eus.get(k);
        let i = 0;
        for (const c of teselas) {
          i += 1;
          t.mensaje = `tesela ${i}/${teselas.length}`;
          const destino = path.join(dirs.entrada, fuente.carpetaEntrada, c.fichero);
          await bajar(c.url, destino, t, 0);
          entradas.push(destino);
        }
      } else {
        throw new Error('No hay descarga automática para este bloque: bájalo del CNIG (botón «Cómo conseguirlo») y déjalo en Descargas o en data/entrada.');
      }
    } else {
      const info = todosLosEstados().get(k);
      entradas = [...new Set(info?.rutas || [])];
      if (!entradas.length) throw new Error('No hay ficheros LAZ (data/entrada o Descargas) para este bloque.');
      fuente = entradas.some((e) => e.includes(FUENTES.eus.carpetaEntrada))
        ? FUENTES.eus
        : entradas.some((e) => e.includes(FUENTES.cyl.carpetaEntrada))
          ? FUENTES.cyl
          : null;
    }

    // Procesado → data/zonas/<zona>/<H.._X.._Y..>.terreno.json
    t.estado = 'procesando';
    t.progreso = Math.max(t.progreso, 0.8);
    const py = await detectarPython();
    if (!py.ok) {
      throw new Error(
        py.cmd
          ? 'Descargado. Para generar el terreno faltan paquetes de Python: pulsa «Instalar paquetes» y luego «Procesar».'
          : 'Descargado. Para generar el terreno hace falta Python 3 (python.org o miniforge); luego pulsa «Procesar».',
      );
    }
    const zonaId = fuente?.zona || 'descargas';
    const res = fuente?.res ?? resolucionPorDensidad(entradas, ext);
    const salida = path.join(dirs.zonas, zonaId);
    const base = nombreBloque(t.huso, t.x, t.y);
    const args = [
      ...py.args,
      dirs.herramienta,
      ...entradas,
      '--salida', salida,
      '--nombre', base,
      '--extension', ...ext.map(String),
      '--huso', String(t.huso),
      '--res', String(res),
    ];
    await ejecutar(py.cmd, args, (l) => {
      const m = /^PROGRESO (\d+)\/(\d+)/.exec(l);
      if (m) t.progreso = 0.8 + (0.2 * Number(m[1])) / Math.max(1, Number(m[2]));
    });
    registrarEnZona(salida, zonaId, fuente, base, t);
    t.mensaje = `terreno listo (celda ${res} m)`;
  }

  function resolucionPorDensidad(entradas, ext) {
    const loc = indiceLocal(dirs).entradas.filter((e) => entradas.includes(e.ruta));
    const puntos = loc.reduce((s, e) => s + e.puntos, 0);
    const area = loc.reduce((s, e) => s + (e.ext[2] - e.ext[0]) * (e.ext[3] - e.ext[1]), 0) || 1;
    void ext;
    return puntos / area >= 4 ? 1 : 2;
  }

  function registrarEnZona(dir, zonaId, fuente, base, t) {
    const f = path.join(dir, 'zona.json');
    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      meta = {
        nombre: fuente ? `${fuente.nombre} · descargas` : 'Procesados desde data/entrada',
        descripcion: 'Bloques de 2×2 km añadidos desde el mapa de selección.',
        fuente: fuente?.web || '',
        licencia: fuente?.licencia || '',
        crs: `ETRS89 / UTM ${t.huso}N`,
        bloques: {},
      };
    }
    meta.bloques ||= {};
    let puntos = null;
    try {
      puntos = JSON.parse(fs.readFileSync(path.join(dir, `${base}.terreno.json`), 'utf8')).puntos;
    } catch {
      puntos = null;
    }
    meta.bloques[base] = { nombre: `Bloque ${t.x}-${t.y} km · H${t.huso}`, puntos };
    fs.writeFileSync(f, JSON.stringify(meta, null, 2));
    void zonaId;
  }

  // ------------------------------------------------------------------ ortofoto (PNOA, IGN)
  // WMS del PNOA de máxima actualidad (CC BY 4.0 scne.es). El servidor la pide y la guarda
  // en data/ortofotos, así el navegador la usa como textura sin problemas de CORS.
  const WMS_ORTO = process.env.MAPA_LIDAR_WMS_ORTO || 'https://www.ign.es/wms-inspire/pnoa-ma';
  const pidiendoOrto = new Map();
  async function servirOrto(res, url) {
    const q = (k) => Number(url.searchParams.get(k));
    const huso = q('huso');
    const [x0, y0, x1, y1] = ['x0', 'y0', 'x1', 'y1'].map(q);
    const px = Math.min(4096, Math.max(256, q('px') || 2048));
    if (![huso, x0, y0, x1, y1].every(Number.isFinite) || ![29, 30, 31].includes(huso) || x1 <= x0 || y1 <= y0 || x1 - x0 > 10000 || y1 - y0 > 10000) {
      return json(res, 400, { error: 'parámetros de ortofoto no válidos' });
    }
    const f = path.join(dirs.ortofotos, `H${huso}_${x0}_${y0}_${x1}_${y1}_${px}.jpg`);
    try {
      if (!fs.existsSync(f)) {
        if (!pidiendoOrto.has(f)) {
          const u = new URL(WMS_ORTO);
          const alto = Math.round((px * (y1 - y0)) / (x1 - x0));
          u.search = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: '1.3.0',
            REQUEST: 'GetMap',
            LAYERS: 'OI.OrthoimageCoverage',
            STYLES: '',
            CRS: `EPSG:258${huso}`,
            BBOX: `${x0},${y0},${x1},${y1}`, // en UTM el orden de ejes es este, norte
            WIDTH: String(px),
            HEIGHT: String(alto),
            FORMAT: 'image/jpeg',
          }).toString();
          pidiendoOrto.set(
            f,
            (async () => {
              const r = await fetch(u, { headers: { 'User-Agent': 'MapaLidar/0.3 (visor LiDAR local de código abierto)' } });
              const tipo = r.headers.get('content-type') || '';
              if (!r.ok || !tipo.startsWith('image/')) {
                const txt = tipo.startsWith('image/') ? '' : (await r.text()).slice(0, 200);
                throw new Error(`WMS ${r.status} ${txt}`.trim());
              }
              fs.mkdirSync(dirs.ortofotos, { recursive: true });
              fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
            })().finally(() => pidiendoOrto.delete(f)),
          );
        }
        await pidiendoOrto.get(f);
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' });
      fs.createReadStream(f).pipe(res);
      return true;
    } catch (error) {
      const causa = error?.cause?.code || error?.cause?.message;
      return json(res, 502, { error: `Ortofoto no disponible: ${error?.message || error}${causa ? ` (${causa})` : ''}` });
    }
  }

  // ------------------------------------------------------------------ buscador de lugares
  // Nominatim (OpenStreetMap): máx. 1 petición/s, con User-Agent propio y caché.
  // Se busca solo al pulsar «Buscar», nunca mientras se escribe.
  const cacheLugares = new Map();
  let ultimaBusqueda = 0;
  async function buscarLugar(texto) {
    const k = texto.toLowerCase();
    if (cacheLugares.has(k)) return cacheLugares.get(k);
    const espera = ultimaBusqueda + 1100 - Date.now();
    if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
    ultimaBusqueda = Date.now();
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.search = new URLSearchParams({
      q: texto,
      format: 'jsonv2',
      limit: '8',
      countrycodes: 'es,pt,ad',
      'accept-language': 'es',
    }).toString();
    const r = await fetch(u, { headers: { 'User-Agent': 'MapaLidar/0.3 (visor LiDAR local de código abierto)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lista = (await r.json()).map((l) => ({
      nombre: l.display_name,
      corto: l.name || String(l.display_name).split(',')[0],
      tipo: l.addresstype || l.type || '',
      lat: Number(l.lat),
      lon: Number(l.lon),
    }));
    cacheLugares.set(k, lista);
    if (cacheLugares.size > 300) cacheLugares.delete(cacheLugares.keys().next().value);
    return lista;
  }

  // ------------------------------------------------------------------ HTTP
  function json(res, codigo, cuerpo) {
    res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(cuerpo));
  }
  function leerCuerpo(req) {
    return new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => {
        d += c;
        if (d.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(d || '{}'));
        } catch {
          resolve({});
        }
      });
    });
  }

  async function manejar(req, res, url) {
    const ruta = url.pathname;
    if (ruta === '/api/mapa/resumen') {
      const info = todosLosEstados();
      return json(res, 200, {
        catalogos: estadoCatalogos,
        fuentes: Object.values(FUENTES).map(({ id, nombre, web, licencia }) => ({ id, nombre, web, licencia })),
        cnig: CNIG,
        celdas: resumen(info),
      });
    }
    if (ruta === '/api/mapa/bloques') {
      // Una celda de 10 km (x, y) o un rectángulo en km (x0, y0, x1, y1).
      const q = (k) => Number(url.searchParams.get(k));
      const huso = q('huso');
      let [x0, y0, x1, y1] = url.searchParams.has('x0')
        ? [q('x0'), q('y0'), q('x1'), q('y1')]
        : [q('x'), q('y'), q('x') + CELDA_KM, q('y') + CELDA_KM];
      if (![huso, x0, y0, x1, y1].every(Number.isFinite)) return json(res, 400, { error: 'huso y coordenadas' });
      x0 = Math.floor(x0 / BLOQUE_KM) * BLOQUE_KM;
      y0 = Math.floor(y0 / BLOQUE_KM) * BLOQUE_KM;
      x1 = Math.ceil(x1 / BLOQUE_KM) * BLOQUE_KM;
      y1 = Math.ceil(y1 / BLOQUE_KM) * BLOQUE_KM;
      if (((x1 - x0) / BLOQUE_KM) * ((y1 - y0) / BLOQUE_KM) > 2500) {
        return json(res, 400, { error: 'Área demasiado grande (máximo 2500 bloques)' });
      }
      const info = todosLosEstados();
      const bloques = [];
      for (let y = y1 - BLOQUE_KM; y >= y0; y -= BLOQUE_KM) {
        for (let x = x0; x < x1; x += BLOQUE_KM) {
          const b = info.get(clave(huso, x, y));
          const t = [...trabajos].reverse().find((j) => j.huso === huso && j.x === x && j.y === y);
          bloques.push({
            ...(b || { huso, x, y, estado: 'sin-datos', terrenos: [], entradas: [], fuentes: [], cobertura: 0 }),
            trabajo: t || null,
          });
        }
      }
      return json(res, 200, { bloques });
    }
    if (ruta === '/api/orto') {
      return servirOrto(res, url);
    }
    if (ruta === '/api/buscar') {
      const texto = String(url.searchParams.get('q') || '').trim().slice(0, 100);
      if (texto.length < 2) return json(res, 200, { resultados: [] });
      try {
        return json(res, 200, { resultados: await buscarLugar(texto) });
      } catch (error) {
        return json(res, 502, { error: `Buscador no disponible: ${error?.message || error}` });
      }
    }
    if (ruta === '/api/mapa/trabajos') {
      if (req.method === 'POST') {
        const cuerpo = await leerCuerpo(req);
        const accion = cuerpo.accion === 'procesar' ? 'procesar' : 'descargar';
        const nuevos = encolar(Array.isArray(cuerpo.bloques) ? cuerpo.bloques.slice(0, 200) : [], accion);
        return json(res, 200, { encolados: nuevos.length });
      }
      return json(res, 200, { trabajos });
    }
    if (ruta === '/api/sistema') {
      const py = await detectarPython(url.searchParams.has('recomprobar'));
      return json(res, 200, { python: py, instalando: Boolean(instalando) });
    }
    if (ruta === '/api/sistema/instalar' && req.method === 'POST') {
      try {
        const py = await instalar();
        return json(res, 200, { python: py });
      } catch (error) {
        return json(res, 500, { error: String(error?.message || error) });
      }
    }
    return false;
  }

  return { manejar, promesaCatalogos, todosLosEstados, encolar, trabajos, catalogos, dirs };
}
