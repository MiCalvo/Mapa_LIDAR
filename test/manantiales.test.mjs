import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { teselasDe, normalizarIgme, normalizarOsm, crearManantiales } from '../server/manantiales.js';

const igme = (feats) => ({ features: feats.map(([x, y, nat, nombre]) => ({ attributes: { Id: `${x}`, Naturaleza: nat, TOPONIMIA: nombre, COTA_msnm: 900.5, Caudal_Referencia_L_s: 1.2, Municipio: 'M', Provincia: 'P' }, geometry: { x, y } })) });

test('teselas de 0,1°', () => {
  assert.equal(teselasDe(42.55, -4.15, 42.62, -4.05).length, 4);
  assert.deepEqual(teselasDe(42.51, -4.19, 42.59, -4.11), [[425, -42]]);
});

test('IGME: solo manantiales, con cota y caudal', () => {
  const l = normalizarIgme(igme([[-4.1, 42.6, 'Manantial', 'Fuente Vieja'], [-4.11, 42.61, 'Pozo', 'X']]));
  assert.equal(l.length, 1);
  assert.equal(l[0].nombre, 'Fuente Vieja');
  assert.equal(l[0].cota, 900.5);
  assert.equal(l[0].caudal, 1.2);
  assert.equal(l[0].lat, 42.6);
});

test('OSM: nodos y vías con centro', () => {
  const l = normalizarOsm({ elements: [
    { type: 'node', id: 1, lat: 42.6, lon: -4.1, tags: { natural: 'spring', name: 'Fuentona', ele: '912' } },
    { type: 'way', id: 2, center: { lat: 42.61, lon: -4.12 }, tags: { natural: 'spring' } },
  ] });
  assert.equal(l.length, 2);
  assert.equal(l[0].cota, 912);
  assert.equal(l[1].url, 'https://www.openstreetmap.org/way/2');
});

test('buscar: IGME cae a 1=1 si el filtro falla, y todo queda en caché', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man-'));
  const llamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = new URL(u);
    llamadas.push(url.searchParams.get('where'));
    const cuerpo = url.searchParams.get('where') !== '1=1' ? { error: { message: 'Invalid query' } } : igme([[-4.15, 42.55, 'Manantial', 'A'], [-4.15, 42.56, 'Sondeo', 'B']]);
    return { ok: true, json: async () => cuerpo };
  };
  try {
    const m = crearManantiales({ dir });
    const r = await m.buscar('igme', 42.5, -4.2, 42.6, -4.1);
    assert.equal(r.manantiales.length, 2); // 1 por cada capa (0 y 1)
    const n = llamadas.length;
    const r2 = await m.buscar('igme', 42.5, -4.2, 42.6, -4.1);
    assert.equal(r2.manantiales.length, 2);
    assert.equal(llamadas.length, n, 'la segunda vez sale de la caché');
    assert.ok(llamadas.includes('1=1'));
  } finally {
    globalThis.fetch = original;
  }
});

test('buscar: OSM hace una sola consulta y reparte por teselas; zona enorme se rechaza', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'man-'));
  let n = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    n += 1;
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 1, lat: 42.55, lon: -4.15, tags: {} }, { type: 'node', id: 2, lat: 42.65, lon: -4.05, tags: {} }] }) };
  };
  try {
    const m = crearManantiales({ dir });
    const r = await m.buscar('osm', 42.5, -4.2, 42.7, -4.0);
    assert.equal(n, 1);
    assert.equal(r.manantiales.length, 2);
    const g = await m.buscar('osm', 40, -6, 43, -2);
    assert.equal(g.demasiado, true);
  } finally {
    globalThis.fetch = original;
  }
});
