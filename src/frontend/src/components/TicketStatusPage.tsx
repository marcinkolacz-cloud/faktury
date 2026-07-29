import { useEffect, useState } from "react";
import { createPublicActor } from "../lib/publicActor";

const STATUS_LABELS: Record<string, string> = {
  open: "Otwarte",
  inProgress: "W trakcie",
  waitingForClient: "Oczekuje na Ciebie",
  closed: "Zamknięte",
};

function statusFromVariant(v: any): string {
  return Object.keys(v)[0];
}

function formatDate(ns: bigint): string {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleDateString("pl-PL", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TicketStatusPage() {
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token") || "";
  const [tokenInput, setTokenInput] = useState(tokenFromUrl);
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);

  const downloadAttachment = async (a: any) => {
    const actor = await createPublicActor();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < Number(a.totalChunks); i++) {
      const chunk = await actor.getTicketAttachmentChunk(a.id, i) as any[];
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
        const attResult = await actor.listTicketAttachments(arr[0].id);
        setAttachments(attResult as any[]);
      } else {
        setTicket(null);
        setAttachments([]);
        setError("Nie znaleziono zgłoszenia o podanym numerze.");
      }
    } catch (e) {
      setError("Wystąpił błąd. Spróbuj ponownie.");
    }
    setLoading(false);
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
        <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-9" />
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Sprawdź status zgłoszenia</h1>
        <div className="flex gap-2">
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Numer zgłoszenia"
            className="flex-1 border border-[var(--border-color)] rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => lookup(tokenInput)}
            disabled={loading}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50"
          >
            {loading ? "..." : "Sprawdź"}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {ticket && (
          <div className="space-y-3 pt-2">
            <div>
              <h2 className="font-semibold text-[var(--text-primary)]">{ticket.subject}</h2>
              <p className="text-xs text-[var(--text-muted)]">Utworzone: {formatDate(ticket.createdAt)}</p>
            </div>
            <div className="inline-block px-2 py-1 rounded text-xs text-white bg-cyan-600">
              {STATUS_LABELS[statusFromVariant(ticket.status)] || "—"}
            </div>
            <p className="text-sm text-[var(--text-secondary)] bg-[var(--bg-page)] rounded p-3">{ticket.description}</p>
            {attachments.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-[var(--text-muted)]">Załączniki:</p>
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
            {ticket.replies.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--text-muted)]">Odpowiedzi:</p>
                {ticket.replies.map((r: any, idx: number) => (
                  <div key={idx} className="text-sm bg-cyan-50 rounded p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-[var(--text-primary)]">{r.author}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{formatDate(r.createdAt)}</p>
                    </div>
                    <p className="text-[var(--text-secondary)]">{r.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {searched && !ticket && !loading && !error && (
          <p className="text-sm text-[var(--text-muted)]">Brak wyników.</p>
        )}
      </div>
    </div>
  );
}
