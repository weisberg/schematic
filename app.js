"use strict";
/* =====================================================================
   SCHEMATIC — single-file mind map + database mapping canvas
   Nodes:  concept (business mind map)  |  table (entity with fields)
   Edges:  link (freeform)  |  1:1, 1:N, N:M (crow's-foot relations)
   ===================================================================== */

const SVGNS = "http://www.w3.org/2000/svg";
const board = document.getElementById("board");
const wrap  = document.getElementById("canvasWrap");
const DOC_VERSION = 1;
const MIGRATIONS = {};
const FSA = "showOpenFilePicker" in window && "showSaveFilePicker" in window;
const RECOVERY_KEY = "schematic.recovery";
const RECOVERY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const RECOVERY = (() => {
  try {
    localStorage.setItem("__schematic_test", "1");
    localStorage.removeItem("__schematic_test");
    return true;
  } catch {
    return false;
  }
})();

/* ----------------------------- State ------------------------------ */
let state = { nodes: [], edges: [], nextId: 1 };
let view  = { x: 0, y: 0, k: 1 };            // pan / zoom
let sel   = null;                             // {kind:'node'|'edge', ids:Set<string>}
let doc   = { handle: null, name: "untitled.schematic.json", dirty: false };
let undoStack = [], redoStack = [];
const MAX_HISTORY = 100;
let recoveryTimer = null;
let clipboardData = null;
let inlineEditor = null;

const CONCEPT_COLORS = ["#FFE9A8","#CFE8FF","#D8F3DC","#F4D8F0","#FFD9C7","#E4E7EC"];
const TABLE_COLORS   = ["#16232F","#2456E6","#1E7A4F","#8A3FA8","#B4550F","#6B7683"];
const FONT_COLORS    = ["#16232F","#33475C","#7A8794","#FFFFFF","#2456E6","#C63A3A"];
const FLOWCHART_SHAPES = [
  ["process", "Process"],
  ["decision", "Decision"],
  ["terminator", "Terminator"],
  ["data", "Data (input/output)"],
  ["document", "Document"],
  ["manualInput", "Manual input"]
];
const FLOWCHART_SHAPE_SET = new Set(FLOWCHART_SHAPES.map(([id]) => id));
const CONCEPT_FS_DEFAULT = 14, TABLE_FS_DEFAULT = 11.5;
const FRAME_DEFAULT = { color:"#2456E6", w:360, h:240 };
const TODO_COLOR_DEFAULT = "#E9E2F8";
const APP_VERSION = "v1.3.2";
const GRID_SNAP = 24;   // matches the dot-grid pattern spacing
const THEME = {
  light: {
    paper:"#EEF1F4", panel:"#FFFFFF", control:"#FBFCFD", ink:"#16232F",
    ink2:"#33475C", muted:"#7A8794", rowLine:"#EDF0F3", accent:"#2456E6",
    link:"#98A5B3", edge:"#33475C", labelBg:"#EEF1F4", tableFill:"#FFFFFF",
    tableText:"#FFFFFF", grid:"#C9D2DB", empty:"#98A5B3"
  },
  dark: {
    paper:"#10161D", panel:"#151D26", control:"#1C2631", ink:"#E6EDF4",
    ink2:"#C8D3DF", muted:"#8D9AAA", rowLine:"#273240", accent:"#7AA2FF",
    link:"#728296", edge:"#A7B6C5", labelBg:"#151D26", tableFill:"#111820",
    tableText:"#F6F9FC", grid:"#2A3542", empty:"#7F8FA0"
  }
};
let docTheme = "light";
let pngAsShown = false;
let snapToGrid = false;
let spaceHeld = false;
let autoSave = false, autoSaveTimer = null;
let docDialect = "ansi";
const SQL_DIALECTS = ["ansi","postgres","mysql","athena"];
const SQL_TYPES_BY_DIALECT = {
  ansi: ["INT","BIGINT","VARCHAR(255)","TEXT","BOOLEAN","DATE","TIMESTAMP","DECIMAL(12,2)","NUMERIC","FLOAT","UUID","JSON"],
  postgres: ["INT","BIGINT","SERIAL","BIGSERIAL","VARCHAR(255)","TEXT","BOOLEAN","DATE","TIMESTAMP","DECIMAL(12,2)","NUMERIC","FLOAT","UUID","JSONB"],
  mysql: ["INT","BIGINT","INT AUTO_INCREMENT","VARCHAR(255)","TEXT","BOOLEAN","DATE","DATETIME","DECIMAL(12,2)","DOUBLE","JSON"],
  athena: ["INT","BIGINT","STRING","BOOLEAN","DATE","TIMESTAMP","DECIMAL(12,2)","DOUBLE","JSON"]
};
let SQL_TYPES = SQL_TYPES_BY_DIALECT.ansi.slice();
const SHORTCUTS = [
  { id:"open", keys:"Ctrl/Cmd+O", title:"Open" },
  { id:"save", keys:"Ctrl/Cmd+S", title:"Save" },
  { id:"saveAs", keys:"Ctrl/Cmd+Shift+S", title:"Save As" },
  { id:"undo", keys:"Ctrl/Cmd+Z", title:"Undo" },
  { id:"redo", keys:"Ctrl/Cmd+Shift+Z", title:"Redo" },
  { id:"redoAlt", keys:"Ctrl/Cmd+Y", title:"Redo" },
  { id:"copy", keys:"Ctrl/Cmd+C", title:"Copy selection" },
  { id:"cut", keys:"Ctrl/Cmd+X", title:"Cut selection" },
  { id:"paste", keys:"Ctrl/Cmd+V", title:"Paste selection" },
  { id:"duplicate", keys:"Ctrl/Cmd+D", title:"Duplicate selection" },
  { id:"palette", keys:"Ctrl/Cmd+K", title:"Quick jump / command palette" },
  { id:"help", keys:"?", title:"Shortcut cheat sheet" },
  { id:"concept", keys:"C", title:"Add concept" },
  { id:"table", keys:"T", title:"Add table" },
  { id:"todo", keys:"D", title:"Add to-do list" },
  { id:"child", keys:"Tab", title:"Add linked child concept" },
  { id:"delete", keys:"Delete/Backspace", title:"Delete selection" },
  { id:"fit", keys:"F", title:"Fit diagram" },
  { id:"escape", keys:"Esc", title:"Close menu or clear selection" },
  { id:"nudge", keys:"Arrow keys", title:"Nudge selected nodes" },
  { id:"nudgeLarge", keys:"Shift+Arrow keys", title:"Nudge selected nodes by 24px" },
  { id:"spacePan", keys:"Space+drag", title:"Pan the canvas" }
];

/* recent custom colors (SCH-017): live in the document (meta.recentColors) and are
   mirrored to localStorage when available (RECOVERY doubles as the feature detect) */
const RECENT_COLORS_KEY = "schematic.recentColors";
const RECENT_COLORS_MAX = 8;
const PRESET_COLOR_SET = new Set(
  [...CONCEPT_COLORS, ...TABLE_COLORS, ...FONT_COLORS].map(c => c.toLowerCase()));
function pushRecentColor(list, hex){
  const n = normalizeHex(hex);
  if (!n || PRESET_COLOR_SET.has(n)) return list;
  return [n, ...list.filter(c => c !== n)].slice(0, RECENT_COLORS_MAX);
}
/* dedupe + normalize both lists into one; docList wins on order */
function mergeRecentColors(docList, storedList){
  const merged = [];
  for (const c of [...(docList || []), ...(storedList || [])]){
    const n = normalizeHex(c);
    if (!n || PRESET_COLOR_SET.has(n) || merged.includes(n)) continue;
    merged.push(n);
    if (merged.length >= RECENT_COLORS_MAX) break;
  }
  return merged;
}
function loadStoredRecentColors(){
  if (!RECOVERY) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || "[]");
    return Array.isArray(raw) ? mergeRecentColors(raw, []) : [];
  } catch { return []; }
}
function persistRecentColors(){
  if (!RECOVERY) return;
  try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors)); } catch {}
}
/* palette membership is UI state, not a canvas mutation — no pushHistory here */
function recordRecentColor(hex){
  const next = pushRecentColor(recentColors, hex);
  if (next === recentColors) return;
  recentColors = next;
  persistRecentColors();
}
let recentColors = loadStoredRecentColors();

function themeColors(name = docTheme){
  return THEME[name] || THEME.light;
}
function updateThemeControls(){
  document.documentElement.dataset.theme = docTheme;
  const btn = document.getElementById("btnTheme");
  if (btn){
    btn.textContent = docTheme === "dark" ? "Light" : "Dark";
    btn.title = docTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  }
  const png = document.getElementById("pngAsShown");
  if (png) png.checked = pngAsShown;
  const dot = board && board.querySelector("#dots circle");
  if (dot) dot.setAttribute("fill", themeColors().grid);
}
function applyTheme(next, opts = {}){
  const normalized = next === "dark" ? "dark" : "light";
  const changed = docTheme !== normalized;
  docTheme = normalized;
  updateThemeControls();
  if (opts.render) render();
  if (opts.dirty && changed) setDocDirty(true);
}
function toggleTheme(){
  pushHistory("theme");
  applyTheme(docTheme === "dark" ? "light" : "dark", { render:true, dirty:true });
}
function setPngAsShown(value){
  pngAsShown = !!value;
  updateThemeControls();
}
function updateDialectControls(){
  const select = document.getElementById("dialectSelect");
  if (select) select.value = docDialect;
  SQL_TYPES = (SQL_TYPES_BY_DIALECT[docDialect] || SQL_TYPES_BY_DIALECT.ansi).slice();
  const dl = document.getElementById("sqltypes");
  if (dl){
    dl.innerHTML = "";
    for (const t of SQL_TYPES){ const o = document.createElement("option"); o.value = t; dl.appendChild(o); }
  }
}
function applyDialect(next, opts = {}){
  const normalized = SQL_DIALECTS.includes(next) ? next : "ansi";
  const changed = docDialect !== normalized;
  docDialect = normalized;
  updateDialectControls();
  if (opts.render) render();
  if (opts.dirty && changed) setDocDirty(true);
}
function setDialect(next){
  pushHistory("dialect");
  applyDialect(next, { render:true, dirty:true });
}

const uid = () => "n" + (state.nextId++);
const nodeById = id => state.nodes.find(n => n.id === id);
const edgeById = id => state.edges.find(e => e.id === id);

function makeSelection(kind, ids){
  const values = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [ids];
  const set = new Set(values.filter(Boolean));
  return set.size ? { kind, ids:set } : null;
}
function announce(msg){
  const live = document.getElementById("liveStatus");
  if (live) live.textContent = msg;
}
function describeSelection(){
  if (!sel) return "Selection cleared";
  const count = sel.ids.size;
  if (sel.kind === "node" && count === 1){
    const n = nodeById([...sel.ids][0]);
    return n ? `Selected ${n.type === "todo" ? "to-do list" : n.type} ${n.title || n.id}` : "Selected node";
  }
  if (sel.kind === "edge" && count === 1) return "Selected edge";
  return `Selected ${count} ${sel.kind}s`;
}
function setSelection(kind, ids){ sel = makeSelection(kind, ids); announce(describeSelection()); return sel; }
function clearSelection(){ sel = null; announce("Selection cleared"); }
function selectionIds(kind){
  return sel && (!kind || sel.kind === kind) ? [...sel.ids] : [];
}
function selectionCount(kind){ return selectionIds(kind).length; }
function firstSelectionId(kind){ return selectionIds(kind)[0] || null; }
function isSelected(kind, id){ return !!(sel && sel.kind === kind && sel.ids.has(id)); }
function selectedNodes(){ return selectionIds("node").map(nodeById).filter(Boolean); }
function firstSelectedNode(){ const id = firstSelectionId("node"); return id ? nodeById(id) : null; }
function singleSelectedNode(){ return selectionCount("node") === 1 ? firstSelectedNode() : null; }
function singleSelectedEdge(){ const id = firstSelectionId("edge"); return selectionCount("edge") === 1 ? edgeById(id) : null; }
function toggleNodeSelection(id){
  if (!sel || sel.kind !== "node") return setSelection("node", id);
  const next = new Set(sel.ids);
  if (next.has(id)) next.delete(id); else next.add(id);
  sel = next.size ? { kind:"node", ids:next } : null;
  return sel;
}
function pruneSelection(){
  if (!sel) return;
  const exists = sel.kind === "node" ? nodeById : edgeById;
  const ids = [...sel.ids].filter(id => exists(id));
  sel = ids.length ? makeSelection(sel.kind, ids) : null;
}

/* shared row accessor: table fields and to-do items ride the same row
   machinery (geometry, anchors, handles, id hygiene) */
function nodeRows(n){
  if (n.type === "table") return n.fields;
  if (n.type === "todo") return n.items;
  return null;
}
/* field-level references: edges may carry fromField / toField (row ids) */
function ensureFieldIds(){
  for (const n of state.nodes){
    if (n.type === "todo" && !Array.isArray(n.items)) n.items = [];
    const rows = nodeRows(n);
    if (rows) for (const f of rows) if (!f.id) f.id = uid();
  }
}
function cleanFieldRefs(fid){
  for (const e of state.edges){
    if (e.fromField === fid) delete e.fromField;
    if (e.toField === fid) delete e.toField;
    if (Array.isArray(e.pairs)){
      e.pairs = e.pairs.filter(p => p.fromField !== fid && p.toField !== fid);
      if (!e.pairs.length) delete e.pairs;
    }
  }
}
/* topmost node (and row, for tables/todos) under a world point */
function hitTest(w){
  for (let i = state.nodes.length - 1; i >= 0; i--){
    const n = state.nodes[i], r = nodeRect(n);
    if (n.type === "frame") continue;
    if (w.x < r.x || w.x > r.x + r.w || w.y < r.y || w.y > r.y + r.h) continue;
    let field = null;
    const rows = n.collapsed ? null : nodeRows(n);
    if (rows && rows.length){
      const m = tableMetrics(n);
      if (w.y > r.y + m.headerH){
        const idx = Math.min(rows.length - 1, Math.floor((w.y - r.y - m.headerH) / m.rowH));
        if (idx >= 0) field = rows[idx];
      }
    }
    return { node: n, field };
  }
  return null;
}

/* text measurement */
const meas = document.createElement("canvas").getContext("2d");
const textMeasureCache = new Map();
function textW(str, font){
  const key = font + "\u0000" + str;
  if (textMeasureCache.has(key)) return textMeasureCache.get(key);
  if (textMeasureCache.size > 10000) textMeasureCache.clear();
  meas.font = font;
  const w = meas.measureText(str).width;
  textMeasureCache.set(key, w);
  return w;
}

/* --------------------------- History ------------------------------ */
function snapshot(){ return JSON.stringify({nodes:state.nodes, edges:state.edges, nextId:state.nextId, meta:{theme:docTheme, dialect:docDialect}}); }
let coalesce = { key:null, t:0 };
function pushHistory(coalesceKey){
  if (coalesceKey != null){
    const now = Date.now();
    if (coalesce.key === coalesceKey && now - coalesce.t < 1000){ coalesce.t = now; return; }
    coalesce = { key: coalesceKey, t: now };
  } else {
    coalesce = { key:null, t:0 };
  }
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  setDocDirty(true);
  syncHistoryButtons();
}
function restore(json){
  const s = JSON.parse(json);
  state.nodes = s.nodes; state.edges = s.edges; state.nextId = s.nextId;
  applyTheme(s.meta && s.meta.theme ? s.meta.theme : "light", { render:false });
  applyDialect(s.meta && s.meta.dialect ? s.meta.dialect : "ansi", { render:false });
  pruneSelection();
  render();
}
function undo(){ if(!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); setDocDirty(true); syncHistoryButtons(); }
function redo(){ if(!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); setDocDirty(true); syncHistoryButtons(); }
function syncHistoryButtons(){
  document.getElementById("btnUndo").disabled = !undoStack.length;
  document.getElementById("btnRedo").disabled = !redoStack.length;
}

