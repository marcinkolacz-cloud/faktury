import sys, pathlib

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

p2 = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src2 = p2.read_text(encoding="utf-8")
src2 = rep(src2, open("before13.txt", encoding="utf-8").read(), open("after13.txt", encoding="utf-8").read(), "component import")
src2 = rep(src2, open("before14.txt", encoding="utf-8").read(), open("after14.txt", encoding="utf-8").read(), "confirmRename fn")
p2.write_text(src2, encoding="utf-8")
print("OK - zapisano zmiany.")
