"use strict";

/* =====================================================================
   CONDITIONAL FORMATTING — declarative visual rules, saved lenses,
   explainable appearance resolution, semantic zoom, and rule authoring.

   Rules never mutate model facts. They resolve runtime presentation values
   over the existing document and retain provenance for every winning value.
   ===================================================================== */

const FORMATTING_SCHEMA_VERSION = 1;
const FORMATTING_TARGETS = [
  ["all","All objects"], ["node","All nodes"], ["edge","All relationships"],
  ["concept","Concepts"], ["status","Status nodes"], ["table","Tables"],
  ["todo","To-do lists"], ["note","Rich notes"], ["text","Text boxes"],
  ["frame","Frames"], ["swimlane","Swimlanes"]
];
const FORMATTING_SCOPE_KINDS = [
  ["document","Document"], ["page","Page / view"], ["layer","Layer"],
  ["container","Container"], ["objectType","Semantic object type"],
  ["relationshipType","Relationship type"], ["selection","Specific objects"],
  ["lens","Saved lens"]
];
const FORMATTING_COMPARATORS = [
  ["equals","equals"], ["notEquals","does not equal"], ["contains","contains"],
  ["in","is one of"], ["notIn","is not one of"], ["present","is present"],
  ["missing","is missing"], ["blank","is blank"], ["invalid","is invalid"],
  ["greaterThan","is greater than"], ["greaterOrEqual","is at least"],
  ["lessThan","is less than"], ["lessOrEqual","is at most"],
  ["before","is before"], ["after","is after"]
];
const FORMATTING_ACTIONS = [
  ["fill","Fill color"], ["titleBandColor","Title-band color"], ["textColor","Text color"],
  ["borderColor","Border color"],
  ["borderWidth","Border width"], ["borderStyle","Border style"],
  ["fontWeight","Text emphasis"], ["opacity","Opacity"], ["strikeThrough","Strike-through"],
  ["icon","Icon / emoji"], ["badge","Badge label"], ["badgeColor","Badge color"],
  ["lineColor","Link color"], ["lineWidth","Link width"], ["lineStyle","Link style"],
  ["labelTextColor","Link-label text"], ["labelBackgroundColor","Link-label background"]
];
const FORMATTING_COLOR_SAFE = {
  warning:"#C20029", caution:"#B05A00", positive:"#007873", information:"#2456E6",
  neutral:"#6B7683", purple:"#8A3FA8"
};
const FORMATTING_ZOOM_TIERS = [
  {id:"overview",label:"Overview",max:.52},
  {id:"summary",label:"Summary",max:.9},
  {id:"detail",label:"Detail",max:1.55},
  {id:"inspection",label:"Inspection",max:Infinity}
];
const FORMATTING_MANUAL_FIELDS = {
  fill:"color", textColor:"fontColor", borderColor:"borderColor", borderWidth:"borderWidth",
  borderStyle:"borderStyle", fontWeight:"fontWeight", opacity:"opacity",
  fontFamily:"fontFamily", fontSize:"fontSize", lineHeight:"lineHeight",
  cornerRadius:"cornerRadius", spacing:"spacing", iconSize:"iconSize",
  strikeThrough:"strikeThrough", icon:"icon", badge:"badge", badgeColor:"badgeColor",
  lineColor:"lineColor", lineWidth:"lineWidth", lineStyle:"lineStyle",
  labelTextColor:"labelTextColor", labelBackgroundColor:"labelBackgroundColor",
  titleBandColor:"titleColor"
};
const FORMATTING_GRAPH_FIELDS = new Set([
  "inboundCount","outboundCount","relationshipCount","blockedPredecessorCount",
  "canceledPredecessorCount","descendantBlockedCount","hasSensitiveField"
]);

let formattingNormalizedState = null;
let formattingPanelOpen = false;
let formattingPanelMode = "rules";
let formattingSelectedRuleId = "";
let formattingSelectedLensId = "";
let formattingPanelReturnFocus = null;
let formattingPreviewIds = new Set();
let formattingPreviewRule = null;
let formattingPreviewSnapshot = null;
let formattingActiveLensId = "";
let formattingZoomTier = "detail";
let formattingZoomPinned = "";
let formattingRuleRevision = 0;
let formattingModelRevision = 0;
let formattingCache = new Map();
let formattingMatchCache = new Map();
let formattingLensCache = {key:"",matches:new Set()};
const formattingStats = {
  evaluations:0, cacheHits:0, lastDurationMs:0, lastObjectCount:0,
  lastRuleCount:0, incrementalInvalidations:0, fullInvalidations:0
};

function formattingClone(value){
  return value == null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}
