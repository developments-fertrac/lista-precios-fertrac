// ============================================================
// PHOTOS — Extracción de URLs de imágenes y gestión de CACHE
// ============================================================
// CACHE:
//   A = REFERENCIA
//   B = FOTO_URL_LISTAS  (URL original de LISTA DE PRECIOS)
//   C = FOTO_URL_DRIVE   (URL del archivo en Drive tras descarga)
//   D = FECHA_ACTUALIZACION
//   E = ERROR            (1 = falló la descarga, vacío = OK)
//   F = ERROR_DETALLE    (descripción del error)

// ── Constantes internas de CACHE ──
const CACHE_COL_REF       = 1;
const CACHE_COL_URL_LISTA = 2;
const CACHE_COL_URL_DRIVE = 3;
const CACHE_COL_FECHA     = 4;
const CACHE_COL_ERROR     = 5;
const CACHE_COL_DETALLE   = 6;
const CACHE_TOTAL_COLS    = 6;

/**
 * Extrae la URL de una celda con imagen.
 * @param {*} valor - Valor de la celda (CellImage, fórmula IMAGE, URL string, etc.)
 * @return {string} URL extraída o "" si no se pudo identificar.
 */
function obtenerUrlImagen(valor) {
  if (!valor) return "";

  // Objeto CellImage con getContentUrl
  if (typeof valor === "object" && typeof valor.getContentUrl === "function") {
    try {
      const url = valor.getContentUrl();
      if (url && url.indexOf("http") === 0) return url;
    } catch (e) {}
  }

  // Objeto con getUrl
  if (typeof valor === "object" && typeof valor.getUrl === "function") {
    try {
      const url = valor.getUrl();
      if (url && url.indexOf("http") === 0) return url;
    } catch (e) {}
  }

  // String que contiene URL directa
  if (typeof valor === "string" && valor.indexOf("http") === 0) return valor;

  // Fórmula =IMAGE("URL")
  if (typeof valor === "string" && valor.indexOf("=") === 0) {
    const match = valor.match(/=IMAGE\s*\(\s*["']([^"']+)["']/i);
    if (match) return match[1];
  }

  return "";
}

// ============================================================
// RECOLECTOR BULK — Lee LISTA DE PRECIOS y escribe CACHE
// ============================================================

/**
 * Recorre LISTA DE PRECIOS desde fila 14 hasta el final.
 * Para cada fila extrae la referencia (col D) y la URL de la imagen (col C),
 * limpia CACHE completamente y guarda los nuevos registros.
 */
function recolectarUrlsYGuardarCache() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    console.log("🔒 Lock en uso — omitiendo");
    return;
  }

  try {
    const ssLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS);
    const shLista = ssLista.getSheetByName(CONFIG.SHEET_LISTA);
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    let shCache   = _obtenerOCrearCache_(ssMotor);

    // ── Leer LISTA DE PRECIOS desde fila 14 ──
    const FILA_INICIO = CONFIG.LISTA_DATA_ROW;
    const lastRow   = shLista.getLastRow();
    const totalRows = lastRow - FILA_INICIO + 1;

    if (totalRows <= 0) {
      console.log("⚠️ No hay datos desde fila " + FILA_INICIO);
      return;
    }

    const rangoRef = shLista.getRange(FILA_INICIO, CONFIG.LISTA_COL_REF, totalRows, 1);
    const rangoImg = shLista.getRange(FILA_INICIO, CONFIG.LISTA_COL_IMG, totalRows, 1);

    const refs = rangoRef.getDisplayValues();
    const imgs = rangoImg.getValues();

    // ── Recolectar URLs ──
    const cacheData = [];
    let extraidas = 0;
    let vacias    = 0;

    for (let i = 0; i < totalRows; i++) {
      const ref = String(refs[i][0] || "").trim().toUpperCase();
      if (!ref) continue;

      const url = obtenerUrlImagen(imgs[i][0]);

      if (url) {
        // REFERENCIA | FOTO_URL_LISTAS | FOTO_URL_DRIVE (vacío) | FECHA | ERROR (vacío) | DETALLE (vacío)
        cacheData.push([ref, url, "", new Date(), "", ""]);
        extraidas++;
      } else {
        vacias++;
      }
    }

    // ── Limpiar CACHE completo (excepto encabezados) ──
    const existingRows = shCache.getLastRow();
    if (existingRows > 1) {
      shCache.getRange(2, 1, existingRows - 1, CACHE_TOTAL_COLS).clear();
    }

    // ── Guardar nuevos registros ──
    if (cacheData.length > 0) {
      shCache.getRange(2, 1, cacheData.length, CACHE_TOTAL_COLS).setValues(cacheData);
    }

    console.log("✅ CACHE actualizada | Extraídas: " + extraidas +
                " | Sin URL: " + vacias +
                " | Total filas procesadas: " + totalRows);

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// NUEVAS REFERENCIAS — Agrega lo que no está en CACHE desde LISTA
// ============================================================

