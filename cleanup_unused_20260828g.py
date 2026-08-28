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

s = replace_once(
    s,
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
    'import { useCallback, useEffect, useRef, useState } from "react";',
    "remove-usememo-import",
)
s = replace_once(
    s,
    'const A4_PX = { width: 794, height: 1123, margin: 96 };\n',
    '',
    "remove-a4px",
)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK")