function formattingText(value, fallback = "", max = 160){
  const text = typeof value === "string" ? value.replace(/\s+/g," ").trim() : "";
  return (text || fallback).slice(0,max);
}
function formattingUid(prefix){
  return `${prefix}-${typeof uid === "function" ? uid() : Date.now().toString(36)}`;
}
function formattingDefaultCondition(){
  return {op:"all",children:[{op:"predicate",field:"status",comparator:"equals",value:"Blocked",
    fallback:"no-match"}]};
}
function formattingDefaultAction(){
  return {property:"borderColor",value:FORMATTING_COLOR_SAFE.warning};
}
function defaultConditionalFormatting(){
  return {
    schemaVersion:FORMATTING_SCHEMA_VERSION,
    rules:[],
    lenses:[],
    semanticZoom:{
      enabled:true,
      tiers:FORMATTING_ZOOM_TIERS.map(tier => ({id:tier.id,label:tier.label,max:tier.max}))
    }
  };
}
function formattingNormalizePredicate(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const comparator = FORMATTING_COMPARATORS.some(([id]) => id === source.comparator)
    ? source.comparator : "equals";
  return {
    op:"predicate",
    field:formattingText(source.field,"status",120),
    comparator,
    ...(source.value !== undefined ? {value:formattingClone(source.value)} : {}),
    ...(source.value2 !== undefined ? {value2:formattingClone(source.value2)} : {}),
    fallback:["match","no-match","unknown"].includes(source.fallback) ? source.fallback : "no-match"
  };
}
function formattingNormalizeCondition(raw, depth = 0, opts = {}){
  if (depth > 12) return formattingDefaultCondition();
  const source = raw && typeof raw === "object" ? raw : {};
  if (source.op === "predicate") return formattingNormalizePredicate(source);
  if (source.op === "not")
    return {op:"not",child:formattingNormalizeCondition(source.child,depth+1,opts)};
  const op = source.op === "any" ? "any" : "all";
  const children = (Array.isArray(source.children) ? source.children : [])
    .slice(0,40).map(child => formattingNormalizeCondition(child,depth+1,opts));
  return {op,children:children.length ? children :
    opts.allowEmpty ? [] : [formattingNormalizePredicate(source)]};
}
function formattingNormalizeScope(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const kind = FORMATTING_SCOPE_KINDS.some(([id]) => id === source.kind) ? source.kind : "document";
  const out = {kind};
  const id = formattingText(source.id,"",120);
  if (id) out.id = id;
  if (Array.isArray(source.ids))
    out.ids = [...new Set(source.ids.map(String).filter(Boolean))].slice(0,5000);
  return out;
}
function formattingNormalizeAction(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const property = FORMATTING_ACTIONS.some(([id]) => id === source.property)
    ? source.property : "badge";
  let value = formattingClone(source.value);
  if (["fill","titleBandColor","textColor","borderColor","badgeColor","lineColor","labelTextColor",
      "labelBackgroundColor"].includes(property)){
    value = normalizeColorValue(value) || (property === "badgeColor"
      ? FORMATTING_COLOR_SAFE.information : "#2456E6");
  } else if (["borderWidth","lineWidth"].includes(property)){
    value = Math.max(.5,Math.min(16,Number(value) || 2));
  } else if (property === "opacity"){
    value = Math.max(.08,Math.min(1,Number(value)));
    if (!Number.isFinite(value)) value = .45;
  } else if (property === "fontWeight"){
    value = Math.max(400,Math.min(800,Number(value) || 700));
  } else if (property === "strikeThrough"){
    value = value !== false;
  } else if (property === "borderStyle" || property === "lineStyle"){
    value = ["solid","dash","dot"].includes(value) ? value : "solid";
  } else value = formattingText(String(value == null ? "" : value),
    property === "badge" ? "Flag" : "",80);
  return {property,value};
}
function formattingConditionPredicates(condition, out = []){
  if (!condition) return out;
  if (condition.op === "predicate") out.push(condition);
  else if (condition.op === "not") formattingConditionPredicates(condition.child,out);
  else for (const child of condition.children || []) formattingConditionPredicates(child,out);
  return out;
}
function formattingRuleDependencies(condition, scope){
  const keys = new Set();
  for (const predicate of formattingConditionPredicates(condition)){
    const field = predicate.field;
    if (field.startsWith("property:")) keys.add(field);
    else if (FORMATTING_GRAPH_FIELDS.has(field)) keys.add("graph");
    else if (field.startsWith("validation")) keys.add("validation");
    else if (["layer","group","container","pageId"].includes(field)) keys.add("organization");
    else keys.add(`field:${field}`);
  }
  if (scope && scope.kind !== "document") keys.add(`scope:${scope.kind}`);
  return [...keys].sort();
}
function formattingNormalizeRule(raw, index, ids){
  if (!raw || typeof raw !== "object") return null;
  let id = formattingText(raw.id,"",120);
  if (!id || ids.has(id)) id = `rule-${index+1}-${formattingUid("r")}`;
  ids.add(id);
  const condition = raw.condition
    ? formattingNormalizeCondition(raw.condition,0,{allowEmpty:true})
    : formattingDefaultCondition();
  const scope = formattingNormalizeScope(raw.scope);
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .slice(0,24).map(formattingNormalizeAction);
  const priority = Math.max(-9999,Math.min(9999,Math.round(Number(raw.priority) || 0)));
  const target = FORMATTING_TARGETS.some(([value]) => value === raw.target) ? raw.target : "all";
  const out = {
    schemaVersion:1,
    id,
    name:formattingText(raw.name,`Rule ${index+1}`,100),
    enabled:raw.enabled !== false,
    target,
    scope,
    condition,
    actions:actions.length ? actions : [formattingDefaultAction()],
    priority,
    stopProcessing:raw.stopProcessing === true,
    description:formattingText(raw.description || raw.rationale,"",500),
    legendLabel:formattingText(raw.legendLabel,"",100),
    accessibilityText:formattingText(raw.accessibilityText,"",180),
    dependencies:formattingRuleDependencies(condition,scope),
    createdAt:typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
  };
  if (raw.effectiveFrom) out.effectiveFrom = String(raw.effectiveFrom).slice(0,10);
  if (raw.effectiveTo) out.effectiveTo = String(raw.effectiveTo).slice(0,10);
  if (raw.invalidReason) out.invalidReason = formattingText(raw.invalidReason,"",240);
  return out;
}
function formattingNormalizeLens(raw, index, ids){
  if (!raw || typeof raw !== "object") return null;
  let id = formattingText(raw.id,"",120);
  if (!id || ids.has(id)) id = `lens-${index+1}-${formattingUid("l")}`;
  ids.add(id);
  const treatment = ["hide","ghost","dim","unchanged"].includes(raw.nonmatchTreatment)
    ? raw.nonmatchTreatment : "ghost";
  return {
    schemaVersion:1,
    id,
    name:formattingText(raw.name,`Lens ${index+1}`,100),
    description:formattingText(raw.description,"",500),
    owner:formattingText(raw.owner,"",100),
    enabled:raw.enabled !== false,
    condition:formattingNormalizeCondition(raw.condition || {op:"all",children:[]},0,{allowEmpty:true}),
    nonmatchTreatment:treatment,
    contextDirection:["in","out","both"].includes(raw.contextDirection) ? raw.contextDirection : "both",
    contextHops:Math.max(0,Math.min(4,Math.round(Number(raw.contextHops) || 0))),
    relationshipTypes:Array.isArray(raw.relationshipTypes)
      ? [...new Set(raw.relationshipTypes.map(String).filter(Boolean))].slice(0,100) : [],
    ruleIds:Array.isArray(raw.ruleIds)
      ? [...new Set(raw.ruleIds.map(String).filter(Boolean))].slice(0,200) : [],
    scope:formattingNormalizeScope(raw.scope),
    legendTitle:formattingText(raw.legendTitle,"Legend",100),
    zoomTier:FORMATTING_ZOOM_TIERS.some(tier => tier.id === raw.zoomTier) ? raw.zoomTier : "",
    createdAt:typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt:typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
  };
}
function normalizeConditionalFormatting(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  if (Number(source.schemaVersion) > FORMATTING_SCHEMA_VERSION){
    return {...defaultConditionalFormatting(),futurePayload:formattingClone(source),
      warning:`Formatting schema ${source.schemaVersion} is newer than this app.`};
  }
  const ruleIds = new Set(), lensIds = new Set();
  const rules = (Array.isArray(source.rules) ? source.rules : [])
    .map((rule,index) => formattingNormalizeRule(rule,index,ruleIds)).filter(Boolean);
  const lenses = (Array.isArray(source.lenses) ? source.lenses : [])
    .map((lens,index) => formattingNormalizeLens(lens,index,lensIds)).filter(Boolean);
  for (const lens of lenses) lens.ruleIds = lens.ruleIds.filter(id => ruleIds.has(id));
  const zoom = source.semanticZoom && typeof source.semanticZoom === "object"
    ? source.semanticZoom : {};
  const activeLensId = lensIds.has(source.activeLensId) ? source.activeLensId : "";
  return {
    schemaVersion:FORMATTING_SCHEMA_VERSION,
    rules,lenses,
    semanticZoom:{
      enabled:zoom.enabled !== false,
      tiers:FORMATTING_ZOOM_TIERS.map(tier => ({id:tier.id,label:tier.label,max:tier.max}))
    },
    ...(activeLensId ? {activeLensId} : {}),
    ...(source.futurePayload ? {futurePayload:formattingClone(source.futurePayload)} : {})
  };
}
function ensureConditionalFormatting(){
  if (state.formatting && state.formatting === formattingNormalizedState) return state.formatting;
  state.formatting = normalizeConditionalFormatting(state.formatting);
  formattingNormalizedState = state.formatting;
  formattingActiveLensId = state.formatting.activeLensId || "";
  formattingInvalidateAll("normalize");
  return state.formatting;
}
function cleanConditionalFormattingForDocument(raw = state.formatting){
  const normalized = normalizeConditionalFormatting(raw);
  if (!normalized.rules.length && !normalized.lenses.length && !normalized.activeLensId &&
      !normalized.futurePayload) return undefined;
  return normalized;
}
function formattingRules(){
  return ensureConditionalFormatting().rules.slice().sort((a,b) =>
    b.priority-a.priority || ensureConditionalFormatting().rules.indexOf(a) -
      ensureConditionalFormatting().rules.indexOf(b) || a.id.localeCompare(b.id));
}
function formattingRuleById(id){
  return ensureConditionalFormatting().rules.find(rule => rule.id === id) || null;
}
function formattingLenses(){ return ensureConditionalFormatting().lenses; }
function formattingLensById(id){
  return ensureConditionalFormatting().lenses.find(lens => lens.id === id) || null;
}
function formattingObjectKind(object){
  return object && typeof object === "object" && "from" in object && "to" in object
    ? "edge" : "node";
}
function formattingObjectById(id){ return nodeById(id) || edgeById(id); }
function formattingObjectLabel(object){
  if (!object) return "Object";
  if (formattingObjectKind(object) === "node") return object.title || object.id;
  if (typeof metadataObjectName === "function") return metadataObjectName(object);
  return object.label || object.kind || "Relationship";
}
function formattingTargetMatches(rule,object){
  const kind = formattingObjectKind(object);
  if (rule.target === "all") return true;
  if (rule.target === "node" || rule.target === "edge") return rule.target === kind;
  return kind === "node" && object.type === rule.target;
}
function formattingScopeMatches(scope,object){
  const current = scope || {kind:"document"};
  if (current.kind === "document") return true;
  if (current.kind === "page") return !!current.id && object.pageId === current.id;
  if (current.kind === "selection") return (current.ids || []).includes(object.id);
  if (current.kind === "objectType")
    return formattingObjectKind(object) === "node" && object.semanticTypeId === current.id;
  if (current.kind === "relationshipType")
    return formattingObjectKind(object) === "edge" &&
      (object.semanticTypeId === current.id || object.kind === current.id || object.label === current.id);
  if (current.kind === "layer"){
    return typeof organizationObjectLayerId === "function" &&
      organizationObjectLayerId(object) === current.id;
  }
  if (current.kind === "container"){
    const container = nodeById(current.id);
    return !!container && typeof containerContainedNodes === "function" &&
      containerContainedNodes(container).some(node => node.id === object.id);
  }
  if (current.kind === "lens"){
    const lens = formattingLensById(current.id);
    if (!lens) return false;
    const matches = formattingLensMatches(lens);
    if (formattingObjectKind(object) === "node") return matches.has(object.id);
    return matches.has(object.from) && matches.has(object.to);
  }
  if (current.kind === "lens") return formattingActiveLensId === current.id;
  return false;
}
function formattingDateActive(rule,now = new Date()){
  const day = now.toISOString().slice(0,10);
  return (!rule.effectiveFrom || day >= rule.effectiveFrom) &&
    (!rule.effectiveTo || day <= rule.effectiveTo);
}
function formattingComparable(value){
  if (Array.isArray(value)) return value.map(formattingComparable);
  if (value && typeof value === "object"){
    if ("id" in value && "label" in value) return [value.id,value.label];
    if ("label" in value) return value.label;
    if ("id" in value) return value.id;
  }
  return value;
}
function formattingMetadataValue(object,id){
  try {
    if (typeof metadataValue === "function") return metadataValue(object,id);
    return object && object.properties ? object.properties[id] : undefined;
  } catch { return undefined; }
}
function formattingObjectValidation(object){
  try {
    return formattingObjectKind(object) === "edge" && typeof metadataValidateRelationship === "function"
      ? metadataValidateRelationship(object)
      : typeof metadataValidateObject === "function" ? metadataValidateObject(object) : [];
  } catch(error){
    return [{severity:"error",code:"evaluation",message:error.message || String(error)}];
  }
}
function formattingContainerIds(object){
  if (formattingObjectKind(object) !== "node") return [];
  return state.nodes.filter(isStructuralNode).filter(container => {
    try { return containerContainedNodes(container).some(node => node.id === object.id); }
    catch { return false; }
  }).map(container => container.id);
}
function formattingGraphValue(object,field){
  if (formattingObjectKind(object) !== "node") return undefined;
  const inbound = state.edges.filter(edge => edge.to === object.id);
  const outbound = state.edges.filter(edge => edge.from === object.id);
  if (field === "inboundCount") return inbound.length;
  if (field === "outboundCount") return outbound.length;
  if (field === "relationshipCount") return inbound.length + outbound.length;
  if (field === "blockedPredecessorCount" || field === "canceledPredecessorCount"){
    const wanted = field === "blockedPredecessorCount" ? "Blocked" : "Canceled";
    return inbound.map(edge => nodeById(edge.from)).filter(node =>
      node && String(node.status || "").toLowerCase() === wanted.toLowerCase()).length;
  }
  if (field === "descendantBlockedCount" && isStructuralNode(object)){
    return containerContainedNodes(object).filter(node =>
      String(node.status || "").toLowerCase() === "blocked").length;
  }
  if (field === "hasSensitiveField"){
    if (object.type !== "table") return false;
    if ((object.fields || []).some(item => item.sensitive === true ||
        /restricted|confidential|sensitive/i.test(item.classification || item.notes || ""))) return true;
    if (typeof metadataPropertyDefinitions === "function")
      return metadataPropertyDefinitions().some(definition => definition.sensitive === true &&
        formattingMetadataValue(object,definition.id) != null);
    return false;
  }
  return undefined;
}
function formattingReadField(object,field){
  if (!object) return {state:"unavailable",value:undefined};
  if (field.startsWith("property:")){
    const id = field.slice(9);
    const definition = typeof metadataPropertyById === "function" ? metadataPropertyById(id) : null;
    if (!definition) return {state:"invalid",value:undefined,detail:`Unknown property ${id}`};
    const value = formattingMetadataValue(object,id);
    return {state:value == null ? "missing" : value === "" ? "blank" : "present",value,definition};
  }
  if (field.startsWith("metadata:")){
    const name = field.slice(9).toLowerCase();
    const definition = typeof metadataPropertyDefinitions === "function"
      ? metadataPropertyDefinitions().find(item => item.name.toLowerCase() === name) : null;
    if (!definition) return {state:"invalid",value:undefined,detail:`Unknown property ${field.slice(9)}`};
    const value = formattingMetadataValue(object,definition.id);
    return {state:value == null ? "missing" : value === "" ? "blank" : "present",value,definition};
  }
  if (FORMATTING_GRAPH_FIELDS.has(field)){
    const value = formattingGraphValue(object,field);
    return {state:value === undefined ? "unavailable" : "present",value};
  }
  if (field === "validationCount" || field === "invalidMetadata" || field === "missingRequiredCount"){
    const findings = formattingObjectValidation(object);
    const value = field === "validationCount" ? findings.length
      : field === "invalidMetadata" ? findings.some(item => item.severity === "error")
      : findings.filter(item => item.code === "required").length;
    return {state:"present",value,findings};
  }
  if (field === "ageDays" || field === "reviewAgeDays"){
    const raw = field === "reviewAgeDays"
      ? formattingMetadataValue(object,"p-reviewed") : object.updatedAt || object.createdAt;
    const timestamp = raw ? Date.parse(String(raw).length === 10 ? `${raw}T00:00:00Z` : raw) : NaN;
    return Number.isFinite(timestamp)
      ? {state:"present",value:Math.max(0,Math.floor((Date.now()-timestamp)/86400000))}
      : {state:raw == null ? "missing" : "invalid",value:undefined};
  }
  if (field === "owner"){
    const value = formattingMetadataValue(object,"p-owner") ?? object.owner;
    return {state:value == null ? "missing" : "present",value};
  }
  if (field === "tags"){
    const value = Array.isArray(object.tags) ? object.tags : [];
    return {state:value.length ? "present" : "missing",value};
  }
  if (field === "layer"){
    const value = typeof organizationObjectLayerId === "function"
      ? organizationObjectLayerId(object) : object.layerId;
    return {state:value ? "present" : "missing",value};
  }
  if (field === "group"){
    const value = object.groupId;
    return {state:value ? "present" : "missing",value};
  }
  if (field === "container"){
    const value = formattingContainerIds(object);
    return {state:value.length ? "present" : "missing",value};
  }
  if (field === "locked"){
    const value = typeof organizationCanMutateObject === "function"
      ? !organizationCanMutateObject(object) : object.locked === true;
    return {state:"present",value};
  }
  const value = field === "relationshipType" ? object.semanticTypeId || object.kind || object.label
    : field === "objectType" ? object.semanticTypeId
    : field === "status" ? object.status
    : field === "visibility" ? object.hidden === true ? "hidden" : "visible"
    : object[field];
  return {state:value == null ? "missing" : value === "" ? "blank" : "present",value};
}
function formattingScalarEqual(actual,expected){
  const left = formattingComparable(actual), right = formattingComparable(expected);
  if (Array.isArray(left)) return left.some(value => formattingScalarEqual(value,right));
  if (Array.isArray(right)) return right.some(value => formattingScalarEqual(left,value));
  if (typeof left === "string" || typeof right === "string")
    return String(left == null ? "" : left).toLowerCase() ===
      String(right == null ? "" : right).toLowerCase();
  return left === right;
}
function formattingCompareValue(read,predicate){
  const comparator = predicate.comparator;
  if (comparator === "present") return read.state === "present";
  if (comparator === "missing") return read.state === "missing" || read.state === "unavailable";
  if (comparator === "blank") return read.state === "blank";
  if (comparator === "invalid") return read.state === "invalid" ||
    (read.findings || []).some(item => item.severity === "error");
  if (["invalid","unavailable"].includes(read.state)) return null;
  const actual = formattingComparable(read.value);
  const expected = formattingComparable(predicate.value);
  if (comparator === "equals") return formattingScalarEqual(actual,expected);
  if (comparator === "notEquals") return !formattingScalarEqual(actual,expected);
  if (comparator === "contains"){
    if (Array.isArray(actual)) return actual.some(value => formattingScalarEqual(value,expected));
    return String(actual == null ? "" : actual).toLowerCase()
      .includes(String(expected == null ? "" : expected).toLowerCase());
  }
  if (comparator === "in" || comparator === "notIn"){
    const values = Array.isArray(expected) ? expected
      : String(expected == null ? "" : expected).split(",").map(value => value.trim()).filter(Boolean);
    const found = values.some(value => formattingScalarEqual(actual,value));
    return comparator === "in" ? found : !found;
  }
  if (comparator === "before" || comparator === "after"){
    const a = Date.parse(String(actual)), b = Date.parse(String(expected));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return comparator === "before" ? a < b : a > b;
  }
  const a = Number(actual), b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (comparator === "greaterThan") return a > b;
  if (comparator === "greaterOrEqual") return a >= b;
  if (comparator === "lessThan") return a < b;
  if (comparator === "lessOrEqual") return a <= b;
  return false;
}
function formattingEvaluateCondition(object,condition){
  if (!condition) return {result:false,explanations:[]};
  if (condition.op === "predicate"){
    const read = formattingReadField(object,condition.field);
    const raw = formattingCompareValue(read,condition);
    const result = raw == null
      ? condition.fallback === "match"
        ? true
        : condition.fallback === "unknown" ? null : false
      : raw;
    return {
      result,
      explanations:[{
        field:condition.field,
        comparator:condition.comparator,
        expected:formattingClone(condition.value),
        actual:formattingClone(read.value),
        state:read.state,
        result
      }]
    };
  }
  if (condition.op === "not"){
    const child = formattingEvaluateCondition(object,condition.child);
    return {result:child.result == null ? null : !child.result,explanations:child.explanations};
  }
  const children = (condition.children || []).map(child => formattingEvaluateCondition(object,child));
  if (!children.length) return {result:true,explanations:[]};
  const results = children.map(child => child.result);
  const result = condition.op === "any"
    ? results.some(Boolean) ? true : results.some(value => value == null) ? null : false
    : results.some(value => value === false) ? false : results.some(value => value == null) ? null : true;
  return {result,explanations:children.flatMap(child => child.explanations)};
}
function formattingRuleEvaluation(rule,object){
  if (!rule.enabled || rule.invalidReason || !formattingDateActive(rule) ||
      !formattingTargetMatches(rule,object) || !formattingScopeMatches(rule.scope,object))
    return {matches:false,result:false,explanations:[],reason:"Out of scope or disabled"};
  const evaluation = formattingEvaluateCondition(object,rule.condition);
  return {...evaluation,matches:evaluation.result === true,
    reason:evaluation.result === true ? "Matched" : evaluation.result == null ? "Unknown" : "Did not match"};
}
function formattingBaseValues(object){
  if (typeof styleRawBaseValues === "function") return styleRawBaseValues(object);
  const kind = formattingObjectKind(object);
  const t = themeColors();
  if (kind === "edge") return {
    lineColor:normalizeHex(object.lineColor) || (object.kind === "link" ? t.link : t.edge),
    lineWidth:Number.isFinite(Number(object.lineWidth)) ? Number(object.lineWidth) : 1.7,
    lineStyle:["solid","dash","dot"].includes(object.lineStyle)
      ? object.lineStyle : object.kind === "link" ? "dash" : "solid",
    labelTextColor:normalizeHex(object.labelTextColor) || normalizeHex(object.lineColor) ||
      (object.kind === "link" ? t.link : t.edge),
    labelBackgroundColor:normalizeHex(object.labelBackgroundColor) || t.labelBg,
    opacity:1
  };
  const fill = normalizeHex(object.color) || (object.type === "frame" ? frameColorDefault()
    : object.type === "todo" ? todoColorDefault()
    : object.type === "table" ? t.ink : conceptColors()[1]);
  return {
    fill,
    textColor:normalizeHex(object.fontColor) || autoInk(fill,t),
    borderColor:normalizeHex(object.borderColor) || t.ink,
    borderWidth:Number.isFinite(Number(object.borderWidth)) ? Number(object.borderWidth) : 1.2,
    borderStyle:["solid","dash","dot"].includes(object.borderStyle) ? object.borderStyle : "solid",
    fontWeight:Number.isFinite(Number(object.fontWeight)) ? Number(object.fontWeight) : 600,
    opacity:1,
    strikeThrough:false,
    icon:object.icon || "",
    badge:object.badge || "",
    badgeColor:normalizeHex(object.badgeColor) || FORMATTING_COLOR_SAFE.information,
    titleBandColor:normalizeHex(object.titleColor) || ""
  };
}
function formattingManualOverrides(object){ return object && object.styleOverrides &&
  typeof object.styleOverrides === "object" ? object.styleOverrides : {}; }
