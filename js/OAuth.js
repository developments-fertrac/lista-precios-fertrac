const CLIENT_ID = '748686271759-3ebepqvfssbpn650m8pu1l6umdq093fo.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'fertrac.com';
let userEmail = null;

const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/fertrac.com/s/AKfycbztitt85lzEy2Bl7iecjX-IS56DHY1OOxPVlPbyvwxWZpDofLQsdh-stXxBvE_xIW3L/exec';
const ACCESS_KEY = 'fertrac2024';
const ENFORCE_REVOCACION = false; // TRANSICIÓN: false = no bloquea (cae a la llave). En el CIERRE: poner true.
const LOG_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzREONy5Avg7lQMSaOyUwcmEzoVAAyLsPRT1dBNr7dyX3l7_AnwCDVIjMVnZimuuNXy/exec';


// Detectar si estamos dentro de la app nativa de Capacitor
const isNativeApp = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

async function loginWithGoogle() {
  document.getElementById('login-loading').style.display = 'block';

  if (isNativeApp) {
    // Login nativo con plugin de Capacitor (dentro de la app Android)
    try {
      const { GoogleAuth } = await import('https://cdn.jsdelivr.net/npm/@codetrix-studio/capacitor-google-auth/dist/esm/index.js').catch(() => null) || {};

      // Usar el plugin desde window.Capacitor.Plugins
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
      if (!plugin) throw new Error('Plugin no disponible');

      await plugin.initialize({
        clientId: CLIENT_ID,
        scopes: ['email', 'profile'],
        grantOfflineAccess: false
      });

      const result = await plugin.signIn();
      const email = result && (result.email || (result.authentication && result.authentication.idToken));

      // Obtener email del resultado
      let userEmailResult = result.email || '';
      if (!userEmailResult && result.authentication) {
        // Decodificar el idToken para obtener el email
        const payload = JSON.parse(atob(result.authentication.idToken.split('.')[1]));
        userEmailResult = payload.email || '';
      }

      if (userEmailResult && userEmailResult.endsWith('@' + ALLOWED_DOMAIN)) {
        userEmail = userEmailResult;
        localStorage.setItem('fertrac_user', userEmail);
        // FASE 2: guardar el access token para mandarlo al API
        if (result.authentication && result.authentication.accessToken) {
          setToken(result.authentication.accessToken, result.authentication.expires_in);
        }
        pingMigracion();   // FASE 2: avisa (una vez) que este dispositivo quedó configurado
        showApp();
      } else {
        document.getElementById('login-loading').style.display = 'none';
        document.getElementById('access-denied').style.display = 'block';
      }
    } catch(e) {
      console.error('Error login nativo:', e);
      document.getElementById('login-loading').style.display = 'none';
      // Fallback al login web si falla el nativo
      loginWithGoogleWeb();
    }
  } else {
    // Login web normal (cuando se abre en navegador)
    loginWithGoogleWeb();
  }
}

function loginWithGoogleWeb() {
  const redirectUri = encodeURIComponent(window.location.href.split('?')[0]);
  const scope = encodeURIComponent('email profile');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' + CLIENT_ID +
    '&redirect_uri=' + redirectUri +
    '&response_type=token' +
    '&scope=' + scope +
    '&prompt=select_account';
  window.location.href = url;
}

function handleOAuthCallback() {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return false;
  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('access_token');
  if (!token) return false;
  document.getElementById('login-loading').style.display = 'block';
  fetch('https://www.googleapis.com/oauth2/v3/userinfo?access_token=' + token)
    .then(r => r.json())
    .then(info => {
      const email = info.email;
      if (email && email.endsWith('@' + ALLOWED_DOMAIN)) {
        // FASE 2: guardar el access token para mandarlo al API
        setToken(token, params.get('expires_in'));
        userEmail = email;
        localStorage.setItem('fertrac_user', email);
        pingMigracion();   // FASE 2: avisa (una vez) que este dispositivo quedó configurado
        window.location.hash = '';
        showApp();
      } else {
        document.getElementById('login-loading').style.display = 'none';
        document.getElementById('access-denied').style.display = 'block';
      }
    })
    .catch(() => {
      document.getElementById('login-loading').style.display = 'none';
    });
  return true;
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-content').style.display = 'block';
  initApp();
  checkIosInstallBanner();
}

