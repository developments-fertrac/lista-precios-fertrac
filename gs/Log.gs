// ============================================================
// LOG APP — Registro centralizado de errores
// Hoja: "Log App" (se crea sola la primera vez) en ID_BASE_MOTOR
// Columnas: FECHA | NIVEL | CAPA | MODULO | MENSAJE | STACK | EMAIL | EXTRA
//   NIVEL ∈ error | warn | info
//   CAPA  ∈ backend | app | sw
// Uso:
//   registrarLog_('error', 'backend', 'sync_completa', msg, stack, extra, email)
//   → endpoint público desde la app: ?log=1&key=...&nivel=...&modulo=...
// El mismo error (módulo+mensaje) se deduplica con CacheService durante
// LOG_TTL_DEDUPE segundos para no llenar la hoja con ruido repetido.
// ============================================================

// ── Devuelve (y crea si falta) la hoja de log ──
function hojaLog_() {
  const ss = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  let sh = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_LOG);
    sh.getRange(1, 1, 1, 8)
      .setValues([["FECHA", "NIVEL", "CAPA", "MODULO", "MENSAJE", "STACK", "EMAIL", "EXTRA"]])
      .setFontWeight("bold");
    sh.setFrozenRows(1);
    console.log("📄 Hoja " + CONFIG.SHEET_LOG + " creada con encabezados");
  }
  return sh;
}

// ── Hash MD5 simple para la clave de dedupe ──
function _logHash_(texto) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(texto || ""),
    Utilities.Charset.UTF_8
  );
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

// ── Helper interno: escribe UN registro en Log App.
//    Nunca lanza: si el registro falla, solo se imprime en consola. ──
function _escribirLog_(nivel, capa, modulo, mensaje, stack, extra, email) {
  try {
    hojaLog_().appendRow([
      new Date(),
      nivel,
      capa,
      String(modulo || "general").slice(0, 40),
      String(mensaje || "").slice(0, 600),
      String(stack || "").slice(0, 1200),
      String(email || "").slice(0, 120),
      String(extra || "").slice(0, 600)
    ]);
  } catch (err) {
    console.log("⚠️ No se pudo escribir en " + CONFIG.SHEET_LOG + ": " + err.message);
  }
}

// ── Registro unificado de errores/aviso (usar desde cualquier módulo .gs) ──
// nivel: 'error' | 'warn' | 'info' · capa: 'backend' | 'app' | 'sw'
function registrarLog_(nivel, capa, modulo, mensaje, stack, extra, email) {
  nivel = ["error", "warn", "info"].includes(nivel) ? nivel : "error";
  capa  = ["backend", "app", "sw"].includes(capa) ? capa : "backend";

  // Dedupe: el mismo módulo+mensaje solo se loguea 1 vez por LOG_TTL_DEDUPE.
  try {
    const cache = CacheService.getScriptCache();
    const clave = "logapp_" + _logHash_(capa + "|" + modulo + "|" + mensaje);
    if (cache.get(clave)) return;
    cache.put(clave, "1", CONFIG.LOG_TTL_DEDUPE);
  } catch (e) {}

  _escribirLog_(nivel, capa, modulo, mensaje, stack, extra, email);
}

// ── Endpoint público (?log=1) llamado desde la app (frontend) ──
// Se acepta la llave (respaldo: token verificado). Nunca debe romper la
// respuesta del API ni exponer datos: escribe una fila y responde {ok}.
function logDesdeApi_(params) {
  // Solo aceptar logs autenticados (llave o token válido) para no permitir
  // que cualquiera llene la hoja. El front envía SIEMPRE con key para que el
  // log llegue incluso cuando el token falla (caso típico de error).
  const autorizado = params.key === CONFIG.ACCESS_KEY ||
    (params.token && verificarTokenCacheada_(params.token) !== null);
  if (!autorizado) return jsonError_("no_autorizado");

  const nivel   = ["error", "warn", "info"].includes(params.nivel) ? params.nivel : "error";
  const capa    = params.capa === "sw" ? "sw" : "app";

  registrarLog_(
    nivel,
    capa,
    String(params.modulo || "general"),
    String(params.mensaje || "").slice(0, 600),
    String(params.stack || "").slice(0, 1200),
    String(params.extra || "").slice(0, 600),
    String(params.email || "")
  );
  return jsonRes_({ ok: true });
}