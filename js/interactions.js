"use strict";

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
  if (e.routing === "ortho"){
    const route = orthoEdgeRoute(e, ep.pa, ep.pb);
    const activeSnap = drag && drag.mode === "ortho-bend" && drag.edgeId === e.id ? drag.snap : null;
    if (activeSnap && activeSnap.snapX != null){
      const ys = route.points.map(point => point.y);
      el("line", {x1:activeSnap.snapX, y1:Math.min(...ys)-36, x2:activeSnap.snapX, y2:Math.max(...ys)+36,
                  stroke:t.accent, "stroke-width":1, "stroke-dasharray":"4 4", opacity:.72,
                  "pointer-events":"none", "data-ortho-snap-x":"1"}, draftLayer);
    }
    if (activeSnap && activeSnap.snapY != null){
      const xs = route.points.map(point => point.x);
      el("line", {x1:Math.min(...xs)-36, y1:activeSnap.snapY, x2:Math.max(...xs)+36, y2:activeSnap.snapY,
                  stroke:t.accent, "stroke-width":1, "stroke-dasharray":"4 4", opacity:.72,
                  "pointer-events":"none", "data-ortho-snap-y":"1"}, draftLayer);
    }
    for (const [index, corner] of orthoRouteCornerHandles(route).entries()){
      const {point, axes, key} = corner;
      const direction = axes.length === 2 ? "" : axes[0] === "x" ? " horizontally" : " vertically";
      const cursor = axes.length === 2 ? "move" : axes[0] === "x" ? "ew-resize" : "ns-resize";
      const handle = el("g", {"data-edgebend":e.id, "data-edgecorner":key,
                              "data-corner-axes":axes.join(""), cursor, role:"button", tabindex:0,
                              "aria-label":`Move orthogonal link corner ${index + 1}${direction} at ` +
                                `${Math.round(point.x)}, ${Math.round(point.y)}`}, draftLayer);
      const hitRadius = key === "from-stub" || key === "to-stub" ? 8 : 14;
      el("circle", {cx:point.x, cy:point.y, r:hitRadius, fill:"transparent"}, handle);
      el("rect", {x:point.x-5, y:point.y-5, width:10, height:10, rx:2,
                  fill:t.panel, stroke:t.accent, "stroke-width":2}, handle);
      el("title", {}, handle).textContent = `Drag this orthogonal link corner${direction}; ` +
        "hold Shift to snap to grid points and half-grid positions";
      handle.addEventListener("keydown", ev => {
        const delta = {
          ArrowLeft:{axis:"x", amount:-1}, ArrowRight:{axis:"x", amount:1},
          ArrowUp:{axis:"y", amount:-1}, ArrowDown:{axis:"y", amount:1}
        }[ev.key];
        if (!delta || !axes.includes(delta.axis)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const step = ev.shiftKey ? GRID_SNAP : 4;
        pushHistory(`ortho-corner:${e.id}:${key}`);
        const next = {...point, [delta.axis]:point[delta.axis] + delta.amount*step};
        setOrthoCornerPosition(e, route, corner, next);
        render();
        requestAnimationFrame(() => {
          const nextHandle = document.querySelector(
            `[data-edgebend="${e.id}"][data-edgecorner="${key}"]`);
          if (nextHandle) nextHandle.focus();
        });
      });
    }
  }
}
/* hitTest, but tolerant of drops just outside a node's rect — attachment points
   sit on the boundary, so precise drops often land a pixel or two outside */
