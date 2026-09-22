import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearMiddleware, listarZonas, parsearRango, resolverFichero } from '../server/datos.js';
import { rampa, colorear } from '../src/viewer/colores.js';

function carpeta() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'zonas-'));
  fs.mkdirSync(path.join(raiz, 'prueba'));
  fs.writeFileSync(path.join(raiz, 'prueba', 'a.copc.laz'), Buffer.from('0123456789'));
  fs.writeFileSync(path.join(raiz, 'prueba', 'nota.txt'), 'x');
  fs.writeFileSync(path.join(raiz, 'prueba', 'a.terreno.json'), '{}');
  fs.writeFileSync(path.join(raiz, 'prueba', 'a.mdt.bin'), Buffer.alloc(8));
  fs.writeFileSync(path.join(raiz, 'prueba', 'b.terreno.json'), '{}');
  fs.writeFileSync(path.join(raiz, 'prueba', 'zona.json'), JSON.stringify({ nombre: 'Prueba', bloques: { 'a.copc.laz': { nombre: 'A', puntos: 5 } } }));
  return raiz;
}

function llamar(mw, url, headers = {}) {
  return new Promise((resolve) => {
    const r = { status: 0, headers: {}, cuerpo: Buffer.alloc(0), siguiente: false };
    const partes = [];
    const res = {
      writeHead(s, h = {}) { r.status = s; r.headers = h; },
      write(c) { partes.push(Buffer.from(c)); return true; },
      on() { return res; }, once() { return res; }, emit() { return true; }, removeListener() { return res; },
      end(c) { if (c) partes.push(Buffer.from(c)); r.cuerpo = Buffer.concat(partes); resolve(r); },
    };
    mw({ url, method: 'GET', headers }, res, () => { r.siguiente = true; resolve(r); });
  });
}

test('agrupa bloques por nombre base (nube y/o terreno)', () => {
  const zonas = listarZonas(carpeta());
  assert.equal(zonas.length, 1);
  assert.equal(zonas[0].nombre, 'Prueba');
  const [a, b] = zonas[0].bloques;
  assert.deepEqual(zonas[0].bloques.map((x) => x.id), ['a', 'b']);
  assert.equal(a.nombre, 'A');
  assert.equal(a.puntos, 5);
  assert.equal(a.url, '/datos/prueba/a.copc.laz');
  assert.equal(a.terreno, '/datos/prueba/a.terreno.json');
  assert.equal(b.url, null);
  assert.equal(b.terreno, '/datos/prueba/b.terreno.json');
});

test('rechaza rutas fuera de la carpeta', () => {
  const raiz = carpeta();
  assert.ok(resolverFichero(raiz, 'prueba', 'a.copc.laz'));
  assert.equal(resolverFichero(raiz, '..', 'a.copc.laz'), null);
  assert.equal(resolverFichero(raiz, 'prueba', '../x.copc.laz'), null);
  assert.equal(resolverFichero(raiz, 'prueba', 'nota.txt'), null);
  assert.ok(resolverFichero(raiz, 'prueba', 'a.mdt.bin'));
  assert.ok(resolverFichero(raiz, 'prueba', 'a.terreno.json'));
  assert.equal(resolverFichero(raiz, 'prueba', 'zona.json'), null);
});

test('interpreta rangos', () => {
  assert.deepEqual(parsearRango('bytes=0-3', 10), { inicio: 0, fin: 3 });
  assert.deepEqual(parsearRango('bytes=5-', 10), { inicio: 5, fin: 9 });
  assert.deepEqual(parsearRango('bytes=-4', 10), { inicio: 6, fin: 9 });
  assert.equal(parsearRango('bytes=20-30', 10), 'invalido');
  assert.equal(parsearRango(undefined, 10), null);
});

test('sirve rangos parciales (206)', async () => {
  const mw = crearMiddleware({ raiz: carpeta() });
  const r = await llamar(mw, '/datos/prueba/a.copc.laz', { range: 'bytes=2-4' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['Content-Range'], 'bytes 2-4/10');
  assert.equal(r.cuerpo.toString(), '234');
  const z = await llamar(mw, '/api/zonas');
  assert.equal(JSON.parse(z.cuerpo).zonas[0].id, 'prueba');
  assert.equal((await llamar(mw, '/datos/prueba/nota.txt')).status, 404);
  assert.equal((await llamar(mw, '/otra')).siguiente, true);
});

test('colores: rampa y clases ocultas', () => {
  assert.deepEqual(rampa(0), [47, 127, 196]);
  assert.deepEqual(rampa(1), [226, 92, 92]);
  const destino = new Uint8Array(8);
  colorear(destino, { rgb: new Uint16Array([65535, 0, 0, 0, 65535, 0]), clase: new Uint8Array([2, 7]), z: new Float32Array(2), intensidad: new Uint16Array(2) }, 'rgb', { zMin: 0, zMax: 1, rgbEscala: 1 / 257, clasesVisibles: new Set([2]) });
  assert.deepEqual([...destino], [255, 0, 0, 255, 0, 255, 0, 0]);
});
