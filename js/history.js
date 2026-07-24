"use strict";

/* ------------------------------------------------------------------
   Durable version history (issue #84)

   Session undo, crash recovery, and durable history deliberately remain
   separate. Named and pinned checkpoints travel with the native document;
   frequent automatic snapshots stay in a local, retention-managed store.
   Structured transaction summaries make changes inspectable today without
   preventing a future operation-log or semantic multi-view model.
   ------------------------------------------------------------------ */

const HISTORY_SCHEMA_VERSION = 1;
const HISTORY_LOCAL_PREFIX = "schematic.history.";
const HISTORY_LOCAL_TEMP_SUFFIX = ".pending";
const HISTORY_PREFERENCES_KEY = "schematic.history.preferences";
const HISTORY_TRANSACTION_LIMIT = 500;
const HISTORY_DEFAULT_RETENTION = Object.freeze({maxAutomatic:80, maxAgeDays:30});
const HISTORY_CURRENT_ID = "__current__";
const HISTORY_CHANGE_FIELDS = Object.freeze({
  geometry:["x","y"],
  size:["w","h","manualWidth","manualHeight","rotation","flipX","flipY","collapsed"],
  content:["title","subtitle","notes","content","status","items"],
  table:["fields"],
  ports:["portsEnabled","inputPorts","outputPorts","inputLabel","outputLabel"],
  style:["color","fontColor","fontSize","shape","icon","borderEnabled","borderWidth","borderColor",
    "titleColor","bodyColor","opacity"],
  metadata:["properties","propertyProvenance","semanticTypeId","tags","owner","sourceAuthority"],
  endpoints:["from","to","fromField","toField","fromAnchor","toAnchor","fromPort","toPort","pairs"],
  route:["routing","waypoints","orthoX","orthoY","orthoFromStub","orthoToStub","orthoCorner",
    "labelPosition"],
  edgeContent:["kind","label","relationship","semanticRelationshipTypeId"],
  edgeStyle:["lineColor","lineWidth","lineStyle","startArrow","endArrow","labelTextColor",
    "labelBackgroundColor"]
});

let historyState = null;
let historyLocal = null;
let historyPreferences = {...HISTORY_DEFAULT_RETENTION, author:""};
let historyPending = null;
let historyPendingTimer = null;
let historyCommittedSnapshot = null;
let historySuspended = 0;
let historyIdCounter = 0;
let historyStorageStatus = {ok:true, message:""};
let historyPanelOpen = false;
let historyPanelReturnFocus = null;
let historySelectedId = HISTORY_CURRENT_ID;
let historyCompare = {from:HISTORY_CURRENT_ID, to:HISTORY_CURRENT_ID, result:null};
let historyActiveChange = -1;
let historyRestorePlan = null;
let historyUiInitialized = false;

function historyClone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function historyId(prefix){
  historyIdCounter += 1;
  const entropy = Math.floor(Math.random() * 0x100000000).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${historyIdCounter.toString(36)}-${entropy}`;
}
function historyStableValue(value){
  if (Array.isArray(value)) return value.map(historyStableValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()){
    const normalized = historyStableValue(value[key]);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}
function historyStableStringify(value){
  return JSON.stringify(historyStableValue(value));
}
function historyChecksum(value){
  const text = typeof value === "string" ? value : historyStableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8,"0")}`;
}
function historyEqual(a, b){ return historyStableStringify(a) === historyStableStringify(b); }
function historyModelSnapshot(){ return historyClone(documentObject({includeHistory:false})); }
function historySnapshotChecksum(snapshot){ return historyChecksum(snapshot); }
function historyObjectLabel(object, fallback = "Object"){
  return String(object && (object.title || object.label || object.name) || fallback);
}
function historyNow(){ return Date.now(); }
function historyFormatDate(timestamp){
  try { return new Date(timestamp).toLocaleString(); } catch { return "Unknown time"; }
}
function historyDefaultState(documentId = historyId("doc")){
  return {
    schemaVersion:HISTORY_SCHEMA_VERSION,
    storage:"hybrid",
    documentId,
    sequence:0,
    checkpoints:[],
    transactions:[],
    createdAt:historyNow()
  };
}
function historyDefaultLocal(documentId){
  return {
    schemaVersion:HISTORY_SCHEMA_VERSION,
    documentId,
    retention:{
      maxAutomatic:historyPreferences.maxAutomatic,
      maxAgeDays:historyPreferences.maxAgeDays
    },
    automatic:[],
    updatedAt:historyNow()
  };
}
function historyLocalKey(documentId){
  return HISTORY_LOCAL_PREFIX + String(documentId || "unknown");
}
function historyStorageTextBytes(text){
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return String(text).length * 2;
}
function historyHumanBytes(bytes){
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function historyReadPreferences(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(HISTORY_PREFERENCES_KEY) || "null"); } catch {}
  historyPreferences = {
    maxAutomatic:Math.max(10, Math.min(500, Number(raw && raw.maxAutomatic) ||
      HISTORY_DEFAULT_RETENTION.maxAutomatic)),
    maxAgeDays:Math.max(1, Math.min(365, Number(raw && raw.maxAgeDays) ||
      HISTORY_DEFAULT_RETENTION.maxAgeDays)),
    author:String(raw && raw.author || "").trim().slice(0,80)
  };
  return historyPreferences;
}
function historyWritePreferences(){
  try {
    localStorage.setItem(HISTORY_PREFERENCES_KEY, JSON.stringify(historyPreferences));
    return true;
  } catch {
    historyStorageStatus = {ok:false, message:"History preferences could not be stored on this device."};
    return false;
  }
}
function historyRecordValid(record){
  if (!record || typeof record !== "object" || !record.id || !record.snapshot) return false;
  const snapshot = record.snapshot;
  if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return false;
  return !record.checksum || record.checksum === historySnapshotChecksum(snapshot);
}
function historyReadLocal(documentId){
  const key = historyLocalKey(documentId);
  let raw = null;
  let usedPending = false;
  try {
    raw = localStorage.getItem(key);
    if (!raw){
      raw = localStorage.getItem(key + HISTORY_LOCAL_TEMP_SUFFIX);
      usedPending = !!raw;
    }
  } catch {
    historyStorageStatus = {ok:false, message:"Automatic history is unavailable because local storage is blocked."};
    return historyDefaultLocal(documentId);
  }
  if (!raw) return historyDefaultLocal(documentId);
  try {
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion > HISTORY_SCHEMA_VERSION){
      historyStorageStatus = {ok:false,
        message:"Automatic history was created by a newer Schematic and was left untouched."};
      return historyDefaultLocal(documentId);
    }
    if (parsed.documentId !== documentId || !Array.isArray(parsed.automatic))
      throw new Error("mismatched history");
    const valid = parsed.automatic.filter(historyRecordValid);
    if (valid.length !== parsed.automatic.length)
      historyStorageStatus = {ok:false,
        message:`Skipped ${parsed.automatic.length - valid.length} damaged automatic version(s).`};
    const local = {
      schemaVersion:HISTORY_SCHEMA_VERSION,
      documentId,
      retention:{
        maxAutomatic:Math.max(10, Math.min(500,
          Number(parsed.retention && parsed.retention.maxAutomatic) || historyPreferences.maxAutomatic)),
        maxAgeDays:Math.max(1, Math.min(365,
          Number(parsed.retention && parsed.retention.maxAgeDays) || historyPreferences.maxAgeDays))
      },
      automatic:valid,
      updatedAt:Number(parsed.updatedAt) || historyNow()
    };
    if (usedPending) historyStorageStatus = {ok:false,
      message:"Recovered automatic history from an interrupted local write."};
    return local;
  } catch {
    historyStorageStatus = {ok:false,
      message:"Automatic history was damaged and has been isolated; the current document is safe."};
    return historyDefaultLocal(documentId);
  }
}
function historyApplyRetention(local = historyLocal){
  if (!local) return [];
  const maxCount = Math.max(10, Math.min(500,
    Number(local.retention && local.retention.maxAutomatic) || historyPreferences.maxAutomatic));
  const maxAge = Math.max(1, Math.min(365,
    Number(local.retention && local.retention.maxAgeDays) || historyPreferences.maxAgeDays));
  const cutoff = historyNow() - maxAge * 24 * 60 * 60 * 1000;
  const sorted = local.automatic.filter(historyRecordValid)
    .sort((a,b) => (b.sequence || 0) - (a.sequence || 0) || (b.timestamp || 0) - (a.timestamp || 0));
  const kept = sorted.filter((record,index) => index < 10 || record.timestamp >= cutoff).slice(0,maxCount);
  local.automatic = kept.sort((a,b) => (a.sequence || 0) - (b.sequence || 0));
  return local.automatic;
}
function historyWriteLocal(){
  if (!historyLocal || !historyState) return false;
  historyApplyRetention();
  historyLocal.updatedAt = historyNow();
  const key = historyLocalKey(historyState.documentId);
  const text = JSON.stringify(historyLocal);
  try {
    localStorage.setItem(key + HISTORY_LOCAL_TEMP_SUFFIX, text);
    localStorage.setItem(key, text);
    localStorage.removeItem(key + HISTORY_LOCAL_TEMP_SUFFIX);
    if (!historyStorageStatus.message || historyStorageStatus.ok)
      historyStorageStatus = {ok:true, message:""};
    return true;
  } catch(error){
    historyStorageStatus = {ok:false,
      message:error && error.name === "QuotaExceededError"
        ? "Automatic history storage is full. The current document can still be saved."
        : "Automatic history could not be written. The current document remains safe."};
    return false;
  }
}
function historyNormalizeEmbedded(raw){
  if (!raw || typeof raw !== "object") return historyDefaultState();
  if (Number(raw.schemaVersion) > HISTORY_SCHEMA_VERSION){
    const state = historyDefaultState(raw.documentId || historyId("doc"));
    state.futurePayload = historyClone(raw);
    historyStorageStatus = {ok:false,
      message:"Portable history was created by a newer Schematic and was preserved without interpretation."};
    return state;
  }
  const state = historyDefaultState(String(raw.documentId || historyId("doc")));
  state.createdAt = Number(raw.createdAt) || historyNow();
  state.sequence = Math.max(0, Number(raw.sequence) || 0);
  state.checkpoints = (Array.isArray(raw.checkpoints) ? raw.checkpoints : [])
    .filter(historyRecordValid).map(historyClone);
  state.transactions = (Array.isArray(raw.transactions) ? raw.transactions : [])
    .filter(transaction => transaction && transaction.id && Number.isFinite(Number(transaction.sequence)))
    .slice(-HISTORY_TRANSACTION_LIMIT).map(historyClone);
  const known = new Set(["schemaVersion","storage","documentId","sequence","checkpoints",
    "transactions","createdAt","futurePayload"]);
  const extensions = {};
  for (const [key,value] of Object.entries(raw)) if (!known.has(key)) extensions[key] = historyClone(value);
  if (Object.keys(extensions).length) state.extensions = extensions;
  if (raw.futurePayload) state.futurePayload = historyClone(raw.futurePayload);
  return state;
}
function historyDocumentPayload(){
  if (!historyState) return null;
  if (historyPending && !historySuspended) historyFinalizePendingTransaction();
  const payload = {
    ...(historyState.extensions || {}),
    schemaVersion:HISTORY_SCHEMA_VERSION,
    storage:"hybrid",
    documentId:historyState.documentId,
    sequence:historyState.sequence,
    createdAt:historyState.createdAt,
    checkpoints:historyClone(historyState.checkpoints),
    transactions:historyClone(historyState.transactions.slice(-HISTORY_TRANSACTION_LIMIT))
  };
  if (historyState.futurePayload) payload.futurePayload = historyClone(historyState.futurePayload);
  return payload;
}
function historyAdoptDocument(raw, opts = {}){
  historyFinalizePendingTransaction();
  historyState = historyNormalizeEmbedded(raw);
  historyLocal = historyReadLocal(historyState.documentId);
  historyState.sequence = Math.max(historyState.sequence,
    ...historyState.checkpoints.map(record => Number(record.sequence) || 0),
    ...historyState.transactions.map(record => Number(record.sequence) || 0),
    ...historyLocal.automatic.map(record => Number(record.sequence) || 0));
  historyLocal.retention = {
    maxAutomatic:historyPreferences.maxAutomatic,
    maxAgeDays:historyPreferences.maxAgeDays
  };
  historyCommittedSnapshot = historyModelSnapshot();
  historySelectedId = HISTORY_CURRENT_ID;
  historyCompare = {from:HISTORY_CURRENT_ID,to:HISTORY_CURRENT_ID,result:null};
  if (!historyLocal.automatic.length){
    historyAddAutomatic({
      type:opts.imported ? "imported" : "automatic",
      label:opts.imported ? `Imported ${opts.name || "document"}` : "Opened document",
      snapshot:historyCommittedSnapshot,
      summary:{added:0,removed:0,changed:0,moved:0,relinked:0}
    });
  } else historyWriteLocal();
  if (historyPanelOpen) renderHistoryPanel();
  return historyState;
}
function historyResetForNewDocument(){
  historyFinalizePendingTransaction();
  historyState = historyDefaultState();
  historyLocal = historyDefaultLocal(historyState.documentId);
  historyCommittedSnapshot = historyModelSnapshot();
  historySelectedId = HISTORY_CURRENT_ID;
  historyCompare = {from:HISTORY_CURRENT_ID,to:HISTORY_CURRENT_ID,result:null};
  historyAddAutomatic({
    type:"automatic", label:"New document", snapshot:historyCommittedSnapshot,
    summary:{added:0,removed:0,changed:0,moved:0,relinked:0}
  });
  if (historyPanelOpen) renderHistoryPanel();
}
function initializeHistory(){
  historyReadPreferences();
  if (!historyState) historyResetForNewDocument();
  if (!historyUiInitialized){
    document.addEventListener("schematic:command-executed", historyCommandExecuted);
    historyUiInitialized = true;
  }
}

