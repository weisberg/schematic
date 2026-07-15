"use strict";

/* --------------------------- File I/O ----------------------------- */
function download(name, text, mime){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type: mime || "text/plain"}));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function savePickerOptions(){
  return {
    suggestedName: doc.name || "untitled.schematic.json",
    types: [{ description:"Schematic diagram", accept:{ "application/json":[".json",".schematic"] } }]
  };
}
function openPickerOptions(){
  return {
    types: [{ description:"Schematic diagram", accept:{ "application/json":[".json",".schematic"] } }],
    multiple: false
  };
}
function fallbackOpen(){
  document.getElementById("fileInput").click();
}
function fallbackSave(){
  const name = doc.name || "untitled.schematic.json";
  download(name, serializeDocument(), "application/json");
  setDocDirty(false);
}
async function openDoc(){
  if (!FSA){ fallbackOpen(); return; }
  try {
    const [handle] = await window.showOpenFilePicker(openPickerOptions());
    if (!handle) return;
    const file = await handle.getFile();
    const text = await file.text();
    importDocText(text, { name: file.name || handle.name || doc.name, handle, dirty: false });
  } catch(err){
    if (err && err.name === "AbortError") return;
    if (err && err.message === "newer version") alert("Could not read that file — it was made with a newer Schematic.");
    else alert("Could not open that file — expected JSON exported by this app.");
  }
}
async function writeHandle(handle, text){
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}
async function saveAsDoc(){
  if (!FSA){ fallbackSave(); return; }
  try {
    const handle = await window.showSaveFilePicker(savePickerOptions());
    if (!handle) return;
    await writeHandle(handle, serializeDocument());
    doc.handle = handle;
    doc.name = handle.name || doc.name;
    setDocDirty(false);
  } catch(err){
    if (err && err.name === "AbortError") return;
    alert("Could not save that file.");
  }
}
async function saveDoc(){
  if (!FSA){ fallbackSave(); return; }
  if (!doc.handle){ await saveAsDoc(); return; }
  try {
    await writeHandle(doc.handle, serializeDocument());
    setDocDirty(false);
  } catch(err){
    if (err && err.name === "AbortError") return;
    if (err && err.name === "NotAllowedError"){ await saveAsDoc(); return; }
    alert("Could not save that file.");
  }
}
function newDoc(){
  if (doc.dirty && !confirm("Discard unsaved changes and start a new diagram?")) return;
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  clearSelection();
  undoStack.length = 0;
  redoStack.length = 0;
  doc = { handle: null, name: "untitled.schematic.json", dirty: false };
  setAutoSave(false);   // the new document has no file handle to save into
  applyColorScheme(null);
  applyTheme("light", { render:false });
  applyDialect("ansi", { render:false });
  setPngAsShown(false);
  render();
  syncHistoryButtons();
  updateDocLabel();
  clearRecoverySave();
}
document.getElementById("btnExportJSON").addEventListener("click", () =>
  download(doc.name || "schematic-diagram.json", serializeDocument(), "application/json"));

document.getElementById("btnImportJSON").addEventListener("click", () =>
  fallbackOpen());
document.getElementById("btnOpen").addEventListener("click", openDoc);
document.getElementById("btnSave").addEventListener("click", saveDoc);
document.getElementById("btnSaveAs").addEventListener("click", saveAsDoc);
document.getElementById("btnNew").addEventListener("click", newDoc);
document.getElementById("fileInput").addEventListener("change", ev => {
  const f = ev.target.files[0];
  if (!f) return;
  f.text().then(txt => {
    try {
      pushHistory();
      importDocText(txt, { name: f.name, dirty: false });
    } catch(err){
      if (err && err.message === "newer version") alert("Could not read that file — it was made with a newer Schematic.");
      else alert("Could not read that file — expected JSON exported by this app.");
    }
  });
  ev.target.value = "";
});

document.getElementById("btnClear").addEventListener("click", () => {
  if (!state.nodes.length || confirm("Clear the entire canvas? (Undo can bring it back.)")){
    pushHistory(); state.nodes = []; state.edges = []; clearSelection(); render();
  }
});
document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnRedo").addEventListener("click", redo);
document.getElementById("btnFit").addEventListener("click", fitView);
document.getElementById("btnInspector").addEventListener("click", toggleInspector);
document.getElementById("btnAddConcept").addEventListener("click", () => { const c = viewCenter(); addNode("concept", c.x-65, c.y-24); });
document.getElementById("btnAddText").addEventListener("click", () => { const c = viewCenter(); addNode("text", c.x-TEXT_W_DEFAULT/2, c.y-20); });
document.getElementById("btnAddNote").addEventListener("click", () => { const c = viewCenter(); addNode("note", c.x-NOTE_W_DEFAULT/2, c.y-60); });
document.getElementById("btnAddTable").addEventListener("click", () => { const c = viewCenter(); addNode("table", c.x-95, c.y-40); });
document.getElementById("btnAddTodo").addEventListener("click", () => { const c = viewCenter(); addNode("todo", c.x-90, c.y-30); });
document.getElementById("btnSnap").addEventListener("click", toggleSnapToGrid);
document.getElementById("btnCleanup").addEventListener("click", cleanUpToGrid);
document.getElementById("autoSaveToggle").addEventListener("change", ev => setAutoSave(ev.target.checked));
document.getElementById("btnAddFrame").addEventListener("click", () => { const c = viewCenter(); addNode("frame", c.x-FRAME_DEFAULT.w/2, c.y-FRAME_DEFAULT.h/2); });
document.getElementById("btnAddHorizontalLane").addEventListener("click", () => addSwimlane("horizontal"));
document.getElementById("btnAddVerticalLane").addEventListener("click", () => addSwimlane("vertical"));
document.getElementById("btnLayoutTree").addEventListener("click", layoutMindMapTree);
document.getElementById("btnLayoutSchema").addEventListener("click", layoutSchemaTables);
document.getElementById("btnLint").addEventListener("click", openLintModal);
document.getElementById("btnAlignTop").addEventListener("click", () => alignSelection("top"));
document.getElementById("btnAlignMiddle").addEventListener("click", () => alignSelection("centerY"));
document.getElementById("btnAlignBottom").addEventListener("click", () => alignSelection("bottom"));
document.getElementById("btnAlignLeft").addEventListener("click", () => alignSelection("left"));
document.getElementById("btnAlignCenter").addEventListener("click", () => alignSelection("centerX"));
document.getElementById("btnAlignRight").addEventListener("click", () => alignSelection("right"));
document.getElementById("btnTheme").addEventListener("click", toggleTheme);
document.getElementById("pngAsShown").addEventListener("change", ev => setPngAsShown(ev.target.checked));
document.getElementById("dialectSelect").addEventListener("change", ev => setDialect(ev.target.value));

