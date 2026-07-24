const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const scriptUrls = [...html.matchAll(/<script\s+src="([^"]+\.js(?:\?[^\"]*)?)"/g)].map(match => match[1]);
const scriptSources = scriptUrls.map(src => src.split("?")[0]);
const script = scriptSources.map(src => fs.readFileSync(path.join(ROOT, src), "utf8")).join("\n;\n");
const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

function makeStorage(throwing = false){
  const store = new Map();
  return {
    getItem(key){ if (throwing) throw new Error("blocked"); return store.has(key) ? store.get(key) : null; },
    setItem(key, value){ if (throwing) throw new Error("blocked"); store.set(key, String(value)); },
    removeItem(key){ if (throwing) throw new Error("blocked"); store.delete(key); },
    clear(){ store.clear(); }
  };
}

function makeDom({ fsa = false, storageThrows = false, storageSeed = null } = {}){
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const downloads = [];
  const alerts = [];
  const storage = makeStorage(storageThrows);
  if (storageSeed) for (const [k, v] of Object.entries(storageSeed)) storage.setItem(k, v);

  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  window.HTMLCanvasElement.prototype.getContext = () => ({
    measureText: text => ({ width: String(text).length * 7 }),
    fillRect(){},
    clearRect(){},
    drawImage(){},
    setTransform(){},
    beginPath(){},
    moveTo(){},
    lineTo(){},
    fillText(){},
    save(){},
    translate(){},
    rotate(){},
    restore(){},
    stroke(){}
  });
  window.SVGElement.prototype.getBoundingClientRect = function getBoundingClientRect(){
    if (this.id === "minimap") return { left: 0, top: 0, width: 120, height: 90, right: 120, bottom: 90 };
    return { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 };
  };
  window.SVGElement.prototype.setPointerCapture = () => {};
  window.SVGElement.prototype.releasePointerCapture = () => {};
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click(){
    downloads.push({ download: this.download, href: this.href });
  };
  window.requestAnimationFrame = cb => setTimeout(cb, 0);
  window.alert = msg => alerts.push(msg);
  window.confirm = () => true;
  window.navigator.clipboard = { writeText: async () => {} };

  if (fsa){
    const openHandle = {
      name: "opened.schematic",
      async getFile(){
        return {
          name: "opened.schematic",
          async text(){
            return JSON.stringify({
              version: 1,
              nextId: 3,
              nodes: [{ id: "n1", type: "concept", x: 10, y: 20, title: "Opened", notes: "", color: "#FFE9A8" }],
              edges: []
            });
          }
        };
      },
      async createWritable(){
        return {
          async write(text){ openHandle.written = text; },
          async close(){ openHandle.closed = true; }
        };
      }
    };
    const saveHandle = {
      name: "saved.schematic",
      async createWritable(){
        return {
          async write(text){ saveHandle.written = text; },
          async close(){ saveHandle.closed = true; }
        };
      }
    };
    window.__handles = { openHandle, saveHandle };
    window.showOpenFilePicker = async () => [openHandle];
    window.showSaveFilePicker = async () => saveHandle;
  }

  window.eval(script);
  return { window, downloads, alerts, storage };
}

async function delay(ms){
  await new Promise(resolve => setTimeout(resolve, ms));
}

function sameList(actual, expected, msg){
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);
}

function firePointer(window, target, type, opts = {}){
  const ev = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: opts.button || 0,
    clientX: opts.clientX || 0,
    clientY: opts.clientY || 0,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey
  });
  Object.defineProperty(ev, "pointerId", { configurable: true, value: opts.pointerId || 1 });
  Object.defineProperty(ev, "pointerType", { configurable: true, value: opts.pointerType || "mouse" });
  target.dispatchEvent(ev);
  return ev;
}

function assertNoOverlaps(rects, msg){
  for (let i = 0; i < rects.length; i++){
    for (let j = i + 1; j < rects.length; j++){
      const a = rects[i], b = rects[j];
      assert(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
        `${msg}: ${i} overlaps ${j}`);
    }
  }
}

function closeEnough(a, b, msg){
  assert(Math.abs(a - b) < 1e-6, `${msg}: expected ${b}, got ${a}`);
}

if (process.argv.includes("--api-surface")){
  const { window } = makeDom();
  process.stdout.write(Object.keys(window.__T).sort().join("\n") + "\n");
  process.exit(0);
}

(async () => {
  sameList(scriptSources, [
    "js/core.js", "js/icon-catalog.js", "js/geometry.js", "js/render.js", "js/model.js",
    "js/interactions.js", "js/inspector.js", "js/io.js", "js/search.js", "js/organization.js", "js/metadata.js",
    "js/editing.js", "js/commands.js", "js/context-menu.js", "js/bootstrap.js"
  ], "HTML declares the complete runtime dependency order");
  const assetVersion = html.match(/styles\.css\?v=([^"']+)/)?.[1];
  assert(assetVersion && scriptUrls.every(src => src.endsWith(`?v=${assetVersion}`)),
    "styles and every runtime script use one cache-busting release version");
  assert(html.includes("<!-- deployment"), "deployment comment is present");
  assert(html.includes("<noscript>"), "noscript warning is present");
  assert(html.includes(".schematic"), "fallback file input accepts .schematic files");
  assert(styles.includes(".banner[hidden]{display:none!important}"),
    "hidden recovery/capability banners cannot be repainted by a later display rule");

  {
    const { window, downloads } = makeDom();
    assert.strictEqual(window.__T.FSA, false, "FSA feature-detects absent API");
    const parsed = JSON.parse(window.__T.serializeDocument());
    assert.strictEqual(parsed.version, 1, "serializer writes current version");
    assert(Array.isArray(parsed.nodes), "serializer includes nodes");

    window.__T.setDocDirty(true);
    await window.__T.saveDoc();
    assert.strictEqual(downloads.length, 1, "fallback save downloads JSON");
    assert(downloads[0].download.endsWith(".json"), "fallback save uses JSON filename");
    assert.strictEqual(window.__T.doc.dirty, false, "fallback save clears dirty state");
  }

  /* SCH-083 / SCH-111 — the starter document is a comprehensive feature tour */
  {
    const { window } = makeDom();
    const T = window.__T;
    const nodeTypes = new Set(T.state.nodes.map(n => n.type));
    for (const type of ["concept", "text", "status", "note", "todo", "table", "frame", "swimlane"])
      assert(nodeTypes.has(type), `starter document includes the ${type} node type`);
    const measure = T.state.nodes.find(n => n.title === "Measurement plan");
    assert(measure && T.nodePortsEnabled(measure),
      "starter document demonstrates labeled Input / Output link ports");
    sameList(T.nodeInputPorts(measure).map(port => port.id), ["events","targets"],
      "starter multi-port concept exposes both named inputs");
    sameList(T.nodeOutputPorts(measure).map(port => port.id), ["metrics","decision"],
      "starter multi-port concept exposes both named outputs");
    sameList(T.state.edges.filter(edge => edge.to === measure.id).map(edge => edge.toPort).sort(),
      ["events","targets"], "starter links use every named input");
    sameList(T.state.edges.filter(edge => edge.from === measure.id).map(edge => edge.fromPort).sort(),
      ["decision","metrics"], "starter links use every named output");

    const lanes = T.state.nodes.filter(n => n.type === "swimlane");
    sameList(lanes.map(T.swimlaneOrientation).sort(), ["horizontal", "vertical"],
      "starter document demonstrates both swimlane orientations");
    const conceptShapes = new Set(T.state.nodes.filter(n => n.type === "concept").map(T.conceptShape));
    for (const shape of T.FLOWCHART_SHAPES.map(option => option.id))
      assert(conceptShapes.has(shape), `starter tour demonstrates the ${shape} concept shape`);
    assert.strictEqual(conceptShapes.size, T.FLOWCHART_SHAPES.length,
      "starter demonstrates every shape without creating a separate shape gallery");

    const plainTexts = T.state.nodes.filter(n => n.type === "text");
    assert(plainTexts.some(n => T.textBoxShape(n) === "none"),
      "starter includes an unboxed plain-text primitive");
    const preciseText = plainTexts.find(n => n.title === "Exact 220 × 84 px");
    assert(preciseText && T.textBoxShape(preciseText) === "rectangle" &&
      preciseText.manualWidth === true && T.manualNodeHeight(preciseText) === 84,
      "starter includes a shaped text box with exact pixel dimensions");
    assert.strictEqual(T.textBoxWrapEnabled(preciseText), false,
      "starter exact text box demonstrates disabled wrapping");
    assert.strictEqual(JSON.stringify(T.textBoxMargins(preciseText)),
      JSON.stringify({top:12, right:18, bottom:12, left:18}),
      "starter exact text box demonstrates independent margins");
    assert(/^#[0-9a-f]{8}$/i.test(preciseText.color),
      "starter uses an alpha color that exercises transparent palette storage");

    const frame = T.state.nodes.find(n => n.title === "Strategy & experiments");
    assert(T.frameBorderEnabled(frame) && T.frameBorderWidth(frame) === 2,
      "starter frame demonstrates the optional border feature");
    const visualFrame = T.state.nodes.find(n => n.title === "Visual primitives");
    assert(T.frameBorderEnabled(visualFrame) && T.frameBorderWidth(visualFrame) === 4 &&
      T.frameBorderColor(visualFrame).toUpperCase() === "#C20029",
      "starter demonstrates independent frame border width and color");
    const archive = T.state.nodes.find(n => n.title === "Archived workstream");
    const legacy = T.state.nodes.find(n => n.title === "Legacy cohort analysis");
    assert(archive && archive.collapsed === true && T.collapsedFrameHiddenNodeIds().has(legacy.id),
      "starter includes a collapsed frame with hidden content");
    assert.strictEqual(T.collapsedFrameProxyMap().get(legacy.id), archive.id,
      "starter collapsed frame proxies external links to its center");
    assert(T.state.edges.some(edge => edge.to === legacy.id),
      "starter visibly links an external item to collapsed-frame content");

    const horizontal = lanes.find(n => T.swimlaneOrientation(n) === "horizontal");
    const vertical = lanes.find(n => T.swimlaneOrientation(n) === "vertical");
    assertNoOverlaps([frame, horizontal, visualFrame, vertical].map(T.nodeRect),
      "the four feature panels remain visually separate");
    assert(T.containerContainedNodes(frame).filter(n => n.type === "concept").length >= 4,
      "strategy frame demonstrates concept containment");
    assert(T.containerContainedNodes(horizontal).filter(n => n.type === "table").length >= 4,
      "horizontal swimlane demonstrates table containment");
    sameList([...new Set(T.containerContainedNodes(vertical).map(n => n.type))].sort(),
      ["concept","note","status","todo"],
      "vertical swimlane contains delivery nodes, rich notes, statuses, and to-do work");
    const panels = [frame, horizontal, visualFrame, vertical];
    const containingPanel = node => {
      const center = T.nodeRect(node);
      return panels.find(panel => {
        const rect = T.nodeRect(panel);
        return center.cx >= rect.x && center.cx <= rect.x + rect.w &&
               center.cy >= rect.y && center.cy <= rect.y + rect.h;
      });
    };
    for (const edge of T.state.edges){
      const from = T.state.nodes.find(node => node.id === edge.from);
      const to = T.state.nodes.find(node => node.id === edge.to);
      assert.strictEqual(containingPanel(from), containingPanel(to),
        `starter edge ${edge.label || edge.kind} stays inside one feature panel`);
    }

    const decoratedLibraries = new Set(T.state.nodes.map(T.nodeIconLibrary).filter(value => value !== "none"));
    sameList([...decoratedLibraries].sort(), ["emoji","fa","lucide"],
      "starter tour demonstrates emoji, Font Awesome, and Lucide icons");
    assert(T.state.nodes.filter(n => T.nodeIconLibrary(n) !== "none")
      .every(n => T.nodeSubtitle(n)),
      "every decorated starter node pairs its icon with a subtitle");

    const customers = T.state.nodes.find(n => n.title === "customers");
    const email = customers.fields.find(field => field.id === "f_cust_email");
    assert(email.unique && email.index, "starter table demonstrates extended field metadata");
    assert(customers.fields.some(field => field.default) && customers.fields.some(field => field.comment),
      "starter fields demonstrate defaults and comments");
    assert(T.state.nodes.some(n => n.type === "table" && n.collapsed === true),
      "starter demonstrates a collapsed table");
    assert(T.state.edges.some(edge => T.edgeFieldPairs(edge).length === 2),
      "starter demonstrates a composite two-field relation");
    const edgeKinds = new Set(T.state.edges.map(edge => edge.kind));
    for (const kind of ["link","1:1","1:N","N:M"])
      assert(edgeKinds.has(kind), `starter demonstrates the ${kind} edge kind`);
    assert(T.state.edges.some(edge => edge.fromAnchor === "hr" && edge.toAnchor === "hl"),
      "starter demonstrates table-title attachment anchors");

    const checklist = T.state.nodes.find(n => n.title === "Launch readiness");
    assert(checklist.items.some(item => item.done) && checklist.items.some(item => !item.done),
      "starter to-do shows both completed and open items");
    assert(T.state.edges.some(edge => edge.to === checklist.id && edge.toField === "i_release_events"),
      "starter link attaches directly to a to-do item");

    const styled = T.state.edges.find(e => e.label === "Triggers");
    assert(styled && styled.routing === "ortho" && styled.endArrow && styled.lineStyle === "dot",
      "starter links demonstrate orthogonal routing, arrows, and line styling");
    assert(styled.labelTextColor && styled.labelBackgroundColor,
      "starter link demonstrates independent label text and background colors");
    assert(Number.isFinite(styled.orthoX) && Number.isFinite(styled.orthoY),
      "starter rounded orthogonal link demonstrates custom movable corners");
    assert(T.state.edges.some(edge => edge.routing === "ortho" && edge.orthoCorner === "square"),
      "starter also demonstrates square orthogonal corners");
    assert(T.state.edges.some(edge => edge.startArrow && edge.endArrow),
      "starter demonstrates simultaneous start and end arrows");
    sameList([...new Set(T.state.edges.map(edge =>
      edge.lineStyle || (edge.kind === "link" ? "dash" : "solid")))].sort(),
      ["dash","dot","solid"], "starter demonstrates every line style");
    assert(T.state.edges.some(edge => edge.lineWidth === 3),
      "starter demonstrates a custom line width");
    assert(T.state.edges.some(edge => Number.isFinite(edge.labelPosition) && edge.labelPosition !== .5),
      "starter includes a path-positioned link label");

    const semanticLabels = new Set(T.state.edges.map(edge => edge.label));
    for (const label of ["Contains","Depends on","Implements","Measures","Produces",
      "Reads from","Writes to","Calculates","Validates","Triggers","References","Supports"])
      assert(semanticLabels.has(label), `starter demonstrates the ${label} relationship preset`);
    const statuses = T.state.nodes.filter(n => n.type === "status");
    assert(statuses.some(n => n.statusSide === "left") && statuses.some(n => n.statusSide === "right"),
      "starter demonstrates status indicators on both sides");
    assert(statuses.some(n => n.status === "Blocked") && statuses.some(n => n.status === "In progress"),
      "starter demonstrates multiple built-in status values");
  }

  /* SCH-091 — status nodes + one document-wide custom status catalog */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    sameList(T.STATUS_BUILTINS.map(status => status.name),
      ["Not started", "In progress", "Blocked", "Completed", "Canceled"],
      "status nodes expose the five requested built-in labels in order");
    assert(doc.getElementById("btnAddStatus"), "toolbar exposes status-node creation");
    assert(T.SHORTCUTS.some(s => s.keys === "S" && /status node/i.test(s.title)),
      "S shortcut is registered for status nodes");
    assert(T.paletteItems().some(item => item.command === "addStatus"),
      "command palette exposes status-node creation");

    let status = T.state.nodes.find(n => n.type === "status");
    assert(status, "starter document contains a status node");
    assert.strictEqual(status.status, "In progress", "starter status uses a built-in label");
    const builtInColors = Object.fromEntries(T.STATUS_BUILTINS.map(item => [item.name, item.color]));
    for (const [label, color] of Object.entries(builtInColors))
      assert.strictEqual(T.statusColor(label), color, `${label} has a stable indicator color`);

    status.title = "A long approval checkpoint title that must wrap inside the text portion";
    status.statusSide = "right";
    T.render();
    let layout = T.statusNodeLayout(status);
    assert(layout.titleLines.length >= 2, "long status-node text wraps in the main portion");
    assert.strictEqual(doc.querySelectorAll(`[data-status-node="${status.id}"] [data-status-title-line]`).length,
      layout.titleLines.length, "every wrapped status-node text line renders");
    let labelX = Number(doc.querySelector(`[data-status-node="${status.id}"] [data-status-label-line]`).getAttribute("x"));
    assert(labelX > layout.w/2, "right-side configuration places the indicator on the right");
    assert.strictEqual(doc.querySelector(`[data-status-node="${status.id}"] [data-status-band]`).getAttribute("fill"),
      builtInColors["In progress"], "indicator renders the current built-in status color");

    T.selectNode(status.id);
    assert(/status node/i.test(doc.getElementById("inspTitle").textContent),
      "status nodes identify themselves in the inspector");
    let sideSelect = doc.getElementById("statusSide");
    sideSelect.value = "left";
    sideSelect.dispatchEvent(new window.Event("change"));
    layout = T.statusNodeLayout(status);
    labelX = Number(doc.querySelector(`[data-status-node="${status.id}"] [data-status-label-line]`).getAttribute("x"));
    assert.strictEqual(status.statusSide, "left", "inspector changes the indicator side");
    assert(labelX < layout.w/2, "left-side configuration places the indicator on the left");

    let statusSelect = doc.getElementById("statusValue");
    sameList([...statusSelect.options].map(option => option.value),
      ["Not started", "In progress", "Blocked", "Completed", "Canceled"],
      "a new diagram starts with only the built-in status catalog");
    statusSelect.value = "Completed";
    statusSelect.dispatchEvent(new window.Event("change"));
    const historyBeforeCustom = T.undoDepth;
    doc.getElementById("customStatusInput").value = "Waiting for review";
    doc.getElementById("addCustomStatusButton").click();
    assert.strictEqual(T.undoDepth, historyBeforeCustom + 1,
      "adding a custom status creates one undo step");
    assert.strictEqual(status.status, "Waiting for review",
      "adding a custom status also selects it on the edited node");
    sameList(T.customStatuses, ["Waiting for review"],
      "custom status is added to the shared diagram catalog");
    assert.strictEqual(T.statusColor(status.status), "#8A3FA8",
      "custom statuses use the custom indicator treatment");
    T.undo();
    status = T.state.nodes.find(n => n.id === status.id);
    assert.strictEqual(status.status, "Completed", "undo restores the node's previous status");
    sameList(T.customStatuses, [], "undo removes the custom label from the shared catalog");
    T.redo();
    status = T.state.nodes.find(n => n.id === status.id);
    sameList(T.customStatuses, ["Waiting for review"], "redo restores the shared custom label");

    const second = T.addNode("status", 1800, 120);
    T.selectNode(second.id);
    statusSelect = doc.getElementById("statusValue");
    assert([...statusSelect.options].some(option => option.value === "Waiting for review"),
      "a custom label added on one node is selectable on every other status node");
    statusSelect.value = "Waiting for review";
    statusSelect.dispatchEvent(new window.Event("change"));
    T.selectNode(status.id);
    statusSelect = doc.getElementById("statusValue");
    statusSelect.value = "Blocked";
    statusSelect.dispatchEvent(new window.Event("change"));
    assert.strictEqual(second.status, "Waiting for review",
      "the catalog is universal while each node keeps its own selected status");
    const customCount = T.customStatuses.length;
    assert.strictEqual(T.addCustomStatus("  waiting FOR review  "), "Waiting for review",
      "custom status matching is case-insensitive and returns the canonical label");
    assert.strictEqual(T.customStatuses.length, customCount, "equivalent custom labels do not duplicate");

    const saved = JSON.parse(T.serializeDocument());
    sameList(saved.meta.customStatuses, ["Waiting for review"],
      "shared custom catalog persists in document metadata");
    const savedSecond = saved.nodes.find(n => n.id === second.id);
    assert.strictEqual(savedSecond.status, "Waiting for review", "node status persists in document JSON");
    assert.strictEqual(saved.nodes.find(n => n.id === status.id).statusSide, "left",
      "indicator side persists in document JSON");
    assert(T.serializedSvg(true).includes("data-status-node"),
      "SVG export preserves rendered status nodes");

    T.nodeMenu(status, 10, 10);
    assert(doc.querySelector('#ctxMenu [data-ctx-action="status-waiting-for-review"]'),
      "status-node context menu includes shared custom labels");
    doc.querySelector('#ctxMenu [data-ctx-action="status-side-right"]').click();
    assert.strictEqual(status.statusSide, "right", "context menu changes the indicator side");

    const countBeforeCanvas = T.state.nodes.filter(n => n.type === "status").length;
    doc.getElementById("board").dispatchEvent(new window.MouseEvent("contextmenu", {
      bubbles:true, cancelable:true, clientX:400, clientY:300
    }));
    doc.querySelector('#ctxMenu [data-ctx-action="add-status"]').click();
    assert.strictEqual(T.state.nodes.filter(n => n.type === "status").length, countBeforeCanvas + 1,
      "blank-canvas context menu creates a status node at the requested point");
    doc.getElementById("btnAddStatus").click();
    assert.strictEqual(T.state.nodes.filter(n => n.type === "status").length, countBeforeCanvas + 2,
      "toolbar creates a status node");

    const concept = T.addNode("concept", 2100, 200);
    T.addEdge({id:second.id}, {id:concept.id});
    const statusEdge = T.state.edges.at(-1);
    assert.strictEqual(statusEdge.kind, "link", "status nodes connect using normal link edges");
    statusEdge.kind = "1:N";
    assert(T.lintDocument().some(issue => /status node.*use a link edge/i.test(issue.msg)),
      "lint rejects relational edges that touch a status node");

    T.setSelection("node", second.id);
    T.copySelection();
    T.setDocDirty(false);
    T.newDoc();
    sameList(T.customStatuses, [], "new document clears the previous diagram's status catalog");
    T.pasteSelection();
    sameList(T.customStatuses, ["Waiting for review"],
      "pasting a custom-status node into another diagram registers its label universally");
    assert.strictEqual(T.state.nodes[0].status, "Waiting for review",
      "cross-diagram paste preserves the node's custom selection");

    T.importDocText(JSON.stringify({
      version:1, nextId:3,
      nodes:[
        {id:"n1", type:"status", x:0, y:0, title:"Legacy custom", status:"Ready for launch", statusSide:"left"},
        {id:"n2", type:"status", x:400, y:0, title:"Invalid", status:"", statusSide:"above"}
      ], edges:[]
    }));
    sameList(T.customStatuses, ["Ready for launch"],
      "loading a status-node custom label repairs legacy JSON that lacks catalog metadata");
    assert.strictEqual(T.state.nodes[0].status, "Ready for launch", "legacy custom selection is preserved");
    assert.strictEqual(T.state.nodes[1].status, "Not started", "blank imported status falls back safely");
    assert.strictEqual(T.state.nodes[1].statusSide, "right", "invalid imported side falls back safely");
    T.selectNode("n2");
    assert([...doc.getElementById("statusValue").options].some(option => option.value === "Ready for launch"),
      "recovered legacy custom label is universal after import");

    T.setDocDirty(false);
    T.newDoc();
    sameList(T.customStatuses, [], "a new diagram starts with a fresh custom status catalog");
    assert.strictEqual(Object.hasOwn(JSON.parse(T.serializeDocument()).meta, "customStatuses"), false,
      "documents without custom statuses omit the metadata key");
  }

  {
    const { window } = makeDom({ fsa: true });
    assert.strictEqual(window.__T.FSA, true, "FSA feature-detects present API");
    await window.__T.openDoc();
    assert.strictEqual(window.__T.state.nodes[0].title, "Opened", "FSA open imports selected file");
    assert.strictEqual(window.__T.doc.name, "opened.schematic", "FSA open stores document name");
    window.__T.setDocDirty(true);
    await window.__T.saveDoc();
    assert(window.__handles.openHandle.written.includes("\"version\": 1"), "FSA save writes serialized JSON to existing handle");
    assert.strictEqual(window.__T.doc.dirty, false, "FSA save clears dirty state");
    window.__T.doc.handle = null;
    window.__T.setDocDirty(true);
    await window.__T.saveAsDoc();
    assert(window.__handles.saveHandle.written.includes("\"nodes\""), "FSA Save As writes to new handle");
    assert.strictEqual(window.__T.doc.name, "saved.schematic", "FSA Save As updates document name");
  }

  {
    const { window } = makeDom({ fsa: true });
    const badHandle = {
      name: "denied.schematic",
      async createWritable(){
        const err = new Error("denied");
        err.name = "NotAllowedError";
        throw err;
      }
    };
    window.__T.doc.handle = badHandle;
    await window.__T.saveDoc();
    assert(window.__handles.saveHandle.written.includes("\"version\": 1"), "NotAllowedError falls back to Save As");
  }

  {
    const { window, alerts } = makeDom();
    const before = window.__T.state.nodes[0].title;
    assert.throws(
      () => window.__T.importDocText(JSON.stringify({ version: 99, nodes: [], edges: [] })),
      /newer version/,
      "future documents are rejected"
    );
    assert.strictEqual(window.__T.state.nodes[0].title, before, "failed import leaves state untouched");
    const input = window.document.getElementById("fileInput");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: "future.schematic", text: async () => JSON.stringify({ version: 99, nodes: [], edges: [] }) }]
    });
    input.dispatchEvent(new window.Event("change"));
    await delay(0);
    assert(alerts.some(msg => msg.includes("newer Schematic")), "file input reports newer-version imports clearly");
  }

  {
    const { window } = makeDom();
    window.__T.setDocDirty(false);
    window.__T.pushHistory();
    assert.strictEqual(window.__T.doc.dirty, true, "pushHistory marks document dirty");
    assert(window.document.getElementById("docLabel").textContent.startsWith("● "), "dirty label shows dot");
    const ev = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    assert.strictEqual(ev.defaultPrevented, true, "dirty document prevents unload");
  }

  {
    const { window, storage } = makeDom();
    window.__T.setDocDirty(true);
    await delay(2100);
    const recovery = JSON.parse(storage.getItem("schematic.recovery"));
    assert(recovery.json.includes("\"version\": 1"), "dirty document writes recovery snapshot");
  }

  {
    const { window } = makeDom({ storageThrows: true });
    assert.strictEqual(window.__T.RECOVERY, false, "throwing localStorage disables recovery without blocking startup");
    window.__T.setDocDirty(true);
    assert.strictEqual(window.__T.doc.dirty, true, "app still tracks dirty without localStorage");
  }

  /* SCH-017 — persistent custom color palette */
  {
    const { window } = makeDom();
    const T = window.__T;
    sameList(T.pushRecentColor([], "AB12CD"), ["#ab12cd"], "pushRecentColor normalizes and prepends");
    sameList(T.pushRecentColor(["#ab12cd"], "#abc"), ["#aabbcc", "#ab12cd"], "3-digit shorthand expands");
    sameList(T.pushRecentColor(["#aabbcc", "#ab12cd"], "ab12cd"), ["#ab12cd", "#aabbcc"], "re-entering a color moves it to the front without duplicating");
    const full = ["#000001","#000002","#000003","#000004","#000005","#000006","#000007","#000008"];
    const capped = T.pushRecentColor(full, "#000009");
    assert.strictEqual(capped.length, 8, "palette is capped at 8 entries");
    assert.strictEqual(capped[0], "#000009", "newest color is first");
    assert(!capped.includes("#000008"), "oldest color drops off when capped");
    const list = ["#ab12cd"];
    assert.strictEqual(T.pushRecentColor(list, "#FFE9A8"), list, "preset colors are never recorded");
    assert.strictEqual(T.pushRecentColor(list, "not-a-color"), list, "invalid hex is ignored");
    sameList(T.mergeRecentColors(["#111111"], ["#222222", "#111111"]),
      ["#111111", "#222222"], "merge dedupes with document colors winning on order");
  }

  {
    const { window, storage } = makeDom();
    const T = window.__T;
    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);
    const hex = window.document.querySelector("#inspector .hexinput");
    hex.value = "ab12cd";
    hex.dispatchEvent(new window.Event("input"));
    hex.dispatchEvent(new window.Event("blur"));
    sameList(T.recentColors, ["#ab12cd"], "committed custom hex joins the palette");
    assert.strictEqual(concept.color, "#ab12cd", "committed custom hex is applied to the node");
    const recentSwatches = [...window.document.querySelectorAll("#inspector .swatches.recent .swatch")]
      .map(b => b.title);
    assert(recentSwatches.includes("#ab12cd"), "recent swatch row shows the committed color");
    sameList(JSON.parse(storage.getItem("schematic.recentColors")), ["#ab12cd"],
      "palette is mirrored to localStorage");
    const parsed = JSON.parse(T.serializeDocument());
    sameList(parsed.meta.recentColors, ["#ab12cd"], "palette serializes into meta.recentColors");
  }

  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({ version: 1, nextId: 2, nodes: [], edges: [],
      meta: { recentColors: ["#123456"] } }));
    sameList(T.recentColors, ["#123456"], "import adopts the document palette");
  }

  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({ version: 1, nextId: 2, nodes: [], edges: [] }));
    const parsed = JSON.parse(T.serializeDocument());
    assert.strictEqual(parsed.meta.theme, "light", "documents without custom colors still persist the default theme");
    assert(!("recentColors" in parsed.meta), "documents without custom colors omit meta.recentColors");
  }

  {
    const { window } = makeDom({ storageSeed: { "schematic.recentColors": JSON.stringify(["#123456"]) } });
    sameList(window.__T.recentColors, ["#123456"], "stored palette loads at startup");
  }

  {
    const { window } = makeDom({ storageThrows: true });
    const T = window.__T;
    T.recordRecentColor("#ab12cd");
    sameList(T.recentColors, ["#ab12cd"], "palette works in memory when localStorage throws");
  }

  {
    const { window } = makeDom();
    const T = window.__T;
    const depth = window.__T.state.nodes.length; // ensure history untouched by palette ops
    const before = T.doc.dirty;
    T.recordRecentColor("#ab12cd");
    assert.strictEqual(T.doc.dirty, before, "recording a palette color alone does not dirty the document");
    assert.strictEqual(T.state.nodes.length, depth, "palette ops leave canvas state alone");
  }

  /* SCH-092 — unified, accessible color picker */
  {
    const { window, storage } = makeDom();
    const T = window.__T, doc = window.document;
    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);

    let picker = doc.querySelector("#inspector .color-picker");
    let summary = picker.querySelector(".color-picker-summary");
    assert.strictEqual(summary.getAttribute("aria-expanded"), "false",
      "inspector color picker starts as a compact current-color summary");
    assert(picker.querySelector(".color-current-name").textContent.length > 0,
      "current color has a human-readable name");
    assert(/^#[0-9A-F]{6}$/.test(picker.querySelector(".color-current-hex").textContent),
      "current color keeps an exact, readable hex value");
    summary.click();
    assert.strictEqual(summary.getAttribute("aria-expanded"), "true",
      "current-color summary expands the picker");
    assert.strictEqual(picker.querySelector(".color-picker-panel").hidden, false,
      "expanded picker exposes its controls");
    const selected = picker.querySelector('.swatch[aria-pressed="true"]');
    assert(selected && selected.querySelector(".swatch-check"),
      "selected swatch exposes pressed state and a visible check icon");
    assert([...picker.querySelectorAll(".swatch")].every(s => s.getAttribute("aria-label")),
      "every palette swatch has a descriptive accessible name");

    const hex = picker.querySelector(".hexinput");
    hex.value = "nothex";
    hex.dispatchEvent(new window.Event("input"));
    hex.dispatchEvent(new window.Event("blur"));
    assert.strictEqual(hex.getAttribute("aria-invalid"), "true",
      "invalid custom colors are identified accessibly");
    assert.strictEqual(picker.querySelector(".color-error").hidden, false,
      "invalid custom colors explain the required format");

    hex.value = "abcdef";
    hex.dispatchEvent(new window.Event("input"));
    hex.dispatchEvent(new window.Event("blur"));
    sameList(T.recentColors, ["#abcdef"], "valid custom colors join the shared recent palette");
    picker = doc.querySelector("#inspector .color-picker");
    assert.strictEqual(picker.querySelector(".color-current-name").textContent, "Custom color",
      "custom colors are clearly distinguished from named presets");
    assert.strictEqual(picker.querySelector(".color-current-hex").textContent, "#ABCDEF",
      "custom color summary uses a copy-friendly uppercase value");

    T.state.edges[0].lineColor = "#13579B";
    T.render();
    picker = doc.querySelector("#inspector .color-picker");
    assert(picker.querySelector('.color-picker-section.document .swatch[data-color="#13579b"]'),
      "picker offers reusable colors already present elsewhere in the diagram");
    const clear = picker.querySelector(".color-picker-section.recent .color-picker-action");
    assert(clear, "recent colors include a clear action");
    clear.click();
    sameList(T.recentColors, [], "clear removes all recent colors");
    sameList(JSON.parse(storage.getItem("schematic.recentColors")), [],
      "clearing recent colors updates local persistence");
    assert.strictEqual(doc.querySelectorAll(".color-picker-section.recent").length, 0,
      "clear immediately removes recent sections from every visible picker");

    T.nodeMenu(concept, 10, 10);
    const contextPicker = doc.querySelector("#ctxMenu .color-picker.context");
    assert(contextPicker, "right-click colors use the same picker component as the inspector");
    assert.strictEqual(contextPicker.querySelector(".color-picker-panel").hidden, false,
      "context-menu picker opens directly for fast color changes");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);
    const before = T.undoDepth;
    const alternate = [...doc.querySelectorAll("#inspector .color-picker .swatches .swatch")]
      .find(swatch => swatch.getAttribute("aria-pressed") === "false");
    alternate.click();
    assert.strictEqual(T.undoDepth, before + 1, "a color choice creates exactly one undo step");
  }

  /* SCH-096 — transparent palette values with opaque white compositing */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    assert.strictEqual(T.normalizeColorValue("#00787380"), "#00787380",
      "8-digit colors preserve their editable alpha byte");
    assert.strictEqual(T.colorBaseHex("#00787380"), "#007873",
      "the editable hex remains separate from transparency");
    assert.strictEqual(T.colorTransparency("#00787380"), 50,
      "the alpha byte maps back to the transparency percentage");
    assert.strictEqual(T.composeColorValue("#007873", 50), "#00787380",
      "base hex and transparency compose into a saved color value");
    assert.strictEqual(T.normalizeHex("#00787380"), "#7fbbb9",
      "transparent colors are composited over white for display");
    assert.strictEqual(T.normalizeHex("#00787300"), "#ffffff",
      "fully transparent colors display as opaque white");
    assert.strictEqual(T.normalizeHex("#007873"), "#007873",
      "legacy six-digit colors remain unchanged");

    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);
    const picker = doc.querySelector("#inspector .color-picker");
    picker.querySelector(".color-picker-summary").click();
    const slider = picker.querySelector('[aria-label="Color transparency"]');
    assert(slider, "the shared inspector color picker includes a transparency slider");
    assert.strictEqual(slider.value, "0", "existing colors start opaque");
    const before = T.undoDepth;
    slider.value = "50";
    slider.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(concept.color, "#ffe9a880",
      "live slider changes retain the base hex and store transparency");
    assert.strictEqual(picker.querySelector(".color-current-hex").textContent, "#FFE9A8",
      "the picker summary continues to show the base six-digit hex");
    assert.strictEqual(picker.querySelector(".color-current-transparency").textContent, "50% transparent",
      "the picker summary exposes the current transparency");
    assert.strictEqual(picker.querySelector(".color-transparency output").textContent, "50%",
      "the slider has a visible percentage readout");
    const visible = T.normalizeHex(concept.color);
    const shape = doc.querySelector(`[data-node="${concept.id}"] [data-node-shape]`);
    assert.strictEqual(shape.getAttribute("fill"), visible,
      "the canvas shape receives the opaque white-composited color");
    assert(/^#[0-9a-f]{6}$/i.test(shape.getAttribute("fill")),
      "the rendered canvas color is a six-digit opaque hex");
    slider.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(T.undoDepth, before + 1, "a transparency gesture creates exactly one undo step");
    assert(T.recentColors.includes("#ffe9a880"), "settled transparent colors join the recent palette");

    const saved = T.serializeDocument();
    const savedNode = JSON.parse(saved).nodes.find(n => n.id === concept.id);
    assert.strictEqual(savedNode.color, "#ffe9a880", "documents preserve the editable transparent color");
    const svg = T.serializedSvg(true);
    assert(svg.includes(`fill="${visible}"`), "SVG export contains the white-composited fill");
    assert(!svg.includes("#ffe9a880"), "SVG export never leaks an alpha color into the canvas representation");
    T.importDocText(saved);
    const imported = T.state.nodes.find(n => n.id === concept.id);
    assert.strictEqual(imported.color, "#ffe9a880", "transparent colors survive save and reload");
    assert.strictEqual(doc.querySelector(`[data-node="${concept.id}"] [data-node-shape]`).getAttribute("fill"), visible,
      "reloaded transparent colors still render as the same opaque composite");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);
    let picker = doc.querySelector("#inspector .color-picker");
    picker.querySelector(".color-picker-summary").click();
    let slider = picker.querySelector('[aria-label="Color transparency"]');
    slider.value = "40";
    slider.dispatchEvent(new window.Event("input", {bubbles:true}));
    const hex = picker.querySelector(".hexinput");
    hex.value = "007873";
    hex.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(concept.color, T.composeColorValue("#007873", 40),
      "editing the base hex preserves the active transparency");
    hex.dispatchEvent(new window.Event("blur"));
    picker = doc.querySelector("#inspector .color-picker");
    picker.querySelector('.swatch[title="#CFE8FF"]').click();
    assert.strictEqual(concept.color, T.composeColorValue("#CFE8FF", 40),
      "choosing a palette hue preserves the active transparency");

    T.nodeMenu(concept, 10, 10);
    assert(doc.querySelector('#ctxMenu [aria-label="Color transparency"]'),
      "right-click color pickers expose the same transparency control");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    const edge = T.state.edges.find(e => e.label);
    const lane = T.state.nodes.find(n => n.type === "swimlane");
    edge.lineColor = "#00787380";
    edge.labelTextColor = "#c2002980";
    edge.labelBackgroundColor = "#ffe9a880";
    lane.color = "#00787380";
    lane.titleColor = "#c2002980";
    T.render();
    assert.strictEqual(doc.querySelector(`[data-edge="${edge.id}"] [data-edge-line]`).getAttribute("stroke"),
      T.normalizeHex(edge.lineColor), "link strokes are opaque composites");
    assert.strictEqual(doc.querySelector(`[data-edge="${edge.id}"] [data-edge-label]`).getAttribute("fill"),
      T.normalizeHex(edge.labelTextColor), "link label text is an opaque composite");
    assert.strictEqual(doc.querySelector(`[data-edge="${edge.id}"] [data-edge-label-bg]`).getAttribute("fill"),
      T.normalizeHex(edge.labelBackgroundColor), "link label backgrounds are opaque composites");
    assert.strictEqual(doc.querySelector(`[data-swimlane="${lane.id}"] [data-swimlane-body]`).getAttribute("fill"),
      T.normalizeHex(lane.color), "swimlane bodies are opaque composites");
    assert.strictEqual(doc.querySelector(`[data-swimlane="${lane.id}"] [data-swimlane-title-band]`).getAttribute("fill"),
      T.normalizeHex(lane.titleColor), "swimlane title bands are opaque composites");
    const saved = JSON.parse(T.serializeDocument());
    assert.strictEqual(saved.edges.find(e => e.id === edge.id).lineColor, "#00787380",
      "link transparency remains editable in saved documents");
    assert.strictEqual(saved.nodes.find(n => n.id === lane.id).titleColor, "#c2002980",
      "structural-node transparency remains editable in saved documents");
  }

  /* SCH-010 — multi-select, marquee, group drag */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.setView({ x:0, y:0, k:1 });
    const first = T.state.nodes.find(n => n.title === "Loyalty program launch");
    const second = T.state.nodes.find(n => n.title === "Tiered rewards");
    T.selectNode(first.id);
    let g = window.document.querySelector(`[data-node="${second.id}"]`);
    firePointer(window, g, "pointerdown", { clientX:second.x + 5, clientY:second.y + 5, shiftKey:true });
    firePointer(window, window.document.getElementById("board"), "pointerup",
      { clientX:second.x + 5, clientY:second.y + 5, shiftKey:true });
    sameList(T.selection.ids.sort(), [first.id, second.id].sort(), "shift-click toggles a node into the selection");
    g = window.document.querySelector(`[data-node="${second.id}"]`);
    firePointer(window, g, "pointerdown", { clientX:second.x + 5, clientY:second.y + 5, shiftKey:true });
    firePointer(window, window.document.getElementById("board"), "pointerup",
      { clientX:second.x + 5, clientY:second.y + 5, shiftKey:true });
    sameList(T.selection.ids, [first.id], "stationary Shift-click still toggles a selected node out");

    T.clearSelection();
    T.render();
    const board = window.document.getElementById("board");
    const firstRect = T.nodeRect(first), secondRect = T.nodeRect(second);
    const marquee = {
      x1:Math.min(firstRect.x, secondRect.x) - 10,
      y1:Math.min(firstRect.y, secondRect.y) - 10,
      x2:Math.max(firstRect.x + firstRect.w, secondRect.x + secondRect.w) + 10,
      y2:Math.max(firstRect.y + firstRect.h, secondRect.y + secondRect.h) + 10
    };
    firePointer(window, board, "pointerdown", { clientX:marquee.x1, clientY:marquee.y1 });
    firePointer(window, board, "pointermove", { clientX:marquee.x2, clientY:marquee.y2 });
    firePointer(window, board, "pointerup", { clientX:marquee.x2, clientY:marquee.y2 });
    assert(T.selection.ids.includes(first.id), "marquee selects fully enclosed first node");
    assert(T.selection.ids.includes(second.id), "marquee selects fully enclosed second node");

    T.importDocText(JSON.stringify({version:1, nextId:4, edges:[], nodes:[
      {id:"exact", type:"text", x:100, y:100, title:"Fully enclosed", color:"#CFE8FF",
       fontSize:18, w:100, manualWidth:true, h:60, manualHeight:true},
      {id:"partial", type:"text", x:240, y:100, title:"Partially enclosed", color:"#D8F3DC",
       fontSize:18, w:100, manualWidth:true, h:60, manualHeight:true},
      {id:"outside", type:"text", x:380, y:100, title:"Outside", color:"#FFE9A8",
       fontSize:18, w:100, manualWidth:true, h:60, manualHeight:true}
    ]}));
    T.setView({x:0, y:0, k:1});
    assert(T.rectFullyContains({x:90, y:90, w:110, h:70}, T.nodeRect(T.state.nodes[0])),
      "full containment includes an object whose far edges exactly match the marquee");
    assert(!T.rectFullyContains({x:90, y:90, w:150, h:70}, T.nodeRect(T.state.nodes[1])),
      "touching only an object's near edge is not full containment");
    const exactBoard = window.document.getElementById("board");
    firePointer(window, exactBoard, "pointerdown", {clientX:90, clientY:90});
    firePointer(window, exactBoard, "pointermove", {clientX:290, clientY:170});
    firePointer(window, exactBoard, "pointerup", {clientX:290, clientY:170});
    sameList(T.selection.ids, ["exact"],
      "marquee selects the fully enclosed object but excludes a substantially intersected object");

    firePointer(window, exactBoard, "pointerdown", {clientX:240, clientY:170});
    firePointer(window, exactBoard, "pointermove", {clientX:90, clientY:90});
    firePointer(window, exactBoard, "pointerup", {clientX:90, clientY:90});
    sameList(T.selection.ids, ["exact"],
      "marquee excludes an object that is only touched by the selection boundary");

    T.importDocText(JSON.stringify({version:1, nextId:3, edges:[], nodes:[
      {id:"frame", type:"frame", x:100, y:100, title:"Enclosed frame", color:"#007873", w:120, h:100},
      {id:"lane", type:"swimlane", orientation:"horizontal", x:260, y:100, title:"Partial lane",
       color:"#E7F4F3", titleColor:"#007873", w:260, h:100}
    ]}));
    T.setView({x:0, y:0, k:1});
    assert(T.rectFullyContains({x:90, y:90, w:310, h:120}, T.nodeRect(T.state.nodes[0])),
      "structural frame bounds fit completely inside the marquee fixture");
    firePointer(window, exactBoard, "pointerdown", {clientX:400, clientY:210});
    firePointer(window, exactBoard, "pointermove", {clientX:90, clientY:90});
    firePointer(window, exactBoard, "pointerup", {clientX:90, clientY:90});
    sameList(T.selection.ids, ["frame"],
      "marquee applies full containment to structural objects as well as ordinary nodes");

    T.importDocText(JSON.stringify({version:1, nextId:3, edges:[], nodes:[
      {id:"collapsed", type:"frame", x:100, y:260, title:"Collapsed frame", color:"#2456E6",
       w:300, h:200, collapsed:true},
      {id:"hidden", type:"concept", x:140, y:320, title:"Hidden child", color:"#FFE9A8"}
    ]}));
    T.setView({x:0, y:0, k:1});
    firePointer(window, exactBoard, "pointerdown", {clientX:330, clientY:320});
    firePointer(window, exactBoard, "pointermove", {clientX:90, clientY:250});
    firePointer(window, exactBoard, "pointerup", {clientX:90, clientY:250});
    sameList(T.selection.ids, ["collapsed"],
      "marquee selects a fully enclosed collapsed frame without selecting its hidden contents");

    T.importDocText(JSON.stringify({version:1, nextId:3, edges:[], nodes:[first, second]}));
    T.setView({x:0, y:0, k:1});
    const importedFirst = T.state.nodes.find(n => n.id === first.id);
    const importedSecond = T.state.nodes.find(n => n.id === second.id);
    T.setSelection("node", [importedFirst.id, importedSecond.id]);
    T.render();
    const beforeUndo = T.undoDepth;
    const x1 = importedFirst.x, x2 = importedSecond.x;
    g = window.document.querySelector(`[data-node="${importedFirst.id}"]`);
    firePointer(window, g, "pointerdown", { clientX:importedFirst.x + 10, clientY:importedFirst.y + 10 });
    firePointer(window, board, "pointermove", { clientX:importedFirst.x + 90, clientY:importedFirst.y + 10 });
    firePointer(window, board, "pointerup", { clientX:importedFirst.x + 90, clientY:importedFirst.y + 10 });
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "group drag creates one history entry");
    assert(importedFirst.x > x1 && importedSecond.x > x2, "group drag moves all selected nodes");
    T.undo();
    assert.strictEqual(T.state.nodes.find(n => n.id === importedFirst.id).x, x1, "undo restores first node after group drag");
    assert.strictEqual(T.state.nodes.find(n => n.id === importedSecond.id).x, x2, "undo restores second node after group drag");

    const beforeCount = T.state.nodes.length;
    T.setSelection("node", [importedFirst.id, importedSecond.id]);
    T.duplicateSelection();
    assert.strictEqual(T.state.nodes.length, beforeCount + 2, "duplicate operates on all selected nodes");
    assert.strictEqual(T.selection.ids.length, 2, "duplicate selects the duplicated node set");
  }

  /* SCH-080 — Shift temporarily snaps item drags to the visible grid */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    T.importDocText(JSON.stringify({version:1, nextId:2, edges:[], nodes:[
      {id:"n1", type:"concept", x:61, y:70, title:"Shift me", notes:"", color:"#FFE9A8"}
    ]}));
    T.setView({x:0, y:0, k:1});
    let node = T.state.nodes[0];
    let group = doc.querySelector('[data-node="n1"]');
    const beforeDepth = T.undoDepth;
    firePointer(window, group, "pointerdown", {clientX:66, clientY:75, shiftKey:true});
    firePointer(window, board, "pointermove", {clientX:103, clientY:106, shiftKey:true});
    assert.strictEqual(node.x, 96, "Shift held from pointerdown snaps drag x to the 24px grid");
    assert.strictEqual(node.y, 96, "Shift held from pointerdown snaps drag y to the 24px grid");
    assert.strictEqual(node.x % 24, 0, "Shift-dragged node x is grid aligned");
    assert.strictEqual(node.y % 24, 0, "Shift-dragged node y is grid aligned");
    assert(T.selection.ids.includes("n1"), "Shift-drag selects an initially unselected node");
    assert.strictEqual(doc.getElementById("btnSnap").getAttribute("aria-pressed"), "false",
      "temporary Shift snapping does not enable persistent snap");
    assert.strictEqual(T.undoDepth, beforeDepth + 1, "Shift drag creates one undo entry");

    firePointer(window, board, "pointermove", {clientX:89, clientY:94, shiftKey:false});
    assert.strictEqual(node.x, 84, "releasing Shift mid-drag restores fine-grid x positioning");
    assert.strictEqual(node.y, 88, "releasing Shift mid-drag restores fine-grid y positioning");
    assert(node.x % 24 !== 0 && node.y % 24 !== 0,
      "released modifier no longer forces the visible grid");
    firePointer(window, board, "pointerup", {clientX:89, clientY:94});
    assert.strictEqual(T.undoDepth, beforeDepth + 1, "modifier changes remain one drag undo step");

    T.undo();
    node = T.state.nodes[0];
    assert.deepStrictEqual({x:node.x, y:node.y}, {x:61, y:70}, "undo restores the pre-drag position");
    doc.getElementById("btnSnap").click();
    group = doc.querySelector('[data-node="n1"]');
    firePointer(window, group, "pointerdown", {clientX:66, clientY:75});
    firePointer(window, board, "pointermove", {clientX:89, clientY:94});
    firePointer(window, board, "pointerup", {clientX:89, clientY:94});
    assert.strictEqual(node.x % 24, 0, "persistent snap still aligns x without Shift");
    assert.strictEqual(node.y % 24, 0, "persistent snap still aligns y without Shift");
  }

  /* SCH-081 — nearby objects expose edge/center guides and capture matching axes */
  {
    const { window } = makeDom();
    const T = window.__T;
    const moving = {x:96, y:194, w:100, h:50, cx:146, cy:219};
    const target = {x:100, y:200, w:120, h:60, cx:160, cy:230};
    const snap = T.smartAlignmentSnap(moving, [target], 6);
    assert.strictEqual(snap.dx, 4, "left edge captures the nearest target x coordinate");
    assert.strictEqual(snap.dy, 6, "top edge captures the nearest target y coordinate");
    assert.strictEqual(snap.xMatch.movingKey, "left", "x guide records the matching moving edge");
    assert.strictEqual(snap.yMatch.movingKey, "top", "y guide records the matching moving edge");
    const geometry = T.alignmentGuideGeometry(snap,
      {x:100, y:200, w:100, h:50, cx:150, cy:225}, 24);
    assert.strictEqual(geometry.x.coordinate, 100, "vertical guide uses the captured x coordinate");
    assert.strictEqual(geometry.y.coordinate, 200, "horizontal guide uses the captured y coordinate");
    assert(geometry.x.from < 200 && geometry.x.to > 260,
      "vertical guide spans both objects with overshoot");
    assert(geometry.y.from < 100 && geometry.y.to > 220,
      "horizontal guide spans both objects with overshoot");

    const centerSnap = T.smartAlignmentSnap(
      {x:107, y:320, w:100, h:40, cx:157, cy:340},
      [{x:100, y:100, w:120, h:80, cx:160, cy:140}], 4);
    assert.strictEqual(centerSnap.xMatch.movingKey, "center", "horizontal centers can align");
    assert.strictEqual(centerSnap.xMatch.targetKey, "center", "center guide targets the other center");
    assert.strictEqual(centerSnap.yMatch, null, "axes outside the threshold remain independent");
    const free = T.smartAlignmentSnap(
      {x:107, y:320, w:100, h:40, cx:157, cy:340},
      [{x:100, y:100, w:120, h:80, cx:160, cy:140}], 2);
    assert.strictEqual(free.xMatch, null, "coordinates outside the threshold stay unsnapped");
  }

  /* SCH-104 — equal edge gaps snap a dragged middle object and expose paired guides. */
  {
    const { window } = makeDom();
    const T = window.__T;
    const rect = (x, y, w, h) => ({x, y, w, h, cx:x + w / 2, cy:y + h / 2});
    const left = rect(100, 200, 100, 50);
    const right = rect(500, 200, 100, 50);
    const moving = rect(294, 204, 100, 50);
    const horizontal = T.smartDistributionSnap(moving, [left, right], 6);
    assert(horizontal.xMatch, "a near-centered object detects equal horizontal gaps");
    assert.strictEqual(horizontal.xMatch.delta, 6, "horizontal distribution captures the exact equal-gap x");
    assert.strictEqual(horizontal.xMatch.crossDelta, -4, "horizontal distribution also captures the shared row");
    assert.strictEqual(horizontal.xMatch.gap, 100, "horizontal guide records the common edge gap");
    assert.strictEqual(horizontal.xMatch.alignmentKey, "top", "the shared row alignment is explicit");

    const top = rect(120, 40, 80, 60);
    const bottom = rect(120, 400, 80, 60);
    const verticalMoving = rect(116, 196, 80, 100);
    const vertical = T.smartDistributionSnap(verticalMoving, [top, bottom], 6);
    assert(vertical.yMatch, "a near-centered object detects equal vertical gaps");
    assert.strictEqual(vertical.yMatch.delta, 4, "vertical distribution captures the exact equal-gap y");
    assert.strictEqual(vertical.yMatch.crossDelta, 4, "vertical distribution captures the shared column");
    assert.strictEqual(vertical.yMatch.gap, 100, "vertical guide records the common edge gap");

    const misaligned = T.smartDistributionSnap(moving,
      [left, rect(500, 220, 100, 50)], 6);
    assert.strictEqual(misaligned.xMatch, null,
      "distribution is not suggested when the outside objects are not in one row");
    const tooFar = T.smartDistributionSnap(rect(275, 200, 100, 50), [left, right], 6);
    assert.strictEqual(tooFar.xMatch, null, "distribution remains inactive outside the snap threshold");

    const differentSizes = T.smartDistributionSnap(rect(294, 200, 100, 50), [
      rect(100, 200, 100, 50), rect(500, 175, 100, 100)
    ], 6);
    assert(differentSizes.xMatch, "objects with different heights can distribute on a shared middle");
    assert.strictEqual(differentSizes.xMatch.alignmentKey, "middle",
      "distribution finds a shared center when top and bottom differ");

    const combined = T.smartObjectSnap(moving, [left, right], 6);
    assert.strictEqual(combined.dx, 6, "object snap applies the horizontal distribution correction");
    assert.strictEqual(combined.dy, -4, "object snap applies the companion row correction");
    assert(combined.xSnapped && combined.ySnapped, "distribution captures both axes as one semantic snap");
    assert(combined.distributeX, "object snap retains distribution geometry for rendering");
    const withIncidentalAlignment = T.smartObjectSnap(moving, [left, right,
      rect(1000, 204, 50, 50)], 6);
    assert(withIncidentalAlignment.distributeX,
      "a valid three-object spacing snap outranks an unrelated exact one-axis alignment");
    assert.strictEqual(withIncidentalAlignment.dy, -4,
      "distribution keeps the shared outer row despite an incidental alignment elsewhere");
    const geometry = T.alignmentGuideGeometry(combined, rect(300, 200, 100, 50), 24);
    assert.strictEqual(geometry.distributeX.before.from, 200,
      "the first guide begins at the left object's trailing edge");
    assert.strictEqual(geometry.distributeX.before.to, 300,
      "the first guide ends at the moving object's leading edge");
    assert.strictEqual(geometry.distributeX.after.from, 400,
      "the second guide begins at the moving object's trailing edge");
    assert.strictEqual(geometry.distributeX.after.to, 500,
      "the second guide ends at the right object's leading edge");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    const concept = (id, x, y) => ({id, type:"concept", x, y, title:id,
      notes:"", color:"#CFE4FA", w:100, manualWidth:true});
    T.importDocText(JSON.stringify({version:1, nextId:4, edges:[], nodes:[
      concept("left", 100, 200), concept("moving", 294, 204), concept("right", 500, 200)
    ]}));
    T.setView({x:0, y:0, k:1});
    T.setSelection("node", "moving");
    T.render();
    let movingNode = T.state.nodes.find(node => node.id === "moving");
    let group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:299, clientY:209});
    firePointer(window, board, "pointermove", {clientX:299, clientY:209});
    assert.strictEqual(movingNode.x, 300, "drag snaps the middle node to equal horizontal gaps");
    assert.strictEqual(movingNode.y, 200, "drag aligns the middle node to the outside row");
    assert(doc.querySelector("[data-distribute-guide-x]"),
      "paired horizontal distribution guides appear during the drag");
    assert.strictEqual(doc.querySelectorAll("[data-distribute-guide-x] > line").length, 10,
      "the distribution guide draws two measured segments with equal-length notches");
    assert(!T.serializedSvg(true).includes("data-distribute-guide"),
      "SVG export excludes temporary distribution guides");
    firePointer(window, board, "pointermove", {clientX:339, clientY:209});
    assert(!doc.querySelector("[data-distribute-guide-x], [data-distribute-guide-y]"),
      "distribution guides clear as soon as the drag moves away");
    firePointer(window, board, "pointermove", {clientX:299, clientY:209});
    firePointer(window, board, "pointerup", {clientX:299, clientY:209});
    assert.strictEqual(movingNode.x, 300, "drop preserves the exact equal-gap position");
    assert(!doc.querySelector("[data-distribute-guide-x], [data-distribute-guide-y]"),
      "distribution guides clear after drop");

    T.undo();
    movingNode = T.state.nodes.find(node => node.id === "moving");
    T.setSelection("node", "moving");
    T.render();
    group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:299, clientY:209, shiftKey:true});
    firePointer(window, board, "pointermove", {clientX:299, clientY:209, shiftKey:true});
    assert.strictEqual(movingNode.x % 24, 0, "Shift grid snapping still takes precedence over distribution");
    assert(!doc.querySelector("[data-distribute-guide-x], [data-distribute-guide-y]"),
      "grid snapping suppresses equal-spacing guides");
    firePointer(window, board, "pointerup", {clientX:299, clientY:209, shiftKey:true});
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    const concept = (id, x, y) => ({id, type:"concept", x, y, title:id,
      notes:"", color:"#D8F3DC", w:80, manualWidth:true});
    T.importDocText(JSON.stringify({version:1, nextId:4, edges:[], nodes:[
      concept("top", 120, 40), concept("moving", 116, 0), concept("bottom", 120, 400)
    ]}));
    T.setView({x:0, y:0, k:1});
    const movingNode = T.state.nodes.find(node => node.id === "moving");
    const topRect = T.nodeRect(T.state.nodes.find(node => node.id === "top"));
    const bottomRect = T.nodeRect(T.state.nodes.find(node => node.id === "bottom"));
    const movingRect = T.nodeRect(movingNode);
    const desiredY = (topRect.y + topRect.h + bottomRect.y - movingRect.h) / 2;
    movingNode.y = desiredY - 4;
    T.setSelection("node", "moving");
    T.render();
    const group = doc.querySelector('[data-node="moving"]');
    const clientX = movingNode.x + 5, clientY = movingNode.y + 5;
    firePointer(window, group, "pointerdown", {clientX, clientY});
    firePointer(window, board, "pointermove", {clientX, clientY});
    assert.strictEqual(movingNode.x, 120, "vertical distribution aligns the middle node to the shared column");
    assert.strictEqual(movingNode.y, desiredY, "vertical distribution snaps to equal top and bottom gaps");
    assert(doc.querySelector("[data-distribute-guide-y]"),
      "paired vertical distribution guides appear during the drag");
    assert.strictEqual(doc.querySelectorAll("[data-distribute-guide-y] > line").length, 10,
      "the vertical guide uses the same two measured segments and matching notches");
    firePointer(window, board, "pointercancel", {clientX, clientY});
    assert(!doc.querySelector("[data-distribute-guide-x], [data-distribute-guide-y]"),
      "cancelled distribution drags leave no guides");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    T.importDocText(JSON.stringify({version:1, nextId:5, edges:[], nodes:[
      {id:"target", type:"concept", x:250, y:130, title:"Target", notes:"", color:"#CFE4FA"},
      {id:"moving", type:"concept", x:40, y:300, title:"Moving", notes:"", color:"#FFE9A8"},
      {id:"partner", type:"concept", x:500, y:400, title:"Partner", notes:"", color:"#D7F0D8"}
    ]}));
    T.setView({x:0, y:0, k:1});
    T.setSelection("node", ["moving", "partner"]);
    T.render();
    const movingNode = T.state.nodes.find(n => n.id === "moving");
    const partnerNode = T.state.nodes.find(n => n.id === "partner");
    const movingStart = {x:movingNode.x, y:movingNode.y};
    const partnerStart = {x:partnerNode.x, y:partnerNode.y};
    let group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:45, clientY:305});
    firePointer(window, board, "pointermove", {clientX:251, clientY:139});
    assert.strictEqual(movingNode.x, 250, "nearby left edges snap exactly during drag");
    assert.strictEqual(movingNode.y, 130, "nearby top edges snap exactly during drag");
    assert(doc.querySelector("[data-align-guide-x]"), "x alignment guide appears during drag");
    assert(doc.querySelector("[data-align-guide-y]"), "y alignment guide appears during drag");
    assert.strictEqual(partnerNode.x - partnerStart.x, movingNode.x - movingStart.x,
      "multi-selection uses one shared snapped x delta");
    assert.strictEqual(partnerNode.y - partnerStart.y, movingNode.y - movingStart.y,
      "multi-selection uses one shared snapped y delta");
    assert(!T.serializedSvg(true).includes("data-align-guide"),
      "SVG export excludes temporary object-alignment guides");
    firePointer(window, board, "pointerup", {clientX:251, clientY:139});
    assert.strictEqual(movingNode.x, 250, "drop preserves the captured x coordinate");
    assert.strictEqual(movingNode.y, 130, "drop preserves the captured y coordinate");
    assert(!doc.querySelector("[data-align-guide-x], [data-align-guide-y]"),
      "alignment guides clear after drop");

    T.undo();
    const restoredMoving = T.state.nodes.find(n => n.id === "moving");
    T.setSelection("node", "moving");
    T.render();
    group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:55, clientY:315});
    firePointer(window, board, "pointermove", {clientX:261, clientY:249});
    assert.strictEqual(restoredMoving.x, 250, "x captures without a nearby y coordinate");
    assert.strictEqual(restoredMoving.y, 236, "unmatched y retains fine-grid movement");
    assert(doc.querySelector("[data-align-guide-x]"), "independent x guide is visible");
    assert(!doc.querySelector("[data-align-guide-y]"), "independent drag does not invent a y guide");
    firePointer(window, board, "pointermove", {clientX:340, clientY:280});
    assert(!doc.querySelector("[data-align-guide-x], [data-align-guide-y]"),
      "guides clear as soon as the drag moves away");
    firePointer(window, board, "pointercancel", {clientX:340, clientY:280});
    assert(!doc.querySelector("[data-align-guide-x], [data-align-guide-y]"),
      "cancelled drag leaves no alignment guides");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    T.importDocText(JSON.stringify({version:1, nextId:3, edges:[], nodes:[
      {id:"target", type:"concept", x:250, y:130, title:"Target", notes:"", color:"#CFE4FA"},
      {id:"moving", type:"concept", x:40, y:300, title:"Moving", notes:"", color:"#FFE9A8"}
    ]}));
    T.setView({x:0, y:0, k:1});
    let movingNode = T.state.nodes.find(n => n.id === "moving");
    let group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:45, clientY:305, shiftKey:true});
    firePointer(window, board, "pointermove", {clientX:251, clientY:139, shiftKey:true});
    assert.strictEqual(movingNode.x, 240, "Shift grid snapping takes precedence over object guides");
    assert.strictEqual(movingNode.y, 144, "Shift grid snapping controls both axes");
    assert(!doc.querySelector("[data-align-guide-x], [data-align-guide-y]"),
      "Shift grid snapping suppresses object guides");
    firePointer(window, board, "pointerup", {clientX:251, clientY:139, shiftKey:true});

    T.undo();
    movingNode = T.state.nodes.find(n => n.id === "moving");
    doc.getElementById("btnSnap").click();
    group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:45, clientY:305});
    firePointer(window, board, "pointermove", {clientX:251, clientY:139});
    assert.strictEqual(movingNode.x, 250, "smart object guides take precedence over persistent grid snapping");
    assert(doc.querySelector("[data-align-guide-x]"),
      "persistent grid mode still surfaces the higher-priority winning object guide");
    firePointer(window, board, "pointerup", {clientX:251, clientY:139});
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    const nodes = [
      {id:"target", type:"concept", x:250, y:130, title:"Target", notes:"", color:"#CFE4FA"},
      {id:"moving", type:"concept", x:40, y:300, title:"Moving", notes:"", color:"#FFE9A8"}
    ];
    for (let i = 0; i < 149; i++) nodes.push({id:`f${i}`, type:"concept",
      x:2000 + i*180, y:1200 + i*90, title:`Filler ${i}`, notes:"", color:"#D7F0D8"});
    T.importDocText(JSON.stringify({version:1, nextId:200, edges:[], nodes}));
    T.setView({x:0, y:0, k:1});
    const group = doc.querySelector('[data-node="moving"]');
    firePointer(window, group, "pointerdown", {clientX:45, clientY:305});
    firePointer(window, board, "pointermove", {clientX:251, clientY:139});
    firePointer(window, board, "pointermove", {clientX:250, clientY:138});
    assert.strictEqual(doc.querySelectorAll("[data-align-guide-x]").length, 1,
      "large-canvas fast rendering replaces the previous x guide");
    assert.strictEqual(doc.querySelectorAll("[data-align-guide-y]").length, 1,
      "large-canvas fast rendering replaces the previous y guide");
    assert(T.renderStats.fast > 0, "large-canvas guide path uses fast drag rendering");
    firePointer(window, board, "pointerup", {clientX:250, clientY:138});
    assert(!doc.querySelector("[data-align-guide-x], [data-align-guide-y]"),
      "large-canvas guides clear after drop");
  }

  {
    const { window } = makeDom();
    const T = window.__T;
    const customers = T.state.nodes.find(n => n.title === "customers");
    const orders = T.state.nodes.find(n => n.title === "orders");
    T.setSelection("node", [customers.id, orders.id]);
    T.deleteSelection();
    assert(!T.state.nodes.some(n => n.id === customers.id || n.id === orders.id), "delete removes all selected nodes");
    assert(!T.state.edges.some(e => e.from === customers.id || e.to === customers.id || e.from === orders.id || e.to === orders.id),
      "delete removes edges attached to selected nodes");
  }

  /* SCH-011 — copy/paste with id and field remapping */
  {
    const { window } = makeDom();
    const T = window.__T;
    const customers = T.state.nodes.find(n => n.title === "customers");
    const orders = T.state.nodes.find(n => n.title === "orders");
    T.setSelection("node", [customers.id, orders.id]);
    assert.strictEqual(T.copySelection(), true, "copySelection succeeds for selected nodes");
    assert.strictEqual(T.pasteSelection(), true, "pasteSelection succeeds from in-memory clipboard");
    const pasted = T.selectedNodes();
    assert.strictEqual(pasted.length, 2, "paste selects the pasted nodes");
    assert(pasted.every(n => n.id !== customers.id && n.id !== orders.id), "pasted nodes get new ids");
    const pastedCustomers = pasted.find(n => n.title === "customers_2");
    const pastedOrders = pasted.find(n => n.title === "orders_2");
    assert(pastedCustomers && pastedOrders, "pasted tables get unique names (issue #46)");
    const pastedEdge = T.state.edges.find(e => e.from === pastedCustomers.id && e.to === pastedOrders.id);
    assert(pastedEdge, "internal edge is preserved on paste");
    assert.notStrictEqual(pastedEdge.fromField, customers.fields[0].id, "fromField binding is remapped");
    assert.notStrictEqual(pastedEdge.toField, orders.fields[1].id, "toField binding is remapped");
    assert(pastedCustomers.fields.every(f => !customers.fields.some(old => old.id === f.id)), "field ids are distinct");
  }

  /* SCH-012 — alignment and distribution */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = () => JSON.stringify({ version:1, nextId:4, edges:[], nodes:[
      { id:"n1", type:"concept", x:10, y:10, title:"Alpha", notes:"", color:"#FFE9A8" },
      { id:"n2", type:"concept", x:140, y:90, title:"A much wider beta concept", notes:"", color:"#CFE8FF" },
      { id:"n3", type:"note", x:360, y:170, title:"Gamma", content:"One\nTwo\nThree", color:"#D8F3DC", w:240 }
    ] });
    const selectAll = () => {
      T.importDocText(doc());
      T.setSelection("node", ["n1", "n2", "n3"]);
      T.render();
    };
    const values = fn => T.selectedNodes().map(T.nodeRect).map(fn);
    const allEqual = list => list.every(value => Math.abs(value - list[0]) < 1e-9);

    const alignGroup = window.document.querySelector('#arrangeMenu [data-ribbon-group="align"]');
    assert([...alignGroup.querySelectorAll("button")]
      .every(button => button.getAttribute("aria-disabled") === "true"),
      "Arrange ribbon starts with alignment disabled without a multi-selection");
    selectAll();
    const menuButton = window.document.getElementById("btnArrangeMenu");
    assert([...alignGroup.querySelectorAll("button")]
      .every(button => button.getAttribute("aria-disabled") === "false"),
      "alignment enables for two or more selected nodes");
    menuButton.click();
    assert.strictEqual(T.activeRibbonTab, "arrange", "Arrange tab activates from the ribbon");
    assert.strictEqual(window.document.getElementById("arrangeMenu").hidden, false,
      "Arrange ribbon panel becomes visible");

    const cases = [
      ["btnAlignTop", r => r.y, "top"],
      ["btnAlignMiddle", r => r.cy, "middle"],
      ["btnAlignBottom", r => r.y + r.h, "bottom"],
      ["btnAlignLeft", r => r.x, "left"],
      ["btnAlignCenter", r => r.cx, "center"],
      ["btnAlignRight", r => r.x + r.w, "right"]
    ];
    for (const [id, measure, label] of cases){
      selectAll();
      const beforeUndo = T.undoDepth;
      window.document.getElementById(id).click();
      assert(allEqual(values(measure)), `toolbar ${label} aligns node rectangles`);
      assert.strictEqual(T.undoDepth, beforeUndo + 1, `toolbar ${label} creates one history entry`);
    }

    T.clearSelection();
    T.render();
    assert([...alignGroup.querySelectorAll("button")]
      .every(button => button.getAttribute("aria-disabled") === "true"),
      "alignment disables below two selected nodes");

    selectAll();
    T.alignSelection("distributeX");
    const rects = T.selectedNodes().map(T.nodeRect).sort((a, b) => a.x - b.x);
    const gap1 = rects[1].x - (rects[0].x + rects[0].w);
    const gap2 = rects[2].x - (rects[1].x + rects[1].w);
    assert(Math.abs(gap1 - gap2) < 1e-9, "distribute horizontally creates equal edge gaps");
  }

  /* SCH-088 — a multi-selection can match its smallest, largest, or average width. */
  {
    const fixture = () => JSON.stringify({ version:1, nextId:5, edges:[
      { id:"e1", from:"n2", to:"n3", kind:"link", label:"Supports" }
    ], nodes:[
      { id:"n1", type:"concept", x:10, y:10, title:"Alpha", notes:"", color:"#FFE9A8" },
      { id:"n2", type:"concept", x:180, y:90,
        title:"A deliberately long concept title that must wrap when the selection becomes narrow",
        notes:"", color:"#CFE8FF" },
      { id:"n3", type:"note", x:620, y:170, title:"Gamma",
        content:"Long supporting context that also reflows within the matched width.", color:"#D8F3DC", w:240 }
    ] });
    const ids = ["n1", "n2", "n3"];
    const expectedWidth = (mode, widths) => {
      const raw = mode === "smallest" ? Math.min(...widths)
        : mode === "largest" ? Math.max(...widths)
        : widths.reduce((sum, width) => sum + width, 0) / widths.length;
      return Math.max(80, Math.min(4000, Math.round(raw)));
    };

    {
      const { window } = makeDom();
      const T = window.__T, doc = window.document;
      T.importDocText(fixture());
      const first = T.state.nodes.find(n => n.id === "n1");
      T.setSelection("node", first.id);
      T.nodeMenu(first, 20, 20);
      const singleReset = doc.querySelector('[data-ctx-action="reset-size"]');
      assert(singleReset, "Reset size is present for a single selected node");
      assert.strictEqual(singleReset.disabled, true,
        "Reset size is disabled when the single selected node has no forced width");
      assert.strictEqual(doc.querySelectorAll('[data-ctx-action^="width-"]').length, 0,
        "width matching is hidden for a single selected node");

      T.setSelection("node", ids);
      T.nodeMenu(first, 20, 20);
      const actions = [...doc.querySelectorAll('[data-ctx-action^="width-"]')];
      sameList(actions.map(button => button.textContent.trim()),
        ["Scale to smallest", "Scale to largest", "Scale to average"],
        "the multi-node Arrange menu exposes all three width-matching actions");
    }

    for (const mode of ["smallest", "largest", "average"]){
      const { window } = makeDom();
      const T = window.__T, doc = window.document;
      T.importDocText(fixture());
      T.setSelection("node", ids);
      const nodesBefore = ids.map(id => T.state.nodes.find(n => n.id === id));
      const rectsBefore = nodesBefore.map(T.nodeRect);
      const widthsBefore = rectsBefore.map(r => r.w);
      const xBefore = nodesBefore.map(n => n.x);
      const target = expectedWidth(mode, widthsBefore);
      const edgeBefore = mode === "smallest"
        ? T.edgeEndpoints(T.state.edges.find(edge => edge.id === "e1"))
        : null;
      const undoBefore = T.undoDepth;

      T.nodeMenu(nodesBefore[0], 20, 20);
      doc.querySelector(`[data-ctx-action="width-${mode}"]`).click();
      const nodesAfter = ids.map(id => T.state.nodes.find(n => n.id === id));
      sameList(nodesAfter.map(n => T.nodeRect(n).w), [target, target, target],
        `${mode} makes every selected node rectangle the computed width`);
      sameList(nodesAfter.map(n => n.x), xBefore, `${mode} preserves each node's x coordinate`);
      assert(nodesAfter.every(n => n.manualWidth === true && n.w === target),
        `${mode} stores the matched width as an explicit manual width`);
      assert.strictEqual(T.undoDepth, undoBefore + 1, `${mode} creates one undo entry`);

      const saved = T.serializeDocument();
      const savedNodes = JSON.parse(saved).nodes.filter(n => ids.includes(n.id));
      assert(savedNodes.every(n => n.manualWidth === true && n.w === target),
        `${mode} persists the matched width`);
      assert.strictEqual(savedNodes.find(n => n.id === "n3").widthBeforeMatch, 240,
        `${mode} preserves the rich note's pre-match width for Reset size`);
      assert(savedNodes.filter(n => n.type === "concept")
        .every(n => !Object.hasOwn(n, "widthBeforeMatch")),
      `${mode} leaves content-sized concepts without a synthetic prior width`);

      if (mode === "smallest"){
        assert(doc.querySelectorAll('[data-node="n2"] [data-concept-line]').length > 1,
          "long concept text wraps after scaling to the smallest width");
        const edgeAfter = T.edgeEndpoints(T.state.edges.find(edge => edge.id === "e1"));
        assert(edgeAfter.pa.x < edgeBefore.pa.x, "connected links re-anchor after a node becomes narrower");
      }

      T.undo();
      const nodesUndone = ids.map(id => T.state.nodes.find(n => n.id === id));
      sameList(nodesUndone.map(n => T.nodeRect(n).w), widthsBefore,
        `${mode} undo restores the original auto-sized rectangles`);
      assert(nodesUndone.every(n => n.manualWidth !== true),
        `${mode} undo restores legacy auto-sizing`);

      T.importDocText(saved);
      sameList(ids.map(id => T.nodeRect(T.state.nodes.find(n => n.id === id)).w),
        [target, target, target], `${mode} matched widths survive document reload`);

      if (mode === "smallest"){
        const selectedNote = T.state.nodes.find(n => n.id === "n3");
        T.setSelection("node", selectedNote.id);
        T.nodeMenu(selectedNote, 20, 20);
        const reset = doc.querySelector('[data-ctx-action="reset-size"]');
        assert.strictEqual(reset.disabled, false,
          "Reset size enables for a single node with forced sizing");
        const resetUndoBefore = T.undoDepth;
        reset.click();
        assert.strictEqual(T.nodeRect(selectedNote).w, 240,
          "single-node Reset size restores the note's configured width");
        assert.strictEqual(selectedNote.manualWidth, undefined,
          "single-node Reset size removes the forced-width flag");
        assert.strictEqual(selectedNote.widthBeforeMatch, undefined,
          "single-node Reset size consumes the stored prior width");
        assert.strictEqual(T.undoDepth, resetUndoBefore + 1,
          "single-node Reset size creates one undo entry");
        assert(ids.filter(id => id !== "n3").every(id =>
          T.state.nodes.find(n => n.id === id).manualWidth === true),
        "single-node Reset size leaves unselected forced nodes unchanged");
        T.undo();
        const restoredNote = T.state.nodes.find(n => n.id === "n3");
        assert.strictEqual(T.nodeRect(restoredNote).w, target,
          "undo restores the single node's forced width");
        assert.strictEqual(restoredNote.widthBeforeMatch, 240,
          "undo restores the prior-width metadata");
      }
    }

    {
      const { window } = makeDom();
      const T = window.__T;
      T.importDocText(JSON.stringify({version:1,nextId:4,edges:[],nodes:[
        {id:"n1",type:"concept",x:0,y:0,title:"Legacy",notes:"",color:"#FFE9A8",w:400},
        {id:"n2",type:"concept",x:200,y:0,title:"Invalid manual width",notes:"",
         color:"#CFE8FF",manualWidth:true,w:"not-a-number"},
        {id:"n3",type:"concept",x:400,y:0,title:"Missing manual width",notes:"",
         color:"#D8F3DC",manualWidth:true}
      ]}));
      assert(T.state.nodes.every(n => n.manualWidth !== true),
        "legacy or invalid width fields do not opt nodes out of automatic sizing");
      const saved = JSON.parse(T.serializeDocument());
      assert(saved.nodes.every(n => !Object.hasOwn(n, "w") && !Object.hasOwn(n, "manualWidth")),
        "legacy auto-sized nodes do not acquire persisted width metadata");
    }

    {
      const { window } = makeDom();
      const T = window.__T, doc = window.document;
      const mixedIds = ["concept","text","status","note","table","todo","frame","lane"];
      T.importDocText(JSON.stringify({version:1,nextId:20,edges:[],nodes:[
        {id:"concept",type:"concept",x:0,y:0,title:"Concept",notes:"",color:"#FFE9A8"},
        {id:"text",type:"text",x:200,y:0,title:"Plain text with enough words to reflow",notes:"",
         color:"#CFE8FF",w:280},
        {id:"status",type:"status",x:500,y:0,title:"Approval status",status:"In progress",
         statusSide:"right",color:"#CFE8FF",w:320},
        {id:"note",type:"note",x:850,y:0,title:"Note",content:"Rich note body",notes:"",
         color:"#D8F3DC",w:260},
        {id:"table",type:"table",x:0,y:240,title:"records",notes:"",color:"#16232F",
         fields:[{id:"f1",name:"id",type:"INT",pk:true,fk:false,nullable:false}]},
        {id:"todo",type:"todo",x:240,y:240,title:"Tasks",notes:"",color:"#E9E2F8",
         items:[{id:"i1",text:"Ship it",done:false}]},
        {id:"frame",type:"frame",x:480,y:240,title:"Area",notes:"",color:"#2456E6",w:340,h:220},
        {id:"lane",type:"swimlane",x:860,y:240,title:"Lane",notes:"",color:"#E5F1F1",
         titleColor:"#007873",orientation:"horizontal",w:520,h:260}
      ]}));
      T.setSelection("node", mixedIds);
      const originalWidths = Object.fromEntries(mixedIds.map(id => {
        const node = T.state.nodes.find(n => n.id === id);
        return [id, T.nodeRect(node).w];
      }));
      const target = T.matchSelectionWidths("average");
      assert(target > 0, "mixed node types can be width-matched together");
      assert(mixedIds.every(id => T.nodeRect(T.state.nodes.find(n => n.id === id)).w === target),
        "every selectable node type honors the shared manual-width contract");
      const saved = T.serializeDocument();
      const savedNodes = JSON.parse(saved).nodes;
      const configuredIds = ["text","status","note","frame","lane"];
      assert(configuredIds.every(id => Number.isFinite(
        savedNodes.find(node => node.id === id).widthBeforeMatch)),
      "configured-width node types persist their pre-match widths");
      assert(["concept","table","todo"].every(id =>
        !Object.hasOwn(savedNodes.find(node => node.id === id), "widthBeforeMatch")),
      "content-sized node types rely on automatic sizing after reset");
      T.importDocText(saved);
      assert(mixedIds.every(id => T.nodeRect(T.state.nodes.find(n => n.id === id)).w === target),
        "mixed-type matched widths survive document reload");

      T.setSelection("node", mixedIds);
      const undoBefore = T.undoDepth;
      T.nodeMenu(T.state.nodes.find(n => n.id === mixedIds[0]), 20, 20);
      const reset = doc.querySelector('[data-ctx-submenu="node:arrange:size"] [data-ctx-action="reset-size"]');
      assert(reset && !reset.disabled,
        "the multi-selection Size submenu enables Reset size for forced nodes");
      reset.click();
      assert.strictEqual(T.undoDepth, undoBefore + 1,
        "multi-selection Reset size creates one undo entry");
      assert(mixedIds.every(id => {
        const node = T.state.nodes.find(n => n.id === id);
        return node.manualWidth !== true && !Object.hasOwn(node, "widthBeforeMatch");
      }), "multi-selection Reset size clears forced-sizing metadata");
      for (const id of mixedIds){
        const node = T.state.nodes.find(n => n.id === id);
        assert.strictEqual(T.nodeRect(node).w, originalWidths[id],
          `Reset size restores ${id}'s original width behavior`);
      }
      T.undo();
      assert(mixedIds.every(id => T.nodeRect(T.state.nodes.find(n => n.id === id)).w === target),
        "undo restores all matched widths after a multi-selection reset");
      T.redo();
      assert(mixedIds.every(id => T.nodeRect(T.state.nodes.find(n => n.id === id)).w === originalWidths[id]),
        "redo reapplies the multi-selection size reset");
    }

    {
      const { window } = makeDom();
      const T = window.__T;
      T.importDocText(JSON.stringify({version:1,nextId:4,edges:[],nodes:[
        {id:"forced",type:"concept",x:0,y:0,title:"Forced concept",notes:"",
         color:"#FFE9A8",manualWidth:true,w:300},
        {id:"natural",type:"concept",x:360,y:0,title:"Natural concept",notes:"",color:"#CFE8FF"},
        {id:"legacy-note",type:"note",x:600,y:0,title:"Legacy forced note",content:"Body",
         color:"#D8F3DC",manualWidth:true,w:480}
      ]}));
      T.setSelection("node", ["forced","natural"]);
      assert.strictEqual(T.resetSelectionSizes(), 1,
        "a mixed selection resets only nodes that currently have forced sizing");
      assert.strictEqual(T.state.nodes.find(n => n.id === "natural").manualWidth, undefined,
        "an unforced selected node remains unforced");
      T.setSelection("node", "legacy-note");
      assert.strictEqual(T.resetSelectionSizes(), 1,
        "Reset size accepts older forced-width documents without prior-width metadata");
      assert.strictEqual(T.nodeRect(T.state.nodes.find(n => n.id === "legacy-note")).w, 300,
        "older forced notes fall back to their default width on reset");
    }
  }

  /* SCH-013 and SCH-016 — inline title and edge-label editing */
  {
    const { window } = makeDom();
    const T = window.__T;
    const node = T.state.nodes.find(n => n.title === "Loyalty program launch");
    const connectedEdge = T.state.edges.find(edge => edge.from === node.id);
    const endpointsBeforeWrap = T.edgeEndpoints(connectedEdge);
    T.startInlineEditor("node", node.id);
    let input = window.document.querySelector(".inline-editor");
    assert(input, "node inline editor appears");
    assert.strictEqual(input.tagName, "TEXTAREA", "concept inline editing supports multiple lines");
    input.value = "Tier strategy with a deliberately long title that wraps across the process nodeSecond explicit line";
    input.setSelectionRange(input.value.indexOf("Second"), input.value.indexOf("Second"));
    input.dispatchEvent(new window.KeyboardEvent("keydown",
      { key:"Enter", shiftKey:true, bubbles:true, cancelable:true }));
    assert(input.value.includes("\nSecond explicit line"), "Shift+Enter inserts a line break at the caret");
    assert(window.document.querySelector(".inline-editor"), "Shift+Enter keeps the inline editor open");
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
    assert(node.title.includes("\nSecond explicit line"), "Enter commits the multiline node title");
    const processLayout = T.conceptWrappedLayout(node);
    assert(processLayout.lines.length >= 3, "a long process-node title wraps onto multiple lines");
    assert(processLayout.w <= 320, "a long process node grows downward instead of becoming excessively wide");
    assert(T.nodeRect(node).h > 48, "a process node grows vertically to contain its wrapped title");
    const endpointsAfterWrap = T.edgeEndpoints(connectedEdge);
    assert(endpointsAfterWrap.pa.x > endpointsBeforeWrap.pa.x,
      "connected links re-anchor after wrapped text widens the node");
    const processLines = [...window.document.querySelectorAll(
      `[data-node="${node.id}"] [data-concept-line]`)].map(line => line.textContent);
    sameList(processLines, processLayout.lines, "the process node renders every wrapped line");
    sameList(T.wrapConceptTitle("First explicit line\nSecond explicit line",
      processLayout.font, 1000), ["First explicit line", "Second explicit line"],
      "explicit newlines remain hard wrapping boundaries");
    assert.strictEqual(JSON.parse(T.serializeDocument()).nodes.find(n => n.id === node.id).title, node.title,
      "multiline node titles persist in the document");

    T.selectNode(node.id);
    const inspectorTitle = window.document.getElementById("titleInput");
    assert(inspectorTitle && inspectorTitle.tagName === "TEXTAREA",
      "the concept inspector also exposes multiline title editing");
    inspectorTitle.setSelectionRange(inspectorTitle.value.length, inspectorTitle.value.length);
    inspectorTitle.dispatchEvent(new window.KeyboardEvent("keydown",
      {key:"Enter", shiftKey:true, bubbles:true, cancelable:true}));
    assert(node.title.endsWith("\n"), "inspector Shift+Enter updates the node with a new line");
    const committedMultilineTitle = node.title;

    T.startInlineEditor("node", node.id);
    input = window.document.querySelector(".inline-editor");
    input.value = "Cancelled title";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true }));
    assert(node.title.includes("Second explicit line"), "Escape cancels node inline edit");

    T.startInlineEditor("node", node.id);
    input = window.document.querySelector(".inline-editor");
    input.value = "Zoom cancelled";
    T.setView({ x:0, y:0, k:1 });
    const wheel = new window.WheelEvent("wheel", {
      bubbles:true, cancelable:true, deltaX:14, deltaY:-20, clientX:10, clientY:10
    });
    window.document.getElementById("board").dispatchEvent(wheel);
    assert(!window.document.querySelector(".inline-editor"), "wheel pan closes inline editor");
    assert.strictEqual(node.title, committedMultilineTitle, "wheel pan close does not commit an edit");
    assert.strictEqual(T.view.x, -14, "ordinary horizontal wheel input pans horizontally");
    assert.strictEqual(T.view.y, 20, "ordinary vertical wheel input pans vertically");
    assert.strictEqual(T.view.k, 1, "ordinary wheel input does not zoom");

    const beforeZoom = {...T.view};
    const zoomWheel = new window.WheelEvent("wheel", {
      bubbles:true, cancelable:true, deltaY:-20, shiftKey:true, clientX:10, clientY:10
    });
    window.document.getElementById("board").dispatchEvent(zoomWheel);
    assert.strictEqual(T.view.k, 1.1, "Shift plus vertical wheel zooms in");
    closeEnough(T.view.x, 10 - (10 - beforeZoom.x)*1.1, "Shift-wheel zoom keeps cursor x anchored");
    closeEnough(T.view.y, 10 - (10 - beforeZoom.y)*1.1, "Shift-wheel zoom keeps cursor y anchored");

    const beforeShiftHorizontal = {...T.view};
    const shiftHorizontal = new window.WheelEvent("wheel", {
      bubbles:true, cancelable:true, deltaX:9, deltaY:0, shiftKey:true
    });
    window.document.getElementById("board").dispatchEvent(shiftHorizontal);
    assert.strictEqual(T.view.k, beforeShiftHorizontal.k, "Shift plus horizontal wheel does not zoom");
    closeEnough(T.view.x, beforeShiftHorizontal.x - 9, "Shift plus horizontal wheel still pans horizontally");

    const edge = T.state.edges.find(e => e.label === "Writes to");
    T.startInlineEditor("edge", edge.id);
    input = window.document.querySelector(".inline-editor");
    input.value = "maps to";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
    assert.strictEqual(edge.label, "maps to", "Enter commits edge label inline edit");
  }

  /* SCH-068 — semantic edge relationship presets with custom-label fallback */
  {
    const { window } = makeDom();
    const T = window.__T;
    const expected = [
      ["Contains", "Parent-child structure"],
      ["Depends on", "Execution dependency"],
      ["Blocks", "Prevents progress"],
      ["Supports", "Evidence supports a claim"],
      ["Contradicts", "Evidence challenges a claim"],
      ["Owns", "Person or team is accountable"],
      ["Measures", "KPI evaluates an objective"],
      ["Implements", "Task or project delivers a concept"],
      ["Produces", "Output of one object becomes another"],
      ["Reads from", "Data dependency"],
      ["Writes to", "Data destination"],
      ["Triggers", "Event initiates an action"],
      ["References", "General informational relationship"],
      ["Causes", "Causal influence"],
      ["Calculates", "Formula derives a value"],
      ["Validates", "Experiment tests an assumption"]
    ];
    sameList(T.EDGE_RELATIONSHIPS.map(r => [r.name, r.meaning]), expected,
      "edge relationship presets preserve the supplied names, meanings, and order");

    let edge = T.state.edges.find(e => e.label === "earns");
    T.setSelection("edge", edge.id);
    T.render();
    let select = window.document.getElementById("edgeRelationshipSelect");
    assert(select, "edge inspector renders a relationship selector");
    assert.strictEqual(select.getAttribute("aria-label"), "Edge relationship", "relationship selector is labelled");
    assert.strictEqual(select.options.length, expected.length + 1, "relationship selector includes presets plus custom text");
    assert.strictEqual(select.value, "__custom__", "an existing arbitrary label maps to Custom text");
    assert([...select.options].some(o => o.value === "Measures" && o.textContent.includes("KPI evaluates an objective")),
      "relationship options expose their meanings");

    const undoBefore = T.undoDepth;
    select.value = "Supports";
    select.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edge.label, "Supports", "choosing a preset writes it to the existing edge label");
    assert.strictEqual(T.undoDepth, undoBefore + 1, "choosing a relationship preset is one undo step");
    assert([...window.document.querySelectorAll(`[data-edge="${edge.id}"] text`)].some(t => t.textContent === "Supports"),
      "chosen relationship renders on the edge");

    T.undo();
    edge = T.state.edges.find(e => e.id === edge.id);
    assert.strictEqual(edge.label, "earns", "undo restores the prior custom label");
    T.redo();
    edge = T.state.edges.find(e => e.label === "Supports");
    assert(edge, "redo restores the preset relationship");

    T.setSelection("edge", edge.id);
    T.render();
    const labelInput = window.document.getElementById("edgeLabelInput");
    assert(labelInput, "edge inspector retains an editable label-text field");
    labelInput.dispatchEvent(new window.FocusEvent("focus"));
    labelInput.value = "Custom rationale";
    labelInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(edge.label, "Custom rationale", "typing arbitrary relationship text still works");
    assert.strictEqual(window.document.getElementById("edgeRelationshipSelect").value, "__custom__",
      "typing arbitrary text switches the selector to Custom text");
    assert.strictEqual(JSON.parse(T.serializeDocument()).edges.find(e => e.id === edge.id).label, "Custom rationale",
      "custom relationship text serializes through the existing label field");

    T.edgeMenu(edge, 10, 10);
    const ctxSelect = window.document.querySelector(`#ctxMenu [data-edge-relationship="${edge.id}"]`);
    assert(ctxSelect, "edge context menu exposes the same relationship selector");
    ctxSelect.value = "Blocks";
    ctxSelect.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edge.label, "Blocks", "context-menu relationship selection updates the edge label");
    assert.strictEqual(window.document.getElementById("ctxMenu").style.display, "none",
      "context menu closes after choosing a relationship preset");

    T.setSelection("edge", edge.id);
    T.render();
    select = window.document.getElementById("edgeRelationshipSelect");
    select.value = "__custom__";
    select.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edge.label, "", "choosing Custom text clears a preset for fresh custom entry");
    await delay(10);
    assert.strictEqual(window.document.activeElement.id, "edgeLabelInput", "Custom text focuses the label editor");
  }

  /* SCH-070 — edge arrows and line appearance */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    let edge = T.state.edges.find(e => e.label === "Depends on");
    const edgeId = edge.id;
    T.setSelection("edge", edgeId);
    T.render();

    let line = doc.querySelector(`[data-edge="${edgeId}"] [data-edge-line]`);
    assert.strictEqual(line.getAttribute("stroke-dasharray"), "5 5", "legacy links remain dashed by default");
    assert.strictEqual(line.getAttribute("stroke-width"), "1.7", "legacy edges retain the default width");
    assert.strictEqual(doc.querySelectorAll(`[data-edge="${edgeId}"] [data-edge-arrow]`).length, 0,
      "legacy edges do not gain arrowheads");
    assert(doc.getElementById("edgeStartArrow") && doc.getElementById("edgeEndArrow"),
      "edge inspector exposes start and end arrow controls");
    assert(doc.getElementById("edgeLineStyle") && doc.getElementById("edgeLineColor"),
      "edge inspector exposes line style and color controls");
    assert(doc.querySelector('[aria-label="Line width"]'), "edge inspector exposes a labelled width control");

    const beforeArrow = T.undoDepth;
    doc.getElementById("edgeStartArrow").click();
    assert.strictEqual(edge.startArrow, true, "inspector toggles a start arrow");
    assert(doc.querySelector(`[data-edge="${edgeId}"] [data-edge-arrow="start"]`),
      "start arrow renders on the canvas");
    assert.strictEqual(T.undoDepth, beforeArrow + 1, "arrow toggle is one undo step");
    T.undo();
    edge = T.state.edges.find(e => e.id === edgeId);
    assert.strictEqual(edge.startArrow, undefined, "undo removes the start arrow");
    T.redo();
    edge = T.state.edges.find(e => e.id === edgeId);
    assert.strictEqual(edge.startArrow, true, "redo restores the start arrow");

    T.setSelection("edge", edgeId);
    T.render();
    doc.getElementById("edgeEndArrow").click();
    assert.strictEqual(edge.endArrow, true, "inspector toggles an end arrow");
    let style = doc.getElementById("edgeLineStyle");
    style.value = "dot";
    style.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edge.lineStyle, "dot", "inspector changes line style");
    line = doc.querySelector(`[data-edge="${edgeId}"] [data-edge-line]`);
    assert.strictEqual(line.getAttribute("stroke-dasharray"), "1 5", "dotted style renders as a round-dot pattern");

    let width = doc.querySelector('[aria-label="Line width"]');
    width.value = "3";
    width.dispatchEvent(new window.Event("input", {bubbles:true}));
    width.dispatchEvent(new window.KeyboardEvent("keydown", {key:"Enter", bubbles:true}));
    assert.strictEqual(edge.lineWidth, 3, "inspector changes line width");
    line = doc.querySelector(`[data-edge="${edgeId}"] [data-edge-line]`);
    assert.strictEqual(line.getAttribute("stroke-width"), "3", "custom width renders on the canvas");

    let colorWell = doc.querySelector("#edgeLineColor .colorwell");
    colorWell.value = "#c20029";
    colorWell.dispatchEvent(new window.Event("input", {bubbles:true}));
    colorWell.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edge.lineColor, "#c20029", "inspector changes line color");
    line = doc.querySelector(`[data-edge="${edgeId}"] [data-edge-line]`);
    assert.strictEqual(line.getAttribute("stroke"), "#c20029", "custom color renders on the line");
    assert([...doc.querySelectorAll(`[data-edge="${edgeId}"] [data-edge-arrow]`)]
      .every(a => a.getAttribute("fill") === "#c20029"), "custom color also applies to arrowheads");

    const saved = JSON.parse(T.serializeDocument()).edges.find(e => e.id === edgeId);
    assert.deepStrictEqual(
      {startArrow:saved.startArrow, endArrow:saved.endArrow, lineStyle:saved.lineStyle,
       lineWidth:saved.lineWidth, lineColor:saved.lineColor},
      {startArrow:true, endArrow:true, lineStyle:"dot", lineWidth:3, lineColor:"#c20029"},
      "edge appearance round-trips through document JSON");
    assert(T.serializedSvg().includes('data-edge-arrow="start"'), "SVG export preserves arrowheads");
    assert(T.serializedSvg().includes('stroke-dasharray="1 5"'), "SVG export preserves the line style");

    T.importDocText(T.serializeDocument());
    edge = T.state.edges.find(e => e.id === edgeId);
    assert.deepStrictEqual(
      {startArrow:edge.startArrow, endArrow:edge.endArrow, lineStyle:edge.lineStyle,
       lineWidth:edge.lineWidth, lineColor:edge.lineColor},
      {startArrow:true, endArrow:true, lineStyle:"dot", lineWidth:3, lineColor:"#c20029"},
      "import restores all explicit edge appearance properties");

    T.edgeMenu(edge, 10, 10);
    let ctx = doc.getElementById("ctxMenu");
    assert(ctx.querySelector('[data-edge-arrow-toggle="start"]'), "edge context menu exposes start/end arrows");
    assert(ctx.querySelector('[aria-label="Line style"]') && ctx.querySelector('[aria-label="Line width"]'),
      "edge context menu exposes line style and width");
    assert(ctx.querySelector('[data-ctx-submenu="edge:line:color"] .swatch[title="#007873"]'),
      "edge context menu exposes line colors");
    ctx.querySelector('[data-edge-arrow-toggle="start"]').click();
    assert.strictEqual(edge.startArrow, undefined, "context menu toggles a start arrow off");

    T.edgeMenu(edge, 10, 10);
    ctx = doc.getElementById("ctxMenu");
    style = ctx.querySelector('[aria-label="Line style"]');
    style.value = "solid";
    style.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edge.lineStyle, "solid", "context menu changes line style");

    T.edgeMenu(edge, 10, 10);
    ctx = doc.getElementById("ctxMenu");
    const beforeWidth = edge.lineWidth;
    ctx.querySelector('.sizestepper .stepbtn:last-child').click();
    assert.strictEqual(edge.lineWidth, beforeWidth + .5, "context menu changes line width");

    T.edgeMenu(edge, 10, 10);
    ctx = doc.getElementById("ctxMenu");
    ctx.querySelector('[data-ctx-submenu="edge:line:color"] .swatch[title="#007873"]').click();
    assert.strictEqual(edge.lineColor, "#007873", "context menu changes line color");

    const relation = T.state.edges.find(e => e.kind === "1:N");
    T.setSelection("edge", relation.id);
    T.render();
    line = doc.querySelector(`[data-edge="${relation.id}"] [data-edge-line]`);
    assert.strictEqual(line.getAttribute("stroke-dasharray"), "none", "legacy relation edges remain solid by default");
  }

  /* SCH-082 — edge-label text and background colors override independently */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    let edge = T.state.edges.find(e => e.label === "Depends on");
    const edgeId = edge.id;
    const rendered = () => ({
      line:doc.querySelector(`[data-edge="${edgeId}"] [data-edge-line]`),
      text:doc.querySelector(`[data-edge="${edgeId}"] [data-edge-label]`),
      background:doc.querySelector(`[data-edge="${edgeId}"] [data-edge-label-bg]`)
    });
    const commitColor = (selector, color) => {
      const well = doc.querySelector(`${selector} .colorwell`);
      assert(well, `${selector} exposes a custom color well`);
      well.value = color;
      well.dispatchEvent(new window.Event("input", {bubbles:true}));
      well.dispatchEvent(new window.Event("change", {bubbles:true}));
    };

    T.setSelection("edge", edgeId);
    T.render();
    let parts = rendered();
    assert.strictEqual(parts.text.getAttribute("fill"), T.edgeLineColor(edge),
      "legacy label text inherits the link color");
    assert.strictEqual(parts.background.getAttribute("fill"), T.themeColors().labelBg,
      "legacy label background keeps the theme-aware canvas color");
    assert.strictEqual(T.edgeLabelTextColor(edge), T.edgeLineColor(edge),
      "label text accessor reports the inherited link color");
    assert.strictEqual(T.edgeLabelBackgroundColor(edge), T.themeColors().labelBg,
      "label background accessor reports the inherited theme color");
    assert(doc.getElementById("edgeLabelTextColor") && doc.getElementById("edgeLabelBackgroundColor"),
      "edge inspector exposes independent label text and background controls");
    assert.strictEqual(doc.querySelector('[data-color-inherit="label-text"]').getAttribute("aria-pressed"), "true",
      "text control communicates that it currently inherits the link color");
    assert.strictEqual(doc.querySelector('[data-color-inherit="label-background"]').getAttribute("aria-pressed"), "true",
      "background control communicates that it currently inherits the canvas background");

    commitColor("#edgeLineColor", "#007873");
    parts = rendered();
    assert.strictEqual(parts.line.getAttribute("stroke"), "#007873", "line color changes independently");
    assert.strictEqual(parts.text.getAttribute("fill"), "#007873",
      "unoverridden label text follows a changed link color");

    const beforeOverrides = T.undoDepth;
    commitColor("#edgeLabelTextColor", "#c63a3a");
    commitColor("#edgeLabelBackgroundColor", "#ffe9a8");
    assert(T.undoDepth >= beforeOverrides + 2, "each label color is independently undoable");
    assert.strictEqual(edge.labelTextColor, "#c63a3a", "inspector stores an explicit label text color");
    assert.strictEqual(edge.labelBackgroundColor, "#ffe9a8", "inspector stores an explicit label background color");

    commitColor("#edgeLineColor", "#2456e6");
    parts = rendered();
    assert.strictEqual(parts.line.getAttribute("stroke"), "#2456e6", "link keeps its newly selected color");
    assert.strictEqual(parts.text.getAttribute("fill"), "#c63a3a",
      "explicit label text remains independent when the link color changes");
    assert.strictEqual(parts.background.getAttribute("fill"), "#ffe9a8",
      "explicit label background remains independent when the link color changes");
    assert.strictEqual(parts.background.getAttribute("stroke"), "#2456e6",
      "label outline continues to identify the associated link");

    const serializedWithOverrides = T.serializeDocument();
    const saved = JSON.parse(serializedWithOverrides).edges.find(e => e.id === edgeId);
    assert.deepStrictEqual(
      {labelTextColor:saved.labelTextColor, labelBackgroundColor:saved.labelBackgroundColor},
      {labelTextColor:"#c63a3a", labelBackgroundColor:"#ffe9a8"},
      "explicit label colors serialize without changing the line color field");
    const svg = T.serializedSvg(true);
    assert(svg.includes('data-edge-label="1"') && svg.includes('fill="#c63a3a"'),
      "SVG export preserves the explicit label text color");
    assert(svg.includes('data-edge-label-bg="1"') && svg.includes('fill="#ffe9a8"'),
      "SVG export preserves the explicit label background color");
    const pngClone = T.cloneBoardForPng(true).clone;
    const pngEdge = pngClone.querySelector(`[data-edge="${edgeId}"]`);
    assert.strictEqual(pngEdge.querySelector("[data-edge-label]").getAttribute("fill"), "#c63a3a",
      "PNG source clone preserves the explicit label text color");
    assert.strictEqual(pngEdge.querySelector("[data-edge-label-bg]").getAttribute("fill"), "#ffe9a8",
      "PNG source clone preserves the explicit label background color");
    const { window:importWindow } = makeDom();
    importWindow.__T.importDocText(serializedWithOverrides);
    const importedEdge = importWindow.__T.state.edges.find(e => e.id === edgeId);
    assert.deepStrictEqual(
      {labelTextColor:importedEdge.labelTextColor, labelBackgroundColor:importedEdge.labelBackgroundColor},
      {labelTextColor:"#c63a3a", labelBackgroundColor:"#ffe9a8"},
      "valid label color overrides restore on import");
    const copied = T.remapPayload(T.cloneSelectionPayload([edge.from, edge.to]), 36);
    assert.deepStrictEqual(
      {labelTextColor:copied.edges[0].labelTextColor, labelBackgroundColor:copied.edges[0].labelBackgroundColor},
      {labelTextColor:"#c63a3a", labelBackgroundColor:"#ffe9a8"},
      "copy/paste preserves both label color overrides");

    let resetText = doc.querySelector('#edgeLabelTextColor [data-color-inherit="label-text"]');
    assert(resetText.textContent.includes("Reset"), "explicit text color offers an inheritance reset");
    resetText.click();
    assert.strictEqual(edge.labelTextColor, undefined, "text reset removes the explicit override");
    assert.strictEqual(rendered().text.getAttribute("fill"), "#2456e6",
      "reset label text resumes live link-color inheritance");

    const beforeBackgroundReset = T.undoDepth;
    const resetBackground = doc.querySelector('#edgeLabelBackgroundColor [data-color-inherit="label-background"]');
    resetBackground.click();
    assert.strictEqual(edge.labelBackgroundColor, undefined, "background reset removes only its override");
    assert.strictEqual(rendered().background.getAttribute("fill"), T.themeColors().labelBg,
      "reset background resumes theme inheritance");
    assert.strictEqual(T.undoDepth, beforeBackgroundReset + 1, "background reset creates one undo step");
    T.undo();
    edge = T.state.edges.find(e => e.id === edgeId);
    assert.strictEqual(edge.labelBackgroundColor, "#ffe9a8", "undo restores the background override");
    T.redo();
    edge = T.state.edges.find(e => e.id === edgeId);
    assert.strictEqual(edge.labelBackgroundColor, undefined, "redo reapplies the background reset");

    T.edgeMenu(edge, 10, 10);
    let ctx = doc.getElementById("ctxMenu");
    let textColors = ctx.querySelector('[data-color-override="label-text"]');
    let backgroundColors = ctx.querySelector('[data-color-override="label-background"]');
    assert(textColors && backgroundColors, "edge context menu exposes both label color controls");
    textColors.querySelector('.swatch[title="#C63A3A"]').click();
    assert.strictEqual(edge.labelTextColor, "#C63A3A", "context menu changes label text color");

    T.edgeMenu(edge, 10, 10);
    ctx = doc.getElementById("ctxMenu");
    backgroundColors = ctx.querySelector('[data-color-override="label-background"]');
    backgroundColors.querySelector('.swatch[title="#007873"]').click();
    assert.strictEqual(edge.labelBackgroundColor, "#007873", "context menu changes label background color");

    T.edgeMenu(edge, 10, 10);
    ctx = doc.getElementById("ctxMenu");
    ctx.querySelector('[data-ctx-action="inherit-label-text"]').click();
    assert.strictEqual(edge.labelTextColor, undefined, "context menu resets label text to the link color");
    assert.strictEqual(edge.labelBackgroundColor, "#007873", "text reset does not change the label background");
    T.edgeMenu(edge, 10, 10);
    ctx = doc.getElementById("ctxMenu");
    ctx.querySelector('[data-ctx-action="inherit-label-background"]').click();
    assert.strictEqual(edge.labelBackgroundColor, undefined,
      "context menu resets the background without changing the link");

    T.applyTheme("dark", {render:true});
    assert.strictEqual(rendered().background.getAttribute("fill"), T.themeColors("dark").labelBg,
      "inherited label background follows theme changes");
  }

  {
    const { window } = makeDom();
    const T = window.__T;
    const parsed = JSON.parse(T.serializeDocument());
    const edge = parsed.edges.find(e => e.label === "drives");
    edge.labelTextColor = "not-a-color";
    edge.labelBackgroundColor = "#12";
    T.importDocText(JSON.stringify(parsed));
    const imported = T.state.edges.find(e => e.id === edge.id);
    assert.strictEqual(imported.labelTextColor, undefined, "invalid imported label text color is discarded");
    assert.strictEqual(imported.labelBackgroundColor, undefined,
      "invalid imported label background color is discarded");
    assert.strictEqual(T.edgeLabelTextColor(imported), T.edgeLineColor(imported),
      "invalid text override safely falls back to the link color");
  }

  /* SCH-014 — quick-jump / command palette */
  {
    const { window } = makeDom();
    const T = window.__T;
    const items = T.paletteItems();
    assert(T.paletteMatches("ord", items).some(item => item.label === "orders"), "paletteMatches finds node titles");
    assert(T.paletteMatches("customers.email", items).some(item => item.label === "customers.email"), "paletteMatches finds table fields");
    assert(T.paletteMatches("> add t", items).some(item => item.command === "addTable"), "command queries require > prefix");
    T.openCommandPalette();
    const input = window.document.querySelector(".palette-input");
    input.value = "orders";
    input.dispatchEvent(new window.Event("input", { bubbles:true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
    const orders = T.state.nodes.find(n => n.title === "orders");
    assert.strictEqual(T.selection.ids[0], orders.id, "palette Enter selects the matching node");
    assert(!window.document.querySelector(".command-modal"), "palette closes after activation");
  }

  /* SCH-015 — shortcut cheat sheet */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.openShortcutModal();
    const text = window.document.querySelector(".shortcut-modal").textContent;
    for (const s of T.SHORTCUTS)
      assert(text.includes(T.editingDisplayShortcut(s.keys)),
        `shortcut modal includes the platform display for ${s.keys}`);
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key:"?", bubbles:true }));
    assert(window.document.querySelector(".shortcut-modal"), "? opens the shortcut modal");
  }

  /* SCH-040 — auto-layout: mind-map tree */
  {
    const { window } = makeDom();
    const T = window.__T;
    const strategy = T.state.nodes.find(n => n.title === "Loyalty program launch");
    const customers = T.state.nodes.find(n => n.title === "customers");
    T.setSelection("node", strategy.id);
    const scope = T.conceptTreeScope(strategy.id);
    const before = new Map(scope.ids.map(id => {
      const n = T.state.nodes.find(x => x.id === id);
      return [id, { x:n.x, y:n.y }];
    }));
    const untouched = { x:customers.x, y:customers.y };
    const beforeDepth = T.undoDepth;
    assert.strictEqual(T.layoutMindMapTree(), true, "tree layout runs on selected concept");
    assert.strictEqual(T.undoDepth, beforeDepth + 1, "tree layout creates one undo entry");
    const rects = scope.ids.map(id => T.nodeRect(T.state.nodes.find(n => n.id === id)));
    assertNoOverlaps(rects, "tree layout concept subtree has no overlaps");
    assert.deepStrictEqual({ x:customers.x, y:customers.y }, untouched, "tree layout leaves out-of-scope table alone");
    T.undo();
    for (const [id, pos] of before){
      const n = T.state.nodes.find(x => x.id === id);
      assert.deepStrictEqual({ x:n.x, y:n.y }, pos, "undo restores tree-layout node positions");
    }
  }

  /* SCH-041 — auto-layout: schema layered */
  {
    const { window } = makeDom();
    const T = window.__T;
    assert.strictEqual(T.layoutSchemaTables(), true, "schema layout runs on seeded tables");
    const customers = T.state.nodes.find(n => n.title === "customers");
    const orders = T.state.nodes.find(n => n.title === "orders");
    const rewards = T.state.nodes.find(n => n.title === "reward_events");
    assert(customers.x < orders.x, "schema layout places customers left of orders");
    assert(customers.x < rewards.x, "schema layout places customers left of reward events");
    assertNoOverlaps([customers, orders, rewards].map(T.nodeRect), "schema layout tables have no overlaps");

    T.importDocText(JSON.stringify({ version:1, nextId:10, nodes:[
      { id:"n1", type:"table", x:0, y:0, title:"a", color:"#16232F", notes:"", fields:[{id:"f1", name:"id", type:"INT", pk:true, fk:false, nullable:false}] },
      { id:"n2", type:"table", x:40, y:20, title:"b", color:"#2456E6", notes:"", fields:[{id:"f2", name:"id", type:"INT", pk:true, fk:false, nullable:false}] },
      { id:"n3", type:"table", x:80, y:40, title:"c", color:"#1E7A4F", notes:"", fields:[{id:"f3", name:"id", type:"INT", pk:true, fk:false, nullable:false}] }
    ], edges:[
      { id:"e1", from:"n1", to:"n2", kind:"1:N", label:"" },
      { id:"e2", from:"n2", to:"n3", kind:"1:N", label:"" },
      { id:"e3", from:"n3", to:"n1", kind:"1:N", label:"" }
    ] }));
    assert.strictEqual(T.layoutSchemaTables(), true, "schema layout terminates on a cycle");
    const cyclicRects = T.state.nodes.map(T.nodeRect);
    assert(cyclicRects.every(r => Number.isFinite(r.x) && Number.isFinite(r.y)), "cyclic schema layout produces finite coordinates");
    assertNoOverlaps(cyclicRects, "cyclic schema layout tables have no overlaps");
  }

  /* SCH-042/SCH-106 — orthogonal edge routing and corner styles */
  {
    const { window } = makeDom();
    const T = window.__T;
    const edge = T.state.edges.find(e => e.kind !== "link");
    edge.routing = "ortho";
    T.render();
    const ep = T.edgeEndpoints(edge);
    const d = T.edgePath(edge, ep.pa, ep.pb);
    assert(!d.includes("C"), "orthogonal edge path does not use cubic curves");
    assert(d.includes(" Q "), "orthogonal links use rounded quadratic corners by default");
    assert.strictEqual(T.orthoCornerStyle(edge), "rounded", "missing corner metadata defaults to rounded");
    const edgeGroup = window.document.querySelector(`[data-edge="${edge.id}"]`);
    assert(edgeGroup.querySelectorAll("line").length > 0, "orthogonal relation still renders notation");
    const parsed = JSON.parse(T.serializeDocument());
    assert.strictEqual(parsed.edges.find(e => e.id === edge.id).routing, "ortho", "routing key serializes");
    assert.strictEqual(Object.hasOwn(parsed.edges.find(e => e.id === edge.id), "orthoCorner"), false,
      "default rounded corners do not add document metadata");

    T.setOrthoCornerStyle(edge, "square");
    const square = T.edgePath(edge, ep.pa, ep.pb);
    assert(!square.includes(" Q "), "square orthogonal corners use straight path commands");
    assert(/^[MLHV0-9 .-]+$/.test(square),
      "square orthogonal path uses only M/L/H/V commands and numbers");
    const squareParsed = JSON.parse(T.serializeDocument());
    assert.strictEqual(squareParsed.edges.find(e => e.id === edge.id).orthoCorner, "square",
      "square corner override serializes");
    T.setSelection("edge", edge.id);
    T.render();
    const cornerSelect = window.document.getElementById("edgeOrthoCorners");
    assert(cornerSelect, "orthogonal inspector exposes a corner-style selector");
    assert.strictEqual(cornerSelect.value, "square", "corner selector reflects the saved override");
    cornerSelect.value = "rounded";
    cornerSelect.dispatchEvent(new window.Event("change"));
    assert.strictEqual(T.orthoCornerStyle(edge), "rounded", "inspector can restore rounded corners");
    T.edgeMenu(edge, 20, 20);
    const routingGroup = window.document.querySelector('[data-ctx-group="edge:routing"]');
    assert(routingGroup && routingGroup.textContent.includes("Rounded") &&
      routingGroup.textContent.includes("Square"),
      "right-click Routing group exposes both orthogonal corner styles");
    const selectionRouting = window.document.querySelector(
      '#selectionMenuPanel [data-menu-submenu="selection-routing"]');
    assert(selectionRouting && selectionRouting.textContent.includes("Rounded") &&
      selectionRouting.textContent.includes("Square"),
      "Selection Routing submenu exposes both orthogonal corner styles");

    T.importDocText(JSON.stringify(parsed));
    assert.strictEqual(T.state.edges.find(e => e.id === edge.id).routing, "ortho", "routing key imports");
    assert.strictEqual(T.orthoCornerStyle(T.state.edges.find(e => e.id === edge.id)), "rounded",
      "legacy orthogonal links import with rounded corners");
  }

  /* SCH-074/SCH-075 — curved cardinality paths meet glyphs on straight stubs */
  {
    const { window } = makeDom();
    const T = window.__T;
    const edge = T.state.edges.find(e => e.kind === "1:N");
    const ep = T.edgeEndpoints(edge);
    const oneVertex = T.notationVertex(ep.pa);
    const manyVertex = T.notationVertex(ep.pb);
    const curved = T.edgeRenderPath(edge, ep);
    assert(curved.includes(" C "), "1:N relation keeps curved routing");
    assert(curved.startsWith(`M ${ep.pa.x} ${ep.pa.y} L ${oneVertex.x} ${oneVertex.y} C `),
      "curved 1:N stroke reaches the one-side tick on a straight stub before bending");
    assert(curved.endsWith(`${manyVertex.x} ${manyVertex.y}`),
      "curved 1:N stroke ends at the many-side crow's-foot vertex");
    assert(!curved.endsWith(`${ep.pb.x} ${ep.pb.y}`),
      "curved 1:N stroke no longer continues under the crow's-foot prongs");
    T.setSelection("edge", edge.id);
    T.render();
    assert.strictEqual(window.document.querySelector(`[data-edge="${edge.id}"] [data-edge-line]`).getAttribute("d"), curved,
      "rendered relation uses the glyph-aligned curved path");

    edge.kind = "1:1";
    const oneToOne = T.edgeRenderPath(edge, ep);
    assert(oneToOne.startsWith(`M ${ep.pa.x} ${ep.pa.y} L ${oneVertex.x} ${oneVertex.y} C `),
      "curved 1:1 stroke uses a straight stub through its start tick");
    assert(oneToOne.endsWith(`${manyVertex.x} ${manyVertex.y} L ${ep.pb.x} ${ep.pb.y}`),
      "curved 1:1 stroke uses a straight stub through its end tick");

    edge.kind = "N:M";
    const manyToMany = T.edgeRenderPath(edge, ep);
    assert(manyToMany.startsWith(`M ${oneVertex.x} ${oneVertex.y}`),
      "curved N:M stroke starts at the first crow's-foot vertex");
    assert(manyToMany.endsWith(`${manyVertex.x} ${manyVertex.y}`),
      "curved N:M stroke ends at the second crow's-foot vertex");

    edge.routing = "ortho";
    assert.strictEqual(T.edgeRenderPath(edge, ep), T.edgePath(edge, ep.pa, ep.pb),
      "orthogonal relation geometry remains unchanged");
  }

  /* SCH-085 — curved labels follow the rendered Bezier instead of its endpoint chord */
  {
    const { window } = makeDom();
    const T = window.__T;
    const pa = {x:100, y:340, side:"n"};
    const pb = {x:700, y:110, side:"w"};
    const label = T.edgeLabelPoint({kind:"link", routing:"curve"}, {pa, pb});
    const straightMidpoint = {x:(pa.x + pb.x) / 2, y:(pa.y + pb.y) / 2};
    assert(Math.hypot(label.x - straightMidpoint.x, label.y - straightMidpoint.y) > 60,
      "a one-direction curve no longer places its label at the endpoint chord midpoint");

    const curveSamples = d => {
      const [prefix, curve] = d.split(" C ");
      const start = prefix.match(/-?\d+(?:\.\d+)?/g).map(Number).slice(-2);
      const [c1x, c1y, c2x, c2y, x3, y3] = curve.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const [x0, y0] = start;
      return Array.from({length:1001}, (_, i) => {
        const t = i / 1000, u = 1 - t, uu = u * u, tt = t * t;
        return {
          x:uu * u * x0 + 3 * uu * t * c1x + 3 * u * tt * c2x + tt * t * x3,
          y:uu * u * y0 + 3 * uu * t * c1y + 3 * u * tt * c2y + tt * t * y3
        };
      });
    };
    const expected = T.polylineMidpoint(curveSamples(T.edgePath({kind:"link"}, pa, pb)));
    assert(Math.hypot(label.x - expected.x, label.y - expected.y) < 0.5,
      "a curved label sits at the visible Bezier's half-length point");

    const relation = T.state.edges.find(edge => edge.kind === "1:N");
    const ep = T.edgeEndpoints(relation);
    const relationLabel = T.edgeLabelPoint(relation, ep);
    const relationMidpoint = T.polylineMidpoint(curveSamples(T.edgeRenderPath(relation, ep)));
    assert(Math.hypot(relationLabel.x - relationMidpoint.x, relationLabel.y - relationMidpoint.y) < 0.5,
      "relationship labels follow the glyph-to-glyph curve body");
  }

  /* SCH-100 — draggable labels remain constrained to curved and orthogonal link paths */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    T.setView({x:0, y:0, k:1});

    const projectedPolyline = T.projectPointToPolyline(
      [{x:0,y:0}, {x:100,y:0}, {x:100,y:100}], {x:70,y:20});
    closeEnough(projectedPolyline.x, 70, "polyline projection snaps x to the nearest leg");
    closeEnough(projectedPolyline.y, 0, "polyline projection snaps y to the nearest leg");
    closeEnough(projectedPolyline.position, .35, "polyline projection returns cumulative path position");
    closeEnough(T.polylinePointAt([{x:0,y:0}, {x:100,y:0}, {x:100,y:100}], .75).y, 50,
      "stored positions resolve by cumulative path length");

    const normalized = {labelPosition:"invalid"};
    T.setEdgeLabelPosition(normalized, normalized.labelPosition);
    assert.strictEqual(normalized.labelPosition, undefined, "invalid label positions normalize to the legacy midpoint");
    T.setEdgeLabelPosition(normalized, null);
    assert.strictEqual(normalized.labelPosition, undefined, "empty label positions also normalize to the legacy midpoint");
    T.setEdgeLabelPosition(normalized, -3);
    assert.strictEqual(normalized.labelPosition, 0, "label positions clamp to the path start");
    T.setEdgeLabelPosition(normalized, 3);
    assert.strictEqual(normalized.labelPosition, 1, "label positions clamp to the path end");
    T.setEdgeLabelPosition(normalized, .5);
    assert.strictEqual(normalized.labelPosition, undefined, "the default midpoint remains absent from compact documents");

    let edge = T.state.edges.find(e => e.label === "Depends on");
    let ep = T.edgeEndpoints(edge);
    const initial = T.edgeLabelPoint(edge, ep);
    const desiredPosition = .68;
    const desired = T.edgeLabelPoint({...edge, labelPosition:desiredPosition}, ep);
    const offCurveProjection = T.projectEdgeLabelToPath(edge, ep, {x:desired.x + 13, y:desired.y - 11});
    const projectedExact = T.edgeLabelPoint({...edge, labelPosition:offCurveProjection.position}, ep);
    assert(Math.hypot(offCurveProjection.x - projectedExact.x, offCurveProjection.y - projectedExact.y) < 1e-6,
      "curved projection returns a point on the rendered Bezier");
    const endpointProjection = T.projectEdgeLabelToPath(edge, ep, {x:ep.pb.x + 1000, y:ep.pb.y});
    const safeEndpointPosition = T.edgeLabelDragPosition(edge, endpointProjection);
    assert(safeEndpointPosition > 0 && safeEndpointPosition < 1,
      "drag endpoint padding keeps the label reachable outside the node and endpoint grip");

    T.render();
    let labelHandle = doc.querySelector(`[data-edge-label-handle="${edge.id}"]`);
    assert(labelHandle, "a visible edge label is a draggable canvas target");
    assert.strictEqual(labelHandle.getAttribute("cursor"), "move", "the label advertises its drag behavior");
    assert.strictEqual(labelHandle.querySelector("title").textContent, "Drag label along link",
      "the label drag target has an accessible hint");
    const beforeUndo = T.undoDepth;
    firePointer(window, labelHandle, "pointerdown", {clientX:initial.x, clientY:initial.y});
    firePointer(window, doc.getElementById("board"), "pointermove", {clientX:desired.x, clientY:desired.y});
    assert(Math.abs(T.edgeLabelPosition(edge) - desiredPosition) < .02,
      "dragging a curved label stores its normalized position along the curve");
    const draggedPoint = T.edgeLabelPoint(edge, ep);
    const labelText = doc.querySelector(`[data-edge="${edge.id}"] [data-edge-label]`);
    closeEnough(Number(labelText.getAttribute("x")), draggedPoint.x,
      "curved label redraws at its constrained x coordinate during drag");
    closeEnough(Number(labelText.getAttribute("y")), draggedPoint.y + 3.5,
      "curved label redraws at its constrained y coordinate during drag");
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "a label drag creates one undo step");
    firePointer(window, doc.getElementById("board"), "pointermove", {clientX:desired.x, clientY:desired.y});
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "continued label movement stays in one undo step");
    firePointer(window, doc.getElementById("board"), "pointerup", {clientX:desired.x, clientY:desired.y});

    const saved = JSON.parse(T.serializeDocument());
    const savedEdge = saved.edges.find(e => e.id === edge.id);
    assert.strictEqual(savedEdge.labelPosition, edge.labelPosition, "moved label position serializes");
    assert(T.serializedSvg(true).includes(`data-edge-label-handle=\"${edge.id}\"`),
      "SVG export keeps the moved label itself");
    const copied = T.remapPayload(T.cloneSelectionPayload([edge.from, edge.to]), 36);
    assert.strictEqual(copied.edges[0].labelPosition, edge.labelPosition,
      "copying linked nodes preserves their label position");

    const movedPosition = edge.labelPosition;
    T.undo();
    edge = T.state.edges.find(e => e.id === savedEdge.id);
    assert.strictEqual(edge.labelPosition, undefined, "undo restores the untouched midpoint label");
    T.redo();
    edge = T.state.edges.find(e => e.id === savedEdge.id);
    assert.strictEqual(edge.labelPosition, movedPosition, "redo restores the dragged label position");

    ep = T.edgeEndpoints(edge);
    const beforeSwap = T.edgeLabelPoint(edge, ep);
    const positionBeforeSwap = T.edgeLabelPosition(edge);
    T.swapEdgeDirection(edge);
    const afterSwap = T.edgeLabelPoint(edge, T.edgeEndpoints(edge));
    closeEnough(T.edgeLabelPosition(edge), 1 - positionBeforeSwap,
      "swapping direction reverses the normalized label position");
    assert(Math.hypot(beforeSwap.x - afterSwap.x, beforeSwap.y - afterSwap.y) < .01,
      "swapping direction leaves a moved label at the same visual point");

    const importedDocument = JSON.parse(T.serializeDocument());
    importedDocument.edges[0].labelPosition = "not-a-number";
    const { window:importWindow } = makeDom();
    importWindow.__T.importDocText(JSON.stringify(importedDocument));
    assert.strictEqual(importWindow.__T.state.edges[0].labelPosition, undefined,
      "invalid imported label positions safely fall back to the midpoint");
  }
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    T.setView({x:0, y:0, k:1});
    const edge = T.state.edges.find(e => e.label === "drives");
    edge.routing = "ortho";
    T.render();
    const ep = T.edgeEndpoints(edge);
    const route = T.orthoEdgeRoute(edge, ep.pa, ep.pb);
    let longest = null;
    for (let i = 1; i < route.points.length; i++){
      const from = route.points[i - 1], to = route.points[i];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (!longest || length > longest.length) longest = {from, to, length};
    }
    const target = {x:longest.from.x + (longest.to.x - longest.from.x) * .72,
                    y:longest.from.y + (longest.to.y - longest.from.y) * .72};
    const start = T.edgeLabelPoint(edge, ep);
    const labelHandle = doc.querySelector(`[data-edge-label-handle="${edge.id}"]`);
    firePointer(window, labelHandle, "pointerdown", {clientX:start.x, clientY:start.y});
    firePointer(window, doc.getElementById("board"), "pointermove", {clientX:target.x + 18, clientY:target.y + 18});
    firePointer(window, doc.getElementById("board"), "pointerup", {clientX:target.x + 18, clientY:target.y + 18});
    const moved = T.edgeLabelPoint(edge, ep);
    assert(T.projectPointToPolyline(route.points, moved).distance < 1e-6,
      "orthogonal label drag snaps exactly onto a Manhattan leg");
    const storedPosition = edge.labelPosition;
    edge.orthoX = route.bend.x + 140;
    edge.orthoY = route.bend.y + 90;
    T.render();
    const reshapedRoute = T.orthoEdgeRoute(edge, ep.pa, ep.pb);
    const reshapedLabel = T.edgeLabelPoint(edge, ep);
    assert.strictEqual(edge.labelPosition, storedPosition, "reshaping an orthogonal link preserves label path position");
    assert(T.projectPointToPolyline(reshapedRoute.points, reshapedLabel).distance < 1e-6,
      "the preserved orthogonal label remains on the reshaped route");
  }
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    T.setView({x:0, y:0, k:1});
    const edge = T.state.edges.find(e => e.label === "drives");
    T.render();
    let labelHandle = doc.querySelector(`[data-edge-label-handle="${edge.id}"]`);
    const point = T.edgeLabelPoint(edge, T.edgeEndpoints(edge));
    firePointer(window, labelHandle, "pointerdown", {clientX:point.x, clientY:point.y});
    firePointer(window, doc.getElementById("board"), "pointerup", {clientX:point.x, clientY:point.y});
    labelHandle = doc.querySelector(`[data-edge-label-handle="${edge.id}"]`);
    firePointer(window, labelHandle, "pointerdown", {clientX:point.x, clientY:point.y});
    const editor = doc.querySelector(".inline-editor");
    assert(editor, "double-press editing still opens from the draggable label");
    assert(Math.abs(parseFloat(editor.style.left) - (point.x - 70)) < 1,
      "the inline editor opens at the moved label path point");
  }

  /* SCH-073 — draggable orthogonal waypoint with coordinate snapping */
  {
    const { window } = makeDom();
    const T = window.__T;
    const edge = T.state.edges.find(e => e.kind !== "link");
    edge.routing = "ortho";
    const ep = T.edgeEndpoints(edge);
    const automatic = T.orthoEdgeRoute(null, ep.pa, ep.pb);
    assert.strictEqual(T.edgePath(edge, ep.pa, ep.pb), automatic.d,
      "untouched orthogonal edge keeps the legacy automatic route");
    const lengthMidpoint = T.polylineMidpoint([{x:0,y:0}, {x:0,y:10}, {x:30,y:10}]);
    assert.strictEqual(lengthMidpoint.x, 10, "polyline midpoint follows cumulative segment length on x");
    assert.strictEqual(lengthMidpoint.y, 10, "polyline midpoint follows cumulative segment length on y");
    const automaticLabel = T.edgeLabelPoint(edge, ep);
    const previewEdge = {...edge, orthoX:automatic.bend.x + 160, orthoY:automatic.bend.y + 120};
    const previewRoute = T.orthoEdgeRoute(previewEdge, ep.pa, ep.pb);
    const previewLabel = T.edgeLabelPoint(previewEdge, ep);
    assert.deepStrictEqual(previewLabel, T.polylineMidpoint(previewRoute.points),
      "custom orthogonal label uses the routed polyline midpoint");
    assert.notDeepStrictEqual(previewLabel, automaticLabel,
      "moving the waypoint changes the orthogonal label position");

    const snapped = T.snapOrthoBend(edge,
      {x:automatic.a.x + 3, y:automatic.a.y - 3}, ep, 6);
    assert.strictEqual(snapped.x, automatic.a.x, "waypoint x snaps to a significant stub coordinate");
    assert.strictEqual(snapped.y, automatic.a.y, "waypoint y snaps independently to a significant stub coordinate");
    const free = T.snapOrthoBend(edge,
      {x:Math.max(...snapped.xCandidates) + 30.4, y:Math.max(...snapped.yCandidates) + 30.4}, ep, 6);
    assert.strictEqual(free.snapX, null, "waypoint x stays free outside the snap threshold");
    assert.strictEqual(free.snapY, null, "waypoint y stays free outside the snap threshold");
    const gridSnapped = T.snapOrthoBend(edge,
      {x:35, y:59}, ep, 6, true);
    assert.strictEqual(gridSnapped.x, 36, "Shift-mode waypoint x can snap between canvas grid points");
    assert.strictEqual(gridSnapped.y, 60, "Shift-mode waypoint y can snap between canvas grid points");
    assert.strictEqual(gridSnapped.x % 12, 0, "Shift-mode waypoint x uses half-grid resolution");
    assert.strictEqual(gridSnapped.y % 12, 0, "Shift-mode waypoint y uses half-grid resolution");
    assert.strictEqual(gridSnapped.x % 24, 12, "Shift-mode waypoint x exposes a horizontal midpoint");
    assert.strictEqual(gridSnapped.y % 24, 12, "Shift-mode waypoint y exposes a vertical midpoint");
    assert.strictEqual(gridSnapped.gridStep, 12, "waypoint grid results expose the half-grid step");
    assert.strictEqual(gridSnapped.grid, true, "grid-snapped waypoint result identifies its snap mode");

    T.setSelection("edge", edge.id);
    T.render();
    let handle = window.document.querySelector(
      `[data-edgebend="${edge.id}"][data-edgecorner="bend"]`);
    assert(handle, "selected orthogonal edge exposes its central corner handle");
    const automaticCorners = T.orthoRouteCornerHandles(automatic);
    assert(automaticCorners.length >= 2, "automatic orthogonal routes expose every visible corner");
    assert.strictEqual(window.document.querySelectorAll("[data-edgebend]").length,
      automaticCorners.length, "every visible orthogonal corner gets one canvas handle");
    const beforeUndo = T.undoDepth;
    firePointer(window, handle, "pointerdown", {clientX:automatic.bend.x, clientY:automatic.bend.y});
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:automatic.a.x + 3, clientY:automatic.b.y - 3});
    assert.strictEqual(edge.orthoX, automatic.a.x, "pointer drag snaps waypoint x");
    assert.strictEqual(edge.orthoY, automatic.b.y, "pointer drag snaps waypoint y");
    const draggedLabel = T.edgeLabelPoint(edge, ep);
    const labelText = window.document.querySelector(`[data-edge="${edge.id}"] [data-edge-label]`);
    assert.strictEqual(Number(labelText.getAttribute("x")), draggedLabel.x,
      "waypoint drag redraws the label at the routed midpoint x");
    assert.strictEqual(Number(labelText.getAttribute("y")), draggedLabel.y + 3.5,
      "waypoint drag redraws the label at the routed midpoint y");
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "waypoint drag creates one undo step");
    assert(window.document.querySelector("[data-ortho-snap-x]"), "x snap draws an alignment guide");
    assert(window.document.querySelector("[data-ortho-snap-y]"), "y snap draws an alignment guide");
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:automatic.a.x + 3, clientY:automatic.b.y - 3});
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "continued waypoint movement stays in one undo step");
    firePointer(window, window.document.getElementById("board"), "pointerup",
      {clientX:automatic.a.x + 3, clientY:automatic.b.y - 3});
    assert(!window.document.querySelector("[data-ortho-snap-x], [data-ortho-snap-y]"),
      "snap guides clear when the drag ends");

    handle = window.document.querySelector(
      `[data-edgebend="${edge.id}"][data-edgecorner="bend"]`);
    const shiftStart = T.orthoEdgeRoute(edge, ep.pa, ep.pb).bend;
    const shiftTarget = {
      x:Math.floor(shiftStart.x / 24) * 24 + 36,
      y:Math.floor(shiftStart.y / 24) * 24 + 36
    };
    const expectedGrid = T.snapOrthoBend(edge, shiftTarget, ep, 6, true);
    const expectedNormal = T.snapOrthoBend(edge, shiftTarget, ep);
    assert(expectedGrid.x !== expectedNormal.x || expectedGrid.y !== expectedNormal.y,
      "test target distinguishes grid snapping from normal coordinate snapping");
    const beforeShiftUndo = T.undoDepth;
    firePointer(window, handle, "pointerdown",
      {clientX:shiftStart.x, clientY:shiftStart.y, shiftKey:true});
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:shiftTarget.x, clientY:shiftTarget.y, shiftKey:true});
    assert.strictEqual(edge.orthoX, expectedGrid.x,
      "holding Shift while dragging snaps the orthogonal waypoint x to the half-grid");
    assert.strictEqual(edge.orthoY, expectedGrid.y,
      "holding Shift while dragging snaps the orthogonal waypoint y to the half-grid");
    assert(window.document.querySelector("[data-ortho-snap-x]") &&
      window.document.querySelector("[data-ortho-snap-y]"),
      "Shift grid snapping shows both waypoint guides");
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:shiftTarget.x, clientY:shiftTarget.y});
    assert.strictEqual(edge.orthoX, expectedNormal.x,
      "releasing Shift during the same drag immediately restores normal x snapping");
    assert.strictEqual(edge.orthoY, expectedNormal.y,
      "releasing Shift during the same drag immediately restores normal y snapping");
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:shiftTarget.x, clientY:shiftTarget.y, shiftKey:true});
    firePointer(window, window.document.getElementById("board"), "pointerup",
      {clientX:shiftTarget.x, clientY:shiftTarget.y, shiftKey:true});
    assert.strictEqual(T.undoDepth, beforeShiftUndo + 1,
      "a Shift-grid waypoint drag remains one undo step");
    assert.strictEqual(edge.orthoX % 12, 0,
      "the dropped orthogonal waypoint x remains half-grid aligned");
    assert.strictEqual(edge.orthoY % 12, 0,
      "the dropped orthogonal waypoint y remains half-grid aligned");
    assert.strictEqual(edge.orthoX % 24, 12,
      "the pointer drag can drop x midway between visible grid points");
    assert.strictEqual(edge.orthoY % 24, 12,
      "the pointer drag can drop y midway between visible grid points");
    const customPath = T.edgePath(edge, ep.pa, ep.pb);
    assert(!customPath.includes("C") && customPath.includes(" Q "),
      "custom waypoint route keeps rounded orthogonal corners");
    assert(T.orthoEdgeRoute(edge, ep.pa, ep.pb).points
      .some(point => point.x === edge.orthoX && point.y === edge.orthoY),
      "custom route passes through the moved waypoint coordinates");
    let customRoute = T.orthoEdgeRoute(edge, ep.pa, ep.pb);
    let customCorners = T.orthoRouteCornerHandles(customRoute);
    for (const key of ["entry","bend","exit"])
      assert(customCorners.some(corner => corner.key === key),
        `a shaped orthogonal route exposes its ${key} corner`);
    sameList([...window.document.querySelectorAll(`[data-edgebend="${edge.id}"]`)]
      .map(corner => corner.getAttribute("data-edgecorner")),
      customCorners.map(corner => corner.key),
      "the canvas renders an independent handle at every shaped-route corner");

    const beforeEntryY = edge.orthoY;
    const entryCorner = customCorners.find(corner => corner.key === "entry");
    const entryHandle = window.document.querySelector(
      `[data-edgebend="${edge.id}"][data-edgecorner="entry"]`);
    firePointer(window, entryHandle, "pointerdown",
      {clientX:entryCorner.point.x, clientY:entryCorner.point.y, shiftKey:true});
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:entryCorner.point.x + 12, clientY:entryCorner.point.y, shiftKey:true});
    firePointer(window, window.document.getElementById("board"), "pointerup",
      {clientX:entryCorner.point.x + 12, clientY:entryCorner.point.y, shiftKey:true});
    assert.strictEqual(edge.orthoX, entryCorner.point.x + 12,
      "dragging the entry corner moves its vertical route leg");
    assert.strictEqual(edge.orthoY, beforeEntryY,
      "dragging the entry corner preserves the independent exit leg");

    customRoute = T.orthoEdgeRoute(edge, ep.pa, ep.pb);
    customCorners = T.orthoRouteCornerHandles(customRoute);
    const beforeExitX = edge.orthoX;
    const exitCorner = customCorners.find(corner => corner.key === "exit");
    const exitHandle = window.document.querySelector(
      `[data-edgebend="${edge.id}"][data-edgecorner="exit"]`);
    firePointer(window, exitHandle, "pointerdown",
      {clientX:exitCorner.point.x, clientY:exitCorner.point.y, shiftKey:true});
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:exitCorner.point.x, clientY:exitCorner.point.y + 12, shiftKey:true});
    firePointer(window, window.document.getElementById("board"), "pointerup",
      {clientX:exitCorner.point.x, clientY:exitCorner.point.y + 12, shiftKey:true});
    assert.strictEqual(edge.orthoY, exitCorner.point.y + 12,
      "dragging the exit corner moves its horizontal route leg");
    assert.strictEqual(edge.orthoX, beforeExitX,
      "dragging the exit corner preserves the independent entry leg");

    for (const key of ["from-stub","to-stub"]){
      customRoute = T.orthoEdgeRoute(edge, ep.pa, ep.pb);
      customCorners = T.orthoRouteCornerHandles(customRoute);
      const stubCorner = customCorners.find(corner => corner.key === key);
      if (!stubCorner) continue;
      const axis = stubCorner.axes[0];
      const endpoint = key === "from-stub" ? customRoute.pa : customRoute.pb;
      const sign = endpoint.side === "e" || endpoint.side === "s" ? 1 : -1;
      const target = {...stubCorner.point,
        [axis]:stubCorner.point[axis] + sign*37};
      const expected = T.snapOrthoBend(edge, target, ep);
      const stubHandle = window.document.querySelector(
        `[data-edgebend="${edge.id}"][data-edgecorner="${key}"]`);
      firePointer(window, stubHandle, "pointerdown",
        {clientX:stubCorner.point.x, clientY:stubCorner.point.y});
      firePointer(window, window.document.getElementById("board"), "pointermove",
        {clientX:target.x, clientY:target.y});
      firePointer(window, window.document.getElementById("board"), "pointerup",
        {clientX:target.x, clientY:target.y});
      const movedRoute = T.orthoEdgeRoute(edge, ep.pa, ep.pb);
      const movedPoint = key === "from-stub" ? movedRoute.a : movedRoute.b;
      assert.strictEqual(movedPoint[axis], expected[axis],
        `dragging the ${key} corner moves its endpoint stub`);
    }

    const parsed = JSON.parse(T.serializeDocument());
    const saved = parsed.edges.find(e => e.id === edge.id);
    assert.strictEqual(saved.orthoX, edge.orthoX, "waypoint x serializes");
    assert.strictEqual(saved.orthoY, edge.orthoY, "waypoint y serializes");
    for (const key of ["orthoFromStub","orthoToStub"])
      assert.strictEqual(saved[key], edge[key], `${key} serializes when its corner is moved`);
    const { window:importWindow } = makeDom();
    importWindow.__T.importDocText(JSON.stringify(parsed));
    const imported = importWindow.__T.state.edges.find(e => e.id === edge.id);
    assert.strictEqual(imported.orthoX, edge.orthoX, "waypoint x imports");
    assert.strictEqual(imported.orthoY, edge.orthoY, "waypoint y imports");
    for (const key of ["orthoFromStub","orthoToStub"])
      assert.strictEqual(imported[key], edge[key], `${key} imports when its corner is moved`);
    const copied = T.remapPayload(T.cloneSelectionPayload([edge.from, edge.to]), 36);
    assert.strictEqual(copied.edges[0].orthoX, edge.orthoX + 36, "copied waypoint x follows copied nodes");
    assert.strictEqual(copied.edges[0].orthoY, edge.orthoY + 36, "copied waypoint y follows copied nodes");
    for (const key of ["orthoFromStub","orthoToStub"])
      assert.strictEqual(copied.edges[0][key], edge[key],
        `${key} remains endpoint-relative when copied`);
    assert(!T.serializedSvg(true).includes("data-edgebend"), "SVG export excludes the editing waypoint");
    const savedBend = {x:edge.orthoX, y:edge.orthoY};
    edge.orthoX = 2400;
    edge.orthoY = -1300;
    const expandedBounds = T.documentBounds();
    assert(expandedBounds.x + expandedBounds.w >= edge.orthoX && expandedBounds.y <= edge.orthoY,
      "document bounds include a custom waypoint outside the node bounds");
    edge.orthoX = savedBend.x;
    edge.orthoY = savedBend.y;
    T.render();

    const reset = window.document.getElementById("edgeResetOrthoBend");
    assert(reset && !reset.disabled, "inspector offers reset for a moved waypoint");
    reset.click();
    assert.strictEqual(edge.orthoX, undefined, "inspector reset clears waypoint x");
    assert.strictEqual(edge.orthoY, undefined, "inspector reset clears waypoint y");
    assert.strictEqual(edge.orthoFromStub, undefined, "inspector reset clears the start stub corner");
    assert.strictEqual(edge.orthoToStub, undefined, "inspector reset clears the end stub corner");
    assert.strictEqual(T.edgePath(edge, ep.pa, ep.pb), automatic.d,
      "reset restores the automatic orthogonal route");
    const resetLabel = T.edgeLabelPoint(edge, ep);
    assert.strictEqual(resetLabel.x, automaticLabel.x, "reset restores the automatic label x");
    assert.strictEqual(resetLabel.y, automaticLabel.y, "reset restores the automatic label y");

    handle = window.document.querySelector(
      `[data-edgebend="${edge.id}"][data-edgecorner="bend"]`);
    const keyboardStart = T.orthoEdgeRoute(edge, ep.pa, ep.pb).bend.x;
    handle.dispatchEvent(new window.KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true, cancelable:true}));
    assert.strictEqual(edge.orthoX, keyboardStart + 4, "keyboard can nudge the waypoint");

    const beforeGroupMove = {x:edge.orthoX, y:edge.orthoY};
    T.setSelection("node", [edge.from, edge.to]);
    T.render();
    const fromNode = T.state.nodes.find(n => n.id === edge.from);
    const beforeFromMove = {x:fromNode.x, y:fromNode.y};
    const fromGroup = window.document.querySelector(`[data-node="${edge.from}"]`);
    firePointer(window, fromGroup, "pointerdown", {clientX:fromNode.x + 4, clientY:fromNode.y + 4});
    firePointer(window, window.document.getElementById("board"), "pointermove",
      {clientX:fromNode.x + 28, clientY:fromNode.y + 28});
    firePointer(window, window.document.getElementById("board"), "pointerup",
      {clientX:fromNode.x + 28, clientY:fromNode.y + 28});
    assert.strictEqual(edge.orthoX, beforeGroupMove.x + (fromNode.x - beforeFromMove.x),
      "moving both endpoints translates waypoint by the snapped x delta");
    assert.strictEqual(edge.orthoY, beforeGroupMove.y + (fromNode.y - beforeFromMove.y),
      "moving both endpoints translates waypoint by the snapped y delta");

    T.setSelection("edge", edge.id);
    T.render();
    T.edgeMenu(edge, 20, 20);
    const contextReset = [...window.document.querySelectorAll("#ctxMenu .ctxitem")]
      .find(button => button.textContent.includes("Reset all to automatic"));
    assert(contextReset, "edge context menu offers reset for every moved corner");
    contextReset.click();
    assert.strictEqual(edge.orthoX, undefined, "context-menu reset clears waypoint x");
    assert.strictEqual(edge.orthoY, undefined, "context-menu reset clears waypoint y");
    assert.strictEqual(edge.orthoFromStub, undefined, "context-menu reset clears the start stub corner");
    assert.strictEqual(edge.orthoToStub, undefined, "context-menu reset clears the end stub corner");
  }

  /* SCH-043 — minimap */
  {
    const { window } = makeDom();
    const T = window.__T;
    const bounds = { x:0, y:0, w:1000, h:500 };
    const view = { x:-200, y:-100, k:2 };
    const tx = T.minimapTransform(bounds, view, { w:120, h:90, viewportW:1200, viewportH:800 });
    const worldPoint = { x:345, y:210 };
    const miniPoint = tx.toMini(worldPoint);
    const roundTrip = tx.toWorld(miniPoint);
    closeEnough(roundTrip.x, worldPoint.x, "minimap x inverse");
    closeEnough(roundTrip.y, worldPoint.y, "minimap y inverse");
    closeEnough(tx.viewport.x, (-view.x / view.k) * tx.scale + tx.ox, "viewport rect x matches view");
    closeEnough(tx.viewport.y, (-view.y / view.k) * tx.scale + tx.oy, "viewport rect y matches view");

    T.setView({ x:0, y:0, k:1 });
    T.render();
    const liveBounds = T.documentBounds();
    const liveTx = T.minimapTransform(liveBounds, T.view, { w:120, h:90, viewportW:1200, viewportH:800 });
    const target = { x:liveBounds.cx, y:liveBounds.cy };
    const click = liveTx.toMini(target);
    firePointer(window, window.document.getElementById("minimap"), "pointerdown", { clientX:click.x, clientY:click.y });
    closeEnough(T.view.x, 600 - target.x, "minimap click centers view x");
    closeEnough(T.view.y, 400 - target.y, "minimap click centers view y");
  }

  /* SCH-044 — dark theme */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.applyTheme("dark", { render:true, dirty:true });
    assert.strictEqual(T.docTheme, "dark", "theme switches to dark");
    assert.strictEqual(window.document.documentElement.dataset.theme, "dark", "dark theme updates chrome data attribute");
    assert.strictEqual(JSON.parse(T.serializeDocument()).meta.theme, "dark", "theme persists in document metadata");
    const defaultPng = T.cloneBoardForPng(false);
    assert.strictEqual(defaultPng.themeName, "light", "PNG defaults to light export");
    assert.strictEqual(T.docTheme, "dark", "default light PNG clone restores dark document theme");
    T.setPngAsShown(true);
    const shownPng = T.cloneBoardForPng(true);
    assert.strictEqual(shownPng.themeName, "dark", "PNG as shown uses the current dark theme");
    const drawStart = script.indexOf("function drawEdge");
    const drawEnd = script.indexOf("/* ------------------------- Mutations");
    assert(!script.slice(drawStart, drawEnd).includes("#16232F"), "draw code routes ink through THEME instead of literal #16232F");
  }

  /* SCH-045 — frames / subject areas */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({ version:1, nextId:4, nodes:[
      { id:"n1", type:"frame", x:0, y:0, title:"Area", color:"#2456E6", w:300, h:220 },
      { id:"n2", type:"concept", x:60, y:70, title:"Inside", notes:"", color:"#FFE9A8" },
      { id:"n3", type:"concept", x:420, y:70, title:"Outside", notes:"", color:"#CFE8FF" }
    ], edges:[] }));
    T.setView({ x:0, y:0, k:1 });
    T.render();
    const frame = T.state.nodes.find(n => n.id === "n1");
    const inside = T.state.nodes.find(n => n.id === "n2");
    const outside = T.state.nodes.find(n => n.id === "n3");
    sameList(T.frameContainedNodes(frame).map(n => n.id), ["n2"], "frame detects contained node centers");
    const beforeDepth = T.undoDepth;
    const before = { frameX:frame.x, insideX:inside.x, outsideX:outside.x };
    firePointer(window, window.document.querySelector('[data-frame="n1"]'), "pointerdown", { clientX:10, clientY:10 });
    firePointer(window, window.document.getElementById("board"), "pointermove", { clientX:90, clientY:10 });
    firePointer(window, window.document.getElementById("board"), "pointerup", { clientX:90, clientY:10 });
    assert.strictEqual(T.undoDepth, beforeDepth + 1, "frame drag creates one undo entry");
    assert(frame.x > before.frameX && inside.x > before.insideX, "frame drag moves frame and contained node");
    assert.strictEqual(outside.x, before.outsideX, "frame drag leaves outside nodes alone");
    T.undo();
    assert.strictEqual(T.state.nodes.find(n => n.id === "n1").x, before.frameX, "undo restores frame position");
    assert.strictEqual(T.state.nodes.find(n => n.id === "n2").x, before.insideX, "undo restores contained node position");

    T.render();
    const frameAfterUndo = T.state.nodes.find(n => n.id === "n1");
    const oldW = frameAfterUndo.w, oldH = frameAfterUndo.h;
    firePointer(window, window.document.querySelector('[data-frame-resize="n1"]'), "pointerdown", { clientX:oldW, clientY:oldH });
    firePointer(window, window.document.getElementById("board"), "pointermove", { clientX:oldW + 60, clientY:oldH + 44 });
    firePointer(window, window.document.getElementById("board"), "pointerup", { clientX:oldW + 60, clientY:oldH + 44 });
    assert(frameAfterUndo.w > oldW && frameAfterUndo.h > oldH, "frame resize handle changes dimensions");
    const layerIds = [...window.document.querySelector("#world").children].map(el => el.id || el.getAttribute("data-bg") || "");
    assert.deepStrictEqual(layerIds.slice(1, 4), ["frameLayer", "edgeLayer", "nodeLayer"], "frame layer renders behind edges and nodes");
    assert.strictEqual(T.hitTest({ x:260, y:190 }), null, "hitTest ignores frames for edge targeting");
    T.addEdge({ id:"n1" }, { id:"n2" });
    assert.strictEqual(T.state.edges.length, 0, "frames cannot be edge endpoints");
    const parsed = JSON.parse(T.serializeDocument());
    assert(parsed.nodes.some(n => n.type === "frame" && n.w && n.h), "frame JSON round-trips dimensions");
    T.importDocText(JSON.stringify(parsed));
    assert(T.state.nodes.some(n => n.type === "frame" && n.title === "Area"), "frame imports from JSON");
  }

  /* SCH-102 — optional configurable frame borders */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    const row = label => [...doc.querySelectorAll("#inspBody .frow")]
      .find(item => item.querySelector("label")?.textContent === label);
    T.importDocText(JSON.stringify({version:1, nextId:2, nodes:[
      {id:"f1", type:"frame", x:20, y:30, title:"Legacy frame", color:"#2456E6", w:320, h:210}
    ], edges:[]}));
    T.setView({x:0, y:0, k:1});
    T.render();

    let frame = T.state.nodes[0];
    let surface = doc.querySelector('[data-frame="f1"] [data-frame-surface]');
    assert.strictEqual(T.frameBorderEnabled(frame), false, "legacy frames load with the optional border off");
    assert.strictEqual(surface.getAttribute("stroke"), "none", "an unselected borderless frame paints no outline");
    let saved = JSON.parse(T.serializeDocument()).nodes[0];
    assert(!Object.hasOwn(saved, "borderEnabled") && !Object.hasOwn(saved, "borderWidth") &&
      !Object.hasOwn(saved, "borderColor"), "legacy frame JSON stays compact and unchanged");

    T.selectNode("f1");
    assert(doc.querySelector('[data-frame="f1"] [data-frame-selection]'),
      "a borderless selected frame retains a separate selection outline");
    assert.strictEqual(doc.querySelector('[data-frame="f1"] [data-frame-surface]').getAttribute("stroke"), "none",
      "selection does not mutate or impersonate the saved frame border");
    assert.strictEqual(row("Border").querySelector("button").textContent, "Off",
      "frame inspector identifies the disabled border state");
    assert.strictEqual(row("Border width"), undefined, "border details stay hidden until the border is enabled");

    const enableDepth = T.undoDepth;
    row("Border").querySelector("button").click();
    frame = T.state.nodes[0];
    assert(T.frameBorderEnabled(frame), "inspector enables the frame border");
    assert.strictEqual(T.undoDepth, enableDepth + 1, "enabling a border creates one undo entry");
    surface = doc.querySelector('[data-frame="f1"] [data-frame-surface]');
    assert.strictEqual(surface.getAttribute("stroke"), "#2456e6", "border color initially follows the frame color");
    assert.strictEqual(surface.getAttribute("stroke-width"), "2", "border starts at the two-pixel default");
    assert(row("Border width") && row("Border color"), "enabled border reveals width and color controls");

    T.undo();
    assert.strictEqual(T.frameBorderEnabled(T.state.nodes[0]), false, "undo disables the border in one step");
    T.redo();
    assert(T.frameBorderEnabled(T.state.nodes[0]), "redo restores the border");

    const widthInput = row("Border width").querySelector(".sizeval");
    widthInput.value = "7";
    widthInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    widthInput.dispatchEvent(new window.Event("blur", {bubbles:true}));
    frame = T.state.nodes[0];
    assert.strictEqual(T.frameBorderWidth(frame), 7, "inspector accepts an exact frame border width");
    assert.strictEqual(doc.querySelector('[data-frame="f1"] [data-frame-surface]').getAttribute("stroke-width"), "7",
      "configured width reaches the canvas artwork");

    doc.querySelector('#frameBorderColor [data-color="#c20029"]').click();
    frame = T.state.nodes[0];
    assert.strictEqual(T.normalizeColorValue(frame.borderColor), "#c20029", "inspector sets an independent border color");
    surface = doc.querySelector('[data-frame="f1"] [data-frame-surface]');
    assert.strictEqual(surface.getAttribute("stroke"), "#c20029", "configured border color reaches the canvas");

    frame.borderColor = "#c2002980";
    frame.collapsed = true;
    T.render();
    surface = doc.querySelector('#nodeLayer [data-frame="f1"] [data-frame-surface]');
    assert.strictEqual(surface.getAttribute("stroke"), T.normalizeHex("#c2002980"),
      "transparent border colors render as the expected opaque white blend on collapsed frames");
    assert.strictEqual(surface.getAttribute("stroke-width"), "7", "collapsed frames preserve the configured border width");

    saved = JSON.parse(T.serializeDocument()).nodes[0];
    assert.strictEqual(saved.borderEnabled, true, "border visibility round-trips through JSON");
    assert.strictEqual(saved.borderWidth, 7, "border width round-trips through JSON");
    assert.strictEqual(saved.borderColor, "#c2002980", "border color and transparency round-trip through JSON");
    const svg = T.serializedSvg(true);
    assert(svg.includes('data-frame-border="true"'), "SVG export preserves the configured frame border");
    assert(!svg.includes("data-frame-selection"), "SVG export strips the temporary frame selection outline");

    T.importDocText(JSON.stringify(saved ? {version:1, nextId:2, nodes:[saved], edges:[]} : {}));
    assert(T.frameBorderEnabled(T.state.nodes[0]) && T.frameBorderWidth(T.state.nodes[0]) === 7,
      "saved frame border settings reload without loss");
    T.importDocText(JSON.stringify({version:1, nextId:2, nodes:[
      {id:"f2", type:"frame", x:0, y:0, title:"Malformed", color:"#2456E6", w:300, h:200,
       borderEnabled:"yes", borderWidth:99, borderColor:"not-a-color"}
    ], edges:[]}));
    frame = T.state.nodes[0];
    assert.strictEqual(T.frameBorderEnabled(frame), false, "only a literal true enables an imported border");
    assert.strictEqual(T.frameBorderWidth(frame), 16, "imported border widths clamp to the supported range");
    assert.strictEqual(frame.borderColor, undefined, "invalid imported border colors are removed");
  }

  /* SCH-094 — collapsible frames preserve and restore their contents */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1, nextId:10, nodes:[
      {id:"f1", type:"frame", x:0, y:0, title:"Program", color:"#2456E6", w:300, h:220},
      {id:"n2", type:"concept", x:40, y:60, title:"Discovery", notes:"", color:"#FFE9A8"},
      {id:"n3", type:"concept", x:150, y:90, title:"Delivery", notes:"", color:"#CFE8FF"},
      {id:"lane4", type:"swimlane", orientation:"horizontal", x:80, y:120, title:"Nested lane",
        color:"#DCEAFE", titleColor:"#2456E6", w:260, h:180},
      {id:"n5", type:"concept", x:180, y:210, title:"Nested outside parent", notes:"", color:"#D7F3DF"},
      {id:"n6", type:"concept", x:450, y:70, title:"Outside", notes:"", color:"#E9E2F8"}
    ], edges:[
      {id:"e7", from:"n2", to:"n3", kind:"link", label:"internal"},
      {id:"e8", from:"n5", to:"n6", kind:"link", label:"crosses boundary"},
      {id:"e9", from:"n3", to:"n6", kind:"link", label:"orthogonal boundary",
        routing:"ortho", orthoX:350, orthoY:120}
    ]}));
    T.setView({x:0, y:0, k:1});
    const frame = T.state.nodes.find(n => n.id === "f1");
    const original = {w:frame.w, h:frame.h};
    const boundaryBeforeCollapse = T.edgeEndpoints(T.state.edges.find(e => e.id === "e8"));
    sameList(T.collapsedFrameContentNodes(frame).map(n => n.id).sort(), ["lane4","n2","n3","n5"],
      "frame collapse includes nested structural contents outside the parent footprint");

    const historyBefore = T.undoDepth;
    assert(T.setFrameCollapsed(frame, true), "frame can be collapsed");
    assert.strictEqual(T.undoDepth, historyBefore + 1, "collapse creates one undo entry");
    sameList(Object.values(T.nodeRect(frame)), [0,0,220,48,110,24],
      "collapsed frame uses compact node geometry");
    assert.deepStrictEqual({w:frame.w, h:frame.h}, original, "collapse preserves expanded dimensions");
    sameList([...T.collapsedFrameHiddenNodeIds()].sort(), ["lane4","n2","n3","n5"],
      "collapsed frame hides all contained objects");
    sameList(T.visibleCanvasNodes().map(n => n.id), ["f1","n6"], "only the compact frame and outside nodes remain visible");
    sameList(T.visibleCanvasEdges().map(e => e.id), ["e8","e9"],
      "internal links hide while boundary-crossing links remain visible");
    const proxies = T.collapsedFrameProxyMap();
    for (const id of ["n2","n3","n5"])
      assert.strictEqual(proxies.get(id), "f1", `${id} is represented by the collapsed frame`);
    const frameCenter = T.nodeRect(frame);
    const boundaryEndpoint = T.edgeEndpoints(T.state.edges.find(e => e.id === "e8"));
    assert.deepStrictEqual({x:boundaryEndpoint.pa.x, y:boundaryEndpoint.pa.y},
      {x:frameCenter.cx, y:frameCenter.cy}, "curved boundary link terminates at the collapsed frame center");
    assert.strictEqual(boundaryEndpoint.proxyA, "f1", "curved boundary endpoint records its frame proxy");
    const orthoEndpoint = T.edgeEndpoints(T.state.edges.find(e => e.id === "e9"));
    assert.deepStrictEqual({x:orthoEndpoint.pa.x, y:orthoEndpoint.pa.y},
      {x:frameCenter.cx, y:frameCenter.cy}, "orthogonal boundary link terminates at the collapsed frame center");
    const orthoLabel = T.edgeLabelPoint(T.state.edges.find(e => e.id === "e9"), orthoEndpoint);
    assert(Number.isFinite(orthoLabel.x) && Number.isFinite(orthoLabel.y),
      "orthogonal boundary label follows the proxied route");
    assert(doc.querySelector('[data-frame="f1"][data-frame-collapsed="true"]'), "compact frame artwork renders");
    assert.strictEqual(doc.querySelector('[data-frame="f1"] [data-frame-count]').textContent, "4 items hidden",
      "compact frame reports how much content it contains");
    assert.strictEqual(doc.querySelector('[data-frame="f1"] [data-frame-resize]'), null,
      "compact frame does not expose a misleading resize handle");
    assert(doc.querySelector('#nodeLayer > [data-frame="f1"]'),
      "compact frame renders above retained links");
    assert.strictEqual(doc.querySelectorAll('[data-collapse="f1"]').length, 1,
      "compact frame exposes one expand control");
    assert(doc.querySelector('#nodeLayer [data-frame-collapse-overlay="f1"] [data-collapse="f1"]'),
      "compact frame expand control stays above retained links");
    assert.strictEqual(doc.querySelector('[data-node="n2"]'), null, "contained node is removed from the rendered canvas");
    assert.strictEqual(doc.querySelector('[data-edge="e7"]'), null, "contained link is removed from the rendered canvas");
    assert(doc.querySelector('[data-edge="e8"][data-edge-proxy-from="f1"]'),
      "curved boundary link renders from the collapsed frame proxy");
    assert(doc.querySelector('[data-edge="e9"][data-edge-proxy-from="f1"]'),
      "orthogonal boundary link renders from the collapsed frame proxy");
    assert(doc.querySelector('[data-node="n6"]'), "outside node remains rendered");
    assert.strictEqual(T.hitTest({x:70, y:85}), null, "hidden contents cannot be hit-tested");
    assert(doc.getElementById("inspector").textContent.includes("Collapsed"), "inspector exposes collapsed state");

    T.nodeMenu(frame, 10, 10);
    assert(doc.getElementById("ctxMenu").textContent.includes("Expand with contents"),
      "right-click menu offers frame expansion");
    T.render();
    assert(doc.getElementById("selectionMenuPanel").textContent.includes("Expand with contents"),
      "Selection dropdown mirrors the frame command");

    const savedCollapsed = JSON.parse(T.serializeDocument());
    const savedFrame = savedCollapsed.nodes.find(n => n.id === "f1");
    assert.strictEqual(savedFrame.collapsed, true, "collapsed state persists");
    assert.deepStrictEqual({w:savedFrame.w, h:savedFrame.h}, original, "saved frame retains expanded dimensions");
    assert.strictEqual(savedCollapsed.nodes.length, 6, "collapse does not remove saved objects");
    assert.strictEqual(savedCollapsed.edges.length, 3, "collapse does not remove saved links");
    const collapsedSvg = T.serializedSvg(true);
    assert(collapsedSvg.includes('data-frame-collapsed="true"'), "SVG exports the compact frame as shown");
    assert(!collapsedSvg.includes('data-node="n2"'), "SVG omits hidden contents while collapsed");
    assert(collapsedSvg.includes('data-edge-proxy-from="f1"'), "SVG retains links crossing a collapsed frame boundary");

    T.undo();
    assert.strictEqual(T.state.nodes.find(n => n.id === "f1").collapsed, undefined, "one undo expands the frame");
    assert(doc.querySelector('[data-node="n2"]'), "undo restores contained nodes");
    T.redo();
    assert.strictEqual(T.state.nodes.find(n => n.id === "f1").collapsed, true, "redo collapses the frame again");

    const collapsedAgain = T.state.nodes.find(n => n.id === "f1");
    const expandDepth = T.undoDepth;
    const collapseControl = doc.querySelector('[data-frame-collapse-overlay="f1"] [data-collapse="f1"]');
    firePointer(window, collapseControl, "pointerdown", {clientX:205, clientY:24});
    assert.strictEqual(T.undoDepth, expandDepth + 1, "canvas expand control creates one undo entry");
    const expanded = T.state.nodes.find(n => n.id === "f1");
    assert.strictEqual(expanded.collapsed, undefined, "canvas control expands the frame");
    assert(doc.querySelector('#frameLayer > [data-frame="f1"]'),
      "expanded frame returns behind links and contained nodes");
    assert.deepStrictEqual({w:T.nodeRect(expanded).w, h:T.nodeRect(expanded).h}, original,
      "expansion restores the exact original dimensions");
    assert(doc.querySelector('[data-node="n2"]') && doc.querySelector('[data-edge="e7"]') && doc.querySelector('[data-edge="e8"]'),
      "expansion restores contents and links");
    const boundaryAfterExpand = T.edgeEndpoints(T.state.edges.find(e => e.id === "e8"));
    assert.deepStrictEqual(boundaryAfterExpand, boundaryBeforeCollapse,
      "expansion restores the boundary link's original node endpoint");

    T.setFrameCollapsed(expanded, true);
    const beforeMove = Object.fromEntries(T.state.nodes.map(n => [n.id, {x:n.x, y:n.y}]));
    firePointer(window, doc.querySelector('[data-frame="f1"]'), "pointerdown", {clientX:10, clientY:10});
    firePointer(window, doc.getElementById("board"), "pointermove", {clientX:58, clientY:34});
    firePointer(window, doc.getElementById("board"), "pointerup", {clientX:58, clientY:34});
    for (const id of ["f1","n2","n3","lane4","n5"]){
      const moved = T.state.nodes.find(n => n.id === id);
      assert(moved.x > beforeMove[id].x && moved.y > beforeMove[id].y, `collapsed frame drag carries ${id}`);
    }
    assert.deepStrictEqual({x:T.state.nodes.find(n => n.id === "n6").x, y:T.state.nodes.find(n => n.id === "n6").y},
      beforeMove.n6, "collapsed frame drag leaves outside objects alone");
    const movedProxy = T.edgeEndpoints(T.state.edges.find(e => e.id === "e8"));
    const movedFrameRect = T.nodeRect(T.state.nodes.find(n => n.id === "f1"));
    assert.deepStrictEqual({x:movedProxy.pa.x, y:movedProxy.pa.y}, {x:movedFrameRect.cx, y:movedFrameRect.cy},
      "boundary links follow the collapsed frame while it moves");
    T.setFrameCollapsed(T.state.nodes.find(n => n.id === "f1"), false);
    assert.deepStrictEqual({w:T.nodeRect(T.state.nodes.find(n => n.id === "f1")).w,
                            h:T.nodeRect(T.state.nodes.find(n => n.id === "f1")).h}, original,
      "expansion after movement still restores original dimensions");

    T.importDocText(JSON.stringify(savedCollapsed));
    assert.strictEqual(T.state.nodes.find(n => n.id === "f1").collapsed, true, "collapsed frame round-trips through import");
    T.importDocText(JSON.stringify({version:1, nextId:2, nodes:[
      {id:"legacy", type:"frame", x:0, y:0, title:"Legacy", color:"#2456E6", w:300, h:200, collapsed:false}
    ], edges:[]}));
    assert.strictEqual(T.state.nodes[0].collapsed, undefined, "legacy and false collapsed values load expanded");

    T.importDocText(JSON.stringify({version:1, nextId:6, nodes:[
      {id:"outer", type:"frame", x:0, y:0, title:"Outer", color:"#2456E6", w:400, h:300},
      {id:"inner", type:"frame", x:100, y:90, title:"Inner", color:"#007873", w:200, h:120, collapsed:true},
      {id:"child", type:"concept", x:160, y:120, title:"Child", notes:"", color:"#FFE9A8"},
      {id:"outside", type:"concept", x:500, y:120, title:"Outside", notes:"", color:"#CFE8FF"}
    ], edges:[{id:"e5", from:"child", to:"outside", kind:"link", label:"nested boundary"}]}));
    sameList([...T.collapsedFrameHiddenNodeIds()], ["child"],
      "a centered nested frame never mistakes its larger parent for hidden content");
    assert.strictEqual(T.edgeEndpoints(T.state.edges[0]).proxyA, "inner",
      "an expanded outer frame leaves its collapsed inner frame as the link proxy");
    const inner = T.state.nodes.find(n => n.id === "inner");
    T.setFrameCollapsed(inner, false);
    sameList([...doc.querySelectorAll('#frameLayer > [data-frame]')].map(g => g.getAttribute("data-frame")),
      ["outer","inner"], "expanded nested frames paint above their containing frame controls");
    T.setFrameCollapsed(inner, true);
    T.setFrameCollapsed(T.state.nodes.find(n => n.id === "outer"), true);
    assert.strictEqual(T.edgeEndpoints(T.state.edges[0]).proxyA, "outer",
      "a collapsed outer frame becomes the visible proxy for all nested contents");
  }

  /* SCH-077 — horizontal and vertical swimlanes */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    T.importDocText(JSON.stringify({ version:1, nextId:5, nodes:[
      { id:"lane1", type:"swimlane", orientation:"horizontal", x:0, y:0, title:"Delivery",
        color:"#dceafe", titleColor:"#2456e6", w:600, h:180 },
      { id:"n2", type:"concept", x:180, y:60, title:"Inside", notes:"", color:"#FFE9A8" },
      { id:"n3", type:"concept", x:700, y:60, title:"Outside", notes:"", color:"#CFE8FF" }
    ], edges:[] }));
    T.setView({ x:0, y:0, k:1 });
    T.render();
    const lane = T.state.nodes.find(n => n.id === "lane1");
    const inside = T.state.nodes.find(n => n.id === "n2");
    const outside = T.state.nodes.find(n => n.id === "n3");

    assert(T.isStructuralNode(lane), "swimlanes are structural canvas objects");
    assert.strictEqual(T.swimlaneOrientation(lane), "horizontal", "horizontal orientation is retained");
    sameList(T.containerContainedNodes(lane).map(n => n.id), ["n2"], "swimlane detects contained node centers");
    const laneGroup = doc.querySelector('[data-swimlane="lane1"]');
    assert(laneGroup && laneGroup.getAttribute("data-orientation") === "horizontal", "horizontal swimlane renders");
    assert(laneGroup.querySelector('[data-swimlane-body]').getAttribute("fill") === "#dceafe", "body uses its own background");
    assert(laneGroup.querySelector('[data-swimlane-title-band]').getAttribute("fill") === "#2456e6", "title uses its own background");
    const horizontalDivider = laneGroup.querySelector('[data-swimlane-divider]');
    assert.strictEqual(Number(horizontalDivider.getAttribute("x1")), 48,
      "horizontal swimlane uses a compact 48-unit title rail");
    assert.strictEqual(Number(horizontalDivider.getAttribute("x1")) / T.nodeRect(lane).w, 0.08,
      "the default horizontal title rail occupies only eight percent of the lane");
    assert.strictEqual(laneGroup.closest("#frameLayer").id, "frameLayer", "swimlanes render behind edges and nodes");
    assert.strictEqual(laneGroup.querySelector("[data-handle]"), null, "swimlanes do not expose link handles");
    assert.strictEqual(T.hitTest({x:20, y:120}), null, "hitTest ignores swimlanes for link targeting");
    T.addEdge({id:"lane1"}, {id:"n2"});
    assert.strictEqual(T.state.edges.length, 0, "swimlanes cannot be edge endpoints");

    const beforeDepth = T.undoDepth;
    const before = { laneX:lane.x, insideX:inside.x, outsideX:outside.x };
    firePointer(window, laneGroup, "pointerdown", {clientX:10, clientY:10});
    firePointer(window, doc.getElementById("board"), "pointermove", {clientX:58, clientY:34});
    firePointer(window, doc.getElementById("board"), "pointerup", {clientX:58, clientY:34});
    assert.strictEqual(T.undoDepth, beforeDepth + 1, "swimlane drag creates one undo entry");
    assert(lane.x > before.laneX && inside.x > before.insideX, "swimlane drag moves contained content");
    assert.strictEqual(outside.x, before.outsideX, "swimlane drag leaves outside content alone");
    T.undo();

    T.selectNode("lane1");
    const titleInput = doc.getElementById("titleInput");
    titleInput.value = "Product delivery";
    titleInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(T.state.nodes.find(n => n.id === "lane1").title, "Product delivery", "lane title is editable in the inspector");
    const bodyWell = doc.querySelector("#swimlaneBodyColor input[type=color]");
    bodyWell.value = "#c20029";
    bodyWell.dispatchEvent(new window.Event("change", {bubbles:true}));
    const titleWell = doc.querySelector("#swimlaneTitleColor input[type=color]");
    titleWell.value = "#007873";
    titleWell.dispatchEvent(new window.Event("change", {bubbles:true}));
    const edited = T.state.nodes.find(n => n.id === "lane1");
    assert.strictEqual(edited.color, "#c20029", "body background changes independently");
    assert.strictEqual(edited.titleColor, "#007873", "title background changes independently");

    const orientation = doc.getElementById("swimlaneOrientation");
    orientation.value = "vertical";
    orientation.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(edited.orientation, "vertical", "inspector changes swimlane orientation");
    const verticalLaneGroup = doc.querySelector('[data-swimlane="lane1"]');
    assert.strictEqual(verticalLaneGroup.getAttribute("data-orientation"), "vertical",
      "orientation change updates rendered geometry");
    assert.strictEqual(Number(verticalLaneGroup.querySelector('[data-swimlane-divider]').getAttribute("y1")), 48,
      "vertical swimlane keeps the compact 48-unit title header");

    T.nodeMenu(edited, 10, 10);
    const menuText = doc.getElementById("ctxMenu").textContent;
    assert(menuText.includes("Body background") && menuText.includes("Title background"),
      "right-click menu exposes independent swimlane colors");
    assert(menuText.includes("Horizontal lane") && menuText.includes("Vertical lane"),
      "right-click menu exposes orientation choices");

    const parsed = JSON.parse(T.serializeDocument());
    const saved = parsed.nodes.find(n => n.id === "lane1");
    assert.strictEqual(saved.orientation, "vertical", "JSON saves swimlane orientation");
    assert.strictEqual(saved.color, "#c20029", "JSON saves swimlane body background");
    assert.strictEqual(saved.titleColor, "#007873", "JSON saves swimlane title background");
    const svg = T.serializedSvg(true);
    assert(svg.includes("data-swimlane-body") && svg.includes("data-swimlane-title-band"), "SVG export includes swimlane artwork");
    assert(!svg.includes("data-frame-resize"), "SVG export removes the swimlane resize handle");
    assert(doc.getElementById("countLabel").textContent.includes("1 lane"), "footer counts swimlanes separately");

    T.importDocText(JSON.stringify({ version:1, nextId:2, nodes:[
      {id:"bad", type:"swimlane", orientation:"diagonal", x:0, y:0, title:"", color:"nope", titleColor:"#xyz", w:-2, h:0}
    ], edges:[] }));
    const normalized = T.state.nodes[0];
    assert.strictEqual(normalized.orientation, "horizontal", "invalid imported orientation falls back safely");
    assert.strictEqual(normalized.color, "#DCEAFE", "invalid imported body background is normalized");
    assert.strictEqual(normalized.titleColor, "#2456E6", "invalid imported title background is normalized");
    assert(T.nodeRect(normalized).w >= 260 && T.nodeRect(normalized).h >= 100, "invalid imported dimensions are clamped");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    for (const id of ["btnAddHorizontalLane","btnAddVerticalLane"])
      assert(doc.getElementById(id), `swimlane ribbon control #${id} exists`);
    const before = T.state.nodes.filter(n => n.type === "swimlane").length;
    doc.getElementById("btnAddHorizontalLane").click();
    doc.getElementById("btnAddVerticalLane").click();
    sameList(T.state.nodes.filter(n => n.type === "swimlane").slice(before).map(T.swimlaneOrientation), ["horizontal","vertical"],
      "toolbar creates both swimlane orientations");
    const commands = T.paletteItems().filter(item => item.type === "command").map(item => item.command);
    assert(commands.includes("addHorizontalLane") && commands.includes("addVerticalLane"),
      "command palette exposes both swimlane orientations");
  }

  /* SCH-078 — plain text with optional shapes */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1, nextId:4, nodes:[
      {id:"txt", type:"text", x:0, y:0, title:"Diagram title", color:"#cfe8ff", fontSize:24, w:260},
      {id:"idea", type:"concept", x:420, y:90, title:"Linked idea", notes:"", color:"#FFE9A8"}
    ], edges:[]}));
    T.setView({x:0, y:0, k:1});
    T.clearSelection();
    T.render();
    const textNode = T.state.nodes.find(n => n.id === "txt");
    assert.strictEqual(T.textBoxShape(textNode), "none", "plain text defaults to no visible box");
    assert.strictEqual(T.nodeRect(textNode).w, 103,
      "legacy no-box text keeps its established content-sized width");
    assert.strictEqual(T.nodeRect(textNode).h, 39,
      "legacy no-box text keeps its established automatic height");
    let textGroup = doc.querySelector('[data-text-box="txt"]');
    assert(textGroup, "plain text renders as its own canvas primitive");
    assert.strictEqual(textGroup.getAttribute("data-text-shape"), "none", "render records the no-box shape");
    assert.strictEqual(textGroup.querySelector('[data-text-hit]').getAttribute("stroke"), "none",
      "unselected no-box text has no visible outline");
    assert.strictEqual(textGroup.querySelector('[data-plain-text]').textContent, "Diagram title", "plain text content renders");
    assert(textGroup.querySelector('[data-handle="txt"][data-anchor="mr"]').classList.contains("anchorhandle"),
      "no-box link handle stays hidden until hover or selection");

    T.selectNode("txt");
    assert(doc.getElementById("inspTitle").textContent.includes("Plain text"), "inspector identifies the plain-text primitive");
    const titleInput = doc.getElementById("titleInput");
    titleInput.value = "Customer journey overview";
    titleInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(textNode.title, "Customer journey overview", "inspector edits the text content");
    const shapeSelect = doc.getElementById("textBoxShape");
    sameList([...shapeSelect.options].map(o => o.value), T.TEXT_BOX_SHAPES.map(s => s.id),
      "text shape selector exposes no-box and every standard shape");
    const bgWell = doc.querySelector('#textBoxBackground input[type="color"]');
    bgWell.value = "#c20029";
    bgWell.dispatchEvent(new window.Event("change", {bubbles:true}));
    const inkWell = doc.querySelector('#textBoxTextColor input[type="color"]');
    inkWell.value = "#ffffff";
    inkWell.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(textNode.color, "#c20029", "shape background is editable");
    assert.strictEqual(textNode.fontColor, "#ffffff", "plain-text color is editable");

    shapeSelect.value = "circle";
    shapeSelect.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(T.textBoxShape(textNode), "circle", "inspector applies an arbitrary standard shape");
    const circleRect = T.nodeRect(textNode);
    assert.strictEqual(circleRect.w, circleRect.h, "circle text box keeps a circular aspect ratio");
    textGroup = doc.querySelector('[data-text-box="txt"]');
    assert(textGroup.querySelector('ellipse[data-text-shape-surface="circle"]'), "circle text box renders a circle surface");
    assert(textGroup.querySelectorAll('[data-text-line]').length > 1, "shaped text wraps within the available shape area");
    assert.strictEqual(T.hitTest({x:textNode.x + 2, y:textNode.y + 2}), null,
      "circle text box hit testing ignores transparent bounding-box corners");
    T.addEdge({id:"txt"}, {id:"idea"});
    assert.strictEqual(T.state.edges.length, 1, "plain text links to other nodes");
    assert.strictEqual(T.state.edges[0].kind, "link", "plain text creates a freeform link rather than a data relation");
    assert(T.edgeEndpoints(T.state.edges[0]).pa.x > textNode.x + circleRect.w*.9,
      "links meet the rendered circle silhouette");
    for (const {id} of T.TEXT_BOX_SHAPES.filter(shape => shape.id !== "none")){
      T.setTextBoxShape(textNode, id);
      T.render();
      assert(doc.querySelector(`[data-text-box="txt"] [data-text-shape-surface="${id}"]`),
        `plain text renders the ${id} shape`);
    }
    T.setTextBoxShape(textNode, "circle");
    T.render();

    T.nodeMenu(textNode, 10, 10);
    const menuText = doc.getElementById("ctxMenu").textContent;
    for (const label of ["Shape background","No box (text only)","Maximum width","Text size","Text color","Edit text"])
      assert(menuText.includes(label), `right-click menu exposes ${label}`);

    T.setTextBoxShape(textNode, "none");
    T.selectNode("txt");
    const svg = T.serializedSvg(true);
    assert(svg.includes("data-plain-text"), "SVG export retains plain text");
    assert(!svg.includes("data-text-selection"), "SVG export removes the no-box editing outline");
    const saved = JSON.parse(T.serializeDocument()).nodes.find(n => n.id === "txt");
    assert.strictEqual(saved.shape, undefined, "no-box shape stays compact in JSON");
    assert.strictEqual(saved.color, "#c20029", "JSON saves the optional shape background");
    assert.strictEqual(saved.fontColor, "#ffffff", "JSON saves plain-text color");
    T.duplicateSelection();
    const copies = T.state.nodes.filter(n => n.type === "text");
    assert.strictEqual(copies.length, 2, "plain text duplicates like other nodes");
    assert(copies.every(n => n.title === "Customer journey overview"), "duplicate preserves text content");

    T.importDocText(JSON.stringify({version:1, nextId:2, nodes:[
      {id:"bad", type:"text", x:0, y:0, title:"", shape:"starburst", color:"nope", fontColor:"invalid", fontSize:500, w:-5}
    ], edges:[]}));
    const normalized = T.state.nodes[0];
    assert.strictEqual(normalized.title, "Text", "empty imported plain text receives a usable fallback");
    assert.strictEqual(T.textBoxShape(normalized), "none", "invalid imported shape falls back to no box");
    assert.strictEqual(normalized.color, "#CFE8FF", "invalid imported background receives a safe default");
    assert.strictEqual(normalized.fontColor, undefined, "invalid imported text color is removed");
    assert.strictEqual(normalized.fontSize, 72, "imported text size is clamped");
    assert.strictEqual(normalized.w, 80, "imported maximum width is clamped");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    assert(doc.getElementById("btnAddText"), "toolbar exposes the plain-text primitive");
    assert(T.SHORTCUTS.some(s => s.keys === "X" && /plain text/i.test(s.title)), "X shortcut is registered for plain text");
    doc.getElementById("btnAddText").click();
    assert(T.state.nodes.some(n => n.type === "text"), "toolbar creates plain text");
    assert(T.paletteItems().some(item => item.command === "addText"), "command palette exposes plain text creation");
    firePointer(window, doc.getElementById("board"), "contextmenu", {clientX:1100, clientY:700});
    assert(doc.querySelector('#ctxMenu [data-ctx-action="add-text"]'),
      "canvas right-click menu exposes plain text creation");
  }

  /* SCH-099 — advanced plain-text wrapping, margins, and pixel geometry */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1, nextId:5, nodes:[
      {id:"txt", type:"text", x:20, y:30,
       title:"A deliberately long plain-text phrase that wraps inside a narrow box",
       shape:"process", color:"#cfe8ff", fontSize:20, w:180},
      {id:"idea", type:"concept", x:540, y:80, title:"Linked idea", notes:"", color:"#FFE9A8"}
    ], edges:[{id:"e1", from:"txt", to:"idea", kind:"link", label:"References"}]}));
    const textNode = () => T.state.nodes.find(n => n.id === "txt");
    T.selectNode("txt");

    let advanced = doc.querySelector('[data-inspector-section="text:advanced"]');
    assert(advanced, "plain-text inspector exposes an Advanced subsection");
    assert.strictEqual(advanced.open, false, "Advanced subsection starts collapsed");
    sameList([...advanced.querySelectorAll('input[aria-label]')].map(input => input.getAttribute("aria-label")),
      ["Text box left", "Text box top", "Text box width", "Text box height",
       "Top margin", "Right margin", "Bottom margin", "Left margin"],
      "Advanced exposes every requested pixel field in a stable order");
    const defaultWrap = doc.getElementById("textBoxWrap");
    assert(defaultWrap && defaultWrap.getAttribute("aria-pressed") === "true",
      "text wrapping is visibly enabled by default");
    assert.strictEqual(T.textBoxWrapEnabled(textNode()), true, "legacy text boxes wrap by default");
    assert(!Object.hasOwn(textNode(), "wrapText"), "default wrapping needs no stored opt-in flag");
    assert(T.textBoxLayout(textNode()).lines.length > 1, "long text wraps automatically by default");

    advanced.open = true;
    advanced.dispatchEvent(new window.Event("toggle"));
    const wrapUndoBefore = T.undoDepth;
    defaultWrap.click();
    assert.strictEqual(textNode().wrapText, false, "Wrap text control stores the explicit off state");
    assert.strictEqual(T.textBoxLayout(textNode()).lines.length, 1,
      "turning wrapping off keeps a long phrase on one line");
    assert.strictEqual(T.undoDepth, wrapUndoBefore + 1, "wrapping change creates one undo step");
    doc.getElementById("textBoxWrap").click();
    assert(!Object.hasOwn(textNode(), "wrapText"), "turning wrapping back on restores the compact default state");

    const setPixelField = (label, value) => {
      const input = doc.querySelector(`input[aria-label="${label}"]`);
      assert(input, `${label} precision input exists`);
      input.value = String(value);
      input.dispatchEvent(new window.Event("input", {bubbles:true}));
      input.dispatchEvent(new window.Event("blur", {bubbles:false}));
    };
    const leftUndoBefore = T.undoDepth;
    setPixelField("Text box left", 123);
    assert.strictEqual(textNode().x, 123, "Left updates the exact canvas x coordinate");
    assert.strictEqual(T.undoDepth, leftUndoBefore + 1, "a live pixel edit creates one undo step");
    T.undo();
    assert.strictEqual(textNode().x, 20, "undo restores the prior pixel coordinate");

    T.selectNode("txt");
    const endpointBefore = T.edgeEndpoints(T.state.edges[0]).pa;
    setPixelField("Text box top", 87);
    setPixelField("Text box left", 123);
    setPixelField("Text box width", 333);
    setPixelField("Text box height", 111);
    setPixelField("Top margin", 20);
    setPixelField("Right margin", 10);
    setPixelField("Bottom margin", 5);
    setPixelField("Left margin", 30);
    assert.strictEqual(textNode().x, 123, "precision Left persists on the node");
    assert.strictEqual(textNode().y, 87, "precision Top persists on the node");
    assert.strictEqual(textNode().manualWidth, true, "precision Width opts into a forced width");
    assert.strictEqual(textNode().w, 333, "precision Width stores the requested pixels");
    assert.strictEqual(textNode().manualHeight, true, "precision Height opts into a forced height");
    assert.strictEqual(textNode().h, 111, "precision Height stores the requested pixels");
    sameList(T.textBoxMargins(textNode()), {top:20, right:10, bottom:5, left:30},
      "four independent text margins are retained");
    const exactRect = T.nodeRect(textNode());
    assert.strictEqual(exactRect.x, 123, "node rectangle uses exact Left pixels");
    assert.strictEqual(exactRect.y, 87, "node rectangle uses exact Top pixels");
    assert.strictEqual(exactRect.w, 333, "node rectangle uses exact Width pixels");
    assert.strictEqual(exactRect.h, 111, "node rectangle uses exact Height pixels");
    const endpointAfter = T.edgeEndpoints(T.state.edges[0]).pa;
    assert(endpointAfter.x !== endpointBefore.x || endpointAfter.y !== endpointBefore.y,
      "connected links re-anchor after precision geometry changes");

    const layout = T.textBoxLayout(textNode());
    const noMargins = T.textBoxLayout({...textNode(), textMarginTop:0, textMarginRight:0,
      textMarginBottom:0, textMarginLeft:0});
    assert.strictEqual(layout.maxWidth, noMargins.maxWidth - 40,
      "left and right margins reduce the available text width");
    assert.strictEqual(layout.textX, noMargins.textX + 10,
      "asymmetric horizontal margins move the text center");
    assert.strictEqual(layout.centerY, noMargins.centerY + 7.5,
      "asymmetric vertical margins move the text center");
    const renderedLine = doc.querySelector('[data-text-box="txt"] [data-text-line="1"]');
    assert.strictEqual(Number(renderedLine.getAttribute("x")), layout.textX,
      "rendered text uses the margin-adjusted horizontal position");

    textNode().title = "First explicit line\nSecond explicit line";
    T.setTextBoxWrapping(textNode(), false);
    T.render();
    sameList(T.textBoxLayout(textNode()).lines, ["First explicit line", "Second explicit line"],
      "no-wrap mode preserves explicit newlines without adding automatic wraps");
    const saved = T.serializeDocument();
    const savedText = JSON.parse(saved).nodes.find(n => n.id === "txt");
    assert.strictEqual(savedText.wrapText, false, "disabled wrapping persists");
    assert.deepStrictEqual(
      [savedText.textMarginTop, savedText.textMarginRight, savedText.textMarginBottom, savedText.textMarginLeft],
      [20, 10, 5, 30], "all margins persist");
    assert.strictEqual(savedText.manualWidth, true, "forced width persists");
    assert.strictEqual(savedText.w, 333, "exact width persists");
    assert.strictEqual(savedText.manualHeight, true, "forced height persists");
    assert.strictEqual(savedText.h, 111, "exact height persists");

    T.duplicateSelection();
    const copy = T.state.nodes.find(n => n.type === "text" && n.id !== "txt");
    assert(copy && copy.wrapText === false && copy.manualHeight === true && copy.h === 111,
      "duplicate preserves advanced text-box layout settings");
    sameList(T.textBoxMargins(copy), {top:20, right:10, bottom:5, left:30},
      "duplicate preserves all text margins");

    T.importDocText(saved);
    assert.strictEqual(T.nodeRect(textNode()).w, 333, "exact width survives reload");
    assert.strictEqual(T.nodeRect(textNode()).h, 111, "exact height survives reload");
    assert.strictEqual(T.textBoxWrapEnabled(textNode()), false, "no-wrap mode survives reload");

    T.setSelection("node", "txt");
    T.nodeMenu(textNode(), 20, 20);
    const reset = doc.querySelector('[data-ctx-action="reset-size"]');
    assert(reset && !reset.disabled, "Reset size enables for a precision-sized text box");
    reset.click();
    assert.strictEqual(textNode().manualWidth, undefined, "Reset size clears precision width");
    assert.strictEqual(textNode().manualHeight, undefined, "Reset size clears precision height");
    assert.strictEqual(textNode().h, undefined, "Reset size restores automatic text-box height");

    T.selectNode("idea");
    assert(!doc.querySelector('[data-inspector-section="text:advanced"]'),
      "text-box Advanced controls do not leak into other node inspectors");
  }

  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({version:1, nextId:4, edges:[], nodes:[
      {id:"legacy", type:"text", x:0, y:0, title:"Legacy", color:"#CFE8FF", w:260},
      {id:"invalid", type:"text", x:200, y:0, title:"Invalid", color:"#CFE8FF", w:260,
       wrapText:"false", textMarginTop:-10, textMarginRight:999,
       textMarginBottom:"bad", manualHeight:true, h:"bad"},
      {id:"height-only", type:"text", x:400, y:0, title:"Height", color:"#CFE8FF", w:260,
       manualHeight:true, h:140},
      {id:"narrow", type:"text", x:700, y:0, title:"N", color:"#CFE8FF",
       manualWidth:true, w:45}
    ]}));
    const legacy = T.state.nodes.find(n => n.id === "legacy");
    const invalid = T.state.nodes.find(n => n.id === "invalid");
    assert.strictEqual(T.textBoxWrapEnabled(legacy), true, "legacy documents retain default wrapping");
    assert.strictEqual(T.textBoxWrapEnabled(invalid), true, "non-boolean no-wrap values are rejected");
    sameList(T.textBoxMargins(invalid), {top:0, right:400, bottom:0, left:0},
      "import clamps margins and removes invalid values");
    assert.strictEqual(invalid.manualHeight, undefined, "invalid manual height is removed on import");
    assert.strictEqual(invalid.h, undefined, "invalid height pixels are removed on import");
    const narrow = T.state.nodes.find(n => n.id === "narrow");
    assert.strictEqual(T.nodeRect(narrow).w, 45,
      "plain-text precision width preserves values below the generic node-width floor");
    assert.strictEqual(JSON.parse(T.serializeDocument()).nodes.find(n => n.id === "narrow").w, 45,
      "narrow precision width survives serialization");
    const compactLegacy = JSON.parse(T.serializeDocument()).nodes.find(n => n.id === "legacy");
    for (const key of ["wrapText", "textMarginTop", "textMarginRight", "textMarginBottom",
      "textMarginLeft", "manualHeight", "h"])
      assert(!Object.hasOwn(compactLegacy, key), `legacy text omits default ${key} metadata`);

    const heightOnly = T.state.nodes.find(n => n.id === "height-only");
    assert.strictEqual(T.hasForcedNodeSize(heightOnly), true,
      "height-only precision sizing counts as forced size");
    T.setSelection("node", heightOnly.id);
    assert.strictEqual(T.resetSelectionSizes(), 1, "Reset size handles height-only text boxes");
    assert.strictEqual(heightOnly.manualHeight, undefined, "height-only Reset size clears the force flag");
    assert.strictEqual(heightOnly.h, undefined, "height-only Reset size returns to automatic height");
  }

  /* SCH-079 — blank-canvas context menu */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    T.setView({x:40, y:20, k:2});
    firePointer(window, board, "contextmenu", {clientX:1000, clientY:700, button:2});
    let menu = doc.getElementById("ctxMenu");
    assert.strictEqual(menu.style.display, "block", "blank-canvas right-click opens the canvas menu");
    assert.strictEqual(menu.getAttribute("role"), "menu", "context surface exposes menu semantics");
    assert(menu.getAttribute("aria-label").startsWith("Canvas actions"), "canvas menu has an accessible label");
    sameList([...menu.querySelectorAll(":scope > .ctxgroup > summary span")].map(s => s.textContent),
      ["Create", "Layout", "Selection", "View", "Organize", "Model data"],
      "canvas menu groups creation, layout, selection, view, organization, and model-data actions");
    assert([...menu.querySelectorAll(":scope > .ctxgroup")].every(group => !group.open),
      "canvas submenus start compact");
    assert.strictEqual(menu.querySelectorAll(":scope > .ctxitem").length, 0,
      "canvas menus have no monolithic root-level action list");
    assert([...menu.querySelectorAll(":scope > .ctxgroup > summary")].every(summary =>
      summary.getAttribute("role") === "menuitem" &&
      summary.getAttribute("aria-haspopup") === "true" &&
      summary.getAttribute("aria-expanded") === "false"),
    "context submenu summaries expose accessible collapsed-menu state");
    sameList([...menu.querySelectorAll('[data-ctx-group="canvas:create"] > .ctxgroupbody > .ctxsubmenu > summary span')]
      .map(s => s.textContent), ["Nodes and data", "Text and notes", "Containers"],
      "creation primitives are split into focused submenus");
    const createGroup = menu.querySelector('[data-ctx-group="canvas:create"]');
    createGroup.open = true;
    createGroup.dispatchEvent(new window.Event("toggle"));
    const nodeCreateSubmenu = menu.querySelector('[data-ctx-submenu="canvas:create:nodes"]');
    const textCreateSubmenu = menu.querySelector('[data-ctx-submenu="canvas:create:text"]');
    nodeCreateSubmenu.open = true;
    nodeCreateSubmenu.dispatchEvent(new window.Event("toggle"));
    textCreateSubmenu.open = true;
    textCreateSubmenu.dispatchEvent(new window.Event("toggle"));
    assert.strictEqual(nodeCreateSubmenu.open, false,
      "opening a nested canvas submenu closes its sibling");
    assert.strictEqual(textCreateSubmenu.querySelector("summary").getAttribute("aria-expanded"), "true",
      "nested submenu accessibility state follows disclosure state");
    const createActions = [...menu.querySelectorAll('[data-ctx-group="canvas:create"] [data-ctx-action]')]
      .map(button => button.getAttribute("data-ctx-action"));
    sameList(createActions, ["add-concept", "add-status", "add-table", "add-todo", "add-text", "add-note", "add-frame",
      "add-horizontal-lane", "add-vertical-lane"], "canvas menu exposes every primitive");
    sameList([...menu.querySelectorAll('[data-ctx-group="canvas:layout"] [data-ctx-action]')]
      .map(button => button.getAttribute("data-ctx-action")),
      ["layout-tree", "layout-schema", "cleanup-grid", "toggle-snap", "layout-preview",
       "guide-manager", "toggle-rulers", "clear-guides"],
      "canvas menu reuses every layout action");
    sameList([...menu.querySelectorAll('[data-ctx-group="canvas:view"] [data-ctx-action]')]
      .map(button => button.getAttribute("data-ctx-action")),
      ["search", "search-hidden", "search-duplicates", "search-offcanvas",
       "fit", "zoom-actual", "zoom-in", "zoom-out"],
      "canvas menu exposes discovery, fit, and direct zoom controls");

    const beforeCreate = T.state.nodes.length;
    menu.querySelector('[data-ctx-action="add-text"]').click();
    const text = T.state.nodes[T.state.nodes.length - 1];
    assert.strictEqual(T.state.nodes.length, beforeCreate + 1, "canvas menu creates a primitive");
    assert.strictEqual(text.type, "text", "plain-text action creates the requested primitive");
    const textRect = T.nodeRect(text);
    closeEnough(textRect.cx, 480, "created text is horizontally centered on the clicked world coordinate");
    closeEnough(textRect.cy, 340, "created text is vertically centered on the clicked world coordinate");
    assert.strictEqual(menu.style.display, "none", "creation closes the context menu");

    const textElement = doc.querySelector(`[data-node="${text.id}"]`);
    firePointer(window, textElement, "contextmenu", {clientX:500, clientY:400, button:2});
    assert.strictEqual(menu.querySelector(".ctxhead small").textContent, "Node",
      "node right-click keeps precedence over the canvas menu");
    assert(!menu.querySelector('[data-ctx-group="canvas:create"]'),
      "node menu does not leak canvas creation actions");
    const edgeElement = doc.querySelector("[data-edge]");
    firePointer(window, edgeElement, "contextmenu", {clientX:600, clientY:400, button:2});
    assert.strictEqual(menu.querySelector(".ctxhead small").textContent, "Edge",
      "edge right-click keeps precedence over the canvas menu");

    firePointer(window, board, "contextmenu", {clientX:900, clientY:650, button:2});
    T.state.nodes[0].x = 61;
    T.state.nodes[0].y = 221;
    menu.querySelector('[data-ctx-action="cleanup-grid"]').click();
    assert(T.state.nodes.every(n => n.x % 24 === 0 && n.y % 24 === 0),
      "clean-up action snaps all nodes to the visible grid");

    firePointer(window, board, "contextmenu", {clientX:900, clientY:650, button:2});
    const snapAction = menu.querySelector('[data-ctx-action="toggle-snap"]');
    assert.strictEqual(snapAction.getAttribute("aria-pressed"), "false", "snap action reports its current state");
    snapAction.click();
    assert.strictEqual(doc.getElementById("btnSnap").getAttribute("aria-pressed"), "true",
      "canvas menu toggles the shared snap-to-grid setting");
    firePointer(window, board, "contextmenu", {clientX:900, clientY:650, button:2});
    assert.strictEqual(menu.querySelector('[data-ctx-action="toggle-snap"]').getAttribute("aria-pressed"), "true",
      "reopened canvas menu reflects the shared snap setting");

    T.setView({x:-100, y:50, k:.5});
    firePointer(window, board, "contextmenu", {clientX:600, clientY:400, button:2});
    menu.querySelector('[data-ctx-action="zoom-actual"]').click();
    closeEnough(T.view.k, 1, "actual-size action resets zoom to 100%");
    firePointer(window, board, "contextmenu", {clientX:600, clientY:400, button:2});
    menu.querySelector('[data-ctx-action="zoom-in"]').click();
    closeEnough(T.view.k, 1.2, "zoom-in action increases canvas scale");
    firePointer(window, board, "contextmenu", {clientX:600, clientY:400, button:2});
    menu.querySelector('[data-ctx-action="zoom-out"]').click();
    closeEnough(T.view.k, 1, "zoom-out action decreases canvas scale");
    T.setView({x:0, y:0, k:.2});
    firePointer(window, board, "contextmenu", {clientX:600, clientY:400, button:2});
    menu.querySelector('[data-ctx-action="fit"]').click();
    assert(T.view.k > .2, "fit action changes the view to contain the diagram");

    firePointer(window, board, "contextmenu", {clientX:700, clientY:500, button:2});
    firePointer(window, doc.body, "pointerdown", {clientX:20, clientY:20});
    assert.strictEqual(menu.style.display, "none", "outside pointerdown dismisses the canvas menu");
  }

  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document, board = doc.getElementById("board");
    T.setView({x:0, y:0, k:1});
    const cases = [
      ["add-concept", "concept"], ["add-text", "text"], ["add-note", "note"],
      ["add-table", "table"], ["add-todo", "todo"], ["add-frame", "frame"],
      ["add-horizontal-lane", "swimlane", "horizontal"],
      ["add-vertical-lane", "swimlane", "vertical"]
    ];
    cases.forEach(([action, type, orientation], index) => {
      const point = {x:180 + index*70, y:140 + index*45};
      firePointer(window, board, "contextmenu", {clientX:point.x, clientY:point.y, button:2});
      doc.querySelector(`#ctxMenu [data-ctx-action="${action}"]`).click();
      const node = T.state.nodes[T.state.nodes.length - 1];
      const rect = T.nodeRect(node);
      assert.strictEqual(node.type, type, `${action} creates the correct primitive type`);
      if (orientation) assert.strictEqual(node.orientation, orientation, `${action} keeps its lane orientation`);
      closeEnough(rect.cx, point.x, `${action} centers the rendered primitive horizontally`);
      closeEnough(rect.cy, point.y, `${action} centers the rendered primitive vertically`);
    });
  }

  /* SCH-020 — extended field metadata */
  {
    const { window } = makeDom();
    const T = window.__T;
    const customers = T.state.nodes.find(n => n.title === "customers");
    const email = customers.fields.find(f => f.name === "email");
    email.default = "'unknown@example.com'";
    email.unique = true;
    email.index = true;
    email.comment = "Customer email address";
    email.metaOpen = true;
    const tier = customers.fields.find(f => f.name === "tier");
    tier.default = "";
    tier.comment = "";
    tier.unique = false;
    tier.index = false;
    T.render();

    const parsed = JSON.parse(T.serializeDocument());
    const savedEmail = parsed.nodes.find(n => n.title === "customers").fields.find(f => f.name === "email");
    assert.strictEqual(savedEmail.default, "'unknown@example.com'", "field default serializes");
    assert.strictEqual(savedEmail.unique, true, "field unique flag serializes");
    assert.strictEqual(savedEmail.index, true, "field index flag serializes");
    assert.strictEqual(savedEmail.comment, "Customer email address", "field comment serializes");
    assert(!("metaOpen" in savedEmail), "field UI expansion state does not serialize");
    const savedTier = parsed.nodes.find(n => n.title === "customers").fields.find(f => f.name === "tier");
    assert(!("default" in savedTier) && !("comment" in savedTier) && !("unique" in savedTier) && !("index" in savedTier),
      "empty field metadata stays absent in JSON");
    assert(window.document.querySelector(`[data-node="${customers.id}"] text[title="Customer email address"]`),
      "field comments render as SVG title attributes");
    assert([...window.document.querySelectorAll(`[data-node="${customers.id}"] text`)].some(el => el.textContent === "U"),
      "unique fields render a U badge");

    const sql = T.generateSQL("postgres");
    assert(sql.includes("DEFAULT 'unknown@example.com'"), "SQL emits field default");
    assert(sql.includes("UNIQUE"), "SQL emits unique field constraint");
    assert(sql.includes("-- Customer email address"), "SQL emits field comment");
    assert(sql.includes("CREATE INDEX idx_customers_email ON customers (email);"), "SQL emits field index statement");

    T.importDocText(JSON.stringify({ version:1, nextId:3, nodes:[
      { id:"n1", type:"table", x:0, y:0, title:"old_doc", color:"#16232F", notes:"",
        fields:[{ id:"f1", name:"id", type:"INT", pk:true, fk:false, nullable:false }] }
    ], edges:[] }));
    assert.strictEqual(T.state.nodes[0].fields[0].default, undefined, "old documents import without new metadata keys");
  }

  /* SCH-021 — composite keys and multi-field relations */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({ version:1, nextId:20, nodes:[
      { id:"accounts", type:"table", x:0, y:0, title:"accounts", color:"#16232F", notes:"", fields:[
        { id:"acct_id", name:"account_id", type:"INT", pk:true, fk:false, nullable:false },
        { id:"acct_org", name:"org_id", type:"INT", pk:true, fk:false, nullable:false },
        { id:"acct_name", name:"name", type:"VARCHAR(255)", pk:false, fk:false, nullable:false }
      ] },
      { id:"usage", type:"table", x:360, y:0, title:"usage_events", color:"#2456E6", notes:"", fields:[
        { id:"usage_acct", name:"account_id", type:"INT", pk:false, fk:true, nullable:false },
        { id:"usage_org", name:"org_id", type:"INT", pk:false, fk:true, nullable:false },
        { id:"usage_ts", name:"event_ts", type:"TIMESTAMP", pk:false, fk:false, nullable:false }
      ] }
    ], edges:[
      { id:"rel", from:"accounts", to:"usage", kind:"1:N", label:"covers",
        pairs:[{fromField:"acct_id", toField:"usage_acct"}, {fromField:"acct_org", toField:"usage_org"}] }
    ] }));
    const sql = T.generateSQL("postgres");
    assert(sql.includes("PRIMARY KEY (account_id, org_id)"), "composite primary key exports");
    assert(sql.includes("FOREIGN KEY (account_id, org_id) REFERENCES accounts(account_id, org_id)"),
      "multi-column foreign key exports");
    T.render();
    assert(window.document.querySelector('[data-edge="rel"]').textContent.includes("2 cols"),
      "multi-field relation label shows the column count");
    const savedRel = JSON.parse(T.serializeDocument()).edges.find(e => e.id === "rel");
    assert.strictEqual(savedRel.pairs.length, 2, "multi-field relation pairs serialize");

    T.setSelection("node", ["accounts", "usage"]);
    T.copySelection();
    T.pasteSelection();
    const pasted = T.selectedNodes();
    const pastedAccounts = pasted.find(n => n.title === "accounts_2");
    const pastedUsage = pasted.find(n => n.title === "usage_events_2");
    const pastedEdge = T.state.edges.find(e => e.from === pastedAccounts.id && e.to === pastedUsage.id);
    assert(pastedEdge.pairs.every(p => !["acct_id","acct_org","usage_acct","usage_org"].includes(p.fromField) &&
      !["acct_id","acct_org","usage_acct","usage_org"].includes(p.toField)),
      "copy/paste remaps multi-field relation bindings");
  }

  /* SCH-022 — SQL dialect selector */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.applyDialect("mysql", { render:true, dirty:true });
    assert.strictEqual(T.docDialect, "mysql", "dialect switches in state");
    assert.strictEqual(window.document.getElementById("dialectSelect").value, "mysql", "dialect selector mirrors state");
    assert.strictEqual(JSON.parse(T.serializeDocument()).meta.dialect, "mysql", "dialect serializes in document meta");
    const mysql = T.generateSQL("mysql");
    assert(mysql.includes("`customers`"), "MySQL dialect quotes identifiers with backticks");
    assert(mysql.includes("INT AUTO_INCREMENT"), "MySQL dialect maps SERIAL to INT AUTO_INCREMENT");
    assert(mysql.includes("DATETIME"), "MySQL dialect maps TIMESTAMP to DATETIME");
    const postgres = T.generateSQL("postgres");
    assert(postgres.includes("customer_id SERIAL"), "Postgres dialect preserves SERIAL");
    const ansi = T.generateSQL("ansi");
    assert(ansi.includes("customer_id INT"), "ANSI dialect maps SERIAL to INT");
    const athena = T.generateSQL("athena");
    assert(athena.includes("CREATE EXTERNAL TABLE"), "Athena dialect emits external table scaffold");
    assert(athena.includes("STORED AS PARQUET"), "Athena dialect emits parquet storage scaffold");
    assert(athena.includes("-- LOCATION 's3://bucket/path/';"), "Athena dialect emits location TODO");
    assert(athena.includes("-- PRIMARY KEY"), "Athena dialect comments primary keys");
    assert(athena.includes("-- FOREIGN KEY"), "Athena dialect comments foreign keys");
    T.applyDialect("athena", { render:true, dirty:true });
    T.selectNode(T.state.nodes.find(n => n.type === "table").id);
    assert(window.document.getElementById("sqltypes").innerHTML.includes("STRING"), "SQL type datalist swaps with dialect");
    T.importDocText(JSON.stringify({ version:1, nextId:1, nodes:[], edges:[], meta:{ dialect:"athena" } }));
    assert.strictEqual(T.docDialect, "athena", "dialect imports from document meta");
  }

  /* SCH-023 — schema lint panel */
  {
    const { window } = makeDom();
    const T = window.__T;
    assert.strictEqual(T.lintDocument().length, 0, "seed document has no lint errors");
    const badState = { nodes:[
      { id:"t1", type:"table", x:0, y:0, title:"dupe", fields:[
        { id:"f1", name:"id", type:"INT", pk:false, fk:false, nullable:true },
        { id:"f2", name:"id", type:"INT", pk:false, fk:false, nullable:true },
        { id:"f3", name:"orphan_id", type:"INT", pk:false, fk:true, nullable:true }
      ] },
      { id:"t2", type:"table", x:0, y:0, title:"dupe", fields:[
        { id:"f4", name:"id", type:"INT", pk:true, fk:false, nullable:false }
      ] },
      { id:"p", type:"table", x:0, y:0, title:"parents", fields:[
        { id:"p_id", name:"id", type:"INT", pk:true, fk:false, nullable:false }
      ] },
      { id:"c", type:"table", x:0, y:0, title:"children", fields:[
        { id:"c_id", name:"id", type:"INT", pk:true, fk:false, nullable:false },
        { id:"c_parent", name:"parent_id", type:"VARCHAR(10)", pk:false, fk:true, nullable:false }
      ] },
      { id:"a", type:"table", x:0, y:0, title:"alpha", fields:[
        { id:"a_id", name:"id", type:"INT", pk:true, fk:false, nullable:false }
      ] },
      { id:"b", type:"table", x:0, y:0, title:"beta", fields:[
        { id:"b_id", name:"id", type:"INT", pk:true, fk:false, nullable:false }
      ] },
      { id:"empty", type:"concept", x:0, y:0, title:"", notes:"", color:"#FFE9A8" }
    ], edges:[
      { id:"mismatch", from:"p", to:"c", kind:"1:N", pairs:[{fromField:"p_id", toField:"c_parent"}] },
      { id:"nm", from:"a", to:"b", kind:"N:M" }
    ] };
    const messages = T.lintDocument(badState).map(i => i.msg);
    assert(messages.some(m => m.includes("Duplicate table name")), "lint catches duplicate table names");
    assert(messages.some(m => m.includes("has no primary key")), "lint catches missing primary keys");
    assert(messages.some(m => m.includes("Duplicate field id")), "lint catches duplicate field names");
    assert(messages.some(m => m.includes("orphan_id") && m.includes("no bound relation")), "lint catches unbound FK flags");
    assert(messages.some(m => m.includes("Type mismatch")), "lint catches relation type mismatches");
    assert(messages.some(m => m.includes("has no junction table")), "lint catches N:M without junction table");
    assert(messages.some(m => m.includes("empty title")), "lint catches empty concept titles");

    T.openLintModal();
    assert(window.document.querySelector(".lint-modal"), "lint modal opens");
    T.closeLintModal();
    assert(!window.document.querySelector(".lint-modal"), "lint modal closes");
  }

  /* SCH-024 — table notes and field collapse */
  {
    const { window } = makeDom();
    const T = window.__T;
    const customers = T.state.nodes.find(n => n.title === "customers");
    const orders = T.state.nodes.find(n => n.title === "orders");
    customers.notes = "Primary customer table";
    const edge = T.state.edges.find(e => e.from === customers.id && e.to === orders.id);
    const expanded = T.edgeEndpoints(edge);
    customers.collapsed = true;
    T.render();
    const group = window.document.querySelector(`[data-node="${customers.id}"]`);
    assert(group.textContent.includes(`${customers.fields.length} fields`), "collapsed table shows field count");
    assert(!group.textContent.includes("customer_id"), "collapsed table hides field rows");
    assert.strictEqual(T.hitTest({ x:customers.x + 20, y:customers.y + 42 }).field, null, "hitTest returns no field for collapsed table");
    const collapsed = T.edgeEndpoints(edge);
    assert.strictEqual(collapsed.boundA, false, "collapsed table edge falls back to node boundary");
    assert.notStrictEqual(collapsed.pa.y, expanded.pa.y, "collapsed table re-anchors bound edge");
    assert.strictEqual(JSON.parse(T.serializeDocument()).nodes.find(n => n.id === customers.id).collapsed, true,
      "collapsed state round-trips through JSON");
    assert(group.querySelector("circle"), "table notes render a dot indicator");
    firePointer(window, group.querySelector("[data-collapse]"), "pointerdown", { clientX:customers.x + 1, clientY:customers.y + 1 });
    assert.strictEqual(customers.collapsed, false, "collapse chevron toggles table expansion");
  }

  /* SCH-030 — SQL DDL import subset */
  {
    const { window } = makeDom();
    const T = window.__T;
    const ddl = T.generateSQL("postgres");
    const parsed = T.parseDDL(ddl);
    const names = parsed.tables.map(t => t.title).sort();
    assert(names.includes("customers") && names.includes("orders") && names.includes("reward_events"),
      "DDL parser imports generated table names");
    assert(parsed.tables.find(t => t.title === "customers").fields.some(f => f.name === "customer_id" && f.pk),
      "DDL parser imports primary keys");
    assert(parsed.fks.length >= 2, "DDL parser imports generated foreign keys");

    T.importDocText(JSON.stringify({ version:1, nextId:1, nodes:[], edges:[] }));
    const imported = T.importDDLText(ddl);
    assert.strictEqual(imported.imported, true, "DDL importer creates nodes");
    assert(T.state.nodes.some(n => n.title === "orders"), "DDL importer creates table nodes");
    assert(T.state.edges.some(e => e.kind === "1:N" && T.edgeFieldPairs(e).length), "DDL importer creates bound FK edges");

    const partial = T.parseDDL("CREATE TABLE ok (id INT PRIMARY KEY); BROKEN STATEMENT;");
    assert.strictEqual(partial.tables.length, 1, "DDL parser keeps valid statements in partial input");
    assert.strictEqual(partial.skipped.length, 1, "DDL parser reports skipped statements");
    for (const bad of [
      "CREATE TAB nope (id INT);",
      "CREATE TABLE missing_paren id INT;",
      "CREATE TABLE odd (FOREIGN KEY (x) REFERENCES);",
      "not sql at all;",
      "CREATE TABLE quoted (\"id\" INT PRIMARY KEY, amount DECIMAL(12,2)); CREATE INDEX x ON quoted(id);"
    ]){
      assert.doesNotThrow(() => T.parseDDL(bad), "malformed DDL never throws");
    }
  }

  /* SCH-031 — Mermaid ER export */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({ version:1, nextId:1, nodes:[
      { id:"a", type:"table", x:0, y:0, title:"a", color:"#16232F", notes:"", fields:[{id:"a_id", name:"id", type:"INT", pk:true, fk:false, nullable:false}] },
      { id:"b", type:"table", x:0, y:0, title:"b", color:"#2456E6", notes:"", fields:[{id:"b_id", name:"id", type:"INT", pk:true, fk:false, nullable:false}] },
      { id:"c", type:"table", x:0, y:0, title:"c", color:"#1E7A4F", notes:"", fields:[{id:"c_id", name:"id", type:"INT", pk:true, fk:false, nullable:false}] }
    ], edges:[
      { id:"e1", from:"a", to:"b", kind:"1:1", label:"one" },
      { id:"e2", from:"a", to:"c", kind:"1:N", label:"many" },
      { id:"e3", from:"b", to:"c", kind:"N:M", label:"join" }
    ] }));
    const mermaid = T.generateMermaid();
    assert(mermaid.includes("a ||--|| b"), "Mermaid export maps 1:1 cardinality");
    assert(mermaid.includes("a ||--o{ c"), "Mermaid export maps 1:N cardinality");
    assert(mermaid.includes("b }o--o{ c"), "Mermaid export maps N:M cardinality");
  }

  /* SCH-032 — Markdown outline export */
  {
    const { window } = makeDom();
    const T = window.__T;
    const outline = T.generateMarkdownOutline();
    assert(outline.includes("- Loyalty program launch"), "Markdown outline includes the seed root");
    assert(outline.includes("  > Q3 initiative"), "Markdown outline includes concept notes as blockquotes");
    assert(outline.includes("  - Tiered rewards"), "Markdown outline nests linked concepts");
    const tiers = T.state.nodes.find(n => n.title === "Tiered rewards");
    const customers = T.state.nodes.find(n => n.title === "customers");
    T.addEdge({id:tiers.id}, {id:customers.id});
    assert(T.generateMarkdownOutline().includes("    - **customers**"),
      "Markdown outline includes explicitly linked tables as leaves");

    T.importDocText(JSON.stringify({ version:1, nextId:1, nodes:[
      { id:"r", type:"concept", x:0, y:0, title:"Root", notes:"", color:"#FFE9A8" },
      { id:"a", type:"concept", x:0, y:80, title:"Cycle A", notes:"", color:"#CFE8FF" },
      { id:"b", type:"concept", x:0, y:160, title:"Cycle B", notes:"", color:"#D8F3DC" }
    ], edges:[
      { id:"ra", from:"r", to:"a", kind:"link", label:"" },
      { id:"ab", from:"a", to:"b", kind:"link", label:"" },
      { id:"ba", from:"b", to:"a", kind:"link", label:"" }
    ] }));
    assert(T.generateMarkdownOutline().includes("(→ see Cycle A)"), "Markdown outline breaks cycles with a see marker");
  }

  /* SCH-033 — SVG export */
  {
    const { window } = makeDom();
    const T = window.__T;
    const svg = T.serializedSvg(true);
    const parsed = new window.DOMParser().parseFromString(svg, "image/svg+xml");
    assert.strictEqual(parsed.documentElement.localName, "svg", "SVG export parses as XML");
    assert(!parsed.querySelector("parsererror"), "SVG export has no parser errors");
    assert(parsed.documentElement.getAttribute("viewBox"), "SVG export has a viewBox");
    assert(!svg.includes("data-handle") && !svg.includes("data-fieldhandle") && !svg.includes("data-frame-resize"),
      "SVG export strips editing handles");
    assert(svg.includes("Fonts use system fallbacks"), "SVG export includes font fallback style note");
  }

  /* SCH-034 — CSV headers to table */
  {
    const { window } = makeDom();
    const T = window.__T;
    sameList(T.parseCSVLine('"last, first",age,"quote ""ok"""'), ["last, first", "age", 'quote "ok"'], "CSV splitter handles quoted commas and escaped quotes");
    const inferred = T.inferTable([
      "id,\"last, first\",amount,created_at,active,joined,maybe",
      "1,\"Smith, Jane\",12.50,2026-07-08T10:00:00Z,true,2026-07-08,",
      "2,\"Lee, Pat\",8.00,2026-07-09T11:00:00Z,false,2026-07-09,x"
    ].join("\n"), "sample_csv");
    const byName = Object.fromEntries(inferred.fields.map(f => [f.name, f]));
    assert.strictEqual(inferred.name, "sample_csv", "CSV inference normalizes the table name");
    assert.strictEqual(byName.id.type, "INT", "CSV inference detects integer columns");
    assert.strictEqual(byName.last_first.type, "VARCHAR(255)", "CSV inference normalizes quoted header names");
    assert.strictEqual(byName.amount.type, "DECIMAL(12,2)", "CSV inference detects decimal columns");
    assert.strictEqual(byName.created_at.type, "TIMESTAMP", "CSV inference detects timestamp columns");
    assert.strictEqual(byName.active.type, "BOOLEAN", "CSV inference detects boolean columns");
    assert.strictEqual(byName.joined.type, "DATE", "CSV inference detects date columns");
    assert.strictEqual(byName.maybe.nullable, true, "CSV inference marks blank-containing columns nullable");
  }

  /* SCH-050 — touch and iPad support */
  {
    const { window } = makeDom();
    const T = window.__T;
    const next = T.pinchTransform({x:0, y:0}, {x:100, y:0}, {x:10, y:20}, {x:210, y:20}, {x:0, y:0, k:1});
    closeEnough(next.k, 2, "pinchTransform scale");
    closeEnough(next.x, 10, "pinchTransform x translation");
    closeEnough(next.y, 20, "pinchTransform y translation");
    assert([...window.document.querySelectorAll(".fieldhandle circle")].some(c => c.getAttribute("r") === "14"),
      "field handles expose larger touch-friendly hit targets");
  }

  /* SCH-051 — keyboard-only canvas navigation and ARIA */
  {
    const { window } = makeDom();
    const T = window.__T;
    const board = window.document.getElementById("board");
    assert.strictEqual(board.getAttribute("role"), "application", "board has application role");
    assert.strictEqual(board.getAttribute("tabindex"), "0", "board is keyboard focusable");
    assert(window.document.getElementById("btnSave").getAttribute("aria-label").includes("Ctrl/Cmd+S") &&
      window.document.getElementById("btnSave").title.includes("Ctrl/Cmd+S"),
    "shared commands expose their shortcut in the accessible name and tooltip");
    board.focus();
    assert.strictEqual(window.document.activeElement, board, "board receives focus");
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Tab", bubbles:true, cancelable:true }));
    assert(T.selection && T.selection.kind === "node", "Tab cycles canvas node selection");
    assert(window.document.getElementById("liveStatus").textContent.includes("Selected"), "selection changes announce to live region");
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true }));
    assert(window.document.querySelector(".inline-editor"), "Enter opens inline editor for selected node");
  }

  /* SCH-052 — performance guardrails */
  {
    const { window } = makeDom();
    const T = window.__T;
    const cacheBefore = T.textMeasureCacheSize;
    const widthA = T.textW("memoized label", "12px sans-serif");
    const cacheMid = T.textMeasureCacheSize;
    const widthB = T.textW("memoized label", "12px sans-serif");
    assert.strictEqual(widthA, widthB, "memoized text measurement returns identical values");
    assert.strictEqual(T.textMeasureCacheSize, cacheMid, "repeated text measurement reuses cache entry");
    assert(cacheMid >= cacheBefore, "text measurement cache grows monotonically before threshold clearing");

    T.perfSeed(501);
    T.setView({ x:0, y:0, k:1 });
    const node = T.state.nodes[0];
    const group = window.document.querySelector(`[data-node="${node.id}"]`);
    firePointer(window, group, "pointerdown", { clientX:node.x + 4, clientY:node.y + 4 });
    const fullAfterDown = T.renderStats.full;
    const fastBeforeMove = T.renderStats.fast;
    firePointer(window, window.document.getElementById("board"), "pointermove", { clientX:node.x + 80, clientY:node.y + 20 });
    assert(T.renderStats.fast > fastBeforeMove, "large document drag uses fast path");
    assert.strictEqual(T.renderStats.full, fullAfterDown, "large document drag avoids full redraw during pointermove");
    firePointer(window, window.document.getElementById("board"), "pointerup", { clientX:node.x + 80, clientY:node.y + 20 });
    assert(T.renderStats.full > fullAfterDown, "large document drag performs full redraw on drop");
  }

  /* SCH-053 — print stylesheet */
  {
    assert(styles.includes("@media print"), "print stylesheet is present");
    assert(styles.includes("header,aside,footer") && styles.includes("display:none"), "print stylesheet hides chrome");
  }

  /* SCH-060 — to-do node type: model, rendering, item editing */
  {
    const { window } = makeDom();
    const T = window.__T;
    assert(T.SHORTCUTS.some(s => s.keys === "D" && /to-do/i.test(s.title)), "D shortcut is registered for to-do lists");

    const todo = T.addNode("todo", 1300, 60);
    assert.strictEqual(todo.type, "todo", "addNode creates a todo node");
    assert.strictEqual(todo.items.length, 1, "new to-do list seeds one item");
    assert(todo.items[0].id, "seed item has an id");
    assert(!("done" in todo.items[0]), "new items do not write done:false");

    T.pushHistory();
    todo.title = "My list";
    todo.items.push({ id:"it_ship", text:"Ship the feature" }, { id:"it_test", text:"Write tests" });
    T.render();
    let checkboxes = window.document.querySelectorAll(`[data-todonode="${todo.id}"]`);
    assert.strictEqual(checkboxes.length, 3, "each item renders a checkbox group");
    assert.strictEqual(checkboxes[1].getAttribute("role"), "checkbox", "checkbox groups carry a checkbox role");
    assert(checkboxes[1].getAttribute("aria-label").includes("Ship the feature"), "checkbox aria-label names the item");

    const undoBefore = T.undoDepth;
    firePointer(window, checkboxes[1], "pointerdown");
    assert.strictEqual(todo.items[1].done, true, "checkbox pointerdown toggles the item done");
    assert.strictEqual(T.undoDepth, undoBefore + 1, "a toggle is exactly one undo step");
    const texts = [...window.document.querySelectorAll(`[data-node="${todo.id}"] text`)];
    assert(texts.some(t => t.textContent === "1/3"), "header shows done/total progress");
    assert.strictEqual(texts.filter(t => t.getAttribute("text-decoration") === "line-through").length, 1,
      "done items render struck through");

    checkboxes = window.document.querySelectorAll(`[data-todonode="${todo.id}"]`);
    firePointer(window, checkboxes[1], "pointerdown");
    assert(!("done" in todo.items[1]), "untoggling removes the done key entirely");

    T.undo();
    let live = T.state.nodes.find(n => n.title === "My list");
    assert.strictEqual(live.items[1].done, true, "undo restores the previous checked state");
    T.redo();
    live = T.state.nodes.find(n => n.title === "My list");
    assert(!live.items[1].done, "redo re-applies the toggle");

    const json = JSON.parse(T.serializeDocument());
    const serialized = json.nodes.find(n => n.title === "My list");
    assert.strictEqual(serialized.items.length, 3, "items serialize into the document");
    assert(!("done" in serialized.items[1]), "absent done keys stay absent in the document");
    T.importDocText(JSON.stringify(json));
    live = T.state.nodes.find(n => n.title === "My list");
    assert(live && live.items.length === 3 && live.items[2].id === "it_test", "items round-trip through import");

    const m = T.tableMetrics(live);
    const r = T.nodeRect(live);
    const hitRow = T.hitTest({ x: r.x + 20, y: r.y + m.headerH + m.rowH * 1.5 });
    assert(hitRow && hitRow.field && hitRow.field.id === live.items[1].id, "hitTest resolves the item row");

    T.pushHistory();
    live.collapsed = true;
    T.render();
    assert(!window.document.querySelector(`[data-todonode="${live.id}"]`), "collapsed list hides item rows");
    const rc = T.nodeRect(live);
    const hitCollapsed = T.hitTest({ x: rc.x + 10, y: rc.y + rc.h - 2 });
    assert(hitCollapsed && hitCollapsed.node.id === live.id && !hitCollapsed.field, "hitTest returns no item when collapsed");
    const collapsedTexts = [...window.document.querySelectorAll(`[data-node="${live.id}"] text`)].map(t => t.textContent);
    assert(collapsedTexts.includes("3 items"), "collapsed list shows the item count");
    live.collapsed = false;
    T.render();

    T.setSelection("node", live.id);
    T.duplicateSelection();
    const copy = T.state.nodes[T.state.nodes.length - 1];
    assert.strictEqual(copy.type, "todo", "duplicate creates a todo copy");
    assert.strictEqual(copy.items.length, 3, "duplicate copies all items");
    assert(copy.items.every(it => !live.items.some(orig => orig.id === it.id)), "duplicate remaps item ids");
  }

  /* To-do list footer: add items without leaving the node */
  {
    const { window } = makeDom();
    const T = window.__T;
    const todo = T.addNode("todo", 120, 80);
    todo.title = "Release checklist";
    T.render();

    const addControl = window.document.querySelector(`[data-todoadd="${todo.id}"]`);
    assert(addControl, "expanded to-do list renders an in-list add-item control");
    assert.strictEqual(addControl.getAttribute("role"), "button", "add-item control exposes a button role");
    assert.strictEqual(addControl.getAttribute("tabindex"), "0", "add-item control is keyboard focusable");
    assert(addControl.getAttribute("aria-label").includes("Release checklist"), "add-item control names its list");

    const r = T.nodeRect(todo), m = T.tableMetrics(todo);
    const addHit = T.hitTest({ x:r.x + r.w/2, y:r.y + m.headerH + m.rowH*1.5 });
    assert(addHit && addHit.node.id === todo.id && !addHit.field, "add-item footer is not treated as an item row");

    const undoBefore = T.undoDepth;
    firePointer(window, addControl, "pointerdown");
    assert.strictEqual(todo.items.length, 2, "in-list add-item control appends an item");
    assert.strictEqual(todo.items[1].text, "New item", "new footer item uses the standard placeholder text");
    assert.strictEqual(T.undoDepth, undoBefore + 1, "in-list add-item action is exactly one undo step");

    T.undo();
    let live = T.state.nodes.find(n => n.title === "Release checklist");
    assert.strictEqual(live.items.length, 1, "undo removes the item added from the list footer");
    const keyboardControl = window.document.querySelector(`[data-todoadd="${live.id}"]`);
    keyboardControl.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true }));
    assert.strictEqual(live.items.length, 2, "Enter activates the in-list add-item control");
    T.undo();
    live = T.state.nodes.find(n => n.title === "Release checklist");
    live.collapsed = true;
    T.render();
    assert(!window.document.querySelector(`[data-todoadd="${live.id}"]`), "collapsed lists hide the add-item footer");
  }

  /* SCH-067 — rich-note primitive: formatting, editing, persistence, and links */
  {
    const { window } = makeDom();
    const T = window.__T;
    assert(html.includes('id="btnAddNote"'), "toolbar exposes the rich-note primitive");
    assert(T.SHORTCUTS.some(s => s.keys === "N" && /rich note/i.test(s.title)), "N shortcut is registered for rich notes");

    const note = T.addNode("note", 1180, 80);
    assert.strictEqual(note.type, "note", "addNode creates a rich note");
    assert(note.content.includes("**bold**"), "new rich notes seed formatting guidance");
    assert.strictEqual(note.w, 300, "new rich notes use the default width");

    note.title = "Decision context";
    note.content = "# Why this matters\n- [x] Approved\n- **High confidence** with _one caveat_ and `source_id`\n<script>alert(1)</script>";
    T.render();
    const group = window.document.querySelector(`[data-node="${note.id}"]`);
    assert(group.querySelector('[data-note-surface="1"]'), "rich note renders a folded note surface");
    assert(group.querySelector('[data-note-fold="1"]'), "rich note renders a folded corner");
    assert(group.querySelector(`[data-note-content="${note.id}"]`), "rich note renders a content group");
    const noteText = [...group.querySelectorAll("text")].map(el => el.textContent).join(" ");
    assert(noteText.includes("Why this matters"), "Markdown heading content renders");
    assert(noteText.includes("☑") && noteText.includes("Approved"), "Markdown task content renders");
    assert(group.querySelector('tspan[font-weight="700"]'), "bold Markdown renders with a bold tspan");
    assert(group.querySelector('tspan[font-style="italic"]'), "italic Markdown renders with an italic tspan");
    assert(group.querySelector('tspan[font-family*="IBM Plex Mono"]'), "inline code renders in the mono font");
    assert(!group.querySelector("script"), "note markup is rendered as inert SVG text, not executable HTML");
    assert(noteText.includes("<script>alert(1)</script>"), "HTML-looking note content remains visible as text");

    const emptyLayout = T.richNoteLayout({type:"note", content:"", w:300, fontSize:13});
    assert(emptyLayout.lines[0].placeholder, "empty rich notes render a writing prompt");
    const longLayout = T.richNoteLayout({type:"note", content:"x".repeat(4000), w:220, fontSize:13});
    assert(longLayout.lines.length <= 80, "pathological note content is bounded to 80 rendered lines");
    assert(longLayout.lines.some(line => line.truncated), "bounded rich-note rendering signals truncation");

    T.selectNode(note.id);
    let contentInput = window.document.getElementById("noteContentInput");
    assert(contentInput && contentInput.tagName === "TEXTAREA", "rich-note inspector exposes a multiline editor");
    const beforeEdit = note.content;
    contentInput.dispatchEvent(new window.FocusEvent("focus"));
    contentInput.value = "## Updated\n- New evidence";
    contentInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(note.content, "## Updated\n- New evidence", "inspector edits update rich-note content");
    T.undo();
    let live = T.state.nodes.find(n => n.id === note.id);
    assert.strictEqual(live.content, beforeEdit, "undo restores rich-note content");
    T.redo();
    live = T.state.nodes.find(n => n.id === note.id);
    assert.strictEqual(live.content, "## Updated\n- New evidence", "redo restores edited rich-note content");

    const concept = T.state.nodes.find(n => n.type === "concept");
    T.addEdge({id:live.id}, {id:concept.id});
    const edge = T.state.edges[T.state.edges.length - 1];
    assert.strictEqual(edge.kind, "link", "rich-note connections use link edges");
    assert(T.edgeEndpoints(edge), "rich-note link resolves visible node-level endpoints");

    T.selectNode(live.id);
    T.duplicateSelection();
    const copy = T.state.nodes[T.state.nodes.length - 1];
    assert.strictEqual(copy.type, "note", "duplicate preserves the rich-note type");
    assert.strictEqual(copy.content, live.content, "duplicate preserves rich-note content");
    assert.notStrictEqual(copy.id, live.id, "duplicate remaps the rich-note id");

    const saved = JSON.parse(T.serializeDocument());
    const savedNote = saved.nodes.find(n => n.id === live.id);
    assert.strictEqual(savedNote.content, live.content, "rich-note content serializes");
    T.importDocText(JSON.stringify(saved));
    assert.strictEqual(T.state.nodes.find(n => n.id === live.id).content, live.content, "rich-note content round-trips through import");
    assert(T.generateMarkdownOutline().includes("**Decision context**"), "Markdown outline includes rich-note titles");
    assert(T.generateMarkdownOutline().includes("## Updated"), "Markdown outline preserves rich-note content");
    assert(T.paletteItems().some(item => item.type === "note" && item.label.includes("New evidence")),
      "command palette indexes rich-note content");
    assert(T.paletteItems().some(item => item.command === "addNote"), "command palette can add a rich note");

    const lint = T.lintDocument({
      nodes:[
        {id:"n", type:"note", title:"Context", content:"x"},
        {id:"t", type:"table", title:"records", fields:[{id:"f", name:"id", type:"INT", pk:true}]}
      ],
      edges:[{id:"bad", from:"n", to:"t", kind:"1:N"}]
    });
    assert(lint.some(issue => issue.edgeId === "bad" && /rich note/.test(issue.msg)),
      "lint rejects relation kinds attached to a rich note");
  }

  /* SCH-061 — edges to to-do lists and items */
  {
    const { window } = makeDom();
    const T = window.__T;
    const todo = T.addNode("todo", 1300, 400);
    T.pushHistory();
    todo.items.push({ id:"it_a", text:"Design" }, { id:"it_b", text:"Build" });
    T.render();
    const concept = T.state.nodes.find(n => n.type === "concept");
    const customers = T.state.nodes.find(n => n.title === "customers");

    const edgesBefore = T.state.edges.length;
    T.addEdge({ id: concept.id }, { id: todo.id, fieldId:"it_a" });
    assert.strictEqual(T.state.edges.length, edgesBefore + 1, "concept→item edge is created");
    const e1 = T.state.edges[T.state.edges.length - 1];
    assert.strictEqual(e1.kind, "link", "edges touching a todo default to the link kind");
    assert.strictEqual(e1.toField, "it_a", "the item binding is stored in the existing toField key");

    let ep = T.edgeEndpoints(e1);
    assert(ep.boundB, "item-bound end reports bound");
    assert.strictEqual(ep.pb.y, T.fieldRowCenterY(todo, 1), "edge anchors at the item row center");

    [todo.items[1], todo.items[2]] = [todo.items[2], todo.items[1]];
    T.render();
    ep = T.edgeEndpoints(e1);
    assert.strictEqual(ep.pb.y, T.fieldRowCenterY(todo, 2), "binding follows the item id after reorder");

    todo.collapsed = true;
    T.render();
    ep = T.edgeEndpoints(e1);
    assert(!ep.boundB, "collapsed list re-anchors bound edges to the node boundary");
    todo.collapsed = false;
    T.render();

    T.addEdge({ id: todo.id, fieldId:"it_b" }, { id: customers.id, fieldId: customers.fields[0].id });
    const e2 = T.state.edges[T.state.edges.length - 1];
    assert.strictEqual(e2.kind, "link", "item→table-field edges stay links");
    assert.strictEqual(e2.fromField, "it_b", "item side binds through fromField");
    assert.strictEqual(e2.toField, customers.fields[0].id, "field side binds through toField");

    const count = T.state.edges.length;
    T.addEdge({ id: todo.id, fieldId:"it_b" }, { id: customers.id, fieldId: customers.fields[0].id });
    assert.strictEqual(T.state.edges.length, count, "duplicate item edges are rejected");
    T.addEdge({ id: todo.id, fieldId:"it_a" }, { id: customers.id, fieldId: customers.fields[0].id });
    assert.strictEqual(T.state.edges.length, count + 1, "a different item to the same field is allowed");

    T.cleanFieldRefs("it_b");
    assert(!("fromField" in e2), "deleting an item cleans its edge bindings");
  }

  /* SCH-062 — interop: exports, lint, palette */
  {
    const { window } = makeDom();
    const T = window.__T;
    const sqlBefore = T.generateSQL();
    const mmdBefore = T.generateMermaid();
    const todo = T.addNode("todo", 1400, 500);
    T.pushHistory();
    todo.title = "Launch checklist";
    todo.items = [{ id:"li_1", text:"Approve copy", done:true }, { id:"li_2", text:"Load test" }];
    T.render();
    assert.strictEqual(T.generateSQL(), sqlBefore, "SQL output is byte-identical after adding an unconnected to-do list");
    assert.strictEqual(T.generateMermaid(), mmdBefore, "Mermaid output is byte-identical after adding an unconnected to-do list");
    assert(mmdBefore.includes("to-do lists are omitted"), "Mermaid header notes the omission");
    assert(sqlBefore.includes("to-do lists are not exported"), "SQL header notes the omission");

    let outline = T.generateMarkdownOutline();
    assert(outline.split("\n").includes("- Launch checklist"), "standalone to-do list is an outline root");
    assert(outline.includes("  - [x] Approve copy"), "outline marks done items checked");
    assert(outline.includes("  - [ ] Load test"), "outline marks open items unchecked");

    const strategy = T.state.nodes.find(n => n.title === "Loyalty program launch");
    T.addEdge({ id: strategy.id }, { id: todo.id });
    outline = T.generateMarkdownOutline();
    assert(!outline.split("\n").includes("- Launch checklist"), "linked to-do list is no longer a root");
    assert(outline.includes("  - Launch checklist"), "linked to-do list nests under its concept");

    const lint = T.lintDocument({
      nodes: [
        { id:"td_e", type:"todo", x:0, y:0, title:"Empty", items:[] },
        { id:"td_f", type:"todo", x:0, y:0, title:"Full", items:[{ id:"i1", text:"x" }] },
        { id:"t1", type:"table", x:0, y:0, title:"t1", fields:[{ id:"f1", name:"id", type:"INT", pk:true, fk:false, nullable:false }] }
      ],
      edges: [
        { id:"e1", from:"t1", to:"td_f", kind:"1:N", label:"" },
        { id:"e2", from:"t1", to:"td_f", kind:"link", label:"" }
      ]
    });
    assert(lint.some(i => i.level === "warning" && i.nodeId === "td_e"), "lint warns on an empty to-do list");
    assert(lint.some(i => i.level === "error" && i.edgeId === "e1"), "lint errors on a relation kind touching a to-do list");
    assert(!lint.some(i => i.edgeId === "e2"), "link edges to to-do lists pass lint");

    const items = T.paletteItems();
    assert(items.some(i => i.type === "item" && i.label === "Launch checklist.Load test"), "palette indexes list items");
    assert(items.some(i => i.type === "command" && i.label === "Add to-do list"), "palette offers the add-to-do command");
  }

  /* SCH-063 — platform parity */
  {
    const { window } = makeDom();
    const T = window.__T;
    const drawStart = script.indexOf("function drawEdge");
    const drawEnd = script.indexOf("/* ------------------------- Mutations");
    assert(script.slice(drawStart, drawEnd).includes("data-todocheck"),
      "todo drawing lives inside the THEME-checked draw section");

    const todo = T.addNode("todo", 1500, 600);
    T.pushHistory();
    todo.items.push({ id:"cp_a", text:"Wire copy" });
    T.render();
    const concept = T.state.nodes.find(n => n.type === "concept");
    T.addEdge({ id: concept.id }, { id: todo.id, fieldId:"cp_a" });
    T.setSelection("node", [concept.id, todo.id]);
    T.copySelection(false);
    const nodesBefore = T.state.nodes.length, edgesBefore = T.state.edges.length;
    T.pasteSelection();
    assert.strictEqual(T.state.nodes.length, nodesBefore + 2, "paste adds both nodes");
    assert.strictEqual(T.state.edges.length, edgesBefore + 1, "paste preserves the item-bound edge");
    const pastedTodo = T.state.nodes[T.state.nodes.length - 1];
    const pastedEdge = T.state.edges[T.state.edges.length - 1];
    assert.strictEqual(pastedTodo.type, "todo", "pasted list is a todo");
    const newItem = pastedTodo.items.find(it => it.text === "Wire copy");
    assert(newItem && newItem.id !== "cp_a", "pasted item ids are remapped");
    assert.strictEqual(pastedEdge.to, pastedTodo.id, "pasted edge points at the pasted list");
    assert.strictEqual(pastedEdge.toField, newItem.id, "pasted edge binding follows the remapped item id");

    const strategy = T.state.nodes.find(n => n.title === "Loyalty program launch");
    T.addEdge({ id: strategy.id }, { id: todo.id });
    todo.x = strategy.x; todo.y = strategy.y;
    T.setSelection("node", strategy.id);
    T.layoutMindMapTree();
    const laidOut = T.state.nodes.find(n => n.id === todo.id);
    assert(laidOut.x > strategy.x, "tree layout places link-connected to-do lists in the tree");

    const svg = T.serializedSvg(true);
    assert(!svg.includes("data-fieldhandle"), "SVG export strips row handles");
    assert(svg.includes("data-todocheck"), "SVG export keeps rendered checkboxes");
  }

  /* inline row editing — double-press edits field names and item texts in place.
     Uses real pointerdown/pointerup pairs (re-querying between presses) because the
     first press re-renders and replaces the element under the cursor — the exact
     reason native dblclick cannot be trusted on this canvas. */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.setView({ x:0, y:0, k:1 });
    const boardEl = window.document.getElementById("board");
    const press = (sel, opts) => {
      firePointer(window, window.document.querySelector(sel), "pointerdown", opts);
      firePointer(window, boardEl, "pointerup", opts);
    };
    const doublePress = (sel, opts) => { press(sel, opts); press(sel, opts); };

    const customers = T.state.nodes.find(n => n.title === "customers");
    const m = T.tableMetrics(customers);
    const r = T.nodeRect(customers);
    doublePress(`[data-node="${customers.id}"]`,
      { clientX: r.x + m.nameX + 10, clientY: r.y + m.headerH + m.rowH*1.5 });
    let editor = window.document.querySelector(".inline-editor");
    assert(editor, "double-press on a field row opens the inline editor");
    assert.strictEqual(editor.value, customers.fields[1].name, "row editor starts from the field name");
    const depthBefore = T.undoDepth;
    editor.value = "customer_email";
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true }));
    assert.strictEqual(customers.fields[1].name, "customer_email", "Enter commits the field rename");
    assert.strictEqual(T.undoDepth, depthBefore + 1, "a row commit is one undo step");
    assert(!window.document.querySelector(".inline-editor"), "the editor closes on Enter");

    const todo = T.addNode("todo", 1300, 700);
    T.pushHistory();
    todo.items.push({ id:"ie_b", text:"Polish copy" });
    T.render();
    const tm = T.tableMetrics(todo);
    const tr = T.nodeRect(todo);
    const todoSel = `[data-node="${todo.id}"]`;
    const itemPoint = { clientX: tr.x + tm.nameX + 10, clientY: tr.y + tm.headerH + tm.rowH*1.5 };
    doublePress(todoSel, itemPoint);
    editor = window.document.querySelector(".inline-editor");
    assert(editor, "double-press on a to-do item row opens the inline editor");
    assert.strictEqual(editor.value, "Polish copy", "row editor starts from the item text");
    editor.value = "Polish microcopy";
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true }));
    assert.strictEqual(todo.items[1].text, "Polish microcopy", "Enter commits the item text");

    doublePress(todoSel, itemPoint);
    editor = window.document.querySelector(".inline-editor");
    editor.value = "Discarded";
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true, cancelable:true }));
    assert.strictEqual(todo.items[1].text, "Polish microcopy", "Escape cancels a row edit");

    doublePress(todoSel, { clientX: tr.x + 12, clientY: tr.y + 5 });
    editor = window.document.querySelector(".inline-editor");
    assert(editor && editor.value === todo.title, "double-press on the header still edits the title");
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true, cancelable:true }));

    const status = T.state.nodes.find(n => n.type === "status");
    T.addCustomStatus("Waiting for review");
    status.statusSide = "right";
    T.render();
    let statusLayout = T.statusNodeLayout(status);
    const statusRect = T.nodeRect(status);
    const statusPoint = {
      clientX:statusRect.x + statusLayout.mainW + statusLayout.bandW/2,
      clientY:statusRect.y + statusRect.h/2
    };
    assert(T.statusBandContainsPoint(status, {x:statusPoint.clientX, y:statusPoint.clientY}),
      "status-band geometry recognizes a point in the visible right-side indicator");
    assert(!T.statusBandContainsPoint(status, {x:statusRect.x + statusLayout.mainW/2, y:statusPoint.clientY}),
      "status-band geometry excludes the node's main text area");
    status.statusSide = "left";
    statusLayout = T.statusNodeLayout(status);
    assert(T.statusBandContainsPoint(status, {x:statusRect.x + statusLayout.bandW/2, y:statusPoint.clientY}),
      "status-band geometry recognizes a left-side indicator");
    status.statusSide = "right";
    statusLayout = T.statusNodeLayout(status);
    T.render();
    doublePress(`[data-node="${status.id}"] [data-status-band-hit]`, statusPoint);
    let statusPicker = window.document.querySelector(".inline-status-picker");
    assert(statusPicker, "double-press on the status band opens an inline status dropdown");
    sameList([...statusPicker.options].map(option => option.value),
      ["Not started", "In progress", "Blocked", "Completed", "Canceled", "Waiting for review"],
      "the inline dropdown includes every built-in and shared custom status");
    assert.strictEqual(statusPicker.value, status.status, "the inline dropdown starts at the current status");
    assert.strictEqual(window.document.activeElement, statusPicker, "the inline dropdown receives focus immediately");
    assert(!window.document.querySelector(".inline-editor"), "the status band does not open the title editor");
    const statusDepth = T.undoDepth;
    statusPicker.value = "Blocked";
    statusPicker.dispatchEvent(new window.Event("change"));
    assert.strictEqual(status.status, "Blocked", "choosing an inline status updates the node");
    assert.strictEqual(T.undoDepth, statusDepth + 1, "an inline status change creates one undo step");
    assert(!window.document.querySelector(".inline-status-picker"), "the inline dropdown closes after a choice");
    assert.strictEqual(window.document.querySelector(`[data-node="${status.id}"] [data-status-band]`).getAttribute("fill"),
      T.statusColor("Blocked"), "the status band redraws with the chosen status color");

    statusLayout = T.statusNodeLayout(status);
    doublePress(`[data-node="${status.id}"] [data-status-surface]`, {
      clientX:statusRect.x + statusLayout.mainW/2,
      clientY:statusRect.y + statusRect.h*.65
    });
    editor = window.document.querySelector(".inline-editor");
    assert(editor && editor.value === status.title,
      "double-press on the status node body still edits its title");
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true, cancelable:true }));

    doublePress(`[data-node="${status.id}"] [data-status-surface]`, {
      clientX:statusRect.x + statusLayout.mainW + statusLayout.bandW/2,
      clientY:statusRect.y + statusRect.h/2
    });
    statusPicker = window.document.querySelector(".inline-status-picker");
    statusPicker.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true, cancelable:true }));
    assert(!window.document.querySelector(".inline-status-picker"), "Escape closes the inline status dropdown");
    assert.strictEqual(status.status, "Blocked", "Escape leaves the current status unchanged");

    doublePress(`[data-todonode="${todo.id}"]`, { clientX: 0, clientY: 0 });
    assert(!window.document.querySelector(".inline-editor"), "double-press on a checkbox never opens an editor");
    assert(!todo.items[0].done, "checkbox double-press toggles twice back to unchecked");

    const nodesBefore = T.state.nodes.length;
    doublePress("[data-bg]", { clientX: 3000, clientY: 3000 });
    assert.strictEqual(T.state.nodes.length, nodesBefore + 1, "double-press on empty canvas still adds a concept");

    press(todoSel, { clientX: tr.x + 12, clientY: tr.y + 5 });
    press(todoSel, { clientX: tr.x + 120, clientY: tr.y + 5 });
    assert(!window.document.querySelector(".inline-editor"), "two presses at different points do not open an editor");
  }

  {
    const { window } = makeDom();
    const fonts = [...window.document.querySelectorAll("svg text")]
      .map(el => el.getAttribute("font-family"))
      .filter(Boolean);
    assert(fonts.length > 0, "render produced SVG text");
    assert(fonts.every(font => font.includes(",")), "every SVG text font-family includes a generic fallback");
  }

  /* SCH-054 — standard flowchart symbols on concept nodes */
  {
    const { window } = makeDom();
    const T = window.__T;
    const concept = T.state.nodes.find(n => n.type === "concept");
    assert.strictEqual(T.conceptShape(concept), "process", "legacy concepts default to the Process shape");
    assert.strictEqual(Object.hasOwn(concept, "shape"), false, "default Process stays absent from legacy document data");
    const defaultSurface = window.document.querySelector(
      `[data-node="${concept.id}"] [data-node-shape="process"]`);
    assert.strictEqual(defaultSurface.localName, "rect", "default Process renders as a rectangle");
    assert.strictEqual(defaultSurface.getAttribute("rx"), "4", "default Process keeps rounded corners");

    T.selectNode(concept.id);
    let selector = window.document.querySelector('#inspector select[aria-label="Flowchart shape"]');
    assert(selector, "concept inspector exposes a flowchart-shape selector");
    assert.strictEqual(selector.value, "process", "inspector starts on the Process shape");
    assert(selector.querySelector('option[value="rectangle"]'),
      "inspector exposes the sharp-corner Rectangle shape");
    const startingTitle = concept.title;
    selector.value = "rectangle";
    selector.dispatchEvent(new window.Event("change"));
    assert.strictEqual(concept.shape, "rectangle", "shape selector writes the additive rectangle shape");
    const rectangleSurface = window.document.querySelector(
      `[data-node="${concept.id}"] [data-node-shape="rectangle"]`);
    assert.strictEqual(rectangleSurface.localName, "rect", "Rectangle renders as an SVG rectangle");
    assert.strictEqual(rectangleSurface.getAttribute("rx"), "0", "Rectangle renders with sharp corners");
    assert.strictEqual(rectangleSurface.getAttribute("stroke-linejoin"), "miter",
      "Rectangle keeps sharp outer stroke corners");
    concept.title = "A long rectangle node title that wraps cleanly across multiple centered lines";
    T.render();
    const rectangleLayout = T.conceptWrappedLayout(concept);
    const rectangleLines = [...window.document.querySelectorAll(
      `[data-node="${concept.id}"] [data-concept-line]`)];
    assert(rectangleLayout.lines.length >= 2, "Rectangle wraps a long title over multiple lines");
    assert.strictEqual(rectangleLines.length, rectangleLayout.lines.length,
      "Rectangle renders every wrapped title line");
    assert.strictEqual(JSON.parse(T.serializeDocument()).nodes.find(n => n.id === concept.id).shape,
      "rectangle", "Rectangle round-trips through document JSON");
    concept.title = startingTitle;
    T.setConceptShape(concept, "process");
    T.render();

    T.selectNode(concept.id);
    selector = window.document.querySelector('#inspector select[aria-label="Flowchart shape"]');
    selector.value = "decision";
    selector.dispatchEvent(new window.Event("change"));
    assert.strictEqual(concept.shape, "decision", "shape selector writes the additive decision shape");
    assert(window.document.querySelector(`[data-node="${concept.id}"] [data-node-shape="decision"]`),
      "decision renders as its own SVG node shape");
    assert(T.nodeRect(concept).h >= 80, "decision uses a tall enough bounding box for readable text");

    const target = T.addNode("concept", concept.x + 450, concept.y + 300);
    const endpoint = T.nodeAnchor(concept, null, T.nodeRect(target));
    assert(endpoint.x < T.nodeRect(concept).x + T.nodeRect(concept).w,
      "automatic decision edge anchors land on the diamond boundary rather than its bounding-box corner");

    T.selectNode(concept.id);
    selector = window.document.querySelector('#inspector select[aria-label="Flowchart shape"]');
    selector.value = "document";
    selector.dispatchEvent(new window.Event("change"));
    assert.strictEqual(concept.shape, "document", "shape selector switches to a document symbol");
    const documentPath = window.document.querySelector(`[data-node="${concept.id}"] [data-node-shape="document"]`);
    assert(documentPath,
      "document renders as its own SVG node shape");
    assert((documentPath.getAttribute("d").match(/ C /g) || []).length >= 2,
      "document uses a pronounced two-crest wavy lower edge");
    assert(window.document.querySelector(`[data-node="${concept.id}"] [data-document-fold]`),
      "document includes a folded corner so it does not read as a plain rectangle");
    const documentHeight = T.nodeRect(concept).h;
    T.setConceptShape(concept, "process");
    assert(documentHeight > T.nodeRect(concept).h,
      "document reserves extra height for its wavy lower silhouette");
    T.setConceptShape(concept, "document");
    T.render();
    for (const { id } of T.FLOWCHART_SHAPES){
      T.setConceptShape(concept, id);
      T.render();
      assert(window.document.querySelector(`[data-node="${concept.id}"] [data-node-shape="${id}"]`),
        `${id} renders as a standard flowchart symbol`);
    }
    sameList(T.FLOWCHART_SHAPES.slice(-3).map(shape => shape.id), ["triangle","circle","square"],
      "triangle, circle, and square are available as concept shapes");
    const originalTitle = concept.title;
    concept.title = "A carefully wrapped label inside the selected shape";
    for (const shape of ["triangle","circle","square"]){
      T.setConceptShape(concept, shape);
      T.render();
      const layout = T.conceptWrappedLayout(concept);
      const rect = T.nodeRect(concept);
      const lines = [...window.document.querySelectorAll(
        `[data-node="${concept.id}"] [data-concept-line]`)];
      assert(layout && layout.lines.length >= 2, `${shape} wraps a long title over multiple lines`);
      assert.strictEqual(lines.length, layout.lines.length, `${shape} renders every wrapped title line`);
      assert(lines.every(line => T.textW(line.textContent, layout.font) <= layout.maxWidth + .01),
        `${shape} keeps each rendered line inside its safe text width`);
      assert.strictEqual(lines.map(line => line.textContent).join(" "), concept.title,
        `${shape} preserves the complete title while wrapping`);
      if (shape === "triangle")
        assert(Math.abs(rect.h / rect.w - .866) < .01, "triangle keeps an equilateral-style aspect ratio");
      else assert.strictEqual(rect.w, rect.h, `${shape} keeps equal width and height`);
      const cornerHit = T.hitTest({x:rect.x + 2, y:rect.y + 2});
      if (shape === "square") assert(cornerHit && cornerHit.node.id === concept.id,
        "square uses its full rectangular hit area");
      else assert.strictEqual(cornerHit, null,
        `${shape} ignores empty bounding-box corners during hit testing`);
    }
    T.setConceptShape(concept, "circle");
    const circleRect = T.nodeRect(concept);
    const circleAnchor = T.nodeAnchor(concept, null, T.nodeRect(target));
    const circleRadius = Math.hypot(
      (circleAnchor.x - circleRect.cx) / (circleRect.w/2),
      (circleAnchor.y - circleRect.cy) / (circleRect.h/2));
    assert(Math.abs(circleRadius - 1) < .001, "circle edge anchors land on the circle boundary");
    T.setConceptShape(concept, "triangle");
    const triangleRect = T.nodeRect(concept);
    const triangleAnchor = T.nodeAnchor(concept, null, T.nodeRect(target));
    const triangleLocalY = triangleAnchor.y - triangleRect.y;
    const triangleHalfWidth = (triangleLocalY / triangleRect.h) * (triangleRect.w/2);
    assert(Math.abs(Math.abs(triangleAnchor.x - triangleRect.cx) - triangleHalfWidth) < .001 ||
           Math.abs(triangleLocalY - triangleRect.h) < .001,
      "triangle edge anchors land on a visible triangle side");
    concept.title = originalTitle;
    T.setConceptShape(concept, "document");
    T.render();
    const saved = JSON.parse(T.serializeDocument());
    assert.strictEqual(saved.nodes.find(n => n.id === concept.id).shape, "document",
      "selected flowchart shapes round-trip through the document JSON");

    T.setConceptShape(concept, "process");
    assert.strictEqual(Object.hasOwn(concept, "shape"), false, "switching back to Process removes the optional shape key");

    T.setSelection("node", concept.id);
    T.nodeMenu(concept, 10, 10);
    assert.strictEqual(window.document.querySelectorAll('#ctxMenu [data-shape-option]').length,
      T.FLOWCHART_SHAPES.length,
      "concept context menu exposes every standard flowchart shape");
    window.document.querySelector('#ctxMenu [data-shape-option="rectangle"]').click();
    assert.strictEqual(concept.shape, "rectangle", "context-menu Rectangle selection updates the concept");
    assert.strictEqual(window.document.getElementById("ctxMenu").style.display, "none",
      "context menu closes after choosing a shape");

    T.setSelection("node", [concept.id, target.id]);
    T.nodeMenu(concept, 10, 10);
    window.document.querySelector('#ctxMenu [data-shape-option="manualInput"]').click();
    assert.strictEqual(concept.shape, "manualInput", "context-menu selection updates the clicked concept");
    assert.strictEqual(target.shape, "manualInput", "context-menu selection updates every selected concept");

    const table = T.state.nodes.find(n => n.type === "table");
    T.nodeMenu(table, 10, 10);
    assert.strictEqual(window.document.querySelectorAll('#ctxMenu [data-shape-option]').length, 0,
      "structural table nodes do not expose concept flowchart shapes");
  }

  /* SCH-105 — node icons, emoji, and subtitles */
  {
    const { window } = makeDom();
    const T = window.__T;
    const concept = T.state.nodes.find(n => n.type === "concept");
    assert.strictEqual(T.nodeIcon(concept), null, "legacy concept nodes start without an icon");
    assert.strictEqual(T.nodeSubtitle(concept), "", "legacy concept nodes start without a subtitle");

    T.selectNode(concept.id);
    let subtitleInput = window.document.getElementById("nodeSubtitleInput");
    let iconSource = window.document.getElementById("nodeIconSource");
    assert(subtitleInput && iconSource, "concept inspector exposes subtitle and icon controls");
    sameList([...iconSource.options].map(option => option.textContent),
      ["No icon","Emoji","Lucide","Font Awesome"],
      "icon source picker offers emoji and two popular offline icon libraries");

    subtitleInput.focus();
    subtitleInput.value = "Supporting detail that wraps independently";
    subtitleInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    subtitleInput.blur();
    assert.strictEqual(concept.subtitle, "Supporting detail that wraps independently",
      "subtitle editor writes optional supporting text");

    iconSource = window.document.getElementById("nodeIconSource");
    iconSource.value = "lucide";
    iconSource.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(concept.icon, "lucide:rocket", "choosing Lucide creates a useful default icon");
    let iconName = window.document.getElementById("nodeIconName");
    assert(iconName && iconName.options.length >= 8, "Lucide picker exposes a curated icon catalog");
    iconName.value = "database";
    iconName.dispatchEvent(new window.Event("change", {bubbles:true}));
    assert.strictEqual(concept.icon, "lucide:database", "library icon choice updates the node");

    let renderedIcon = window.document.querySelector(
      `[data-node="${concept.id}"] [data-node-icon="lucide:database"]`);
    assert(renderedIcon, "Lucide icon renders as part of the node");
    assert(renderedIcon.querySelector('[data-node-vector-icon="lucide"]'),
      "Lucide icon uses embedded SVG vectors rather than a network image");
    const title = window.document.querySelector(`[data-node="${concept.id}"] [data-concept-wrapped]`);
    const subtitle = window.document.querySelector(`[data-node="${concept.id}"] [data-concept-subtitle]`);
    assert(title && subtitle, "node renders separate title and subtitle text elements");
    assert(Number(subtitle.getAttribute("font-size")) < Number(title.getAttribute("font-size")),
      "subtitle uses visibly smaller typography");
    const layout = T.conceptWrappedLayout(concept);
    assert(layout.textX > layout.iconX + layout.decoration.iconSize,
      "card-like nodes reserve a leading component area for the icon");

    T.setNodeIcon(concept, "fa:building");
    T.render();
    renderedIcon = window.document.querySelector(
      `[data-node="${concept.id}"] [data-node-icon="fa:building"]`);
    assert(renderedIcon && renderedIcon.querySelector('[data-node-vector-icon="font-awesome"]'),
      "Font Awesome selection renders from the embedded vector catalog");

    T.setNodeIcon(concept, "emoji:🚀");
    T.render();
    renderedIcon = window.document.querySelector(
      `[data-node="${concept.id}"] [data-node-icon="emoji:🚀"]`);
    assert(renderedIcon && renderedIcon.querySelector("[data-node-emoji]"),
      "arbitrary emoji renders in the same leading icon component");

    const status = T.state.nodes.find(n => n.type === "status");
    T.setNodeSubtitle(status, "Shared rollout state");
    T.setNodeIcon(status, "lucide:workflow");
    T.render();
    assert(window.document.querySelector(
      `[data-node="${status.id}"] [data-node-icon="lucide:workflow"]`),
      "status nodes support the same icon component");
    assert(window.document.querySelector(
      `[data-node="${status.id}"] [data-status-subtitle]`),
      "status nodes render their subtitle separately from the status indicator");

    const parsed = JSON.parse(T.serializeDocument());
    const savedConcept = parsed.nodes.find(n => n.id === concept.id);
    assert.strictEqual(savedConcept.icon, "emoji:🚀", "node icon serializes as an additive token");
    assert.strictEqual(savedConcept.subtitle, "Supporting detail that wraps independently",
      "node subtitle serializes");
    const table = parsed.nodes.find(n => n.type === "table");
    table.icon = "lucide:database";
    table.subtitle = "Unsupported decoration";
    savedConcept.icon = "lucide:not-a-real-icon";
    T.importDocText(JSON.stringify(parsed));
    assert.strictEqual(T.nodeIcon(T.state.nodes.find(n => n.id === concept.id)), null,
      "invalid library icon tokens are discarded safely during import");
    const importedTable = T.state.nodes.find(n => n.id === table.id);
    assert.strictEqual(Object.hasOwn(importedTable, "icon"), false,
      "node types without card decoration discard stray icon data");
    assert.strictEqual(Object.hasOwn(importedTable, "subtitle"), false,
      "node types without card decoration discard stray subtitle data");
  }

  /* SCH-107 — optional Input / Output link ports on concept nodes */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1, nextId:10, nodes:[
      {id:"source", type:"concept", x:80, y:100, title:"Transform", color:"#CFE8FF",
       portsEnabled:true, inputLabel:"Source data", outputLabel:"Result"},
      {id:"target", type:"concept", x:520, y:150, title:"Destination", color:"#D8F3DC",
       portsEnabled:true},
      {id:"legacy", type:"concept", x:300, y:360, title:"Legacy node", color:"#FFE9A8"},
      {id:"tbl", type:"table", x:700, y:360, title:"records", color:"#16232F",
       portsEnabled:true, inputLabel:"bad", outputLabel:"bad", fields:[]}
    ], edges:[
      {id:"flow", from:"source", to:"target", kind:"link", label:"Produces"}
    ]}));

    const source = T.state.nodes.find(n => n.id === "source");
    const target = T.state.nodes.find(n => n.id === "target");
    const legacy = T.state.nodes.find(n => n.id === "legacy");
    const table = T.state.nodes.find(n => n.id === "tbl");
    assert(T.nodePortsEnabled(source) && T.nodePortsEnabled(target),
      "saved concept nodes restore their Input / Output port mode");
    assert.strictEqual(T.nodeInputLabel(source), "Source data", "custom input label restores");
    assert.strictEqual(T.nodeOutputLabel(source), "Result", "custom output label restores");
    assert.strictEqual(T.nodeInputLabel(target), "Input", "input label has a useful implicit default");
    assert.strictEqual(T.nodeOutputLabel(target), "Output", "output label has a useful implicit default");
    assert.strictEqual(T.nodePortsEnabled(table), false, "specialized table nodes reject stray port settings");
    assert.strictEqual(Object.hasOwn(table, "inputLabel"), false,
      "unsupported port captions are removed during import");

    const legacyPeer = {...legacy, id:"legacy-peer", title:"Transform"};
    assert(T.conceptWrappedLayout(source).h > T.conceptWrappedLayout(legacyPeer).h,
      "a card node reserves a distinct row for enabled port labels");
    const sourceGroup = doc.querySelector('[data-node="source"]');
    assert.strictEqual(sourceGroup.querySelector("[data-node-input-label]").textContent, "Source data",
      "input caption renders inside the node");
    assert.strictEqual(sourceGroup.querySelector("[data-node-output-label]").textContent, "Result",
      "output caption renders inside the node");
    assert.strictEqual(sourceGroup.querySelectorAll("[data-node-port]").length, 2,
      "both labeled ports remain visibly connectable");
    assert.strictEqual(doc.querySelector('[data-node="legacy"] [data-node-input-label]'), null,
      "legacy nodes retain their original label-free rendering");

    const sourcePorts = T.nodePortPoints(source);
    const targetPorts = T.nodePortPoints(target);
    const endpoints = T.edgeEndpoints(T.state.edges[0]);
    closeEnough(endpoints.pa.x, sourcePorts.output.x, "outgoing edge starts at the Output port x");
    closeEnough(endpoints.pa.y, sourcePorts.output.y, "outgoing edge starts at the Output port y");
    closeEnough(endpoints.pb.x, targetPorts.input.x, "incoming edge ends at the Input port x");
    closeEnough(endpoints.pb.y, targetPorts.input.y, "incoming edge ends at the Input port y");

    const explicitTop = T.edgeEndpoints({
      id:"explicit", from:"source", to:"target", kind:"link", label:"",
      fromAnchor:"tc", toAnchor:"bc"
    });
    closeEnough(explicitTop.pa.y, T.nodeRect(source).y,
      "an explicit top anchor still overrides the automatic Output port");
    closeEnough(explicitTop.pb.y, T.nodeRect(target).y + T.nodeRect(target).h,
      "an explicit bottom anchor still overrides the automatic Input port");

    T.selectNode(source.id);
    assert(doc.getElementById("nodePortsEnabled"), "concept inspector exposes the port-mode toggle");
    assert(doc.getElementById("nodeInputLabel") && doc.getElementById("nodeOutputLabel"),
      "enabled mode exposes independent Input and Output caption editors");
    const inputEditor = doc.getElementById("nodeInputLabel");
    const outputEditor = doc.getElementById("nodeOutputLabel");
    inputEditor.focus();
    inputEditor.value = "Payload";
    inputEditor.dispatchEvent(new window.Event("input", {bubbles:true}));
    inputEditor.blur();
    assert.strictEqual(doc.getElementById("nodeOutputLabel"), outputEditor,
      "leaving Input does not rebuild the inspector or swallow the next Output edit");
    outputEditor.focus();
    outputEditor.value = "Metrics";
    outputEditor.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(source.inputLabel, "Payload", "input caption edits update the node");
    assert.strictEqual(source.outputLabel, "Metrics", "output caption edits update the node");
    assert.strictEqual(doc.querySelector('[data-node="source"] [data-node-input-label]').textContent, "Payload",
      "edited input caption updates the canvas");
    assert.strictEqual(doc.querySelector('[data-node="source"] [data-node-output-label]').textContent, "Metrics",
      "edited output caption updates the canvas");

    const saved = JSON.parse(T.serializeDocument());
    const savedSource = saved.nodes.find(n => n.id === "source");
    assert.strictEqual(savedSource.portsEnabled, true, "port mode round-trips through document JSON");
    assert.strictEqual(savedSource.inputLabel, "Payload", "custom input caption round-trips");
    assert.strictEqual(savedSource.outputLabel, "Metrics", "custom output caption round-trips");
    const savedTarget = saved.nodes.find(n => n.id === "target");
    assert.strictEqual(Object.hasOwn(savedTarget, "inputLabel"), false,
      "default Input caption remains implicit in saved documents");
    assert.strictEqual(Object.hasOwn(savedTarget, "outputLabel"), false,
      "default Output caption remains implicit in saved documents");
    const exported = T.serializedSvg(true);
    assert(exported.includes("data-node-input-label") && exported.includes("Payload"),
      "SVG export retains the visible port captions");
    assert(!exported.includes("data-node-port"),
      "SVG export removes the interactive port handles");

    T.setConceptShape(source, "circle");
    T.render();
    const circleRect = T.nodeRect(source);
    const circlePorts = T.nodePortPoints(source);
    for (const point of [circlePorts.input, circlePorts.output]){
      const radius = ((point.x-circleRect.cx)/(circleRect.w/2))**2 +
        ((point.y-circleRect.cy)/(circleRect.h/2))**2;
      assert(Math.abs(radius-1) < .001, "port handle stays on the visible circle boundary");
    }

    T.setNodePortsEnabled(source, false);
    T.render();
    assert.strictEqual(T.nodePortsEnabled(source), false, "port mode can be disabled");
    assert.strictEqual(Object.hasOwn(source, "inputLabel"), false,
      "disabling ports removes dormant custom captions");
    assert.strictEqual(doc.querySelector('[data-node="source"] [data-node-input-label]'), null,
      "disabling ports restores the label-free canvas presentation");
  }

  /* SCH-108 — multiple stable, named Input / Output ports */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1, nextId:20, nodes:[
      {id:"source", type:"concept", x:80, y:100, title:"Transform", color:"#CFE8FF",
       portsEnabled:true,
       inputPorts:[{id:"payload", label:"Payload"}, {id:"config", label:"Config"}],
       outputPorts:[{id:"result", label:"Result"}, {id:"audit", label:"Audit"}]},
      {id:"target", type:"concept", x:520, y:120, title:"Destination", color:"#D8F3DC",
       portsEnabled:true,
       inputPorts:[{id:"primary", label:"Primary"}, {id:"fallback", label:"Fallback"}],
       outputPorts:[{id:"accepted", label:"Accepted"}]}
    ], edges:[
      {id:"bound", from:"source", to:"target", kind:"link", label:"Produces",
       fromPort:"audit", toPort:"fallback"}
    ]}));
    T.setView({x:0, y:0, k:1});

    const source = T.state.nodes.find(n => n.id === "source");
    const target = T.state.nodes.find(n => n.id === "target");
    sameList(T.nodeInputPorts(source).map(port => port.label), ["Payload", "Config"],
      "multiple named inputs restore in their saved order");
    sameList(T.nodeOutputPorts(source).map(port => port.label), ["Result", "Audit"],
      "multiple named outputs restore in their saved order");
    const sourcePoints = T.nodePortPoints(source);
    assert.strictEqual(sourcePoints.inputs.length, 2, "each named input gets an attachment point");
    assert.strictEqual(sourcePoints.outputs.length, 2, "each named output gets an attachment point");
    assert.notStrictEqual(sourcePoints.inputs[0].y, sourcePoints.inputs[1].y,
      "input ports occupy distinct rows");
    assert.strictEqual(doc.querySelectorAll('[data-node="source"] [data-node-port]').length, 4,
      "every named port renders a connectable handle");
    sameList([...doc.querySelectorAll('[data-node="source"] [data-node-input-label]')]
      .map(label => label.textContent), ["Payload", "Config"],
      "every input caption renders inside the node");

    const bound = T.state.edges[0];
    const boundEndpoints = T.edgeEndpoints(bound);
    const auditPoint = T.nodePortAnchor(source, "output", "audit");
    const fallbackPoint = T.nodePortAnchor(target, "input", "fallback");
    closeEnough(boundEndpoints.pa.x, auditPoint.x, "saved edge starts at its exact named output x");
    closeEnough(boundEndpoints.pa.y, auditPoint.y, "saved edge starts at its exact named output y");
    closeEnough(boundEndpoints.pb.x, fallbackPoint.x, "saved edge ends at its exact named input x");
    closeEnough(boundEndpoints.pb.y, fallbackPoint.y, "saved edge ends at its exact named input y");

    T.selectNode(source.id);
    const configInput = doc.querySelector('[data-port-input="config"]');
    configInput.focus();
    configInput.value = "Options";
    configInput.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(T.nodePortById(source, "input", "config").label, "Options",
      "each saved port can be renamed independently");
    const addInput = doc.querySelector('[aria-label="Add input"]');
    addInput.click();
    assert.strictEqual(T.nodeInputPorts(source).length, 3, "inspector can append a named input");
    assert(T.nodeInputPorts(source).some(port => port.id === "in1"),
      "new ports receive stable side-specific ids");

    const removeAudit = doc.querySelector('[aria-label="Remove Audit"]');
    removeAudit.click();
    assert.strictEqual(T.nodePortById(source, "output", "audit"), null,
      "inspector can remove one named output");
    assert.strictEqual(Object.hasOwn(bound, "fromPort"), false,
      "removing a bound port safely returns its edge to automatic first-port routing");
    closeEnough(T.edgeEndpoints(bound).pa.y, T.nodePortPoints(source).outputs[0].y,
      "an edge whose port was removed falls back to the first output");

    const resultHandle = doc.querySelector(
      '[data-node="source"] [data-node-port-id="result"]');
    const primaryHandle = doc.querySelector(
      '[data-node="target"] [data-node-port-id="primary"]');
    const resultPoint = T.nodePortAnchor(source, "output", "result");
    const primaryPoint = T.nodePortAnchor(target, "input", "primary");
    const beforeDrag = T.state.edges.length;
    firePointer(window, resultHandle, "pointerdown",
      {clientX:resultPoint.x, clientY:resultPoint.y});
    firePointer(window, doc.getElementById("board"), "pointermove",
      {clientX:primaryPoint.x, clientY:primaryPoint.y});
    firePointer(window, doc.getElementById("board"), "pointerup",
      {clientX:primaryPoint.x, clientY:primaryPoint.y});
    assert.strictEqual(T.state.edges.length, beforeDrag + 1,
      "dragging between two named ports creates a separate edge");
    const dragged = T.state.edges[T.state.edges.length - 1];
    assert.strictEqual(dragged.fromPort, "result", "created edge stores the exact output id");
    assert.strictEqual(dragged.toPort, "primary", "created edge stores the exact input id");

    T.addEdge(
      {id:"target", portId:"fallback", portSide:"input", anchor:"ml"},
      {id:"source", portId:"result", portSide:"output", anchor:"mr"}
    );
    const reverseDragged = T.state.edges[T.state.edges.length - 1];
    assert.strictEqual(reverseDragged.from, "source",
      "dragging Input to Output normalizes the edge's stored direction");
    assert.strictEqual(reverseDragged.to, "target",
      "reverse port drags still point toward the Input node");
    assert.strictEqual(reverseDragged.fromPort, "result",
      "reverse port drags preserve the exact named output");
    assert.strictEqual(reverseDragged.toPort, "fallback",
      "reverse port drags preserve the exact named input");

    const saved = JSON.parse(T.serializeDocument());
    const savedSource = saved.nodes.find(n => n.id === "source");
    assert.strictEqual(savedSource.inputPorts.length, 3, "port arrays round-trip through JSON");
    assert.strictEqual(savedSource.outputPorts.length, 1, "removed ports stay removed in JSON");
    const savedDragged = saved.edges.find(edge => edge.id === dragged.id);
    assert.strictEqual(savedDragged.fromPort, "result", "output binding round-trips through JSON");
    assert.strictEqual(savedDragged.toPort, "primary", "input binding round-trips through JSON");

    savedSource.inputPorts = [
      {id:"duplicate", label:"One"}, {id:"duplicate", label:"Two"}, null
    ];
    savedDragged.fromPort = "missing";
    T.importDocText(JSON.stringify(saved));
    const importedSource = T.state.nodes.find(n => n.id === "source");
    const importedIds = T.nodeInputPorts(importedSource).map(port => port.id);
    assert.strictEqual(new Set(importedIds).size, importedIds.length,
      "duplicate and malformed imported port ids normalize safely");
    assert.strictEqual(Object.hasOwn(T.state.edges.find(edge => edge.id === dragged.id), "fromPort"), false,
      "dangling saved port bindings are removed on import");
  }

  /* ---- SCH-064: custom color schemes in document JSON ---- */
  {
    const { window } = makeDom();
    const T = window.__T;

    assert(T.tableColors().includes("#C20029"), "built-in table palette includes the default red");
    assert(T.tableColors().includes("#007873"), "built-in table palette includes the default teal");
    assert(T.conceptColors().includes("#C20029"), "built-in concept backgrounds include the default red");
    assert(T.conceptColors().includes("#007873"), "built-in concept backgrounds include the default teal");

    // validation: invalid entries drop, hex normalizes, empty schemes collapse to null
    assert.strictEqual(T.normalizeColorScheme(null), null, "absent scheme normalizes to null");
    assert.strictEqual(T.normalizeColorScheme({ concept: ["nope", 42] }), null,
      "scheme with only invalid colors normalizes to null");
    const messy = T.normalizeColorScheme({
      name: "  Ocean  ",
      concept: ["#A1B2C3", "a1b2c3", "not-a-color", "#0FF"],
      frame: "123ABC",
      theme: { light: { paper: "#001122", bogusKey: "#111111" }, dark: "nope" }
    });
    sameList(messy.concept, ["#a1b2c3", "#00ffff"],
      "palette colors normalize, dedupe, and drop invalid entries");
    assert.strictEqual(messy.name, "Ocean", "scheme name is trimmed");
    assert.strictEqual(messy.frame, "#123abc", "single-color overrides normalize");
    assert.strictEqual(messy.theme.light.paper, "#001122", "theme overrides keep known THEME keys");
    assert.strictEqual(Object.hasOwn(messy.theme.light, "bogusKey"), false,
      "theme overrides drop unknown keys");

    const scheme = {
      name: "Ocean",
      concept: ["#113355", "#224466", "#335577"],
      table: ["#014421", "#025533"],
      font: ["#101010", "#fafafa"],
      frame: "#0a3d62",
      todo: "#123321",
      theme: { light: { paper: "#e0f0ff", accent: "#0a3d62", ink: "#012233" } }
    };
    const doc = {
      version: 1, nextId: 2,
      nodes: [{ id: "n1", type: "concept", x: 0, y: 0, title: "Schemed", notes: "" }],
      edges: [],
      meta: { theme: "light", colorScheme: scheme }
    };
    T.importDocText(JSON.stringify(doc), { name: "scheme.schematic.json" });

    sameList(T.conceptColors(), scheme.concept, "loaded scheme replaces the concept palette");
    sameList(T.tableColors(), scheme.table, "loaded scheme replaces the table palette");
    sameList(T.fontColors(), scheme.font, "loaded scheme replaces the font palette");
    assert.strictEqual(T.frameColorDefault(), "#0a3d62", "loaded scheme replaces the frame default");
    assert.strictEqual(T.todoColorDefault(), "#123321", "loaded scheme replaces the to-do default");
    assert.strictEqual(T.themeColors("light").paper, "#e0f0ff", "scheme theme overrides merge into THEME");
    assert.strictEqual(T.themeColors("light").edge, T.THEME.light.edge,
      "unspecified theme keys keep their built-in values");
    assert.strictEqual(T.themeColors("dark").paper, T.THEME.dark.paper,
      "modes without overrides stay untouched");
    assert.strictEqual(window.document.documentElement.style.getPropertyValue("--accent"), "#0a3d62",
      "scheme theme overrides reach the UI chrome CSS variables");

    // colorless nodes render with the scheme default
    const conceptShape = window.document.querySelector('[data-node="n1"] [data-node-shape]');
    assert.strictEqual(conceptShape.getAttribute("fill"), "#113355",
      "concept without explicit color renders with the scheme's first concept color");

    // new nodes draw their defaults from the scheme
    T.addNode("concept", 100, 100);
    assert(scheme.concept.includes(T.state.nodes.at(-1).color), "new concepts cycle scheme concept colors");
    T.addNode("table", 200, 200);
    assert.strictEqual(T.state.nodes.at(-1).color, T.themeColors("light").ink,
      "new tables keep using the (scheme-merged) theme ink");
    T.addNode("todo", 300, 300);
    assert.strictEqual(T.state.nodes.at(-1).color, "#123321", "new to-do lists use the scheme default");
    T.addNode("frame", 400, 400);
    assert.strictEqual(T.state.nodes.at(-1).color, "#0a3d62", "new frames use the scheme default");

    // inspector swatches show scheme colors
    const concept = T.state.nodes.find(n => n.type === "concept" && n.id !== "n1");
    T.selectNode(concept.id);
    const shown = [...window.document.querySelectorAll("#inspector .swatches")[0].children].map(b => b.title);
    sameList(shown, scheme.concept, "inspector color swatches come from the scheme");

    // context menu swatches show scheme colors
    T.nodeMenu(concept, 10, 10);
    const ctxShown = [...window.document.querySelectorAll("#ctxMenu .swrow")[0].children].map(b => b.title);
    sameList(ctxShown, scheme.concept, "context-menu color swatches come from the scheme");

    // scheme swatches never duplicate into the recent-colors row
    sameList(T.pushRecentColor([], "#113355"), [], "scheme palette colors are treated as presets");
    sameList(T.pushRecentColor([], "#ab12cd"), ["#ab12cd"], "non-scheme colors still record as recent");

    // round-trip: the scheme is written back into the document JSON
    const saved = JSON.parse(T.serializeDocument());
    sameList(saved.meta.colorScheme.concept, scheme.concept, "scheme palettes round-trip through save");
    assert.strictEqual(saved.meta.colorScheme.theme.light.paper, "#e0f0ff", "scheme theme round-trips through save");

    // undo across an import restores the previous scheme
    T.pushHistory();
    T.importDocText(JSON.stringify({ version: 1, nextId: 1, nodes: [], edges: [] }),
      { name: "plain.schematic.json", resetHistory: false });
    assert.strictEqual(T.colorScheme, null, "documents without a scheme reset to built-in palettes");
    sameList(T.conceptColors(), ["#FFE9A8","#CFE8FF","#D8F3DC","#F4D8F0","#FFD9C7","#E4E7EC","#007873","#C20029"],
      "built-in concept palette returns once the scheme is gone");
    T.undo();
    assert(T.colorScheme && T.colorScheme.name === "Ocean", "undo restores the imported scheme");

    // New document clears the scheme and the chrome CSS variables
    T.setDocDirty(false);
    T.newDoc();
    assert.strictEqual(T.colorScheme, null, "new documents start without a scheme");
    assert.strictEqual(window.document.documentElement.style.getPropertyValue("--accent"), "",
      "scheme CSS variables are removed with the scheme");
    assert.strictEqual(T.themeColors("light").paper, T.THEME.light.paper, "THEME reverts with the scheme");
    assert.strictEqual(Object.hasOwn(JSON.parse(T.serializeDocument()).meta, "colorScheme"), false,
      "schemeless documents do not write a colorScheme key");
  }

  /* ---- SCH-065/SCH-113: Office-style ribbon + auto-contrast node ink ---- */
  {
    const { window, storage } = makeDom();
    const T = window.__T;
    const doc = window.document;

    // Existing command controls retain stable ids while the ribbon replaces dropdowns.
    for (const id of ["btnNew","btnOpen","btnSave","btnSaveAs","btnExportJSON","btnImportJSON",
                      "btnExportSQL","btnImportDDL","btnExportMermaid","btnExportMarkdown",
                      "btnExportSVG","btnImportCSV","btnExportPNG","btnClear","btnAddConcept","btnAddText","btnAddStatus","btnAddNote",
                      "btnAddTable","btnAddTodo","btnAddFrame","btnAddHorizontalLane",
                      "btnAddVerticalLane","btnUndo","btnRedo","btnFit",
                      "btnLayoutTree","btnLayoutSchema","btnLint","btnSnap","btnCleanup","btnArrangeMenu",
                      "btnAlignTop","btnAlignMiddle","btnAlignBottom","btnAlignLeft","btnAlignCenter","btnAlignRight",
                      "menuSave","menuUndo","menuRedo","menuCut","menuCopy","menuPaste","menuDuplicate","menuDelete",
                      "menuDistributeHorizontal","menuDistributeVertical",
                      "menuResetSize","menuWidthSmallest","menuWidthLargest","menuWidthAverage","menuBringFront","menuSendBack",
                      "btnSelectionMenu","menuFit","menuActualSize","menuZoomIn","menuZoomOut","menuInspector","menuTheme",
                      "btnRibbonToggle","btnCommandPalette","btnShortcuts"])
      assert(doc.getElementById(id), `ribbon control #${id} exists`);

    const tabs = [...doc.querySelectorAll("#appRibbon [role=tab]")];
    sameList(tabs.map(tab => tab.dataset.ribbonTab),
      ["home","insert","arrange","model","view","export","selection"],
      "ribbon exposes task-oriented tabs plus a contextual Selection tab");
    assert.strictEqual(T.activeRibbonTab, "home", "Home ribbon starts active");
    assert.strictEqual(doc.getElementById("ribbonPanelHome").hidden, false,
      "active Home panel is visible");
    assert(doc.getElementById("btnSelectionMenu").hidden,
      "Selection tab stays out of the tab order without a selection");

    const dirtyBefore = T.doc.dirty;
    const undoBefore = T.undoDepth;
    doc.getElementById("ribbonTabExport").click();
    assert.strictEqual(T.activeRibbonTab, "export", "clicking a tab switches the ribbon panel");
    assert.strictEqual(doc.getElementById("ribbonPanelExport").hidden, false,
      "the chosen tab owns the only visible panel");
    assert.strictEqual(T.doc.dirty, dirtyBefore, "switching ribbon tabs does not dirty the document");
    assert.strictEqual(T.undoDepth, undoBefore, "switching ribbon tabs creates no history entry");

    const insertTab = doc.getElementById("ribbonTabInsert");
    insertTab.focus();
    insertTab.dispatchEvent(new window.KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}));
    assert.strictEqual(T.activeRibbonTab, "arrange", "ArrowRight advances across ribbon tabs");
    doc.getElementById("btnArrangeMenu").dispatchEvent(
      new window.KeyboardEvent("keydown", {key:"Home", bubbles:true}));
    assert.strictEqual(T.activeRibbonTab, "home", "Home key activates the first ribbon tab");

    T.setRibbonCollapsed(true);
    assert(doc.getElementById("appHeader").classList.contains("ribbon-collapsed"),
      "ribbon collapses to its tab row");
    assert.strictEqual(storage.getItem("schematic.ribbonCollapsed"), "1",
      "collapsed preference persists locally");
    doc.getElementById("ribbonTabView").click();
    assert(doc.getElementById("appHeader").classList.contains("ribbon-peek"),
      "a collapsed ribbon peeks the chosen panel");
    firePointer(window, doc.getElementById("inspector"), "pointerdown");
    assert(!doc.getElementById("appHeader").classList.contains("ribbon-peek"),
      "outside pointer closes a ribbon peek without changing the preference");
    assert.strictEqual(T.ribbonCollapsed, true, "closing a peek leaves the ribbon collapsed");
    T.setRibbonCollapsed(false);

    const commandIds = T.COMMANDS.map(command => command.id);
    assert.strictEqual(new Set(commandIds).size, commandIds.length,
      "shared command definitions use unique stable ids");
    for (const command of T.COMMANDS){
      assert(command.category && command.icon && command.scope && command.owner,
        `${command.id} exposes category, icon, scope, and owner metadata`);
      assert.strictEqual(typeof command.mutatesDocument, "boolean",
        `${command.id} declares whether it mutates the document`);
      if (command.mutatesDocument)
        assert(command.transaction, `${command.id} declares an undo/history transaction name`);
    }
    assert([...doc.querySelectorAll('[data-command="save"]')].length >= 2,
      "quick access and Home reuse the same Save command");
    assert(doc.querySelector('.ribbon-overflow [data-command="toggleTheme"]'),
      "responsive overflow copies reuse shared commands");
    assert(styles.includes("@media (max-width:1180px)") && styles.includes(".ribbon-low-priority{display:none}"),
      "narrow layouts move low-priority groups into More menus");
    assert(doc.getElementById("btnOpen").title.includes("Ctrl/Cmd+O"),
      "command tooltips include active shortcuts");
    assert(doc.getElementById("btnOpen").hasAttribute("aria-keyshortcuts"),
      "command shortcuts are exposed to assistive technology");

    const unavailableCut = doc.getElementById("menuCut");
    assert.strictEqual(unavailableCut.disabled, false,
      "unavailable commands remain keyboard focusable");
    assert.strictEqual(unavailableCut.getAttribute("aria-disabled"), "true",
      "unavailable commands expose aria-disabled");
    assert(/select at least one node/i.test(unavailableCut.title),
      "unavailable command tooltips explain what is required");
    unavailableCut.focus();
    unavailableCut.click();
    assert(/select at least one node/i.test(doc.getElementById("liveStatus").textContent),
      "invoking an unavailable command announces its disabled reason");

    T.activateRibbonTab("home");
    doc.getElementById("btnNew").focus();
    doc.getElementById("btnNew").dispatchEvent(
      new window.KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}));
    assert.strictEqual(doc.activeElement, doc.getElementById("btnOpen"),
      "ArrowRight moves through commands in the active ribbon group");
    doc.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
    assert.strictEqual(doc.activeElement, doc.getElementById("ribbonTabHome"),
      "Escape returns command focus to the active ribbon tab");

    // Shortcuts and visible controls resolve through the same command handler.
    const countBeforeShortcut = T.state.nodes.length;
    window.dispatchEvent(new window.KeyboardEvent("keydown", {key:"c", bubbles:true}));
    assert.strictEqual(T.state.nodes.length, countBeforeShortcut + 1,
      "the C shortcut executes the registered Add concept command exactly once");
    T.undo();
    doc.getElementById("ribbonTabInsert").click();
    const depthBeforeControl = T.undoDepth;
    doc.getElementById("btnAddConcept").click();
    assert.strictEqual(T.state.nodes.length, countBeforeShortcut + 1,
      "the Insert control executes the same Add concept behavior exactly once");
    assert.strictEqual(T.undoDepth, depthBeforeControl + 1,
      "creating and auto-focusing a node remains one logical undo operation");
    T.undo();
    assert.strictEqual(T.state.nodes.length, countBeforeShortcut,
      "one Undo completely reverses the ribbon creation command");

    // Future domain packs can contribute a command without editing ribbon markup.
    let extensionRuns = 0;
    let extensionEnabled = false;
    T.registerCommand({
      id:"test.inspect",
      label:"Inspect extension",
      description:"Test a contributed Model command",
      category:"model",
      owner:"test-extension",
      scope:"application",
      ribbon:{tab:"model", group:"Extension tools"},
      enabled:() => extensionEnabled,
      action:() => { extensionRuns++; }
    });
    const extensionButton = doc.querySelector('[data-command="test.inspect"]');
    assert(extensionButton && extensionButton.closest('[data-command-contribution-group="Extension tools"]'),
      "registered extensions create their declared ribbon group dynamically");
    assert.strictEqual(extensionButton.getAttribute("aria-disabled"), "true",
      "a contributed ribbon command reflects its initial disabled state");
    extensionEnabled = true;
    T.updateCommandStates();
    assert.strictEqual(extensionButton.getAttribute("aria-disabled"), "false",
      "shared command-state refreshes include dynamically contributed ribbon controls");
    extensionButton.click();
    assert.strictEqual(extensionRuns, 1, "a contributed ribbon command executes once");
    assert.strictEqual(T.unregisterCommandsByOwner("test-extension"), 1,
      "an extension can unregister all of its commands");
    assert(!doc.querySelector('[data-command="test.inspect"]'),
      "unregistering removes the contributed ribbon UI");

    // Shared state propagates to every command surface.
    assert.strictEqual(doc.getElementById("btnSnap").getAttribute("aria-pressed"), "false",
      "snap toggle starts off");
    doc.getElementById("btnSnap").click();
    assert.strictEqual(doc.getElementById("btnSnap").getAttribute("aria-pressed"), "true",
      "clicking snap flips its pressed state");

    // auto-contrast ink
    assert.strictEqual(T.autoInk("#123321"), "#FFFFFF", "dark fills take light ink");
    assert.strictEqual(T.autoInk("#CFE8FF"), "#16232F", "light fills take dark ink");
    T.importDocText(JSON.stringify({ version:1, nextId:1, nodes:[
      { id:"c1", type:"concept", x:0, y:0, title:"Dark", notes:"", color:"#16232F" },
      { id:"t1", type:"todo", x:0, y:200, title:"Dark list", notes:"", color:"#123321", items:[{id:"i1", text:"x"}] },
      { id:"t2", type:"todo", x:0, y:400, title:"Styled", notes:"", color:"#123321", fontColor:"#ABCDEF", items:[{id:"i2", text:"x"}] },
      { id:"tb1", type:"table", x:300, y:0, title:"light_header", notes:"", color:"#CFE8FF",
        fields:[{id:"f1", name:"id", type:"INT", pk:true, fk:false, nullable:false}] }
    ], edges:[] }));
    assert.strictEqual(doc.querySelector('[data-node="c1"] text').getAttribute("fill"), "#FFFFFF",
      "concept titles stay readable on dark fills");
    assert.strictEqual(doc.querySelector('[data-node="t1"] text').getAttribute("fill"), "#FFFFFF",
      "to-do headers stay readable on dark fills");
    assert.strictEqual(doc.querySelector('[data-node="t2"] text').getAttribute("fill"), "#ABCDEF",
      "an explicit fontColor still wins over auto-contrast");
    assert.strictEqual(doc.querySelector('[data-node="tb1"] text').getAttribute("fill"), "#16232F",
      "table headers flip to dark ink on light header colors");
  }

  {
    const { window } = makeDom({storageSeed:{"schematic.ribbonCollapsed":"1"}});
    assert.strictEqual(window.__T.ribbonCollapsed, true,
      "the collapsed ribbon preference restores on reload");
    assert(window.document.getElementById("appHeader").classList.contains("ribbon-collapsed"),
      "restored collapsed state applies before interaction");
    assert.strictEqual(window.document.getElementById("liveStatus").textContent, "",
      "restoring the ribbon preference does not announce an unsolicited startup change");
  }

  /* ---- SCH-093/SCH-113: complete ribbon and contextual command parity ---- */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    const selectionButton = doc.getElementById("btnSelectionMenu");
    const selectionPanel = doc.getElementById("selectionMenuPanel");
    const action = name => selectionPanel.querySelector(`[data-menu-action="${name}"]`);
    const submenu = name => selectionPanel.querySelector(`[data-menu-submenu="${name}"]`);

    assert(selectionButton.disabled && selectionButton.hidden,
      "Selection ribbon tab is unavailable when the canvas selection is empty");
    for (const id of ["btnAddConcept","btnAddText","btnAddStatus","btnAddNote","btnAddTable",
                      "btnAddTodo","btnAddFrame","btnAddHorizontalLane","btnAddVerticalLane"])
      assert(doc.getElementById(id), `Insert ribbon exposes ${id}`);
    for (const id of ["btnLayoutTree","btnLayoutSchema","btnCleanup","btnSnap",
                      "menuFit","menuActualSize","menuZoomIn","menuZoomOut"])
      assert(doc.getElementById(id), `layout and view ribbon tabs expose ${id}`);
    assert(!doc.querySelector("#appRibbon .color-picker, #appRibbon input[type=color]"),
      "ribbon intentionally omits color controls");
    assert(!doc.querySelector('#appRibbon [aria-label="Font size"]'),
      "ribbon intentionally omits font-size controls");

    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);
    assert(!selectionButton.disabled && !selectionButton.hidden,
      "selecting a node reveals the contextual Selection tab");
    T.activateRibbonTab("selection", {focus:true});
    selectionButton.focus();
    T.clearSelection();
    T.render();
    assert.strictEqual(T.activeRibbonTab, "home",
      "removing the selection exits an invalid contextual tab");
    assert.strictEqual(doc.activeElement, doc.getElementById("ribbonTabHome"),
      "contextual-tab removal returns focus to a stable tab");
    T.selectNode(concept.id);
    assert(action("edit-primary") && action("add-linked"), "concept dropdown exposes content commands");
    assert(submenu("selection-shape"), "concept dropdown exposes flowchart shapes");
    for (const shape of T.FLOWCHART_SHAPES.map(option => option.id))
      assert(action("shape-" + shape), `concept dropdown exposes the ${shape} shape`);
    const shapeDepth = T.undoDepth;
    action("shape-decision").click();
    assert.strictEqual(T.conceptShape(concept), "decision", "dropdown shape command changes the node");
    assert.strictEqual(T.undoDepth, shapeDepth + 1, "dropdown shape command creates one undo step");

    const note = T.state.nodes.find(n => n.type === "note");
    T.selectNode(note.id);
    assert(action("edit-note-content") && action("add-linked"),
      "rich-note dropdown exposes content editing and linked-node creation");

    const table = T.state.nodes.find(n => n.type === "table");
    T.selectNode(table.id);
    for (const name of ["add-related-table","toggle-table-collapse","add-field"])
      assert(action(name), `table dropdown exposes ${name}`);

    const todo = T.state.nodes.find(n => n.type === "todo");
    T.selectNode(todo.id);
    assert(action("toggle-list-collapse") && action("add-todo-item"),
      "to-do dropdown exposes collapse and item creation");

    const status = T.state.nodes.find(n => n.type === "status");
    T.addCustomStatus("Awaiting review");
    T.selectNode(status.id);
    for (const label of ["not-started","in-progress","blocked","completed","canceled","awaiting-review"])
      assert(action("status-" + label), `status dropdown exposes ${label}`);
    assert(action("status-side-left") && action("status-side-right"),
      "status dropdown exposes both indicator sides");
    assert(submenu("selection-width").querySelector('[aria-label="Status node width"]'),
      "status dropdown retains node width without exposing font size");

    const textNode = T.state.nodes.find(n => n.type === "text");
    T.selectNode(textNode.id);
    assert(action("shape-none") && action("shape-process"),
      "plain-text dropdown exposes no-box and shaped variants");
    assert(submenu("selection-width").querySelector('[aria-label="Maximum text width"]'),
      "plain-text dropdown exposes wrapping width");

    const lane = T.state.nodes.find(n => n.type === "swimlane");
    T.selectNode(lane.id);
    assert(action("orientation-horizontal") && action("orientation-vertical"),
      "swimlane dropdown exposes both orientations");

    concept.manualWidth = true;
    concept.w = T.nodeRect(concept).w;
    T.setSelection("node", [concept.id, textNode.id]);
    T.render();
    for (const id of ["btnAlignTop","btnAlignMiddle","btnAlignBottom","btnAlignLeft","btnAlignCenter","btnAlignRight",
                      "menuDistributeHorizontal","menuDistributeVertical","menuWidthSmallest","menuWidthLargest","menuWidthAverage"])
      assert.strictEqual(doc.getElementById(id).getAttribute("aria-disabled"), "false",
        `multi-selection enables ${id}`);
    assert.strictEqual(doc.getElementById("menuResetSize").getAttribute("aria-disabled"), "false",
      "forced sizing enables Reset size");
    assert([...doc.querySelectorAll('#arrangeMenu [data-ribbon-group="align"] button')]
      .every(button => button.getAttribute("aria-disabled") === "false"),
      "multi-selection enables the Align ribbon group");

    const edge = T.state.edges.find(e => e.kind !== "link");
    edge.routing = "ortho";
    edge.orthoX = 850;
    T.setSelection("edge", edge.id);
    T.render();
    for (const name of ["edge-kind-link","edge-kind-1-1","edge-kind-1-N","edge-kind-N-M",
                        "edit-edge-label","start-arrow","end-arrow","line-style-solid","line-style-dash",
                        "line-style-dot","routing-curve","routing-ortho","reset-waypoint","swap-edge"])
      assert(action(name), `link dropdown exposes ${name}`);
    assert(submenu("selection-relationship").querySelector('[aria-label="Edge relationship"]'),
      "link dropdown exposes semantic relationship presets and custom text");
    assert(submenu("selection-line").querySelector('[aria-label="Line width"]'),
      "link dropdown exposes line width");
    assert(["menuCut","menuCopy","menuDuplicate"].every(id =>
      doc.getElementById(id).getAttribute("aria-disabled") === "true"),
      "node-only Edit commands disable for a selected link");
    assert.strictEqual(doc.getElementById("menuDelete").getAttribute("aria-disabled"), "false",
      "Delete remains available for a selected link");
    assert(!selectionPanel.querySelector('.color-picker, input[type="color"], [aria-label="Font size"]'),
      "selection-specific ribbon commands omit color and font-size controls for every object");
  }

  /* ---- SCH-066: hide / show the inspector ---- */
  {
    const { window, storage } = makeDom();
    const T = window.__T;
    const doc = window.document;
    const aside = doc.getElementById("inspector");
    const btn = doc.getElementById("btnInspector");

    assert.strictEqual(T.inspectorPinned, true, "inspector starts pinned (visible) by default");
    assert.strictEqual(aside.hidden, false, "pinned inspector is visible without a selection");
    assert.strictEqual(btn.getAttribute("aria-pressed"), "true", "toggle reflects the pinned state");

    btn.click();
    assert.strictEqual(T.inspectorPinned, false, "clicking the toggle unpins the inspector");
    assert.strictEqual(aside.hidden, true, "unpinned inspector hides while nothing is selected");
    assert.strictEqual(storage.getItem("schematic.inspectorPinned"), "0", "preference mirrors to localStorage");

    const node = T.state.nodes[0];
    T.selectNode(node.id);
    assert.strictEqual(aside.hidden, false, "selecting an element reveals the auto-hidden inspector");
    assert(doc.getElementById("titleInput") || doc.getElementById("inspTitle").textContent !== "Inspector",
      "revealed inspector shows the selected element, not the help panel");

    T.clearSelection();
    T.render();
    assert.strictEqual(aside.hidden, true, "clearing the selection hides the inspector again");

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "i", bubbles: true }));
    assert.strictEqual(T.inspectorPinned, true, "the I shortcut re-pins the inspector");
    assert.strictEqual(aside.hidden, false, "re-pinned inspector is visible with no selection");
    assert.strictEqual(storage.getItem("schematic.inspectorPinned"), "1", "re-pinning mirrors to localStorage");
    assert(T.SHORTCUTS.some(s => s.keys === "I" && /inspector/i.test(s.title)),
      "I shortcut is registered in the cheat sheet");
  }

  /* inspector preference survives reload; storage failures degrade gracefully */
  {
    const { window } = makeDom({ storageSeed: {
      "schematic.inspectorPinned": "0", "schematic.inspectorWidth": "412"
    } });
    assert.strictEqual(window.__T.inspectorPinned, false, "stored preference restores an unpinned inspector");
    assert.strictEqual(window.document.getElementById("inspector").hidden, true,
      "restored unpinned inspector starts hidden without a selection");
    assert.strictEqual(window.document.getElementById("inspector").style.getPropertyValue("--inspector-width"), "412px",
      "stored inspector width restores on reload");
  }
  {
    const { window } = makeDom({ storageThrows: true });
    const T = window.__T;
    assert.strictEqual(T.inspectorPinned, true, "throwing localStorage still defaults to a visible inspector");
    assert.strictEqual(window.document.getElementById("inspector").style.getPropertyValue("--inspector-width"), "340px",
      "inspector width defaults safely when storage is unavailable");
    T.toggleInspector();
    assert.strictEqual(T.inspectorPinned, false, "toggling works in-memory without localStorage");
    assert.strictEqual(window.document.getElementById("inspector").hidden, true,
      "in-memory unpinned inspector hides without a selection");
  }

  /* Inspector/context-menu capability characterization before SCH-071 hierarchy redesign. */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    const concept = T.state.nodes.find(n => n.type === "concept");
    T.selectNode(concept.id);
    assert(doc.getElementById("titleInput"), "concept inspector retains title editing");
    assert(doc.querySelector('[aria-label="Flowchart shape"]'), "concept inspector retains shape editing");
    assert(doc.querySelector('[aria-label="Font size"]'), "concept inspector retains text sizing");
    assert(doc.querySelectorAll("#inspBody .swatch").length >= 10, "concept inspector retains fill and text palettes");

    T.nodeMenu(concept, 20, 20);
    let menu = doc.getElementById("ctxMenu");
    assert(menu.querySelector('[data-shape-option="decision"]'), "concept menu retains shape actions");
    assert(menu.querySelector('[aria-label="Font size"]'), "concept menu retains text sizing");
    assert(menu.querySelectorAll(".swatch").length >= 10, "concept menu retains fill and text palettes");
    assert([...menu.querySelectorAll(".ctxitem span")].some(s => s.textContent === "Add linked concept"),
      "concept menu retains linked-node creation");

    const edge = T.state.edges.find(e => e.label === "drives");
    T.setSelection("edge", edge.id);
    T.render();
    assert(doc.getElementById("edgeRelationshipSelect"), "edge inspector retains relationship presets");
    assert(doc.getElementById("edgeLineStyle"), "edge inspector retains line styling");
    assert(doc.getElementById("edgeStartArrow") && doc.getElementById("edgeEndArrow"),
      "edge inspector retains arrow controls");

    T.edgeMenu(edge, 20, 20);
    menu = doc.getElementById("ctxMenu");
    assert(menu.querySelector('[data-edge-relationship]'), "edge menu retains relationship presets");
    assert(menu.querySelector('[data-edge-arrow-toggle="start"]') && menu.querySelector('[data-edge-arrow-toggle="end"]'),
      "edge menu retains arrow controls");
    assert(menu.querySelector('[aria-label="Line style"]') && menu.querySelector('[aria-label="Line width"]'),
      "edge menu retains line style and width controls");
    assert([...menu.querySelectorAll(".ctxitem span")].some(s => s.textContent === "Swap direction"),
      "edge menu retains direction swapping");
  }

  /* SCH-071 — task-grouped inspector and compact context disclosures. */
  {
    const { window } = makeDom();
    const T = window.__T;
    const doc = window.document;
    const concept = T.state.nodes.find(n => n.title === "Tiered rewards");
    T.selectNode(concept.id);
    assert.strictEqual(doc.querySelector("#inspTitle .inspector-kind").textContent, "Concept node",
      "inspector header identifies the selected object type");
    assert.strictEqual(doc.querySelector("#inspTitle .inspector-name").textContent, "Tiered rewards",
      "inspector header identifies the selected object");
    let sections = [...doc.querySelectorAll("#inspBody .inspector-section")];
    sameList(sections.map(s => s.querySelector("summary span").textContent),
      ["Organization","Metadata","Transform & layout","Basics","Link ports","Appearance","Notes"],
      "concept inspector groups controls by task");
    assert(!sections[0].open && !sections[1].open && !sections[2].open && sections[3].open &&
      !sections[4].open && sections[5].open && !sections[6].open,
      "primary inspector sections start open while organization, metadata, transforms, link ports, and notes stay compact");
    const appearance = doc.querySelector('[data-inspector-section="concept:appearance"]');
    appearance.open = false;
    appearance.dispatchEvent(new window.Event("toggle"));
    T.render();
    assert.strictEqual(doc.querySelector('[data-inspector-section="concept:appearance"]').open, false,
      "inspector disclosure state survives committed rerenders");
    assert(doc.querySelector('[data-inspector-section="concept:basics"] #titleInput'),
      "title editing lives in Basics");
    const groupedTitle = doc.getElementById("titleInput");
    groupedTitle.value = "Tier strategy";
    groupedTitle.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert.strictEqual(doc.querySelector("#inspTitle .inspector-name").textContent, "Tier strategy",
      "selected-object header follows live title edits");
    groupedTitle.value = "Tiered rewards";
    groupedTitle.dispatchEvent(new window.Event("input", {bubbles:true}));
    assert(doc.querySelector('[data-inspector-section="concept:notes"] textarea'),
      "notes editing lives in Notes");
    assert(doc.querySelector("#inspBody .inspector-actions"), "node actions use a dedicated sticky footer");
    assert.strictEqual(doc.querySelector("#inspBody .inspector-actions").children.length, 1,
      "node actions share one compact sticky row");
    assert(doc.querySelector('[data-inspector-section="concept:basics"] .frow.compact select'),
      "simple inspector controls render beside their labels");

    const sectionToggle = doc.getElementById("inspectorSectionToggle");
    assert.strictEqual(sectionToggle.hidden, false, "selected objects expose the section navigation control");
    assert.strictEqual(sectionToggle.textContent, "Collapse all", "section navigation describes its next action");
    sectionToggle.click();
    assert([...doc.querySelectorAll("#inspBody .inspector-section")].every(section => !section.open),
      "Collapse all closes every inspector section");
    assert.strictEqual(sectionToggle.textContent, "Expand all", "section navigation follows collapsed state");
    sectionToggle.click();
    assert([...doc.querySelectorAll("#inspBody .inspector-section")].every(section => section.open),
      "Expand all restores every inspector section");

    const resizer = doc.getElementById("inspectorResizer");
    assert.strictEqual(resizer.getAttribute("role"), "separator", "inspector resize handle is accessible");
    resizer.dispatchEvent(new window.KeyboardEvent("keydown", {key:"ArrowLeft", bubbles:true}));
    assert.strictEqual(doc.getElementById("inspector").style.getPropertyValue("--inspector-width"), "356px",
      "keyboard resizing widens the inspector");
    assert.strictEqual(window.localStorage.getItem("schematic.inspectorWidth"), "356",
      "inspector width persists as a UI preference");
    resizer.dispatchEvent(new window.MouseEvent("dblclick", {bubbles:true}));
    assert.strictEqual(doc.getElementById("inspector").style.getPropertyValue("--inspector-width"), "340px",
      "double-click resets the inspector width");

    T.nodeMenu(concept, 20, 20);
    let menu = doc.getElementById("ctxMenu");
    assert.strictEqual(menu.querySelector(".ctxhead strong").textContent, "Tiered rewards",
      "node menu starts with object context");
    sameList([...menu.querySelectorAll(":scope > .ctxgroup > summary span")].map(s => s.textContent),
      ["Content","Discover","Appearance","Arrange","Organization","Metadata","Style transfer","Actions"],
      "node menu groups all actions into task submenus");
    assert([...menu.querySelectorAll(":scope > .ctxgroup")].every(g => !g.open),
      "context disclosures start compact");
    assert(menu.querySelector('[data-ctx-group="node:appearance"] [data-shape-option="decision"]'),
      "collapsed appearance group retains shape capability");
    assert.strictEqual(menu.querySelectorAll(":scope > .ctxitem").length, 0,
      "node menus have no monolithic root-level action list");
    sameList([...menu.querySelectorAll('[data-ctx-group="node:appearance"] > .ctxgroupbody > .ctxsubmenu > summary span')]
      .map(s => s.textContent), ["Fill color","Shape","Text"],
      "dense node appearance controls are divided into nested submenus");
    const nodeContentGroup = menu.querySelector('[data-ctx-group="node:content"]');
    nodeContentGroup.open = true;
    nodeContentGroup.dispatchEvent(new window.Event("toggle"));
    const nodeAppearanceGroup = menu.querySelector('[data-ctx-group="node:appearance"]');
    nodeAppearanceGroup.open = true;
    nodeAppearanceGroup.dispatchEvent(new window.Event("toggle"));
    assert.strictEqual(nodeContentGroup.open, false,
      "opening a node submenu closes its sibling instead of growing a monolithic menu");

    const edge = T.state.edges.find(e => e.label === "drives");
    T.edgeMenu(edge, 20, 20);
    menu = doc.getElementById("ctxMenu");
    sameList([...menu.querySelectorAll(":scope > .ctxgroup > summary span")].map(s => s.textContent),
      ["Relationship","Label","Line","Routing","Discover","Organization","Metadata","Style transfer","Actions"],
      "edge menu groups controls by task");
    assert(menu.querySelector('[data-ctx-group="edge:line"] [aria-label="Line width"]'),
      "edge line disclosure retains line controls");
    assert(menu.querySelector('[data-ctx-group="edge:relationship"] [data-edge-relationship]'),
      "edge relationship disclosure retains presets");
    assert.strictEqual(menu.querySelectorAll(":scope > .ctxitem").length, 0,
      "edge menus have no monolithic root-level action list");
    sameList([...menu.querySelectorAll('[data-ctx-group="edge:line"] > .ctxgroupbody > .ctxsubmenu > summary span')]
      .map(s => s.textContent), ["Arrowheads","Style and width","Color"],
      "dense line controls are divided into nested submenus");
    const edgeLineGroup = menu.querySelector('[data-ctx-group="edge:line"]');
    edgeLineGroup.open = true;
    edgeLineGroup.dispatchEvent(new window.Event("toggle"));
    T.edgeMenu(edge, 20, 20);
    assert(doc.querySelector('[data-ctx-group="edge:line"]').open,
      "context disclosure state survives reopening the menu");

    T.setSelection("edge", edge.id);
    T.render();
    let relationship = doc.getElementById("edgeRelationshipSelect");
    relationship.value = "Supports";
    relationship.dispatchEvent(new window.Event("change", {bubbles:true}));
    const edgeLabelSection = doc.querySelector('[data-inspector-section="edge:label"]');
    edgeLabelSection.open = false;
    edgeLabelSection.dispatchEvent(new window.Event("toggle"));
    relationship = doc.getElementById("edgeRelationshipSelect");
    relationship.value = "__custom__";
    relationship.dispatchEvent(new window.Event("change", {bubbles:true}));
    await delay(10);
    assert(doc.querySelector('[data-inspector-section="edge:label"]').open,
      "custom relationship action reopens its target inspector section");
    assert.strictEqual(doc.activeElement.id, "edgeLabelInput",
      "custom relationship action focuses its revealed label input");

    const board = doc.getElementById("board");
    firePointer(window, board, "contextmenu", {clientX:800, clientY:700});
    menu = doc.getElementById("ctxMenu");
    assert.strictEqual(menu.querySelector(".ctxhead strong").textContent, "Create, arrange, or view",
      "canvas menu explains its scope");
    assert(menu.querySelector('[data-ctx-action="add-note"]'),
      "canvas menu retains all creation actions");

    T.importDocText(JSON.stringify({version:1,nextId:9,edges:[],nodes:[
      {id:"f1",type:"frame",x:0,y:0,title:"Area",color:"#2456E6",w:300,h:200},
      {id:"n1",type:"note",x:20,y:20,title:"Context",content:"Body",color:"#FFE9A8",w:300},
      {id:"d1",type:"todo",x:380,y:20,title:"Tasks",notes:"",color:"#E9E2F8",items:[{id:"i1",text:"One"}]},
      {id:"t1",type:"table",x:380,y:240,title:"records",notes:"",color:"#16232F",
       fields:[{id:"c1",name:"id",type:"INT",pk:true,fk:false,nullable:false}]}
    ]}));
    const expectedSections = {
      f1:["Organization","Metadata","Transform & layout","Basics","Appearance","Size"],
      n1:["Organization","Metadata","Transform & layout","Basics","Content","Appearance"],
      d1:["Organization","Metadata","Transform & layout","Basics","Appearance","Notes","Items"],
      t1:["Organization","Metadata","Transform & layout","Basics","Appearance","Notes","Fields"]
    };
    for (const [id, expected] of Object.entries(expectedSections)){
      T.setSelection("node", id);
      T.render();
      sameList([...doc.querySelectorAll("#inspBody .inspector-section summary span")].map(s => s.textContent), expected,
        `${id} inspector uses the expected task hierarchy`);
      assert(doc.querySelector("#inspBody .inspector-actions"), `${id} inspector retains its action footer`);
    }
    T.setSelection("node", "f1");
    T.render();
    assert.strictEqual(doc.querySelector('[data-inspector-section="frame:size"]').open, false,
      "secondary size controls start compact");
    T.setSelection("node", "n1");
    T.render();
    const noteContentSection = doc.querySelector('[data-inspector-section="note:content"]');
    noteContentSection.open = false;
    noteContentSection.dispatchEvent(new window.Event("toggle"));
    T.nodeMenu(T.state.nodes.find(n => n.id === "n1"), 20, 20);
    const editNote = [...doc.querySelectorAll("#ctxMenu .ctxitem")]
      .find(button => button.textContent.includes("Edit note content"));
    editNote.click();
    await delay(10);
    assert(doc.querySelector('[data-inspector-section="note:content"]').open,
      "direct note edit reopens a collapsed Content section");
    assert.strictEqual(doc.activeElement.id, "noteContentInput",
      "direct note edit focuses the revealed Markdown input");
    const noteBasics = doc.querySelector('[data-inspector-section="note:basics"]');
    noteBasics.open = false;
    noteBasics.dispatchEvent(new window.Event("toggle"));
    T.addNode("note", 720, 420);
    await delay(10);
    assert(doc.querySelector('[data-inspector-section="note:basics"]').open,
      "new-node title focus reopens a collapsed Basics section");
    assert.strictEqual(doc.activeElement.id, "titleInput",
      "new-node creation focuses the revealed title input");
  }

  /* SCH-101 — table titles expose dedicated left/right link anchors */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1, nextId:10, edges:[], nodes:[
      {id:"tbl", type:"table", x:100, y:100, title:"accounts", notes:"", color:"#007873", fields:[
        {id:"acct_id", name:"account_id", type:"INT", pk:true, fk:false, nullable:false},
        {id:"acct_name", name:"name", type:"VARCHAR(255)", pk:false, fk:false, nullable:false}
      ]},
      {id:"idea", type:"concept", x:520, y:100, title:"Account strategy", notes:"", color:"#CFE8FF"}
    ]}));
    T.setView({x:0, y:0, k:1});
    let table = T.state.nodes.find(n => n.id === "tbl");
    const target = T.state.nodes.find(n => n.id === "idea");
    const tableRect = T.nodeRect(table), targetRect = T.nodeRect(target);
    const titleY = T.tableMetrics(table).headerH/2;
    let tableGroup = doc.querySelector('[data-node="tbl"]');
    const titleHandles = [...tableGroup.querySelectorAll("[data-table-title-anchor]")];
    sameList(titleHandles.map(handle => handle.getAttribute("data-anchor")), ["hl","hr"],
      "tables render left and right title anchors");
    assert.strictEqual(Number(titleHandles[0].querySelectorAll("circle")[1].getAttribute("cy")), titleY,
      "the title anchors sit at the vertical center of the table header");
    assert.strictEqual(Number(titleHandles[0].querySelectorAll("circle")[1].getAttribute("cx")), 0,
      "the left title anchor sits on the table's left edge");
    assert.strictEqual(Number(titleHandles[1].querySelectorAll("circle")[1].getAttribute("cx")), tableRect.w,
      "the right title anchor sits on the table's right edge");
    assert.strictEqual(tableGroup.querySelectorAll("[data-fieldhandle]").length, table.fields.length * 2,
      "dedicated title anchors do not replace or duplicate row-bound handles");
    assert.strictEqual(doc.querySelector('[data-node="idea"] [data-table-title-anchor]'), null,
      "non-table nodes do not gain table-title anchors");

    table.collapsed = true;
    T.render();
    tableGroup = doc.querySelector('[data-node="tbl"]');
    assert.strictEqual(tableGroup.querySelectorAll("[data-table-title-anchor]").length, 2,
      "collapsed tables retain both title anchors");
    table.collapsed = false;
    T.render();

    tableGroup = doc.querySelector('[data-node="tbl"]');
    const rightTitleHandle = tableGroup.querySelector('[data-table-title-anchor="hr"]');
    const historyBeforeConnect = T.undoDepth;
    firePointer(window, rightTitleHandle, "pointerdown", {
      clientX:tableRect.x + tableRect.w, clientY:tableRect.y + titleY
    });
    const board = doc.getElementById("board");
    firePointer(window, board, "pointermove", {clientX:targetRect.x, clientY:targetRect.cy});
    firePointer(window, board, "pointerup", {clientX:targetRect.x, clientY:targetRect.cy});
    assert.strictEqual(T.state.edges.length, 1, "dragging a title anchor creates a link");
    let edge = T.state.edges[0];
    assert.strictEqual(edge.fromAnchor, "hr", "the source remains pinned to the right title anchor");
    assert.strictEqual(edge.toAnchor, "ml", "the drop end pins to the target's nearest standard anchor");
    assert(!edge.fromField, "a title-bound link is not misidentified as a field-row binding");
    assert.strictEqual(T.undoDepth, historyBeforeConnect + 1, "creating a title-bound link is one undo step");
    const endpoints = T.edgeEndpoints(edge);
    closeEnough(endpoints.pa.x, tableRect.x + tableRect.w, "title-bound endpoint x");
    closeEnough(endpoints.pa.y, tableRect.y + titleY, "title-bound endpoint y");
    assert([...doc.querySelectorAll("#inspBody select option")].some(option => option.textContent === "Title left") &&
           [...doc.querySelectorAll("#inspBody select option")].some(option => option.textContent === "Title right"),
      "the edge inspector offers both table title anchors");

    const saved = JSON.parse(T.serializeDocument());
    assert.strictEqual(saved.edges[0].fromAnchor, "hr", "table-title bindings persist in document JSON");
    assert(!T.serializedSvg(true).includes("data-table-title-anchor"),
      "SVG export removes table-title editing handles");
    T.undo();
    assert.strictEqual(T.state.edges.length, 0, "undo removes the title-bound link");
    T.redo();
    edge = T.state.edges[0];
    assert.strictEqual(edge.fromAnchor, "hr", "redo restores the title-bound endpoint");

    saved.edges[0].fromAnchor = "mr";
    T.importDocText(JSON.stringify(saved));
    edge = T.state.edges[0];
    assert.strictEqual(edge.fromAnchor, "mr", "legacy whole-node anchor keys remain unchanged");
    assert.strictEqual(T.edgeEndpoints(edge).pa.y, T.nodeRect(T.state.nodes.find(n => n.id === "tbl")).cy,
      "legacy middle-right links keep their historical table midpoint");
  }

  /* SCH-114 / issue #80 — model-backed search, discovery, and safe replacement */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    const query = options => T.querySearchIndex(options).results;
    const by = (text, options = {}) => query({text, ...options});

    const stats = T.refreshSearchIndex(true);
    assert.strictEqual(stats.owners, T.state.nodes.length + T.state.edges.length,
      "the search index owns one atomic record set per node and edge");
    assert(stats.records > stats.owners,
      "each model object contributes its searchable properties rather than one rendered label");

    assert(by("repeat purchase rate").some(result =>
      result.objectLabel === "Repeat purchase rate" && result.property === "Title"),
    "search finds node titles");
    assert(by("hypothesis").some(result =>
      result.objectLabel === "Launch decision" && result.property === "Note content"),
    "search finds rich-note body text");
    assert(by("customer_id", {type:"table", property:"field"}).some(result =>
      result.property === "Field name" && result.fieldId),
    "structured filters find table fields");
    assert(by("approve experiment design", {property:"item"}).some(result =>
      result.objectLabel === "Launch readiness" && result.itemId === "i_release_design"),
    "search finds to-do items");
    assert(by("in progress", {property:"status"}).some(result =>
      result.objectLabel === "Launch approval"),
    "search finds status labels");
    assert(by("events", {property:"port"}).some(result =>
      result.objectLabel === "Measurement plan" && result.portId === "events"),
    "search finds named ports");
    assert(by("triggers", {type:"edge", property:"relationship"}).some(result =>
      result.objectType === "edge" && result.property === "Relationship label"),
    "search finds relationship labels and types");
    assert(by("visual primitives", {type:"frame"}).some(result =>
      result.objectType === "frame"),
    "search finds container titles");
    assert(by("legacy cohort analysis").some(result =>
      result.hidden && result.collapsed && result.collapsedContainerId),
    "collapsed-frame content remains indexed with its reveal context");

    let metadataNode = T.state.nodes.find(node => node.title === "Tiered rewards");
    metadataNode.owner = "Growth Platform";
    metadataNode.tags = ["customer", "priority"];
    metadataNode.customProperties = {risk:"High", reviewed:false, formula:{expression:"x+y"}};
    T.render();
    assert(by("Growth Platform", {property:"metadata", propertyName:"owner"}).length,
      "owner metadata is indexed and filterable by property name");
    assert(by("priority", {property:"metadata"}).length, "tags are indexed");
    assert(by("High", {property:"metadata", propertyName:"customProperties.risk"}).length,
      "user-defined property values are indexed");
    assert(by("x+y", {property:"metadata"}).every(result => result.replaceable === false),
      "formula metadata is discoverable but never plain-text replaceable");
    const metadataEdge = T.state.edges.find(edge => edge.label === "Triggers");
    metadataEdge.owner = "Growth Operations";
    metadataEdge.tags = ["event-driven"];
    metadataEdge.customProperties = {deliveryGuarantee:"at least once"};
    T.render();
    assert(by("Growth Operations", {type:"edge", property:"metadata", propertyName:"owner"}).length,
      "relationship owner metadata is indexed");
    assert(by("event-driven", {type:"edge", property:"metadata"}).length,
      "relationship tags are indexed");
    assert(by("at least once", {
      type:"edge", property:"metadata", propertyName:"customProperties.deliveryGuarantee"
    }).length, "relationship custom properties are indexed");
    metadataNode.description = "Incremental index probe";
    const incrementalStats = T.refreshSearchIndex();
    assert.strictEqual(incrementalStats.changed, 1,
      "one object edit replaces only that owner's indexed records");
    assert(incrementalStats.durationMs < 100,
      `one object index update stays below 100ms (${incrementalStats.durationMs.toFixed(1)}ms)`);

    assert.strictEqual(by("Tiered rewards", {mode:"exact", caseSensitive:true}).length > 0, true,
      "exact case-sensitive matching succeeds for the exact value");
    assert.strictEqual(by("tiered rewards", {mode:"exact", caseSensitive:true}).length, 0,
      "exact case-sensitive matching rejects a different case");
    assert(by("^Tiered\\s+rewards$", {mode:"regex", property:"title"}).length,
      "regular-expression matching works");
    assert(T.querySearchIndex({text:"[", mode:"regex"}).error.startsWith("Invalid regular expression"),
      "invalid regular expressions return a readable error instead of throwing");

    T.setSelection("node", metadataNode.id);
    assert(by("Tiered", {scope:"selection"}).every(result => result.ownerId === metadataNode.id),
      "selection scope excludes unselected owners");
    const strategyFrame = T.state.nodes.find(node => node.title === "Strategy & experiments");
    T.setSelection("node", strategyFrame.id);
    const containerResults = by("Measurement plan", {scope:"container"});
    assert(containerResults.length && containerResults.every(result =>
      result.containers.includes("Strategy & experiments")),
    "container scope searches the selected container and its contents");

    const dynamic = T.addNode("concept", 5000, 5000);
    dynamic.title = "New searchable object";
    dynamic.notes = "incremental needle";
    T.render();
    assert(by("incremental needle").some(result => result.ownerId === dynamic.id),
      "index results update after create and edit without reloading");
    T.setSelection("node", dynamic.id);
    T.deleteSelection();
    assert.strictEqual(by("incremental needle").length, 0,
      "deleted objects disappear from the index");
    T.undo();
    assert(by("incremental needle").some(result => result.ownerId === dynamic.id),
      "undo restores the corresponding index state");
    T.redo();
    assert.strictEqual(by("incremental needle").length, 0,
      "redo restores the deletion in the index");
    metadataNode = T.state.nodes.find(node => node.title === "Tiered rewards");

    window.dispatchEvent(new window.KeyboardEvent("keydown", {
      key:"f", ctrlKey:true, bubbles:true, cancelable:true
    }));
    assert(T.searchPanelOpen(), "Ctrl/Cmd+F opens application search instead of browser page-find");
    const panel = doc.getElementById("searchPanel");
    assert(panel && panel.getAttribute("role") === "dialog" && panel.getAttribute("aria-modal") === "false",
      "the non-modal search panel exposes accessible dialog semantics");
    const searchInput = panel.querySelector("#searchInput");
    searchInput.value = "Legacy cohort analysis";
    panel.querySelector("#searchProperty").value = "title";
    T.runSearch();
    assert.strictEqual(T.searchResults.length, 1, "the panel runs the same structured model query");
    const archivedFrame = T.state.nodes.find(node => node.title === "Archived workstream");
    assert.strictEqual(archivedFrame.collapsed, true, "search preview does not expand content");
    const viewBeforeReveal = {...T.view};
    assert(T.activateSearchResult(0), "activating a collapsed result succeeds after explicit confirmation");
    assert.strictEqual(archivedFrame.collapsed, undefined,
      "confirmed result navigation expands its collapsed frame");
    assert.strictEqual(T.selectionIds("node")[0], T.searchResults[0].ownerId,
      "result navigation selects the matching model object");
    assert.notStrictEqual(JSON.stringify(T.view), JSON.stringify(viewBeforeReveal),
      "result navigation frames the selected object");
    assert(doc.querySelector(".search-hit-active"), "the active canvas result has a non-color-only focus treatment");
    assert(T.searchRestoreNavigation(), "Back restores the previous search location");
    assert.strictEqual(JSON.stringify(T.view), JSON.stringify(viewBeforeReveal),
      "Back restores the exact prior camera state");

    searchInput.value = "Tiered rewards";
    panel.querySelector("#searchProperty").value = "title";
    panel.querySelector("#searchMode").value = "exact";
    panel.querySelector("#searchCase").checked = true;
    T.runSearch();
    panel.querySelector("#searchReplaceInput").value = "Tier benefits";
    const historyBeforeReplace = T.undoDepth;
    T.previewSearchReplace(false);
    assert(panel.querySelector("#searchReplacePreview").hidden === false,
      "find-and-replace renders an immutable before/after preview");
    assert(panel.querySelector(".search-replace-row del").textContent === "Tiered rewards" &&
           panel.querySelector(".search-replace-row ins").textContent === "Tier benefits",
      "replacement preview shows both values");
    assert(T.applySearchReplace(), "compatible previewed replacements apply");
    assert.strictEqual(metadataNode.title, "Tier benefits", "replacement changes the intended text property");
    assert.strictEqual(T.undoDepth, historyBeforeReplace + 1,
      "multi-property replacement is one logical history transaction");
    T.undo();
    metadataNode = T.state.nodes.find(node => node.title === "Tiered rewards");
    assert.strictEqual(metadataNode.title, "Tiered rewards", "one Undo restores the replacement set");

    metadataNode.locked = true;
    T.render();
    searchInput.value = "Tiered rewards";
    T.runSearch();
    panel.querySelector("#searchReplaceInput").value = "Unsafe rename";
    T.previewSearchReplace(false);
    assert(panel.querySelector(".search-replace-row").classList.contains("skipped") &&
           /Locked object/.test(panel.querySelector(".search-replace-row ins").textContent),
      "locked results are visibly excluded from replacement");
    assert.strictEqual(T.applySearchReplace(), false, "locked-only proposals cannot apply");
    assert.strictEqual(metadataNode.title, "Tiered rewards", "locked text remains unchanged");
    metadataNode.locked = false;

    searchInput.value = "Triggers";
    panel.querySelector("#searchType").value = "edge";
    panel.querySelector("#searchProperty").value = "relationship";
    panel.querySelector("#searchMode").value = "exact";
    T.runSearch();
    panel.querySelector("#searchReplaceInput").value = "Starts";
    T.previewSearchReplace(false);
    assert([...panel.querySelectorAll(".search-replace-row")].every(row => row.classList.contains("skipped")),
      "relationship semantics remain searchable but are not plain-text replaced");

    panel.querySelector("#searchType").value = "all";
    panel.querySelector("#searchProperty").value = "all";
    panel.querySelector("#searchMode").value = "partial";
    searchInput.value = "customer_id";
    T.runSearch();
    const selectedResultIds = T.selectAllSearchResults();
    assert(selectedResultIds.length >= 2 && T.selectionIds("node").length === selectedResultIds.length,
      "Select result objects maps table-field matches back to unique canvas nodes");

    const firstCustomer = T.state.nodes.find(node => node.title === "customers");
    const secondCustomer = T.state.nodes.find(node => node.title === "orders");
    secondCustomer.title = "customers";
    T.render();
    const duplicateIds = T.openDuplicateNameSearch();
    assert(duplicateIds.includes(`node:${firstCustomer.id}`) &&
           duplicateIds.includes(`node:${secondCustomer.id}`),
    "duplicate-name discovery creates a filtered object result set");
    T.setSelection("node", firstCustomer.id);
    const directlyConnectedEdges = new Set(T.state.edges
      .filter(edge => edge.from === firstCustomer.id || edge.to === firstCustomer.id)
      .map(edge => edge.id));
    const directlyConnectedNodes = new Set([firstCustomer.id]);
    for (const edge of T.state.edges){
      if (!directlyConnectedEdges.has(edge.id)) continue;
      directlyConnectedNodes.add(edge.from);
      directlyConnectedNodes.add(edge.to);
    }
    assert(T.openConnectedSearch(), "connected-object discovery opens from a selection");
    assert(T.searchResults.some(result => result.ownerKind === "edge") &&
           T.searchResults.some(result => result.ownerKind === "node" && result.ownerId !== firstCustomer.id),
    "connected discovery includes relationships and adjacent nodes");
    assert(T.searchResults.every(result => result.ownerKind === "edge"
      ? directlyConnectedEdges.has(result.ownerId)
      : directlyConnectedNodes.has(result.ownerId)),
    "connected discovery remains one hop and independent of relationship iteration order");
    assert(T.openSelectedReferencesSearch(), "reference discovery opens for one selected object");
    assert(T.searchResults.some(result => result.ownerKind === "edge" &&
      (result.property === "Source object" || result.property === "Target object")),
    "reference discovery finds relationship endpoint references");
    assert(T.searchResults.every(result => result.ownerKind === "edge" &&
      directlyConnectedEdges.has(result.ownerId)),
    "reference discovery excludes unrelated objects that merely share the selected title");
    assert(by(firstCustomer.id, {type:"edge", property:"id"}).some(result =>
      result.property === "Source object ID" || result.property === "Target object ID"),
    "relationship endpoint IDs keep untitled objects reference-discoverable");

    const selectionBeforeClose = T.selectionIds("node");
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", {
      key:"Escape", bubbles:true, cancelable:true
    }));
    assert.strictEqual(T.searchPanelOpen(), false, "Escape closes the search panel");
    assert.deepStrictEqual(T.selectionIds("node"), selectionBeforeClose,
      "closing search with Escape preserves the result selection");
  }

  /* SCH-117 / issue #83 — editing fundamentals: geometry, transforms, and style transfer. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1,nextId:30,nodes:[
      {id:"text-a",type:"text",x:40,y:40,title:"A long title that must continue to wrap without losing any source text",
       color:"#CFE8FF",fontColor:"#16232F",fontSize:18,shape:"rectangle",
       manualWidth:true,w:280,manualHeight:true,h:80,properties:{risk:"high"}},
      {id:"text-b",type:"text",x:380,y:40,title:"Second wrapped title",color:"#FFE9A8",
       fontSize:14,manualWidth:true,w:180,manualHeight:true,h:120},
      {id:"locked-frame",type:"frame",x:900,y:700,title:"Locked reference",color:"#DDE6EF",w:260,h:180,locked:true},
      {id:"ports",type:"concept",x:80,y:300,title:"Port-aware transform",subtitle:"Readable subtitle",
       icon:"emoji:⚙️",color:"#007873",fontColor:"#FFFFFF",fontSize:17,shape:"process",
       manualWidth:true,w:260,manualHeight:true,h:150,portsEnabled:true,
       inputPorts:[{id:"events",label:"Events"},{id:"policy",label:"Policy"}],
       outputPorts:[{id:"result",label:"Result"}]},
      {id:"sink",type:"concept",x:520,y:320,title:"Sink",notes:"",color:"#CFE8FF"},
      {id:"status",type:"status",x:80,y:520,title:"A very long status title that remains intact",
       subtitle:"Secondary status explanation",status:"Blocked",statusSide:"right",
       color:"#FFE9A8",fontSize:18,manualWidth:true,w:250,manualHeight:true,h:60},
      {id:"note",type:"note",x:420,y:520,title:"Evidence",content:"# Heading\\n\\nParagraph one\\n\\n- item one\\n- item two",
       color:"#FFE9A8",fontSize:13,manualWidth:true,w:240,manualHeight:true,h:70}
    ],edges:[
      {id:"port-edge",from:"ports",to:"sink",fromPort:"result",kind:"link",label:"Produces"},
      {id:"default-edge",from:"text-a",to:"sink",kind:"link",label:""},
      {id:"styled-edge",from:"text-b",to:"sink",kind:"link",label:"Styled",
       lineColor:"#C20029",lineWidth:5,lineStyle:"dot",startArrow:true,endArrow:true,
       labelTextColor:"#FFFFFF",labelBackgroundColor:"#16232F"}
    ]}));
    T.invalidateOrganizationEvaluation();

    T.setSelection("node",["text-a","text-b","locked-frame"]);
    const beforeHeightUndo = T.undoDepth;
    const frameBefore = {...T.nodeVisualRect(T.state.nodes.find(node => node.id === "locked-frame"))};
    assert(T.executeCommand("heightAverage"),
      "mixed selections apply height matching to the unlocked compatible subset");
    assert.strictEqual(T.undoDepth,beforeHeightUndo+1,
      "height matching creates exactly one history entry");
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-a").h,100,
      "average height uses immutable pre-operation measurements and documented rounding");
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-b").h,100,
      "average height applies the same target to every compatible object");
    sameList(T.nodeVisualRect(T.state.nodes.find(node => node.id === "locked-frame")),frameBefore,
      "locked unsupported objects remain untouched");
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-a").title,
      "A long title that must continue to wrap without losing any source text",
      "geometry operations never truncate source text");
    T.undo();
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-a").h,80,
      "one undo restores every matched height");
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-b").h,120,
      "one undo restores the complete mixed selection");
    T.redo();

    T.setSelection("node",["text-a","text-b"]);
    const beforeSizeUndo = T.undoDepth;
    const sizeResult = T.matchSelectionSizes("average");
    sameList(sizeResult,{width:230,height:100,changed:["text-a","text-b"],skipped:[]},
      "complete-size matching reports its deterministic target and affected IDs");
    assert.strictEqual(T.undoDepth,beforeSizeUndo+1,
      "full-size matching is one transaction");
    assert(T.textBoxLayout(T.state.nodes.find(node => node.id === "text-a")).lines.length > 1,
      "narrower matched text boxes immediately reflow");
    T.undo();
    T.setSelection("node",["text-a","text-b"]);
    const beforeResetUndo = T.undoDepth;
    assert.strictEqual(T.executeCommand("resetSize"),2,
      "reset size clears forced width and height for every unlocked target");
    assert.strictEqual(T.undoDepth,beforeResetUndo+1,
      "resetting both dimensions creates one history entry");
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-a").manualWidth,undefined,
      "reset width returns text to content-driven sizing");
    assert.strictEqual(T.state.nodes.find(node => node.id === "text-a").manualHeight,undefined,
      "reset height returns text to content-driven sizing");
    T.undo();

    let ports = T.state.nodes.find(node => node.id === "ports");
    const edge = T.state.edges.find(candidate => candidate.id === "port-edge");
    const endpointBefore = T.edgeEndpoints(edge).pa;
    T.setSelection("node",ports.id);
    const beforeRotateUndo = T.undoDepth;
    assert(T.executeCommand("rotateRight"),"rotation executes through the shared command registry");
    assert.strictEqual(T.undoDepth,beforeRotateUndo+1,"rotation is one undoable operation");
    ports = T.state.nodes.find(node => node.id === "ports");
    assert.strictEqual(T.nodeRotation(ports),90,"rotation persists in normalized document degrees");
    const visual = T.nodeVisualRect(ports), local = T.nodeRect(ports);
    closeEnough(visual.w,local.h,"90-degree rotation swaps the visual width");
    closeEnough(visual.h,local.w,"90-degree rotation swaps the visual height");
    const endpointAfter = T.edgeEndpoints(edge).pa;
    assert(Math.hypot(endpointAfter.x-endpointBefore.x,endpointAfter.y-endpointBefore.y) > 20,
      "attached named-port endpoints follow the transformed boundary");
    assert(doc.querySelector('[data-node="ports"]').getAttribute("transform").includes("rotate(90"),
      "the rendered node carries the persisted transform");
    T.undo();
    assert.strictEqual(T.nodeRotation(T.state.nodes.find(node => node.id === "ports")),0,
      "one undo removes the rotation");
    T.redo();
    T.setSelection("node","ports");
    const beforeFlipUndo = T.undoDepth;
    assert(T.executeCommand("flipHorizontal"),"horizontal flip executes on a supported node");
    assert.strictEqual(T.undoDepth,beforeFlipUndo+1,"flip creates one history entry");
    ports = T.state.nodes.find(node => node.id === "ports");
    assert.strictEqual(T.nodeFlipX(ports),true,"horizontal flip persists");
    const renderedPorts = doc.querySelector('[data-node="ports"]');
    assert(renderedPorts.querySelector("[data-concept-wrapped]").getAttribute("transform").includes("scale(-1,1)"),
      "flipped text is counter-transformed instead of mirrored");
    assert(renderedPorts.querySelector("[data-node-icon]").getAttribute("transform").includes("scale(-1,1)"),
      "icons that should remain upright are counter-transformed");
    const transformedOutput = T.nodePortAnchor(ports,"output","result");
    assert.strictEqual(transformedOutput.side,"n",
      "flipping updates named-port side semantics after rotation");
    const serializedTransform = T.serializeDocument();
    T.importDocText(serializedTransform);
    ports = T.state.nodes.find(node => node.id === "ports");
    assert.strictEqual(T.nodeRotation(ports),90,"rotation survives save and reload");
    assert.strictEqual(T.nodeFlipX(ports),true,"flip survives save and reload");
    assert.strictEqual(T.state.edges.find(candidate => candidate.id === "port-edge").fromPort,"result",
      "save and reload preserve the stable named-port binding");

    const status = T.state.nodes.find(node => node.id === "status");
    const statusLayout = T.statusNodeLayout(status);
    assert(statusLayout.manualHeight && statusLayout.h === 60,
      "status nodes honor forced heights");
    assert.strictEqual(status.title,"A very long status title that remains intact",
      "forced status height never mutates source text");
    const note = T.state.nodes.find(node => node.id === "note");
    assert(T.richNoteLayout(note).lines.length < 6,
      "forced rich-note height bounds rendered content");
    assert(note.content.includes("item two"),"rich-note truncation is display-only");
    const compactConcept = {...ports,manualHeight:true,h:70,
      title:"A long transformed concept title that needs display truncation"};
    assert(T.conceptWrappedLayout(compactConcept).manualHeight,
      "concept nodes participate in exact height sizing");
    assert.strictEqual(compactConcept.title,
      "A long transformed concept title that needs display truncation",
      "concept height fitting preserves the complete source title");

    const source = T.state.nodes.find(node => node.id === "text-a");
    const target = T.state.nodes.find(node => node.id === "text-b");
    source.color = "#007873";
    source.fontColor = "#FFFFFF";
    source.shape = "rectangle";
    source.icon = "emoji:⭐";
    target.title = "Semantic content";
    target.properties = {owner:"team"};
    target.icon = "emoji:📌";
    const targetX = target.x;
    const targetSize = {...T.nodeSize(target)};
    T.setSelection("node",source.id);
    const payload = T.editingCopyStyle();
    assert(payload.entries.every(entry => ["direct","default"].includes(entry.origin)),
      "copy style creates a typed payload with source provenance");
    assert(payload.excluded.includes("metadata") && payload.excluded.includes("geometry"),
      "the style payload declares protected semantic and geometry scopes");
    T.setSelection("node",target.id);
    const beforePasteUndo = T.undoDepth;
    const paste = T.editingPasteStyle();
    sameList(paste.changed,[target.id],"paste style reports the changed target");
    assert.strictEqual(T.undoDepth,beforePasteUndo+1,"paste style is one transaction");
    assert.strictEqual(target.color,"#007873","compatible fill transfers");
    assert.strictEqual(target.fontColor,"#FFFFFF","compatible text appearance transfers");
    assert.strictEqual(target.shape,"rectangle","same-type shape treatment transfers");
    assert.strictEqual(target.title,"Semantic content","style transfer preserves content");
    sameList(target.properties,{owner:"team"},"style transfer preserves custom metadata");
    assert.strictEqual(target.x,targetX,"style transfer preserves geometry");
    sameList(T.nodeSize(target),targetSize,
      "style transfer preserves the target's resolved width and height");
    assert.strictEqual(target.icon,"emoji:📌","style transfer excludes icon identity");
    T.undo();
    assert.notStrictEqual(T.state.nodes.find(node => node.id === target.id).color,"#007873",
      "one undo restores the complete style target");

    const conceptSource = T.state.nodes.find(node => node.id === "ports");
    const conceptTarget = T.state.nodes.find(node => node.id === "sink");
    const autoSizeBeforeStyle = {...T.nodeSize(conceptTarget)};
    T.setSelection("node",conceptSource.id);
    T.editingCopyStyle();
    T.setSelection("node",conceptTarget.id);
    T.editingPasteStyle();
    sameList(T.nodeSize(conceptTarget),autoSizeBeforeStyle,
      "shape and font transfer materialize the target's resolved size instead of resizing it");
    assert.strictEqual(conceptTarget.title,"Sink",
      "auto-sized style targets retain their content");
    assert.strictEqual(conceptTarget.icon,undefined,
      "auto-sized style targets still exclude icon identity");
    T.undo();

    const defaultEdge = T.state.edges.find(candidate => candidate.id === "default-edge");
    const styledEdge = T.state.edges.find(candidate => candidate.id === "styled-edge");
    const inheritedPayload = T.editingStylePayload(defaultEdge);
    assert(inheritedPayload.entries.some(entry => entry.field === "lineColor" &&
      entry.origin === "default" && entry.operation === "clear"),
    "derived defaults remain provenance-aware instead of becoming silent local overrides");
    const edgePlan = T.editingStylePlan(inheritedPayload,[styledEdge]);
    assert.strictEqual(edgePlan.plan.length,1,"edge style compatibility is planned before mutation");
    T.editingApplyStylePayload(inheritedPayload,[styledEdge]);
    assert.strictEqual(styledEdge.lineColor,undefined,
      "pasting a derived line color clears the target override");
    assert.strictEqual(styledEdge.startArrow,undefined,
      "pasting a derived false arrow state clears the target override");
    assert.strictEqual(styledEdge.labelTextColor,undefined,
      "derived label appearance remains inherited");
  }

  /* SCH-117 / issue #83 — selection, precision, shortcuts, and safe layout preview. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({version:1,nextId:40,nodes:[
      {id:"frame",type:"frame",x:0,y:0,title:"Delivery frame",color:"#DDE6EF",w:520,h:360},
      {id:"a",type:"concept",x:40,y:60,title:"A",status:"Blocked",color:"#C20029"},
      {id:"b",type:"concept",x:220,y:60,title:"B",status:"In progress",color:"#007873",pinned:true},
      {id:"c",type:"concept",x:380,y:230,title:"C",status:"Completed",color:"#CFE8FF"},
      {id:"outside",type:"concept",x:700,y:80,title:"Outside",status:"Blocked",color:"#C20029"},
      {id:"hidden",type:"concept",x:60,y:220,title:"Hidden",status:"Blocked",color:"#C20029",hidden:true},
      {id:"locked",type:"concept",x:700,y:260,title:"Locked",status:"Blocked",color:"#C20029",locked:true}
    ],edges:[
      {id:"ab",from:"a",to:"b",kind:"link",label:"Depends on"},
      {id:"bc",from:"b",to:"c",kind:"link",label:"Supports"},
      {id:"co",from:"c",to:"outside",kind:"link",label:"Depends on"}
    ]}));
    T.invalidateOrganizationEvaluation();
    const aRect = T.nodeVisualRect(T.state.nodes.find(node => node.id === "a"));
    const partial = {x:aRect.x+aRect.w/2,y:aRect.y,w:aRect.w,h:aRect.h};
    assert(!T.editingSpatialSelectionIds("contain",partial).includes("a"),
      "full-containment marquee excludes a partially overlapped object");
    assert(T.editingSpatialSelectionIds("intersect",partial).includes("a"),
      "intersection marquee includes the same partial overlap");
    const lasso = [
      {x:aRect.cx-20,y:aRect.cy-20},{x:aRect.cx+20,y:aRect.cy-20},
      {x:aRect.cx+20,y:aRect.cy+20},{x:aRect.cx-20,y:aRect.cy+20}
    ];
    assert(T.editingSpatialSelectionIds("lasso",aRect,lasso).includes("a"),
      "freeform lasso selects by model geometry");
    assert(!T.editingSpatialSelectionIds("contain",{x:0,y:0,w:1000,h:500}).includes("hidden"),
      "spatial selection excludes hidden objects");
    T.setSelection("node","a");
    sameList(T.editingApplyNodeSelection(["b"],"add"),["a","b"],
      "add selection preserves existing IDs");
    sameList(T.editingApplyNodeSelection(["a"],"subtract"),["b"],
      "subtract selection removes matching IDs");
    sameList(T.editingApplyNodeSelection(["b","c"],"toggle"),["c"],
      "toggle selection behaves consistently");
    assert.strictEqual(T.editingSelectionOperation({shiftKey:true,altKey:true}),"subtract",
      "Shift+Alt is the documented subtract modifier");
    assert.strictEqual(T.editingSelectionOperation({ctrlKey:true}),"toggle",
      "Ctrl/Cmd is the documented toggle modifier");
    T.setEditingSelectionMode("lasso");
    assert.strictEqual(T.editingSelectionMode,"lasso","the active gesture is explicit");
    assert.strictEqual(window.localStorage.getItem("schematic.selectionGesture"),"lasso",
      "selection gesture is an application preference");

    sameList(T.editingSelectByQuery({scope:"visible",propertyId:"status",value:"blocked",
      render:false,announce:false}),["a","locked","outside"],
      "select-by status uses visible model scope and stable-ID ordering");
    T.setSelection("node","frame");
    sameList(T.editingSelectByQuery({scope:"container",objectType:"concept",
      render:false,announce:false}),["a","b","c"],
      "container scope selects visible contents without scanning SVG");
    sameList(T.editingSelectByQuery({scope:"all",propertyId:"frame",value:"delivery",
      render:false,announce:false}),["a","b","c","hidden"],
      "frame queries can deliberately include hidden contents in entire-document scope");
    T.setSelection("node","a");
    sameList(T.editingSelectByQuery({scope:"visible",connectivity:"successors",depth:2,
      relationshipTypes:["link"],render:false,announce:false}),["b","c"],
      "connectivity queries support direction, depth, and relationship filtering");
    T.setSelection("node","b");
    sameList(T.editingConnectivityNodes("predecessors"),["a"],
      "direct predecessor selection reuses the structured graph query");
    sameList(T.editingSelectAttachedLinks(),["ab","bc"],
      "attached-link selection includes every incident relationship");

    const gridUndo = T.undoDepth;
    assert(T.setEditingGridSize(32),"grid size is document configurable");
    assert.strictEqual(T.undoDepth,gridUndo+1,"grid-size change is undoable");
    const vertical = T.editingAddGuide("x",100,{name:"Locked axis",locked:true});
    const horizontal = T.editingAddGuide("y",208,{name:"Hidden axis"});
    T.editingUpdateGuide(horizontal.id,{hidden:true});
    assert.strictEqual(T.editingGuides().length,1,"hidden guides are excluded from snapping");
    assert.strictEqual(T.editingGuides(true).length,2,"guide manager retains hidden guides");
    const serializedPrecision = JSON.parse(T.serializeDocument());
    assert.strictEqual(serializedPrecision.editing.gridSize,32,
      "grid size serializes as document state");
    assert(serializedPrecision.editing.guides.some(guide => guide.id === vertical.id &&
      guide.locked === true && guide.name === "Locked axis"),
    "manual guide identity, coordinate, lock, and name serialize");
    assert(!T.serializedSvg(true).includes("data-manual-guide"),
      "print/export SVG excludes manual guides");
    T.importDocText(JSON.stringify(serializedPrecision));
    assert.strictEqual(doc.querySelector("#dots").getAttribute("width"),"32",
      "document reload applies the persisted grid size to the live SVG pattern");
    assert.strictEqual(doc.querySelectorAll("[data-manual-guide]").length,1,
      "document reload redraws visible persisted manual guides");
    assert.strictEqual(T.editingGuides(true).length,2,
      "document reload retains hidden guides in the model");

    doc.getElementById("btnSnap").click();
    const snap = T.editingResolveNodeSnap(
      {x:97,y:51,w:40,h:40,cx:117,cy:71},{x:97,y:51},
      [{x:104,y:50,w:40,h:40,cx:124,cy:70}],10,{shiftKey:false});
    assert.strictEqual(snap.xSource.strength,"locked",
      "locked manual guides outrank smart alignment and persistent grid on their axis");
    assert.strictEqual(snap.xSource.label,"Locked axis",
      "snap feedback names the winning guide");
    assert.strictEqual(snap.ySource.type,"alignment",
      "the other axis may independently choose a smart alignment");
    const explicit = T.editingResolveNodeSnap(
      {x:97,y:51,w:40,h:40,cx:117,cy:71},{x:97,y:51},[],10,{shiftKey:true});
    sameList({dx:explicit.dx,dy:explicit.dy},{dx:-1,dy:13},
      "Shift uses the configured 32-pixel grid before every other constraint");
    assert.strictEqual(explicit.xSource.strength,"explicit",
      "explicit modifier snapping identifies its source");
    const ortho = T.editingSnapOrthoPoint({x:23,y:39},10,true);
    sameList({x:ortho.x,y:ortho.y,step:ortho.gridStep},{x:16,y:32,step:16},
      "orthogonal link corners snap at half-grid resolution");

    const movable = T.state.nodes.find(node => node.id === "outside");
    movable.x = 713; movable.y = 87;
    T.setSelection("node",["outside","locked"]);
    const beforeSnapUndo = T.undoDepth;
    const snappedSelection = T.executeCommand("snapSelectionGrid");
    sameList(snappedSelection.changed,["outside"],
      "snap-selection skips locked objects and reports the changed IDs");
    assert.strictEqual(movable.x,704,"snap-selection uses the configured grid in document coordinates");
    assert.strictEqual(T.undoDepth,beforeSnapUndo+1,"snap-selection creates one undo entry");
    T.undo();
    assert.strictEqual(T.state.nodes.find(node => node.id === "outside").x,713,
      "one undo restores every snapped coordinate");

    assert.strictEqual(T.editingSetShortcut("rotateRight","Alt+Shift+R").ok,true,
      "shortcut preferences accept an unused chord");
    assert.strictEqual(T.editingSetShortcut("rotateLeft","Mod+Y").ok,false,
      "shortcut conflict detection includes built-in aliases");
    assert.strictEqual(T.editingSetShortcut("rotateLeft","Mod+L").ok,false,
      "reserved browser shortcuts are protected");
    T.setSelection("node","a");
    window.dispatchEvent(new window.KeyboardEvent("keydown",
      {key:"r",altKey:true,shiftKey:true,bubbles:true,cancelable:true}));
    assert.strictEqual(T.nodeRotation(T.state.nodes.find(node => node.id === "a")),90,
      "a customized shortcut invokes the same shared command");
    const importedShortcuts = T.editingImportShortcutOverrides({shortcuts:{
      rotateLeft:"Alt+Shift+U",rotateRight:"Alt+Shift+U",fit:"Mod+L"
    }});
    sameList(importedShortcuts,{ok:true,applied:1,skipped:2},
      "shortcut import applies only conflict-free, non-reserved assignments");
    assert(!JSON.parse(T.serializeDocument()).shortcuts,
      "shortcut preferences never enter document state");
    T.editingResetShortcut("rotateLeft");
    assert.strictEqual(T.editingShortcutForCommand(T.commandDefinition("rotateLeft")),
      T.commandDefinition("rotateLeft").shortcut,
      "per-command reset restores the default chord");
    T.editingResetAllShortcuts();
    assert.strictEqual(window.localStorage.getItem("schematic.shortcutOverrides"),"{}",
      "global reset restores every default");

    const a = T.state.nodes.find(node => node.id === "a");
    const b = T.state.nodes.find(node => node.id === "b");
    const c = T.state.nodes.find(node => node.id === "c");
    T.setSelection("node",["a","b","c"]);
    T.setView({x:73,y:-41,k:.75});
    const beforePreviewDoc = T.serializeDocument();
    const beforePreviewSelection = T.selection;
    const beforePreviewView = {...T.view};
    const beforePreviewUndo = T.undoDepth;
    assert(T.executeCommand("layoutPreview"),"layout preview opens through the command registry");
    assert(T.editingLayoutProposal,"layout preview records a transient proposal");
    assert.strictEqual(T.serializeDocument(),beforePreviewDoc,
      "creating a preview does not mutate serialized document state");
    assert.strictEqual(T.undoDepth,beforePreviewUndo,
      "creating a preview does not create history");
    assert(!T.editingLayoutProposal.positions.has("b"),
      "pinned objects are excluded from proposed movement");
    T.editingCancelLayoutPreview();
    sameList(T.selection,beforePreviewSelection,
      "cancel restores the exact original selection");
    sameList(T.view,beforePreviewView,"cancel restores the exact camera");
    assert.strictEqual(T.serializeDocument(),beforePreviewDoc,
      "cancel is byte-equivalent at the document boundary");

    assert(T.executeCommand("layoutPreview"),"a layout proposal can be recomputed");
    const maxMovement = doc.querySelector('.layout-preview-modal input[title*="unrestricted"]');
    maxMovement.value = "20";
    maxMovement.dispatchEvent(new window.Event("input",{bubbles:true}));
    assert(T.editingLayoutProposal.movement.maximum <= 20.001,
      "maximum-movement constraints are applied to the transient proposal");
    const bPosition = {x:b.x,y:b.y};
    const aPosition = {x:a.x,y:a.y};
    const beforeApplyUndo = T.undoDepth;
    assert(T.editingApplyLayoutPreview(),"a current proposal applies");
    assert.strictEqual(T.undoDepth,beforeApplyUndo+1,
      "layout Apply produces one history transaction");
    sameList({x:b.x,y:b.y},bPosition,"pinned geometry remains fixed on Apply");
    T.undo();
    sameList({x:T.state.nodes.find(node => node.id === "a").x,
      y:T.state.nodes.find(node => node.id === "a").y},aPosition,
      "one undo restores applied layout geometry");
    doc.querySelector(".layout-preview-modal [data-close]").click();

    T.setSelection("node",["a","b","c"]);
    T.executeCommand("layoutPreview");
    T.state.nodes.find(node => node.id === "c").title = "Intervening edit";
    assert.strictEqual(T.editingApplyLayoutPreview(),false,
      "stale layout proposals refuse to apply after a document generation change");
    T.editingCancelLayoutPreview();
    doc.querySelector(".layout-preview-modal [data-close]").click();

    const editingCommands = new Map(T.COMMANDS.map(command => [command.id,command]));
    sameList(editingCommands.get("rotateRight").requiredCapabilities,["rotatable"],
      "the authoritative command catalog declares capability requirements");
    assert.strictEqual(editingCommands.get("layoutPreview").preview,true,
      "the command catalog declares transient preview semantics");
    assert(doc.querySelector(".editing-toolbar [data-editing-selection-mode]"),
      "the active selection gesture is visible on the canvas");
    assert(doc.querySelectorAll(".editing-ruler").length === 2,
      "horizontal and vertical rulers are present as precision surfaces");

    T.setSelection("node","a");
    T.executeCommand("formatPainter");
    assert(T.editingFormatPainter && !T.editingFormatPainter.persistent,
      "one-shot format painter exposes an active session state");
    assert(!doc.querySelector("[data-editing-painter-status]").hidden,
      "format-painter scope is visibly announced before a target is chosen");
    window.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
    assert.strictEqual(T.editingFormatPainter,null,"Escape cancels the painter");

    const rotated = T.state.nodes.find(node => node.id === "a");
    T.setNodeRotation(rotated,90);
    T.render();
    T.startInlineEditor("node","a");
    const inline = doc.querySelector(".inline-editor");
    assert(inline && parseFloat(inline.style.width) >= 120 && parseFloat(inline.style.height) >= 60,
      "inline editing uses the rotated visual bounds instead of the stale local rectangle");
    inline.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  }

  /* SCH-117 scale fixture: select-by is model-backed at 10k objects. */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.state.nodes = Array.from({length:10000},(_,index) => ({
      id:`edit-bench-${String(index).padStart(5,"0")}`,type:"concept",
      x:(index%100)*160,y:Math.floor(index/100)*80,title:`Service ${index}`,
      status:index%20===0 ? "Blocked" : "In progress",color:"#CFE8FF"
    }));
    T.state.edges = [];
    T.invalidateOrganizationEvaluation();
    const start = performance.now();
    const ids = T.editingSelectByQuery({scope:"all",propertyId:"status",value:"blocked",
      render:false,announce:false});
    const elapsed = performance.now()-start;
    assert.strictEqual(ids.length,500,
      "10k-object property queries return the complete deterministic result set");
    assert.strictEqual(ids[0],"edit-bench-00000","large query results are stable-ID ordered");
    assert(elapsed < 1500,
      `10k-object select-by stays on the model path (${elapsed.toFixed(1)}ms)`);
  }

  /* Search performance fixture: 10k objects and 20k relationships. */
  /* SCH-081 — additive organization schema, migration, effective state, and undo. */
  {
    const { window } = makeDom();
    const T = window.__T;
    const legacy = {
      version:1, nextId:20,
      nodes:[
        {id:"a",type:"concept",x:40,y:40,title:"Alpha",notes:"",color:"#CFE8FF"},
        {id:"b",type:"concept",x:280,y:40,title:"Beta",notes:"",color:"#D8F3DC"}
      ],
      edges:[{id:"e1",from:"a",to:"b",kind:"link",label:"Depends on"}]
    };
    T.importDocText(JSON.stringify(legacy));
    assert.strictEqual(T.organizationLayers().length, 1,
      "legacy documents receive one deterministic default layer");
    assert.strictEqual(T.organizationLayers()[0].id, "layer-default",
      "legacy default layer uses the stable reserved ID");
    assert.strictEqual(T.organizationGroups().length, 0,
      "legacy documents never infer groups from overlap or proximity");
    assert(T.state.nodes.every(node => !Object.hasOwn(node, "layerId")),
      "default-layer membership remains implicit on legacy objects");

    const document = {
      ...legacy,
      nextId:40,
      organization:{
        pluginData:{preserve:true},
        page:{id:"wrong",name:"Architecture"},
        layers:[
          {id:"layer-default",name:"Base"},
          {id:"o20",name:"Services",opacity:.55,color:"#c20029",export:false,plugin:"keep"},
          {id:"o20",name:"Duplicate"}
        ],
        groups:[
          {id:"o21",name:"Platform",layerId:"o20",plugin:"keep"},
          {id:"o22",name:"Runtime",parentGroupId:"o21"},
          {id:"o23",name:"Cycle A",parentGroupId:"o24"},
          {id:"o24",name:"Cycle B",parentGroupId:"o23"}
        ],
        activeLayerId:"o20"
      }
    };
    document.nodes[0].groupId = "o22";
    document.nodes[1].layerId = "missing";
    document.nodes[1].hidden = false;
    T.importDocText(JSON.stringify(document));
    assert.strictEqual(T.organizationLayers().length, 2,
      "duplicate layer IDs are deterministically discarded");
    assert.strictEqual(T.organizationObjectLayerId(T.state.nodes[0]), "o20",
      "nested groups inherit their root group's layer");
    assert.strictEqual(T.state.nodes[1].layerId, undefined,
      "invalid object layer membership migrates to the default layer");
    assert.strictEqual(T.state.nodes[1].hidden, undefined,
      "false direct-state flags are normalized away");
    const cycleGroups = ["o23","o24"].map(T.organizationGroupById);
    assert(cycleGroups.some(group => !group.parentGroupId),
      "invalid nested-group cycles are broken deterministically");
    const firstSave = T.serializeDocument();
    const secondSave = T.serializeDocument();
    assert.strictEqual(firstSave, secondSave,
      "organization serialization is deterministic");
    const saved = JSON.parse(firstSave);
    assert.strictEqual(saved.organization.pluginData.preserve, true,
      "unknown organization properties survive round-trip serialization");
    assert.strictEqual(saved.organization.layers.find(layer => layer.id === "o20").plugin, "keep",
      "unknown layer properties survive round-trip serialization");
    assert.strictEqual(saved.organization.groups.find(group => group.id === "o21").plugin, "keep",
      "unknown group properties survive round-trip serialization");
    assert.strictEqual(saved.organization.layers.find(layer => layer.id === "o20").color, "#c20029",
      "layer colors are normalized and persisted");

    const platform = T.organizationGroupById("o21");
    T.organizationSetHidden(platform, true);
    assert.strictEqual(T.organizationObjectHidden(T.state.nodes[0]), true,
      "group visibility contributes to effective node visibility");
    assert.strictEqual(T.state.nodes[0].hidden, undefined,
      "inherited group visibility never overwrites direct node state");
    assert.strictEqual(T.visibleCanvasEdges().length, 0,
      "links touching organizationally hidden objects are suppressed, not proxied");
    T.organizationSetHidden(platform, false);
    const layer = T.organizationLayerById("o20");
    T.organizationSetLocked(layer, true);
    assert.strictEqual(T.organizationObjectLocked(T.state.nodes[0]), true,
      "layer locking contributes to effective node locking");
    T.setSelection("node", "a");
    const beforeDelete = T.state.nodes.length;
    assert.strictEqual(T.deleteSelection(), false,
      "delete rejects selections with effective locks");
    assert.strictEqual(T.state.nodes.length, beforeDelete,
      "a rejected locked deletion leaves model state untouched");
    T.organizationSetLocked(layer, false);

    const priorMembership = new Map(T.state.nodes.map(node => [node.id, node.groupId]));
    T.setSelection("node", ["a","b"]);
    const group = T.createOrganizationGroupFromSelection("Release unit");
    assert(group && T.organizationGroupMemberNodes(group.id, true).length === 2,
      "group creation records explicit membership for every selected node");
    assert.strictEqual(T.undoDepth > 0, true, "group creation is undoable");
    T.undo();
    assert.strictEqual(T.organizationGroupById(group.id), null,
      "undo removes the created group record");
    assert(T.state.nodes.every(node => node.groupId === priorMembership.get(node.id)),
      "undo restores every prior membership value");
    T.redo();
    assert(T.organizationGroupById(group.id),
      "redo restores the group and its membership");
  }

  /* SCH-081 — group operations, active layers, direct/effective lock state, and creation paths. */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({
      version:1,nextId:10,
      organization:{
        page:{id:"page-default",name:"Current canvas"},
        layers:[{id:"layer-default",name:"Default"}],
        groups:[],activeLayerId:"layer-default"
      },
      nodes:[
        {id:"n1",type:"concept",x:0,y:0,title:"One",notes:"",color:"#CFE8FF"},
        {id:"n2",type:"concept",x:220,y:0,title:"Two",notes:"",color:"#D8F3DC"},
        {id:"n3",type:"concept",x:440,y:0,title:"Three",notes:"",color:"#FFE9A8"}
      ],edges:[
        {id:"e1",from:"n1",to:"n2",kind:"link",label:"Supports"},
        {id:"e2",from:"n2",to:"n3",kind:"link",label:"Produces"}
      ]
    }));
    const layer = T.createOrganizationLayer("Delivery");
    const newNode = T.addNode("concept", 700, 0);
    assert.strictEqual(newNode.layerId, layer.id,
      "new nodes are assigned to the active layer");
    T.addEdge({id:"n3"}, {id:newNode.id});
    assert.strictEqual(T.state.edges.at(-1).layerId, layer.id,
      "new relationships are assigned to the active layer independently of endpoints");
    T.importCSVText("id,name\n1,one", "active_layer_table");
    assert.strictEqual(T.state.nodes.at(-1).layerId, layer.id,
      "CSV-created tables honor the active layer");
    T.importDDLText("CREATE TABLE ddl_layer_test (id INT PRIMARY KEY);");
    assert.strictEqual(T.state.nodes.at(-1).layerId, layer.id,
      "DDL-created tables honor the active layer");

    T.setSelection("node", ["n1","n2"]);
    const parent = T.createOrganizationGroupFromSelection("Parent");
    T.setSelection("node", "n3");
    const child = T.createOrganizationGroupFromSelection("Child");
    assert(T.organizationSetGroupParent(child, parent.id),
      "groups can be nested under another group");
    assert.strictEqual(T.organizationSetGroupParent(parent, child.id), false,
      "group parenting rejects descendant cycles without mutating state");
    assert.strictEqual(T.organizationGroupMemberNodes(parent.id, true).length, 3,
      "parent groups resolve all nested member nodes");

    const beforeNodeCount = T.state.nodes.length;
    const beforeGroupCount = T.organizationGroups().length;
    const duplicate = T.duplicateOrganizationGroup(parent.id);
    assert(duplicate && T.state.nodes.length === beforeNodeCount + 3,
      "duplicating a group duplicates every nested member");
    assert.strictEqual(T.organizationGroups().length, beforeGroupCount + 2,
      "duplicating a group remaps its complete nested group tree");
    assert(T.organizationGroupMemberNodes(duplicate.id, true).every(node =>
      node.groupId !== parent.id && node.groupId !== child.id),
    "duplicated members point only at remapped group IDs");

    const orderedBefore = T.state.nodes.map(node => node.id);
    assert(T.organizationReorderGroup(parent.id, true),
      "groups can be arranged as one unit");
    const parentIds = new Set(T.organizationGroupMemberNodes(parent.id, true).map(node => node.id));
    assert(T.state.nodes.slice(-parentIds.size).every(node => parentIds.has(node.id)),
      "bringing a group forward preserves its members as one ordered block");
    assert.notDeepStrictEqual(T.state.nodes.map(node => node.id), orderedBefore,
      "group arrangement changes only z-order");

    T.organizationSetLocked(parent, true);
    assert(T.organizationGroupMemberNodes(parent.id, true).every(T.organizationObjectLocked),
      "group locking is inherited by nested members");
    assert.strictEqual(T.organizationReorderGroup(parent.id, false), false,
      "locked groups cannot be rearranged");
    T.organizationSetLocked(parent, false);
    const directLock = T.state.nodes.find(node => node.id === "n1");
    directLock.locked = true;
    T.organizationSetLocked(parent, true);
    T.organizationSetLocked(parent, false);
    assert.strictEqual(directLock.locked, true,
      "toggling an ancestor lock preserves a descendant's direct lock");
    delete directLock.locked;
    assert(T.ungroupOrganizationGroup(child.id),
      "ungroup removes only the requested organizational record");
    assert.strictEqual(T.state.nodes.find(node => node.id === "n3").groupId, undefined,
      "ungroup releases direct members without changing their geometry");
  }

  /* SCH-081 — spatial inheritance and collapsed-frame proxying remain distinct. */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({
      version:1,nextId:10,nodes:[
        {id:"f",type:"frame",x:0,y:0,title:"Container",color:"#2456E6",w:360,h:240},
        {id:"inside",type:"concept",x:80,y:80,title:"Inside",notes:"",color:"#CFE8FF"},
        {id:"outside",type:"concept",x:520,y:80,title:"Outside",notes:"",color:"#D8F3DC"}
      ],edges:[{id:"edge",from:"inside",to:"outside",kind:"link",label:"References"}]
    }));
    const frame = T.state.nodes.find(node => node.id === "f");
    const inside = T.state.nodes.find(node => node.id === "inside");
    T.organizationSetHidden(frame, true);
    assert.strictEqual(T.organizationObjectHidden(inside), true,
      "spatial children inherit hidden state from containing frames");
    assert.strictEqual(T.visibleCanvasEdges().length, 0,
      "spatial organizational hiding suppresses external links");
    T.organizationSetHidden(frame, false);
    T.organizationSetLocked(frame, true);
    assert.strictEqual(T.organizationObjectLocked(inside), true,
      "spatial children inherit lock state from containing frames");
    T.organizationSetLocked(frame, false);
    T.setSelection("node", "inside");
    assert(T.organizationIsolateCurrent(),
      "a node inside a frame can be isolated");
    assert.strictEqual(T.organizationObjectHidden(inside), false,
      "isolation keeps the target node visible");
    assert.strictEqual(T.organizationObjectHidden(frame), false,
      "isolation also keeps required spatial ancestors visible");
    assert.strictEqual(T.organizationObjectHidden(T.state.nodes.find(node => node.id === "outside")), true,
      "isolation hides unrelated objects");
    assert(T.organizationIsolateCurrent(), "repeating isolation clears the transient mode");
    frame.collapsed = true;
    assert.strictEqual(T.organizationObjectHidden(inside), false,
      "collapsed-frame state is not conflated with organizational visibility");
    const collapsed = T.collapsedFrameHiddenNodeIds();
    const proxies = T.collapsedFrameProxyMap(collapsed);
    assert.strictEqual(proxies.get("inside"), "f",
      "collapsed contents retain the existing frame proxy mapping");
    assert.strictEqual(T.visibleCanvasEdges(collapsed, proxies).length, 1,
      "collapsed contents keep their external relationship on the canvas");
    assert.strictEqual(T.edgeEndpoints(T.state.edges[0], collapsed, proxies).proxyA, "f",
      "the preserved relationship connects to the collapsed frame");
    T.organizationSetHidden(inside, true);
    assert.strictEqual(T.visibleCanvasEdges(collapsed, proxies).length, 0,
      "a direct hide still suppresses a relationship even inside a collapsed frame");
  }

  /* SCH-081 — layer rendering, visual export, search, and lock-aware editing. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({
      version:1,nextId:20,
      organization:{
        page:{id:"page-default",name:"Current canvas"},
        layers:[
          {id:"layer-default",name:"Default"},
          {id:"l1",name:"Background",opacity:.5,color:"#007873",export:false},
          {id:"l2",name:"Foreground"}
        ],
        groups:[],activeLayerId:"l2"
      },
      nodes:[
        {id:"front",type:"concept",x:0,y:0,title:"Front",notes:"",color:"#CFE8FF",layerId:"l2"},
        {id:"back",type:"concept",x:0,y:0,title:"Back",notes:"",color:"#FFE9A8",layerId:"l1"}
      ],
      edges:[]
    }));
    const rendered = [...doc.querySelectorAll("#nodeLayer > [data-node]")]
      .map(element => element.getAttribute("data-node"));
    sameList(rendered, ["back","front"],
      "layer order overrides insertion order within the node render pass");
    assert.strictEqual(doc.querySelector('[data-node="back"]').getAttribute("opacity"), "0.5",
      "layer opacity is applied to the whole rendered object");
    assert.strictEqual(doc.querySelector('[data-node="back"]').getAttribute("data-layer-export"), "false",
      "rendered objects expose their effective export state");
    const clone = T.cloneBoardForPng(true).clone;
    assert.strictEqual(clone.querySelector('[data-node="back"]'), null,
      "visual export removes objects on excluded layers");
    assert(clone.querySelector('[data-node="front"]'),
      "visual export preserves objects on included layers");

    const front = T.state.nodes.find(node => node.id === "front");
    T.organizationSetHidden(front, true);
    assert.strictEqual(T.hitTest({x:20,y:20}).node.id, "back",
      "organizationally hidden nodes are removed from hit testing while visible overlaps remain reachable");
    T.refreshSearchIndex(true);
    const hiddenResult = T.querySearchIndex({text:"Front",visibility:"hidden"}).results;
    assert(hiddenResult.some(result => result.ownerId === "front"),
      "search discovery indexes effective hidden state");
    delete front.hidden;
    front.sourceAuthority = "external";
    T.setSelection("node", "front");
    T.render();
    assert.strictEqual(T.organizationObjectLocked(front), true,
      "external source authority contributes to effective lock state");
    assert(doc.querySelector("#inspBody [data-organization-lock-guard=true]"),
      "the inspector communicates that ordinary controls are lock-guarded");
    assert.strictEqual(T.startInlineEditor("node", "front"), undefined,
      "inline editing does not open for effectively locked nodes");
    assert.strictEqual(doc.querySelector(".inline-editor"), null,
      "lock rejection leaves no editable overlay behind");
  }

  /* SCH-081 — explorer selection sync, keyboard access, drag/drop semantics, and virtualization. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({
      version:1,nextId:20,
      organization:{
        page:{id:"page-default",name:"Current canvas"},
        layers:[
          {id:"layer-default",name:"Default"},
          {id:"layer-two",name:"Second"}
        ],
        groups:[{id:"group-one",name:"Grouped work",layerId:"layer-default"}],
        activeLayerId:"layer-default"
      },
      nodes:[
        {id:"a",type:"concept",x:0,y:0,title:"Alpha",notes:"",color:"#CFE8FF"},
        {id:"b",type:"concept",x:220,y:0,title:"Beta",notes:"",color:"#D8F3DC",groupId:"group-one"},
        {id:"frame",type:"frame",x:500,y:0,title:"Area",color:"#2456E6",w:360,h:240}
      ],edges:[{id:"e",from:"a",to:"b",kind:"link",label:"Supports"}]
    }));
    assert(T.setObjectExplorerOpen(true, {persist:false,focus:false}),
      "Object Explorer can be opened from application state");
    const explorer = doc.getElementById("objectExplorer");
    const tree = doc.getElementById("objectExplorerTree");
    assert.strictEqual(explorer.hidden, false, "open state reveals the explorer");
    assert.strictEqual(tree.getAttribute("role"), "tree",
      "explorer exposes tree semantics");
    const pageRow = tree.querySelector('[data-organization-row="page:page-default"]');
    const layerRow = tree.querySelector('[data-organization-row="layer:layer-default"]');
    assert(pageRow && layerRow, "explorer starts with page and layer hierarchy");
    T.organizationAllRows().find(row => row.kind === "group");
    const groupRow = tree.querySelector('[data-organization-row="group:group-one"]');
    groupRow.querySelector(".object-explorer-disclosure").click();
    T.renderOrganizationExplorer(true);
    const betaRow = tree.querySelector('[data-organization-row="node:b"]');
    betaRow.click();
    sameList(T.selectionIds("node"), ["b"],
      "explorer selection synchronizes to canvas selection");
    T.setSelection("node", "a");
    T.render();
    T.renderOrganizationExplorer(true);
    assert.strictEqual(tree.querySelector('[data-organization-row="node:a"]').getAttribute("aria-selected"), "true",
      "canvas selection synchronizes back to the explorer");
    const alphaRow = tree.querySelector('[data-organization-row="node:a"]');
    alphaRow.focus();
    tree.dispatchEvent(new window.KeyboardEvent("keydown", {key:"F2",bubbles:true,cancelable:true}));
    const rename = tree.querySelector(".object-explorer-rename");
    assert(rename, "F2 opens accessible inline rename");
    rename.value = "Alpha renamed";
    rename.dispatchEvent(new window.KeyboardEvent("keydown", {key:"Enter",bubbles:true,cancelable:true}));
    assert.strictEqual(T.state.nodes.find(node => node.id === "a").title, "Alpha renamed",
      "keyboard rename commits to the model");
    assert(T.undoDepth > 0, "explorer rename is undoable");

    const sourceRow = T.organizationAllRows().find(row => row.kind === "node" && row.id === "a");
    const groupTarget = T.organizationAllRows().find(row => row.kind === "group" && row.id === "group-one");
    assert(T.organizationApplyDrop(sourceRow, groupTarget),
      "node-to-group drag/drop assigns explicit group membership");
    assert.strictEqual(T.state.nodes.find(node => node.id === "a").groupId, "group-one",
      "node-to-group drop updates membership without geometry inference");
    const layerTarget = T.organizationAllRows().find(row => row.kind === "layer" && row.id === "layer-two");
    const movedRow = T.organizationAllRows().find(row => row.kind === "node" && row.id === "a");
    assert(T.organizationApplyDrop(movedRow, layerTarget),
      "node-to-layer drag/drop removes group membership and assigns the target layer");
    assert.strictEqual(T.state.nodes.find(node => node.id === "a").groupId, undefined,
      "moving a node to a layer removes its explicit group parent");
    assert.strictEqual(T.state.nodes.find(node => node.id === "a").layerId, "layer-two",
      "node-to-layer drop records the target layer");
    const frameTarget = T.organizationAllRows().find(row => row.kind === "node" && row.id === "frame");
    assert(T.organizationApplyDrop(movedRow, frameTarget),
      "node-to-frame drop uses existing spatial containment semantics");
    const moved = T.state.nodes.find(node => node.id === "a");
    const frame = T.state.nodes.find(node => node.id === "frame");
    assert(T.containerContainedNodes(frame).some(node => node.id === moved.id),
      "node-to-frame drop moves the node into the frame footprint");

    const layerRowTwo = tree.querySelector('[data-organization-row="layer:layer-two"]');
    layerRowTwo?.click();
    assert.strictEqual(T.organizationIsolateCurrent(), true,
      "an explorer target can be isolated without mutating direct visibility");
    assert(T.organizationIsolation, "isolation is tracked as transient UI state");
    const serialized = JSON.parse(T.serializeDocument());
    assert(!JSON.stringify(serialized).includes("organizationIsolation"),
      "transient isolation is not serialized into the document");
    assert(T.organizationShowAll(), "Show all clears transient isolation");
    assert.strictEqual(T.organizationIsolation, null, "Show all returns the full canvas");
    assert(T.COMMANDS.some(command => command.id === "toggleObjectExplorer" && command.owner === "object-organization"),
      "Object Explorer is available through the shared command/ribbon registry");
  }

  /* SCH-081 — 10k-row explorer keeps a bounded DOM window and responsive filtering. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.state.nodes = Array.from({length:10000}, (_, index) => ({
      id:`org-${index}`,type:"concept",x:(index % 100) * 180,y:Math.floor(index / 100) * 90,
      title:index === 9999 ? "organization needle" : `Object ${index}`,notes:"",color:"#CFE8FF"
    }));
    T.state.edges = [];
    T.state.nextId = 20000;
    T.setObjectExplorerOpen(true, {persist:false,focus:false});
    T.renderOrganizationExplorer(true);
    assert(T.organizationFlatRows.length >= 10003,
      "large-model explorer indexes page, layer, objects, and relationships");
    assert(doc.querySelectorAll("#objectExplorerTree [data-organization-row]").length < 50,
      "explorer virtualization keeps the mounted row count bounded");
    const filter = doc.getElementById("objectExplorerFilter");
    const started = performance.now();
    filter.value = "organization needle";
    filter.dispatchEvent(new window.Event("input", {bubbles:true}));
    const elapsed = performance.now() - started;
    assert(T.organizationFlatRows.some(row => row.id === "org-9999"),
      "large-model explorer filtering finds the unique target");
    assert(elapsed < 1000,
      `10k-row explorer filter stays responsive (${elapsed.toFixed(1)}ms)`);
  }

  /* SCH-082 — typed metadata schema, values, formulas, validation, and deterministic migration. */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.importDocText(JSON.stringify({
      version:1,nextId:40,
      metadata:{
        futureRegistryFlag:"preserve-me",
        properties:[
          {id:"p-owner",name:"Owner",type:"person",scope:"canonical",appliesTo:["node"]},
          {id:"p-risk",name:"Risk",type:"enum",scope:"canonical",appliesTo:["node","edge"],
            options:[{id:"low",label:"Low"},{id:"high",label:"High"}]},
          {id:"p-score",name:"Score",type:"number",scope:"canonical",appliesTo:["node"],min:0,max:10},
          {id:"p-ref",name:"Reference",type:"reference",scope:"canonical",appliesTo:["node"]},
          {id:"p-degree",name:"Relationship count",type:"formula",scope:"derived",appliesTo:["node"],
            formula:"countIn() + countOut()"},
          {id:"p-cycle-a",name:"Cycle A",type:"formula",appliesTo:["node"],formula:'prop("p-cycle-b")'},
          {id:"p-cycle-b",name:"Cycle B",type:"formula",appliesTo:["node"],formula:'prop("p-cycle-a")'}
        ],
        objectTypes:[{id:"ot-service",name:"Service",propertyIds:["p-owner","p-risk","p-score"],
          requiredPropertyIds:["p-owner"]}],
        relationshipTypes:[{id:"rt-depends",name:"Depends on",propertyIds:["p-risk"],
          allowedSourceTypeIds:["ot-service"],allowedTargetTypeIds:["ot-service"]}]
      },
      nodes:[
        {id:"a",type:"concept",x:0,y:0,title:"Alpha",notes:"",color:"#CFE8FF",
          semanticTypeId:"ot-service",properties:{"p-owner":{id:"alex",label:"Alex"},"p-risk":"high","p-score":7}},
        {id:"b",type:"concept",x:220,y:0,title:"Beta",notes:"",color:"#D8F3DC"}
      ],
      edges:[{id:"e",from:"a",to:"b",kind:"link",label:"Depends on",semanticTypeId:"rt-depends"}]
    }));
    const owner = T.metadataPropertyById("p-owner");
    const alpha = T.state.nodes.find(node => node.id === "a");
    assert.strictEqual(T.metadataDisplayValue(owner, T.metadataRawValue(alpha, owner)), "Alex",
      "person values retain stable local identity and readable labels");
    assert.strictEqual(T.metadataValue(alpha, "p-degree"), 1,
      "constrained formulas can derive relationship counts");
    const cycle = T.metadataFormulaResult(alpha, T.metadataPropertyById("p-cycle-a"));
    assert(cycle.error.includes("Formula cycle"),
      "formula cycles are detected with a structured error instead of executing code");
    const findings = T.metadataValidationFindings();
    assert(Array.isArray(findings) && findings.length > 0,
      "validation completes across typed and untyped objects");
    assert(findings.some(finding => finding.objectId === "b" && finding.code === "required") === false,
      "type-specific required properties do not apply to an untyped object");
    assert(findings.some(finding => finding.objectId === "e" && finding.code === "target-type"),
      "relationship types warn when the target semantic type is incompatible");
    const bad = T.metadataSetValue(alpha, "p-score", 99, {render:false});
    assert.strictEqual(bad.ok, false, "typed setters reject out-of-range numbers");
    const reviewed = T.metadataCreateProperty({name:"Reviewed",type:"date",appliesTo:["node"]});
    const nextReview = T.metadataCreateProperty({
      name:"Next review",type:"formula",appliesTo:["node"],
      formula:`dateAddDays(prop("${reviewed.id}"), 7)`
    });
    const beta = T.state.nodes.find(node => node.id === "b");
    T.metadataSetValue(beta, reviewed, "2026-07-24", {render:false});
    assert.strictEqual(T.metadataValue(beta, nextReview), "2026-07-31",
      "constrained formulas support deterministic date arithmetic");
    const explanation = T.metadataFormulaExplanation(beta, nextReview);
    assert.strictEqual(explanation.inputs[0].name, "Reviewed",
      "computed results expose their formula inputs for audit");
    const unsafe = T.metadataCreateProperty({
      name:"Unsafe",type:"formula",appliesTo:["node"],formula:"fetchData()"
    });
    assert(T.metadataValidationFindings().some(finding =>
      finding.code === "formula-definition" && finding.propertyId === unsafe.id),
      "formula validation rejects undocumented functions even before a value is rendered");
    const beforeUndo = T.undoDepth;
    const changed = T.metadataSetValue(alpha, "p-score", 8, {render:false});
    assert(changed.ok && T.metadataRawValue(alpha, "p-score") === 8,
      "typed setters normalize and store valid values");
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "one property edit creates one undo entry");
    T.undo();
    assert.strictEqual(T.metadataRawValue(T.state.nodes.find(node => node.id === "a"), "p-score"), 7,
      "Undo restores typed metadata values");
    const saved = JSON.parse(T.serializeDocument());
    assert.strictEqual(saved.metadata.futureRegistryFlag, "preserve-me",
      "unknown registry properties survive normalization and save");
    assert.strictEqual(saved.nodes.find(node => node.id === "a").properties["p-owner"].label, "Alex",
      "typed values serialize under stable definition IDs");
    assert.strictEqual(T.serializeDocument(), T.serializeDocument(),
      "repeated metadata serialization is deterministic");
  }

  /* SCH-082 — definition lifecycle, legacy adoption, CSV preview, inspector, and table UI. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    T.importDocText(JSON.stringify({
      version:1,nextId:20,
      nodes:[
        {id:"a",type:"concept",x:0,y:0,title:"Alpha",notes:"",color:"#CFE8FF",
          customProperties:{risk:"High"}},
        {id:"b",type:"concept",x:220,y:0,title:"Beta",notes:"",color:"#D8F3DC"}
      ],edges:[]
    }));
    assert.strictEqual(T.metadataLegacyDefinitions().length, 1,
      "legacy scalar custom properties are discoverable without rewriting on open");
    const adopted = T.metadataAdoptLegacyProperties();
    assert.deepStrictEqual({...adopted}, {created:1,values:1},
      "legacy adoption creates stable definitions and values only on command");
    const risk = T.metadataPropertyDefinitions().find(definition => definition.name === "Risk");
    assert(risk && T.metadataRawValue(T.state.nodes[0], risk.id) === "High",
      "adopted legacy values remain intact while the original dictionary is preserved");
    const owner = T.metadataCreateProperty({name:"Owner",type:"text",appliesTo:["node"]});
    const csv = `id,${owner.id}\na,Alex\nmissing,No one\nb,Blair`;
    const preview = T.metadataBuildCsvPreview(csv);
    assert.strictEqual(preview.changes.length, 2,
      "CSV preview maps typed columns by stable definition ID");
    assert(preview.errors.some(error => error.includes("missing")),
      "CSV preview reports unmatched rows without blocking valid rows");
    assert(T.metadataApplyCsvPreview(preview), "CSV apply commits valid preview rows");
    assert.strictEqual(T.metadataRawValue(T.state.nodes[1], owner.id), "Blair",
      "CSV apply updates the intended object value");
    const impact = T.metadataDefinitionImpact("property", owner.id);
    assert.strictEqual(impact.objects.length, 2, "definition impact lists every stored value");
    const deprecated = T.metadataDeleteDefinition("property", owner.id);
    assert(deprecated.deprecated, "in-use definition deletion first deprecates safely");
    const removed = T.metadataDeleteDefinition("property", owner.id, {force:true});
    assert(removed.deleted, "confirmed definition deletion completes");
    assert.strictEqual(T.state.nodes[0].orphanProperties[owner.id], "Alex",
      "forced deletion preserves values as orphan metadata");

    T.setSelection("node", "a");
    T.render();
    assert(doc.querySelector("#inspBody details .metadata-inspector-property"),
      "selected objects expose typed metadata in the inspector");
    assert(T.openMetadataPanel("table"), "object table opens from the shared metadata surface");
    assert.strictEqual(doc.getElementById("metadataPanel").hidden, false,
      "metadata tools render as a visible accessible dialog");
    assert(doc.getElementById("metadataPanel").classList.contains("open"),
      "metadata dialog opts into the shared visible modal state");
    assert(doc.querySelectorAll(".metadata-table tbody tr").length === 2,
      "object table exposes one live row per object");
    T.openMetadataPanel("schema");
    assert(doc.querySelector("[data-definition-id]"),
      "schema manager renders stable definition records");
    T.openMetadataPanel("validation");
    assert(doc.querySelector(".metadata-validation-summary"),
      "validation panel renders a navigable summary");
    assert.strictEqual(doc.getElementById("metadataPanelBody").getAttribute("aria-labelledby"),
      "metadataTabValidation", "metadata tabs label their shared tab panel");
    const validationTab = doc.getElementById("metadataTabValidation");
    validationTab.focus();
    validationTab.dispatchEvent(new window.KeyboardEvent("keydown", {key:"Home",bubbles:true}));
    assert.strictEqual(doc.getElementById("metadataTabTable").getAttribute("aria-selected"), "true",
      "metadata tabs support Home/End and arrow-key navigation");
    assert(T.COMMANDS.some(command => command.id === "metadataObjectTable" && command.owner === "custom-metadata"),
      "object table is available through the shared command/ribbon registry");
    T.closeMetadataPanel();
    assert.strictEqual(doc.getElementById("metadataPanel").hidden, true,
      "metadata dialog closes without mutating document state");
    assert(!doc.getElementById("metadataPanel").classList.contains("open"),
      "closing metadata removes the shared visible modal state");

    const first = T.metadataCreateProperty({name:"First",type:"text",appliesTo:["node"]});
    const second = T.metadataCreateProperty({name:"Second",type:"text",appliesTo:["node"]});
    assert(T.metadataReorderProperty(second.id, -1), "property definitions can be reordered");
    const orderedIds = T.metadataPropertyDefinitions().map(definition => definition.id);
    assert(orderedIds.indexOf(second.id) < orderedIds.indexOf(first.id),
      "reordered property order is reflected by the registry");
    T.metadataSetValue(T.state.nodes[0], first, "17", {render:false});
    const conversion = T.metadataPropertyTypeConversionPreview(first.id, "number");
    assert.strictEqual(conversion.ambiguous, 1,
      "property type conversion produces a dry-run report before changing schema");
    assert.strictEqual(T.metadataRawValue(T.state.nodes[0], first.id), "17",
      "conversion preview never mutates stored values");
    const requiredType = T.metadataCreateType("node", {
      name:"Governed service", propertyIds:[first.id,second.id], requiredPropertyIds:[second.id]
    });
    const typePreview = T.metadataTypeAssignmentPreview(T.state.nodes[0], requiredType.id);
    assert(typePreview.hasWarnings && typePreview.missingRequired.includes("Second") &&
      typePreview.preservesValues,
      "semantic type assignment previews missing requirements while preserving data");
    assert(T.metadataAssignType(T.state.nodes[0], requiredType.id, {render:false}),
      "custom semantic object types are assignable");
    const workflowProperty = T.metadataCreateProperty({
      name:"Workflow property",type:"text",appliesTo:["node"],typeIds:[requiredType.id]
    });
    assert(T.metadataDefinitionsForObject(T.state.nodes[0]).some(definition =>
      definition.id === workflowProperty.id),
      "properties created from a typed-object workflow join that type in the same transaction");
    const uniqueProperty = T.metadataCreateProperty({
      name:"External key",type:"text",appliesTo:["node"],typeIds:[requiredType.id],unique:true
    });
    T.metadataSetValue(T.state.nodes[0], uniqueProperty, "duplicate-key", {render:false});
    T.metadataSetValue(T.state.nodes[1], uniqueProperty, "duplicate-key", {render:false});
    assert(T.metadataValidationFindings().some(finding =>
      finding.code === "unique" && finding.objectId === "b"),
      "explicit uniqueness constraints produce navigable duplicate findings");
    assert.strictEqual(T.metadataValueProvenance(T.state.nodes[0], first).origin, "manual",
      "stored values expose provenance independently from their display value");

    const imported = T.metadataCreateProperty({
      name:"Repository",type:"text",appliesTo:["node"],aliases:["Repo"]
    });
    T.metadataUpdateDefinition("objectType", requiredType.id, {
      propertyIds:[first.id,second.id,imported.id], requiredPropertyIds:[second.id]
    });
    const importPreview = T.metadataBuildCsvPreview(
      `id,name,semanticTypeId,Repo\na,Alpha renamed,${requiredType.id},schematic`
    );
    assert(importPreview.changes.some(change => change.field === "name") &&
      importPreview.changes.some(change => change.definition?.id === imported.id),
      "CSV mapping supports built-in round-trip columns and definition aliases");
    assert(T.metadataApplyCsvPreview(importPreview), "mapped CSV changes apply as one transaction");
    assert.strictEqual(T.state.nodes[0].title, "Alpha renamed",
      "CSV round trips can rename objects");
    assert.strictEqual(T.metadataValueProvenance(T.state.nodes[0], imported).origin, "imported",
      "CSV-applied values retain imported provenance");
    const stale = T.metadataBuildCsvPreview(`id,Repo\na,newer`);
    T.metadataSetValue(T.state.nodes[0], imported, "intervening", {render:false});
    assert.strictEqual(T.metadataApplyCsvPreview(stale), false,
      "CSV previews refuse to apply after the document generation changes");
    const gridPreview = T.metadataBuildGridPastePreview(
      "a", imported.id, "rect-a\nrect-b", T.state.nodes, [imported]
    );
    assert.strictEqual(gridPreview.changes.length, 2,
      "rectangular table paste previews every destination cell before mutation");
    const beforeGridUndo = T.undoDepth;
    assert(T.metadataApplyCsvPreview(gridPreview),
      "valid rectangular paste cells apply as one transaction");
    assert.strictEqual(T.undoDepth, beforeGridUndo + 1,
      "rectangular paste creates one undo entry");
    assert.strictEqual(T.metadataRawValue(T.state.nodes[1], imported), "rect-b",
      "rectangular paste maps rows by stable object identity");
    T.undo();
    assert.strictEqual(T.metadataRawValue(T.state.nodes[1], imported), undefined,
      "one undo restores every value from a rectangular paste");

    const secret = T.metadataCreateProperty({
      name:"Secret",type:"text",appliesTo:["node"],sensitive:true
    });
    T.metadataSetValue(T.state.nodes[0], secret, "secretneedle", {render:false});
    assert(!T.metadataExportCsv().includes("secretneedle"),
      "sensitive metadata is excluded from CSV exports by default");
    T.refreshSearchIndex(true);
    assert.strictEqual(T.querySearchIndex({text:"secretneedle"}).results.length, 0,
      "sensitive metadata is excluded from the search index");
  }

  /* Search performance fixture: 10k objects and 20k relationships. */
  {
    const { window } = makeDom();
    const T = window.__T;
    const nodes = [];
    for (let index = 0; index < 10000; index++){
      nodes.push({
        id:`bench-node-${index}`, type:"concept", x:(index % 100) * 180,
        y:Math.floor(index / 100) * 90,
        title:index === 9999 ? "benchmark needle" : `service ${index}`,
        notes:index % 20 === 0 ? "owned by platform" : "", color:"#CFE8FF"
      });
    }
    const edges = [];
    for (let index = 0; index < 20000; index++){
      edges.push({
        id:`bench-edge-${index}`,
        from:`bench-node-${index % 10000}`,
        to:`bench-node-${(index * 17 + 13) % 10000}`,
        kind:"link",
        label:index % 11 === 0 ? "Depends on" : ""
      });
    }
    T.state.nodes = nodes;
    T.state.edges = edges;
    T.state.nextId = 40000;
    const buildStart = performance.now();
    const stats = T.refreshSearchIndex(true);
    const buildMs = performance.now() - buildStart;
    const queryStart = performance.now();
    const response = T.querySearchIndex({text:"benchmark needle", property:"title"});
    const queryMs = performance.now() - queryStart;
    nodes[5000].notes = "incremental benchmark edit";
    const updateStats = T.refreshSearchIndex();
    assert.strictEqual(stats.owners, 30000,
      "large-model index covers every benchmark object and relationship");
    assert.strictEqual(response.results.length, 1,
      "large-model query returns the unique target");
    assert(buildMs < 5000, `10k/20k model indexing stays bounded (${buildMs.toFixed(1)}ms)`);
    assert(queryMs < 150, `warm indexed query meets the 150ms release budget (${queryMs.toFixed(1)}ms)`);
    assert.strictEqual(updateStats.changed, 1,
      "large-model single-object edits do not rebuild every owner's records");
    assert(updateStats.durationMs < 100,
      `large-model single-object index update meets the 100ms budget (${updateStats.durationMs.toFixed(1)}ms)`);
  }

  /* SCH-082 — 10k objects, 50 definitions, and 100k values stay bounded in the live table. */
  {
    const { window } = makeDom();
    const T = window.__T, doc = window.document;
    const properties = Array.from({length:50}, (_, index) => ({
      id:`bench-p-${index}`, name:`Bench property ${index}`, type:index % 7 === 0 ? "number" : "text",
      scope:"canonical", appliesTo:["node"], order:index
    }));
    T.state.metadata = {properties,objectTypes:[],relationshipTypes:[]};
    T.state.nodes = Array.from({length:10000}, (_, index) => ({
      id:`metadata-node-${index}`, type:"concept", x:index % 100, y:Math.floor(index / 100),
      title:`Metadata object ${index}`, notes:"", color:"#CFE8FF",
      properties:Object.fromEntries(Array.from({length:10}, (_, propertyIndex) => [
        `bench-p-${propertyIndex}`,
        propertyIndex % 7 === 0 ? index + propertyIndex : `value ${index}-${propertyIndex}`
      ]))
    }));
    T.state.edges = [];
    T.state.nextId = 20000;
    const normalizeStart = performance.now();
    T.ensureMetadata();
    const normalizeMs = performance.now() - normalizeStart;
    const tableStart = performance.now();
    T.openMetadataPanel("table");
    const tableMs = performance.now() - tableStart;
    assert.strictEqual(doc.querySelectorAll(".metadata-table tbody tr").length, 120,
      "large object tables render one bounded page instead of creating 10k DOM rows");
    assert(doc.querySelector(".metadata-table-summary").textContent.includes("10000 objects"),
      "large-table summary retains the complete filtered object count");
    assert(normalizeMs < 5000 && tableMs < 5000,
      `metadata scale fixture remains interactive (normalize ${normalizeMs.toFixed(0)}ms, table ${tableMs.toFixed(0)}ms)`);
    const filter = doc.querySelector('[aria-label="Filter object table"]');
    const filterStart = performance.now();
    filter.value = "Metadata object 9999";
    filter.dispatchEvent(new window.Event("input", {bubbles:true}));
    const filterMs = performance.now() - filterStart;
    assert.strictEqual(doc.querySelectorAll(".metadata-table tbody tr").length, 1,
      "large-table filtering finds the intended stable row");
    assert(filterMs < 5000, `metadata table filtering remains interactive (${filterMs.toFixed(0)}ms)`);
  }

  /* scheme theme overrides follow light/dark toggling */
  {
    const { window } = makeDom();
    const T = window.__T;
    T.applyColorScheme({ theme: { light: { accent: "#0a3d62" }, dark: { accent: "#88ccff" } } });
    T.applyTheme("light", { render: true });
    assert.strictEqual(window.document.documentElement.style.getPropertyValue("--accent"), "#0a3d62",
      "light-mode chrome variables use the light override");
    T.toggleTheme();
    assert.strictEqual(window.document.documentElement.style.getPropertyValue("--accent"), "#88ccff",
      "dark-mode chrome variables use the dark override");
    assert.strictEqual(T.themeColors().accent, "#88ccff", "canvas theme follows the active mode's override");
  }

  console.log("ALL TESTS PASSED");
})();
