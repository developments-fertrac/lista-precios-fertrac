// ============================================================
// AUTH — Login con Google, token y acceso al API
// ============================================================

let userEmail = null;

// FASE 1: detección de plataforma centralizada (App.Platform singleton)
const isNativeApp = window.App.Platform.isNativeApp;

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
        App.Session.recordLogin(userEmailResult);
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
        App.Session.recordLogin(email);
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
  // El iframe de renovación silenciosa carga esta página con un #access_token;
  // ahí NO se debe arrancar la app (solo recoge el token el padre).
  if (inIframe()) return;
  if (!isNativeApp && handleOAuthCallback()) return;
  const saved = localStorage.getItem('fertrac_user');
  if (saved && saved.endsWith('@' + ALLOWED_DOMAIN)) {
    userEmail = saved;
    showApp();
    bootstrapToken();   // FASE 2: si no hay token, intenta conseguir uno en silencio
    return;
  }
  // FASE 4: sin sesión guardada y sin red → el login de Google es imposible;
  // avisar y deshabilitar el botón hasta que vuelva la conexión.
  if (!navigator.onLine) {
    const hint = document.getElementById('login-offline');
    if (hint) hint.style.display = 'block';
    const btn = document.querySelector('#login-screen .login-card button');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
    window.addEventListener('online', function () {
      if (hint) hint.style.display = 'none';
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '';
      }
    });
  }
}

// FASE 2: migra en silencio a quien ya tiene sesión pero aún no tiene token.
async function bootstrapToken() {
  if (localStorage.getItem('fertrac_token')) return;   // ya tiene token
  try {
    const nuevo = await renovarTokenSilencioso();
    if (nuevo) pingMigracion();
  } catch (e) {}
}

// FASE 2: cerrar sesión (para re-loguear y capturar token). Conserva el catálogo en caché.
function cerrarSesion() {
  App.Store.notify('session.end', { email: userEmail, platform: App.Platform.label });
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
  window._tokenRecienObtenido = Date.now(); // login fresco: no re-renovar si el backend lo rechaza
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
      // WEB: renovación sin popups vía iframe oculto (no usa GIS)
      return (typeof renovarTokenWeb === 'function') ? await renovarTokenWeb() : null;
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
  App.Store.clear();                        // FASE 1: el Store es la única fuente de verdad
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
      // Nuevo formato: JSON { ok, url } con el thumbnail público de Drive.
      try {
        const j = JSON.parse(txt);
        if (!j.ok) return { ok: false, code: j.error || 'error' };
        return { ok: true, payload: { kind: j.kind, url: j.url || '' } };
      } catch (e) { /* no es JSON → formato viejo, verificar data: */ }
      if (txt.startsWith('data:')) return { ok: true, payload: { kind: 'data', url: txt } };
      return { ok: false, code: 'error' };
    } else {
      const json = await res.json();
      if (json.error) return { ok: false, code: json.error };
      return { ok: true, payload: json };
    }
  } catch (e) {
    return { ok: false, code: 'red' };                   // error de red → NO borrar caché
  }
}

// ── Renovación silenciosa con de-dupe ──
// Comparte UNA renovación en curso entre todas las peticiones concurrentes
// (evita N iframes de renovación a la vez durante el arranque).
let _renovacionEnCurso = null;
let _renoCooldownHasta = 0;
const RENOVACION_COOLDOWN_MS = 5 * 60 * 1000;
function renovarTokenProtegido() {
  // Cooldown: si el intento anterior falló hace poco (ej. sin throw, Google no
  // puede renovar en silencio por session/cookies), no volver a dispararlo por
  // cada heartbeat. Cae directo a la llave.
  if (Date.now() < _renoCooldownHasta) return Promise.resolve(null);
  if (!_renovacionEnCurso) {
    _renovacionEnCurso = renovarTokenSilencioso()
      .then(function (v) {
        if (!v) _renoCooldownHasta = Date.now() + RENOVACION_COOLDOWN_MS;   // solo en fallos
        return v;
      })
      .catch(function () { _renoCooldownHasta = Date.now() + RENOVACION_COOLDOWN_MS; return null; })
      .finally(function () { _renovacionEnCurso = null; });
  }
  return _renovacionEnCurso;
}

// ¿El token actual viene de un login de hace menos de 60 s? Evita entrar en
// token_invalido → renovar → token_invalido cuando el backend rechaza un token
// recién emitido (el mismo visitante da el mismo veredicto en el acto).
function tokenRecienObtenido() {
  const t = window._tokenRecienObtenido;
  return !!t && (Date.now() - t) < 60000;
}

