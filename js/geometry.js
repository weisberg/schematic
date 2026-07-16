"use strict";

/* --------------------------- Geometry ----------------------------- */
function clampSize(v, lo, hi){ v = parseFloat(v); if (!isFinite(v)) v = lo; return Math.min(hi, Math.max(lo, v)); }
function conceptFont(n){ return clampSize(n.fontSize || CONCEPT_FS_DEFAULT, 9, 48); }
function noteFont(n){ return clampSize(n.fontSize || NOTE_FS_DEFAULT, 10, 28); }
function textBoxFont(n){ return clampSize(n.fontSize || TEXT_FS_DEFAULT, 10, 72); }
function nodeTextSize(n){ return n.type === "concept" ? conceptFont(n) : n.type === "note" ? noteFont(n)
  : n.type === "text" ? textBoxFont(n) : tableMetrics(n).base; }
function clampNodeTextSize(n, value){
  return n.type === "concept" ? clampSize(value, 9, 48)
       : n.type === "note" ? clampSize(value, 10, 28)
       : n.type === "text" ? clampSize(value, 10, 72) : clampSize(value, 8, 28);
}
function richNoteInline(text){
  const source = String(text || "");
  const runs = [];
  const pattern = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`)/g;
  let at = 0, match;
  while ((match = pattern.exec(source))){
    if (match.index > at) runs.push({ text:source.slice(at, match.index) });
    if (match[2] != null) runs.push({ text:match[2], bold:true });
    else if (match[3] != null) runs.push({ text:match[3], italic:true });
    else runs.push({ text:match[4], code:true });
    at = pattern.lastIndex;
  }
  if (at < source.length) runs.push({ text:source.slice(at) });
  return runs;
}
function richNoteBlock(raw, base){
  let text = String(raw || ""), prefix = "", size = base, weight = 400, italic = false;
  if (/^##\s+/.test(text)){ text = text.replace(/^##\s+/, ""); size = base + 2; weight = 700; }
  else if (/^#\s+/.test(text)){ text = text.replace(/^#\s+/, ""); size = base + 4; weight = 700; }
  else if (/^-\s+\[[xX]\]\s+/.test(text)){ text = text.replace(/^-\s+\[[xX]\]\s+/, ""); prefix = "☑"; }
  else if (/^-\s+\[\s\]\s+/.test(text)){ text = text.replace(/^-\s+\[\s\]\s+/, ""); prefix = "☐"; }
  else if (/^[-*]\s+/.test(text)){ text = text.replace(/^[-*]\s+/, ""); prefix = "•"; }
  else if (/^\d+\.\s+/.test(text)){
    const m = text.match(/^(\d+\.)\s+/); prefix = m[1]; text = text.slice(m[0].length);
  } else if (/^>\s?/.test(text)){ text = text.replace(/^>\s?/, ""); prefix = "│"; italic = true; }
  return { text, prefix, size, weight, italic, runs:richNoteInline(text) };
}
function richNoteRunFont(run, block){
  const style = run.italic || block.italic ? "italic " : "";
  const weight = run.bold || block.weight >= 700 ? "700 " : "400 ";
  const family = run.code ? "'IBM Plex Mono', monospace" : "Archivo, sans-serif";
  return `${style}${weight}${block.size}px ${family}`;
}
function appendRichRun(line, text, run){
  if (!text) return;
  const prev = line[line.length - 1];
  if (prev && !!prev.bold === !!run.bold && !!prev.italic === !!run.italic && !!prev.code === !!run.code)
    prev.text += text;
  else line.push({ text, bold:!!run.bold, italic:!!run.italic, code:!!run.code });
}
function wrapRichNoteBlock(block, maxWidth){
  const lines = [];
  let line = [], width = 0;
  const finish = () => {
    while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
    lines.push(line); line = []; width = 0;
  };
  for (const run of block.runs){
    const font = richNoteRunFont(run, block);
    for (const token of run.text.split(/(\s+)/).filter(Boolean)){
      const space = /^\s+$/.test(token);
      if (space){
        if (line.length && width + textW(" ", font) <= maxWidth){ appendRichRun(line, " ", run); width += textW(" ", font); }
        continue;
      }
      const tokenWidth = textW(token, font);
      if (line.length && width + tokenWidth > maxWidth) finish();
      if (tokenWidth <= maxWidth){ appendRichRun(line, token, run); width += tokenWidth; continue; }
      let part = "";
      for (const ch of token){
        if (part && textW(part + ch, font) > maxWidth){
          appendRichRun(line, part, run); finish(); part = ch;
        } else part += ch;
      }
      if (part){ appendRichRun(line, part, run); width += textW(part, font); }
    }
  }
  if (line.length || !lines.length) finish();
  return lines;
}
function richNoteLayout(n){
  const base = noteFont(n), w = clampSize(n.w || NOTE_W_DEFAULT, 220, 720);
  const titleH = Math.ceil(base * 2.9), bodyW = w - 28;
  const source = String(n.content || "").replace(/\r\n?/g, "\n");
  const lines = [];
  if (!source.trim()){
    lines.push({ runs:[{text:"Write a note…", italic:true}], prefix:"", size:base,
                 weight:400, italic:true, indent:0, h:Math.ceil(base*1.4), placeholder:true });
  } else {
    outer: for (const raw of source.split("\n")){
      if (!raw.trim()){
        lines.push({runs:[], prefix:"", size:base, weight:400, italic:false, indent:0, h:Math.ceil(base*.8)});
        if (lines.length >= 80) break;
        continue;
      }
      const block = richNoteBlock(raw, base);
      const indent = block.prefix ? 20 : 0;
      const wrapped = wrapRichNoteBlock(block, bodyW - indent);
      for (let i = 0; i < wrapped.length; i++){
        lines.push({ runs:wrapped[i], prefix:i === 0 ? block.prefix : "", size:block.size,
                     weight:block.weight, italic:block.italic, indent, h:Math.ceil(block.size*1.42) });
        if (lines.length >= 80) break outer;
      }
    }
    if (lines.length >= 80)
      lines[79] = { runs:[{text:"…", italic:true}], prefix:"", size:base, weight:400,
                    italic:true, indent:0, h:Math.ceil(base*1.4), truncated:true };
  }
  const h = Math.max(96, titleH + lines.reduce((sum, line) => sum + line.h, 0) + 14);
  return { w, h, base, titleH, lines };
}
/* Concept shape is intentionally optional in the document model: old documents and a
   selected Process both render as the conventional rectangular process symbol. */
function conceptShape(n){ return n && n.type === "concept" && FLOWCHART_SHAPE_SET.has(n.shape) ? n.shape : "process"; }
function setConceptShape(n, shape){
  if (!n || n.type !== "concept") return;
  const next = FLOWCHART_SHAPE_SET.has(shape) ? shape : "process";
  if (next === "process") delete n.shape;
  else n.shape = next;
}
function textBoxShape(n){
  return n && n.type === "text" && TEXT_BOX_SHAPE_SET.has(n.shape) ? n.shape : "none";
}
function setTextBoxShape(n, shape){
  if (!n || n.type !== "text") return;
  const next = TEXT_BOX_SHAPE_SET.has(shape) ? shape : "none";
  if (next === "none") delete n.shape;
  else n.shape = next;
}
function wrapConceptTitle(text, font, maxWidth){
  const source = String(text || "Untitled").replace(/\r\n?/g, "\n");
  if (!source.trim()) return ["Untitled"];
  const lines = [];
  for (const explicitLine of source.split("\n")){
    const words = explicitLine.trim().split(/\s+/).filter(Boolean);
    if (!words.length){ lines.push(""); continue; }
    let line = "";
    const pushWord = word => {
      const next = line ? line + " " + word : word;
      if (textW(next, font) <= maxWidth){ line = next; return; }
      if (line){ lines.push(line); line = ""; }
      if (textW(word, font) <= maxWidth){ line = word; return; }
      let part = "";
      for (const ch of word){
        if (part && textW(part + ch, font) > maxWidth){ lines.push(part); part = ch; }
        else part += ch;
      }
      line = part;
    };
    for (const word of words) pushWord(word);
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["Untitled"];
}
function conceptWrappedLayout(n){
  const shape = conceptShape(n), fs = conceptFont(n);
  const font = `600 ${fs}px Archivo, sans-serif`;
  const lineH = Math.ceil(fs * 1.28);
  if (WRAPPED_CONCEPT_SHAPES.has(shape)){
    const spec = shape === "triangle"
      ? { min:180, widthRatio:.46, heightRatio:.38, centerY:.64, heightFor:size => Math.round(size * .866) }
      : shape === "circle"
        ? { min:140, widthRatio:.64, heightRatio:.58, centerY:.5, heightFor:size => size }
        : { min:120, widthRatio:.74, heightRatio:.72, centerY:.5, heightFor:size => size };
    let layout = null;
    for (let size = spec.min; size <= 1200; size += 10){
      const h = spec.heightFor(size);
      const maxWidth = Math.max(44, Math.round(size * spec.widthRatio));
      const lines = wrapConceptTitle(n.title || "Untitled", font, maxWidth);
      const maxLines = Math.max(1, Math.floor(h * spec.heightRatio / lineH));
      layout = { w:size, h, fs, font, lineH, lines, maxLines, maxWidth, centerY:h * spec.centerY };
      if (lines.length <= maxLines) return layout;
    }
    const visible = layout.lines.slice(0, layout.maxLines);
    let last = visible[visible.length - 1] || "";
    while (last && textW(last + "…", font) > layout.maxWidth) last = last.slice(0, -1);
    visible[visible.length - 1] = (last || "").trimEnd() + "…";
    return {...layout, lines:visible, truncated:true};
  }

  const source = String(n.title || "Untitled").replace(/\r\n?/g, "\n");
  const longestExplicitLine = Math.max(...source.split("\n")
    .map(line => textW(line.trim() || " ", font)));
  if (shape === "decision"){
    let w = Math.min(360, Math.max(160, Math.ceil(longestExplicitLine + 72)));
    let maxWidth = Math.max(70, Math.round(w * .62));
    let lines = wrapConceptTitle(source, font, maxWidth);
    let h = Math.max(80, lines.length * lineH + 38);
    w = Math.min(360, Math.max(w, Math.ceil(h * 1.6)));
    maxWidth = Math.max(70, Math.round(w * .62));
    lines = wrapConceptTitle(source, font, maxWidth);
    h = Math.max(80, lines.length * lineH + 38);
    return {w, h, fs, font, lineH, lines, maxLines:lines.length, maxWidth, centerY:h/2};
  }

  const extraWidth = shape === "data" || shape === "manualInput" ? 56 : 44;
  const w = Math.min(320, Math.max(130, Math.ceil(longestExplicitLine + extraWidth)));
  const maxWidth = conceptTextWidth(shape, w);
  const lines = wrapConceptTitle(source, font, maxWidth);
  const documentExtra = shape === "document" ? 18 : 0;
  const baseHeight = Math.max(40, Math.round(fs * 2.2 + 17.2)) + documentExtra;
  const h = Math.max(baseHeight, lines.length * lineH + 22 + documentExtra);
  return {w, h, fs, font, lineH, lines, maxLines:lines.length, maxWidth,
          centerY:shape === "document" ? (h - 12)/2 : h/2};
}
function conceptTextWidth(shape, w){
  return Math.max(44, w - (shape === "decision" ? 42 : shape === "data" || shape === "manualInput" ? 48 : 34));
}
function limitedWrappedLines(text, font, maxWidth, maxLines){
  const lines = wrapConceptTitle(text, font, maxWidth);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let last = visible[visible.length - 1] || "";
  while (last && textW(last + "…", font) > maxWidth) last = last.slice(0, -1);
  visible[visible.length - 1] = (last || "").trimEnd() + "…";
  return visible;
}
function textBoxLayout(n){
  const shape = textBoxShape(n);
  const fs = textBoxFont(n);
  const font = `600 ${fs}px Archivo, sans-serif`;
  const lineH = Math.ceil(fs * 1.28);
  const maxW = clampSize(n.w || TEXT_W_DEFAULT, 80, 720);
  const title = n.title || "Text";
  if (shape === "none"){
    const lines = wrapConceptTitle(title, font, maxW);
    const contentW = Math.max(...lines.map(line => textW(line, font)), fs);
    const w = Math.max(32, Math.min(maxW, Math.ceil(contentW + 12)));
    const h = Math.max(lineH + 8, lines.length * lineH + 8);
    return {shape, fs, font, lineH, lines, w, h, centerY:h/2, maxWidth:maxW};
  }
  const w = Math.max(120, maxW);
  let h, widthRatio, heightRatio, centerY;
  if (shape === "triangle"){
    h = Math.round(w * .866); widthRatio = .46; heightRatio = .38; centerY = h * .64;
  } else if (shape === "circle" || shape === "square"){
    h = w; widthRatio = shape === "circle" ? .64 : .74;
    heightRatio = shape === "circle" ? .58 : .72; centerY = h/2;
  } else if (shape === "decision"){
    h = Math.max(120, Math.round(w * .6)); widthRatio = .48; heightRatio = .52; centerY = h/2;
  } else {
    widthRatio = shape === "data" || shape === "manualInput" ? .72 : .82;
    const maxWidth = Math.max(48, Math.round(w * widthRatio));
    const draftLines = wrapConceptTitle(title, font, maxWidth);
    h = Math.max(shape === "terminator" ? 64 : 56, draftLines.length * lineH + 32) + (shape === "document" ? 18 : 0);
    heightRatio = .72; centerY = shape === "document" ? (h - 12)/2 : h/2;
  }
  const maxWidth = Math.max(44, Math.round(w * widthRatio));
  const maxLines = Math.max(1, Math.floor(h * heightRatio / lineH));
  const lines = limitedWrappedLines(title, font, maxWidth, maxLines);
  return {shape, fs, font, lineH, lines, w, h, centerY, maxWidth};
}
/* one source of truth for table geometry at a given font size */
function tableMetrics(n){
  const base = clampSize(n.fontSize || TABLE_FS_DEFAULT, 8, 28);
  const rowH = Math.round(base * 2);
  const headerH = Math.round(base * 2.96);
  const bs = Math.max(7, base - 3.5);
  const badgeW = Math.round(bs * 2.6), badgeH = Math.round(bs * 1.6);
  return { base, rowH, headerH,
    nameSize: base, typeSize: Math.max(8, base - 1), headerSize: base + 1.5,
    badgeSize: bs, badgeW, badgeH, nameX: 8 + badgeW + 6,
    headerBaseline: Math.round(headerH * 0.64) };
}
function nodeSize(n){
  if (n.type === "frame"){
    return {
      w: clampSize(n.w || FRAME_DEFAULT.w, 120, 4000),
      h: clampSize(n.h || FRAME_DEFAULT.h, 90, 4000)
    };
  }
  if (n.type === "swimlane"){
    const orientation = swimlaneOrientation(n);
    const defaults = swimlaneDefaults(n);
    return {
      w: clampSize(n.w || defaults.w, orientation === "vertical" ? 120 : 260, 4000),
      h: clampSize(n.h || defaults.h, orientation === "vertical" ? 260 : 100, 4000)
    };
  }
  if (n.type === "concept"){
    const layout = conceptWrappedLayout(n);
    return {w:layout.w, h:layout.h};
  }
  if (n.type === "text"){
    const layout = textBoxLayout(n);
    return {w:layout.w, h:layout.h};
  }
  if (n.type === "note"){
    const layout = richNoteLayout(n);
    return { w:layout.w, h:layout.h };
  }
  if (n.type === "todo"){
    const m = tableMetrics(n);
    const headW = textW(n.title || "To-do list", `700 ${m.headerSize}px Archivo, sans-serif`) + 96;
    if (n.collapsed) return { w: Math.min(Math.max(190, headW), 460), h: m.headerH + 10 };
    let maxRow = 150;
    for (const it of n.items){
      const rw = m.nameX + textW(it.text || "", `500 ${m.nameSize}px Archivo, sans-serif`) + 24;
      if (rw > maxRow) maxRow = rw;
    }
    const w = Math.min(Math.max(190, headW, maxRow), 460);
    const h = m.headerH + (Math.max(1, n.items.length) + 1) * m.rowH + 8;
    return { w, h };
  }
  // table node
  const m = tableMetrics(n);
  const headW = textW(n.title || "table", `700 ${m.headerSize}px Archivo, sans-serif`) + 56;
  if (n.collapsed) return { w: Math.min(Math.max(190, headW), 460), h: m.headerH + 10 };
  let maxRow = 150;
  for (const f of n.fields){
    const rw = m.nameX + textW(f.name + (f.nullable ? "?" : ""), `500 ${m.nameSize}px 'IBM Plex Mono', monospace`)
             + 16 + textW(f.type, `400 ${m.typeSize}px 'IBM Plex Mono', monospace`) + 20;
    if (rw > maxRow) maxRow = rw;
  }
  const w = Math.min(Math.max(190, headW, maxRow), 460);
  const h = m.headerH + Math.max(1, n.fields.length) * m.rowH + 8;
  return { w, h };
}
function nodeRect(n){ const s = nodeSize(n); return { x:n.x, y:n.y, w:s.w, h:s.h, cx:n.x+s.w/2, cy:n.y+s.h/2 }; }
function rectFromPoints(a, b){
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w:Math.abs(a.x - b.x), h:Math.abs(a.y - b.y) };
}
function rectsIntersect(a, b){
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
function rectsOverlap(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function documentBounds(nodes = state.nodes){
  if (!nodes.length) return null;
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for (const n of nodes){
    const r = nodeRect(n);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  if (nodes === state.nodes){
    for (const e of state.edges){
      if (e.routing !== "ortho" || !hasCustomOrthoBend(e)) continue;
      const ep = edgeEndpoints(e);
      if (!ep) continue;
      const bend = orthoEdgeRoute(e, ep.pa, ep.pb).bend;
      x0 = Math.min(x0, bend.x); y0 = Math.min(y0, bend.y);
      x1 = Math.max(x1, bend.x); y1 = Math.max(y1, bend.y);
    }
  }
  return { x:x0, y:y0, w:x1-x0, h:y1-y0, cx:(x0+x1)/2, cy:(y0+y1)/2 };
}
function containerContainedNodes(container){
  const fr = nodeRect(container);
  return state.nodes.filter(n => !isStructuralNode(n) && n.id !== container.id).filter(n => {
    const r = nodeRect(n);
    return r.cx >= fr.x && r.cx <= fr.x + fr.w && r.cy >= fr.y && r.cy <= fr.y + fr.h;
  });
}
function frameContainedNodes(frame){ return containerContainedNodes(frame); }

/* point on rect boundary toward an external point */
function anchorOnRect(r, px, py){
  const dx = px - r.cx, dy = py - r.cy;
  if (dx === 0 && dy === 0) return { x:r.cx, y:r.cy, side:"e" };
  const sx = (r.w/2) / Math.abs(dx || 1e-9), sy = (r.h/2) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  const x = r.cx + dx*s, y = r.cy + dy*s;
  let side;
  if (s === sx) side = dx > 0 ? "e" : "w"; else side = dy > 0 ? "s" : "n";
  return { x, y, side };
}

/* 9 node attachment points (3×3): top/middle/bottom × left/center/right.
   Whole-node edge ends snap to the nearest perimeter point automatically;
   an explicit point is stored on the edge as fromAnchor/toAnchor (additive, E8). */
const NODE_ANCHORS = ["tl","tc","tr","ml","mc","mr","bl","bc","br"];
const PERIMETER_ANCHORS = ["tl","tc","tr","ml","mr","bl","bc","br"];
const ANCHOR_LABELS = { tl:"Top left", tc:"Top center", tr:"Top right",
                        ml:"Middle left", mc:"Center", mr:"Middle right",
                        bl:"Bottom left", bc:"Bottom center", br:"Bottom right" };
function anchorPointsForRect(r){
  return {
    tl:{x:r.x,     y:r.y},       tc:{x:r.cx, y:r.y},       tr:{x:r.x+r.w, y:r.y},
    ml:{x:r.x,     y:r.cy},      mc:{x:r.cx, y:r.cy},      mr:{x:r.x+r.w, y:r.cy},
    bl:{x:r.x,     y:r.y+r.h},   bc:{x:r.cx, y:r.y+r.h},   br:{x:r.x+r.w, y:r.y+r.h}
  };
}
function rayPolygonBoundary(r, ref, points){
  const origin = {x:r.cx, y:r.cy};
  const ray = {x:ref.x - origin.x, y:ref.y - origin.y};
  const cross = (a, b) => a.x*b.y - a.y*b.x;
  let best = null;
  for (let i = 0; i < points.length; i++){
    const a = points[i], b = points[(i + 1) % points.length];
    const edge = {x:b.x - a.x, y:b.y - a.y};
    const delta = {x:a.x - origin.x, y:a.y - origin.y};
    const denom = cross(ray, edge);
    if (Math.abs(denom) < 1e-9) continue;
    const t = cross(delta, edge) / denom;
    const u = cross(delta, ray) / denom;
    if (t >= 0 && u >= 0 && u <= 1 && (!best || t < best.t))
      best = {t, x:origin.x + ray.x*t, y:origin.y + ray.y*t};
  }
  return best ? {x:best.x, y:best.y} : {x:ref.x, y:ref.y};
}
/* Non-rectangular concept anchors sit on the rendered shape, not its bounding box. */
function conceptBoundaryPoint(n, r, ref){
  const shape = visualNodeShape(n);
  if (!CUSTOM_BOUNDARY_CONCEPT_SHAPES.has(shape)) return { x:ref.x, y:ref.y };
  const dx = ref.x - r.cx, dy = ref.y - r.cy;
  if (!dx && !dy) return { x:r.cx, y:r.cy };
  if (shape === "circle"){
    const scale = 1 / Math.sqrt((dx/(r.w/2))**2 + (dy/(r.h/2))**2);
    return {x:r.cx + dx*scale, y:r.cy + dy*scale};
  }
  if (shape === "triangle")
    return rayPolygonBoundary(r, ref, [
      {x:r.cx, y:r.y}, {x:r.x+r.w, y:r.y+r.h}, {x:r.x, y:r.y+r.h}
    ]);
  const scale = 1 / (Math.abs(dx) / (r.w/2) + Math.abs(dy) / (r.h/2));
  return { x:r.cx + dx * scale, y:r.cy + dy * scale };
}
function anchorPointsForNode(n, r = nodeRect(n)){
  const pts = anchorPointsForRect(r);
  if (!CUSTOM_BOUNDARY_CONCEPT_SHAPES.has(visualNodeShape(n))) return pts;
  for (const key of PERIMETER_ANCHORS) pts[key] = conceptBoundaryPoint(n, r, pts[key]);
  return pts;
}
/* outward side of an anchor point, for curve control points and crow's feet;
   corners and the center pick the dominant axis toward the reference point */
function anchorSideFor(key, p, ref){
  if (key === "tc") return "n";
  if (key === "bc") return "s";
  if (key === "ml") return "w";
  if (key === "mr") return "e";
  const horiz = Math.abs(ref.x - p.x) >= Math.abs(ref.y - p.y);
  if (key === "tl") return horiz ? "w" : "n";
  if (key === "tr") return horiz ? "e" : "n";
  if (key === "bl") return horiz ? "w" : "s";
  if (key === "br") return horiz ? "e" : "s";
  return horiz ? (ref.x - p.x > 0 ? "e" : "w") : (ref.y - p.y > 0 ? "s" : "n"); // mc
}
function nodeAnchor(n, key, ref){
  const r = nodeRect(n);
  const pts = anchorPointsForNode(n, r);
  let k = key && pts[key] ? key : null;
  /* Unpinned non-rectangular concepts use their actual silhouette intersection. */
  if (!k && CUSTOM_BOUNDARY_CONCEPT_SHAPES.has(visualNodeShape(n))){
    const p = conceptBoundaryPoint(n, r, ref);
    const dx = ref.x - r.cx, dy = ref.y - r.cy;
    const horiz = Math.abs(dx) / r.w >= Math.abs(dy) / r.h;
    return { x:p.x, y:p.y, side:horiz ? (dx >= 0 ? "e" : "w") : (dy >= 0 ? "s" : "n"), key:null };
  }
  if (!k){
    let bd = Infinity;
    for (const cand of PERIMETER_ANCHORS){
      const p = pts[cand];
      const d = (p.x - ref.x)**2 + (p.y - ref.y)**2;
      if (d < bd){ bd = d; k = cand; }
    }
  }
  const p = pts[k];
  return { x:p.x, y:p.y, side:anchorSideFor(k, p, ref), key:k };
}
/* nearest perimeter point within tolerance — used to pin the drop end of a drag */
function nearestAnchorWithin(n, w, tol = 16){
  const pts = anchorPointsForNode(n);
  let best = null, bd = tol*tol;
  for (const key of PERIMETER_ANCHORS){
    const p = pts[key];
    const d = (p.x - w.x)**2 + (p.y - w.y)**2;
    if (d <= bd){ bd = d; best = { key, x:p.x, y:p.y }; }
  }
  return best;
}
function clientToWorld(cx, cy){
  const b = board.getBoundingClientRect();
  return { x: (cx - b.left - view.x)/view.k, y: (cy - b.top - view.y)/view.k };
}
