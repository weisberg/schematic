"use strict";

/* =====================================================================
   STYLE SYSTEM — document tokens, reusable style classes, portable
   libraries, template variables, and versioned component definitions.

   Definitions are stored once and referenced by stable IDs. Resolution is
   deliberately separate from conditional rules and direct overrides:
     product/direct fallback → document token → style class → rule → override.
   ===================================================================== */

const STYLE_SCHEMA_VERSION = 1;
const STYLE_LIBRARY_SCHEMA_VERSION = 1;
const STYLE_BUILTIN_TIMESTAMP = "2026-07-24T00:00:00.000Z";
const STYLE_PROPERTY_DEFINITIONS = Object.freeze({
  fill:{label:"Fill",type:"color",appliesTo:["node"]},
  titleBandColor:{label:"Title band",type:"color",appliesTo:["swimlane"]},
  textColor:{label:"Text color",type:"color",appliesTo:["node"]},
  borderColor:{label:"Border color",type:"color",appliesTo:["node"]},
  borderWidth:{label:"Border width",type:"number",min:.5,max:16,appliesTo:["node"]},
  borderStyle:{label:"Border style",type:"lineStyle",appliesTo:["node"]},
  fontFamily:{label:"Font family",type:"fontFamily",appliesTo:["node","edge"]},
  fontSize:{label:"Font size",type:"number",min:8,max:96,appliesTo:["node","edge"]},
  fontWeight:{label:"Font weight",type:"number",min:300,max:900,appliesTo:["node","edge"]},
  lineHeight:{label:"Line height",type:"number",min:.8,max:2.4,appliesTo:["node"]},
  cornerRadius:{label:"Corner radius",type:"number",min:0,max:120,appliesTo:["node"]},
  spacing:{label:"Spacing",type:"number",min:0,max:120,appliesTo:["node"]},
  iconSize:{label:"Icon size",type:"number",min:10,max:96,appliesTo:["node"]},
  lineColor:{label:"Link color",type:"color",appliesTo:["edge"]},
  lineWidth:{label:"Link width",type:"number",min:.5,max:16,appliesTo:["edge"]},
  lineStyle:{label:"Link style",type:"lineStyle",appliesTo:["edge"]},
  labelTextColor:{label:"Label text",type:"color",appliesTo:["edge"]},
  labelBackgroundColor:{label:"Label background",type:"color",appliesTo:["edge"]},
  opacity:{label:"Opacity",type:"number",min:.08,max:1,appliesTo:["node","edge"]},
  badgeColor:{label:"Badge color",type:"color",appliesTo:["node"]}
});
const STYLE_TOKEN_TYPES = Object.freeze({
  color:{label:"Color",sample:"#2456E6"},
  number:{label:"Number",sample:2},
  lineStyle:{label:"Line style",sample:"solid"},
  fontFamily:{label:"Font family",sample:"Archivo, sans-serif"},
  text:{label:"Text",sample:""}
});
const STYLE_CLASS_TARGETS = [
  ["node","All nodes"],["edge","All links"],["concept","Concepts"],["status","Status nodes"],
  ["table","Tables"],["todo","To-do lists"],["note","Rich notes"],["text","Text boxes"],
  ["frame","Frames"],["swimlane","Swimlanes"]
];
const STYLE_AUTHORITIES = new Set([
  "product","document","workspace","organization","imported","detached"
]);
const STYLE_DIRECT_FIELDS = Object.freeze({
  fill:"color",titleBandColor:"titleColor",textColor:"fontColor",
  borderColor:"borderColor",borderWidth:"borderWidth",borderStyle:"borderStyle",
  fontFamily:"fontFamily",fontSize:"fontSize",fontWeight:"fontWeight",
  lineHeight:"lineHeight",cornerRadius:"cornerRadius",spacing:"spacing",
  iconSize:"iconSize",lineColor:"lineColor",lineWidth:"lineWidth",lineStyle:"lineStyle",
  labelTextColor:"labelTextColor",labelBackgroundColor:"labelBackgroundColor",
  opacity:"opacity",badgeColor:"badgeColor"
});
const STYLE_PROTECTED_COMPONENT_FIELDS = new Set([
  "id","x","y","componentInstanceId","componentDefinitionId","componentChildId",
  "componentVersion","semanticId","relationshipId","pageId"
]);
const STYLE_INSTANCE_LOCAL_FIELDS = new Set([
  "x","y","w","h","manualWidth","manualHeight","widthBeforeMatch","rotation",
  "flipX","flipY","pinned","layerId","groupId"
]);

let styleNormalizedState = null;
let styleRevision = 0;
let styleResolutionCache = new Map();
let styleDependencyIndex = null;
let styleManagerOpen = false;
let styleManagerMode = "tokens";
let styleSelectedId = "";
let styleManagerReturnFocus = null;
let styleImportPreview = null;
let styleComponentPreview = null;
const styleStats = {
  resolutions:0,cacheHits:0,indexBuilds:0,targetedInvalidations:0,
  fullInvalidations:0,lastImpactCount:0,lastImpactDurationMs:0
};

function styleClone(value){
  return value == null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}
function styleText(value,fallback="",max=160){
  const text = typeof value === "string" ? value.replace(/\s+/g," ").trim() : "";
  return (text || fallback).slice(0,max);
}
function styleUid(prefix){
  return `${prefix}-${typeof uid === "function" ? uid() : Date.now().toString(36)}`;
}
function styleNow(){ return new Date().toISOString(); }
function styleSemver(value,fallback="1.0.0"){
  const text = String(value || "");
  return /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(text) ? text : fallback;
}
function styleObjectKind(object){
  return object && typeof object === "object" && "from" in object && "to" in object
    ? "edge" : "node";
}
function styleObjectCapability(object){
  return styleObjectKind(object) === "edge" ? "edge" : object.type || "node";
}
function styleObjectLabel(object){
  if (!object) return "Object";
  if (styleObjectKind(object) === "edge"){
    const from = typeof nodeById === "function" ? nodeById(object.from) : null;
    const to = typeof nodeById === "function" ? nodeById(object.to) : null;
    return object.label || `${from?.title || object.from} → ${to?.title || object.to}`;
  }
  return object.title || object.id;
}
function styleLibraryRecord(raw = {}){
  return {
    schemaVersion:STYLE_LIBRARY_SCHEMA_VERSION,
    id:styleText(raw.id,"library-document",100),
    name:styleText(raw.name,"Document style library",100),
    version:styleSemver(raw.version),
    description:styleText(raw.description,
      "Offline, document-owned definitions for this diagram.",500),
    owner:styleText(raw.owner,"",100),
    scope:["document","workspace","organization"].includes(raw.scope) ? raw.scope : "document",
    authority:STYLE_AUTHORITIES.has(raw.authority) ? raw.authority : "document",
    embedded:raw.embedded !== false,
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : styleNow(),
    ...(raw.sourceUrl ? {sourceUrl:String(raw.sourceUrl).slice(0,500)} : {}),
    ...(raw.license ? {license:styleText(raw.license,"",120)} : {}),
    ...(raw.changeNotes ? {changeNotes:styleText(raw.changeNotes,"",1000)} : {})
  };
}
function styleStarterTokens(){
  return [
    {id:"token-color-primary",name:"Primary",type:"color",value:"#2456E6",
      description:"Primary system and information color."},
    {id:"token-color-positive",name:"Positive",type:"color",value:"#007873",
      description:"Completed, supported, or healthy."},
    {id:"token-color-warning",name:"Warning",type:"color",value:"#C20029",
      description:"Blocked, destructive, or urgent."},
    {id:"token-color-external",name:"External",type:"color",value:"#8A3FA8",
      description:"External systems and boundaries."},
    {id:"token-color-proposed",name:"Proposed",type:"color",value:"#FFE9A8",
      description:"Proposed or in-design work."},
    {id:"token-color-muted",name:"Muted",type:"color",value:"#6B7683",
      description:"Deprecated or secondary content."},
    {id:"token-color-surface",name:"Surface",type:"color",
      themeValues:{light:"#FFFFFF",dark:"#151D26",highContrast:"#FFFFFF"},
      value:"#FFFFFF",semantic:true,description:"Readable surface for the active theme."},
    {id:"token-color-ink",name:"Ink",type:"color",
      themeValues:{light:"#16232F",dark:"#E6EDF4",highContrast:"#000000"},
      value:"#16232F",semantic:true,description:"Readable primary text for the active theme."},
    {id:"token-border-standard",name:"Standard border",type:"number",value:2},
    {id:"token-border-emphasis",name:"Emphasis border",type:"number",value:3},
    {id:"token-link-standard",name:"Standard link",type:"number",value:1.7},
    {id:"token-radius-standard",name:"Standard radius",type:"number",value:10},
    {id:"token-spacing-standard",name:"Standard spacing",type:"number",value:12},
    {id:"token-icon-standard",name:"Standard icon",type:"number",value:28},
    {id:"token-font-body",name:"Body typeface",type:"fontFamily",value:"Archivo, sans-serif"},
    {id:"token-font-mono",name:"Model typeface",type:"fontFamily",
      value:"'IBM Plex Mono', monospace"}
  ];
}
function styleStarterClasses(){
  const token = tokenId => ({tokenId});
  return [
    {id:"class-primary-system",name:"Primary system",appliesTo:["node"],
      description:"A central, actively maintained system.",
      properties:{fill:token("token-color-primary"),textColor:{value:"#FFFFFF"},
        borderColor:token("token-color-primary"),borderWidth:token("token-border-standard"),
        cornerRadius:token("token-radius-standard")}},
    {id:"class-external-dependency",name:"External dependency",appliesTo:["node","edge"],
      description:"A dependency outside the modeled team's direct control.",
      properties:{fill:token("token-color-external"),lineColor:token("token-color-external"),
        borderColor:token("token-color-external"),lineStyle:{value:"dash"}}},
    {id:"class-deprecated",name:"Deprecated",appliesTo:["node","edge"],modifier:true,
      description:"Kept for context but no longer preferred.",
      properties:{opacity:{value:.48},borderStyle:{value:"dash"},lineStyle:{value:"dash"}}},
    {id:"class-proposed",name:"Proposed",appliesTo:["node","edge"],modifier:true,
      description:"Planned or under consideration.",
      properties:{fill:token("token-color-proposed"),borderStyle:{value:"dash"},
        lineStyle:{value:"dash"}}},
    {id:"class-security-boundary",name:"Security boundary",appliesTo:["frame","swimlane"],
      description:"A visible trust or security boundary.",
      properties:{borderColor:token("token-color-warning"),
        borderWidth:token("token-border-emphasis"),borderStyle:{value:"dash"}}},
    {id:"class-data-store",name:"Data store",appliesTo:["table","concept"],
      description:"Persistent or authoritative data storage.",
      properties:{fill:token("token-color-positive"),textColor:{value:"#FFFFFF"},
        borderColor:token("token-color-positive")}},
    {id:"class-annotation",name:"Annotation",appliesTo:["note","text"],
      description:"Explanatory content rather than a modeled entity.",
      properties:{fill:{value:"#FFF7D6"},textColor:token("token-color-ink"),
        borderColor:{value:"#B05A00"},borderStyle:{value:"dot"}}}
  ];
}
function styleStarterTemplates(){
  return [{
    id:"template-project-kickoff",name:"Project kickoff",version:"1.0.0",
    description:"A configurable title and three-stage delivery starter.",
    variables:[
      {id:"project",label:"Project name",type:"text",required:true,default:"New initiative"},
      {id:"environment",label:"Environment",type:"enum",
        options:["Discovery","Pilot","Production"],default:"Discovery"},
      {id:"owner",label:"Owner",type:"text",default:"Unassigned"}
    ],
    blueprint:{
      nodes:[
        {key:"title",type:"text",x:0,y:0,title:"{{project}} — {{environment}}",
          styleClassId:"class-annotation"},
        {key:"plan",type:"status",x:0,y:90,title:"Plan {{project}}",status:"Not started",
          properties:{"template-owner":"{{owner}}"}},
        {key:"build",type:"status",x:360,y:90,title:"Build and validate",status:"Not started"},
        {key:"ship",type:"status",x:720,y:90,title:"Release",status:"Not started"}
      ],
      edges:[
        {from:"plan",to:"build",kind:"link",label:"Depends on"},
        {from:"build",to:"ship",kind:"link",label:"Triggers"}
      ]
    }
  }];
}
function defaultStyleSystem(){
  const builtin=item => ({...item,createdAt:STYLE_BUILTIN_TIMESTAMP,
    updatedAt:STYLE_BUILTIN_TIMESTAMP});
  return {
    schemaVersion:STYLE_SCHEMA_VERSION,
    library:styleLibraryRecord({updatedAt:STYLE_BUILTIN_TIMESTAMP}),
    tokens:styleStarterTokens().map((token,index) => styleNormalizeToken(builtin(token),index,new Set())),
    classes:styleStarterClasses().map((item,index) => styleNormalizeClass(builtin(item),index,new Set())),
    components:[],
    templates:styleStarterTemplates().map((item,index) => styleNormalizeTemplate(builtin(item),index,new Set())),
    importedLibraries:[]
  };
}

