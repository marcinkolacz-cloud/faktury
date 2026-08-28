import sys

PATH = "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"
with open(PATH, encoding="utf-8") as f:
    s = f.read()

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected {1}), got {n}")
        sys.exit(1)
    return s.replace(old, new, 1)

# 1) Zamiana calego bloku SimplePagination na wersje z naglowkiem/stopka
old_block = '''// SimplePagination: wlasny silnik zywej paginacji (bez tiptap-pagination-plus).
// Mierzy realne wysokosci top-level blokow (getBoundingClientRect) i wstawia
// CIENKIE, ABSOLUTNIE POZYCJONOWANE linie podzialu stron - sa poza normalnym
// ukladem (nie przesuwaja tresci), wiec ich wstawienie nigdy nie zmienia
// wysokosci mierzonych blokow => brak petli sprzezenia zwrotnego (przyczyna
// zawieszania w starym pakiecie). Rekalkulacja odpala sie WYLACZNIE gdy
// zmienia sie editor.state.doc (nasz wlasny dispatch dekoracji nie tworzy
// nowego doc, wiec nie wywoluje ponownego przeliczenia) + po zaladowaniu
// obrazkow + po resize.
const SIMPLE_PAGE_BREAK_KEY = new PluginKey("simplePageBreaks");
const SIMPLE_PAGE_CONTENT_H = A4_PX.height - A4_PX.margin * 2;

function makeSimplePageBreakWidget(top: number, pageNum: number) {
  return () => {
    const el = document.createElement("div");
    el.className = "simple-page-break-line";
    el.style.top = `${Math.max(0, Math.round(top))}px`;
    el.setAttribute("data-page-num", String(pageNum));
    el.contentEditable = "false";
    return el;
  };
}

function computeSimplePageBreaks(view: any) {
  const dom = view.dom as HTMLElement;
  const proseRect = dom.getBoundingClientRect();
  if (proseRect.height === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  let pageStartTop: number | null = null;
  let pageNum = 1;
  view.state.doc.forEach((_node: any, offset: number) => {
    const domNode = view.nodeDOM(offset);
    if (!(domNode instanceof HTMLElement)) return;
    if (domNode.classList.contains(PAGE_BREAK_CLASS)) {
      pageStartTop = null;
      pageNum += 1;
      return;
    }
    const rect = domNode.getBoundingClientRect();
    const relTop = rect.top - proseRect.top;
    const relBottom = rect.bottom - proseRect.top;
    if (pageStartTop === null) {
      pageStartTop = relTop;
    } else if (relBottom - pageStartTop > SIMPLE_PAGE_CONTENT_H) {
      pageNum += 1;
      decos.push(Decoration.widget(offset, makeSimplePageBreakWidget(relTop, pageNum), { side: -1, key: `spb-${offset}` }));
      pageStartTop = relTop;
    }
  });
  return DecorationSet.create(view.state.doc, decos);
}

const SimplePagination = Extension.create({
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
            const decoSet = computeSimplePageBreaks(editorView);
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
          schedule();
          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) schedule();
            },
            destroy() {
              if (frame !== null) cancelAnimationFrame(frame);
              editorView.dom.removeEventListener("load", onLoad, true);
              window.removeEventListener("resize", schedule);
            },
          };
        },
      }),
    ];
  },
});'''

new_block = '''// SimplePagination: wlasny silnik zywej paginacji (bez tiptap-pagination-plus).
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
function nl2brSimple(t: string) { return (t || "").replace(/\\n/g, "<br/>"); }

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

function createSimplePaginationExtension(cfgRef: { current: HfPagCfg }) {
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
            schedule();
            return {
              update(view, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                if (frame !== null) cancelAnimationFrame(frame);
                editorView.dom.removeEventListener("load", onLoad, true);
                window.removeEventListener("resize", schedule);
              },
            };
          },
        }),
      ];
    },
  });
}'''

s = replace_once(s, old_block, new_block, "plugin-rewrite")

# 2) Props type - dodanie nowych pol
old_props = '''type Props = {
  initialHtml: string;
  onChangeHtml: (html: string) => void;
  h1OffsetBefore?: number;
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
  onImageUpload?: (blob: Blob, filename: string) => Promise<string>;
};
export function DocumentationEditorTiptapPoC({
  initialHtml,
  onChangeHtml,
  h1OffsetBefore = 0,
  headerLeft = "",
  headerCenter = "",
  headerRight = "",
  footerLeft = "",
  footerCenter = "Strona {page}",
  footerRight = "",
  onImageUpload,
}: Props) {'''

new_props = '''type Props = {
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
}: Props) {'''

s = replace_once(s, old_props, new_props, "props-type")

# 3) hfConfigRef przed useEditor + useEffect synchronizujacy
old_editor_start = '  const editor = useEditor({'
new_editor_start = '''  const hfConfigRef = useRef<HfPagCfg>({
    headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
    footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
    headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
  });
  useEffect(() => {
    hfConfigRef.current = {
      headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
      footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
      headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
    };
  }, [headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight, footerLeft, footerCenter, footerRight, enableHeader, enableFooter, headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage]);
  const editor = useEditor({'''

s = replace_once(s, old_editor_start, new_editor_start, "hfconfigref")

# 4) extensions array - podmiana SimplePagination na fabryke
old_ext = '''      HeadingNumbering.configure({ h1OffsetBefore }),
      SimplePagination,
      // AWARYJNIE WYLACZONE 2026-08-28: tiptap-pagination-plus powodowal'''
new_ext = '''      HeadingNumbering.configure({ h1OffsetBefore }),
      createSimplePaginationExtension(hfConfigRef),
      // AWARYJNIE WYLACZONE 2026-08-28: tiptap-pagination-plus powodowal'''
s = replace_once(s, old_ext, new_ext, "extensions-array-factory")

# 5) CSS - ProseMirror padding (usuwamy staly top/bottom, header/footer sa teraz realnymi blokami w tresci)
old_css_pm = '''.doc-editor-tiptap-poc .ProseMirror {
  position: relative;
  width: 794px;
  min-height: 1123px;
  padding: 96px !important;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(0,0,0,0.35);
  margin: 0 auto;
}'''
new_css_pm = '''.doc-editor-tiptap-poc .ProseMirror {
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
.doc-editor-tiptap-poc .simple-page-gap { height: 16px; background: #888; margin: 0 -48px; }'''
s = replace_once(s, old_css_pm, new_css_pm, "css-prosemirror")

# 6) usuniecie starej linii przerywanej (zastapiona przez simple-page-gap)
old_line_css = '.doc-editor-tiptap-poc .simple-page-break-line { position: absolute; left: -96px; right: -96px; height: 5px; background: #888; transform: translateY(-5px); pointer-events: none; z-index: 1; }\\n'
if old_line_css in s:
    s = s.replace(old_line_css, "", 1)
old_line_after_css = '.doc-editor-tiptap-poc .simple-page-break-line::after { content: "Strona " attr(data-page-num); position: absolute; right: 0; top: 4px; font-size: 10px; color: #999; background: #fff; padding: 0 4px; }\\n'
if old_line_after_css in s:
    s = s.replace(old_line_after_css, "", 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK - wszystkie edycje zastosowane")