function cleanFieldForDocument(f){
  const out = {...f};
  if (!out.default) delete out.default;
  if (!out.comment) delete out.comment;
  if (!out.unique) delete out.unique;
  if (!out.index) delete out.index;
  delete out.metaOpen;
  return out;
}
function cleanEdgeForDocument(e){
  const out = {...e};
  if (Array.isArray(out.pairs)){
    out.pairs = out.pairs.filter(p => p && (p.fromField || p.toField))
      .map(p => ({fromField:p.fromField || "", toField:p.toField || ""}));
    if (!out.pairs.length) delete out.pairs;
    else if (out.pairs.length === 1){
      out.fromField = out.pairs[0].fromField || out.fromField;
      out.toField = out.pairs[0].toField || out.toField;
    }
  }
  if (!out.fromAnchor) delete out.fromAnchor;
  if (!out.toAnchor) delete out.toAnchor;
  if (!out.fromField) delete out.fromField;
  if (!out.toField) delete out.toField;
  if (!out.routing || out.routing === "curve") delete out.routing;
  return out;
}
function cleanNodeForDocument(n){
  const out = {...n};
  if (Array.isArray(out.fields)) out.fields = out.fields.map(cleanFieldForDocument);
  if (!out.notes) out.notes = out.notes || "";
  return out;
}
function documentObject(){
  const d = {
    version:DOC_VERSION,
    nodes:state.nodes.map(cleanNodeForDocument),
    edges:state.edges.map(cleanEdgeForDocument),
    nextId:state.nextId
  };
  const meta = { theme:docTheme, dialect:docDialect };
  if (recentColors.length) meta.recentColors = recentColors.slice();
  d.meta = meta;
  return d;
}
function serializeDocument(){
  return JSON.stringify(documentObject(), null, 2);
}
function nextIdFromDocument(d){
  return d.nextId || (Math.max(0, ...d.nodes.concat(d.edges)
    .map(x => parseInt(String(x.id).replace(/\D/g,"")) || 0)) + 1);
}
function migrateDocument(d){
  if (!d || typeof d !== "object") throw new Error("bad shape");
  const version = d.version == null ? 1 : Number(d.version);
  if (!Number.isInteger(version) || version < 1) throw new Error("bad version");
  if (version > DOC_VERSION) throw new Error("newer version");
  let out = d;
  for (let v = version; v < DOC_VERSION; v++){
    const migrate = MIGRATIONS[v];
    if (typeof migrate !== "function") throw new Error("missing migration");
    out = migrate(out);
  }
  if (!Array.isArray(out.nodes) || !Array.isArray(out.edges)) throw new Error("bad shape");
  const result = { version:DOC_VERSION, nodes:out.nodes, edges:out.edges, nextId:nextIdFromDocument(out) };
  if (out.meta && typeof out.meta === "object") result.meta = out.meta;
  return result;
}
function applyDocument(d, opts = {}){
  const migrated = migrateDocument(d);
  state.nodes = migrated.nodes;
  state.edges = migrated.edges;
  state.nextId = migrated.nextId;
  ensureFieldIds();
  if (migrated.meta && Array.isArray(migrated.meta.recentColors)){
    recentColors = mergeRecentColors(migrated.meta.recentColors, recentColors);
    persistRecentColors();
  }
  applyTheme(migrated.meta && migrated.meta.theme ? migrated.meta.theme : "light", { render:false });
  applyDialect(migrated.meta && migrated.meta.dialect ? migrated.meta.dialect : "ansi", { render:false });
  clearSelection();
  if (opts.resetHistory !== false){
    undoStack.length = 0;
    redoStack.length = 0;
    syncHistoryButtons();
  }
  render();
  fitView();
}
function importDocText(text, opts = {}){
  const parsed = JSON.parse(text);
  applyDocument(parsed, { resetHistory: opts.resetHistory !== false });
  if (opts.name) doc.name = opts.name;
  doc.handle = opts.handle || null;
  setDocDirty(Boolean(opts.dirty));
  return true;
}
function updateDocLabel(){
  const label = document.getElementById("docLabel");
  const name = doc.name || "untitled.schematic.json";
  const shown = (doc.dirty ? "● " : "") + name;
  if (label){
    label.textContent = shown;
    label.title = name;
  }
  document.title = shown + " — Schematic";
}
function setDocDirty(dirty){
  doc.dirty = dirty;
  updateDocLabel();
  if (dirty){
    scheduleRecoverySave();
    scheduleAutoSave();   // undo/redo also land here, so reverted states auto-save too
  }
  else clearRecoverySave();
}
/* auto-save (issue #43): debounced write-back to the current FSA handle */
function scheduleAutoSave(){
  if (!autoSave || !doc.handle) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    if (autoSave && doc.handle && doc.dirty) saveDoc();
  }, 800);
}
function updateAutoSaveControl(){
  const cb = document.getElementById("autoSaveToggle");
  if (cb) cb.checked = autoSave;
}
async function setAutoSave(on){
  if (!on){
    autoSave = false;
    if (autoSaveTimer){ clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    updateAutoSaveControl();
    return;
  }
  if (!FSA){
    alert("Auto-save needs the File System Access API — use a Chromium browser over HTTPS or localhost.");
    updateAutoSaveControl();
    return;
  }
  if (!doc.handle) await saveAsDoc();   // pick the file to keep saving into
  autoSave = !!doc.handle;
  updateAutoSaveControl();
  if (autoSave && doc.dirty) scheduleAutoSave();
}
function clearRecoverySave(){
  if (recoveryTimer){
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
  if (RECOVERY){
    try { localStorage.removeItem(RECOVERY_KEY); } catch {}
  }
}
function scheduleRecoverySave(){
  if (!RECOVERY) return;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({
        savedAt: Date.now(),
        name: doc.name,
        json: serializeDocument()
      }));
    } catch {}
  }, 2000);
}
function showCapabilityBanner(){
  const banner = document.getElementById("capabilityBanner");
  if (!banner) return;
  const unsupported = !("onpointerdown" in window) || !window.SVGElement;
  if (!unsupported) return;
  banner.textContent = "This browser is missing required canvas capabilities. Use a current browser with SVG and Pointer Events support.";
  banner.hidden = false;
}
function syncAriaLabels(){
  document.querySelectorAll("button[title]:not([aria-label])").forEach(b => b.setAttribute("aria-label", b.title));
  board.setAttribute("tabindex", "0");
  board.setAttribute("role", "application");
  board.setAttribute("aria-label", "Schematic canvas");
}
function maybeShowRecovery(){
  if (!RECOVERY) return;
  let record;
  try { record = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null"); } catch { return; }
  if (!record || !record.json || !record.savedAt || Date.now() - record.savedAt > RECOVERY_MAX_AGE) return;
  const banner = document.getElementById("recoveryBanner");
  if (!banner) return;
  const date = new Date(record.savedAt).toLocaleString();
  banner.innerHTML = "";
  const msg = document.createElement("span");
  msg.textContent = `Recover unsaved diagram "${record.name || "untitled.schematic.json"}" from ${date}?`;
  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = "Restore";
  restoreBtn.addEventListener("click", () => {
    try {
      importDocText(record.json, { name: record.name || "untitled.schematic.json", dirty: true });
      banner.hidden = true;
    } catch {
      banner.hidden = true;
      try { localStorage.removeItem(RECOVERY_KEY); } catch {}
    }
  });
  const discardBtn = document.createElement("button");
  discardBtn.textContent = "Discard";
  discardBtn.addEventListener("click", () => {
    try { localStorage.removeItem(RECOVERY_KEY); } catch {}
    banner.hidden = true;
  });
  banner.append(msg, restoreBtn, discardBtn);
  banner.hidden = false;
}
window.addEventListener("beforeunload", ev => {
  if (!doc.dirty) return;
  ev.preventDefault();
  ev.returnValue = "";
});

/* --------------------------- Geometry ----------------------------- */
function clampSize(v, lo, hi){ v = parseFloat(v); if (!isFinite(v)) v = lo; return Math.min(hi, Math.max(lo, v)); }
function conceptFont(n){ return clampSize(n.fontSize || CONCEPT_FS_DEFAULT, 9, 48); }
/* Concept shape is intentionally optional in the document model: old documents and a
   selected Process both render as the conventional rectangular process symbol. */
function conceptShape(n){ return n && n.type === "concept" && FLOWCHART_SHAPE_SET.has(n.shape) ? n.shape : "process"; }
function setConceptShape(n, shape){
  if (!n || n.type !== "concept") return;
  const next = FLOWCHART_SHAPE_SET.has(shape) ? shape : "process";
  if (next === "process") delete n.shape;
  else n.shape = next;
}
function conceptTextWidth(shape, w){
  return Math.max(44, w - (shape === "decision" ? 42 : shape === "data" || shape === "manualInput" ? 48 : 34));
}
/* one source of truth for table geometry at a given font size */
function tableMetrics(n){
  const base = clampSize(n.fontSize || TABLE_FS_DEFAULT, 8, 28);
  const rowH = Math.round(base * 2);
  const headerH = Math.round(base * 2.96);
  const bs = Math.max(7, base - 3.5);
  const badgeW = Math.round(bs * 2.6), badgeH = Math.round(bs * 1.6);
  return { base, rowH, headerH,
    nameSize: base, typeSize: Math.max(8, base - 1), headerSize: base + 1.5,
    badgeSize: bs, badgeW, badgeH, nameX: 8 + badgeW + 6,
    headerBaseline: Math.round(headerH * 0.64) };
}
function nodeSize(n){
  if (n.type === "frame"){
    return {
      w: clampSize(n.w || FRAME_DEFAULT.w, 120, 4000),
      h: clampSize(n.h || FRAME_DEFAULT.h, 90, 4000)
    };
  }
  if (n.type === "concept"){
    const fs = conceptFont(n);
    const shape = conceptShape(n);
    if (shape === "decision"){
      const h = Math.max(80, Math.round(fs * 3.15 + 38));
      const w = Math.max(160, h * 1.6, textW(n.title || "Untitled", `600 ${fs}px Archivo, sans-serif`) + 72);
      return { w: Math.min(w, 420), h };
    }
    const w = Math.max(130, textW(n.title || "Untitled", `600 ${fs}px Archivo, sans-serif`) +
      (shape === "data" || shape === "manualInput" ? 56 : 44));
    const h = Math.max(40, Math.round(fs * 2.2 + 17.2)) + (shape === "document" ? 8 : 0);
    return { w: Math.min(w, 420), h };
  }
  if (n.type === "todo"){
    const m = tableMetrics(n);
    const headW = textW(n.title || "To-do list", `700 ${m.headerSize}px Archivo, sans-serif`) + 96;
    if (n.collapsed) return { w: Math.min(Math.max(190, headW), 460), h: m.headerH + 10 };
    let maxRow = 150;
    for (const it of n.items){
      const rw = m.nameX + textW(it.text || "", `500 ${m.nameSize}px Archivo, sans-serif`) + 24;
      if (rw > maxRow) maxRow = rw;
    }
    const w = Math.min(Math.max(190, headW, maxRow), 460);
    const h = m.headerH + Math.max(1, n.items.length) * m.rowH + 8;
    return { w, h };
  }
  // table node
  const m = tableMetrics(n);
  const headW = textW(n.title || "table", `700 ${m.headerSize}px Archivo, sans-serif`) + 56;
  if (n.collapsed) return { w: Math.min(Math.max(190, headW), 460), h: m.headerH + 10 };
  let maxRow = 150;
  for (const f of n.fields){
    const rw = m.nameX + textW(f.name + (f.nullable ? "?" : ""), `500 ${m.nameSize}px 'IBM Plex Mono', monospace`)
             + 16 + textW(f.type, `400 ${m.typeSize}px 'IBM Plex Mono', monospace`) + 20;
    if (rw > maxRow) maxRow = rw;
  }
  const w = Math.min(Math.max(190, headW, maxRow), 460);
  const h = m.headerH + Math.max(1, n.fields.length) * m.rowH + 8;
  return { w, h };
}
function nodeRect(n){ const s = nodeSize(n); return { x:n.x, y:n.y, w:s.w, h:s.h, cx:n.x+s.w/2, cy:n.y+s.h/2 }; }
function rectFromPoints(a, b){
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w:Math.abs(a.x - b.x), h:Math.abs(a.y - b.y) };
}
function rectsIntersect(a, b){
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
function rectsOverlap(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function documentBounds(nodes = state.nodes){
  if (!nodes.length) return null;
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for (const n of nodes){
    const r = nodeRect(n);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x:x0, y:y0, w:x1-x0, h:y1-y0, cx:(x0+x1)/2, cy:(y0+y1)/2 };
}
function frameContainedNodes(frame){
  const fr = nodeRect(frame);
  return state.nodes.filter(n => n.type !== "frame" && n.id !== frame.id).filter(n => {
    const r = nodeRect(n);
    return r.cx >= fr.x && r.cx <= fr.x + fr.w && r.cy >= fr.y && r.cy <= fr.y + fr.h;
  });
}

/* point on rect boundary toward an external point */
function anchorOnRect(r, px, py){
  const dx = px - r.cx, dy = py - r.cy;
  if (dx === 0 && dy === 0) return { x:r.cx, y:r.cy, side:"e" };
  const sx = (r.w/2) / Math.abs(dx || 1e-9), sy = (r.h/2) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  const x = r.cx + dx*s, y = r.cy + dy*s;
  let side;
  if (s === sx) side = dx > 0 ? "e" : "w"; else side = dy > 0 ? "s" : "n";
  return { x, y, side };
}

/* 9 node attachment points (3×3): top/middle/bottom × left/center/right.
   Whole-node edge ends snap to the nearest perimeter point automatically;
   an explicit point is stored on the edge as fromAnchor/toAnchor (additive, E8). */
const NODE_ANCHORS = ["tl","tc","tr","ml","mc","mr","bl","bc","br"];
const PERIMETER_ANCHORS = ["tl","tc","tr","ml","mr","bl","bc","br"];
const ANCHOR_LABELS = { tl:"Top left", tc:"Top center", tr:"Top right",
                        ml:"Middle left", mc:"Center", mr:"Middle right",
                        bl:"Bottom left", bc:"Bottom center", br:"Bottom right" };
function anchorPointsForRect(r){
  return {
    tl:{x:r.x,     y:r.y},       tc:{x:r.cx, y:r.y},       tr:{x:r.x+r.w, y:r.y},
    ml:{x:r.x,     y:r.cy},      mc:{x:r.cx, y:r.cy},      mr:{x:r.x+r.w, y:r.cy},
    bl:{x:r.x,     y:r.y+r.h},   bc:{x:r.cx, y:r.y+r.h},   br:{x:r.x+r.w, y:r.y+r.h}
  };
}
/* Diamond anchors sit on the diamond itself rather than its bounding box. */
function conceptBoundaryPoint(n, r, ref){
  if (conceptShape(n) !== "decision") return { x:ref.x, y:ref.y };
  const dx = ref.x - r.cx, dy = ref.y - r.cy;
  if (!dx && !dy) return { x:r.cx, y:r.cy };
  const scale = 1 / (Math.abs(dx) / (r.w/2) + Math.abs(dy) / (r.h/2));
  return { x:r.cx + dx * scale, y:r.cy + dy * scale };
}
function anchorPointsForNode(n, r = nodeRect(n)){
  const pts = anchorPointsForRect(r);
  if (conceptShape(n) !== "decision") return pts;
  for (const key of PERIMETER_ANCHORS) pts[key] = conceptBoundaryPoint(n, r, pts[key]);
  return pts;
}
/* outward side of an anchor point, for curve control points and crow's feet;
   corners and the center pick the dominant axis toward the reference point */
function anchorSideFor(key, p, ref){
  if (key === "tc") return "n";
  if (key === "bc") return "s";
  if (key === "ml") return "w";
  if (key === "mr") return "e";
  const horiz = Math.abs(ref.x - p.x) >= Math.abs(ref.y - p.y);
  if (key === "tl") return horiz ? "w" : "n";
  if (key === "tr") return horiz ? "e" : "n";
  if (key === "bl") return horiz ? "w" : "s";
  if (key === "br") return horiz ? "e" : "s";
  return horiz ? (ref.x - p.x > 0 ? "e" : "w") : (ref.y - p.y > 0 ? "s" : "n"); // mc
}
function nodeAnchor(n, key, ref){
  const r = nodeRect(n);
  const pts = anchorPointsForNode(n, r);
  let k = key && pts[key] ? key : null;
  /* Unpinned Decision connections use the actual diamond intersection, so an edge
     never appears to begin in the empty corner of its rectangular bounding box. */
  if (!k && conceptShape(n) === "decision"){
    const p = conceptBoundaryPoint(n, r, ref);
    const dx = ref.x - r.cx, dy = ref.y - r.cy;
    const horiz = Math.abs(dx) / r.w >= Math.abs(dy) / r.h;
    return { x:p.x, y:p.y, side:horiz ? (dx >= 0 ? "e" : "w") : (dy >= 0 ? "s" : "n"), key:null };
  }
  if (!k){
    let bd = Infinity;
    for (const cand of PERIMETER_ANCHORS){
      const p = pts[cand];
      const d = (p.x - ref.x)**2 + (p.y - ref.y)**2;
      if (d < bd){ bd = d; k = cand; }
    }
  }
  const p = pts[k];
  return { x:p.x, y:p.y, side:anchorSideFor(k, p, ref), key:k };
}
/* nearest perimeter point within tolerance — used to pin the drop end of a drag */
function nearestAnchorWithin(n, w, tol = 16){
  const pts = anchorPointsForNode(n);
  let best = null, bd = tol*tol;
  for (const key of PERIMETER_ANCHORS){
    const p = pts[key];
    const d = (p.x - w.x)**2 + (p.y - w.y)**2;
    if (d <= bd){ bd = d; best = { key, x:p.x, y:p.y }; }
  }
  return best;
}
function clientToWorld(cx, cy){
  const b = board.getBoundingClientRect();
  return { x: (cx - b.left - view.x)/view.k, y: (cy - b.top - view.y)/view.k };
}

/* ---------------------------- Render ------------------------------ */
function el(tag, attrs, parent){
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

let world, frameLayer, edgeLayer, nodeLayer, draftLayer, minimap, minimapDrag = false;
const renderStats = { full:0, fast:0 };

function buildScaffold(){
  board.innerHTML = "";
  const defs = el("defs", {}, board);
  const pat = el("pattern", {id:"dots", width:24, height:24, patternUnits:"userSpaceOnUse"}, defs);
  el("circle", {cx:1.2, cy:1.2, r:1.2, fill:themeColors().grid}, pat);

  world = el("g", {id:"world"}, board);
  el("rect", {x:-50000, y:-50000, width:100000, height:100000, fill:"url(#dots)",
              "data-bg":"1"}, world);
  frameLayer = el("g", {id:"frameLayer"}, world);
  edgeLayer  = el("g", {id:"edgeLayer"}, world);
  nodeLayer  = el("g", {id:"nodeLayer"}, world);
  draftLayer = el("g", {id:"draftLayer"}, world);
  ensureMinimap();
  applyView();
}
function applyView(){
  if (inlineEditor) closeInlineEditor(false);
  world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
  document.getElementById("zoomLabel").textContent = Math.round(view.k*100) + "%";
  renderMinimap();
}

function render(){
  renderStats.full++;
  frameLayer.innerHTML = "";
  edgeLayer.innerHTML = "";
  nodeLayer.innerHTML = "";
  draftLayer.innerHTML = "";
  for (const n of state.nodes) if (n.type === "frame") drawFrame(n);
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) if (n.type !== "frame") drawNode(n);
  drawEdgeGrips();
  const frames = state.nodes.filter(n => n.type === "frame").length;
  const nodes = state.nodes.length - frames;
  document.getElementById("countLabel").textContent =
    frames ? `${nodes} nodes · ${frames} frames · ${state.edges.length} edges`
           : `${nodes} nodes · ${state.edges.length} edges`;
  renderMinimap();
  renderInspector();
}
function fastDragRender(ids){
  renderStats.fast++;
  const moved = new Set(ids);
  for (const id of moved){
    const n = nodeById(id);
    const g = n && document.querySelector(`[data-node="${id}"]`);
    if (n && g) g.setAttribute("transform", `translate(${n.x},${n.y})`);
  }
  const incident = state.edges.filter(e => moved.has(e.from) || moved.has(e.to));
  for (const e of incident){
    const old = edgeLayer.querySelector(`[data-edge="${e.id}"]`);
    if (old) old.remove();
    drawEdge(e);
  }
  renderMinimap();
}

function minimapTransform(bounds, viewState, box){
  if (!bounds || !bounds.w || !bounds.h) return null;
  const pad = 40;
  const bx = bounds.x - pad, by = bounds.y - pad;
  const bw = Math.max(1, bounds.w + pad*2), bh = Math.max(1, bounds.h + pad*2);
  const scale = Math.min(box.w / bw, box.h / bh);
  const ox = (box.w - bw*scale)/2 - bx*scale;
  const oy = (box.h - bh*scale)/2 - by*scale;
  const viewportW = box.viewportW || box.boardW || 0;
  const viewportH = box.viewportH || box.boardH || 0;
  const worldViewport = {
    x: -viewState.x / viewState.k,
    y: -viewState.y / viewState.k,
    w: viewportW / viewState.k,
    h: viewportH / viewState.k
  };
  const toMini = p => ({ x:p.x*scale + ox, y:p.y*scale + oy });
  const toWorld = p => ({ x:(p.x - ox)/scale, y:(p.y - oy)/scale });
  return {
    scale, ox, oy, toMini, toWorld, worldViewport,
    viewport: {
      x: worldViewport.x*scale + ox,
      y: worldViewport.y*scale + oy,
      w: worldViewport.w*scale,
      h: worldViewport.h*scale
    }
  };
}
function ensureMinimap(){
  if (minimap) return minimap;
  minimap = el("svg", {id:"minimap", width:120, height:90, viewBox:"0 0 120 90", "aria-label":"Minimap"}, wrap);
  const centerFromEvent = ev => {
    const b = minimap.getBoundingClientRect();
    const br = board.getBoundingClientRect();
    const bounds = documentBounds();
    const tx = minimapTransform(bounds, view, {w:b.width || 120, h:b.height || 90, viewportW:br.width, viewportH:br.height});
    if (!tx) return;
    const w = tx.toWorld({x: ev.clientX - b.left, y: ev.clientY - b.top});
    centerViewOn(w.x, w.y);
  };
  minimap.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    minimapDrag = true;
    if (minimap.setPointerCapture) minimap.setPointerCapture(ev.pointerId);
    centerFromEvent(ev);
  });
  minimap.addEventListener("pointermove", ev => {
    if (!minimapDrag) return;
    ev.preventDefault();
    centerFromEvent(ev);
  });
  minimap.addEventListener("pointerup", ev => {
    minimapDrag = false;
    if (minimap.releasePointerCapture) minimap.releasePointerCapture(ev.pointerId);
  });
  minimap.addEventListener("pointercancel", () => { minimapDrag = false; });
  return minimap;
}
function renderMinimap(){
  if (!minimap) return;
  if (state.nodes.length > 500 || !state.nodes.length){
    minimap.hidden = true;
    return;
  }
  const bounds = documentBounds();
  const br = board.getBoundingClientRect();
  const tx = minimapTransform(bounds, view, {w:120, h:90, viewportW:br.width, viewportH:br.height});
  if (!tx){ minimap.hidden = true; return; }
  const t = themeColors();
  minimap.hidden = false;
  minimap.innerHTML = "";
  el("rect", {x:0, y:0, width:120, height:90, rx:6, fill:t.panel}, minimap);
  for (const n of state.nodes){
    const r = nodeRect(n);
    const p = tx.toMini({x:r.x, y:r.y});
    const fill = n.type === "frame" ? n.color || FRAME_DEFAULT.color : n.color || t.ink;
    el("rect", {x:p.x, y:p.y, width:r.w*tx.scale, height:r.h*tx.scale, rx:n.type === "frame" ? 2 : 1.5,
                fill, opacity:n.type === "frame" ? .18 : .72, stroke:t.ink, "stroke-width":.35}, minimap);
  }
  el("rect", {x:tx.viewport.x, y:tx.viewport.y, width:tx.viewport.w, height:tx.viewport.h,
              fill:"none", stroke:"#C63A3A", "stroke-width":1.2}, minimap);
}
function centerViewOn(x, y){
  const b = board.getBoundingClientRect();
  view.x = b.width/2 - x*view.k;
  view.y = b.height/2 - y*view.k;
  applyView();
}

/* ---- edges ---- */
function fieldRowCenterY(n, idx){ const m = tableMetrics(n); return nodeRect(n).y + m.headerH + idx*m.rowH + m.rowH/2; }
function fieldAnchor(n, idx, towardX){
  const r = nodeRect(n);
  const side = towardX >= r.cx ? "e" : "w";
  return { x: side === "e" ? r.x + r.w : r.x, y: fieldRowCenterY(n, idx), side };
}
function edgeFieldPairs(e){
  if (Array.isArray(e.pairs) && e.pairs.length)
    return e.pairs.filter(p => p && (p.fromField || p.toField));
  if (e.fromField || e.toField) return [{ fromField:e.fromField || "", toField:e.toField || "" }];
  return [];
}
function edgeEndpoints(e){
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return null;
  if (a.type === "frame" || b.type === "frame") return null;
  const ra = nodeRect(a), rb = nodeRect(b);
  const firstPair = edgeFieldPairs(e)[0] || {};
  const fromField = firstPair.fromField || e.fromField;
  const toField = firstPair.toField || e.toField;
  const rowsA = a.collapsed ? null : nodeRows(a);
  const rowsB = b.collapsed ? null : nodeRows(b);
  const ia = (fromField && rowsA) ? rowsA.findIndex(f => f.id === fromField) : -1;
  const ib = (toField   && rowsB) ? rowsB.findIndex(f => f.id === toField)   : -1;
  /* reference points: bound field row centers, else node centers */
  const refA = ia >= 0 ? { x: ra.cx, y: fieldRowCenterY(a, ia) } : { x: ra.cx, y: ra.cy };
  const refB = ib >= 0 ? { x: rb.cx, y: fieldRowCenterY(b, ib) } : { x: rb.cx, y: rb.cy };
  const pa = ia >= 0 ? fieldAnchor(a, ia, refB.x) : nodeAnchor(a, e.fromAnchor, refB);
  const pb = ib >= 0 ? fieldAnchor(b, ib, refA.x) : nodeAnchor(b, e.toAnchor, refA);
  return { pa, pb, boundA: ia >= 0, boundB: ib >= 0,
           pinnedA: ia < 0 && !!e.fromAnchor, pinnedB: ib < 0 && !!e.toAnchor };
}
function curveEdgePath(pa, pb){
  const dx = Math.max(40, Math.abs(pb.x - pa.x) * 0.45);
  const dy = Math.max(40, Math.abs(pb.y - pa.y) * 0.45);
  const c = p => p.side === "e" ? [p.x + dx, p.y] : p.side === "w" ? [p.x - dx, p.y]
            : p.side === "s" ? [p.x, p.y + dy] : [p.x, p.y - dy];
  const [c1x, c1y] = c(pa), [c2x, c2y] = c(pb);
  return `M ${pa.x} ${pa.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pb.x} ${pb.y}`;
}
function orthoEdgePath(pa, pb){
  const stub = 12;
  const out = p => {
    if (p.side === "e") return { x:p.x + stub, y:p.y };
    if (p.side === "w") return { x:p.x - stub, y:p.y };
    if (p.side === "s") return { x:p.x, y:p.y + stub };
    return { x:p.x, y:p.y - stub };
  };
  const a = out(pa), b = out(pb);
  if (pa.side === "e" || pa.side === "w" || pb.side === "e" || pb.side === "w"){
    const mx = (a.x + b.x) / 2;
    return `M ${pa.x} ${pa.y} L ${a.x} ${a.y} H ${mx} V ${b.y} H ${b.x} L ${pb.x} ${pb.y}`;
  }
  const my = (a.y + b.y) / 2;
  return `M ${pa.x} ${pa.y} L ${a.x} ${a.y} V ${my} H ${b.x} V ${b.y} L ${pb.x} ${pb.y}`;
}
function edgePath(e, pa, pb){
  if (!pb){ pb = pa; pa = e; e = null; }
  return e && e.routing === "ortho" ? orthoEdgePath(pa, pb) : curveEdgePath(pa, pb);
}
/* crow's-foot / tick notation drawn along the anchor's outward normal */
function drawNotation(g, p, glyph, color){
  const dir = { e:[1,0], w:[-1,0], s:[0,1], n:[0,-1] }[p.side];
  const nx = dir[0], ny = dir[1];          // outward from node
  const px = -ny, py = nx;                  // perpendicular
  const L = 12, S = 6;
  if (glyph === "one"){                     // single tick at distance L
    const bx = p.x + nx*L, by = p.y + ny*L;
    el("line", {x1:bx - px*S, y1:by - py*S, x2:bx + px*S, y2:by + py*S,
                stroke:color, "stroke-width":1.6}, g);
  } else {                                  // crow's foot: three prongs into node
    const bx = p.x + nx*L, by = p.y + ny*L; // base on the line
    for (const t of [-1, 0, 1]){
      el("line", {x1:bx, y1:by, x2:p.x + px*S*t, y2:p.y + py*S*t,
                  stroke:color, "stroke-width":1.6}, g);
    }
  }
}
function drawEdge(e){
  const ep = edgeEndpoints(e);
  if (!ep) return;
  const selected = isSelected("edge", e.id);
  const isLink = e.kind === "link";
  const t = themeColors();
  const color = selected ? t.accent : (isLink ? t.link : t.edge);
  const g = el("g", {"data-edge": e.id, cursor:"pointer"}, edgeLayer);
  const d = edgePath(e, ep.pa, ep.pb);
  el("path", {d, fill:"none", stroke:"transparent", "stroke-width":14}, g); // hit area
  el("path", {d, fill:"none", stroke:color, "stroke-width": selected ? 2.4 : 1.7,
              "stroke-dasharray": isLink ? "5 5" : "none",
              "stroke-linecap":"round"}, g);
  if (!isLink){
    const [gf, gt] = e.kind === "1:1" ? ["one","one"]
                   : e.kind === "1:N" ? ["one","many"] : ["many","many"];
    drawNotation(g, ep.pa, gf, color);
    drawNotation(g, ep.pb, gt, color);
  }
  if (ep.boundA || ep.pinnedA) el("circle", {cx:ep.pa.x, cy:ep.pa.y, r:3, fill:color}, g);
  if (ep.boundB || ep.pinnedB) el("circle", {cx:ep.pb.x, cy:ep.pb.y, r:3, fill:color}, g);
  let label = e.label || (isLink ? "" : e.kind);
  const pairCount = edgeFieldPairs(e).length;
  if (!isLink && pairCount > 1) label += ` · ${pairCount} cols`;
  if (label){
    const mx = (ep.pa.x + ep.pb.x)/2, my = (ep.pa.y + ep.pb.y)/2;
    const w = textW(label, "600 10.5px 'IBM Plex Mono', monospace") + 14;
    el("rect", {x:mx - w/2, y:my - 10, width:w, height:20, rx:10,
                fill:t.labelBg, stroke:color, "stroke-width":1}, g);
    el("text", {x:mx, y:my + 3.5, "text-anchor":"middle", fill:color,
                "font-family":"'IBM Plex Mono', monospace", "font-size":10.5,
                "font-weight":600}, g).textContent = label;
  }
}