function styleNormalizeTokenValue(type,value){
  if (type === "color") return normalizeColorValue(value) || "#2456E6";
  if (type === "number"){
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(-10000,Math.min(10000,number)) : 0;
  }
  if (type === "lineStyle") return ["solid","dash","dot"].includes(value) ? value : "solid";
  if (type === "fontFamily")
    return styleText(String(value || ""),"Archivo, sans-serif",160);
  return String(value == null ? "" : value).slice(0,500);
}
function styleNormalizeToken(raw,index,ids){
  if (!raw || typeof raw !== "object") return null;
  let id = styleText(raw.id,"",100);
  if (!id || ids.has(id)) id = `token-${index+1}-${styleUid("t")}`;
  ids.add(id);
  const type = Object.hasOwn(STYLE_TOKEN_TYPES,raw.type) ? raw.type : "color";
  const out = {
    schemaVersion:1,id,name:styleText(raw.name,`Token ${index+1}`,100),type,
    value:styleNormalizeTokenValue(type,raw.value),
    description:styleText(raw.description,"",500),
    semantic:raw.semantic === true,
    order:Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    createdAt:typeof raw.createdAt === "string" ? raw.createdAt : styleNow(),
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : styleNow()
  };
  if (raw.ref) out.ref=styleText(raw.ref,"",100);
  if (raw.themeValues && typeof raw.themeValues === "object"){
    out.themeValues={};
    for (const [theme,value] of Object.entries(raw.themeValues).slice(0,12))
      out.themeValues[styleText(theme,"",60)] = styleNormalizeTokenValue(type,value);
  }
  if (raw.libraryId) out.libraryId=styleText(raw.libraryId,"",100);
  if (raw.authority && STYLE_AUTHORITIES.has(raw.authority)) out.authority=raw.authority;
  if (raw.deprecated === true) out.deprecated=true;
  if (raw.replacementId) out.replacementId=styleText(raw.replacementId,"",100);
  if (raw.extensions && typeof raw.extensions === "object") out.extensions=styleClone(raw.extensions);
  return out;
}
function styleNormalizePropertyValue(property,value){
  const definition=STYLE_PROPERTY_DEFINITIONS[property];
  if (!definition) return styleClone(value);
  if (definition.type === "color") return normalizeColorValue(value) || "#2456E6";
  if (definition.type === "lineStyle")
    return ["solid","dash","dot"].includes(value) ? value : "solid";
  if (definition.type === "fontFamily")
    return styleText(String(value || ""),"Archivo, sans-serif",160);
  if (definition.type === "number"){
    const number=Number(value);
    const fallback=Number.isFinite(definition.min) ? definition.min : 0;
    return Math.max(definition.min ?? -10000,Math.min(definition.max ?? 10000,
      Number.isFinite(number) ? number : fallback));
  }
  return styleClone(value);
}
function styleNormalizeAssignment(raw,property){
  const source = raw && typeof raw === "object" ? raw : {value:raw};
  const out = {};
  if (source.tokenId) out.tokenId=styleText(source.tokenId,"",100);
  if (Object.hasOwn(source,"value")) out.value=styleNormalizePropertyValue(property,source.value);
  if (Object.hasOwn(source,"fallback")) out.fallback=styleNormalizePropertyValue(property,source.fallback);
  return out.tokenId || Object.hasOwn(out,"value") || Object.hasOwn(out,"fallback") ? out : null;
}
function styleNormalizeClass(raw,index,ids){
  if (!raw || typeof raw !== "object") return null;
  let id=styleText(raw.id,"",100);
  if (!id || ids.has(id)) id=`class-${index+1}-${styleUid("c")}`;
  ids.add(id);
  const appliesTo=[...new Set((Array.isArray(raw.appliesTo) ? raw.appliesTo : ["node"])
    .map(String).filter(value => STYLE_CLASS_TARGETS.some(([id]) => id === value)))];
  const properties={};
  const unknownProperties={};
  for (const [property,value] of Object.entries(raw.properties || {})){
    if (!Object.hasOwn(STYLE_PROPERTY_DEFINITIONS,property)){
      unknownProperties[property]=styleClone(value);
      continue;
    }
    const assignment=styleNormalizeAssignment(value,property);
    if (assignment) properties[property]=assignment;
  }
  const out={
    schemaVersion:1,id,name:styleText(raw.name,`Style ${index+1}`,100),
    description:styleText(raw.description,"",500),
    appliesTo:appliesTo.length ? appliesTo : ["node"],
    properties,modifier:raw.modifier === true,
    order:Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    createdAt:typeof raw.createdAt === "string" ? raw.createdAt : styleNow(),
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : styleNow()
  };
  if (raw.baseClassId) out.baseClassId=styleText(raw.baseClassId,"",100);
  if (raw.libraryId) out.libraryId=styleText(raw.libraryId,"",100);
  if (raw.authority && STYLE_AUTHORITIES.has(raw.authority)) out.authority=raw.authority;
  if (raw.deprecated === true) out.deprecated=true;
  if (raw.replacementId) out.replacementId=styleText(raw.replacementId,"",100);
  if (raw.extensions && typeof raw.extensions === "object") out.extensions=styleClone(raw.extensions);
  if (Object.keys(unknownProperties).length)
    out.extensions={...(out.extensions || {}),unknownProperties};
  return out;
}
function styleNormalizeVariable(raw,index){
  const source=raw && typeof raw === "object" ? raw : {};
  const type=["text","number","boolean","enum","color"].includes(source.type) ? source.type : "text";
  const item={
    id:styleText(source.id,`variable-${index+1}`,80),
    label:styleText(source.label,`Variable ${index+1}`,100),type,
    required:source.required === true
  };
  if (Object.hasOwn(source,"default")) item.default=styleClone(source.default);
  if (Array.isArray(source.options)) item.options=source.options.map(String).slice(0,100);
  if (Number.isFinite(Number(source.min))) item.min=Number(source.min);
  if (Number.isFinite(Number(source.max))) item.max=Number(source.max);
  return item;
}
function styleNormalizeTemplate(raw,index,ids){
  if (!raw || typeof raw !== "object") return null;
  let id=styleText(raw.id,"",100);
  if (!id || ids.has(id)) id=`template-${index+1}-${styleUid("tpl")}`;
  ids.add(id);
  const blueprint=raw.blueprint && typeof raw.blueprint === "object"
    ? styleClone(raw.blueprint) : {nodes:[],edges:[]};
  if (!Array.isArray(blueprint.nodes)) blueprint.nodes=[];
  if (!Array.isArray(blueprint.edges)) blueprint.edges=[];
  const out={
    schemaVersion:1,id,name:styleText(raw.name,`Template ${index+1}`,100),
    version:styleSemver(raw.version),description:styleText(raw.description,"",500),
    variables:(Array.isArray(raw.variables) ? raw.variables : [])
      .slice(0,100).map(styleNormalizeVariable),
    blueprint,order:Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    createdAt:typeof raw.createdAt === "string" ? raw.createdAt : styleNow(),
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : styleNow()
  };
  if (raw.libraryId) out.libraryId=styleText(raw.libraryId,"",100);
  if (raw.extensions && typeof raw.extensions === "object") out.extensions=styleClone(raw.extensions);
  return out;
}
function styleNormalizeComponent(raw,index,ids){
  if (!raw || typeof raw !== "object") return null;
  let id=styleText(raw.id,"",100);
  if (!id || ids.has(id)) id=`component-${index+1}-${styleUid("cmp")}`;
  ids.add(id);
  const childIds=new Set();
  const nodes=(Array.isArray(raw.nodes) ? raw.nodes : []).slice(0,5000).map((node,nodeIndex) => {
    const child=styleClone(node);
    let childId=styleText(child.componentChildId || child.id,"",100);
    if (!childId || childIds.has(childId)) childId=`child-${nodeIndex+1}`;
    childIds.add(childId);
    child.id=childId;
    child.componentChildId=childId;
    delete child.componentInstanceId;
    delete child.componentDefinitionId;
    delete child.componentVersion;
    return child;
  });
  const edges=(Array.isArray(raw.edges) ? raw.edges : []).slice(0,10000).map((edge,edgeIndex) => {
    const item=styleClone(edge);
    item.id=styleText(item.componentChildId || item.id,`edge-${edgeIndex+1}`,100);
    item.componentChildId=item.id;
    delete item.componentInstanceId;
    delete item.componentDefinitionId;
    delete item.componentVersion;
    return item;
  }).filter(edge => childIds.has(edge.from) && childIds.has(edge.to));
  const out={
    schemaVersion:1,id,name:styleText(raw.name,`Component ${index+1}`,100),
    version:styleSemver(raw.version),description:styleText(raw.description,"",500),
    nodes,edges,
    exposedProperties:Array.isArray(raw.exposedProperties)
      ? [...new Set(raw.exposedProperties.map(String))].slice(0,200) : [],
    externalPorts:Array.isArray(raw.externalPorts) ? styleClone(raw.externalPorts).slice(0,200) : [],
    nesting:raw.nesting === "one-level" ? "one-level" : "none",
    order:Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    createdAt:typeof raw.createdAt === "string" ? raw.createdAt : styleNow(),
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : styleNow()
  };
  if (raw.libraryId) out.libraryId=styleText(raw.libraryId,"",100);
  if (raw.extensions && typeof raw.extensions === "object") out.extensions=styleClone(raw.extensions);
  return out;
}
function styleNormalizeImportedLibrary(raw,index){
  if (!raw || typeof raw !== "object") return null;
  const manifest=styleLibraryRecord(raw.manifest || raw);
  return {
    id:styleText(raw.id || manifest.id,`import-${index+1}`,100),
    manifest,
    pinnedVersion:styleSemver(raw.pinnedVersion || manifest.version),
    status:["current","update-available","stale","missing","diverged"].includes(raw.status)
      ? raw.status : "current",
    cachedAt:typeof raw.cachedAt === "string" ? raw.cachedAt : styleNow(),
    embedded:raw.embedded !== false,
    ...(raw.checksum ? {checksum:String(raw.checksum)} : {}),
    ...(raw.package ? {package:styleClone(raw.package)} : {})
  };
}
function normalizeStyleSystem(raw){
  if (!raw || typeof raw !== "object") return defaultStyleSystem();
  const source=raw && typeof raw === "object" ? raw : {};
  if (Number(source.schemaVersion) > STYLE_SCHEMA_VERSION){
    return {...defaultStyleSystem(),futurePayload:styleClone(source),
      warning:`Style schema ${source.schemaVersion} is newer than this application.`};
  }
  const tokenIds=new Set(),classIds=new Set(),componentIds=new Set(),templateIds=new Set();
  const builtins=items => items.map(item => ({...item,createdAt:STYLE_BUILTIN_TIMESTAMP,
    updatedAt:STYLE_BUILTIN_TIMESTAMP}));
  const tokens=(Array.isArray(source.tokens) ? source.tokens : builtins(styleStarterTokens()))
    .map((item,index) => styleNormalizeToken(item,index,tokenIds)).filter(Boolean);
  const classes=(Array.isArray(source.classes) ? source.classes : builtins(styleStarterClasses()))
    .map((item,index) => styleNormalizeClass(item,index,classIds)).filter(Boolean);
  const components=(Array.isArray(source.components) ? source.components : [])
    .map((item,index) => styleNormalizeComponent(item,index,componentIds)).filter(Boolean);
  const templates=(Array.isArray(source.templates) ? source.templates : builtins(styleStarterTemplates()))
    .map((item,index) => styleNormalizeTemplate(item,index,templateIds)).filter(Boolean);
  const importedLibraries=(Array.isArray(source.importedLibraries) ? source.importedLibraries : [])
    .map(styleNormalizeImportedLibrary).filter(Boolean);
  return {
    schemaVersion:STYLE_SCHEMA_VERSION,
    library:styleLibraryRecord(source.library || {updatedAt:STYLE_BUILTIN_TIMESTAMP}),
    tokens,classes,components,templates,importedLibraries,
    ...(source.futurePayload ? {futurePayload:styleClone(source.futurePayload)} : {}),
    ...(source.extensions && typeof source.extensions === "object"
      ? {extensions:styleClone(source.extensions)} : {})
  };
}
function ensureStyleSystem(){
  if (state.styles && state.styles === styleNormalizedState) return state.styles;
  state.styles=normalizeStyleSystem(state.styles);
  styleNormalizedState=state.styles;
  styleInvalidateAll("normalize");
  styleRepairReferences({mutate:true});
  return state.styles;
}
function styleOrdered(items){
  return items.slice().sort((a,b) => Number(a.order)-Number(b.order) || a.id.localeCompare(b.id));
}
function cleanStyleSystemForDocument(raw=state.styles){
  const normalized=normalizeStyleSystem(raw);
  const clean={
    schemaVersion:STYLE_SCHEMA_VERSION,
    library:normalized.library,
    tokens:styleOrdered(normalized.tokens),
    classes:styleOrdered(normalized.classes),
    components:styleOrdered(normalized.components),
    templates:styleOrdered(normalized.templates),
    importedLibraries:normalized.importedLibraries.slice().sort((a,b) => a.id.localeCompare(b.id))
  };
  if (normalized.futurePayload) clean.futurePayload=styleClone(normalized.futurePayload);
  if (normalized.extensions) clean.extensions=styleClone(normalized.extensions);
  return clean;
}
function styleTokens(){ return styleOrdered(ensureStyleSystem().tokens); }
function styleTokenById(id){ return ensureStyleSystem().tokens.find(item => item.id === id) || null; }
function styleClasses(){ return styleOrdered(ensureStyleSystem().classes); }
function styleClassById(id){ return ensureStyleSystem().classes.find(item => item.id === id) || null; }
function styleComponents(){ return styleOrdered(ensureStyleSystem().components); }
function styleComponentById(id){ return ensureStyleSystem().components.find(item => item.id === id) || null; }
function styleTemplates(){ return styleOrdered(ensureStyleSystem().templates); }
function styleTemplateById(id){ return ensureStyleSystem().templates.find(item => item.id === id) || null; }

function styleTokenCompatible(token,property){
  const definition=STYLE_PROPERTY_DEFINITIONS[property];
  if (!token || !definition) return false;
  if (definition.type === "color") return token.type === "color";
  if (definition.type === "lineStyle") return token.type === "lineStyle";
  if (definition.type === "fontFamily") return token.type === "fontFamily";
  if (definition.type === "number") return token.type === "number";
  return token.type === definition.type || token.type === "text";
}
function stylePropertyCompatible(property,object){
  const definition=STYLE_PROPERTY_DEFINITIONS[property];
  if (!definition || !object) return false;
  const kind=styleObjectKind(object),capability=styleObjectCapability(object);
  return definition.appliesTo.includes(kind) || definition.appliesTo.includes(capability);
}
function styleClassCompatible(item,object){
  if (!item || !object) return false;
  const kind=styleObjectKind(object),capability=styleObjectCapability(object);
  return item.appliesTo.includes(kind) || item.appliesTo.includes(capability);
}
function styleTokenThemeValue(token){
  if (!token) return undefined;
  const theme=typeof docTheme === "string" ? docTheme : "light";
  if (token.themeValues && Object.hasOwn(token.themeValues,theme)) return token.themeValues[theme];
  return token.value;
}
function styleLibraryProvenance(id){
  const system=ensureStyleSystem();
  if (!id || id === system.library.id)
    return {libraryId:system.library.id,libraryVersion:system.library.version,
      libraryStatus:"embedded"};
  const imported=system.importedLibraries.find(item => item.id === id || item.manifest.id === id);
  return imported ? {libraryId:imported.manifest.id,libraryVersion:imported.pinnedVersion,
    libraryStatus:imported.status} : {libraryId:id,libraryVersion:"",libraryStatus:"missing"};
}
function styleResolveToken(id,expectedType="",trail=[]){
  const token=styleTokenById(id);
  if (!token) return {ok:false,error:`Missing token ${id}`,trace:trail,value:undefined};
  if (trail.includes(id))
    return {ok:false,error:`Token cycle: ${[...trail,id].join(" → ")}`,trace:[...trail,id],
      value:token.value};
  if (expectedType && token.type !== expectedType)
    return {ok:false,error:`${token.name} is ${token.type}, not ${expectedType}`,
      trace:[...trail,id],value:token.value,token};
  if (token.ref){
    const resolved=styleResolveToken(token.ref,token.type,[...trail,id]);
    return {...resolved,token,trace:resolved.trace || [...trail,id],
      chain:[token,...(resolved.chain || [])]};
  }
  return {ok:true,value:styleTokenThemeValue(token),token,trace:[...trail,id],chain:[token]};
}
function styleClassChain(id,trail=[]){
  const item=styleClassById(id);
  if (!item) return {classes:[],error:`Missing style class ${id}`};
  if (trail.includes(id))
    return {classes:[],error:`Class cycle: ${[...trail,id].join(" → ")}`};
  if (!item.baseClassId) return {classes:[item],error:""};
  const parent=styleClassChain(item.baseClassId,[...trail,id]);
  if (parent.error) return {classes:[item],error:parent.error};
  return {classes:[...parent.classes,item],error:""};
}
function styleValidateToken(token){
  const findings=[];
  if (!token) return [{severity:"error",code:"missing",message:"Token is missing."}];
  if (token.ref){
    const resolved=styleResolveToken(token.id);
    if (!resolved.ok) findings.push({severity:"error",code:"token-reference",message:resolved.error});
  }
  if (token.type === "color" && typeof formattingContrastRatio === "function"){
    const surface=styleResolveToken("token-color-surface","color");
    const ratio=surface.ok ? formattingContrastRatio(styleTokenThemeValue(token),surface.value) : null;
    if (ratio != null && ratio < 3)
      findings.push({severity:"warning",code:"contrast",
        message:`${ratio.toFixed(2)}:1 against the document surface.`});
  }
  if (token.deprecated) findings.push({severity:"warning",code:"deprecated",
    message:`Deprecated${token.replacementId ? `; replace with ${token.replacementId}` : ""}.`});
  return findings;
}
function styleValidateClass(item){
  const findings=[];
  if (!item) return [{severity:"error",code:"missing",message:"Style class is missing."}];
  const chain=styleClassChain(item.id);
  if (chain.error) findings.push({severity:"error",code:"class-cycle",message:chain.error});
  for (const [property,assignment] of Object.entries(item.properties)){
    const definition=STYLE_PROPERTY_DEFINITIONS[property];
    if (!definition){
      findings.push({severity:"warning",code:"unknown-property",message:`Unknown property ${property}.`});
      continue;
    }
    if (assignment.tokenId){
      const token=styleTokenById(assignment.tokenId);
      if (!token) findings.push({severity:"error",code:"missing-token",
        message:`${definition.label} references missing token ${assignment.tokenId}.`});
      else if (!styleTokenCompatible(token,property)) findings.push({severity:"error",
        code:"token-type",message:`${token.name} is incompatible with ${definition.label}.`});
    }
    if (!item.appliesTo.some(target =>
      definition.appliesTo.includes(target) ||
      target === "node" && definition.appliesTo.some(value => value !== "edge") ||
      target !== "edge" && definition.appliesTo.includes("node")))
      findings.push({severity:"warning",code:"inapplicable",
        message:`${definition.label} has no compatible target in this class.`});
  }
  if (item.properties.fill && item.properties.textColor &&
      typeof formattingContrastRatio === "function"){
    const fill=styleAssignmentValue(item.properties.fill,"fill").value;
    const text=styleAssignmentValue(item.properties.textColor,"textColor").value;
    const ratio=formattingContrastRatio(text,fill);
    if (ratio != null && ratio < 4.5)
      findings.push({severity:"warning",code:"contrast",
        message:`Text contrast is ${ratio.toFixed(2)}:1; target at least 4.5:1.`});
  }
  return findings;
}
function styleValidateSystem(){
  const findings=[];
  for (const token of styleTokens())
    for (const finding of styleValidateToken(token)) findings.push({...finding,kind:"token",id:token.id});
  for (const item of styleClasses())
    for (const finding of styleValidateClass(item)) findings.push({...finding,kind:"class",id:item.id});
  return findings;
}

