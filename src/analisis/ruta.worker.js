// Busca las alternativas de ruta fuera del hilo principal para no congelar la vista.
import { buscarAlternativas } from './ruta.js';

self.onmessage = (e) => {
  const { id, rej, a, b, opciones } = e.data;
  try {
    const t0 = performance.now();
    const rutas = buscarAlternativas(rej, a, b, opciones);
    self.postMessage({ id, rutas, ms: performance.now() - t0 });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
