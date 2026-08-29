import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import HeadingExt from "@tiptap/extension-heading";
import { Table } from "@tiptap/extension-table";
import TiptapTableRow from "@tiptap/extension-table-row";
const TableRow = TiptapTableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: { default: null, renderHTML: (a: any) => (a.height ? { style: `height:${a.height}` } : {}) },
    };
  },
});
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import ImageExt from "@tiptap/extension-image";
import { isTocHeadingTitle } from "../lib/headingNumbering";
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TableMap, CellSelection } from "@tiptap/pm/tables";
import { convertDocxToHtml } from "../lib/docxImport";
import { docContentCss } from "../lib/docContentStyle";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType };
  }
}
// Brak stabilnej wersji @tiptap/extension-font-size na npm (tylko
// 3.0.0-next.*) — rozmiar czcionki jako atrybut na TextStyle (kilka linii,
// bez dodatkowej zależności), ten sam mechanizm co oficjalny pakiet.
const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || null,
            renderHTML: (attrs: any) => (attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }) => chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark("textStyle", { fontSize: null }).run(),
    };
  },
});

// --- Sekcja: h4 z wymuszonym inline style, POZA numeracją h1/h2/h3 (§4) ---
const SECTION_STYLE = "font-size:20pt;font-weight:bold;text-transform:uppercase;letter-spacing:1px;border-bottom:3px solid #1a1a8c;margin:32px 0 16px;";

const PAGE_BREAK_CLASS = "manual-page-break";
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    manualPageBreak: { insertManualPageBreak: () => ReturnType };
    comment: {
      setComment: (id: string) => ReturnType;
      unsetComment: () => ReturnType;
    };
  }
}
const ManualPageBreak = Node.create({
  name: "manualPageBreak",
  group: "block",
  atom: true,
  selectable: false,
  parseHTML() { return [{ tag: `div.${PAGE_BREAK_CLASS}` }]; },
  renderHTML() {
    return ["div", mergeAttributes({ class: PAGE_BREAK_CLASS, "data-label": "— Podział strony —", contenteditable: "false" })];
  },
  addCommands() {
    return { insertManualPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertManualPageBreak() };
  },
});

// --- Komentarze inline (§9 inventory) ---
// Ta sama klasa/atrybuty co DocumentationModule.tsx (doc-comment-anchor /
// data-comment-id / data-comment-text), żeby istniejący eksport/print,
// który po nich parsuje, działał bez zmian.
const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs: any) => ({ "data-comment-id": attrs.commentId }),
      },
      commentText: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-text") || "",
        renderHTML: (attrs: any) => ({ "data-comment-text": attrs.commentText || "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span.doc-comment-anchor" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-comment-anchor" }), 0];
  },
  addCommands() {
    return {
      setComment: (id: string) => ({ commands }) => commands.setMark(this.name, { commentId: id, commentText: "" }),
      unsetComment: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

// --- Numeracja nagłówków h1/h2/h3 (§2 inventory) ---

const NumberedHeading = HeadingExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataNum: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-num"),
        renderHTML: (attrs: any) => (attrs.dataNum ? { "data-num": attrs.dataNum } : {}),
      },
    };
  },
});

function computeHeadingNumbers(doc: any, h1Offset: number) {
  const counters = [h1Offset, 0, 0];
  const nums = new Map<number, string>();
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs.level;
    if (level < 1 || level > 3) return;
    const text = (node.textContent || "").trim();
    if (isTocHeadingTitle(text)) return;
    counters[level - 1] += 1;
    for (let i = level; i < 3; i++) counters[i] = 0;
    nums.set(pos, counters.slice(0, level).join("."));
  });
  return nums;
}

const HeadingNumbering = Extension.create<{ h1OffsetBefore: number }>({
  name: "headingNumbering",
  addOptions() {
    return { h1OffsetBefore: 0 };
  },
  addProseMirrorPlugins() {
    const getOffset = () => this.options.h1OffsetBefore;
    return [
      new Plugin({
        key: new PluginKey("headingNumbering"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const nums = computeHeadingNumbers(newState.doc, getOffset());
          let tr = newState.tr;
          let changed = false;
          newState.doc.descendants((node: any, pos: number) => {
            if (node.type.name !== "heading") return;
            const num = nums.get(pos) ?? null;
            if (node.attrs.dataNum !== num) {
              tr = tr.setNodeAttribute(pos, "dataNum", num);
              changed = true;
            }
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});


// --- Wklejanie / import z Worda (§8 inventory) ---
// Wklejany/importowany HTML (schowek, docx) niesie ze sobą font/rozmiar/
// interlinię/kolor/marginesy źródła (Word, strona www, PDF) - to one z tych
// niespójności powodowały rozjazd wysokości akapitów względem reszty
// dokumentu. Normalizujemy do "surowego" stylu: tylko pogrubienie/kursywa/
// podkreślenie/przekreślenie/wyrównanie tekstu przechodzą, wszystko inne
// (font-family, font-size, line-height, letter-spacing, color, margin,
// padding, font-weight, font-style, text-decoration, wyrównanie) jest
// usuwane - wklejony tekst ma być czysty jak wpisany z klawiatury,
// dziedziczy jeden wygląd z COUNTER_CSS. Zostaje tylko struktura (akapity,
// listy, tabele, obrazy).
const PASTE_ALLOWED_STYLE_PROPS = new Set<string>([]);

// Tagi niosące WYŁĄCZNIE formatowanie znakowe (pogrubienie/kursywa/
// podkreślenie/przekreślenie/indeks) - rozpakuj, zostaw samą treść.
const PASTE_FORMATTING_TAGS = "b, strong, i, em, u, ins, s, strike, del, sup, sub";

function unwrapBoldTags(root: HTMLElement) {
  root.querySelectorAll(PASTE_FORMATTING_TAGS).forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

function stripPastedInlineStyle(el: HTMLElement, keepProps?: Set<string>) {
  const allowed = keepProps || PASTE_ALLOWED_STYLE_PROPS;
  const style = el.getAttribute("style");
  if (!style) return;
  const kept: string[] = [];
  style.split(";").forEach((decl) => {
    const idx = decl.indexOf(":");
    if (idx === -1) return;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!prop || !val) return;
    if (allowed.has(prop)) kept.push(`${prop}:${val}`);
  });
  if (kept.length) el.setAttribute("style", kept.join(";"));
  else el.removeAttribute("style");
}

function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Legacy <font face/size/color> (stary HTML, Outlook) - usuń całkowicie,
  // sam tag zostaje (niesie treść), tylko atrybuty stylujące znikają.
  doc.body.querySelectorAll<HTMLElement>("font").forEach((el) => {
    el.removeAttribute("face");
    el.removeAttribute("size");
    el.removeAttribute("color");
  });
  unwrapBoldTags(doc.body);
  doc.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const tag = el.tagName;
    if (tag === "IMG") {
      stripPastedInlineStyle(el, new Set(["width", "height"]));
    } else if (tag === "TABLE") {
      stripPastedInlineStyle(el, new Set(["margin-left", "margin-right"]));
    } else {
      stripPastedInlineStyle(el);
    }
  });
  doc.body.innerHTML = doc.body.innerHTML.replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0");
  doc.body.querySelectorAll<HTMLElement>("td, th").forEach((el) => {
    el.style.borderWidth = "1px";
    el.style.borderStyle = "solid";
    el.style.borderColor = "#000";
  });
  return doc.body.innerHTML;
}

// --- Obrazki: resize/align/drag&drop (§5 inventory) ---
function ImageNodeView({ node, updateAttributes, selected, editor }: any) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [showSizeModal, setShowSizeModal] = useState(false);
  const [sizeW, setSizeW] = useState("");
  const [sizeH, setSizeH] = useState("");

  const openSizeModal = () => {
    setSizeW(node.attrs.width ? String(parseInt(node.attrs.width, 10)) : "");
    setSizeH(node.attrs.height ? String(parseInt(node.attrs.height, 10)) : "");
    setShowSizeModal(true);
  };
  const applySizeModal = () => {
    const w = parseInt(sizeW, 10);
    const h = parseInt(sizeH, 10);
    const attrs: any = {};
    if (w > 0) attrs.width = `${w}px`;
    if (h > 0) attrs.height = `${h}px`;
    if (Object.keys(attrs).length) updateAttributes(attrs);
    setShowSizeModal(false);
  };

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    dragState.current = { startX: e.clientX, startWidth: img.getBoundingClientRect().width };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = ev.clientX - dragState.current.startX;
      const newWidth = Math.max(40, Math.round(dragState.current.startWidth + delta));
      updateAttributes({ width: `${newWidth}px` });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [updateAttributes]);

  const setPercent = (pct: number) => {
    const natural = imgRef.current?.naturalWidth || 400;
    updateAttributes({ width: `${Math.round(natural * (pct / 100))}px` });
  };

  const align = node.attrs.align || "center";
  const indentLeftPx = node.attrs.indentLeft ? parseFloat(node.attrs.indentLeft) : 0;
  const indentRightPx = node.attrs.indentRight ? parseFloat(node.attrs.indentRight) : 0;
  // Float/margin muszą siedzieć na WRAPPERZE (który jest elementem w
  // normalnym przepływie akapitu), nie na samym <img> - wcześniej wrapper
  // miał "display:inline-block" i float na <img> był w nim uwięziony,
  // więc na zewnątrz (w akapicie) nie było go w ogóle widać.
  const wrapperStyle: React.CSSProperties = { position: "relative" };
  if (align === "center") {
    wrapperStyle.float = "none";
    wrapperStyle.display = "block";
    wrapperStyle.marginLeft = "auto";
    wrapperStyle.marginRight = "auto";
    wrapperStyle.width = node.attrs.width || "fit-content";
  } else if (align === "right") {
    wrapperStyle.float = "right";
    wrapperStyle.margin = `0 ${indentRightPx}px 8px 8px`;
  } else {
    wrapperStyle.float = "left";
    wrapperStyle.margin = `0 8px 8px ${indentLeftPx}px`;
  }
  const style: React.CSSProperties = { display: "block" };
  if (node.attrs.width) style.width = node.attrs.width;
  const heightPx = node.attrs.height ? parseFloat(node.attrs.height) : NaN;
  if (!isNaN(heightPx) && heightPx > 0 && heightPx <= 3000) style.height = node.attrs.height;

  return (
    <NodeViewWrapper as="span" style={wrapperStyle}>
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt || ""}
        style={{ ...style, outline: selected ? "2px solid #4fc3f7" : "none" }}
        draggable={editor.isEditable}
      />
      {selected && (
        <span
          contentEditable={false}
          style={{ position: "absolute", top: -32, left: 0, display: "flex", gap: 4, background: "#fff", border: "1px solid #ccc", padding: "2px 4px", borderRadius: 4, zIndex: 20, whiteSpace: "nowrap" }}
        >
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setPercent(25)}>25%</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setPercent(50)}>50%</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setPercent(100)}>100%</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={openSizeModal}>📐</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ align: "left" })}>⬅</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ align: "center" })}>⬛</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ align: "right" })}>➡</button>
        </span>
      )}
      {selected && (
        <span
          contentEditable={false}
          onMouseDown={startResize}
          style={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, background: "#4fc3f7", border: "1px solid #fff", borderRadius: 2, cursor: "nwse-resize", zIndex: 20 }}
        />
      )}
      {showSizeModal && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000 }} onClick={() => setShowSizeModal(false)}>
          <div style={{ background: "#fff", borderRadius: 6, padding: 16, minWidth: 240 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 600, marginBottom: 10 }}>📐 Rozmiar obrazu</h3>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Szerokość (px)</label>
            <input type="number" value={sizeW} onChange={(e) => setSizeW(e.target.value)} style={{ width: "100%", marginBottom: 8 }} placeholder="np. 400" />
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Wysokość (px)</label>
            <input type="number" value={sizeH} onChange={(e) => setSizeH(e.target.value)} style={{ width: "100%", marginBottom: 12 }} placeholder="auto" />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowSizeModal(false)}>Anuluj</button>
              <button type="button" onClick={applySizeModal}>Zastosuj</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}

