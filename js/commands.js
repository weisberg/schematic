"use strict";

/* ------------------------------------------------------------------
   Shared application commands

   The ribbon, quick-access row, responsive overflow controls, and command
   palette all resolve through this registry. Contextual canvas menus may add
   object-specific commands, but shared actions should call executeCommand()
   so availability, labels, shortcuts, and behavior stay consistent.
   ------------------------------------------------------------------ */

function commandHasNodeSelection(){ return selectionIds("node").length > 0; }
function commandHasSelection(){
  return selectionIds("node").length > 0 || selectionIds("edge").length > 0;
}
function commandHasMultipleNodes(){ return selectedNodes().length >= 2; }
function commandHasClipboard(){
  return !!(clipboardData && Array.isArray(clipboardData.nodes) && clipboardData.nodes.length);
}
function commandHasForcedSize(){ return selectedNodes().some(hasForcedNodeSize); }
function commandHasPrimaryNode(){ return !!firstSelectedNode(); }
function commandHasSingleContentNode(){
  const nodes = selectedNodes();
  return nodes.length === 1 && !isStructuralNode(nodes[0]);
}
function commandHasConcepts(){ return state.nodes.some(node => node.type === "concept"); }
function commandHasTables(){ return state.nodes.some(node => node.type === "table"); }
function commandHasSearchResults(){
  return typeof searchResults !== "undefined" && searchResults.length > 0;
}

