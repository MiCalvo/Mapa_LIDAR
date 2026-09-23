import { montarCanal } from './ui/canal.js';
import { montarPunto } from './ui/punto.js';
import { montarManantiales } from './ui/manantiales.js';
import { instalarClics } from './viewer/picar.js';
import { Escena } from './viewer/escena.js';
import { pintarZonas, pintarClases, botonRepetible } from './ui/panel.js';
import { uniformesTerreno, fijarLuz } from './viewer/capaTerreno.js';
import { MapaSelector, terrenosSinSolapes, TEXTO_ESTADO, COLOR_ESTADO } from './ui/mapa.js';
import { montarEditorCurvas } from './ui/curvas.js';
import { montarEscala } from './ui/escala.js';
import { montarBrujula } from './ui/brujula.js';
import { montarModoFoto } from './ui/foto.js';
import { abrirAyudaManual } from './ui/manual.js';

const estado = {
  vista: 'terreno', // terreno | puntos
  superficie: 'mdt', // mdt (suelo) | mds (con árboles y edificios)
  modoColor: 'rgb',
  calidad: 'media',
  tamanoPunto: 1.5,
  presupuesto: 6_000_000,
  clasesVisibles: new Set([1, 2, 3, 4, 5, 6, 9, 17]),
  rgb16: true, // PNOA y geoEuskadi usan color de 16 bits
  zMin: undefined,
  zMax: undefined,
  puntosVisibles: 0,
};

const escena = new Escena(document.getElementById('lienzo'), estado);
const tele = document.getElementById('telemetria');
escena.alCambiar = () => {
  const n = escena.bloques.size;
  if (!n) {
    tele.textContent = 'Sin bloques cargados';
    return;
  }
  const partes = [`${n} bloque(s)`];
  const terrenos = [...escena.terrenos.values()].filter((t) => t.mostrado);
  if (terrenos.length) {
    const res = Math.min(...terrenos.map((t) => t.meta.resolucion));
    partes.push(`terreno ${estado.superficie === 'mds' ? 'con objetos' : 'suelo'} · celda ${res} m`);
  }
  if (escena.capas.size) {
    partes.push(`${(estado.puntosVisibles / 1e6).toFixed(2)} M puntos · calidad ${estado.calidad}`);
  }
  tele.textContent = partes.join(' · ');
};

let zonasCache = [];
const idsActivos = () => new Set(escena.bloques.keys());

async function cargarZonas() {
  const lista = document.getElementById('lista-zonas');
  try {
    const { zonas } = await (await fetch('/api/zonas')).json();
    zonasCache = zonas;
    pintarZonas(lista, zonas, {
      alActivar: (z, b) => escena.activar(z, b).then(() => escena.recolorear()),
      alDesactivar: (z, b) => escena.desactivar(z, b),
      activos: idsActivos(),
    });
    pintarSeleccion3D();
  } catch (error) {
    lista.textContent = `No se pudo leer la lista de zonas: ${error}`;
  }
}

// ---------------------------------------------------------------- avisos
const aviso = document.getElementById('aviso');
let tAviso = 0;
function avisar(texto) {
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(tAviso);
  tAviso = setTimeout(() => {
    aviso.hidden = true;
  }, 6000);
}

// ---------------------------------------------------------------- modos
const btnModo = document.getElementById('btn-modo');
let mapaRef = null; // se asigna al crear el mapa (el constructor ya avisa de cambios)
const mapa = new MapaSelector({
  alCambioSeleccion: () => pintarSeleccion3D(),
  alIrMapa: () => ponerModo('mapa'),
  alIr3D: () => {
    // Si no hay nada cargado, «3D» carga lo que esté listo de la selección.
    const listos = [...mapaRef.seleccion.values()].filter((b) => ['listo', 'parcial'].includes(b.estado));
    if (!escena.bloques.size && listos.length) mapaRef.accion('ver');
    else ponerModo('3d');
  },
  lienzo: document.getElementById('mapa'),
  panel: document.getElementById('panel-mapa'),
  alAviso: avisar,
  alCargar3D: async (refs) => {
    if (!refs.length) return avisar('Ninguno de los bloques elegidos tiene terreno generado todavía.');
    const MAX = 36; // ~32 MB de memoria de vídeo por bloque de 2 km
    if (refs.length > MAX) {
      avisar(`Se cargan ${MAX} de ${refs.length} bloques: más podría agotar la memoria de vídeo.`);
      refs = refs.slice(0, MAX);
    }
    await cargarZonas();
    for (const [id, { zona, bloque }] of [...escena.bloques]) {
      void id;
      escena.desactivar(zona, bloque);
    }
    ponerModo('3d');
    let cargados = 0;
    for (const r of refs) {
      const zona = zonasCache.find((z) => z.id === r.zona);
      const bloque = zona?.bloques.find((b) => b.id === r.bloque);
      if (!zona || !bloque) continue;
      try {
        await escena.activar(zona, bloque);
        cargados += 1;
      } catch (error) {
        avisar(`No se pudo abrir ${bloque.nombre}: ${error?.message || error}`);
      }
    }
    escena.encuadrarTodo();
    await cargarZonas();
    escena.alCambiar();
    if (!cargados) avisar('No se encontró el terreno de esos bloques.');
  },
});