/**
 * Para trigger. Lee LISTA DE PRECIOS desde la fila marcada por el cursor y
 * procesa SOLO un bloque de NUEVAS_BLOQUE filas por ejecución, de forma que
 * un trigger (ej. cada 5 min) avance de a bloques sin chocar con el timeout.
 * Las referencias ya presentes en CACHE se detectan y se omiten.
 *
 * Detecta referencias que aún no existen en CACHE. Las agrega
 * (REFERENCIA + FOTO_URL_LISTAS), descarga la foto webp a FOLDER_ID y
 * completa FOTO_URL_DRIVE. NO borra nada de CACHE (solo agrega las nuevas).
 *
 * El cursor se guarda en CacheService (NUEVAS_CACHE_KEY) y, al terminar toda
 * la LISTA, se elimina para reiniciar el ciclo en la próxima pasada.
 *
 * Flujo por nueva referencia:
 *   1. Validar que exista + extraer URL de imagen (obtenerUrlImagen)
 *   2. Agregar fila a CACHE con FOTO_URL_LISTAS
 *   3. Descargar webp y guardar en FOLDER_ID
 *   4. Completar FOTO_URL_DRIVE con la URL del archivo
 */
function sincronizarNuevasReferencias() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    console.log("🔒 Lock en uso — omitiendo");
    return;
  }

  try {
    const ssLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS);
    const shLista = ssLista.getSheetByName(CONFIG.SHEET_LISTA);
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    const shCache = _obtenerOCrearCache_(ssMotor);

    // ── 1. Índice de referencias ya presentes en CACHE ──
    const cacheLast = shCache.getLastRow();
    const cacheRefs = new Set();
    if (cacheLast > 1) {
      shCache.getRange(2, CACHE_COL_REF, cacheLast - 1, 1)
        .getDisplayValues()
        .forEach(r => {
          const ref = String(r[0] || "").trim().toUpperCase();
          if (ref) cacheRefs.add(ref);
        });
    }
    console.log("📋 Referencias en CACHE: " + cacheRefs.size);

    // ── 2. Leer TODA la LISTA DE PRECIOS (sin ventanas/bloques ni cursor) ──
    const FILA_INICIO = CONFIG.LISTA_DATA_ROW;
    const lastRow   = shLista.getLastRow();
    const totalRows = lastRow - FILA_INICIO + 1;
    if (totalRows <= 0) {
      console.log("⚠️ LISTA DE PRECIOS vacía");
      return;
    }

    console.log("📥 Leyendo " + totalRows + " filas de LISTA DE PRECIOS...");
    const rangoRef = shLista.getRange(FILA_INICIO, CONFIG.LISTA_COL_REF, totalRows, 1);
    const rangoImg = shLista.getRange(FILA_INICIO, CONFIG.LISTA_COL_IMG, totalRows, 1);
    const refsLista = rangoRef.getDisplayValues();
    const imgsLista = rangoImg.getValues();

    // ── 3. Procesar referencias ausentes en CACHE que tengan foto ──
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    const tratadas = new Set();
    let agregadas = 0;
    let sinImg    = 0;
    let conError  = 0;
    let yaEnCache = 0;

    for (let j = 0; j < refsLista.length; j++) {
      const ref = String(refsLista[j][0] || "").trim().toUpperCase();
      if (!ref || tratadas.has(ref)) continue;               // sin ref o ya tratada en esta pasada
      if (cacheRefs.has(ref)) { yaEnCache++; continue; }     // ya en CACHE → omitir
      if (!imgsLista[j][0]) { sinImg++; continue; }          // sin imagen en LISTA → omitir
      tratadas.add(ref);

      const url = obtenerUrlImagen(imgsLista[j][0]);

      // Solo se agrega si tiene imagen/URL. Si no, se omite y NO se
      // inserta nada en CACHE.
      if (!url) {
        sinImg++;
        console.log("⚠️ " + ref + " — sin URL extraíble, NO se agrega");
        continue;
      }

      console.log("🆕 " + ref + " — en LISTA y sin CACHE, registrando foto");

      // Agregar fila a CACHE con FOTO_URL_LISTAS (DRIVE aún vacío)
      const cacheRow = shCache.getLastRow() + 1;   // fila nueva al final
      shCache.getRange(cacheRow, CACHE_COL_REF, 1, CACHE_TOTAL_COLS)
        .setValues([[ref, url, "", new Date(), "", ""]]);

      // ── Descargar webp probando varios métodos (wsrv GET, directa, wsrv POST).
      const MAX_REINTENTOS = 2;   // total de intentos (1 + 1 reintento)
      let archivoOK = false;
      let ultimoError = "";
      let detalle = "";
      let metodoOK = "";
      let intentoOK = "";
      let archivoEnDrive = null;

      for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        const resultado = _descargarWebp_(url, ref + ".webp");

        if (!resultado.ok) {
          detalle = resultado.detalle;
          ultimoError = detalle;
          console.log("🔄 " + ref + " intento " + intento + "/" + MAX_REINTENTOS + " — " + detalle);
          Utilities.sleep(500);
          continue;
        }

        const blob = resultado.blob;

        // Guardar en Drive (reemplaza el existente {ref}.webp si ya había)
        const file = _guardarEnCarpeta_(folder, ref + ".webp", blob);
        archivoEnDrive = file;

        // Re-validar la imagen tal como quedó en Drive. Si no es válida,
        // se borra el archivo (no acumular basura) y se reintenta.
        const bytesDrive = file.getBlob().getBytes();
        if (!_esWebpValido_(bytesDrive)) {
          try { file.setTrashed(true); } catch (e) {}
          detalle = "Archivo en Drive inválido tras guardar (" + (bytesDrive.length / 1024).toFixed(1) + " KB) — borrado y reintentando";
          ultimoError = detalle;
          console.log("🔄 " + ref + " intento " + intento + "/" + MAX_REINTENTOS + " — Drive inválido (" + bytesDrive.length + " bytes)");
          continue;
        }

        const driveUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";

        // Completar FOTO_URL_DRIVE y marcar 200 (procesada/OK) para que
        // los procesos de retoma no vuelvan a tocar esta fila.
        shCache.getRange(cacheRow, CACHE_COL_URL_DRIVE).setValue(driveUrl);
        shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(200);
        agregadas++;
        archivoOK = true;
        metodoOK = resultado.detalle;
        intentoOK = String(intento);
        console.log("✅ " + ref + " — foto en Drive (intento " + intento + ", " + resultado.detalle + ") marcada 200");
        break;
      }

      // ── Resultado final ──
      if (archivoOK) {
        _registrarBitacoraFotos_(ref, "OK", metodoOK, intentoOK);
      } else {
        // Eliminar cualquier archivo malo de Drive que quedara de un intento
        if (archivoEnDrive) {
          try { archivoEnDrive.setTrashed(true); } catch (e) {}
        }
        // Escribir ERROR=1 + detalle real (métodos probados) de forma atómica
        shCache.getRange(cacheRow, CACHE_COL_ERROR, 1, 2)
          .setValues([[1, detalle || ultimoError]]);
        conError++;
        _registrarBitacoraFotos_(ref, "ERROR", detalle || ultimoError, String(MAX_REINTENTOS));
        console.log("❌ " + ref + " — falló tras " + MAX_REINTENTOS + " intentos (" + (detalle || ultimoError) + ")");
      }
    }

    console.log("📈 Nuevas sincronizadas | Completadas: " + agregadas +
                " | Con error: " + conError +
                " | Sin URL: " + sinImg +
                " | Ya en CACHE: " + yaEnCache);

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// DESCARGAR IMÁGENES WEBP — Lee CACHE, convierte y guarda en Drive
// ============================================================