// ── Petición al API con token-first y key-fallback ──
// modo: 'data' (catálogo) | 'img' (imagen, fileId) | 'fotos' (catálogo de fotos)
//       | 'activity' (eventos de sesión)
// extra (opcional): params adicionales → 'data?delta=1&since=...', etc.
async function apiRequest(modo, fileId, extra) {
  // Best-effort (actividad/heartbeat): nunca disparar renovación de token
  // en segundo plano; se usa el token vigente o se cae directo a la llave.
  const noRenew = !!(extra && extra.noRenew);
  let sufijo;
  if (modo === 'img') sufijo = '&img=' + encodeURIComponent(fileId);
  else if (modo === 'fotos') sufijo = '&fotos=1';
  else if (modo === 'data' && extra && extra.delta) {
    sufijo = '&delta=1';
    if (extra.since) sufijo += '&since=' + encodeURIComponent(extra.since);
  } else if (modo === 'activity' && extra) {
    if (extra.activity) sufijo += '&activity=' + encodeURIComponent(extra.activity);
    if (extra.email)   sufijo += '&email=' + encodeURIComponent(extra.email);
    if (extra.platform) sufijo += '&platform=' + encodeURIComponent(extra.platform);
  } else {
    sufijo = '';
  }

  // Token disponible (si expiró localmente, intenta renovar antes de pedir)
  let token = getToken();
  if (!token && localStorage.getItem('fertrac_token') && !tokenRecienObtenido() && !noRenew) {
    token = await renovarTokenProtegido();
  }

  if (token) {
    let res = await _intentoApi('token=' + encodeURIComponent(token) + sufijo, modo);
    if (res.ok) return res.payload;
    if (res.code === 'no_autorizado' && ENFORCE_REVOCACION) { manejarNoAutorizado(); throw new Error('no_autorizado'); }
    // Un token recién emitido (login de hace segundos) que el backend rechaza
    // no se arregla mintiendo otro en el acto: mismo cliente, mismo veredicto,
    // y el renew abriría popup/ruido en mitad del callback de login.
    if (res.code === 'token_invalido' && !tokenRecienObtenido() && !noRenew) {
      const nuevo = await renovarTokenProtegido();
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

// ============================================================
// RENOVACIÓN SILENCIOSA WEB — iframe oculto (sin popups, sin GIS/COOP)
// Google Identity Services (requestAccessToken) abre un popup para renovar;
// en páginas servidas con COOP (o sin cookies de terceros) el popup no
// entrega el token y Chrome loguea "Cross-Origin-Opener-Policy policy would
// block the window.closed call". Google además manda COOP-Report-Only en sus
// páginas de auth (confirmado en /o/oauth2/v2/auth), así que el aviso sale
// incluso cuando la vista funciona.
// Aquí se usa el MISMO flujo OAuth implícito del login dentro de un iframe
// oculto con prompt=none: nunca abre UI ni depende del opener. El endpoint
// /o/oauth2/v2/auth no envía X-Frame-Options:DENY, así que responde en el
// iframe. Si Google no puede renovar en silencio, devuelve #error=... y
// caemos a la llave (red de seguridad) sin ruido en consola.
// ============================================================

function inIframe() {
  try { return window.self !== window.top; } catch (e) { return true; }
}

let _renovacionWebEnCurso = false;
function renovarTokenWeb() {
  return new Promise(function (resolve) {
    if (_renovacionWebEnCurso) { resolve(null); return; }
    _renovacionWebEnCurso = true;

    // Mismo redirect_uri que el login (el autorizado en Google Cloud Console).
    const redirectUri = String(window.location.href.split('?')[0]).split('#')[0];
    const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
      '?client_id=' + CLIENT_ID +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&response_type=token' +
      '&scope=' + encodeURIComponent('email profile') +
      '&include_granted_scopes=true' +
      '&prompt=none';

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'display:none;border:0;width:1px;height:1px;';
    document.body.appendChild(iframe);

    let terminado = false;
    const fin = function (val) {
      if (terminado) return;
      terminado = true;
      _renovacionWebEnCurso = false;
      try { document.body.removeChild(iframe); } catch (e) {}
      resolve(val);
    };

    iframe.onerror = function () { fin(null); };

    // Poll del hash de la URL del iframe: #access_token → renovado;
    // #error=... (p.ej. interaction_required) → caer a la llave.
    const inicio = Date.now();
    const tope = 7000;
    const poll = setInterval(function () {
      if (Date.now() - inicio > tope) { clearInterval(poll); fin(null); return; }
      let href = null;
      try {
        const loc = iframe.contentWindow && iframe.contentWindow.location;
        if (loc) href = String(loc.href || '');
      } catch (e) { /* cross-origin: todavía navegando en accounts.google.com */ }
      if (!href) return;
      const pos = href.indexOf('#');
      if (pos < 0) return;
      const hash = href.substring(pos + 1);
      if (hash.indexOf('error=') >= 0) { clearInterval(poll); fin(null); return; }
      if (hash.indexOf('access_token=') >= 0) {
        clearInterval(poll);
        try {
          const params = new URLSearchParams(hash);
          const token = params.get('access_token');
          if (token) { setToken(token, params.get('expires_in')); fin(token); return; }
        } catch (e) {}
        fin(null);
      }
    }, 250);

    iframe.src = url;
  });
}

// ========== REGISTRO DE BÚSQUEDAS ==========
function logSearchQuery(query) {
  // No registrar búsquedas vacías o muy cortas
  if (!query || query.trim().length < 2) return;

  // Evitar registros duplicados muy seguidos (mínimo 2 segundos entre registros)
  var now = Date.now();
  if (window._lastLogTime && (now - window._lastLogTime) < 2000) return;
  window._lastLogTime = now;

  // Enviar en segundo plano (no bloquea la búsqueda)
  var url = LOG_SCRIPT_URL
    + '?key=' + ACCESS_KEY
    + '&email=' + encodeURIComponent(userEmail || 'sin-sesion')
    + '&q=' + encodeURIComponent(query.trim());

  fetch(url).catch(function(err) {
    console.log('Error registrando búsqueda:', err);
  });
}