const AlignableImage = ImageExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.width || el.getAttribute("width") || null,
        renderHTML: (a: any) => (a.width ? { style: `width:${a.width}` } : {}),
      },
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.height || el.getAttribute("height") || null,
        renderHTML: (a: any) => (a.height ? { style: `height:${a.height}` } : {}),
      },
      align: {
        default: "left",
        parseHTML: (el: HTMLElement) => {
          const attr = el.getAttribute("data-align");
          if (attr) return attr;
          if (el.style.float === "right") return "right";
          if (el.style.display === "block" && el.style.marginLeft === "auto") return "center";
          return "left";
        },
        renderHTML: (a: any) => {
          const l = a.indentLeft ? parseFloat(a.indentLeft) : 0;
          const r = a.indentRight ? parseFloat(a.indentRight) : 0;
          const style = a.align === "center"
            ? "float:none;display:block;margin-left:auto;margin-right:auto;"
            : a.align === "right"
            ? `float:right;margin:0 ${r}px 8px 8px;`
            : `float:left;margin:0 8px 8px ${l}px;`;
          return { "data-align": a.align, style };
        },
      },
      indentLeft: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
      indentRight: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

function downscaleImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxW = 1400;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no ctx")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}

function settlePaginationAfterImagesLoad(editor: any) {
  const dom = editor.view.dom as HTMLElement;
  const resettle = () => {
    editor.commands.disablePagination();
    requestAnimationFrame(() => {
      editor.commands.enablePagination();
    });
  };
  const imgs = Array.from(dom.querySelectorAll("img")).filter((img: any) => !img.complete);
  if (imgs.length === 0) {
    resettle();
    return;
  }
  let remaining = imgs.length;
  const onDone = () => {
    remaining--;
    if (remaining === 0) resettle();
  };
  imgs.forEach((img: any) => {
    img.addEventListener("load", onDone, { once: true });
    img.addEventListener("error", onDone, { once: true });
  });
}
const AlignableTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "left",
        renderHTML: (a: any) => {
          const l = a.indentLeft ? parseFloat(a.indentLeft) : 0;
          const r = a.indentRight ? parseFloat(a.indentRight) : 0;
          if (a.align === "center") return { style: "margin-left:auto;margin-right:auto;" };
          if (a.align === "right") return { style: `margin-left:auto;margin-right:${r}px;` };
          return { style: `margin-left:${l}px;margin-right:auto;` };
        },
        parseHTML: (el: HTMLElement) => {
          const s = el.style.marginLeft === "auto" && el.style.marginRight === "auto"
            ? "center"
            : el.style.marginLeft === "auto"
            ? "right"
            : "left";
          return s;
        },
      },
      // Wcięcie z "Wcięcie całego dokumentu" (indentLeft/indentRight) - nie
      // pisze własnego style'a (żeby nie kolidować z margin z "align"
      // powyżej) - jest tylko odczytywane przez align.renderHTML (eksport)
      // i przez syncTableWidths (żywy edytor, patrz niżej).
      indentLeft: {
        default: null,
        parseHTML: (el: HTMLElement) => (el.style.marginLeft && el.style.marginLeft !== "auto" ? el.style.marginLeft : null),
        renderHTML: () => ({}),
      },
      indentRight: {
        default: null,
        parseHTML: (el: HTMLElement) => (el.style.marginRight && el.style.marginRight !== "auto" ? el.style.marginRight : null),
        renderHTML: () => ({}),
      },
    };
  },
}).configure({ resizable: true });

// Wcięcie akapitu/nagłówka z lewej i prawej (cm, przechowywane jako px w
// atrybucie) - globalny attribute na paragraph/heading, żeby dało się
// ustawić jednym transakcyjnym przebiegiem po całym dokumencie ("Wcięcie
// całego dokumentu"), analogicznie do textAlign z TextAlign extension.
const BlockIndent = Extension.create({
  name: "blockIndent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indentLeft: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.marginLeft || null,
            renderHTML: (attrs: any) => (attrs.indentLeft ? { style: `margin-left:${attrs.indentLeft}` } : {}),
          },
          indentRight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.marginRight || null,
            renderHTML: (attrs: any) => (attrs.indentRight ? { style: `margin-right:${attrs.indentRight}` } : {}),
          },
        },
      },
    ];
  },
});

// SimplePagination: wlasny silnik zywej paginacji (bez tiptap-pagination-plus).
// Mierzy realne wysokosci top-level blokow (getBoundingClientRect) i wstawia
// bloki naglowka/stopki jako NORMALNE elementy w przeplywie dokumentu (nie
// position:absolute) - ich wysokosc jest STALA (pochodzi z ustawien cm, nie
// z pomiaru), wiec wstawienie ich nigdy nie wprowadza niestabilnej petli:
// kazda rekalkulacja liczy od zera na podstawie realnych wezlow dokumentu
// (doc.forEach), a nie na podstawie poprzednio wstawionych dekoracji.
// Rekalkulacja odpala sie gdy zmienia sie editor.state.doc (nasz wlasny
// dispatch dekoracji nie tworzy nowego doc, wiec sam siebie nie zapetla) +
// po zaladowaniu obrazkow + po resize.
const SIMPLE_PAGE_BREAK_KEY = new PluginKey("simplePageBreaks");
const MM_TO_PX = 96 / 25.4;
const PAGE_H_PX = Math.round(297 * MM_TO_PX);
const SIDE_MARGIN_PX = Math.round(12.7 * MM_TO_PX);

