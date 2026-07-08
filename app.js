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
let sel   = null;                             // {kind:'node'|'edge', id}
let doc   = { handle: null, name: "untitled.schematic.json", dirty: false };
let undoStack = [], redoStack = [];
const MAX_HISTORY = 100;
let recoveryTimer = null;

const CONCEPT_COLORS = ["#FFE9A8","#CFE8FF","#D8F3DC","#F4D8F0","#FFD9C7","#E4E7EC"];
const TABLE_COLORS   = ["#16232F","#2456E6","#1E7A4F","#8A3FA8","#B4550F","#6B7683"];
const FONT_COLORS    = ["#16232F","#33475C","#7A8794","#FFFFFF","#2456E6","#C63A3A"];
const CONCEPT_FS_DEFAULT = 14, TABLE_FS_DEFAULT = 11.5;
const SQL_TYPES = ["INT","BIGINT","SERIAL","VARCHAR(255)","TEXT","BOOLEAN","DATE",
                   "TIMESTAMP","DECIMAL(12,2)","NUMERIC","FLOAT","UUID","JSONB"];

const uid = () => "n" + (state.nextId++);
const nodeById = id => state.nodes.find(n => n.id === id);
const edgeById = id => state.edges.find(e => e.id === id);

/* field-level references: edges may carry fromField / toField (field ids) */
function ensureFieldIds(){
  for (const n of state.nodes)
    if (n.fields) for (const f of n.fields) if (!f.id) f.id = uid();
}
function cleanFieldRefs(fid){
  for (const e of state.edges){
    if (e.fromField === fid) delete e.fromField;
    if (e.toField === fid) delete e.toField;
  }
}
/* topmost node (and field row, for tables) under a world point */
function hitTest(w){
  for (let i = state.nodes.length - 1; i >= 0; i--){
    const n = state.nodes[i], r = nodeRect(n);
    if (w.x < r.x || w.x > r.x + r.w || w.y < r.y || w.y > r.y + r.h) continue;
    let field = null;
    if (n.type === "table" && n.fields.length){
      const m = tableMetrics(n);
      if (w.y > r.y + m.headerH){
        const idx = Math.min(n.fields.length - 1, Math.floor((w.y - r.y - m.headerH) / m.rowH));
        if (idx >= 0) field = n.fields[idx];
      }
    }
    return { node: n, field };
  }
  return null;
}

/* text measurement */
const meas = document.createElement("canvas").getContext("2d");
function textW(str, font){ meas.font = font; return meas.measureText(str).width; }

/* --------------------------- History ------------------------------ */
function snapshot(){ return JSON.stringify({nodes:state.nodes, edges:state.edges, nextId:state.nextId}); }
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
  if (sel && sel.kind === "node" && !nodeById(sel.id)) sel = null;
  if (sel && sel.kind === "edge" && !edgeById(sel.id)) sel = null;
  render();
}
function undo(){ if(!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); setDocDirty(true); syncHistoryButtons(); }
function redo(){ if(!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); setDocDirty(true); syncHistoryButtons(); }
function syncHistoryButtons(){
  document.getElementById("btnUndo").disabled = !undoStack.length;
  document.getElementById("btnRedo").disabled = !redoStack.length;
}

function documentObject(){
  return { version:DOC_VERSION, nodes:state.nodes, edges:state.edges, nextId:state.nextId };
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
  return { version:DOC_VERSION, nodes:out.nodes, edges:out.edges, nextId:nextIdFromDocument(out) };
}
function applyDocument(d, opts = {}){
  const migrated = migrateDocument(d);
  state.nodes = migrated.nodes;
  state.edges = migrated.edges;
  state.nextId = migrated.nextId;
  ensureFieldIds();
  sel = null;
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
  if (dirty) scheduleRecoverySave();
  else clearRecoverySave();
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
  if (n.type === "concept"){
    const fs = conceptFont(n);
    const w = Math.max(130, textW(n.title || "Untitled", `600 ${fs}px Archivo, sans-serif`) + 44);
    const h = Math.max(40, Math.round(fs * 2.2 + 17.2));
    return { w: Math.min(w, 420), h };
  }
  // table node
  const m = tableMetrics(n);
  const headW = textW(n.title || "table", `700 ${m.headerSize}px Archivo, sans-serif`) + 56;
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

let world, edgeLayer, nodeLayer, draftLayer;

function buildScaffold(){
  board.innerHTML = "";
  const defs = el("defs", {}, board);
  const pat = el("pattern", {id:"dots", width:24, height:24, patternUnits:"userSpaceOnUse"}, defs);
  el("circle", {cx:1.2, cy:1.2, r:1.2, fill:"#C9D2DB"}, pat);

  world = el("g", {id:"world"}, board);
  el("rect", {x:-50000, y:-50000, width:100000, height:100000, fill:"url(#dots)",
              "data-bg":"1"}, world);
  edgeLayer  = el("g", {}, world);
  nodeLayer  = el("g", {}, world);
  draftLayer = el("g", {}, world);
  applyView();
}
function applyView(){
  world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
  document.getElementById("zoomLabel").textContent = Math.round(view.k*100) + "%";
}

function render(){
  edgeLayer.innerHTML = "";
  nodeLayer.innerHTML = "";
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) drawNode(n);
  document.getElementById("countLabel").textContent =
    `${state.nodes.length} nodes · ${state.edges.length} edges`;
  renderInspector();
}

