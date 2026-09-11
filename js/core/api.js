// ============================================================
// CORE — App.ApiClient — Singleton
// Capa de acceso al API. Envuelve el transporte bajo (apiRequest
// de auth.js, token-first/key-fallback) con cola de de-dupe.
// sendActivity() notifica eventos de actividad (Fase 3) al
// backend de logs.
// ============================================================
window.App = window.App || {};
(function (window) {
  'use strict';
  if (window.App.ApiClient) return;

  const Queue = window.App.Queue;

  function transport() { return window.apiRequest; }

  function getData() {
    return Queue.enqueue('data', function () { return transport()('data'); });
  }

  function getFotos() {
    return Queue.enqueue('fotos', function () { return transport()('fotos'); });
  }

  function getImg(fileId) {
    return Queue.enqueue('img:' + fileId, function () { return transport()('img', fileId); });
  }

  // Fase 3: registra eventos de sesión (login | heartbeat | end) en el
  // backend de logs. Sin email → no enviar (no auditor puede no loguear).
  function sendActivity(type) {
    let email = null;
    try { email = localStorage.getItem('fertrac_user'); } catch (e) {}
    if (!email) return Promise.resolve({ ok: true, queued: false });
    const url = LOG_SCRIPT_URL.split('?')[0]
      + '?email=' + encodeURIComponent(email)
      + '&activity=' + encodeURIComponent(type)
      + '&key=' + encodeURIComponent(ACCESS_KEY)
      + '&ts=' + Date.now();
    return fetch(url)
      .then(function (r) { return r.ok ? { ok: true } : { ok: false }; })
      .catch(function () { return { ok: false }; });
  }

  window.App.ApiClient = {
    getData: getData,
    getFotos: getFotos,
    getImg: getImg,
    sendActivity: sendActivity
  };
})(window);