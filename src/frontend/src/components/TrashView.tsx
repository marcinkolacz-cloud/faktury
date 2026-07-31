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
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<any[]>([]);
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarNotes, setCalendarNotes] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);

  const reload = async () => {
    const [e, p, a, w, s, ce, cn, pr] = await Promise.all([
      actor.listTrashedExpenses(),
      actor.listTrashedAdvancePayments(),
      actor.listTrashedTicketAttachments(),
      actor.listTrashedWarehouseItems(),
      actor.listTrashedStockMovements(),
      actor.listTrashedCalendarEvents(),
      actor.listTrashedCalendarNotes(),
      actor.listTrashedProjects(),
    ]);
    setExpenses(e);
    setPayments(p);
    setAttachments(a);
    setWarehouseItems(w);
    setStockMovements(s);
    setCalendarEvents(ce);
    setCalendarNotes(cn);
    setProjects(pr);
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

  const categories: TrashCategory[] = [
    { key: "expenses", label: "Wydatki", items: expenses, getName: (i) => i.productService + " (" + (i.pricePln?.[0] ?? "—") + " PLN)", restoreFn: "restoreExpense", permDeleteFn: "permanentlyDeleteExpense" },
    { key: "payments", label: "Zaliczki", items: payments, getName: (i) => i.date + " — " + i.amount + " " + i.currency, restoreFn: "restoreAdvancePayment", permDeleteFn: "permanentlyDeleteAdvancePayment" },
    { key: "attachments", label: "Załączniki zgłoszeń", items: attachments, getName: (i) => i.name, restoreFn: "restoreTicketAttachment", permDeleteFn: "permanentlyDeleteTicketAttachment" },
    { key: "warehouseItems", label: "Pozycje magazynowe", items: warehouseItems, getName: (i) => i.name, restoreFn: "restoreWarehouseItem", permDeleteFn: "permanentlyDeleteWarehouseItem" },
    { key: "stockMovements", label: "Ruchy magazynowe", items: stockMovements, getName: (i) => i.itemId + " — " + Object.keys(i.movementType)[0], restoreFn: "restoreStockMovement", permDeleteFn: "permanentlyDeleteStockMovement" },
    { key: "calendarEvents", label: "Wydarzenia kalendarza", items: calendarEvents, getName: (i) => i.title, restoreFn: "restoreCalendarEvent", permDeleteFn: "permanentlyDeleteCalendarEvent" },
    { key: "calendarNotes", label: "Notatki kalendarza", items: calendarNotes, getName: (i) => i.title, restoreFn: "restoreCalendarNote", permDeleteFn: "permanentlyDeleteCalendarNote" },
    { key: "projects", label: "Projekty", items: projects, getName: (i) => i.name, restoreFn: "restoreProject", permDeleteFn: "permanentlyDeleteProject" },
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
        categories.filter((c) => c.items.length > 0).map((cat) => (
          <div key={cat.key} className="space-y-1">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase">{cat.label} ({cat.items.length})</p>
            {cat.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm">
                <span className="truncate text-[var(--text-secondary)]">{cat.getName(item)}</span>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => restore(cat.restoreFn, item.id)} className="text-xs text-cyan-600 hover:underline">Przywróć</button>
                  {isAdmin && (
                    <button onClick={() => permDelete(cat.permDeleteFn, item.id)} className="text-xs text-red-500 hover:underline">Usuń trwale</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
