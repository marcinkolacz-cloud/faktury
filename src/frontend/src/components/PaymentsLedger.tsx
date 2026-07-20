import { useState } from "react";

export function PaymentsLedger({ payments, actor, onChange }: { payments: any[]; actor: any; onChange: () => void }) {
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
    if (!confirm("Usunąć tę wpłatę?")) return;
    await actor.deleteAdvancePayment(id);
    onChange();
  };

  const sorted = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Rejestr wpłat (zaliczki)</h2>
        <button onClick={() => setOpen(!open)} className="px-3 py-1 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium">
          + Wpłata
        </button>
      </div>
      {open && (
        <div className="flex gap-2 bg-gray-50 p-3 rounded border border-gray-200">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-white border border-gray-300 px-2 py-1 rounded text-sm text-gray-900" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Kwota" className="bg-white border border-gray-300 px-2 py-1 rounded text-sm text-gray-900 w-28" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notatka" className="bg-white border border-gray-300 px-2 py-1 rounded text-sm text-gray-900 flex-1" />
          <button onClick={submit} className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm">Dodaj</button>
        </div>
      )}
      <div className="overflow-auto max-h-48">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="p-1">Data</th>
              <th className="p-1 text-right">Kwota</th>
              <th className="p-1">Notatka</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) =>
              editingId === p.id ? (
                <tr key={String(p.id)} className="border-t border-gray-100 bg-yellow-50">
                  <td className="p-1"><input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full" /></td>
                  <td className="p-1"><input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full" /></td>
                  <td className="p-1"><input value={editNote} onChange={(e) => setEditNote(e.target.value)} className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full" /></td>
                  <td className="p-1 whitespace-nowrap">
                    <button onClick={() => saveEdit(p.id)} className="text-emerald-600 text-xs mr-2">Zapisz</button>
                    <button onClick={() => setEditingId(null)} className="text-gray-500 text-xs">Anuluj</button>
                  </td>
                </tr>
              ) : (
                <tr key={String(p.id)} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-1 font-mono text-gray-700">{p.date}</td>
                  <td className="p-1 text-right font-mono text-gray-900">{p.amount.toFixed(2)}</td>
                  <td className="p-1 text-gray-500">{p.note}</td>
                  <td className="p-1 whitespace-nowrap">
                    <button onClick={() => startEdit(p)} className="text-cyan-600 text-xs mr-2">Edytuj</button>
                    <button onClick={() => deletePayment(p.id)} className="text-red-500 text-xs">✕</button>
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