const CORE_COMMAND_DEFINITIONS = [
  { id:"new", label:"New", description:"Start a new diagram", action:newDoc },
  { id:"open", label:"Open", shortcut:"Ctrl/Cmd+O", description:"Open a diagram from disk", action:openDoc },
  { id:"save", label:"Save", shortcut:"Ctrl/Cmd+S", description:"Save the current diagram", action:saveDoc },
  { id:"saveAs", label:"Save As", shortcut:"Ctrl/Cmd+Shift+S", description:"Save this diagram as a new file", action:saveAsDoc },
  { id:"importJson", label:"Import JSON", description:"Load a Schematic JSON document", action:importJsonDocument },
  { id:"clear", label:"Clear", description:"Clear the entire canvas", action:clearCanvas,
    enabled:() => state.nodes.length > 0 },

  { id:"undo", label:"Undo", shortcut:"Ctrl/Cmd+Z", description:"Undo the last change", action:undo,
    enabled:() => undoStack.length > 0 },
  { id:"redo", label:"Redo", shortcut:"Ctrl/Cmd+Shift+Z", description:"Redo the last undone change", action:redo,
    enabled:() => redoStack.length > 0 },
  { id:"cut", label:"Cut", shortcut:"Ctrl/Cmd+X", description:"Cut the selected nodes", action:() => copySelection(true),
    enabled:commandHasNodeSelection },
  { id:"copy", label:"Copy", shortcut:"Ctrl/Cmd+C", description:"Copy the selected nodes",
    action:() => { copySelection(false); updateCommandStates(); }, enabled:commandHasNodeSelection },
  { id:"paste", label:"Paste", shortcut:"Ctrl/Cmd+V", description:"Paste copied nodes", action:pasteSelection,
    enabled:commandHasClipboard },
  { id:"duplicate", label:"Duplicate", shortcut:"Ctrl/Cmd+D", description:"Duplicate the selected nodes",
    action:duplicateSelection, enabled:commandHasNodeSelection },
  { id:"delete", label:"Delete", shortcut:"Delete", description:"Delete the selection", action:deleteSelection,
    enabled:commandHasSelection },
  { id:"commandPalette", label:"Quick jump", shortcut:"Ctrl/Cmd+K",
    description:"Search objects or run a command", action:openCommandPalette, palette:false },
  { id:"shortcuts", label:"Shortcuts", shortcut:"?", description:"Show keyboard shortcuts",
    action:openShortcutModal, palette:false },
  { id:"addChild", label:"Add linked child", paletteLabel:"Add linked child concept", shortcut:"Tab",
    description:"Add a linked concept beside the selected node", action:addChildConcept,
    enabled:commandHasSingleContentNode },

  { id:"addConcept", label:"Concept", paletteLabel:"Add concept", shortcut:"C", description:"Add a concept node",
    action:() => addNodeAtViewCenter("concept") },
  { id:"addText", label:"Text", paletteLabel:"Add plain text", shortcut:"X", description:"Add plain text",
    action:() => addNodeAtViewCenter("text") },
  { id:"addStatus", label:"Status", paletteLabel:"Add status node", shortcut:"S", description:"Add a status node",
    action:() => addNodeAtViewCenter("status") },
  { id:"addNote", label:"Rich note", paletteLabel:"Add rich note", shortcut:"N", description:"Add a rich note",
    action:() => addNodeAtViewCenter("note") },
  { id:"addTable", label:"Table", paletteLabel:"Add table", shortcut:"T", description:"Add a table or entity",
    action:() => addNodeAtViewCenter("table") },
  { id:"addTodo", label:"To-do list", paletteLabel:"Add to-do list", shortcut:"D", description:"Add a to-do list",
    action:() => addNodeAtViewCenter("todo") },
  { id:"addFrame", label:"Frame", paletteLabel:"Add frame", description:"Add a subject-area frame",
    action:() => addNodeAtViewCenter("frame") },
  { id:"addHorizontalLane", label:"Horizontal lane", paletteLabel:"Add horizontal swimlane",
    description:"Add a horizontal swimlane",
    action:() => addSwimlane("horizontal") },
  { id:"addVerticalLane", label:"Vertical lane", paletteLabel:"Add vertical swimlane",
    description:"Add a vertical swimlane",
    action:() => addSwimlane("vertical") },

  { id:"layoutTree", label:"Tree", description:"Lay out the selected concept tree", action:layoutMindMapTree,
    enabled:commandHasConcepts },
  { id:"layoutSchema", label:"Schema", description:"Lay out table relations in layers", action:layoutSchemaTables,
    enabled:commandHasTables },
  { id:"cleanupGrid", label:"Clean up", description:"Snap every node to the dot grid", action:cleanUpToGrid,
    enabled:() => state.nodes.length > 0 },
  { id:"toggleSnap", label:"Snap to grid",
    description:"Always snap dragged items to the grid; hold Shift for temporary snapping",
    action:toggleSnapToGrid, pressed:() => snapToGrid },
  { id:"alignTop", label:"Top", description:"Align selected items to the top",
    action:() => alignSelection("top"), enabled:commandHasMultipleNodes },
  { id:"alignMiddle", label:"Middle", description:"Align selected items through the middle",
    action:() => alignSelection("centerY"), enabled:commandHasMultipleNodes },
  { id:"alignBottom", label:"Bottom", description:"Align selected items to the bottom",
    action:() => alignSelection("bottom"), enabled:commandHasMultipleNodes },
  { id:"alignLeft", label:"Left", description:"Align selected items to the left",
    action:() => alignSelection("left"), enabled:commandHasMultipleNodes },
  { id:"alignCenter", label:"Center", description:"Align selected items through the center",
    action:() => alignSelection("centerX"), enabled:commandHasMultipleNodes },
  { id:"alignRight", label:"Right", description:"Align selected items to the right",
    action:() => alignSelection("right"), enabled:commandHasMultipleNodes },
  { id:"distributeHorizontal", label:"Distribute horizontally",
    description:"Distribute selected items with equal horizontal gaps",
    action:() => alignSelection("distributeX"), enabled:commandHasMultipleNodes },
  { id:"distributeVertical", label:"Distribute vertically",
    description:"Distribute selected items with equal vertical gaps",
    action:() => alignSelection("distributeY"), enabled:commandHasMultipleNodes },
  { id:"resetSize", label:"Reset size", description:"Reset forced sizing on selected items",
    action:resetSelectionSizes, enabled:commandHasForcedSize },
  { id:"widthSmallest", label:"Smallest width", description:"Match the smallest selected width",
    action:() => matchSelectionWidths("smallest"), enabled:commandHasMultipleNodes },
  { id:"widthLargest", label:"Largest width", description:"Match the largest selected width",
    action:() => matchSelectionWidths("largest"), enabled:commandHasMultipleNodes },
  { id:"widthAverage", label:"Average width", description:"Match the average selected width",
    action:() => matchSelectionWidths("average"), enabled:commandHasMultipleNodes },
  { id:"bringFront", label:"Bring to front", description:"Draw the selected node in front",
    action:bringSelectionToFront, enabled:commandHasPrimaryNode },
  { id:"sendBack", label:"Send to back", description:"Draw the selected node behind other nodes",
    action:sendSelectionToBack, enabled:commandHasPrimaryNode },

  { id:"importDDL", label:"SQL DDL", description:"Import a supported SQL DDL subset", action:openDdlImport },
  { id:"importCSV", label:"CSV headers", description:"Create a table from CSV headers", action:openCsvImport },
  { id:"lint", label:"Lint schema", description:"Run schema lint checks", action:openLintModal },

  { id:"search", label:"Search", shortcut:"Ctrl/Cmd+F",
    description:"Search every indexed object and property in this diagram", action:openSearchPanel },
  { id:"searchNext", label:"Next result", shortcut:"Ctrl/Cmd+G",
    description:"Open the next search result", action:activateNextSearchResult,
    enabled:commandHasSearchResults },
  { id:"searchPrevious", label:"Previous result", shortcut:"Ctrl/Cmd+Shift+G",
    description:"Open the previous search result", action:activatePreviousSearchResult,
    enabled:commandHasSearchResults },
  { id:"searchReferences", label:"Find references",
    description:"Find indexed references to the selected object", action:openSelectedReferencesSearch,
    enabled:() => !!singleSelectedNode() },
  { id:"searchConnected", label:"Find connected",
    description:"Find the selected objects and every directly connected object", action:openConnectedSearch,
    enabled:commandHasSelection },
  { id:"searchHidden", label:"Find hidden",
    description:"Find objects hidden inside collapsed containers", action:openHiddenSearch },
  { id:"searchDuplicates", label:"Find duplicates",
    description:"Find objects that share the same name", action:openDuplicateNameSearch },

  { id:"fit", label:"Fit diagram", shortcut:"F", description:"Fit the complete diagram in view", action:fitView },
  { id:"actualSize", label:"Actual size", description:"Show the diagram at 100%",
    action:() => zoomAtCanvasCenter(1) },
  { id:"zoomIn", label:"Zoom in", description:"Zoom in around the canvas center",
    action:() => zoomAtCanvasCenter(view.k * 1.2) },
  { id:"zoomOut", label:"Zoom out", description:"Zoom out around the canvas center",
    action:() => zoomAtCanvasCenter(view.k / 1.2) },
  { id:"toggleInspector", label:"Inspector", shortcut:"I", description:"Pin or auto-hide the inspector",
    action:toggleInspector, pressed:() => inspectorPinned },
  { id:"toggleTheme", label:() => docTheme === "dark" ? "Light theme" : "Dark theme",
    description:"Toggle the light or dark canvas theme", action:toggleTheme,
    pressed:() => docTheme === "dark" },

  { id:"exportPNG", label:"PNG", description:"Download the diagram as a PNG image", action:exportPngDocument },
  { id:"exportSVG", label:"SVG", description:"Download the diagram as an SVG vector", action:exportSvgDocument },
  { id:"exportJSON", label:"JSON", description:"Download the native Schematic document", action:exportJsonDocument },
  { id:"exportSQL", label:"SQL DDL", description:"Generate SQL DDL from table nodes", action:openSqlExport },
  { id:"exportMermaid", label:"Mermaid ER", description:"Export a Mermaid ER diagram", action:exportMermaidDocument },
  { id:"exportMarkdown", label:"Markdown", description:"Export the concept map as a Markdown outline",
    action:exportMarkdownDocument }
];

