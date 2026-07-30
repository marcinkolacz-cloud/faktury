import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";

const STATUS_LABELS: Record<string, string> = {
  open: "Otwarte",
  inProgress: "W trakcie",
  waitingForClient: "Oczekuje na klienta",
  closed: "Zamknięte",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-cyan-600",
  inProgress: "bg-amber-500",
  waitingForClient: "bg-purple-500",
  closed: "bg-gray-400",
};

function formatDate(ns: bigint): string {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleDateString("pl-PL", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusFromVariant(v: any): string {
  return Object.keys(v)[0];
}

function statusToVariant(s: string) {
  return { [s]: null };
}

export function TicketsModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [replyText, setReplyText] = useState("");
  const [myRole, setMyRole] = useState<string>("read");
  const [translatedDescription, setTranslatedDescription] = useState("");
  const [translatingDescription, setTranslatingDescription] = useState(false);
  const [translatedReply, setTranslatedReply] = useState("");
  const [translatingReply, setTranslatingReply] = useState(false);
  const [authorName, setAuthorName] = useState(() => localStorage.getItem("ticketAuthorName") || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [ticketExtras, setTicketExtras] = useState<Record<string, { company: string; deviceNumber: string }>>({});
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [seenCounts, setSeenCounts] = useState<Record<string, number>>({});

  const loadSeenCounts = async () => {
    try {
      const result = await actor.getTicketSeenCounts();
      const map: Record<string, number> = {};
      for (const [id, count] of result as any[]) {
        map[String(id)] = Number(count);
      }
      setSeenCounts(map);
    } catch {
      // ignore
    }
  };

  const unreadCount = (t: any): number => {
    const seen = seenCounts[String(t.id)] || 0;
    return Math.max(0, t.replies.length - seen);
  };
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const CHUNK_SIZE = 1_500_000;
  const MAX_FILE_SIZE = 5_000_000;

  const loadAttachments = async (ticketId: bigint) => {
    try {
      const result = await actor.listTicketAttachments(ticketId);
      setAttachments(result as any[]);
    } catch {
      setAttachments([]);
    }
  };

  const uploadTeamAttachment = async (file: File) => {
    if (!selected) return;
    if (file.size > MAX_FILE_SIZE) {
      alert("Plik zbyt duży (max 5MB): " + file.name);
      return;
    }
    setUploadingAttachment(true);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const attachmentId = await actor.createTicketAttachment(
      selected.id,
      file.name,
      file.type || "application/octet-stream",
      file.size,
      totalChunks,
      authorName.trim() || "Zespół",
      "",
    );
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
      await actor.uploadTicketAttachmentChunk(attachmentId, i, chunk);
    }
    setUploadingAttachment(false);
    loadAttachments(selected.id);
  };

  const downloadAttachment = async (a: any) => {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < Number(a.totalChunks); i++) {
      const chunk = await actor.getTicketAttachmentChunk(a.id, i);
      if (chunk && chunk.length > 0) parts.push(new Uint8Array(chunk[0]));
    }
    const blob = new Blob(parts as BlobPart[], { type: a.contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteAttachment = async (id: bigint) => {
    if (!confirm("Usunąć ten załącznik?")) return;
    await actor.deleteTicketAttachment(id);
    if (selected) loadAttachments(selected.id);
  };

  const loadArchivedIds = async () => {
    try {
      const result = await actor.listArchivedTicketIds();
      setArchivedIds(new Set((result as any[]).map((id) => String(id))));
    } catch {
      // ignore
    }
  };

  const toggleArchive = async (id: bigint, archive: boolean) => {
    if (archive) {
      await actor.archiveTicket(id);
    } else {
      await actor.unarchiveTicket(id);
    }
    loadArchivedIds();
  };

  const loadTicketExtras = async () => {
    try {
      const result = await actor.listTicketExtras();
      const map: Record<string, { company: string; deviceNumber: string }> = {};
      for (const [id, extras] of result as any[]) {
        map[String(id)] = { company: extras.company, deviceNumber: extras.deviceNumber };
      }
      setTicketExtras(map);
    } catch {
      // ignore
    }
  };

  const loadTrackingToken = async (id: bigint) => {
    setLoadingToken(true);
    setTrackingToken(null);
    try {
      const result = await actor.getTicketTrackingToken(id);
      const arr = result as any[];
      setTrackingToken(arr.length > 0 ? arr[0] : "");
    } catch {
      setTrackingToken("");
    }
    setLoadingToken(false);
  };

  const filteredTickets = tickets.filter((t: any) => {
    const isArchived = archivedIds.has(String(t.id));
    if (!showArchived && isArchived) return false;
    if (showArchived && !isArchived) return false;
    if (statusFilter !== "all" && statusFromVariant(t.status) !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const extras = ticketExtras[String(t.id)];
      const haystack = (t.subject + " " + t.description + " " + t.clientName + " " + t.clientEmail + " " + (extras?.company || "") + " " + (extras?.deviceNumber || "")).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (dateFrom) {
      const ticketDate = new Date(Number(t.createdAt) / 1_000_000);
      const fromDate = new Date(dateFrom);
      if (ticketDate < fromDate) return false;
    }
    if (dateTo) {
      const ticketDate = new Date(Number(t.createdAt) / 1_000_000);
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      if (ticketDate > toDate) return false;
    }
    return true;
  });

  const translate = async (text: string, targetLang: "pl" | "en"): Promise<string> => {
    const res = await fetch("https://bartolini-translate.marcinkolacz.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetLang }),
    });
    const data = await res.json();
    return data.translated || "";
  };

  const translateDescription = async () => {
    if (!selected) return;
    setTranslatingDescription(true);
    const result = await translate(selected.description, "pl");
    setTranslatedDescription(result);
    setTranslatingDescription(false);
  };

  const translateReply = async () => {
    if (!replyText.trim()) return;
    setTranslatingReply(true);
    const result = await translate(replyText.trim(), "en");
    setTranslatedReply(result);
    setTranslatingReply(false);
  };

  const reload = async () => {
    if (!actor) return;
    const t = await actor.listTickets();
    setTickets(t);
    setLoading(false);
    if (selected) {
      const updated = t.find((x: any) => x.id === selected.id);
      if (updated) setSelected(updated);
    }
  };

  useEffect(() => {
    reload();
    loadTicketExtras();
    loadArchivedIds();
    loadSeenCounts();
    if (actor) {
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    const interval = setInterval(() => {
      reload();
    }, 3000);
    return () => clearInterval(interval);
  }, [actor]);

  const canWrite = myRole === "write" || myRole === "admin";

  const changeStatus = async (id: bigint, status: string) => {
    await actor.updateTicketStatus(id, statusToVariant(status));
    reload();
  };

  const sendReply = async () => {
    if (!selected || !replyText.trim()) return;
    const name = authorName.trim() || "Zespół";
    const messageText = replyText.trim();
    const wasInternal = isInternalNote;
    await actor.addTicketReply(selected.id, name, messageText, wasInternal);
    setReplyText("");
    setIsInternalNote(false);
    reload();

    if (!wasInternal && selected.clientEmail) {
      let token = "";
      try {
        const tokenResult = await actor.getTicketTrackingToken(selected.id);
        const arr = tokenResult as any[];
        token = arr.length > 0 ? arr[0] : "";
      } catch {
        token = "";
      }
      try {
        await fetch("https://bartolini-ticket-email.marcinkolacz.workers.dev", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: selected.clientEmail,
            subject: "Odpowiedź na zgłoszenie: " + selected.subject,
            message: messageText,
            ticketId: String(selected.id),
            trackingToken: token,
          }),
        });
      } catch {
        // Email sending failure should not block the reply itself
      }
    }
  };

  const updateAuthorName = (v: string) => {
    setAuthorName(v);
    localStorage.setItem("ticketAuthorName", v);
  };

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-500">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4 pb-2">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Zgłoszenia</h1>
        </div>
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-sm overflow-hidden">
            <div className="p-2 space-y-1.5 border-b border-[var(--border-color-light)]">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Szukaj (temat, opis, klient)..."
                className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-xs"
              />
              <div className="flex gap-1">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="flex-1 border border-[var(--border-color)] rounded px-1 py-1 text-xs"
                >
                  <option value="all">Wszystkie statusy</option>
                  {Object.keys(STATUS_LABELS).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 border border-[var(--border-color)] rounded px-1 py-1 text-xs"
                  title="Od daty"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 border border-[var(--border-color)] rounded px-1 py-1 text-xs"
                  title="Do daty"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Pokaż zarchiwizowane
              </label>
              {(searchQuery || statusFilter !== "all" || dateFrom || dateTo) && (
                <button
                  onClick={() => { setSearchQuery(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}
                  className="text-[10px] text-cyan-600 hover:underline"
                >
                  Wyczyść filtry
                </button>
              )}
            </div>
            <div className="overflow-auto max-h-[600px]">
              {filteredTickets.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">{tickets.length === 0 ? "Brak zgłoszeń." : "Brak wyników dla podanych filtrów."}</p>
              ) : (
                [...filteredTickets].reverse().map((t, idx) => (
                  <button
                    key={String(t.id)}
                    onClick={async () => {
                      setSelected(t);
                      setTranslatedDescription("");
                      setTranslatedReply("");
                      loadTrackingToken(t.id);
                      loadAttachments(t.id);
                      await actor.markTicketSeen(t.id);
                      loadSeenCounts();
                    }}
                    className={"w-full text-left p-3 border-b border-[var(--border-color-light)] hover:bg-[var(--bg-page)] " + (selected?.id === t.id ? "bg-cyan-500/10" : "")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm text-[var(--text-primary)] truncate flex items-center gap-1.5">
                        <span className="shrink-0 text-[10px] text-gray-400 font-mono">{idx + 1}.</span>
                        {unreadCount(t) > 0 && (
                          <span className="shrink-0 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                            {unreadCount(t)}
                          </span>
                        )}
                        {t.subject}
                      </p>
                      <span className={"shrink-0 text-[10px] px-1.5 py-0.5 rounded text-white " + STATUS_COLORS[statusFromVariant(t.status)]}>
                        {STATUS_LABELS[statusFromVariant(t.status)]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {t.clientName}
                      {ticketExtras[String(t.id)]?.company && <> · {ticketExtras[String(t.id)].company}</>}
                      {ticketExtras[String(t.id)]?.deviceNumber && <> · {ticketExtras[String(t.id)].deviceNumber}</>}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-[var(--text-muted)]">{formatDate(t.createdAt)}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{t.replies.length} {t.replies.length === 1 ? "odpowiedź" : "odpowiedzi"}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-sm p-4">
            {!selected ? (
              <p className="text-sm text-gray-500">Wybierz zgłoszenie z listy.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-[var(--text-primary)]">{selected.subject}</h2>
                    <p className="text-xs text-gray-500">{selected.clientName} ({selected.clientEmail})</p>
                    {(ticketExtras[String(selected.id)]?.company || ticketExtras[String(selected.id)]?.deviceNumber) && (
                      <p className="text-xs text-gray-500">
                        {ticketExtras[String(selected.id)]?.company && <>Firma: <span className="font-medium">{ticketExtras[String(selected.id)].company}</span></>}
                        {ticketExtras[String(selected.id)]?.company && ticketExtras[String(selected.id)]?.deviceNumber && " · "}
                        {ticketExtras[String(selected.id)]?.deviceNumber && <>Urządzenie: <span className="font-medium">{ticketExtras[String(selected.id)].deviceNumber}</span></>}
                      </p>
                    )}
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Zgłoszenie #{String(selected.id)} · Utworzone: {formatDate(selected.createdAt)}
                    </p>
                    <div className="mt-2 flex items-center gap-2 bg-cyan-950/10 border border-cyan-800/30 rounded px-2 py-1.5">
                      <span className="text-[11px] text-[var(--text-muted)] shrink-0">Token śledzenia klienta:</span>
                      {loadingToken ? (
                        <span className="text-[11px] text-[var(--text-muted)]">...</span>
                      ) : trackingToken ? (
                        <>
                          <span className="font-mono text-xs font-semibold text-[var(--text-primary)] select-all">{trackingToken}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(trackingToken)}
                            className="text-[10px] text-cyan-600 hover:underline shrink-0 ml-auto"
                          >
                            Kopiuj
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)] italic">brak (starsze zgłoszenie)</span>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <select
                      value={statusFromVariant(selected.status)}
                      onChange={(e) => changeStatus(selected.id, e.target.value)}
                      className="border border-[var(--border-color)] rounded px-2 py-1 text-sm"
                    >
                      {Object.keys(STATUS_LABELS).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                </div>
                {canWrite && (
                  <div className="flex justify-end mt-2">
                    {archivedIds.has(String(selected.id)) ? (
                      <button
                        onClick={() => toggleArchive(selected.id, false)}
                        className="text-xs text-cyan-600 hover:underline"
                      >
                        ↩ Przywróć z archiwum
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleArchive(selected.id, true)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        🗄 Zarchiwizuj zgłoszenie
                      </button>
                    )}
                  </div>
                )}
                <div className="bg-[var(--bg-page)] rounded p-3 space-y-2">
                  <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{selected.description}</p>
                  {attachments.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-[var(--border-color-light)]">
                      <p className="text-[10px] font-medium text-[var(--text-muted)]">Załączniki:</p>
                      {attachments.map((a) => (
                        <div key={String(a.id)} className="flex items-center gap-2 text-xs">
                          <button onClick={() => downloadAttachment(a)} className="text-cyan-600 hover:underline">
                            📎 {a.name} ({(Number(a.size) / 1024).toFixed(0)} KB)
                          </button>
                          <span className="text-[10px] text-[var(--text-muted)]">— {a.uploadedBy}</span>
                          {canWrite && (
                            <button onClick={() => deleteAttachment(a.id)} className="text-red-500 hover:text-red-400 ml-auto">✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {canWrite && (
                    <div className="pt-2 border-t border-[var(--border-color-light)]">
                      <input
                        type="file"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadTeamAttachment(file);
                          e.target.value = "";
                        }}
                        disabled={uploadingAttachment}
                        className="text-xs text-[var(--text-secondary)]"
                      />
                      {uploadingAttachment && <p className="text-[10px] text-cyan-600 mt-1">Wysyłanie...</p>}
                    </div>
                  )}
                  <button onClick={translateDescription} disabled={translatingDescription} className="text-xs text-cyan-600 hover:underline disabled:opacity-50">
                    {translatingDescription ? "Tłumaczenie..." : "Przetłumacz na polski"}
                  </button>
                  {translatedDescription && (
                    <p className="text-sm text-[var(--text-primary)] bg-cyan-950/10 border border-cyan-800/30 rounded p-2">{translatedDescription}</p>
                  )}
                </div>
                <div className="space-y-2">
                  {selected.replies.map((r: any, idx: number) => (
                    <div key={idx} className={"text-sm rounded p-2 " + (r.isInternal ? "bg-amber-500/10 border border-amber-800/30" : "bg-cyan-500/10")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-[var(--text-primary)]">{r.author}</p>
                          {r.isInternal && (
                            <span className="text-[9px] bg-amber-500 text-white px-1 py-0.5 rounded">Wewnętrzna</span>
                          )}
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">{formatDate(r.createdAt)}</p>
                      </div>
                      <p className="text-[var(--text-secondary)]">{r.message}</p>
                    </div>
                  ))}
                </div>
                {canWrite && (
                  <div className="space-y-2">
                    <input
                      value={authorName}
                      onChange={(e) => updateAuthorName(e.target.value)}
                      placeholder="Twoje imię (widoczne dla klienta)"
                      className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-xs"
                    />
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      placeholder="Odpowiedz klientowi..."
                      className="w-full border border-[var(--border-color)] rounded px-2 py-1.5 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={isInternalNote}
                        onChange={(e) => setIsInternalNote(e.target.checked)}
                      />
                      Notatka wewnętrzna (niewidoczna dla klienta)
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={sendReply}
                        className={"px-3 py-1.5 text-white rounded text-sm " + (isInternalNote ? "bg-amber-600 hover:bg-amber-500" : "bg-cyan-600 hover:bg-cyan-500")}
                      >
                        {isInternalNote ? "Zapisz notatkę" : "Wyślij odpowiedź klientowi"}
                      </button>
                      <button onClick={translateReply} disabled={translatingReply || !replyText.trim()} className="text-xs text-cyan-600 hover:underline disabled:opacity-50">
                        {translatingReply ? "Tłumaczenie..." : "Przetłumacz na angielski"}
                      </button>
                    </div>
                    {translatedReply && (
                      <div className="text-sm bg-cyan-950/10 border border-cyan-800/30 rounded p-2 space-y-1">
                        <p className="text-[var(--text-primary)]">{translatedReply}</p>
                        <button onClick={() => { setReplyText(translatedReply); setTranslatedReply(""); }} className="text-xs text-cyan-600 hover:underline">
                          Użyj tego tłumaczenia zamiast oryginału
                        </button>
                      </div>
                    )}
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