/* ---- nodes ---- */
function drawFrame(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const color = n.color || FRAME_DEFAULT.color;
  const g = el("g", {"data-node": n.id, "data-frame": n.id, transform:`translate(${r.x},${r.y})`, cursor:"grab"}, frameLayer);
  el("rect", {width:r.w, height:r.h, rx:14, fill:color, opacity:.10,
              stroke:selected ? t.accent : color, "stroke-width":selected ? 2.2 : 1.4}, g);
  el("text", {x:14, y:24, fill:t.ink, "font-family":"Archivo, sans-serif",
              "font-size":13, "font-weight":700}, g)
    .textContent = truncate(n.title || "Subject area", r.w - 48, "700 13px Archivo, sans-serif");
  const h = el("g", {class:"frame-resize", "data-frame-resize": n.id, cursor:"nwse-resize"}, g);
  el("rect", {x:r.w - 18, y:r.h - 18, width:18, height:18, fill:"transparent"}, h);
  el("path", {d:`M ${r.w-15} ${r.h-5} L ${r.w-5} ${r.h-15} M ${r.w-10} ${r.h-5} L ${r.w-5} ${r.h-10}`,
              stroke:selected ? t.accent : color, "stroke-width":1.6, "stroke-linecap":"round"}, h);
}
function drawConceptShape(g, n, r, attrs){
  const shape = conceptShape(n);
  const common = { ...attrs, "data-node-shape":shape, "stroke-linejoin":"round" };
  if (shape === "process") return el("rect", {width:r.w, height:r.h, rx:4, ...common}, g);
  if (shape === "terminator") return el("rect", {width:r.w, height:r.h, rx:r.h/2, ...common}, g);
  if (shape === "decision")
    return el("path", {d:`M ${r.w/2} 0 L ${r.w} ${r.h/2} L ${r.w/2} ${r.h} L 0 ${r.h/2} Z`, ...common}, g);
  if (shape === "data")
    return el("path", {d:`M 18 0 H ${r.w} L ${r.w-18} ${r.h} H 0 Z`, ...common}, g);
  if (shape === "document"){
    const wave = Math.min(12, Math.max(7, r.h * .18));
    return el("path", {d:`M 0 0 H ${r.w} V ${r.h-wave} C ${r.w*.82} ${r.h+wave*.25}, ${r.w*.66} ${r.h-wave*.35}, ${r.w/2} ${r.h-wave*.02} C ${r.w*.33} ${r.h+wave*.32}, ${r.w*.16} ${r.h-wave*.28}, 0 ${r.h-wave*.02} Z`, ...common}, g);
  }
  /* Manual input: the sloped leading edge is the conventional flowchart symbol. */
  return el("path", {d:`M 20 0 H ${r.w} L ${r.w-14} ${r.h} H 0 Z`, ...common}, g);
}
function drawNode(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const g = el("g", {"data-node": n.id, transform:`translate(${r.x},${r.y})`, cursor:"grab"}, nodeLayer);

  if (n.type === "concept"){
    const fs = conceptFont(n);
    const fc = n.fontColor || t.ink;
    const shape = conceptShape(n);
    drawConceptShape(g, n, r, {fill:n.color || CONCEPT_COLORS[0],
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.2});
    const titleText = el("text", {x:r.w/2, y:r.h/2 + fs*0.35, "text-anchor":"middle", fill:fc,
                "font-family":"Archivo, sans-serif", "font-size":fs, "font-weight":600}, g);
    titleText.textContent = truncate(n.title || "Untitled", conceptTextWidth(shape, r.w), `600 ${fs}px Archivo, sans-serif`);
    if (n.notes){
      const noteAtSide = shape === "decision" || shape === "terminator";
      el("circle", {cx:noteAtSide ? r.w - 14 : r.w - 12, cy:noteAtSide ? r.h/2 : 12,
                    r:3.2, fill:t.ink, opacity:.55}, g);
    }
  } else if (n.type === "todo"){
    const m = tableMetrics(n);
    const fc = n.fontColor || t.ink;
    const total = n.items.length;
    const doneCount = n.items.filter(it => it.done).length;
    el("rect", {width:r.w, height:r.h, rx:10, fill:t.tableFill,
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.3}, g);
    el("path", {d:`M 0 10 Q 0 0 10 0 H ${r.w-10} Q ${r.w} 0 ${r.w} 10 V ${m.headerH} H 0 Z`,
                fill: n.color || TODO_COLOR_DEFAULT}, g);
    const ht = el("text", {x:12, y:m.headerBaseline, fill:fc, "font-family":"Archivo, sans-serif",
                "font-size":m.headerSize, "font-weight":700}, g);
    ht.textContent = truncate(n.title || "To-do list", r.w - 96, `700 ${m.headerSize}px Archivo, sans-serif`);
    if (n.notes) el("circle", {cx:r.w - 62, cy:Math.max(10, m.headerH/2), r:3.2, fill:fc, opacity:.55}, g);
    el("text", {x:r.w - 34, y:m.headerBaseline, "text-anchor":"end", fill:fc, opacity:.75,
                "font-family":"'IBM Plex Mono', monospace", "font-size":Math.max(8, m.base - 1)}, g)
      .textContent = `${doneCount}/${total}`;
    const cg = el("g", {"data-collapse":n.id, cursor:"pointer"}, g);
    el("rect", {x:r.w - 24, y:0, width:24, height:m.headerH, fill:"transparent"}, cg);
    el("text", {x:r.w - 12, y:m.headerBaseline, "text-anchor":"middle", fill:fc, opacity:.85,
                "font-family":"'IBM Plex Mono', monospace", "font-size":Math.max(10, m.base)}, cg)
      .textContent = n.collapsed ? "▸" : "▾";
    if (n.collapsed){
      el("text", {x:12, y:m.headerH + 2, fill:t.muted, "font-family":"'IBM Plex Mono', monospace",
                  "font-size":Math.max(8, m.base - 1)}, g)
        .textContent = `${total} items`;
    } else {
      const cbSize = Math.max(9, Math.round(m.badgeH * 1.05));
      n.items.forEach((it, i) => {
        const rowTop = m.headerH + i*m.rowH;
        const cy = rowTop + m.rowH/2;
        if (i > 0) el("line", {x1:8, y1:rowTop, x2:r.w-8, y2:rowTop, stroke:t.rowLine, "stroke-width":1}, g);
        const cb = el("g", {"data-todocheck": it.id, "data-todonode": n.id, cursor:"pointer",
                            role:"checkbox", "aria-checked": it.done ? "true" : "false",
                            "aria-label": `${it.done ? "Done" : "Not done"}: ${it.text || "item"}`}, g);
        el("rect", {x:4, y:rowTop + 1, width:m.nameX - 6, height:m.rowH - 2, fill:"transparent"}, cb);
        el("rect", {x:8, y:cy - cbSize/2, width:cbSize, height:cbSize, rx:3,
                    fill: it.done ? t.accent : t.tableFill,
                    stroke: it.done ? t.accent : t.ink, "stroke-width":1.1}, cb);
        if (it.done)
          el("path", {d:`M ${8 + cbSize*0.22} ${cy + cbSize*0.02} L ${8 + cbSize*0.42} ${cy + cbSize*0.24} L ${8 + cbSize*0.8} ${cy - cbSize*0.26}`,
                      stroke:t.tableFill, "stroke-width":1.6, fill:"none",
                      "stroke-linecap":"round", "stroke-linejoin":"round"}, cb);
        /* item text keeps the theme ink (issue #44): n.fontColor styles only the header,
           otherwise a light header color would blank out every item row */
        const label = el("text", {x:m.nameX, y:cy + m.nameSize*0.35, fill: it.done ? t.muted : t.ink,
                    "font-family":"Archivo, sans-serif", "font-size":m.nameSize, "font-weight":500}, g);
        if (it.done) label.setAttribute("text-decoration", "line-through");
        label.textContent = truncate(it.text || "…", r.w - m.nameX - 16, `500 ${m.nameSize}px Archivo, sans-serif`);
      });
      if (!n.items.length)
        el("text", {x:12, y:m.headerH + 16, fill:t.empty, "font-family":"Archivo, sans-serif",
                    "font-size":11.5, "font-style":"italic"}, g).textContent = "no items yet";
      drawRowHandles(g, n, n.items, r, t);
    }
  } else {
    const m = tableMetrics(n);
    const fc = n.fontColor || t.ink;
    el("rect", {width:r.w, height:r.h, rx:8, fill:t.tableFill,
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.3}, g);
    el("path", {d:`M 0 8 Q 0 0 8 0 H ${r.w-8} Q ${r.w} 0 ${r.w} 8 V ${m.headerH} H 0 Z`,
                fill: n.color || t.ink}, g);
    const ht = el("text", {x:12, y:m.headerBaseline, fill:t.tableText, "font-family":"Archivo, sans-serif",
                "font-size":m.headerSize, "font-weight":700, "letter-spacing":".04em"}, g);
    ht.textContent = truncate(n.title || "table", r.w - 82, `700 ${m.headerSize}px Archivo, sans-serif`);
    if (n.notes) el("circle", {cx:r.w - 34, cy:Math.max(10, m.headerH/2), r:3.2, fill:t.tableText, opacity:.7}, g);
    const cg = el("g", {"data-collapse":n.id, cursor:"pointer"}, g);
    el("rect", {x:r.w - 24, y:0, width:24, height:m.headerH, fill:"transparent"}, cg);
    el("text", {x:r.w - 12, y:m.headerBaseline, "text-anchor":"middle", fill:t.tableText, opacity:.85,
                "font-family":"'IBM Plex Mono', monospace", "font-size":Math.max(10, m.base)}, cg)
      .textContent = n.collapsed ? "▸" : "▾";
    el("text", {x:r.w - 34, y:m.headerBaseline, "text-anchor":"end", fill:t.tableText, opacity:.75,
                "font-family":"'IBM Plex Mono', monospace", "font-size":Math.max(8, m.base-2)}, g)
      .textContent = "TBL";
    if (n.collapsed){
      el("text", {x:12, y:m.headerH + 2, fill:t.muted, "font-family":"'IBM Plex Mono', monospace",
                  "font-size":Math.max(8, m.base - 1)}, g)
        .textContent = `${n.fields.length} fields`;
    } else {
    n.fields.forEach((f, i) => {
      const rowTop = m.headerH + i*m.rowH;
      const cy = rowTop + m.rowH/2;
      if (i > 0) el("line", {x1:8, y1:rowTop, x2:r.w-8, y2:rowTop, stroke:t.rowLine, "stroke-width":1}, g);
      const badge = f.pk ? "PK" : f.fk ? "FK" : f.unique ? "U" : "";
      if (badge){
        el("rect", {x:8, y:cy - m.badgeH/2, width:m.badgeW, height:m.badgeH, rx:3,
                    fill: f.pk ? t.ink : f.unique ? t.accent : t.tableFill,
                    stroke:t.ink, "stroke-width":.9}, g);
        el("text", {x:8 + m.badgeW/2, y:cy + m.badgeSize*0.34, "text-anchor":"middle",
                    fill: f.pk || f.unique ? t.tableText : t.ink,
                    "font-family":"'IBM Plex Mono', monospace", "font-size":m.badgeSize,
                    "font-weight":600}, g).textContent = badge;
      }
      const nm = el("text", {x:m.nameX, y:cy + m.nameSize*0.35, fill:fc,
                  "font-family":"'IBM Plex Mono', monospace", "font-size":m.nameSize,
                  "font-weight":500}, g);
      if (f.comment) nm.setAttribute("title", f.comment);
      nm.textContent = f.name + (f.nullable ? "?" : "");
      el("text", {x:r.w-12, y:cy + m.nameSize*0.35, "text-anchor":"end", fill:t.muted,
                  "font-family":"'IBM Plex Mono', monospace", "font-size":m.typeSize}, g)
        .textContent = f.type;
    });
    if (!n.fields.length)
      el("text", {x:12, y:m.headerH + 16, fill:t.empty, "font-family":"Archivo, sans-serif",
                  "font-size":11.5, "font-style":"italic"}, g).textContent = "no fields yet";

    drawRowHandles(g, n, n.fields, r, t);
    }
  }

  /* 9 attachment points (3×3): drag from a point to pin the connection to it.
     mr stays always-visible as the primary connect affordance; the rest reveal
     on hover (anchorhandle class — stripped from PNG/SVG via [data-handle]). */
  const anchorPts = anchorPointsForNode(n, { x:0, y:0, w:r.w, h:r.h, cx:r.w/2, cy:r.h/2 });
  for (const key of NODE_ANCHORS){
    const p = anchorPts[key];
    const hg = el("g", {class: key === "mr" ? "" : "anchorhandle",
                        "data-handle": n.id, "data-anchor": key, cursor:"crosshair"}, g);
    el("circle", {cx:p.x, cy:p.y, r: key === "mc" ? 8 : 12, fill:"transparent"}, hg);
    el("circle", {cx:p.x, cy:p.y, r: key === "mr" ? 5.5 : 3.6, fill:t.tableFill,
                  stroke: selected ? t.accent : t.ink, "stroke-width":1.4,
                  opacity: selected ? 1 : .55}, hg);
  }
}
/* per-row connect handles (left + right of each row) — tables and todos */
function drawRowHandles(g, n, rows, r, t){
  const m = tableMetrics(n);
  rows.forEach((f, i) => {
    const y = m.headerH + i*m.rowH + m.rowH/2;
    for (const x of [0, r.w]){
      const fh = el("g", {class:"fieldhandle", "data-fieldhandle": f.id,
                          "data-fieldnode": n.id, cursor:"crosshair"}, g);
      el("circle", {cx:x, cy:y, r:14, fill:"transparent"}, fh);
      el("circle", {cx:x, cy:y, r:3.6, fill:t.tableFill,
                    stroke:t.accent, "stroke-width":1.4}, fh);
    }
  });
}
function truncate(str, maxW, font){
  if (textW(str, font) <= maxW) return str;
  let s = str;
  while (s.length > 1 && textW(s + "…", font) > maxW) s = s.slice(0, -1);
  return s + "…";
}

/* ------------------------- Mutations ------------------------------ */
function addNode(type, x, y){
  pushHistory();
  let n;
  if (type === "concept"){
    n = { id: uid(), type, x, y, title:"New idea", notes:"",
          color: CONCEPT_COLORS[state.nodes.filter(n=>n.type==="concept").length % CONCEPT_COLORS.length] };
  } else if (type === "frame"){
    n = { id: uid(), type, x, y, title:"Subject area", color:FRAME_DEFAULT.color,
          w:FRAME_DEFAULT.w, h:FRAME_DEFAULT.h };
  } else if (type === "todo"){
    n = { id: uid(), type, x, y, title:"To-do list", notes:"", color:TODO_COLOR_DEFAULT,
          items:[{ id: uid(), text:"New item" }] };
  } else {
    n = { id: uid(), type:"table", x, y, title:uniqueTableTitle("new_table"), notes:"", color:themeColors("light").ink,
          fields:[{id: uid(), name:"id", type:"SERIAL", pk:true, fk:false, nullable:false}] };
  }
  state.nodes.push(n);
  setSelection("node", n.id);
  render();
  focusTitleInput();
  return n;
}
function addEdge(from, to){
  if (from.id === to.id) return;
  let a = nodeById(from.id), b = nodeById(to.id);
  if (!a || !b || a.type === "frame" || b.type === "frame") return;
  const key = ep => ep.id + ":" + (ep.fieldId || "");
  const dup = state.edges.some(e => {
    const ef = e.from + ":" + (e.fromField || ""), et = e.to + ":" + (e.toField || "");
    return (ef === key(from) && et === key(to)) || (ef === key(to) && et === key(from));
  });
  if (dup) return;
  pushHistory();
  const kind = (a.type === "table" && b.type === "table") ? "1:N" : "link";
  /* field-to-field between tables: orient so the PK/"one" side is `from`
     (drag FK column → PK column or the reverse; both come out right) */
  if (kind !== "link" && from.fieldId && to.fieldId){
    const fa = a.fields.find(f => f.id === from.fieldId);
    const fb = b.fields.find(f => f.id === to.fieldId);
    if (fa && fb && !fa.pk && fb.pk){ const t = from; from = to; to = t; }
  }
  const e = { id: uid(), from: from.id, to: to.id, kind, label:"" };
  if (from.fieldId) e.fromField = from.fieldId;
  if (to.fieldId)   e.toField   = to.fieldId;
  if (!e.fromField && from.anchor) e.fromAnchor = from.anchor;
  if (!e.toField && to.anchor)     e.toAnchor   = to.anchor;
  if (kind !== "link" && (e.fromField || e.toField)) e.pairs = [{ fromField:e.fromField || "", toField:e.toField || "" }];
  state.edges.push(e);
  setSelection("edge", e.id);
  render();
}
function deleteSelection(){
  if (!sel) return;
  pushHistory();
  if (sel.kind === "node"){
    const ids = new Set(selectionIds("node"));
    state.edges = state.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
    state.nodes = state.nodes.filter(n => !ids.has(n.id));
  } else {
    const ids = new Set(selectionIds("edge"));
    state.edges = state.edges.filter(e => !ids.has(e.id));
  }
  clearSelection();
  render();
}
function duplicateSelection(){
  const ids = selectionIds("node");
  if (!ids.length) return;
  pushHistory();
  const result = pastePayload(cloneSelectionPayload(ids), 36, false);
  setSelection("node", result.nodeIds);
  render();
}
function cloneSelectionPayload(ids){
  const nodeIds = new Set(ids);
  return {
    nodes: state.nodes.filter(n => nodeIds.has(n.id)).map(n => JSON.parse(JSON.stringify(n))),
    edges: state.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map(e => JSON.parse(JSON.stringify(e)))
  };
}
function remapPayload(payload, offset = 36){
  const nodeMap = new Map();
  const fieldMap = new Map();
  const edgeMap = new Map();
  const nodes = payload.nodes.map(src => {
    const n = JSON.parse(JSON.stringify(src));
    nodeMap.set(src.id, uid());
    n.id = nodeMap.get(src.id);
    n.x += offset;
    n.y += offset;
    const rows = nodeRows(n);
    if (rows){
      for (const f of rows){
        const oldId = f.id;
        f.id = uid();
        fieldMap.set(oldId, f.id);
      }
    }
    return n;
  });
  const edges = payload.edges.map(src => {
    const e = JSON.parse(JSON.stringify(src));
    edgeMap.set(src.id, uid());
    e.id = edgeMap.get(src.id);
    e.from = nodeMap.get(src.from);
    e.to = nodeMap.get(src.to);
    if (e.fromField) e.fromField = fieldMap.get(e.fromField) || e.fromField;
    if (e.toField) e.toField = fieldMap.get(e.toField) || e.toField;
    if (Array.isArray(e.pairs)){
      e.pairs = e.pairs.map(p => ({
        fromField: fieldMap.get(p.fromField) || p.fromField,
        toField: fieldMap.get(p.toField) || p.toField
      }));
    }
    return e;
  }).filter(e => e.from && e.to);
  return { nodes, edges, nodeIds:nodes.map(n => n.id) };
}
function pastePayload(payload, offset = 36, mutate = true){
  const remapped = remapPayload(payload, offset);
  if (mutate) pushHistory();
  state.nodes.push(...remapped.nodes);
  state.edges.push(...remapped.edges);
  /* duplicated/pasted tables must not collide with existing names (issue #46) */
  for (const n of remapped.nodes)
    if (n.type === "table") n.title = uniqueTableTitle(n.title, n);
  return remapped;
}
/* table names are unique by their SQL identifier (issue #46) */
function tableNameConflict(node, title){
  const key = ident(title);
  return state.nodes.some(n => n !== node && n.type === "table" && ident(n.title) === key);
}
function uniqueTableTitle(base, node = null){
  const conflict = t => state.nodes.some(n => n !== node && n.type === "table" && ident(n.title) === ident(t));
  const title = base || "new_table";
  if (!conflict(title)) return title;
  let i = 2;
  while (conflict(title + "_" + i)) i++;
  return title + "_" + i;
}
function copySelection(cut = false){
  const ids = selectionIds("node");
  if (!ids.length) return false;
  clipboardData = cloneSelectionPayload(ids);
  const text = JSON.stringify(clipboardData);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).catch(() => {});
  } catch {}
  if (cut) deleteSelection();
  return true;
}
function pasteSelection(){
  if (!clipboardData || !clipboardData.nodes || !clipboardData.nodes.length) return false;
  const result = pastePayload(clipboardData, 36, true);
  setSelection("node", result.nodeIds);
  render();
  return true;
}
function alignSelection(mode){
  const nodes = selectedNodes();
  if (nodes.length < 2) return false;
  pushHistory();
  const entries = nodes.map(n => ({ n, r:nodeRect(n) }));
  if (mode === "left"){
    const x = Math.min(...entries.map(e => e.r.x));
    for (const e of entries) e.n.x = x;
  } else if (mode === "right"){
    const x = Math.max(...entries.map(e => e.r.x + e.r.w));
    for (const e of entries) e.n.x = x - e.r.w;
  } else if (mode === "top"){
    const y = Math.min(...entries.map(e => e.r.y));
    for (const e of entries) e.n.y = y;
  } else if (mode === "bottom"){
    const y = Math.max(...entries.map(e => e.r.y + e.r.h));
    for (const e of entries) e.n.y = y - e.r.h;
  } else if (mode === "centerX"){
    const cx = entries.reduce((sum, e) => sum + e.r.cx, 0) / entries.length;
    for (const e of entries) e.n.x = cx - e.r.w/2;
  } else if (mode === "centerY"){
    const cy = entries.reduce((sum, e) => sum + e.r.cy, 0) / entries.length;
    for (const e of entries) e.n.y = cy - e.r.h/2;
  } else if (mode === "distributeX"){
    distribute(entries, "x");
  } else if (mode === "distributeY"){
    distribute(entries, "y");
  }
  render();
  return true;
}
function distribute(entries, axis){
  const isX = axis === "x";
  entries.sort((a, b) => (isX ? a.r.x - b.r.x : a.r.y - b.r.y));
  const start = isX ? entries[0].r.x : entries[0].r.y;
  const endEntry = entries[entries.length - 1];
  const end = isX ? endEntry.r.x + endEntry.r.w : endEntry.r.y + endEntry.r.h;
  const total = entries.reduce((sum, e) => sum + (isX ? e.r.w : e.r.h), 0);
  const gap = entries.length > 1 ? (end - start - total) / (entries.length - 1) : 0;
  let cursor = start;
  for (const e of entries){
    if (isX) e.n.x = cursor; else e.n.y = cursor;
    cursor += (isX ? e.r.w : e.r.h) + gap;
  }
}
function conceptTreeRoot(){
  const selected = selectedNodes().find(n => n.type === "concept" || n.type === "todo");
  if (selected) return selected;
  const concepts = state.nodes.filter(n => n.type === "concept");
  if (!concepts.length) return null;
  return concepts.slice().sort((a, b) => {
    const ao = state.edges.filter(e => e.kind === "link" && e.from === a.id).length;
    const bo = state.edges.filter(e => e.kind === "link" && e.from === b.id).length;
    return bo - ao || a.y - b.y || a.x - b.x;
  })[0];
}
function conceptTreeScope(rootId){
  const conceptIds = new Set(state.nodes.filter(n => n.type === "concept" || n.type === "todo").map(n => n.id));
  const childMap = new Map();
  const visited = new Set();
  const bySource = new Map();
  for (const e of state.edges){
    if (e.kind !== "link" || !conceptIds.has(e.from) || !conceptIds.has(e.to)) continue;
    if (!bySource.has(e.from)) bySource.set(e.from, []);
    bySource.get(e.from).push(e.to);
  }
  for (const ids of bySource.values()){
    ids.sort((a, b) => {
      const na = nodeById(a), nb = nodeById(b);
      return (na ? na.y : 0) - (nb ? nb.y : 0) || (na ? na.x : 0) - (nb ? nb.x : 0);
    });
  }
  function visit(id){
    if (visited.has(id)) return;
    visited.add(id);
    const children = [];
    for (const childId of bySource.get(id) || []){
      if (visited.has(childId)) continue;
      children.push(childId);
      visit(childId);
    }
    childMap.set(id, children);
  }
  if (conceptIds.has(rootId)) visit(rootId);
  return { rootId, ids:[...visited], children:childMap };
}
function layoutMindMapTree(){
  const root = conceptTreeRoot();
  if (!root) return false;
  const scope = conceptTreeScope(root.id);
  if (!scope.ids.length) return false;
  const sizes = new Map(scope.ids.map(id => [id, nodeRect(nodeById(id))]));
  const maxW = Math.max(...scope.ids.map(id => sizes.get(id).w));
  const gapX = maxW + 90;
  const gapY = 24;
  const startX = root.x;
  const startY = root.y;
  function arrange(id, depth, top){
    const n = nodeById(id);
    const r = sizes.get(id);
    const kids = scope.children.get(id) || [];
    n.x = Math.round((startX + depth*gapX)/4)*4;
    if (!kids.length){
      n.y = Math.round(top/4)*4;
      return r.h;
    }
    let cursor = top;
    const centers = [];
    for (const childId of kids){
      const h = arrange(childId, depth + 1, cursor);
      centers.push(cursor + h/2);
      cursor += h + gapY;
    }
    const blockH = Math.max(r.h, cursor - top - gapY);
    const center = centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : top + r.h/2;
    n.y = Math.round((center - r.h/2)/4)*4;
    return blockH;
  }
  pushHistory();
  arrange(root.id, 0, startY);
  render();
  return true;
}
function relationEdgesForTables(tableIds){
  return state.edges.filter(e => e.kind !== "link" && tableIds.has(e.from) && tableIds.has(e.to));
}
function schemaDagEdges(tables){
  const tableIds = new Set(tables.map(n => n.id));
  const adjacency = new Map(tables.map(n => [n.id, []]));
  for (const e of relationEdgesForTables(tableIds)) adjacency.get(e.from).push(e);
  const color = new Map();
  const dag = [];
  function dfs(id){
    color.set(id, 1);
    for (const e of adjacency.get(id) || []){
      const c = color.get(e.to) || 0;
      if (c === 1) continue;
      dag.push(e);
      if (c === 0) dfs(e.to);
    }
    color.set(id, 2);
  }
  for (const n of tables) if (!color.has(n.id)) dfs(n.id);
  return dag;
}
function layoutSchemaTables(){
  const tables = state.nodes.filter(n => n.type === "table");
  if (!tables.length) return false;
  const dagEdges = schemaDagEdges(tables);
  const parents = new Map(tables.map(n => [n.id, []]));
  const children = new Map(tables.map(n => [n.id, []]));
  for (const e of dagEdges){
    parents.get(e.to).push(e.from);
    children.get(e.from).push(e.to);
  }
  const memo = new Map();
  function layerOf(id){
    if (memo.has(id)) return memo.get(id);
    const ps = parents.get(id) || [];
    const layer = ps.length ? Math.max(...ps.map(p => layerOf(p) + 1)) : 0;
    memo.set(id, layer);
    return layer;
  }
  const layers = [];
  for (const n of tables){
    const l = layerOf(n.id);
    if (!layers[l]) layers[l] = [];
    layers[l].push(n.id);
  }
  const orderIndex = ids => new Map(ids.map((id, i) => [id, i]));
  for (let sweep = 0; sweep < 2; sweep++){
    for (let i = 1; i < layers.length; i++){
      const prev = orderIndex(layers[i-1] || []);
      layers[i].sort((a, b) => {
        const av = (parents.get(a) || []).reduce((s, p) => s + (prev.get(p) ?? 0), 0) / Math.max(1, (parents.get(a) || []).length);
        const bv = (parents.get(b) || []).reduce((s, p) => s + (prev.get(p) ?? 0), 0) / Math.max(1, (parents.get(b) || []).length);
        return av - bv || nodeById(a).y - nodeById(b).y;
      });
    }
    for (let i = layers.length - 2; i >= 0; i--){
      const next = orderIndex(layers[i+1] || []);
      layers[i].sort((a, b) => {
        const av = (children.get(a) || []).reduce((s, c) => s + (next.get(c) ?? 0), 0) / Math.max(1, (children.get(a) || []).length);
        const bv = (children.get(b) || []).reduce((s, c) => s + (next.get(c) ?? 0), 0) / Math.max(1, (children.get(b) || []).length);
        return av - bv || nodeById(a).y - nodeById(b).y;
      });
    }
  }
  const startX = Math.min(...tables.map(n => n.x));
  const startY = Math.min(...tables.map(n => n.y));
  const layerWidths = layers.map(ids => Math.max(...ids.map(id => nodeRect(nodeById(id)).w)));
  const layerX = [];
  let cursorX = startX;
  for (let i = 0; i < layers.length; i++){
    layerX[i] = cursorX;
    cursorX += layerWidths[i] + 140;
  }
  pushHistory();
  for (let i = 0; i < layers.length; i++){
    let cursorY = startY;
    for (const id of layers[i]){
      const n = nodeById(id);
      const r = nodeRect(n);
      n.x = Math.round(layerX[i]/4)*4;
      n.y = Math.round(cursorY/4)*4;
      cursorY += r.h + 40;
    }
  }
  render();
  return true;
}
/* table-only: spawn a child table wired up with an FK field and a bound 1:N edge */
function addRelatedTable(parentId){
  const p = nodeById(parentId);
  if (!p || p.type !== "table") return;
  const r = nodeRect(p);
  pushHistory();
  const ppk = p.fields.find(f => f.pk);
  const fkName = ident(p.title).replace(/s$/, "") + "_id";
  const n = { id: uid(), type:"table", x: r.x + r.w + 120, y: r.y,
              title:uniqueTableTitle("new_table"), notes:"", color: p.color || "#16232F",
              fields:[{id: uid(), name:"id", type:"SERIAL", pk:true, fk:false, nullable:false}] };
  const fk = { id: uid(), name: fkName, type:"INT", pk:false, fk:true, nullable:false };
  n.fields.push(fk);
  state.nodes.push(n);
  const e = { id: uid(), from: p.id, to: n.id, kind:"1:N", label:"", toField: fk.id };
  if (ppk) e.fromField = ppk.id;
  e.pairs = [{ fromField:e.fromField || "", toField:e.toField || "" }];
  state.edges.push(e);
  setSelection("node", n.id);
  render();
  focusTitleInput();
}
/* z-order: nodes render in array order, so reordering controls overlap */
function reorderNode(id, toFront){
  const i = state.nodes.findIndex(n => n.id === id);
  if (i < 0) return;
  pushHistory();
  const [n] = state.nodes.splice(i, 1);
  if (toFront) state.nodes.push(n); else state.nodes.unshift(n);
  render();
}
function addChildConcept(){
  const p = firstSelectedNode();
  if (!p || p.type === "frame") return;
  const r = nodeRect(p);
  pushHistory();
  const siblings = state.edges.filter(e => e.from === p.id).length;
  const n = { id: uid(), type:"concept", x: r.x + r.w + 90,
              y: r.y + siblings*64 - 20, title:"New idea", notes:"",
              color: p.type === "concept" ? p.color : CONCEPT_COLORS[0] };
  state.nodes.push(n);
  state.edges.push({ id: uid(), from: p.id, to: n.id, kind:"link", label:"" });
  setSelection("node", n.id);
  render();
  focusTitleInput();
}

