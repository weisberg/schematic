"use strict";

/* ------------------------------------------------------------------
   Model-backed search and discovery (issue #80)

   Search records are built from document data rather than rendered SVG.
   Each owner keeps a content signature, so unchanged nodes and edges retain
   their indexed records while changed or deleted owners are updated
   atomically. The structured query object is intentionally independent from
   the panel so future saved views and object tables can reuse it.
   ------------------------------------------------------------------ */

const SEARCH_RECENT_KEY = "schematic.recentSearches";
const SEARCH_RECENT_LIMIT = 10;
const SEARCH_RENDER_WINDOW = 180;
const SEARCH_DEBOUNCE_MS = 90;
const SEARCH_PAGE_LABEL = "Current canvas";
const SEARCH_DEFAULT_QUERY = Object.freeze({
  text:"",
  scope:"document",
  type:"all",
  property:"all",
  mode:"partial",
  caseSensitive:false,
  wholeWord:false,
  status:"all",
  relationship:"all",
  visibility:"all",
  propertyName:"",
  propertyValue:"",
  ownerIds:null
});

const SEARCH_TYPE_LABELS = Object.freeze({
  concept:"Concept",
  text:"Plain text",
  status:"Status node",
  note:"Rich note",
  todo:"To-do list",
  table:"Table",
  frame:"Frame",
  swimlane:"Swimlane",
  edge:"Relationship"
});

const SEARCH_PROPERTY_LABELS = Object.freeze({
  title:"Title",
  body:"Body text",
  field:"Table field",
  item:"To-do item",
  status:"Status",
  relationship:"Relationship",
  port:"Port",
  metadata:"Metadata",
  id:"Stable ID"
});

let searchOwnerRecords = new Map();
let searchOwnerSignatures = new Map();
let searchIndexRecords = [];
let searchIndexGeneration = 0;
let searchIndexDirty = true;
let searchIndexLastStats = {generation:0, owners:0, records:0, changed:0, durationMs:0};
let searchPanel = null;
let searchResults = [];
let searchActiveIndex = -1;
let searchRunTimer = null;
let searchRunToken = 0;
let searchProposal = null;
let searchNavigationBack = [];
let searchDiscoveryOwnerIds = null;

function searchNormalizeText(value){
  return String(value == null ? "" : value).normalize("NFKC");
}
function searchOwnerKey(kind, id){ return `${kind}:${id}`; }
function searchRecordKey(kind, id, property, qualifier = ""){
  return `${searchOwnerKey(kind, id)}:${property}:${qualifier}`;
}
function searchTypeLabel(type){ return SEARCH_TYPE_LABELS[type] || String(type || "Object"); }
function searchPropertyLabel(group){ return SEARCH_PROPERTY_LABELS[group] || "Property"; }
function searchSafeString(value){
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
function searchPathLabel(path){ return path.map(part => String(part)).join("."); }

function searchContainersForNode(node, containers){
  if (!node) return [];
  const rect = nodeRect(node);
  return containers
    .filter(container => container.id !== node.id)
    .filter(container => {
      const bounds = containmentRect(container);
      return rect.cx >= bounds.x && rect.cx <= bounds.x + bounds.w &&
             rect.cy >= bounds.y && rect.cy <= bounds.y + bounds.h;
    })
    .sort((a, b) => {
      const ar = containmentRect(a), br = containmentRect(b);
      return (br.w * br.h) - (ar.w * ar.h);
    });
}

function searchNodeContext(node, containers, collapsedHidden, scope = null){
  const ancestry = searchContainersForNode(node, containers);
  const collapsed = [...ancestry].reverse()
    .find(container => container.type === "frame" && container.collapsed === true);
  return {
    page:scope && scope.pageName || SEARCH_PAGE_LABEL,
    pageId:scope && scope.pageId || null,
    containers:ancestry.map(container => container.title || searchTypeLabel(container.type)),
    containerIds:ancestry.map(container => container.id),
    collapsedContainerId:collapsed ? collapsed.id : null,
    hidden:(typeof organizationObjectHidden === "function" ? organizationObjectHidden(node) : node.hidden === true) ||
      collapsedHidden.has(node.id),
    collapsed:node.collapsed === true || !!collapsed,
    locked:typeof organizationObjectLocked === "function"
      ? organizationObjectLocked(node) : node.locked === true,
    layer:searchSafeString(typeof organizationObjectLayer === "function"
      ? organizationObjectLayer(node).name : node.layer || node.layerName || node.layerId),
    owner:searchSafeString(node.owner),
    tags:Array.isArray(node.tags) ? node.tags.map(searchSafeString).filter(Boolean) : [],
    status:searchSafeString(node.status),
    sourceAuthority:searchSafeString(node.sourceAuthority || (node.sourceControlled ? "external" : "local")) || "local"
  };
}

function searchEdgeContext(edge, nodeContextById, scope = null){
  const fromContext = nodeContextById.get(edge.from);
  const toContext = nodeContextById.get(edge.to);
  const containers = fromContext && toContext &&
    JSON.stringify(fromContext.containerIds) === JSON.stringify(toContext.containerIds)
    ? fromContext.containers : [];
  return {
    page:scope && scope.pageName || SEARCH_PAGE_LABEL,
    pageId:scope && scope.pageId || null,
    containers,
    containerIds:fromContext && toContext &&
      JSON.stringify(fromContext.containerIds) === JSON.stringify(toContext.containerIds)
      ? fromContext.containerIds : [],
    collapsedContainerId:(fromContext && fromContext.collapsedContainerId) ||
      (toContext && toContext.collapsedContainerId) || null,
    hidden:(typeof organizationObjectHidden === "function"
      ? organizationObjectHidden(edge) : edge.hidden === true) ||
      !!(fromContext && fromContext.hidden) || !!(toContext && toContext.hidden),
    collapsed:!!(fromContext && fromContext.collapsed) || !!(toContext && toContext.collapsed),
    locked:typeof organizationObjectLocked === "function"
      ? organizationObjectLocked(edge) : edge.locked === true,
    layer:searchSafeString(typeof organizationObjectLayer === "function"
      ? organizationObjectLayer(edge).name : edge.layer || edge.layerName || edge.layerId),
    owner:searchSafeString(edge.owner),
    tags:Array.isArray(edge.tags) ? edge.tags.map(searchSafeString).filter(Boolean) : [],
    status:searchSafeString(edge.status),
    sourceAuthority:searchSafeString(edge.sourceAuthority || (edge.sourceControlled ? "external" : "local")) || "local"
  };
}

function searchAddRecord(records, base, property, group, value, opts = {}){
  const text = searchSafeString(value);
  if (!text.trim() && opts.includeEmpty !== true) return;
  const qualifier = opts.qualifier || property;
  records.push({
    ...base,
    key:searchRecordKey(base.ownerKind, base.ownerId, property, qualifier),
    property,
    propertyGroup:group,
    value:text,
    replaceable:opts.replaceable === true,
    path:opts.path || null,
    fieldId:opts.fieldId || null,
    itemId:opts.itemId || null,
    portId:opts.portId || null,
    semantic:opts.semantic === true,
    sourceAuthority:opts.sourceAuthority || base.sourceAuthority || "local"
  });
}

function searchMetadataEntries(value, path = [], depth = 0, output = []){
  if (depth > 3 || value == null) return output;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean"){
    output.push({path, value});
    return output;
  }
  if (Array.isArray(value)){
    value.slice(0, 100).forEach((entry, index) =>
      searchMetadataEntries(entry, [...path, index], depth + 1, output));
    return output;
  }
  if (typeof value === "object"){
    Object.keys(value).sort().slice(0, 100).forEach(key =>
      searchMetadataEntries(value[key], [...path, key], depth + 1, output));
  }
  return output;
}

