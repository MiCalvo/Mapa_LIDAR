import { fijarCurvas, MAX_CURVAS, PATRONES } from '../viewer/capaTerreno.js';

/**
 * Editor de curvas de nivel: lista de curvas «cada N m» o «cota concreta», con
 * color, grosor y patrón. Se guarda en el navegador (localStorage).
 */
const CLAVE = 'mapaLidar.curvas.v1';
const TEXTO_PATRON = { continua: '———', discontinua: '– – –', puntos: '· · ·', 'raya-punto': '–·–·' };

export const curvasPorDefecto = (paso = 5) => [
  { tipo: 'cada', valor: paso, color: '#6b4a33', grosor: 1, patron: 'continua' },
  { tipo: 'cada', valor: paso * 5, color: '#3f2414', grosor: 2, patron: 'continua' },
];

function leer() {
  try {
    const l = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (Array.isArray(l) && l.length) return l.slice(0, MAX_CURVAS);
  } catch {
    /* sin almacenamiento: valores por defecto */
  }
  return curvasPorDefecto();
}

function guardar(lista) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    /* no pasa nada: solo se pierde al recargar */
  }
}

export function montarEditorCurvas(contenedor) {
  let lista = leer();
  const aplicar = () => {
    fijarCurvas(lista);
    guardar(lista);
  };

  const pintar = () => {
    contenedor.textContent = '';
    lista.forEach((c, i) => {
      const fila = document.createElement('div');
      fila.className = 'curva';
      fila.innerHTML = `
        <select data-c="tipo" title="Tipo de curva">
          <option value="cada">cada</option><option value="cota">cota</option></select>
        <input data-c="valor" type="number" step="any" min="0" title="Metros" /><span class="u">m</span>
        <input data-c="color" type="color" title="Color" />
        <input data-c="grosor" type="number" min="0.5" max="8" step="0.5" title="Grosor (px)" />
        <select data-c="patron" title="Patrón de línea">${PATRONES.map((p) => `<option value="${p}">${TEXTO_PATRON[p]}</option>`).join('')}</select>
        <button data-c="borrar" title="Quitar esta curva">✕</button>`;
      fila.querySelector('[data-c=tipo]').value = c.tipo;
      fila.querySelector('[data-c=valor]').value = c.valor;
      fila.querySelector('[data-c=color]').value = c.color;
      fila.querySelector('[data-c=grosor]').value = c.grosor;
      fila.querySelector('[data-c=patron]').value = c.patron;
      for (const campo of ['tipo', 'valor', 'color', 'grosor', 'patron']) {
        const el = fila.querySelector(`[data-c=${campo}]`);
        el.addEventListener(campo === 'color' ? 'input' : 'change', () => {
          c[campo] = ['valor', 'grosor'].includes(campo) ? Number(el.value) : el.value;
          aplicar();
        });
      }
      fila.querySelector('[data-c=borrar]').addEventListener('click', () => {
        lista.splice(i, 1);
        aplicar();
        pintar();
      });
      contenedor.append(fila);
    });
    const pie = document.createElement('div');
    pie.className = 'curvas-pie';
    pie.innerHTML = `<button data-p="anadir" ${lista.length >= MAX_CURVAS ? 'disabled' : ''}>+ Añadir curva</button>
      <span>Rápido:</span>${[1, 2, 5, 10, 25].map((p) => `<button data-p="${p}" title="Cada ${p} m y maestra cada ${p * 5} m">${p}</button>`).join('')}`;
    pie.querySelector('[data-p=anadir]').addEventListener('click', () => {
      const ultima = lista[lista.length - 1];
      lista.push({ tipo: 'cota', valor: Math.round(ultima?.valor || 100), color: '#c2185b', grosor: 2, patron: 'discontinua' });
      aplicar();
      pintar();
    });
    pie.querySelectorAll('button[data-p]:not([data-p=anadir])').forEach((b) =>
      b.addEventListener('click', () => {
        const paso = Number(b.dataset.p);
        // Sustituye las curvas periódicas y conserva las cotas concretas.
        lista = [...curvasPorDefecto(paso), ...lista.filter((c) => c.tipo === 'cota')].slice(0, MAX_CURVAS);
        aplicar();
        pintar();
      }),
    );
    contenedor.append(pie);
  };

  aplicar();
  pintar();
}
