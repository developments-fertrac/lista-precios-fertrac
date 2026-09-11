# Graph Report - lista-precios-fertrac  (2026-09-11)

## Corpus Check
- 6 files · ~11,025 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 110 nodes · 189 edges · 18 communities (11 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.82)
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
- Service Worker
- Community 15
- Community 16

## God Nodes (most connected - your core abstractions)
1. `applyFilters()` - 10 edges
2. `buildFilters()` - 9 edges
3. `showDetail()` - 9 edges
4. `index.html (App Shell)` - 8 edges
5. `initApp()` - 7 edges
6. `syncData()` - 7 edges
7. `msRefresh()` - 7 edges
8. `msSearch()` - 7 edges
9. `autoRefresh()` - 6 edges
10. `apiRequest()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `logo3.png - Logo Fertrac junto a seccion Precios` --references--> `showDetail()`  [EXTRACTED]
  logo3.png → js/catalog.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline-First PWA / Hybrid App Shell** — index_pwa, index_capacitor, index_offline_mode, index [INFERRED 0.75]
- **Product Browsing Experience** — index_catalog_view, index_image_viewer, index [INFERRED 0.75]

## Communities (18 total, 6 thin omitted)

### Community 0 - "Google Authentication"
Cohesion: 0.22
Nodes (17): apiRequest(), bootstrapToken(), cerrarSesion(), checkAuth(), clearToken(), getToken(), handleOAuthCallback(), initGIS() (+9 more)

### Community 1 - "Search Filters UI"
Cohesion: 0.15
Nodes (8): allData, CONDITION_COLOR_MAP, FILTER_FIELDS, filtered, loadFotosCache(), saveFotosCache(), SEL, syncFotosCache()

### Community 2 - "Catalog & Photo Cache"
Cohesion: 0.23
Nodes (12): drow(), extractDriveId(), formatPrice(), getConditionStyle(), hasCondition(), loadImage(), normalizeCondition(), pcard() (+4 more)

### Community 3 - "PWA Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 4 - "Apps Script Config"
Cohesion: 0.20
Nodes (9): dependencies, enabledAdvancedServices, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access (+1 more)

### Community 5 - "Offline Sync"
Cohesion: 0.33
Nodes (9): index.html (App Shell), Google Analytics (gtag G-6XDQTNYZ58), Capacitor Runtime Detection (capacitor.js), Catalog Search/Filter/Detail UI, Google Identity Services (gsi/client), Google OAuth Login (loginWithGoogle, @fertrac.com), Product Image Modal with Download, Offline Mode & Sync Status (+1 more)

### Community 6 - "App Shell & Integrations"
Cohesion: 0.33
Nodes (9): applyFilters(), clearAll(), closeDetail(), fieldValues(), fval(), msAppendOption(), msRefresh(), msToggleOpt() (+1 more)

### Community 7 - "Product Card Rendering"
Cohesion: 0.60
Nodes (5): buildFilters(), msClear(), msClose(), msSearch(), msToggle()

### Community 8 - "MultiSelect Widget"
Cohesion: 0.83
Nodes (4): initApp(), loadData(), showOfflineBanner(), syncData()

### Community 9 - "Table Condition Styling"
Cohesion: 0.67
Nodes (4): msAppendMoreBtn(), msAppendPage(), msLoadMore(), msRenderOpts()

### Community 10 - "Scroll to Top"
Cohesion: 0.67
Nodes (3): autoRefresh(), dataHash(), saveData()

## Knowledge Gaps
- **28 isolated node(s):** `background_color`, `description`, `display`, `icons`, `name` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 40 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showDetail()` connect `Catalog & Photo Cache` to `Search Filters UI`, `Scroll to Top`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `background_color`, `description`, `display` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._