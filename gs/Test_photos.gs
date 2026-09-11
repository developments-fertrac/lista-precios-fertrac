/**
 * Elimina POR COMPLETO de CACHE (fila entera) la foto cuya imagen en Drive sea
 * un "Blob"/placeholder o pese < 100 KB (corrupta), y borra el archivo de
 * Drive (papelera). Deja registro en BITACORA_FOTOS con Resultado "OK" y
 * detalle "Imagen eliminada".
 *
 * Si la imagen en Drive es válida (no Blob / ≥ 100 KB) marca ERROR=200 para
 * que los procesos de retoma no la vuelvan a tocar, y registra "Imagen No Blob".
 *
 * Solo evalúa filas CON FOTO_URL_DRIVE y con ERROR vacío (""). Las que tienen
 * ERROR=1/200 o no tienen URL de Drive se saltan (pendientes de descarga).
 *
 * RÁPIDO: usa metadatos (getSize) en un único recorrido de FOLDER_ID y NO
 * descarga el contenido de los archivos, por lo que corre en minutos aunque
 * haya miles de registros.
 */
function limpiarFotosMenoresA100KB() {
  const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const shCache = ssMotor.getSheetByName(CONFIG.SHEET_CACHE);
  if (!shCache) { console.log("⚠️ No existe la hoja CACHE"); return; }

  const lastRow = shCache.getLastRow();
  if (lastRow < 2) { console.log("📭 CACHE vacía"); return; }

  const data = shCache.getRange(2, 1, lastRow - 1, CACHE_TOTAL_COLS).getValues();
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);

  // ── Índice de la carpeta (una sola pasada, sin descargar bytes) ──
  const porId = new Map();   // fileId → { size, name }
  const porRef = new Map();  // REF (upper) → [{ id, size, name }]  fotos por referencia
  const itF = folder.getFiles();
  while (itF.hasNext()) {
    const f = itF.next();
    const id = f.getId();
    const name = f.getName();
    let size = 0;
    try { size = f.getSize(); } catch (e) { continue; }   // sin acceso → omitir
    porId.set(id, { size: size, name: name });

    // Clave de referencia a partir del nombre: "REF.webp", "REF (1).webp", ...
    const base = name.replace(/\.webp$/i, "").replace(/\s*\(?\d*\)?\s*$/i, "").trim().toUpperCase();
    if (base) {
      if (!porRef.has(base)) porRef.set(base, []);
      porRef.get(base).push({ id: id, size: size, name: name });
    }
  }

  function extraerFileId(urlDrive) {
    const m1 = urlDrive.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) return m1[1];
    const m2 = urlDrive.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m2 ? m2[1] : null;
  }

  const filasEliminar = [];    // filas reales (1-based) a borrar de CACHE
  const idsBorrar = [];        // archivos de Drive a mandar a papelera
  const refsEliminadas = new Set();

  let evaluadas = 0;
  let sinDrive = 0;
  let conError = 0;
  let ok = 0;
  let eliminadas = 0;

  for (let i = 0; i < data.length; i++) {
    const ref = String(data[i][CACHE_COL_REF - 1] || "").trim();
    const urlDrive = String(data[i][CACHE_COL_URL_DRIVE - 1] || "").trim();
    const conErr = String(data[i][CACHE_COL_ERROR - 1] || "").trim();
    const filaReal = i + 2;

    if (!urlDrive) { sinDrive++; continue; }        // pendiente de descarga → no evaluar
    if (conErr !== "") { conError++; continue; }    // ERROR=1/200 → no evaluar
    evaluadas++;

    const fileId = extraerFileId(urlDrive);
    const meta = fileId ? porId.get(fileId) : null;

    if (!meta) {
      // Archivo no existe / no accesible / URL inválida → eliminar registro e imagen
      if (fileId) idsBorrar.push(fileId);
      filasEliminar.push(filaReal);
      if (ref) refsEliminadas.add(ref);
      eliminadas++;
      _registrarBitacoraFotos_(ref || fileId, "OK", "Imagen eliminada", "1");
      console.log("🚫 " + (ref || fileId) + " — archivo no encontrado, registro eliminado");
      continue;
    }

    if (meta.size < 100 * 1024) {
      // Blob / placeholder / <100 KB → eliminar REGISTRO + IMAGEN completa
      idsBorrar.push(fileId);
      filasEliminar.push(filaReal);
      if (ref) refsEliminadas.add(ref);
      eliminadas++;
      _registrarBitacoraFotos_(ref, "OK", "Imagen eliminada", "1");
      console.log("🧹 " + ref + " — " + (meta.size / 1024).toFixed(1) + " KB (<100): imagen y registro eliminados");
    } else {
      // Imagen válida (no Blob / ≥ 100 KB) → marcar 200 para que los procesos
      // de retoma (procesarPendientesDrive, descargarFotosWebp, etc.) la omitan.
      shCache.getRange(filaReal, CACHE_COL_ERROR).setValue(200);
      _registrarBitacoraFotos_(ref, "OK", "Imagen No Blob", "1");
      ok++;
      console.log("✅ " + ref + " — imagen válida (" + (meta.size / 1024).toFixed(1) + " KB), marcada 200");
    }
  }

  // ── Fotos adicionales de las referencias eliminadas que no cumplan la condición ──
  let extras = 0;
  for (const refKey of refsEliminadas) {
    const grupo = porRef.get(refKey.toUpperCase());
    if (!grupo) continue;
    for (const item of grupo) {
      if (idsBorrar.indexOf(item.id) !== -1) continue;   // ya marcado
      if (item.size < 100 * 1024) {
        idsBorrar.push(item.id);
        extras++;
        _registrarBitacoraFotos_(refKey, "OK", "Imagen eliminada", "extra");
        console.log("🧹 EXTRA " + refKey + " — " + item.name + " eliminada");
      }
    }
  }

  // ── Mandar a papelera los archivos de Drive ──
  let borrados = 0;
  let falloBorrado = 0;
  for (const id of idsBorrar) {
    try { DriveApp.getFileById(id).setTrashed(true); borrados++; } catch (e) { falloBorrado++; }
  }

  // ── Borrar filas de CACHE (de abajo hacia arriba → índices estables) ──
  filasEliminar.sort((a, b) => b - a);
  for (const fila of filasEliminar) shCache.deleteRow(fila);

  console.log("✅ FIN | Evaluadas: " + evaluadas +
              " | Eliminadas: " + eliminadas +
              " | extras Drive: " + extras +
              " | borrados Drive: " + borrados +
              " | fallo borrado: " + falloBorrado +
              " | OK (>100KB): " + ok +
              " | sin Drive (pendientes): " + sinDrive +
              " | con ERROR (no evaluadas): " + conError);
  return "evaluadas=" + evaluadas + " eliminadas=" + eliminadas + " borradas=" + borrados;
}