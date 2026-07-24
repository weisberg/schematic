"use strict";

/*
 * A deliberately small, offline catalog for node decorations. The source
 * libraries and licenses are recorded in THIRD_PARTY_NOTICES.md. Keeping the
 * SVG data here means icons work in exported/local diagrams without a CDN.
 */
const NODE_ICON_LIBRARIES = [
  ["none", "No icon"],
  ["emoji", "Emoji"],
  ["lucide", "Lucide"],
  ["fa", "Font Awesome"]
];
const NODE_PORT_LABEL_MAX = 80;
const NODE_PORT_MAX = 16;

const LUCIDE_NODE_ICONS = {
  activity: {label:"Activity", elements:[
    ["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]
  ]},
  bell: {label:"Bell", elements:[
    ["path",{d:"M10.268 21a2 2 0 0 0 3.464 0"}],
    ["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]
  ]},
  box: {label:"Box", elements:[
    ["path",{d:"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"}],
    ["path",{d:"m3.3 7 8.7 5 8.7-5"}], ["path",{d:"M12 22V12"}]
  ]},
  cloud: {label:"Cloud", elements:[
    ["path",{d:"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"}]
  ]},
  "calendar-days": {label:"Calendar", elements:[
    ["path",{d:"M8 2v4"}], ["path",{d:"M16 2v4"}],
    ["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2"}],
    ["path",{d:"M3 10h18"}], ["path",{d:"M8 14h.01"}],
    ["path",{d:"M12 14h.01"}], ["path",{d:"M16 14h.01"}],
    ["path",{d:"M8 18h.01"}], ["path",{d:"M12 18h.01"}],
    ["path",{d:"M16 18h.01"}]
  ]},
  "chart-no-axes-column-increasing": {label:"Chart", elements:[
    ["path",{d:"M5 21v-6"}], ["path",{d:"M12 21V9"}], ["path",{d:"M19 21V3"}]
  ]},
  "code-xml": {label:"Code", elements:[
    ["path",{d:"m18 16 4-4-4-4"}], ["path",{d:"m6 8-4 4 4 4"}],
    ["path",{d:"m14.5 4-5 16"}]
  ]},
  database: {label:"Database", elements:[
    ["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3"}],
    ["path",{d:"M3 5V19A9 3 0 0 0 21 19V5"}],
    ["path",{d:"M3 12A9 3 0 0 0 21 12"}]
  ]},
  lightbulb: {label:"Lightbulb", elements:[
    ["path",{d:"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],
    ["path",{d:"M9 18h6"}], ["path",{d:"M10 22h4"}]
  ]},
  rocket: {label:"Rocket", elements:[
    ["path",{d:"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"}],
    ["path",{d:"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"}],
    ["path",{d:"M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"}],
    ["path",{d:"M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"}]
  ]},
  server: {label:"Server", elements:[
    ["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2"}],
    ["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2"}],
    ["line",{x1:"6",x2:"6.01",y1:"6",y2:"6"}],
    ["line",{x1:"6",x2:"6.01",y1:"18",y2:"18"}]
  ]},
  workflow: {label:"Workflow", elements:[
    ["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2"}],
    ["path",{d:"M7 11v4a2 2 0 0 0 2 2h4"}],
    ["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2"}]
  ]}
};

