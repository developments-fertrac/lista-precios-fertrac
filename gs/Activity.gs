// ============================================================
// ACTIVIDAD — Registro de sesiones y reporte de usuarios inactivos
// Hoja: ACTIVIDAD_USUARIOS (se crea sola la primera vez)
// Columnas: FECHA | EMAIL | PLATAFORMA | TIPO
//   TIPO ∈ login | heartbeat | end | inactive
// El heartbeat se throttlea (1 log por usuario/hora, vía CacheService)
// para no llenar la hoja con un registro por minuto.
// ============================================================

const ACTIVIDAD_PREFIJO_HB = "actividad_hb_";          // CacheService: prefijo + email

// ── Devuelve (y crea si falta) la hoja de actividad ──
function hojaActividad_() {
  const ss = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  let sh = ss.getSheetByName(CONFIG.SHEET_ACTIVIDAD);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_ACTIVIDAD);
    sh.getRange(1, 1)
      .setValues([["FECHA", "EMAIL", "PLATAFORMA", "TIPO"]])
      .setFontWeight("bold");
  }
  return sh;
}

// ── Registra un evento de sesión (login/heartbeat/end/inactive) ──
function registrarActividad_(email, tipo, plataforma) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return;

  if (tipo === "heartbeat") {
    const cache = CacheService.getScriptCache();
    if (cache.get(ACTIVIDAD_PREFIJO_HB + email)) return;   // ya se logueó esta hora
    cache.put(ACTIVIDAD_PREFIJO_HB + email, "1", CONFIG.ACTIVIDAD_TTL_HEARTBEAT);
  }

  try {
    hojaActividad_().appendRow([
      new Date(),
      email,
      String(plataforma || "").trim().slice(0, 30),
      tipo
    ]);
  } catch (err) {
    console.log("⚠️ No se pudo registrar actividad de", email, ":", err.message);
  }
}

// ── Usuarios sin actividad en los últimos `dias` días ──
// Devuelve [{ email, ultima, dias }] ordenados de más antiguo a más reciente.
function usuariosInactivos_(dias) {
  dias = parseInt(dias, 10) || CONFIG.REPORTE_DIAS_INACTIVOS;

  const corte = new Date();
  corte.setDate(corte.getDate() - dias);

  const sh = hojaActividad_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const filas = sh.getRange(2, 1, lastRow - 1, 4).getValues();

  // último evento por usuario
  const ultimo = new Map();
  filas.forEach(row => {
    const email = String(row[1] || "").trim().toLowerCase();
    const fecha = row[0] instanceof Date ? row[0].getTime() : 0;
    if (!email) return;
    const prev = ultimo.get(email) || 0;
    ultimo.set(email, Math.max(prev, fecha));
  });

  const inactivos = [];
  ultimo.forEach((ts, email) => {
    if (ts > 0 && ts < corte.getTime()) {
      const ultima = new Date(ts);
      inactivos.push({
        email,
        ultima: Utilities.formatDate(ultima, "America/Bogota", "yyyy-MM-dd HH:mm"),
        dias: Math.round((Date.now() - ts) / 86400000)
      });
    }
  });

  inactivos.sort((a, b) => b.dias - a.dias);
  return inactivos;
}

// ── Envía por correo el reporte de usuarios inactivos ──
// Trigger diario opcional (ver Triggers.gs). Sin usuarios inactivos no envía.
function generarReporteInactivos() {
  const inactivos = usuariosInactivos_(CONFIG.REPORTE_DIAS_INACTIVOS);
  if (inactivos.length === 0) {
    console.log("✅ Reporte de inactivos: sin usuarios inactivos");
    return;
  }

  const fecha = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy HH:mm");
  const cuerpo = [
    `Reporte de usuarios inactivos — ${fecha}`,
    `Criterio: sin actividad en los últimos ${CONFIG.REPORTE_DIAS_INACTIVOS} días`,
    "",
    ...inactivos.map(u => `• ${u.email} — última actividad: ${u.ultima} (${u.dias} días)`),
    "",
    "— Fertrac Apps Script"
  ].join("\n");

  GmailApp.sendEmail(
    CONFIG.CORREO_NOTIFICACION,
    `Fertrac — ${inactivos.length} usuario(s) inactivo(s) ${fecha}`,
    cuerpo
  );
  console.log(`📧 Reporte de inactivos (${inactivos.length}) enviado a ${CONFIG.CORREO_NOTIFICACION}`);
}