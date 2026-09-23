import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rejillaRegion,
  regionPara,
  buscarRuta,
  buscarAlternativas,
  calcularSifon,
  sugerirSifones,
  recortarRuta,
  desplazarRuta,
} from '../src/analisis/ruta.js';

test('sifón: profundidad, presión y cota de salida', () => {
  // Valle en V de 60 m de profundidad entre x = 0 y x = 1000.
  const alt = (x) => 500 - 60 * (1 - Math.abs(x - 500) / 500);
  const s = calcularSifon(alt, { x: 0, y: 0 }, { x: 1000, y: 0 }, 505, { perdida: 2 });
  assert.ok(Math.abs(s.longitud - 1000) < 1e-6);
  assert.ok(Math.abs(s.profundidad - 65) < 0.5);
  assert.ok(Math.abs(s.zLlegada - 503) < 1e-6);
  assert.ok(Math.abs(s.presionAtm - 65 / 10.33) < 0.1);
  assert.equal(s.sobresale, 0);
});

test('sifón: avisa si un cerro sobresale por encima de la línea de carga', () => {
  const alt = (x) => (Math.abs(x - 500) < 50 ? 520 : 450);
  const s = calcularSifon(alt, { x: 0, y: 0 }, { x: 1000, y: 0 }, 500, { perdida: 1 });
  assert.ok(s.sobresale > 19);
});

test('sugerir sifones: detecta el tramo de puente alto', () => {
  const mk = (tipos, alturas) => ({
    puntos: tipos.map((t, i) => ({ x: i * 10, y: 0, d: i * 10, zc: 100, zt: 100 - alturas[i], tipo: t })),
  });
  const r = mk(['ladera', 'ladera', 'puente', 'puente', 'puente', 'ladera', 'puente', 'ladera'], [0, 0, 20, 60, 30, 0, 10, 0]);
  const s = sugerirSifones(r, { alturaMin: 50 });
  assert.equal(s.length, 1);
  assert.equal(s[0].entrada, 1);
  assert.equal(s[0].salida, 5);
  assert.equal(s[0].alturaMax, 60);
  assert.equal(s[0].longitud, 40);
});

test('recortar y desplazar rutas', () => {
  const r = { puntos: [0, 1, 2, 3, 4].map((i) => ({ x: i, y: 0, d: i * 10, zc: 100 - i, zt: 100 - i, tipo: 'ladera' })) };
  const c = recortarRuta(r, 1, 3);
  assert.equal(c.puntos.length, 3);
  assert.equal(c.longitud, 20);
  const d = desplazarRuta(c, 5, 2);
  assert.equal(d.puntos[0].zc, 104);
  assert.equal(d.puntos[0].tipo, 'puente');
});

test('ladera plana: la ruta sigue la ladera y llega sin obra', () => {
  // Sube hacia el norte al 10 %; A y B a casi la misma cota, separados 800 m al este.
  const alt = (x, y) => 500 + 0.1 * y;
  const rej = rejillaRegion(alt, 0, 0, 1000, 1000, 5);
  const r = buscarRuta(rej, { x: 100, y: 500 }, { x: 900, y: 495 }, { pendiente: 0.5, tolerancia: 1, pesoPuente: 10, pesoZanja: 10 });
  assert.ok(r);
  assert.ok(r.longitud > 790 && r.longitud < 900, `longitud ${r.longitud}`);
  assert.equal(r.puente, 0);
  assert.equal(r.zanja, 0);
});

