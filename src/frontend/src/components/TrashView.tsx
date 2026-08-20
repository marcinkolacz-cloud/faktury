import { useEffect, useState } from "react";

interface TrashCategory {
  key: string;
  label: string;
  items: any[];
  getName: (item: any) => string;
  restoreFn: string;
  permDeleteFn: string;
}

export function TrashView({ actor }: { actor: any }) {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<any[]>([]);
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarNotes, setCalendarNotes] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [ticketsTrashed, setTicketsTrashed] = useState<any[]>([]);
  const [manualChapters, setManualChapters] = useState<any[]>([]);
  const [logbookEntries, setLogbookEntries] = useState<any[]>([]);

  const reload = async () => {
    const [e, p, a, w, s, ce, cn, pr, tk, mc, lb] = await Promise.all([
      actor.listTrashedExpenses(),
      actor.listTrashedAdvancePayments(),
      actor.listTrashedTicketAttachments(),
      actor.listTrashedWarehouseItems(),
      actor.listTrashedStockMovements(),
      actor.listTrashedCalendarEvents(),
      actor.listTrashedCalendarNotes(),
      actor.listTrashedProjects(),
      actor.listTrashedTickets(),
      actor.listTrashedDeviceManualChapters(),
      actor.listTrashedLogbookEntries(),
    ]);
    setExpenses(e);
    setPayments(p);
    setAttachments(a);
    setWarehouseItems(w);
    setStockMovements(s);
    setCalendarEvents(ce);
    setCalendarNotes(cn);
    setProjects(pr);
    setTicketsTrashed(tk);
    setManualChapters(mc);
    setLogbookEntries(lb);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    actor.getCallerRole().then((r: any) => {
      if (r && r.length > 0 && Object.keys(r[0])[0] === "admin") setIsAdmin(true);
    });
  }, []);

  const restore = async (fn: string, id: bigint) => {
    await actor[fn](id);
    reload();
  };

  const permDelete = async (fn: string, id: bigint) => {
    if (!confirm("Usunąć trwale? Tej operacji nie można cofnąć.")) return;
    await actor[fn](id);
    reload();
  };

  const toggleSelect = (catKey: string, id: string) => {
    setSelected((prev) => {
      const current = new Set(prev[catKey] || []);
      if (current.has(id)) { current.delete(id); } else { current.add(id); }
      return { ...prev, [catKey]: current };
    });
  };

  const toggleSelectAll = (catKey: string, items: any[]) => {
    setSelected((prev) => {
      const current = prev[catKey] || new Set<string>();
      if (current.size === items.length) {
        return { ...prev, [catKey]: new Set() };
      }
      return { ...prev, [catKey]: new Set(items.map((i) => String(i.id))) };
    });
  };

  const bulkRestore = async (cat: TrashCategory) => {
    const ids = Array.from(selected[cat.key] || []);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    for (const id of ids) {
      await actor[cat.restoreFn](BigInt(id));
    }
    setSelected((prev) => ({ ...prev, [cat.key]: new Set() }));
    reload();
    setBulkProcessing(false);
  };

  const bulkPermDelete = async (cat: TrashCategory) => {
    const ids = Array.from(selected[cat.key] || []);
    if (ids.length === 0) return;
    if (!confirm("Usunąć trwale zaznaczone " + ids.length + " element(y/ów)? Tej operacji nie można cofnąć.")) return;
    setBulkProcessing(true);
    for (const id of ids) {
      await actor[cat.permDeleteFn](BigInt(id));
    }
    setSelected((prev) => ({ ...prev, [cat.key]: new Set() }));
    reload();
    setBulkProcessing(false);
  };

  const categories: TrashCategory[] = [
    { key: "expenses", label: "Wydatki", items: expenses, getName: (i) => i.productService + " (" + (i.pricePln?.[0] ?? "—") + " PLN)", restoreFn: "restoreExpense", permDeleteFn: "permanentlyDeleteExpense" },
    { key: "payments", label: "Zaliczki", items: payments, getName: (i) => i.date + " — " + i.amount + " " + i.currency, restoreFn: "restoreAdvancePayment", permDeleteFn: "permanentlyDeleteAdvancePayment" },
    { key: "attachments", label: "Załączniki zgłoszeń", items: attachments, getName: (i) => i.name, restoreFn: "restoreTicketAttachment", permDeleteFn: "permanentlyDeleteTicketAttachment" },
    { key: "warehouseItems", label: "Pozycje magazynowe", items: warehouseItems, getName: (i) => i.name, restoreFn: "restoreWarehouseItem", permDeleteFn: "permanentlyDeleteWarehouseItem" },
    { key: "stockMovements", label: "Ruchy magazynowe", items: stockMovements, getName: (i) => i.itemId + " — " + Object.keys(i.movementType)[0], restoreFn: "restoreStockMovement", permDeleteFn: "permanentlyDeleteStockMovement" },
    { key: "calendarEvents", label: "Wydarzenia kalendarza", items: calendarEvents, getName: (i) => i.title, restoreFn: "restoreCalendarEvent", permDeleteFn: "permanentlyDeleteCalendarEvent" },
    { key: "calendarNotes", label: "Notatki kalendarza", items: calendarNotes, getName: (i) => i.title, restoreFn: "restoreCalendarNote", permDeleteFn: "permanentlyDeleteCalendarNote" },
    { key: "projects", label: "Projekty", items: projects, getName: (i) => i.name, restoreFn: "restoreProject", permDeleteFn: "permanentlyDeleteProject" },
    { key: "tickets", label: "Zgłoszenia", items: ticketsTrashed, getName: (i) => i.subject + " — " + i.clientName, restoreFn: "restoreTicket", permDeleteFn: "permanentlyDeleteTicket" },
    { key: "manualChapters", label: "Dokumentacja", items: manualChapters, getName: (i) => i.title, restoreFn: "restoreDeviceManualChapter", permDeleteFn: "permanentlyDeleteDeviceManualChapter" },
    { key: "logbookEntries", label: "Dziennik użytkowania", items: logbookEntries, getName: (i) => i.dataText + " — " + i.instruktorName, restoreFn: "restoreLogbookEntry", permDeleteFn: "permanentlyDeleteLogbookEntry" },
  ];

  const totalCount = categories.reduce((s, c) => s + c.items.length, 0);

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)]">Ładowanie kosza...</p>;
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3">
      <h2 className="font-semibold text-sm">🗑️ Kosz {totalCount > 0 ? "(" + totalCount + ")" : ""}</h2>
      {totalCount === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Kosz jest pusty.</p>
      ) : (
        categories.filter((c) => c.items.length > 0).map((cat) => {
          const catSelected = selected[cat.key] || new Set();
          return (
          <div key={cat.key} className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-[var(--text-muted)] uppercase">{cat.label} ({cat.items.length})</p>
              <input type="checkbox" checked={catSelected.size === cat.items.length && cat.items.length > 0} onChange={() => toggleSelectAll(cat.key, cat.items)} />
              <span className="text-[10px] text-[var(--text-muted)]">zaznacz wszystkie</span>
              {catSelected.size > 0 && (
                <>
                  <button onClick={() => bulkRestore(cat)} disabled={bulkProcessing} className="text-[10px] px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50">
                    Przywróć zaznaczone ({catSelected.size})
                  </button>
                  {isAdmin && (
                    <button onClick={() => bulkPermDelete(cat)} disabled={bulkProcessing} className="text-[10px] px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50">
                      Usuń trwale zaznaczone ({catSelected.size})
                    </button>
                  )}
                </>
              )}
            </div>
            {cat.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm">
                <div className="flex items-center gap-2 truncate">
                  <input type="checkbox" checked={catSelected.has(String(item.id))} onChange={() => toggleSelect(cat.key, String(item.id))} />
                  <span className="truncate text-[var(--text-secondary)]">{cat.getName(item)}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => restore(cat.restoreFn, item.id)} className="text-xs text-cyan-600 hover:underline">Przywróć</button>
                  {isAdmin && (
                    <button onClick={() => permDelete(cat.permDeleteFn, item.id)} className="text-xs text-red-500 hover:underline">Usuń trwale</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          );
        })
      )}
    </div>
  );
}
