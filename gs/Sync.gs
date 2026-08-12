// ============================================================
// SINCRONIZACIÓN — Precios, inventario, inactivas y correo
// Todos los IDs, hojas y columnas vienen de CONFIG (Config.gs).
// ============================================================

// ── Cada 5 min: solo precio e inventario + inactivas (NUNCA envía correo) ──
function sincronizarListaABaseMotor() {

  const ahora = new Date();
  const hora  = ahora.getHours();
  const dia   = ahora.getDay();

  const esLunesViernes = dia >= 1 && dia <= 5 && hora >= 7 && hora <= 19;
  const esSabado       = dia === 6 && hora >= 8 && hora < 13;

  if (!esLunesViernes && !esSabado) {
    console.log("⏸ Fuera de horario — omitiendo ejecución");
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log("🔒 Otra ejecución en curso — omitiendo");
    return;
  }

  try {
    ejecutarDiurna_();
  } finally {
    lock.releaseLock();
  }
}

// ── Actualización completa. ignorarHorario = true omite la validación
//    de horario laboral (se usa cuando se dispara por edición) ──
function sincronizacionCompleta(ignorarHorario) {

  const ahora = new Date();
  const hora  = ahora.getHours();
  const dia   = ahora.getDay();

  const esLunesViernes = dia >= 1 && dia <= 5 && hora >= 7 && hora < 19;
  const esSabado       = dia === 6 && hora >= 8 && hora < 13;

  if (!ignorarHorario && !esLunesViernes && !esSabado) {
    console.log("⏸ Fuera de horario — omitiendo ejecución");
    return;
  }

  const enviarCorreo = hora === 7 || hora === 12 || hora === 19;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log("🔒 Otra ejecución en curso — omitiendo");
    return;
  }

  try {
    ejecutarCompleta_(enviarCorreo);
  } catch (e) {
    if (enviarCorreo) {
      const fecha = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy HH:mm");
      GmailApp.sendEmail(
        CONFIG.CORREO_NOTIFICACION,
        "❌ Fertrac — Error sincronización completa " + fecha,
        "La sincronización completa falló.\n\nFecha: " + fecha + "\nError: " + e.message + "\n\n— Fertrac Apps Script"
      );
    }
    console.log("❌ Error:", e.message);
  } finally {
    lock.releaseLock();
  }
}

// ── 11:30pm: arranca proceso de fotos ──
function sincronizacionNocturnaFotos() {
  PropertiesService.getScriptProperties().deleteProperty("MOTOR_NEXT_ROW");

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "poblarFotosBaseMotor")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("poblarFotosBaseMotor")
    .timeBased().everyMinutes(1).create();

  console.log("🌙 Proceso nocturno de fotos iniciado");
  poblarFotosBaseMotor();
}

// ── Funciones de prueba ──
function probarDiurna() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log("🔒 Otra ejecución en curso — omitiendo");
    return;
  }
  try {
    ejecutarDiurna_();
  } finally {
    lock.releaseLock();
  }
}

