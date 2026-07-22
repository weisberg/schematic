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
let inlineStatusPicker = null;

const CONCEPT_COLORS = ["#FFE9A8","#CFE8FF","#D8F3DC","#F4D8F0","#FFD9C7","#E4E7EC","#007873","#C20029"];
const TABLE_COLORS   = ["#16232F","#2456E6","#007873","#8A3FA8","#C20029","#6B7683"];
const FONT_COLORS    = ["#16232F","#33475C","#7A8794","#FFFFFF","#2456E6","#C63A3A"];
const FLOWCHART_SHAPES = [
  ["process", "Process"],
  ["rectangle", "Rectangle"],
  ["decision", "Decision"],
  ["terminator", "Terminator"],
  ["data", "Data (input/output)"],
  ["document", "Document"],
  ["manualInput", "Manual input"],
  ["triangle", "Triangle"],
  ["circle", "Circle"],
  ["square", "Square"]
];
const FLOWCHART_SHAPE_SET = new Set(FLOWCHART_SHAPES.map(([id]) => id));
const TEXT_BOX_SHAPES = [["none", "No box (text only)"], ...FLOWCHART_SHAPES];
const TEXT_BOX_SHAPE_SET = new Set(TEXT_BOX_SHAPES.map(([id]) => id));
const WRAPPED_CONCEPT_SHAPES = new Set(["triangle", "circle", "square"]);
const CUSTOM_BOUNDARY_CONCEPT_SHAPES = new Set(["decision", "triangle", "circle"]);
const EDGE_RELATIONSHIPS = [
  ["Contains", "Parent-child structure"],
  ["Depends on", "Execution dependency"],
  ["Blocks", "Prevents progress"],
  ["Supports", "Evidence supports a claim"],
  ["Contradicts", "Evidence challenges a claim"],
  ["Owns", "Person or team is accountable"],
  ["Measures", "KPI evaluates an objective"],
  ["Implements", "Task or project delivers a concept"],
  ["Produces", "Output of one object becomes another"],
  ["Reads from", "Data dependency"],
  ["Writes to", "Data destination"],
  ["Triggers", "Event initiates an action"],
  ["References", "General informational relationship"],
  ["Causes", "Causal influence"],
  ["Calculates", "Formula derives a value"],
  ["Validates", "Experiment tests an assumption"]
];
const EDGE_CUSTOM_RELATIONSHIP = "__custom__";
const CONCEPT_FS_DEFAULT = 14, TABLE_FS_DEFAULT = 11.5;
const NOTE_FS_DEFAULT = 13, NOTE_W_DEFAULT = 300;
const TEXT_FS_DEFAULT = 24, TEXT_W_DEFAULT = 260, TEXT_W_MIN = 32;
const TEXT_H_MIN = 20, TEXT_H_MAX = 4000, TEXT_MARGIN_MAX = 400;
const STATUS_FS_DEFAULT = 18, STATUS_W_DEFAULT = 320;
const STATUS_BUILTINS = [
  ["Not started", "#7A8794"],
  ["In progress", "#2456E6"],
  ["Blocked", "#C20029"],
  ["Completed", "#007873"],
  ["Canceled", "#6B7683"]
];
const STATUS_DEFAULT = STATUS_BUILTINS[0][0];
const STATUS_CUSTOM_COLOR = "#8A3FA8";
const FRAME_DEFAULT = { color:"#2456E6", w:360, h:240 };
const FRAME_BORDER_DEFAULT_WIDTH = 2;
const FRAME_BORDER_MIN_WIDTH = 1;
const FRAME_BORDER_MAX_WIDTH = 16;
const FRAME_COLLAPSED = { w:220, h:48 };
const SWIMLANE_DEFAULT = {
  bodyColor:"#DCEAFE", titleColor:"#2456E6",
  horizontal:{ w:600, h:180, titleSize:48 },
  vertical:{ w:220, h:480, titleSize:48 }
};
const TODO_COLOR_DEFAULT = "#E9E2F8";
const APP_VERSION = "v1.30.0";
const GRID_SNAP = 24;   // matches the dot-grid pattern spacing
const ALIGN_GUIDE_SCREEN_THRESHOLD = 6;
const ALIGN_GUIDE_SCREEN_OVERSHOOT = 24;
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

/* Status labels are diagram-wide document data. Each status node chooses one
   label independently, while a custom label added from any node becomes an
   option on every status node in this diagram. */
