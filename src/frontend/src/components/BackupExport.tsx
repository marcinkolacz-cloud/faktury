import { useState } from "react";

function concatUint8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as any);
  }
  return btoa(binary);
}

function jsonReplacer(_key: string, value: any) {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && typeof value.__principal__ === "string") {
    return value.__principal__;
  }
  if (value && typeof value.toText === "function") return value.toText();
  return value;
}

async function exportBackup(actor: any, onProgress: (s: string) => void) {
  const backup: any = { exportedAt: new Date().toISOString() };

  onProgress("Eksportuję dostęp administracyjny i kody zaproszeń...");
  const [accessEntries, inviteCodes, displayNames] = await Promise.all([
    actor.listAccessEntries(),
    actor.listInviteCodes(),
    actor.listPrincipalDisplayNames(),
  ]);
  const accessWithModules = await Promise.all(
    accessEntries.map(async (a: any) => ({
      ...a,
      modules: await actor.getUserModules(a.principal),
    }))
  );
  backup.admin = { accessEntries: accessWithModules, inviteCodes, displayNames };

  onProgress("Eksportuję Rejestr Faktur i Projekty (w tym Kosz)...");
  const [expenses, trashedExpenses, advancePayments, trashedPayments, projects, trashedProjects, ksefSent] = await Promise.all([
    actor.listMyExpenses(),
    actor.listTrashedExpenses(),
    actor.listMyAdvancePayments(),
    actor.listTrashedAdvancePayments(),
    actor.listMyProjects(),
    actor.listTrashedProjects(),
    actor.listExpenseKsefSent(),
  ]);
  backup.invoicesAndProjects = {
    expenses: [...expenses, ...trashedExpenses],
    advancePayments: [...advancePayments, ...trashedPayments],
    projects: [...projects, ...trashedProjects],
    ksefSent,
  };

  onProgress("Eksportuję Magazyn (w tym Kosz)...");
  const [warehouseItems, trashedWarehouseItems, stockMovements, trashedStockMovements, warehouseCategories] = await Promise.all([
    actor.listWarehouseItems(),
    actor.listTrashedWarehouseItems(),
    actor.listStockMovements(),
    actor.listTrashedStockMovements(),
    actor.listWarehouseCategories(),
  ]);
  backup.warehouse = {
    items: [...warehouseItems, ...trashedWarehouseItems],
    movements: [...stockMovements, ...trashedStockMovements],
    categories: warehouseCategories,
  };

  onProgress("Eksportuję Zgłoszenia...");
  const [tickets, ticketExtras, archivedIds, seenCounts, ticketTokens, trashedAttachmentMetas] = await Promise.all([
    actor.listTickets(),
    actor.listTicketExtras(),
    actor.listArchivedTicketIds(),
    actor.getTicketSeenCounts(),
    actor.listTicketTokens(),
    actor.listTrashedTicketAttachments(),
  ]);

  const attachmentsOut: any[] = [];
  let done = 0;
  for (const t of tickets) {
    done++;
    onProgress("Eksportuję załączniki zgłoszeń... (" + done + "/" + tickets.length + ")");
    const atts = await actor.listTicketAttachments(t.id, []);
    for (const a of atts) {
      const parts: Uint8Array[] = [];
      for (let i = 0; i < Number(a.totalChunks); i++) {
        const chunk = await actor.getTicketAttachmentChunk(a.id, i, []);
        if (chunk && chunk.length > 0) parts.push(new Uint8Array(chunk[0]));
      }
      attachmentsOut.push({ meta: a, dataBase64: uint8ToBase64(concatUint8(parts)) });
    }
  }
  for (const a of trashedAttachmentMetas) {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < Number(a.totalChunks); i++) {
      const chunk = await actor.getTicketAttachmentChunk(a.id, i, []);
      if (chunk && chunk.length > 0) parts.push(new Uint8Array(chunk[0]));
    }
    attachmentsOut.push({ meta: a, dataBase64: uint8ToBase64(concatUint8(parts)) });
  }
  backup.tickets = { tickets, extras: ticketExtras, archivedIds, seenCounts, tokens: ticketTokens, attachments: attachmentsOut };

  onProgress("Eksportuję Kalendarz...");
  const [calendarEventsActive, calendarEventsTrashedFull] = await Promise.all([
    actor.listCalendarEvents(),
    actor.listTrashedCalendarEvents(),
  ]);
  const allCalendarEvents = [...calendarEventsActive, ...calendarEventsTrashedFull];
  let allCalendarNotes: any[] = [];
  let calendarAttachmentsOut: any[] = [];
  for (const ev of allCalendarEvents) {
    const notes = await actor.listCalendarNotes(ev.id);
    allCalendarNotes.push(...notes);
    const atts = await actor.listCalendarAttachments(ev.id);
    if (atts.length > 0) calendarAttachmentsOut.push([ev.id, atts]);
  }
  const trashedCalendarNotesFull = await actor.listTrashedCalendarNotes();
  allCalendarNotes.push(...trashedCalendarNotesFull);
  const [trashedCalEventEntries, trashedCalNoteEntries] = await Promise.all([
    actor.listTrashedCalendarEventEntries(),
    actor.listTrashedCalendarNoteEntries(),
  ]);
  backup.calendar = {
    events: allCalendarEvents,
    notes: allCalendarNotes,
    attachments: calendarAttachmentsOut,
    trashedEventEntries: trashedCalEventEntries,
    trashedNoteEntries: trashedCalNoteEntries,
  };

  onProgress("Eksportuję faktury KSeF...");
  const [pendingInvoices, sharedStatuses] = await Promise.all([
    actor.listPendingInvoices(),
    actor.listSharedStatuses(),
  ]);
  let ksefLineItemsData: any[] = [];
  let ksefLinks: any[] = [];
  for (const inv of pendingInvoices) {
    const details = await actor.getInvoiceDetails(inv.ksefNumber);
    const items = details[0]?.[0] || [];
    const link = details[1]?.[0] || "";
    if (items.length > 0) ksefLineItemsData.push([inv.ksefNumber, items]);
    if (link) ksefLinks.push([inv.ksefNumber, link]);
  }
  backup.ksef = { invoices: pendingInvoices, sharedStatuses, lineItemsData: ksefLineItemsData, links: ksefLinks };

  onProgress("Eksportuję wpisy Kosza (znaczniki czasu)...");
  const [
    trashedExpenseEntries, trashedPaymentEntries, trashedAttachmentEntries,
    trashedWarehouseEntries, trashedMovementEntries, trashedProjectEntries,
  ] = await Promise.all([
    actor.listTrashedExpenseEntries(),
    actor.listTrashedAdvancePaymentEntries(),
    actor.listTrashedTicketAttachmentEntries(),
    actor.listTrashedWarehouseItemEntries(),
    actor.listTrashedStockMovementEntries(),
    actor.listTrashedProjectEntries(),
  ]);
  backup.trash = {
    expenseEntries: trashedExpenseEntries,
    paymentEntries: trashedPaymentEntries,
    attachmentEntries: trashedAttachmentEntries,
    warehouseEntries: trashedWarehouseEntries,
    movementEntries: trashedMovementEntries,
    projectEntries: trashedProjectEntries,
  };

  onProgress("Generuję plik JSON...");
  return backup;
}

export function BackupExport({ actor }: { actor: any }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const runExport = async () => {
    setRunning(true);
    setError("");
    setProgress("Rozpoczynam eksport...");
    try {
      const backup = await exportBackup(actor, setProgress);
      const json = JSON.stringify(backup, jsonReplacer, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const filename = `backup-faktury-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setProgress("Gotowe: " + filename);
    } catch (e: any) {
      setError("Błąd eksportu: " + String(e?.message || e));
    }
    setRunning(false);
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <h2 className="font-semibold text-[var(--text-primary)]">Kopia zapasowa</h2>
      <p className="text-xs text-[var(--text-muted)]">
        Eksportuje Admin (dostęp + kody zaproszeń), Rejestr Faktur, Projekty, Magazyn i Zgłoszenia (z załącznikami) do jednego pliku JSON. Nie obejmuje Dysku.
      </p>
      <button
        onClick={runExport}
        disabled={running}
        className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50"
      >
        {running ? "Eksportuję..." : "📦 Eksportuj kopię zapasową (JSON)"}
      </button>
      {progress && <p className="text-xs text-[var(--text-muted)]">{progress}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
