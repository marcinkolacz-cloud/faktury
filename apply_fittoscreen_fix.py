import sys, pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

b1 = open("before9.txt", encoding="utf-8").read()
a1 = open("after9.txt", encoding="utf-8").read()
b2 = open("before10.txt", encoding="utf-8").read()
a2 = open("after10.txt", encoding="utf-8").read()

src = rep(src, b1, a1, "fitToScreen/zoomLevel state + auto-scale effect")
src = rep(src, b2, a2, "container width/maxWidth always 210mm")

p.write_text(src, encoding="utf-8")
print("OK - zapisano zmiany.")
