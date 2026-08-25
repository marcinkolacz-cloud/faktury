import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { odUploadFile, odDownloadUrl, odDelete, odCreateFolder, odList, setDriveActor } from "../lib/oneDriveConfig";
import { sendEmailNotification } from "../lib/emailNotify";
import { InfoTip } from "./InfoTip";

const TYPE_LABELS: Record<string, string> = {
  meeting: "Spotkanie",
  trip: "Wyjazd",
  importantDate: "Ważna data",
  task: "Zadanie",
};
const TYPE_COLORS: Record<string, string> = {
  meeting: "bg-cyan-500/10 text-cyan-600 border-cyan-800/30",
  trip: "bg-amber-500/10 text-amber-600 border-amber-800/30",
  importantDate: "bg-red-500/10 text-red-500 border-red-800/30",
  task: "bg-emerald-500/10 text-emerald-600 border-emerald-800/30",
};

function typeVariant(t: any): string {
  return Object.keys(t)[0];
}

export function CalendarModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>("read");
  const [showPast, setShowPast] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [eventType, setEventType] = useState("meeting");
  const [creatorName, setCreatorName] = useState("");
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [notifyImportant, setNotifyImportant] = useState(false);
  const [notifyEventEmails, setNotifyEventEmails] = useState<string[]>([]);
  const [eventNotifyResult, setEventNotifyResult] = useState<string | null>(null);

  const reload = async () => {
    if (!actor) return;
    const result = await actor.listCalendarEvents();
    setEvents(result);
    setLoading(false);
    const notesResults = await Promise.all(result.map((e: any) => actor.listCalendarNotes(e.id)));
    const notesMap: Record<string, any[]> = {};
    result.forEach((e: any, i: number) => { notesMap[String(e.id)] = notesResults[i]; });
    setNotesByEvent(notesMap);
  };

  useEffect(() => {
    if (actor) {
      setDriveActor(actor);
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
      actor.listSubscribers().then(setSubscribers).catch(() => setSubscribers([]));
      reload();
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    const interval = setInterval(() => { reload(); }, 5000);
    return () => clearInterval(interval);
  }, [actor]);

  const canWrite = myRole === "write" || myRole === "admin";
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attachmentsByEvent, setAttachmentsByEvent] = useState<Record<string, [string, string][]>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const [notesByEvent, setNotesByEvent] = useState<Record<string, any[]>>({});
  const [newNoteTitle, setNewNoteTitle] = useState<Record<string, string>>({});
  const [newNoteContent, setNewNoteContent] = useState<Record<string, string>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState<Record<string, boolean>>({});
  const [viewNoteId, setViewNoteId] = useState<string | null>(null);
  const [addingNoteFor, setAddingNoteFor] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState("");
  const [editNoteContent, setEditNoteContent] = useState("");
  const [notifyNoteFor, setNotifyNoteFor] = useState<Record<string, boolean>>({});
  const [notifyNoteEmails, setNotifyNoteEmails] = useState<Record<string, string[]>>({});
  const [noteNotifyResult, setNoteNotifyResult] = useState<Record<string, string>>({});

  const monthLabel = (y: number, m: number) => {
    const names = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
    return names[m] + " " + y;
  };

  const changeMonth = (delta: number) => {
    setViewMonth((prev) => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m < 0) { m = 11; y -= 1; }
      if (m > 11) { m = 0; y += 1; }
      return { year: y, month: m };
    });
  };

  const dateOnly = (s: string) => s.split("T")[0];
  const dateInRange = (dayStr: string, start: string, end: string) => dayStr >= dateOnly(start) && dayStr <= dateOnly(end);

  const loadNotes = async (eventId: bigint) => {
    const result = await actor.listCalendarNotes(eventId);
    setNotesByEvent((prev) => ({ ...prev, [String(eventId)]: result }));
  };

  const addNote = async (eventId: bigint) => {
    const key = String(eventId);
    const title = (newNoteTitle[key] || "").trim();
    const content = (newNoteContent[key] || "").trim();
    if (!title) return;
    await actor.createCalendarNote(eventId, title, content);
    setNewNoteTitle((prev) => ({ ...prev, [key]: "" }));
    setNewNoteContent((prev) => ({ ...prev, [key]: "" }));
    if (notifyNoteFor[key] && (notifyNoteEmails[key] || []).length > 0) {
      try {
        const ev = events.find((x) => String(x.id) === key);
        const evTitle = ev ? ev.title : "wydarzenie";
        const res = await sendEmailNotification(
          actor,
          notifyNoteEmails[key],
          "Nowa informacja: " + evTitle + " — " + title,
          content
        );
        setNoteNotifyResult((prev) => ({ ...prev, [key]: "Powiadomiono " + res.ok + "/" + res.total + " adresów." }));
      } catch (err) {
        setNoteNotifyResult((prev) => ({ ...prev, [key]: "Błąd powiadomienia: " + (err instanceof Error ? err.message : String(err)) }));
      }
      setNotifyNoteFor((prev) => ({ ...prev, [key]: false }));
      setNotifyNoteEmails((prev) => ({ ...prev, [key]: [] }));
    }
    loadNotes(eventId);
  };

  const renderNoteNotifyPicker = (key: string) => (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={!!notifyNoteFor[key]}
          onChange={(e) => {
            const checked = e.target.checked;
            setNotifyNoteFor((prev) => ({ ...prev, [key]: checked }));
            if (!checked) setNotifyNoteEmails((prev) => ({ ...prev, [key]: [] }));
          }}
        />
        Powiadom zespół mailem o tej informacji
        <InfoTip text="Wysyła mail do wybranych adresów z treścią tej konkretnej notatki. Działa niezależnie od powiadomienia ustawionego przy tworzeniu samego wydarzenia." />
      </label>
      {notifyNoteFor[key] && (
        <div className="border border-[var(--border-color)] rounded p-1.5 space-y-1">
          {subscribers.length === 0 ? (
            <p className="text-[10px] text-[var(--text-muted)]">Brak adresów na liście (moduł "Powiadomienia e-mail").</p>
          ) : (
            subscribers.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={(notifyNoteEmails[key] || []).includes(s.email)}
                  onChange={(e) =>
                    setNotifyNoteEmails((prev) => {
                      const cur = prev[key] || [];
                      return { ...prev, [key]: e.target.checked ? [...cur, s.email] : cur.filter((em) => em !== s.email) };
                    })
                  }
                />
                {s.name ? s.name + " (" + s.email + ")" : s.email}
              </label>
            ))
          )}
        </div>
      )}
      {noteNotifyResult[key] && <p className="text-[10px] text-[var(--text-muted)]">{noteNotifyResult[key]}</p>}
    </div>
  );

  const startEditNote = (note: any) => {
    setEditingNoteId(String(note.id));
    setEditNoteTitle(note.title);
    setEditNoteContent(note.content);
  };

  const saveEditNote = async (eventId: bigint, noteId: bigint) => {
    await actor.updateCalendarNote(noteId, editNoteTitle.trim(), editNoteContent.trim());
    setEditingNoteId(null);
    loadNotes(eventId);
  };

  const removeNote = async (eventId: bigint, noteId: bigint) => {
    if (!confirm("Przenieść tę notatkę do kosza?")) return;
    await actor.trashCalendarNote(noteId);
    loadNotes(eventId);
  };

  const loadAttachments = async (eventId: bigint) => {
    const result = await actor.listCalendarAttachments(eventId);
    setAttachmentsByEvent((prev) => ({ ...prev, [String(eventId)]: result }));
  };

  const toggleExpand = (eventId: bigint) => {
    const key = String(eventId);
    if (expandedId === key) {
      setExpandedId(null);
    } else {
      setExpandedId(key);
      loadAttachments(eventId);
    }
  };

  const ensureFolder = async (parentPath: string, name: string) => {
    const listing = await odList(parentPath);
    const exists = (listing.items || []).some((i: any) => i.isFolder && i.name.toLowerCase() === name.toLowerCase());
    if (!exists) await odCreateFolder(parentPath, name);
  };

  const uploadAttachment = async (eventId: bigint, file: File) => {
    setUploadingFor(String(eventId));
    await ensureFolder("", "Kalendarz");
    await ensureFolder("Kalendarz", String(eventId));
    const folderPath = "Kalendarz/" + String(eventId);
    await odUploadFile(folderPath, file);
    const listResult = await odList(folderPath);
    const items = (listResult.items || []).map((i: any) => [i.id, i.name] as [string, string]);
    for (const [itemId, name] of items) {
      const current = attachmentsByEvent[String(eventId)] || [];
      if (!current.some(([id]) => id === itemId)) {
        await actor.addCalendarAttachment(eventId, itemId, name);
      }
    }
    loadAttachments(eventId);
    setUploadingFor(null);
  };

  const downloadAttachment = async (itemId: string, name: string) => {
    const result = await odDownloadUrl(itemId);
    if (result.downloadUrl) {
      const a = document.createElement("a");
      a.href = result.downloadUrl;
      a.download = name;
      a.click();
    }
  };

  const removeAttachment = async (eventId: bigint, itemId: string) => {
    if (!confirm("Usunąć ten załącznik?")) return;
    await odDelete(itemId);
    await actor.removeCalendarAttachment(eventId, itemId);
    loadAttachments(eventId);
  };

  const addEvent = async () => {
    if (!title.trim() || !startDate) return;
    const variant = { [eventType]: null } as any;
    await actor.createCalendarEvent(
      title.trim(),
      description.trim(),
      startDate,
      endDate || startDate,
      variant,
      creatorName.trim() || "Zespół"
    );
    if (notifyImportant && notifyEventEmails.length > 0) {
      try {
        const dateLine = startDate + (endDate && endDate !== startDate ? " – " + endDate : "");
        const body = "Data: " + dateLine + (description.trim() ? "\n\n" + description.trim() : "");
        const res = await sendEmailNotification(actor, notifyEventEmails, "Ważne wydarzenie: " + title.trim(), body);
        setEventNotifyResult("Powiadomiono " + res.ok + "/" + res.total + " adresów.");
      } catch (err) {
        setEventNotifyResult("Błąd powiadomienia: " + (err instanceof Error ? err.message : String(err)));
      }
      setNotifyImportant(false);
      setNotifyEventEmails([]);
    }
    setTitle("");
    setDescription("");
    setStartDate("");
    setEndDate("");
    reload();
  };

  const toggleDone = async (id: bigint) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, done: !e.done } : e)));
    await actor.toggleCalendarEventDone(id).catch(() => reload());
  };

  const removeEvent = async (id: bigint) => {
    if (!confirm("Przenieść to wydarzenie/zadanie do kosza?")) return;
    await actor.trashCalendarEvent(id);
    reload();
  };

  const today = new Date().toISOString().slice(0, 10);
  const visible = events
    .filter((e) => filterType === "all" || typeVariant(e.eventType) === filterType)
    .filter((e) => showPast || e.endDate >= today)
    .filter((e) => !selectedDay || dateInRange(selectedDay, e.startDate, e.endDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const formatDate = (d: string) => {
    if (!d) return "";
    const [datePart, timePart] = d.split("T");
    const parts = datePart.split("-");
    if (parts.length !== 3) return d;
    const base = parts[2] + "." + parts[1] + "." + parts[0];
    return timePart ? base + " " + timePart : base;
  };

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-[var(--text-muted)]">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1200px] mx-auto p-6 space-y-6">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {canWrite && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3">
            <h2 className="font-semibold text-sm">+ Dodaj wydarzenie / zadanie</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tytuł" className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm" />
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm">
                <option value="meeting">Spotkanie</option>
                <option value="trip">Wyjazd</option>
                <option value="importantDate">Ważna data</option>
                <option value="task">Zadanie</option>
              </select>
              <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm" />
              <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="Data końcowa (opcjonalnie)" className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm" />
              <input value={creatorName} onChange={(e) => setCreatorName(e.target.value)} placeholder="Twoje imię" className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opis (opcjonalnie) — możesz wkleić tekst z zachowanym formatowaniem" rows={15} className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm md:col-span-2 resize-y whitespace-pre-wrap font-mono" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={notifyImportant}
                onChange={(e) => { setNotifyImportant(e.target.checked); if (!e.target.checked) setNotifyEventEmails([]); }}
              />
              Ważne — wyślij powiadomienie mailem
              <InfoTip text="Mail z tytułem, datą i opisem wydarzenia trafi natychmiast po zapisaniu do wybranych adresów z listy Powiadomień e-mail." />
            </label>
            {notifyImportant && (
              <div className="border border-[var(--border-color)] rounded p-2 space-y-1">
                {subscribers.length === 0 ? (
                  <p className="text-[10px] text-[var(--text-muted)]">Brak adresów na liście (moduł "Powiadomienia e-mail").</p>
                ) : (
                  subscribers.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={notifyEventEmails.includes(s.email)}
                        onChange={(e) =>
                          setNotifyEventEmails((prev) =>
                            e.target.checked ? [...prev, s.email] : prev.filter((em) => em !== s.email)
                          )
                        }
                      />
                      {s.name ? s.name + " (" + s.email + ")" : s.email}
                    </label>
                  ))
                )}
              </div>
            )}
            {eventNotifyResult && <p className="text-[10px] text-[var(--text-muted)]">{eventNotifyResult}</p>}
            <button onClick={addEvent} disabled={!title.trim() || !startDate} className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50">
              Dodaj
            </button>
          </div>
        )}

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={() => changeMonth(-1)} className="px-2 py-1 text-sm border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)]">←</button>
            <span className="font-medium text-sm">{monthLabel(viewMonth.year, viewMonth.month)}</span>
            <button onClick={() => changeMonth(1)} className="px-2 py-1 text-sm border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)]">→</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((d) => (
              <div key={d} className="text-[10px] text-[var(--text-muted)] font-medium">{d}</div>
            ))}
            {(() => {
              const firstOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
              const startWeekday = (firstOfMonth.getDay() + 6) % 7;
              const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
              const cells = [];
              for (let i = 0; i < startWeekday; i++) cells.push(null);
              for (let d = 1; d <= daysInMonth; d++) cells.push(d);
              const todayStr = new Date().toISOString().slice(0, 10);
              return cells.map((d, idx) => {
                if (d === null) return <div key={"empty" + idx} />;
                const dayStr = viewMonth.year + "-" + String(viewMonth.month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
                const dayEvents = events.filter((e) => dateInRange(dayStr, e.startDate, e.endDate));
                return (
                  <button
                    key={dayStr}
                    onClick={() => setSelectedDay(selectedDay === dayStr ? null : dayStr)}
                    className={"min-h-[64px] rounded p-1 text-left align-top border overflow-hidden " + (dayStr === todayStr ? "border-cyan-600" : "border-transparent") + (selectedDay === dayStr ? " bg-cyan-500/10" : " hover:bg-[var(--bg-hover)]")}
                  >
                    <span className="text-[10px] text-[var(--text-primary)]">{d}</span>
                    <div className="space-y-0.5 mt-0.5">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <div key={String(ev.id)} className={"text-[9px] px-1 py-0.5 rounded truncate border " + TYPE_COLORS[typeVariant(ev.eventType)]}>{ev.title}</div>
                      ))}
                      {dayEvents.length > 2 && <div className="text-[9px] text-[var(--text-muted)]">+{dayEvents.length - 2} więcej</div>}
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm">
              <option value="all">Wszystkie typy</option>
              <option value="meeting">Spotkania</option>
              <option value="trip">Wyjazdy</option>
              <option value="importantDate">Ważne daty</option>
              <option value="task">Zadania</option>
            </select>
            <label className="flex items-center gap-1 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
              Pokaż przeszłe
            </label>
            {selectedDay && (
              <button onClick={() => setSelectedDay(null)} className="text-xs text-cyan-600 hover:underline">
                Dzień: {formatDate(selectedDay)} — wyczyść
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">Brak wydarzeń do pokazania.</p>
          ) : (
            <div className="space-y-2">
              {visible.map((e) => {
                const type = typeVariant(e.eventType);
                return (
                  <div key={String(e.id)} className={"border rounded-lg p-3 flex flex-wrap items-start gap-3 " + TYPE_COLORS[type]}>
                    {type === "task" && canWrite && (
                      <input type="checkbox" checked={e.done} onChange={() => toggleDone(e.id)} className="mt-1" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={"text-[10px] font-medium px-1.5 py-0.5 rounded border " + TYPE_COLORS[type]}>{TYPE_LABELS[type]}</span>
                        <span className={"font-medium text-sm text-[var(--text-primary)]" + (e.done ? " line-through opacity-60" : "")}>{e.title}</span>
                      </div>
                      {e.description && (
  <div className="mt-1">
    <p className={"text-xs text-[var(--text-secondary)] whitespace-pre-wrap " + (descExpanded[String(e.id)] ? "" : "line-clamp-3")}>{e.description}</p>
    {e.description.length > 150 && (
      <button onClick={() => setDescExpanded((prev) => ({ ...prev, [String(e.id)]: !prev[String(e.id)] }))} className="text-[10px] text-cyan-600 hover:underline mt-0.5">
        {descExpanded[String(e.id)] ? "Pokaż mniej" : "Pokaż więcej"}
      </button>
    )}
  </div>
)}
                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        {(notesByEvent[String(e.id)] || []).map((note: any) => (
                          <button
                            key={String(note.id)}
                            onClick={() => setViewNoteId(viewNoteId === String(note.id) ? null : String(note.id))}
                            className={"text-[10px] px-2 py-0.5 rounded-full border hover:bg-[var(--bg-hover)] " + (viewNoteId === String(note.id) ? "border-cyan-600 text-cyan-600 bg-cyan-500/10" : "border-[var(--border-color)] text-[var(--text-secondary)] bg-[var(--bg-page)]")}
                          >
                            📝 {note.title}
                          </button>
                        ))}
                        {canWrite && (
                          <button onClick={() => setAddingNoteFor(addingNoteFor === String(e.id) ? null : String(e.id))} className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-[var(--border-color)] text-cyan-600 hover:bg-[var(--bg-hover)]">
                            + Notatka
                          </button>
                        )}
                      </div>
                      {viewNoteId && (notesByEvent[String(e.id)] || []).some((n: any) => String(n.id) === viewNoteId) && (() => {
                        const note = (notesByEvent[String(e.id)] || []).find((n: any) => String(n.id) === viewNoteId);
                        return (
                          <div className="bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-2 mt-2">
                            {editingNoteId === String(note.id) ? (
                              <div className="space-y-1">
                                <input value={editNoteTitle} onChange={(ev) => setEditNoteTitle(ev.target.value)} className="w-full text-xs font-medium border border-[var(--border-color)] rounded px-1.5 py-1" />
                                <textarea value={editNoteContent} onChange={(ev) => setEditNoteContent(ev.target.value)} rows={6} className="w-full text-xs border border-[var(--border-color)] rounded px-1.5 py-1 whitespace-pre-wrap font-mono" />
                                <div className="flex gap-2">
                                  <button onClick={() => saveEditNote(e.id, note.id)} className="text-xs text-cyan-600 hover:underline">Zapisz</button>
                                  <button onClick={() => setEditingNoteId(null)} className="text-xs text-[var(--text-muted)] hover:underline">Anuluj</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-[var(--text-primary)]">{note.title}</p>
                                  {canWrite && (
                                    <div className="flex gap-2 shrink-0">
                                      <button onClick={() => startEditNote(note)} className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Edytuj</button>
                                      <button onClick={() => { removeNote(e.id, note.id); setViewNoteId(null); }} className="text-[10px] text-red-500 hover:text-red-400">✕</button>
                                    </div>
                                  )}
                                </div>
                                {note.content && <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap mt-1">{note.content}</p>}
                              </>
                            )}
                          </div>
                        );
                      })()}
                      {addingNoteFor === String(e.id) && (
                        <div className="space-y-1 mt-2 bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-2">
                          <input
                            value={newNoteTitle[String(e.id)] || ""}
                            onChange={(ev) => setNewNoteTitle((prev) => ({ ...prev, [String(e.id)]: ev.target.value }))}
                            placeholder="Tytuł notatki (np. Do zabrania, Hotele i adresy)"
                            className="w-full text-xs border border-[var(--border-color)] bg-[var(--bg-card)] rounded px-1.5 py-1"
                          />
                          <textarea
                            value={newNoteContent[String(e.id)] || ""}
                            onChange={(ev) => setNewNoteContent((prev) => ({ ...prev, [String(e.id)]: ev.target.value }))}
                            placeholder="Treść"
                            rows={4}
                            className="w-full text-xs border border-[var(--border-color)] bg-[var(--bg-card)] rounded px-1.5 py-1 whitespace-pre-wrap font-mono"
                          />
                          <div className="flex gap-2">
                            <button onClick={async () => { await addNote(e.id); setAddingNoteFor(null); }} className="text-xs px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded">Dodaj</button>
                            <button onClick={() => setAddingNoteFor(null)} className="text-xs text-[var(--text-muted)] hover:underline">Anuluj</button>
                          </div>
                          {renderNoteNotifyPicker(String(e.id))}
                        </div>
                      )}
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">
                        {formatDate(e.startDate)}{e.endDate !== e.startDate ? " – " + formatDate(e.endDate) : ""} · dodane przez {e.createdBy}
                      </p>
                    </div>
                    <button onClick={() => toggleExpand(e.id)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs shrink-0">
                      {expandedId === String(e.id) ? "Zwiń" : "📎 Pliki"}
                    </button>
                    {canWrite && (
                      <button onClick={() => removeEvent(e.id)} className="text-red-500 hover:text-red-400 text-xs shrink-0">✕</button>
                    )}
                    {expandedId === String(e.id) && (
                      <div className="w-full mt-2 pt-2 border-t border-[var(--border-color-light)] space-y-3">
                        {false && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Notatki</p>
                          {(notesByEvent[String(e.id)] || []).map((note: any) => (
                            <div key={String(note.id)} className="bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-2">
                              {editingNoteId === String(note.id) ? (
                                <div className="space-y-1">
                                  <input value={editNoteTitle} onChange={(ev) => setEditNoteTitle(ev.target.value)} className="w-full text-xs font-medium border border-[var(--border-color)] rounded px-1.5 py-1" />
                                  <textarea value={editNoteContent} onChange={(ev) => setEditNoteContent(ev.target.value)} rows={6} className="w-full text-xs border border-[var(--border-color)] rounded px-1.5 py-1 whitespace-pre-wrap font-mono" />
                                  <div className="flex gap-2">
                                    <button onClick={() => saveEditNote(e.id, note.id)} className="text-xs text-cyan-600 hover:underline">Zapisz</button>
                                    <button onClick={() => setEditingNoteId(null)} className="text-xs text-[var(--text-muted)] hover:underline">Anuluj</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-[var(--text-primary)]">{note.title}</p>
                                    {canWrite && (
                                      <div className="flex gap-2 shrink-0">
                                        <button onClick={() => startEditNote(note)} className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Edytuj</button>
                                        <button onClick={() => removeNote(e.id, note.id)} className="text-[10px] text-red-500 hover:text-red-400">✕</button>
                                      </div>
                                    )}
                                  </div>
                                  {note.content && <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap mt-1">{note.content}</p>}
                                </>
                              )}
                            </div>
                          ))}
                          {(notesByEvent[String(e.id)] || []).length === 0 && (
                            <p className="text-[10px] text-[var(--text-muted)]">Brak notatek.</p>
                          )}
                          {canWrite && (
                            <div className="space-y-1 pt-1">
                              <input
                                value={newNoteTitle[String(e.id)] || ""}
                                onChange={(ev) => setNewNoteTitle((prev) => ({ ...prev, [String(e.id)]: ev.target.value }))}
                                placeholder="Tytuł notatki (np. Plan, Kontakty, Rzeczy do zabrania)"
                                className="w-full text-xs border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-1.5 py-1"
                              />
                              <textarea
                                value={newNoteContent[String(e.id)] || ""}
                                onChange={(ev) => setNewNoteContent((prev) => ({ ...prev, [String(e.id)]: ev.target.value }))}
                                placeholder="Treść"
                                rows={4}
                                className="w-full text-xs border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-1.5 py-1 whitespace-pre-wrap font-mono"
                              />
                              <button onClick={() => addNote(e.id)} className="text-xs px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded">+ Dodaj notatkę</button>
                              {renderNoteNotifyPicker(String(e.id))}
                            </div>
                          )}
                        </div>
                        )}
                        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase pt-1">Załączniki</p>
                        {(attachmentsByEvent[String(e.id)] || []).map(([itemId, name]) => (
                          <div key={itemId} className="flex items-center justify-between text-xs">
                            <button onClick={() => downloadAttachment(itemId, name)} className="text-cyan-600 hover:underline truncate">📎 {name}</button>
                            {canWrite && <button onClick={() => removeAttachment(e.id, itemId)} className="text-red-500 hover:text-red-400 ml-2 shrink-0">✕</button>}
                          </div>
                        ))}
                        {(attachmentsByEvent[String(e.id)] || []).length === 0 && (
                          <p className="text-[10px] text-[var(--text-muted)]">Brak załączników.</p>
                        )}
                        {canWrite && (
                          <label className="text-xs text-cyan-600 cursor-pointer hover:underline inline-block mt-1">
                            {uploadingFor === String(e.id) ? "Wgrywanie..." : "+ Dodaj plik"}
                            <input
                              type="file"
                              className="hidden"
                              disabled={uploadingFor === String(e.id)}
                              onChange={(ev) => {
                                const f = ev.target.files?.[0];
                                if (f) uploadAttachment(e.id, f);
                                ev.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
