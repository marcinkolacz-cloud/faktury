import sys, io

path = "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"
with io.open(path, "r", encoding="utf-8") as f:
    content = f.read()

def replace_once(content, old, new, label):
    n = content.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapil {n} razy (oczekiwano 1) - przerywam bez zapisu.")
        sys.exit(1)
    return content.replace(old, new, 1)

# computeBreakOffsets zwracal same offsety. Gdy strona konczy sie WCZESNIEJ
# niz contentH (np. regula unikania osieroconego naglowka: "isHeading &&
# (contentH-currentH) < h+MIN_LEAD"), zostawala niewykorzystana przestrzen
# (contentH - currentH), ktora NIGDY nie byla wizualnie wypelniana - pasek
# graniczny wskakiwal zaraz po ostatnim tekscie, wiec strona wygladala na
# krotsza niz realne A4. Teraz zwracamy per-zlamanie "leftover" (ile pikseli
# zabraklo do pelnej wysokosci strony), a buildPageBoundaryWidget wstawia
# bialy filler o tej wysokosci PRZED stopka/marginesem - dokladnie tak jak
# w Podgladzie robi to CSS "min-height:297mm" na .sheet (tam przegladarka
# robi to automatycznie, bo kazda strona ma osobny DOM-owy kontener; tutaj
# tresc plynie w jednym ciaglym ProseMirror, wiec musimy dolozyc ta
# wysokosc recznie).
old_fn = '''function computeBreakOffsets(view: any, contentH: number): number[] {
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
}'''
new_fn = '''type BreakInfo = { offset: number; leftover: number };

function computeBreakOffsets(view: any, contentH: number): BreakInfo[] {
  const breakOffsets: BreakInfo[] = [];
  let currentH = 0;
  view.state.doc.forEach((_node: any, offset: number) => {
    const domNode = view.nodeDOM(offset);
    if (!(domNode instanceof HTMLElement)) return;
    if (domNode.classList.contains(PAGE_BREAK_CLASS)) {
      breakOffsets.push({ offset, leftover: Math.max(0, contentH - currentH) });
      currentH = 0;
      return;
    }
    const h = domNode.getBoundingClientRect().height;
    const isHeading = /^H[1-4]$/.test(domNode.tagName);
    if (currentH > 0 && currentH + h > contentH) {
      breakOffsets.push({ offset, leftover: Math.max(0, contentH - currentH) });
      currentH = 0;
    } else if (isHeading && currentH > 0 && (contentH - currentH) < (h + MIN_LEAD)) {
      breakOffsets.push({ offset, leftover: Math.max(0, contentH - currentH) });
      currentH = 0;
    }
    currentH += h;
  });
  return breakOffsets;
}'''
content = replace_once(content, old_fn, new_fn, "computeBreakOffsets")

# computeSimplePageBreaks: rozpakuj {offset,leftover} i przekaz leftover do widgetu
old_call = '''  const breakOffsets = computeBreakOffsets(view, contentH);
  const totalPages = breakOffsets.length + 1;
  cfg.onPageCountChange?.(totalPages);
  const decos: Decoration[] = [];
  breakOffsets.forEach((offset, i) => {
    const endingPage = i + 1;
    const startingPage = i + 2;
    const key = `spb-${offset}`;
    decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, startingPage, totalPages), { side: -1, key }));
  });'''
new_call = '''  const breakOffsets = computeBreakOffsets(view, contentH);
  const totalPages = breakOffsets.length + 1;
  cfg.onPageCountChange?.(totalPages);
  const decos: Decoration[] = [];
  breakOffsets.forEach(({ offset, leftover }, i) => {
    const endingPage = i + 1;
    const startingPage = i + 2;
    const key = `spb-${offset}`;
    decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, startingPage, totalPages, leftover), { side: -1, key }));
  });'''
content = replace_once(content, old_call, new_call, "computeSimplePageBreaks call site")

# buildPageBoundaryWidget: przyjmij leftover, wstaw bialy filler przed stopka
old_widget = '''function buildPageBoundaryWidget(cfg: HfPagCfg, endingPageNum: number, startingPageNum: number, totalPages: number) {
  return () => {
    const wrap = document.createElement("div");
    wrap.className = "simple-page-boundary";
    wrap.contentEditable = "false";
    if (cfg.enableFooter && !(cfg.skipFirstPage && endingPageNum === 1)) {'''
new_widget = '''function buildFillerEl(heightPx: number) {
  const el = document.createElement("div");
  el.className = "simple-page-fill";
  el.contentEditable = "false";
  el.style.height = `${Math.round(heightPx)}px`;
  return el;
}

function buildPageBoundaryWidget(cfg: HfPagCfg, endingPageNum: number, startingPageNum: number, totalPages: number, leftover: number = 0) {
  return () => {
    const wrap = document.createElement("div");
    wrap.className = "simple-page-boundary";
    wrap.contentEditable = "false";
    if (leftover > 0.5) wrap.appendChild(buildFillerEl(leftover));
    if (cfg.enableFooter && !(cfg.skipFirstPage && endingPageNum === 1)) {'''
content = replace_once(content, old_widget, new_widget, "buildPageBoundaryWidget signature")

# CSS: filler jest biale (czesc arkusza, tak jak spacer marginesu)
old_css = '''.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; background: #fff; }'''
new_css = '''.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; background: #fff; }
.doc-editor-tiptap-poc .simple-page-fill { box-sizing: border-box; background: #fff; }'''
content = replace_once(content, old_css, new_css, "filler css")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: wszystkie podmiany zastosowane.")
