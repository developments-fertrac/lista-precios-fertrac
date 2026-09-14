# Graph Report - lista-precios-fertrac  (2026-09-14)

## Corpus Check
- Corpus is ~29,652 words - fits in a single context window. You may not need a graph.

## Summary
- 229 nodes · 386 edges · 20 communities (12 shown, 7 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Catalog Search & Filter UI
- OAuth Authentication Flow
- PWA Shell & Session Kernel
- Sync & Trigger Orchestration
- Photo Cache Pipeline
- API Transport & Lock Contention
- Client Data Store & Deltas
- Activity Logging & API Gateway
- PWA Manifest
- Apps Script Config
- Price Classification
- Classification Conflict Checks
- Pending Orders Report
- Backend Configuration
- Logo Brand Variant
- Logo Detail Variant
- Logo Prices Variant
- Logo Dimensions
- Main Logo Asset

## God Nodes (most connected - your core abstractions)
1. `doGet()` - 10 edges
2. `showDetail()` - 9 edges
3. `applyFilters()` - 8 edges
4. `sincronizarNuevasReferencias()` - 7 edges
5. `_guardarEnCarpeta_()` - 7 edges
6. `actualizarFotosConError()` - 7 edges
7. `checkAuth()` - 7 edges
8. `msRefresh()` - 7 edges
9. `msSearch()` - 7 edges
10. `transport()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `logo3.png - Logo Fertrac junto a seccion Precios` --references--> `showDetail()`  [EXTRACTED]
  logo3.png → js/catalog.js
- `temporalmente_ocupado Error Response` --semantically_similar_to--> `Offline Mode (cached data display)`  [INFERRED] [semantically similar]
  docs/LOCK_APPS_SCRIPT.md → index.html
- `doGet()` --calls--> `obtenerUrlsFotosCache_()`  [INFERRED]
  gs/API.gs → gs/Photos.gs
- `doGet()` --calls--> `registrarActividad_()`  [INFERRED]
  gs/API.gs → gs/Activity.gs
- `doGet()` --calls--> `usuariosInactivos_()`  [INFERRED]
  gs/API.gs → gs/Activity.gs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Core MVC Singleton Modules (loaded in dependency order)** — js_core_store, js_core_platform, js_core_queue, js_core_api, js_core_session [EXTRACTED 1.00]
- **PWA App Shell Capabilities (manifest, offline, install, native bridge)** — index_pwa, index_offline_mode, index_capacitor, index_iframe_token_stop [INFERRED 0.85]
- **Lock Service Behavioral Contract (lock, contention, retry, error, diagnostics)** — docs_lock_apps_script_global_lock, docs_lock_apps_script_lock_contention, docs_lock_apps_script_retry_backoff, docs_lock_apps_script_temporalmente_ocupado, docs_lock_apps_script_lock_contract, docs_lock_apps_script_diagnostic [EXTRACTED 1.00]

## Communities (20 total, 7 thin omitted)

### Community 0 - "Catalog Search & Filter UI"
Cohesion: 0.08
Nodes (48): applyFilters(), autoRefresh(), buildFilters(), clearAll(), closeDetail(), CONDITION_COLOR_MAP, dataHash(), DetailView (+40 more)

### Community 1 - "OAuth Authentication Flow"
Cohesion: 0.18
Nodes (23): apiRequest(), bloquearPorInactividad(), bootstrapToken(), cerrarSesion(), checkAuth(), clearToken(), evaluarInactividad(), gaMarcarApertura() (+15 more)

### Community 2 - "PWA Shell & Session Kernel"
Cohesion: 0.12
Nodes (15): temporalmente_ocupado Error Response, Google Analytics / gtag.js Integration, Capacitor Runtime (Native Bridge), Catalog View (Search, Filters, Table, Detail Panel), Google Identity Services (GIS) iframe Token Refresh, Google Login Screen (@fertrac.com domain restriction), iframe Token Refresh Guard (window.stop), Image Viewer Modal (download + fullscreen) (+7 more)

### Community 3 - "Sync & Trigger Orchestration"
Cohesion: 0.15
Nodes (10): invalidarCacheCatalogo_(), invalidarCacheFotos_(), ejecutarCompleta_(), ejecutarDiurna_(), probarCompleta(), probarDiurna(), reordenarBaseMotor(), sincronizacionCompleta() (+2 more)

### Community 4 - "Photo Cache Pipeline"
Cohesion: 0.25
Nodes (14): actualizarFotosConError(), descargarFotosWebp(), _descargarWebp_(), _esWebpValido_(), _guardarEnCarpeta_(), _hacerPublicoLectura_(), _obtenerOCrearCache_(), obtenerUrlImagen() (+6 more)

### Community 5 - "API Transport & Lock Contention"
Cohesion: 0.23
Nodes (14): Lock Diagnostic Procedure, Global Script Lock (LockService.getScriptLock), Lock Contention / Concurrent Access, Lock Technical Contract, Frontend Retry with Exponential Backoff, colaActividadPendiente(), flushActividadPendiente(), getData() (+6 more)

### Community 6 - "Client Data Store & Deltas"
Cohesion: 0.25
Nodes (10): applyDelta(), clear(), diff(), getRow(), getRowIndex(), notify(), nRef(), rebuild() (+2 more)

### Community 7 - "Activity Logging & API Gateway"
Cohesion: 0.25
Nodes (12): generarReporteInactivos(), hojaActividad_(), registrarActividad_(), usuariosInactivos_(), doGet(), estaAutorizado_(), filtrarDelta_(), jsonError_() (+4 more)

### Community 8 - "PWA Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 9 - "Apps Script Config"
Cohesion: 0.20
Nodes (9): dependencies, enabledAdvancedServices, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access (+1 more)

### Community 10 - "Price Classification"
Cohesion: 0.42
Nodes (8): aplicarClasificacion_(), aplicarClasificacionManual(), ejecutar_aplicarClasificacionManual_desdeFilaEspecifica(), ejecutar_simularClasificacion_desdeFilaEspecifica(), _ejecutarClasificacionConLock_(), _obtenerReferenciasEnConflicto_(), simularClasificacion(), test_obtenerReferenciasEnConflicto()

### Community 11 - "Classification Conflict Checks"
Cohesion: 0.83
Nodes (3): ejecutar_validarConflictosClasificacion_desdeFilaEspecifica(), _limpiarHojaConflictos_(), validarConflictosClasificacion()

## Knowledge Gaps
- **33 isolated node(s):** `CONFIG`, `timeZone`, `enabledAdvancedServices`, `exceptionLogging`, `runtimeVersion` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 61 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `invalidarCacheCatalogo_()` connect `Sync & Trigger Orchestration` to `Activity Logging & API Gateway`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `Frontend Retry with Exponential Backoff` connect `API Transport & Lock Contention` to `PWA Shell & Session Kernel`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `doGet()` (e.g. with `registrarActividad_()` and `usuariosInactivos_()`) actually correct?**
  _`doGet()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CONFIG`, `timeZone`, `enabledAdvancedServices` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Catalog Search & Filter UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07676767676767676 - nodes in this community are weakly interconnected._
- **Should `PWA Shell & Session Kernel` be split into smaller, more focused modules?**
  _Cohesion score 0.11688311688311688 - nodes in this community are weakly interconnected._