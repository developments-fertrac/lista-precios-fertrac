// ============================================================
// AUTORIZACIÓN — Lista blanca USUARIO + DISPOSITIVO + CANAL
//
// Hojas (en CONFIG.ID_BASE_MOTOR):
//   USUARIOS AUTORIZADOS  A = EMAIL (desde fila 2) + columnas ubicadas POR ENCABEZADO:
//     CANAL  ∈ APP | WEB | AMBOS     (vacío = CONFIG.CANAL_POR_DEFECTO)
//     ESTADO ∈ ACTIVO | SUSPENDIDO   (vacío = ACTIVO)
//     NOTA
//   DISPOSITIVOS  (la crea prepararHojasAutorizacion)
//     EMAIL | DEVICE_ID | CANAL | PLATAFORMA | MODELO | VERSION_APP | FECHA_REGISTRO |
//     ULTIMO_USO | ESTADO | APROBADO_POR | FECHA_APROBACION | NOTA | AZP
//     ESTADO ∈ PENDIENTE | APROBADO | BLOQUEADO
//
// Regla: usuario ACTIVO ∧ canal permitido ∧ dispositivo APROBADO de ese canal.
// Canal = prefijo del device_id: "and-" → APP (APK) · "web-" → WEB (navegador y PWA).
//
// CONFIG.ENFORCE_DISPOSITIVOS = false → OBSERVACIÓN: registra dispositivos,
// calcula el veredicto y lo deja en "Log App", pero doGet NO bloquea.
//
// Rendimiento: matrices de usuarios y dispositivos en CacheService (ACL_TTL);
// la hoja solo se lee al expirar o al invalidar (onAutorizacionEdit).
// Lock: NO usa el lock global (docs/LOCK_APPS_SCRIPT.md). Solo el registro de
// un dispositivo nuevo usa LockService.getUserLock(), que es independiente.
// ============================================================

const ACL_CACHE_USUARIOS = "acl_usuarios_v1";
const ACL_CACHE_DISP     = "acl_dispositivos_v1";
const ACL_TTL            = 300;    // 5 min
const ACL_TTL_USO        = 3600;   // throttle de ULTIMO_USO: 1 escritura/dispositivo/hora
const ACL_RE_DEVICE      = /^(and|web)-[A-Za-z0-9_-]{8,80}$/;

const DISP_COLS = [
  "EMAIL", "DEVICE_ID", "CANAL", "PLATAFORMA", "MODELO", "VERSION_APP", "FECHA_REGISTRO",
  "ULTIMO_USO", "ESTADO", "APROBADO_POR", "FECHA_APROBACION", "NOTA", "AZP"
];
const DC = {};                                   // nombre → número de columna (1-based)
DISP_COLS.forEach(function (c, i) { DC[c] = i + 1; });

const ESTADOS_DISP    = ["PENDIENTE", "APROBADO", "BLOQUEADO"];
const CANALES_USUARIO = ["APP", "WEB", "AMBOS"];
const ESTADOS_USUARIO = ["ACTIVO", "SUSPENDIDO"];