/* ---- edges ---- */
function fieldRowCenterY(n, idx){ const m = tableMetrics(n); return nodeRect(n).y + m.headerH + idx*m.rowH + m.rowH/2; }
function fieldAnchor(n, idx, towardX){
  const r = nodeRect(n);
  const side = towardX >= r.cx ? "e" : "w";
  return { x: side === "e" ? r.x + r.w : r.x, y: fieldRowCenterY(n, idx), side };
}
function edgeEndpoints(e){
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return null;
  const ra = nodeRect(a), rb = nodeRect(b);
  const ia = (e.fromField && a.type === "table") ? a.fields.findIndex(f => f.id === e.fromField) : -1;
  const ib = (e.toField   && b.type === "table") ? b.fields.findIndex(f => f.id === e.toField)   : -1;
  /* reference points: bound field row centers, else node centers */
  const refA = ia >= 0 ? { x: ra.cx, y: fieldRowCenterY(a, ia) } : { x: ra.cx, y: ra.cy };
  const refB = ib >= 0 ? { x: rb.cx, y: fieldRowCenterY(b, ib) } : { x: rb.cx, y: rb.cy };
  const pa = ia >= 0 ? fieldAnchor(a, ia, refB.x) : anchorOnRect(ra, refB.x, refB.y);
  const pb = ib >= 0 ? fieldAnchor(b, ib, refA.x) : anchorOnRect(rb, refA.x, refA.y);
  return { pa, pb, boundA: ia >= 0, boundB: ib >= 0 };
}
function edgePath(pa, pb){
  const dx = Math.max(40, Math.abs(pb.x - pa.x) * 0.45);
  const dy = Math.max(40, Math.abs(pb.y - pa.y) * 0.45);
  const c = p => p.side === "e" ? [p.x + dx, p.y] : p.side === "w" ? [p.x - dx, p.y]
            : p.side === "s" ? [p.x, p.y + dy] : [p.x, p.y - dy];
  const [c1x, c1y] = c(pa), [c2x, c2y] = c(pb);
  return `M ${pa.x} ${pa.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pb.x} ${pb.y}`;
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
  const selected = sel && sel.kind === "edge" && sel.id === e.id;
  const isLink = e.kind === "link";
  const color = selected ? "#2456E6" : (isLink ? "#98A5B3" : "#33475C");
  const g = el("g", {"data-edge": e.id, cursor:"pointer"}, edgeLayer);
  const d = edgePath(ep.pa, ep.pb);
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
  if (ep.boundA) el("circle", {cx:ep.pa.x, cy:ep.pa.y, r:3, fill:color}, g);
  if (ep.boundB) el("circle", {cx:ep.pb.x, cy:ep.pb.y, r:3, fill:color}, g);
  const label = e.label || (isLink ? "" : e.kind);
  if (label){
    const mx = (ep.pa.x + ep.pb.x)/2, my = (ep.pa.y + ep.pb.y)/2;
    const w = textW(label, "600 10.5px 'IBM Plex Mono', monospace") + 14;
    el("rect", {x:mx - w/2, y:my - 10, width:w, height:20, rx:10,
                fill:"#EEF1F4", stroke:color, "stroke-width":1}, g);
    el("text", {x:mx, y:my + 3.5, "text-anchor":"middle", fill:color,
                "font-family":"'IBM Plex Mono', monospace", "font-size":10.5,
                "font-weight":600}, g).textContent = label;
  }
}

