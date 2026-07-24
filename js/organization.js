"use strict";

/* ------------------------------------------------------------------
   Object organization

   Groups are explicit, non-rendered records. Layers are persisted render
   partitions. Frames and swimlanes remain spatial containers. Direct object
   flags are never overwritten by inherited/effective state.
   ------------------------------------------------------------------ */

const ORGANIZATION_PAGE_ID = "page-default";
const ORGANIZATION_LAYER_ID = "layer-default";
const ORGANIZATION_ROW_HEIGHT = 30;
const ORGANIZATION_OVERSCAN = 8;
const ORGANIZATION_NAME_MAX = 80;
const ORGANIZATION_PREF_KEY = "schematic.objectExplorerOpen";
const ORGANIZATION_ICONS = Object.freeze({
  page:"▤", layer:"◆", group:"▸", relationships:"↔", edge:"⟷",
  concept:"◇", text:"T", status:"●", note:"▣", table:"▦", todo:"☑",
  frame:"□", swimlane:"▥"
});

let organizationIsolation = null;
let organizationNormalizedState = null;
let organizationEvaluationCache = null;
let organizationIsolationCache = null;
let organizationExplorerTarget = null;
let organizationFlatCache = [];
let organizationFocusedIndex = 0;
let organizationExpanded = new Set([ORGANIZATION_PAGE_ID, ORGANIZATION_LAYER_ID]);
let organizationDrag = null;
let organizationRenderPending = false;