function looseHit(w, tol = 16){
  const hit = hitTest(w);
  if (hit) return hit;
  const hidden = collapsedFrameHiddenNodeIds();
  for (let i = state.nodes.length - 1; i >= 0; i--){
    const n = state.nodes[i];
    if (isStructuralNode(n) || hidden.has(n.id)) continue;
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
  const na = !hit.field ? nearestAnchorWithin(n, w) : null;
  const newFromPort = isFrom ? (na?.portId || "") : (e.fromPort || "");
  const newToPort = !isFrom ? (na?.portId || "") : (e.toPort || "");
  const dup = state.edges.some(o => {
    if (o === e) return false;
    const of = [o.from, o.fromField || "", o.fromPort || ""].join(":");
    const ot = [o.to, o.toField || "", o.toPort || ""].join(":");
    const nf = [newFrom, newFromField, newFromPort].join(":");
    const nt = [newTo, newToField, newToPort].join(":");
    return (of === nf && ot === nt) || (of === nt && ot === nf);
  });
  if (dup){ render(); return; }
  pushHistory();
  if (isFrom) e.from = n.id; else e.to = n.id;
  const fieldKey = isFrom ? "fromField" : "toField";
  const anchorKey = isFrom ? "fromAnchor" : "toAnchor";
  const portKey = isFrom ? "fromPort" : "toPort";
  if (hit.field){
    e[fieldKey] = hit.field.id;
    delete e[anchorKey];
    delete e[portKey];
  } else {
    delete e[fieldKey];
    if (na?.portId){
      e[portKey] = na.portId;
      delete e[anchorKey];
    } else {
      delete e[portKey];
      if (na) e[anchorKey] = na.key; else delete e[anchorKey];
    }
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
/* Detect equal edge-to-edge gaps around the moving object. Distribution only
   applies when the two outside objects already share the same cross-axis bound;
   the moving object can then capture both that alignment and the equal gap. */
function smartDistributionSnap(movingRect, targetRects, threshold){
  const moving = alignmentCoordinates(movingRect);
  const targets = targetRects.map(rect => ({rect, coordinates:alignmentCoordinates(rect)}));
  const epsilon = .5;
  let xMatch = null, yMatch = null;
  const better = (candidate, current) => !current || candidate.score < current.score - 1e-9;

  for (let keyIndex = 0; keyIndex < moving.y.length; keyIndex++){
    const movingCross = moving.y[keyIndex];
    const candidates = targets.filter(target =>
      Math.abs(target.coordinates.y[keyIndex].value - movingCross.value) <= threshold);
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++){
      const a = candidates[i], b = candidates[j];
      const aCross = a.coordinates.y[keyIndex].value;
      const bCross = b.coordinates.y[keyIndex].value;
      if (Math.abs(aCross - bCross) > epsilon) continue;
      const crossCoordinate = (aCross + bCross) / 2;
      const crossDelta = crossCoordinate - movingCross.value;
      if (Math.abs(crossDelta) > threshold) continue;
      const beforeRect = a.rect.x <= b.rect.x ? a.rect : b.rect;
      const afterRect = beforeRect === a.rect ? b.rect : a.rect;
      const available = afterRect.x - (beforeRect.x + beforeRect.w) - movingRect.w;
      if (available < -epsilon) continue;
      const gap = Math.max(0, available / 2);
      const desired = beforeRect.x + beforeRect.w + gap;
      const delta = desired - movingRect.x;
      if (Math.abs(delta) > threshold) continue;
      const candidate = {delta, crossDelta, crossCoordinate, gap,
        alignmentKey:movingCross.key, beforeRect, afterRect,
        score:Math.max(Math.abs(delta), Math.abs(crossDelta))};
      if (better(candidate, xMatch)) xMatch = candidate;
    }
  }

  for (let keyIndex = 0; keyIndex < moving.x.length; keyIndex++){
    const movingCross = moving.x[keyIndex];
    const candidates = targets.filter(target =>
      Math.abs(target.coordinates.x[keyIndex].value - movingCross.value) <= threshold);
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++){
      const a = candidates[i], b = candidates[j];
      const aCross = a.coordinates.x[keyIndex].value;
      const bCross = b.coordinates.x[keyIndex].value;
      if (Math.abs(aCross - bCross) > epsilon) continue;
      const crossCoordinate = (aCross + bCross) / 2;
      const crossDelta = crossCoordinate - movingCross.value;
      if (Math.abs(crossDelta) > threshold) continue;
      const beforeRect = a.rect.y <= b.rect.y ? a.rect : b.rect;
      const afterRect = beforeRect === a.rect ? b.rect : a.rect;
      const available = afterRect.y - (beforeRect.y + beforeRect.h) - movingRect.h;
      if (available < -epsilon) continue;
      const gap = Math.max(0, available / 2);
      const desired = beforeRect.y + beforeRect.h + gap;
      const delta = desired - movingRect.y;
      if (Math.abs(delta) > threshold) continue;
      const candidate = {delta, crossDelta, crossCoordinate, gap,
        alignmentKey:movingCross.key, beforeRect, afterRect,
        score:Math.max(Math.abs(delta), Math.abs(crossDelta))};
      if (better(candidate, yMatch)) yMatch = candidate;
    }
  }
  return {xMatch, yMatch};
}
function smartObjectSnap(movingRect, targetRects, threshold){
  const alignment = smartAlignmentSnap(movingRect, targetRects, threshold);
  const distribution = smartDistributionSnap(movingRect, targetRects, threshold);
  let distributeX = distribution.xMatch, distributeY = distribution.yMatch;
  /* A valid three-object relationship is more informative than an incidental
     one-axis match elsewhere on a busy canvas. If both distribution axes are
     simultaneously available, use the closer complete relationship. */
  if (distributeX && distributeY){
    if (distributeX.score <= distributeY.score) distributeY = null;
    else distributeX = null;
  }
  const xMatch = distributeX || distributeY ? null : alignment.xMatch;
  const yMatch = distributeX || distributeY ? null : alignment.yMatch;
  const dx = distributeX ? distributeX.delta
           : distributeY ? distributeY.crossDelta
           : xMatch ? xMatch.delta : 0;
  const dy = distributeY ? distributeY.delta
           : distributeX ? distributeX.crossDelta
           : yMatch ? yMatch.delta : 0;
  return {dx, dy, xMatch, yMatch, distributeX, distributeY,
          xSnapped:!!(xMatch || distributeX || distributeY),
          ySnapped:!!(yMatch || distributeY || distributeX)};
}
function alignmentGuideGeometry(snap, alignedRect, overshoot){
  if (!snap || (!snap.xMatch && !snap.yMatch && !snap.distributeX && !snap.distributeY)) return null;
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
  if (snap.distributeX){
    const match = snap.distributeX;
    const cross = alignmentCoordinates(alignedRect).y.find(point => point.key === match.alignmentKey);
    geometry.distributeX = {coordinate:cross.value, gap:match.gap,
      before:{from:match.beforeRect.x + match.beforeRect.w, to:alignedRect.x},
      after:{from:alignedRect.x + alignedRect.w, to:match.afterRect.x}};
  }
  if (snap.distributeY){
    const match = snap.distributeY;
    const cross = alignmentCoordinates(alignedRect).x.find(point => point.key === match.alignmentKey);
    geometry.distributeY = {coordinate:cross.value, gap:match.gap,
      before:{from:match.beforeRect.y + match.beforeRect.h, to:alignedRect.y},
      after:{from:alignedRect.y + alignedRect.h, to:match.afterRect.y}};
  }
  return geometry;
}
function drawAlignmentGuides(guides){
  draftLayer.querySelectorAll("[data-align-guide-x], [data-align-guide-y], [data-distribute-guide-x], [data-distribute-guide-y]")
    .forEach(guide => guide.remove());
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
  const tick = 5 / view.k, notch = 2 / view.k;
  if (guides.distributeX){
    const guide = guides.distributeX;
    const group = el("g", {"data-distribute-guide-x":"1", "pointer-events":"none"}, draftLayer);
    for (const segment of [guide.before, guide.after]){
      el("line", {x1:segment.from, y1:guide.coordinate, x2:segment.to, y2:guide.coordinate,
        stroke:t.accent, "stroke-width":1.5, "vector-effect":"non-scaling-stroke", opacity:.95}, group);
      for (const x of [segment.from, segment.to]) el("line", {
        x1:x, y1:guide.coordinate - tick, x2:x, y2:guide.coordinate + tick,
        stroke:t.accent, "stroke-width":1.25, "vector-effect":"non-scaling-stroke", opacity:.95
      }, group);
      const middle = (segment.from + segment.to) / 2;
      for (const x of [middle - notch, middle + notch]) el("line", {
        x1:x, y1:guide.coordinate - tick, x2:x, y2:guide.coordinate + tick,
        stroke:t.accent, "stroke-width":1.5, "vector-effect":"non-scaling-stroke", opacity:.95
      }, group);
    }
  }
  if (guides.distributeY){
    const guide = guides.distributeY;
    const group = el("g", {"data-distribute-guide-y":"1", "pointer-events":"none"}, draftLayer);
    for (const segment of [guide.before, guide.after]){
      el("line", {x1:guide.coordinate, y1:segment.from, x2:guide.coordinate, y2:segment.to,
        stroke:t.accent, "stroke-width":1.5, "vector-effect":"non-scaling-stroke", opacity:.95}, group);
      for (const y of [segment.from, segment.to]) el("line", {
        x1:guide.coordinate - tick, y1:y, x2:guide.coordinate + tick, y2:y,
        stroke:t.accent, "stroke-width":1.25, "vector-effect":"non-scaling-stroke", opacity:.95
      }, group);
      const middle = (segment.from + segment.to) / 2;
      for (const y of [middle - notch, middle + notch]) el("line", {
        x1:guide.coordinate - tick, y1:y, x2:guide.coordinate + tick, y2:y,
        stroke:t.accent, "stroke-width":1.5, "vector-effect":"non-scaling-stroke", opacity:.95
      }, group);
    }
  }
}
function updateSnapControl(){
  if (typeof updateCommandStates === "function") updateCommandStates();
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
  closeInlineStatusPicker();
  if (window.getSelection) window.getSelection().removeAllRanges();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const todoCheckEl = ev.target.closest("[data-todocheck]");
  const todoAddEl = ev.target.closest("[data-todoadd]");
  const fieldHandleEl = ev.target.closest("[data-fieldhandle]");
  const handleEl = ev.target.closest("[data-handle]");
  const collapseEl = ev.target.closest("[data-collapse]");
  const resizeEl = ev.target.closest("[data-frame-resize]");
  const edgeBendEl = ev.target.closest("[data-edgebend]");
  const edgeLabelEl = ev.target.closest("[data-edge-label-handle]");
  const statusBandHitEl = ev.target.closest("[data-status-band-hit]");
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
                                     anchor: handleEl.getAttribute("data-anchor") || undefined,
                                     portId:handleEl.getAttribute("data-node-port-id") || undefined,
                                     portSide:handleEl.getAttribute("data-node-port") || undefined } };
    board.classList.add("connecting");
    return;
  }
  if (collapseEl){
    const id = collapseEl.getAttribute("data-collapse");
    const n = nodeById(id);
    if (n && n.type === "frame"){
      setFrameCollapsed(n, n.collapsed !== true);
    } else if (n && (n.type === "table" || n.type === "todo")){
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
    if (!n || !isStructuralNode(n) || (n.type === "frame" && n.collapsed === true)) return;
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
    const cornerKey = edgeBendEl.getAttribute("data-edgecorner");
    const corner = orthoRouteCornerHandles(route).find(item => item.key === cornerKey);
    if (!corner) return;
    const start = clientToWorld(ev.clientX, ev.clientY);
    drag = { mode:"ortho-bend", edgeId:e.id, cornerKey, axes:corner.axes, start,
             offset:{x:corner.point.x-start.x, y:corner.point.y-start.y},
             original:{x:corner.point.x, y:corner.point.y}, moved:false, snap:null };
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
      const clickedNode = nodeById(id);
      setSelection("node", id);
      render();
      /* Rows edit their value, a rich-note body focuses its Markdown editor, and headers edit titles. */
      const point = clientToWorld(ev.clientX, ev.clientY);
      const hit = hitTest(point);
      if (hit && hit.node.id === id && hit.field) startInlineEditor("row", id, hit.field.id);
      else if (hit && hit.node.type === "note" &&
               point.y > hit.node.y + richNoteLayout(hit.node).titleH) focusNoteInput();
      else if (clickedNode && (statusBandHitEl || statusBandContainsPoint(clickedNode, point)))
        startInlineStatusPicker(clickedNode);
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

  if (edgeLabelEl){
    const e = edgeById(edgeLabelEl.getAttribute("data-edge-label-handle"));
    const ep = e && edgeEndpoints(e);
    if (!e || !ep) return;
    if (!isSelected("edge", e.id)){
      setSelection("edge", e.id);
      render();
    }
    drag = {mode:"edge-label", edgeId:e.id,
            start:clientToWorld(ev.clientX, ev.clientY), moved:false};
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
    if (isStructuralNode(n)){
      const contents = n.type === "frame" && n.collapsed === true
        ? collapsedFrameContentNodes(n) : containerContainedNodes(n);
      for (const child of contents) moveIds.add(child.id);
    }
    const ids = [...moveIds];
    const moving = new Set(ids);
    drag = { mode:"node", id, start:w, starts: ids.map(nodeId => {
      const dn = nodeById(nodeId);
      return { id:nodeId, x:dn.x, y:dn.y };
    }).filter(Boolean), bendStarts:state.edges
      .filter(e => (Number.isFinite(e.orthoX) || Number.isFinite(e.orthoY)) &&
        moving.has(e.from) && moving.has(e.to))
      .map(e => {
        const ep = edgeEndpoints(e);
        const bend = ep ? orthoEdgeRoute(e, ep.pa, ep.pb).bend : {x:e.orthoX, y:e.orthoY};
        return {id:e.id, x:bend.x, y:bend.y};
      }).filter(bend => Number.isFinite(bend.x) && Number.isFinite(bend.y)),
      primaryRect:nodeRect(n),
      targetRects:visibleCanvasNodes().filter(other => !moving.has(other.id)).map(other => nodeRect(other)),
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
    const alignment = useGrid ? null : smartObjectSnap(
      offsetRect(drag.primaryRect, dx, dy), drag.targetRects,
      ALIGN_GUIDE_SCREEN_THRESHOLD / view.k);
    const alignedDx = dx + (alignment ? alignment.dx : 0);
    const alignedDy = dy + (alignment ? alignment.dy : 0);
    for (const start of drag.starts){
      const n = nodeById(start.id);
      if (!n) continue;
      n.x = alignment && alignment.xSnapped ? start.x + alignedDx : dragSnap(start.x + dx, ev.shiftKey);
      n.y = alignment && alignment.ySnapped ? start.y + alignedDy : dragSnap(start.y + dy, ev.shiftKey);
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
    const target = {x:w.x + drag.offset.x, y:w.y + drag.offset.y};
    const allowedDx = drag.axes.includes("x") ? target.x - drag.original.x : 0;
    const allowedDy = drag.axes.includes("y") ? target.y - drag.original.y : 0;
    if (!drag.moved && Math.hypot(allowedDx, allowedDy) <= 1 / view.k) return;
    if (!drag.moved){ pushHistory(); drag.moved = true; }
    const snapped = snapOrthoBend(e, target, ep, 10 / view.k, ev.shiftKey);
    setOrthoCornerPosition(e, orthoEdgeRoute(e, ep.pa, ep.pb),
      {key:drag.cornerKey, axes:drag.axes}, snapped);
    if (!drag.axes.includes("x")) snapped.snapX = null;
    if (!drag.axes.includes("y")) snapped.snapY = null;
    drag.snap = snapped;
    drawOnly();
  } else if (drag.mode === "edge-label"){
    const e = edgeById(drag.edgeId);
    const ep = e && edgeEndpoints(e);
    if (!e || !ep) return;
    const w = clientToWorld(ev.clientX, ev.clientY);
    if (!drag.moved && Math.hypot(w.x - drag.start.x, w.y - drag.start.y) <= 1 / view.k) return;
    if (!drag.moved){
      pushHistory();
      drag.moved = true;
      lastPress = null;
    }
    const projected = projectEdgeLabelToPath(e, ep, w);
    setEdgeLabelPosition(e, edgeLabelDragPosition(e, projected));
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
    } else if (drag.from.portId){
      pa = nodePortAnchor(a, drag.from.portSide, drag.from.portId) ||
        nodeAnchor(a, drag.from.anchor, w);
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
      const ids = visibleCanvasNodes().filter(n => rectFullyContains(r, nodeRect(n))).map(n => n.id);
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
                           anchor: na ? na.key : undefined,
                           portId:na?.portId, portSide:na?.portSide });
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
  } else if (drag.mode === "edge-label"){
    render();
  }
  board.classList.remove("panning","connecting");
  drag = null;
});
board.addEventListener("pointercancel", ev => {
  activePointers.delete(ev.pointerId);
  clearLongPress();
  if (activePointers.size < 2) touchGesture = null;
  const redrawDraft = drag && (drag.mode === "ortho-bend" || drag.mode === "edge-label" ||
    (drag.mode === "node" && drag.guides));
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
  const key = ev.key.toLowerCase();
  const mod = ev.ctrlKey || ev.metaKey;
  // Search shortcuts remain application-level even when focus is already in
  // an editor. This prevents the browser's page-find UI from taking over.
  if (mod && ev.shiftKey && key === "g") return "searchPrevious";
  if (mod && key === "f") return "search";
  if (mod && key === "g") return "searchNext";
  if (typing) return null;
  if (mod && ev.shiftKey && key === "s") return "saveAs";
  if (mod && ev.shiftKey && key === "z") return "redo";
  if (mod && key === "o") return "open";
  if (mod && key === "s") return "save";
  if (mod && key === "z") return "undo";
  if (mod && key === "y") return "redo";
  if (mod && key === "c") return "copy";
  if (mod && key === "x") return "cut";
  if (mod && key === "v") return "paste";
  if (mod && key === "d") return "duplicate";
  if (mod && key === "k") return "commandPalette";
  if (ev.key === "?") return "shortcuts";
  if (ev.key === "Delete" || ev.key === "Backspace") return "delete";
  if (ev.key === "Tab") return "addChild";
  if (ev.key === "Escape") return "escape";
  if (!mod && key === "c") return "addConcept";
  if (!mod && key === "x") return "addText";
  if (!mod && key === "s") return "addStatus";
  if (!mod && key === "n") return "addNote";
  if (!mod && key === "t") return "addTable";
  if (!mod && key === "d") return "addTodo";
  if (!mod && key === "f") return "fit";
  if (!mod && key === "i") return "toggleInspector";
  if (ev.key.startsWith("Arrow")) return "nudge";
  return null;
}
function runShortcut(id, ev){
  if (id === "escape"){
    if (typeof searchPanelOpen === "function" && searchPanelOpen()){ closeSearchPanel(); return; }
    closeInlineEditor(false); closeCommandPalette(); closeShortcutModal(); hideCtx(); clearSelection(); render(); return;
  }
  if (id === "nudge" && ev) return nudgeSelection(ev.key, ev.shiftKey ? 24 : 4);
  if (typeof executeCommand === "function")
    return executeCommand(id, {source:"shortcut", event:ev});
}
function cycleNodeSelection(reverse = false){
  const hidden = collapsedFrameHiddenNodeIds();
  const nodes = state.nodes.filter(n => !isStructuralNode(n) && !hidden.has(n.id));
  if (!nodes.length) return;
  const current = firstSelectionId("node");
  let idx = nodes.findIndex(n => n.id === current);
  idx = idx < 0 ? (reverse ? nodes.length - 1 : 0) : (idx + (reverse ? -1 : 1) + nodes.length) % nodes.length;
  setSelection("node", nodes[idx].id);
  centerNode(nodes[idx].id);
  render();
}
function nudgeSelection(key, step){
  const selected = selectedNodes();
  const moving = new Map(selected.map(n => [n.id, n]));
  for (const n of selected){
    if (!isStructuralNode(n)) continue;
    const contents = n.type === "frame" && n.collapsed === true
      ? collapsedFrameContentNodes(n) : containerContainedNodes(n);
    for (const child of contents) moving.set(child.id, child);
  }
  const nodes = [...moving.values()];
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
  // Controls such as search handle their own keyboard interaction before the
  // event reaches the canvas shortcut layer. Respect that decision even when
  // the control moves focus synchronously (for example, Escape closes search
  // and returns focus to the board).
  if (ev.defaultPrevented) return;
  const keyTarget = ev.target && ev.target.nodeType === 1 ? ev.target : document.activeElement;
  const tag = keyTarget && keyTarget.tagName;
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
  const bounds = documentBounds();
  if (!bounds) return;
  const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.w, y1 = bounds.y + bounds.h;
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
      const p = worldToWrap(r.x + 4, r.y + 4);
      return {x:p.x, y:p.y, w:Math.max(120, r.w*view.k - 8), h:Math.max(36, r.h*view.k - 8),
              fontSize:Math.max(12, textBoxFont(n)*view.k)};
    }
    if (n.type === "status"){
      const layout = statusNodeLayout(n);
      const mainX = layout.side === "left" ? r.x + layout.bandW : r.x;
      const p = worldToWrap(mainX + 6, r.y + 5);
      return {x:p.x, y:p.y, w:Math.max(80, layout.mainW*view.k - 12),
              h:Math.max(36, r.h*view.k - 10), fontSize:Math.max(12, statusNodeFont(n)*view.k)};
    }
    if (n.type === "concept"){
      const p = worldToWrap(r.x + 12, r.y + 8);
      return { x:p.x, y:p.y, w:Math.max(120, r.w*view.k - 24),
               h:Math.max(32, r.h*view.k - 16), fontSize:Math.max(12, conceptFont(n)*view.k) };
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
  const labelPoint = edgeLabelPoint(e, ep);
  const p = worldToWrap(labelPoint.x - 70, labelPoint.y - 16);
  return { x:p.x, y:p.y, w:140, h:30, fontSize:13 };
}
function inlineEditorRow(id, rowId){
  const n = nodeById(id);
  const rows = n ? nodeRows(n) : null;
  return rows ? rows.find(row => row.id === rowId) || null : null;
}
function inlineStatusPickerBox(n){
  if (!n || n.type !== "status") return null;
  const r = nodeRect(n);
  const layout = statusNodeLayout(n);
  const bandX = layout.side === "left" ? r.x : r.x + layout.mainW;
  const band = worldToWrap(bandX, r.y);
  const width = Math.max(150, Math.min(220, layout.bandW * view.k + 64));
  return {
    x:band.x + (layout.bandW * view.k - width) / 2,
    y:band.y + Math.max(2, (r.h * view.k - 34) / 2),
    w:width,
    h:34,
    fontSize:Math.max(11, layout.statusFs * view.k)
  };
}
function closeInlineStatusPicker(){
  if (!inlineStatusPicker) return;
  const picker = inlineStatusPicker;
  inlineStatusPicker = null;
  document.removeEventListener("pointerdown", picker.outsidePointer, true);
  if (picker.select.parentNode) picker.select.parentNode.removeChild(picker.select);
}
function startInlineStatusPicker(n){
  closeInlineEditor(false);
  closeInlineStatusPicker();
  const box = inlineStatusPickerBox(n);
  if (!box) return;
  const select = statusValueSelect(n, {close:closeInlineStatusPicker});
  select.className = "inline-status-picker";
  select.setAttribute("aria-label", `Change status for ${n.title || "status node"}`);
  select.title = "Choose a status";
  select.style.left = box.x + "px";
  select.style.top = box.y + "px";
  select.style.width = box.w + "px";
  select.style.height = box.h + "px";
  select.style.fontSize = box.fontSize + "px";
  select.addEventListener("pointerdown", ev => ev.stopPropagation());
  select.addEventListener("keydown", ev => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeInlineStatusPicker();
    board.focus();
  });
  wrap.appendChild(select);
  const outsidePointer = ev => {
    if (!select.contains(ev.target)) closeInlineStatusPicker();
  };
  inlineStatusPicker = {nodeId:n.id, select, outsidePointer};
  document.addEventListener("pointerdown", outsidePointer, true);
  select.focus();
  announce(`Choose a status for ${n.title || "status node"}`);
  if (typeof select.showPicker === "function"){
    try { select.showPicker(); } catch {}
  }
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
  const multiline = kind === "node" && nodeTitleSupportsLineBreaks(target);
  const input = document.createElement(multiline ? "textarea" : "input");
  if (!multiline) input.type = "text";
  input.className = "inline-editor";
  if (multiline) input.classList.add("multiline");
  input.value = original;
  input.style.left = box.x + "px";
  input.style.top = box.y + "px";
  input.style.width = box.w + "px";
  input.style.height = box.h + "px";
  input.style.fontSize = box.fontSize + "px";
  if (multiline) input.setAttribute("aria-label", "Edit node text; Shift+Enter inserts a new line");
  input.addEventListener("pointerdown", ev => ev.stopPropagation());
  input.addEventListener("keydown", ev => {
    if (ev.key === "Enter" && ev.shiftKey && multiline){
      ev.preventDefault();
      insertTextLineBreak(input);
      return;
    }
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
  if (typeof commandPaletteItems === "function") items.push(...commandPaletteItems());
  return items;
}
function paletteMatches(query, items){
  const raw = query.trim();
  const commandOnly = raw.startsWith(">");
  const q = commandOnly ? raw.slice(1).trim() : raw;
  return items.filter(item => (!commandOnly ? item.type !== "command" : item.type === "command") &&
    fuzzyMatch(`${item.label} ${item.description || ""}`, q));
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
  if (item.type === "command" && item.enabled === false){
    announce(item.disabledReason || "This command is unavailable in the current context.");
    return;
  }
  closeCommandPalette();
  if (item.type === "node" || item.type === "field" || item.type === "item" || item.type === "note"){
    setSelection("node", item.nodeId);
    centerNode(item.nodeId);
    render();
    return;
  }
  if (item.type === "command" && typeof executeCommand === "function") executeCommand(item.command);
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
      if (item.enabled === false) b.classList.add("command-unavailable");
      b.setAttribute("aria-disabled", String(item.enabled === false));
      const meta = item.enabled === false ? item.disabledReason
        : item.shortcut || item.type;
      b.innerHTML = `<span>${escapeHtml(item.label)}</span><small>${escapeHtml(meta || item.type)}</small>`;
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
  const rows = shortcutCatalog().map(s =>
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
