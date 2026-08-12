// ============================================================
// API CATÁLOGO — doGet (sirve datos e imágenes a la app)
// Fase 1: acepta LLAVE (transición) o TOKEN verificado + autorizados
// ============================================================

function doGet(e) {
  const params = (e && e.parameter) || {};

  // ── 1. Autorización ──
  // estado: 'ok' | 'token_invalido' | 'no_autorizado' | 'sin_credenciales'
  let estado;
  if (params.key === CONFIG.ACCESS_KEY) {
    estado = 'ok';                                      // transición vía llave
  } else if (params.token) {
    const email = verificarTokenGoogle_(params.token);
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
  if (params.img) {
    try {
      const blob = DriveApp.getFileById(params.img).getBlob();
      const dataUrl = "data:" + blob.getContentType() + ";base64," +
                      Utilities.base64Encode(blob.getBytes());
      return ContentService.createTextOutput(dataUrl).setMimeType(ContentService.MimeType.TEXT);
    } catch (err) {
      return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
    }
  }

  // ── 3. Datos del catálogo: { data: [...] } ──
  // Protección: si hay una sync escribiendo en Hoja2 ahora mismo, esperar
  // en vez de leer un estado a medias (parcialmente vacío/reescrito).
  const lock = LockService.getScriptLock();
  let tieneLock = false;

  try {
    // Hasta 3 intentos cortos (total ~7.5s de espera máxima) antes de rendirse.
    for (let intento = 0; intento < 3 && !tieneLock; intento++) {
      tieneLock = lock.tryLock(2500);
      if (!tieneLock) Utilities.sleep(300);
    }

    if (!tieneLock) {
      // No se pudo confirmar que Hoja2 esté estable — mejor decirle al
      // frontend que reintente, que arriesgar una lectura a medias.
      return jsonError_('temporalmente_ocupado');
    }

    const sh = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR).getSheetByName(CONFIG.SHEET_MOTOR);
    const values = sh.getDataRange().getValues();       // incluye fila 1 (encabezado)
    return ContentService
      .createTextOutput(JSON.stringify({ data: values }))
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

// Verifica el token con Google. Devuelve el correo (minúsculas) o null si es inválido.
function verificarTokenGoogle_(token) {
  try {
    const res = UrlFetchApp.fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo?access_token=" + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const info = JSON.parse(res.getContentText());
    return info.email ? String(info.email).trim().toLowerCase() : null;
  } catch (err) {
    return null;
  }
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