const COMMAND_CATEGORY_IDS = Object.freeze({
  home: new Set(["new","open","save","saveAs","importJson","clear","undo","redo","cut","copy","paste",
    "duplicate","delete","commandPalette","shortcuts","addChild"]),
  insert: new Set(["addConcept","addText","addStatus","addNote","addTable","addTodo","addFrame",
    "addHorizontalLane","addVerticalLane"]),
  arrange: new Set(["layoutTree","layoutSchema","cleanupGrid","toggleSnap","alignTop","alignMiddle",
    "alignBottom","alignLeft","alignCenter","alignRight","distributeHorizontal","distributeVertical",
    "resetSize","widthSmallest","widthLargest","widthAverage","bringFront","sendBack"]),
  model: new Set(["importDDL","importCSV","lint"]),
  view: new Set(["search","searchNext","searchPrevious","searchReferences","searchConnected",
    "searchHidden","searchDuplicates","fit","actualSize","zoomIn","zoomOut","toggleInspector","toggleTheme"]),
  export: new Set(["exportPNG","exportSVG","exportJSON","exportSQL","exportMermaid","exportMarkdown"])
});
const DOCUMENT_MUTATING_COMMANDS = new Set([
  "new","open","importJson","clear","undo","redo","cut","paste","duplicate","delete","addChild",
  "addConcept","addText","addStatus","addNote","addTable","addTodo","addFrame","addHorizontalLane",
  "addVerticalLane","layoutTree","layoutSchema","cleanupGrid","alignTop","alignMiddle","alignBottom",
  "alignLeft","alignCenter","alignRight","distributeHorizontal","distributeVertical","resetSize",
  "widthSmallest","widthLargest","widthAverage","bringFront","sendBack","importDDL","importCSV",
  "toggleTheme"
]);
const SELECTION_SCOPED_COMMANDS = new Set([
  "cut","copy","duplicate","delete","addChild","alignTop","alignMiddle","alignBottom","alignLeft",
  "alignCenter","alignRight","distributeHorizontal","distributeVertical","resetSize","widthSmallest",
  "widthLargest","widthAverage","bringFront","sendBack","searchReferences","searchConnected"
]);
const CAMERA_COMMANDS = new Set(["fit","actualSize","zoomIn","zoomOut"]);
const APPLICATION_COMMANDS = new Set(["commandPalette","shortcuts","toggleSnap","toggleInspector",
  "search","searchNext","searchPrevious","searchHidden","searchDuplicates"]);
