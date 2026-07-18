# Schematic — Implementation Plan & Backlog

**Document purpose.** This file is the authoritative plan for the Schematic static app. It is written
to be executed by a lower-capability model (e.g., Opus 4.8, GPT-5.5) with minimal ambiguity.
Follow it literally. Where this document and your intuition disagree, this document wins.
Where the existing code and this document disagree, STOP and flag the discrepancy instead of
guessing.

**Product definition.** Schematic is a static browser application that combines business
mind mapping (concept nodes), database ER modeling (table nodes with typed fields,
crow's-foot relations, SQL DDL export), and to-do lists (checkable items, connectable at
list or item granularity) on one canvas.

---

## 1. Deployment model — READ THIS FIRST

Schematic is **not** a SaaS application. There is **no backend, no Node.js runtime, no
server-side processing, no build step, no database, no auth, no telemetry**. Ever.

The deployment story is:

1. `index.html`, `styles.css`, and the `js/` directory are placed on **any static web server**
   (nginx, Apache, IIS, S3, GitHub Pages, SharePoint, `python -m http.server`) — or opened
   directly from disk via `file://`.
2. The browser loads the static HTML/CSS/JS. That is the entire application.
3. Documents are **loaded from and saved to the user's local operating system** —
   the server never sees document data. Persistence mechanisms, in priority order:
   - **File System Access API** (`showOpenFilePicker` / `showSaveFilePicker` /
     `FileSystemFileHandle.createWritable`) for true Open / Save / Save-As against local
     files. Available in Chromium browsers in a **secure context** (HTTPS or
     `http://localhost`). **Not available** over plain HTTP on a LAN IP, over `file://`,
     or in Firefox/Safari.
   - **Fallback (must always work):** download via Blob + `<a download>` (already
     implemented) and load via `<input type="file">` (already implemented).
4. The app must remain fully functional **offline** once loaded (fonts degrade to system
   fallbacks; no feature may hard-depend on a CDN).

### Hard platform rules (violating any of these fails review)

| # | Rule |
|---|------|
| P1 | Static committed HTML/CSS/JS files only. No bundler, no npm packages at runtime. |
| P2 | No server round-trips for any feature. `fetch()` to any origin is forbidden except optional font loading already present in `<head>`. |
| P3 | Node.js and jsdom are **development-time test tools only** (`test.js`). They must never become runtime dependencies. |
| P4 | Every persistence feature must have a fallback path that works in Firefox/Safari and over `file://`. Feature-detect (`"showOpenFilePicker" in window`), never UA-sniff. |
| P5 | `localStorage`/`sessionStorage` must not be required for core features (the file also runs inside a claude.ai artifact where these APIs are unavailable). If used at all (e.g., crash-recovery cache), wrap in `try/catch`, feature-flag it, and keep an in-memory fallback. |
| P6 | No cookies, no analytics, no external calls with document content. Document data exists only in memory and in files the user explicitly chooses. |

---

## 2. Architecture snapshot (as of 2026-07-15)

Files: `index.html`, `styles.css`, nine ordered classic scripts in `js/`, plus
development-only `test.js`. See `ARCHITECTURE.md` for the dependency order and placement rules.
SVG-based canvas; all SVG styling via **presentation attributes** (not CSS classes) so that
PNG export via `XMLSerializer` works without a stylesheet.

### 2.1 Runtime scripts (load order is a contract)

`core` → `geometry` → `render` → `model` → `interactions` → `inspector` → `io` →
`context-menu` → `bootstrap`.

The scripts deliberately remain classic scripts rather than native ES modules: direct `file://`
loading is a platform requirement, and module scripts are blocked by browser CORS rules in that
mode. Each script has its own `"use strict"` directive and shares the existing global lexical scope.
Add new code to the script matching its responsibility; only `bootstrap.js` may start the app.

### 2.2 Data model (exact shapes — additive changes only, never rename keys)

```json
{
  "version": 1,
  "meta": { "theme": "light", "dialect": "ansi", "recentColors": ["#ab12cd"] },
  "nextId": 42,
  "nodes": [
    { "id": "n1", "type": "concept", "x": 60, "y": 220,
      "title": "Loyalty program launch", "notes": "…",
      "color": "#FFE9A8", "fontSize": 14, "fontColor": "#16232F",
      "shape": "decision" },
    { "id": "n5", "type": "table", "x": 640, "y": 60,
      "title": "customers", "notes": "", "color": "#16232F",
      "fontSize": 11.5, "fontColor": "#16232F", "collapsed": false,
      "fields": [
        { "id": "f_cust_pk", "name": "customer_id", "type": "SERIAL",
          "pk": true, "fk": false, "nullable": false,
          "default": "nextval('seq')", "unique": false, "index": false,
          "comment": "stable source identifier" }
      ] }
  ],
  "edges": [
    { "id": "n9", "from": "n5", "to": "n6", "kind": "1:N", "label": "",
      "labelTextColor": "#C20029", "labelBackgroundColor": "#FFFFFF",
      "fromField": "f_cust_pk", "toField": "f_ord_cust",
      "pairs": [{ "fromField": "f_cust_pk", "toField": "f_ord_cust" }] }
  ]
}
```

- To-do nodes (v1.1): `{ "id": "n12", "type": "todo", "x": 0, "y": 0, "title": "Launch checklist",
  "notes": "", "color": "#E9E2F8", "items": [ { "id": "n13", "text": "Approve copy", "done": true } ] }`
  — `done` is optional (absent = false, never written as `false`); item ids share the node
  id namespace and are referenced by `fromField`/`toField` exactly like table field ids.
- Rich-note nodes (v1.7): `{ "id":"n14", "type":"note", "x":0, "y":0,
  "title":"Decision context", "content":"## Evidence\n- **Strong** signal", "color":"#FFE9A8",
  "fontSize":13, "w":300 }` — `content` stores Markdown-style source; `w` is optional.
- Status nodes (v1.17): `{ "id":"n15", "type":"status", "x":0, "y":0,
  "title":"Launch approval", "status":"In progress", "statusSide":"right",
  "color":"#CFE8FF", "fontSize":18, "w":320 }`. `statusSide` is `left|right`;
  `status` is one built-in label or a document-wide custom label.
- Any node may include `manualWidth:true` with `w` (v1.16, additive) after a multi-selection
  width-matching action. Without the flag, each node type keeps its legacy auto/default sizing;
  with the flag, `w` is the exact rendered width (clamped to 80–4000). Text, note, frame, and
  swimlane nodes may also carry `widthBeforeMatch` so Reset size can restore their prior configured
  width; it is absent for content-sized concepts, tables, and to-dos.
- Concept nodes may include optional `shape` ∈ `process|decision|terminator|data|document|manualInput`.
  It is presentation-only, applies only to concept nodes, and is absent for the default
  `process` rectangle so all older documents render unchanged.
- `kind` ∈ `link | 1:1 | 1:N | N:M`. Convention: **`from` = the "one" side**. Relation
  kinds are table↔table only; edges touching a to-do list, rich note, plain text, or status node
  are always `link`.
- `fromField`/`toField` are optional row-id bindings (field- or item-level anchoring).
- `fromAnchor`/`toAnchor` (v1.3, additive) optionally pin a whole-node edge end to one of
  the 9 attachment points ∈ `tl|tc|tr|ml|mc|mr|bl|bc|br` (3×3: top/middle/bottom ×
  left/center/right). Absent = auto: the end snaps to the nearest perimeter point toward
  the other end. Ignored when that end is row-bound.
- `pairs` is optional and supersedes `fromField`/`toField` for composite relations; for
  one-pair relations, both shapes may be written for backward compatibility.
- `labelTextColor` and `labelBackgroundColor` are optional edge-label overrides. Absent
  text color inherits the live edge color; absent background color inherits the active
  theme label background, preserving the appearance of existing documents.
- Table fields may include optional `default`, `unique`, `index`, and `comment` keys.
- Table nodes may include `collapsed`; collapsed tables render header + field count.
- `meta.theme`, `meta.dialect`, and `meta.recentColors` are optional document metadata.
- `meta.customStatuses` (v1.17, additive) is the shared, case-insensitively deduplicated list
  of custom status labels in the diagram. Built-in labels are never written there.
  Imports also recover custom labels already used by status nodes when older JSON lacks this key.
- `meta.colorScheme` (v1.4, additive) optionally carries a custom color scheme that
  replaces the built-in palettes and defaults while the document is open:
  `{ "name"?, "concept"?: [hex…], "table"?: [hex…], "font"?: [hex…], "frame"?: hex,
  "todo"?: hex, "theme"?: { "light"?: {…}, "dark"?: {…} } }`. All keys optional;
  palette arrays cap at 12 entries; `theme` overrides accept only the keys of the
  built-in `THEME` objects. Everything is validated through `normalizeColorScheme`
  on import (invalid colors are dropped; an empty scheme collapses to absent).
  Node colors already written into the document are untouched — the scheme changes
  swatch palettes, new-node defaults, and (via `theme`) canvas + UI chrome colors.
- `fontSize`/`fontColor` are optional; absence means defaults
  (`CONCEPT_FS_DEFAULT = 14`, `NOTE_FS_DEFAULT = 13`, `STATUS_FS_DEFAULT = 18`,
  `TABLE_FS_DEFAULT = 11.5`, color `#16232F`).

### 2.3 Key functions (call these; do not reimplement)

| Area | Functions |
|---|---|
| State/history | `snapshot`, `restore`, `pushHistory(coalesceKey?)`, `pushHistoryOnce`, `undo`, `redo`, `serializeDocument`, `importDocText`, `migrateDocument` |
| Geometry | `nodeSize`, `nodeRect`, `nodeRows(n)` ← shared row accessor (table fields / todo items), `tableMetrics(n)` ← single source of truth for row math, `conceptFont`, `noteFont`, `richNoteLayout`, `fieldRowCenterY`, `fieldAnchor`, `anchorOnRect`, `clientToWorld`, `hitTest(worldPt)` |
| Render | `render()` (full), `drawOnly()` (canvas only, preserves inspector DOM/focus), `drawNode`, `drawRichNote`, `drawStatusNode`, `drawEdge`, `edgeEndpoints`, `edgePath`, `drawNotation`, `el(tag, attrs, parent)` |
| Mutations | `addNode`, `addEdge(fromEp, toEp)` (endpoint = `{id, fieldId?}`), `addChildConcept`, `addRelatedTable`, `duplicateSelection`, `deleteSelection`, `reorderNode`, `moveField`, `cleanFieldRefs`, `ensureFieldIds` |
| UI builders | `frow`, `mkInput`, `mkBtn`, `mkFlag`, `swatches`, `customColorRow`, `sizeStepper`, `normalizeHex`, context menu: `showCtx/hideCtx/ctxItem/ctxSep/ctxLabel/ctxSwatches/ctxSizeRow`, menus: `nodeMenu/edgeMenu/canvasMenu` |
| I/O | `openDoc`, `saveDoc`, `saveAsDoc`, `newDoc`, `download(name, text, mime)`, JSON import handler, `generateSQL`, `ident`, PNG export handler |