let customStatuses = [];
function cleanStatusLabel(raw){
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, 40);
}
function builtInStatus(label){
  const key = cleanStatusLabel(label).toLowerCase();
  const match = STATUS_BUILTINS.find(([name]) => name.toLowerCase() === key);
  return match ? match[0] : null;
}
function customStatus(label){
  const key = cleanStatusLabel(label).toLowerCase();
  return customStatuses.find(name => name.toLowerCase() === key) || null;
}
function setCustomStatuses(raw){
  const next = [];
  for (const value of Array.isArray(raw) ? raw : []){
    const label = cleanStatusLabel(value);
    if (!label || builtInStatus(label) || next.some(name => name.toLowerCase() === label.toLowerCase())) continue;
    next.push(label);
  }
  customStatuses = next;
  return customStatuses;
}
function addCustomStatus(raw){
  const label = cleanStatusLabel(raw);
  if (!label) return null;
  const existing = builtInStatus(label) || customStatus(label);
  if (existing) return existing;
  customStatuses.push(label);
  return label;
}
function statusOptions(){ return [...STATUS_BUILTINS.map(([name]) => name), ...customStatuses]; }
function normalizeNodeStatus(n, addMissingCustom = true){
  if (!n || n.type !== "status") return STATUS_DEFAULT;
  const raw = cleanStatusLabel(n.status);
  let label = builtInStatus(raw) || customStatus(raw);
  if (!label && raw && addMissingCustom) label = addCustomStatus(raw);
  n.status = label || STATUS_DEFAULT;
  n.statusSide = n.statusSide === "left" ? "left" : "right";
  return n.status;
}
function statusColor(label){
  const canonical = builtInStatus(label);
  const match = canonical && STATUS_BUILTINS.find(([name]) => name === canonical);
  return match ? match[1] : STATUS_CUSTOM_COLOR;
}

/* custom color schemes (SCH-064): a document may carry meta.colorScheme, which
   replaces the built-in palettes, node-creation defaults, and (optionally) THEME
   colors while that document is open. All keys are optional and validated on load;
   the built-in constants above remain the fallback at every use site. */
