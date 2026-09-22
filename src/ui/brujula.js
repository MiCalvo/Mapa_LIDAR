/**
 * Brújula de la vista 3D: la aguja apunta al norte (+Y UTM) según hacia dónde
 * mira la cámara. Tocarla orienta la vista al norte.
 */
export function montarBrujula(el, escena) {
  el.innerHTML = `<svg viewBox="-50 -50 100 100" width="76" height="76" aria-hidden="true">
      <circle r="46" class="aro"/>
      <g class="rosa">
        <path d="M0,-38 L9,0 L0,6 L-9,0 Z" class="norte"/>
        <path d="M0,38 L9,0 L0,-6 L-9,0 Z" class="sur"/>
        <text y="-26" class="n">N</text>
        <text x="30" y="4" class="p">E</text><text x="-30" y="4" class="p">O</text><text y="34" class="p">S</text>
      </g>
    </svg>`;
  el.title = 'Norte · toca para orientar la vista al norte';
  const rosa = el.querySelector('.rosa');
  el.addEventListener('click', () => escena.orientarNorte());
  let ultimo = NaN;
  return {
    actualizar() {
      const g = escena.rumbo(); // grados: hacia dónde mira la cámara, desde el norte y en sentido horario
      if (Math.abs(g - ultimo) < 0.2) return;
      ultimo = g;
      rosa.setAttribute('transform', `rotate(${-g})`);
    },
  };
}