function probarCompleta() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log("🔒 Otra ejecución en curso — omitiendo");
    return;
  }
  try {
    ejecutarCompleta_(true);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// MOTOR DIURNO — Solo precio, inv e inactivas
// ============================================================

function ejecutarDiurna_() {

  const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const ssLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS);
  const shMotor = ssMotor.getSheetByName(CONFIG.SHEET_MOTOR);
  const shLista = ssLista.getSheetByName(CONFIG.SHEET_LISTA);

  const { LISTA_DATA_ROW, LISTA_COL_REF, LISTA_COL_ALT, LISTA_COL_PROD, LISTA_COL_PRECIO, LISTA_COL_INV } = CONFIG;
  const { MOTOR_DATA_ROW, MOTOR_COL_REF, MOTOR_COL_PRECIO, MOTOR_COL_PROMO, MOTOR_COL_INV, MOTOR_TOTAL_COLS } = CONFIG;

  let shInactivas = ssMotor.getSheetByName(CONFIG.SHEET_INACTIVAS);
  if (!shInactivas) {
    shInactivas = ssMotor.insertSheet(CONFIG.SHEET_INACTIVAS);
    shInactivas.getRange(1, 1).setValue("REFERENCIA");
    shInactivas.getRange(1, 2).setValue("FECHA_INACTIVACION");
  }

  // ── Leer LISTA DE PRECIOS ──
  const lastRowLista   = shLista.getLastRow();
  const totalRowsLista = lastRowLista - LISTA_DATA_ROW + 1;
  if (totalRowsLista <= 0) return;

  const rangoLista   = shLista.getRange(LISTA_DATA_ROW, 1, totalRowsLista, 17);
  const dataLista    = rangoLista.getValues();
  const displayLista = rangoLista.getDisplayValues();

  const mapaLista = new Map();
  dataLista.forEach((row, i) => {
    const ref  = String(displayLista[i][LISTA_COL_REF  - 1] || "").trim().toUpperCase();
    const alt  = String(displayLista[i][LISTA_COL_ALT  - 1] || "").trim();
    const prod = String(displayLista[i][LISTA_COL_PROD - 1] || "").trim();
    if (!alt && !prod) return;
    if (!ref) return;
    mapaLista.set(ref, {
      precio: row[LISTA_COL_PRECIO - 1],
      inv:    row[LISTA_COL_INV - 1],
      neto5:  row[9],
      neto8:  row[10],
      promo:  displayLista[i][11]
    });
  });

  // ── Leer columna A de BASE MOTOR ──
  const lastRowMotor   = shMotor.getLastRow();
  const totalRowsMotor = lastRowMotor - MOTOR_DATA_ROW + 1;
  if (totalRowsMotor <= 0) return;

  const refsMotorValues  = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_REF, totalRowsMotor, 1).getValues();
  const refsMotorDisplay = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_REF, totalRowsMotor, 1).getDisplayValues();
  const mapaMotor = new Map();
  refsMotorValues.forEach(([ref], i) => {
    const key = String(refsMotorDisplay[i][0] || "").trim().toUpperCase();
    if (key && !mapaMotor.has(key)) mapaMotor.set(key, MOTOR_DATA_ROW + i);
  });

  // ── 1. Mover inactivas ──
  let inactivadas = 0;
  const filasAEliminar = [];
  mapaMotor.forEach((fila, ref) => {
    if (!mapaLista.has(ref)) {
      const filaData = shMotor.getRange(fila, 1, 1, MOTOR_TOTAL_COLS).getDisplayValues()[0];
      const nuevaFilaInactiva = shInactivas.getLastRow() + 1;
      shInactivas.getRange(nuevaFilaInactiva, 1, 1, MOTOR_TOTAL_COLS).setValues([filaData]);
      shInactivas.getRange(nuevaFilaInactiva, 23).setValue(new Date());
      filasAEliminar.push(fila);
      inactivadas++;
    }
  });
  filasAEliminar.sort((a, b) => b - a).forEach(fila => shMotor.deleteRow(fila));

  // ── Recargar después de eliminar ──
  const lastRowMotor2   = shMotor.getLastRow();
  const totalRowsMotor2 = lastRowMotor2 - MOTOR_DATA_ROW + 1;
  if (totalRowsMotor2 <= 0) {
    console.log(`✅ Sync DIURNA | Actualizadas: 0 | Inactivadas: ${inactivadas}`);
    return;
  }

  const refsMotor2 = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_REF, totalRowsMotor2, 1).getValues();
  const mapaMotor2 = new Map();
  refsMotor2.forEach(([ref], i) => {
    const key = String(ref || "").trim().toUpperCase();
    if (key && !mapaMotor2.has(key)) mapaMotor2.set(key, MOTOR_DATA_ROW + i);
  });

  // ── 2. Leer bloques UNA sola vez para diff en memoria ──
  const bloqueKN            = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_PRECIO, totalRowsMotor2, 4).getValues();
  const bloquePromoDisplay  = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_PROMO, totalRowsMotor2, 1).getDisplayValues();
  const bloqueS             = shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_INV, totalRowsMotor2, 1).getValues();

  let actualizadas = 0, sinCambios = 0;

  mapaLista.forEach(({ precio, inv, neto5, neto8, promo }, ref) => {
    if (!mapaMotor2.has(ref)) return;
    const filaReal = mapaMotor2.get(ref);
    const idx = filaReal - MOTOR_DATA_ROW;

    const actual = bloqueKN[idx];
    let cambio = false;

    if (String(actual[0]) !== String(precio)) { actual[0] = precio; cambio = true; }
    if (String(actual[1]) !== String(neto5))   { actual[1] = neto5;  cambio = true; }
    if (String(actual[2]) !== String(neto8))   { actual[2] = neto8;  cambio = true; }

    if (String(bloquePromoDisplay[idx][0]).trim() !== String(promo).trim()) {
      actual[3] = promo;
      cambio = true;
    }

    if (String(bloqueS[idx][0]) !== String(inv)) { bloqueS[idx][0] = inv; cambio = true; }

    if (cambio) {
      actualizadas++;
      // ═══ DIAGNÓSTICO TEMPORAL — quitar cuando se confirme estabilidad ═══
      console.log(`🔍 Cambio detectado en Ref: ${ref} (fila ${filaReal})`);
      // ═════════════════════════════════════════════════════════════════
    } else {
      sinCambios++;
    }
  });

  if (actualizadas > 0) {
    shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_PRECIO, totalRowsMotor2, 4).setValues(bloqueKN);
    shMotor.getRange(MOTOR_DATA_ROW, MOTOR_COL_INV, totalRowsMotor2, 1).setValues(bloqueS);
  }

  console.log(`✅ Sync DIURNA | Filas con cambio real: ${actualizadas} | Sin cambios: ${sinCambios} | Inactivadas: ${inactivadas}`);
}

