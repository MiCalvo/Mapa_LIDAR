/** Colores ASPRS por clase (LAS 1.4). */
export const COLORES_CLASE = {
  1: [184, 194, 204], // sin clasificar
  2: [181, 138, 90], // suelo
  3: [159, 212, 138], // vegetación baja
  4: [95, 179, 90], // vegetación media
  5: [47, 125, 58], // vegetación alta
  6: [224, 107, 90], // edificios
  7: [255, 0, 255], // ruido
  9: [58, 123, 213], // agua
  17: [150, 150, 160], // puentes
};

export const NOMBRES_CLASE = {
  1: 'Sin clasificar',
  2: 'Suelo',
  3: 'Vegetación baja',
  4: 'Vegetación media',
  5: 'Vegetación alta',
  6: 'Edificios',
  7: 'Ruido',
  9: 'Agua',
  17: 'Puentes',
};

const RAMPA = [
  [0, [47, 127, 196]],
  [0.25, [63, 183, 122]],
  [0.5, [232, 212, 77]],
  [0.75, [232, 150, 42]],
  [1, [226, 92, 92]],
];

export function rampa(t) {
  const v = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMPA.length; i += 1) {
    const [t1, c1] = RAMPA[i];
    if (v <= t1) {
      const [t0, c0] = RAMPA[i - 1];
      const k = (v - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return RAMPA[RAMPA.length - 1][1];
}

/**
 * Rellena `destino` (Uint8Array RGB) para un nodo según el modo.
 * `datos` = { rgb, clase, z, intensidad } (arrays por punto).
 */
export function colorear(destino, datos, modo, opciones) {
  const n = datos.clase.length;
  const { zMin, zMax, rgbEscala, clasesVisibles } = opciones;
  for (let i = 0; i < n; i += 1) {
    let r;
    let g;
    let b;
    const clase = datos.clase[i];
    if (modo === 'clase') {
      [r, g, b] = COLORES_CLASE[clase] || COLORES_CLASE[1];
    } else if (modo === 'altura') {
      [r, g, b] = rampa((datos.z[i] - zMin) / Math.max(1, zMax - zMin));
    } else if (modo === 'intensidad') {
      const v = Math.min(255, datos.intensidad[i] / 256);
      r = g = b = v;
    } else {
      r = datos.rgb[i * 3] * rgbEscala;
      g = datos.rgb[i * 3 + 1] * rgbEscala;
      b = datos.rgb[i * 3 + 2] * rgbEscala;
    }
    // Clases ocultas: color 0 y se descartan en el shader (alpha).
    const visible = !clasesVisibles || clasesVisibles.has(clase);
    destino[i * 4] = r;
    destino[i * 4 + 1] = g;
    destino[i * 4 + 2] = b;
    destino[i * 4 + 3] = visible ? 255 : 0;
  }
}