/**
 * Descarga cada imagen de CACHE en formato WEBP, la guarda
 * en FOLDER_ID con nombre {REFERENCIA}.webp y escribe la
 * URL de Drive en CACHE columna C (FOTO_URL_DRIVE).
 */
function descargarFotosWebp() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.FOTOS_MAX_MS)) {
    console.log("🔒 Lock en uso — omitiendo");
    return;
  }

  try {
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    const shCache  = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);

    if (!shCache) {
      console.log("⚠️ Hoja CACHE no existe — ejecuta recolectarUrlsYGuardarCache primero");
      return;
    }

    const lastRow   = shCache.getLastRow();
    const totalRows = lastRow - 1; // menos encabezado
    if (totalRows <= 0) {
      console.log("⚠️ CACHE vacía");
      return;
    }

    const data = shCache.getRange(2, 1, totalRows, CACHE_TOTAL_COLS).getValues();

    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    let guardadas = 0;
    let fallidas  = 0;
    let omitidas  = 0;

    for (let i = 0; i < data.length; i++) {
      const ref     = String(data[i][CACHE_COL_REF - 1]       || "").trim().toUpperCase();
      const url     = String(data[i][CACHE_COL_URL_LISTA - 1] || "").trim();
      const driveOk = String(data[i][CACHE_COL_URL_DRIVE - 1] || "").trim();
      const conError = String(data[i][CACHE_COL_ERROR - 1]    || "").trim();
      const cacheRow = i + 2;

      if (!ref || !url) {
        omitidas++;
        continue;
      }

      // Saltar si ya tiene URL de Drive OK
      if (driveOk) {
        omitidas++;
        continue;
      }

      // Saltar si tiene ERROR marcado (1 = falló) o marcado como limpiada (200)
      if (conError === "1" || conError === "200") {
        omitidas++;
        continue;
      }

      // Convertir a WEBP usando wsrv.nl
      const webpUrl = CONFIG.FOTOS_CONV_WEBP.replace("{URL}", encodeURIComponent(url));

      try {
        const response = UrlFetchApp.fetch(webpUrl, { muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
          console.log("❌ HTTP " + response.getResponseCode() + " — " + ref);
          console.log("   URL lista: " + url);
          console.log("   URL wsrv:  " + webpUrl);
          shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(1);
          shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("HTTP " + response.getResponseCode() + " — wsrv.nl no pudo procesar la imagen");
          fallidas++;
          continue;
        }

        const blob = response.getBlob().setName(ref + ".webp");

        // Verificar que sea una imagen WEBP válida (firma + tamaño mínimo)
        if (!_esWebpValido_(blob.getBytes())) {
          console.log("❌ Imagen inválida — " + ref);
          shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(1);
          shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("Imagen inválida (no WebP, Blob o < " + CONFIG.FOTOS_MIN_KB + " KB) — posible URL corrupta");
          fallidas++;
          continue;
        }

        // Guardar en Drive (sobrescribir si ya existe)
        const file = _guardarEnCarpeta_(folder, ref + ".webp", blob);

        // Actualizar CACHE: URL de Drive + limpiar error
        const driveUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";
        shCache.getRange(cacheRow, CACHE_COL_URL_DRIVE).setValue(driveUrl);
        shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue("");
        shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("");

        guardadas++;

        // Pausa cada 10 imágenes para evitar cuotas
        if (guardadas % 10 === 0) {
          Utilities.sleep(1000);
          console.log("⏳ Progreso: " + guardadas + "/" + totalRows);
        }

      } catch (e) {
        console.log("❌ Error — " + ref + ": " + e.message);
        shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(1);
        shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue(e.message);
        fallidas++;
      }
    }

    console.log("✅ Descarga WEBP | Guardadas: " + guardadas +
                " | Fallidas: " + fallidas +
                " | Omitidas: " + omitidas);

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// PROCESAR PENDIENTES — Solo filas sin DRIVE y sin ERROR
// ============================================================
// Usa checkpoint (CacheService) para procesar en lotes y no
// superar el timeout. Cada ejecución procesa un máximo de
// bloque y el siguiente trigger retoma donde quedó.

const PENDIENTES_BLOQUE = 40;   // fichas por ejecución
const PENDIENTES_CACHE_KEY = "pendientes_procesados_idx";

const NUEVAS_BLOQUE = 280;   // filas de LISTA DE PRECIOS por ejecución
const NUEVAS_CACHE_KEY = "sincronizar_nuevas_fila";

/**
 * Evalúa CACHE: procesa filas donde FOTO_URL_DRIVE está vacío
 * y ERROR no es 1, en lotes con checkpoint. Descarga la imagen
 * y guarda en Drive.
 */
function procesarPendientesDrive() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.FOTOS_MAX_MS)) {
    console.log("🔒 Lock en uso — omitiendo");
    return;
  }

  try {
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    const shCache  = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);

    if (!shCache) {
      console.log("⚠️ Hoja CACHE no existe");
      return;
    }

    const lastRow   = shCache.getLastRow();
    const totalRows = lastRow - 1;
    if (totalRows <= 0) {
      console.log("⚠️ CACHE vacía");
      return;
    }

    const data = shCache.getRange(2, 1, totalRows, CACHE_TOTAL_COLS).getValues();

    // ── Construir lista de pendientes en orden ──
    const pendientes = [];
    data.forEach((row, idx) => {
      const driveOk  = String(row[CACHE_COL_URL_DRIVE - 1] || "").trim();
      const conError = String(row[CACHE_COL_ERROR - 1]     || "").trim();
      // Saltar filas ya con DRIVE, con ERROR=1, o marcadas como limpiadas (200)
      if (!driveOk && conError !== "1" && conError !== "200") {
        pendientes.push({ cacheRow: idx + 2, row: row });
      }
    });

    if (pendientes.length === 0) {
      console.log("✅ No hay pendientes para descargar");
      return;
    }

    // ── Checkpoint: desde qué índice continuamos ──
    const cache = CacheService.getScriptCache();
    let desde = parseInt(cache.get(PENDIENTES_CACHE_KEY) || "0", 10);

    // Si el checkpoint quedó fuera de rango, reiniciar (nuevos pendientes)
    if (desde >= pendientes.length) desde = 0;

    const hasta = Math.min(desde + PENDIENTES_BLOQUE, pendientes.length);
    console.log("📥 Procesando [" + desde + " → " + hasta + ") de " + pendientes.length + " pendientes");

    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    let guardadas = 0;
    let fallidas  = 0;
    let procesadas = 0;

    const inicio = Date.now();

    for (let i = desde; i < hasta; i++) {
      const { cacheRow, row } = pendientes[i];
      const ref = String(row[CACHE_COL_REF - 1]       || "").trim().toUpperCase();
      const url = String(row[CACHE_COL_URL_LISTA - 1]  || "").trim();
      procesadas++;

      if (!ref || !url) {
        fallidas++;
        continue;
      }

      const webpUrl = CONFIG.FOTOS_CONV_WEBP.replace("{URL}", encodeURIComponent(url));

      try {
        const response = UrlFetchApp.fetch(webpUrl, { muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
          shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(1);
          shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("HTTP " + response.getResponseCode());
          fallidas++;
        } else {
          const blob = response.getBlob().setName(ref + ".webp");

          if (!_esWebpValido_(blob.getBytes())) {
            shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(1);
            shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("Imagen inválida (no WebP, Blob o < " + CONFIG.FOTOS_MIN_KB + " KB)");
            fallidas++;
          } else {
            const file = _guardarEnCarpeta_(folder, ref + ".webp", blob);
            const driveUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";

            shCache.getRange(cacheRow, CACHE_COL_URL_DRIVE).setValue(driveUrl);
            shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("");
            if (shCache.getRange(cacheRow, CACHE_COL_ERROR).getValue() === 1) {
              shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue("");
            }
            guardadas++;
          }
        }
      } catch (e) {
        shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue(1);
        shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue(e.message);
        fallidas++;
      }

      // Guardar progreso constantemente para no perder si hay timeout
      cache.put(PENDIENTES_CACHE_KEY, String(i + 1), 2100); // 35 min de vida

      // Pausa cada 10 para evitar cuota
      if ((i + 1) % 10 === 0) {
        Utilities.sleep(500);
        console.log("⏳ Avance " + (i + 1) + "/" + hasta);
      }
    }

    // ── Al terminar el bloque ──
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

    if (hasta >= pendientes.length) {
      // Se terminó TODO
      cache.remove(PENDIENTES_CACHE_KEY);
      console.log("✅ Todos los pendientes procesados | Guardadas: " + guardadas +
                  " | Fallidas: " + fallidas + " | Duración: " + segundos + "s");
    } else {
      // Quedan más — el próximo trigger retoma desde `hasta`
      cache.put(PENDIENTES_CACHE_KEY, String(hasta), 2100);
      console.log("🔄 Lote completado (hasta " + hasta + ") | Guardadas: " + guardadas +
                  " | Fallidas: " + fallidas + " | Duración: " + segundos +
                  "s | Pendientes restantes: " + (pendientes.length - hasta));
    }

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// CACHE DE URLs DE FOTOS — CacheService para servir el catálogo
// de fotos sin releer la CACHE sheet en cada request
// ============================================================

const FOTOS_CACHE_KEY = "fotos_urls_map";   // {referencia: driveUrl}
const FOTOS_CACHE_TTL = 3600;               // 1 hora de vigencia

/**
 * Devuelve un mapa { REFERENCIA → FOTO_URL_DRIVE } de todas las fotos
 * procesadas (con URL de Drive y sin error). Se sirve desde CacheService
 * cuando está vigente; si caducó, se relee la CACHE sheet y se repuebla.
 * @return {Object} Mapa referencia → URL de Drive (solo entradas válidas).
 */
function obtenerUrlsFotosCache_() {
  const cache = CacheService.getScriptCache();
  const cacheado = cache.get(FOTOS_CACHE_KEY);
  if (cacheado !== null) {
    try { return JSON.parse(cacheado); } catch (e) {}
  }

  const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const shCache = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);
  const urlsMap = {};

  if (shCache) {
    const lastRow = shCache.getLastRow();
    if (lastRow > 1) {
      const data = shCache.getRange(2, 1, lastRow - 1, CACHE_TOTAL_COLS).getValues();
      data.forEach(row => {
        const ref      = String(row[CACHE_COL_REF - 1]       || "").trim().toUpperCase();
        const driveUrl = String(row[CACHE_COL_URL_DRIVE - 1] || "").trim();
        const conError = String(row[CACHE_COL_ERROR - 1]     || "").trim();
        // Solo referencias con URL de Drive y sin error (o marcadas OK=200)
        if (ref && driveUrl && conError !== "1") {
          urlsMap[ref] = driveUrl;
        }
      });
    }
  }

  cache.put(FOTOS_CACHE_KEY, JSON.stringify(urlsMap), FOTOS_CACHE_TTL);
  return urlsMap;
}

