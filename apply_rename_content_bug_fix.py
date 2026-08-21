import sys, pathlib

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

p1 = pathlib.Path("src/frontend/src/lib/documentationDriveSync.ts")
src1 = p1.read_text(encoding="utf-8")
src1 = rep(src1, open("before11.txt", encoding="utf-8").read(), open("after11.txt", encoding="utf-8").read(), "odRename import")
src1 = rep(src1, open("before12.txt", encoding="utf-8").read(), open("after12.txt", encoding="utf-8").read(), "renameChapterOnDrive fn")
p1.write_text(src1, encoding="utf-8")

p2 = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src2 = p2.read_text(encoding="utf-8")
src2 = rep(src2, open("before13.txt", encoding="utf-8").read(), open("after13.txt", encoding="utf-8").read(), "component import")
src2 = rep(src2, open("before14.txt", encoding="utf-8").read(), open("after14.txt", encoding="utf-8").read(), "confirmRename fn")
p2.write_text(src2, encoding="utf-8")

print("OK - zapisano zmiany.")