const FONT_AWESOME_NODE_ICONS = {
  bolt: {label:"Bolt", width:448, height:512,
    path:"M338.8-9.9c11.9 8.6 16.3 24.2 10.9 37.8L271.3 224 416 224c13.5 0 25.5 8.4 30.1 21.1s.7 26.9-9.6 35.5l-288 240c-11.3 9.4-27.4 9.9-39.3 1.3s-16.3-24.2-10.9-37.8L176.7 288 32 288c-13.5 0-25.5-8.4-30.1-21.1s-.7-26.9 9.6-35.5l288-240c11.3-9.4 27.4-9.9 39.3-1.3z"},
  building: {label:"Building", width:384, height:512,
    path:"M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-384c0-35.3-28.7-64-64-64L64 0zM176 352l32 0c17.7 0 32 14.3 32 32l0 80-96 0 0-80c0-17.7 14.3-32 32-32zM96 112c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zM240 96l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM96 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm144-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16z"},
  bullseye: {label:"Bullseye", width:512, height:512,
    path:"M448 256a192 192 0 1 0 -384 0 192 192 0 1 0 384 0zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zm256 80a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm0-224a144 144 0 1 1 0 288 144 144 0 1 1 0-288zM224 256a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"},
  "circle-info": {label:"Info", width:512, height:512,
    path:"M256 512a256 256 0 1 0 0-512 256 256 0 1 0 0 512zM224 160a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm-8 64l48 0c13.3 0 24 10.7 24 24l0 88 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l24 0 0-64-24 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z"},
  database: {label:"Database", width:448, height:512,
    path:"M448 205.8c-14.8 9.8-31.8 17.7-49.5 24-47 16.8-108.7 26.2-174.5 26.2S96.4 246.5 49.5 229.8c-17.6-6.3-34.7-14.2-49.5-24L0 288c0 44.2 100.3 80 224 80s224-35.8 224-80l0-82.2zm0-77.8l0-48C448 35.8 347.7 0 224 0S0 35.8 0 80l0 48c0 44.2 100.3 80 224 80s224-35.8 224-80zM398.5 389.8C351.6 406.5 289.9 416 224 416S96.4 406.5 49.5 389.8c-17.6-6.3-34.7-14.2-49.5-24L0 432c0 44.2 100.3 80 224 80s224-35.8 224-80l0-66.2c-14.8 9.8-31.8 17.7-49.5 24z"},
  flag: {label:"Flag", width:448, height:512,
    path:"M64 32C64 14.3 49.7 0 32 0S0 14.3 0 32L0 480c0 17.7 14.3 32 32 32s32-14.3 32-32l0-121.6 62.7-18.8c41.9-12.6 87.1-8.7 126.2 10.9 42.7 21.4 92.5 24 137.2 7.2l37.1-13.9c12.5-4.7 20.8-16.6 20.8-30l0-247.7c0-23-24.2-38-44.8-27.7l-11.8 5.9c-44.9 22.5-97.8 22.5-142.8 0-36.4-18.2-78.3-21.8-117.2-10.1L64 54.4 64 32z"},
  folder: {label:"Folder", width:512, height:512,
    path:"M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z"},
  gear: {label:"Gear", width:512, height:512,
    path:"M195.1 9.5C198.1-5.3 211.2-16 226.4-16l59.8 0c15.2 0 28.3 10.7 31.3 25.5L332 79.5c14.1 6 27.3 13.7 39.3 22.8l67.8-22.5c14.4-4.8 30.2 1.2 37.8 14.4l29.9 51.8c7.6 13.2 4.9 29.8-6.5 39.9L447 233.3c.9 7.4 1.3 15 1.3 22.7s-.5 15.3-1.3 22.7l53.4 47.5c11.4 10.1 14 26.8 6.5 39.9l-29.9 51.8c-7.6 13.1-23.4 19.2-37.8 14.4l-67.8-22.5c-12.1 9.1-25.3 16.7-39.3 22.8l-14.4 69.9c-3.1 14.9-16.2 25.5-31.3 25.5l-59.8 0c-15.2 0-28.3-10.7-31.3-25.5l-14.4-69.9c-14.1-6-27.2-13.7-39.3-22.8L73.5 432.3c-14.4 4.8-30.2-1.2-37.8-14.4L5.8 366.1c-7.6-13.2-4.9-29.8 6.5-39.9l53.4-47.5c-.9-7.4-1.3-15-1.3-22.7s.5-15.3 1.3-22.7L12.3 185.8c-11.4-10.1-14-26.8-6.5-39.9L35.7 94.1c7.6-13.2 23.4-19.2 37.8-14.4l67.8 22.5c12.1-9.1 25.3-16.7 39.3-22.8L195.1 9.5zM256.3 336a80 80 0 1 0 -.6-160 80 80 0 1 0 .6 160z"},
  globe: {label:"Globe", width:512, height:512,
    path:"M351.9 280l-190.9 0c2.9 64.5 17.2 123.9 37.5 167.4 11.4 24.5 23.7 41.8 35.1 52.4 11.2 10.5 18.9 12.2 22.9 12.2s11.7-1.7 22.9-12.2c11.4-10.6 23.7-28 35.1-52.4 20.3-43.5 34.6-102.9 37.5-167.4zM160.9 232l190.9 0C349 167.5 334.7 108.1 314.4 64.6 303 40.2 290.7 22.8 279.3 12.2 268.1 1.7 260.4 0 256.4 0s-11.7 1.7-22.9 12.2c-11.4 10.6-23.7 28-35.1 52.4-20.3 43.5-34.6 102.9-37.5 167.4zm-48 0C116.4 146.4 138.5 66.9 170.8 14.7 78.7 47.3 10.9 131.2 1.5 232l111.4 0zM1.5 280c9.4 100.8 77.2 184.7 169.3 217.3-32.3-52.2-54.4-131.7-57.9-217.3L1.5 280zm398.4 0c-3.5 85.6-25.6 165.1-57.9 217.3 92.1-32.7 159.9-116.5 169.3-217.3l-111.4 0zm111.4-48C501.9 131.2 434.1 47.3 342 14.7 374.3 66.9 396.4 146.4 399.9 232l111.4 0z"},
  sitemap: {label:"Sitemap", width:512, height:512,
    path:"M192 64c0-17.7 14.3-32 32-32l64 0c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32l-8 0 0 64 120 0c39.8 0 72 32.2 72 72l0 56 8 0c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l8 0 0-56c0-13.3-10.7-24-24-24l-120 0 0 80 8 0c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l8 0 0-80-120 0c-13.3 0-24 10.7-24 24l0 56 8 0c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l8 0 0-56c0-39.8 32.2-72 72-72l120 0 0-64-8 0c-17.7 0-32-14.3-32-32l0-64z"},
  "shield-halved": {label:"Shield", width:512, height:512,
    path:"M256 0c4.6 0 9.2 1 13.4 2.9L457.8 82.8c22 9.3 38.4 31 38.3 57.2-.5 99.2-41.3 280.7-213.6 363.2-16.7 8-36.1 8-52.8 0-172.4-82.5-213.1-264-213.6-363.2-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.9 1 251.4 0 256 0zm0 66.8l0 378.1c138-66.8 175.1-214.8 176-303.4l-176-74.6 0 0z"},
  users: {label:"Users", width:640, height:512,
    path:"M320 16a104 104 0 1 1 0 208 104 104 0 1 1 0-208zM96 88a72 72 0 1 1 0 144 72 72 0 1 1 0-144zM0 416c0-70.7 57.3-128 128-128 12.8 0 25.2 1.9 36.9 5.4-32.9 36.8-52.9 85.4-52.9 138.6l0 16c0 11.4 2.4 22.2 6.7 32L32 480c-17.7 0-32-14.3-32-32l0-32zm521.3 64c4.3-9.8 6.7-20.6 6.7-32l0-16c0-53.2-20-101.8-52.9-138.6 11.7-3.5 24.1-5.4 36.9-5.4 70.7 0 128 57.3 128 128l0 32c0 17.7-14.3 32-32 32l-86.7 0zM472 160a72 72 0 1 1 144 0 72 72 0 1 1 -144 0zM160 432c0-88.4 71.6-160 160-160s160 71.6 160 160l0 16c0 17.7-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32l0-16z"}
};