// ── Normalizadores ──
function _aclTxt_(v) { return String(v === null || v === undefined ? "" : v).trim(); }
function _aclEmail_(v) { return _aclTxt_(v).toLowerCase(); }
function normCanalUsuario_(v) {
  const c = _aclTxt_(v).toUpperCase();
  return CANALES_USUARIO.indexOf(c) >= 0 ? c : CONFIG.CANAL_POR_DEFECTO;
}
function normEstadoUsuario_(v) { return _aclTxt_(v).toUpperCase() === "SUSPENDIDO" ? "SUSPENDIDO" : "ACTIVO"; }
function normEstadoDisp_(v) {
  const e = _aclTxt_(v).toUpperCase();
  return ESTADOS_DISP.indexOf(e) >= 0 ? e : "PENDIENTE";
}
// Texto seguro para la hoja: corta y neutraliza inyección de fórmulas (= + - @).
function _aclCelda_(v, max) {
  let s = _aclTxt_(v).slice(0, max || 80);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function maxPorCanal_(canal) {
  const m = CONFIG.MAX_DISPOSITIVOS_POR_CANAL || {};
  return m[canal] || 1;
}
function _colPorEncabezado_(encabezados, nombre) {
  for (let i = 0; i < encabezados.length; i++) {
    if (_aclTxt_(encabezados[i]).toUpperCase() === nombre) return i;   // 0-based
  }
  return -1;
}

// ── Canal de la solicitud: manda el prefijo del device_id; si no hay, el canal declarado ──
function canalDeSolicitud_(params) {
  const dev = _aclTxt_(params.device);
  if (dev.indexOf("and-") === 0) return "APP";
  if (dev.indexOf("web-") === 0) return "WEB";
  const c = _aclTxt_(params.canal);
  if (c === "apk_android") return "APP";
  if (c === "pwa_instalada" || c === "navegador") return "WEB";
  return "";
}

// ============================================================
// MATRICES (cacheadas)
// ============================================================

// { email: { canal, estado } } o null si la hoja no se pudo leer.
function leerUsuariosAcl_(forzar) {
  const cache = CacheService.getScriptCache();
  if (!forzar) {
    const c = cacheGetGrande_(cache, ACL_CACHE_USUARIOS);
    if (c) { try { return JSON.parse(c); } catch (e) {} }
  }
  try {
    const mapa = {};
    const sh = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR).getSheetByName(CONFIG.SHEET_USERS);
    if (sh && sh.getLastRow() >= 2) {
      const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues();
      const iCanal  = _colPorEncabezado_(v[0], "CANAL");
      const iEstado = _colPorEncabezado_(v[0], "ESTADO");
      for (let r = 1; r < v.length; r++) {
        const email = _aclEmail_(v[r][0]);
        if (!email || mapa[email]) continue;                      // primera fila gana
        mapa[email] = {
          canal:  normCanalUsuario_(iCanal >= 0 ? v[r][iCanal] : ""),
          estado: normEstadoUsuario_(iEstado >= 0 ? v[r][iEstado] : "")
        };
      }
    }
    cachePutGrande_(cache, ACL_CACHE_USUARIOS, JSON.stringify(mapa), ACL_TTL);
    return mapa;
  } catch (err) {
    console.warn("leerUsuariosAcl_: " + err.message);
    return null;                                                  // no se cachea el fallo
  }
}

// { email: [ { id, canal, estado, fila } ] } o null si la hoja no se pudo leer.
function leerDispositivosAcl_(forzar) {
  const cache = CacheService.getScriptCache();
  if (!forzar) {
    const c = cacheGetGrande_(cache, ACL_CACHE_DISP);
    if (c) { try { return JSON.parse(c); } catch (e) {} }
  }
  try {
    const mapa = {};
    const sh = hojaDispositivos_(false);
    if (sh && sh.getLastRow() >= 2) {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, DISP_COLS.length).getValues();
      for (let i = 0; i < v.length; i++) {
        const email = _aclEmail_(v[i][DC.EMAIL - 1]);
        const id = _aclTxt_(v[i][DC.DEVICE_ID - 1]);
        if (!email || !id) continue;
        const lista = mapa[email] = mapa[email] || [];
        if (lista.some(function (d) { return d.id === id; })) continue;   // duplicado: gana la primera
        lista.push({
          id: id,
          canal: _aclTxt_(v[i][DC.CANAL - 1]).toUpperCase(),
          estado: normEstadoDisp_(v[i][DC.ESTADO - 1]),
          fila: i + 2
        });
      }
    }
    cachePutGrande_(cache, ACL_CACHE_DISP, JSON.stringify(mapa), ACL_TTL);
    return mapa;
  } catch (err) {
    console.warn("leerDispositivosAcl_: " + err.message);
    return null;
  }
}

function invalidarCacheAutorizacion_() {
  const cache = CacheService.getScriptCache();
  cacheRemoveGrande_(cache, ACL_CACHE_USUARIOS);
  cacheRemoveGrande_(cache, ACL_CACHE_DISP);
}

// ¿El correo está en USUARIOS AUTORIZADOS? (reemplaza la lectura directa de la hoja)
function usuarioEnLista_(email) {
  const m = leerUsuariosAcl_();
  return !!(m && m[_aclEmail_(email)]);
}

