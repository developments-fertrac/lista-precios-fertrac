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

  // Canal de consumo para GA4 (GTM). Compacto y alineado a la dimensión
  // personalizada `canal` configurada en GA4: apk_android | pwa_instalada | navegador.
  // `App.Platform.label` se conserva con su granularidad para el backend.
  const canal = isNative ? 'apk_android' : isStandalone ? 'pwa_instalada' : 'navegador';
  window.FT_CANAL = canal;

  // GTM: publicar `canal` como estado del dataLayer desde el arranque, para
  // que la variable "canal" del contenedor tenga siempre el dispositivo y no
  // dependa de que cada evento lo traiga en su push (p. ej. tags que disparan
  // en PageView o antes del primer evento personalizado).
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ canal: canal });
  } catch (e) { /* si GTM aún no inicializó, el canal llega con el primer push */ }
})(window);