type HfPagCfg = {
  headerLeft: string; headerCenter: string; headerRight: string;
  headerEvenLeft: string; headerEvenCenter: string; headerEvenRight: string;
  footerLeft: string; footerCenter: string; footerRight: string;
  enableHeader: boolean; enableFooter: boolean;
  headerHeightCm: number; footerHeightCm: number;
  headerFontSize: number; footerFontSize: number;
  headerBorder: boolean; footerBorder: boolean;
  skipFirstPage: boolean;
  showPageNumbers: boolean;
  onPageCountChange?: (count: number) => void;
};

function cmToPx(cm: number) { return Math.round(cm * 10 * MM_TO_PX); }
function nl2brSimple(t: string) { return (t || "").replace(/\n/g, "<br/>"); }
// Jedna linia tekstu -> wyśrodkuj pionowo w polu nagłówka/stopki (jak dotąd
// domyślnie); więcej linii (w KTÓRYMKOLWIEK z pól L/C/P) -> klasyczne
// wyrównanie od góry, bo wycentrowany wielolinijkowy blok wygląda źle i
// najedzie na obramowanie.
function headerFooterAlignItems(left: string, center: string, right: string): "center" | "flex-start" {
  const multiline = [left, center, right].some((t) => (t || "").includes("\n"));
  return multiline ? "flex-start" : "center";
}

function buildHeaderEl(cfg: HfPagCfg, pageNum: number, totalPages: number) {
  const isOdd = pageNum % 2 === 1;
  const left = isOdd ? cfg.headerLeft : (cfg.headerEvenLeft || cfg.headerLeft);
  const center = isOdd ? cfg.headerCenter : (cfg.headerEvenCenter || cfg.headerCenter);
  const right = isOdd ? cfg.headerRight : (cfg.headerEvenRight || cfg.headerRight);
  const el = document.createElement("div");
  el.className = "simple-page-header";
  el.contentEditable = "false";
  el.style.height = `${cmToPx(cfg.headerHeightCm)}px`;
  el.style.fontSize = `${cfg.headerFontSize}pt`;
  el.style.margin = `0 -${SIDE_MARGIN_PX}px`;
  el.style.padding = `0 ${SIDE_MARGIN_PX}px 6px`;
  el.style.alignItems = headerFooterAlignItems(left, center, right);
  if (cfg.headerBorder) el.style.borderBottom = "1px solid #ccc";
  el.innerHTML = `<span>${nl2brSimple(left)}</span><span>${nl2brSimple(center)}</span><span>${nl2brSimple(right)}</span>`;
  if (cfg.showPageNumbers) {
    const pageLabel = document.createElement("div");
    pageLabel.className = "simple-page-number-badge";
    pageLabel.textContent = `Strona ${pageNum} / ${totalPages}`;
    el.appendChild(pageLabel);
  }
  return el;
}

function buildFooterEl(cfg: HfPagCfg, pageNum: number, totalPages: number) {
  const el = document.createElement("div");
  el.className = "simple-page-footer";
  el.contentEditable = "false";
  el.style.height = `${cmToPx(cfg.footerHeightCm)}px`;
  el.style.fontSize = `${cfg.footerFontSize}pt`;
  el.style.margin = `0 -${SIDE_MARGIN_PX}px`;
  el.style.padding = `6px ${SIDE_MARGIN_PX}px 0`;
  el.style.alignItems = headerFooterAlignItems(cfg.footerLeft, cfg.footerCenter, cfg.footerRight);
  if (cfg.footerBorder) el.style.borderTop = "1px solid #ccc";
  el.innerHTML = `<span>${nl2brSimple(cfg.footerLeft)}</span><span>${nl2brSimple(cfg.footerCenter)}</span><span>${nl2brSimple(cfg.footerRight)}</span>`;
  if (cfg.showPageNumbers) {
    const pageLabel = document.createElement("div");
    pageLabel.className = "simple-page-number-badge";
    pageLabel.textContent = `Strona ${pageNum} / ${totalPages}`;
    el.appendChild(pageLabel);
  }
  return el;
}

function buildGapEl(pageNum: number, totalPages: number) {
  const el = document.createElement("div");
  el.className = "simple-page-gap";
  el.contentEditable = "false";
  const label = document.createElement("span");
  label.className = "simple-page-gap-label";
  label.textContent = `Strona ${pageNum} / ${totalPages}`;
  el.appendChild(label);
  return el;
}

function buildPageBoundaryWidget(cfg: HfPagCfg, endingPageNum: number, startingPageNum: number, totalPages: number) {
  return () => {
    const wrap = document.createElement("div");
    wrap.contentEditable = "false";
    if (cfg.enableFooter && !(cfg.skipFirstPage && endingPageNum === 1)) wrap.appendChild(buildFooterEl(cfg, endingPageNum, totalPages));
    wrap.appendChild(buildGapEl(endingPageNum, totalPages));
    if (cfg.enableHeader && !(cfg.skipFirstPage && startingPageNum === 1)) wrap.appendChild(buildHeaderEl(cfg, startingPageNum, totalPages));
    return wrap;
  };
}

const MIN_LEAD = 60; // px - unikaj osamotnionego nagłówka na dole strony (jak w paginateInner podglądu)

// Wylicza offsety ProseMirror, gdzie ma wypaść podział strony, SUMUJĄC
// własną wysokość każdego bloku (getBoundingClientRect().height), zamiast
// mierzyć odległość (top/bottom) między pozycjami dwóch bloków w DOM.
// To drugie jest zanieczyszczone przez WŁASNE, wcześniej wstawione widgety
// nagłówka/stopki/przerwy tego samego pluginu, które fizycznie siedzą
// między węzłami dokumentu i przesuwają ich pozycję w dół - dokładnie ten
// sam mechanizm sprzężenia zwrotnego, który wcześniej zepsuł
// tiptap-pagination-plus (2026-08-28). Sumowanie wysokości per-blok jest
// na to odporne i jest DOKŁADNIE tym samym algorytmem co paginateInner w
// podglądzie (buildChapterPreviewHtml) - stąd liczba stron się zgadza.
function computeBreakOffsets(view: any, contentH: number): number[] {
  const breakOffsets: number[] = [];
  let currentH = 0;
  view.state.doc.forEach((_node: any, offset: number) => {
    const domNode = view.nodeDOM(offset);
    if (!(domNode instanceof HTMLElement)) return;
    if (domNode.classList.contains(PAGE_BREAK_CLASS)) {
      breakOffsets.push(offset);
      currentH = 0;
      return;
    }
    const h = domNode.getBoundingClientRect().height;
    const isHeading = /^H[1-4]$/.test(domNode.tagName);
    if (currentH > 0 && currentH + h > contentH) {
      breakOffsets.push(offset);
      currentH = 0;
    } else if (isHeading && currentH > 0 && (contentH - currentH) < (h + MIN_LEAD)) {
      breakOffsets.push(offset);
      currentH = 0;
    }
    currentH += h;
  });
  return breakOffsets;
}

function computeSimplePageBreaks(view: any, cfg: HfPagCfg) {
  const dom = view.dom as HTMLElement;
  const proseRect = dom.getBoundingClientRect();
  if (proseRect.height === 0) return DecorationSet.empty;
  const headerHPx = cmToPx(cfg.headerHeightCm);
  const footerHPx = cmToPx(cfg.footerHeightCm);
  const contentH = PAGE_H_PX - headerHPx - footerHPx;
  const breakOffsets = computeBreakOffsets(view, contentH);
  const totalPages = breakOffsets.length + 1;
  cfg.onPageCountChange?.(totalPages);
  const decos: Decoration[] = [];
  breakOffsets.forEach((offset, i) => {
    const endingPage = i + 1;
    const startingPage = i + 2;
    const key = `spb-${offset}`;
    decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, startingPage, totalPages), { side: -1, key }));
  });
  if (cfg.enableHeader && !cfg.skipFirstPage) {
    decos.push(Decoration.widget(0, () => buildHeaderEl(cfg, 1, totalPages), { side: -1, key: "spb-header-first" }));
  }
  if (cfg.enableFooter && !(totalPages === 1 && cfg.skipFirstPage)) {
    const endPos = view.state.doc.content.size;
    decos.push(Decoration.widget(endPos, () => buildFooterEl(cfg, totalPages, totalPages), { side: 1, key: "spb-footer-last" }));
  }
  return DecorationSet.create(view.state.doc, decos);
}

