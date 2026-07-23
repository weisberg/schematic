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
function ctxDisclosure(parent, key, label, build, opts = {}, className = "ctxgroup"){
  const details = document.createElement("details");
  details.className = className;
  details.setAttribute(className === "ctxsubmenu" ? "data-ctx-submenu" : "data-ctx-group", key);
  const stored = ctxDisclosureState.get(key);
  details.open = stored == null ? !!opts.open : stored;
  const summary = document.createElement("summary");
  summary.setAttribute("role", "menuitem");
  summary.setAttribute("aria-haspopup", "true");
  summary.setAttribute("aria-expanded", String(details.open));
  const text = document.createElement("span");
  text.textContent = label;
  summary.append(text, disclosureChevron());
  const body = document.createElement("div");
  body.className = className === "ctxsubmenu" ? "ctxsubmenubody" : "ctxgroupbody";
  body.setAttribute("role", "group");
  build(body);
  details.append(summary, body);
  details.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(details.open));
    if (details.open){
      for (const sibling of parent.children){
        if (sibling === details || !sibling.classList || !sibling.classList.contains(className) || !sibling.open) continue;
        sibling.open = false;
        const siblingKey = sibling.getAttribute(className === "ctxsubmenu" ? "data-ctx-submenu" : "data-ctx-group");
        if (siblingKey) ctxDisclosureState.set(siblingKey, false);
      }
    }
    ctxDisclosureState.set(key, details.open);
    fitCtxMenu();
  });
  parent.appendChild(details);
  if (details.open){
    for (const sibling of parent.children){
      if (sibling === details || !sibling.classList || !sibling.classList.contains(className) || !sibling.open) continue;
      sibling.open = false;
      const siblingKey = sibling.getAttribute(className === "ctxsubmenu" ? "data-ctx-submenu" : "data-ctx-group");
      if (siblingKey) ctxDisclosureState.set(siblingKey, false);
    }
  }
  return details;
}
function ctxGroup(parent, key, label, build, opts = {}){
  return ctxDisclosure(parent, key, label, build, opts, "ctxgroup");
}
function ctxSubmenu(parent, key, label, build, opts = {}){
  return ctxDisclosure(parent, key, label, build, opts, "ctxsubmenu");
}
function ctxItem(parent, label, fn, opts = {}){
  const b = document.createElement("button");
  b.className = "ctxitem" + (opts.danger ? " danger" : "");
  b.setAttribute("role", "menuitem");
  if (opts.action) b.setAttribute("data-ctx-action", opts.action);
  if (opts.pressed != null) b.setAttribute("aria-pressed", String(!!opts.pressed));
  if (opts.disabled){
    b.disabled = true;
    b.setAttribute("aria-disabled", "true");
  }
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
  parent.appendChild(swatches(colors, current, apply, {
    context:true,
    open:true,
    persist:false
  }));
}
function ctxColorOverride(parent, colors, explicit, fallback, apply, reset, opts = {}){
  parent.appendChild(colorOverrideControl(colors, explicit, fallback, apply, reset, {
    ...opts,
    context:true,
    open:true,
    persist:false
  }));
}
/* compact font-size stepper for the context menu */
function ctxSizeRow(parent, n, targets = [n]){
  const isC = n.type === "concept", isNote = n.type === "note", isText = n.type === "text", isStatus = n.type === "status";
  const cur = nodeTextSize(n);
  const wrap = document.createElement("div");
  wrap.className = "swrow";
  wrap.appendChild(sizeStepper(cur, isC ? 9 : isNote || isText || isStatus ? 10 : 8, isText || isStatus ? 72 : isC ? 48 : 28, isC || isNote || isText || isStatus ? 1 : 0.5,
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

/* Toolbar dropdown commands share the context-menu mutation functions, but use
   a calmer desktop-menu hierarchy. Color and font-size controls intentionally
   remain in the inspector and right-click menus. */
function menuCommand(parent, label, fn, opts = {}){
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menucommand" + (opts.danger ? " dangerbtn" : "");
  button.setAttribute("role", "menuitem");
  if (opts.action) button.setAttribute("data-menu-action", opts.action);
  if (opts.pressed != null) button.setAttribute("aria-pressed", String(!!opts.pressed));
  if (opts.disabled){
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  }
  const text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
  if (opts.hint){
    const hint = document.createElement("kbd");
    hint.textContent = opts.hint;
    button.appendChild(hint);
  }
  button.addEventListener("click", fn);
  parent.appendChild(button);
  return button;
}
function menuSeparator(parent){
  const separator = document.createElement("div");
  separator.className = "menusep";
  separator.setAttribute("role", "separator");
  parent.appendChild(separator);
}
function menuLabel(parent, label){
  const heading = document.createElement("div");
  heading.className = "menulabel";
  heading.textContent = label;
  parent.appendChild(heading);
}
function menuSubmenu(parent, key, label, build, opts = {}){
  const details = document.createElement("details");
  details.className = "menusubmenu";
  details.setAttribute("data-menu-submenu", key);
  if (opts.disabled) details.classList.add("disabled");
  const summary = document.createElement("summary");
  summary.setAttribute("role", "menuitem");
  summary.setAttribute("aria-haspopup", "true");
  summary.setAttribute("aria-expanded", "false");
  if (opts.disabled) summary.setAttribute("aria-disabled", "true");
  const text = document.createElement("span");
  text.textContent = label;
  summary.append(text, disclosureChevron());
  const body = document.createElement("div");
  body.className = "menusubbody";
  body.setAttribute("role", "group");
  build(body);
  details.append(summary, body);
  details.addEventListener("toggle", () => {
    if (opts.disabled && details.open){ details.open = false; return; }
    summary.setAttribute("aria-expanded", String(details.open));
    if (!details.open) return;
    for (const sibling of parent.children){
      if (sibling !== details && sibling.classList && sibling.classList.contains("menusubmenu")) sibling.open = false;
    }
  });
  parent.appendChild(details);
  return details;
}
function menuContextHeader(parent, kind, title, count = 1){
  const header = document.createElement("div");
  header.className = "menucontext";
  header.appendChild(contextIcon(kind));
  const copy = document.createElement("div");
  const type = document.createElement("small");
  type.textContent = kind === "edge" ? "Link selected" : count > 1 ? `${count} nodes selected` : "Node selected";
  const name = document.createElement("strong");
  name.textContent = title || "Untitled";
  copy.append(type, name);
  header.appendChild(copy);
  parent.appendChild(header);
}
function menuControl(parent, label, control){
  const wrap = document.createElement("div");
  wrap.className = "menucontrol";
  const title = document.createElement("label");
  title.textContent = label;
  wrap.append(title, control);
  parent.appendChild(wrap);
  return wrap;
}
function nodeKindLabel(n){
  if (!n) return "Node";
  return n.type === "concept" ? "Concept" : n.type === "frame" ? "Frame"
    : n.type === "swimlane" ? "Swimlane" : n.type === "todo" ? "To-do list"
    : n.type === "note" ? "Rich note" : n.type === "text" ? "Plain text"
    : n.type === "status" ? "Status node" : "Table";
}
function buildNodeSelectionDropdown(panel, primary, targets){
  menuContextHeader(panel, "node", targets.length > 1 ? primary.title : `${nodeKindLabel(primary)} · ${primary.title || "Untitled"}`, targets.length);

  menuSubmenu(panel, "selection-content", "Content", body => {
    menuCommand(body, targets.length > 1 ? `Edit primary: ${primary.title || "Untitled"}`
      : primary.type === "text" || primary.type === "status" ? "Edit text" : "Edit title",
      () => startInlineEditor("node", primary.id), {hint:"↵", action:"edit-primary"});
    if (primary.type === "note")
      menuCommand(body, "Edit note content", () => { setSelection("node", primary.id); render(); focusNoteInput(); },
        {action:"edit-note-content"});
    if (!isStructuralNode(primary))
      menuCommand(body, "Add linked concept", addChildConcept, {hint:"Tab", action:"add-linked"});
  });

  if (primary.type === "table") menuSubmenu(panel, "selection-table", "Table tools", body => {
    menuCommand(body, "Add related table (1:N)", () => addRelatedTable(primary.id), {action:"add-related-table"});
    menuCommand(body, primary.collapsed ? "Expand fields" : "Collapse fields", () => {
      pushHistory(); primary.collapsed = !primary.collapsed; render();
    }, {action:"toggle-table-collapse"});
    menuCommand(body, "Add field", () => {
      pushHistory();
      primary.fields.push({id:uid(), name:"field_" + (primary.fields.length + 1),
        type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
      render();
    }, {action:"add-field"});
  });

  if (primary.type === "todo") menuSubmenu(panel, "selection-list", "List tools", body => {
    menuCommand(body, primary.collapsed ? "Expand items" : "Collapse items", () => {
      pushHistory(); primary.collapsed = !primary.collapsed; render();
    }, {action:"toggle-list-collapse"});
    menuCommand(body, "Add item", () => addTodoItem(primary), {action:"add-todo-item"});
  });

  if (primary.type === "frame") menuSubmenu(panel, "selection-frame", "Frame", body => {
    const frames = targets.filter(target => target.type === "frame");
    const next = primary.collapsed !== true;
    menuCommand(body, next ? "Collapse with contents" : "Expand with contents", () => {
      const changed = frames.filter(frame => (frame.collapsed === true) !== next);
      if (!changed.length) return;
      pushHistory();
      for (const frame of changed) setFrameCollapsed(frame, next, {history:false, select:false, render:false});
      render();
    }, {action:"toggle-frame-collapse"});
  });

  if (primary.type === "status") menuSubmenu(panel, "selection-status", "Status", body => {
    const statusTargets = targets.filter(target => target.type === "status");
    menuLabel(body, "Status label");
    for (const label of statusOptions()) menuCommand(body, label, () => {
      if (statusTargets.every(target => target.status === label)) return;
      pushHistory();
      for (const target of statusTargets) target.status = label;
      render();
    }, {pressed:primary.status === label, action:"status-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-")});
    menuSeparator(body);
    menuLabel(body, "Indicator side");
    for (const [side, label] of [["left","Left"],["right","Right"]]) menuCommand(body, label, () => {
      if (statusTargets.every(target => target.statusSide === side)) return;
      pushHistory();
      for (const target of statusTargets) target.statusSide = side;
      render();
    }, {pressed:primary.statusSide === side, action:"status-side-" + side});
  });

  if (primary.type === "concept" || primary.type === "text") menuSubmenu(panel, "selection-shape", "Shape", body => {
    const matching = targets.filter(target => target.type === primary.type);
    const options = primary.type === "text" ? TEXT_BOX_SHAPES : FLOWCHART_SHAPES;
    const current = primary.type === "text" ? textBoxShape(primary) : conceptShape(primary);
    for (const [shape, label] of options) menuCommand(body, label, () => {
      pushHistory(matching.length > 1 ? "shape:multi" : "shape:" + primary.id);
      for (const target of matching){
        if (target.type === "text") setTextBoxShape(target, shape); else setConceptShape(target, shape);
      }
      render();
    }, {pressed:current === shape, action:"shape-" + shape});
  });

  if (primary.type === "text" || primary.type === "status") menuSubmenu(panel, "selection-width", "Text box width", body => {
    const matching = targets.filter(target => target.type === primary.type);
    const minimum = primary.type === "status" ? 180 : 80;
    const fallback = primary.type === "status" ? STATUS_W_DEFAULT : TEXT_W_DEFAULT;
    const stepper = sizeStepper(primary.w || fallback, minimum, 720, 20, (value, commit) => {
      pushHistory(matching.length > 1 ? "menu-width:multi" : "menu-width:" + primary.id);
      for (const target of matching) target.w = value;
      drawOnly();
      if (commit) renderInspector();
    }, {ariaLabel:primary.type === "status" ? "Status node width" : "Maximum text width"});
    menuControl(body, "Width", stepper).setAttribute("data-menu-stay-open", "true");
  });

  if (primary.type === "swimlane") menuSubmenu(panel, "selection-orientation", "Orientation", body => {
    const lanes = targets.filter(target => target.type === "swimlane");
    for (const [orientation, label] of [["horizontal","Horizontal lane"],["vertical","Vertical lane"]])
      menuCommand(body, label, () => {
        const changed = lanes.filter(lane => swimlaneOrientation(lane) !== orientation);
        if (!changed.length) return;
        pushHistory(lanes.length > 1 ? "lane-orientation:multi" : "lane-orientation:" + primary.id);
        for (const lane of changed) setSwimlaneOrientation(lane, orientation);
        render();
      }, {pressed:swimlaneOrientation(primary) === orientation, action:"orientation-" + orientation});
  });
}
function buildEdgeSelectionDropdown(panel, edge){
  const from = nodeById(edge.from), to = nodeById(edge.to);
  menuContextHeader(panel, "edge", `${from ? from.title : "Unknown"} → ${to ? to.title : "Unknown"}`);
  const touchesLinkOnlyNode = linkOnlyNode(from) || linkOnlyNode(to);

  menuSubmenu(panel, "selection-relationship", "Relationship", body => {
    if (!touchesLinkOnlyNode){
      menuLabel(body, "Relation type");
      for (const [kind, label] of [["link","Link"],["1:1","1:1"],["1:N","1:N"],["N:M","N:M"]])
        menuCommand(body, label, () => {
          if (edge.kind === kind) return;
          pushHistory(); edge.kind = kind; render();
        }, {pressed:edge.kind === kind, action:"edge-kind-" + kind.replace(/[^a-z0-9]+/gi, "-")});
      menuSeparator(body);
    }
    menuControl(body, "Relationship label", edgeRelationshipSelect(edge));
  });

  menuSubmenu(panel, "selection-label", "Label", body => {
    menuCommand(body, "Edit label text", () => startInlineEditor("edge", edge.id), {hint:"↵", action:"edit-edge-label"});
  });

  menuSubmenu(panel, "selection-line", "Line", body => {
    menuLabel(body, "Arrowheads");
    for (const [key, label] of [["startArrow","Start arrow"],["endArrow","End arrow"]])
      menuCommand(body, label, () => {
        pushHistory(); setEdgeArrow(edge, key, !edge[key]); render();
      }, {pressed:edge[key] === true, action:key === "startArrow" ? "start-arrow" : "end-arrow"});
    menuSeparator(body);
    menuLabel(body, "Style");
    for (const [style, label] of [["solid","Solid"],["dash","Dashed"],["dot","Dotted"]])
      menuCommand(body, label, () => {
        if (edgeLineStyle(edge) === style) return;
        pushHistory(); edge.lineStyle = style; render();
      }, {pressed:edgeLineStyle(edge) === style, action:"line-style-" + style});
    menuSeparator(body);
    const width = sizeStepper(edgeLineWidth(edge), 1, 8, .5, (value, commit) => {
      pushHistory("menu-edge-width:" + edge.id);
      edge.lineWidth = value;
      drawOnly();
      if (commit) renderInspector();
    }, {ariaLabel:"Line width"});
    menuControl(body, "Line width", width).setAttribute("data-menu-stay-open", "true");
  });

  menuSubmenu(panel, "selection-routing", "Routing", body => {
    for (const [routing, label] of [["curve","Curved"],["ortho","Orthogonal"]]) menuCommand(body, label, () => {
      if ((edge.routing || "curve") === routing) return;
      pushHistory();
      if (routing === "ortho") edge.routing = "ortho";
      else {
        delete edge.routing;
        setOrthoCornerStyle(edge, "rounded");
      }
      render();
    }, {pressed:(edge.routing || "curve") === routing, action:"routing-" + routing});
    if (edge.routing === "ortho"){
      menuSeparator(body);
      menuLabel(body, "Corners");
      for (const [style, label] of [["rounded","Rounded"],["square","Square"]])
        menuCommand(body, label, () => {
          if (orthoCornerStyle(edge) === style) return;
          pushHistory();
          setOrthoCornerStyle(edge, style);
          render();
        }, {pressed:orthoCornerStyle(edge) === style, action:"ortho-corners-" + style});
      if (hasCustomOrthoBend(edge)){
        menuSeparator(body);
        menuCommand(body, "Reset waypoint to automatic", () => resetOrthoBend(edge), {action:"reset-waypoint"});
      }
    }
  });

  menuSeparator(panel);
  menuCommand(panel, "Swap direction", () => {
    pushHistory(); swapEdgeDirection(edge); render();
  }, {action:"swap-edge"});
}
function setMenuDisabled(id, disabled){
  const control = document.getElementById(id);
  if (!control) return;
  control.disabled = !!disabled;
  control.setAttribute("aria-disabled", String(!!disabled));
}
function setMenuSubmenuDisabled(key, disabled){
  const submenu = document.querySelector(`#arrangeMenu [data-menu-submenu="${key}"]`);
  if (!submenu) return;
  submenu.classList.toggle("disabled", !!disabled);
  const summary = submenu.querySelector(":scope > summary");
  if (summary) summary.setAttribute("aria-disabled", String(!!disabled));
  if (disabled) submenu.open = false;
}
function updateDropdownMenus(){
  const nodeIds = selectionIds("node");
  const edgeIds = selectionIds("edge");
  const hasNodeSelection = nodeIds.length > 0;
  const hasSelection = hasNodeSelection || edgeIds.length > 0;
  const nodes = hasNodeSelection ? selectedNodes() : [];
  const primaryNode = nodes[0] || null;
  const primaryEdge = edgeIds.length ? edgeById(edgeIds[0]) : null;

  setMenuDisabled("menuUndo", !undoStack.length);
  setMenuDisabled("menuRedo", !redoStack.length);
  setMenuDisabled("menuCut", !hasNodeSelection);
  setMenuDisabled("menuCopy", !hasNodeSelection);
  setMenuDisabled("menuPaste", !(clipboardData && clipboardData.nodes && clipboardData.nodes.length));
  setMenuDisabled("menuDuplicate", !hasNodeSelection);
  setMenuDisabled("menuDelete", !hasSelection);

  const multi = nodes.length >= 2;
  for (const id of ["btnAlignTop","btnAlignMiddle","btnAlignBottom","btnAlignLeft","btnAlignCenter","btnAlignRight",
                    "menuDistributeHorizontal","menuDistributeVertical","menuWidthSmallest","menuWidthLargest","menuWidthAverage"])
    setMenuDisabled(id, !multi);
  setMenuDisabled("menuResetSize", !nodes.some(hasForcedNodeSize));
  setMenuDisabled("menuBringFront", !primaryNode);
  setMenuDisabled("menuSendBack", !primaryNode);
  setMenuSubmenuDisabled("align", !multi);
  setMenuSubmenuDisabled("distribute", !multi);
  setMenuSubmenuDisabled("size", !hasNodeSelection);
  setMenuSubmenuDisabled("layer", !primaryNode);

  const inspector = document.getElementById("menuInspector");
  const theme = document.getElementById("menuTheme");
  if (inspector) inspector.setAttribute("aria-pressed", String(inspectorPinned));
  if (theme) theme.setAttribute("aria-pressed", String(docTheme === "dark"));

  const selectionButton = document.getElementById("btnSelectionMenu");
  const selectionPanel = document.getElementById("selectionMenuPanel");
  if (!selectionButton || !selectionPanel) return;
  selectionButton.disabled = !hasSelection;
  selectionButton.setAttribute("aria-disabled", String(!hasSelection));
  selectionPanel.innerHTML = "";
  if (primaryNode) buildNodeSelectionDropdown(selectionPanel, primaryNode, nodes);
  else if (primaryEdge) buildEdgeSelectionDropdown(selectionPanel, primaryEdge);
  else {
    const empty = document.createElement("div");
    empty.className = "menuempty";
    empty.textContent = "Select a node or link to see its commands.";
    selectionPanel.appendChild(empty);
    const menu = document.getElementById("selectionMenu");
    if (menu){ menu.classList.remove("open"); selectionButton.setAttribute("aria-expanded", "false"); }
  }
}

function nodeMenu(n, x, y){
  const targets = isSelected("node", n.id) ? selectedNodes() : [n];
  const applyToTargets = (fn) => {
    for (const t of targets) fn(t);
  };
  showCtx(x, y, m => {
    ctxHeader(m, "node", targets.length > 1 ? `${targets.length} nodes selected` : n.title || "Untitled");
    ctxGroup(m, "node:content", "Content", panel => {
      ctxItem(panel, n.type === "text" || n.type === "status" ? "Edit text" : "Edit title",
        () => startInlineEditor("node", n.id), {kbd:"dbl-click"});
      if (n.type === "note")
        ctxItem(panel, "Edit note content", () => { setSelection("node", n.id); render(); focusNoteInput(); });
      if (!isStructuralNode(n))
        ctxItem(panel, "Add linked concept", addChildConcept, {kbd:"Tab"});
      if (n.type === "table") ctxSubmenu(panel, "node:content:table", "Table tools", sub => {
        ctxItem(sub, "Add related table (1:N)", () => addRelatedTable(n.id));
        ctxItem(sub, n.collapsed ? "Expand fields" : "Collapse fields", () => {
          pushHistory();
          n.collapsed = !n.collapsed;
          render();
        });
        ctxItem(sub, "Add field", () => {
          pushHistory();
          n.fields.push({id: uid(), name:"field_" + (n.fields.length+1),
                         type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
          render();
        });
      });
      if (n.type === "todo") ctxSubmenu(panel, "node:content:todo", "List tools", sub => {
        ctxItem(sub, n.collapsed ? "Expand items" : "Collapse items", () => {
          pushHistory();
          n.collapsed = !n.collapsed;
          render();
        });
        ctxItem(sub, "Add item", () => addTodoItem(n));
      });
      if (n.type === "frame") ctxSubmenu(panel, "node:content:frame", "Frame", sub => {
        const frames = targets.filter(target => target.type === "frame");
        const next = n.collapsed !== true;
        ctxItem(sub, next ? "Collapse with contents" : "Expand with contents", () => {
          const changed = frames.filter(frame => (frame.collapsed === true) !== next);
          if (!changed.length) return;
          pushHistory();
          for (const frame of changed) setFrameCollapsed(frame, next, {history:false, select:false, render:false});
          render();
        }, {action:"toggle-frame-collapse"});
      });
      if (n.type === "status") ctxSubmenu(panel, "node:content:status", "Status", sub => {
        const statusTargets = targets.filter(target => target.type === "status");
        ctxLabel(sub, "Status label");
        for (const label of statusOptions()){
          ctxItem(sub, (n.status === label ? "✓ " : "") + label, () => {
            if (statusTargets.every(target => target.status === label)) return;
            pushHistory();
            for (const target of statusTargets) target.status = label;
            render();
          }, {action:"status-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-")});
        }
        ctxSep(sub);
        ctxLabel(sub, "Indicator side");
        for (const [side, label] of [["left","Left"],["right","Right"]]){
          ctxItem(sub, (n.statusSide === side ? "✓ " : "") + label, () => {
            if (statusTargets.every(target => target.statusSide === side)) return;
            pushHistory();
            for (const target of statusTargets) target.statusSide = side;
            render();
          }, {action:"status-side-" + side});
        }
      });
    });
    ctxGroup(m, "node:appearance", "Appearance", panel => {
      const palette = [...new Set([...conceptColors(), ...tableColors()])];
      const fillLabel = n.type === "swimlane" ? "Body background" : n.type === "text" ? "Shape background"
        : n.type === "status" ? "Background"
        : n.type === "concept" ? "Fill color" : n.type === "frame" ? "Frame color"
        : n.type === "todo" ? "List color" : n.type === "note" ? "Note color" : "Header color";
      ctxSubmenu(panel, "node:appearance:fill", fillLabel, sub => {
        ctxSwatches(sub, n.type === "swimlane" ? palette
          : (n.type === "concept" || n.type === "text" || n.type === "status" || n.type === "todo" || n.type === "note")
            ? conceptColors() : tableColors(), n.color,
          (c, commit) => {
            pushHistory(targets.length > 1 ? "color:multi" : "color:"+n.id);
            applyToTargets(t => { t.color = c; });
            commit ? render() : drawOnly();
          });
      });
      if (n.type === "swimlane"){
        ctxSubmenu(panel, "node:appearance:lane-title", "Title background", sub => {
          ctxSwatches(sub, palette, n.titleColor || SWIMLANE_DEFAULT.titleColor,
            (c, commit) => {
              pushHistory(targets.length > 1 ? "lane-title:multi" : "lane-title:"+n.id);
              applyToTargets(t => { if (t.type === "swimlane") t.titleColor = c; });
              commit ? render() : drawOnly();
            });
        });
      }
      if (n.type === "concept" || n.type === "text"){
        ctxSubmenu(panel, "node:appearance:shape", "Shape", sub => ctxShapeRow(sub, n, targets));
      }
      if (!isStructuralNode(n)){
        ctxSubmenu(panel, "node:appearance:text", "Text", sub => {
          if (n.type === "text" || n.type === "status"){
            ctxLabel(sub, n.type === "status" ? "Width" : "Maximum width");
            const widthRow = document.createElement("div");
            widthRow.className = "swrow";
            widthRow.appendChild(sizeStepper(n.w || (n.type === "status" ? STATUS_W_DEFAULT : TEXT_W_DEFAULT),
              n.type === "status" ? 180 : 80, 720, 20,
              (v, commit) => {
                pushHistory(targets.length > 1 ? "size:multi" : "size:"+n.id);
                applyToTargets(t => { if (t.type === n.type) t.w = v; });
                commit ? render() : drawOnly();
              }, {ariaLabel:n.type === "status" ? "Status node width" : "Maximum width"}));
            sub.appendChild(widthRow);
          }
          ctxLabel(sub, "Text size");
          ctxSizeRow(sub, n, targets);
          ctxLabel(sub, "Text color");
          ctxSwatches(sub, fontColors(), n.fontColor || "#16232F",
            (c, commit) => {
              pushHistory(targets.length > 1 ? "fc:multi" : "fc:"+n.id);
              applyToTargets(t => { t.fontColor = c; });
              commit ? render() : drawOnly();
            });
        });
      }
      if (n.type === "swimlane") ctxSubmenu(panel, "node:appearance:orientation", "Orientation", sub => {
        for (const [orientation, label] of [["horizontal","Horizontal lane"],["vertical","Vertical lane"]]){
          ctxItem(sub, (swimlaneOrientation(n) === orientation ? "✓ " : "") + label, () => {
            const lanes = targets.filter(t => t.type === "swimlane" && swimlaneOrientation(t) !== orientation);
            if (!lanes.length) return;
            pushHistory(targets.length > 1 ? "lane-orientation:multi" : "lane-orientation:"+n.id);
            for (const lane of lanes) setSwimlaneOrientation(lane, orientation);
            render();
          });
        }
      });
    });
    ctxGroup(m, "node:arrange", "Arrange", panel => {
      ctxSubmenu(panel, "node:arrange:size", "Size", sub => {
        ctxItem(sub, "Reset size", resetSelectionSizes,
          {action:"reset-size", disabled:!targets.some(hasForcedNodeSize)});
        if (targets.length >= 2){
          ctxSep(sub);
          ctxLabel(sub, "Match selected widths");
          ctxItem(sub, "Scale to smallest", () => matchSelectionWidths("smallest"),
            {action:"width-smallest"});
          ctxItem(sub, "Scale to largest", () => matchSelectionWidths("largest"),
            {action:"width-largest"});
          ctxItem(sub, "Scale to average", () => matchSelectionWidths("average"),
            {action:"width-average"});
        }
      });
      if (targets.length >= 2){
        ctxSubmenu(panel, "node:arrange:align", "Align", sub => {
          ctxItem(sub, "Align left", () => alignSelection("left"));
          ctxItem(sub, "Align right", () => alignSelection("right"));
          ctxItem(sub, "Align top", () => alignSelection("top"));
          ctxItem(sub, "Align bottom", () => alignSelection("bottom"));
          ctxItem(sub, "Center horizontally", () => alignSelection("centerX"));
          ctxItem(sub, "Center vertically", () => alignSelection("centerY"));
        });
        ctxSubmenu(panel, "node:arrange:distribute", "Distribute", sub => {
          ctxItem(sub, "Distribute horizontally", () => alignSelection("distributeX"));
          ctxItem(sub, "Distribute vertically", () => alignSelection("distributeY"));
        });
      }
      ctxSubmenu(panel, "node:arrange:layer", "Layer order", sub => {
        ctxItem(sub, "Bring to front", () => reorderNode(n.id, true));
        ctxItem(sub, "Send to back",   () => reorderNode(n.id, false));
      });
    });
    ctxGroup(m, "node:actions", "Actions", panel => {
      ctxItem(panel, "Duplicate", duplicateSelection, {kbd:"Ctrl+D"});
      ctxItem(panel, targets.length > 1 ? "Delete selected nodes" : "Delete node",
        deleteSelection, {kbd:"Del", danger:true});
    });
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
    });
    ctxGroup(m, "edge:label", "Label", panel => {
      ctxItem(panel, "Edit label text", () => startInlineEditor("edge", e.id), {kbd:"dbl-click"});
      ctxSubmenu(panel, "edge:label:text-color", "Text color", sub => {
        ctxColorOverride(sub, fontColors(), e.labelTextColor, edgeLineColor(e),
          (c, commit) => {
            pushHistory("edge-label-text:"+e.id);
            e.labelTextColor = c;
            commit ? render() : drawOnly();
          }, () => {
            pushHistory();
            delete e.labelTextColor;
            render();
          }, {inheritLabel:"link color", action:"inherit-label-text", key:"label-text"});
      });
      ctxSubmenu(panel, "edge:label:background", "Background color", sub => {
        ctxColorOverride(sub, conceptColors(), e.labelBackgroundColor, themeColors().labelBg,
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
    });
    ctxGroup(m, "edge:line", "Line", panel => {
      ctxSubmenu(panel, "edge:line:arrows", "Arrowheads", sub => {
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
        sub.appendChild(arrowRow);
      });
      ctxSubmenu(panel, "edge:line:style", "Style and width", sub => {
        ctxLabel(sub, "Style");
        const styleRow = document.createElement("div");
        styleRow.className = "swrow";
        styleRow.appendChild(edgeStyleSelect(e, null, {close:hideCtx}));
        sub.appendChild(styleRow);
        ctxLabel(sub, "Width");
        const widthRow = document.createElement("div");
        widthRow.className = "swrow";
        widthRow.appendChild(sizeStepper(edgeLineWidth(e), 1, 8, .5,
          (v, commit) => {
            pushHistory("edge-width:"+e.id);
            e.lineWidth = v;
            if (commit){ hideCtx(); render(); } else drawOnly();
          }, {ariaLabel:"Line width"}));
        sub.appendChild(widthRow);
      });
      ctxSubmenu(panel, "edge:line:color", "Color", sub => {
        ctxSwatches(sub, tableColors(), edgeLineColor(e),
          (c, commit) => {
            pushHistory("edge-color:"+e.id);
            e.lineColor = c;
            commit ? render() : drawOnly();
          });
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
          if (k === "ortho") e.routing = "ortho";
          else {
            delete e.routing;
            setOrthoCornerStyle(e, "rounded");
          }
          render();
        });
        routeRow.appendChild(button);
      }
      panel.appendChild(routeRow);
      if (e.routing === "ortho"){
        ctxLabel(panel, "Corners");
        const cornerRow = document.createElement("div");
        cornerRow.className = "kindrow";
        for (const [value, label] of [["rounded","Rounded"],["square","Square"]]){
          const button = document.createElement("button");
          button.textContent = label;
          if (orthoCornerStyle(e) === value) button.className = "on";
          button.addEventListener("click", () => {
            hideCtx();
            if (orthoCornerStyle(e) === value) return;
            pushHistory();
            setOrthoCornerStyle(e, value);
            render();
          });
          cornerRow.appendChild(button);
        }
        panel.appendChild(cornerRow);
        ctxLabel(panel, "Waypoint");
        const note = document.createElement("div");
        note.className = "ctxhint";
        note.textContent = "Drag the square handle on the canvas; each axis snaps independently.";
        panel.appendChild(note);
        if (hasCustomOrthoBend(e)) ctxItem(panel, "Reset to automatic", () => resetOrthoBend(e));
      }
    });
    ctxGroup(m, "edge:actions", "Actions", panel => {
      ctxItem(panel, "Swap direction", () => {
        pushHistory();
        swapEdgeDirection(e);
        render();
      });
      ctxItem(panel, "Delete edge", deleteSelection, {kbd:"Del", danger:true});
    });
  });
}
function canvasMenu(w, x, y){
  showCtx(x, y, m => {
    ctxHeader(m, "canvas", "Create, arrange, or view");
    ctxGroup(m, "canvas:create", "Create", panel => {
      ctxSubmenu(panel, "canvas:create:nodes", "Nodes and data", sub => {
        ctxItem(sub, "Concept", () => addNodeCentered("concept", w), {kbd:"C", action:"add-concept"});
        ctxItem(sub, "Status", () => addNodeCentered("status", w), {kbd:"S", action:"add-status"});
        ctxItem(sub, "Table", () => addNodeCentered("table", w), {kbd:"T", action:"add-table"});
        ctxItem(sub, "To-do list", () => addNodeCentered("todo", w), {kbd:"D", action:"add-todo"});
      });
      ctxSubmenu(panel, "canvas:create:text", "Text and notes", sub => {
        ctxItem(sub, "Plain text", () => addNodeCentered("text", w), {kbd:"X", action:"add-text"});
        ctxItem(sub, "Rich note", () => addNodeCentered("note", w), {kbd:"N", action:"add-note"});
      });
      ctxSubmenu(panel, "canvas:create:containers", "Containers", sub => {
        ctxItem(sub, "Frame", () => addNodeCentered("frame", w), {action:"add-frame"});
        ctxItem(sub, "Horizontal swimlane", () => addNodeCentered("swimlane", w, {orientation:"horizontal"}), {action:"add-horizontal-lane"});
        ctxItem(sub, "Vertical swimlane", () => addNodeCentered("swimlane", w, {orientation:"vertical"}), {action:"add-vertical-lane"});
      });
    });
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
