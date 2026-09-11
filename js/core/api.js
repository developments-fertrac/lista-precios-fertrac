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

  // Fase 3: datos incrementales (solo filas modificadas desde `since`).
  // `since` viene del último delta; vacío → el backend responde completo.
  function getDataDelta(since) {
    return Queue.enqueue('data', function () {
      return transport()('data', null, { delta: true, since: since || '' });
    });
  }

  function getFotos() {
    return Queue.enqueue('fotos', function () { return transport()('fotos'); });
  }

  function getImg(fileId) {
    return Queue.enqueue('img:' + fileId, function () { return transport()('img', fileId); });
  }

  // Fase 3: registra eventos de sesión (login | heartbeat | end | inactive).
// Se envía al API principal (APPS_SCRIPT_URL), autorizado igual que el
// resto (token-first/key-fallback) y con cola de dedupe por tipo+email.
// Sin sesión → no enviar. Errores de red son tolerados (best effort).
  function sendActivity(type) {
    if (!/^(login|heartbeat|end|inactive)$/.test(type)) return Promise.resolve({ ok: false });
    let email = null;
    try { email = localStorage.getItem('fertrac_user'); } catch (e) {}
    if (!email) return Promise.resolve({ ok: true, queued: false });
    const platform = (window.App.Platform && App.Platform.label) || 'web';
    return Queue.enqueue('activity:' + type + ':' + email, function () {
      return transport()('activity', null, { activity: type, email: email, platform: platform })
        .then(function () { return { ok: true }; })
        .catch(function () { return { ok: false }; });
    });
  }

  window.App.ApiClient = {
    getData: getData,
    getDataDelta: getDataDelta,
    getFotos: getFotos,
    getImg: getImg,
    sendActivity: sendActivity
  };
})(window);