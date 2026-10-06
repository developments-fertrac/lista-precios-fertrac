// ============================================================
// CONFIG — Constantes del frontend (única fuente de verdad)
// ============================================================

const CLIENT_ID = '748686271759-3ebepqvfssbpn650m8pu1l6umdq093fo.apps.googleusercontent.com';
// Cliente OAuth WEB (navegador/PWA en app.fertrac.com). El nativo Android sigue con CLIENT_ID.
const WEB_CLIENT_ID = '13363096447-a96qshpi1rg9ahoc72t9e04p0nqp000a.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'fertrac.com';

// redirect_uri OAuth canónico: siempre la raíz del origen actual (sin path, query ni hash).
// Debe coincidir EXACTO con un "URI de redireccionamiento autorizado" en Google Cloud Console:
//   https://app.fertrac.com/   (producción)
const OAUTH_REDIRECT_URI = window.location.origin + '/';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlz5V2vPDn1GonrxoFB1zn6hjwV8c5YKe8Jm34bv3u2NtJ6SxT4WeaIST1_JzKIpix/exec';
const ACCESS_KEY = 'fertrac2024';
const ENFORCE_REVOCACION = false; // TRANSICIÓN: false = no bloquea (cae a la llave). En el CIERRE: poner true.
const LOG_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlz5V2vPDn1GonrxoFB1zn6hjwV8c5YKe8Jm34bv3u2NtJ6SxT4WeaIST1_JzKIpix/exec';

// ── Índices de columnas del catálogo (fila de Hoja2) ──
const C = {
  REF: 0, FOTO: 1, ALTERNOS: 2, PRODUCTO: 3, CATEGORIA: 4,
  SUBCATEGORIA: 5, TIPO: 6, LINEA: 7, MARCA: 8, APLICACION: 9,
  PRECIO_BRUTO: 10, NETO_5: 11, NETO_8: 12, PRECIO_PROMO: 13,
  UND_ESCALA: 14, UND_MIN: 15, UND_MAX: 16, PROMO_FIN: 17,
  INV: 18, UND_RM: 19, UND_RMC: 20, CONDICION: 21
};
