"use strict";

/* ------------------------------------------------------------------
   Multi-page documents and "model once, view many"

   The existing renderer intentionally continues to consume state.nodes and
   state.edges.  Those arrays are the active page projection.  Inactive pages
   stay as plain model data and are never mounted into the SVG.
   ------------------------------------------------------------------ */

const PAGES_SCHEMA_VERSION = 1;
const PAGE_DEFAULT_ID = "page-default";
const PAGE_NAME_MAX = 80;
const PAGE_DESCRIPTION_MAX = 500;
const PAGE_BACKGROUND_DEFAULT = "";
const PAGE_EXPORT_DEFAULTS = Object.freeze({
  include:true, orientation:"auto", scale:1, region:"content"
});
const PAGE_CANONICAL_NODE_KEYS = Object.freeze([
  "type","title","subtitle","notes","content","status","fields","items",
  "portsEnabled","inputPorts","outputPorts","semanticTypeId","objectTypeId",
  "properties","propertyProvenance","tags","owner","description",
  "sourceAuthority","sourceReferences","provenance","validation"
]);
const PAGE_CANONICAL_EDGE_KEYS = Object.freeze([
  "kind","label","fromField","toField","fromPort","toPort","pairs",
  "semanticTypeId","relationshipTypeId","properties","propertyProvenance",
  "tags","owner","description","sourceAuthority","provenance","validation"
]);

let pagesTransitioning = false;
let pagesSyncing = false;
let pagesUiInitialized = false;
let pagesNavigationBack = [];
let pagesNavigationForward = [];
let pagesManagerSelectionId = null;
let pagesLastSyncSignature = "";

