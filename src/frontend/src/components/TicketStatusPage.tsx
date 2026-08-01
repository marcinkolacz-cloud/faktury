import { useEffect, useRef, useState } from "react";
import { createPublicActor } from "../lib/publicActor";
import { useTheme } from "../providers/ThemeProvider";

const CHUNK_SIZE = 1_500_000;
const MAX_FILE_SIZE = 5_000_000;

type Lang = "pl" | "en";

const STATUS_LABELS: Record<Lang, Record<string, string>> = {
  pl: {
    open: "Otwarte",
    inProgress: "W trakcie",
    waitingForClient: "Oczekuje na Ciebie",
    closed: "Zamknięte",
  },
  en: {
    open: "Open",
    inProgress: "In progress",
    waitingForClient: "Waiting for you",
    closed: "Closed",
  },
};

const translations = {
  pl: {
    title: "Sprawdź status zgłoszenia",
    tokenPlaceholder: "Numer zgłoszenia",
    check: "Sprawdź",
    checking: "...",
    createdLabel: "Utworzone:",
    attachmentsLabel: "Załączniki:",
    repliesLabel: "Odpowiedzi:",
    replyPlaceholder: "Napisz odpowiedź...",
    send: "Wyślij wiadomość",
    sending: "Wysyłanie...",
    noResults: "Brak wyników.",
    notFound: "Nie znaleziono zgłoszenia o podanym numerze.",
    genericError: "Wystąpił błąd. Spróbuj ponownie.",
    replyFailed: "Nie udało się wysłać wiadomości.",
  },
  en: {
    title: "Check ticket status",
    tokenPlaceholder: "Ticket number",
    check: "Check",
    checking: "...",
    createdLabel: "Created:",
    attachmentsLabel: "Attachments:",
    repliesLabel: "Replies:",
    replyPlaceholder: "Write a reply...",
    send: "Send message",
    sending: "Sending...",
    noResults: "No results.",
    notFound: "No ticket found with this number.",
    genericError: "An error occurred. Please try again.",
    replyFailed: "Failed to send message.",
  },
};

function statusFromVariant(v: any): string {
  return Object.keys(v)[0];
}

