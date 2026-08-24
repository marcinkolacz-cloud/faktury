import { useState } from "react";
import { Principal } from "@icp-sdk/core/principal";

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const CHUNK_SIZE = 1_500_000;

function bn(v: any): bigint {
  return BigInt(v);
}



function convertFields(obj: any, natFields: string[] = [], optNatFields: string[] = [], optFloatFields: string[] = []) {
  const out = { ...obj };
  for (const f of natFields) if (f in out) out[f] = bn(out[f]);
  for (const f of optNatFields) if (f in out) out[f] = out[f].length ? [bn(out[f][0])] : [];
  for (const f of optFloatFields) if (f in out) out[f] = out[f].length ? [Number(out[f][0])] : [];
  return out;
}

function convertProject(p: any) {
  return convertFields(p, ["id", "createdAt"]);
}
function convertAdvancePayment(p: any) {
  return convertFields(p, ["id", "createdAt"]);
}
function convertExpense(e: any) {
  return convertFields(e, ["id", "projectId"], ["quantity"], ["priceEur", "priceUsd", "pricePln", "priceNet"]);
}
function convertWarehouseItem(i: any) {
  return convertFields(i, ["id", "createdAt"]);
}
function convertStockMovement(m: any) {
  return convertFields(m, ["id", "itemId", "createdAt"], ["projectId"]);
}
function convertTicket(t: any) {
  const out = convertFields(t, ["id", "createdAt"]);
  out.replies = (t.replies || []).map((r: any) => convertFields(r, ["createdAt"]));
  return out;
}
function convertTicketAttachment(a: any) {
  return convertFields(a, ["id", "ticketId", "size", "totalChunks", "createdAt"]);
}
function convertTicketLinks(l: any) {
  // driveFolderPath is opt Text (a OneDrive path string) — passes through as-is.
  return convertFields(l, [], ["calendarEventId"]);
}
function convertOrder(o: any) {
  return convertFields(o, ["id", "createdAt"]);
}
function convertContract(c: any) {
  return convertFields(c, ["id", "createdAt"]);
}
function convertSubscriber(s: any) {
  return convertFields(s, ["id", "createdAt"]);
}
function convertDevice(d: any) {
  return convertFields(d, ["id", "flightHours", "flightMinutes", "createdAt"]);
}
function convertDeviceServiceEntry(e: any) {
  return convertFields(e, ["id", "deviceId", "flightHours", "flightMinutes", "createdAt"]);
}

function convertCalendarEvent(e: any) {
  return convertFields(e, ["id", "createdAt"]);
}
function convertCalendarNote(n: any) {
  return convertFields(n, ["id", "eventId", "createdAt"]);
}
function convertPendingInvoice(inv: any) {
  return convertFields(inv, ["importedAt"]);
}

function convertLogbookEntry(e: any) {
  return convertFields(e, ["id", "createdAt"]);
}
function convertLogbookInstructor(i: any) {
  return convertFields(i, ["createdAt"]);
}
function convertManualChapter(ch: any) {
  return convertFields(ch, ["id", "deviceId", "order", "updatedAt"]);
}

function convertInviteCode(c: any) {
  return {
    ...c,
    createdAt: bn(c.createdAt),
    usedBy: c.usedBy && c.usedBy.length ? [Principal.fromText(c.usedBy[0])] : [],
    usedAt: c.usedAt && c.usedAt.length ? [bn(c.usedAt[0])] : [],
  };
}

async function uploadAttachmentContent(actor: any, attachmentId: bigint, base64: string) {
  const bytes = base64ToUint8(base64);
  const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE) || 0;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, bytes.length);
    await actor.uploadTicketAttachmentChunk(attachmentId, BigInt(i), bytes.subarray(start, end), []);
  }
}

