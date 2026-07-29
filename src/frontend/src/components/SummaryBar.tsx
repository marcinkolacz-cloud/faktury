export function SummaryBar({ totalReceived, totalSpent }: { totalReceived: number; totalSpent: number }) {
  const remaining = totalReceived - totalSpent;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm">
        <p className="text-gray-500 text-xs uppercase tracking-wide">Otrzymano razem</p>
        <p className="font-mono font-bold text-2xl text-[var(--text-primary)] mt-1">{totalReceived.toFixed(2)} PLN</p>
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm">
        <p className="text-gray-500 text-xs uppercase tracking-wide">Wydano razem</p>
        <p className="font-mono font-bold text-2xl text-[var(--text-primary)] mt-1">{totalSpent.toFixed(2)} PLN</p>
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm">
        <p className="text-gray-500 text-xs uppercase tracking-wide">Pozostało</p>
        <p className={"font-mono font-bold text-2xl mt-1 " + (remaining < 0 ? "text-red-600" : "text-emerald-600")}>
          {remaining.toFixed(2)} PLN
        </p>
      </div>
    </div>
  );
}
