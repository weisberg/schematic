const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

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
    drawImage(){}
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
  Object.defineProperty(ev, "pointerId", { configurable: true, value: 1 });
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

(async () => {
  assert(html.includes("<!-- deployment"), "deployment comment is present");
  assert(html.includes("<noscript>"), "noscript warning is present");
  assert(html.includes(".schematic"), "fallback file input accepts .schematic files");

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
    sameList(T.selection.ids.sort(), [first.id, second.id].sort(), "shift-click toggles a node into the selection");

    T.clearSelection();
    T.render();
    const board = window.document.getElementById("board");
    firePointer(window, board, "pointerdown", { clientX:40, clientY:80 });
    firePointer(window, board, "pointermove", { clientX:520, clientY:280 });
    firePointer(window, board, "pointerup", { clientX:520, clientY:280 });
    assert(T.selection.ids.includes(first.id), "marquee selects intersecting first node");
    assert(T.selection.ids.includes(second.id), "marquee selects intersecting second node");

    T.setSelection("node", [first.id, second.id]);
    T.render();
    const beforeUndo = T.undoDepth;
    const x1 = first.x, x2 = second.x;
    g = window.document.querySelector(`[data-node="${first.id}"]`);
    firePointer(window, g, "pointerdown", { clientX:first.x + 10, clientY:first.y + 10 });
    firePointer(window, board, "pointermove", { clientX:first.x + 90, clientY:first.y + 10 });
    firePointer(window, board, "pointerup", { clientX:first.x + 90, clientY:first.y + 10 });
    assert.strictEqual(T.undoDepth, beforeUndo + 1, "group drag creates one history entry");
    assert(first.x > x1 && second.x > x2, "group drag moves all selected nodes");
    T.undo();
    assert.strictEqual(T.state.nodes.find(n => n.id === first.id).x, x1, "undo restores first node after group drag");
    assert.strictEqual(T.state.nodes.find(n => n.id === second.id).x, x2, "undo restores second node after group drag");

    const beforeCount = T.state.nodes.length;
    T.setSelection("node", [first.id, second.id]);
    T.duplicateSelection();
    assert.strictEqual(T.state.nodes.length, beforeCount + 2, "duplicate operates on all selected nodes");
    assert.strictEqual(T.selection.ids.length, 2, "duplicate selects the duplicated node set");
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
    const pastedCustomers = pasted.find(n => n.title === "customers");
    const pastedOrders = pasted.find(n => n.title === "orders");
    assert(pastedCustomers && pastedOrders, "pasted tables preserve titles");
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
    T.importDocText(JSON.stringify({ version:1, nextId:4, edges:[], nodes:[
      { id:"n1", type:"concept", x:10, y:10, title:"Alpha", notes:"", color:"#FFE9A8" },
      { id:"n2", type:"concept", x:140, y:90, title:"Beta", notes:"", color:"#CFE8FF" },
      { id:"n3", type:"concept", x:360, y:170, title:"Gamma", notes:"", color:"#D8F3DC" }
    ] }));
    T.setSelection("node", ["n1", "n2", "n3"]);
    T.alignSelection("left");
    assert.deepStrictEqual([...new Set(T.selectedNodes().map(n => n.x))], [10], "align left gives all nodes the same x");
    T.importDocText(JSON.stringify({ version:1, nextId:4, edges:[], nodes:[
      { id:"n1", type:"concept", x:10, y:10, title:"Alpha", notes:"", color:"#FFE9A8" },
      { id:"n2", type:"concept", x:140, y:90, title:"Beta", notes:"", color:"#CFE8FF" },
      { id:"n3", type:"concept", x:360, y:170, title:"Gamma", notes:"", color:"#D8F3DC" }
    ] }));
    T.setSelection("node", ["n1", "n2", "n3"]);
    T.alignSelection("distributeX");
    const rects = T.selectedNodes().map(T.nodeRect).sort((a, b) => a.x - b.x);
    const gap1 = rects[1].x - (rects[0].x + rects[0].w);
    const gap2 = rects[2].x - (rects[1].x + rects[1].w);
    assert(Math.abs(gap1 - gap2) < 1e-9, "distribute horizontally creates equal edge gaps");
  }

  /* SCH-013 and SCH-016 — inline title and edge-label editing */
  {
    const { window } = makeDom();
    const T = window.__T;
    const node = T.state.nodes.find(n => n.title === "Tiered rewards");
    T.startInlineEditor("node", node.id);
    let input = window.document.querySelector(".inline-editor");
    assert(input, "node inline editor appears");
    input.value = "Tier strategy";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
    assert.strictEqual(node.title, "Tier strategy", "Enter commits node inline edit");

    T.startInlineEditor("node", node.id);
    input = window.document.querySelector(".inline-editor");
    input.value = "Cancelled title";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Escape", bubbles:true }));
    assert.strictEqual(node.title, "Tier strategy", "Escape cancels node inline edit");

    T.startInlineEditor("node", node.id);
    input = window.document.querySelector(".inline-editor");
    input.value = "Zoom cancelled";
    const wheel = new window.WheelEvent("wheel", { bubbles:true, cancelable:true, deltaY:-1, clientX:10, clientY:10 });
    window.document.getElementById("board").dispatchEvent(wheel);
    assert(!window.document.querySelector(".inline-editor"), "zoom closes inline editor");
    assert.strictEqual(node.title, "Tier strategy", "zoom close does not commit an edit");

    const edge = T.state.edges.find(e => e.label === "drives");
    T.startInlineEditor("edge", edge.id);
    input = window.document.querySelector(".inline-editor");
    input.value = "maps to";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
    assert.strictEqual(edge.label, "maps to", "Enter commits edge label inline edit");
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
      assert(text.includes(s.keys), `shortcut modal includes ${s.keys}`);
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

  /* SCH-042 — orthogonal edge routing */
  {
    const { window } = makeDom();
    const T = window.__T;
    const edge = T.state.edges.find(e => e.kind !== "link");
    edge.routing = "ortho";
    T.render();
    const ep = T.edgeEndpoints(edge);
    const d = T.edgePath(edge, ep.pa, ep.pb);
    assert(!d.includes("C"), "orthogonal edge path does not use cubic curves");
    assert(/^[MLHV0-9 .-]+$/.test(d), "orthogonal edge path uses only M/L/H/V commands and numbers");
    const edgeGroup = window.document.querySelector(`[data-edge="${edge.id}"]`);
    assert(edgeGroup.querySelectorAll("line").length > 0, "orthogonal relation still renders notation");
    const parsed = JSON.parse(T.serializeDocument());
    assert.strictEqual(parsed.edges.find(e => e.id === edge.id).routing, "ortho", "routing key serializes");
    T.importDocText(JSON.stringify(parsed));
    assert.strictEqual(T.state.edges.find(e => e.id === edge.id).routing, "ortho", "routing key imports");
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

  {
    const { window } = makeDom();
    const fonts = [...window.document.querySelectorAll("svg text")]
      .map(el => el.getAttribute("font-family"))
      .filter(Boolean);
    assert(fonts.length > 0, "render produced SVG text");
    assert(fonts.every(font => font.includes(",")), "every SVG text font-family includes a generic fallback");
  }

  console.log("ALL TESTS PASSED");
})();