function historyPickFields(object, fields){
  const out = {};
  for (const field of fields) if (object && object[field] !== undefined) out[field] = object[field];
  return out;
}
function historyFieldChanged(before, after, fields){
  return !historyEqual(historyPickFields(before,fields),historyPickFields(after,fields));
}
function historyDiffItem(changeType, category, kind, objectId, label, before, after, extra = {}){
  return {
    id:`${changeType}:${kind}:${objectId}:${category}`,
    changeType, category, kind, objectId, label,
    before:historyClone(before),
    after:historyClone(after),
    ...extra
  };
}
function historyDiffSnapshots(before, after){
  const left = before || {nodes:[],edges:[]};
  const right = after || {nodes:[],edges:[]};
  const items = [];
  const changedObjects = new Set();
  const movedObjects = new Set();
  const relinkedObjects = new Set();
  let added = 0, removed = 0;

  const compareCollection = (kind, leftItems, rightItems) => {
    const leftMap = new Map((leftItems || []).map(object => [object.id,object]));
    const rightMap = new Map((rightItems || []).map(object => [object.id,object]));
    const ids = [...new Set([...leftMap.keys(),...rightMap.keys()])].sort();
    for (const id of ids){
      const a = leftMap.get(id), b = rightMap.get(id);
      if (!a){
        added += 1;
        items.push(historyDiffItem("added","object",kind,id,historyObjectLabel(b,kind),null,b));
        continue;
      }
      if (!b){
        removed += 1;
        items.push(historyDiffItem("removed","object",kind,id,historyObjectLabel(a,kind),a,null));
        continue;
      }
      const label = historyObjectLabel(b,historyObjectLabel(a,kind));
      if (kind === "node"){
        const groups = [
          ["moved","geometry",HISTORY_CHANGE_FIELDS.geometry],
          ["resized","size",HISTORY_CHANGE_FIELDS.size],
          ["changed","content",HISTORY_CHANGE_FIELDS.content],
          ["changed","table",HISTORY_CHANGE_FIELDS.table],
          ["changed","ports",HISTORY_CHANGE_FIELDS.ports],
          ["changed","style",HISTORY_CHANGE_FIELDS.style],
          ["changed","metadata",HISTORY_CHANGE_FIELDS.metadata]
        ];
        for (const [changeType,category,fields] of groups){
          if (!historyFieldChanged(a,b,fields)) continue;
          items.push(historyDiffItem(changeType,category,kind,id,label,
            historyPickFields(a,fields),historyPickFields(b,fields)));
          changedObjects.add(`${kind}:${id}`);
          if (changeType === "moved") movedObjects.add(`${kind}:${id}`);
        }
        const known = new Set(["id","type",...groups.flatMap(group => group[2])]);
        const remainderA = {}, remainderB = {};
        for (const [key,value] of Object.entries(a)) if (!known.has(key)) remainderA[key] = value;
        for (const [key,value] of Object.entries(b)) if (!known.has(key)) remainderB[key] = value;
        if (!historyEqual(remainderA,remainderB)){
          items.push(historyDiffItem("changed","other",kind,id,label,remainderA,remainderB));
          changedObjects.add(`${kind}:${id}`);
        }
      } else {
        const groups = [
          ["relinked","endpoints",HISTORY_CHANGE_FIELDS.endpoints],
          ["changed","route",HISTORY_CHANGE_FIELDS.route],
          ["changed","content",HISTORY_CHANGE_FIELDS.edgeContent],
          ["changed","style",HISTORY_CHANGE_FIELDS.edgeStyle],
          ["changed","metadata",HISTORY_CHANGE_FIELDS.metadata]
        ];
        for (const [changeType,category,fields] of groups){
          if (!historyFieldChanged(a,b,fields)) continue;
          items.push(historyDiffItem(changeType,category,kind,id,label,
            historyPickFields(a,fields),historyPickFields(b,fields)));
          changedObjects.add(`${kind}:${id}`);
          if (changeType === "relinked") relinkedObjects.add(`${kind}:${id}`);
        }
        const known = new Set(["id",...groups.flatMap(group => group[2])]);
        const remainderA = {}, remainderB = {};
        for (const [key,value] of Object.entries(a)) if (!known.has(key)) remainderA[key] = value;
        for (const [key,value] of Object.entries(b)) if (!known.has(key)) remainderB[key] = value;
        if (!historyEqual(remainderA,remainderB)){
          items.push(historyDiffItem("changed","other",kind,id,label,remainderA,remainderB));
          changedObjects.add(`${kind}:${id}`);
        }
      }
    }
  };
  compareCollection("node",left.nodes,right.nodes);
  compareCollection("edge",left.edges,right.edges);
  for (const section of ["organization","metadata","styles","formatting","editing","meta"]){
    if (!historyEqual(left[section],right[section])){
      items.push(historyDiffItem("changed",section,"document",section,
        section[0].toUpperCase()+section.slice(1),left[section],right[section]));
      changedObjects.add(`document:${section}`);
    }
  }
  items.sort((a,b) =>
    ["added","removed","relinked","moved","resized","changed"].indexOf(a.changeType) -
    ["added","removed","relinked","moved","resized","changed"].indexOf(b.changeType) ||
    a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
  return {
    items,
    summary:{
      added,
      removed,
      changed:changedObjects.size,
      moved:movedObjects.size,
      relinked:relinkedObjects.size
    }
  };
}
function historySummaryText(summary){
  const s = summary || {};
  return `${s.added || 0} added · ${s.removed || 0} removed · ${s.changed || 0} changed · ` +
    `${s.moved || 0} moved · ${s.relinked || 0} relinked`;
}
function historyOperationsFromDiff(diff){
  return diff.items.map(item => ({
    kind:item.changeType,
    category:item.category,
    objectKind:item.kind,
    objectId:item.objectId,
    before:item.before,
    after:item.after
  }));
}
function historyLatestVersion(){
  const versions = historyAllVersions(false);
  return versions[0] || null;
}
function historyAddAutomatic(opts = {}){
  if (!historyState || !historyLocal) return null;
  const snapshot = historyClone(opts.snapshot || historyModelSnapshot());
  const checksum = historySnapshotChecksum(snapshot);
  const previous = historyLocal.automatic[historyLocal.automatic.length - 1];
  if (previous && previous.checksum === checksum && opts.force !== true) return previous;
  const sequence = Number(opts.sequence) || ++historyState.sequence;
  const record = {
    id:historyId("auto"),
    type:opts.type || "automatic",
    name:String(opts.label || "Automatic snapshot").slice(0,120),
    description:String(opts.description || "").slice(0,500),
    timestamp:historyNow(),
    sequence,
    author:historyPreferences.author || "",
    pinned:false,
    summary:historyClone(opts.summary || {added:0,removed:0,changed:0,moved:0,relinked:0}),
    checksum,
    snapshot
  };
  historyLocal.automatic.push(record);
  historyWriteLocal();
  return record;
}
function historyCreateCheckpoint(name, description = "", opts = {}){
  historyFinalizePendingTransaction();
  const cleanName = String(name || "").trim().slice(0,80);
  if (!cleanName) throw new Error("Checkpoint name is required.");
  const snapshot = historyModelSnapshot();
  const previous = historyLatestVersion();
  const diff = previous ? historyDiffSnapshots(previous.snapshot,snapshot)
    : {summary:{added:0,removed:0,changed:0,moved:0,relinked:0}};
  const checkpoint = {
    id:historyId("checkpoint"),
    type:opts.type || "named",
    name:cleanName,
    description:String(description || "").trim().slice(0,500),
    timestamp:historyNow(),
    sequence:++historyState.sequence,
    author:String(opts.author != null ? opts.author : historyPreferences.author || "").slice(0,80),
    pinned:opts.pinned !== false,
    summary:historyClone(diff.summary),
    checksum:historySnapshotChecksum(snapshot),
    transactionSequence:historyState.transactions.length
      ? historyState.transactions[historyState.transactions.length - 1].sequence : 0,
    snapshot
  };
  historyState.checkpoints.push(checkpoint);
  setDocDirty(true);
  if (historyPanelOpen){
    historySelectedId = checkpoint.id;
    renderHistoryPanel();
  }
  announce(`Created checkpoint ${checkpoint.name}.`);
  return checkpoint;
}
function historyRecordTransaction(before, after, meta = {}){
  if (!historyState || historySuspended) return null;
  const diff = historyDiffSnapshots(before,after);
  if (!diff.items.length){
    historyCommittedSnapshot = historyClone(after);
    return null;
  }
  const sequence = ++historyState.sequence;
  const transaction = {
    id:historyId("txn"),
    parentVersionId:(historyLatestVersion() || {}).id || null,
    documentId:historyState.documentId,
    timestamp:historyNow(),
    sequence,
    commandId:String(meta.commandId || meta.coalesceKey || "edit"),
    label:String(meta.label || "Edit document").slice(0,120),
    origin:String(meta.origin || "user"),
    actor:historyPreferences.author || "",
    scope:String(meta.scope || "document"),
    mutationKind:String(meta.mutationKind || "model"),
    coalesceKey:meta.coalesceKey == null ? null : String(meta.coalesceKey),
    undoGroup:String(meta.undoGroup || meta.coalesceKey || meta.commandId || "edit"),
    batchId:meta.batchId == null ? null : String(meta.batchId),
    causalTransactionId:meta.causalTransactionId == null ? null : String(meta.causalTransactionId),
    schemaVersion:HISTORY_SCHEMA_VERSION,
    applicationVersion:APP_VERSION,
    storage:"portable-transaction-log",
    affectedIds:[...new Set(diff.items.filter(item => item.kind !== "document")
      .map(item => item.objectId))].sort(),
    operations:historyOperationsFromDiff(diff),
    summary:historyClone(diff.summary),
    beforeChecksum:historySnapshotChecksum(before),
    afterChecksum:historySnapshotChecksum(after)
  };
  transaction.checksum = historyChecksum({...transaction,checksum:undefined});
  historyState.transactions.push(transaction);
  if (historyState.transactions.length > HISTORY_TRANSACTION_LIMIT)
    historyState.transactions.splice(0,historyState.transactions.length - HISTORY_TRANSACTION_LIMIT);
  const automaticType = ["restore","partial-restore"].includes(transaction.origin)
    ? "restored" : transaction.origin === "import" ? "imported"
    : diff.items.length > 20 ? "major" : "automatic";
  historyAddAutomatic({
    sequence,
    type:automaticType,
    label:transaction.label,
    snapshot:after,
    summary:diff.summary
  });
  historyCommittedSnapshot = historyClone(after);
  if (typeof styleInvalidateTransaction === "function")
    styleInvalidateTransaction(transaction);
  if (typeof formattingInvalidateTransaction === "function")
    formattingInvalidateTransaction(transaction);
  if (historyPanelOpen) renderHistoryPanel();
  return transaction;
}
function historyBeginTransaction(coalesceKey){
  if (historySuspended || !historyState) return;
  const key = coalesceKey == null ? null : String(coalesceKey);
  if (historyPending){
    if (key != null && historyPending.coalesceKey === key){
      clearTimeout(historyPendingTimer);
      historyPendingTimer = setTimeout(historyFinalizePendingTransaction,1300);
      return historyPending;
    }
    historyFinalizePendingTransaction();
  }
  historyPending = {
    before:historyModelSnapshot(),
    coalesceKey:key,
    startedAt:historyNow(),
    commandId:key || "edit",
    label:key ? "Edit properties" : "Edit document",
    origin:"user",
    scope:"document",
    mutationKind:"model"
  };
  historyPendingTimer = setTimeout(historyFinalizePendingTransaction,key ? 1300 : 400);
  return historyPending;
}
function historySetPendingMeta(meta = {}){
  if (!historyPending) return false;
  Object.assign(historyPending,meta);
  return true;
}
function historyFinalizePendingTransaction(meta = {}){
  if (!historyPending || historySuspended) return null;
  clearTimeout(historyPendingTimer);
  historyPendingTimer = null;
  const pending = historyPending;
  historyPending = null;
  const after = historyModelSnapshot();
  return historyRecordTransaction(pending.before,after,{...pending,...meta});
}
function historyRecordImmediateTransaction(before, meta = {}){
  if (!before || historySuspended) return null;
  historyPending = null;
  clearTimeout(historyPendingTimer);
  historyPendingTimer = null;
  return historyRecordTransaction(before,historyModelSnapshot(),meta);
}
function historyCommandExecuted(event){
  const detail = event && event.detail || {};
  if (!detail.mutatesDocument || historySuspended) return;
  const meta = {
    commandId:detail.transaction || detail.id || "command",
    label:detail.label || detail.id || "Command",
    scope:detail.scope || "document",
    mutationKind:detail.mutationKind || "model",
    origin:"user"
  };
  if (historyPending){
    historySetPendingMeta(meta);
    historyFinalizePendingTransaction();
  } else if (historyCommittedSnapshot){
    historyRecordImmediateTransaction(historyCommittedSnapshot,meta);
  }
}

function historyAllVersions(includeCurrent = true){
  const versions = [
    ...(historyState ? historyState.checkpoints : []),
    ...(historyLocal ? historyLocal.automatic : [])
  ].filter(historyRecordValid)
    .sort((a,b) => (b.sequence || 0) - (a.sequence || 0) || (b.timestamp || 0) - (a.timestamp || 0));
  if (includeCurrent){
    const snapshot = historyModelSnapshot();
    versions.unshift({
      id:HISTORY_CURRENT_ID,
      type:"current",
      name:"Current document",
      description:"The live editable state",
      timestamp:historyNow(),
      sequence:(historyState && historyState.sequence || 0) + 1,
      pinned:false,
      summary:{added:0,removed:0,changed:0,moved:0,relinked:0},
      checksum:historySnapshotChecksum(snapshot),
      snapshot
    });
  }
  return versions;
}
function historyVersion(id){
  if (id === HISTORY_CURRENT_ID){
    const snapshot = historyModelSnapshot();
    return {
      id:HISTORY_CURRENT_ID,type:"current",name:"Current document",description:"The live editable state",
      timestamp:historyNow(),sequence:(historyState && historyState.sequence || 0) + 1,
      snapshot,checksum:historySnapshotChecksum(snapshot),
      summary:{added:0,removed:0,changed:0,moved:0,relinked:0}
    };
  }
  return historyAllVersions(false).find(version => version.id === id) || null;
}
function historyTogglePin(id){
  const portable = historyState.checkpoints.find(record => record.id === id);
  if (portable){
    portable.pinned = !portable.pinned;
    setDocDirty(true);
    renderHistoryPanel();
    return portable;
  }
  const automaticIndex = historyLocal.automatic.findIndex(record => record.id === id);
  if (automaticIndex < 0) return null;
  const automatic = historyLocal.automatic[automaticIndex];
  const checkpoint = {
    ...historyClone(automatic),
    id:historyId("checkpoint"),
    type:"named",
    name:`Pinned: ${automatic.name}`,
    pinned:true,
    sourceType:automatic.type
  };
  historyState.checkpoints.push(checkpoint);
  historyLocal.automatic.splice(automaticIndex,1);
  historyWriteLocal();
  historySelectedId = checkpoint.id;
  setDocDirty(true);
  renderHistoryPanel();
  return checkpoint;
}
function historyCompareVersions(fromId, toId){
  const from = historyVersion(fromId);
  const to = historyVersion(toId);
  if (!from || !to) return null;
  const result = historyDiffSnapshots(from.snapshot,to.snapshot);
  result.from = from;
  result.to = to;
  return result;
}

function historyNodeBounds(node){
  try {
    const rect = nodeRect(node);
    if (rect && [rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)) return rect;
  } catch {}
  return {
    x:Number(node && node.x) || 0,
    y:Number(node && node.y) || 0,
    w:Math.max(40,Number(node && node.w) || 150),
    h:Math.max(28,Number(node && node.h) || 56)
  };
}
function historySnapshotBounds(snapshot, extraNodes = []){
  const rects = [...(snapshot.nodes || []),...extraNodes].map(historyNodeBounds);
  if (!rects.length) return {x:-50,y:-50,w:100,h:100};
  const minX = Math.min(...rects.map(r => r.x));
  const minY = Math.min(...rects.map(r => r.y));
  const maxX = Math.max(...rects.map(r => r.x+r.w));
  const maxY = Math.max(...rects.map(r => r.y+r.h));
  const pad = 40;
  return {x:minX-pad,y:minY-pad,w:Math.max(100,maxX-minX+pad*2),h:Math.max(100,maxY-minY+pad*2)};
}
function historySvgElement(tag,attrs = {},parent){
  const element = document.createElementNS(SVGNS,tag);
  for (const [key,value] of Object.entries(attrs)) if (value != null) element.setAttribute(key,String(value));
  if (parent) parent.appendChild(element);
  return element;
}
function historyRenderPreview(snapshot, diff = null, activeItem = null){
  const svg = document.getElementById("historyPreview");
  const outline = document.getElementById("historyObjectOutline");
  if (!svg || !outline) return;
  svg.innerHTML = "";
  outline.innerHTML = "";
  const removedNodes = diff ? diff.items
    .filter(item => item.kind === "node" && item.changeType === "removed" && item.before)
    .map(item => item.before) : [];
  const bounds = historySnapshotBounds(snapshot,removedNodes);
  svg.setAttribute("viewBox",`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  svg.dataset.historyFullViewBox = `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`;
  const defs = historySvgElement("defs",{},svg);
  const pattern = historySvgElement("pattern",{id:"historyChangedHatch",width:8,height:8,
    patternUnits:"userSpaceOnUse",patternTransform:"rotate(45)"},defs);
  historySvgElement("line",{x1:0,y1:0,x2:0,y2:8,stroke:"currentColor","stroke-width":2},pattern);
  const changedById = new Map();
  if (diff) for (const item of diff.items){
    if (!changedById.has(`${item.kind}:${item.objectId}`))
      changedById.set(`${item.kind}:${item.objectId}`,[]);
    changedById.get(`${item.kind}:${item.objectId}`).push(item);
  }
  const nodeMap = new Map((snapshot.nodes || []).map(node => [node.id,node]));
  for (const edge of snapshot.edges || []){
    const a = nodeMap.get(edge.from), b = nodeMap.get(edge.to);
    if (!a || !b) continue;
    const ar = historyNodeBounds(a), br = historyNodeBounds(b);
    const changes = changedById.get(`edge:${edge.id}`) || [];
    const className = changes.some(item => item.changeType === "added") ? "history-preview-added"
      : changes.length ? "history-preview-changed" : "";
    const line = historySvgElement("line",{
      x1:ar.x+ar.w/2,y1:ar.y+ar.h/2,x2:br.x+br.w/2,y2:br.y+br.h/2,
      class:`history-preview-edge ${className}`,
      "data-history-object":edge.id
    },svg);
    historySvgElement("title",{},line).textContent =
      `${historyObjectLabel(edge,"Relationship")}${changes.length ? `, ${changes.map(c=>c.changeType).join(", ")}` : ""}`;
  }
  const drawNode = (node,removed = false) => {
    const rect = historyNodeBounds(node);
    const changes = removed ? [{changeType:"removed"}] : changedById.get(`node:${node.id}`) || [];
    const change = removed ? "removed" : changes.some(item => item.changeType === "added") ? "added"
      : changes.length ? "changed" : "";
    const group = historySvgElement("g",{
      class:`history-preview-node ${change ? `history-preview-${change}` : ""}` +
        `${activeItem && activeItem.objectId === node.id ? " active" : ""}`,
      "data-history-object":node.id
    },svg);
    historySvgElement("rect",{x:rect.x,y:rect.y,width:rect.w,height:rect.h,rx:6,
      fill:removed ? "transparent" : node.color || "var(--panel)"},group);
    const symbol = change === "added" ? "+" : change === "removed" ? "−" : change === "changed" ? "Δ" : "";
    if (symbol) historySvgElement("text",{x:rect.x+8,y:rect.y+16,class:"history-preview-symbol"},group)
      .textContent = symbol;
    historySvgElement("text",{x:rect.x+rect.w/2,y:rect.y+rect.h/2,
      "text-anchor":"middle","dominant-baseline":"middle"},group)
      .textContent = historyObjectLabel(node,"Node").slice(0,42);
    historySvgElement("title",{},group).textContent =
      `${historyObjectLabel(node,"Node")}${change ? `, ${change}` : ""}`;
  };
  const previewNodes = snapshot.nodes || [];
  const structuralNodes = previewNodes.filter(node =>
    typeof isStructuralNode === "function" && isStructuralNode(node));
  const foregroundNodes = previewNodes.filter(node =>
    !(typeof isStructuralNode === "function" && isStructuralNode(node)));
  for (const node of structuralNodes) drawNode(node,false);
  for (const node of foregroundNodes) drawNode(node,false);
  const removedStructural = removedNodes.filter(node =>
    typeof isStructuralNode === "function" && isStructuralNode(node));
  const removedForeground = removedNodes.filter(node =>
    !(typeof isStructuralNode === "function" && isStructuralNode(node)));
  for (const node of [...removedStructural,...removedForeground])
    if (!nodeMap.has(node.id)) drawNode(node,true);

  const allObjects = [
    ...(snapshot.nodes || []).map(node => ({kind:"Node",id:node.id,label:historyObjectLabel(node,"Node")})),
    ...(snapshot.edges || []).map(edge => ({kind:"Relationship",id:edge.id,label:historyObjectLabel(edge,"Relationship")}))
  ];
  for (const object of allObjects){
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${object.kind}: ${object.label}`;
    button.dataset.historyLocate = object.id;
    button.addEventListener("click",() => historyLocatePreviewObject(object.id));
    li.appendChild(button);
    outline.appendChild(li);
  }
  const desc = document.getElementById("historyPreviewDescription");
  if (desc) desc.textContent = `Read-only version with ${(snapshot.nodes || []).length} nodes and ` +
    `${(snapshot.edges || []).length} relationships.` +
    (diff ? ` ${historySummaryText(diff.summary)}.` : "");
}
function historyLocatePreviewObject(objectId){
  const svg = document.getElementById("historyPreview");
  if (!svg) return false;
  svg.querySelectorAll(".active").forEach(element => element.classList.remove("active"));
  const target = [...svg.querySelectorAll("[data-history-object]")]
    .find(element => element.dataset.historyObject === objectId);
  if (!target) return false;
  target.classList.add("active");
  const shape = target.matches("line,rect") ? target : target.querySelector("rect,line");
  if (shape){
    const x1 = Number(shape.getAttribute("x") ?? shape.getAttribute("x1"));
    const y1 = Number(shape.getAttribute("y") ?? shape.getAttribute("y1"));
    const x2 = shape.hasAttribute("width") ? x1 + Number(shape.getAttribute("width"))
      : Number(shape.getAttribute("x2"));
    const y2 = shape.hasAttribute("height") ? y1 + Number(shape.getAttribute("height"))
      : Number(shape.getAttribute("y2"));
    if ([x1,y1,x2,y2].every(Number.isFinite)){
      const pad = 48;
      svg.setAttribute("viewBox",
        `${Math.min(x1,x2)-pad} ${Math.min(y1,y2)-pad} ` +
        `${Math.max(120,Math.abs(x2-x1)+pad*2)} ${Math.max(90,Math.abs(y2-y1)+pad*2)}`);
    }
  }
  target.focus?.();
  return true;
}
function historyFitPreview(){
  const svg = document.getElementById("historyPreview");
  if (!svg || !svg.dataset.historyFullViewBox) return false;
  svg.setAttribute("viewBox",svg.dataset.historyFullViewBox);
  svg.querySelectorAll(".active").forEach(element => element.classList.remove("active"));
  return true;
}
function historyChangeValue(value){
  if (value == null) return "Not set";
  const text = typeof value === "string" ? value : historyStableStringify(value);
  return text.length > 180 ? text.slice(0,177) + "…" : text;
}

function historyRenderVersionOptions(){
  const versions = historyAllVersions(true);
  for (const id of ["historyCompareFrom","historyCompareTo"]){
    const select = document.getElementById(id);
    if (!select) continue;
    const wanted = id.endsWith("From") ? historyCompare.from : historyCompare.to;
    select.innerHTML = "";
    for (const version of versions){
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = `${version.name} — ${version.id === HISTORY_CURRENT_ID ? "now" : historyFormatDate(version.timestamp)}`;
      select.appendChild(option);
    }
    select.value = versions.some(version => version.id === wanted) ? wanted : HISTORY_CURRENT_ID;
  }
}
function historyFilteredVersions(){
  const query = String(document.getElementById("historySearch")?.value || "").trim().toLowerCase();
  const type = document.getElementById("historyTypeFilter")?.value || "all";
  return historyAllVersions(true).filter(version => {
    if (type !== "all"){
      if (type === "named" && version.type !== "named") return false;
      else if (type !== "named" && version.type !== type) return false;
    }
    if (!query) return true;
    return [version.name,version.description,version.author,historyFormatDate(version.timestamp)]
      .join(" ").toLowerCase().includes(query);
  });
}
function historyRenderTimeline(){
  const list = document.getElementById("historyTimeline");
  if (!list) return;
  list.innerHTML = "";
  const versions = historyFilteredVersions();
  for (const version of versions){
    const row = document.createElement("div");
    row.className = "history-version-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-version";
    button.dataset.historyVersion = version.id;
    button.setAttribute("role","option");
    button.setAttribute("aria-selected",String(version.id === historySelectedId));
    button.innerHTML = `<span class="history-version-head"><strong></strong><em></em></span>` +
      `<span class="history-version-date"></span><span class="history-version-summary"></span>`;
    button.querySelector("strong").textContent = version.name;
    button.querySelector("em").textContent = version.type;
    button.querySelector(".history-version-date").textContent =
      version.id === HISTORY_CURRENT_ID ? "Live editable state" : historyFormatDate(version.timestamp);
    button.querySelector(".history-version-summary").textContent = historySummaryText(version.summary);
    button.addEventListener("click",() => historySelectVersion(version.id));
    row.appendChild(button);
    if (version.id !== HISTORY_CURRENT_ID){
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "history-pin";
      pin.textContent = version.pinned ? "Pinned" : "Pin";
      pin.setAttribute("aria-label",`${version.pinned ? "Unpin" : "Pin"} ${version.name}`);
      pin.setAttribute("aria-pressed",String(!!version.pinned));
      pin.addEventListener("click",() => historyTogglePin(version.id));
      row.appendChild(pin);
    }
    list.appendChild(row);
  }
  if (!versions.length){
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No versions match this filter.";
    list.appendChild(empty);
  }
}
function historySelectVersion(id){
  const version = historyVersion(id);
  if (!version) return false;
  historySelectedId = id;
  historyCompare.from = id;
  historyCompare.to = HISTORY_CURRENT_ID;
  historyActiveChange = -1;
  renderHistoryPanel();
  return true;
}
function historyRenderDiff(){
  const fromSelect = document.getElementById("historyCompareFrom");
  const toSelect = document.getElementById("historyCompareTo");
  if (fromSelect) historyCompare.from = fromSelect.value || historyCompare.from;
  if (toSelect) historyCompare.to = toSelect.value || historyCompare.to;
  historyCompare.result = historyCompareVersions(historyCompare.from,historyCompare.to);
  const diff = historyCompare.result;
  const summary = document.getElementById("historyDiffSummary");
  const list = document.getElementById("historyChangeList");
  if (!diff || !summary || !list) return;
  summary.textContent = historySummaryText(diff.summary);
  list.innerHTML = "";
  for (let index = 0; index < diff.items.length; index++){
    const item = diff.items[index];
    const row = document.createElement("div");
    row.className = "history-change";
    row.setAttribute("role","listitem");
    row.dataset.historyChangeIndex = String(index);
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = item.kind !== "document";
    check.disabled = item.kind === "document";
    check.dataset.historyRestoreObject = item.objectId;
    check.setAttribute("aria-label",`Include ${item.label} in partial restore`);
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span class="history-change-head"><strong></strong><em></em></span>` +
      `<span class="history-change-before"></span><span class="history-change-after"></span>`;
    button.querySelector("strong").textContent = item.label;
    button.querySelector("em").textContent = `${item.changeType} · ${item.category}`;
    button.querySelector(".history-change-before").textContent = `Before: ${historyChangeValue(item.before)}`;
    button.querySelector(".history-change-after").textContent = `After: ${historyChangeValue(item.after)}`;
    button.setAttribute("aria-label",
      `${item.changeType} ${item.kind} ${item.label}, ${item.category}. ` +
      `Old value ${historyChangeValue(item.before)}. New value ${historyChangeValue(item.after)}.`);
    button.addEventListener("click",() => historyActivateChange(index));
    row.append(check,button);
    list.appendChild(row);
  }
  if (!diff.items.length){
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "These versions are identical.";
    list.appendChild(empty);
  }
  if (historyActiveChange >= diff.items.length) historyActiveChange = diff.items.length - 1;
  historyUpdateChangeNavigation();
}
function historyActivateChange(index){
  const diff = historyCompare.result;
  if (!diff || !diff.items[index]) return false;
  historyActiveChange = index;
  document.querySelectorAll(".history-change.active").forEach(row => row.classList.remove("active"));
  const row = document.querySelector(`[data-history-change-index="${index}"]`);
  row?.classList.add("active");
  row?.scrollIntoView?.({block:"nearest"});
  historyLocatePreviewObject(diff.items[index].objectId);
  historyUpdateChangeNavigation();
  announce(`${diff.items[index].changeType}: ${diff.items[index].label}, ${diff.items[index].category}.`);
  return true;
}
function historyUpdateChangeNavigation(){
  const count = historyCompare.result ? historyCompare.result.items.length : 0;
  const position = document.getElementById("historyChangePosition");
  if (position) position.textContent = count && historyActiveChange >= 0
    ? `${historyActiveChange + 1} of ${count}` : count ? `${count} changes` : "No changes";
  const previous = document.getElementById("btnHistoryPreviousChange");
  const next = document.getElementById("btnHistoryNextChange");
  if (previous) previous.disabled = !count;
  if (next) next.disabled = !count;
}
function historyStepChange(delta){
  const count = historyCompare.result ? historyCompare.result.items.length : 0;
  if (!count) return false;
  const next = historyActiveChange < 0 ? (delta > 0 ? 0 : count - 1)
    : (historyActiveChange + delta + count) % count;
  return historyActivateChange(next);
}
function historyStorageSummary(){
  const localText = historyLocal ? JSON.stringify(historyLocal) : "";
  const portableText = historyState ? JSON.stringify(historyDocumentPayload()) : "";
  const automatic = historyLocal ? historyLocal.automatic.length : 0;
  const portable = historyState ? historyState.checkpoints.length : 0;
  return `${automatic} automatic · ${portable} portable · ` +
    `${historyHumanBytes(historyStorageTextBytes(localText) + historyStorageTextBytes(portableText))}`;
}
function renderHistoryPanel(){
  if (!historyPanelOpen) return;
  const selected = historyVersion(historySelectedId) || historyVersion(HISTORY_CURRENT_ID);
  historyRenderTimeline();
  historyRenderVersionOptions();
  const fromSelect = document.getElementById("historyCompareFrom");
  const toSelect = document.getElementById("historyCompareTo");
  if (fromSelect) fromSelect.value = historyCompare.from;
  if (toSelect) toSelect.value = historyCompare.to;
  historyRenderDiff();
  const previewVersion = historyCompare.result ? historyCompare.result.to : selected;
  const previewSnapshot = previewVersion.snapshot;
  const active = historyCompare.result && historyCompare.result.items[historyActiveChange];
  historyRenderPreview(previewSnapshot,historyCompare.result,active);
  const title = document.getElementById("historyPreviewTitle");
  if (title) title.textContent = historyCompare.result &&
    historyCompare.result.from.id !== historyCompare.result.to.id
    ? `${previewVersion.name} compared with ${historyCompare.result.from.name}`
    : previewVersion.name;
  const meta = document.getElementById("historySelectedMeta");
  if (meta) meta.textContent = `${selected.name}${selected.author ? ` · ${selected.author}` : ""}` +
    `${selected.id === HISTORY_CURRENT_ID ? "" : ` · ${historyFormatDate(selected.timestamp)}`}`;
  const description = document.getElementById("historySelectedDescription");
  if (description) description.textContent = selected.description || historySummaryText(selected.summary);
  const storage = document.getElementById("historyStorageStatus");
  if (storage){
    storage.textContent = `${historyStorageSummary()}${historyStorageStatus.message ? ` · ${historyStorageStatus.message}` : ""}`;
    storage.classList.toggle("warning",!historyStorageStatus.ok);
  }
  const restoreAll = document.getElementById("btnHistoryRestoreAll");
  const restoreSelected = document.getElementById("btnHistoryRestoreSelected");
  if (restoreAll) restoreAll.disabled = selected.id === HISTORY_CURRENT_ID;
  if (restoreSelected) restoreSelected.disabled = selected.id === HISTORY_CURRENT_ID ||
    !(historyCompare.result && historyCompare.result.items.some(item => item.kind !== "document"));
  const duplicate = document.getElementById("btnHistoryDuplicate");
  if (duplicate) duplicate.disabled = selected.id === HISTORY_CURRENT_ID;
}
function openHistoryPanel(opts = {}){
  const panel = document.getElementById("historyPanel");
  if (!panel) return false;
  historyFinalizePendingTransaction();
  if (!historyPanelOpen && document.activeElement instanceof HTMLElement)
    historyPanelReturnFocus = document.activeElement;
  historyPanelOpen = true;
  panel.hidden = false;
  panel.classList.add("open");
  if (opts.versionId && historyVersion(opts.versionId)){
    historySelectedId = opts.versionId;
    historyCompare = {from:opts.versionId,to:HISTORY_CURRENT_ID,result:null};
    historyActiveChange = -1;
  }
  renderHistoryPanel();
  requestAnimationFrame(() => {
    if (opts.compose) historyShowSheet("historyComposer");
    else panel.querySelector(".history-version[aria-selected=true],#btnHistoryNewCheckpoint")?.focus();
  });
  return true;
}
function closeHistoryPanel(){
  historyPanelOpen = false;
  const panel = document.getElementById("historyPanel");
  if (panel){ panel.classList.remove("open"); panel.hidden = true; }
  historyHideSheets();
  historyPanelReturnFocus?.focus?.();
  historyPanelReturnFocus = null;
}
function historyHideSheets(){
  document.querySelectorAll("#historyPanel .history-sheet").forEach(sheet => { sheet.hidden = true; });
}
function historyShowSheet(id){
  historyHideSheets();
  const sheet = document.getElementById(id);
  if (!sheet) return false;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.querySelector("input,select,textarea,button")?.focus());
  return true;
}
function openCheckpointComposer(){
  openHistoryPanel({compose:true});
  const name = document.getElementById("historyCheckpointName");
  const description = document.getElementById("historyCheckpointDescription");
  const pinned = document.getElementById("historyCheckpointPinned");
  const error = document.getElementById("historyComposerError");
  if (name) name.value = "";
  if (description) description.value = "";
  if (pinned) pinned.checked = true;
  if (error) error.textContent = "";
  return true;
}
function historySubmitCheckpoint(){
  const name = document.getElementById("historyCheckpointName");
  const description = document.getElementById("historyCheckpointDescription");
  const pinned = document.getElementById("historyCheckpointPinned");
  const error = document.getElementById("historyComposerError");
  try {
    const checkpoint = historyCreateCheckpoint(name?.value,description?.value,{pinned:pinned?.checked !== false});
    historySelectedId = checkpoint.id;
    historyCompare = {from:checkpoint.id,to:HISTORY_CURRENT_ID,result:null};
    historyHideSheets();
    renderHistoryPanel();
    return checkpoint;
  } catch(err){
    if (error) error.textContent = err.message || "Could not create checkpoint.";
    name?.focus();
    return null;
  }
}
function historyOpenSettings(){
  document.getElementById("historyAuthor").value = historyPreferences.author || "";
  document.getElementById("historyRetentionCount").value = historyPreferences.maxAutomatic;
  document.getElementById("historyRetentionDays").value = historyPreferences.maxAgeDays;
  historyShowSheet("historySettings");
}
function historySaveSettings(){
  historyPreferences = {
    author:String(document.getElementById("historyAuthor")?.value || "").trim().slice(0,80),
    maxAutomatic:Math.max(10,Math.min(500,
      Number(document.getElementById("historyRetentionCount")?.value) || HISTORY_DEFAULT_RETENTION.maxAutomatic)),
    maxAgeDays:Math.max(1,Math.min(365,
      Number(document.getElementById("historyRetentionDays")?.value) || HISTORY_DEFAULT_RETENTION.maxAgeDays))
  };
  historyLocal.retention = {
    maxAutomatic:historyPreferences.maxAutomatic,
    maxAgeDays:historyPreferences.maxAgeDays
  };
  historyWritePreferences();
  historyWriteLocal();
  historyHideSheets();
  renderHistoryPanel();
}
function historyClearAutomatic(){
  if (!confirm(`Remove ${historyLocal.automatic.length} automatic version(s) from this device? ` +
    "Named and pinned checkpoints will remain in the document.")) return false;
  historyLocal.automatic = [];
  historyWriteLocal();
  historyAddAutomatic({
    type:"automatic",label:"Current document after cleanup",snapshot:historyModelSnapshot(),
    summary:{added:0,removed:0,changed:0,moved:0,relinked:0},force:true
  });
  renderHistoryPanel();
  return true;
}
function historyRestoreWhole(id = historySelectedId){
  const version = historyVersion(id);
  if (!version || version.id === HISTORY_CURRENT_ID) return false;
  const current = historyModelSnapshot();
  const diff = historyDiffSnapshots(current,version.snapshot);
  if (!confirm(`Restore "${version.name}" as the current document?\n\n${historySummaryText(diff.summary)}\n\n` +
    "A pinned safety checkpoint will be created first, and earlier history will remain.")) return false;
  historyCreateCheckpoint(`Before restoring ${version.name}`,
    `Automatic safety checkpoint created before restoring ${version.name}.`,
    {type:"pre-restore",pinned:true});
  historyBeginTransaction("history-full-restore");
  historySetPendingMeta({commandId:"historyRestore",label:`Restore ${version.name}`,origin:"restore"});
  pushHistory("history-full-restore");
  historySuspended += 1;
  try {
    applyDocument(historyClone(version.snapshot),{resetHistory:false,preserveVersionHistory:true});
  } finally {
    historySuspended -= 1;
  }
  setDocDirty(true);
  historyFinalizePendingTransaction({commandId:"historyRestore",label:`Restore ${version.name}`,origin:"restore"});
  historySelectedId = HISTORY_CURRENT_ID;
  historyCompare = {from:version.id,to:HISTORY_CURRENT_ID,result:null};
  renderHistoryPanel();
  announce(`Restored ${version.name}.`);
  return true;
}

function historyPlanPartialRestore(source, ids){
  const current = historyModelSnapshot();
  const wanted = new Set(ids);
  const sourceNodes = new Map((source.nodes || []).map(node => [node.id,node]));
  const sourceEdges = new Map((source.edges || []).map(edge => [edge.id,edge]));
  const currentNodes = new Map((current.nodes || []).map(node => [node.id,node]));
  const currentEdges = new Map((current.edges || []).map(edge => [edge.id,edge]));
  const sourceGroups = new Map(((source.organization && source.organization.groups) || [])
    .map(group => [group.id,group]));
  const currentGroups = new Map(((current.organization && current.organization.groups) || [])
    .map(group => [group.id,group]));
  const sourceLayers = new Map(((source.organization && source.organization.layers) || [])
    .map(layer => [layer.id,layer]));
  const currentLayers = new Map(((current.organization && current.organization.layers) || [])
    .map(layer => [layer.id,layer]));
  const currentTypeIds = new Set([
    ...(((current.metadata && current.metadata.objectTypes) || []).map(type => type.id)),
    ...(((current.metadata && current.metadata.relationshipTypes) || []).map(type => type.id))
  ]);
  const items = [];
  const addItem = item => {
    if (!items.some(existing => existing.key === item.key)) items.push(item);
  };
  for (const id of wanted){
    if (sourceNodes.has(id)){
      const sourceNode = sourceNodes.get(id);
      const target = currentNodes.get(id);
      const collision = currentEdges.has(id);
      const missingType = sourceNode.semanticTypeId && !currentTypeIds.has(sourceNode.semanticTypeId);
      const externallyControlled = !!(target && (target.sourceControlled ||
        String(target.sourceAuthority || "").toLowerCase() === "external"));
      const nodeStatus = collision ? "identity-conflict" : externallyControlled ? "externally-controlled"
        : missingType ? "schema-conflict" : target && target.type !== sourceNode.type
        ? "type-conflict" : target ? "replace" : "add";
      addItem({
        key:`node:${id}`,kind:"node",id,label:historyObjectLabel(sourceNode,"Node"),
        source:historyClone(sourceNode),
        status:nodeStatus,
        resolution:["identity-conflict","externally-controlled","schema-conflict","type-conflict"]
          .includes(nodeStatus) ? "skip" : target ? "replace" : "add",
        selected:!["identity-conflict","externally-controlled","schema-conflict","type-conflict"]
          .includes(nodeStatus),
        required:false,
        reason:externallyControlled ? "Current object is externally controlled"
          : missingType ? `Missing semantic type ${sourceNode.semanticTypeId}` : ""
      });
      const addOrganizationDependency = (kind,record) => {
        if (!record) return;
        addItem({
          key:`${kind}:${record.id}`,kind,id:record.id,label:record.name || record.id,
          source:historyClone(record),status:"dependency",resolution:"add",selected:true,required:false,
          reason:`Required ${kind} for ${historyObjectLabel(sourceNode,"node")}`
        });
      };
      if (sourceNode.layerId && !currentLayers.has(sourceNode.layerId))
        addOrganizationDependency("layer",sourceLayers.get(sourceNode.layerId));
      if (sourceNode.groupId && !currentGroups.has(sourceNode.groupId)){
        let group = sourceGroups.get(sourceNode.groupId);
        const seenGroups = new Set();
        while (group && !seenGroups.has(group.id)){
          seenGroups.add(group.id);
          addOrganizationDependency("group",group);
          if (group.layerId && !currentLayers.has(group.layerId))
            addOrganizationDependency("layer",sourceLayers.get(group.layerId));
          group = group.parentGroupId && !currentGroups.has(group.parentGroupId)
            ? sourceGroups.get(group.parentGroupId) : null;
        }
      }
      for (const edge of source.edges || []){
        if (edge.from !== id && edge.to !== id) continue;
        if (currentEdges.has(edge.id)) continue;
        const otherId = edge.from === id ? edge.to : edge.from;
        const endpointsAvailable = sourceNodes.has(otherId) || currentNodes.has(otherId);
        addItem({
          key:`edge:${edge.id}`,kind:"edge",id:edge.id,label:historyObjectLabel(edge,"Relationship"),
          source:historyClone(edge),status:endpointsAvailable ? "dependency" : "missing-dependency",
          resolution:endpointsAvailable ? "add" : "skip",selected:endpointsAvailable,required:false,
          reason:`Relationship attached to ${historyObjectLabel(sourceNode,"node")}`
        });
      }
    } else if (sourceEdges.has(id)){
      const sourceEdge = sourceEdges.get(id);
      const target = currentEdges.get(id);
      const collision = currentNodes.has(id);
      for (const endpointId of [sourceEdge.from,sourceEdge.to]){
        if (currentNodes.has(endpointId)) continue;
        const endpoint = sourceNodes.get(endpointId);
        if (endpoint) addItem({
          key:`node:${endpointId}`,kind:"node",id:endpointId,label:historyObjectLabel(endpoint,"Node"),
          source:historyClone(endpoint),status:"dependency",resolution:"add",selected:true,required:true,
          reason:`Required endpoint for ${historyObjectLabel(sourceEdge,"relationship")}`
        });
      }
      const endpointsAvailable = [sourceEdge.from,sourceEdge.to]
        .every(endpointId => currentNodes.has(endpointId) || sourceNodes.has(endpointId));
      const sourceEndpoint = side => wanted.has(sourceEdge[side])
        ? sourceNodes.get(sourceEdge[side])
        : currentNodes.get(sourceEdge[side]) || sourceNodes.get(sourceEdge[side]);
      const portAvailable = (node,portId,portSide) => {
        if (!portId || !node) return true;
        const key = portSide === "from" ? "outputPorts" : "inputPorts";
        return Array.isArray(node[key]) && node[key].some(port => port.id === portId);
      };
      const missingPort = !portAvailable(sourceEndpoint("from"),sourceEdge.fromPort,"from") ||
        !portAvailable(sourceEndpoint("to"),sourceEdge.toPort,"to");
      const edgeStatus = collision ? "identity-conflict" : !endpointsAvailable ? "missing-dependency"
        : missingPort ? "port-conflict" : target ? "replace" : "add";
      addItem({
        key:`edge:${id}`,kind:"edge",id,label:historyObjectLabel(sourceEdge,"Relationship"),
        source:historyClone(sourceEdge),
        status:edgeStatus,
        resolution:["identity-conflict","missing-dependency","port-conflict"].includes(edgeStatus)
          ? "skip" : target ? "replace" : "add",
        selected:!["identity-conflict","missing-dependency","port-conflict"].includes(edgeStatus),
        required:false,
        reason:missingPort ? "A named endpoint port no longer exists" : ""
      });
    } else addItem({
      key:`missing:${id}`,kind:"unknown",id,label:id,status:"not-in-version",
      resolution:"skip",selected:false,required:false
    });
  }
  return {
    source:historyClone(source),
    current,
    items,
    selectedIds:[...wanted],
    conflicts:items.filter(item => item.status.includes("conflict") ||
      ["missing-dependency","externally-controlled"].includes(item.status)).length
  };
}
function historyCheckedRestoreIds(){
  return [...document.querySelectorAll("#historyChangeList [data-history-restore-object]:checked")]
    .map(input => input.dataset.historyRestoreObject).filter(Boolean);
}
function historyOpenPartialRestore(){
  const version = historyVersion(historySelectedId);
  if (!version || version.id === HISTORY_CURRENT_ID) return false;
  const ids = historyCheckedRestoreIds();
  if (!ids.length && historyCompare.result && historyCompare.result.items[historyActiveChange])
    ids.push(historyCompare.result.items[historyActiveChange].objectId);
  if (!ids.length){
    announce("Select at least one changed object to restore.");
    return false;
  }
  historyRestorePlan = historyPlanPartialRestore(version.snapshot,ids);
  const summary = document.getElementById("historyRestoreSummary");
  const list = document.getElementById("historyRestorePlan");
  if (summary) summary.textContent =
    `${historyRestorePlan.items.length} object or dependency candidate(s); ` +
    `${historyRestorePlan.conflicts} require attention. Unrelated current objects will not be changed.`;
  if (list){
    list.innerHTML = "";
    for (const item of historyRestorePlan.items){
      const row = document.createElement("div");
      row.className = "history-restore-row";
      row.dataset.historyRestoreKey = item.key;
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = item.selected;
      check.disabled = item.required;
      check.setAttribute("aria-label",`Include ${item.label}`);
      check.addEventListener("change",() => { item.selected = check.checked; });
      const text = document.createElement("span");
      text.innerHTML = `<strong></strong><small></small>`;
      text.querySelector("strong").textContent = item.label;
      text.querySelector("small").textContent =
        `${item.kind} · ${item.status}${item.reason ? ` · ${item.reason}` : ""}`;
      row.append(check,text);
      if (item.status.includes("conflict") || item.status === "externally-controlled"){
        const select = document.createElement("select");
        select.setAttribute("aria-label",`Resolution for ${item.label}`);
        const resolutions = item.status === "schema-conflict"
          ? [["skip","Skip"],["copy","Restore as independent copy"]]
          : item.status === "port-conflict"
          ? [["skip","Skip"],["copy","Restore without missing port binding"]]
          : item.status === "identity-conflict"
          ? [["skip","Skip"],["copy","Restore as copy"]]
          : [["skip","Skip"],["replace","Replace current"],["copy","Restore as copy"]];
        for (const [value,label] of resolutions){
          const option = document.createElement("option");
          option.value = value; option.textContent = label; select.appendChild(option);
        }
        select.value = item.resolution;
        select.addEventListener("change",() => {
          item.resolution = select.value;
          item.selected = select.value !== "skip";
          check.checked = item.selected;
        });
        row.appendChild(select);
      }
      list.appendChild(row);
    }
  }
  historyShowSheet("historyRestoreSheet");
  return true;
}
function historyRestoreOrganizationMembership(source, restoredNodeIds){
  if (!source.organization || !state.organization || !restoredNodeIds.size) return;
  const sourceOrg = source.organization;
  const validGroups = new Set((state.organization.groups || []).map(group => group.id));
  const validLayers = new Set((state.organization.layers || []).map(layer => layer.id));
  const sourceNodes = new Map((source.nodes || []).map(node => [node.id,node]));
  for (const id of restoredNodeIds){
    const live = state.nodes.find(node => node.id === id);
    const historical = sourceNodes.get(id);
    if (!live || !historical) continue;
    if (historical.groupId && validGroups.has(historical.groupId)){
      live.groupId = historical.groupId;
      delete live.layerId;
    } else {
      delete live.groupId;
      if (historical.layerId && validLayers.has(historical.layerId)) live.layerId = historical.layerId;
      else delete live.layerId;
    }
  }
}
function historyApplyPartialRestore(plan = historyRestorePlan){
  if (!plan) return false;
  const selected = plan.items.filter(item => item.selected && item.resolution !== "skip");
  if (!selected.length){
    announce("No restorable objects are selected.");
    return false;
  }
  historyBeginTransaction("history-partial-restore");
  historySetPendingMeta({commandId:"historyPartialRestore",label:"Restore selected objects",origin:"partial-restore"});
  pushHistory("history-partial-restore");
  const restoredNodeIds = new Set();
  const idMap = new Map();
  if (state.organization){
    state.organization.layers = state.organization.layers || [];
    state.organization.groups = state.organization.groups || [];
    for (const item of selected.filter(candidate => candidate.kind === "layer"))
      if (!state.organization.layers.some(layer => layer.id === item.id))
        state.organization.layers.push(historyClone(item.source));
    for (const item of selected.filter(candidate => candidate.kind === "group"))
      if (!state.organization.groups.some(group => group.id === item.id))
        state.organization.groups.push(historyClone(item.source));
  }
  for (const item of selected.filter(candidate => candidate.kind === "node")){
    const copy = historyClone(item.source);
    if (item.resolution === "copy"){
      const newId = uid();
      idMap.set(copy.id,newId);
      copy.id = newId;
      copy.x = (Number(copy.x) || 0) + 24;
      copy.y = (Number(copy.y) || 0) + 24;
      if (item.status === "schema-conflict"){
        delete copy.semanticTypeId;
        delete copy.properties;
        delete copy.propertyProvenance;
      }
    }
    const index = state.nodes.findIndex(node => node.id === copy.id);
    if (index >= 0) state.nodes[index] = copy;
    else state.nodes.push(copy);
    restoredNodeIds.add(copy.id);
  }
  for (const item of selected.filter(candidate => candidate.kind === "edge")){
    const copy = historyClone(item.source);
    copy.from = idMap.get(copy.from) || copy.from;
    copy.to = idMap.get(copy.to) || copy.to;
    if (item.status === "port-conflict" && item.resolution === "copy"){
      const from = state.nodes.find(node => node.id === copy.from);
      const to = state.nodes.find(node => node.id === copy.to);
      if (copy.fromPort && !(Array.isArray(from && from.outputPorts) &&
          from.outputPorts.some(port => port.id === copy.fromPort))) delete copy.fromPort;
      if (copy.toPort && !(Array.isArray(to && to.inputPorts) &&
          to.inputPorts.some(port => port.id === copy.toPort))) delete copy.toPort;
    }
    if (!state.nodes.some(node => node.id === copy.from) || !state.nodes.some(node => node.id === copy.to))
      continue;
    if (item.resolution === "copy" || state.edges.some(edge => edge.id === copy.id))
      copy.id = item.resolution === "copy" ? uid() : copy.id;
    const index = state.edges.findIndex(edge => edge.id === copy.id);
    if (index >= 0) state.edges[index] = copy;
    else state.edges.push(copy);
  }
  historyRestoreOrganizationMembership(plan.source,restoredNodeIds);
  state.nextId = nextIdFromDocument(documentObject({includeHistory:false}));
  ensureFieldIds();
  if (typeof ensureOrganization === "function") ensureOrganization();
  if (typeof ensureMetadata === "function") ensureMetadata();
  if (restoredNodeIds.size) setSelection("node",[...restoredNodeIds]);
  render();
  setDocDirty(true);
  historyFinalizePendingTransaction({
    commandId:"historyPartialRestore",label:"Restore selected objects",origin:"partial-restore"
  });
  historyRestorePlan = null;
  historyHideSheets();
  historySelectedId = HISTORY_CURRENT_ID;
  renderHistoryPanel();
  announce(`Restored ${selected.length} object or relationship item(s) as one change.`);
  return true;
}
function historyDuplicateVersion(id = historySelectedId){
  const version = historyVersion(id);
  if (!version || id === HISTORY_CURRENT_ID) return false;
  const safe = version.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "version";
  download(`${safe}.schematic.json`,JSON.stringify(version.snapshot,null,2),"application/json");
  announce(`Downloaded ${version.name} as a new document.`);
  return true;
}
function exportHistoryArchive(){
  historyFinalizePendingTransaction();
  const archive = {
    schemaVersion:HISTORY_SCHEMA_VERSION,
    kind:"schematic-history-archive",
    exportedAt:new Date().toISOString(),
    documentName:doc.name,
    documentId:historyState.documentId,
    portable:historyDocumentPayload(),
    local:historyClone(historyLocal)
  };
  const base = (doc.name || "schematic").replace(/(\.schematic)?\.json$/i,"");
  download(`${base}-history.json`,JSON.stringify(archive,null,2),"application/json");
  return archive;
}
function historyImportArchiveText(text){
  const archive = JSON.parse(text);
  if (!archive || archive.kind !== "schematic-history-archive" ||
      Number(archive.schemaVersion) > HISTORY_SCHEMA_VERSION) throw new Error("Unsupported history archive");
  if (archive.documentId !== historyState.documentId) throw new Error("History archive belongs to another document");
  const portable = historyNormalizeEmbedded(archive.portable);
  const knownCheckpointIds = new Set(historyState.checkpoints.map(record => record.id));
  for (const record of portable.checkpoints)
    if (!knownCheckpointIds.has(record.id)) historyState.checkpoints.push(record);
  const knownTransactionIds = new Set(historyState.transactions.map(record => record.id));
  for (const record of portable.transactions)
    if (!knownTransactionIds.has(record.id)) historyState.transactions.push(record);
  if (archive.local && Array.isArray(archive.local.automatic)){
    const knownAutomaticIds = new Set(historyLocal.automatic.map(record => record.id));
    for (const record of archive.local.automatic.filter(historyRecordValid))
      if (!knownAutomaticIds.has(record.id)) historyLocal.automatic.push(historyClone(record));
  }
  historyState.sequence = Math.max(historyState.sequence,portable.sequence,
    ...historyState.transactions.map(record => Number(record.sequence) || 0),
    ...historyState.checkpoints.map(record => Number(record.sequence) || 0));
  historyWriteLocal();
  setDocDirty(true);
  if (historyPanelOpen) renderHistoryPanel();
  return true;
}

function initializeHistoryUi(){
  const panel = document.getElementById("historyPanel");
  if (!panel) return;
  document.getElementById("btnCloseHistoryPanel")?.addEventListener("click",closeHistoryPanel);
  document.getElementById("btnHistoryNewCheckpoint")?.addEventListener("click",openCheckpointComposer);
  document.getElementById("btnHistoryCancelCheckpoint")?.addEventListener("click",historyHideSheets);
  document.getElementById("btnHistorySaveCheckpoint")?.addEventListener("click",historySubmitCheckpoint);
  document.getElementById("historyCheckpointName")?.addEventListener("keydown",event => {
    if (event.key === "Enter"){ event.preventDefault(); historySubmitCheckpoint(); }
  });
  for (const id of ["historySearch","historyTypeFilter"])
    document.getElementById(id)?.addEventListener("input",historyRenderTimeline);
  document.getElementById("btnHistoryCompare")?.addEventListener("click",() => {
    historyCompare.from = document.getElementById("historyCompareFrom").value;
    historyCompare.to = document.getElementById("historyCompareTo").value;
    historySelectedId = historyCompare.from !== HISTORY_CURRENT_ID
      ? historyCompare.from
      : historyCompare.to !== HISTORY_CURRENT_ID ? historyCompare.to : HISTORY_CURRENT_ID;
    historyActiveChange = -1;
    renderHistoryPanel();
  });
  document.getElementById("btnHistoryPreviousChange")?.addEventListener("click",() => historyStepChange(-1));
  document.getElementById("btnHistoryNextChange")?.addEventListener("click",() => historyStepChange(1));
  document.getElementById("btnHistoryDuplicate")?.addEventListener("click",() => historyDuplicateVersion());
  document.getElementById("btnHistoryFitPreview")?.addEventListener("click",historyFitPreview);
  document.getElementById("btnHistoryRestoreAll")?.addEventListener("click",() => historyRestoreWhole());
  document.getElementById("btnHistoryRestoreSelected")?.addEventListener("click",historyOpenPartialRestore);
  document.getElementById("btnHistoryCancelRestore")?.addEventListener("click",() => {
    historyRestorePlan = null; historyHideSheets();
  });
  document.getElementById("btnHistoryApplyRestore")?.addEventListener("click",() => historyApplyPartialRestore());
  document.getElementById("btnHistorySettings")?.addEventListener("click",historyOpenSettings);
  document.getElementById("btnHistoryCancelSettings")?.addEventListener("click",historyHideSheets);
  document.getElementById("btnHistorySaveSettings")?.addEventListener("click",historySaveSettings);
  document.getElementById("btnHistoryClearAutomatic")?.addEventListener("click",historyClearAutomatic);
  panel.addEventListener("click",event => { if (event.target === panel) closeHistoryPanel(); });
  panel.addEventListener("keydown",event => {
    if (event.key === "Escape"){
      const openSheet = panel.querySelector(".history-sheet:not([hidden])");
      if (openSheet){ event.preventDefault(); historyHideSheets(); }
      else { event.preventDefault(); closeHistoryPanel(); }
    } else if (event.altKey && event.key === "ArrowLeft"){
      event.preventDefault(); historyStepChange(-1);
    } else if (event.altKey && event.key === "ArrowRight"){
      event.preventDefault(); historyStepChange(1);
    }
  });
  document.getElementById("historyTimeline")?.addEventListener("keydown",event => {
    const buttons = [...document.querySelectorAll("#historyTimeline .history-version")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(buttons.length-1,index+1);
    else if (event.key === "ArrowUp") next = Math.max(0,index-1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length-1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
    historySelectVersion(buttons[next]?.dataset.historyVersion);
  });
}
