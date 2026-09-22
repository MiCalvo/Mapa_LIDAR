import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parsearCyl,
  parsearTeselasEus,
  enlacesDeListado,
  leerCabeceraLas,
  indiceLocal,
  estados,
  resumen,
  clave,
} from '../server/catalogo.js';
import { geoAUtm, utmAGeo } from '../src/geo/utm.js';

test('CyL: esquina superior izquierda → bloque inferior izquierdo, preferencia de enlaces', () => {
  const m = parsearCyl(
    [
      'https://ss3.scayle.es/lidarcyl/pnoa2/lazfiles/ne/PNOA-2021-CYL-NE-406-4716-ORT-CLR-RGBI.laz',
      'https://ss3.scayle.es/lidarcyl/pnoa2/lazfiles/ce/PNOA_2019_CYL_CE_406-4716_ORT_CLR_RGBI',
      'https://ss3.scayle.es/lidarcyl/pnoa2/lazfiles/ne/PNOA-2019-CYL-NE-406-4716-ORT-CLR-RGBI.laz',
      'https://ss3.scayle.es/lidarcyl/pnoa2/lazfiles/nw/PNOA_2021_CYL_NW_676-4714_ORT_CLR_RGBI.laz',
      'basura',
    ].join('\n'),
  );
  const b = m.get(clave(30, 406, 4714));
  assert.equal(b.length, 3);
  assert.deepEqual(
    b.map((c) => `${c.region}${c.anio}`),
    ['ne2021', 'ne2019', 'ce2019'],
  );
  assert.ok(b[2].url.endsWith('.laz'));
  assert.ok(m.has(clave(29, 676, 4712)));
});

test('geoEuskadi: teselas de 500 m agrupadas en bloques de 2 km', () => {
  const base = 'https://www.geo.euskadi.eus/lidar/DatosDescarga/LIDAR/LIDAR_2017_ETRS89/037/';
  const urls = enlacesDeListado(
    '<a href="/lidar/DatosDescarga/LIDAR/LIDAR_2017_ETRS89/037/4985-47995.laz">x</a>' +
      '<a href="4990-48000.laz">y</a><a href="../">up</a>',
    base,
  );
  const m = parsearTeselasEus(urls);
  assert.deepEqual([...m.keys()].sort(), [clave(30, 498, 4798), clave(30, 498, 4800)].sort());
});

function lasFalso(f, ext, puntos) {
  const b = Buffer.alloc(375);
  b.write('LASF', 0, 'ascii');
  b.writeUInt8(1, 24);
  b.writeUInt8(2, 25);
  b.writeUInt32LE(puntos, 107);
  b.writeDoubleLE(ext[2], 179);
  b.writeDoubleLE(ext[0], 187);
  b.writeDoubleLE(ext[3], 195);
  b.writeDoubleLE(ext[1], 203);
  fs.writeFileSync(f, b);
}

test('cabecera LAS, índice local y estados', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  const zonas = path.join(raiz, 'zonas');
  const entrada = path.join(raiz, 'entrada');
  fs.mkdirSync(path.join(zonas, 'z'), { recursive: true });
  fs.mkdirSync(path.join(entrada, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(zonas, 'z', 'zona.json'), JSON.stringify({ crs: 'EPSG:25830' }));
  fs.writeFileSync(
    path.join(zonas, 'z', 'a.terreno.json'),
    JSON.stringify({ origen: [406000, 4714000], resolucion: 1, ancho: 2000, alto: 2000 }),
  );
  fs.writeFileSync(
    path.join(zonas, 'z', 'b.terreno.json'),
    JSON.stringify({ origen: [498000, 4798500], resolucion: 2, ancho: 1000, alto: 1000, huso: 30 }),
  );
  lasFalso(path.join(entrada, 'sub', 't.laz'), [410000, 4714000, 412000, 4716000], 1000);
  assert.equal(leerCabeceraLas(path.join(entrada, 'sub', 't.laz')).puntos, 1000);
  const local = indiceLocal({ zonas, entrada });
  assert.equal(local.terrenos.length, 2);
  assert.equal(local.entradas[0].rel, 'sub/t.laz');
  const cyl = parsearCyl(
    'x/lazfiles/ne/PNOA-2021-CYL-NE-408-4716-ORT-CLR-RGBI.laz\n' +
      'x/lazfiles/ce/PNOA_2019_CYL_CE_406-4716_ORT_CLR_RGBI\n' +
      'x/lazfiles/ce/PNOA_2019_CYL_CE_420-4716_ORT_CLR_RGBI',
  );
  const info = estados({ local, catalogos: { cyl, eus: null } });
  assert.equal(info.get(clave(30, 406, 4714)).estado, 'listo');
  assert.equal(info.get(clave(30, 408, 4714)).estado, 'disponible');
  assert.equal(info.get(clave(30, 410, 4714)).estado, 'descargado');
  assert.equal(info.get(clave(30, 420, 4714)).estado, 'sin-enlace');
  assert.equal(info.get(clave(30, 498, 4798)).estado, 'parcial');
  assert.equal(info.get(clave(30, 498, 4798)).cobertura, 0.75);
  const r = resumen(info).find((c) => c.x === 400 && c.y === 4710);
  assert.equal(r.listo + r.disponible + r.descargado + r.sinEnlace, 2);
});

test('UTM ida y vuelta', () => {
  const [E, N] = geoAUtm(42.5928, -4.1003, 30);
  assert.ok(Math.abs(E - 409726) < 5 && Math.abs(N - 4716182) < 5, `${E} ${N}`);
  const [lat, lon] = utmAGeo(E, N, 30);
  assert.ok(Math.abs(lat - 42.5928) < 1e-9 && Math.abs(lon + 4.1003) < 1e-9);
});

test('servicio: bloques de un rectángulo (orden norte → sur) y límite de tamaño', async () => {
  const { crearServicio } = await import('../server/servicio.js');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'serv-'));
  fs.mkdirSync(path.join(raiz, 'data', 'catalogos'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'data/catalogos/cyl_pnoa2_urls.txt'), 'x/lazfiles/ne/PNOA-2021-CYL-NE-406-4716-ORT-CLR-RGBI.laz');
  fs.writeFileSync(path.join(raiz, 'data/catalogos/geoeuskadi_2017.txt'), '');
  const s = crearServicio({ raiz, descargar: false });
  await s.promesaCatalogos;
  const pedir = (u) =>
    new Promise((resolve) => {
      const res = { writeHead(c) { this.c = c; }, end(b) { resolve({ c: this.c, d: JSON.parse(b) }); } };
      s.manejar({ method: 'GET' }, res, new URL(u, 'http://x'));
    });
  const r = await pedir('/api/mapa/bloques?huso=30&x0=405&y0=4713&x1=409&y1=4716');
  assert.equal(r.c, 200);
  assert.deepEqual(r.d.bloques.map((b) => `${b.x}-${b.y}`), ['404-4714', '406-4714', '408-4714', '404-4712', '406-4712', '408-4712']);
  assert.equal(r.d.bloques[1].estado, 'disponible');
  assert.equal((await pedir('/api/mapa/bloques?huso=30&x0=0&y0=4000&x1=400&y1=4400')).c, 400);
});
