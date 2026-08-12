// ============================================================
// CLASIFICACIÓN MANUAL — A DEMANDA (NO automática)
// Aplica MARCA, CATEGORIA, SUBCATEGORIA y TIPO DE PRODUCTO
// desde "CLASIFICACION FINAL CATALOGO" sobre Hoja2, cruzando por REFERENCIA.
//
// ⚠️ DEBE vivir en el MISMO proyecto Apps Script que la sync
//    (fotos_lista_de_precios) para que comparta el LockService y
//    NUNCA escriba Hoja2 al mismo tiempo que la sincronización.
//
// Dos puntos de entrada:
//   • simularClasificacion()       → DRY-RUN: no escribe, solo reporta en el log.
//   • aplicarClasificacionManual() → Escribe de verdad.
//
// Contrato de columnas en CLASIFICACION FINAL CATALOGO:
//   A: REFERENCIA FERTRAC | B: MARCA | C: CATEGORIA
//   D: SUBCATEGORIA       | E: TIPO DE PRODUCTO  (header fila 1, datos desde 2)
//
// Columnas destino en Hoja2: E=CATEGORIA, F=SUBCATEGORIA,
//   G=TIPO DE PRODUCTO, I=MARCA  (H=LINEA NUNCA se toca).
//
// Referencias con CONFLICTO REAL (detectadas por validarConflictosClasificacion()
// y listadas en la hoja CONFLICTOS CLASIFICACION) se excluyen automáticamente
// de la escritura — quedan intactas en Hoja2 hasta resolverse en la fuente.
// Precondición operativa: correr validarConflictosClasificacion() ANTES de
// aplicarClasificacionManual() para que esta exclusión refleje el estado actual.
// ============================================================

// ── DRY-RUN: no escribe nada, solo reporta qué haría ──
function simularClasificacion(filaInicioClasif) {
  _ejecutarClasificacionConLock_(true, filaInicioClasif);
}

// ── REAL: escribe E, F, G, I en Hoja2 ──
function aplicarClasificacionManual(filaInicioClasif) {
  _ejecutarClasificacionConLock_(false, filaInicioClasif);
}

function _ejecutarClasificacionConLock_(simular, filaInicioClasif) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log("🔒 Otra ejecución en curso — omitiendo");
    return;
  }
  try {
    aplicarClasificacion_(simular, filaInicioClasif);
  } finally {
    lock.releaseLock();
  }
}

// ── Lee las referencias en conflicto real desde CONFLICTOS CLASIFICACION
//    (generada por validarConflictosClasificacion()). Se excluyen de la
//    escritura hasta que desaparezcan de esa hoja al resolverse. ──
function _obtenerReferenciasEnConflicto_(ss) {
  const shConflictos = ss.getSheetByName(CONFIG.SHEET_CONFLICTOS);
  const excluidas = new Set();

  if (!shConflictos) {
    console.log("ℹ️ No existe CONFLICTOS CLASIFICACION — no se omite ninguna referencia.");
    return excluidas;
  }

  const lastRow = shConflictos.getLastRow();
  if (lastRow < 2) return excluidas; // solo header, o vacía/limpia

  const refs = shConflictos.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  refs.forEach(([ref]) => {
    const key = String(ref || "").trim().toUpperCase();
    if (key) excluidas.add(key);
  });

  return excluidas;
}

