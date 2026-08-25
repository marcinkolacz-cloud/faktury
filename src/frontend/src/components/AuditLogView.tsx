import { useEffect, useState } from "react";

const ACTION_LABELS: Record<string, string> = {
  invite_redeemed: "Aktywacja konta (kod zaproszenia)",
  role_changed: "Zmiana roli",
  access_revoked: "Odwołanie dostępu",
  modules_changed: "Zmiana modułów",
  ticket_trashed: "Zgłoszenie usunięte (kosz)",
  ticket_restored: "Zgłoszenie przywrócone",
};

function formatTime(ns: bigint): string {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleString("pl-PL");
}

export function AuditLogView({ actor }: { actor: any }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!actor) return;
    actor.listAuditLog().then((r: any[]) => { setEntries(r); setLoading(false); }).catch(() => setLoading(false));
  }, [actor]);

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <h2 className="font-semibold text-[var(--text-primary)]">Log krytycznych zmian</h2>
      {loading ? (
        <p className="text-xs text-[var(--text-muted)]">Ładowanie...</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Brak wpisów.</p>
      ) : (
        <div className="mobile-scroll-table overflow-auto max-h-64">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="p-1">Data</th>
                <th className="p-1">Akcja</th>
                <th className="p-1">Wykonał</th>
                <th className="p-1">Szczegóły</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e.id)} className="border-t border-[var(--border-color-light)]">
                  <td className="p-1 whitespace-nowrap">{formatTime(e.time)}</td>
                  <td className="p-1">{ACTION_LABELS[e.action] || e.action}</td>
                  <td className="p-1 font-mono text-[9px] truncate max-w-[120px]" title={e.byWhom.toString()}>{e.byWhom.toString()}</td>
                  <td className="p-1">{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