/* --------------------------- Pointer ------------------------------ */
let drag = null; // {mode:'pan'|'node'|'connect', ...}
const activePointers = new Map();
let touchGesture = null;
let longPress = null;

function dist(a, b){ return Math.hypot(b.x - a.x, b.y - a.y); }
function mid(a, b){ return { x:(a.x + b.x)/2, y:(a.y + b.y)/2 }; }
function pinchTransform(p1a, p2a, p1b, p2b, startView){
  const m0 = mid(p1a, p2a), m1 = mid(p1b, p2b);
  const d0 = Math.max(1, dist(p1a, p2a));
  const d1 = Math.max(1, dist(p1b, p2b));
  const k = Math.min(3, Math.max(0.2, startView.k * (d1 / d0)));
  const wx = (m0.x - startView.x) / startView.k;
  const wy = (m0.y - startView.y) / startView.k;
  return { x:m1.x - wx*k, y:m1.y - wy*k, k };
}
function clearLongPress(){
  if (longPress && longPress.timer) clearTimeout(longPress.timer);
  longPress = null;
}
function startLongPress(ev){
  clearLongPress();
  const start = { x:ev.clientX, y:ev.clientY };
  const nodeEl = ev.target.closest("[data-node]");
  const edgeEl = ev.target.closest("[data-edge]");
  const worldPoint = clientToWorld(ev.clientX, ev.clientY);
  longPress = { start, timer:setTimeout(() => {
    longPress = null;
    drag = null;
    if (nodeEl){
      const n = nodeById(nodeEl.getAttribute("data-node"));
      if (n){ setSelection("node", n.id); render(); nodeMenu(n, start.x, start.y); }
    } else if (edgeEl){
      const e = edgeById(edgeEl.getAttribute("data-edge"));
      if (e){ setSelection("edge", e.id); render(); edgeMenu(e, start.x, start.y); }
    } else {
      canvasMenu(worldPoint, start.x, start.y);
    }
  }, 500) };
}

let lastPress = null; // {t, x, y} of the previous plain pointerdown, for double-press detection

/* endpoint grips on the selected edge: drag one to move that end to another
   attachment point, row, or node. Drawn in draftLayer so they sit above the
   node layer's own anchor handles. */
function drawEdgeGrips(){
  const e = singleSelectedEdge();
  if (!e) return;
  const ep = edgeEndpoints(e);
  if (!ep) return;
  const t = themeColors();
  for (const [end, p] of [["from", ep.pa], ["to", ep.pb]]){
    const gg = el("g", {"data-edgegrip": e.id, "data-gripend": end, cursor:"move"}, draftLayer);
    el("circle", {cx:p.x, cy:p.y, r:12, fill:"transparent"}, gg);
    el("circle", {cx:p.x, cy:p.y, r:5, fill:t.panel, stroke:t.accent, "stroke-width":2}, gg);
  }
}
/* hitTest, but tolerant of drops just outside a node's rect — attachment points
   sit on the boundary, so precise drops often land a pixel or two outside */
function looseHit(w, tol = 16){
  const hit = hitTest(w);
  if (hit) return hit;
  for (let i = state.nodes.length - 1; i >= 0; i--){
    const n = state.nodes[i];
    if (n.type === "frame") continue;
    const r = nodeRect(n);
    if (w.x >= r.x - tol && w.x <= r.x + r.w + tol && w.y >= r.y - tol && w.y <= r.y + r.h + tol)
      return { node: n, field: null };
  }
  return null;
}
/* shared drop-target preview for connect and reattach drags */
function drawDropPreview(hit, w){
  const r = nodeRect(hit.node);
  if (hit.field){
    const idx = (nodeRows(hit.node) || []).indexOf(hit.field);
    const mm = tableMetrics(hit.node);
    el("rect", {x:r.x+2, y:r.y + mm.headerH + idx*mm.rowH + 1, width:r.w-4, height:mm.rowH-2, rx:4,
                fill:"#2456E6", opacity:.16}, draftLayer);
  } else {
    el("rect", {x:r.x-3, y:r.y-3, width:r.w+6, height:r.h+6, rx:10, fill:"none",
                stroke:"#2456E6", "stroke-width":1.5, "stroke-dasharray":"4 3"}, draftLayer);
    const na = nearestAnchorWithin(hit.node, w);
    if (na) el("circle", {cx:na.x, cy:na.y, r:5, fill:"#2456E6"}, draftLayer);
  }
}
/* move one end of an existing edge to a new attachment point / row / node */
function reattachEdgeEnd(e, end, hit, w){
  const isFrom = end === "from";
  const n = hit.node;
  const newFrom = isFrom ? n.id : e.from;
  const newTo = isFrom ? e.to : n.id;
  if (newFrom === newTo || n.type === "frame"){ render(); return; }
  const newFromField = isFrom ? (hit.field ? hit.field.id : "") : (e.fromField || "");
  const newToField = !isFrom ? (hit.field ? hit.field.id : "") : (e.toField || "");
  const dup = state.edges.some(o => {
    if (o === e) return false;
    const of = o.from + ":" + (o.fromField || ""), ot = o.to + ":" + (o.toField || "");
    const nf = newFrom + ":" + newFromField, nt = newTo + ":" + newToField;
    return (of === nf && ot === nt) || (of === nt && ot === nf);
  });
  if (dup){ render(); return; }
  const na = !hit.field ? nearestAnchorWithin(n, w) : null;
  pushHistory();
  if (isFrom) e.from = n.id; else e.to = n.id;
  const fieldKey = isFrom ? "fromField" : "toField";
  const anchorKey = isFrom ? "fromAnchor" : "toAnchor";
  if (hit.field){
    e[fieldKey] = hit.field.id;
    delete e[anchorKey];
  } else {
    delete e[fieldKey];
    if (na) e[anchorKey] = na.key; else delete e[anchorKey];
  }
  /* composite pairs cannot survive an endpoint move — collapse to the simple binding */
  if (Array.isArray(e.pairs)){
    if (e.kind !== "link" && (e.fromField || e.toField))
      e.pairs = [{ fromField:e.fromField || "", toField:e.toField || "" }];
    else delete e.pairs;
  }
  const a = nodeById(e.from), b = nodeById(e.to);
  if ((a && a.type === "todo") || (b && b.type === "todo")) e.kind = "link";
  setSelection("edge", e.id);
  render();
}

/* grid snapping (issue #40): drags always snap — to the visible dot grid when the
   toggle is on, else to the fine 4px grid */
function dragSnap(v){
  const step = snapToGrid ? GRID_SNAP : 4;
  return Math.round(v/step)*step;
}
function updateSnapControl(){
  const b = document.getElementById("btnSnap");
  if (b) b.classList.toggle("primary", snapToGrid);
}
function toggleSnapToGrid(){
  snapToGrid = !snapToGrid;
  updateSnapControl();
}
/* "Clean Up": snap every node to the dot grid without dragging */
function cleanUpToGrid(){
  if (!state.nodes.length) return;
  pushHistory();
  for (const n of state.nodes){
    n.x = Math.round(n.x/GRID_SNAP)*GRID_SNAP;
    n.y = Math.round(n.y/GRID_SNAP)*GRID_SNAP;
  }
  render();
}

board.addEventListener("pointerdown", ev => {
  if (ev.button === 2) return;
  ev.preventDefault();                       // stop native text-selection drags
  closeInlineEditor(false);
  if (window.getSelection) window.getSelection().removeAllRanges();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const todoCheckEl = ev.target.closest("[data-todocheck]");
  const fieldHandleEl = ev.target.closest("[data-fieldhandle]");
  const handleEl = ev.target.closest("[data-handle]");
  const collapseEl = ev.target.closest("[data-collapse]");
  const resizeEl = ev.target.closest("[data-frame-resize]");
  const nodeEl   = ev.target.closest("[data-node]");
  const edgeEl   = ev.target.closest("[data-edge]");
  if (board.setPointerCapture) board.setPointerCapture(ev.pointerId);
  if (ev.pointerType === "touch"){
    activePointers.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });
    startLongPress(ev);
    if (activePointers.size === 2){
      const pts = [...activePointers.values()];
      touchGesture = { start:[pts[0], pts[1]], view:{...view} };
      clearLongPress();
      drag = null;
      board.classList.remove("panning","connecting");
      return;
    }
  }

  if (todoCheckEl){
    const n = nodeById(todoCheckEl.getAttribute("data-todonode"));
    const it = n && n.items && n.items.find(i => i.id === todoCheckEl.getAttribute("data-todocheck"));
    if (n && it){
      pushHistory();
      if (it.done) delete it.done; else it.done = true;  // absent means false — never write done:false
      setSelection("node", n.id);
      render();
    }
    drag = null;
    return;
  }
  if (fieldHandleEl){
    drag = { mode:"connect", from: { id: fieldHandleEl.getAttribute("data-fieldnode"),
                                     fieldId: fieldHandleEl.getAttribute("data-fieldhandle") } };
    board.classList.add("connecting");
    return;
  }
  if (handleEl){
    drag = { mode:"connect", from: { id: handleEl.getAttribute("data-handle"),
                                     anchor: handleEl.getAttribute("data-anchor") || undefined } };
    board.classList.add("connecting");
    return;
  }
  if (collapseEl){
    const id = collapseEl.getAttribute("data-collapse");
    const n = nodeById(id);
    if (n && (n.type === "table" || n.type === "todo")){
      pushHistory();
      n.collapsed = !n.collapsed;
      setSelection("node", id);
      render();
    }
    return;
  }
  if (resizeEl){
    const id = resizeEl.getAttribute("data-frame-resize");
    const n = nodeById(id);
    if (!n || n.type !== "frame") return;
    const w = clientToWorld(ev.clientX, ev.clientY);
    setSelection("node", id);
    drag = { mode:"frame-resize", id, start:w, w:n.w || FRAME_DEFAULT.w, h:n.h || FRAME_DEFAULT.h, moved:false };
    render();
    return;
  }

  /* space+drag pans regardless of what's under the cursor (issue #41) */
  if (spaceHeld){
    lastPress = null;
    drag = { mode:"pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved:true };
    board.classList.add("panning");
    return;
  }

  /* drag a selected edge's endpoint grip to move that end to another point */
  const gripEl = ev.target.closest("[data-edgegrip]");
  if (gripEl){
    lastPress = null;
    drag = { mode:"reattach", edgeId: gripEl.getAttribute("data-edgegrip"),
             end: gripEl.getAttribute("data-gripend") };
    board.classList.add("connecting");
    return;
  }

  /* double-press detection (E9): we cannot trust native dblclick because the first
     press re-renders and replaces the SVG elements under the cursor, which makes the
     browser retarget or drop the dblclick event entirely. */
  const plainPress = !ev.shiftKey && !ev.altKey && ev.button !== 1;
  const now = Date.now();
  const doublePress = plainPress && lastPress && now - lastPress.t < 400 &&
    Math.hypot(ev.clientX - lastPress.x, ev.clientY - lastPress.y) < 6;
  lastPress = plainPress && !doublePress ? { t: now, x: ev.clientX, y: ev.clientY } : null;
  if (doublePress){
    drag = null;
    board.classList.remove("panning","connecting");
    if (nodeEl){
      const id = nodeEl.getAttribute("data-node");
      setSelection("node", id);
      render();
      /* a row under the cursor edits that field name / item text; anywhere else edits the title */
      const hit = hitTest(clientToWorld(ev.clientX, ev.clientY));
      if (hit && hit.node.id === id && hit.field) startInlineEditor("row", id, hit.field.id);
      else startInlineEditor("node", id);
    } else if (edgeEl){
      const id = edgeEl.getAttribute("data-edge");
      setSelection("edge", id);
      render();
      startInlineEditor("edge", id);
    } else {
      const w = clientToWorld(ev.clientX, ev.clientY);
      addNode("concept", w.x - 65, w.y - 24);
    }
    return;
  }

  if (nodeEl){
    const id = nodeEl.getAttribute("data-node");
    const n = nodeById(id);
    const w = clientToWorld(ev.clientX, ev.clientY);
    if (ev.shiftKey){
      toggleNodeSelection(id);
      drag = null;
      render();
      return;
    }
    if (!isSelected("node", id)) setSelection("node", id);
    const moveIds = new Set(selectionIds("node"));
    if (n && n.type === "frame") for (const child of frameContainedNodes(n)) moveIds.add(child.id);
    const ids = [...moveIds];
    drag = { mode:"node", id, start:w, starts: ids.map(nodeId => {
      const dn = nodeById(nodeId);
      return { id:nodeId, x:dn.x, y:dn.y };
    }).filter(Boolean), moved:false };
    render();
    return;
  }
  if (edgeEl){
    setSelection("edge", edgeEl.getAttribute("data-edge"));
    drag = null;
    render();
    return;
  }
  // empty canvas: drag marquee; Alt/middle-drag pans.
  if (ev.altKey || ev.button === 1){
    drag = { mode:"pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved:false };
    board.classList.add("panning");
  } else {
    const w = clientToWorld(ev.clientX, ev.clientY);
    drag = { mode:"marquee", sx: ev.clientX, sy: ev.clientY, start:w, current:w, moved:false };
  }
});

board.addEventListener("pointermove", ev => {
  if (ev.pointerType === "touch" && activePointers.has(ev.pointerId)){
    const prev = activePointers.get(ev.pointerId);
    activePointers.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });
    if (longPress && dist(longPress.start, {x:ev.clientX, y:ev.clientY}) > 8) clearLongPress();
    if (touchGesture && activePointers.size >= 2){
      const pts = [...activePointers.values()];
      view = pinchTransform(touchGesture.start[0], touchGesture.start[1], pts[0], pts[1], touchGesture.view);
      applyView();
      return;
    }
    if (prev && dist(prev, {x:ev.clientX, y:ev.clientY}) > 0 && longPress && dist(longPress.start, {x:ev.clientX, y:ev.clientY}) > 8) clearLongPress();
  }
  if (!drag) return;
  if (drag.mode === "pan"){
    view.x = drag.vx + (ev.clientX - drag.sx);
    view.y = drag.vy + (ev.clientY - drag.sy);
    if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
    applyView();
  } else if (drag.mode === "node"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    if (!drag.moved){ pushHistory(); drag.moved = true; }
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    for (const start of drag.starts){
      const n = nodeById(start.id);
      if (!n) continue;
      n.x = dragSnap(start.x + dx);
      n.y = dragSnap(start.y + dy);
    }
    if (state.nodes.length > 150) fastDragRender(drag.starts.map(s => s.id));
    else render();
  } else if (drag.mode === "frame-resize"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    const n = nodeById(drag.id);
    if (!n) return;
    if (!drag.moved){ pushHistory(); drag.moved = true; }
    n.w = Math.round(Math.max(120, drag.w + (w.x - drag.start.x)) / 4) * 4;
    n.h = Math.round(Math.max(90, drag.h + (w.y - drag.start.y)) / 4) * 4;
    render();
  } else if (drag.mode === "marquee"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    drag.current = w;
    if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
    draftLayer.innerHTML = "";
    const r = rectFromPoints(drag.start, drag.current);
    el("rect", {x:r.x, y:r.y, width:r.w, height:r.h, fill:"#2456E6", opacity:.10,
                stroke:"#2456E6", "stroke-width":1.3, "stroke-dasharray":"5 4"}, draftLayer);
  } else if (drag.mode === "connect"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    draftLayer.innerHTML = "";
    const a = nodeById(drag.from.id), ra = nodeRect(a);
    let pa;
    if (drag.from.fieldId){
      const rowsA = nodeRows(a) || [];
      const idx = rowsA.findIndex(f => f.id === drag.from.fieldId);
      pa = idx >= 0 ? fieldAnchor(a, idx, w.x) : nodeAnchor(a, null, w);
    } else {
      pa = nodeAnchor(a, drag.from.anchor, w);
    }
    el("path", {d:`M ${pa.x} ${pa.y} L ${w.x} ${w.y}`, stroke:"#2456E6",
                "stroke-width":1.8, "stroke-dasharray":"4 4", fill:"none"}, draftLayer);
    el("circle", {cx:w.x, cy:w.y, r:4, fill:"#2456E6"}, draftLayer);
    const hit = looseHit(w);
    if (hit && hit.node.id !== drag.from.id) drawDropPreview(hit, w);
  } else if (drag.mode === "reattach"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    draftLayer.innerHTML = "";
    const e = edgeById(drag.edgeId);
    const ep = e && edgeEndpoints(e);
    if (!ep) return;
    const fixed = drag.end === "from" ? ep.pb : ep.pa;
    el("path", {d:`M ${fixed.x} ${fixed.y} L ${w.x} ${w.y}`, stroke:"#2456E6",
                "stroke-width":1.8, "stroke-dasharray":"4 4", fill:"none"}, draftLayer);
    el("circle", {cx:w.x, cy:w.y, r:4, fill:"#2456E6"}, draftLayer);
    const otherId = drag.end === "from" ? e.to : e.from;
    const hit = looseHit(w);
    if (hit && hit.node.id !== otherId) drawDropPreview(hit, w);
  }
});