const NODE_ICON_CATALOGS = {
  lucide:LUCIDE_NODE_ICONS,
  fa:FONT_AWESOME_NODE_ICONS
};

function nodeSupportsDecoration(n){
  return !!n && (n.type === "concept" || n.type === "status");
}
function cleanNodeSubtitle(value){
  return String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim().slice(0, 500);
}
function cleanNodeEmoji(value){
  const clean = String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(clean).slice(0, 16).join("");
}
function parseNodeIcon(value){
  const source = String(value == null ? "" : value);
  const split = source.indexOf(":");
  if (split < 1) return null;
  const library = source.slice(0, split);
  const name = source.slice(split + 1);
  if (library === "emoji"){
    const emoji = cleanNodeEmoji(name);
    return emoji ? {library, name:emoji, token:`emoji:${emoji}`} : null;
  }
  const catalog = NODE_ICON_CATALOGS[library];
  if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, name)) return null;
  return {library, name, token:`${library}:${name}`, data:catalog[name]};
}
function nodeIcon(n){
  return nodeSupportsDecoration(n) ? parseNodeIcon(n.icon) : null;
}
function nodeIconLibrary(n){
  const icon = nodeIcon(n);
  return icon ? icon.library : "none";
}
function nodeIconOptions(library){
  const catalog = NODE_ICON_CATALOGS[library] || {};
  return Object.entries(catalog).map(([value, data]) => [value, data.label]);
}
function setNodeIcon(n, value){
  if (!nodeSupportsDecoration(n)) return;
  const icon = parseNodeIcon(value);
  if (icon) n.icon = icon.token;
  else delete n.icon;
}
function nodeSubtitle(n){
  return nodeSupportsDecoration(n) ? cleanNodeSubtitle(n.subtitle) : "";
}
function setNodeSubtitle(n, value){
  if (!nodeSupportsDecoration(n)) return;
  const subtitle = cleanNodeSubtitle(value);
  if (subtitle) n.subtitle = subtitle;
  else delete n.subtitle;
}
function normalizeNodeDecoration(n){
  if (!nodeSupportsDecoration(n)){
    delete n.icon;
    delete n.subtitle;
    return;
  }
  setNodeIcon(n, n.icon);
  setNodeSubtitle(n, n.subtitle);
}

