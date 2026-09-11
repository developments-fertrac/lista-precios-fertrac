// ============================================================
// CORE — App.Queue — Singleton
// Cola de de-dupe: evita peticiones concurrentes con la misma
// clave (ej. dos syncData disparadas por online + vuelta a primer
// plano). Devuelve la promesa en curso si la clave ya está activa.
// ============================================================
window.App = window.App || {};
(function (window) {
  'use strict';
  if (window.App.Queue) return;

  const running = {};

  function enqueue(key, fn) {
    if (running[key]) return running[key];
    const p = Promise.resolve().then(fn).finally(function () { delete running[key]; });
    running[key] = p;
    return p;
  }

  window.App.Queue = { enqueue: enqueue };
})(window);