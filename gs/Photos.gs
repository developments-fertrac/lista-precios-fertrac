// ============================================================
// FOTOS — Poblar URLs de imágenes en BASE MOTOR
// Todos los IDs, hojas y columnas vienen de CONFIG (Config.gs).
// ============================================================

function poblarFotosBaseMotor() {

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log("🔒 Otra ejecución de fotos en curso — omitiendo este ciclo");
    return;
  }

  try {
    const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
    const ssLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS);
    const shMotor = ssMotor.getSheetByName(CONFIG.SHEET_MOTOR);
    const shLista = ssLista.getSheetByName(CONFIG.SHEET_LISTA);
    const folder  = DriveApp.getFolderById(CONFIG.FOLDER_ID);

    const COL_REF_MOTOR    = CONFIG.MOTOR_COL_REF;
    const COL_FOTO_MOTOR   = CONFIG.MOTOR_COL_FOTO;
    const COL_REF_LISTA    = CONFIG.LISTA_COL_REF;
    const COL_IMG_LISTA    = CONFIG.LISTA_COL_IMG;
    const START_ROW        = CONFIG.FOTOS_START_ROW;
    const MAX_PER_RUN      = CONFIG.FOTOS_MAX_PER_RUN;
    const MAX_MS           = CONFIG.FOTOS_MAX_MS;

    try {
      const props   = PropertiesService.getScriptProperties();

      let shCache = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);
      if (!shCache) {
        shCache = ssMotor.insertSheet(CONFIG.SHEET_CACHE);
        shCache.getRange(1, 1).setValue("REFERENCIA");
        shCache.getRange(1, 2).setValue("FOTO_URL");
        console.log("✅ Hoja CACHE creada en BASE MOTOR");
      }

      const lastRowCache = shCache.getLastRow();
      const cacheMap = new Map();
      if (lastRowCache >= 2) {
        shCache.getRange(2, 1, lastRowCache - 1, 2).getValues()
          .forEach(([ref, url]) => {
            const key = String(ref || "").trim().toUpperCase();
            if (key && url) cacheMap.set(key, String(url).trim());
          });
      }

      const lastRowLista = shLista.getLastRow();
      const refsLista = shLista
        .getRange(2, COL_REF_LISTA, Math.max(1, lastRowLista - 1), 1)
        .getValues().flat();

      const mapRef = new Map();
      refsLista.forEach((v, i) => {
        const key = String(v || "").trim().toUpperCase();
        if (key && !mapRef.has(key)) mapRef.set(key, i + 2);
      });

      const lastRowMotor = shMotor.getLastRow();
      let currentRow = Number(props.getProperty("MOTOR_NEXT_ROW") || START_ROW);

      if (currentRow > lastRowMotor) {
        eliminarTriggerFotos_();
        props.deleteProperty("MOTOR_NEXT_ROW");
        console.log("✅ ¡Proceso completado! Todas las filas procesadas.");

        const fecha = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy HH:mm");
        GmailApp.sendEmail(
          CONFIG.CORREO_DATA_SCIENCE,
          "✅ Fertrac — Proceso de fotos completado " + fecha,
          "El proceso nocturno de fotos ha finalizado exitosamente.\n\nFecha: " + fecha + "\nTodas las referencias fueron revisadas.\n\n— Fertrac Apps Script"
        );
        console.log("📧 Correo de fotos enviado");

        return;
      }

      const t0 = Date.now();
      let done = 0, copied = 0, created = 0, skipped = 0;
      const newCacheRows = [];

      while (currentRow <= lastRowMotor && done < MAX_PER_RUN) {
        if (Date.now() - t0 > MAX_MS) break;

        const ref = String(shMotor.getRange(currentRow, COL_REF_MOTOR).getValue() || "").trim().toUpperCase();
        if (!ref) { currentRow++; skipped++; continue; }

        const fotoActual = String(shMotor.getRange(currentRow, COL_FOTO_MOTOR).getValue() || "").trim();
        if (fotoActual && fotoActual.toUpperCase().startsWith("HTTP")) { currentRow++; skipped++; continue; }

        let url = "";

        if (cacheMap.has(ref)) {
          url = cacheMap.get(ref);
          copied++;
        } else {
          const rowLista = mapRef.get(ref);
          if (!rowLista) { currentRow++; skipped++; continue; }

          const imgVal = shLista.getRange(rowLista, COL_IMG_LISTA).getValue();
          if (imgVal && typeof imgVal.getContentUrl === "function") {
            try {
              const blob = UrlFetchApp.fetch(imgVal.getContentUrl())
                .getBlob().setName(safeName_(ref) + ".png");
              const file = folder.createFile(blob);
              file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
              url = "https://drive.google.com/uc?export=view&id=" + file.getId();
              cacheMap.set(ref, url);
              newCacheRows.push([ref, url]);
              created++;
            } catch (e) {
              console.log("❌ Error en ref:", ref, "|", e.message);
              currentRow++; continue;
            }
          } else { currentRow++; skipped++; continue; }
        }

        shMotor.getRange(currentRow, COL_FOTO_MOTOR).setValue(url);
        done++;
        currentRow++;
      }

      if (newCacheRows.length > 0) {
        const nextCacheRow = shCache.getLastRow() + 1;
        shCache.getRange(nextCacheRow, 1, newCacheRows.length, 2).setValues(newCacheRows);
      }

      props.setProperty("MOTOR_NEXT_ROW", String(currentRow));
      console.log(`✅ Lote | Procesadas: ${done} | Desde caché: ${copied} | Nuevas: ${created} | Saltadas: ${skipped} | Próxima fila: ${currentRow} / ${lastRowMotor}`);

    } catch (e) {
      const fecha = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy HH:mm");
      GmailApp.sendEmail(
        CONFIG.CORREO_DATA_SCIENCE,
        "❌ Fertrac — Error proceso de fotos " + fecha,
        "El proceso de fotos falló.\n\nFecha: " + fecha + "\nError: " + e.message + "\n\n— Fertrac Apps Script"
      );
      console.log("❌ Error en fotos:", e.message);
    }

  } finally {
    lock.releaseLock();
  }
}