let colorScheme = null;
const SCHEME_PALETTE_MAX = 12;
function conceptColors(){ return (colorScheme && colorScheme.concept) || CONCEPT_COLORS; }
function tableColors(){ return (colorScheme && colorScheme.table) || TABLE_COLORS; }
function fontColors(){ return (colorScheme && colorScheme.font) || FONT_COLORS; }
function frameColorDefault(){ return (colorScheme && colorScheme.frame) || FRAME_DEFAULT.color; }
function todoColorDefault(){ return (colorScheme && colorScheme.todo) || TODO_COLOR_DEFAULT; }
function frameBorderEnabled(n){ return !!n && n.type === "frame" && n.borderEnabled === true; }
function frameBorderWidth(n){
  const width = n ? Number(n.borderWidth) : NaN;
  return Number.isFinite(width)
    ? clampSize(width, FRAME_BORDER_MIN_WIDTH, FRAME_BORDER_MAX_WIDTH)
    : FRAME_BORDER_DEFAULT_WIDTH;
}
function frameBorderColor(n){
  return normalizeColorValue(n && n.borderColor) ||
    normalizeColorValue(n && n.color) || frameColorDefault();
}
function setFrameBorderEnabled(n, enabled){
  if (!n || n.type !== "frame") return false;
  if (enabled === true) n.borderEnabled = true; else delete n.borderEnabled;
  return true;
}
function setFrameBorderWidth(n, width){
  if (!n || n.type !== "frame") return false;
  const next = clampSize(width, FRAME_BORDER_MIN_WIDTH, FRAME_BORDER_MAX_WIDTH);
  if (next === FRAME_BORDER_DEFAULT_WIDTH) delete n.borderWidth; else n.borderWidth = next;
  return true;
}
function isStructuralNode(n){ return !!n && (n.type === "frame" || n.type === "swimlane"); }
function manualNodeWidth(n){
  const width = n ? parseFloat(n.w) : NaN;
  if (!n || n.manualWidth !== true || !Number.isFinite(width)) return null;
  return clampSize(width, n.type === "text" ? TEXT_W_MIN : 80, 4000);
}
function configuredNodeWidth(n){
  const width = n ? parseFloat(n.w) : NaN;
  if (!n || !Number.isFinite(width)) return null;
  if (n.type === "text") return clampSize(width, 80, 720);
  if (n.type === "status") return clampSize(width, 180, 720);
  if (n.type === "note") return clampSize(width, 220, 720);
  if (n.type === "frame") return clampSize(width, 120, 4000);
  if (n.type === "swimlane"){
    return clampSize(width, swimlaneOrientation(n) === "vertical" ? 120 : 260, 4000);
  }
  return null;
}
function setNodeWidth(n, width){
  if (!n) return false;
  if (manualNodeWidth(n) == null){
    const configured = configuredNodeWidth(n);
    if (configured == null) delete n.widthBeforeMatch;
    else n.widthBeforeMatch = configured;
  }
  n.w = clampSize(width, n.type === "text" ? TEXT_W_MIN : 80, 4000);
  n.manualWidth = true;
  return true;
}
function resetNodeWidth(n){
  if (manualNodeWidth(n) == null) return false;
  const previous = parseFloat(n.widthBeforeMatch);
  delete n.manualWidth;
  delete n.widthBeforeMatch;
  if (Number.isFinite(previous) && configuredNodeWidth({...n, w:previous}) != null){
    n.w = configuredNodeWidth({...n, w:previous});
  } else if (n.type === "text"){
    n.w = TEXT_W_DEFAULT;
  } else if (n.type === "status"){
    n.w = STATUS_W_DEFAULT;
  } else if (n.type === "note"){
    n.w = NOTE_W_DEFAULT;
  } else if (n.type === "frame"){
    n.w = FRAME_DEFAULT.w;
  } else if (n.type === "swimlane"){
    n.w = swimlaneDefaults(n).w;
  } else {
    delete n.w;
  }
  return true;
}
const TEXT_MARGIN_FIELDS = {
  top:"textMarginTop", right:"textMarginRight",
  bottom:"textMarginBottom", left:"textMarginLeft"
};
function textBoxWrapEnabled(n){ return !n || n.type !== "text" || n.wrapText !== false; }
function setTextBoxWrapping(n, enabled){
  if (!n || n.type !== "text") return false;
  if (enabled === false) n.wrapText = false; else delete n.wrapText;
  return true;
}
function textBoxMargin(n, side){
  const key = TEXT_MARGIN_FIELDS[side];
  const value = key && n ? Number(n[key]) : NaN;
  return Number.isFinite(value) ? clampSize(value, 0, TEXT_MARGIN_MAX) : 0;
}
function textBoxMargins(n){
  return {
    top:textBoxMargin(n, "top"), right:textBoxMargin(n, "right"),
    bottom:textBoxMargin(n, "bottom"), left:textBoxMargin(n, "left")
  };
}
function setTextBoxMargin(n, side, value){
  const key = TEXT_MARGIN_FIELDS[side];
  if (!n || n.type !== "text" || !key) return false;
  const next = clampSize(value, 0, TEXT_MARGIN_MAX);
  if (next === 0) delete n[key]; else n[key] = next;
  return true;
}
function manualNodeHeight(n){
  const height = n ? Number(n.h) : NaN;
  if (!n || n.type !== "text" || n.manualHeight !== true || !Number.isFinite(height)) return null;
  return clampSize(height, TEXT_H_MIN, TEXT_H_MAX);
}
function setTextBoxHeight(n, height){
  if (!n || n.type !== "text") return false;
  n.h = clampSize(height, TEXT_H_MIN, TEXT_H_MAX);
  n.manualHeight = true;
  return true;
}
function resetTextBoxHeight(n){
  if (manualNodeHeight(n) == null) return false;
  delete n.manualHeight;
  delete n.h;
  return true;
}
function hasForcedNodeSize(n){
  return manualNodeWidth(n) != null || manualNodeHeight(n) != null;
}
function nodeTitleSupportsLineBreaks(n){ return !!n && (n.type === "concept" || n.type === "text" || n.type === "status"); }
function insertTextLineBreak(control){
  const start = Number.isInteger(control.selectionStart) ? control.selectionStart : control.value.length;
  const end = Number.isInteger(control.selectionEnd) ? control.selectionEnd : start;
  control.setRangeText("\n", start, end, "end");
  control.dispatchEvent(new Event("input", {bubbles:true}));
}
function swimlaneOrientation(n){ return n && n.orientation === "vertical" ? "vertical" : "horizontal"; }
function swimlaneDefaults(n){ return SWIMLANE_DEFAULT[swimlaneOrientation(n)]; }
function setSwimlaneOrientation(n, orientation){
  if (!n || n.type !== "swimlane") return false;
  const next = orientation === "vertical" ? "vertical" : "horizontal";
  if (next === swimlaneOrientation(n)) return false;
  n.orientation = next;
  const oldW = n.w, oldH = n.h;
  n.w = oldH; n.h = oldW;
  return true;
}
function normalizeColorScheme(raw){
  if (!raw || typeof raw !== "object") return null;
  const color = c => typeof c === "string" ? normalizeColorValue(c) : null;
  const opaque = c => typeof c === "string" ? normalizeHex(c) : null;  // document JSON is untrusted
  const out = {};
  if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim().slice(0, 60);
  for (const key of ["concept","table","font"]){
    if (!Array.isArray(raw[key])) continue;
    const colors = [];
    for (const c of raw[key]){
      const n = color(c);
      if (n && !colors.includes(n)) colors.push(n);
      if (colors.length >= SCHEME_PALETTE_MAX) break;
    }
    if (colors.length) out[key] = colors;
  }
  for (const key of ["frame","todo"]){
    const n = color(raw[key]);
    if (n) out[key] = n;
  }
  if (raw.theme && typeof raw.theme === "object"){
    const theme = {};
    for (const mode of ["light","dark"]){
      const src = raw.theme[mode];
      if (!src || typeof src !== "object") continue;
      const dst = {};
      for (const k of Object.keys(THEME.light)){
        const n = opaque(src[k]);
        if (n) dst[k] = n;
      }
      if (Object.keys(dst).length) theme[mode] = dst;
    }
    if (Object.keys(theme).length) out.theme = theme;
  }
  return Object.keys(out).length ? out : null;
}
function cloneColorScheme(s){ return s ? JSON.parse(JSON.stringify(s)) : null; }
function applyColorScheme(next){
  colorScheme = normalizeColorScheme(next);
  presetColorSet = computePresetColorSet();
  rebuildActiveThemes();
  updateSchemeCssVars();
  return colorScheme;
}

