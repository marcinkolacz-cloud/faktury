import { Fragment, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { sendEmailNotification } from "../lib/emailNotify";

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
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(true);

  const [entries, setEntries] = useState<any[]>([]);
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [entryDevices, setEntryDevices] = useState<Record<string, string>>({});
  const [entryDeviceIds, setEntryDeviceIds] = useState<Record<string, number>>({});
  const [linkedTickets, setLinkedTickets] = useState<Record<string, number>>({});
  const [instructors, setInstructors] = useState<any[]>([]);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [revealedPin, setRevealedPin] = useState<{ email: string; pin: string } | null>(null);
  const [zoomedSignature, setZoomedSignature] = useState<string | null>(null);
  const [filterName, setFilterName] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [recomputingId, setRecomputingId] = useState<number | null>(null);
  const [recomputeResult, setRecomputeResult] = useState<string>("");

  const reload = async () => {
    if (!actor) return;
    const [e, i, sigs, devs, tix] = await Promise.all([
      actor.listLogbookEntries(),
      actor.listLogbookInstructors(),
      actor.listLogbookEntrySignatures(),
      actor.listLogbookEntryDevices(),
      actor.listLogbookEntryLinkedTickets(),
    ]);
    setEntries([...e].sort((a: any, b: any) => (a.dataText < b.dataText ? 1 : -1)));
    setInstructors(i);
    const sigMap: Record<string, string> = {};
    for (const [id, sig] of sigs as [bigint, string][]) { sigMap[String(id)] = sig; }
    setSignatures(sigMap);
    const devMap: Record<string, string> = {};
    const devIdMap: Record<string, number> = {};
    for (const [id, devId, label] of devs as [bigint, bigint, string][]) { devMap[String(id)] = label; devIdMap[String(id)] = Number(devId); }
    setEntryDevices(devMap);
    setEntryDeviceIds(devIdMap);
    const tixMap: Record<string, number> = {};
    for (const [entryId, ticketId] of tix as [bigint, bigint][]) { tixMap[String(entryId)] = Number(ticketId); }
    setLinkedTickets(tixMap);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [actor]);

  const startEdit = (e: any) => {
    setEditingId(Number(e.id));
    setEditDraft({
      dataText: e.dataText,
      instruktorName: e.instruktorName,
      szkoleni: e.szkoleni,
      rodzajAktywnosci: Object.keys(e.rodzajAktywnosci || {})[0] || "szkolenie",
      godzRozpoczecia: e.godzRozpoczecia,
      godzZakonczenia: e.godzZakonczenia,
      licznikPoSesji: e.licznikPoSesji,
      brakUsterek: e.brakUsterek,
      opisUsterki: e.opisUsterki,
    });
    setRecomputeResult("");
  };

  const saveEdit = async () => {
    if (editingId === null || !editDraft) return;
    setEditSaving(true);
    await actor.adminUpdateLogbookEntry(
      BigInt(editingId),
      editDraft.dataText,
      editDraft.instruktorName,
      editDraft.szkoleni,
      { [editDraft.rodzajAktywnosci]: null },
      editDraft.godzRozpoczecia,
      editDraft.godzZakonczenia,
      editDraft.licznikPoSesji,
      editDraft.brakUsterek,
      editDraft.opisUsterki,
    );
    setEditingId(null);
    setEditDraft(null);
    setEditSaving(false);
    reload();
  };

  const recomputeCounters = async (entryId: number) => {
    const devId = entryDeviceIds[String(entryId)];
    if (devId === undefined) return;
    if (!confirm("Przeliczyć licznik nalotu dla WSZYSTKICH kolejnych wpisów tego urządzenia, licząc od tego wpisu włącznie? Tej operacji nie da się cofnąć automatycznie.")) return;
    setRecomputingId(entryId);
    const count = await actor.adminRecomputeLogbookCounters(BigInt(devId), BigInt(entryId));
    setRecomputeResult(`Przeliczono licznik dla ${Number(count)} wpis(ów).`);
    setRecomputingId(null);
    reload();
  };

  const addInstructor = async () => {
    if (!newEmail.trim() || !newName.trim()) {
      setAddError("Podaj email i imię/nazwisko.");
      return;
    }
    setAddError("");
    try {
      const pin = await actor.addLogbookInstructor(newEmail.trim(), newName.trim());
      const addedEmail = newEmail.trim().toLowerCase();
      setRevealedPin({ email: addedEmail, pin: pin as string });
      setNewEmail("");
      setNewName("");
      reload();
      sendEmailNotification(
        actor,
        [addedEmail],
        "Dostep do Dziennika uzytkowania - PIN logowania",
        "Zostales dodany jako uzytkownik Dziennika uzytkowania urzadzenia.\n\n"
          + "Email: " + addedEmail + "\nPIN: " + (pin as string)
          + "\n\nZaloguj sie na stronie dziennika tym adresem e-mail i PIN-em."
      ).catch(() => {});
    } catch (e: any) {
      setAddError(String(e?.message || e));
    }
  };

  const resetPin = async (email: string) => {
    if (!confirm("Zresetować PIN dla " + email + "? Stary PIN przestanie działać, a instruktor zostanie wylogowany z aktywnych sesji.")) return;
    const pin = await actor.resetLogbookInstructorPin(email);
    setRevealedPin({ email, pin: pin as string });
    reload();
    sendEmailNotification(
      actor,
      [email],
      "Nowy PIN do Dziennika uzytkowania",
      "Twoj PIN do Dziennika uzytkowania urzadzenia zostal zresetowany.\n\n"
        + "Email: " + email + "\nNowy PIN: " + (pin as string)
        + "\n\nStary PIN juz nie dziala."
    ).catch(() => {});
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

        <div className="border border-cyan-500/30 rounded-lg overflow-hidden max-w-3xl">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-left"
          >
            <span className="text-sm font-medium text-cyan-700 dark:text-cyan-400">❓ Jak sprawdzać wpisy i zarządzać instruktorami</span>
            <span className="text-cyan-600 text-xs shrink-0">{showHelp ? "▲ zwiń" : "▼ rozwiń"}</span>
          </button>
          {showHelp && (
            <div className="p-3 space-y-2 bg-[var(--bg-card)]">
              <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-cyan-700 dark:text-cyan-400 mb-1">📋 Zakładka „Wpisy"</p>
                <p>Podgląd wszystkich sesji ze wszystkich urządzeń, zapisanych przez instruktorów na publicznej stronie /dziennik. Filtruj po nazwisku i zakresie dat, kliknij miniaturę podpisu żeby powiększyć. „📊 Eksportuj do Excel" zapisuje aktualnie przefiltrowaną listę do pliku .xlsx.</p>
              </div>
              <div className="rounded-md border border-fuchsia-400/40 bg-fuchsia-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-fuchsia-700 dark:text-fuchsia-400 mb-1">✏ Edycja wpisów i licznik nalotu</p>
                <p>Instruktor może sam poprawić TYLKO swój ostatni wpis w całym dzienniku (dowolne urządzenie) — jeśli ktokolwiek doda kolejny wpis, traci tę możliwość i musi wysłać zgłoszenie (ticket), które zobaczysz tu, w kolumnie „Akcje" (✏ Edytuj, dostępne zawsze dla admina, niezależnie od pozycji wpisu).</p>
                <p className="mt-1">Jeśli poprawka zmienia godziny sesji, licznik nalotu kolejnych wpisów tego samego urządzenia może się rozjechać — użyj przycisku „🔄 Przelicz licznik od tego wpisu" zaraz po zapisaniu poprawki, żeby przeliczyć licznik dla wszystkich kolejnych wpisów tego urządzenia.</p>
              </div>
              <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">⚠ Kolumna „Usterki"</p>
                <p>Czerwona/pomarańczowa ikona ⚠ oznacza zgłoszoną usterkę — najedź lub kliknij, żeby zobaczyć pełny opis. Zielone „Brak" oznacza sesję bez zastrzeżeń.</p>
              </div>
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">👤 Zakładka „Instruktorzy"</p>
                <p>Tu dodajesz osoby uprawnione do logowania na /dziennik. „+ Dodaj" generuje 6-cyfrowy PIN automatycznie i pokazuje go raz — zapisz/przekaż go od razu, bo później nie da się go odczytać (tylko zresetować). „Reset PIN" wylogowuje instruktora z aktywnych sesji i generuje nowy PIN. „Dezaktywuj" blokuje logowanie bez usuwania historii wpisów danej osoby.</p>
              </div>
            </div>
          )}
        </div>

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
                  <th className="py-2 pr-3">Zgłoszenie</th>
                  <th className="py-2 pr-3 w-32">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => {
                  const id = Number(e.id);
                  const isEditingRow = editingId === id;
                  return (
                  <Fragment key={String(e.id)}>
                  <tr className="border-b border-[var(--border-color)]/50">
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
                    <td className="py-2 pr-3">
                      {linkedTickets[String(e.id)] !== undefined ? (
                        <span className="text-xs text-fuchsia-600 font-medium">🎫 #{linkedTickets[String(e.id)]}</span>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(e)} className="text-xs text-cyan-600 hover:underline mr-2">✏ Edytuj</button>
                      <button
                        onClick={async () => { await actor.trashLogbookEntry(e.id); reload(); }}
                        className="text-xs text-red-500 hover:underline"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                  {isEditingRow && editDraft && (
                    <tr className="border-b border-[var(--border-color)]/50 bg-fuchsia-500/5">
                      <td colSpan={12} className="p-3">
                        <div className="rounded-md border border-fuchsia-400/50 bg-[var(--bg-card)] p-3 space-y-2 max-w-3xl">
                          <p className="text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-400">✏ Edycja wpisu #{id} (admin — dowolny wpis)</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <label className="text-xs text-[var(--text-muted)]">Data
                              <input type="date" value={editDraft.dataText} onChange={(ev) => setEditDraft({ ...editDraft, dataText: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]" />
                            </label>
                            <label className="text-xs text-[var(--text-muted)]">Instruktor
                              <input value={editDraft.instruktorName} onChange={(ev) => setEditDraft({ ...editDraft, instruktorName: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]" />
                            </label>
                            <label className="text-xs text-[var(--text-muted)]">Szkoleni
                              <input value={editDraft.szkoleni} onChange={(ev) => setEditDraft({ ...editDraft, szkoleni: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]" />
                            </label>
                            <label className="text-xs text-[var(--text-muted)]">Rodzaj
                              <select value={editDraft.rodzajAktywnosci} onChange={(ev) => setEditDraft({ ...editDraft, rodzajAktywnosci: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]">
                                <option value="szkolenie">Szkolenie</option>
                                <option value="komercyjne">Komerc.</option>
                                <option value="techniczne">Techniczne</option>
                              </select>
                            </label>
                            <label className="text-xs text-[var(--text-muted)]">Godz. rozpoczęcia
                              <input value={editDraft.godzRozpoczecia} onChange={(ev) => setEditDraft({ ...editDraft, godzRozpoczecia: ev.target.value })} placeholder="HH:MM" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]" />
                            </label>
                            <label className="text-xs text-[var(--text-muted)]">Godz. zakończenia
                              <input value={editDraft.godzZakonczenia} onChange={(ev) => setEditDraft({ ...editDraft, godzZakonczenia: ev.target.value })} placeholder="HH:MM" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]" />
                            </label>
                            <label className="text-xs text-[var(--text-muted)]">Licznik po sesji
                              <input value={editDraft.licznikPoSesji} onChange={(ev) => setEditDraft({ ...editDraft, licznikPoSesji: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)]" />
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={editDraft.brakUsterek} onChange={(ev) => setEditDraft({ ...editDraft, brakUsterek: ev.target.checked, opisUsterki: ev.target.checked ? "" : editDraft.opisUsterki })} />
                            Brak usterek
                          </label>
                          {!editDraft.brakUsterek && (
                            <textarea value={editDraft.opisUsterki} onChange={(ev) => setEditDraft({ ...editDraft, opisUsterki: ev.target.value })} rows={2} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm bg-[var(--bg-page)]" />
                          )}
                          {recomputeResult && <p className="text-xs text-emerald-600">{recomputeResult}</p>}
                          <div className="flex justify-between items-center gap-2">
                            <button
                              onClick={() => recomputeCounters(id)}
                              disabled={recomputingId === id}
                              title="Przelicza licznik nalotu dla wszystkich kolejnych wpisów tego urządzenia, licząc od tego wpisu"
                              className="text-xs px-3 py-1.5 rounded border border-amber-500 text-amber-600 disabled:opacity-50"
                            >
                              {recomputingId === id ? "Przeliczanie…" : "🔄 Przelicz licznik od tego wpisu"}
                            </button>
                            <div className="flex gap-2">
                              <button onClick={() => { setEditingId(null); setEditDraft(null); }} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)]">Anuluj</button>
                              <button onClick={saveEdit} disabled={editSaving} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50">
                                {editSaving ? "Zapisywanie…" : "💾 Zapisz"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
                {filteredEntries.length === 0 && (
                  <tr><td colSpan={12} className="py-6 text-center text-[var(--text-muted)]">Brak wpisów spełniających filtry.</td></tr>
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
