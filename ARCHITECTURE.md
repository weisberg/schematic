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
| 5 | `js/model.js` | Node/edge mutations, copy/paste, alignment, layout, and related-node creation |
| 6 | `js/interactions.js` | Pointer, wheel, keyboard, inline editing, command palette, and shortcut modal behavior |
| 7 | `js/inspector.js` | Inspector rendering, edge endpoint controls, field/item editors, palettes, and reusable UI controls |
| 8 | `js/io.js` | Open/save, SQL, linting, DDL/CSV import, Mermaid/Markdown/SVG, and PNG export |
| 9 | `js/search.js` | Model-backed search index, structured queries, result navigation, discovery, and safe replacement previews |
| 10 | `js/organization.js` | Object Explorer, layers, explicit groups, effective visibility/locking, organization commands, and export filtering |
| 11 | `js/metadata.js` | Typed property/type registry, formulas, validation, metadata inspector, schema manager, and object table |
| 12 | `js/conditional-formatting.js` | Typed visual rules, deterministic cascade and provenance, saved lenses, legends, and semantic zoom |
| 13 | `js/editing.js` | Capability-driven transforms, style transfer, selection queries, grid/guides, shortcut preferences, and layout preview |
| 14 | `js/history.js` | Durable transactions, portable checkpoints, local automatic retention, visual diff, and restoration |
| 15 | `js/commands.js` | Shared command definitions plus ribbon, quick-access, overflow, and command-palette bindings |
| 16 | `js/context-menu.js` | Node, edge, and blank-canvas context menus |
| 17 | `js/bootstrap.js` | Starter data, initialization sequence, and the `window.__T` test/debug surface |

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
