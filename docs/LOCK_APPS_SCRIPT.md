# LOCK GLOBAL de Apps Script — bloquea la hoja y falla la sincronización

> ⚠️ **ANOTACIÓN CRÍTICA (2026-09-11):** cuando cualquier función de Apps Script
> de este proyecto se está ejecutando (una sincronización, recolección/descarga de
> fotos, clasificación o revalidación), el **Excel/hoja queda bloqueado** para uso
> concurrente y **la sincronización de la app falla** con `temporalmente_ocupado`.
> No es una falla de la app: es el comportamiento **esperado y por diseño** del
> `LockService` global del script. La app reintenta sola.

## 1. Qué es el lock global

Todos los `.gs` usan `LockService.getScriptLock()`, que en Apps Script es un
**único candado por PROYECTO de script** (no por hoja, no por función):

- **Solo UNA función del script puede ejercerlo a la vez.**
- No es reentrante: si una función con el lock llama a otra petición que intenta
  tomarlo (la API → `obtenerDatosListaCacheados_`), **falla**, no se encola.
- Se libera automáticamente cuando la función termina (o al cortarse), aunque se
  recomienda `finally { lock.releaseLock(); }`.
- Los intentos de tomar el lock son **con espera limitada** (`tryLock(ms)`): si al
  cabo de `ms` no se consigue, la función **salta/omite** (jobs de fondo) o
  devuelve `temporalmente_ocupado` (la API).

## 2. Quién usa el lock (mapa actual — 13 sitios)

| Archivo | Función (sitio) | `tryLock` | Efecto si ya está ocupado |
|---|---|---|---|
| `API.gs:127` | Lectura del catálogo (`obtenerDatosListaCacheados_`) | **1500 ms** | Responde `{"error":"temporalmente_ocupado"}` → la app reintenta |
| `Sync.gs:21` | `sincronizarListaABaseMotor` (diurna, cada 5 min) | 10 000 ms | Omite la ejecución (log `🔒`) |
| `Sync.gs:52` | `sincronizacionCompleta` (con/sin correo) | 10 000 ms | Omite la ejecución |
| `Sync.gs:77` | `probarDiurna` (manual/prueba) | 10 000 ms | Omite |
| `Sync.gs:90` | `probarCompleta` (manual/prueba) | 10 000 ms | Omite |
| `Photos.gs:67` | `recolectarUrlsYGuardarCache` (bulk sobre LISTA→CACHE) | 60 000 ms | Omite |
| `Photos.gs:159` | `sincronizarNuevasReferencias` | 60 000 ms | Omite |
| `Photos.gs:319` | `descargarFotosWebp` (descarga masiva a Drive) | `FOTOS_MAX_MS` | Omite |
| `Photos.gs:452` | `procesarPendientesDrive` (lotes con checkpoint) | `FOTOS_MAX_MS` | Omite |
| `Photos.gs:822` | `actualizarFotosConError` | `FOTOS_MAX_MS` | Omite |
| `Photos.gs:1018` | `revalidarErroresCache` | `FOTOS_MAX_MS` | Omite |
| `Classification.gs:39` | `_ejecutarClasificacionConLock_` (E,F,G,I en Hoja2) | 30 000 ms | Omite |
| `Triggers.gs:65` | `liberarLock` (desbloqueo MANUAL de emergencia) | — | **Libera**, no bloquea |

## 3. Síntomas cuando hay un job en curso (con lock tomado)

**En la hoja (el "Excel"):**
- Mientras corre un job pesado (recolector de fotos, descarga webp, clasificación,
  sync completa), Google Sheets restringe la edición concurrente: los cambios de
  otros usuarios **pueden esperar o fallar**, se ven rangos "bloqueados" y la hoja
  puede quedar lenta hasta que el job termine.

**En la app (web y móvil):**
- El auto-refresh muestra: `Auto-refresh falló (se conservan los datos previos): Error: temporalmente_ocupado`.
- El botón manual muestra: `⚠️ Error al sincronizar`.
- El mapa de fotos muestra: `Cache de fotos no actualizado: Error: temporalmente_ocupado`.
- **Datos importantes:** son mensajes **transitorios**; la app **conserve los datos
  previos** y **NO se corrompe**. El frontend ya reintenta solo:
  - `apiRequest` (js/auth.js): revisa `temporalmente_ocupado` y reintenta hasta 2 veces
    con backoff (0.8 s / 1.6 s) — contrato del backend "reintente al instante".
  - `syncFotosCache` (js/catalog.js): reintenta en silencio a los 5 min.
  - El siguiente auto-refresh sigue el ciclo normal y, cuando el lock se libera,
    la sincronización completa devuelve el catálogo.

**Regla general:** un `temporalmente_ocupado` NO es un error de código; es el
sistema diciendo "otro proceso está con el lock, vuelve en unos segundos".

## 4. Cómo diagnosticar (por qué "se traba")

1. Abre Apps Script → panel **Ejecuciones** (Execution) o **Actividad**.
2. Si hay una función **pesada corriendo** (lista anterior), ese es el motivo:
   - descarga/recolección de fotos y clasificación pueden tardar **minutos**,
   - la sync cada 5 min retiene el lock mientras relee/reescribe Hoja2.
3. Verás en logs de la API `🔒` (jobs omitidos) y respuestas `temporalmente_ocupado`.

## 5. Recomendaciones para que "no bloquee el Excel ni falle la sincronización"

- **No lanzar a mano** jobs pesados (`recolectarUrlsYGuardarCache`,
  `descargarFotosWebp`, `procesarPendientesDrive`, `actualizarFotosConError`,
  `revalidarErroresCache`, clasificación) **en horario de demanda**; hazlo fuera
  del horario laboral o en lotes pequeños (`procesarPendientesDrive` ya procesa
  por lotes con checkpoint).
- Evita **solapar** trigger de fotos con el trigger de sync de 5 min: mientras
  corra uno, el otro omite su turno.
- La app **ya no se queda muerta** gracias a los reintentos del frontend; si hay
  un job de fondo, la app simplemente espera al ciclo siguiente.
- Si un lock quedara colgado > 5 min (raro), ejecuta `liberarLock()` desde el
  editor (Tasks `Triggers.gs`) para forzar el desbloqueo.

## 6. Contrato técnico resumido

- **Escritas (jobs):** `tryLock` de 10–60 s; si está ocupado → **omiten** (mejor
  perder el turno que bloquear).
- **Lecturas (API):** `tryLock(1500)`; si está ocupado → `temporalmente_ocupado`
  en ≤ ~1.8 s **para que el frontend reintente al instante**.
- **Frontend:** reintento automático con backoff (impleentado en `apiRequest`).
- Un cambio en este comportamiento debe actualizar este documento **y** los
  comentarios `⚠️ LOCK GLOBAL` de los `.gs`.