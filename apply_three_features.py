import sys, pathlib

path = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = path.read_text(encoding="utf-8")

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

# KROK A: pageMarkers state + recompute logic + effect (inserted after editorRef)
oldA = '  const editorRef = useRef<HTMLDivElement | null>(null);\n'
newA = '''  const editorRef = useRef<HTMLDivElement | null>(null);
  const [pageMarkers, setPageMarkers] = useState<number[]>([]);

  // Visual guide only: shows roughly where a physical A4 page would end,
  // using the same content-height budget as the print preview/PDF engine.
  // Read-only measurement (getBoundingClientRect) - never mutates the
  // editable DOM, unlike the preview's hoistPageBreaks (which is safe
  // there only because it operates on a disposable, hidden clone).
  const recomputePageMarkers = () => {
    const content = editorRef.current;
    if (!content || !editMode) { setPageMarkers([]); return; }
    const outer = content.parentElement;
    if (!outer) { setPageMarkers([]); return; }
    const CONTENT_H_MM = 297 - 37.5 - 12.7;
    const MM_TO_PX = 96 / 25.4;
    const INNER_PAD_PX = 32;
    const PAGE_H_BASE = Math.round(CONTENT_H_MM * MM_TO_PX) - INNER_PAD_PX * 2;
    const scale = zoomLevel / 100;
    const PAGE_H = PAGE_H_BASE * scale;
    const outerTop = outer.getBoundingClientRect().top;
    const markers: number[] = [];
    let cumulative = 0;
    Array.prototype.slice.call(content.children).forEach((child: HTMLElement) => {
      const h = child.getBoundingClientRect().height;
      if (cumulative > 0 && cumulative + h > PAGE_H) {
        markers.push((child.getBoundingClientRect().top - outerTop) / scale);
        cumulative = 0;
      }
      cumulative += h;
    });
    Array.prototype.slice.call(content.querySelectorAll(`.${PAGE_BREAK_CLASS}`)).forEach((m: HTMLElement) => {
      markers.push((m.getBoundingClientRect().top - outerTop) / scale);
    });
    setPageMarkers(markers);
  };

  useEffect(() => {
    const content = editorRef.current;
    if (!content || !editMode) { setPageMarkers([]); return; }
    let raf = 0;
    const scheduleRecompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recomputePageMarkers);
    };
    scheduleRecompute();
    const observer = new MutationObserver(scheduleRecompute);
    observer.observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
    content.addEventListener("input", scheduleRecompute);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      content.removeEventListener("input", scheduleRecompute);
    };
  }, [editMode, zoomLevel]);
'''
src = rep(src, oldA, newA, "KROKA pageMarkers state+effect")

# KROK B: fullscreen edit mode
oldB = '<div className="flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]">'
newB = '<div className={editMode ? "fixed inset-0 z-40 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]"}>'
src = rep(src, oldB, newB, "KROKB fullscreen edit")

# KROK C: page marker rendering after editor content div
oldC = '''                      className="p-8 text-[15px] leading-relaxed outline-none"
                      style={{ maxWidth: 900, margin: "0 auto", width: "100%", ["--h1-offset" as any]: h1Offset }}
                    />
                    </div>'''
newC = '''                      className="p-8 text-[15px] leading-relaxed outline-none"
                      style={{ maxWidth: 900, margin: "0 auto", width: "100%", ["--h1-offset" as any]: h1Offset }}
                    />
                    {pageMarkers.map((y, i) => (
                      <div
                        key={i}
                        className="absolute left-0 right-0 h-[5px] bg-[#888] pointer-events-none select-none"
                        style={{ top: y }}
                        title="Koniec fizycznej strony A4"
                      />
                    ))}
                    </div>'''
src = rep(src, oldC, newC, "KROKC page markers render")

# KROK D: undock button in print preview
oldD = '''              <button onClick={refreshPrintPreview} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white">
                Odswiez
              </button>
              <button onClick={() => setShowPrintPreview(false)} className="text-xs px-3 py-1.5 rounded border border-[#666] text-[#e0e0e0]">
                Zamknij
              </button>'''
newD = '''              <button onClick={refreshPrintPreview} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white">
                Odswiez
              </button>
              <button
                onClick={() => {
                  const w = window.open("", "_blank", "width=1000,height=900");
                  if (w) { w.document.write(previewHtml); w.document.close(); }
                }}
                className="text-xs px-3 py-1.5 rounded border border-[#666] text-[#e0e0e0]"
                title="Otwiera podglad w osobnym oknie przegladarki - mozna je przeciagnac poza glowne okno, np. na drugi monitor"
              >
                ⇱ Otworz w oknie
              </button>
              <button onClick={() => setShowPrintPreview(false)} className="text-xs px-3 py-1.5 rounded border border-[#666] text-[#e0e0e0]">
                Zamknij
              </button>'''
src = rep(src, oldD, newD, "KROKD undock button")

path.write_text(src, encoding="utf-8")
print("OK - wszystkie 4 kroki zapisane.")
