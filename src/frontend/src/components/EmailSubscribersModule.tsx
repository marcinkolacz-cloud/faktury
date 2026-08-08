import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { InfoTip } from "./InfoTip";

const EMAIL_WORKER_URL = "https://bartolini-ticket-email.marcinkolacz.workers.dev";

const emptyForm = { email: "", name: "", notifyUrgent: true };

export function EmailSubscribersModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>("read");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [showSendForm, setShowSendForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const reload = async () => {
    if (!actor) return;
    const s = await actor.listSubscribers();
    setSubscribers(s);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    if (actor) {
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
    }
  }, [actor]);

  const canWrite = myRole === "write" || myRole === "admin";

  const submitForm = async () => {
    if (!form.email.trim()) return;
    if (editingId !== null) {
      await actor.updateSubscriber(editingId, form.email.trim(), form.name.trim(), form.notifyUrgent);
    } else {
      await actor.addSubscriber(form.email.trim(), form.name.trim(), form.notifyUrgent);
    }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    reload();
  };

  const startEdit = (s: any) => {
    setForm({ email: s.email, name: s.name, notifyUrgent: s.notifyUrgent });
    setEditingId(s.id);
    setShowForm(true);
  };

  const toggleUrgent = async (s: any) => {
    await actor.setSubscriberNotifyUrgent(s.id, !s.notifyUrgent);
    reload();
  };

  const removeSubscriber = async (id: number) => {
    if (!confirm("Usunąć ten adres z listy?")) return;
    await actor.removeSubscriber(id);
    reload();
  };

  const sendUrgentNotification = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const emails: string[] = await actor.getUrgentEmails();
      if (emails.length === 0) {
        setSendResult("Brak adresów zaznaczonych do pilnych powiadomień.");
        setSending(false);
        return;
      }
      const staffToken = await actor.requestStaffActionToken();
      let okCount = 0;
      for (const email of emails) {
        try {
          await fetch(EMAIL_WORKER_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + staffToken,
            },
            body: JSON.stringify({
              to: email,
              subject: subject.trim(),
              message: message.trim(),
            }),
          });
          okCount += 1;
        } catch {
          // continue sending to remaining recipients even if one fails
        }
      }
      setSendResult(`Wysłano do ${okCount} z ${emails.length} adresów.`);
      setSubject("");
      setMessage("");
    } catch (err) {
      setSendResult("Błąd wysyłki: " + (err instanceof Error ? err.message : String(err)));
    }
    setSending(false);
  };

  const urgentCount = subscribers.filter((s) => s.notifyUrgent).length;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] p-3 sm:p-6 space-y-4">
      <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Powiadomienia e-mail</h1>
            <InfoTip text="Lista adresatów wykorzystywana do wysyłki powiadomień z całego systemu — nie tylko stąd, ale też ze Zgłoszeń, Kalendarza i Rejestru Faktur. Checkbox „Pilne” decyduje tylko o odbiorcach przycisku „Wyślij pilne powiadomienie” poniżej." />
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowSendForm(true)}
                className="px-3 py-1.5 text-sm rounded font-medium bg-red-600 text-white hover:bg-red-700"
              >
                Wyślij pilne powiadomienie ({urgentCount})
              </button>
              <button
                onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }}
                className="px-3 py-1.5 text-sm rounded font-medium bg-cyan-600 text-white hover:bg-cyan-700"
              >
                Dodaj adres
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-[var(--text-secondary)]">Ładowanie...</p>
        ) : subscribers.length === 0 ? (
          <p className="text-[var(--text-secondary)]">Brak adresów na liście.</p>
        ) : (
          <div className="border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)]">
            {subscribers.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">{s.name || s.email}</div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">{s.email}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={s.notifyUrgent}
                      onChange={() => canWrite && toggleUrgent(s)}
                      disabled={!canWrite}
                    />
                    Pilne
                    <InfoTip text="Adres z zaznaczonym „Pilne” trafi na listę odbiorców przycisku „Wyślij pilne powiadomienie” niżej. Adresy bez tego znacznika nadal są dostępne do wyboru w Zgłoszeniach, Kalendarzu i przy dodawaniu wydatku." />
                  </label>
                  {canWrite && (
                    <>
                      <button onClick={() => startEdit(s)} className="text-xs text-cyan-500 hover:underline">Edytuj</button>
                      <button onClick={() => removeSubscriber(s.id)} className="text-xs text-red-500 hover:underline">Usuń</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-card)] rounded-lg p-4 w-full max-w-sm space-y-3">
            <h2 className="font-medium text-[var(--text-primary)]">{editingId !== null ? "Edytuj adres" : "Nowy adres"}</h2>
            <input
              type="email"
              placeholder="Adres e-mail"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            />
            <input
              type="text"
              placeholder="Nazwa (opcjonalnie)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            />
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={form.notifyUrgent}
                onChange={(e) => setForm({ ...form, notifyUrgent: e.target.checked })}
              />
              Powiadamiaj w pilnych sprawach
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] text-[var(--text-secondary)]">
                Anuluj
              </button>
              <button onClick={submitForm} className="px-3 py-1.5 text-sm rounded bg-cyan-600 text-white hover:bg-cyan-700">
                Zapisz
              </button>
            </div>
          </div>
        </div>
      )}

      {showSendForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-card)] rounded-lg p-4 w-full max-w-md space-y-3">
            <h2 className="font-medium text-[var(--text-primary)]">Wyślij pilne powiadomienie</h2>
            <p className="text-xs text-[var(--text-secondary)]">Zostanie wysłane do {urgentCount} zaznaczonych adresów.</p>
            <input
              type="text"
              placeholder="Temat"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            />
            <textarea
              placeholder="Treść wiadomości"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            />
            {sendResult && <p className="text-xs text-[var(--text-secondary)]">{sendResult}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowSendForm(false); setSendResult(null); }}
                className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] text-[var(--text-secondary)]"
              >
                Zamknij
              </button>
              <button
                onClick={sendUrgentNotification}
                disabled={sending || urgentCount === 0}
                className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {sending ? "Wysyłanie..." : "Wyślij"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