// ============================================================
// EVALUACIÓN
// Devuelve { ok, codigo, canal, device }. codigo:
//   ok | no_autorizado | usuario_suspendido | dispositivo_requerido | dispositivo_invalido
//   | canal_no_autorizado | canal_no_verificado | dispositivo_pendiente
//   | dispositivo_bloqueado | dispositivo_limite | acl_no_disponible
// ============================================================
function evaluarAccesoDispositivo_(email, azp, params) {
  email = _aclEmail_(email);
  const device = _aclTxt_(params.device);
  const canal = canalDeSolicitud_(params);
  const r = function (codigo) { return { ok: codigo === "ok", codigo: codigo, canal: canal, device: device }; };

  const usuarios = leerUsuariosAcl_();
  if (!usuarios) return r("acl_no_disponible");
  const u = usuarios[email];
  if (!u) return r("no_autorizado");
  if (u.estado === "SUSPENDIDO") return r("usuario_suspendido");

  if (!device) return r("dispositivo_requerido");
  if (!ACL_RE_DEVICE.test(device) || !canal) return r("dispositivo_invalido");
  if (u.canal !== "AMBOS" && u.canal !== canal) return r("canal_no_autorizado");

  // Verificación del canal con el cliente OAuth emisor del token (azp).
  // Lista vacía = no se verifica (se llena con los azp reales observados).
  const azpEsperados = (CONFIG.AZP_POR_CANAL || {})[canal] || [];
  if (azpEsperados.length && azpEsperados.indexOf(_aclTxt_(azp)) < 0) return r("canal_no_verificado");

  const disps = leerDispositivosAcl_();
  if (!disps) return r("acl_no_disponible");
  const lista = disps[email] || [];
  let d = null;
  for (let i = 0; i < lista.length; i++) if (lista[i].id === device) { d = lista[i]; break; }

  if (!d) {
    const pendientes = lista.filter(function (x) { return x.estado === "PENDIENTE"; }).length;
    if (pendientes >= (CONFIG.MAX_PENDIENTES_POR_USUARIO || 3)) return r("dispositivo_limite");
    d = registrarDispositivo_(email, device, canal, azp, params);
    if (!d) return r("acl_no_disponible");
  }

  if (d.canal && d.canal !== canal) return r("canal_no_autorizado");   // CANAL editado a mano
  if (d.estado === "BLOQUEADO") return r("dispositivo_bloqueado");
  if (d.estado === "PENDIENTE") {
    const aprobados = lista.filter(function (x) { return x.estado === "APROBADO" && x.canal === canal; }).length;
    return r(aprobados >= maxPorCanal_(canal) ? "dispositivo_limite" : "dispositivo_pendiente");
  }
  marcarUsoDispositivo_(d);
  return r("ok");
}

// Traduce el veredicto al `estado` de doGet según el modo (observación / cumplimiento).
function resolverEstadoAcl_(acl, email, azp, params) {
  if (acl.ok) return "ok";
  if (acl.codigo === "no_autorizado") return "no_autorizado";   // comportamiento previo: siempre activo
  const detalle = "azp=" + _aclTxt_(azp) + " plat=" + _aclTxt_(params.plat) + " ver=" + _aclTxt_(params.ver);
  const disp = acl.device ? "…" + acl.device.slice(-6) : "-";
  if (CONFIG.ENFORCE_DISPOSITIVOS) {
    registrarLog_("warn", "backend", "acl", "RECHAZO " + acl.codigo + " " + email + " " + acl.canal + " " + disp, "", detalle, email);
    return acl.codigo;
  }
  // Observación: no bloquea. 'dispositivo_requerido' es esperado hasta que el
  // frontend envíe &device= (Fase 3), así que no se loguea para no hacer ruido.
  if (acl.codigo !== "dispositivo_requerido") {
    registrarLog_("info", "backend", "acl", "OBS " + acl.codigo + " " + email + " " + acl.canal + " " + disp, "", detalle, email);
  }
  return "ok";
}

// ============================================================
// REGISTRO Y USO
// ============================================================

function hojaDispositivos_(crear) {
  const ss = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);
  let sh = ss.getSheetByName(CONFIG.SHEET_DISPOSITIVOS);
  if (!sh && crear) {
    sh = ss.insertSheet(CONFIG.SHEET_DISPOSITIVOS);
    sh.getRange(1, 1, 1, DISP_COLS.length).setValues([DISP_COLS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    _validacionLista_(sh, DC.ESTADO, ESTADOS_DISP);
  }
  return sh;
}

function _validacionLista_(sh, col, valores) {
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build();
  sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1).setDataValidation(regla);
}