// ============================================================
// MOTOR COMPLETO — Todas las columnas, solo actualiza diferencias
// (mantiene el orden actual de Hoja2; nuevas van al final)
// ============================================================

function ejecutarCompleta_(enviarCorreo) {

  const ssMotor = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  const ssLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS);
  const shMotor = ssMotor.getSheetByName(CONFIG.SHEET_MOTOR);
  const shLista = ssLista.getSheetByName(CONFIG.SHEET_LISTA);

  const { LISTA_DATA_ROW, LISTA_COL_REF, LISTA_COL_ALT, LISTA_COL_PROD, LISTA_COL_PRECIO, LISTA_COL_INV } = CONFIG;
  const { MOTOR_DATA_ROW, MOTOR_COL_REF, MOTOR_TOTAL_COLS } = CONFIG;

  // Columnas de Hoja2 (1-based) a sincronizar desde LISTA DE PRECIOS.
  // B (foto) e I (marca) se conservan y NUNCA se sobrescriben.
  const COLS_SYNC = [
    [2,  'alt'],       // C  - REF ALTERNAS
    [3,  'prod'],      // D  - PRODUCTO
    [7,  'linea'],     // H  - LINEA
    [10, 'precio'],    // K  - PRECIO BRUTO
    [11, 'neto5'],     // L  - NETO -5%
    [12, 'neto8'],     // M  - NETO -8%
    [13, 'promo'],     // N  - PRECIO PROMO (texto literal)
    [14, 'undEscala'], // O  - UND ESCALA
    [15, 'undMin'],    // P  - UND MIN VTA
    [16, 'undMax'],    // Q  - UND MAX VTA
    [17, 'promoFin'],  // R  - PROMO FINALIZA
    [18, 'inv'],       // S  - INV
    [19, 'undRm'],     // T  - UND RM
    [20, 'undRmc'],    // U  - UND RMC
    [21, 'condicion']  // V  - CONDICION
  ];

  let shInactivas = ssMotor.getSheetByName(CONFIG.SHEET_INACTIVAS);
  if (!shInactivas) {
    shInactivas = ssMotor.insertSheet(CONFIG.SHEET_INACTIVAS);
    shInactivas.getRange(1, 1).setValue("REFERENCIA");
    shInactivas.getRange(1, 2).setValue("FECHA_INACTIVACION");
  }

  // ── 1. Leer LISTA DE PRECIOS ──
  const lastRowLista   = shLista.getLastRow();
  const totalRowsLista = lastRowLista - LISTA_DATA_ROW + 1;
  if (totalRowsLista <= 0) { console.log("⚠️ No hay datos en LISTA DE PRECIOS"); return; }

  const rangoLista   = shLista.getRange(LISTA_DATA_ROW, 1, totalRowsLista, 21);
  const dataLista    = rangoLista.getValues();
  const displayLista = rangoLista.getDisplayValues();

  const refsOrdenadas = [];
  const mapaLista = new Map();
  dataLista.forEach((row, i) => {
    const ref  = String(displayLista[i][LISTA_COL_REF  - 1] || "").trim().toUpperCase();
    const alt  = String(displayLista[i][LISTA_COL_ALT  - 1] || "").trim();
    const prod = String(displayLista[i][LISTA_COL_PROD - 1] || "").trim();
    if (!alt && !prod) return;
    if (!ref) return;
    if (!mapaLista.has(ref)) {
      refsOrdenadas.push(ref);
      mapaLista.set(ref, {
        precio:    row[LISTA_COL_PRECIO - 1],
        inv:       row[LISTA_COL_INV - 1],
        alt:       row[4],
        prod:      row[5],
        linea:     row[20],
        marca:     row[7],
        neto5:     row[9],
        neto8:     row[10],
        promo:     displayLista[i][11],   // L de LISTA → texto literal
        undEscala: row[12],
        undMin:    row[13],
        undMax:    row[14],
        promoFin:  row[15],
        undRm:     row[17],
        undRmc:    row[18],
        condicion: row[19],
        foto:      String(row[1] || "").trim().toUpperCase() === "NO" ? "" : row[1]
      });
    }
  });

  if (mapaLista.size === 0) { console.log("⚠️ Sin referencias válidas en LISTA DE PRECIOS"); return; }

  // ── 2. Leer BASE MOTOR completo ──
  const lastRowMotor   = shMotor.getLastRow();
  const totalRowsMotor = lastRowMotor - MOTOR_DATA_ROW + 1;
  if (totalRowsMotor <= 0) { console.log("⚠️ No hay datos en BASE MOTOR"); return; }

  const dataMotor = shMotor.getRange(MOTOR_DATA_ROW, 1, totalRowsMotor, MOTOR_TOTAL_COLS).getValues();
  const mapaMotor = new Map();
  dataMotor.forEach((row, i) => {
    const key = String(row[MOTOR_COL_REF - 1] || "").trim().toUpperCase();
    if (key && !mapaMotor.has(key)) mapaMotor.set(key, { filaReal: MOTOR_DATA_ROW + i, row });
  });

  // ── 3. Inactivas: mover a INACTIVAS y borrar de Hoja2 ──
  const refsInactivas = [];
  mapaMotor.forEach(({ filaReal, row }, ref) => {
    if (!mapaLista.has(ref)) {
      const nuevaFilaInactiva = shInactivas.getLastRow() + 1;
      shInactivas.getRange(nuevaFilaInactiva, 1, 1, MOTOR_TOTAL_COLS).setValues([row]);
      shInactivas.getRange(nuevaFilaInactiva, 23).setValue(new Date());
      refsInactivas.push({ ref, filaReal });
    }
  });
  refsInactivas.sort((a, b) => b.filaReal - a.filaReal)
    .forEach(entry => shMotor.deleteRow(entry.filaReal));
  const inactivadas = refsInactivas.length;

  // ── 4. Recargar Hoja2 tras borrar inactivas ──
  const lastRowMotor2   = shMotor.getLastRow();
  const totalRowsMotor2 = lastRowMotor2 - MOTOR_DATA_ROW + 1;

  let mapaMotor2 = new Map();
  if (totalRowsMotor2 > 0) {
    const dataMotor2 = shMotor.getRange(MOTOR_DATA_ROW, 1, totalRowsMotor2, MOTOR_TOTAL_COLS).getValues();
    dataMotor2.forEach((row, i) => {
      const key = String(row[MOTOR_COL_REF - 1] || "").trim().toUpperCase();
      if (key && !mapaMotor2.has(key)) mapaMotor2.set(key, { filaReal: MOTOR_DATA_ROW + i, row });
    });
  }

  // ── 5. Comparar diferencias y actualizar solo las celdas que cambian ──
  let actualizadas = 0;
  const refsActualizadas = [];
  const actualizaciones = [];

  mapaLista.forEach((datos, ref) => {
    if (!mapaMotor2.has(ref)) return;
    const { filaReal, row } = mapaMotor2.get(ref);
    let cambio = false;
    COLS_SYNC.forEach(([col, campo]) => {
      const valor = datos[campo];
      if (String(row[col - 1]) !== String(valor)) {
        actualizaciones.push({ filaReal, col, valor });
        cambio = true;
      }
    });
    if (cambio) { actualizadas++; refsActualizadas.push(ref); }
  });

  if (actualizaciones.length > 0) {
    actualizaciones.forEach(up => shMotor.getRange(up.filaReal, up.col).setValue(up.valor));
  }

  // ── 6. Nuevas referencias al final de Hoja2 ──
  const refsNuevas = [];
  const nuevasFilas = [];
  refsOrdenadas.forEach(ref => {
    if (mapaMotor2.has(ref)) return;
    const datos = mapaLista.get(ref);
    const filaVacia = new Array(MOTOR_TOTAL_COLS).fill("");
    filaVacia[0]  = ref;
    filaVacia[1]  = datos.foto;
    filaVacia[2]  = datos.alt;
    filaVacia[3]  = datos.prod;
    filaVacia[4]  = 0;
    filaVacia[5]  = 0;
    filaVacia[6]  = 0;
    filaVacia[7]  = datos.linea || 0;
    filaVacia[8]  = datos.marca || 0;
    filaVacia[9]  = 0;
    filaVacia[10] = datos.precio;
    filaVacia[11] = datos.neto5;
    filaVacia[12] = datos.neto8;
    filaVacia[13] = datos.promo;
    filaVacia[14] = datos.undEscala;
    filaVacia[15] = datos.undMin;
    filaVacia[16] = datos.undMax;
    filaVacia[17] = datos.promoFin;
    filaVacia[18] = datos.inv;
    filaVacia[19] = datos.undRm || 0;
    filaVacia[20] = datos.undRmc || 0;
    filaVacia[21] = String(datos.condicion || "").trim() ? datos.condicion : "NO TIENE";
    nuevasFilas.push(filaVacia);
    refsNuevas.push(ref);
  });

  if (nuevasFilas.length > 0) {
    shMotor.getRange(lastRowMotor2 + 1, 1, nuevasFilas.length, MOTOR_TOTAL_COLS).setValues(nuevasFilas);
  }
  const nuevas = refsNuevas.length;

  console.log(`✅ Sync COMPLETA | Actualizadas: ${actualizadas} | Nuevas: ${nuevas} | Inactivadas: ${inactivadas}`);
  if (refsActualizadas.length > 0) console.log("🔍 Referencias actualizadas:", refsActualizadas.join(", "));

  // ── 7. Correo ──
  if (enviarCorreo && (actualizadas > 0 || nuevas > 0 || inactivadas > 0)) {
    const fecha  = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy HH:mm");
    const asunto = `Fertrac — Sincronización completa ${fecha}`;
    const cuerpo = `
    Resumen de sincronización completa — ${fecha}

    ✅ Referencias actualizadas: ${actualizadas}
    Referencias nuevas: ${nuevas}
    Referencias inactivadas: ${inactivadas}
    ${refsNuevas.length    > 0 ? "\nNuevas referencias:\n"      + refsNuevas.join("\n")                : ""}
    ${refsInactivas.length > 0 ? "\nReferencias inactivadas:\n" + refsInactivas.map(e => e.ref).join("\n") : ""}

    — Fertrac Apps Script
        `.trim();
        GmailApp.sendEmail(CONFIG.CORREO_NOTIFICACION, asunto, cuerpo);
        console.log("📧 Correo enviado a:", CONFIG.CORREO_NOTIFICACION);
      }
    }

