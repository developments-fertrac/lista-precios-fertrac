// ============================================================
// CATALOG — Datos, filtros, tabla, detalle y auto-refresh
// FASE 1 (MVC + Observer): el Modelo vive en App.Store. Esta
// capa es el controlador + vistas (tabla/detalle/filtros) que
// se suscriben a los eventos del Store.
// ============================================================

const Store = window.App.Store;
let filtered = [];

// ── MAPEO DE COLORES PARA CONDICIÓN ───────────────────────────────────────
const CONDITION_COLOR_MAP = [
  { match: 'MAGENTA',     bg: '#e7a3c9', text: '#222222' },
  { match: 'AGUA MARINA', bg: '#a5e8e6', text: '#222222' },
  { match: 'NUEVAS',      bg: '#ffc000', text: '#222222' },
  { match: 'PROMOCION',   bg: '#9fc5e8', text: '#222222' },
  { match: 'VERDE',       bg: '#a8d18d', text: '#222222' }
];

function normalizeCondition(val) {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function getConditionStyle(rawCondition) {
  const rawText = String(rawCondition || '').trim();
  const normalized = normalizeCondition(rawText);

  const found = CONDITION_COLOR_MAP.find(item => normalized.includes(item.match));

  if (found) {
    return {
      text: rawText || '—',
      bg: found.bg,
      textColor: found.text,
      labelColor: found.text === '#ffffff' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.65)'
    };
  }

  return {
    text: rawText || '—',
    bg: '#e0e0e0',
    textColor: '#555555',
    labelColor: '#777777'
  };
}

function hasCondition(rawCondition) {
  const normalized = normalizeCondition(rawCondition);
  if (!normalized) return false;
  if (normalized === 'NO TIENE' || normalized === 'NO APLICA' || normalized === 'N/A' || normalized === '-') return false;
  return CONDITION_COLOR_MAP.some(item => normalized.includes(item.match));
}

// ── SERVICE WORKER ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  if (navigator.serviceWorker.controller) {
    let _recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_recargando || !navigator.onLine) return;   // Fase 4: sin conexión no recargar
      _recargando = true;
      window.location.reload();
    });
  }

  navigator.serviceWorker.register('/lista-precios-fertrac/sw.js', { scope: '/lista-precios-fertrac/' })
    .then(reg => {
      console.log('SW registrado correctamente');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      setInterval(() => reg.update(), 30 * 60 * 1000);
    })
    .catch(err => console.log('SW error:', err));
}

// ── STORAGE ────────────────────────────────────────────────────────────────
function saveData(data) {
  try {
    localStorage.setItem('fertrac_data', JSON.stringify(data));
    localStorage.setItem('fertrac_updated', new Date().toLocaleString('es-CO'));
  } catch(e) { console.warn('Storage full', e); }
}
function loadData() {
  try { const d = localStorage.getItem('fertrac_data'); return d ? JSON.parse(d) : null; }
  catch(e) { return null; }
}

// ── CACHE DE FOTOS ─────────────────────────────────────────────────────────
// Cache adicional independiente del catálogo: precarga en localStorage el
// mapa {referencia → URL Drive} para mostrar fotos sin llamadas HTTP por
// imagen. No se mezcla con la sincronización de precios (no la bloquea).
const FOTOS_CACHE_DATA_KEY  = 'fertrac_fotos_urls';
const FOTOS_CACHE_EXP_KEY   = 'fertrac_fotos_expiry';
const FOTOS_CACHE_TTL_MS    = 60 * 60 * 1000;   // 1 hora vigencia del mapa

// Mapa en memoria: evita re-leer/re-parsear el JSON grande de localStorage
// en cada carga de imagen (es el mayor gasto absorbido por el cache).
let _fotosCacheMem = null;
let _fotosCacheExp  = 0;

function saveFotosCache(fotosMap) {
  _fotosCacheMem = fotosMap;
  _fotosCacheExp = Date.now() + FOTOS_CACHE_TTL_MS;
  try {
    localStorage.setItem(FOTOS_CACHE_DATA_KEY, JSON.stringify(fotosMap));
    localStorage.setItem(FOTOS_CACHE_EXP_KEY, String(_fotosCacheExp));
  } catch(e) { console.warn('Storage full (fotos)', e); }
}

function invalidateFotosCache() {
  _fotosCacheMem = null;
  _fotosCacheExp = 0;
  try { localStorage.removeItem(FOTOS_CACHE_DATA_KEY); localStorage.removeItem(FOTOS_CACHE_EXP_KEY); } catch(e) {}
}

function loadFotosCache() {
  if (_fotosCacheMem && Date.now() < _fotosCacheExp) return _fotosCacheMem;   // cache en memoria vigente
  try {
    const exp = parseInt(localStorage.getItem(FOTOS_CACHE_EXP_KEY) || '0', 10);
    if (Date.now() > exp) return null;                       // expirado
    const data = localStorage.getItem(FOTOS_CACHE_DATA_KEY);
    if (!data) return null;
    _fotosCacheMem = JSON.parse(data);                       // poblar memoria para próximas llamadas
    _fotosCacheExp = exp;
    return _fotosCacheMem;
  } catch(e) { return null; }
}

