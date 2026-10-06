// ============================================================
// API CATÁLOGO — doGet (sirve datos e imágenes a la app)
// Fase 1: acepta LLAVE (transición) o TOKEN verificado + autorizados
// Optimizaciones de latencia:
//   - verificación de token cacheada (evita la llamada HTTP a Google
//     en cada request; se valida una vez por token).
//   - datos de Hoja2 cacheados en CacheService (TTL corto) para no
//     releer la hoja entera en cada request.
// ============================================================

// Claves de caché (CacheService) y TTL.
const API_CACHE_VERIF = "api_verif_";        // prefijo + hash(token) → email
const API_CACHE_LISTA = "api_lista_datos";   // JSON de Hoja2
const API_TTL_LISTA  = 90;                   // segundos de vigencia de Hoja2
const API_TTL_VERIF  = 1500;                 // segundos (25 min) de vigencia del token

function doGet(e) {
  const params = (e && e.parameter) || {};

  // ── 0. Log de errores de la app (?log=1) ──
  // Va ANTES de la autorización a propósito: así un error de auth
  // (token_invalido/no_autorizado) también puede registrarse en Log App.
  // logDesdeApi_ valida la llave/token por su cuenta y nunca rompe el API.
  if (params.log === "1") {
    return logDesdeApi_(params);
  }

  // ── 1. Autorización ──
  // estado: 'ok' | 'token_invalido' | 'no_autorizado' | 'sin_credenciales'
  let estado;
  if (params.key === CONFIG.ACCESS_KEY) {
    estado = 'ok';                                      // transición vía llave
  } else if (params.token) {
    const email = verificarTokenCacheada_(params.token);
    if (!email) {
      estado = 'token_invalido';                        // expirado/inválido → renovar en silencio
    } else if (!estaAutorizado_(CONFIG.ID_BASE_MOTOR, CONFIG.SHEET_USERS, email)) {
      estado = 'no_autorizado';                         // token válido, correo fuera de la lista
    } else {
      estado = 'ok';
    }
  } else {
    estado = 'sin_credenciales';
  }

  if (estado !== 'ok') {
    return jsonError_(estado);
  }

  // ── 2. Imagen: ?img=FILE_ID ──
  // Render: se devuelve la URL pública de la miniatura de Drive (thumbnail),
  // NO el binario en base64. La app la usa directo en <img src>, evitando
  // la serialización binaria por el proxy (es lo que acelera la carga).
  // Los archivos ya son de lectura pública (ANYPONE_WITH_LINK), por lo que
  // el navegador puede descargarlos sin pasar por Apps Script.
  if (params.img) {
    try {
      const file = DriveApp.getFileById(params.img);
      const zoom = (params.sz && /^\d{2,4}$/.test(params.sz)) ? params.sz : "w800";
      // thumbnail?id=FILE_ID&sz=w800 → miniatura generada por Google
      return jsonRes_({
        ok: true,
        kind: "thumbnail",
        url: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(params.img) + "&sz=" + zoom
      });
    } catch (err) {
      return jsonRes_({ ok: false, error: "img_no_disponible" });
    }
  }

  // ── 3. Catálogo de fotos: ?fotos=1 ──
  // Se sirve el mapa {referencia: driveUrl} desde CacheService (rápido, no
  // relee la CACHE sheet en cada request). Es un cache INDEPENDIENTE del de
  // datos: su invalidación no afecta el tiempo de sincronización de precios.
  if (params.fotos) {
    return jsonRes_({
      ok: true,
      fotos: obtenerUrlsFotosCache_()
    });
  }

  // ── 4. Actividad de sesión: ?activity=login|heartbeat|end|inactive ──
  // Registra en ACTIVIDAD_USUARIOS cada evento de sesión de la app. El
  // heartbeat se mama con CacheService (1 log por usuario/hora) para no
  // llenar la hoja con un registro por minuto. No expone datos: solo FECHA,
  // EMAIL, PLATAFORMA y TIPO.
  if (params.activity) {
    const tipo = ["login", "heartbeat", "end", "inactive"].includes(params.activity)
      ? params.activity : null;
    if (!tipo) return jsonError_('actividad_invalida');
    registrarActividad_(params.email, tipo, params.platform);
    return jsonRes_({ ok: true });
  }

  // ── 5. Reporte de inactivos: ?report=inactivos&dias=N ──
  // Devuelve la lista de usuarios sin actividad en los últimos N días (N por
  // defecto = CONFIG.REPORTE_DIAS_INACTIVOS). La hoja ACTIVIDAD_USUARIOS
  // se crea sola la primera vez.
  if (params.report === "inactivos") {
    const dias = parseInt(params.dias, 10) || CONFIG.REPORTE_DIAS_INACTIVOS;
    return jsonRes_({ ok: true, inactivos: usuariosInactivos_(dias) });
  }

  // ── 6. Datos incrementales: ?delta=1&since=ISO ──
  // Devuelve solo las filas modificadas después de `since`. La marca W
  // (col 23) la actualiza cada sync (diurna y completa) así que sirve de
  // reloj de cambios. `since` vacío → respuesta completa (primera vez).
  // La respuesta firma `since` = mayor W visto para que el cliente lo
  // reenvíe en la siguiente llamada sin perder filas.
  if (params.delta === "1") {
    const resDatos = obtenerDatosListaCacheados_();
    if (!resDatos.ok) return jsonError_(resDatos.error || 'error');
    return jsonRes_(filtrarDelta_(resDatos.data, params.since));
  }

  // ── 7. Datos del catálogo: { data: [...] } ──
  // Se sirve de cache cuando está vigente (rápido). Si caducó, se lee la hoja
  // bajo lock (para evitar un estado a medias) y se repuebla el caché.
  const resDatos = obtenerDatosListaCacheados_();
  if (!resDatos.ok) return jsonError_(resDatos.error || 'error');
  return ContentService
    .createTextOutput(JSON.stringify({ data: resDatos.data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Lee el catálogo completo de Hoja2 (con caché + lock) ──
// Devuelve { ok: true, data: [...] } o { ok: false, error: '...' }.
function obtenerDatosListaCacheados_() {
  const cache = CacheService.getScriptCache();
  const jsonCache = cacheGetGrande_(cache, API_CACHE_LISTA);
  if (jsonCache) {
    try { return { ok: true, data: JSON.parse(jsonCache).data || [] }; } catch (e) {}
  }

  // ⚠️ LOCK GLOBAL (docs/LOCK_APPS_SCRIPT.md): la API comparte el MISMO lock
  // que las sync/fotos. Si una de ellas lo sostiene, este READ responde
  // 'temporalmente_ocupado' en ≤1.8s y la app reintenta (espera breve, única
  // del sistema: no se lee a medias).
  const lock = LockService.getScriptLock();
  let tieneLock = false;

  try {
    // Intento rápido. Si el lock está ocupado por una sync en curso, se
    // responde 'temporalmente_ocupado' casi de inmediato (máx ~1.8s) para que
    // el frontend reintente al instante, en lugar de dejar al usuario esperando
    // ~8s. La lectura a medias se evita igual: no se lee sin lock.
    if (!lock.tryLock(1500)) return { ok: false, error: 'temporalmente_ocupado' };
    tieneLock = true;

    // Doble chequeo: quizá otra invocación pobló el caché mientras esperábamos.
    const jsonAhora = cacheGetGrande_(cache, API_CACHE_LISTA);
    if (jsonAhora) {
      try { return { ok: true, data: JSON.parse(jsonAhora).data || [] }; } catch (e) {}
    }

    const sh = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR).getSheetByName(CONFIG.SHEET_MOTOR);
    const values = sh.getDataRange().getValues();       // incluye fila 1 (encabezado)
    cachePutGrande_(cache, API_CACHE_LISTA, JSON.stringify({ data: values }), API_TTL_LISTA); // repoblar caché
    return { ok: true, data: values };

  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (tieneLock) lock.releaseLock();
  }
}

// ── Filtra filas modificadas después de `since` (col W = 22 en 0-based) ──
// Devuelve:
//   rows — filas con W posterior a `since`; si `since` es vacío, todas.
//   refs — lista COMPLETA de refs vigentes. El cliente la usa para detectar
//          borrados (un ref que teníamos y que ya no está en `refs`).
// `since` devuelto = máximo W visto; el cliente lo reenvía: así ninguna fila
// modificada en el mismo segundo se pierde (si el W máximo se reenvía, se
// re-descarga al siguiente ciclo sin consecuencia).
function filtrarDelta_(values, since) {
  const W = 22; // columna 23 (W) en índice 0-based
  const sinceTs = since ? Date.parse(since) : 0;
  const primerVez = !since || Number.isNaN(sinceTs) || since === "0" || sinceTs <= 0;

  let maxTs = 0;
  const rows = [];
  const refs = [];

  (values || []).forEach((row, i) => {
    if (i === 0) return;                                  // encabezado
    const ref = String(row[0] || "").trim().toUpperCase();
    if (!ref) return;

    refs.push(ref);

    let ts = 0;
    const wVal = row[W];
    if (wVal instanceof Date) {
      ts = wVal.getTime();
    } else if (typeof wVal === "string" && wVal.trim()) {
      const p = Date.parse(wVal);
      if (!Number.isNaN(p)) ts = p;
    }

    if (ts > maxTs) maxTs = ts;
    if (primerVez || ts > sinceTs) rows.push(row);
  });

  const nuevoSince = maxTs > 0
    ? new Date(maxTs).toISOString()
    : new Date().toISOString();

  return { ok: true, delta: true, since: nuevoSince, refs, rows };
}

// Respuesta de error estándar en JSON.
function jsonError_(codigo) {
  return ContentService
    .createTextOutput(JSON.stringify({ error: codigo }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Respuesta JSON exitosa de alto nivel.
function jsonRes_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Verifica el token con Google, cacheando el resultado por token.
// Devuelve el correo (minúsculas) o null si es inválido. La llamada externa
// a Google se hace UNA vez por token (TTL 25 min); el resto sale de caché.
function verificarTokenCacheada_(token) {
  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(token),
    Utilities.Charset.UTF_8
  );
  const hash = digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
  const key = API_CACHE_VERIF + hash;

  const cacheado = cache.get(key);
  if (cacheado !== null) return cacheado === "null" ? null : cacheado;

  // No verificado aún: consultar a Google y cachear el resultado.
  let email = null;
  try {
    const res = UrlFetchApp.fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo?access_token=" + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() === 200) {
      const info = JSON.parse(res.getContentText());
      email = info.email ? String(info.email).trim().toLowerCase() : null;
    }
  } catch (err) {
    email = null;
  }
  cache.put(key, email === null ? "null" : email, API_TTL_VERIF);
  return email;
}

// ¿El correo está en la hoja USUARIOS AUTORIZADOS (columna A, desde fila 2)?
function estaAutorizado_(idSpreadsheet, nombreHoja, email) {
  try {
    const sh = SpreadsheetApp.openById(idSpreadsheet).getSheetByName(nombreHoja);
    if (!sh) return false;
    const last = sh.getLastRow();
    if (last < 2) return false;                         // fila 1 = encabezado
    const correos = sh.getRange(2, 1, last - 1, 1).getValues()
      .map(r => String(r[0] || "").trim().toLowerCase())
      .filter(Boolean);
    return correos.includes(email);
  } catch (err) {
    return false;
  }
}

// ── Invalida la caché del catálogo tras una sync completa ──
// Para que la app vea los precios nuevos sin esperar el TTL.
// También invalida el caché de URLs de fotos (independiente), para que
// el frontend vea fotos nuevas sin esperar su TTL.
function invalidarCacheCatalogo_() {
  try { cacheRemoveGrande_(CacheService.getScriptCache(), API_CACHE_LISTA); } catch (e) {}
  try { invalidarCacheFotos_(); } catch (e) {}
}

// ============================================================
// CACHÉ GRANDE — CacheService limita cada valor a 100 KB
// ("Argumento demasiado grande: value"). Estos helpers parten el texto en
// fragmentos y guardan en la clave principal un índice "__chunks:N".
// Un fallo de caché NUNCA rompe la respuesta: solo se pierde la aceleración.
// ============================================================
const CACHE_CHUNK_CHARS = 30000;   // 30k chars ≤ 90 KB aun con UTF-8 de 3 bytes
const CACHE_MAX_CHUNKS  = 300;     // CacheService guarda máx. 1.000 ítems (expulsa hasta 900):
                                   // más de ~9 MB no se cachea para no desplazar tokens/heartbeats.

function cachePutGrande_(cache, key, str, ttl) {
  try {
    const n = Math.max(1, Math.ceil(str.length / CACHE_CHUNK_CHARS));
    if (n > CACHE_MAX_CHUNKS) {
      console.warn("cachePutGrande_(" + key + ") omitido: " + n + " fragmentos > " + CACHE_MAX_CHUNKS);
      return false;
    }
    const obj = {};
    for (let i = 0; i < n; i++) {
      obj[key + "_" + i] = str.substr(i * CACHE_CHUNK_CHARS, CACHE_CHUNK_CHARS);
    }
    obj[key] = "__chunks:" + n;
    cache.putAll(obj, ttl);
    return true;
  } catch (e) {
    console.warn("cachePutGrande_(" + key + ") omitido: " + e.message);
    return false;
  }
}

function cacheGetGrande_(cache, key) {
  try {
    const idx = cache.get(key);
    if (idx === null) return null;
    if (idx.indexOf("__chunks:") !== 0) return idx;          // valor legado (sin fragmentar)
    const n = parseInt(idx.slice(9), 10);
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + "_" + i);
    const partes = cache.getAll(keys);
    let out = "";
    for (let i = 0; i < n; i++) {
      const p = partes[keys[i]];
      if (p === undefined || p === null) return null;       // fragmento expulsado → recalcular
      out += p;
    }
    return out;
  } catch (e) {
    return null;
  }
}

function cacheRemoveGrande_(cache, key) {
  try {
    const idx = cache.get(key);
    const keys = [key];
    if (idx && idx.indexOf("__chunks:") === 0) {
      const n = parseInt(idx.slice(9), 10);
      for (let i = 0; i < n; i++) keys.push(key + "_" + i);
    }
    cache.removeAll(keys);
  } catch (e) {}
}