function checkAuth() {
  if (!isNativeApp && handleOAuthCallback()) return;
  const saved = localStorage.getItem('fertrac_user');
  if (saved && saved.endsWith('@' + ALLOWED_DOMAIN)) {
    userEmail = saved;
    showApp();
    bootstrapToken();   // FASE 2: si no hay token, intenta conseguir uno en silencio
    return;
  }
}

// FASE 2: migra en silencio a quien ya tiene sesión pero aún no tiene token.
async function bootstrapToken() {
  if (localStorage.getItem('fertrac_token')) return;   // ya tiene token
  if (!isNativeApp) {
    // esperar a que cargue la librería de GIS (carga async)
    for (let i = 0; i < 20 && !(window.google && google.accounts && google.accounts.oauth2); i++) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  try {
    const nuevo = await renovarTokenSilencioso();
    if (nuevo) pingMigracion();
  } catch (e) {}
}

// FASE 2: cerrar sesión (para re-loguear y capturar token). Conserva el catálogo en caché.
function cerrarSesion() {
  clearToken();
  localStorage.removeItem('fertrac_user');
  userEmail = null;
  location.reload();
}

window.onload = function() { checkAuth(); };


// ════════════════════════════════════════════════════════════════════════
// FASE 2 — AUTH: token con respaldo en la llave (token-first, key-fallback)
// La llave sigue activa en el backend como red de seguridad. El token es aditivo.
// ════════════════════════════════════════════════════════════════════════

// ── Almacenamiento del access token + expiración ──
function setToken(token, expiresInSec) {
  if (!token) return;
  localStorage.setItem('fertrac_token', token);
  const seg = parseInt(expiresInSec, 10) || 3300;        // ~55 min por defecto
  localStorage.setItem('fertrac_token_exp', String(Date.now() + seg * 1000));
}
function getToken() {
  const t = localStorage.getItem('fertrac_token');
  if (!t) return null;
  const exp = parseInt(localStorage.getItem('fertrac_token_exp') || '0', 10);
  if (exp && Date.now() > exp - 60000) return null;      // expirado (margen 60s)
  return t;
}
function clearToken() {
  localStorage.removeItem('fertrac_token');
  localStorage.removeItem('fertrac_token_exp');
}

// ── Ping de migración: avisa UNA sola vez que este dispositivo quedó con token ──
function pingMigracion() {
  if (localStorage.getItem('fertrac_migrado') === '1') return;  // ya avisó antes
  if (!userEmail) return;
  fetch(LOG_SCRIPT_URL
      + '?key=' + ACCESS_KEY
      + '&email=' + encodeURIComponent(userEmail)
      + '&q=' + encodeURIComponent('__MIGRADO__'))
    .then(function () { localStorage.setItem('fertrac_migrado', '1'); })
    .catch(function () {});
}

// ── Renovación silenciosa del token según plataforma ──
// Devuelve el token nuevo, o null si no se pudo (entonces se usa la llave).
async function renovarTokenSilencioso() {
  try {
    if (isNativeApp) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
      if (!plugin || !plugin.refresh) return null;
      const r = await plugin.refresh();
      const token = r && (r.accessToken || (r.authentication && r.authentication.accessToken));
      if (token) {
        setToken(token, r.expires_in || (r.authentication && r.authentication.expires_in));
        return token;
      }
      return null;
    } else {
      // WEB: Google Identity Services
      return (typeof renovarTokenWebGIS === 'function') ? await renovarTokenWebGIS() : null;
    }
  } catch (e) {
    console.log('No se pudo renovar el token:', e);
    return null;
  }
}