// Registra (email, device) como PENDIENTE y avisa a los aprobadores.
// Las peticiones del arranque llegan en ráfaga (catálogo + fotos), así que se
// serializa con getUserLock y se relee la hoja sin caché antes de insertar.
function registrarDispositivo_(email, device, canal, azp, params) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(3000)) return null;
  try {
    const sh = hojaDispositivos_(true);
    const actual = leerDispositivosAcl_(true) || {};
    const ya = (actual[email] || []).filter(function (x) { return x.id === device; })[0];
    if (ya) return ya;

    const ahora = new Date();
    sh.appendRow([
      email, device, canal,
      _aclCelda_(params.plat, 30), _aclCelda_(params.modelo, 80), _aclCelda_(params.ver, 20),
      ahora, ahora, "PENDIENTE", "", "", "", _aclCelda_(azp, 100)
    ]);
    SpreadsheetApp.flush();
    const fila = sh.getLastRow();
    cacheRemoveGrande_(CacheService.getScriptCache(), ACL_CACHE_DISP);
    notificarDispositivoNuevo_(email, device, canal, params, sh);
    return { id: device, canal: canal, estado: "PENDIENTE", fila: fila };
  } catch (err) {
    console.warn("registrarDispositivo_: " + err.message);
    return null;
  } finally {
    lock.releaseLock();
  }
}

// Correo URGENTE al aprobador con el código del dispositivo (el usuario NO lo ve).
// Se envía con el servicio avanzado Gmail (habilitado en appsscript.json) para
// marcar prioridad alta (Importance/X-Priority: Outlook y Gmail móvil lo resaltan);
// si falla, cae a GmailApp con el mismo HTML.
function notificarDispositivoNuevo_(email, device, canal, params, sh) {
  try {
    const url = "https://docs.google.com/spreadsheets/d/" + CONFIG.ID_BASE_MOTOR + "/edit#gid=" + sh.getSheetId();
    const asunto = "URGENTE: Aprobación de dispositivo pendiente — " + email;
    const esc = function (v) {
      return _aclTxt_(v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    };
    const fila = function (k, v) {
      return '<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">' + k +
        '</td><td style="padding:6px 12px;color:#222"><b>' + v + '</b></td></tr>';
    };
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #eee;border-radius:10px;overflow:hidden">' +
      '<div style="padding:18px 20px;text-align:center;background:#fff">' +
        '<img src="' + CONFIG.LOGO_URL + '" alt="Fertrac" height="56" style="height:56px">' +
      '</div>' +
      '<div style="background:#c62828;color:#fff;padding:12px 20px;font-size:16px;font-weight:bold">' +
        '⚠️ URGENTE — Dispositivo pendiente de aprobación</div>' +
      '<div style="padding:18px 20px;font-size:14px;color:#222;line-height:1.5">' +
        '<p style="margin:0 0 12px">Un usuario solicita acceso a la <b>Lista de Precios</b> desde un dispositivo nuevo ' +
        'y no podrá ingresar hasta que se apruebe.</p>' +
        '<table style="border-collapse:collapse;font-size:14px;width:100%;background:#fafafa;border-radius:8px">' +
          fila("Usuario", esc(email)) +
          fila("Canal", esc(canal)) +
          fila("Código", '<span style="font-family:monospace;font-size:18px;letter-spacing:1px;color:#F47920">' + esc(device.slice(-6)) + '</span>') +
          fila("ID completo", '<span style="font-family:monospace;font-size:12px">' + esc(device) + '</span>') +
          fila("Plataforma", esc(params.plat)) +
          fila("Modelo", esc(params.modelo)) +
          fila("Versión app", esc(params.ver)) +
          fila("Límite del canal", maxPorCanal_(canal) + " dispositivo(s) aprobado(s)") +
        '</table>' +
        '<p style="margin:16px 0 8px">Cambie la columna <b>ESTADO</b> a <b>APROBADO</b> o <b>BLOQUEADO</b> en la hoja ' +
          esc(CONFIG.SHEET_DISPOSITIVOS) + ' (busque el usuario y el código).</p>' +
        '<p style="text-align:center;margin:18px 0"><a href="' + url + '" style="background:#F47920;color:#fff;' +
          'padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir hoja DISPOSITIVOS</a></p>' +
        (CONFIG.ENFORCE_DISPOSITIVOS ? "" :
          '<p style="color:#888;font-size:12px;margin:0">Modo observación: el usuario todavía NO está bloqueado.</p>') +
      '</div></div>';
    const texto = "URGENTE — Dispositivo pendiente de aprobación\n\nUsuario: " + email + "\nCanal: " + canal +
      "\nCódigo: " + device.slice(-6) + "\nID: " + device + "\n\nHoja: " + url;
    const para = CONFIG.APROBADORES_DISPOSITIVOS.join(",");

    try {
      const b64 = function (t) { return Utilities.base64Encode(t, Utilities.Charset.UTF_8); };
      const mime = [
        "To: " + para,
        "Subject: =?UTF-8?B?" + b64(asunto) + "?=",
        "MIME-Version: 1.0",
        "Importance: High",
        "X-Priority: 1 (Highest)",
        "Priority: urgent",
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        b64(html)
      ].join("\r\n");
      Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8) }, "me");
    } catch (eAvz) {
      console.warn("Gmail avanzado falló, uso GmailApp: " + eAvz.message);
      GmailApp.sendEmail(para, asunto, texto, { htmlBody: html });
    }
  } catch (err) {
    console.warn("notificarDispositivoNuevo_: " + err.message);
  }
}