// Sincroniza el mapa de fotos en background. NO bloquea la carga del catálogo:
// se lanza sin await y se ignora cualquier fallo (solo refresca el TTL).
async function syncFotosCache() {
  if (!navigator.onLine) return;
  const exp = parseInt(localStorage.getItem(FOTOS_CACHE_EXP_KEY) || '0', 10);
  // Si el cache visible sigue vigente (memoria o storage) no volver a llamar a la API.
  if (Date.now() < exp) {
    loadFotosCache();                                        // poblar memoria desde storage
    return;
  }
  try {
    const res = await App.ApiClient.getFotos();
    if (res && res.ok && res.fotos) {
      saveFotosCache(res.fotos);
      // Fase 4: al disponer del mapa de fotos, repintar la tabla para
      // mostrar las miniaturas (no bloquea nada; es un render rápido).
      applyFilters();
    }
  } catch(e) {
    // 'temporalmente_ocupado' = una sync del backend sostiene el lock; es
    // transitorio y esperado (la sync corre cada 5 min). NO es un fallo de la
    // app: reintentamos en silencio y sin spam de consola.
    if (e && e.code === 'temporalmente_ocupado') {
      if (!window._fotosRetryScheduled) {
        window._fotosRetryScheduled = true;
        setTimeout(function () {
          window._fotosRetryScheduled = false;
          localStorage.removeItem(FOTOS_CACHE_EXP_KEY);   // fuerza re-intento
          syncFotosCache();
        }, 5 * 60 * 1000);
      }
      return;
    }
    console.warn('Cache de fotos no actualizado:', e);
    // Cualquier otro fallo: re-intentar una vez en 90 s. Mientras tanto las
    // miniaturas caen a col B (fallback).
    if (!window._fotosRetryScheduled) {
      window._fotosRetryScheduled = true;
      setTimeout(function () {
        window._fotosRetryScheduled = false;
        localStorage.removeItem(FOTOS_CACHE_EXP_KEY);   // fuerza re-intento
        syncFotosCache();
      }, 90000);
    }
  }
}

// ── INIT ───────────────────────────────────────────────────────────────────
function initApp() {
  App.Session.start();   // FASE 1: rastreo de actividad (login/heartbeat)

  const saved = loadData();
  if (saved && saved.length > 0) {
    Store.setCatalog(saved);   // emite 'catalog.replaced' → vistas se (re)pintan solas
    const ts = localStorage.getItem('fertrac_updated');
    document.getElementById('sync-status').textContent = ts ? 'Última sincronización: ' + ts : '';
  } else {
    document.getElementById('table-wrapper').innerHTML =
      '<div class="empty-state">Conéctate a internet para cargar los datos por primera vez</div>';
  }

  if (navigator.onLine) {
    syncData();
    syncFotosCache();   // en background, no bloquea la sincronización
  } else {
    showOfflineBanner();
  }

  window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.remove('visible');
    syncData();
    syncFotosCache();
  });
  window.addEventListener('offline', () => showOfflineBanner());
};

function showOfflineBanner() {
  const b = document.getElementById('offline-banner');
  const ts = localStorage.getItem('fertrac_updated');
  b.textContent = ts ? '📵 Sin conexión — datos del ' + ts : '📵 Sin conexión — mostrando datos guardados';
  b.classList.add('visible');
  document.getElementById('sync-status').textContent = '';
}

// ── SYNC ───────────────────────────────────────────────────────────────────
async function syncData() {
  if (!navigator.onLine) { showOfflineBanner(); return; }
  const status = document.getElementById('sync-status');
  const btn = document.getElementById('sync-btn');
  status.textContent = '🔄 Sincronizando...';
  btn.textContent = '🔄 Cargando...';
  btn.disabled = true;

  if (Store.count === 0) {
    document.getElementById('table-wrapper').innerHTML =
      '<div class="loading"><div class="spinner"></div>Cargando datos...</div>';
  }

  try {
    // FASE 2: token-first con key-fallback (antes era un fetch directo con ?key=)
    const json = await App.ApiClient.getData();

    const fresh = json.data.slice(1).map(row =>
      row.map(cell => cell === null || cell === undefined ? '' : String(cell).trim())
    );

    // FASE 1: el Store emite 'catalog.replaced' y las vistas se (re)pintan.
    Store.setCatalog(fresh, { forceFull: true });
    saveData(fresh);
    const ts = localStorage.getItem('fertrac_updated');
    status.textContent = '✅ Actualizado: ' + ts;
    btn.textContent = '🔄 Sincronizar';
    btn.disabled = false;
  } catch(e) {
    status.textContent = '⚠️ Error al sincronizar';
    btn.textContent = '🔄 Sincronizar';
    btn.disabled = false;
    const saved = loadData();
    if (saved && saved.length > 0) Store.setCatalog(saved);
    else document.getElementById('table-wrapper').innerHTML =
      '<div class="empty-state">No hay datos guardados. Conéctate a internet para sincronizar.</div>';
  }
}

// ── FILTERS ────────────────────────────────────────────────────────────────
const SIN_CLASIF = 'Sin clasificar';
const FILTER_FIELDS = [
  { id: 'f-linea',        col: C.LINEA,        label: 'Línea' },
  { id: 'f-marca',        col: C.MARCA,        label: 'Marca' },
  { id: 'f-categoria',    col: C.CATEGORIA,    label: 'Categoría',        clasif: true },
  { id: 'f-subcategoria', col: C.SUBCATEGORIA, label: 'Subcategoría',     clasif: true },
  { id: 'f-tipo',         col: C.TIPO,         label: 'Tipo de producto', clasif: true },
  { id: 'f-condicion',    col: C.CONDICION,    label: 'Condición', colored: true },
];

// En campos de clasificación, '0' o vacío se muestra/filtra como "Sin clasificar".
function fval(raw, field) {
  if (field && field.clasif) {
    const s = String(raw || '').trim();
    return (!s || s === '0') ? SIN_CLASIF : s;
  }
  return raw;
}

// Valores distintos de un campo (independientes de los otros filtros). "Sin clasificar" al final.
function fieldValues(field, rows) {
  const arr = [...new Set(rows.map(r => fval(r[field.col], field)).filter(Boolean))];
  const i = arr.indexOf(SIN_CLASIF);
  if (i >= 0) { arr.splice(i, 1); arr.sort(); arr.push(SIN_CLASIF); }
  else arr.sort();
  return arr;
}

