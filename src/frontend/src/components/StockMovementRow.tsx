import { useState } from "react";

export function StockMovementRow({ movement, itemName, projects, actor, onChange, canWrite, selected, onToggleSelect }: {
  movement: any; itemName: string; projects: any[]; actor: any; onChange: () => void; canWrite: boolean; selected: boolean; onToggleSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const currentProjectName = movement.projectId?.[0] !== undefined
    ? (projects.find((p) => p.id === movement.projectId[0])?.name ?? "")
    : "";
  const [quantity, setQuantity] = useState(String(movement.quantity));
  const [projectName, setProjectName] = useState(currentProjectName);
  const [performedBy, setPerformedBy] = useState(movement.performedBy);
  const [date, setDate] = useState(movement.date);
  const [error, setError] = useState("");

  const isOut = movement.movementType.out !== undefined;

  const save = async () => {
    let projectId: any = [];
    if (isOut) {
      const match = projects.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());
      if (!match) { setError("Nie znaleziono projektu."); return; }
      projectId = [match.id];
    }
    setError("");
    await actor.updateStockMovement(movement.id, parseFloat(quantity), projectId, performedBy.trim(), date.trim(), movement.note);
    setEditing(false);
    onChange();
  };

  const remove = async () => {
    if (!confirm("Usunąć ten ruch? Stan magazynowy zostanie odpowiednio skorygowany.")) return;
    await actor.deleteStockMovement(movement.id);
    onChange();
  };

  if (editing) {
    const c = "border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full";
    return (
      <tr className="border-t border-[var(--border-color-light)] bg-amber-500/10">
        <td className="p-1">{canWrite && <input type="checkbox" checked={selected} onChange={onToggleSelect} />}</td>
        <td className="p-2"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={c} /></td>
        <td className="p-2 text-[var(--text-primary)]">{itemName}</td>
        <td className="p-2">
          <span className={"text-xs px-1.5 py-0.5 rounded " + (isOut ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
            {isOut ? "Wydanie" : "Przyjęcie"}
          </span>
        </td>
        <td className="p-2 text-right"><input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={c} /></td>
        <td className="p-2">
          <input value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} className={c} />
          {isOut && <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Projekt" className={c + " mt-1"} />}
        </td>
        <td className="p-2 whitespace-nowrap">
          <button onClick={save} className="text-emerald-600 text-xs mr-2">Zapisz</button>
          <button onClick={() => setEditing(false)} className="text-gray-500 text-xs">Anuluj</button>
          {error && <p className="text-red-600 text-xs">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-page)]">
      <td className="p-2">{canWrite && <input type="checkbox" checked={selected} onChange={onToggleSelect} />}</td>
      <td className="p-2 font-mono text-gray-500">{movement.date}</td>
      <td className="p-2 text-[var(--text-primary)]">{itemName}</td>
      <td className="p-2">
        <span className={"text-xs px-1.5 py-0.5 rounded " + (isOut ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
          {isOut ? "Wydanie" : "Przyjęcie"}
        </span>
      </td>
      <td className="p-2 text-right font-mono">{movement.quantity}</td>
      <td className="p-2">
        {currentProjectName ? (
          <span className="text-xs font-mono text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">{currentProjectName}</span>
        ) : (
          <span className="text-[var(--text-secondary)]">—</span>
        )}
      </td>
      <td className="p-2 text-gray-500">{movement.performedBy}</td>
      <td className="p-2 whitespace-nowrap">
        {canWrite && (
          <>
            <button onClick={() => setEditing(true)} className="text-cyan-600 hover:text-cyan-700 text-xs mr-2">Edytuj</button>
            <button onClick={remove} className="text-red-500 hover:text-red-600 text-xs">✕</button>
          </>
        )}
      </td>
    </tr>
  );
}