board.addEventListener("pointerup", ev => {
  if (ev.pointerType === "touch"){
    activePointers.delete(ev.pointerId);
    clearLongPress();
    if (activePointers.size < 2) touchGesture = null;
  }
  if (!drag) return;
  if (drag.mode === "pan" && !drag.moved){
    clearSelection(); render();
  } else if (drag.mode === "node"){
    if (drag.moved && state.nodes.length > 150) render();
  } else if (drag.mode === "marquee"){
    draftLayer.innerHTML = "";
    if (drag.moved){
      const r = rectFromPoints(drag.start, drag.current);
      const ids = state.nodes.filter(n => rectsIntersect(r, nodeRect(n))).map(n => n.id);
      setSelection("node", ids);
    } else {
      clearSelection();
    }
    render();
  } else if (drag.mode === "connect"){
    draftLayer.innerHTML = "";
    const w = clientToWorld(ev.clientX, ev.clientY);
    const hit = looseHit(w);
    if (hit){
      const na = !hit.field ? nearestAnchorWithin(hit.node, w) : null;
      addEdge(drag.from, { id: hit.node.id, fieldId: hit.field ? hit.field.id : undefined,
                           anchor: na ? na.key : undefined });
    } else {
      render();   // restore any cleared grips
    }
  } else if (drag.mode === "reattach"){
    draftLayer.innerHTML = "";
    const w = clientToWorld(ev.clientX, ev.clientY);
    const e = edgeById(drag.edgeId);
    const hit = looseHit(w);
    if (e && hit) reattachEdgeEnd(e, drag.end, hit, w);
    else render();   // dropped on empty canvas: no change, redraw grips
  }
  board.classList.remove("panning","connecting");
  drag = null;
});
board.addEventListener("pointercancel", ev => {
  activePointers.delete(ev.pointerId);
  clearLongPress();
  if (activePointers.size < 2) touchGesture = null;
  drag = null;
  board.classList.remove("panning","connecting");
});

board.addEventListener("wheel", ev => {
  ev.preventDefault();
  closeInlineEditor(false);
  const factor = ev.deltaY < 0 ? 1.1 : 1/1.1;
  const nk = Math.min(3, Math.max(0.2, view.k * factor));
  const b = board.getBoundingClientRect();
  const mx = ev.clientX - b.left, my = ev.clientY - b.top;
  view.x = mx - (mx - view.x) * (nk/view.k);
  view.y = my - (my - view.y) * (nk/view.k);
  view.k = nk;
  applyView();
}, { passive:false });

/* -------------------------- Keyboard ------------------------------ */
function matchShortcut(ev, typing){
  if (typing) return null;
  const key = ev.key.toLowerCase();
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.shiftKey && key === "s") return "saveAs";
  if (mod && ev.shiftKey && key === "z") return "redo";
  if (mod && key === "o") return "open";
  if (mod && key === "s") return "save";
  if (mod && key === "z") return "undo";
  if (mod && key === "y") return "redoAlt";
  if (mod && key === "c") return "copy";
  if (mod && key === "x") return "cut";
  if (mod && key === "v") return "paste";
  if (mod && key === "d") return "duplicate";
  if (mod && key === "k") return "palette";
  if (ev.key === "?") return "help";
  if (ev.key === "Delete" || ev.key === "Backspace") return "delete";
  if (ev.key === "Tab") return "child";
  if (ev.key === "Escape") return "escape";
  if (!mod && key === "c") return "concept";
  if (!mod && key === "t") return "table";
  if (!mod && key === "d") return "todo";
  if (!mod && key === "f") return "fit";
  if (ev.key.startsWith("Arrow")) return "nudge";
  return null;
}
function runShortcut(id, ev){
  if (id === "open") return openDoc();
  if (id === "save") return saveDoc();
  if (id === "saveAs") return saveAsDoc();
  if (id === "undo") return undo();
  if (id === "redo" || id === "redoAlt") return redo();
  if (id === "copy") return copySelection(false);
  if (id === "cut") return copySelection(true);
  if (id === "paste") return pasteSelection();
  if (id === "duplicate") return duplicateSelection();
  if (id === "palette") return openCommandPalette();
  if (id === "help") return openShortcutModal();
  if (id === "delete") return deleteSelection();
  if (id === "child") return addChildConcept();
  if (id === "escape"){ closeInlineEditor(false); closeCommandPalette(); closeShortcutModal(); hideCtx(); clearSelection(); render(); return; }
  if (id === "concept"){ const c = viewCenter(); addNode("concept", c.x-65, c.y-24); return; }
  if (id === "table"){ const c = viewCenter(); addNode("table", c.x-95, c.y-40); return; }
  if (id === "todo"){ const c = viewCenter(); addNode("todo", c.x-90, c.y-30); return; }
  if (id === "fit") return fitView();
  if (id === "nudge" && ev) return nudgeSelection(ev.key, ev.shiftKey ? 24 : 4);
}
function cycleNodeSelection(reverse = false){
  const nodes = state.nodes.filter(n => n.type !== "frame");
  if (!nodes.length) return;
  const current = firstSelectionId("node");
  let idx = nodes.findIndex(n => n.id === current);
  idx = idx < 0 ? (reverse ? nodes.length - 1 : 0) : (idx + (reverse ? -1 : 1) + nodes.length) % nodes.length;
  setSelection("node", nodes[idx].id);
  centerNode(nodes[idx].id);
  render();
}
function nudgeSelection(key, step){
  const nodes = selectedNodes();
  if (!nodes.length) return;
  pushHistory();
  for (const n of nodes){
    if (key === "ArrowLeft") n.x -= step;
    if (key === "ArrowRight") n.x += step;
    if (key === "ArrowUp") n.y -= step;
    if (key === "ArrowDown") n.y += step;
  }
  render();
}
window.addEventListener("keydown", ev => {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (!typing && ev.key === " "){
    ev.preventDefault();          // keep the page from scrolling while space-panning
    spaceHeld = true;
    return;
  }
  if (!typing && document.activeElement === board && ev.key === "Tab"){
    ev.preventDefault();
    cycleNodeSelection(ev.shiftKey);
    return;
  }
  if (!typing && document.activeElement === board && ev.key === "Enter"){
    ev.preventDefault();
    const node = singleSelectedNode();
    if (node) startInlineEditor("node", node.id);
    return;
  }
  const shortcut = matchShortcut(ev, typing);
  if (shortcut){
    ev.preventDefault();
    runShortcut(shortcut, ev);
    return;
  }
});
window.addEventListener("keyup", ev => { if (ev.key === " ") spaceHeld = false; });
window.addEventListener("blur", () => { spaceHeld = false; });
function viewCenter(){
  const b = board.getBoundingClientRect();
  return clientToWorld(b.left + b.width/2, b.top + b.height/2);
}
function fitView(){
  if (!state.nodes.length) return;
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for (const n of state.nodes){
    const r = nodeRect(n);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const b = board.getBoundingClientRect(), pad = 60;
  const k = Math.min(2, Math.min((b.width - pad*2)/(x1-x0), (b.height - pad*2)/(y1-y0)));
  view.k = Math.max(0.2, k);
  view.x = (b.width  - (x1-x0)*view.k)/2 - x0*view.k;
  view.y = (b.height - (y1-y0)*view.k)/2 - y0*view.k;
  applyView();
}

function worldToWrap(x, y){
  const br = board.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  return { x: br.left - wr.left + view.x + x*view.k, y: br.top - wr.top + view.y + y*view.k };
}
function inlineEditorBox(kind, id, rowId){
  if (kind === "row"){
    const n = nodeById(id);
    const rows = n && !n.collapsed ? nodeRows(n) : null;
    const idx = rows ? rows.findIndex(row => row.id === rowId) : -1;
    if (idx < 0) return null;
    const m = tableMetrics(n);
    const r = nodeRect(n);
    const p = worldToWrap(r.x + m.nameX - 4, r.y + m.headerH + idx*m.rowH + 1);
    return { x:p.x, y:p.y, w:Math.max(100, (r.w - m.nameX - 8)*view.k),
             h:Math.max(20, (m.rowH - 2)*view.k), fontSize:Math.max(11, m.nameSize*view.k) };
  }
  if (kind === "node"){
    const n = nodeById(id);
    if (!n) return null;
    const r = nodeRect(n);
    if (n.type === "frame"){
      const p = worldToWrap(r.x + 12, r.y + 7);
      return { x:p.x, y:p.y, w:Math.max(120, r.w*view.k - 24), h:28, fontSize:13 };
    }
    if (n.type === "concept"){
      const p = worldToWrap(r.x + 12, r.y + Math.max(4, r.h/2 - 16));
      return { x:p.x, y:p.y, w:Math.max(120, r.w*view.k - 24), h:32, fontSize:Math.max(12, conceptFont(n)*view.k) };
    }
    const p = worldToWrap(r.x + 8, r.y + 4);
    return { x:p.x, y:p.y, w:Math.max(140, r.w*view.k - 16), h:Math.max(28, tableMetrics(n).headerH*view.k - 8),
             fontSize:Math.max(12, tableMetrics(n).headerSize*view.k) };
  }
  const e = edgeById(id), ep = e && edgeEndpoints(e);
  if (!e || !ep) return null;
  const p = worldToWrap((ep.pa.x + ep.pb.x)/2 - 70, (ep.pa.y + ep.pb.y)/2 - 16);
  return { x:p.x, y:p.y, w:140, h:30, fontSize:13 };
}
function inlineEditorRow(id, rowId){
  const n = nodeById(id);
  const rows = n ? nodeRows(n) : null;
  return rows ? rows.find(row => row.id === rowId) || null : null;
}
function startInlineEditor(kind, id, rowId){
  closeInlineEditor(false);
  const box = inlineEditorBox(kind, id, rowId);
  if (!box) return;
  const target = kind === "row" ? inlineEditorRow(id, rowId)
               : kind === "node" ? nodeById(id) : edgeById(id);
  if (!target) return;
  const original = kind === "row" ? (target.name ?? target.text ?? "")
                 : kind === "node" ? target.title || "" : target.label || "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-editor";
  input.value = original;
  input.style.left = box.x + "px";
  input.style.top = box.y + "px";
  input.style.width = box.w + "px";
  input.style.height = box.h + "px";
  input.style.fontSize = box.fontSize + "px";
  input.addEventListener("pointerdown", ev => ev.stopPropagation());
  input.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); closeInlineEditor(true); }
    if (ev.key === "Escape"){ ev.preventDefault(); closeInlineEditor(false); }
  });
  input.addEventListener("blur", () => closeInlineEditor(true));
  wrap.appendChild(input);
  inlineEditor = { kind, id, rowId, input, original, closing:false };
  input.focus();
  input.select();
}
function closeInlineEditor(commit){
  if (!inlineEditor || inlineEditor.closing) return;
  const editor = inlineEditor;
  editor.closing = true;
  inlineEditor = null;
  const value = editor.input.value;
  if (editor.input.parentNode) editor.input.parentNode.removeChild(editor.input);
  if (commit && value !== editor.original){
    const target = editor.kind === "row" ? inlineEditorRow(editor.id, editor.rowId)
                 : editor.kind === "node" ? nodeById(editor.id) : edgeById(editor.id);
    if (target){
      if (editor.kind === "node" && target.type === "table" && tableNameConflict(target, value)){
        showNoticeModal("Duplicate table name",
          `A table named "${ident(value)}" already exists. Table names must be unique.`);
        return;
      }
      pushHistory();
      if (editor.kind === "row"){
        const n = nodeById(editor.id);
        if (n && n.type === "table") target.name = value;
        else target.text = value;
      }
      else if (editor.kind === "node") target.title = value;
      else target.label = value;
      render();
    }
  }
}

let noticeModal = null;
function closeNoticeModal(){
  if (noticeModal && noticeModal.parentNode) noticeModal.parentNode.removeChild(noticeModal);
  noticeModal = null;
}
function showNoticeModal(title, message){
  closeNoticeModal();
  const modal = document.createElement("div");
  modal.className = "modal open notice-modal";
  modal.innerHTML = `<div class="card"><h3></h3><p class="helper"></p><div class="actions"><button class="primary" id="btnCloseNotice">OK</button></div></div>`;
  modal.querySelector("h3").textContent = title;
  modal.querySelector("p").textContent = message;
  modal.addEventListener("click", ev => { if (ev.target === modal) closeNoticeModal(); });
  document.body.appendChild(modal);
  noticeModal = modal;
  modal.querySelector("#btnCloseNotice").addEventListener("click", closeNoticeModal);
}

let paletteModal = null;
let shortcutModal = null;

function fuzzyMatch(text, query){
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length;
}
function paletteItems(){
  const items = [];
  for (const n of state.nodes){
    items.push({ type:"node", label:n.title || "(untitled)", nodeId:n.id });
    if (n.type === "table"){
      for (const f of n.fields)
        items.push({ type:"field", label:`${n.title || "table"}.${f.name}`, nodeId:n.id, fieldId:f.id });
    }
    if (n.type === "todo"){
      for (const it of n.items)
        items.push({ type:"item", label:`${n.title || "list"}.${it.text || "(item)"}`, nodeId:n.id, itemId:it.id });
    }
  }
  for (const c of [
    ["addConcept", "Add concept"],
    ["addTable", "Add table"],
    ["addTodo", "Add to-do list"],
    ["addFrame", "Add frame"],
    ["layoutTree", "Layout concept tree"],
    ["layoutSchema", "Layout table schema"],
    ["exportSQL", "Export SQL"],
    ["fit", "Fit diagram"],
    ["open", "Open"],
    ["save", "Save"]
  ]) items.push({ type:"command", command:c[0], label:c[1] });
  return items;
}
function paletteMatches(query, items){
  const raw = query.trim();
  const commandOnly = raw.startsWith(">");
  const q = commandOnly ? raw.slice(1).trim() : raw;
  return items.filter(item => (!commandOnly ? item.type !== "command" : item.type === "command") &&
    fuzzyMatch(item.label, q));
}
function centerNode(id){
  const n = nodeById(id);
  if (!n) return;
  const r = nodeRect(n), b = board.getBoundingClientRect();
  view.x = b.width/2 - r.cx*view.k;
  view.y = b.height/2 - r.cy*view.k;
  applyView();
}
function activatePaletteItem(item){
  if (!item) return;
  closeCommandPalette();
  if (item.type === "node" || item.type === "field" || item.type === "item"){
    setSelection("node", item.nodeId);
    centerNode(item.nodeId);
    render();
    return;
  }
  const c = viewCenter();
  if (item.command === "addConcept") addNode("concept", c.x-65, c.y-24);
  if (item.command === "addTable") addNode("table", c.x-95, c.y-40);
  if (item.command === "addTodo") addNode("todo", c.x-90, c.y-30);
  if (item.command === "addFrame") addNode("frame", c.x-FRAME_DEFAULT.w/2, c.y-FRAME_DEFAULT.h/2);
  if (item.command === "layoutTree") layoutMindMapTree();
  if (item.command === "layoutSchema") layoutSchemaTables();
  if (item.command === "exportSQL") document.getElementById("btnExportSQL").click();
  if (item.command === "fit") fitView();
  if (item.command === "open") openDoc();
  if (item.command === "save") saveDoc();
}
function openCommandPalette(){
  closeCommandPalette();
  const modal = document.createElement("div");
  modal.className = "modal open command-modal";
  modal.innerHTML = `<div class="card"><h3>Command palette</h3><div class="palette-body"></div></div>`;
  const body = modal.querySelector(".palette-body");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search nodes and fields, or type > for commands";
  input.className = "palette-input";
  const list = document.createElement("div");
  list.className = "palette-list";
  body.append(input, list);
  let selected = 0, matches = [];
  const renderList = () => {
    matches = paletteMatches(input.value, paletteItems()).slice(0, 20);
    selected = Math.min(selected, Math.max(0, matches.length - 1));
    list.innerHTML = "";
    matches.forEach((item, idx) => {
      const b = document.createElement("button");
      b.className = "palette-item" + (idx === selected ? " on" : "");
      b.innerHTML = `<span>${escapeHtml(item.label)}</span><small>${item.type}</small>`;
      b.addEventListener("mousedown", ev => ev.preventDefault());
      b.addEventListener("click", () => activatePaletteItem(item));
      list.appendChild(b);
    });
  };
  input.addEventListener("input", renderList);
  input.addEventListener("keydown", ev => {
    if (ev.key === "Escape"){ ev.preventDefault(); closeCommandPalette(); }
    if (ev.key === "ArrowDown"){ ev.preventDefault(); selected = Math.min(matches.length - 1, selected + 1); renderList(); }
    if (ev.key === "ArrowUp"){ ev.preventDefault(); selected = Math.max(0, selected - 1); renderList(); }
    if (ev.key === "Enter"){ ev.preventDefault(); activatePaletteItem(matches[selected]); }
  });
  modal.addEventListener("click", ev => { if (ev.target === modal) closeCommandPalette(); });
  document.body.appendChild(modal);
  paletteModal = modal;
  renderList();
  input.focus();
}
function closeCommandPalette(){
  if (paletteModal && paletteModal.parentNode) paletteModal.parentNode.removeChild(paletteModal);
  paletteModal = null;
}
function openShortcutModal(){
  closeShortcutModal();
  const modal = document.createElement("div");
  modal.className = "modal open shortcut-modal";
  const rows = SHORTCUTS.map(s =>
    `<div class="shortcut-row"><kbd>${escapeHtml(s.keys)}</kbd><span>${escapeHtml(s.title)}</span></div>`).join("");
  modal.innerHTML = `<div class="card"><h3>Shortcuts</h3><div class="shortcut-list">${rows}</div><div class="actions"><button class="primary" id="btnCloseShortcuts">Close</button></div></div>`;
  modal.addEventListener("click", ev => { if (ev.target === modal) closeShortcutModal(); });
  document.body.appendChild(modal);
  shortcutModal = modal;
  modal.querySelector("#btnCloseShortcuts").addEventListener("click", closeShortcutModal);
}
function closeShortcutModal(){
  if (shortcutModal && shortcutModal.parentNode) shortcutModal.parentNode.removeChild(shortcutModal);
  shortcutModal = null;
}

/* -------------------------- Inspector ----------------------------- */
const inspBody = document.getElementById("inspBody");
const inspTitle = document.getElementById("inspTitle");

function focusTitleInput(){
  requestAnimationFrame(() => {
    const i = document.getElementById("titleInput");
    if (i){ i.focus(); i.select(); }
  });
}