// Tabela z resizable:true dostaje kolwidth per-komórka, ale sam <table> bez
// jawnej szerokości domyślnie wypełnia cały kontener (stąd przyciski
// "Tabela do lewej/prawej/wyśrodkowana" nie miały żadnego widocznego efektu -
// nie było gdzie przesunąć, bo tabela i tak zajmowała 100% szerokości).
// Ten plugin ustawia realną szerokość <table> = suma szerokości kolumn,
// ale TYLKO gdy użytkownik jawnie ustawił szerokość wszystkich kolumn
// (drag albo modal "Rozmiar tabeli") - w przeciwnym razie zostawia auto.
const TABLE_WIDTH_SYNC_KEY = new PluginKey("tableWidthSync");
const DEFAULT_SYNCED_COL_WIDTH = 150;
function syncTableWidths(view: any) {
  view.state.doc.descendants((node: any, pos: number) => {
    if (node.type.spec.tableRole !== "table") return;
    const map = TableMap.get(node);
    const colWidths: number[] = new Array(map.width).fill(0);
    for (let col = 0; col < map.width; col++) {
      for (let row = 0; row < map.height; row++) {
        const cellPos = map.map[row * map.width + col];
        const cell = node.nodeAt(cellPos);
        const w = cell?.attrs?.colwidth?.[0];
        if (w) colWidths[col] = Math.max(colWidths[col], w);
      }
    }
    let dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom && dom.tagName !== "TABLE") dom = dom.querySelector("table");
    if (!dom) return;
    // Kolumny bez jawnie ustawionej szerokości dostają wartość domyślną -
    // tabela ZAWSZE ma jawną (nie "auto"/100%) szerokość, żeby przyciski
    // pozycji (lewo/środek/prawo) miały efekt nawet na świeżo wstawionej,
    // nigdy nie resizowanej tabeli.
    const total = colWidths.reduce((a, w) => a + (w || DEFAULT_SYNCED_COL_WIDTH), 0);
    dom.style.width = `${total}px`;
    // Wbudowany resizable-NodeView Tiptapa renderuje <table> samodzielnie
    // i NIE stosuje style'a wygenerowanego przez renderHTML atrybutu align
    // (dlatego przyciski pozycji tabeli nie miały żadnego widocznego efektu
    // na żywo, mimo że sam atrybut poprawnie się zapisywał) - wymuszamy
    // pozycjonowanie bezpośrednio na realnym DOM-ie, tak jak szerokość wyżej.
    const align = node.attrs.align || "left";
    const indentLeftPx = node.attrs.indentLeft ? parseFloat(node.attrs.indentLeft) : 0;
    const indentRightPx = node.attrs.indentRight ? parseFloat(node.attrs.indentRight) : 0;
    if (align === "center") {
      dom.style.marginLeft = "auto";
      dom.style.marginRight = "auto";
      dom.style.float = "none";
    } else if (align === "right") {
      dom.style.marginLeft = "auto";
      dom.style.marginRight = `${indentRightPx}px`;
      dom.style.float = "none";
    } else {
      dom.style.marginLeft = `${indentLeftPx}px`;
      dom.style.marginRight = "auto";
      dom.style.float = "none";
    }
  });
}
function createTableWidthSyncExtension() {
  return Extension.create({
    name: "tableWidthSync",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: TABLE_WIDTH_SYNC_KEY,
          view(editorView) {
            let frame: number | null = null;
            const schedule = () => {
              if (frame !== null) cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => { frame = null; syncTableWidths(editorView); });
            };
            schedule();
            return {
              update(view, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                if (frame !== null) cancelAnimationFrame(frame);
              },
            };
          },
        }),
      ];
    },
  });
}

// Nowy UX dla tabel: pasek narzędzi doczepiony do klikniętej tabeli.
// WAŻNE: to NIE jest dekoracja ProseMirror wstawiona w przepływ dokumentu
// (tak było wcześniej) - taki widget fizycznie zajmuje miejsce i przesuwa
// resztę treści, a silnik paginacji (SimplePagination) liczy wysokość
// strony SUMUJĄC wysokości bloków dokumentu - pojawienie/zniknięcie paska
// rozjeżdżało tę sumę i dawało efekt "tabela skacze/zmienia kształt".
// Zamiast tego: tylko ŚLEDZIMY pozycję tabeli pod kursorem (funkcja niżej),
// a sam pasek renderuje się jako zwykły React-owy portal do document.body,
// position:fixed nad realnym prostokątem tabeli (editor.view.nodeDOM) -
// całkowicie poza drzewem mierzonym przez paginację, więc nic nie przesuwa.
function findEnclosingTable(state: any): { pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.spec.tableRole === "table") return { pos: $from.before(d) };
  }
  return null;
}

