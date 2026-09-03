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

# Margines strony (spacer + tlo pod header/footer gdy wylaczone) MUSI byc
# BIALY - to fizycznie czesc arkusza A4 (jak padding .sheet w Podgladzie),
# a nie "poza kartka". Szary ma byc TYLKO waski, staly szew (seam) miedzy
# dwoma fizycznymi arkuszami - dokladnie jak 12px margin miedzy .sheet w
# Podgladzie. Poprzednia wersja pomalowala CALY margines (3.75cm+1.27cm) na
# szaro, co przy niemal pustych stronach dawalo ogromne szare bloki.
old = '''.doc-editor-tiptap-poc .simple-page-boundary { background: #888; margin: 0 -48px; width: calc(100% + 96px); box-sizing: border-box; box-shadow: inset 0 8px 10px -8px rgba(0,0,0,0.5), inset 0 -8px 10px -8px rgba(0,0,0,0.5); }
.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; }'''
new = '''.doc-editor-tiptap-poc .simple-page-boundary { margin: 0 -48px; width: calc(100% + 96px); box-sizing: border-box; }
.doc-editor-tiptap-poc .simple-page-margin-spacer { box-sizing: border-box; background: #fff; }'''
content = replace_once(content, old, new, "boundary/spacer background")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: poprawka zastosowana.")
