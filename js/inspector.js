"use strict";

/* -------------------------- Inspector ----------------------------- */
const inspBody = document.getElementById("inspBody");
const inspTitle = document.getElementById("inspTitle");
let inspectorMount = inspBody;

function appendInspector(node){
  inspectorMount.appendChild(node);
  return node;
}

function focusTitleInput(){
  const n = singleSelectedNode();
  if (n) openInspectorSection(n.type + ":basics");
  requestAnimationFrame(() => {
    const i = document.getElementById("titleInput");
    if (i){ i.focus(); i.select(); }
  });
}
function focusNoteInput(){
  openInspectorSection("note:content");
  requestAnimationFrame(() => {
    const i = document.getElementById("noteContentInput");
    if (i) i.focus();
  });
}
function focusEdgeLabelInput(){
  openInspectorSection("edge:label");
  requestAnimationFrame(() => {
    const i = document.getElementById("edgeLabelInput");
    if (i){ i.focus(); i.select(); }
  });
}
function edgeRelationshipValue(label){
  return EDGE_RELATIONSHIPS.some(([name]) => name === label) ? label : EDGE_CUSTOM_RELATIONSHIP;
}
function edgeRelationshipSelect(e, opts = {}){
  const s = document.createElement("select");
  s.setAttribute("aria-label", "Edge relationship");
  s.setAttribute("data-edge-relationship", e.id);
  if (opts.id) s.id = opts.id;
  const custom = document.createElement("option");
  custom.value = EDGE_CUSTOM_RELATIONSHIP;
  custom.textContent = "Custom text";
  custom.title = "Use any custom edge label";
  s.appendChild(custom);
  for (const [name, meaning] of EDGE_RELATIONSHIPS){
    const o = document.createElement("option");
    o.value = name;
    o.textContent = `${name} — ${meaning}`;
    o.title = meaning;
    s.appendChild(o);
  }
  s.value = edgeRelationshipValue(e.label);
  s.addEventListener("change", () => {
    const next = s.value;
    pushHistory();
    if (next === EDGE_CUSTOM_RELATIONSHIP){
      if (edgeRelationshipValue(e.label) !== EDGE_CUSTOM_RELATIONSHIP) e.label = "";
    } else e.label = next;
    if (opts.close) opts.close();
    render();
    if (next === EDGE_CUSTOM_RELATIONSHIP && opts.onCustom) opts.onCustom();
  });
  return s;
}
function setEdgeArrow(e, key, on){
  if (on) e[key] = true;
  else delete e[key];
}
function edgeStyleSelect(e, id, opts = {}){
  const s = document.createElement("select");
  s.setAttribute("aria-label", "Line style");
  if (id) s.id = id;
  for (const [value, label] of [["solid","Solid"],["dash","Dashed"],["dot","Dotted"]]){
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    if (edgeLineStyle(e) === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => {
    pushHistory();
    e.lineStyle = s.value;
    if (opts.close) opts.close();
    render();
  });
  return s;
}

const inspectorDisclosureState = new Map();
function openInspectorSection(key){
  const details = document.querySelector(`[data-inspector-section="${key}"]`);
  if (!details) return false;
  details.open = true;
  inspectorDisclosureState.set(key, true);
  return true;
}
function disclosureChevron(){
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("disclosure-chevron");
  const path = document.createElementNS(SVGNS, "path");
  path.setAttribute("d", "M4 6l4 4 4-4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}
function setInspectorHeader(kind, name, opts = {}){
  inspTitle.innerHTML = "";
  const type = document.createElement("span");
  type.className = "inspector-kind";
  type.textContent = kind;
  inspTitle.appendChild(type);
  if (name){
    const row = document.createElement("span");
    row.className = "inspector-name-row";
    if (opts.kind === "edge") row.appendChild(contextIcon("edge"));
    else if (opts.kind === "node"){
      const mark = document.createElement("span");
      mark.className = "inspector-object-mark";
      mark.style.background = opts.color || "transparent";
      row.appendChild(mark);
    }
    const title = document.createElement("span");
    title.className = "inspector-name";
    title.textContent = name;
    row.appendChild(title);
    inspTitle.appendChild(row);
  }
}
function inspectorSection(key, title, build, opts = {}){
  const details = document.createElement("details");
  details.className = "inspector-section";
  details.setAttribute("data-inspector-section", key);
  const stored = inspectorDisclosureState.get(key);
  details.open = stored == null ? opts.open !== false : stored;
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = title;
  summary.append(label, disclosureChevron());
  const body = document.createElement("div");
  body.className = "inspector-section-body";
  details.append(summary, body);
  appendInspector(details);
  const previous = inspectorMount;
  inspectorMount = body;
  try { build(); } finally { inspectorMount = previous; }
  details.addEventListener("toggle", () => inspectorDisclosureState.set(key, details.open));
  return details;
}
function inspectorActions(buttons, danger, opts = {}){
  const footer = document.createElement("div");
  footer.className = "inspector-actions";
  if (buttons.length || opts.inlineDanger){
    const row = document.createElement("div");
    row.className = "rowbtns";
    for (const button of buttons) row.appendChild(button);
    if (danger && opts.inlineDanger) row.appendChild(danger);
    footer.appendChild(row);
  }
  if (danger && !opts.inlineDanger) footer.appendChild(danger);
  appendInspector(footer);
}
function renderNodeTitleField(n){
  frow(n.type === "table" ? "Table name" : n.type === "text" ? "Text" : "Title", () => {
    const update = v => {
      n.title = v;
      const headerName = document.querySelector("#inspTitle .inspector-name");
      if (headerName) headerName.textContent = v;
      drawOnly();
    };
    const multiline = nodeTitleSupportsLineBreaks(n);
    const i = multiline ? document.createElement("textarea") : mkInput(n.title, update);
    if (multiline){
      i.value = n.title || "";
      i.rows = 2;
      i.setAttribute("aria-label", "Node text; Shift+Enter inserts a new line");
      i.addEventListener("focus", pushHistoryOnce());
      i.addEventListener("input", () => update(i.value));
      i.addEventListener("keydown", ev => {
        if (ev.key === "Enter" && ev.shiftKey){
          ev.preventDefault();
          insertTextLineBreak(i);
        } else if (ev.key === "Enter"){
          ev.preventDefault();
          i.blur();
        }
      });
    }
    i.id = "titleInput";
    if (n.type === "table"){
      let prev = n.title;
      i.addEventListener("focus", () => { prev = n.title; });
      i.addEventListener("blur", () => {
        if (tableNameConflict(n, n.title)){
          showNoticeModal("Duplicate table name",
            `A table named "${ident(n.title)}" already exists. Table names must be unique.`);
          n.title = prev;
          i.value = prev;
          const headerName = document.querySelector("#inspTitle .inspector-name");
          if (headerName) headerName.textContent = prev;
          drawOnly();
        }
      });
    }
    return i;
  });
}
function renderNodeNotesField(n){
  frow("Notes", () => {
    const t = document.createElement("textarea");
    t.value = n.notes || "";
    t.placeholder = "Add notes…";
    t.addEventListener("focus", pushHistoryOnce());
    t.addEventListener("input", () => { n.notes = t.value; drawOnly(); });
    return t;
  });
}

function renderInspector(){
  updateInspectorVisibility();
  inspBody.innerHTML = "";
  inspectorMount = inspBody;
  if (!sel){ setInspectorHeader("Inspector"); renderHelp(); return; }

  if (sel.kind === "node"){
    if (selectionCount("node") > 1){ renderMultiInspector(); return; }
    const n = singleSelectedNode();
    if (!n){ clearSelection(); renderHelp(); return; }
    const kind = n.type === "concept" ? "Concept node" : n.type === "frame" ? "Frame" : n.type === "swimlane" ? "Swimlane"
               : n.type === "todo" ? "To-do list" : n.type === "note" ? "Rich note"
               : n.type === "text" ? "Plain text" : "Table node";
    setInspectorHeader(kind, n.title, {kind:"node", color:n.color || themeColors().ink});

    if (n.type === "swimlane"){
      inspectorSection("swimlane:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Orientation", () => {
          const s = document.createElement("select");
          s.id = "swimlaneOrientation";
          for (const [value, label] of [["horizontal","Horizontal lane"],["vertical","Vertical lane"]]){
            const o = document.createElement("option");
            o.value = value; o.textContent = label; o.selected = swimlaneOrientation(n) === value;
            s.appendChild(o);
          }
          s.addEventListener("change", () => {
            if (s.value === swimlaneOrientation(n)) return;
            pushHistory();
            setSwimlaneOrientation(n, s.value);
            render();
          });
          return s;
        });
      });
      inspectorSection("swimlane:appearance", "Appearance", () => {
        const palette = [...new Set([...conceptColors(), ...tableColors()])];
        frow("Body background", () => {
          const control = swatches(palette, n.color || SWIMLANE_DEFAULT.bodyColor,
            (c, commit) => { pushHistory("lane-body:"+n.id); n.color = c; commit ? render() : drawOnly(); });
          control.id = "swimlaneBodyColor";
          return control;
        });
        frow("Title background", () => {
          const control = swatches(palette, n.titleColor || SWIMLANE_DEFAULT.titleColor,
            (c, commit) => { pushHistory("lane-title:"+n.id); n.titleColor = c; commit ? render() : drawOnly(); });
          control.id = "swimlaneTitleColor";
          return control;
        });
      });
      inspectorSection("swimlane:size", "Size", () => {
        const orientation = swimlaneOrientation(n);
        frow("Width", () => sizeStepper(nodeSize(n).w, orientation === "vertical" ? 120 : 260, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow("Height", () => sizeStepper(nodeSize(n).h, orientation === "vertical" ? 260 : 100, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.h = v; commit ? render() : drawOnly(); }));
      });
    } else if (n.type === "frame"){
      inspectorSection("frame:basics", "Basics", () => renderNodeTitleField(n));
      inspectorSection("frame:appearance", "Appearance", () => {
        frow("Color", () => swatches(tableColors(), n.color || frameColorDefault(),
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("frame:size", "Size", () => {
        frow("Width", () => sizeStepper(n.w || FRAME_DEFAULT.w, 120, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow("Height", () => sizeStepper(n.h || FRAME_DEFAULT.h, 90, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.h = v; commit ? render() : drawOnly(); }));
      });
    } else if (n.type === "concept"){
      inspectorSection("concept:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Shape", () => {
          const s = document.createElement("select");
          s.setAttribute("aria-label", "Flowchart shape");
          for (const [value, label] of FLOWCHART_SHAPES){
            const o = document.createElement("option");
            o.value = value; o.textContent = label;
            if (conceptShape(n) === value) o.selected = true;
            s.appendChild(o);
          }
          s.addEventListener("change", () => { pushHistory(); setConceptShape(n, s.value); render(); });
          return s;
        });
      });
      inspectorSection("concept:appearance", "Appearance", () => {
        frow("Color", () => swatches(conceptColors(), n.color,
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(conceptFont(n), 9, 48, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("concept:notes", "Notes", () => renderNodeNotesField(n), {open:false});
    } else if (n.type === "text"){
      inspectorSection("text:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Shape", () => {
          const s = document.createElement("select");
          s.id = "textBoxShape";
          s.setAttribute("aria-label", "Text box shape");
          for (const [value, label] of TEXT_BOX_SHAPES){
            const o = document.createElement("option");
            o.value = value; o.textContent = label;
            if (textBoxShape(n) === value) o.selected = true;
            s.appendChild(o);
          }
          s.addEventListener("change", () => { pushHistory(); setTextBoxShape(n, s.value); render(); });
          return s;
        });
        if (textBoxShape(n) === "none"){
          const help = document.createElement("div");
          help.className = "helper";
          help.textContent = "No box shows only the text. The dashed outline appears only while selected.";
          appendInspector(help);
        }
      });
      inspectorSection("text:appearance", "Appearance", () => {
        frow("Shape background", () => {
          const control = swatches(conceptColors(), n.color || conceptColors()[1],
            (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); });
          control.id = "textBoxBackground";
          return control;
        });
        frow("Text size", () => sizeStepper(textBoxFont(n), 10, 72, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); },
          {ariaLabel:"Text size"}));
        frow("Text color", () => {
          const control = swatches(fontColors(), n.fontColor || themeColors().ink,
            (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); });
          control.id = "textBoxTextColor";
          return control;
        });
      });
      inspectorSection("text:layout", "Layout", () => {
        frow("Maximum width", () => sizeStepper(n.w || TEXT_W_DEFAULT, 80, 720, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); },
          {ariaLabel:"Maximum width"}));
      });
    } else if (n.type === "note"){
      inspectorSection("note:basics", "Basics", () => renderNodeTitleField(n));
      inspectorSection("note:content", "Content", () => {
        frow("Markdown", () => {
          const t = document.createElement("textarea");
          t.id = "noteContentInput";
          t.rows = 10;
          t.value = n.content || "";
          t.placeholder = "Write a note…";
          t.addEventListener("focus", pushHistoryOnce());
          t.addEventListener("input", () => { n.content = t.value; drawOnly(); });
          return t;
        });
        const help = document.createElement("div");
        help.className = "helper";
        help.textContent = "Formatting: # heading, - bullet, - [ ] task, **bold**, _italic_, and `code`.";
        appendInspector(help);
      });
      inspectorSection("note:appearance", "Appearance", () => {
        frow("Color", () => swatches(conceptColors(), n.color || conceptColors()[0],
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Width", () => sizeStepper(n.w || NOTE_W_DEFAULT, 220, 720, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(noteFont(n), 10, 28, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
    } else if (n.type === "todo"){
      inspectorSection("todo:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("List display", () => mkFlag(n.collapsed ? "COLLAPSED" : "EXPANDED", !!n.collapsed,
          v => { n.collapsed = v; render(); }));
      });
      inspectorSection("todo:appearance", "Appearance", () => {
        frow("Color", () => swatches(conceptColors(), n.color || todoColorDefault(),
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("todo:notes", "Notes", () => renderNodeNotesField(n), {open:false});
      inspectorSection("todo:items", "Items", () => renderItemEditor(n));
    } else {
      inspectorSection("table:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Field display", () => mkFlag(n.collapsed ? "COLLAPSED" : "EXPANDED", !!n.collapsed,
          v => { n.collapsed = v; render(); }));
      });
      inspectorSection("table:appearance", "Appearance", () => {
        frow("Header color", () => swatches(tableColors(), n.color,
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(tableMetrics(n).base, 8, 28, 0.5,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); }));
        frow("Text color", () => swatches(fontColors(), n.fontColor || "#16232F",
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("table:notes", "Notes", () => renderNodeNotesField(n), {open:false});
      inspectorSection("table:fields", "Fields", () => renderFieldEditor(n));
    }

    const actions = [mkBtn("Duplicate", duplicateSelection)];
    if (!isStructuralNode(n)) actions.push(mkBtn("Add linked concept  ⇥", addChildConcept));
    inspectorActions(actions, mkBtn("Delete node", deleteSelection, "dangerbtn"));

  } else {
    const e = singleSelectedEdge();
    if (!e){ clearSelection(); renderHelp(); return; }
    const a = nodeById(e.from), b = nodeById(e.to);
    setInspectorHeader("Edge", `${a.title} → ${b.title}`, {kind:"edge"});
    const touchesLinkOnlyNode = linkOnlyNode(a) || linkOnlyNode(b);
    const endName = (n, fid) => {
      const rows = fid ? nodeRows(n) : null;
      const f = rows ? rows.find(x => x.id === fid) : null;
      return escapeHtml(n.title) + (f ? "<span style='font-family:var(--mono);font-size:11px'>." + escapeHtml(f.name || f.text || f.id) + "</span>" : "");
    };
    const p = document.createElement("div");
    p.className = "helper";
    p.innerHTML = `<b>${endName(a, e.fromField)}</b> → <b>${endName(b, e.toField)}</b>` +
      (e.kind !== "link" ? `<br>Convention: <em>from</em> = the “one” side, <em>to</em> = the “many” side.` : "");
    inspectorSection("edge:connection", "Connection", () => {
      appendInspector(p);
      if (!touchesLinkOnlyNode) frow("Type", () => {
      const s = document.createElement("select");
      for (const k of ["link","1:1","1:N","N:M"]){
        const o = document.createElement("option");
        o.value = k; o.textContent = k === "link" ? "link (mind map)" : k + " (relation)";
        if (e.kind === k) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener("change", () => { pushHistory(); e.kind = s.value; render(); });
        return s;
      });
      frow("Routing", () => {
      const s = document.createElement("select");
      for (const k of ["curve","ortho"]){
        const o = document.createElement("option");
        o.value = k; o.textContent = k === "curve" ? "curved" : "orthogonal";
        if ((e.routing || "curve") === k) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener("change", () => {
        pushHistory();
        if (s.value === "ortho") e.routing = "ortho";
        else delete e.routing;
        render();
      });
        return s;
      });
      if (e.routing === "ortho"){
        const helper = document.createElement("div");
        helper.className = "helper";
        helper.textContent = "Drag the square waypoint on the canvas. It snaps to this link’s endpoint, stub, and midpoint coordinates.";
        appendInspector(helper);
        frow("Waypoint", () => {
          const button = mkBtn("Reset to automatic", () => resetOrthoBend(e));
          button.id = "edgeResetOrthoBend";
          button.disabled = !hasCustomOrthoBend(e);
          return button;
        });
      }
      if (a.type === "table" && b.type === "table" && e.kind !== "link") renderPairEditor(a, b, e);
      else renderEdgeEndControls(a, b, e);
    });
    inspectorSection("edge:appearance", "Appearance", () => {
      frow("Arrows", () => {
      const row = document.createElement("div");
      row.className = "edgearrowrow";
      const start = mkFlag("START", !!e.startArrow, on => { setEdgeArrow(e, "startArrow", on); render(); });
      const end = mkFlag("END", !!e.endArrow, on => { setEdgeArrow(e, "endArrow", on); render(); });
      start.id = "edgeStartArrow"; end.id = "edgeEndArrow";
      start.setAttribute("aria-label", "Toggle start arrow");
      end.setAttribute("aria-label", "Toggle end arrow");
      row.append(start, end);
        return row;
      });
      frow("Line style", () => edgeStyleSelect(e, "edgeLineStyle"));
      frow("Line width", () => sizeStepper(edgeLineWidth(e), 1, 8, .5,
        (v, commit) => {
          pushHistory("edge-width:"+e.id);
          e.lineWidth = v;
          commit ? render() : drawOnly();
        }, { ariaLabel:"Line width" }));
      frow("Line color", () => {
        const control = swatches(tableColors(), edgeLineColor(e),
          (c, commit) => {
            pushHistory("edge-color:"+e.id);
            e.lineColor = c;
            commit ? render() : drawOnly();
          });
        control.id = "edgeLineColor";
        return control;
      });
    }, {open:false});
    inspectorSection("edge:label", "Label", () => {
      frow("Relationship", () => edgeRelationshipSelect(e, { id:"edgeRelationshipSelect", onCustom:focusEdgeLabelInput }));
      frow("Label text", () => {
        const i = mkInput(e.label, v => {
          e.label = v;
          const s = document.getElementById("edgeRelationshipSelect");
          if (s) s.value = edgeRelationshipValue(v);
          drawOnly();
        });
        i.id = "edgeLabelInput";
        i.placeholder = "Custom relationship text";
        return i;
      });
      frow("Text color", () => {
        const control = colorOverrideControl(fontColors(), e.labelTextColor, edgeLineColor(e),
          (c, commit) => {
            pushHistory("edge-label-text:"+e.id);
            e.labelTextColor = c;
            commit ? render() : drawOnly();
          }, () => {
            if (!normalizeHex(e.labelTextColor)) return;
            pushHistory();
            delete e.labelTextColor;
            render();
          }, {inheritLabel:"link color", key:"label-text"});
        control.id = "edgeLabelTextColor";
        return control;
      });
      frow("Background color", () => {
        const control = colorOverrideControl(conceptColors(), e.labelBackgroundColor, themeColors().labelBg,
          (c, commit) => {
            pushHistory("edge-label-background:"+e.id);
            e.labelBackgroundColor = c;
            commit ? render() : drawOnly();
          }, () => {
            if (!normalizeHex(e.labelBackgroundColor)) return;
            pushHistory();
            delete e.labelBackgroundColor;
            render();
          }, {inheritLabel:"canvas background", key:"label-background"});
        control.id = "edgeLabelBackgroundColor";
        return control;
      });
    });
    inspectorActions([mkBtn("Swap direction", () => {
      pushHistory();
      swapEdgeDirection(e);
      render();
    })], mkBtn("Delete edge", deleteSelection, "dangerbtn"), {inlineDanger:true});
  }
}

function renderMultiInspector(){
  const nodes = selectedNodes();
  const nonStructural = nodes.filter(n => !isStructuralNode(n));
  setInspectorHeader("Multi-selection", `${nodes.length} nodes`);
  inspectorSection("multi:appearance", "Appearance", () => {
    const helper = document.createElement("div");
    helper.className = "helper";
    helper.textContent = "Changes apply to every selected node.";
    appendInspector(helper);
    frow("Color", () => swatches([...conceptColors(), ...tableColors()], nodes[0].color,
      (c, commit) => {
        pushHistory("color:multi");
        for (const n of nodes) n.color = c;
        commit ? render() : drawOnly();
      }));
    if (nonStructural.length === nodes.length){
      if (nodes.every(n => n.type === "concept") || nodes.every(n => n.type === "text")){
        frow("Shape", () => {
          const s = document.createElement("select");
          const textNodes = nodes[0].type === "text";
          s.setAttribute("aria-label", textNodes ? "Text box shape" : "Flowchart shape");
          const current = textNodes ? textBoxShape(nodes[0]) : conceptShape(nodes[0]);
          for (const [value, label] of textNodes ? TEXT_BOX_SHAPES : FLOWCHART_SHAPES){
            const o = document.createElement("option");
            o.value = value; o.textContent = label;
            if (current === value) o.selected = true;
            s.appendChild(o);
          }
          s.addEventListener("change", () => {
            pushHistory();
            for (const n of nodes){
              if (textNodes) setTextBoxShape(n, s.value); else setConceptShape(n, s.value);
            }
            render();
          });
          return s;
        });
      }
      frow("Text size", () => sizeStepper(nodeTextSize(nodes[0]),
        8, 48, 1, (v, commit) => {
          pushHistory("fs:multi");
          for (const n of nodes) n.fontSize = clampNodeTextSize(n, v);
          commit ? render() : drawOnly();
        }));
      frow("Text color", () => swatches(fontColors(), nodes[0].fontColor || "#16232F",
        (c, commit) => {
          pushHistory("fc:multi");
          for (const n of nodes) n.fontColor = c;
          commit ? render() : drawOnly();
        }));
    }
  });
  inspectorActions([mkBtn("Duplicate", duplicateSelection)], mkBtn("Delete", deleteSelection, "dangerbtn"));
}

/* swap an edge's direction, carrying row bindings and pinned anchor points */
function swapEdgeDirection(e){
  const t = e.from; e.from = e.to; e.to = t;
  const tf = e.fromField;
  if (e.toField !== undefined) e.fromField = e.toField; else delete e.fromField;
  if (tf !== undefined) e.toField = tf; else delete e.toField;
  const ta = e.fromAnchor;
  if (e.toAnchor !== undefined) e.fromAnchor = e.toAnchor; else delete e.fromAnchor;
  if (ta !== undefined) e.toAnchor = ta; else delete e.toAnchor;
}
/* pick one of the 9 attachment points for a whole-node edge end */
function anchorRow(which, e, key){
  frow(which + " point", () => {
    const s = document.createElement("select");
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "(auto — nearest point)";
    s.appendChild(o0);
    for (const k of NODE_ANCHORS){
      const o = document.createElement("option");
      o.value = k; o.textContent = ANCHOR_LABELS[k];
      if (e[key] === k) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", () => {
      pushHistory();
      if (s.value) e[key] = s.value; else delete e[key];
      render();
    });
    return s;
  });
}
/* choose whole-node vs. specific row (field/item) for one end of an edge */
function attachRow(which, node, e, key){
  const rows = nodeRows(node);
  if (!rows || !rows.length) return;
  frow(which + " attaches to", () => {
    const s = document.createElement("select");
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = node.type === "todo" ? "(whole list)" : "(whole table)";
    s.appendChild(o0);
    for (const f of rows){
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.name || f.text || f.id;
      if (e[key] === f.id) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", () => {
      pushHistory();
      if (s.value) e[key] = s.value; else delete e[key];
      render();
    });
    return s;
  });
}
function renderEdgeEndControls(a, b, e){
  const grid = document.createElement("div");
  grid.className = "edge-end-grid";
  appendInspector(grid);
  const firstPair = edgeFieldPairs(e)[0] || {};
  const ends = [
    {which:"From", node:a, fieldKey:"fromField", anchorKey:"fromAnchor", bound:firstPair.fromField || e.fromField},
    {which:"To", node:b, fieldKey:"toField", anchorKey:"toAnchor", bound:firstPair.toField || e.toField}
  ];
  const previous = inspectorMount;
  for (const end of ends){
    const column = document.createElement("div");
    column.className = "edge-end-column";
    grid.appendChild(column);
    inspectorMount = column;
    attachRow(end.which, end.node, e, end.fieldKey);
    if (!end.bound) anchorRow(end.which, e, end.anchorKey);
  }
  inspectorMount = previous;
}
function setEdgePairs(e, pairs){
  e.pairs = pairs.filter(p => p.fromField || p.toField);
  if (!e.pairs.length){
    delete e.pairs;
    delete e.fromField;
    delete e.toField;
  } else {
    e.fromField = e.pairs[0].fromField || "";
    e.toField = e.pairs[0].toField || "";
  }
}
function fieldSelect(node, value, onChange){
  const s = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = ""; empty.textContent = "(none)";
  s.appendChild(empty);
  for (const f of node.fields){
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.name;
    if (value === f.id) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function renderPairEditor(a, b, e){
  const wrapD = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = "Column pairs";
  lab.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px";
  wrapD.appendChild(lab);
  const pairs = edgeFieldPairs(e);
  if (!pairs.length) pairs.push({ fromField:e.fromField || "", toField:e.toField || "" });
  pairs.forEach((pair, i) => {
    const row = document.createElement("div");
    row.className = "fieldrow";
    row.append(
      fieldSelect(a, pair.fromField, value => {
        pushHistory();
        pairs[i] = {...pairs[i], fromField:value};
        setEdgePairs(e, pairs);
        render();
      }),
      fieldSelect(b, pair.toField, value => {
        pushHistory();
        pairs[i] = {...pairs[i], toField:value};
        setEdgePairs(e, pairs);
        render();
      }),
      mkBtn("✕", () => {
        pushHistory();
        pairs.splice(i, 1);
        setEdgePairs(e, pairs);
        render();
      }, "mini del")
    );
    wrapD.appendChild(row);
  });
  wrapD.appendChild(mkBtn("+ Add column pair", () => {
    pushHistory();
    const next = edgeFieldPairs(e);
    next.push({ fromField:"", toField:"" });
    setEdgePairs(e, next);
    render();
  }));
  appendInspector(wrapD);
}

function renderFieldEditor(n){
  const wrapD = document.createElement("div");
  n.fields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "fieldrow";
    const nameI = mkInput(f.name, v => { f.name = v; drawOnly(); });
    const typeI = mkInput(f.type, v => { f.type = v; drawOnly(); });
    typeI.setAttribute("list", "sqltypes");
    const del = mkBtn("✕", () => { pushHistory(); const fid = f.id; n.fields.splice(i,1); cleanFieldRefs(fid); render(); }, "mini del");
    row.append(nameI, typeI, del);
    wrapD.appendChild(row);

    const flags = document.createElement("div");
    flags.className = "flags";
    flags.appendChild(mkFlag("PK", f.pk, v => { f.pk = v; if (v) f.nullable = false; render(); }));
    flags.appendChild(mkFlag("FK", f.fk, v => { f.fk = v; render(); }));
    flags.appendChild(mkFlag("NULL", f.nullable, v => { f.nullable = v; render(); }));
    flags.appendChild(mkFlag("UNQ", f.unique, v => { f.unique = v; render(); }));
    flags.appendChild(mkFlag("IDX", f.index, v => { f.index = v; render(); }));
    flags.appendChild(mkBtn("…", () => { f.metaOpen = !f.metaOpen; render(); }, "mini"));
    flags.appendChild(mkBtn("↑", () => moveField(n, i, -1), "mini"));
    flags.appendChild(mkBtn("↓", () => moveField(n, i, +1), "mini"));
    wrapD.appendChild(flags);
    if (f.metaOpen){
      const meta = document.createElement("div");
      meta.className = "fieldmeta";
      const def = mkInput(f.default || "", v => { if (v) f.default = v; else delete f.default; drawOnly(); });
      def.placeholder = "default";
      const comment = mkInput(f.comment || "", v => { if (v) f.comment = v; else delete f.comment; drawOnly(); });
      comment.placeholder = "comment";
      comment.className = "wide";
      meta.append(def, comment);
      wrapD.appendChild(meta);
    }
  });

  wrapD.appendChild(mkBtn("+ Add field", () => {
    pushHistory();
    n.fields.push({id: uid(), name:"field_" + (n.fields.length+1), type:"VARCHAR(255)", pk:false, fk:false, nullable:true});
    render();
  }));
  appendInspector(wrapD);

  if (!document.getElementById("sqltypes")){
    const dl = document.createElement("datalist");
    dl.id = "sqltypes";
    for (const t of SQL_TYPES){ const o = document.createElement("option"); o.value = t; dl.appendChild(o); }
    document.body.appendChild(dl);
  }
}
function moveField(n, i, d){
  const rows = nodeRows(n);
  const j = i + d;
  if (!rows || j < 0 || j >= rows.length) return;
  pushHistory();
  [rows[i], rows[j]] = [rows[j], rows[i]];
  render();
}

function renderItemEditor(n){
  const wrapD = document.createElement("div");
  n.items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "fieldrow";
    const textI = mkInput(it.text, v => { it.text = v; drawOnly(); });
    const del = mkBtn("✕", () => { pushHistory(); const iid = it.id; n.items.splice(i,1); cleanFieldRefs(iid); render(); }, "mini del");
    row.append(textI, del);
    wrapD.appendChild(row);

    const flags = document.createElement("div");
    flags.className = "flags";
    flags.appendChild(mkFlag("DONE", !!it.done, v => { if (v) it.done = true; else delete it.done; render(); }));
    flags.appendChild(mkBtn("↑", () => moveField(n, i, -1), "mini"));
    flags.appendChild(mkBtn("↓", () => moveField(n, i, +1), "mini"));
    wrapD.appendChild(flags);
  });

  wrapD.appendChild(mkBtn("+ Add item", () => addTodoItem(n)));
  appendInspector(wrapD);
}

function renderHelp(){
  const h = document.createElement("div");
  h.className = "helper";
  h.innerHTML = `
    <p><b>Flexible primitives, one canvas.</b><br>
    Concepts sketch the business thinking, plain text adds titles and labels, rich notes preserve
    formatted context, tables carry the data model, and to-do lists track the work. Link them freely — a label, note, or idea
    can point at an entity, an exact column, or the task that will deliver it.</p>
    <p style="margin-top:10px"><b>Field-level connections.</b><br>
    Hover a table to reveal ○ handles on each field row. Drag from a row to another
    field or node — drop-target rows highlight as you go. Field-bound relations export
    as exact <span style="font-family:var(--mono);font-size:11px">FOREIGN KEY</span> constraints.
    Dragging between an FK column and a PK column auto-orients the relation.</p>
    <div class="legendrow">
      <svg width="46" height="16"><line x1="2" y1="8" x2="44" y2="8" stroke="#98A5B3" stroke-width="1.7" stroke-dasharray="5 5"/></svg>
      link — freeform mind-map edge</div>
    <div class="legendrow">
      <svg width="46" height="16"><line x1="8" y1="8" x2="38" y2="8" stroke="#33475C" stroke-width="1.7"/>
      <line x1="10" y1="3" x2="10" y2="13" stroke="#33475C" stroke-width="1.6"/>
      <line x1="36" y1="8" x2="44" y2="3" stroke="#33475C" stroke-width="1.6"/>
      <line x1="36" y1="8" x2="44" y2="8" stroke="#33475C" stroke-width="1.6"/>
      <line x1="36" y1="8" x2="44" y2="13" stroke="#33475C" stroke-width="1.6"/></svg>
      1:N — crow's-foot relation</div>
    <p style="margin-top:12px"><b>Shortcuts</b><br>
    <kbd>C</kbd> concept · <kbd>X</kbd> plain text · <kbd>N</kbd> note · <kbd>T</kbd> table · <kbd>⇥ Tab</kbd> linked child ·
    <kbd>Del</kbd> delete · <kbd>Ctrl+Z</kbd> undo · <kbd>Ctrl+D</kbd> duplicate ·
    <kbd>F</kbd> fit · <kbd>Shift</kbd>+drag snap · arrows nudge</p>
    <p style="margin-top:12px"><b>Type &amp; color</b><br>
    Select a node to set fill, <b>text size</b>, and <b>text color</b> in this panel — or right-click for the same. Nodes grow to fit larger text.</p>
    <p style="margin-top:12px"><b>Persistence</b><br>
    Use <b>Open</b>, <b>Save</b>, and <b>Save As</b> for local document workflow. Unsupported browsers fall back to <b>JSON ↓</b> downloads and <b>Import</b> uploads.
    <b>SQL</b> drafts CREATE TABLE statements from table nodes and 1:N edges.</p>`;
  appendInspector(h);
}

/* small builders */
function frow(label, buildCtrl){
  const d = document.createElement("div");
  d.className = "frow";
  const l = document.createElement("label");
  l.textContent = label;
  d.append(l, buildCtrl());
  appendInspector(d);
}
function mkInput(val, onInput){
  const i = document.createElement("input");
  i.type = "text"; i.value = val || "";
  i.addEventListener("focus", pushHistoryOnce());
  i.addEventListener("input", () => onInput(i.value));
  return i;
}
function pushHistoryOnce(){
  let done = false;
  return () => { if (!done){ pushHistory(); done = true; } };
}
function mkBtn(txt, fn, cls){
  const b = document.createElement("button");
  b.textContent = txt;
  if (cls) b.className = cls;
  b.addEventListener("click", fn);
  return b;
}
/* accept "#abc", "abc", "#aabbcc", "AABBCC" → "#aabbcc"; else null */
function normalizeHex(raw){
  let s = (raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split("").map(c => c + c).join("");
  if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toLowerCase();
  return null;
}

/* native color well + validated hex field.
   apply(color, commit): commit=false while live-editing (redraw canvas only,
   keep this input alive); commit=true on a settled value (full render). */
function customColorRow(current, apply, opts = {}){
  const row = document.createElement("div");
  row.className = "hexrow";

  const well = document.createElement("input");
  well.type = "color";
  well.className = "colorwell";
  well.value = normalizeHex(current) || "#000000";
  well.title = "Pick a color";
  well.addEventListener("input",  () => { syncText(well.value); apply(well.value, false); });
  well.addEventListener("change", () => { syncText(well.value); recordRecentColor(well.value); apply(well.value, true); if (opts.onCommit) opts.onCommit(); });

  const hash = document.createElement("span");
  hash.className = "hexhash";
  hash.textContent = "#";

  const txt = document.createElement("input");
  txt.type = "text";
  txt.className = "hexinput";
  txt.spellcheck = false;
  txt.maxLength = 7;
  txt.placeholder = "aabbcc";
  txt.setAttribute("aria-label", "Hex color code");
  txt.value = (normalizeHex(current) || "").replace(/^#/, "");
  const syncText = hex => { txt.value = hex.replace(/^#/, ""); txt.classList.remove("bad"); };

  txt.addEventListener("input", () => {
    const n = normalizeHex(txt.value);
    if (n){ txt.classList.remove("bad"); well.value = n; apply(n, false); }   // live once valid
    else txt.classList.remove("bad");                                          // don't nag mid-type
  });
  const commit = () => {
    const n = normalizeHex(txt.value);
    if (n){ txt.classList.remove("bad"); well.value = n; syncText(n); recordRecentColor(n); apply(n, true); return true; }
    if (txt.value.trim() !== ""){ txt.classList.add("bad"); return false; }
    return true;
  };
  txt.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); if (commit() && opts.onCommit) opts.onCommit(); }
  });
  txt.addEventListener("blur", commit);
  txt.addEventListener("pointerdown", ev => ev.stopPropagation());  // don't let menu-close swallow focus

  row.append(well, hash, txt);
  return row;
}

/* − [number] + stepper. apply(value, commit) — live while typing/holding, commit on settle */
function sizeStepper(current, lo, hi, step, apply, opts = {}){
  const row = document.createElement("div");
  row.className = "sizestepper";
  const dec = document.createElement("button");
  dec.type = "button"; dec.className = "stepbtn"; dec.textContent = "−";
  const num = document.createElement("input");
  num.type = "text"; num.className = "sizeval"; num.value = String(current);
  num.setAttribute("aria-label", opts.ariaLabel || "Font size");
  const inc = document.createElement("button");
  inc.type = "button"; inc.className = "stepbtn"; inc.textContent = "+";
  const unit = document.createElement("span");
  unit.className = "sizeunit"; unit.textContent = opts.unit || "px";
  const clamp = v => Math.min(hi, Math.max(lo, v));
  const setVal = (v, commit) => { v = clamp(v); num.value = String(v); apply(v, commit); };
  dec.addEventListener("click", () => setVal((parseFloat(num.value)||current) - step, true));
  inc.addEventListener("click", () => setVal((parseFloat(num.value)||current) + step, true));
  num.addEventListener("input", () => {
    const v = parseFloat(num.value);
    if (isFinite(v) && v >= lo && v <= hi) apply(v, false);      // live within range
  });
  num.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); setVal(parseFloat(num.value)||current, true); num.blur(); }
    else if (ev.key === "ArrowUp"){ ev.preventDefault(); setVal((parseFloat(num.value)||current)+step, true); }
    else if (ev.key === "ArrowDown"){ ev.preventDefault(); setVal((parseFloat(num.value)||current)-step, true); }
  });
  num.addEventListener("blur", () => setVal(parseFloat(num.value)||current, true));
  num.addEventListener("pointerdown", ev => ev.stopPropagation());
  row.append(dec, num, unit, inc);
  return row;
}

function swatchRow(colors, current, apply, className, onPick){
  const d = document.createElement("div");
  d.className = className;
  for (const c of colors){
    const b = document.createElement("button");
    b.className = "swatch" + (c.toLowerCase() === (current||"").toLowerCase() ? " on" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => { apply(c, true); if (onPick) onPick(); });
    d.appendChild(b);
  }
  return d;
}
function swatches(colors, current, apply){
  const wrap = document.createElement("div");
  wrap.className = "swatchgroup";
  wrap.appendChild(swatchRow(colors, current, apply, "swatches"));
  if (recentColors.length)
    wrap.appendChild(swatchRow(recentColors, current, apply, "swatches recent"));
  wrap.appendChild(customColorRow(current, apply));
  return wrap;
}
function colorOverrideControl(colors, explicit, fallback, apply, reset, opts = {}){
  const inherited = !normalizeHex(explicit);
  const wrap = swatches(colors, inherited ? fallback : explicit, apply);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "flag colorinherit" + (inherited ? " on" : "");
  button.textContent = inherited ? `Using ${opts.inheritLabel}` : `Reset to ${opts.inheritLabel}`;
  button.setAttribute("aria-pressed", String(inherited));
  button.setAttribute("data-color-inherit", opts.key || "color");
  button.addEventListener("click", reset);
  wrap.insertBefore(button, wrap.firstChild);
  return wrap;
}
function mkFlag(txt, on, set){
  const b = document.createElement("button");
  b.className = "flag" + (on ? " on" : "");
  b.textContent = txt;
  b.addEventListener("click", () => { pushHistory(); set(!on); });
  return b;
}
/* redraw canvas without rebuilding inspector (keeps input focus) */
function drawOnly(){
  frameLayer.innerHTML = ""; edgeLayer.innerHTML = ""; nodeLayer.innerHTML = "";
  draftLayer.innerHTML = "";
  for (const n of state.nodes) if (isStructuralNode(n)) drawStructuralNode(n);
  for (const e of state.edges) drawEdge(e);
  for (const n of state.nodes) if (!isStructuralNode(n)) drawNode(n);
  drawEdgeGrips();
  renderMinimap();
}
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
