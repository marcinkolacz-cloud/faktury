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
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TableMap } from "@tiptap/pm/tables";
import { convertDocxToHtml } from "../lib/docxImport";

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
const EXCLUDED_TITLES = ["spis treści", "table of contents"];

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
    const text = (node.textContent || "").trim().toLowerCase();
    if (EXCLUDED_TITLES.includes(text)) return;
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

export function numberHeadingsForExport(html: string, h1OffsetBefore = 0): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  const counters = [h1OffsetBefore, 0, 0];
  div.querySelectorAll("h1,h2,h3").forEach((el) => {
    const level = Number(el.tagName.substring(1));
    const text = (el.textContent || "").trim().toLowerCase();
    if (EXCLUDED_TITLES.includes(text)) return;
    counters[level - 1] += 1;
    for (let i = level; i < 3; i++) counters[i] = 0;
    const num = counters.slice(0, level).join(".");
    el.textContent = `${num}. ${el.textContent}`;
  });
  return div.innerHTML;
}

// --- Wklejanie / import z Worda (§8 inventory) ---
function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const isWhiteish = (val: string) => {
    const v = val.trim().toLowerCase();
    if (!v) return false;
    if (v === "white" || v === "#fff" || v === "#ffffff") return true;
    const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return +m[1] >= 245 && +m[2] >= 245 && +m[3] >= 245;
    return false;
  };
  doc.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.style && el.style.backgroundColor && isWhiteish(el.style.backgroundColor)) {
      el.style.removeProperty("background-color");
      el.style.removeProperty("background");
    }
    if (el.hasAttribute("bgcolor") && isWhiteish(el.getAttribute("bgcolor") || "")) {
      el.removeAttribute("bgcolor");
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
  const style: React.CSSProperties =
    align === "center"
      ? { float: "none", display: "block", marginLeft: "auto", marginRight: "auto" }
      : align === "right"
      ? { float: "right", margin: "0 0 8px 8px" }
      : { float: "left", margin: "0 8px 8px 0" };
  if (node.attrs.width) style.width = node.attrs.width;
  const heightPx = node.attrs.height ? parseFloat(node.attrs.height) : NaN;
  if (!isNaN(heightPx) && heightPx > 0 && heightPx <= 3000) style.height = node.attrs.height;

  return (
    <NodeViewWrapper as="span" style={{ position: "relative", display: "inline-block" }}>
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
    </NodeViewWrapper>
  );
}

const AlignableImage = ImageExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, renderHTML: (a: any) => (a.width ? { style: `width:${a.width}` } : {}) },
      height: { default: null, renderHTML: (a: any) => (a.height ? { style: `height:${a.height}` } : {}) },
      align: { default: "left", renderHTML: (a: any) => ({ "data-align": a.align }) },
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
          if (a.align === "center") return { style: "margin-left:auto;margin-right:auto;" };
          if (a.align === "right") return { style: "margin-left:auto;margin-right:0;" };
          return { style: "margin-left:0;margin-right:auto;" };
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
    };
  },
}).configure({ resizable: true });

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
};

function cmToPx(cm: number) { return Math.round(cm * 10 * MM_TO_PX); }
function nl2brSimple(t: string) { return (t || "").replace(/\n/g, "<br/>"); }

function buildHeaderEl(cfg: HfPagCfg, pageNum: number) {
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
  if (cfg.headerBorder) el.style.borderBottom = "1px solid #ccc";
  el.innerHTML = `<span>${nl2brSimple(left)}</span><span>${nl2brSimple(center)}</span><span>${nl2brSimple(right)}</span>`;
  return el;
}

function buildFooterEl(cfg: HfPagCfg) {
  const el = document.createElement("div");
  el.className = "simple-page-footer";
  el.contentEditable = "false";
  el.style.height = `${cmToPx(cfg.footerHeightCm)}px`;
  el.style.fontSize = `${cfg.footerFontSize}pt`;
  el.style.margin = `0 -${SIDE_MARGIN_PX}px`;
  el.style.padding = `6px ${SIDE_MARGIN_PX}px 0`;
  if (cfg.footerBorder) el.style.borderTop = "1px solid #ccc";
  el.innerHTML = `<span>${nl2brSimple(cfg.footerLeft)}</span><span>${nl2brSimple(cfg.footerCenter)}</span><span>${nl2brSimple(cfg.footerRight)}</span>`;
  return el;
}

