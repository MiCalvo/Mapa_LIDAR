import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearMuestreador, trazarCanal, trazarRama, rumbo } from '../src/analisis/canal.js';

/** Rejilla sintética de n×n celdas de 1 m a partir de una función z(x, y). */
function rejilla(fn, n = 1000, x0 = 0, y0 = 0, res = 1) {
  const datos = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) datos[j * n + i] = fn(x0 + (i + 0.5) * res, y0 + (j + 0.5) * res);
  return { x0, y0, res, ancho: n, alto: n, datos };
}

test('muestreador: bilineal y NaN fuera de los datos, con varios bloques', () => {
  const plano = (x, y) => 100 + 0.1 * x + 0.2 * y;
  const alt = crearMuestreador([rejilla(plano, 100, 0, 0), rejilla(plano, 100, 100, 0)]);
  assert.ok(Math.abs(alt(50.3, 20.7) - plano(50.3, 20.7)) < 1e-4);
  assert.ok(Math.abs(alt(150.3, 20.7) - plano(150.3, 20.7)) < 1e-4);
  assert.ok(Number.isNaN(alt(-5, 10)));
  assert.ok(Number.isNaN(alt(250, 10)));
});

test('ladera plana: el canal va casi en horizontal y baja la pendiente pedida', () => {
  // Ladera que sube hacia el norte al 10 %.
  const alt = crearMuestreador([rejilla((x, y) => 500 + 0.1 * y, 1000)]);
  const r = trazarCanal(alt, { x: 100, y: 500, pendiente: 1, paso: 2, maxLong: 600, tolerancia: 1 });
  assert.ok(r);
  const este = r.ramas.find((b) => b.rumboGeneral === 'E');
  assert.ok(este, 'una rama va hacia el este');
  assert.equal(este.fin, 'longitud');
  assert.ok(Math.abs(este.longitud - 600) < 3);
  assert.ok(Math.abs(este.caida - 0.6) < 0.01, `caída ${este.caida}`); // 1 m/km × 0,6 km
  for (const p of este.puntos) assert.ok(Math.abs(p.zt - p.zc) < 0.5, 'se ciñe a la ladera');
  assert.equal(este.puente + este.zanja, 0);
});

test('el canal para al salir de los datos', () => {
  const alt = crearMuestreador([rejilla((x, y) => 500 + 0.1 * y, 300)]);
  const r = trazarRama(alt, { x: 150, y: 150, rumbo0: 0, pendiente: 0.5, paso: 2, maxLong: 5000 });
  assert.equal(r.fin, 'limite');
  assert.ok(r.longitud > 100 && r.longitud < 160);
});

test('escalón sin salida: la rama se detiene sin cruzarlo', () => {
  // Ladera hacia el este que acaba en un escalón: al otro lado el terreno cae 30 m.
  const alt = crearMuestreador([rejilla((x, y) => (x < 400 ? 500 + 0.1 * y : 470), 1000)]);
  const r = trazarRama(alt, { x: 100, y: 500, rumbo0: 0, pendiente: 0.5, paso: 2, maxLong: 5000, tolerancia: 2, maxObra: 100 });
  assert.ok(['obra', 'bucle'].includes(r.fin), r.fin);
  assert.ok(r.longitud < 1000);
  // Los tramos al otro lado del escalón, si los hay, se marcan como obra.
  for (const p of r.puntos) if (p.x > 402) assert.equal(p.tipo, 'puente');
});

test('cerro cónico: el canal rodea el cerro bajando', () => {
  const alt = crearMuestreador([rejilla((x, y) => 800 - 0.3 * Math.hypot(x - 500, y - 500), 1000)]);
  const r = trazarRama(alt, { x: 700, y: 500, rumbo0: Math.PI / 2, pendiente: 2, paso: 2, maxLong: 1000, tolerancia: 1 });
  const ultimo = r.puntos.at(-1);
  // Sigue a ~200 m del centro (bajando 2 m en 1 km equivale a alejarse ~6,7 m).
  const rad = Math.hypot(ultimo.x - 500, ultimo.y - 500);
  assert.ok(rad > 200 && rad < 215, `radio ${rad}`);
  assert.equal(r.puente + r.zanja, 0);
});

test('rumbo', () => {
  assert.equal(rumbo(0), 'E');
  assert.equal(rumbo(Math.PI / 2), 'N');
  assert.equal(rumbo(-Math.PI / 2), 'S');
  assert.equal(rumbo(Math.PI), 'O');
});
