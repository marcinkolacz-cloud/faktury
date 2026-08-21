import pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")

old_a = '<div className={editMode ? "fixed inset-0 z-40 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]"}>'
new_a = '''<div
              className={editMode ? "fixed z-40 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl rounded-lg border border-[var(--border-color)] overflow-hidden relative" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] relative"}
              style={editMode ? { left: editWinRect.x, top: editWinRect.y, width: editWinRect.width, height: editWinRect.height } : undefined}
            >'''
n_a = src.count(old_a)
print("A wystapien:", n_a)
if n_a == 1:
    src = src.replace(old_a, new_a)

old_b = '<div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)] flex-wrap bg-[var(--bg-hover)]">'
new_b = '''<div
                    className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)] flex-wrap bg-[var(--bg-hover)]"
                    onMouseDown={editMode ? onEditWinDragStart : undefined}
                    style={editMode ? { cursor: "move" } : undefined}
                  >'''
n_b = src.count(old_b)
print("B wystapien:", n_b)
if n_b == 1:
    src = src.replace(old_b, new_b)

p.write_text(src, encoding="utf-8")
print("Zapisano.")
