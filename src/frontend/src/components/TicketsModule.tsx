import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { InfoTip } from "./InfoTip";
import { setDriveActor, odCreateFolder, odUploadFile, odList, odDownloadUrl } from "../lib/oneDriveConfig";
import { DriveFolderPanel } from "./DriveFolderPanel";
import { sendEmailNotification } from "../lib/emailNotify";

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
  const [showEventDateForm, setShowEventDateForm] = useState(false);
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [notifyTeamEmails, setNotifyTeamEmails] = useState<string[]>([]);
  const [teamNotifyResult, setTeamNotifyResult] = useState<string | null>(null);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [ticketExtras, setTicketExtras] = useState<Record<string, { company: string; deviceNumber: string }>>({});
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [seenCounts, setSeenCounts] = useState<Record<string, number>>({});
  const [ticketLinks, setTicketLinks] = useState<Record<string, { calendarEventId: bigint | null }>>({});
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [linkingEvent, setLinkingEvent] = useState(false);
  const [selectedEventToLink, setSelectedEventToLink] = useState("");
  const [ticketFolderPath, setTicketFolderPath] = useState<string | null>(null);

  const loadTicketLinks = async () => {
    try {
      const result = await actor.listTicketLinks();
      const map: Record<string, { calendarEventId: bigint | null }> = {};
      for (const [id, l] of result as any[]) {
        map[String(id)] = {
          calendarEventId: l.calendarEventId.length ? l.calendarEventId[0] : null,
        };
      }
      setTicketLinks(map);
    } catch {
      // ignore
    }
  };

  const loadTicketFolder = async (ticketId: bigint) => {
    try {
      const result = await actor.getTicketDriveFolder(ticketId);
      setTicketFolderPath(result.length ? result[0] : null);
    } catch {
      setTicketFolderPath(null);
    }
  };

  const loadCalendarEvents = async () => {
    try { setCalendarEvents(await actor.listCalendarEvents()); } catch { setCalendarEvents([]); }
  };

  const createEventForTicket = async () => {
    if (!selected) return;
    setLinkingEvent(true);
    const start = eventStartDate || new Date().toISOString().slice(0, 10);
    const end = eventEndDate || start;
    await actor.createCalendarEventForTicket(
      selected.id,
      "Zgłoszenie #" + String(selected.id) + ": " + selected.subject,
      selected.description,
      start,
      end,
      { task: null },
      authorName.trim() || "Zespół",
    );
    await Promise.all([loadTicketLinks(), loadCalendarEvents()]);
    setLinkingEvent(false);
    setShowEventDateForm(false);
    setEventStartDate("");
    setEventEndDate("");
  };

  const dateRangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
    aStart <= (bEnd || bStart) && bStart <= (aEnd || aStart);

  const conflictingEvents = (() => {
    if (!eventStartDate) return [];
    const end = eventEndDate || eventStartDate;
    return calendarEvents.filter((e: any) => dateRangesOverlap(eventStartDate, end, e.startDate, e.endDate));
  })();

  const linkExistingEvent = async (eventId: string) => {
    if (!selected || !eventId) return;
    await actor.linkTicketCalendarEvent(selected.id, BigInt(eventId));
    setSelectedEventToLink("");
    loadTicketLinks();
  };

  const unlinkEvent = async () => {
    if (!selected) return;
    await actor.unlinkTicketCalendarEvent(selected.id);
    loadTicketLinks();
  };

  const linkTicketFolder = async (path: string) => {
    if (!selected) return;
    await actor.linkTicketDriveFolder(selected.id, path);
    await loadTicketFolder(selected.id);
  };

  const unlinkTicketFolder = async () => {
    if (!selected) return;
    await actor.unlinkTicketDriveFolder(selected.id);
    await loadTicketFolder(selected.id);
  };

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
  const MAX_FILE_SIZE = 50_000_000;

  const loadAttachments = async (ticketId: bigint) => {
    try {
      const [legacy, driveOnes] = await Promise.all([
        actor.listTicketAttachments(ticketId, []).catch(() => []),
        actor.listTicketDriveAttachments(ticketId, []).catch(() => []),
      ]);
      const legacyTagged = (legacy as any[]).map((a) => ({ ...a, kind: "legacy" }));
      const driveTagged = (driveOnes as any[]).map((a) => ({ ...a, kind: "drive" }));
      setAttachments([...driveTagged, ...legacyTagged]);
    } catch {
      setAttachments([]);
    }
  };

  const ensureTicketDriveFolder = async (ticketId: bigint) => {
    const rootListing = await odList("");
    const rootHasFolder = (rootListing.items || []).some((i: any) => i.isFolder && i.name === "Zgloszenia");
    if (!rootHasFolder) await odCreateFolder("", "Zgloszenia");
    const listing = await odList("Zgloszenia");
    const exists = (listing.items || []).some((i: any) => i.isFolder && i.name === String(ticketId));
    if (!exists) await odCreateFolder("Zgloszenia", String(ticketId));
  };

  const uploadTeamAttachment = async (file: File) => {
    if (!selected) return;
    if (file.size > MAX_FILE_SIZE) {
      alert("Plik zbyt duży (max 50MB): " + file.name);
      return;
    }
    setUploadingAttachment(true);
    try {
      await ensureTicketDriveFolder(selected.id);
      await odUploadFile("Zgloszenia/" + String(selected.id), file);
      const listing = await odList("Zgloszenia/" + String(selected.id));
      const uploaded = (listing.items || []).find((i: any) => i.name === file.name);
      if (uploaded?.id) {
        await actor.recordTicketDriveAttachment(selected.id, file.name, uploaded.id, authorName.trim() || "Zespół", []);
      }
    } finally {
      setUploadingAttachment(false);
      loadAttachments(selected.id);
    }
  };

  const downloadAttachment = async (a: any) => {
    if (a.kind === "drive") {
      const result = await odDownloadUrl(a.oneDriveItemId);
      if (result?.url) window.open(result.url, "_blank");
      return;
    }
    const parts: Uint8Array[] = [];
    for (let i = 0; i < Number(a.totalChunks); i++) {
      const chunk = await actor.getTicketAttachmentChunk(a.id, i, []);
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

  const deleteAttachment = async (a: any) => {
    if (a.kind === "drive") {
      // Drive-backed attachments live in OneDrive — delete/manage the file
      // there directly (Bartolini Drive) rather than through this ticket.
      alert("Ten załącznik jest w Bartolini Drive (folder Zgloszenia/" + String(a.ticketId) + "). Usuń go stamtąd, jeśli trzeba.");
      return;
    }
    if (!confirm("Przenieść ten załącznik do kosza?")) return;
    await actor.trashTicketAttachment(a.id);
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
  const ticketRankMap = new Map<string, number>();
  [...filteredTickets].sort((a, b) => Number(a.id - b.id)).forEach((t, i) => ticketRankMap.set(String(t.id), i + 1));

  const translate = async (text: string, targetLang: "pl" | "en"): Promise<string> => {
    // The translate Worker used to accept requests with zero
    // authentication (anyone on the internet could burn our OpenAI
    // quota). It now requires a short-lived token minted by the
    // canister for the currently logged-in staff member.
    const staffToken = await actor.requestStaffActionToken();
    const res = await fetch("https://bartolini-translate.marcinkolacz.workers.dev", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + staffToken,
      },
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
    loadTicketLinks();
    loadCalendarEvents();
    if (actor) {
      setDriveActor(actor);
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
      actor.listSubscribers().then(setSubscribers).catch(() => setSubscribers([]));
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    const interval = setInterval(() => {
      reload();
    }, 3000);
    return () => clearInterval(interval);
  }, [actor]);

  useEffect(() => {
    if (selected?.id !== undefined) loadTicketFolder(selected.id);
    else setTicketFolderPath(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

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
        // Same reasoning as translate(): this Worker used to be a fully
        // open, unauthenticated email relay reachable by anyone on the
        // internet, capable of sending mail "from" our business domain.
        const staffToken = await actor.requestStaffActionToken();
        await fetch("https://bartolini-ticket-email.marcinkolacz.workers.dev", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + staffToken,
          },
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

    if (notifyTeam && notifyTeamEmails.length > 0) {
      try {
        const res = await sendEmailNotification(
          actor,
          notifyTeamEmails,
          "Zgłoszenie #" + String(selected.id) + ": " + selected.subject,
          messageText
        );
        setTeamNotifyResult("Powiadomiono " + res.ok + "/" + res.total + " adresów.");
      } catch (err) {
        setTeamNotifyResult("Błąd powiadomienia zespołu: " + (err instanceof Error ? err.message : String(err)));
      }
      setNotifyTeam(false);
      setNotifyTeamEmails([]);
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
                        <span className="shrink-0 text-[10px] text-gray-400 font-mono">{ticketRankMap.get(String(t.id)) || idx + 1}.</span>
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
                        {ticketExtras[String(selected.id)]?.deviceNumber && <InfoTip text="Symbol urządzenia (np. BAS001) automatycznie łączy to zgłoszenie z jego kartą w module Rejestr urządzeń — historia zgłoszeń tworzy się tam sama, bez dodatkowych kliknięć." />}
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
                <div className="bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-2 space-y-2">
                  <p className="text-[10px] font-medium text-[var(--text-muted)]">Kalendarz i dysk</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[var(--text-muted)]">📅</span>
                    {ticketLinks[String(selected.id)]?.calendarEventId != null ? (
                      <>
                        <span className="text-[var(--text-secondary)]">
                          {calendarEvents.find((e: any) => e.id === ticketLinks[String(selected.id)].calendarEventId)?.title || ("Wydarzenie #" + String(ticketLinks[String(selected.id)].calendarEventId))}
                        </span>
                        {canWrite && <button onClick={unlinkEvent} className="text-[10px] text-red-500 hover:underline">Odłącz</button>}
                      </>
                    ) : canWrite ? (
                      <>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={showEventDateForm}
                            disabled={linkingEvent}
                            onChange={(e) => setShowEventDateForm(e.target.checked)}
                          />
                          Utwórz wydarzenie w kalendarzu dla tego zgłoszenia
                          <InfoTip text="Otwiera osobny termin realizacji (od–do), niezależny od daty zgłoszenia. System sprawdza kolizje z innymi wydarzeniami w kalendarzu i ostrzega żółtym banerem, jeśli termin jest zajęty." />
                        </label>
                        {showEventDateForm && (
                          <div className="w-full border border-[var(--border-color)] rounded p-2 space-y-1.5 mt-1">
                            <p className="text-[10px] text-[var(--text-muted)]">Termin realizacji (może różnić się od daty zgłoszenia)</p>
                            <div className="flex gap-2 items-center">
                              <input
                                type="date"
                                value={eventStartDate}
                                onChange={(e) => setEventStartDate(e.target.value)}
                                className="border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[11px]"
                              />
                              <span className="text-[10px] text-[var(--text-muted)]">do</span>
                              <input
                                type="date"
                                value={eventEndDate}
                                onChange={(e) => setEventEndDate(e.target.value)}
                                className="border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[11px]"
                              />
                            </div>
                            {conflictingEvents.length > 0 && (
                              <div className="bg-amber-50 border border-amber-300 rounded p-1.5 space-y-0.5">
                                <p className="text-[10px] font-medium text-amber-700">⚠ Termin zajęty przez:</p>
                                {conflictingEvents.map((e: any) => (
                                  <p key={String(e.id)} className="text-[10px] text-amber-700">
                                    {e.title} ({e.startDate}{e.endDate && e.endDate !== e.startDate ? " – " + e.endDate : ""})
                                  </p>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={createEventForTicket}
                                disabled={linkingEvent || !eventStartDate}
                                className={"text-[11px] px-2 py-1 rounded text-white disabled:opacity-40 " + (conflictingEvents.length > 0 ? "bg-amber-600 hover:bg-amber-500" : "bg-cyan-600 hover:bg-cyan-500")}
                              >
                                {conflictingEvents.length > 0 ? "Utwórz mimo kolizji" : "Utwórz wydarzenie"}
                              </button>
                              <button onClick={() => { setShowEventDateForm(false); setEventStartDate(""); setEventEndDate(""); }} className="text-[11px] text-[var(--text-muted)] hover:underline">
                                Anuluj
                              </button>
                            </div>
                          </div>
                        )}
                        {calendarEvents.length > 0 && (
                          <>
                            <select onChange={(e) => setSelectedEventToLink(e.target.value)} value={selectedEventToLink} className="border border-[var(--border-color)] rounded px-1 py-0.5 text-[10px]">
                              <option value="">lub połącz z istniejącym...</option>
                              {calendarEvents.map((e: any) => (
                                <option key={String(e.id)} value={String(e.id)}>{e.title}</option>
                              ))}
                            </select>
                            <button onClick={() => linkExistingEvent(selectedEventToLink)} disabled={!selectedEventToLink} className="text-[10px] text-cyan-600 hover:underline disabled:opacity-40">Połącz</button>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--text-muted)] italic">brak</span>
                    )}
                  </div>
                  <DriveFolderPanel
                    path={ticketFolderPath}
                    basePath="Zgloszenia"
                    defaultName={"Zgloszenie #" + String(selected.id) + " - " + selected.subject}
                    canWrite={canWrite}
                    onLink={linkTicketFolder}
                    onUnlink={unlinkTicketFolder}
                  />
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
                        <div key={(a.kind === "drive" ? "d" : "l") + String(a.id)} className="flex items-center gap-2 text-xs">
                          <button onClick={() => downloadAttachment(a)} className="text-cyan-600 hover:underline">
                            📎 {a.name}{a.kind === "legacy" ? " (" + (Number(a.size) / 1024).toFixed(0) + " KB)" : ""}
                          </button>
                          <span className="text-[10px] text-[var(--text-muted)]">— {a.uploadedBy}</span>
                          {canWrite && (
                            <button onClick={() => deleteAttachment(a)} className="text-red-500 hover:text-red-400 ml-auto">✕</button>
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
                      <InfoTip text="Odpowiedź NIE trafi do klienta — zostaje w systemie jako wewnętrzny komentarz zespołu. Przycisk niżej zmieni się na „Zapisz notatkę”." />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={notifyTeam}
                        onChange={(e) => { setNotifyTeam(e.target.checked); if (!e.target.checked) setNotifyTeamEmails([]); }}
                      />
                      Powiadom zespół mailem
                      <InfoTip text="Dodatkowe powiadomienie do wybranych adresów z listy Powiadomień e-mail — niezależne od tego, czy odpowiedź idzie też do klienta." />
                    </label>
                    {notifyTeam && (
                      <div className="border border-[var(--border-color)] rounded p-2 space-y-1">
                        {subscribers.length === 0 ? (
                          <p className="text-[10px] text-[var(--text-muted)]">Brak adresów na liście (moduł "Powiadomienia e-mail").</p>
                        ) : (
                          subscribers.map((s) => (
                            <label key={s.id} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                              <input
                                type="checkbox"
                                checked={notifyTeamEmails.includes(s.email)}
                                onChange={(e) =>
                                  setNotifyTeamEmails((prev) =>
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
                    {teamNotifyResult && <p className="text-[10px] text-[var(--text-muted)]">{teamNotifyResult}</p>}
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
