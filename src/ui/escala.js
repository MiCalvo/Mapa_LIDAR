import { fijarRampa, RAMPA_POR_DEFECTO, MAX_PARADAS, uniformesTerreno } from '../viewer/capaTerreno.js';

/**
 * Barra de escala de color (abajo, en la vista 3D) y su editor: paradas de color,
 * paletas predefinidas y rango de alturas automático o manual.
 * Se abre con doble clic en la barra o con el botón ✎. Se guarda en el navegador.
 */
const CLAVE = 'mapaLidar.escala.v1';

export const PALETAS = {
  'Hipsométrica': RAMPA_POR_DEFECTO,
  'Verde → marrón': [
    { pos: 0, color: '#1a9850' }, { pos: 0.25, color: '#91cf60' }, { pos: 0.45, color: '#d9ef8b' },
    { pos: 0.6, color: '#fee08b' }, { pos: 0.8, color: '#a6611a' }, { pos: 1, color: '#ffffff' },
  ],
  Viridis: [
    { pos: 0, color: '#440154' }, { pos: 0.25, color: '#3b528b' }, { pos: 0.5, color: '#21918c' },
    { pos: 0.75, color: '#5ec962' }, { pos: 1, color: '#fde725' },
  ],
  'Azules': [
    { pos: 0, color: '#08306b' }, { pos: 0.35, color: '#2171b5' }, { pos: 0.65, color: '#6baed6' },
    { pos: 0.85, color: '#c6dbef' }, { pos: 1, color: '#f7fbff' },
  ],
  'Grises': [{ pos: 0, color: '#303030' }, { pos: 1, color: '#f0f0f0' }],
};

const PENDIENTE = 'linear-gradient(90deg, #f5f2e0 0%, #edb859 50%, #9e382e 100%)';

function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (d && Array.isArray(d.paradas) && d.paradas.length >= 2) return d;
  } catch {
    /* sin almacenamiento */
  }
  return { paradas: RAMPA_POR_DEFECTO.map((p) => ({ ...p })), rango: null };
}

