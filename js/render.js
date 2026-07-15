"use strict";

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
  for (const n of state.nodes) if (isStructuralNode(n)) drawStructuralNode(n);
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) if (!isStructuralNode(n)) drawNode(n);
  drawEdgeGrips();
  const frames = state.nodes.filter(n => n.type === "frame").length;
  const lanes = state.nodes.filter(n => n.type === "swimlane").length;
  const nodes = state.nodes.length - frames - lanes;
  const structural = [frames ? `${frames} frame${frames === 1 ? "" : "s"}` : "",
                      lanes ? `${lanes} lane${lanes === 1 ? "" : "s"}` : ""].filter(Boolean);
  document.getElementById("countLabel").textContent =
    `${nodes} nodes${structural.length ? ` · ${structural.join(" · ")}` : ""} · ${state.edges.length} edges`;
  renderMinimap();
  renderInspector();
  updateAlignMenu();
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
    const structural = isStructuralNode(n);
    const cleanText = n.type === "text" && textBoxShape(n) === "none";
    const fill = n.type === "frame" ? n.color || frameColorDefault()
      : cleanText ? n.fontColor || t.ink : n.color || t.ink;
    el("rect", {x:p.x, y:p.y, width:r.w*tx.scale, height:r.h*tx.scale, rx:structural ? 2 : 1.5,
                fill, opacity:structural ? .30 : .72, stroke:t.ink, "stroke-width":.35}, minimap);
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
  if (isStructuralNode(a) || isStructuralNode(b)) return null;
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
function curveEdgeCommand(pa, pb){
  const dx = Math.max(40, Math.abs(pb.x - pa.x) * 0.45);
  const dy = Math.max(40, Math.abs(pb.y - pa.y) * 0.45);
  const c = p => p.side === "e" ? [p.x + dx, p.y] : p.side === "w" ? [p.x - dx, p.y]
            : p.side === "s" ? [p.x, p.y + dy] : [p.x, p.y - dy];
  const [c1x, c1y] = c(pa), [c2x, c2y] = c(pb);
  return `C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pb.x} ${pb.y}`;
}
function curveEdgePath(pa, pb){
  return `M ${pa.x} ${pa.y} ${curveEdgeCommand(pa, pb)}`;
}
function hasCustomOrthoBend(e){
  return !!e && (Number.isFinite(e.orthoX) || Number.isFinite(e.orthoY));
}
function orthoEdgeRoute(e, pa, pb){
  const stub = 12;
  const out = p => {
    if (p.side === "e") return { x:p.x + stub, y:p.y };
    if (p.side === "w") return { x:p.x - stub, y:p.y };
    if (p.side === "s") return { x:p.x, y:p.y + stub };
    return { x:p.x, y:p.y - stub };
  };
  const a = out(pa), b = out(pb);
  const horizontal = pa.side === "e" || pa.side === "w" || pb.side === "e" || pb.side === "w";
  if (horizontal){
    const mx = (a.x + b.x) / 2;
    const bend = {
      x:Number.isFinite(e && e.orthoX) ? e.orthoX : mx,
      y:Number.isFinite(e && e.orthoY) ? e.orthoY : b.y
    };
    const custom = hasCustomOrthoBend(e);
    const d = custom
      ? `M ${pa.x} ${pa.y} L ${a.x} ${a.y} H ${bend.x} V ${bend.y} H ${b.x} V ${b.y} L ${pb.x} ${pb.y}`
      : `M ${pa.x} ${pa.y} L ${a.x} ${a.y} H ${mx} V ${b.y} H ${b.x} L ${pb.x} ${pb.y}`;
    const points = custom
      ? [pa, a, {x:bend.x, y:a.y}, bend, {x:b.x, y:bend.y}, b, pb]
      : [pa, a, {x:mx, y:a.y}, {x:mx, y:b.y}, b, pb];
    return { d, points, pa, pb, a, b, bend, horizontal, auto:{x:mx, y:b.y} };
  }
  const my = (a.y + b.y) / 2;
  const bend = {
    x:Number.isFinite(e && e.orthoX) ? e.orthoX : b.x,
    y:Number.isFinite(e && e.orthoY) ? e.orthoY : my
  };
  const custom = hasCustomOrthoBend(e);
  const d = custom
    ? `M ${pa.x} ${pa.y} L ${a.x} ${a.y} V ${bend.y} H ${bend.x} V ${b.y} H ${b.x} L ${pb.x} ${pb.y}`
    : `M ${pa.x} ${pa.y} L ${a.x} ${a.y} V ${my} H ${b.x} V ${b.y} L ${pb.x} ${pb.y}`;
  const points = custom
    ? [pa, a, {x:a.x, y:bend.y}, bend, {x:bend.x, y:b.y}, b, pb]
    : [pa, a, {x:a.x, y:my}, {x:b.x, y:my}, b, pb];
  return { d, points, pa, pb, a, b, bend, horizontal, auto:{x:b.x, y:my} };
}
function orthoEdgePath(pa, pb, e = null){
  return orthoEdgeRoute(e, pa, pb).d;
}
function polylineMidpoint(points){
  if (!Array.isArray(points) || !points.length) return {x:0, y:0};
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i++){
    const from = points[i-1], to = points[i];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) continue;
    segments.push({from, to, length});
    total += length;
  }
  if (!total) return {x:points[0].x, y:points[0].y};
  let remaining = total / 2;
  for (const segment of segments){
    if (remaining <= segment.length){
      const t = remaining / segment.length;
      return {
        x:segment.from.x + (segment.to.x - segment.from.x) * t,
        y:segment.from.y + (segment.to.y - segment.from.y) * t
      };
    }
    remaining -= segment.length;
  }
  const last = points[points.length - 1];
  return {x:last.x, y:last.y};
}
function edgeLabelPoint(e, ep){
  if (e && e.routing === "ortho") return polylineMidpoint(orthoEdgeRoute(e, ep.pa, ep.pb).points);
  return {x:(ep.pa.x + ep.pb.x)/2, y:(ep.pa.y + ep.pb.y)/2};
}
function nearestSnap(value, candidates, threshold){
  let best = null, distance = threshold + Number.EPSILON;
  for (const candidate of candidates){
    const nextDistance = Math.abs(value - candidate);
    if (nextDistance <= distance){ best = candidate; distance = nextDistance; }
  }
  return best;
}
function snapOrthoBend(e, point, ep = edgeEndpoints(e), threshold = 10 / view.k){
  if (!ep) return { x:point.x, y:point.y, snapX:null, snapY:null };
  const route = orthoEdgeRoute(null, ep.pa, ep.pb);
  const xs = [...new Set([route.pa.x, route.a.x, route.auto.x, route.b.x, route.pb.x])];
  const ys = [...new Set([route.pa.y, route.a.y, route.auto.y, route.b.y, route.pb.y])];
  const snapX = nearestSnap(point.x, xs, threshold);
  const snapY = nearestSnap(point.y, ys, threshold);
  return {
    x:snapX == null ? Math.round(point.x) : snapX,
    y:snapY == null ? Math.round(point.y) : snapY,
    snapX,
    snapY,
    xCandidates:xs,
    yCandidates:ys
  };
}
function resetOrthoBend(e){
  if (!hasCustomOrthoBend(e)) return false;
  pushHistory();
  delete e.orthoX;
  delete e.orthoY;
  render();
  return true;
}
function edgePath(e, pa, pb){
  if (!pb){ pb = pa; pa = e; e = null; }
  return e && e.routing === "ortho" ? orthoEdgePath(pa, pb, e) : curveEdgePath(pa, pb);
}
function edgeLineColor(e, colors = themeColors()){
  return normalizeHex(e && e.lineColor) || (e && e.kind === "link" ? colors.link : colors.edge);
}
function edgeLabelTextColor(e, colors = themeColors()){
  return normalizeHex(e && e.labelTextColor) || edgeLineColor(e, colors);
}
function edgeLabelBackgroundColor(e, colors = themeColors()){
  return normalizeHex(e && e.labelBackgroundColor) || colors.labelBg;
}
function edgeLineWidth(e){
  const width = Number(e && e.lineWidth);
  return Number.isFinite(width) ? Math.min(8, Math.max(1, width)) : 1.7;
}
function edgeLineStyle(e){
  return e && ["solid","dash","dot"].includes(e.lineStyle)
    ? e.lineStyle : e && e.kind === "link" ? "dash" : "solid";
}
function edgeDashArray(e){
  const style = edgeLineStyle(e);
  return style === "dash" ? "5 5" : style === "dot" ? "1 5" : "none";
}
const RELATION_GLYPH_LENGTH = 12;
function relationGlyphs(e){
  return e.kind === "1:1" ? ["one","one"]
       : e.kind === "1:N" ? ["one","many"] : ["many","many"];
}
function notationVertex(p){
  const dir = { e:[1,0], w:[-1,0], s:[0,1], n:[0,-1] }[p.side] || [1,0];
  return { ...p, x:p.x + dir[0]*RELATION_GLYPH_LENGTH, y:p.y + dir[1]*RELATION_GLYPH_LENGTH };
}
/* Cardinality glyphs sit on straight, tangent-aligned endpoint geometry. The
   Bezier runs only between the outward glyph vertices so it cannot cross a tick
   or the fanned crow's-foot prongs at an angle. */
