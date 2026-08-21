import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";

function activityLabel(r: any): string {
  const k = Object.keys(r || {})[0];
  if (k === "szkolenie") return "Szkolenie";
  if (k === "komercyjne") return "Komerc.";
  if (k === "techniczne") return "Techniczne";
  return "—";
}

function czasSesji(start: string, end: string): string {
  if (!start || !end) return "—";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return "—";
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

export function LogbookModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [tab, setTab] = useState<"entries" | "instructors">("entries");
  const [loading, setLoading] = useState(true);

  const [entries, setEntries] = useState<any[]>([]);
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [entryDevices, setEntryDevices] = useState<Record<string, string>>({});
  const [instructors, setInstructors] = useState<any[]>([]);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [revealedPin, setRevealedPin] = useState<{ email: string; pin: string } | null>(null);
  const [zoomedSignature, setZoomedSignature] = useState<string | null>(null);
  const [filterName, setFilterName] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const reload = async () => {
    if (!actor) return;
    const [e, i, sigs, devs] = await Promise.all([
      actor.listLogbookEntries(),
      actor.listLogbookInstructors(),
      actor.listLogbookEntrySignatures(),
      actor.listLogbookEntryDevices(),
    ]);
    setEntries([...e].sort((a: any, b: any) => (a.dataText < b.dataText ? 1 : -1)));
    setInstructors(i);
    const sigMap: Record<string, string> = {};
    for (const [id, sig] of sigs as [bigint, string][]) { sigMap[String(id)] = sig; }
    setSignatures(sigMap);
    const devMap: Record<string, string> = {};
    for (const [id, , label] of devs as [bigint, bigint, string][]) { devMap[String(id)] = label; }
    setEntryDevices(devMap);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [actor]);

  const addInstructor = async () => {
    if (!newEmail.trim() || !newName.trim()) {
      setAddError("Podaj email i imię/nazwisko.");
      return;
    }
    setAddError("");
    try {
      const pin = await actor.addLogbookInstructor(newEmail.trim(), newName.trim());
      setRevealedPin({ email: newEmail.trim().toLowerCase(), pin: pin as string });
      setNewEmail("");
      setNewName("");
      reload();
    } catch (e: any) {
      setAddError(String(e?.message || e));
    }
  };

  const resetPin = async (email: string) => {
    if (!confirm("Zresetować PIN dla " + email + "? Stary PIN przestanie działać, a instruktor zostanie wylogowany z aktywnych sesji.")) return;
    const pin = await actor.resetLogbookInstructorPin(email);
    setRevealedPin({ email, pin: pin as string });
    reload();
  };

  const toggleActive = async (email: string, active: boolean) => {
    await actor.setLogbookInstructorActive(email, !active);
    reload();
  };

  const filteredEntries = entries.filter((e) => {
    if (filterName.trim()) {
      const q = filterName.trim().toLowerCase();
      const hay = (e.instruktorName + " " + (e.szkoleni || "")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filterFrom && e.dataText < filterFrom) return false;
    if (filterTo && e.dataText > filterTo) return false;
    return true;
  });

  const exportEntriesToExcel = () => {
    const rows = filteredEntries.map((e) => ({
      Data: e.dataText,
      Urządzenie: entryDevices[String(e.id)] || "",
      Instruktor: e.instruktorName,
      "E-mail": e.instruktorEmail,
      Szkoleni: e.szkoleni,
      Rodzaj: activityLabel(e.rodzajAktywnosci),
      "Godz. rozpoczęcia": e.godzRozpoczecia,
      "Godz. zakończenia": e.godzZakonczenia,
      "Czas sesji": czasSesji(e.godzRozpoczecia, e.godzZakonczenia),
      Licznik: e.licznikPoSesji,
      Usterki: e.brakUsterek ? "Brak" : e.opisUsterki,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Dziennik");
    const range = (filterFrom || filterTo) ? `_${filterFrom || "poczatek"}_${filterTo || "koniec"}` : "";
    XLSX.writeFile(wb, `dziennik-uzytkowania${range}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <span className="text-[var(--text-secondary)]">Ładowanie...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1200px] mx-auto p-6 space-y-6">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <h1 className="text-xl font-semibold">📘 Dziennik użytkowania</h1>

        <div className="flex gap-2 border-b border-[var(--border-color)]">
          <button
            onClick={() => setTab("entries")}
            className={"px-3 py-2 text-sm " + (tab === "entries" ? "border-b-2 border-cyan-600 text-cyan-600 font-medium" : "text-[var(--text-muted)]")}
          >
            Wpisy ({entries.length})
          </button>
          <button
            onClick={() => setTab("instructors")}
            className={"px-3 py-2 text-sm " + (tab === "instructors" ? "border-b-2 border-cyan-600 text-cyan-600 font-medium" : "text-[var(--text-muted)]")}
          >
            Instruktorzy ({instructors.length})
          </button>
        </div>

        {tab === "entries" && (
          <div className="overflow-x-auto space-y-3">
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <label className="flex flex-col text-xs text-[var(--text-muted)]">
                Szukaj (imię/nazwisko)
                <input
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="np. Kowalski"
                  className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]"
                />
              </label>
              <label className="flex flex-col text-xs text-[var(--text-muted)]">
                Od
                <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]" />
              </label>
              <label className="flex flex-col text-xs text-[var(--text-muted)]">
                Do
                <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]" />
              </label>
              {(filterName || filterFrom || filterTo) && (
                <button onClick={() => { setFilterName(""); setFilterFrom(""); setFilterTo(""); }} className="text-xs text-cyan-600 hover:underline mb-1.5">
                  Wyczyść filtry
                </button>
              )}
              <button onClick={exportEntriesToExcel} className="ml-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium mb-0">
                📊 Eksportuj do Excel ({filteredEntries.length})
              </button>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Urządzenie</th>
                  <th className="py-2 pr-3">Instruktor</th>
                  <th className="py-2 pr-3">Szkoleni</th>
                  <th className="py-2 pr-3">Rodzaj</th>
                  <th className="py-2 pr-3">Godz.</th>
                  <th className="py-2 pr-3">Czas</th>
                  <th className="py-2 pr-3">Licznik</th>
                  <th className="py-2 pr-3">Usterki</th>
                  <th className="py-2 pr-3">Podpis</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => (
                  <tr key={String(e.id)} className="border-b border-[var(--border-color)]/50">
                    <td className="py-2 pr-3 whitespace-nowrap">{e.dataText}</td>
                    <td className="py-2 pr-3">{entryDevices[String(e.id)] || "—"}</td>
                    <td className="py-2 pr-3">{e.instruktorName}<br /><span className="text-[10px] text-[var(--text-muted)]">{e.instruktorEmail}</span></td>
                    <td className="py-2 pr-3">{e.szkoleni || "—"}</td>
                    <td className="py-2 pr-3">{activityLabel(e.rodzajAktywnosci)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{e.godzRozpoczecia}–{e.godzZakonczenia}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{czasSesji(e.godzRozpoczecia, e.godzZakonczenia)}</td>
                    <td className="py-2 pr-3">{e.licznikPoSesji || "—"}</td>
                    <td className="py-2 pr-3">
                      {e.brakUsterek ? (
                        <span className="text-green-600">Brak</span>
                      ) : (
                        <span className="text-amber-600" title={e.opisUsterki}>⚠ {e.opisUsterki.slice(0, 40)}{e.opisUsterki.length > 40 ? "…" : ""}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {signatures[String(e.id)] ? (
                        <img
                          src={signatures[String(e.id)]}
                          alt="podpis"
                          className="h-8 border border-[var(--border-color)] rounded bg-white cursor-zoom-in"
                          onClick={() => setZoomedSignature(signatures[String(e.id)])}
                        />
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        onClick={async () => { await actor.trashLogbookEntry(e.id); reload(); }}
                        className="text-xs text-red-500 hover:underline"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && (
                  <tr><td colSpan={11} className="py-6 text-center text-[var(--text-muted)]">Brak wpisów spełniających filtry.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "instructors" && (
          <div className="space-y-4">
            <div className="border border-[var(--border-color)] rounded p-4 space-y-2 max-w-md">
              <p className="text-sm font-medium">Dodaj instruktora</p>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email@bartoliniair.com"
                className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm bg-[var(--bg-page)]"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Imię i nazwisko"
                className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm bg-[var(--bg-page)]"
              />
              {addError && <p className="text-red-600 text-xs">{addError}</p>}
              <button onClick={addInstructor} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-medium">
                + Dodaj (PIN wygeneruje się automatycznie)
              </button>
            </div>

            {revealedPin && (
              <div className="border border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded p-4 max-w-md space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  PIN dla {revealedPin.email} — zapisz/przekaż teraz, nie da się go później odczytać:
                </p>
                <p className="text-2xl font-mono font-bold tracking-widest select-all text-amber-900 dark:text-amber-200">{revealedPin.pin}</p>
                <button onClick={() => setRevealedPin(null)} className="text-xs text-amber-700 hover:underline">Zamknij</button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse max-w-2xl">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Imię i nazwisko</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {instructors.map((i) => (
                    <tr key={i.email} className="border-b border-[var(--border-color)]/50">
                      <td className="py-2 pr-3">{i.email}</td>
                      <td className="py-2 pr-3">{i.name}</td>
                      <td className="py-2 pr-3">
                        {i.active ? <span className="text-green-600">Aktywny</span> : <span className="text-[var(--text-muted)]">Nieaktywny</span>}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        <button onClick={() => resetPin(i.email)} className="text-xs text-cyan-600 hover:underline mr-3">Reset PIN</button>
                        <button onClick={() => toggleActive(i.email, i.active)} className="text-xs text-[var(--text-muted)] hover:underline">
                          {i.active ? "Dezaktywuj" : "Aktywuj"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {instructors.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-[var(--text-muted)]">Brak instruktorów.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {zoomedSignature && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setZoomedSignature(null)}>
          <img src={zoomedSignature} alt="podpis" className="max-w-lg max-h-64 bg-white rounded shadow-lg" />
        </div>
      )}
    </div>
  );
}
