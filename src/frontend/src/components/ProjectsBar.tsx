import { useState } from "react";

export function ProjectsBar({ projects, expenses, actor, onChange, filterProject, setFilterProject }: {
  projects: any[]; expenses: any[]; actor: any; onChange: () => void;
  filterProject: string | null; setFilterProject: (v: string | null) => void;
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
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 shadow-sm">
      <h2 className="font-semibold text-gray-900">Projekty</h2>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nazwa (np. BAS004)"
          className="bg-white border border-gray-300 px-2 py-1 rounded text-sm text-gray-900 flex-1"
        />
        <button onClick={submit} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm">
          Utwórz
        </button>
      </div>
      <div className="space-y-1 max-h-40 overflow-auto">
        <button
          onClick={() => setFilterProject(null)}
          className={"w-full text-left px-2 py-1 rounded text-sm " + (filterProject === null ? "bg-cyan-50 text-cyan-700" : "text-gray-500 hover:bg-gray-50")}
        >
          Wszystkie
        </button>
        {projects.map((p) => (
          <button
            key={String(p.id)}
            onClick={() => setFilterProject(p.name)}
            className={"w-full text-left px-2 py-1 rounded text-sm flex justify-between " + (filterProject === p.name ? "bg-cyan-50 text-cyan-700" : "text-gray-500 hover:bg-gray-50")}
          >
            <span>{p.name}</span>
            <span className="font-mono">{spentByProject(p.id).toFixed(2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
