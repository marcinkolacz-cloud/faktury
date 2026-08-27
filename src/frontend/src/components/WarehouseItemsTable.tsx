import { useState } from "react";
import { WarehouseItemRow } from "./WarehouseItemRow";

export function WarehouseItemsTable({ items, categories, projects, movements, actor, onChange, canWrite }: {
  items: any[]; categories: string[]; projects: any[]; movements: any[]; actor: any; onChange: () => void; canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [colFilters, setColFilters] = useState({
    name: "", category: "", model: "", serialNo: "", location: "",
  });
  const setColFilter = (key: string, v: string) => setColFilters((prev) => ({ ...prev, [key]: v }));
  const [bulkText, setBulkText] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm("Przenieść zaznaczone " + selected.size + " pozycje do kosza?")) return;
    for (const id of selected) {
      await actor.trashWarehouseItem(BigInt(id));
    }
    setSelected(new Set());
    onChange();
  };

  const addBulk = async () => {
    const names = bulkText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (names.length === 0) return;
    setSaving(true);
    const existingNames = new Set(items.map((i) => i.name.trim().toLowerCase()));
    let added = 0;
    let skipped = 0;
    const skippedNames: string[] = [];
    for (const name of names) {
      setStatus("Sprawdzam " + (added + skipped + 1) + "/" + names.length + "...");
      if (existingNames.has(name.toLowerCase())) {
        skipped++;
        skippedNames.push(name);
        continue;
      }
      await actor.createWarehouseItem(name, "", "", "", "", "", category.trim(), false, false, false, location.trim(), "");
      existingNames.add(name.toLowerCase());
      added++;
    }
    if (skipped > 0) {
      setStatus("Dodano " + added + ", pominięto " + skipped + " (już istnieją: " + skippedNames.join(", ") + ")");
    } else {
      setStatus("");
      setBulkText("");
      setOpen(false);
    }
    setSaving(false);
    onChange();
  };
  const rankMap = new Map<string, number>();
  [...items].sort((a, b) => Number(a.id - b.id)).forEach((i, idx) => rankMap.set(String(i.id), idx + 1));

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--text-primary)]">Pozycje magazynowe</h2>
        {canWrite && (
          <button onClick={() => setOpen(!open)} className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium">
            + Dodaj pozycje (wiele naraz)
          </button>
        )}
      </div>
      {open && (
        <div className="bg-[var(--bg-page)] border border-[var(--border-color)] rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-500">Wklej nazwy pozycji, każda w nowej linii (np. z faktury)</p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={"Router TP-Link\nKabel HDMI 3m\nZasilacz 12V"}
            className="w-full border border-[var(--border-color)] rounded px-2 py-1.5 text-sm font-mono"
          />
          <div className="flex gap-2">
            <input
              list="warehouse-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Kategoria (np. Elektronika)"
              className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm flex-1"
            />
            <datalist id="warehouse-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Lokalizacja"
              className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm flex-1"
            />
          </div>
          {status && <p className="text-xs text-gray-500">{status}</p>}
          <div className="flex gap-2">
            <button onClick={addBulk} disabled={saving} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm disabled:opacity-50">
              {saving ? "Dodawanie..." : "Dodaj wszystkie"}
            </button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 border border-[var(--border-color)] text-[var(--text-secondary)] rounded text-sm">Anuluj</button>
          </div>
        </div>
      )}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 bg-[var(--accent-text)]/20 border border-[var(--accent-text)] rounded p-2 text-sm">
          <span className="text-[var(--text-primary)]">Zaznaczono: {selected.size}</span>
          <button onClick={bulkDelete} className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs">Usuń</button>
          <button onClick={() => setSelected(new Set())} className="px-2 py-1 border border-[var(--border-color)] rounded text-xs">Anuluj zaznaczenie</button>
        </div>
      )}
      <div className="mobile-scroll-table overflow-auto rounded border border-[var(--border-color)] max-h-[500px]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-page)] sticky top-0">
            <tr className="text-left text-gray-500">
              <th className="p-2 w-8">Lp.</th>
              <th className="p-2 w-8"></th>
              <th className="p-2">Produkt</th>
              <th className="p-2">Kategoria</th>
              <th className="p-2">Model</th>
              <th className="p-2">Serial no.</th>
              <th className="p-2">Link</th>
              <th className="p-2">Lokalizacja</th>
              <th className="p-2 text-center" colSpan={2}>FNPT2 / Trainer</th>
              <th className="p-2 text-right">Ilość</th>
              <th className="p-2"></th>
            </tr>
            <tr className="bg-[var(--bg-card)]">
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"><input value={colFilters.name} onChange={(e) => setColFilter("name", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.category} onChange={(e) => setColFilter("category", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.model} onChange={(e) => setColFilter("model", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.serialNo} onChange={(e) => setColFilter("serialNo", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"></th>
              <th className="p-1"><input value={colFilters.location} onChange={(e) => setColFilter("location", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {items
              .filter((i) =>
                i.name.toLowerCase().includes(colFilters.name.toLowerCase()) &&
                i.category.toLowerCase().includes(colFilters.category.toLowerCase()) &&
                i.model.toLowerCase().includes(colFilters.model.toLowerCase()) &&
                i.serialNo.toLowerCase().includes(colFilters.serialNo.toLowerCase()) &&
                i.location.toLowerCase().includes(colFilters.location.toLowerCase())
              )
              .reverse()
              .map((i, idx) => (
              <WarehouseItemRow key={String(i.id)} rowNumber={rankMap.get(String(i.id)) || idx + 1} item={i} categories={categories} projects={projects} movements={movements} actor={actor} onChange={onChange} canWrite={canWrite} selected={selected.has(String(i.id))} onToggleSelect={() => toggleSelect(String(i.id))} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
