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

old = '.doc-editor-tiptap-poc .simple-page-break-line { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #999; pointer-events: none; z-index: 1; }'
new = '.doc-editor-tiptap-poc .simple-page-break-line { position: absolute; left: -96px; right: -96px; height: 5px; background: #888; transform: translateY(-5px); pointer-events: none; z-index: 1; }'
s = replace_once(s, old, new, "thick-gray-line")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK")
