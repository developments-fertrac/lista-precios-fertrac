// ============================================================
// TRIGGERS — Instalación, eliminación y manejo de disparadores
// ============================================================

// ── onEdit sobre LISTA DE PRECIOS: detecta la actualización del archivo
//    CONFIG.ID_LISTA_PRECIOS y solo entonces ejecuta sincronizacionCompleta() ──
function onListaPreciosEdit(e) {
  const idEditado = (e && e.source && e.source.getId) ? e.source.getId() : "";
  if (idEditado !== CONFIG.ID_LISTA_PRECIOS) {
    console.log("⏭️ Edición en otro archivo — ignorando");
    return;
  }
  console.log("📄 LISTA DE PRECIOS actualizada — ejecutando sincronizacionCompleta()");
  sincronizacionCompleta(true);
}

function instalarTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t =>
      t.getHandlerFunction() === "sincronizarListaABaseMotor" ||
      t.getHandlerFunction() === "sincronizacionCompleta" ||
      t.getHandlerFunction() === "sincronizacionNocturnaFotos" ||
      t.getHandlerFunction() === "onListaPreciosEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("sincronizarListaABaseMotor")
    .timeBased().everyMinutes(5).create();

  // La sincronización completa ya no corre por reloj: solo cuando se edite LISTA DE PRECIOS
  ScriptApp.newTrigger("onListaPreciosEdit")
    .forSpreadsheet(CONFIG.ID_LISTA_PRECIOS)
    .onEdit()
    .create();

  ScriptApp.newTrigger("sincronizacionNocturnaFotos")
    .timeBased().everyDays(1).atHour(23)
    .nearMinute(30).create();

  console.log("🚀 Triggers instalados — cada 5 min + onEdit LISTA DE PRECIOS (sync completa) + 11:30pm fotos");
}

function eliminarTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t =>
      t.getHandlerFunction() === "sincronizarListaABaseMotor" ||
      t.getHandlerFunction() === "sincronizacionCompleta" ||
      t.getHandlerFunction() === "sincronizacionNocturnaFotos" ||
      t.getHandlerFunction() === "onListaPreciosEdit" ||
      t.getHandlerFunction() === "poblarFotosBaseMotor")
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
                 t.getHandlerFunction() === "onListaPreciosEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log("⏸ Triggers pausados temporalmente");
}