function styleRawBaseValues(object){
  const kind=styleObjectKind(object),t=themeColors();
  if (kind === "edge"){
    const lineColor=normalizeHex(object.lineColor) ||
      (object.kind === "link" ? t.link : t.edge);
    return {
      lineColor,
      lineWidth:Number.isFinite(Number(object.lineWidth)) ? Number(object.lineWidth) : 1.7,
      lineStyle:["solid","dash","dot"].includes(object.lineStyle)
        ? object.lineStyle : object.kind === "link" ? "dash" : "solid",
      labelTextColor:normalizeHex(object.labelTextColor) || lineColor,
      labelBackgroundColor:normalizeHex(object.labelBackgroundColor) || t.labelBg,
      fontFamily:object.fontFamily || "'IBM Plex Mono', monospace",
      fontSize:Number.isFinite(Number(object.fontSize)) ? Number(object.fontSize) : 10.5,
      fontWeight:Number.isFinite(Number(object.fontWeight)) ? Number(object.fontWeight) : 600,
      opacity:Number.isFinite(Number(object.opacity)) ? Number(object.opacity) : 1
    };
  }
  const fill=normalizeHex(object.color) || (object.type === "frame" ? frameColorDefault()
    : object.type === "todo" ? todoColorDefault()
    : object.type === "table" ? t.ink : conceptColors()[1]);
  const baseFont=typeof rawNodeTextSize === "function" ? rawNodeTextSize(object)
    : Number(object.fontSize) || 14;
  return {
    fill,textColor:normalizeHex(object.fontColor) || autoInk(fill,t),
    borderColor:normalizeHex(object.borderColor) || t.ink,
    borderWidth:Number.isFinite(Number(object.borderWidth)) ? Number(object.borderWidth) : 1.2,
    borderStyle:["solid","dash","dot"].includes(object.borderStyle) ? object.borderStyle : "solid",
    fontFamily:object.fontFamily || (object.type === "table"
      ? "'IBM Plex Mono', monospace" : "Archivo, sans-serif"),
    fontSize:baseFont,
    fontWeight:Number.isFinite(Number(object.fontWeight)) ? Number(object.fontWeight) : 600,
    lineHeight:Number.isFinite(Number(object.lineHeight)) ? Number(object.lineHeight) : 1.25,
    cornerRadius:Number.isFinite(Number(object.cornerRadius)) ? Number(object.cornerRadius)
      : object.type === "frame" ? 14 : object.type === "swimlane" ? 10 : 8,
    spacing:Number.isFinite(Number(object.spacing)) ? Number(object.spacing) : 12,
    iconSize:Number.isFinite(Number(object.iconSize)) ? Number(object.iconSize) : 28,
    opacity:Number.isFinite(Number(object.opacity)) ? Number(object.opacity) : 1,
    badgeColor:normalizeHex(object.badgeColor) || "#2456E6",
    titleBandColor:normalizeHex(object.titleColor) || ""
  };
}
function styleAssignmentValue(assignment,property){
  if (!assignment) return {ok:false,value:undefined,sources:[]};
  const definition=STYLE_PROPERTY_DEFINITIONS[property];
  if (assignment.tokenId){
    const token=styleTokenById(assignment.tokenId);
    const resolved=styleResolveToken(assignment.tokenId,definition?.type || "");
    const value=resolved.ok ? resolved.value : Object.hasOwn(assignment,"fallback")
      ? assignment.fallback : Object.hasOwn(assignment,"value") ? assignment.value : undefined;
    return {ok:value !== undefined,value,sources:(resolved.chain || (token ? [token] : [])).map(item => ({
      source:"token",tokenId:item.id,label:item.name,value:styleClone(styleTokenThemeValue(item)),
      ...styleLibraryProvenance(item.libraryId),winning:false
    })),error:resolved.ok ? "" : resolved.error};
  }
  return {ok:Object.hasOwn(assignment,"value"),value:assignment.value,sources:[]};
}
function styleObjectClassIds(object){
  const ids=[];
  if (object && object.styleClassId) ids.push(object.styleClassId);
  for (const id of Array.isArray(object?.modifierClassIds) ? object.modifierClassIds : [])
    if (id && !ids.includes(id)) ids.push(id);
  return ids;
}
function styleResolutionFingerprint(object){
  const fields={id:object.id,type:object.type,kind:object.kind,
    styleClassId:object.styleClassId,modifierClassIds:object.modifierClassIds,
    styleTokenRefs:object.styleTokenRefs,theme:docTheme};
  for (const field of Object.values(STYLE_DIRECT_FIELDS))
    if (object[field] !== undefined) fields[field]=object[field];
  try { return typeof historyChecksum === "function" ? historyChecksum(fields) : JSON.stringify(fields); }
  catch { return JSON.stringify(fields); }
}
function styleResolveAppearance(object,opts={}){
  ensureStyleSystem();
  const fingerprint=styleResolutionFingerprint(object);
  const key=`${object.id}:${styleRevision}:${fingerprint}`;
  if (!opts.noCache && styleResolutionCache.has(key)){
    styleStats.cacheHits++;
    return styleResolutionCache.get(key);
  }
  const base=styleRawBaseValues(object);
  const values={...base};
  const sources=Object.fromEntries(Object.entries(base).map(([property,value]) => [property,[{
    source:"base",label:Object.hasOwn(object,STYLE_DIRECT_FIELDS[property])
      ? "Legacy/direct fallback" : "Product or theme default",
    value:styleClone(value),winning:true
  }]]));
  const errors=[];
  const applyAssignment=(property,assignment,origin) => {
    if (!stylePropertyCompatible(property,object)) return;
    const resolved=styleAssignmentValue(assignment,property);
    if (!resolved.ok){
      if (resolved.error) errors.push({property,message:resolved.error,origin});
      return;
    }
    for (const source of sources[property] || []) source.winning=false;
    const tokenSources=resolved.sources;
    for (const source of tokenSources) source.winning=false;
    const classSource={...origin,value:styleClone(resolved.value),winning:true};
    sources[property]=[...(sources[property] || []),...tokenSources,classSource];
    values[property]=styleClone(resolved.value);
  };
  for (const [property,tokenId] of Object.entries(object.styleTokenRefs || {}))
    applyAssignment(property,{tokenId},{source:"document-token",tokenId,
      label:styleTokenById(tokenId)?.name || tokenId});
  const appliedClasses=[];
  for (const classId of styleObjectClassIds(object)){
    const chain=styleClassChain(classId);
    if (chain.error) errors.push({property:"class",message:chain.error,classId});
    for (const item of chain.classes){
      if (!styleClassCompatible(item,object)) continue;
      appliedClasses.push(item.id);
      for (const [property,assignment] of Object.entries(item.properties))
        applyAssignment(property,assignment,{source:"class",classId:item.id,label:item.name,
          ...styleLibraryProvenance(item.libraryId),
          inheritancePath:chain.classes.map(entry => entry.id)});
    }
  }
  const result={objectId:object.id,values,sources,appliedClasses:[...new Set(appliedClasses)],errors};
  styleStats.resolutions++;
  if (!opts.noCache) styleResolutionCache.set(key,result);
  return result;
}
function styleEffectiveValue(object,property,fallback){
  const value=styleResolveAppearance(object).values[property];
  return value === undefined || value === "" ? fallback : value;
}
function styleExplainObject(object){
  const resolved=styleResolveAppearance(object);
  return {...resolved,classIds:styleObjectClassIds(object),
    tokenRefs:{...(object.styleTokenRefs || {})},
    manualOverrides:{...(object.styleOverrides || {})}};
}
function styleInvalidateObjects(ids,reason=""){
  const wanted=new Set(Array.isArray(ids) ? ids : [ids]);
  for (const key of styleResolutionCache.keys())
    if (wanted.has(key.slice(0,key.indexOf(":")))) styleResolutionCache.delete(key);
  styleStats.targetedInvalidations++;
  if (typeof formattingInvalidateAppearanceIds === "function")
    formattingInvalidateAppearanceIds([...wanted]);
  else if (typeof formattingInvalidateObject === "function")
    for (const id of wanted) formattingInvalidateObject(id,`style:${reason}`);
}
function styleInvalidateAll(reason=""){
  styleRevision++;
  styleResolutionCache.clear();
  styleDependencyIndex=null;
  styleStats.fullInvalidations++;
  if (typeof formattingInvalidateAll === "function" && reason !== "normalize")
    formattingInvalidateAll(`style:${reason}`);
}
function styleInvalidateTransaction(transaction){
  if (!transaction || !Array.isArray(transaction.operations)) return;
  const relevant=transaction.operations.filter(operation =>
    !["geometry","size","selection","camera"].includes(operation.category));
  if (!relevant.length) return;
  const ids=new Set(relevant.map(operation => operation.id).filter(Boolean));
  styleDependencyIndex=null;
  if (ids.size) styleInvalidateObjects([...ids],"transaction");
  else styleInvalidateAll("transaction");
}
function styleBuildDependencyIndex(){
  const tokenConsumers=new Map(),classConsumers=new Map(),componentInstances=new Map();
  const add=(map,key,id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key,new Set());
    map.get(key).add(id);
  };
  for (const item of styleClasses()){
    for (const assignment of Object.values(item.properties))
      if (assignment.tokenId) add(tokenConsumers,assignment.tokenId,`class:${item.id}`);
  }
  for (const object of [...state.nodes,...state.edges]){
    for (const tokenId of Object.values(object.styleTokenRefs || {}))
      add(tokenConsumers,tokenId,object.id);
    for (const classId of styleObjectClassIds(object)) add(classConsumers,classId,object.id);
    if (object.componentDefinitionId && object.componentInstanceId)
      add(componentInstances,object.componentDefinitionId,object.componentInstanceId);
  }
  styleDependencyIndex={tokenConsumers,classConsumers,componentInstances};
  styleStats.indexBuilds++;
  return styleDependencyIndex;
}
function styleDependencies(){ return styleDependencyIndex || styleBuildDependencyIndex(); }
function styleTokenConsumers(id,opts={}){
  const visited=opts.visited instanceof Set ? opts.visited : new Set();
  if (visited.has(id)) return {objectIds:[],classIds:[]};
  visited.add(id);
  const index=styleDependencies();
  const direct=index.tokenConsumers.get(id) || new Set();
  const objectIds=new Set(),classIds=new Set();
  for (const ref of direct){
    if (ref.startsWith("class:")) classIds.add(ref.slice(6));
    else objectIds.add(ref);
  }
  if (opts.transitive !== false){
    for (const classId of classIds)
      for (const objectId of index.classConsumers.get(classId) || []) objectIds.add(objectId);
    for (const token of styleTokens()){
      if (token.ref !== id) continue;
      const nested=styleTokenConsumers(token.id,{transitive:true,visited});
      for (const objectId of nested.objectIds) objectIds.add(objectId);
      for (const classId of nested.classIds) classIds.add(classId);
    }
  }
  return {objectIds:[...objectIds].sort(),classIds:[...classIds].sort()};
}
function styleClassConsumers(id,visited=new Set()){
  if (visited.has(id)) return [];
  visited.add(id);
  const ids=new Set(styleDependencies().classConsumers.get(id) || []);
  for (const child of styleClasses().filter(item => item.baseClassId === id))
    for (const objectId of styleClassConsumers(child.id,visited)) ids.add(objectId);
  return [...ids].sort();
}
function styleComponentInstances(id){
  return [...(styleDependencies().componentInstances.get(id) || [])].sort();
}
function styleUnusedDefinitions(){
  return {
    tokens:styleTokens().filter(token => {
      const consumers=styleTokenConsumers(token.id);
      return !consumers.objectIds.length && !consumers.classIds.length && !token.ref;
    }).map(item => item.id),
    classes:styleClasses().filter(item => !styleClassConsumers(item.id).length).map(item => item.id),
    components:styleComponents().filter(item => !styleComponentInstances(item.id).length).map(item => item.id),
    templates:[]
  };
}

function styleRepairReferences(opts={}){
  if (!state.styles) return [];
  const repairs=[];
  const tokenIds=new Set(state.styles.tokens.map(item => item.id));
  const classIds=new Set(state.styles.classes.map(item => item.id));
  for (const token of state.styles.tokens){
    if (token.ref && !tokenIds.has(token.ref))
      repairs.push({kind:"token",id:token.id,reference:token.ref,reason:"missing"});
  }
  for (const item of state.styles.classes){
    if (item.baseClassId && !classIds.has(item.baseClassId))
      repairs.push({kind:"class",id:item.id,reference:item.baseClassId,reason:"missing base"});
    for (const [property,assignment] of Object.entries(item.properties))
      if (assignment.tokenId && !tokenIds.has(assignment.tokenId))
        repairs.push({kind:"class",id:item.id,property,reference:assignment.tokenId,
          reason:"missing token"});
  }
  for (const object of [...state.nodes,...state.edges]){
    if (object.styleClassId && !classIds.has(object.styleClassId))
      repairs.push({kind:"object",id:object.id,reference:object.styleClassId,reason:"missing class"});
    for (const id of object.modifierClassIds || [])
      if (!classIds.has(id)) repairs.push({kind:"object",id:object.id,reference:id,
        reason:"missing modifier"});
    for (const [property,id] of Object.entries(object.styleTokenRefs || {}))
      if (!tokenIds.has(id)) repairs.push({kind:"object",id:object.id,property,reference:id,
        reason:"missing token"});
  }
  if (opts.mutate){
    /* Missing references remain visible and serializable. They are not erased:
       cached fallback values keep the document readable until the user maps,
       localizes, or imports the missing definition. */
    state.styles.referenceWarnings=repairs;
  }
  return repairs;
}

/* ---------------- Definition mutations and impact previews ---------------- */

