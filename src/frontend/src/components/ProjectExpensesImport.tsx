import { useRef, useState } from "react";
import * as XLSX from "xlsx";

export function ProjectExpensesImport({ actor, onChange }: { actor: any; onChange: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");

  const expenseKey = (productService: string, supplier: string, date: string, price: number) =>
    productService.trim().toLowerCase() + "|" + supplier.trim().toLowerCase() + "|" + date.trim() + "|" + price.toFixed(2);

  const isTak = (v: any) => String(v ?? "").trim().toUpperCase() === "TAK";

  const handleImport = async (file: File) => {
    setImporting(true);
    setStatus("Wczytywanie pliku...");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);

    setStatus("Pobieram aktualne dane z bazy...");
    const [freshExpenses, freshProjects] = await Promise.all([
      actor.listMyExpenses(),
      actor.listMyProjects(),
    ]);
    const projectCache = new Map<string, bigint>();
    for (const p of freshProjects) projectCache.set(p.name.toLowerCase(), p.id);

    const existingExpenseKeys = new Set(
      freshExpenses.map((e: any) => expenseKey(e.productService, e.supplier, e.orderDate, e.pricePln?.[0] ?? 0))
    );

    const getOrCreateProject = async (name: string): Promise<bigint> => {
      const key = name.trim().toLowerCase();
      if (projectCache.has(key)) return projectCache.get(key)!;
      const id = await actor.createProject(name.trim());
      projectCache.set(key, id);
      return id;
    };

    const sheetName = wb.SheetNames.includes("Wydatki") ? "Wydatki" : wb.SheetNames[0];
    let skipped = 0;
    const batch: any[] = [];

    if (sheetName) {
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      setStatus("Przygotowuję " + rows.length + " pozycji...");
      for (const row of rows) {
        const projName = String(row["Projekt"] ?? "").trim();
        if (!projName) { skipped++; continue; }

        const rowPrice = parseFloat(row["Brutto"] ?? row["Cena PLN"] ?? "0") || 0;
        const rowKey = expenseKey(
          String(row["Produkt/usługa"] ?? row["Produkt"] ?? ""),
          String(row["Dostawca"] ?? ""),
          String(row["Data"] ?? row["Data zamówienia"] ?? ""),
          rowPrice
        );
        if (existingExpenseKeys.has(rowKey)) {
          skipped++;
          continue;
        }
        existingExpenseKeys.add(rowKey);

        const projectId = await getOrCreateProject(projName);
        batch.push([
          projectId,
          String(row["Produkt/usługa"] ?? row["Produkt"] ?? ""),
          String(row["Dostawca"] ?? ""),
          row["Brutto"] || row["Cena PLN"] ? [parseFloat(row["Brutto"] ?? row["Cena PLN"])] : [],
          row["Netto"] || row["Cena netto"] ? [parseFloat(row["Netto"] ?? row["Cena netto"])] : [],
          String(row["Data"] ?? row["Data zamówienia"] ?? ""),
          String(row["Kto płaci"] ?? ""),
          String(row["Numer faktury"] ?? ""),
          String(row["Notatka"] ?? ""),
          isTak(row["Opłacone"]),
          isTak(row["FV"]),
          isTak(row["Potwierdzone"]),
        ]);
      }
    }

    let imported = 0;
    if (batch.length > 0) {
      setStatus("Zapisuję " + batch.length + " pozycji w jednym zapytaniu...");
      imported = Number(await actor.bulkImportExpenses(batch));
    }

    setStatus("Gotowe: zaimportowano " + imported + " pozycji (pominięto " + skipped + ").");
    setImporting(false);
    onChange();
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className="px-3 py-1.5 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded font-medium disabled:opacity-50"
      >
        {importing ? "Importowanie..." : "📥 Importuj zakupy z Excel"}
      </button>
      {status && <span className="text-xs text-[var(--text-muted)]">{status}</span>}
    </div>
  );
}