/* --------------------------- SQL export --------------------------- */
function ident(s){
  const t = (s||"t").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g,"");
  return t || "t";
}
function qident(s, dialect = docDialect){
  const id = ident(s);
  if (dialect === "mysql" || dialect === "athena") return "`" + id + "`";
  return id;
}
function sqlType(raw, dialect = docDialect){
  const t = String(raw || "TEXT").trim();
  if (dialect === "mysql"){
    if (/^SERIAL$/i.test(t)) return "INT AUTO_INCREMENT";
    if (/^TIMESTAMP$/i.test(t)) return "DATETIME";
    if (/^BOOLEAN$/i.test(t)) return "BOOLEAN";
    return t.replace(/^JSONB$/i, "JSON");
  }
  if (dialect === "athena"){
    if (/^SERIAL$/i.test(t)) return "INT";
    if (/^VARCHAR\(\d+\)$/i.test(t) || /^TEXT$/i.test(t)) return "STRING";
    if (/^BOOLEAN$/i.test(t)) return "BOOLEAN";
    if (/^FLOAT$/i.test(t)) return "DOUBLE";
    if (/^JSONB?$/i.test(t)) return "STRING";
    return t;
  }
  if (dialect === "ansi"){
    if (/^SERIAL$/i.test(t)) return "INT";
    if (/^JSONB$/i.test(t)) return "JSON";
    return t;
  }
  return t;
}
function comparableType(raw){
  return String(sqlType(raw, "ansi")).toUpperCase()
    .replace(/^SERIAL$/, "INT")
    .replace(/^INT AUTO_INCREMENT$/, "INT")
    .replace(/^VARCHAR\(\d+\)$/, "VARCHAR")
    .replace(/^DECIMAL\([^)]+\)$/, "DECIMAL")
    .replace(/^NUMERIC\([^)]+\)$/, "NUMERIC");
}
function edgePairsResolved(e, parent, child){
  const pairs = edgeFieldPairs(e);
  if (pairs.length){
    const resolved = pairs.map(p => ({
      parent: parent.fields.find(f => f.id === p.fromField),
      child: child.fields.find(f => f.id === p.toField)
    })).filter(p => p.parent && p.child);
    if (resolved.length) return resolved;
  }
  const ppk = parent.fields.find(f => f.pk);
  const boundChild = e.toField ? child.fields.find(f => f.id === e.toField) : null;
  const boundParent = e.fromField ? parent.fields.find(f => f.id === e.fromField) : null;
  const fkField = boundChild
               || child.fields.find(f => f.fk && ident(f.name).includes(ident(parent.title).replace(/s$/,"")))
               || child.fields.find(f => f.fk);
  const refField = boundParent || ppk;
  return fkField && refField ? [{ parent:refField, child:fkField }] : [];
}
function columnLine(f, dialect = docDialect){
  const parts = [`  ${qident(f.name, dialect)} ${sqlType(f.type, dialect)}`];
  if (dialect !== "athena"){
    if (!f.nullable) parts.push("NOT NULL");
    if (f.default) parts.push("DEFAULT " + f.default);
    if (f.unique) parts.push("UNIQUE");
  }
  const comment = f.comment ? ` -- ${f.comment}` : "";
  return parts.join(" ") + comment;
}
function generateSQL(dialect = docDialect){
  const tables = state.nodes.filter(n => n.type === "table");
  if (!tables.length) return "-- No table nodes on the canvas.\n-- Add a Table node, give it fields, then export again.";
  dialect = SQL_DIALECTS.includes(dialect) ? dialect : "ansi";
  const lines = [`-- Draft ${dialect.toUpperCase()} DDL generated by Schematic — review types & constraints before use.`,
    "-- Table nodes only; concepts, rich notes, and to-do lists are not exported.",""];
  for (const t of tables){
    const tn = qident(t.title, dialect);
    const cols = t.fields.map(f => columnLine(f, dialect));
    const constraintComments = [];
    const pks = t.fields.filter(f => f.pk).map(f => qident(f.name, dialect));
    if (pks.length){
      const line = `  PRIMARY KEY (${pks.join(", ")})`;
      if (dialect === "athena") constraintComments.push("-- " + line.trim());
      else cols.push(line);
    }
    for (const e of state.edges){
      if (e.kind !== "1:N" && e.kind !== "1:1") continue;
      if (e.to !== t.id) continue;
      const parent = nodeById(e.from);
      if (!parent || parent.type !== "table") continue;
      const pairs = edgePairsResolved(e, parent, t);
      if (pairs.length){
        const childCols = pairs.map(p => qident(p.child.name, dialect)).join(", ");
        const parentCols = pairs.map(p => qident(p.parent.name, dialect)).join(", ");
        const line = `  FOREIGN KEY (${childCols}) REFERENCES ${qident(parent.title, dialect)}(${parentCols})`;
        if (dialect === "athena") constraintComments.push("-- " + line.trim());
        else cols.push(line);
      } else {
        const ppk = parent.fields.find(f => f.pk);
        cols.push(`  -- TODO: add FK column referencing ${qident(parent.title, dialect)}${ppk ? "(" + qident(ppk.name, dialect) + ")" : ""} (edge: ${e.kind})`);
      }
    }
    if (dialect === "athena"){
      lines.push(`CREATE EXTERNAL TABLE ${tn} (`, cols.join(",\n"), ")",
        "STORED AS PARQUET",
        "-- LOCATION 's3://bucket/path/';");
      if (constraintComments.length) lines.push(...constraintComments);
      if (t.fields.some(f => /^SERIAL$/i.test(f.type || ""))) lines.push("-- SERIAL fields emitted as INT for Athena.");
      lines.push("");
    } else {
      lines.push(`CREATE TABLE ${tn} (`, cols.join(",\n"), ");", "");
      for (const f of t.fields.filter(f => f.index)){
        lines.push(`CREATE INDEX idx_${ident(t.title)}_${ident(f.name)} ON ${tn} (${qident(f.name, dialect)});`);
      }
      if (t.fields.some(f => f.index)) lines.push("");
    }
  }
  for (const e of state.edges){
    if (e.kind !== "N:M") continue;
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    const an = qident(a.title, dialect), bn = qident(b.title, dialect);
    const rawAn = ident(a.title), rawBn = ident(b.title);
    const apk = a.fields.find(f => f.pk), bpk = b.fields.find(f => f.pk);
    lines.push(`-- N:M between ${rawAn} and ${rawBn} — suggested junction table:`,
      `CREATE TABLE ${qident(rawAn + "_" + rawBn, dialect)} (`,
      `  ${qident(rawAn + "_id", dialect)} ${apk ? sqlType(apk.type, dialect) : "INT"} NOT NULL,`,
      `  ${qident(rawBn + "_id", dialect)} ${bpk ? sqlType(bpk.type, dialect) : "INT"} NOT NULL,`,
      `  PRIMARY KEY (${qident(rawAn + "_id", dialect)}, ${qident(rawBn + "_id", dialect)})` +
        (apk && dialect !== "athena" ? `,\n  FOREIGN KEY (${qident(rawAn + "_id", dialect)}) REFERENCES ${an}(${qident(apk.name, dialect)})` : "") +
        (bpk && dialect !== "athena" ? `,\n  FOREIGN KEY (${qident(rawBn + "_id", dialect)}) REFERENCES ${bn}(${qident(bpk.name, dialect)})` : ""),
      ");", "");
  }
  return lines.join("\n");
}
function lintDocument(docState = state){
  const issues = [];
  const nodes = docState.nodes || [];
  const edges = docState.edges || [];
  const tables = nodes.filter(n => n.type === "table");
  const concepts = nodes.filter(n => n.type === "concept");
  const titleKey = n => ident(n.title);
  const tableNames = new Map();
  for (const t of tables){
    const key = titleKey(t);
    if (tableNames.has(key)) issues.push({level:"error", msg:`Duplicate table name: ${t.title}`, nodeId:t.id});
    else tableNames.set(key, t);
    if (!t.fields.some(f => f.pk)) issues.push({level:"error", msg:`Table ${t.title} has no primary key`, nodeId:t.id});
    const fieldNames = new Set();
    for (const f of t.fields){
      const fk = ident(f.name);
      if (fieldNames.has(fk)) issues.push({level:"error", msg:`Duplicate field ${f.name} in ${t.title}`, nodeId:t.id});
      fieldNames.add(fk);
      if (f.fk){
        const bound = edges.some(e => e.fromField === f.id || e.toField === f.id ||
          edgeFieldPairs(e).some(p => p.fromField === f.id || p.toField === f.id));
        if (!bound) issues.push({level:"error", msg:`FK field ${t.title}.${f.name} has no bound relation`, nodeId:t.id});
      }
    }
  }
  for (const c of concepts){
    if (!String(c.title || "").trim()) issues.push({level:"error", msg:"Concept has an empty title", nodeId:c.id});
  }
  for (const td of nodes.filter(n => n.type === "todo")){
    if (!(td.items || []).length)
      issues.push({level:"warning", msg:`To-do list ${td.title || "(untitled)"} has no items`, nodeId:td.id});
  }
  for (const textNode of nodes.filter(n => n.type === "text")){
    if (!String(textNode.title || "").trim())
      issues.push({level:"warning", msg:"Plain text item is empty", nodeId:textNode.id});
  }
  for (const e of edges){
    if (e.kind === "link") continue;
    const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
    if (linkOnlyNode(a) || linkOnlyNode(b)){
      const linked = linkOnlyNode(a) ? a : b;
      const kind = linked && linked.type === "note" ? "rich note"
        : linked && linked.type === "text" ? "plain text" : "to-do list";
      issues.push({level:"error", msg:`Relation ${e.kind} touches a ${kind} — use a link edge`, edgeId:e.id});
      continue;
    }
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    if (e.kind === "N:M"){
      const expected = ident(a.title) + "_" + ident(b.title);
      const reverse = ident(b.title) + "_" + ident(a.title);
      if (!tables.some(t => ident(t.title) === expected || ident(t.title) === reverse))
        issues.push({level:"error", msg:`N:M ${a.title} ↔ ${b.title} has no junction table`, edgeId:e.id});
    }
    for (const p of edgePairsResolved(e, a, b)){
      if (comparableType(p.parent.type) !== comparableType(p.child.type))
        issues.push({level:"error", msg:`Type mismatch on ${a.title}.${p.parent.name} → ${b.title}.${p.child.name}`, edgeId:e.id});
    }
  }
  return issues;
}
let lintModal = null;
function openLintModal(){
  closeLintModal();
  const modal = document.createElement("div");
  modal.className = "modal open lint-modal";
  const issues = lintDocument();
  const rows = document.createElement("div");
  rows.className = "lint-list";
  if (!issues.length){
    const p = document.createElement("p");
    p.className = "helper";
    p.textContent = "No schema lint errors.";
    rows.appendChild(p);
  } else {
    for (const issue of issues){
      const b = document.createElement("button");
      b.className = "lint-row";
      b.innerHTML = `<b>${escapeHtml(issue.msg)}</b><small>${escapeHtml(issue.level)}</small>`;
      b.addEventListener("click", () => {
        if (issue.nodeId){ setSelection("node", issue.nodeId); centerNode(issue.nodeId); render(); }
        if (issue.edgeId){ setSelection("edge", issue.edgeId); render(); }
        closeLintModal();
      });
      rows.appendChild(b);
    }
  }
  modal.innerHTML = `<div class="card"><h3>Schema lint</h3><div class="actions"><button class="primary" id="btnCloseLint">Close</button></div></div>`;
  modal.querySelector(".card").insertBefore(rows, modal.querySelector(".actions"));
  modal.addEventListener("click", ev => { if (ev.target === modal) closeLintModal(); });
  document.body.appendChild(modal);
  lintModal = modal;
  modal.querySelector("#btnCloseLint").addEventListener("click", closeLintModal);
}
function closeLintModal(){
  if (lintModal && lintModal.parentNode) lintModal.parentNode.removeChild(lintModal);
  lintModal = null;
}

