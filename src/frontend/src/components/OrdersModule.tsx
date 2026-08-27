import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { DriveFolderPanel } from "./DriveFolderPanel";
import { setDriveActor } from "../lib/oneDriveConfig";
import { sendEmailNotification } from "../lib/emailNotify";

const STATUS_LABELS: Record<string, string> = {
  pending: "Oczekujące",
  completed: "Zrealizowane",
  cancelled: "Anulowane",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500",
  completed: "bg-emerald-600",
  cancelled: "bg-gray-400",
};

function statusFromVariant(v: any): string {
  return Object.keys(v)[0];
}

function statusToVariant(s: string) {
  return { [s]: null };
}

function formatDate(ns: bigint): string {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleDateString("pl-PL", { year: "numeric", month: "short", day: "numeric" });
}

const emptyForm = { date: new Date().toISOString().slice(0, 10), name: "", quantity: "1", supplierName: "", totalAmount: "", advanceAmount: "", currency: "PLN", note: "", fulfillmentDate: "", parts: "", ordererName: "", contactPhone: "", contactEmail: "" };

export function OrdersModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [myRole, setMyRole] = useState<string>("read");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [selectedSubscriberIds, setSelectedSubscriberIds] = useState<number[]>([]);
  const [externalEmail, setExternalEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);
  const reload = async () => {
    if (!actor) return;
    const o = await actor.listOrders();
    setOrders(o);
    setLoading(false);
    if (selected) {
      const updated = o.find((x: any) => x.id === selected.id);
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
      actor.listSubscribers().then((s: any[]) => setSubscribers(s)).catch(() => {});
    }
  }, [actor]);

  useEffect(() => {
    if (!actor || selected?.id === undefined) { setFolderPath(null); return; }
    actor.getOrderDriveFolder(selected.id).then((r: any) => setFolderPath(r.length ? r[0] : null)).catch(() => setFolderPath(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const canWrite = myRole === "write" || myRole === "admin";

  const filteredOrders = orders.filter((o: any) => statusFilter === "all" || statusFromVariant(o.status) === statusFilter);

  const submitForm = async () => {
    if (!form.name.trim() || !form.supplierName.trim()) return;
    const quantity = parseFloat(form.quantity) || 0;
    const totalAmount = parseFloat(form.totalAmount) || 0;
    const advanceAmount = parseFloat(form.advanceAmount) || 0;
    if ((selected as any)?._editing) {
      await actor.updateOrder(selected.id, form.date, form.name.trim(), quantity, form.supplierName.trim(), totalAmount, advanceAmount, form.currency, form.note.trim(), form.fulfillmentDate, form.parts.trim(), form.ordererName.trim(), form.contactPhone.trim(), form.contactEmail.trim());
    } else {
      await actor.createOrder(form.date, form.name.trim(), quantity, form.supplierName.trim(), totalAmount, advanceAmount, form.currency, form.note.trim(), "Zespół", form.fulfillmentDate, form.parts.trim(), form.ordererName.trim(), form.contactPhone.trim(), form.contactEmail.trim());
    }
    setForm(emptyForm);
    setShowForm(false);
    setSelected(null);
    reload();
  };

  const startEdit = (o: any) => {
    setForm({
      date: o.date,
      name: o.name,
      quantity: String(o.quantity),
      supplierName: o.supplierName,
      totalAmount: String(o.totalAmount),
      advanceAmount: String(o.advanceAmount),
      currency: o.currency,
      note: o.note,
      fulfillmentDate: o.fulfillmentDate || "",
      parts: o.parts || "",
      ordererName: o.ordererName || "",
      contactPhone: o.contactPhone || "",
      contactEmail: o.contactEmail || "",
    });
    setSelected({ ...o, _editing: true });
    setShowForm(true);
  };

  const toggleSubscriber = (id: number) => {
    setSelectedSubscriberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const sendOrderEmail = async () => {
    const teamEmails = subscribers.filter((s) => selectedSubscriberIds.includes(s.id)).map((s) => s.email);
    const recipients = [...teamEmails, ...(externalEmail.trim() ? [externalEmail.trim()] : [])];
    if (recipients.length === 0) { setEmailResult("Wybierz odbiorcę."); return; }
    setSendingEmail(true);
    setEmailResult(null);
    const subject = "Zamówienie: " + form.name;
    const message =
      "Zamówienie: " + form.name + "\n" +
      "Dostawca: " + form.supplierName + "\n" +
      "Data zamówienia: " + form.date + "\n" +
      (form.fulfillmentDate ? "Data realizacji: " + form.fulfillmentDate + "\n" : "") +
      (form.ordererName.trim() ? "Zamawiający: " + form.ordererName.trim() + "\n" : "") +
      ((form.contactPhone.trim() || form.contactEmail.trim()) ? "Kontakt: " + [form.contactPhone.trim(), form.contactEmail.trim()].filter(Boolean).join(" · ") + "\n" : "") +
      "Ilość: " + form.quantity + "\n" +
      "Kwota całości: " + form.totalAmount + " " + form.currency + "\n" +
      "Zaliczka: " + form.advanceAmount + " " + form.currency +
      (form.parts.trim() ? "\n\nSpis części:\n" + form.parts.trim() : "") +
      (form.note.trim() ? "\n\nNotatka: " + form.note.trim() : "") +
      "\n\n---\nWiadomość wysłana automatycznie z systemu zamówień. Prosimy nie odpowiadać na tego maila.";
    try {
      const r = await sendEmailNotification(actor, recipients, subject, message);
      setEmailResult("Wysłano: " + r.ok + "/" + r.total);
    } catch {
      setEmailResult("Błąd wysyłki.");
    }
    setSendingEmail(false);
  };

  const changeStatus = async (id: bigint, status: string) => {
    await actor.updateOrderStatus(id, statusToVariant(status));
    reload();
  };

  const linkOrderFolder = async (path: string) => {
    if (!selected) return;
    await actor.linkOrderDriveFolder(selected.id, path);
    setFolderPath(path);
  };

  const unlinkOrderFolder = async () => {
    if (!selected) return;
    await actor.unlinkOrderDriveFolder(selected.id);
    setFolderPath(null);
  };

  const trashSelected = async () => {
    if (!selected || !confirm("Przenieść to zamówienie do kosza?")) return;
    await actor.trashOrder(selected.id);
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
            <div className="p-2 space-y-1.5 border-b border-[var(--border-color-light)]">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-xs">
                <option value="all">Wszystkie statusy</option>
                {Object.keys(STATUS_LABELS).map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              {canWrite && (
                <button
                  onClick={() => { setForm(emptyForm); setSelected(null); setShowForm(true); }}
                  className="w-full text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded px-2 py-1.5"
                >
                  + Nowe zamówienie
                </button>
              )}
            </div>
            <div className="overflow-auto max-h-[600px]">
              {filteredOrders.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">Brak zamówień.</p>
              ) : (
                [...filteredOrders].reverse().map((o) => (
                  <button
                    key={String(o.id)}
                    onClick={() => { setSelected(o); setShowForm(false); }}
                    className={"w-full text-left p-3 border-b border-[var(--border-color-light)] hover:bg-[var(--bg-page)] " + (selected?.id === o.id && !showForm ? "bg-[var(--accent-hover)]/10" : "")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm text-[var(--text-primary)] truncate">{o.name}</p>
                      <span className={"shrink-0 text-[10px] px-1.5 py-0.5 rounded text-white " + STATUS_COLORS[statusFromVariant(o.status)]}>
                        {STATUS_LABELS[statusFromVariant(o.status)]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{o.supplierName} · {o.date}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{o.totalAmount} {o.currency} (zaliczka: {o.advanceAmount} {o.currency})</p>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-sm p-4">
            {showForm ? (
              <div className="space-y-2 max-w-md">
                <h2 className="font-semibold">{(selected as any)?._editing ? "Edytuj zamówienie" : "Nowe zamówienie"}</h2>
                <label className="text-xs text-[var(--text-muted)]">Data zamówienia</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Nazwa</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Ilość</label>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Dostawca</label>
                <input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Data realizacji</label>
                <input type="date" value={form.fulfillmentDate} onChange={(e) => setForm({ ...form, fulfillmentDate: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Spis części</label>
                <textarea value={form.parts} onChange={(e) => setForm({ ...form, parts: e.target.value })} rows={3} placeholder={"1x ...\n2x ..."} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <label className="text-xs text-[var(--text-muted)]">Osoba zamawiająca</label>
                <input value={form.ordererName} onChange={(e) => setForm({ ...form, ordererName: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-[var(--text-muted)]">Kontakt tel.</label>
                    <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-[var(--text-muted)]">Kontakt email</label>
                    <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-[var(--text-muted)]">Kwota całości</label>
                    <input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-[var(--text-muted)]">Kwota zaliczki</label>
                    <input type="number" value={form.advanceAmount} onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                  </div>
                  <div className="w-20">
                    <label className="text-xs text-[var(--text-muted)]">Waluta</label>
                    <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                  </div>
                </div>
                <label className="text-xs text-[var(--text-muted)]">Notatka</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                <div className="border-t border-[var(--border-color-light)] pt-2 mt-2 space-y-1.5">
                  <label className="text-xs text-[var(--text-muted)]">Wyślij email o zamówieniu</label>
                  <div className="flex flex-wrap gap-2">
                    {subscribers.map((s) => (
                      <label key={s.id} className="flex items-center gap-1 text-xs bg-[var(--bg-page)] border border-[var(--border-color)] rounded px-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={selectedSubscriberIds.includes(s.id)} onChange={() => toggleSubscriber(s.id)} />
                        {s.name || s.email}
                      </label>
                    ))}
                  </div>
                  <input value={externalEmail} onChange={(e) => setExternalEmail(e.target.value)} placeholder="Adres zewnętrzny (opcjonalnie)" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm" />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={sendOrderEmail} disabled={sendingEmail} className="px-3 py-1.5 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-light)] rounded text-sm disabled:opacity-50">
                      {sendingEmail ? "Wysyłanie..." : "Wyślij email"}
                    </button>
                    {emailResult && <span className="text-xs text-[var(--text-muted)]">{emailResult}</span>}
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={submitForm} className="px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded text-sm">Zapisz</button>
                  <button onClick={() => { setShowForm(false); setSelected(null); }} className="px-3 py-1.5 border border-[var(--border-color)] rounded text-sm">Anuluj</button>
                </div>
              </div>
            ) : !selected ? (
              <p className="text-sm text-gray-500">Wybierz zamówienie z listy lub dodaj nowe.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-[var(--text-primary)]">{selected.name}</h2>
                    <p className="text-xs text-gray-500">Dostawca: {selected.supplierName} · Data: {selected.date}</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Zamówienie #{String(selected.id)} · Utworzone: {formatDate(selected.createdAt)}</p>
                  </div>
                  {canWrite && (
                    <select value={statusFromVariant(selected.status)} onChange={(e) => changeStatus(selected.id, e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1 text-sm">
                      {Object.keys(STATUS_LABELS).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="bg-[var(--bg-page)] rounded p-3 grid grid-cols-2 gap-2 text-sm">
                  <p>Ilość: <span className="font-medium">{String(selected.quantity)}</span></p>
                  <p>Kwota całości: <span className="font-medium">{String(selected.totalAmount)} {selected.currency}</span></p>
                  <p>Kwota zaliczki: <span className="font-medium">{String(selected.advanceAmount)} {selected.currency}</span></p>
                  <p>Do zapłaty przy dostawie: <span className="font-medium">{(Number(selected.totalAmount) - Number(selected.advanceAmount)).toFixed(2)} {selected.currency}</span></p>
                  {selected.fulfillmentDate && <p>Data realizacji: <span className="font-medium">{selected.fulfillmentDate}</span></p>}
                  {selected.ordererName && <p>Zamawiający: <span className="font-medium">{selected.ordererName}</span></p>}
                  {(selected.contactPhone || selected.contactEmail) && <p>Kontakt: <span className="font-medium">{[selected.contactPhone, selected.contactEmail].filter(Boolean).join(" · ")}</span></p>}
                </div>
                {selected.parts && <div><p className="text-xs text-[var(--text-muted)]">Spis części:</p><p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{selected.parts}</p></div>}
                {selected.note && <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{selected.note}</p>}
                <DriveFolderPanel
                  path={folderPath}
                  basePath="Zamowienia"
                  defaultName={"Zamowienie #" + String(selected.id) + " - " + selected.name}
                  canWrite={canWrite}
                  onLink={linkOrderFolder}
                  onUnlink={unlinkOrderFolder}
                />
                {canWrite && (
                  <div className="flex justify-between items-center pt-2">
                    <button onClick={() => onNavigate("warehouse")} className="text-xs text-[var(--accent)] hover:underline">→ Przejdź do Magazynu, aby dodać dostawę</button>
                    <div className="flex gap-3">
                      <button onClick={() => startEdit(selected)} className="text-xs text-[var(--accent)] hover:underline">Edytuj</button>
                      <button onClick={trashSelected} className="text-xs text-red-500 hover:underline">Usuń</button>
                    </div>
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
