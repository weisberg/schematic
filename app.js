"use strict";

/* ------------------------- Mutations ------------------------------ */
function addNode(type, x, y, opts = {}){
  pushHistory();
  let n;
  if (type === "concept"){
    n = { id: uid(), type, x, y, title:"New idea", notes:"",
          color: conceptColors()[state.nodes.filter(n=>n.type==="concept").length % conceptColors().length] };
  } else if (type === "text"){
    n = {id:uid(), type, x, y, title:"Text", color:conceptColors()[1] || CONCEPT_COLORS[1],
         fontSize:TEXT_FS_DEFAULT, w:TEXT_W_DEFAULT};
  } else if (type === "note"){
    n = { id:uid(), type, x, y, title:"Rich note",
          content:"Add context here.\n\n- Use **bold**, _italic_, or `code`\n- [ ] Track a decision",
          color:conceptColors()[0], fontSize:NOTE_FS_DEFAULT, w:NOTE_W_DEFAULT };
  } else if (type === "frame"){
    n = { id: uid(), type, x, y, title:"Subject area", color:frameColorDefault(),
          w:FRAME_DEFAULT.w, h:FRAME_DEFAULT.h };
  } else if (type === "swimlane"){
    const orientation = opts.orientation === "vertical" ? "vertical" : "horizontal";
    const defaults = SWIMLANE_DEFAULT[orientation];
    n = { id:uid(), type, x, y, orientation,
          title:orientation === "vertical" ? "Vertical lane" : "Horizontal lane",
          color:SWIMLANE_DEFAULT.bodyColor, titleColor:SWIMLANE_DEFAULT.titleColor,
          w:defaults.w, h:defaults.h };
  } else if (type === "todo"){
    n = { id: uid(), type, x, y, title:"To-do list", notes:"", color:todoColorDefault(),
          items:[{ id: uid(), text:"New item" }] };
  } else {
    n = { id: uid(), type:"table", x, y, title:uniqueTableTitle("new_table"), notes:"", color:themeColors("light").ink,
          fields:[{id: uid(), name:"id", type:"SERIAL", pk:true, fk:false, nullable:false}] };
  }
  if (opts.center){
    const r = nodeRect(n);
    n.x = x - r.w/2;
    n.y = y - r.h/2;
  }
  state.nodes.push(n);
  setSelection("node", n.id);
  render();
  focusTitleInput();
  return n;
}
function addSwimlane(orientation, x, y){
  const normalized = orientation === "vertical" ? "vertical" : "horizontal";
  const defaults = SWIMLANE_DEFAULT[normalized];
  return addNode("swimlane", x == null ? viewCenter().x - defaults.w/2 : x,
                 y == null ? viewCenter().y - defaults.h/2 : y, {orientation:normalized});
}
function addNodeCentered(type, point, opts = {}){
  return addNode(type, point.x, point.y, {...opts, center:true});
}
function addTodoItem(n){
  if (!n || n.type !== "todo") return null;
  pushHistory();
  const item = { id:uid(), text:"New item" };
  n.items.push(item);
  setSelection("node", n.id);
  render();
  return item;
}
function addEdge(from, to){
  if (from.id === to.id) return;
  let a = nodeById(from.id), b = nodeById(to.id);
  if (!a || !b || isStructuralNode(a) || isStructuralNode(b)) return;
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
    if (Number.isFinite(e.orthoX)) e.orthoX += offset;
    if (Number.isFinite(e.orthoY)) e.orthoY += offset;
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
  const selected = selectedNodes().find(n => n.type === "concept" || n.type === "todo" || n.type === "note");
  if (selected) return selected;
  const concepts = state.nodes.filter(n => n.type === "concept" || n.type === "todo" || n.type === "note");
  if (!concepts.length) return null;
  return concepts.slice().sort((a, b) => {
    const ao = state.edges.filter(e => e.kind === "link" && e.from === a.id).length;
    const bo = state.edges.filter(e => e.kind === "link" && e.from === b.id).length;
    return bo - ao || a.y - b.y || a.x - b.x;
  })[0];
}
function conceptTreeScope(rootId){
  const conceptIds = new Set(state.nodes.filter(n => n.type === "concept" || n.type === "todo" || n.type === "note").map(n => n.id));
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
  if (!p || isStructuralNode(p)) return;
  const r = nodeRect(p);
  pushHistory();
  const siblings = state.edges.filter(e => e.from === p.id).length;
  const n = { id: uid(), type:"concept", x: r.x + r.w + 90,
              y: r.y + siblings*64 - 20, title:"New idea", notes:"",
              color: p.type === "concept" ? p.color : conceptColors()[0] };
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
  if (e.routing === "ortho"){
    const route = orthoEdgeRoute(e, ep.pa, ep.pb);
    const activeSnap = drag && drag.mode === "ortho-bend" && drag.edgeId === e.id ? drag.snap : null;
    if (activeSnap && activeSnap.snapX != null){
      const ys = [route.pa.y, route.pb.y, route.a.y, route.b.y, route.bend.y];
      el("line", {x1:activeSnap.snapX, y1:Math.min(...ys)-36, x2:activeSnap.snapX, y2:Math.max(...ys)+36,
                  stroke:t.accent, "stroke-width":1, "stroke-dasharray":"4 4", opacity:.72,
                  "pointer-events":"none", "data-ortho-snap-x":"1"}, draftLayer);
    }
    if (activeSnap && activeSnap.snapY != null){
      const xs = [route.pa.x, route.pb.x, route.a.x, route.b.x, route.bend.x];
      el("line", {x1:Math.min(...xs)-36, y1:activeSnap.snapY, x2:Math.max(...xs)+36, y2:activeSnap.snapY,
                  stroke:t.accent, "stroke-width":1, "stroke-dasharray":"4 4", opacity:.72,
                  "pointer-events":"none", "data-ortho-snap-y":"1"}, draftLayer);
    }
    const bend = el("g", {"data-edgebend":e.id, cursor:"move", role:"button", tabindex:0,
                           "aria-label":`Move orthogonal link waypoint at ${Math.round(route.bend.x)}, ${Math.round(route.bend.y)}`}, draftLayer);
    el("circle", {cx:route.bend.x, cy:route.bend.y, r:14, fill:"transparent"}, bend);
    el("rect", {x:route.bend.x-5, y:route.bend.y-5, width:10, height:10, rx:2,
                fill:t.panel, stroke:t.accent, "stroke-width":2}, bend);
    el("title", {}, bend).textContent = "Drag to adjust this orthogonal link";
    bend.addEventListener("keydown", ev => {
      const delta = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[ev.key];
      if (!delta) return;
      ev.preventDefault();
      ev.stopPropagation();
      const step = ev.shiftKey ? GRID_SNAP : 4;
      const next = {x:route.bend.x + delta[0]*step, y:route.bend.y + delta[1]*step};
      pushHistory("ortho-bend:" + e.id);
      e.orthoX = next.x;
      e.orthoY = next.y;
      render();
      requestAnimationFrame(() => {
        const nextHandle = document.querySelector(`[data-edgebend="${e.id}"]`);
        if (nextHandle) nextHandle.focus();
      });
    });
  }
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
    if (isStructuralNode(n)) continue;
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
  if (newFrom === newTo || isStructuralNode(n)){ render(); return; }
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
  if (linkOnlyNode(a) || linkOnlyNode(b)) e.kind = "link";
  setSelection("edge", e.id);
  render();
}

/* Grid snapping (issue #40): the toolbar toggle is persistent, while Shift is a
   temporary override. Without either, drags retain the fine 4px positioning grid. */
function dragSnap(v, shiftHeld = false){
  const step = snapToGrid || shiftHeld ? GRID_SNAP : 4;
  return Math.round(v/step)*step;
}
function offsetRect(r, dx, dy){
  return {x:r.x + dx, y:r.y + dy, w:r.w, h:r.h,
          cx:r.cx + dx, cy:r.cy + dy};
}
function alignmentCoordinates(r){
  return {
    x:[{key:"left", value:r.x}, {key:"center", value:r.cx}, {key:"right", value:r.x + r.w}],
    y:[{key:"top", value:r.y}, {key:"middle", value:r.cy}, {key:"bottom", value:r.y + r.h}]
  };
}
/* Find the closest standard bounding-box alignment on each axis. The threshold is
   supplied in world units so the caller can keep the interaction stable at every zoom. */