function pagesClone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function pagesName(raw, fallback = "Untitled page"){
  const value = String(raw == null ? "" : raw).replace(/\s+/g," ").trim().slice(0,PAGE_NAME_MAX);
  return value || fallback;
}
function pagesDescription(raw){
  return String(raw == null ? "" : raw).trim().slice(0,PAGE_DESCRIPTION_MAX);
}
function pagesNewId(prefix){
  return `${prefix}-${uid()}`;
}
function pagesSemanticId(instanceId){
  return `semantic-${String(instanceId || pagesNewId("object"))}`;
}
function pagesRelationshipId(edgeId){
  return `relationship-${String(edgeId || pagesNewId("edge"))}`;
}
function pagesDefaultOrganization(pageId = PAGE_DEFAULT_ID, name = "Page 1"){
  const organization = typeof defaultOrganization === "function"
    ? defaultOrganization() : {
      page:{id:pageId,name}, layers:[{id:"layer-default",name:"Default"}],
      groups:[], activeLayerId:"layer-default"
    };
  organization.page = {...(organization.page || {}),id:pageId,name};
  return organization;
}
function pagesDefaultEditing(){
  return typeof cleanEditingForDocument === "function"
    ? pagesClone(cleanEditingForDocument(undefined)) : undefined;
}
function pagesDefaultRecord(id = PAGE_DEFAULT_ID, name = "Page 1"){
  return {
    id:String(id),
    name:pagesName(name,"Page 1"),
    order:0,
    description:"",
    background:PAGE_BACKGROUND_DEFAULT,
    camera:{x:0,y:0,k:1},
    export:{...PAGE_EXPORT_DEFAULTS},
    namedLocations:[],
    nodes:[],
    edges:[],
    organization:pagesDefaultOrganization(id,name),
    editing:pagesDefaultEditing()
  };
}
function pagesPageById(id){
  return (state.pages || []).find(page => page.id === id) || null;
}
function pagesActivePage(){
  return pagesPageById(state.activePageId) || (state.pages || [])[0] || null;
}
function pagesOrdered(){
  return [...(state.pages || [])].sort((a,b) =>
    Number(a.order) - Number(b.order) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function pagesNormalizeCamera(raw){
  const camera = raw && typeof raw === "object" ? raw : {};
  const k = Number(camera.k);
  return {
    x:Number.isFinite(Number(camera.x)) ? Number(camera.x) : 0,
    y:Number.isFinite(Number(camera.y)) ? Number(camera.y) : 0,
    k:Number.isFinite(k) ? Math.max(.15,Math.min(4,k)) : 1
  };
}
function pagesNormalizeExport(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const orientation = ["auto","portrait","landscape"].includes(source.orientation)
    ? source.orientation : "auto";
  const region = ["content","viewport"].includes(source.region) ? source.region : "content";
  const scale = Number(source.scale);
  return {
    ...source,
    include:source.include !== false,
    orientation,
    scale:Number.isFinite(scale) ? Math.max(.1,Math.min(8,scale)) : 1,
    region
  };
}
function pagesNormalizeNamedLocations(raw){
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(raw) ? raw : []){
    if (!candidate || typeof candidate !== "object") continue;
    const id = String(candidate.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      ...candidate,
      id,
      name:pagesName(candidate.name,"Location"),
      camera:pagesNormalizeCamera(candidate.camera)
    });
  }
  return result;
}
function pagesNormalizePage(raw,index){
  const source = raw && typeof raw === "object" ? raw : {};
  const id = String(source.id || (index === 0 ? PAGE_DEFAULT_ID : `page-${index+1}`));
  const name = pagesName(source.name || source.title,`Page ${index+1}`);
  const rawNodes = Array.isArray(source.instances) ? source.instances
    : Array.isArray(source.nodes) ? source.nodes : [];
  const rawEdges = Array.isArray(source.edgeInstances) ? source.edgeInstances
    : Array.isArray(source.edges) ? source.edges : [];
  const page = {
    ...source,
    id,name,
    order:Number.isFinite(Number(source.order)) ? Number(source.order) : index,
    description:pagesDescription(source.description),
    background:normalizeColorValue(source.background) || "",
    camera:pagesNormalizeCamera(source.camera || source.defaultCamera),
    export:pagesNormalizeExport(source.export),
    namedLocations:pagesNormalizeNamedLocations(source.namedLocations),
    nodes:pagesClone(rawNodes),
    edges:pagesClone(rawEdges),
    organization:pagesClone(source.organization) || pagesDefaultOrganization(id,name),
    editing:pagesClone(source.editing)
  };
  delete page.instances;
  delete page.edgeInstances;
  delete page.title;
  page.organization.page = {...(page.organization.page || {}),id,name};
  for (const node of page.nodes){
    node.pageId = id;
    node.semanticId = String(node.semanticId || pagesSemanticId(node.id));
  }
  for (const edge of page.edges){
    edge.pageId = id;
    edge.relationshipId = String(edge.relationshipId || pagesRelationshipId(edge.id));
  }
  return page;
}
function pagesNormalizeRegistry(raw,key){
  const result = [];
  const seen = new Set();
  for (const candidate of Array.isArray(raw) ? raw : []){
    if (!candidate || typeof candidate !== "object") continue;
    const id = String(candidate.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(pagesClone({...candidate,id}));
  }
  result.sort((a,b) => a.id.localeCompare(b.id));
  return result;
}
function pagesPickCanonical(source,keys){
  const result = {};
  for (const key of keys){
    if (source && source[key] !== undefined) result[key] = pagesClone(source[key]);
  }
  return result;
}
function pagesCanonicalNodeFromInstance(node){
  return {
    id:String(node.semanticId || pagesSemanticId(node.id)),
    ...pagesPickCanonical(node,PAGE_CANONICAL_NODE_KEYS)
  };
}
function pagesSemanticForInstance(node){
  return (state.semanticObjects || []).find(object => object.id === node.semanticId) || null;
}
function pagesCanonicalRelationshipFromEdge(edge,nodeMap = null){
  const from = nodeMap ? nodeMap.get(edge.from) : nodeById(edge.from);
  const to = nodeMap ? nodeMap.get(edge.to) : nodeById(edge.to);
  return {
    id:String(edge.relationshipId || pagesRelationshipId(edge.id)),
    fromSemanticId:String(from && from.semanticId || edge.fromSemanticId || ""),
    toSemanticId:String(to && to.semanticId || edge.toSemanticId || ""),
    ...pagesPickCanonical(edge,PAGE_CANONICAL_EDGE_KEYS)
  };
}
function pagesRelationshipForEdge(edge){
  return (state.semanticRelationships || []).find(rel => rel.id === edge.relationshipId) || null;
}
function pagesApplySemanticToNode(node,semantic){
  if (!node || !semantic) return node;
  node.semanticId = semantic.id;
  for (const key of PAGE_CANONICAL_NODE_KEYS){
    if (semantic[key] === undefined) delete node[key];
    else node[key] = pagesClone(semantic[key]);
  }
  return node;
}
function pagesApplyRelationshipToEdge(edge,relationship){
  if (!edge || !relationship) return edge;
  edge.relationshipId = relationship.id;
  for (const key of PAGE_CANONICAL_EDGE_KEYS){
    if (relationship[key] === undefined) delete edge[key];
    else edge[key] = pagesClone(relationship[key]);
  }
  return edge;
}
function pagesRegistryMap(items){
  return new Map((items || []).map(item => [item.id,item]));
}
function pagesRefreshCanonicalFingerprints(){
  const objects = (state.semanticObjects || []).map(object => [object.id,object]);
  const relationships = (state.semanticRelationships || []).map(rel => [rel.id,rel]);
  pagesLastSyncSignature = JSON.stringify({objects,relationships});
}
function pagesPropagateSemantic(semantic,exceptInstanceId = null){
  for (const page of state.pages || []){
    for (const node of page.nodes || []){
      if (node.semanticId !== semantic.id || node.id === exceptInstanceId) continue;
      pagesApplySemanticToNode(node,semantic);
    }
  }
}
function pagesPropagateRelationship(relationship,exceptEdgeId = null){
  for (const page of state.pages || []){
    for (const edge of page.edges || []){
      if (edge.relationshipId !== relationship.id || edge.id === exceptEdgeId) continue;
      pagesApplyRelationshipToEdge(edge,relationship);
    }
  }
}
function pagesSyncActive(opts = {}){
  if (pagesSyncing || pagesTransitioning) return;
  if (!Array.isArray(state.pages) || !state.pages.length) return;
  const page = pagesActivePage();
  if (!page) return;
  pagesSyncing = true;
  try {
    page.nodes = state.nodes;
    page.edges = state.edges;
    page.organization = state.organization;
    page.editing = state.editing;
    page.camera = pagesNormalizeCamera(view);
    page.name = pagesName(page.name);
    page.organization = page.organization || pagesDefaultOrganization(page.id,page.name);
    page.organization.page = {...(page.organization.page || {}),id:page.id,name:page.name};
    const registrySignature = JSON.stringify({
      objects:(state.semanticObjects || []).map(object=>[object.id,object]),
      relationships:(state.semanticRelationships || []).map(rel=>[rel.id,rel])
    });
    if (pagesLastSyncSignature && registrySignature !== pagesLastSyncSignature){
      for (const semantic of state.semanticObjects || []) pagesPropagateSemantic(semantic);
      for (const relationship of state.semanticRelationships || []) pagesPropagateRelationship(relationship);
    }
    const semantics = pagesRegistryMap(state.semanticObjects);
    for (const node of state.nodes){
      node.pageId = page.id;
      node.semanticId = String(node.semanticId || pagesSemanticId(node.id));
      const next = pagesCanonicalNodeFromInstance(node);
      const current = semantics.get(next.id);
      if (!current){
        state.semanticObjects.push(next);
        semantics.set(next.id,next);
      } else if (JSON.stringify(current) !== JSON.stringify(next)){
        Object.keys(current).forEach(key => { if (key !== "id") delete current[key]; });
        Object.assign(current,next);
        pagesPropagateSemantic(current,node.id);
      }
    }
    const nodeMap = new Map(state.nodes.map(node => [node.id,node]));
    const relationships = pagesRegistryMap(state.semanticRelationships);
    for (const edge of state.edges){
      edge.pageId = page.id;
      edge.relationshipId = String(edge.relationshipId || pagesRelationshipId(edge.id));
      const next = pagesCanonicalRelationshipFromEdge(edge,nodeMap);
      const current = relationships.get(next.id);
      if (!current){
        state.semanticRelationships.push(next);
        relationships.set(next.id,next);
      } else if (JSON.stringify(current) !== JSON.stringify(next)){
        Object.keys(current).forEach(key => { if (key !== "id") delete current[key]; });
        Object.assign(current,next);
        pagesPropagateRelationship(current,edge.id);
      }
    }
    state.semanticObjects.sort((a,b) => a.id.localeCompare(b.id));
    state.semanticRelationships.sort((a,b) => a.id.localeCompare(b.id));
    pagesRefreshCanonicalFingerprints();
    if (opts.ui !== false) pagesRenderBar();
  } finally {
    pagesSyncing = false;
  }
}
function pagesApplyRegistriesToPage(page){
  const semantics = pagesRegistryMap(state.semanticObjects);
  const relationships = pagesRegistryMap(state.semanticRelationships);
  for (const node of page.nodes || []){
    const semantic = semantics.get(node.semanticId);
    if (semantic) pagesApplySemanticToNode(node,semantic);
  }
  for (const edge of page.edges || []){
    const relationship = relationships.get(edge.relationshipId);
    if (relationship) pagesApplyRelationshipToEdge(edge,relationship);
  }
}
function pagesBeforeRender(){
  if (!state.pages || !state.pages.length) return;
  pagesSyncActive();
}

function pagesMigrateV1(document){
  const source = pagesClone(document);
  const id = PAGE_DEFAULT_ID;
  const name = pagesName(source.organization && source.organization.page &&
    source.organization.page.name,"Page 1");
  const nodes = (source.nodes || []).map(node => ({
    ...node,
    semanticId:String(node.semanticId || pagesSemanticId(node.id)),
    pageId:id
  }));
  const nodeMap = new Map(nodes.map(node => [node.id,node]));
  const edges = (source.edges || []).map(edge => ({
    ...edge,
    relationshipId:String(edge.relationshipId || pagesRelationshipId(edge.id)),
    pageId:id
  }));
  const semanticObjects = nodes.map(pagesCanonicalNodeFromInstance);
  const semanticRelationships = edges.map(edge => pagesCanonicalRelationshipFromEdge(edge,nodeMap));
  return {
    ...source,
    version:2,
    documentId:String(source.documentId || "document-default"),
    activePageId:id,
    pageOrder:[id],
    pages:[{
      id,name,order:0,description:"",background:"",
      camera:pagesNormalizeCamera(source.camera),
      export:{...PAGE_EXPORT_DEFAULTS},
      namedLocations:[],
      instances:nodes,
      edgeInstances:edges,
      organization:source.organization || pagesDefaultOrganization(id,name),
      editing:source.editing
    }],
    semanticObjects,
    semanticRelationships,
    tombstones:Array.isArray(source.tombstones) ? source.tombstones : []
  };
}
MIGRATIONS[1] = pagesMigrateV1;

function pagesAdoptDocument(document){
  const rawPages = Array.isArray(document.pages) && document.pages.length
    ? document.pages : [pagesMigrateV1(document).pages[0]];
  state.pages = rawPages.map(pagesNormalizePage);
  /* nodes/edges remain an intentional active-page compatibility mirror in
     schema v2.  Honor edits made by older integrations that still modify
     those arrays instead of the explicit page records. */
  const mirrorPageId=String(document.activePageId||state.pages[0]?.id||"");
  const mirrorPage=state.pages.find(page=>page.id===mirrorPageId);
  if(mirrorPage&&Array.isArray(document.nodes)&&Array.isArray(document.edges)){
    const storedNodes=new Map(mirrorPage.nodes.map(node=>[node.id,node]));
    const storedEdges=new Map(mirrorPage.edges.map(edge=>[edge.id,edge]));
    mirrorPage.nodes=document.nodes.map(node=>({
      ...pagesClone(storedNodes.get(node.id)||{}),...pagesClone(node),
      pageId:mirrorPage.id,
      semanticId:String(node.semanticId||storedNodes.get(node.id)?.semanticId||pagesSemanticId(node.id))
    }));
    mirrorPage.edges=document.edges.map(edge=>({
      ...pagesClone(storedEdges.get(edge.id)||{}),...pagesClone(edge),
      pageId:mirrorPage.id,
      relationshipId:String(edge.relationshipId||storedEdges.get(edge.id)?.relationshipId||
        pagesRelationshipId(edge.id))
    }));
  }
  const pageIds = new Set(state.pages.map(page => page.id));
  const requestedOrder = Array.isArray(document.pageOrder)
    ? document.pageOrder.filter(id => pageIds.has(id)) : [];
  const missing = state.pages.map(page => page.id).filter(id => !requestedOrder.includes(id));
  const order = [...requestedOrder,...missing];
  state.pages.sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id));
  state.pages.forEach((page,index) => { page.order = index; });
  state.documentId = String(document.documentId || "document-default");
  state.semanticObjects = pagesNormalizeRegistry(document.semanticObjects);
  state.semanticRelationships = pagesNormalizeRegistry(document.semanticRelationships);
  state.tombstones = Array.isArray(document.tombstones) ? pagesClone(document.tombstones) : [];

  /* Repair registries without destroying valid imported stable IDs. */
  const semantics = pagesRegistryMap(state.semanticObjects);
  if(mirrorPage){
    for(const node of mirrorPage.nodes){
      const next=pagesCanonicalNodeFromInstance(node);
      const current=semantics.get(next.id);
      if(current)Object.assign(current,next);
    }
  }
  for (const page of state.pages){
    for (const node of page.nodes){
      if (!semantics.has(node.semanticId)){
        const semantic = pagesCanonicalNodeFromInstance(node);
        state.semanticObjects.push(semantic);
        semantics.set(semantic.id,semantic);
      }
    }
  }
  const relationships = pagesRegistryMap(state.semanticRelationships);
  if(mirrorPage){
    const nodeMap=new Map(mirrorPage.nodes.map(node=>[node.id,node]));
    for(const edge of mirrorPage.edges){
      const next=pagesCanonicalRelationshipFromEdge(edge,nodeMap);
      const current=relationships.get(next.id);
      if(current)Object.assign(current,next);
    }
  }
  for (const page of state.pages){
    const nodeMap = new Map(page.nodes.map(node => [node.id,node]));
    for (const edge of page.edges){
      if (!relationships.has(edge.relationshipId)){
        const relationship = pagesCanonicalRelationshipFromEdge(edge,nodeMap);
        state.semanticRelationships.push(relationship);
        relationships.set(relationship.id,relationship);
      }
    }
  }
  state.semanticObjects.sort((a,b) => a.id.localeCompare(b.id));
  state.semanticRelationships.sort((a,b) => a.id.localeCompare(b.id));
  const active = pageIds.has(document.activePageId)
    ? document.activePageId : state.pages[0].id;
  pagesLoadProjection(active,{restoreCamera:true,render:false});
  pagesRefreshCanonicalFingerprints();
  pagesRenderBar();
}
function pagesInitializeFromCurrent(){
  if (Array.isArray(state.pages) && state.pages.length) return pagesSyncActive();
  const name = pagesName(state.organization && state.organization.page &&
    state.organization.page.name,"Page 1");
  const page = pagesDefaultRecord(PAGE_DEFAULT_ID,name);
  page.nodes = state.nodes;
  page.edges = state.edges;
  page.organization = state.organization || pagesDefaultOrganization(page.id,name);
  page.editing = state.editing;
  page.camera = pagesNormalizeCamera(view);
  state.pages = [page];
  state.activePageId = page.id;
  state.documentId = state.documentId || "document-default";
  state.semanticObjects = [];
  state.semanticRelationships = [];
  state.tombstones = [];
  pagesSyncActive({ui:false});
  pagesRenderBar();
}
function pagesResetForNewDocument(){
  delete state.pages;
  delete state.activePageId;
  delete state.semanticObjects;
  delete state.semanticRelationships;
  delete state.tombstones;
  pagesNavigationBack = [];
  pagesNavigationForward = [];
  pagesInitializeFromCurrent();
}
function pagesLoadProjection(pageId,opts = {}){
  const page = pagesPageById(pageId);
  if (!page) return false;
  pagesTransitioning = true;
  try {
    pagesApplyRegistriesToPage(page);
    state.activePageId = page.id;
    state.nodes = page.nodes;
    state.edges = page.edges;
    state.organization = page.organization || pagesDefaultOrganization(page.id,page.name);
    state.organization.page = {...(state.organization.page || {}),id:page.id,name:page.name};
    state.editing = page.editing;
    if (typeof ensureOrganization === "function") ensureOrganization();
    state.organization.page.id = page.id;
    state.organization.page.name = page.name;
    if (typeof ensureEditingSettings === "function") ensureEditingSettings({write:false});
    page.organization = state.organization;
    page.editing = state.editing;
    if (opts.restoreCamera !== false) view = pagesNormalizeCamera(page.camera);
    if (typeof editingUpdateGridPattern === "function") editingUpdateGridPattern();
    if (opts.clearSelection !== false) clearSelection();
  } finally {
    pagesTransitioning = false;
  }
  if (opts.render !== false){
    render();
    applyView();
    pagesRenderBar();
  }
  return true;
}
function pagesCaptureNavigation(){
  return {
    pageId:state.activePageId,
    view:pagesNormalizeCamera(view),
    selection:sel ? {kind:sel.kind,ids:[...sel.ids]} : null
  };
}
function pagesRestoreNavigation(entry,opts = {}){
  if (!entry || !pagesPageById(entry.pageId)) return false;
  pagesSyncActive({ui:false});
  pagesLoadProjection(entry.pageId,{restoreCamera:false,render:false});
  view = pagesNormalizeCamera(entry.view);
  if (entry.selection) setSelection(entry.selection.kind,entry.selection.ids);
  else clearSelection();
  render();
  applyView();
  pagesRenderBar();
  if (opts.announce !== false) announce(`Returned to ${pagesActivePage().name}.`);
  return true;
}
function pagesSwitch(pageId,opts = {}){
  if (pageId === state.activePageId) return true;
  const target = pagesPageById(pageId);
  if (!target) return false;
  if (opts.recordNavigation !== false){
    pagesNavigationBack.push(pagesCaptureNavigation());
    if (pagesNavigationBack.length > 100) pagesNavigationBack.shift();
    pagesNavigationForward.length = 0;
  }
  pagesSyncActive({ui:false});
  pagesLoadProjection(pageId,{restoreCamera:opts.restoreCamera !== false});
  announce(`Opened page ${target.name}.`);
  return true;
}
function pagesNavigateBack(){
  const entry = pagesNavigationBack.pop();
  if (!entry){ announce("There is no previous page location."); return false; }
  pagesNavigationForward.push(pagesCaptureNavigation());
  return pagesRestoreNavigation(entry);
}
function pagesNavigateForward(){
  const entry = pagesNavigationForward.pop();
  if (!entry){ announce("There is no next page location."); return false; }
  pagesNavigationBack.push(pagesCaptureNavigation());
  return pagesRestoreNavigation(entry);
}
function pagesCreate(name = null,opts = {}){
  if (opts.history !== false) pushHistory();
  pagesSyncActive({ui:false});
  const id = pagesNewId("page");
  const page = pagesDefaultRecord(id,pagesName(name,`Page ${(state.pages || []).length+1}`));
  page.order = state.pages.length;
  state.pages.push(page);
  if (opts.activate !== false) pagesSwitch(id,{recordNavigation:false});
  else pagesRenderBar();
  return page;
}
function pagesRename(pageId,name,opts = {}){
  const page = pagesPageById(pageId);
  if (!page) return false;
  const next = pagesName(name,page.name);
  if (next === page.name) return false;
  if (opts.history !== false) pushHistory(`page-name:${page.id}`);
  page.name = next;
  if (page.organization && page.organization.page) page.organization.page.name = next;
  if (page.id === state.activePageId && state.organization && state.organization.page)
    state.organization.page.name = next;
  pagesRenderBar();
  const managerRow = [...(document.querySelectorAll("#pagesManagerList [data-page-id]") || [])]
    .find(row => row.dataset.pageId === page.id);
  const managerName = managerRow && managerRow.querySelector("strong");
  if (managerName) managerName.textContent = next;
  if (typeof scheduleOrganizationExplorerRender === "function") scheduleOrganizationExplorerRender();
  return true;
}
function pagesReorder(pageId,toIndex,opts = {}){
  const ordered = pagesOrdered();
  const from = ordered.findIndex(page => page.id === pageId);
  if (from < 0) return false;
  const target = Math.max(0,Math.min(ordered.length-1,Number(toIndex)));
  if (target === from) return false;
  if (opts.history !== false) pushHistory();
  const [page] = ordered.splice(from,1);
  ordered.splice(target,0,page);
  ordered.forEach((candidate,index) => { candidate.order = index; });
  state.pages = ordered;
  pagesRenderBar();
  return true;
}
function pagesCloneOrganizationForPage(organization,pageId,name){
  const next = pagesClone(organization) || pagesDefaultOrganization(pageId,name);
  next.page = {...(next.page || {}),id:pageId,name};
  return next;
}
function pagesDuplicate(pageId,mode = "reuse",opts = {}){
  const source = pagesPageById(pageId);
  if (!source) return null;
  if (opts.history !== false) pushHistory();
  pagesSyncActive({ui:false});
  const id = pagesNewId("page");
  const name = pagesName(opts.name,`${source.name} copy`);
  const nodeIdMap = new Map();
  const semanticMap = new Map();
  const relationshipMap = new Map();
  const nodes = source.nodes.map(original => {
    const node = pagesClone(original);
    nodeIdMap.set(original.id,uid());
    node.id = nodeIdMap.get(original.id);
    node.pageId = id;
    if (mode === "independent"){
      const nextSemanticId = pagesNewId("semantic");
      semanticMap.set(original.semanticId,nextSemanticId);
      node.semanticId = nextSemanticId;
      const originalSemantic = pagesSemanticForInstance(original) || pagesCanonicalNodeFromInstance(original);
      state.semanticObjects.push({...pagesClone(originalSemantic),id:nextSemanticId});
    }
    return node;
  });
  const nodeByOldId = new Map(source.nodes.map(node => [node.id,node]));
  const edges = source.edges.map(original => {
    const edge = pagesClone(original);
    edge.id = uid();
    edge.pageId = id;
    edge.from = nodeIdMap.get(original.from);
    edge.to = nodeIdMap.get(original.to);
    if (mode === "independent"){
      let nextRelationshipId = relationshipMap.get(original.relationshipId);
      if (!nextRelationshipId){
        nextRelationshipId = pagesNewId("relationship");
        relationshipMap.set(original.relationshipId,nextRelationshipId);
        const originalRelationship = pagesRelationshipForEdge(original) ||
          pagesCanonicalRelationshipFromEdge(original,nodeByOldId);
        state.semanticRelationships.push({
          ...pagesClone(originalRelationship),
          id:nextRelationshipId,
          fromSemanticId:semanticMap.get(originalRelationship.fromSemanticId) ||
            originalRelationship.fromSemanticId,
          toSemanticId:semanticMap.get(originalRelationship.toSemanticId) ||
            originalRelationship.toSemanticId
        });
      }
      edge.relationshipId = nextRelationshipId;
    }
    return edge;
  });
  const page = {
    ...pagesClone(source),
    id,name,order:state.pages.length,
    camera:pagesClone(source.camera),
    nodes,edges,
    organization:pagesCloneOrganizationForPage(source.organization,id,name)
  };
  state.pages.push(page);
  state.semanticObjects.sort((a,b) => a.id.localeCompare(b.id));
  state.semanticRelationships.sort((a,b) => a.id.localeCompare(b.id));
  if (opts.activate !== false) pagesSwitch(page.id,{recordNavigation:false});
  else pagesRenderBar();
  announce(mode === "independent"
    ? `Duplicated ${source.name} with an independent model.`
    : `Duplicated ${source.name} using the same shared objects.`);
  return page;
}
function pagesDeletePreview(pageId){
  const page = pagesPageById(pageId);
  if (!page) return null;
  const appearances = new Map();
  for (const candidate of state.pages || [])
    for (const node of candidate.nodes || [])
      appearances.set(node.semanticId,(appearances.get(node.semanticId) || 0)+1);
  const finalObjects = page.nodes.filter(node => appearances.get(node.semanticId) === 1)
    .map(node => ({id:node.semanticId,name:node.title || node.id}));
  return {
    pageId:page.id,pageName:page.name,
    instanceCount:page.nodes.length,
    edgeInstanceCount:page.edges.length,
    finalObjects,
    message:`Delete page "${page.name}"?\n\n${page.nodes.length} appearance(s) and ` +
      `${page.edges.length} link appearance(s) will be removed. ` +
      `${finalObjects.length} object(s) will become model-only and remain searchable.`
  };
}
function pagesDelete(pageId,opts = {}){
  if ((state.pages || []).length <= 1){
    if (opts.silent !== true) alert("A document must keep at least one page.");
    return false;
  }
  const preview = pagesDeletePreview(pageId);
  if (!preview) return false;
  if (opts.confirm !== false && !confirm(preview.message)) return false;
  if (opts.history !== false) pushHistory();
  const ordered = pagesOrdered();
  const index = ordered.findIndex(page => page.id === pageId);
  state.pages = state.pages.filter(page => page.id !== pageId);
  state.pages.forEach((page,i) => { page.order=i; });
  if (state.activePageId === pageId){
    const next = state.pages[Math.min(index,state.pages.length-1)] || state.pages[0];
    pagesLoadProjection(next.id);
  } else pagesRenderBar();
  announce(`Deleted page ${preview.pageName}. ${preview.finalObjects.length} object(s) are now model-only.`);
  return true;
}
function pagesAppearances(semanticId){
  const result = [];
  for (const page of pagesOrdered()){
    for (const node of page.nodes || []){
      if (node.semanticId === semanticId)
        result.push({pageId:page.id,pageName:page.name,instanceId:node.id,node});
    }
  }
  return result;
}
function pagesFindAllAppearances(nodeOrSemanticId,opts = {}){
  const semanticId = typeof nodeOrSemanticId === "string"
    ? nodeOrSemanticId : nodeOrSemanticId && nodeOrSemanticId.semanticId;
  const appearances = pagesAppearances(semanticId);
  if (opts.open !== false) pagesOpenAppearanceChooser(semanticId,appearances);
  return appearances;
}
function pagesOpenAppearanceChooser(semanticId,appearances = pagesAppearances(semanticId)){
  if (appearances.length === 1){
    pagesOpenAppearance(appearances[0]);
    return;
  }
  ensurePagesManager();
  openPagesManager();
  if (appearances.length) pagesManagerSelectionId = appearances[0].pageId;
  renderPagesManager({appearanceSemanticId:semanticId});
}
function pagesOpenAppearance(appearance){
  if (!appearance) return false;
  pagesSwitch(appearance.pageId);
  setSelection("node",appearance.instanceId);
  centerNode(appearance.instanceId);
  render();
  return true;
}
function pagesPositionForNewAppearance(page,opts = {}){
  if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) return {x:opts.x,y:opts.y};
  const count = (page.nodes || []).length;
  return {x:80+(count%5)*180,y:100+Math.floor(count/5)*100};
}
function pagesAddExistingObject(semanticId,pageId,opts = {}){
  pagesSyncActive({ui:false});
  const semantic = (state.semanticObjects || []).find(object => object.id === semanticId);
  const page = pagesPageById(pageId);
  if (!semantic || !page) return null;
  if (opts.history !== false) pushHistory();
  const source = pagesAppearances(semanticId)[0]?.node;
  const position = pagesPositionForNewAppearance(page,opts);
  const node = source ? pagesClone(source) : {type:semantic.type || "concept"};
  node.id = uid();
  node.semanticId = semantic.id;
  node.pageId = page.id;
  node.x = position.x;
  node.y = position.y;
  delete node.groupId;
  node.layerId = page.organization && page.organization.activeLayerId || "layer-default";
  pagesApplySemanticToNode(node,semantic);
  page.nodes.push(node);
  const existingBySemantic = new Map();
  for (const candidate of page.nodes)
    if (!existingBySemantic.has(candidate.semanticId)) existingBySemantic.set(candidate.semanticId,candidate);
  if (opts.addRelationships !== false){
    for (const relationship of state.semanticRelationships || []){
      if (relationship.fromSemanticId !== semanticId && relationship.toSemanticId !== semanticId) continue;
      const from = existingBySemantic.get(relationship.fromSemanticId);
      const to = existingBySemantic.get(relationship.toSemanticId);
      if (!from || !to) continue;
      if (page.edges.some(edge => edge.relationshipId === relationship.id &&
          edge.from === from.id && edge.to === to.id)) continue;
      const edge = {
        id:uid(),relationshipId:relationship.id,pageId:page.id,
        from:from.id,to:to.id
      };
      pagesApplyRelationshipToEdge(edge,relationship);
      page.edges.push(edge);
    }
  }
  if (page.id === state.activePageId){
    state.nodes = page.nodes;
    state.edges = page.edges;
    setSelection("node",node.id);
    render();
  } else pagesRenderBar();
  announce(`Added another appearance of ${semantic.title || semantic.id} to ${page.name}.`);
  return node;
}
function pagesDuplicateAppearance(nodeId,opts = {}){
  const node = nodeById(nodeId);
  if (!node) return null;
  return pagesAddExistingObject(node.semanticId,state.activePageId,{
    ...opts,x:node.x+36,y:node.y+36
  });
}
function pagesRemoveAppearance(nodeId,opts = {}){
  const node = nodeById(nodeId);
  if (!node) return false;
  if (opts.history !== false) pushHistory();
  state.edges = state.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);
  state.nodes = state.nodes.filter(candidate => candidate.id !== nodeId);
  const page = pagesActivePage();
  page.nodes = state.nodes;
  page.edges = state.edges;
  clearSelection();
  render();
  const remaining = pagesAppearances(node.semanticId).length;
  announce(`Removed ${node.title || "object"} from this page. ${remaining
    ? `${remaining} other appearance(s) remain.` : "The object is now model-only."}`);
  return true;
}
function pagesDeleteObjectPreview(semanticId){
  const semantic = (state.semanticObjects || []).find(object => object.id === semanticId);
  if (!semantic) return null;
  const appearances = pagesAppearances(semanticId);
  const relationships = (state.semanticRelationships || []).filter(rel =>
    rel.fromSemanticId === semanticId || rel.toSemanticId === semanticId);
  const edgeInstances = [];
  for (const page of state.pages || [])
    for (const edge of page.edges || [])
      if (relationships.some(rel => rel.id === edge.relationshipId))
        edgeInstances.push({pageId:page.id,edgeId:edge.id});
  return {
    semanticId,
    name:semantic.title || semantic.name || semantic.id,
    appearances,
    relationships,
    edgeInstances,
    references:[],
    message:`Delete "${semantic.title || semantic.id}" everywhere?\n\n` +
      `${appearances.length} appearance(s) across ${new Set(appearances.map(item => item.pageId)).size} page(s), ` +
      `${relationships.length} canonical relationship(s), and ${edgeInstances.length} visible link(s) will be removed. ` +
      `A tombstone will remain in document history.`
  };
}
function pagesDeleteObjectEverywhere(semanticId,opts = {}){
  const preview = pagesDeleteObjectPreview(semanticId);
  if (!preview) return false;
  if (opts.confirm !== false && !confirm(preview.message)) return false;
  if (opts.history !== false) pushHistory();
  const relationshipIds = new Set(preview.relationships.map(rel => rel.id));
  for (const page of state.pages || []){
    const removedIds = new Set(page.nodes.filter(node => node.semanticId === semanticId).map(node => node.id));
    page.nodes = page.nodes.filter(node => node.semanticId !== semanticId);
    page.edges = page.edges.filter(edge => !removedIds.has(edge.from) && !removedIds.has(edge.to) &&
      !relationshipIds.has(edge.relationshipId));
  }
  state.semanticObjects = state.semanticObjects.filter(object => object.id !== semanticId);
  state.semanticRelationships = state.semanticRelationships.filter(rel => !relationshipIds.has(rel.id));
  state.tombstones = state.tombstones || [];
  state.tombstones.push({
    id:pagesNewId("tombstone"),kind:"semantic-object",semanticId,
    name:preview.name,deletedAt:Date.now(),
    pageIds:[...new Set(preview.appearances.map(item => item.pageId))],
    relationshipIds:[...relationshipIds]
  });
  const active = pagesActivePage();
  state.nodes = active.nodes;
  state.edges = active.edges;
  clearSelection();
  render();
  announce(`Deleted ${preview.name} everywhere.`);
  return true;
}
function pagesRemoveSelectionFromPage(){
  if (!sel) return false;
  if (sel.kind === "edge"){
    pushHistory();
    const ids = new Set(selectionIds("edge"));
    state.edges = state.edges.filter(edge => !ids.has(edge.id));
    pagesActivePage().edges = state.edges;
    clearSelection();
    render();
    announce(`Removed ${ids.size} link appearance(s) from this page. Canonical relationships were kept.`);
    return true;
  }
  const ids = new Set(selectionIds("node"));
  if (!ids.size) return false;
  pushHistory();
  const removed = state.nodes.filter(node => ids.has(node.id));
  state.edges = state.edges.filter(edge => !ids.has(edge.from) && !ids.has(edge.to));
  state.nodes = state.nodes.filter(node => !ids.has(node.id));
  const page = pagesActivePage();
  page.nodes = state.nodes;
  page.edges = state.edges;
  clearSelection();
  render();
  const modelOnly = removed.filter(node => pagesAppearances(node.semanticId).length === 0).length;
  announce(`Removed ${removed.length} appearance(s) from this page.${modelOnly
    ? ` ${modelOnly} object(s) are now model-only.` : ""}`);
  return true;
}
function pagesDeleteRelationshipPreview(relationshipId){
  const relationship=(state.semanticRelationships||[]).find(item=>item.id===relationshipId);
  if(!relationship)return null;
  const appearances=[];
  for(const page of state.pages||[])
    for(const edge of page.edges||[])
      if(edge.relationshipId===relationshipId)
        appearances.push({pageId:page.id,pageName:page.name,edgeId:edge.id});
  return {
    relationship,appearances,
    message:`Delete relationship "${relationship.label||relationship.kind||relationship.id}" from the model?\n\n`+
      `${appearances.length} visible link appearance(s) across `+
      `${new Set(appearances.map(item=>item.pageId)).size} page(s) will also be removed.`
  };
}
function pagesDeleteRelationshipEverywhere(relationshipId,opts={}){
  const preview=pagesDeleteRelationshipPreview(relationshipId);
  if(!preview)return false;
  if(opts.confirm!==false&&!confirm(preview.message))return false;
  if(opts.history!==false)pushHistory();
  for(const page of state.pages||[])
    page.edges=page.edges.filter(edge=>edge.relationshipId!==relationshipId);
  state.semanticRelationships=state.semanticRelationships.filter(item=>item.id!==relationshipId);
  const active=pagesActivePage();
  state.edges=active.edges;
  clearSelection();
  render();
  announce("Deleted the relationship from the model.");
  return true;
}
function pagesDuplicateSelectionIndependent(){
  const ids = selectionIds("node");
  if (!ids.length) return false;
  const originals = new Map(state.nodes.filter(node => ids.includes(node.id)).map(node => [node.id,node]));
  pushHistory();
  const result = pastePayload(cloneSelectionPayload(ids),36,false);
  const semanticMap = new Map();
  for (const nodeId of result.nodeIds){
    const node = nodeById(nodeId);
    const sourceId = [...originals.keys()].find(id => {
      const source = originals.get(id);
      return source && source.semanticId === node.semanticId;
    });
    const oldSemanticId = node.semanticId;
    let semanticId = semanticMap.get(oldSemanticId);
    if (!semanticId){
      semanticId = pagesNewId("semantic");
      semanticMap.set(oldSemanticId,semanticId);
      const source = pagesCanonicalNodeFromInstance(node);
      state.semanticObjects.push({...pagesClone(source),id:semanticId});
    }
    node.semanticId = semanticId;
  }
  for (const edge of state.edges.filter(candidate => result.edgeIds && result.edgeIds.includes(candidate.id))){
    const old = state.semanticRelationships.find(rel => rel.id === edge.relationshipId) ||
      pagesCanonicalRelationshipFromEdge(edge);
    const id = pagesNewId("relationship");
    edge.relationshipId = id;
    state.semanticRelationships.push({
      ...pagesClone(old),id,
      fromSemanticId:nodeById(edge.from)?.semanticId || old.fromSemanticId,
      toSemanticId:nodeById(edge.to)?.semanticId || old.toSemanticId
    });
  }
  setSelection("node",result.nodeIds);
  render();
  return result;
}
function pagesPastePayload(payload,mode="reuse",opts={}){
  if(!payload||!Array.isArray(payload.nodes)||!payload.nodes.length)return false;
  if(opts.history!==false)pushHistory();
  const result=pastePayload(payload,Number.isFinite(opts.offset)?opts.offset:36,false);
  const semanticMap=new Map();
  for(const node of result.nodes){
    const oldSemanticId=node.semanticId||pagesSemanticId(node.id);
    if(mode==="reuse"){
      const canonical=(state.semanticObjects||[]).find(object=>object.id===oldSemanticId);
      node.semanticId=oldSemanticId;
      if(canonical)pagesApplySemanticToNode(node,canonical);
      else state.semanticObjects.push(pagesCanonicalNodeFromInstance(node));
    }else if(mode==="unresolved"){
      node.semanticId=oldSemanticId;
      node.unresolvedReference=true;
      node.unresolvedSourceDocumentId=payload.sourceDocumentId||"unknown";
    }else{
      let semanticId=semanticMap.get(oldSemanticId);
      if(!semanticId){
        semanticId=pagesNewId("semantic");
        semanticMap.set(oldSemanticId,semanticId);
        const source=pagesCanonicalNodeFromInstance(node);
        state.semanticObjects.push({...pagesClone(source),id:semanticId});
      }
      node.semanticId=semanticId;
      pagesApplySemanticToNode(node,state.semanticObjects.find(object=>object.id===semanticId));
    }
  }
  for(const edge of result.edges){
    const existing=(state.semanticRelationships||[]).find(rel=>rel.id===edge.relationshipId);
    if(mode==="reuse"&&existing){
      pagesApplyRelationshipToEdge(edge,existing);
      continue;
    }
    const relationshipId=mode==="reuse"&&edge.relationshipId
      ? edge.relationshipId : pagesNewId("relationship");
    edge.relationshipId=relationshipId;
    const relationship=pagesCanonicalRelationshipFromEdge(edge);
    relationship.id=relationshipId;
    relationship.fromSemanticId=nodeById(edge.from)?.semanticId||relationship.fromSemanticId;
    relationship.toSemanticId=nodeById(edge.to)?.semanticId||relationship.toSemanticId;
    if(!(state.semanticRelationships||[]).some(rel=>rel.id===relationshipId))
      state.semanticRelationships.push(relationship);
  }
  setSelection("node",result.nodeIds);
  render();
  announce(mode==="reuse"?"Pasted as shared appearances."
    : mode==="unresolved"?"Pasted as unresolved references.":"Pasted as independent objects.");
  return result;
}
function pagesConvertDuplicateToAlias(instanceId,targetSemanticId,opts = {}){
  const node = (() => {
    for (const page of state.pages || []){
      const found = page.nodes.find(candidate => candidate.id === instanceId);
      if (found) return found;
    }
    return null;
  })();
  const target = state.semanticObjects.find(object => object.id === targetSemanticId);
  if (!node || !target || node.semanticId === targetSemanticId) return false;
  const current = pagesSemanticForInstance(node);
  const conflicts = PAGE_CANONICAL_NODE_KEYS.filter(key =>
    current && target[key] !== undefined && JSON.stringify(current[key]) !== JSON.stringify(target[key]));
  if (opts.confirm !== false && conflicts.length &&
      !confirm(`Convert this duplicate into a shared appearance?\n\n${conflicts.length} shared field(s) differ: ` +
        `${conflicts.join(", ")}.\n\nThe target object's canonical values will win.`)) return false;
  if (opts.history !== false) pushHistory();
  node.semanticId = targetSemanticId;
  pagesApplySemanticToNode(node,target);
  render();
  return true;
}
function pagesSetDrilldownTarget(nodeId,pageId,opts = {}){
  const node = nodeById(nodeId);
  if (!node || (pageId && !pagesPageById(pageId))) return false;
  if (opts.history !== false) pushHistory();
  if (pageId) node.targetPageId = pageId;
  else delete node.targetPageId;
  render();
  return true;
}
function pagesOpenDrilldown(node){
  if (!node || !node.targetPageId) return false;
  const target = pagesPageById(node.targetPageId);
  if (!target) return false;
  return pagesSwitch(target.id);
}
function pagesAddNamedLocation(pageId,name,camera = view,opts = {}){
  const page = pagesPageById(pageId);
  if (!page) return null;
  if (opts.history !== false) pushHistory();
  const location = {
    id:pagesNewId("location"),name:pagesName(name,"Location"),
    camera:pagesNormalizeCamera(camera)
  };
  page.namedLocations.push(location);
  renderPagesManager();
  return location;
}
function pagesOpenNamedLocation(pageId,locationId){
  const page = pagesPageById(pageId);
  const location = page && page.namedLocations.find(item => item.id === locationId);
  if (!location) return false;
  pagesSwitch(pageId);
  view = pagesNormalizeCamera(location.camera);
  applyView();
  return true;
}
function pagesSetBackground(pageId,color,opts = {}){
  const page = pagesPageById(pageId);
  if (!page) return false;
  const next = normalizeColorValue(color) || "";
  if (page.background === next) return false;
  if (opts.history !== false) pushHistory(`page-background:${page.id}`);
  page.background = next;
  if (page.id === state.activePageId) render();
  else pagesRenderBar();
  return true;
}
function pagesBackground(page = pagesActivePage()){
  return normalizeColorValue(page && page.background) || themeColors().paper;
}
function pagesSearchScopes(){
  const active=pagesActivePage();
  if(active){
    active.nodes=state.nodes;
    active.edges=state.edges;
  }
  return pagesOrdered().map(page => ({
    pageId:page.id,pageName:page.name,nodes:page.nodes,edges:page.edges,
    organization:page.organization
  }));
}
function pagesCanonicalObjectsWithNoAppearances(){
  const visible = new Set();
  for (const page of state.pages || []) for (const node of page.nodes || []) visible.add(node.semanticId);
  return (state.semanticObjects || []).filter(object => !visible.has(object.id));
}
function pagesObjectTableRows(){
  return (state.semanticObjects || []).map(object => ({
    semantic:object,
    appearances:pagesAppearances(object.id)
  }));
}

