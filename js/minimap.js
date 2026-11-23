/* =========================================================
   minimap.js · Mapa ligero con teselas de OpenStreetMap
   Sin librerías: calcula las 9 teselas (3x3) alrededor del punto.
   El Service Worker las guarda (Stale-While-Revalidate), así que
   un mapa visto con conexión también se ve sin conexión.
   ========================================================= */

const TILE = 256;
const ZOOM = 16;

function lngLatToPixel(lng, lat, z) {
  const scale = TILE * 2 ** z;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Devuelve el HTML del mini mapa centrado en lat/lng. */
export function miniMapHTML(lat, lng, zoom = ZOOM) {
  const { x, y } = lngLatToPixel(lng, lat, zoom);
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  // Posición del punto dentro de la cuadrícula 3x3 (que inicia en tx-1, ty-1)
  const offX = x - (tx - 1) * TILE;
  const offY = y - (ty - 1) * TILE;

  const max = 2 ** zoom;
  const imgs = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = (((tx + dx) % max) + max) % max;
      const cy = ty + dy;
      imgs.push(`<img src="https://tile.openstreetmap.org/${zoom}/${cx}/${cy}.png" alt="" crossorigin="anonymous" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`);
    }
  }

  return `
    <div class="minimap" role="img" aria-label="Mapa de la ubicación ${lat}, ${lng}">
      <div class="minimap__tiles" style="left: calc(50% - ${offX.toFixed(0)}px); top: calc(50% - ${offY.toFixed(0)}px);">
        ${imgs.join('')}
      </div>
      <div class="minimap__pin">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5" fill="#fff"/></svg>
      </div>
      <span class="minimap__attr">© OpenStreetMap</span>
    </div>`;
}

export const mapsLink = (lat, lng) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