// **La función que realmente hace la CLASIFICACION y usa las demás funciones
function aplicarClasificacion_(simular, filaInicioClasif) {

  const ETIQUETA = simular ? "[SIMULACIÓN] " : "";

  const MOTOR_DATA_ROW = CONFIG.MOTOR_DATA_ROW;
  const MOTOR_COL_REF  = CONFIG.MOTOR_COL_REF;   // A

  // Bloque E:I en Hoja2 (cols 5..9, ancho 5): [E, F, G, H, I]
  const COL_BLOQUE_INI = 5;   // E
  const ANCHO_BLOQUE   = 5;   // hasta I

  const ss       = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const shMotor  = ss.getSheetByName(CONFIG.SHEET_MOTOR);
  const shClasif = ss.getSheetByName(CONFIG.SHEET_CLASIF);

  if (!shMotor)  { console.log("⚠️ No existe la hoja Hoja2 — abortando"); return; }
  if (!shClasif) { console.log("⚠️ No existe la hoja CLASIFICACION FINAL CATALOGO — abortando"); return; }

  const REFERENCIAS_EXCLUIDAS = _obtenerReferenciasEnConflicto_(ss);
  if (REFERENCIAS_EXCLUIDAS.size > 0) {
    console.log(`ℹ️ ${REFERENCIAS_EXCLUIDAS.size} referencia(s) en conflicto cargadas desde CONFLICTOS CLASIFICACION — se omitirán.`);
  }

  // ── 1. Leer CLASIFICACION → Map (misma normalización que la sync) ──
  const FILA_INICIO_CLASIF = filaInicioClasif || 2;
  const lastRowClasif = shClasif.getLastRow();
  if (lastRowClasif < FILA_INICIO_CLASIF) { console.log(`⚠️ No hay filas desde la fila ${FILA_INICIO_CLASIF} en CLASIFICACION — abortando`); return; }

  const numRowsClasif = lastRowClasif - FILA_INICIO_CLASIF + 1;
  const clasifData = shClasif.getRange(FILA_INICIO_CLASIF, 1, numRowsClasif, 5).getDisplayValues();

  const mapaClasif = new Map();
  clasifData.forEach(row => {
    const ref = String(row[0] || "").trim().toUpperCase();
    if (!ref) return;
    mapaClasif.set(ref, {
      marca:        row[1],
      categoria:    row[2],
      subcategoria: row[3],
      tipo:         row[4]
    });
  });

  if (mapaClasif.size === 0) { console.log("⚠️ Sin referencias válidas en CLASIFICACION — abortando"); return; }

  // ── 2. Leer Hoja2: columna A (refs) + bloque E:I ──
  const lastRowMotor   = shMotor.getLastRow();
  const totalRowsMotor = lastRowMotor - MOTOR_DATA_ROW + 1;
  if (totalRowsMotor <= 0) { console.log("⚠️ Hoja2 vacía — abortando"); return; }

  const refs   = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_REF, totalRowsMotor, 1).getDisplayValues();
  const bloque = shMotor.getRange(MOTOR_DATA_ROW, COL_BLOQUE_INI, totalRowsMotor, ANCHO_BLOQUE).getValues();
  // bloque[i] = [E, F, G, H, I] → índices 0,1,2,3,4

  // Salidas inicializadas con los valores ACTUALES (filas sin match quedan intactas).
  const salidaEFG = bloque.map(r => [r[0], r[1], r[2]]);  // E, F, G
  const salidaI   = bloque.map(r => [r[4]]);              // I

  // ── 3. Aplicar clasificación en memoria ──
  let aplicadas = 0;
  let excluidas = 0;
  const aplicadasSet = new Set();
  const excluidasEncontradas = new Set();

  refs.forEach(([ref], i) => {
    const key = String(ref || "").trim().toUpperCase();

    if (REFERENCIAS_EXCLUIDAS.has(key)) {
      excluidas++;
      excluidasEncontradas.add(key);
      return;                                  // conflicto real sin resolver → fila intacta
    }

    const clas = mapaClasif.get(key);
    if (!clas) return;                         // sin match → fila intacta

    salidaEFG[i][0] = clas.categoria;        // E
    salidaEFG[i][1] = clas.subcategoria;     // F
    salidaEFG[i][2] = clas.tipo;             // G
    salidaI[i][0]   = clas.marca;            // I
    aplicadas++;
    aplicadasSet.add(key);
  });

  // ── 3b. Guarda de seguridad de dimensiones (defensivo) ──
  if (salidaEFG.length !== totalRowsMotor || salidaI.length !== totalRowsMotor) {
    console.log("⛔ Discrepancia de dimensiones — abortando SIN escribir");
    return;
  }

  // ── 4. Escribir (solo en modo real). Dos writes; H jamás se incluye ──
  if (!simular) {
    shMotor.getRange(MOTOR_DATA_ROW, COL_BLOQUE_INI, totalRowsMotor, 3).setValues(salidaEFG); // E:G
    shMotor.getRange(MOTOR_DATA_ROW, 9, totalRowsMotor, 1).setValues(salidaI);                // I
  }

  // ── 5. Reporte ──
  const sinMatch = [];
  mapaClasif.forEach((_, ref) => {
    if (REFERENCIAS_EXCLUIDAS.has(ref)) return;
    if (!aplicadasSet.has(ref)) sinMatch.push(ref);
  });

  console.log(`✅ ${ETIQUETA}Clasificación | Filas Hoja2 ${simular ? "que se actualizarían" : "actualizadas"}: ${aplicadas} | Refs en CLASIFICACION: ${mapaClasif.size} | Filas Hoja2 leídas: ${totalRowsMotor}`);
  if (excluidas > 0) {
    console.log(`⏭️ ${ETIQUETA}${excluidas} fila(s) de Hoja2 OMITIDAS por conflicto real sin resolver: ${Array.from(excluidasEncontradas).join(", ")}`);
  }
  if (sinMatch.length > 0) {
    console.log(`⚠️ ${ETIQUETA}${sinMatch.length} referencias de CLASIFICACION NO existen en Hoja2 (revisar formato):`);
    console.log(sinMatch.join("\n"));
  }
  if (simular) {
    console.log("ℹ️ MODO SIMULACIÓN: no se escribió nada en Hoja2.");
  }
}

// ── Función temporal solo para ejecutar desde el editor con una fila especifica ──
function ejecutar_simularClasificacion_desdeFilaEspecifica() {
  simularClasificacion(2);
}

// ── Función temporal para ejecutar ClasificacionManual solo desde una fila especifica ──
function ejecutar_aplicarClasificacionManual_desdeFilaEspecifica() {
  aplicarClasificacionManual(2);
}

// ── TEST: valida que la exclusión lee correctamente desde CONFLICTOS CLASIFICACION ──
function test_obtenerReferenciasEnConflicto() {
  const ss = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const excluidas = _obtenerReferenciasEnConflicto_(ss);

  console.log(`Total referencias excluidas: ${excluidas.size}`);
  console.log(`Lista: ${Array.from(excluidas).sort().join(", ")}`);
}