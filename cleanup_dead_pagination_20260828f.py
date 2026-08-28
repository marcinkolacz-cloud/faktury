import sys

PATH = "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"
with open(PATH, encoding="utf-8") as f:
    s = f.read()

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1), got {n}")
        sys.exit(1)
    return s.replace(old, new, 1)

# 1) usun import PaginationPlus
s = replace_once(
    s,
    'import { PaginationPlus } from "tiptap-pagination-plus";\n',
    '',
    "remove-import",
)

# 2) usun nieuzywane headerRightWithCenter/footerRightWithCenter + void-line
old = '''  const headerRightWithCenter = useMemo(
    () => `<span class="rm-center-slot">${headerCenter}</span>${headerRight}`,
    [headerCenter, headerRight]
  );
  const footerRightWithCenter = useMemo(
    () => `<span class="rm-center-slot">${footerCenter}</span>${footerRight}`,
    [footerCenter, footerRight]
  );
  // PaginationPlus/A4_PX/headerLeft/footerLeft/headerRightWithCenter/footerRightWithCenter
  // chwilowo nieuzywane (paginacja wylaczona awaryjnie 2026-08-28) - zachowane do
  // przywrocenia we wlasnym silniku paginacji.
  void PaginationPlus; void A4_PX; void headerLeft; void footerLeft; void headerRightWithCenter; void footerRightWithCenter;
'''
s = replace_once(s, old, "", "remove-unused-memos")

# 3) usun caly zakomentowany blok PaginationPlus.configure(...)
old2 = '''      // AWARYJNIE WYLACZONE 2026-08-28: tiptap-pagination-plus powodowal
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
'''
s = replace_once(s, old2, "", "remove-commented-block")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK - martwy kod usuniety")