function searchNodeRecords(node, context){
  const records = [];
  const bounds = nodeRect(node);
  const base = {
    ownerKind:"node",
    ownerId:node.id,
    objectType:node.type || "concept",
    objectLabel:node.title || searchTypeLabel(node.type),
    bounds:{x:bounds.x, y:bounds.y, w:bounds.w, h:bounds.h},
    ...context
  };
  searchAddRecord(records, base, "Title", "title", node.title, {
    qualifier:"title", replaceable:true, path:{kind:"owner", prop:"title"}
  });
  searchAddRecord(records, base, "Subtitle", "body", node.subtitle, {
    qualifier:"subtitle", replaceable:true, path:{kind:"owner", prop:"subtitle"}
  });
  searchAddRecord(records, base, "Notes", "body", node.notes, {
    qualifier:"notes", replaceable:true, path:{kind:"owner", prop:"notes"}
  });
  if (node.type === "note")
    searchAddRecord(records, base, "Note content", "body", node.content, {
      qualifier:"content", replaceable:true, path:{kind:"owner", prop:"content"}
    });
  if (node.type === "status")
    searchAddRecord(records, base, "Status", "status", node.status, {
      qualifier:"status", semantic:true
    });
  searchAddRecord(records, base, "Stable ID", "id", node.id, {
    qualifier:"id", semantic:true
  });

  if (node.type === "todo"){
    for (const item of node.items || []){
      searchAddRecord(records, base, "To-do item", "item", item.text, {
        qualifier:`item:${item.id}`, replaceable:true, itemId:item.id,
        path:{kind:"item", itemId:item.id, prop:"text"}
      });
      searchAddRecord(records, base, "Item ID", "id", item.id, {
        qualifier:`item-id:${item.id}`, itemId:item.id, semantic:true
      });
    }
  }

  if (node.type === "table"){
    for (const field of node.fields || []){
      const prefix = `field:${field.id}`;
      searchAddRecord(records, base, "Field name", "field", field.name, {
        qualifier:`${prefix}:name`, replaceable:true, fieldId:field.id,
        path:{kind:"field", fieldId:field.id, prop:"name"}
      });
      searchAddRecord(records, base, "Field type", "field", field.type, {
        qualifier:`${prefix}:type`, fieldId:field.id, semantic:true
      });
      searchAddRecord(records, base, "Field comment", "field", field.comment, {
        qualifier:`${prefix}:comment`, replaceable:true, fieldId:field.id,
        path:{kind:"field", fieldId:field.id, prop:"comment"}
      });
      searchAddRecord(records, base, "Field default", "field", field.default, {
        qualifier:`${prefix}:default`, fieldId:field.id, semantic:true
      });
      const constraints = [
        field.pk ? "primary key" : "",
        field.fk ? "foreign key" : "",
        field.nullable === false ? "not null" : "nullable",
        field.unique ? "unique" : "",
        field.index ? "indexed" : ""
      ].filter(Boolean).join(", ");
      searchAddRecord(records, base, "Field constraints", "field", constraints, {
        qualifier:`${prefix}:constraints`, fieldId:field.id, semantic:true
      });
      searchAddRecord(records, base, "Field ID", "id", field.id, {
        qualifier:`${prefix}:id`, fieldId:field.id, semantic:true
      });
    }
  }

  if (nodeSupportsLinkPorts(node) && nodePortsEnabled(node)){
    for (const side of ["input", "output"]){
      const config = nodePortConfig(side);
      for (const port of nodePortsForSide(node, side)){
        const stored = Array.isArray(node[config.key]);
        searchAddRecord(records, base, `${side === "input" ? "Input" : "Output"} port`, "port", port.label, {
          qualifier:`${side}:${port.id}`, replaceable:true, portId:port.id,
          path:stored
            ? {kind:"port", collection:config.key, portId:port.id, prop:"label"}
            : {kind:"owner", prop:config.legacyKey}
        });
        searchAddRecord(records, base, "Port ID", "id", port.id, {
          qualifier:`${side}:${port.id}:id`, portId:port.id, semantic:true
        });
      }
    }
  }

  for (const [property, value] of [
    ["Owner", node.owner],
    ["User-defined type", typeof metadataTypeForObject === "function"
      ? metadataTypeForObject(node)?.name || node.semanticTypeId
      : node.customType || node.userType || node.semanticType],
    ["Layer", node.layerName || node.layer || node.layerId],
    ["Group", node.groupName || node.group || node.groupId],
    ["Page", node.pageName || node.page || node.pageId],
    ["Description", node.description],
    ["Alt text", node.altText]
  ]){
    const prop = property.toLowerCase().replace(/\s+/g, "-");
    const replaceable = ["Owner","Description","Alt text"].includes(property) &&
      node.sourceControlled !== true;
    searchAddRecord(records, base, property, "metadata", value, {
      qualifier:prop, replaceable,
      path:replaceable ? {kind:"owner", prop:property === "Owner" ? "owner"
        : property === "Description" ? "description" : "altText"} : null
    });
  }
  for (const [index, tag] of (Array.isArray(node.tags) ? node.tags : []).entries())
    searchAddRecord(records, base, "Tag", "metadata", tag, {
      qualifier:`tag:${index}`, semantic:true
    });

  for (const root of ["properties", "customProperties"]){
    if (!node[root] || typeof node[root] !== "object") continue;
    for (const entry of searchMetadataEntries(node[root])){
      const labelPath = [root, ...entry.path];
      const definition = root === "properties" && typeof metadataPropertyById === "function"
        ? metadataPropertyById(entry.path[0]) : null;
      if (definition?.sensitive) continue;
      const label = definition
        ? [definition.name, ...entry.path.slice(1)].join(".") : searchPathLabel(labelPath);
      const unsafe = /(?:^|\.)(?:id|key|formula|reference|source)(?:\.|$)/i.test(label);
      searchAddRecord(records, base, label, "metadata", entry.value, {
        qualifier:label,
        replaceable:typeof entry.value === "string" && !unsafe && !definition?.readOnly &&
          node.sourceControlled !== true,
        path:typeof entry.value === "string" && !unsafe && !definition?.readOnly
          ? {kind:"metadata", root, segments:entry.path} : null,
        semantic:unsafe
      });
    }
  }
  return records;
}