/**
 * Invalida el caché de URLs de fotos (para que el frontend vea las
 * fotos nuevas sin esperar el TTL). Se llama tras una sync completa.
 */
function invalidarCacheFotos_() {
  try { CacheService.getScriptCache().remove(FOTOS_CACHE_KEY); } catch (e) {}
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Crea hoja CACHE con encabezados si no existe.
 */
function _obtenerOCrearCache_(ssMotor) {
  let shCache = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);
  if (!shCache) {
    shCache = ssMotor.insertSheet(CONFIG.SHEET_CACHE);
    shCache.getRange(1, 1).setValue("REFERENCIA");
    shCache.getRange(1, 2).setValue("FOTO_URL_LISTAS");
    shCache.getRange(1, 3).setValue("FOTO_URL_DRIVE");
    shCache.getRange(1, 4).setValue("FECHA_ACTUALIZACION");
    shCache.getRange(1, 5).setValue("ERROR");
    shCache.getRange(1, 6).setValue("ERROR_DETALLE");
    shCache.getRange(1, 1, 1, CACHE_TOTAL_COLS).setFontWeight("bold");
    console.log("📄 Hoja CACHE creada con encabezados");
  }
  return shCache;
}

/**
 * Guarda un blob en la carpeta. Si ya existe un archivo con el mismo nombre,
 * lo reemplaza. Retorna el archivo creado/actualizado.
 * Asigna lectura pública para que el navegador cargue la imagen directo.
 */
