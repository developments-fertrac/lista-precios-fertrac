// ============================================================
// CATALOG — Datos, filtros, tabla, detalle y auto-refresh
// ============================================================

let allData = [];
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
      if (_recargando) return;
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

// ── INIT ───────────────────────────────────────────────────────────────────
function initApp() {
  const saved = loadData();
  if (saved && saved.length > 0) {
    allData = saved;
    const ts = localStorage.getItem('fertrac_updated');
    document.getElementById('sync-status').textContent = ts ? 'Última sincronización: ' + ts : '';
    buildFilters();
    applyFilters();
  } else {
    document.getElementById('table-wrapper').innerHTML =
      '<div class="empty-state">Conéctate a internet para cargar los datos por primera vez</div>';
  }

  if (navigator.onLine) {
    syncData();
  } else {
    showOfflineBanner();
  }

  window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.remove('visible');
    syncData();
  });
  window.addEventListener('offline', () => showOfflineBanner());
};

function showOfflineBanner() {
  document.getElementById('offline-banner').classList.add('visible');
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

  if (allData.length === 0) {
    document.getElementById('table-wrapper').innerHTML =
      '<div class="loading"><div class="spinner"></div>Cargando datos...</div>';
  }

  try {
    // FASE 2: token-first con key-fallback (antes era un fetch directo con ?key=)
    const json = await apiRequest('data');

    allData = json.data.slice(1).map(row =>
      row.map(cell => cell === null || cell === undefined ? '' : String(cell).trim())
    );

    saveData(allData);
    const ts = localStorage.getItem('fertrac_updated');
    status.textContent = '✅ Actualizado: ' + ts;
    btn.textContent = '🔄 Sincronizar';
    btn.disabled = false;
    buildFilters();
    applyFilters();
  } catch(e) {
    status.textContent = '⚠️ Error al sincronizar';
    btn.textContent = '🔄 Sincronizar';
    btn.disabled = false;
    const saved = loadData();
    if (saved && saved.length > 0) { allData = saved; buildFilters(); applyFilters(); }
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
  if (allData.length === 0) return;
  const q = document.getElementById('search-input').value.toLowerCase();

  FILTER_FIELDS.forEach(target => {
    // CASCADA: las opciones de cada filtro salen del subconjunto que cumple
    // el buscador + los OTROS filtros activos.
    const subset = allData.filter(r => {
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
  const subset = allData.filter(r => {
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
  filtered = allData.filter(r => {
    if (q && !(r[C.REF]+' '+r[C.PRODUCTO]+' '+r[C.MARCA]+' '+r[C.ALTERNOS]).toLowerCase().includes(q)) return false;
    for (const f of FILTER_FIELDS) {
      if (SEL[f.id].size > 0 && !SEL[f.id].has(fval(r[f.col], f))) return false;
    }
    return true;
  });

  renderTable();

  document.getElementById('results-meta').innerHTML =
    allData.length > 0
      ? 'Mostrando <strong>' + filtered.length + '</strong> de <strong>' + allData.length + '</strong> productos'
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
function renderTable() {
  const wrapper = document.getElementById('table-wrapper');
  if (filtered.length === 0) {
    wrapper.innerHTML = '<div class="empty-state">No se encontraron productos</div>';
    return;
  }
  const show = filtered.slice(0, 200);
  const rows = show.map(r => {
    const idx = allData.indexOf(r);

    const inv = parseFloat(r[C.INV]) || 0;
    const invCls = inv > 10 ? 'ok' : inv > 0 ? 'low' : 'none';

    const condRaw = r[C.CONDICION];
    let rowStyle = '';
    if (hasCondition(condRaw)) {
      const c = getConditionStyle(condRaw);
      rowStyle = 'background:' + c.bg + '33; border-left-color:' + c.bg + ';';
    }

    return '<tr onclick="showDetail(' + idx + ')" data-idx="' + idx + '" style="' + rowStyle + '">' +
      '<td class="td-ref">' + (r[C.REF]||'—') + '</td>' +
      '<td class="td-marca"><span class="tag">' + (r[C.MARCA]||'—') + '</span></td>' +
      '<td class="td-producto">' + (r[C.PRODUCTO]||'—') + '</td>' +
      '<td class="td-inv"><span class="inv-pill ' + invCls + '">' + inv + '</span></td>' +
      '<td class="td-precio">' + formatPrice(r[C.PRECIO_BRUTO]) + '</td>' +
      '</tr>';
  }).join('');
  wrapper.innerHTML =
    '<table><thead><tr>' +
      '<th>Referencia</th>' +
      '<th>Marca</th>' +
      '<th>Producto</th>' +
      '<th style="text-align:center">Inv.</th>' +
      '<th style="text-align:right">Precio Bruto</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    (filtered.length > 200 ? '<div style="text-align:center;padding:10px;font-size:0.8rem;color:#888">Mostrando 200 de ' + filtered.length + ' resultados. Refina tu búsqueda.</div>' : '');
}

// ── DETAIL ─────────────────────────────────────────────────────────────────
function extractDriveId(url) {
  if (!url) return null;
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const match2 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  return null;
}

async function loadImage(fileId, imgElement) {
  try {
    // FASE 2: token-first con key-fallback (antes era un fetch directo con ?key=&img=)
    const dataUrl = await apiRequest('img', fileId);
    if (dataUrl && dataUrl.startsWith('data:')) imgElement.src = dataUrl;
  } catch(e) {
    imgElement.style.display = 'none';
  }
}

function showDetail(idx, keepScroll = false) {
  const r = allData[idx];
  if (!r) return;

  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('selected'));
  const tr = document.querySelector('tr[data-idx="' + idx + '"]');
  if (tr) tr.classList.add('selected');

  const inv = parseFloat(r[C.INV]) || 0;
  const invClass = inv > 10 ? 'inv-ok' : inv > 0 ? 'inv-low' : 'inv-none';
  const invText = inv > 10 ? inv + ' unidades' : inv > 0 ? inv + ' unidades (bajo)' : 'Sin stock';

  const cond = getConditionStyle(r[C.CONDICION]);

  const fileId = extractDriveId(r[C.FOTO]);
  const imgHtml = fileId
    ? '<img id="detail-img" class="product-image" alt="Foto producto" onclick="openModal(this)" style="cursor:zoom-in">'
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
          '<h3>💰 Precios</h3>' +
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
    if (imgEl) loadImage(fileId, imgEl);
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
  if (!allData || allData.length === 0) return;        // aún no hay datos base

  try {
    // FASE 2: token-first con key-fallback (antes era un fetch directo con ?key=)
    const json = await apiRequest('data');

    const fresh = json.data.slice(1).map(row =>
      row.map(cell => cell === null || cell === undefined ? '' : String(cell).trim())
    );

    // Solo actualizar si REALMENTE cambió algo
    if (dataHash(fresh) === dataHash(allData)) return;

    allData = fresh;
    saveData(allData);

    const status = document.getElementById('sync-status');
    if (status) status.textContent = '✅ Actualizado: ' + localStorage.getItem('fertrac_updated');

    // Repintar la tabla (sin interrumpir si hay un filtro desplegado abierto)
    const dropdownOpen = document.querySelector('.ms-dropdown.open');
    if (!dropdownOpen) {
      const pageY = window.scrollY;
      buildFilters();
      applyFilters({ keepWindowScroll: true });
      requestAnimationFrame(() => window.scrollTo({ top: pageY, behavior: 'auto' }));
    }

    // Si hay un detalle abierto, repintarlo con el precio nuevo (sin saltar el scroll)
    const panel = document.getElementById('detail-panel');
    if (panel && panel.classList.contains('visible')) {
      const openRef = (document.getElementById('detail-title').textContent || '').trim().toUpperCase();
      const newIdx = allData.findIndex(r => String(r[C.REF] || '').trim().toUpperCase() === openRef);
      if (newIdx >= 0) showDetail(newIdx, true);   // true = no mover el scroll
    }
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