test('un cerro en medio: con obra cara lo rodea; con obra barata lo atraviesa', () => {
  // Terreno llano a 500 m con un cerro de 40 m entre A y B.
  const alt = (x, y) => 500 + 40 * Math.exp(-((x - 500) ** 2 + (y - 500) ** 2) / (2 * 120 ** 2));
  const rej = rejillaRegion(alt, 0, 0, 1000, 1000, 5);
  const a = { x: 100, y: 500 };
  const b = { x: 900, y: 500 };
  const cara = buscarRuta(rej, a, b, { pendiente: 0.2, tolerancia: 1, pesoPuente: 30, pesoZanja: 30 });
  const barata = buscarRuta(rej, a, b, { pendiente: 0.2, tolerancia: 1, pesoPuente: 0.01, pesoZanja: 0.01 });
  assert.ok(cara.zanja < 40, `zanja ${cara.zanja}`);
  assert.ok(cara.longitud > barata.longitud);
  assert.ok(barata.zanja > 100, `zanja barata ${barata.zanja}`);
  assert.ok(Math.abs(barata.longitud - 800) < 20);
});

test('destino mucho más bajo: el canal baja con la ladera sin pasar de la pendiente máxima', () => {
  // Ladera que baja hacia el este al 2 % (20 m/km).
  const alt = (x) => 600 - 0.02 * x;
  const rej = rejillaRegion(alt, 0, 0, 2000, 1000, 5);
  const r = buscarRuta(rej, { x: 100, y: 500 }, { x: 1900, y: 500 }, { pendienteMin: 0.3, pendienteMax: 3, tolerancia: 1 });
  assert.ok(r);
  for (let k = 1; k < r.puntos.length; k += 1) {
    const s = (r.puntos[k - 1].zc - r.puntos[k].zc) / (r.puntos[k].d - r.puntos[k - 1].d);
    assert.ok(s >= 0.3e-3 - 1e-9 && s <= 3e-3 + 1e-9, `pendiente ${s}`);
  }
  // Con 3 m/km como máximo no puede seguir una caída de 20 m/km: llega alto (puente).
  assert.ok(r.margen > 20, `margen ${r.margen}`);
  assert.ok(Math.abs(r.pendienteMedia - 3) < 0.05, `media ${r.pendienteMedia}`);
});

test('resaltos: con ellos el canal puede bajar a un destino mucho más bajo', () => {
  const alt = (x) => 600 - 0.02 * x;
  const rej = rejillaRegion(alt, 0, 0, 2000, 1000, 5);
  const r = buscarRuta(rej, { x: 100, y: 500 }, { x: 1900, y: 500 }, { pendienteMin: 0.3, pendienteMax: 3, tolerancia: 1, resaltos: true });
  assert.ok(r.nResaltos > 0);
  assert.ok(Math.abs(r.margen) < 3, `margen ${r.margen}`);
  assert.ok(r.alturaResaltos > 20);
});

test('alternativas: devuelve opciones distintas y ordenadas por perfil', () => {
  const alt = (x, y) => 500 + 40 * Math.exp(-((x - 500) ** 2 + (y - 500) ** 2) / (2 * 120 ** 2));
  const rej = rejillaRegion(alt, 0, 0, 1000, 1000, 5);
  const rutas = buscarAlternativas(rej, { x: 100, y: 500 }, { x: 900, y: 500 }, { pendiente: 0.2, tolerancia: 1 });
  assert.ok(rutas.length >= 2, `${rutas.length} rutas`);
  assert.equal(rutas[0].perfil.id, 'obra');
});

test('destino fuera de la rejilla o sin datos: null', () => {
  const rej = rejillaRegion(() => 100, 0, 0, 100, 100, 5);
  assert.equal(buscarRuta(rej, { x: 10, y: 10 }, { x: 500, y: 10 }), null);
  const hueco = rejillaRegion((x) => (x > 50 ? NaN : 100), 0, 0, 100, 100, 5);
  assert.equal(buscarRuta(hueco, { x: 10, y: 10 }, { x: 90, y: 10 }), null);
});

test('regionPara: margen y paso limitan el número de nodos', () => {
  const r = regionPara({ x: 0, y: 0 }, { x: 10000, y: 0 }, { maxNodos: 1e6 });
  const n = ((r.x1 - r.x0) / r.R) * ((r.y1 - r.y0) / r.R);
  assert.ok(n <= 1.05e6, `${n}`);
  assert.ok(r.x0 < 0 && r.x1 > 10000);
});
