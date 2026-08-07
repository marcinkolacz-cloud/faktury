import { useState, useEffect } from "react";
import { createPublicActor } from "../lib/publicActor";
import { useTheme } from "../providers/ThemeProvider";
import { odCreateFolderPublic, odUploadFilePublic, odListPublic } from "../lib/oneDriveConfig";

type Lang = "pl" | "en";

const translations = {
  pl: {
    title: "Zgłoś problem",
    name: "Imię i nazwisko",
    email: "Email",
    company: "Firma",
    deviceNumber: "Numer urządzenia (np. BAS005, TRA005)",
    subject: "Temat",
    description: "Opisz problem",
    submit: "Wyślij zgłoszenie",
    sending: "Wysyłanie...",
    thanksTitle: "Dziękujemy!",
    thanksBody: "Twoje zgłoszenie zostało przyjęte. Skontaktujemy się wkrótce.",
    errorFill: "Wypełnij wszystkie pola.",
    errorSend: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie.",
  },
  en: {
    title: "Report an Issue",
    name: "Full name",
    email: "Email",
    company: "Company",
    deviceNumber: "Device number (e.g. BAS005, TRA005)",
    subject: "Subject",
    description: "Describe the issue",
    submit: "Send report",
    sending: "Sending...",
    thanksTitle: "Thank you!",
    thanksBody: "Your report has been received. We will contact you shortly.",
    errorFill: "Please fill in all fields.",
    errorSend: "Failed to send report. Please try again.",
  },
};

export function PublicTicketForm() {
  const { theme, toggleTheme } = useTheme();
  const [lang, setLang] = useState<Lang>("pl");
  const t = translations[lang];

  useEffect(() => {
    document.title = "Bas App Ticket";
  }, []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [deviceNumber, setDeviceNumber] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const MAX_FILE_SIZE = 5_000_000;
  const CHUNK_SIZE = 1_500_000;
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [trackingToken, setTrackingToken] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim() || !email.trim() || !subject.trim() || !description.trim()) {
      setError(t.errorFill);
      return;
    }
    setSending(true);
    setError("");
    try {
      const actor = await createPublicActor();
      const submitResult = await actor.submitTicket(name.trim(), email.trim(), subject.trim(), description.trim(), honeypot, company.trim(), deviceNumber.trim()) as [bigint, string];
      const [ticketId, token] = submitResult;
      if (files.length > 0) {
        const driveTokenResult = await actor.requestTicketUploadDriveToken(token) as [] | [string];
        const driveToken = driveTokenResult.length ? driveTokenResult[0] : null;
        const folderPath = "Zgloszenia/" + String(ticketId);
        if (driveToken) {
          try {
            const rootListing = await odListPublic("", driveToken);
            const rootHasFolder = (rootListing.items || []).some((i: any) => i.isFolder && i.name === "Zgloszenia");
            if (!rootHasFolder) await odCreateFolderPublic("", "Zgloszenia", driveToken);
            await odCreateFolderPublic("Zgloszenia", String(ticketId), driveToken);
          } catch { /* folder may already exist */ }
        }
        for (const file of files) {
          setUploadProgress("Wysyłam załącznik: " + file.name);
          if (driveToken) {
            const oneDriveItemId = await odUploadFilePublic(folderPath, file, driveToken);
            if (oneDriveItemId) {
              await actor.recordTicketDriveAttachment(ticketId, file.name, oneDriveItemId, name.trim(), [token]);
            }
          } else {
            // Fallback: Drive token unavailable (e.g. admin not yet bootstrapped)
            // — store the file on-chain in small chunks so the report still
            // goes through with its attachment rather than silently dropping it.
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const attachmentId = await actor.createTicketAttachment(
              ticketId, file.name, file.type || "application/octet-stream", file.size, totalChunks, name.trim(), "", [token],
            );
            for (let i = 0; i < totalChunks; i++) {
              const start = i * CHUNK_SIZE;
              const end = Math.min(start + CHUNK_SIZE, file.size);
              const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
              await actor.uploadTicketAttachmentChunk(attachmentId, i, chunk, [token]);
            }
          }
        }
      }
      setUploadProgress("");
      setTrackingToken(token as string);
      setSubmitted(true);
    } catch (e) {
      setError(t.errorSend);
    }
    setSending(false);
  };

  const LangSwitcher = () => (
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
  );

  if (submitted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-cover bg-center p-6"
        style={{ backgroundImage: "url(/login-background.png)" }}
      >
        <div className="max-w-md w-full bg-[var(--bg-card)]/95 rounded-lg p-8 shadow-lg text-center space-y-3">
          <LangSwitcher />
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-10 mx-auto" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t.thanksTitle}</h1>
          <p className="text-[var(--text-muted)] text-sm">{t.thanksBody}</p>
          <div className="bg-cyan-950/10 border border-cyan-800/30 rounded p-3 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">
              {lang === "pl" ? "Numer zgłoszenia (zapisz, żeby sprawdzić status):" : "Tracking number (save it to check status):"}
            </p>
            <p className="font-mono text-sm font-semibold text-[var(--text-primary)] select-all">{trackingToken}</p>
          </div>
          <a href={"/status?token=" + trackingToken} className="text-xs text-cyan-600 hover:underline">
            {lang === "pl" ? "Sprawdź status zgłoszenia →" : "Check ticket status →"}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center p-6"
      style={{ backgroundImage: "url(/login-background.png)" }}
    >
      <div className="max-w-md w-full bg-[var(--bg-card)]/95 rounded-lg p-6 shadow-lg space-y-3">
        <LangSwitcher />
        <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-9" />
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t.title}</h1>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email} type="email" className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t.company} className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
        <input value={deviceNumber} onChange={(e) => setDeviceNumber(e.target.value)} placeholder={t.deviceNumber} className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t.subject} className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.description} rows={5} className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
        <div>
          <input
            type="file"
            multiple
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              const tooBig = selected.filter((f) => f.size > MAX_FILE_SIZE);
              if (tooBig.length > 0) {
                setError((lang === "pl" ? "Plik zbyt duży (max 5MB): " : "File too large (max 5MB): ") + tooBig.map((f) => f.name).join(", "));
                return;
              }
              setError("");
              setFiles(selected);
            }}
            className="w-full text-xs text-[var(--text-secondary)]"
          />
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            {lang === "pl" ? "Załączniki (opcjonalnie, max 5MB każdy)" : "Attachments (optional, max 5MB each)"}
          </p>
          {files.length > 0 && (
            <ul className="text-xs text-[var(--text-secondary)] mt-1">
              {files.map((f, i) => (
                <li key={i}>{f.name} ({(f.size / 1024).toFixed(0)} KB)</li>
              ))}
            </ul>
          )}
          {uploadProgress && <p className="text-[10px] text-cyan-600 mt-1">{uploadProgress}</p>}
        </div>
        <input
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="absolute opacity-0 pointer-events-none -z-10"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button onClick={submit} disabled={sending} className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50">
          {sending ? t.sending : t.submit}
        </button>
        
        <a
          href="/status"
          className="block text-center text-sm font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded px-3 py-2 transition-colors"
        >
          {lang === "pl" ? "📋 Masz już numer zgłoszenia? Sprawdź status" : "📋 Already have a ticket number? Check status"}
        </a>
      </div>
    </div>
  );
}