const SEL = {};
FILTER_FIELDS.forEach(f => { SEL[f.id] = new Set(); });
let builtOnce = false;

function buildFilters() {
  if (!builtOnce) {
    builtOnce = true;
    const grid = document.getElementById('filters-grid');
    if (!grid) return;
    grid.innerHTML = '';
    FILTER_FIELDS.forEach(function(f) {
      const wrap = document.createElement('div');
      wrap.className = 'ms-wrap';
      wrap.id = 'wrap-' + f.id;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ms-btn';
      btn.id = 'btn-' + f.id;
      btn.onclick = (function(id){ return function(){ msToggle(id); }; })(f.id);
      const lbl = document.createElement('span');
      lbl.className = 'ms-label';
      lbl.id = 'lbl-' + f.id;
      lbl.textContent = f.label;
      const arrow = document.createElement('span');
      arrow.className = 'ms-arrow';
      arrow.textContent = '▼';
      btn.appendChild(lbl);
      btn.appendChild(arrow);

      const dd = document.createElement('div');
      dd.className = 'ms-dropdown';
      dd.id = 'dd-' + f.id;

      const srch = document.createElement('input');
      srch.className = 'ms-search';
      srch.type = 'text';
      srch.placeholder = '🔍 Buscar...';
      srch.oninput = (function(id){ return function(){ msSearch(id, this.value); }; })(f.id);

      const opts = document.createElement('div');
      opts.className = 'ms-options';
      opts.id = 'opts-' + f.id;

      const footer = document.createElement('div');
      footer.className = 'ms-footer';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'ms-clear';
      clearBtn.textContent = '✕ Limpiar';
      clearBtn.onclick = (function(id){ return function(){ msClear(id); }; })(f.id);
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'ms-ok';
      okBtn.textContent = 'OK';
      okBtn.onclick = (function(id){ return function(){ msClose(id); }; })(f.id);
      footer.appendChild(clearBtn);
      footer.appendChild(okBtn);

      dd.appendChild(srch);
      dd.appendChild(opts);
      dd.appendChild(footer);
      wrap.appendChild(btn);
      wrap.appendChild(dd);
      grid.appendChild(wrap);
    });

    document.addEventListener('click', function(e) {
      FILTER_FIELDS.forEach(function(f) {
        const wrap = document.getElementById('wrap-' + f.id);
        if (wrap && !wrap.contains(e.target)) {
          const dd = document.getElementById('dd-' + f.id);
          if (dd) dd.classList.remove('open');
        }
      });
    });
  }
  msRefresh();
}

function msRefresh(skipFid = null) {
  if (Store.count === 0) return;
  const q = document.getElementById('search-input').value.toLowerCase();

  FILTER_FIELDS.forEach(target => {
    // CASCADA: las opciones de cada filtro salen del subconjunto que cumple
    // el buscador + los OTROS filtros activos.
    const subset = Store.rows.filter(r => {
      if (q && !(r[C.REF]+' '+r[C.PRODUCTO]+' '+r[C.MARCA]+' '+r[C.ALTERNOS]).toLowerCase().includes(q)) return false;
      for (const f of FILTER_FIELDS) {
        if (f.id === target.id) continue;
        if (SEL[f.id].size > 0 && !SEL[f.id].has(fval(r[f.col], f))) return false;
      }
      return true;
    });

    const vals = fieldValues(target, subset);

    const searchEl = document.querySelector('#dd-' + target.id + ' .ms-search');
    const currentSearch = searchEl ? searchEl.value : '';

    if (skipFid && target.id === skipFid) {
      msUpdateLabel(target.id, target.label);
      return;
    }

    msRenderOpts(target.id, vals, currentSearch);
    msUpdateLabel(target.id, target.label);
  });
}

// PAGINACIÓN: cada lista desplegada se renderiza por lotes de MS_PAGE
// (append incremental, nunca se vuelve a construir la lista completa).
const MS_PAGE = 50;

function msRenderOpts(fid, vals, search) {
  const c = document.getElementById('opts-' + fid);
  if (!c) return;
  const scrollTop = c.scrollTop;
  const shown = search ? vals.filter(function(v){ return v.toLowerCase().includes(search.toLowerCase()); }) : vals;
  c._shown = shown;
  c._field = FILTER_FIELDS.find(f => f.id === fid);
  c._count = 0;
  c.innerHTML = '';
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'ms-empty';
    empty.textContent = 'Sin resultados';
    c.appendChild(empty);
    return;
  }
  msAppendPage(c, fid, MS_PAGE);
  msAppendMoreBtn(fid);
  c.scrollTop = scrollTop;
}

function msAppendPage(c, fid, howMany) {
  const shown = c._shown;
  const field = c._field;
  const from = c._count;
  const to = Math.min(from + howMany, shown.length);
  for (let i = from; i < to; i++) msAppendOption(c, shown[i], fid, field);
  c._count = to;
}

function msAppendOption(c, v, fid, field) {
  const chk = SEL[fid].has(v);
  const lbl = document.createElement('label');
  lbl.className = 'ms-option' + (chk ? ' checked' : '');
  if (field && field.colored) {
    const condStyle = getConditionStyle(v);
    lbl.style.borderLeft = '4px solid ' + condStyle.bg;
    lbl.style.paddingLeft = '10px';
    if (chk) {
      lbl.style.background = condStyle.bg + '33';
    }
    const dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + condStyle.bg + ';flex-shrink:0;margin-right:2px;border:1px solid rgba(0,0,0,0.15)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = chk;
    cb.onchange = (function(id, val){ return function(){ msToggleOpt(id, val, this.checked); }; })(fid, v);
    lbl.appendChild(cb);
    lbl.appendChild(dot);
    lbl.appendChild(document.createTextNode(' ' + v));
  } else {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = chk;
    cb.onchange = (function(id, val){ return function(){ msToggleOpt(id, val, this.checked); }; })(fid, v);
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(v));
  }
  c.appendChild(lbl);
}