// ── "No autorizado" explícito del servidor: borra caché y exige re-login ──
function manejarNoAutorizado() {
  try {
    localStorage.removeItem('fertrac_data');
    localStorage.removeItem('fertrac_updated');
  } catch (e) {}
  clearToken();
  localStorage.removeItem('fertrac_user');
  userEmail = null;
  allData = [];
  document.getElementById('app-content').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  const ad = document.getElementById('access-denied');
  if (ad) {
    ad.textContent = '⛔ Tu acceso fue revocado. Contacta a tu administrador.';
    ad.style.display = 'block';
  }
}

// ── Una petición normalizada al API ──
// modo: 'data' (catálogo) | 'img' (imagen, requiere fileId)
async function _intentoApi(qs, modo) {
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?' + qs);
    if (modo === 'img') {
      const txt = await res.text();
      if (txt.startsWith('data:')) return { ok: true, payload: txt };
      try { const j = JSON.parse(txt); return { ok: false, code: j.error || 'error' }; }
      catch (e) { return { ok: false, code: 'error' }; }
    } else {
      const json = await res.json();
      if (json.error) return { ok: false, code: json.error };
      return { ok: true, payload: json };
    }
  } catch (e) {
    return { ok: false, code: 'red' };                   // error de red → NO borrar caché
  }
}

// ── Petición al API con token-first y key-fallback ──
// Devuelve: 'data' → objeto {data}; 'img' → texto "data:..."
async function apiRequest(modo, fileId) {
  const sufijo = (modo === 'img') ? ('&img=' + encodeURIComponent(fileId)) : '';

  // Token disponible (si expiró localmente, intenta renovar antes de pedir)
  let token = getToken();
  if (!token && localStorage.getItem('fertrac_token')) {
    token = await renovarTokenSilencioso();
  }

  if (token) {
    let res = await _intentoApi('token=' + encodeURIComponent(token) + sufijo, modo);
    if (res.ok) return res.payload;
    if (res.code === 'no_autorizado' && ENFORCE_REVOCACION) { manejarNoAutorizado(); throw new Error('no_autorizado'); }
    if (res.code === 'token_invalido') {
      const nuevo = await renovarTokenSilencioso();
      if (nuevo) {
        res = await _intentoApi('token=' + encodeURIComponent(nuevo) + sufijo, modo);
        if (res.ok) return res.payload;
        if (res.code === 'no_autorizado' && ENFORCE_REVOCACION) { manejarNoAutorizado(); throw new Error('no_autorizado'); }
      }
    }
    // cualquier otro caso → cae a la llave
  }

  // Fallback: llave (red de seguridad durante la transición)
  const resK = await _intentoApi('key=' + ACCESS_KEY + sufijo, modo);
  if (resK.ok) return resK.payload;
  throw new Error(resK.code || 'error');
}

// ── Renovación silenciosa WEB con Google Identity Services ──
let _gisTokenClient = null;

function initGIS() {
  if (_gisTokenClient) return true;
  if (!window.google || !google.accounts || !google.accounts.oauth2) return false;
  _gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: 'email profile',
    callback: function () {},         // se reasigna en cada petición
    error_callback: function () {}    // se reasigna en cada petición
  });
  return true;
}

function renovarTokenWebGIS() {
  return new Promise(function (resolve) {
    if (!initGIS()) { resolve(null); return; }

    let resuelto = false;
    const done = function (val) { if (!resuelto) { resuelto = true; resolve(val); } };

    _gisTokenClient.callback = function (resp) {
      if (resp && resp.access_token) {
        setToken(resp.access_token, resp.expires_in);
        done(resp.access_token);
      } else {
        done(null);
      }
    };
    _gisTokenClient.error_callback = function () { done(null); };

    try {
      // prompt:'' = silencioso, sin UI, si el usuario tiene sesión de Google activa
      _gisTokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
      done(null);
    }

    // Salvaguarda: si GIS no responde en 8 s, caer a la llave
    setTimeout(function () { done(null); }, 8000);
  });
}