mapaRef = mapa;

// ---------------------------------------------------------------- lista «Selección» (3D)
const listaSel = document.getElementById('lista-seleccion');
const cargarAlTerminar = new Set(); // bloques que se cargan solos al terminar su descarga
const idRef = (r) => `${r.zona}/${r.bloque}`;
const claveB = (b) => `${b.huso}_${b.x}_${b.y}`;

async function asegurarZonas(refs) {
  if (refs.every((r) => zonasCache.some((z) => z.id === r.zona && z.bloques.some((b) => b.id === r.bloque)))) return;
  await cargarZonas();
}

async function cargarBloque3D(b, cargar) {
  const refs = terrenosSinSolapes([b]);
  if (cargar) {
    await asegurarZonas(refs);
    const hadNada = !escena.bloques.size;
    for (const r of refs) {
      if (escena.bloques.has(idRef(r))) continue;
      const zona = zonasCache.find((z) => z.id === r.zona);
      const bloque = zona?.bloques.find((x) => x.id === r.bloque);
      if (!zona || !bloque) continue;
      try {
        await escena.activar(zona, bloque);
      } catch (error) {
        avisar(`No se pudo abrir ${bloque.nombre}: ${error?.message || error}`);
      }
    }
    if (hadNada) escena.encuadrarTodo();
  } else {
    // Se quitan sus terrenos salvo los que use otro bloque seleccionado que siga cargado.
    const enUso = new Set();
    for (const o of mapaRef.seleccion.values()) {
      if (claveB(o) === claveB(b)) continue;
      const rs = terrenosSinSolapes([o]);
      if (rs.length && rs.every((r) => escena.bloques.has(idRef(r)))) rs.forEach((r) => enUso.add(idRef(r)));
    }
    for (const r of refs) {
      const act = escena.bloques.get(idRef(r));
      if (act && !enUso.has(idRef(r))) escena.desactivar(act.zona, act.bloque);
    }
  }
  escena.alCambiar();
  cargarZonas();
  pintarSeleccion3D();
}