function buildGapEl() {
  const el = document.createElement("div");
  el.className = "simple-page-gap";
  el.contentEditable = "false";
  return el;
}

function buildPageBoundaryWidget(cfg: HfPagCfg, endingPageNum: number, startingPageNum: number) {
  return () => {
    const wrap = document.createElement("div");
    wrap.contentEditable = "false";
    if (cfg.enableFooter && !(cfg.skipFirstPage && endingPageNum === 1)) wrap.appendChild(buildFooterEl(cfg));
    wrap.appendChild(buildGapEl());
    if (cfg.enableHeader && !(cfg.skipFirstPage && startingPageNum === 1)) wrap.appendChild(buildHeaderEl(cfg, startingPageNum));
    return wrap;
  };
}

function computeSimplePageBreaks(view: any, cfg: HfPagCfg) {
  const dom = view.dom as HTMLElement;
  const proseRect = dom.getBoundingClientRect();
  if (proseRect.height === 0) return DecorationSet.empty;
  const headerHPx = cmToPx(cfg.headerHeightCm);
  const footerHPx = cmToPx(cfg.footerHeightCm);
  const contentH = PAGE_H_PX - headerHPx - footerHPx;
  const decos: Decoration[] = [];
  let pageStartTop: number | null = null;
  let pageNum = 1;
  view.state.doc.forEach((_node: any, offset: number) => {
    const domNode = view.nodeDOM(offset);
    if (!(domNode instanceof HTMLElement)) return;
    if (domNode.classList.contains(PAGE_BREAK_CLASS)) {
      const endingPage = pageNum;
      pageNum += 1;
      decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, pageNum), { side: -1, key: `spb-manual-${offset}` }));
      pageStartTop = null;
      return;
    }
    const rect = domNode.getBoundingClientRect();
    const relTop = rect.top - proseRect.top;
    const relBottom = rect.bottom - proseRect.top;
    if (pageStartTop === null) {
      pageStartTop = relTop;
    } else if (relBottom - pageStartTop > contentH) {
      const endingPage = pageNum;
      pageNum += 1;
      decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, pageNum), { side: -1, key: `spb-${offset}` }));
      pageStartTop = relTop;
    }
  });
  if (cfg.enableHeader && !cfg.skipFirstPage) {
    decos.push(Decoration.widget(0, () => buildHeaderEl(cfg, 1), { side: -1, key: "spb-header-first" }));
  }
  if (cfg.enableFooter && !(pageNum === 1 && cfg.skipFirstPage)) {
    const endPos = view.state.doc.content.size;
    decos.push(Decoration.widget(endPos, () => buildFooterEl(cfg), { side: 1, key: "spb-footer-last" }));
  }
  return DecorationSet.create(view.state.doc, decos);
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
  onImageUpload?: (blob: Blob, filename: string) => Promise<string>;
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
  onImageUpload,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);
  const [commentPopup, setCommentPopup] = useState<{ id: string; draft: string; ax: number; ay: number } | null>(null);
  const [showPlainPasteModal, setShowPlainPasteModal] = useState(false);
  const [showTableSizeModal, setShowTableSizeModal] = useState(false);
  const [tableSizeInfo, setTableSizeInfo] = useState("");
  const [debugInfo, setDebugInfo] = useState("");
  const [tableSizeW, setTableSizeW] = useState("");
  const [tableSizeH, setTableSizeH] = useState("");
  const [plainPasteText, setPlainPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const hfConfigRef = useRef<HfPagCfg>({
    headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
    footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
    headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
  });
  const forceRecomputeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    hfConfigRef.current = {
      headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
      footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
      headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
    };
    // Zmiana ustawien nagl/stopki (modal) NIE jest zmiana editor.state.doc,
    // wiec silnik paginacji sam by tego nie przeliczyl - wymuszamy recompute.
    forceRecomputeRef.current?.();
  }, [headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight, footerLeft, footerCenter, footerRight, enableHeader, enableFooter, headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      NumberedHeading.configure({ levels: [1, 2, 3] }),
      AlignableTable,
      TableRow,
      TableHeader,
      TableCell,
      AlignableImage,
      ManualPageBreak,
      CommentMark,
      TextStyle,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      HeadingNumbering.configure({ h1OffsetBefore }),
      createSimplePaginationExtension(hfConfigRef, forceRecomputeRef),
    ],
    content: initialHtml,
    // onCreate: ({ editor }) => settlePaginationAfterImagesLoad(editor), // wylaczone razem z PaginationPlus (2026-08-28)
    onUpdate: ({ editor }) => onChangeHtml(editor.getHTML()),
    editorProps: {
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
  useEffect(() => {
    if (!editor) return;
    const iv = setInterval(() => {
      const dom = editor.view.dom as HTMLElement;
      const pag = dom.querySelector('[data-rm-pagination]');
      const pages = pag ? pag.children.length : 0;
      const imgs = Array.from(dom.querySelectorAll('img'));
      const incomplete = imgs.filter((i: any) => !i.complete).length;
      const kids = Array.from(dom.children) as HTMLElement[];
      const kidsDesc = kids.map((k) => `${k.tagName}.${k.className || "(brak)"} h=${Math.round(k.getBoundingClientRect().height)}px`).join(" || ");
      const docSize = editor.state.doc.content.size;
      const htmlLen = editor.getHTML().length;
      setDebugInfo(`scrollHeight=${dom.scrollHeight}px pages=${pages} docSize=${docSize} htmlLen=${htmlLen} niezaladowane=${incomplete} childrenTotal=${kids.length} pierwsze4=[${kidsDesc}]`);
    }, 500);
    return () => clearInterval(iv);
  }, [editor]);
  const openTableSizeModal = useCallback(() => {
    if (!editor) return;
    const wAttr = editor.getAttributes("tableCell").colwidth || editor.getAttributes("tableHeader").colwidth;
    const hAttr = editor.getAttributes("tableRow").height;
    setTableSizeW(wAttr && wAttr[0] ? String(wAttr[0]) : "");
    setTableSizeH(hAttr ? String(parseInt(hAttr, 10)) : "");
    let info = "Zaznacz komórkę w tabeli";
    try {
      const { $from } = editor.state.selection;
      let tableNode = null, tablePos = -1, cellNode = null, cellPos = -1;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        const role = node.type.spec.tableRole;
        if (!cellNode && (role === "cell" || role === "header_cell")) { cellNode = node; cellPos = $from.before(d); }
        if (role === "table") { tableNode = node; tablePos = $from.before(d); break; }
      }
      if (tableNode && cellNode) {
        const map = TableMap.get(tableNode);
        const rect = map.findCell(cellPos - tablePos - 1);
        info = `Tabela: kolumna ${rect.left + 1}/${map.width}, wiersz ${rect.top + 1}/${map.height}`;
      }
    } catch (e) {
      // best-effort info only
    }
    setTableSizeInfo(info);
    setShowTableSizeModal(true);
  }, [editor]);
  const applyTableSize = useCallback(() => {
    if (!editor) return;
    const w = parseInt(tableSizeW, 10);
    const h = parseInt(tableSizeH, 10);
    if (w > 0) {
      const isHeader = editor.isActive("tableHeader");
      editor.chain().focus().updateAttributes(isHeader ? "tableHeader" : "tableCell", { colwidth: [w] }).run();
    }
    if (h > 0) {
      editor.chain().focus().updateAttributes("tableRow", { height: `${h}px` }).run();
    }
    setShowTableSizeModal(false);
  }, [editor, tableSizeW, tableSizeH]);

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
      style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}
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
      <div className="toolbar dt-toolbar">
        <button type="button" className="dt-btn" data-active={editor.isActive("bold")} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
        <button type="button" className="dt-btn" data-active={editor.isActive("italic")} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
        <button type="button" className="dt-btn" data-active={editor.isActive("bulletList")} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBulletList().run()}>• Lista</button>
        <select
          defaultValue=""
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
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
        </select>
        <select
          defaultValue=""
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            if (v) editor.chain().focus().setFontSize(v).run();
          }}
        >
          <option value="" disabled>Rozmiar</option>
          <option value="10px">Bardzo mała</option>
          <option value="13px">Mała</option>
          <option value="16px">Normalna</option>
          <option value="18px">Duża</option>
          <option value="24px">Większa</option>
        </select>
        <button type="button" className="dt-btn" data-active={editor.isActive({ textAlign: "left" })} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("left").run()}>⬅</button>
        <button type="button" className="dt-btn" data-active={editor.isActive({ textAlign: "center" })} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("center").run()}>↔</button>
        <button type="button" className="dt-btn" data-active={editor.isActive({ textAlign: "right" })} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("right").run()}>➡</button>
        <button type="button" className="dt-btn" data-active={editor.isActive({ textAlign: "justify" })} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>☰</button>
        <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowPlainPasteModal(true)}>🧹 Wklej tekst</button>
        <button
          type="button"
          className="dt-btn"
          data-active={editor.isActive("table")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (editor.isActive("table")) {
              alert("Kursor jest już wewnątrz tabeli — zagnieżdżanie tabel nie jest obsługiwane.");
              return;
            }
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          }}
        >🔲 Tabela</button>
        {editor.isActive("table") && (
          <>
            <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>+Wiersz</button>
            <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>-Wiersz</button>
            <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>+Kolumna</button>
            <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>-Kolumna</button>
            <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={openTableSizeModal}>📐 Rozmiar</button>
            <button type="button" className="dt-btn" data-active={editor.getAttributes("table").align === "left"} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().updateAttributes("table", { align: "left" }).run()}>⬅</button>
            <button type="button" className="dt-btn" data-active={editor.getAttributes("table").align === "center"} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().updateAttributes("table", { align: "center" }).run()}>↔</button>
            <button type="button" className="dt-btn" data-active={editor.getAttributes("table").align === "right"} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().updateAttributes("table", { align: "right" }).run()}>➡</button>
            <button type="button" className="dt-btn dt-btn-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}>🗑 Usuń tabelę</button>
          </>
        )}
        <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={insertBreak}>⏎ Podział strony</button>
        <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={pickImage} disabled={uploading}>{uploading ? "Wysyłanie…" : "🖼 Obraz"}</button>
        <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={pickDocx} disabled={importingDocx}>{importingDocx ? "Importowanie…" : "📄 Import z Worda"}</button>
        <button type="button" className="dt-btn" onMouseDown={(e) => e.preventDefault()} onClick={addComment}>💬 Komentarz</button>
      </div>
      <div className="dt-page-scroll" style={{ background: "#888", padding: "24px 0", display: "flex", justifyContent: "center" }}>
        <style>{`
.dt-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; position: sticky; top: 0; z-index: 60; background: var(--bg-card, #fff); border-bottom: 1px solid var(--border-color, #ddd); }
.dt-btn { border: 1px solid var(--border-color, #ddd); background: var(--bg-card, #fff); color: var(--text-primary, #222); border-radius: 6px; padding: 5px 9px; font-size: 13px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.dt-btn:hover { background: var(--accent-light, #efedff); border-color: var(--accent, #6d5cfc); }
.dt-btn[data-active="true"] { background: var(--accent, #6d5cfc); border-color: var(--accent, #6d5cfc); color: #fff; }
.dt-btn:disabled { opacity: 0.5; cursor: default; }
.dt-btn-danger:hover { background: #fdeaea; border-color: #d33; color: #b00; }
.dt-page-scroll { flex: 1; overflow-y: auto; }
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
.doc-editor-tiptap-poc .simple-page-footer { display: flex; align-items: center; justify-content: space-between; color: #555; box-sizing: border-box; }
.doc-editor-tiptap-poc .simple-page-header > span,
.doc-editor-tiptap-poc .simple-page-footer > span { flex: 1; }
.doc-editor-tiptap-poc .simple-page-header > span:nth-child(2),
.doc-editor-tiptap-poc .simple-page-footer > span:nth-child(2) { text-align: center; }
.doc-editor-tiptap-poc .simple-page-header > span:nth-child(3),
.doc-editor-tiptap-poc .simple-page-footer > span:nth-child(3) { text-align: right; }
.doc-editor-tiptap-poc .simple-page-gap { height: 16px; background: #888; margin: 0 -48px; }
.doc-editor-tiptap-poc .ProseMirror, .doc-editor-tiptap-poc .rm-page-content { background: #fff !important; color: #000 !important; }
.doc-editor-tiptap-poc h1[data-num]::before,
.doc-editor-tiptap-poc h2[data-num]::before,
.doc-editor-tiptap-poc h3[data-num]::before { content: attr(data-num) ". "; }
.doc-editor-tiptap-poc .manual-page-break { position: relative; height: 0; border-top: 2px dashed #7b7bd6; margin: 24px 0; }
.doc-editor-tiptap-poc .manual-page-break::after { content: attr(data-label); position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 8px; font-size: 11px; color: #7b7bd6; white-space: nowrap; }
.doc-editor-tiptap-poc .doc-comment-anchor { background: #fff3b0; border-bottom: 2px solid #e6b800; cursor: pointer; }
.doc-editor-tiptap-poc .ProseMirror img { max-width: 100%; max-height: 850px; height: auto; }
.doc-editor-tiptap-poc .ProseMirror table { border-collapse: collapse; margin: 8px 0; }
.doc-editor-tiptap-poc .ProseMirror table td, .doc-editor-tiptap-poc .ProseMirror table th { border: 1px solid #999; min-width: 60px; padding: 4px 8px; position: relative; }
.doc-editor-tiptap-poc .ProseMirror table th { background: #eee; font-weight: bold; }
.doc-editor-tiptap-poc .page { box-shadow: 0 2px 10px rgba(0,0,0,0.35); }
.doc-editor-tiptap-poc .simple-page-break-line { position: absolute; left: -96px; right: -96px; height: 5px; background: #888; transform: translateY(-5px); pointer-events: none; z-index: 1; }
.doc-editor-tiptap-poc .simple-page-break-line::after { content: "Strona " attr(data-page-num); position: absolute; right: 0; top: 4px; font-size: 10px; color: #999; background: #fff; padding: 0 4px; }
.doc-editor-tiptap-poc .tableWrapper { overflow-x: auto; }
.doc-editor-tiptap-poc .column-resize-handle { position: absolute; right: -3px; top: 0; bottom: -2px; width: 6px; background-color: #4fc3f7; cursor: col-resize; z-index: 10; }
.doc-editor-tiptap-poc .ProseMirror table.resize-cursor { cursor: col-resize; }
        `}</style>
        <div style={{ position: "fixed", top: 4, right: 4, zIndex: 200000, background: "#000", color: "#0f0", fontSize: 11, padding: "4px 8px", borderRadius: 4, fontFamily: "monospace" }}>{debugInfo}</div>
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
          <div style={{ background: "#fff", borderRadius: 6, padding: 16, minWidth: 280 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 600, marginBottom: 4 }}>📐 Rozmiar tabeli</h3>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>{tableSizeInfo}</div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Szerokość kolumny (px)</label>
            <input type="number" value={tableSizeW} onChange={(e) => setTableSizeW(e.target.value)} style={{ width: "100%", marginBottom: 8 }} placeholder="np. 150" />
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Wysokość wiersza (px)</label>
            <input type="number" value={tableSizeH} onChange={(e) => setTableSizeH(e.target.value)} style={{ width: "100%", marginBottom: 12 }} placeholder="np. 40" />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="dt-btn" onClick={() => setShowTableSizeModal(false)}>Anuluj</button>
              <button type="button" className="dt-btn" onClick={applyTableSize}>Zastosuj</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {commentPopup && (() => {
        const popupLeft = Math.min(commentPopup.ax + 16, window.innerWidth - 280);
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
      })()}
    </div>
  );
}
