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

old_fn = '''function computeBreakOffsets(view: any, contentH: number, scale: number): number[] {
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
    // getBoundingClientRect() zwraca wysokość PO ewentualnym transform:scale
    // z przodka (zoom edytora "Dopasuj do ekranu" / ręczny zoom) - dzielimy
    // przez ten sam współczynnik, żeby porównywać z contentH (który jest
    // liczony z cm, czyli zawsze "prawdziwą", nieprzeskalowaną wysokością
    // strony). Bez tego przy zoomie != 100% strony łamały się po
    // wielokrotnie za małej (lub za dużej) ilości treści.
    const h = domNode.getBoundingClientRect().height / scale;
    const isHeading = /^H[1-4]$/.test(domNode.tagName);
    let broke = false;
    if (currentH > 0 && currentH + h > contentH) {
      breakOffsets.push(offset);
      currentH = 0;
      broke = true;
    } else if (isHeading && currentH > 0 && (contentH - currentH) < (h + MIN_LEAD)) {
      breakOffsets.push(offset);
      currentH = 0;
      broke = true;
    }
    if (DEBUG_PAG) {
      domNode.setAttribute("data-dbgh", `${domNode.tagName} ${Math.round(h)}px${broke ? " CIĘCIE" : ""}`);
    }
    currentH += h;
  });
  return breakOffsets;
}'''

new_fn = '''type BreakInfo = { offset: number; leftover: number };

// Gdy strona konczy sie wczesniej niz contentH (np. regula unikania
// osieroconego naglowka nizej), zostawala niewykorzystana przestrzen ktora
// nigdy nie byla wizualnie wypelniana - pasek graniczny wskakiwal zaraz po
// ostatnim tekscie i strona wygladala krocej niz realne A4. leftover =
// dokladnie ta brakujaca wysokosc; buildPageBoundaryWidget wstawia w tym
// miejscu bialy filler, tak jak min-height:297mm robi to automatycznie w
// Podgladzie (tam kazda strona ma wlasny DOM-owy kontener .sheet).
function computeBreakOffsets(view: any, contentH: number, scale: number): BreakInfo[] {
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
    // getBoundingClientRect() zwraca wysokość PO ewentualnym transform:scale
    // z przodka (zoom edytora "Dopasuj do ekranu" / ręczny zoom) - dzielimy
    // przez ten sam współczynnik, żeby porównywać z contentH (który jest
    // liczony z cm, czyli zawsze "prawdziwą", nieprzeskalowaną wysokością
    // strony). Bez tego przy zoomie != 100% strony łamały się po
    // wielokrotnie za małej (lub za dużej) ilości treści.
    const h = domNode.getBoundingClientRect().height / scale;
    const isHeading = /^H[1-4]$/.test(domNode.tagName);
    let broke = false;
    if (currentH > 0 && currentH + h > contentH) {
      breakOffsets.push({ offset, leftover: Math.max(0, contentH - currentH) });
      currentH = 0;
      broke = true;
    } else if (isHeading && currentH > 0 && (contentH - currentH) < (h + MIN_LEAD)) {
      breakOffsets.push({ offset, leftover: Math.max(0, contentH - currentH) });
      currentH = 0;
      broke = true;
    }
    if (DEBUG_PAG) {
      domNode.setAttribute("data-dbgh", `${domNode.tagName} ${Math.round(h)}px${broke ? " CIĘCIE" : ""}`);
    }
    currentH += h;
  });
  return breakOffsets;
}'''
content = replace_once(content, old_fn, new_fn, "computeBreakOffsets")

old_call = '''  breakOffsets.forEach((offset, i) => {
    const endingPage = i + 1;
    const startingPage = i + 2;
    const key = `spb-${offset}`;
    decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, startingPage, totalPages), { side: -1, key }));
  });'''
new_call = '''  breakOffsets.forEach(({ offset, leftover }, i) => {
    const endingPage = i + 1;
    const startingPage = i + 2;
    const key = `spb-${offset}`;
    decos.push(Decoration.widget(offset, buildPageBoundaryWidget(cfg, endingPage, startingPage, totalPages, leftover), { side: -1, key }));
  });'''
content = replace_once(content, old_call, new_call, "computeSimplePageBreaks call site")

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

old_css = '''.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; background: #fff; }'''
new_css = '''.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; background: #fff; }
.doc-editor-tiptap-poc .simple-page-fill { box-sizing: border-box; background: #fff; }'''
content = replace_once(content, old_css, new_css, "filler css")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: wszystkie podmiany zastosowane.")