export function montarEscala({ barra, editor, estado, alCambiarRango }) {
  let cfg = leer();
  let abierto = false;
  const ordenar = () => cfg.paradas.sort((a, b) => a.pos - b.pos);
  const guardar = () => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(cfg));
    } catch {
      /* no pasa nada */
    }
  };
  const aplicar = () => {
    ordenar();
    fijarRampa(cfg.paradas);
    estado.rangoManual = cfg.rango;
    alCambiarRango();
    guardar();
  };
  const z = () => [uniformesTerreno.zBajo.value, uniformesTerreno.zAlto.value];
  const altura = (pos) => {
    const [a, b] = z();
    return a + pos * (b - a);
  };
  const gradiente = () =>
    `linear-gradient(90deg, ${cfg.paradas.map((p) => `${p.color} ${(p.pos * 100).toFixed(1)}%`).join(', ')})`;

  let ultimo = '';
  function pintarBarra() {
    const modo = uniformesTerreno.modo.value;
    const hayTerreno = estado.hayTerreno;
    barra.hidden = !hayTerreno || modo === 2;
    if (barra.hidden) {
      editor.hidden = true;
      return;
    }
    const [a, b] = z();
    const firma = `${modo}|${a}|${b}|${JSON.stringify(cfg.paradas)}`;
    if (firma === ultimo) return;
    ultimo = firma;
    if (modo === 3) {
      barra.innerHTML = `<span class="tit">Ortofoto</span><p class="atrib">PNOA máxima actualidad · © Instituto Geográfico Nacional de España (CC BY 4.0, scne.es)</p>`;
      return;
    }
    if (modo === 1) {
      barra.innerHTML = `<span class="tit">Pendiente</span><div class="grad" style="background:${PENDIENTE}"></div>
        <div class="marcas">${[0, 15, 30, 45].map((g) => `<span style="left:${(g / 45) * 100}%">${g}°${g === 45 ? '+' : ''}</span>`).join('')}</div>`;
      return;
    }
    barra.innerHTML = `<span class="tit">Altura (m)${cfg.rango ? ' · manual' : ''}</span>
      <div class="grad" style="background:${gradiente()}" title="Doble clic para editar la escala"></div>
      <div class="marcas">${cfg.paradas.map((p) => `<span style="left:${p.pos * 100}%">${Math.round(altura(p.pos))}</span>`).join('')}</div>
      <button class="mini editar" title="Editar la escala de colores">✎</button>`;
    barra.querySelector('.editar').addEventListener('click', () => alternarEditor());
  }

  function pintarEditor() {
    if (!abierto) {
      editor.hidden = true;
      return;
    }
    editor.hidden = false;
    const [a, b] = z();
    editor.innerHTML = `
      <header><b>Escala de colores</b><button class="mini" data-e="cerrar">✕</button></header>
      <div class="paletas">${Object.keys(PALETAS).map((n) => `<button data-paleta="${n}"><i style="background:linear-gradient(90deg, ${PALETAS[n].map((p) => `${p.color} ${p.pos * 100}%`).join(', ')})"></i>${n}</button>`).join('')}</div>
      <div class="grp">Colores y alturas</div>
      <div class="paradas"></div>
      <button class="mini" data-e="anadir" ${cfg.paradas.length >= MAX_PARADAS ? 'disabled' : ''}>+ Añadir color</button>
      <div class="grp">Rango de alturas</div>
      <label class="casilla"><input type="radio" name="rango" value="auto" ${cfg.rango ? '' : 'checked'}/> Automático (2 %–98 % de lo cargado)</label>
      <label class="casilla"><input type="radio" name="rango" value="manual" ${cfg.rango ? 'checked' : ''}/> Manual:
        <input type="number" step="any" data-r="min" value="${Math.round(cfg.rango?.min ?? a)}"/> a
        <input type="number" step="any" data-r="max" value="${Math.round(cfg.rango?.max ?? b)}"/> m</label>
      <p class="nota">Cada color va a una altura; si cambia el rango, los colores se reparten igual (en proporción).</p>
      <div class="pie"><button class="mini" data-e="reset">Restablecer</button></div>`;
    const cont = editor.querySelector('.paradas');
    cfg.paradas.forEach((p, i) => {
      const fila = document.createElement('div');
      fila.className = 'parada';
      fila.innerHTML = `<input type="color" value="${p.color}"/>
        <input type="number" step="any" value="${Math.round(altura(p.pos))}" title="Altura (m)"/><span class="u">m</span>
        <small>${Math.round(p.pos * 100)} %</small>
        <button class="mini" ${cfg.paradas.length <= 2 ? 'disabled' : ''} title="Quitar">✕</button>`;
      const [col, num, , , quitar] = fila.children;
      col.addEventListener('input', () => {
        p.color = col.value;
        aplicar();
        pintarBarra();
      });
      num.addEventListener('change', () => {
        const [za, zb] = z();
        p.pos = Math.min(1, Math.max(0, (Number(num.value) - za) / Math.max(zb - za, 0.01)));
        aplicar();
        pintarBarra();
        pintarEditor();
      });
      quitar.addEventListener('click', () => {
        cfg.paradas.splice(i, 1);
        aplicar();
        pintarBarra();
        pintarEditor();
      });
      cont.append(fila);
    });
    editor.querySelectorAll('[data-paleta]').forEach((btn) =>
      btn.addEventListener('click', () => {
        cfg.paradas = PALETAS[btn.dataset.paleta].map((p) => ({ ...p }));
        aplicar();
        pintarBarra();
        pintarEditor();
      }),
    );
    editor.querySelector('[data-e=cerrar]').addEventListener('click', () => alternarEditor(false));
    editor.querySelector('[data-e=anadir]').addEventListener('click', () => {
      // Nuevo color en el mayor hueco entre paradas.
      ordenar();
      let mejor = 0;
      for (let i = 1; i < cfg.paradas.length; i += 1) {
        if (cfg.paradas[i].pos - cfg.paradas[i - 1].pos > cfg.paradas[mejor + 1].pos - cfg.paradas[mejor].pos) mejor = i - 1;
      }
      const a0 = cfg.paradas[mejor];
      const a1 = cfg.paradas[mejor + 1];
      cfg.paradas.push({ pos: (a0.pos + a1.pos) / 2, color: a0.color });
      aplicar();
      pintarBarra();
      pintarEditor();
    });
    editor.querySelector('[data-e=reset]').addEventListener('click', () => {
      cfg = { paradas: RAMPA_POR_DEFECTO.map((p) => ({ ...p })), rango: null };
      aplicar();
      pintarBarra();
      pintarEditor();
    });
    const leerRango = () => {
      const manual = editor.querySelector('input[name=rango][value=manual]').checked;
      const min = Number(editor.querySelector('[data-r=min]').value);
      const max = Number(editor.querySelector('[data-r=max]').value);
      cfg.rango = manual && Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
      aplicar();
      pintarBarra();
      pintarEditor();
    };
    editor.querySelectorAll('input[name=rango], [data-r]').forEach((el) => el.addEventListener('change', leerRango));
  }

  function alternarEditor(forzar) {
    abierto = forzar ?? !abierto;
    pintarEditor();
  }

  barra.addEventListener('dblclick', () => alternarEditor(true));
  aplicar();
  return {
    actualizar() {
      pintarBarra();
      if (barra.hidden) abierto = false;
    },
    refrescarEditor: () => abierto && pintarEditor(),
  };
}
