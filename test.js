const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
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
    const pastedAccounts = pasted.find(n => n.title === "accounts");
    const pastedUsage = pasted.find(n => n.title === "usage_events");
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
    assert(outline.includes("    - **customers**"), "Markdown outline includes linked tables as leaves");

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
    assert.strictEqual(window.document.getElementById("btnSave").getAttribute("aria-label"),
      window.document.getElementById("btnSave").title, "toolbar titles mirror to aria-label");
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