// ULTIMO_USO con throttle. Verifica que la fila siga siendo la del dispositivo
// (si alguien ordenó o borró filas, invalida la caché y no escribe).
function marcarUsoDispositivo_(d) {
  try {
    const cache = CacheService.getScriptCache();
    const k = "acl_uso_" + d.id;
    if (cache.get(k)) return;
    cache.put(k, "1", ACL_TTL_USO);
    const sh = hojaDispositivos_(false);
    if (!sh || d.fila > sh.getLastRow()) { cacheRemoveGrande_(cache, ACL_CACHE_DISP); return; }
    if (_aclTxt_(sh.getRange(d.fila, DC.DEVICE_ID).getValue()) !== d.id) {
      cacheRemoveGrande_(cache, ACL_CACHE_DISP);
      return;
    }
    sh.getRange(d.fila, DC.ULTIMO_USO).setValue(new Date());
  } catch (err) {}
}

// ============================================================
// APROBACIÓN — disparador instalable onEdit sobre BASE MOTOR
// ============================================================
function onAutorizacionEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    const nombre = sh.getName();
    if (nombre === CONFIG.SHEET_USERS) { invalidarCacheAutorizacion_(); return; }
    if (nombre !== CONFIG.SHEET_DISPOSITIVOS) return;

    const col0 = e.range.getColumn(), col1 = col0 + e.range.getNumColumns() - 1;
    if (DC.ESTADO < col0 || DC.ESTADO > col1) { invalidarCacheAutorizacion_(); return; }

    let editor = "";
    try { editor = _aclEmail_((e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail()); } catch (x) {}
    const aprobadores = CONFIG.APROBADORES_DISPOSITIVOS.map(_aclEmail_);
    const esAprobador = !editor || aprobadores.indexOf(editor) >= 0;   // sin correo: lo cubre la protección de la hoja

    const last = sh.getLastRow();
    if (last < 2) return;
    const datos = sh.getRange(2, 1, last - 1, DISP_COLS.length).getValues();
    const f0 = Math.max(2, e.range.getRow()), f1 = Math.min(last, e.range.getRow() + e.range.getNumRows() - 1);
    const unaCelda = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;

    for (let f = f0; f <= f1; f++) {
      const row = datos[f - 2];
      if (!row || !_aclTxt_(row[DC.DEVICE_ID - 1])) continue;

      if (!esAprobador) {
        const previo = unaCelda && e.oldValue !== undefined ? e.oldValue : "PENDIENTE";
        sh.getRange(f, DC.ESTADO).setValue(previo);
        row[DC.ESTADO - 1] = previo;
        sh.getRange(f, DC.NOTA).setValue("Cambio rechazado: " + editor + " no es aprobador");
        continue;
      }

      const estado = normEstadoDisp_(row[DC.ESTADO - 1]);
      if (estado === "APROBADO") {
        const email = _aclEmail_(row[DC.EMAIL - 1]);
        const canal = _aclTxt_(row[DC.CANAL - 1]).toUpperCase();
        const otros = datos.filter(function (x, i) {
          return i !== f - 2 && _aclEmail_(x[DC.EMAIL - 1]) === email &&
            _aclTxt_(x[DC.CANAL - 1]).toUpperCase() === canal && normEstadoDisp_(x[DC.ESTADO - 1]) === "APROBADO";
        }).length;
        if (otros >= maxPorCanal_(canal)) {
          sh.getRange(f, DC.ESTADO).setValue("PENDIENTE");
          row[DC.ESTADO - 1] = "PENDIENTE";
          sh.getRange(f, DC.NOTA).setValue("Límite de " + maxPorCanal_(canal) + " dispositivo(s) " + canal +
            " alcanzado: bloquee otro antes de aprobar este");
          continue;
        }
      }
      if (estado === "PENDIENTE") {
        sh.getRange(f, DC.APROBADO_POR, 1, 2).setValues([["", ""]]);
      } else {
        sh.getRange(f, DC.APROBADO_POR, 1, 2).setValues([[editor || "(no identificado)", new Date()]]);
      }
    }
  } catch (err) {
    registrarLog_("error", "backend", "acl_onedit", err.message, err.stack, "", "");
  } finally {
    invalidarCacheAutorizacion_();
  }
}

