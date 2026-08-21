import JSZip from "jszip";

// Native .docx (OOXML) -> HTML converter, built directly against this
// document's real XML structure (not a generic library like mammoth,
// which drops images/tabs and only understands built-in "Heading N"
// styles). Handles: custom heading styles (Rozdział/Podrozdział/
// Popdpodrozdział), TOC entries with real tab-stops (toc N styles),
// hard page breaks, embedded images, tables, bold/italic.

type StyleInfo = { name: string; basedOn: string | null };

function localName(tag: string): string {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(i + 1);
}

function buildStyleMap(stylesXml: Document): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  const styles = stylesXml.getElementsByTagName("w:style");
  for (let i = 0; i < styles.length; i++) {
    const el = styles[i];
    const id = el.getAttribute("w:styleId") || "";
    const nameEl = el.getElementsByTagName("w:name")[0];
    const basedOnEl = el.getElementsByTagName("w:basedOn")[0];
    map.set(id, {
      name: nameEl ? nameEl.getAttribute("w:val") || "" : "",
      basedOn: basedOnEl ? basedOnEl.getAttribute("w:val") : null,
    });
  }
  return map;
}

// Resolves a paragraph style id to a semantic heading level (1/2/3), a
// "toc" level (1-4), or null (regular paragraph) — walking the basedOn
// chain so any custom style built on top of a heading still resolves.
function resolveStyleKind(styleId: string, styles: Map<string, StyleInfo>): { kind: "h1" | "h2" | "h3" | "toc"; level?: number } | null {
  // Direct known custom styles in this document take priority over the
  // generic basedOn walk, since e.g. "Podrozdział" is basedOn Heading 3
  // in Word's style inheritance but is semantically a level-2 heading.
  const direct: Record<string, "h1" | "h2" | "h3"> = {
    Rozdzia: "h1",
    Podrozdzia: "h2",
    Popdpodrozdzia: "h3",
  };
  if (direct[styleId]) return { kind: direct[styleId] };

  let cur: string | null = styleId;
  let depth = 0;
  while (cur && depth < 10) {
    const info = styles.get(cur);
    if (!info) return null;
    const name = info.name.toLowerCase();
    const hMatch = name.match(/^heading (\d)/);
    if (hMatch) {
      const n = Math.min(3, Math.max(1, Number(hMatch[1])));
      return { kind: (`h${n}` as "h1" | "h2" | "h3") };
    }
    const tocMatch = name.match(/^toc (\d)/);
    if (tocMatch) return { kind: "toc", level: Number(tocMatch[1]) };
    cur = info.basedOn;
    depth++;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Renders one <w:p> paragraph's runs (text, bold/italic, tabs, images,
// line breaks, page breaks) into an inline HTML string.
function renderRuns(p: Element, mediaMap: Map<string, string>): { inline: string; hasPageBreak: boolean } {
  let inline = "";
  let hasPageBreak = false;
  const runs = Array.from(p.children).filter((c) => localName(c.tagName) === "r" || localName(c.tagName) === "hyperlink");
  const walk = (run: Element) => {
    if (localName(run.tagName) === "hyperlink") {
      Array.from(run.children).forEach((c) => { if (localName(c.tagName) === "r") walk(c); });
      return;
    }
    const rPr = Array.from(run.children).find((c) => localName(c.tagName) === "rPr");
    const isBold = !!rPr && Array.from(rPr.children).some((c) => localName(c.tagName) === "b" && rPr.getAttribute("w:val") !== "0");
    const isItalic = !!rPr && Array.from(rPr.children).some((c) => localName(c.tagName) === "i");
    // w:sz is in half-points (e.g. 24 = 12pt); w:rFonts ascii is the only
    // font-name form we can resolve directly (theme fonts like
    // minorHAnsi need themes.xml, skipped — falls back to editor default).
    const szEl = rPr ? Array.from(rPr.children).find((c) => localName(c.tagName) === "sz") : null;
    const szPt = szEl ? Number(szEl.getAttribute("w:val")) / 2 : null;
    const rFontsEl = rPr ? Array.from(rPr.children).find((c) => localName(c.tagName) === "rFonts") : null;
    const fontFamily = rFontsEl ? rFontsEl.getAttribute("w:ascii") : null;
    let styleAttr = "";
    if (szPt) styleAttr += `font-size:${szPt}pt;`;
    if (fontFamily) styleAttr += `font-family:'${fontFamily}';`;
    // w:color is the run's explicit text color (e.g. white text on a
    // shaded black checklist header cell) — without it, white-on-white
    // text is invisible once we lose Word's shading-aware default.
    const colorEl = rPr ? Array.from(rPr.children).find((c) => localName(c.tagName) === "color") : null;
    const colorVal = colorEl ? colorEl.getAttribute("w:val") : null;
    if (colorVal && colorVal !== "auto") styleAttr += `color:#${colorVal};`;
    let text = "";
    Array.from(run.children).forEach((child) => {
      const ln = localName(child.tagName);
      if (ln === "t") {
        text += escapeHtml(child.textContent || "");
      } else if (ln === "tab") {
        text += "\t";
      } else if (ln === "br") {
        const type = child.getAttribute("w:type");
        if (type === "page") { hasPageBreak = true; }
        else text += "<br/>";
      } else if (ln === "drawing") {
        const blip = child.getElementsByTagName("a:blip")[0];
        const rId = blip ? blip.getAttribute("r:embed") : null;
        const src = rId ? mediaMap.get(rId) : null;
        // wp:extent is in EMUs (914400 per inch); convert to px at 96dpi so
        // the image renders at Word's actual placed size instead of its
        // raw pixel dimensions (which can be far larger/smaller than
        // intended and blow past the page width).
        const extent = child.getElementsByTagName("wp:extent")[0];
        const cx = extent ? Number(extent.getAttribute("cx")) : null;
        const cy = extent ? Number(extent.getAttribute("cy")) : null;
        const widthPx = cx ? Math.round((cx / 914400) * 96) : null;
        const heightPx = cy ? Math.round((cy / 914400) * 96) : null;
        const dims = widthPx && heightPx ? `width:${widthPx}px;height:${heightPx}px;` : "";
        // Word's floating images (wp:anchor) carry a text-wrap position
        // (left/right/center of the margin); inline images (wp:inline)
        // just flow with the text. Approximate the anchor's horizontal
        // placement with CSS float so images land on the correct side
        // instead of collapsing to plain block flow.
        const anchor = child.getElementsByTagName("wp:anchor")[0];
        let floatStyle = "";
        if (anchor) {
          const posH = anchor.getElementsByTagName("wp:positionH")[0];
          const alignEl = posH ? posH.getElementsByTagName("wp:align")[0] : null;
          const align = alignEl ? (alignEl.textContent || "").trim() : null;
          if (align === "right") floatStyle = "float:right;margin:4px 0 8px 12px;";
          else if (align === "center") floatStyle = "display:block;margin:8px auto;";
          else floatStyle = "float:left;margin:4px 12px 8px 0;";
        }
        if (src) text += `<img src="${src}" style="max-width:100%;${dims}${floatStyle}" />`;
      }
    });
    if (styleAttr) text = `<span style="${styleAttr}">${text}</span>`;
    if (isBold) text = `<b>${text}</b>`;
    if (isItalic) text = `<i>${text}</i>`;
    inline += text;
  };
  runs.forEach(walk);
  return { inline, hasPageBreak };
}

function renderTable(tbl: Element, mediaMap: Map<string, string>): string {
  // w:tblGrid gives each column's width in twentieths-of-a-point (dxa);
  // 1440 dxa = 1 inch, convert to px at 96dpi so columns keep Word's
  // proportions instead of collapsing to equal-width/cramped defaults.
  const gridEl = Array.from(tbl.children).find((c) => localName(c.tagName) === "tblGrid");
  const colWidthsPx: number[] = gridEl
    ? Array.from(gridEl.children)
        .filter((c) => localName(c.tagName) === "gridCol")
        .map((c) => Math.round((Number(c.getAttribute("w:w")) / 1440) * 96))
    : [];
  const totalPx = colWidthsPx.reduce((a, b) => a + b, 0);
  // Use the table's actual computed width from Word (sum of tblGrid
  // columns) instead of forcing 100% — many tables in this document are
  // intentionally narrower than the page and were stretching full-width.
  let html = `<table style="border-collapse:collapse;${totalPx ? `width:${totalPx}px;max-width:100%;table-layout:fixed;` : "width:100%;"}">`;
  if (colWidthsPx.length) {
    html += "<colgroup>" + colWidthsPx.map((w) => `<col style="width:${w}px;" />`).join("") + "</colgroup>";
  }
  // Word represents merged cells as separate <w:tc> elements: a
  // horizontal merge (colspan) via w:gridSpan on ONE cell, a vertical
  // merge (rowspan) via w:vMerge="restart" on the first cell and a bare
  // w:vMerge (no val = "continue") on an otherwise-empty placeholder
  // cell in each following row at the same grid column. openAt[col]
  // tracks the live rowspan counter object for whichever cell currently
  // owns that column, so a later continuation row can bump it in place.
  const numCols = colWidthsPx.length || 1;
  type Counter = { v: number };
  const openAt: (Counter | null)[] = new Array(numCols).fill(null);
  type CellOut = { colSpan: number; html: string; rowSpanRef: Counter; bgStyle: string };
  const rowsOut: CellOut[][] = [];
  const rowHeights: (number | null)[] = [];

  Array.from(tbl.children).filter((r) => localName(r.tagName) === "tr").forEach((row) => {
    const rowCells: CellOut[] = [];
    const touchedThisRow = new Set<Counter>();
    let col = 0;
    // w:trHeight is Word's actual row height (twips); honoring it keeps
    // compact checklist tables compact instead of expanding to the
    // browser's default line-height, which was pushing these tables onto
    // extra pages versus the original.
    const trPr = Array.from(row.children).find((c) => localName(c.tagName) === "trPr");
    const trHeightEl = trPr ? Array.from(trPr.children).find((c) => localName(c.tagName) === "trHeight") : null;
    const trHeightPx = trHeightEl ? Math.round((Number(trHeightEl.getAttribute("w:val")) / 1440) * 96) : null;
    Array.from(row.children).filter((c) => localName(c.tagName) === "tc").forEach((cell) => {
      const tcPr = Array.from(cell.children).find((c) => localName(c.tagName) === "tcPr");
      const gridSpanEl = tcPr ? Array.from(tcPr.children).find((c) => localName(c.tagName) === "gridSpan") : null;
      const colSpan = gridSpanEl ? Number(gridSpanEl.getAttribute("w:val")) || 1 : 1;
      const vMergeEl = tcPr ? Array.from(tcPr.children).find((c) => localName(c.tagName) === "vMerge") : null;
      const isContinue = !!vMergeEl && vMergeEl.getAttribute("w:val") !== "restart";

      while (col < numCols && openAt[col] && touchedThisRow.has(openAt[col]!)) col++;

      if (isContinue && openAt[col]) {
        openAt[col]!.v += 1;
        touchedThisRow.add(openAt[col]!);
        col += colSpan;
        return;
      }

      let inner = "";
      Array.from(cell.children).forEach((p) => {
        if (localName(p.tagName) === "p") {
          const pPr = Array.from(p.children).find((c) => localName(c.tagName) === "pPr");
          const jcEl = pPr ? Array.from(pPr.children).find((c) => localName(c.tagName) === "jc") : null;
          const jc = jcEl ? jcEl.getAttribute("w:val") : null;
          const align = jc === "center" ? "text-align:center;" : jc === "right" ? "text-align:right;" : jc === "both" ? "text-align:justify;" : "";
          const { inline } = renderRuns(p, mediaMap);
          inner += `<p style="margin:0;line-height:1.3;${align}">${inline || "&nbsp;"}</p>`;
        } else if (localName(p.tagName) === "tbl") {
          inner += renderTable(p, mediaMap);
        }
      });
      // w:shd is the cell's background fill (e.g. black checklist section
      // headers) — "auto"/"FFFFFF"/missing means no fill in Word.
      const shdEl = tcPr ? Array.from(tcPr.children).find((c) => localName(c.tagName) === "shd") : null;
      const fill = shdEl ? shdEl.getAttribute("w:fill") : null;
      const bgStyle = fill && fill !== "auto" && fill.toUpperCase() !== "FFFFFF" ? `background-color:#${fill};` : "";
      const rowSpanRef: Counter = { v: 1 };
      rowCells.push({ colSpan, html: inner, rowSpanRef, bgStyle });
      touchedThisRow.add(rowSpanRef);
      const isStart = !!vMergeEl && vMergeEl.getAttribute("w:val") === "restart";
      for (let c = col; c < col + colSpan && c < numCols; c++) {
        openAt[c] = isStart ? rowSpanRef : null;
      }
      col += colSpan;
    });
    rowsOut.push(rowCells);
    rowHeights.push(trHeightPx);
  });

  const CELL_BASE = "border-width:1px;border-style:solid;border-color:#000;padding:2px 6px;vertical-align:top;word-wrap:break-word;";
  rowsOut.forEach((rowCells, i) => {
    const h = rowHeights[i];
    html += h ? `<tr style="height:${h}px;">` : "<tr>";
    rowCells.forEach((c) => {
      const rowSpanAttr = c.rowSpanRef.v > 1 ? ` rowspan="${c.rowSpanRef.v}"` : "";
      const colSpanAttr = c.colSpan > 1 ? ` colspan="${c.colSpan}"` : "";
      html += `<td style="${CELL_BASE}${c.bgStyle}"${rowSpanAttr}${colSpanAttr}>${c.html}</td>`;
    });
    html += "</tr>";
  });
  html += "</table>";
  return html;
}

export async function convertDocxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXmlText = await zip.file("word/document.xml")!.async("text");
  const stylesXmlText = await zip.file("word/styles.xml")!.async("text");
  const relsFile = zip.file("word/_rels/document.xml.rels");
  const relsText = relsFile ? await relsFile.async("text") : "";

  const parser = new DOMParser();
  const docXml = parser.parseFromString(docXmlText, "application/xml");
  const stylesXml = parser.parseFromString(stylesXmlText, "application/xml");
  const relsXml = relsText ? parser.parseFromString(relsText, "application/xml") : null;

  const styles = buildStyleMap(stylesXml);

  // Map relationship id -> media file path.
  const relTargets = new Map<string, string>();
  if (relsXml) {
    const rels = relsXml.getElementsByTagName("Relationship");
    for (let i = 0; i < rels.length; i++) {
      const el = rels[i];
      relTargets.set(el.getAttribute("Id") || "", el.getAttribute("Target") || "");
    }
  }
  // Map relationship id -> base64 data URI, loading each referenced image.
  const mediaMap = new Map<string, string>();
  for (const [rId, target] of relTargets) {
    if (!/^media\//.test(target)) continue;
    const file = zip.file(`word/${target}`);
    if (!file) continue;
    const ext = target.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
    const base64 = await file.async("base64");
    mediaMap.set(rId, `data:${mime};base64,${base64}`);
  }

  const body = docXml.getElementsByTagName("w:body")[0];
  let html = "";
  // Word wraps some content (TOC fields, content controls) in <w:sdt>
  // rather than putting <w:p>/<w:tbl> as direct children of the body —
  // walk recursively through any wrapper so nothing nested is skipped.
  const processedParagraphs: Element[] = [];
  const collect = (container: Element) => {
    Array.from(container.children).forEach((el) => {
      const ln = localName(el.tagName);
      if (ln === "p" || ln === "tbl") {
        processedParagraphs.push(el);
      } else if (ln === "sdt") {
        const content = Array.from(el.children).find((c) => localName(c.tagName) === "sdtContent");
        if (content) collect(content);
      } else if (ln !== "sectPr") {
        collect(el);
      }
    });
  };
  collect(body);
  processedParagraphs.forEach((el) => {
    const ln = localName(el.tagName);
    if (ln === "tbl") {
      html += renderTable(el, mediaMap);
      return;
    }
    const pPr = Array.from(el.children).find((c) => localName(c.tagName) === "pPr");
    const pStyleEl = pPr ? Array.from(pPr.children).find((c) => localName(c.tagName) === "pStyle") : null;
    const styleId = pStyleEl ? pStyleEl.getAttribute("w:val") || "" : "";
    const resolved = styleId ? resolveStyleKind(styleId, styles) : null;
    const jcEl = pPr ? Array.from(pPr.children).find((c) => localName(c.tagName) === "jc") : null;
    const jc = jcEl ? jcEl.getAttribute("w:val") : null;
    const alignStyle = jc === "center" ? "text-align:center;" : jc === "right" ? "text-align:right;" : jc === "both" ? "text-align:justify;" : "";
    const { inline, hasPageBreak } = renderRuns(el, mediaMap);

    if (hasPageBreak) {
      html += '<div class="manual-page-break" contenteditable="false" data-label="— Podział strony —"></div><p><br></p>';
    }
    if (!inline.trim()) return; // skip empty paragraphs (Word spacing artifacts)

    if (resolved?.kind === "h1") html += `<h1${alignStyle ? ` style="${alignStyle}"` : ""}>${inline}</h1>`;
    else if (resolved?.kind === "h2") html += `<h2${alignStyle ? ` style="${alignStyle}"` : ""}>${inline}</h2>`;
    else if (resolved?.kind === "h3") html += `<h3${alignStyle ? ` style="${alignStyle}"` : ""}>${inline}</h3>`;
    else if (resolved?.kind === "toc") {
      // Real Word tab-stop between title and page number -> flex row with
      // a dotted leader, matching the visual look of Word's TOC exactly
      // instead of the collapsed/invisible tab from clipboard paste.
      const parts = inline.split("\t");
      const label = parts[0] || "";
      const pageNum = parts.length > 1 ? parts[parts.length - 1] : "";
      const indent = 12 + ((resolved.level || 1) - 1) * 16;
      html += `<p style="display:flex;align-items:baseline;margin:2px 0 2px ${indent}px;">
        <span>${label}</span>
        <span style="flex:1;border-bottom:1px dotted #666;margin:0 4px;height:1px;"></span>
        <span>${pageNum}</span>
      </p>`;
    } else {
      html += `<p${alignStyle ? ` style="${alignStyle}"` : ""}>${inline}</p>`;
    }
  });
  return html;
}
