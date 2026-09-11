// ============================================================
// CORE — App.Session — Singleton
// Rastrea la actividad del usuario (login, heartbeat, inactividad)
// y emite eventos al bus del Store. Persiste fertrac_last_active.
// En Fase 3 estos eventos se envían al backend (ACTIVIDAD_USUARIOS).
// ============================================================
window.App = window.App || {};
(function (window) {
  'use strict';
  if (window.App.Session) return;

  const Store = window.App.Store;
  const HEARTBEAT_MS = 60000;
  const INACTIVE_MS = 5 * 60 * 1000;
  const _ls = window.localStorage;

  let _lastActive = Date.now();
  let _inactiveSeen = false;
  let _timer = null;

  function stamp() {
    try { _ls.setItem('fertrac_last_active', String(_lastActive)); } catch (e) {}
  }

  function recordLogin(email) {
    _lastActive = Date.now();
    _inactiveSeen = false;
    stamp();
    try { _ls.setItem('fertrac_user', String(email || '')); } catch (e) {}
    Store.notify('user.login', { email: email, platform: window.App.Platform.label });
  }

  function touch() {
    _lastActive = Date.now();
    if (_inactiveSeen) _inactiveSeen = false;
    stamp();
    Store.notify('session.heartbeat', { lastActive: _lastActive, platform: window.App.Platform.label });
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      const idle = Date.now() - _lastActive;
      if (idle >= INACTIVE_MS) {
        if (!_inactiveSeen) { _inactiveSeen = true; Store.notify('user.inactive', {}); }
      } else {
        touch();
      }
    }, HEARTBEAT_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') touch();
    });
    ['pointerdown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, touch, { passive: true });
    });
  }

  window.App.Session = {
    recordLogin: recordLogin,
    touch: touch,
    start: start,
    get lastActive() { return _lastActive; }
  };
})(window);