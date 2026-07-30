import { useState } from "react";

export function ExpenseRow({ rowNumber, expense, projectName, projects, actor, onChange, onToggle, canWrite, ksefSent, onToggleKsef }: {
  rowNumber: number; expense: any; projectName: string; projects: any[]; actor: any; onChange: () => void; onToggle: (id: bigint, method: string) => void; canWrite: boolean;
  ksefSent: boolean; onToggleKsef: (id: bigint) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    productService: expense.productService,
    supplier: expense.supplier,
    projectName: projectName,
    orderDate: expense.orderDate,
    pricePln: String(expense.pricePln?.[0] ?? ""),
    priceNet: String(expense.priceNet?.[0] ?? ""),
    invoiceNumber: expense.invoiceNumber,
    paidBy: expense.paidBy,
    note: expense.note,
  });

  const toggle = (method: string) => onToggle(expense.id, method);

  const deleteRow = async () => {
    if (!confirm("Usunąć ten wpis?")) return;
    await actor.deleteExpense(expense.id);
    onChange();
  };

  const saveEdit = async () => {
    const match = projects.find((p) => p.name.toLowerCase() === form.projectName.trim().toLowerCase());
    const projectId = match ? match.id : (await actor.createProject(form.projectName.trim()));
    await actor.updateExpense(
      expense.id,
      projectId,
      form.productService.trim(),
      form.supplier.trim(),
      "",
      [],
      [],
      [],
      form.pricePln ? [parseFloat(form.pricePln)] : [],
      form.priceNet ? [parseFloat(form.priceNet)] : [],
      form.orderDate.trim(),
      form.paidBy.trim(),
      form.invoiceNumber.trim(),
      "",
      form.note.trim(),
    );
    setEditing(false);
    onChange();
  };

  const missingPrice = !(expense.pricePln?.[0] > 0);
  const missingDate = !expense.orderDate;
  const hasIssue = missingPrice || missingDate;

  if (editing) {
    const c = "border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full";
    return (
      <tr className="border-t border-[var(--border-color-light)] bg-amber-500/10">
        <td className="p-1 text-gray-400">{rowNumber}</td>
        <td className="p-1"><input value={form.productService} onChange={(e) => setForm({ ...form, productService: e.target.value })} className={c} /></td>
        <td className="p-1"><input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={c} /></td>
        <td className="p-1"><input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} className={c} /></td>
        <td className="p-1"><input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} className={c} /></td>
        <td className="p-1"><input type="number" value={form.pricePln} onChange={(e) => setForm({ ...form, pricePln: e.target.value })} className={c} /></td>
        <td className="p-1"><input type="number" value={form.priceNet} onChange={(e) => setForm({ ...form, priceNet: e.target.value })} className={c} /></td>
        <td className="p-1"><input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className={c} /></td>
        <td className="p-1"><input value={form.paidBy} onChange={(e) => setForm({ ...form, paidBy: e.target.value })} className={c} /></td>
        <td className="p-1"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={c} /></td>
        <td colSpan={3} className="p-1"></td>
        <td className="p-1 whitespace-nowrap">
          <button onClick={saveEdit} className="text-emerald-600 text-xs mr-2">Zapisz</button>
          <button onClick={() => setEditing(false)} className="text-gray-500 text-xs">Anuluj</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={"border-t border-[var(--border-color-light)] hover:bg-[var(--bg-page)] " + (hasIssue ? "bg-red-500/10" : "")}>
      <td className="p-2 text-gray-400">{rowNumber}</td>
      <td className="p-2 text-[var(--text-primary)]">{expense.productService}</td>
      <td className="p-2 text-[var(--text-muted)]">{expense.supplier}</td>
      <td className="p-2">
        <span className="text-xs font-mono text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">{projectName}</span>
      </td>
      <td className={"p-2 font-mono " + (missingDate ? "text-red-600 font-semibold" : "text-gray-500")}>
        {expense.orderDate || "brak daty"}
      </td>
      <td className={"p-2 text-right font-mono " + (missingPrice ? "text-red-600 font-semibold" : "text-[var(--text-primary)]")}>
        {missingPrice ? "brak ceny" : (expense.pricePln?.[0] ?? 0).toFixed(2)}
      </td>
      <td className="p-2 text-right font-mono text-gray-500">{(expense.priceNet?.[0] ?? 0).toFixed(2)}</td>
      <td className="p-2 text-[var(--text-muted)]">{expense.invoiceNumber}</td>
      <td className="p-2 text-[var(--text-muted)]">{expense.paidBy}</td>
      <td className="p-2 text-gray-500">{expense.note}</td>
      <td className="p-2 text-center">
        <input type="checkbox" checked={expense.paid} onChange={() => canWrite && toggle("togglePaid")} disabled={!canWrite} className="accent-cyan-600" />
      </td>
      <td className="p-2 text-center">
        <input type="checkbox" checked={ksefSent} onChange={() => canWrite && onToggleKsef(expense.id)} disabled={!canWrite} className="accent-cyan-600" />
      </td>
      <td className="p-2 text-center">
        <input type="checkbox" checked={expense.hasInvoice} onChange={() => canWrite && toggle("toggleHasInvoice")} disabled={!canWrite} className="accent-cyan-600" />
      </td>
      <td className="p-2 text-center">
        <input type="checkbox" checked={expense.confirmed} onChange={() => canWrite && toggle("toggleConfirmed")} disabled={!canWrite} className="accent-cyan-600" />
      </td>
      <td className="p-2 whitespace-nowrap">
        {canWrite && (
          <>
            <button onClick={() => setEditing(true)} className="text-cyan-600 hover:text-cyan-700 text-xs mr-2">Edytuj</button>
            <button onClick={deleteRow} className="text-red-500 hover:text-red-600 text-xs">✕</button>
          </>
        )}
      </td>
    </tr>
  );
}
