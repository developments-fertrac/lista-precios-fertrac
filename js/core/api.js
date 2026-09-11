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
  // Fase 4: si el envío falla por falta de conexión, el evento se encola en
  // localStorage y se reenvía en cuanto vuelve la red (flush sobre 'online').
  const ACTIVITY_PENDING_KEY = 'fertrac_activity_pending';

  function colaActividadPendiente() {
    try { return JSON.parse(localStorage.getItem(ACTIVITY_PENDING_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function guardarActividadPendiente(extra) {
    try {
      const arr = colaActividadPendiente();
      arr.push(extra);
      localStorage.setItem(ACTIVITY_PENDING_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  function flushActividadPendiente() {
    const pend = colaActividadPendiente();
    if (!pend.length) return Promise.resolve();
    try { localStorage.removeItem(ACTIVITY_PENDING_KEY); } catch (e) {}   // optimista
    return Promise.all(pend.map(function (extra) {
      return transport()('activity', null, extra).catch(function () {
        guardarActividadPendiente(extra);   // sigue sin red → de vuelta a la cola
      });
    }));
  }

  if (window.addEventListener) {
    window.addEventListener('online', function () { flushActividadPendiente(); });
  }

  function sendActivity(type) {
    if (!/^(login|heartbeat|end|inactive)$/.test(type)) return Promise.resolve({ ok: false });
    let email = null;
    try { email = localStorage.getItem('fertrac_user'); } catch (e) {}
    if (!email) return Promise.resolve({ ok: true, queued: false });
    const platform = (window.App.Platform && App.Platform.label) || 'web';
    return Queue.enqueue('activity:' + type + ':' + email, function () {
      const extra = { activity: type, email: email, platform: platform };
      return transport()('activity', null, extra)
        .then(function () { return { ok: true }; })
        .catch(function () {
          if (!navigator.onLine) guardarActividadPendiente(extra);
          return { ok: false };
        });
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