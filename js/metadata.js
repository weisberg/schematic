"use strict";

/* =====================================================================
   CUSTOM METADATA — typed property/type registry, validation, formulas,
   inspector contributions, and the live bulk object table.
   ===================================================================== */

const METADATA_PROPERTY_TYPES = [
  ["text","Text"], ["number","Number"], ["boolean","Boolean"], ["date","Date"],
  ["url","URL"], ["person","Person or owner"], ["status","Status"],
  ["enum","Enumeration"], ["multiSelect","Multi-select"], ["reference","Object reference"],
  ["formula","Formula / computed"]
];
const METADATA_PROPERTY_TYPE_SET = new Set(METADATA_PROPERTY_TYPES.map(([id]) => id));
const METADATA_SCOPES = [
  ["canonical","Canonical"], ["view","View-local"], ["configurable","Configurable global/view"],
  ["derived","Derived"],
  ["external","Externally controlled"]
];
const METADATA_SCOPE_SET = new Set(METADATA_SCOPES.map(([id]) => id));
const METADATA_OBJECT_KINDS = new Set(["node","edge"]);
const METADATA_FORMULA_MAX_DEPTH = 40;
const METADATA_FORMULA_MAX_VISITS = 1000;
const METADATA_FORMULA_FUNCTIONS = new Map([
  ["prop",[1,1]], ["countIn",[0,0]], ["countOut",[0,0]], ["countChildren",[0,0]],
  ["sumChildren",[1,1]], ["maxDependencies",[1,1]], ["coalesce",[1,20]], ["if",[3,3]],
  ["dateDaysBetween",[2,2]], ["dateAddDays",[2,2]]
]);
let metadataNormalizedState = null;
let metadataFormulaCache = new Map();
let metadataFormulaGeneration = 0;
let metadataPanelOpen = false;
let metadataPanelMode = "table";
let metadataPanelSort = {key:"name", direction:"asc"};
let metadataPanelFilter = "";
let metadataPanelKind = "all";
let metadataPanelSemanticType = "";
let metadataPanelSelectionOnly = false;
let metadataPanelPage = 0;
const METADATA_TABLE_PAGE_SIZE = 120;
let metadataPanelPropertyIds = [];
let metadataCsvPreview = null;
let metadataPanelReturnFocus = null;

function metadataUid(prefix = "m"){ return prefix + (state.nextId++); }
function metadataCloneValue(value){
  return value == null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}
