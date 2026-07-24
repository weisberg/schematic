"use strict";

/* =====================================================================
   Editing fundamentals
   Capability-driven geometry, style transfer, selection queries,
   precision settings, shortcut preferences, and transient layout preview.
   ===================================================================== */

const EDITING_GRID_MIN = 8;
const EDITING_GRID_MAX = 128;
const EDITING_SELECTION_MODES = new Set(["contain","intersect","lasso"]);
const EDITING_SELECTION_MODE_KEY = "schematic.selectionGesture";
const EDITING_SHORTCUTS_KEY = "schematic.shortcutOverrides";
const EDITING_SNAP_KEY = "schematic.snapToGrid";
const EDITING_RESERVED_SHORTCUTS = new Set([
  "Mod+H","Mod+J","Mod+L","Mod+N","Mod+P","Mod+Q","Mod+R","Mod+T","Mod+U","Mod+W",
  "Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"
]);

let editingSelectionMode = loadEditingSelectionMode();
let editingShortcutOverrides = loadEditingShortcutOverrides();
let editingStyleClipboard = null;
let editingFormatPainter = null;
let editingLayoutProposal = null;
let editingDialog = null;
let editingToolbar = null;
let editingSnapHud = null;
let editingRulerX = null;
let editingRulerY = null;
let editingRulerGuideDrag = null;