function searchEdgeRecords(edge, context, nodesById){
  const from = nodesById.get(edge.from), to = nodesById.get(edge.to);
  const fromRect = from ? nodeRect(from) : null;
  const toRect = to ? nodeRect(to) : null;
  const x0 = Math.min(fromRect?.cx ?? 0, toRect?.cx ?? 0);
  const y0 = Math.min(fromRect?.cy ?? 0, toRect?.cy ?? 0);
  const x1 = Math.max(fromRect?.cx ?? 0, toRect?.cx ?? 0);
  const y1 = Math.max(fromRect?.cy ?? 0, toRect?.cy ?? 0);
  const records = [];
  const base = {
    ownerKind:"edge",
    ownerId:edge.id,
    objectType:"edge",
    objectLabel:edge.label || `${from?.title || "Object"} → ${to?.title || "Object"}`,
    relationshipType:edge.label || edge.kind || "link",
    bounds:{x:x0, y:y0, w:Math.max(1, x1 - x0), h:Math.max(1, y1 - y0)},
    ...context
  };
  searchAddRecord(records, base, "Relationship label", "relationship", edge.label, {
    qualifier:"label", semantic:true
  });
  searchAddRecord(records, base, "Relationship type", "relationship", edge.kind || "link", {
    qualifier:"kind", semantic:true
  });
  searchAddRecord(records, base, "Source object", "relationship", from && from.title, {
    qualifier:"source", semantic:true
  });
  searchAddRecord(records, base, "Target object", "relationship", to && to.title, {
    qualifier:"target", semantic:true
  });
  searchAddRecord(records, base, "Source object ID", "id", edge.from, {
    qualifier:"source-id", semantic:true
  });
  searchAddRecord(records, base, "Target object ID", "id", edge.to, {
    qualifier:"target-id", semantic:true
  });
  searchAddRecord(records, base, "Source port", "port",
    edge.fromPort || edge.fromField || edge.fromAnchor, {qualifier:"source-port", semantic:true});
  searchAddRecord(records, base, "Target port", "port",
    edge.toPort || edge.toField || edge.toAnchor, {qualifier:"target-port", semantic:true});
  searchAddRecord(records, base, "Stable ID", "id", edge.id, {
    qualifier:"id", semantic:true
  });

  for (const [property, value] of [
    ["Owner", edge.owner],
    ["User-defined type", typeof metadataTypeForObject === "function"
      ? metadataTypeForObject(edge)?.name || edge.semanticTypeId
      : edge.customType || edge.userType || edge.semanticType],
    ["Layer", edge.layerName || edge.layer || edge.layerId],
    ["Group", edge.groupName || edge.group || edge.groupId],
    ["Page", edge.pageName || edge.page || edge.pageId],
    ["Description", edge.description],
    ["Alt text", edge.altText]
  ]){
    const prop = property.toLowerCase().replace(/\s+/g, "-");
    const replaceable = ["Owner","Description","Alt text"].includes(property) &&
      edge.sourceControlled !== true;
    searchAddRecord(records, base, property, "metadata", value, {
      qualifier:prop, replaceable,
      path:replaceable ? {kind:"owner", prop:property === "Owner" ? "owner"
        : property === "Description" ? "description" : "altText"} : null
    });
  }
  for (const [index, tag] of (Array.isArray(edge.tags) ? edge.tags : []).entries())
    searchAddRecord(records, base, "Tag", "metadata", tag, {
      qualifier:`tag:${index}`, semantic:true
    });

  for (const root of ["properties", "customProperties"]){
    if (!edge[root] || typeof edge[root] !== "object") continue;
    for (const entry of searchMetadataEntries(edge[root])){
      const labelPath = [root, ...entry.path];
      const definition = root === "properties" && typeof metadataPropertyById === "function"
        ? metadataPropertyById(entry.path[0]) : null;
      if (definition?.sensitive) continue;
      const label = definition
        ? [definition.name, ...entry.path.slice(1)].join(".") : searchPathLabel(labelPath);
      const unsafe = /(?:^|\.)(?:id|key|formula|reference|source)(?:\.|$)/i.test(label);
      searchAddRecord(records, base, label, "metadata", entry.value, {
        qualifier:label,
        replaceable:typeof entry.value === "string" && !unsafe && !definition?.readOnly &&
          edge.sourceControlled !== true,
        path:typeof entry.value === "string" && !unsafe && !definition?.readOnly
          ? {kind:"metadata", root, segments:entry.path} : null,
        semantic:unsafe
      });
    }
  }
  return records;
}

function markSearchIndexDirty(){
  searchIndexDirty = true;
  if (searchPanel && !searchPanel.hidden) scheduleSearchRun();
}

function refreshSearchIndex(force = false){
  const started = performance.now();
  const seen = new Set();
  let changed = 0;

  const scopes = typeof pagesSearchScopes === "function" ? pagesSearchScopes() : [{
    pageId:null,pageName:SEARCH_PAGE_LABEL,nodes:state.nodes,edges:state.edges,
    organization:state.organization
  }];
  for (const scope of scopes){
    const containers = scope.nodes.filter(isStructuralNode);
    const nodesById = new Map(scope.nodes.map(node => [node.id,node]));
    const collapsedHidden = new Set();
    for (const container of containers.filter(node => node.type === "frame" && node.collapsed === true)){
      const bounds = containmentRect(container);
      for (const node of scope.nodes){
        if (node.id === container.id) continue;
        const rect = nodeRect(node);
        if (rect.cx >= bounds.x && rect.cx <= bounds.x + bounds.w &&
            rect.cy >= bounds.y && rect.cy <= bounds.y + bounds.h) collapsedHidden.add(node.id);
      }
    }
    const nodeContextById = new Map();
    for (const node of scope.nodes){
      const context = searchNodeContext(node,containers,collapsedHidden,scope);
      /* Organization helpers are active-page projections. Direct flags remain
         correct for unloaded pages; inherited organization is resolved when
         that result is opened. */
      if (scope.pageId !== state.activePageId){
        context.hidden = node.hidden === true || collapsedHidden.has(node.id);
        context.locked = node.locked === true;
      }
      nodeContextById.set(node.id,context);
    }
    const hierarchySignature = JSON.stringify({
      pageId:scope.pageId,
      containers:containers.map(container => ({
        id:container.id,title:container.title,x:container.x,y:container.y,
        w:container.w,h:container.h,collapsed:container.collapsed === true,
        hidden:container.hidden === true,locked:container.locked === true
      })),
      organization:scope.organization
    });
    const endpointTitleSignature = new Map(scope.nodes.map(node => [node.id,node.title || ""]));
    for (const node of scope.nodes){
      const key = searchOwnerKey("node",node.id);
      const signature = JSON.stringify(node)+hierarchySignature;
      seen.add(key);
      if (!force && searchOwnerSignatures.get(key) === signature) continue;
      searchOwnerSignatures.set(key,signature);
      searchOwnerRecords.set(key,searchNodeRecords(node,nodeContextById.get(node.id)));
      changed++;
    }
    for (const edge of scope.edges){
      const key = searchOwnerKey("edge",edge.id);
      const signature = JSON.stringify(edge)+(endpointTitleSignature.get(edge.from)||"")+"\u0000"+
        (endpointTitleSignature.get(edge.to)||"")+hierarchySignature;
      seen.add(key);
      if (!force && searchOwnerSignatures.get(key) === signature) continue;
      searchOwnerSignatures.set(key,signature);
      const context=searchEdgeContext(edge,nodeContextById,scope);
      if(scope.pageId!==state.activePageId){
        context.hidden=edge.hidden===true;
        context.locked=edge.locked===true;
      }
      searchOwnerRecords.set(key,searchEdgeRecords(edge,context,nodesById));
      changed++;
    }
  }
  if (typeof pagesCanonicalObjectsWithNoAppearances === "function"){
    for (const semantic of pagesCanonicalObjectsWithNoAppearances()){
      const key=searchOwnerKey("semantic",semantic.id);
      const signature=JSON.stringify(semantic);
      seen.add(key);
      if(!force&&searchOwnerSignatures.get(key)===signature)continue;
      searchOwnerSignatures.set(key,signature);
      const pseudo={...semantic,id:semantic.id,x:0,y:0};
      const records=searchNodeRecords(pseudo,{
        page:"Model only",pageId:null,containers:[],containerIds:[],
        collapsedContainerId:null,hidden:false,collapsed:false,locked:false,
        layer:"",owner:searchSafeString(semantic.owner),
        tags:Array.isArray(semantic.tags)?semantic.tags:[],
        status:searchSafeString(semantic.status),sourceAuthority:"local"
      }).map(record=>({
        ...record,
        key:searchRecordKey("semantic",semantic.id,record.property,record.property),
        ownerKind:"semantic",ownerId:semantic.id,modelOnly:true
      }));
      searchOwnerRecords.set(key,records);
      changed++;
    }
  }
  for (const key of [...searchOwnerRecords.keys()]){
    if (seen.has(key)) continue;
    searchOwnerRecords.delete(key);
    searchOwnerSignatures.delete(key);
    changed++;
  }
  if (changed || force || searchIndexDirty){
    searchIndexRecords = [...searchOwnerRecords.values()].flat();
    searchIndexGeneration++;
  }
  searchIndexDirty = false;
  searchIndexLastStats = {
    generation:searchIndexGeneration,
    owners:searchOwnerRecords.size,
    records:searchIndexRecords.length,
    changed,
    durationMs:performance.now() - started
  };
  return searchIndexLastStats;
}