function msAppendMoreBtn(fid) {
  const c = document.getElementById('opts-' + fid);
  if (!c || !c._shown) return;
  const remaining = c._shown.length - c._count;
  if (remaining <= 0) return;
  const el = document.createElement('div');
  el.className = 'ms-more';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Mostrar más (' + Math.min(remaining, MS_PAGE) + ')';
  btn.onclick = function(){ msLoadMore(fid); };
  el.appendChild(btn);
  c.appendChild(el);
}

function msLoadMore(fid) {
  const c = document.getElementById('opts-' + fid);
  if (!c || !c._shown) return;
  const scrollTop = c.scrollTop;
  const moreEl = c.querySelector('.ms-more');
  if (moreEl) moreEl.remove();
  msAppendPage(c, fid, MS_PAGE);
  msAppendMoreBtn(fid);
  c.scrollTop = scrollTop;
}

function msSearch(fid, search) {
  const field = FILTER_FIELDS.find(f => f.id === fid);
  const q = document.getElementById('search-input').value.toLowerCase();
  const subset = Store.rows.filter(r => {
    if (q && !(r[C.REF]+' '+r[C.PRODUCTO]+' '+r[C.MARCA]+' '+r[C.ALTERNOS]).toLowerCase().includes(q)) return false;
    for (const f of FILTER_FIELDS) {
      if (f.id === fid) continue;
      if (SEL[f.id].size > 0 && !SEL[f.id].has(fval(r[f.col], f))) return false;
    }
    return true;
  });
  const vals = fieldValues(field, subset);
  msRenderOpts(fid, vals, search);
}

function msToggleOpt(fid, val, checked) {
  const pageY = window.scrollY;
  const optsEl = document.getElementById('opts-' + fid);
  const optsScroll = optsEl ? optsEl.scrollTop : 0;

  if (checked) SEL[fid].add(val);
  else SEL[fid].delete(val);

  const field = FILTER_FIELDS.find(f => f.id === fid);
  msUpdateLabel(fid, field.label);

  applyFilters({ keepWindowScroll: true, skipRefreshFor: fid });

  requestAnimationFrame(() => {
    window.scrollTo({ top: pageY, behavior: 'auto' });

    const dd = document.getElementById('dd-' + fid);
    if (dd) dd.classList.add('open');

    const opts = document.getElementById('opts-' + fid);
    if (opts) opts.scrollTop = optsScroll;

    const searchInput = document.querySelector('#dd-' + fid + ' .ms-search');
    if (searchInput) {
      try {
        searchInput.focus({ preventScroll: true });
      } catch (e) {
        searchInput.focus();
      }
    }
  });
}

function msUpdateLabel(fid, defaultLabel) {
  const btn = document.getElementById('btn-' + fid);
  const lbl = document.getElementById('lbl-' + fid);
  if (!btn || !lbl) return;
  const n = SEL[fid].size;
  lbl.textContent = n > 0 ? defaultLabel + ' (' + n + ')' : defaultLabel;
  btn.classList.toggle('active', n > 0);
}

function msToggle(fid) {
  const dd = document.getElementById('dd-' + fid);
  const open = dd.classList.contains('open');
  FILTER_FIELDS.forEach(f => { const d = document.getElementById('dd-' + f.id); if (d) d.classList.remove('open'); });
  if (!open) {
    dd.classList.add('open');
    const s = dd.querySelector('.ms-search');
    s.value = ''; msSearch(fid, ''); s.focus();
  }
}

function msClose(fid) {
  const dd = document.getElementById('dd-' + fid);
  if (dd) dd.classList.remove('open');
}

function msClear(fid) {
  const pageY = window.scrollY;
  const optsEl = document.getElementById('opts-' + fid);
  const optsScroll = optsEl ? optsEl.scrollTop : 0;

  SEL[fid].clear();
  const field = FILTER_FIELDS.find(f => f.id === fid);
  msUpdateLabel(fid, field.label);
  msSearch(fid, '');

  applyFilters({ keepWindowScroll: true, skipRefreshFor: fid });

  requestAnimationFrame(() => {
    window.scrollTo({ top: pageY, behavior: 'auto' });

    const dd = document.getElementById('dd-' + fid);
    if (dd) dd.classList.add('open');

    const opts = document.getElementById('opts-' + fid);
    if (opts) opts.scrollTop = optsScroll;
  });
}


function applyFilters(options = {}) {
  const { keepWindowScroll = false, skipRefreshFor = null } = options;
  const savedWindowY = keepWindowScroll ? window.scrollY : null;

  const q = document.getElementById('search-input').value.toLowerCase();
  filtered = Store.rows.filter(r => {
    if (q && !(r[C.REF]+' '+r[C.PRODUCTO]+' '+r[C.MARCA]+' '+r[C.ALTERNOS]).toLowerCase().includes(q)) return false;
    for (const f of FILTER_FIELDS) {
      if (SEL[f.id].size > 0 && !SEL[f.id].has(fval(r[f.col], f))) return false;
    }
    return true;
  });

  renderTable();

  document.getElementById('results-meta').innerHTML =
    Store.count > 0
      ? 'Mostrando <strong>' + filtered.length + '</strong> de <strong>' + Store.count + '</strong> productos'
      : '';

  msRefresh(skipRefreshFor);

  if (keepWindowScroll && savedWindowY !== null) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedWindowY, behavior: 'auto' });
    });
  }
}