function metadataText(value, fallback = "", max = 120){
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, max);
}
function defaultMetadata(){
  return {properties:[], objectTypes:[], relationshipTypes:[]};
}
function metadataNormalizeOption(raw, index){
  const source = raw && typeof raw === "object" ? raw : {label:raw};
  const label = metadataText(source.label || source.name || source.id, `Option ${index + 1}`, 80);
  const id = metadataText(source.id, "", 80) || `option-${index + 1}`;
  return {...source, id, label};
}
function metadataNormalizeDefinition(raw, kind, index, ids){
  if (!raw || typeof raw !== "object") return null;
  const prefix = kind === "property" ? "p" : kind === "objectType" ? "ot" : "rt";
  let id = metadataText(raw.id, "", 100);
  if (!id || ids.has(id)) id = `${prefix}-legacy-${index + 1}`;
  ids.add(id);
  const name = metadataText(raw.name || raw.label, kind === "property" ? "Property" :
    kind === "objectType" ? "Object type" : "Relationship type", 120);
  const out = {...raw, id, name};
  if (kind === "property"){
    out.type = METADATA_PROPERTY_TYPE_SET.has(raw.type) ? raw.type : "text";
    out.scope = METADATA_SCOPE_SET.has(raw.scope)
      ? raw.scope : out.type === "formula" ? "derived" : "canonical";
    if (out.type === "formula") out.scope = "derived";
    const applies = Array.isArray(raw.appliesTo)
      ? [...new Set(raw.appliesTo.filter(value => METADATA_OBJECT_KINDS.has(value)))] : ["node","edge"];
    out.appliesTo = applies.length ? applies : ["node","edge"];
    if (raw.required !== true) delete out.required;
    if (raw.multiple !== true) delete out.multiple;
    if (raw.searchable === false) out.searchable = false; else delete out.searchable;
    if (raw.sensitive === true) out.sensitive = true; else delete out.sensitive;
    if (raw.unique === true) out.unique = true; else delete out.unique;
    if (raw.deprecated === true) out.deprecated = true; else delete out.deprecated;
    if (raw.readOnly === true || out.scope === "derived" || out.scope === "external") out.readOnly = true;
    else delete out.readOnly;
    const options = Array.isArray(raw.options) ? raw.options.map(metadataNormalizeOption) : [];
    if (["enum","multiSelect","status"].includes(out.type) && options.length) out.options = options;
    else delete out.options;
    if (out.type === "formula"){
      out.formula = typeof raw.formula === "string" ? raw.formula.trim().slice(0, 1000) : "";
    } else delete out.formula;
    const order = Number(raw.order);
    if (Number.isFinite(order)) out.order = order; else out.order = index;
    for (const key of ["min","max","precision"]){
      const value = Number(raw[key]);
      if (Number.isFinite(value)) out[key] = value; else delete out[key];
    }
  } else {
    for (const key of ["propertyIds","requiredPropertyIds","allowedSourceTypeIds","allowedTargetTypeIds"]){
      if (Array.isArray(raw[key])) out[key] = [...new Set(raw[key].map(String).filter(Boolean))];
      else delete out[key];
    }
    if (raw.deprecated === true) out.deprecated = true; else delete out.deprecated;
  }
  return out;
}
function normalizeMetadata(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const propertyIds = new Set(), objectTypeIds = new Set(), relationshipTypeIds = new Set();
  const properties = (Array.isArray(source.properties) ? source.properties : [])
    .map((definition, index) => metadataNormalizeDefinition(definition, "property", index, propertyIds))
    .filter(Boolean);
  const objectTypes = (Array.isArray(source.objectTypes) ? source.objectTypes : [])
    .map((definition, index) => metadataNormalizeDefinition(definition, "objectType", index, objectTypeIds))
    .filter(Boolean);
  const relationshipTypes = (Array.isArray(source.relationshipTypes) ? source.relationshipTypes : [])
    .map((definition, index) => metadataNormalizeDefinition(definition, "relationshipType", index, relationshipTypeIds))
    .filter(Boolean);
  for (const type of [...objectTypes, ...relationshipTypes]){
    if (Array.isArray(type.propertyIds))
      type.propertyIds = type.propertyIds.filter(id => propertyIds.has(id));
    if (Array.isArray(type.requiredPropertyIds))
      type.requiredPropertyIds = type.requiredPropertyIds.filter(id => propertyIds.has(id));
  }
  for (const type of relationshipTypes){
    if (Array.isArray(type.allowedSourceTypeIds))
      type.allowedSourceTypeIds = type.allowedSourceTypeIds.filter(id => objectTypeIds.has(id));
    if (Array.isArray(type.allowedTargetTypeIds))
      type.allowedTargetTypeIds = type.allowedTargetTypeIds.filter(id => objectTypeIds.has(id));
  }
  return {...source, properties, objectTypes, relationshipTypes};
}
function ensureMetadata(){
  if (state.metadata && state.metadata === metadataNormalizedState) return state.metadata;
  state.metadata = normalizeMetadata(state.metadata);
  metadataNormalizedState = state.metadata;
  const propertyIds = new Set(state.metadata.properties.map(definition => definition.id));
  const objectTypeIds = new Set(state.metadata.objectTypes.map(definition => definition.id));
  const relationshipTypeIds = new Set(state.metadata.relationshipTypes.map(definition => definition.id));
  for (const object of [...state.nodes, ...state.edges]){
    if (!object || typeof object !== "object") continue;
    if (object.semanticTypeId){
      const valid = state.nodes.includes(object)
        ? objectTypeIds.has(object.semanticTypeId) : relationshipTypeIds.has(object.semanticTypeId);
      if (!valid) object.invalidSemanticTypeId = object.semanticTypeId;
    }
    if (!object.properties || typeof object.properties !== "object" || Array.isArray(object.properties)){
      if (object.properties != null) object.invalidProperties = object.properties;
      delete object.properties;
    } else {
      for (const key of Object.keys(object.properties)){
        if (!propertyIds.has(key)) continue;
        const value = metadataNormalizeValue(metadataPropertyById(key), object.properties[key], {preserveInvalid:true});
        if (value.absent) delete object.properties[key];
        else object.properties[key] = value.value;
      }
      if (!Object.keys(object.properties).length) delete object.properties;
    }
  }
  invalidateMetadataEvaluation();
  return state.metadata;
}
function metadataPropertyDefinitions(){
  return ensureMetadata().properties.slice().sort((a, b) => (a.order || 0) - (b.order || 0) ||
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function metadataObjectTypes(){ return ensureMetadata().objectTypes; }
function metadataRelationshipTypes(){ return ensureMetadata().relationshipTypes; }
function metadataPropertyById(id){ return ensureMetadata().properties.find(item => item.id === id) || null; }
function metadataObjectTypeById(id){ return ensureMetadata().objectTypes.find(item => item.id === id) || null; }
function metadataRelationshipTypeById(id){
  return ensureMetadata().relationshipTypes.find(item => item.id === id) || null;
}
function metadataObjectKind(object){
  return state.edges.includes(object) || (object && ("from" in object || "fromSemanticId" in object))
    ? "edge" : "node";
}
function metadataObjectById(id){
  return nodeById(id) || edgeById(id) ||
    (state.semanticObjects || []).find(object => object.id === id) ||
    (state.semanticRelationships || []).find(object => object.id === id) || null;
}
function metadataObjectName(object){
  if (!object) return "Object";
  if (metadataObjectKind(object) === "node") return object.title || object.id;
  if ("fromSemanticId" in object){
    const from=(state.semanticObjects||[]).find(item=>item.id===object.fromSemanticId);
    const to=(state.semanticObjects||[]).find(item=>item.id===object.toSemanticId);
    return object.label || `${from?.title || object.fromSemanticId} → ${to?.title || object.toSemanticId}`;
  }
  const from = nodeById(object.from), to = nodeById(object.to);
  return object.label || `${from?.title || object.from} → ${to?.title || object.to}`;
}
function metadataTypeForObject(object){
  return metadataObjectKind(object) === "node"
    ? metadataObjectTypeById(object && object.semanticTypeId)
    : metadataRelationshipTypeById(object && object.semanticTypeId);
}
function metadataDefinitionApplies(definition, object){
  if (!definition || !object) return false;
  const kind = metadataObjectKind(object);
  if (!definition.appliesTo.includes(kind)) return false;
  const type = metadataTypeForObject(object);
  if (!type || !Array.isArray(type.propertyIds) || !type.propertyIds.length) return true;
  return type.propertyIds.includes(definition.id) || (type.requiredPropertyIds || []).includes(definition.id);
}
function metadataDefinitionsForObject(object){
  return metadataPropertyDefinitions().filter(definition => metadataDefinitionApplies(definition, object));
}
function metadataOption(definition, value){
  const key = String(value == null ? "" : value);
  return (definition && Array.isArray(definition.options)
    ? definition.options.find(option => option.id === key || option.label.toLowerCase() === key.toLowerCase())
    : null) || null;
}
function metadataDateValid(value){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function metadataUrlValid(value){
  try {
    const url = new URL(String(value));
    return ["http:","https:","mailto:"].includes(url.protocol);
  } catch { return false; }
}
function metadataNormalizeValue(definition, raw, opts = {}){
  if (!definition) return {value:raw, errors:["Unknown property definition"]};
  if (definition.type === "formula") return {absent:true, value:undefined, errors:[]};
  if (raw == null || raw === "") return {absent:true, value:undefined, errors:[]};
  const errors = [];
  let value = raw;
  if (definition.type === "text" || definition.type === "url" || definition.type === "date"){
    value = String(raw);
    if (definition.type === "url" && !metadataUrlValid(value)) errors.push("Enter a valid HTTP, HTTPS, or mailto URL.");
    if (definition.type === "date" && !metadataDateValid(value)) errors.push("Enter a valid date in YYYY-MM-DD format.");
  } else if (definition.type === "number"){
    value = Number(raw);
    if (!Number.isFinite(value)) errors.push("Enter a finite number.");
    else {
      if (Number.isFinite(definition.min) && value < definition.min) errors.push(`Minimum is ${definition.min}.`);
      if (Number.isFinite(definition.max) && value > definition.max) errors.push(`Maximum is ${definition.max}.`);
      if (Number.isInteger(definition.precision) && definition.precision >= 0)
        value = Number(value.toFixed(Math.min(12, definition.precision)));
    }
  } else if (definition.type === "boolean"){
    if (raw === true || raw === false) value = raw;
    else if (String(raw).toLowerCase() === "true") value = true;
    else if (String(raw).toLowerCase() === "false") value = false;
    else errors.push("Choose true or false.");
  } else if (definition.type === "person"){
    if (raw && typeof raw === "object" && !Array.isArray(raw)){
      const label = metadataText(raw.label || raw.name, "", 120);
      if (!label) errors.push("Person label is required.");
      value = {...raw, id:metadataText(raw.id, label.toLowerCase().replace(/\W+/g, "-"), 120), label};
    } else {
      const label = metadataText(raw, "", 120);
      if (!label) errors.push("Person label is required.");
      value = label;
    }
  } else if (definition.type === "enum" || definition.type === "status"){
    const option = metadataOption(definition, raw);
    if (option) value = option.id;
    else if (definition.type === "status" && statusOptions().some(label => label.toLowerCase() === String(raw).toLowerCase()))
      value = statusOptions().find(label => label.toLowerCase() === String(raw).toLowerCase());
    else errors.push("Choose one of the allowed values.");
  } else if (definition.type === "multiSelect"){
    const values = Array.isArray(raw) ? raw : String(raw).split(",").map(value => value.trim()).filter(Boolean);
    value = [...new Set(values.map(item => metadataOption(definition, item)?.id || String(item)))].sort();
    const invalid = value.filter(item => !metadataOption(definition, item));
    if (invalid.length) errors.push(`Unknown option${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}.`);
  } else if (definition.type === "reference"){
    value = String(raw);
    if (!metadataObjectById(value)) errors.push("Referenced object does not exist.");
  }
  if (errors.length && !opts.preserveInvalid) return {value:raw, errors};
  return {value, errors};
}
function metadataRawValue(object, definitionOrId){
  const id = typeof definitionOrId === "string" ? definitionOrId : definitionOrId && definitionOrId.id;
  return object && object.properties && Object.hasOwn(object.properties, id) ? object.properties[id] : undefined;
}
function metadataValueProvenance(object, definitionOrId){
  const id = typeof definitionOrId === "string" ? definitionOrId : definitionOrId && definitionOrId.id;
  const definition = metadataPropertyById(id);
  if (definition?.type === "formula") return {origin:"computed"};
  if (!object?.properties || !Object.hasOwn(object.properties, id)) return {origin:"not set"};
  return object?.propertyProvenance?.[id] || {origin:"manual"};
}
function metadataSetProvenance(object, id, origin){
  if (!object) return;
  if (!object.properties || !Object.hasOwn(object.properties, id)){
    if (object.propertyProvenance) delete object.propertyProvenance[id];
    if (object.propertyProvenance && !Object.keys(object.propertyProvenance).length)
      delete object.propertyProvenance;
    return;
  }
  object.propertyProvenance = {
    ...(object.propertyProvenance || {}),
    [id]:{origin:["manual","imported","computed","external","default","migrated"].includes(origin)
      ? origin : "manual"}
  };
}
function metadataDisplayValue(definition, value){
  if (value == null || value === "") return "";
  if (definition.type === "enum" || definition.type === "status")
    return metadataOption(definition, value)?.label || String(value);
  if (definition.type === "multiSelect")
    return (Array.isArray(value) ? value : []).map(item => metadataOption(definition, item)?.label || item).join(", ");
  if (definition.type === "person" && value && typeof value === "object") return value.label || value.name || value.id || "";
  if (definition.type === "boolean") return value ? "True" : "False";
  if (definition.type === "reference") return metadataObjectName(metadataObjectById(value)) || String(value);
  return String(value);
}
function metadataSetValue(object, definitionOrId, raw, opts = {}){
  const definition = typeof definitionOrId === "string"
    ? metadataPropertyById(definitionOrId) : definitionOrId;
  if (!object || !definition || !metadataDefinitionApplies(definition, object) ||
      definition.readOnly || definition.type === "formula") return {ok:false, errors:["Property is read-only or incompatible."]};
  if (typeof organizationCanMutateObject === "function" && !organizationCanMutateObject(object))
    return {ok:false, errors:["Object is locked."]};
  const normalized = metadataNormalizeValue(definition, raw);
  if (normalized.errors.length) return {ok:false, errors:normalized.errors, value:normalized.value};
  if (opts.history !== false) pushHistory(opts.coalesceKey);
  if (!object.properties || typeof object.properties !== "object") object.properties = {};
  if (normalized.absent) delete object.properties[definition.id];
  else object.properties[definition.id] = normalized.value;
  if (!Object.keys(object.properties).length) delete object.properties;
  if (typeof styleMarkComponentOverride === "function")
    styleMarkComponentOverride(object,"properties",true);
  metadataSetProvenance(object, definition.id, opts.origin || "manual");
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  if (opts.render !== false) render();
  return {ok:true, value:normalized.value};
}
function metadataSetValueMany(objects, definition, raw){
  const compatible = objects.filter(object => metadataDefinitionApplies(definition, object) &&
    !definition.readOnly && (typeof organizationCanMutateObject !== "function" ||
      organizationCanMutateObject(object)));
  const normalized = metadataNormalizeValue(definition, raw);
  if (normalized.errors.length) return {ok:false, errors:normalized.errors, changed:0, skipped:objects.length};
  if (!compatible.length) return {ok:false, errors:["No compatible unlocked objects."], changed:0, skipped:objects.length};
  pushHistory();
  for (const object of compatible){
    if (!object.properties || typeof object.properties !== "object") object.properties = {};
    if (normalized.absent) delete object.properties[definition.id];
    else object.properties[definition.id] = metadataCloneValue(normalized.value);
    if (!Object.keys(object.properties).length) delete object.properties;
    metadataSetProvenance(object, definition.id, "manual");
    if (typeof styleMarkComponentOverride === "function")
      styleMarkComponentOverride(object,"properties",true);
  }
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return {ok:true, changed:compatible.length, skipped:objects.length - compatible.length};
}
function invalidateMetadataEvaluation(){
  metadataFormulaGeneration++;
  metadataFormulaCache.clear();
}

/* ----------------------- Formula parsing -------------------------- */
function metadataFormulaTokens(source){
  const tokens = [];
  let index = 0;
  while (index < source.length){
    const rest = source.slice(index);
    const space = rest.match(/^\s+/);
    if (space){ index += space[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (number){ tokens.push({type:"number", value:Number(number[0]), at:index}); index += number[0].length; continue; }
    if (rest[0] === '"' || rest[0] === "'"){
      const quote = rest[0];
      let value = "", cursor = 1, closed = false;
      while (cursor < rest.length){
        const char = rest[cursor++];
        if (char === quote){ closed = true; break; }
        if (char === "\\"){
          const escaped = rest[cursor++];
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped || "";
        } else value += char;
      }
      if (!closed) throw new Error(`Unterminated string at ${index + 1}.`);
      tokens.push({type:"string", value, at:index});
      index += cursor;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier){
      const value = identifier[0];
      tokens.push({type:["true","false","null"].includes(value) ? "literal" : "identifier",
        value:value === "true" ? true : value === "false" ? false : value === "null" ? null : value, at:index});
      index += identifier[0].length;
      continue;
    }
    const operator = ["&&","||","==","!=",">=","<=","+","-","*","/","%",">","<","!","(",")",","]
      .find(candidate => rest.startsWith(candidate));
    if (!operator) throw new Error(`Unexpected token at ${index + 1}.`);
    tokens.push({type:["(",")",","].includes(operator) ? operator : "operator", value:operator, at:index});
    index += operator.length;
  }
  tokens.push({type:"eof", value:"", at:index});
  return tokens;
}
function metadataParseFormula(source){
  const tokens = metadataFormulaTokens(String(source || ""));
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = type => {
    const token = tokens[cursor];
    if (type && token.type !== type) throw new Error(`Expected ${type} at ${token.at + 1}.`);
    cursor++;
    return token;
  };
  const precedence = {"||":1,"&&":2,"==":3,"!=":3,">":4,"<":4,">=":4,"<=":4,
    "+":5,"-":5,"*":6,"/":6,"%":6};
  const primary = () => {
    const token = peek();
    if (token.type === "number" || token.type === "string" || token.type === "literal"){
      take(); return {type:"literal", value:token.value};
    }
    if (token.type === "identifier"){
      take();
      if (peek().type !== "(") throw new Error(`Unknown name "${token.value}". Use a documented function.`);
      take("(");
      const args = [];
      if (peek().type !== ")"){
        while (true){
          args.push(expression(0));
          if (peek().type !== ",") break;
          take(",");
        }
      }
      take(")");
      return {type:"call", name:token.value, args};
    }
    if (token.type === "("){
      take("("); const value = expression(0); take(")"); return value;
    }
    if (token.type === "operator" && ["!","-","+"].includes(token.value)){
      take(); return {type:"unary", op:token.value, value:primary()};
    }
    throw new Error(`Expected a value at ${token.at + 1}.`);
  };
  const expression = min => {
    let left = primary();
    while (peek().type === "operator" && (precedence[peek().value] || 0) >= min){
      const op = take("operator").value;
      const right = expression(precedence[op] + 1);
      left = {type:"binary", op, left, right};
    }
    return left;
  };
  const ast = expression(0);
  if (peek().type !== "eof") throw new Error(`Unexpected token at ${peek().at + 1}.`);
  return ast;
}
function metadataFormulaDependencies(ast, out = new Set()){
  if (!ast) return out;
  if (ast.type === "call" && ["prop","sumChildren","maxDependencies"].includes(ast.name) &&
      ast.args[0]?.type === "literal" && typeof ast.args[0].value === "string") out.add(ast.args[0].value);
  if (ast.type === "call") for (const arg of ast.args) metadataFormulaDependencies(arg, out);
  if (ast.type === "binary"){
    metadataFormulaDependencies(ast.left, out); metadataFormulaDependencies(ast.right, out);
  }
  if (ast.type === "unary") metadataFormulaDependencies(ast.value, out);
  return out;
}
function metadataValidateFormulaAst(ast){
  if (!ast) return true;
  if (ast.type === "call"){
    const range = METADATA_FORMULA_FUNCTIONS.get(ast.name);
    if (!range) throw new Error(`Unknown function "${ast.name}".`);
    if (ast.args.length < range[0] || ast.args.length > range[1])
      throw new Error(`${ast.name} expects ${range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`} argument${range[1] === 1 ? "" : "s"}.`);
    for (const arg of ast.args) metadataValidateFormulaAst(arg);
  }
  if (ast.type === "binary"){
    metadataValidateFormulaAst(ast.left); metadataValidateFormulaAst(ast.right);
  }
  if (ast.type === "unary") metadataValidateFormulaAst(ast.value);
  return true;
}
function metadataFormulaChildren(object){
  if (metadataObjectKind(object) !== "node") return [];
  if (isStructuralNode(object)) return containerContainedNodes(object);
  return [];
}
function metadataEvaluateAst(ast, context, depth = 0){
  if (depth > METADATA_FORMULA_MAX_DEPTH) throw new Error("Formula exceeds maximum depth.");
  if (ast.type === "literal") return ast.value;
  if (ast.type === "unary"){
    const value = metadataEvaluateAst(ast.value, context, depth + 1);
    if (ast.op === "!") return !value;
    if (ast.op === "-") return -Number(value || 0);
    return Number(value || 0);
  }
  if (ast.type === "binary"){
    const left = metadataEvaluateAst(ast.left, context, depth + 1);
    if (ast.op === "&&") return left && metadataEvaluateAst(ast.right, context, depth + 1);
    if (ast.op === "||") return left || metadataEvaluateAst(ast.right, context, depth + 1);
    const right = metadataEvaluateAst(ast.right, context, depth + 1);
    if (ast.op === "+") return typeof left === "string" || typeof right === "string"
      ? String(left ?? "") + String(right ?? "") : Number(left || 0) + Number(right || 0);
    if (ast.op === "-") return Number(left || 0) - Number(right || 0);
    if (ast.op === "*") return Number(left || 0) * Number(right || 0);
    if (ast.op === "/") return Number(right) === 0 ? null : Number(left || 0) / Number(right);
    if (ast.op === "%") return Number(right) === 0 ? null : Number(left || 0) % Number(right);
    if (ast.op === "==") return left === right;
    if (ast.op === "!=") return left !== right;
    if (ast.op === ">") return left > right;
    if (ast.op === "<") return left < right;
    if (ast.op === ">=") return left >= right;
    if (ast.op === "<=") return left <= right;
  }
  if (ast.type === "call"){
    const args = ast.args.map(arg => metadataEvaluateAst(arg, context, depth + 1));
    context.visits += 1;
    if (context.visits > METADATA_FORMULA_MAX_VISITS) throw new Error("Formula traverses too many objects.");
    if (ast.name === "prop") return metadataValue(context.object, String(args[0] || ""), context.stack, context);
    if (ast.name === "countIn") return state.edges.filter(edge => edge.to === context.object.id).length;
    if (ast.name === "countOut") return state.edges.filter(edge => edge.from === context.object.id).length;
    if (ast.name === "countChildren") return metadataFormulaChildren(context.object).length;
    if (ast.name === "sumChildren") return metadataFormulaChildren(context.object)
      .reduce((sum, child) => sum + Number(metadataValue(child, String(args[0] || ""), context.stack, context) || 0), 0);
    if (ast.name === "maxDependencies"){
      const values = state.edges.filter(edge => edge.from === context.object.id)
        .map(edge => nodeById(edge.to)).filter(Boolean)
        .map(node => metadataValue(node, String(args[0] || ""), context.stack, context))
        .map(Number).filter(Number.isFinite);
      return values.length ? Math.max(...values) : null;
    }
    if (ast.name === "coalesce") return args.find(value => value != null && value !== "") ?? null;
    if (ast.name === "if") return args[0] ? args[1] : args[2];
    if (ast.name === "dateDaysBetween"){
      if (!metadataDateValid(args[0]) || !metadataDateValid(args[1])) return null;
      return Math.round((Date.parse(`${args[1]}T00:00:00Z`) -
        Date.parse(`${args[0]}T00:00:00Z`)) / 86400000);
    }
    if (ast.name === "dateAddDays"){
      if (!metadataDateValid(args[0]) || !Number.isFinite(Number(args[1]))) return null;
      const date = new Date(`${args[0]}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + Number(args[1]));
      return date.toISOString().slice(0, 10);
    }
    throw new Error(`Unknown function "${ast.name}".`);
  }
  return null;
}
function metadataValue(object, definitionOrId, stack = [], sharedContext = null){
  const definition = typeof definitionOrId === "string"
    ? metadataPropertyById(definitionOrId) : definitionOrId;
  if (!object || !definition) return undefined;
  if (definition.type !== "formula") return metadataRawValue(object, definition.id);
  const key = `${object.id}:${definition.id}`;
  if (metadataFormulaCache.has(key)) return metadataFormulaCache.get(key).value;
  if (stack.includes(key)){
    const cycle = [...stack.slice(stack.indexOf(key)), key];
    const message = `Formula cycle: ${cycle.join(" → ")}`;
    const result = {value:undefined, error:message};
    metadataFormulaCache.set(key, result);
    throw new Error(message);
  }
  try {
    const ast = metadataParseFormula(definition.formula || "");
    metadataValidateFormulaAst(ast);
    const context = sharedContext || {object, stack:[...stack, key], visits:0};
    const ownContext = {...context, object, stack:[...stack, key]};
    const value = metadataEvaluateAst(ast, ownContext);
    metadataFormulaCache.set(key, {value, dependencies:[...metadataFormulaDependencies(ast)]});
    return value;
  } catch(error){
    metadataFormulaCache.set(key, {value:undefined, error:error.message || String(error)});
    if (sharedContext) throw error;
    return undefined;
  }
}
function metadataFormulaResult(object, definition){
  const value = metadataValue(object, definition);
  const cached = metadataFormulaCache.get(`${object.id}:${definition.id}`) || {};
  return {value, error:cached.error || "", dependencies:cached.dependencies || []};
}
function metadataFormulaExplanation(object, definition){
  const result = metadataFormulaResult(object, definition);
  return {
    formula:definition?.formula || "",
    result:result.value,
    error:result.error,
    inputs:result.dependencies.map(id => {
      const dependency = metadataPropertyById(id);
      const value = dependency ? metadataValue(object, dependency) : undefined;
      return {id,name:dependency?.name || id,value,
        display:dependency ? metadataDisplayValue(dependency, value) : ""};
    })
  };
}

/* --------------------- Definitions and types ---------------------- */
function metadataCreateProperty(input = {}){
  ensureMetadata();
  const definition = metadataNormalizeDefinition({
    id:metadataUid("p"), name:input.name || "New property", type:input.type || "text",
    scope:input.scope, appliesTo:input.appliesTo || ["node","edge"],
    options:input.options, formula:input.formula, required:input.required,
    description:input.description, defaultValue:input.defaultValue, group:input.group,
    searchable:input.searchable, sensitive:input.sensitive, unique:input.unique, aliases:input.aliases,
    sourceAuthority:input.sourceAuthority, syncDirection:input.syncDirection,
    min:input.min, max:input.max, precision:input.precision, unit:input.unit,
    order:state.metadata.properties.length
  }, "property", state.metadata.properties.length, new Set(state.metadata.properties.map(item => item.id)));
  pushHistory();
  state.metadata.properties.push(definition);
  const typeIds = new Set(Array.isArray(input.typeIds) ? input.typeIds : []);
  for (const typeDefinition of [...state.metadata.objectTypes, ...state.metadata.relationshipTypes]){
    if (!typeIds.has(typeDefinition.id)) continue;
    typeDefinition.propertyIds = [...new Set([...(typeDefinition.propertyIds || []), definition.id])];
  }
  metadataNormalizedState = state.metadata;
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return definition;
}
function metadataCreateType(kind, input = {}){
  ensureMetadata();
  const collection = kind === "edge" ? state.metadata.relationshipTypes : state.metadata.objectTypes;
  const normalizedKind = kind === "edge" ? "relationshipType" : "objectType";
  const definition = metadataNormalizeDefinition({
    id:metadataUid(kind === "edge" ? "rt" : "ot"),
    name:input.name || (kind === "edge" ? "Relationship type" : "Object type"),
    propertyIds:input.propertyIds || [], requiredPropertyIds:input.requiredPropertyIds || [],
    allowedSourceTypeIds:input.allowedSourceTypeIds || [],
    allowedTargetTypeIds:input.allowedTargetTypeIds || [],
    defaultShape:input.defaultShape, defaultIcon:input.defaultIcon,
    styleClass:input.styleClass, description:input.description,
    documentationUrl:input.documentationUrl, labelTemplate:input.labelTemplate
  }, normalizedKind, collection.length, new Set(collection.map(item => item.id)));
  pushHistory();
  collection.push(definition);
  metadataNormalizedState = state.metadata;
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return definition;
}
function metadataUpdateDefinition(kind, id, patch){
  ensureMetadata();
  const collection = kind === "property" ? state.metadata.properties
    : kind === "objectType" ? state.metadata.objectTypes : state.metadata.relationshipTypes;
  const index = collection.findIndex(item => item.id === id);
  if (index < 0) return null;
  const ids = new Set(collection.filter(item => item.id !== id).map(item => item.id));
  const normalized = metadataNormalizeDefinition({...collection[index], ...patch, id},
    kind, index, ids);
  pushHistory();
  collection[index] = normalized;
  metadataNormalizedState = state.metadata;
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return normalized;
}
function metadataDefinitionImpact(kind, id){
  if (kind === "property"){
    const objects = [...state.nodes, ...state.edges].filter(object =>
      object.properties && Object.hasOwn(object.properties, id));
    const types = [...metadataObjectTypes(), ...metadataRelationshipTypes()].filter(type =>
      (type.propertyIds || []).includes(id) || (type.requiredPropertyIds || []).includes(id));
    const formulas = metadataPropertyDefinitions().filter(definition =>
      definition.type === "formula" && metadataFormulaDependenciesSafe(definition.formula).has(id));
    return {objects, types, formulas, total:objects.length + types.length + formulas.length};
  }
  const objects = (kind === "objectType" ? state.nodes : state.edges)
    .filter(object => object.semanticTypeId === id);
  return {objects, types:[], formulas:[], total:objects.length};
}
function metadataPropertyTypeConversionPreview(id, nextType){
  const definition = metadataPropertyById(id);
  if (!definition || !METADATA_PROPERTY_TYPE_SET.has(nextType))
    return {converted:0, ambiguous:0, invalid:0, blank:0, unchanged:0, rows:[]};
  const candidate = metadataNormalizeDefinition({...definition, type:nextType}, "property",
    definition.order || 0, new Set(metadataPropertyDefinitions().filter(item => item.id !== id).map(item => item.id)));
  const preview = {converted:0, ambiguous:0, invalid:0, blank:0, unchanged:0, rows:[]};
  for (const object of [...state.nodes, ...state.edges]){
    const raw = metadataRawValue(object, id);
    if (raw == null || raw === ""){
      preview.blank++;
      continue;
    }
    const normalized = metadataNormalizeValue(candidate, raw);
    let status = "converted";
    if (normalized.errors.length) status = "invalid";
    else if (JSON.stringify(normalized.value) === JSON.stringify(raw)) status = "unchanged";
    else if ((definition.type === "text" && nextType !== "text") ||
             (definition.type !== "text" && nextType === "text")) status = "ambiguous";
    preview[status]++;
    preview.rows.push({
      objectId:object.id, name:metadataObjectName(object), status,
      before:raw, after:normalized.errors.length ? raw : normalized.value,
      errors:normalized.errors
    });
  }
  return preview;
}
function metadataReorderProperty(id, direction){
  ensureMetadata();
  const ordered = metadataPropertyDefinitions();
  const from = ordered.findIndex(definition => definition.id === id);
  const to = Math.max(0, Math.min(ordered.length - 1, from + direction));
  if (from < 0 || from === to) return false;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  pushHistory();
  ordered.forEach((definition, index) => { definition.order = index; });
  state.metadata.properties = ordered;
  metadataNormalizedState = state.metadata;
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return true;
}
function metadataTypeAssignmentPreview(object, typeId){
  const nextType = metadataObjectKind(object) === "node"
    ? metadataObjectTypeById(typeId) : metadataRelationshipTypeById(typeId);
  const currentValues = object && object.properties && typeof object.properties === "object"
    ? Object.keys(object.properties) : [];
  const compatible = new Set([
    ...(nextType?.propertyIds || []), ...(nextType?.requiredPropertyIds || [])
  ]);
  const incompatibleProperties = nextType && compatible.size
    ? currentValues.filter(id => !compatible.has(id)).map(id => metadataPropertyById(id)?.name || id)
    : [];
  const missingRequired = (nextType?.requiredPropertyIds || []).filter(id => {
    const value = metadataRawValue(object, id);
    return value == null || value === "";
  }).map(id => metadataPropertyById(id)?.name || id);
  const relationshipFindings = metadataObjectKind(object) === "edge" && nextType
    ? metadataValidateRelationship({...object, semanticTypeId:nextType.id})
      .filter(finding => finding.code === "source-type" || finding.code === "target-type")
    : [];
  return {
    objectId:object?.id, typeId:typeId || "", typeName:nextType?.name || "No semantic type",
    missingRequired, incompatibleProperties, relationshipFindings,
    preservesValues:true,
    hasWarnings:!!(missingRequired.length || incompatibleProperties.length || relationshipFindings.length)
  };
}
function metadataFormulaDependenciesSafe(formula){
  try { return metadataFormulaDependencies(metadataParseFormula(formula || "")); }
  catch { return new Set(); }
}
function metadataDeleteDefinition(kind, id, opts = {}){
  ensureMetadata();
  const collection = kind === "property" ? state.metadata.properties
    : kind === "objectType" ? state.metadata.objectTypes : state.metadata.relationshipTypes;
  const definition = collection.find(item => item.id === id);
  if (!definition) return {ok:false, reason:"Definition not found."};
  const impact = metadataDefinitionImpact(kind, id);
  if (impact.total && opts.force !== true){
    if (definition.deprecated === true) return {ok:false, impact, reason:"Definition is in use."};
    pushHistory();
    definition.deprecated = true;
    if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
    render();
    return {ok:true, deprecated:true, impact};
  }
  pushHistory();
  if (kind === "property"){
    for (const object of [...state.nodes, ...state.edges]){
      if (!object.properties || !Object.hasOwn(object.properties, id)) continue;
      object.orphanProperties = {...(object.orphanProperties || {}), [id]:object.properties[id]};
      if (object.propertyProvenance?.[id]){
        object.orphanPropertyProvenance = {
          ...(object.orphanPropertyProvenance || {}), [id]:object.propertyProvenance[id]
        };
        delete object.propertyProvenance[id];
        if (!Object.keys(object.propertyProvenance).length) delete object.propertyProvenance;
      }
      delete object.properties[id];
      if (!Object.keys(object.properties).length) delete object.properties;
    }
    for (const type of [...metadataObjectTypes(), ...metadataRelationshipTypes()]){
      if (Array.isArray(type.propertyIds)) type.propertyIds = type.propertyIds.filter(value => value !== id);
      if (Array.isArray(type.requiredPropertyIds))
        type.requiredPropertyIds = type.requiredPropertyIds.filter(value => value !== id);
    }
  } else {
    for (const object of kind === "objectType" ? state.nodes : state.edges)
      if (object.semanticTypeId === id){
        object.invalidSemanticTypeId = id;
        delete object.semanticTypeId;
      }
  }
  collection.splice(collection.indexOf(definition), 1);
  metadataNormalizedState = state.metadata;
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return {ok:true, deleted:true, impact};
}
function metadataAssignType(object, typeId, opts = {}){
  if (!object) return false;
  const definition = metadataObjectKind(object) === "node"
    ? metadataObjectTypeById(typeId) : metadataRelationshipTypeById(typeId);
  if (typeId && !definition) return false;
  if (typeof organizationCanMutateObject === "function" && !organizationCanMutateObject(object)) return false;
  if (opts.history !== false) pushHistory();
  if (definition) object.semanticTypeId = definition.id; else delete object.semanticTypeId;
  if (typeof styleMarkComponentOverride === "function")
    styleMarkComponentOverride(object,"semanticTypeId",true);
  delete object.invalidSemanticTypeId;
  if (definition && opts.applyDefaults !== false){
    for (const propertyId of definition.propertyIds || []){
      const property = metadataPropertyById(propertyId);
      if (!property || property.type === "formula" || property.defaultValue === undefined ||
          metadataRawValue(object, propertyId) != null) continue;
      const normalized = metadataNormalizeValue(property, property.defaultValue);
      if (!normalized.errors.length && !normalized.absent){
        object.properties = {...(object.properties || {}), [propertyId]:metadataCloneValue(normalized.value)};
        metadataSetProvenance(object, propertyId, "default");
        if (typeof styleMarkComponentOverride === "function")
          styleMarkComponentOverride(object,"properties",true);
      }
    }
  }
  if (definition && opts.applyDefaults !== false && metadataObjectKind(object) === "node"){
    if (definition.defaultShape && object.type === "concept" && !object.shape)
      setConceptShape(object, definition.defaultShape);
    if (definition.defaultIcon && typeof setNodeIcon === "function" && !object.icon)
      setNodeIcon(object, definition.defaultIcon);
  }
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  if (opts.render !== false) render();
  return true;
}

/* -------------------------- Validation ---------------------------- */
function metadataRequiredForObject(definition, object){
  if (definition.required) return true;
  const type = metadataTypeForObject(object);
  return !!type && (type.requiredPropertyIds || []).includes(definition.id);
}
function metadataValidateObject(object){
  const findings = [];
  for (const definition of metadataDefinitionsForObject(object)){
    const value = metadataRawValue(object, definition.id);
    if (metadataRequiredForObject(definition, object) &&
        definition.type !== "formula" && (value == null || value === ""))
      findings.push({severity:"error", code:"required", objectId:object.id,
        propertyId:definition.id, message:`${definition.name} is required.`});
    if (value != null && definition.type !== "formula"){
      const normalized = metadataNormalizeValue(definition, value, {preserveInvalid:true});
      for (const message of normalized.errors)
        findings.push({severity:"error", code:"value", objectId:object.id,
          propertyId:definition.id, message:`${definition.name}: ${message}`});
    }
    if (definition.type === "formula"){
      const result = metadataFormulaResult(object, definition);
      if (result.error) findings.push({severity:"error", code:"formula", objectId:object.id,
        propertyId:definition.id, message:`${definition.name}: ${result.error}`});
    }
  }
  if (object.invalidSemanticTypeId)
    findings.push({severity:"warning", code:"type", objectId:object.id,
      message:`Unknown semantic type ${object.invalidSemanticTypeId}.`});
  return findings;
}
function metadataValidateRelationship(edge){
  const findings = metadataValidateObject(edge);
  const type = metadataRelationshipTypeById(edge.semanticTypeId);
  if (!type) return findings;
  const source = nodeById(edge.from), target = nodeById(edge.to);
  if ((type.allowedSourceTypeIds || []).length &&
      (!source || !type.allowedSourceTypeIds.includes(source.semanticTypeId)))
    findings.push({severity:"warning", code:"source-type", objectId:edge.id,
      message:`${type.name} does not allow this source object type.`});
  if ((type.allowedTargetTypeIds || []).length &&
      (!target || !type.allowedTargetTypeIds.includes(target.semanticTypeId)))
    findings.push({severity:"warning", code:"target-type", objectId:edge.id,
      message:`${type.name} does not allow this target object type.`});
  return findings;
}
function metadataValidationFindings(scope = "document"){
  const objects = scope === "selection" && sel
    ? (sel.kind === "node" ? selectedNodes() : selectionIds("edge").map(edgeById).filter(Boolean))
    : [...state.nodes, ...state.edges];
  const findings = [];
  for (const object of objects)
    findings.push(...(metadataObjectKind(object) === "edge"
      ? metadataValidateRelationship(object) : metadataValidateObject(object)));
  for (const definition of metadataPropertyDefinitions()){
    if (definition.unique){
      const seen = new Map();
      for (const object of objects){
        if (!metadataDefinitionApplies(definition, object)) continue;
        const value = metadataRawValue(object, definition.id);
        if (value == null || value === "") continue;
        const key = JSON.stringify(value);
        if (seen.has(key)){
          findings.push({severity:"error", code:"unique", objectId:object.id,
            propertyId:definition.id,
            message:`${definition.name} duplicates ${metadataObjectName(seen.get(key))}.`});
        } else seen.set(key, object);
      }
    }
    if (definition.type !== "formula") continue;
    try {
      const ast = metadataParseFormula(definition.formula || "");
      metadataValidateFormulaAst(ast);
      for (const dependencyId of metadataFormulaDependencies(ast))
        if (!metadataPropertyById(dependencyId))
          findings.push({severity:"error", code:"formula-definition", propertyId:definition.id,
            message:`${definition.name}: unknown property ${dependencyId}.`});
    }
    catch(error){
      findings.push({severity:"error", code:"formula-definition", propertyId:definition.id,
        message:`${definition.name}: ${error.message}`});
    }
  }
  return findings;
}

/* -------------------- Serialization and legacy -------------------- */
function metadataOrderedValues(object){
  const source = object && object.properties && typeof object.properties === "object"
    ? object.properties : null;
  if (!source) return null;
  const ordered = {};
  const known = metadataPropertyDefinitions().map(definition => definition.id);
  for (const id of known) if (Object.hasOwn(source, id)) ordered[id] = metadataCloneValue(source[id]);
  for (const id of Object.keys(source).filter(id => !known.includes(id)).sort())
    ordered[id] = metadataCloneValue(source[id]);
  return Object.keys(ordered).length ? ordered : null;
}
function metadataOrderedProvenance(object){
  const source = object && object.propertyProvenance && typeof object.propertyProvenance === "object"
    ? object.propertyProvenance : null;
  if (!source) return null;
  const ordered = {};
  const known = metadataPropertyDefinitions().map(definition => definition.id);
  for (const id of known)
    if (Object.hasOwn(source, id)) ordered[id] = metadataCloneValue(source[id]);
  for (const id of Object.keys(source).filter(id => !known.includes(id)).sort())
    ordered[id] = metadataCloneValue(source[id]);
  return Object.keys(ordered).length ? ordered : null;
}
function cleanMetadataObjectForDocument(object){
  const out = {...object};
  const properties = metadataOrderedValues(object);
  if (properties) out.properties = properties; else delete out.properties;
  const provenance = metadataOrderedProvenance(object);
  if (provenance) out.propertyProvenance = provenance; else delete out.propertyProvenance;
  return out;
}
function cleanMetadataForDocument(raw = state.metadata){
  const normalized = normalizeMetadata(raw);
  const out = {
    ...normalized,
    properties:normalized.properties.map(definition => ({...definition,
      ...(Array.isArray(definition.options) ? {options:definition.options.map(option => ({...option}))} : {})})),
    objectTypes:normalized.objectTypes.map(definition => ({...definition})),
    relationshipTypes:normalized.relationshipTypes.map(definition => ({...definition}))
  };
  const knownKeys = new Set(["properties","objectTypes","relationshipTypes"]);
  const hasUnknown = Object.keys(out).some(key => !knownKeys.has(key));
  return out.properties.length || out.objectTypes.length || out.relationshipTypes.length || hasUnknown ? out : null;
}
function metadataLegacyDefinitions(){
  ensureMetadata();
  const existingNames = new Set(state.metadata.properties.map(definition => definition.name.toLowerCase()));
  const candidates = new Map();
  for (const object of [...state.nodes, ...state.edges]){
    if (!object.customProperties || typeof object.customProperties !== "object" || Array.isArray(object.customProperties))
      continue;
    for (const [key, value] of Object.entries(object.customProperties)){
      if (value == null || typeof value === "object") continue;
      const name = metadataText(key.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()), key, 120);
      if (!existingNames.has(name.toLowerCase()) && !candidates.has(key)) candidates.set(key, {key, name});
    }
  }
  return [...candidates.values()];
}
function metadataAdoptLegacyProperties(){
  const candidates = metadataLegacyDefinitions();
  if (!candidates.length) return {created:0, values:0};
  pushHistory();
  let created = 0, values = 0;
  for (const candidate of candidates){
    const id = `legacy-${candidate.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || metadataUid("p")}`;
    if (metadataPropertyById(id)) continue;
    const definition = metadataNormalizeDefinition({
      id, name:candidate.name, type:"text", scope:"canonical", appliesTo:["node","edge"],
      description:`Adopted from legacy customProperties.${candidate.key}`
    }, "property", state.metadata.properties.length,
    new Set(state.metadata.properties.map(item => item.id)));
    state.metadata.properties.push(definition);
    created++;
    for (const object of [...state.nodes, ...state.edges]){
      const value = object.customProperties && object.customProperties[candidate.key];
      if (value == null || typeof value === "object") continue;
      object.properties = {...(object.properties || {}), [definition.id]:value};
      metadataSetProvenance(object, definition.id, "migrated");
      values++;
    }
  }
  metadataNormalizedState = state.metadata;
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  return {created, values};
}

/* ----------------------- Inspector UI ----------------------------- */
function metadataScopeLabel(definition){
  return METADATA_SCOPES.find(([id]) => id === definition.scope)?.[1] || "Canonical";
}
function metadataTypeSelect(object, targets = [object]){
  const select = document.createElement("select");
  select.setAttribute("aria-label", metadataObjectKind(object) === "node"
    ? "Semantic object type" : "Semantic relationship type");
  const none = document.createElement("option");
  none.value = ""; none.textContent = "No semantic type";
  select.appendChild(none);
  const types = metadataObjectKind(object) === "node" ? metadataObjectTypes() : metadataRelationshipTypes();
  for (const type of types){
    const option = document.createElement("option");
    option.value = type.id;
    option.textContent = type.name + (type.deprecated ? " (deprecated)" : "");
    option.selected = targets.every(target => target.semanticTypeId === type.id);
    select.appendChild(option);
  }
  if (!targets.every(target => target.semanticTypeId === object.semanticTypeId)) select.value = "";
  select.addEventListener("change", () => {
    const compatible = targets.filter(target => typeof organizationCanMutateObject !== "function" ||
      organizationCanMutateObject(target));
    if (!compatible.length) return announce("Unlock the selected objects before changing type.");
    const previews = compatible.map(target => metadataTypeAssignmentPreview(target, select.value));
    const warnings = previews.filter(preview => preview.hasWarnings);
    if (warnings.length){
      const missing = warnings.reduce((total, preview) => total + preview.missingRequired.length, 0);
      const incompatible = warnings.reduce((total, preview) => total + preview.incompatibleProperties.length, 0);
      const connections = warnings.reduce((total, preview) => total + preview.relationshipFindings.length, 0);
      const message = [
        `Changing type affects ${warnings.length} selected object${warnings.length === 1 ? "" : "s"}.`,
        missing ? `${missing} required value${missing === 1 ? " is" : "s are"} missing.` : "",
        incompatible ? `${incompatible} existing value${incompatible === 1 ? " is" : "s are"} outside the new type schema but will be preserved.` : "",
        connections ? `${connections} relationship rule warning${connections === 1 ? "" : "s"} will be created.` : "",
        "Continue in warning mode?"
      ].filter(Boolean).join("\n");
      if (typeof confirm === "function" && !confirm(message)){
        select.value = object.semanticTypeId || "";
        return;
      }
    }
    pushHistory();
    for (const target of compatible) metadataAssignType(target, select.value, {history:false, render:false});
    render();
  });
  return select;
}
function metadataValueEditor(object, definition, targets = [object]){
  if (definition.type === "formula"){
    const result = metadataFormulaResult(object, definition);
    const explanation = metadataFormulaExplanation(object, definition);
    const box = document.createElement("div");
    box.className = "metadata-derived";
    box.textContent = result.error ? result.error : metadataDisplayValue(definition, result.value) || "—";
    box.title = [
      `Formula: ${explanation.formula || "(blank)"}`,
      ...explanation.inputs.map(input => `${input.name}: ${input.display || "blank"}`)
    ].join("\n");
    if (result.error) box.classList.add("invalid");
    box.setAttribute("role", result.error ? "alert" : "status");
    return box;
  }
  const values = targets.map(target => metadataRawValue(target, definition.id));
  const first = values[0];
  const mixed = values.some(value => JSON.stringify(value) !== JSON.stringify(first));
  let control;
  if (definition.type === "boolean"){
    control = document.createElement("select");
    for (const [value, label] of [["","Not set"],["true","True"],["false","False"]]){
      const option = document.createElement("option");
      option.value = value; option.textContent = label; control.appendChild(option);
    }
    control.value = mixed ? "" : first === true ? "true" : first === false ? "false" : "";
  } else if (["enum","status"].includes(definition.type)){
    control = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = mixed ? "Mixed values" : "Not set"; control.appendChild(blank);
    const options = definition.options?.length
      ? definition.options : definition.type === "status"
        ? statusOptions().map(label => ({id:label,label})) : [];
    for (const item of options){
      const option = document.createElement("option");
      option.value = item.id; option.textContent = item.label; control.appendChild(option);
    }
    control.value = mixed ? "" : String(first ?? "");
  } else if (definition.type === "multiSelect"){
    control = document.createElement("input");
    control.type = "text";
    control.value = mixed ? "" : metadataDisplayValue(definition, first);
    control.placeholder = mixed ? "Mixed values — enter comma-separated options" : "Comma-separated options";
  } else if (definition.type === "reference"){
    control = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = mixed ? "Mixed values" : "Not set"; control.appendChild(blank);
    for (const target of [...state.nodes, ...state.edges]){
      if (target.id === object.id) continue;
      const option = document.createElement("option");
      option.value = target.id; option.textContent = metadataObjectName(target); control.appendChild(option);
    }
    control.value = mixed ? "" : String(first ?? "");
  } else {
    control = document.createElement("input");
    control.type = definition.type === "number" ? "number" :
      definition.type === "date" ? "date" : definition.type === "url" ? "url" : "text";
    if (definition.type === "number"){
      if (Number.isFinite(definition.min)) control.min = String(definition.min);
      if (Number.isFinite(definition.max)) control.max = String(definition.max);
      control.step = Number.isInteger(definition.precision)
        ? String(10 ** -Math.max(0, definition.precision)) : "any";
    }
    control.value = mixed ? "" : metadataDisplayValue(definition, first);
    if (mixed) control.placeholder = "Mixed values";
  }
  control.setAttribute("aria-label", definition.name);
  if (definition.readOnly || definition.scope === "external") control.disabled = true;
  control.addEventListener("change", () => {
    let value = control.value;
    if (definition.type === "boolean") value = value === "" ? "" : value === "true";
    if (definition.type === "multiSelect") value = value.split(",").map(item => item.trim()).filter(Boolean);
    const result = targets.length > 1
      ? metadataSetValueMany(targets, definition, value)
      : metadataSetValue(object, definition, value);
    if (!result.ok){
      control.setAttribute("aria-invalid", "true");
      control.title = result.errors.join(" ");
      announce(result.errors.join(" "));
    }
  });
  return control;
}
function metadataInspectorProperty(object, definition, targets = [object]){
  const wrapper = document.createElement("div");
  wrapper.className = "metadata-inspector-property";
  const label = document.createElement("div");
  label.className = "metadata-property-label";
  const name = document.createElement("span");
  name.textContent = definition.name + (metadataRequiredForObject(definition, object) ? " *" : "");
  const scope = document.createElement("small");
  const provenance = metadataValueProvenance(object, definition);
  scope.textContent = `${metadataScopeLabel(definition)} · ${provenance.origin}`;
  scope.title = `${metadataScopeLabel(definition)} property · ${provenance.origin} value${definition.sensitive ? " · sensitive" : ""}`;
  label.append(name, scope);
  wrapper.append(label, metadataValueEditor(object, definition, targets));
  const value = metadataRawValue(object, definition.id);
  if (value != null && definition.type !== "formula"){
    const check = metadataNormalizeValue(definition, value, {preserveInvalid:true});
    if (check.errors.length){
      const error = document.createElement("div");
      error.className = "metadata-error";
      error.textContent = check.errors.join(" ");
      wrapper.appendChild(error);
    }
  }
  return wrapper;
}
function renderMetadataInspectorForObject(object){
  inspectorSection(`metadata:${metadataObjectKind(object)}`, "Metadata", () => {
    frow("Semantic type", () => metadataTypeSelect(object));
    const definitions = metadataDefinitionsForObject(object);
    if (!definitions.length){
      const empty = document.createElement("div");
      empty.className = "helper";
      empty.textContent = "No compatible property definitions. Open Schema to define typed metadata.";
      appendInspector(empty);
    } else {
      for (const definition of definitions) appendInspector(metadataInspectorProperty(object, definition));
    }
    const findings = metadataObjectKind(object) === "edge"
      ? metadataValidateRelationship(object) : metadataValidateObject(object);
    if (findings.length){
      const warning = document.createElement("button");
      warning.type = "button";
      warning.className = "metadata-findings-button";
      warning.textContent = `${findings.length} metadata finding${findings.length === 1 ? "" : "s"}`;
      warning.addEventListener("click", () => openMetadataPanel("validation"));
      appendInspector(warning);
    }
    const actions = document.createElement("div");
    actions.className = "rowbtns";
    actions.append(
      mkBtn("+ Property", () => {
        metadataCreateProperty({
          name:"New property", appliesTo:[metadataObjectKind(object)],
          typeIds:object.semanticTypeId ? [object.semanticTypeId] : []
        });
        announce("New property added. Edit its schema from Metadata schema.");
      }),
      mkBtn("Object table", () => openMetadataPanel("table")),
      mkBtn("Schema", () => openMetadataPanel("schema"))
    );
    appendInspector(actions);
  }, {open:false});
}
function renderMetadataMultiInspector(objects){
  const compatible = metadataPropertyDefinitions().filter(definition =>
    objects.every(object => metadataDefinitionApplies(definition, object)));
  inspectorSection("multi:metadata", "Metadata", () => {
    frow("Semantic type", () => metadataTypeSelect(objects[0], objects));
    if (!compatible.length){
      const empty = document.createElement("div");
      empty.className = "helper";
      empty.textContent = "No typed properties apply to every selected object.";
      appendInspector(empty);
    }
    for (const definition of compatible)
      appendInspector(metadataInspectorProperty(objects[0], definition, objects));
    const actions = document.createElement("div");
    actions.className = "rowbtns";
    actions.append(
      mkBtn("+ Property", () => {
        const kinds = [...new Set(objects.map(metadataObjectKind))];
        metadataCreateProperty({
          name:"New property", appliesTo:kinds,
          typeIds:[...new Set(objects.map(object => object.semanticTypeId).filter(Boolean))]
        });
      }),
      mkBtn("Open object table", () => openMetadataPanel("table"))
    );
    appendInspector(actions);
  }, {open:false});
}

/* ------------------ Object table and schema manager --------------- */
function metadataCsvEscape(value){
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function metadataTableObjects(){
  const semanticIds=new Set((state.semanticObjects||[]).map(object=>object.id));
  const relationshipIds=new Set((state.semanticRelationships||[]).map(object=>object.id));
  const canonicalReady=state.nodes.every(node=>node.semanticId&&semanticIds.has(node.semanticId)) &&
    state.edges.every(edge=>edge.relationshipId&&relationshipIds.has(edge.relationshipId));
  let objects = canonicalReady && Array.isArray(state.semanticObjects) &&
      Array.isArray(state.semanticRelationships) &&
      (state.semanticObjects.length || state.semanticRelationships.length)
    ? [...state.semanticObjects, ...state.semanticRelationships]
    : [...state.nodes, ...state.edges];
  if (metadataPanelKind !== "all")
    objects = objects.filter(object => metadataObjectKind(object) === metadataPanelKind);
  if (metadataPanelSemanticType)
    objects = objects.filter(object => object.semanticTypeId === metadataPanelSemanticType);
  if (metadataPanelSelectionOnly){
    const selected = new Set([
      ...selectionIds("node").map(id => nodeById(id)?.semanticId).filter(Boolean)
        .map(id => `node:${id}`),
      ...selectionIds("edge").map(id => edgeById(id)?.relationshipId).filter(Boolean)
        .map(id => `edge:${id}`)
    ]);
    objects = objects.filter(object => selected.has(`${metadataObjectKind(object)}:${object.id}`));
  }
  const query = metadataPanelFilter.trim().toLowerCase();
  if (query) objects = objects.filter(object => {
    const values = [metadataObjectName(object), object.id, metadataTypeForObject(object)?.name,
      ...metadataDefinitionsForObject(object).map(definition =>
        metadataDisplayValue(definition, metadataValue(object, definition)))];
    return values.some(value => String(value || "").toLowerCase().includes(query));
  });
  const key = metadataPanelSort.key, direction = metadataPanelSort.direction === "desc" ? -1 : 1;
  return objects.map((object, index) => ({object,index})).sort((a, b) => {
    const value = entry => key === "id" ? entry.object.id :
      key === "kind" ? metadataObjectKind(entry.object) :
      key === "type" ? metadataTypeForObject(entry.object)?.name || "" :
      key.startsWith("property:")
        ? metadataDisplayValue(metadataPropertyById(key.slice(9)),
          metadataValue(entry.object, key.slice(9))) : metadataObjectName(entry.object);
    return String(value(a)).localeCompare(String(value(b)), undefined, {numeric:true,sensitivity:"base"}) *
      direction || a.index - b.index;
  }).map(entry => entry.object);
}
function metadataVisibleTableDefinitions(){
  const available = metadataPropertyDefinitions().filter(definition => !definition.sensitive);
  const selected = new Set(metadataPanelPropertyIds);
  if (selected.has("__none__")) return [];
  return selected.size ? available.filter(definition => selected.has(definition.id)) : available;
}
function metadataExportCsv(objects = metadataTableObjects(), definitions = null){
  definitions = definitions || metadataPropertyDefinitions().filter(definition => !definition.sensitive);
  const headers = ["id","kind","name","semanticTypeId",...definitions.map(definition => definition.id)];
  const rows = [headers];
  for (const object of objects){
    rows.push([
      object.id, metadataObjectKind(object), metadataObjectName(object), object.semanticTypeId || "",
      ...definitions.map(definition => metadataDisplayValue(definition, metadataValue(object, definition)))
    ]);
  }
  return rows.map(row => row.map(metadataCsvEscape).join(",")).join("\n");
}
function metadataBuildCsvPreview(text){
  const lines = String(text || "").split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return {changes:[], errors:["CSV is empty."], rows:0,
    generation:metadataFormulaGeneration};
  const headers = parseCSVLine(lines[0]);
  const idIndex = headers.indexOf("id");
  if (idIndex < 0) return {changes:[], errors:['CSV needs an "id" column.'],
    rows:Math.max(0, lines.length - 1), generation:metadataFormulaGeneration};
  const definitions = headers.map(header => metadataPropertyById(header) ||
    metadataPropertyDefinitions().find(definition =>
      definition.name.toLowerCase() === header.toLowerCase() ||
      (definition.aliases || []).some(alias => alias.toLowerCase() === header.toLowerCase())));
  const changes = [], errors = [];
  const reserved = new Set(["id","kind","name","semanticTypeId"]);
  headers.forEach((header, column) => {
    if (!reserved.has(header) && !definitions[column])
      errors.push(`Column ${header || column + 1} is not mapped to a property definition.`);
  });
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++){
    const cells = parseCSVLine(lines[rowIndex]);
    const object = metadataObjectById(cells[idIndex]);
    if (!object){ errors.push(`Row ${rowIndex + 1}: object ${cells[idIndex] || "(blank)"} was not found.`); continue; }
    for (let column = 0; column < headers.length; column++){
      const header = headers[column];
      if (header === "name"){
        const value = cells[column] ?? "";
        if (value !== metadataObjectName(object))
          changes.push({object, field:"name", value, row:rowIndex + 1});
        continue;
      }
      if (header === "semanticTypeId"){
        const value = cells[column] ?? "";
        const type = metadataObjectKind(object) === "node"
          ? metadataObjectTypeById(value) : metadataRelationshipTypeById(value);
        if (value && !type){
          errors.push(`Row ${rowIndex + 1}: semantic type ${value} was not found.`);
          continue;
        }
        if (value !== (object.semanticTypeId || ""))
          changes.push({object, field:"semanticTypeId", value, row:rowIndex + 1});
        continue;
      }
      const definition = definitions[column];
      if (!definition || column === idIndex || definition.type === "formula") continue;
      if (!metadataDefinitionApplies(definition, object)){
        errors.push(`Row ${rowIndex + 1}: ${definition.name} does not apply to ${metadataObjectName(object)}.`);
        continue;
      }
      let raw = cells[column] ?? "";
      if (definition.type === "multiSelect") raw = raw.split(",").map(item => item.trim()).filter(Boolean);
      const normalized = metadataNormalizeValue(definition, raw);
      if (normalized.errors.length){
        errors.push(`Row ${rowIndex + 1}, ${definition.name}: ${normalized.errors.join(" ")}`);
        continue;
      }
      const previous = metadataRawValue(object, definition.id);
      if (JSON.stringify(previous) !== JSON.stringify(normalized.value))
        changes.push({object, definition, value:normalized.absent ? undefined : normalized.value, row:rowIndex + 1});
    }
  }
  return {changes, errors, rows:lines.length - 1, generation:metadataFormulaGeneration};
}
function metadataBuildGridPastePreview(startObjectId, startColumnKey, text,
    objects = metadataTableObjects(), definitions = metadataVisibleTableDefinitions()){
  const rows = String(text || "").replace(/\r/g, "").split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();
  const columns = [
    {key:"name", field:"name"},
    {key:"semanticTypeId", field:"semanticTypeId"},
    ...definitions.map(definition => ({key:definition.id, definition}))
  ];
  const startRow = objects.findIndex(object => object.id === startObjectId);
  const startColumn = columns.findIndex(column => column.key === startColumnKey);
  if (startRow < 0 || startColumn < 0 || !rows.length)
    return {changes:[],errors:["Choose an editable table cell before pasting."],
      rows:0,columns:0,generation:metadataFormulaGeneration,source:"paste"};
  const changes = [], errors = [];
  let width = 0;
  rows.forEach((line, rowOffset) => {
    const values = line.split("\t");
    width = Math.max(width, values.length);
    const object = objects[startRow + rowOffset];
    if (!object){
      errors.push(`Paste row ${rowOffset + 1}: no destination object.`);
      return;
    }
    values.forEach((raw, columnOffset) => {
      const column = columns[startColumn + columnOffset];
      if (!column){
        errors.push(`Paste row ${rowOffset + 1}, column ${columnOffset + 1}: no destination column.`);
        return;
      }
      if (column.field === "name"){
        if (raw !== metadataObjectName(object))
          changes.push({object,field:"name",value:raw,row:rowOffset + 1});
        return;
      }
      if (column.field === "semanticTypeId"){
        const type = metadataObjectKind(object) === "node"
          ? metadataObjectTypes().find(item =>
            item.id === raw || item.name.toLowerCase() === raw.toLowerCase())
          : metadataRelationshipTypes().find(item =>
            item.id === raw || item.name.toLowerCase() === raw.toLowerCase());
        const typeId = raw ? type?.id : "";
        if (raw && !typeId){
          errors.push(`Paste row ${rowOffset + 1}: semantic type ${raw} was not found.`);
          return;
        }
        if (typeId !== (object.semanticTypeId || ""))
          changes.push({object,field:"semanticTypeId",value:typeId,row:rowOffset + 1});
        return;
      }
      const definition = column.definition;
      if (!metadataDefinitionApplies(definition, object) || definition.readOnly ||
          definition.type === "formula"){
        errors.push(`Paste row ${rowOffset + 1}: ${definition.name} is not editable for ${metadataObjectName(object)}.`);
        return;
      }
      let value = raw;
      if (definition.type === "multiSelect")
        value = raw.split(",").map(item => item.trim()).filter(Boolean);
      const normalized = metadataNormalizeValue(definition, value);
      if (normalized.errors.length){
        errors.push(`Paste row ${rowOffset + 1}, ${definition.name}: ${normalized.errors.join(" ")}`);
        return;
      }
      const previous = metadataRawValue(object, definition.id);
      if (JSON.stringify(previous) !== JSON.stringify(normalized.value))
        changes.push({object,definition,value:normalized.absent ? undefined : normalized.value,
          row:rowOffset + 1});
    });
  });
  return {changes,errors,rows:rows.length,columns:width,
    generation:metadataFormulaGeneration,source:"paste"};
}
function metadataApplyCsvPreview(preview = metadataCsvPreview){
  if (!preview || !preview.changes.length) return false;
  if (preview.generation !== metadataFormulaGeneration){
    announce("The document changed after this preview. Preview the CSV again before applying it.");
    return false;
  }
  const applicable = preview.changes.filter(change =>
    typeof organizationCanMutateObject !== "function" ||
      organizationCanMutateObject(change.object));
  if (!applicable.length) return false;
  pushHistory();
  for (const change of applicable){
    if (change.field === "name"){
      change.object[metadataObjectKind(change.object) === "edge" ? "label" : "title"] = change.value;
      continue;
    }
    if (change.field === "semanticTypeId"){
      metadataAssignType(change.object, change.value, {history:false, render:false});
      continue;
    }
    change.object.properties = {...(change.object.properties || {})};
    if (change.value === undefined) delete change.object.properties[change.definition.id];
    else change.object.properties[change.definition.id] = metadataCloneValue(change.value);
    if (!Object.keys(change.object.properties).length) delete change.object.properties;
    metadataSetProvenance(change.object, change.definition.id, "imported");
  }
  metadataCsvPreview = null;
  invalidateMetadataEvaluation();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  render();
  renderMetadataPanel();
  const skipped = preview.changes.length - applicable.length;
  announce(`Applied ${applicable.length} metadata change${applicable.length === 1 ? "" : "s"}${skipped
    ? `; skipped ${skipped} locked change${skipped === 1 ? "" : "s"}` : ""}.`);
  return true;
}
function metadataSortButton(label, key){
  const button = document.createElement("button");
  button.type = "button";
  button.className = "metadata-sort";
  button.textContent = label + (metadataPanelSort.key === key
    ? metadataPanelSort.direction === "asc" ? " ↑" : " ↓" : "");
  button.addEventListener("click", () => {
    metadataPanelSort = {key, direction:metadataPanelSort.key === key &&
      metadataPanelSort.direction === "asc" ? "desc" : "asc"};
    metadataPanelPage = 0;
    renderMetadataPanel();
  });
  return button;
}
function renderMetadataTable(body){
  const controls = document.createElement("div");
  controls.className = "metadata-toolbar";
  const filter = document.createElement("input");
  filter.type = "search"; filter.placeholder = "Filter objects and values…";
  filter.setAttribute("aria-label", "Filter object table");
  filter.value = metadataPanelFilter;
  filter.addEventListener("input", () => {
    metadataPanelFilter = filter.value; metadataPanelPage = 0; renderMetadataPanel();
  });
  const kind = document.createElement("select");
  kind.setAttribute("aria-label", "Object table kind");
  for (const [value,label] of [["all","Nodes and links"],["node","Nodes"],["edge","Links"]]){
    const option = document.createElement("option");
    option.value = value; option.textContent = label; option.selected = metadataPanelKind === value;
    kind.appendChild(option);
  }
  kind.addEventListener("change", () => {
    metadataPanelKind = kind.value; metadataPanelSemanticType = ""; metadataPanelPage = 0;
    renderMetadataPanel();
  });
  const semanticType = document.createElement("select");
  semanticType.setAttribute("aria-label", "Filter by semantic type");
  const allTypes = document.createElement("option");
  allTypes.value = ""; allTypes.textContent = "All semantic types"; semanticType.appendChild(allTypes);
  const types = metadataPanelKind === "node" ? metadataObjectTypes()
    : metadataPanelKind === "edge" ? metadataRelationshipTypes()
    : [...metadataObjectTypes(), ...metadataRelationshipTypes()];
  for (const typeDefinition of types){
    const option = document.createElement("option");
    option.value = typeDefinition.id; option.textContent = typeDefinition.name;
    option.selected = metadataPanelSemanticType === typeDefinition.id;
    semanticType.appendChild(option);
  }
  semanticType.addEventListener("change", () => {
    metadataPanelSemanticType = semanticType.value; metadataPanelPage = 0; renderMetadataPanel();
  });
  const selectionOnly = document.createElement("label");
  selectionOnly.className = "metadata-inline-check";
  const selectionCheck = document.createElement("input");
  selectionCheck.type = "checkbox"; selectionCheck.checked = metadataPanelSelectionOnly;
  selectionCheck.disabled = !selectionIds().length;
  selectionCheck.addEventListener("change", () => {
    metadataPanelSelectionOnly = selectionCheck.checked; metadataPanelPage = 0; renderMetadataPanel();
  });
  selectionOnly.append(selectionCheck, " Canvas selection");
  const columns = document.createElement("details");
  columns.className = "metadata-columns";
  const columnSummary = document.createElement("summary");
  columnSummary.textContent = "Columns";
  columns.appendChild(columnSummary);
  for (const definition of metadataPropertyDefinitions().filter(item => !item.sensitive)){
    const label = document.createElement("label");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = !metadataPanelPropertyIds.length || metadataPanelPropertyIds.includes(definition.id);
    check.addEventListener("change", () => {
      const currentlyVisible = new Set(metadataVisibleTableDefinitions().map(item => item.id));
      if (check.checked){
        currentlyVisible.delete("__none__");
        currentlyVisible.add(definition.id);
      } else currentlyVisible.delete(definition.id);
      metadataPanelPropertyIds = currentlyVisible.size ? [...currentlyVisible] : ["__none__"];
      renderMetadataPanel();
    });
    label.append(check, definition.name);
    columns.appendChild(label);
  }
  const copy = document.createElement("button");
  copy.type = "button"; copy.textContent = "Copy CSV";
  copy.addEventListener("click", async () => {
    const csv = metadataExportCsv();
    try { await navigator.clipboard.writeText(csv); announce("Object table CSV copied."); }
    catch { announce("Clipboard unavailable. Use the CSV import/export text area."); }
  });
  controls.append(filter, kind, semanticType, selectionOnly, columns, copy);
  body.appendChild(controls);

  const definitions = metadataVisibleTableDefinitions();
  const objects = metadataTableObjects();
  const note = document.createElement("div");
  note.className = "metadata-table-summary";
  const totalPages = Math.max(1, Math.ceil(objects.length / METADATA_TABLE_PAGE_SIZE));
  metadataPanelPage = Math.max(0, Math.min(metadataPanelPage, totalPages - 1));
  const pageStart = metadataPanelPage * METADATA_TABLE_PAGE_SIZE;
  const pageObjects = objects.slice(pageStart, pageStart + METADATA_TABLE_PAGE_SIZE);
  note.textContent = `${objects.length} object${objects.length === 1 ? "" : "s"} · ${definitions.length} property column${definitions.length === 1 ? "" : "s"} · page ${metadataPanelPage + 1} of ${totalPages}`;
  body.appendChild(note);
  if (totalPages > 1){
    const pager = document.createElement("div");
    pager.className = "metadata-pager";
    const previous = document.createElement("button");
    previous.type = "button"; previous.textContent = "Previous"; previous.disabled = metadataPanelPage === 0;
    previous.addEventListener("click", () => { metadataPanelPage--; renderMetadataPanel(); });
    const next = document.createElement("button");
    next.type = "button"; next.textContent = "Next"; next.disabled = metadataPanelPage >= totalPages - 1;
    next.addEventListener("click", () => { metadataPanelPage++; renderMetadataPanel(); });
    pager.append(previous, next);
    body.appendChild(pager);
  }
  const scroller = document.createElement("div");
  scroller.className = "metadata-table-scroll";
  const table = document.createElement("table");
  table.className = "metadata-table";
  const thead = document.createElement("thead"), head = document.createElement("tr");
  for (const [label,key] of [["ID","id"],["Kind","kind"],["Name","name"],["Type","type"]]){
    const th = document.createElement("th"); th.appendChild(metadataSortButton(label,key)); head.appendChild(th);
  }
  for (const definition of definitions){
    const th = document.createElement("th");
    th.appendChild(metadataSortButton(definition.name, `property:${definition.id}`));
    head.appendChild(th);
  }
  thead.appendChild(head); table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const object of pageObjects){
    const row = document.createElement("tr");
    row.dataset.metadataObject = object.id;
    row.tabIndex = 0;
    for (const value of [object.id, metadataObjectKind(object)]){
      const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell);
    }
    const nameCell = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.type = "text"; nameInput.value = metadataObjectName(object);
    nameInput.dataset.metadataColumn = "name";
    nameInput.setAttribute("aria-label", `Name for ${metadataObjectName(object)}`);
    nameInput.addEventListener("change", () => {
      if (typeof organizationCanMutateObject === "function" && !organizationCanMutateObject(object)){
        nameInput.value = metadataObjectName(object);
        return announce("Unlock the object before renaming it.");
      }
      const property = metadataObjectKind(object) === "edge" ? "label" : "title";
      if (object[property] === nameInput.value) return;
      pushHistory();
      object[property] = nameInput.value;
      if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
      render();
      renderMetadataPanel();
    });
    nameCell.appendChild(nameInput); row.appendChild(nameCell);
    const typeCell = document.createElement("td");
    const typeSelect = metadataTypeSelect(object);
    typeSelect.dataset.metadataColumn = "semanticTypeId";
    typeCell.appendChild(typeSelect);
    row.appendChild(typeCell);
    for (const definition of definitions){
      const cell = document.createElement("td");
      if (metadataDefinitionApplies(definition, object)){
        const editor = metadataValueEditor(object, definition);
        editor.dataset.metadataColumn = definition.id;
        cell.appendChild(editor);
      }
      row.appendChild(cell);
    }
    const selectRow = event => {
      if (event.target.closest("input,select,button")) return;
      if ((state.semanticObjects || []).includes(object)){
        if (typeof pagesOpenAppearanceChooser === "function")
          pagesOpenAppearanceChooser(object.id,pagesAppearances(object.id));
        return;
      }
      if ((state.semanticRelationships || []).includes(object)){
        const instance=pagesOrdered().flatMap(page=>page.edges.map(edge=>({page,edge})))
          .find(entry=>entry.edge.relationshipId===object.id);
        if(instance){
          pagesSwitch(instance.page.id);
          setSelection("edge",instance.edge.id);
          render();
        }
        return;
      }
      setSelection(metadataObjectKind(object), object.id);
      render();
    };
    row.addEventListener("click", selectRow);
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " "){ event.preventDefault(); selectRow(event); }
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  table.addEventListener("paste", event => {
    const control = event.target.closest("[data-metadata-column]");
    const row = event.target.closest("[data-metadata-object]");
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!control || !row || (!text.includes("\t") && !text.includes("\n"))) return;
    event.preventDefault();
    metadataCsvPreview = metadataBuildGridPastePreview(
      row.dataset.metadataObject, control.dataset.metadataColumn, text, pageObjects, definitions
    );
    renderMetadataPanel();
    announce(`Paste preview: ${metadataCsvPreview.changes.length} valid change${metadataCsvPreview.changes.length === 1 ? "" : "s"} and ${metadataCsvPreview.errors.length} error${metadataCsvPreview.errors.length === 1 ? "" : "s"}.`);
  });
  scroller.appendChild(table); body.appendChild(scroller);
  const csv = document.createElement("details");
  csv.className = "metadata-csv";
  if (metadataCsvPreview?.source === "paste") csv.open = true;
  const summary = document.createElement("summary");
  summary.textContent = metadataCsvPreview?.source === "paste" ? "Rectangular paste preview" : "CSV import preview";
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", "Metadata CSV");
  textarea.placeholder = 'id,Owner,Risk\nn1,Alex,High';
  const preview = document.createElement("button");
  preview.type = "button"; preview.textContent = "Preview CSV";
  const result = document.createElement("div"); result.className = "metadata-csv-result";
  preview.addEventListener("click", () => {
    metadataCsvPreview = metadataBuildCsvPreview(textarea.value);
    result.textContent = `${metadataCsvPreview.changes.length} valid change(s), ${metadataCsvPreview.errors.length} error(s).`;
    if (metadataCsvPreview.errors.length){
      const list = document.createElement("ul");
      for (const error of metadataCsvPreview.errors.slice(0, 20)){
        const item = document.createElement("li"); item.textContent = error; list.appendChild(item);
      }
      result.appendChild(list);
    }
    apply.disabled = !metadataCsvPreview.changes.length;
  });
  const apply = document.createElement("button");
  apply.type = "button"; apply.textContent = "Apply valid changes";
  apply.disabled = !metadataCsvPreview?.changes.length;
  apply.addEventListener("click", () => metadataApplyCsvPreview());
  if (metadataCsvPreview){
    result.textContent = `${metadataCsvPreview.changes.length} valid change(s), ${metadataCsvPreview.errors.length} error(s).`;
    if (metadataCsvPreview.errors.length){
      const list = document.createElement("ul");
      for (const error of metadataCsvPreview.errors.slice(0, 20)){
        const item = document.createElement("li"); item.textContent = error; list.appendChild(item);
      }
      result.appendChild(list);
    }
  }
  csv.append(summary, textarea, preview, apply, result);
  body.appendChild(csv);
}
function metadataDefinitionEditor(definition, kind){
  const row = document.createElement("section");
  row.className = "metadata-definition";
  row.dataset.definitionId = definition.id;
  if (definition.deprecated) row.classList.add("deprecated");
  const name = document.createElement("input");
  name.type = "text"; name.value = definition.name; name.setAttribute("aria-label", `${kind} name`);
  name.addEventListener("change", () => metadataUpdateDefinition(kind, definition.id, {name:name.value}));
  const id = document.createElement("code"); id.textContent = definition.id;
  row.append(name, id);
  const description = document.createElement("textarea");
  description.value = definition.description || "";
  description.placeholder = "Description or help text";
  description.setAttribute("aria-label", `${definition.name} description`);
  description.addEventListener("change", () =>
    metadataUpdateDefinition(kind, definition.id, {description:description.value}));
  row.appendChild(description);
  if (kind === "property"){
    const type = document.createElement("select");
    type.setAttribute("aria-label", `${definition.name} data type`);
    for (const [value,label] of METADATA_PROPERTY_TYPES){
      const option = document.createElement("option");
      option.value = value; option.textContent = label; option.selected = definition.type === value;
      type.appendChild(option);
    }
    type.addEventListener("change", () => {
      const preview = metadataPropertyTypeConversionPreview(definition.id, type.value);
      const affected = preview.converted + preview.ambiguous + preview.invalid + preview.unchanged;
      if (affected){
        const message = [
          `${affected} stored value${affected === 1 ? "" : "s"} will be reinterpreted.`,
          `${preview.converted} convertible · ${preview.ambiguous} ambiguous · ${preview.invalid} invalid · ${preview.unchanged} unchanged.`,
          "No value will be deleted. Invalid values remain available for repair. Continue?"
        ].join("\n");
        if (typeof confirm === "function" && !confirm(message)){
          type.value = definition.type;
          return;
        }
      }
      metadataUpdateDefinition("property", definition.id, {type:type.value});
      renderMetadataPanel();
    });
    const scope = document.createElement("select");
    scope.setAttribute("aria-label", `${definition.name} scope`);
    for (const [value,label] of METADATA_SCOPES){
      const option = document.createElement("option");
      option.value = value; option.textContent = label; option.selected = definition.scope === value;
      scope.appendChild(option);
    }
    scope.addEventListener("change", () => metadataUpdateDefinition("property", definition.id, {scope:scope.value}));
    const required = document.createElement("label");
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = definition.required === true;
    check.addEventListener("change", () => metadataUpdateDefinition("property", definition.id, {required:check.checked}));
    required.append(check, " Required");
    row.append(type, scope, required);
    const applies = document.createElement("div");
    applies.className = "metadata-definition-options";
    for (const [value,label] of [["node","Nodes"],["edge","Links"]]){
      const appliesLabel = document.createElement("label");
      const appliesCheck = document.createElement("input");
      appliesCheck.type = "checkbox"; appliesCheck.checked = definition.appliesTo.includes(value);
      appliesCheck.addEventListener("change", () => {
        const next = new Set(definition.appliesTo);
        if (appliesCheck.checked) next.add(value); else next.delete(value);
        if (!next.size){ appliesCheck.checked = true; return announce("A property must apply to nodes, links, or both."); }
        metadataUpdateDefinition("property", definition.id, {appliesTo:[...next]});
      });
      appliesLabel.append(appliesCheck, label);
      applies.appendChild(appliesLabel);
    }
    const sensitiveLabel = document.createElement("label");
    const sensitive = document.createElement("input");
    sensitive.type = "checkbox"; sensitive.checked = definition.sensitive === true;
    sensitive.addEventListener("change", () =>
      metadataUpdateDefinition("property", definition.id, {sensitive:sensitive.checked}));
    sensitiveLabel.append(sensitive, " Sensitive");
    applies.appendChild(sensitiveLabel);
    const uniqueLabel = document.createElement("label");
    const unique = document.createElement("input");
    unique.type = "checkbox"; unique.checked = definition.unique === true;
    unique.addEventListener("change", () =>
      metadataUpdateDefinition("property", definition.id, {unique:unique.checked}));
    uniqueLabel.append(unique, " Unique");
    applies.appendChild(uniqueLabel);
    row.appendChild(applies);
    if (["enum","multiSelect","status"].includes(definition.type)){
      const options = document.createElement("input");
      options.type = "text";
      options.value = (definition.options || []).map(option => option.label).join(", ");
      options.placeholder = "Comma-separated options";
      options.setAttribute("aria-label", `${definition.name} options`);
      options.addEventListener("change", () => {
        const next = options.value.split(",").map((label,index) => ({
          id:(definition.options || [])[index]?.id || label.trim().toLowerCase().replace(/\W+/g, "-"),
          label:label.trim()
        })).filter(option => option.label);
        metadataUpdateDefinition("property", definition.id, {options:next});
      });
      row.appendChild(options);
    }
    if (definition.type === "formula"){
      const formula = document.createElement("textarea");
      formula.value = definition.formula || "";
      formula.placeholder = 'countIn() + countOut()';
      formula.setAttribute("aria-label", `${definition.name} formula`);
      formula.addEventListener("change", () => metadataUpdateDefinition("property", definition.id, {formula:formula.value}));
      row.appendChild(formula);
      const dependencies = document.createElement("small");
      const ids = [...metadataFormulaDependenciesSafe(definition.formula)];
      dependencies.textContent = ids.length
        ? `Dependencies: ${ids.map(dependencyId => metadataPropertyById(dependencyId)?.name || dependencyId).join(", ")}`
        : "Dependencies: none";
      row.appendChild(dependencies);
    }
    const advanced = document.createElement("details");
    advanced.className = "metadata-definition-advanced";
    const advancedSummary = document.createElement("summary");
    advancedSummary.textContent = "Validation, import, and provenance";
    advanced.appendChild(advancedSummary);
    const group = document.createElement("input");
    group.type = "text"; group.value = definition.group || ""; group.placeholder = "Inspector group";
    group.setAttribute("aria-label", `${definition.name} inspector group`);
    group.addEventListener("change", () => metadataUpdateDefinition("property", definition.id, {group:group.value}));
    const aliases = document.createElement("input");
    aliases.type = "text"; aliases.value = (definition.aliases || []).join(", ");
    aliases.placeholder = "CSV aliases, comma separated";
    aliases.setAttribute("aria-label", `${definition.name} import aliases`);
    aliases.addEventListener("change", () => metadataUpdateDefinition("property", definition.id, {
      aliases:aliases.value.split(",").map(value => value.trim()).filter(Boolean)
    }));
    const defaultValue = document.createElement("input");
    defaultValue.type = "text";
    defaultValue.value = definition.defaultValue == null ? "" : metadataDisplayValue(definition, definition.defaultValue);
    defaultValue.placeholder = "Default value";
    defaultValue.setAttribute("aria-label", `${definition.name} default value`);
    defaultValue.disabled = definition.type === "formula";
    defaultValue.addEventListener("change", () => {
      const normalized = metadataNormalizeValue(definition, defaultValue.value);
      if (normalized.errors.length){
        defaultValue.setAttribute("aria-invalid", "true");
        return announce(normalized.errors.join(" "));
      }
      metadataUpdateDefinition("property", definition.id, {
        defaultValue:normalized.absent ? undefined : normalized.value
      });
    });
    advanced.append(group, aliases, defaultValue);
    if (definition.type === "number"){
      for (const [key,labelText] of [["min","Minimum"],["max","Maximum"],["precision","Decimal precision"]]){
        const input = document.createElement("input");
        input.type = "number"; input.placeholder = labelText;
        input.setAttribute("aria-label", `${definition.name} ${labelText.toLowerCase()}`);
        if (Number.isFinite(definition[key])) input.value = definition[key];
        input.addEventListener("change", () => metadataUpdateDefinition("property", definition.id, {
          [key]:input.value === "" ? undefined : Number(input.value)
        }));
        advanced.appendChild(input);
      }
    }
    row.appendChild(advanced);
    const reorder = document.createElement("div");
    reorder.className = "metadata-reorder";
    for (const [labelText,direction] of [["Move up",-1],["Move down",1]]){
      const button = document.createElement("button");
      button.type = "button"; button.textContent = labelText;
      button.addEventListener("click", () => { metadataReorderProperty(definition.id, direction); renderMetadataPanel(); });
      reorder.appendChild(button);
    }
    row.appendChild(reorder);
  } else {
    const details = document.createElement("details");
    details.className = "metadata-type-rules";
    const summary = document.createElement("summary");
    summary.textContent = "Properties and rules";
    details.appendChild(summary);
    const propertyHeading = document.createElement("b");
    propertyHeading.textContent = "Allowed / required properties";
    details.appendChild(propertyHeading);
    const typeObjectKind = kind === "relationshipType" ? "edge" : "node";
    for (const property of metadataPropertyDefinitions().filter(item => item.appliesTo.includes(typeObjectKind))){
      const membership = document.createElement("div");
      membership.className = "metadata-type-property";
      const label = document.createElement("span"); label.textContent = property.name;
      const allowedLabel = document.createElement("label");
      const allowed = document.createElement("input");
      allowed.type = "checkbox"; allowed.checked = (definition.propertyIds || []).includes(property.id);
      const requiredLabel = document.createElement("label");
      const required = document.createElement("input");
      required.type = "checkbox"; required.checked = (definition.requiredPropertyIds || []).includes(property.id);
      allowed.addEventListener("change", () => {
        const allowedIds = new Set(definition.propertyIds || []);
        const requiredIds = new Set(definition.requiredPropertyIds || []);
        if (allowed.checked) allowedIds.add(property.id);
        else { allowedIds.delete(property.id); requiredIds.delete(property.id); }
        metadataUpdateDefinition(kind, definition.id, {
          propertyIds:[...allowedIds], requiredPropertyIds:[...requiredIds]
        });
        renderMetadataPanel();
      });
      required.addEventListener("change", () => {
        const allowedIds = new Set(definition.propertyIds || []);
        const requiredIds = new Set(definition.requiredPropertyIds || []);
        if (required.checked){ allowedIds.add(property.id); requiredIds.add(property.id); }
        else requiredIds.delete(property.id);
        metadataUpdateDefinition(kind, definition.id, {
          propertyIds:[...allowedIds], requiredPropertyIds:[...requiredIds]
        });
        renderMetadataPanel();
      });
      allowedLabel.append(allowed, " Allowed");
      requiredLabel.append(required, " Required");
      membership.append(label, allowedLabel, requiredLabel);
      details.appendChild(membership);
    }
    if (kind === "objectType"){
      const defaultsHeading = document.createElement("b");
      defaultsHeading.textContent = "Presentation defaults";
      const shape = document.createElement("select");
      shape.setAttribute("aria-label", `${definition.name} default shape`);
      const noShape = document.createElement("option");
      noShape.value = ""; noShape.textContent = "No default shape"; shape.appendChild(noShape);
      for (const [value,labelText] of FLOWCHART_SHAPES){
        const option = document.createElement("option");
        option.value = value; option.textContent = labelText; option.selected = definition.defaultShape === value;
        shape.appendChild(option);
      }
      shape.addEventListener("change", () =>
        metadataUpdateDefinition(kind, definition.id, {defaultShape:shape.value || undefined}));
      const icon = document.createElement("input");
      icon.type = "text"; icon.value = definition.defaultIcon || "";
      icon.placeholder = "Default icon, e.g. lucide:server";
      icon.setAttribute("aria-label", `${definition.name} default icon`);
      icon.addEventListener("change", () =>
        metadataUpdateDefinition(kind, definition.id, {defaultIcon:icon.value || undefined}));
      details.append(defaultsHeading, shape, icon);
    } else {
      const connectionHeading = document.createElement("b");
      connectionHeading.textContent = "Connection rules (warning mode)";
      details.appendChild(connectionHeading);
      for (const [key,labelText] of [
        ["allowedSourceTypeIds","Allowed source types"],
        ["allowedTargetTypeIds","Allowed target types"]
      ]){
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend"); legend.textContent = labelText;
        fieldset.appendChild(legend);
        for (const objectType of metadataObjectTypes()){
          const label = document.createElement("label");
          const check = document.createElement("input");
          check.type = "checkbox"; check.checked = (definition[key] || []).includes(objectType.id);
          check.addEventListener("change", () => {
            const next = new Set(definition[key] || []);
            if (check.checked) next.add(objectType.id); else next.delete(objectType.id);
            metadataUpdateDefinition(kind, definition.id, {[key]:[...next]});
            renderMetadataPanel();
          });
          label.append(check, objectType.name); fieldset.appendChild(label);
        }
        details.appendChild(fieldset);
      }
    }
    row.appendChild(details);
  }
  const impact = metadataDefinitionImpact(kind, definition.id);
  const usage = document.createElement(impact.total ? "button" : "small");
  usage.className = "metadata-definition-impact";
  if (impact.total){
    usage.type = "button";
    usage.addEventListener("click", () => {
      metadataPanelFilter = "";
      metadataPanelPage = 0;
      if (kind === "property"){
        metadataPanelPropertyIds = [definition.id];
        metadataPanelSemanticType = "";
      } else metadataPanelSemanticType = definition.id;
      openMetadataPanel("table");
    });
  }
  usage.textContent = impact.total
    ? `Used by ${impact.objects.length} object${impact.objects.length === 1 ? "" : "s"}, ${impact.types.length} type${impact.types.length === 1 ? "" : "s"}, and ${impact.formulas.length} formula${impact.formulas.length === 1 ? "" : "s"}.`
    : "Not currently used.";
  const remove = document.createElement("button");
  remove.type = "button"; remove.className = "dangerbtn";
  remove.textContent = impact.total ? definition.deprecated ? "Delete…" : "Deprecate" : "Delete";
  remove.addEventListener("click", () => {
    const force = definition.deprecated && confirm(`Permanently delete ${definition.name}? Values will move to orphanProperties.`);
    metadataDeleteDefinition(kind, definition.id, {force});
    renderMetadataPanel();
  });
  row.append(usage, remove);
  return row;
}
function renderMetadataSchema(body){
  const toolbar = document.createElement("div");
  toolbar.className = "metadata-toolbar";
  for (const [label,action] of [
    ["+ Property",() => metadataCreateProperty()],
    ["+ Object type",() => metadataCreateType("node")],
    ["+ Relationship type",() => metadataCreateType("edge")]
  ]){
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => { action(); renderMetadataPanel(); });
    toolbar.appendChild(button);
  }
  const legacy = metadataLegacyDefinitions();
  if (legacy.length){
    const adopt = document.createElement("button");
    adopt.type = "button"; adopt.textContent = `Adopt ${legacy.length} legacy propert${legacy.length === 1 ? "y" : "ies"}`;
    adopt.addEventListener("click", () => { metadataAdoptLegacyProperties(); renderMetadataPanel(); });
    toolbar.appendChild(adopt);
  }
  body.appendChild(toolbar);
  for (const [title,kind,definitions] of [
    ["Property definitions","property",metadataPropertyDefinitions()],
    ["Object types","objectType",metadataObjectTypes()],
    ["Relationship types","relationshipType",metadataRelationshipTypes()]
  ]){
    const group = document.createElement("div");
    group.className = "metadata-definition-group";
    const heading = document.createElement("h4"); heading.textContent = `${title} (${definitions.length})`;
    group.appendChild(heading);
    if (!definitions.length){
      const empty = document.createElement("p"); empty.className = "helper"; empty.textContent = "None defined.";
      group.appendChild(empty);
    }
    for (const definition of definitions) group.appendChild(metadataDefinitionEditor(definition, kind));
    body.appendChild(group);
  }
}
function renderMetadataValidation(body){
  const findings = metadataValidationFindings();
  const summary = document.createElement("div");
  summary.className = "metadata-validation-summary";
  summary.textContent = findings.length
    ? `${findings.length} finding${findings.length === 1 ? "" : "s"}`
    : "No metadata validation findings.";
  body.appendChild(summary);
  const list = document.createElement("div");
  list.className = "metadata-validation-list";
  for (const finding of findings){
    const button = document.createElement("button");
    button.type = "button";
    button.className = `metadata-finding ${finding.severity}`;
    const object = metadataObjectById(finding.objectId);
    button.innerHTML = `<b>${escapeHtml(object ? metadataObjectName(object) : metadataPropertyById(finding.propertyId)?.name || "Schema")}</b><span>${escapeHtml(finding.message)}</span>`;
    button.addEventListener("click", () => {
      if (object){
        setSelection(metadataObjectKind(object), object.id);
        if (metadataObjectKind(object) === "node") centerViewOn(nodeRect(object));
        render();
      }
    });
    list.appendChild(button);
  }
  body.appendChild(list);
}
function renderMetadataPanel(){
  const panel = document.getElementById("metadataPanel");
  const body = document.getElementById("metadataPanelBody");
  if (!panel || !body || !metadataPanelOpen) return;
  body.innerHTML = "";
  const titles = {table:"Object table",schema:"Metadata schema",validation:"Metadata validation"};
  document.getElementById("metadataPanelTitle").textContent = titles[metadataPanelMode];
  for (const tab of panel.querySelectorAll("[data-metadata-mode]")){
    const selected = tab.dataset.metadataMode === metadataPanelMode;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) body.setAttribute("aria-labelledby", tab.id);
  }
  if (metadataPanelMode === "schema") renderMetadataSchema(body);
  else if (metadataPanelMode === "validation") renderMetadataValidation(body);
  else renderMetadataTable(body);
}
function openMetadataPanel(mode = "table"){
  metadataPanelMode = ["table","schema","validation"].includes(mode) ? mode : "table";
  if (!metadataPanelOpen && document.activeElement instanceof HTMLElement)
    metadataPanelReturnFocus = document.activeElement;
  metadataPanelOpen = true;
  const panel = document.getElementById("metadataPanel");
  if (!panel) return false;
  panel.hidden = false;
  panel.classList.add("open");
  renderMetadataPanel();
  requestAnimationFrame(() => panel.querySelector("[aria-selected=true],input,button")?.focus());
  return true;
}
function closeMetadataPanel(){
  metadataPanelOpen = false;
  const panel = document.getElementById("metadataPanel");
  if (panel){
    panel.classList.remove("open");
    panel.hidden = true;
  }
  metadataPanelReturnFocus?.focus?.();
  metadataPanelReturnFocus = null;
}
function initializeMetadataUi(){
  const panel = document.getElementById("metadataPanel");
  if (!panel) return;
  document.getElementById("btnCloseMetadataPanel")?.addEventListener("click", closeMetadataPanel);
  for (const tab of panel.querySelectorAll("[data-metadata-mode]"))
    tab.addEventListener("click", () => openMetadataPanel(tab.dataset.metadataMode));
  panel.querySelector(".metadata-tabs")?.addEventListener("keydown", event => {
    const tabs = [...panel.querySelectorAll("[data-metadata-mode]")];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    openMetadataPanel(tabs[next].dataset.metadataMode);
  });
  panel.addEventListener("click", event => { if (event.target === panel) closeMetadataPanel(); });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape"){ event.preventDefault(); closeMetadataPanel(); }
  });
}

