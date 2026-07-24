"use strict";

/* --------------------------- Geometry ----------------------------- */
function clampSize(v, lo, hi){ v = parseFloat(v); if (!isFinite(v)) v = lo; return Math.min(hi, Math.max(lo, v)); }
function rawConceptFont(n){ return clampSize(n.fontSize || CONCEPT_FS_DEFAULT, 9, 48); }
function rawNoteFont(n){ return clampSize(n.fontSize || NOTE_FS_DEFAULT, 10, 28); }
function rawTextBoxFont(n){ return clampSize(n.fontSize || TEXT_FS_DEFAULT, 10, 72); }
function rawStatusNodeFont(n){ return clampSize(n.fontSize || STATUS_FS_DEFAULT, 10, 72); }
function rawTableFont(n){ return clampSize(n.fontSize || TABLE_FS_DEFAULT, 8, 28); }
function rawNodeTextSize(n){ return n.type === "concept" ? rawConceptFont(n)
  : n.type === "note" ? rawNoteFont(n) : n.type === "text" ? rawTextBoxFont(n)
  : n.type === "status" ? rawStatusNodeFont(n) : rawTableFont(n); }
function styledNodeFont(n,raw,lo,hi){
  if (n.styleOverrides?.fontSize) return clampSize(raw,lo,hi);
  const hasReference=!!n.styleTokenRefs?.fontSize || !!n.styleClassId ||
    (Array.isArray(n.modifierClassIds) && n.modifierClassIds.length > 0);
  if (!hasReference || typeof styleEffectiveValue !== "function") return clampSize(raw,lo,hi);
  const value=styleEffectiveValue(n,"fontSize",raw);
  return clampSize(value,lo,hi);
}
function conceptFont(n){ return styledNodeFont(n,rawConceptFont(n),9,48); }
function noteFont(n){ return styledNodeFont(n,rawNoteFont(n),10,28); }
function textBoxFont(n){ return styledNodeFont(n,rawTextBoxFont(n),10,72); }
function statusNodeFont(n){ return styledNodeFont(n,rawStatusNodeFont(n),10,72); }
function nodeTextSize(n){ return n.type === "concept" ? conceptFont(n) : n.type === "note" ? noteFont(n)
  : n.type === "text" ? textBoxFont(n) : n.type === "status" ? statusNodeFont(n) : tableMetrics(n).base; }
