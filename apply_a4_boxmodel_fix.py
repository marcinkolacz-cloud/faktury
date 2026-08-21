import sys, pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")
old = open("before4.txt", encoding="utf-8").read()
new = open("after4.txt", encoding="utf-8").read()
n = src.count(old)
if n != 1:
    print(f"BLAD: wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
    sys.exit(1)
p.write_text(src.replace(old, new), encoding="utf-8")
print("OK - zapisano zmiany.")
