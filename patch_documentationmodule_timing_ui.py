import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 1. import driveTimingSummary
if 'driveTimingSummary' not in src:
    old_import = 'import { syncChapterToDrive, uploadChapterImage, loadChapterContentFromDrive, renameChapterOnDrive } from "../lib/documentationDriveSync";'
    new_import = old_import + '\nimport { driveTimingSummary } from "../lib/driveTiming";'
    assert old_import in src, "marker import documentationDriveSync nie znaleziony"
    src = src.replace(old_import, new_import, 1)

# 2. state
old_state = '  const [paginationError, setPaginationError] = useState<string>("");'
new_state = old_state + '\n  const [driveTimingInfo, setDriveTimingInfo] = useState<string>(""); // TYMCZASOWE - diagnostyka szybkosci ladowania z Drive'
assert old_state in src, "marker paginationError state nie znaleziony"
src = src.replace(old_state, new_state, 1)

# 3. capture timing right after building read-view html
old_build = '''        const html = await buildChapterPreviewHtml(false, false, new Set([active.id]), [active], token);
        if (!cancelled) {
          readViewTokenRef.current = token;
          setReadViewToken(token);
          setReadViewHtml(html);
        }'''
new_build = '''        const html = await buildChapterPreviewHtml(false, false, new Set([active.id]), [active], token);
        if (!cancelled) {
          readViewTokenRef.current = token;
          setReadViewToken(token);
          setReadViewHtml(html);
          setDriveTimingInfo(driveTimingSummary());
        }'''
assert old_build in src, "marker readView build nie znaleziony"
src = src.replace(old_build, new_build, 1)

# 4. render panel
old_render = '''                    {paginationError && (
                      <div className="text-xs text-red-500 font-mono text-center mb-1">BLAD PAGINACJI: {paginationError}</div>
                    )}'''
new_render = '''                    {paginationError && (
                      <div className="text-xs text-red-500 font-mono text-center mb-1">BLAD PAGINACJI: {paginationError}</div>
                    )}
                    {driveTimingInfo && (
                      <div className="text-xs text-blue-500 font-mono text-center mb-1">CZAS LADOWANIA: {driveTimingInfo}</div>
                    )}'''
assert old_render in src, "marker paginationError render nie znaleziony"
src = src.replace(old_render, new_render, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK - patched", path)
