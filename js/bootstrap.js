"use strict";

/* --------------------------- Seed data ---------------------------- */
function seed(){
  if (typeof defaultOrganization === "function") state.organization = defaultOrganization();
  if (typeof organizationIsolation !== "undefined") organizationIsolation = null;
  const N = (o) => { o.id = uid(); state.nodes.push(o); return o.id; };
  const E = (from, to, kind, label, fromField, toField, options = {}) => {
    const e = {id: uid(), from, to, kind, label: label||""};
    if (fromField) e.fromField = fromField;
    if (toField)   e.toField   = toField;
    Object.assign(e, options);
    state.edges.push(e);
    return e.id;
  };

  /* Four independent panels make the starter readable at Fit: strategy and
     ports, data modeling, visual primitives, and delivery/link styling. */
  const strategy = N({type:"concept", x:70, y:155, title:"Loyalty program launch",
    notes:"Q3 initiative — north star: repeat purchase rate.", color:"#FFE9A8"});
  const tiers = N({type:"concept", x:70, y:280, title:"Tiered rewards", shape:"rectangle",
    subtitle:"Benefits configuration", icon:"fa:flag", notes:"", color:"#CFE8FF"});
  const referral = N({type:"concept", x:70, y:390, title:"Referral engine",
    shape:"data", subtitle:"Invite loop", icon:"lucide:workflow", notes:"", color:"#CFE8FF"});
  const measure = N({type:"concept", x:315, y:225, title:"Measurement plan",
    portsEnabled:true,
    inputPorts:[{id:"events", label:"Events"}, {id:"targets", label:"Targets"}],
    outputPorts:[{id:"metrics", label:"Metrics"}, {id:"decision", label:"Decision"}],
    notes:"Holdout design + CUPED on pre-period spend.", color:"#D8F3DC"});
  const kpi = N({type:"concept", x:575, y:135, title:"Repeat purchase rate", shape:"circle",
    subtitle:"North-star KPI", icon:"lucide:chart-no-axes-column-increasing", color:"#D8F3DC"});
  const gate = N({type:"concept", x:565, y:340, title:"Launch gate?", shape:"decision",
    subtitle:"Approve or iterate", color:"#FBE8EC"});

  E(strategy, tiers, "link", "Contains", null, null, {
    fromAnchor:"bc", toAnchor:"tc", endArrow:true, lineStyle:"solid"
  });
  E(tiers, referral, "link", "Implements", null, null, {
    fromAnchor:"bc", toAnchor:"tc", endArrow:true
  });
  E(strategy, measure, "link", "Depends on", null, null, {
    fromAnchor:"mr", toPort:"events"
  });
  E(tiers, measure, "link", "Measures", null, null, {
    fromAnchor:"mr", toPort:"targets", endArrow:true, lineColor:"#2456E6"
  });
  E(measure, kpi, "link", "Produces", null, null, {
    fromPort:"metrics", toAnchor:"ml", routing:"ortho", orthoCorner:"square",
    orthoX:550, orthoY:175, endArrow:true, lineColor:"#007873",
    lineWidth:2.5, lineStyle:"solid", labelPosition:.68
  });
  E(measure, gate, "link", "drives", null, null, {
    fromPort:"decision", toAnchor:"ml", endArrow:true, lineColor:"#C20029"
  });

  const customers = N({type:"table", x:815, y:145, title:"customers", color:"#16232F", notes:"", fields:[
    {id:"f_cust_pk",   name:"customer_id", type:"SERIAL", pk:true,  fk:false, nullable:false,
     comment:"stable source identifier"},
    {id:"f_cust_tenant",name:"tenant_id",  type:"INT", pk:false, fk:false, nullable:false,
     comment:"composite partition key"},
    {id:"f_cust_email",name:"email",       type:"VARCHAR(255)", pk:false, fk:false, nullable:false,
     unique:true, index:true},
    {id:"f_cust_tier", name:"tier",        type:"VARCHAR(20)",  pk:false, fk:false, nullable:true},
    {id:"f_cust_join", name:"joined_at",   type:"TIMESTAMP",    pk:false, fk:false, nullable:false,
     default:"CURRENT_TIMESTAMP"}]});
  const orders = N({type:"table", x:1060, y:145, title:"orders", color:"#2456E6", notes:"", fields:[
    {id:"f_ord_pk",   name:"order_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_ord_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_ord_total",name:"total",       type:"DECIMAL(12,2)", pk:false, fk:false, nullable:false},
    {id:"f_ord_ts",   name:"placed_at",   type:"TIMESTAMP",     pk:false, fk:false, nullable:false}]});
  const rewards = N({type:"table", x:815, y:335, title:"reward_events", color:"#1E7A4F", notes:"", fields:[
    {id:"f_rw_pk",   name:"event_id",    type:"SERIAL", pk:true,  fk:false, nullable:false},
    {id:"f_rw_tenant",name:"tenant_id",   type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_rw_cust", name:"customer_id", type:"INT",    pk:false, fk:true,  nullable:false},
    {id:"f_rw_pts",  name:"points",      type:"INT",    pk:false, fk:false, nullable:false},
    {id:"f_rw_why",  name:"reason",      type:"VARCHAR(50)", pk:false, fk:false, nullable:true}]});
  const audit = N({type:"table", x:1310, y:155, title:"audit_log", color:"#6B7683", notes:"",
    collapsed:true, fields:[
      {id:"f_audit_pk", name:"audit_id", type:"BIGINT", pk:true, fk:false, nullable:false},
      {id:"f_audit_actor", name:"actor", type:"VARCHAR(80)", pk:false, fk:false, nullable:false}
    ]});
  const orderRewards = N({type:"table", x:1090, y:440, title:"orders_reward_events",
    color:"#8A3FA8", notes:"N:M junction", collapsed:true, fields:[
      {id:"f_ore_order", name:"order_id", type:"INT", pk:true, fk:true, nullable:false},
      {id:"f_ore_event", name:"event_id", type:"INT", pk:true, fk:true, nullable:false}
    ]});

  E(customers, orders,  "1:N", "", "f_cust_pk", "f_ord_cust");
  E(customers, rewards, "1:N", "", "f_cust_pk", "f_rw_cust", {pairs:[
    {fromField:"f_cust_pk", toField:"f_rw_cust"},
    {fromField:"f_cust_tenant", toField:"f_rw_tenant"}
  ]});
  E(orders, rewards, "N:M", "earns", null, null, {
    fromAnchor:"bc", toAnchor:"tr", lineColor:"#8A3FA8", lineStyle:"dot",
    labelPosition:.62
  });
  E(orders, audit, "1:1", "Writes to", null, null, {
    fromAnchor:"hr", toAnchor:"hl", lineColor:"#6B7683"
  });
  E(orders, orderRewards, "1:N", "", "f_ord_pk", "f_ore_order");
  E(rewards, orderRewards, "1:N", "", "f_rw_pk", "f_ore_event");

  /* Structural nodes are added after their content so they remain easy to
     discover in the seed while render() paints each container behind it. */
  N({type:"text", x:38, y:12, title:"Loyalty program system map", fontSize:30,
     fontColor:"#16232F", color:"#CFE8FF", w:520});
  N({type:"frame", x:30, y:75, title:"Strategy & experiments", color:"#007873", w:720, h:450,
     borderEnabled:true, borderWidth:2, borderColor:"#007873"});
  N({type:"swimlane", orientation:"horizontal", x:780, y:75, title:"Data model",
     color:"#E7F4F3", titleColor:"#007873", w:840, h:450});

  N({type:"text", x:60, y:635, title:"Exact 220 × 84 px",
    shape:"rectangle", color:"#00787333", fontColor:"#16232F", fontSize:17,
    manualWidth:true, w:220, manualHeight:true, h:84, wrapText:false,
    textMarginTop:12, textMarginRight:18, textMarginBottom:12, textMarginLeft:18});
  const manual = N({type:"concept", x:320, y:620, title:"Manual intake", shape:"manualInput",
    subtitle:"Operator supplied", icon:"fa:keyboard", color:"#CFE8FF"});
  const triangle = N({type:"concept", x:545, y:610, title:"Risk signal", shape:"triangle",
    subtitle:"Threshold alert", color:"#FBE8EC"});
  const square = N({type:"concept", x:70, y:800, title:"KPI tile", shape:"square",
    subtitle:"Compact metric", color:"#D8F3DC"});
  const readout = N({type:"concept", x:285, y:800, title:"Experiment readout", shape:"document",
    subtitle:"Portable decision brief", icon:"fa:circle-info", color:"#FFE9A8"});
  const legacy = N({type:"concept", x:520, y:850, title:"Legacy cohort analysis",
    shape:"rectangle", subtitle:"Hidden with its frame", color:"#E4E7EC"});
  N({type:"frame", x:500, y:790, title:"Archived workstream", color:"#6B7683",
    w:220, h:145, collapsed:true, borderEnabled:true, borderWidth:2, borderColor:"#6B7683"});
  N({type:"frame", x:30, y:555, title:"Visual primitives", color:"#C20029", w:720, h:415,
    borderEnabled:true, borderWidth:4, borderColor:"#C20029"});

  E(manual, triangle, "link", "Validates", null, null, {
    fromAnchor:"mr", toAnchor:"ml", endArrow:true, lineColor:"#C20029"
  });
  E(square, readout, "link", "Produces", null, null, {
    fromAnchor:"mr", toAnchor:"ml", startArrow:true, endArrow:true,
    lineColor:"#C20029", lineWidth:3, lineStyle:"solid"
  });
  E(readout, legacy, "link", "References", null, null, {
    fromAnchor:"mr", toAnchor:"ml", lineColor:"#6B7683"
  });

  const evidence = N({type:"note", x:830, y:605, title:"Launch decision",
     content:"## Why this matters\n- **Hypothesis:** tiers increase repeat orders\n- [x] Define the holdout\n- [ ] Review guardrails\n`owner: Growth + Data`",
     color:"#FFE9A8", fontSize:13, w:220});
  const approval = N({type:"status", x:1115, y:610, title:"Launch approval",
     subtitle:"Executive decision", icon:"emoji:🚦", status:"In progress",
     statusSide:"right", color:"#CFE8FF", fontSize:16, w:250});
  const review = N({type:"status", x:1110, y:750, title:"Release checkpoint",
    subtitle:"Owner: Growth Ops", icon:"emoji:👀", status:"Blocked", statusSide:"left",
    color:"#C2002933", fontSize:16, w:250});
  const checklist = N({type:"todo", x:1390, y:595, title:"Launch readiness", notes:"",
     color:"#E9E2F8", w:190, items:[
       {id:"i_release_design", text:"Approve experiment design", done:true},
       {id:"i_release_events", text:"Validate tracking events"},
       {id:"i_release_readout", text:"Schedule results readout"}
     ]});
  const intake = N({type:"concept", x:850, y:880, title:"Event intake", shape:"data",
    subtitle:"Input events", icon:"fa:bolt", color:"#CFE8FF"});
  const engine = N({type:"concept", x:1080, y:880, title:"Rules engine",
    subtitle:"Scoring + eligibility", icon:"emoji:⚙️", color:"#FFE9A8"});
  const decisionApi = N({type:"concept", x:1285, y:880, title:"Decision API", shape:"terminator",
    subtitle:"Output decision", icon:"lucide:rocket", color:"#D8F3DC"});

  E(evidence, approval, "link", "Supports", null, null, {
    fromAnchor:"mr", toAnchor:"ml", endArrow:true, lineColor:"#007873", lineStyle:"solid"
  });
  E(approval, checklist, "link", "Triggers", null, "i_release_events", {
    fromAnchor:"mr", routing:"ortho", endArrow:true,
    orthoX:1380, orthoY:680,
    lineColor:"#007873", lineWidth:2.5, lineStyle:"dot",
    labelTextColor:"#FFFFFF", labelBackgroundColor:"#C20029", labelPosition:.66
  });
  E(intake, engine, "link", "Reads from", null, null, {
    fromAnchor:"mr", toAnchor:"ml", endArrow:true, lineColor:"#2456E6"
  });
  E(engine, decisionApi, "link", "Calculates", null, null, {
    fromAnchor:"mr", toAnchor:"ml", startArrow:true, endArrow:true,
    lineColor:"#8A3FA8", lineWidth:3, lineStyle:"solid", labelPosition:.64,
    labelTextColor:"#FFFFFF", labelBackgroundColor:"#007873"
  });
  N({type:"swimlane", orientation:"vertical", x:780, y:555, title:"Delivery & links",
     color:"#FBE8EC", titleColor:"#C20029", w:840, h:415});
}
function perfSeed(n = 500){
  state.nodes = [];
  state.edges = [];
  state.nextId = 1;
  if (typeof defaultOrganization === "function") state.organization = defaultOrganization();
  if (typeof organizationIsolation !== "undefined") organizationIsolation = null;
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
if (typeof ensureOrganization === "function") ensureOrganization();
ensureFieldIds();
initializeCommands();
if (typeof initializeOrganizationCommands === "function") initializeOrganizationCommands();
setupRibbon();
if (typeof initializeOrganizationUi === "function") initializeOrganizationUi();
render();
syncHistoryButtons();
updateDocLabel();
syncAriaLabels();
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
  smartDistributionSnap,
  smartObjectSnap,
  alignmentGuideGeometry,
  conceptShape,
  setConceptShape,
  nodeIcon,
  nodeIconLibrary,
  nodeIconOptions,
  setNodeIcon,
  nodeSubtitle,
  setNodeSubtitle,
  normalizeNodeDecoration,
  nodePortsEnabled,
  nodePortsForSide,
  nodeInputPorts,
  nodeOutputPorts,
  nodeInputLabel,
  nodeOutputLabel,
  nodePortById,
  nodePortBinding,
  setNodePortsEnabled,
  setNodePortLabel,
  addNodePort,
  removeNodePort,
  normalizeNodePorts,
  normalizeEdgePortBindings,
  nodePortPoints,
  nodePortAnchor,
  get NODE_ICON_LIBRARIES(){ return NODE_ICON_LIBRARIES.map(([id, label]) => ({id, label})); },
  textBoxShape,
  setTextBoxShape,
  textBoxLayout,
  textBoxFont,
  textBoxWrapEnabled,
  setTextBoxWrapping,
  textBoxMargin,
  textBoxMargins,
  setTextBoxMargin,
  manualNodeHeight,
  setTextBoxHeight,
  resetTextBoxHeight,
  hasForcedNodeSize,
  statusNodeLayout,
  statusBandContainsPoint,
  statusNodeFont,
  statusOptions,
  addCustomStatus,
  cleanStatusLabel,
  normalizeNodeStatus,
  statusColor,
  get customStatuses(){ return customStatuses.slice(); },
  get STATUS_BUILTINS(){ return STATUS_BUILTINS.map(([name, color]) => ({name, color})); },
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
  rectFullyContains,
  documentBounds,
  hitTest,
  frameContainedNodes,
  containerContainedNodes,
  collapsedFrameContentNodes,
  collapsedFrameHiddenNodeIds,
  collapsedFrameProxyMap,
  visibleCanvasNodes,
  visibleCanvasEdges,
  expandedFrameRect,
  isStructuralNode,
  swimlaneOrientation,
  setSwimlaneOrientation,
  get SWIMLANE_DEFAULT(){ return JSON.parse(JSON.stringify(SWIMLANE_DEFAULT)); },
  addNode,
  addSwimlane,
  setFrameCollapsed,
  addEdge,
  matchSelectionWidths,
  resetSelectionSizes,
  edgeFieldPairs,
  setEdgePairs,
  edgeEndpoints,
  edgePath,
  edgeRenderPath,
  edgeLabelPoint,
  edgeLabelPosition,
  setEdgeLabelPosition,
  curveEdgePointAt,
  polylinePointAt,
  projectPointToPolyline,
  projectEdgeLabelToPath,
  edgeLabelDragPosition,
  swapEdgeDirection,
  edgeLineColor,
  edgeLabelTextColor,
  edgeLabelBackgroundColor,
  polylineMidpoint,
  notationVertex,
  orthoEdgeRoute,
  orthoRouteCornerHandles,
  setOrthoCornerPosition,
  orthoCornerStyle,
  setOrthoCornerStyle,
  squarePolylinePath,
  roundedPolylinePath,
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
  clearRecentColors,
  get recentColors(){ return recentColors; },
  normalizeColorScheme,
  applyColorScheme,
  get colorScheme(){ return colorScheme; },
  conceptColors,
  tableColors,
  fontColors,
  frameColorDefault,
  frameBorderEnabled,
  frameBorderWidth,
  frameBorderColor,
  setFrameBorderEnabled,
  setFrameBorderWidth,
  todoColorDefault,
  themeColors,
  autoInk,
  relativeLuminance,
  normalizeHex,
  normalizeColorValue,
  colorBaseHex,
  colorTransparency,
  composeColorValue,
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
  refreshSearchIndex,
  querySearchIndex,
  searchIndexStats,
  normalizeSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  searchPanelOpen,
  runSearch,
  activateSearchResult,
  activateNextSearchResult,
  activatePreviousSearchResult,
  searchRestoreNavigation,
  selectAllSearchResults,
  buildSearchReplaceProposal,
  previewSearchReplace,
  applySearchReplace,
  openConnectedSearch,
  openSelectedReferencesSearch,
  openHiddenSearch,
  openOffCanvasSearch,
  openDuplicateNameSearch,
  ensureOrganization,
  cleanOrganizationForDocument,
  normalizeOrganization,
  organizationLayers,
  organizationGroups,
  organizationLayerById,
  organizationGroupById,
  organizationGroupAncestors,
  organizationGroupLayerId,
  organizationObjectLayerId,
  organizationObjectLayer,
  organizationLayerOpacity,
  organizationObjectHidden,
  organizationObjectLocked,
  organizationEffectiveEvaluation,
  invalidateOrganizationEvaluation,
  organizationalHiddenNodeIds,
  hiddenCanvasNodeIds,
  organizationAssignActiveLayer,
  organizationSetObjectLayer,
  organizationSetNodeGroup,
  organizationGroupDescendants,
  organizationGroupMemberNodes,
  organizationSetGroupParent,
  createOrganizationLayer,
  createOrganizationGroupFromSelection,
  ungroupOrganizationGroup,
  deleteOrganizationGroupContents,
  duplicateOrganizationGroup,
  organizationReorderGroup,
  organizationSetHidden,
  organizationSetLocked,
  organizationShowAll,
  organizationRevealSelection,
  organizationIsolateCurrent,
  organizationAllRows,
  organizationFilteredRows,
  organizationApplyDrop,
  objectExplorerOpen,
  setObjectExplorerOpen,
  toggleObjectExplorer,
  renderOrganizationExplorer,
  filterOrganizationExportClone,
  get organizationIsolation(){ return organizationIsolation ? {...organizationIsolation} : null; },
  get organizationExplorerTarget(){ return organizationExplorerTarget ? {...organizationExplorerTarget} : null; },
  get organizationFlatRows(){ return organizationFlatCache.map(row => ({...row})); },
  get searchResults(){ return searchResults.map(result => ({...result})); },
  get searchProposal(){ return searchProposal ? searchProposal.map(change => ({...change})) : null; },
  get searchIndexGeneration(){ return searchIndexGeneration; },
  get SHORTCUTS(){ return shortcutCatalog(); },
  get COMMANDS(){ return COMMAND_DEFINITIONS.map(command => ({
    id:command.id,
    category:command.category,
    label:commandLabel(command),
    shortcut:command.shortcut || "",
    icon:command.icon,
    scope:command.scope,
    mutatesDocument:command.mutatesDocument,
    transaction:command.transaction,
    owner:command.owner,
    enabled:commandIsEnabled(command),
    disabledReason:commandDisabledReason(command)
  })); },
  executeCommand,
  commandDefinition,
  commandDisabledReason,
  registerCommand,
  unregisterCommandsByOwner,
  updateCommandStates,
  activateRibbonTab,
  setRibbonCollapsed,
  get ribbonCollapsed(){ return ribbonCollapsed; },
  get activeRibbonTab(){ return activeRibbonTab; }
};
