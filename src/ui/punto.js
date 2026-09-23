/**
 * Inspector de puntos: con la herramienta activa, cada clic sobre el terreno
 * muestra sus coordenadas (UTM y geográficas), la altura del suelo, la de la
 * superficie con objetos (si está cargada) y la pendiente.
 */
import { utmAGeo } from '../geo/utm.js';
import { muestreadorCrudo, muestreadorSuave, terrenoEn, activarHerramienta, desactivarHerramienta, crearMarca } from '../viewer/picar.js';
import { uniformesTerreno } from '../viewer/capaTerreno.js';

const fmt = (v, dec = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const gms = (v, pos, neg) => `${fmt(Math.abs(v), 5)}° ${v >= 0 ? pos : neg}`;

export function montarPunto({ boton, tarjeta, escena, avisar }) {
  let activo = false;
  let marca = null;
  let ultimo = null;
  let exagMarca = null;

  function quitarMarca() {
    if (!marca) return;
    escena.scene.remove(marca);
    marca.geometry.dispose();
    marca.material.dispose();
    marca = null;
  }

  function ponerMarca() {
    quitarMarca();
    if (!ultimo || !Number.isFinite(ultimo.zSuelo)) return;
    marca = crearMarca(escena, ultimo.x, ultimo.y, ultimo.zSuelo, '#e67e22', 16);
    escena.scene.add(marca);
    exagMarca = uniformesTerreno.exag.value;
  }

  function mostrar(p, e) {
    const suelo = muestreadorCrudo(escena, 'datosSuelo');
    const sup = muestreadorCrudo(escena, 'datos');
    const suave = muestreadorSuave(escena);
    const t = terrenoEn(escena, p.x, p.y);
    const huso = t?.meta?.huso || 30;
    const zSuelo = suelo ? suelo(p.x, p.y) : NaN;
    const zSup = sup ? sup(p.x, p.y) : NaN;
    const conObjetos = t && t.datos && t.datos !== t.datosSuelo;
    // Pendiente sobre el MDT suavizado, a ±3 m.
    let pend = NaN;
    if (suave) {
      const h = 3;
      const gx = (suave(p.x + h, p.y) - suave(p.x - h, p.y)) / (2 * h);
      const gy = (suave(p.x, p.y + h) - suave(p.x, p.y - h)) / (2 * h);
      pend = Math.hypot(gx, gy);
    }
    const [lat, lon] = utmAGeo(p.x, p.y, huso);
    ultimo = { x: p.x, y: p.y, zSuelo, huso, lat, lon };
    const objeto = conObjetos && Number.isFinite(zSup) && Number.isFinite(zSuelo) ? zSup - zSuelo : NaN;
    tarjeta.innerHTML = `
      <div class="cab"><b>Punto</b><button class="cerrar" data-p="cerrar" aria-label="Cerrar">×</button></div>
      <table>
        <tr><th>UTM ${huso}</th><td><code>X ${fmt(p.x, 1)} · Y ${fmt(p.y, 1)}</code></td></tr>
        <tr><th>Lat, lon</th><td><code>${gms(lat, 'N', 'S')} · ${gms(lon, 'E', 'O')}</code></td></tr>
        <tr><th>Suelo</th><td><b>${Number.isFinite(zSuelo) ? `${fmt(zSuelo, 2)} m` : 'sin datos'}</b></td></tr>
        ${conObjetos ? `<tr><th>Con objetos</th><td>${Number.isFinite(zSup) ? `${fmt(zSup, 2)} m` : '—'}${objeto > 0.3 ? ` · objeto de ${fmt(objeto, 1)} m` : ''}</td></tr>` : ''}
        <tr><th>Pendiente</th><td>${Number.isFinite(pend) ? `${fmt(pend * 100, 1)} % (${fmt((Math.atan(pend) * 180) / Math.PI, 1)}°)` : '—'}</td></tr>
      </table>
      <p class="nota">Altura del suelo según el LiDAR (en el PNOA, sobre el nivel del mar). Coordenadas ETRS89.</p>
      <div class="acciones"><button data-p="copiar-latlon">Copiar lat, lon</button><button data-p="copiar-utm">Copiar UTM</button></div>`;
    tarjeta.hidden = false;
    // Junto al cursor, sin salirse de la ventana.
    const w = tarjeta.offsetWidth;
    const h = tarjeta.offsetHeight;
    tarjeta.style.left = `${Math.min(window.innerWidth - w - 12, e.clientX + 16)}px`;
    tarjeta.style.top = `${Math.min(window.innerHeight - h - 12, Math.max(80, e.clientY - h / 2))}px`;
    ponerMarca();
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      avisar(`Copiado: ${texto}`);
    } catch {
      avisar(texto);
    }
  }

  tarjeta.addEventListener('click', (e) => {
    const c = e.target.closest('[data-p]')?.dataset.p;
    if (c === 'cerrar') {
      tarjeta.hidden = true;
      quitarMarca();
    }
    if (c === 'copiar-latlon' && ultimo) copiar(`${ultimo.lat.toFixed(6)}, ${ultimo.lon.toFixed(6)}`);
    if (c === 'copiar-utm' && ultimo) copiar(`${ultimo.x.toFixed(1)} ${ultimo.y.toFixed(1)} (ETRS89 UTM ${ultimo.huso})`);
  });

  function activar(v) {
    activo = v;
    boton.classList.toggle('activo', v);
    if (v) {
      activarHerramienta('punto', mostrar, () => activar(false));
    } else {
      desactivarHerramienta('punto');
      tarjeta.hidden = true;
      quitarMarca();
    }
  }
  boton.addEventListener('click', () => activar(!activo));

  (function vigilar() {
    if (marca && uniformesTerreno.exag.value !== exagMarca) ponerMarca();
    requestAnimationFrame(vigilar);
  })();

  return {
    activar,
    get ultimo() {
      return ultimo;
    },
  };
}
