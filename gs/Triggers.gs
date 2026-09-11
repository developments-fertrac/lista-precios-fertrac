// ============================================================
// TRIGGERS — Instalación, eliminación y manejo de disparadores
// ============================================================

// ── onEdit sobre LISTA DE PRECIOS: ejecuta sincronizacionCompleta() ──
function onListaPreciosEdit(e) {
  console.log("📄 LISTA DE PRECIOS actualizada — ejecutando sincronizacionCompleta()");
  sincronizacionCompleta(true);
}

function instalarTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t =>
      t.getHandlerFunction() === "sincronizarListaABaseMotor" ||
      t.getHandlerFunction() === "sincronizacionCompleta" ||
      t.getHandlerFunction() === "reconstruirFotosCache" ||
      t.getHandlerFunction() === "sincronizarNuevasReferencias" ||
      t.getHandlerFunction() === "onListaPreciosEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("sincronizarListaABaseMotor")
    .timeBased().everyMinutes(5).create();

  // Fotos nuevas: corre de a NUEVAS_BLOQUE (280) por ejecución con cursor en
  // CacheService; cada trigger avanza al siguiente bloque sin timeout.
  ScriptApp.newTrigger("sincronizarNuevasReferencias")
    .timeBased().everyMinutes(10).create();

  // La sincronización completa ya no corre por reloj: solo cuando se edite LISTA DE PRECIOS
  ScriptApp.newTrigger("onListaPreciosEdit")
    .forSpreadsheet(CONFIG.ID_LISTA_PRECIOS)
    .onEdit()
    .create();

  // Fotos: reconstrucción nocturna del caché =IMAGE(URL) en SHEET_CACHE
  ScriptApp.newTrigger("reconstruirFotosCache")
    .timeBased().everyDays(1).atHour(23)
    .nearMinute(30).create();

  console.log("🚀 Triggers instalados — cada 5 min + onEdit LISTA DE PRECIOS (sync completa) + fotos nocturnas");
}

function eliminarTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t =>
      t.getHandlerFunction() === "sincronizarListaABaseMotor" ||
      t.getHandlerFunction() === "sincronizacionCompleta" ||
      t.getHandlerFunction() === "reconstruirFotosCache" ||
      t.getHandlerFunction() === "sincronizarFotosCache" ||
      t.getHandlerFunction() === "sincronizarNuevasReferencias" ||
      t.getHandlerFunction() === "onListaPreciosEditFotos" ||
      t.getHandlerFunction() === "onListaPreciosEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log("🛑 Todos los triggers eliminados");
}

function liberarLock() {
  const lock = LockService.getScriptLock();
  lock.releaseLock();
  console.log("🔓 Lock liberado");
}

function limpiarTodosLosTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  console.log("🧹 Todos los triggers eliminados");
}

function pausarTriggersTemporalmente() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "sincronizarListaABaseMotor" ||
                 t.getHandlerFunction() === "sincronizacionCompleta" ||
                 t.getHandlerFunction() === "sincronizarNuevasReferencias" ||
                 t.getHandlerFunction() === "onListaPreciosEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log("⏸ Triggers pausados temporalmente");
}
