const CACHE = 'fertrac-v10.4.0';
const V = 'v=10.4.0';

// Fase 4: caché runtime de imágenes (thumbnails de Drive) — independiente del
// precache: un bump de versión no borra las fotos ya descargadas.
const RT_IMG_CACHE = 'fertrac-imgs-v1';
const RT_IMG_MAX = 200;

async function responderImagenRuntime(req) {
  const cache = await caches.open(RT_IMG_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;                       // cache-first: re-ver instántaneo y offline
  try {
    // no-cors: como un <img> normal. Drive no envía cabeceras CORS (con 'cors'
    // el fetch del SW se rechazaba y el FetchEvent resolvía con error de red).
    // La respuesta 'opaque' resultante sí puede guardarse en Cache API y el
    // <img> la pinta igual. 'ok' es false en respuestas opaque → verificar type.
    const res = await fetch(req, { mode: 'no-cors' });
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      const keys = await cache.keys();
      if (keys.length >= RT_IMG_MAX) await cache.delete(keys[0]);   // round-robin (FIFO)
      await cache.put(req, copy);
    }
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

// Fase 4: devuelve el shell (index.html) precacheado. Útil cuando se abre la
// app sin conexión: el precache guarda la URL con ?v=… y la navegación pide la
// ruta limpia, así que se busca por pathname terminado en /index.html.
async function shellDesdeCache() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length; i++) {
    const p = new URL(keys[i].url).pathname;
    if (p.charAt(p.length - 1) === '/') continue;
    if (p.indexOf('/index.html') >= 0) return cache.match(keys[i]);
  }
  return null;
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      '/lista-precios-fertrac/?' + V,
      '/lista-precios-fertrac/index.html?' + V,
      '/lista-precios-fertrac/css/styles.css?' + V,
      '/lista-precios-fertrac/js/config.js?' + V,
      '/lista-precios-fertrac/js/core/store.js?' + V,
      '/lista-precios-fertrac/js/core/platform.js?' + V,
      '/lista-precios-fertrac/js/core/queue.js?' + V,
      '/lista-precios-fertrac/js/core/api.js?' + V,
      '/lista-precios-fertrac/js/core/session.js?' + V,
      '/lista-precios-fertrac/js/auth.js?' + V,
      '/lista-precios-fertrac/js/catalog.js?' + V,
      '/lista-precios-fertrac/manifest.json?' + V
    ]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      const keep = [CACHE, RT_IMG_CACHE];     // preservar el caché runtime de imágenes
      return Promise.all(
        keys.filter(k => keep.indexOf(k) < 0).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Fase 4: thumbnails de Drive se sirven cache-first desde el caché runtime.
  if (e.request.method === 'GET' &&
      url.hostname === 'drive.google.com' &&
      url.pathname.indexOf('/thumbnail') >= 0) {
    e.respondWith(responderImagenRuntime(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => {
      // Offline.
      // Navegación → devolver siempre el shell precacheado (SPA).
      if (e.request.mode === 'navigate') {
        return shellDesdeCache().then(c => c || Response.error());
      }
      // Recursos → normalizar quitando el query antes de buscar en caché.
      url.search = '';
      return caches.match(url.toString()).then(c => c || caches.match(e.request));
    })
  );
});