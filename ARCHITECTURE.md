# Schematic JavaScript Architecture

Schematic is a zero-build static application. Production JavaScript is split by responsibility so a
change can be located and reviewed without navigating a single 6,000-line file. This is a physical
decomposition, not a runtime rewrite: the scripts retain the original shared global lexical scope and
behavior.

## Why classic scripts

Direct loading from `file://` is a supported fallback. Browsers apply CORS restrictions to native
module scripts loaded from local files, so converting to `type="module"` would make that supported path
fail. The application therefore uses ordered classic `<script>` tags at the end of `index.html` and
requires no bundler, package installation, or server runtime.

## Required load order

| Order | Script | Responsibility |
|---:|---|---|
| 1 | `js/core.js` | Constants, shared state, themes, selection, history, persistence, recovery, and top-level toolbar state |
| 2 | `js/icon-catalog.js` | Offline Lucide/Font Awesome icon data plus node decoration and link-port validation helpers |
| 3 | `js/geometry.js` | Text measurement, node sizing, containment, anchors, hit testing, and coordinate conversion |
| 4 | `js/render.js` | SVG scaffold, minimap, edge/node paths, and all canvas drawing |
| 5 | `js/routing.js` | Smart-route state, deterministic obstacle routing, route previews, typed ports, bridges, bundles, junctions, and routing commands |
| 6 | `js/model.js` | Node/edge mutations, copy/paste, alignment, layout, and related-node creation |
| 7 | `js/interactions.js` | Pointer, wheel, keyboard, inline editing, command palette, and shortcut modal behavior |
| 8 | `js/inspector.js` | Inspector rendering, edge endpoint controls, field/item editors, palettes, and reusable UI controls |
| 9 | `js/io.js` | Open/save, SQL, linting, DDL/CSV import, Mermaid/Markdown/SVG, and PNG export |
| 10 | `js/search.js` | Model-backed search index, structured queries, result navigation, discovery, and safe replacement previews |
| 11 | `js/organization.js` | Object Explorer, layers, explicit groups, effective visibility/locking, organization commands, and export filtering |
| 12 | `js/metadata.js` | Typed property/type registry, formulas, validation, metadata inspector, schema manager, and object table |
| 13 | `js/style-system.js` | Design tokens, reusable classes, offline libraries, templates, component definitions/instances, and shared style provenance |
| 14 | `js/pages.js` | Multi-page identity, canonical objects and relationships, page-local appearances, navigation, discovery, and publication |
| 15 | `js/conditional-formatting.js` | Typed visual rules layered above the style system, saved lenses, legends, and semantic zoom |
| 16 | `js/editing.js` | Capability-driven transforms, style-reference transfer, selection queries, grid/guides, shortcut preferences, and layout preview |
| 17 | `js/history.js` | Durable transactions, portable checkpoints, local automatic retention, visual diff, and restoration |
| 18 | `js/commands.js` | Shared command definitions plus ribbon, quick-access, overflow, and command-palette bindings |
| 19 | `js/context-menu.js` | Node, edge, and blank-canvas context menus |
| 20 | `js/bootstrap.js` | Starter data, initialization sequence, and the `window.__T` test/debug surface |

The order is an architectural contract. Earlier files may declare functions that call later-file
functions, but those calls must not execute until `bootstrap.js` runs after every declaration has
loaded. Only `bootstrap.js` may initialize the application.

## Placement rules

- Put code in the file owned by its reason to change, not merely where similar syntax exists.
- Keep each script in strict mode; strictness does not carry from one classic script to another.
- Do not add a second startup path or execute cross-file behavior during declaration loading.
- Preserve existing global symbol names unless a separate behavior-changing migration is approved.
- Keep document schema changes additive and independent from architectural refactors.
- Add new runtime files to `index.html` in dependency order. The test harness reads that same list, so
  a missing file or incorrect order fails `npm test`.
- Keep `window.__T` stable because tests and local debugging use it as the supported internal surface.

## Verification

Run both checks before browser QA:

```sh
for f in js/*.js; do node --check "$f" || exit 1; done
npm test
```

Then load the static app, confirm the starter diagram renders, exercise one state-changing canvas
interaction, and check that the browser console has no warnings or errors.

## Smart-routing release benchmark

`window.__T.routingRunBenchmark({sampleLimit:3000, announce:false})` builds deterministic fixtures
without mounting inactive pages. The v1 smart-router release budgets are:

| Fixture | Full route budget | One-link incremental budget | Fixture memory budget |
|---|---:|---:|---:|
| 500 nodes / 1,000 links | < 1,000 ms | < 16 ms | < 1 MB serialized |
| 1,000 nodes / 3,000 links | < 3,000 ms | < 16 ms | < 2 MB serialized |

Reference evidence recorded on 2026-07-24 (Apple M5 Max, arm64, Node 26 geometry harness):

| Fixture | Full measured | Incremental measured | Successful routes | Serialized fixture |
|---|---:|---:|---:|---:|
| 500 / 1,000 | 345.5 ms | 0.34 ms | 1,000 / 1,000 | 134,119 bytes |
| 1,000 / 3,000 | 1,232.4 ms | 0.49 ms | 3,000 / 3,000 | 364,156 bytes |

The browser preview runs the same geometry core in small event-loop batches, so broad work remains
cancelable and saving is not blocked between batches. These numbers are release evidence, not a
portable performance guarantee; rerun the command when the router algorithm or fixture changes.
