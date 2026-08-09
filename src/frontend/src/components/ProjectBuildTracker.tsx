import { useEffect, useState } from "react";

type TaskStatus = "notStarted" | "inProgress" | "done";

type Task = {
  id: number;
  title: string;
  category: string;
  plannedStart: string;
  plannedEnd: string;
  status: TaskStatus;
  actualEnd: string | null;
};

type Build = {
  id: number;
  projectCode: string;
  templateKey: string;
  startDate: string;
  tasks: Task[];
  createdAt: bigint;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  notStarted: "Nie rozpoczęto",
  inProgress: "W trakcie",
  done: "Zrobione",
};

function statusKey(s: any): TaskStatus {
  return Object.keys(s)[0] as TaskStatus;
}

function statusVariant(s: TaskStatus) {
  return { [s]: null };
}

const today = new Date().toISOString().slice(0, 10);

function isDelayed(task: Task): boolean {
  return statusOf(task) !== "done" && task.plannedEnd < today;
}

function statusOf(task: Task): TaskStatus {
  return typeof task.status === "string" ? task.status : statusKey(task.status);
}

export function ProjectBuildTracker({ actor }: { actor: any }) {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const reload = async () => {
    if (!actor) return;
    const list = await actor.listProjectBuilds();
    setBuilds(
      list.map((b: any) => ({
        ...b,
        tasks: b.tasks.map((t: any) => ({ ...t, status: statusKey(t.status), actualEnd: t.actualEnd?.[0] ?? null })),
      })),
    );
    setLoading(false);
  };

  useEffect(() => { reload(); }, [actor]);

  const setTaskStatus = async (buildId: number, task: Task, newStatus: TaskStatus) => {
    const actualEnd = newStatus === "done" ? (task.actualEnd || today) : task.actualEnd;
    await actor.updateProjectBuildTaskStatus(
      buildId,
      task.id,
      statusVariant(newStatus),
      actualEnd ? [actualEnd] : [],
    );
    reload();
  };

  if (loading) return null;
  if (builds.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm text-sm text-[var(--text-secondary)]">
        <h2 className="font-semibold text-[var(--text-primary)] mb-1">Postęp budowy</h2>
        Brak aktywnych buildów. Wygeneruj harmonogram w sekcji wyżej i zapisz jako aktywny build.
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-4 shadow-sm">
      <h2 className="font-semibold text-[var(--text-primary)]">Postęp budowy (widoczne dla całego zespołu)</h2>
      {builds.map((b) => {
        const done = b.tasks.filter((t) => statusOf(t) === "done").length;
        const delayed = b.tasks.filter(isDelayed).length;
        const isOpen = expanded[b.id] ?? true;
        return (
          <div key={b.id} className="border border-[var(--border-color-light)] rounded p-3 space-y-2">
            <button
              onClick={() => setExpanded((p) => ({ ...p, [b.id]: !isOpen }))}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="font-medium text-sm text-[var(--text-primary)]">
                {b.projectCode} <span className="text-[var(--text-secondary)] font-normal">({b.templateKey})</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-secondary)]">{done}/{b.tasks.length} gotowe</span>
                {delayed > 0 && (
                  <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded font-medium">{delayed} opóźnione</span>
                )}
                <span className="text-[var(--text-secondary)]">{isOpen ? "▲" : "▼"}</span>
              </div>
            </button>

            {isOpen && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="p-1">Czynność</th>
                    <th className="p-1">Kategoria</th>
                    <th className="p-1">Plan</th>
                    <th className="p-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {b.tasks.map((t) => {
                    const delayedRow = isDelayed(t);
                    return (
                      <tr key={t.id} className={"border-t border-[var(--border-color-light)]" + (delayedRow ? " bg-red-50" : "")}>
                        <td className="p-1">{t.title}</td>
                        <td className="p-1">{t.category}</td>
                        <td className={"p-1" + (delayedRow ? " text-red-600 font-medium" : "")}>
                          {t.plannedStart} → {t.plannedEnd}
                          {delayedRow && " ⚠"}
                        </td>
                        <td className="p-1">
                          <select
                            value={statusOf(t)}
                            onChange={(e) => setTaskStatus(b.id, t, e.target.value as TaskStatus)}
                            className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs"
                          >
                            {(["notStarted", "inProgress", "done"] as TaskStatus[]).map((s) => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