function organizationName(raw, fallback){
  const value = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, ORGANIZATION_NAME_MAX);
  return value || fallback;
}
function organizationNewId(){
  return "o" + (state.nextId++);
}
function defaultOrganization(){
  return {
    page:{id:ORGANIZATION_PAGE_ID, name:"Current canvas"},
    layers:[{id:ORGANIZATION_LAYER_ID, name:"Default"}],
    groups:[],
    activeLayerId:ORGANIZATION_LAYER_ID
  };
}
function normalizeOrganization(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const pageSource = source.page && typeof source.page === "object" ? source.page : {};
  const page = {
    ...pageSource,
    id:String(pageSource.id || ORGANIZATION_PAGE_ID),
    name:organizationName(pageSource.name, "Current canvas")
  };
  const layers = [];
  const layerIds = new Set();
  const rawLayers = Array.isArray(source.layers) ? source.layers : [];
  const defaultSource = rawLayers.find(layer => layer && layer.id === ORGANIZATION_LAYER_ID) || {};
  const defaultLayer = {
    ...defaultSource,
    id:ORGANIZATION_LAYER_ID,
    name:organizationName(defaultSource.name, "Default")
  };
  if (defaultLayer.hidden !== true) delete defaultLayer.hidden;
  if (defaultLayer.locked !== true) delete defaultLayer.locked;
  if (defaultLayer.export !== false) delete defaultLayer.export;
  const defaultOpacity = Number(defaultLayer.opacity);
  if (Number.isFinite(defaultOpacity) && defaultOpacity >= .1 && defaultOpacity < 1)
    defaultLayer.opacity = Math.round(defaultOpacity * 100) / 100;
  else delete defaultLayer.opacity;
  const defaultColor = normalizeColorValue(defaultLayer.color);
  if (defaultColor) defaultLayer.color = defaultColor; else delete defaultLayer.color;
  layers.push(defaultLayer);
  layerIds.add(ORGANIZATION_LAYER_ID);
  for (const candidate of rawLayers){
    if (!candidate || typeof candidate !== "object" || candidate.id === ORGANIZATION_LAYER_ID) continue;
    const id = String(candidate.id || "");
    if (!id || layerIds.has(id)) continue;
    const layer = {...candidate, id, name:organizationName(candidate.name, "Layer")};
    if (layer.hidden !== true) delete layer.hidden;
    if (layer.locked !== true) delete layer.locked;
    if (layer.export !== false) delete layer.export;
    const opacity = Number(layer.opacity);
    if (Number.isFinite(opacity) && opacity >= .1 && opacity < 1) layer.opacity = Math.round(opacity * 100) / 100;
    else delete layer.opacity;
    const color = normalizeColorValue(layer.color);
    if (color) layer.color = color; else delete layer.color;
    layers.push(layer);
    layerIds.add(id);
  }

  const groups = [];
  const groupIds = new Set();
  for (const candidate of Array.isArray(source.groups) ? source.groups : []){
    if (!candidate || typeof candidate !== "object") continue;
    const id = String(candidate.id || "");
    if (!id || groupIds.has(id) || layerIds.has(id)) continue;
    const group = {...candidate, id, name:organizationName(candidate.name, "Group")};
    if (group.hidden !== true) delete group.hidden;
    if (group.locked !== true) delete group.locked;
    groups.push(group);
    groupIds.add(id);
  }
  const byGroup = new Map(groups.map(group => [group.id, group]));
  for (const group of groups){
    if (!layerIds.has(group.layerId)) delete group.layerId;
    if (!byGroup.has(group.parentGroupId) || group.parentGroupId === group.id) delete group.parentGroupId;
    if (group.parentGroupId) delete group.layerId;
    if (!group.parentGroupId && !group.layerId) group.layerId = ORGANIZATION_LAYER_ID;
  }
  /* Deterministically break parent cycles at the first record that closes one. */
  for (const group of groups){
    const seen = new Set([group.id]);
    let cursor = group;
    while (cursor.parentGroupId){
      if (seen.has(cursor.parentGroupId)){
        delete cursor.parentGroupId;
        cursor.layerId = ORGANIZATION_LAYER_ID;
        break;
      }
      seen.add(cursor.parentGroupId);
      cursor = byGroup.get(cursor.parentGroupId);
      if (!cursor) break;
    }
  }
  const activeLayerId = layerIds.has(source.activeLayerId)
    ? source.activeLayerId : ORGANIZATION_LAYER_ID;
  return {...source, page, layers, groups, activeLayerId};
}
function ensureOrganization(){
  if (state.organization && state.organization === organizationNormalizedState) return state.organization;
  state.organization = normalizeOrganization(state.organization);
  organizationNormalizedState = state.organization;
  organizationEvaluationCache = null;
  organizationIsolationCache = null;
  const groupIds = new Set(state.organization.groups.map(group => group.id));
  const layerIds = new Set(state.organization.layers.map(layer => layer.id));
  for (const object of [...state.nodes, ...state.edges]){
    if (!object || typeof object !== "object") continue;
    if (!layerIds.has(object.layerId) || object.layerId === ORGANIZATION_LAYER_ID) delete object.layerId;
    if (!groupIds.has(object.groupId) || state.edges.includes(object)) delete object.groupId;
    if (object.groupId) delete object.layerId;
    if (object.hidden !== true) delete object.hidden;
    if (object.locked !== true) delete object.locked;
  }
  return state.organization;
}
function cleanOrganizationForDocument(raw = state.organization){
  const normalized = normalizeOrganization(raw);
  const cleanLayer = source => {
    const layer = {...source};
    layer.name = organizationName(layer.name, layer.id === ORGANIZATION_LAYER_ID ? "Default" : "Layer");
    if (layer.hidden !== true) delete layer.hidden;
    if (layer.locked !== true) delete layer.locked;
    if (layer.export !== false) delete layer.export;
    const opacity = Number(layer.opacity);
    if (!Number.isFinite(opacity) || opacity >= 1) delete layer.opacity;
    else layer.opacity = Math.max(.1, Math.round(opacity * 100) / 100);
    const color = normalizeColorValue(layer.color);
    if (color) layer.color = color; else delete layer.color;
    return layer;
  };
  const cleanGroup = source => {
    const group = {...source, name:organizationName(source.name, "Group")};
    if (group.hidden !== true) delete group.hidden;
    if (group.locked !== true) delete group.locked;
    if (group.parentGroupId) delete group.layerId;
    return group;
  };
  return {
    ...normalized,
    page:{...normalized.page},
    layers:normalized.layers.map(cleanLayer),
    groups:normalized.groups.map(cleanGroup)
  };
}
function organizationLayers(){
  return ensureOrganization().layers;
}
function organizationGroups(){
  return ensureOrganization().groups;
}
function organizationLayerById(id){
  return organizationLayers().find(layer => layer.id === id) || organizationLayers()[0];
}
function organizationGroupById(id){
  return organizationGroups().find(group => group.id === id) || null;
}
function organizationGroupAncestors(groupOrId){
  const group = typeof groupOrId === "string" ? organizationGroupById(groupOrId) : groupOrId;
  const ancestors = [];
  const seen = new Set();
  let cursor = group;
  while (cursor && cursor.parentGroupId && !seen.has(cursor.parentGroupId)){
    seen.add(cursor.parentGroupId);
    cursor = organizationGroupById(cursor.parentGroupId);
    if (cursor) ancestors.push(cursor);
  }
  return ancestors;
}
function organizationGroupLayerId(groupOrId){
  const group = typeof groupOrId === "string" ? organizationGroupById(groupOrId) : groupOrId;
  if (!group) return ORGANIZATION_LAYER_ID;
  if (group.layerId) return organizationLayerById(group.layerId).id;
  const ancestor = organizationGroupAncestors(group).find(candidate => candidate.layerId);
  return ancestor ? organizationLayerById(ancestor.layerId).id : ORGANIZATION_LAYER_ID;
}
function organizationObjectLayerId(object){
  if (!object) return ORGANIZATION_LAYER_ID;
  const layerRecord = organizationLayers().find(layer => layer === object);
  if (layerRecord) return layerRecord.id;
  const groupRecord = organizationGroups().find(group => group === object);
  if (groupRecord) return organizationGroupLayerId(groupRecord);
  if (object.groupId) return organizationGroupLayerId(object.groupId);
  return organizationLayerById(object.layerId).id;
}
function organizationObjectLayer(object){
  return organizationLayerById(organizationObjectLayerId(object));
}
function organizationLayerRank(object){
  const id = organizationObjectLayerId(object);
  const index = organizationLayers().findIndex(layer => layer.id === id);
  return index < 0 ? 0 : index;
}
function organizationSortRecords(records){
  return records.map((record, index) => ({record, index}))
    .sort((a, b) => organizationLayerRank(a.record) - organizationLayerRank(b.record) || a.index - b.index)
    .map(entry => entry.record);
}
function organizationLayerOpacity(object){
  const opacity = Number(organizationObjectLayer(object).opacity);
  return Number.isFinite(opacity) ? Math.max(.1, Math.min(1, opacity)) : 1;
}
function organizationRenderAttributes(object){
  const layerId = organizationObjectLayerId(object);
  const opacity = organizationLayerOpacity(object);
  const attrs = {
    "data-layer-id":layerId,
    "data-layer-export":organizationObjectLayer(object).export === false ? "false" : "true"
  };
  if (opacity < 1){
    attrs.opacity = opacity;
    attrs["data-organization-opacity"] = String(opacity);
  }
  return attrs;
}
function organizationSourceLocked(object){
  return !!object && (object.sourceControlled === true ||
    String(object.sourceAuthority || "").toLowerCase() === "external");
}
function organizationSpatialAncestors(node){
  if (!node || !state.nodes.includes(node)) return [];
  const center = nodeCenterForContainment(node);
  return state.nodes.filter(container => container.id !== node.id && isStructuralNode(container))
    .filter(container => {
      const rect = containmentRect(container);
      if (isStructuralNode(node)){
        const own = containmentRect(node);
        if (rect.w * rect.h <= own.w * own.h) return false;
      }
      return center.x >= rect.x && center.x <= rect.x + rect.w &&
             center.y >= rect.y && center.y <= rect.y + rect.h;
    })
    .sort((a, b) => {
      const ar = containmentRect(a), br = containmentRect(b);
      return ar.w * ar.h - br.w * br.h;
    });
}
function organizationDirectHidden(object){ return !!object && object.hidden === true; }
function organizationDirectLocked(object){ return !!object && object.locked === true; }
function organizationObjectGroupChain(object){
  const groupRecord = object && organizationGroups().find(group => group === object);
  if (groupRecord) return [groupRecord, ...organizationGroupAncestors(groupRecord)];
  const group = object && object.groupId ? organizationGroupById(object.groupId) : null;
  return group ? [group, ...organizationGroupAncestors(group)] : [];
}
function organizationIsolationContext(){
  if (!organizationIsolation) return null;
  if (organizationIsolationCache) return organizationIsolationCache;
  const nodeIds = new Set();
  if (organizationIsolation.kind === "layer"){
    for (const node of state.nodes)
      if (organizationObjectLayerId(node) === organizationIsolation.id) nodeIds.add(node.id);
  } else if (organizationIsolation.kind === "group"){
    for (const node of organizationGroupMemberNodes(organizationIsolation.id, true)) nodeIds.add(node.id);
  } else if (organizationIsolation.kind === "node"){
    if (nodeById(organizationIsolation.id)) nodeIds.add(organizationIsolation.id);
  }
  const containerIds = new Set();
  for (const container of state.nodes.filter(isStructuralNode)){
    const outer = containmentRect(container);
    for (const node of state.nodes){
      if (!nodeIds.has(node.id) || node.id === container.id) continue;
      const center = nodeCenterForContainment(node);
      if (center.x >= outer.x && center.x <= outer.x + outer.w &&
          center.y >= outer.y && center.y <= outer.y + outer.h){
        containerIds.add(container.id);
        break;
      }
    }
  }
  const edgeIds = new Set();
  for (const edge of state.edges){
    if (organizationIsolation.kind === "layer"){
      if (organizationObjectLayerId(edge) === organizationIsolation.id) edgeIds.add(edge.id);
    } else if (nodeIds.has(edge.from) && nodeIds.has(edge.to)){
      edgeIds.add(edge.id);
    }
  }
  organizationIsolationCache = {nodeIds, containerIds, edgeIds};
  return organizationIsolationCache;
}
function organizationIsolationIncludes(object){
  if (!organizationIsolation || !object) return true;
  const context = organizationIsolationContext();
  if (typeof object.type === "string")
    return context.nodeIds.has(object.id) || context.containerIds.has(object.id);
  if (Object.hasOwn(object, "from") && Object.hasOwn(object, "to"))
    return context.edgeIds.has(object.id);
  if (organizationLayers().includes(object))
    return organizationIsolation.kind !== "layer" || object.id === organizationIsolation.id;
  if (organizationGroups().includes(object))
    return organizationIsolation.kind !== "group" ||
      object.id === organizationIsolation.id ||
      organizationGroupAncestors(organizationIsolation.id).some(group => group.id === object.id);
  return true;
}
function invalidateOrganizationEvaluation(){
  organizationEvaluationCache = null;
  organizationIsolationCache = null;
}
function organizationBaseState(object){
  if (!object) return {hidden:true, locked:false};
  const groups = organizationObjectGroupChain(object);
  const layer = organizationObjectLayer(object);
  return {
    hidden:organizationDirectHidden(object) || groups.some(group => group.hidden === true) ||
      layer.hidden === true || !organizationIsolationIncludes(object),
    locked:organizationDirectLocked(object) || organizationSourceLocked(object) ||
      groups.some(group => group.locked === true) || layer.locked === true
  };
}
function organizationEffectiveEvaluation(){
  if (organizationEvaluationCache) return organizationEvaluationCache;
  ensureOrganization();
  const nodeState = new Map();
  const edgeState = new Map();
  const structural = state.nodes.filter(isStructuralNode).sort((a, b) => {
    const ar = containmentRect(a), br = containmentRect(b);
    return br.w * br.h - ar.w * ar.h;
  });
  const structuralState = new Map();
  for (const container of structural){
    const stateForContainer = organizationBaseState(container);
    const center = nodeCenterForContainment(container);
    const own = containmentRect(container);
    for (const outer of structural){
      if (outer === container) continue;
      const outerRect = containmentRect(outer);
      if (outerRect.w * outerRect.h <= own.w * own.h) continue;
      if (center.x < outerRect.x || center.x > outerRect.x + outerRect.w ||
          center.y < outerRect.y || center.y > outerRect.y + outerRect.h) continue;
      const inherited = structuralState.get(outer.id) || organizationBaseState(outer);
      stateForContainer.hidden ||= inherited.hidden;
      stateForContainer.locked ||= inherited.locked;
    }
    structuralState.set(container.id, stateForContainer);
  }
  for (const node of state.nodes){
    const effective = isStructuralNode(node)
      ? {...(structuralState.get(node.id) || organizationBaseState(node))}
      : organizationBaseState(node);
    if (!isStructuralNode(node) && structural.length){
      const center = nodeCenterForContainment(node);
      for (const container of structural){
        const outer = containmentRect(container);
        if (center.x < outer.x || center.x > outer.x + outer.w ||
            center.y < outer.y || center.y > outer.y + outer.h) continue;
        const inherited = structuralState.get(container.id);
        if (!inherited) continue;
        effective.hidden ||= inherited.hidden;
        effective.locked ||= inherited.locked;
      }
    }
    nodeState.set(node.id, effective);
  }
  for (const edge of state.edges){
    const effective = organizationBaseState(edge);
    const from = nodeState.get(edge.from), to = nodeState.get(edge.to);
    if (!from || !to || from.hidden || to.hidden) effective.hidden = true;
    edgeState.set(edge.id, effective);
  }
  organizationEvaluationCache = {
    nodeState,
    edgeState,
    hiddenNodeIds:new Set([...nodeState].filter(([, value]) => value.hidden).map(([id]) => id)),
    lockedNodeIds:new Set([...nodeState].filter(([, value]) => value.locked).map(([id]) => id)),
    hiddenEdgeIds:new Set([...edgeState].filter(([, value]) => value.hidden).map(([id]) => id)),
    lockedEdgeIds:new Set([...edgeState].filter(([, value]) => value.locked).map(([id]) => id))
  };
  return organizationEvaluationCache;
}
function organizationObjectHidden(object, opts = {}){
  if (!object) return true;
  if (opts.spatial === false) return organizationBaseState(object).hidden;
  if (typeof object.type === "string")
    return organizationEffectiveEvaluation().nodeState.get(object.id)?.hidden ?? true;
  if (Object.hasOwn(object, "from") && Object.hasOwn(object, "to"))
    return organizationEffectiveEvaluation().edgeState.get(object.id)?.hidden ?? true;
  return organizationBaseState(object).hidden;
}
function organizationObjectLocked(object, opts = {}){
  if (!object) return false;
  if (opts.spatial === false) return organizationBaseState(object).locked;
  if (typeof object.type === "string")
    return organizationEffectiveEvaluation().nodeState.get(object.id)?.locked ?? false;
  if (Object.hasOwn(object, "from") && Object.hasOwn(object, "to"))
    return organizationEffectiveEvaluation().edgeState.get(object.id)?.locked ?? false;
  return organizationBaseState(object).locked;
}
function organizationalHiddenNodeIds(){
  return new Set(organizationEffectiveEvaluation().hiddenNodeIds);
}
function hiddenCanvasNodeIds(collapsed = collapsedFrameHiddenNodeIds()){
  const hidden = organizationalHiddenNodeIds();
  for (const id of collapsed) hidden.add(id);
  return hidden;
}
function organizationCanMutateObject(object, shouldAnnounce = true){
  const allowed = !!object && !organizationObjectLocked(object);
  if (!allowed && shouldAnnounce) announce("This object is locked. Unlock it or its parent layer, group, frame, or swimlane first.");
  return allowed;
}
function organizationSelectionLocked(){
  return selectedNodes().some(organizationObjectLocked) ||
    selectionIds("edge").map(edgeById).filter(Boolean).some(organizationObjectLocked);
}
function organizationMutationGuard(){
  if (!organizationSelectionLocked()) return true;
  announce("The selection contains a locked object.");
  return false;
}
function organizationAssignActiveLayer(object){
  if (!object) return object;
  const active = ensureOrganization().activeLayerId;
  delete object.groupId;
  if (active && active !== ORGANIZATION_LAYER_ID) object.layerId = active;
  else delete object.layerId;
  return object;
}
function organizationSetObjectLayer(object, layerId){
  if (!object || !organizationLayerById(layerId)) return false;
  delete object.groupId;
  if (layerId === ORGANIZATION_LAYER_ID) delete object.layerId;
  else object.layerId = layerId;
  return true;
}
function organizationGroupDescendants(groupId){
  const ids = new Set([groupId]);
  let changed = true;
  while (changed){
    changed = false;
    for (const group of organizationGroups()){
      if (group.parentGroupId && ids.has(group.parentGroupId) && !ids.has(group.id)){
        ids.add(group.id);
        changed = true;
      }
    }
  }
  ids.delete(groupId);
  return [...ids].map(organizationGroupById).filter(Boolean);
}
function organizationGroupMemberNodes(groupId, deep = true){
  const ids = new Set([groupId]);
  if (deep) for (const group of organizationGroupDescendants(groupId)) ids.add(group.id);
  return state.nodes.filter(node => ids.has(node.groupId));
}
function organizationSetNodeGroup(node, groupId){
  if (!node || !state.nodes.includes(node)) return false;
  const group = organizationGroupById(groupId);
  if (!group) return false;
  node.groupId = group.id;
  delete node.layerId;
  return true;
}
function organizationCanParentGroup(group, parentId){
  if (!group) return false;
  if (!parentId) return true;
  if (parentId === group.id) return false;
  return !organizationGroupDescendants(group.id).some(candidate => candidate.id === parentId);
}
function organizationSetGroupParent(group, parentId){
  if (!organizationCanParentGroup(group, parentId)) return false;
  if (parentId){
    group.parentGroupId = parentId;
    delete group.layerId;
  } else {
    delete group.parentGroupId;
    group.layerId = ORGANIZATION_LAYER_ID;
  }
  return true;
}
function createOrganizationLayer(name = "Layer"){
  pushHistory();
  const layer = {id:organizationNewId(), name:organizationName(name, `Layer ${organizationLayers().length + 1}`)};
  state.organization.layers.push(layer);
  state.organization.activeLayerId = layer.id;
  organizationExpanded.add(layer.id);
  organizationExplorerTarget = {kind:"layer", id:layer.id};
  render();
  scheduleOrganizationExplorerRender(true);
  announce(`Created and activated ${layer.name}`);
  return layer;
}
function createOrganizationGroupFromSelection(name = "Group"){
  const nodes = selectedNodes();
  if (!nodes.length || nodes.some(organizationObjectLocked)){
    announce(nodes.length ? "Unlock every selected node before grouping." : "Select at least one node to group.");
    return null;
  }
  pushHistory();
  const layerId = organizationObjectLayerId(nodes[0]);
  const group = {id:organizationNewId(), name:organizationName(name, "Group")};
  if (layerId !== ORGANIZATION_LAYER_ID) group.layerId = layerId;
  else group.layerId = ORGANIZATION_LAYER_ID;
  state.organization.groups.push(group);
  for (const node of nodes) organizationSetNodeGroup(node, group.id);
  organizationExpanded.add(group.id);
  organizationExpanded.add(layerId);
  organizationExplorerTarget = {kind:"group", id:group.id};
  render();
  scheduleOrganizationExplorerRender(true);
  announce(`Grouped ${nodes.length} object${nodes.length === 1 ? "" : "s"} as ${group.name}`);
  return group;
}
function ungroupOrganizationGroup(groupId){
  const group = organizationGroupById(groupId);
  if (!group || organizationObjectLocked(group)) return false;
  pushHistory();
  const layerId = organizationGroupLayerId(group);
  for (const node of state.nodes.filter(candidate => candidate.groupId === group.id)){
    delete node.groupId;
    if (layerId !== ORGANIZATION_LAYER_ID) node.layerId = layerId; else delete node.layerId;
  }
  for (const child of organizationGroups().filter(candidate => candidate.parentGroupId === group.id)){
    if (group.parentGroupId) child.parentGroupId = group.parentGroupId;
    else {
      delete child.parentGroupId;
      child.layerId = layerId;
    }
  }
  state.organization.groups = organizationGroups().filter(candidate => candidate.id !== group.id);
  organizationExplorerTarget = null;
  render();
  scheduleOrganizationExplorerRender(true);
  return true;
}
function deleteOrganizationGroupContents(groupId){
  const group = organizationGroupById(groupId);
  if (!group) return false;
  const nodes = organizationGroupMemberNodes(groupId, true);
  if (nodes.some(organizationObjectLocked) || organizationObjectLocked(group)){
    announce("Unlock this group and all of its contents before deleting them.");
    return false;
  }
  pushHistory();
  const nodeIds = new Set(nodes.map(node => node.id));
  const groupIds = new Set([groupId, ...organizationGroupDescendants(groupId).map(candidate => candidate.id)]);
  state.edges = state.edges.filter(edge => !nodeIds.has(edge.from) && !nodeIds.has(edge.to));
  state.nodes = state.nodes.filter(node => !nodeIds.has(node.id));
  state.organization.groups = organizationGroups().filter(candidate => !groupIds.has(candidate.id));
  clearSelection();
  organizationExplorerTarget = null;
  render();
  scheduleOrganizationExplorerRender(true);
  return true;
}
function duplicateOrganizationGroup(groupId){
  const source = organizationGroupById(groupId);
  if (!source) return null;
  const sourceGroups = [source, ...organizationGroupDescendants(groupId)];
  const sourceNodes = organizationGroupMemberNodes(groupId, true);
  pushHistory();
  const groupMap = new Map();
  const copies = sourceGroups.map(group => {
    const copy = JSON.parse(JSON.stringify(group));
    copy.id = organizationNewId();
    copy.name = group === source ? organizationName(group.name + " copy", "Group copy") : group.name;
    groupMap.set(group.id, copy.id);
    return copy;
  });
  for (let index = 0; index < copies.length; index++){
    const original = sourceGroups[index], copy = copies[index];
    if (original.parentGroupId && groupMap.has(original.parentGroupId))
      copy.parentGroupId = groupMap.get(original.parentGroupId);
    else if (original === source && source.parentGroupId) copy.parentGroupId = source.parentGroupId;
  }
  const payload = cloneSelectionPayload(sourceNodes.map(node => node.id));
  const result = pastePayload(payload, 36, false);
  for (let index = 0; index < sourceNodes.length; index++){
    const original = sourceNodes[index], copy = nodeById(result.nodeIds[index]);
    if (copy && original.groupId && groupMap.has(original.groupId)){
      copy.groupId = groupMap.get(original.groupId);
      delete copy.layerId;
    }
  }
  state.organization.groups.push(...copies);
  const rootCopy = copies[0];
  organizationExpanded.add(rootCopy.id);
  organizationExplorerTarget = {kind:"group", id:rootCopy.id};
  setSelection("node", result.nodeIds);
  render();
  scheduleOrganizationExplorerRender(true);
  return rootCopy;
}
function organizationReorderGroup(groupId, toFront){
  const group = organizationGroupById(groupId);
  const members = organizationGroupMemberNodes(groupId, true);
  if (!group || !members.length) return false;
  if (organizationObjectLocked(group) || members.some(organizationObjectLocked)){
    announce("Unlock this group before changing its order.");
    return false;
  }
  pushHistory();
  const ids = new Set(members.map(node => node.id));
  const rest = state.nodes.filter(node => !ids.has(node.id));
  const ordered = state.nodes.filter(node => ids.has(node.id));
  state.nodes = toFront ? [...rest, ...ordered] : [...ordered, ...rest];
  render();
  scheduleOrganizationExplorerRender();
  return true;
}
function organizationSetHidden(target, hidden){
  if (!target) return false;
  pushHistory();
  if (hidden === true) target.hidden = true; else delete target.hidden;
  render();
  scheduleOrganizationExplorerRender();
  return true;
}
function organizationSetLocked(target, locked){
  if (!target) return false;
  pushHistory();
  if (locked === true) target.locked = true; else delete target.locked;
  render();
  scheduleOrganizationExplorerRender();
  return true;
}
function organizationShowAll(){
  const targets = [...state.nodes, ...state.edges, ...organizationLayers(), ...organizationGroups()];
  if (!organizationIsolation && targets.every(target => target.hidden !== true)) return false;
  pushHistory();
  for (const target of targets) delete target.hidden;
  organizationIsolation = null;
  render();
  scheduleOrganizationExplorerRender();
  announce("All objects are visible");
  return true;
}
function organizationRevealSelection(){
  const targets = [...selectedNodes(), ...selectionIds("edge").map(edgeById).filter(Boolean)];
  if (!targets.length && organizationExplorerTarget){
    const target = organizationResolveTarget(organizationExplorerTarget);
    if (target) targets.push(target);
  }
  if (!targets.length){ announce("Select an object to reveal."); return false; }
  pushHistory();
  organizationIsolation = null;
  for (const target of targets){
    delete target.hidden;
    const layer = organizationObjectLayer(target);
    delete layer.hidden;
    for (const group of organizationObjectGroupChain(target)) delete group.hidden;
    if (state.nodes.includes(target))
      for (const container of organizationSpatialAncestors(target)) delete container.hidden;
  }
  render();
  scheduleOrganizationExplorerRender();
  announce("Selection revealed");
  return true;
}
function organizationIsolateCurrent(){
  const target = organizationExplorerTarget ||
    (singleSelectedNode() ? {kind:"node", id:singleSelectedNode().id} : null);
  if (!target){ announce("Choose a layer, group, or object in the explorer first."); return false; }
  organizationIsolation = organizationIsolation &&
    organizationIsolation.kind === target.kind && organizationIsolation.id === target.id ? null : {...target};
  render();
  scheduleOrganizationExplorerRender();
  announce(organizationIsolation ? "Isolation enabled" : "Isolation cleared");
  return true;
}
function organizationResolveTarget(target){
  if (!target) return null;
  if (target.pageId && target.pageId !== state.activePageId &&
      typeof pagesPageById === "function"){
    const page = pagesPageById(target.pageId);
    if (!page) return null;
    if (target.kind === "layer") return (page.organization?.layers || []).find(item => item.id === target.id) || null;
    if (target.kind === "group") return (page.organization?.groups || []).find(item => item.id === target.id) || null;
    if (target.kind === "node") return (page.nodes || []).find(item => item.id === target.id) || null;
    if (target.kind === "edge") return (page.edges || []).find(item => item.id === target.id) || null;
    if (target.kind === "page") return page;
  }
  if (target.kind === "layer") return organizationLayerById(target.id);
  if (target.kind === "group") return organizationGroupById(target.id);
  if (target.kind === "node") return nodeById(target.id);
  if (target.kind === "edge") return edgeById(target.id);
  if (target.kind === "page")
    return typeof pagesPageById === "function" ? pagesPageById(target.id) || state.organization.page
      : state.organization.page;
  return null;
}
function organizationTargetLabel(target){
  const object = organizationResolveTarget(target);
  if (!object) return "";
  if (target.kind === "edge"){
    const from = nodeById(object.from), to = nodeById(object.to);
    return object.label || `${from ? from.title : object.from} → ${to ? to.title : object.to}`;
  }
  return object.name || object.title || object.id;
}

