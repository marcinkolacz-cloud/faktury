import sys

PATH = "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"
with open(PATH, encoding="utf-8") as f:
    s = f.read()

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return s.replace(old, new, 1)

old = '.doc-editor-tiptap-poc .ProseMirror { position: relative; }'
new = (
    '.doc-editor-tiptap-poc .ProseMirror {\n'
    '  position: relative;\n'
    '  width: 794px;\n'
    '  min-height: 1123px;\n'
    '  padding: 96px !important;\n'
    '  box-sizing: border-box;\n'
    '  box-shadow: 0 2px 10px rgba(0,0,0,0.35);\n'
    '  margin: 0 auto;\n'
    '}'
)
s = replace_once(s, old, new, "prosemirror-a4-size")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK - 1 edycja zastosowana")