function styleMutation(label,action,opts={}){
  const before=typeof historyModelSnapshot === "function" ? historyModelSnapshot() : null;
  if (opts.history !== false) pushHistory(opts.coalesceKey);
  const result=action();
  styleDependencyIndex=null;
  if (opts.invalidate !== false) styleInvalidateAll(label);
  if (before && opts.history === false && typeof historyRecordImmediateTransaction === "function")
    historyRecordImmediateTransaction(before,{commandId:"style-system",label,origin:"style-manager"});
  if (opts.render !== false) render();
  if (styleManagerOpen) renderStyleManager();
  return result;
}
function styleDefinitionImpact(kind,id){
  const started=performance.now();
  let ids=[];
  if (kind === "token") ids=styleTokenConsumers(id).objectIds;
  else if (kind === "class") ids=styleClassConsumers(id);
  else if (kind === "component"){
    const instances=styleComponentInstances(id);
    ids=[...new Set([...state.nodes,...state.edges].filter(object =>
      instances.includes(object.componentInstanceId)).map(object => object.id))];
  }
  styleStats.lastImpactCount=ids.length;
  styleStats.lastImpactDurationMs=performance.now()-started;
  return {kind,id,count:ids.length,ids,durationMs:styleStats.lastImpactDurationMs,
    samples:ids.slice(0,12).map(objectId => {
      const object=nodeById(objectId) || edgeById(objectId);
      return {id:objectId,label:styleObjectLabel(object)};
    })};
}
function styleCreateToken(seed={}){
  ensureStyleSystem();
  const ids=new Set(state.styles.tokens.map(item => item.id));
  const token=styleNormalizeToken({
    id:seed.id || styleUid("token"),name:seed.name || "New token",
    type:seed.type || "color",value:Object.hasOwn(seed,"value") ? seed.value :
      STYLE_TOKEN_TYPES[seed.type || "color"].sample,
    description:seed.description || "",order:state.styles.tokens.length
  },state.styles.tokens.length,ids);
  return styleMutation("Create design token",() => {
    state.styles.tokens.push(token);
    styleSelectedId=token.id;
    return token;
  });
}
function styleUpdateToken(id,patch,opts={}){
  ensureStyleSystem();
  const index=state.styles.tokens.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current=state.styles.tokens[index];
  const ids=new Set(state.styles.tokens.filter(item => item.id !== id).map(item => item.id));
  const next=styleNormalizeToken({...current,...styleClone(patch),id,
    updatedAt:styleNow()},index,ids);
  state.styles.tokens[index]=next;
  const cycleProbe=next.ref ? styleResolveToken(next.id) : {ok:true};
  state.styles.tokens[index]=current;
  if (!cycleProbe.ok && /cycle/i.test(cycleProbe.error || ""))
    return {error:cycleProbe.error,token:current};
  const impact=styleDefinitionImpact("token",id);
  if (opts.preview) return {preview:true,before:current,after:next,impact};
  return styleMutation("Update design token",() => {
    state.styles.tokens[index]=next;
    const affected=impact.ids;
    styleInvalidateObjects(affected,"token-update");
    return {token:next,impact,affected};
  },{invalidate:false,render:opts.render});
}
function styleDuplicateToken(id){
  const source=styleTokenById(id);
  if (!source) return null;
  return styleCreateToken({...source,id:styleUid("token"),name:`${source.name} copy`,ref:""});
}
function styleReorderDefinition(kind,id,direction){
  const collection=kind === "token" ? ensureStyleSystem().tokens
    : kind === "class" ? ensureStyleSystem().classes
    : kind === "component" ? ensureStyleSystem().components : ensureStyleSystem().templates;
  const ordered=styleOrdered(collection);
  const index=ordered.findIndex(item => item.id === id);
  const next=index+(direction < 0 ? -1 : 1);
  if (index < 0 || next < 0 || next >= ordered.length) return false;
  return styleMutation(`Reorder ${kind}`,() => {
    [ordered[index].order,ordered[next].order]=[ordered[next].order,ordered[index].order];
    return true;
  });
}
function styleDeleteToken(id,opts={}){
  const token=styleTokenById(id);
  if (!token) return false;
  const consumers=styleTokenConsumers(id);
  const replacement=opts.replacementId ? styleTokenById(opts.replacementId) : null;
  if (replacement && replacement.type !== token.type)
    return {error:"Replacement token type is incompatible.",consumers};
  if ((consumers.objectIds.length || consumers.classIds.length) &&
      !replacement && opts.localize !== true && opts.force !== true)
    return {needsResolution:true,token,consumers,
      choices:["replace","localize","cancel"]};
  return styleMutation("Delete design token",() => {
    const resolved=styleResolveToken(id);
    for (const item of state.styles.tokens)
      if (item.ref === id){
        if (replacement) item.ref=replacement.id;
        else { delete item.ref; item.value=styleNormalizeTokenValue(item.type,resolved.value); }
      }
    for (const item of state.styles.classes){
      for (const assignment of Object.values(item.properties)){
        if (assignment.tokenId !== id) continue;
        if (replacement) assignment.tokenId=replacement.id;
        else {
          delete assignment.tokenId;
          assignment.value=styleClone(resolved.value);
          assignment.fallback=styleClone(resolved.value);
        }
      }
    }
    for (const object of [...state.nodes,...state.edges]){
      for (const [property,tokenId] of Object.entries(object.styleTokenRefs || {})){
        if (tokenId !== id) continue;
        if (replacement) object.styleTokenRefs[property]=replacement.id;
        else {
          const field=STYLE_DIRECT_FIELDS[property];
          if (field) object[field]=styleClone(resolved.value);
          delete object.styleTokenRefs[property];
        }
      }
      if (object.styleTokenRefs && !Object.keys(object.styleTokenRefs).length)
        delete object.styleTokenRefs;
    }
    state.styles.tokens=state.styles.tokens.filter(item => item.id !== id);
    return {deleted:id,replacementId:replacement?.id || "",localized:!replacement};
  });
}
function styleCreateClass(seed={}){
  ensureStyleSystem();
  const ids=new Set(state.styles.classes.map(item => item.id));
  const item=styleNormalizeClass({
    id:seed.id || styleUid("class"),name:seed.name || "New style class",
    description:seed.description || "",appliesTo:seed.appliesTo || ["node"],
    properties:seed.properties || {fill:{tokenId:"token-color-primary"}},
    modifier:seed.modifier === true,baseClassId:seed.baseClassId || "",
    order:state.styles.classes.length
  },state.styles.classes.length,ids);
  return styleMutation("Create style class",() => {
    state.styles.classes.push(item);
    styleSelectedId=item.id;
    return item;
  });
}
function styleUpdateClass(id,patch,opts={}){
  ensureStyleSystem();
  const index=state.styles.classes.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current=state.styles.classes[index];
  const ids=new Set(state.styles.classes.filter(item => item.id !== id).map(item => item.id));
  const next=styleNormalizeClass({...current,...styleClone(patch),id,
    updatedAt:styleNow()},index,ids);
  const original=state.styles.classes[index];
  state.styles.classes[index]=next;
  const chain=styleClassChain(id);
  state.styles.classes[index]=original;
  if (chain.error) return {error:chain.error,item:current};
  const findings=styleValidateClass(next);
  const errors=findings.filter(finding => finding.severity === "error");
  if (errors.length && opts.allowInvalid !== true) return {error:errors[0].message,findings,item:current};
  const impact=styleDefinitionImpact("class",id);
  if (opts.preview) return {preview:true,before:current,after:next,impact,findings};
  return styleMutation("Update style class",() => {
    state.styles.classes[index]=next;
    styleInvalidateObjects(impact.ids,"class-update");
    return {item:next,impact,findings};
  },{invalidate:false,render:opts.render});
}
function styleDuplicateClass(id){
  const source=styleClassById(id);
  if (!source) return null;
  return styleCreateClass({...source,id:styleUid("class"),name:`${source.name} copy`,
    baseClassId:""});
}
function styleReplaceClass(id,replacementId){
  const source=styleClassById(id),replacement=styleClassById(replacementId);
  if (!source || !replacement) return false;
  return styleMutation("Replace style class",() => {
    for (const object of [...state.nodes,...state.edges]){
      if (object.styleClassId === id && styleClassCompatible(replacement,object))
        object.styleClassId=replacement.id;
      if (Array.isArray(object.modifierClassIds))
        object.modifierClassIds=[...new Set(object.modifierClassIds.map(item =>
          item === id && styleClassCompatible(replacement,object) ? replacement.id : item))];
    }
    for (const item of state.styles.classes)
      if (item.baseClassId === id) item.baseClassId=replacement.id;
    state.styles.classes=state.styles.classes.filter(item => item.id !== id);
    return true;
  });
}
function styleDeleteClass(id,opts={}){
  const item=styleClassById(id);
  if (!item) return false;
  const consumers=styleClassConsumers(id);
  if (opts.replacementId) return styleReplaceClass(id,opts.replacementId);
  if (consumers.length && opts.detach !== true && opts.force !== true)
    return {needsResolution:true,item,consumers,choices:["replace","detach","cancel"]};
  return styleMutation("Delete style class",() => {
    for (const object of [...state.nodes,...state.edges]){
      const uses=object.styleClassId === id || (object.modifierClassIds || []).includes(id);
      if (uses && opts.detach === true){
        const resolved=styleResolveAppearance(object,{noCache:true});
        for (const [property,field] of Object.entries(STYLE_DIRECT_FIELDS))
          if (!object.styleOverrides?.[property] && Object.hasOwn(resolved.values,property) &&
              stylePropertyCompatible(property,object))
            object[field]=styleClone(resolved.values[property]);
      }
      if (object.styleClassId === id) delete object.styleClassId;
      if (Array.isArray(object.modifierClassIds)){
        object.modifierClassIds=object.modifierClassIds.filter(item => item !== id);
        if (!object.modifierClassIds.length) delete object.modifierClassIds;
      }
    }
    for (const other of state.styles.classes)
      if (other.baseClassId === id){
        const inherited={};
        for (const ancestor of styleClassChain(id).classes)
          Object.assign(inherited,styleClone(ancestor.properties));
        other.properties={...inherited,...other.properties};
        delete other.baseClassId;
      }
    state.styles.classes=state.styles.classes.filter(other => other.id !== id);
    return true;
  });
}
function styleApplyClass(objects,classId,opts={}){
  const item=styleClassById(classId);
  const candidates=(Array.isArray(objects) ? objects : [objects]).filter(Boolean);
  const targets=candidates.filter(object =>
    object && (!item || styleClassCompatible(item,object)));
  const skipped=candidates.filter(object => !targets.includes(object)).map(object => object.id);
  if (!targets.length) return {changed:[],skipped};
  return styleMutation(item ? `Apply ${item.name}` : "Clear primary style class",() => {
    for (const object of targets){
      if (item) object.styleClassId=item.id; else delete object.styleClassId;
      if (opts.clearOverrides === true) delete object.styleOverrides;
    }
    styleInvalidateObjects(targets.map(object => object.id),"class-assignment");
    return {changed:targets.map(object => object.id),skipped};
  },{invalidate:false});
}
function styleToggleModifier(objects,classId,enabled){
  const item=styleClassById(classId);
  if (!item || !item.modifier) return false;
  const targets=(Array.isArray(objects) ? objects : [objects]).filter(object =>
    object && styleClassCompatible(item,object));
  return styleMutation(`${enabled ? "Apply" : "Remove"} ${item.name}`,() => {
    for (const object of targets){
      const ids=new Set(object.modifierClassIds || []);
      if (enabled) ids.add(item.id); else ids.delete(item.id);
      if (ids.size) object.modifierClassIds=[...ids]; else delete object.modifierClassIds;
    }
    styleInvalidateObjects(targets.map(object => object.id),"modifier-assignment");
    return targets.map(object => object.id);
  },{invalidate:false});
}
function styleApplyToken(objects,property,tokenId){
  const token=styleTokenById(tokenId);
  if (tokenId && (!token || !styleTokenCompatible(token,property))) return false;
  const targets=(Array.isArray(objects) ? objects : [objects])
    .filter(object => object && stylePropertyCompatible(property,object));
  if (!targets.length) return false;
  return styleMutation(token ? `Apply ${token.name}` : `Clear ${property} token`,() => {
    for (const object of targets){
      if (token){
        object.styleTokenRefs={...(object.styleTokenRefs || {}),[property]:token.id};
      } else if (object.styleTokenRefs){
        delete object.styleTokenRefs[property];
        if (!Object.keys(object.styleTokenRefs).length) delete object.styleTokenRefs;
      }
    }
    styleInvalidateObjects(targets.map(object => object.id),"token-assignment");
    return targets.map(object => object.id);
  },{invalidate:false});
}
function styleClearObjectOverride(object,property,opts={}){
  if (!object) return false;
  if (opts.history !== false) pushHistory();
  if (typeof formattingClearManualOverride === "function")
    formattingClearManualOverride(object,property);
  else if (object.styleOverrides){
    delete object.styleOverrides[property];
    if (!Object.keys(object.styleOverrides).length) delete object.styleOverrides;
  }
  styleInvalidateObjects(object.id,`clear-${property}`);
  render();
  return true;
}
function stylePromoteObjectProperty(object,property,opts={}){
  if (!object || !stylePropertyCompatible(property,object)) return null;
  const value=typeof formattingEffectiveValue === "function"
    ? formattingEffectiveValue(object,property,styleRawBaseValues(object)[property])
    : styleEffectiveValue(object,property,styleRawBaseValues(object)[property]);
  const definition=STYLE_PROPERTY_DEFINITIONS[property];
  const token=styleCreateToken({name:opts.tokenName || `${styleObjectLabel(object)} ${definition.label}`,
    type:definition.type === "lineStyle" ? "lineStyle" :
      definition.type === "fontFamily" ? "fontFamily" :
      definition.type === "color" ? "color" : "number",value});
  if (opts.createClass){
    const item=styleCreateClass({name:opts.className || `${styleObjectLabel(object)} style`,
      appliesTo:[styleObjectCapability(object)],
      properties:{[property]:{tokenId:token.id}}});
    styleApplyClass([object],item.id);
    return {token,item};
  }
  styleApplyToken([object],property,token.id);
  return {token};
}
function styleCreateClassFromObject(object,opts={}){
  if (!object) return null;
  const resolved=styleResolveAppearance(object).values;
  const properties={};
  for (const [property,definition] of Object.entries(STYLE_PROPERTY_DEFINITIONS)){
    if (!stylePropertyCompatible(property,object) || !Object.hasOwn(resolved,property)) continue;
    if (["opacity"].includes(property) && Number(resolved[property]) === 1) continue;
    properties[property]={value:styleClone(resolved[property])};
  }
  const item=styleCreateClass({
    name:opts.name || `${styleObjectLabel(object)} style`,
    description:`Created explicitly from ${styleObjectLabel(object)}.`,
    appliesTo:[styleObjectCapability(object)],properties
  });
  styleApplyClass([object],item.id,{clearOverrides:true});
  return item;
}

/* ---------------- Portable libraries and dependency plans ---------------- */

function stylePackageChecksum(value){
  const clone=styleClone(value);
  if (clone?.manifest) delete clone.manifest.checksum;
  return typeof historyChecksum === "function"
    ? historyChecksum(clone) : JSON.stringify(clone).length.toString(16);
}
function styleExportLibraryPackage(opts={}){
  const system=cleanStyleSystemForDocument();
  const include=id => !opts.ids || opts.ids.includes(id);
  const packageData={
    schemaVersion:STYLE_LIBRARY_SCHEMA_VERSION,
    manifest:{...system.library,exportedAt:opts.exportedAt || system.library.updatedAt,
      applicationVersion:typeof APP_VERSION === "string" ? APP_VERSION : ""},
    tokens:system.tokens.filter(item => include(item.id)),
    classes:system.classes.filter(item => include(item.id)),
    components:system.components.filter(item => include(item.id)),
    templates:system.templates.filter(item => include(item.id)),
    dependencies:{}
  };
  const tokenIds=new Set(packageData.tokens.map(item => item.id));
  for (const item of packageData.classes)
    for (const assignment of Object.values(item.properties))
      if (assignment.tokenId && !tokenIds.has(assignment.tokenId)){
        const token=styleTokenById(assignment.tokenId);
        if (token){ packageData.tokens.push(styleClone(token)); tokenIds.add(token.id); }
      }
  packageData.tokens=styleOrdered(packageData.tokens);
  packageData.classes=styleOrdered(packageData.classes);
  packageData.components=styleOrdered(packageData.components);
  packageData.templates=styleOrdered(packageData.templates);
  packageData.manifest.checksum=stylePackageChecksum(packageData);
  return packageData;
}
function styleAnalyzeLibraryImport(raw){
  const source=raw && typeof raw === "object" ? raw : {};
  const incoming=normalizeStyleSystem({
    schemaVersion:1,library:source.manifest,
    tokens:source.tokens || [],classes:source.classes || [],
    components:source.components || [],templates:source.templates || []
  });
  const classify=(kind,items,existing) => items.map(item => {
    const sameId=existing.find(current => current.id === item.id);
    const sameName=existing.find(current => current.name.toLowerCase() === item.name.toLowerCase() &&
      current.id !== item.id);
    let conflict="new";
    if (sameId){
      const identical=JSON.stringify({...sameId,updatedAt:""}) ===
        JSON.stringify({...item,updatedAt:""});
      conflict=identical ? "same" :
        source.manifest?.version && source.manifest.version !== ensureStyleSystem().library.version
          ? "compatible-update" : "divergent";
    } else if (sameName) conflict="name-collision";
    const impact=sameId ? styleDefinitionImpact(kind,item.id) :
      {kind,id:item.id,count:0,ids:[],samples:[],durationMs:0};
    return {kind,id:item.id,name:item.name,conflict,sameId:sameId?.id || "",
      sameName:sameName?.id || "",incoming:item,impact};
  });
  const items=[
    ...classify("token",incoming.tokens,styleTokens()),
    ...classify("class",incoming.classes,styleClasses()),
    ...classify("component",incoming.components,styleComponents()),
    ...classify("template",incoming.templates,styleTemplates())
  ];
  const missing=[];
  const incomingTokenIds=new Set(incoming.tokens.map(item => item.id));
  for (const item of incoming.classes)
    for (const [property,assignment] of Object.entries(item.properties))
      if (assignment.tokenId && !incomingTokenIds.has(assignment.tokenId) &&
          !styleTokenById(assignment.tokenId))
        missing.push({kind:"token",id:assignment.tokenId,consumer:item.id,property});
  const checksum=source.manifest?.checksum || stylePackageChecksum(source);
  return {manifest:styleLibraryRecord(source.manifest),incoming,items,missing,checksum,
    counts:Object.fromEntries(["new","same","compatible-update","divergent","name-collision"]
      .map(key => [key,items.filter(item => item.conflict === key).length]))};
}
function styleImportLibraryPackage(raw,opts={}){
  const analysis=styleAnalyzeLibraryImport(raw);
  if (opts.preview !== false) return {...analysis,preview:true};
  const strategy=opts.strategy || "keep-local";
  const idMap=new Map();
  const targetCollection=kind => kind === "token" ? state.styles.tokens
    : kind === "class" ? state.styles.classes
    : kind === "component" ? state.styles.components : state.styles.templates;
  return styleMutation(`Import ${analysis.manifest.name}`,() => {
    const accepted=[],skipped=[],forked=[];
    for (const entry of analysis.items){
      const collection=targetCollection(entry.kind);
      const index=collection.findIndex(item => item.id === entry.id);
      if (entry.conflict === "same"){ skipped.push(entry.id); continue; }
      if (index >= 0 && strategy === "keep-local"){ skipped.push(entry.id); continue; }
      let incoming=styleClone(entry.incoming);
      if ((entry.conflict === "divergent" || entry.conflict === "name-collision" ||
          entry.conflict === "compatible-update") &&
          strategy === "fork"){
        const nextId=`${incoming.id}-import-${styleUid("fork")}`;
        idMap.set(incoming.id,nextId);
        incoming.id=nextId;
        incoming.name=`${incoming.name} (imported)`;
        incoming.authority="detached";
        forked.push(incoming.id);
      } else {
        incoming.libraryId=analysis.manifest.id;
        incoming.authority="imported";
      }
      if (index >= 0) collection[index]=incoming; else collection.push(incoming);
      accepted.push(incoming.id);
    }
    if (idMap.size){
      for (const item of state.styles.classes){
        if (idMap.has(item.baseClassId)) item.baseClassId=idMap.get(item.baseClassId);
        for (const assignment of Object.values(item.properties))
          if (idMap.has(assignment.tokenId)) assignment.tokenId=idMap.get(assignment.tokenId);
      }
    }
    const cache={
      id:analysis.manifest.id,manifest:analysis.manifest,
      pinnedVersion:analysis.manifest.version,status:"current",cachedAt:styleNow(),
      checksum:analysis.checksum,embedded:true,package:styleClone(raw)
    };
    const previous=state.styles.importedLibraries.findIndex(item => item.id === cache.id);
    if (previous >= 0) state.styles.importedLibraries[previous]=cache;
    else state.styles.importedLibraries.push(cache);
    return {analysis,accepted,skipped,forked,idMap:Object.fromEntries(idMap)};
  });
}
function stylePreviewLibraryUpdate(libraryId,raw){
  const cache=ensureStyleSystem().importedLibraries.find(item => item.id === libraryId);
  const analysis=styleAnalyzeLibraryImport(raw);
  return {library:cache,analysis,
    updateAvailable:!!cache && cache.pinnedVersion !== analysis.manifest.version};
}
function styleDetachLibraryItem(kind,id){
  const source=kind === "token" ? styleTokenById(id)
    : kind === "class" ? styleClassById(id)
    : kind === "component" ? styleComponentById(id) : styleTemplateById(id);
  if (!source) return null;
  const clone=styleClone(source),oldId=clone.id;
  clone.id=`${oldId}-local-${styleUid("local")}`;
  clone.name=`${clone.name} (local)`;
  clone.authority="detached";
  delete clone.libraryId;
  return styleMutation(`Detach ${clone.name}`,() => {
    const collection=kind === "token" ? state.styles.tokens
      : kind === "class" ? state.styles.classes
      : kind === "component" ? state.styles.components : state.styles.templates;
    collection.push(clone);
    if (kind === "token"){
      for (const item of state.styles.classes)
        for (const assignment of Object.values(item.properties))
          if (assignment.tokenId === oldId) assignment.tokenId=clone.id;
      for (const object of [...state.nodes,...state.edges])
        for (const property of Object.keys(object.styleTokenRefs || {}))
          if (object.styleTokenRefs[property] === oldId) object.styleTokenRefs[property]=clone.id;
    } else if (kind === "class"){
      for (const object of [...state.nodes,...state.edges]){
        if (object.styleClassId === oldId) object.styleClassId=clone.id;
        if (Array.isArray(object.modifierClassIds))
          object.modifierClassIds=object.modifierClassIds.map(item => item === oldId ? clone.id : item);
      }
    }
    return clone;
  });
}
function styleClipboardDependencies(objects){
  const tokenIds=new Set(),classIds=new Set(),componentIds=new Set();
  for (const object of objects || []){
    for (const tokenId of Object.values(object.styleTokenRefs || {})) tokenIds.add(tokenId);
    for (const classId of styleObjectClassIds(object)) classIds.add(classId);
    if (object.componentDefinitionId) componentIds.add(object.componentDefinitionId);
  }
  const addClassDependencies=classId => {
    const item=styleClassById(classId);
    if (!item) return;
    if (item.baseClassId && !classIds.has(item.baseClassId)){
      classIds.add(item.baseClassId); addClassDependencies(item.baseClassId);
    }
    for (const assignment of Object.values(item.properties))
      if (assignment.tokenId) tokenIds.add(assignment.tokenId);
  };
  for (const id of [...classIds]) addClassDependencies(id);
  return {
    schemaVersion:1,
    tokens:[...tokenIds].map(styleTokenById).filter(Boolean).map(styleClone),
    classes:[...classIds].map(styleClassById).filter(Boolean).map(styleClone),
    components:[...componentIds].map(styleComponentById).filter(Boolean).map(styleClone)
  };
}
function stylePlanClipboardDependencies(payload){
  const dependencies=payload?.styleDependencies;
  if (!dependencies) return {reuse:[],missing:[],conflicts:[],options:["reuse"]};
  const reuse=[],missing=[],conflicts=[];
  const inspect=(kind,items,getById) => {
    for (const item of items || []){
      const existing=getById(item.id);
      if (!existing) missing.push({kind,id:item.id,name:item.name});
      else if (JSON.stringify(existing) === JSON.stringify(item))
        reuse.push({kind,id:item.id,name:item.name});
      else conflicts.push({kind,id:item.id,name:item.name});
    }
  };
  inspect("token",dependencies.tokens,styleTokenById);
  inspect("class",dependencies.classes,styleClassById);
  inspect("component",dependencies.components,styleComponentById);
  return {reuse,missing,conflicts,options:["fork","reuse-local","cancel"]};
}
function styleImportClipboardDependencies(payload,opts={}){
  const dependencies=payload?.styleDependencies;
  if (!dependencies) return {reused:[],imported:[],conflicts:[]};
  const imported=[],reused=[],conflicts=[],idMap=new Map();
  const importItems=(kind,items,getById,collection,prefix) => {
    for (const item of items || []){
      const existing=getById(item.id);
      if (existing){
        if (JSON.stringify(existing) === JSON.stringify(item)) reused.push(item.id);
        else {
          conflicts.push({kind,id:item.id});
          if (opts.resolve === "reuse-local" || opts.resolve === "direct"){
            reused.push(item.id); continue;
          }
          const clone=styleClone(item);
          const nextId=`${item.id}-${prefix}-${styleUid("copy")}`;
          idMap.set(item.id,nextId); clone.id=nextId; clone.name=`${item.name} (pasted)`;
          if (kind === "class")
            for (const assignment of Object.values(clone.properties || {}))
              if (idMap.has(assignment.tokenId)) assignment.tokenId=idMap.get(assignment.tokenId);
          collection.push(clone); imported.push(nextId);
        }
      } else {
        const clone=styleClone(item);
        if (kind === "class")
          for (const assignment of Object.values(clone.properties || {}))
            if (idMap.has(assignment.tokenId)) assignment.tokenId=idMap.get(assignment.tokenId);
        collection.push(clone); imported.push(item.id);
      }
    }
  };
  ensureStyleSystem();
  importItems("token",dependencies.tokens,styleTokenById,state.styles.tokens,"token");
  importItems("class",dependencies.classes,styleClassById,state.styles.classes,"class");
  importItems("component",dependencies.components,styleComponentById,state.styles.components,"component");
  if (idMap.size){
    for (const object of [...(payload.nodes || []),...(payload.edges || [])]){
      if (idMap.has(object.styleClassId)) object.styleClassId=idMap.get(object.styleClassId);
      if (Array.isArray(object.modifierClassIds))
        object.modifierClassIds=object.modifierClassIds.map(id => idMap.get(id) || id);
      if (object.styleTokenRefs)
        for (const property of Object.keys(object.styleTokenRefs))
          if (idMap.has(object.styleTokenRefs[property]))
            object.styleTokenRefs[property]=idMap.get(object.styleTokenRefs[property]);
      if (idMap.has(object.componentDefinitionId))
        object.componentDefinitionId=idMap.get(object.componentDefinitionId);
    }
  }
  if (imported.length) styleInvalidateAll("clipboard-dependencies");
  return {reused,imported,conflicts,idMap:Object.fromEntries(idMap)};
}

