import { useEffect, useState } from "react";

const KIND_LABELS: Record<string, string> = {
  orderMissingDriveFolder: "Zamówienie bez OneDrive",
  contractMissingDriveFolder: "Kontrakt bez OneDrive",
  expenseMissingInvoice: "Wydatek bez faktury",
  ksefInvoicePendingTooLong: "Faktura KSeF czeka >7 dni",
  expenseAmountAnomaly: "Nietypowo wysoka kwota",
};

function kindKey(kind: any): string {
  return Object.keys(kind)[0];
}

export function FlaggedActionsPanel({ actor }: { actor: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!actor) return;
    actor.getFlaggedActions().then((r: any[]) => { setItems(r); setLoading(false); });
  }, [actor]);

  if (loading || dismissed || items.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-amber-800">Zaległe akcje ({items.length})</h2>
        <button onClick={() => setDismissed(true)} className="text-xs text-amber-700 hover:underline">
          Ukryj
        </button>
      </div>
      <ul className="text-sm space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
              {KIND_LABELS[kindKey(it.kind)] ?? kindKey(it.kind)}
            </span>
            <span className="text-amber-900">
              <strong>{it.entityLabel}</strong> — {it.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
