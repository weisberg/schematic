"use strict";

/* ---------------------------- Render ------------------------------ */
function el(tag, attrs, parent){
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs){
    const value = (k === "fill" || k === "stroke") && /^#[0-9a-fA-F]{8}$/.test(String(attrs[k]))
      ? normalizeHex(attrs[k]) : attrs[k];
    e.setAttribute(k, value);
  }
  if (parent) parent.appendChild(e);
  return e;
}

let world, frameLayer, edgeLayer, bridgeLayer, nodeLayer, guideLayer, draftLayer, minimap, minimapDrag = false;
const renderStats = { full:0, fast:0 };

function buildScaffold(){
  board.innerHTML = "";
  const defs = el("defs", {}, board);
  const gridSize = typeof editingGridSize === "function" ? editingGridSize() : GRID_SNAP;
  const pat = el("pattern", {id:"dots", width:gridSize, height:gridSize, patternUnits:"userSpaceOnUse"}, defs);
  el("circle", {cx:1.2, cy:1.2, r:1.2, fill:themeColors().grid}, pat);

  world = el("g", {id:"world"}, board);
  el("rect", {x:-50000, y:-50000, width:100000, height:100000,
              fill:typeof pagesBackground === "function" ? pagesBackground() : themeColors().paper,
              "data-bg":"1"}, world);
  el("rect", {x:-50000, y:-50000, width:100000, height:100000, fill:"url(#dots)",
              "data-grid":"1"}, world);
  frameLayer = el("g", {id:"frameLayer"}, world);
  edgeLayer  = el("g", {id:"edgeLayer"}, world);
  bridgeLayer = el("g", {id:"bridgeLayer"}, world);
  nodeLayer  = el("g", {id:"nodeLayer"}, world);
  guideLayer = el("g", {id:"guideLayer"}, world);
  draftLayer = el("g", {id:"draftLayer"}, world);
  ensureMinimap();
  applyView();
}
function applyView(){
  if (inlineEditor) closeInlineEditor(false);
  if (inlineStatusPicker) closeInlineStatusPicker();
  world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
  document.getElementById("zoomLabel").textContent = Math.round(view.k*100) + "%";
  renderMinimap();
  if (typeof formattingUpdateSemanticZoom === "function" && formattingUpdateSemanticZoom(view.k)){
    render();
    return;
  }
  if (typeof renderEditingRulers === "function") renderEditingRulers();
  if (typeof searchPanelOpen === "function" && searchPanelOpen() &&
      typeof scheduleSearchRun === "function") scheduleSearchRun();
}

