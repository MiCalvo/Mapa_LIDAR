/**
 * Modo foto: se eligen qué elementos de la interfaz se ocultan para hacer una
 * captura o grabar la pantalla. Esc (o el botón flotante, que no sale en la
 * captura si se oculta) vuelve a la vista normal. La elección se recuerda.
 */
const CLAVE = 'mapaLidar.foto.v1';

export const ELEMENTOS = [
  { id: 'marca', texto: 'Logo «Mapa LiDAR»', sel: '.marca', ocultar: true },
  { id: 'herramientas', texto: 'Barra de botones (arriba)', sel: '.herramientas', ocultar: true },
  { id: 'capas', texto: 'Selector de nivel', sel: '.capas', ocultar: true },
  { id: 'bloques', texto: 'Panel «Bloques» (3D)', sel: '.panel.izq', ocultar: true },
  { id: 'visual', texto: 'Panel «Visualización» (3D)', sel: '.panel.der:not(.mapa)', ocultar: true },
  { id: 'elegir', texto: 'Panel «Elegir zona» (mapa)', sel: '#panel-mapa', ocultar: true },
  { id: 'tabla', texto: 'Tabla del área (mapa)', sel: '.tabla-area', ocultar: true },
  { id: 'escala', texto: 'Escala de colores', sel: '#escala, #editor-escala', ocultar: false },
  { id: 'brujula', texto: 'Brújula', sel: '#brujula', ocultar: false },
  { id: 'tele', texto: 'Barra de estado (abajo a la izquierda)', sel: '#telemetria', ocultar: true },
  { id: 'avisos', texto: 'Avisos', sel: '#aviso', ocultar: true },
];

function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (d && typeof d === 'object') return d;
  } catch {
    /* sin almacenamiento */
  }
  return Object.fromEntries(ELEMENTOS.map((e) => [e.id, e.ocultar]));
}

export function montarModoFoto({ boton, dialogo, capturar }) {
  let ocultar = leer();
  let activo = false;
  const pista = document.createElement('div');
  pista.className = 'pista-foto';
  pista.textContent = 'Modo foto · pulsa Esc para salir';
  pista.hidden = true;
  document.body.append(pista);
  let tPista = 0;

  function aplicar() {
    for (const e of ELEMENTOS) {
      document.querySelectorAll(e.sel).forEach((el) => el.classList.toggle('oculto-foto', Boolean(ocultar[e.id])));
    }
  }

  function entrar() {
    activo = true;
    dialogo.hidden = true;
    aplicar();
    document.body.classList.add('modo-foto');
    pista.hidden = false;
    clearTimeout(tPista);
    // La pista desaparece sola para que no salga en la captura.
    tPista = setTimeout(() => {
      pista.hidden = true;
    }, 2500);
  }

  function salir() {
    activo = false;
    document.body.classList.remove('modo-foto');
    document.querySelectorAll('.oculto-foto').forEach((el) => el.classList.remove('oculto-foto'));
    pista.hidden = true;
  }

  function abrirDialogo() {
    dialogo.hidden = false;
    dialogo.innerHTML = `
      <header><b>Modo foto</b><button class="mini" data-f="cerrar" title="Cerrar">✕</button></header>
      <p class="nota">Marca lo que quieres <b>ocultar</b> para la foto o la grabación. Para volver, pulsa <kbd>Esc</kbd>.</p>
      <div class="opciones">${ELEMENTOS.map(
        (e) => `<label class="casilla"><input type="checkbox" data-id="${e.id}" ${ocultar[e.id] ? 'checked' : ''}/> ${e.texto}</label>`,
      ).join('')}</div>
      <div class="marcar"><button data-f="todo">Ocultar todo</button><button data-f="nada">Nada</button></div>
      <div class="pie">
        ${capturar ? '<button class="mini" data-f="png" title="Solo la vista (terreno o mapa), sin la interfaz">Guardar PNG de la vista</button>' : ''}
        <button class="prim" data-f="aceptar">Aceptar</button></div>`;
    dialogo.querySelectorAll('input[data-id]').forEach((c) =>
      c.addEventListener('change', () => {
        ocultar[c.dataset.id] = c.checked;
      }),
    );
    const marcarTodos = (v) => {
      for (const e of ELEMENTOS) ocultar[e.id] = v;
      abrirDialogo();
    };
    dialogo.querySelector('[data-f=cerrar]').addEventListener('click', () => {
      dialogo.hidden = true;
    });
    dialogo.querySelector('[data-f=todo]').addEventListener('click', () => marcarTodos(true));
    dialogo.querySelector('[data-f=nada]').addEventListener('click', () => marcarTodos(false));
    dialogo.querySelector('[data-f=png]')?.addEventListener('click', () => capturar());
    dialogo.querySelector('[data-f=aceptar]').addEventListener('click', () => {
      try {
        localStorage.setItem(CLAVE, JSON.stringify(ocultar));
      } catch {
        /* no pasa nada */
      }
      entrar();
    });
  }

  boton.addEventListener('click', () => (dialogo.hidden ? abrirDialogo() : (dialogo.hidden = true)));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (activo) salir();
    else if (!dialogo.hidden) dialogo.hidden = true;
  });
  return { get activo() { return activo; }, salir };
}