/* Optional concept-node link ports. Legacy single-caption fields remain a
   compact implicit one-port model; arrays are materialized only when a node
   needs multiple stable, edge-bindable ports. */
function nodeSupportsLinkPorts(n){
  return !!n && n.type === "concept";
}
function cleanNodePortLabel(value, fallback){
  const label = String(value == null ? "" : value)
    .replace(/\s+/g, " ").trim().slice(0, NODE_PORT_LABEL_MAX);
  return label || fallback;
}
function nodePortsEnabled(n){
  return nodeSupportsLinkPorts(n) && n.portsEnabled === true;
}
function nodePortConfig(side){
  if (side === "input")
    return {key:"inputPorts", legacyKey:"inputLabel", fallback:"Input", id:"input", prefix:"in"};
  if (side === "output")
    return {key:"outputPorts", legacyKey:"outputLabel", fallback:"Output", id:"output", prefix:"out"};
  return null;
}
function cleanNodePortId(value){
  return String(value == null ? "" : value).trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function normalizedNodePortList(raw, side){
  const config = nodePortConfig(side);
  if (!config || !Array.isArray(raw)) return [];
  const result = [], used = new Set();
  for (const candidate of raw.slice(0, NODE_PORT_MAX)){
    if (!candidate || typeof candidate !== "object") continue;
    let id = cleanNodePortId(candidate.id);
    if (!id || used.has(id)){
      let index = result.length + 1;
      do { id = `${config.prefix}${index++}`; } while (used.has(id));
    }
    used.add(id);
    const fallback = raw.length > 1 ? `${config.fallback} ${result.length + 1}` : config.fallback;
    const port={...candidate,id,label:cleanNodePortLabel(candidate.label, fallback)};
    const type=String(candidate.type||"").trim().toLowerCase();
    if(type)port.type=type;else delete port.type;
    const group=String(candidate.group||"").trim().slice(0,60);
    if(group)port.group=group;else delete port.group;
    if(!["one","many"].includes(candidate.multiplicity))delete port.multiplicity;
    if(Number.isFinite(Number(candidate.order)))port.order=Number(candidate.order);
    else delete port.order;
    if(["left","right"].includes(candidate.placement))port.placement=candidate.placement;
    else delete port.placement;
    if(Array.isArray(candidate.allowedRelationships)){
      port.allowedRelationships=[...new Set(candidate.allowedRelationships.map(String)
        .map(value=>value.trim()).filter(Boolean))].slice(0,24);
      if(!port.allowedRelationships.length)delete port.allowedRelationships;
    }else delete port.allowedRelationships;
    result.push(port);
  }
  return result;
}
function nodePortsForSide(n, side){
  const config = nodePortConfig(side);
  if (!config || !nodePortsEnabled(n)) return [];
  const stored = normalizedNodePortList(n[config.key], side);
  if (stored.length) return stored.map((port,index)=>({port,index}))
    .sort((a,b)=>(a.port.order??a.index)-(b.port.order??b.index)||a.index-b.index)
    .map(item=>item.port);
  return [{id:config.id, label:cleanNodePortLabel(n[config.legacyKey], config.fallback)}];
}
function nodeInputPorts(n){ return nodePortsForSide(n, "input"); }
function nodeOutputPorts(n){ return nodePortsForSide(n, "output"); }
function nodeInputLabel(n){
  return nodeInputPorts(n)[0]?.label || "Input";
}
function nodeOutputLabel(n){
  return nodeOutputPorts(n)[0]?.label || "Output";
}
function materializeNodePorts(n, side){
  const config = nodePortConfig(side);
  if (!config || !nodeSupportsLinkPorts(n)) return [];
  const current = nodePortsForSide(n, side);
  n[config.key] = current.map(port => ({...port}));
  delete n[config.legacyKey];
  return n[config.key];
}
function nextNodePortId(n, side){
  const config = nodePortConfig(side);
  if (!config) return "";
  const used = new Set(nodePortsForSide(n, side).map(port => port.id));
  let index = 1, id;
  do { id = `${config.prefix}${index++}`; } while (used.has(id));
  return id;
}
function nodePortById(n, side, id){
  return nodePortsForSide(n, side).find(port => port.id === id) || null;
}
function nodePortBinding(n, id, preferredSide){
  if (!nodePortsEnabled(n) || !id) return null;
  const sides = preferredSide === "input" ? ["input","output"] : ["output","input"];
  for (const side of sides){
    const port = nodePortById(n, side, id);
    if (port) return {side, port};
  }
  return null;
}
function setNodePortsEnabled(n, enabled){
  if (!nodeSupportsLinkPorts(n)) return false;
  if (enabled === true) n.portsEnabled = true;
  else {
    delete n.portsEnabled;
    delete n.inputLabel;
    delete n.outputLabel;
    delete n.inputPorts;
    delete n.outputPorts;
    for (const edge of state.edges || []){
      if (edge.from === n.id && edge.fromPort) edge.fromPortUnresolved = true;
      if (edge.to === n.id && edge.toPort) edge.toPortUnresolved = true;
    }
  }
  return true;
}
function setNodePortLabel(n, side, value, portId = null){
  const config = nodePortConfig(side);
  if (!nodeSupportsLinkPorts(n) || !config) return false;
  const ports = Array.isArray(n[config.key]) || (portId && portId !== config.id)
    ? materializeNodePorts(n, side) : null;
  if (ports){
    const port = ports.find(item => item.id === (portId || ports[0]?.id));
    if (!port) return false;
    port.label = cleanNodePortLabel(value, config.fallback);
    return true;
  }
  const label = cleanNodePortLabel(value, config.fallback);
  if (label === config.fallback) delete n[config.legacyKey];
  else n[config.legacyKey] = label;
  return true;
}
function addNodePort(n, side, value){
  const config = nodePortConfig(side);
  if (!nodeSupportsLinkPorts(n) || !config) return null;
  setNodePortsEnabled(n, true);
  const ports = materializeNodePorts(n, side);
  if (ports.length >= NODE_PORT_MAX) return null;
  const port = {id:nextNodePortId(n, side),
    label:cleanNodePortLabel(value, `${config.fallback} ${ports.length + 1}`)};
  ports.push(port);
  return port;
}
function removeNodePort(n, side, portId){
  const config = nodePortConfig(side);
  if (!nodeSupportsLinkPorts(n) || !config) return false;
  const ports = materializeNodePorts(n, side);
  if (ports.length <= 1) return false;
  const index = ports.findIndex(port => port.id === portId);
  if (index < 0) return false;
  ports.splice(index, 1);
  for (const edge of state.edges || []){
    if (edge.from === n.id && edge.fromPort === portId) edge.fromPortUnresolved = true;
    if (edge.to === n.id && edge.toPort === portId) edge.toPortUnresolved = true;
  }
  return true;
}
function normalizeNodePorts(n){
  if (!nodeSupportsLinkPorts(n)){
    delete n.portsEnabled;
    delete n.inputLabel;
    delete n.outputLabel;
    delete n.inputPorts;
    delete n.outputPorts;
    return;
  }
  if (n.portsEnabled !== true){
    delete n.portsEnabled;
    delete n.inputLabel;
    delete n.outputLabel;
    delete n.inputPorts;
    delete n.outputPorts;
    return;
  }
  n.portsEnabled = true;
  for (const side of ["input","output"]){
    const config = nodePortConfig(side);
    const ports = normalizedNodePortList(n[config.key], side);
    if (ports.length){
      n[config.key] = ports;
      delete n[config.legacyKey];
    } else {
      delete n[config.key];
      const label = cleanNodePortLabel(n[config.legacyKey], config.fallback);
      if (label === config.fallback) delete n[config.legacyKey];
      else n[config.legacyKey] = label;
    }
  }
}
function normalizeEdgePortBindings(e){
  if (!e || typeof e !== "object") return;
  for (const [nodeKey, fieldKey, anchorKey, portKey, preferredSide] of [
    ["from", "fromField", "fromAnchor", "fromPort", "output"],
    ["to", "toField", "toAnchor", "toPort", "input"]
  ]){
    const id = cleanNodePortId(e[portKey]);
    const node = nodeById(e[nodeKey]);
    const unresolvedKey=portKey==="fromPort"?"fromPortUnresolved":"toPortUnresolved";
    if (!id || e[fieldKey]){
      delete e[portKey];
      delete e[unresolvedKey];
      continue;
    }
    e[portKey] = id;
    if(nodePortBinding(node,id,preferredSide)){
      delete e[unresolvedKey];
      delete e[anchorKey];
    }else{
      e[unresolvedKey]=true;
      /* Preserve the exact named-port identity.  A missing or renamed port is
         an unresolved binding, not permission to silently pick another port. */
    }
  }
  if(typeof routingUpdateEdgePortDiagnostic==="function")routingUpdateEdgePortDiagnostic(e);
}
