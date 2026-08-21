import sys, pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

b1 = open("before1_20260821_060046.txt", encoding="utf-8").read()
a1 = open("after1_20260821_060046.txt", encoding="utf-8").read()
b2 = open("before2_20260821_060046.txt", encoding="utf-8").read()
a2 = open("after2_20260821_060046.txt", encoding="utf-8").read()

src = rep(src, b1, a1, "insert previewCounterCss const")
src = rep(src, b2, a2, "style block with COUNTER_CSS")

p.write_text(src, encoding="utf-8")
print("OK - zapisano zmiany.")
