// ============================================================
// VALIDACIÓN — Detecta referencias duplicadas con datos
// distintos dentro de CLASIFICACION FINAL CATALOGO
//
// Script INDEPENDIENTE. Solo LECTURA — no escribe en
// CLASIFICACION FINAL CATALOGO ni en Hoja2. No requiere
// LockService (no compite por escritura con ningún otro proceso).
//
// Único punto de entrada: validarConflictosClasificacion()
//
// Úsalo DESPUÉS de pegar las referencias nuevas (de los 3 Excel)
// al final de CLASIFICACION FINAL CATALOGO, y ANTES de correr
// aplicarClasificacionManual(). Si detecta conflictos, resuélvelos
// manualmente en la hoja fuente antes de propagar a Hoja2.
// ============================================================

function validarConflictosClasificacion(filaInicioClasif) {

  const FILA_INICIO = filaInicioClasif || 2;

  const ss       = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const shClasif = ss.getSheetByName(CONFIG.SHEET_CLASIF);
  if (!shClasif) { console.log("⚠️ No existe la hoja CLASIFICACION FINAL CATALOGO — abortando"); return; }

  const lastRow = shClasif.getLastRow();
  if (lastRow < 2) { console.log("⚠️ CLASIFICACION vacía — abortando"); return; }

  // A: REFERENCIA | B: MARCA | C: CATEGORIA | D: SUBCATEGORIA | E: TIPO
  // const data = shClasif.getRange(2, 1, lastRow - 1, 5).getDisplayValues();

  if (lastRow < FILA_INICIO) {
    console.log(`⚠️ No hay filas desde la fila ${FILA_INICIO} — abortando`);
    return;
  }
  const numRows = lastRow - FILA_INICIO + 1;
  const data = shClasif.getRange(FILA_INICIO, 1, numRows, 5).getDisplayValues();

  // ── 1. Agrupar por REFERENCIA normalizada, guardando fila real de la hoja ──
  const grupos = new Map(); // key normalizada → [{fila, refOriginal, marca, categoria, subcategoria, tipo}]

  data.forEach((row, i) => {
    const refOriginal = row[0];
    const key = String(refOriginal || "").trim().toUpperCase();
    if (!key) return;
    // const filaReal = i + 2; // +2 porque data empieza en fila 2
    const filaReal = i + FILA_INICIO;

    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push({
      fila: filaReal,
      refOriginal,
      marca: row[1],
      categoria: row[2],
      subcategoria: row[3],
      tipo: row[4]
    });
  });

  // ── 2. Filtrar solo grupos con más de 1 fila (duplicados) ──
  const duplicados = [];
  grupos.forEach((filas, key) => { if (filas.length > 1) duplicados.push({ key, filas }); });

  if (duplicados.length === 0) {
    console.log("✅ Sin referencias duplicadas en CLASIFICACION FINAL CATALOGO. Nada que reportar.");
    _limpiarHojaConflictos_(ss, CONFIG.SHEET_CONFLICTOS);
    return;
  }

  // ── 3. Separar duplicados IDÉNTICOS (inofensivos) de duplicados EN CONFLICTO (datos distintos) ──
  const conflictos = [];
  let idénticosCount = 0;

  duplicados.forEach(({ key, filas }) => {
    const base = filas[0];
    const todasIguales = filas.every(f =>
      f.marca === base.marca &&
      f.categoria === base.categoria &&
      f.subcategoria === base.subcategoria &&
      f.tipo === base.tipo
    );
    if (todasIguales) {
      idénticosCount++;
    } else {
      conflictos.push({ key, filas });
    }
  });

  // ── 4. Regenerar hoja de reporte de conflictos ──
  let shReporte = ss.getSheetByName(CONFIG.SHEET_CONFLICTOS);
  if (!shReporte) {
    shReporte = ss.insertSheet(CONFIG.SHEET_CONFLICTOS);
  } else {
    shReporte.clearContents();
  }

  const headers = ["REFERENCIA FERTRAC", "FILA EN CLASIFICACION", "MARCA", "CATEGORIA", "SUBCATEGORIA", "TIPO DE PRODUCTO"];
  shReporte.getRange(1, 1, 1, headers.length).setValues([headers]);
  shReporte.getRange(1, 1, 1, headers.length).setFontWeight("bold");

  if (conflictos.length === 0) {
    console.log(`✅ ${idénticosCount} referencia(s) duplicada(s) pero con datos idénticos (inofensivo, no requiere acción). Sin conflictos reales.`);
    return;
  }

  const filasReporte = [];
  conflictos.forEach(({ filas }) => {
    filas.forEach(f => {
      filasReporte.push([f.refOriginal, f.fila, f.marca, f.categoria, f.subcategoria, f.tipo]);
    });
    filasReporte.push(["", "", "", "", "", ""]); // fila en blanco entre grupos, para lectura visual
  });

  shReporte.getRange(2, 1, filasReporte.length, headers.length).setValues(filasReporte);
  shReporte.autoResizeColumns(1, headers.length);

  console.log(`⛔ ${conflictos.length} referencia(s) con CONFLICTO REAL (datos distintos entre filas duplicadas) → revisar hoja "${CONFIG.SHEET_CONFLICTOS}"`);
  console.log(`ℹ️ Además, ${idénticosCount} duplicado(s) inofensivo(s) (mismos datos, no requieren acción).`);
  console.log("⚠️ RECOMENDACIÓN: resuelve los conflictos en CLASIFICACION FINAL CATALOGO antes de correr aplicarClasificacionManual().");
}

function _limpiarHojaConflictos_(ss, nombreHoja) {
  const sh = ss.getSheetByName(nombreHoja);
  if (sh) {
    sh.clearContents();
    sh.getRange(1, 1, 1, 1).setValue("Sin conflictos detectados en la última validación.");
  }
}

// ── Función temporal para ejecutar validarConflictosClasificacion desde una fila especifica ──
function ejecutar_validarConflictosClasificacion_desdeFilaEspecifica() {
  validarConflictosClasificacion(2);
}