function clearAll() {
  document.getElementById('search-input').value = '';
  FILTER_FIELDS.forEach(f => { SEL[f.id].clear(); msUpdateLabel(f.id, f.label); });
  closeDetail();
  applyFilters();
}

// ── TABLE ──────────────────────────────────────────────────────────────────
// FASE 1: la tabla usa `data-ref` (clave estable) y delegación de clics
// (ya no depende de índices que se rompen con actualizaciones parciales).

function nRefUp(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }

// Thumbnail de Drive (miniatura pública, descarga directa sin Apps Script).
function thumbDriveURL(fileId, sz) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=' + (sz || 'w200');
}

const TableView = {
  // Fase 4: miniatura del producto en la tabla. Resolución en cascada:
  //   1) mapa de fotos cacheado (?fotos=1) → URL de Drive guardada en CACHE;
  //   2) fallback a la col B de Hoja2 (r[C.FOTO]) → misma fuente que el detalle.
  // Sin URL conocida → placeholder silencioso. Cero llamadas HTTP al API.
  thumbHTML(r, fotos) {
    const ref = String(r[C.REF] || '').trim().toUpperCase();
    let url = '';
    if (fotos) {
      const dv = fotos[ref];
      if (dv) {
        const id = extractDriveId(dv);
        url = id ? thumbDriveURL(id, 'w200') : dv;
      }
    }
    if (!url) {
      const id = extractDriveId(r[C.FOTO]);
      if (id) url = thumbDriveURL(id, 'w200');
    }
    return '<td class="td-img"><div class="cell-thumb' + (url ? '' : ' empty') + '">' +
      (url
        ? '<img src="' + url + '" loading="lazy" referrerpolicy="no-referrer" class="row-img" alt="" onerror="this.parentNode.classList.add(\'empty\');this.remove();">'
        : '') +
      '</div></td>';
  },
  cellsHTML(r, fotos) {
    const inv = parseFloat(r[C.INV]) || 0;
    const invCls = inv > 10 ? 'ok' : inv > 0 ? 'low' : 'none';
    return this.thumbHTML(r, fotos) +
      '<td class="td-ref">' + (r[C.REF]||'—') + '</td>' +
      '<td class="td-marca"><span class="tag">' + (r[C.MARCA]||'—') + '</span></td>' +
      '<td class="td-producto">' + (r[C.PRODUCTO]||'—') + '</td>' +
      '<td class="td-inv"><span class="inv-pill ' + invCls + '">' + inv + '</span></td>' +
      '<td class="td-precio">' + formatPrice(r[C.PRECIO_BRUTO]) + '</td>';
  },
  rowStyle(r) {
    const condRaw = r[C.CONDICION];
    if (!hasCondition(condRaw)) return '';
    const c = getConditionStyle(condRaw);
    return 'background:' + c.bg + '33; border-left-color:' + c.bg + ';';
  },
  // Actualiza en sitio SOLO las filas cuyo ref cambió (Observer granular).
  patch(refs) {
    const tbody = document.querySelector('#table-wrapper tbody');
    if (!tbody) return;
    const fotos = loadFotosCache() || null;
    for (let i = 0; i < tbody.rows.length; i++) {
      const tr = tbody.rows[i];
      const ref = tr.getAttribute('data-ref');
      if (ref && refs.indexOf(ref) >= 0) {
        const r = Store.getRow(ref);
        if (r) { tr.style.cssText = this.rowStyle(r); tr.innerHTML = this.cellsHTML(r, fotos); }
      }
    }
    const meta = document.getElementById('results-meta');
    if (meta) meta.innerHTML = Store.count > 0
      ? 'Mostrando <strong>' + filtered.length + '</strong> de <strong>' + Store.count + '</strong> productos'
      : '';
  }
};

function renderTable() {
  const wrapper = document.getElementById('table-wrapper');
  if (filtered.length === 0) {
    wrapper.innerHTML = '<div class="empty-state">No se encontraron productos</div>';
    return;
  }
  const show = filtered.slice(0, 200);
  const fotos = loadFotosCache() || null;
  const rows = show.map(r => {
    const ref = nRefUp(r[C.REF]);
    return '<tr data-ref="' + ref + '" style="' + TableView.rowStyle(r) + '">' +
      TableView.cellsHTML(r, fotos) +
      '</tr>';
  }).join('');
  wrapper.innerHTML =
    '<table><thead><tr>' +
      '<th style="width:64px">Foto</th>' +
      '<th>Referencia</th>' +
      '<th>Marca</th>' +
      '<th>Producto <img src="https://raw.githubusercontent.com/developments-fertrac/lista-precios-fertrac/main/logo2.png" alt="Fertrac" class="th-logo" onerror="this.style.display=\'none\'"></th>' +
      '<th style="text-align:center">Inv.</th>' +
      '<th style="text-align:right">Precio Bruto</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    (filtered.length > 200 ? '<div style="text-align:center;padding:10px;font-size:0.8rem;color:#888">Mostrando 200 de ' + filtered.length + ' resultados. Refina tu búsqueda.</div>' : '');
}

// Delegación de clics: fila → showDetail(ref) sin depender de índices.
(function () {
  const wrapper = document.getElementById('table-wrapper');
  if (!wrapper) return;
  wrapper.addEventListener('click', function (e) {
    const tr = e.target && e.target.closest ? e.target.closest('tr[data-ref]') : null;
    if (tr) showDetail(tr.getAttribute('data-ref'));
  });
})();

// ── DETAIL ─────────────────────────────────────────────────────────────────
function extractDriveId(url) {
  if (!url) return null;
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const match2 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  return null;
}

