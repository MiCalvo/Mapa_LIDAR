import { utmAGeo } from '../geo/utm.js';

/**
 * Ayuda para los bloques sin descarga automática: por qué, dónde bajarlos
 * (Centro de Descargas del CNIG) y las coordenadas exactas de cada bloque.
 */
const CNIG_MAPA = 'https://centrodedescargas.cnig.es/CentroDescargas/buscar-mapa';
const CNIG_L2 = 'https://centrodedescargas.cnig.es/CentroDescargas/lidar-segunda-cobertura';
const CNIG_L3 = 'https://centrodedescargas.cnig.es/CentroDescargas/lidar-tercera-cobertura';

let dialogo = null;

function copiar(texto, boton) {
  const ok = () => {
    const t = boton.textContent;
    boton.textContent = 'Copiado';
    setTimeout(() => {
      boton.textContent = t;
    }, 1200);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto).then(ok, () => {});
}

export function abrirAyudaManual(bloques) {
  if (!dialogo) {
    dialogo = document.createElement('section');
    dialogo.className = 'dialogo-manual vidrio';
    document.body.append(dialogo);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dialogo.hidden = true;
    });
  }
  const lista = bloques.slice(0, 12);
  const filas = lista
    .map((b) => {
      const [lat, lon] = utmAGeo((b.x + 1) * 1000, (b.y + 1) * 1000, b.huso);
      const geo = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      const utm = `X ${b.x * 1000}–${(b.x + 2) * 1000} · Y ${b.y * 1000}–${(b.y + 2) * 1000} (ETRS89 UTM ${b.huso})`;
      const motivo =
        b.estado === 'sin-enlace'
          ? 'Está en la lista de Castilla y León, pero su enlace no responde (sectores CE y NW).'
          : 'Fuera de Castilla y León y de Euskadi: solo en el CNIG.';
      return `<div class="bloque-manual">
        <b>Bloque ${b.x}-${b.y}</b><small>${motivo}</small>
        <div class="coords"><code>${geo}</code><button class="mini" data-copiar="${geo}">Copiar lat, lon</button></div>
        <div class="coords"><code>${utm}</code></div>
        <small>El fichero del PNOA suele llevar en el nombre la esquina superior izquierda en km: <code>${b.x}</code> y <code>${b.y + 2}</code>.</small>
      </div>`;
    })
    .join('');
  dialogo.hidden = false;
  dialogo.innerHTML = `
    <header><b>Cómo conseguir estos bloques</b><button class="mini" data-cerrar>✕</button></header>
    <p class="nota">La app descarga sola lo que tiene un listado público de ficheros: el PNOA de <b>Castilla y León</b>
      (sectores NE, SE y SW) y <b>geoEuskadi 2017</b>. El resto de España está en el <b>Centro de Descargas del CNIG</b>,
      que no tiene un API público de descarga (sin registrarse permite 20 descargas), así que hay que bajarlo a mano.</p>
    <ol class="pasos">
      <li>Abre el CNIG: <a href="${CNIG_MAPA}" target="_blank" rel="noopener">Buscar en mapa</a> ·
        <a href="${CNIG_L2}" target="_blank" rel="noopener">LiDAR 2ª cobertura</a> ·
        <a href="${CNIG_L3}" target="_blank" rel="noopener">LiDAR 3ª cobertura</a></li>
      <li>Ve a las coordenadas del bloque (abajo) y elige el fichero <b>.laz</b> que lo cubre.</li>
      <li>Déjalo en tu carpeta de <b>Descargas</b> (o en <code>data/entrada</code>): la app lo detecta y el bloque pasa a
        «Descargado, sin procesar». Luego pulsa <b>Procesar</b>.</li>
    </ol>
    <div class="lista-manual">${filas}</div>
    ${bloques.length > lista.length ? `<p class="nota">y ${bloques.length - lista.length} bloque(s) más.</p>` : ''}`;
  dialogo.querySelector('[data-cerrar]').addEventListener('click', () => {
    dialogo.hidden = true;
  });
  dialogo.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', () => copiar(b.dataset.copiar, b)));
}