### 2.4 Engineering invariants (violating any of these fails review)

| # | Invariant |
|---|---|
| E1 | Call `pushHistory()` **before** every state mutation. For continuous inputs (typing, color-well drag, stepper holds) pass a coalesce key like `"color:"+n.id`, `"fs:"+n.id` so a burst = one undo step. |
| E2 | Live edits from inspector/menu inputs call `drawOnly()`; committed values call `render()`. Never call `render()` from an `input` event of a control inside the inspector — it destroys the control mid-typing. |
| E3 | All table row geometry (header height, row height, badges, baselines) comes from `tableMetrics(n)`. Never hardcode `34`, `23`, or similar. Drawing, hit-testing, anchors, drop previews, and handles must share it. |
| E4 | Field ids are stable and referenced by edges. On field delete call `cleanFieldRefs(fid)`; on node duplicate remap all field ids; on import call `ensureFieldIds()`. |
| E5 | SVG styling by attributes only (fills, strokes, fonts as attributes). CSS classes on SVG are allowed solely for hover-visibility tricks that PNG export strips (`[data-handle]`, `[data-fieldhandle]`). |
| E6 | Identifiers in generated SQL go through `ident()`. |
| E7 | Never use `<form>` submission, `alert`-driven flows for normal UX, or synchronous blocking loops. |
| E8 | JSON schema changes are additive. New optional keys only. If a breaking change is unavoidable, bump `version` and add a migration in the import path (see SCH-005). |
| E9 | Canvas is pointer-events based (`pointerdown/move/up`, `setPointerCapture`). Do not mix in mouse/touch event handlers. |
| E10 | `user-select` stays disabled on the SVG; text elements keep `pointer-events:none`. |

### 2.5 Test harness (development only)

`test.js` runs under Node + jsdom (`npm install`; `npm test`). It reads the runtime script order
directly from `index.html`, concatenates those sources into one strict eval, and covers the current
Phase A lifecycle and regression surface.
Harness quirks you must respect:

- Canvas 2D is stubbed (`measureText` ≈ `7px * length`); layout rects are stubbed.
- The ordered runtime scripts are executed together with `window.eval(script)`. Access internals
  only through the `window.__T` hook (extend the hook when a new internal is needed).
- `render()` rebuilds SVG layers; DOM references captured before a render are **stale**.
  Re-query elements after any render.
- Every feature PR adds assertions. The suite must end `ALL TESTS PASSED`.

### 2.6 Executor workflow (mandatory, in order)

1. Read §1 and §2 of this document fully.
2. Run `npm test` — confirm baseline green before touching behavior.
3. Implement in `index.html`, `styles.css`, and/or the responsibility-matched file in `js/`.
4. Run `for f in js/*.js; do node --check "$f" || exit 1; done`.
5. Extend `test.js` with assertions for the new behavior; run until `ALL TESTS PASSED`.
6. Manually sanity-check in a browser if available (drag, connect, undo, Open/Save, export JSON/SQL/PNG).
7. Update §3 (Existing features) and mark the backlog item done with date.
8. Deliverable = updated static app files plus updated `test.js`/`PLAN.md` when behavior or test coverage changes.

---

## 3. Existing features (implemented, tested)

**Canvas & interaction**
- Infinite pannable/zoomable SVG canvas (two-axis wheel pan, Shift+vertical-wheel zoom
  at cursor 0.2–3×, Alt/middle-drag pan, drag-empty marquee select, dot-grid background),
  Fit view (`F`), 4px grid snap on
  node drag, arrow-key nudge (Shift = 24px), Esc deselect, no text-selection during drags.
- Selection model: single node/edge plus multi-node selection; selection drives inspector.
- Auto-layout tools: concept-tree layout from the selected/root concept and layered schema
  layout for table relations; each layout is one undo step.
- Minimap overlay with viewport rectangle and click/drag panning, skipped automatically
  for very large documents.

**Nodes**
- Concept nodes: title, notes (dot indicator), fill color, per-node font size (9–48px)
  and font color; box auto-fits text.
- Rich-note nodes: title plus safe Markdown-style multiline content (headings, lists,
  tasks, blockquotes, bold, italic, and inline code), folded-note canvas rendering,
  configurable width/color/type, palette search, Markdown export, and node-level links.
- Status nodes: wrapped text plus a colored left/right status band; five built-in states,
  per-node selection, and a diagram-wide custom-label catalog edited in the inspector.
- Table nodes: name, header color, fields (name, SQL type w/ datalist, PK/FK/NULL flags,
  reorder ↑↓, delete), per-node base font size (8–28px) scaling the entire node via
  `tableMetrics`, font color applied to field names; PK/FK badges; "no fields yet" state.
- Table fields support optional default values, unique/index flags, and comments; unique
  fields render a `U` badge, comments render as field-name tooltips, and indexed fields
  emit SQL index statements.
- Table nodes support notes with dot indicators and collapsible field rows; collapsed
  tables retain relation anchoring through node-boundary fallback.
- Frame nodes: labeled subject-area rectangles drawn behind nodes; drag a frame to move
  nodes contained by center point; resize via corner handle; frames are not edge targets.
- Add via toolbar, keyboard (`C`/`S`/`N`/`T`), double-click empty canvas, command palette, or
  context menu ("here").
- Duplicate (Ctrl+D, remaps node/field ids and internal edges), copy/cut/paste
  (Ctrl/Cmd+C/X/V with in-memory clipboard and best-effort OS clipboard), delete
  (removes attached edges), z-order (bring to front / send to back), Tab = add linked child concept,
  "Add related table (1:N)" = child table pre-wired with FK column + bound edge.

**Edges**
- Kinds: `link` (dashed freeform) and `1:1`/`1:N`/`N:M` with crow's-foot notation.
- Semantic labels offer 16 relationship presets (Contains through Validates) with their
  meanings in the inspector and context menu; arbitrary custom label text remains supported.
- Whole-node anchoring (boundary point toward the other end) and **field-level anchoring**
  (per-row ○ handles on hover, drag to another field/node, live drop-target highlight,
  anchor dots on bound ends, inspector attachment dropdowns per end).
- Composite relation bindings via `pairs: [{fromField,toField}]`, including inspector
  add/remove controls, multi-column SQL FKs, and relation labels with column counts.
- Auto-orientation on field↔field drags (PK side becomes "from"), swap direction
  (carries bindings), inline-editable labels, duplicate rejection at field granularity.
- Per-edge routing: curved default or orthogonal Manhattan routing via inspector/context menu;
  routing round-trips in JSON and keeps crow's-foot notation.
- Per-edge appearance: optional start/end arrowheads, custom line color, 1–8px width,
  and solid/dashed/dotted style through both the inspector and context menu. Existing
  links retain dashed defaults, relations retain solid defaults, and old documents gain
  no arrowheads. Styled lines and arrowheads remain portable in SVG/PNG exports.