/* ------------------------ Interop helpers ------------------------- */
function stripSqlComments(text){
  return String(text || "").replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function splitSqlStatements(text){
  const out = [];
  let cur = "", quote = null, depth = 0;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quote){
      cur += ch;
      if (ch === quote && text[i-1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`"){ quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0){ if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function splitTopLevelComma(text){
  const out = [];
  let cur = "", quote = null, depth = 0;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quote){
      cur += ch;
      if (ch === quote && text[i-1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`"){ quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0){ out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function unquoteName(s){
  return String(s || "").trim().replace(/^[`"[]|[`"\]]$/g, "");
}
function parseNameList(text){
  return splitTopLevelComma(text).map(unquoteName).map(ident);
}
function parseDDL(text){
  const result = { tables:[], fks:[], skipped:[] };
  const statements = splitSqlStatements(stripSqlComments(text));
  for (const stmt of statements){
    const m = stmt.match(/^\s*CREATE\s+(?:EXTERNAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.-]+[`"\]]?)\s*\(([\s\S]*)\)\s*(?:STORED\s+AS[\s\S]*)?$/i);
    if (!m){ result.skipped.push(stmt.slice(0, 80)); continue; }
    try {
      const tableName = ident(unquoteName(m[1].split(".").pop()));
      const table = { title:tableName, fields:[] };
      const tablePk = [];
      for (const part of splitTopLevelComma(m[2])){
        const pk = part.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)$/i);
        if (pk){ tablePk.push(...parseNameList(pk[1])); continue; }
        const fk = part.match(/^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([`"\[]?[\w.-]+[`"\]]?)\s*\(([^)]+)\)$/i);
        if (fk){
          result.fks.push({
            fromTable: ident(unquoteName(fk[2].split(".").pop())),
            toTable: tableName,
            fromFields: parseNameList(fk[3]),
            toFields: parseNameList(fk[1])
          });
          continue;
        }
        const cm = part.match(/^([`"\[]?[\w]+[`"\]]?)\s+(.+)$/i);
        if (!cm){ result.skipped.push(part); continue; }
        const name = ident(unquoteName(cm[1]));
        let rest = cm[2].trim();
        const field = { name, type:"TEXT", pk:false, fk:false, nullable:true };
        const typeMatch = rest.match(/^([A-Z]+(?:\s+AUTO_INCREMENT)?(?:\([^)]+\))?)/i);
        if (typeMatch){ field.type = typeMatch[1].toUpperCase(); rest = rest.slice(typeMatch[0].length).trim(); }
        if (/NOT\s+NULL/i.test(rest)) field.nullable = false;
        if (/PRIMARY\s+KEY/i.test(rest)){ field.pk = true; field.nullable = false; }
        if (/UNIQUE/i.test(rest)) field.unique = true;
        const def = rest.match(/\bDEFAULT\s+((?:'[^']*')|(?:"[^"]*")|[^\s,]+)/i);
        if (def) field.default = def[1];
        table.fields.push(field);
      }
      for (const f of table.fields) if (tablePk.includes(ident(f.name))){ f.pk = true; f.nullable = false; }
      result.tables.push(table);
    } catch {
      result.skipped.push(stmt.slice(0, 80));
    }
  }
  return result;
}
function importParsedDDL(parsed){
  if (!parsed || !parsed.tables || !parsed.tables.length) return false;
  pushHistory();
  const start = viewCenter();
  const tableIdByName = new Map();
  const fieldIdByTableName = new Map();
  parsed.tables.forEach((src, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const n = { id:uid(), type:"table", x:start.x + col*300, y:start.y + row*220,
      title:src.title, notes:"", color:tableColors()[i % tableColors().length],
      fields:src.fields.map(f => ({ id:uid(), name:f.name, type:f.type, pk:!!f.pk, fk:!!f.fk,
        nullable:f.nullable !== false, default:f.default, unique:!!f.unique, index:!!f.index, comment:f.comment })) };
    state.nodes.push(n);
    tableIdByName.set(ident(n.title), n.id);
    fieldIdByTableName.set(ident(n.title), new Map(n.fields.map(f => [ident(f.name), f.id])));
  });
  for (const fk of parsed.fks || []){
    const from = tableIdByName.get(ident(fk.fromTable));
    const to = tableIdByName.get(ident(fk.toTable));
    if (!from || !to) continue;
    const fromFields = fieldIdByTableName.get(ident(fk.fromTable));
    const toFields = fieldIdByTableName.get(ident(fk.toTable));
    const pairs = fk.fromFields.map((ff, i) => ({
      fromField: fromFields.get(ident(ff)) || "",
      toField: toFields.get(ident(fk.toFields[i])) || ""
    })).filter(p => p.fromField && p.toField);
    for (const p of pairs){
      const toNode = nodeById(to);
      const f = toNode && toNode.fields.find(x => x.id === p.toField);
      if (f) f.fk = true;
    }
    const e = { id:uid(), from, to, kind:"1:N", label:"" };
    if (pairs.length) setEdgePairs(e, pairs);
    state.edges.push(e);
  }
  render();
  return true;
}
function importDDLText(text){
  const parsed = parseDDL(text);
  const ok = importParsedDDL(parsed);
  return {...parsed, imported:ok};
}
function generateMermaid(){
  const lines = ["erDiagram", "  %% Tables and relations only — concepts, links, rich notes, and to-do lists are omitted."];
  const tables = state.nodes.filter(n => n.type === "table");
  for (const t of tables){
    lines.push(`  ${ident(t.title)} {`);
    for (const f of t.fields) lines.push(`    ${String(f.type || "TEXT").replace(/\s+/g, "_")} ${ident(f.name)}`);
    lines.push("  }");
  }
  for (const e of state.edges){
    if (e.kind === "link") continue;
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b || a.type !== "table" || b.type !== "table") continue;
    const rel = e.kind === "1:1" ? "||--||" : e.kind === "1:N" ? "||--o{" : "}o--o{";
    lines.push(`  ${ident(a.title)} ${rel} ${ident(b.title)} : "${(e.label || "").replace(/"/g, '\\"')}"`);
  }
  return lines.join("\n");
}
function generateMarkdownOutline(){
  const outlineRoots = state.nodes.filter(n => n.type === "concept" || n.type === "todo" || n.type === "note");
  const incoming = new Set(state.edges.filter(e => e.kind === "link").map(e => e.to));
  const roots = outlineRoots.filter(n => !incoming.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const childEdges = id => state.edges.filter(e => e.kind === "link" && e.from === id)
    .sort((a, b) => (nodeById(a.to)?.y || 0) - (nodeById(b.to)?.y || 0));
  const lines = [];
  function walk(id, depth, seen){
    const n = nodeById(id);
    if (!n) return;
    const indent = "  ".repeat(depth);
    if (seen.has(id)){ lines.push(`${indent}- (→ see ${n.title || id})`); return; }
    if (n.type === "table") lines.push(`${indent}- **${n.title || "table"}**`);
    else if (n.type === "note"){
      lines.push(`${indent}- **${n.title || "Rich note"}**`);
      for (const contentLine of String(n.content || "").split(/\r?\n/))
        lines.push(contentLine ? `${indent}  ${contentLine}` : "");
    }
    else if (n.type === "todo"){
      lines.push(`${indent}- ${n.title || "To-do list"}`);
      if (n.notes) lines.push(`${indent}  > ${n.notes}`);
      for (const it of n.items) lines.push(`${indent}  - [${it.done ? "x" : " "}] ${it.text || ""}`);
    }
    else {
      lines.push(`${indent}- ${n.title || "(untitled)"}`);
      if (n.notes) lines.push(`${indent}  > ${n.notes}`);
    }
    const nextSeen = new Set(seen); nextSeen.add(id);
    for (const e of childEdges(id)) walk(e.to, depth + 1, nextSeen);
  }
  for (const root of roots) walk(root.id, 0, new Set());
  return lines.join("\n") || "- (empty)";
}
function serializedSvg(asShown = true){
  if (!state.nodes.length) return "";
  const bounds = documentBounds();
  const pad = 40, W = bounds.w + pad*2, H = bounds.h + pad*2;
  const png = cloneBoardForPng(asShown);
  const clone = png.clone;
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  clone.setAttribute("viewBox", `${bounds.x-pad} ${bounds.y-pad} ${W} ${H}`);
  const g = clone.querySelector("#world");
  if (g) g.removeAttribute("transform");
  const bg = clone.querySelector("[data-bg]");
  if (bg) bg.setAttribute("fill", themeColors(png.themeName).paper);
  clone.querySelectorAll("[data-handle], [data-fieldhandle], [data-frame-resize], [data-edgegrip], [data-edgebend], [data-ortho-snap-x], [data-ortho-snap-y], [data-align-guide-x], [data-align-guide-y], [data-text-selection]").forEach(h => h.remove());
  const style = document.createElementNS(SVGNS, "style");
  style.textContent = "/* Fonts use system fallbacks if Archivo or IBM Plex Mono are unavailable. */";
  clone.insertBefore(style, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}
function parseCSVLine(line){
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++){
    const ch = line[i];
    if (quoted){
      if (ch === '"' && line[i+1] === '"'){ cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ","){ out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function inferScalarType(values){
  const present = values.filter(v => String(v).trim() !== "");
  if (!present.length) return "VARCHAR(255)";
  if (present.every(v => /^-?\d+$/.test(String(v).trim()))) return "INT";
  if (present.every(v => /^-?\d+(?:\.\d+)?$/.test(String(v).trim()))) return "DECIMAL(12,2)";
  if (present.every(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()))) return "DATE";
  if (present.every(v => !Number.isNaN(Date.parse(String(v).trim())) && /[T:]/.test(String(v)))) return "TIMESTAMP";
  if (present.every(v => /^(true|false|0|1)$/i.test(String(v).trim()))) return "BOOLEAN";
  return "VARCHAR(255)";
}
function inferTable(csvText, name = "imported_csv"){
  const rows = String(csvText || "").trim().split(/\r?\n/).filter(Boolean).slice(0, 101).map(parseCSVLine);
  if (!rows.length) return { name:ident(name), fields:[] };
  const headers = rows[0].map(h => ident(h || "field"));
  const data = rows.slice(1);
  const fields = headers.map((h, i) => {
    const values = data.map(r => r[i] || "");
    return { name:h, type:inferScalarType(values), pk:false, fk:false, nullable:values.some(v => String(v).trim() === "") };
  });
  return { name:ident(name), fields };
}
function importCSVText(text, name = "imported_csv"){
  const inferred = inferTable(text, name);
  if (!inferred.fields.length) return inferred;
  pushHistory();
  const c = viewCenter();
  state.nodes.push({ id:uid(), type:"table", x:c.x-95, y:c.y-40, title:inferred.name,
    notes:"", color:tableColors()[state.nodes.filter(n => n.type === "table").length % tableColors().length],
    fields:inferred.fields.map(f => ({...f, id:uid()})) });
  render();
  return inferred;
}

const sqlModal = document.getElementById("sqlModal");
let textModal = null;
function closeTextModal(){
  if (textModal && textModal.parentNode) textModal.parentNode.removeChild(textModal);
  textModal = null;
}
function openTextInputModal(title, placeholder, actionLabel, onSubmit){
  closeTextModal();
  const modal = document.createElement("div");
  modal.className = "modal open text-input-modal";
  modal.innerHTML = `<div class="card"><h3>${escapeHtml(title)}</h3><div class="palette-body"><textarea class="modal-textarea" placeholder="${escapeHtml(placeholder)}" style="min-height:220px"></textarea></div><div class="actions"><button id="btnCancelText">Cancel</button><button class="primary" id="btnSubmitText">${escapeHtml(actionLabel)}</button></div></div>`;
  modal.addEventListener("click", ev => { if (ev.target === modal) closeTextModal(); });
  document.body.appendChild(modal);
  textModal = modal;
  const ta = modal.querySelector("textarea");
  modal.querySelector("#btnCancelText").addEventListener("click", closeTextModal);
  modal.querySelector("#btnSubmitText").addEventListener("click", () => {
    onSubmit(ta.value);
    closeTextModal();
  });
  ta.focus();
}
function openOutputModal(title, text, downloadName, mime){
  closeTextModal();
  const modal = document.createElement("div");
  modal.className = "modal open output-modal";
  modal.innerHTML = `<div class="card"><h3>${escapeHtml(title)}</h3><pre></pre><div class="actions"><button id="btnCopyOutput">Copy</button><button id="btnDownloadOutput">Download</button><button class="primary" id="btnCloseOutput">Close</button></div></div>`;
  modal.querySelector("pre").textContent = text;
  modal.addEventListener("click", ev => { if (ev.target === modal) closeTextModal(); });
  document.body.appendChild(modal);
  textModal = modal;
  modal.querySelector("#btnCopyOutput").addEventListener("click", ev => {
    navigator.clipboard.writeText(text).then(() => {
      ev.target.textContent = "Copied";
      setTimeout(() => ev.target.textContent = "Copy", 1200);
    });
  });
  modal.querySelector("#btnDownloadOutput").addEventListener("click", () => download(downloadName, text, mime));
  modal.querySelector("#btnCloseOutput").addEventListener("click", closeTextModal);
}
document.getElementById("btnExportSQL").addEventListener("click", () => {
  document.getElementById("sqlOut").textContent = generateSQL();
  sqlModal.classList.add("open");
});
document.getElementById("btnCloseSQL").addEventListener("click", () => sqlModal.classList.remove("open"));
sqlModal.addEventListener("click", ev => { if (ev.target === sqlModal) sqlModal.classList.remove("open"); });
document.getElementById("btnCopySQL").addEventListener("click", ev => {
  navigator.clipboard.writeText(document.getElementById("sqlOut").textContent)
    .then(() => { ev.target.textContent = "Copied ✓"; setTimeout(() => ev.target.textContent = "Copy", 1400); });
});
document.getElementById("btnDownloadSQL").addEventListener("click", () =>
  download("schematic-schema.sql", document.getElementById("sqlOut").textContent, "text/plain"));
document.getElementById("btnImportDDL").addEventListener("click", () =>
  openTextInputModal("Import SQL DDL", "CREATE TABLE ...", "Import", text => {
    const result = importDDLText(text);
    if (result.skipped.length) openOutputModal("DDL import report", `Imported ${result.tables.length} tables.\nSkipped:\n- ${result.skipped.join("\n- ")}`, "schematic-ddl-import.txt", "text/plain");
  }));
document.getElementById("btnExportMermaid").addEventListener("click", () =>
  openOutputModal("Mermaid ER", generateMermaid(), "schematic-er.mmd", "text/plain"));
document.getElementById("btnExportMarkdown").addEventListener("click", () =>
  openOutputModal("Markdown outline", generateMarkdownOutline(), "schematic-outline.md", "text/markdown"));
document.getElementById("btnExportSVG").addEventListener("click", () =>
  download("schematic-diagram.svg", serializedSvg(true), "image/svg+xml"));
document.getElementById("btnImportCSV").addEventListener("click", () =>
  openTextInputModal("Import CSV", "id,email,created_at\n1,user@example.com,2026-07-08", "Create table", text => importCSVText(text)));

/* --------------------------- PNG export --------------------------- */
function cloneBoardForPng(asShown = pngAsShown){
  const exportTheme = asShown ? docTheme : "light";
  const previousTheme = docTheme;
  if (previousTheme !== exportTheme) applyTheme(exportTheme, { render:true });
  const clone = board.cloneNode(true);
  if (previousTheme !== exportTheme) applyTheme(previousTheme, { render:true });
  return { clone, themeName:exportTheme };
}
document.getElementById("btnExportPNG").addEventListener("click", () => {
  if (!state.nodes.length){ alert("Nothing to export yet."); return; }
  const bounds = documentBounds();
  const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.w, y1 = bounds.y + bounds.h;
  const pad = 40, W = x1 - x0 + pad*2, H = y1 - y0 + pad*2;
  const png = cloneBoardForPng(pngAsShown);
  const clone = png.clone;
  clone.setAttribute("width", W); clone.setAttribute("height", H);
  clone.setAttribute("viewBox", `${x0-pad} ${y0-pad} ${W} ${H}`);
  const g = clone.querySelector("#world");
  g.removeAttribute("transform");
  const bg = g.querySelector("[data-bg]");
  const bgColor = pngAsShown ? themeColors(png.themeName).paper : "#FFFFFF";
  if (bg) bg.setAttribute("fill", bgColor);
  clone.querySelectorAll("[data-handle], [data-fieldhandle], [data-frame-resize], [data-edgegrip], [data-edgebend], [data-ortho-snap-x], [data-ortho-snap-y], [data-align-guide-x], [data-align-guide-y], [data-text-selection]").forEach(h => h.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], {type:"image/svg+xml;charset=utf-8"}));
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = W*2; cv.height = H*2;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = bgColor; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob(b => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "schematic-diagram.png";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.src = url;
});

/* ------------------------ Context menu ---------------------------- */
const ctxMenu = document.createElement("div");
ctxMenu.id = "ctxMenu";
ctxMenu.setAttribute("role", "menu");
document.body.appendChild(ctxMenu);
let ctxAnchor = {x:0, y:0};
const ctxDisclosureState = new Map();

function hideCtx(){ ctxMenu.style.display = "none"; ctxMenu.innerHTML = ""; }
function fitCtxMenu(){
  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = (ctxAnchor.x + r.width > window.innerWidth ? Math.max(4, ctxAnchor.x - r.width) : ctxAnchor.x) + "px";
    ctxMenu.style.top = (ctxAnchor.y + r.height > window.innerHeight ? Math.max(4, ctxAnchor.y - r.height) : ctxAnchor.y) + "px";
  });
}
function showCtx(x, y, build){
  ctxMenu.innerHTML = "";
  build(ctxMenu);
  ctxAnchor = {x, y};
  ctxMenu.style.display = "block";
  ctxMenu.style.left = x + "px";
  ctxMenu.style.top  = y + "px";
  fitCtxMenu();
}
function contextIcon(kind){
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ctxicon");
  const shape = document.createElementNS(SVGNS, kind === "edge" ? "path" : "rect");
  if (kind === "edge"){
    shape.setAttribute("d", "M3 4c7 0 7 12 14 12M3 4l3-2M3 4l2 3M17 16l-3-2M17 16l-2 2");
    shape.setAttribute("fill", "none");
  } else {
    shape.setAttribute("x", "3"); shape.setAttribute("y", "4");
    shape.setAttribute("width", "14"); shape.setAttribute("height", "12"); shape.setAttribute("rx", "3");
    shape.setAttribute("fill", "none");
  }
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", "1.4");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  svg.appendChild(shape);
  return svg;
}
function ctxHeader(parent, kind, title){
  parent.setAttribute("aria-label", `${kind === "edge" ? "Edge" : kind === "canvas" ? "Canvas" : "Node"} actions: ${title}`);
  const header = document.createElement("div");
  header.className = "ctxhead";
  header.appendChild(contextIcon(kind));
  const copy = document.createElement("div");
  const type = document.createElement("small");
  type.textContent = kind === "edge" ? "Edge" : kind === "canvas" ? "Canvas" : "Node";
  const name = document.createElement("strong");
  name.textContent = title;
  copy.append(type, name);
  header.appendChild(copy);
  parent.appendChild(header);
}
function ctxGroup(parent, key, label, build, opts = {}){
  const details = document.createElement("details");
  details.className = "ctxgroup";
  details.setAttribute("data-ctx-group", key);
  const stored = ctxDisclosureState.get(key);
  details.open = stored == null ? !!opts.open : stored;
  const summary = document.createElement("summary");
  const text = document.createElement("span");
  text.textContent = label;
  summary.append(text, disclosureChevron());
  const body = document.createElement("div");
  body.className = "ctxgroupbody";
  build(body);
  details.append(summary, body);
  details.addEventListener("toggle", () => {
    ctxDisclosureState.set(key, details.open);
    fitCtxMenu();
  });
  parent.appendChild(details);
  return details;
}
function ctxItem(parent, label, fn, opts = {}){
  const b = document.createElement("button");
  b.className = "ctxitem" + (opts.danger ? " danger" : "");
  b.setAttribute("role", "menuitem");
  if (opts.action) b.setAttribute("data-ctx-action", opts.action);
  if (opts.pressed != null) b.setAttribute("aria-pressed", String(!!opts.pressed));
  const s = document.createElement("span");
  s.textContent = label;
  b.appendChild(s);
  if (opts.kbd){
    const k = document.createElement("kbd");
    k.textContent = opts.kbd;
    b.appendChild(k);
  }
  b.addEventListener("click", () => { hideCtx(); fn(); });
  parent.appendChild(b);
}
function ctxSep(parent){
  const d = document.createElement("div");
  d.className = "sep";
  parent.appendChild(d);
}
function ctxLabel(parent, txt){
  const d = document.createElement("div");
  d.className = "ctxlabel";
  d.textContent = txt;
  parent.appendChild(d);
}
function ctxSwatches(parent, colors, current, apply){
  parent.appendChild(swatchRow(colors, current, apply, "swrow", hideCtx));
  if (recentColors.length)
    parent.appendChild(swatchRow(recentColors, current, apply, "swrow recent", hideCtx));
  const hexWrap = document.createElement("div");
  hexWrap.className = "swrow";
  hexWrap.appendChild(customColorRow(current, apply, { onCommit: hideCtx }));
  parent.appendChild(hexWrap);
}
function ctxColorOverride(parent, colors, explicit, fallback, apply, reset, opts = {}){
  const inherited = !normalizeHex(explicit);
  const wrap = document.createElement("div");
  wrap.setAttribute("data-color-override", opts.key || "color");
  parent.appendChild(wrap);
  ctxItem(wrap, inherited ? `✓ Use ${opts.inheritLabel}` : `Reset to ${opts.inheritLabel}`, () => {
    if (!inherited) reset();
  }, {action:opts.action});
  ctxSwatches(wrap, colors, inherited ? fallback : explicit, apply);
}
/* compact font-size stepper for the context menu */
function ctxSizeRow(parent, n, targets = [n]){
  const isC = n.type === "concept", isNote = n.type === "note", isText = n.type === "text";
  const cur = nodeTextSize(n);
  const wrap = document.createElement("div");
  wrap.className = "swrow";
  wrap.appendChild(sizeStepper(cur, isC ? 9 : isNote || isText ? 10 : 8, isText ? 72 : isC ? 48 : 28, isC || isNote || isText ? 1 : 0.5,
    (v, commit) => {
      pushHistory(targets.length > 1 ? "fs:multi" : "fs:"+n.id);
      for (const t of targets) t.fontSize = clampNodeTextSize(t, v);
      commit ? render() : drawOnly();
    }));
  parent.appendChild(wrap);
}
/* Standard concept symbols, kept compact enough to fit the right-click menu. */
function ctxShapeRow(parent, n, targets = [n]){
  if (n.type !== "concept" && n.type !== "text") return;
  const matching = targets.filter(t => t.type === n.type);
  if (!matching.length) return;
  const options = n.type === "text" ? TEXT_BOX_SHAPES : FLOWCHART_SHAPES;
  const current = n.type === "text" ? textBoxShape(n) : conceptShape(n);
  const row = document.createElement("div");
  row.className = "shaperow";
  for (const [shape, label] of options){
    const b = document.createElement("button");
    b.textContent = label;
    b.title = label;
    b.setAttribute("data-shape-option", shape);
    b.setAttribute("aria-pressed", String(current === shape));
    if (current === shape) b.className = "on";
    b.addEventListener("click", () => {
      hideCtx();
      pushHistory(matching.length > 1 ? "shape:multi" : "shape:" + n.id);
      for (const target of matching){
        if (target.type === "text") setTextBoxShape(target, shape);
        else setConceptShape(target, shape);
      }
      render();
    });
    row.appendChild(b);
  }
  parent.appendChild(row);
}

function nodeMenu(n, x, y){
  const targets = isSelected("node", n.id) ? selectedNodes() : [n];
  const applyToTargets = (fn) => {
    for (const t of targets) fn(t);
  };
  showCtx(x, y, m => {
    ctxHeader(m, "node", targets.length > 1 ? `${targets.length} nodes selected` : n.title || "Untitled");
    ctxGroup(m, "node:appearance", "Appearance", panel => {
      const palette = [...new Set([...conceptColors(), ...tableColors()])];
      ctxLabel(panel, n.type === "swimlane" ? "Body background" : n.type === "text" ? "Shape background" : n.type === "concept" ? "Color" : n.type === "frame" ? "Frame color"
                : n.type === "todo" ? "List color" : n.type === "note" ? "Note color" : "Header color");
      ctxSwatches(panel, n.type === "swimlane" ? palette : (n.type === "concept" || n.type === "text" || n.type === "todo" || n.type === "note") ? conceptColors() : tableColors(), n.color,
        (c, commit) => { pushHistory(targets.length > 1 ? "color:multi" : "color:"+n.id); applyToTargets(t => { t.color = c; }); commit ? render() : drawOnly(); });
      if (n.type === "swimlane"){
        ctxLabel(panel, "Title background");
        ctxSwatches(panel, palette, n.titleColor || SWIMLANE_DEFAULT.titleColor,
          (c, commit) => { pushHistory(targets.length > 1 ? "lane-title:multi" : "lane-title:"+n.id);
            applyToTargets(t => { if (t.type === "swimlane") t.titleColor = c; }); commit ? render() : drawOnly(); });
      }
      if (n.type === "concept" || n.type === "text"){
        ctxLabel(panel, "Shape");
        ctxShapeRow(panel, n, targets);
      }
      if (!isStructuralNode(n)){
        if (n.type === "text"){
          ctxLabel(panel, "Maximum width");
          const widthRow = document.createElement("div");
          widthRow.className = "swrow";
          widthRow.appendChild(sizeStepper(n.w || TEXT_W_DEFAULT, 80, 720, 20,
            (v, commit) => {
              pushHistory(targets.length > 1 ? "size:multi" : "size:"+n.id);
              applyToTargets(t => { if (t.type === "text") t.w = v; });
              commit ? render() : drawOnly();
            }, {ariaLabel:"Maximum width"}));
          panel.appendChild(widthRow);
        }
        ctxLabel(panel, "Text size");
        ctxSizeRow(panel, n, targets);
        ctxLabel(panel, "Text color");
        ctxSwatches(panel, fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory(targets.length > 1 ? "fc:multi" : "fc:"+n.id); applyToTargets(t => { t.fontColor = c; }); commit ? render() : drawOnly(); });
      }
    });
    if (n.type === "swimlane") ctxGroup(m, "node:orientation", "Orientation", panel => {
      for (const [orientation, label] of [["horizontal","Horizontal lane"],["vertical","Vertical lane"]]){
        ctxItem(panel, (swimlaneOrientation(n) === orientation ? "✓ " : "") + label, () => {
          const lanes = targets.filter(t => t.type === "swimlane" && swimlaneOrientation(t) !== orientation);
          if (!lanes.length) return;
          pushHistory(targets.length > 1 ? "lane-orientation:multi" : "lane-orientation:"+n.id);
          for (const lane of lanes) setSwimlaneOrientation(lane, orientation);
          render();
        });
      }
    }, {open:true});
    ctxItem(m, n.type === "text" ? "Edit text" : "Edit title", () => startInlineEditor("node", n.id), {kbd:"dbl-click"});
    if (n.type === "note") ctxItem(m, "Edit note content", () => { setSelection("node", n.id); render(); focusNoteInput(); });
    if (!isStructuralNode(n)) ctxItem(m, "Add linked concept", addChildConcept, {kbd:"Tab"});
    if (n.type === "table" || n.type === "todo"){
      ctxGroup(m, "node:content", n.type === "table" ? "Table content" : "List content", panel => {
        if (n.type === "table"){
          ctxItem(panel, "Add related table (1:N)", () => addRelatedTable(n.id));
          ctxItem(panel, n.collapsed ? "Expand fields" : "Collapse fields", () => {
            pushHistory();
            n.collapsed = !n.collapsed;
            render();
          });
          ctxItem(panel, "Add field", () => {
            pushHistory();
            n.fields.push({id: uid(), name:"field_" + (n.fields.length+1),
                           type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
            render();
          });
        } else {
          ctxItem(panel, n.collapsed ? "Expand items" : "Collapse items", () => {
            pushHistory();
            n.collapsed = !n.collapsed;
            render();
          });
          ctxItem(panel, "Add item", () => addTodoItem(n));
        }
      });
    }
    ctxItem(m, "Duplicate", duplicateSelection, {kbd:"Ctrl+D"});
    ctxGroup(m, "node:arrange", "Arrange", panel => {
      if (targets.length >= 2){
        ctxLabel(panel, "Align selection");
        ctxItem(panel, "Align left", () => alignSelection("left"));
        ctxItem(panel, "Align right", () => alignSelection("right"));
        ctxItem(panel, "Align top", () => alignSelection("top"));
        ctxItem(panel, "Align bottom", () => alignSelection("bottom"));
        ctxItem(panel, "Center horizontally", () => alignSelection("centerX"));
        ctxItem(panel, "Center vertically", () => alignSelection("centerY"));
        ctxItem(panel, "Distribute horizontally", () => alignSelection("distributeX"));
        ctxItem(panel, "Distribute vertically", () => alignSelection("distributeY"));
        ctxSep(panel);
      }
      ctxItem(panel, "Bring to front", () => reorderNode(n.id, true));
      ctxItem(panel, "Send to back",   () => reorderNode(n.id, false));
    });
    ctxSep(m);
    ctxItem(m, "Delete node", deleteSelection, {kbd:"Del", danger:true});
  });
}
function edgeMenu(e, x, y){
  const a = nodeById(e.from), b = nodeById(e.to);
  const touchesLinkOnlyNode = linkOnlyNode(a) || linkOnlyNode(b);
  showCtx(x, y, m => {
    ctxHeader(m, "edge", `${a.title} → ${b.title}`);
    ctxGroup(m, "edge:relationship", "Relationship", panel => {
      if (!touchesLinkOnlyNode){
        ctxLabel(panel, "Relation type");
        const row = document.createElement("div");
        row.className = "kindrow";
        for (const k of ["link","1:1","1:N","N:M"]){
          const btn = document.createElement("button");
          btn.textContent = k;
          if (e.kind === k) btn.className = "on";
          btn.addEventListener("click", () => { hideCtx(); pushHistory(); e.kind = k; render(); });
          row.appendChild(btn);
        }
        panel.appendChild(row);
      }
      ctxLabel(panel, "Relationship preset");
      const relationshipRow = document.createElement("div");
      relationshipRow.className = "swrow";
      relationshipRow.appendChild(edgeRelationshipSelect(e, {
        close:hideCtx,
        onCustom:() => startInlineEditor("edge", e.id)
      }));
      panel.appendChild(relationshipRow);
      ctxLabel(panel, "Label text color");
      ctxColorOverride(panel, fontColors(), e.labelTextColor, edgeLineColor(e),
        (c, commit) => {
          pushHistory("edge-label-text:"+e.id);
          e.labelTextColor = c;
          commit ? render() : drawOnly();
        }, () => {
          pushHistory();
          delete e.labelTextColor;
          render();
        }, {inheritLabel:"link color", action:"inherit-label-text", key:"label-text"});
      ctxLabel(panel, "Label background");
      ctxColorOverride(panel, conceptColors(), e.labelBackgroundColor, themeColors().labelBg,
        (c, commit) => {
          pushHistory("edge-label-background:"+e.id);
          e.labelBackgroundColor = c;
          commit ? render() : drawOnly();
        }, () => {
          pushHistory();
          delete e.labelBackgroundColor;
          render();
        }, {inheritLabel:"canvas background", action:"inherit-label-background", key:"label-background"});
    });
    ctxGroup(m, "edge:appearance", "Appearance", panel => {
      ctxLabel(panel, "Arrows");
      const arrowRow = document.createElement("div");
      arrowRow.className = "kindrow";
      for (const [key, label] of [["startArrow","Start"],["endArrow","End"]]){
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.setAttribute("data-edge-arrow-toggle", key === "startArrow" ? "start" : "end");
        if (e[key]) btn.className = "on";
        btn.addEventListener("click", () => {
          hideCtx();
          pushHistory();
          setEdgeArrow(e, key, !e[key]);
          render();
        });
        arrowRow.appendChild(btn);
      }
      panel.appendChild(arrowRow);
      ctxLabel(panel, "Line style");
      const styleRow = document.createElement("div");
      styleRow.className = "swrow";
      styleRow.appendChild(edgeStyleSelect(e, null, {close:hideCtx}));
      panel.appendChild(styleRow);
      ctxLabel(panel, "Line width");
      const widthRow = document.createElement("div");
      widthRow.className = "swrow";
      widthRow.appendChild(sizeStepper(edgeLineWidth(e), 1, 8, .5,
        (v, commit) => {
          pushHistory("edge-width:"+e.id);
          e.lineWidth = v;
          if (commit){ hideCtx(); render(); } else drawOnly();
        }, {ariaLabel:"Line width"}));
      panel.appendChild(widthRow);
      ctxLabel(panel, "Line color");
      ctxSwatches(panel, tableColors(), edgeLineColor(e),
        (c, commit) => {
          pushHistory("edge-color:"+e.id);
          e.lineColor = c;
          commit ? render() : drawOnly();
        });
    });
    ctxGroup(m, "edge:routing", "Routing", panel => {
      const routeRow = document.createElement("div");
      routeRow.className = "kindrow";
      for (const k of ["curve","ortho"]){
        const button = document.createElement("button");
        button.textContent = k === "curve" ? "Curve" : "Ortho";
        if ((e.routing || "curve") === k) button.className = "on";
        button.addEventListener("click", () => {
          hideCtx();
          pushHistory();
          if (k === "ortho") e.routing = "ortho"; else delete e.routing;
          render();
        });
        routeRow.appendChild(button);
      }
      panel.appendChild(routeRow);
      if (e.routing === "ortho"){
        ctxLabel(panel, "Waypoint");
        const note = document.createElement("div");
        note.className = "ctxhint";
        note.textContent = "Drag the square handle on the canvas; each axis snaps independently.";
        panel.appendChild(note);
        if (hasCustomOrthoBend(e)) ctxItem(panel, "Reset to automatic", () => resetOrthoBend(e));
      }
    });
    ctxItem(m, "Swap direction", () => {
      pushHistory();
      swapEdgeDirection(e);
      render();
    });
    ctxItem(m, "Edit label text", () => startInlineEditor("edge", e.id), {kbd:"dbl-click"});
    ctxSep(m);
    ctxItem(m, "Delete edge", deleteSelection, {kbd:"Del", danger:true});
  });
}
function canvasMenu(w, x, y){
  showCtx(x, y, m => {
    ctxHeader(m, "canvas", "Create, arrange, or view");
    ctxGroup(m, "canvas:create", "Create", panel => {
      ctxItem(panel, "Concept", () => addNodeCentered("concept", w), {kbd:"C", action:"add-concept"});
      ctxItem(panel, "Plain text", () => addNodeCentered("text", w), {kbd:"X", action:"add-text"});
      ctxItem(panel, "Rich note", () => addNodeCentered("note", w), {kbd:"N", action:"add-note"});
      ctxItem(panel, "Table", () => addNodeCentered("table", w), {kbd:"T", action:"add-table"});
      ctxItem(panel, "To-do list", () => addNodeCentered("todo", w), {kbd:"D", action:"add-todo"});
      ctxItem(panel, "Frame", () => addNodeCentered("frame", w), {action:"add-frame"});
      ctxItem(panel, "Horizontal swimlane", () => addNodeCentered("swimlane", w, {orientation:"horizontal"}), {action:"add-horizontal-lane"});
      ctxItem(panel, "Vertical swimlane", () => addNodeCentered("swimlane", w, {orientation:"vertical"}), {action:"add-vertical-lane"});
    }, {open:true});
    ctxGroup(m, "canvas:layout", "Layout", panel => {
      ctxItem(panel, "Tree layout", layoutMindMapTree, {action:"layout-tree"});
      ctxItem(panel, "Schema layout", layoutSchemaTables, {action:"layout-schema"});
      ctxItem(panel, "Clean up to grid", cleanUpToGrid, {action:"cleanup-grid"});
      ctxItem(panel, "Snap to grid", toggleSnapToGrid, {action:"toggle-snap", pressed:snapToGrid});
    });
    ctxGroup(m, "canvas:view", "View", panel => {
      ctxItem(panel, "Fit diagram", fitView, {kbd:"F", action:"fit"});
      ctxItem(panel, "Actual size (100%)", () => zoomAtClient(1, x, y), {action:"zoom-actual"});
      ctxSep(panel);
      ctxItem(panel, "Zoom in", () => zoomAtClient(view.k * 1.2, x, y), {action:"zoom-in"});
      ctxItem(panel, "Zoom out", () => zoomAtClient(view.k / 1.2, x, y), {action:"zoom-out"});
    });
  });
}

board.addEventListener("contextmenu", ev => {
  ev.preventDefault();
  const nodeEl = ev.target.closest("[data-node]");
  const edgeEl = ev.target.closest("[data-edge]");
  if (nodeEl){
    const n = nodeById(nodeEl.getAttribute("data-node"));
    if (!isSelected("node", n.id)) setSelection("node", n.id);
    render();
    nodeMenu(n, ev.clientX, ev.clientY);
  } else if (edgeEl){
    const e = edgeById(edgeEl.getAttribute("data-edge"));
    setSelection("edge", e.id);
    render();
    edgeMenu(e, ev.clientX, ev.clientY);
  } else {
    canvasMenu(clientToWorld(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
  }
});
window.addEventListener("pointerdown", ev => {
  if (ctxMenu.style.display === "block" && !ctxMenu.contains(ev.target)) hideCtx();
}, true);
window.addEventListener("blur", hideCtx);
board.addEventListener("wheel", hideCtx, { passive:true });

/* --------------------------- Seed data ---------------------------- */
function seed(){
  const N = (o) => { o.id = uid(); state.nodes.push(o); return o.id; };
  const E = (from, to, kind, label, fromField, toField, options = {}) => {
    const e = {id: uid(), from, to, kind, label: label||""};
    if (fromField) e.fromField = fromField;
    if (toField)   e.toField   = toField;
    Object.assign(e, options);
    state.edges.push(e);
    return e.id;
  };

  const strategy = N({type:"concept", x:60,  y:220, title:"Loyalty program launch", notes:"Q3 initiative — north star: repeat purchase rate.", color:"#FFE9A8"});
  const tiers    = N({type:"concept", x:320, y:90,  title:"Tiered rewards", notes:"", color:"#CFE8FF"});
  const referral = N({type:"concept", x:320, y:180, title:"Referral engine", notes:"", color:"#CFE8FF"});
  const measure  = N({type:"concept", x:320, y:350, title:"Measurement plan", notes:"Holdout design + CUPED on pre-period spend.", color:"#D8F3DC"});

  const customers = N({type:"table", x:720, y:60, title:"customers", color:"#16232F", notes:"", fields:[
    {id:"f_cust_pk",   name:"customer_id", type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_cust_email",name:"email",       type:"VARCHAR(255)", pk:false, fk:false, nullable:false},
    {id:"f_cust_tier", name:"tier",        type:"VARCHAR(20)",  pk:false, fk:false, nullable:true},
    {id:"f_cust_join", name:"joined_at",   type:"TIMESTAMP",    pk:false, fk:false, nullable:false}]});
  const orders = N({type:"table", x:990, y:80, title:"orders", color:"#2456E6", notes:"", fields:[
    {id:"f_ord_pk",   name:"order_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_ord_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_ord_total",name:"total",       type:"DECIMAL(12,2)", pk:false, fk:false, nullable:false},
    {id:"f_ord_ts",   name:"placed_at",   type:"TIMESTAMP",     pk:false, fk:false, nullable:false}]});
  const rewards = N({type:"table", x:720, y:330, title:"reward_events", color:"#1E7A4F", notes:"", fields:[
    {id:"f_rw_pk",   name:"event_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_rw_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_rw_pts",  name:"points",      type:"INT",    pk:false, fk:false, nullable:false},
    {id:"f_rw_why",  name:"reason",      type:"VARCHAR(50)", pk:false, fk:false, nullable:true}]});

  E(strategy, tiers,    "link");
  E(strategy, referral, "link");
  E(strategy, measure,  "link");
  E(tiers,    customers,"link", "drives", null, "f_cust_tier");
  E(measure,  rewards,  "link", "sources");
  E(customers, orders,  "1:N", "", "f_cust_pk", "f_ord_cust");
  E(customers, rewards, "1:N", "", "f_cust_pk", "f_rw_cust");

  /* The fresh document doubles as a compact feature tour. Structural nodes are
     intentionally added after the original example so its established ids and
     edge order remain stable; render() still paints containers behind content. */
  N({type:"text", x:38, y:12, title:"Loyalty program system map", fontSize:30,
     fontColor:"#16232F", color:"#CFE8FF", w:520});
  N({type:"frame", x:30, y:75, title:"Strategy & experiments", color:"#007873", w:500, h:425});
  N({type:"swimlane", orientation:"horizontal", x:560, y:30, title:"Data model",
     color:"#E7F4F3", titleColor:"#007873", w:690, h:490});
  N({type:"swimlane", orientation:"vertical", x:1280, y:30, title:"Delivery & evidence",
     color:"#FBE8EC", titleColor:"#C20029", w:300, h:490});
  const evidence = N({type:"note", x:1310, y:105, title:"Launch decision",
     content:"## Why this matters\n- **Hypothesis:** tiers increase repeat orders\n- [x] Define the holdout\n- [ ] Review guardrails\n`owner: Growth + Data`",
     color:"#FFE9A8", fontSize:13, w:240});
  const checklist = N({type:"todo", x:1320, y:350, title:"Launch readiness", notes:"",
     color:"#E9E2F8", items:[
       {id:"i_release_design", text:"Approve experiment design", done:true},
       {id:"i_release_events", text:"Validate tracking events"},
       {id:"i_release_readout", text:"Schedule results readout"}
     ]});

  E(orders, evidence, "link", "Produces", null, null, {
    fromAnchor:"mr", toAnchor:"ml", endArrow:true, lineColor:"#007873", lineStyle:"solid"
  });
  E(evidence, checklist, "link", "Triggers", null, null, {
    fromAnchor:"bc", toAnchor:"tc", routing:"ortho", endArrow:true,
    lineColor:"#007873", lineWidth:2.5, lineStyle:"dot",
    labelTextColor:"#FFFFFF", labelBackgroundColor:"#C20029"
  });
}
function perfSeed(n = 500){
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  clearSelection();
  for (let i = 0; i < n; i++){
    state.nodes.push({ id:uid(), type:"table", x:(i%25)*230, y:Math.floor(i/25)*130,
      title:"bench_" + i, color:tableColors()[i % tableColors().length], notes:"",
      fields:[{id:uid(), name:"id", type:"INT", pk:true, fk:false, nullable:false},
              {id:uid(), name:"value", type:"VARCHAR(255)", pk:false, fk:false, nullable:true}] });
  }
  render();
  fitView();
}

/* ----------------------------- Init ------------------------------- */
buildScaffold();
seed();
ensureFieldIds();
render();
syncHistoryButtons();
updateDocLabel();
syncAriaLabels();
setupMenus();
updateDialectControls();
updateSnapControl();
updateAutoSaveControl();
{
  const versionEl = document.getElementById("appVersion");
  if (versionEl){ versionEl.textContent = APP_VERSION; versionEl.title = "Schematic " + APP_VERSION; }
}
showCapabilityBanner();
maybeShowRecovery();
requestAnimationFrame(fitView);
window.addEventListener("resize", () => {/* view persists; nothing needed */});

window.__T = {
  DOC_VERSION,
  FSA,
  RECOVERY,
  get state(){ return state; },
  get doc(){ return doc; },
  serializeDocument,
  migrateDocument,
  importDocText,
  openDoc,
  saveDoc,
  saveAsDoc,
  newDoc,
  pushHistory,
  undo,
  redo,
  setDocDirty,
  generateSQL,
  render,
  nodeRect,
  smartAlignmentSnap,
  alignmentGuideGeometry,
  conceptShape,
  setConceptShape,
  textBoxShape,
  setTextBoxShape,
  textBoxLayout,
  textBoxFont,
  wrapConceptTitle,
  conceptWrappedLayout,
  conceptContainsPoint,
  get FLOWCHART_SHAPES(){ return FLOWCHART_SHAPES.map(([id, label]) => ({id, label})); },
  get TEXT_BOX_SHAPES(){ return TEXT_BOX_SHAPES.map(([id, label]) => ({id, label})); },
  get EDGE_RELATIONSHIPS(){ return EDGE_RELATIONSHIPS.map(([name, meaning]) => ({name, meaning})); },
  nodeMenu,
  edgeMenu,
  edgeRelationshipValue,
  edgeRelationshipSelect,
  nodeAnchor,
  nodeRows,
  tableMetrics,
  fieldRowCenterY,
  cleanFieldRefs,
  rectsOverlap,
  documentBounds,
  hitTest,
  frameContainedNodes,
  containerContainedNodes,
  isStructuralNode,
  swimlaneOrientation,
  setSwimlaneOrientation,
  get SWIMLANE_DEFAULT(){ return JSON.parse(JSON.stringify(SWIMLANE_DEFAULT)); },
  addNode,
  addSwimlane,
  addEdge,
  edgeFieldPairs,
  setEdgePairs,
  edgeEndpoints,
  edgePath,
  edgeRenderPath,
  edgeLabelPoint,
  edgeLineColor,
  edgeLabelTextColor,
  edgeLabelBackgroundColor,
  polylineMidpoint,
  notationVertex,
  orthoEdgeRoute,
  snapOrthoBend,
  hasCustomOrthoBend,
  resetOrthoBend,
  lintDocument,
  openLintModal,
  closeLintModal,
  parseDDL,
  importParsedDDL,
  importDDLText,
  generateMermaid,
  generateMarkdownOutline,
  serializedSvg,
  parseCSVLine,
  inferTable,
  importCSVText,
  pinchTransform,
  perfSeed,
  layoutMindMapTree,
  layoutSchemaTables,
  conceptTreeScope,
  schemaDagEdges,
  minimapTransform,
  centerViewOn,
  applyTheme,
  toggleTheme,
  setPngAsShown,
  cloneBoardForPng,
  get docTheme(){ return docTheme; },
  applyDialect,
  setDialect,
  get docDialect(){ return docDialect; },
  get pngAsShown(){ return pngAsShown; },
  get THEME(){ return THEME; },
  get view(){ return view; },
  setView(next){ view = {...view, ...next}; applyView(); },
  get selection(){ return sel ? { kind:sel.kind, ids:[...sel.ids] } : null; },
  setSelection,
  clearSelection,
  selectionIds,
  isSelected,
  selectedNodes,
  get undoDepth(){ return undoStack.length; },
  pushRecentColor,
  mergeRecentColors,
  recordRecentColor,
  get recentColors(){ return recentColors; },
  normalizeColorScheme,
  applyColorScheme,
  get colorScheme(){ return colorScheme; },
  conceptColors,
  tableColors,
  fontColors,
  frameColorDefault,
  todoColorDefault,
  themeColors,
  autoInk,
  relativeLuminance,
  noteFont,
  richNoteInline,
  richNoteBlock,
  richNoteLayout,
  toggleInspector,
  updateInspectorVisibility,
  get inspectorPinned(){ return inspectorPinned; },
  textW,
  get textMeasureCacheSize(){ return textMeasureCache.size; },
  get renderStats(){ return renderStats; },
  selectNode(id){ setSelection("node", id); render(); },
  cloneSelectionPayload,
  remapPayload,
  copySelection,
  pasteSelection,
  deleteSelection,
  duplicateSelection,
  alignSelection,
  startInlineEditor,
  closeInlineEditor,
  paletteItems,
  paletteMatches,
  openCommandPalette,
  closeCommandPalette,
  openShortcutModal,
  closeShortcutModal,
  get SHORTCUTS(){ return SHORTCUTS.slice(); }
};