// ============================================================
// INSTALACIÓN (ejecutar a mano desde el editor, una vez)
// ============================================================

// Crea DISPOSITIVOS (validación + protección para aprobadores) y agrega a
// USUARIOS AUTORIZADOS las columnas CANAL, ESTADO y NOTA si no existen.
// No modifica valores existentes. Es idempotente.
function prepararHojasAutorizacion() {
  const ss = SpreadsheetApp.openById(CONFIG.ID_BASE_MOTOR);

  // 1. DISPOSITIVOS
  const sd = hojaDispositivos_(true);
  _validacionLista_(sd, DC.ESTADO, ESTADOS_DISP);
  const prot = sd.protect().setDescription("Aprobación de dispositivos — solo aprobadores");
  const yo = Session.getEffectiveUser().getEmail();              // el script debe poder escribir
  prot.addEditors(CONFIG.APROBADORES_DISPOSITIVOS.concat([yo]));
  prot.getEditors().forEach(function (u) {
    const m = _aclEmail_(u.getEmail());
    if (m !== _aclEmail_(yo) && CONFIG.APROBADORES_DISPOSITIVOS.map(_aclEmail_).indexOf(m) < 0) prot.removeEditor(u);
  });
  if (prot.canDomainEdit()) prot.setDomainEdit(false);

  // 2. USUARIOS AUTORIZADOS: columnas nuevas al final (ubicadas por encabezado)
  const su = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!su) throw new Error("No existe la hoja " + CONFIG.SHEET_USERS);
  const nuevas = [["CANAL", CANALES_USUARIO], ["ESTADO", ESTADOS_USUARIO], ["NOTA", null]];
  nuevas.forEach(function (n) {
    const enc = su.getRange(1, 1, 1, Math.max(1, su.getLastColumn())).getValues()[0];
    let i = _colPorEncabezado_(enc, n[0]);
    if (i < 0) {
      i = su.getLastColumn();
      su.getRange(1, i + 1).setValue(n[0]).setFontWeight("bold");
    }
    if (n[1]) _validacionLista_(su, i + 1, n[1]);
  });

  invalidarCacheAutorizacion_();
  console.log("✅ Autorización preparada: hoja " + CONFIG.SHEET_DISPOSITIVOS + " (protegida) + columnas CANAL/ESTADO/NOTA en " +
    CONFIG.SHEET_USERS + ". CANAL vacío = " + CONFIG.CANAL_POR_DEFECTO + ", ESTADO vacío = ACTIVO.");
}

// Instala (o reinstala) el disparador de aprobación. No toca los demás disparadores.
function instalarTriggerAutorizacion() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "onAutorizacionEdit"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onAutorizacionEdit").forSpreadsheet(CONFIG.ID_BASE_MOTOR).onEdit().create();
  console.log("🚀 Disparador onAutorizacionEdit instalado sobre BASE MOTOR");
}

// Prueba manual desde el editor: ajustar los valores y ejecutar. Ojo: si el
// dispositivo no existe lo REGISTRA (fila PENDIENTE + correo).
function test_evaluarAccesoDispositivo() {
  const email = "data_science@fertrac.com";
  const params = { device: "web-prueba-0000000001", plat: "web-desktop", ver: "test" };
  console.log(JSON.stringify(evaluarAccesoDispositivo_(email, "", params)));
}
