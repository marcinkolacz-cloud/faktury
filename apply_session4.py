import sys, pathlib

path = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = path.read_text(encoding="utf-8")

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

# KROK 1: previewGridView state
old1 = '  const [showPrintPreview, setShowPrintPreview] = useState(false);\n'
new1 = '  const [showPrintPreview, setShowPrintPreview] = useState(false);\n  const [previewGridView, setPreviewGridView] = useState(false);\n'
n1 = src.count(old1)
if n1 == 0:
    print("INFO: KROK1 juz zastosowany lub tekst inny - pomijam.")
else:
    src = rep(src, old1, new1, "KROK1 previewGridView state")

# KROK 2: editWinRect + drag + resize logic (inserted right after onPreviewDragStart function)
marker2 = '''    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useAuthContext();'''
if "editWinRect" not in src:
    old2 = marker2
    new2 = '''    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Floating, draggable + resizable editor window (opens near-fullscreen
  // by default) - replaces the old fixed inset-0 fullscreen overlay so the
  // person can shrink/move it instead of always being locked to 100%.
  const [editWinRect, setEditWinRect] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth * 0.02)),
    y: Math.max(20, Math.round(window.innerHeight * 0.03)),
    width: Math.round(window.innerWidth * 0.96),
    height: Math.round(window.innerHeight * 0.94),
  }));
  const editDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onEditWinDragStart = (e: React.MouseEvent) => {
    editDragRef.current = { startX: e.clientX, startY: e.clientY, origX: editWinRect.x, origY: editWinRect.y };
    const onMove = (ev: MouseEvent) => {
      if (!editDragRef.current) return;
      const { startX, startY, origX, origY } = editDragRef.current;
      setEditWinRect((r) => ({ ...r, x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) }));
    };
    const onUp = () => {
      editDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const editResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const onEditWinResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    editResizeRef.current = { startX: e.clientX, startY: e.clientY, origW: editWinRect.width, origH: editWinRect.height };
    const onMove = (ev: MouseEvent) => {
      if (!editResizeRef.current) return;
      const { startX, startY, origW, origH } = editResizeRef.current;
      setEditWinRect((r) => ({
        ...r,
        width: Math.max(400, origW + (ev.clientX - startX)),
        height: Math.max(300, origH + (ev.clientY - startY)),
      }));
    };
    const onUp = () => {
      editResizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useAuthContext();'''
    src = rep(src, old2, new2, "KROK2 editWinRect drag+resize")
else:
    print("INFO: KROK2 juz zastosowany - pomijam.")

# KROK 3: buildChapterPreviewHtml signature - add gridView param
for old3, new3 in [
    ("const buildChapterPreviewHtml = async (forPrint: boolean = false): Promise<string> => {",
     "const buildChapterPreviewHtml = async (forPrint: boolean = false, gridView: boolean = false): Promise<string> => {"),
    ("const buildChapterPreviewHtml = (forPrint: boolean = false): string => {",
     "const buildChapterPreviewHtml = (forPrint: boolean = false, gridView: boolean = false): string => {"),
]:
    if src.count(old3) == 1:
        src = src.replace(old3, new3)
        break
else:
    if "gridView: boolean = false" not in src:
        print("BLAD: KROK3 sygnatura buildChapterPreviewHtml nie znaleziona - nic nie zmieniam.")
        sys.exit(1)
    else:
        print("INFO: KROK3 juz zastosowany - pomijam.")

# KROK 4: CSS for grid view
old4 = '        .sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;box-shadow:0 0 8px rgba(0,0,0,0.4);box-sizing:border-box;padding:3.75cm 1.27cm 1.27cm 1.27cm;position:relative;}\n'
new4 = '''        .sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;box-shadow:0 0 8px rgba(0,0,0,0.4);box-sizing:border-box;padding:3.75cm 1.27cm 1.27cm 1.27cm;position:relative;}
        #pages.pages-grid{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:center;gap:16px;}
        #pages.pages-grid .sheet{margin:0;}
'''
if "pages-grid" not in src:
    src = rep(src, old4, new4, "KROK4 grid CSS")
else:
    print("INFO: KROK4 juz zastosowany - pomijam.")

# KROK 5: apply class on #pages div
old5 = '      <div id="pages"></div>\n'
new5 = '      <div id="pages" class="${gridView ? "pages-grid" : ""}"></div>\n'
n5 = src.count(old5)
if n5 == 1:
    src = rep(src, old5, new5, "KROK5 pages div class")
else:
    print("INFO: KROK5 juz zastosowany lub nie pasuje - pomijam.")