**To-do lists (v1.1)**
- Third node type `todo`: titled list of checkable items with a `done/total` progress
  header, checkbox toggle on canvas (one undo step each), strikethrough + muted done
  items, per-node color/font size/font color (`fontColor` styles the header only — item
  rows always use theme ink so a light header color cannot blank them, issue #44), notes,
  collapse (header + `n items`), "no items yet" empty state.
- Item editing in the inspector (text, DONE flag, reorder ↑↓, delete with edge-ref
  cleanup, add) and context menu (add item, collapse/expand); add via toolbar "+ To-do",
  keyboard `D`, canvas context menu, or the command palette.
- Inline row editing on canvas: double-click a table field row or a to-do item row to
  edit the field name / item text in place (same overlay as SCH-013 — Enter commits as
  one undo step, Esc cancels); double-click on the header, a concept, or an edge label
  still edits title/label; checkbox/handle/collapse targets are excluded.
- Double-click detection is pointer-based (two plain presses within 400ms and 6px, per
  E9), NOT the native `dblclick` event: the first press re-renders and replaces the SVG
  element under the cursor, which makes browsers retarget or drop `dblclick` entirely.
  Do not reintroduce a `dblclick` listener on the board.
- Connections at list or item granularity: per-row ○ handles reuse the field machinery
  via the shared `nodeRows(n)` accessor; bindings live in the existing
  `fromField`/`toField` keys; collapsed lists re-anchor bound edges to the node boundary;
  edges touching a to-do are always `link` (relation kinds stay table↔table, hidden in
  edge editors for to-do edges).
- Interop: Markdown outline renders task lists (`- [ ]` / `- [x]`, nested under linked
  concepts); SQL/Mermaid exports ignore to-dos (headers note the omission); lint warns on
  empty lists and errors on relation kinds touching a to-do; palette indexes
  `list.item text`; copy/paste and duplicate remap item ids and preserve item-bound
  edges; tree auto-layout includes link-connected to-dos; SVG/PNG exports render
  checkboxes and strip handles.

**Canvas & workflow (v1.2.0, issues #40/#41/#43/#46/#47)**
- Snap to grid: a "Snap" toolbar toggle makes drags snap to the 24px dot grid (off =
  fine 4px grid as before); holding Shift during a drag temporarily uses the same 24px
  grid without changing the toggle; "Clean Up" snaps every node to the dot grid in one undo step.
- Space+drag pans the canvas regardless of what is under the cursor (space is ignored
  while typing; listed in the shortcut cheat sheet).
- Auto-save: a status-bar toggle debounce-saves every change (including undo/redo, via
  the `setDocDirty` choke point) back to the open FSA file handle; enabling it without a
  handle runs Save As first, and it is unavailable without the File System Access API.
- Duplicate table names are rejected: renames via the inspector or the inline editor
  that collide (by `ident()` key) show a notice modal and revert; new/related/pasted/
  duplicated tables auto-uniquify (`name_2`, `name_3`, …).
- The app version (`APP_VERSION`) is shown at the right end of the header.

**Attachment points (v1.3.0)**
- Every non-frame node exposes 9 attachment points (3×3 grid; corners, edge midpoints,
  center). Whole-node edge ends snap to the nearest perimeter point automatically and
  re-snap as nodes move.
- Hovering a node reveals the point handles (the right-middle one stays visible as the
  primary connect affordance); dragging from a specific point pins that end
  (`fromAnchor`), and dropping within 16px of a target's point pins the other end
  (`toAnchor`) — pinned ends draw an anchor dot. Drops elsewhere stay on auto.
- The edge inspector offers "From point"/"To point" selectors ((auto) + the 9 points,
  center included) for ends without a row binding; Swap direction carries pinned points;
  copy/paste/duplicate preserve them; JSON round-trips them (`swapEdgeDirection`,
  `nodeAnchor`, `anchorPointsForRect`, `nearestAnchorWithin`).
- Row-level (field/item) anchoring is unchanged and takes precedence over node points.
- Endpoint editing (v1.3.1): selecting an edge shows a grip at each end (drawn in
  `draftLayer` so they sit above the node anchor handles); dragging a grip moves that
  end to another attachment point, a field/item row, or a different node entirely
  (`reattachEdgeEnd` — duplicate/self-loop drops cancel, composite pairs collapse to the
  simple binding, todo ends force `link`; drops just outside the rect are accepted via
  `looseHit`). Grips are stripped from PNG/SVG exports via `[data-edgegrip]`.

**Editing surfaces**
- Right inspector (node/table/edge editors, help + legend when nothing selected) uses a
  compact object header, task-grouped persistent disclosures, and a sticky action footer.
- Multi-select inspector with bulk color, text-size, and text-color controls.
- Right-click context menus start with object context and keep secondary node/edge controls
  in compact keyboard-accessible disclosures. Direct edit, create, duplicate, swap, and
  delete actions remain immediately available; canvas actions are grouped under Create.
- Multi-node context menu alignment/distribution tools: left/right/top/bottom, center
  horizontally/vertically, distribute horizontally/vertically.
- Inline title editor on canvas for nodes; inline label editor for edges.
- Quick-jump / command palette (`Ctrl/Cmd+K`) for nodes, fields, and `>` commands.
- Shortcut cheat sheet modal (`?`) generated from the shortcut registry.
- Schema lint modal listing duplicate names, missing PKs, unbound FK flags, type
  mismatches, missing junction tables, and empty concept titles; clicking a row selects
  the offender.
- Keyboard-only canvas navigation: focused board uses Tab/Shift-Tab to cycle nodes,
  Enter to open the inline editor, ARIA labels mirror button titles, and selection changes
  are announced through a live region.
- Color pickers everywhere: 6 presets + native color well + validated 6-digit hex input
  (3-digit shorthand accepted, live-apply, invalid flags red on blur).
- Persistent custom color palette: committed custom colors join a recent-swatches row in
  the inspector and context menus (normalized, deduped, capped at 8, presets excluded);
  stored in the document (`meta.recentColors`, written only when non-empty) and mirrored
  to localStorage when available; document colors win on import merge.
- Concept nodes support standard flowchart shapes: Process, Decision, Terminator, Data
  (input/output), Document, and Manual input. The Inspector also applies a shape to a
  multi-selection of concept nodes, and the concept-node context menu exposes the same
  controls; Decision anchors follow the diamond perimeter.
- Dark theme: status-bar toggle persisted in `meta.theme`; SVG draw code reads a `THEME`
  lookup so document colors and dark chrome render/export consistently.
- Undo/redo: 100-step snapshot stack with time+key coalescing for continuous edits.

**I/O (all local, no server)**
- Document lifecycle: Open / Save / Save As via File System Access API when available;
  automatic fallback to upload/download when unavailable; Ctrl/Cmd+O, Ctrl/Cmd+S, and
  Ctrl/Cmd+Shift+S shortcuts.
- Dirty tracking: document label and page title show unsaved state; save/open/new clear
  dirty state; dirty documents register a browser unload guard.
- Feature-flagged crash recovery: localStorage snapshot is debounced when available and
  the app boots normally when storage is unavailable.
- Versioned document import: `DOC_VERSION`, migration table, v1 import, and rejection of
  documents created by newer Schematic versions.
- Offline hardening: deployment comment, noscript warning, unsupported-browser banner, and
  tested generic font fallbacks for SVG text.
- JSON export (Blob download) / import (`<input type=file>`, shape-validated, field-id
  migration, fit after load).
- SQL DDL export: `CREATE TABLE` with NOT NULL/PK; FK constraints from field-bound edges
  (exact) or FK-flag heuristics (fallback, `-- TODO` comment when unresolvable);
  junction-table suggestions for N:M; copy + `.sql` download.
- SQL dialect selector persisted in `meta.dialect` with ANSI, Postgres, MySQL, and Athena
  output modes plus dialect-specific type suggestions.
- SQL DDL subset import, Mermaid ER export, Markdown mind-map outline export, direct SVG
  export, and CSV-header-to-table import.
- PNG export: 2× raster of content bounding box, handles stripped; exports light by default
  with an "as shown" option for the current theme.
- Print stylesheet hides chrome and scales the board for page output.

**Testing** — Node/jsdom harness covering Phase A lifecycle behavior, Phase B editing
workflows, Phase C modeling depth, Phase D interop, Phase E layout/visualization, Phase F
platform polish, and key rendering regressions; suite ends `ALL TESTS PASSED`.

---

## 4. Backlog

Format per item: **ID · Title · Priority (P0 highest) · Effort (S<2h M<1d L>1d as human-equivalent)**.
Implement in ID order within a priority band unless `Depends` says otherwise.
Every item ships with tests (§2.6 step 5). "AC" = acceptance criteria.

### Phase A — Local-file persistence & document lifecycle (P0)

Status: implemented and tested on 2026-07-08.

---

**SCH-001 · Open / Save / Save-As via File System Access API · P0 · M · Done 2026-07-08**

The centerpiece of the deployment model (§1). Replace "export/import" mental model with a
document lifecycle: the app holds a `FileSystemFileHandle` for the current document.

Implementation notes:
- New module-level state: `let doc = { handle: null, name: "untitled.schematic.json", dirty: false }`.
- Feature-detect once: `const FSA = "showOpenFilePicker" in window;`.
- Toolbar File group becomes: **Open**, **Save**, **Save As**, (keep **Import**/**JSON ↓**
  labels as the non-FSA fallback — when `!FSA`, Open ≡ existing import, Save ≡ existing
  download), SQL, PNG, Clear.
- `openDoc()`: `showOpenFilePicker({ types:[{description:"Schematic diagram", accept:{"application/json":[".json",".schematic"]}}]})`;
  read `getFile()` → `.text()` → reuse the existing import/validation/migration path; store handle.
- `saveDoc()`: if no handle → `saveAsDoc()`. Else `handle.createWritable()` → write
  serialized state → `close()`. Serialize exactly like current JSON export.
- `saveAsDoc()`: `showSaveFilePicker` with suggested name; then write; update `doc`.
- Keyboard: `Ctrl/Cmd+O`, `Ctrl/Cmd+S`, `Ctrl/Cmd+Shift+S` (guard: not while typing).
- All pickers throw `AbortError` on cancel — catch and ignore silently.
- Permission may be revoked between saves: on `NotAllowedError`, fall back to Save-As.

AC: In Chromium over HTTPS/localhost: Open loads a file in place, Save writes back to the
same file without a download prompt, Save-As creates a new file. In Firefox or over
`file://`: buttons silently use the download/upload fallback; nothing errors. Cancel never
corrupts state. Tests: feature-detect both branches by stubbing `window.showOpenFilePicker`;
assert serializer round-trip; assert fallback used when API absent.

Pitfalls: never keep a writable stream open across renders; write-then-close atomically.
Do not persist handles (IndexedDB persistence of handles is out of scope).

---

**SCH-002 · Dirty tracking, title bar, unload guard · P0 · S · Depends: SCH-001 · Done 2026-07-08**

- Set `doc.dirty = true` inside `pushHistory()` (single choke point); clear on successful
  save/open/new.
- Show `● filename` in the header brand area (`<span id="docLabel">`), tooltip = full path
  name; update `document.title` = `filename — Schematic`.
- `window.addEventListener("beforeunload", e => { if (doc.dirty){ e.preventDefault(); e.returnValue=""; } })`.
- New "New" menu/toolbar action: confirm if dirty, then clear canvas + reset `doc`.

AC: editing marks dirty; save clears it; closing tab with unsaved changes prompts;
tests assert dirty flag transitions (unload prompt itself is untestable in jsdom — test the
flag and the listener registration).

---

**SCH-003 · Crash-recovery snapshot (feature-flagged) · P1 · S · Depends: SCH-002 · Done 2026-07-08**

Optional convenience, never required (rule P5).
- `const RECOVERY = (() => { try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return true; } catch { return false; } })();`
- When `RECOVERY`: debounce-save snapshot (2s after last mutation) to
  `localStorage["schematic.recovery"]` = `{ savedAt, name, json }`. On startup, if present
  and newer than 7 days, show a dismissible banner: "Recover unsaved diagram from
  {timestamp}?" → Restore / Discard. Clear on clean save.
- When `!RECOVERY` (claude.ai artifact, private mode): entire feature is inert.

AC: works when localStorage exists; app boots identically when it doesn't. Tests: run
harness once with a localStorage stub, once with a throwing stub.

---

**SCH-004 · Offline hardening · P1 · S · Done 2026-07-08**

- Wrap font `<link>` usage: verify all `font-family` attribute stacks end in generic
  fallbacks (they do — keep it that way; add a check to tests that no SVG text lacks a
  fallback family).
- Add `<noscript>` message and a startup capability banner when running on an unsupported
  browser (missing `pointerdown` or `SVGElement`).
- Document in a `<!-- deployment -->` HTML comment at the top of the file: how to serve
  (any static server), FSA API secure-context requirement, `file://` behavior.

AC: file opened with network disabled renders correctly with system fonts; comment block
present; tests assert every SVG `font-family` attribute contains a comma (fallback exists).

---

**SCH-005 · Versioned schema + migration table · P1 · S · Done 2026-07-08**

- Export writes `"version": 1` already. Formalize: `const DOC_VERSION = 1;`
  `const MIGRATIONS = { /* 1: d => d (identity) */ }` — a map from version → upgrade fn to
  the next version. Import runs migrations sequentially until `DOC_VERSION`, then
  `ensureFieldIds()`.
- Reject documents with `version > DOC_VERSION` with a clear message ("made with a newer
  Schematic").

AC: importing v1 works; importing `{version: 99}` shows the message and leaves state
untouched. Tests for both.

---

### Phase B — Editing quality of life (P1)

Status: implemented and tested on 2026-07-08.

---

**SCH-010 · Multi-select + marquee · P1 · L · Done 2026-07-08**

- `sel` becomes `{ kind:"node"|"edge", ids:Set<string> }` OR keep current shape and add
  `selExtra:Set` — choose the first; update every `sel` consumer (search for `sel.` —
  ~20 sites). Shift-click toggles membership; drag on empty canvas with Shift (or a new
  marquee when not panning: mousedown empty + drag draws a rubber-band rect in
  `draftLayer`; on up, select intersecting nodes).
- Group drag: dragging any selected node moves all selected nodes (store per-node offsets
  at dragstart; one `pushHistory()` total).
- Delete/duplicate operate on the whole selection. Inspector: multi-select shows count +
  bulk color/text-size controls only.

AC: marquee selects; shift-click toggles; group drag is one undo step; delete removes all
selected + attached edges. Tests: simulate pointer sequence for marquee; assert set
contents; assert single history entry per group drag.

Pitfalls: keep single-selection fast paths (double-click edit, Tab child uses first/only
selected). Update context menus to act on selection when target is selected.

---

**SCH-011 · Copy / Paste · P1 · M · Depends: SCH-010 · Done 2026-07-08**

- In-memory clipboard variable (survives within session) + best-effort
  `navigator.clipboard.writeText(JSON)` wrapped in try/catch (may be unavailable; never
  required). Paste (`Ctrl+V`) uses in-memory value; offsets +36/+36; remaps node ids,
  field ids, and internal edge references (copy edges only when both ends are in the
  clipboard set).
- `Ctrl+C`/`Ctrl+X` (cut = copy + delete).

AC: copying 2 connected tables and pasting yields 2 new tables with a new bound edge,
distinct ids everywhere. Tests assert id remapping and edge preservation.

---

**SCH-012 · Alignment & distribution tools · P2 · S · Depends: SCH-010 · Done 2026-07-08**

Context-menu section (visible when ≥2 nodes selected): Align left/right/top/bottom,
Center horizontally/vertically, Distribute horizontally/vertically (equal gaps by rect
edges). One `pushHistory()` per action.

The toolbar also provides a dedicated Align menu when ≥2 nodes are selected, with the
standard Top/Middle/Bottom and Left/Center/Right actions. The same geometry engine backs
both entry points.

AC: geometry assertions on 3 nodes for each operation.

---

**SCH-013 · Inline title editing on canvas · P2 · M · Done 2026-07-08**

Double-click a node currently focuses the inspector. Change to: overlay an absolutely
positioned HTML `<input>` (in `#canvasWrap`, transformed to node screen coords with
`view.k` font scaling) over the title; Enter/blur commits (`render()`), Esc cancels.
Keep inspector path working. Reposition/close overlay on pan/zoom.

AC: dblclick → type → Enter renames without touching inspector; Esc restores; panning or
zooming while open closes the editor safely. Tests: overlay input existence, commit, cancel.

Pitfall: the overlay must set `pointerdown.stopPropagation()` so the canvas handler
doesn't blur it instantly (see existing `hexinput` pattern).

---

**SCH-014 · Quick-jump / command palette · P2 · M · Done 2026-07-08**

`Ctrl/Cmd+K` opens a centered palette (reuse `.modal` styles): fuzzy list of node titles
and field names (`table.field`); Enter pans/zooms to center the match and selects it;
also list commands ("Add table", "Export SQL", …) after a `>` prefix. Pure in-memory.

AC: typing filters; Enter centers + selects; Esc closes. Tests on filter function
(extract as pure `paletteMatches(query, items)`).

---

**SCH-015 · Shortcut cheat-sheet modal (`?`) · P3 · S · Done 2026-07-08**

Static modal listing all shortcuts. Keep in sync manually; add a test asserting every
shortcut key handled in the keydown handler appears in the modal text (single source
array `SHORTCUTS = [...]` used by both).

---

**SCH-016 · Edge label inline edit · P3 · S · Done 2026-07-08**

Double-click an edge label pill (or edge path) opens the same overlay editor as SCH-013
bound to `e.label`.

---

**SCH-017 · Persistent custom color palette · P2 · S · Done 2026-07-08**

Once a custom hex color is entered (color well or validated hex input), it becomes part of
the swatch palette going forward.

- Add `meta.recentColors: string[]` to the document (additive, E8 — same `meta` object as
  SCH-022's `meta.dialect`). Most-recent-first, deduped, normalized via `normalizeHex`,
  capped (e.g. 8 entries). Never add the 6 built-in presets.
- Record on **commit** (color-well `change`, hex input blur/Enter), not per `input` event
  mid-drag — one palette entry per pick.
- Surface a "recent" row after the presets in every swatch UI: `swatches`, `ctxSwatches`,
  `customColorRow` (inspector + context menus, fill and font colors alike).
- Cross-document persistence (optional, rule P5): mirror to
  `localStorage["schematic.recentColors"]` behind the same feature-detect pattern as
  SCH-003; merge on load (document colors win on order). Works in-document-only when
  localStorage is unavailable.
- No `pushHistory()` for adding a swatch (UI state, not a canvas mutation); applying the
  color keeps its existing history behavior.

AC: entering `#AB12CD` once makes it a clickable swatch in inspector + context menus,
immediately and after JSON round-trip; list deduped/normalized/capped, presets excluded;
old documents import unchanged; app boots with a throwing localStorage stub. Tests: swatch
DOM after commit, `meta.recentColors` round-trip, pure `pushRecentColor(list, hex)` helper
(dedup/cap/normalize).

---

### Phase C — Modeling depth (P1–P2)

Status: implemented and tested on 2026-07-08.

---

**SCH-020 · Extended field metadata · P1 · M · Done 2026-07-08**

Add optional field keys: `default` (string), `unique` (bool), `index` (bool),
`comment` (string). UI: expandable "…" per field row in the inspector revealing the four
inputs (keep the main grid unchanged). Render: `unique` shows a `U` badge variant;
`comment` shows as `title` tooltip attr on the row name. SQL: emit `DEFAULT x`,
`UNIQUE`, trailing `-- comment`; emit `CREATE INDEX` statements after the table for
`index:true` fields (`idx_{table}_{field}`).

AC: JSON round-trips new keys (absent keys stay absent — do not write empty strings);
SQL contains DEFAULT/UNIQUE/INDEX; old documents import unchanged. Tests for each.

---

**SCH-021 · Composite keys & multi-field relations · P2 · L · Depends: SCH-020 · Done 2026-07-08**

- Multiple `pk:true` fields already emit a composite `PRIMARY KEY (a, b)` — verify + test.
- Edges gain optional `pairs: [{fromField, toField}, …]` superseding single
  `fromField/toField` when present (keep old keys working; write both for 1-pair edges
  for backward compat). Inspector: "+ add column pair" UI on relation edges. Rendering:
  anchor at the first pair; label shows `2 cols` suffix. SQL: multi-column
  `FOREIGN KEY (a,b) REFERENCES t(c,d)`.

AC: two-pair edge exports correct composite FK; v1 docs unaffected. Extensive tests.

---

**SCH-022 · SQL dialect selector · P2 · M · Done 2026-07-08**

Toolbar/status dropdown persisted in the document (`meta.dialect`, default `"ansi"`)
∈ ansi | postgres | mysql | athena. `generateSQL` gains a dialect parameter controlling:
SERIAL handling (`SERIAL` pg, `INT AUTO_INCREMENT` mysql, `INT`+comment athena),
identifier quoting, TIMESTAMP variants, and for **athena**: emit
`CREATE EXTERNAL TABLE … STORED AS PARQUET` scaffold with a `-- LOCATION 's3://…'` TODO
and **no** PK/FK constraints (Athena doesn't enforce them) — emit them as comments.
Type datalist (`SQL_TYPES`) swaps per dialect.

AC: each dialect produces syntactically plausible DDL (string assertions per dialect);
dialect round-trips through JSON. Add `meta` object to the document shape
(`{ dialect }`) — additive, E8 compliant.

---

**SCH-023 · Schema lint panel · P2 · M · Done 2026-07-08**

A "Lint" toolbar button opens a panel (reuse modal) listing rule violations, each row
clickable → selects + centers the offender:
- table without PK · FK-flagged field with no bound/inferable relation · relation edge
  whose bound fields have mismatched types · N:M edge with no junction table named
  `a_b` present · duplicate field names within a table · duplicate table names ·
  concept with empty title.
Pure functions: `lintDocument(state) → [{level, msg, nodeId?, edgeId?}]` — keep it pure
for testability.

AC: seeded violations produce expected rule hits; clean seed produces zero errors
(warnings allowed). Tests call `lintDocument` directly.

---

**SCH-024 · Table notes + field collapse · P3 · S · Done 2026-07-08**

- Table `notes` (key exists) get the same textarea as concepts + dot indicator.
- `collapsed: true` on a table renders header only (+ `n fields` count); toggle via
  context menu and a chevron in the header. Edges bound to fields of a collapsed table
  anchor to the node boundary (fall through to `anchorOnRect` when collapsed —
  modify `edgeEndpoints` guard).

AC: collapse hides rows, edges re-anchor, hitTest returns no field, expand restores;
JSON round-trips. Tests for anchor fallback.

---

### Phase D — Import / export interop (P2)

Status: implemented and tested on 2026-07-08.

---

**SCH-030 · SQL DDL import (subset) · P2 · L · Done 2026-07-08**

Parse pasted `CREATE TABLE` DDL (textarea modal) into table nodes. Supported subset,
explicitly: `CREATE TABLE name ( col TYPE [NOT NULL] [DEFAULT x] [PRIMARY KEY|UNIQUE], …,
[PRIMARY KEY (a,b)], [FOREIGN KEY (a) REFERENCES t(b)] );` — case-insensitive, ignores
`IF NOT EXISTS`, backticks/quotes, and unknown constraint clauses (collect into a
"skipped" report shown after import). Layout imported tables in a grid
(4 per row, 80px gaps). Create bound 1:N edges from parsed FKs.
Write as pure `parseDDL(text) → {tables, fks, skipped}`; keep the regex/tokenizer simple
and defensive — on any parse failure of a statement, skip that statement, never throw.

AC: round-trip — `generateSQL` output re-imports to an equivalent model (names, PK/FK,
bindings); malformed input yields partial import + skipped report, no exceptions.
Tests: round-trip assertion + 5 malformed-input cases.

---

**SCH-031 · Mermaid ER export · P2 · S · Done 2026-07-08**

Export modal tab producing `erDiagram` syntax from table nodes + relation edges
(`customers ||--o{ orders : ""`). Concepts and `link` edges are omitted (comment header
notes this). Copy + download `.mmd`.

AC: string assertions for cardinality mapping (1:1 `||--||`, 1:N `||--o{`, N:M `}o--o{`).

---

**SCH-032 · Markdown outline export (mind map) · P3 · S · Done 2026-07-08**

Export the concept graph as a nested Markdown list: roots = concepts with no incoming
`link` edge; children via outgoing `link` edges; cycles broken with a visited set
(`(→ see X)` marker); table nodes referenced as `**table**` leaves. Notes as indented
blockquotes.

AC: seed exports deterministic outline; cycle test doesn't hang.

---

**SCH-033 · SVG export · P3 · S · Done 2026-07-08**

Reuse the PNG clone pipeline but download the serialized SVG directly (`.svg`,
`image/svg+xml`). Inline a `<style>` with the two `@font-face`-less font stacks comment
noting system fallback.

AC: exported string parses as XML, contains no `[data-handle]`/`[data-fieldhandle]`
elements, has correct viewBox. Tests parse with jsdom `DOMParser`.

---

**SCH-034 · CSV headers → table · P3 · S · Done 2026-07-08**

Modal: paste CSV first line(s) (or open a `.csv` via file picker — local only), infer
column names from the header row and types from up to 100 sample rows
(`INT`/`DECIMAL`/`DATE`/`TIMESTAMP`/`BOOLEAN` else `VARCHAR(255)`, nullable if blanks
seen). Creates one table node. Pure `inferTable(csvText) → {name, fields}`.

AC: typed sample produces expected types; quoted commas handled (use a tiny CSV splitter,
not `split(",")`); tests on the pure function.

---

### Phase E — Layout & visualization (P2–P3)

Status: implemented and tested on 2026-07-08.

---

**SCH-040 · Auto-layout: mind-map tree · P2 · L · Done 2026-07-08**

"Layout" toolbar menu → "Tree (concepts)". Scope: the `link`-edge subgraph reachable from
the selected concept (or the concept with most outgoing links if none selected). Tidy-tree
(Reingold–Tilford simplified): depth → x (concept width + 90 gap), siblings stacked with
24px gaps, parents centered on children. Animate is NOT required — single jump, one
`pushHistory("layout")`. Nodes not in scope don't move.

AC: seed's strategy subtree lays out without overlaps (assert pairwise rect
non-intersection); undo restores prior positions in one step.

---

**SCH-041 · Auto-layout: schema (layered) · P2 · L · Done 2026-07-08**

"Layout → Schema (tables)". Longest-path layering on relation edges (parents left),
within-layer ordering by barycenter of neighbors (2 sweeps is enough), x by layer using
max node width per layer + 140 gap, y stacked with 40 gaps. Cycles: break at the edge
closing the cycle (DFS back-edge), restore after layering.

AC: acyclic seed lays out with parents left of children; a synthetic cycle terminates and
produces finite coordinates. Non-overlap assertion.

---

**SCH-042 · Orthogonal edge routing option · P3 · M · Done 2026-07-08**

Per-edge `routing: "curve"|"ortho"` (default curve). Ortho: 3-segment Manhattan path
(H-V-H or V-H-V chosen by anchor sides), 12px stub before first turn; crow's feet already
orient by side so they keep working. Toggle in edge inspector + context menu.

AC: path `d` contains only M/L/H/V commands for ortho edges; notation renders; JSON
round-trips the key.

---

**SCH-043 · Minimap · P3 · M · Done 2026-07-08**

120×90 fixed overlay (bottom-right of `#canvasWrap`), redrawn on `render()`/`applyView()`:
scaled node rects + viewport rectangle; click/drag to pan. Skip when >500 nodes (perf).

AC: viewport rect math inverse-matches `view`; click centers view. Pure helper
`minimapTransform(bounds, view, box)` tested directly.

---

**SCH-044 · Dark theme · P3 · M · Done 2026-07-08**

Theme toggle (status bar; persisted in document `meta.theme`, default light). Because SVG
uses presentation attributes (E5), introduce a `THEME` lookup object
(`THEME.ink`, `THEME.paper`, `THEME.rowLine`, …) referenced by all draw code instead of
literal hex strings (refactor drawNode/drawEdge first — mechanical). CSS custom properties
already cover the HTML chrome — add a `[data-theme=dark]` override block. PNG export
forces light unless the user picks "export as shown".

AC: toggle re-renders both chrome and SVG; PNG export honors the choice; no literal
`#16232F` remains in draw code (grep-style test on the extracted script allowing the
THEME definition itself).

---

**SCH-045 · Frames / subject areas · P3 · L · Done 2026-07-08**

New node type `frame`: a labeled rounded rect drawn **behind** nodes (own layer between
background and edges). Dragging a frame moves nodes whose centers are inside it. Resize
via corner handle. No edges to frames. Fields: `title`, `color` (10% fill), `w`, `h`.

AC: frame drag moves contained nodes (one undo step); resize works; z-layers correct
(frame never occludes nodes); JSON round-trip; hitTest ignores frames for edge targeting.

---

### Phase F — Platform & polish (P3)

Status: implemented and tested on 2026-07-08.

---

**SCH-050 · Touch & iPad support · P3 · L · Done 2026-07-08**

Pointer events already fire for touch. Add: two-finger pinch zoom + two-finger pan
(track active pointers in a Map; on 2 pointers compute scale/translate from the pair
delta), long-press (500ms, <8px movement) opens the context menu, larger hit targets
when `pointerType === "touch"` (handle r 9→14). Test on iPad Safari manually; jsdom tests
cover the gesture math via pure `pinchTransform(p1a,p2a,p1b,p2b,view)`.

**SCH-051 · Keyboard-only canvas navigation & ARIA · P3 · M · Done 2026-07-08**

Tab/Shift-Tab cycles node selection (document order) when canvas has focus (make the SVG
`tabindex=0`); Enter opens inline editor (SCH-013); `aria-label`s on toolbar buttons
(most have `title` — mirror to aria); `role="application"` on the board; announce
selection changes via a visually-hidden live region.

**SCH-052 · Performance guardrails · P3 · M · Done 2026-07-08**

- Memoize `textW` (`Map` keyed `font\u0000str`, cleared when >10k entries).
- During node drag, move only the dragged node's `<g>` transform + its incident edges
  instead of full `drawOnly()` (keep full redraw on drop). Threshold: only bother when
  `state.nodes.length > 150`, else current path.
- Add a hidden benchmark hook `__T.perfSeed(n)` generating n tables for manual testing.

AC: 500-node document drags without full-layer rebuild (assert via instrumented counter
in tests); memoization returns identical values.

**SCH-053 · Print stylesheet · P4 · S · Done 2026-07-08**

`@media print`: hide chrome, scale the fitted diagram to page. Low priority; PNG covers
most needs.

**SCH-054 · Standard flowchart shapes for concept nodes · P2 · M · Done 2026-07-09**

Add the optional concept-only `shape` key with nine standard symbols: Process, Decision,
Terminator, Data (input/output), Document, Manual input, Triangle, Circle, and Square. Expose it through the
Inspector and concept-node context menu for individual concept nodes and concept-only
multi-selections. Keep the default Process shape absent from JSON for backward-compatible
compact documents; Decision's anchor points must lie on its diamond perimeter. Add jsdom
coverage for selection, rendering, geometry, and JSON round-tripping.

---

### Phase G — To-do lists (v1.1, P0–P2)

A third canvas item type: **to-do lists** — a titled node containing checkable items.
Edges may connect to the list as a whole (node-level anchoring) or to individual items
(row-level anchoring, exactly like table fields). Ship order: SCH-060 → 061 → 062 → 063;
tag `v1.1.0` when all four are done.

Design keystones (apply across all Phase G items):
- Items reuse the field-id infrastructure: item ids come from `uid()`, and edges bind to
  items through the **existing** `fromField`/`toField` keys — no edge-schema change.
- Introduce a row accessor `nodeRows(n)` (`n.fields` for tables, `n.items` for todos,
  else `null`) and route the row machinery through it (`hitTest`, `fieldRowCenterY`,
  `fieldAnchor`, `edgeEndpoints`, drop targets, hover handles) instead of adding parallel
  `type === "todo"` branches at each of those sites.
- `DOC_VERSION` stays 1 — a new node `type` value plus an `items` array is additive (E8).
  Old documents import unchanged.

---

**SCH-060 · To-do node type: model, rendering, item editing · P0 · L · Done 2026-07-08**

- Data model (additive): `{ id, type:"todo", x, y, title, notes, color, fontSize,
  fontColor, collapsed?, items:[{ id, text, done }] }`. Absent `done` means false; do not
  write `done:false` explicitly (keep absent keys absent).
- `addNode("todo", x, y)`: title "To-do list", one seed item, own default color; wire the
  toolbar "+ To-do" button, keyboard `D` (add to `SHORTCUTS` — the cheat-sheet test
  enforces sync), double-click-empty and canvas context menu "Add to-do list here".
- Geometry: extend `tableMetrics(n)` to accept todo nodes (rows = items, checkbox box in
  place of PK/FK badges — reuse the `badgeW` slot for the checkbox) so drawing,
  hit-testing, anchors, and handles share one source of row math (E3). `nodeSize` sizes
  by widest item text; `collapsed` renders header + `n items` count like collapsed tables.
- Render in `drawNode`: header shows title + progress (`3/7`); item rows draw a checkbox
  (SVG rect + check path, presentation attributes only, colors from `THEME` — E5/SCH-044);
  `done` items render with `text-decoration="line-through"` and muted ink; "no items yet"
  empty state like tables.
- Interaction: pointer-down on the checkbox toggles `done` (`pushHistory()` per toggle, no
  coalescing); inspector editor mirrors the field editor (text input, done flag, reorder
  ↑↓, delete with `cleanFieldRefs(item.id)`, "+ add item"); node context menu gains
  "Add item"; expanded lists also render a keyboard-accessible "+ Add item" footer inside
  the node; inline title editing (SCH-013 overlay) must work unchanged.
- Id hygiene (E4): extend `ensureFieldIds` and duplicate-remap to walk `n.items`;
  `hitTest` returns the item row via the shared `nodeRows` path.

AC: add/edit/toggle/reorder/delete items each = one undo step; toggling done never
destroys the inspector mid-interaction (E1/E2); collapsed todo shows count; JSON
round-trips items with absent-`done` kept absent; old documents import unchanged.
Tests: metrics for todo rows, toggle mutation + undo, id remap on duplicate, shortcut
sync, serializer round-trip.

---

**SCH-061 · Edges to to-do lists and items · P0 · M · Depends: SCH-060 · Done 2026-07-08**

- Node-level: todo nodes participate in `addEdge`/`edgeEndpoints` like concepts (they are
  only excluded today by `frame` guards — verify, don't special-case). Default kind for
  any edge touching a todo is `link`; relation kinds (`1:1/1:N/N:M`), crow's-foot
  notation, PK auto-orientation, and the column-pair editor remain table↔table only —
  hide the kind quick-set row in the edge menu/inspector when either end is a todo.
- Item-level: per-row ○ hover handles (existing `[data-fieldhandle]` machinery via
  `nodeRows`), drag item↔item, item↔field, item↔node with live drop-target highlight;
  bindings stored in the existing `fromField`/`toField` keys; anchor dots on bound ends.
- Inspector edge editor: attachment dropdowns for a todo end list its items ("whole list"
  + one entry per item text).
- Collapsed todos: bound edges fall back to `anchorOnRect` (same guard as collapsed
  tables in `edgeEndpoints`).
- Deleting an item cleans its edge refs (`cleanFieldRefs`); deleting the node removes
  attached edges (existing behavior — verify).

AC: concept→item, item→item, and item→table-field edges create, render, anchor at row
centers, survive reorder (ids, not indexes), and re-anchor to the node boundary when the
list is collapsed; duplicate rejection works at item granularity; swap direction carries
item bindings. Tests for each pairing + collapse fallback + `cleanFieldRefs` on item
delete.

---

**SCH-062 · To-do interop: exports, lint, palette · P1 · S · Depends: SCH-060 · Done 2026-07-08**

- Markdown outline export (`generateMarkdownOutline`): todo lists render as GitHub task
  lists — `- [ ] text` / `- [x] text` — nested under linked concepts like table leaves;
  standalone lists appear as roots.
- SQL (`generateSQL`) and Mermaid (`generateMermaid`) exports ignore todo nodes and any
  edge touching them (comment header notes the omission, matching the concepts note).
- `lintDocument` rules: warning for an empty to-do list (no items); error for a relation
  kind (`1:1/1:N/N:M`) on an edge touching a todo node.
- Command palette (`paletteItems`): index items as `list.item text` alongside
  `table.field`; Enter centers + selects the list.

AC: outline export shows checked/unchecked state deterministically; SQL/Mermaid output is
byte-identical for a document before/after adding an unconnected todo list; lint hits on
seeded violations; palette finds items. Tests call the pure functions directly.

---

**SCH-063 · To-do platform parity · P2 · S · Depends: SCH-060, SCH-061 · Done 2026-07-08**

Sweep the cross-cutting features and assert todo coverage: dark theme (all todo draw
colors come from `THEME` — extend the no-literal-ink grep test), minimap fill, touch hit
targets (checkbox + row handles get the enlarged radius), keyboard canvas navigation +
ARIA (checkbox buttons labelled with item text + state; selection live-region announces
"to-do list"), copy/paste (item ids remap; edges bound to items inside the clipboard set
survive), multi-select/alignment/frames containment (should be generic — verify),
auto-layout tree scope includes `link`-connected todos like concepts.

AC: one assertion per surface above; PNG/SVG exports strip handles and render checkboxes.

---

### Phase H — Custom color schemes (v1.4)

**SCH-064 · Document color schemes · P2 · M · Done 2026-07-10**

Add optional `meta.colorScheme` (see §2.2) so a project/map JSON file can ship its own
palette. Implementation keystones:
- Scheme access goes through accessors — `conceptColors()`, `tableColors()`,
  `fontColors()`, `frameColorDefault()`, `todoColorDefault()` — which fall back to the
  built-in constants; every palette/default consumer (inspector `swatches`, context-menu
  `ctxSwatches`, `addNode`, `addChildConcept`, DDL/CSV import, minimap, `perfSeed`) uses
  them instead of the constants.
- The built-in table and concept/background palettes include brand red `#C20029` and teal `#007873`; document
  schemes remain free to replace either value.
- `themeColors()` reads scheme-merged copies of `THEME` (rebuilt on scheme apply);
  scheme theme overrides also mirror onto the UI-chrome CSS custom properties
  (`--paper`, `--panel`, `--control`, `--ink`, `--ink-2`, `--muted`, `--accent`) per
  active mode, re-synced on light/dark toggle.
- Lifecycle: `applyColorScheme` runs in `applyDocument` (import), `restore` (undo/redo —
  `snapshot()` now carries `meta.colorScheme`), and `newDoc` (reset to null);
  `documentObject()` writes the scheme back so it round-trips. The recent-colors preset
  set recomputes on scheme apply so scheme swatches don't duplicate into the recent row.
- `DOC_VERSION` stays 1 (E8 — additive). Documents without a scheme, and all existing
  node `color`/`fontColor` values, behave exactly as before.

AC: importing a scheme document swaps inspector/context-menu swatches, new-node
defaults, and theme colors; saving round-trips the scheme byte-stable; invalid scheme
entries are dropped on import; `newDoc` and schemeless documents restore built-ins;
undo across an import restores the prior scheme. Covered by jsdom assertions in
`test.js` (validation, palettes, rendering fill, swatch rows, recent-color exclusion,
round-trip, undo, reset, CSS variables, light/dark override switching).

---

### Phase I — Toolbar & readability overhaul (v1.5)

**SCH-065 · Menu-based toolbar + auto-contrast node ink · P1 · M · Done 2026-07-10**

The flat 26-button header wrapped onto 3–4 rows at common widths and node text could
render unreadably (dark-on-dark to-do headers, light-on-light concepts in dark theme).

- Header reorganized into a menubar (File ▾ / Export ▾ / Layout ▾ disclosure menus via
  `setupMenus`) plus visible high-frequency actions: + Concept/+ Note/+ Table/+ To-do/+ Frame,
  Undo/Redo/Fit, Save. **Every button keeps its historical id** — handlers and tests
  bind by id; menu items are the same elements restyled. One panel open at a time;
  outside pointer, item click, and Escape close (Escape is intercepted in the capture
  phase so it doesn't also clear the canvas selection). Snap-to-grid shows its state
  via `aria-pressed` (checkmark styled in CSS); `appVersion` moved to the footer.
- `autoInk(bg)` picks readable text ink against a node's own fill by WCAG relative
  luminance (`relativeLuminance`, cutoff ≈ 0.179), returning `THEME` values (never
  literals — the no-literal-ink grep test still holds). Applied wherever a default was
  previously assumed to sit on a light/dark fill: concept titles, to-do headers, table
  headers (formerly always `tableText` white), and PK/U badge glyphs. An explicit
  `n.fontColor` always wins; document JSON is untouched.
- CSS: `button.primary:hover` no longer hardcodes a blue (uses brightness filter so
  scheme accents survive); footer hint truncates with ellipsis and hides ≤820px.

AC: all historical ids present; menus open/switch/close correctly incl. Escape
selection-preservation; snap state visible; dark-fill concept/todo/table text renders
light and light-fill table headers render dark; explicit fontColor overrides; full
suite green. Covered by jsdom assertions in `test.js`.

---

**SCH-066 · Hide / show the inspector · P2 · S · Done 2026-07-10**

Two inspector modes toggled by the header `#btnInspector` button (`aria-pressed`
reflects state) or the `I` shortcut (registered in `SHORTCUTS` — cheat-sheet sync):
- **Pinned** (default): inspector always visible — the historical behavior.
- **Unpinned (auto)**: inspector hidden when nothing is selected; selecting any node
  or edge reveals it, clearing the selection hides it again.

Implementation: `inspectorPinned` is a UI preference, not document data — mirrored to
`localStorage` (`schematic.inspectorPinned`) behind the `RECOVERY` feature detect with
an in-memory fallback (P5). Visibility is applied by `updateInspectorVisibility()`
(`aside.hidden = !pinned && !sel`) called from `renderInspector()`, the funnel every
`render()` goes through, so every selection path (click, marquee, palette, Tab-cycle,
undo/redo prune) is covered without new hooks. `aside[hidden]{display:none}` CSS makes
the attribute effective against the flex display.

AC: default pinned + visible; unpinning hides at no-selection, select reveals with the
element editor (not the help panel), deselect re-hides; `I` re-pins; preference
survives reload via storage seed; throwing storage degrades to in-memory. Covered by
jsdom assertions in `test.js`.

---

### Phase J — Rich notes (v1.7)

**SCH-067 · Linkable rich-note primitive · P1 · M · Done 2026-07-11**

Add an additive `note` node type with `{id,type:"note",x,y,title,content,color,fontSize,
fontColor,w}`. Notes render as folded-corner cards using SVG-only text so saved SVG/PNG
exports remain portable and untrusted note content never becomes executable HTML.

- Markdown-style rendering supports `#`/`##` headings, bullets, numbered lists, tasks,
  blockquotes, `**bold**`, `_italic_`, and inline code. Content wraps to the configured
  width; the canvas preview is bounded to 80 lines while the full source remains saved.
- Creation paths: `+ Note`, keyboard `N`, canvas context menu, and command palette.
  Inspector editing includes multiline source, width, color, text size, and text color;
  double-clicking the note body focuses the source editor.
- Notes participate in generic selection, move, align, frames, undo/redo, duplicate,
  copy/paste, minimap, tree layout, Markdown outline, SVG/PNG/JSON export, and node-level
  link edges. Relation kinds touching notes are rejected in lint and hidden in note-edge
  editors, matching the to-do link-only contract.
- `DOC_VERSION` remains 1 because the new node type and fields are additive; older
  documents import unchanged.

AC: formatting renders safely; empty and pathological long content degrade visibly;
content edits undo/redo; JSON round-trips; duplicate preserves content with a new id;
note-to-node links resolve endpoints and remain `link`; palette and Markdown export include
note content; full tests and browser interaction QA pass.

---

**SCH-068 · Semantic edge relationship presets · P1 · S · Done 2026-07-11**

Keep `edge.kind` reserved for rendering/cardinality (`link|1:1|1:N|N:M`) and store
semantic relationships in the existing optional `edge.label`, preserving every current
document and custom label. Add the supplied 16 presets—Contains, Depends on, Blocks,
Supports, Contradicts, Owns, Measures, Implements, Produces, Reads from, Writes to,
Triggers, References, Causes, Calculates, and Validates—with their explanatory meanings.

- Edge inspector: a Relationship selector lists `Custom text` plus all presets and
  meanings; the existing editable label field remains available for arbitrary text.
- Edge context menu exposes the same selector for workflow parity; selecting Custom text
  clears a preset and focuses the existing label editor.
- Selecting a preset is one undo step and writes only `edge.label`; serialization, inline
  label editing, SVG rendering, routing, and relation kind behavior remain unchanged.

AC: exact supplied names/meanings/order are tested; existing custom labels select Custom
text; preset selection renders, undoes/redoes, and serializes; arbitrary input returns the
selector to Custom text; inspector and context-menu paths both work.

---

**SCH-069 · Selection alignment menu · P2 · S · Done 2026-07-11**

Add a dedicated toolbar Align menu that enables when at least two nodes are selected.
Expose Top, Middle, Bottom, Left, Center, and Right while retaining the equivalent
right-click actions. Disable and close the menu whenever fewer than two nodes are selected.

AC: menu availability follows selection count; all six actions align node rectangles on
the requested edge or axis; each action remains one undo step; browser interaction QA passes.

---

**SCH-070 · Edge arrows and line appearance · P1 · M · Done 2026-07-11**

Add optional start/end arrowheads and per-edge line color, width, and
solid/dashed/dotted style. Provide equivalent controls in the edge inspector and
right-click menu. Store only explicit overrides so existing documents preserve their
current theme-aware dashed-link and solid-relation defaults.

Selected edges keep their chosen appearance and receive a separate accent halo. Arrowheads
use inline SVG geometry so they inherit custom color/width and remain portable through SVG
and PNG export without marker-definition dependencies.

AC: both editing surfaces change every property as one undoable action; start/end arrows
render independently; JSON and SVG retain explicit styling; undo/redo works; legacy edges
keep their prior appearance; automated and browser interaction QA pass.

---

**SCH-071 · Inspector and context-menu hierarchy redesign · P1 · L · Done 2026-07-11**

Replace flat inspector forms with a compact selected-object header, task-based native
disclosures, and a sticky action footer. Preserve all control ids, editing callbacks,
undo boundaries, and document mutations. Disclosure state persists during rerenders so a
committed change does not unexpectedly reopen a section the user closed.

Replace long, duplicated context forms with a concise object header plus capability-preserving
Relationship, Appearance, Routing, Content, and Arrange disclosure groups. High-frequency edit,
create, duplicate, swap, and destructive actions remain direct. Expanded context groups rerun
viewport fitting to avoid clipping.

The hierarchy defaults follow task frequency: primary Basics/Connection and common Appearance
sections start open; secondary Notes and edge Appearance start compact. All disclosure headers
use native keyboard behavior, explicit focus treatment, and consistent SVG chevrons.

AC: every former inspector/context capability remains reachable; node, edge, multi-select, and
canvas states have clear hierarchy; disclosure state survives render; menus are materially
shorter by default; document serialization and canvas behavior remain unchanged; automated,
browser interaction, and visual fidelity checks pass.

---

**SCH-072 · Geometric concept shapes with wrapped titles · P1 · M · Done 2026-07-13**

Extend the additive concept-only `shape` key with Triangle, Circle, and Square. Expose the
three shapes through the existing inspector selector, multi-concept editing, and context-menu
shape grid without adding shape controls to structural primitives.

Triangle, Circle, and Square use fixed-aspect SVG geometry and automatically wrap titles over
multiple centered lines. Each shape grows until the complete title fits its safe interior text
area, with a bounded ellipsis fallback only for pathological titles. Circle and Triangle edge
anchors resolve against their actual silhouettes, and hit testing ignores their empty bounding-
box corners; Square keeps conventional rectangular geometry.

AC: all three shapes render and round-trip through JSON; inspector/context controls expose all
nine concept shapes; long titles wrap without clipping; fixed aspect ratios hold; circle and
triangle anchors and hit targets follow their visible boundaries; automated and browser QA pass.

---

**SCH-073 · Draggable orthogonal link waypoint · P1 · M · Done 2026-07-13**

Selecting an orthogonal edge exposes a square waypoint handle on the canvas. Dragging it stores
optional world-space `orthoX` and `orthoY` coordinates and expands the existing Manhattan route
through that point without introducing diagonal or curved legs. Untouched edges retain the exact
automatic midpoint route used by earlier documents.

Waypoint x and y snap independently, at a zoom-adjusted screen threshold, to significant endpoint,
outward-stub, and automatic-midpoint coordinates used by the same edge. Temporary horizontal and
vertical guides make active snaps visible. Arrow keys nudge the focused handle; Shift uses the full
grid interval. The inspector and edge context menu explain the interaction and reset custom routing.

Custom coordinates serialize additively, sanitize on import, follow copied nodes by the paste offset,
and are excluded with all other editing grips from SVG and PNG exports. A drag is one undo step.

AC: legacy routes remain byte-for-byte unchanged until moved; custom paths remain M/L/H/V-only;
both axes snap independently; drag, keyboard, reset, undo, JSON, copy/paste, and export behavior are
tested; full automated and browser interaction QA pass.

---

**SCH-074 · Clean curved crow's-foot endpoints · P1 · S · Done 2026-07-13**

Curved 1:N and N:M relation strokes terminate at the many-side crow's-foot vertex instead of
continuing underneath its center prong to the node boundary. This gives the Bezier a precise,
tangent-aligned meeting point and removes the doubled, crossed endpoint visible beside table rows.
Orthogonal routing and one-side tick notation retain their existing geometry.

AC: curved 1:N and N:M strokes meet every many-side symbol at its outward vertex; the stroke does
not cross the fanned prongs; orthogonal paths are unchanged; automated and browser visual QA pass.

---

**SCH-075 · Align curved relation starts with cardinality ticks · P1 · S · Done 2026-07-13**

Give every curved relation a short straight segment between a one-side table anchor and its
cardinality tick. Begin or end the Bezier at the tick's outward vertex, tangent to that segment,
so the perpendicular bar never intersects a bend. Many-side endpoints continue to terminate at
their crow's-foot vertices, and orthogonal routes retain their existing geometry.

AC: curved 1:N and 1:1 starts cross their one-side ticks on straight segments; 1:1 ends receive the
same treatment; N:M crow's feet remain clean; orthogonal paths are unchanged; automated and browser
visual QA pass.

---

**SCH-076 · Follow orthogonal routes with edge labels · P1 · S · Done 2026-07-13**

Place every orthogonal edge label at the halfway point of the actual Manhattan path by cumulative
segment length. Recalculate that position during waypoint drags so a custom detour carries its label
onto the reshaped route instead of leaving it at the static midpoint between the endpoint nodes.
Curved links retain their existing endpoint-midpoint label placement.

AC: automatic and custom orthogonal labels sit on their routed paths; moving a waypoint updates the
label during the drag; reset and subsequent endpoint movement recalculate it; curved label placement
is unchanged; automated and browser interaction QA pass.

---

**SCH-077 · Horizontal and vertical swimlanes · P1 · M · Done 2026-07-13**

Add swimlanes as structural canvas primitives behind edges and content nodes. A horizontal lane is
a wide band with a title rail on the left; a vertical lane is a tall band with a title header at the
top. Lane titles are editable, body and title backgrounds are independently configurable, and lanes
move contained content using the same center-point containment rule as frames. Lanes are intentionally
not link endpoints.

AC: toolbar, canvas menu, and command palette create both orientations; inspector and right-click menu
edit orientation and independent colors; resize, move-with-contents, duplicate, undo/redo, JSON round-trip,
SVG export, minimap, and counts work; invalid imported lane values are normalized; automated and browser
interaction QA pass.

---

**SCH-078 · Plain text with optional shapes · P1 · M · Done 2026-07-14**

Add a lightweight plain-text canvas primitive for diagram titles, labels, and short phrases. It is
distinct from rich notes, defaults to text-only rendering with no visible box, and can optionally use
any standard flowchart shape. Plain text supports wrapping, maximum width, font size/color, shape
background, links, inline editing, copy/duplicate, undo/redo, and normal canvas movement.

AC: toolbar, keyboard, canvas menu, and command palette create plain text; inspector and right-click
menu edit text, shape, maximum width, background, size, and text color; no-box mode exports without an
editing outline; shaped text uses silhouette-aware hit testing and link anchors; JSON round-trip and
invalid-value normalization work; automated and browser interaction QA pass.

---

**SCH-079 · Blank-canvas creation and layout menu · P1 · S · Done 2026-07-14**

Turn the existing blank-canvas right-click surface into a complete, scannable canvas menu. Group every
primitive under Create, expose the existing Tree, Schema, grid-cleanup, and grid-snapping actions under
Layout, and provide Fit, actual-size, zoom-in, and zoom-out actions under View. Creation uses the clicked
world coordinate, while node and edge right-click targets retain precedence over the canvas menu.

AC: right-clicking blank canvas opens accessible Create, Layout, and View groups; every primitive can be
created at the clicked position; layout and shared snap controls call the same actions as the header;
fit and zoom preserve normal view behavior; actions close the menu; outside pointerdown dismisses it;
node and edge context menus remain unchanged; automated and browser interaction QA pass.

---

**SCH-080 · Shift-drag temporary grid snapping · P1 · S · Done 2026-07-14**

Make Shift a temporary modifier for the existing item-drag grid behavior. Holding Shift before or
during a drag snaps each moved canvas item to the visible 24px dot grid without changing the persistent
Snap to grid setting. Defer Shift-click selection toggling until pointer-up so stationary Shift-clicks
still add or remove nodes while Shift-drag can begin naturally.

AC: Shift held from pointer-down snaps node movement; pressing or releasing Shift during the drag changes
the active grid immediately; stationary Shift-click retains additive/removal selection semantics; persistent
Snap to grid still works without Shift; Shift snapping creates one undo entry and applies to every primitive
using the shared node-drag path; automated and browser interaction QA pass.

---

**SCH-081 · Smart object alignment guides · P1 · M · Done 2026-07-15**

Show temporary alignment guides while an object is dragged near the standard bounds of surrounding
objects. Compare left, horizontal center, and right coordinates independently from top, vertical middle,
and bottom coordinates; snap matching axes on drop while leaving unmatched axes free. Apply one shared
movement delta to multi-selections and contained items, and let explicit grid snapping take precedence.

AC: guides appear within a zoom-stable screen threshold and clear when the drag ends, is cancelled, or
moves away; the dropped object remains exactly aligned; x and y capture independently; selected groups,
frames, swimlanes, connected custom orthogonal bends, undo/redo, and large-canvas fast rendering preserve
their existing behavior; editing guides do not appear in SVG or PNG exports; automated and browser
interaction QA pass.

---

**SCH-082 · Independent edge label colors · P1 · M · Done 2026-07-15**

Allow edge-label text and pill backgrounds to be styled independently from the edge line.
Store only explicit `labelTextColor` and `labelBackgroundColor` overrides: legacy and reset
text inherits the live line color, while legacy and reset backgrounds retain the theme-aware
canvas label background. Expose equivalent palettes and inheritance resets in the inspector
and edge right-click menu.

AC: changing the line color still updates label text until a text override is chosen; text
and background overrides can be changed and reset independently; invalid imported colors are
discarded; JSON, copy/paste, undo/redo, SVG, and PNG preserve explicit overrides; existing
documents remain visually unchanged; automated and browser interaction QA pass.

---

**SCH-083 · All-node-type starter showcase · P1 · S · Done 2026-07-15**

Turn the fresh-document seed into a coherent feature tour of the complete canvas model without
turning it into a flowchart-shape gallery. Preserve the established loyalty example while organizing
its concepts and tables into labeled structural regions, then add unboxed text, a status node, a rich
note, a to-do list, a frame, and horizontal and vertical swimlanes. Use a small number of representative styled,
labeled, and field-bound links so new users can see major link capabilities without visual overload.

AC: every node type appears on a fresh load; both swimlane orientations appear; concepts retain the
default process shape and plain text remains unboxed; structural containment is real; rich-note markup,
to-do state, field connections, orthogonal routing, arrows, line styling, and independent label colors
are represented; the first view remains legible with Fit to View; existing documents are unaffected;
automated and browser visual QA pass.

---

**SCH-084 · Responsibility-oriented JavaScript architecture · P1 · M · Done 2026-07-15**

Replace the 6,000-line `app.js` monolith with ordered scripts for core state, geometry, rendering,
model mutations, interactions, inspector UI, file/export interoperability, context menus, and
bootstrap. Preserve the zero-build static deployment and direct-`file://` fallback by using classic
scripts with explicit load order instead of native ES modules.

AC: all production logic is moved without behavioral rewrites; every script parses independently;
the jsdom suite derives the same order from `index.html`; the `window.__T` surface is unchanged;
serialization, rendering, interactions, and exports match the pre-refactor golden master; browser
load and a primary interaction pass without console warnings or errors; architecture placement and
dependency rules are documented.

---

**SCH-085 · Curved-link label follows visible path · P1 · S · Done 2026-07-15**

Place labels on the half-length point of the rendered cubic Bézier instead of the straight midpoint
between its endpoints. Apply the same curve-body rule to relationship labels while preserving the
existing cumulative-path midpoint for orthogonal links.

AC: labels remain centered on monotonic curves without inflection points; relationship labels use the
glyph-to-glyph curve body; orthogonal waypoint labels are unchanged; automated geometry assertions and
browser visual QA pass.

---

**SCH-086 · Compact swimlane title bands · P1 · S · Done 2026-07-15**

Reduce the horizontal swimlane's oversized 140-unit title rail to the same compact 48-unit thickness
used by the vertical orientation. Keep the title readable and preserve lane bounds, containment,
resizing, independent title/body colors, editing, serialization, and export behavior.

AC: both orientations use a 48-unit title band; existing documents gain content space without moving
their nodes or changing lane dimensions; automated geometry assertions and browser visual QA pass.

---

**SCH-087 · Wrapped multiline concept-node titles · P1 · M · Done 2026-07-15**

Render long concept-node titles as complete, centered SVG line stacks across every flowchart shape.
Preserve explicit newline boundaries, grow node geometry to contain the text, and let Shift+Enter insert
a newline in canvas and inspector editors while unmodified Enter commits the edit.

AC: process and standard flowchart shapes no longer truncate long titles; triangle, circle, and square
retain safe silhouette padding; explicit newlines persist in JSON and export; basic text primitives gain
the same newline-aware wrapping; table names, row text, to-do titles, and edge labels retain single-line
editing; undo/redo and connected-edge anchors follow resized nodes; automated and browser keyboard/visual
QA pass.

---

**SCH-088 · Match selected node widths · P1 · M · Done 2026-07-16**

Add multi-selection right-click actions to set every selected node to the smallest, largest, or
average width in the selection. Persist the resulting manual width across save/load and use one width
contract across concepts, plain text, status nodes, rich notes, tables, to-dos, frames, and swimlanes.

AC: the three commands appear only for two or more selected nodes; each command creates one undo step;
all selected node rectangles end at the same computed width; concept, plain-text, and rich-note content
reflows; connected links re-anchor; legacy documents without manual widths remain visually unchanged;
automated and browser right-click/visual QA pass.

---

**SCH-089 · Nested context-menu hierarchy · P1 · M · Done 2026-07-16**

Replace the remaining long, mixed-purpose right-click menus with compact task-based submenus. Node
menus use Content, Appearance, Arrange, and Actions; edge menus use Relationship, Label, Line,
Routing, and Actions; canvas creation is divided into nodes/data, text/notes, and containers.

AC: node, edge, and canvas menus have no loose root-level actions; dense palettes and control
clusters live in nested submenus; only one sibling submenu opens at each level; disclosure state
survives reopening; existing commands, selection behavior, undo boundaries, and keyboard access are
preserved; automated and browser interaction/visual QA pass.

---

**SCH-090 · Reset forced node sizing · P1 · S · Done 2026-07-16**

Add Reset size to the node context menu for single and multi-selections. It removes width matching
from every selected node that currently has a forced width and restores the width configuration that
existed before matching.

AC: Reset size is always visible under Arrange → Size and disabled when no selected node is forced;
mixed selections reset only forced nodes; concepts, tables, and to-dos resume content sizing while
text, status nodes, notes, frames, and swimlanes restore their pre-match width; the reset is one undo step and
round-trips through save/load; automated and browser right-click QA pass.

---

**SCH-091 · Status node type and shared custom labels · P1 · M · Done 2026-07-17**

Add a status node that combines wrapped text with a configurable left/right indicator. Provide the
built-in labels Not started, In progress, Blocked, Completed, and Canceled, plus custom labels created
from the inspector and shared by every status node in the current diagram.

AC: toolbar, `S`, command palette, and blank-canvas menus create status nodes; the inspector and
right-click menu change status and indicator side; long text wraps in the non-status portion; custom
labels are normalized, deduplicated, saved once in document metadata, available on all status nodes,
and included in undo/redo; legacy documents and status nodes without metadata import safely; status
nodes support normal links, copy/paste, sizing, SVG/PNG export, lint, and starter-content behavior;
automated and browser visual/interaction QA pass.

---

**SCH-092 · Unified color picker and document palette · P1 · M · Done 2026-07-17**

Replace the duplicated inspector and context-menu color controls with one compact, accessible picker.
Show the current color by name and exact hex value, then organize choices into the active scheme palette,
recent custom colors, reusable colors found in the current diagram, and a validated custom-color field.
Make inherited edge-label colors explicit and reversible without changing document color or undo semantics.

AC: inspector and context menus use the same control; preset and selected colors have accessible names and
pressed state; custom hex input validates 3- and 6-digit values with a visible error; custom colors appear in
the persisted recent palette and can be cleared; colors already used by other nodes and edges are reusable;
native color input and optional browser eyedropper remain available; edge-label text/background inheritance is
clear; a settled color change creates one undo step; custom color schemes, legacy documents, dark mode, and
direct `file://` operation remain intact; automated and browser visual/interaction QA pass.

---

**SCH-093 · Complete dropdown command parity · P1 · L · Done 2026-07-18**

Expand the application menubar into a calm, desktop-style command surface organized as File, Edit,
Insert, Arrange, Selection, View, and Export. Make node- and link-specific commands available through
a selection-aware menu while keeping dense color pickers and font-size controls in the inspector and
right-click menus.

AC: every actionable canvas, node, and link context-menu feature other than color and font size has a
dropdown equivalent; dynamic commands cover every node type and link appearance/routing option; static
commands expose creation, layout, sizing, alignment, distribution, layering, editing, and view actions;
unavailable commands are visibly disabled; nested menus allow only one sibling section open at a time;
existing mutations, undo boundaries, shortcuts, direct `file://` operation, and compact/dark layouts are
preserved; automated command-parity tests and browser visual/interaction QA pass.

---

## 5. Explicit non-goals (do not build, even if they seem helpful)

- Real-time collaboration, multi-user anything, CRDTs, WebSockets.
- Server-side persistence, accounts, sync, sharing links.
- A build system, TypeScript migration, framework adoption, or native-module conversion that breaks
  direct `file://` loading.
- Telemetry/analytics of any kind.
- Full SQL parser (SCH-030 is an explicit subset; resist scope creep).
- Browser extensions or Electron wrappers.

## 6. Definition of done (every backlog item)

- [x] All §1 platform rules and §2.4 invariants hold.
- [x] Works in the no-FSA fallback path (Firefox/`file://`) if the feature touches I/O.
- [x] `node --check` passes for every file in `js/`; `node test.js` prints `ALL TESTS PASSED`.
- [x] New behavior has assertions; count noted in the PR/summary.
- [x] JSON documents from before the change still import (backward compatibility test).
- [x] §3 of this PLAN.md updated; backlog item marked done 2026-07-08.
- [x] Deliverable remains static `index.html`, `styles.css`, and ordered files in `js/`.