function editingNumber(value, fallback, min, max){
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function editingSafeId(value, fallback){
  const id = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,100}$/.test(id) ? id : fallback;
}
function normalizeEditingSettings(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const gridSize = Math.round(editingNumber(source.gridSize, DEFAULT_GRID_SIZE,
    EDITING_GRID_MIN, EDITING_GRID_MAX));
  const guides = [];
  const seen = new Set();
  for (const [index, item] of (Array.isArray(source.guides) ? source.guides : []).entries()){
    if (!item || !["x","y"].includes(item.axis)) continue;
    const position = Number(item.position);
    if (!Number.isFinite(position)) continue;
    let id = editingSafeId(item.id, `guide-${index + 1}`);
    while (seen.has(id)) id += "-copy";
    seen.add(id);
    const guide = {id, axis:item.axis, position:Math.round(position * 1000) / 1000};
    if (typeof item.name === "string" && item.name.trim())
      guide.name = item.name.trim().slice(0, 60);
    if (item.locked === true) guide.locked = true;
    if (item.hidden === true) guide.hidden = true;
    guides.push(guide);
  }
  const out = {gridSize, guides};
  if (source.rulers === false) out.rulers = false;
  return out;
}
function cleanEditingForDocument(raw){
  const settings = normalizeEditingSettings(raw);
  const out = {};
  if (settings.gridSize !== DEFAULT_GRID_SIZE) out.gridSize = settings.gridSize;
  if (settings.guides.length) out.guides = settings.guides.map(guide => ({...guide}));
  if (settings.rulers === false) out.rulers = false;
  return Object.keys(out).length ? out : null;
}
function editingSettings(){
  return normalizeEditingSettings(state.editing);
}
function ensureEditingSettings(opts = {}){
  const settings = editingSettings();
  if (opts.write !== false) state.editing = settings;
  return settings;
}
function editingGridSize(){ return editingSettings().gridSize; }
function editingRulersVisible(){ return editingSettings().rulers !== false; }
function editingGuides(includeHidden = false){
  return editingSettings().guides.filter(guide => includeHidden || guide.hidden !== true);
}
function editingPersistSnapPreference(){
  try { localStorage.setItem(EDITING_SNAP_KEY, snapToGrid ? "1" : "0"); } catch {}
}
function editingLoadSnapPreference(){
  try { snapToGrid = localStorage.getItem(EDITING_SNAP_KEY) === "1"; } catch { snapToGrid = false; }
}
function editingUpdateGridPattern(){
  const pattern = document.getElementById("dots");
  if (pattern){
    pattern.setAttribute("width", editingGridSize());
    pattern.setAttribute("height", editingGridSize());
  }
}
function setEditingGridSize(value){
  const next = Math.round(editingNumber(value, editingGridSize(), EDITING_GRID_MIN, EDITING_GRID_MAX));
  if (next === editingGridSize()) return false;
  pushHistory();
  const settings = ensureEditingSettings();
  settings.gridSize = next;
  state.editing = settings;
  editingUpdateGridPattern();
  render();
  announce(`Grid size set to ${next} pixels.`);
  return true;
}
function setEditingRulersVisible(visible){
  if (editingRulersVisible() === !!visible) return false;
  pushHistory();
  const settings = ensureEditingSettings();
  if (visible) delete settings.rulers; else settings.rulers = false;
  state.editing = settings;
  renderEditingRulers();
  updateEditingToolbar();
  return true;
}
function editingGuideById(id){
  return editingSettings().guides.find(guide => guide.id === id) || null;
}
function editingAddGuide(axis, position, opts = {}){
  if (!["x","y"].includes(axis) || !Number.isFinite(Number(position))) return null;
  if (opts.history !== false) pushHistory();
  const settings = ensureEditingSettings();
  const guide = {id:uid(), axis, position:Math.round(Number(position) * 1000) / 1000};
  if (opts.name) guide.name = String(opts.name).trim().slice(0, 60);
  if (opts.locked === true) guide.locked = true;
  settings.guides.push(guide);
  state.editing = settings;
  render();
  announce(`Added ${axis === "x" ? "vertical" : "horizontal"} guide at ${Math.round(guide.position)} pixels.`);
  return guide;
}
function editingUpdateGuide(id, patch, opts = {}){
  const settings = ensureEditingSettings();
  const index = settings.guides.findIndex(guide => guide.id === id);
  if (index < 0) return false;
  if (opts.history !== false) pushHistory(opts.coalesceKey);
  const current = settings.guides[index];
  const next = {...current};
  if (Number.isFinite(Number(patch.position)))
    next.position = Math.round(Number(patch.position) * 1000) / 1000;
  if (typeof patch.name === "string"){
    const name = patch.name.trim().slice(0, 60);
    if (name) next.name = name; else delete next.name;
  }
  if (patch.locked != null){
    if (patch.locked) next.locked = true; else delete next.locked;
  }
  if (patch.hidden != null){
    if (patch.hidden) next.hidden = true; else delete next.hidden;
  }
  settings.guides[index] = next;
  state.editing = settings;
  if (opts.render !== false) render();
  return next;
}
function editingDeleteGuide(id, opts = {}){
  const settings = ensureEditingSettings();
  const index = settings.guides.findIndex(guide => guide.id === id);
  if (index < 0) return false;
  if (opts.history !== false) pushHistory();
  settings.guides.splice(index, 1);
  state.editing = settings;
  if (opts.render !== false) render();
  return true;
}
function editingClearGuides(){
  const settings = ensureEditingSettings();
  if (!settings.guides.length) return false;
  pushHistory();
  settings.guides = [];
  state.editing = settings;
  render();
  announce("Cleared every manual guide.");
  return true;
}
function drawManualGuides(){
  if (!guideLayer) return;
  const t = themeColors();
  for (const guide of editingGuides()){
    const group = el("g", {"data-manual-guide":guide.id, cursor:guide.locked ? "not-allowed" :
      guide.axis === "x" ? "ew-resize" : "ns-resize"}, guideLayer);
    const line = guide.axis === "x"
      ? {x1:guide.position, y1:-50000, x2:guide.position, y2:50000}
      : {x1:-50000, y1:guide.position, x2:50000, y2:guide.position};
    el("line", {...line, stroke:t.accent, "stroke-width":8, opacity:0,
      "vector-effect":"non-scaling-stroke"}, group);
    el("line", {...line, stroke:t.accent, "stroke-width":1,
      "stroke-dasharray":guide.locked ? "6 4" : "3 3", opacity:.72,
      "pointer-events":"none", "vector-effect":"non-scaling-stroke",
      "data-manual-guide-line":"1"}, group);
    el("title", {}, group).textContent =
      `${guide.name || (guide.axis === "x" ? "Vertical" : "Horizontal") + " guide"} · ${Math.round(guide.position)}px${guide.locked ? " · locked" : ""}`;
  }
}
function editingNearestGuide(value, axis, threshold, lockState = null){
  let best = null;
  for (const guide of editingGuides()){
    if (guide.axis !== axis) continue;
    if (lockState === true && guide.locked !== true) continue;
    if (lockState === false && guide.locked === true) continue;
    const distance = Math.abs(value - guide.position);
    if (distance <= threshold && (!best || distance < best.distance))
      best = {guide, distance};
  }
  return best;
}
function editingGuideSnapForRect(rect, axis, threshold, lockState = null){
  const candidates = axis === "x"
    ? [{key:"left", value:rect.x}, {key:"center", value:rect.cx}, {key:"right", value:rect.x+rect.w}]
    : [{key:"top", value:rect.y}, {key:"middle", value:rect.cy}, {key:"bottom", value:rect.y+rect.h}];
  let best = null;
  for (const point of candidates){
    const match = editingNearestGuide(point.value, axis, threshold, lockState);
    if (!match) continue;
    const candidate = {delta:match.guide.position - point.value, coordinate:match.guide.position,
      key:point.key, guide:match.guide, distance:match.distance};
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}
function editingResolveNodeSnap(desiredRect, desiredPosition, targetRects, threshold, opts = {}){
  const grid = editingGridSize();
  const result = {dx:0, dy:0, xSource:null, ySource:null, smart:null};
  if (opts.shiftKey){
    const x = Math.round(desiredPosition.x / grid) * grid;
    const y = Math.round(desiredPosition.y / grid) * grid;
    result.dx = x - desiredPosition.x;
    result.dy = y - desiredPosition.y;
    result.xSource = {type:"grid", label:`Grid ${grid}px`, coordinate:x, axis:"x", strength:"explicit"};
    result.ySource = {type:"grid", label:`Grid ${grid}px`, coordinate:y, axis:"y", strength:"explicit"};
    return result;
  }
  const lockedX = editingGuideSnapForRect(desiredRect, "x", threshold, true);
  const lockedY = editingGuideSnapForRect(desiredRect, "y", threshold, true);
  if (lockedX){
    result.dx = lockedX.delta;
    result.xSource = {type:"guide", label:lockedX.guide.name || "Locked vertical guide",
      coordinate:lockedX.coordinate, match:lockedX, axis:"x", strength:"locked"};
  }
  if (lockedY){
    result.dy = lockedY.delta;
    result.ySource = {type:"guide", label:lockedY.guide.name || "Locked horizontal guide",
      coordinate:lockedY.coordinate, match:lockedY, axis:"y", strength:"locked"};
  }
  if (!lockedX || !lockedY){
    const smart = smartObjectSnap(desiredRect, targetRects, threshold);
    result.smart = smart;
    if (!lockedX && smart.xSnapped){
      result.dx = smart.dx;
      result.xSource = {type:smart.distributeX || smart.distributeY ? "distribution" : "alignment",
        label:smart.distributeX || smart.distributeY ? "Equal spacing" : "Object alignment",
        axis:"x", strength:"smart"};
    }
    if (!lockedY && smart.ySnapped){
      result.dy = smart.dy;
      result.ySource = {type:smart.distributeX || smart.distributeY ? "distribution" : "alignment",
        label:smart.distributeX || smart.distributeY ? "Equal spacing" : "Object alignment",
        axis:"y", strength:"smart"};
    }
  }
  if (!result.xSource){
    const manualX = editingGuideSnapForRect(desiredRect, "x", threshold, false);
    if (manualX){
      result.dx = manualX.delta;
      result.xSource = {type:"guide", label:manualX.guide.name || "Vertical guide",
        coordinate:manualX.coordinate, match:manualX, axis:"x", strength:"manual"};
    }
  }
  if (!result.ySource){
    const manualY = editingGuideSnapForRect(desiredRect, "y", threshold, false);
    if (manualY){
      result.dy = manualY.delta;
      result.ySource = {type:"guide", label:manualY.guide.name || "Horizontal guide",
        coordinate:manualY.coordinate, match:manualY, axis:"y", strength:"manual"};
    }
  }
  if (!result.xSource && snapToGrid){
    const x = Math.round(desiredPosition.x / grid) * grid;
    result.dx = x - desiredPosition.x;
    result.xSource = {type:"grid", label:`Grid ${grid}px`, coordinate:x, axis:"x", strength:"persistent"};
  }
  if (!result.ySource && snapToGrid){
    const y = Math.round(desiredPosition.y / grid) * grid;
    result.dy = y - desiredPosition.y;
    result.ySource = {type:"grid", label:`Grid ${grid}px`, coordinate:y, axis:"y", strength:"persistent"};
  }
  if (!result.xSource){
    const x = Math.round(desiredPosition.x / 4) * 4;
    result.dx = x - desiredPosition.x;
  }
  if (!result.ySource){
    const y = Math.round(desiredPosition.y / 4) * 4;
    result.dy = y - desiredPosition.y;
  }
  return result;
}
function editingSnapOrthoPoint(point, threshold, gridSnap){
  if (gridSnap){
    const step = editingGridSize() / 2;
    const x = Math.round(point.x / step) * step;
    const y = Math.round(point.y / step) * step;
    return {x, y, snapX:x, snapY:y, grid:true, gridStep:step,
      xSource:{type:"grid",label:`Half-grid ${step}px`,axis:"x",strength:"explicit"},
      ySource:{type:"grid",label:`Half-grid ${step}px`,axis:"y",strength:"explicit"}};
  }
  const xGuide = editingNearestGuide(point.x, "x", threshold);
  const yGuide = editingNearestGuide(point.y, "y", threshold);
  return {
    x:xGuide ? xGuide.guide.position : point.x,
    y:yGuide ? yGuide.guide.position : point.y,
    snapX:xGuide ? xGuide.guide.position : null,
    snapY:yGuide ? yGuide.guide.position : null,
    xGuide:xGuide ? xGuide.guide : null,
    yGuide:yGuide ? yGuide.guide : null,
    xSource:xGuide ? {type:"guide",label:xGuide.guide.name ||
      `${xGuide.guide.locked ? "Locked " : ""}vertical guide`,axis:"x",
      strength:xGuide.guide.locked ? "locked" : "manual"} : null,
    ySource:yGuide ? {type:"guide",label:yGuide.guide.name ||
      `${yGuide.guide.locked ? "Locked " : ""}horizontal guide`,axis:"y",
      strength:yGuide.guide.locked ? "locked" : "manual"} : null
  };
}
function editingSnapSelectionToGrid(){
  const selected = selectedNodes();
  const nodes = selected.filter(node => editingCapabilities(node).has("positionable") &&
    (typeof organizationObjectLocked !== "function" || !organizationObjectLocked(node)));
  if (!nodes.length){
    announce("Select at least one unlocked, positionable object to snap to the grid.");
    return false;
  }
  const grid = editingGridSize();
  const moves = nodes.map(node => ({node,x:Math.round(node.x/grid)*grid,y:Math.round(node.y/grid)*grid}))
    .filter(move => move.node.x !== move.x || move.node.y !== move.y);
  if (!moves.length){
    announce(`The unlocked selection is already on the ${grid}-pixel grid.`);
    return false;
  }
  pushHistory();
  for (const move of moves){ move.node.x = move.x; move.node.y = move.y; }
  render();
  const skipped = selected.length - nodes.length;
  announce(`Snapped ${moves.length} object${moves.length === 1 ? "" : "s"} to the ${grid}-pixel grid${skipped ? `; skipped ${skipped} locked or unsupported object${skipped === 1 ? "" : "s"}` : ""}.`);
  return {changed:moves.map(move => move.node.id),skipped:selected.filter(node => !nodes.includes(node)).map(node => node.id)};
}
function editingShowSnapFeedback(result){
  if (!editingSnapHud) return;
  const labels = [...new Set([result?.xSource?.label, result?.ySource?.label].filter(Boolean))];
  editingSnapHud.textContent = labels.join(" · ");
  editingSnapHud.hidden = !labels.length;
}
function editingClearSnapFeedback(){
  if (editingSnapHud) editingSnapHud.hidden = true;
}

function editingCapabilities(object){
  if (!object) return new Set();
  if (state.edges.includes(object)) return new Set(["link","styleable","lockable"]);
  const caps = new Set(["node","styleable","lockable","positionable"]);
  if (isStructuralNode(object)){
    caps.add("container");
    caps.add("resizable-width");
    return caps;
  }
  caps.add("resizable-width");
  caps.add("rotatable");
  caps.add("flippable");
  caps.add("pinnable");
  if (nodeSupportsManualHeight(object)) caps.add("resizable-height");
  if (["concept","text","status","note"].includes(object.type)) caps.add("text-bearing");
  return caps;
}
function editingSelectionSupports(capability, minimum = 1){
  return selectedNodes().filter(node => editingCapabilities(node).has(capability)).length >= minimum;
}
function editingMutableSelection(capability){
  const selected = selectedNodes();
  const changed = selected.filter(node => editingCapabilities(node).has(capability) &&
    (typeof organizationObjectLocked !== "function" || !organizationObjectLocked(node)));
  return {selected, changed, skipped:selected.filter(node => !changed.includes(node))};
}
function editingAnnounceMutation(verb, result){
  const skipped = result.skipped.length;
  announce(`${verb} ${result.changed.length} object${result.changed.length === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} locked or unsupported object${skipped === 1 ? "" : "s"}` : ""}.`);
}
function editingRotateSelection(value, opts = {}){
  const result = editingMutableSelection("rotatable");
  if (!result.changed.length) return false;
  pushHistory();
  for (const node of result.changed)
    setNodeRotation(node, opts.exact ? value : nodeRotation(node) + value);
  render();
  editingAnnounceMutation("Rotated", result);
  return result;
}
function editingPromptRotation(){
  const primary = firstSelectedNode();
  if (!primary || isStructuralNode(primary)) return false;
  const raw = prompt("Rotation in degrees", String(Math.round(nodeRotation(primary) * 100) / 100));
  if (raw == null) return false;
  const value = Number(raw);
  if (!Number.isFinite(value)){ announce("Enter a valid rotation in degrees."); return false; }
  return editingRotateSelection(value, {exact:true});
}
function editingFlipSelection(axis){
  const result = editingMutableSelection("flippable");
  if (!result.changed.length) return false;
  pushHistory();
  for (const node of result.changed)
    setNodeFlip(node, axis, axis === "x" ? !nodeFlipX(node) : !nodeFlipY(node));
  render();
  editingAnnounceMutation(axis === "x" ? "Flipped horizontally" : "Flipped vertically", result);
  return result;
}
function editingTogglePinned(){
  const result = editingMutableSelection("pinnable");
  if (!result.changed.length) return false;
  const pin = result.changed.some(node => node.pinned !== true);
  pushHistory();
  for (const node of result.changed){
    if (pin) node.pinned = true; else delete node.pinned;
  }
  render();
  announce(`${pin ? "Pinned" : "Unpinned"} ${result.changed.length} object${result.changed.length === 1 ? "" : "s"}.`);
  return true;
}

const EDITING_EDGE_STYLE_FIELDS = [
  "lineColor","lineWidth","lineStyle","startArrow","endArrow","orthoCorner",
  "labelTextColor","labelBackgroundColor"
];
function editingNodeStyleFields(object){
  const fields = ["color"];
  if (object.type === "swimlane") fields.push("titleColor");
  else if (object.type === "frame")
    fields.push("borderEnabled","borderWidth","borderColor");
  else fields.push("fontColor","fontSize");
  if (object.type === "concept" || object.type === "text") fields.push("shape");
  if (object.type === "status") fields.push("statusSide");
  if (object.type === "text")
    fields.push("wrapText","textMarginTop","textMarginRight","textMarginBottom","textMarginLeft");
  return fields;
}
function editingEffectiveStyleValue(object, kind, field){
  if (kind === "edge"){
    if (field === "lineColor") return edgeLineColor(object);
    if (field === "lineWidth") return edgeLineWidth(object);
    if (field === "lineStyle") return edgeLineStyle(object);
    if (field === "startArrow" || field === "endArrow") return object[field] === true;
    if (field === "orthoCorner") return orthoCornerStyle(object);
    if (field === "labelTextColor") return edgeLabelTextColor(object);
    if (field === "labelBackgroundColor") return edgeLabelBackgroundColor(object);
    return object[field];
  }
  if (field === "color"){
    if (object.type === "frame") return object.color || frameColorDefault();
    if (object.type === "swimlane") return object.color || SWIMLANE_DEFAULT.bodyColor;
    if (object.type === "todo") return object.color || todoColorDefault();
    if (object.type === "table") return object.color || themeColors().ink;
    return object.color || conceptColors()[object.type === "text" || object.type === "status" ? 1 : 0];
  }
  if (field === "titleColor") return object.titleColor || SWIMLANE_DEFAULT.titleColor;
  if (field === "fontSize") return nodeTextSize(object);
  if (field === "fontColor") return object.fontColor || null;
  if (field === "shape") return object.type === "concept" ? conceptShape(object) : textBoxShape(object);
  if (field === "borderEnabled") return frameBorderEnabled(object);
  if (field === "borderWidth") return frameBorderWidth(object);
  if (field === "borderColor") return frameBorderColor(object);
  if (field === "statusSide") return object.statusSide === "left" ? "left" : "right";
  if (field === "wrapText") return textBoxWrapEnabled(object);
  if (field.startsWith("textMargin")){
    const side = field.slice("textMargin".length).toLowerCase();
    return textBoxMargin(object, side);
  }
  return object[field];
}
function editingStylePayload(object){
  if (!object) return null;
  const kind = state.edges.includes(object) ? "edge" : "node";
  const fields = kind === "edge" ? EDITING_EDGE_STYLE_FIELDS : editingNodeStyleFields(object);
  const values = {}, entries = [];
  for (const field of fields){
    const value = editingEffectiveStyleValue(object, kind, field);
    const origin = Object.hasOwn(object, field) ? "direct" : "default";
    if (value !== undefined) values[field] = value == null ? null : JSON.parse(JSON.stringify(value));
    entries.push({field, value:value == null ? null : JSON.parse(JSON.stringify(value)),
      origin, operation:origin === "direct" ? "set" : "clear"});
  }
  for (const field of ["styleClassId","modifierClassIds","styleTokenRefs"]){
    const direct=Object.hasOwn(object,field);
    const value=direct ? JSON.parse(JSON.stringify(object[field])) : null;
    entries.push({field,value,origin:direct ? "reference" : "default",
      operation:direct ? "set" : "clear"});
    if (direct) values[field]=value;
  }
  return {version:1, kind, sourceType:kind === "node" ? object.type : "edge",
    values, entries,
    provenance:{direct:entries.filter(entry => entry.origin === "direct").length,
      references:entries.filter(entry => entry.origin === "reference").length,
      inherited:entries.filter(entry => !["direct","reference"].includes(entry.origin)).length},
    excluded:["content","identity","metadata","relationships","geometry","containment","icon identity"]};
}
function editingCopyStyle(){
  const source = singleSelectedNode() || singleSelectedEdge();
  if (!source){ announce("Select one node or link to copy its style."); return false; }
  editingStyleClipboard = editingStylePayload(source);
  editingFormatPainter = null;
  updateEditingToolbar();
  announce(`Copied ${editingStyleClipboard.kind} appearance only: ${editingStyleClipboard.provenance.direct} direct value${editingStyleClipboard.provenance.direct === 1 ? "" : "s"} and ${editingStyleClipboard.provenance.inherited} inherited or default value${editingStyleClipboard.provenance.inherited === 1 ? "" : "s"}. Content, geometry, identity, metadata, and relationships are excluded.`);
  return editingStyleClipboard;
}
function editingStyleFieldCompatible(payload, target, field){
  if (payload.kind !== (state.edges.includes(target) ? "edge" : "node")) return false;
  if (payload.kind === "edge") return true;
  if (["styleClassId","modifierClassIds","styleTokenRefs"].includes(field)) return true;
  if (field === "shape" && target.type !== payload.sourceType) return false;
  if (field === "statusSide" && target.type !== "status") return false;
  if (field.startsWith("textMargin") || field === "wrapText") return target.type === "text";
  if (field.startsWith("border")) return target.type === "frame";
  if (field === "titleColor") return target.type === "swimlane";
  if ((field === "fontColor" || field === "fontSize") && isStructuralNode(target)) return false;
  return true;
}
function editingApplicableStyleValues(payload, target){
  if (!payload || !target) return [];
  const kind = state.edges.includes(target) ? "edge" : "node";
  if (payload.kind !== kind) return [];
  const sourceEntries = Array.isArray(payload.entries)
    ? payload.entries : Object.entries(payload.values || {}).map(([field,value]) =>
      ({field,value,origin:"direct",operation:"set"}));
  const compatible = sourceEntries.filter(entry => editingStyleFieldCompatible(payload,target,entry.field))
    .filter(entry => entry.field !== "styleClassId" || !entry.value ||
      typeof styleClassById !== "function" || styleClassCompatible(styleClassById(entry.value),target))
    .filter(entry => entry.field !== "modifierClassIds" || !Array.isArray(entry.value) ||
      typeof styleClassById !== "function" || entry.value.some(id =>
        styleClassCompatible(styleClassById(id),target)))
    .map(entry => ({...entry, value:entry.value == null ? entry.value :
      JSON.parse(JSON.stringify(entry.value))}));
  if (kind !== "node" || nodeSupportsManualHeight(target)) return compatible;
  const candidate = JSON.parse(JSON.stringify(target));
  const baselineHeight = nodeSize(target).h;
  return compatible.filter(entry => {
    const hadPrevious = Object.hasOwn(candidate,entry.field);
    const previous = hadPrevious && candidate[entry.field] != null
      ? JSON.parse(JSON.stringify(candidate[entry.field])) : candidate[entry.field];
    if (entry.operation === "clear") delete candidate[entry.field];
    else candidate[entry.field] = entry.value == null ? entry.value :
      JSON.parse(JSON.stringify(entry.value));
    if (Math.abs(nodeSize(candidate).h - baselineHeight) <= .001) return true;
    if (hadPrevious) candidate[entry.field] = previous;
    else delete candidate[entry.field];
    return false;
  });
}
function editingStylePlan(payload, targets){
  const plan = [], skipped = [];
  for (const target of targets){
    if (typeof organizationObjectLocked === "function" && organizationObjectLocked(target)){
      skipped.push({id:target.id, reason:"locked"});
      continue;
    }
    const entries = editingApplicableStyleValues(payload,target);
    if (entries.length) plan.push({target,entries});
    else skipped.push({id:target.id, reason:"incompatible"});
  }
  return {plan,skipped};
}
function editingApplyStylePayload(payload, targets, opts = {}){
  const {plan,skipped} = editingStylePlan(payload,targets);
  if (!plan.length){ announce("The copied style is not compatible with the unlocked objects in this selection."); return false; }
  if (opts.history !== false) pushHistory();
  const sizes = new Map(plan
    .filter(item => payload.kind === "node")
    .map(item => [item.target.id,nodeSize(item.target)]));
  for (const item of plan){
    for (const entry of item.entries){
      const manualProperty = typeof formattingManualPropertyForField === "function"
        ? formattingManualPropertyForField(entry.field) : "";
      if (entry.operation === "clear"){
        delete item.target[entry.field];
        if (manualProperty && typeof formattingClearManualOverride === "function")
          formattingClearManualOverride(item.target,manualProperty);
      } else {
        item.target[entry.field] = entry.value == null ? entry.value :
          JSON.parse(JSON.stringify(entry.value));
        if (manualProperty && typeof formattingMarkManualOverride === "function")
          formattingMarkManualOverride(item.target,manualProperty,true);
      }
    }
    const before = sizes.get(item.target.id);
    if (!before) continue;
    const after = nodeSize(item.target);
    if (Math.abs(after.w - before.w) > .001) setNodeWidth(item.target,before.w);
    if (nodeSupportsManualHeight(item.target) && Math.abs(after.h - before.h) > .001)
      setNodeHeight(item.target,before.h);
  }
  render();
  announce(`Applied compatible appearance to ${plan.length} object${plan.length === 1 ? "" : "s"}${skipped.length ? `; skipped ${skipped.length} locked or incompatible object${skipped.length === 1 ? "" : "s"}` : ""}. Inherited/default values remained inherited; content, metadata, identity, relationships, and geometry were preserved.`);
  return {changed:plan.map(item => item.target.id),skipped};
}
function editingPasteStyle(){
  if (!editingStyleClipboard){ announce("Copy a style first."); return false; }
  const targets = editingStyleClipboard.kind === "node" ? selectedNodes()
    : selectionIds("edge").map(edgeById).filter(Boolean);
  return editingApplyStylePayload(editingStyleClipboard, targets);
}
function editingActivateFormatPainter(persistent = false){
  const source = singleSelectedNode() || singleSelectedEdge();
  if (source) editingStyleClipboard = editingStylePayload(source);
  if (!editingStyleClipboard){ announce("Select a source object before activating the format painter."); return false; }
  editingFormatPainter = {persistent:!!persistent, kind:editingStyleClipboard.kind};
  updateEditingToolbar();
  announce(`${persistent ? "Persistent" : "One-shot"} format painter active. Press Escape to cancel.`);
  return true;
}
function editingCancelFormatPainter(){
  if (!editingFormatPainter) return false;
  editingFormatPainter = null;
  updateEditingToolbar();
  announce("Format painter canceled.");
  return true;
}
function editingHandleFormatPainter(target){
  if (!editingFormatPainter || !target) return false;
  const kind = state.edges.includes(target) ? "edge" : "node";
  if (kind !== editingFormatPainter.kind){
    announce(`Choose a ${editingFormatPainter.kind} target or press Escape to cancel.`);
    return true;
  }
  editingApplyStylePayload(editingStyleClipboard, [target]);
  if (!editingFormatPainter.persistent) editingCancelFormatPainter();
  return true;
}

function loadEditingSelectionMode(){
  try {
    const value = localStorage.getItem(EDITING_SELECTION_MODE_KEY);
    return EDITING_SELECTION_MODES.has(value) ? value : "contain";
  } catch { return "contain"; }
}
function setEditingSelectionMode(mode){
  if (!EDITING_SELECTION_MODES.has(mode)) return false;
  editingSelectionMode = mode;
  try { localStorage.setItem(EDITING_SELECTION_MODE_KEY, mode); } catch {}
  updateEditingToolbar();
  announce(`Selection gesture set to ${mode === "contain" ? "full containment" : mode === "intersect" ? "intersection" : "freeform lasso"}.`);
  return true;
}
function editingSelectionOperation(ev){
  if (ev && ev.shiftKey && ev.altKey) return "subtract";
  if (ev && (ev.metaKey || ev.ctrlKey)) return "toggle";
  if (ev && ev.shiftKey) return "add";
  return "replace";
}
function editingApplyNodeSelection(ids, operation = "replace"){
  const incoming = new Set(ids);
  const current = new Set(selectionIds("node"));
  let next;
  if (operation === "add") next = new Set([...current, ...incoming]);
  else if (operation === "subtract") next = new Set([...current].filter(id => !incoming.has(id)));
  else if (operation === "toggle"){
    next = new Set(current);
    for (const id of incoming) next.has(id) ? next.delete(id) : next.add(id);
  } else next = incoming;
  if (next.size) setSelection("node", [...next]); else clearSelection();
  return [...next];
}
function editingPointInPolygon(point, polygon){
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++){
    const a = polygon[i], b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < (b.x-a.x) * (point.y-a.y) / ((b.y-a.y) || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
function editingSpatialSelectionIds(mode, rect, polygon = []){
  return visibleCanvasNodes().filter(node => {
    const bounds = nodeVisualRect(node);
    if (mode === "intersect") return rectsOverlap(rect, bounds) || rectFullyContains(rect, bounds);
    if (mode === "lasso")
      return polygon.length >= 3 && editingPointInPolygon({x:bounds.cx, y:bounds.cy}, polygon);
    return rectFullyContains(rect, bounds);
  }).map(node => node.id);
}
function editingNodePropertyValue(node, propertyId){
  if (!propertyId) return undefined;
  if (propertyId === "type") return node.type;
  if (propertyId === "status") return node.status || "";
  if (propertyId === "color") return node.color || "";
  if (propertyId === "layer") return typeof organizationObjectLayerId === "function"
    ? organizationObjectLayerId(node) : "";
  if (propertyId === "group") return node.groupId || "";
  if (propertyId === "frame"){
    const frames = state.nodes.filter(candidate => candidate.type === "frame" &&
      directContainedNodes(candidate,true).some(child => child.id === node.id))
      .sort((a,b) => {
        const ar = expandedFrameRect(a), br = expandedFrameRect(b);
        return ar.w*ar.h - br.w*br.h || String(a.id).localeCompare(String(b.id));
      });
    return frames[0] ? frames[0].title || frames[0].id : "";
  }
  if (propertyId === "semanticType") return node.semanticTypeId || "";
  if (typeof metadataValue === "function") return metadataValue(node, propertyId);
  return node.properties ? node.properties[propertyId] : undefined;
}
function editingSelectionScope(scope){
  if (scope === "all") return state.nodes.slice();
  if (scope === "container"){
    const container = selectedNodes().find(isStructuralNode);
    if (!container) return [];
    const visible = new Set(visibleCanvasNodes().map(node => node.id));
    return containerContainedNodes(container).filter(node => visible.has(node.id));
  }
  return visibleCanvasNodes();
}
function editingConnectivityQuery(seedIds, query = {}){
  const direction = ["predecessors","successors","both"].includes(query.direction)
    ? query.direction : "both";
  const depth = Math.round(editingNumber(query.depth, 1, 1, 100));
  const kinds = new Set(Array.isArray(query.relationshipTypes)
    ? query.relationshipTypes.map(String)
    : String(query.relationshipTypes || "").split(",").map(value => value.trim()).filter(Boolean));
  const allowed = new Set((query.allowedNodes || state.nodes).map(node => node.id));
  const result = new Set(), frontier = new Set(seedIds);
  const visited = new Set(seedIds);
  for (let level = 0; level < depth && frontier.size; level++){
    const next = new Set();
    for (const edge of state.edges){
      if (kinds.size && !kinds.has(edge.kind) && !kinds.has(edge.label)) continue;
      if ((direction === "both" || direction === "successors") && frontier.has(edge.from) &&
          allowed.has(edge.to) && !visited.has(edge.to)) next.add(edge.to);
      if ((direction === "both" || direction === "predecessors") && frontier.has(edge.to) &&
          allowed.has(edge.from) && !visited.has(edge.from)) next.add(edge.from);
    }
    for (const id of next){ visited.add(id); result.add(id); }
    frontier.clear();
    for (const id of next) frontier.add(id);
  }
  return result;
}
function editingSelectByQuery(query = {}){
  let nodes = editingSelectionScope(query.scope || "visible");
  if (query.connectivity && query.connectivity !== "none"){
    const connected = editingConnectivityQuery(selectionIds("node"), {
      direction:query.connectivity, depth:query.depth,
      relationshipTypes:query.relationshipTypes, allowedNodes:nodes
    });
    nodes = nodes.filter(node => connected.has(node.id));
  }
  const value = String(query.value ?? "").trim().toLowerCase();
  const matches = nodes.filter(node => {
    if (query.objectType && query.objectType !== "*" && node.type !== query.objectType) return false;
    if (query.propertyId){
      const raw = editingNodePropertyValue(node, query.propertyId);
      const display = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
      if (value && !display.toLowerCase().includes(value)) return false;
      if (!value && (raw == null || raw === "" || (Array.isArray(raw) && !raw.length))) return false;
    }
    return true;
  }).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  const ids = editingApplyNodeSelection(matches.map(node => node.id), query.operation || "replace");
  if (query.render !== false) render();
  if (query.announce !== false)
    announce(`Selected ${ids.length} node${ids.length === 1 ? "" : "s"} in the ${query.scope || "visible"} scope.`);
  return ids;
}
function editingConnectivityNodes(direction = "both"){
  const ids = editingConnectivityQuery(selectionIds("node"), {
    direction, depth:1, allowedNodes:visibleCanvasNodes()
  });
  editingApplyNodeSelection(ids, "add");
  render();
  announce(`Added ${ids.size} ${direction === "both" ? "connected" : direction} node${ids.size === 1 ? "" : "s"} to the selection.`);
  return [...ids];
}
function editingSelectAttachedLinks(){
  const selected = new Set(selectionIds("node"));
  const ids = state.edges.filter(edge => selected.has(edge.from) || selected.has(edge.to)).map(edge => edge.id);
  if (ids.length) setSelection("edge", ids); else clearSelection();
  render();
  announce(`Selected ${ids.length} attached link${ids.length === 1 ? "" : "s"}.`);
  return ids;
}
function editingInvertSelection(){
  const visible = visibleCanvasNodes().map(node => node.id);
  const current = new Set(selectionIds("node"));
  const ids = visible.filter(id => !current.has(id));
  if (ids.length) setSelection("node", ids); else clearSelection();
  render();
  announce(`Inverted selection to ${ids.length} visible node${ids.length === 1 ? "" : "s"}.`);
  return ids;
}

function editingCloseDialog(){
  if (editingDialog && editingDialog.classList.contains("layout-preview-modal") && editingLayoutProposal)
    editingCancelLayoutPreview();
  if (editingDialog && editingDialog.parentNode) editingDialog.remove();
  editingDialog = null;
}
function editingModalShell(title, className = ""){
  editingCloseDialog();
  const modal = document.createElement("div");
  modal.className = `modal open editing-modal ${className}`.trim();
  modal.setAttribute("role","dialog");
  modal.setAttribute("aria-modal","true");
  modal.innerHTML = `<div class="card"><div class="editing-modal-head"><h3></h3><button type="button" data-close aria-label="Close">×</button></div><div class="editing-modal-body"></div></div>`;
  modal.querySelector("h3").textContent = title;
  modal.querySelector("[data-close]").addEventListener("click", editingCloseDialog);
  modal.addEventListener("click", event => { if (event.target === modal) editingCloseDialog(); });
  modal.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    editingCloseDialog();
  });
  document.body.appendChild(modal);
  editingDialog = modal;
  return {modal, body:modal.querySelector(".editing-modal-body")};
}
function editingField(label, control){
  const row = document.createElement("label");
  row.className = "editing-field";
  const text = document.createElement("span");
  text.textContent = label;
  row.append(text, control);
  return row;
}
function editingSelect(options, value){
  const select = document.createElement("select");
  for (const [optionValue, label] of options){
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    option.selected = optionValue === value;
    select.appendChild(option);
  }
  return select;
}
function openEditingSelectionStudio(){
  const {body} = editingModalShell("Select by model");
  const grid = document.createElement("div");
  grid.className = "editing-form-grid";
  const scope = editingSelect([["visible","Visible objects"],["container","Selected container"],["all","Entire document"]],"visible");
  const objectType = editingSelect([["*","Any object type"], ...[...new Set(state.nodes.map(node => node.type))]
    .sort().map(type => [type, type])],"*");
  const definitions = typeof metadataPropertyDefinitions === "function" ? metadataPropertyDefinitions() : [];
  const property = editingSelect([
    ["","No property filter"],["status","Status"],["color","Color"],["layer","Layer"],
    ["frame","Frame"],["group","Group"],["semanticType","Semantic type"],
    ...definitions.map(definition => [definition.id, definition.name || definition.id])
  ],"");
  const value = document.createElement("input");
  value.placeholder = "Contains value; blank means missing";
  const operation = editingSelect([["replace","Replace selection"],["add","Add to selection"],
    ["subtract","Subtract from selection"],["toggle","Toggle matches"]],"replace");
  const connectivity = editingSelect([["none","No connectivity filter"],["both","Connected in either direction"],
    ["predecessors","Upstream predecessors"],["successors","Downstream successors"]],"none");
  const depth = document.createElement("input");
  depth.type = "number";
  depth.min = "1";
  depth.max = "100";
  depth.value = "1";
  const relationship = editingSelect([["","Every relationship type"],
    ...[...new Set(state.edges.map(edge => edge.kind).filter(Boolean))].sort()
      .map(kind => [kind,kind])],"");
  grid.append(editingField("Scope", scope), editingField("Object type", objectType),
    editingField("Property", property), editingField("Value", value),
    editingField("Connectivity", connectivity), editingField("Depth", depth),
    editingField("Relationship", relationship), editingField("Result", operation));
  const help = document.createElement("p");
  help.className = "helper";
  help.textContent = "Selection uses the same model values as search and the object table; it does not scan rendered SVG.";
  const actions = document.createElement("div");
  actions.className = "actions";
  const apply = document.createElement("button");
  apply.className = "primary";
  apply.textContent = "Select matches";
  apply.addEventListener("click", () => {
    editingSelectByQuery({scope:scope.value, objectType:objectType.value,
      propertyId:property.value, value:value.value, operation:operation.value,
      connectivity:connectivity.value, depth:Number(depth.value),
      relationshipTypes:relationship.value ? [relationship.value] : []});
    editingCloseDialog();
  });
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", editingCloseDialog);
  actions.append(cancel, apply);
  body.append(grid, help, actions);
  scope.focus();
}

function loadEditingShortcutOverrides(){
  try {
    const raw = JSON.parse(localStorage.getItem(EDITING_SHORTCUTS_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, shortcut] of Object.entries(raw))
      if (/^[a-z][A-Za-z0-9._-]*$/.test(id) && typeof shortcut === "string")
        out[id] = shortcut.slice(0, 80);
    return out;
  } catch { return {}; }
}
function persistEditingShortcutOverrides(){
  try { localStorage.setItem(EDITING_SHORTCUTS_KEY, JSON.stringify(editingShortcutOverrides)); } catch {}
}
function editingShortcutForCommand(command){
  if (!command) return "";
  return Object.hasOwn(editingShortcutOverrides, command.id)
    ? editingShortcutOverrides[command.id] : command.shortcut || "";
}
function editingDisplayShortcut(shortcut){
  const isMac = typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const canonical = editingCanonicalShortcut(shortcut);
  if (!canonical) return "Unassigned";
  if (!isMac) return canonical.replace(/\bMod\b/g,"Ctrl");
  return canonical.split("+").map(part => ({
    Mod:"⌘",Ctrl:"⌃",Alt:"⌥",Shift:"⇧",Space:"Space"
  })[part] || part).join("");
}
function editingNormalizeChord(parts){
  const modifiers = [];
  if (parts.mod) modifiers.push("Mod");
  if (parts.ctrl) modifiers.push("Ctrl");
  if (parts.alt) modifiers.push("Alt");
  if (parts.shift) modifiers.push("Shift");
  return [...modifiers, parts.key].filter(Boolean).join("+");
}
function editingChordFromEvent(event){
  let key = event.key;
  if (["Control","Meta","Alt","Shift"].includes(key)) return "";
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  const mod = event.metaKey || event.ctrlKey;
  return editingNormalizeChord({mod, alt:event.altKey, shift:event.shiftKey &&
    key !== "?", key});
}
function editingCanonicalShortcut(shortcut){
  const pieces = String(shortcut || "").replace("Ctrl/Cmd","Mod").split("+").filter(Boolean);
  const key = pieces.pop() || "";
  return editingNormalizeChord({
    mod:pieces.includes("Mod"), ctrl:pieces.includes("Ctrl"),
    alt:pieces.includes("Alt"), shift:pieces.includes("Shift"), key:key.length === 1 ? key.toUpperCase() : key
  });
}
function editingShortcutMatches(event, shortcut){
  return editingChordFromEvent(event) === editingCanonicalShortcut(shortcut);
}
function editingShortcutConflict(commandId, chord){
  const canonical = editingCanonicalShortcut(chord);
  if (!canonical) return null;
  return COMMAND_DEFINITIONS.find(command => {
    if (command.id === commandId) return false;
    if (editingCanonicalShortcut(editingShortcutForCommand(command)) === canonical) return true;
    if (Object.hasOwn(editingShortcutOverrides, command.id)) return false;
    return (command.shortcutAliases || []).some(alias =>
      editingCanonicalShortcut(alias) === canonical);
  }) || null;
}
function editingSetShortcut(commandId, shortcut){
  const command = commandDefinition(commandId);
  if (!command) return {ok:false, reason:"Unknown command."};
  const chord = editingCanonicalShortcut(shortcut);
  if (chord && EDITING_RESERVED_SHORTCUTS.has(chord))
    return {ok:false, reason:`${chord} is reserved by the browser or operating system.`};
  const conflict = editingShortcutConflict(commandId, chord);
  if (conflict) return {ok:false, reason:`Already assigned to ${commandLabel(conflict)}.`};
  editingShortcutOverrides[commandId] = chord;
  persistEditingShortcutOverrides();
  updateCommandStates();
  return {ok:true, chord};
}
function editingResetShortcut(commandId){
  delete editingShortcutOverrides[commandId];
  persistEditingShortcutOverrides();
  updateCommandStates();
}
function editingResetAllShortcuts(){
  editingShortcutOverrides = {};
  persistEditingShortcutOverrides();
  updateCommandStates();
}
function editingImportShortcutOverrides(raw){
  const incoming = raw && raw.shortcuts && typeof raw.shortcuts === "object"
    ? raw.shortcuts : raw;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    return {ok:false, reason:"Missing shortcuts object.", applied:0, skipped:0};
  const before = editingShortcutOverrides;
  const next = {};
  let applied = 0, skipped = 0;
  editingShortcutOverrides = next;
  for (const [id, shortcut] of Object.entries(incoming)){
    if (!commandDefinition(id) || typeof shortcut !== "string"){ skipped++; continue; }
    const chord = editingCanonicalShortcut(shortcut);
    if (chord && EDITING_RESERVED_SHORTCUTS.has(chord)){ skipped++; continue; }
    if (editingShortcutConflict(id,chord)){ skipped++; continue; }
    next[id] = chord;
    applied++;
  }
  if (!applied && Object.keys(incoming).length){
    editingShortcutOverrides = before;
    return {ok:false, reason:"No compatible, conflict-free shortcuts were found.", applied:0, skipped};
  }
  editingShortcutOverrides = next;
  persistEditingShortcutOverrides();
  updateCommandStates();
  return {ok:true, applied, skipped};
}
function editingMatchShortcut(event, typing){
  for (const command of COMMAND_DEFINITIONS){
    const shortcut = editingShortcutForCommand(command);
    if (typing && !["search","searchNext","searchPrevious"].includes(command.id)) continue;
    if (shortcut && editingShortcutMatches(event, shortcut)) return command.id;
    if (!Object.hasOwn(editingShortcutOverrides, command.id))
      for (const alias of command.shortcutAliases || [])
        if (editingShortcutMatches(event, alias)) return command.id;
  }
  return null;
}
function openShortcutPreferences(){
  const {body} = editingModalShell("Shortcut preferences", "shortcut-modal shortcut-preferences");
  const toolbar = document.createElement("div");
  toolbar.className = "editing-shortcut-toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search commands";
  const reset = document.createElement("button");
  reset.textContent = "Restore defaults";
  const exportButton = document.createElement("button");
  exportButton.textContent = "Export";
  const importButton = document.createElement("button");
  importButton.textContent = "Import";
  toolbar.append(search, reset, exportButton, importButton);
  const message = document.createElement("div");
  message.className = "helper editing-shortcut-message";
  const list = document.createElement("div");
  list.className = "editing-shortcut-list";
  const reference = document.createElement("div");
  reference.className = "editing-shortcut-reference";
  const referenceTitle = document.createElement("h4");
  referenceTitle.textContent = "Built-in interaction shortcuts";
  reference.appendChild(referenceTitle);
  for (const item of shortcutCatalog().filter(item => !commandDefinition(item.id) ||
    item.keys !== editingShortcutForCommand(commandDefinition(item.id)))){
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const keys = document.createElement("kbd");
    keys.textContent = editingDisplayShortcut(item.keys);
    keys.title = item.keys;
    const title = document.createElement("span");
    title.textContent = item.title;
    row.append(keys,title);
    reference.appendChild(row);
  }
  const draw = () => {
    const query = search.value.trim().toLowerCase();
    list.innerHTML = "";
    for (const command of COMMAND_DEFINITIONS.filter(command =>
      !query || `${commandLabel(command)} ${command.description}`.toLowerCase().includes(query))){
      const row = document.createElement("div");
      row.className = "editing-shortcut-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = commandLabel(command);
      const description = document.createElement("small");
      description.textContent = command.description;
      copy.append(title, description);
      const capture = document.createElement("button");
      capture.className = "shortcut-capture";
      const effective = editingShortcutForCommand(command);
      capture.textContent = editingDisplayShortcut(effective);
      capture.title = effective || "Unassigned";
      capture.setAttribute("aria-label", `Change shortcut for ${commandLabel(command)}`);
      capture.addEventListener("click", () => {
        capture.textContent = "Press keys…";
        capture.classList.add("recording");
        capture.focus();
      });
      capture.addEventListener("keydown", event => {
        if (!capture.classList.contains("recording")) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape"){
          capture.classList.remove("recording");
          draw();
          return;
        }
        const chord = editingChordFromEvent(event);
        if (!chord) return;
        const result = editingSetShortcut(command.id, chord);
        message.textContent = result.ok ? `Assigned ${result.chord} to ${commandLabel(command)}.`
          : result.reason;
        capture.classList.remove("recording");
        draw();
      });
      const clear = document.createElement("button");
      clear.className = "mini";
      clear.textContent = "Clear";
      clear.addEventListener("click", () => {
        const result = editingSetShortcut(command.id, "");
        message.textContent = result.ok ? `Removed shortcut from ${commandLabel(command)}.` : result.reason;
        draw();
      });
      const perReset = document.createElement("button");
      perReset.className = "mini";
      perReset.textContent = "Reset";
      perReset.addEventListener("click", () => { editingResetShortcut(command.id); draw(); });
      row.append(copy, capture, clear, perReset);
      list.appendChild(row);
    }
  };
  search.addEventListener("input", draw);
  reset.addEventListener("click", () => {
    editingResetAllShortcuts();
    message.textContent = "Restored every default shortcut.";
    draw();
  });
  exportButton.addEventListener("click", () => {
    download("schematic-shortcuts.json", JSON.stringify({version:1, shortcuts:editingShortcutOverrides}, null, 2),
      "application/json");
  });
  importButton.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      try {
        const parsed = JSON.parse(await input.files[0].text());
        const result = editingImportShortcutOverrides(parsed);
        if (!result.ok) throw new Error(result.reason);
        message.textContent = `Imported ${result.applied} shortcut${result.applied === 1 ? "" : "s"}${result.skipped ? `; skipped ${result.skipped} invalid, reserved, or conflicting assignment${result.skipped === 1 ? "" : "s"}` : ""}.`;
        draw();
      } catch (error){ message.textContent = `Import failed: ${error.message}`; }
    });
    input.click();
  });
  body.append(toolbar, message, list, reference);
  draw();
  search.focus();
}

function editingLayoutScopeNodes(){
  const selected = selectedNodes();
  const container = selected.length === 1 && isStructuralNode(selected[0]) ? selected[0] : null;
  const candidates = container ? containerContainedNodes(container)
    : selected.length >= 2 ? selected : visibleCanvasNodes().filter(node => !isStructuralNode(node));
  return candidates.filter(node => !isStructuralNode(node));
}
function editingContainingContainer(node){
  const center = nodeCenterForContainment(node);
  return state.nodes.filter(container => isStructuralNode(container) && container.id !== node.id)
    .filter(container => {
      const rect = containmentRect(container);
      return center.x >= rect.x && center.x <= rect.x+rect.w &&
        center.y >= rect.y && center.y <= rect.y+rect.h;
    })
    .sort((a,b) => {
      const ar = containmentRect(a), br = containmentRect(b);
      return ar.w*ar.h - br.w*br.h || String(a.id).localeCompare(String(b.id));
    })[0] || null;
}
function editingConstrainLayoutPosition(node, position, opts, constraints){
  let next = {...position};
  if (opts.preserveContainers !== false){
    const container = editingContainingContainer(node);
    if (container){
      const outer = containmentRect(container), rect = nodeRect(node);
      const padding = 8;
      const minX = outer.x+padding, maxX = outer.x+outer.w-rect.w-padding;
      const minY = outer.y+padding, maxY = outer.y+outer.h-rect.h-padding;
      const clamped = {
        x:maxX >= minX ? Math.min(maxX,Math.max(minX,next.x)) : node.x,
        y:maxY >= minY ? Math.min(maxY,Math.max(minY,next.y)) : node.y
      };
      if (clamped.x !== next.x || clamped.y !== next.y)
        constraints.push({id:node.id,type:"container",containerId:container.id});
      next = clamped;
    }
  }
  const limit = editingNumber(opts.maxMovement, 0, 0, 100000);
  const dx = next.x-node.x, dy = next.y-node.y;
  const distance = Math.hypot(dx,dy);
  if (limit > 0 && distance > limit){
    const scale = limit/distance;
    next = {x:node.x+dx*scale,y:node.y+dy*scale};
    constraints.push({id:node.id,type:"maximum-movement",limit});
  }
  return {x:Math.round(next.x*1000)/1000,y:Math.round(next.y*1000)/1000};
}
function editingBuildLayoutProposal(kind = "grid", gap = 32, opts = {}){
  const nodes = editingLayoutScopeNodes();
  if (nodes.length < 2) return null;
  const movable = nodes.filter(node => node.pinned !== true &&
    (typeof organizationObjectLocked !== "function" || !organizationObjectLocked(node)));
  if (!movable.length) return null;
  const ordered = movable.slice().sort((a,b) => a.y-b.y || a.x-b.x || String(a.id).localeCompare(String(b.id)));
  const bounds = documentBounds(nodes) || nodeRect(ordered[0]);
  const positions = new Map();
  const gapValue = editingNumber(gap, 32, 0, 400);
  if (kind === "horizontal"){
    let cursor = bounds.x;
    for (const node of ordered){
      const rect = nodeRect(node);
      positions.set(node.id, {x:cursor, y:bounds.cy-rect.h/2});
      cursor += rect.w + gapValue;
    }
  } else if (kind === "vertical"){
    let cursor = bounds.y;
    for (const node of ordered){
      const rect = nodeRect(node);
      positions.set(node.id, {x:bounds.cx-rect.w/2, y:cursor});
      cursor += rect.h + gapValue;
    }
  } else {
    const columns = Math.ceil(Math.sqrt(ordered.length));
    const widths = ordered.map(node => nodeRect(node).w);
    const heights = ordered.map(node => nodeRect(node).h);
    const cellW = Math.max(...widths) + gapValue;
    const cellH = Math.max(...heights) + gapValue;
    ordered.forEach((node,index) => positions.set(node.id, {
      x:bounds.x + (index % columns)*cellW,
      y:bounds.y + Math.floor(index / columns)*cellH
    }));
  }
  const constraints = [];
  for (const [id,position] of positions){
    const node = nodeById(id);
    if (node) positions.set(id,editingConstrainLayoutPosition(node,position,opts,constraints));
  }
  const movements = [...positions].map(([id,position]) => {
    const node = nodeById(id);
    return node ? Math.hypot(position.x-node.x,position.y-node.y) : 0;
  });
  return {
    kind, gap:gapValue, positions,
    options:{preserveContainers:opts.preserveContainers !== false,
      maxMovement:editingNumber(opts.maxMovement,0,0,100000)},
    originalSelection:sel ? {kind:sel.kind, ids:[...sel.ids]} : null,
    originalView:{...view},
    generation:snapshot(),
    pinned:nodes.filter(node => node.pinned === true).map(node => node.id),
    skipped:nodes.filter(node => node.pinned === true ||
      (typeof organizationObjectLocked === "function" && organizationObjectLocked(node))).map(node => node.id),
    constraints,
    movement:{maximum:Math.max(0,...movements),total:movements.reduce((sum,value) => sum+value,0)}
  };
}
function editingRenderLayoutProposal(){
  if (!editingLayoutProposal || !draftLayer) return;
  draftLayer.querySelectorAll("[data-layout-preview]").forEach(element => element.remove());
  const t = themeColors();
  for (const [id, position] of editingLayoutProposal.positions){
    const node = nodeById(id);
    if (!node) continue;
    const rect = nodeRect(node);
    el("rect", {x:position.x, y:position.y, width:rect.w, height:rect.h, rx:8,
      fill:t.accent, "fill-opacity":.10, stroke:t.accent, "stroke-width":1.5,
      "stroke-dasharray":"6 4", "vector-effect":"non-scaling-stroke",
      "pointer-events":"none", "data-layout-preview":id}, draftLayer);
  }
}
function editingCancelLayoutPreview(){
  if (!editingLayoutProposal) return false;
  const original = editingLayoutProposal;
  editingLayoutProposal = null;
  if (original.originalSelection)
    setSelection(original.originalSelection.kind, original.originalSelection.ids);
  else clearSelection();
  view = {...original.originalView};
  render();
  applyView();
  announce("Layout preview canceled; document, camera, and selection restored.");
  return true;
}
function editingApplyLayoutPreview(){
  const proposal = editingLayoutProposal;
  if (!proposal) return false;
  if (snapshot() !== proposal.generation){
    announce("The document changed after this preview was calculated. Recompute the layout.");
    return false;
  }
  pushHistory();
  for (const [id, position] of proposal.positions){
    const node = nodeById(id);
    if (node){ node.x = position.x; node.y = position.y; }
  }
  editingLayoutProposal = null;
  render();
  announce(`Applied ${proposal.kind} layout to ${proposal.positions.size} objects as one operation.`);
  return true;
}
function openEditingLayoutPreview(){
  const nodes = editingLayoutScopeNodes();
  if (nodes.length < 2){ announce("Select at least two objects or one container to preview layout."); return false; }
  const {body} = editingModalShell("Layout preview", "layout-preview-modal");
  const controls = document.createElement("div");
  controls.className = "editing-form-grid";
  const kind = editingSelect([["grid","Grid packing"],["horizontal","Horizontal flow"],["vertical","Vertical flow"]],"grid");
  const gap = document.createElement("input");
  gap.type = "number";
  gap.min = "0";
  gap.max = "400";
  gap.value = "32";
  const maximum = document.createElement("input");
  maximum.type = "number";
  maximum.min = "0";
  maximum.max = "100000";
  maximum.value = "0";
  maximum.title = "0 allows unrestricted movement";
  const preserve = document.createElement("input");
  preserve.type = "checkbox";
  preserve.checked = true;
  controls.append(editingField("Layout",kind), editingField("Gap",gap),
    editingField("Maximum movement",maximum),editingField("Keep in containers",preserve));
  const summary = document.createElement("p");
  summary.className = "helper";
  const refresh = () => {
    editingLayoutProposal = editingBuildLayoutProposal(kind.value, Number(gap.value), {
      maxMovement:Number(maximum.value),preserveContainers:preserve.checked
    });
    render();
    editingRenderLayoutProposal();
    const count = editingLayoutProposal ? editingLayoutProposal.positions.size : 0;
    const skipped = editingLayoutProposal ? editingLayoutProposal.skipped.length : 0;
    const constraints = editingLayoutProposal ? editingLayoutProposal.constraints.length : 0;
    const maximumMove = editingLayoutProposal ? Math.round(editingLayoutProposal.movement.maximum) : 0;
    summary.textContent = `Preview proposes ${count} moves (maximum ${maximumMove}px)${skipped ? `, preserves ${skipped} pinned or locked object${skipped === 1 ? "" : "s"}` : ""}${constraints ? `, and applies ${constraints} container or movement constraint${constraints === 1 ? "" : "s"}` : ""}. Links reroute only after Apply. The document and history are unchanged until Apply.`;
  };
  kind.addEventListener("change",refresh);
  gap.addEventListener("input",refresh);
  maximum.addEventListener("input",refresh);
  preserve.addEventListener("change",refresh);
  const actions = document.createElement("div");
  actions.className = "actions";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => { editingCancelLayoutPreview(); editingCloseDialog(); });
  const apply = document.createElement("button");
  apply.className = "primary";
  apply.textContent = "Apply layout";
  apply.addEventListener("click", () => {
    if (editingApplyLayoutPreview()) editingCloseDialog();
  });
  actions.append(cancel,apply);
  body.append(controls,summary,actions);
  refresh();
  kind.focus();
  return true;
}

function renderEditingRulers(){
  if (!editingRulerX || !editingRulerY) return;
  const visible = editingRulersVisible();
  editingRulerX.hidden = !visible;
  editingRulerY.hidden = !visible;
  wrap.classList.toggle("editing-rulers-visible", visible);
  if (!visible) return;
  const draw = (canvas, axis) => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    context.setTransform(ratio,0,0,ratio,0,0);
    context.clearRect(0,0,rect.width,rect.height);
    const t = themeColors();
    context.fillStyle = t.panel;
    context.fillRect(0,0,rect.width,rect.height);
    context.strokeStyle = t.muted;
    context.fillStyle = t.ink2;
    context.lineWidth = 1;
    context.font = "9px IBM Plex Mono, monospace";
    const scale = view.k;
    const origin = axis === "x" ? view.x : view.y;
    const length = axis === "x" ? rect.width : rect.height;
    const worldStart = -origin / scale;
    const target = 64 / scale;
    const powers = [1,2,5];
    let step = 1;
    outer: for (let exponent = -2; exponent < 8; exponent++){
      for (const factor of powers){
        const candidate = factor * 10**exponent;
        if (candidate >= target){ step = candidate; break outer; }
      }
    }
    const first = Math.floor(worldStart / step) * step;
    for (let worldValue = first; ; worldValue += step){
      const pixel = origin + worldValue*scale;
      if (pixel > length + step*scale) break;
      if (pixel < -step*scale) continue;
      context.beginPath();
      if (axis === "x"){
        context.moveTo(pixel+.5,rect.height);
        context.lineTo(pixel+.5,rect.height-8);
        context.fillText(String(Math.round(worldValue)),pixel+3,9);
      } else {
        context.moveTo(rect.width,pixel+.5);
        context.lineTo(rect.width-8,pixel+.5);
        context.save();
        context.translate(9,pixel-3);
        context.rotate(-Math.PI/2);
        context.fillText(String(Math.round(worldValue)),0,0);
        context.restore();
      }
      context.stroke();
    }
  };
  draw(editingRulerX,"x");
  draw(editingRulerY,"y");
}
function editingStartRulerGuide(axis, event){
  event.preventDefault();
  event.stopPropagation();
  const worldPoint = clientToWorld(event.clientX,event.clientY);
  const guide = editingAddGuide(axis, axis === "x" ? worldPoint.x : worldPoint.y);
  if (!guide) return;
  editingRulerGuideDrag = {id:guide.id, axis, pointerId:event.pointerId};
}
function editingRulerPointerMove(event){
  if (!editingRulerGuideDrag) return;
  const point = clientToWorld(event.clientX,event.clientY);
  editingUpdateGuide(editingRulerGuideDrag.id, {
    position:editingRulerGuideDrag.axis === "x" ? point.x : point.y
  }, {history:false,render:false});
  render();
}
function editingRulerPointerUp(event){
  if (!editingRulerGuideDrag) return;
  const boardRect = board.getBoundingClientRect();
  if (event.clientX < boardRect.left || event.clientX > boardRect.right ||
      event.clientY < boardRect.top || event.clientY > boardRect.bottom)
    editingDeleteGuide(editingRulerGuideDrag.id,{history:false});
  editingRulerGuideDrag = null;
  render();
}
function openEditingGuideManager(){
  const {body} = editingModalShell("Grid, rulers, and guides");
  const settings = document.createElement("div");
  settings.className = "editing-form-grid";
  const grid = document.createElement("input");
  grid.type = "number";
  grid.min = EDITING_GRID_MIN;
  grid.max = EDITING_GRID_MAX;
  grid.value = editingGridSize();
  const snap = document.createElement("input");
  snap.type = "checkbox";
  snap.checked = snapToGrid;
  const rulers = document.createElement("input");
  rulers.type = "checkbox";
  rulers.checked = editingRulersVisible();
  settings.append(editingField("Grid size",grid),editingField("Persistent snap",snap),
    editingField("Show rulers",rulers));
  const list = document.createElement("div");
  list.className = "editing-guide-list";
  const draw = () => {
    list.innerHTML = "";
    for (const guide of editingGuides(true)){
      const row = document.createElement("div");
      row.className = "editing-guide-row";
      const axis = document.createElement("span");
      axis.textContent = guide.axis === "x" ? "Vertical" : "Horizontal";
      const position = document.createElement("input");
      position.type = "number";
      position.step = "1";
      position.value = guide.position;
      position.setAttribute("aria-label",`${axis.textContent} guide position`);
      position.addEventListener("change", () => {
        editingUpdateGuide(guide.id,{position:Number(position.value)});
        draw();
      });
      const lock = document.createElement("button");
      lock.textContent = guide.locked ? "Unlock" : "Lock";
      lock.addEventListener("click", () => { editingUpdateGuide(guide.id,{locked:!guide.locked}); draw(); });
      const hide = document.createElement("button");
      hide.textContent = guide.hidden ? "Show" : "Hide";
      hide.addEventListener("click", () => { editingUpdateGuide(guide.id,{hidden:!guide.hidden}); draw(); });
      const remove = document.createElement("button");
      remove.className = "dangerbtn";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => { editingDeleteGuide(guide.id); draw(); });
      row.append(axis,position,lock,hide,remove);
      list.appendChild(row);
    }
    if (!list.children.length){
      const empty = document.createElement("p");
      empty.className = "helper";
      empty.textContent = "Drag from either ruler or add a guide below.";
      list.appendChild(empty);
    }
  };
  const actions = document.createElement("div");
  actions.className = "actions editing-guide-actions";
  const addVertical = document.createElement("button");
  addVertical.textContent = "Add vertical";
  addVertical.addEventListener("click", () => { editingAddGuide("x",viewCenter().x); draw(); });
  const addHorizontal = document.createElement("button");
  addHorizontal.textContent = "Add horizontal";
  addHorizontal.addEventListener("click", () => { editingAddGuide("y",viewCenter().y); draw(); });
  const clear = document.createElement("button");
  clear.textContent = "Clear guides";
  clear.addEventListener("click", () => { editingClearGuides(); draw(); });
  const done = document.createElement("button");
  done.className = "primary";
  done.textContent = "Done";
  done.addEventListener("click",editingCloseDialog);
  actions.append(addVertical,addHorizontal,clear,done);
  grid.addEventListener("change", () => setEditingGridSize(grid.value));
  snap.addEventListener("change", () => {
    snapToGrid = snap.checked;
    editingPersistSnapPreference();
    updateSnapControl();
  });
  rulers.addEventListener("change", () => setEditingRulersVisible(rulers.checked));
  body.append(settings,list,actions);
  draw();
  grid.focus();
}

function updateEditingToolbar(){
  if (!editingToolbar) return;
  const mode = editingToolbar.querySelector("[data-editing-selection-mode]");
  if (mode) mode.value = editingSelectionMode;
  const style = editingToolbar.querySelector("[data-editing-style-status]");
  if (style){
    style.hidden = !editingStyleClipboard || !!editingFormatPainter;
    style.textContent = editingStyleClipboard
      ? `Style copied · ${editingStyleClipboard.provenance?.direct || 0} direct · ${editingStyleClipboard.provenance?.inherited || 0} inherited`
      : "";
    style.title = "Paste and format painter transfer appearance only; content, geometry, identity, metadata, relationships, and icon identity are excluded.";
  }
  const painter = editingToolbar.querySelector("[data-editing-painter-status]");
  if (painter){
    painter.hidden = !editingFormatPainter;
    painter.textContent = editingFormatPainter
      ? `${editingFormatPainter.persistent ? "Persistent" : "One-shot"} format painter · Esc to cancel` : "";
  }
}
function initializeEditingUi(){
  editingLoadSnapPreference();
  if (!editingToolbar){
    editingToolbar = document.createElement("div");
    editingToolbar.className = "editing-toolbar";
    editingToolbar.setAttribute("aria-label","Canvas editing modes");
    const label = document.createElement("label");
    label.innerHTML = "<span>Selection</span>";
    const mode = editingSelect([["contain","Contain"],["intersect","Intersect"],["lasso","Lasso"]],
      editingSelectionMode);
    mode.dataset.editingSelectionMode = "";
    mode.title = "Drag selects visible nodes only. Locked nodes remain inspectable; use Select attached links for relationships.";
    mode.addEventListener("change", () => setEditingSelectionMode(mode.value));
    label.appendChild(mode);
    const guides = document.createElement("button");
    guides.type = "button";
    guides.textContent = "Grid & guides";
    guides.addEventListener("click",openEditingGuideManager);
    const painter = document.createElement("span");
    painter.dataset.editingPainterStatus = "";
    painter.className = "editing-painter-status";
    painter.hidden = true;
    const style = document.createElement("span");
    style.dataset.editingStyleStatus = "";
    style.className = "editing-style-status";
    style.hidden = true;
    editingToolbar.append(label,guides,style,painter);
    wrap.appendChild(editingToolbar);
  }
  if (!editingSnapHud){
    editingSnapHud = document.createElement("div");
    editingSnapHud.className = "editing-snap-hud";
    editingSnapHud.hidden = true;
    editingSnapHud.setAttribute("aria-live","polite");
    wrap.appendChild(editingSnapHud);
  }
  if (!editingRulerX){
    editingRulerX = document.createElement("canvas");
    editingRulerX.className = "editing-ruler editing-ruler-x";
    editingRulerX.setAttribute("aria-label","Horizontal ruler; drag to create a vertical guide");
    editingRulerX.addEventListener("pointerdown", event => editingStartRulerGuide("x",event));
    wrap.appendChild(editingRulerX);
  }
  if (!editingRulerY){
    editingRulerY = document.createElement("canvas");
    editingRulerY.className = "editing-ruler editing-ruler-y";
    editingRulerY.setAttribute("aria-label","Vertical ruler; drag to create a horizontal guide");
    editingRulerY.addEventListener("pointerdown", event => editingStartRulerGuide("y",event));
    wrap.appendChild(editingRulerY);
  }
  window.addEventListener("pointermove",editingRulerPointerMove);
  window.addEventListener("pointerup",editingRulerPointerUp);
  window.addEventListener("resize",renderEditingRulers);
  editingUpdateGridPattern();
  renderEditingRulers();
  updateEditingToolbar();
}

function initializeEditingCommands(){
  const command = definition => registerCommand({...definition,owner:"editing"});
  const multiple = () => selectedNodes().length >= 2;
  const selection = () => selectedNodes().length > 0;
  const anySelection = () => selectedNodes().length > 0 || selectionIds("edge").length > 0;
  const layoutAvailable = () => selectedNodes().length >= 2 ||
    (selectedNodes().length === 1 && isStructuralNode(selectedNodes()[0]));
  const heightSelection = () => editingSelectionSupports("resizable-height",2);
  const transformSelection = () => editingSelectionSupports("rotatable",1);
  const styleSource = () => !!(singleSelectedNode() || singleSelectedEdge());
  [
    {id:"heightSmallest",label:"Smallest height",description:"Match the smallest compatible selected height",action:() => matchSelectionHeights("smallest"),enabled:heightSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-height"],minimumSelection:2,ribbon:{tab:"arrange",group:"Size"}},
    {id:"heightLargest",label:"Largest height",description:"Match the largest compatible selected height",action:() => matchSelectionHeights("largest"),enabled:heightSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-height"],minimumSelection:2,ribbon:{tab:"arrange",group:"Size"}},
    {id:"heightAverage",label:"Average height",description:"Match the average compatible selected height",action:() => matchSelectionHeights("average"),enabled:heightSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-height"],minimumSelection:2,ribbon:{tab:"arrange",group:"Size"}},
    {id:"sizeSmallest",label:"Smallest full size",description:"Match width and height to the smallest compatible selection",action:() => matchSelectionSizes("smallest"),enabled:heightSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-width","resizable-height"],minimumSelection:2,ribbon:{tab:"arrange",group:"Size"}},
    {id:"sizeLargest",label:"Largest full size",description:"Match width and height to the largest compatible selection",action:() => matchSelectionSizes("largest"),enabled:heightSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-width","resizable-height"],minimumSelection:2,ribbon:{tab:"arrange",group:"Size"}},
    {id:"sizeAverage",label:"Average full size",description:"Match width and height to the average compatible selection",action:() => matchSelectionSizes("average"),enabled:heightSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-width","resizable-height"],minimumSelection:2,ribbon:{tab:"arrange",group:"Size"}},
    {id:"resetWidth",label:"Reset width",description:"Return selected widths to content-driven sizing",action:() => resetSelectionSizes("width"),enabled:selection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-width"],minimumSelection:1},
    {id:"resetHeight",label:"Reset height",description:"Return selected heights to content-driven sizing",action:() => resetSelectionSizes("height"),enabled:selection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["resizable-height"],minimumSelection:1},
    {id:"rotateLeft",label:"Rotate left 90°",description:"Rotate supported selected nodes counterclockwise",action:() => editingRotateSelection(-90),enabled:transformSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["rotatable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Transform"}},
    {id:"rotateRight",label:"Rotate right 90°",description:"Rotate supported selected nodes clockwise",action:() => editingRotateSelection(90),enabled:transformSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["rotatable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Transform"}},
    {id:"rotateExact",label:"Exact rotation",description:"Enter an exact angle for supported selected nodes",action:editingPromptRotation,enabled:transformSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["rotatable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Transform"}},
    {id:"flipHorizontal",label:"Flip horizontally",description:"Mirror supported selected nodes without reversing text",action:() => editingFlipSelection("x"),enabled:transformSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["flippable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Transform"}},
    {id:"flipVertical",label:"Flip vertically",description:"Mirror supported selected nodes without reversing text",action:() => editingFlipSelection("y"),enabled:transformSelection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["flippable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Transform"}},
    {id:"copyStyle",label:"Copy style",description:"Copy compatible appearance only",action:editingCopyStyle,enabled:styleSource,scope:"selection",ribbon:{tab:"home",group:"Style transfer"}},
    {id:"pasteStyle",label:"Paste style",description:"Apply copied appearance without content, metadata, identity, or geometry",action:editingPasteStyle,enabled:() => !!editingStyleClipboard && anySelection(),scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["styleable"],minimumSelection:1,ribbon:{tab:"home",group:"Style transfer"}},
    {id:"formatPainter",label:"Format painter",description:"Apply copied appearance to one target",action:() => editingActivateFormatPainter(false),enabled:styleSource,scope:"selection",ribbon:{tab:"home",group:"Style transfer"}},
    {id:"formatPainterPersistent",label:"Persistent painter",description:"Apply copied appearance to several targets until Escape",action:() => editingActivateFormatPainter(true),enabled:styleSource,scope:"selection",ribbon:{tab:"home",group:"Style transfer"}},
    {id:"selectionStudio",label:"Select by…",description:"Select by type, status, style, layer, group, semantic type, or property",action:openEditingSelectionStudio,ribbon:{tab:"view",group:"Selection"}},
    {id:"selectConnected",label:"Select connected",description:"Add directly connected objects",action:() => editingConnectivityNodes("both"),enabled:selection,scope:"selection",ribbon:{tab:"view",group:"Selection"}},
    {id:"selectPredecessors",label:"Select predecessors",description:"Add direct predecessors",action:() => editingConnectivityNodes("predecessors"),enabled:selection,scope:"selection"},
    {id:"selectSuccessors",label:"Select successors",description:"Add direct successors",action:() => editingConnectivityNodes("successors"),enabled:selection,scope:"selection"},
    {id:"selectAttachedLinks",label:"Select attached links",description:"Select links attached to selected nodes",action:editingSelectAttachedLinks,enabled:selection,scope:"selection"},
    {id:"invertSelection",label:"Invert selection",description:"Select every visible node not currently selected",action:editingInvertSelection,ribbon:{tab:"view",group:"Selection"}},
    {id:"toggleRulers",label:"Rulers",description:"Show document-coordinate rulers",action:() => setEditingRulersVisible(!editingRulersVisible()),pressed:editingRulersVisible,mutatesDocument:true,ribbon:{tab:"view",group:"Precision"}},
    {id:"guideManager",label:"Grid & guides",description:"Configure grid, rulers, persistent snap, and manual guides",action:openEditingGuideManager,ribbon:{tab:"view",group:"Precision"}},
    {id:"snapSelectionGrid",label:"Snap selection to grid",description:"Move unlocked selected objects onto the configured document grid",action:editingSnapSelectionToGrid,enabled:selection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["positionable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Precision"}},
    {id:"clearGuides",label:"Clear guides",description:"Remove every manual document guide as one undoable operation",action:editingClearGuides,enabled:() => editingGuides(true).length > 0,mutatesDocument:true,ribbon:{tab:"view",group:"Precision"}},
    {id:"layoutPreview",label:"Layout preview",description:"Preview grid or flow layout without changing the document",action:openEditingLayoutPreview,enabled:layoutAvailable,scope:"selection",requiredCapabilities:["positionable"],minimumSelection:2,preview:true,ribbon:{tab:"arrange",group:"Layout safety"}},
    {id:"togglePin",label:"Pin for layout",description:"Pin or unpin selected objects for layout previews",action:editingTogglePinned,enabled:selection,scope:"selection",mutatesDocument:true,allowLockedSubset:true,requiredCapabilities:["pinnable"],minimumSelection:1,ribbon:{tab:"arrange",group:"Layout safety"}}
  ].forEach(command);
}

function renderEditingInspectorForNode(node){
  if (!node || typeof inspectorSection !== "function") return;
  inspectorSection("editing:transform","Transform & layout",() => {
    frow("Left",() => sizeStepper(Math.round(node.x),-100000,100000,1,(value,commit) => {
      pushHistory(`editing-x:${node.id}`); node.x=value; commit ? render() : drawOnly();
    }));
    frow("Top",() => sizeStepper(Math.round(node.y),-100000,100000,1,(value,commit) => {
      pushHistory(`editing-y:${node.id}`); node.y=value; commit ? render() : drawOnly();
    }));
    if (!isStructuralNode(node)){
      frow("Rotation",() => sizeStepper(nodeRotation(node),-360,360,1,(value,commit) => {
        pushHistory(`editing-rotation:${node.id}`); setNodeRotation(node,value); commit ? render() : drawOnly();
      }));
      frow("Flip",() => {
        const wrap = document.createElement("div");
        wrap.className = "button-row";
        const x = mkBtn(nodeFlipX(node) ? "Unflip X" : "Flip X",() => { pushHistory(); setNodeFlip(node,"x",!nodeFlipX(node)); render(); });
        const y = mkBtn(nodeFlipY(node) ? "Unflip Y" : "Flip Y",() => { pushHistory(); setNodeFlip(node,"y",!nodeFlipY(node)); render(); });
        wrap.append(x,y);
        return wrap;
      });
      frow("Layout",() => mkFlag(node.pinned === true ? "Pinned" : "Moves with layout",
        node.pinned === true,enabled => {
          if (enabled) node.pinned=true; else delete node.pinned;
          render();
        }));
    }
  },{open:false});
}
function renderEditingMultiInspector(){
  if (typeof inspectorSection !== "function") return;
  inspectorSection("editing:multi","Size, transform & style",() => {
    const rows = [
      ["Match smallest",() => matchSelectionSizes("smallest")],
      ["Match largest",() => matchSelectionSizes("largest")],
      ["Match average",() => matchSelectionSizes("average")],
      ["Rotate left",() => editingRotateSelection(-90)],
      ["Rotate right",() => editingRotateSelection(90)],
      ["Flip X",() => editingFlipSelection("x")],
      ["Flip Y",() => editingFlipSelection("y")],
      ["Copy style",editingCopyStyle],
      ["Paste style",editingPasteStyle]
    ];
    const wrap = document.createElement("div");
    wrap.className = "editing-inspector-actions";
    for (const [label,action] of rows) wrap.appendChild(mkBtn(label,action));
    appendInspector(wrap);
  },{open:false});
}
