/* ============================================================
 * CAR-SEV C.A. — Service Worker
 * Estrategia:
 *   · Precache en install  → assets propios + CDNs (tolerante a fallos)
 *   · Navegaciones         → Network-First con fallback a index.html
 *   · Mismo origen         → Stale-While-Revalidate (respuesta instantánea)
 *   · Cross-origin (CDNs)  → Cache-First con revalidación en segundo plano
 * ============================================================ */

const CACHE_NAME = 'carsev-v2.0.0';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192-v2.png',
  './js/calculator.js',
  './js/storage.js',
  './js/app.js'
];/* ---------- INSTALL: precache tolerante ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // allSettled: si un CDN falla durante la instalación, el SW no se corrompe.
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload', mode: 'no-cors' }))
        )
      );
      await self.skipWaiting();
    })()
  );
});

/* ---------- ACTIVATE: limpieza de cachés obsoletas ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- Utilidades ---------- */

// ¿La respuesta es utilizable para cachear?
function isCacheable(response) {
  if (!response) return false;
  // Opacas (no-cors): solo si NO son errores (los errores opacos status=0 con type 'opaque')
  if (response.type === 'opaque') return response.status === 0 || response.status === 200;
  return response.ok;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (isCacheable(fresh)) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fallback final: shell de la aplicación
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkPromise) || new Response('Sin conexión', { status: 503 });
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    // Revalidación silenciosa en segundo plano
    fetch(request)
      .then((response) => { if (isCacheable(response)) cache.put(request, response.clone()); })
      .catch(() => undefined);
    return cached;
  }
  try {
    const fresh = await fetch(request);
    if (isCacheable(fresh)) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    return new Response('Recurso no disponible sin conexión', { status: 503 });
  }
}

/* ---------- FETCH: enrutado por tipo de petición ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // CDNs, fuentes y demás recursos de terceros
  event.respondWith(cacheFirst(request));
});

/* ---------- MESSAGE: permitir actualización inmediata ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});