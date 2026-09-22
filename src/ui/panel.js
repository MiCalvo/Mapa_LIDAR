import { COLORES_CLASE, NOMBRES_CLASE } from '../viewer/colores.js';

const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const mpts = (n) => (Number.isFinite(n) ? `${(n / 1e6).toFixed(1)} M pts` : '');
const resumen = (b) =>
  [b.terreno ? 'terreno' : '', b.url ? 'puntos' : '', mpts(b.puntos), b.bytes ? mb(b.bytes) : '']
    .filter(Boolean)
    .join(' · ');

/** Lista de zonas y bloques con casillas que cargan bajo demanda. */
export function pintarZonas(contenedor, zonas, { alActivar, alDesactivar, activos = new Set() }) {
  contenedor.textContent = '';
  const total = zonas.reduce((s, z) => s + z.bloques.length, 0);
  document.getElementById('total-bloques').textContent = String(total);
  if (!total) {
    contenedor.innerHTML =
      '<p class="vacio">No hay bloques. Genera el terreno con <code>tools/lidar2mdt.py</code> o la nube con ' +
      '<code>tools/lidar2copc.py</code> en <code>data/zonas/&lt;zona&gt;/</code>. Ver README.md.</p>';
    return;
  }
  for (const zona of zonas) {
    const caja = document.createElement('section');
    caja.className = 'zona';
    const h = document.createElement('h3');
    h.textContent = zona.nombre;
    caja.append(h);
    if (zona.descripcion) {
      const p = document.createElement('p');
      p.textContent = zona.descripcion;
      p.title = [zona.fuente, zona.licencia].filter(Boolean).join('\n');
      caja.append(p);
    }
    for (const bloque of zona.bloques) {
      const fila = document.createElement('div');
      fila.className = 'bloque';
      const label = document.createElement('label');
      const casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.checked = activos.has(`${zona.id}/${bloque.id}`);
      const texto = document.createElement('span');
      texto.innerHTML = '<b></b><small></small>';
      texto.querySelector('b').textContent = bloque.nombre;
      const info = texto.querySelector('small');
      info.textContent = resumen(bloque);
      casilla.addEventListener('change', async () => {
        casilla.disabled = true;
        try {
          if (casilla.checked) {
            info.textContent = 'abriendo…';
            await alActivar(zona, bloque);
          } else {
            alDesactivar(zona, bloque);
          }
          info.textContent = resumen(bloque);
        } catch (error) {
          casilla.checked = false;
          info.textContent = `Error: ${error?.message || error}`;
        } finally {
          casilla.disabled = false;
        }
      });
      label.append(casilla, texto);
      fila.append(label);
      caja.append(fila);
    }
    contenedor.append(caja);
  }
}

/** Casillas de clases ASPRS. */
export function pintarClases(contenedor, estado, alCambiar) {
  for (const [clase, nombre] of Object.entries(NOMBRES_CLASE)) {
    const label = document.createElement('label');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.checked = estado.clasesVisibles.has(Number(clase));
    const muestra = document.createElement('i');
    muestra.style.background = `rgb(${COLORES_CLASE[clase].join(',')})`;
    casilla.addEventListener('change', () => {
      if (casilla.checked) estado.clasesVisibles.add(Number(clase));
      else estado.clasesVisibles.delete(Number(clase));
      alCambiar();
    });
    label.append(casilla, muestra, document.createTextNode(nombre));
    contenedor.append(label);
  }
}

/** Botón que repite la acción mientras se mantiene pulsado. */
export function botonRepetible(boton, accion) {
  let temporizador = 0;
  let intervalo = 0;
  const parar = () => {
    clearTimeout(temporizador);
    clearInterval(intervalo);
  };
  boton.addEventListener('pointerdown', () => {
    parar();
    accion();
    temporizador = setTimeout(() => {
      intervalo = setInterval(accion, 60);
    }, 300);
  });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) boton.addEventListener(t, parar);
  boton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') accion();
  });
}