function smartAlignmentSnap(movingRect, targetRects, threshold){
  const moving = alignmentCoordinates(movingRect);
  let xMatch = null, yMatch = null;
  for (const target of targetRects){
    const points = alignmentCoordinates(target);
    for (const from of moving.x) for (const to of points.x){
      const delta = to.value - from.value;
      if (Math.abs(delta) <= threshold && (!xMatch || Math.abs(delta) < Math.abs(xMatch.delta)))
        xMatch = {delta, coordinate:to.value, movingKey:from.key, targetKey:to.key, targetRect:target};
    }
    for (const from of moving.y) for (const to of points.y){
      const delta = to.value - from.value;
      if (Math.abs(delta) <= threshold && (!yMatch || Math.abs(delta) < Math.abs(yMatch.delta)))
        yMatch = {delta, coordinate:to.value, movingKey:from.key, targetKey:to.key, targetRect:target};
    }
  }
  return {dx:xMatch ? xMatch.delta : 0, dy:yMatch ? yMatch.delta : 0, xMatch, yMatch};
}
function alignmentGuideGeometry(snap, alignedRect, overshoot){
  if (!snap || (!snap.xMatch && !snap.yMatch)) return null;
  const geometry = {};
  if (snap.xMatch){
    const target = snap.xMatch.targetRect;
    geometry.x = {coordinate:snap.xMatch.coordinate,
      from:Math.min(alignedRect.y, target.y) - overshoot,
      to:Math.max(alignedRect.y + alignedRect.h, target.y + target.h) + overshoot};
  }
  if (snap.yMatch){
    const target = snap.yMatch.targetRect;
    geometry.y = {coordinate:snap.yMatch.coordinate,
      from:Math.min(alignedRect.x, target.x) - overshoot,
      to:Math.max(alignedRect.x + alignedRect.w, target.x + target.w) + overshoot};
  }
  return geometry;
}
function drawAlignmentGuides(guides){
  draftLayer.querySelectorAll("[data-align-guide-x], [data-align-guide-y]").forEach(guide => guide.remove());
  if (!guides) return;
  const t = themeColors();
  if (guides.x) el("line", {x1:guides.x.coordinate, y1:guides.x.from,
    x2:guides.x.coordinate, y2:guides.x.to, stroke:t.accent, "stroke-width":1.25,
    "stroke-dasharray":"4 3", "vector-effect":"non-scaling-stroke", opacity:.9,
    "pointer-events":"none", "data-align-guide-x":"1"}, draftLayer);
  if (guides.y) el("line", {x1:guides.y.from, y1:guides.y.coordinate,
    x2:guides.y.to, y2:guides.y.coordinate, stroke:t.accent, "stroke-width":1.25,
    "stroke-dasharray":"4 3", "vector-effect":"non-scaling-stroke", opacity:.9,
    "pointer-events":"none", "data-align-guide-y":"1"}, draftLayer);
}
function updateSnapControl(){
  const b = document.getElementById("btnSnap");
  if (b) b.setAttribute("aria-pressed", String(snapToGrid));
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
  const todoAddEl = ev.target.closest("[data-todoadd]");
  const fieldHandleEl = ev.target.closest("[data-fieldhandle]");
  const handleEl = ev.target.closest("[data-handle]");
  const collapseEl = ev.target.closest("[data-collapse]");
  const resizeEl = ev.target.closest("[data-frame-resize]");
  const edgeBendEl = ev.target.closest("[data-edgebend]");
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
  if (todoAddEl){
    addTodoItem(nodeById(todoAddEl.getAttribute("data-todoadd")));
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
    if (!n || !isStructuralNode(n)) return;
    const w = clientToWorld(ev.clientX, ev.clientY);
    setSelection("node", id);
    const size = nodeSize(n);
    drag = { mode:"frame-resize", id, start:w, w:size.w, h:size.h, moved:false };
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
  if (edgeBendEl){
    lastPress = null;
    const e = edgeById(edgeBendEl.getAttribute("data-edgebend"));
    const ep = e && edgeEndpoints(e);
    if (!e || e.routing !== "ortho" || !ep) return;
    const route = orthoEdgeRoute(e, ep.pa, ep.pb);
    const start = clientToWorld(ev.clientX, ev.clientY);
    drag = { mode:"ortho-bend", edgeId:e.id, start,
             offset:{x:route.bend.x-start.x, y:route.bend.y-start.y},
             original:{x:route.bend.x, y:route.bend.y}, moved:false, snap:null };
    return;
  }

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
      /* Rows edit their value, a rich-note body focuses its Markdown editor, and headers edit titles. */
      const hit = hitTest(clientToWorld(ev.clientX, ev.clientY));
      if (hit && hit.node.id === id && hit.field) startInlineEditor("row", id, hit.field.id);
      else if (hit && hit.node.type === "note" &&
               clientToWorld(ev.clientX, ev.clientY).y > hit.node.y + richNoteLayout(hit.node).titleH) focusNoteInput();
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
    const wasSelected = isSelected("node", id);
    if (!wasSelected && !ev.shiftKey) setSelection("node", id);
    const selectedIds = new Set(selectionIds("node"));
    if (ev.shiftKey && !wasSelected) selectedIds.add(id);
    const moveIds = new Set(selectedIds);
    if (isStructuralNode(n)) for (const child of containerContainedNodes(n)) moveIds.add(child.id);
    const ids = [...moveIds];
    const moving = new Set(ids);
    drag = { mode:"node", id, start:w, starts: ids.map(nodeId => {
      const dn = nodeById(nodeId);
      return { id:nodeId, x:dn.x, y:dn.y };
    }).filter(Boolean), bendStarts:state.edges
      .filter(e => hasCustomOrthoBend(e) && moving.has(e.from) && moving.has(e.to))
      .map(e => {
        const ep = edgeEndpoints(e);
        const bend = ep ? orthoEdgeRoute(e, ep.pa, ep.pb).bend : {x:e.orthoX, y:e.orthoY};
        return {id:e.id, x:bend.x, y:bend.y};
      }).filter(bend => Number.isFinite(bend.x) && Number.isFinite(bend.y)),
      primaryRect:nodeRect(n),
      targetRects:state.nodes.filter(other => !moving.has(other.id)).map(other => nodeRect(other)),
      selectionIds:[...selectedIds], shiftToggle:!!ev.shiftKey, wasSelected, moved:false, guides:null };
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
    if (!drag.moved){
      if (drag.shiftToggle && !drag.wasSelected) setSelection("node", drag.selectionIds);
      pushHistory();
      drag.moved = true;
    }
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    const useGrid = snapToGrid || ev.shiftKey;
    const alignment = useGrid ? null : smartAlignmentSnap(
      offsetRect(drag.primaryRect, dx, dy), drag.targetRects,
      ALIGN_GUIDE_SCREEN_THRESHOLD / view.k);
    const alignedDx = dx + (alignment ? alignment.dx : 0);
    const alignedDy = dy + (alignment ? alignment.dy : 0);
    for (const start of drag.starts){
      const n = nodeById(start.id);
      if (!n) continue;
      n.x = alignment && alignment.xMatch ? start.x + alignedDx : dragSnap(start.x + dx, ev.shiftKey);
      n.y = alignment && alignment.yMatch ? start.y + alignedDy : dragSnap(start.y + dy, ev.shiftKey);
    }
    const primaryStart = drag.starts.find(start => start.id === drag.id);
    const primaryNode = primaryStart && nodeById(drag.id);
    if (primaryStart && primaryNode){
      const routeDx = primaryNode.x - primaryStart.x;
      const routeDy = primaryNode.y - primaryStart.y;
      for (const bendStart of drag.bendStarts){
        const e = edgeById(bendStart.id);
        if (!e) continue;
        e.orthoX = bendStart.x + routeDx;
        e.orthoY = bendStart.y + routeDy;
      }
    }
    drag.guides = alignment && primaryNode ? alignmentGuideGeometry(
      alignment, nodeRect(primaryNode), ALIGN_GUIDE_SCREEN_OVERSHOOT / view.k) : null;
    if (state.nodes.length > 150) fastDragRender(drag.starts.map(s => s.id));
    else render();
    drawAlignmentGuides(drag.guides);
  } else if (drag.mode === "frame-resize"){
    const w = clientToWorld(ev.clientX, ev.clientY);
    const n = nodeById(drag.id);
    if (!n) return;
    if (!drag.moved){ pushHistory(); drag.moved = true; }
    const verticalLane = n.type === "swimlane" && swimlaneOrientation(n) === "vertical";
    const minW = n.type === "swimlane" && !verticalLane ? 260 : 120;
    const minH = verticalLane ? 260 : n.type === "swimlane" ? 100 : 90;
    n.w = Math.round(Math.max(minW, drag.w + (w.x - drag.start.x)) / 4) * 4;
    n.h = Math.round(Math.max(minH, drag.h + (w.y - drag.start.y)) / 4) * 4;
    render();
  } else if (drag.mode === "ortho-bend"){
    const e = edgeById(drag.edgeId);
    const ep = e && edgeEndpoints(e);
    if (!e || !ep) return;
    const w = clientToWorld(ev.clientX, ev.clientY);
    if (!drag.moved && Math.hypot(w.x - drag.start.x, w.y - drag.start.y) <= 1 / view.k) return;
    if (!drag.moved){ pushHistory(); drag.moved = true; }
    const snapped = snapOrthoBend(e, {x:w.x + drag.offset.x, y:w.y + drag.offset.y}, ep);
    e.orthoX = snapped.x;
    e.orthoY = snapped.y;
    drag.snap = snapped;
    drawOnly();
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
    const hadGuides = !!drag.guides;
    if (!drag.moved && drag.shiftToggle){
      toggleNodeSelection(drag.id);
      render();
    } else if (drag.moved && (state.nodes.length > 150 || hadGuides)) render();
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
  } else if (drag.mode === "ortho-bend"){
    drag.snap = null;
    render();
  }
  board.classList.remove("panning","connecting");
  drag = null;
});
board.addEventListener("pointercancel", ev => {
  activePointers.delete(ev.pointerId);
  clearLongPress();
  if (activePointers.size < 2) touchGesture = null;
  const redrawDraft = drag && (drag.mode === "ortho-bend" || (drag.mode === "node" && drag.guides));
  drag = null;
  board.classList.remove("panning","connecting");
  if (redrawDraft) render();
});