/* ---------------- Reusable components and template variables -------------- */

function styleSelectionBounds(nodes){
  if (!nodes.length) return null;
  const rects=nodes.map(nodeRect);
  const left=Math.min(...rects.map(rect => rect.x));
  const top=Math.min(...rects.map(rect => rect.y));
  const right=Math.max(...rects.map(rect => rect.x+rect.w));
  const bottom=Math.max(...rects.map(rect => rect.y+rect.h));
  return {x:left,y:top,w:right-left,h:bottom-top};
}
function styleComponentSnapshot(nodes,edges){
  const bounds=styleSelectionBounds(nodes);
  if (!bounds) return {nodes:[],edges:[],bounds:{x:0,y:0,w:0,h:0}};
  const nodeMap=new Map();
  const snapshotNodes=nodes.map((node,index) => {
    const child=styleClone(node);
    const childId=styleText(node.componentChildId,"",100) || `child-${index+1}`;
    nodeMap.set(node.id,childId);
    child.id=childId;
    child.componentChildId=childId;
    child.x=node.x-bounds.x; child.y=node.y-bounds.y;
    for (const row of typeof nodeRows === "function" ? nodeRows(child) || [] : []){
      const stableFieldId=styleText(row.componentFieldId || row.id,"",100) || styleUid("field");
      row.id=stableFieldId;
      row.componentFieldId=stableFieldId;
    }
    for (const field of ["componentInstanceId","componentDefinitionId","componentVersion",
      "componentOverrides","componentUpdateAvailable","semanticId","relationshipId","pageId"])
      delete child[field];
    return child;
  });
  const snapshotEdges=edges.filter(edge => nodeMap.has(edge.from) && nodeMap.has(edge.to))
    .map((edge,index) => {
      const child=styleClone(edge);
      child.id=`edge-${index+1}`;
      child.componentChildId=child.id;
      child.from=nodeMap.get(edge.from); child.to=nodeMap.get(edge.to);
      for (const field of ["componentInstanceId","componentDefinitionId","componentVersion",
        "componentOverrides","componentUpdateAvailable","semanticId","relationshipId","pageId"])
        delete child[field];
      return child;
    });
  return {nodes:snapshotNodes,edges:snapshotEdges,bounds};
}
function styleComponentComparableValue(field,value){
  if ((field === "fields" || field === "items") && Array.isArray(value)){
    return value.map((row,index) => {
      const clone=styleClone(row);
      const stableId=styleText(row.componentFieldId || row.id,"",100) || `field-${index+1}`;
      clone.id=stableId;
      clone.componentFieldId=stableId;
      return clone;
    });
  }
  return value;
}
function styleComponentFieldMap(node){
  const map=new Map();
  for (const row of typeof nodeRows === "function" ? nodeRows(node) || [] : []){
    const stableId=styleText(row.componentFieldId || row.id,"",100);
    if (stableId) map.set(stableId,row.id);
  }
  return map;
}
function styleSyncComponentRows(source,node,overrides={},opts={}){
  for (const field of ["fields","items"]){
    if (!Array.isArray(source[field])) continue;
    if (overrides[field]){
      for (const row of Array.isArray(node[field]) ? node[field] : [])
        if (!row.componentFieldId) row.componentFieldId=row.id;
      continue;
    }
    const currentByStable=new Map((opts.fresh ? [] : (Array.isArray(node[field]) ? node[field] : []))
      .map(row => [styleText(row.componentFieldId || row.id,"",100),row]));
    node[field]=source[field].map((sourceRow,index) => {
      const stableId=styleText(sourceRow.componentFieldId || sourceRow.id,"",100) ||
        `field-${index+1}`;
      const clone=styleClone(sourceRow);
      clone.id=currentByStable.get(stableId)?.id || uid();
      clone.componentFieldId=stableId;
      return clone;
    });
  }
  return styleComponentFieldMap(node);
}
function styleCreateComponentFromSelection(name="New component",opts={}){
  const nodes=opts.nodes || (typeof selectedNodes === "function" ? selectedNodes() : []);
  if (!nodes.length) return {error:"Select one or more nodes first."};
  if (nodes.some(node => node.componentDefinitionId) && opts.allowNested !== true)
    return {error:"Nested components are disabled in the first component model."};
  const ids=new Set(nodes.map(node => node.id));
  const edges=(opts.edges || state.edges).filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const snapshot=styleComponentSnapshot(nodes,edges);
  const component=styleNormalizeComponent({
    id:opts.id || styleUid("component"),name,version:"1.0.0",
    description:opts.description || "",nodes:snapshot.nodes,edges:snapshot.edges,
    externalPorts:opts.externalPorts || [],exposedProperties:opts.exposedProperties || [],
    order:styleComponents().length
  },styleComponents().length,new Set(styleComponents().map(item => item.id)));
  return styleMutation("Create reusable component",() => {
    state.styles.components.push(component);
    let sourceInstanceId="";
    if (opts.linkSource !== false){
      sourceInstanceId=styleUid("instance");
      nodes.forEach((node,index) => {
        node.componentInstanceId=sourceInstanceId;
        node.componentDefinitionId=component.id;
        node.componentChildId=component.nodes[index]?.componentChildId || component.nodes[index]?.id;
        node.componentVersion=component.version;
        const definitionRows=typeof nodeRows === "function" ? nodeRows(component.nodes[index]) || [] : [];
        for (const [rowIndex,row] of (typeof nodeRows === "function" ? nodeRows(node) || [] : []).entries())
          row.componentFieldId=definitionRows[rowIndex]?.componentFieldId ||
            definitionRows[rowIndex]?.id || row.componentFieldId || row.id;
      });
      edges.forEach((edge,index) => {
        edge.componentInstanceId=sourceInstanceId;
        edge.componentDefinitionId=component.id;
        edge.componentChildId=component.edges[index]?.componentChildId || component.edges[index]?.id;
        edge.componentVersion=component.version;
      });
    }
    styleSelectedId=component.id;
    return {...component,sourceInstanceId};
  });
}
function styleComponentInstanceRecords(instanceId){
  return {
    nodes:state.nodes.filter(node => node.componentInstanceId === instanceId),
    edges:state.edges.filter(edge => edge.componentInstanceId === instanceId)
  };
}
function styleInsertComponent(id,point=viewCenter(),opts={}){
  const definition=styleComponentById(id);
  if (!definition) return {error:"Component definition was not found."};
  const instanceId=styleUid("instance"),nodeMap=new Map(),fieldMap=new Map();
  const nodes=definition.nodes.map(source => {
    const node=styleClone(source);
    const childId=source.componentChildId || source.id;
    node.id=uid(); nodeMap.set(childId,node.id);
    node.x=Number(point.x)+(Number(source.x)||0);
    node.y=Number(point.y)+(Number(source.y)||0);
    node.componentInstanceId=instanceId;
    node.componentDefinitionId=definition.id;
    node.componentChildId=childId;
    node.componentVersion=definition.version;
    if (typeof organizationAssignActiveLayer === "function") organizationAssignActiveLayer(node);
    for (const row of typeof nodeRows === "function" ? nodeRows(node) || [] : []){
      const sourceId=row.id;
      row.componentFieldId=sourceId;
      row.id=uid();
      fieldMap.set(`${childId}:${sourceId}`,row.id);
    }
    return node;
  });
  const edges=definition.edges.map(source => {
    const edge=styleClone(source);
    edge.id=uid();
    edge.from=nodeMap.get(source.from); edge.to=nodeMap.get(source.to);
    if (source.fromField) edge.fromField=fieldMap.get(`${source.from}:${source.fromField}`) || source.fromField;
    if (source.toField) edge.toField=fieldMap.get(`${source.to}:${source.toField}`) || source.toField;
    if (Array.isArray(source.pairs)) edge.pairs=source.pairs.map(pair => ({
      fromField:fieldMap.get(`${source.from}:${pair.fromField}`) || pair.fromField || "",
      toField:fieldMap.get(`${source.to}:${pair.toField}`) || pair.toField || ""
    }));
    edge.componentInstanceId=instanceId;
    edge.componentDefinitionId=definition.id;
    edge.componentChildId=source.componentChildId || source.id;
    edge.componentVersion=definition.version;
    if (typeof organizationAssignActiveLayer === "function") organizationAssignActiveLayer(edge);
    return edge;
  }).filter(edge => edge.from && edge.to);
  return styleMutation(`Insert ${definition.name}`,() => {
    state.nodes.push(...nodes); state.edges.push(...edges);
    setSelection("node",nodes.map(node => node.id));
    return {instanceId,definitionId:id,nodeIds:nodes.map(node => node.id),
      edgeIds:edges.map(edge => edge.id)};
  });
}
function styleComponentInstanceOverrides(instanceId){
  const records=styleComponentInstanceRecords(instanceId),conflicts=[];
  for (const object of [...records.nodes,...records.edges]){
    if (object.componentOverrides && Object.keys(object.componentOverrides).length)
      conflicts.push({id:object.id,childId:object.componentChildId,
        fields:Object.keys(object.componentOverrides)});
  }
  return conflicts;
}
function styleComponentDiff(definition,instanceId){
  const records=styleComponentInstanceRecords(instanceId);
  const nodeByChild=new Map(records.nodes.map(node => [node.componentChildId,node]));
  const edgeByChild=new Map(records.edges.map(edge => [edge.componentChildId,edge]));
  const definitionNodeIds=new Set(definition.nodes.map(node => node.componentChildId || node.id));
  const definitionEdgeIds=new Set(definition.edges.map(edge => edge.componentChildId || edge.id));
  const addedNodes=definition.nodes.filter(node => !nodeByChild.has(node.componentChildId || node.id))
    .map(node => node.componentChildId || node.id);
  const removedNodes=records.nodes.filter(node => !definitionNodeIds.has(node.componentChildId))
    .map(node => node.id);
  const addedEdges=definition.edges.filter(edge => !edgeByChild.has(edge.componentChildId || edge.id))
    .map(edge => edge.componentChildId || edge.id);
  const removedEdges=records.edges.filter(edge => !definitionEdgeIds.has(edge.componentChildId))
    .map(edge => edge.id);
  const changed=[];
  for (const source of definition.nodes){
    const current=nodeByChild.get(source.componentChildId || source.id);
    if (!current) continue;
    const fields=[];
    for (const [field,value] of Object.entries(source)){
      if (STYLE_PROTECTED_COMPONENT_FIELDS.has(field) || STYLE_INSTANCE_LOCAL_FIELDS.has(field)) continue;
      const currentValue=styleComponentComparableValue(field,current[field]);
      const definitionValue=styleComponentComparableValue(field,value);
      if (JSON.stringify(currentValue) !== JSON.stringify(definitionValue)) fields.push(field);
    }
    if (fields.length) changed.push({id:current.id,childId:current.componentChildId,fields});
  }
  const externalLinks=state.edges.filter(edge =>
    removedNodes.includes(edge.from) !== removedNodes.includes(edge.to))
    .map(edge => edge.id);
  return {instanceId,definitionId:definition.id,fromVersion:records.nodes[0]?.componentVersion || "",
    toVersion:definition.version,addedNodes,removedNodes,addedEdges,removedEdges,changed,
    overrideConflicts:styleComponentInstanceOverrides(instanceId),externalLinks,
    requiresLayout:addedNodes.length > 0 || removedNodes.length > 0};
}
function stylePreviewComponentUpdate(id){
  const definition=styleComponentById(id);
  if (!definition) return {error:"Component definition was not found."};
  const instances=styleComponentInstances(id);
  const diffs=instances.map(instanceId => styleComponentDiff(definition,instanceId));
  return {definition,instances,diffs,
    summary:{
      instances:instances.length,
      addedNodes:diffs.reduce((sum,diff) => sum+diff.addedNodes.length,0),
      removedNodes:diffs.reduce((sum,diff) => sum+diff.removedNodes.length,0),
      changed:diffs.reduce((sum,diff) => sum+diff.changed.length,0),
      conflicts:diffs.reduce((sum,diff) => sum+diff.overrideConflicts.length,0),
      externalLinks:diffs.reduce((sum,diff) => sum+diff.externalLinks.length,0)
    }};
}
function styleApplyComponentUpdate(id,opts={}){
  const definition=styleComponentById(id);
  if (!definition) return {error:"Component definition was not found."};
  const preview=stylePreviewComponentUpdate(id);
  if (opts.preview !== false) return {...preview,preview:true};
  return styleMutation(`Update ${definition.name} instances`,() => {
    const results=[];
    for (const instanceId of preview.instances){
      const records=styleComponentInstanceRecords(instanceId);
      if (!records.nodes.length) continue;
      const origin={
        x:Math.min(...records.nodes.map(node => node.x)),
        y:Math.min(...records.nodes.map(node => node.y))
      };
      const nodeByChild=new Map(records.nodes.map(node => [node.componentChildId,node]));
      const edgeByChild=new Map(records.edges.map(edge => [edge.componentChildId,edge]));
      const nodeMap=new Map(),fieldMaps=new Map();
      for (const source of definition.nodes){
        const childId=source.componentChildId || source.id;
        let node=nodeByChild.get(childId);
        let overrides={},created=false;
        if (!node){
          created=true;
          node=styleClone(source);
          node.id=uid(); node.x=origin.x+(Number(source.x)||0); node.y=origin.y+(Number(source.y)||0);
          node.componentInstanceId=instanceId; node.componentDefinitionId=id;
          node.componentChildId=childId; state.nodes.push(node);
        } else {
          overrides=node.componentOverrides || {};
          for (const [field,value] of Object.entries(source)){
            if (STYLE_PROTECTED_COMPONENT_FIELDS.has(field) || STYLE_INSTANCE_LOCAL_FIELDS.has(field) ||
                field === "fields" || field === "items" ||
                overrides[field]) continue;
            node[field]=styleClone(value);
          }
        }
        fieldMaps.set(childId,styleSyncComponentRows(source,node,overrides,{fresh:created}));
        node.componentVersion=definition.version; delete node.componentUpdateAvailable;
        nodeMap.set(childId,node.id);
      }
      const retainedNodeIds=new Set(nodeMap.values());
      for (const node of records.nodes){
        if (retainedNodeIds.has(node.id)) continue;
        const external=state.edges.some(edge => (edge.from === node.id || edge.to === node.id) &&
          edge.componentInstanceId !== instanceId);
        if (external || Object.keys(node.componentOverrides || {}).length){
          delete node.componentInstanceId; delete node.componentDefinitionId;
          delete node.componentChildId; delete node.componentVersion;
        } else {
          state.edges=state.edges.filter(edge => edge.from !== node.id && edge.to !== node.id);
          state.nodes=state.nodes.filter(item => item.id !== node.id);
        }
      }
      for (const source of definition.edges){
        const childId=source.componentChildId || source.id;
        let edge=edgeByChild.get(childId);
        if (!edge){ edge=styleClone(source); edge.id=uid(); state.edges.push(edge); }
        const overrides=edge.componentOverrides || {};
        for (const [field,value] of Object.entries(source)){
          if (STYLE_PROTECTED_COMPONENT_FIELDS.has(field) || overrides[field] ||
              ["from","to","fromField","toField","pairs"].includes(field)) continue;
          edge[field]=styleClone(value);
        }
        edge.from=nodeMap.get(source.from); edge.to=nodeMap.get(source.to);
        const fromFieldMap=fieldMaps.get(source.from),toFieldMap=fieldMaps.get(source.to);
        if (!overrides.fromField){
          if (source.fromField) edge.fromField=fromFieldMap?.get(source.fromField) || source.fromField;
          else delete edge.fromField;
        }
        if (!overrides.toField){
          if (source.toField) edge.toField=toFieldMap?.get(source.toField) || source.toField;
          else delete edge.toField;
        }
        if (!overrides.pairs){
          if (Array.isArray(source.pairs)) edge.pairs=source.pairs.map(pair => ({
            fromField:fromFieldMap?.get(pair.fromField) || pair.fromField || "",
            toField:toFieldMap?.get(pair.toField) || pair.toField || ""
          }));
          else delete edge.pairs;
        }
        edge.componentInstanceId=instanceId; edge.componentDefinitionId=id;
        edge.componentChildId=childId; edge.componentVersion=definition.version;
        delete edge.componentUpdateAvailable;
      }
      const retainedEdgeIds=new Set(definition.edges.map(source => source.componentChildId || source.id));
      state.edges=state.edges.filter(edge => edge.componentInstanceId !== instanceId ||
        retainedEdgeIds.has(edge.componentChildId));
      results.push({instanceId,nodeIds:[...nodeMap.values()]});
    }
    return {preview,results};
  });
}
function styleMarkComponentOverride(object,field,enabled=true){
  if (!object?.componentInstanceId || STYLE_PROTECTED_COMPONENT_FIELDS.has(field)) return false;
  if (enabled){
    object.componentOverrides={...(object.componentOverrides || {}),[field]:true};
    if (field === "properties") object.componentOverrides.propertyProvenance=true;
  }
  else if (object.componentOverrides){
    delete object.componentOverrides[field];
    if (field === "properties") delete object.componentOverrides.propertyProvenance;
    if (!Object.keys(object.componentOverrides).length) delete object.componentOverrides;
  }
  return true;
}
function styleUpdateComponentFromSelection(id,opts={}){
  const definition=styleComponentById(id);
  const nodes=opts.nodes || selectedNodes();
  if (!definition || !nodes.length) return {error:"Select the component contents to update."};
  const ids=new Set(nodes.map(node => node.id));
  const edges=state.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const snapshot=styleComponentSnapshot(nodes,edges);
  const nextVersion=opts.version || (() => {
    const [major,minor,patch]=definition.version.split(".").map(Number);
    return `${major}.${minor}.${patch+1}`;
  })();
  const next={...definition,nodes:snapshot.nodes,edges:snapshot.edges,
    version:styleSemver(nextVersion,definition.version),updatedAt:styleNow()};
  const impacts=styleComponentInstances(id).map(instanceId => styleComponentDiff(next,instanceId));
  if (opts.preview !== false) return {preview:true,before:definition,after:next,impacts};
  return styleMutation(`Edit ${definition.name} definition`,() => {
    const index=state.styles.components.findIndex(item => item.id === id);
    state.styles.components[index]=next;
    for (const object of [...state.nodes,...state.edges])
      if (object.componentDefinitionId === id) object.componentUpdateAvailable=next.version;
    return {definition:next,impacts};
  });
}
function styleDetachComponentInstance(instanceId){
  const records=styleComponentInstanceRecords(instanceId);
  if (!records.nodes.length && !records.edges.length) return false;
  return styleMutation("Detach component instance",() => {
    for (const object of [...records.nodes,...records.edges])
      for (const field of ["componentInstanceId","componentDefinitionId","componentChildId",
        "componentVersion","componentOverrides","componentUpdateAvailable"]) delete object[field];
    return {instanceId,nodeIds:records.nodes.map(node => node.id),edgeIds:records.edges.map(edge => edge.id)};
  });
}
function styleDeleteComponent(id,opts={}){
  const definition=styleComponentById(id);
  if (!definition) return false;
  const instances=styleComponentInstances(id);
  if (instances.length && opts.detach !== true && !opts.replacementId)
    return {needsResolution:true,definition,instances,choices:["replace","detach","cancel"]};
  return styleMutation("Delete component definition",() => {
    if (opts.replacementId){
      const replacement=styleComponentById(opts.replacementId);
      if (!replacement) return {error:"Replacement component was not found."};
      for (const object of [...state.nodes,...state.edges])
        if (object.componentDefinitionId === id){
          object.componentDefinitionId=replacement.id;
          object.componentUpdateAvailable=replacement.version;
        }
    } else for (const instanceId of instances){
      const records=styleComponentInstanceRecords(instanceId);
      for (const object of [...records.nodes,...records.edges])
        for (const field of ["componentInstanceId","componentDefinitionId","componentChildId",
          "componentVersion","componentOverrides","componentUpdateAvailable"]) delete object[field];
    }
    state.styles.components=state.styles.components.filter(item => item.id !== id);
    return true;
  });
}

