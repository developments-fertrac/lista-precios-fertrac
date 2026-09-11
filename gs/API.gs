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

  // ── 4. Datos del catálogo: { data: [...] } ──
  // Se sirve de cache cuando está vigente (rápido). Si caducó, se lee la hoja
  // bajo lock (para evitar un estado a medias) y se repuebla el caché.
  const cache = CacheService.getScriptCache();
  const jsonCache = cache.get(API_CACHE_LISTA);
  if (jsonCache) {
    return ContentService
      .createTextOutput(jsonCache)
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lock = LockService.getScriptLock();
  let tieneLock = false;

  try {
    // Intento rápido. Si el lock está ocupado por una sync en curso, se
    // responde 'temporalmente_ocupado' casi de inmediato (máx ~1.8s) para que
    // el frontend reintente al instante, en lugar de dejar al usuario esperando
    // ~8s. La lectura a medias se evita igual: no se lee sin lock.
    if (!lock.tryLock(1500)) {
      return jsonError_('temporalmente_ocupado');
    }
    tieneLock = true;

    // Doble chequeo: quizá otra invocación pobló el caché mientras esperábamos.
    const jsonAhora = cache.get(API_CACHE_LISTA);
    if (jsonAhora) {
      return ContentService
        .createTextOutput(jsonAhora)
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sh = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR).getSheetByName(CONFIG.SHEET_MOTOR);
    const values = sh.getDataRange().getValues();       // incluye fila 1 (encabezado)
    const out = JSON.stringify({ data: values });
    cache.put(API_CACHE_LISTA, out, API_TTL_LISTA);     // repoblar caché
    return ContentService
      .createTextOutput(out)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (tieneLock) lock.releaseLock();
  }
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
  try { CacheService.getScriptCache().remove(API_CACHE_LISTA); } catch (e) {}
  try { invalidarCacheFotos_(); } catch (e) {}
}