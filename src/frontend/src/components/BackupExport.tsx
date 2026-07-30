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
  const [accessEntries, inviteCodes] = await Promise.all([
    actor.listAccessEntries(),
    actor.listInviteCodes(),
  ]);
  const accessWithModules = await Promise.all(
    accessEntries.map(async (a: any) => ({
      ...a,
      modules: await actor.getUserModules(a.principal),
    }))
  );
  backup.admin = { accessEntries: accessWithModules, inviteCodes };

  onProgress("Eksportuję Rejestr Faktur i Projekty...");
  const [expenses, advancePayments, projects, ksefSent] = await Promise.all([
    actor.listMyExpenses(),
    actor.listMyAdvancePayments(),
    actor.listMyProjects(),
    actor.listExpenseKsefSent(),
  ]);
  backup.invoicesAndProjects = { expenses, advancePayments, projects, ksefSent };

  onProgress("Eksportuję Magazyn...");
  const [warehouseItems, stockMovements, warehouseCategories] = await Promise.all([
    actor.listWarehouseItems(),
    actor.listStockMovements(),
    actor.listWarehouseCategories(),
  ]);
  backup.warehouse = { items: warehouseItems, movements: stockMovements, categories: warehouseCategories };

  onProgress("Eksportuję Zgłoszenia...");
  const [tickets, ticketExtras, archivedIds, seenCounts, ticketTokens] = await Promise.all([
    actor.listTickets(),
    actor.listTicketExtras(),
    actor.listArchivedTicketIds(),
    actor.getTicketSeenCounts(),
    actor.listTicketTokens(),
  ]);

  const attachmentsOut: any[] = [];
  let done = 0;
  for (const t of tickets) {
    done++;
    onProgress("Eksportuję załączniki zgłoszeń... (" + done + "/" + tickets.length + ")");
    const atts = await actor.listTicketAttachments(t.id);
    for (const a of atts) {
      const parts: Uint8Array[] = [];
      for (let i = 0; i < Number(a.totalChunks); i++) {
        const chunk = await actor.getTicketAttachmentChunk(a.id, i);
        if (chunk && chunk.length > 0) parts.push(new Uint8Array(chunk[0]));
      }
      attachmentsOut.push({ meta: a, dataBase64: uint8ToBase64(concatUint8(parts)) });
    }
  }
  backup.tickets = { tickets, extras: ticketExtras, archivedIds, seenCounts, tokens: ticketTokens, attachments: attachmentsOut };

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
