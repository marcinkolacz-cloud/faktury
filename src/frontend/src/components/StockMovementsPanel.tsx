import { useState } from "react";
import { StockMovementRow } from "./StockMovementRow";

export function StockMovementsPanel({ items, movements, projects, actor, onChange, canWrite }: {
  items: any[]; movements: any[]; projects: any[]; actor: any; onChange: () => void; canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedMovements, setSelectedMovements] = useState<Set<string>>(new Set());

  const toggleMovementSelect = (id: string) => {
    setSelectedMovements((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const bulkDeleteMovements = async () => {
    if (selectedMovements.size === 0) return;
    if (!confirm("Przenieść zaznaczone " + selectedMovements.size + " ruchy do kosza?")) return;
    for (const id of selectedMovements) {
      await actor.trashStockMovement(BigInt(id));
    }
    setSelectedMovements(new Set());
    onChange();
  };
  const [movementFilters, setMovementFilters] = useState({ item: "", project: "", who: "" });
  const setMovementFilter = (key: string, v: string) => setMovementFilters((prev) => ({ ...prev, [key]: v }));
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>({});
  const [itemFilter, setItemFilter] = useState("");

  const [projectName, setProjectName] = useState("");
  const [performedBy, setPerformedBy] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleItem = (id: string) => {
    setSelectedQuantities((prev) => {
      const next = { ...prev };
      if (id in next) { delete next[id]; } else { next[id] = "1"; }
      return next;
    });
  };

  const setItemQuantity = (id: string, qty: string) => {
    setSelectedQuantities((prev) => ({ ...prev, [id]: qty }));
  };

  const submit = async () => {
    const selectedIds = Object.keys(selectedQuantities).filter((id) => parseFloat(selectedQuantities[id]) > 0);
    if (selectedIds.length === 0) {
      setError("Zaznacz przynajmniej jedną pozycję z ilością większą od zera.");
      return;
    }
    let projectId: any = [];
    const match = projects.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());
    if (!match) {
      setError("Nie znaleziono projektu o tej nazwie.");
      return;
    }
    projectId = [match.id];
    setError("");
    setSaving(true);
    const movementType = { out: null };
    for (const id of selectedIds) {
      await actor.recordStockMovement(
        BigInt(id),
        movementType,
        parseFloat(selectedQuantities[id]),
        projectId,
        performedBy.trim(),
        date.trim(),
        "",
      );
    }
    setSaving(false);
    setSelectedQuantities({}); setProjectName(""); setPerformedBy(""); setDate(""); setItemFilter("");
    setOpen(false);
    onChange();
  };

  const itemName = (id: bigint) => items.find((i) => i.id === id)?.name ?? "?";

  const movementProjectName = (m: any) => {
    if (m.projectId?.[0] === undefined) return "";
    return projects.find((p) => p.id === m.projectId[0])?.name ?? "";
  };

  const filteredMovements = movements.filter((m) =>
    itemName(m.itemId).toLowerCase().includes(movementFilters.item.toLowerCase()) &&
    movementProjectName(m).toLowerCase().includes(movementFilters.project.toLowerCase()) &&
    m.performedBy.toLowerCase().includes(movementFilters.who.toLowerCase())
  );
  const rankMap = new Map<string, number>();
  [...filteredMovements].sort((a, b) => Number(a.id - b.id)).forEach((m, i) => rankMap.set(String(m.id), i + 1));

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--text-primary)]">Ruchy magazynowe</h2>
        {canWrite && (
          <button onClick={() => setOpen(!open)} className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium">
            + Zarejestruj ruch
          </button>
        )}
      </div>
      {open && (
        <div className="bg-[var(--bg-page)] border border-[var(--border-color)] rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input list="movement-projects" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Projekt (np. BAS004)" className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm" />
            <datalist id="movement-projects">
              {projects.map((p) => <option key={String(p.id)} value={p.name} />)}
            </datalist>
            <input value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Kto wykonał" className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm" />
            <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm" />
          </div>
          <input
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            placeholder="Szukaj pozycji do zaznaczenia..."
            className="w-full border border-[var(--border-color)] rounded px-2 py-1.5 text-sm"
          />
          <div className="border border-[var(--border-color)] rounded max-h-64 overflow-auto bg-[var(--bg-card)]">
            {items.filter((i) => i.name.toLowerCase().includes(itemFilter.toLowerCase())).map((i) => {
              const idStr = String(i.id);
              const isSelected = idStr in selectedQuantities;
              return (
                <div key={idStr} className="flex items-center gap-2 p-2 border-b border-[var(--border-color-light)] text-sm">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleItem(idStr)} />
                  <span className="flex-1 text-[var(--text-primary)]">{i.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">(stan: {i.currentQuantity})</span>
                  {isSelected && (
                    <input
                      type="number"
                      value={selectedQuantities[idStr]}
                      onChange={(e) => setItemQuantity(idStr, e.target.value)}
                      className="w-20 border border-[var(--border-color)] rounded px-2 py-1 text-xs"
                    />
                  )}
                </div>
              );
            })}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm disabled:opacity-50">
              {saving ? "Zapisywanie..." : "Zapisz"}
            </button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 border border-[var(--border-color)] text-[var(--text-secondary)] rounded text-sm">Anuluj</button>
          </div>
        </div>
      )}
      {selectedMovements.size > 0 && (
        <div className="flex items-center gap-2 bg-cyan-950/20 border border-cyan-800 rounded p-2 text-sm">
          <span className="text-[var(--text-primary)]">Zaznaczono: {selectedMovements.size}</span>
          <button onClick={bulkDeleteMovements} className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs">Usuń</button>
          <button onClick={() => setSelectedMovements(new Set())} className="px-2 py-1 border border-[var(--border-color)] rounded text-xs">Anuluj zaznaczenie</button>
        </div>
      )}
      <div className="overflow-auto rounded border border-[var(--border-color)] max-h-96">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-page)] sticky top-0">
            <tr className="text-left text-gray-500">
              <th className="p-2 w-8">Lp.</th>
              <th className="p-2 w-8"></th>
              <th className="p-2">Data</th>
              <th className="p-2">Pozycja</th>
              <th className="p-2">Typ</th>
              <th className="p-2 text-right">Ilość</th>
              <th className="p-2">Projekt</th>
              <th className="p-2">Kto</th>
              <th className="p-2"></th>
            </tr>
            <tr className="bg-[var(--bg-card)]">
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"><input value={movementFilters.item} onChange={(e) => setMovementFilter("item", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"><input value={movementFilters.project} onChange={(e) => setMovementFilter("project", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={movementFilters.who} onChange={(e) => setMovementFilter("who", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {[...filteredMovements].reverse().map((m, idx) => (
              <StockMovementRow
                key={String(m.id)}
                rowNumber={rankMap.get(String(m.id)) || idx + 1}
                movement={m}
                itemName={itemName(m.itemId)}
                projects={projects}
                actor={actor}
                onChange={onChange}
                canWrite={canWrite}
                selected={selectedMovements.has(String(m.id))}
                onToggleSelect={() => toggleMovementSelect(String(m.id))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