function pagesCleanPage(page,cleanNode,cleanEdge){
  const result = {...page};
  delete result.nodes;
  delete result.edges;
  result.id = page.id;
  result.name = pagesName(page.name);
  result.order=Number(page.order)||0;
  result.description=pagesDescription(page.description);
  result.background=normalizeColorValue(page.background)||"";
  result.camera=pagesNormalizeCamera(page.id === state.activePageId ? view : page.camera);
  result.export=pagesNormalizeExport(page.export);
  result.namedLocations=pagesNormalizeNamedLocations(page.namedLocations);
  result.instances=(page.nodes||[]).map(cleanNode);
  result.edgeInstances=(page.edges||[]).map(cleanEdge);
  result.organization=typeof cleanOrganizationForDocument === "function"
    ? cleanOrganizationForDocument(page.organization) : pagesClone(page.organization);
  if (result.organization && result.organization.page)
    result.organization.page={...result.organization.page,id:page.id,name:page.name};
  result.editing=typeof cleanEditingForDocument === "function"
    ? cleanEditingForDocument(page.editing) : pagesClone(page.editing);
  return result;
}
function pagesDocumentPayload(cleanNode,cleanEdge){
  pagesSyncActive({ui:false});
  const ordered = pagesOrdered();
  return {
    documentId:String(state.documentId || "document-default"),
    activePageId:state.activePageId,
    pageOrder:ordered.map(page => page.id),
    pages:ordered.map(page => pagesCleanPage(page,cleanNode,cleanEdge)),
    semanticObjects:pagesClone(state.semanticObjects || []).sort((a,b)=>a.id.localeCompare(b.id)),
    semanticRelationships:pagesClone(state.semanticRelationships || []).sort((a,b)=>a.id.localeCompare(b.id)),
    tombstones:pagesClone(state.tombstones || [])
  };
}

