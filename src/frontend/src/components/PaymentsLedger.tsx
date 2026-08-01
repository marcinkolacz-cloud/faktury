import { useState } from "react";

export function PaymentsLedger({ payments, actor, onChange, canWrite }: { payments: any[]; actor: any; onChange: () => void; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<bigint | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");

  const submit = async () => {
    if (!date || !amount) return;
    await actor.recordAdvancePayment(date, parseFloat(amount), "PLN", note.trim());
    setDate(""); setAmount(""); setNote("");
    setOpen(false);
    onChange();
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditDate(p.date);
    setEditAmount(String(p.amount));
    setEditNote(p.note);
  };

  const saveEdit = async (id: bigint) => {
    await actor.updateAdvancePayment(id, editDate, parseFloat(editAmount), "PLN", editNote.trim());
    setEditingId(null);
    onChange();
  };

  const deletePayment = async (id: bigint) => {
    if (!confirm("Przenieść tę wpłatę do kosza?")) return;
    await actor.trashAdvancePayment(id);
    onChange();
  };

  const sorted = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1));
  const rankMap = new Map<string, number>();
  [...payments].sort((a, b) => Number(a.id - b.id)).forEach((p, i) => rankMap.set(String(p.id), i + 1));

  return (
    <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--text-primary)]">Rejestr wpłat (zaliczki)</h2>
        {canWrite && (
          <button onClick={() => setOpen(!open)} className="px-3 py-1 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium">
            + Wpłata
          </button>
        )}
      </div>
      {open && (
        <div className="flex gap-2 bg-[var(--bg-page)] p-3 rounded border border-[var(--border-color)]">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-[var(--bg-card)] border border-[var(--border-color)] px-2 py-1 rounded text-sm text-[var(--text-primary)]" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Kwota" className="bg-[var(--bg-card)] border border-[var(--border-color)] px-2 py-1 rounded text-sm text-[var(--text-primary)] w-28" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notatka" className="bg-[var(--bg-card)] border border-[var(--border-color)] px-2 py-1 rounded text-sm text-[var(--text-primary)] flex-1" />
          <button onClick={submit} className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm">Dodaj</button>
        </div>
      )}
      <div className="overflow-auto max-h-48">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-[var(--border-color)]">
              <th className="p-1 w-8">Lp.</th>
              <th className="p-1">Data</th>
              <th className="p-1 text-right">Kwota</th>
              <th className="p-1">Notatka</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, idx) =>
              editingId === p.id ? (
                <tr key={String(p.id)} className="border-t border-[var(--border-color-light)] bg-amber-500/10">
                  <td className="p-1 text-gray-400">{rankMap.get(String(p.id)) || idx + 1}</td>
                  <td className="p-1"><input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full" /></td>
                  <td className="p-1"><input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full" /></td>
                  <td className="p-1"><input value={editNote} onChange={(e) => setEditNote(e.target.value)} className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-full" /></td>
                  <td className="p-1 whitespace-nowrap">
                    <button onClick={() => saveEdit(p.id)} className="text-emerald-600 text-xs mr-2">Zapisz</button>
                    <button onClick={() => setEditingId(null)} className="text-gray-500 text-xs">Anuluj</button>
                  </td>
                </tr>
              ) : (
                <tr key={String(p.id)} className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-page)]">
                  <td className="p-1 text-gray-400">{rankMap.get(String(p.id)) || idx + 1}</td>
                  <td className="p-1 font-mono text-[var(--text-secondary)]">{p.date}</td>
                  <td className="p-1 text-right font-mono text-[var(--text-primary)]">{p.amount.toFixed(2)}</td>
                  <td className="p-1 text-gray-500">{p.note}</td>
                  <td className="p-1 whitespace-nowrap">
                    {canWrite && (
                      <>
                        <button onClick={() => startEdit(p)} className="text-cyan-600 text-xs mr-2">Edytuj</button>
                        <button onClick={() => deletePayment(p.id)} className="text-red-500 text-xs">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
