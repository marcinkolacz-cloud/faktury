import pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")
old = "const buildChapterPreviewHtml = async (): Promise<string> => {"
new = "const buildChapterPreviewHtml = async (forPrint: boolean = false, gridView: boolean = false): Promise<string> => {"
n = src.count(old)
print("wystapien:", n)
if n == 1:
    src = src.replace(old, new)
    p.write_text(src, encoding="utf-8")
    print("OK zapisano")
