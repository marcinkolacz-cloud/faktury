import { useEffect, useState } from "react";

const KIND_LABELS: Record<string, string> = {
  orderMissingDriveFolder: "Zamówienie bez OneDrive",
  contractMissingDriveFolder: "Kontrakt bez OneDrive",
  expenseMissingInvoice: "Wydatek bez faktury",
  ksefInvoicePendingTooLong: "Faktura KSeF czeka >7 dni",
  expenseAmountAnomaly: "Nietypowo wysoka kwota",
  orderMissingProductionEstimate: "Brak czasu produkcji",
};

function kindKey(kind: any): string {
  return Object.keys(kind)[0];
}

export function FlaggedActionsPanel({ actor }: { actor: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = () => {
    if (!actor) return;
    actor.getFlaggedActions().then((r: any[]) => { setItems(r); setLoading(false); });
  };

  useEffect(reload, [actor]);

  const saveEstimate = async (entityRef: string) => {
    const value = (answers[entityRef] || "").trim();
    if (!value) return;
    setSavingId(entityRef);
    try {
      await actor.setOrderProductionEstimate(parseInt(entityRef), value);
      reload();
    } finally {
      setSavingId(null);
    }
  };

  if (loading || dismissed || items.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-amber-800">Zaległe akcje ({items.length})</h2>
        <button onClick={() => setDismissed(true)} className="text-xs text-amber-700 hover:underline">
          Ukryj
        </button>
      </div>
      <ul className="text-sm space-y-2">
        {items.map((it, i) => {
          const key = kindKey(it.kind);
          const isProductionQuestion = key === "orderMissingProductionEstimate";
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  {KIND_LABELS[key] ?? key}
                </span>
                <span className="text-amber-900">
                  <strong>{it.entityLabel}</strong> — {it.detail}
                </span>
              </div>
              {isProductionQuestion && (
                <div className="flex items-center gap-2 ml-1">
                  <input
                    value={answers[it.entityRef] || ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [it.entityRef]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && saveEstimate(it.entityRef)}
                    placeholder="np. 6-8 tygodni"
                    className="border border-amber-300 rounded px-2 py-1 text-xs w-48 bg-white"
                  />
                  <button
                    onClick={() => saveEstimate(it.entityRef)}
                    disabled={savingId === it.entityRef}
                    className="px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white"
                  >
                    Zapisz
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