function _guardarEnCarpeta_(folder, nombre, blob) {
  const existing = folder.getFilesByName(nombre);
  if (existing.hasNext()) {
    const file = existing.next();
    file.setContent(blob);
    _hacerPublicoLectura_(file);
    return file;
  }
  const file = folder.createFile(blob);
  _hacerPublicoLectura_(file);
  return file;
}

/**
 * Asigna permiso de lectura a "cualquier persona con el enlace".
 * Así la URL directa de Drive funciona sin login.
 */
function _hacerPublicoLectura_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.log("⚠️ No se pudo hacer público " + file.getName() + ": " + e.message);
  }
}

/**
 * Valida que los bytes descargados sean una imagen WEBP real y usable:
 *  - No debe tener contenido "Blob" (archivo corrupto).
 *  - Debe tener firma WebP (RIFF + WEBP).
 *  - Debe pesar al menos CONFIG.FOTOS_MIN_KB (10 KB), para rechazar
 *    placeholders/imágenes de error de wsrv.nl (~4 KB).
 * @param {number[]} bytes
 * @return {boolean} true si la imagen es válida
 */
function _esWebpValido_(bytes) {
  const firmaWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;  // "WEBP"

  const esBlob = Utilities.newBlob(bytes, "text/plain").getDataAsString().trim() === "Blob";

  const minBytes = (CONFIG.FOTOS_MIN_KB || 10) * 1024;
  return !esBlob && firmaWebp && bytes.length >= minBytes;
}

/**
 * Registra el resultado de procesar una foto en la hoja BITACORA_FOTOS
 * (base MOTOR): FECHA | REFERENCIA | RESULTADO (OK/ERROR) | DETALLE | INTENTO.
 * Sirve de auditoría/progreso sin depender de la consola.
 */
