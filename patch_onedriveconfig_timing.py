import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''async function authHeaders(extra: Record<string, string> = {}) {
  const token = await getDriveToken();
  return { Authorization: "Bearer " + token, ...extra };
}'''
new = '''async function authHeaders(extra: Record<string, string> = {}) {
  const token = await getDriveToken();
  driveMark("token");
  return { Authorization: "Bearer " + token, ...extra };
}'''
assert old in src, "marker authHeaders nie znaleziony"
src = src.replace(old, new, 1)

if 'import { driveMark } from "./driveTiming";' not in src:
    lines = src.split("\n")
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = i + 1
        elif insert_at > 0:
            break
    lines.insert(insert_at, 'import { driveMark } from "./driveTiming";')
    src = "\n".join(lines)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK - patched", path)