/* ---- nodes ---- */
function drawNode(n){
  const r = nodeRect(n);
  const selected = sel && sel.kind === "node" && sel.id === n.id;
  const g = el("g", {"data-node": n.id, transform:`translate(${r.x},${r.y})`, cursor:"grab"}, nodeLayer);

  if (n.type === "concept"){
    const fs = conceptFont(n);
    const fc = n.fontColor || "#16232F";
    el("rect", {width:r.w, height:r.h, rx:14, fill:n.color || CONCEPT_COLORS[0],
                stroke: selected ? "#2456E6" : "#16232F",
                "stroke-width": selected ? 2.2 : 1.2}, g);
    const t = el("text", {x:r.w/2, y:r.h/2 + fs*0.35, "text-anchor":"middle", fill:fc,
                "font-family":"Archivo, sans-serif", "font-size":fs, "font-weight":600}, g);
    t.textContent = truncate(n.title || "Untitled", r.w - 34, `600 ${fs}px Archivo, sans-serif`);
    if (n.notes) el("circle", {cx:r.w - 12, cy:12, r:3.2, fill:"#16232F", opacity:.55}, g);
  } else {
    const m = tableMetrics(n);
    const fc = n.fontColor || "#16232F";
    el("rect", {width:r.w, height:r.h, rx:8, fill:"#FFFFFF",
                stroke: selected ? "#2456E6" : "#16232F",
                "stroke-width": selected ? 2.2 : 1.3}, g);
    el("path", {d:`M 0 8 Q 0 0 8 0 H ${r.w-8} Q ${r.w} 0 ${r.w} 8 V ${m.headerH} H 0 Z`,
                fill: n.color || "#16232F"}, g);
    const ht = el("text", {x:12, y:m.headerBaseline, fill:"#FFFFFF", "font-family":"Archivo, sans-serif",
                "font-size":m.headerSize, "font-weight":700, "letter-spacing":".04em"}, g);
    ht.textContent = truncate(n.title || "table", r.w - 60, `700 ${m.headerSize}px Archivo, sans-serif`);
    el("text", {x:r.w - 12, y:m.headerBaseline, "text-anchor":"end", fill:"#FFFFFF", opacity:.75,
                "font-family":"'IBM Plex Mono', monospace", "font-size":Math.max(8, m.base-2)}, g)
      .textContent = "TBL";
    n.fields.forEach((f, i) => {
      const rowTop = m.headerH + i*m.rowH;
      const cy = rowTop + m.rowH/2;
      if (i > 0) el("line", {x1:8, y1:rowTop, x2:r.w-8, y2:rowTop, stroke:"#EDF0F3", "stroke-width":1}, g);
      const badge = f.pk ? "PK" : f.fk ? "FK" : "";
      if (badge){
        el("rect", {x:8, y:cy - m.badgeH/2, width:m.badgeW, height:m.badgeH, rx:3,
                    fill: f.pk ? "#16232F" : "#FFFFFF",
                    stroke:"#16232F", "stroke-width":.9}, g);
        el("text", {x:8 + m.badgeW/2, y:cy + m.badgeSize*0.34, "text-anchor":"middle",
                    fill: f.pk ? "#FFFFFF" : "#16232F",
                    "font-family":"'IBM Plex Mono', monospace", "font-size":m.badgeSize,
                    "font-weight":600}, g).textContent = badge;
      }
      const nm = el("text", {x:m.nameX, y:cy + m.nameSize*0.35, fill:fc,
                  "font-family":"'IBM Plex Mono', monospace", "font-size":m.nameSize,
                  "font-weight":500}, g);
      nm.textContent = f.name + (f.nullable ? "?" : "");
      el("text", {x:r.w-12, y:cy + m.nameSize*0.35, "text-anchor":"end", fill:"#7A8794",
                  "font-family":"'IBM Plex Mono', monospace", "font-size":m.typeSize}, g)
        .textContent = f.type;
    });
    if (!n.fields.length)
      el("text", {x:12, y:m.headerH + 16, fill:"#98A5B3", "font-family":"Archivo, sans-serif",
                  "font-size":11.5, "font-style":"italic"}, g).textContent = "no fields yet";

    /* per-field connect handles (left + right of each row) */
    n.fields.forEach((f, i) => {
      const y = m.headerH + i*m.rowH + m.rowH/2;
      for (const x of [0, r.w]){
        const fh = el("g", {class:"fieldhandle", "data-fieldhandle": f.id,
                            "data-fieldnode": n.id, cursor:"crosshair"}, g);
        el("circle", {cx:x, cy:y, r:9, fill:"transparent"}, fh);
        el("circle", {cx:x, cy:y, r:3.6, fill:"#FFFFFF",
                      stroke:"#2456E6", "stroke-width":1.4}, fh);
      }
    });
  }

  /* connect handle (right edge) */
  const hg = el("g", {"data-handle": n.id, cursor:"crosshair"}, g);
  el("circle", {cx:r.w, cy:r.h/2, r:11, fill:"transparent"}, hg);
  el("circle", {cx:r.w, cy:r.h/2, r:5.5, fill:"#FFFFFF",
                stroke: selected ? "#2456E6" : "#16232F", "stroke-width":1.6,
                opacity: selected ? 1 : .55}, hg);
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
  const n = type === "concept"
    ? { id: uid(), type, x, y, title:"New idea", notes:"",
        color: CONCEPT_COLORS[state.nodes.filter(n=>n.type==="concept").length % CONCEPT_COLORS.length] }
    : { id: uid(), type, x, y, title:"new_table", notes:"", color:"#16232F",
        fields:[{id: uid(), name:"id", type:"SERIAL", pk:true, fk:false, nullable:false}] };
  state.nodes.push(n);
  sel = { kind:"node", id:n.id };
  render();
  focusTitleInput();
  return n;
}
function addEdge(from, to){
  if (from.id === to.id) return;
  const key = ep => ep.id + ":" + (ep.fieldId || "");
  const dup = state.edges.some(e => {
    const ef = e.from + ":" + (e.fromField || ""), et = e.to + ":" + (e.toField || "");
    return (ef === key(from) && et === key(to)) || (ef === key(to) && et === key(from));
  });
  if (dup) return;
  pushHistory();
  let a = nodeById(from.id), b = nodeById(to.id);
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
  state.edges.push(e);
  sel = { kind:"edge", id:e.id };
  render();
}
function deleteSelection(){
  if (!sel) return;
  pushHistory();
  if (sel.kind === "node"){
    state.edges = state.edges.filter(e => e.from !== sel.id && e.to !== sel.id);
    state.nodes = state.nodes.filter(n => n.id !== sel.id);
  } else {
    state.edges = state.edges.filter(e => e.id !== sel.id);
  }
  sel = null;
  render();
}
function duplicateSelection(){
  if (!sel || sel.kind !== "node") return;
  const src = nodeById(sel.id);
  pushHistory();
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid(); copy.x += 36; copy.y += 36;
  if (copy.fields) for (const f of copy.fields) f.id = uid();
  state.nodes.push(copy);
  sel = { kind:"node", id:copy.id };
  render();
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
              title:"new_table", notes:"", color: p.color || "#16232F",
              fields:[{id: uid(), name:"id", type:"SERIAL", pk:true, fk:false, nullable:false}] };
  const fk = { id: uid(), name: fkName, type:"INT", pk:false, fk:true, nullable:false };
  n.fields.push(fk);
  state.nodes.push(n);
  const e = { id: uid(), from: p.id, to: n.id, kind:"1:N", label:"", toField: fk.id };
  if (ppk) e.fromField = ppk.id;
  state.edges.push(e);
  sel = { kind:"node", id:n.id };
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
  if (!sel || sel.kind !== "node") return;
  const p = nodeById(sel.id), r = nodeRect(p);
  pushHistory();
  const siblings = state.edges.filter(e => e.from === p.id).length;
  const n = { id: uid(), type:"concept", x: r.x + r.w + 90,
              y: r.y + siblings*64 - 20, title:"New idea", notes:"",
              color: p.type === "concept" ? p.color : CONCEPT_COLORS[0] };
  state.nodes.push(n);
  state.edges.push({ id: uid(), from: p.id, to: n.id, kind:"link", label:"" });
  sel = { kind:"node", id:n.id };
  render();
  focusTitleInput();
}

