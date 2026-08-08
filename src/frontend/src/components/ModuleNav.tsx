import { useEffect, useState } from "react";

export function ModuleNav({ current, onNavigate, actor }: { current: string; onNavigate: (m: string) => void; actor: any }) {
  const [allowedModules, setAllowedModules] = useState<string[]>([]);

  useEffect(() => {
    if (!actor) return;
    actor.getMyModules().then(setAllowedModules);
  }, [actor]);

  const tabs = [
    { id: "invoices", label: "Rejestr Faktur" },
    { id: "warehouse", label: "Magazyn" },
    { id: "tickets", label: "Zgłoszenia" },
    { id: "ksef", label: "KSeF" },
    { id: "emailSubscribers", label: "Powiadomienia" },
    { id: "devices", label: "Urządzenia" },
  ].filter((t) => allowedModules.includes(t.id));

  return (
    <div className="flex gap-2 flex-wrap">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onNavigate(t.id)}
          className={
            "px-3 py-1.5 text-sm rounded font-medium transition-colors " +
            (current === t.id
              ? "bg-cyan-600 text-white"
              : "border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)]")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