function render(){
  if (typeof pagesBeforeRender === "function") pagesBeforeRender();
  renderStats.full++;
  const pageBackground = world && world.querySelector("[data-bg]");
  if (pageBackground)
    pageBackground.setAttribute("fill",typeof pagesBackground === "function" ? pagesBackground() : themeColors().paper);
  if (typeof invalidateOrganizationEvaluation === "function") invalidateOrganizationEvaluation();
  if (inlineStatusPicker) closeInlineStatusPicker();
  frameLayer.innerHTML = "";
  edgeLayer.innerHTML = "";
  bridgeLayer.innerHTML = "";
  nodeLayer.innerHTML = "";
  guideLayer.innerHTML = "";
  draftLayer.innerHTML = "";
  const hidden = collapsedFrameHiddenNodeIds();
  const organizationHidden = typeof organizationalHiddenNodeIds === "function"
    ? organizationalHiddenNodeIds() : new Set();
  const formattingHidden = typeof conditionalLensHiddenNodeIds === "function"
    ? conditionalLensHiddenNodeIds() : new Set();
  const allHidden = new Set([...hidden, ...organizationHidden, ...formattingHidden]);
  const proxies = collapsedFrameProxyMap(hidden);
  let frames = 0, lanes = 0;
  const structuralNodes = state.nodes.filter(n => {
    if (n.type === "frame") frames++;
    else if (n.type === "swimlane") lanes++;
    return !allHidden.has(n.id) && isStructuralNode(n);
  });
  /* Paint broad containers before smaller nested containers so the inner
     title, resize, and collapse controls remain reachable inside a parent. */
  const containsStructuralCenter = (outer, inner) => {
    const a = containmentRect(outer), b = containmentRect(inner);
    if (a.w * a.h <= b.w * b.h) return false;
    return b.cx >= a.x && b.cx <= a.x + a.w &&
           b.cy >= a.y && b.cy <= a.y + a.h;
  };
  structuralNodes.sort((a, b) => {
    if (typeof organizationLayerRank === "function" && organizationLayerRank(a) !== organizationLayerRank(b))
      return organizationLayerRank(a) - organizationLayerRank(b);
    if (containsStructuralCenter(a, b)) return -1;
    if (containsStructuralCenter(b, a)) return 1;
    return 0;
  });
  for (const n of structuralNodes) drawStructuralNode(n);
  const edges = visibleCanvasEdges(hidden, proxies);
  const sortedEdges = typeof organizationSortRecords === "function" ? organizationSortRecords(edges) : edges;
  if (typeof routingPrepareRender === "function") routingPrepareRender(sortedEdges, hidden, proxies);
  for (const e of sortedEdges)
    drawEdge(e, hidden, proxies);
  if (typeof routingDrawBridgeLayer === "function") routingDrawBridgeLayer(sortedEdges);
  const contentNodes = state.nodes.filter(n => !allHidden.has(n.id) && !isStructuralNode(n));
  for (const n of typeof organizationSortRecords === "function"
    ? organizationSortRecords(contentNodes) : contentNodes) drawNode(n);
  if (typeof drawManualGuides === "function") drawManualGuides();
  if (typeof formattingDrawCanvasLegend === "function") formattingDrawCanvasLegend();
  if (typeof editingRenderLayoutProposal === "function" && editingLayoutProposal)
    editingRenderLayoutProposal();
  for (const n of state.nodes)
    if (!allHidden.has(n.id) && n.type === "frame" && n.collapsed === true) drawCollapsedFrameControlOverlay(n);
  if (typeof routingDrawOverlays === "function") routingDrawOverlays();
  drawEdgeGrips();
  const nodes = state.nodes.length - frames - lanes;
  const structural = [frames ? `${frames} frame${frames === 1 ? "" : "s"}` : "",
                      lanes ? `${lanes} lane${lanes === 1 ? "" : "s"}` : ""].filter(Boolean);
  document.getElementById("countLabel").textContent =
    `${nodes} nodes${structural.length ? ` · ${structural.join(" · ")}` : ""} · ${state.edges.length} edges`;
  renderMinimap();
  renderInspector();
  updateAlignMenu();
  if (typeof refreshSearchIndex === "function") refreshSearchIndex();
  if (typeof scheduleOrganizationExplorerRender === "function") scheduleOrganizationExplorerRender();
}
function fastDragRender(ids){
  renderStats.fast++;
  const moved = new Set(ids);
  const hidden = collapsedFrameHiddenNodeIds();
  const formattingHidden = typeof conditionalLensHiddenNodeIds === "function"
    ? conditionalLensHiddenNodeIds() : new Set();
  for (const id of formattingHidden) hidden.add(id);
  const proxies = collapsedFrameProxyMap(hidden);
  const visibleEdges = new Set(visibleCanvasEdges(hidden, proxies));
  for (const id of moved){
    const n = nodeById(id);
    const g = n && document.querySelector(`[data-node="${id}"]`);
    if (n && g) g.setAttribute("transform", nodeSvgTransform(n, nodeRect(n)));
    const overlay = n && document.querySelector(`[data-frame-collapse-overlay="${id}"]`);
    if (n && overlay) overlay.setAttribute("transform", `translate(${n.x},${n.y})`);
  }
  const incident = state.edges.filter(e => moved.has(e.from) || moved.has(e.to));
  if (typeof routingInvalidateEdges === "function")
    routingInvalidateEdges(incident.map(edge => edge.id));
  for (const e of incident){
    const old = edgeLayer.querySelector(`[data-edge="${e.id}"]`);
    if (old) old.remove();
    if (visibleEdges.has(e)) drawEdge(e, hidden, proxies);
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
  for (const n of visibleCanvasNodes()){
    const r = nodeVisualRect(n);
    const p = tx.toMini({x:r.x, y:r.y});
    const structural = isStructuralNode(n);
    const cleanText = n.type === "text" && textBoxShape(n) === "none";
    const baseFill = n.type === "frame" ? n.color || frameColorDefault()
      : cleanText ? n.fontColor || t.ink : n.color || t.ink;
    const fill = typeof formattingEffectiveValue === "function"
      ? formattingEffectiveValue(n,"fill",baseFill) : baseFill;
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
  const raw = { x: side === "e" ? r.x + r.w : r.x, y: fieldRowCenterY(n, idx) };
  const point = transformNodePoint(n, raw);
  return { ...point, side:transformNodeSide(n, side) };
}
function edgeFieldPairs(e){
  if (Array.isArray(e.pairs) && e.pairs.length)
    return e.pairs.filter(p => p && (p.fromField || p.toField));
  if (e.fromField || e.toField) return [{ fromField:e.fromField || "", toField:e.toField || "" }];
  return [];
}
function collapsedFrameCenterAnchor(frame, toward){
  const r = nodeRect(frame);
  const dx = toward.x - r.cx, dy = toward.y - r.cy;
  const side = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? "e" : "w") : (dy >= 0 ? "s" : "n");
  return {x:r.cx, y:r.cy, side};
}
function edgeEndpoints(e, hidden = null, proxies = null){
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return null;
  if (hidden == null) hidden = collapsedFrameHiddenNodeIds();
  if (proxies == null) proxies = collapsedFrameProxyMap(hidden);
  const proxyAId = hidden.has(a.id) ? proxies.get(a.id) : null;
  const proxyBId = hidden.has(b.id) ? proxies.get(b.id) : null;
  if ((hidden.has(a.id) && !proxyAId) || (hidden.has(b.id) && !proxyBId)) return null;
  if (proxyAId && proxyBId && proxyAId === proxyBId) return null;
  const proxyA = proxyAId ? nodeById(proxyAId) : null;
  const proxyB = proxyBId ? nodeById(proxyBId) : null;
  if ((proxyAId && !proxyA) || (proxyBId && !proxyB)) return null;
  if ((!proxyA && isStructuralNode(a)) || (!proxyB && isStructuralNode(b))) return null;
  const ra = nodeRect(proxyA || a), rb = nodeRect(proxyB || b);
  const firstPair = edgeFieldPairs(e)[0] || {};
  const fromField = firstPair.fromField || e.fromField;
  const toField = firstPair.toField || e.toField;
  const rowsA = proxyA || a.collapsed ? null : nodeRows(a);
  const rowsB = proxyB || b.collapsed ? null : nodeRows(b);
  const ia = (fromField && rowsA) ? rowsA.findIndex(f => f.id === fromField) : -1;
  const ib = (toField   && rowsB) ? rowsB.findIndex(f => f.id === toField)   : -1;
  /* reference points: bound field row centers, else node centers */
  const refA = ia >= 0 ? transformNodePoint(a, { x:ra.cx, y:fieldRowCenterY(a, ia) })
    : { x:ra.cx, y:ra.cy };
  const refB = ib >= 0 ? transformNodePoint(b, { x:rb.cx, y:fieldRowCenterY(b, ib) })
    : { x:rb.cx, y:rb.cy };
  const fromPort = !proxyA && ia < 0 && !e.fromAnchor && nodePortsEnabled(a)
    ? nodePortAnchor(a, "output", e.fromPort || nodeOutputPorts(a)[0]?.id) : null;
  const toPort = !proxyB && ib < 0 && !e.toAnchor && nodePortsEnabled(b)
    ? nodePortAnchor(b, "input", e.toPort || nodeInputPorts(b)[0]?.id) : null;
  const pa = proxyA ? collapsedFrameCenterAnchor(proxyA, refB)
    : ia >= 0 ? fieldAnchor(a, ia, refB.x) : fromPort || nodeAnchor(a, e.fromAnchor, refB);
  const pb = proxyB ? collapsedFrameCenterAnchor(proxyB, refA)
    : ib >= 0 ? fieldAnchor(b, ib, refA.x) : toPort || nodeAnchor(b, e.toAnchor, refA);
  return { pa, pb, boundA: ia >= 0, boundB: ib >= 0,
           pinnedA: !proxyA && ia < 0 && (!!e.fromAnchor || !!e.fromPort),
           pinnedB: !proxyB && ib < 0 && (!!e.toAnchor || !!e.toPort),
           proxyA:proxyAId || null, proxyB:proxyBId || null };
}
function curveEdgeControlPoints(pa, pb){
  const dx = Math.max(40, Math.abs(pb.x - pa.x) * 0.45);
  const dy = Math.max(40, Math.abs(pb.y - pa.y) * 0.45);
  const c = p => p.side === "e" ? [p.x + dx, p.y] : p.side === "w" ? [p.x - dx, p.y]
            : p.side === "s" ? [p.x, p.y + dy] : [p.x, p.y - dy];
  const [c1x, c1y] = c(pa), [c2x, c2y] = c(pb);
  return { c1:{x:c1x, y:c1y}, c2:{x:c2x, y:c2y} };
}
function curveEdgePoint(pa, pb, t, controls = curveEdgeControlPoints(pa, pb)){
  const u = 1 - t, uu = u * u, tt = t * t;
  return {
    x:uu * u * pa.x + 3 * uu * t * controls.c1.x + 3 * u * tt * controls.c2.x + tt * t * pb.x,
    y:uu * u * pa.y + 3 * uu * t * controls.c1.y + 3 * u * tt * controls.c2.y + tt * t * pb.y
  };
}
function clampEdgeLabelPosition(value){
  const next = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : .5;
}
function edgeLabelPosition(e){
  return clampEdgeLabelPosition(e && e.labelPosition);
}
function setEdgeLabelPosition(e, value){
  if (!e) return false;
  const next = Math.round(clampEdgeLabelPosition(value) * 10000) / 10000;
  if (Math.abs(next - .5) < .00005) delete e.labelPosition;
  else e.labelPosition = next;
  return true;
}
function curveEdgePointAt(pa, pb, position){
  const controls = curveEdgeControlPoints(pa, pb);
  const segments = [];
  let previous = curveEdgePoint(pa, pb, 0, controls), total = 0;
  for (let i = 1; i <= 32; i++){
    const t = i / 32;
    const point = curveEdgePoint(pa, pb, t, controls);
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    segments.push({fromT:(i - 1) / 32, toT:t, length});
    total += length;
    previous = point;
  }
  if (!total) return {x:pa.x, y:pa.y};
  let remaining = total * clampEdgeLabelPosition(position);
  if (remaining <= 0) return {x:pa.x, y:pa.y};
  for (const segment of segments){
    if (remaining <= segment.length){
      const fraction = segment.length ? remaining / segment.length : 0;
      return curveEdgePoint(pa, pb,
        segment.fromT + (segment.toT - segment.fromT) * fraction, controls);
    }
    remaining -= segment.length;
  }
  return {x:pb.x, y:pb.y};
}
function curveEdgeCommand(pa, pb){
  const {c1, c2} = curveEdgeControlPoints(pa, pb);
  return `C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${pb.x} ${pb.y}`;
}
function curveEdgePath(pa, pb){
  return `M ${pa.x} ${pa.y} ${curveEdgeCommand(pa, pb)}`;
}
function orthoCornerStyle(e){
  return e && e.orthoCorner === "square" ? "square" : "rounded";
}
function setOrthoCornerStyle(e, value){
  if (!e) return;
  if (e.routing === "ortho" && value === "square") e.orthoCorner = "square";
  else delete e.orthoCorner;
}
function compactPolylinePoints(points){
  const clean = [];
  for (const point of points || []){
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const previous = clean[clean.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y)
      clean.push({x:point.x, y:point.y});
  }
  return clean;
}
function pathNumber(value){
  return String(Math.round(Number(value) * 1000) / 1000);
}
function squarePolylinePath(points){
  const clean = compactPolylinePoints(points);
  if (!clean.length) return "";
  let d = `M ${pathNumber(clean[0].x)} ${pathNumber(clean[0].y)}`;
  for (let i = 1; i < clean.length; i++){
    const previous = clean[i - 1], point = clean[i];
    if (point.y === previous.y) d += ` H ${pathNumber(point.x)}`;
    else if (point.x === previous.x) d += ` V ${pathNumber(point.y)}`;
    else d += ` L ${pathNumber(point.x)} ${pathNumber(point.y)}`;
  }
  return d;
}
function roundedPolylinePath(points, radius = 10){
  const clean = compactPolylinePoints(points);
  if (clean.length < 3) return squarePolylinePath(clean);
  let d = `M ${pathNumber(clean[0].x)} ${pathNumber(clean[0].y)}`;
  let cursor = clean[0];
  const lineTo = point => {
    if (cursor.x === point.x && cursor.y === point.y) return;
    d += ` L ${pathNumber(point.x)} ${pathNumber(point.y)}`;
    cursor = point;
  };
  for (let i = 1; i < clean.length - 1; i++){
    const previous = clean[i - 1], corner = clean[i], next = clean[i + 1];
    const inX = corner.x - previous.x, inY = corner.y - previous.y;
    const outX = next.x - corner.x, outY = next.y - corner.y;
    const inLength = Math.hypot(inX, inY), outLength = Math.hypot(outX, outY);
    const cross = inX*outY - inY*outX;
    if (!inLength || !outLength || Math.abs(cross) < .000001){
      lineTo(corner);
      continue;
    }
    const cornerRadius = Math.min(Math.max(0, radius), inLength/2, outLength/2);
    const before = {
      x:corner.x - inX/inLength*cornerRadius,
      y:corner.y - inY/inLength*cornerRadius
    };
    const after = {
      x:corner.x + outX/outLength*cornerRadius,
      y:corner.y + outY/outLength*cornerRadius
    };
    lineTo(before);
    d += ` Q ${pathNumber(corner.x)} ${pathNumber(corner.y)} ` +
      `${pathNumber(after.x)} ${pathNumber(after.y)}`;
    cursor = after;
  }
  const last = clean[clean.length - 1];
  lineTo(last);
  return d;
}
function hasCustomOrthoBend(e){
  return !!e && ["orthoX","orthoY","orthoFromStub","orthoToStub"]
    .some(key => Number.isFinite(e[key]));
}
function legacyOrthoEdgeRoute(e, pa, pb){
  const stubDistance = key => Number.isFinite(e && e[key]) ? Math.max(0, e[key]) : 12;
  const out = (p, stub) => {
    if (p.side === "e") return { x:p.x + stub, y:p.y };
    if (p.side === "w") return { x:p.x - stub, y:p.y };
    if (p.side === "s") return { x:p.x, y:p.y + stub };
    return { x:p.x, y:p.y - stub };
  };
  const a = out(pa, stubDistance("orthoFromStub"));
  const b = out(pb, stubDistance("orthoToStub"));
  const horizontal = pa.side === "e" || pa.side === "w" || pb.side === "e" || pb.side === "w";
  if (horizontal){
    const mx = (a.x + b.x) / 2;
    const bend = {
      x:Number.isFinite(e && e.orthoX) ? e.orthoX : mx,
      y:Number.isFinite(e && e.orthoY) ? e.orthoY : b.y
    };
    const custom = hasCustomOrthoBend(e);
    const points = custom
      ? [pa, a, {x:bend.x, y:a.y}, bend, {x:b.x, y:bend.y}, b, pb]
      : [pa, a, {x:mx, y:a.y}, {x:mx, y:b.y}, b, pb];
    const d = orthoCornerStyle(e) === "square"
      ? squarePolylinePath(points) : roundedPolylinePath(points);
    return { d, points, pa, pb, a, b, bend, horizontal, auto:{x:mx, y:b.y} };
  }
  const my = (a.y + b.y) / 2;
  const bend = {
    x:Number.isFinite(e && e.orthoX) ? e.orthoX : b.x,
    y:Number.isFinite(e && e.orthoY) ? e.orthoY : my
  };
  const custom = hasCustomOrthoBend(e);
  const points = custom
    ? [pa, a, {x:a.x, y:bend.y}, bend, {x:bend.x, y:b.y}, b, pb]
    : [pa, a, {x:a.x, y:my}, {x:b.x, y:my}, b, pb];
  const d = orthoCornerStyle(e) === "square"
    ? squarePolylinePath(points) : roundedPolylinePath(points);
  return { d, points, pa, pb, a, b, bend, horizontal, auto:{x:b.x, y:my} };
}
function orthoEdgeRoute(e, pa, pb){
  if (typeof routingResolveOrthoRoute === "function"){
    const smart = routingResolveOrthoRoute(e, pa, pb);
    if (smart) return smart;
  }
  return legacyOrthoEdgeRoute(e, pa, pb);
}
function orthoRouteCornerHandles(route){
  if (route && route.smart && typeof routingCornerHandles === "function")
    return routingCornerHandles(route) || [];
  if (!route) return [];
  const points = compactPolylinePoints(route.points);
  const corners = [];
  for (let i = 1; i < points.length - 1; i++){
    const previous = points[i - 1], point = points[i], next = points[i + 1];
    const cross = (point.x - previous.x) * (next.y - point.y) -
      (point.y - previous.y) * (next.x - point.x);
    if (Math.abs(cross) < .000001) continue;
    const isFromStub = point.x === route.a.x && point.y === route.a.y;
    const isToStub = point.x === route.b.x && point.y === route.b.y;
    const isBend = point.x === route.bend.x && point.y === route.bend.y;
    let key = `corner-${corners.length}`, axes = ["x","y"];
    if (isFromStub){
      key = "from-stub";
      axes = [route.pa.side === "e" || route.pa.side === "w" ? "x" : "y"];
    } else if (isToStub){
      key = "to-stub";
      axes = [route.pb.side === "e" || route.pb.side === "w" ? "x" : "y"];
    } else if (isBend){
      key = "bend";
    } else if (route.horizontal && point.x === route.bend.x){
      key = "entry";
      axes = ["x"];
    } else if (route.horizontal && point.y === route.bend.y){
      key = "exit";
      axes = ["y"];
    } else if (!route.horizontal && point.y === route.bend.y){
      key = "entry";
      axes = ["y"];
    } else if (!route.horizontal && point.x === route.bend.x){
      key = "exit";
      axes = ["x"];
    }
    corners.push({key, axes, point:{x:point.x, y:point.y}});
  }
  return corners;
}
function setOrthoCornerPosition(e, route, corner, point){
  if (!e || !route || !corner || !point) return;
  if (route.smart && typeof routingSetCornerPosition === "function" &&
      routingSetCornerPosition(e, route, corner, point)) return;
  if (corner.key === "from-stub" || corner.key === "to-stub"){
    const from = corner.key === "from-stub";
    const endpoint = from ? route.pa : route.pb;
    const axis = endpoint.side === "e" || endpoint.side === "w" ? "x" : "y";
    const sign = endpoint.side === "e" || endpoint.side === "s" ? 1 : -1;
    e[from ? "orthoFromStub" : "orthoToStub"] =
      Math.max(0, sign * (point[axis] - endpoint[axis]));
    return;
  }
  if (corner.axes.includes("x")) e.orthoX = point.x;
  if (corner.axes.includes("y")) e.orthoY = point.y;
}
function orthoEdgePath(pa, pb, e = null){
  return orthoEdgeRoute(e, pa, pb).d;
}
function polylinePointAt(points, position){
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
  let remaining = total * clampEdgeLabelPosition(position);
  if (remaining <= 0) return {x:points[0].x, y:points[0].y};
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
function polylineMidpoint(points){
  return polylinePointAt(points, .5);
}
function projectPointToPolyline(points, point){
  if (!Array.isArray(points) || !points.length) return {x:0, y:0, position:.5, distance:Infinity};
  let total = 0;
  const segments = [];
  for (let i = 1; i < points.length; i++){
    const from = points[i - 1], to = points[i];
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    segments.push({from, dx, dy, length, start:total});
    total += length;
  }
  if (!segments.length){
    const first = points[0];
    return {x:first.x, y:first.y, position:.5, totalLength:0,
            distance:Math.hypot(point.x - first.x, point.y - first.y)};
  }
  let best = null;
  for (const segment of segments){
    const lengthSquared = segment.length * segment.length;
    const t = Math.min(1, Math.max(0,
      ((point.x - segment.from.x) * segment.dx + (point.y - segment.from.y) * segment.dy) /
      lengthSquared));
    const x = segment.from.x + segment.dx * t;
    const y = segment.from.y + segment.dy * t;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance){
      best = {x, y, distance, totalLength:total,
              position:(segment.start + segment.length * t) / total};
    }
  }
  return best;
}
function edgeLabelCurveEndpoints(e, ep){
  return {
    pa:e && e.kind !== "link" ? notationVertex(ep.pa) : ep.pa,
    pb:e && e.kind !== "link" ? notationVertex(ep.pb) : ep.pb
  };
}
function edgeLabelPoint(e, ep){
  const position = edgeLabelPosition(e);
  if (e && e.routing === "ortho"){
    const route = orthoEdgeRoute(e, ep.pa, ep.pb);
    if (typeof routingLabelPoint === "function")
      return routingLabelPoint(route.points, position, e.labelOffset);
    return polylinePointAt(route.points, position);
  }
  const {pa, pb} = edgeLabelCurveEndpoints(e, ep);
  const point = curveEdgePointAt(pa, pb, position);
  if (typeof routingCurveLabelPoint === "function")
    return routingCurveLabelPoint(pa, pb, position, e.labelOffset, point);
  return point;
}
function projectEdgeLabelToPath(e, ep, point){
  if (e && e.routing === "ortho"){
    return projectPointToPolyline(orthoEdgeRoute(e, ep.pa, ep.pb).points, point);
  }
  const {pa, pb} = edgeLabelCurveEndpoints(e, ep);
  const controls = curveEdgeControlPoints(pa, pb);
  const samples = Array.from({length:97}, (_, i) => curveEdgePoint(pa, pb, i / 96, controls));
  const projected = projectPointToPolyline(samples, point);
  const exact = curveEdgePointAt(pa, pb, projected.position);
  return {...projected, x:exact.x, y:exact.y};
}
function edgeDisplayLabel(e){
  if (!e) return "";
  let label = e.label || (e.kind === "link" ? "" : e.kind);
  const pairCount = edgeFieldPairs(e).length;
  if (e.kind !== "link" && pairCount > 1) label += ` · ${pairCount} cols`;
  return label;
}
function edgeLabelDragPosition(e, projected){
  if (!projected || !Number.isFinite(projected.position)) return .5;
  const label = edgeDisplayLabel(e);
  const width = textW(label, "600 10.5px 'IBM Plex Mono', monospace") + 14;
  const length = Number(projected.totalLength);
  if (!Number.isFinite(length) || length <= 0) return .5;
  const padding = Math.min(.25, (width / 2 + 10) / length);
  return Math.min(1 - padding, Math.max(padding, projected.position));
}
function nearestSnap(value, candidates, threshold){
  let best = null, distance = threshold + Number.EPSILON;
  for (const candidate of candidates){
    const nextDistance = Math.abs(value - candidate);
    if (nextDistance <= distance){ best = candidate; distance = nextDistance; }
  }
  return best;
}
function snapOrthoBend(e, point, ep = edgeEndpoints(e), threshold = 10 / view.k, gridSnap = false){
  const precision = typeof editingSnapOrthoPoint === "function"
    ? editingSnapOrthoPoint(point, threshold, gridSnap) : null;
  if (precision && precision.grid)
    return {...precision, xCandidates:[], yCandidates:[]};
  if (gridSnap){
    const step = GRID_SNAP / 2;
    const x = Math.round(point.x / step) * step;
    const y = Math.round(point.y / step) * step;
    return {x, y, snapX:x, snapY:y, xCandidates:[], yCandidates:[], grid:true, gridStep:step};
  }
  if (!ep) return { x:point.x, y:point.y, snapX:null, snapY:null };
  const route = orthoEdgeRoute(null, ep.pa, ep.pb);
  const xs = [...new Set([route.pa.x, route.a.x, route.auto.x, route.b.x, route.pb.x])];
  const ys = [...new Set([route.pa.y, route.a.y, route.auto.y, route.b.y, route.pb.y])];
  const routeX = nearestSnap(point.x, xs, threshold);
  const routeY = nearestSnap(point.y, ys, threshold);
  const lockedX = precision?.xGuide?.locked === true;
  const lockedY = precision?.yGuide?.locked === true;
  const snapX = lockedX ? precision.snapX
    : routeX != null ? routeX : precision && precision.snapX;
  const snapY = lockedY ? precision.snapY
    : routeY != null ? routeY : precision && precision.snapY;
  return {
    x:snapX == null ? Math.round(point.x) : snapX,
    y:snapY == null ? Math.round(point.y) : snapY,
    snapX,
    snapY,
    xCandidates:xs,
    yCandidates:ys,
    xGuide:precision && precision.xGuide,
    yGuide:precision && precision.yGuide,
    xSource:(lockedX || (routeX == null && precision && precision.snapX != null)) ? precision.xSource
      : routeX != null ? {type:"route",label:"Orthogonal route X",axis:"x",strength:"route"} : null,
    ySource:(lockedY || (routeY == null && precision && precision.snapY != null)) ? precision.ySource
      : routeY != null ? {type:"route",label:"Orthogonal route Y",axis:"y",strength:"route"} : null
  };
}
function resetOrthoBend(e){
  if (!hasCustomOrthoBend(e)) return false;
  pushHistory();
  for (const key of ["orthoX","orthoY","orthoFromStub","orthoToStub"]) delete e[key];
  render();
  return true;
}
function edgePath(e, pa, pb){
  if (!pb){ pb = pa; pa = e; e = null; }
  return e && e.routing === "ortho" ? orthoEdgePath(pa, pb, e) : curveEdgePath(pa, pb);
}
function edgeLineColor(e, colors = themeColors()){
  const base = normalizeHex(e && e.lineColor) || (e && e.kind === "link" ? colors.link : colors.edge);
  return e && typeof formattingEffectiveValue === "function"
    ? formattingEffectiveValue(e,"lineColor",base) : base;
}
function edgeLabelTextColor(e, colors = themeColors()){
  const manual = normalizeHex(e && e.labelTextColor);
  if (!e || typeof formattingResolveAppearance !== "function")
    return manual || edgeLineColor(e, colors);
  const appearance = formattingResolveAppearance(e);
  const hasLabelRule = appearance.sources.labelTextColor?.some(source =>
    source.winning && source.source !== "base");
  return manual || hasLabelRule
    ? appearance.values.labelTextColor
    : edgeLineColor(e, colors);
}
function edgeLabelBackgroundColor(e, colors = themeColors()){
  const base = normalizeHex(e && e.labelBackgroundColor) || colors.labelBg;
  return e && typeof formattingEffectiveValue === "function"
    ? formattingEffectiveValue(e,"labelBackgroundColor",base) : base;
}
function edgeLineWidth(e){
  const width = Number(e && e.lineWidth);
  const base = Number.isFinite(width) ? Math.min(8, Math.max(1, width)) : 1.7;
  const resolved = e && typeof formattingEffectiveValue === "function"
    ? Number(formattingEffectiveValue(e,"lineWidth",base)) : base;
  return Number.isFinite(resolved) ? Math.min(16,Math.max(.5,resolved)) : base;
}
function edgeLineStyle(e){
  const base = e && ["solid","dash","dot"].includes(e.lineStyle)
    ? e.lineStyle : e && e.kind === "link" ? "dash" : "solid";
  const resolved = e && typeof formattingEffectiveValue === "function"
    ? formattingEffectiveValue(e,"lineStyle",base) : base;
  return ["solid","dash","dot"].includes(resolved) ? resolved : base;
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
function drawEdge(e, hidden = null, proxies = null){
  const ep = edgeEndpoints(e, hidden, proxies);
  if (!ep) return;
  const selected = isSelected("edge", e.id);
  const isLink = e.kind === "link";
  const t = themeColors();
  const color = edgeLineColor(e, t);
  const width = edgeLineWidth(e);
  const attrs = {"data-edge":e.id, cursor:"pointer",
    ...(typeof organizationRenderAttributes === "function" ? organizationRenderAttributes(e) : {})};
  if (ep.proxyA) attrs["data-edge-proxy-from"] = ep.proxyA;
  if (ep.proxyB) attrs["data-edge-proxy-to"] = ep.proxyB;
  const g = el("g", attrs, edgeLayer);
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
  const label = edgeDisplayLabel(e);
  if (label){
    const {x:mx, y:my} = edgeLabelPoint(e, ep);
    const w = textW(label, "600 10.5px 'IBM Plex Mono', monospace") + 14;
    const labelTextColor = edgeLabelTextColor(e, t);
    const labelBackgroundColor = edgeLabelBackgroundColor(e, t);
    const labelGroup = el("g", {"data-edge-label-handle":e.id, cursor:"move"}, g);
    el("title", {}, labelGroup).textContent = "Drag label along link";
    el("rect", {x:mx - w/2, y:my - 10, width:w, height:20, rx:10,
                fill:labelBackgroundColor, stroke:color, "stroke-width":1, "data-edge-label-bg":"1"}, labelGroup);
    el("text", {x:mx, y:my + 3.5, "text-anchor":"middle", fill:labelTextColor,
                "font-family":"'IBM Plex Mono', monospace", "font-size":10.5,
                "font-weight":600, "data-edge-label":"1"}, labelGroup).textContent = label;
  }
  if (typeof formattingDecorateGroup === "function")
    formattingDecorateGroup(g,e);
  if (typeof routingDrawEdgeDiagnostic === "function")
    routingDrawEdgeDiagnostic(g,e);
}

/* ---- nodes ---- */
function drawFrameCollapseControl(parent, n, r, collapsed, color){
  const t = themeColors();
  const collapseLabel = `${collapsed ? "Expand" : "Collapse"} frame ${n.title || "Subject area"}`;
  const collapse = el("g", {"data-collapse":n.id, cursor:"pointer", role:"button", tabindex:0,
                              "aria-label":collapseLabel}, parent);
  el("title", {}, collapse).textContent = collapseLabel;
  el("rect", {x:r.w - 34, y:0, width:34, height:collapsed ? r.h : 34, fill:"transparent"}, collapse);
  el("path", {d:collapsed
                ? `M ${r.w-22} ${r.h/2-4} L ${r.w-16} ${r.h/2} L ${r.w-22} ${r.h/2+4}`
                : `M ${r.w-24} 15 L ${r.w-19} 20 L ${r.w-14} 15`,
              fill:"none", stroke:collapsed ? t.muted : color, "stroke-width":1.8,
              "stroke-linecap":"round", "stroke-linejoin":"round", "pointer-events":"none"}, collapse);
  collapse.addEventListener("keydown", ev => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    ev.stopPropagation();
    setFrameCollapsed(n, n.collapsed !== true);
  });
  return collapse;
}
function drawCollapsedFrameControlOverlay(n){
  const r = nodeRect(n);
  const overlay = el("g", {"data-frame-collapse-overlay":n.id,
                            transform:`translate(${r.x},${r.y})`,
                            ...(typeof organizationRenderAttributes === "function" ? organizationRenderAttributes(n) : {})}, nodeLayer);
  drawFrameCollapseControl(overlay, n, r, true, n.color || frameColorDefault());
}
function drawFrame(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const color = n.color || frameColorDefault();
  const borderEnabled = frameBorderEnabled(n);
  const borderWidth = frameBorderWidth(n);
  const collapsed = n.collapsed === true;
  const layer = collapsed ? nodeLayer : frameLayer;
  const g = el("g", {"data-node":n.id, "data-frame":n.id,
                      "data-frame-collapsed":collapsed ? "true" : "false",
                      transform:`translate(${r.x},${r.y})`, cursor:"grab",
                      ...(typeof organizationRenderAttributes === "function" ? organizationRenderAttributes(n) : {})}, layer);
  el("rect", {width:r.w, height:r.h, rx:collapsed ? 9 : 14, fill:collapsed ? t.panel : color,
              "fill-opacity":collapsed ? 1 : .10,
              stroke:borderEnabled ? frameBorderColor(n) : "none",
              "stroke-width":borderEnabled ? borderWidth : 0,
              "data-frame-surface":"1", "data-frame-border":borderEnabled ? "true" : "false"}, g);
  if (selected){
    const offset = borderEnabled ? borderWidth / 2 + 2 : 2;
    el("rect", {x:-offset, y:-offset, width:r.w + offset*2, height:r.h + offset*2,
                rx:(collapsed ? 9 : 14) + offset, fill:"none", stroke:t.accent,
                "stroke-width":2, "pointer-events":"none", "data-frame-selection":"1"}, g);
  }
  if (collapsed){
    el("path", {d:`M 9 0 H 7 Q 0 0 0 9 V ${r.h-9} Q 0 ${r.h} 9 ${r.h} H 7 Z`,
                fill:color, "data-frame-accent":"1"}, g);
    el("text", {x:18, y:20, fill:t.ink, "font-family":"Archivo, sans-serif",
                "font-size":13, "font-weight":700, "data-frame-title":"1"}, g)
      .textContent = truncate(n.title || "Subject area", r.w - 56, "700 13px Archivo, sans-serif");
    const count = collapsedFrameContentNodes(n).length;
    el("text", {x:18, y:36, fill:t.muted, "font-family":"'IBM Plex Mono', monospace",
                "font-size":9.5, "font-weight":500, "data-frame-count":"1"}, g)
      .textContent = `${count} item${count === 1 ? "" : "s"} hidden`;
  } else {
    el("text", {x:14, y:24, fill:t.ink, "font-family":"Archivo, sans-serif",
                "font-size":13, "font-weight":700, "data-frame-title":"1"}, g)
      .textContent = truncate(n.title || "Subject area", r.w - 70, "700 13px Archivo, sans-serif");
  }
  if (!collapsed) drawFrameCollapseControl(g, n, r, false, color);
  if (!collapsed){
    const h = el("g", {class:"frame-resize", "data-frame-resize":n.id, cursor:"nwse-resize"}, g);
    el("rect", {x:r.w - 18, y:r.h - 18, width:18, height:18, fill:"transparent"}, h);
    el("path", {d:`M ${r.w-15} ${r.h-5} L ${r.w-5} ${r.h-15} M ${r.w-10} ${r.h-5} L ${r.w-5} ${r.h-10}`,
                stroke:selected ? t.accent : color, "stroke-width":1.6, "stroke-linecap":"round"}, h);
  }
  if (typeof formattingDecorateGroup === "function")
    formattingDecorateGroup(g,n);
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
                      transform:`translate(${r.x},${r.y})`, cursor:"grab",
                      ...(typeof organizationRenderAttributes === "function" ? organizationRenderAttributes(n) : {})}, frameLayer);
  el("rect", {width:r.w, height:r.h, rx:10, fill:bodyColor,
              stroke:selected ? t.accent : t.ink2, "stroke-width":selected ? 2.4 : 1.4,
              "data-swimlane-body":"1"}, g);
  if (orientation === "horizontal"){
    el("path", {d:`M 10 0 H ${titleSize} V ${r.h} H 10 Q 0 ${r.h} 0 ${r.h-10} V 10 Q 0 0 10 0 Z`,
                fill:titleColor, "data-swimlane-title-band":"1"}, g);
    el("line", {x1:titleSize, y1:0, x2:titleSize, y2:r.h, stroke:t.ink2, "stroke-width":1.2,
                "data-swimlane-divider":"1"}, g);
    el("text", {x:0, y:0, transform:`translate(${titleSize/2},${r.h/2}) rotate(-90)`,
                "text-anchor":"middle", "dominant-baseline":"middle", fill:autoInk(titleColor),
                "font-family":"Archivo, sans-serif", "font-size":14, "font-weight":700,
                "data-swimlane-title":"1"}, g)
      .textContent = truncate(n.title || "Horizontal lane", Math.max(40, r.h - 28), "700 14px Archivo, sans-serif");
  } else {
    el("path", {d:`M 10 0 H ${r.w-10} Q ${r.w} 0 ${r.w} 10 V ${titleSize} H 0 V 10 Q 0 0 10 0 Z`,
                fill:titleColor, "data-swimlane-title-band":"1"}, g);
    el("line", {x1:0, y1:titleSize, x2:r.w, y2:titleSize, stroke:t.ink2, "stroke-width":1.2,
                "data-swimlane-divider":"1"}, g);
    el("text", {x:r.w/2, y:titleSize/2, "text-anchor":"middle", "dominant-baseline":"middle",
                fill:autoInk(titleColor), "font-family":"Archivo, sans-serif", "font-size":14,
                "font-weight":700, "data-swimlane-title":"1"}, g)
      .textContent = truncate(n.title || "Vertical lane", Math.max(40, r.w - 28), "700 14px Archivo, sans-serif");
  }
  const h = el("g", {class:"frame-resize", "data-frame-resize":n.id, cursor:"nwse-resize"}, g);
  el("rect", {x:r.w - 18, y:r.h - 18, width:18, height:18, fill:"transparent"}, h);
  el("path", {d:`M ${r.w-15} ${r.h-5} L ${r.w-5} ${r.h-15} M ${r.w-10} ${r.h-5} L ${r.w-5} ${r.h-10}`,
              stroke:selected ? t.accent : t.ink2, "stroke-width":1.6, "stroke-linecap":"round"}, h);
  if (typeof formattingDecorateGroup === "function")
    formattingDecorateGroup(g,n);
}
function drawStructuralNode(n){
  if (n.type === "swimlane") drawSwimlane(n);
  else drawFrame(n);
}
function drawStandardShape(g, shape, r, attrs, dataAttr = "data-node-shape"){
  const common = { ...attrs, [dataAttr]:shape, "stroke-linejoin":"round" };
  if (shape === "process") return el("rect", {width:r.w, height:r.h, rx:4, ...common}, g);
  if (shape === "rectangle")
    return el("rect", {width:r.w, height:r.h, ...common, rx:0, "stroke-linejoin":"miter"}, g);
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
function drawNodeIcon(parent, icon, x, y, size, ink){
  if (!icon || !Number.isFinite(x) || !Number.isFinite(y) || !size) return null;
  const group = el("g", {
    transform:`translate(${x},${y})`, "pointer-events":"none",
    "data-node-icon":icon.token, "data-icon-library":icon.library,
    "data-icon-name":icon.name, "data-icon-size":size
  }, parent);
  el("rect", {width:size, height:size, rx:Math.max(6, size*.2),
              fill:ink, "fill-opacity":.10, stroke:ink, "stroke-opacity":.08}, group);
  if (icon.library === "emoji"){
    const glyph = el("text", {x:size/2, y:size/2 + size*.29,
      "text-anchor":"middle", "font-family":"'Apple Color Emoji','Segoe UI Emoji',sans-serif",
      "font-size":size*.58, "data-node-emoji":"1"}, group);
    glyph.textContent = icon.name;
    return group;
  }
  if (icon.library === "lucide"){
    const inner = size*.56;
    const scale = inner/24;
    const offset = (size - inner)/2;
    const vector = el("g", {transform:`translate(${offset},${offset}) scale(${scale})`,
      fill:"none", stroke:ink, "stroke-width":2, "stroke-linecap":"round",
      "stroke-linejoin":"round", "data-node-vector-icon":"lucide"}, group);
    for (const [tag, attrs] of icon.data.elements) el(tag, attrs, vector);
    return group;
  }
  const inner = size*.54;
  const scale = inner / Math.max(icon.data.width, icon.data.height);
  const tx = (size - icon.data.width*scale)/2;
  const ty = (size - icon.data.height*scale)/2;
  const vector = el("g", {transform:`translate(${tx},${ty}) scale(${scale})`,
    "data-node-vector-icon":"font-awesome"}, group);
  el("path", {d:icon.data.path, fill:ink}, vector);
  return group;
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
    const span = el("tspan", {x:layout.textX, y:firstY + i*layout.lineH, "data-text-line":i+1}, text);
    span.textContent = line;
  });
}
function drawStatusNode(g, n, r, selected, t){
  const layout = statusNodeLayout(n);
  const fill = n.color || conceptColors()[1];
  const bodyInk = n.fontColor || autoInk(fill, t);
  const bandFill = statusColor(layout.status);
  const bandInk = autoInk(bandFill, t);
  const left = layout.side === "left";
  const bandX = left ? 0 : r.w - layout.bandW;
  const mainX = left ? layout.bandW : 0;
  const mainCenter = mainX + layout.mainW/2;
  const bandCenter = bandX + layout.bandW/2;
  const radius = Math.min(10, r.h/2);

  g.setAttribute("data-status-node", n.id);
  g.setAttribute("data-status-side", layout.side);
  g.setAttribute("data-status-value", layout.status);
  el("rect", {width:r.w, height:r.h, rx:radius, fill, "data-status-surface":"1"}, g);
  const bandPath = left
    ? `M ${radius} 0 H ${layout.bandW} V ${r.h} H ${radius} Q 0 ${r.h} 0 ${r.h-radius} V ${radius} Q 0 0 ${radius} 0 Z`
    : `M ${bandX} 0 H ${r.w-radius} Q ${r.w} 0 ${r.w} ${radius} V ${r.h-radius} Q ${r.w} ${r.h} ${r.w-radius} ${r.h} H ${bandX} Z`;
  el("path", {d:bandPath, fill:bandFill, "pointer-events":"none",
              "data-status-band":"1"}, g);
  el("line", {x1:left ? layout.bandW : bandX, y1:0,
              x2:left ? layout.bandW : bandX, y2:r.h,
              stroke:t.ink, "stroke-width":1, opacity:.22, "pointer-events":"none"}, g);
  el("rect", {width:r.w, height:r.h, rx:radius, fill:"none", "pointer-events":"none",
              stroke:selected ? t.accent : t.ink, "stroke-width":selected ? 2.2 : 1.2,
              "data-status-outline":"1"}, g);

  const decorated = !!layout.decoration.icon || layout.subtitleLines.length > 0;
  if (layout.decoration.icon){
    const requested=typeof formattingEffectiveValue === "function"
      ? Number(formattingEffectiveValue(n,"iconSize",layout.decoration.iconSize))
      : layout.decoration.iconSize;
    const size=Number.isFinite(requested) ? Math.max(10,Math.min(96,requested))
      : layout.decoration.iconSize;
    drawNodeIcon(g, layout.decoration.icon,
      layout.iconX+(layout.decoration.iconSize-size)/2,
      layout.iconY+(layout.decoration.iconSize-size)/2,size,bodyInk);
  }
  const title = el("text", {"text-anchor":decorated ? layout.textAnchor : "middle",
              fill:bodyInk, "pointer-events":"none",
              "font-family":"Archivo, sans-serif", "font-size":layout.fs, "font-weight":600,
              "data-status-title":"1"}, g);
  const firstTitleY = decorated ? layout.firstTitleY
    : r.h/2 - ((layout.titleLines.length - 1) * layout.lineH)/2 + layout.fs*.35;
  layout.titleLines.forEach((line, i) => {
    const span = el("tspan", {x:decorated ? layout.textX : mainCenter,
                              y:firstTitleY + i*layout.lineH,
                              "data-status-title-line":i+1}, title);
    span.textContent = line;
  });
  if (layout.subtitleLines.length){
    const subtitle = el("text", {"text-anchor":layout.textAnchor, fill:bodyInk,
                opacity:.72, "pointer-events":"none", "font-family":"Archivo, sans-serif",
                "font-size":layout.decoration.subtitleFs, "font-weight":500,
                "data-status-subtitle":"1"}, g);
    layout.subtitleLines.forEach((line, i) => {
      const span = el("tspan", {x:layout.textX,
        y:layout.firstSubtitleY + i*layout.decoration.subtitleLineH,
        "data-status-subtitle-line":i+1}, subtitle);
      span.textContent = line;
    });
  }

  const status = el("text", {"text-anchor":"middle", fill:bandInk, "pointer-events":"none",
              "font-family":"Archivo, sans-serif", "font-size":layout.statusFs, "font-weight":700,
              "data-status-label":"1"}, g);
  const firstStatusY = r.h/2 - ((layout.statusLines.length - 1) * layout.statusLineH)/2 + layout.statusFs*.35;
  layout.statusLines.forEach((line, i) => {
    const span = el("tspan", {x:bandCenter, y:firstStatusY + i*layout.statusLineH,
                              "data-status-label-line":i+1}, status);
    span.textContent = line;
  });
  /* The painted band and text ignore pointer events so they never interfere with
     dragging. A transparent surface restores a precise hit target for the
     band-specific double-click action; node drag and anchors still work normally. */
  el("rect", {x:bandX, y:0, width:layout.bandW, height:r.h, fill:"transparent",
              cursor:"pointer", "data-status-band-hit":"1"}, g);
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
function drawConceptPorts(parent, n, r, layout, ink){
  if (!layout.ports) return;
  const ports = nodePortPoints(n, {x:0, y:0, w:r.w, h:r.h, cx:r.w/2, cy:r.h/2});
  if (!ports) return;
  const middleGap = 16;
  const attrs = {
    fill:ink, opacity:.78, "pointer-events":"none", "font-family":"'IBM Plex Mono', monospace",
    "font-size":layout.portFs, "font-weight":600
  };
  for (const port of ports.inputs){
    const left=port.side==="w";
    const maxWidth = Math.max(18, left ? r.w/2-port.x-middleGap : port.x-r.w/2-middleGap);
    const text = el("text", {...attrs, x:port.x+(left?12:-12), y:port.y+layout.portFs*.36,
      "text-anchor":left?"start":"end", "data-node-input-label":"1",
      "data-port-label-id":port.id, "data-port-label-side":"input"}, parent);
    text.textContent = truncate(port.label, maxWidth, layout.portFont);
  }
  for (const port of ports.outputs){
    const left=port.side==="w";
    const maxWidth = Math.max(18, left ? r.w/2-port.x-middleGap : port.x-r.w/2-middleGap);
    const text = el("text", {...attrs, x:port.x+(left?12:-12), y:port.y+layout.portFs*.36,
      "text-anchor":left?"start":"end", "data-node-output-label":"1",
      "data-port-label-id":port.id, "data-port-label-side":"output"}, parent);
    text.textContent = truncate(port.label, maxWidth, layout.portFont);
  }
}
function nodeSvgTransform(n, r = nodeRect(n)){
  const cx = r.w/2, cy = r.h/2;
  const transforms = [`translate(${r.x},${r.y})`];
  const rotation = nodeRotation(n);
  if (rotation) transforms.push(`rotate(${rotation},${cx},${cy})`);
  if (nodeFlipX(n) || nodeFlipY(n))
    transforms.push(`translate(${cx},${cy}) scale(${nodeFlipX(n) ? -1 : 1},${nodeFlipY(n) ? -1 : 1}) translate(${-cx},${-cy})`);
  return transforms.join(" ");
}
function preserveReadableNodeText(g, n){
  if (!nodeFlipX(n) && !nodeFlipY(n)) return;
  const sx = nodeFlipX(n) ? -1 : 1, sy = nodeFlipY(n) ? -1 : 1;
  for (const icon of g.querySelectorAll("[data-node-icon]")){
    const size = Number(icon.getAttribute("data-icon-size"));
    if (!Number.isFinite(size)) continue;
    const existing = icon.getAttribute("transform") || "";
    icon.setAttribute("transform",
      `${existing} translate(${size/2},${size/2}) scale(${sx},${sy}) translate(${-size/2},${-size/2})`.trim());
  }
  for (const text of g.querySelectorAll("text")){
    if (text.closest("[data-node-icon]")) continue;
    const coordinate = text.hasAttribute("x") && text.hasAttribute("y") ? text
      : text.querySelector("tspan[x][y]");
    if (!coordinate) continue;
    const x = Number(coordinate.getAttribute("x"));
    const y = Number(coordinate.getAttribute("y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const existing = text.getAttribute("transform");
    const counter = `translate(${x},${y}) scale(${sx},${sy}) translate(${-x},${-y})`;
    text.setAttribute("transform", existing ? `${existing} ${counter}` : counter);
  }
}
function drawNode(n){
  const r = nodeRect(n);
  const selected = isSelected("node", n.id);
  const t = themeColors();
  const g = el("g", {"data-node": n.id, transform:nodeSvgTransform(n, r), cursor:"grab",
    ...(typeof organizationRenderAttributes === "function" ? organizationRenderAttributes(n) : {})}, nodeLayer);

  if (n.type === "concept"){
    const fs = conceptFont(n);
    const fc = n.fontColor || autoInk(n.color || conceptColors()[0], t);
    const shape = conceptShape(n);
    const wrapped = conceptWrappedLayout(n);
    drawConceptShape(g, n, r, {fill:n.color || conceptColors()[0],
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.2});
    if (wrapped){
      const decorated = !!wrapped.decoration;
      if (decorated && wrapped.decoration.icon){
        const requested=typeof formattingEffectiveValue === "function"
          ? Number(formattingEffectiveValue(n,"iconSize",wrapped.decoration.iconSize))
          : wrapped.decoration.iconSize;
        const size=Number.isFinite(requested) ? Math.max(10,Math.min(96,requested))
          : wrapped.decoration.iconSize;
        drawNodeIcon(g, wrapped.decoration.icon,
          wrapped.iconX+(wrapped.decoration.iconSize-size)/2,
          wrapped.iconY+(wrapped.decoration.iconSize-size)/2,size,fc);
      }
      const titleText = el("text", {"text-anchor":decorated ? wrapped.textAnchor : "middle",
                  fill:fc, "pointer-events":"none",
                  "font-family":"Archivo, sans-serif", "font-size":fs, "font-weight":600,
                  "data-concept-wrapped":"1"}, g);
      const firstY = decorated ? wrapped.firstTitleY
        : wrapped.centerY - ((wrapped.lines.length - 1) * wrapped.lineH)/2 + fs*.35;
      wrapped.lines.forEach((line, i) => {
        const span = el("tspan", {x:decorated ? wrapped.textX : r.w/2,
          y:firstY + i*wrapped.lineH, "data-concept-line":i+1}, titleText);
        span.textContent = line;
      });
      if (decorated && wrapped.subtitleLines.length){
        const subtitle = el("text", {"text-anchor":wrapped.textAnchor, fill:fc,
                    opacity:.72, "pointer-events":"none", "font-family":"Archivo, sans-serif",
                    "font-size":wrapped.decoration.subtitleFs, "font-weight":500,
                    "data-concept-subtitle":"1"}, g);
        wrapped.subtitleLines.forEach((line, i) => {
          const span = el("tspan", {x:wrapped.textX,
            y:wrapped.firstSubtitleY + i*wrapped.decoration.subtitleLineH,
            "data-concept-subtitle-line":i+1}, subtitle);
          span.textContent = line;
        });
      }
      drawConceptPorts(g, n, r, wrapped, fc);
    } else {
      const titleText = el("text", {x:r.w/2, y:r.h/2 + fs*0.35, "text-anchor":"middle", fill:fc,
                  "font-family":"Archivo, sans-serif", "font-size":fs, "font-weight":600}, g);
      titleText.textContent = truncate(n.title || "Untitled", conceptTextWidth(shape, r.w), `600 ${fs}px Archivo, sans-serif`);
    }
    if (n.notes){
      const noteAtSide = shape === "decision" || shape === "terminator" || shape === "document" || shape === "circle";
      const noteX = shape === "triangle" ? r.w*.72 : noteAtSide ? r.w - 14 : r.w - 12;
      const noteY = nodePortsEnabled(n) ? 12 : shape === "triangle" ? r.h*.74 : noteAtSide ? r.h/2 : 12;
      el("circle", {cx:noteX, cy:noteY,
                    r:3.2, fill:t.ink, opacity:.55}, g);
    }
  } else if (n.type === "text"){
    drawPlainText(g, n, r, selected, t);
  } else if (n.type === "status"){
    drawStatusNode(g, n, r, selected, t);
  } else if (n.type === "note"){
    drawRichNote(g, n, r, selected, t);
  } else if (n.type === "todo"){
    const m = tableMetrics(n);
    const fc = n.fontColor || autoInk(n.color || todoColorDefault(), t);
    const total = n.items.length;
    const doneCount = n.items.filter(it => it.done).length;
    el("rect", {width:r.w, height:r.h, rx:10, fill:t.tableFill, "data-node-outline":"1",
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.3}, g);
    el("path", {d:`M 0 10 Q 0 0 10 0 H ${r.w-10} Q ${r.w} 0 ${r.w} 10 V ${m.headerH} H 0 Z`,
                fill: n.color || todoColorDefault(), "data-node-fill":"1"}, g);
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
        const cb = el("g", {"data-todocheck": it.id, "data-todonode": n.id,
                            "data-todo-row-detail":"1", cursor:"pointer",
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
                    "data-todo-row-detail":"1",
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
    el("rect", {width:r.w, height:r.h, rx:8, fill:t.tableFill, "data-node-outline":"1",
                stroke: selected ? t.accent : t.ink,
                "stroke-width": selected ? 2.2 : 1.3}, g);
    const hInk = autoInk(n.color || t.ink, t);
    el("path", {d:`M 0 8 Q 0 0 8 0 H ${r.w-8} Q ${r.w} 0 ${r.w} 8 V ${m.headerH} H 0 Z`,
                fill: n.color || t.ink, "data-node-fill":"1"}, g);
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
                    "data-table-row-detail":"1",
                    fill: f.pk ? t.ink : f.unique ? t.accent : t.tableFill,
                    stroke:t.ink, "stroke-width":.9}, g);
        el("text", {x:8 + m.badgeW/2, y:cy + m.badgeSize*0.34, "text-anchor":"middle",
                    "data-table-row-detail":"1",
                    fill: f.pk || f.unique ? autoInk(f.pk ? t.ink : t.accent, t) : t.ink,
                    "font-family":"'IBM Plex Mono', monospace", "font-size":m.badgeSize,
                    "font-weight":600}, g).textContent = badge;
      }
      const nm = el("text", {x:m.nameX, y:cy + m.nameSize*0.35, fill:fc,
                  "data-table-row-detail":"1",
                  "font-family":"'IBM Plex Mono', monospace", "font-size":m.nameSize,
                  "font-weight":500}, g);
      if (f.comment) nm.setAttribute("title", f.comment);
      nm.textContent = f.name + (f.nullable ? "?" : "");
      el("text", {x:r.w-12, y:cy + m.nameSize*0.35, "text-anchor":"end", fill:t.muted,
                  "data-table-row-detail":"1",
                  "font-family":"'IBM Plex Mono', monospace", "font-size":m.typeSize}, g)
        .textContent = f.type;
    });
    if (!n.fields.length)
      el("text", {x:12, y:m.headerH + 16, fill:t.empty, "font-family":"Archivo, sans-serif",
                  "font-size":11.5, "font-style":"italic"}, g).textContent = "no fields yet";

    drawRowHandles(g, n, n.fields, r, t);
    }
  }

  if (n.targetPageId && typeof pagesPageById === "function"){
    const targetPage = pagesPageById(n.targetPageId);
    if (targetPage){
      const link = el("g", {"data-page-link":n.id,cursor:"pointer",role:"button",tabindex:"0",
        "aria-label":`Open detail page ${targetPage.name}`},g);
      const title = el("title",{},link);
      title.textContent = `Open detail page: ${targetPage.name}`;
      el("rect",{x:Math.max(4,r.w-28),y:-10,width:24,height:20,rx:10,
        fill:t.panel,stroke:t.accent,"stroke-width":1.4},link);
      el("text",{x:Math.max(16,r.w-16),y:4,"text-anchor":"middle",
        fill:t.accent,"font-family":"'IBM Plex Mono', monospace","font-size":11,
        "font-weight":700,"pointer-events":"none"},link).textContent="↗";
    }
  }

  /* Standard attachment points plus table-only title-left/title-right anchors.
     mr stays always-visible as the primary whole-node affordance. Table title
     anchors reveal like row handles and bind to the title, never to a field.
     Port-enabled concepts keep both labeled side handles visible. */
  const anchorPts = anchorPointsForNode(n, { x:0, y:0, w:r.w, h:r.h, cx:r.w/2, cy:r.h/2 });
  const cleanText = n.type === "text" && textBoxShape(n) === "none";
  for (const key of nodeAnchorKeys(n)){
    if (nodePortsEnabled(n) && (key === "ml" || key === "mr")) continue;
    const p = anchorPts[key];
    const tableTitle = key === "hl" || key === "hr";
    const primaryVisible = key === "mr" && (!cleanText || selected);
    const attrs = {class: tableTitle ? "fieldhandle tabletitlehandle" : primaryVisible ? "" : "anchorhandle",
                   "data-handle": n.id, "data-anchor": key, cursor:"crosshair"};
    if (tableTitle) attrs["data-table-title-anchor"] = key;
    const hg = el("g", attrs, g);
    el("circle", {cx:p.x, cy:p.y, r: tableTitle || key !== "mc" ? 12 : 8, fill:"transparent"}, hg);
    el("circle", {cx:p.x, cy:p.y, r: !tableTitle && key === "mr" ? 5.5 : 3.6, fill:t.tableFill,
                  stroke: tableTitle || selected ? t.accent : t.ink, "stroke-width":1.4,
                  opacity: tableTitle || selected ? 1 : .55}, hg);
  }
  const ports = nodePortPoints(n, {x:0, y:0, w:r.w, h:r.h, cx:r.w/2, cy:r.h/2});
  if (ports){
    for (const port of ports.inputs.concat(ports.outputs)){
      const hg = el("g", {"data-handle":n.id, "data-anchor":port.key,
                          "data-node-port":port.portSide, "data-node-port-id":port.id,
                          cursor:"crosshair"}, g);
      el("circle", {cx:port.x, cy:port.y, r:12, fill:"transparent"}, hg);
      el("circle", {cx:port.x, cy:port.y, r:5.5, fill:t.tableFill, stroke:t.ink,
                    "stroke-width":1.4}, hg);
    }
  }
  preserveReadableNodeText(g, n);
  if (typeof formattingDecorateGroup === "function")
    formattingDecorateGroup(g,n);
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