async function loadImage(fileId, imgElement, referencia) {
  // Fase 4: si tenemos el mapa de fotos cacheado, resolver la URL de Drive
  // localmente y usarla directo → evita una llamada HTTP a la API por imagen.
  // IMPORTANTE: siempre derivar el thumbnail (sz=w800) del ID, no usar la URL
  // completa de Drive (view), que es mucho más lenta de cargar.
  const fotosCache = loadFotosCache();
  if (fotosCache && referencia) {
    const driveUrl = fotosCache[String(referencia).trim().toUpperCase()];
    if (driveUrl && imgElement) {
      const cachedId = extractDriveId(driveUrl);
      if (cachedId) {
        imgElement.src = thumbDriveURL(cachedId, 'w800');
      } else {
        imgElement.src = driveUrl;
      }
      return;
    }
  }

  try {
    // FASE 3: El backend devuelve { ok, kind, url } con el thumbnail público
    // de Drive (no base64). Se usa directamente en <img src> → carga rápida
    // sin pasar por el proxy binario de Apps Script.
    const res = await App.ApiClient.getImg(fileId);
    if (res && res.kind === 'thumbnail' && res.url) {
      imgElement.src = res.url;       // thumbnail de Google, descarga directa
    } else if (res && res.kind === 'data' && res.url && res.url.startsWith('data:')) {
      imgElement.src = res.url;       // compat: formato viejo base64
    } else {
      imgElement.style.display = 'none';
    }
  } catch(e) {
    imgElement.style.display = 'none';
  }
}

// FASE 1: el detalle es una vista Observable; sync() actualiza PRECIOS/INV
// en sitio sin recargar la imagen ni saltar el scroll.
const DetailView = {
  openRef: null,
  _foto: null,
  open(ref, r) {
    this.openRef = ref;
    this._foto = r[C.FOTO];
  },
  sync(refs) {
    if (!this.openRef || refs.indexOf(this.openRef) < 0) return;
    const r = Store.getRow(this.openRef);
    if (!r) { closeDetail(); return; }
    const body = document.getElementById('detail-body');
    if (!body) return;

    const cards = body.querySelector('.price-cards');
    if (cards) {
      cards.innerHTML =
        pcard('Precio Bruto', r[C.PRECIO_BRUTO], '') +
        pcardClass('Neto -5%', r[C.NETO_5], 'neto5') +
        (r[C.PRECIO_PROMO]
          ? '<div class="price-card promo"><label>🔥 Precio Promo</label><div class="amount" style="font-size:0.78rem;white-space:normal;line-height:1.3;">' + r[C.PRECIO_PROMO] + '</div></div>'
          : pcardClass('Neto -8%', r[C.NETO_8], 'neto8')) +
        (r[C.PRECIO_PROMO] ? pcardClass('Neto -8%', r[C.NETO_8], 'neto8') : '');
    }

    const cond = getConditionStyle(r[C.CONDICION]);
    const condCard = body.querySelector('.info-card.condicion');
    if (condCard) {
      condCard.style.background = cond.bg;
      const lbl = condCard.querySelector('label');
      if (lbl) lbl.style.color = cond.labelColor;
      const val = condCard.querySelector('.value');
      if (val) { val.style.color = cond.textColor; val.textContent = cond.text; }
    }

    const inv = parseFloat(r[C.INV]) || 0;
    const invBg = inv > 10 ? '#d4edda' : inv > 0 ? '#fff3cd' : '#f8d7da';
    const invFg = inv > 10 ? '#155724' : inv > 0 ? '#856404' : '#721c24';
    const invText = inv > 10 ? inv + ' unidades' : inv > 0 ? inv + ' unidades (bajo)' : 'Sin stock';
    const invCards = body.querySelectorAll('.info-card');
    for (let i = 0; i < invCards.length; i++) {
      const c = invCards[i];
      if (c.classList.contains('condicion')) continue;
      const lbl = c.querySelector('label');
      if (!lbl || lbl.textContent !== 'Inventario') continue;
      c.style.background = invBg;
      const val = c.querySelector('.value');
      if (val) { val.style.color = invFg; val.textContent = invText; }
    }

    const rows = body.querySelectorAll('.detail-row');
    const map = {
      'Unid. mín. de venta': r[C.UND_MIN],
      'Unid. máx. de venta': r[C.UND_MAX],
      'Escala (≥ unidades)': r[C.UND_ESCALA],
      'Und. RM': r[C.UND_RM],
      'Und. RMC': r[C.UND_RMC],
      'Promo finaliza en': r[C.PROMO_FIN]
    };
    for (let i = 0; i < rows.length; i++) {
      const lbl = rows[i].querySelector('label');
      const span = rows[i].querySelector('span');
      if (!lbl || !span || !(lbl.textContent in map)) continue;
      span.textContent = map[lbl.textContent] || '—';
      span.style.color = lbl.textContent === 'Promo finaliza en' ? '#e65100' : '';
    }

    // La URL de la foto cambió → recargar SOLO la imagen (el resto ya está fresco).
    if (this._foto !== r[C.FOTO]) {
      this._foto = r[C.FOTO];
      const fileId = extractDriveId(r[C.FOTO]);
      const imgEl = document.getElementById('detail-img');
      if (fileId && navigator.onLine && imgEl) loadImage(fileId, imgEl, r[C.REF]);
    }
  }
};