function _registrarBitacoraFotos_(ref, resultado, detalle, intento) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    let sh = ss.getSheetByName(CONFIG.SHEET_BITACORA_FOTOS);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_BITACORA_FOTOS);
      sh.getRange(1, 1, 1, 5).setValues([["FECHA", "REFERENCIA", "RESULTADO", "DETALLE", "INTENTO"]]);
      sh.getRange(1, 1, 1, 5).setFontWeight("bold");
    }
    sh.appendRow([new Date(), ref, resultado, detalle || "", intento || ""]);
  } catch (e) {
    console.log("⚠️ No se pudo escribir bitácora: " + e.message);
  }
}

/**
 * Descarga/convierte una imagen a WEBP probando varios métodos en cascada:
 *   1. wsrv.nl GET (conversión remota)          → CONFIG.FOTOS_CONV_WEBP
 *   2. Descarga directa del origen; si ya es WEBP válido, se usa tal cual.
 *   3. POST a wsrv.nl con los bytes del origen  → CONFIG.FOTOS_CONV_WEBP_POST
 *
 * @param {string} url    URL original de la imagen.
 * @param {string} nombre Nombre para el blob (ej. "REF.webp").
 * @return {{ok: boolean, blob: Object|null, detalle: string}}
 */
function _descargarWebp_(url, nombre) {
  const razones = [];

  // ── Método 1: wsrv.nl GET (conversión remota por URL) ──
  try {
    const urlConv = CONFIG.FOTOS_CONV_WEBP.replace("{URL}", encodeURIComponent(url));
    const r = UrlFetchApp.fetch(urlConv, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      const b = r.getBlob().setName(nombre);
      if (_esWebpValido_(b.getBytes())) return { ok: true, blob: b, detalle: "wsrv GET" };
      razones.push("wsrv GET: inválida " + (b.getBytes().length / 1024).toFixed(1) + "KB");
    } else {
      razones.push("wsrv GET: HTTP " + r.getResponseCode());
    }
  } catch (e) {
    razones.push("wsrv GET: " + e.message);
  }

  // ── Método 2: descarga directa del origen ──
  let directa = null;
  try {
    const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      const b = r.getBlob().setName(nombre);
      if (_esWebpValido_(b.getBytes())) return { ok: true, blob: b, detalle: "directa (ya WEBP)" };
      razones.push("directa: inválida " + (b.getBytes().length / 1024).toFixed(1) + "KB");
      directa = b;   // útil para el método 3
    } else {
      razones.push("directa: HTTP " + r.getResponseCode());
    }
  } catch (e) {
    razones.push("directa: " + e.message);
  }

  // ── Método 3: POST a wsrv.nl con los bytes del origen ──
  if (directa) {
    try {
      const r = UrlFetchApp.fetch(CONFIG.FOTOS_CONV_WEBP_POST, {
        method: "post",
        payload: directa.getBytes(),
        contentType: directa.getContentType() || "application/octet-stream",
        muteHttpExceptions: true
      });
      if (r.getResponseCode() === 200) {
        const b = r.getBlob().setName(nombre);
        if (_esWebpValido_(b.getBytes())) return { ok: true, blob: b, detalle: "wsrv POST" };
        razones.push("wsrv POST: inválida " + (b.getBytes().length / 1024).toFixed(1) + "KB");
      } else {
        razones.push("wsrv POST: HTTP " + r.getResponseCode());
      }
    } catch (e) {
      razones.push("wsrv POST: " + e.message);
    }
  } else {
    razones.push("wsrv POST: sin bytes del origen");
  }

  return { ok: false, blob: null, detalle: razones.join(" | ") };
}

// ============================================================
// ACTUALIZAR FOTOS CON ERROR — Reintenta refs con ERROR=1 en CACHE
// ============================================================

/**
 * Reconstrucción de actualizarFotosConError con la lógica de errores actual.
 * Filtra SOLO filas de CACHE con ERROR === 1 (independientemente de si tienen
 * o no link en FOTO_URL_DRIVE), cruza cada referencia contra LISTA DE PRECIOS
 * para obtener la URL de imagen MÁS RECIENTE (a diferencia de
 * revalidarErroresCache, que reutiliza la URL ya guardada en FOTO_URL_LISTAS),
 * reintenta la descarga y actualiza la fila:
 *   - Si la fila YA tiene link en FOTO_URL_DRIVE, se ELIMINA la foto antigua
 *     de Drive (papelera) y se descarga/reemplaza por la nueva.
 *   - Éxito  → completa FOTO_URL_DRIVE y limpia ERROR/DETALLE.
 *   - Fracaso → mantiene ERROR=1 y actualiza ERROR_DETALLE con el motivo.
 *
 * Es idempotente: solo toca filas con ERROR=1. Corre bajo lock y registra en
 * BITACORA_FOTOS. Pensada para ejecutarse manual o por trigger.
 */
