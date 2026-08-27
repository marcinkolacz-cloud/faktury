import { useState } from "react";

export function ProjectsBar({ projects, expenses, actor, onChange, filterProject, setFilterProject, canWrite }: {
  projects: any[]; expenses: any[]; actor: any; onChange: () => void;
  filterProject: string | null; setFilterProject: (v: string | null) => void; canWrite: boolean;
}) {
  const [name, setName] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    await actor.createProject(name.trim());
    setName("");
    onChange();
  };

  const spentByProject = (projectId: bigint) =>
    expenses.filter((e) => e.projectId === projectId).reduce((s: number, e: any) => s + (e.pricePln?.[0] ?? 0), 0);

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <h2 className="font-semibold text-[var(--text-primary)]">Projekty</h2>
      {canWrite && (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nazwa (np. BAS004)"
            className="bg-[var(--bg-card)] border border-[var(--border-color)] px-2 py-1 rounded text-sm text-[var(--text-primary)] flex-1"
          />
          <button onClick={submit} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm">
            Utwórz
          </button>
        </div>
      )}
      <div className="space-y-1 max-h-40 overflow-auto">
        <button
          onClick={() => setFilterProject(null)}
          className={"w-full text-left px-2 py-1 rounded text-sm " + (filterProject === null ? "bg-[var(--accent-light)] text-[var(--accent-hover)]" : "text-gray-500 hover:bg-[var(--bg-page)]")}
        >
          Wszystkie
        </button>
        {projects.map((p) => (
          <button
            key={String(p.id)}
            onClick={() => setFilterProject(p.name)}
            className={"w-full text-left px-2 py-1 rounded text-sm flex justify-between " + (filterProject === p.name ? "bg-[var(--accent-light)] text-[var(--accent-hover)]" : "text-gray-500 hover:bg-[var(--bg-page)]")}
          >
            <span>{p.name}</span>
            <span className="font-mono">{spentByProject(p.id).toFixed(2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