/* --------------------------- Pointer ------------------------------ */
let drag = null; // {mode:'pan'|'node'|'connect', ...}

board.addEventListener("pointerdown", ev => {
  if (ev.button === 2) return;
  ev.preventDefault();                       // stop native text-selection drags
  if (window.getSelection) window.getSelection().removeAllRanges();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const fieldHandleEl = ev.target.closest("[data-fieldhandle]");
  const handleEl = ev.target.closest("[data-handle]");
  const nodeEl   = ev.target.closest("[data-node]");
  const edgeEl   = ev.target.closest("[data-edge]");
  board.setPointerCapture(ev.pointerId);

  if (fieldHandleEl){
    drag = { mode:"connect", from: { id: fieldHandleEl.getAttribute("data-fieldnode"),
                                     fieldId: fieldHandleEl.getAttribute("data-fieldhandle") } };
    board.classList.add("connecting");
    return;
  }
  if (handleEl){
    drag = { mode:"connect", from: { id: handleEl.getAttribute("data-handle") } };
    board.classList.add("connecting");
    return;
  }
  if (nodeEl){
    const id = nodeEl.getAttribute("data-node");
    const n = nodeById(id);
    const w = clientToWorld(ev.clientX, ev.clientY);
    sel = { kind:"node", id };
    drag = { mode:"node", id, ox: w.x - n.x, oy: w.y - n.y, moved:false };
    render();
    return;
  }
  if (edgeEl){
    sel = { kind:"edge", id: edgeEl.getAttribute("data-edge") };
    drag = null;
    render();
    return;
  }
  // empty canvas: pan + deselect
  drag = { mode:"pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved:false };
  board.classList.add("panning");
});

board.addEventListener("pointermove", ev => {
  if (!drag) return;
  if (drag.mode === "pan"){
    view.x = drag.vx + (ev.clientX - drag.sx);
    view.y = drag.vy + (ev.clientY - drag.sy);
    if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
    applyView();
  } else if (drag.mode === "node"){
    const n = nodeById(drag.id);
    const w = clientToWorld(ev.clientX, ev.clientY);
    if (!drag.moved){ pushHistory(); drag.moved = true; }
    n.x = Math.round((w.x - drag.ox)/4)*4;
    n.y = Math.round((w.y - drag.oy)/4)*4;
    render();
  } else if (drag.mode === "connect"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    draftLayer.innerHTML = "";
    const a = nodeById(drag.from.id), ra = nodeRect(a);
    let pa;
    if (drag.from.fieldId){
      const idx = a.fields.findIndex(f => f.id === drag.from.fieldId);
      pa = idx >= 0 ? fieldAnchor(a, idx, w.x) : anchorOnRect(ra, w.x, w.y);
    } else {
      pa = anchorOnRect(ra, w.x, w.y);
    }
    el("path", {d:`M ${pa.x} ${pa.y} L ${w.x} ${w.y}`, stroke:"#2456E6",
                "stroke-width":1.8, "stroke-dasharray":"4 4", fill:"none"}, draftLayer);
    el("circle", {cx:w.x, cy:w.y, r:4, fill:"#2456E6"}, draftLayer);
    /* drop-target preview */
    const hit = hitTest(w);
    if (hit && hit.node.id !== drag.from.id){
      const r = nodeRect(hit.node);
      if (hit.field){
        const idx = hit.node.fields.indexOf(hit.field);
        const mm = tableMetrics(hit.node);
        el("rect", {x:r.x+2, y:r.y + mm.headerH + idx*mm.rowH + 1, width:r.w-4, height:mm.rowH-2, rx:4,
                    fill:"#2456E6", opacity:.16}, draftLayer);
      } else {
        el("rect", {x:r.x-3, y:r.y-3, width:r.w+6, height:r.h+6, rx:10, fill:"none",
                    stroke:"#2456E6", "stroke-width":1.5, "stroke-dasharray":"4 3"}, draftLayer);
      }
    }
  }
});

board.addEventListener("pointerup", ev => {
  if (!drag) return;
  if (drag.mode === "pan" && !drag.moved){
    sel = null; render();
  } else if (drag.mode === "connect"){
    draftLayer.innerHTML = "";
    const w = clientToWorld(ev.clientX, ev.clientY);
    const hit = hitTest(w);
    if (hit) addEdge(drag.from, { id: hit.node.id, fieldId: hit.field ? hit.field.id : undefined });
  }
  board.classList.remove("panning","connecting");
  drag = null;
});

board.addEventListener("dblclick", ev => {
  const nodeEl = ev.target.closest("[data-node]");
  if (nodeEl){
    sel = { kind:"node", id: nodeEl.getAttribute("data-node") };
    render();
    focusTitleInput();
  } else {
    const w = clientToWorld(ev.clientX, ev.clientY);
    addNode("concept", w.x - 65, w.y - 24);
  }
});

board.addEventListener("wheel", ev => {
  ev.preventDefault();
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
window.addEventListener("keydown", ev => {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "z"){ ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && ev.key.toLowerCase() === "y"){ ev.preventDefault(); redo(); return; }
  if (typing) return;
  if (mod && ev.key.toLowerCase() === "o"){ ev.preventDefault(); openDoc(); return; }
  if (mod && ev.key.toLowerCase() === "s"){
    ev.preventDefault();
    ev.shiftKey ? saveAsDoc() : saveDoc();
    return;
  }
  if (ev.key === "Delete" || ev.key === "Backspace"){ ev.preventDefault(); deleteSelection(); }
  else if (ev.key === "Tab"){ ev.preventDefault(); addChildConcept(); }
  else if (mod && ev.key.toLowerCase() === "d"){ ev.preventDefault(); duplicateSelection(); }
  else if (ev.key === "Escape"){ hideCtx(); sel = null; render(); }
  else if (ev.key.toLowerCase() === "c" && !mod){ const c = viewCenter(); addNode("concept", c.x-65, c.y-24); }
  else if (ev.key.toLowerCase() === "t" && !mod){ const c = viewCenter(); addNode("table", c.x-95, c.y-40); }
  else if (ev.key.toLowerCase() === "f" && !mod){ fitView(); }
  else if (sel && sel.kind === "node" && ev.key.startsWith("Arrow")){
    ev.preventDefault();
    const n = nodeById(sel.id), step = ev.shiftKey ? 24 : 4;
    pushHistory();
    if (ev.key === "ArrowLeft") n.x -= step;
    if (ev.key === "ArrowRight") n.x += step;
    if (ev.key === "ArrowUp") n.y -= step;
    if (ev.key === "ArrowDown") n.y += step;
    render();
  }
});
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
    const n = nodeById(sel.id);
    if (!n){ sel = null; renderHelp(); return; }
    inspTitle.textContent = n.type === "concept" ? "Concept node" : "Table node";

    frow(n.type === "concept" ? "Title" : "Table name", () => {
      const i = mkInput(n.title, v => { n.title = v; drawOnly(); });
      i.id = "titleInput"; return i;
    });

    if (n.type === "concept"){
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
    } else {
      frow("Header color", () => swatches(TABLE_COLORS, n.color,
        (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
        (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
      frow("Text color", () => swatches(FONT_COLORS, n.fontColor || "#16232F",
        (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      renderFieldEditor(n);
    }

    const div = document.createElement("div");
    div.className = "rowbtns";
    div.appendChild(mkBtn("Duplicate", duplicateSelection));
    div.appendChild(mkBtn("Add linked concept  ⇥", addChildConcept));
    inspBody.appendChild(div);
    inspBody.appendChild(mkBtn("Delete node", deleteSelection, "dangerbtn"));

  } else {
    const e = edgeById(sel.id);
    if (!e){ sel = null; renderHelp(); return; }
    inspTitle.textContent = "Edge";
    const a = nodeById(e.from), b = nodeById(e.to);
    const endName = (n, fid) => {
      const f = fid && n.fields ? n.fields.find(x => x.id === fid) : null;
      return escapeHtml(n.title) + (f ? "<span style='font-family:var(--mono);font-size:11px'>." + escapeHtml(f.name) + "</span>" : "");
    };
    const p = document.createElement("div");
    p.className = "helper";
    p.innerHTML = `<b>${endName(a, e.fromField)}</b> → <b>${endName(b, e.toField)}</b>` +
      (e.kind !== "link" ? `<br>Convention: <em>from</em> = the “one” side, <em>to</em> = the “many” side.` : "");
    inspBody.appendChild(p);

    frow("Type", () => {
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
    attachRow("From", a, e, "fromField");
    attachRow("To",   b, e, "toField");
    frow("Label (optional)", () => mkInput(e.label, v => { e.label = v; drawOnly(); }));

    const div = document.createElement("div");
    div.className = "rowbtns";
    div.appendChild(mkBtn("Swap direction", () => {
      pushHistory();
      const t = e.from; e.from = e.to; e.to = t;
      const tf = e.fromField;
      if (e.toField !== undefined) e.fromField = e.toField; else delete e.fromField;
      if (tf !== undefined) e.toField = tf; else delete e.toField;
      render();
    }));
    div.appendChild(mkBtn("Delete edge", deleteSelection, "dangerbtn"));
    inspBody.appendChild(div);
  }
}

/* choose whole-table vs. specific field for one end of an edge */
function attachRow(which, node, e, key){
  if (node.type !== "table" || !node.fields.length) return;
  frow(which + " attaches to", () => {
    const s = document.createElement("select");
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "(whole table)";
    s.appendChild(o0);
    for (const f of node.fields){
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.name;
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
    flags.appendChild(mkBtn("↑", () => moveField(n, i, -1), "mini"));
    flags.appendChild(mkBtn("↓", () => moveField(n, i, +1), "mini"));
    wrapD.appendChild(flags);
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
  const j = i + d;
  if (j < 0 || j >= n.fields.length) return;
  pushHistory();
  [n.fields[i], n.fields[j]] = [n.fields[j], n.fields[i]];
  render();
}

function renderHelp(){
  const h = document.createElement("div");
  h.className = "helper";
  h.innerHTML = `
    <p><b>Two node types, one canvas.</b><br>
    Concepts sketch the business thinking; tables carry the data model. Link them freely —
    an idea can point at the entity, or the exact column, that will store it.</p>
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
  well.addEventListener("change", () => { syncText(well.value); apply(well.value, true); if (opts.onCommit) opts.onCommit(); });

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
    if (n){ txt.classList.remove("bad"); well.value = n; syncText(n); apply(n, true); return true; }
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

function swatches(colors, current, apply){
  const d = document.createElement("div");
  d.className = "swatches";
  for (const c of colors){
    const b = document.createElement("button");
    b.className = "swatch" + (c.toLowerCase() === (current||"").toLowerCase() ? " on" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => apply(c, true));
    d.appendChild(b);
  }
  const wrap = document.createElement("div");
  wrap.className = "swatchgroup";
  wrap.appendChild(d);
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
  edgeLayer.innerHTML = ""; nodeLayer.innerHTML = "";
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) drawNode(n);
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
  sel = null;
  undoStack.length = 0;
  redoStack.length = 0;
  doc = { handle: null, name: "untitled.schematic.json", dirty: false };
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
    pushHistory(); state.nodes = []; state.edges = []; sel = null; render();
  }
});
document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnRedo").addEventListener("click", redo);
document.getElementById("btnFit").addEventListener("click", fitView);
document.getElementById("btnAddConcept").addEventListener("click", () => { const c = viewCenter(); addNode("concept", c.x-65, c.y-24); });
document.getElementById("btnAddTable").addEventListener("click", () => { const c = viewCenter(); addNode("table", c.x-95, c.y-40); });

/* --------------------------- SQL export --------------------------- */
function ident(s){
  const t = (s||"t").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g,"");
  return t || "t";
}
function generateSQL(){
  const tables = state.nodes.filter(n => n.type === "table");
  if (!tables.length) return "-- No table nodes on the canvas.\n-- Add a Table node, give it fields, then export again.";
  const lines = ["-- Draft DDL generated by Schematic — review types & constraints before use.",""];
  for (const t of tables){
    const tn = ident(t.title);
    const cols = t.fields.map(f =>
      `  ${ident(f.name)} ${f.type || "TEXT"}${f.nullable ? "" : " NOT NULL"}`);
    const pks = t.fields.filter(f => f.pk).map(f => ident(f.name));
    if (pks.length) cols.push(`  PRIMARY KEY (${pks.join(", ")})`);
    // FK constraints from 1:N / 1:1 edges where this table is the "many" (to) side.
    // Field-bound edges give exact column mappings; otherwise fall back to heuristics.
    for (const e of state.edges){
      if (e.kind !== "1:N" && e.kind !== "1:1") continue;
      if (e.to !== t.id) continue;
      const parent = nodeById(e.from);
      if (!parent || parent.type !== "table") continue;
      const ppk = parent.fields.find(f => f.pk);
      const boundChild  = e.toField   ? t.fields.find(f => f.id === e.toField)          : null;
      const boundParent = e.fromField ? parent.fields.find(f => f.id === e.fromField)   : null;
      const refField = boundParent || ppk;
      const fkField = boundChild
                   || t.fields.find(f => f.fk && ident(f.name).includes(ident(parent.title).replace(/s$/,"")))
                   || t.fields.find(f => f.fk);
      if (fkField && refField){
        cols.push(`  FOREIGN KEY (${ident(fkField.name)}) REFERENCES ${ident(parent.title)}(${ident(refField.name)})`);
      } else {
        cols.push(`  -- TODO: add FK column referencing ${ident(parent.title)}${ppk ? "(" + ident(ppk.name) + ")" : ""} (edge: ${e.kind})`);
      }
    }
    lines.push(`CREATE TABLE ${tn} (`, cols.join(",\n"), ");", "");
    // N:M edges → junction table suggestion
  }
  for (const e of state.edges){
    if (e.kind !== "N:M") continue;
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    const an = ident(a.title), bn = ident(b.title);
    const apk = a.fields.find(f => f.pk), bpk = b.fields.find(f => f.pk);
    lines.push(`-- N:M between ${an} and ${bn} — suggested junction table:`,
      `CREATE TABLE ${an}_${bn} (`,
      `  ${an}_id ${apk ? apk.type.replace(/^SERIAL$/i,"INT") : "INT"} NOT NULL,`,
      `  ${bn}_id ${bpk ? bpk.type.replace(/^SERIAL$/i,"INT") : "INT"} NOT NULL,`,
      `  PRIMARY KEY (${an}_id, ${bn}_id)` +
        (apk ? `,\n  FOREIGN KEY (${an}_id) REFERENCES ${an}(${ident(apk.name)})` : "") +
        (bpk ? `,\n  FOREIGN KEY (${bn}_id) REFERENCES ${bn}(${ident(bpk.name)})` : ""),
      ");", "");
  }
  return lines.join("\n");
}
const sqlModal = document.getElementById("sqlModal");
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

/* --------------------------- PNG export --------------------------- */
document.getElementById("btnExportPNG").addEventListener("click", () => {
  if (!state.nodes.length){ alert("Nothing to export yet."); return; }
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for (const n of state.nodes){
    const r = nodeRect(n);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const pad = 40, W = x1 - x0 + pad*2, H = y1 - y0 + pad*2;
  const clone = board.cloneNode(true);
  clone.setAttribute("width", W); clone.setAttribute("height", H);
  clone.setAttribute("viewBox", `${x0-pad} ${y0-pad} ${W} ${H}`);
  const g = clone.querySelector("#world");
  g.removeAttribute("transform");
  const bg = g.querySelector("[data-bg]");
  if (bg) bg.setAttribute("fill", "#FFFFFF");
  clone.querySelectorAll("[data-handle], [data-fieldhandle]").forEach(h => h.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], {type:"image/svg+xml;charset=utf-8"}));
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = W*2; cv.height = H*2;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0,0,cv.width,cv.height);
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
  const row = document.createElement("div");
  row.className = "swrow";
  for (const c of colors){
    const b = document.createElement("button");
    b.className = "swatch" + (c.toLowerCase() === (current||"").toLowerCase() ? " on" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => { apply(c, true); hideCtx(); });
    row.appendChild(b);
  }
  parent.appendChild(row);
  const hexWrap = document.createElement("div");
  hexWrap.className = "swrow";
  hexWrap.appendChild(customColorRow(current, apply, { onCommit: hideCtx }));
  parent.appendChild(hexWrap);
}
/* compact font-size stepper for the context menu */
function ctxSizeRow(parent, n){
  const isC = n.type === "concept";
  const cur = isC ? conceptFont(n) : tableMetrics(n).base;
  const wrap = document.createElement("div");
  wrap.className = "swrow";
  wrap.appendChild(sizeStepper(cur, isC ? 9 : 8, isC ? 48 : 28, isC ? 1 : 0.5,
    (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
  parent.appendChild(wrap);
}

function nodeMenu(n, x, y){
  showCtx(x, y, m => {
    ctxLabel(m, n.type === "concept" ? "Color" : "Header color");
    ctxSwatches(m, n.type === "concept" ? CONCEPT_COLORS : TABLE_COLORS, n.color,
      (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); });
    ctxLabel(m, "Text size");
    ctxSizeRow(m, n);
    ctxLabel(m, "Text color");
    ctxSwatches(m, FONT_COLORS, n.fontColor || "#16232F",
      (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); });
    ctxSep(m);
    ctxItem(m, "Edit in inspector", () => focusTitleInput(), {kbd:"dbl-click"});
    ctxItem(m, "Add linked concept", addChildConcept, {kbd:"Tab"});
    if (n.type === "table"){
      ctxItem(m, "Add related table (1:N)", () => addRelatedTable(n.id));
      ctxItem(m, "Add field", () => {
        pushHistory();
        n.fields.push({id: uid(), name:"field_" + (n.fields.length+1),
                       type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
        render();
      });
    }
    ctxItem(m, "Duplicate", duplicateSelection, {kbd:"Ctrl+D"});
    ctxSep(m);
    ctxItem(m, "Bring to front", () => reorderNode(n.id, true));
    ctxItem(m, "Send to back",   () => reorderNode(n.id, false));
    ctxSep(m);
    ctxItem(m, "Delete node", deleteSelection, {kbd:"Del", danger:true});
  });
}
function edgeMenu(e, x, y){
  showCtx(x, y, m => {
    ctxLabel(m, "Relation type");
    const row = document.createElement("div");
    row.className = "kindrow";
    for (const k of ["link","1:1","1:N","N:M"]){
      const b = document.createElement("button");
      b.textContent = k;
      if (e.kind === k) b.className = "on";
      b.addEventListener("click", () => { hideCtx(); pushHistory(); e.kind = k; render(); });
      row.appendChild(b);
    }
    m.appendChild(row);
    ctxSep(m);
    ctxItem(m, "Swap direction", () => {
      pushHistory();
      const t = e.from; e.from = e.to; e.to = t;
      const tf = e.fromField;
      if (e.toField !== undefined) e.fromField = e.toField; else delete e.fromField;
      if (tf !== undefined) e.toField = tf; else delete e.toField;
      render();
    });
    ctxItem(m, "Edit in inspector", () => {});
    ctxSep(m);
    ctxItem(m, "Delete edge", deleteSelection, {kbd:"Del", danger:true});
  });
}
function canvasMenu(w, x, y){
  showCtx(x, y, m => {
    ctxItem(m, "Add concept here", () => addNode("concept", w.x - 65, w.y - 24), {kbd:"C"});
    ctxItem(m, "Add table here",   () => addNode("table",   w.x - 95, w.y - 40), {kbd:"T"});
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
    sel = { kind:"node", id:n.id };
    render();
    nodeMenu(n, ev.clientX, ev.clientY);
  } else if (edgeEl){
    const e = edgeById(edgeEl.getAttribute("data-edge"));
    sel = { kind:"edge", id:e.id };
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

/* ----------------------------- Init ------------------------------- */
buildScaffold();
seed();
ensureFieldIds();
render();
syncHistoryButtons();
updateDocLabel();
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
  setDocDirty,
  generateSQL
};