function searchIndexStats(){ return {...searchIndexLastStats}; }

function searchEscapeRegex(value){
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function searchCompileMatcher(query){
  const text = searchNormalizeText(query.text);
  if (!text) return {error:"", ranges:() => []};
  let source = query.mode === "regex" ? text : searchEscapeRegex(text);
  if (query.mode === "exact") source = `^(?:${source})$`;
  else if (query.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    const regex = new RegExp(source, `${query.caseSensitive ? "" : "i"}gu`);
    return {
      error:"",
      regex,
      ranges(value){
        const normalized = searchNormalizeText(value);
        const result = [];
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(normalized))){
          result.push([match.index, match.index + match[0].length]);
          if (match[0].length === 0) regex.lastIndex++;
          if (result.length >= 100) break;
        }
        regex.lastIndex = 0;
        return result;
      }
    };
  } catch (error){
    return {error:`Invalid regular expression: ${error.message}`, ranges:() => []};
  }
}

function searchViewportBounds(){
  const bounds = board.getBoundingClientRect();
  return {
    x:(0 - view.x) / view.k,
    y:(0 - view.y) / view.k,
    w:bounds.width / view.k,
    h:bounds.height / view.k
  };
}
function searchRecordOffCanvas(record, viewport = searchViewportBounds()){
  const rect = record.bounds;
  if (!rect) return true;
  return rect.x + rect.w < viewport.x || rect.x > viewport.x + viewport.w ||
    rect.y + rect.h < viewport.y || rect.y > viewport.y + viewport.h;
}

function searchScopeIds(scope){
  if (scope === "selection")
    return new Set(selectionIds().map(id => searchOwnerKey(sel.kind, id)));
  if (scope !== "container") return null;
  const selected = firstSelectedNode();
  if (!selected) return new Set();
  let container = isStructuralNode(selected) ? selected : null;
  if (!container){
    const containers = searchContainersForNode(selected, state.nodes.filter(isStructuralNode));
    container = containers[containers.length - 1] || null;
  }
  if (!container) return new Set([searchOwnerKey("node", selected.id)]);
  const ids = new Set([searchOwnerKey("node", container.id)]);
  for (const node of containerContainedNodes(container)) ids.add(searchOwnerKey("node", node.id));
  for (const edge of state.edges)
    if (ids.has(searchOwnerKey("node", edge.from)) && ids.has(searchOwnerKey("node", edge.to)))
      ids.add(searchOwnerKey("edge", edge.id));
  return ids;
}

function normalizeSearchQuery(raw = {}){
  const query = {...SEARCH_DEFAULT_QUERY, ...raw};
  query.text = searchNormalizeText(query.text);
  query.propertyName = searchNormalizeText(query.propertyName);
  query.propertyValue = searchNormalizeText(query.propertyValue);
  query.caseSensitive = query.caseSensitive === true;
  query.wholeWord = query.wholeWord === true;
  query.ownerIds = Array.isArray(query.ownerIds) ? [...new Set(query.ownerIds)] : null;
  return query;
}

function searchQueryIsActive(query){
  return !!query.text || query.scope !== "document" || query.type !== "all" ||
    query.property !== "all" || query.status !== "all" ||
    query.relationship !== "all" || query.visibility !== "all" ||
    !!query.propertyName || !!query.propertyValue ||
    !!(query.ownerIds && query.ownerIds.length);
}

function querySearchIndex(rawQuery = {}){
  refreshSearchIndex();
  const query = normalizeSearchQuery(rawQuery);
  const matcher = searchCompileMatcher(query);
  if (matcher.error) return {query, results:[], error:matcher.error, generation:searchIndexGeneration};
  if (!searchQueryIsActive(query))
    return {query, results:[], error:"", generation:searchIndexGeneration};
  const scopedIds = searchScopeIds(query.scope);
  const discoveryIds = query.ownerIds ? new Set(query.ownerIds) : null;
  const propertyName = query.caseSensitive ? query.propertyName : query.propertyName.toLocaleLowerCase();
  const propertyValue = query.caseSensitive ? query.propertyValue : query.propertyValue.toLocaleLowerCase();
  const viewport = searchViewportBounds();
  const results = [];

  for (const record of searchIndexRecords){
    const ownerKey = searchOwnerKey(record.ownerKind, record.ownerId);
    if (scopedIds && !scopedIds.has(ownerKey)) continue;
    if (discoveryIds && !discoveryIds.has(ownerKey)) continue;
    if (query.type !== "all" && record.objectType !== query.type) continue;
    if (query.property !== "all" && record.propertyGroup !== query.property) continue;
    if (query.status !== "all" && record.status !== query.status) continue;
    if (query.relationship !== "all" && record.relationshipType !== query.relationship) continue;
    if (query.visibility === "locked" && !record.locked) continue;
    const candidateProperty = query.caseSensitive ? record.property : record.property.toLocaleLowerCase();
    const candidateValue = query.caseSensitive ? record.value : record.value.toLocaleLowerCase();
    if (propertyName && !candidateProperty.includes(propertyName)) continue;
    if (propertyValue && !candidateValue.includes(propertyValue)) continue;
    const ranges = matcher.ranges(record.value);
    if (query.text && !ranges.length) continue;
    const offCanvas = searchRecordOffCanvas(record, viewport);
    if (query.visibility === "visible" && (record.hidden || record.collapsed || offCanvas)) continue;
    if (query.visibility === "hidden" && !(record.hidden || record.collapsed)) continue;
    if (query.visibility === "offcanvas" && !offCanvas) continue;
    results.push({...record, ranges, offCanvas});
  }

  if (!query.text && query.property === "all" && !query.propertyName && !query.propertyValue){
    const byOwner = new Map();
    for (const result of results){
      const key = searchOwnerKey(result.ownerKind, result.ownerId);
      const previous = byOwner.get(key);
      if (!previous || result.propertyGroup === "title" ||
          (previous.propertyGroup !== "title" && result.propertyGroup === "relationship"))
        byOwner.set(key, result);
    }
    return {query, results:[...byOwner.values()], error:"", generation:searchIndexGeneration};
  }
  return {query, results, error:"", generation:searchIndexGeneration};
}

function searchCurrentQuery(){
  ensureSearchPanel();
  return normalizeSearchQuery({
    text:searchPanel.querySelector("#searchInput").value,
    scope:searchPanel.querySelector("#searchScope").value,
    type:searchPanel.querySelector("#searchType").value,
    property:searchPanel.querySelector("#searchProperty").value,
    mode:searchPanel.querySelector("#searchMode").value,
    caseSensitive:searchPanel.querySelector("#searchCase").checked,
    wholeWord:searchPanel.querySelector("#searchWholeWord").checked,
    status:searchPanel.querySelector("#searchStatus").value,
    relationship:searchPanel.querySelector("#searchRelationship").value,
    visibility:searchPanel.querySelector("#searchVisibility").value,
    propertyName:searchPanel.querySelector("#searchPropertyName").value,
    propertyValue:searchPanel.querySelector("#searchPropertyValue").value,
    ownerIds:searchDiscoveryOwnerIds ? [...searchDiscoveryOwnerIds] : null
  });
}

