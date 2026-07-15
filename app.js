"use strict";

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
