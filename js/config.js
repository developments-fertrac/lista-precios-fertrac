// ============================================================
// CONFIG — Constantes del frontend (única fuente de verdad)
// ============================================================

const CLIENT_ID = '748686271759-3ebepqvfssbpn650m8pu1l6umdq093fo.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'fertrac.com';

const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/fertrac.com/s/AKfycbwccxPfzNTHEF6eHJfParY7QFxae3e2pWBL9XdlSiFSOPVgO3FpBmmFzqcTHDntC9VX/exec';
const ACCESS_KEY = 'fertrac2024';
const ENFORCE_REVOCACION = false; // TRANSICIÓN: false = no bloquea (cae a la llave). En el CIERRE: poner true.
const LOG_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby3OhWsKDmMO2Rdc29032QkMfXspV9exqSwETiwSoR5dZpT1XZs0bwHS-xG-6VQh9Zb/exec';

// ── Índices de columnas del catálogo (fila de Hoja2) ──
const C = {
  REF: 0, FOTO: 1, ALTERNOS: 2, PRODUCTO: 3, CATEGORIA: 4,
  SUBCATEGORIA: 5, TIPO: 6, LINEA: 7, MARCA: 8, APLICACION: 9,
  PRECIO_BRUTO: 10, NETO_5: 11, NETO_8: 12, PRECIO_PROMO: 13,
  UND_ESCALA: 14, UND_MIN: 15, UND_MAX: 16, PROMO_FIN: 17,
  INV: 18, UND_RM: 19, UND_RMC: 20, CONDICION: 21
};
