// ============================================================
// CONFIG — Constantes centrales del proyecto
// Todos los módulos Apps Script leen de aquí.
// NO hardcodear IDs, hojas, columnas ni correos en los módulos.
// ============================================================

const CONFIG = {

  // ── Spreadsheets ──
  ID_BASE_MOTOR:    "14r84ELwmkS5CDWM5dig9ceo9vVs7elKBsSK_SMtFEBs",
  ID_LISTA_PRECIOS: "1oR30UtG0ZBqOzc8_lXN2XmFz6V32S9hvpI5xh1sHGps",

  // ── Nombres de hojas ──
  SHEET_MOTOR:      "Hoja2",
  SHEET_LISTA:      "LISTA DE PRECIOS",
  SHEET_INACTIVAS:  "INACTIVAS",
  SHEET_CACHE:      "CACHE",
  SHEET_USERS:      "USUARIOS AUTORIZADOS",
  SHEET_CLASIF:     "CLASIFICACION FINAL CATALOGO",
  SHEET_CONFLICTOS: "CONFLICTOS CLASIFICACION",
  SHEET_PENDIENTES: "PENDIENTES SIN HOJA2",

  // ── LISTA DE PRECIOS (origen) ──
  LISTA_DATA_ROW:   12,
  LISTA_COL_REF:    4,
  LISTA_COL_ALT:    5,
  LISTA_COL_PROD:   6,
  LISTA_COL_PRECIO: 9,
  LISTA_COL_INV:    17,
  LISTA_COL_IMG:    3,

  // ── BASE MOTOR (destino) ──
  MOTOR_DATA_ROW:   2,
  MOTOR_COL_REF:    1,
  MOTOR_COL_FOTO:   2,
  MOTOR_COL_PRECIO: 11,
  MOTOR_COL_PROMO:  14,
  MOTOR_COL_INV:    19,
  MOTOR_TOTAL_COLS: 25,

  // ── Proceso de fotos ──
  FOLDER_ID:         "1V2msCWZvWPOb7xPwh6Sd3MG75A1hhlQe",
  FOTOS_MAX_MS:      240000,
  FOTOS_CONV_WEBP:   "https://wsrv.nl/?url={URL}&output=webp&q=80",
  FOTOS_CONV_WEBP_POST: "https://wsrv.nl/?output=webp&q=80",
  FOTOS_MIN_KB:      10,   // tamaño mínimo del webp descargado (rechaza placeholders/4KB)
  SHEET_BITACORA_FOTOS: "BITACORA_FOTOS",

  // ── Acceso / API ──
  ACCESS_KEY:        "fertrac2024",

  // ── Correos ──
  CORREO_NOTIFICACION: "ctorres@fertrac.com",
  CORREO_DATA_SCIENCE: "data_science@fertrac.com"


};