function edgeRenderPath(e, ep){
  if (e.kind === "link" || e.routing === "ortho") return edgePath(e, ep.pa, ep.pb);
  const [fromGlyph, toGlyph] = relationGlyphs(e);
  const pa = notationVertex(ep.pa), pb = notationVertex(ep.pb);
  const start = fromGlyph === "one"
    ? `M ${ep.pa.x} ${ep.pa.y} L ${pa.x} ${pa.y}`
    : `M ${pa.x} ${pa.y}`;
  const end = toGlyph === "one" ? ` L ${ep.pb.x} ${ep.pb.y}` : "";
  return `${start} ${curveEdgeCommand(pa, pb)}${end}`;
}
/* crow's-foot / tick notation drawn along the anchor's outward normal */
function drawNotation(g, p, glyph, color){
  const dir = { e:[1,0], w:[-1,0], s:[0,1], n:[0,-1] }[p.side];
  const nx = dir[0], ny = dir[1];          // outward from node
  const px = -ny, py = nx;                  // perpendicular
  const L = RELATION_GLYPH_LENGTH, S = 6;
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
function drawEdgeArrow(g, p, color, width, end){
  const dir = { e:[1,0], w:[-1,0], s:[0,1], n:[0,-1] }[p.side] || [1,0];
  const nx = dir[0], ny = dir[1], px = -ny, py = nx;
  const length = 8 + width * 1.5, spread = 3.5 + width;
  const bx = p.x + nx*length, by = p.y + ny*length;
  const points = `${p.x},${p.y} ${bx - px*spread},${by - py*spread} ${bx + px*spread},${by + py*spread}`;
  el("polygon", {points, fill:color, stroke:color, "stroke-width":Math.max(.6, width*.35),
                 "stroke-linejoin":"round", "data-edge-arrow":end}, g);
}
function drawEdge(e){
  const ep = edgeEndpoints(e);
  if (!ep) return;
  const selected = isSelected("edge", e.id);
  const isLink = e.kind === "link";
  const t = themeColors();
  const color = edgeLineColor(e, t);
  const width = edgeLineWidth(e);
  const g = el("g", {"data-edge": e.id, cursor:"pointer"}, edgeLayer);
  const d = edgeRenderPath(e, ep);
  el("path", {d, fill:"none", stroke:"transparent", "stroke-width":14}, g); // hit area
  if (selected) el("path", {d, fill:"none", stroke:t.accent, "stroke-width":width + 3,
                            opacity:.28, "stroke-linecap":"round", "data-edge-selection":"1"}, g);
  el("path", {d, fill:"none", stroke:color, "stroke-width":width,
              "stroke-dasharray":edgeDashArray(e), "stroke-linecap":"round",
              "data-edge-line":"1"}, g);
  if (e.startArrow === true) drawEdgeArrow(g, ep.pa, color, width, "start");
  if (e.endArrow === true) drawEdgeArrow(g, ep.pb, color, width, "end");
  if (!isLink){
    const [gf, gt] = relationGlyphs(e);
    drawNotation(g, ep.pa, gf, color);
    drawNotation(g, ep.pb, gt, color);
  }
  if (ep.boundA || ep.pinnedA) el("circle", {cx:ep.pa.x, cy:ep.pa.y, r:3, fill:color}, g);
  if (ep.boundB || ep.pinnedB) el("circle", {cx:ep.pb.x, cy:ep.pb.y, r:3, fill:color}, g);
  let label = e.label || (isLink ? "" : e.kind);
  const pairCount = edgeFieldPairs(e).length;
  if (!isLink && pairCount > 1) label += ` · ${pairCount} cols`;
  if (label){
    const {x:mx, y:my} = edgeLabelPoint(e, ep);
    const w = textW(label, "600 10.5px 'IBM Plex Mono', monospace") + 14;
    const labelTextColor = edgeLabelTextColor(e, t);
    const labelBackgroundColor = edgeLabelBackgroundColor(e, t);
    el("rect", {x:mx - w/2, y:my - 10, width:w, height:20, rx:10,
                fill:labelBackgroundColor, stroke:color, "stroke-width":1, "data-edge-label-bg":"1"}, g);
    el("text", {x:mx, y:my + 3.5, "text-anchor":"middle", fill:labelTextColor,
                "font-family":"'IBM Plex Mono', monospace", "font-size":10.5,
                "font-weight":600, "data-edge-label":"1"}, g).textContent = label;
  }
}

/* ---- nodes ---- */
function drawFrame(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const color = n.color || frameColorDefault();
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
function drawSwimlane(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const orientation = swimlaneOrientation(n);
  const defaults = swimlaneDefaults(n);
  const bodyColor = normalizeHex(n.color) || SWIMLANE_DEFAULT.bodyColor;
  const titleColor = normalizeHex(n.titleColor) || SWIMLANE_DEFAULT.titleColor;
  const titleSize = Math.min(defaults.titleSize, orientation === "horizontal" ? r.w * .45 : r.h * .45);
  const g = el("g", {"data-node":n.id, "data-swimlane":n.id, "data-orientation":orientation,
                      transform:`translate(${r.x},${r.y})`, cursor:"grab"}, frameLayer);
  el("rect", {width:r.w, height:r.h, rx:10, fill:bodyColor,
              stroke:selected ? t.accent : t.ink2, "stroke-width":selected ? 2.4 : 1.4,
              "data-swimlane-body":"1"}, g);
  if (orientation === "horizontal"){
    el("path", {d:`M 10 0 H ${titleSize} V ${r.h} H 10 Q 0 ${r.h} 0 ${r.h-10} V 10 Q 0 0 10 0 Z`,
                fill:titleColor, "data-swimlane-title-band":"1"}, g);
    el("line", {x1:titleSize, y1:0, x2:titleSize, y2:r.h, stroke:t.ink2, "stroke-width":1.2}, g);
    el("text", {x:0, y:0, transform:`translate(${titleSize/2},${r.h/2}) rotate(-90)`,
                "text-anchor":"middle", "dominant-baseline":"middle", fill:autoInk(titleColor),
                "font-family":"Archivo, sans-serif", "font-size":14, "font-weight":700,
                "data-swimlane-title":"1"}, g)
      .textContent = truncate(n.title || "Horizontal lane", Math.max(40, r.h - 28), "700 14px Archivo, sans-serif");
  } else {
    el("path", {d:`M 10 0 H ${r.w-10} Q ${r.w} 0 ${r.w} 10 V ${titleSize} H 0 V 10 Q 0 0 10 0 Z`,
                fill:titleColor, "data-swimlane-title-band":"1"}, g);
    el("line", {x1:0, y1:titleSize, x2:r.w, y2:titleSize, stroke:t.ink2, "stroke-width":1.2}, g);
    el("text", {x:r.w/2, y:titleSize/2, "text-anchor":"middle", "dominant-baseline":"middle",
                fill:autoInk(titleColor), "font-family":"Archivo, sans-serif", "font-size":14,
                "font-weight":700, "data-swimlane-title":"1"}, g)
      .textContent = truncate(n.title || "Vertical lane", Math.max(40, r.w - 28), "700 14px Archivo, sans-serif");
  }
  const h = el("g", {class:"frame-resize", "data-frame-resize":n.id, cursor:"nwse-resize"}, g);
  el("rect", {x:r.w - 18, y:r.h - 18, width:18, height:18, fill:"transparent"}, h);
  el("path", {d:`M ${r.w-15} ${r.h-5} L ${r.w-5} ${r.h-15} M ${r.w-10} ${r.h-5} L ${r.w-5} ${r.h-10}`,
              stroke:selected ? t.accent : t.ink2, "stroke-width":1.6, "stroke-linecap":"round"}, h);
}
function drawStructuralNode(n){
  if (n.type === "swimlane") drawSwimlane(n);
  else drawFrame(n);
}
function drawStandardShape(g, shape, r, attrs, dataAttr = "data-node-shape"){
  const common = { ...attrs, [dataAttr]:shape, "stroke-linejoin":"round" };
  if (shape === "process") return el("rect", {width:r.w, height:r.h, rx:4, ...common}, g);
  if (shape === "square") return el("rect", {width:r.w, height:r.h, rx:4, ...common}, g);
  if (shape === "circle") return el("ellipse", {cx:r.w/2, cy:r.h/2, rx:r.w/2, ry:r.h/2, ...common}, g);
  if (shape === "triangle")
    return el("path", {d:`M ${r.w/2} 0 L ${r.w} ${r.h} L 0 ${r.h} Z`, ...common}, g);
  if (shape === "terminator") return el("rect", {width:r.w, height:r.h, rx:r.h/2, ...common}, g);
  if (shape === "decision")
    return el("path", {d:`M ${r.w/2} 0 L ${r.w} ${r.h/2} L ${r.w/2} ${r.h} L 0 ${r.h/2} Z`, ...common}, g);
  if (shape === "data")
    return el("path", {d:`M 18 0 H ${r.w} L ${r.w-18} ${r.h} H 0 Z`, ...common}, g);
  if (shape === "document"){
    /* Paper fold + two-crest lower edge keep this distinct from a rectangular process. */
    const wave = Math.min(18, Math.max(12, r.h * .28));
    const fold = Math.min(20, Math.max(14, r.h * .25));
    const base = r.h - wave;
    const outline = el("path", {d:`M 0 0 H ${r.w-fold} L ${r.w} ${fold} V ${base} C ${r.w*.86} ${r.h}, ${r.w*.68} ${base + wave*.1}, ${r.w/2} ${base + wave*.78} C ${r.w*.32} ${r.h}, ${r.w*.14} ${base + wave*.18}, 0 ${base + wave*.7} Z`, ...common}, g);
    el("path", {d:`M ${r.w-fold} 0 V ${fold} H ${r.w}`, fill:"none", stroke:attrs.stroke,
                "stroke-width":Math.max(1, Number(attrs["stroke-width"]) * .85),
                "stroke-linejoin":"round", "pointer-events":"none", "data-document-fold":"1"}, g);
    return outline;
  }
  /* Manual input: the sloped leading edge is the conventional flowchart symbol. */
  return el("path", {d:`M 20 0 H ${r.w} L ${r.w-14} ${r.h} H 0 Z`, ...common}, g);
}
function drawConceptShape(g, n, r, attrs){
  return drawStandardShape(g, conceptShape(n), r, attrs);
}
function drawPlainText(g, n, r, selected, t){
  const layout = textBoxLayout(n);
  const fill = n.color || conceptColors()[1];
  const ink = n.fontColor || (layout.shape === "none" ? t.ink : autoInk(fill, t));
  g.setAttribute("data-text-box", n.id);
  g.setAttribute("data-text-shape", layout.shape);
  if (layout.shape === "none"){
    const attrs = {width:r.w, height:r.h, rx:4, fill:"transparent", stroke:selected ? t.accent : "none",
                   "stroke-width":1.4, "stroke-dasharray":"4 3", "data-text-hit":"1"};
    if (selected) attrs["data-text-selection"] = "1";
    el("rect", attrs, g);
  } else {
    drawStandardShape(g, layout.shape, r, {fill,
      stroke:selected ? t.accent : t.ink, "stroke-width":selected ? 2.2 : 1.2}, "data-text-shape-surface");
  }
  const text = el("text", {"text-anchor":"middle", fill:ink, "pointer-events":"none",
              "font-family":"Archivo, sans-serif", "font-size":layout.fs, "font-weight":600,
              "data-plain-text":"1"}, g);
  const firstY = layout.centerY - ((layout.lines.length - 1) * layout.lineH)/2 + layout.fs*.35;
  layout.lines.forEach((line, i) => {
    const span = el("tspan", {x:r.w/2, y:firstY + i*layout.lineH, "data-text-line":i+1}, text);
    span.textContent = line;
  });
}
function drawRichNote(g, n, r, selected, t){
  const layout = richNoteLayout(n);
  const fill = n.color || conceptColors()[0];
  const ink = n.fontColor || autoInk(fill, t);
  const fold = 22;
  el("path", {d:`M 8 0 H ${r.w-fold} L ${r.w} ${fold} V ${r.h-8} Q ${r.w} ${r.h} ${r.w-8} ${r.h} H 8 Q 0 ${r.h} 0 ${r.h-8} V 8 Q 0 0 8 0 Z`,
              fill, stroke:selected ? t.accent : t.ink, "stroke-width":selected ? 2.2 : 1.2,
              "stroke-linejoin":"round", "data-note-surface":"1"}, g);
  el("path", {d:`M ${r.w-fold} 0 V ${fold} H ${r.w}`, fill:"none", stroke:ink,
              "stroke-width":1, opacity:.35, "pointer-events":"none", "data-note-fold":"1"}, g);
  const title = el("text", {x:14, y:Math.ceil(layout.titleH*.62), fill:ink,
              "font-family":"Archivo, sans-serif", "font-size":layout.base+1.5, "font-weight":700}, g);
  title.textContent = truncate(n.title || "Rich note", r.w - fold - 28,
    `700 ${layout.base+1.5}px Archivo, sans-serif`);
  el("line", {x1:12, y1:layout.titleH, x2:r.w-12, y2:layout.titleH,
              stroke:ink, "stroke-width":1, opacity:.18}, g);

  const body = el("g", {"data-note-content":n.id, "pointer-events":"none"}, g);
  let y = layout.titleH + 8;
  for (const line of layout.lines){
    const baseline = y + line.size;
    if (line.prefix){
      el("text", {x:14, y:baseline, fill:ink, "font-family":"Archivo, sans-serif",
                  "font-size":line.size, "font-weight":line.weight,
                  "font-style":line.italic ? "italic" : "normal"}, body).textContent = line.prefix;
    }
    if (line.runs.length){
      const text = el("text", {x:14 + line.indent, y:baseline, fill:ink,
                    "font-family":"Archivo, sans-serif", "font-size":line.size,
                    "font-weight":line.weight, "font-style":line.italic ? "italic" : "normal",
                    opacity:line.placeholder ? .55 : 1}, body);
      for (const run of line.runs){
        const span = el("tspan", {
          "font-family":run.code ? "'IBM Plex Mono', monospace" : "Archivo, sans-serif",
          "font-weight":run.bold || line.weight >= 700 ? 700 : 400,
          "font-style":run.italic || line.italic ? "italic" : "normal"
        }, text);
        span.textContent = run.text;
      }
    }
    y += line.h;
  }
}
function drawNode(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const g = el("g", {"data-node": n.id, transform:`translate(${r.x},${r.y})`, cursor:"grab"}, nodeLayer);

  if (n.type === "concept"){
    const fs = conceptFont(n);
    const fc = n.fontColor || autoInk(n.color || conceptColors()[0], t);
    const shape = conceptShape(n);
    const wrapped = conceptWrappedLayout(n);
    drawConceptShape(g, n, r, {fill:n.color || conceptColors()[0],
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.2});
    if (wrapped){
      const titleText = el("text", {"text-anchor":"middle", fill:fc, "pointer-events":"none",
                  "font-family":"Archivo, sans-serif", "font-size":fs, "font-weight":600,
                  "data-concept-wrapped":"1"}, g);
      const firstY = wrapped.centerY - ((wrapped.lines.length - 1) * wrapped.lineH)/2 + fs*.35;
      wrapped.lines.forEach((line, i) => {
        const span = el("tspan", {x:r.w/2, y:firstY + i*wrapped.lineH, "data-concept-line":i+1}, titleText);
        span.textContent = line;
      });
    } else {
      const titleText = el("text", {x:r.w/2, y:r.h/2 + fs*0.35, "text-anchor":"middle", fill:fc,
                  "font-family":"Archivo, sans-serif", "font-size":fs, "font-weight":600}, g);
      titleText.textContent = truncate(n.title || "Untitled", conceptTextWidth(shape, r.w), `600 ${fs}px Archivo, sans-serif`);
    }
    if (n.notes){
      const noteAtSide = shape === "decision" || shape === "terminator" || shape === "document" || shape === "circle";
      const noteX = shape === "triangle" ? r.w*.72 : noteAtSide ? r.w - 14 : r.w - 12;
      const noteY = shape === "triangle" ? r.h*.74 : noteAtSide ? r.h/2 : 12;
      el("circle", {cx:noteX, cy:noteY,
                    r:3.2, fill:t.ink, opacity:.55}, g);
    }
  } else if (n.type === "text"){
    drawPlainText(g, n, r, selected, t);
  } else if (n.type === "note"){
    drawRichNote(g, n, r, selected, t);
  } else if (n.type === "todo"){
    const m = tableMetrics(n);
    const fc = n.fontColor || autoInk(n.color || todoColorDefault(), t);
    const total = n.items.length;
    const doneCount = n.items.filter(it => it.done).length;
    el("rect", {width:r.w, height:r.h, rx:10, fill:t.tableFill,
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.3}, g);
    el("path", {d:`M 0 10 Q 0 0 10 0 H ${r.w-10} Q ${r.w} 0 ${r.w} 10 V ${m.headerH} H 0 Z`,
                fill: n.color || todoColorDefault()}, g);
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
      const addTop = m.headerH + Math.max(1, n.items.length) * m.rowH;
      el("line", {x1:8, y1:addTop, x2:r.w-8, y2:addTop, stroke:t.rowLine, "stroke-width":1}, g);
      const add = el("g", {"data-todoadd":n.id, cursor:"pointer", role:"button", tabindex:0,
                           "aria-label":`Add item to ${n.title || "to-do list"}`}, g);
      el("rect", {x:6, y:addTop+4, width:r.w-12, height:m.rowH-8, rx:5,
                  fill:t.accent, "fill-opacity":.08, stroke:t.accent, "stroke-opacity":.35}, add);
      el("text", {x:r.w/2, y:addTop + m.rowH/2 + m.nameSize*.35, "text-anchor":"middle",
                  fill:t.accent, "font-family":"Archivo, sans-serif", "font-size":m.nameSize,
                  "font-weight":600, "pointer-events":"none"}, add).textContent = "+ Add item";
      add.addEventListener("keydown", ev => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        addTodoItem(n);
      });
    }
  } else {
    const m = tableMetrics(n);
    const fc = n.fontColor || t.ink;
    el("rect", {width:r.w, height:r.h, rx:8, fill:t.tableFill,
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.3}, g);
    const hInk = autoInk(n.color || t.ink, t);
    el("path", {d:`M 0 8 Q 0 0 8 0 H ${r.w-8} Q ${r.w} 0 ${r.w} 8 V ${m.headerH} H 0 Z`,
                fill: n.color || t.ink}, g);
    const ht = el("text", {x:12, y:m.headerBaseline, fill:hInk, "font-family":"Archivo, sans-serif",
                "font-size":m.headerSize, "font-weight":700, "letter-spacing":".04em"}, g);
    ht.textContent = truncate(n.title || "table", r.w - 82, `700 ${m.headerSize}px Archivo, sans-serif`);
    if (n.notes) el("circle", {cx:r.w - 34, cy:Math.max(10, m.headerH/2), r:3.2, fill:hInk, opacity:.7}, g);
    const cg = el("g", {"data-collapse":n.id, cursor:"pointer"}, g);
    el("rect", {x:r.w - 24, y:0, width:24, height:m.headerH, fill:"transparent"}, cg);
    el("text", {x:r.w - 12, y:m.headerBaseline, "text-anchor":"middle", fill:hInk, opacity:.85,
                "font-family":"'IBM Plex Mono', monospace", "font-size":Math.max(10, m.base)}, cg)
      .textContent = n.collapsed ? "▸" : "▾";
    el("text", {x:r.w - 34, y:m.headerBaseline, "text-anchor":"end", fill:hInk, opacity:.75,
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
                    fill: f.pk || f.unique ? autoInk(f.pk ? t.ink : t.accent, t) : t.ink,
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
    const cleanText = n.type === "text" && textBoxShape(n) === "none";
    const primaryVisible = key === "mr" && (!cleanText || selected);
    const hg = el("g", {class: primaryVisible ? "" : "anchorhandle",
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

