const CACHE = 'fertrac-v10.0.1';
const V = 'v=10.0.1';

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
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => {
      // Fallback offline: el precache guarda las URLs CON ?v=…, la página pide
      // sin query → normalizar quitando el query antes de buscar en caché.
      const url = new URL(e.request.url);
      url.search = '';
      return caches.match(url.toString()).then(c => c || caches.match(e.request));
    })
  );
});