function createSimplePaginationExtension(cfgRef: { current: HfPagCfg }, forceRecomputeRef: { current: (() => void) | null }) {
  return Extension.create({
    name: "simplePagination",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: SIMPLE_PAGE_BREAK_KEY,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, old) {
              const meta = tr.getMeta(SIMPLE_PAGE_BREAK_KEY);
              if (meta) return meta;
              return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
            },
          },
          props: {
            decorations(state) {
              return SIMPLE_PAGE_BREAK_KEY.getState(state);
            },
          },
          view(editorView) {
            let frame: number | null = null;
            const recompute = () => {
              frame = null;
              const decoSet = computeSimplePageBreaks(editorView, cfgRef.current);
              editorView.dispatch(editorView.state.tr.setMeta(SIMPLE_PAGE_BREAK_KEY, decoSet));
            };
            const schedule = () => {
              if (frame !== null) cancelAnimationFrame(frame);
              frame = requestAnimationFrame(recompute);
            };
            const onLoad = (e: Event) => {
              if ((e.target as HTMLElement)?.tagName === "IMG") schedule();
            };
            editorView.dom.addEventListener("load", onLoad, true);
            window.addEventListener("resize", schedule);
            forceRecomputeRef.current = schedule;
            schedule();
            return {
              update(view, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                if (frame !== null) cancelAnimationFrame(frame);
                editorView.dom.removeEventListener("load", onLoad, true);
                window.removeEventListener("resize", schedule);
                if (forceRecomputeRef.current === schedule) forceRecomputeRef.current = null;
              },
            };
          },
        }),
      ];
    },
  });
}
type Props = {
  initialHtml: string;
  onChangeHtml: (html: string) => void;
  h1OffsetBefore?: number;
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;
  headerEvenLeft?: string;
  headerEvenCenter?: string;
  headerEvenRight?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
  enableHeader?: boolean;
  enableFooter?: boolean;
  headerHeightCm?: number;
  footerHeightCm?: number;
  headerFontSize?: number;
  footerFontSize?: number;
  headerBorder?: boolean;
  footerBorder?: boolean;
  skipFirstPage?: boolean;
  showPageNumbers?: boolean;
  onImageUpload?: (blob: Blob, filename: string) => Promise<string>;
  // Gdy podany, toolbar renderuje się przez portal w tym elemencie (lewy
  // sidebar w DocumentationModule.tsx) zamiast jako osobna kolumna obok
  // treści - żeby fizycznie siedział w tym samym miejscu co reszta
  // przycisków (Edytuj/Zapisz/Podgląd...).
  toolbarPortalEl?: HTMLDivElement | null;
  // Wywoływane za każdym przeliczeniem paginacji na żywo - żeby pasek
  // tytułowy w DocumentationModule.tsx mógł pokazać aktualną liczbę stron.
  onPageCountChange?: (count: number) => void;
};
export function DocumentationEditorTiptapPoC({
  initialHtml,
  onChangeHtml,
  h1OffsetBefore = 0,
  headerLeft = "",
  headerCenter = "",
  headerRight = "",
  headerEvenLeft = "",
  headerEvenCenter = "",
  headerEvenRight = "",
  footerLeft = "",
  footerCenter = "Strona {page}",
  footerRight = "",
  enableHeader = true,
  enableFooter = true,
  headerHeightCm = 3.75,
  footerHeightCm = 1.27,
  headerFontSize = 9,
  footerFontSize = 9,
  headerBorder = true,
  footerBorder = true,
  skipFirstPage = true,
  showPageNumbers = true,
  onImageUpload,
  toolbarPortalEl,
  onPageCountChange,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);
  const [commentPopup, setCommentPopup] = useState<{ id: string; draft: string; ax: number; ay: number } | null>(null);
  const [showPlainPasteModal, setShowPlainPasteModal] = useState(false);
  const [showTableSizeModal, setShowTableSizeModal] = useState(false);
  const [tableSizeInfo, setTableSizeInfo] = useState("");
  const [tableSizeCols, setTableSizeCols] = useState<string[]>([]);
  const [tableSizeH, setTableSizeH] = useState("");
  const [plainPasteText, setPlainPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  // Pozycja tabeli pod kursorem (do pływającego paska narzędzi) - patrz
  // komentarz przy findEnclosingTable wyżej. Aktualizowana z listenera
  // "transaction" edytora (niżej), nie z propsów/dekoracji.
  const [tableToolbarPos, setTableToolbarPos] = useState<number | null>(null);
  const [tableToolbarRect, setTableToolbarRect] = useState<{ top: number; left: number } | null>(null);
  const hfConfigRef = useRef<HfPagCfg>({
    headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
    footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
    headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage, showPageNumbers,
    onPageCountChange,
  });
  const forceRecomputeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    hfConfigRef.current = {
      headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
      footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
      headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage, showPageNumbers,
      onPageCountChange,
    };
    // Zmiana ustawien nagl/stopki (modal) NIE jest zmiana editor.state.doc,
    // wiec silnik paginacji sam by tego nie przeliczyl - wymuszamy recompute.
    forceRecomputeRef.current?.();
  }, [headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight, footerLeft, footerCenter, footerRight, enableHeader, enableFooter, headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage, showPageNumbers, onPageCountChange]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      NumberedHeading.configure({ levels: [1, 2, 3] }),
      AlignableTable,
      createTableWidthSyncExtension(),
      TableRow,
      TableHeader,
      TableCell,
      AlignableImage,
      ManualPageBreak,
      CommentMark,
      TextStyle,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      BlockIndent,
      HeadingNumbering.configure({ h1OffsetBefore }),
      createSimplePaginationExtension(hfConfigRef, forceRecomputeRef),
    ],
    content: initialHtml,
    // onCreate: ({ editor }) => settlePaginationAfterImagesLoad(editor), // wylaczone razem z PaginationPlus (2026-08-28)
    onUpdate: ({ editor }) => onChangeHtml(editor.getHTML()),
    editorProps: {
      // Po migracji na Tiptap ten id nigdzie nie był ustawiony, więc cały
      // wygląd tekstu (Calibri, rozmiary p/h1-h3, listy, tabele) z
      // docContentCss nie stosował się w ogóle w żywym edytorze - stąd
      // rozjazd wysokości akapitów względem podglądu/PDF, które go dostają.
      attributes: { id: "doc-editor-content" },
      handlePaste(_view, event) {
        const html = event.clipboardData?.getData("text/html");
        if (!html) return false;
        const sanitized = sanitizePastedHtml(html);
        editor?.chain().focus().insertContent(sanitized).run();
        event.preventDefault();
        return true;
      },
      handleClickOn(_view, _pos, _node, _nodePos, event) {
        const target = event.target as HTMLElement;
        const anchor = target.closest?.(".doc-comment-anchor") as HTMLElement | null;
        if (anchor) {
          const id = anchor.getAttribute("data-comment-id") || "";
          const text = anchor.getAttribute("data-comment-text") || "";
          const rect = anchor.getBoundingClientRect();
          setCommentPopup({ id, draft: text, ax: rect.right, ay: rect.top + rect.height / 2 });
          return true;
        }
        return false;
      },
    },
  });
  const insertBreak = useCallback(() => {
    editor?.chain().focus().insertManualPageBreak().run();
  }, [editor]);
  const openTableSizeModal = useCallback(() => {
    if (!editor) return;
    const hAttr = editor.getAttributes("tableRow").height;
    setTableSizeH(hAttr ? String(parseInt(hAttr, 10)) : "");
    let info = "Zaznacz komórkę w tabeli";
    try {
      const { $from } = editor.state.selection;
      let tableNode: any = null;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.spec.tableRole === "table") { tableNode = node; break; }
      }
      if (tableNode) {
        const map = TableMap.get(tableNode);
        const cols: string[] = new Array(map.width).fill("");
        for (let col = 0; col < map.width; col++) {
          for (let row = 0; row < map.height; row++) {
            const cellPos = map.map[row * map.width + col];
            const cell = tableNode.nodeAt(cellPos);
            const w = cell?.attrs?.colwidth?.[0];
            if (w) { cols[col] = String(w); break; }
          }
        }
        setTableSizeCols(cols);
        info = `Tabela: ${map.width} kolumn(y), ${map.height} wiersz(y)`;
      } else {
        setTableSizeCols([]);
      }
    } catch (e) {
      setTableSizeCols([]);
    }
    setTableSizeInfo(info);
    setShowTableSizeModal(true);
  }, [editor]);
  const applyTableSize = useCallback(() => {
    if (!editor) return;
    const { state, view } = editor;
    const { $from } = state.selection;
    let tableNode: any = null, tablePos = -1;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.spec.tableRole === "table") { tableNode = node; tablePos = $from.before(d); break; }
    }
    if (tableNode) {
      const map = TableMap.get(tableNode);
      let tr = state.tr;
      for (let col = 0; col < map.width; col++) {
        const w = parseInt(tableSizeCols[col] || "", 10);
        if (!(w > 0)) continue;
        const touched = new Set<number>();
        for (let row = 0; row < map.height; row++) {
          const relPos = map.map[row * map.width + col];
          if (touched.has(relPos)) continue;
          touched.add(relPos);
          const absPos = tablePos + 1 + relPos;
          const cell = tr.doc.nodeAt(absPos);
          if (cell) tr = tr.setNodeMarkup(absPos, undefined, { ...cell.attrs, colwidth: [w] });
        }
      }
      view.dispatch(tr);
    }
    const h = parseInt(tableSizeH, 10);
    if (h > 0) {
      editor.chain().focus().updateAttributes("tableRow", { height: `${h}px` }).run();
    }
    setShowTableSizeModal(false);
  }, [editor, tableSizeCols, tableSizeH]);
  const alignWholeTable = useCallback((align: "left" | "center" | "right" | "justify") => {
    if (!editor) return;
    const { state, view } = editor;
    const { $from } = state.selection;
    let tableStart = -1, tableEnd = -1;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.spec.tableRole === "table") {
        tableStart = $from.before(d);
        tableEnd = tableStart + node.nodeSize;
        break;
      }
    }
    if (tableStart === -1) return;
    let tr = state.tr;
    state.doc.nodesBetween(tableStart, tableEnd, (node: any, pos: number) => {
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: align });
      }
    });
    view.dispatch(tr);
    editor.commands.focus();
  }, [editor]);
  const [showIndentModal, setShowIndentModal] = useState(false);
  const [indentLeftCm, setIndentLeftCm] = useState("");
  const [indentRightCm, setIndentRightCm] = useState("");
  const openIndentModal = useCallback(() => {
    if (!editor) return;
    let sample: any = null;
    editor.state.doc.descendants((node: any) => {
      if (!sample && (node.type.name === "paragraph" || node.type.name === "heading")) sample = node;
      return !sample;
    });
    const l = sample?.attrs?.indentLeft ? parseFloat(sample.attrs.indentLeft) / (10 * MM_TO_PX) : 0;
    const r = sample?.attrs?.indentRight ? parseFloat(sample.attrs.indentRight) / (10 * MM_TO_PX) : 0;
    setIndentLeftCm(l ? l.toFixed(1) : "");
    setIndentRightCm(r ? r.toFixed(1) : "");
    setShowIndentModal(true);
  }, [editor]);
  const applyDocumentIndent = useCallback(() => {
    if (!editor) return;
    const leftCm = parseFloat(indentLeftCm) || 0;
    const rightCm = parseFloat(indentRightCm) || 0;
    const leftPx = leftCm > 0 ? `${cmToPx(leftCm)}px` : null;
    const rightPx = rightCm > 0 ? `${cmToPx(rightCm)}px` : null;
    const { state, view } = editor;
    let tr = state.tr;
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === "paragraph" || node.type.name === "heading" || node.type.name === "table" || node.type.name === "image") {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: leftPx, indentRight: rightPx });
      }
    });
    view.dispatch(tr);
    editor.commands.focus();
    setShowIndentModal(false);
  }, [editor, indentLeftCm, indentRightCm]);
  const selectWholeTable = useCallback(() => {
    if (!editor) return;
    const { state, view } = editor;
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.spec.tableRole === "table") {
        const tablePos = $from.before(d);
        const map = TableMap.get(node);
        const start = tablePos + 1 + map.map[0];
        const end = tablePos + 1 + map.map[map.map.length - 1];
        const selection = CellSelection.create(state.doc, start, end);
        view.dispatch(state.tr.setSelection(selection));
        editor.commands.focus();
        return;
      }
    }
  }, [editor]);

  const setTablePosition = useCallback((align: "left" | "center" | "right") => {
    if (!editor) return;
    editor.chain().focus().updateAttributes("table", { align }).run();
  }, [editor]);
  const removeTable = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().deleteTable().run();
  }, [editor]);
  // Pozycja/prostokąt tabeli pod kursorem, do pływającego paska - patrz
  // duży komentarz przy findEnclosingTable. Aktualizowane na każdej
  // transakcji edytora (docChanged LUB selectionChanged - w przeciwieństwie
  // do SimplePagination, tu MUSIMY reagować na samo przesunięcie kursora,
  // nie tylko na zmianę treści), plus przy scrollu/resize kontenera.
  const updateTableToolbarPosition = useCallback(() => {
    if (!editor) { setTableToolbarPos(null); return; }
    const found = findEnclosingTable(editor.state);
    if (!found) { setTableToolbarPos(null); setTableToolbarRect(null); return; }
    setTableToolbarPos(found.pos);
    const dom = editor.view.nodeDOM(found.pos) as HTMLElement | null;
    const tableEl = dom ? (dom.tagName === "TABLE" ? dom : dom.querySelector("table")) : null;
    if (tableEl) {
      const r = tableEl.getBoundingClientRect();
      setTableToolbarRect({ top: r.top, left: r.left });
    }
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", updateTableToolbarPosition);
    updateTableToolbarPosition();
    return () => { editor.off("transaction", updateTableToolbarPosition); };
  }, [editor, updateTableToolbarPosition]);
  useEffect(() => {
    const scrollEl = editor?.view.dom.closest(".dt-page-scroll") as HTMLElement | null;
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", updateTableToolbarPosition, { passive: true });
    window.addEventListener("resize", updateTableToolbarPosition);
    return () => {
      scrollEl.removeEventListener("scroll", updateTableToolbarPosition);
      window.removeEventListener("resize", updateTableToolbarPosition);
    };
  }, [editor, updateTableToolbarPosition]);

  const addComment = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      alert("Zaznacz fragment tekstu, aby dodać komentarz.");
      return;
    }
    const id = `c${Date.now()}`;
    editor.chain().focus().setComment(id).run();
    requestAnimationFrame(() => {
      const span = editor.view.dom.querySelector(`[data-comment-id="${id}"]`) as HTMLElement | null;
      const rect = span?.getBoundingClientRect();
      setCommentPopup({
        id,
        draft: "",
        ax: rect?.right ?? window.innerWidth / 2,
        ay: rect ? rect.top + rect.height / 2 : 100,
      });
    });
  }, [editor]);

  const saveCommentDraft = useCallback(() => {
    if (!editor || !commentPopup) return;
    const html = editor.getHTML().replace(
      new RegExp(`(data-comment-id="${commentPopup.id}"[^>]*data-comment-text=")[^"]*(")`),
      `$1${commentPopup.draft.replace(/"/g, "&quot;")}$2`
    );
    editor.commands.setContent(html, { emitUpdate: true });
    setCommentPopup(null);
  }, [editor, commentPopup]);

  const removeComment = useCallback(() => {
    if (!editor || !commentPopup) return;
    // Zaznacz fragment z tym commentId i zdejmij mark — najprościej przez
    // usunięcie znacznika w HTML (span pozostaje jako zwykły tekst).
    const html = editor.getHTML().replace(
      new RegExp(`<span[^>]*data-comment-id="${commentPopup.id}"[^>]*>(.*?)</span>`, "s"),
      "$1"
    );
    editor.commands.setContent(html, { emitUpdate: true });
    setCommentPopup(null);
  }, [editor, commentPopup]);

  const applySectionStyle = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().setNode("heading", { level: 4 } as any).run();
    // Wymuszony inline style na h4 (Tiptap nie ma per-node inline style API
    // wprost) — najprościej przez bezpośrednią manipulację DOM zaraz po
    // wstawieniu (ten sam wzorzec co execCommand("formatBlock") w oryginale).
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const el = (node instanceof Element ? node : node?.parentElement)?.closest("h4") as HTMLElement | null;
      if (el) el.setAttribute("style", SECTION_STYLE);
    });
  }, [editor]);

  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const insertPlainPasteText = useCallback(() => {
    if (!editor) return;
    const lines = plainPasteText.split(/\r\n|\r|\n/);
    const html = lines.map((l) => `<p>${l.trim() ? escapeHtml(l) : "<br>"}</p>`).join("");
    editor.chain().focus().insertContent(html).run();
    setShowPlainPasteModal(false);
    setPlainPasteText("");
  }, [editor, plainPasteText]);

  const pickImage = () => fileInputRef.current?.click();
  const pickDocx = () => docxInputRef.current?.click();

  // Osobna, szersza (w-52) kolumna toolbara obok edytora - przyciski mają
  // ikonę + czytelną etykietę obok siebie, ułożone poziomo (flex-wrap),
  // zamiast gołych, ściśniętych ikon.
  const GroupBtn = ({ icon, label, onClick, onMouseDown, active, disabled, danger }: {
    icon: React.ReactNode; label: string; onClick?: () => void; onMouseDown?: (e: React.MouseEvent) => void;
    active?: boolean; disabled?: boolean; danger?: boolean;
  }) => (
    <button
      type="button"
      title={label}
      onMouseDown={onMouseDown ?? ((e) => e.preventDefault())}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs whitespace-nowrap disabled:opacity-40 transition-all duration-100 active:scale-95 ${
        active
          ? "bg-[var(--accent)] text-white"
          : danger
          ? "text-[var(--text-secondary)] hover:bg-red-50 hover:text-red-600"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
      }`}
    >
      <span className="text-sm leading-none w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
  const GroupSelect = ({ icon, label, children, onChange }: { icon: React.ReactNode; label: string; children: React.ReactNode; onChange: (v: string) => void }) => (
    <label className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] cursor-pointer relative w-full">
      <span className="text-sm leading-none w-4 text-center">{icon}</span>
      <span>{label}</span>
      <select
        defaultValue=""
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => { const v = e.target.value; e.target.value = ""; onChange(v); }}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}
      >
        {children}
      </select>
    </label>
  );

  // Grupy toolbara są domyślnie zwinięte i rozwijają się poziomo (flex-wrap)
  // w osobnej kolumnie obok edytora - klik na nagłówek grupy przełącza
  // widoczność.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => setOpenGroups((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const Group = ({ id, icon, label, children }: { id: string; icon: string; label: string; children: React.ReactNode }) => {
    const open = openGroups.has(id);
    return (
      <div className="dt-group">
        <button type="button" className="dt-group-header" onClick={() => toggleGroup(id)}>
          <span className="dt-group-icon">{icon}</span>
          <span className="dt-group-label">{label}</span>
          <span className="dt-group-chevron">{open ? "▾" : "▸"}</span>
        </button>
        {open && <div className="dt-group-body">{children}</div>}
      </div>
    );
  };

  if (!editor) return null;

  const onFileChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      alert("Tylko pliki JPG/PNG.");
      return;
    }
    const savedPos = editor.state.selection.to;
    setUploading(true);
    try {
      const { blob, width, height } = await downscaleImage(file);
      const scale = Math.min(1, 602 / width, 800 / height);
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const url = onImageUpload
        ? await onImageUpload(blob, file.name)
        : await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
          });
      editor.chain().focus().insertContentAt(savedPos, { type: "image", attrs: { src: url, width: `${w}px`, height: `${h}px` } }).run();
      settlePaginationAfterImagesLoad(editor);
    } finally {
      setUploading(false);
    }
  }, [editor, onImageUpload]);

  const onDocxChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    if (!/\.docx$/i.test(file.name)) {
      alert("Tylko pliki .docx.");
      return;
    }
    setImportingDocx(true);
    try {
      const buf = await file.arrayBuffer();
      const html = await convertDocxToHtml(buf);
      const sanitized = sanitizePastedHtml(html);
      editor.chain().focus().insertContent(sanitized).run();
    } finally {
      setImportingDocx(false);
    }
  }, [editor]);

  if (!editor) return null;
  return (
    <div
      className="doc-editor-tiptap-poc"
      style={{ position: "relative", display: "flex", flexDirection: "row", height: "100%" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        const file = e.dataTransfer.files?.[0];
        if (!file || !/^image\/(jpeg|png)$/.test(file.type) || !editor) return;
        e.preventDefault();
        setUploading(true);
        try {
          const { blob, width, height } = await downscaleImage(file);
          const scale = Math.min(1, 602 / width, 800 / height);
          const w = Math.round(width * scale);
          const h = Math.round(height * scale);
          const url = onImageUpload
            ? await onImageUpload(blob, file.name)
            : await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.readAsDataURL(blob);
              });
          editor.chain().focus().insertContent({ type: "image", attrs: { src: url, width: `${w}px`, height: `${h}px` } }).run();
          settlePaginationAfterImagesLoad(editor);
        } finally {
          setUploading(false);
        }
      }}
    >
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" style={{ display: "none" }} onChange={onFileChosen} />
      <input ref={docxInputRef} type="file" accept=".docx" style={{ display: "none" }} onChange={onDocxChosen} />
      {(() => {
        const toolbar = (
          <div className="dt-toolbar">
            <Group id="format" icon="Aa" label="Format">
              <GroupBtn icon={<b>B</b>} label="Pogrubienie" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
              <GroupBtn icon={<i>I</i>} label="Kursywa" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
              <GroupBtn icon="•" label="Lista" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
              <GroupSelect
                icon="H"
                label="Styl"
                onChange={(v) => {
                  if (v === "section") applySectionStyle();
                  else if (v === "p") editor.chain().focus().setParagraph().run();
                  else if (v === "h1" || v === "h2" || v === "h3") editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
                }}
              >
                <option value="" disabled>Styl</option>
                <option value="p">Normal</option>
                <option value="section">Sekcja (bez numeracji)</option>
                <option value="h1">Heading 1 — Rozdział</option>
                <option value="h2">Heading 2 — Podrozdział</option>
                <option value="h3">Heading 3 — Punkt</option>
              </GroupSelect>
              <GroupSelect icon="🔠" label="Rozmiar" onChange={(v) => { if (v) editor.chain().focus().setFontSize(v).run(); }}>
                <option value="" disabled>Rozmiar</option>
                <option value="10px">Bardzo mała</option>
                <option value="13px">Mała</option>
                <option value="16px">Normalna</option>
                <option value="18px">Duża</option>
                <option value="24px">Większa</option>
              </GroupSelect>
            </Group>
            <Group id="align" icon="☰" label="Wyrównanie">
              <GroupBtn icon="⬅" label="Lewo" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
              <GroupBtn icon="↔" label="Środek" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
              <GroupBtn icon="➡" label="Prawo" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
              <GroupBtn icon="☰" label="Justuj" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} />
              <GroupBtn icon="📑" label="Wcięcie całego dokumentu" onClick={openIndentModal} />
            </Group>
            <Group id="insert" icon="➕" label="Wstaw">
              <GroupBtn icon="🧹" label="Wklej tekst" onClick={() => setShowPlainPasteModal(true)} />
              <GroupBtn
                icon="🔲"
                label="Tabela"
                active={editor.isActive("table")}
                onClick={() => {
                  if (editor.isActive("table")) {
                    alert("Kursor jest już wewnątrz tabeli — zagnieżdżanie tabel nie jest obsługiwane.");
                    return;
                  }
                  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                }}
              />
              <GroupBtn icon="⏎" label="Podział strony" onClick={insertBreak} />
              <GroupBtn icon="🖼" label={uploading ? "Wysyłanie…" : "Obraz"} disabled={uploading} onClick={pickImage} />
              <GroupBtn icon="📄" label={importingDocx ? "Import…" : "Import z Worda"} disabled={importingDocx} onClick={pickDocx} />
              <GroupBtn icon="💬" label="Komentarz" onClick={addComment} />
            </Group>
            {editor.isActive("table") && (
              <Group id="table" icon="🔲" label="Tabela">
                <GroupBtn icon="➕⏵" label="Dodaj wiersz" onClick={() => editor.chain().focus().addRowAfter().run()} />
                <GroupBtn icon="➖⏵" label="Usuń wiersz" onClick={() => editor.chain().focus().deleteRow().run()} />
                <GroupBtn icon="➕⏷" label="Dodaj kolumnę" onClick={() => editor.chain().focus().addColumnAfter().run()} />
                <GroupBtn icon="➖⏷" label="Usuń kolumnę" onClick={() => editor.chain().focus().deleteColumn().run()} />
                <GroupBtn icon="⬅" label="Tekst w tabeli: lewo" onClick={() => alignWholeTable("left")} />
                <GroupBtn icon="↔" label="Tekst w tabeli: środek" onClick={() => alignWholeTable("center")} />
                <GroupBtn icon="➡" label="Tekst w tabeli: prawo" onClick={() => alignWholeTable("right")} />
                <GroupBtn icon="☰" label="Tekst w tabeli: justuj" onClick={() => alignWholeTable("justify")} />
              </Group>
            )}
          </div>
        );
        return toolbarPortalEl ? createPortal(toolbar, toolbarPortalEl) : toolbar;
      })()}
      <div className="dt-page-scroll" style={{ background: "#888", padding: "24px 0", display: "flex", justifyContent: "center" }}>
        <style>{`
.dt-toolbar { display: flex; flex-direction: column; align-items: stretch; gap: 2px; width: 100%; ${toolbarPortalEl ? "" : "padding: 8px 4px; position: sticky; top: 0; left: 0; z-index: 60; width: 72px; flex-shrink: 0; height: 100%; overflow-y: auto; background: var(--bg-card, #fff); border-right: 1px solid var(--border-color, #ddd);"} }
.dt-group { border-bottom: 1px solid var(--border-color, #eee); padding-bottom: 2px; margin-bottom: 2px; }
.dt-group:last-child { border-bottom: none; }
.dt-group-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 6px; border-radius: 6px; background: none; border: none; cursor: pointer; color: var(--text-secondary, #555); transition: background 0.1s; }
.dt-group-header:hover { background: var(--bg-hover, #f2f2f2); color: var(--accent, #6d5cfc); }
.dt-group-icon { font-size: 15px; width: 18px; text-align: center; }
.dt-group-label { flex: 1; text-align: left; font-size: 12px; font-weight: 600; }
.dt-group-chevron { font-size: 10px; opacity: 0.6; }
.dt-group-body { display: flex; flex-wrap: wrap; gap: 3px; padding: 2px 2px 8px 6px; justify-content: flex-start; }
.dt-toolbar-sep { width: 40px; height: 1px; background: var(--border-color, #ddd); margin: 4px 0; }
.dt-btn { border: 1px solid var(--border-color, #ddd); background: var(--bg-card, #fff); color: var(--text-primary, #222); border-radius: 6px; padding: 5px 9px; font-size: 13px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.dt-btn:hover { background: var(--accent-light, #efedff); border-color: var(--accent, #6d5cfc); }
.dt-page-scroll { flex: 1; overflow-y: auto; min-width: 0; }
.doc-editor-tiptap-poc .ProseMirror {
  position: relative;
  width: 794px;
  min-height: 1123px;
  padding: 0 48px !important;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(0,0,0,0.35);
  margin: 0 auto;
}
.doc-editor-tiptap-poc .simple-page-header,
.doc-editor-tiptap-poc .simple-page-footer { display: flex; align-items: center; justify-content: space-between; color: #555; box-sizing: border-box; position: relative; }
.doc-editor-tiptap-poc .simple-page-header > span,
.doc-editor-tiptap-poc .simple-page-footer > span { flex: 1; }
.doc-editor-tiptap-poc .simple-page-header > span:nth-child(2),
.doc-editor-tiptap-poc .simple-page-footer > span:nth-child(2) { text-align: center; }
.doc-editor-tiptap-poc .simple-page-header > span:nth-child(3),
.doc-editor-tiptap-poc .simple-page-footer > span:nth-child(3) { text-align: right; }
.doc-editor-tiptap-poc .simple-page-gap { height: 16px; background: #888; margin: 0 -48px; position: relative; }
.doc-editor-tiptap-poc .simple-page-gap-label { position: absolute; top: 1px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #fff; font-family: monospace; white-space: nowrap; }
.doc-editor-tiptap-poc .simple-page-number-badge { position: absolute; bottom: 2px; right: 0; font-size: 9px; color: #999; }
.doc-editor-tiptap-poc .ProseMirror, .doc-editor-tiptap-poc .rm-page-content { background: #fff !important; color: #000 !important; }
.doc-editor-tiptap-poc h1[data-num]::before,
.doc-editor-tiptap-poc h2[data-num]::before,
.doc-editor-tiptap-poc h3[data-num]::before { content: attr(data-num) ". "; }
.doc-editor-tiptap-poc .manual-page-break { position: relative; height: 0; border-top: 2px dashed #7b7bd6; margin: 24px 0; }
.doc-editor-tiptap-poc .manual-page-break::after { content: attr(data-label); position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 8px; font-size: 11px; color: #7b7bd6; white-space: nowrap; }
.doc-editor-tiptap-poc .doc-comment-anchor { background: #fff3b0; border-bottom: 2px solid #e6b800; cursor: pointer; }
.doc-editor-tiptap-poc .ProseMirror img { max-width: 100%; max-height: 850px; height: auto; }
.doc-editor-tiptap-poc .ProseMirror table { border-collapse: collapse; table-layout: fixed; margin: 8px 0; }
.doc-editor-tiptap-poc .ProseMirror table td, .doc-editor-tiptap-poc .ProseMirror table th { border: 1px solid #999; min-width: 60px; padding: 4px 8px; position: relative; }
.doc-editor-tiptap-poc .ProseMirror .selectedCell:after { z-index: 2; position: absolute; content: ""; left: 0; right: 0; top: 0; bottom: 0; background: rgba(79, 195, 247, 0.35); pointer-events: none; }
.table-inline-toolbar { display: flex; gap: 4px; padding: 4px 6px; background: #fff; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); width: max-content; }
.table-inline-toolbar button { border: 1px solid #ddd; background: #fff; border-radius: 4px; padding: 2px 7px; cursor: pointer; font-size: 13px; line-height: 1.6; }
.table-inline-toolbar button:hover { background: #efedff; border-color: #6d5cfc; }
.doc-editor-tiptap-poc .ProseMirror table th { background: #eee; font-weight: bold; }
.doc-editor-tiptap-poc .page { box-shadow: 0 2px 10px rgba(0,0,0,0.35); }
.doc-editor-tiptap-poc .simple-page-break-line { position: absolute; left: -96px; right: -96px; height: 5px; background: #888; transform: translateY(-5px); pointer-events: none; z-index: 1; }
.doc-editor-tiptap-poc .simple-page-break-line::after { content: "Strona " attr(data-page-num); position: absolute; right: 0; top: 4px; font-size: 10px; color: #999; background: #fff; padding: 0 4px; }
.doc-editor-tiptap-poc .tableWrapper { overflow-x: auto; }
.doc-editor-tiptap-poc .column-resize-handle { position: absolute; right: -3px; top: 0; bottom: -2px; width: 6px; background-color: #4fc3f7; cursor: col-resize; z-index: 10; }
.doc-editor-tiptap-poc .ProseMirror table.resize-cursor { cursor: col-resize; }
${docContentCss("#doc-editor-content")}
        `}</style>
        <EditorContent editor={editor} />
      </div>
      {showPlainPasteModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowPlainPasteModal(false)}>
          <div style={{ background: "#fff", color: "#000", borderRadius: 8, padding: 16, width: "90%", maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>🧹 Wklej jako zwykły tekst</h3>
            <textarea
              autoFocus
              value={plainPasteText}
              onChange={(e) => setPlainPasteText(e.target.value)}
              rows={16}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
              placeholder="Wklej tutaj (Ctrl+V)…"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setShowPlainPasteModal(false)}>Anuluj</button>
              <button type="button" onClick={insertPlainPasteText} disabled={!plainPasteText.trim()}>Wstaw jako Normal</button>
            </div>
          </div>
        </div>
      )}
      {showTableSizeModal && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000 }} onClick={() => setShowTableSizeModal(false)}>
          <div style={{ background: "#fff", borderRadius: 6, padding: 16, minWidth: 280, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 600, marginBottom: 4 }}>📐 Rozmiar tabeli</h3>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>{tableSizeInfo}</div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Szerokość kolumn (px)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {tableSizeCols.map((v, i) => (
                <label key={i} style={{ fontSize: 11, color: "#666" }}>
                  K{i + 1}
                  <input
                    type="number"
                    value={v}
                    onChange={(e) => setTableSizeCols((cols) => cols.map((c, ci) => (ci === i ? e.target.value : c)))}
                    style={{ width: 64, display: "block" }}
                    placeholder="auto"
                  />
                </label>
              ))}
            </div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Wysokość bieżącego wiersza (px)</label>
            <input type="number" value={tableSizeH} onChange={(e) => setTableSizeH(e.target.value)} style={{ width: "100%", marginBottom: 12 }} placeholder="np. 40" />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="dt-btn" onClick={() => setShowTableSizeModal(false)}>Anuluj</button>
              <button type="button" className="dt-btn" onClick={applyTableSize}>Zastosuj</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {tableToolbarPos !== null && tableToolbarRect && createPortal(
        <div
          contentEditable={false}
          style={{ position: "fixed", top: Math.max(4, tableToolbarRect.top - 36), left: tableToolbarRect.left, zIndex: 500 }}
          className="table-inline-toolbar"
        >
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTablePosition("left")} title="Tabela do lewej">⬅</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTablePosition("center")} title="Tabela wyśrodkowana">↔</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setTablePosition("right")} title="Tabela do prawej">➡</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={selectWholeTable} title="Zaznacz całą tabelę">⬚</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={openTableSizeModal} title="Rozmiar tabeli">📐</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={removeTable} title="Usuń tabelę">🗑</button>
        </div>,
        document.body
      )}
      {showIndentModal && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000 }} onClick={() => setShowIndentModal(false)}>
          <div style={{ background: "#fff", borderRadius: 6, padding: 16, minWidth: 260 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 600, marginBottom: 10 }}>📑 Wcięcie całego dokumentu</h3>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Wcięcie z lewej (cm)</label>
            <input type="number" step="0.1" value={indentLeftCm} onChange={(e) => setIndentLeftCm(e.target.value)} style={{ width: "100%", marginBottom: 8 }} placeholder="0" />
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Wcięcie z prawej (cm)</label>
            <input type="number" step="0.1" value={indentRightCm} onChange={(e) => setIndentRightCm(e.target.value)} style={{ width: "100%", marginBottom: 12 }} placeholder="0" />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="dt-btn" onClick={() => setShowIndentModal(false)}>Anuluj</button>
              <button type="button" className="dt-btn" onClick={applyDocumentIndent}>Zastosuj</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {commentPopup && createPortal((() => {
        // Dymek ma stać W MARGINESIE obok strony, nie tuż przy zaznaczeniu -
        // inaczej zasłania sąsiedni tekst (zgłoszone). Pozycja pozioma jest
        // więc pinowana do prawej krawędzi realnego obszaru edycji
        // (editor.view.dom), pionowa nadal śledzi zaznaczenie (ay) tak, żeby
        // linia łącząca wskazywała właściwy fragment.
        const pmRect = editor?.view.dom.getBoundingClientRect();
        const marginLeft = pmRect ? pmRect.right + 20 : commentPopup.ax + 16;
        const popupLeft = Math.min(marginLeft, window.innerWidth - 280);
        const popupTop = Math.max(8, commentPopup.ay - 20);
        return (
          <>
            <svg style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 999 }}>
              <line x1={commentPopup.ax} y1={commentPopup.ay} x2={popupLeft} y2={popupTop + 16} stroke="#e6b800" strokeWidth={2} />
              <circle cx={commentPopup.ax} cy={commentPopup.ay} r={4} fill="#e6b800" />
            </svg>
            <div style={{ position: "fixed", left: popupLeft, top: popupTop, width: 260, background: "#fff8e1", border: "1px solid #e6b800", borderRadius: 4, padding: 8, zIndex: 1000, boxShadow: "0 2px 10px rgba(0,0,0,0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#8a6d00" }}>💬 Komentarz</span>
                <button type="button" onClick={() => setCommentPopup(null)} style={{ fontSize: 11, color: "#8a6d00" }}>✕</button>
              </div>
              <textarea
                value={commentPopup.draft}
                onChange={(e) => setCommentPopup((p) => (p ? { ...p, draft: e.target.value } : p))}
                style={{ width: "100%", minHeight: 60, fontSize: 12 }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button type="button" onClick={saveCommentDraft} style={{ fontSize: 11 }}>Zapisz</button>
                <button type="button" onClick={removeComment} style={{ fontSize: 11 }}>Usuń komentarz</button>
              </div>
            </div>
          </>
        );
      })(), document.body)}
    </div>
  );
}
