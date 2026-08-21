import pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")
old = 'editMode ? "fixed z-40 flex flex-col'
new = 'editMode ? "fixed z-[200] flex flex-col'
n = src.count(old)
print("wystapien:", n)
if n == 1:
    src = src.replace(old, new)
    p.write_text(src, encoding="utf-8")
    print("OK")
