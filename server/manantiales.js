/**
 * Manantiales conocidos, de dos fuentes públicas:
 *  - IGME, Base de datos de Puntos de Agua (servicio ArcGIS REST, campo «Naturaleza»).
 *  - OpenStreetMap, nodos con natural=spring (API Overpass). Licencia ODbL.
 * Se piden por teselas de 0,1° × 0,1° y cada tesela se guarda en
 * data/manantiales/<fuente>/ para no repetir consultas.
 */
import fs from 'node:fs';
import path from 'node:path';

export const IGME_URL = 'https://mapas.igme.es/gis/rest/services/BasesDatos/IGME_PuntosAgua/MapServer';
export const IGME_CAPAS = [0, 1];
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const UA = 'MapaLidar/0.3 (visor LiDAR local de código abierto)';
const TESELA = 0.1; // grados
export const MAX_TESELAS = 36;
const DIAS_CACHE = 90;

/** Teselas (índices enteros de 0,1°) que cubren el rectángulo geográfico. */
export function teselasDe(s, w, n, e) {
  const out = [];
  for (let la = Math.floor(s / TESELA); la <= Math.floor((n - 1e-9) / TESELA); la += 1) {
    for (let lo = Math.floor(w / TESELA); lo <= Math.floor((e - 1e-9) / TESELA); lo += 1) out.push([la, lo]);
  }
  return out;
}
const cajaDe = ([la, lo]) => ({ s: la * TESELA, w: lo * TESELA, n: (la + 1) * TESELA, e: (lo + 1) * TESELA });

const num = (v) => {
  const x = typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.-]/g, '')) : Number(v);
  return Number.isFinite(x) && v !== null && v !== '' ? x : null;
};

/** Respuesta JSON de ArcGIS (query) → manantiales normalizados. */
export function normalizarIgme(json, capa = 0) {
  const out = [];
  for (const f of json?.features || []) {
    const a = f.attributes || {};
    const g = f.geometry || {};
    const nat = String(a.Naturaleza ?? a.NATURALEZA ?? '');
    if (!/manantial/i.test(nat)) continue;
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const id = a.Id ?? a.ID ?? a.OBJECTID ?? `${g.x},${g.y}`;
    out.push({
      id: `igme/${capa}/${id}`,
      fuente: 'igme',
      lat: g.y,
      lon: g.x,
      nombre: (a.TOPONIMIA || '').trim() || null,
      tipo: nat.trim(),
      cota: num(a.COTA_msnm),
      caudal: num(a.Caudal_Referencia_L_s),
      municipio: [a.Municipio, a.Provincia].filter(Boolean).join(', ') || null,
      uso: a.Usos_Agua || null,
      url: a.URLDetalle || null,
    });
  }
  return out;
}

/** Respuesta de Overpass → manantiales normalizados. */
export function normalizarOsm(json) {
  const out = [];
  for (const el of json?.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = el.tags || {};
    out.push({
      id: `osm/${el.type}/${el.id}`,
      fuente: 'osm',
      lat,
      lon,
      nombre: t.name || t['name:es'] || null,
      tipo: 'Manantial (OSM)',
      cota: num(t.ele),
      caudal: null,
      municipio: null,
      uso: t.drinking_water === 'yes' ? 'agua potable (según OSM)' : null,
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }
  return out;
}

export function crearManantiales({ dir }) {
  let whereIgme = "UPPER(Naturaleza) LIKE '%MANANTIAL%'"; // si el servidor no lo admite se pasa a 1=1
  let ultimaOverpass = 0;

  const fichero = (fuente, [la, lo]) => path.join(dir, fuente, `${la}_${lo}.json`);
  function leer(fuente, t) {
    try {
      const f = fichero(fuente, t);
      if ((Date.now() - fs.statSync(f).mtimeMs) / 864e5 > DIAS_CACHE) return null;
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  }
  function guardar(fuente, t, lista) {
    fs.mkdirSync(path.join(dir, fuente), { recursive: true });
    fs.writeFileSync(fichero(fuente, t), JSON.stringify(lista));
  }

  async function igmeTesela(t) {
    const c = cajaDe(t);
    const lista = [];
    for (const capa of IGME_CAPAS) {
      const pedir = async (where) => {
        const u = new URL(`${IGME_URL}/${capa}/query`);
        u.search = new URLSearchParams({
          where,
          geometry: `${c.w},${c.s},${c.e},${c.n}`,
          geometryType: 'esriGeometryEnvelope',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: '*',
          returnGeometry: 'true',
          outSR: '4326',
          f: 'json',
        }).toString();
        const r = await fetch(u, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      };
      let j = await pedir(whereIgme);
      if (j?.error && whereIgme !== '1=1') {
        whereIgme = '1=1';
        j = await pedir(whereIgme);
      }
      if (j?.error) throw new Error(j.error.message || 'error en la consulta');
      lista.push(...normalizarIgme(j, capa));
    }
    return lista;
  }

  async function osmTeselas(ts) {
    // Una sola consulta para todas las teselas que faltan (Overpass pide no abusar).
    const s = Math.min(...ts.map((t) => cajaDe(t).s));
    const w = Math.min(...ts.map((t) => cajaDe(t).w));
    const n = Math.max(...ts.map((t) => cajaDe(t).n));
    const e = Math.max(...ts.map((t) => cajaDe(t).e));
    const espera = ultimaOverpass + 1500 - Date.now();
    if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
    ultimaOverpass = Date.now();
    const q = `[out:json][timeout:25];(node["natural"="spring"](${s},${w},${n},${e});way["natural"="spring"](${s},${w},${n},${e}););out center tags;`;
    const r = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const todos = normalizarOsm(await r.json());
    for (const t of ts) {
      const c = cajaDe(t);
      guardar('osm', t, todos.filter((p) => p.lat >= c.s && p.lat < c.n && p.lon >= c.w && p.lon < c.e));
    }
  }

  /** Manantiales de una fuente en el rectángulo geográfico. */
  async function buscar(fuente, s, w, n, e) {
    const ts = teselasDe(s, w, n, e);
    if (ts.length > MAX_TESELAS) return { demasiado: true, manantiales: [] };
    const faltan = ts.filter((t) => !leer(fuente, t));
    if (faltan.length) {
      if (fuente === 'osm') await osmTeselas(faltan);
      else for (const t of faltan) guardar('igme', t, await igmeTesela(t));
    }
    const lista = ts.flatMap((t) => leer(fuente, t) || []);
    return { manantiales: lista.filter((p) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e) };
  }

  return { buscar };
}
