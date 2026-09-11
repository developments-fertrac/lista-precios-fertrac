const CACHE = 'fertrac-v10.0.0';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      '/lista-precios-fertrac/',
      '/lista-precios-fertrac/index.html',
      '/lista-precios-fertrac/css/styles.css',
      '/lista-precios-fertrac/js/config.js',
      '/lista-precios-fertrac/js/core/store.js',
      '/lista-precios-fertrac/js/core/platform.js',
      '/lista-precios-fertrac/js/core/queue.js',
      '/lista-precios-fertrac/js/core/api.js',
      '/lista-precios-fertrac/js/core/session.js',
      '/lista-precios-fertrac/js/auth.js',
      '/lista-precios-fertrac/js/catalog.js',
      '/lista-precios-fertrac/manifest.json'
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
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
