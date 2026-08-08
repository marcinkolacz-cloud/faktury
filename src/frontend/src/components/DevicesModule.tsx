import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { InfoTip } from "./InfoTip";

const emptyForm = {
  symbol: "",
  name: "",
  client: "",
  location: "",
  notes: "",
  purchaseDate: "",
  warrantyDate: "",
  supportPackage: "",
  contactPerson: "",
  flightHours: "",
  flightMinutes: "",
};

function isWarrantyExpiring(dateStr: string): "expired" | "soon" | "ok" | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const days = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "expired";
  if (days < 30) return "soon";
  return "ok";
}

export function DevicesModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [devices, setDevices] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketExtras, setTicketExtras] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>("read");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [serviceEntries, setServiceEntries] = useState<any[]>([]);
  const [newServiceDate, setNewServiceDate] = useState("");
  const [newServiceDesc, setNewServiceDesc] = useState("");
  const [newServiceBy, setNewServiceBy] = useState("");
  const [newServiceHours, setNewServiceHours] = useState("");
  const [newServiceMinutes, setNewServiceMinutes] = useState("");
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  const reload = async () => {
    if (!actor) return;
    const [d, t, ex] = await Promise.all([
      actor.listDevices(),
      actor.listTickets(),
      actor.listTicketExtras(),
    ]);
    setDevices(d);
    setTickets(t);
    const exMap: Record<string, any> = {};
    for (const [id, extra] of ex as [any, any][]) exMap[String(id)] = extra;
    setTicketExtras(exMap);
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
    if (!form.symbol.trim() || !form.name.trim()) return;
    const hours = parseInt(form.flightHours || "0", 10) || 0;
    const minutes = parseInt(form.flightMinutes || "0", 10) || 0;
    if (editingId !== null) {
      await actor.updateDevice(
        editingId, form.symbol.trim(), form.name.trim(), form.client.trim(), form.location.trim(),
        form.notes.trim(), form.purchaseDate, form.warrantyDate, form.supportPackage.trim(),
        form.contactPerson.trim(), hours, minutes
      );
    } else {
      await actor.addDevice(
        form.symbol.trim(), form.name.trim(), form.client.trim(), form.location.trim(),
        form.notes.trim(), form.purchaseDate, form.warrantyDate, form.supportPackage.trim(),
        form.contactPerson.trim(), hours, minutes
      );
    }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    reload();
  };

  const startEdit = (d: any) => {
    setForm({
      symbol: d.symbol, name: d.name, client: d.client, location: d.location, notes: d.notes,
      purchaseDate: d.purchaseDate, warrantyDate: d.warrantyDate, supportPackage: d.supportPackage,
      contactPerson: d.contactPerson, flightHours: String(d.flightHours), flightMinutes: String(d.flightMinutes),
    });
    setEditingId(d.id);
    setShowForm(true);
  };

  const removeDevice = async (id: number) => {
    if (!confirm("Przenieść to urządzenie do kosza?")) return;
    await actor.trashDevice(id);
    reload();
  };

  const openDetail = async (id: number) => {
    setSelectedId(id);
    const entries = await actor.listDeviceServiceEntries(id);
    setServiceEntries(entries);
    const d = devices.find((x: any) => x.id === id);
    if (d) {
      setNewServiceHours(String(d.flightHours));
      setNewServiceMinutes(String(d.flightMinutes));
    }
    setExpandedTicketId(null);
  };

  const addServiceEntry = async () => {
    if (selectedId === null || !newServiceDesc.trim()) return;
    const hours = parseInt(newServiceHours || "0", 10) || 0;
    const minutes = parseInt(newServiceMinutes || "0", 10) || 0;
    await actor.addDeviceServiceEntry(
      selectedId,
      newServiceDate || new Date().toISOString().slice(0, 10),
      newServiceDesc.trim(),
      newServiceBy.trim(),
      hours,
      minutes
    );
    setNewServiceDate("");
    setNewServiceDesc("");
    setNewServiceBy("");
    setNewServiceHours("");
    setNewServiceMinutes("");
    const entries = await actor.listDeviceServiceEntries(selectedId);
    setServiceEntries(entries);
    reload();
  };

  const removeServiceEntry = async (id: number) => {
    await actor.removeDeviceServiceEntry(id);
    if (selectedId !== null) {
      const entries = await actor.listDeviceServiceEntries(selectedId);
      setServiceEntries(entries);
    }
  };

  const ticketsForSymbol = (symbol: string) =>
    tickets.filter((t: any) => (ticketExtras[String(t.id)]?.deviceNumber || "").trim().toLowerCase() === symbol.trim().toLowerCase());

  const filteredDevices = devices.filter((d: any) => {
    const q = search.toLowerCase();
    return (
      d.symbol.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.client.toLowerCase().includes(q) ||
      d.location.toLowerCase().includes(q)
    );
  });

  const selected = devices.find((d: any) => d.id === selectedId);

  return (
    <div className="min-h-screen bg-[var(--bg-page)] p-3 sm:p-6 space-y-4">
      <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Rejestr urządzeń</h1>
            <InfoTip text="Karty urządzeń klientów z gwarancją, pakietem support i nalotem. Historia zgłoszeń dopasowuje się automatycznie po symbolu urządzenia (np. BAS001) z pola „Numer urządzenia” zgłoszenia." />
          </div>
          {canWrite && (
            <button
              onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }}
              className="px-3 py-1.5 text-sm rounded font-medium bg-cyan-600 text-white hover:bg-cyan-700"
            >
              Dodaj urządzenie
            </button>
          )}
        </div>

        <input
          type="text"
          placeholder="Szukaj po symbolu, nazwie, kliencie, lokalizacji..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)]"
        />

        {loading ? (
          <p className="text-[var(--text-secondary)]">Ładowanie...</p>
        ) : filteredDevices.length === 0 ? (
          <p className="text-[var(--text-secondary)]">Brak urządzeń.</p>
        ) : (
          <div className="border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)]">
            {filteredDevices.map((d: any) => {
              const warranty = isWarrantyExpiring(d.warrantyDate);
              const ticketCount = ticketsForSymbol(d.symbol).length;
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 p-3 hover:bg-[var(--bg-card)] cursor-pointer" onClick={() => openDetail(d.id)}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      <span className="font-mono text-cyan-600">{d.symbol}</span> — {d.name}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate">
                      {d.client}{d.location ? " · " + d.location : ""} · {ticketCount} zgłoszeń
                      {d.supportPackage && <> · <span className="text-cyan-600">{d.supportPackage}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {warranty === "expired" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">Gwarancja wygasła</span>}
                    {warranty === "soon" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Gwarancja wygasa wkrótce</span>}
                    {canWrite && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); startEdit(d); }} className="text-xs text-cyan-500 hover:underline">Edytuj</button>
                        <button onClick={(e) => { e.stopPropagation(); removeDevice(d.id); }} className="text-xs text-red-500 hover:underline">Usuń</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-card)] rounded-lg p-4 w-full max-w-lg space-y-2 max-h-[90vh] overflow-y-auto">
            <h2 className="font-medium text-[var(--text-primary)]">{editingId !== null ? "Edytuj urządzenie" : "Nowe urządzenie"}</h2>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Symbol (np. BAS001)" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} className="px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)] font-mono" />
              <input placeholder="Nazwa urządzenia" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              <input placeholder="Klient" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} className="px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              <input placeholder="Lokalizacja" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              <input placeholder="Osoba kontaktowa" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              <input placeholder="Pakiet support" value={form.supportPackage} onChange={(e) => setForm({ ...form, supportPackage: e.target.value })} className="px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              <div>
                <label className="text-[10px] text-[var(--text-muted)]">Data zakupu</label>
                <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)]">Data gwarancji (do)</label>
                <input type="date" value={form.warrantyDate} onChange={(e) => setForm({ ...form, warrantyDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-[var(--text-muted)]">Total time flight (naloty)</label>
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" placeholder="godz." value={form.flightHours} onChange={(e) => setForm({ ...form, flightHours: e.target.value })} className="w-20 px-2 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                  <span className="text-sm text-[var(--text-secondary)]">h :</span>
                  <input type="number" min="0" max="59" placeholder="min" value={form.flightMinutes} onChange={(e) => setForm({ ...form, flightMinutes: e.target.value })} className="w-20 px-2 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                  <span className="text-sm text-[var(--text-secondary)]">min</span>
                </div>
              </div>
            </div>
            <textarea placeholder="Uwagi" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] text-[var(--text-secondary)]">Anuluj</button>
              <button onClick={submitForm} className="px-3 py-1.5 text-sm rounded bg-cyan-600 text-white hover:bg-cyan-700">Zapisz</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedId(null)}>
          <div className="bg-[var(--bg-card)] rounded-lg p-4 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-[var(--text-primary)]">
                <span className="font-mono text-cyan-600">{selected.symbol}</span> — {selected.name}
              </h2>
              <button onClick={() => setSelectedId(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
              <p><span className="text-[var(--text-muted)]">Klient:</span> {selected.client || "-"}</p>
              <p><span className="text-[var(--text-muted)]">Lokalizacja:</span> {selected.location || "-"}</p>
              <p><span className="text-[var(--text-muted)]">Osoba kontaktowa:</span> {selected.contactPerson || "-"}</p>
              <p><span className="text-[var(--text-muted)]">Pakiet support:</span> {selected.supportPackage || "-"}</p>
              <p><span className="text-[var(--text-muted)]">Data zakupu:</span> {selected.purchaseDate || "-"}</p>
              <p><span className="text-[var(--text-muted)]">Gwarancja do:</span> {selected.warrantyDate || "-"}</p>
              <p><span className="text-[var(--text-muted)]">Total time flight:</span> {String(selected.flightHours)} h : {String(selected.flightMinutes)} min
                <InfoTip text="Ta wartość aktualizuje się automatycznie z ostatniego wpisu serwisowego niżej — nie edytuj jej tutaj ręcznie." />
              </p>
            </div>
            {selected.notes && <p className="text-xs text-[var(--text-secondary)] border-t border-[var(--border-color)] pt-2">{selected.notes}</p>}

            <div className="border-t border-[var(--border-color)] pt-2">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1.5 flex items-center">
                Historia zgłoszeń ({ticketsForSymbol(selected.symbol).length})
                <InfoTip text="Dopasowana automatycznie po dokładnym symbolu w polu „Numer urządzenia” zgłoszenia (wielkość liter nieistotna). Kliknij zgłoszenie, żeby rozwinąć szczegóły." />
              </h3>
              {ticketsForSymbol(selected.symbol).length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">Brak zgłoszeń dla tego symbolu urządzenia.</p>
              ) : (
                <div className="space-y-1">
                  {ticketsForSymbol(selected.symbol).map((t: any) => {
                    const key = String(t.id);
                    const isExpanded = expandedTicketId === key;
                    return (
                      <div key={key} className="text-xs border border-[var(--border-color)] rounded p-1.5">
                        <div className="flex justify-between items-center cursor-pointer" onClick={() => setExpandedTicketId(isExpanded ? null : key)}>
                          <span className="text-[var(--text-secondary)]">#{key} — {t.subject}</span>
                          <span className="text-[var(--text-muted)]">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                        {isExpanded && (
                          <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)] space-y-1 text-[var(--text-secondary)]">
                            <p><span className="text-[var(--text-muted)]">Klient:</span> {t.clientName} ({t.clientEmail})</p>
                            <p><span className="text-[var(--text-muted)]">Status:</span> {Object.keys(t.status)[0]}</p>
                            <p><span className="text-[var(--text-muted)]">Opis:</span> {t.description}</p>
                            <p><span className="text-[var(--text-muted)]">Odpowiedzi:</span> {t.replies.length}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border-color)] pt-2">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1.5 flex items-center">
                Prace serwisowe (wprowadzane ręcznie)
                <InfoTip text="Niezależne od systemu zgłoszeń — dla rutynowych przeglądów bez zgłoszenia od klienta. Każdy wpis może zaktualizować stan Total time flight powyżej." />
              </h3>
              {serviceEntries.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] mb-2">Brak wpisów.</p>
              ) : (
                <div className="space-y-1 mb-2">
                  {serviceEntries.map((s: any) => (
                    <div key={String(s.id)} className="text-xs text-[var(--text-secondary)] border border-[var(--border-color)] rounded p-1.5 flex justify-between items-start gap-2">
                      <div>
                        <span className="text-[var(--text-muted)]">{s.date}</span> — {s.description}
                        {s.performedBy && <span className="text-[var(--text-muted)]"> ({s.performedBy})</span>}
                        <span className="text-[var(--text-muted)]"> · {String(s.flightHours)}h:{String(s.flightMinutes)}min</span>
                      </div>
                      {canWrite && <button onClick={() => removeServiceEntry(s.id)} className="text-red-500 hover:underline shrink-0">Usuń</button>}
                    </div>
                  ))}
                </div>
              )}
              {canWrite && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <input type="date" value={newServiceDate} onChange={(e) => setNewServiceDate(e.target.value)} className="px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                    <input placeholder="Opis pracy" value={newServiceDesc} onChange={(e) => setNewServiceDesc(e.target.value)} className="flex-1 min-w-[120px] px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                    <input placeholder="Wykonał" value={newServiceBy} onChange={(e) => setNewServiceBy(e.target.value)} className="w-24 px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--text-muted)]">Aktualny total time flight:</span>
                    <input type="number" min="0" value={newServiceHours} onChange={(e) => setNewServiceHours(e.target.value)} className="w-16 px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                    <span className="text-xs text-[var(--text-secondary)]">h :</span>
                    <input type="number" min="0" max="59" value={newServiceMinutes} onChange={(e) => setNewServiceMinutes(e.target.value)} className="w-16 px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text-primary)]" />
                    <span className="text-xs text-[var(--text-secondary)]">min</span>
                    <button onClick={addServiceEntry} className="ml-auto px-2 py-1 text-xs rounded bg-cyan-600 text-white hover:bg-cyan-700">Dodaj</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
