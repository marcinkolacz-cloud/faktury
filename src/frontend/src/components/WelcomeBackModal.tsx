import { useEffect, useState } from "react";

const KIND_LABELS: Record<string, string> = {
  newOrder: "Nowe zamówienie",
  newContract: "Nowy kontrakt",
  newCalendarEvent: "Kalendarz",
  newKsefInvoice: "Nowa faktura KSeF",
  upcomingImportantDate: "Ważna data",
};

function kindKey(kind: any): string {
  return Object.keys(kind)[0];
}

export function WelcomeBackModal({ actor }: { actor: any }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!actor) return;
    actor.getWelcomeSummary().then((r: any[]) => setItems(r)).catch(() => setItems([]));
  }, [actor]);

  const close = async () => {
    setClosed(true);
    try { await actor.markWelcomeSeen(); } catch { /* non-critical */ }
  };

  if (closed || !items || items.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-5 w-full max-w-lg space-y-3 max-h-[80vh] overflow-auto">
        <h2 className="font-semibold text-lg text-[var(--text-primary)]">Co nowego od ostatniego logowania</h2>
        <ul className="space-y-2 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[10px] uppercase tracking-wide text-[var(--accent-hover)] bg-[var(--accent-light)] px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                {KIND_LABELS[kindKey(it.kind)] ?? kindKey(it.kind)}
              </span>
              <span className="text-[var(--text-primary)]">
                <strong>{it.entityLabel}</strong> — {it.detail}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end pt-2">
          <button onClick={close} className="px-4 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded text-sm font-medium">
            Rozumiem
          </button>
        </div>
      </div>
    </div>
  );
}