function showDetail(ref, keepScroll = false) {
  const refKey = nRefUp(ref);
  const r = Store.getRow(refKey);
  if (!r) return;
  DetailView.open(refKey, r);

  document.querySelectorAll('#table-wrapper tbody tr').forEach(tr => tr.classList.remove('selected'));
  const trs = document.querySelectorAll('#table-wrapper tbody tr');
  for (let i = 0; i < trs.length; i++) {
    if (trs[i].getAttribute('data-ref') === refKey) { trs[i].classList.add('selected'); break; }
  }

  const inv = parseFloat(r[C.INV]) || 0;
  const invClass = inv > 10 ? 'inv-ok' : inv > 0 ? 'inv-low' : 'inv-none';
  const invText = inv > 10 ? inv + ' unidades' : inv > 0 ? inv + ' unidades (bajo)' : 'Sin stock';

  const cond = getConditionStyle(r[C.CONDICION]);

  const fileId = extractDriveId(r[C.FOTO]);
  const imgHtml = fileId
    ? '<img id="detail-img" class="product-image" alt="Foto producto" onclick="openModal(this)" style="cursor:zoom-in" fetchpriority="high">'
    : '<div class="no-image">Sin imagen</div>';

  document.getElementById('detail-title').textContent = r[C.REF] || 'Detalle';
  document.getElementById('detail-body').innerHTML =
    '<div class="detail-grid">' +
      '<div>' +
        imgHtml +
        '<div class="detail-section">' +
          '<h3>🛠 Información técnica</h3>' +
          drow('Referencia', r[C.REF]) +
          drow('Producto', r[C.PRODUCTO]) +
          drow('Marca', r[C.MARCA]) +
          drow('Línea', r[C.LINEA]) +
          drow('Aplicación', r[C.APLICACION]) +
          drow('Refs. alternas / intercambio', r[C.ALTERNOS]) +
        '</div>' +
      '</div>' +
      '<div>' +
        '<div class="detail-section">' +
          '<h3>💰 Precios <img src="https://raw.githubusercontent.com/developments-fertrac/lista-precios-fertrac/main/logo3.png" alt="Fertrac" class="h3-logo" onerror="this.style.display=\'none\'"></h3>' +
          '<div class="price-cards">' +
            pcard('Precio Bruto', r[C.PRECIO_BRUTO], '') +
            pcardClass('Neto -5%', r[C.NETO_5], 'neto5') +
            (r[C.PRECIO_PROMO] ? '<div class="price-card promo"><label>🔥 Precio Promo</label><div class="amount" style="font-size:0.78rem;white-space:normal;line-height:1.3;">' + r[C.PRECIO_PROMO] + '</div></div>' : pcardClass('Neto -8%', r[C.NETO_8], 'neto8')) +
            (r[C.PRECIO_PROMO] ? pcardClass('Neto -8%', r[C.NETO_8], 'neto8') : '') +
          '</div>' +
        '</div>' +
        '<div class="detail-section" style="margin-top:16px">' +
          '<h3>📦 Información comercial</h3>' +
          '<div class="info-cards">' +
            '<div class="info-card condicion" style="background:' + cond.bg + ';">' +
              '<label style="color:' + cond.labelColor + ';">Condición</label>' +
              '<div class="value" style="color:' + cond.textColor + '; white-space:normal; line-height:1.2;">' + cond.text + '</div>' +
            '</div>' +
            '<div class="info-card" style="background:' + (inv > 10 ? '#d4edda' : inv > 0 ? '#fff3cd' : '#f8d7da') + '"><label>Inventario</label><div class="value" style="color:' + (inv > 10 ? '#155724' : inv > 0 ? '#856404' : '#721c24') + '">' + invText + '</div></div>' +
          '</div>' +
          drow('Unid. mín. de venta', r[C.UND_MIN]) +
          drow('Unid. máx. de venta', r[C.UND_MAX]) +
          drow('Escala (≥ unidades)', r[C.UND_ESCALA]) +
          drow('Und. RM', r[C.UND_RM]) +
          drow('Und. RMC', r[C.UND_RMC]) +
          (r[C.PROMO_FIN] ? '<div class="detail-row"><label>Promo finaliza en</label><span style="color:#e65100;font-weight:700">' + r[C.PROMO_FIN] + '</span></div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';

  const panel = document.getElementById('detail-panel');
  panel.classList.add('visible');
  if (!keepScroll) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (fileId && navigator.onLine) {
    const imgEl = document.getElementById('detail-img');
    if (imgEl) loadImage(fileId, imgEl, r[C.REF]);
  }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('visible');
  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('selected'));
}