function clampNodeTextSize(n, value){
  return n.type === "concept" ? clampSize(value, 9, 48)
       : n.type === "note" ? clampSize(value, 10, 28)
       : n.type === "text" || n.type === "status" ? clampSize(value, 10, 72) : clampSize(value, 8, 28);
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
  const fixedWidth = manualNodeWidth(n);
  const base = noteFont(n), w = fixedWidth == null
    ? clampSize(n.w || NOTE_W_DEFAULT, 220, 720)
    : fixedWidth;
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
  const naturalHeight = Math.max(96, titleH + lines.reduce((sum, line) => sum + line.h, 0) + 14);
  const fixedHeight = manualNodeHeight(n);
  const h = fixedHeight == null ? naturalHeight : fixedHeight;
  if (fixedHeight != null){
    const available = Math.max(0, h - titleH - 14);
    let used = 0, count = 0;
    while (count < lines.length && used + lines[count].h <= available){
      used += lines[count].h;
      count++;
    }
    if (count < lines.length && count > 0){
      const last = lines[count - 1];
      lines[count - 1] = {...last, runs:[{text:"…", italic:true}], prefix:"",
        italic:true, truncated:true};
    }
    lines.length = Math.max(0, count);
  }
  return { w, h, naturalHeight, base, titleH, lines, manualHeight:fixedHeight != null };
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
function plainConceptWrappedLayout(n){
  const shape = conceptShape(n), fs = conceptFont(n);
  const font = `600 ${fs}px Archivo, sans-serif`;
  const lineH = Math.ceil(fs * 1.28);
  const fixedWidth = manualNodeWidth(n);
  if (WRAPPED_CONCEPT_SHAPES.has(shape)){
    const spec = shape === "triangle"
      ? { min:180, widthRatio:.46, heightRatio:.38, centerY:.64, heightFor:size => Math.round(size * .866) }
      : shape === "circle"
        ? { min:140, widthRatio:.64, heightRatio:.58, centerY:.5, heightFor:size => size }
        : { min:120, widthRatio:.74, heightRatio:.72, centerY:.5, heightFor:size => size };
    let layout = null;
    const firstSize = fixedWidth == null ? spec.min : fixedWidth;
    const lastSize = fixedWidth == null ? 1200 : fixedWidth;
    const step = fixedWidth == null ? 10 : 1;
    for (let size = firstSize; size <= lastSize; size += step){
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
    let w = fixedWidth == null
      ? Math.min(360, Math.max(160, Math.ceil(longestExplicitLine + 72)))
      : fixedWidth;
    let maxWidth = Math.max(70, Math.round(w * .62));
    let lines = wrapConceptTitle(source, font, maxWidth);
    let h = Math.max(80, lines.length * lineH + 38);
    if (fixedWidth == null) w = Math.min(360, Math.max(w, Math.ceil(h * 1.6)));
    maxWidth = Math.max(70, Math.round(w * .62));
    lines = wrapConceptTitle(source, font, maxWidth);
    h = Math.max(80, lines.length * lineH + 38);
    return {w, h, fs, font, lineH, lines, maxLines:lines.length, maxWidth, centerY:h/2};
  }

  const extraWidth = shape === "data" || shape === "manualInput" ? 56 : 44;
  const w = fixedWidth == null
    ? Math.min(320, Math.max(130, Math.ceil(longestExplicitLine + extraWidth)))
    : fixedWidth;
  const maxWidth = conceptTextWidth(shape, w);
  const lines = wrapConceptTitle(source, font, maxWidth);
  const documentExtra = shape === "document" ? 18 : 0;
  const baseHeight = Math.max(40, Math.round(fs * 2.2 + 17.2)) + documentExtra;
  const h = Math.max(baseHeight, lines.length * lineH + 22 + documentExtra);
  return {w, h, fs, font, lineH, lines, maxLines:lines.length, maxWidth,
          centerY:shape === "document" ? (h - 12)/2 : h/2};
}
function nodeDecorationMetrics(n, fs){
  const icon = nodeIcon(n);
  const subtitle = nodeSubtitle(n);
  const subtitleFs = Math.max(9, Math.round(fs * .72));
  return {
    icon, subtitle,
    iconSize:icon ? Math.max(30, Math.round(fs * 2.05)) : 0,
    iconGap:icon ? Math.max(8, Math.round(fs * .55)) : 0,
    subtitleFs,
    subtitleFont:`500 ${subtitleFs}px Archivo, sans-serif`,
    subtitleLineH:Math.ceil(subtitleFs * 1.25),
    subtitleGap:subtitle ? Math.max(3, Math.round(fs * .22)) : 0
  };
}
function decoratedTextMetrics(title, font, lineH, decoration, maxWidth){
  const titleLines = wrapConceptTitle(title, font, maxWidth);
  const subtitleLines = decoration.subtitle
    ? wrapConceptTitle(decoration.subtitle, decoration.subtitleFont, maxWidth) : [];
  const textH = titleLines.length * lineH +
    (subtitleLines.length ? decoration.subtitleGap + subtitleLines.length * decoration.subtitleLineH : 0);
  return {titleLines, subtitleLines, textH};
}
function positionDecoratedContent(layout, mode, contentCenterY){
  const decoration = layout.decoration;
  const text = layout.text;
  if (mode === "stacked"){
    const contentH = decoration.iconSize + decoration.iconGap + text.textH;
    const top = contentCenterY - contentH/2;
    layout.iconX = decoration.icon ? (layout.w - decoration.iconSize)/2 : null;
    layout.iconY = decoration.icon ? top : null;
    layout.textX = layout.w/2;
    layout.textAnchor = "middle";
    layout.textTop = top + decoration.iconSize + decoration.iconGap;
    layout.contentH = contentH;
  } else {
    const contentH = Math.max(decoration.iconSize, text.textH);
    const left = layout.contentLeft;
    layout.iconX = decoration.icon ? left : null;
    layout.iconY = decoration.icon ? contentCenterY - decoration.iconSize/2 : null;
    layout.textX = decoration.icon ? left + decoration.iconSize + decoration.iconGap : layout.w/2;
    layout.textAnchor = decoration.icon ? "start" : "middle";
    layout.textTop = contentCenterY - text.textH/2;
    layout.contentH = contentH;
  }
  layout.firstTitleY = layout.textTop + layout.fs * .83;
  layout.firstSubtitleY = layout.textTop + text.titleLines.length * layout.lineH +
    decoration.subtitleGap + decoration.subtitleFs * .83;
  return layout;
}
function decoratedConceptLayout(n){
  const shape = conceptShape(n), fs = conceptFont(n);
  const font = `600 ${fs}px Archivo, sans-serif`;
  const lineH = Math.ceil(fs * 1.28);
  const decoration = nodeDecorationMetrics(n, fs);
  const fixedWidth = manualNodeWidth(n);
  const source = String(n.title || "Untitled").replace(/\r\n?/g, "\n");
  const longestTitle = Math.max(...source.split("\n")
    .map(line => textW(line.trim() || " ", font)));
  const longestSubtitle = decoration.subtitle
    ? Math.max(...decoration.subtitle.split("\n")
      .map(line => textW(line.trim() || " ", decoration.subtitleFont)))
    : 0;

  if (WRAPPED_CONCEPT_SHAPES.has(shape)){
    const spec = shape === "triangle"
      ? {min:180, widthRatio:.46, heightRatio:.38, centerY:.64, heightFor:size => Math.round(size * .866)}
      : shape === "circle"
        ? {min:140, widthRatio:.64, heightRatio:.58, centerY:.5, heightFor:size => size}
        : {min:120, widthRatio:.74, heightRatio:.72, centerY:.5, heightFor:size => size};
    let layout = null;
    const firstSize = fixedWidth == null ? spec.min : fixedWidth;
    const lastSize = fixedWidth == null ? 1200 : fixedWidth;
    const step = fixedWidth == null ? 10 : 1;
    for (let size = firstSize; size <= lastSize; size += step){
      const h = spec.heightFor(size);
      const maxWidth = Math.max(44, Math.round(size * spec.widthRatio));
      const text = decoratedTextMetrics(source, font, lineH, decoration, maxWidth);
      const availableHeight = Math.max(lineH, h * spec.heightRatio);
      layout = {w:size, h, fs, font, lineH, lines:text.titleLines,
                titleLines:text.titleLines, subtitleLines:text.subtitleLines,
                maxLines:text.titleLines.length, maxWidth, centerY:h * spec.centerY,
                decoration, text, mode:"stacked"};
      if (decoration.iconSize + decoration.iconGap + text.textH <= availableHeight)
        return positionDecoratedContent(layout, "stacked", layout.centerY);
    }
    /* Forced very-small shapes retain the title and subtitle inside the safest
       available region by truncating their wrapped lines and shrinking the tile. */
    const available = Math.max(lineH, layout.h * spec.heightRatio);
    const minSubtitle = decoration.subtitle ? decoration.subtitleLineH + decoration.subtitleGap : 0;
    decoration.iconSize = Math.min(decoration.iconSize,
      Math.max(16, available - lineH - minSubtitle - decoration.iconGap));
    const titleCapacity = Math.max(1, Math.floor(
      (available - decoration.iconSize - decoration.iconGap - minSubtitle) / lineH));
    const titleLines = limitedWrappedLines(source, font, layout.maxWidth, titleCapacity);
    const remaining = Math.max(decoration.subtitleLineH,
      available - decoration.iconSize - decoration.iconGap -
      titleLines.length * lineH - decoration.subtitleGap);
    const subtitleLines = decoration.subtitle
      ? limitedWrappedLines(decoration.subtitle, decoration.subtitleFont, layout.maxWidth,
        Math.max(1, Math.floor(remaining / decoration.subtitleLineH))) : [];
    const textH = titleLines.length * lineH +
      (subtitleLines.length ? decoration.subtitleGap + subtitleLines.length * decoration.subtitleLineH : 0);
    layout = {...layout, lines:titleLines, titleLines, subtitleLines,
      text:{titleLines, subtitleLines, textH}, truncated:true};
    return positionDecoratedContent(layout, "stacked", layout.centerY);
  }

  if (shape === "decision"){
    let w = fixedWidth == null
      ? Math.min(420, Math.max(180, Math.ceil(Math.max(longestTitle, longestSubtitle) + 96)))
      : fixedWidth;
    let maxWidth = Math.max(70, Math.round(w * .62));
    let text = decoratedTextMetrics(source, font, lineH, decoration, maxWidth);
    let contentH = decoration.iconSize + decoration.iconGap + text.textH;
    let h = Math.max(100, contentH + 40);
    if (fixedWidth == null) w = Math.min(420, Math.max(w, Math.ceil(h * 1.6)));
    maxWidth = Math.max(70, Math.round(w * .62));
    text = decoratedTextMetrics(source, font, lineH, decoration, maxWidth);
    contentH = decoration.iconSize + decoration.iconGap + text.textH;
    h = Math.max(100, contentH + 40);
    const layout = {w, h, fs, font, lineH, lines:text.titleLines,
      titleLines:text.titleLines, subtitleLines:text.subtitleLines,
      maxLines:text.titleLines.length, maxWidth, centerY:h/2,
      decoration, text, mode:"stacked"};
    return positionDecoratedContent(layout, "stacked", layout.centerY);
  }

  const extraWidth = shape === "data" || shape === "manualInput" ? 56 : 44;
  const reserve = decoration.iconSize + decoration.iconGap;
  const w = fixedWidth == null
    ? Math.min(480, Math.max(160, Math.ceil(Math.max(longestTitle, longestSubtitle) + extraWidth + reserve)))
    : fixedWidth;
  const maxWidth = Math.max(30, conceptTextWidth(shape, w) - reserve);
  const text = decoratedTextMetrics(source, font, lineH, decoration, maxWidth);
  const documentExtra = shape === "document" ? 18 : 0;
  const baseHeight = Math.max(48, Math.round(fs * 2.2 + 17.2)) + documentExtra;
  const contentH = Math.max(decoration.iconSize, text.textH);
  const h = Math.max(baseHeight, contentH + 22 + documentExtra);
  const centerY = shape === "document" ? (h - 12)/2 : h/2;
  const sidePadding = shape === "data" || shape === "manualInput" ? 28 : 17;
  const layout = {w, h, fs, font, lineH, lines:text.titleLines,
    titleLines:text.titleLines, subtitleLines:text.subtitleLines,
    maxLines:text.titleLines.length, maxWidth, centerY,
    decoration, text, mode:"leading", contentLeft:sidePadding};
  return positionDecoratedContent(layout, "leading", centerY);
}
function baseConceptWrappedLayout(n){
  if (!nodeIcon(n) && !nodeSubtitle(n)) return plainConceptWrappedLayout(n);
  return decoratedConceptLayout(n);
}
function shiftConceptContent(layout, dy){
  const shifted = {...layout};
  for (const key of ["centerY","iconY","textTop","firstTitleY","firstSubtitleY"])
    if (Number.isFinite(shifted[key])) shifted[key] += dy;
  return shifted;
}
function conceptPortLayout(n, base){
  const fs = conceptFont(n);
  const portFs = Math.max(10, Math.round(fs * .72));
  const portFont = `600 ${portFs}px 'IBM Plex Mono', monospace`;
  const portRowH = Math.max(24, Math.ceil(portFs * 1.65));
  const inputPorts = nodeInputPorts(n), outputPorts = nodeOutputPorts(n);
  const portCount = Math.max(inputPorts.length, outputPorts.length, 1);
  const portAreaH = portCount * portRowH + 8;
  const widestInput = Math.max(0, ...inputPorts.map(port => textW(port.label, portFont)));
  const widestOutput = Math.max(0, ...outputPorts.map(port => textW(port.label, portFont)));
  const desiredW = Math.ceil(widestInput + widestOutput + 84);
  const fixedWidth = manualNodeWidth(n);
  let layout = base;

  /* Auto-sized cards widen before adding the port row. Forced widths remain
     exact and truncate only the port captions, matching other forced content. */
  if (fixedWidth == null && desiredW > layout.w){
    layout = baseConceptWrappedLayout({...n, manualWidth:true, w:desiredW});
  }

  const shape = conceptShape(n);
  const constrained = shape === "decision" || WRAPPED_CONCEPT_SHAPES.has(shape);
  if (constrained){
    /* Circle/square/triangle geometry must retain its silhouette. Give auto-
       sized shapes more room in both dimensions, then lift their content into
       the upper visual region instead of appending a rectangular footer. */
    if (fixedWidth == null){
      const growth = shape === "triangle" ? Math.ceil(portAreaH / .43) : portAreaH * 2;
      const targetW = Math.max(desiredW + 28, layout.w + growth);
      layout = baseConceptWrappedLayout({...n, manualWidth:true, w:targetW});
    }
    layout = shiftConceptContent(layout, -portAreaH * .42);
  } else {
    layout = {...layout, h:layout.h + portAreaH + (shape === "document" ? 10 : 0)};
  }

  const portCenterY = constrained
    ? layout.h * (shape === "triangle" ? .77 : shape === "decision" ? .69 : .72)
    : layout.h - portAreaH/2 - (shape === "document" ? 10 : 0);
  return {...layout, ports:true, portFs, portFont, portRowH, portAreaH,
          portCenterY, footerH:portAreaH, inputPorts, outputPorts};
}
function conceptWrappedLayout(n){
  const base = baseConceptWrappedLayout(n);
  const natural = nodePortsEnabled(n) ? conceptPortLayout(n, base) : base;
  const fixedHeight = manualNodeHeight(n);
  if (fixedHeight == null) return natural;
  const shape = conceptShape(n);
  const shapeCenterY = shape === "triangle" ? fixedHeight * .64
    : shape === "document" ? (fixedHeight - 12) / 2 : fixedHeight / 2;
  const constrained = shape === "decision" || WRAPPED_CONCEPT_SHAPES.has(shape);
  const contentCenterY = natural.ports
    ? constrained ? shapeCenterY - natural.portAreaH*.42
      : Math.max(12,(fixedHeight-natural.footerH-(shape === "document" ? 10 : 0))/2)
    : shapeCenterY;
  let fitted = shiftConceptContent(natural, contentCenterY - natural.centerY);
  const ratio = shape === "triangle" ? .38 : shape === "circle" ? .58
    : shape === "square" ? .72 : shape === "decision" ? .62 : 1;
  const available = Math.max(fitted.lineH,
    constrained ? fixedHeight*ratio - (fitted.ports ? fitted.portAreaH*.18 : 0)
      : fixedHeight - (fitted.ports ? fitted.footerH : 0) - (shape === "document" ? 28 : 22));
  if (fitted.decoration){
    const decoration = {...fitted.decoration};
    const stacked = fitted.mode === "stacked";
    if (decoration.icon)
      decoration.iconSize = Math.min(decoration.iconSize,
        Math.max(14,available-(stacked ? fitted.lineH+decoration.iconGap : 0)));
    const iconReserve = stacked && decoration.icon
      ? decoration.iconSize+decoration.iconGap : 0;
    const subtitleReserve = decoration.subtitle
      ? decoration.subtitleLineH+decoration.subtitleGap : 0;
    const titleCapacity = Math.max(1,Math.floor(
      (available-iconReserve-subtitleReserve)/fitted.lineH));
    const titleLines = limitedWrappedLines(n.title || "Untitled",fitted.font,
      fitted.maxWidth,titleCapacity);
    const remaining = Math.max(0,available-iconReserve-titleLines.length*fitted.lineH-
      (decoration.subtitle ? decoration.subtitleGap : 0));
    const subtitleLines = decoration.subtitle && remaining >= decoration.subtitleLineH
      ? limitedWrappedLines(decoration.subtitle,decoration.subtitleFont,fitted.maxWidth,
        Math.max(1,Math.floor(remaining/decoration.subtitleLineH))) : [];
    const textH = titleLines.length*fitted.lineH +
      (subtitleLines.length ? decoration.subtitleGap+
        subtitleLines.length*decoration.subtitleLineH : 0);
    fitted = {...fitted,decoration,lines:titleLines,titleLines,subtitleLines,
      text:{titleLines,subtitleLines,textH},truncated:
        titleLines.length < wrapConceptTitle(n.title || "Untitled",fitted.font,fitted.maxWidth).length ||
        subtitleLines.length < (decoration.subtitle
          ? wrapConceptTitle(decoration.subtitle,decoration.subtitleFont,fitted.maxWidth).length : 0)};
    fitted = positionDecoratedContent(fitted,fitted.mode,contentCenterY);
  } else {
    const capacity = Math.max(1,Math.floor(available/fitted.lineH));
    const fullLines = wrapConceptTitle(n.title || "Untitled",fitted.font,fitted.maxWidth);
    fitted.lines = limitedWrappedLines(n.title || "Untitled",fitted.font,fitted.maxWidth,capacity);
    fitted.truncated = fitted.lines.length < fullLines.length;
  }
  fitted.h = fixedHeight;
  fitted.naturalHeight = natural.h;
  fitted.centerY = contentCenterY;
  fitted.manualHeight = true;
  if (fitted.ports){
    fitted.portCenterY = shape === "triangle" ? fixedHeight * .77
      : shape === "decision" ? fixedHeight * .69
      : WRAPPED_CONCEPT_SHAPES.has(shape) ? fixedHeight * .72
      : fixedHeight - fitted.portAreaH/2 - (shape === "document" ? 10 : 0);
  }
  return fitted;
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
function unwrappedTextBoxLines(text){
  const source = String(text || "Text").replace(/\r\n?/g, "\n");
  const lines = source.split("\n").map(line => line.trim());
  return lines.length ? lines : ["Text"];
}
function textBoxLayout(n){
  const shape = textBoxShape(n);
  const fs = textBoxFont(n);
  const font = `600 ${fs}px Archivo, sans-serif`;
  const lineH = Math.ceil(fs * 1.28);
  const wrap = textBoxWrapEnabled(n);
  const margins = textBoxMargins(n);
  const marginX = margins.left + margins.right;
  const marginY = margins.top + margins.bottom;
  const fixedWidth = manualNodeWidth(n);
  const maxW = fixedWidth == null
    ? clampSize(n.w || TEXT_W_DEFAULT, 80, 720)
    : fixedWidth;
  const title = n.title || "Text";
  const linesFor = width => wrap
    ? wrapConceptTitle(title, font, Math.max(1, width))
    : unwrappedTextBoxLines(title);
  const fixedHeight = manualNodeHeight(n);
  if (shape === "none"){
    const availableWidth = Math.max(1, maxW - marginX);
    let lines = linesFor(availableWidth);
    const contentW = Math.max(...lines.map(line => textW(line, font)), fs);
    const w = fixedWidth == null
      ? wrap
        ? Math.max(32, Math.min(maxW, Math.ceil(contentW + 12 + marginX)))
        : clampSize(Math.ceil(contentW + 12 + marginX), 32, 4000)
      : maxW;
    const naturalHeight = Math.max(lineH + 8 + marginY, lines.length * lineH + 8 + marginY);
    const h = fixedHeight == null ? naturalHeight : fixedHeight;
    if (fixedHeight != null && wrap){
      const maxLines = Math.max(1, Math.floor((h - 8 - marginY) / lineH));
      lines = limitedWrappedLines(title, font, availableWidth, maxLines);
    }
    const innerWidth = Math.max(1, w - marginX);
    const innerHeight = Math.max(1, h - marginY);
    return {shape, fs, font, lineH, lines, w, h,
            textX:margins.left + innerWidth/2,
            centerY:margins.top + innerHeight/2, maxWidth:availableWidth,
            margins, wrap, manualHeight:fixedHeight != null};
  }
  const w = fixedWidth == null ? Math.max(120, maxW) : maxW;
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
    const draftWidth = Math.max(12, Math.round(w * widthRatio) - marginX);
    const draftLines = linesFor(draftWidth);
    h = Math.max(shape === "terminator" ? 64 : 56,
      draftLines.length * lineH + 32 + marginY) + (shape === "document" ? 18 : 0);
    heightRatio = .72; centerY = shape === "document" ? (h - 12)/2 : h/2;
  }
  if (fixedHeight != null){
    h = fixedHeight;
    centerY = shape === "triangle" ? h * .64 : shape === "document" ? (h - 12)/2 : h/2;
  }
  const maxWidth = Math.max(12, Math.round(w * widthRatio) - marginX);
  const maxLines = Math.max(1, Math.floor((h * heightRatio - marginY) / lineH));
  const lines = wrap ? limitedWrappedLines(title, font, maxWidth, maxLines) : unwrappedTextBoxLines(title);
  return {shape, fs, font, lineH, lines, w, h,
          textX:w/2 + (margins.left - margins.right)/2,
          centerY:centerY + (margins.top - margins.bottom)/2, maxWidth,
          margins, wrap, manualHeight:fixedHeight != null};
}
function statusNodeLayout(n){
  const fs = statusNodeFont(n);
  const font = `600 ${fs}px Archivo, sans-serif`;
  const lineH = Math.ceil(fs * 1.28);
  const statusFs = Math.max(10, Math.min(14, Math.round(fs * .72)));
  const statusFont = `700 ${statusFs}px Archivo, sans-serif`;
  const statusLineH = Math.ceil(statusFs * 1.22);
  const fixedWidth = manualNodeWidth(n);
  const w = fixedWidth == null
    ? clampSize(n.w || STATUS_W_DEFAULT, 180, 720)
    : fixedWidth;
  const status = builtInStatus(n.status) || customStatus(n.status) || cleanStatusLabel(n.status) || STATUS_DEFAULT;
  const desiredBand = Math.ceil(textW(status, statusFont) + 28);
  const bandMax = Math.min(168, Math.max(48, Math.floor(w * .44)));
  const bandW = clampSize(desiredBand, Math.min(88, bandMax), bandMax);
  const mainW = Math.max(1, w - bandW);
  const decoration = nodeDecorationMetrics(n, fs);
  const reserve = decoration.icon ? decoration.iconSize + decoration.iconGap : 0;
  const titleMaxWidth = Math.max(16, mainW - 28 - reserve);
  const statusMaxWidth = Math.max(20, bandW - 18);
  let titleLines = wrapConceptTitle(n.title || "Status item", font, titleMaxWidth);
  let subtitleLines = decoration.subtitle
    ? wrapConceptTitle(decoration.subtitle, decoration.subtitleFont, titleMaxWidth) : [];
  let statusLines = wrapConceptTitle(status, statusFont, statusMaxWidth);
  let textH = titleLines.length * lineH +
    (subtitleLines.length ? decoration.subtitleGap + subtitleLines.length * decoration.subtitleLineH : 0);
  const naturalHeight = Math.max(60, Math.max(textH, decoration.iconSize) + 26,
    statusLines.length * statusLineH + 22);
  const h = manualNodeHeight(n) ?? naturalHeight;
  if (manualNodeHeight(n) != null){
    const mainAvailable = Math.max(lineH,h-22);
    const subtitleReserve = decoration.subtitle
      ? decoration.subtitleLineH+decoration.subtitleGap : 0;
    titleLines = limitedWrappedLines(n.title || "Status item",font,titleMaxWidth,
      Math.max(1,Math.floor((mainAvailable-subtitleReserve)/lineH)));
    const subtitleAvailable = Math.max(0,mainAvailable-titleLines.length*lineH-
      (decoration.subtitle ? decoration.subtitleGap : 0));
    subtitleLines = decoration.subtitle && subtitleAvailable >= decoration.subtitleLineH
      ? limitedWrappedLines(decoration.subtitle,decoration.subtitleFont,titleMaxWidth,
        Math.max(1,Math.floor(subtitleAvailable/decoration.subtitleLineH))) : [];
    statusLines = limitedWrappedLines(status,statusFont,statusMaxWidth,
      Math.max(1,Math.floor(Math.max(statusLineH,h-18)/statusLineH)));
    if (decoration.icon)
      decoration.iconSize = Math.min(decoration.iconSize,Math.max(14,h-20));
    textH = titleLines.length*lineH +
      (subtitleLines.length ? decoration.subtitleGap+
        subtitleLines.length*decoration.subtitleLineH : 0);
  }
  const side = n.statusSide === "left" ? "left" : "right";
  const mainX = side === "left" ? bandW : 0;
  const mainCenter = mainX + mainW/2;
  const textTop = h/2 - textH/2;
  const iconX = decoration.icon ? mainX + 14 : null;
  const textX = decoration.icon ? iconX + decoration.iconSize + decoration.iconGap : mainCenter;
  return {w, h, naturalHeight, manualHeight:manualNodeHeight(n) != null,
          fs, font, lineH, titleLines, subtitleLines, titleMaxWidth,
          status, statusFs, statusFont, statusLineH, statusLines, statusMaxWidth,
          bandW, mainW, side, decoration, iconX,
          iconY:decoration.icon ? (h - decoration.iconSize)/2 : null,
          textX, textAnchor:decoration.icon ? "start" : "middle",
          firstTitleY:textTop + fs*.83,
          firstSubtitleY:textTop + titleLines.length*lineH +
            decoration.subtitleGap + decoration.subtitleFs*.83};
}
function statusBandContainsPoint(n, point){
  if (!n || n.type !== "status" || !point) return false;
  const r = nodeRect(n);
  const localPoint = nodeTransformActive(n) ? inverseTransformNodePoint(n, point) : point;
  const layout = statusNodeLayout(n);
  const left = layout.side === "left" ? r.x : r.x + layout.mainW;
  return localPoint.x >= left && localPoint.x <= left + layout.bandW &&
         localPoint.y >= r.y && localPoint.y <= r.y + r.h;
}
/* one source of truth for table geometry at a given font size */
function tableMetrics(n){
  const base = styledNodeFont(n,rawTableFont(n),8,28);
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
    if (n.collapsed === true) return {...FRAME_COLLAPSED};
    const fixedWidth = manualNodeWidth(n);
    return {
      w: fixedWidth == null ? clampSize(n.w || FRAME_DEFAULT.w, 120, 4000) : fixedWidth,
      h: clampSize(n.h || FRAME_DEFAULT.h, 90, 4000)
    };
  }
  if (n.type === "swimlane"){
    const orientation = swimlaneOrientation(n);
    const defaults = swimlaneDefaults(n);
    const fixedWidth = manualNodeWidth(n);
    return {
      w: fixedWidth == null
        ? clampSize(n.w || defaults.w, orientation === "vertical" ? 120 : 260, 4000)
        : fixedWidth,
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
  if (n.type === "status"){
    const layout = statusNodeLayout(n);
    return {w:layout.w, h:layout.h};
  }
  if (n.type === "note"){
    const layout = richNoteLayout(n);
    return { w:layout.w, h:layout.h };
  }
  if (n.type === "todo"){
    const m = tableMetrics(n);
    const fixedWidth = manualNodeWidth(n);
    const headW = textW(n.title || "To-do list", `700 ${m.headerSize}px Archivo, sans-serif`) + 96;
    if (n.collapsed) return {
      w:fixedWidth == null ? Math.min(Math.max(190, headW), 460) : fixedWidth,
      h:m.headerH + 10
    };
    let maxRow = 150;
    for (const it of n.items){
      const rw = m.nameX + textW(it.text || "", `500 ${m.nameSize}px Archivo, sans-serif`) + 24;
      if (rw > maxRow) maxRow = rw;
    }
    const w = fixedWidth == null ? Math.min(Math.max(190, headW, maxRow), 460) : fixedWidth;
    const h = m.headerH + (Math.max(1, n.items.length) + 1) * m.rowH + 8;
    return { w, h };
  }
  // table node
  const m = tableMetrics(n);
  const fixedWidth = manualNodeWidth(n);
  const headW = textW(n.title || "table", `700 ${m.headerSize}px Archivo, sans-serif`) + 56;
  if (n.collapsed) return {
    w:fixedWidth == null ? Math.min(Math.max(190, headW), 460) : fixedWidth,
    h:m.headerH + 10
  };
  let maxRow = 150;
  for (const f of n.fields){
    const rw = m.nameX + textW(f.name + (f.nullable ? "?" : ""), `500 ${m.nameSize}px 'IBM Plex Mono', monospace`)
             + 16 + textW(f.type, `400 ${m.typeSize}px 'IBM Plex Mono', monospace`) + 20;
    if (rw > maxRow) maxRow = rw;
  }
  const w = fixedWidth == null ? Math.min(Math.max(190, headW, maxRow), 460) : fixedWidth;
  const h = m.headerH + Math.max(1, n.fields.length) * m.rowH + 8;
  return { w, h };
}
function nodeRect(n){ const s = nodeSize(n); return { x:n.x, y:n.y, w:s.w, h:s.h, cx:n.x+s.w/2, cy:n.y+s.h/2 }; }
function transformNodePoint(n, point, inverse = false){
  const r = nodeRect(n);
  const cx = r.cx, cy = r.cy;
  let x = point.x - cx, y = point.y - cy;
  const angle = nodeRotation(n) * Math.PI / 180;
  const fx = nodeFlipX(n) ? -1 : 1, fy = nodeFlipY(n) ? -1 : 1;
  if (inverse){
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const rx = x*cos - y*sin, ry = x*sin + y*cos;
    x = rx * fx;
    y = ry * fy;
  } else {
    x *= fx;
    y *= fy;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const rx = x*cos - y*sin, ry = x*sin + y*cos;
    x = rx;
    y = ry;
  }
  return {x:cx + x, y:cy + y};
}
function inverseTransformNodePoint(n, point){ return transformNodePoint(n, point, true); }
function nodeTransformActive(n){ return nodeRotation(n) !== 0 || nodeFlipX(n) || nodeFlipY(n); }
function nodeVisualRect(n){
  const r = nodeRect(n);
  if (!nodeTransformActive(n)) return r;
  const points = [
    {x:r.x, y:r.y}, {x:r.x+r.w, y:r.y},
    {x:r.x+r.w, y:r.y+r.h}, {x:r.x, y:r.y+r.h}
  ].map(point => transformNodePoint(n, point));
  const x0 = Math.min(...points.map(point => point.x));
  const y0 = Math.min(...points.map(point => point.y));
  const x1 = Math.max(...points.map(point => point.x));
  const y1 = Math.max(...points.map(point => point.y));
  return {x:x0, y:y0, w:x1-x0, h:y1-y0, cx:(x0+x1)/2, cy:(y0+y1)/2};
}
function rectFromPoints(a, b){
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w:Math.abs(a.x - b.x), h:Math.abs(a.y - b.y) };
}
function rectFullyContains(outer, inner){
  return outer.x <= inner.x && outer.y <= inner.y &&
         outer.x + outer.w >= inner.x + inner.w &&
         outer.y + outer.h >= inner.y + inner.h;
}
function rectsOverlap(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function expandedFrameRect(frame){
  const w = clampSize(Number(frame && frame.w) || FRAME_DEFAULT.w, 120, 4000);
  const h = clampSize(Number(frame && frame.h) || FRAME_DEFAULT.h, 90, 4000);
  return {x:frame.x, y:frame.y, w, h, cx:frame.x+w/2, cy:frame.y+h/2};
}
function containmentRect(n){ return n && n.type === "frame" ? expandedFrameRect(n) : nodeRect(n); }
function nodeCenterForContainment(n){
  const r = containmentRect(n);
  return {x:r.cx, y:r.cy};
}
function directContainedNodes(container, includeStructural = false){
  const outer = containmentRect(container);
  return state.nodes.filter(n => n.id !== container.id && (includeStructural || !isStructuralNode(n))).filter(n => {
    if (isStructuralNode(n)){
      const inner = containmentRect(n);
      if (inner.w * inner.h >= outer.w * outer.h) return false;
    }
    const center = nodeCenterForContainment(n);
    return center.x >= outer.x && center.x <= outer.x + outer.w &&
           center.y >= outer.y && center.y <= outer.y + outer.h;
  });
}
/* A collapsed frame hides every object centered inside its expanded footprint.
   Structural children recursively carry their own contents, so nested frames and
   swimlanes collapse as a single visual unit without changing document data. */
function collapsedFrameContentNodes(frame){
  if (!frame || frame.type !== "frame") return [];
  const contents = [], visited = new Set([frame.id]), queue = [frame];
  while (queue.length){
    const container = queue.shift();
    for (const child of directContainedNodes(container, true)){
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      contents.push(child);
      if (isStructuralNode(child)) queue.push(child);
    }
  }
  return contents;
}
function collapsedFrameHiddenNodeIds(){
  const hidden = new Set();
  for (const frame of state.nodes){
    if (frame.type !== "frame" || frame.collapsed !== true || hidden.has(frame.id)) continue;
    for (const child of collapsedFrameContentNodes(frame)) hidden.add(child.id);
  }
  return hidden;
}
/* Map each hidden object to the visible collapsed frame representing it. An
   outer collapsed frame wins over nested collapsed frames because the nested
   frame is itself hidden; overlapping visible frames prefer the smallest frame. */
function collapsedFrameProxyMap(hidden = collapsedFrameHiddenNodeIds()){
  const proxies = new Map();
  const frames = state.nodes
    .filter(n => n.type === "frame" && n.collapsed === true && !hidden.has(n.id))
    .sort((a, b) => {
      const ar = expandedFrameRect(a), br = expandedFrameRect(b);
      return ar.w * ar.h - br.w * br.h;
    });
  for (const frame of frames){
    for (const child of collapsedFrameContentNodes(frame)){
      if (hidden.has(child.id) && !proxies.has(child.id)) proxies.set(child.id, frame.id);
    }
  }
  return proxies;
}
function visibleCanvasNodes(hidden = null){
  if (hidden == null) hidden = typeof hiddenCanvasNodeIds === "function"
    ? hiddenCanvasNodeIds() : collapsedFrameHiddenNodeIds();
  return state.nodes.filter(n => !hidden.has(n.id));
}
function visibleCanvasEdges(hidden = collapsedFrameHiddenNodeIds(), proxies = collapsedFrameProxyMap(hidden)){
  return state.edges.filter(e => {
    if (typeof organizationObjectHidden === "function" && organizationObjectHidden(e)) return false;
    const fromProxy = hidden.has(e.from) ? proxies.get(e.from) : null;
    const toProxy = hidden.has(e.to) ? proxies.get(e.to) : null;
    if ((hidden.has(e.from) && !fromProxy) || (hidden.has(e.to) && !toProxy)) return false;
    return !(fromProxy && toProxy && fromProxy === toProxy);
  });
}
function documentBounds(nodes = null){
  const wholeDocument = nodes == null || nodes === state.nodes;
  const hidden = wholeDocument ? collapsedFrameHiddenNodeIds() : null;
  const proxies = wholeDocument ? collapsedFrameProxyMap(hidden) : null;
  const organizationHidden = wholeDocument && typeof organizationalHiddenNodeIds === "function"
    ? organizationalHiddenNodeIds() : new Set();
  const combinedHidden = wholeDocument ? new Set([...hidden, ...organizationHidden]) : null;
  const boundedNodes = wholeDocument ? visibleCanvasNodes(combinedHidden) : nodes;
  if (!boundedNodes.length) return null;
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for (const n of boundedNodes){
    const r = nodeVisualRect(n);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  if (wholeDocument){
    for (const e of visibleCanvasEdges(hidden, proxies)){
      if (e.routing !== "ortho" || !hasCustomOrthoBend(e)) continue;
      const ep = edgeEndpoints(e, hidden, proxies);
      if (!ep) continue;
      const bend = orthoEdgeRoute(e, ep.pa, ep.pb).bend;
      x0 = Math.min(x0, bend.x); y0 = Math.min(y0, bend.y);
      x1 = Math.max(x1, bend.x); y1 = Math.max(y1, bend.y);
    }
  }
  return { x:x0, y:y0, w:x1-x0, h:y1-y0, cx:(x0+x1)/2, cy:(y0+y1)/2 };
}
function containerContainedNodes(container){
  return directContainedNodes(container, false);
}
function frameContainedNodes(frame){ return containerContainedNodes(frame); }

/* 9 node attachment points (3×3): top/middle/bottom × left/center/right.
   Whole-node edge ends snap to the nearest perimeter point automatically;
   an explicit point is stored on the edge as fromAnchor/toAnchor (additive, E8). */
const NODE_ANCHORS = ["tl","tc","tr","ml","mc","mr","bl","bc","br"];
const PERIMETER_ANCHORS = ["tl","tc","tr","ml","mr","bl","bc","br"];
const TABLE_TITLE_ANCHORS = ["hl","hr"];
const TABLE_NODE_ANCHORS = [...NODE_ANCHORS, ...TABLE_TITLE_ANCHORS];
const TABLE_PERIMETER_ANCHORS = [...PERIMETER_ANCHORS, ...TABLE_TITLE_ANCHORS];
const ANCHOR_LABELS = { tl:"Top left", tc:"Top center", tr:"Top right",
                        ml:"Middle left", mc:"Center", mr:"Middle right",
                        bl:"Bottom left", bc:"Bottom center", br:"Bottom right",
                        hl:"Title left", hr:"Title right" };
function nodeAnchorKeys(n){
  return n && n.type === "table" ? TABLE_NODE_ANCHORS : NODE_ANCHORS;
}
function dropAnchorKeys(n){
  return n && n.type === "table" ? TABLE_PERIMETER_ANCHORS : PERIMETER_ANCHORS;
}
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
function conceptBoundaryPoint(n, r, ref, shape = visualNodeShape(n)){
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
function conceptHorizontalBoundsAtY(n, r, y){
  const shape = conceptShape(n);
  const localY = Math.max(0, Math.min(r.h, y - r.y));
  if (shape === "circle"){
    const ry = r.h/2, dy = localY - ry;
    const dx = r.w/2 * Math.sqrt(Math.max(0, 1 - (dy/ry)**2));
    return {left:r.cx-dx, right:r.cx+dx};
  }
  if (shape === "triangle"){
    const half = r.w * localY / (2*r.h);
    return {left:r.cx-half, right:r.cx+half};
  }
  if (shape === "decision"){
    const half = r.w/2 * Math.max(0, 1 - Math.abs(localY-r.h/2)/(r.h/2));
    return {left:r.cx-half, right:r.cx+half};
  }
  if (shape === "terminator"){
    const radius = Math.min(r.w/2, r.h/2);
    const dy = localY - r.h/2;
    const dx = Math.sqrt(Math.max(0, radius*radius - dy*dy));
    return {left:r.x+radius-dx, right:r.x+r.w-radius+dx};
  }
  if (shape === "data")
    return {left:r.x + 18*(1-localY/r.h), right:r.x+r.w - 18*localY/r.h};
  if (shape === "manualInput")
    return {left:r.x + 20*(1-localY/r.h), right:r.x+r.w - 14*localY/r.h};
  return {left:r.x, right:r.x+r.w};
}
function nodePortPoints(n, r = nodeRect(n)){
  if (!nodePortsEnabled(n)) return null;
  const layout = conceptWrappedLayout(n);
  const portCount = Math.max(layout.inputPorts.length, layout.outputPorts.length, 1);
  const sidePoints = (ports, side) => {
    const top = layout.portCenterY - portCount * layout.portRowH/2
      + (portCount - ports.length) * layout.portRowH/2;
    return ports.map((port, index) => {
      const y = r.y + top + layout.portRowH * (index + .5);
      const bounds = conceptHorizontalBoundsAtY(n, r, y);
      return {...port, x:side === "input" ? bounds.left : bounds.right, y,
              side:side === "input" ? "w" : "e", key:side === "input" ? "ml" : "mr",
              portSide:side};
    });
  };
  const inputs = sidePoints(layout.inputPorts, "input");
  const outputs = sidePoints(layout.outputPorts, "output");
  return {inputs, outputs, input:inputs[0], output:outputs[0]};
}
function nodePortAnchor(n, preferredSide, portId, r = nodeRect(n)){
  const points = nodePortPoints(n, r);
  if (!points) return null;
  const binding = nodePortBinding(n, portId, preferredSide);
  const side = binding ? binding.side : preferredSide;
  const candidates = side === "input" ? points.inputs : side === "output" ? points.outputs
    : points.inputs.concat(points.outputs);
  const point = candidates.find(candidate => candidate.id === portId) || candidates[0];
  if (!point) return null;
  const transformed = transformNodePoint(n, point);
  return {...point, ...transformed, side:transformNodeSide(n, point.side)};
}
function anchorPointsForNode(n, r = nodeRect(n), shape = visualNodeShape(n)){
  const pts = anchorPointsForRect(r);
  if (n && n.type === "table"){
    const titleY = r.y + tableMetrics(n).headerH/2;
    pts.hl = {x:r.x, y:titleY};
    pts.hr = {x:r.x+r.w, y:titleY};
  }
  if (CUSTOM_BOUNDARY_CONCEPT_SHAPES.has(shape))
    for (const key of PERIMETER_ANCHORS) pts[key] = conceptBoundaryPoint(n, r, pts[key], shape);
  const ports = nodePortPoints(n, r);
  if (ports){
    pts.ml = {x:ports.input.x, y:ports.input.y};
    pts.mr = {x:ports.output.x, y:ports.output.y};
  }
  return pts;
}
/* outward side of an anchor point, for curve control points and crow's feet;
   corners and the center pick the dominant axis toward the reference point */
function anchorSideFor(key, p, ref){
  if (key === "tc") return "n";
  if (key === "bc") return "s";
  if (key === "ml") return "w";
  if (key === "mr") return "e";
  if (key === "hl") return "w";
  if (key === "hr") return "e";
  const horiz = Math.abs(ref.x - p.x) >= Math.abs(ref.y - p.y);
  if (key === "tl") return horiz ? "w" : "n";
  if (key === "tr") return horiz ? "e" : "n";
  if (key === "bl") return horiz ? "w" : "s";
  if (key === "br") return horiz ? "e" : "s";
  return horiz ? (ref.x - p.x > 0 ? "e" : "w") : (ref.y - p.y > 0 ? "s" : "n"); // mc
}
function transformNodeSide(n, side){
  const vectors = {n:{x:0,y:-1}, e:{x:1,y:0}, s:{x:0,y:1}, w:{x:-1,y:0}};
  const vector = vectors[side] || vectors.e;
  const r = nodeRect(n);
  const center = {x:r.cx, y:r.cy};
  const transformed = transformNodePoint(n, {x:center.x + vector.x, y:center.y + vector.y});
  const dx = transformed.x - center.x, dy = transformed.y - center.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "e" : "w") : (dy >= 0 ? "s" : "n");
}
function nodeAnchor(n, key, ref){
  const r = nodeRect(n);
  const shape = visualNodeShape(n);
  const pts = anchorPointsForNode(n, r, shape);
  const localRef = nodeTransformActive(n) ? inverseTransformNodePoint(n, ref) : ref;
  let k = key && pts[key] ? key : null;
  /* Unpinned non-rectangular concepts use their actual silhouette intersection. */
  if (!k && CUSTOM_BOUNDARY_CONCEPT_SHAPES.has(shape)){
    const raw = conceptBoundaryPoint(n, r, localRef, shape);
    const p = transformNodePoint(n, raw);
    const dx = localRef.x - r.cx, dy = localRef.y - r.cy;
    const horiz = Math.abs(dx) / r.w >= Math.abs(dy) / r.h;
    const rawSide = horiz ? (dx >= 0 ? "e" : "w") : (dy >= 0 ? "s" : "n");
    return { x:p.x, y:p.y, side:transformNodeSide(n, rawSide), key:null };
  }
  if (!k){
    let bd = Infinity;
    for (const cand of PERIMETER_ANCHORS){
      const p = pts[cand];
      const d = (p.x - localRef.x)**2 + (p.y - localRef.y)**2;
      if (d < bd){ bd = d; k = cand; }
    }
  }
  const raw = pts[k];
  const p = transformNodePoint(n, raw);
  return { x:p.x, y:p.y,
    side:transformNodeSide(n, anchorSideFor(k, raw, localRef)), key:k };
}
/* nearest visible attachment point within tolerance — used to pin a drag's drop end */
function nearestAnchorWithin(n, w, tol = 16){
  const rawPoints = anchorPointsForNode(n);
  const pts = Object.fromEntries(Object.entries(rawPoints)
    .map(([key, point]) => [key, transformNodePoint(n, point)]));
  let best = null, bd = tol*tol;
  const rawPorts = nodePortPoints(n);
  const ports = rawPorts ? {
    inputs:rawPorts.inputs.map(point => ({...point, ...transformNodePoint(n, point)})),
    outputs:rawPorts.outputs.map(point => ({...point, ...transformNodePoint(n, point)}))
  } : null;
  if (ports){
    for (const p of ports.inputs.concat(ports.outputs)){
      const d = (p.x - w.x)**2 + (p.y - w.y)**2;
      if (d <= bd){
        bd = d;
        best = {key:p.key, x:p.x, y:p.y, portId:p.id, portSide:p.portSide};
      }
    }
  }
  for (const key of dropAnchorKeys(n)){
    if (ports && (key === "ml" || key === "mr")) continue;
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