function iniciarProceso() {
  eliminarTriggerFotos_();
  ScriptApp.newTrigger("poblarFotosBaseMotor").timeBased().everyMinutes(1).create();
  console.log("🚀 Trigger instalado. Corriendo cada minuto automáticamente.");
  poblarFotosBaseMotor();
}

function eliminarTriggerFotos_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "poblarFotosBaseMotor")
    .forEach(t => ScriptApp.deleteTrigger(t));
}


function safeName_(s) {
  return String(s).trim().replace(/[\\\/\?\%\*\:\|"<>]/g, "_").slice(0, 150);
}

function resetearContador() {
  PropertiesService.getScriptProperties().deleteProperty("MOTOR_NEXT_ROW");
  console.log("✅ Contador reseteado. Volverá a empezar desde fila 2.");
}


// Funciones para DEBUG 

function resetearProceso() {
  eliminarTriggerFotos_();
  PropertiesService.getScriptProperties().deleteProperty("MOTOR_NEXT_ROW");
  console.log("🔄 Reseteado. Ejecuta iniciarProceso() para empezar de nuevo.");
}

function pausarProceso() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "poblarFotosBaseMotor")
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log("⏸️ Trigger eliminado.");
}


function verificarSiAvanza() {
  const props = PropertiesService.getScriptProperties();
  console.log("Hora:", new Date().toLocaleString());
  console.log("Próxima fila a procesar:", props.getProperty("MOTOR_NEXT_ROW"));
  console.log("Triggers activos:", 
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === "poblarFotosBaseMotor").length
  );
  
  console.log("\n👉 Ve a Apps Script → Ejecuciones (icono reloj) y mira las últimas 5-10 ejecuciones");
}