# KROK 6: openPrintPreview/refreshPrintPreview pass gridView + toggleGridView fn
old6 = '''  const openPrintPreview = async () => {
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml());
    setShowPrintPreview(true);
  };
  const refreshPrintPreview = async () => {
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml());
  };'''
new6 = '''  const openPrintPreview = async () => {
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml(false, previewGridView));
    setShowPrintPreview(true);
  };
  const refreshPrintPreview = async () => {
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml(false, previewGridView));
  };
  const toggleGridView = async () => {
    const next = !previewGridView;
    setPreviewGridView(next);
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml(false, next));
  };'''
if "toggleGridView" not in src:
    src = rep(src, old6, new6, "KROK6 open/refresh + toggleGridView")
else:
    print("INFO: KROK6 juz zastosowany - pomijam.")

# KROK 7: editor panel outer div -> floating resizable window
old7 = '''            <div className={editMode ? "fixed inset-0 z-40 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]"}>
              <style>{COUNTER_CSS}</style>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onImageSelected} />
              {!active ? (
                <div className="p-8 text-sm text-[var(--text-muted)]">
                  {chapters.length === 0 ? "Brak rozdziałów — dodaj pierwszy w panelu po lewej." : "Wybierz rozdział z listy."}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)] flex-wrap bg-[var(--bg-hover)]">'''
new7 = '''            <div
              className={editMode ? "fixed z-40 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl rounded-lg border border-[var(--border-color)] overflow-hidden relative" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] relative"}
              style={editMode ? { left: editWinRect.x, top: editWinRect.y, width: editWinRect.width, height: editWinRect.height } : undefined}
            >
              <style>{COUNTER_CSS}</style>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onImageSelected} />
              {!active ? (
                <div className="p-8 text-sm text-[var(--text-muted)]">
                  {chapters.length === 0 ? "Brak rozdziałów — dodaj pierwszy w panelu po lewej." : "Wybierz rozdział z listy."}
                </div>
              ) : (
                <>
                  <div
                    className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)] flex-wrap bg-[var(--bg-hover)]"
                    onMouseDown={editMode ? onEditWinDragStart : undefined}
                    style={editMode ? { cursor: "move" } : undefined}
                  >'''
if "editWinRect.x" not in src.split("style={editMode")[0] if "style={editMode" in src else True:
    pass
if "z-40 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl" not in src:
    src = rep(src, old7, new7, "KROK7 editor panel floating window")
else:
    print("INFO: KROK7 juz zastosowany - pomijam.")

# KROK 8: resize handle before closing div
old8 = '''                </>
              )}
            </div>
          </div>
        )}
      </div>
'''
new8 = '''                </>
              )}
              {editMode && (
                <div
                  onMouseDown={onEditWinResizeStart}
                  title="Przeciągnij, żeby zmienić rozmiar okna"
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-60 hover:opacity-100"
                  style={{ background: "linear-gradient(135deg, transparent 50%, var(--text-secondary) 50%)" }}
                />
              )}
            </div>
          </div>
        )}
      </div>
'''
if "Przeciagnij, zeby zmienic rozmiar okna" not in src and "Przeciągnij, żeby zmienić rozmiar okna" not in src:
    src = rep(src, old8, new8, "KROK8 resize handle")
else:
    print("INFO: KROK8 juz zastosowany - pomijam.")

# KROK 9: grid view toggle button in preview modal
old9 = '''              <button onClick={refreshPrintPreview} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white">
                Odswiez
              </button>
              <button
                onClick={() => {
                  const w = window.open("", "_blank", "width=1000,height=900");'''
new9 = '''              <button onClick={refreshPrintPreview} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white">
                Odswiez
              </button>
              <button
                onClick={toggleGridView}
                className={`text-xs px-3 py-1.5 rounded border ${previewGridView ? "bg-cyan-600 text-white border-cyan-600" : "border-[#666] text-[#e0e0e0]"}`}
                title="Pokazuje kilka stron obok siebie zamiast jednej pod drugą (jak podglad wielostronicowy w Wordzie)"
              >
                ⊞ Kilka stron obok
              </button>
              <button
                onClick={() => {
                  const w = window.open("", "_blank", "width=1000,height=900");'''
if "toggleGridView} className" not in src.replace("onClick={toggleGridView}", "onClick={toggleGridView} "):
    pass
if "Kilka stron obok" not in src:
    src = rep(src, old9, new9, "KROK9 grid toggle button")
else:
    print("INFO: KROK9 juz zastosowany - pomijam.")

path.write_text(src, encoding="utf-8")
print("OK - wszystkie kroki sesji zapisane.")