function pagesExportManifest(pageIds = null){
  pagesSyncActive({ui:false});
  const include = pageIds ? new Set(pageIds) : null;
  return pagesOrdered().filter(page => (!include || include.has(page.id)) && page.export.include !== false)
    .map(page => ({
      id:page.id,name:page.name,description:page.description,background:page.background,
      orientation:page.export.orientation,scale:page.export.scale,
      nodeCount:page.nodes.length,edgeCount:page.edges.length,
      namedLocations:pagesClone(page.namedLocations)
    }));
}
function pagesSerializedSvg(pageId,asShown = true){
  const original = pagesCaptureNavigation();
  const previousTransition = pagesTransitioning;
  pagesTransitioning = true;
  try {
    pagesLoadProjection(pageId,{restoreCamera:false,clearSelection:true,render:false});
    render();
    return serializedSvg(asShown);
  } finally {
    pagesTransitioning = previousTransition;
    pagesRestoreNavigation(original,{announce:false});
  }
}
function pagesInteractiveExport(pageIds = null){
  const manifest = pagesExportManifest(pageIds);
  const svgs = {};
  for (const page of manifest) svgs[page.id]=pagesSerializedSvg(page.id,true);
  const escape = value => String(value == null ? "" : value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const navigation = manifest.map((page,index) =>
    `<button data-page="${escape(page.id)}"${index===0?' aria-current="page"':""}>${escape(page.name)}</button>`).join("");
  const sections = manifest.map((page,index) =>
    `<section id="page-${escape(page.id)}" data-page-panel="${escape(page.id)}"${index?' hidden':""}>` +
      `<h1>${escape(page.name)}</h1>${page.description?`<p>${escape(page.description)}</p>`:""}` +
      `${svgs[page.id] || "<p>Empty page</p>"}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<title>Schematic document</title><style>body{margin:0;font:14px system-ui;background:#f5f6f8;color:#16232f}` +
    `nav{position:sticky;top:0;display:flex;gap:6px;padding:10px;background:#fff;border-bottom:1px solid #dfe3e8}` +
    `button{padding:7px 10px;border:1px solid #ccd3db;border-radius:7px;background:#fff}button[aria-current]{color:#fff;background:#2456e6}` +
    `section{padding:18px}svg{display:block;max-width:100%;height:auto;margin:auto;background:#fff}</style></head><body>` +
    `<nav aria-label="Pages">${navigation}</nav><main>${sections}</main><script>` +
    `const buttons=[...document.querySelectorAll("[data-page]")],panels=[...document.querySelectorAll("[data-page-panel]")];` +
    `function openPage(id){for(const p of panels)p.hidden=p.dataset.pagePanel!==id;for(const b of buttons)` +
    `b.toggleAttribute("aria-current",b.dataset.page===id);location.hash=id}` +
    `for(const b of buttons)b.onclick=()=>openPage(b.dataset.page);` +
    `document.addEventListener("click",e=>{const link=e.target.closest("[data-target-page]");if(link){e.preventDefault();openPage(link.dataset.targetPage)}});` +
    `const initial=decodeURIComponent(location.hash.slice(1));if(buttons.some(b=>b.dataset.page===initial))openPage(initial);` +
    `</script></body></html>`;
}
function pagesDownloadInteractive(){
  const name=(doc.name||"schematic").replace(/(\.schematic)?\.json$/i,"");
  download(`${name}-interactive.html`,pagesInteractiveExport(),"text/html");
}
function pagesPerformanceBenchmark(opts = {}){
  const pageCount=Math.max(1,Number(opts.pages)||50);
  const semanticCount=Math.max(1,Number(opts.semanticObjects)||10000);
  const instanceCount=Math.max(1,Number(opts.instances)||20000);
  const relationshipCount=Math.max(0,Number(opts.relationships)||30000);
  const start=performance.now();
  const semantics=Array.from({length:semanticCount},(_,i)=>({id:`bench-semantic-${i}`,type:"concept",title:`Object ${i}`}));
  const pages=Array.from({length:pageCount},(_,i)=>pagesDefaultRecord(`bench-page-${i}`,`Page ${i+1}`));
  for(let i=0;i<instanceCount;i++){
    const semantic=semantics[i%semanticCount],page=pages[i%pageCount];
    page.nodes.push({id:`bench-node-${i}`,semanticId:semantic.id,pageId:page.id,type:"concept",
      title:semantic.title,x:(i%40)*140,y:(Math.floor(i/40)%40)*70,color:"#CFE8FF"});
  }
  const relationships=[];
  for(let i=0;i<relationshipCount;i++){
    relationships.push({id:`bench-rel-${i}`,fromSemanticId:semantics[i%semanticCount].id,
      toSemanticId:semantics[(i+1)%semanticCount].id,kind:"link",label:"References"});
  }
  const buildMs=performance.now()-start;
  const searchStart=performance.now();
  let matches=0;
  for(const semantic of semantics) if(semantic.title.includes("99")) matches++;
  const searchMs=performance.now()-searchStart;
  return {pageCount,semanticCount,instanceCount,relationshipCount,buildMs,searchMs,matches,
    inactiveCanvasesMounted:0};
}

/* ----------------------------- UI -------------------------------- */

function pagesBar(){ return document.getElementById("pageBar"); }
function pagesRenderBar(){
  const bar=pagesBar();
  if(!bar||!state.pages||!state.pages.length)return;
  const tabs=bar.querySelector("#pageTabs");
  if(!tabs)return;
  tabs.innerHTML="";
  for(const page of pagesOrdered()){
    const button=document.createElement("button");
    button.type="button";
    button.className="page-tab";
    button.setAttribute("role","tab");
    button.setAttribute("aria-selected",String(page.id===state.activePageId));
    button.setAttribute("tabindex",page.id===state.activePageId?"0":"-1");
    button.dataset.pageId=page.id;
    button.draggable=true;
    button.title=page.description||`${page.nodes.length} appearances · ${page.edges.length} links`;
    const name=document.createElement("span");
    name.textContent=page.name;
    const count=document.createElement("small");
    count.textContent=String(page.nodes.length);
    button.append(name,count);
    button.addEventListener("click",()=>pagesSwitch(page.id));
    button.addEventListener("dblclick",()=>{
      const next=prompt("Rename page",page.name);
      if(next!=null)pagesRename(page.id,next);
    });
    button.addEventListener("dragstart",event=>event.dataTransfer.setData("text/page-id",page.id));
    button.addEventListener("dragover",event=>event.preventDefault());
    button.addEventListener("drop",event=>{
      event.preventDefault();
      const source=event.dataTransfer.getData("text/page-id");
      const targetIndex=pagesOrdered().findIndex(candidate=>candidate.id===page.id);
      pagesReorder(source,targetIndex);
    });
    tabs.appendChild(button);
  }
  const active=pagesActivePage();
  const current=bar.querySelector("#pageCurrentName");
  if(current)current.textContent=active?active.name:"";
  const back=bar.querySelector("#btnPageBack"),forward=bar.querySelector("#btnPageForward");
  if(back)back.disabled=!pagesNavigationBack.length;
  if(forward)forward.disabled=!pagesNavigationForward.length;
}
function pagesKeyboardTabs(event){
  if(!event.target.closest(".page-tab"))return;
  const ordered=pagesOrdered();
  const index=ordered.findIndex(page=>page.id===event.target.dataset.pageId);
  let next=index;
  if(event.key==="ArrowRight")next=(index+1)%ordered.length;
  else if(event.key==="ArrowLeft")next=(index-1+ordered.length)%ordered.length;
  else if(event.key==="Home")next=0;
  else if(event.key==="End")next=ordered.length-1;
  else return;
  event.preventDefault();
  pagesSwitch(ordered[next].id);
  requestAnimationFrame(()=>pagesBar().querySelector(`[data-page-id="${ordered[next].id}"]`)?.focus());
}
function ensurePagesManager(){
  return document.getElementById("pagesManager");
}
function openPagesManager(){
  const modal=ensurePagesManager();
  if(!modal)return;
  pagesManagerSelectionId=pagesActivePage()?.id||pagesOrdered()[0]?.id||null;
  modal.hidden=false;
  modal.classList.add("open");
  renderPagesManager();
  requestAnimationFrame(()=>modal.querySelector("input,button")?.focus());
}
function closePagesManager(){
  const modal=ensurePagesManager();
  if(!modal)return;
  modal.classList.remove("open");
  modal.hidden=true;
}
function pagesManagerButton(label,action,opts={}){
  const button=document.createElement("button");
  button.type="button";
  button.textContent=label;
  if(opts.className)button.className=opts.className;
  if(opts.disabled)button.disabled=true;
  button.addEventListener("click",action);
  return button;
}
function pagesThumbnail(page){
  const thumb=document.createElement("span");
  thumb.className="page-thumbnail";
  thumb.style.background=pagesBackground(page);
  const sample=(page.nodes||[]).slice(0,12);
  for(const node of sample){
    const mark=document.createElement("i");
    const xs=(page.nodes||[]).map(item=>Number(item.x)||0);
    const ys=(page.nodes||[]).map(item=>Number(item.y)||0);
    const minX=Math.min(0,...xs),maxX=Math.max(1,...xs);
    const minY=Math.min(0,...ys),maxY=Math.max(1,...ys);
    mark.style.left=`${8+78*((Number(node.x)||0)-minX)/(maxX-minX||1)}%`;
    mark.style.top=`${8+72*((Number(node.y)||0)-minY)/(maxY-minY||1)}%`;
    mark.style.background=normalizeHex(node.color)||"#98A5B3";
    thumb.appendChild(mark);
  }
  return thumb;
}
function renderPagesManager(opts={}){
  const modal=ensurePagesManager();
  if(!modal||modal.hidden)return;
  pagesSyncActive({ui:false});
  const list=modal.querySelector("#pagesManagerList");
  const detail=modal.querySelector("#pagesManagerDetail");
  list.innerHTML="";
  const ordered=pagesOrdered();
  if(!pagesPageById(pagesManagerSelectionId))pagesManagerSelectionId=ordered[0]?.id;
  for(const page of ordered){
    const row=document.createElement("button");
    row.type="button";
    row.className="page-manager-row"+(page.id===pagesManagerSelectionId?" selected":"");
    row.dataset.pageId=page.id;
    if(page.id===pagesManagerSelectionId)row.setAttribute("aria-current","page");
    row.appendChild(pagesThumbnail(page));
    const copy=document.createElement("span");
    const strong=document.createElement("strong");strong.textContent=page.name;
    const small=document.createElement("small");
    const appearances=opts.appearanceSemanticId
      ? page.nodes.filter(node=>node.semanticId===opts.appearanceSemanticId).length : page.nodes.length;
    small.textContent=opts.appearanceSemanticId
      ? `${appearances} appearance${appearances===1?"":"s"}`
      : `${page.nodes.length} objects · ${page.edges.length} links`;
    copy.append(strong,small);row.append(copy);
    row.addEventListener("click",()=>{
      pagesManagerSelectionId=page.id;
      renderPagesManager(opts);
    });
    list.appendChild(row);
  }
  detail.innerHTML="";
  const page=pagesPageById(pagesManagerSelectionId);
  if(!page)return;
  if(opts.appearanceSemanticId){
    const semantic=state.semanticObjects.find(object=>object.id===opts.appearanceSemanticId);
    const heading=document.createElement("h4");
    heading.textContent=`Appearances of ${semantic?.title||semantic?.id||"object"}`;
    detail.appendChild(heading);
    const appearances=pagesAppearances(opts.appearanceSemanticId).filter(item=>item.pageId===page.id);
    if(!appearances.length){
      const empty=document.createElement("p");empty.className="helper";empty.textContent="No appearance on this page.";
      detail.appendChild(empty);
    }
    for(const appearance of appearances)
      detail.appendChild(pagesManagerButton(`Open ${appearance.node.title||appearance.instanceId}`,()=>{
        closePagesManager();pagesOpenAppearance(appearance);
      },{className:"primary"}));
    detail.appendChild(pagesManagerButton(
      appearances.length ? `Add another appearance to ${page.name}` : `Add to ${page.name}`,
      ()=>{
        const node=pagesAddExistingObject(opts.appearanceSemanticId,page.id);
        if(!node)return;
        closePagesManager();
        pagesOpenAppearance({pageId:page.id,instanceId:node.id,node});
      },
      {className:appearances.length?"":"primary"}
    ));
    return;
  }
  const heading=document.createElement("h4");heading.textContent="Page settings";detail.appendChild(heading);
  const nameLabel=document.createElement("label");nameLabel.textContent="Name";
  const name=document.createElement("input");name.value=page.name;name.maxLength=PAGE_NAME_MAX;
  // Persist as the value changes so keyboard-driven edits and automation do
  // not depend on a browser-specific blur/change sequence.
  name.addEventListener("input",()=>pagesRename(page.id,name.value));
  nameLabel.appendChild(name);detail.appendChild(nameLabel);
  const descriptionLabel=document.createElement("label");descriptionLabel.textContent="Description";
  const description=document.createElement("textarea");description.value=page.description;description.maxLength=PAGE_DESCRIPTION_MAX;
  description.addEventListener("input",()=>{
    const next=pagesDescription(description.value);
    if(next===page.description)return;
    pushHistory(`page-description:${page.id}`);page.description=next;pagesRenderBar();
  });
  descriptionLabel.appendChild(description);detail.appendChild(descriptionLabel);
  const colorLabel=document.createElement("label");colorLabel.textContent="Canvas background";
  const color=document.createElement("input");color.type="color";color.value=colorBaseHex(page.background||themeColors().paper);
  color.addEventListener("input",()=>pagesSetBackground(page.id,color.value));
  colorLabel.appendChild(color);detail.appendChild(colorLabel);
  const exportHeading=document.createElement("h4");exportHeading.textContent="Export";detail.appendChild(exportHeading);
  const include=document.createElement("label");include.className="page-check";
  const includeBox=document.createElement("input");includeBox.type="checkbox";includeBox.checked=page.export.include!==false;
  includeBox.addEventListener("change",()=>{pushHistory();page.export.include=includeBox.checked;});
  include.append(includeBox,document.createTextNode(" Include this page in all-pages export"));detail.appendChild(include);
  const orientationLabel=document.createElement("label");orientationLabel.textContent="Orientation";
  const orientation=document.createElement("select");
  for(const value of ["auto","portrait","landscape"]){
    const option=document.createElement("option");option.value=value;option.textContent=value[0].toUpperCase()+value.slice(1);
    option.selected=page.export.orientation===value;orientation.appendChild(option);
  }
  orientation.addEventListener("change",()=>{pushHistory();page.export.orientation=orientation.value;});
  orientationLabel.appendChild(orientation);detail.appendChild(orientationLabel);
  const locationsHeading=document.createElement("h4");locationsHeading.textContent="Named locations";detail.appendChild(locationsHeading);
  for(const location of page.namedLocations){
    const row=document.createElement("div");row.className="page-location-row";
    row.append(
      pagesManagerButton(location.name,()=>{closePagesManager();pagesOpenNamedLocation(page.id,location.id);}),
      pagesManagerButton("Remove",()=>{
        pushHistory();page.namedLocations=page.namedLocations.filter(item=>item.id!==location.id);renderPagesManager();
      },{className:"dangerbtn"})
    );
    detail.appendChild(row);
  }
  detail.appendChild(pagesManagerButton("+ Save current view",()=>{
    const value=prompt("Name this location",`Location ${page.namedLocations.length+1}`);
    if(value)pagesAddNamedLocation(page.id,value,page.id===state.activePageId?view:page.camera);
  }));
  const actions=document.createElement("div");actions.className="page-manager-actions";
  actions.append(
    pagesManagerButton("Open page",()=>{closePagesManager();pagesSwitch(page.id);},{className:"primary"}),
    pagesManagerButton("Duplicate view",()=>{const copy=pagesDuplicate(page.id,"reuse");pagesManagerSelectionId=copy.id;renderPagesManager();}),
    pagesManagerButton("Duplicate model",()=>{const copy=pagesDuplicate(page.id,"independent");pagesManagerSelectionId=copy.id;renderPagesManager();}),
    pagesManagerButton("Move up",()=>{pagesReorder(page.id,Math.max(0,page.order-1));renderPagesManager();},{disabled:page.order===0}),
    pagesManagerButton("Move down",()=>{pagesReorder(page.id,Math.min(ordered.length-1,page.order+1));renderPagesManager();},{disabled:page.order===ordered.length-1}),
    pagesManagerButton("Delete page",()=>{if(pagesDelete(page.id)){pagesManagerSelectionId=state.activePageId;renderPagesManager();}},
      {className:"dangerbtn",disabled:ordered.length===1})
  );
  detail.appendChild(actions);
}
function pagesChooseDestination(node,action){
  const choices=pagesOrdered().filter(page=>page.id!==state.activePageId);
  if(!choices.length){alert("Create another page first.");return;}
  const listing=choices.map((page,index)=>`${index+1}. ${page.name}`).join("\n");
  const value=prompt(`Choose a page:\n\n${listing}`,"1");
  const index=Number(value)-1;
  if(Number.isInteger(index)&&choices[index])action(choices[index]);
}
function pagesChooseAliasTarget(node){
  if(!node||!node.semanticId)return false;
  const candidates=(state.semanticObjects||[])
    .filter(object=>object.id!==node.semanticId)
    .sort((a,b)=>{
      const aMatch=a.type===node.type?0:1,bMatch=b.type===node.type?0:1;
      return aMatch-bMatch||String(a.title||"").localeCompare(String(b.title||""))||a.id.localeCompare(b.id);
    })
    .slice(0,40);
  if(!candidates.length){
    alert("There is no other shared object to use as the alias target.");
    return false;
  }
  const listing=candidates.map((object,index)=>{
    const count=pagesAppearances(object.id).length;
    return `${index+1}. ${object.title||"(untitled)"} · ${object.type||"object"} · ${count} appearance${count===1?"":"s"}`;
  }).join("\n");
  const value=prompt(
    "Convert this appearance into an alias of which shared object?\n\n" +
      "The target object's shared content wins. This appearance's geometry and local style stay unchanged.\n\n" +
      listing,
    "1"
  );
  const index=Number(value)-1;
  if(!Number.isInteger(index)||!candidates[index])return false;
  const converted=pagesConvertDuplicateToAlias(node.id,candidates[index].id);
  if(converted)announce(`Converted this appearance into an alias of ${candidates[index].title||"the selected object"}.`);
  return converted;
}
function renderPagesInspectorForObject(node){
  if(!node||!node.semanticId)return;
  const appearances=pagesAppearances(node.semanticId);
  inspectorSection("pages:identity","Object & appearance",()=>{
    const scope=document.createElement("div");scope.className="page-scope-card";
    const objectLabel=document.createElement("strong");objectLabel.textContent="Shared object";
    const objectHelp=document.createElement("span");
    objectHelp.textContent="Name, content, metadata, fields, ports, and relationship meaning update every appearance.";
    const appearanceLabel=document.createElement("strong");appearanceLabel.textContent="This appearance";
    const appearanceHelp=document.createElement("span");
    appearanceHelp.textContent="Position, size, style, visibility, container, and route stay on this page.";
    scope.append(objectLabel,objectHelp,appearanceLabel,appearanceHelp);appendInspector(scope);
    frow("Appearances",()=>{
      const button=document.createElement("button");button.type="button";
      button.textContent=`${appearances.length} page appearance${appearances.length===1?"":"s"}`;
      button.addEventListener("click",()=>pagesFindAllAppearances(node));return button;
    });
    frow("Add another view",()=>{
      const button=document.createElement("button");button.type="button";button.textContent="Choose page…";
      button.addEventListener("click",()=>pagesChooseDestination(node,page=>pagesAddExistingObject(node.semanticId,page.id)));
      return button;
    });
    frow("Detail page",()=>{
      const select=document.createElement("select");
      const none=document.createElement("option");none.value="";none.textContent="No linked page";select.appendChild(none);
      for(const page of pagesOrdered()){
        if(page.id===state.activePageId)continue;
        const option=document.createElement("option");option.value=page.id;option.textContent=page.name;
        option.selected=node.targetPageId===page.id;select.appendChild(option);
      }
      select.addEventListener("change",()=>pagesSetDrilldownTarget(node.id,select.value||null));
      return select;
    });
    const actions=document.createElement("div");actions.className="page-inspector-actions";
    actions.append(
      pagesManagerButton("Duplicate appearance",()=>pagesDuplicateAppearance(node.id)),
      pagesManagerButton("Convert duplicate to alias…",()=>pagesChooseAliasTarget(node)),
      pagesManagerButton("Remove from this page",()=>pagesRemoveAppearance(node.id),{className:"dangerbtn"}),
      pagesManagerButton("Delete object everywhere…",()=>pagesDeleteObjectEverywhere(node.semanticId),{className:"dangerbtn"})
    );
    appendInspector(actions);
  },{open:false});
}
function buildPagesNodeDropdown(panel,node,targets){
  if(!node||!node.semanticId)return;
  menuSubmenu(panel,"selection-pages","Object & pages",body=>{
    menuCommand(body,"Find all appearances",()=>pagesFindAllAppearances(node),{action:"find-appearances"});
    menuCommand(body,"Add to another page…",()=>pagesChooseDestination(node,page=>
      pagesAddExistingObject(node.semanticId,page.id)),{action:"add-appearance-page"});
    menuCommand(body,"Duplicate appearance here",()=>pagesDuplicateAppearance(node.id),
      {action:"duplicate-appearance"});
    menuCommand(body,"Duplicate as new object",()=>pagesDuplicateSelectionIndependent(),
      {action:"duplicate-independent"});
    menuCommand(body,"Convert duplicate to alias…",()=>pagesChooseAliasTarget(node),
      {action:"convert-duplicate-alias"});
    menuSeparator(body);
    menuCommand(body,targets.length>1?"Remove selected appearances":"Remove from this page",
      ()=>pagesRemoveSelectionFromPage(),{action:"remove-from-page"});
    if(targets.length===1)menuCommand(body,"Delete object everywhere…",
      ()=>pagesDeleteObjectEverywhere(node.semanticId),{action:"delete-everywhere"});
    if(node.targetPageId)menuCommand(body,`Open detail page: ${pagesPageById(node.targetPageId)?.name||"Missing page"}`,
      ()=>pagesOpenDrilldown(node),{action:"open-detail-page"});
  });
}
function buildPagesEdgeContext(panel,edge){
  if(!edge||!edge.relationshipId)return;
  ctxGroup(panel,"edge:pages","Relationship scope",body=>{
    const appearances=[];
    for(const page of state.pages||[])
      for(const candidate of page.edges||[])
        if(candidate.relationshipId===edge.relationshipId)
          appearances.push({pageName:page.name,edgeId:candidate.id});
    ctxLabel(body,`${appearances.length} link appearance${appearances.length===1?"":"s"}`);
    ctxItem(body,"Remove link from this page",()=>pagesRemoveSelectionFromPage(),
      {action:"remove-link-page"});
    ctxItem(body,"Delete relationship from model…",
      ()=>pagesDeleteRelationshipEverywhere(edge.relationshipId),
      {action:"delete-relationship-everywhere",danger:true});
  });
}
function buildPagesNodeContext(menu,node,targets){
  if(!node||!node.semanticId)return;
  ctxGroup(menu,"node:pages","Object & pages",panel=>{
    ctxItem(panel,"Find all appearances",()=>pagesFindAllAppearances(node),{action:"find-appearances"});
    ctxItem(panel,"Add to another page…",()=>pagesChooseDestination(node,page=>
      pagesAddExistingObject(node.semanticId,page.id)),{action:"add-appearance-page"});
    ctxItem(panel,"Duplicate appearance here",()=>pagesDuplicateAppearance(node.id),
      {action:"duplicate-appearance"});
    ctxItem(panel,"Duplicate as new object",()=>pagesDuplicateSelectionIndependent(),
      {action:"duplicate-independent"});
    ctxSep(panel);
    ctxItem(panel,targets.length>1?"Remove selected appearances":"Remove from this page",
      ()=>pagesRemoveSelectionFromPage(),{action:"remove-from-page",danger:true});
    if(targets.length===1)ctxItem(panel,"Delete object everywhere…",
      ()=>pagesDeleteObjectEverywhere(node.semanticId),{action:"delete-everywhere",danger:true});
    if(node.targetPageId)ctxItem(panel,`Open detail page: ${pagesPageById(node.targetPageId)?.name||"Missing page"}`,
      ()=>pagesOpenDrilldown(node),{action:"open-detail-page"});
  });
}
function buildPagesCanvasContext(menu){
  ctxGroup(menu,"canvas:pages","Pages",panel=>{
    ctxItem(panel,"New page",()=>pagesCreate(),{action:"new-page"});
    ctxItem(panel,"Manage pages…",openPagesManager,{action:"manage-pages"});
    ctxItem(panel,"Back",pagesNavigateBack,{action:"page-back",disabled:!pagesNavigationBack.length});
    ctxItem(panel,"Forward",pagesNavigateForward,{action:"page-forward",disabled:!pagesNavigationForward.length});
    ctxItem(panel,"Export interactive document",pagesDownloadInteractive,{action:"export-pages"});
  });
}
function initializePagesCommands(){
  if(typeof registerCommand!=="function")return;
  const commands=[
    {id:"pageNew",label:"New page",description:"Add a page to this document",action:()=>pagesCreate(),
      icon:"lucide:file-plus-2",scope:"document",mutatesDocument:true},
    {id:"pageManager",label:"Pages",description:"Manage, reorder, duplicate, and describe pages",
      action:openPagesManager,icon:"lucide:panels-top-left",scope:"document-read"},
    {id:"pageBack",label:"Page back",description:"Return to the previous page, camera, and selection",
      action:pagesNavigateBack,enabled:()=>pagesNavigationBack.length>0,icon:"lucide:arrow-left",scope:"application"},
    {id:"pageForward",label:"Page forward",description:"Go forward to the next page location",
      action:pagesNavigateForward,enabled:()=>pagesNavigationForward.length>0,icon:"lucide:arrow-right",scope:"application"},
    {id:"pageDuplicateReuse",label:"Duplicate page — reuse objects",
      description:"Create a page with new appearances of the same shared objects",
      action:()=>pagesDuplicate(state.activePageId,"reuse"),icon:"lucide:copy",scope:"document",mutatesDocument:true},
    {id:"pageDuplicateIndependent",label:"Duplicate page — independent model",
      description:"Create a page and a fully independent semantic subgraph",
      action:()=>pagesDuplicate(state.activePageId,"independent"),icon:"lucide:copy-plus",scope:"document",mutatesDocument:true},
    {id:"findAppearances",label:"Find all appearances",description:"Show every page containing the selected object",
      action:()=>{const node=singleSelectedNode();if(node)pagesFindAllAppearances(node);},
      enabled:()=>!!singleSelectedNode(),icon:"lucide:scan-search",scope:"document-read"},
    {id:"removeFromPage",label:"Remove from this page",
      description:"Remove selected appearances without deleting shared objects or relationships",
      action:pagesRemoveSelectionFromPage,enabled:()=>!!sel,icon:"lucide:panel-top-close",scope:"selection",mutatesDocument:true},
    {id:"exportInteractivePages",label:"Interactive document",
      description:"Export every included page with working page navigation",
      action:pagesDownloadInteractive,icon:"lucide:panels-top-left",scope:"document-read"}
  ];
  for(const command of commands)registerCommand(command,{owner:"pages"});
}
function initializePagesUi(){
  if(pagesUiInitialized)return;
  pagesUiInitialized=true;
  const bar=pagesBar();
  bar?.querySelector("#pageTabs")?.addEventListener("keydown",pagesKeyboardTabs);
  bar?.querySelector("#btnPageBack")?.addEventListener("click",pagesNavigateBack);
  bar?.querySelector("#btnPageForward")?.addEventListener("click",pagesNavigateForward);
  bar?.querySelector("#btnPageAdd")?.addEventListener("click",()=>pagesCreate());
  bar?.querySelector("#btnPageManager")?.addEventListener("click",openPagesManager);
  const modal=ensurePagesManager();
  modal?.querySelector("#btnClosePagesManager")?.addEventListener("click",closePagesManager);
  modal?.querySelector("#btnPagesAdd")?.addEventListener("click",()=>{
    const page=pagesCreate();pagesManagerSelectionId=page.id;renderPagesManager();
  });
  modal?.querySelector("#btnPagesExport")?.addEventListener("click",pagesDownloadInteractive);
  modal?.addEventListener("click",event=>{if(event.target===modal)closePagesManager();});
  const openPageLink = event => {
    const nodeElement=event.target.closest("[data-page-link]");
    if(!nodeElement)return false;
    event.preventDefault();event.stopPropagation();
    pagesOpenDrilldown(nodeById(nodeElement.getAttribute("data-page-link")));
    return true;
  };
  board.addEventListener("click",openPageLink);
  board.addEventListener("keydown",event=>{
    if(event.key!=="Enter"&&event.key!==" ")return;
    openPageLink(event);
  });
  pagesRenderBar();
}
