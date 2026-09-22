/**
 * Conversión UTM (ETRS89/WGS84, elipsoide GRS80) ↔ latitud/longitud.
 * Series de Krüger (Karney 2011) de orden 6: error submilimétrico dentro del huso
 * y de pocos milímetros hasta ~5° fuera de él, más que suficiente para dibujar.
 */
const A = 6378137;
const F = 1 / 298.257222101; // GRS80
const K0 = 0.9996;
const E0 = 500000;

const n = F / (2 - F);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const n5 = n4 * n;
const n6 = n5 * n;
const AA = (A / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const alfa = [
  0,
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
  (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
  (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
  (212378941 / 319334400) * n6,
];
const beta = [
  0,
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
  (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
  (4583 / 161280) * n5 - (108847 / 3991680) * n6,
  (20648693 / 638668800) * n6,
];
const e = Math.sqrt(F * (2 - F));
const rad = Math.PI / 180;

export const meridianoCentral = (huso) => huso * 6 - 183;

/** Latitud/longitud (grados) → UTM [E, N] en el huso indicado (hemisferio norte). */
export function geoAUtm(lat, lon, huso) {
  const phi = lat * rad;
  const lam = (lon - meridianoCentral(huso)) * rad;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(lam));
  const eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi1;
  let eta = eta1;
  for (let j = 1; j <= 6; j += 1) {
    xi += alfa[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta += alfa[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  return [E0 + K0 * AA * eta, K0 * AA * xi];
}

/** UTM [E, N] (metros, hemisferio norte) → [lat, lon] en grados. */
export function utmAGeo(E, N, huso) {
  const xi = N / (K0 * AA);
  const eta = (E - E0) / (K0 * AA);
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 6; j += 1) {
    xi1 -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  const lam = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  // Latitud conforme → geodésica (Newton sobre tau = tan(phi)).
  const tauP = Math.tan(chi);
  let tau = tauP;
  for (let k = 0; k < 6; k += 1) {
    const s = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
    const tauI = tau * Math.sqrt(1 + s * s) - s * Math.sqrt(1 + tau * tau);
    const d =
      ((tauP - tauI) / Math.sqrt(1 + tauI * tauI)) *
      ((1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau)));
    tau += d;
    if (Math.abs(d) < 1e-14) break;
  }
  return [Math.atan(tau) / rad, meridianoCentral(huso) + lam / rad];
}

/** Huso UTM estándar de una longitud. */
export const husoDe = (lon) => Math.floor((lon + 180) / 6) + 1;