function searchSetText(node, text){
  node.textContent = text;
  return node;
}
function searchAppendHighlightedText(node, value, ranges){
  let cursor = 0;
  for (const [start, end] of ranges){
    if (start > cursor) node.appendChild(document.createTextNode(value.slice(cursor, start)));
    const mark = document.createElement("mark");
    mark.textContent = value.slice(start, end);
    node.appendChild(mark);
    cursor = end;
  }
  if (cursor < value.length) node.appendChild(document.createTextNode(value.slice(cursor)));
  if (!ranges.length) node.textContent = value;
}

function searchResultContext(result){
  const context = [result.page, ...result.containers, result.property].filter(Boolean);
  return context.join(" › ");
}

function searchRenderResults(){
  if (!searchPanel) return;
  const list = searchPanel.querySelector("#searchResults");
  const summary = searchPanel.querySelector("#searchSummary");
  list.innerHTML = "";
  if (!searchResults.length){
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = searchCurrentQuery().text || searchQueryIsActive(searchCurrentQuery())
      ? "No matches. Try changing the text, scope, or filters."
      : "Enter text or choose a discovery filter.";
    list.appendChild(empty);
    summary.textContent = "0 results";
    return;
  }
  if (searchActiveIndex < 0) searchActiveIndex = 0;
  searchActiveIndex = Math.min(searchResults.length - 1, searchActiveIndex);
  const start = Math.max(0, Math.min(searchActiveIndex - 60,
    Math.max(0, searchResults.length - SEARCH_RENDER_WINDOW)));
  const end = Math.min(searchResults.length, start + SEARCH_RENDER_WINDOW);
  for (let index = start; index < end; index++){
    const result = searchResults[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result" + (index === searchActiveIndex ? " active" : "");
    button.id = `search-result-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === searchActiveIndex));
    button.dataset.searchIndex = String(index);
    const header = document.createElement("span");
    header.className = "search-result-head";
    const type = searchSetText(document.createElement("span"), searchTypeLabel(result.objectType));
    type.className = "search-result-type";
    const title = searchSetText(document.createElement("strong"), result.objectLabel || result.ownerId);
    header.append(type, title);
    const match = document.createElement("span");
    match.className = "search-result-match";
    searchAppendHighlightedText(match, result.value, result.ranges);
    const context = searchSetText(document.createElement("small"), searchResultContext(result));
    context.className = "search-result-context";
    const badges = document.createElement("span");
    badges.className = "search-result-badges";
    for (const [show, label] of [
      [result.hidden, "Hidden"],
      [result.collapsed, "Collapsed"],
      [result.offCanvas, "Off canvas"],
      [result.locked, "Locked"]
    ]){
      if (!show) continue;
      const badge = searchSetText(document.createElement("span"), label);
      badges.appendChild(badge);
    }
    button.append(header, match, context, badges);
    button.addEventListener("click", () => activateSearchResult(index));
    list.appendChild(button);
  }
  const windowNote = searchResults.length > SEARCH_RENDER_WINDOW
    ? ` · showing ${start + 1}–${end}` : "";
  summary.textContent = `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}${windowNote}`;
  list.setAttribute("aria-activedescendant", `search-result-${searchActiveIndex}`);
}

function searchSetError(message){
  if (!searchPanel) return;
  const error = searchPanel.querySelector("#searchError");
  error.textContent = message || "";
  error.hidden = !message;
}

function runSearch(opts = {}){
  if (!searchPanel || searchPanel.hidden) return [];
  const token = ++searchRunToken;
  const query = searchCurrentQuery();
  const response = querySearchIndex(query);
  if (token !== searchRunToken) return searchResults;
  searchResults = response.results;
  searchActiveIndex = opts.preserveIndex
    ? Math.min(Math.max(searchActiveIndex, 0), searchResults.length - 1)
    : searchResults.length ? 0 : -1;
  searchSetError(response.error);
  searchRenderResults();
  searchProposal = null;
  const preview = searchPanel.querySelector("#searchReplacePreview");
  preview.hidden = true;
  if (typeof updateCommandStates === "function") updateCommandStates();
  return searchResults;
}

function scheduleSearchRun(){
  if (searchRunTimer) clearTimeout(searchRunTimer);
  searchRunTimer = setTimeout(() => {
    searchRunTimer = null;
    refreshSearchIndex();
    runSearch({preserveIndex:true});
  }, SEARCH_DEBOUNCE_MS);
}

function searchCaptureNavigation(){
  return {
    pageId:typeof state.activePageId === "string" ? state.activePageId : null,
    view:{x:view.x, y:view.y, k:view.k},
    selection:sel ? {kind:sel.kind, ids:[...sel.ids]} : null
  };
}
function searchRestoreNavigation(){
  const previous = searchNavigationBack.pop();
  if (!previous){
    announce("There is no previous search location.");
    return false;
  }
  if (previous.pageId && typeof pagesSwitch === "function")
    pagesSwitch(previous.pageId,{recordNavigation:false,restoreCamera:false});
  view.x = previous.view.x;
  view.y = previous.view.y;
  view.k = previous.view.k;
  if (previous.selection) setSelection(previous.selection.kind, previous.selection.ids);
  else clearSelection();
  render();
  applyView();
  searchRenderResults();
  announce("Returned to the previous search location.");
  return true;
}

function searchCenterEdge(edge){
  const endpoints = edge && edgeEndpoints(edge);
  if (!endpoints) return false;
  const bounds = board.getBoundingClientRect();
  const x = (endpoints.pa.x + endpoints.pb.x) / 2;
  const y = (endpoints.pa.y + endpoints.pb.y) / 2;
  view.x = bounds.width / 2 - x * view.k;
  view.y = bounds.height / 2 - y * view.k;
  applyView();
  return true;
}
function searchMarkCanvasResult(result){
  document.querySelectorAll(".search-hit-active").forEach(element =>
    element.classList.remove("search-hit-active"));
  const id = String(result.ownerId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const selector = result.ownerKind === "node"
    ? `[data-node="${id}"]`
    : `[data-edge="${id}"]`;
  const element = document.querySelector(selector);
  if (element) element.classList.add("search-hit-active");
}

function activateSearchResult(index, opts = {}){
  const result = searchResults[index];
  if (!result) return false;
  if (opts.recordNavigation !== false) searchNavigationBack.push(searchCaptureNavigation());
  if (result.ownerKind === "semantic"){
    if (typeof pagesOpenAppearanceChooser === "function")
      pagesOpenAppearanceChooser(result.ownerId,[]);
    searchActiveIndex=index;
    searchRenderResults();
    announce(`Model-only object: ${result.objectLabel}. It has no visible appearance.`);
    return true;
  }
  if (result.pageId && result.pageId !== state.activePageId && typeof pagesSwitch === "function")
    pagesSwitch(result.pageId,{recordNavigation:false});
  if (result.collapsedContainerId){
    const frame = nodeById(result.collapsedContainerId);
    if (frame && frame.collapsed === true){
      const approved = confirm(`"${result.objectLabel}" is inside collapsed frame "${frame.title}". Expand the frame to reveal it?`);
      if (!approved){
        announce(`Result remains inside collapsed frame ${frame.title}.`);
        return false;
      }
      setFrameCollapsed(frame, false);
      refreshSearchIndex(true);
    }
  }
  searchActiveIndex = index;
  if (result.ownerKind === "node"){
    setSelection("node", result.ownerId);
    centerNode(result.ownerId);
    render();
  } else {
    setSelection("edge", result.ownerId);
    searchCenterEdge(edgeById(result.ownerId));
    render();
  }
  searchMarkCanvasResult(result);
  searchRenderResults();
  rememberSearch(searchCurrentQuery().text);
  announce(`Result ${index + 1} of ${searchResults.length}: ${result.objectLabel}, ${searchResultContext(result)}.`);
  return true;
}

function activateRelativeSearchResult(delta){
  if (!searchResults.length){
    announce("There are no search results.");
    return false;
  }
  const next = (Math.max(0, searchActiveIndex) + delta + searchResults.length) % searchResults.length;
  return activateSearchResult(next);
}
function activateNextSearchResult(){ return activateRelativeSearchResult(1); }
function activatePreviousSearchResult(){ return activateRelativeSearchResult(-1); }

function searchRecordOwner(record){
  if(record.ownerKind==="semantic")
    return (state.semanticObjects||[]).find(object=>object.id===record.ownerId)||null;
  if(record.pageId&&typeof pagesPageById==="function"){
    const page=pagesPageById(record.pageId);
    if(page)return record.ownerKind==="node"
      ? page.nodes.find(node=>node.id===record.ownerId)||null
      : page.edges.find(edge=>edge.id===record.ownerId)||null;
  }
  return record.ownerKind === "node" ? nodeById(record.ownerId) : edgeById(record.ownerId);
}
function searchReadPath(record){
  const owner = searchRecordOwner(record);
  if (!owner || !record.path) return undefined;
  const path = record.path;
  if (path.kind === "owner") return owner[path.prop];
  if (path.kind === "field") return (owner.fields || []).find(field => field.id === path.fieldId)?.[path.prop];
  if (path.kind === "item") return (owner.items || []).find(item => item.id === path.itemId)?.[path.prop];
  if (path.kind === "port") return (owner[path.collection] || []).find(port => port.id === path.portId)?.[path.prop];
  if (path.kind === "metadata"){
    let value = owner[path.root];
    for (const segment of path.segments || []) value = value == null ? undefined : value[segment];
    return value;
  }
  return undefined;
}
function searchWritePath(record, value){
  const owner = searchRecordOwner(record);
  if (!owner || !record.path) return false;
  const path = record.path;
  if (path.kind === "owner"){ owner[path.prop] = value; return true; }
  if (path.kind === "field"){
    const field = (owner.fields || []).find(candidate => candidate.id === path.fieldId);
    if (!field) return false;
    field[path.prop] = value;
    return true;
  }
  if (path.kind === "item"){
    const item = (owner.items || []).find(candidate => candidate.id === path.itemId);
    if (!item) return false;
    item[path.prop] = value;
    return true;
  }
  if (path.kind === "port"){
    const port = (owner[path.collection] || []).find(candidate => candidate.id === path.portId);
    if (!port) return false;
    port[path.prop] = value;
    return true;
  }
  if (path.kind === "metadata"){
    let target = owner[path.root];
    const segments = path.segments || [];
    for (let index = 0; index < segments.length - 1; index++){
      if (target == null) return false;
      target = target[segments[index]];
    }
    if (target == null || !segments.length) return false;
    target[segments[segments.length - 1]] = value;
    return true;
  }
  return false;
}

function searchReplacementValue(value, query, replacement){
  const matcher = searchCompileMatcher(query);
  if (matcher.error || !query.text) return value;
  matcher.regex.lastIndex = 0;
  const next = searchNormalizeText(value).replace(matcher.regex, replacement);
  matcher.regex.lastIndex = 0;
  return next;
}

function buildSearchReplaceProposal(replacement, currentOnly = false){
  const query = searchCurrentQuery();
  const source = currentOnly && searchResults[searchActiveIndex]
    ? [searchResults[searchActiveIndex]] : searchResults;
  const seen = new Set();
  const proposal = [];
  for (const record of source){
    if (seen.has(record.key)) continue;
    seen.add(record.key);
    const oldValue = searchSafeString(searchReadPath(record));
    let reason = "";
    if (!record.replaceable || !record.path) reason = record.semantic
      ? "Semantic or structural value" : "Read-only property";
    else if (record.locked) reason = "Locked object";
    else if (record.sourceAuthority !== "local") reason = `Controlled by ${record.sourceAuthority}`;
    const newValue = reason ? oldValue : searchReplacementValue(oldValue, query, replacement);
    if (!reason && newValue === oldValue) reason = "No compatible match";
    proposal.push({
      key:record.key,
      record,
      property:record.property,
      oldValue,
      newValue,
      reason,
      generation:searchIndexGeneration
    });
  }
  return proposal;
}

function renderSearchReplaceProposal(){
  const preview = searchPanel.querySelector("#searchReplacePreview");
  const list = searchPanel.querySelector("#searchReplaceList");
  list.innerHTML = "";
  const compatible = searchProposal.filter(change => !change.reason);
  const skipped = searchProposal.length - compatible.length;
  searchPanel.querySelector("#searchReplaceSummary").textContent =
    `${compatible.length} compatible change${compatible.length === 1 ? "" : "s"}` +
    (skipped ? ` · ${skipped} skipped` : "");
  searchProposal.forEach((change, index) => {
    const label = document.createElement("label");
    label.className = "search-replace-row" + (change.reason ? " skipped" : "");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !change.reason;
    checkbox.disabled = !!change.reason;
    checkbox.dataset.proposalIndex = String(index);
    const content = document.createElement("span");
    const title = searchSetText(document.createElement("strong"),
      `${change.record.objectLabel} · ${change.property}`);
    const before = searchSetText(document.createElement("del"), change.oldValue);
    const after = searchSetText(document.createElement("ins"), change.reason || change.newValue);
    content.append(title, before, after);
    label.append(checkbox, content);
    list.appendChild(label);
  });
  preview.hidden = false;
}

function previewSearchReplace(currentOnly = false){
  const replacement = searchPanel.querySelector("#searchReplaceInput").value;
  searchProposal = buildSearchReplaceProposal(replacement, currentOnly);
  renderSearchReplaceProposal();
  rememberSearch(searchCurrentQuery().text);
}

function applySearchReplace(){
  if (!searchProposal) return false;
  const checked = [...searchPanel.querySelectorAll("[data-proposal-index]:checked")]
    .map(input => searchProposal[Number(input.dataset.proposalIndex)])
    .filter(Boolean);
  const valid = [], stale = [];
  for (const change of checked){
    const current = searchSafeString(searchReadPath(change.record));
    const owner = change.record.ownerKind === "node"
      ? nodeById(change.record.ownerId) : edgeById(change.record.ownerId);
    if (!owner || (typeof organizationObjectLocked === "function"
      ? organizationObjectLocked(owner) : owner.locked === true) || current !== change.oldValue) stale.push(change);
    else valid.push(change);
  }
  if (!valid.length){
    searchSetError(stale.length
      ? "The selected values changed after the preview. Run the preview again."
      : "Select at least one compatible replacement.");
    return false;
  }
  pushHistory();
  let applied = 0;
  for (const change of valid) if (searchWritePath(change.record, change.newValue)) applied++;
  render();
  refreshSearchIndex(true);
  runSearch();
  searchProposal = null;
  searchPanel.querySelector("#searchReplacePreview").hidden = true;
  searchSetError(stale.length ? `${stale.length} stale or locked change${stale.length === 1 ? "" : "s"} skipped.` : "");
  announce(`Replaced ${applied} value${applied === 1 ? "" : "s"} as one undoable change.`);
  return true;
}

function readRecentSearches(){
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(searchSafeString).filter(Boolean).slice(0, SEARCH_RECENT_LIMIT) : [];
  } catch { return []; }
}
function rememberSearch(text){
  const query = searchNormalizeText(text).trim();
  if (!query) return;
  const recent = [query, ...readRecentSearches().filter(value => value !== query)].slice(0, SEARCH_RECENT_LIMIT);
  try { localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(recent)); } catch {}
  updateRecentSearchOptions();
}
function updateRecentSearchOptions(){
  if (!searchPanel) return;
  const select = searchPanel.querySelector("#searchRecent");
  const previous = select.value;
  select.innerHTML = '<option value="">Recent searches</option>';
  for (const value of readRecentSearches()){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function updateSearchFilterOptions(){
  if (!searchPanel) return;
  const status = searchPanel.querySelector("#searchStatus");
  const previousStatus = status.value;
  status.innerHTML = '<option value="all">Any status</option>';
  for (const value of statusOptions()){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    status.appendChild(option);
  }
  if ([...status.options].some(option => option.value === previousStatus)) status.value = previousStatus;

  const relationship = searchPanel.querySelector("#searchRelationship");
  const previousRelationship = relationship.value;
  const values = [...new Set([
    ...EDGE_RELATIONSHIPS.map(([name]) => name),
    ...state.edges.map(edge => edge.label || edge.kind || "link")
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  relationship.innerHTML = '<option value="all">Any relationship</option>';
  for (const value of values){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    relationship.appendChild(option);
  }
  if ([...relationship.options].some(option => option.value === previousRelationship))
    relationship.value = previousRelationship;
}

function ensureSearchPanel(){
  if (searchPanel) return searchPanel;
  searchPanel = document.createElement("section");
  searchPanel.id = "searchPanel";
  searchPanel.className = "search-panel";
  searchPanel.hidden = true;
  searchPanel.setAttribute("role", "dialog");
  searchPanel.setAttribute("aria-modal", "false");
  searchPanel.setAttribute("aria-labelledby", "searchPanelTitle");
  searchPanel.innerHTML = `
    <header class="search-panel-head">
      <div><span class="eyebrow">DISCOVER</span><h2 id="searchPanelTitle">Search this diagram</h2></div>
      <button type="button" id="searchClose" aria-label="Close search">×</button>
    </header>
    <div class="search-primary">
      <label for="searchInput">Find</label>
      <input id="searchInput" type="search" autocomplete="off"
             placeholder="Titles, fields, notes, links, statuses…" aria-describedby="searchSummary searchError">
      <button type="button" id="searchPrevious" title="Previous result (Ctrl/Cmd+Shift+G)" aria-label="Previous result">↑</button>
      <button type="button" id="searchNext" title="Next result (Ctrl/Cmd+G)" aria-label="Next result">↓</button>
    </div>
    <div class="search-filter-grid">
      <label>Scope<select id="searchScope">
        <option value="document">Current document</option>
        <option value="page">Current page</option>
        <option value="selection">Current selection</option>
        <option value="container">Current container</option>
      </select></label>
      <label>Object<select id="searchType">
        <option value="all">All objects</option>
        <option value="concept">Concepts</option>
        <option value="text">Plain text</option>
        <option value="status">Status nodes</option>
        <option value="note">Rich notes</option>
        <option value="todo">To-do lists</option>
        <option value="table">Tables</option>
        <option value="frame">Frames</option>
        <option value="swimlane">Swimlanes</option>
        <option value="edge">Relationships</option>
      </select></label>
      <label>Property<select id="searchProperty">
        <option value="all">All properties</option>
        <option value="title">Titles</option>
        <option value="body">Body text</option>
        <option value="field">Table fields</option>
        <option value="item">To-do items</option>
        <option value="status">Statuses</option>
        <option value="relationship">Relationships</option>
        <option value="port">Ports</option>
        <option value="metadata">Metadata</option>
        <option value="id">Stable IDs</option>
      </select></label>
      <label>Match<select id="searchMode">
        <option value="partial">Contains</option>
        <option value="exact">Exact value</option>
        <option value="regex">Regular expression</option>
      </select></label>
    </div>
    <div class="search-checks">
      <label><input id="searchCase" type="checkbox"> Match case</label>
      <label><input id="searchWholeWord" type="checkbox"> Whole word</label>
    </div>
    <details class="search-advanced">
      <summary>More filters</summary>
      <div class="search-filter-grid">
        <label>Status<select id="searchStatus"><option value="all">Any status</option></select></label>
        <label>Relationship<select id="searchRelationship"><option value="all">Any relationship</option></select></label>
        <label>Visibility<select id="searchVisibility">
          <option value="all">Any visibility</option>
          <option value="visible">Visible in viewport</option>
          <option value="hidden">Hidden or collapsed</option>
          <option value="offcanvas">Off canvas</option>
          <option value="locked">Locked</option>
        </select></label>
        <label>Recent<select id="searchRecent"><option value="">Recent searches</option></select></label>
        <label>Property name<input id="searchPropertyName" type="text" placeholder="owner, risk, tags…"></label>
        <label>Property value<input id="searchPropertyValue" type="text" placeholder="Optional value filter"></label>
      </div>
    </details>
    <div class="search-actions">
      <button type="button" id="searchToggleReplace">Find and replace</button>
      <button type="button" id="searchSelectAll">Select result objects</button>
      <button type="button" id="searchBack" title="Return to the previous camera and selection">Back</button>
    </div>
    <div class="search-replace-controls" id="searchReplaceControls" hidden>
      <label for="searchReplaceInput">Replace with</label>
      <input id="searchReplaceInput" type="text">
      <button type="button" id="searchPreviewCurrent">Preview current</button>
      <button type="button" id="searchPreviewAll" class="primary">Preview all</button>
    </div>
    <div id="searchError" class="search-error" role="alert" hidden></div>
    <div id="searchSummary" class="search-summary" aria-live="polite">0 results</div>
    <div id="searchResults" class="search-results" role="listbox" tabindex="0"
         aria-label="Search results"></div>
    <div id="searchReplacePreview" class="search-replace-preview" hidden>
      <div class="search-replace-preview-head">
        <strong id="searchReplaceSummary">Replacement preview</strong>
        <span>
          <button type="button" id="searchCheckAll">All</button>
          <button type="button" id="searchCheckNone">None</button>
        </span>
      </div>
      <div id="searchReplaceList" class="search-replace-list"></div>
      <div class="search-replace-apply">
        <button type="button" id="searchCancelReplace">Cancel</button>
        <button type="button" id="searchApplyReplace" class="primary">Apply selected</button>
      </div>
    </div>`;
  document.body.appendChild(searchPanel);

  const queryControls = searchPanel.querySelectorAll(
    "#searchInput,#searchScope,#searchType,#searchProperty,#searchMode,#searchCase,#searchWholeWord," +
    "#searchStatus,#searchRelationship,#searchVisibility,#searchPropertyName,#searchPropertyValue");
  queryControls.forEach(control => {
    control.addEventListener(control.matches("select,input[type=checkbox]") ? "change" : "input", () => {
      searchDiscoveryOwnerIds = null;
      scheduleSearchRun();
    });
  });
  searchPanel.querySelector("#searchInput").addEventListener("keydown", event => {
    if (event.key === "ArrowDown"){
      event.preventDefault();
      searchPanel.querySelector("#searchResults").focus();
    } else if (event.key === "Enter"){
      event.preventDefault();
      activateSearchResult(Math.max(0, searchActiveIndex));
    } else if (event.key === "Escape"){
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel();
    }
  });
  searchPanel.querySelector("#searchResults").addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp"){
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      searchActiveIndex = searchResults.length
        ? (Math.max(0, searchActiveIndex) + delta + searchResults.length) % searchResults.length : -1;
      searchRenderResults();
      searchPanel.querySelector(`[data-search-index="${searchActiveIndex}"]`)?.scrollIntoView({block:"nearest"});
    } else if (event.key === "Enter"){
      event.preventDefault();
      activateSearchResult(searchActiveIndex);
    } else if (event.key === "Escape"){
      event.preventDefault();
      searchPanel.querySelector("#searchInput").focus();
    }
  });
  searchPanel.querySelector("#searchClose").addEventListener("click", closeSearchPanel);
  searchPanel.querySelector("#searchPrevious").addEventListener("click", activatePreviousSearchResult);
  searchPanel.querySelector("#searchNext").addEventListener("click", activateNextSearchResult);
  searchPanel.querySelector("#searchBack").addEventListener("click", searchRestoreNavigation);
  searchPanel.querySelector("#searchToggleReplace").addEventListener("click", () => {
    const controls = searchPanel.querySelector("#searchReplaceControls");
    controls.hidden = !controls.hidden;
    if (!controls.hidden) searchPanel.querySelector("#searchReplaceInput").focus();
  });
  searchPanel.querySelector("#searchPreviewCurrent").addEventListener("click", () => previewSearchReplace(true));
  searchPanel.querySelector("#searchPreviewAll").addEventListener("click", () => previewSearchReplace(false));
  searchPanel.querySelector("#searchApplyReplace").addEventListener("click", applySearchReplace);
  searchPanel.querySelector("#searchCancelReplace").addEventListener("click", () => {
    searchProposal = null;
    searchPanel.querySelector("#searchReplacePreview").hidden = true;
  });
  searchPanel.querySelector("#searchCheckAll").addEventListener("click", () => {
    searchPanel.querySelectorAll("[data-proposal-index]:not(:disabled)").forEach(input => { input.checked = true; });
  });
  searchPanel.querySelector("#searchCheckNone").addEventListener("click", () => {
    searchPanel.querySelectorAll("[data-proposal-index]:not(:disabled)").forEach(input => { input.checked = false; });
  });
  searchPanel.querySelector("#searchRecent").addEventListener("change", event => {
    if (!event.target.value) return;
    searchPanel.querySelector("#searchInput").value = event.target.value;
    searchDiscoveryOwnerIds = null;
    runSearch();
  });
  searchPanel.querySelector("#searchSelectAll").addEventListener("click", selectAllSearchResults);
  updateRecentSearchOptions();
  updateSearchFilterOptions();
  return searchPanel;
}

function openSearchPanel(opts = {}){
  ensureSearchPanel();
  searchPanel.hidden = false;
  document.body.classList.add("search-open");
  updateSearchFilterOptions();
  refreshSearchIndex();
  if (opts.reset){
    searchPanel.querySelector("#searchInput").value = "";
    searchPanel.querySelector("#searchScope").value = "document";
    searchPanel.querySelector("#searchType").value = "all";
    searchPanel.querySelector("#searchProperty").value = "all";
    searchPanel.querySelector("#searchMode").value = "partial";
    searchPanel.querySelector("#searchCase").checked = false;
    searchPanel.querySelector("#searchWholeWord").checked = false;
    searchPanel.querySelector("#searchStatus").value = "all";
    searchPanel.querySelector("#searchRelationship").value = "all";
    searchPanel.querySelector("#searchVisibility").value = "all";
    searchPanel.querySelector("#searchPropertyName").value = "";
    searchPanel.querySelector("#searchPropertyValue").value = "";
  }
  if (opts.text != null) searchPanel.querySelector("#searchInput").value = String(opts.text);
  if (opts.scope) searchPanel.querySelector("#searchScope").value = opts.scope;
  if (opts.type) searchPanel.querySelector("#searchType").value = opts.type;
  if (opts.property) searchPanel.querySelector("#searchProperty").value = opts.property;
  if (opts.visibility) searchPanel.querySelector("#searchVisibility").value = opts.visibility;
  searchDiscoveryOwnerIds = opts.ownerIds ? new Set(opts.ownerIds) : null;
  runSearch();
  const input = searchPanel.querySelector("#searchInput");
  input.focus();
  if (opts.selectText !== false) input.select();
  announce("Search opened. Enter text or choose filters to find diagram objects.");
  return searchPanel;
}
function closeSearchPanel(){
  if (!searchPanel) return;
  searchPanel.hidden = true;
  document.body.classList.remove("search-open");
  document.querySelectorAll(".search-hit-active").forEach(element =>
    element.classList.remove("search-hit-active"));
  announce("Search closed.");
  board.focus();
}
function searchPanelOpen(){ return !!searchPanel && !searchPanel.hidden; }

function selectAllSearchResults(){
  const nodeIds = [...new Set(searchResults.filter(result => result.ownerKind === "node").map(result => result.ownerId))];
  const edgeIds = [...new Set(searchResults.filter(result => result.ownerKind === "edge").map(result => result.ownerId))];
  if (nodeIds.length){
    setSelection("node", nodeIds);
    render();
    announce(`Selected ${nodeIds.length} result object${nodeIds.length === 1 ? "" : "s"}` +
      (edgeIds.length ? `; ${edgeIds.length} relationship result${edgeIds.length === 1 ? "" : "s"} not included in mixed selection.` : "."));
    return nodeIds;
  }
  if (edgeIds.length){
    setSelection("edge", edgeIds);
    render();
    announce(`Selected ${edgeIds.length} relationship result${edgeIds.length === 1 ? "" : "s"}.`);
    return edgeIds;
  }
  announce("There are no result objects to select.");
  return [];
}

function searchConnectedOwnerIds(){
  const seedNodeIds = new Set(selectionIds("node"));
  const seedEdgeIds = new Set(selectionIds("edge"));
  const nodeIds = new Set(seedNodeIds);
  const edgeIds = new Set(seedEdgeIds);
  for (const edge of state.edges){
    if (seedNodeIds.has(edge.from) || seedNodeIds.has(edge.to) || seedEdgeIds.has(edge.id)){
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
      edgeIds.add(edge.id);
    }
  }
  return [
    ...[...nodeIds].map(id => searchOwnerKey("node", id)),
    ...[...edgeIds].map(id => searchOwnerKey("edge", id))
  ];
}
function openConnectedSearch(){
  const ids = searchConnectedOwnerIds();
  if (!ids.length){ announce("Select a node or relationship to find connected objects."); return false; }
  openSearchPanel({reset:true, ownerIds:ids, selectText:false});
  return true;
}
function openSelectedReferencesSearch(){
  const node = singleSelectedNode();
  if (!node){ announce("Select one node to find references."); return false; }
  const edgeIds = state.edges
    .filter(edge => edge.from === node.id || edge.to === node.id)
    .map(edge => searchOwnerKey("edge", edge.id));
  openSearchPanel({
    reset:true,
    text:node.title || node.id,
    ownerIds:edgeIds,
    selectText:false
  });
  return true;
}
function openHiddenSearch(){
  openSearchPanel({reset:true, visibility:"hidden", selectText:false});
  return true;
}
function openOffCanvasSearch(){
  openSearchPanel({reset:true, visibility:"offcanvas", selectText:false});
  return true;
}
function openDuplicateNameSearch(){
  const groups = new Map();
  for (const node of state.nodes){
    const key = searchNormalizeText(node.title).trim().toLocaleLowerCase();
    if (!key) continue;
    const ids = groups.get(key) || [];
    ids.push(searchOwnerKey("node", node.id));
    groups.set(key, ids);
  }
  const ids = [...groups.values()].filter(group => group.length > 1).flat();
  openSearchPanel({reset:true, ownerIds:ids, property:"title", selectText:false});
  if (!ids.length) announce("No duplicate object names were found.");
  return ids;
}
