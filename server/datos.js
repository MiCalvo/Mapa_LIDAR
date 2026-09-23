/**
 * Servidor de datos local de Mapa LiDAR.
 *
 *   GET /api/zonas                    → zonas y bloques COPC disponibles
 *   /api/mapa/*, /api/sistema         → mapa de selección y descargas (servicio.js)
 *   GET /datos/<zona>/<fichero>       .copc.laz (con Range), .terreno.json, .mdt.bin, .mds.bin
 *
 * Carpeta de datos: MAPA_LIDAR_DATOS (por defecto ./data/zonas).
 * Cada zona es una subcarpeta con zona.json y bloques: *.copc.laz (puntos) y/o
 * *.terreno.json + *.mdt.bin + *.mds.bin (terreno, de tools/lidar2mdt.py).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearServicio } from './servicio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/;

export function carpetaDatos() {
  const conf = String(process.env.MAPA_LIDAR_DATOS || '').trim();
  return conf ? path.resolve(ROOT, conf) : path.join(ROOT, 'data', 'zonas');
}

function leerJson(fichero) {
  try {
    return JSON.parse(fs.readFileSync(fichero, 'utf8'));
  } catch {
    return null;
  }
}

const RE_COPC = /\.copc\.laz$/i;
const RE_TERRENO = /\.terreno\.json$/i;
const RE_SERVIBLE = /\.(copc\.laz|terreno\.json|mdt\.bin|mds\.bin)$/i;

/**
 * Bloques de una zona. Un bloque es un nombre base con nube de puntos
 * (<base>.copc.laz), terreno (<base>.terreno.json + .mdt/.mds.bin) o ambos.
 */
function listarBloques(dir, zonaId, meta) {
  const porBase = new Map();
  const url = (f) => `/datos/${encodeURIComponent(zonaId)}/${encodeURIComponent(f)}`;
  for (const f of fs.readdirSync(dir)) {
    if (!ID_RE.test(f)) continue;
    let base;
    let tipo;
    if (RE_COPC.test(f)) [base, tipo] = [f.replace(RE_COPC, ''), 'copc'];
    else if (RE_TERRENO.test(f)) [base, tipo] = [f.replace(RE_TERRENO, ''), 'terreno'];
    else continue;
    const b = porBase.get(base) || { id: base, url: null, terreno: null, bytes: 0 };
    if (tipo === 'copc') {
      b.url = url(f);
      b.bytes = fs.statSync(path.join(dir, f)).size;
    } else {
      b.terreno = url(f);
    }
    porBase.set(base, b);
  }
  return [...porBase.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((b) => {
      // zona.json puede indexar por nombre base o por fichero .copc.laz.
      const info = meta.bloques?.[b.id] || meta.bloques?.[`${b.id}.copc.laz`] || {};
      return {
        ...b,
        nombre: info.nombre || b.id,
        puntos: Number.isFinite(info.puntos) ? info.puntos : null,
      };
    });
}

/** Lista las zonas con sus bloques (nube COPC y/o terreno). */
export function listarZonas(raiz = carpetaDatos()) {
  let entradas = [];
  try {
    entradas = fs.readdirSync(raiz, { withFileTypes: true });
  } catch {
    return [];
  }
  const zonas = [];
  for (const e of entradas) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const dir = path.join(raiz, e.name);
    const meta = leerJson(path.join(dir, 'zona.json')) || {};
    const bloques = listarBloques(dir, e.name, meta);
    zonas.push({
      id: e.name,
      nombre: typeof meta.nombre === 'string' ? meta.nombre : e.name,
      descripcion: meta.descripcion || '',
      fuente: meta.fuente || '',
      licencia: meta.licencia || '',
      crs: meta.crs || '',
      ondulacionGeoideM: Number.isFinite(meta.ondulacionGeoideM)
        ? meta.ondulacionGeoideM
        : 0,
      centro: Array.isArray(meta.centro) ? meta.centro : null,
      bloques,
    });
  }
  return zonas.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Ruta segura de un fichero pedido, o null. */
export function resolverFichero(raiz, zona, fichero) {
  if (!ID_RE.test(zona) || !ID_RE.test(fichero)) return null;
  if (!RE_SERVIBLE.test(fichero)) return null;
  const base = path.resolve(raiz);
  const completo = path.resolve(base, zona, fichero);
  return completo.startsWith(base + path.sep) ? completo : null;
}

/** Interpreta la cabecera Range (un solo rango). */
export function parsearRango(cabecera, tam) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(cabecera || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let inicio;
  let fin;
  if (m[1] === '') {
    const n = Number(m[2]);
    inicio = Math.max(0, tam - n);
    fin = tam - 1;
  } else {
    inicio = Number(m[1]);
    fin = m[2] === '' ? tam - 1 : Math.min(Number(m[2]), tam - 1);
  }
  if (!(inicio <= fin) || inicio >= tam) return 'invalido';
  return { inicio, fin };
}

export function crearMiddleware({ raiz, servicio } = {}) {
  return (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const base = raiz || carpetaDatos();
    if (servicio && /^\/api\/(mapa|sistema|buscar|orto|manantiales)(\/|$)/.test(url.pathname)) {
      Promise.resolve(servicio.manejar(req, res, url))
        .then((hecho) => {
          if (hecho === false) next();
        })
        .catch((error) => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: String(error?.message || error) }));
        });
      return;
    }
    if (url.pathname === '/api/zonas') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ zonas: listarZonas(base) }));
      return;
    }
    const m = /^\/datos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!m) return next();
    let zona;
    let fichero;
    try {
      zona = decodeURIComponent(m[1]);
      fichero = decodeURIComponent(m[2]);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const ruta = resolverFichero(base, zona, fichero);
    let stat = null;
    try {
      stat = ruta ? fs.statSync(ruta) : null;
    } catch {
      stat = null;
    }
    if (!stat?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    const rango = parsearRango(req.headers?.range, stat.size);
    if (rango === 'invalido') {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const comunes = {
      'Content-Type': RE_TERRENO.test(ruta)
        ? 'application/json; charset=utf-8'
        : 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    if (!rango) {
      res.writeHead(200, { ...comunes, 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(ruta).pipe(res);
      return;
    }
    res.writeHead(206, {
      ...comunes,
      'Content-Length': rango.fin - rango.inicio + 1,
      'Content-Range': `bytes ${rango.inicio}-${rango.fin}/${stat.size}`,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(ruta, { start: rango.inicio, end: rango.fin }).pipe(res);
  };
}

export function pluginDatos() {
  let servicio = null;
  const instalar = (server) => {
    servicio ??= crearServicio({ zonas: carpetaDatos() });
    server.middlewares.use(crearMiddleware({ servicio }));
  };
  return {
    name: 'mapa-lidar-datos',
    configureServer: instalar,
    configurePreviewServer: instalar,
  };
}
