// ============================================================
// CORE — App.Device — Singleton
// Identidad del dispositivo para la lista blanca (gs/Autorizacion.gs).
//   APK (Capacitor): "and-" + ANDROID_ID de @capacitor/device si el plugin
//                    está instalado; si no (APK sin plugin) "and-" + UUID.
//   Navegador / PWA: "web-" + UUID (la PWA comparte origen → mismo canal WEB).
// El prefijo define el canal en el backend (and- = APP, web- = WEB).
// Persistencia redundante: localStorage + IndexedDB; si una se borra, se
// restaura desde la otra. No se recolecta MAC, IMEI, teléfono ni ubicación.
// El ID completo funciona como credencial: no mostrarlo ni enviarlo a GA4
// (usar shortId() = últimos 6 caracteres).
// ============================================================
window.App = window.App || {};
(function (window) {
  'use strict';
  if (window.App.Device) return;

  const LS_KEY = 'fertrac_device_id';
  const IDB_NAME = 'fertrac_device';
  const IDB_STORE = 'kv';
  const IDB_TIMEOUT_MS = 1500;               // algunas WebViews dejan IndexedDB colgado
  const RE_VALIDO = /^(and|web)-[A-Za-z0-9_-]{8,80}$/;

  const isNative = !!(window.App.Platform && window.App.Platform.isNativeApp);
  const prefijo = isNative ? 'and-' : 'web-';

  // ── IndexedDB mínimo (con timeout; nunca rompe) ──
  function conTimeout(p) {
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, IDB_TIMEOUT_MS); })]);
  }
  function idbAbrir() {
    return new Promise(function (res) {
      try {
        const r = indexedDB.open(IDB_NAME, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(IDB_STORE); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function idbGet(k) {
    return conTimeout(idbAbrir().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          const q = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k);
          q.onsuccess = function () { res(q.result || null); };
          q.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    }));
  }
  function idbSet(k, v) {
    return conTimeout(idbAbrir().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(v, k);
          tx.oncomplete = function () { res(true); };
          tx.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    }));
  }

  function lsGet() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(LS_KEY, v); } catch (e) {} }

  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function esPropio(id) { return !!id && RE_VALIDO.test(id) && id.indexOf(prefijo) === 0; }

  function pluginDevice() {
    return isNative && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Device;
  }

  // ── Modelo / SO legible para el aprobador (sin datos sensibles) ──
  async function modelo() {
    const p = pluginDevice();
    if (p && p.getInfo) {
      try {
        const i = await p.getInfo();
        return [i.manufacturer, i.model, i.operatingSystem, i.osVersion].filter(Boolean).join(' ');
      } catch (e) {}
    }
    const ua = navigator.userAgent || '';
    const so = (ua.match(/Windows NT [\d.]+|Android [\d.]+|iPhone OS [\d_]+|iPad|Mac OS X [\d_]+|CrOS|Linux/) || ['?'])[0];
    const nav = (ua.match(/Edg\/\d+|OPR\/\d+|SamsungBrowser\/\d+|Chrome\/\d+|Firefox\/\d+|Version\/\d+.*Safari/) || ['?'])[0];
    return (so + ' · ' + nav).replace(/_/g, '.');
  }

  // ── Resolución del ID (una sola vez por carga) ──
  async function resolverId() {
    // 1) APK con plugin: ANDROID_ID (estable, sobrevive a "Borrar datos").
    const p = pluginDevice();
    if (p && p.getId) {
      try {
        const r = await p.getId();
        const raw = String((r && (r.identifier || r.uuid)) || '').replace(/[^A-Za-z0-9_-]/g, '');
        if (raw.length >= 8) {
          const id = 'and-' + raw.slice(0, 80);
          lsSet(id); idbSet(LS_KEY, id);
          return id;
        }
      } catch (e) {}
    }
    // 2) Persistido (localStorage → IndexedDB), restaurando la copia faltante.
    let id = lsGet();
    if (esPropio(id)) { idbSet(LS_KEY, id); return id; }
    const deIdb = await idbGet(LS_KEY);
    if (esPropio(deIdb)) { lsSet(deIdb); return deIdb; }
    // 3) Nuevo.
    id = prefijo + uuid();
    lsSet(id); await idbSet(LS_KEY, id);
    return id;
  }

  let _promesa = null;
  let _actual = null;
  function ready() {
    if (!_promesa) {
      _promesa = Promise.all([resolverId(), modelo()]).then(function (r) {
        _actual = {
          id: r[0],
          plat: (window.App.Platform && window.App.Platform.label) || '',
          modelo: String(r[1] || '').slice(0, 80),
          ver: (typeof APP_WEB_VERSION !== 'undefined' ? APP_WEB_VERSION : '')
        };
        return _actual;
      }).catch(function () {
        _promesa = null;                      // reintentar en la próxima petición
        return null;
      });
    }
    return _promesa;
  }

  // Parámetros para el API: &device=&canal=&plat=&modelo=&ver=
  function queryString(d) {
    if (!d || !d.id) return '';
    return '&device=' + encodeURIComponent(d.id) +
      '&canal=' + encodeURIComponent(window.FT_CANAL || '') +
      '&plat=' + encodeURIComponent(d.plat) +
      '&modelo=' + encodeURIComponent(d.modelo) +
      '&ver=' + encodeURIComponent(d.ver);
  }

  function shortId() {
    const id = (_actual && _actual.id) || lsGet() || '';
    return id ? id.slice(-6) : '------';
  }

  window.App.Device = { ready: ready, queryString: queryString, shortId: shortId };
  ready();                                    // precalienta: lista antes de la 1.ª petición
})(window);
