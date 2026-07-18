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
  } else if (type === "status"){
    n = {id:uid(), type, x, y, title:"Status item", status:STATUS_DEFAULT, statusSide:"right",
         color:conceptColors()[1] || conceptColors()[0] || CONCEPT_COLORS[1],
         fontSize:STATUS_FS_DEFAULT, w:STATUS_W_DEFAULT};
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
  for (const n of remapped.nodes){
    if (n.type === "table") n.title = uniqueTableTitle(n.title, n);
    if (n.type === "status") normalizeNodeStatus(n);
  }
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
function matchSelectionWidths(mode){
  const nodes = selectedNodes();
  if (nodes.length < 2 || !["smallest","largest","average"].includes(mode)) return false;
  const widths = nodes.map(n => nodeRect(n).w);
  const rawTarget = mode === "smallest" ? Math.min(...widths)
                  : mode === "largest" ? Math.max(...widths)
                  : widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const target = clampSize(Math.round(rawTarget), 80, 4000);
  pushHistory();
  for (const node of nodes) setNodeWidth(node, target);
  render();
  return target;
}
function resetSelectionSizes(){
  const nodes = selectedNodes();
  const forced = nodes.filter(node => manualNodeWidth(node) != null);
  if (!forced.length) return false;
  pushHistory();
  for (const node of forced) resetNodeWidth(node);
  render();
  return forced.length;
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
