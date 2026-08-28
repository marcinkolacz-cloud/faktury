import sys, subprocess

found = subprocess.run(["find", ".", "-name", "DocumentationEditorTiptapPoC.tsx"], capture_output=True, text=True).stdout.strip().splitlines()
path = found[0] if found else "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = """  const footerRightWithCenter = useMemo(
    () => `<span class="rm-center-slot">${footerCenter}</span>${footerRight}`,
    [footerCenter, footerRight]
  );
  const editor = useEditor({"""
new = """  const footerRightWithCenter = useMemo(
    () => `<span class="rm-center-slot">${footerCenter}</span>${footerRight}`,
    [footerCenter, footerRight]
  );
  // PaginationPlus/A4_PX/headerLeft/footerLeft/headerRightWithCenter/footerRightWithCenter
  // chwilowo nieuzywane (paginacja wylaczona awaryjnie 2026-08-28) - zachowane do
  // przywrocenia we wlasnym silniku paginacji.
  void PaginationPlus; void A4_PX; void headerLeft; void footerLeft; void headerRightWithCenter; void footerRightWithCenter;
  const editor = useEditor({"""

n = content.count(old)
if n != 1:
    print(f"BLAD: znaleziono {n} wystapien (oczekiwano 1)")
    sys.exit(1)
content = content.replace(old, new)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"OK, zapisano: {path}")
