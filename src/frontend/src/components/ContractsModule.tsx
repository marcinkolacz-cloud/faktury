import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { DriveFolderPanel } from "./DriveFolderPanel";
import { setDriveActor } from "../lib/oneDriveConfig";

function formatDate(ns: bigint): string {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleDateString("pl-PL", { year: "numeric", month: "short", day: "numeric" });
}

function isExpiringSoon(endDate: string): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  const now = new Date();
  const diffDays = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 60;
}

function isExpired(endDate: string): boolean {
  if (!endDate) return false;
  return new Date(endDate).getTime() < Date.now();
}

const emptyForm = { title: "", category: "", counterparty: "", description: "", endDate: "" };

export function ContractsModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [myRole, setMyRole] = useState<string>("read");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const reload = async () => {
    if (!actor) return;
    const c = await actor.listContracts();
    setContracts(c);
    setLoading(false);
    if (selected) {
      const updated = c.find((x: any) => x.id === selected.id);
      if (updated) setSelected(updated);
    }
  };

  useEffect(() => {
    reload();
    if (actor) {
      setDriveActor(actor);
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
    }
  }, [actor]);

  useEffect(() => {
    if (!actor || selected?.id === undefined) { setFolderPath(null); return; }
    actor.getContractDriveFolder(selected.id).then((r: any) => setFolderPath(r.length ? r[0] : null)).catch(() => setFolderPath(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const canWrite = myRole === "write" || myRole === "admin";

  const submitForm = async () => {
    if (!form.title.trim()) return;
    if ((selected as any)?._editing) {
      await actor.updateContract(selected.id, form.title.trim(), form.category.trim(), form.counterparty.trim(), form.description.trim(), form.endDate);
    } else {
      await actor.createContract(form.title.trim(), form.category.trim(), form.counterparty.trim(), form.description.trim(), form.endDate, "Zespół");
    }
    setForm(emptyForm);
    setShowForm(false);
    setSelected(null);
    reload();
  };

  const startEdit = (c: any) => {
    setForm({ title: c.title, category: c.category, counterparty: c.counterparty, description: c.description, endDate: c.endDate });
    setSelected({ ...c, _editing: true });
    setShowForm(true);
  };

  const linkContractFolder = async (path: string) => {
    if (!selected) return;
    await actor.linkContractDriveFolder(selected.id, path);
    setFolderPath(path);
  };

  const unlinkContractFolder = async () => {
    if (!selected) return;
    await actor.unlinkContractDriveFolder(selected.id);
    setFolderPath(null);
  };

  const trashSelected = async () => {
    if (!selected || !confirm("Przenieść tę umowę do kosza?")) return;
    await actor.trashContract(selected.id);
    setSelected(null);
    reload();
  };

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-500">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-sm overflow-hidden">
            {canWrite && (
              <div className="p-2 border-b border-[var(--border-color-light)]">
                <button
                  onClick={() => { setForm(emptyForm); setSelected(null); setShowForm(true); }}
                  className="w-full text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded px-2 py-1.5"
                >
                  + Nowa umowa
                </button>
              </div>
            )}
            <div className="overflow-auto max-h-[600px]">
              {contracts.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">Brak umów.</p>
              ) : (
                [...contracts].reverse().map((c) => (
                  <button
                    key={String(c.id)}
                    onClick={() => { setSelected(c); setShowForm(false); }}
                    className={"w-full text-left p-3 border-b border-[var(--border-color-light)] hover:bg-[var(--bg-page)] " + (selected?.id === c.id && !showForm ? "bg-cyan-500/10" : "")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm text-[var(--text-primary)] truncate">{c.title}</p>
                      {c.endDate && (isExpired(c.endDate) ? (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded text-white bg-red-500">Wygasła</span>
                      ) : isExpiringSoon(c.endDate) ? (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded text-white bg-amber-500">Wygasa wkrótce</span>
                      ) : null)}
                    </div>
                    <p className="text-xs text-gray-500">{c.category}{c.counterparty && " · " + c.counterparty}</p>
                    {c.endDate && <p className="text-[10px] text-[var(--text-muted)]">Koniec: {c.endDate}</p>}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-sm p-4">
            {showForm ? (
              <div className="space-y-2 max-w-md">
                <h2 className="font-semibold">{(selected as any)?._editing ? "Edytuj umowę" : "Nowa umowa"}</h2>
                <label className="text-xs text-[var(--text-muted)]">Tytuł</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="np. Umowa sprzedaży urządzenia, Najem lokalu, Internet" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Kategoria</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="np. Sprzedaż, Lokal, Internet, Inne" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Kontrahent</label>
                <input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Data końca umowy</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Główne założenia</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={5} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <div className="flex gap-2 pt-2">
                  <button onClick={submitForm} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm">Zapisz</button>
                  <button onClick={() => { setShowForm(false); setSelected(null); }} className="px-3 py-1.5 border border-[var(--border-color)] rounded text-sm">Anuluj</button>
                </div>
              </div>
            ) : !selected ? (
              <p className="text-sm text-gray-500">Wybierz umowę z listy lub dodaj nową.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <h2 className="font-semibold text-[var(--text-primary)]">{selected.title}</h2>
                  <p className="text-xs text-gray-500">{selected.category}{selected.counterparty && " · " + selected.counterparty}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Umowa #{String(selected.id)} · Dodano: {formatDate(selected.createdAt)}</p>
                  {selected.endDate && (
                    <p className={"text-xs mt-1 " + (isExpired(selected.endDate) ? "text-red-500 font-medium" : isExpiringSoon(selected.endDate) ? "text-amber-600 font-medium" : "text-[var(--text-secondary)]")}>
                      Data końca umowy: {selected.endDate}
                      {isExpired(selected.endDate) && " (wygasła)"}
                      {!isExpired(selected.endDate) && isExpiringSoon(selected.endDate) && " (wygasa w ciągu 60 dni)"}
                    </p>
                  )}
                </div>
                {selected.description && (
                  <div className="bg-[var(--bg-page)] rounded p-3">
                    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{selected.description}</p>
                  </div>
                )}
                <DriveFolderPanel
                  path={folderPath}
                  basePath="Umowy"
                  defaultName={"Umowa #" + String(selected.id) + " - " + selected.title}
                  canWrite={canWrite}
                  onLink={linkContractFolder}
                  onUnlink={unlinkContractFolder}
                />
                {canWrite && (
                  <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => startEdit(selected)} className="text-xs text-cyan-600 hover:underline">Edytuj</button>
                    <button onClick={trashSelected} className="text-xs text-red-500 hover:underline">Usuń</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