let pngAsShown = false;
let snapToGrid = false;
let spaceHeld = false;
let autoSave = false, autoSaveTimer = null;
/* inspector visibility (SCH-066): pinned = always visible (default);
   unpinned = auto — appears with a selection, hides without one.
   UI preference, not document data: mirrored to localStorage when available. */
const INSPECTOR_KEY = "schematic.inspectorPinned";
function loadInspectorPref(){
  if (!RECOVERY) return true;
  try { return localStorage.getItem(INSPECTOR_KEY) !== "0"; } catch { return true; }
}
let inspectorPinned = loadInspectorPref();
function updateInspectorVisibility(){
  const aside = document.getElementById("inspector");
  if (aside) aside.hidden = !inspectorPinned && !sel;
  const b = document.getElementById("btnInspector");
  if (b){
    b.setAttribute("aria-pressed", String(inspectorPinned));
    b.title = inspectorPinned
      ? "Auto-hide the inspector when nothing is selected (I)"
      : "Keep the inspector always visible (I)";
  }
}
function toggleInspector(){
  inspectorPinned = !inspectorPinned;
  if (RECOVERY){ try { localStorage.setItem(INSPECTOR_KEY, inspectorPinned ? "1" : "0"); } catch {} }
  updateInspectorVisibility();
  announce(inspectorPinned ? "Inspector pinned visible" : "Inspector auto-hides without a selection");
}
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
  { id:"text", keys:"X", title:"Add plain text" },
  { id:"status", keys:"S", title:"Add status node" },
  { id:"note", keys:"N", title:"Add rich note" },
  { id:"table", keys:"T", title:"Add table" },
  { id:"todo", keys:"D", title:"Add to-do list" },
  { id:"child", keys:"Tab", title:"Add linked child concept" },
  { id:"delete", keys:"Delete/Backspace", title:"Delete selection" },
  { id:"fit", keys:"F", title:"Fit diagram" },
  { id:"inspector", keys:"I", title:"Show or hide the inspector" },
  { id:"escape", keys:"Esc", title:"Close menu or clear selection" },
  { id:"nudge", keys:"Arrow keys", title:"Nudge selected nodes" },
  { id:"nudgeLarge", keys:"Shift+Arrow keys", title:"Nudge selected nodes by 24px" },
  { id:"spacePan", keys:"Space+drag", title:"Pan the canvas" }
];

/* recent custom colors (SCH-017): live in the document (meta.recentColors) and are
   mirrored to localStorage when available (RECOVERY doubles as the feature detect) */