function formatDate(ns: bigint, lang: Lang): string {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TicketStatusPage() {
  const { theme, toggleTheme } = useTheme();
  const [lang, setLang] = useState<Lang>("pl");
  const t = translations[lang];

  useEffect(() => {
    document.title = "Bas App Check Status";
  }, []);

  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token") || "";
  const [tokenInput, setTokenInput] = useState(tokenFromUrl);
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [replyMessage, setReplyMessage] = useState("");
  const [replyHoneypot, setReplyHoneypot] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState("");

  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadAttachment = async (file: File) => {
    if (!ticket) return;
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("Plik zbyt duży (max 5MB): " + file.name);
      return;
    }
    setUploadingAttachment(true);
    setUploadError("");
    try {
      const actor = await createPublicActor();
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const attachmentId = await actor.createTicketAttachment(
        ticket.id,
        file.name,
        file.type || "application/octet-stream",
        file.size,
        totalChunks,
        "Klient",
        "",
        [tokenInput.trim()]
      );
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
        await actor.uploadTicketAttachmentChunk(attachmentId, i, chunk, [tokenInput.trim()]);
      }
      const attResult = await actor.listTicketAttachments(ticket.id, [tokenInput.trim()]);
      setAttachments(attResult as any[]);
    } catch (e) {
      setUploadError(t.genericError);
    }
    setUploadingAttachment(false);
  };

  const downloadAttachment = async (a: any) => {
    const actor = await createPublicActor();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < Number(a.totalChunks); i++) {
      const chunk = await actor.getTicketAttachmentChunk(a.id, i, [tokenInput.trim()]) as any[];
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

  const lookup = async (token: string) => {
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const actor = await createPublicActor();
      const result = await actor.getTicketByToken(token.trim());
      const arr = result as any[];
      if (arr.length > 0) {
        setTicket(arr[0]);
        const attResult = await actor.listTicketAttachments(arr[0].id, [token.trim()]);
        setAttachments(attResult as any[]);
      } else {
        setTicket(null);
        setAttachments([]);
        setError(t.notFound);
      }
    } catch (e) {
      setError(t.genericError);
    }
    setLoading(false);
  };

  const sendReply = async () => {
    if (!replyMessage.trim() || !ticket) return;
    setSendingReply(true);
    setReplyError("");
    try {
      const actor = await createPublicActor();
      const ok = await actor.addClientReply(tokenInput.trim(), replyMessage.trim(), replyHoneypot);
      if (ok) {
        setReplyMessage("");
        await lookup(tokenInput);
      } else {
        setReplyError(t.replyFailed);
      }
    } catch (e) {
      setReplyError(t.genericError);
    }
    setSendingReply(false);
  };

  useEffect(() => {
    if (tokenFromUrl) { lookup(tokenFromUrl); }
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center p-6"
      style={{ backgroundImage: "url(/login-background.png)" }}
    >
      <div className="max-w-md w-full bg-[var(--bg-card)]/95 rounded-lg p-6 shadow-lg space-y-3">
        <div className="flex justify-between items-center mb-1">
          <button onClick={toggleTheme} className="px-2 py-0.5 text-xs border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="flex gap-1">
            <button
              onClick={() => setLang("pl")}
              className={"px-2 py-0.5 text-xs rounded " + (lang === "pl" ? "bg-cyan-600 text-white" : "text-[var(--text-muted)]")}
            >
              PL
            </button>
            <button
              onClick={() => setLang("en")}
              className={"px-2 py-0.5 text-xs rounded " + (lang === "en" ? "bg-cyan-600 text-white" : "text-[var(--text-muted)]")}
            >
              EN
            </button>
          </div>
        </div>
        <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-9" />
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t.title}</h1>
        <div className="flex gap-2">
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t.tokenPlaceholder}
            className="flex-1 border border-[var(--border-color)] rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => lookup(tokenInput)}
            disabled={loading}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50"
          >
            {loading ? t.checking : t.check}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {ticket && (
          <div className="space-y-3 pt-2">
            <div>
              <h2 className="font-semibold text-[var(--text-primary)]">{ticket.subject}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t.createdLabel} {formatDate(ticket.createdAt, lang)}</p>
            </div>
            <div className="inline-block px-2 py-1 rounded text-xs text-white bg-cyan-600">
              {STATUS_LABELS[lang][statusFromVariant(ticket.status)] || "—"}
            </div>
            <p className="text-sm text-[var(--text-secondary)] bg-[var(--bg-page)] rounded p-3">{ticket.description}</p>
            {attachments.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-[var(--text-muted)]">{t.attachmentsLabel}</p>
                {attachments.map((a) => (
                  <button
                    key={String(a.id)}
                    onClick={() => downloadAttachment(a)}
                    className="block text-xs text-cyan-600 hover:underline"
                  >
                    📎 {a.name} ({(Number(a.size) / 1024).toFixed(0)} KB)
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAttachment(f);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAttachment}
                className="text-xs text-cyan-600 hover:underline disabled:opacity-50"
              >
                {uploadingAttachment ? "Wgrywanie..." : "📎 Dodaj załącznik (max 5MB)"}
              </button>
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            </div>
            {ticket.replies.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--text-muted)]">{t.repliesLabel}</p>
                {ticket.replies.map((r: any, idx: number) => (
                  <div key={idx} className="text-sm bg-cyan-500/10 rounded p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-[var(--text-primary)]">{r.author}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{formatDate(r.createdAt, lang)}</p>
                    </div>
                    <p className="text-[var(--text-secondary)]">{r.message}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2 pt-2">
              <textarea
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                placeholder={t.replyPlaceholder}
                rows={3}
                className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm resize-none"
              />
              <input
                type="text"
                value={replyHoneypot}
                onChange={(e) => setReplyHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              {replyError && <p className="text-red-600 text-sm">{replyError}</p>}
              <button
                onClick={sendReply}
                disabled={sendingReply || !replyMessage.trim()}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50 text-sm"
              >
                {sendingReply ? t.sending : t.send}
              </button>
            </div>
          </div>
        )}
        {searched && !ticket && !loading && !error && (
          <p className="text-sm text-[var(--text-muted)]">{t.noResults}</p>
        )}
      </div>
    </div>
  );
}