const COMMAND_CATEGORY_ICONS = Object.freeze({
  home:"lucide:house", insert:"lucide:plus", arrange:"lucide:align-center",
  model:"lucide:database", view:"lucide:eye", export:"lucide:download"
});
const COMMAND_DISABLED_REASONS = Object.freeze({
  clear:"There is nothing on the canvas to clear.",
  undo:"There is no change to undo.",
  redo:"There is no change to redo.",
  cut:"Select at least one node to cut.",
  copy:"Select at least one node to copy.",
  paste:"Copy or cut at least one node before pasting.",
  duplicate:"Select at least one node to duplicate.",
  delete:"Select a node or link to delete.",
  addChild:"Select one non-container node to add a linked child.",
  layoutTree:"Add a concept node before using Tree layout.",
  layoutSchema:"Add a table before using Schema layout.",
  alignTop:"Select two or more nodes to align.",
  alignMiddle:"Select two or more nodes to align.",
  alignBottom:"Select two or more nodes to align.",
  alignLeft:"Select two or more nodes to align.",
  alignCenter:"Select two or more nodes to align.",
  alignRight:"Select two or more nodes to align.",
  distributeHorizontal:"Select two or more nodes to distribute.",
  distributeVertical:"Select two or more nodes to distribute.",
  resetSize:"Select a node with forced sizing to reset.",
  widthSmallest:"Select two or more nodes to match widths.",
  widthLargest:"Select two or more nodes to match widths.",
  widthAverage:"Select two or more nodes to match widths.",
  bringFront:"Select a node to bring to front.",
  sendBack:"Select a node to send to back.",
  searchNext:"Run a search that has at least one result.",
  searchPrevious:"Run a search that has at least one result.",
  searchReferences:"Select one node to find its references.",
  searchConnected:"Select a node or relationship to find connected objects."
});