function styleTemplateSubstitute(value,variables){
  if (typeof value === "string"){
    const exact=value.match(/^\{\{([A-Za-z0-9._-]+)\}\}$/);
    if (exact && Object.hasOwn(variables,exact[1])) return styleClone(variables[exact[1]]);
    return value.replace(/\{\{([A-Za-z0-9._-]+)\}\}/g,(_,id) =>
      Object.hasOwn(variables,id) ? String(variables[id]) : `{{${id}}}`);
  }
  if (Array.isArray(value)) return value.map(item => styleTemplateSubstitute(item,variables));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key,item]) =>
      [key,styleTemplateSubstitute(item,variables)]));
  return value;
}
function styleValidateTemplateValues(template,raw={}){
  const values={},errors=[];
  for (const variable of template.variables){
    let value=Object.hasOwn(raw,variable.id) ? raw[variable.id] : variable.default;
    if ((value == null || value === "") && variable.required){
      errors.push({id:variable.id,message:`${variable.label} is required.`}); continue;
    }
    if (variable.type === "number"){
      value=Number(value);
      if (!Number.isFinite(value)) errors.push({id:variable.id,message:`${variable.label} must be a number.`});
      if (Number.isFinite(variable.min) && value < variable.min)
        errors.push({id:variable.id,message:`${variable.label} must be at least ${variable.min}.`});
      if (Number.isFinite(variable.max) && value > variable.max)
        errors.push({id:variable.id,message:`${variable.label} must be at most ${variable.max}.`});
    } else if (variable.type === "boolean") value=value === true || value === "true";
    else if (variable.type === "enum" && !variable.options?.includes(String(value)))
      errors.push({id:variable.id,message:`Choose a valid ${variable.label}.`});
    else if (variable.type === "color"){
      const color=normalizeColorValue(value);
      if (!color) errors.push({id:variable.id,message:`${variable.label} must be a color.`});
      else value=color;
    } else if (value != null) value=String(value).slice(0,500);
    values[variable.id]=value;
  }
  return {valid:!errors.length,values,errors};
}
function stylePreviewTemplate(id,values={},point=viewCenter()){
  const template=styleTemplateById(id);
  if (!template) return {error:"Template was not found."};
  const validation=styleValidateTemplateValues(template,values);
  if (!validation.valid) return {...validation,template};
  const blueprint=styleTemplateSubstitute(template.blueprint,validation.values);
  return {valid:true,template,values:validation.values,blueprint,point,
    summary:{nodes:blueprint.nodes.length,edges:blueprint.edges.length}};
}
function styleInstantiateTemplate(id,values={},point=viewCenter(),opts={}){
  const preview=stylePreviewTemplate(id,values,point);
  if (!preview.valid) return preview;
  if (opts.preview) return {...preview,preview:true};
  const keyMap=new Map();
  const nodes=preview.blueprint.nodes.map((source,index) => {
    const node=styleClone(source);
    const key=node.key || `node-${index+1}`; delete node.key;
    node.id=uid(); keyMap.set(key,node.id);
    node.x=Number(point.x)+(Number(node.x)||0);
    node.y=Number(point.y)+(Number(node.y)||0);
    node.templateOrigin={id:preview.template.id,version:preview.template.version,
      variables:styleClone(preview.values),instantiatedAt:styleNow()};
    if (node.type === "status") normalizeNodeStatus(node);
    if (typeof organizationAssignActiveLayer === "function") organizationAssignActiveLayer(node);
    return node;
  });
  const edges=preview.blueprint.edges.map(source => {
    const edge=styleClone(source);
    edge.id=uid(); edge.from=keyMap.get(source.from); edge.to=keyMap.get(source.to);
    edge.templateOrigin={id:preview.template.id,version:preview.template.version};
    if (typeof organizationAssignActiveLayer === "function") organizationAssignActiveLayer(edge);
    return edge;
  }).filter(edge => edge.from && edge.to);
  return styleMutation(`Create from ${preview.template.name}`,() => {
    state.nodes.push(...nodes); state.edges.push(...edges);
    setSelection("node",nodes.map(node => node.id));
    return {valid:true,preview,nodeIds:nodes.map(node => node.id),edgeIds:edges.map(edge => edge.id)};
  });
}
function styleCreateTemplate(seed={}){
  const ids=new Set(styleTemplates().map(item => item.id));
  const item=styleNormalizeTemplate({
    id:seed.id || styleUid("template"),name:seed.name || "New template",
    version:seed.version || "1.0.0",description:seed.description || "",
    variables:seed.variables || [],blueprint:seed.blueprint || {nodes:[],edges:[]},
    order:styleTemplates().length
  },styleTemplates().length,ids);
  return styleMutation("Create template",() => {
    state.styles.templates.push(item); styleSelectedId=item.id; return item;
  });
}
function styleUpdateTemplate(id,patch){
  const index=ensureStyleSystem().templates.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current=state.styles.templates[index];
  const ids=new Set(state.styles.templates.filter(item => item.id !== id).map(item => item.id));
  const next=styleNormalizeTemplate({...current,...styleClone(patch),id,updatedAt:styleNow()},
    index,ids);
  return styleMutation("Update template",() => {
    state.styles.templates[index]=next; return next;
  });
}
function styleDeleteTemplate(id){
  if (!styleTemplateById(id)) return false;
  return styleMutation("Delete template",() => {
    state.styles.templates=state.styles.templates.filter(item => item.id !== id);
    return true;
  });
}

/* ---------------- Authoring, management, and provenance UI ---------------- */

