import { useRef, useState } from "react";
import * as XLSX from "xlsx";

export function ImportExport({ expenses, payments, projects, actor, onChange }: {
  expenses: any[]; payments: any[]; projects: any[]; actor: any; onChange: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");

  const projectNameById = (id: bigint) => projects.find((p) => p.id === id)?.name ?? "";

  const exportToExcel = () => {
    const expenseRows = expenses.map((e) => ({
      "Produkt/usługa": e.productService,
      "Dostawca": e.supplier,
      "Projekt": projectNameById(e.projectId),
      "Data": e.orderDate,
      "Brutto": e.pricePln?.[0] ?? "",
      "Netto": e.priceNet?.[0] ?? "",
      "Numer faktury": e.invoiceNumber,
      "Kto płaci": e.paidBy,
      "Notatka": e.note,
      "Opłacone": e.paid ? "TAK" : "NIE",
      "FV": e.hasInvoice ? "TAK" : "NIE",
      "Potwierdzone": e.confirmed ? "TAK" : "NIE",
    }));
    const paymentRows = payments.map((p) => ({
      "Data": p.date,
      "Kwota": p.amount,
      "Waluta": p.currency,
      "Notatka": p.note,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), "Wydatki");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows), "Zaliczki");
    XLSX.writeFile(wb, "rejestr-faktur-" + new Date().toISOString().slice(0, 10) + ".xlsx");
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setStatus("Wczytywanie pliku...");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);

    const projectCache = new Map<string, bigint>();
    for (const p of projects) projectCache.set(p.name.toLowerCase(), p.id);

    const getOrCreateProject = async (name: string): Promise<bigint> => {
      const key = name.trim().toLowerCase();
      if (projectCache.has(key)) return projectCache.get(key)!;
      const id = await actor.createProject(name.trim());
      projectCache.set(key, id);
      return id;
    };

    let importedExpenses = 0;
    let importedPayments = 0;

    if (wb.SheetNames.includes("Wydatki")) {
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets["Wydatki"]);
      for (const row of rows) {
        setStatus("Wydatek " + (importedExpenses + 1) + "/" + rows.length + "...");
        const projName = String(row["Projekt"] ?? row["TYP wydatku"] ?? "").trim();
        if (!projName) continue;
        const projectId = await getOrCreateProject(projName);
        await actor.createExpense(
          projectId,
          String(row["Produkt/usługa"] ?? row["Produkt"] ?? ""),
          String(row["Dostawca"] ?? ""),
          "",
          [],
          [],
          [],
          row["Brutto"] || row["Cena PLN"] ? [parseFloat(row["Brutto"] ?? row["Cena PLN"])] : [],
          row["Netto"] || row["Cena netto"] ? [parseFloat(row["Netto"] ?? row["Cena netto"])] : [],
          String(row["Data"] ?? row["Data zamówienia"] ?? ""),
          String(row["Kto płaci"] ?? ""),
          String(row["Numer faktury"] ?? ""),
          "",
          String(row["Notatka"] ?? ""),
        );
        importedExpenses++;
      }
    }

    if (wb.SheetNames.includes("Zaliczki")) {
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets["Zaliczki"]);
      for (const row of rows) {
        setStatus("Wpłata " + (importedPayments + 1) + "/" + rows.length + "...");
        await actor.recordAdvancePayment(
          String(row["Data"] ?? ""),
          parseFloat(row["Kwota"] ?? 0),
          String(row["Waluta"] ?? "PLN"),
          String(row["Notatka"] ?? ""),
        );
        importedPayments++;
      }
    }

    setStatus("Gotowe: " + importedExpenses + " wydatków, " + importedPayments + " wpłat.");
    setImporting(false);
    onChange();
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={exportToExcel} className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded font-medium">
        Eksportuj do Excel
      </button>
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
        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded font-medium disabled:opacity-50"
      >
        {importing ? "Importowanie..." : "Importuj z Excel"}
      </button>
      {status && <span className="text-xs text-gray-500">{status}</span>}
    </div>
  );
}
