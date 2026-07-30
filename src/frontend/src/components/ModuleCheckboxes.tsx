import { useEffect, useState } from "react";

const ALL_MODULES = [
  { id: "invoices", label: "Faktury" },
  { id: "projects", label: "Projekty" },
  { id: "warehouse", label: "Magazyn" },
  { id: "tickets", label: "Zgłoszenia" },
  { id: "ksef", label: "KSeF" },
];

export function ModuleCheckboxes({ principal, actor }: { principal: any; actor: any }) {
  const [modules, setModules] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    actor.getUserModules(principal).then((m: string[]) => {
      setModules(m);
      setLoaded(true);
    });
  }, [principal]);

  const toggle = async (id: string) => {
    const next = modules.includes(id) ? modules.filter((m) => m !== id) : [...modules, id];
    setModules(next);
    await actor.setUserModules(principal, next);
  };

  if (!loaded) return <span className="text-[var(--text-secondary)] text-xs">...</span>;

  return (
    <div className="flex gap-2 flex-wrap">
      {ALL_MODULES.map((m) => (
        <label key={m.id} className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <input type="checkbox" checked={modules.includes(m.id)} onChange={() => toggle(m.id)} />
          {m.label}
        </label>
      ))}
    </div>
  );
}
