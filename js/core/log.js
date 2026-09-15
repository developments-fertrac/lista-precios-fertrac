// ============================================================
// CORE — App.Log — Singleton de registro de errores de la app
// Envía errores/avisos al endpoint ?log=1 del API (Log.gs backend),
// que los escribe en la hoja "Log App" de BASE DEMO MOTOR.
//
// Garantías:
//   • Nunca rompe la app: todo fallo interno se traga en un try/catch.
//   • Fire-and-forget: solo hay request HTTP cuando hay algo que reportar.
//   • Dedupe por módulo+mensaje (1 hora): no se llena la hoja con el
//     mismo error repetido (ej. temporalmente_ocupado cada 5 min).
//   • Cola offline: si no hay red, el log se guarda local y se reenvía
//     en cuanto vuelve la conexión (tope de 20 pendientes).
//   • CAPA = 'app': viaja en el query sin depender del token (el log
//     llega incluso cuando el fallo es de autenticación).
// ============================================================
window.App = window.App || {};
(function (window) {
  'use strict';
  if (window.App.Log) return;

  const PEND_KEY      = 'fertrac_log_pending';
  const SES_DEDUPE    = 'fertrac_log_dedupe';
  const TTL_CLIENTE   = 60 * 60 * 1000;   // 1 h sin reenviar el mismo error
  const COLA_MAX      = 20;               // tope local de pendientes
  const URL           = window.APPS_SCRIPT_URL || '';
  const KEY           = window.ACCESS_KEY || '';

  // ── Utilidades ──
  function hash(s) {
    let h = 5381;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function userEmail() {
    try { return localStorage.getItem('fertrac_user') || ''; } catch (e) { return ''; }
  }

  function plataforma() {
    try { return (window.App.Platform && App.Platform.label) || 'web'; } catch (e) { return 'web'; }
  }

  // Dedupe en memoria de sesión: `true` si este error ya se reportó hace poco.
  function dedupe(nivel, modulo, mensaje) {
    try {
      const k = 'ld:' + hash(nivel + '|' + modulo + '|' + String(mensaje).slice(0, 120));
      const ses = JSON.parse(sessionStorage.getItem(SES_DEDUPE) || '{}') || {};
      const ahora = Date.now();
      if (ses[k] && (ahora - ses[k]) < TTL_CLIENTE) return true;
      ses[k] = ahora;
      sessionStorage.setItem(SES_DEDUPE, JSON.stringify(ses));
    } catch (e) {}
    return false;
  }

  function encolar(qs) {
    try {
      const arr = JSON.parse(localStorage.getItem(PEND_KEY) || '[]') || [];
      if (arr.length >= COLA_MAX) arr.shift();          // no acumular sin límite
      arr.push(qs);
      localStorage.setItem(PEND_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  function _flushPendientes() {
    let pend = [];
    try { pend = JSON.parse(localStorage.getItem(PEND_KEY) || '[]') || []; } catch (e) { pend = []; }
    if (!pend.length) return;
    try { localStorage.removeItem(PEND_KEY); } catch (e) {}   // optimista: se re-encolan si falla
    pend.forEach(qs => {
      const ctrl = new AbortController();
      setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 5000);
      fetch(URL + '?' + qs, { signal: ctrl.signal }).catch(() => encolar(qs));
    });
  }

  function _enviar(nivel, modulo, mensaje, stack, extra) {
    try {
      if (dedupe(nivel, modulo, mensaje)) return;
      const extraStr = extra
        ? (typeof extra === 'string' ? extra : JSON.stringify(extra))
        : '';
      const qs =
        'log=1&key=' + encodeURIComponent(KEY) +
        '&capa=app' +
        '&nivel=' + encodeURIComponent(nivel) +
        '&modulo=' + encodeURIComponent(String(modulo || 'general').slice(0, 40)) +
        '&mensaje=' + encodeURIComponent(String(mensaje || '').slice(0, 600)) +
        '&stack=' + encodeURIComponent(String(stack || '').slice(0, 1200)) +
        '&email=' + encodeURIComponent(userEmail()) +
        '&extra=' + encodeURIComponent(extraStr.slice(0, 600));

      if (!navigator.onLine) { encolar(qs); return; }

      const ctrl = new AbortController();
      setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 5000);
      fetch(URL + '?' + qs, { signal: ctrl.signal }).catch(() => encolar(qs));
    } catch (e) { /* el log jamás rompe la app */ }
  }

  // ── API pública ──
  window.App.Log = {
    error: function (modulo, mensaje, stack, extra) { _enviar('error', modulo, mensaje, stack, extra); },
    warn:  function (modulo, mensaje, stack, extra) { _enviar('warn',  modulo, mensaje, stack, extra); },
    info:  function (modulo, mensaje, stack, extra) { _enviar('info',  modulo, mensaje, stack, extra); },
    flush: function () { _flushPendientes(); }
  };

  // ── Reenvío de pendientes al recuperar la red ──
  if (window.addEventListener) {
    window.addEventListener('online', _flushPendientes);
  }

  // ── Captura global de errores no controlados ──
  // Solo errores de script (no errores de recursos/imágenes, que ya tienen
  // su propia ruta y podrían saturar el log). Respeta handlers previos.
  const prevError = window.onerror;
  window.onerror = function (mensaje, fuente, linea, columna, error) {
    if (prevError) { try { prevError.apply(window, arguments); } catch (e) {} }
    _enviar('error', 'global', String(mensaje || 'error desconocido'), String(error && error.stack || ''), {
      url: String(fuente || '').slice(0, 200),
      linea: linea,
      online: !!navigator.onLine
    });
    return false;
  };

  window.addEventListener('unhandledrejection', function (ev) {
    const r = ev && ev.reason;
    _enviar('error', 'promesa', String(r && r.message || r || 'promesa rechazada'),
      String(r && r.stack || ''), { online: !!navigator.onLine });
  });
})(window);