/* ---------------- Commands and context menus ---------------------- */
function initializeMetadataCommands(){
  if (typeof registerCommand !== "function") return;
  const owner = "custom-metadata";
  registerCommand({
    id:"metadataObjectTable", label:"Object table", description:"Open the sortable typed metadata table",
    action:() => openMetadataPanel("table"), owner, scope:"application", mutatesDocument:false,
    ribbon:{tab:"model",group:"Metadata",priority:"normal"}
  });
  registerCommand({
    id:"metadataSchema", label:"Metadata schema", description:"Manage property, object-type, and relationship-type definitions",
    action:() => openMetadataPanel("schema"), owner, scope:"application", mutatesDocument:false,
    ribbon:{tab:"model",group:"Metadata",priority:"normal"}
  });
  registerCommand({
    id:"metadataValidate", label:"Validate metadata", description:"Find missing, invalid, broken, and incompatible metadata",
    action:() => openMetadataPanel("validation"), owner, scope:"application", mutatesDocument:false,
    ribbon:{tab:"model",group:"Metadata",priority:"normal"}
  });
}
function buildMetadataNodeContext(parent, node, targets){
  ctxGroup(parent, "node:metadata", "Metadata", panel => {
    ctxSubmenu(panel, "node:metadata:type", "Semantic type", sub => {
      ctxItem(sub, (!node.semanticTypeId ? "✓ " : "") + "No semantic type", () => {
        pushHistory(); for (const target of targets) metadataAssignType(target, "", {history:false,render:false}); render();
      });
      for (const type of metadataObjectTypes())
        ctxItem(sub, (targets.every(target => target.semanticTypeId === type.id) ? "✓ " : "") + type.name, () => {
          pushHistory(); for (const target of targets) metadataAssignType(target, type.id, {history:false,render:false}); render();
        });
    });
    ctxItem(panel, "Open object table", () => openMetadataPanel("table"));
    ctxItem(panel, "Manage schema", () => openMetadataPanel("schema"));
    ctxItem(panel, "Validate metadata", () => openMetadataPanel("validation"));
  });
}
function buildMetadataEdgeContext(parent, edge){
  ctxGroup(parent, "edge:metadata", "Metadata", panel => {
    ctxSubmenu(panel, "edge:metadata:type", "Semantic type", sub => {
      ctxItem(sub, (!edge.semanticTypeId ? "✓ " : "") + "No semantic type", () => metadataAssignType(edge, ""));
      for (const type of metadataRelationshipTypes())
        ctxItem(sub, (edge.semanticTypeId === type.id ? "✓ " : "") + type.name,
          () => metadataAssignType(edge, type.id));
    });
    ctxItem(panel, "Open object table", () => openMetadataPanel("table"));
    ctxItem(panel, "Validate metadata", () => openMetadataPanel("validation"));
  });
}
function buildMetadataCanvasContext(parent){
  ctxGroup(parent, "canvas:metadata", "Model data", panel => {
    ctxItem(panel, "Object table", () => openMetadataPanel("table"));
    ctxItem(panel, "Metadata schema", () => openMetadataPanel("schema"));
    ctxItem(panel, "Validate metadata", () => openMetadataPanel("validation"));
  });
}

ensureMetadata();
