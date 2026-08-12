// ============================================================
// REPORTE — Referencias en CLASIFICACION FINAL CATALOGO
// sin match en Hoja2
//
// Script INDEPENDIENTE. Solo LECTURA sobre CLASIFICACION FINAL
// CATALOGO y Hoja2 (col A) — no escribe en ninguna de las dos,
// por lo que NO requiere LockService.
//
// generarReportePendientes(filaInicioClasif)
//   Sin parámetro → revisa TODO el catálogo (default, fila 2).
//   Con parámetro → revisa solo desde esa fila en adelante
//     (ej. 479 para reportar solo las referencias nuevas).
//
// Resultado: regenera por completo la hoja "PENDIENTES SIN HOJA2".
// ============================================================

function generarReportePendientes(filaInicioClasif) {

  const FILA_INICIO_CLASIF = filaInicioClasif || 2;

  const MOTOR_DATA_ROW = CONFIG.MOTOR_DATA_ROW;
  const MOTOR_COL_REF  = CONFIG.MOTOR_COL_REF;   // A

  const ss       = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const shMotor  = ss.getSheetByName(CONFIG.SHEET_MOTOR);
  const shClasif = ss.getSheetByName(CONFIG.SHEET_CLASIF);

  if (!shMotor)  { console.log("⚠️ No existe la hoja Hoja2 — abortando"); return; }
  if (!shClasif) { console.log("⚠️ No existe la hoja CLASIFICACION FINAL CATALOGO — abortando"); return; }

  // ── 1. Leer CLASIFICACION desde FILA_INICIO_CLASIF → Map ──
  const lastRowClasif = shClasif.getLastRow();
  if (lastRowClasif < FILA_INICIO_CLASIF) {
    console.log(`⚠️ No hay filas desde la fila ${FILA_INICIO_CLASIF} en CLASIFICACION — abortando`);
    return;
  }

  const numRowsClasif = lastRowClasif - FILA_INICIO_CLASIF + 1;
  const clasifData = shClasif.getRange(FILA_INICIO_CLASIF, 1, numRowsClasif, 5).getDisplayValues();
  const mapaClasif = new Map();
  clasifData.forEach(row => {
    const ref = String(row[0] || "").trim().toUpperCase();
    if (!ref) return;
    mapaClasif.set(ref, {
      refOriginal:  row[0],
      marca:        row[1],
      categoria:    row[2],
      subcategoria: row[3],
      tipo:         row[4]
    });
  });

  if (mapaClasif.size === 0) { console.log("⚠️ Sin referencias válidas en el rango indicado — abortando"); return; }

  console.log(`ℹ️ Revisando CLASIFICACION desde fila ${FILA_INICIO_CLASIF} hasta ${lastRowClasif} → ${mapaClasif.size} referencia(s).`);

  // ── 2. Leer solo columna A de Hoja2 (referencias existentes) ──
  const lastRowMotor   = shMotor.getLastRow();
  const totalRowsMotor = lastRowMotor - MOTOR_DATA_ROW + 1;
  if (totalRowsMotor <= 0) { console.log("⚠️ Hoja2 vacía — abortando"); return; }

  const refsMotor = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_REF, totalRowsMotor, 1).getDisplayValues();
  const refsMotorSet = new Set(
    refsMotor.map(([ref]) => String(ref || "").trim().toUpperCase()).filter(Boolean)
  );

  // ── 3. Detectar referencias de CLASIFICACION sin match en Hoja2 ──
  const sinMatchKeys = [];
  mapaClasif.forEach((_, ref) => { if (!refsMotorSet.has(ref)) sinMatchKeys.push(ref); });

  // ── 4. Regenerar hoja de reporte ──
  let shReporte = ss.getSheetByName(CONFIG.SHEET_PENDIENTES);
  if (!shReporte) {
    shReporte = ss.insertSheet(CONFIG.SHEET_PENDIENTES);
  } else {
    shReporte.clearContents();
  }

  const headers = ["REFERENCIA FERTRAC", "MARCA", "CATEGORIA", "SUBCATEGORIA", "TIPO DE PRODUCTO", "FECHA DETECCIÓN"];
  shReporte.getRange(1, 1, 1, headers.length).setValues([headers]);
  shReporte.getRange(1, 1, 1, headers.length).setFontWeight("bold");

  if (sinMatchKeys.length === 0) {
    console.log(`✅ Sin pendientes. Todas las referencias del rango existen en Hoja2. "${CONFIG.SHEET_PENDIENTES}" dejada solo con encabezados.`);
    return;
  }

  const ahora = new Date();
  const filas = sinMatchKeys.map(key => {
    const c = mapaClasif.get(key);
    return [c.refOriginal, c.marca, c.categoria, c.subcategoria, c.tipo, ahora];
  });

  shReporte.getRange(2, 1, filas.length, headers.length).setValues(filas);
  shReporte.autoResizeColumns(1, headers.length);

  console.log(`📝 "${CONFIG.SHEET_PENDIENTES}" actualizada | ${filas.length} referencia(s) sin match en Hoja2 | Refs revisadas: ${mapaClasif.size} | Total refs en Hoja2: ${refsMotorSet.size}`);
}

// ── Función temporal para ejecutar el reporte solo desde una fila especifica ──
function ejecutar_generarReportePendientes_desdeFilaEspecifica() {
  generarReportePendientes(2);
}