function pintarSeleccion3D() {
  if (!mapaRef) return;
  const sel = [...mapaRef.seleccion.values()].sort((a, b) => b.y - a.y || a.x - b.x);
  document.getElementById('n-sel').textContent = String(sel.length);
  listaSel.textContent = '';
  if (!sel.length) {
    listaSel.innerHTML =
      '<p class="vacio">No hay bloques seleccionados. Elígelos en el mapa (bloques de 2 km o «Seleccionar un área»).</p>';
    const b = document.createElement('button');
    b.className = 'mini';
    b.textContent = '← Ir al mapa';
    b.addEventListener('click', () => ponerModo('mapa'));
    listaSel.append(b);
    return;
  }
  for (const b of sel) {
    const refs = terrenosSinSolapes([b]);
    const cargado = refs.length > 0 && refs.every((r) => escena.bloques.has(idRef(r)));
    const t = b.trabajo;
    const enCurso = t && !['hecho', 'error'].includes(t.estado);
    // Carga automática al terminar una descarga pedida desde aquí.
    if (cargarAlTerminar.has(claveB(b)) && !enCurso && refs.length) {
      cargarAlTerminar.delete(claveB(b));
      if (!cargado) cargarBloque3D(b, true);
    }
    const fila = document.createElement('div');
    fila.className = 'bloque sel3d';
    const label = document.createElement('label');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.checked = cargado;
    casilla.disabled = !refs.length;
    casilla.title = refs.length ? 'Cargar / quitar de la vista 3D' : 'Todavía no hay terreno de este bloque';
    const texto = document.createElement('span');
    texto.innerHTML = '<b></b><small></small>';
    texto.querySelector('b').textContent = `Bloque ${b.x}-${b.y}`;
    const cob = b.cobertura && b.cobertura < 0.95 ? ` · ${Math.round(b.cobertura * 100)} %` : '';
    texto.querySelector('small').innerHTML =
      `<i style="background:${COLOR_ESTADO[b.estado]}"></i>${TEXTO_ESTADO[b.estado] || b.estado}${cob}`;
    casilla.addEventListener('change', async () => {
      casilla.disabled = true;
      await cargarBloque3D(b, casilla.checked);
    });
    label.append(casilla, texto);
    fila.append(label);
    const acc = document.createElement('div');
    acc.className = 'acc';
    if (enCurso) {
      acc.innerHTML = `<div class="barra"><i style="width:${Math.round((t.progreso || 0) * 100)}%"></i></div><small>${t.estado}</small>`;
    } else {
      const puedeBajar = ['disponible', 'parcial'].includes(b.estado) && b.fuentes?.some((f) => f.ok);
      const accion = b.estado === 'descargado' ? 'procesar' : puedeBajar ? 'descargar' : null;
      if (accion) {
        const btn = document.createElement('button');
        btn.className = 'mini';
        btn.textContent = accion === 'procesar' ? 'Procesar' : 'Descargar';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          cargarAlTerminar.add(claveB(b));
          await mapaRef.trabajar(accion, [b]);
        });
        acc.append(btn);
      }
      if (!accion && ['sin-datos', 'sin-enlace'].includes(b.estado)) {
        const btn = document.createElement('button');
        btn.className = 'mini';
        btn.textContent = 'Cómo conseguirlo';
        btn.addEventListener('click', () => abrirAyudaManual([b]));
        acc.append(btn);
      }
      if (t?.estado === 'error') {
        const e = document.createElement('small');
        e.className = 'error';
        e.textContent = t.mensaje;
        e.title = t.mensaje;
        acc.append(e);
      }
    }
    fila.append(acc);
    listaSel.append(fila);
  }
}

// Pestañas «Selección» / «Todo el PC»
for (const b of document.querySelectorAll('[data-pest]')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('[data-pest]')) o.classList.toggle('a', o === b);
    listaSel.hidden = b.dataset.pest !== 'sel';
    document.getElementById('lista-zonas').hidden = b.dataset.pest !== 'todo';
  });
}

function ponerModo(modo) {
  document.body.dataset.modo = modo;
  btnModo.textContent = modo === 'mapa' ? 'Ver 3D' : 'Mapa';
  if (modo === 'mapa') {
    escena.pausa = true;
    mapa.abrir();
  } else {
    mapa.cerrar();
    escena.pausa = false;
    escena.redimensionar();
    pintarSeleccion3D();
  }
}
btnModo.addEventListener('click', () => ponerModo(document.body.dataset.modo === 'mapa' ? '3d' : 'mapa'));

for (const seg of document.querySelectorAll('[data-seg]')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const o of seg.querySelectorAll('button')) o.classList.toggle('a', o === b);
    const clave = seg.dataset.seg;
    estado[clave] = b.dataset.valor;
    if (clave === 'modoColor') escena.recolorear();
    if (clave === 'vista') document.body.dataset.vista = b.dataset.valor;
    if (clave === 'superficie') document.body.dataset.superficie = b.dataset.valor;
    if (clave === 'vista' || clave === 'superficie') {
      escena.aplicarVista().catch((error) => {
        tele.textContent = `Error: ${error?.message || error}`;
      });
    }
    if (clave === 'colorTerreno') {
      uniformesTerreno.modo.value = Number(b.dataset.valor);
      if (uniformesTerreno.modo.value === 3) escena.asegurarOrto();
    }
    escena.pedirLod();
  });
}

const tamano = document.getElementById('tamano');
tamano.addEventListener('input', () => {
  estado.tamanoPunto = Number(tamano.value);
  document.getElementById('tamano-v').textContent = tamano.value;
});
const presupuesto = document.getElementById('presupuesto');
presupuesto.addEventListener('input', () => {
  estado.presupuesto = Number(presupuesto.value) * 1e6;
  document.getElementById('presupuesto-v').textContent = `${presupuesto.value} M`;
  escena.pedirLod();
});

