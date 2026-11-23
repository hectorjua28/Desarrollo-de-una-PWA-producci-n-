const VERSION = 'v1.1.0';
const STATIC_CACHE = `reportaya-static-${VERSION}`;
const DYNAMIC_CACHE = `reportaya-dynamic-${VERSION}`;
const TILES_CACHE = `reportaya-tiles-${VERSION}`;
const TILES_LIMIT = 120;
const DYNAMIC_LIMIT = 60;

// Recursos del App Shell (precarga)
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/auth.js',
  './js/native.js',
  './js/minimap.js',
  './icons/favicon-32.png',
  './icons/icon-96.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-72.png',
  './icons/apple-touch-icon.png',
];

/* ---------------------- INSTALL ---------------------- */
self.addEventListener('install', (event) => {
  console.log(`[SW ${VERSION}] Instalando y precargando App Shell…`);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => console.log(`[SW ${VERSION}] App Shell en caché`))
      // La primera instalación se activa de inmediato; las actualizaciones
      // esperan a que el usuario pulse "Actualizar" (mensaje SKIP_WAITING).
      .then(() => (self.registration.active ? undefined : self.skipWaiting()))
  );
});

/* ---------------------- ACTIVATE ---------------------- */
self.addEventListener('activate', (event) => {
  console.log(`[SW ${VERSION}] Activando y limpiando cachés antiguas…`);
  const current = [STATIC_CACHE, DYNAMIC_CACHE, TILES_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('reportaya-') && !current.includes(key))
          .map((key) => {
            console.log(`[SW ${VERSION}] Eliminando caché obsoleta: ${key}`);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim()) // Toma el control de las pestañas abiertas
  );
});

/* ---------------------- MENSAJES ---------------------- */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------------------- FETCH ---------------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Navegación → Network First
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // 2) Teselas de OpenStreetMap → Stale-While-Revalidate
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(staleWhileRevalidate(request, TILES_CACHE, TILES_LIMIT));
    return;
  }

  // 3) Recursos propios → Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
  // Otros orígenes: el navegador los maneja normalmente
});

/* ---------------------- Estrategias ---------------------- */
async function matchOwn(request) {
  for (const name of [STATIC_CACHE, DYNAMIC_CACHE]) {
    const cache = await caches.open(name);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
  }
  return undefined;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    // Sin red: página en caché → App Shell → página offline
    return (await matchOwn(request))
      || (await matchOwn('./index.html'))
      || matchOwn('./offline.html');
  }
}

async function cacheFirst(request) {
  const cached = await matchOwn(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      await cache.put(request, response.clone());
      trimCache(DYNAMIC_CACHE, DYNAMIC_LIMIT);
    }
    return response;
  } catch {
    if (request.destination === 'image') return matchOwn('./icons/icon-192.png');
    return new Response('', { status: 503, statusText: 'Sin conexión' });
  }
}

async function staleWhileRevalidate(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      // Las teselas son "opaque" (no-cors): status 0 también se guarda
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone()).then(() => trimCache(cacheName, limit));
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || offlineTile();
}

/** Tesela gris de respaldo (evita errores en consola cuando no hay red ni caché). */
function offlineTile() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dfe8e6"/></svg>';
  return new Response(svg, { status: 200, headers: { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' } });
}

/** Mantiene una caché por debajo de un número máximo de entradas (FIFO). */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await Promise.all(keys.slice(0, keys.length - maxItems).map((k) => cache.delete(k)));
  }
}

/* ---------------------- NOTIFICACIONES ---------------------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        await client.focus();
        return client.navigate ? client.navigate(target) : undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});