async function importBackup(actor: any, backup: any, onProgress: (s: string) => void) {
  onProgress("Importuję dostęp administracyjny...");
  const existingAccess: any[] = await actor.listAccessEntries();
  const existingPrincipals = new Set(existingAccess.map((e: any) => e.principal.toText()));
  for (const a of backup.admin.accessEntries) {
    if (existingPrincipals.has(a.principal)) continue;
    const principal = Principal.fromText(a.principal);
    await actor.changeAccessRole(principal, a.role);
    await actor.setUserModules(principal, a.modules);
  }
  const codes = backup.admin.inviteCodes.map(convertInviteCode);
  if (codes.length) await actor.importInviteCodes(codes);
  if (backup.admin.displayNames && backup.admin.displayNames.length) {
    const names = backup.admin.displayNames.map(([p, n]: [string, string]) => [Principal.fromText(p), n]);
    await actor.importPrincipalDisplayNames(names);
  }

  onProgress("Importuję Projekty...");
  const projects = backup.invoicesAndProjects.projects.map(convertProject);
  if (projects.length) await actor.importProjects(projects);

  onProgress("Importuję Zaliczki...");
  const payments = backup.invoicesAndProjects.advancePayments.map(convertAdvancePayment);
  if (payments.length) await actor.importAdvancePayments(payments);

  onProgress("Importuję Wydatki...");
  const expenses = backup.invoicesAndProjects.expenses.map(convertExpense);
  if (expenses.length) await actor.importExpenses(expenses);
  const ksef = backup.invoicesAndProjects.ksefSent.map(([id, sent]: [any, boolean]) => [bn(id), sent]);
  if (ksef.length) await actor.importExpenseKsefSent(ksef);

  onProgress("Importuję Magazyn...");
  const items = backup.warehouse.items.map(convertWarehouseItem);
  if (items.length) await actor.importWarehouseItems(items);
  const movements = backup.warehouse.movements.map(convertStockMovement);
  if (movements.length) await actor.importStockMovements(movements);

  onProgress("Importuję Zgłoszenia...");
  const tickets = backup.tickets.tickets.map(convertTicket);
  if (tickets.length) await actor.importTickets(tickets);
  const extras = backup.tickets.extras.map(([id, e]: [any, any]) => [bn(id), e]);
  if (extras.length) await actor.importTicketExtras(extras);
  const archived = backup.tickets.archivedIds.map(bn);
  if (archived.length) await actor.importTicketArchived(archived);
  const seenCounts = backup.tickets.seenCounts.map(([id, c]: [any, any]) => [bn(id), bn(c)]);
  if (seenCounts.length) await actor.importTicketSeenCounts(seenCounts);
  const tokens = backup.tickets.tokens.map(([tok, id]: [string, any]) => [tok, bn(id)]);
  if (tokens.length) await actor.importTicketTokens(tokens);

  const attMetas = backup.tickets.attachments.map((a: any) => convertTicketAttachment(a.meta));
  if (attMetas.length) await actor.importTicketAttachments(attMetas);
  if (backup.tickets.links?.length) {
    const links = backup.tickets.links.map(([id, l]: [any, any]) => [bn(id), convertTicketLinks(l)]);
    await actor.importTicketLinks(links);
  }
  let done = 0;
  for (const a of backup.tickets.attachments) {
    done++;
    onProgress("Importuję treść załączników... (" + done + "/" + backup.tickets.attachments.length + ")");
    if (a.dataBase64) await uploadAttachmentContent(actor, bn(a.meta.id), a.dataBase64);
  }

  if (backup.calendar) {
    onProgress("Importuję Kalendarz...");
    const events = backup.calendar.events.map(convertCalendarEvent);
    if (events.length) await actor.importCalendarEvents(events);
    const notes = backup.calendar.notes.map(convertCalendarNote);
    if (notes.length) await actor.importCalendarNotes(notes);
    const calAtts = (backup.calendar.attachments || []).map(([id, atts]: [any, any]) => [bn(id), atts]);
    if (calAtts.length) await actor.importCalendarAttachments(calAtts);
    const trashedEv = (backup.calendar.trashedEventEntries || []).map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    if (trashedEv.length) await actor.importTrashedCalendarEvents(trashedEv);
    const trashedNt = (backup.calendar.trashedNoteEntries || []).map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    if (trashedNt.length) await actor.importTrashedCalendarNotes(trashedNt);
  }

  onProgress("Importuję Zamówienia...");
  if (backup.orders?.orders?.length) {
    await actor.importOrders(backup.orders.orders.map(convertOrder));
  }
  if (backup.orders?.trashedEntries?.length) {
    const te = backup.orders.trashedEntries.map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    await actor.importTrashedOrders(te);
  }

  onProgress("Importuję Umowy...");
  if (backup.contracts?.contracts?.length) {
    await actor.importContracts(backup.contracts.contracts.map(convertContract));
  }
  if (backup.contracts?.trashedEntries?.length) {
    const te = backup.contracts.trashedEntries.map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    await actor.importTrashedContracts(te);
  }

  onProgress("Importuję Powiadomienia e-mail...");
  if (backup.emailSubscribers?.subscribers?.length) {
    await actor.importSubscribers(backup.emailSubscribers.subscribers.map(convertSubscriber));
  }

  onProgress("Importuję Rejestr urządzeń...");
  if (backup.devices?.devices?.length) {
    await actor.importDevices(backup.devices.devices.map(convertDevice));
  }
  if (backup.devices?.serviceEntries?.length) {
    await actor.importDeviceServiceEntries(backup.devices.serviceEntries.map(convertDeviceServiceEntry));
  }

  if (backup.ksef && backup.ksef.invoices && backup.ksef.invoices.length) {
    onProgress("Importuję faktury KSeF...");
    const invoices = backup.ksef.invoices.map(convertPendingInvoice);
    await actor.importPendingInvoicesFull(
      invoices,
      backup.ksef.sharedStatuses || [],
      backup.ksef.lineItemsData || [],
      backup.ksef.links || []
    );
  }

  if (backup.trash) {
    onProgress("Importuję wpisy Kosza...");
    const toEntries = (arr: any[]) => (arr || []).map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    const te = toEntries(backup.trash.expenseEntries);
    if (te.length) await actor.importTrashedExpenses(te);
    const tp = toEntries(backup.trash.paymentEntries);
    if (tp.length) await actor.importTrashedAdvancePayments(tp);
    const ta = toEntries(backup.trash.attachmentEntries);
    if (ta.length) await actor.importTrashedTicketAttachments(ta);
    const tw = toEntries(backup.trash.warehouseEntries);
    if (tw.length) await actor.importTrashedWarehouseItems(tw);
    const tm = toEntries(backup.trash.movementEntries);
    if (tm.length) await actor.importTrashedStockMovements(tm);
    const tpr = toEntries(backup.trash.projectEntries);
    if (tpr.length) await actor.importTrashedProjects(tpr);
  }

  if (backup.logbook) {
    onProgress("Importuję Dziennik użytkowania...");
    const entries = backup.logbook.entries.map(convertLogbookEntry);
    if (entries.length) await actor.importLogbookEntries(entries);
    const instructors = (backup.logbook.instructors || []).map(convertLogbookInstructor);
    if (instructors.length) await actor.importLogbookInstructors(instructors);
    const sigs = (backup.logbook.signatures || []).map(([id, s]: [any, any]) => [bn(id), s]);
    if (sigs.length) await actor.importLogbookEntrySignatures(sigs);
    const devs = (backup.logbook.entryDevices || []).map(([id, devId]: [any, any, any]) => [bn(id), bn(devId)]);
    if (devs.length) await actor.importLogbookEntryDevices(devs);
    const links = (backup.logbook.linkedTickets || []).map(([id, tId]: [any, any]) => [bn(id), bn(tId)]);
    if (links.length) await actor.importLogbookEntryLinkedTickets(links);
    const trashedLb = (backup.logbook.trashedEntries || []).map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    if (trashedLb.length) await actor.importTrashedLogbookEntries(trashedLb);
  }

  if (backup.documentation) {
    onProgress("Importuję Dokumentację...");
    const folders = (backup.documentation.folders || []).map(([id, name, owner, createdAt]: [any, any, any, any]) =>
      [bn(id), name, Principal.fromText(owner), bn(createdAt)]
    );
    if (folders.length) await actor.importDocFolders(folders);
    const chapters = (backup.documentation.chapters || []).map(convertManualChapter);
    if (chapters.length) await actor.importDeviceManualChapters(chapters);
    const trashedCh = (backup.documentation.trashedChapterEntries || []).map(([id, ts]: [any, any]) => [bn(id), bn(ts)]);
    if (trashedCh.length) await actor.importTrashedDeviceManualChapters(trashedCh);
  }

  onProgress("Import zakończony.");
}

export function BackupImport({ actor }: { actor: any }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const handleFile = async (file: File) => {
    setRunning(true);
    setError("");
    setProgress("Wczytuję plik...");
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!confirm("Import doda tylko rekordy, których jeszcze nie ma na tym kanistrze (istniejące ID zostaną pominięte, nic nie zostanie nadpisane). Kontynuować?")) {
        setRunning(false);
        setProgress("");
        return;
      }
      await importBackup(actor, backup, setProgress);
    } catch (e: any) {
      setError("Błąd importu: " + String(e?.message || e));
    }
    setRunning(false);
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <h2 className="font-semibold text-[var(--text-primary)]">Import kopii zapasowej</h2>
      <p className="text-xs text-[var(--text-muted)]">
        ℹ️ Import dosypuje tylko brakujące rekordy — jeśli dane o danym ID już istnieją na tym kanistrze, zostaną pominięte (nic nie jest nadpisywane). Bezpieczne do wielokrotnego użycia.
      </p>
      <input
        type="file"
        accept=".json"
        disabled={running}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
        className="text-sm"
      />
      {progress && <p className="text-xs text-[var(--text-muted)]">{progress}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