function formattingValueFromObject(object,property,base){
  const field = FORMATTING_MANUAL_FIELDS[property];
  return field && object[field] !== undefined ? object[field] : base[property];
}
function formattingResolveAppearance(object,opts = {}){
  ensureConditionalFormatting();
  const styleAppearance = typeof styleResolveAppearance === "function"
    ? styleResolveAppearance(object) : null;
  const base = styleAppearance ? {...styleAppearance.values} : formattingBaseValues(object);
  const manual = formattingManualOverrides(object);
  const lens = !opts.rules ? formattingLensById(formattingActiveLensId) : null;
  const sourceRules = opts.rules || (lens && lens.ruleIds.length
    ? formattingRules().filter(rule => lens.ruleIds.includes(rule.id))
    : formattingRules());
  const fingerprint = !opts.noCache ? formattingStableFingerprint(object,sourceRules) : "";
  const cacheKey = `${object.id}:${formattingRuleRevision}:${formattingModelRevision}:${formattingActiveLensId}:${fingerprint}`;
  if (!opts.noCache && formattingCache.has(cacheKey)){
    formattingStats.cacheHits++;
    return formattingCache.get(cacheKey);
  }
  const values = {...base};
  const sources = styleAppearance ? formattingClone(styleAppearance.sources) :
    Object.fromEntries(Object.entries(base).map(([property,value]) =>
      [property,[{source:"base",label:"Object or product default",value:formattingClone(value),winning:true}]]));
  const matches = [];
  const assigned = new Map();
  const conflicts = [];
  for (const rule of sourceRules){
    const evaluation = formattingRuleEvaluation(rule,object);
    if (!evaluation.matches) continue;
    matches.push({ruleId:rule.id,ruleName:rule.name,priority:rule.priority,
      stopProcessing:rule.stopProcessing,explanations:evaluation.explanations});
    for (const action of rule.actions){
      const earlier = assigned.get(action.property);
      const candidate = {source:"rule",ruleId:rule.id,label:rule.name,priority:rule.priority,
        value:formattingClone(action.value),winning:!earlier};
      if (!sources[action.property]) sources[action.property] = [];
      sources[action.property].push(candidate);
      if (!earlier){
        for (const source of sources[action.property])
          source.winning = source === candidate;
        values[action.property] = formattingClone(action.value);
        assigned.set(action.property,{rule,value:action.value});
      } else if (earlier.rule.priority === rule.priority &&
          JSON.stringify(earlier.value) !== JSON.stringify(action.value)){
        conflicts.push({property:action.property,priority:rule.priority,
          winner:earlier.rule.id,shadowed:rule.id});
      }
    }
    if (rule.stopProcessing) break;
  }
  for (const [property,enabled] of Object.entries(manual)){
    if (!enabled || !(property in base)) continue;
    for (const item of sources[property] || []) item.winning = false;
    const value = formattingValueFromObject(object,property,base);
    values[property] = formattingClone(value);
    (sources[property] ||= []).push({source:"manual",label:"Manual override",
      value:formattingClone(value),winning:true});
  }
  const result = {
    objectId:object.id,values,sources,matches,conflicts,
    accessibility:matches.map(match => match.ruleName)
  };
  formattingStats.evaluations++;
  if (!opts.noCache) formattingCache.set(cacheKey,result);
  return result;
}
function formattingStableFingerprint(object,rules){
  const fields = new Set(["id","type","semanticTypeId","styleOverrides",
    ...Object.values(FORMATTING_MANUAL_FIELDS)]);
  const payload = {};
  payload.theme = {
    mode:typeof docTheme === "string" ? docTheme : "",
    colors:typeof themeColors === "function" ? themeColors() : {}
  };
  for (const field of fields)
    if (object[field] !== undefined) payload[field] = object[field];
  const predicateFields = [...new Set(rules.flatMap(rule =>
    formattingConditionPredicates(rule.condition).map(predicate => predicate.field)))].sort();
  payload.dependencies = Object.fromEntries(predicateFields.map(field => {
    const read = formattingReadField(object,field);
    return [field,{state:read.state,value:read.value}];
  }));
  payload.scopes = rules.filter(rule => rule.scope.kind !== "document")
    .map(rule => [rule.id,formattingScopeMatches(rule.scope,object)]);
  try {
    return typeof historyChecksum === "function" ? historyChecksum(payload) : JSON.stringify(payload);
  } catch { return `${object.id}:${Date.now()}`; }
}
function formattingEffectiveValue(object,property,fallback){
  const value = formattingResolveAppearance(object).values[property];
  return value === undefined || value === "" ? fallback : value;
}
function formattingMarkManualOverride(object,property,enabled = true){
  if (!object || !(property in FORMATTING_MANUAL_FIELDS)) return false;
  if (enabled){
    object.styleOverrides = {...(object.styleOverrides || {}),[property]:true};
  } else if (object.styleOverrides){
    delete object.styleOverrides[property];
    if (!Object.keys(object.styleOverrides).length) delete object.styleOverrides;
  }
  formattingInvalidateObject(object.id,`manual:${property}`);
  return true;
}
function formattingSetManualValue(object,property,value){
  const field = FORMATTING_MANUAL_FIELDS[property];
  if (!object || !field) return false;
  object[field] = value;
  if (typeof styleMarkComponentOverride === "function")
    styleMarkComponentOverride(object,field,true);
  formattingMarkManualOverride(object,property,true);
  return true;
}
function formattingManualPropertyForField(field){
  return Object.entries(FORMATTING_MANUAL_FIELDS)
    .find(([,objectField]) => objectField === field)?.[0] || "";
}
function formattingClearManualOverride(object,property){
  if (!object) return false;
  return formattingMarkManualOverride(object,property,false);
}
function formattingInvalidateObject(id,reason = ""){
  formattingModelRevision++;
  formattingCache.clear();
  formattingMatchCache.clear();
  formattingLensCache = {key:"",matches:new Set()};
  formattingStats.incrementalInvalidations++;
  return {id,reason};
}
function formattingInvalidateAppearanceIds(ids){
  const wanted=new Set(Array.isArray(ids) ? ids : [ids]);
  for (const key of formattingCache.keys()){
    const objectId=key.slice(0,key.indexOf(":"));
    if (wanted.has(objectId)) formattingCache.delete(key);
  }
  formattingStats.incrementalInvalidations++;
  return wanted.size;
}
function formattingInvalidateAll(){
  formattingRuleRevision++;
  formattingCache.clear();
  formattingMatchCache.clear();
  formattingLensCache = {key:"",matches:new Set()};
  formattingStats.fullInvalidations++;
}
function formattingInvalidateTransaction(transaction){
  if (!transaction || !Array.isArray(transaction.operations)) return;
  const relevant = transaction.operations.filter(operation =>
    !["geometry","size"].includes(operation.category));
  if (!relevant.length) return;
  formattingModelRevision++;
  formattingCache.clear();
  formattingMatchCache.clear();
  formattingLensCache = {key:"",matches:new Set()};
  formattingStats.incrementalInvalidations++;
}
function formattingCreateRule(seed = {}){
  ensureConditionalFormatting();
  const rule = formattingNormalizeRule({
    id:formattingUid("rule"),
    name:seed.name || "New formatting rule",
    enabled:true,target:seed.target || "node",
    scope:seed.scope || {kind:"document"},
    condition:seed.condition || formattingDefaultCondition(),
    actions:seed.actions || [formattingDefaultAction()],
    priority:Number(seed.priority) || 0,
    stopProcessing:seed.stopProcessing === true,
    description:seed.description || "",
    legendLabel:seed.legendLabel || "",
    accessibilityText:seed.accessibilityText || "",
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  },state.formatting.rules.length,new Set(state.formatting.rules.map(item => item.id)));
  state.formatting.rules.push(rule);
  formattingSelectedRuleId = rule.id;
  formattingInvalidateAll();
  return rule;
}
function formattingUpdateRule(id,patch){
  const index = ensureConditionalFormatting().rules.findIndex(rule => rule.id === id);
  if (index < 0) return null;
  const current = state.formatting.rules[index];
  const ids = new Set(state.formatting.rules.filter(rule => rule.id !== id).map(rule => rule.id));
  const next = formattingNormalizeRule({...current,...formattingClone(patch),id,
    updatedAt:new Date().toISOString()},index,ids);
  state.formatting.rules[index] = next;
  formattingInvalidateAll();
  return next;
}
function formattingDeleteRule(id){
  const index = ensureConditionalFormatting().rules.findIndex(rule => rule.id === id);
  if (index < 0) return false;
  state.formatting.rules.splice(index,1);
  for (const lens of state.formatting.lenses)
    lens.ruleIds = lens.ruleIds.filter(ruleId => ruleId !== id);
  formattingSelectedRuleId = state.formatting.rules[index]?.id ||
    state.formatting.rules[index-1]?.id || "";
  formattingInvalidateAll();
  return true;
}
function formattingDuplicateRule(id){
  const source = formattingRuleById(id);
  if (!source) return null;
  const copy = formattingCreateRule({...formattingClone(source),
    name:`${source.name} copy`,priority:source.priority});
  copy.condition = formattingClone(source.condition);
  copy.actions = formattingClone(source.actions);
  copy.scope = formattingClone(source.scope);
  return copy;
}
function formattingReorderRule(id,direction){
  const rules = ensureConditionalFormatting().rules;
  const index = rules.findIndex(rule => rule.id === id);
  const next = index + (direction < 0 ? -1 : 1);
  if (index < 0 || next < 0 || next >= rules.length) return false;
  [rules[index],rules[next]] = [rules[next],rules[index]];
  formattingInvalidateAll();
  return true;
}
function formattingCreateLens(seed = {}){
  ensureConditionalFormatting();
  const lens = formattingNormalizeLens({
    id:formattingUid("lens"),name:seed.name || "New lens",enabled:true,
    description:seed.description || "",condition:seed.condition || {op:"all",children:[]},
    nonmatchTreatment:seed.nonmatchTreatment || "ghost",
    contextDirection:seed.contextDirection || "both",contextHops:seed.contextHops || 0,
    relationshipTypes:seed.relationshipTypes || [],ruleIds:seed.ruleIds || [],
    scope:seed.scope || {kind:"document"},zoomTier:seed.zoomTier || ""
  },state.formatting.lenses.length,new Set(state.formatting.lenses.map(item => item.id)));
  state.formatting.lenses.push(lens);
  formattingSelectedLensId = lens.id;
  formattingInvalidateAll();
  return lens;
}
function formattingUpdateLens(id,patch){
  const index = ensureConditionalFormatting().lenses.findIndex(lens => lens.id === id);
  if (index < 0) return null;
  const current = state.formatting.lenses[index];
  const ids = new Set(state.formatting.lenses.filter(lens => lens.id !== id).map(lens => lens.id));
  const next = formattingNormalizeLens({...current,...formattingClone(patch),id,
    updatedAt:new Date().toISOString()},index,ids);
  state.formatting.lenses[index] = next;
  formattingInvalidateAll();
  return next;
}
function formattingDeleteLens(id){
  const index = ensureConditionalFormatting().lenses.findIndex(lens => lens.id === id);
  if (index < 0) return false;
  state.formatting.lenses.splice(index,1);
  if (formattingActiveLensId === id) formattingApplyLens("");
  formattingSelectedLensId = state.formatting.lenses[index]?.id ||
    state.formatting.lenses[index-1]?.id || "";
  formattingInvalidateAll();
  return true;
}
function formattingLensBaseMatches(lens){
  const matches = new Set();
  for (const node of state.nodes){
    if (formattingScopeMatches(lens.scope,node) &&
        formattingEvaluateCondition(node,lens.condition).result === true) matches.add(node.id);
  }
  return matches;
}
function formattingLensMatches(lens = formattingLensById(formattingActiveLensId)){
  if (!lens || !lens.enabled) return new Set(state.nodes.map(node => node.id));
  const key = `${lens.id}:${lens.updatedAt}:${formattingRuleRevision}:${formattingModelRevision}`;
  if (formattingLensCache.key === key) return new Set(formattingLensCache.matches);
  const matches = formattingLensBaseMatches(lens);
  let frontier = new Set(matches);
  for (let hop=0;hop<lens.contextHops;hop++){
    const next = new Set();
    for (const edge of state.edges){
      if (lens.relationshipTypes.length &&
          !lens.relationshipTypes.includes(edge.semanticTypeId || edge.kind || edge.label)) continue;
      if ((lens.contextDirection === "out" || lens.contextDirection === "both") && frontier.has(edge.from))
        next.add(edge.to);
      if ((lens.contextDirection === "in" || lens.contextDirection === "both") && frontier.has(edge.to))
        next.add(edge.from);
    }
    for (const id of next) matches.add(id);
    frontier = next;
  }
  for (const node of state.nodes){
    if (!matches.has(node.id) || isStructuralNode(node)) continue;
    for (const containerId of formattingContainerIds(node)) matches.add(containerId);
  }
  formattingLensCache = {key,matches:new Set(matches)};
  return new Set(matches);
}
function formattingApplyLens(id){
  ensureConditionalFormatting();
  const lens = id ? formattingLensById(id) : null;
  formattingActiveLensId = lens ? lens.id : "";
  if (formattingActiveLensId) state.formatting.activeLensId = formattingActiveLensId;
  else delete state.formatting.activeLensId;
  formattingZoomPinned = lens && lens.zoomTier || "";
  formattingInvalidateAll();
  render();
  announce(lens ? `Applied lens ${lens.name}.` : "Conditional formatting lens cleared.");
  return !!lens || !id;
}
function conditionalLensHiddenNodeIds(){
  const lens = formattingLensById(formattingActiveLensId);
  if (!lens || lens.nonmatchTreatment !== "hide") return new Set();
  const matches = formattingLensMatches(lens);
  return new Set(state.nodes.filter(node => !matches.has(node.id)).map(node => node.id));
}
function formattingLensOpacity(object){
  const lens = formattingLensById(formattingActiveLensId);
  if (!lens || lens.nonmatchTreatment === "unchanged" || lens.nonmatchTreatment === "hide") return 1;
  const matches = formattingLensMatches(lens);
  if (matches.has(object.id)) return 1;
  return lens.nonmatchTreatment === "dim" ? .58 : .24;
}
function formattingSemanticZoomTier(scale = view.k){
  const settings = ensureConditionalFormatting().semanticZoom;
  if (formattingZoomPinned) return formattingZoomPinned;
  if (!settings.enabled) return "inspection";
  const previous = FORMATTING_ZOOM_TIERS.find(tier => tier.id === formattingZoomTier);
  const hysteresis = .045;
  if (previous){
    const index = FORMATTING_ZOOM_TIERS.indexOf(previous);
    const lower = index ? FORMATTING_ZOOM_TIERS[index-1].max : 0;
    if (scale >= lower-hysteresis && scale <= previous.max+hysteresis) return previous.id;
  }
  return FORMATTING_ZOOM_TIERS.find(tier => scale <= tier.max)?.id || "inspection";
}
function formattingUpdateSemanticZoom(scale = view.k){
  const next = formattingSemanticZoomTier(scale);
  if (next === formattingZoomTier) return false;
  formattingZoomTier = next;
  return true;
}
function formattingSetZoomTier(id = ""){
  formattingZoomPinned = FORMATTING_ZOOM_TIERS.some(tier => tier.id === id) ? id : "";
  formattingUpdateSemanticZoom();
  render();
}
function formattingApplySemanticZoom(group,object){
  const tier = formattingSemanticZoomTier();
  formattingZoomTier = tier;
  group.dataset.semanticZoom = tier;
  group.setAttribute("aria-label",`${formattingObjectLabel(object)}. ${tier} detail.`);
  if (tier === "inspection") return;
  if (tier === "overview"){
    for (const element of group.querySelectorAll(
      "[data-concept-subtitle],[data-status-subtitle],[data-node-input-label],[data-node-output-label]," +
      "[data-note-content],[data-table-row-detail],[data-todo-row-detail],[data-row-handle]," +
      "[data-field-handle],[data-node-anchor]")) element.setAttribute("visibility","hidden");
  } else if (tier === "summary"){
    for (const element of group.querySelectorAll(
      "[data-note-content],[data-table-row-detail],[data-todo-row-detail],[data-row-handle],[data-field-handle]"))
      element.setAttribute("visibility","hidden");
  }
}
function formattingRuleMatchCount(rule){
  const key = `${rule.id}:${formattingRuleRevision}:${formattingModelRevision}`;
  if (formattingMatchCache.has(key)) return formattingMatchCache.get(key);
  const objects = [...state.nodes,...state.edges];
  const started = performance.now();
  const matches = objects.filter(object => formattingRuleEvaluation(rule,object).matches);
  const result = {count:matches.length,ids:matches.map(object => object.id),
    durationMs:performance.now()-started,objects:objects.length};
  formattingMatchCache.set(key,result);
  return result;
}
function formattingPreview(rule){
  formattingPreviewSnapshot = {
    selection:sel ? {kind:sel.kind,ids:[...sel.ids]} : null,
    view:{...view}
  };
  formattingPreviewRule = formattingNormalizeRule({...rule,id:rule.id || formattingUid("preview")},
    0,new Set());
  const result = formattingRuleMatchCount(formattingPreviewRule);
  formattingPreviewIds = new Set(result.ids);
  render();
  return result;
}
function formattingCancelPreview(){
  formattingPreviewIds = new Set();
  formattingPreviewRule = null;
  const snapshot = formattingPreviewSnapshot;
  formattingPreviewSnapshot = null;
  if (snapshot){
    view = {...snapshot.view};
    if (snapshot.selection) setSelection(snapshot.selection.kind,snapshot.selection.ids);
  }
  render();
  return true;
}
function formattingDashArray(style){
  return style === "dash" ? "7 5" : style === "dot" ? "2 4" : "none";
}
function formattingCanvasColor(value){
  return normalizeHex(value) || value;
}
function formattingDecorateGroup(group,object,appearance = formattingResolveAppearance(object)){
  if (!group) return appearance;
  const values = appearance.values;
  const lensOpacity = formattingLensOpacity(object);
  const opacity = Math.min(Number(values.opacity) || 1,lensOpacity);
  if (opacity < 1) group.setAttribute("opacity",opacity);
  if (appearance.matches.length){
    group.dataset.formattingRules = appearance.matches.map(match => match.ruleId).join(" ");
    group.setAttribute("aria-description",
      `Conditional formatting: ${appearance.matches.map(match => match.ruleName).join(", ")}.`);
  }
  if (formattingPreviewIds.has(object.id)){
    group.classList.add("formatting-preview-match");
    group.dataset.formattingPreview = "match";
  }
  const hasResolvedSource = property => appearance.sources[property]?.some(source =>
    source.source !== "base" && source.winning);
  if (hasResolvedSource("fontFamily"))
    for (const text of group.querySelectorAll("text"))
      text.setAttribute("font-family",values.fontFamily);
  if (hasResolvedSource("fontWeight"))
    for (const text of group.querySelectorAll("text"))
      text.setAttribute("font-weight",values.fontWeight);
  if (formattingObjectKind(object) === "edge" && hasResolvedSource("fontSize"))
    for (const text of group.querySelectorAll("text"))
      text.setAttribute("font-size",values.fontSize);
  if (values.lineHeight != null) group.dataset.styleLineHeight=String(values.lineHeight);
  if (values.spacing != null) group.dataset.styleSpacing=String(values.spacing);
  if (formattingObjectKind(object) === "node"){
    const fillTargets = group.querySelectorAll("[data-node-fill],[data-node-shape]," +
      "[data-text-shape-surface],[data-status-surface],[data-note-surface]," +
      "[data-frame-surface],[data-swimlane-body]");
    if (appearance.sources.fill?.some(source => source.source !== "base" && source.winning))
      for (const surface of fillTargets)
        surface.setAttribute("fill",formattingCanvasColor(values.fill));
    if (appearance.sources.titleBandColor?.some(source => source.source !== "base" && source.winning))
      for (const surface of group.querySelectorAll("[data-swimlane-title-band]"))
        surface.setAttribute("fill",formattingCanvasColor(values.titleBandColor));
    const outlines = group.querySelectorAll("[data-node-outline],[data-node-shape]," +
      "[data-text-shape-surface],[data-status-outline],[data-note-surface]," +
      "[data-frame-surface],[data-swimlane-body]");
    const hasRuleBorder = ["borderColor","borderWidth","borderStyle"].some(property =>
      appearance.sources[property]?.some(source => source.source !== "base" && source.winning));
    if (hasRuleBorder){
      for (const surface of outlines){
        surface.setAttribute("stroke",formattingCanvasColor(values.borderColor));
        surface.setAttribute("stroke-width",values.borderWidth || 2);
        surface.setAttribute("stroke-dasharray",formattingDashArray(values.borderStyle));
      }
    }
    if (appearance.sources.textColor?.some(source => source.source !== "base" && source.winning))
      for (const text of group.querySelectorAll("text"))
        text.setAttribute("fill",formattingCanvasColor(values.textColor));
    if (hasResolvedSource("cornerRadius"))
      for (const surface of group.querySelectorAll("rect[data-node-shape],rect[data-node-outline]," +
        "rect[data-text-shape-surface],rect[data-status-surface],rect[data-note-surface]," +
        "rect[data-frame-surface],rect[data-swimlane-body]")){
        surface.setAttribute("rx",Math.max(0,Number(values.cornerRadius)||0));
        surface.setAttribute("ry",Math.max(0,Number(values.cornerRadius)||0));
      }
    if (values.strikeThrough)
      for (const text of group.querySelectorAll("text")) text.setAttribute("text-decoration","line-through");
    const hasConditionalBadge = ["badge","icon"].some(property =>
      appearance.sources[property]?.some(source => source.source !== "base" && source.winning));
    if (hasConditionalBadge && (values.badge || values.icon)){
      const rect = nodeRect(object);
      const label = formattingText(values.badge || values.icon,"Flag",30);
      const width = Math.max(22,Math.min(120,textW(label,"700 9px Archivo, sans-serif")+14));
      const badge = el("g",{"data-formatting-badge":object.id,"pointer-events":"none"},group);
      el("rect",{x:rect.w-width-6,y:6,width,height:20,rx:10,
        fill:values.badgeColor || FORMATTING_COLOR_SAFE.information,stroke:"#FFFFFF",
        "stroke-width":1.5},badge);
      el("text",{x:rect.w-width/2-6,y:19.5,"text-anchor":"middle",fill:"#FFFFFF",
        "font-family":"Archivo, sans-serif","font-size":9,"font-weight":700},badge).textContent=label;
    }
    formattingApplySemanticZoom(group,object);
  }
  return appearance;
}
function formattingExplainObject(object){
  const appearance = formattingResolveAppearance(object);
  const failed = formattingRules().map(rule => ({rule,
    evaluation:formattingRuleEvaluation(rule,object)})).filter(item => !item.evaluation.matches);
  return {...appearance,failed};
}
function formattingContrastRatio(foreground,background){
  const rgba = value => {
    const hex = normalizeHex(value);
    if (!hex) return null;
    return [1,3,5].map(index => parseInt(hex.slice(index,index+2),16)/255);
  };
  const luminance = value => {
    const rgb = rgba(value);
    if (!rgb) return null;
    const linear = rgb.map(channel => channel <= .03928 ? channel/12.92 :
      Math.pow((channel+.055)/1.055,2.4));
    return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return a == null || b == null ? null : (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
function formattingLegendEntries(){
  const entries = [];
  for (const rule of formattingRules().filter(rule => rule.enabled && rule.legendLabel)){
    const actions = Object.fromEntries(rule.actions.map(action => [action.property,action.value]));
    entries.push({id:rule.id,label:rule.legendLabel,description:rule.accessibilityText || rule.description,
      actions,count:formattingRuleMatchCount(rule).count});
  }
  return entries;
}

/* ---------------------- Rule/lens authoring UI ------------------- */
function formattingHtml(tag,className,text){
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function formattingButton(label,action,opts = {}){
  const button = formattingHtml("button",opts.className || "",label);
  button.type = "button";
  if (opts.title) button.title = opts.title;
  if (opts.pressed != null) button.setAttribute("aria-pressed",opts.pressed ? "true" : "false");
  if (opts.disabled) button.disabled = true;
  button.addEventListener("click",action);
  return button;
}
function formattingSelect(options,value,label){
  const select = document.createElement("select");
  if (label) select.setAttribute("aria-label",label);
  for (const [id,text] of options){
    const option = document.createElement("option");
    option.value = id; option.textContent = text; option.selected = id === value;
    select.appendChild(option);
  }
  return select;
}
function formattingMutation(label,action){
  pushHistory(`formatting:${label}`);
  const result = action();
  setDocDirty(true);
  formattingInvalidateAll();
  render();
  renderFormattingPanel();
  return result;
}
function formattingRuleConflictSummary(rule){
  const propertyOwners = new Map();
  const conflicts = [];
  for (const candidate of formattingRules()){
    if (!candidate.enabled || candidate.target !== rule.target ||
        candidate.priority !== rule.priority ||
        JSON.stringify(candidate.scope) !== JSON.stringify(rule.scope)) continue;
    for (const action of candidate.actions){
      const previous = propertyOwners.get(action.property);
      if (previous && JSON.stringify(previous.value) !== JSON.stringify(action.value))
        conflicts.push({property:action.property,first:previous.rule,second:candidate});
      else if (!previous) propertyOwners.set(action.property,{rule:candidate,value:action.value});
    }
  }
  return conflicts;
}
function formattingFieldOptions(){
  const fields = [
    ["type","Primitive type"],["objectType","Semantic object type"],["relationshipType","Relationship type"],
    ["status","Status"],["title","Title / label"],["owner","Owner"],["tags","Tags"],
    ["visibility","Visibility"],["locked","Locked"],["reviewAgeDays","Days since review"],
    ["validationCount","Validation finding count"],["missingRequiredCount","Missing required metadata"],
    ["invalidMetadata","Invalid metadata"],["inboundCount","Inbound relationship count"],
    ["outboundCount","Outbound relationship count"],["relationshipCount","Relationship count"],
    ["blockedPredecessorCount","Blocked predecessor count"],
    ["canceledPredecessorCount","Canceled predecessor count"],
    ["descendantBlockedCount","Blocked descendant count"],
    ["hasSensitiveField","Contains sensitive field"],["layer","Layer"],["group","Group"],
    ["container","Container"],["pageId","Page / view"]
  ];
  if (typeof metadataPropertyDefinitions === "function")
    for (const definition of metadataPropertyDefinitions())
      fields.push([`property:${definition.id}`,`${definition.name} · ${definition.type}`]);
  return fields;
}
function formattingActionValueInput(action,onChange){
  const property = action.property;
  if (["fill","textColor","borderColor","badgeColor","lineColor","labelTextColor",
      "labelBackgroundColor"].includes(property)){
    const input = document.createElement("input");
    input.type = "color";
    input.value = normalizeHex(action.value)?.slice(0,7) || "#2456E6";
    input.setAttribute("aria-label",`${property} value`);
    input.addEventListener("change",() => onChange(input.value));
    return input;
  }
  if (property === "strikeThrough"){
    const input = document.createElement("input");
    input.type = "checkbox"; input.checked = action.value !== false;
    input.setAttribute("aria-label","Strike-through enabled");
    input.addEventListener("change",() => onChange(input.checked));
    return input;
  }
  if (property === "borderStyle" || property === "lineStyle"){
    const select = formattingSelect([["solid","Solid"],["dash","Dash"],["dot","Dot"]],
      action.value,`${property} value`);
    select.addEventListener("change",() => onChange(select.value));
    return select;
  }
  const input = document.createElement("input");
  input.type = ["borderWidth","lineWidth","opacity","fontWeight"].includes(property) ? "number" : "text";
  input.value = action.value == null ? "" : String(action.value);
  if (property === "opacity"){ input.min=".08"; input.max="1"; input.step=".05"; }
  if (property === "fontWeight"){ input.min="400"; input.max="800"; input.step="100"; }
  if (property === "borderWidth" || property === "lineWidth"){
    input.min=".5"; input.max="16"; input.step=".5";
  }
  input.setAttribute("aria-label",`${property} value`);
  input.addEventListener("change",() => onChange(input.type === "number" ? Number(input.value) : input.value));
  return input;
}
function formattingRenderConditionBuilder(container,rule){
  const condition = ["all","any"].includes(rule.condition.op)
    ? rule.condition : {op:"all",children:[rule.condition]};
  const heading = formattingHtml("div","formatting-section-head");
  heading.append(formattingHtml("h4","","Conditions"));
  const mode = formattingSelect([["all","Match all"],["any","Match any"]],condition.op,
    "Condition combination");
  mode.addEventListener("change",() => formattingMutation(`condition-mode:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{condition:{...condition,op:mode.value}})));
  heading.append(mode);
  container.append(heading);
  const rows = formattingHtml("div","formatting-builder-rows");
  condition.children.forEach((predicate,index) => {
    const normalized = predicate.op === "predicate" ? predicate : formattingNormalizePredicate(predicate);
    const row = formattingHtml("div","formatting-builder-row");
    const field = formattingSelect(formattingFieldOptions(),normalized.field,"Condition field");
    const comparator = formattingSelect(FORMATTING_COMPARATORS,normalized.comparator,"Condition operator");
    const value = document.createElement("input");
    value.type = "text";
    value.value = Array.isArray(normalized.value) ? normalized.value.join(", ") :
      normalized.value == null ? "" : String(normalized.value);
    value.placeholder = ["present","missing","blank","invalid"].includes(normalized.comparator)
      ? "No value needed" : "Value";
    value.disabled = ["present","missing","blank","invalid"].includes(normalized.comparator);
    value.setAttribute("aria-label","Condition value");
    const commit = () => {
      const children = condition.children.map((child,childIndex) => childIndex === index
        ? formattingNormalizePredicate({...normalized,field:field.value,comparator:comparator.value,
          value:value.value}) : child);
      formattingMutation(`condition:${rule.id}`,() =>
        formattingUpdateRule(rule.id,{condition:{...condition,children}}));
    };
    field.addEventListener("change",commit);
    comparator.addEventListener("change",commit);
    value.addEventListener("change",commit);
    row.append(field,comparator,value,formattingButton("×",() => {
      const children = condition.children.filter((_,childIndex) => childIndex !== index);
      formattingMutation(`condition-remove:${rule.id}`,() =>
        formattingUpdateRule(rule.id,{condition:{...condition,
          children:children.length ? children : [formattingNormalizePredicate({})]}}));
    },{title:"Remove condition"}));
    rows.append(row);
  });
  container.append(rows);
  container.append(formattingButton("+ Condition",() => {
    formattingMutation(`condition-add:${rule.id}`,() => formattingUpdateRule(rule.id,{
      condition:{...condition,children:[...condition.children,formattingNormalizePredicate({})]}
    }));
  }));
}
function formattingRenderActionBuilder(container,rule){
  const heading = formattingHtml("div","formatting-section-head");
  heading.append(formattingHtml("h4","","Formatting actions"));
  container.append(heading);
  const rows = formattingHtml("div","formatting-builder-rows");
  rule.actions.forEach((action,index) => {
    const row = formattingHtml("div","formatting-action-row");
    const property = formattingSelect(FORMATTING_ACTIONS,action.property,"Formatting property");
    property.addEventListener("change",() => {
      const actions = rule.actions.map((item,itemIndex) => itemIndex === index
        ? formattingNormalizeAction({property:property.value}) : item);
      formattingMutation(`action-property:${rule.id}`,() => formattingUpdateRule(rule.id,{actions}));
    });
    const value = formattingActionValueInput(action,nextValue => {
      const actions = rule.actions.map((item,itemIndex) => itemIndex === index
        ? formattingNormalizeAction({...item,value:nextValue}) : item);
      formattingMutation(`action-value:${rule.id}`,() => formattingUpdateRule(rule.id,{actions}));
    });
    row.append(property,value,formattingButton("×",() => {
      const actions = rule.actions.filter((_,itemIndex) => itemIndex !== index);
      formattingMutation(`action-remove:${rule.id}`,() => formattingUpdateRule(rule.id,{
        actions:actions.length ? actions : [formattingDefaultAction()]
      }));
    },{title:"Remove formatting action"}));
    rows.append(row);
  });
  container.append(rows);
  container.append(formattingButton("+ Action",() => formattingMutation(`action-add:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{actions:[...rule.actions,formattingDefaultAction()]}))));
}
function formattingRenderRuleEditor(parent,rule){
  if (!rule){
    parent.append(formattingHtml("div","formatting-empty",
      "Create a rule to derive appearance from status, metadata, graph context, or validation."));
    return;
  }
  const editor = formattingHtml("div","formatting-editor");
  const form = formattingHtml("div","formatting-rule-basics");
  const name = document.createElement("input");
  name.value = rule.name; name.setAttribute("aria-label","Rule name");
  name.addEventListener("change",() => formattingMutation(`name:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{name:name.value})));
  const enabled = document.createElement("input");
  enabled.type = "checkbox"; enabled.checked = rule.enabled; enabled.setAttribute("aria-label","Rule enabled");
  enabled.addEventListener("change",() => formattingMutation(`enabled:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{enabled:enabled.checked})));
  const target = formattingSelect(FORMATTING_TARGETS,rule.target,"Rule target");
  target.addEventListener("change",() => formattingMutation(`target:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{target:target.value})));
  const priority = document.createElement("input");
  priority.type = "number"; priority.min="-9999"; priority.max="9999"; priority.value=rule.priority;
  priority.setAttribute("aria-label","Rule priority");
  priority.addEventListener("change",() => formattingMutation(`priority:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{priority:Number(priority.value)})));
  const stop = document.createElement("input");
  stop.type = "checkbox"; stop.checked = rule.stopProcessing;
  stop.setAttribute("aria-label","Stop processing after this rule");
  stop.addEventListener("change",() => formattingMutation(`stop:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{stopProcessing:stop.checked})));
  const scopeKind = formattingSelect(FORMATTING_SCOPE_KINDS,rule.scope.kind,"Rule scope");
  const scopeId = document.createElement("input");
  scopeId.value = rule.scope.id || ""; scopeId.placeholder = "Scope ID, when needed";
  scopeId.setAttribute("aria-label","Rule scope identifier");
  const scopeCommit = () => formattingMutation(`scope:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{scope:{kind:scopeKind.value,id:scopeId.value,
      ids:scopeKind.value === "selection" ? selectionIds("node").concat(selectionIds("edge")) : undefined}}));
  scopeKind.addEventListener("change",scopeCommit); scopeId.addEventListener("change",scopeCommit);
  const description = document.createElement("textarea");
  description.value = rule.description || ""; description.placeholder = "Rationale and maintenance notes";
  description.setAttribute("aria-label","Rule description");
  description.addEventListener("change",() => formattingMutation(`description:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{description:description.value})));
  const legend = document.createElement("input");
  legend.value = rule.legendLabel || ""; legend.placeholder = "Optional legend label";
  legend.setAttribute("aria-label","Legend label");
  legend.addEventListener("change",() => formattingMutation(`legend:${rule.id}`,() =>
    formattingUpdateRule(rule.id,{legendLabel:legend.value})));
  form.append(
    formattingHtml("label","formatting-check","Enabled"),enabled,
    formattingHtml("label","","Name"),name,
    formattingHtml("label","","Target"),target,
    formattingHtml("label","","Priority"),priority,
    formattingHtml("label","","Scope"),scopeKind,
    formattingHtml("label","","Scope ID"),scopeId,
    formattingHtml("label","formatting-check","Stop processing"),stop,
    formattingHtml("label","","Legend"),legend,
    formattingHtml("label","formatting-wide","Description"),description
  );
  editor.append(form);
  formattingRenderConditionBuilder(editor,rule);
  formattingRenderActionBuilder(editor,rule);

  const diagnostics = formattingHtml("section","formatting-diagnostics");
  const match = formattingRuleMatchCount(rule);
  const conflicts = formattingRuleConflictSummary(rule);
  const expense = rule.dependencies.includes("graph") ? "Bounded graph evaluation" : "Direct property evaluation";
  diagnostics.append(formattingHtml("h4","","Preview and diagnostics"));
  diagnostics.append(formattingHtml("p","",
    `${match.count} of ${match.objects} objects match · ${match.durationMs.toFixed(1)} ms · ${expense}.`));
  if (!match.count) diagnostics.append(formattingHtml("p","warning","This rule currently matches nothing."));
  if (match.count > Math.max(1000,match.objects*.8))
    diagnostics.append(formattingHtml("p","warning","This rule is very broad; verify that this is intentional."));
  if (conflicts.length) diagnostics.append(formattingHtml("p","warning",
    `${conflicts.length} equal-priority property conflict(s) require review.`));
  const samples = formattingHtml("div","formatting-match-samples");
  for (const id of match.ids.slice(0,12)){
    const object = formattingObjectById(id);
    samples.append(formattingButton(formattingObjectLabel(object),() => {
      setSelection(formattingObjectKind(object),object.id);
      if (formattingObjectKind(object) === "node"){
        const rect=nodeRect(object);
        centerViewOn(rect.cx,rect.cy);
      }
      closeFormattingPanel();
    }));
  }
  diagnostics.append(samples);
  const buttons = formattingHtml("div","formatting-editor-actions");
  buttons.append(
    formattingButton("Preview matches",() => {
      const result = formattingPreview(rule);
      renderFormattingPanel();
      announce(`Previewing ${result.count} match${result.count===1?"":"es"} for ${rule.name}.`);
    },{className:"primary"}),
    formattingButton("Cancel preview",() => { formattingCancelPreview(); renderFormattingPanel(); },
      {disabled:!formattingPreviewRule}),
    formattingButton("Duplicate",() => formattingMutation(`duplicate:${rule.id}`,() =>
      formattingDuplicateRule(rule.id))),
    formattingButton("Move up",() => formattingMutation(`up:${rule.id}`,() =>
      formattingReorderRule(rule.id,-1))),
    formattingButton("Move down",() => formattingMutation(`down:${rule.id}`,() =>
      formattingReorderRule(rule.id,1))),
    formattingButton("Delete",() => {
      if (!confirm(`Delete formatting rule “${rule.name}”? Underlying styles will reappear.`)) return;
      formattingMutation(`delete:${rule.id}`,() => formattingDeleteRule(rule.id));
    },{className:"dangerbtn"})
  );
  diagnostics.append(buttons);
  editor.append(diagnostics);

  const advanced = document.createElement("details");
  advanced.className = "formatting-advanced";
  advanced.append(formattingHtml("summary","","Advanced structured expression"));
  const expression = document.createElement("textarea");
  expression.value = JSON.stringify(rule.condition,null,2);
  expression.setAttribute("aria-label","Structured condition JSON");
  const error = formattingHtml("p","formatting-error","");
  expression.addEventListener("change",() => {
    try {
      const parsed = JSON.parse(expression.value);
      const normalized = formattingNormalizeCondition(parsed);
      formattingMutation(`expression:${rule.id}`,() =>
        formattingUpdateRule(rule.id,{condition:normalized}));
      error.textContent = "";
    } catch(parseError){ error.textContent = parseError.message || String(parseError); }
  });
  advanced.append(expression,error);
  editor.append(advanced);
  parent.append(editor);
}
function formattingRenderRulesMode(body){
  const layout = formattingHtml("div","formatting-manager-layout");
  const list = formattingHtml("aside","formatting-list");
  const rules = ensureConditionalFormatting().rules;
  if (!formattingSelectedRuleId && rules.length) formattingSelectedRuleId = rules[0].id;
  for (const rule of rules){
    const button = formattingButton(rule.name,() => {
      formattingSelectedRuleId = rule.id; renderFormattingPanel();
    },{pressed:rule.id === formattingSelectedRuleId});
    button.className = "formatting-list-item";
    button.dataset.ruleId = rule.id;
    button.append(formattingHtml("small","",
      `${rule.enabled ? "On" : "Off"} · priority ${rule.priority} · ${formattingRuleMatchCount(rule).count} matches`));
    list.append(button);
  }
  if (!rules.length) list.append(formattingHtml("p","formatting-empty","No formatting rules yet."));
  const editor = formattingHtml("main","formatting-editor-pane");
  formattingRenderRuleEditor(editor,formattingRuleById(formattingSelectedRuleId));
  layout.append(list,editor); body.append(layout);
}
function formattingRenderLensEditor(parent,lens){
  if (!lens){
    parent.append(formattingHtml("div","formatting-empty",
      "Saved lenses apply reversible context, nonmatch treatment, rule sets, and semantic detail."));
    return;
  }
  const editor = formattingHtml("div","formatting-editor");
  const grid = formattingHtml("div","formatting-rule-basics");
  const name = document.createElement("input");
  name.value=lens.name; name.setAttribute("aria-label","Lens name");
  const description=document.createElement("textarea");
  description.value=lens.description || ""; description.setAttribute("aria-label","Lens description");
  const treatment=formattingSelect([["hide","Hide nonmatches"],["ghost","Ghost nonmatches"],
    ["dim","Dim nonmatches"],["unchanged","Leave nonmatches unchanged"]],lens.nonmatchTreatment,
    "Lens nonmatch treatment");
  const direction=formattingSelect([["both","Both directions"],["in","Upstream"],["out","Downstream"]],
    lens.contextDirection,"Lens context direction");
  const hops=document.createElement("input");
  hops.type="number"; hops.min="0"; hops.max="4"; hops.value=lens.contextHops;
  hops.setAttribute("aria-label","Relationship context hops");
  const zoom=formattingSelect([["","Automatic"],...FORMATTING_ZOOM_TIERS.map(tier=>[tier.id,tier.label])],
    lens.zoomTier,"Lens semantic zoom tier");
  const commit = patch => formattingMutation(`lens:${lens.id}`,() => formattingUpdateLens(lens.id,patch));
  name.addEventListener("change",()=>commit({name:name.value}));
  description.addEventListener("change",()=>commit({description:description.value}));
  treatment.addEventListener("change",()=>commit({nonmatchTreatment:treatment.value}));
  direction.addEventListener("change",()=>commit({contextDirection:direction.value}));
  hops.addEventListener("change",()=>commit({contextHops:Number(hops.value)}));
  zoom.addEventListener("change",()=>commit({zoomTier:zoom.value}));
  grid.append(formattingHtml("label","","Name"),name,
    formattingHtml("label","","Nonmatches"),treatment,
    formattingHtml("label","","Context direction"),direction,
    formattingHtml("label","","Context hops"),hops,
    formattingHtml("label","","Detail tier"),zoom,
    formattingHtml("label","formatting-wide","Description"),description);
  editor.append(grid);
  const ruleBox=formattingHtml("section","formatting-lens-rules");
  ruleBox.append(formattingHtml("h4","","Active formatting rules"));
  for (const rule of formattingRules()){
    const label=formattingHtml("label","formatting-check");
    const input=document.createElement("input");
    input.type="checkbox"; input.checked=lens.ruleIds.includes(rule.id);
    input.addEventListener("change",()=>{
      const next=new Set(lens.ruleIds);
      if (input.checked) next.add(rule.id); else next.delete(rule.id);
      commit({ruleIds:[...next]});
    });
    label.append(input,document.createTextNode(rule.name)); ruleBox.append(label);
  }
  editor.append(ruleBox);
  const result=formattingLensMatches(lens);
  editor.append(formattingHtml("p","formatting-diagnostic",
    `${result.size} canvas objects remain in context with ${lens.contextHops} relationship hop(s).`));
  const actions=formattingHtml("div","formatting-editor-actions");
  actions.append(
    formattingButton(formattingActiveLensId===lens.id?"Lens active":"Apply lens",
      ()=>formattingApplyLens(lens.id),{className:"primary",pressed:formattingActiveLensId===lens.id}),
    formattingButton("Clear lens",()=>formattingApplyLens(""),{disabled:!formattingActiveLensId}),
    formattingButton("Delete",()=>{
      if (!confirm(`Delete lens “${lens.name}”?`)) return;
      formattingMutation(`lens-delete:${lens.id}`,()=>formattingDeleteLens(lens.id));
    },{className:"dangerbtn"})
  );
  editor.append(actions);
  parent.append(editor);
}
function formattingRenderLensesMode(body){
  const layout=formattingHtml("div","formatting-manager-layout");
  const list=formattingHtml("aside","formatting-list");
  const lenses=formattingLenses();
  if (!formattingSelectedLensId && lenses.length) formattingSelectedLensId=lenses[0].id;
  for (const lens of lenses){
    const button=formattingButton(lens.name,()=>{
      formattingSelectedLensId=lens.id; renderFormattingPanel();
    },{pressed:lens.id===formattingSelectedLensId});
    button.className="formatting-list-item";
    button.append(formattingHtml("small","",
      `${formattingActiveLensId===lens.id?"Active":"Saved"} · ${formattingLensMatches(lens).size} objects`));
    list.append(button);
  }
  if (!lenses.length) list.append(formattingHtml("p","formatting-empty","No saved lenses yet."));
  const editor=formattingHtml("main","formatting-editor-pane");
  formattingRenderLensEditor(editor,formattingLensById(formattingSelectedLensId));
  layout.append(list,editor); body.append(layout);
}
function formattingRenderLegendMode(body){
  const wrapper=formattingHtml("div","formatting-legend-manager");
  wrapper.append(formattingHtml("h4","","Generated legend"));
  wrapper.append(formattingHtml("p","helper",
    "Legend entries come from enabled rules with a legend label. The active lens and exports use the same definitions."));
  const entries=formattingLegendEntries();
  for (const entry of entries){
    const row=formattingHtml("div","formatting-legend-row");
    const swatch=formattingHtml("span","formatting-legend-swatch");
    swatch.style.background=entry.actions.fill || entry.actions.lineColor ||
      entry.actions.borderColor || entry.actions.badgeColor || "#E4E7EC";
    const text=formattingHtml("span","");
    text.append(formattingHtml("strong","",entry.label),
      formattingHtml("small","",`${entry.count} matches · ${entry.description || "Rule-derived appearance"}`));
    row.append(swatch,text); wrapper.append(row);
  }
  if (!entries.length) wrapper.append(formattingHtml("p","formatting-empty",
    "Add a legend label to a rule to explain its meaning here and in active-lens exports."));
  const zoomSection=formattingHtml("section","formatting-zoom-controls");
  zoomSection.append(formattingHtml("h4","","Semantic zoom"));
  const enabled=document.createElement("input");
  enabled.type="checkbox"; enabled.checked=ensureConditionalFormatting().semanticZoom.enabled;
  enabled.addEventListener("change",()=>formattingMutation("semantic-zoom",()=>{
    state.formatting.semanticZoom.enabled=enabled.checked;
  }));
  const pin=formattingSelect([["","Automatic"],...FORMATTING_ZOOM_TIERS.map(tier=>[tier.id,tier.label])],
    formattingZoomPinned,"Preview detail tier");
  pin.addEventListener("change",()=>formattingSetZoomTier(pin.value));
  const label=formattingHtml("label","formatting-check");
  label.append(enabled,document.createTextNode("Use zoom-dependent detail"));
  zoomSection.append(label,pin,formattingHtml("p","helper",
    "Overview keeps identity and high-priority badges; Summary retains status and key labels; Detail and Inspection progressively reveal fields, ports, notes, and controls."));
  wrapper.append(zoomSection);
  body.append(wrapper);
}
function renderFormattingPanel(){
  const panel=document.getElementById("formattingPanel");
  const body=document.getElementById("formattingPanelBody");
  if (!panel || !body || !formattingPanelOpen) return;
  body.innerHTML="";
  for (const tab of panel.querySelectorAll("[data-formatting-mode]")){
    const selected=tab.dataset.formattingMode===formattingPanelMode;
    tab.setAttribute("aria-selected",selected?"true":"false");
    tab.tabIndex=selected?0:-1;
  }
  const title=document.getElementById("formattingPanelTitle");
  if (title) title.textContent=formattingPanelMode==="rules"?"Conditional formatting":
    formattingPanelMode==="lenses"?"Saved lenses":"Legend and semantic zoom";
  const create=document.getElementById("btnFormattingCreate");
  if (create){
    create.hidden=formattingPanelMode==="legend";
    create.textContent=formattingPanelMode==="lenses"?"New lens":"New rule";
  }
  const active=document.getElementById("formattingActiveLens");
  if (active){
    active.innerHTML="";
    active.append(new Option("No active lens",""));
    for (const lens of formattingLenses()) active.append(new Option(lens.name,lens.id));
    active.value=formattingActiveLensId;
  }
  if (formattingPanelMode==="rules") formattingRenderRulesMode(body);
  else if (formattingPanelMode==="lenses") formattingRenderLensesMode(body);
  else formattingRenderLegendMode(body);
  const status=document.getElementById("formattingPanelStatus");
  if (status){
    const enabled=formattingRules().filter(rule=>rule.enabled);
    const conflicts=enabled.reduce((sum,rule)=>sum+formattingRuleConflictSummary(rule).length,0);
    status.textContent=`${enabled.length} active rule${enabled.length===1?"":"s"} · `+
      `${formattingLenses().length} saved lens${formattingLenses().length===1?"":"es"} · `+
      `${conflicts} conflict${conflicts===1?"":"s"} · ${formattingStats.evaluations} evaluations`;
  }
}
function openFormattingPanel(mode="rules",opts={}){
  ensureConditionalFormatting();
  formattingPanelMode=["rules","lenses","legend"].includes(mode)?mode:"rules";
  if (opts.ruleId) formattingSelectedRuleId=opts.ruleId;
  if (opts.lensId) formattingSelectedLensId=opts.lensId;
  if (!formattingPanelOpen && document.activeElement instanceof HTMLElement)
    formattingPanelReturnFocus=document.activeElement;
  formattingPanelOpen=true;
  const panel=document.getElementById("formattingPanel");
  if (!panel) return false;
  panel.hidden=false; panel.classList.add("open");
  renderFormattingPanel();
  requestAnimationFrame(()=>panel.querySelector("[data-formatting-mode][aria-selected=true]")?.focus());
  return true;
}
function closeFormattingPanel(){
  if (!formattingPanelOpen) return false;
  formattingPanelOpen=false;
  formattingCancelPreview();
  const panel=document.getElementById("formattingPanel");
  if (panel){ panel.classList.remove("open"); panel.hidden=true; }
  formattingPanelReturnFocus?.focus?.();
  formattingPanelReturnFocus=null;
  return true;
}
function initializeFormattingUi(){
  const panel=document.getElementById("formattingPanel");
  if (!panel) return;
  document.getElementById("btnCloseFormattingPanel")?.addEventListener("click",closeFormattingPanel);
  for (const tab of panel.querySelectorAll("[data-formatting-mode]"))
    tab.addEventListener("click",()=>openFormattingPanel(tab.dataset.formattingMode));
  document.getElementById("btnFormattingCreate")?.addEventListener("click",()=>{
    if (formattingPanelMode==="lenses")
      formattingMutation("lens-create",()=>formattingCreateLens());
    else formattingMutation("rule-create",()=>formattingCreateRule());
  });
  document.getElementById("formattingActiveLens")?.addEventListener("change",event=>
    formattingApplyLens(event.target.value));
  panel.addEventListener("click",event=>{ if (event.target===panel) closeFormattingPanel(); });
  panel.addEventListener("keydown",event=>{
    if (event.key==="Escape"){ event.preventDefault(); closeFormattingPanel(); }
  });
}

/* ---------------- Inspector, canvas, commands, and context -------- */
function renderFormattingInspectorForObject(object){
  if (!object || typeof inspectorSection!=="function") return;
  const explanation=formattingExplainObject(object);
  inspectorSection(`formatting:${formattingObjectKind(object)}`,"Why this appearance?",()=>{
    const summary=formattingHtml("p","helper",
      explanation.matches.length
        ? `${explanation.matches.length} conditional rule${explanation.matches.length===1?"":"s"} match this object.`
        : "No conditional formatting rule currently matches this object.");
    appendInspector(summary);
    const propertyList=formattingHtml("div","formatting-inspector-properties");
    for (const [property,chain] of Object.entries(explanation.sources)){
      const winner=chain.find(item=>item.winning) || chain.at(-1);
      if (!winner) continue;
      const row=formattingHtml("div","formatting-inspector-property");
      const value=typeof winner.value==="object" ? JSON.stringify(winner.value) : String(winner.value);
      row.append(formattingHtml("strong","",property),
        formattingHtml("span","",value),
        formattingHtml("small","",winner.source==="rule"?`Rule: ${winner.label}`:winner.label));
      if (winner.source==="manual"){
        row.append(formattingButton("Clear override",()=>{
          formattingMutation(`override-clear:${object.id}:${property}`,()=>
            formattingClearManualOverride(object,property));
        }));
      }
      propertyList.append(row);
    }
    appendInspector(propertyList);
    for (const match of explanation.matches){
      const button=formattingButton(`${match.ruleName} · priority ${match.priority}`,()=>
        openFormattingPanel("rules",{ruleId:match.ruleId}));
      button.className="formatting-inspector-rule";
      button.title=match.explanations.map(item=>
        `${item.field} ${item.comparator}: ${item.result===true?"matched":item.result===false?"failed":"unknown"}`).join("\n");
      appendInspector(button);
    }
    if (explanation.conflicts.length)
      appendInspector(formattingHtml("p","warning",
        `${explanation.conflicts.length} equal-priority conflict${explanation.conflicts.length===1?"":"s"} detected.`));
    const manage=formattingButton("Manage formatting rules",()=>openFormattingPanel("rules"));
    manage.className="full"; appendInspector(manage);
  },{open:explanation.matches.length>0});
}
function formattingDrawCanvasLegend(){
  const lens=formattingLensById(formattingActiveLensId);
  const entries=formattingLegendEntries().filter(entry=>!lens || !lens.ruleIds.length ||
    lens.ruleIds.includes(entry.id));
  if (!lens || !entries.length || typeof guideLayer==="undefined" || !guideLayer) return;
  const bounds=documentBounds();
  const width=210,rowH=28,height=38+entries.length*rowH;
  const group=el("g",{"data-formatting-legend":"1",
    transform:`translate(${bounds.x+bounds.w-width},${bounds.y+bounds.h-height})`,
    role:"group","aria-label":`${lens.legendTitle}. ${entries.map(entry=>entry.label).join(", ")}`},guideLayer);
  el("rect",{width,height,rx:9,fill:themeColors().panel,stroke:themeColors().ink2,
    "stroke-width":1.2},group);
  el("text",{x:12,y:22,fill:themeColors().ink,"font-family":"Archivo, sans-serif",
    "font-size":12,"font-weight":700},group).textContent=lens.legendTitle;
  entries.forEach((entry,index)=>{
    const y=34+index*rowH;
    const color=entry.actions.fill||entry.actions.lineColor||entry.actions.borderColor||
      entry.actions.badgeColor||themeColors().muted;
    el("rect",{x:12,y:y+5,width:18,height:18,rx:4,fill:color,stroke:themeColors().ink2,
      "stroke-width":.8},group);
    el("text",{x:38,y:y+18,fill:themeColors().ink,"font-family":"Archivo, sans-serif",
      "font-size":10.5,"font-weight":600},group).textContent=
      truncate(entry.label,150,"600 10.5px Archivo, sans-serif");
  });
}
function initializeFormattingCommands(){
  if (typeof registerCommand!=="function") return;
  const owner="conditional-formatting";
  registerCommand({
    id:"formattingRules",label:"Formatting rules",
    description:"Create explainable visual rules from metadata, status, validation, and graph context",
    action:()=>openFormattingPanel("rules"),owner,scope:"application",mutatesDocument:false,
    ribbon:{tab:"model",group:"Formatting",priority:"high"}
  });
  registerCommand({
    id:"formattingLenses",label:"Saved lenses",
    description:"Apply reversible audience-specific context and formatting",
    action:()=>openFormattingPanel("lenses"),owner,scope:"application",mutatesDocument:false,
    ribbon:{tab:"view",group:"Lenses",priority:"normal"}
  });
  registerCommand({
    id:"formattingLegend",label:"Legend & detail",
    description:"Inspect rule legends and semantic-zoom policy",
    action:()=>openFormattingPanel("legend"),owner,scope:"application",mutatesDocument:false,
    ribbon:{tab:"view",group:"Lenses",priority:"normal"}
  });
}
function buildFormattingNodeContext(parent,node,targets){
  ctxGroup(parent,"node:formatting","Formatting",panel=>{
    ctxItem(panel,"Why this appearance?",()=>{
      if (!isSelected("node",node.id)) setSelection("node",node.id);
      renderInspector();
    });
    ctxItem(panel,"Create rule from selection",()=>{
      const ids=targets.map(target=>target.id);
      const rule=formattingMutation("rule-from-selection",()=>formattingCreateRule({
        name:`Format ${targets.length} selected object${targets.length===1?"":"s"}`,
        target:"node",scope:{kind:"selection",ids},
        condition:{op:"all",children:[]},actions:[formattingDefaultAction()]
      }));
      openFormattingPanel("rules",{ruleId:rule.id});
    });
    ctxItem(panel,"Manage rules",()=>openFormattingPanel("rules"));
  });
}
function buildFormattingEdgeContext(parent,edge){
  ctxGroup(parent,"edge:formatting","Formatting",panel=>{
    ctxItem(panel,"Why this appearance?",()=>{
      if (!isSelected("edge",edge.id)) setSelection("edge",edge.id);
      renderInspector();
    });
    ctxItem(panel,"Create rule for this relationship",()=>{
      const rule=formattingMutation("edge-rule",()=>formattingCreateRule({
        name:`Format ${edge.label||edge.kind||"relationship"}`,
        target:"edge",scope:{kind:"selection",ids:[edge.id]},
        condition:{op:"all",children:[]},
        actions:[{property:"lineColor",value:FORMATTING_COLOR_SAFE.information}]
      }));
      openFormattingPanel("rules",{ruleId:rule.id});
    });
    ctxItem(panel,"Manage rules",()=>openFormattingPanel("rules"));
  });
}
function buildFormattingCanvasContext(parent){
  ctxGroup(parent,"canvas:formatting","Formatting & lenses",panel=>{
    ctxItem(panel,"Conditional formatting rules",()=>openFormattingPanel("rules"));
    ctxItem(panel,"Saved lenses",()=>openFormattingPanel("lenses"));
    ctxItem(panel,"Legend & semantic zoom",()=>openFormattingPanel("legend"));
    if (formattingActiveLensId) ctxItem(panel,"Clear active lens",()=>formattingApplyLens(""));
  });
}