const RECENT_COLORS_KEY = "schematic.recentColors";
const RECENT_COLORS_MAX = 8;
/* recomputed whenever a color scheme is applied, so scheme swatches don't
   duplicate into the recent row */
function computePresetColorSet(){
  return new Set(
    [...conceptColors(), ...tableColors(), ...fontColors()].map(c => c.toLowerCase()));
}
let presetColorSet = computePresetColorSet();
function pushRecentColor(list, hex){
  const n = normalizeColorValue(hex);
  if (!n || presetColorSet.has(n)) return list;
  return [n, ...list.filter(c => c !== n)].slice(0, RECENT_COLORS_MAX);
}
/* dedupe + normalize both lists into one; docList wins on order */
function mergeRecentColors(docList, storedList){
  const merged = [];
  for (const c of [...(docList || []), ...(storedList || [])]){
    const n = normalizeColorValue(c);
    if (!n || presetColorSet.has(n) || merged.includes(n)) continue;
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
function clearRecentColors(){
  if (!recentColors.length) return false;
  recentColors = [];
  persistRecentColors();
  return true;
}
let recentColors = loadStoredRecentColors();

/* built-in THEME merged with the active scheme's theme overrides (if any) */
let activeThemes = { light: THEME.light, dark: THEME.dark };
function rebuildActiveThemes(){
  activeThemes = {};
  for (const mode of ["light","dark"]){
    const over = colorScheme && colorScheme.theme && colorScheme.theme[mode];
    activeThemes[mode] = over ? { ...THEME[mode], ...over } : THEME[mode];
  }
}
function themeColors(name = docTheme){
  return activeThemes[name] || activeThemes.light;
}
/* readable ink for text drawn on an arbitrary node fill (SCH-065). The choice is
   independent of the app theme — it contrasts against the node's own color — so
   dark fills take the light table-header text and light fills take the light-theme
   ink. The cutoff is the WCAG relative-luminance point where white text starts
   winning the contrast ratio over black (L ≈ 0.179). */
function relativeLuminance(hex){
  const c = i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126*c(1) + 0.7152*c(3) + 0.0722*c(5);
}
function autoInk(bg, t = themeColors()){
  const n = normalizeHex(bg);
  if (!n) return t.ink;
  return relativeLuminance(n) < 0.1791 ? THEME.light.tableText : THEME.light.ink;
}
/* mirror scheme theme overrides onto the CSS custom properties that style the
   app chrome (toolbar, inspector, menus), so the whole UI follows the scheme */
const SCHEME_CSS_VARS = { paper:"--paper", panel:"--panel", control:"--control",
                          ink:"--ink", ink2:"--ink-2", muted:"--muted", accent:"--accent" };
function updateSchemeCssVars(){
  const rootStyle = document.documentElement.style;
  const over = (colorScheme && colorScheme.theme &&
                colorScheme.theme[docTheme === "dark" ? "dark" : "light"]) || {};
  for (const key in SCHEME_CSS_VARS){
    if (over[key]) rootStyle.setProperty(SCHEME_CSS_VARS[key], over[key]);
    else rootStyle.removeProperty(SCHEME_CSS_VARS[key]);
  }
}
function updateThemeControls(){
  document.documentElement.dataset.theme = docTheme;
  updateSchemeCssVars();
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
function linkOnlyNode(n){ return !!n && (n.type === "todo" || n.type === "note" || n.type === "text" || n.type === "status"); }
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
function visualNodeShape(n){
  if (n && n.type === "concept") return conceptShape(n);
  if (n && n.type === "text") return textBoxShape(n);
  return null;
}
function nodeContainsPoint(n, r, point){
  const shape = visualNodeShape(n);
  if (!shape || shape === "none") return true;
  const x = point.x - r.x, y = point.y - r.y;
  if (shape === "circle"){
    const dx = (x - r.w/2) / (r.w/2), dy = (y - r.h/2) / (r.h/2);
    return dx*dx + dy*dy <= 1;
  }
  if (shape === "triangle"){
    if (y < 0 || y > r.h) return false;
    const halfWidth = (y / r.h) * (r.w/2);
    return x >= r.w/2 - halfWidth && x <= r.w/2 + halfWidth;
  }
  return true;
}
function conceptContainsPoint(n, r, point){
  return !n || n.type !== "concept" ? true : nodeContainsPoint(n, r, point);
}
/* topmost node (and row, for tables/todos) under a world point */
function hitTest(w){
  const hidden = collapsedFrameHiddenNodeIds();
  for (let i = state.nodes.length - 1; i >= 0; i--){
    const n = state.nodes[i], r = nodeRect(n);
    if (isStructuralNode(n) || hidden.has(n.id)) continue;
    if (w.x < r.x || w.x > r.x + r.w || w.y < r.y || w.y > r.y + r.h) continue;
    if (!nodeContainsPoint(n, r, w)) continue;
    let field = null;
    const rows = n.collapsed ? null : nodeRows(n);
    if (rows && rows.length){
      const m = tableMetrics(n);
      if (w.y > r.y + m.headerH){
        const idx = Math.floor((w.y - r.y - m.headerH) / m.rowH);
        if (idx >= 0 && idx < rows.length) field = rows[idx];
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
function snapshot(){ return JSON.stringify({nodes:state.nodes, edges:state.edges, nextId:state.nextId, meta:{theme:docTheme, dialect:docDialect, colorScheme, customStatuses}}); }
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
  setCustomStatuses(s.meta ? s.meta.customStatuses : []);
  for (const n of state.nodes) if (n && n.type === "status") normalizeNodeStatus(n);
  applyColorScheme(s.meta ? s.meta.colorScheme : null);
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
  const menuUndo = document.getElementById("menuUndo");
  const menuRedo = document.getElementById("menuRedo");
  if (menuUndo) menuUndo.disabled = !undoStack.length;
  if (menuRedo) menuRedo.disabled = !redoStack.length;
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
  for (const key of ["orthoX", "orthoY"]){
    const value = Number(out[key]);
    if (Number.isFinite(value)) out[key] = value;
    else delete out[key];
  }
  setEdgeLabelPosition(out, out.labelPosition);
  if (out.startArrow !== true) delete out.startArrow;
  if (out.endArrow !== true) delete out.endArrow;
  const lineColor = normalizeColorValue(out.lineColor);
  if (lineColor) out.lineColor = lineColor; else delete out.lineColor;
  for (const key of ["labelTextColor", "labelBackgroundColor"]){
    const color = normalizeColorValue(out[key]);
    if (color) out[key] = color; else delete out[key];
  }
  const lineWidth = edgeLineWidth(out);
  if (lineWidth === 1.7) delete out.lineWidth; else out.lineWidth = lineWidth;
  if (!["solid","dash","dot"].includes(out.lineStyle) ||
      out.lineStyle === (out.kind === "link" ? "dash" : "solid")) delete out.lineStyle;
  return out;
}
function cleanNodeForDocument(n){
  const out = {...n};
  if (Array.isArray(out.fields)) out.fields = out.fields.map(cleanFieldForDocument);
  if (manualNodeWidth(out) != null){
    out.w = manualNodeWidth(out);
    const previous = configuredNodeWidth({...out, w:out.widthBeforeMatch});
    if (previous == null) delete out.widthBeforeMatch;
    else out.widthBeforeMatch = previous;
  }
  else {
    delete out.manualWidth;
    delete out.widthBeforeMatch;
    if (out.type === "concept" || out.type === "table" || out.type === "todo") delete out.w;
  }
  if (out.type === "swimlane"){
    out.orientation = swimlaneOrientation(out);
    out.color = normalizeColorValue(out.color) || SWIMLANE_DEFAULT.bodyColor;
    out.titleColor = normalizeColorValue(out.titleColor) || SWIMLANE_DEFAULT.titleColor;
  }
  if (out.type === "frame"){
    out.title = typeof out.title === "string" && out.title.trim() ? out.title : "Subject area";
    out.color = normalizeColorValue(out.color) || frameColorDefault();
    out.w = clampSize(Number(out.w) || FRAME_DEFAULT.w, 120, 4000);
    out.h = clampSize(Number(out.h) || FRAME_DEFAULT.h, 90, 4000);
    if (out.collapsed !== true) delete out.collapsed;
    if (out.borderEnabled !== true) delete out.borderEnabled;
    const borderWidth = frameBorderWidth(out);
    if (borderWidth === FRAME_BORDER_DEFAULT_WIDTH) delete out.borderWidth;
    else out.borderWidth = borderWidth;
    const borderColor = normalizeColorValue(out.borderColor);
    if (borderColor) out.borderColor = borderColor; else delete out.borderColor;
  }
  if (out.type === "text"){
    const shape = textBoxShape(out);
    if (shape === "none") delete out.shape; else out.shape = shape;
    out.color = normalizeColorValue(out.color) || CONCEPT_COLORS[1];
    const fontColor = normalizeColorValue(out.fontColor);
    if (fontColor) out.fontColor = fontColor; else delete out.fontColor;
    out.fontSize = textBoxFont(out);
    out.w = out.manualWidth === true
      ? clampSize(out.w, TEXT_W_MIN, 4000)
      : clampSize(out.w || TEXT_W_DEFAULT, 80, 720);
    if (out.wrapText !== false) delete out.wrapText;
    for (const side of Object.keys(TEXT_MARGIN_FIELDS)){
      const key = TEXT_MARGIN_FIELDS[side];
      const value = textBoxMargin(out, side);
      if (value === 0) delete out[key]; else out[key] = value;
    }
    const height = manualNodeHeight(out);
    if (height == null){ delete out.manualHeight; delete out.h; }
    else { out.manualHeight = true; out.h = height; }
  }
  if (out.type === "status"){
    normalizeNodeStatus(out);
    out.color = normalizeColorValue(out.color) || CONCEPT_COLORS[1];
    const fontColor = normalizeColorValue(out.fontColor);
    if (fontColor) out.fontColor = fontColor; else delete out.fontColor;
    out.fontSize = statusNodeFont(out);
    out.w = out.manualWidth === true
      ? clampSize(out.w, 80, 4000)
      : clampSize(out.w || STATUS_W_DEFAULT, 180, 720);
  }
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
  if (colorScheme) meta.colorScheme = cloneColorScheme(colorScheme);
  if (customStatuses.length) meta.customStatuses = customStatuses.slice();
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
  setCustomStatuses(migrated.meta ? migrated.meta.customStatuses : []);
  for (const n of state.nodes){
    if (!n) continue;
    const fixedWidth = manualNodeWidth(n);
    if (fixedWidth != null){
      n.w = fixedWidth;
      const previous = configuredNodeWidth({...n, w:n.widthBeforeMatch});
      if (previous == null) delete n.widthBeforeMatch;
      else n.widthBeforeMatch = previous;
    }
    else {
      delete n.manualWidth;
      delete n.widthBeforeMatch;
      if (n.type === "concept" || n.type === "table" || n.type === "todo") delete n.w;
    }
    if (n.type === "swimlane"){
      n.orientation = swimlaneOrientation(n);
      const defaults = swimlaneDefaults(n);
      n.title = typeof n.title === "string" && n.title.trim() ? n.title : "Lane";
      n.color = normalizeColorValue(n.color) || SWIMLANE_DEFAULT.bodyColor;
      n.titleColor = normalizeColorValue(n.titleColor) || SWIMLANE_DEFAULT.titleColor;
      n.w = n.manualWidth === true
        ? clampSize(n.w, 80, 4000)
        : clampSize(Number(n.w) || defaults.w, n.orientation === "vertical" ? 120 : 260, 4000);
      n.h = clampSize(Number(n.h) || defaults.h, n.orientation === "vertical" ? 260 : 100, 4000);
    } else if (n.type === "frame"){
      n.title = typeof n.title === "string" && n.title.trim() ? n.title : "Subject area";
      n.color = normalizeColorValue(n.color) || frameColorDefault();
      n.w = clampSize(Number(n.w) || FRAME_DEFAULT.w, 120, 4000);
      n.h = clampSize(Number(n.h) || FRAME_DEFAULT.h, 90, 4000);
      if (n.collapsed !== true) delete n.collapsed;
      if (n.borderEnabled !== true) delete n.borderEnabled;
      setFrameBorderWidth(n, frameBorderWidth(n));
      const borderColor = normalizeColorValue(n.borderColor);
      if (borderColor) n.borderColor = borderColor; else delete n.borderColor;
    } else if (n.type === "text"){
      n.title = typeof n.title === "string" && n.title.trim() ? n.title : "Text";
      setTextBoxShape(n, n.shape);
      n.color = normalizeColorValue(n.color) || CONCEPT_COLORS[1];
      const fontColor = normalizeColorValue(n.fontColor);
      if (fontColor) n.fontColor = fontColor; else delete n.fontColor;
      n.fontSize = textBoxFont(n);
      n.w = n.manualWidth === true
        ? clampSize(n.w, TEXT_W_MIN, 4000)
        : clampSize(Number(n.w) || TEXT_W_DEFAULT, 80, 720);
      if (n.wrapText !== false) delete n.wrapText;
      for (const side of Object.keys(TEXT_MARGIN_FIELDS)) setTextBoxMargin(n, side, textBoxMargin(n, side));
      const height = manualNodeHeight(n);
      if (height == null){ delete n.manualHeight; delete n.h; }
      else { n.manualHeight = true; n.h = height; }
    } else if (n.type === "status"){
      n.title = typeof n.title === "string" && n.title.trim() ? n.title : "Status item";
      normalizeNodeStatus(n);
      n.color = normalizeColorValue(n.color) || CONCEPT_COLORS[1];
      const fontColor = normalizeColorValue(n.fontColor);
      if (fontColor) n.fontColor = fontColor; else delete n.fontColor;
      n.fontSize = statusNodeFont(n);
      n.w = n.manualWidth === true
        ? clampSize(n.w, 80, 4000)
        : clampSize(Number(n.w) || STATUS_W_DEFAULT, 180, 720);
    }
  }
  for (const e of state.edges){
    for (const key of ["orthoX", "orthoY"]){
      const value = Number(e[key]);
      if (Number.isFinite(value)) e[key] = value;
      else delete e[key];
    }
    for (const key of ["lineColor", "labelTextColor", "labelBackgroundColor"]){
      const color = normalizeColorValue(e[key]);
      if (color) e[key] = color; else delete e[key];
    }
    setEdgeLabelPosition(e, e.labelPosition);
  }
  state.nextId = migrated.nextId;
  ensureFieldIds();
  applyColorScheme(migrated.meta ? migrated.meta.colorScheme : null);
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
/* toolbar dropdown menus (SCH-065): disclosure pattern — trigger toggles its panel,
   only one panel open at a time, outside pointer / Escape / item click all close.
   The buttons inside panels keep their historical ids and handlers. */
function setupMenus(){
  const menus = [...document.querySelectorAll("header .menu")];
  if (!menus.length) return;
  const anyOpen = () => menus.some(m => m.classList.contains("open"));
  const closeAll = () => {
    for (const m of menus){
      m.classList.remove("open");
      const b = m.querySelector(".menubtn");
      if (b) b.setAttribute("aria-expanded", "false");
      for (const submenu of m.querySelectorAll(".menusubmenu[open]")) submenu.open = false;
    }
  };
  const open = m => {
    closeAll();
    m.classList.add("open");
    const b = m.querySelector(".menubtn");
    if (b) b.setAttribute("aria-expanded", "true");
  };
  for (const m of menus){
    const btn = m.querySelector(".menubtn");
    const panel = m.querySelector(".menupanel");
    if (!btn || !panel) continue;
    panel.setAttribute("role", "menu");
    for (const command of panel.querySelectorAll(":scope > button, .menusubbody > button")){
      command.classList.add("menucommand");
      command.setAttribute("role", "menuitem");
    }
    for (const submenu of panel.querySelectorAll(".menusubmenu")){
      const summary = submenu.querySelector(":scope > summary");
      if (!summary) continue;
      summary.setAttribute("role", "menuitem");
      summary.setAttribute("aria-haspopup", "true");
      summary.setAttribute("aria-expanded", String(submenu.open));
      if (!summary.querySelector(".disclosure-chevron")) summary.appendChild(disclosureChevron());
      submenu.addEventListener("toggle", () => {
        summary.setAttribute("aria-expanded", String(submenu.open));
        if (!submenu.open) return;
        for (const sibling of submenu.parentElement.children){
          if (sibling !== submenu && sibling.classList && sibling.classList.contains("menusubmenu")) sibling.open = false;
        }
      });
    }
    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      m.classList.contains("open") ? closeAll() : open(m);
    });
    /* sliding across triggers while a menu is open switches panels, like a native menubar */
    btn.addEventListener("pointerenter", () => {
      if (anyOpen() && !m.classList.contains("open")) open(m);
    });
    panel.addEventListener("click", ev => {
      const command = ev.target.closest && ev.target.closest(".menucommand");
      if (command && !command.disabled && !command.hasAttribute("data-menu-stay-open")) closeAll();
    });
  }
  document.addEventListener("pointerdown", ev => {
    if (anyOpen() && !(ev.target.closest && ev.target.closest("header .menu"))) closeAll();
  });
  /* capture phase so an open menu swallows Escape before the canvas shortcut
     handler on window clears the selection */
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && anyOpen()){
      ev.stopPropagation();
      closeAll();
    }
  }, true);
}
function updateAlignMenu(){
  if (typeof updateDropdownMenus === "function") updateDropdownMenus();
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
