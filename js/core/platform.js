// ============================================================
// CORE — App.Platform — Singleton
// Detecta dónde corre la app: Capacitor nativo, PWA instalada
// o navegador (web), con variantes iOS/Android.
// Labels: app-ios | app-android | pwa-ios | pwa-android | web-*
// ============================================================
window.App = window.App || {};
(function (window) {
  'use strict';
  if (window.App.Platform) return;

  const nav = window.navigator || {};
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const ua = (nav.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isStandalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    !!nav.standalone;

  let label;
  if (isNative) label = isIOS ? 'app-ios' : isAndroid ? 'app-android' : 'app-other';
  else if (isStandalone) label = isIOS ? 'pwa-ios' : isAndroid ? 'pwa-android' : 'pwa-other';
  else label = isIOS ? 'web-ios' : isAndroid ? 'web-android' : 'web-desktop';

  window.App.Platform = {
    label: label,
    isNativeApp: isNative,
    isPWA: isStandalone,
    isIOS: isIOS,
    isAndroid: isAndroid
  };
})(window);