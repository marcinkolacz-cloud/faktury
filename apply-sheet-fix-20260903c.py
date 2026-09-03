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

# 1) header: usun wlasny ujemny margines, dodaj biale tlo
old1 = '''  el.style.height = `${cmToPx(cfg.headerHeightCm)}px`;
  el.style.fontSize = `${cfg.headerFontSize}pt`;
  el.style.margin = `0 -${SIDE_MARGIN_PX}px`;
  el.style.padding = `0 ${SIDE_MARGIN_PX}px 6px`;
  el.style.alignItems = headerFooterAlignItems(left, center, right);'''
new1 = '''  el.style.height = `${cmToPx(cfg.headerHeightCm)}px`;
  el.style.fontSize = `${cfg.headerFontSize}pt`;
  el.style.padding = `0 ${SIDE_MARGIN_PX}px 6px`;
  el.style.background = "#fff";
  el.style.alignItems = headerFooterAlignItems(left, center, right);'''
content = replace_once(content, old1, new1, "header style block")

# 2) footer: to samo
old2 = '''  el.style.height = `${cmToPx(cfg.footerHeightCm)}px`;
  el.style.fontSize = `${cfg.footerFontSize}pt`;
  el.style.margin = `0 -${SIDE_MARGIN_PX}px`;
  el.style.padding = `6px ${SIDE_MARGIN_PX}px 0`;
  el.style.alignItems = headerFooterAlignItems(left, center, right);'''
new2 = '''  el.style.height = `${cmToPx(cfg.footerHeightCm)}px`;
  el.style.fontSize = `${cfg.footerFontSize}pt`;
  el.style.padding = `6px ${SIDE_MARGIN_PX}px 0`;
  el.style.background = "#fff";
  el.style.alignItems = headerFooterAlignItems(left, center, right);'''
content = replace_once(content, old2, new2, "footer style block")

# 3) boundary wrap: dodaj klase pelnoszerokosciowego kontenera
old3 = '''function buildPageBoundaryWidget(cfg: HfPagCfg, endingPageNum: number, startingPageNum: number, totalPages: number) {
  return () => {
    const wrap = document.createElement("div");
    wrap.contentEditable = "false";'''
new3 = '''function buildPageBoundaryWidget(cfg: HfPagCfg, endingPageNum: number, startingPageNum: number, totalPages: number) {
  return () => {
    const wrap = document.createElement("div");
    wrap.className = "simple-page-boundary";
    wrap.contentEditable = "false";'''
content = replace_once(content, old3, new3, "boundary wrap")

# 4) CSS: header/footer szerokosc 100% (margin/padding teraz z JS + boundary wrapper)
old4 = '''.doc-editor-tiptap-poc .simple-page-header,
.doc-editor-tiptap-poc .simple-page-footer { display: flex; align-items: center; justify-content: space-between; color: #555; box-sizing: border-box; position: relative; width: calc(100% + 96px); margin: 0 -48px; padding: 0 48px; flex: none; }'''
new4 = '''.doc-editor-tiptap-poc .simple-page-boundary { background: #888; margin: 0 -48px; width: calc(100% + 96px); box-sizing: border-box; box-shadow: inset 0 8px 10px -8px rgba(0,0,0,0.5), inset 0 -8px 10px -8px rgba(0,0,0,0.5); }
.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; }
.doc-editor-tiptap-poc .simple-page-header,
.doc-editor-tiptap-poc .simple-page-footer { display: flex; align-items: center; justify-content: space-between; color: #555; box-sizing: border-box; position: relative; width: 100%; flex: none; }'''
content = replace_once(content, old4, new4, "header/footer css width")

# 5) CSS: pasek gap - ciemniejszy szew, bez wlasnego full-bleed (dziedziczy z boundary)
old5 = '''.doc-editor-tiptap-poc .simple-page-gap { height: 16px; background: #888; margin: 0 -48px; width: calc(100% + 96px); box-sizing: border-box; position: relative; }
.doc-editor-tiptap-poc .simple-page-gap-label { position: absolute; top: 1px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #fff; font-family: monospace; white-space: nowrap; }'''
new5 = '''.doc-editor-tiptap-poc .simple-page-gap { height: 20px; background: #666; box-sizing: border-box; position: relative; }
.doc-editor-tiptap-poc .simple-page-gap-label { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #fff; font-family: monospace; white-space: nowrap; }'''
content = replace_once(content, old5, new5, "gap css")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: wszystkie 5 podmian zastosowane.")
