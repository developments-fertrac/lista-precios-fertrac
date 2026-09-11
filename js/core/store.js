// ============================================================
// CORE — App.Store — Model + Observer (Singleton)
// Estado único del catálogo, índice por referencia y bus de
// eventos para las vistas (Observer). `C` es un binding léxico
// global declarado en config.js (const), accesible por nombre.
// Eventos emitidos:
//   'catalog.replaced'  primera carga / sincronización manual
//   'product.changed'   { refs, added, modified } cambios silenciosos
//   'product.removed'   { refs } filas que ya no existen
// ============================================================
window.App = window.App || {};
(function (window, C) {
  'use strict';
  if (window.App.Store) return;

  // Columna de REFERENCIA (contrato con config.js: columna 0).
  // Fallback defensivo: si `C` no estuviera disponible (cache vieja,
  // orden de carga roto), usar la columna 0 que ES la referencia.
  const REF = (C && typeof C.REF === 'number') ? C.REF : 0;
  if (!C) console.warn('[Store] C no disponible; usando REF=columna 0. Verifica que config.js cargue antes que core/store.js y que no haya caché vieja del SW.');

  const state = { rows: [], byRef: new Map(), rev: 0 };
  const listeners = {};

  function nRef(v) {
    return String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  }

  function subscribe(event, fn) {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event].add(fn);
    return function () { listeners[event].delete(fn); };
  }

  function notify(event, payload) {
    const set = listeners[event];
    if (!set) return;
    set.forEach(function (fn) {
      try { fn(payload || {}); }
      catch (e) { console.warn('[Store] listener error en "' + event + '":', e); }
    });
  }

  function rebuild() {
    state.byRef.clear();
    state.rows.forEach(function (r, i) {
      const k = nRef(r[REF]);
      if (k) state.byRef.set(k, i);
    });
  }

  function getRow(ref) {
    const i = state.byRef.get(nRef(ref));
    return i === undefined ? null : state.rows[i];
  }

  function getRowIndex(ref) {
    const i = state.byRef.get(nRef(ref));
    return i === undefined ? -1 : i;
  }

  function sameRow(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let j = 0; j < a.length; j++) {
      const x = String(a[j] === null || a[j] === undefined ? '' : a[j]).trim();
      const y = String(b[j] === null || b[j] === undefined ? '' : b[j]).trim();
      if (x !== y) return false;
    }
    return true;
  }

  // Diferencia entre el estado actual y unas filas nuevas (ya normalizadas).
  function diff(newRows) {
    const result = { modified: [], added: [], removed: [], any: false };
    const idx = new Map();
    (newRows || []).forEach(function (r) {
      const k = nRef(r[REF]);
      if (k && !idx.has(k)) idx.set(k, r);
    });
    idx.forEach(function (row, k) {
      const i = state.byRef.get(k);
      if (i === undefined) result.added.push(k);
      else if (!sameRow(state.rows[i], row)) result.modified.push(k);
    });
    state.rows.forEach(function (r) {
      const k = nRef(r[REF]);
      if (k && !idx.has(k)) result.removed.push(k);
    });
    result.any = !!(result.modified.length || result.added.length || result.removed.length);
    return result;
  }

  // Reemplaza el catálogo completo. Decide el evento:
  //   primera carga / manual (forceFull) → 'catalog.replaced'
  //   actualización silenciosa            → 'product.changed' / 'product.removed' (granular)
  function setCatalog(rows, opts) {
    const prev = state.rows;
    const d = diff(rows);
    state.rows = rows || [];
    state.rev++;
    rebuild();
    if (!d.any) { notify('catalog.same', {}); return false; }
    const firstLoad = !prev || prev.length === 0;
    if (firstLoad || (opts && opts.forceFull)) {
      notify('catalog.replaced', { count: state.rows.length });
    } else {
      if (d.modified.length || d.added.length) {
        notify('product.changed', { refs: d.modified.concat(d.added), added: d.added, modified: d.modified });
      }
      if (d.removed.length) notify('product.removed', { refs: d.removed });
    }
    return d;
  }

  function clear() { setCatalog([]); }

  window.App.Store = {
    subscribe: subscribe,
    notify: notify,
    setCatalog: setCatalog,
    clear: clear,
    diff: diff,
    getRow: getRow,
    getRowIndex: getRowIndex,
    get rows() { return state.rows; },
    get rev() { return state.rev; },
    get count() { return state.rows.length; }
  };
})(window, typeof C !== 'undefined' ? C : undefined);   // C: binding léxico global de config.js