function actualizarFotosConError() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.FOTOS_MAX_MS)) {
    console.log("🔒 Lock en uso — omitiendo");
    return;
  }

  try {
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    const shCache = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);

    if (!shCache) {
      console.log("⚠️ Hoja CACHE no existe");
      return;
    }

    const lastRow = shCache.getLastRow();
    const totalRows = lastRow - 1;
    if (totalRows <= 0) {
      console.log("⚠️ CACHE vacía");
      return;
    }

    const cacheData = shCache.getRange(2, 1, totalRows, CACHE_TOTAL_COLS).getValues();

    // ── 1. Filtrar filas SOLO con ERROR === 1 ──
    // (pueden tener o no link en FOTO_URL_DRIVE; si tienen, se reemplaza la foto)
    const errores = [];
    cacheData.forEach((row, idx) => {
      const conError = String(row[CACHE_COL_ERROR - 1] || "").trim();
      if (conError === "1") {
        errores.push({
          ref:      String(row[CACHE_COL_REF - 1] || "").trim().toUpperCase(),
          driveUrl: String(row[CACHE_COL_URL_DRIVE - 1] || "").trim(),
          cacheRow: idx + 2
        });
      }
    });

    if (errores.length === 0) {
      console.log("✅ No hay fotos con ERROR=1 que actualizar");
      return;
    }

    console.log("🔍 " + errores.length + " fotos con ERROR=1 — relanzando descarga");

    // ── Helper: extraer fileId de una URL de Drive ──
    function _extraerFileId(url) {
      const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (m1) return m1[1];
      const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      return m2 ? m2[1] : null;
    }

    // ── 2. Índice de URLs actuales de LISTA DE PRECIOS (las más recientes) ──
    const ssLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS);
    const shLista = ssLista.getSheetByName(CONFIG.SHEET_LISTA);
    const URL_ACTUAL = {};   // REF (upper) → URL de imagen actual en LISTA

    const filaInicio = CONFIG.LISTA_DATA_ROW;
    const lastLista  = shLista.getLastRow();
    const totalLista = lastLista - filaInicio + 1;
    if (totalLista > 0) {
      const refs = shLista.getRange(filaInicio, CONFIG.LISTA_COL_REF, totalLista, 1).getDisplayValues();
      const imgs = shLista.getRange(filaInicio, CONFIG.LISTA_COL_IMG, totalLista, 1).getValues();
      for (let i = 0; i < totalLista; i++) {
        const ref = String(refs[i][0] || "").trim().toUpperCase();
        if (!ref || URL_ACTUAL.hasOwnProperty(ref)) continue;
        const url = obtenerUrlImagen(imgs[i][0]);
        if (url) URL_ACTUAL[ref] = url;
      }
    }

    // ── 3. Reintentar descarga por error ──
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    let corregidas = 0;
    let persisten  = 0;
    let sinUrl     = 0;
    let reemplazadas = 0;
    const cacheMods = {};

    errores.forEach(({ ref, driveUrl, cacheRow }) => {
      // Sin referencia → no se puede cruzar ni descargar
      if (!ref) {
        cacheMods[cacheRow] = ["", "", "", 1, "Sin referencia para procesar", ""];
        persisten++;
        return;
      }

      const url = URL_ACTUAL[ref];

      // Ya no tiene imagen en LISTA DE PRECIOS → limpiar el error (foto retirada)
      if (!url) {
        cacheMods[cacheRow] = ["", "", "", "", "", "Foto retirada de LISTA DE PRECIOS"];
        sinUrl++;
        console.log("   🗑️ " + ref + " — sin imagen en LISTA, error LIMPIADO");
        return;
      }

      const MAX_REINTENTOS = 2;
      let archivoOK = false;
      let detalle = "";
      let metodoOK = "";
      let intentoOK = "";

      // Si la fila YA tenía link en Drive, se elimina la foto antigua al
      // reemplazarla por la nueva (evita quedar con dos archivos en Drive).
      const tieneFotoPrevia = Boolean(driveUrl);
      let idFotoPrevia = null;
      if (tieneFotoPrevia) idFotoPrevia = _extraerFileId(driveUrl);

      for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        const resultado = _descargarWebp_(url, ref + ".webp");

        if (!resultado.ok) {
          detalle = resultado.detalle;
          console.log("   🔄 " + ref + " intento " + intento + "/" + MAX_REINTENTOS + " — " + detalle);
          Utilities.sleep(500);
          continue;
        }

        const blob = resultado.blob;

        // Re-validar el blob descargado ANTES de tocar Drive; si no es válido,
        // se descarta y se reintenta (no se borra la foto válida previa aún).
        if (!_esWebpValido_(blob.getBytes())) {
          detalle = "Blob inválido en descarga — reintentando";
          console.log("   🔄 " + ref + " intento " + intento + "/" + MAX_REINTENTOS + " — " + detalle);
          continue;
        }

        // Guardar la NUEVA foto en Drive (reemplaza el archivo {ref}.webp).
        // En este flujo el archivo se sobrescribe por nombre; la foto previa
        // apuntada por driveUrl se elimina explícitamente al final si difiere.
        const file = _guardarEnCarpeta_(folder, ref + ".webp", blob);

        const driveUrlNuevo = "https://drive.google.com/file/d/" + file.getId() + "/view";

        // Actualizar CACHE: URL actual de LISTA, DRIVE, limpiar ERROR/DETALLE
        cacheMods[cacheRow] = [url, driveUrlNuevo, 200, "", new Date(), ""];

        // Si la fila ya tenía una foto previa (con ID diferente al archivo
        // {ref}.webp guardado), se elimina de Drive (papelera).
        if (tieneFotoPrevia && idFotoPrevia && idFotoPrevia !== file.getId()) {
          try { DriveApp.getFileById(idFotoPrevia).setTrashed(true); } catch (e) {
            console.log("   ⚠️ " + ref + " — no se pudo eliminar foto previa: " + e.message);
          }
          reemplazadas++;
        }

        corregidas++;
        archivoOK = true;
        metodoOK = resultado.detalle;
        intentoOK = String(intento);
        _registrarBitacoraFotos_(ref, "OK", metodoOK, intentoOK);
        console.log("   ✅ " + ref + " corregida (intento " + intento + ")" +
                    (tieneFotoPrevia ? " — foto previa eliminada" : ""));
        break;
      }

      if (!archivoOK) {
        cacheMods[cacheRow] = [url, driveUrl, 1, detalle || "Descarga falló", "", ""];
        persisten++;
        _registrarBitacoraFotos_(ref, "ERROR", detalle || "Descarga falló", String(MAX_REINTENTOS));
        console.log("   ❌ " + ref + " sigue con error tras " + MAX_REINTENTOS + " intentos");
      }
    });

    // ── Batch write: aplicar todos los cambios de CACHE de una sola vez ──
    const modKeys = Object.keys(cacheMods);
    if (modKeys.length > 0) {
      const modRows = modKeys.map(Number).sort((a, b) => a - b);
      const modValues = modRows.map(r => cacheMods[r]);
      shCache.getRange(modRows[0], 1, modValues.length, CACHE_TOTAL_COLS).setValues(modValues);
      console.log("📝 CACHE actualizada en batch: " + modValues.length + " filas");
    }

    console.log("✅ Actualización de fotos con error | Corregidas: " + corregidas +
                " | Reemplazadas (foto previa eliminada): " + reemplazadas +
                " | Persisten: " + persisten +
                " | Sin imagen (error limpiado): " + sinUrl);

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// REVALIDAR ERRORES — Relee celdas con ERROR=1 en LISTA DE PRECIOS
// ============================================================

