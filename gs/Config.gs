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
  SHEET_CACHE:      "CACHE_",
  SHEET_USERS:      "USUARIOS AUTORIZADOS",
  SHEET_CLASIF:     "CLASIFICACION FINAL CATALOGO",
  SHEET_CONFLICTOS: "CONFLICTOS CLASIFICACION",
  SHEET_PENDIENTES: "PENDIENTES SIN HOJA2",
  SHEET_ACTIVIDAD:  "ACTIVIDAD_USUARIOS",
  SHEET_LOG:        "Log App",
  SHEET_DISPOSITIVOS: "DISPOSITIVOS",

  // ── Log de errores (Log App) ──
  LOG_TTL_DEDUPE:   3600,   // segundos: no repetir el mismo error (módulo+mensaje) en la hoja

  // ── Seguimiento de actividad (Fase 3) ──
  ACTIVIDAD_TTL_HEARTBEAT: 3600,   // throttle: 1 log de heartbeat por usuario/hora
  REPORTE_DIAS_INACTIVOS:  7,      // días sin actividad para reportar como inactivo
  REPORTE_HORA:            6,      // hora diaria del reporte

  // ── LISTA DE PRECIOS (origen) ──
  LISTA_DATA_ROW:   9,
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

  // ── Lista blanca USUARIO + DISPOSITIVO + CANAL (gs/Autorizacion.gs) ──
  // false = OBSERVACIÓN: registra y calcula el veredicto (Log App), no bloquea.
  // true  = CUMPLIMIENTO: bloquea y la llave ACCESS_KEY deja de servir datos (solo ?log=1).
  ENFORCE_DISPOSITIVOS:       false,
  CANAL_POR_DEFECTO:          "APP",                 // usuarios con CANAL vacío en USUARIOS AUTORIZADOS
  MAX_DISPOSITIVOS_POR_CANAL: { APP: 1, WEB: 2 },    // aprobados por usuario y canal (PWA = WEB)
  MAX_PENDIENTES_POR_USUARIO: 3,
  BLOQUEAR_WEB_ANDROID:       true,                  // celular Android por navegador/PWA → solo la APK                     // evita llenar la hoja/correo con IDs nuevos
  APROBADORES_DISPOSITIVOS:   ["data_science@fertrac.com"],
  LOGO_URL:                   "https://app.fertrac.com/logo3.png",   // logo del correo de aprobación
  // Cliente OAuth emisor (azp) esperado por canal. Vacío = no se verifica.
  // Se llena con los valores reales de la columna AZP tras la observación.
  AZP_POR_CANAL:              { APP: [], WEB: [] },

  // ── Correos ──
  CORREO_NOTIFICACION: "ctorres@fertrac.com",
  CORREO_DATA_SCIENCE: "data_science@fertrac.com"


};
