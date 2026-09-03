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

# Poprzednia metoda (width:calc(100% + 96px) + margin:0 -48px) polega na
# rownaniu CSS box-modelu, ktore przy nadmiarowo wyspecyfikowanych
# marginesach jest DOPRECYZOWYWANE przez przegladarke w nieoczywisty sposob
# i moze dawac 1-kilkupikselowe/wieksze rozjazdy zalezne od kontekstu
# (dokladnie to widac na screenie jako "wypustki"). .ProseMirror ma STALA,
# nie-responsywna szerokosc 794px (patrz regula ponizej) - wiec zamiast
# procentow uzywamy WPROST tych samych stalych pikseli: position:relative;
# left:-48px (cofa element z normalnej pozycji startujacej w content-box na
# absolutny lewy brzeg arkusza) + width:794px (dokladna szerokosc border-box
# .ProseMirror). To eliminuje jakakolwiek dwuznacznosc obliczen.
old = '''.doc-editor-tiptap-poc .simple-page-boundary { margin: 0 -48px; width: calc(100% + 96px); box-sizing: border-box; }'''
new = '''.doc-editor-tiptap-poc .simple-page-boundary { position: relative; left: -48px; width: 794px; box-sizing: border-box; }'''
content = replace_once(content, old, new, "boundary full-bleed math")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: poprawka zastosowana.")
