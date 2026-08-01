import { useState } from "react";
import { createPortal } from "react-dom";
import { DriveFilePicker } from "./DriveFilePicker";
import { DriveThumbnail } from "./DriveThumbnail";
import { renderReadableInvoiceHtml, printInvoiceHtml } from "../lib/ksefInvoicePreview";
import { setKsefActor } from "../lib/ksefConfig";
import { odDownloadFileBlob, setDriveActor } from "../lib/oneDriveConfig";

export function WarehouseItemRow({ rowNumber, item, categories, projects, movements, actor, onChange, canWrite, selected, onToggleSelect }: {
  rowNumber: number; item: any; categories: string[]; projects: any[]; movements: any[]; actor: any; onChange: () => void; canWrite: boolean; selected: boolean; onToggleSelect: () => void;
}) {
  const [readableHtml, setReadableHtml] = useState<string | null>(null);
  const [readableLoading, setReadableLoading] = useState(false);

  const showReadableInvoice = async (ksefNumber: string) => {
    setKsefActor(actor);
    if (ksefNumber.startsWith("MANUAL-")) {
      setDriveActor(actor);
      const details = await actor.getInvoiceDetails(ksefNumber);
      const itemId = details[1]?.[0] || "";
      if (!itemId) {
        alert("Ta faktura nie ma dołączonego dokumentu.");
        return;
      }
      if (itemId.startsWith("http")) {
        window.open(itemId, "_blank");
        return;
      }
      const win = window.open("", "_blank");
      try {
        const blob = await odDownloadFileBlob(itemId);
        const blobUrl = URL.createObjectURL(blob);
        if (win) win.location.href = blobUrl;
      } catch (e: any) {
        if (win) win.close();
        alert("Nie udało się pobrać dokumentu z Dysku: " + String(e?.message || e));
      }
      return;
    }
    setReadableLoading(true);
    setReadableHtml("");
    try {
      const html = await renderReadableInvoiceHtml(ksefNumber);
      setReadableHtml(html);
    } catch (e: any) {
      setReadableHtml("<p>Nie udało się wygenerować podglądu: " + String(e?.message || e) + "</p>");
    }
    setReadableLoading(false);
  };

  const currentAllocation = (projectId: bigint): number => {
    let total = 0;
    for (const m of movements) {
      if (m.itemId !== item.id) continue;
      if (m.projectId?.[0] === undefined || m.projectId[0] !== projectId) continue;
      total += m.movementType.out !== undefined ? m.quantity : -m.quantity;
    }
    return total;
  };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: item.name,
    partDescription: item.partDescription,
    model: item.model,
    link: item.link,
    manufacturer: item.manufacturer,
    serialNo: item.serialNo,
    category: item.category,
    isReplacementPart: item.isReplacementPart,
    appliesFnpt2: item.appliesFnpt2,
    appliesTrainer: item.appliesTrainer,
    location: item.location,
    note: item.note,
  });
  const [quantity, setQuantity] = useState(String(item.currentQuantity));
  const [projectName, setProjectName] = useState("");
  const [moveError, setMoveError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const save = async () => {
    await actor.updateWarehouseItem(
      item.id,
      form.name.trim(), form.partDescription.trim(), form.model.trim(), form.link.trim(),
      form.manufacturer.trim(), form.serialNo.trim(), form.category.trim(),
      form.isReplacementPart, form.appliesFnpt2, form.appliesTrainer,
      form.location.trim(), form.note.trim(),
    );
    if (projectName.trim()) {
      const match = projects.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());
      if (!match) {
        setMoveError("Nie znaleziono projektu o tej nazwie.");
        return;
      }
      setMoveError("");
      const newAllocation = parseFloat(quantity);
      const existingAllocation = currentAllocation(match.id);
      const diff = newAllocation - existingAllocation;
      if (!isNaN(diff) && diff !== 0) {
        const movementType = diff > 0 ? { out: null } : { in: null };
        await actor.recordStockMovement(
          item.id,
          movementType,
          Math.abs(diff),
          [match.id],
          "Edycja",
          new Date().toISOString().slice(0, 10),
          "",
        );
      }
    } else {
      const newQty = parseFloat(quantity);
      const diff = newQty - item.currentQuantity;
      if (!isNaN(diff) && diff !== 0) {
        setMoveError("");
        const movementType = diff > 0 ? { in: null } : { out: null };
        await actor.recordStockMovement(
          item.id,
          movementType,
          Math.abs(diff),
          [],
          "Edycja",
          new Date().toISOString().slice(0, 10),
          "Korekta inwentaryzacyjna",
        );
      }
    }
    setEditing(false);
    onChange();
  };

  const remove = async () => {
    if (!confirm("Przenieść tę pozycję do kosza?")) return;
    await actor.trashWarehouseItem(item.id);
    onChange();
  };

  if (editing) {
    const c = "border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full";
    return (
      <tr className="border-t border-[var(--border-color-light)] bg-amber-500/10">
        <td className="p-1 text-gray-400">{rowNumber}</td>
        <td className="p-1">{canWrite && <input type="checkbox" checked={selected} onChange={onToggleSelect} />}</td>
        <td className="p-1"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={c} /></td>
        <td className="p-1">
          <input list="warehouse-cat-edit" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={c} />
          <datalist id="warehouse-cat-edit">{categories.map((cc) => <option key={cc} value={cc} />)}</datalist>
        </td>
        <td className="p-1"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={c} /></td>
        <td className="p-1"><input value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} className={c} /></td>
        <td className="p-1">
          <input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="Link do zdjęcia/strony" className={c} />
          <button type="button" onClick={() => setPickerOpen(true)} className="text-cyan-600 text-[10px] hover:underline mt-0.5">Wybierz z Dysku</button>
          {pickerOpen && (
            <DriveFilePicker
              actor={actor}
              onClose={() => setPickerOpen(false)}
              onSelect={(fileId) => {
                setForm({ ...form, link: "drive:" + fileId.toString() });
                setPickerOpen(false);
              }}
            />
          )}
        </td>
        <td className="p-1"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={c} /></td>
        <td className="p-1 text-center"><input type="checkbox" checked={form.appliesFnpt2} onChange={(e) => setForm({ ...form, appliesFnpt2: e.target.checked })} /></td>
        <td className="p-1 text-center"><input type="checkbox" checked={form.appliesTrainer} onChange={(e) => setForm({ ...form, appliesTrainer: e.target.checked })} /></td>
        <td className="p-1 text-right">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-20 text-right font-mono"
          />
          <input
            list="edit-row-projects"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Projekt (opcjonalnie)"
            className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full mt-1"
          />
          <datalist id="edit-row-projects">{projects.map((p) => <option key={String(p.id)} value={p.name} />)}</datalist>
        </td>
        <td className="p-1 whitespace-nowrap">
          <button onClick={save} className="text-emerald-600 text-xs mr-2">Zapisz</button>
          <button onClick={() => setEditing(false)} className="text-gray-500 text-xs">Anuluj</button>
          {moveError && <p className="text-red-600 text-xs">{moveError}</p>}
        </td>
      </tr>
    );
  }

  return (
    <>
    <tr className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-page)]">
      <td className="p-2 text-gray-400">{rowNumber}</td>
      <td className="p-2">{canWrite && <input type="checkbox" checked={selected} onChange={onToggleSelect} />}</td>
      <td className="p-2 text-[var(--text-primary)]">{item.name}</td>
      <td className="p-2">
        <span className="text-xs font-mono text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">{item.category}</span>
      </td>
      <td className="p-2 text-gray-500">{item.model}</td>
      <td className="p-2 text-gray-500">{item.serialNo}</td>
      <td className="p-2">
        {item.link.startsWith("drive:") ? (
          <DriveThumbnail link={item.link} actor={actor} />
        ) : item.link ? (
          <a href={item.link} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline">Link</a>
        ) : (
          <span className="text-[var(--text-secondary)]">—</span>
        )}
        {item.category === "Z faktur KSeF" && item.serialNo && (
          <button onClick={() => showReadableInvoice(item.serialNo)} className="text-cyan-600 hover:underline block text-[10px] mt-0.5">📄 Podgląd</button>
        )}
      </td>
      <td className="p-2 text-gray-500">{item.location}</td>
      <td className="p-2 text-center">{item.appliesFnpt2 ? "✓" : ""}</td>
      <td className="p-2 text-center">{item.appliesTrainer ? "✓" : ""}</td>
      <td className={"p-2 text-right font-mono " + (item.currentQuantity <= 0 ? "text-red-500" : "text-[var(--text-primary)]")}>
        {item.currentQuantity}
      </td>
      <td className="p-2 whitespace-nowrap">
        {canWrite && (
          <>
            <button onClick={() => setEditing(true)} className="text-cyan-600 hover:text-cyan-700 text-xs mr-2">Edytuj</button>
            <button onClick={remove} className="text-red-500 hover:text-red-600 text-xs">✕</button>
          </>
        )}
      </td>
    </tr>
    {readableHtml !== null && createPortal(
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setReadableHtml(null)}>
        <div className="bg-white rounded-lg w-full h-full max-w-4xl overflow-auto shadow-lg" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-white">
            <span className="font-medium text-sm text-gray-800">Podgląd faktury</span>
            <div className="flex items-center gap-2">
              <button onClick={() => printInvoiceHtml(readableHtml || "")} className="text-cyan-600 hover:underline text-sm">🖨️ Zapisz jako / Drukuj</button>
              <button onClick={() => setReadableHtml(null)} className="text-gray-600 hover:text-gray-900 text-xl leading-none px-2">✕</button>
            </div>
          </div>
          {readableLoading ? (
            <p className="p-4 text-sm text-gray-500">Generuję podgląd...</p>
          ) : (
            <div className="p-4" dangerouslySetInnerHTML={{ __html: readableHtml }} />
          )}
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
