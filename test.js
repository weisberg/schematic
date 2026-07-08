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
  window.SVGElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800
  });
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
    assert(!("meta" in parsed), "documents without custom colors round-trip without a meta key");
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
