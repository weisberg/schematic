"use strict";

/* -------------------------- Inspector ----------------------------- */
const inspBody = document.getElementById("inspBody");
const inspTitle = document.getElementById("inspTitle");
const inspectorPanel = document.getElementById("inspector");
const inspectorResizer = document.getElementById("inspectorResizer");
const inspectorSectionToggle = document.getElementById("inspectorSectionToggle");
let inspectorMount = inspBody;

const INSPECTOR_WIDTH_KEY = "schematic.inspectorWidth";
const INSPECTOR_WIDTH_DEFAULT = 340;
const INSPECTOR_WIDTH_MIN = 280;
const INSPECTOR_WIDTH_MAX = 520;
function clampInspectorWidth(value){
  const width = value == null || value === "" ? INSPECTOR_WIDTH_DEFAULT : Number(value);
  return Math.max(INSPECTOR_WIDTH_MIN, Math.min(INSPECTOR_WIDTH_MAX,
    Number.isFinite(width) ? Math.round(width) : INSPECTOR_WIDTH_DEFAULT));
}
function setInspectorWidth(value, persist = true){
  const width = clampInspectorWidth(value);
  inspectorPanel.style.setProperty("--inspector-width", `${width}px`);
  inspectorResizer.setAttribute("aria-valuenow", String(width));
  if (persist){ try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(width)); } catch {} }
  return width;
}
function loadInspectorWidth(){
  try { return setInspectorWidth(localStorage.getItem(INSPECTOR_WIDTH_KEY), false); }
  catch { return setInspectorWidth(INSPECTOR_WIDTH_DEFAULT, false); }
}
let inspectorWidth = loadInspectorWidth();
let inspectorResizeDrag = null;
inspectorResizer.addEventListener("pointerdown", ev => {
  ev.preventDefault();
  inspectorResizeDrag = {x:ev.clientX, width:inspectorWidth};
  if (inspectorResizer.setPointerCapture) inspectorResizer.setPointerCapture(ev.pointerId);
  document.body.classList.add("inspector-resizing");
});
inspectorResizer.addEventListener("pointermove", ev => {
  if (!inspectorResizeDrag) return;
  inspectorWidth = setInspectorWidth(inspectorResizeDrag.width + inspectorResizeDrag.x - ev.clientX, false);
});
const finishInspectorResize = ev => {
  if (!inspectorResizeDrag) return;
  inspectorResizeDrag = null;
  document.body.classList.remove("inspector-resizing");
  inspectorWidth = setInspectorWidth(inspectorWidth, true);
  if (ev && inspectorResizer.releasePointerCapture && inspectorResizer.hasPointerCapture &&
      inspectorResizer.hasPointerCapture(ev.pointerId)) inspectorResizer.releasePointerCapture(ev.pointerId);
};
inspectorResizer.addEventListener("pointerup", finishInspectorResize);
inspectorResizer.addEventListener("pointercancel", finishInspectorResize);
inspectorResizer.addEventListener("dblclick", () => { inspectorWidth = setInspectorWidth(INSPECTOR_WIDTH_DEFAULT); });
inspectorResizer.addEventListener("keydown", ev => {
  let next = null;
  if (ev.key === "ArrowLeft") next = inspectorWidth + (ev.shiftKey ? 40 : 16);
  else if (ev.key === "ArrowRight") next = inspectorWidth - (ev.shiftKey ? 40 : 16);
  else if (ev.key === "Home") next = INSPECTOR_WIDTH_DEFAULT;
  if (next == null) return;
  ev.preventDefault();
  inspectorWidth = setInspectorWidth(next, true);
});

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
function statusValueSelect(n, opts = {}){
  const s = document.createElement("select");
  s.setAttribute("aria-label", "Status");
  if (opts.id) s.id = opts.id;
  for (const label of statusOptions()){
    const o = document.createElement("option");
    o.value = label;
    o.textContent = label;
    if (n.status === label) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener("change", () => {
    const targets = opts.targets || [n];
    if (targets.every(target => target.status === s.value)) return;
    pushHistory();
    for (const target of targets) target.status = s.value;
    if (opts.close) opts.close();
    render();
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
function inspectorSections(){
  return [...inspBody.children].filter(child => child.classList && child.classList.contains("inspector-section"));
}
function updateInspectorSectionToggle(){
  const sections = inspectorSections();
  inspectorSectionToggle.hidden = sections.length === 0;
  if (!sections.length) return;
  const collapse = sections.some(section => section.open);
  inspectorSectionToggle.textContent = collapse ? "Collapse all" : "Expand all";
  inspectorSectionToggle.setAttribute("aria-label", collapse ? "Collapse all inspector sections" : "Expand all inspector sections");
}
inspectorSectionToggle.addEventListener("click", () => {
  const sections = inspectorSections();
  const open = !sections.some(section => section.open);
  for (const section of sections){
    section.open = open;
    inspectorDisclosureState.set(section.getAttribute("data-inspector-section"), open);
  }
  updateInspectorSectionToggle();
});
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
      mark.style.background = normalizeHex(opts.color) || opts.color || "transparent";
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
  details.addEventListener("toggle", () => {
    inspectorDisclosureState.set(key, details.open);
    updateInspectorSectionToggle();
  });
  updateInspectorSectionToggle();
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
  frow(n.type === "table" ? "Table name" : n.type === "text" || n.type === "status" ? "Text" : "Title", () => {
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
      bindHistoryOnInput(i, () => update(i.value));
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
function renderNodeDecorationFields(n){
  frow("Subtitle", () => {
    const input = document.createElement("textarea");
    input.id = "nodeSubtitleInput";
    input.rows = 2;
    input.maxLength = 500;
    input.value = n.subtitle || "";
    input.placeholder = "Smaller supporting text";
    input.setAttribute("aria-label", "Node subtitle");
    bindHistoryOnInput(input, () => {
      const value = input.value.replace(/\r\n?/g, "\n").slice(0, 500);
      if (value) n.subtitle = value; else delete n.subtitle;
      drawOnly();
    });
    input.addEventListener("blur", () => setNodeSubtitle(n, input.value));
    return input;
  });
  frow("Icon source", () => {
    const source = document.createElement("select");
    source.id = "nodeIconSource";
    source.setAttribute("aria-label", "Node icon source");
    const current = nodeIconLibrary(n);
    for (const [value, label] of NODE_ICON_LIBRARIES){
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = current === value;
      source.appendChild(option);
    }
    source.addEventListener("change", () => {
      pushHistory();
      if (source.value === "emoji") setNodeIcon(n, "emoji:✨");
      else if (source.value === "lucide") setNodeIcon(n, "lucide:rocket");
      else if (source.value === "fa") setNodeIcon(n, "fa:bolt");
      else setNodeIcon(n, "");
      render();
    });
    return source;
  });
  const library = nodeIconLibrary(n);
  const current = nodeIcon(n);
  if (library === "emoji"){
    frow("Emoji", () => {
      const input = document.createElement("input");
      input.id = "nodeEmojiInput";
      input.type = "text";
      input.value = current ? current.name : "";
      input.placeholder = "✨";
      input.setAttribute("aria-label", "Node emoji");
      bindHistoryOnInput(input, () => {
        const emoji = cleanNodeEmoji(input.value);
        if (emoji) n.icon = `emoji:${emoji}`; else delete n.icon;
        drawOnly();
      });
      input.addEventListener("change", () => {
        setNodeIcon(n, `emoji:${input.value}`);
        render();
      });
      return input;
    });
  } else if (NODE_ICON_CATALOGS[library]){
    frow("Icon", () => {
      const select = document.createElement("select");
      select.id = "nodeIconName";
      select.setAttribute("aria-label", `${library === "fa" ? "Font Awesome" : "Lucide"} icon`);
      for (const [value, label] of nodeIconOptions(library)){
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = current && current.name === value;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        pushHistory();
        setNodeIcon(n, `${library}:${select.value}`);
        render();
      });
      return select;
    });
  }
}
function renderNodePortFields(n){
  const enabled = nodePortsEnabled(n);
  frow("Input / output", () => {
    const toggle = mkFlag(enabled ? "On" : "Off", enabled, on => {
      setNodePortsEnabled(n, on);
      render();
    });
    toggle.id = "nodePortsEnabled";
    toggle.setAttribute("aria-label", "Show input and output link labels");
    toggle.setAttribute("aria-pressed", String(enabled));
    return toggle;
  });
  if (!enabled) return;
  renderNodePortSide(n, "input");
  renderNodePortSide(n, "output");
  const help = document.createElement("div");
  help.className = "helper";
  help.textContent = "Drag from an Output to a named Input. Existing unbound links use the first port on each side.";
  appendInspector(help);
}
function renderNodePortSide(n, side){
  const config = nodePortConfig(side);
  const ports = nodePortsForSide(n, side);
  const group = document.createElement("div");
  group.className = "port-editor-group";
  const heading = document.createElement("div");
  heading.className = "port-editor-heading";
  const title = document.createElement("span");
  title.textContent = side === "input" ? "Inputs" : "Outputs";
  const add = mkBtn("+ Add", () => {
    pushHistory();
    addNodePort(n, side);
    render();
  }, "mini");
  add.setAttribute("aria-label", `Add ${side}`);
  add.disabled = ports.length >= NODE_PORT_MAX;
  heading.append(title, add);
  group.appendChild(heading);

  ports.forEach((port, index) => {
    const row = document.createElement("div");
    row.className = "port-editor-row";
    const input = mkInput(port.label, value => {
      setNodePortLabel(n, side, value, port.id);
      drawOnly();
    });
    input.maxLength = NODE_PORT_LABEL_MAX;
    input.placeholder = `${config.fallback} ${index + 1}`;
    input.setAttribute("aria-label", `${config.fallback} ${index + 1} name`);
    input.setAttribute("data-port-input", port.id);
    if (index === 0) input.id = side === "input" ? "nodeInputLabel" : "nodeOutputLabel";
    const remove = mkBtn("×", () => {
      pushHistory();
      removeNodePort(n, side, port.id);
      render();
    }, "mini del");
    remove.disabled = ports.length <= 1;
    remove.setAttribute("aria-label", `Remove ${port.label}`);
    row.append(input, remove);
    group.appendChild(row);
  });
  appendInspector(group);
}
function renderNodeNotesField(n){
  frow("Notes", () => {
    const t = document.createElement("textarea");
    t.value = n.notes || "";
    t.placeholder = "Add notes…";
    bindHistoryOnInput(t, () => { n.notes = t.value; drawOnly(); });
    return t;
  });
}

function renderInspector(){
  updateInspectorVisibility();
  inspBody.innerHTML = "";
  document.getElementById("inspector")?.classList.remove("organization-locked");
  updateInspectorSectionToggle();
  inspectorMount = inspBody;
  colorPickerSequence = 0;
  if (!sel){ setInspectorHeader("Inspector"); renderHelp(); return; }

  if (sel.kind === "node"){
    if (selectionCount("node") > 1){ renderMultiInspector(); return; }
    const n = singleSelectedNode();
    if (!n){ clearSelection(); renderHelp(); return; }
    const kind = n.type === "concept" ? "Concept node" : n.type === "frame" ? "Frame" : n.type === "swimlane" ? "Swimlane"
               : n.type === "todo" ? "To-do list" : n.type === "note" ? "Rich note"
               : n.type === "text" ? "Plain text" : n.type === "status" ? "Status node" : "Table node";
    setInspectorHeader(kind, n.title, {kind:"node", color:n.color || themeColors().ink});
    if (typeof renderOrganizationInspectorForObject === "function") renderOrganizationInspectorForObject(n);
    if (typeof renderMetadataInspectorForObject === "function") renderMetadataInspectorForObject(n);
    if (typeof renderEditingInspectorForNode === "function") renderEditingInspectorForNode(n);

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
      }, {open:false});
    } else if (n.type === "frame"){
      inspectorSection("frame:basics", "Basics", () => {
        renderNodeTitleField(n);
        frow("Display", () => mkFlag(n.collapsed === true ? "Collapsed" : "Expanded", n.collapsed === true,
          collapsed => setFrameCollapsed(n, collapsed, {history:false})));
      });
      inspectorSection("frame:appearance", "Appearance", () => {
        frow("Color", () => swatches(tableColors(), n.color || frameColorDefault(),
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        const enabled = frameBorderEnabled(n);
        frow("Border", () => mkFlag(enabled ? "On" : "Off", enabled, on => {
          setFrameBorderEnabled(n, on);
          render();
        }));
        if (enabled){
          frow("Border width", () => sizeStepper(frameBorderWidth(n), FRAME_BORDER_MIN_WIDTH,
            FRAME_BORDER_MAX_WIDTH, 1, (v, commit) => {
              pushHistory("frame-border-width:"+n.id);
              setFrameBorderWidth(n, v);
              commit ? render() : drawOnly();
            }, {ariaLabel:"Frame border width"}));
          frow("Border color", () => {
            const control = swatches(tableColors(), frameBorderColor(n), (c, commit) => {
              pushHistory("frame-border-color:"+n.id);
              n.borderColor = c;
              commit ? render() : drawOnly();
            }, {key:"frame-border-color:"+n.id});
            control.id = "frameBorderColor";
            return control;
          });
        }
      });
      inspectorSection("frame:size", "Size", () => {
        frow(n.collapsed === true ? "Expanded width" : "Width", () => sizeStepper(n.w || FRAME_DEFAULT.w, 120, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); }));
        frow(n.collapsed === true ? "Expanded height" : "Height", () => sizeStepper(n.h || FRAME_DEFAULT.h, 90, 4000, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.h = v; commit ? render() : drawOnly(); }));
      }, {open:false});
    } else if (n.type === "concept"){
      inspectorSection("concept:basics", "Basics", () => {
        renderNodeTitleField(n);
        renderNodeDecorationFields(n);
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
      inspectorSection("concept:ports", "Link ports", () => renderNodePortFields(n),
        {open:nodePortsEnabled(n)});
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
      inspectorSection("text:advanced", "Advanced", () => {
        const precisionValue = value => Math.round(Number(value) * 100) / 100;
        const update = (key, current, value, commit, apply) => {
          if (Math.abs(Number(current) - Number(value)) < .000001){
            if (commit) render();
            return;
          }
          pushHistory(`${key}:${n.id}`);
          apply(value);
          commit ? render() : drawOnly();
        };
        const wrap = textBoxWrapEnabled(n);
        frow("Wrap text", () => {
          const button = mkFlag(wrap ? "On" : "Off", wrap, enabled => {
            setTextBoxWrapping(n, enabled);
            render();
          });
          button.id = "textBoxWrap";
          button.setAttribute("aria-label", "Wrap text");
          button.setAttribute("aria-pressed", String(wrap));
          return button;
        });
        frow("Left", () => sizeStepper(precisionValue(n.x), -100000, 100000, 1,
          (v, commit) => update("text-left", n.x, v, commit, next => { n.x = next; }),
          {ariaLabel:"Text box left"}));
        frow("Top", () => sizeStepper(precisionValue(n.y), -100000, 100000, 1,
          (v, commit) => update("text-top", n.y, v, commit, next => { n.y = next; }),
          {ariaLabel:"Text box top"}));
        const rect = nodeRect(n);
        frow("Width", () => sizeStepper(precisionValue(rect.w), TEXT_W_MIN, 4000, 1,
          (v, commit) => update("text-width", manualNodeWidth(n) ?? rect.w, v, commit,
            next => { setNodeWidth(n, next); }),
          {ariaLabel:"Text box width"}));
        frow("Height", () => sizeStepper(precisionValue(rect.h), TEXT_H_MIN, TEXT_H_MAX, 1,
          (v, commit) => update("text-height", manualNodeHeight(n) ?? rect.h, v, commit,
            next => { setTextBoxHeight(n, next); }),
          {ariaLabel:"Text box height"}));
        for (const [side, label] of [["top","Top margin"], ["right","Right margin"],
          ["bottom","Bottom margin"], ["left","Left margin"]]){
          frow(label, () => sizeStepper(textBoxMargin(n, side), 0, TEXT_MARGIN_MAX, 1,
            (v, commit) => update(`text-margin-${side}`, textBoxMargin(n, side), v, commit,
              next => { setTextBoxMargin(n, side, next); }),
            {ariaLabel:label}));
        }
        const help = document.createElement("div");
        help.className = "helper";
        help.textContent = "Position and dimensions use canvas pixels. Margins inset the text inside its box.";
        appendInspector(help);
      }, {open:false});
    } else if (n.type === "status"){
      inspectorSection("status:basics", "Basics", () => {
        renderNodeTitleField(n);
        renderNodeDecorationFields(n);
        frow("Status", () => statusValueSelect(n, {id:"statusValue"}));
        frow("Indicator side", () => {
          const s = document.createElement("select");
          s.id = "statusSide";
          s.setAttribute("aria-label", "Status indicator side");
          for (const [value, label] of [["left","Left"],["right","Right"]]){
            const o = document.createElement("option");
            o.value = value; o.textContent = label; o.selected = n.statusSide === value;
            s.appendChild(o);
          }
          s.addEventListener("change", () => {
            if (s.value === n.statusSide) return;
            pushHistory();
            n.statusSide = s.value;
            render();
          });
          return s;
        });
        frow("Custom status", () => {
          const row = document.createElement("div");
          row.className = "status-custom-row";
          const input = document.createElement("input");
          input.type = "text";
          input.id = "customStatusInput";
          input.maxLength = 40;
          input.placeholder = "e.g. Waiting for review";
          input.setAttribute("aria-label", "New custom status label");
          const button = mkBtn("Add", () => {
            const raw = cleanStatusLabel(input.value);
            if (!raw){ input.focus(); return; }
            pushHistory();
            const label = addCustomStatus(raw);
            if (!label) return;
            n.status = label;
            render();
          });
          button.id = "addCustomStatusButton";
          input.addEventListener("keydown", ev => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            button.click();
          });
          row.append(input, button);
          return row;
        });
        const help = document.createElement("div");
        help.className = "helper";
        help.textContent = "Custom labels become available on every status node in this diagram.";
        appendInspector(help);
      });
      inspectorSection("status:appearance", "Appearance", () => {
        frow("Background", () => swatches(conceptColors(), n.color || conceptColors()[1],
          (c, commit) => { pushHistory("color:"+n.id); n.color = c; commit ? render() : drawOnly(); }));
        frow("Text size", () => sizeStepper(statusNodeFont(n), 10, 72, 1,
          (v, commit) => { pushHistory("fs:"+n.id); n.fontSize = v; commit ? render() : drawOnly(); },
          {ariaLabel:"Text size"}));
        frow("Text color", () => swatches(fontColors(), n.fontColor || themeColors().ink,
          (c, commit) => { pushHistory("fc:"+n.id); n.fontColor = c; commit ? render() : drawOnly(); }));
      });
      inspectorSection("status:layout", "Layout", () => {
        frow("Width", () => sizeStepper(n.w || STATUS_W_DEFAULT, 180, 720, 20,
          (v, commit) => { pushHistory("size:"+n.id); n.w = v; commit ? render() : drawOnly(); },
          {ariaLabel:"Status node width"}));
      }, {open:false});
    } else if (n.type === "note"){
      inspectorSection("note:basics", "Basics", () => renderNodeTitleField(n));
      inspectorSection("note:content", "Content", () => {
        frow("Markdown", () => {
          const t = document.createElement("textarea");
          t.id = "noteContentInput";
          t.rows = 10;
          t.value = n.content || "";
          t.placeholder = "Write a note…";
          bindHistoryOnInput(t, () => { n.content = t.value; drawOnly(); });
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
    if (!isStructuralNode(n)){
      const child = mkBtn("Add child", addChildConcept);
      child.title = "Add linked concept (Tab)";
      actions.push(child);
    }
    const remove = mkBtn("Delete", deleteSelection, "dangerbtn");
    remove.title = "Delete node";
    inspectorActions(actions, remove, {inlineDanger:true});

  } else {
    const e = singleSelectedEdge();
    if (!e){ clearSelection(); renderHelp(); return; }
    const a = nodeById(e.from), b = nodeById(e.to);
    setInspectorHeader("Edge", `${a.title} → ${b.title}`, {kind:"edge"});
    if (typeof renderOrganizationInspectorForObject === "function") renderOrganizationInspectorForObject(e);
    if (typeof renderMetadataInspectorForObject === "function") renderMetadataInspectorForObject(e);
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
      s.setAttribute("aria-label", "Edge routing");
      for (const k of ["curve","ortho"]){
        const o = document.createElement("option");
        o.value = k; o.textContent = k === "curve" ? "curved" : "orthogonal";
        if ((e.routing || "curve") === k) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener("change", () => {
        pushHistory();
        if (s.value === "ortho") e.routing = "ortho";
        else {
          delete e.routing;
          setOrthoCornerStyle(e, "rounded");
        }
        render();
      });
        return s;
      });
      if (e.routing === "ortho"){
        frow("Corners", () => {
          const select = document.createElement("select");
          select.id = "edgeOrthoCorners";
          select.setAttribute("aria-label", "Orthogonal link corners");
          for (const [value, label] of [["rounded","Rounded"],["square","Square"]]){
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = orthoCornerStyle(e) === value;
            select.appendChild(option);
          }
          select.addEventListener("change", () => {
            if (orthoCornerStyle(e) === select.value) return;
            pushHistory();
            setOrthoCornerStyle(e, select.value);
            render();
          });
          return select;
        });
        const helper = document.createElement("div");
        helper.className = "helper";
        helper.textContent = "Drag any square corner handle on the canvas. End handles move along their orthogonal leg; the central handle moves freely. Hold Shift to snap to grid points and half-grid positions.";
        appendInspector(helper);
        frow("Corners", () => {
          const button = mkBtn("Reset all to automatic", () => resetOrthoBend(e));
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
  if (typeof applyOrganizationInspectorLockState === "function") applyOrganizationInspectorLockState();
}

function renderMultiInspector(){
  const nodes = selectedNodes();
  const nonStructural = nodes.filter(n => !isStructuralNode(n));
  setInspectorHeader("Multi-selection", `${nodes.length} nodes`);
  if (typeof renderOrganizationMultiInspector === "function") renderOrganizationMultiInspector(nodes);
  if (typeof renderMetadataMultiInspector === "function") renderMetadataMultiInspector(nodes);
  if (typeof renderEditingMultiInspector === "function") renderEditingMultiInspector(nodes);
  if (nodes.every(n => n.type === "status")){
    inspectorSection("multi:status", "Status", () => {
      frow("Status", () => {
        return statusValueSelect(nodes[0], {targets:nodes});
      });
      frow("Indicator side", () => {
        const s = document.createElement("select");
        s.setAttribute("aria-label", "Status indicator side");
        for (const [value, label] of [["left","Left"],["right","Right"]]){
          const o = document.createElement("option");
          o.value = value; o.textContent = label; o.selected = nodes[0].statusSide === value;
          s.appendChild(o);
        }
        s.addEventListener("change", () => {
          pushHistory();
          for (const n of nodes) n.statusSide = s.value;
          render();
        });
        return s;
      });
    });
  }
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
  inspectorActions([mkBtn("Duplicate", duplicateSelection)], mkBtn("Delete", deleteSelection, "dangerbtn"),
    {inlineDanger:true});
}

/* swap an edge's direction, carrying row bindings and pinned anchor points */
function swapEdgeDirection(e){
  const hadLabelPosition = Object.hasOwn(e, "labelPosition");
  const labelPosition = edgeLabelPosition(e);
  const t = e.from; e.from = e.to; e.to = t;
  const tf = e.fromField;
  if (e.toField !== undefined) e.fromField = e.toField; else delete e.fromField;
  if (tf !== undefined) e.toField = tf; else delete e.toField;
  const ta = e.fromAnchor;
  if (e.toAnchor !== undefined) e.fromAnchor = e.toAnchor; else delete e.fromAnchor;
  if (ta !== undefined) e.toAnchor = ta; else delete e.toAnchor;
  const tp = e.fromPort;
  if (e.toPort !== undefined) e.fromPort = e.toPort; else delete e.fromPort;
  if (tp !== undefined) e.toPort = tp; else delete e.toPort;
  if (hadLabelPosition) setEdgeLabelPosition(e, 1 - labelPosition);
}
/* pick a whole-node attachment point; table ends also offer title left/right */
function anchorRow(which, node, e, key, portKey){
  frow(which + " point", () => {
    const s = document.createElement("select");
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = nodePortsEnabled(node)
      ? `(auto — ${which === "From" ? "Output" : "Input"} port)`
      : "(auto — nearest point)";
    s.appendChild(o0);
    if (nodePortsEnabled(node)){
      const preferred = which === "From" ? "output" : "input";
      const other = preferred === "input" ? "output" : "input";
      for (const side of [preferred, other]){
        for (const port of nodePortsForSide(node, side)){
          const o = document.createElement("option");
          o.value = `port:${port.id}`;
          o.textContent = `${side === "input" ? "Input" : "Output"} — ${port.label}`;
          if (e[portKey] === port.id) o.selected = true;
          s.appendChild(o);
        }
      }
    }
    for (const k of nodeAnchorKeys(node)){
      if (nodePortsEnabled(node) && (k === "ml" || k === "mr")) continue;
      const o = document.createElement("option");
      o.value = `anchor:${k}`;
      o.textContent = ANCHOR_LABELS[k];
      if (e[key] === k) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", () => {
      pushHistory();
      delete e[key];
      delete e[portKey];
      if (s.value.startsWith("port:")) e[portKey] = s.value.slice(5);
      else if (s.value.startsWith("anchor:")) e[key] = s.value.slice(7);
      render();
    });
    return s;
  });
}
/* choose whole-node vs. specific row (field/item) for one end of an edge */
function attachRow(which, node, e, key, portKey, anchorKey){
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
      if (s.value){
        e[key] = s.value;
        delete e[portKey];
        delete e[anchorKey];
      } else delete e[key];
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
    {which:"From", node:a, fieldKey:"fromField", anchorKey:"fromAnchor", portKey:"fromPort",
     bound:firstPair.fromField || e.fromField},
    {which:"To", node:b, fieldKey:"toField", anchorKey:"toAnchor", portKey:"toPort",
     bound:firstPair.toField || e.toField}
  ];
  const previous = inspectorMount;
  for (const end of ends){
    const column = document.createElement("div");
    column.className = "edge-end-column";
    grid.appendChild(column);
    inspectorMount = column;
    attachRow(end.which, end.node, e, end.fieldKey, end.portKey, end.anchorKey);
    if (!end.bound) anchorRow(end.which, end.node, e, end.anchorKey, end.portKey);
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
    Concepts sketch the business thinking, plain text adds titles and labels, status nodes show progress,
    rich notes preserve formatted context, tables carry the data model, and to-do lists track the work. Link them freely — a label, note, or idea
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
    <kbd>C</kbd> concept · <kbd>X</kbd> plain text · <kbd>S</kbd> status · <kbd>N</kbd> note · <kbd>T</kbd> table · <kbd>⇥ Tab</kbd> linked child ·
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
  const control = buildCtrl();
  if (control && control.matches && control.matches("select,.sizestepper,.flag,.edgearrowrow")) d.classList.add("compact");
  d.append(l, control);
  appendInspector(d);
}
function mkInput(val, onInput){
  const i = document.createElement("input");
  i.type = "text"; i.value = val || "";
  bindHistoryOnInput(i, () => onInput(i.value));
  return i;
}
function bindHistoryOnInput(control, onInput){
  const ensureHistory = pushHistoryOnce();
  control.addEventListener("beforeinput", ensureHistory);
  control.addEventListener("input", () => {
    // Programmatic tests and older engines may dispatch input without a
    // beforeinput event. The model has not been updated yet, so this fallback
    // still captures the correct pre-edit snapshot.
    ensureHistory();
    onInput();
  });
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

const COLOR_NAMES = new Map(Object.entries({
  "#ffe9a8":"Warm yellow", "#cfe8ff":"Sky blue", "#d8f3dc":"Mint",
  "#f4d8f0":"Soft orchid", "#ffd9c7":"Peach", "#e4e7ec":"Cool gray",
  "#007873":"Teal", "#c20029":"Crimson", "#16232f":"Ink",
  "#2456e6":"Cobalt", "#8a3fa8":"Purple", "#6b7683":"Slate",
  "#33475c":"Navy gray", "#7a8794":"Muted gray", "#ffffff":"White",
  "#c63a3a":"Red", "#e7f4f3":"Pale teal", "#fbe8ec":"Pale rose",
  "#e9e2f8":"Pale violet", "#000000":"Black"
}));
const colorPickerDisclosureState = new Map();
let colorPickerSequence = 0;

function colorDisplayName(hex){
  const normalized = colorBaseHex(hex);
  return normalized ? COLOR_NAMES.get(normalized) || "Custom color" : "No color";
}
function colorDisplayHex(hex){
  return (colorBaseHex(hex) || "#000000").toUpperCase();
}
function colorTransparencyText(color){
  const transparency = colorTransparency(color);
  return transparency ? `${transparency}% transparent` : "Opaque";
}
function colorCheckIcon(){
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("swatch-check");
  const path = document.createElementNS(SVGNS, "path");
  path.setAttribute("d", "M3.2 8.1l3 3.1 6.6-6.8");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}
function uniqueColors(colors){
  const result = [];
  const seen = new Set();
  for (const color of colors || []){
    const normalized = normalizeColorValue(color);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const original = typeof color === "string" ? color.trim() : "";
    result.push(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(original) ? original : normalized);
  }
  return result;
}
function documentColors(exclude = []){
  const blocked = new Set(uniqueColors(exclude).map(color => color.toLowerCase()));
  const candidates = [];
  for (const n of state.nodes || []){
    for (const key of ["color", "fontColor", "titleColor", "borderColor"]){
      const color = normalizeColorValue(n && n[key]);
      if (color) candidates.push(color);
    }
  }
  for (const e of state.edges || []){
    for (const key of ["lineColor", "labelTextColor", "labelBackgroundColor"]){
      const color = normalizeColorValue(e && e[key]);
      if (color) candidates.push(color);
    }
  }
  return uniqueColors(candidates).filter(color => !blocked.has(color.toLowerCase())).slice(0, 12);
}
/* Colors are stored as #rrggbb or #rrggbbaa. The alpha byte preserves the
   user's transparency setting, while every canvas color is composited over
   white before rendering so SVG/PNG output remains fully opaque. */
function parseColorValue(raw){
  if (typeof raw !== "string") return null;
  let s = (raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split("").map(c => c + c).join("");
  if (!/^[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(s)) return null;
  s = s.toLowerCase();
  return { base:"#" + s.slice(0, 6), alphaByte:s.length === 8 ? parseInt(s.slice(6), 16) : 255 };
}
function normalizeColorValue(raw){
  const parsed = parseColorValue(raw);
  if (!parsed) return null;
  return parsed.base + (parsed.alphaByte === 255 ? "" : parsed.alphaByte.toString(16).padStart(2, "0"));
}
function colorBaseHex(raw){
  const parsed = parseColorValue(raw);
  return parsed ? parsed.base : null;
}
function colorTransparency(raw){
  const parsed = parseColorValue(raw);
  return parsed ? Math.round((255 - parsed.alphaByte) * 100 / 255) : 0;
}
function composeColorValue(base, transparency = 0){
  const hex = colorBaseHex(base);
  if (!hex) return null;
  const amount = Math.min(100, Math.max(0, Math.round(Number(transparency) || 0)));
  const alphaByte = Math.round((100 - amount) * 255 / 100);
  return hex + (alphaByte === 255 ? "" : alphaByte.toString(16).padStart(2, "0"));
}
function normalizeHex(raw){
  const parsed = parseColorValue(raw);
  if (!parsed) return null;
  const alpha = parsed.alphaByte / 255;
  const channels = [1, 3, 5].map(index => {
    const value = parseInt(parsed.base.slice(index, index + 2), 16);
    return Math.round(value * alpha + 255 * (1 - alpha)).toString(16).padStart(2, "0");
  });
  return "#" + channels.join("");
}

/* native color well + validated hex field.
   apply(color, commit): commit=false while live-editing (redraw canvas only,
   keep this input alive); commit=true on a settled value (full render). */
function customColorRow(current, apply, opts = {}){
  const group = document.createElement("div");
  group.className = "color-custom";
  let base = colorBaseHex(current) || "#000000";
  let transparency = colorTransparency(current);
  const row = document.createElement("div");
  row.className = "hexrow";

  const well = document.createElement("input");
  well.type = "color";
  well.className = "colorwell";
  well.value = base;
  well.title = "Pick a color";
  well.setAttribute("aria-label", "Open the native color picker");

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
  txt.value = base.replace(/^#/, "");
  const error = document.createElement("span");
  error.className = "color-error";
  error.id = `color-error-${Math.random().toString(36).slice(2)}`;
  error.textContent = "Enter a 3- or 6-digit hex color.";
  error.hidden = true;
  txt.setAttribute("aria-describedby", error.id);
  const showValid = () => {
    txt.classList.remove("bad");
    txt.removeAttribute("aria-invalid");
    error.hidden = true;
  };
  const showInvalid = () => {
    txt.classList.add("bad");
    txt.setAttribute("aria-invalid", "true");
    error.hidden = false;
  };
  const syncText = hex => { txt.value = hex.replace(/^#/, ""); showValid(); };

  const transparencyControl = document.createElement("div");
  transparencyControl.className = "color-transparency";
  const transparencyHead = document.createElement("div");
  transparencyHead.className = "color-transparency-head";
  const transparencyLabel = document.createElement("label");
  const transparencyId = `color-transparency-${Math.random().toString(36).slice(2)}`;
  transparencyLabel.htmlFor = transparencyId;
  transparencyLabel.textContent = "Transparency";
  const transparencyOutput = document.createElement("output");
  transparencyOutput.htmlFor = transparencyId;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = transparencyId;
  slider.className = "color-transparency-slider";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.value = String(transparency);
  slider.setAttribute("aria-label", "Color transparency");
  transparencyHead.append(transparencyLabel, transparencyOutput);
  transparencyControl.append(transparencyHead, slider);
  const syncTransparency = () => {
    transparencyOutput.value = `${transparency}%`;
    transparencyOutput.textContent = `${transparency}%`;
    slider.setAttribute("aria-valuetext", colorTransparencyText(composeColorValue(base, transparency)));
    slider.style.setProperty("--transparency-color", base);
  };
  const applyComposed = (commit, remember = false) => {
    const color = composeColorValue(base, transparency);
    syncTransparency();
    if (remember) recordRecentColor(color);
    apply(color, commit);
    return color;
  };
  syncTransparency();

  well.addEventListener("input", () => {
    base = colorBaseHex(well.value) || base;
    syncText(base);
    applyComposed(false);
  });
  well.addEventListener("change", () => {
    base = colorBaseHex(well.value) || base;
    syncText(base);
    applyComposed(true, true);
    if (opts.onCommit) opts.onCommit();
  });

  txt.addEventListener("input", () => {
    const n = colorBaseHex(txt.value);
    showValid();
    if (n){ base = n; well.value = base; applyComposed(false); }   // live once valid
  });
  const commit = () => {
    const n = colorBaseHex(txt.value);
    if (n){ base = n; showValid(); well.value = base; syncText(base); applyComposed(true, true); return true; }
    if (txt.value.trim() !== ""){ showInvalid(); return false; }
    return true;
  };
  txt.addEventListener("keydown", ev => {
    if (ev.key === "Enter"){ ev.preventDefault(); if (commit() && opts.onCommit) opts.onCommit(); }
  });
  txt.addEventListener("blur", commit);
  txt.addEventListener("pointerdown", ev => ev.stopPropagation());  // don't let menu-close swallow focus

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "color-copy";
  copy.textContent = "Copy";
  copy.setAttribute("aria-label", "Copy hex color");
  copy.addEventListener("click", () => {
    const color = colorBaseHex(txt.value) || base;
    if (!color) return;
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(color.toUpperCase()).catch(() => {});
    announce(`${color.toUpperCase()} copied`);
  });

  slider.addEventListener("input", () => {
    transparency = Number(slider.value);
    applyComposed(false);
  });
  slider.addEventListener("change", () => {
    transparency = Number(slider.value);
    applyComposed(true, true);
    if (opts.onCommit) opts.onCommit();
  });
  slider.addEventListener("pointerdown", ev => ev.stopPropagation());

  row.append(well, hash, txt, copy);
  if (typeof window.EyeDropper === "function"){
    const eyedropper = document.createElement("button");
    eyedropper.type = "button";
    eyedropper.className = "color-eyedropper";
    eyedropper.textContent = "Pick from screen";
    eyedropper.addEventListener("click", async () => {
      try {
        const result = await new window.EyeDropper().open();
        const color = colorBaseHex(result && result.sRGBHex);
        if (!color) return;
        base = color;
        well.value = base;
        syncText(base);
        applyComposed(true, true);
        if (opts.onCommit) opts.onCommit();
      } catch {}
    });
    group.append(row, transparencyControl, eyedropper, error);
  } else group.append(row, transparencyControl, error);
  return group;
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
  for (const c of uniqueColors(colors)){
    const normalized = normalizeColorValue(c);
    const visible = normalizeHex(normalized);
    const selected = normalized === normalizeColorValue(current);
    const b = document.createElement("button");
    b.className = "swatch" + (selected ? " on" : "");
    b.style.background = visible;
    b.title = colorTransparency(normalized)
      ? `${c} · ${colorTransparencyText(normalized)}` : c;
    b.type = "button";
    b.setAttribute("data-color", normalized);
    b.setAttribute("aria-label", `${colorDisplayName(normalized)}, ${colorDisplayHex(normalized)}, ${colorTransparencyText(normalized)}`);
    b.setAttribute("aria-pressed", String(selected));
    if (relativeLuminance(visible) > .72) b.classList.add("light");
    b.appendChild(colorCheckIcon());
    b.addEventListener("click", () => { apply(c, true); if (onPick) onPick(); });
    d.appendChild(b);
  }
  return d;
}
function colorPickerSection(label, colors, current, apply, className, opts = {}){
  const section = document.createElement("section");
  section.className = `color-picker-section ${opts.sectionClass || ""}`.trim();
  const heading = document.createElement("div");
  heading.className = "color-picker-heading";
  const title = document.createElement("span");
  title.textContent = label;
  heading.appendChild(title);
  if (opts.action){
    const action = document.createElement("button");
    action.type = "button";
    action.className = "color-picker-action";
    action.textContent = opts.action.label;
    action.addEventListener("click", opts.action.run);
    heading.appendChild(action);
  }
  section.append(heading, swatchRow(colors, current, apply, className));
  return section;
}
function updateColorPickerCurrent(picker, color){
  const normalized = normalizeColorValue(color) || "#000000";
  picker.setAttribute("data-current-color", normalized);
  const preview = picker.querySelector(".color-current-preview");
  const name = picker.querySelector(".color-current-name");
  const hex = picker.querySelector(".color-current-hex");
  const transparency = picker.querySelector(".color-current-transparency");
  if (preview) preview.style.background = normalizeHex(normalized);
  if (name) name.textContent = colorDisplayName(normalized);
  if (hex) hex.textContent = colorDisplayHex(normalized);
  if (transparency) transparency.textContent = colorTransparencyText(normalized);
  const summary = picker.querySelector(".color-picker-summary");
  if (summary) summary.setAttribute("aria-label",
    `Current color: ${colorDisplayName(normalized)}, ${colorDisplayHex(normalized)}, ${colorTransparencyText(normalized)}. Choose a color.`);
  for (const swatch of picker.querySelectorAll(".swatch")){
    const selected = swatch.getAttribute("data-color") === normalized;
    swatch.classList.toggle("on", selected);
    swatch.setAttribute("aria-pressed", String(selected));
  }
}
function swatches(colors, current, apply, opts = {}){
  const palette = uniqueColors(colors);
  let currentColor = normalizeColorValue(current) || normalizeColorValue(palette[0]) || "#000000";
  const selectionKey = sel ? `${sel.kind}:${selectionIds().join(",")}` : "none";
  const key = opts.key || `color:${selectionKey}:${colorPickerSequence++}`;
  const picker = document.createElement("div");
  picker.className = "color-picker swatchgroup" + (opts.context ? " context" : "");
  picker.setAttribute("data-color-picker", key);
  picker.setAttribute("data-current-color", currentColor);
  const stored = colorPickerDisclosureState.get(key);
  let pickerOpen = opts.open === true || (opts.persist !== false && stored === true);
  picker.classList.toggle("open", pickerOpen);

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "color-picker-summary";
  summary.setAttribute("aria-expanded", String(pickerOpen));
  summary.setAttribute("aria-label", `Current color: ${colorDisplayName(currentColor)}, ${colorDisplayHex(currentColor)}, ${colorTransparencyText(currentColor)}. Choose a color.`);
  const preview = document.createElement("span");
  preview.className = "color-current-preview";
  preview.style.background = normalizeHex(currentColor);
  const copy = document.createElement("span");
  copy.className = "color-current-copy";
  const name = document.createElement("strong");
  name.className = "color-current-name";
  name.textContent = colorDisplayName(currentColor);
  const hex = document.createElement("span");
  hex.className = "color-current-hex";
  hex.textContent = colorDisplayHex(currentColor);
  const transparency = document.createElement("span");
  transparency.className = "color-current-transparency";
  transparency.textContent = colorTransparencyText(currentColor);
  copy.append(name, hex, transparency);
  summary.append(preview, copy, disclosureChevron());

  const panel = document.createElement("div");
  panel.className = "color-picker-panel";
  panel.hidden = !pickerOpen;
  const rowClass = `swatches${opts.context ? " swrow" : ""}`;
  const select = (color, commit) => {
    const normalized = normalizeColorValue(color);
    if (!normalized) return;
    currentColor = normalized;
    updateColorPickerCurrent(picker, currentColor);
    apply(color, commit);
  };
  const selectPalette = (color, commit) => {
    const transparency = colorTransparency(currentColor);
    select(transparency ? composeColorValue(color, transparency) : color, commit);
  };
  panel.appendChild(colorPickerSection("Palette", palette, currentColor, selectPalette, rowClass));
  if (recentColors.length){
    const clearRecent = () => {
      if (!clearRecentColors()) return;
      for (const section of document.querySelectorAll(".color-picker-section.recent")) section.remove();
      announce("Recent colors cleared");
      if (opts.context && typeof fitCtxMenu === "function") fitCtxMenu();
    };
    panel.appendChild(colorPickerSection("Recent", recentColors, currentColor, select,
      `${rowClass} recent`, {sectionClass:"recent", action:{label:"Clear", run:clearRecent}}));
  }
  const usedColors = documentColors([...palette, ...recentColors]);
  if (usedColors.length)
    panel.appendChild(colorPickerSection("In this diagram", usedColors, currentColor, select,
      `${rowClass} document`, {sectionClass:"document"}));
  const customSection = document.createElement("section");
  customSection.className = "color-picker-section custom";
  const customHeading = document.createElement("div");
  customHeading.className = "color-picker-heading";
  customHeading.textContent = "Custom color";
  customSection.append(customHeading, customColorRow(currentColor, select, opts));
  panel.appendChild(customSection);
  picker.append(summary, panel);
  summary.addEventListener("click", () => {
    pickerOpen = !pickerOpen;
    picker.classList.toggle("open", pickerOpen);
    summary.setAttribute("aria-expanded", String(pickerOpen));
    panel.hidden = !pickerOpen;
    if (opts.persist !== false) colorPickerDisclosureState.set(key, pickerOpen);
    if (opts.context && typeof fitCtxMenu === "function") fitCtxMenu();
  });
  return picker;
}
function colorOverrideControl(colors, explicit, fallback, apply, reset, opts = {}){
  const inherited = !normalizeHex(explicit);
  const container = document.createElement("div");
  container.className = "color-override";
  container.setAttribute("data-color-override", opts.key || "color");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "colorinherit" + (inherited ? " on" : "");
  button.textContent = inherited ? `Using ${opts.inheritLabel}` : `Reset to ${opts.inheritLabel}`;
  button.setAttribute("aria-pressed", String(inherited));
  button.setAttribute("data-color-inherit", opts.key || "color");
  if (opts.action) button.setAttribute("data-ctx-action", opts.action);
  button.disabled = inherited;
  button.addEventListener("click", reset);
  const inheritedPreview = document.createElement("span");
  inheritedPreview.className = "colorinherit-preview";
  inheritedPreview.style.background = normalizeHex(fallback) || "#000000";
  button.prepend(inheritedPreview);
  const picker = swatches(colors, inherited ? fallback : explicit, apply, opts);
  container.append(button, picker);
  return container;
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
  if (typeof invalidateOrganizationEvaluation === "function") invalidateOrganizationEvaluation();
  frameLayer.innerHTML = ""; edgeLayer.innerHTML = ""; nodeLayer.innerHTML = "";
  if (guideLayer) guideLayer.innerHTML = "";
  draftLayer.innerHTML = "";
  const hidden = collapsedFrameHiddenNodeIds();
  const organizationHidden = typeof organizationalHiddenNodeIds === "function"
    ? organizationalHiddenNodeIds() : new Set();
  const allHidden = new Set([...hidden, ...organizationHidden]);
  const proxies = collapsedFrameProxyMap(hidden);
  const structural = state.nodes.filter(n => !allHidden.has(n.id) && isStructuralNode(n));
  for (const n of typeof organizationSortRecords === "function" ? organizationSortRecords(structural) : structural)
    drawStructuralNode(n);
  const edges = visibleCanvasEdges(hidden, proxies);
  for (const e of typeof organizationSortRecords === "function" ? organizationSortRecords(edges) : edges)
    drawEdge(e, hidden, proxies);
  const content = state.nodes.filter(n => !allHidden.has(n.id) && !isStructuralNode(n));
  for (const n of typeof organizationSortRecords === "function" ? organizationSortRecords(content) : content) drawNode(n);
  if (typeof drawManualGuides === "function") drawManualGuides();
  for (const n of state.nodes)
    if (!allHidden.has(n.id) && n.type === "frame" && n.collapsed === true) drawCollapsedFrameControlOverlay(n);
  drawEdgeGrips();
  renderMinimap();
  if (typeof markSearchIndexDirty === "function") markSearchIndexDirty();
  if (typeof scheduleOrganizationExplorerRender === "function") scheduleOrganizationExplorerRender();
}
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