// Exageración vertical (terreno y objetos): barra de 0/1 a 5 y casilla para escribir cualquier
// valor; la barra se amplía si hace falta.
function enlazarExag(idBarra, idNum, uniforme, minimo) {
  const barra = document.getElementById(idBarra);
  const num = document.getElementById(idNum);
  const poner = (v, desde) => {
    const x = Math.min(200, Math.max(minimo, Number.isFinite(Number(v)) ? Number(v) : 1));
    uniforme.value = x;
    if (desde !== 'barra') {
      barra.max = String(Math.max(5, Math.ceil(x)));
      barra.value = String(x);
    }
    if (desde !== 'numero') num.value = String(x);
  };
  barra.addEventListener('input', () => poner(barra.value, 'barra'));
  num.addEventListener('change', () => poner(num.value, 'numero'));
}
enlazarExag('exag', 'exag-v', uniformesTerreno.exag, 0.1);
enlazarExag('exag-obj', 'exag-obj-v', uniformesTerreno.exagObj, 0);
montarEditorCurvas(document.getElementById('curvas'));
const RUMBOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const luz = document.getElementById('luz');
const aplicarLuz = () => {
  const a = Number(luz.value);
  fijarLuz(a, 40);
  document.getElementById('luz-v').textContent = RUMBOS[Math.round(a / 45) % 8];
};
luz.addEventListener('input', aplicarLuz);
aplicarLuz();
const iso = document.getElementById('iso');
iso.addEventListener('change', () => {
  uniformesTerreno.isoOn.value = iso.checked ? 1 : 0;
});

pintarClases(document.getElementById('clases'), estado, () => escena.recolorear());

const enMapa = () => document.body.dataset.modo === 'mapa';
botonRepetible(document.getElementById('btn-acercar'), () => (enMapa() ? mapa.zoom(1.25) : escena.zoom(0.9)));
botonRepetible(document.getElementById('btn-alejar'), () => (enMapa() ? mapa.zoom(0.8) : escena.zoom(1 / 0.9)));
botonRepetible(document.getElementById('btn-girar-izq'), () => escena.girar(-4));
botonRepetible(document.getElementById('btn-girar-der'), () => escena.girar(4));
botonRepetible(document.getElementById('btn-subir'), () => escena.inclinar(3));
botonRepetible(document.getElementById('btn-bajar'), () => escena.inclinar(-3));
document.getElementById('btn-encuadrar').addEventListener('click', () => escena.encuadrarTodo());

// ---------------------------------------------------------------- escala de colores y brújula (3D)
const escala = montarEscala({
  barra: document.getElementById('escala'),
  editor: document.getElementById('editor-escala'),
  estado,
  alCambiarRango: () => escena.actualizarRango(),
});
escena.alErrorOrto = (n) =>
  avisar(`No se pudo traer la ortofoto de ${n} bloque(s) (servicio WMS del IGN). Se muestra el color por altura.`);
const brujula = montarBrujula(document.getElementById('brujula'), escena);
(function bucleHud() {
  if (document.body.dataset.modo === '3d') {
    brujula.actualizar();
    escala.actualizar();
  }
  requestAnimationFrame(bucleHud);
})();

// ---------------------------------------------------------------- herramientas sobre el terreno
instalarClics(escena, avisar);
const punto = montarPunto({
  boton: document.getElementById('btn-punto'),
  tarjeta: document.getElementById('tarjeta-punto'),
  escena,
  avisar,
});
const canal = montarCanal({
  boton: document.getElementById('btn-canal'),
  panel: document.getElementById('panel-canal'),
  escena,
  avisar,
});

const manantiales = montarManantiales({
  boton: document.getElementById('btn-manantiales'),
  leyenda: document.getElementById('leyenda-manantiales'),
  tarjeta: document.getElementById('tarjeta-manantial'),
  mapa,
  escena,
  canal,
  avisar,
});

// ---------------------------------------------------------------- modo foto
montarModoFoto({
  boton: document.getElementById('btn-foto'),
  dialogo: document.getElementById('dialogo-foto'),
  capturar: () => {
    // PNG solo de la vista (sin la interfaz). En 3D se dibuja justo antes de leer el lienzo.
    const enMapa = document.body.dataset.modo === 'mapa';
    const lienzo = enMapa ? document.getElementById('mapa') : escena.renderer.domElement;
    if (!enMapa) escena.renderer.render(escena.scene, escena.camara);
    let url;
    try {
      url = lienzo.toDataURL('image/png');
    } catch {
      avisar('No se puede guardar el mapa como imagen (las teselas de OpenStreetMap lo impiden); usa una captura de pantalla.');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapa-lidar-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
  },
});

cargarZonas();
ponerModo('mapa');
mapa.irA({ tipo: 'peninsula' });
window.__mapaLidar = { escena, estado, mapa, canal, punto, manantiales };