/* ------------------------- Explorer tree ------------------------- */

function organizationNodeParentContainer(node, candidates){
  if (!node || node.groupId) return null;
  const center = nodeCenterForContainment(node);
  return candidates.filter(container => container.id !== node.id).filter(container => {
    const outer = containmentRect(container);
    if (isStructuralNode(node)){
      const inner = containmentRect(node);
      if (outer.w * outer.h <= inner.w * inner.h) return false;
    }
    return center.x >= outer.x && center.x <= outer.x + outer.w &&
           center.y >= outer.y && center.y <= outer.y + outer.h;
  }).sort((a, b) => {
    const ar = containmentRect(a), br = containmentRect(b);
    return ar.w * ar.h - br.w * br.h;
  })[0] || null;
}
function organizationRow(kind, id, label, depth, parentKey, opts = {}){
  const key = `${kind}:${id}`;
  return {kind, id, key, label, depth, parentKey, ...opts};
}
function organizationCurrentPageRows(){
  ensureOrganization();
  const rows = [];
  const page = state.organization.page;
  rows.push(organizationRow("page", page.id, page.name, 0, null, {expandable:true}));
  if (!organizationExpanded.has(page.id)) return rows;
  for (const layer of organizationLayers()){
    const layerKey = `layer:${layer.id}`;
    rows.push(organizationRow("layer", layer.id, layer.name, 1, `page:${page.id}`, {
      expandable:true, active:state.organization.activeLayerId === layer.id
    }));
    if (!organizationExpanded.has(layer.id)) continue;
    const groups = organizationGroups().filter(group => organizationGroupLayerId(group) === layer.id);
    const rootGroups = groups.filter(group => !group.parentGroupId);
    const layerNodes = state.nodes.filter(node => organizationObjectLayerId(node) === layer.id);
    const structural = layerNodes.filter(node => isStructuralNode(node) && !node.groupId);
    const parentMap = new Map(layerNodes.filter(node => !node.groupId)
      .map(node => [node.id, organizationNodeParentContainer(node, structural)?.id || null]));
    const childrenByContainer = new Map();
    for (const node of layerNodes.filter(node => !node.groupId)){
      const parent = parentMap.get(node.id);
      if (!childrenByContainer.has(parent)) childrenByContainer.set(parent, []);
      childrenByContainer.get(parent).push(node);
    }
    const appendNode = (node, depth, parentKey) => {
      const children = childrenByContainer.get(node.id) || [];
      rows.push(organizationRow("node", node.id, node.title || node.id, depth, parentKey, {
        type:node.type, expandable:children.length > 0
      }));
      if (children.length && organizationExpanded.has(node.id))
        for (const child of children) appendNode(child, depth + 1, `node:${node.id}`);
    };
    const appendGroup = (group, depth, parentKey) => {
      const childGroups = groups.filter(candidate => candidate.parentGroupId === group.id);
      const members = state.nodes.filter(node => node.groupId === group.id);
      rows.push(organizationRow("group", group.id, group.name, depth, parentKey, {
        expandable:childGroups.length + members.length > 0
      }));
      if (!organizationExpanded.has(group.id)) return;
      for (const child of childGroups) appendGroup(child, depth + 1, `group:${group.id}`);
      for (const node of members)
        rows.push(organizationRow("node", node.id, node.title || node.id, depth + 1,
          `group:${group.id}`, {type:node.type}));
    };
    for (const group of rootGroups) appendGroup(group, 2, layerKey);
    for (const node of childrenByContainer.get(null) || []) appendNode(node, 2, layerKey);
    const edges = state.edges.filter(edge => organizationObjectLayerId(edge) === layer.id);
    rows.push(organizationRow("relationships", layer.id, `Relationships (${edges.length})`, 2,
      layerKey, {expandable:edges.length > 0}));
    if (organizationExpanded.has(`relationships:${layer.id}`)){
      for (const edge of edges){
        const from = nodeById(edge.from), to = nodeById(edge.to);
        rows.push(organizationRow("edge", edge.id,
          edge.label || `${from ? from.title : edge.from} → ${to ? to.title : edge.to}`,
          3, `relationships:${layer.id}`, {type:"edge"}));
      }
    }
  }
  return rows;
}
function organizationAllRows(){
  if (typeof pagesOrdered !== "function") return organizationCurrentPageRows();
  const rows = [];
  for (const page of pagesOrdered()){
    const pageKey = `page:${page.id}`;
    rows.push(organizationRow("page",page.id,page.name,0,null,{
      key:pageKey,pageId:page.id,expandable:true,
      active:page.id === state.activePageId
    }));
    if (!organizationExpanded.has(page.id)) continue;
    if (page.id === state.activePageId){
      for (const row of organizationCurrentPageRows().slice(1)){
        const oldParent = row.parentKey;
        rows.push({
          ...row,
          pageId:page.id,
          parentKey:oldParent && oldParent.startsWith("page:") ? pageKey
            : oldParent || pageKey
        });
      }
      continue;
    }
    const organization = page.organization || {};
    for (const layer of organization.layers || []){
      const layerKey=`${page.id}|layer:${layer.id}`;
      const objects=(page.nodes||[]).filter(node => (node.layerId || ORGANIZATION_LAYER_ID) === layer.id);
      const edges=(page.edges||[]).filter(edge => (edge.layerId || ORGANIZATION_LAYER_ID) === layer.id);
      rows.push(organizationRow("layer",layer.id,layer.name,1,pageKey,{
        key:layerKey,pageId:page.id,expandable:objects.length+edges.length>0,
        expandKey:`${page.id}|layer:${layer.id}`
      }));
      if(!organizationExpanded.has(`${page.id}|layer:${layer.id}`))continue;
      for(const node of objects)
        rows.push(organizationRow("node",node.id,node.title||node.id,2,layerKey,{
          key:`${page.id}|node:${node.id}`,pageId:page.id,type:node.type
        }));
      if(edges.length){
        const relationKey=`${page.id}|relationships:${layer.id}`;
        rows.push(organizationRow("relationships",layer.id,`Relationships (${edges.length})`,2,layerKey,{
          key:relationKey,pageId:page.id,expandable:true,expandKey:relationKey
        }));
        if(organizationExpanded.has(relationKey)){
          const byId=new Map((page.nodes||[]).map(node=>[node.id,node]));
          for(const edge of edges){
            const from=byId.get(edge.from),to=byId.get(edge.to);
            rows.push(organizationRow("edge",edge.id,
              edge.label||`${from?.title||edge.from} → ${to?.title||edge.to}`,3,relationKey,{
                key:`${page.id}|edge:${edge.id}`,pageId:page.id,type:"edge"
              }));
          }
        }
      }
    }
  }
  const modelOnly=typeof pagesCanonicalObjectsWithNoAppearances==="function"
    ? pagesCanonicalObjectsWithNoAppearances() : [];
  if(modelOnly.length){
    const key="model-only";
    rows.push(organizationRow("model","model-only",`Model only (${modelOnly.length})`,0,null,{
      key,expandable:true,expandKey:key
    }));
    if(organizationExpanded.has(key))
      for(const object of modelOnly)
        rows.push(organizationRow("semantic",object.id,object.title||object.id,1,key,{
          key:`semantic:${object.id}`,type:object.type||"concept"
        }));
  }
  return rows;
}
function organizationFilteredRows(rows, query){
  const value = String(query || "").trim().toLowerCase();
  if (!value) return rows;
  const matches = new Set();
  const byKey = new Map(rows.map(row => [row.key, row]));
  const structural = state.nodes.filter(isStructuralNode);
  const nodeObjects = new Set(state.nodes);
  const nodesById = new Map(state.nodes.map(node => [node.id, node]));
  const edgesById = new Map(state.edges.map(edge => [edge.id, edge]));
  const resolveRow = row => row.kind === "node" ? nodesById.get(row.id)
    : row.kind === "edge" ? edgesById.get(row.id)
    : organizationResolveTarget(row);
  const filterState = object => {
    if (!object) return {hidden:false, locked:false, layer:""};
    const groupChain = organizationObjectGroupChain(object);
    const layer = organizationObjectLayer(object);
    let hidden = object.hidden === true || groupChain.some(group => group.hidden === true) ||
      layer.hidden === true || !organizationIsolationIncludes(object);
    let locked = object.locked === true || organizationSourceLocked(object) ||
      groupChain.some(group => group.locked === true) || layer.locked === true;
    if (nodeObjects.has(object) && structural.length){
      const center = nodeCenterForContainment(object);
      for (const container of structural){
        if (container.id === object.id) continue;
        const outer = containmentRect(container);
        if (center.x < outer.x || center.x > outer.x + outer.w ||
            center.y < outer.y || center.y > outer.y + outer.h) continue;
        const containerGroups = organizationObjectGroupChain(container);
        const containerLayer = organizationObjectLayer(container);
        hidden ||= container.hidden === true || containerGroups.some(group => group.hidden === true) ||
          containerLayer.hidden === true;
        locked ||= container.locked === true || organizationSourceLocked(container) ||
          containerGroups.some(group => group.locked === true) || containerLayer.locked === true;
      }
    }
    return {hidden, locked, layer:layer.name};
  };
  for (const row of rows){
    const object = resolveRow(row);
    const effective = filterState(object);
    const states = object ? [
      organizationDirectHidden(object) ? "hidden" : "visible",
      organizationDirectLocked(object) ? "locked" : "unlocked",
      effective.hidden ? "effective hidden" : "effective visible",
      effective.locked ? "effective locked" : "effective unlocked",
      effective.layer
    ] : [];
    const properties = object ? Object.entries(object)
      .map(([key, property]) => `${key} ${Array.isArray(property) ? property.length : String(property)}`)
      .join(" ") : "";
    const haystack = [row.label, row.kind, row.type, ...states, properties].join(" ").toLowerCase();
    if (!haystack.includes(value)) continue;
    let cursor = row;
    while (cursor){
      matches.add(cursor.key);
      cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : null;
    }
  }
  return rows.filter(row => matches.has(row.key));
}
function organizationRowObject(row){
  return organizationResolveTarget(row);
}
function organizationRowSelected(row){
  if (row.kind === "node") return isSelected("node", row.id);
  if (row.kind === "edge") return isSelected("edge", row.id);
  return organizationExplorerTarget &&
    organizationExplorerTarget.kind === row.kind && organizationExplorerTarget.id === row.id;
}
function organizationRowExpandableKey(row){
  return row.expandKey || (row.kind === "relationships" ? `relationships:${row.id}` : row.id);
}
function organizationToggleExpanded(row, force){
  if (!row.expandable) return;
  const key = organizationRowExpandableKey(row);
  const expand = force == null ? !organizationExpanded.has(key) : !!force;
  if (expand) organizationExpanded.add(key); else organizationExpanded.delete(key);
  renderOrganizationExplorer(true);
}
function organizationSelectRow(row, opts = {}){
  if (row.pageId && row.pageId !== state.activePageId && typeof pagesSwitch === "function")
    pagesSwitch(row.pageId);
  organizationExplorerTarget = {kind:row.kind, id:row.id, pageId:row.pageId || state.activePageId};
  if (row.kind === "node"){
    if (opts.toggle) toggleNodeSelection(row.id); else setSelection("node", row.id);
  } else if (row.kind === "edge"){
    setSelection("edge", row.id);
  } else if (row.kind === "group"){
    const ids = organizationGroupMemberNodes(row.id, true).map(node => node.id);
    setSelection("node", ids);
  } else if (row.kind === "layer"){
    state.organization.activeLayerId = row.id;
    clearSelection();
    announce(`Active layer: ${row.label}`);
  } else if (row.kind === "page" && typeof pagesSwitch === "function"){
    pagesSwitch(row.id);
    clearSelection();
  } else if (row.kind === "semantic" && typeof pagesOpenAppearanceChooser === "function"){
    pagesOpenAppearanceChooser(row.id,[]);
    clearSelection();
  } else {
    clearSelection();
  }
  if (opts.center && row.kind === "node") centerNode(row.id);
  render();
  scheduleOrganizationExplorerRender();
}
function organizationRenameRow(row){
  const tree = document.getElementById("objectExplorerTree");
  const element = tree && [...tree.querySelectorAll("[data-organization-row]")]
    .find(candidate => candidate.dataset.organizationRow === row.key);
  const object = organizationRowObject(row);
  if (!element || !object || row.kind === "relationships" || row.kind === "edge") return false;
  const nameElement = element.querySelector(".object-explorer-name");
  const input = document.createElement("input");
  input.className = "object-explorer-rename";
  input.value = row.label;
  input.setAttribute("aria-label", `Rename ${row.kind}`);
  nameElement.replaceWith(input);
  const finish = commit => {
    if (!input.isConnected) return;
    if (commit){
      if (row.kind === "page" && typeof pagesRename === "function"){
        pagesRename(row.id,input.value);
        renderOrganizationExplorer(true);
        return;
      }
      const property = row.kind === "node" ? "title" : "name";
      const value = organizationName(input.value, row.label);
      if (value !== object[property]){
        pushHistory();
        object[property] = value;
        render();
      }
    }
    renderOrganizationExplorer(true);
  };
  input.addEventListener("keydown", event => {
    if (event.key === "Enter"){ event.preventDefault(); finish(true); }
    if (event.key === "Escape"){ event.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("pointerdown", event => event.stopPropagation());
  input.focus();
  input.select();
  return true;
}
function organizationMoveNodeBefore(node, target){
  if (!node || !target || node === target) return false;
  const from = state.nodes.indexOf(node), to = state.nodes.indexOf(target);
  if (from < 0 || to < 0) return false;
  state.nodes.splice(from, 1);
  state.nodes.splice(state.nodes.indexOf(target), 0, node);
  return true;
}
function organizationApplyDrop(source, target){
  if (!source || !target || source.key === target.key) return false;
  const sourceObject = organizationRowObject(source);
  const targetObject = organizationRowObject(target);
  if (!sourceObject || !targetObject) return false;
  if ((source.kind === "node" || source.kind === "edge") && organizationObjectLocked(sourceObject))
    return false;
  if (source.kind === "node"){
    if (target.kind === "group") return organizationSetNodeGroup(sourceObject, target.id);
    if (target.kind === "layer") return organizationSetObjectLayer(sourceObject, target.id);
    if (target.kind === "node"){
      if (isStructuralNode(targetObject) && !targetObject.groupId){
        organizationSetObjectLayer(sourceObject, organizationObjectLayerId(targetObject));
        const outer = containmentRect(targetObject);
        const own = nodeRect(sourceObject);
        const center = nodeCenterForContainment(sourceObject);
        const contained = center.x >= outer.x && center.x <= outer.x + outer.w &&
          center.y >= outer.y && center.y <= outer.y + outer.h;
        if (!contained){
          const titleInset = targetObject.type === "swimlane"
            ? Math.min(swimlaneDefaults(targetObject).titleSize, 52) + 16 : 22;
          sourceObject.x = outer.x + titleInset;
          sourceObject.y = outer.y + titleInset;
          if (sourceObject.x + own.w > outer.x + outer.w - 12)
            sourceObject.x = outer.x + Math.max(12, (outer.w - own.w) / 2);
          if (sourceObject.y + own.h > outer.y + outer.h - 12)
            sourceObject.y = outer.y + Math.max(12, (outer.h - own.h) / 2);
        }
        return true;
      }
      organizationSetObjectLayer(sourceObject, organizationObjectLayerId(targetObject));
      return organizationMoveNodeBefore(sourceObject, targetObject);
    }
  }
  if (source.kind === "edge" && target.kind === "layer")
    return organizationSetObjectLayer(sourceObject, target.id);
  if (source.kind === "group"){
    if (target.kind === "group") return organizationSetGroupParent(sourceObject, target.id);
    if (target.kind === "layer"){
      delete sourceObject.parentGroupId;
      sourceObject.layerId = target.id;
      return true;
    }
  }
  if (source.kind === "layer" && target.kind === "layer" &&
      source.id !== ORGANIZATION_LAYER_ID && target.id !== source.id){
    const layers = state.organization.layers;
    const from = layers.indexOf(sourceObject), to = layers.indexOf(targetObject);
    layers.splice(from, 1);
    layers.splice(layers.indexOf(targetObject), 0, sourceObject);
    return true;
  }
  return false;
}
function organizationDrop(source, target){
  if (!source || !target) return false;
  const wasDirty = doc.dirty;
  pushHistory();
  if (!organizationApplyDrop(source, target)){
    undoStack.pop();
    setDocDirty(wasDirty);
    syncHistoryButtons();
    announce("That organization drop is not valid.");
    return false;
  }
  render();
  scheduleOrganizationExplorerRender(true);
  announce(`Moved ${source.label} to ${target.label}`);
  return true;
}
function organizationRowElement(row, index){
  const object = organizationRowObject(row);
  const item = document.createElement("div");
  item.className = "object-explorer-row";
  item.style.top = `${index * ORGANIZATION_ROW_HEIGHT}px`;
  item.style.paddingLeft = `${6 + row.depth * 16}px`;
  item.dataset.organizationRow = row.key;
  item.dataset.organizationIndex = String(index);
  item.setAttribute("role", "treeitem");
  item.setAttribute("aria-level", String(row.depth + 1));
  item.setAttribute("aria-selected", String(organizationRowSelected(row)));
  item.setAttribute("tabindex", index === organizationFocusedIndex ? "0" : "-1");
  item.draggable = ["layer","group","node","edge"].includes(row.kind);
  if (row.expandable)
    item.setAttribute("aria-expanded", String(organizationExpanded.has(organizationRowExpandableKey(row))));
  if (object && organizationObjectHidden(object)) item.classList.add("effective-hidden");
  if (object && organizationObjectLocked(object)) item.classList.add("effective-locked");

  const disclosure = document.createElement("button");
  disclosure.type = "button";
  disclosure.className = "object-explorer-disclosure" + (row.expandable ? "" : " placeholder");
  disclosure.tabIndex = -1;
  disclosure.textContent = row.expandable &&
    organizationExpanded.has(organizationRowExpandableKey(row)) ? "⌄" : "›";
  disclosure.setAttribute("aria-label", `${organizationExpanded.has(organizationRowExpandableKey(row)) ? "Collapse" : "Expand"} ${row.label}`);
  disclosure.addEventListener("click", event => {
    event.stopPropagation();
    organizationToggleExpanded(row);
  });
  const icon = document.createElement("span");
  icon.className = "object-explorer-type";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = ORGANIZATION_ICONS[row.type || row.kind] || "•";
  const name = document.createElement("span");
  name.className = "object-explorer-name";
  name.textContent = row.label;
  if (row.active){
    const active = document.createElement("small");
    active.textContent = "ACTIVE";
    name.appendChild(active);
  }
  item.append(disclosure, icon, name);

  if (object && !["page","relationships"].includes(row.kind)){
    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "object-explorer-toggle";
    visibility.tabIndex = -1;
    visibility.textContent = organizationDirectHidden(object) ? "◌" : "◉";
    visibility.setAttribute("aria-label", `${organizationDirectHidden(object) ? "Show" : "Hide"} ${row.label}`);
    visibility.setAttribute("aria-pressed", String(organizationDirectHidden(object)));
    visibility.addEventListener("click", event => {
      event.stopPropagation();
      organizationSetHidden(object, !organizationDirectHidden(object));
    });
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "object-explorer-toggle";
    lock.tabIndex = -1;
    lock.textContent = organizationDirectLocked(object) ? "▣" : "▢";
    lock.setAttribute("aria-label", `${organizationDirectLocked(object) ? "Unlock" : "Lock"} ${row.label}`);
    lock.setAttribute("aria-pressed", String(organizationDirectLocked(object)));
    lock.addEventListener("click", event => {
      event.stopPropagation();
      organizationSetLocked(object, !organizationDirectLocked(object));
    });
    item.append(visibility, lock);
  }
  item.addEventListener("focus", () => { organizationFocusedIndex = index; });
  item.addEventListener("click", event => {
    organizationFocusedIndex = index;
    organizationSelectRow(row, {
      toggle:event.shiftKey, center:event.detail > 1
    });
  });
  item.addEventListener("dblclick", event => {
    event.preventDefault();
    if (row.expandable) organizationToggleExpanded(row, true);
    if (row.kind === "node") centerNode(row.id);
    else organizationRenameRow(row);
  });
  item.addEventListener("dragstart", event => {
    organizationDrag = row;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.key);
  });
  item.addEventListener("dragover", event => {
    if (!organizationDrag) return;
    event.preventDefault();
    item.classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
  });
  item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
  item.addEventListener("drop", event => {
    event.preventDefault();
    item.classList.remove("drag-over");
    organizationDrop(organizationDrag, row);
    organizationDrag = null;
  });
  item.addEventListener("dragend", () => { organizationDrag = null; });
  return item;
}
function renderOrganizationProperties(){
  const panel = document.getElementById("objectExplorerProperties");
  if (!panel) return;
  panel.innerHTML = "";
  const target = organizationExplorerTarget;
  const object = organizationResolveTarget(target);
  if (!target || !object || target.kind === "page" || target.kind === "relationships") return;
  const heading = document.createElement("h3");
  heading.textContent = `${target.kind[0].toUpperCase() + target.kind.slice(1)} · ${organizationTargetLabel(target)}`;
  panel.appendChild(heading);
  const helper = (label, control) => {
    const row = document.createElement("div");
    row.className = "frow";
    const caption = document.createElement("label");
    caption.textContent = label;
    row.append(caption, control);
    panel.appendChild(row);
  };
  if (target.kind === "layer"){
    const opacity = document.createElement("input");
    opacity.type = "range"; opacity.min = "10"; opacity.max = "100"; opacity.step = "5";
    opacity.value = String(Math.round(organizationLayerOpacity(object) * 100));
    opacity.setAttribute("aria-label", "Layer opacity");
    opacity.addEventListener("change", () => {
      pushHistory();
      const value = Number(opacity.value) / 100;
      if (value >= 1) delete object.opacity; else object.opacity = value;
      render();
      scheduleOrganizationExplorerRender();
    });
    helper(`Opacity · ${opacity.value}%`, opacity);
    const color = document.createElement("input");
    color.type = "color"; color.value = normalizeHex(object.color) || "#2456E6";
    color.setAttribute("aria-label", "Layer color");
    color.addEventListener("change", () => {
      pushHistory();
      object.color = normalizeColorValue(color.value);
      render();
      scheduleOrganizationExplorerRender();
    });
    helper("Layer color", color);
    const exportFlag = document.createElement("button");
    exportFlag.type = "button";
    exportFlag.className = "flag" + (object.export !== false ? " on" : "");
    exportFlag.textContent = object.export !== false ? "Included in export" : "Excluded from export";
    exportFlag.addEventListener("click", () => {
      pushHistory();
      if (object.export === false) delete object.export; else object.export = false;
      render();
      renderOrganizationExplorer(true);
    });
    exportFlag.dataset.orgControl = "1";
    helper("Export", exportFlag);
  }
  const actions = document.createElement("div");
  actions.className = "property-actions";
  const action = (label, fn, danger = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (danger) button.className = "dangerbtn";
    button.dataset.orgControl = "1";
    button.addEventListener("click", fn);
    actions.appendChild(button);
  };
  if (target.kind === "group"){
    action("Duplicate group", () => duplicateOrganizationGroup(target.id));
    action("Bring to front", () => organizationReorderGroup(target.id, true));
    action("Send to back", () => organizationReorderGroup(target.id, false));
    action("Ungroup", () => ungroupOrganizationGroup(target.id));
    action("Delete contents", () => {
      if (confirm(`Delete ${organizationGroupMemberNodes(target.id, true).length} grouped object(s) and their links?`))
        deleteOrganizationGroupContents(target.id);
    }, true);
  }
  if (target.kind === "layer" && target.id !== ORGANIZATION_LAYER_ID){
    action("Delete layer", () => {
      const contents = [...state.nodes, ...state.edges].filter(candidate =>
        organizationObjectLayerId(candidate) === target.id);
      if (contents.length){
        announce("Move or delete every object in this layer before deleting it.");
        return;
      }
      pushHistory();
      state.organization.groups = organizationGroups().filter(group => organizationGroupLayerId(group) !== target.id);
      state.organization.layers = organizationLayers().filter(layer => layer.id !== target.id);
      state.organization.activeLayerId = ORGANIZATION_LAYER_ID;
      organizationExplorerTarget = null;
      render();
      scheduleOrganizationExplorerRender(true);
    }, true);
  }
  if (actions.children.length) panel.appendChild(actions);
}
function renderOrganizationExplorer(force = false){
  organizationRenderPending = false;
  const explorer = document.getElementById("objectExplorer");
  const tree = document.getElementById("objectExplorerTree");
  if (!explorer || !tree || explorer.hidden) return;
  const filter = document.getElementById("objectExplorerFilter");
  organizationFlatCache = organizationFilteredRows(organizationAllRows(), filter ? filter.value : "");
  organizationFocusedIndex = Math.max(0, Math.min(organizationFocusedIndex, organizationFlatCache.length - 1));
  const totalHeight = organizationFlatCache.length * ORGANIZATION_ROW_HEIGHT;
  const viewportHeight = tree.clientHeight || 360;
  const start = Math.max(0, Math.floor(tree.scrollTop / ORGANIZATION_ROW_HEIGHT) - ORGANIZATION_OVERSCAN);
  const count = Math.ceil(viewportHeight / ORGANIZATION_ROW_HEIGHT) + ORGANIZATION_OVERSCAN * 2;
  const end = Math.min(organizationFlatCache.length, start + count);
  tree.innerHTML = "";
  if (!organizationFlatCache.length){
    const empty = document.createElement("div");
    empty.className = "object-explorer-empty";
    empty.textContent = "No objects match this filter.";
    tree.appendChild(empty);
    renderOrganizationProperties();
    return;
  }
  const spacer = document.createElement("div");
  spacer.className = "object-explorer-tree-spacer";
  spacer.style.height = `${totalHeight}px`;
  const windowElement = document.createElement("div");
  windowElement.className = "object-explorer-window";
  for (let index = start; index < end; index++) windowElement.appendChild(
    organizationRowElement(organizationFlatCache[index], index));
  spacer.appendChild(windowElement);
  tree.appendChild(spacer);
  renderOrganizationProperties();
}
function scheduleOrganizationExplorerRender(force = false){
  if (force) return renderOrganizationExplorer(true);
  if (organizationRenderPending) return;
  organizationRenderPending = true;
  requestAnimationFrame(() => renderOrganizationExplorer());
}
function organizationFocusRow(index){
  if (!organizationFlatCache.length) return;
  organizationFocusedIndex = Math.max(0, Math.min(index, organizationFlatCache.length - 1));
  const tree = document.getElementById("objectExplorerTree");
  const top = organizationFocusedIndex * ORGANIZATION_ROW_HEIGHT;
  if (top < tree.scrollTop) tree.scrollTop = top;
  else if (top + ORGANIZATION_ROW_HEIGHT > tree.scrollTop + tree.clientHeight)
    tree.scrollTop = top + ORGANIZATION_ROW_HEIGHT - tree.clientHeight;
  renderOrganizationExplorer(true);
  requestAnimationFrame(() => tree.querySelector(`[data-organization-index="${organizationFocusedIndex}"]`)?.focus());
}
function objectExplorerOpen(){
  const explorer = document.getElementById("objectExplorer");
  return !!explorer && !explorer.hidden;
}
function setObjectExplorerOpen(open, opts = {}){
  const explorer = document.getElementById("objectExplorer");
  if (!explorer) return false;
  explorer.hidden = !open;
  if (RECOVERY && opts.persist !== false){
    try { localStorage.setItem(ORGANIZATION_PREF_KEY, open ? "1" : "0"); } catch {}
  }
  if (open){
    renderOrganizationExplorer(true);
    if (opts.focus !== false) document.getElementById("objectExplorerFilter")?.focus();
  }
  if (typeof updateCommandStates === "function") updateCommandStates();
  if (opts.announce !== false) announce(open ? "Object Explorer opened" : "Object Explorer closed");
  return open;
}
function toggleObjectExplorer(){
  return setObjectExplorerOpen(!objectExplorerOpen());
}
function initializeOrganizationUi(){
  ensureOrganization();
  const explorer = document.getElementById("objectExplorer");
  const tree = document.getElementById("objectExplorerTree");
  const filter = document.getElementById("objectExplorerFilter");
  if (!explorer || !tree || !filter) return;
  const guardLockedSurface = (root, allow) => {
    for (const type of ["pointerdown","click","change","input"]){
      root.addEventListener(type, event => {
        if (!organizationSelectionLocked() || allow(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        announce("The selected object is locked.");
      }, true);
    }
  };
  if (typeof ctxMenu !== "undefined"){
    guardLockedSurface(ctxMenu, target =>
      ctxMenu.getAttribute("aria-label")?.startsWith("Canvas actions") ||
      !!target.closest('[data-ctx-group$=":organization"],[data-ctx-group$=":discover"]'));
  }
  const selectionPanel = document.getElementById("selectionMenuPanel");
  if (selectionPanel) guardLockedSurface(selectionPanel, target => {
    const commandElement = target.closest("[data-command]");
    const command = commandElement && typeof commandDefinition === "function"
      ? commandDefinition(commandElement.dataset.command) : null;
    return !!command && !command.mutatesDocument;
  });
  let open = false;
  if (RECOVERY){
    try { open = localStorage.getItem(ORGANIZATION_PREF_KEY) === "1"; } catch {}
  }
  setObjectExplorerOpen(open, {persist:false, announce:false, focus:false});
  document.getElementById("btnCloseObjectExplorer").addEventListener("click", () => setObjectExplorerOpen(false));
  document.getElementById("btnOrganizationLayer").addEventListener("click", () => createOrganizationLayer());
  document.getElementById("btnOrganizationGroup").addEventListener("click", () => createOrganizationGroupFromSelection());
  document.getElementById("btnOrganizationReveal").addEventListener("click", organizationRevealSelection);
  document.getElementById("btnOrganizationIsolate").addEventListener("click", organizationIsolateCurrent);
  document.getElementById("btnOrganizationShowAll").addEventListener("click", organizationShowAll);
  filter.addEventListener("input", () => {
    organizationFocusedIndex = 0;
    renderOrganizationExplorer(true);
  });
  tree.addEventListener("scroll", () => scheduleOrganizationExplorerRender(), {passive:true});
  tree.addEventListener("keydown", event => {
    const row = organizationFlatCache[organizationFocusedIndex];
    if (!row) return;
    if (event.key === "ArrowDown"){ event.preventDefault(); organizationFocusRow(organizationFocusedIndex + 1); }
    else if (event.key === "ArrowUp"){ event.preventDefault(); organizationFocusRow(organizationFocusedIndex - 1); }
    else if (event.key === "Home"){ event.preventDefault(); organizationFocusRow(0); }
    else if (event.key === "End"){ event.preventDefault(); organizationFocusRow(organizationFlatCache.length - 1); }
    else if (event.key === "ArrowRight"){
      event.preventDefault();
      if (row.expandable && !organizationExpanded.has(organizationRowExpandableKey(row)))
        organizationToggleExpanded(row, true);
      else organizationFocusRow(organizationFocusedIndex + 1);
    } else if (event.key === "ArrowLeft"){
      event.preventDefault();
      if (row.expandable && organizationExpanded.has(organizationRowExpandableKey(row)))
        organizationToggleExpanded(row, false);
      else if (row.parentKey){
        const index = organizationFlatCache.findIndex(candidate => candidate.key === row.parentKey);
        if (index >= 0) organizationFocusRow(index);
      }
    } else if (event.key === "Enter" || event.key === " "){
      event.preventDefault();
      organizationSelectRow(row, {toggle:event.shiftKey, center:event.key === "Enter" && row.kind === "node"});
    } else if (event.key === "F2"){
      event.preventDefault();
      organizationRenameRow(row);
    } else if (event.key === "Delete" && row.kind === "group"){
      event.preventDefault();
      ungroupOrganizationGroup(row.id);
    }
  });
}

/* ------------------ Inspector and context surfaces ------------------ */

function organizationSelectControl(options, value, onChange, ariaLabel){
  const select = document.createElement("select");
  select.setAttribute("aria-label", ariaLabel);
  for (const [id, label] of options){
    const option = document.createElement("option");
    option.value = id; option.textContent = label; option.selected = id === value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}
function renderOrganizationInspectorForObject(object){
  if (!object) return;
  inspectorSection(`${state.edges.includes(object) ? "edge" : "node"}:organization`, "Organization", () => {
    const layer = organizationObjectLayer(object);
    frow("Layer", () => organizationSelectControl(
      organizationLayers().map(candidate => [candidate.id, candidate.name]),
      layer.id,
      value => {
        if (value === layer.id && !object.groupId) return;
        pushHistory();
        organizationSetObjectLayer(object, value);
        render();
      },
      "Object layer"
    ));
    if (state.nodes.includes(object)){
      const groupOptions = [["", "No explicit group"],
        ...organizationGroups().map(group => [group.id, group.name])];
      frow("Group", () => organizationSelectControl(groupOptions, object.groupId || "", value => {
        pushHistory();
        if (value) organizationSetNodeGroup(object, value);
        else organizationSetObjectLayer(object, layer.id);
        render();
      }, "Object group"));
    }
    frow("Visibility", () => {
      const button = mkFlag(object.hidden === true ? "Hidden" : "Visible", object.hidden === true, value => {
        if (value) object.hidden = true; else delete object.hidden;
        render();
      });
      button.dataset.orgControl = "1";
      return button;
    });
    frow("Lock", () => {
      const button = mkFlag(object.locked === true ? "Locked" : "Unlocked", object.locked === true, value => {
        if (value) object.locked = true; else delete object.locked;
        render();
      });
      button.dataset.orgControl = "1";
      return button;
    });
    const stateSummary = document.createElement("div");
    stateSummary.className = "helper";
    stateSummary.textContent = `Effective state: ${organizationObjectHidden(object) ? "hidden" : "visible"} · ` +
      `${organizationObjectLocked(object) ? "locked" : "editable"} · ${Math.round(organizationLayerOpacity(object) * 100)}% opacity`;
    appendInspector(stateSummary);
  }, {open:false});
  const inspector = document.getElementById("inspector");
  if (inspector) inspector.classList.toggle("organization-locked", organizationObjectLocked(object));
}
function renderOrganizationMultiInspector(nodes){
  if (!nodes || !nodes.length) return;
  inspectorSection("multi:organization", "Organization", () => {
    const firstLayer = organizationObjectLayerId(nodes[0]);
    frow("Layer", () => organizationSelectControl(
      organizationLayers().map(layer => [layer.id, layer.name]),
      nodes.every(node => organizationObjectLayerId(node) === firstLayer) ? firstLayer : "",
      value => {
        pushHistory();
        for (const node of nodes) organizationSetObjectLayer(node, value);
        render();
      },
      "Selected objects layer"
    ));
    frow("Visibility", () => {
      const hidden = nodes.every(node => node.hidden === true);
      const button = mkFlag(hidden ? "Hidden" : "Visible", hidden, value => {
        for (const node of nodes) if (value) node.hidden = true; else delete node.hidden;
        render();
      });
      button.dataset.orgControl = "1";
      return button;
    });
    frow("Lock", () => {
      const locked = nodes.every(node => node.locked === true);
      const button = mkFlag(locked ? "Locked" : "Unlocked", locked, value => {
        for (const node of nodes) if (value) node.locked = true; else delete node.locked;
        render();
      });
      button.dataset.orgControl = "1";
      return button;
    });
  }, {open:false});
}
function applyOrganizationInspectorLockState(){
  const inspector = document.getElementById("inspector");
  if (!inspector) return;
  const object = singleSelectedNode() || singleSelectedEdge();
  const locked = !!object && organizationObjectLocked(object);
  inspector.classList.toggle("organization-locked", locked);
  for (const control of inspector.querySelectorAll(
    "#inspBody input,#inspBody textarea,#inspBody select,#inspBody button")){
    if (control.closest("[data-org-control]") || control.dataset.orgControl) continue;
    if (locked){
      control.setAttribute("aria-disabled", "true");
      control.dataset.organizationLockGuard = "true";
      control.title = "Unlock this object or its parent before editing.";
    } else if (control.dataset.organizationLockGuard === "true"){
      control.removeAttribute("aria-disabled");
      delete control.dataset.organizationLockGuard;
    }
  }
}
function buildOrganizationNodeContext(parent, node, targets){
  ctxGroup(parent, "node:organization", "Organization", panel => {
    ctxSubmenu(panel, "node:organization:layer", "Move to layer", sub => {
      for (const layer of organizationLayers())
        ctxItem(sub, (targets.every(target => organizationObjectLayerId(target) === layer.id) ? "✓ " : "") + layer.name, () => {
          if (targets.some(organizationObjectLocked)) return announce("Unlock every selected object before moving it.");
          pushHistory();
          for (const target of targets) organizationSetObjectLayer(target, layer.id);
          render();
        });
    });
    if (organizationGroups().length) ctxSubmenu(panel, "node:organization:group", "Move to group", sub => {
      ctxItem(sub, "No explicit group", () => {
        pushHistory();
        for (const target of targets) organizationSetObjectLayer(target, organizationObjectLayerId(target));
        render();
      });
      for (const group of organizationGroups())
        ctxItem(sub, (targets.every(target => target.groupId === group.id) ? "✓ " : "") + group.name, () => {
          if (targets.some(organizationObjectLocked)) return announce("Unlock every selected object before grouping it.");
          pushHistory();
          for (const target of targets) organizationSetNodeGroup(target, group.id);
          render();
        });
    });
    ctxItem(panel, node.hidden === true ? "Show directly" : "Hide", () =>
      organizationSetHidden(node, node.hidden !== true));
    ctxItem(panel, node.locked === true ? "Unlock directly" : "Lock", () =>
      organizationSetLocked(node, node.locked !== true));
    ctxItem(panel, "Reveal selection", organizationRevealSelection);
    ctxItem(panel, "Open Object Explorer", () => setObjectExplorerOpen(true));
  });
}
function buildOrganizationEdgeContext(parent, edge){
  ctxGroup(parent, "edge:organization", "Organization", panel => {
    ctxSubmenu(panel, "edge:organization:layer", "Move to layer", sub => {
      for (const layer of organizationLayers())
        ctxItem(sub, (organizationObjectLayerId(edge) === layer.id ? "✓ " : "") + layer.name, () => {
          if (!organizationCanMutateObject(edge)) return;
          pushHistory();
          organizationSetObjectLayer(edge, layer.id);
          render();
        });
    });
    ctxItem(panel, edge.hidden === true ? "Show directly" : "Hide", () =>
      organizationSetHidden(edge, edge.hidden !== true));
    ctxItem(panel, edge.locked === true ? "Unlock directly" : "Lock", () =>
      organizationSetLocked(edge, edge.locked !== true));
    ctxItem(panel, "Open Object Explorer", () => setObjectExplorerOpen(true));
  });
}
function buildOrganizationCanvasContext(parent){
  ctxGroup(parent, "canvas:organization", "Organize", panel => {
    ctxItem(panel, "Open Object Explorer", () => setObjectExplorerOpen(true));
    ctxItem(panel, "Create layer", () => createOrganizationLayer());
    ctxItem(panel, "Group selected nodes", () => createOrganizationGroupFromSelection(),
      {disabled:!selectedNodes().length});
    ctxItem(panel, "Reveal selection", organizationRevealSelection,
      {disabled:!selectedNodes().length && !selectionIds("edge").length});
    ctxItem(panel, "Show all", organizationShowAll);
  });
}

function filterOrganizationExportClone(clone){
  if (!clone || typeof clone.querySelectorAll !== "function") return clone;
  const excluded = new Set(organizationLayers()
    .filter(layer => layer.export === false)
    .map(layer => layer.id));
  if (!excluded.size) return clone;
  for (const element of clone.querySelectorAll("[data-layer-id]"))
    if (excluded.has(element.getAttribute("data-layer-id"))) element.remove();
  return clone;
}

function initializeOrganizationCommands(){
  if (typeof registerCommand !== "function") return;
  const owner = "object-organization";
  registerCommand({
    id:"toggleObjectExplorer", label:"Object Explorer", description:"Open the synchronized pages, layers, groups, objects, and links tree",
    action:toggleObjectExplorer, pressed:objectExplorerOpen, owner,
    mutatesDocument:false, scope:"application",
    ribbon:{tab:"view", group:"Workspace", priority:"normal"}
  });
  registerCommand({
    id:"groupSelection", label:"Group", description:"Create a non-rendered group from the selected nodes",
    action:createOrganizationGroupFromSelection, enabled:() => selectedNodes().length > 0 && !organizationSelectionLocked(),
    disabledReason:"Select one or more unlocked nodes.", owner,
    ribbon:{tab:"arrange", group:"Organize", priority:"normal"}
  });
  registerCommand({
    id:"createLayer", label:"New layer", description:"Create and activate a new layer",
    action:createOrganizationLayer, owner,
    ribbon:{tab:"arrange", group:"Organize", priority:"normal"}
  });
  registerCommand({
    id:"hideSelection", label:"Hide", description:"Hide the selected objects without deleting them",
    action:() => {
      const targets = [...selectedNodes(), ...selectionIds("edge").map(edgeById).filter(Boolean)];
      if (!targets.length) return false;
      pushHistory();
      for (const target of targets) target.hidden = true;
      clearSelection();
      render();
      return true;
    },
    enabled:() => selectionIds().length > 0, owner,
    ribbon:{tab:"arrange", group:"Organize", priority:"low"}
  });
  registerCommand({
    id:"lockSelection", label:"Lock", description:"Lock selected objects against canvas and property mutations",
    action:() => {
      const targets = [...selectedNodes(), ...selectionIds("edge").map(edgeById).filter(Boolean)];
      if (!targets.length) return false;
      pushHistory();
      for (const target of targets) target.locked = true;
      render();
      return true;
    },
    enabled:() => selectionIds().length > 0, owner,
    ribbon:{tab:"arrange", group:"Organize", priority:"low"}
  });
}

/* Locked objects remain selectable and inspectable. Capture-phase guards stop
   property controls; canvas movement is guarded at its mutation entry points. */
document.addEventListener("beforeinput", event => {
  if (!event.target.closest || !event.target.closest("#inspector")) return;
  if (event.target.closest("[data-org-control]")) return;
  const object = singleSelectedNode() || singleSelectedEdge();
  if (!object || !organizationObjectLocked(object)) return;
  event.preventDefault();
  announce("This object is locked.");
}, true);
document.addEventListener("click", event => {
  const target = event.target.closest && event.target.closest("#inspector button,#inspector select,#inspector input[type=checkbox]");
  if (!target || target.closest("[data-org-control]")) return;
  const object = singleSelectedNode() || singleSelectedEdge();
  if (!object || !organizationObjectLocked(object)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  announce("This object is locked.");
}, true);

ensureOrganization();
