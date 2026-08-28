import re, sys

PATH = "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"
with open(PATH, encoding="utf-8") as f:
    s = f.read()

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return s.replace(old, new, 1)

# 1) import Decoration/DecorationSet
s = replace_once(
    s,
    'import { Plugin, PluginKey } from "@tiptap/pm/state";',
    'import { Plugin, PluginKey } from "@tiptap/pm/state";\nimport { Decoration, DecorationSet } from "@tiptap/pm/view";',
    "import-deco",
)

# 2) insert SimplePagination plugin definition after A4_PX const
plugin_code = '''const A4_PX = { width: 794, height: 1123, margin: 96 };

// SimplePagination: wlasny silnik zywej paginacji (bez tiptap-pagination-plus).
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

s = replace_once(
    s,
    "const A4_PX = { width: 794, height: 1123, margin: 96 };",
    plugin_code,
    "plugin-def",
)

# 3) add SimplePagination to extensions array
s = replace_once(
    s,
    '      HeadingNumbering.configure({ h1OffsetBefore }),\n      // AWARYJNIE WYLACZONE 2026-08-28: tiptap-pagination-plus powodowal',
    '      HeadingNumbering.configure({ h1OffsetBefore }),\n      SimplePagination,\n      // AWARYJNIE WYLACZONE 2026-08-28: tiptap-pagination-plus powodowal',
    "extensions-array",
)

# 4) position:relative na .ProseMirror (potrzebne dla position:absolute linii)
s = replace_once(
    s,
    '.doc-editor-tiptap-poc .ProseMirror, .doc-editor-tiptap-poc .rm-page-content { background: #fff !important; color: #000 !important; }',
    '.doc-editor-tiptap-poc .ProseMirror { position: relative; }\n.doc-editor-tiptap-poc .ProseMirror, .doc-editor-tiptap-poc .rm-page-content { background: #fff !important; color: #000 !important; }',
    "css-relative",
)

# 5) CSS dla linii podzialu strony
s = replace_once(
    s,
    '.doc-editor-tiptap-poc .page { box-shadow: 0 2px 10px rgba(0,0,0,0.35); }',
    '.doc-editor-tiptap-poc .page { box-shadow: 0 2px 10px rgba(0,0,0,0.35); }\n'
    '.doc-editor-tiptap-poc .simple-page-break-line { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #999; pointer-events: none; z-index: 1; }\n'
    '.doc-editor-tiptap-poc .simple-page-break-line::after { content: "Strona " attr(data-page-num); position: absolute; right: 0; top: 4px; font-size: 10px; color: #999; background: #fff; padding: 0 4px; }',
    "css-break-line",
)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK - 5 edycji zastosowane")
