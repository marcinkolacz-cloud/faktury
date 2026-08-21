import re, sys, pathlib

path = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = path.read_text(encoding="utf-8")

def uniq_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' znaleziono {n} razy (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

OLD_STATE = '  const [previewHtml, setPreviewHtml] = useState("");'
NEW_STATE = '  const [previewHtml, setPreviewHtml] = useState("");\n  const [previewPageCount, setPreviewPageCount] = useState<number | null>(null);'
src = uniq_replace(src, OLD_STATE, NEW_STATE, "state hook")

OLD_HEADER = '            <h2 className="text-sm font-bold text-[#4fc3f7]">Podglad wydruku - zaznaczone rozdzialy: {selectedForPrint.size}</h2>'
NEW_HEADER = ('            <h2 className="text-sm font-bold text-[#4fc3f7]">\n'
              '              Podglad wydruku - rozdzialy: {selectedForPrint.size}{previewPageCount != null ? ` — stron: ${previewPageCount}` : ""}\n'
              '            </h2>')
src = uniq_replace(src, OLD_HEADER, NEW_HEADER, "modal header")

OLD_FUNC = open(pathlib.Path(__file__).parent / "before_snippet_20260821_054746.txt", encoding="utf-8").read()
NEW_FUNC = open(pathlib.Path(__file__).parent / "after_snippet_20260821_054746.txt", encoding="utf-8").read()
src = uniq_replace(src, OLD_FUNC, NEW_FUNC, "buildChapterPreviewHtml/open/refresh")

path.write_text(src, encoding="utf-8")
print("OK - zapisano zmiany.")