function commandCategory(id){
  for (const [category, ids] of Object.entries(COMMAND_CATEGORY_IDS))
    if (ids.has(id)) return category;
  return "home";
}
function normalizeCommandDefinition(raw){
  const category = raw.category || commandCategory(raw.id);
  const mutatesDocument = raw.mutatesDocument ?? DOCUMENT_MUTATING_COMMANDS.has(raw.id);
  const scope = raw.scope || (SELECTION_SCOPED_COMMANDS.has(raw.id) ? "selection"
    : CAMERA_COMMANDS.has(raw.id) ? "camera"
    : APPLICATION_COMMANDS.has(raw.id) ? "application"
    : mutatesDocument ? "document" : "document-read");
  return Object.freeze({
    id:raw.id,
    category,
    label:raw.label,
    shortLabel:raw.shortLabel || raw.label,
    paletteLabel:raw.paletteLabel,
    description:raw.description || "",
    icon:raw.icon || COMMAND_CATEGORY_ICONS[category] || "lucide:circle",
    shortcut:raw.shortcut || "",
    shortcutAliases:Object.freeze([...(raw.shortcutAliases || [])]),
    mutatesDocument,
    scope,
    selection:raw.selection || (SELECTION_SCOPED_COMMANDS.has(raw.id) ? "current selection" : "none"),
    transaction:raw.transaction || (mutatesDocument ? raw.id : ""),
    responsivePriority:raw.responsivePriority || "normal",
    contextual:!!raw.contextual,
    ribbon:raw.ribbon ? Object.freeze({
      tab:raw.ribbon.tab || category,
      group:raw.ribbon.group || "Extensions",
      priority:raw.ribbon.priority || raw.responsivePriority || "normal"
    }) : null,
    owner:raw.owner || "core",
    accessibilityLabel:raw.accessibilityLabel || null,
    announcement:raw.announcement || null,
    enabled:raw.enabled,
    disabledReason:raw.disabledReason || COMMAND_DISABLED_REASONS[raw.id] ||
      "This command is unavailable in the current context.",
    pressed:raw.pressed,
    palette:raw.palette,
    action:raw.action
  });
}

const COMMAND_DEFINITIONS = CORE_COMMAND_DEFINITIONS.map(normalizeCommandDefinition);
const COMMANDS = new Map(COMMAND_DEFINITIONS.map(command => [command.id, command]));
const commandElementCache = new Map();