function drow(label, val) {
  return '<div class="detail-row"><label>' + label + '</label><span>' + (val||'—') + '</span></div>';
}
function pcard(label, val, isPromo) {
  const n = parseFloat(String(val||'').replace(/[^0-9.]/g, ''));
  const isPrecoBruto = label === 'Precio Bruto';
  const isInvalidPrice = isPrecoBruto && val && isNaN(n);
  const extraStyle = isInvalidPrice ? 'background:#fde8e8;border:2px solid #e53935;' : '';
  const amountStyle = isInvalidPrice ? 'color:#c62828;' : '';
  return '<div class="price-card' + (isPromo?' promo':'') + '" style="' + extraStyle + '"><label>' + label + '</label><div class="amount" style="' + amountStyle + '">' + formatPrice(val) + (isInvalidPrice ? ' ⚠️' : '') + '</div></div>';
}
function pcardClass(label, val, cls) {
  return '<div class="price-card ' + cls + '"><label>' + label + '</label><div class="amount">' + formatPrice(val) + '</div></div>';
}
function openModal(imgEl) {
  const modal = document.getElementById('img-modal');
  const src = imgEl.src;
  document.getElementById('img-modal-src').src = src;
  const dlBtn = document.getElementById('img-download-btn');
  dlBtn.href = src;
  const titleEl = document.getElementById('detail-title');
  const fname = (titleEl ? titleEl.textContent.trim().replace(/[^a-zA-Z0-9_-]/g,'_') : 'producto') + '.jpg';
  dlBtn.setAttribute('download', fname);
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('img-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function formatPrice(val) {
  if (!val) return '—';
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return val;
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function goTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function checkIosInstallBanner() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const dismissed = localStorage.getItem('ios_banner_dismissed');
  if (isIos && !isInStandaloneMode && !dismissed) {
    document.getElementById('ios-install-banner').classList.add('visible');
  }
}

function dismissIosBanner() {
  document.getElementById('ios-install-banner').classList.remove('visible');
  localStorage.setItem('ios_banner_dismissed', '1');
}

// Show/hide go-top button based on scroll
window.addEventListener('scroll', () => {
  const btn = document.getElementById('go-top-btn');
  if (window.scrollY > 300) btn.classList.add('visible');
  else btn.classList.remove('visible');
});

// ── REGISTRO DE BÚSQUEDAS CON DEBOUNCE ─────────────────────────────────────
var _searchTimer = null;
document.getElementById('search-input').addEventListener('input', function() {
  applyFilters();
  clearTimeout(_searchTimer);
  var val = this.value;
  _searchTimer = setTimeout(function() {
    logSearchQuery(val);
  }, 1000);
});
// ════════════════════════════════════════════════════════════════════════
// AUTO-REFRESH SILENCIOSO — actualiza datos sin que el asesor recargue
// ════════════════════════════════════════════════════════════════════════
const AUTO_REFRESH_MS = 2 * 60 * 1000; // cada 10 minutos (ajustable)

function dataHash(data) {
  let h = 0;
  const s = JSON.stringify(data);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h + ':' + s.length;
}

async function autoRefresh() {
  if (!navigator.onLine) return;                       // sin conexión → no hacer nada
  if (document.visibilityState !== 'visible') return;  // app en segundo plano → no gastar cuota
  if (Store.count === 0) return;                       // aún no hay datos base

  try {
    // FASE 3: delta incremental (solo filas modificadas desde el último
    // `since`). La primera vez (sin `since`) el backend responde completo.
    const since = localStorage.getItem('fertrac_delta_since') || '';
    const json = since
      ? await App.ApiClient.getDataDelta(since)
      : await App.ApiClient.getData();

    // ── Delta: fusionar filas en el Store (patch granular sin re-render) ──
    if (json && json.delta) {
      if (!json.rows) return;
      const fresh = json.rows.map(row =>
        row.map(cell => cell === null || cell === undefined ? '' : String(cell).trim())
      );
      const changed = Store.applyDelta(fresh, json.refs);
      localStorage.setItem('fertrac_delta_since', json.since || '');
      if (changed) {
        saveData(Store.rows);
        const status = document.getElementById('sync-status');
        if (status) status.textContent = '✅ Actualizado: ' + localStorage.getItem('fertrac_updated');
      }
      return;
    }

    // ── Full (primera vez o respuesta no-delta): flujo anterior con hash ──
    if (!json || !json.data) return;
    const fresh = json.data.slice(1).map(row =>
      row.map(cell => cell === null || cell === undefined ? '' : String(cell).trim())
    );

    // FASE 3: anclar el `since` local a este momento para que el siguiente
    // refresh ya use delta (evita reenviar todo el catálogo en cada ciclo).
    localStorage.setItem('fertrac_delta_since', new Date().toISOString());

    // Solo actualizar si REALMENTE cambió algo
    if (dataHash(fresh) === dataHash(Store.rows)) return;

    // FASE 1: el Store compara contra lo actual y emite eventos GRANULARES:
    //   'product.changed' (precio/stock/foto) → patch de filas + detalle en sitio
    //   'product.removed'                    → re-render completo
    Store.setCatalog(fresh);
    saveData(fresh);

    const status = document.getElementById('sync-status');
    if (status) status.textContent = '✅ Actualizado: ' + localStorage.getItem('fertrac_updated');
  } catch (e) {
    console.log('Auto-refresh falló (se conservan los datos previos):', e);
  }
}

// Refresco periódico de respaldo
setInterval(autoRefresh, AUTO_REFRESH_MS);

// Refresco al volver a primer plano (clave para el precio al cotizar)
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') autoRefresh();
});

// ════════════════════════════════════════════════════════════════════════
// FASE 1 — MVC: las vistas se suscriben al Store (Observer)
// El controlador (sync/autoRefresh) solo toca el Modelo; las vistas
// reaccionan a los eventos. La tabla actualiza por fila, no por re-render.
// ════════════════════════════════════════════════════════════════════════
Store.subscribe('catalog.replaced', function () {
  buildFilters();
  applyFilters();
});

Store.subscribe('product.changed', function (payload) {
  const dropdownOpen = document.querySelector('.ms-dropdown.open');
  if (payload.added && payload.added.length && !dropdownOpen) {
    applyFilters();               // alta de productos → re-render estructural
  } else {
    TableView.patch(payload.refs);      // solo las filas modificadas
    DetailView.sync(payload.refs);      // solo el detalle si está abierto y afectado
  }
});

Store.subscribe('product.removed', function (payload) {
  if (DetailView.openRef && payload.refs.indexOf(DetailView.openRef) >= 0) closeDetail();
  if (!document.querySelector('.ms-dropdown.open')) applyFilters();
  else TableView.patch(payload.refs);
});

// ── Rastreo de actividad (Fase 3) ──
// Los eventos de sesión viajan al backend (ACTIVIDAD_USUARIOS) con el mismo
// transporte del API (token-first/key-fallback). Son best-effort: una caída
// de red o un logout con reload pueden perder el último registro.
Store.subscribe('user.login', function () {
  App.ApiClient.sendActivity('login');
});
Store.subscribe('session.heartbeat', function () {
  App.ApiClient.sendActivity('heartbeat');
});
Store.subscribe('user.inactive', function () {
  console.log('[sesión] Usuario marcado como inactivo (5 min sin actividad)');
  App.ApiClient.sendActivity('inactive');
});
Store.subscribe('session.end', function (p) {
  console.log('[sesión] Finalizada:', p && p.email);
  App.ApiClient.sendActivity('end');
});
