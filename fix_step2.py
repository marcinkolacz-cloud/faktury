import pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")

marker = "  useAuthContext();"
n = src.count(marker)
print("marker wystapien:", n)
if n != 1:
    print("BLAD: nieoczekiwana liczba wystapien, nic nie zmieniam.")
else:
    insert = '''  // Floating, draggable + resizable editor window (opens near-fullscreen
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
''' + marker
    src = src.replace(marker, insert)
    p.write_text(src, encoding="utf-8")
    print("Zapisano.")
