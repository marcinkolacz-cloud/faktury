import sys, pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

pairs = [
    ("before5.txt", "after5.txt", "contentWidthPx + inner padding"),
    ("before6.txt", "after6.txt", "contentHeightPx inner padding"),
    ("before7.txt", "after7.txt", "page-content padding/line-height"),
    ("before8.txt", "after8.txt", "measure width/padding"),
]
for bf, af, label in pairs:
    old = open(bf, encoding="utf-8").read().rstrip("\n")
    new = open(af, encoding="utf-8").read().rstrip("\n")
    src = rep(src, old, new, label)

p.write_text(src, encoding="utf-8")
print("OK - zapisano zmiany.")
