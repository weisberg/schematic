"use strict";

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
  const approval = N({type:"status", x:1310, y:300, title:"Launch approval",
     status:"In progress", statusSide:"right", color:"#CFE8FF", fontSize:16, w:240});
  const checklist = N({type:"todo", x:1320, y:385, title:"Launch readiness", notes:"",
     color:"#E9E2F8", items:[
       {id:"i_release_design", text:"Approve experiment design", done:true},
       {id:"i_release_events", text:"Validate tracking events"},
       {id:"i_release_readout", text:"Schedule results readout"}
     ]});

  E(orders, evidence, "link", "Produces", null, null, {
    fromAnchor:"mr", toAnchor:"ml", endArrow:true, lineColor:"#007873", lineStyle:"solid"
  });
  E(evidence, approval, "link", "Validates", null, null, {
    fromAnchor:"bc", toAnchor:"tc", endArrow:true, lineColor:"#007873", lineStyle:"solid"
  });
  E(approval, checklist, "link", "Triggers", null, null, {
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
  statusNodeLayout,
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
  clearRecentColors,
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
  get SHORTCUTS(){ return SHORTCUTS.slice(); }
};
