import sys, subprocess

found = subprocess.run(["find", ".", "-name", "DocumentationEditorTiptapPoC.tsx"], capture_output=True, text=True).stdout.strip().splitlines()
path = found[0] if found else "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

def replace_once(old, new, label):
    global content
    n = content.count(old)
    if n != 1:
        print(f"BLAD [{label}]: znaleziono {n} wystapien (oczekiwano 1)")
        sys.exit(1)
    content = content.replace(old, new)
    print(f"OK [{label}]")

old_ext = """      PaginationPlus.configure({
        pageHeight: A4_PX.height,
        pageWidth: A4_PX.width,
        marginTop: A4_PX.margin,
        marginBottom: A4_PX.margin,
        marginLeft: A4_PX.margin,
        marginRight: A4_PX.margin,
        pageGap: 28,
        pageGapBorderSize: 1,
        pageGapBorderColor: "#666666",
        pageBreakBackground: "#888888",
        headerLeft,
        headerRight: headerRightWithCenter,
        footerLeft,
        footerRight: footerRightWithCenter,
      }),
    ],"""
new_ext = """      // AWARYJNIE WYLACZONE 2026-08-28: tiptap-pagination-plus powodowal
      // zawieszanie edytora (petla sprzezenia zwrotnego w liczeniu wysokosci
      // stron). Przywrocic po przepisaniu wlasnego silnika paginacji.
      // PaginationPlus.configure({
      //   pageHeight: A4_PX.height,
      //   pageWidth: A4_PX.width,
      //   marginTop: A4_PX.margin,
      //   marginBottom: A4_PX.margin,
      //   marginLeft: A4_PX.margin,
      //   marginRight: A4_PX.margin,
      //   pageGap: 28,
      //   pageGapBorderSize: 1,
      //   pageGapBorderColor: "#666666",
      //   pageBreakBackground: "#888888",
      //   headerLeft,
      //   headerRight: headerRightWithCenter,
      //   footerLeft,
      //   footerRight: footerRightWithCenter,
      // }),
    ],"""
replace_once(old_ext, new_ext, "disable-PaginationPlus-extension")

old_create = '    onCreate: ({ editor }) => settlePaginationAfterImagesLoad(editor),'
new_create = '    // onCreate: ({ editor }) => settlePaginationAfterImagesLoad(editor), // wylaczone razem z PaginationPlus (2026-08-28)'
replace_once(old_create, new_create, "disable-onCreate-settlePagination")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"ZAPISANO: {path}")