function commandDefinition(id){ return COMMANDS.get(id) || null; }
function commandLabel(command){
  return typeof command.label === "function" ? command.label() : command.label;
}
function commandIsEnabled(command){
  return !command.enabled || command.enabled();
}
function commandIsPressed(command){
  return command.pressed ? !!command.pressed() : null;
}
function commandDisabledReason(command){
  if (!command || commandIsEnabled(command)) return "";
  return typeof command.disabledReason === "function"
    ? command.disabledReason() : command.disabledReason;
}
function commandAriaShortcut(command){
  if (!command.shortcut) return "";
  const isMac = typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  return command.shortcut
    .replace("Ctrl/Cmd", isMac ? "Meta" : "Control")
    .replace(/\//g, " ");
}
function commandTooltip(command){
  const shortcut = command.shortcut ? ` (${command.shortcut})` : "";
  const unavailable = commandDisabledReason(command);
  return `${command.description || commandLabel(command)}${shortcut}${unavailable ? ` — ${unavailable}` : ""}`;
}
function executeCommand(id, context = {}){
  const command = commandDefinition(id);
  if (!command) return false;
  if (command.mutatesDocument && command.scope === "selection" &&
      typeof organizationSelectionLocked === "function" && organizationSelectionLocked()){
    if (context.announce !== false) announce("The selection contains a locked object.");
    return false;
  }
  if (!commandIsEnabled(command)){
    if (context.announce !== false) announce(commandDisabledReason(command));
    return false;
  }
  const result = command.action(context);
  updateCommandStates();
  if (typeof document !== "undefined")
    document.dispatchEvent(new CustomEvent("schematic:command-executed", {
      detail:{id:command.id, scope:command.scope, mutatesDocument:command.mutatesDocument}
    }));
  if (result && typeof result.then === "function")
    return result.finally(updateCommandStates);
  return result === undefined ? true : result;
}
function commandElements(id, root = document){
  if (root !== document) return [...root.querySelectorAll(`[data-command="${id}"]`)];
  return commandElementCache.get(id) || [];
}
function mountCommandContribution(command){
  if (!command.ribbon || typeof document === "undefined") return null;
  const panel = document.querySelector(`[data-ribbon-panel="${command.ribbon.tab}"]`);
  if (!panel) return null;
  let group = [...panel.querySelectorAll("[data-command-contribution-group]")].find(candidate =>
    candidate.dataset.commandOwner === command.owner &&
    candidate.dataset.commandContributionGroup === command.ribbon.group);
  if (!group){
    group = document.createElement("div");
    group.className = "ribbon-group command-contribution-group";
    if (command.ribbon.priority === "low") group.classList.add("ribbon-low-priority");
    group.dataset.commandOwner = command.owner;
    group.dataset.commandContributionGroup = command.ribbon.group;
    group.setAttribute("aria-label", command.ribbon.group);
    const label = document.createElement("span");
    label.className = "ribbon-group-label";
    label.textContent = command.ribbon.group;
    const grid = document.createElement("div");
    grid.className = "ribbon-command-grid";
    group.append(label, grid);
    const overflow = panel.querySelector(":scope > .ribbon-overflow");
    panel.insertBefore(group, overflow || null);
  }
  const grid = group.querySelector(".ribbon-command-grid");
  const button = document.createElement("button");
  button.dataset.command = command.id;
  button.dataset.commandOwner = command.owner;
  const label = document.createElement("span");
  label.dataset.commandLabel = "";
  label.textContent = commandLabel(command);
  button.appendChild(label);
  grid.appendChild(button);
  bindCommandSurfaces(group);
  updateCommandElement(button, command);
  return button;
}
function registerCommand(definition, opts = {}){
  if (!definition || !/^[a-z][A-Za-z0-9._-]*$/.test(definition.id || ""))
    throw new Error("Command id must start with a lowercase letter and contain only letters, numbers, dot, underscore, or dash.");
  if (typeof definition.action !== "function") throw new Error(`Command "${definition.id}" needs an action.`);
  if (!definition.label) throw new Error(`Command "${definition.id}" needs a label.`);
  const existing = commandDefinition(definition.id);
  if (existing && !opts.replace) throw new Error(`Command "${definition.id}" is already registered.`);
  const command = normalizeCommandDefinition(definition);
  if (existing){
    const index = COMMAND_DEFINITIONS.findIndex(candidate => candidate.id === command.id);
    COMMAND_DEFINITIONS[index] = command;
    COMMANDS.set(command.id, command);
    updateCommandStates();
    return command;
  }
  COMMAND_DEFINITIONS.push(command);
  COMMANDS.set(command.id, command);
  mountCommandContribution(command);
  return command;
}
function unregisterCommandsByOwner(owner){
  if (!owner || owner === "core") return 0;
  const ids = COMMAND_DEFINITIONS.filter(command => command.owner === owner).map(command => command.id);
  if (!ids.length) return 0;
  for (let index = COMMAND_DEFINITIONS.length - 1; index >= 0; index--)
    if (COMMAND_DEFINITIONS[index].owner === owner) COMMAND_DEFINITIONS.splice(index, 1);
  for (const id of ids){
    COMMANDS.delete(id);
    commandElementCache.delete(id);
  }
  if (typeof document !== "undefined"){
    for (const element of document.querySelectorAll("[data-command-owner]"))
      if (element.dataset.commandOwner === owner) element.remove();
  }
  return ids.length;
}
function updateCommandElement(element, command){
  const label = commandLabel(command);
  const enabled = commandIsEnabled(command);
  const pressed = commandIsPressed(command);
  // aria-disabled keeps unavailable commands keyboard reachable so their
  // explanation remains discoverable. executeCommand() remains the guard.
  element.disabled = false;
  element.setAttribute("aria-disabled", String(!enabled));
  element.dataset.commandEnabled = String(enabled);
  element.classList.toggle("command-unavailable", !enabled);
  const reason = enabled ? "" : commandDisabledReason(command);
  const accessibleLabel = command.accessibilityLabel || label;
  element.setAttribute("aria-label", command.shortcut
    ? `${accessibleLabel}, ${command.shortcut}${reason ? `. ${reason}` : ""}`
    : `${accessibleLabel}${reason ? `. ${reason}` : ""}`);
  const ariaShortcut = commandAriaShortcut(command);
  if (ariaShortcut) element.setAttribute("aria-keyshortcuts", ariaShortcut);
  else element.removeAttribute("aria-keyshortcuts");
  element.title = commandTooltip(command);
  if (pressed != null) element.setAttribute("aria-pressed", String(pressed));
  else element.removeAttribute("aria-pressed");
  const labelElement = element.querySelector("[data-command-label]");
  if (labelElement) labelElement.textContent = label;
}
function updateCommandStates(){
  for (const command of COMMAND_DEFINITIONS){
    for (const element of commandElements(command.id)) updateCommandElement(element, command);
  }
}
function bindCommandSurfaces(root = document){
  for (const element of root.querySelectorAll("[data-command]")){
    if (root === document){
      const id = element.dataset.command;
      const elements = commandElementCache.get(id) || [];
      if (!elements.includes(element)) elements.push(element);
      commandElementCache.set(id, elements);
    }
    if (element.dataset.commandBound === "true") continue;
    element.dataset.commandBound = "true";
    element.addEventListener("click", event => {
      executeCommand(element.dataset.command, {event, element});
    });
  }
}
function initializeCommands(){
  commandElementCache.clear();
  bindCommandSurfaces();
  updateCommandStates();
}
function commandPaletteItems(){
  return COMMAND_DEFINITIONS
    .filter(command => command.palette !== false)
    .map(command => ({
      type:"command",
      command:command.id,
      label:command.paletteLabel || commandLabel(command),
      description:command.description,
      shortcut:command.shortcut,
      enabled:commandIsEnabled(command),
      disabledReason:commandDisabledReason(command)
    }));
}

function shortcutCatalog(){
  const order = ["open","save","saveAs","undo","redo","copy","cut","paste","duplicate",
    "search","searchNext","searchPrevious","commandPalette","shortcuts",
    "addConcept","addText","addStatus","addNote","addTable","addTodo",
    "addChild","delete","fit","toggleInspector"];
  const rows = order.map(id => {
    const command = commandDefinition(id);
    return {id, command:id, keys:command.shortcut,
      title:command.paletteLabel || commandLabel(command)};
  });
  rows.splice(5, 0, {id:"redoAlt", command:"redo", keys:"Ctrl/Cmd+Y", title:"Redo"});
  rows.push(
    {id:"escape", keys:"Esc", title:"Close menu or clear selection"},
    {id:"nudge", keys:"Arrow keys", title:"Nudge selected nodes"},
    {id:"nudgeLarge", keys:"Shift+Arrow keys", title:"Nudge selected nodes by 24px"},
    {id:"spacePan", keys:"Space+drag", title:"Pan the canvas"}
  );
  return rows;
}
