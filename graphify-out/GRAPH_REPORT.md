# Graph Report - lista-precios-fertrac  (2026-09-11)

## Corpus Check
- Corpus is ~5,922 words - fits in a single context window. You may not need a graph.

## Summary
- 111 nodes · 193 edges · 15 communities (10 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Google Authentication
- Search Filters UI
- Catalog & Photo Cache
- PWA Manifest
- Apps Script Config
- Offline Sync
- App Shell & Integrations
- Product Card Rendering
- MultiSelect Widget
- Table Condition Styling
- Scroll to Top
- Image Modal
- iOS Install Banner
- App Config

## God Nodes (most connected - your core abstractions)
1. `applyFilters()` - 10 edges
2. `syncData()` - 9 edges
3. `buildFilters()` - 9 edges
4. `loginWithGoogle()` - 8 edges
5. `showDetail()` - 8 edges
6. `initApp()` - 7 edges
7. `msRefresh()` - 7 edges
8. `msSearch()` - 7 edges
9. `autoRefresh()` - 6 edges
10. `handleOAuthCallback()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Restricción de acceso a dominio @fertrac.com` --conceptually_related_to--> `loginWithGoogle()`  [INFERRED]
  index.html → js/auth.js
- `Google Identity Services (GIS) - login Google + renovación silenciosa` --conceptually_related_to--> `loginWithGoogle()`  [INFERRED]
  index.html → js/auth.js
- `Modo offline con datos guardados` --conceptually_related_to--> `syncData()`  [INFERRED]
  index.html → js/catalog.js
- `Botón Iniciar sesión con Google (#login-screen)` --calls--> `loginWithGoogle()`  [EXTRACTED]
  index.html → js/auth.js
- `Botón Sincronizar (#sync-btn)` --calls--> `syncData()`  [EXTRACTED]
  index.html → js/catalog.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flujo de login con Google (cuenta corporativa Fertrac)** — index_login_button, js_auth_loginwithgoogle, index_google_identity_services, index_fertrac_domain_restriction [INFERRED 0.85]
- **Patrón offline-first con sincronización manual** — index_sync_button, js_catalog_syncdata, index_offline_first [INFERRED 0.85]

## Communities (15 total, 4 thin omitted)

### Community 0 - "Google Authentication"
Cohesion: 0.19
Nodes (19): Botón Iniciar sesión con Google (#login-screen), Botón Salir / cerrar sesión (#logout-btn), apiRequest(), bootstrapToken(), cerrarSesion(), checkAuth(), clearToken(), getToken() (+11 more)

### Community 1 - "Search Filters UI"
Cohesion: 0.23
Nodes (15): Botón Limpiar búsqueda (#clear-btn), Botón cerrar panel detalle (#detail-panel), applyFilters(), buildFilters(), clearAll(), closeDetail(), fieldValues(), fval() (+7 more)

### Community 2 - "Catalog & Photo Cache"
Cohesion: 0.20
Nodes (8): allData, CONDITION_COLOR_MAP, FILTER_FIELDS, filtered, loadFotosCache(), saveFotosCache(), SEL, syncFotosCache()

### Community 3 - "PWA Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 4 - "Apps Script Config"
Cohesion: 0.20
Nodes (9): dependencies, enabledAdvancedServices, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access (+1 more)

### Community 5 - "Offline Sync"
Cohesion: 0.28
Nodes (9): Modo offline con datos guardados, Botón Sincronizar (#sync-btn), autoRefresh(), dataHash(), initApp(), loadData(), saveData(), showOfflineBanner() (+1 more)

### Community 6 - "App Shell & Integrations"
Cohesion: 0.29
Nodes (7): index.html - Lista de Precios Fertrac (SPA), Detección de runtime Capacitor (app híbrida), Restricción de acceso a dominio @fertrac.com, Google Analytics (gtag G-6XDQTNYZ58), Google Identity Services (GIS) - login Google + renovación silenciosa, Banner de instalación en iPhone (Añadir a pantalla de inicio), PWA manifest (manifest.json + meta de instalación)

### Community 7 - "Product Card Rendering"
Cohesion: 0.38
Nodes (7): drow(), extractDriveId(), formatPrice(), loadImage(), pcard(), pcardClass(), showDetail()

### Community 8 - "MultiSelect Widget"
Cohesion: 0.50
Nodes (5): msAppendMoreBtn(), msAppendOption(), msAppendPage(), msLoadMore(), msRenderOpts()

### Community 9 - "Table Condition Styling"
Cohesion: 0.67
Nodes (4): getConditionStyle(), hasCondition(), normalizeCondition(), renderTable()

## Knowledge Gaps
- **35 isolated node(s):** `timeZone`, `enabledAdvancedServices`, `exceptionLogging`, `runtimeVersion`, `oauthScopes` (+30 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 42 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loginWithGoogle()` connect `Google Authentication` to `App Shell & Integrations`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `syncData()` connect `Offline Sync` to `Search Filters UI`, `Catalog & Photo Cache`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `Google Identity Services (GIS) - login Google + renovación silenciosa` connect `App Shell & Integrations` to `Google Authentication`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `loginWithGoogle()` (e.g. with `Restricción de acceso a dominio @fertrac.com` and `Google Identity Services (GIS) - login Google + renovación silenciosa`) actually correct?**
  _`loginWithGoogle()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `timeZone`, `enabledAdvancedServices`, `exceptionLogging` to the rest of the system?**
  _35 weakly-connected nodes found - possible documentation gaps or missing edges._