function styleHtml(tag,className,text){
  const element=document.createElement(tag);
  if (className) element.className=className;
  if (text != null) element.textContent=text;
  return element;
}
function styleButton(label,action,opts={}){
  const button=styleHtml("button",opts.className || "",label);
  button.type="button";
  if (opts.title) button.title=opts.title;
  if (opts.disabled) button.disabled=true;
  if (opts.ariaLabel) button.setAttribute("aria-label",opts.ariaLabel);
  button.addEventListener("click",event => { event.preventDefault(); action(event); });
  return button;
}
function styleSelect(options,value,label){
  const select=document.createElement("select");
  if (label) select.setAttribute("aria-label",label);
  for (const [id,text] of options){
    const option=document.createElement("option"); option.value=id; option.textContent=text;
    option.selected=id===value; select.appendChild(option);
  }
  return select;
}
function styleField(label,control,opts={}){
  const wrapper=styleHtml("label",opts.wide ? "style-manager-field style-manager-wide" :
    "style-manager-field");
  wrapper.append(styleHtml("span","",label),control);
  return wrapper;
}
function styleDefinitionCollection(mode){
  return mode === "tokens" ? styleTokens()
    : mode === "classes" ? styleClasses()
    : mode === "components" ? styleComponents()
    : mode === "templates" ? styleTemplates() : [];
}
function styleDefinitionLabel(mode){
  return mode === "tokens" ? "token" : mode === "classes" ? "class"
    : mode === "components" ? "component" : "template";
}
function styleRenderDefinitionList(parent,mode){
  const aside=styleHtml("aside","style-manager-list");
  const search=document.createElement("input");
  search.type="search"; search.placeholder=`Search ${mode}`; search.setAttribute("aria-label",`Search ${mode}`);
  aside.appendChild(search);
  const list=styleHtml("div","style-manager-list-scroll");
  aside.appendChild(list);
  const renderList=() => {
    list.replaceChildren();
    const query=search.value.trim().toLowerCase();
    const items=styleDefinitionCollection(mode).filter(item =>
      !query || `${item.name} ${item.description || ""}`.toLowerCase().includes(query));
    for (const item of items){
      const button=styleButton(item.name,() => { styleSelectedId=item.id; renderStyleManager(); },
        {className:"style-manager-list-item"});
      button.dataset.styleDefinitionId=item.id;
      button.setAttribute("aria-pressed",String(styleSelectedId === item.id));
      const detail=mode === "tokens" ? `${item.type} · ${styleTokenConsumers(item.id).objectIds.length} objects`
        : mode === "classes" ? `${item.appliesTo.join(", ")} · ${styleClassConsumers(item.id).length} objects`
        : mode === "components" ? `${item.version} · ${styleComponentInstances(item.id).length} instances`
        : `${item.version} · ${item.variables.length} variables`;
      button.appendChild(styleHtml("small","",detail));
      list.appendChild(button);
    }
    if (!items.length) list.appendChild(styleHtml("p","style-manager-empty","No matching definitions."));
  };
  search.addEventListener("input",renderList);
  renderList();
  parent.appendChild(aside);
}
function styleRenderImpact(parent,kind,id){
  const impact=styleDefinitionImpact(kind,id);
  const section=styleHtml("section","style-manager-impact");
  section.appendChild(styleHtml("h4","",`Impact · ${impact.count} object${impact.count===1?"":"s"}`));
  section.appendChild(styleHtml("p","",
    impact.count ? `A change will update ${impact.count} linked consumer${impact.count===1?"":"s"} in one history transaction.`
      : "This definition currently has no object consumers."));
  if (impact.samples.length){
    const samples=styleHtml("div","style-manager-samples");
    for (const sample of impact.samples)
      samples.appendChild(styleButton(sample.label,() => {
        const object=nodeById(sample.id) || edgeById(sample.id);
        if (!object) return;
        setSelection(styleObjectKind(object),object.id); closeStyleManager(); render();
      }));
    section.appendChild(samples);
  }
  parent.appendChild(section);
}
function styleTokenInput(token,onChange){
  if (token.type === "color"){
    if (typeof customColorRow === "function")
      return customColorRow(styleTokenThemeValue(token),(value,commit) => {
        if (commit) onChange({value});
      },{key:`style-token:${token.id}`});
    const input=document.createElement("input"); input.type="text";
    input.value=styleTokenThemeValue(token); input.placeholder="#2456E6 or #2456E680";
    input.addEventListener("change",() => onChange({value:input.value}));
    return input;
  }
  if (token.type === "lineStyle"){
    const select=styleSelect([["solid","Solid"],["dash","Dashed"],["dot","Dotted"]],
      token.value,"Token value");
    select.addEventListener("change",() => onChange({value:select.value}));
    return select;
  }
  const input=document.createElement("input");
  input.type=token.type === "number" ? "number" : "text";
  input.value=token.value;
  if (token.type === "number") input.step="0.1";
  input.addEventListener("change",() => onChange({value:input.value}));
  return input;
}
function styleRenderTokenEditor(parent,token){
  if (!token){ parent.appendChild(styleHtml("p","style-manager-empty","Create or select a token.")); return; }
  const editor=styleHtml("div","style-manager-editor");
  const basics=styleHtml("section","style-manager-basics");
  const name=document.createElement("input"); name.value=token.name;
  name.addEventListener("change",() => styleUpdateToken(token.id,{name:name.value}));
  basics.appendChild(styleField("Name",name));
  const type=styleSelect(Object.entries(STYLE_TOKEN_TYPES).map(([id,item]) => [id,item.label]),
    token.type,"Token type");
  type.addEventListener("change",() => styleUpdateToken(token.id,{
    type:type.value,value:STYLE_TOKEN_TYPES[type.value].sample,ref:""
  }));
  basics.appendChild(styleField("Type",type));
  basics.appendChild(styleField("Value",styleTokenInput(token,patch => {
    const preview=styleUpdateToken(token.id,patch,{preview:true});
    const status=document.getElementById("styleManagerStatus");
    if (status) status.textContent=`Preview: ${preview.impact.count} consumer${preview.impact.count===1?"":"s"}.`;
    styleUpdateToken(token.id,patch);
  })));
  const references=styleSelect([["","Literal value"],...styleTokens()
    .filter(item => item.id !== token.id && item.type === token.type)
    .map(item => [item.id,`Reference · ${item.name}`])],token.ref || "","Token reference");
  references.addEventListener("change",() => {
    const result=styleUpdateToken(token.id,{ref:references.value});
    if (result?.error){ announce(result.error); renderStyleManager(); }
  });
  basics.appendChild(styleField("Reference",references));
  const description=document.createElement("textarea"); description.value=token.description;
  description.addEventListener("change",() => styleUpdateToken(token.id,{description:description.value}));
  basics.appendChild(styleField("Documentation",description,{wide:true}));
  editor.appendChild(basics);
  const resolved=styleResolveToken(token.id);
  const preview=styleHtml("section","style-token-preview");
  preview.appendChild(styleHtml("h4","","Resolved preview"));
  const swatch=styleHtml("span","style-token-swatch");
  if (token.type === "color") swatch.style.background=normalizeHex(resolved.value) || resolved.value;
  else swatch.textContent=String(resolved.value);
  preview.appendChild(swatch);
  preview.appendChild(styleHtml("code","",resolved.ok ? JSON.stringify(resolved.value) : resolved.error));
  const findings=styleValidateToken(token);
  for (const finding of findings)
    preview.appendChild(styleHtml("p",`style-finding ${finding.severity}`,finding.message));
  editor.appendChild(preview);
  styleRenderImpact(editor,"token",token.id);
  const actions=styleHtml("div","style-manager-actions");
  actions.append(
    styleButton("Duplicate",() => styleDuplicateToken(token.id)),
    styleButton("Find consumers",() => {
      const ids=styleTokenConsumers(token.id).objectIds;
      if (ids.length){ setSelection("node",ids.filter(nodeById)); closeStyleManager(); render(); }
      announce(`${token.name} has ${ids.length} object consumer${ids.length===1?"":"s"}.`);
    }),
    styleButton("Delete…",() => {
      const result=styleDeleteToken(token.id);
      if (result?.needsResolution){
        const replacement=styleTokens().find(item => item.id !== token.id && item.type === token.type);
        if (replacement && confirm(`${result.consumers.objectIds.length} objects or classes use this token. Replace it with ${replacement.name}?`))
          styleDeleteToken(token.id,{replacementId:replacement.id});
        else if (confirm("Convert every consumer to the resolved literal value and delete the token?"))
          styleDeleteToken(token.id,{localize:true});
      }
    },{className:"danger"})
  );
  editor.appendChild(actions);
  parent.appendChild(editor);
}
function styleClassPropertyRow(item,property,assignment){
  const row=styleHtml("div","style-class-property-row");
  const propertySelect=styleSelect(Object.entries(STYLE_PROPERTY_DEFINITIONS)
    .map(([id,definition]) => [id,definition.label]),property,"Style property");
  const nextProperty=patch => {
    const properties=styleClone(item.properties);
    delete properties[property]; Object.assign(properties,patch);
    const result=styleUpdateClass(item.id,{properties});
    if (result?.error) announce(result.error);
  };
  propertySelect.addEventListener("change",() => nextProperty({
    [propertySelect.value]:{value:STYLE_PROPERTY_DEFINITIONS[propertySelect.value].type === "color"
      ? "#2456E6" : STYLE_PROPERTY_DEFINITIONS[propertySelect.value].type === "lineStyle"
        ? "solid" : 2}
  }));
  row.appendChild(propertySelect);
  const definition=STYLE_PROPERTY_DEFINITIONS[property];
  const tokenOptions=styleTokens().filter(token => styleTokenCompatible(token,property))
    .map(token => [token.id,token.name]);
  const source=styleSelect([["","Literal value"],...tokenOptions],
    assignment.tokenId || "","Value source");
  row.appendChild(source);
  let valueInput;
  const renderValue=() => {
    if (valueInput) valueInput.remove();
    if (source.value){
      valueInput=styleHtml("span","style-property-token-value",
        String(styleResolveToken(source.value,definition.type).value ?? "Unavailable"));
    } else if (definition.type === "color"){
      valueInput=document.createElement("input"); valueInput.type="text";
      valueInput.value=assignment.value || "#2456E6";
    } else if (definition.type === "lineStyle"){
      valueInput=styleSelect([["solid","Solid"],["dash","Dashed"],["dot","Dotted"]],
        assignment.value || "solid","Literal value");
    } else if (definition.type === "fontFamily"){
      valueInput=document.createElement("input"); valueInput.value=assignment.value || "Archivo, sans-serif";
    } else {
      valueInput=document.createElement("input"); valueInput.type="number"; valueInput.step=".1";
      valueInput.value=Number(assignment.value) || definition.min || 1;
    }
    row.insertBefore(valueInput,row.lastElementChild);
    if (valueInput instanceof HTMLInputElement || valueInput instanceof HTMLSelectElement)
      valueInput.addEventListener("change",() => {
        const properties=styleClone(item.properties);
        properties[property]={value:valueInput.type === "number" ? Number(valueInput.value) : valueInput.value};
        styleUpdateClass(item.id,{properties});
      });
  };
  const remove=styleButton("×",() => {
    const properties=styleClone(item.properties); delete properties[property];
    styleUpdateClass(item.id,{properties});
  },{ariaLabel:`Remove ${definition.label}`});
  row.appendChild(remove);
  source.addEventListener("change",() => {
    const properties=styleClone(item.properties);
    properties[property]=source.value ? {tokenId:source.value} : {
      value:assignment.value ?? (definition.type === "color" ? "#2456E6" :
        definition.type === "lineStyle" ? "solid" : 2)
    };
    styleUpdateClass(item.id,{properties});
  });
  renderValue();
  return row;
}
function styleRenderClassEditor(parent,item){
  if (!item){ parent.appendChild(styleHtml("p","style-manager-empty","Create or select a class.")); return; }
  const editor=styleHtml("div","style-manager-editor");
  const basics=styleHtml("section","style-manager-basics");
  const name=document.createElement("input"); name.value=item.name;
  name.addEventListener("change",() => styleUpdateClass(item.id,{name:name.value}));
  basics.appendChild(styleField("Name",name));
  const base=styleSelect([["","No base class"],...styleClasses()
    .filter(other => other.id !== item.id && !other.modifier)
    .map(other => [other.id,other.name])],item.baseClassId || "","Base class");
  base.addEventListener("change",() => {
    const result=styleUpdateClass(item.id,{baseClassId:base.value});
    if (result?.error){ announce(result.error); renderStyleManager(); }
  });
  basics.appendChild(styleField("Inherits",base));
  const targets=styleHtml("div","style-class-targets");
  for (const [id,label] of STYLE_CLASS_TARGETS){
    const input=document.createElement("input"); input.type="checkbox";
    input.checked=item.appliesTo.includes(id);
    input.addEventListener("change",() => {
      const applies=new Set(item.appliesTo);
      if (input.checked) applies.add(id); else applies.delete(id);
      styleUpdateClass(item.id,{appliesTo:[...applies]});
    });
    const wrapper=styleHtml("label","style-inline-check"); wrapper.append(input,label);
    targets.appendChild(wrapper);
  }
  basics.appendChild(styleField("Compatible with",targets,{wide:true}));
  const modifier=document.createElement("input"); modifier.type="checkbox"; modifier.checked=item.modifier;
  modifier.addEventListener("change",() => styleUpdateClass(item.id,{modifier:modifier.checked}));
  const modifierLabel=styleHtml("label","style-inline-check"); modifierLabel.append(modifier,"Composable modifier");
  basics.appendChild(styleField("Role",modifierLabel));
  const description=document.createElement("textarea"); description.value=item.description;
  description.addEventListener("change",() => styleUpdateClass(item.id,{description:description.value}));
  basics.appendChild(styleField("Documentation",description,{wide:true}));
  editor.appendChild(basics);
  const propertySection=styleHtml("section","style-class-properties");
  const heading=styleHtml("div","style-manager-section-head");
  heading.append(styleHtml("h4","","Appearance properties"),styleButton("Add property",() => {
    const property=Object.keys(STYLE_PROPERTY_DEFINITIONS)
      .find(id => !Object.hasOwn(item.properties,id));
    if (!property) return;
    const definition=STYLE_PROPERTY_DEFINITIONS[property];
    styleUpdateClass(item.id,{properties:{...item.properties,[property]:{
      value:definition.type === "color" ? "#2456E6" :
        definition.type === "lineStyle" ? "solid" : 2
    }}});
  }));
  propertySection.appendChild(heading);
  for (const [property,assignment] of Object.entries(item.properties))
    propertySection.appendChild(styleClassPropertyRow(item,property,assignment));
  if (!Object.keys(item.properties).length)
    propertySection.appendChild(styleHtml("p","style-manager-empty","No appearance properties yet."));
  editor.appendChild(propertySection);
  const findings=styleValidateClass(item);
  if (findings.length){
    const validation=styleHtml("section","style-manager-validation");
    validation.appendChild(styleHtml("h4","","Validation"));
    for (const finding of findings)
      validation.appendChild(styleHtml("p",`style-finding ${finding.severity}`,finding.message));
    editor.appendChild(validation);
  }
  styleRenderImpact(editor,"class",item.id);
  const actions=styleHtml("div","style-manager-actions");
  actions.append(
    styleButton("Duplicate",() => styleDuplicateClass(item.id)),
    styleButton("Apply to selection",() => {
      const objects=sel?.kind === "edge" ? selectionIds("edge").map(edgeById).filter(Boolean) : selectedNodes();
      styleApplyClass(objects,item.id);
    }),
    styleButton("Delete…",() => {
      const result=styleDeleteClass(item.id);
      if (result?.needsResolution){
        const replacement=styleClasses().find(other => other.id !== item.id &&
          other.appliesTo.some(target => item.appliesTo.includes(target)));
        if (replacement && confirm(`${result.consumers.length} objects use this class. Replace it with ${replacement.name}?`))
          styleDeleteClass(item.id,{replacementId:replacement.id});
        else if (confirm("Detach the class from all consumers and delete it?"))
          styleDeleteClass(item.id,{detach:true});
      }
    },{className:"danger"})
  );
  editor.appendChild(actions);
  parent.appendChild(editor);
}
function styleRenderComponentEditor(parent,item){
  if (!item){ parent.appendChild(styleHtml("p","style-manager-empty",
    "Create a component from the current node selection.")); return; }
  const editor=styleHtml("div","style-manager-editor");
  const basics=styleHtml("section","style-manager-basics");
  const name=document.createElement("input"); name.value=item.name;
  name.addEventListener("change",() => styleMutation("Rename component",() => {
    item.name=styleText(name.value,item.name,100); item.updatedAt=styleNow();
  }));
  basics.append(styleField("Name",name),styleField("Version",Object.assign(
    document.createElement("input"),{value:item.version,readOnly:true})));
  const description=document.createElement("textarea"); description.value=item.description;
  description.addEventListener("change",() => styleMutation("Document component",() => {
    item.description=styleText(description.value,"",500); item.updatedAt=styleNow();
  }));
  basics.appendChild(styleField("Documentation",description,{wide:true}));
  editor.appendChild(basics);
  const preview=stylePreviewComponentUpdate(item.id);
  const summary=styleHtml("section","style-manager-impact");
  summary.append(styleHtml("h4","",`${item.nodes.length} nodes · ${item.edges.length} internal links`),
    styleHtml("p","",`${preview.summary.instances} instance${preview.summary.instances===1?"":"s"} · `+
      `${preview.summary.conflicts} override conflict${preview.summary.conflicts===1?"":"s"} · `+
      `${preview.summary.externalLinks} preserved external link${preview.summary.externalLinks===1?"":"s"}`));
  editor.appendChild(summary);
  const actions=styleHtml("div","style-manager-actions");
  actions.append(
    styleButton("Insert instance",() => styleInsertComponent(item.id,viewCenter())),
    styleButton("Preview definition update",() => {
      const result=styleUpdateComponentFromSelection(item.id,{preview:true});
      if (result.error) announce(result.error);
      else { styleComponentPreview=result; renderStyleManager(); }
    }),
    styleButton("Apply selected structure",() => {
      const result=styleUpdateComponentFromSelection(item.id,{preview:false});
      if (result.error) announce(result.error);
    }),
    styleButton("Sync all instances",() => {
      const result=styleApplyComponentUpdate(item.id,{preview:true});
      if (confirm(`Update ${result.summary.instances} instances? This adds ${result.summary.addedNodes}, removes ${result.summary.removedNodes}, and changes ${result.summary.changed} objects.`))
        styleApplyComponentUpdate(item.id,{preview:false});
    }),
    styleButton("Delete…",() => {
      const result=styleDeleteComponent(item.id);
      if (result?.needsResolution && confirm(`Detach ${result.instances.length} instances and delete this definition?`))
        styleDeleteComponent(item.id,{detach:true});
    },{className:"danger"})
  );
  editor.appendChild(actions);
  if (styleComponentPreview?.after?.id === item.id){
    const box=styleHtml("section","style-manager-validation");
    box.append(styleHtml("h4","","Pending definition preview"),
      styleHtml("p","",`${styleComponentPreview.impacts.length} instances will be compared before synchronization.`));
    editor.appendChild(box);
  }
  parent.appendChild(editor);
}
function styleRenderTemplateEditor(parent,item){
  if (!item){ parent.appendChild(styleHtml("p","style-manager-empty","Create or select a template.")); return; }
  const editor=styleHtml("div","style-manager-editor");
  const basics=styleHtml("section","style-manager-basics");
  const name=document.createElement("input"); name.value=item.name;
  name.addEventListener("change",() => styleUpdateTemplate(item.id,{name:name.value}));
  basics.appendChild(styleField("Name",name));
  const description=document.createElement("textarea"); description.value=item.description;
  description.addEventListener("change",() => styleUpdateTemplate(item.id,{description:description.value}));
  basics.appendChild(styleField("Documentation",description,{wide:true}));
  editor.appendChild(basics);
  const values={};
  const prompts=styleHtml("section","style-template-prompts");
  prompts.appendChild(styleHtml("h4","","Template variables"));
  for (const variable of item.variables){
    let input;
    if (variable.type === "enum"){
      input=styleSelect((variable.options || []).map(value => [value,value]),
        String(variable.default || "" ),variable.label);
    } else {
      input=document.createElement("input");
      input.type=variable.type === "number" ? "number" : variable.type === "boolean" ? "checkbox" : "text";
      if (input.type === "checkbox") input.checked=variable.default === true;
      else input.value=variable.default ?? "";
    }
    const read=() => input.type === "checkbox" ? input.checked : input.value;
    values[variable.id]=read();
    input.addEventListener("input",() => { values[variable.id]=read(); });
    prompts.appendChild(styleField(variable.label,input));
  }
  if (!item.variables.length) prompts.appendChild(styleHtml("p","style-manager-empty","No variables."));
  editor.appendChild(prompts);
  const advanced=document.createElement("details"); advanced.className="style-manager-advanced";
  const summary=document.createElement("summary"); summary.textContent="Structured template schema";
  const textarea=document.createElement("textarea");
  textarea.value=JSON.stringify({variables:item.variables,blueprint:item.blueprint},null,2);
  const error=styleHtml("p","style-finding error","");
  textarea.addEventListener("change",() => {
    try {
      const parsed=JSON.parse(textarea.value);
      styleUpdateTemplate(item.id,{variables:parsed.variables,blueprint:parsed.blueprint});
      error.textContent="";
    } catch(parseError){ error.textContent=parseError.message; }
  });
  advanced.append(summary,textarea,error); editor.appendChild(advanced);
  const actions=styleHtml("div","style-manager-actions");
  actions.append(
    styleButton("Preview",() => {
      const preview=styleInstantiateTemplate(item.id,values,viewCenter(),{preview:true});
      announce(preview.valid
        ? `${preview.summary.nodes} nodes and ${preview.summary.edges} links are ready.`
        : preview.errors.map(entry => entry.message).join(" "));
    }),
    styleButton("Create on canvas",() => {
      const result=styleInstantiateTemplate(item.id,values,viewCenter());
      if (result.valid === false)
        announce(result.errors.map(entry => entry.message).join(" "));
      else closeStyleManager();
    },{className:"primary"}),
    styleButton("Delete",() => styleDeleteTemplate(item.id),{className:"danger"})
  );
  editor.appendChild(actions);
  parent.appendChild(editor);
}
function styleDownloadLibrary(){
  const packageData=styleExportLibraryPackage();
  const name=`${ensureStyleSystem().library.name.toLowerCase().replace(/[^a-z0-9]+/g,"-") || "styles"}.schematic-library.json`;
  download(name,JSON.stringify(packageData,null,2),"application/json");
}
function styleRenderLibraryMode(body){
  const layout=styleHtml("div","style-library-manager");
  const manifest=ensureStyleSystem().library;
  const summary=styleHtml("section","style-library-card");
  summary.append(styleHtml("span","object-explorer-kicker","Embedded offline library"),
    styleHtml("h3","",manifest.name),
    styleHtml("p","",`${manifest.version} · ${manifest.scope} · ${manifest.authority}`),
    styleHtml("p","",manifest.description));
  const manifestForm=styleHtml("div","style-library-manifest-grid");
  const manifestControl=(label,key,type="text") => {
    const input=type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    input.value=manifest[key] || "";
    input.addEventListener("change",() => styleMutation("Update library manifest",() => {
      if (key === "version") manifest[key]=styleSemver(input.value,manifest.version);
      else manifest[key]=styleText(input.value,manifest[key] || "",key === "description" ? 500 : 100);
      manifest.updatedAt=styleNow();
    }));
    manifestForm.appendChild(styleField(label,input,{wide:key === "description"}));
  };
  manifestControl("Name","name"); manifestControl("Version","version");
  manifestControl("Owner","owner"); manifestControl("Description","description","textarea");
  summary.appendChild(manifestForm);
  const counts=styleHtml("div","style-library-counts");
  for (const [label,count] of [["Tokens",styleTokens().length],["Classes",styleClasses().length],
    ["Components",styleComponents().length],["Templates",styleTemplates().length]])
    counts.appendChild(styleHtml("span","",`${count} ${label}`));
  summary.appendChild(counts);
  const actions=styleHtml("div","style-manager-actions");
  actions.append(styleButton("Export library",styleDownloadLibrary),
    styleButton("Validate references",() => {
      const findings=[...styleValidateSystem(),...styleRepairReferences()];
      announce(findings.length ? `${findings.length} style finding${findings.length===1?"":"s"}.`
        : "Style library references are valid.");
      renderStyleManager();
    }));
  summary.appendChild(actions);
  layout.appendChild(summary);
  const importer=styleHtml("section","style-library-importer");
  importer.appendChild(styleHtml("h4","","Import or update a library"));
  const textarea=document.createElement("textarea");
  textarea.placeholder="Paste a .schematic-library.json package here for an offline conflict preview.";
  const result=styleHtml("div","style-library-conflicts");
  const controls=styleHtml("div","style-manager-actions");
  controls.append(
    styleButton("Analyze",() => {
      try {
        styleImportPreview=styleImportLibraryPackage(JSON.parse(textarea.value),{preview:true});
        renderStyleManager();
      } catch(error){ announce(`Library JSON could not be read: ${error.message}`); }
    }),
    styleButton("Import reviewed update",() => {
      if (!styleImportPreview){ announce("Analyze a library package first."); return; }
      const raw=JSON.parse(textarea.value);
      styleImportLibraryPackage(raw,{preview:false,strategy:"fork"});
      styleImportPreview=null;
    },{className:"primary"})
  );
  importer.append(textarea,controls);
  if (styleImportPreview){
    const counts=styleImportPreview.counts;
    result.append(styleHtml("h4","",styleImportPreview.manifest.name),
      styleHtml("p","",`${counts.new} new · ${counts["compatible-update"]} updates · `+
        `${counts.divergent} divergent · ${counts["name-collision"]} name collisions · `+
        `${styleImportPreview.missing.length} missing dependencies`));
    for (const item of styleImportPreview.items.filter(item => item.conflict !== "same").slice(0,24))
      result.appendChild(styleHtml("p",`style-library-conflict ${item.conflict}`,
        `${item.kind} · ${item.name} · ${item.conflict}`));
    importer.appendChild(result);
  }
  layout.appendChild(importer);
  const cached=styleHtml("section","style-library-cache");
  cached.appendChild(styleHtml("h4","","Pinned imported libraries"));
  for (const library of ensureStyleSystem().importedLibraries)
    cached.appendChild(styleHtml("p","",`${library.manifest.name} ${library.pinnedVersion} · ${library.status} · cached ${library.cachedAt.slice(0,10)}`));
  if (!ensureStyleSystem().importedLibraries.length)
    cached.appendChild(styleHtml("p","style-manager-empty","No imported libraries. The document library is fully offline."));
  layout.appendChild(cached);
  body.appendChild(layout);
}
function renderStyleManager(){
  const modal=document.getElementById("styleManager");
  const body=document.getElementById("styleManagerBody");
  if (!modal || !body) return;
  for (const tab of modal.querySelectorAll("[data-style-manager-mode]")){
    const active=tab.dataset.styleManagerMode === styleManagerMode;
    tab.setAttribute("aria-selected",String(active)); tab.tabIndex=active ? 0 : -1;
  }
  const create=document.getElementById("btnStyleManagerCreate");
  if (create){
    create.hidden=styleManagerMode === "libraries";
    create.textContent=styleManagerMode === "components" ? "From selection"
      : `New ${styleDefinitionLabel(styleManagerMode)}`;
  }
  body.replaceChildren();
  if (styleManagerMode === "libraries"){
    styleRenderLibraryMode(body);
    const status=document.getElementById("styleManagerStatus");
    if (status) status.textContent=`1 document library · ${ensureStyleSystem().importedLibraries.length} imported · ${styleValidateSystem().length} findings`;
    return;
  }
  const collection=styleDefinitionCollection(styleManagerMode);
  if (!collection.some(item => item.id === styleSelectedId)) styleSelectedId=collection[0]?.id || "";
  const layout=styleHtml("div","style-manager-layout");
  styleRenderDefinitionList(layout,styleManagerMode);
  const editorPane=styleHtml("main","style-manager-editor-pane");
  const item=collection.find(entry => entry.id === styleSelectedId) || null;
  if (styleManagerMode === "tokens") styleRenderTokenEditor(editorPane,item);
  else if (styleManagerMode === "classes") styleRenderClassEditor(editorPane,item);
  else if (styleManagerMode === "components") styleRenderComponentEditor(editorPane,item);
  else styleRenderTemplateEditor(editorPane,item);
  layout.appendChild(editorPane); body.appendChild(layout);
  const status=document.getElementById("styleManagerStatus");
  if (status) status.textContent=`${collection.length} ${styleManagerMode} · ${styleValidateSystem().length} findings`;
}
function openStyleManager(mode="tokens",opts={}){
  const modal=document.getElementById("styleManager");
  if (!modal) return false;
  styleManagerReturnFocus=document.activeElement;
  styleManagerMode=["tokens","classes","libraries","components","templates"].includes(mode)
    ? mode : "tokens";
  styleSelectedId=opts.id || styleSelectedId;
  styleManagerOpen=true; modal.hidden=false; modal.classList.add("open");
  renderStyleManager();
  requestAnimationFrame(() => modal.querySelector("[aria-selected=true]")?.focus());
  return true;
}
function closeStyleManager(){
  const modal=document.getElementById("styleManager");
  if (!modal || !styleManagerOpen) return false;
  modal.classList.remove("open"); modal.hidden=true;
  styleManagerOpen=false; styleImportPreview=null; styleComponentPreview=null;
  const focus=styleManagerReturnFocus; styleManagerReturnFocus=null;
  if (focus && document.contains(focus)) focus.focus();
  return true;
}
function initializeStyleSystemUi(){
  const modal=document.getElementById("styleManager");
  if (!modal) return;
  const tabs=[...modal.querySelectorAll("[data-style-manager-mode]")];
  tabs.forEach(tab => {
    tab.addEventListener("click",() => {
      styleManagerMode=tab.dataset.styleManagerMode; styleSelectedId=""; renderStyleManager();
    });
    tab.addEventListener("keydown",event => {
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      event.preventDefault();
      const index=tabs.indexOf(tab);
      const next=event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1
        : (index+(event.key === "ArrowRight" ? 1 : -1)+tabs.length)%tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
  });
  document.getElementById("btnCloseStyleManager")?.addEventListener("click",closeStyleManager);
  document.getElementById("btnStyleManagerCreate")?.addEventListener("click",() => {
    if (styleManagerMode === "tokens") styleCreateToken();
    else if (styleManagerMode === "classes") styleCreateClass();
    else if (styleManagerMode === "components"){
      const result=styleCreateComponentFromSelection("Reusable component");
      if (result.error) announce(result.error);
    } else if (styleManagerMode === "templates") styleCreateTemplate();
  });
  modal.addEventListener("pointerdown",event => {
    if (event.target === modal) closeStyleManager();
  });
  document.addEventListener("keydown",event => {
    if (event.key === "Escape" && styleManagerOpen){
      event.preventDefault(); closeStyleManager();
    }
  });
}

function styleInspectorTokenSelect(object,property){
  const compatible=styleTokens().filter(token => styleTokenCompatible(token,property));
  const current=object.styleTokenRefs?.[property] || "";
  const select=styleSelect([["","No direct token"],...compatible.map(token => [token.id,token.name])],
    current,`${STYLE_PROPERTY_DEFINITIONS[property].label} token`);
  select.addEventListener("change",() => styleApplyToken([object],property,select.value));
  return select;
}
function renderStyleMultiInspector(objects){
  const targets=(objects || []).filter(Boolean);
  if (!targets.length || typeof inspectorSection !== "function") return;
  const sharedClass=targets.every(object => object.styleClassId === targets[0].styleClassId)
    ? targets[0].styleClassId || "" : "__mixed__";
  const compatible=styleClasses().filter(item => !item.modifier &&
    targets.some(object => styleClassCompatible(item,object)));
  inspectorSection("style-system:multi","Style system",() => {
    frow("Primary class",() => {
      const options=[["","No class"],...compatible.map(item => [item.id,item.name])];
      if (sharedClass === "__mixed__") options.unshift(["__mixed__","Mixed classes"]);
      const select=styleSelect(options,sharedClass,"Primary style class for selection");
      if (sharedClass === "__mixed__") select.options[0].disabled=true;
      select.addEventListener("change",() => styleApplyClass(targets,select.value));
      return select;
    });
    const sourceKinds=new Map();
    for (const object of targets){
      const resolved=typeof formattingResolveAppearance === "function"
        ? formattingResolveAppearance(object) : styleResolveAppearance(object);
      for (const [property,sources] of Object.entries(resolved.sources || {})){
        const winner=sources.find(source => source.winning);
        if (!winner) continue;
        if (!sourceKinds.has(property)) sourceKinds.set(property,new Set());
        sourceKinds.get(property).add(`${winner.source}:${winner.classId || winner.tokenId || winner.ruleId || ""}`);
      }
    }
    const summary=styleHtml("div","style-inspector-origin-summary");
    for (const [property,kinds] of sourceKinds){
      if (kinds.size === 1) continue;
      const row=styleHtml("div","style-inspector-origin");
      row.append(styleHtml("strong","",STYLE_PROPERTY_DEFINITIONS[property]?.label || property),
        styleHtml("span","","Mixed origins"),
        styleHtml("small","",`${kinds.size} distinct source chains`));
      summary.appendChild(row);
    }
    if (summary.childElementCount) appendInspector(summary);
    appendInspector(styleButton("Open style manager",() => openStyleManager("classes"),
      {className:"inspector-wide-action"}));
  },{open:false});
}
function renderStyleInspectorForObject(object){
  if (!object || typeof inspectorSection !== "function") return;
  const classes=styleClasses().filter(item => !item.modifier && styleClassCompatible(item,object));
  const modifiers=styleClasses().filter(item => item.modifier && styleClassCompatible(item,object));
  inspectorSection("style-system:assignment","Style system",() => {
    frow("Primary class",() => {
      const select=styleSelect([["","No class"],...classes.map(item => [item.id,item.name])],
        object.styleClassId || "","Primary style class");
      select.addEventListener("change",() => styleApplyClass([object],select.value));
      return select;
    });
    if (modifiers.length) frow("Modifiers",() => {
      const box=styleHtml("div","style-inspector-modifiers");
      for (const item of modifiers){
        const input=document.createElement("input"); input.type="checkbox";
        input.checked=(object.modifierClassIds || []).includes(item.id);
        input.addEventListener("change",() => styleToggleModifier([object],item.id,input.checked));
        const label=styleHtml("label","style-inline-check"); label.append(input,item.name); box.appendChild(label);
      }
      return box;
    });
    const tokenProperties=styleObjectKind(object) === "edge"
      ? ["lineColor","lineWidth","lineStyle","labelTextColor","labelBackgroundColor"]
      : ["fill","textColor","borderColor","borderWidth","fontSize","cornerRadius","iconSize"];
    for (const property of tokenProperties.filter(item => stylePropertyCompatible(item,object)))
      frow(`${STYLE_PROPERTY_DEFINITIONS[property].label} token`,
        () => styleInspectorTokenSelect(object,property));
    const resolved=typeof formattingResolveAppearance === "function"
      ? formattingResolveAppearance(object) : styleResolveAppearance(object);
    const summary=styleHtml("div","style-inspector-origin-summary");
    for (const [property,sources] of Object.entries(resolved.sources || {})){
      const winner=sources.find(source => source.winning);
      if (!winner || !["token","document-token","class","rule","manual"].includes(winner.source)) continue;
      const row=styleHtml("div","style-inspector-origin");
      row.append(styleHtml("strong","",STYLE_PROPERTY_DEFINITIONS[property]?.label || property),
        styleHtml("span","",String(resolved.values[property])),
        styleHtml("small","",winner.source === "manual" ? "Manual override" :
          `${winner.label}${winner.libraryId ? ` · ${winner.libraryId}` : ""}`));
      if (object.styleOverrides?.[property])
        row.appendChild(styleButton("Clear override",() => styleClearObjectOverride(object,property)));
      summary.appendChild(row);
    }
    if (summary.childElementCount) appendInspector(summary);
    appendInspector(styleButton("Open style manager",() => openStyleManager("classes",
      {id:object.styleClassId}),{className:"inspector-wide-action"}));
    appendInspector(styleButton("Create class from this appearance",() => {
      const item=styleCreateClassFromObject(object);
      if (item) openStyleManager("classes",{id:item.id});
    },{className:"inspector-wide-action"}));
    if (object.componentInstanceId){
      const component=styleComponentById(object.componentDefinitionId);
      const componentBox=styleHtml("div","style-component-inspector");
      componentBox.append(styleHtml("strong","",component?.name || "Missing component"),
        styleHtml("small","",`Instance ${object.componentInstanceId} · ${object.componentVersion || "unknown version"}`));
      if (object.componentUpdateAvailable)
        componentBox.appendChild(styleHtml("span","warning",
          `Update ${object.componentUpdateAvailable} available`));
      componentBox.append(
        styleButton("Find definition",() => openStyleManager("components",{id:object.componentDefinitionId})),
        styleButton("Detach instance",() => styleDetachComponentInstance(object.componentInstanceId))
      );
      appendInspector(componentBox);
    }
  },{open:false});
}
function buildStyleNodeContext(parent,node,targets){
  if (typeof ctxGroup !== "function") return;
  ctxGroup(parent,"node:style-system","Styles",panel => {
    ctxGroup(panel,"node:style-class","Primary class",sub => {
      ctxItem(sub,"No class",() => styleApplyClass(targets,""),
        {pressed:targets.every(item => !item.styleClassId)});
      for (const item of styleClasses().filter(entry => !entry.modifier &&
        targets.some(target => styleClassCompatible(entry,target))))
        ctxItem(sub,item.name,() => styleApplyClass(targets,item.id),
          {pressed:targets.every(target => target.styleClassId === item.id)});
    });
    const modifiers=styleClasses().filter(entry => entry.modifier &&
      targets.some(target => styleClassCompatible(entry,target)));
    if (modifiers.length) ctxGroup(panel,"node:style-modifiers","Modifiers",sub => {
      for (const item of modifiers){
        const all=targets.every(target => (target.modifierClassIds || []).includes(item.id));
        ctxItem(sub,item.name,() => styleToggleModifier(targets,item.id,!all),{pressed:all});
      }
    });
    ctxItem(panel,"Manage tokens and classes…",() => openStyleManager("classes",
      {id:node.styleClassId}),{action:"manage-style-system"});
    if (targets.length === 1)
      ctxItem(panel,"Create class from appearance",() => {
        const item=styleCreateClassFromObject(node);
        if (item) openStyleManager("classes",{id:item.id});
      },{action:"create-style-class-from-object"});
    if (node.componentInstanceId)
      ctxItem(panel,"Detach component instance",() =>
        styleDetachComponentInstance(node.componentInstanceId),{action:"detach-component"});
  });
}
function buildStyleEdgeContext(parent,edge){
  if (typeof ctxGroup !== "function") return;
  ctxGroup(parent,"edge:style-system","Styles",panel => {
    ctxGroup(panel,"edge:style-class","Primary class",sub => {
      ctxItem(sub,"No class",() => styleApplyClass([edge],""),
        {pressed:!edge.styleClassId});
      for (const item of styleClasses().filter(entry => !entry.modifier && styleClassCompatible(entry,edge)))
        ctxItem(sub,item.name,() => styleApplyClass([edge],item.id),
          {pressed:edge.styleClassId === item.id});
    });
    ctxItem(panel,"Manage tokens and classes…",() =>
      openStyleManager("classes",{id:edge.styleClassId}),{action:"manage-style-system"});
    ctxItem(panel,"Create class from appearance",() => {
      const item=styleCreateClassFromObject(edge);
      if (item) openStyleManager("classes",{id:item.id});
    },{action:"create-style-class-from-object"});
  });
}
function buildStyleCanvasContext(parent){
  if (typeof ctxGroup !== "function") return;
  ctxGroup(parent,"canvas:style-system","Styles and reuse",panel => {
    ctxItem(panel,"Design tokens…",() => openStyleManager("tokens"),{action:"manage-tokens"});
    ctxItem(panel,"Style classes…",() => openStyleManager("classes"),{action:"manage-style-classes"});
    ctxItem(panel,"Reusable components…",() => openStyleManager("components"),
      {action:"manage-components"});
    ctxItem(panel,"Templates…",() => openStyleManager("templates"),{action:"manage-templates"});
    ctxItem(panel,"Libraries…",() => openStyleManager("libraries"),{action:"manage-libraries"});
  });
}
function initializeStyleSystemCommands(){
  if (typeof registerCommand !== "function") return;
  registerCommand({id:"openStyleManager",label:"Styles",description:"Manage design tokens and reusable classes",
    icon:"lucide:palette",scope:"document-read",action:() => openStyleManager("classes"),
    ribbon:{tab:"model",group:"Styles"}});
  registerCommand({id:"openTokenManager",label:"Tokens",description:"Manage named design values",
    icon:"lucide:swatch-book",scope:"document-read",action:() => openStyleManager("tokens"),
    ribbon:{tab:"model",group:"Styles"}});
  registerCommand({id:"openLibraryManager",label:"Libraries",description:"Import, export, and validate offline libraries",
    icon:"lucide:library",scope:"document-read",action:() => openStyleManager("libraries"),
    ribbon:{tab:"model",group:"Reuse"}});
  registerCommand({id:"createComponent",label:"Create component",description:"Turn selected nodes into a reusable definition",
    icon:"lucide:component",scope:"selection",minimumSelection:1,
    enabled:() => selectedNodes().length > 0,mutatesDocument:true,
    action:() => {
      const result=styleCreateComponentFromSelection("Reusable component");
      if (result.error) announce(result.error); else openStyleManager("components",{id:result.id});
      return result;
    },ribbon:{tab:"model",group:"Reuse"}});
  registerCommand({id:"openTemplateManager",label:"Templates",description:"Create a configured starter model",
    icon:"lucide:layout-template",scope:"document-read",action:() => openStyleManager("templates"),
    ribbon:{tab:"model",group:"Reuse"}});
}
