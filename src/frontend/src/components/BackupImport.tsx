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
    await actor.uploadTicketAttachmentChunk(attachmentId, BigInt(i), bytes.subarray(start, end));
  }
}

async function importBackup(actor: any, backup: any, onProgress: (s: string) => void) {
  onProgress("Importuję dostęp administracyjny...");
  for (const a of backup.admin.accessEntries) {
    const principal = Principal.fromText(a.principal);
    await actor.changeAccessRole(principal, a.role);
    await actor.setUserModules(principal, a.modules);
  }
  const codes = backup.admin.inviteCodes.map(convertInviteCode);
  if (codes.length) await actor.importInviteCodes(codes);

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
  let done = 0;
  for (const a of backup.tickets.attachments) {
    done++;
    onProgress("Importuję treść załączników... (" + done + "/" + backup.tickets.attachments.length + ")");
    if (a.dataBase64) await uploadAttachmentContent(actor, bn(a.meta.id), a.dataBase64);
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
      if (!confirm("Import wpisze dane bezpośrednio z zachowaniem oryginalnych ID. Używaj tylko na świeżym, pustym kanistrze. Kontynuować?")) {
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
        ⚠️ Używaj TYLKO na świeżym, pustym kanistrze — zachowuje oryginalne ID rekordów. Import na kanister z istniejącymi danymi może je nadpisać.
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