/**
 * Revalida las filas de CACHE con ERROR=1: ejecuta directamente el proceso
 * de descarga usando la URL ya guardada en FOTO_URL_LISTAS, sin cruzar
 * ni validar contra LISTA DE PRECIOS. Reintenta y valida integridad.
 */
function revalidarErroresCache() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.FOTOS_MAX_MS)) {
    console.log("🔒 Lock en uso — omitiendo");
    return;
  }

  try {
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    const shCache  = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);

    if (!shCache) {
      console.log("⚠️ Hoja CACHE no existe");
      return;
    }

    const lastRow   = shCache.getLastRow();
    const totalRows = lastRow - 1;
    if (totalRows <= 0) {
      console.log("⚠️ CACHE vacía");
      return;
    }

    const cacheData = shCache.getRange(2, 1, totalRows, CACHE_TOTAL_COLS).getValues();

    // ── 1. Filtrar filas con ERROR=1 y sin URL de Drive ──
    const errores = [];
    cacheData.forEach((row, idx) => {
      const conError = String(row[CACHE_COL_ERROR - 1] || "").trim();
      const driveOk  = String(row[CACHE_COL_URL_DRIVE - 1] || "").trim();
      if (conError === "1" && !driveOk) {
        errores.push({
          ref:      String(row[CACHE_COL_REF - 1] || "").trim().toUpperCase(),
          url:      String(row[CACHE_COL_URL_LISTA - 1] || "").trim(),
          cacheRow: idx + 2
        });
      }
    });

    if (errores.length === 0) {
      console.log("✅ No hay errores que revalidar");
      return;
    }

    console.log("🔍 Revalidando " + errores.length + " errores (URL desde CACHE)");

    // ── 2. Procesar cada error directamente ──
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    let corregidas = 0;
    let persisten  = 0;

    errores.forEach(({ ref, url, cacheRow }) => {
      // Sin URL guardada → no se puede reintentar
      if (!url) {
        shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue(
          "No hay FOTO_URL_LISTAS para reintentar"
        );
        console.log("   ⚠️ " + ref + " — sin URL en CACHE");
        persisten++;
        return;
      }

      const MAX_REINTENTOS = 2;
      let archivoOK = false;
      let ultimoError = "";
      let detalle = "";

      for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        const resultado = _descargarWebp_(url, ref + ".webp");

        if (!resultado.ok) {
          detalle = resultado.detalle;
          ultimoError = detalle;
          console.log("   🔄 " + ref + " intento " + intento + "/" + MAX_REINTENTOS + " — " + detalle);
          Utilities.sleep(500);
          continue;
        }

        const blob = resultado.blob;
        const file = _guardarEnCarpeta_(folder, ref + ".webp", blob);
        const driveUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";

        shCache.getRange(cacheRow, CACHE_COL_URL_LISTA).setValue(url);
        shCache.getRange(cacheRow, CACHE_COL_URL_DRIVE).setValue(driveUrl);
        shCache.getRange(cacheRow, CACHE_COL_ERROR).setValue("");
        shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue("");
        shCache.getRange(cacheRow, CACHE_COL_FECHA).setValue(new Date());

        corregidas++;
        archivoOK = true;
        console.log("   ✅ Corregida — " + ref + " (intento " + intento + ", " + resultado.detalle + ")");
        break;
      }

      if (!archivoOK) {
        shCache.getRange(cacheRow, CACHE_COL_DETALLE).setValue(
          "URL reobtenida pero descarga falló (" + (detalle || ultimoError) + ")"
        );
        console.log("   ❌ " + ref + " — sin éxito tras " + MAX_REINTENTOS + " intentos");
        persisten++;
      }
    });

    console.log("✅ Revalidación | Corregidas: " + corregidas +
                " | Persisten: " + persisten);

  } finally {
    lock.releaseLock();
  }
}