function renderInspector(){
  inspBody.innerHTML = "";
  if (!sel){ inspTitle.textContent = "Inspector"; renderHelp(); return; }

  if (sel.kind === "node"){
    if (selectionCount("node") > 1){ renderMultiInspector(); return; }
    const n = singleSelectedNode();
    if (!n){ clearSelection(); renderHelp(); return; }
    inspTitle.textContent = n.type === "concept" ? "Concept node" : n.type === "frame" ? "Frame"
                          : n.type === "todo" ? "To-do list" : "Table node";

    frow(n.type === "table" ? "Table name" : "Title", () => {
      const i = mkInput(n.title, v => { n.title = v; drawOnly(); });
      i.id = "titleInput";
      if (n.type === "table"){
        /* duplicate names are rejected on commit (issue #46); live typing may pass
           through a conflicting prefix without nagging */
        let prev = n.title;
        i.addEventListener("focus", () => { prev = n.title; });
        i.addEventListener("blur", () => {
          if (tableNameConflict(n, n.title)){
            showNoticeModal("Duplicate table name",
              `A table named "${ident(n.title)}" already exists. Table names must be unique.`);
            n.title = prev;
            i.value = prev;
            drawOnly();
          }
        });
      }
      return i;
    });

    if (n.type === "frame"){
      frow("Color", () => swatches(TABLE_COLORS, n.color || FRAME_DEFAULT.color,
        (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      frow("Width", () => sizeStepper(n.w || FRAME_DEFAULT.w, 120, 4000, 20,
        (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
      frow("Height", () => sizeStepper(n.h || FRAME_DEFAULT.h, 90, 4000, 20,
        (v, commit) => { pushHistory("size:"+n.id); n.h = v; commit ? render() : drawOnly(); }));
    } else if (n.type === "concept"){
      frow("Shape", () => {
        const s = document.createElement("select");
        s.setAttribute("aria-label", "Flowchart shape");
        for (const [value, label] of FLOWCHART_SHAPES){
          const o = document.createElement("option");
          o.value = value; o.textContent = label;
          if (conceptShape(n) === value) o.selected = true;
          s.appendChild(o);
        }
        s.addEventListener("change", () => { pushHistory(); setConceptShape(n, s.value); render(); });
        return s;
      });
      frow("Notes", () => {
        const t = document.createElement("textarea");
        t.value = n.notes || "";
        t.addEventListener("focus", pushHistoryOnce());
        t.addEventListener("input", () => { n.notes = t.value; drawOnly(); });
        return t;
      });
      frow("Color", () => swatches(CONCEPT_COLORS, n.color,
        (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      frow("Text size", () => sizeStepper(conceptFont(n), 9, 48, 1,
        (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
      frow("Text color", () => swatches(FONT_COLORS, n.fontColor || "#16232F",
        (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
    } else if (n.type === "todo"){
      frow("Notes", () => {
        const t = document.createElement("textarea");
        t.value = n.notes || "";
        t.addEventListener("focus", pushHistoryOnce());
        t.addEventListener("input", () => { n.notes = t.value; drawOnly(); });
        return t;
      });
      frow("Color", () => swatches(CONCEPT_COLORS, n.color || TODO_COLOR_DEFAULT,
        (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
        (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
      frow("Text color", () => swatches(FONT_COLORS, n.fontColor || "#16232F",
        (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      frow("Collapsed", () => {
        const b = mkFlag(n.collapsed ? "COLLAPSED" : "EXPANDED", !!n.collapsed, v => { n.collapsed = v; render(); });
        return b;
      });
      renderItemEditor(n);
    } else {
      frow("Notes", () => {
        const t = document.createElement("textarea");
        t.value = n.notes || "";
        t.addEventListener("focus", pushHistoryOnce());
        t.addEventListener("input", () => { n.notes = t.value; drawOnly(); });
        return t;
      });
      frow("Header color", () => swatches(TABLE_COLORS, n.color,
        (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
        (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
      frow("Text color", () => swatches(FONT_COLORS, n.fontColor || "#16232F",
        (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      frow("Collapsed", () => {
        const b = mkFlag(n.collapsed ? "COLLAPSED" : "EXPANDED", !!n.collapsed, v => { n.collapsed = v; render(); });
        return b;
      });
      renderFieldEditor(n);
    }

    const div = document.createElement("div");
    div.className = "rowbtns";
    div.appendChild(mkBtn("Duplicate", duplicateSelection));
    if (n.type !== "frame") div.appendChild(mkBtn("Add linked concept  ⇥", addChildConcept));
    inspBody.appendChild(div);
    inspBody.appendChild(mkBtn("Delete node", deleteSelection, "dangerbtn"));

  } else {
    const e = singleSelectedEdge();
    if (!e){ clearSelection(); renderHelp(); return; }
    inspTitle.textContent = "Edge";
    const a = nodeById(e.from), b = nodeById(e.to);
    const touchesTodo = a.type === "todo" || b.type === "todo";
    const endName = (n, fid) => {
      const rows = fid ? nodeRows(n) : null;
      const f = rows ? rows.find(x => x.id === fid) : null;
      return escapeHtml(n.title) + (f ? "<span style='font-family:var(--mono);font-size:11px'>." + escapeHtml(f.name || f.text || f.id) + "</span>" : "");
    };
    const p = document.createElement("div");
    p.className = "helper";
    p.innerHTML = `<b>${endName(a, e.fromField)}</b> → <b>${endName(b, e.toField)}</b>` +
      (e.kind !== "link" ? `<br>Convention: <em>from</em> = the “one” side, <em>to</em> = the “many” side.` : "");
    inspBody.appendChild(p);

    if (!touchesTodo) frow("Type", () => {
      const s = document.createElement("select");
      for (const k of ["link","1:1","1:N","N:M"]){
        const o = document.createElement("option");
        o.value = k; o.textContent = k === "link" ? "link (mind map)" : k + " (relation)";
        if (e.kind === k) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener("change", () => { pushHistory(); e.kind = s.value; render(); });
      return s;
    });
    frow("Routing", () => {
      const s = document.createElement("select");
      for (const k of ["curve","ortho"]){
        const o = document.createElement("option");
        o.value = k; o.textContent = k === "curve" ? "curved" : "orthogonal";
        if ((e.routing || "curve") === k) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener("change", () => {
        pushHistory();
        if (s.value === "ortho") e.routing = "ortho";
        else delete e.routing;
        render();
      });
      return s;
    });
    if (a.type === "table" && b.type === "table" && e.kind !== "link") renderPairEditor(a, b, e);
    else {
      attachRow("From", a, e, "fromField");
      attachRow("To",   b, e, "toField");
    }
    const firstPair = edgeFieldPairs(e)[0] || {};
    if (!(firstPair.fromField || e.fromField)) anchorRow("From", e, "fromAnchor");
    if (!(firstPair.toField || e.toField)) anchorRow("To", e, "toAnchor");
    frow("Label (optional)", () => mkInput(e.label, v => { e.label = v; drawOnly(); }));

    const div = document.createElement("div");
    div.className = "rowbtns";
    div.appendChild(mkBtn("Swap direction", () => {
      pushHistory();
      swapEdgeDirection(e);
      render();
    }));
    div.appendChild(mkBtn("Delete edge", deleteSelection, "dangerbtn"));
    inspBody.appendChild(div);
  }
}

function renderMultiInspector(){
  const nodes = selectedNodes();
  const nonFrames = nodes.filter(n => n.type !== "frame");
  inspTitle.textContent = `${nodes.length} nodes selected`;
  const helper = document.createElement("div");
  helper.className = "helper";
  helper.textContent = "Bulk edits apply to every selected node.";
  inspBody.appendChild(helper);
  frow("Color", () => swatches([...CONCEPT_COLORS, ...TABLE_COLORS], nodes[0].color,
    (c, commit) => {
      pushHistory("color:multi");
      for (const n of nodes) n.color = c;
      commit ? render() : drawOnly();
    }));
  if (nonFrames.length === nodes.length){
    if (nodes.every(n => n.type === "concept")){
      frow("Shape", () => {
        const s = document.createElement("select");
        s.setAttribute("aria-label", "Flowchart shape");
        const current = conceptShape(nodes[0]);
        for (const [value, label] of FLOWCHART_SHAPES){
          const o = document.createElement("option");
          o.value = value; o.textContent = label;
          if (current === value) o.selected = true;
          s.appendChild(o);
        }
        s.addEventListener("change", () => {
          pushHistory();
          for (const n of nodes) setConceptShape(n, s.value);
          render();
        });
        return s;
      });
    }
    frow("Text size", () => sizeStepper(nodes[0].type === "concept" ? conceptFont(nodes[0]) : tableMetrics(nodes[0]).base,
      8, 48, 1, (v, commit) => {
        pushHistory("fs:multi");
        for (const n of nodes) n.fontSize = n.type === "concept" ? clampSize(v, 9, 48) : clampSize(v, 8, 28);
        commit ? render() : drawOnly();
      }));
    frow("Text color", () => swatches(FONT_COLORS, nodes[0].fontColor || "#16232F",
      (c, commit) => {
        pushHistory("fc:multi");
        for (const n of nodes) n.fontColor = c;
        commit ? render() : drawOnly();
      }));
  }
  const div = document.createElement("div");
  div.className = "rowbtns";
  div.appendChild(mkBtn("Duplicate", duplicateSelection));
  div.appendChild(mkBtn("Delete", deleteSelection, "dangerbtn"));
  inspBody.appendChild(div);
}

/* swap an edge's direction, carrying row bindings and pinned anchor points */
function swapEdgeDirection(e){
  const t = e.from; e.from = e.to; e.to = t;
  const tf = e.fromField;
  if (e.toField !== undefined) e.fromField = e.toField; else delete e.fromField;
  if (tf !== undefined) e.toField = tf; else delete e.toField;
  const ta = e.fromAnchor;
  if (e.toAnchor !== undefined) e.fromAnchor = e.toAnchor; else delete e.fromAnchor;
  if (ta !== undefined) e.toAnchor = ta; else delete e.toAnchor;
}
/* pick one of the 9 attachment points for a whole-node edge end */
function anchorRow(which, e, key){
  frow(which + " point", () => {
    const s = document.createElement("select");
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "(auto — nearest point)";
    s.appendChild(o0);
    for (const k of NODE_ANCHORS){
      const o = document.createElement("option");
      o.value = k; o.textContent = ANCHOR_LABELS[k];
      if (e[key] === k) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", () => {
      pushHistory();
      if (s.value) e[key] = s.value; else delete e[key];
      render();
    });
    return s;
  });
}
/* choose whole-node vs. specific row (field/item) for one end of an edge */
function attachRow(which, node, e, key){
  const rows = nodeRows(node);
  if (!rows || !rows.length) return;
  frow(which + " attaches to", () => {
    const s = document.createElement("select");
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = node.type === "todo" ? "(whole list)" : "(whole table)";
    s.appendChild(o0);
    for (const f of rows){
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.name || f.text || f.id;
      if (e[key] === f.id) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", () => {
      pushHistory();
      if (s.value) e[key] = s.value; else delete e[key];
      render();
    });
    return s;
  });
}
function setEdgePairs(e, pairs){
  e.pairs = pairs.filter(p => p.fromField || p.toField);
  if (!e.pairs.length){
    delete e.pairs;
    delete e.fromField;
    delete e.toField;
  } else {
    e.fromField = e.pairs[0].fromField || "";
    e.toField = e.pairs[0].toField || "";
  }
}
function fieldSelect(node, value, onChange){
  const s = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = ""; empty.textContent = "(none)";
  s.appendChild(empty);
  for (const f of node.fields){
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.name;
    if (value === f.id) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function renderPairEditor(a, b, e){
  const wrapD = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = "Column pairs";
  lab.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px";
  wrapD.appendChild(lab);
  const pairs = edgeFieldPairs(e);
  if (!pairs.length) pairs.push({ fromField:e.fromField || "", toField:e.toField || "" });
  pairs.forEach((pair, i) => {
    const row = document.createElement("div");
    row.className = "fieldrow";
    row.append(
      fieldSelect(a, pair.fromField, value => {
        pushHistory();
        pairs[i] = {...pairs[i], fromField:value};
        setEdgePairs(e, pairs);
        render();
      }),
      fieldSelect(b, pair.toField, value => {
        pushHistory();
        pairs[i] = {...pairs[i], toField:value};
        setEdgePairs(e, pairs);
        render();
      }),
      mkBtn("✕", () => {
        pushHistory();
        pairs.splice(i, 1);
        setEdgePairs(e, pairs);
        render();
      }, "mini del")
    );
    wrapD.appendChild(row);
  });
  wrapD.appendChild(mkBtn("+ Add column pair", () => {
    pushHistory();
    const next = edgeFieldPairs(e);
    next.push({ fromField:"", toField:"" });
    setEdgePairs(e, next);
    render();
  }));
  inspBody.appendChild(wrapD);
}

function renderFieldEditor(n){
  const wrapD = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = "Fields";
  lab.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px";
  wrapD.appendChild(lab);

  n.fields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "fieldrow";
    const nameI = mkInput(f.name, v => { f.name = v; drawOnly(); });
    const typeI = mkInput(f.type, v => { f.type = v; drawOnly(); });
    typeI.setAttribute("list", "sqltypes");
    const del = mkBtn("✕", () => { pushHistory(); const fid = f.id; n.fields.splice(i,1); cleanFieldRefs(fid); render(); }, "mini del");
    row.append(nameI, typeI, del);
    wrapD.appendChild(row);

    const flags = document.createElement("div");
    flags.className = "flags";
    flags.appendChild(mkFlag("PK", f.pk, v => { f.pk = v; if (v) f.nullable = false; render(); }));
    flags.appendChild(mkFlag("FK", f.fk, v => { f.fk = v; render(); }));
    flags.appendChild(mkFlag("NULL", f.nullable, v => { f.nullable = v; render(); }));
    flags.appendChild(mkFlag("UNQ", f.unique, v => { f.unique = v; render(); }));
    flags.appendChild(mkFlag("IDX", f.index, v => { f.index = v; render(); }));
    flags.appendChild(mkBtn("…", () => { f.metaOpen = !f.metaOpen; render(); }, "mini"));
    flags.appendChild(mkBtn("↑", () => moveField(n, i, -1), "mini"));
    flags.appendChild(mkBtn("↓", () => moveField(n, i, +1), "mini"));
    wrapD.appendChild(flags);
    if (f.metaOpen){
      const meta = document.createElement("div");
      meta.className = "fieldmeta";
      const def = mkInput(f.default || "", v => { if (v) f.default = v; else delete f.default; drawOnly(); });
      def.placeholder = "default";
      const comment = mkInput(f.comment || "", v => { if (v) f.comment = v; else delete f.comment; drawOnly(); });
      comment.placeholder = "comment";
      comment.className = "wide";
      meta.append(def, comment);
      wrapD.appendChild(meta);
    }
  });

  wrapD.appendChild(mkBtn("+ Add field", () => {
    pushHistory();
    n.fields.push({id: uid(), name:"field_" + (n.fields.length+1), type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
    render();
  }));
  inspBody.appendChild(wrapD);

  if (!document.getElementById("sqltypes")){
    const dl = document.createElement("datalist");
    dl.id = "sqltypes";
    for (const t of SQL_TYPES){ const o = document.createElement("option"); o.value = t; dl.appendChild(o); }
    document.body.appendChild(dl);
  }
}
function moveField(n, i, d){
  const rows = nodeRows(n);
  const j = i + d;
  if (!rows || j < 0 || j >= rows.length) return;
  pushHistory();
  [rows[i], rows[j]] = [rows[j], rows[i]];
  render();
}

function renderItemEditor(n){
  const wrapD = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = "Items";
  lab.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px";
  wrapD.appendChild(lab);

  n.items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "fieldrow";
    const textI = mkInput(it.text, v => { it.text = v; drawOnly(); });
    const del = mkBtn("✕", () => { pushHistory(); const iid = it.id; n.items.splice(i,1); cleanFieldRefs(iid); render(); }, "mini del");
    row.append(textI, del);
    wrapD.appendChild(row);

    const flags = document.createElement("div");
    flags.className = "flags";
    flags.appendChild(mkFlag("DONE", !!it.done, v => { if (v) it.done = true; else delete it.done; render(); }));
    flags.appendChild(mkBtn("↑", () => moveField(n, i, -1), "mini"));
    flags.appendChild(mkBtn("↓", () => moveField(n, i, +1), "mini"));
    wrapD.appendChild(flags);
  });

  wrapD.appendChild(mkBtn("+ Add item", () => {
    pushHistory();
    n.items.push({ id: uid(), text:"New item" });
    render();
  }));
  inspBody.appendChild(wrapD);
}

function renderHelp(){
  const h = document.createElement("div");
  h.className = "helper";
  h.innerHTML = `
    <p><b>Three node types, one canvas.</b><br>
    Concepts sketch the business thinking, tables carry the data model, and to-do lists
    track the work. Link them freely — an idea can point at the entity, the exact column,
    or the task that will deliver it.</p>
    <p style="margin-top:10px"><b>Field-level connections.</b><br>
    Hover a table to reveal ○ handles on each field row. Drag from a row to another
    field or node — drop-target rows highlight as you go. Field-bound relations export
    as exact <span style="font-family:var(--mono);font-size:11px">FOREIGN KEY</span> constraints.
    Dragging between an FK column and a PK column auto-orients the relation.</p>
    <div class="legendrow">
      <svg width="46" height="16"><line x1="2" y1="8" x2="44" y2="8" stroke="#98A5B3" stroke-width="1.7" stroke-dasharray="5 5"/></svg>
      link — freeform mind-map edge</div>
    <div class="legendrow">
      <svg width="46" height="16"><line x1="8" y1="8" x2="38" y2="8" stroke="#33475C" stroke-width="1.7"/>
      <line x1="10" y1="3" x2="10" y2="13" stroke="#33475C" stroke-width="1.6"/>
      <line x1="36" y1="8" x2="44" y2="3" stroke="#33475C" stroke-width="1.6"/>
      <line x1="36" y1="8" x2="44" y2="8" stroke="#33475C" stroke-width="1.6"/>
      <line x1="36" y1="8" x2="44" y2="13" stroke="#33475C" stroke-width="1.6"/></svg>
      1:N — crow's-foot relation</div>
    <p style="margin-top:12px"><b>Shortcuts</b><br>
    <kbd>C</kbd> concept · <kbd>T</kbd> table · <kbd>⇥ Tab</kbd> linked child ·
    <kbd>Del</kbd> delete · <kbd>Ctrl+Z</kbd> undo · <kbd>Ctrl+D</kbd> duplicate ·
    <kbd>F</kbd> fit · arrows nudge</p>
    <p style="margin-top:12px"><b>Type &amp; color</b><br>
    Select a node to set fill, <b>text size</b>, and <b>text color</b> in this panel — or right-click for the same. Nodes grow to fit larger text.</p>
    <p style="margin-top:12px"><b>Persistence</b><br>
    Use <b>Open</b>, <b>Save</b>, and <b>Save As</b> for local document workflow. Unsupported browsers fall back to <b>JSON ↓</b> downloads and <b>Import</b> uploads.
    <b>SQL</b> drafts CREATE TABLE statements from table nodes and 1:N edges.</p>`;
  inspBody.appendChild(h);
}

/* small builders */
function frow(label, buildCtrl){
  const d = document.createElement("div");
  d.className = "frow";
  const l = document.createElement("label");
  l.textContent = label;
  d.append(l, buildCtrl());
  inspBody.appendChild(d);
}
function mkInput(val, onInput){
  const i = document.createElement("input");
  i.type = "text"; i.value = val || "";
  i.addEventListener("focus", pushHistoryOnce());
  i.addEventListener("input", () => onInput(i.value));
  return i;
}
function pushHistoryOnce(){
  let done = false;
  return () => { if (!done){ pushHistory(); done = true; } };
}
function mkBtn(txt, fn, cls){
  const b = document.createElement("button");
  b.textContent = txt;
  if (cls) b.className = cls;
  b.addEventListener("click", fn);
  return b;
}
/* accept "#abc", "abc", "#aabbcc", "AABBCC" → "#aabbcc"; else null */
function normalizeHex(raw){
  let s = (raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split("").map(c => c + c).join("");
  if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toLowerCase();
  return null;
}

/* native color well + validated hex field.
   apply(color, commit): commit=false while live-editing (redraw canvas only,
   keep this input alive); commit=true on a settled value (full render). */
function customColorRow(current, apply, opts = {}){
  const row = document.createElement("div");
  row.className = "hexrow";

  const well = document.createElement("input");
  well.type = "color";
  well.className = "colorwell";
  well.value = normalizeHex(current) || "#000000";
  well.title = "Pick a color";
  well.addEventListener("input",  () => { syncText(well.value); apply(well.value, false); });
  well.addEventListener("change", () => { syncText(well.value); recordRecentColor(well.value); apply(well.value, true); if (opts.onCommit) opts.onCommit(); });

  const hash = document.createElement("span");
  hash.className = "hexhash";
  hash.textContent = "#";

  const txt = document.createElement("input");
  txt.type = "text";
  txt.className = "hexinput";
  txt.spellcheck = false;
  txt.maxLength = 7;
  txt.placeholder = "aabbcc";
  txt.setAttribute("aria-label", "Hex color code");
  txt.value = (normalizeHex(current) || "").replace(/^#/, "");
  const syncText = hex => { txt.value = hex.replace(/^#/, ""); txt.classList.remove("bad"); };

  txt.addEventListener("input", () => {
    const n = normalizeHex(txt.value);
    if (n){ txt.classList.remove("bad"); well.value = n; apply(n, false); }   // live once valid
    else txt.classList.remove("bad");                                          // don't nag mid-type
  });
  const commit = () => {
    const n = normalizeHex(txt.value);
    if (n){ txt.classList.remove("bad"); well.value = n; syncText(n); recordRecentColor(n); apply(n, true); return true; }
    if (txt.value.trim() !== ""){ txt.classList.add("bad"); return false; }
    return true;
  };
  txt.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); if (commit() && opts.onCommit) opts.onCommit(); }
  });
  txt.addEventListener("blur", commit);
  txt.addEventListener("pointerdown", ev => ev.stopPropagation());  // don't let menu-close swallow focus

  row.append(well, hash, txt);
  return row;
}

/* − [number] + stepper. apply(value, commit) — live while typing/holding, commit on settle */
function sizeStepper(current, lo, hi, step, apply){
  const row = document.createElement("div");
  row.className = "sizestepper";
  const dec = document.createElement("button");
  dec.type = "button"; dec.className = "stepbtn"; dec.textContent = "−";
  const num = document.createElement("input");
  num.type = "text"; num.className = "sizeval"; num.value = String(current);
  num.setAttribute("aria-label", "Font size");
  const inc = document.createElement("button");
  inc.type = "button"; inc.className = "stepbtn"; inc.textContent = "+";
  const unit = document.createElement("span");
  unit.className = "sizeunit"; unit.textContent = "px";
  const clamp = v => Math.min(hi, Math.max(lo, v));
  const setVal = (v, commit) => { v = clamp(v); num.value = String(v); apply(v, commit); };
  dec.addEventListener("click", () => setVal((parseFloat(num.value)||current) - step, true));
  inc.addEventListener("click", () => setVal((parseFloat(num.value)||current) + step, true));
  num.addEventListener("input", () => {
    const v = parseFloat(num.value);
    if (isFinite(v) && v >= lo && v <= hi) apply(v, false);      // live within range
  });
  num.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); setVal(parseFloat(num.value)||current, true); num.blur(); }
    else if (ev.key === "ArrowUp"){ ev.preventDefault(); setVal((parseFloat(num.value)||current)+step, true); }
    else if (ev.key === "ArrowDown"){ ev.preventDefault(); setVal((parseFloat(num.value)||current)-step, true); }
  });
  num.addEventListener("blur", () => setVal(parseFloat(num.value)||current, true));
  num.addEventListener("pointerdown", ev => ev.stopPropagation());
  row.append(dec, num, unit, inc);
  return row;
}

function swatchRow(colors, current, apply, className, onPick){
  const d = document.createElement("div");
  d.className = className;
  for (const c of colors){
    const b = document.createElement("button");
    b.className = "swatch" + (c.toLowerCase() === (current||"").toLowerCase() ? " on" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => { apply(c, true); if (onPick) onPick(); });
    d.appendChild(b);
  }
  return d;
}
function swatches(colors, current, apply){
  const wrap = document.createElement("div");
  wrap.className = "swatchgroup";
  wrap.appendChild(swatchRow(colors, current, apply, "swatches"));
  if (recentColors.length)
    wrap.appendChild(swatchRow(recentColors, current, apply, "swatches recent"));
  wrap.appendChild(customColorRow(current, apply));
  return wrap;
}
function mkFlag(txt, on, set){
  const b = document.createElement("button");
  b.className = "flag" + (on ? " on" : "");
  b.textContent = txt;
  b.addEventListener("click", () => { pushHistory(); set(!on); });
  return b;
}
/* redraw canvas without rebuilding inspector (keeps input focus) */
function drawOnly(){
  frameLayer.innerHTML = ""; edgeLayer.innerHTML = ""; nodeLayer.innerHTML = "";
  draftLayer.innerHTML = "";
  for (const n of state.nodes) if (n.type === "frame") drawFrame(n);
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) if (n.type !== "frame") drawNode(n);
  drawEdgeGrips();
  renderMinimap();
}
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

/* --------------------------- File I/O ----------------------------- */
function download(name, text, mime){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type: mime || "text/plain"}));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function savePickerOptions(){
  return {
    suggestedName: doc.name || "untitled.schematic.json",
    types: [{ description:"Schematic diagram", accept:{ "application/json":[".json",".schematic"] } }]
  };
}
function openPickerOptions(){
  return {
    types: [{ description:"Schematic diagram", accept:{ "application/json":[".json",".schematic"] } }],
    multiple: false
  };
}
function fallbackOpen(){
  document.getElementById("fileInput").click();
}
function fallbackSave(){
  const name = doc.name || "untitled.schematic.json";
  download(name, serializeDocument(), "application/json");
  setDocDirty(false);
}
async function openDoc(){
  if (!FSA){ fallbackOpen(); return; }
  try {
    const [handle] = await window.showOpenFilePicker(openPickerOptions());
    if (!handle) return;
    const file = await handle.getFile();
    const text = await file.text();
    importDocText(text, { name: file.name || handle.name || doc.name, handle, dirty: false });
  } catch(err){
    if (err && err.name === "AbortError") return;
    if (err && err.message === "newer version") alert("Could not read that file — it was made with a newer Schematic.");
    else alert("Could not open that file — expected JSON exported by this app.");
  }
}
async function writeHandle(handle, text){
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}
async function saveAsDoc(){
  if (!FSA){ fallbackSave(); return; }
  try {
    const handle = await window.showSaveFilePicker(savePickerOptions());
    if (!handle) return;
    await writeHandle(handle, serializeDocument());
    doc.handle = handle;
    doc.name = handle.name || doc.name;
    setDocDirty(false);
  } catch(err){
    if (err && err.name === "AbortError") return;
    alert("Could not save that file.");
  }
}
async function saveDoc(){
  if (!FSA){ fallbackSave(); return; }
  if (!doc.handle){ await saveAsDoc(); return; }
  try {
    await writeHandle(doc.handle, serializeDocument());
    setDocDirty(false);
  } catch(err){
    if (err && err.name === "AbortError") return;
    if (err && err.name === "NotAllowedError"){ await saveAsDoc(); return; }
    alert("Could not save that file.");
  }
}
function newDoc(){
  if (doc.dirty && !confirm("Discard unsaved changes and start a new diagram?")) return;
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  clearSelection();
  undoStack.length = 0;
  redoStack.length = 0;
  doc = { handle: null, name: "untitled.schematic.json", dirty: false };
  setAutoSave(false);   // the new document has no file handle to save into
  applyTheme("light", { render:false });
  applyDialect("ansi", { render:false });
  setPngAsShown(false);
  render();
  syncHistoryButtons();
  updateDocLabel();
  clearRecoverySave();
}
document.getElementById("btnExportJSON").addEventListener("click", () =>
  download(doc.name || "schematic-diagram.json", serializeDocument(), "application/json"));

document.getElementById("btnImportJSON").addEventListener("click", () =>
  fallbackOpen());
document.getElementById("btnOpen").addEventListener("click", openDoc);
document.getElementById("btnSave").addEventListener("click", saveDoc);
document.getElementById("btnSaveAs").addEventListener("click", saveAsDoc);
document.getElementById("btnNew").addEventListener("click", newDoc);
document.getElementById("fileInput").addEventListener("change", ev => {
  const f = ev.target.files[0];
  if (!f) return;
  f.text().then(txt => {
    try {
      pushHistory();
      importDocText(txt, { name: f.name, dirty: false });
    } catch(err){
      if (err && err.message === "newer version") alert("Could not read that file — it was made with a newer Schematic.");
      else alert("Could not read that file — expected JSON exported by this app.");
    }
  });
  ev.target.value = "";
});

document.getElementById("btnClear").addEventListener("click", () => {
  if (!state.nodes.length || confirm("Clear the entire canvas? (Undo can bring it back.)")){
    pushHistory(); state.nodes = []; state.edges = []; clearSelection(); render();
  }
});
document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnRedo").addEventListener("click", redo);
document.getElementById("btnFit").addEventListener("click", fitView);
document.getElementById("btnAddConcept").addEventListener("click", () => { const c = viewCenter(); addNode("concept", c.x-65, c.y-24); });
document.getElementById("btnAddTable").addEventListener("click", () => { const c = viewCenter(); addNode("table", c.x-95, c.y-40); });
document.getElementById("btnAddTodo").addEventListener("click", () => { const c = viewCenter(); addNode("todo", c.x-90, c.y-30); });
document.getElementById("btnSnap").addEventListener("click", toggleSnapToGrid);
document.getElementById("btnCleanup").addEventListener("click", cleanUpToGrid);
document.getElementById("autoSaveToggle").addEventListener("change", ev => setAutoSave(ev.target.checked));
document.getElementById("btnAddFrame").addEventListener("click", () => { const c = viewCenter(); addNode("frame", c.x-FRAME_DEFAULT.w/2, c.y-FRAME_DEFAULT.h/2); });
document.getElementById("btnLayoutTree").addEventListener("click", layoutMindMapTree);
document.getElementById("btnLayoutSchema").addEventListener("click", layoutSchemaTables);
document.getElementById("btnLint").addEventListener("click", openLintModal);
document.getElementById("btnTheme").addEventListener("click", toggleTheme);
document.getElementById("pngAsShown").addEventListener("change", ev => setPngAsShown(ev.target.checked));
document.getElementById("dialectSelect").addEventListener("change", ev => setDialect(ev.target.value));

/* --------------------------- SQL export --------------------------- */
function ident(s){
  const t = (s||"t").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g,"");
  return t || "t";
}
function qident(s, dialect = docDialect){
  const id = ident(s);
  if (dialect === "mysql" || dialect === "athena") return "`" + id + "`";
  return id;
}
function sqlType(raw, dialect = docDialect){
  const t = String(raw || "TEXT").trim();
  if (dialect === "mysql"){
    if (/^SERIAL$/i.test(t)) return "INT AUTO_INCREMENT";
    if (/^TIMESTAMP$/i.test(t)) return "DATETIME";
    if (/^BOOLEAN$/i.test(t)) return "BOOLEAN";
    return t.replace(/^JSONB$/i, "JSON");
  }
  if (dialect === "athena"){
    if (/^SERIAL$/i.test(t)) return "INT";
    if (/^VARCHAR\(\d+\)$/i.test(t) || /^TEXT$/i.test(t)) return "STRING";
    if (/^BOOLEAN$/i.test(t)) return "BOOLEAN";
    if (/^FLOAT$/i.test(t)) return "DOUBLE";
    if (/^JSONB?$/i.test(t)) return "STRING";
    return t;
  }
  if (dialect === "ansi"){
    if (/^SERIAL$/i.test(t)) return "INT";
    if (/^JSONB$/i.test(t)) return "JSON";
    return t;
  }
  return t;
}
function comparableType(raw){
  return String(sqlType(raw, "ansi")).toUpperCase()
    .replace(/^SERIAL$/, "INT")
    .replace(/^INT AUTO_INCREMENT$/, "INT")
    .replace(/^VARCHAR\(\d+\)$/, "VARCHAR")
    .replace(/^DECIMAL\([^)]+\)$/, "DECIMAL")
    .replace(/^NUMERIC\([^)]+\)$/, "NUMERIC");
}
function edgePairsResolved(e, parent, child){
  const pairs = edgeFieldPairs(e);
  if (pairs.length){
    const resolved = pairs.map(p => ({
      parent: parent.fields.find(f => f.id === p.fromField),
      child: child.fields.find(f => f.id === p.toField)
    })).filter(p => p.parent && p.child);
    if (resolved.length) return resolved;
  }
  const ppk = parent.fields.find(f => f.pk);
  const boundChild = e.toField ? child.fields.find(f => f.id === e.toField) : null;
  const boundParent = e.fromField ? parent.fields.find(f => f.id === e.fromField) : null;
  const fkField = boundChild
               || child.fields.find(f => f.fk && ident(f.name).includes(ident(parent.title).replace(/s$/,"")))
               || child.fields.find(f => f.fk);
  const refField = boundParent || ppk;
  return fkField && refField ? [{ parent:refField, child:fkField }] : [];
}
function columnLine(f, dialect = docDialect){
  const parts = [`  ${qident(f.name, dialect)} ${sqlType(f.type, dialect)}`];
  if (dialect !== "athena"){
    if (!f.nullable) parts.push("NOT NULL");
    if (f.default) parts.push("DEFAULT " + f.default);
    if (f.unique) parts.push("UNIQUE");
  }
  const comment = f.comment ? ` -- ${f.comment}` : "";
  return parts.join(" ") + comment;
}
function generateSQL(dialect = docDialect){
  const tables = state.nodes.filter(n => n.type === "table");
  if (!tables.length) return "-- No table nodes on the canvas.\n-- Add a Table node, give it fields, then export again.";
  dialect = SQL_DIALECTS.includes(dialect) ? dialect : "ansi";
  const lines = [`-- Draft ${dialect.toUpperCase()} DDL generated by Schematic — review types & constraints before use.`,
    "-- Table nodes only; concepts and to-do lists are not exported.",""];
  for (const t of tables){
    const tn = qident(t.title, dialect);
    const cols = t.fields.map(f => columnLine(f, dialect));
    const constraintComments = [];
    const pks = t.fields.filter(f => f.pk).map(f => qident(f.name, dialect));
    if (pks.length){
      const line = `  PRIMARY KEY (${pks.join(", ")})`;
      if (dialect === "athena") constraintComments.push("-- " + line.trim());
      else cols.push(line);
    }
    for (const e of state.edges){
      if (e.kind !== "1:N" && e.kind !== "1:1") continue;
      if (e.to !== t.id) continue;
      const parent = nodeById(e.from);
      if (!parent || parent.type !== "table") continue;
      const pairs = edgePairsResolved(e, parent, t);
      if (pairs.length){
        const childCols = pairs.map(p => qident(p.child.name, dialect)).join(", ");
        const parentCols = pairs.map(p => qident(p.parent.name, dialect)).join(", ");
        const line = `  FOREIGN KEY (${childCols}) REFERENCES ${qident(parent.title, dialect)}(${parentCols})`;
        if (dialect === "athena") constraintComments.push("-- " + line.trim());
        else cols.push(line);
      } else {
        const ppk = parent.fields.find(f => f.pk);
        cols.push(`  -- TODO: add FK column referencing ${qident(parent.title, dialect)}${ppk ? "(" + qident(ppk.name, dialect) + ")" : ""} (edge: ${e.kind})`);
      }
    }
    if (dialect === "athena"){
      lines.push(`CREATE EXTERNAL TABLE ${tn} (`, cols.join(",\n"), ")",
        "STORED AS PARQUET",
        "-- LOCATION 's3://bucket/path/';");
      if (constraintComments.length) lines.push(...constraintComments);
      if (t.fields.some(f => /^SERIAL$/i.test(f.type || ""))) lines.push("-- SERIAL fields emitted as INT for Athena.");
      lines.push("");
    } else {
      lines.push(`CREATE TABLE ${tn} (`, cols.join(",\n"), ");", "");
      for (const f of t.fields.filter(f => f.index)){
        lines.push(`CREATE INDEX idx_${ident(t.title)}_${ident(f.name)} ON ${tn} (${qident(f.name, dialect)});`);
      }
      if (t.fields.some(f => f.index)) lines.push("");
    }
  }
  for (const e of state.edges){
    if (e.kind !== "N:M") continue;
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    const an = qident(a.title, dialect), bn = qident(b.title, dialect);
    const rawAn = ident(a.title), rawBn = ident(b.title);
    const apk = a.fields.find(f => f.pk), bpk = b.fields.find(f => f.pk);
    lines.push(`-- N:M between ${rawAn} and ${rawBn} — suggested junction table:`,
      `CREATE TABLE ${qident(rawAn + "_" + rawBn, dialect)} (`,
      `  ${qident(rawAn + "_id", dialect)} ${apk ? sqlType(apk.type, dialect) : "INT"} NOT NULL,`,
      `  ${qident(rawBn + "_id", dialect)} ${bpk ? sqlType(bpk.type, dialect) : "INT"} NOT NULL,`,
      `  PRIMARY KEY (${qident(rawAn + "_id", dialect)}, ${qident(rawBn + "_id", dialect)})` +
        (apk && dialect !== "athena" ? `,\n  FOREIGN KEY (${qident(rawAn + "_id", dialect)}) REFERENCES ${an}(${qident(apk.name, dialect)})` : "") +
        (bpk && dialect !== "athena" ? `,\n  FOREIGN KEY (${qident(rawBn + "_id", dialect)}) REFERENCES ${bn}(${qident(bpk.name, dialect)})` : ""),
      ");", "");
  }
  return lines.join("\n");
}
function lintDocument(docState = state){
  const issues = [];
  const nodes = docState.nodes || [];
  const edges = docState.edges || [];
  const tables = nodes.filter(n => n.type === "table");
  const concepts = nodes.filter(n => n.type === "concept");
  const titleKey = n => ident(n.title);
  const tableNames = new Map();
  for (const t of tables){
    const key = titleKey(t);
    if (tableNames.has(key)) issues.push({level:"error", msg:`Duplicate table name: ${t.title}`, nodeId:t.id});
    else tableNames.set(key, t);
    if (!t.fields.some(f => f.pk)) issues.push({level:"error", msg:`Table ${t.title} has no primary key`, nodeId:t.id});
    const fieldNames = new Set();
    for (const f of t.fields){
      const fk = ident(f.name);
      if (fieldNames.has(fk)) issues.push({level:"error", msg:`Duplicate field ${f.name} in ${t.title}`, nodeId:t.id});
      fieldNames.add(fk);
      if (f.fk){
        const bound = edges.some(e => e.fromField === f.id || e.toField === f.id ||
          edgeFieldPairs(e).some(p => p.fromField === f.id || p.toField === f.id));
        if (!bound) issues.push({level:"error", msg:`FK field ${t.title}.${f.name} has no bound relation`, nodeId:t.id});
      }
    }
  }
  for (const c of concepts){
    if (!String(c.title || "").trim()) issues.push({level:"error", msg:"Concept has an empty title", nodeId:c.id});
  }
  for (const td of nodes.filter(n => n.type === "todo")){
    if (!(td.items || []).length)
      issues.push({level:"warning", msg:`To-do list ${td.title || "(untitled)"} has no items`, nodeId:td.id});
  }
  for (const e of edges){
    if (e.kind === "link") continue;
    const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
    if ((a && a.type === "todo") || (b && b.type === "todo")){
      issues.push({level:"error", msg:`Relation ${e.kind} touches a to-do list — use a link edge`, edgeId:e.id});
      continue;
    }
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    if (e.kind === "N:M"){
      const expected = ident(a.title) + "_" + ident(b.title);
      const reverse = ident(b.title) + "_" + ident(a.title);
      if (!tables.some(t => ident(t.title) === expected || ident(t.title) === reverse))
        issues.push({level:"error", msg:`N:M ${a.title} ↔ ${b.title} has no junction table`, edgeId:e.id});
    }
    for (const p of edgePairsResolved(e, a, b)){
      if (comparableType(p.parent.type) !== comparableType(p.child.type))
        issues.push({level:"error", msg:`Type mismatch on ${a.title}.${p.parent.name} → ${b.title}.${p.child.name}`, edgeId:e.id});
    }
  }
  return issues;
}
let lintModal = null;
function openLintModal(){
  closeLintModal();
  const modal = document.createElement("div");
  modal.className = "modal open lint-modal";
  const issues = lintDocument();
  const rows = document.createElement("div");
  rows.className = "lint-list";
  if (!issues.length){
    const p = document.createElement("p");
    p.className = "helper";
    p.textContent = "No schema lint errors.";
    rows.appendChild(p);
  } else {
    for (const issue of issues){
      const b = document.createElement("button");
      b.className = "lint-row";
      b.innerHTML = `<b>${escapeHtml(issue.msg)}</b><small>${escapeHtml(issue.level)}</small>`;
      b.addEventListener("click", () => {
        if (issue.nodeId){ setSelection("node", issue.nodeId); centerNode(issue.nodeId); render(); }
        if (issue.edgeId){ setSelection("edge", issue.edgeId); render(); }
        closeLintModal();
      });
      rows.appendChild(b);
    }
  }
  modal.innerHTML = `<div class="card"><h3>Schema lint</h3><div class="actions"><button class="primary" id="btnCloseLint">Close</button></div></div>`;
  modal.querySelector(".card").insertBefore(rows, modal.querySelector(".actions"));
  modal.addEventListener("click", ev => { if (ev.target === modal) closeLintModal(); });
  document.body.appendChild(modal);
  lintModal = modal;
  modal.querySelector("#btnCloseLint").addEventListener("click", closeLintModal);
}
function closeLintModal(){
  if (lintModal && lintModal.parentNode) lintModal.parentNode.removeChild(lintModal);
  lintModal = null;
}

/* ------------------------ Interop helpers ------------------------- */
function stripSqlComments(text){
  return String(text || "").replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function splitSqlStatements(text){
  const out = [];
  let cur = "", quote = null, depth = 0;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quote){
      cur += ch;
      if (ch === quote && text[i-1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`"){ quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0){ if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function splitTopLevelComma(text){
  const out = [];
  let cur = "", quote = null, depth = 0;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quote){
      cur += ch;
      if (ch === quote && text[i-1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`"){ quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0){ out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function unquoteName(s){
  return String(s || "").trim().replace(/^[`"[]|[`"\]]$/g, "");
}
function parseNameList(text){
  return splitTopLevelComma(text).map(unquoteName).map(ident);
}
function parseDDL(text){
  const result = { tables:[], fks:[], skipped:[] };
  const statements = splitSqlStatements(stripSqlComments(text));
  for (const stmt of statements){
    const m = stmt.match(/^\s*CREATE\s+(?:EXTERNAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.-]+[`"\]]?)\s*\(([\s\S]*)\)\s*(?:STORED\s+AS[\s\S]*)?$/i);
    if (!m){ result.skipped.push(stmt.slice(0, 80)); continue; }
    try {
      const tableName = ident(unquoteName(m[1].split(".").pop()));
      const table = { title:tableName, fields:[] };
      const tablePk = [];
      for (const part of splitTopLevelComma(m[2])){
        const pk = part.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)$/i);
        if (pk){ tablePk.push(...parseNameList(pk[1])); continue; }
        const fk = part.match(/^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([`"\[]?[\w.-]+[`"\]]?)\s*\(([^)]+)\)$/i);
        if (fk){
          result.fks.push({
            fromTable: ident(unquoteName(fk[2].split(".").pop())),
            toTable: tableName,
            fromFields: parseNameList(fk[3]),
            toFields: parseNameList(fk[1])
          });
          continue;
        }
        const cm = part.match(/^([`"\[]?[\w]+[`"\]]?)\s+(.+)$/i);
        if (!cm){ result.skipped.push(part); continue; }
        const name = ident(unquoteName(cm[1]));
        let rest = cm[2].trim();
        const field = { name, type:"TEXT", pk:false, fk:false, nullable:true };
        const typeMatch = rest.match(/^([A-Z]+(?:\s+AUTO_INCREMENT)?(?:\([^)]+\))?)/i);
        if (typeMatch){ field.type = typeMatch[1].toUpperCase(); rest = rest.slice(typeMatch[0].length).trim(); }
        if (/NOT\s+NULL/i.test(rest)) field.nullable = false;
        if (/PRIMARY\s+KEY/i.test(rest)){ field.pk = true; field.nullable = false; }
        if (/UNIQUE/i.test(rest)) field.unique = true;
        const def = rest.match(/\bDEFAULT\s+((?:'[^']*')|(?:"[^"]*")|[^\s,]+)/i);
        if (def) field.default = def[1];
        table.fields.push(field);
      }
      for (const f of table.fields) if (tablePk.includes(ident(f.name))){ f.pk = true; f.nullable = false; }
      result.tables.push(table);
    } catch {
      result.skipped.push(stmt.slice(0, 80));
    }
  }
  return result;
}
function importParsedDDL(parsed){
  if (!parsed || !parsed.tables || !parsed.tables.length) return false;
  pushHistory();
  const start = viewCenter();
  const tableIdByName = new Map();
  const fieldIdByTableName = new Map();
  parsed.tables.forEach((src, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const n = { id:uid(), type:"table", x:start.x + col*300, y:start.y + row*220,
      title:src.title, notes:"", color:TABLE_COLORS[i % TABLE_COLORS.length],
      fields:src.fields.map(f => ({ id:uid(), name:f.name, type:f.type, pk:!!f.pk, fk:!!f.fk,
        nullable:f.nullable !== false, default:f.default, unique:!!f.unique, index:!!f.index, comment:f.comment })) };
    state.nodes.push(n);
    tableIdByName.set(ident(n.title), n.id);
    fieldIdByTableName.set(ident(n.title), new Map(n.fields.map(f => [ident(f.name), f.id])));
  });
  for (const fk of parsed.fks || []){
    const from = tableIdByName.get(ident(fk.fromTable));
    const to = tableIdByName.get(ident(fk.toTable));
    if (!from || !to) continue;
    const fromFields = fieldIdByTableName.get(ident(fk.fromTable));
    const toFields = fieldIdByTableName.get(ident(fk.toTable));
    const pairs = fk.fromFields.map((ff, i) => ({
      fromField: fromFields.get(ident(ff)) || "",
      toField: toFields.get(ident(fk.toFields[i])) || ""
    })).filter(p => p.fromField && p.toField);
    for (const p of pairs){
      const toNode = nodeById(to);
      const f = toNode && toNode.fields.find(x => x.id === p.toField);
      if (f) f.fk = true;
    }
    const e = { id:uid(), from, to, kind:"1:N", label:"" };
    if (pairs.length) setEdgePairs(e, pairs);
    state.edges.push(e);
  }
  render();
  return true;
}
function importDDLText(text){
  const parsed = parseDDL(text);
  const ok = importParsedDDL(parsed);
  return {...parsed, imported:ok};
}
function generateMermaid(){
  const lines = ["erDiagram", "  %% Tables and relations only — concepts, links, and to-do lists are omitted."];
  const tables = state.nodes.filter(n => n.type === "table");
  for (const t of tables){
    lines.push(`  ${ident(t.title)} {`);
    for (const f of t.fields) lines.push(`    ${String(f.type || "TEXT").replace(/\s+/g, "_")} ${ident(f.name)}`);
    lines.push("  }");
  }
  for (const e of state.edges){
    if (e.kind === "link") continue;
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    const rel = e.kind === "1:1" ? "||--||" : e.kind === "1:N" ? "||--o{" : "}o--o{";
    lines.push(`  ${ident(a.title)} ${rel} ${ident(b.title)} : "${(e.label || "").replace(/"/g, '\\"')}"`);
  }
  return lines.join("\n");
}
function generateMarkdownOutline(){
  const outlineRoots = state.nodes.filter(n => n.type === "concept" || n.type === "todo");
  const incoming = new Set(state.edges.filter(e => e.kind === "link").map(e => e.to));
  const roots = outlineRoots.filter(n => !incoming.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const childEdges = id => state.edges.filter(e => e.kind === "link" && e.from === id)
    .sort((a, b) => (nodeById(a.to)?.y || 0) - (nodeById(b.to)?.y || 0));
  const lines = [];
  function walk(id, depth, seen){
    const n = nodeById(id);
    if (!n) return;
    const indent = "  ".repeat(depth);
    if (seen.has(id)){ lines.push(`${indent}- (→ see ${n.title || id})`); return; }
    if (n.type === "table") lines.push(`${indent}- **${n.title || "table"}**`);
    else if (n.type === "todo"){
      lines.push(`${indent}- ${n.title || "To-do list"}`);
      if (n.notes) lines.push(`${indent}  > ${n.notes}`);
      for (const it of n.items) lines.push(`${indent}  - [${it.done ? "x" : " "}] ${it.text || ""}`);
    }
    else {
      lines.push(`${indent}- ${n.title || "(untitled)"}`);
      if (n.notes) lines.push(`${indent}  > ${n.notes}`);
    }
    const nextSeen = new Set(seen); nextSeen.add(id);
    for (const e of childEdges(id)) walk(e.to, depth + 1, nextSeen);
  }
  for (const root of roots) walk(root.id, 0, new Set());
  return lines.join("\n") || "- (empty)";
}
function serializedSvg(asShown = true){
  if (!state.nodes.length) return "";
  const bounds = documentBounds();
  const pad = 40, W = bounds.w + pad*2, H = bounds.h + pad*2;
  const png = cloneBoardForPng(asShown);
  const clone = png.clone;
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  clone.setAttribute("viewBox", `${bounds.x-pad} ${bounds.y-pad} ${W} ${H}`);
  const g = clone.querySelector("#world");
  if (g) g.removeAttribute("transform");
  const bg = clone.querySelector("[data-bg]");
  if (bg) bg.setAttribute("fill", themeColors(png.themeName).paper);
  clone.querySelectorAll("[data-handle], [data-fieldhandle], [data-frame-resize], [data-edgegrip]").forEach(h => h.remove());
  const style = document.createElementNS(SVGNS, "style");
  style.textContent = "/* Fonts use system fallbacks if Archivo or IBM Plex Mono are unavailable. */";
  clone.insertBefore(style, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}
function parseCSVLine(line){
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++){
    const ch = line[i];
    if (quoted){
      if (ch === '"' && line[i+1] === '"'){ cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ","){ out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function inferScalarType(values){
  const present = values.filter(v => String(v).trim() !== "");
  if (!present.length) return "VARCHAR(255)";
  if (present.every(v => /^-?\d+$/.test(String(v).trim()))) return "INT";
  if (present.every(v => /^-?\d+(?:\.\d+)?$/.test(String(v).trim()))) return "DECIMAL(12,2)";
  if (present.every(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()))) return "DATE";
  if (present.every(v => !Number.isNaN(Date.parse(String(v).trim())) && /[T:]/.test(String(v)))) return "TIMESTAMP";
  if (present.every(v => /^(true|false|0|1)$/i.test(String(v).trim()))) return "BOOLEAN";
  return "VARCHAR(255)";
}
function inferTable(csvText, name = "imported_csv"){
  const rows = String(csvText || "").trim().split(/\r?\n/).filter(Boolean).slice(0, 101).map(parseCSVLine);
  if (!rows.length) return { name:ident(name), fields:[] };
  const headers = rows[0].map(h => ident(h || "field"));
  const data = rows.slice(1);
  const fields = headers.map((h, i) => {
    const values = data.map(r => r[i] || "");
    return { name:h, type:inferScalarType(values), pk:false, fk:false, nullable:values.some(v => String(v).trim() === "") };
  });
  return { name:ident(name), fields };
}
function importCSVText(text, name = "imported_csv"){
  const inferred = inferTable(text, name);
  if (!inferred.fields.length) return inferred;
  pushHistory();
  const c = viewCenter();
  state.nodes.push({ id:uid(), type:"table", x:c.x-95, y:c.y-40, title:inferred.name,
    notes:"", color:TABLE_COLORS[state.nodes.filter(n => n.type === "table").length % TABLE_COLORS.length],
    fields:inferred.fields.map(f => ({...f, id:uid()})) });
  render();
  return inferred;
}

const sqlModal = document.getElementById("sqlModal");
let textModal = null;
function closeTextModal(){
  if (textModal && textModal.parentNode) textModal.parentNode.removeChild(textModal);
  textModal = null;
}
function openTextInputModal(title, placeholder, actionLabel, onSubmit){
  closeTextModal();
  const modal = document.createElement("div");
  modal.className = "modal open text-input-modal";
  modal.innerHTML = `<div class="card"><h3>${escapeHtml(title)}</h3><div class="palette-body"><textarea class="modal-textarea" placeholder="${escapeHtml(placeholder)}" style="min-height:220px"></textarea></div><div class="actions"><button id="btnCancelText">Cancel</button><button class="primary" id="btnSubmitText">${escapeHtml(actionLabel)}</button></div></div>`;
  modal.addEventListener("click", ev => { if (ev.target === modal) closeTextModal(); });
  document.body.appendChild(modal);
  textModal = modal;
  const ta = modal.querySelector("textarea");
  modal.querySelector("#btnCancelText").addEventListener("click", closeTextModal);
  modal.querySelector("#btnSubmitText").addEventListener("click", () => {
    onSubmit(ta.value);
    closeTextModal();
  });
  ta.focus();
}
function openOutputModal(title, text, downloadName, mime){
  closeTextModal();
  const modal = document.createElement("div");
  modal.className = "modal open output-modal";
  modal.innerHTML = `<div class="card"><h3>${escapeHtml(title)}</h3><pre></pre><div class="actions"><button id="btnCopyOutput">Copy</button><button id="btnDownloadOutput">Download</button><button class="primary" id="btnCloseOutput">Close</button></div></div>`;
  modal.querySelector("pre").textContent = text;
  modal.addEventListener("click", ev => { if (ev.target === modal) closeTextModal(); });
  document.body.appendChild(modal);
  textModal = modal;
  modal.querySelector("#btnCopyOutput").addEventListener("click", ev => {
    navigator.clipboard.writeText(text).then(() => {
      ev.target.textContent = "Copied";
      setTimeout(() => ev.target.textContent = "Copy", 1200);
    });
  });
  modal.querySelector("#btnDownloadOutput").addEventListener("click", () => download(downloadName, text, mime));
  modal.querySelector("#btnCloseOutput").addEventListener("click", closeTextModal);
}
document.getElementById("btnExportSQL").addEventListener("click", () => {
  document.getElementById("sqlOut").textContent = generateSQL();
  sqlModal.classList.add("open");
});
document.getElementById("btnCloseSQL").addEventListener("click", () => sqlModal.classList.remove("open"));
sqlModal.addEventListener("click", ev => { if (ev.target === sqlModal) sqlModal.classList.remove("open"); });
document.getElementById("btnCopySQL").addEventListener("click", ev => {
  navigator.clipboard.writeText(document.getElementById("sqlOut").textContent)
    .then(() => { ev.target.textContent = "Copied ✓"; setTimeout(() => ev.target.textContent = "Copy", 1400); });
});
document.getElementById("btnDownloadSQL").addEventListener("click", () =>
  download("schematic-schema.sql", document.getElementById("sqlOut").textContent, "text/plain"));
document.getElementById("btnImportDDL").addEventListener("click", () =>
  openTextInputModal("Import SQL DDL", "CREATE TABLE ...", "Import", text => {
    const result = importDDLText(text);
    if (result.skipped.length) openOutputModal("DDL import report", `Imported ${result.tables.length} tables.\nSkipped:\n- ${result.skipped.join("\n- ")}`, "schematic-ddl-import.txt", "text/plain");
  }));
document.getElementById("btnExportMermaid").addEventListener("click", () =>
  openOutputModal("Mermaid ER", generateMermaid(), "schematic-er.mmd", "text/plain"));
document.getElementById("btnExportMarkdown").addEventListener("click", () =>
  openOutputModal("Markdown outline", generateMarkdownOutline(), "schematic-outline.md", "text/markdown"));
document.getElementById("btnExportSVG").addEventListener("click", () =>
  download("schematic-diagram.svg", serializedSvg(true), "image/svg+xml"));
document.getElementById("btnImportCSV").addEventListener("click", () =>
  openTextInputModal("Import CSV", "id,email,created_at\n1,user@example.com,2026-07-08", "Create table", text => importCSVText(text)));

/* --------------------------- PNG export --------------------------- */
function cloneBoardForPng(asShown = pngAsShown){
  const exportTheme = asShown ? docTheme : "light";
  const previousTheme = docTheme;
  if (previousTheme !== exportTheme) applyTheme(exportTheme, { render:true });
  const clone = board.cloneNode(true);
  if (previousTheme !== exportTheme) applyTheme(previousTheme, { render:true });
  return { clone, themeName:exportTheme };
}
document.getElementById("btnExportPNG").addEventListener("click", () => {
  if (!state.nodes.length){ alert("Nothing to export yet."); return; }
  const bounds = documentBounds();
  const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.w, y1 = bounds.y + bounds.h;
  const pad = 40, W = x1 - x0 + pad*2, H = y1 - y0 + pad*2;
  const png = cloneBoardForPng(pngAsShown);
  const clone = png.clone;
  clone.setAttribute("width", W); clone.setAttribute("height", H);
  clone.setAttribute("viewBox", `${x0-pad} ${y0-pad} ${W} ${H}`);
  const g = clone.querySelector("#world");
  g.removeAttribute("transform");
  const bg = g.querySelector("[data-bg]");
  const bgColor = pngAsShown ? themeColors(png.themeName).paper : "#FFFFFF";
  if (bg) bg.setAttribute("fill", bgColor);
  clone.querySelectorAll("[data-handle], [data-fieldhandle], [data-frame-resize], [data-edgegrip]").forEach(h => h.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], {type:"image/svg+xml;charset=utf-8"}));
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = W*2; cv.height = H*2;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = bgColor; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob(b => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "schematic-diagram.png";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.src = url;
});

/* ------------------------ Context menu ---------------------------- */
const ctxMenu = document.createElement("div");
ctxMenu.id = "ctxMenu";
document.body.appendChild(ctxMenu);

function hideCtx(){ ctxMenu.style.display = "none"; ctxMenu.innerHTML = ""; }
function showCtx(x, y, build){
  ctxMenu.innerHTML = "";
  build(ctxMenu);
  ctxMenu.style.display = "block";
  ctxMenu.style.left = x + "px";
  ctxMenu.style.top  = y + "px";
  requestAnimationFrame(() => {                       // flip if overflowing viewport
    const r = ctxMenu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  ctxMenu.style.left = Math.max(4, x - r.width)  + "px";
    if (r.bottom > window.innerHeight) ctxMenu.style.top  = Math.max(4, y - r.height) + "px";
  });
}
function ctxItem(parent, label, fn, opts = {}){
  const b = document.createElement("button");
  b.className = "ctxitem" + (opts.danger ? " danger" : "");
  const s = document.createElement("span");
  s.textContent = label;
  b.appendChild(s);
  if (opts.kbd){
    const k = document.createElement("kbd");
    k.textContent = opts.kbd;
    b.appendChild(k);
  }
  b.addEventListener("click", () => { hideCtx(); fn(); });
  parent.appendChild(b);
}
function ctxSep(parent){
  const d = document.createElement("div");
  d.className = "sep";
  parent.appendChild(d);
}
function ctxLabel(parent, txt){
  const d = document.createElement("div");
  d.className = "ctxlabel";
  d.textContent = txt;
  parent.appendChild(d);
}
function ctxSwatches(parent, colors, current, apply){
  parent.appendChild(swatchRow(colors, current, apply, "swrow", hideCtx));
  if (recentColors.length)
    parent.appendChild(swatchRow(recentColors, current, apply, "swrow recent", hideCtx));
  const hexWrap = document.createElement("div");
  hexWrap.className = "swrow";
  hexWrap.appendChild(customColorRow(current, apply, { onCommit: hideCtx }));
  parent.appendChild(hexWrap);
}
/* compact font-size stepper for the context menu */
function ctxSizeRow(parent, n, targets = [n]){
  const isC = n.type === "concept";
  const cur = isC ? conceptFont(n) : tableMetrics(n).base;
  const wrap = document.createElement("div");
  wrap.className = "swrow";
  wrap.appendChild(sizeStepper(cur, isC ? 9 : 8, isC ? 48 : 28, isC ? 1 : 0.5,
    (v, commit) => {
      pushHistory(targets.length > 1 ? "fs:multi" : "fs:"+n.id);
      for (const t of targets) t.fontSize = t.type === "concept" ? clampSize(v, 9, 48) : clampSize(v, 8, 28);
      commit ? render() : drawOnly();
    }));
  parent.appendChild(wrap);
}

function nodeMenu(n, x, y){
  const targets = isSelected("node", n.id) ? selectedNodes() : [n];
  const applyToTargets = (fn) => {
    for (const t of targets) fn(t);
  };
  showCtx(x, y, m => {
    ctxLabel(m, n.type === "concept" ? "Color" : n.type === "frame" ? "Frame color"
              : n.type === "todo" ? "List color" : "Header color");
    ctxSwatches(m, (n.type === "concept" || n.type === "todo") ? CONCEPT_COLORS : TABLE_COLORS, n.color,
      (c, commit) => { pushHistory(targets.length > 1 ? "color:multi" : "color:"+n.id); applyToTargets(t => { t.color = c; }); commit ? render() : drawOnly(); });
    if (n.type !== "frame"){
      ctxLabel(m, "Text size");
      ctxSizeRow(m, n, targets);
      ctxLabel(m, "Text color");
      ctxSwatches(m, FONT_COLORS, n.fontColor || "#16232F",
        (c, commit) => { pushHistory(targets.length > 1 ? "fc:multi" : "fc:"+n.id); applyToTargets(t => { t.fontColor = c; }); commit ? render() : drawOnly(); });
    }
    ctxSep(m);
    ctxItem(m, "Edit title", () => startInlineEditor("node", n.id), {kbd:"dbl-click"});
    if (n.type !== "frame") ctxItem(m, "Add linked concept", addChildConcept, {kbd:"Tab"});
    if (n.type === "table"){
      ctxItem(m, "Add related table (1:N)", () => addRelatedTable(n.id));
      ctxItem(m, n.collapsed ? "Expand fields" : "Collapse fields", () => {
        pushHistory();
        n.collapsed = !n.collapsed;
        render();
      });
      ctxItem(m, "Add field", () => {
        pushHistory();
        n.fields.push({id: uid(), name:"field_" + (n.fields.length+1),
                       type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
        render();
      });
    }
    if (n.type === "todo"){
      ctxItem(m, n.collapsed ? "Expand items" : "Collapse items", () => {
        pushHistory();
        n.collapsed = !n.collapsed;
        render();
      });
      ctxItem(m, "Add item", () => {
        pushHistory();
        n.items.push({id: uid(), text:"New item"});
        render();
      });
    }
    ctxItem(m, "Duplicate", duplicateSelection, {kbd:"Ctrl+D"});
    if (targets.length >= 2){
      ctxSep(m);
      ctxLabel(m, "Align");
      ctxItem(m, "Align left", () => alignSelection("left"));
      ctxItem(m, "Align right", () => alignSelection("right"));
      ctxItem(m, "Align top", () => alignSelection("top"));
      ctxItem(m, "Align bottom", () => alignSelection("bottom"));
      ctxItem(m, "Center horizontally", () => alignSelection("centerX"));
      ctxItem(m, "Center vertically", () => alignSelection("centerY"));
      ctxItem(m, "Distribute horizontally", () => alignSelection("distributeX"));
      ctxItem(m, "Distribute vertically", () => alignSelection("distributeY"));
    }
    ctxSep(m);
    ctxItem(m, "Bring to front", () => reorderNode(n.id, true));
    ctxItem(m, "Send to back",   () => reorderNode(n.id, false));
    ctxSep(m);
    ctxItem(m, "Delete node", deleteSelection, {kbd:"Del", danger:true});
  });
}
function edgeMenu(e, x, y){
  const a = nodeById(e.from), b = nodeById(e.to);
  const touchesTodo = (a && a.type === "todo") || (b && b.type === "todo");
  showCtx(x, y, m => {
    if (!touchesTodo){
      ctxLabel(m, "Relation type");
      const row = document.createElement("div");
      row.className = "kindrow";
      for (const k of ["link","1:1","1:N","N:M"]){
        const btn = document.createElement("button");
        btn.textContent = k;
        if (e.kind === k) btn.className = "on";
        btn.addEventListener("click", () => { hideCtx(); pushHistory(); e.kind = k; render(); });
        row.appendChild(btn);
      }
      m.appendChild(row);
    }
    ctxLabel(m, "Routing");
    const routeRow = document.createElement("div");
    routeRow.className = "kindrow";
    for (const k of ["curve","ortho"]){
      const b = document.createElement("button");
      b.textContent = k === "curve" ? "Curve" : "Ortho";
      if ((e.routing || "curve") === k) b.className = "on";
      b.addEventListener("click", () => {
        hideCtx();
        pushHistory();
        if (k === "ortho") e.routing = "ortho"; else delete e.routing;
        render();
      });
      routeRow.appendChild(b);
    }
    m.appendChild(routeRow);
    ctxSep(m);
    ctxItem(m, "Swap direction", () => {
      pushHistory();
      swapEdgeDirection(e);
      render();
    });
    ctxItem(m, "Edit label", () => startInlineEditor("edge", e.id), {kbd:"dbl-click"});
    ctxSep(m);
    ctxItem(m, "Delete edge", deleteSelection, {kbd:"Del", danger:true});
  });
}
function canvasMenu(w, x, y){
  showCtx(x, y, m => {
    ctxItem(m, "Add concept here", () => addNode("concept", w.x - 65, w.y - 24), {kbd:"C"});
    ctxItem(m, "Add table here",   () => addNode("table",   w.x - 95, w.y - 40), {kbd:"T"});
    ctxItem(m, "Add to-do list here", () => addNode("todo", w.x - 90, w.y - 30), {kbd:"D"});
    ctxItem(m, "Add frame here",   () => addNode("frame",   w.x - FRAME_DEFAULT.w/2, w.y - FRAME_DEFAULT.h/2));
    ctxSep(m);
    ctxItem(m, "Fit diagram", fitView, {kbd:"F"});
  });
}

board.addEventListener("contextmenu", ev => {
  ev.preventDefault();
  const nodeEl = ev.target.closest("[data-node]");
  const edgeEl = ev.target.closest("[data-edge]");
  if (nodeEl){
    const n = nodeById(nodeEl.getAttribute("data-node"));
    if (!isSelected("node", n.id)) setSelection("node", n.id);
    render();
    nodeMenu(n, ev.clientX, ev.clientY);
  } else if (edgeEl){
    const e = edgeById(edgeEl.getAttribute("data-edge"));
    setSelection("edge", e.id);
    render();
    edgeMenu(e, ev.clientX, ev.clientY);
  } else {
    canvasMenu(clientToWorld(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
  }
});
window.addEventListener("pointerdown", ev => {
  if (ctxMenu.style.display === "block" && !ctxMenu.contains(ev.target)) hideCtx();
}, true);
window.addEventListener("blur", hideCtx);
board.addEventListener("wheel", hideCtx, { passive:true });

/* --------------------------- Seed data ---------------------------- */
function seed(){
  const N = (o) => { o.id = uid(); state.nodes.push(o); return o.id; };
  const E = (from, to, kind, label, fromField, toField) => {
    const e = {id: uid(), from, to, kind, label: label||""};
    if (fromField) e.fromField = fromField;
    if (toField)   e.toField   = toField;
    state.edges.push(e);
  };

  const strategy = N({type:"concept", x:60,  y:220, title:"Loyalty program launch", notes:"Q3 initiative — north star: repeat purchase rate.", color:"#FFE9A8"});
  const tiers    = N({type:"concept", x:320, y:90,  title:"Tiered rewards", notes:"", color:"#CFE8FF"});
  const referral = N({type:"concept", x:320, y:180, title:"Referral engine", notes:"", color:"#CFE8FF"});
  const measure  = N({type:"concept", x:320, y:350, title:"Measurement plan", notes:"Holdout design + CUPED on pre-period spend.", color:"#D8F3DC"});

  const customers = N({type:"table", x:640, y:60, title:"customers", color:"#16232F", notes:"", fields:[
    {id:"f_cust_pk",   name:"customer_id", type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_cust_email",name:"email",       type:"VARCHAR(255)", pk:false, fk:false, nullable:false},
    {id:"f_cust_tier", name:"tier",        type:"VARCHAR(20)",  pk:false, fk:false, nullable:true},
    {id:"f_cust_join", name:"joined_at",   type:"TIMESTAMP",    pk:false, fk:false, nullable:false}]});
  const orders = N({type:"table", x:980, y:80, title:"orders", color:"#2456E6", notes:"", fields:[
    {id:"f_ord_pk",   name:"order_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_ord_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_ord_total",name:"total",       type:"DECIMAL(12,2)", pk:false, fk:false, nullable:false},
    {id:"f_ord_ts",   name:"placed_at",   type:"TIMESTAMP",     pk:false, fk:false, nullable:false}]});
  const rewards = N({type:"table", x:660, y:330, title:"reward_events", color:"#1E7A4F", notes:"", fields:[
    {id:"f_rw_pk",   name:"event_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_rw_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_rw_pts",  name:"points",      type:"INT",    pk:false, fk:false, nullable:false},
    {id:"f_rw_why",  name:"reason",      type:"VARCHAR(50)", pk:false, fk:false, nullable:true}]});

  E(strategy, tiers,    "link");
  E(strategy, referral, "link");
  E(strategy, measure,  "link");
  E(tiers,    customers,"link", "drives", null, "f_cust_tier");
  E(measure,  rewards,  "link", "sources");
  E(customers, orders,  "1:N", "", "f_cust_pk", "f_ord_cust");
  E(customers, rewards, "1:N", "", "f_cust_pk", "f_rw_cust");
}
function perfSeed(n = 500){
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  clearSelection();
  for (let i = 0; i < n; i++){
    state.nodes.push({ id:uid(), type:"table", x:(i%25)*230, y:Math.floor(i/25)*130,
      title:"bench_" + i, color:TABLE_COLORS[i % TABLE_COLORS.length], notes:"",
      fields:[{id:uid(), name:"id", type:"INT", pk:true, fk:false, nullable:false},
              {id:uid(), name:"value", type:"VARCHAR(255)", pk:false, fk:false, nullable:true}] });
  }
  render();
  fitView();
}

/* ----------------------------- Init ------------------------------- */
buildScaffold();
seed();
ensureFieldIds();
render();
syncHistoryButtons();
updateDocLabel();
syncAriaLabels();
updateDialectControls();
updateSnapControl();
updateAutoSaveControl();
{
  const versionEl = document.getElementById("appVersion");
  if (versionEl){ versionEl.textContent = APP_VERSION; versionEl.title = "Schematic " + APP_VERSION; }
}
showCapabilityBanner();
maybeShowRecovery();
requestAnimationFrame(fitView);
window.addEventListener("resize", () => {/* view persists; nothing needed */});

window.__T = {
  DOC_VERSION,
  FSA,
  RECOVERY,
  get state(){ return state; },
  get doc(){ return doc; },
  serializeDocument,
  migrateDocument,
  importDocText,
  openDoc,
  saveDoc,
  saveAsDoc,
  newDoc,
  pushHistory,
  undo,
  redo,
  setDocDirty,
  generateSQL,
  render,
  nodeRect,
  conceptShape,
  setConceptShape,
  get FLOWCHART_SHAPES(){ return FLOWCHART_SHAPES.map(([id, label]) => ({id, label})); },
  nodeAnchor,
  nodeRows,
  tableMetrics,
  fieldRowCenterY,
  cleanFieldRefs,
  rectsOverlap,
  documentBounds,
  hitTest,
  frameContainedNodes,
  addNode,
  addEdge,
  edgeFieldPairs,
  setEdgePairs,
  edgeEndpoints,
  edgePath,
  lintDocument,
  openLintModal,
  closeLintModal,
  parseDDL,
  importParsedDDL,
  importDDLText,
  generateMermaid,
  generateMarkdownOutline,
  serializedSvg,
  parseCSVLine,
  inferTable,
  importCSVText,
  pinchTransform,
  perfSeed,
  layoutMindMapTree,
  layoutSchemaTables,
  conceptTreeScope,
  schemaDagEdges,
  minimapTransform,
  centerViewOn,
  applyTheme,
  toggleTheme,
  setPngAsShown,
  cloneBoardForPng,
  get docTheme(){ return docTheme; },
  applyDialect,
  setDialect,
  get docDialect(){ return docDialect; },
  get pngAsShown(){ return pngAsShown; },
  get THEME(){ return THEME; },
  get view(){ return view; },
  setView(next){ view = {...view, ...next}; applyView(); },
  get selection(){ return sel ? { kind:sel.kind, ids:[...sel.ids] } : null; },
  setSelection,
  clearSelection,
  selectionIds,
  isSelected,
  selectedNodes,
  get undoDepth(){ return undoStack.length; },
  pushRecentColor,
  mergeRecentColors,
  recordRecentColor,
  get recentColors(){ return recentColors; },
  textW,
  get textMeasureCacheSize(){ return textMeasureCache.size; },
  get renderStats(){ return renderStats; },
  selectNode(id){ setSelection("node", id); render(); },
  cloneSelectionPayload,
  copySelection,
  pasteSelection,
  deleteSelection,
  duplicateSelection,
  alignSelection,
  startInlineEditor,
  closeInlineEditor,
  paletteItems,
  paletteMatches,
  openCommandPalette,
  closeCommandPalette,
  openShortcutModal,
  closeShortcutModal,
  get SHORTCUTS(){ return SHORTCUTS.slice(); }
};