// ============================================================
// SYNC COMPLETA — Correr a demanda (una sola vez)
// Hoja2 conserva su orden actual; solo aplica diferencias.
// ============================================================

function reordenarBaseMotor() {
  console.log("🔄 Ejecutando sync completa sobre BASE MOTOR...");
  ejecutarCompleta_(false);
  console.log("✅ Sync completa finalizada — Hoja2 conserva su orden actual");
}

// ============================================================
// DEBUG
// ============================================================

function contarDuplicadosLista() {
  const shLista = SpreadsheetApp.openById(CONFIG.ID_LISTA_PRECIOS).getSheetByName(CONFIG.SHEET_LISTA);
  const lastRow = shLista.getLastRow();
  const totalRows = lastRow - CONFIG.LISTA_DATA_ROW + 1;
  const display = shLista.getRange(CONFIG.LISTA_DATA_ROW, 1, totalRows, 6).getDisplayValues();

  const vistas = new Set();
  let duplicados = 0;

  display.forEach(row => {
    const ref  = String(row[CONFIG.LISTA_COL_REF - 1] || "").trim().toUpperCase();
    const alt  = String(row[CONFIG.LISTA_COL_ALT - 1] || "").trim();
    const prod = String(row[CONFIG.LISTA_COL_PROD - 1] || "").trim();
    if (!alt && !prod) return;
    if (!ref) return;
    if (vistas.has(ref)) {
      duplicados++;
    } else {
      vistas.add(ref);
    }
  });

  console.log(`Referencias únicas: ${vistas.size}`);
  console.log(`Referencias duplicadas: ${duplicados}`);
}