board.addEventListener("wheel", ev => {
  ev.preventDefault();
  closeInlineEditor(false);
  if (ev.shiftKey && ev.deltaY !== 0){
    zoomAtClient(view.k * (ev.deltaY < 0 ? 1.1 : 1/1.1), ev.clientX, ev.clientY);
  } else {
    view.x -= ev.deltaX;
    view.y -= ev.deltaY;
    applyView();
  }
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
  if (!mod && key === "x") return "text";
  if (!mod && key === "n") return "note";
  if (!mod && key === "t") return "table";
  if (!mod && key === "d") return "todo";
  if (!mod && key === "f") return "fit";
  if (!mod && key === "i") return "inspector";
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
  if (id === "text"){ const c = viewCenter(); addNode("text", c.x-TEXT_W_DEFAULT/2, c.y-20); return; }
  if (id === "note"){ const c = viewCenter(); addNode("note", c.x-NOTE_W_DEFAULT/2, c.y-60); return; }
  if (id === "table"){ const c = viewCenter(); addNode("table", c.x-95, c.y-40); return; }
  if (id === "todo"){ const c = viewCenter(); addNode("todo", c.x-90, c.y-30); return; }
  if (id === "fit") return fitView();
  if (id === "inspector") return toggleInspector();
  if (id === "nudge" && ev) return nudgeSelection(ev.key, ev.shiftKey ? 24 : 4);
}
function cycleNodeSelection(reverse = false){
  const nodes = state.nodes.filter(n => !isStructuralNode(n));
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
function zoomAtClient(scale, clientX, clientY){
  const b = board.getBoundingClientRect();
  const mx = Number.isFinite(clientX) ? clientX - b.left : b.width/2;
  const my = Number.isFinite(clientY) ? clientY - b.top : b.height/2;
  const next = Math.min(3, Math.max(0.2, Number(scale) || 1));
  view.x = mx - (mx - view.x) * (next/view.k);
  view.y = my - (my - view.y) * (next/view.k);
  view.k = next;
  applyView();
  return view.k;
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
    if (n.type === "swimlane"){
      const orientation = swimlaneOrientation(n), titleSize = swimlaneDefaults(n).titleSize;
      if (orientation === "horizontal"){
        const p = worldToWrap(r.x + 8, r.y + r.h/2 - 16);
        return { x:p.x, y:p.y, w:Math.max(100, (Math.min(titleSize, r.w*.45) - 16)*view.k),
                 h:32, fontSize:13 };
      }
      const p = worldToWrap(r.x + 10, r.y + 8);
      return { x:p.x, y:p.y, w:Math.max(100, (r.w - 20)*view.k),
               h:Math.max(28, (Math.min(titleSize, r.h*.45) - 16)*view.k), fontSize:13 };
    }
    if (n.type === "text"){
      const p = worldToWrap(r.x + 4, r.y + Math.max(0, r.h/2 - 18));
      return {x:p.x, y:p.y, w:Math.max(120, r.w*view.k - 8), h:36,
              fontSize:Math.max(12, textBoxFont(n)*view.k)};
    }
    if (n.type === "concept"){
      const p = worldToWrap(r.x + 12, r.y + Math.max(4, r.h/2 - 16));
      return { x:p.x, y:p.y, w:Math.max(120, r.w*view.k - 24), h:32, fontSize:Math.max(12, conceptFont(n)*view.k) };
    }
    if (n.type === "note"){
      const layout = richNoteLayout(n);
      const p = worldToWrap(r.x + 8, r.y + 4);
      return { x:p.x, y:p.y, w:Math.max(140, (r.w - 16)*view.k),
               h:Math.max(28, (layout.titleH - 8)*view.k), fontSize:Math.max(12, (layout.base + 1.5)*view.k) };
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
    if (n.type === "note" && String(n.content || "").trim())
      items.push({ type:"note", label:`${n.title || "note"}.${String(n.content).replace(/\s+/g, " ").slice(0, 120)}`, nodeId:n.id });
  }
  for (const c of [
    ["addConcept", "Add concept"],
    ["addText", "Add plain text"],
    ["addNote", "Add rich note"],
    ["addTable", "Add table"],
    ["addTodo", "Add to-do list"],
    ["addFrame", "Add frame"],
    ["addHorizontalLane", "Add horizontal swimlane"],
    ["addVerticalLane", "Add vertical swimlane"],
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
  if (item.type === "node" || item.type === "field" || item.type === "item" || item.type === "note"){
    setSelection("node", item.nodeId);
    centerNode(item.nodeId);
    render();
    return;
  }
  const c = viewCenter();
  if (item.command === "addConcept") addNode("concept", c.x-65, c.y-24);
  if (item.command === "addText") addNode("text", c.x-TEXT_W_DEFAULT/2, c.y-20);
  if (item.command === "addNote") addNode("note", c.x-NOTE_W_DEFAULT/2, c.y-60);
  if (item.command === "addTable") addNode("table", c.x-95, c.y-40);
  if (item.command === "addTodo") addNode("todo", c.x-90, c.y-30);
  if (item.command === "addFrame") addNode("frame", c.x-FRAME_DEFAULT.w/2, c.y-FRAME_DEFAULT.h/2);
  if (item.command === "addHorizontalLane") addSwimlane("horizontal", c.x-SWIMLANE_DEFAULT.horizontal.w/2, c.y-SWIMLANE_DEFAULT.horizontal.h/2);
  if (item.command === "addVerticalLane") addSwimlane("vertical", c.x-SWIMLANE_DEFAULT.vertical.w/2, c.y-SWIMLANE_DEFAULT.vertical.h/2);
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
let inspectorMount = inspBody;

function appendInspector(node){
  inspectorMount.appendChild(node);
  return node;
}

function focusTitleInput(){
  const n = singleSelectedNode();
  if (n) openInspectorSection(n.type + ":basics");
  requestAnimationFrame(() => {
    const i = document.getElementById("titleInput");
    if (i){ i.focus(); i.select(); }
  });
}
function focusNoteInput(){
  openInspectorSection("note:content");
  requestAnimationFrame(() => {
    const i = document.getElementById("noteContentInput");
    if (i) i.focus();
  });
}
function focusEdgeLabelInput(){
  openInspectorSection("edge:label");
  requestAnimationFrame(() => {
    const i = document.getElementById("edgeLabelInput");
    if (i){ i.focus(); i.select(); }
  });
}
function edgeRelationshipValue(label){
  return EDGE_RELATIONSHIPS.some(([name]) => name === label) ? label : EDGE_CUSTOM_RELATIONSHIP;
}
function edgeRelationshipSelect(e, opts = {}){
  const s = document.createElement("select");
  s.setAttribute("aria-label", "Edge relationship");
  s.setAttribute("data-edge-relationship", e.id);
  if (opts.id) s.id = opts.id;
  const custom = document.createElement("option");
  custom.value = EDGE_CUSTOM_RELATIONSHIP;
  custom.textContent = "Custom text";
  custom.title = "Use any custom edge label";
  s.appendChild(custom);
  for (const [name, meaning] of EDGE_RELATIONSHIPS){
    const o = document.createElement("option");
    o.value = name;
    o.textContent = `${name} — ${meaning}`;
    o.title = meaning;
    s.appendChild(o);
  }
  s.value = edgeRelationshipValue(e.label);
  s.addEventListener("change", () => {
    const next = s.value;
    pushHistory();
    if (next === EDGE_CUSTOM_RELATIONSHIP){
      if (edgeRelationshipValue(e.label) !== EDGE_CUSTOM_RELATIONSHIP) e.label = "";
    } else e.label = next;
    if (opts.close) opts.close();
    render();
    if (next === EDGE_CUSTOM_RELATIONSHIP && opts.onCustom) opts.onCustom();
  });
  return s;
}
function setEdgeArrow(e, key, on){
  if (on) e[key] = true;
  else delete e[key];
}
function edgeStyleSelect(e, id, opts = {}){
  const s = document.createElement("select");
  s.setAttribute("aria-label", "Line style");
  if (id) s.id = id;
  for (const [value, label] of [["solid","Solid"],["dash","Dashed"],["dot","Dotted"]]){
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    if (edgeLineStyle(e) === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => {
    pushHistory();
    e.lineStyle = s.value;
    if (opts.close) opts.close();
    render();
  });
  return s;
}

const inspectorDisclosureState = new Map();
function openInspectorSection(key){
  const details = document.querySelector(`[data-inspector-section="${key}"]`);
  if (!details) return false;
  details.open = true;
  inspectorDisclosureState.set(key, true);
  return true;
}
function disclosureChevron(){
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("disclosure-chevron");
  const path = document.createElementNS(SVGNS, "path");
  path.setAttribute("d", "M4 6l4 4 4-4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}
function setInspectorHeader(kind, name, opts = {}){
  inspTitle.innerHTML = "";
  const type = document.createElement("span");
  type.className = "inspector-kind";
  type.textContent = kind;
  inspTitle.appendChild(type);
  if (name){
    const row = document.createElement("span");
    row.className = "inspector-name-row";
    if (opts.kind === "edge") row.appendChild(contextIcon("edge"));
    else if (opts.kind === "node"){
      const mark = document.createElement("span");
      mark.className = "inspector-object-mark";
      mark.style.background = opts.color || "transparent";
      row.appendChild(mark);
    }
    const title = document.createElement("span");
    title.className = "inspector-name";
    title.textContent = name;
    row.appendChild(title);
    inspTitle.appendChild(row);
  }
}
function inspectorSection(key, title, build, opts = {}){
  const details = document.createElement("details");
  details.className = "inspector-section";
  details.setAttribute("data-inspector-section", key);
  const stored = inspectorDisclosureState.get(key);
  details.open = stored == null ? opts.open !== false : stored;
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = title;
  summary.append(label, disclosureChevron());
  const body = document.createElement("div");
  body.className = "inspector-section-body";
  details.append(summary, body);
  appendInspector(details);
  const previous = inspectorMount;
  inspectorMount = body;
  try { build(); } finally { inspectorMount = previous; }
  details.addEventListener("toggle", () => inspectorDisclosureState.set(key, details.open));
  return details;
}
function inspectorActions(buttons, danger, opts = {}){
  const footer = document.createElement("div");
  footer.className = "inspector-actions";
  if (buttons.length || opts.inlineDanger){
    const row = document.createElement("div");
    row.className = "rowbtns";
    for (const button of buttons) row.appendChild(button);
    if (danger && opts.inlineDanger) row.appendChild(danger);
    footer.appendChild(row);
  }
  if (danger && !opts.inlineDanger) footer.appendChild(danger);
  appendInspector(footer);
}
function renderNodeTitleField(n){
  frow(n.type === "table" ? "Table name" : n.type === "text" ? "Text" : "Title", () => {
    const i = mkInput(n.title, v => {
      n.title = v;
      const headerName = document.querySelector("#inspTitle .inspector-name");
      if (headerName) headerName.textContent = v;
      drawOnly();
    });
    i.id = "titleInput";
    if (n.type === "table"){
      let prev = n.title;
      i.addEventListener("focus", () => { prev = n.title; });
      i.addEventListener("blur", () => {
        if (tableNameConflict(n, n.title)){
          showNoticeModal("Duplicate table name",
            `A table named "${ident(n.title)}" already exists. Table names must be unique.`);
          n.title = prev;
          i.value = prev;
          const headerName = document.querySelector("#inspTitle .inspector-name");
          if (headerName) headerName.textContent = prev;
          drawOnly();
        }
      });
    }
    return i;
  });
}
function renderNodeNotesField(n){
  frow("Notes", () => {
    const t = document.createElement("textarea");
    t.value = n.notes || "";
    t.placeholder = "Add notes…";
    t.addEventListener("focus", pushHistoryOnce());
    t.addEventListener("input", () => { n.notes = t.value; drawOnly(); });
    return t;
  });
}

function renderInspector(){
  updateInspectorVisibility();
  inspBody.innerHTML = "";
  inspectorMount = inspBody;
  if (!sel){ setInspectorHeader("Inspector"); renderHelp(); return; }

  if (sel.kind === "node"){
    if (selectionCount("node") > 1){ renderMultiInspector(); return; }
    const n = singleSelectedNode();
    if (!n){ clearSelection(); renderHelp(); return; }
    const kind = n.type === "concept" ? "Concept node" : n.type === "frame" ? "Frame" : n.type === "swimlane" ? "Swimlane"
               : n.type === "todo" ? "To-do list" : n.type === "note" ? "Rich note"
               : n.type === "text" ? "Plain text" : "Table node";
    setInspectorHeader(kind, n.title, {kind:"node", color:n.color || themeColors().ink});

    if (n.type === "swimlane"){
      inspectorSection("swimlane:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Orientation", () => {
          const s = document.createElement("select");
          s.id = "swimlaneOrientation";
          for (const [value, label] of [["horizontal","Horizontal lane"],["vertical","Vertical lane"]]){
            const o = document.createElement("option");
            o.value = value; o.textContent = label; o.selected = swimlaneOrientation(n) === value;
            s.appendChild(o);
          }
          s.addEventListener("change", () => {
            if (s.value === swimlaneOrientation(n)) return;
            pushHistory();
            setSwimlaneOrientation(n, s.value);
            render();
          });
          return s;
        });
      });
      inspectorSection("swimlane:appearance", "Appearance", () => {
        const palette = [...new Set([...conceptColors(), ...tableColors()])];
        frow("Body background", () => {
          const control = swatches(palette, n.color || SWIMLANE_DEFAULT.bodyColor,
            (c, commit) => { pushHistory("lane-body:"+n.id); n.color = c; commit ? render() : drawOnly(); });
          control.id = "swimlaneBodyColor";
          return control;
        });
        frow("Title background", () => {
          const control = swatches(palette, n.titleColor || SWIMLANE_DEFAULT.titleColor,
            (c, commit) => { pushHistory("lane-title:"+n.id); n.titleColor = c; commit ? render() : drawOnly(); });
          control.id = "swimlaneTitleColor";
          return control;
        });
      });
      inspectorSection("swimlane:size", "Size", () => {
        const orientation = swimlaneOrientation(n);
        frow("Width", () => sizeStepper(nodeSize(n).w, orientation === "vertical" ? 120 : 260, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow("Height", () => sizeStepper(nodeSize(n).h, orientation === "vertical" ? 260 : 100, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.h = v; commit ? render() : drawOnly(); }));
      });
    } else if (n.type === "frame"){
      inspectorSection("frame:basics", "Basics", () => renderNodeTitleField(n));
      inspectorSection("frame:appearance", "Appearance", () => {
        frow("Color", () => swatches(tableColors(), n.color || frameColorDefault(),
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("frame:size", "Size", () => {
        frow("Width", () => sizeStepper(n.w || FRAME_DEFAULT.w, 120, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow("Height", () => sizeStepper(n.h || FRAME_DEFAULT.h, 90, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.h = v; commit ? render() : drawOnly(); }));
      });
    } else if (n.type === "concept"){
      inspectorSection("concept:basics", "Basics", () => {
        renderNodeTitleField(n);
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
      });
      inspectorSection("concept:appearance", "Appearance", () => {
        frow("Color", () => swatches(conceptColors(), n.color,
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(conceptFont(n), 9, 48, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("concept:notes", "Notes", () => renderNodeNotesField(n), {open:false});
    } else if (n.type === "text"){
      inspectorSection("text:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Shape", () => {
          const s = document.createElement("select");
          s.id = "textBoxShape";
          s.setAttribute("aria-label", "Text box shape");
          for (const [value, label] of TEXT_BOX_SHAPES){
            const o = document.createElement("option");
            o.value = value; o.textContent = label;
            if (textBoxShape(n) === value) o.selected = true;
            s.appendChild(o);
          }
          s.addEventListener("change", () => { pushHistory(); setTextBoxShape(n, s.value); render(); });
          return s;
        });
        if (textBoxShape(n) === "none"){
          const help = document.createElement("div");
          help.className = "helper";
          help.textContent = "No box shows only the text. The dashed outline appears only while selected.";
          appendInspector(help);
        }
      });
      inspectorSection("text:appearance", "Appearance", () => {
        frow("Shape background", () => {
          const control = swatches(conceptColors(), n.color || conceptColors()[1],
            (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); });
          control.id = "textBoxBackground";
          return control;
        });
        frow("Text size", () => sizeStepper(textBoxFont(n), 10, 72, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); },
          {ariaLabel:"Text size"}));
        frow("Text color", () => {
          const control = swatches(fontColors(), n.fontColor || themeColors().ink,
            (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); });
          control.id = "textBoxTextColor";
          return control;
        });
      });
      inspectorSection("text:layout", "Layout", () => {
        frow("Maximum width", () => sizeStepper(n.w || TEXT_W_DEFAULT, 80, 720, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); },
          {ariaLabel:"Maximum width"}));
      });
    } else if (n.type === "note"){
      inspectorSection("note:basics", "Basics", () => renderNodeTitleField(n));
      inspectorSection("note:content", "Content", () => {
        frow("Markdown", () => {
          const t = document.createElement("textarea");
          t.id = "noteContentInput";
          t.rows = 10;
          t.value = n.content || "";
          t.placeholder = "Write a note…";
          t.addEventListener("focus", pushHistoryOnce());
          t.addEventListener("input", () => { n.content = t.value; drawOnly(); });
          return t;
        });
        const help = document.createElement("div");
        help.className = "helper";
        help.textContent = "Formatting: # heading, - bullet, - [ ] task, **bold**, _italic_, and `code`.";
        appendInspector(help);
      });
      inspectorSection("note:appearance", "Appearance", () => {
        frow("Color", () => swatches(conceptColors(), n.color || conceptColors()[0],
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Width", () => sizeStepper(n.w || NOTE_W_DEFAULT, 220, 720, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(noteFont(n), 10, 28, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
    } else if (n.type === "todo"){
      inspectorSection("todo:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("List display", () => mkFlag(n.collapsed ? "COLLAPSED" : "EXPANDED", !!n.collapsed,
          v => { n.collapsed = v; render(); }));
      });
      inspectorSection("todo:appearance", "Appearance", () => {
        frow("Color", () => swatches(conceptColors(), n.color || todoColorDefault(),
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("todo:notes", "Notes", () => renderNodeNotesField(n), {open:false});
      inspectorSection("todo:items", "Items", () => renderItemEditor(n));
    } else {
      inspectorSection("table:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Field display", () => mkFlag(n.collapsed ? "COLLAPSED" : "EXPANDED", !!n.collapsed,
          v => { n.collapsed = v; render(); }));
      });
      inspectorSection("table:appearance", "Appearance", () => {
        frow("Header color", () => swatches(tableColors(), n.color,
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("table:notes", "Notes", () => renderNodeNotesField(n), {open:false});
      inspectorSection("table:fields", "Fields", () => renderFieldEditor(n));
    }

    const actions = [mkBtn("Duplicate", duplicateSelection)];
    if (!isStructuralNode(n)) actions.push(mkBtn("Add linked concept  ⇥", addChildConcept));
    inspectorActions(actions, mkBtn("Delete node", deleteSelection, "dangerbtn"));

  } else {
    const e = singleSelectedEdge();
    if (!e){ clearSelection(); renderHelp(); return; }
    const a = nodeById(e.from), b = nodeById(e.to);
    setInspectorHeader("Edge", `${a.title} → ${b.title}`, {kind:"edge"});
    const touchesLinkOnlyNode = linkOnlyNode(a) || linkOnlyNode(b);
    const endName = (n, fid) => {
      const rows = fid ? nodeRows(n) : null;
      const f = rows ? rows.find(x => x.id === fid) : null;
      return escapeHtml(n.title) + (f ? "<span style='font-family:var(--mono);font-size:11px'>." + escapeHtml(f.name || f.text || f.id) + "</span>" : "");
    };
    const p = document.createElement("div");
    p.className = "helper";
    p.innerHTML = `<b>${endName(a, e.fromField)}</b> → <b>${endName(b, e.toField)}</b>` +
      (e.kind !== "link" ? `<br>Convention: <em>from</em> = the “one” side, <em>to</em> = the “many” side.` : "");
    inspectorSection("edge:connection", "Connection", () => {
      appendInspector(p);
      if (!touchesLinkOnlyNode) frow("Type", () => {
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
      if (e.routing === "ortho"){
        const helper = document.createElement("div");
        helper.className = "helper";
        helper.textContent = "Drag the square waypoint on the canvas. It snaps to this link’s endpoint, stub, and midpoint coordinates.";
        appendInspector(helper);
        frow("Waypoint", () => {
          const button = mkBtn("Reset to automatic", () => resetOrthoBend(e));
          button.id = "edgeResetOrthoBend";
          button.disabled = !hasCustomOrthoBend(e);
          return button;
        });
      }
      if (a.type === "table" && b.type === "table" && e.kind !== "link") renderPairEditor(a, b, e);
      else renderEdgeEndControls(a, b, e);
    });
    inspectorSection("edge:appearance", "Appearance", () => {
      frow("Arrows", () => {
      const row = document.createElement("div");
      row.className = "edgearrowrow";
      const start = mkFlag("START", !!e.startArrow, on => { setEdgeArrow(e, "startArrow", on); render(); });
      const end = mkFlag("END", !!e.endArrow, on => { setEdgeArrow(e, "endArrow", on); render(); });
      start.id = "edgeStartArrow"; end.id = "edgeEndArrow";
      start.setAttribute("aria-label", "Toggle start arrow");
      end.setAttribute("aria-label", "Toggle end arrow");
      row.append(start, end);
        return row;
      });
      frow("Line style", () => edgeStyleSelect(e, "edgeLineStyle"));
      frow("Line width", () => sizeStepper(edgeLineWidth(e), 1, 8, .5,
        (v, commit) => {
          pushHistory("edge-width:"+e.id);
          e.lineWidth = v;
          commit ? render() : drawOnly();
        }, { ariaLabel:"Line width" }));
      frow("Line color", () => {
        const control = swatches(tableColors(), edgeLineColor(e),
          (c, commit) => {
            pushHistory("edge-color:"+e.id);
            e.lineColor = c;
            commit ? render() : drawOnly();
          });
        control.id = "edgeLineColor";
        return control;
      });
    }, {open:false});
    inspectorSection("edge:label", "Label", () => {
      frow("Relationship", () => edgeRelationshipSelect(e, { id:"edgeRelationshipSelect", onCustom:focusEdgeLabelInput }));
      frow("Label text", () => {
        const i = mkInput(e.label, v => {
          e.label = v;
          const s = document.getElementById("edgeRelationshipSelect");
          if (s) s.value = edgeRelationshipValue(v);
          drawOnly();
        });
        i.id = "edgeLabelInput";
        i.placeholder = "Custom relationship text";
        return i;
      });
      frow("Text color", () => {
        const control = colorOverrideControl(fontColors(), e.labelTextColor, edgeLineColor(e),
          (c, commit) => {
            pushHistory("edge-label-text:"+e.id);
            e.labelTextColor = c;
            commit ? render() : drawOnly();
          }, () => {
            if (!normalizeHex(e.labelTextColor)) return;
            pushHistory();
            delete e.labelTextColor;
            render();
          }, {inheritLabel:"link color", key:"label-text"});
        control.id = "edgeLabelTextColor";
        return control;
      });
      frow("Background color", () => {
        const control = colorOverrideControl(conceptColors(), e.labelBackgroundColor, themeColors().labelBg,
          (c, commit) => {
            pushHistory("edge-label-background:"+e.id);
            e.labelBackgroundColor = c;
            commit ? render() : drawOnly();
          }, () => {
            if (!normalizeHex(e.labelBackgroundColor)) return;
            pushHistory();
            delete e.labelBackgroundColor;
            render();
          }, {inheritLabel:"canvas background", key:"label-background"});
        control.id = "edgeLabelBackgroundColor";
        return control;
      });
    });
    inspectorActions([mkBtn("Swap direction", () => {
      pushHistory();
      swapEdgeDirection(e);
      render();
    })], mkBtn("Delete edge", deleteSelection, "dangerbtn"), {inlineDanger:true});
  }
}

function renderMultiInspector(){
  const nodes = selectedNodes();
  const nonStructural = nodes.filter(n => !isStructuralNode(n));
  setInspectorHeader("Multi-selection", `${nodes.length} nodes`);
  inspectorSection("multi:appearance", "Appearance", () => {
    const helper = document.createElement("div");
    helper.className = "helper";
    helper.textContent = "Changes apply to every selected node.";
    appendInspector(helper);
    frow("Color", () => swatches([...conceptColors(), ...tableColors()], nodes[0].color,
      (c, commit) => {
        pushHistory("color:multi");
        for (const n of nodes) n.color = c;
        commit ? render() : drawOnly();
      }));
    if (nonStructural.length === nodes.length){
      if (nodes.every(n => n.type === "concept") || nodes.every(n => n.type === "text")){
        frow("Shape", () => {
          const s = document.createElement("select");
          const textNodes = nodes[0].type === "text";
          s.setAttribute("aria-label", textNodes ? "Text box shape" : "Flowchart shape");
          const current = textNodes ? textBoxShape(nodes[0]) : conceptShape(nodes[0]);
          for (const [value, label] of textNodes ? TEXT_BOX_SHAPES : FLOWCHART_SHAPES){
            const o = document.createElement("option");
            o.value = value; o.textContent = label;
            if (current === value) o.selected = true;
            s.appendChild(o);
          }
          s.addEventListener("change", () => {
            pushHistory();
            for (const n of nodes){
              if (textNodes) setTextBoxShape(n, s.value); else setConceptShape(n, s.value);
            }
            render();
          });
          return s;
        });
      }
      frow("Text size", () => sizeStepper(nodeTextSize(nodes[0]),
        8, 48, 1, (v, commit) => {
          pushHistory("fs:multi");
          for (const n of nodes) n.fontSize = clampNodeTextSize(n, v);
          commit ? render() : drawOnly();
        }));
      frow("Text color", () => swatches(fontColors(), nodes[0].fontColor || "#16232F",
        (c, commit) => {
          pushHistory("fc:multi");
          for (const n of nodes) n.fontColor = c;
          commit ? render() : drawOnly();
        }));
    }
  });
  inspectorActions([mkBtn("Duplicate", duplicateSelection)], mkBtn("Delete", deleteSelection, "dangerbtn"));
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
function renderEdgeEndControls(a, b, e){
  const grid = document.createElement("div");
  grid.className = "edge-end-grid";
  appendInspector(grid);
  const firstPair = edgeFieldPairs(e)[0] || {};
  const ends = [
    {which:"From", node:a, fieldKey:"fromField", anchorKey:"fromAnchor", bound:firstPair.fromField || e.fromField},
    {which:"To", node:b, fieldKey:"toField", anchorKey:"toAnchor", bound:firstPair.toField || e.toField}
  ];
  const previous = inspectorMount;
  for (const end of ends){
    const column = document.createElement("div");
    column.className = "edge-end-column";
    grid.appendChild(column);
    inspectorMount = column;
    attachRow(end.which, end.node, e, end.fieldKey);
    if (!end.bound) anchorRow(end.which, e, end.anchorKey);
  }
  inspectorMount = previous;
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
  appendInspector(wrapD);
}

function renderFieldEditor(n){
  const wrapD = document.createElement("div");
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
  appendInspector(wrapD);

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

  wrapD.appendChild(mkBtn("+ Add item", () => addTodoItem(n)));
  appendInspector(wrapD);
}

function renderHelp(){
  const h = document.createElement("div");
  h.className = "helper";
  h.innerHTML = `
    <p><b>Flexible primitives, one canvas.</b><br>
    Concepts sketch the business thinking, plain text adds titles and labels, rich notes preserve
    formatted context, tables carry the data model, and to-do lists track the work. Link them freely — a label, note, or idea
    can point at an entity, an exact column, or the task that will deliver it.</p>
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
    <kbd>C</kbd> concept · <kbd>X</kbd> plain text · <kbd>N</kbd> note · <kbd>T</kbd> table · <kbd>⇥ Tab</kbd> linked child ·
    <kbd>Del</kbd> delete · <kbd>Ctrl+Z</kbd> undo · <kbd>Ctrl+D</kbd> duplicate ·
    <kbd>F</kbd> fit · <kbd>Shift</kbd>+drag snap · arrows nudge</p>
    <p style="margin-top:12px"><b>Type &amp; color</b><br>
    Select a node to set fill, <b>text size</b>, and <b>text color</b> in this panel — or right-click for the same. Nodes grow to fit larger text.</p>
    <p style="margin-top:12px"><b>Persistence</b><br>
    Use <b>Open</b>, <b>Save</b>, and <b>Save As</b> for local document workflow. Unsupported browsers fall back to <b>JSON ↓</b> downloads and <b>Import</b> uploads.
    <b>SQL</b> drafts CREATE TABLE statements from table nodes and 1:N edges.</p>`;
  appendInspector(h);
}

/* small builders */
function frow(label, buildCtrl){
  const d = document.createElement("div");
  d.className = "frow";
  const l = document.createElement("label");
  l.textContent = label;
  d.append(l, buildCtrl());
  appendInspector(d);
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
function sizeStepper(current, lo, hi, step, apply, opts = {}){
  const row = document.createElement("div");
  row.className = "sizestepper";
  const dec = document.createElement("button");
  dec.type = "button"; dec.className = "stepbtn"; dec.textContent = "−";
  const num = document.createElement("input");
  num.type = "text"; num.className = "sizeval"; num.value = String(current);
  num.setAttribute("aria-label", opts.ariaLabel || "Font size");
  const inc = document.createElement("button");
  inc.type = "button"; inc.className = "stepbtn"; inc.textContent = "+";
  const unit = document.createElement("span");
  unit.className = "sizeunit"; unit.textContent = opts.unit || "px";
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
function colorOverrideControl(colors, explicit, fallback, apply, reset, opts = {}){
  const inherited = !normalizeHex(explicit);
  const wrap = swatches(colors, inherited ? fallback : explicit, apply);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "flag colorinherit" + (inherited ? " on" : "");
  button.textContent = inherited ? `Using ${opts.inheritLabel}` : `Reset to ${opts.inheritLabel}`;
  button.setAttribute("aria-pressed", String(inherited));
  button.setAttribute("data-color-inherit", opts.key || "color");
  button.addEventListener("click", reset);
  wrap.insertBefore(button, wrap.firstChild);
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
  for (const n of state.nodes) if (isStructuralNode(n)) drawStructuralNode(n);
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) if (!isStructuralNode(n)) drawNode(n);
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
  applyColorScheme(null);
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
document.getElementById("btnInspector").addEventListener("click", toggleInspector);
document.getElementById("btnAddConcept").addEventListener("click", () => { const c = viewCenter(); addNode("concept", c.x-65, c.y-24); });
document.getElementById("btnAddText").addEventListener("click", () => { const c = viewCenter(); addNode("text", c.x-TEXT_W_DEFAULT/2, c.y-20); });
document.getElementById("btnAddNote").addEventListener("click", () => { const c = viewCenter(); addNode("note", c.x-NOTE_W_DEFAULT/2, c.y-60); });
document.getElementById("btnAddTable").addEventListener("click", () => { const c = viewCenter(); addNode("table", c.x-95, c.y-40); });
document.getElementById("btnAddTodo").addEventListener("click", () => { const c = viewCenter(); addNode("todo", c.x-90, c.y-30); });
document.getElementById("btnSnap").addEventListener("click", toggleSnapToGrid);
document.getElementById("btnCleanup").addEventListener("click", cleanUpToGrid);
document.getElementById("autoSaveToggle").addEventListener("change", ev => setAutoSave(ev.target.checked));
document.getElementById("btnAddFrame").addEventListener("click", () => { const c = viewCenter(); addNode("frame", c.x-FRAME_DEFAULT.w/2, c.y-FRAME_DEFAULT.h/2); });
document.getElementById("btnAddHorizontalLane").addEventListener("click", () => addSwimlane("horizontal"));
document.getElementById("btnAddVerticalLane").addEventListener("click", () => addSwimlane("vertical"));
document.getElementById("btnLayoutTree").addEventListener("click", layoutMindMapTree);
document.getElementById("btnLayoutSchema").addEventListener("click", layoutSchemaTables);
document.getElementById("btnLint").addEventListener("click", openLintModal);
document.getElementById("btnAlignTop").addEventListener("click", () => alignSelection("top"));
document.getElementById("btnAlignMiddle").addEventListener("click", () => alignSelection("centerY"));
document.getElementById("btnAlignBottom").addEventListener("click", () => alignSelection("bottom"));
document.getElementById("btnAlignLeft").addEventListener("click", () => alignSelection("left"));
document.getElementById("btnAlignCenter").addEventListener("click", () => alignSelection("centerX"));
document.getElementById("btnAlignRight").addEventListener("click", () => alignSelection("right"));
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
    "-- Table nodes only; concepts, rich notes, and to-do lists are not exported.",""];
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
  for (const textNode of nodes.filter(n => n.type === "text")){
    if (!String(textNode.title || "").trim())
      issues.push({level:"warning", msg:"Plain text item is empty", nodeId:textNode.id});
  }
  for (const e of edges){
    if (e.kind === "link") continue;
    const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
    if (linkOnlyNode(a) || linkOnlyNode(b)){
      const linked = linkOnlyNode(a) ? a : b;
      const kind = linked && linked.type === "note" ? "rich note"
        : linked && linked.type === "text" ? "plain text" : "to-do list";
      issues.push({level:"error", msg:`Relation ${e.kind} touches a ${kind} — use a link edge`, edgeId:e.id});
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
      title:src.title, notes:"", color:tableColors()[i % tableColors().length],
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
  const lines = ["erDiagram", "  %% Tables and relations only — concepts, links, rich notes, and to-do lists are omitted."];
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
  const outlineRoots = state.nodes.filter(n => n.type === "concept" || n.type === "todo" || n.type === "note");
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
    else if (n.type === "note"){
      lines.push(`${indent}- **${n.title || "Rich note"}**`);
      for (const contentLine of String(n.content || "").split(/\r?\n/))
        lines.push(contentLine ? `${indent}  ${contentLine}` : "");
    }
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
  clone.querySelectorAll("[data-handle], [data-fieldhandle], [data-frame-resize], [data-edgegrip], [data-edgebend], [data-ortho-snap-x], [data-ortho-snap-y], [data-align-guide-x], [data-align-guide-y], [data-text-selection]").forEach(h => h.remove());
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
    notes:"", color:tableColors()[state.nodes.filter(n => n.type === "table").length % tableColors().length],
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
  clone.querySelectorAll("[data-handle], [data-fieldhandle], [data-frame-resize], [data-edgegrip], [data-edgebend], [data-ortho-snap-x], [data-ortho-snap-y], [data-align-guide-x], [data-align-guide-y], [data-text-selection]").forEach(h => h.remove());
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
ctxMenu.setAttribute("role", "menu");
document.body.appendChild(ctxMenu);
let ctxAnchor = {x:0, y:0};
const ctxDisclosureState = new Map();

function hideCtx(){ ctxMenu.style.display = "none"; ctxMenu.innerHTML = ""; }
function fitCtxMenu(){
  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = (ctxAnchor.x + r.width > window.innerWidth ? Math.max(4, ctxAnchor.x - r.width) : ctxAnchor.x) + "px";
    ctxMenu.style.top = (ctxAnchor.y + r.height > window.innerHeight ? Math.max(4, ctxAnchor.y - r.height) : ctxAnchor.y) + "px";
  });
}
function showCtx(x, y, build){
  ctxMenu.innerHTML = "";
  build(ctxMenu);
  ctxAnchor = {x, y};
  ctxMenu.style.display = "block";
  ctxMenu.style.left = x + "px";
  ctxMenu.style.top  = y + "px";
  fitCtxMenu();
}
function contextIcon(kind){
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ctxicon");
  const shape = document.createElementNS(SVGNS, kind === "edge" ? "path" : "rect");
  if (kind === "edge"){
    shape.setAttribute("d", "M3 4c7 0 7 12 14 12M3 4l3-2M3 4l2 3M17 16l-3-2M17 16l-2 2");
    shape.setAttribute("fill", "none");
  } else {
    shape.setAttribute("x", "3"); shape.setAttribute("y", "4");
    shape.setAttribute("width", "14"); shape.setAttribute("height", "12"); shape.setAttribute("rx", "3");
    shape.setAttribute("fill", "none");
  }
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", "1.4");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  svg.appendChild(shape);
  return svg;
}
function ctxHeader(parent, kind, title){
  parent.setAttribute("aria-label", `${kind === "edge" ? "Edge" : kind === "canvas" ? "Canvas" : "Node"} actions: ${title}`);
  const header = document.createElement("div");
  header.className = "ctxhead";
  header.appendChild(contextIcon(kind));
  const copy = document.createElement("div");
  const type = document.createElement("small");
  type.textContent = kind === "edge" ? "Edge" : kind === "canvas" ? "Canvas" : "Node";
  const name = document.createElement("strong");
  name.textContent = title;
  copy.append(type, name);
  header.appendChild(copy);
  parent.appendChild(header);
}
function ctxGroup(parent, key, label, build, opts = {}){
  const details = document.createElement("details");
  details.className = "ctxgroup";
  details.setAttribute("data-ctx-group", key);
  const stored = ctxDisclosureState.get(key);
  details.open = stored == null ? !!opts.open : stored;
  const summary = document.createElement("summary");
  const text = document.createElement("span");
  text.textContent = label;
  summary.append(text, disclosureChevron());
  const body = document.createElement("div");
  body.className = "ctxgroupbody";
  build(body);
  details.append(summary, body);
  details.addEventListener("toggle", () => {
    ctxDisclosureState.set(key, details.open);
    fitCtxMenu();
  });
  parent.appendChild(details);
  return details;
}
function ctxItem(parent, label, fn, opts = {}){
  const b = document.createElement("button");
  b.className = "ctxitem" + (opts.danger ? " danger" : "");
  b.setAttribute("role", "menuitem");
  if (opts.action) b.setAttribute("data-ctx-action", opts.action);
  if (opts.pressed != null) b.setAttribute("aria-pressed", String(!!opts.pressed));
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
function ctxColorOverride(parent, colors, explicit, fallback, apply, reset, opts = {}){
  const inherited = !normalizeHex(explicit);
  const wrap = document.createElement("div");
  wrap.setAttribute("data-color-override", opts.key || "color");
  parent.appendChild(wrap);
  ctxItem(wrap, inherited ? `✓ Use ${opts.inheritLabel}` : `Reset to ${opts.inheritLabel}`, () => {
    if (!inherited) reset();
  }, {action:opts.action});
  ctxSwatches(wrap, colors, inherited ? fallback : explicit, apply);
}
/* compact font-size stepper for the context menu */
function ctxSizeRow(parent, n, targets = [n]){
  const isC = n.type === "concept", isNote = n.type === "note", isText = n.type === "text";
  const cur = nodeTextSize(n);
  const wrap = document.createElement("div");
  wrap.className = "swrow";
  wrap.appendChild(sizeStepper(cur, isC ? 9 : isNote || isText ? 10 : 8, isText ? 72 : isC ? 48 : 28, isC || isNote || isText ? 1 : 0.5,
    (v, commit) => {
      pushHistory(targets.length > 1 ? "fs:multi" : "fs:"+n.id);
      for (const t of targets) t.fontSize = clampNodeTextSize(t, v);
      commit ? render() : drawOnly();
    }));
  parent.appendChild(wrap);
}
/* Standard concept symbols, kept compact enough to fit the right-click menu. */
function ctxShapeRow(parent, n, targets = [n]){
  if (n.type !== "concept" && n.type !== "text") return;
  const matching = targets.filter(t => t.type === n.type);
  if (!matching.length) return;
  const options = n.type === "text" ? TEXT_BOX_SHAPES : FLOWCHART_SHAPES;
  const current = n.type === "text" ? textBoxShape(n) : conceptShape(n);
  const row = document.createElement("div");
  row.className = "shaperow";
  for (const [shape, label] of options){
    const b = document.createElement("button");
    b.textContent = label;
    b.title = label;
    b.setAttribute("data-shape-option", shape);
    b.setAttribute("aria-pressed", String(current === shape));
    if (current === shape) b.className = "on";
    b.addEventListener("click", () => {
      hideCtx();
      pushHistory(matching.length > 1 ? "shape:multi" : "shape:" + n.id);
      for (const target of matching){
        if (target.type === "text") setTextBoxShape(target, shape);
        else setConceptShape(target, shape);
      }
      render();
    });
    row.appendChild(b);
  }
  parent.appendChild(row);
}

function nodeMenu(n, x, y){
  const targets = isSelected("node", n.id) ? selectedNodes() : [n];
  const applyToTargets = (fn) => {
    for (const t of targets) fn(t);
  };
  showCtx(x, y, m => {
    ctxHeader(m, "node", targets.length > 1 ? `${targets.length} nodes selected` : n.title || "Untitled");
    ctxGroup(m, "node:appearance", "Appearance", panel => {
      const palette = [...new Set([...conceptColors(), ...tableColors()])];
      ctxLabel(panel, n.type === "swimlane" ? "Body background" : n.type === "text" ? "Shape background" : n.type === "concept" ? "Color" : n.type === "frame" ? "Frame color"
                : n.type === "todo" ? "List color" : n.type === "note" ? "Note color" : "Header color");
      ctxSwatches(panel, n.type === "swimlane" ? palette : (n.type === "concept" || n.type === "text" || n.type === "todo" || n.type === "note") ? conceptColors() : tableColors(), n.color,
        (c, commit) => { pushHistory(targets.length > 1 ? "color:multi" : "color:"+n.id); applyToTargets(t => { t.color = c; }); commit ? render() : drawOnly(); });
      if (n.type === "swimlane"){
        ctxLabel(panel, "Title background");
        ctxSwatches(panel, palette, n.titleColor || SWIMLANE_DEFAULT.titleColor,
          (c, commit) => { pushHistory(targets.length > 1 ? "lane-title:multi" : "lane-title:"+n.id);
            applyToTargets(t => { if (t.type === "swimlane") t.titleColor = c; }); commit ? render() : drawOnly(); });
      }
      if (n.type === "concept" || n.type === "text"){
        ctxLabel(panel, "Shape");
        ctxShapeRow(panel, n, targets);
      }
      if (!isStructuralNode(n)){
        if (n.type === "text"){
          ctxLabel(panel, "Maximum width");
          const widthRow = document.createElement("div");
          widthRow.className = "swrow";
          widthRow.appendChild(sizeStepper(n.w || TEXT_W_DEFAULT, 80, 720, 20,
            (v, commit) => {
              pushHistory(targets.length > 1 ? "size:multi" : "size:"+n.id);
              applyToTargets(t => { if (t.type === "text") t.w = v; });
              commit ? render() : drawOnly();
            }, {ariaLabel:"Maximum width"}));
          panel.appendChild(widthRow);
        }
        ctxLabel(panel, "Text size");
        ctxSizeRow(panel, n, targets);
        ctxLabel(panel, "Text color");
        ctxSwatches(panel, fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory(targets.length > 1 ? "fc:multi" : "fc:"+n.id); applyToTargets(t => { t.fontColor = c; }); commit ? render() : drawOnly(); });
      }
    });
    if (n.type === "swimlane") ctxGroup(m, "node:orientation", "Orientation", panel => {
      for (const [orientation, label] of [["horizontal","Horizontal lane"],["vertical","Vertical lane"]]){
        ctxItem(panel, (swimlaneOrientation(n) === orientation ? "✓ " : "") + label, () => {
          const lanes = targets.filter(t => t.type === "swimlane" && swimlaneOrientation(t) !== orientation);
          if (!lanes.length) return;
          pushHistory(targets.length > 1 ? "lane-orientation:multi" : "lane-orientation:"+n.id);
          for (const lane of lanes) setSwimlaneOrientation(lane, orientation);
          render();
        });
      }
    }, {open:true});
    ctxItem(m, n.type === "text" ? "Edit text" : "Edit title", () => startInlineEditor("node", n.id), {kbd:"dbl-click"});
    if (n.type === "note") ctxItem(m, "Edit note content", () => { setSelection("node", n.id); render(); focusNoteInput(); });
    if (!isStructuralNode(n)) ctxItem(m, "Add linked concept", addChildConcept, {kbd:"Tab"});
    if (n.type === "table" || n.type === "todo"){
      ctxGroup(m, "node:content", n.type === "table" ? "Table content" : "List content", panel => {
        if (n.type === "table"){
          ctxItem(panel, "Add related table (1:N)", () => addRelatedTable(n.id));
          ctxItem(panel, n.collapsed ? "Expand fields" : "Collapse fields", () => {
            pushHistory();
            n.collapsed = !n.collapsed;
            render();
          });
          ctxItem(panel, "Add field", () => {
            pushHistory();
            n.fields.push({id: uid(), name:"field_" + (n.fields.length+1),
                           type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
            render();
          });
        } else {
          ctxItem(panel, n.collapsed ? "Expand items" : "Collapse items", () => {
            pushHistory();
            n.collapsed = !n.collapsed;
            render();
          });
          ctxItem(panel, "Add item", () => addTodoItem(n));
        }
      });
    }
    ctxItem(m, "Duplicate", duplicateSelection, {kbd:"Ctrl+D"});
    ctxGroup(m, "node:arrange", "Arrange", panel => {
      if (targets.length >= 2){
        ctxLabel(panel, "Align selection");
        ctxItem(panel, "Align left", () => alignSelection("left"));
        ctxItem(panel, "Align right", () => alignSelection("right"));
        ctxItem(panel, "Align top", () => alignSelection("top"));
        ctxItem(panel, "Align bottom", () => alignSelection("bottom"));
        ctxItem(panel, "Center horizontally", () => alignSelection("centerX"));
        ctxItem(panel, "Center vertically", () => alignSelection("centerY"));
        ctxItem(panel, "Distribute horizontally", () => alignSelection("distributeX"));
        ctxItem(panel, "Distribute vertically", () => alignSelection("distributeY"));
        ctxSep(panel);
      }
      ctxItem(panel, "Bring to front", () => reorderNode(n.id, true));
      ctxItem(panel, "Send to back",   () => reorderNode(n.id, false));
    });
    ctxSep(m);
    ctxItem(m, "Delete node", deleteSelection, {kbd:"Del", danger:true});
  });
}
function edgeMenu(e, x, y){
  const a = nodeById(e.from), b = nodeById(e.to);
  const touchesLinkOnlyNode = linkOnlyNode(a) || linkOnlyNode(b);
  showCtx(x, y, m => {
    ctxHeader(m, "edge", `${a.title} → ${b.title}`);
    ctxGroup(m, "edge:relationship", "Relationship", panel => {
      if (!touchesLinkOnlyNode){
        ctxLabel(panel, "Relation type");
        const row = document.createElement("div");
        row.className = "kindrow";
        for (const k of ["link","1:1","1:N","N:M"]){
          const btn = document.createElement("button");
          btn.textContent = k;
          if (e.kind === k) btn.className = "on";
          btn.addEventListener("click", () => { hideCtx(); pushHistory(); e.kind = k; render(); });
          row.appendChild(btn);
        }
        panel.appendChild(row);
      }
      ctxLabel(panel, "Relationship preset");
      const relationshipRow = document.createElement("div");
      relationshipRow.className = "swrow";
      relationshipRow.appendChild(edgeRelationshipSelect(e, {
        close:hideCtx,
        onCustom:() => startInlineEditor("edge", e.id)
      }));
      panel.appendChild(relationshipRow);
      ctxLabel(panel, "Label text color");
      ctxColorOverride(panel, fontColors(), e.labelTextColor, edgeLineColor(e),
        (c, commit) => {
          pushHistory("edge-label-text:"+e.id);
          e.labelTextColor = c;
          commit ? render() : drawOnly();
        }, () => {
          pushHistory();
          delete e.labelTextColor;
          render();
        }, {inheritLabel:"link color", action:"inherit-label-text", key:"label-text"});
      ctxLabel(panel, "Label background");
      ctxColorOverride(panel, conceptColors(), e.labelBackgroundColor, themeColors().labelBg,
        (c, commit) => {
          pushHistory("edge-label-background:"+e.id);
          e.labelBackgroundColor = c;
          commit ? render() : drawOnly();
        }, () => {
          pushHistory();
          delete e.labelBackgroundColor;
          render();
        }, {inheritLabel:"canvas background", action:"inherit-label-background", key:"label-background"});
    });
    ctxGroup(m, "edge:appearance", "Appearance", panel => {
      ctxLabel(panel, "Arrows");
      const arrowRow = document.createElement("div");
      arrowRow.className = "kindrow";
      for (const [key, label] of [["startArrow","Start"],["endArrow","End"]]){
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.setAttribute("data-edge-arrow-toggle", key === "startArrow" ? "start" : "end");
        if (e[key]) btn.className = "on";
        btn.addEventListener("click", () => {
          hideCtx();
          pushHistory();
          setEdgeArrow(e, key, !e[key]);
          render();
        });
        arrowRow.appendChild(btn);
      }
      panel.appendChild(arrowRow);
      ctxLabel(panel, "Line style");
      const styleRow = document.createElement("div");
      styleRow.className = "swrow";
      styleRow.appendChild(edgeStyleSelect(e, null, {close:hideCtx}));
      panel.appendChild(styleRow);
      ctxLabel(panel, "Line width");
      const widthRow = document.createElement("div");
      widthRow.className = "swrow";
      widthRow.appendChild(sizeStepper(edgeLineWidth(e), 1, 8, .5,
        (v, commit) => {
          pushHistory("edge-width:"+e.id);
          e.lineWidth = v;
          if (commit){ hideCtx(); render(); } else drawOnly();
        }, {ariaLabel:"Line width"}));
      panel.appendChild(widthRow);
      ctxLabel(panel, "Line color");
      ctxSwatches(panel, tableColors(), edgeLineColor(e),
        (c, commit) => {
          pushHistory("edge-color:"+e.id);
          e.lineColor = c;
          commit ? render() : drawOnly();
        });
    });
    ctxGroup(m, "edge:routing", "Routing", panel => {
      const routeRow = document.createElement("div");
      routeRow.className = "kindrow";
      for (const k of ["curve","ortho"]){
        const button = document.createElement("button");
        button.textContent = k === "curve" ? "Curve" : "Ortho";
        if ((e.routing || "curve") === k) button.className = "on";
        button.addEventListener("click", () => {
          hideCtx();
          pushHistory();
          if (k === "ortho") e.routing = "ortho"; else delete e.routing;
          render();
        });
        routeRow.appendChild(button);
      }
      panel.appendChild(routeRow);
      if (e.routing === "ortho"){
        ctxLabel(panel, "Waypoint");
        const note = document.createElement("div");
        note.className = "ctxhint";
        note.textContent = "Drag the square handle on the canvas; each axis snaps independently.";
        panel.appendChild(note);
        if (hasCustomOrthoBend(e)) ctxItem(panel, "Reset to automatic", () => resetOrthoBend(e));
      }
    });
    ctxItem(m, "Swap direction", () => {
      pushHistory();
      swapEdgeDirection(e);
      render();
    });
    ctxItem(m, "Edit label text", () => startInlineEditor("edge", e.id), {kbd:"dbl-click"});
    ctxSep(m);
    ctxItem(m, "Delete edge", deleteSelection, {kbd:"Del", danger:true});
  });
}
function canvasMenu(w, x, y){
  showCtx(x, y, m => {
    ctxHeader(m, "canvas", "Create, arrange, or view");
    ctxGroup(m, "canvas:create", "Create", panel => {
      ctxItem(panel, "Concept", () => addNodeCentered("concept", w), {kbd:"C", action:"add-concept"});
      ctxItem(panel, "Plain text", () => addNodeCentered("text", w), {kbd:"X", action:"add-text"});
      ctxItem(panel, "Rich note", () => addNodeCentered("note", w), {kbd:"N", action:"add-note"});
      ctxItem(panel, "Table", () => addNodeCentered("table", w), {kbd:"T", action:"add-table"});
      ctxItem(panel, "To-do list", () => addNodeCentered("todo", w), {kbd:"D", action:"add-todo"});
      ctxItem(panel, "Frame", () => addNodeCentered("frame", w), {action:"add-frame"});
      ctxItem(panel, "Horizontal swimlane", () => addNodeCentered("swimlane", w, {orientation:"horizontal"}), {action:"add-horizontal-lane"});
      ctxItem(panel, "Vertical swimlane", () => addNodeCentered("swimlane", w, {orientation:"vertical"}), {action:"add-vertical-lane"});
    }, {open:true});
    ctxGroup(m, "canvas:layout", "Layout", panel => {
      ctxItem(panel, "Tree layout", layoutMindMapTree, {action:"layout-tree"});
      ctxItem(panel, "Schema layout", layoutSchemaTables, {action:"layout-schema"});
      ctxItem(panel, "Clean up to grid", cleanUpToGrid, {action:"cleanup-grid"});
      ctxItem(panel, "Snap to grid", toggleSnapToGrid, {action:"toggle-snap", pressed:snapToGrid});
    });
    ctxGroup(m, "canvas:view", "View", panel => {
      ctxItem(panel, "Fit diagram", fitView, {kbd:"F", action:"fit"});
      ctxItem(panel, "Actual size (100%)", () => zoomAtClient(1, x, y), {action:"zoom-actual"});
      ctxSep(panel);
      ctxItem(panel, "Zoom in", () => zoomAtClient(view.k * 1.2, x, y), {action:"zoom-in"});
      ctxItem(panel, "Zoom out", () => zoomAtClient(view.k / 1.2, x, y), {action:"zoom-out"});
    });
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
  const E = (from, to, kind, label, fromField, toField, options = {}) => {
    const e = {id: uid(), from, to, kind, label: label||""};
    if (fromField) e.fromField = fromField;
    if (toField)   e.toField   = toField;
    Object.assign(e, options);
    state.edges.push(e);
    return e.id;
  };

  const strategy = N({type:"concept", x:60,  y:220, title:"Loyalty program launch", notes:"Q3 initiative — north star: repeat purchase rate.", color:"#FFE9A8"});
  const tiers    = N({type:"concept", x:320, y:90,  title:"Tiered rewards", notes:"", color:"#CFE8FF"});
  const referral = N({type:"concept", x:320, y:180, title:"Referral engine", notes:"", color:"#CFE8FF"});
  const measure  = N({type:"concept", x:320, y:350, title:"Measurement plan", notes:"Holdout design + CUPED on pre-period spend.", color:"#D8F3DC"});

  const customers = N({type:"table", x:720, y:60, title:"customers", color:"#16232F", notes:"", fields:[
    {id:"f_cust_pk",   name:"customer_id", type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_cust_email",name:"email",       type:"VARCHAR(255)", pk:false, fk:false, nullable:false},
    {id:"f_cust_tier", name:"tier",        type:"VARCHAR(20)",  pk:false, fk:false, nullable:true},
    {id:"f_cust_join", name:"joined_at",   type:"TIMESTAMP",    pk:false, fk:false, nullable:false}]});
  const orders = N({type:"table", x:990, y:80, title:"orders", color:"#2456E6", notes:"", fields:[
    {id:"f_ord_pk",   name:"order_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_ord_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_ord_total",name:"total",       type:"DECIMAL(12,2)", pk:false, fk:false, nullable:false},
    {id:"f_ord_ts",   name:"placed_at",   type:"TIMESTAMP",     pk:false, fk:false, nullable:false}]});
  const rewards = N({type:"table", x:720, y:330, title:"reward_events", color:"#1E7A4F", notes:"", fields:[
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

  /* The fresh document doubles as a compact feature tour. Structural nodes are
     intentionally added after the original example so its established ids and
     edge order remain stable; render() still paints containers behind content. */
  N({type:"text", x:38, y:12, title:"Loyalty program system map", fontSize:30,
     fontColor:"#16232F", color:"#CFE8FF", w:520});
  N({type:"frame", x:30, y:75, title:"Strategy & experiments", color:"#007873", w:500, h:425});
  N({type:"swimlane", orientation:"horizontal", x:560, y:30, title:"Data model",
     color:"#E7F4F3", titleColor:"#007873", w:690, h:490});
  N({type:"swimlane", orientation:"vertical", x:1280, y:30, title:"Delivery & evidence",
     color:"#FBE8EC", titleColor:"#C20029", w:300, h:490});
  const evidence = N({type:"note", x:1310, y:105, title:"Launch decision",
     content:"## Why this matters\n- **Hypothesis:** tiers increase repeat orders\n- [x] Define the holdout\n- [ ] Review guardrails\n`owner: Growth + Data`",
     color:"#FFE9A8", fontSize:13, w:240});
  const checklist = N({type:"todo", x:1320, y:350, title:"Launch readiness", notes:"",
     color:"#E9E2F8", items:[
       {id:"i_release_design", text:"Approve experiment design", done:true},
       {id:"i_release_events", text:"Validate tracking events"},
       {id:"i_release_readout", text:"Schedule results readout"}
     ]});

  E(orders, evidence, "link", "Produces", null, null, {
    fromAnchor:"mr", toAnchor:"ml", endArrow:true, lineColor:"#007873", lineStyle:"solid"
  });
  E(evidence, checklist, "link", "Triggers", null, null, {
    fromAnchor:"bc", toAnchor:"tc", routing:"ortho", endArrow:true,
    lineColor:"#007873", lineWidth:2.5, lineStyle:"dot",
    labelTextColor:"#FFFFFF", labelBackgroundColor:"#C20029"
  });
}
function perfSeed(n = 500){
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  clearSelection();
  for (let i = 0; i < n; i++){
    state.nodes.push({ id:uid(), type:"table", x:(i%25)*230, y:Math.floor(i/25)*130,
      title:"bench_" + i, color:tableColors()[i % tableColors().length], notes:"",
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
setupMenus();
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
  smartAlignmentSnap,
  alignmentGuideGeometry,
  conceptShape,
  setConceptShape,
  textBoxShape,
  setTextBoxShape,
  textBoxLayout,
  textBoxFont,
  wrapConceptTitle,
  conceptWrappedLayout,
  conceptContainsPoint,
  get FLOWCHART_SHAPES(){ return FLOWCHART_SHAPES.map(([id, label]) => ({id, label})); },
  get TEXT_BOX_SHAPES(){ return TEXT_BOX_SHAPES.map(([id, label]) => ({id, label})); },
  get EDGE_RELATIONSHIPS(){ return EDGE_RELATIONSHIPS.map(([name, meaning]) => ({name, meaning})); },
  nodeMenu,
  edgeMenu,
  edgeRelationshipValue,
  edgeRelationshipSelect,
  nodeAnchor,
  nodeRows,
  tableMetrics,
  fieldRowCenterY,
  cleanFieldRefs,
  rectsOverlap,
  documentBounds,
  hitTest,
  frameContainedNodes,
  containerContainedNodes,
  isStructuralNode,
  swimlaneOrientation,
  setSwimlaneOrientation,
  get SWIMLANE_DEFAULT(){ return JSON.parse(JSON.stringify(SWIMLANE_DEFAULT)); },
  addNode,
  addSwimlane,
  addEdge,
  edgeFieldPairs,
  setEdgePairs,
  edgeEndpoints,
  edgePath,
  edgeRenderPath,
  edgeLabelPoint,
  edgeLineColor,
  edgeLabelTextColor,
  edgeLabelBackgroundColor,
  polylineMidpoint,
  notationVertex,
  orthoEdgeRoute,
  snapOrthoBend,
  hasCustomOrthoBend,
  resetOrthoBend,
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
  normalizeColorScheme,
  applyColorScheme,
  get colorScheme(){ return colorScheme; },
  conceptColors,
  tableColors,
  fontColors,
  frameColorDefault,
  todoColorDefault,
  themeColors,
  autoInk,
  relativeLuminance,
  noteFont,
  richNoteInline,
  richNoteBlock,
  richNoteLayout,
  toggleInspector,
  updateInspectorVisibility,
  get inspectorPinned(){ return inspectorPinned; },
  textW,
  get textMeasureCacheSize(){ return textMeasureCache.size; },
  get renderStats(){ return renderStats; },
  selectNode(id){ setSelection("node", id); render(); },
  cloneSelectionPayload,
  remapPayload,
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
