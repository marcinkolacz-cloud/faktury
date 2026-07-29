import { useRef, useState } from "react";
import { ExpenseRow } from "./ExpenseRow";

export function ExpensesTable({ expenses, projects, actor, onChange, onToggle, filterProject, canWrite, ksefSentMap, onToggleKsef }: {
  expenses: any[]; projects: any[]; actor: any; onChange: () => void; onToggle: (id: bigint, method: string) => void; filterProject: string | null; canWrite: boolean;
  ksefSentMap: Record<string, boolean>; onToggleKsef: (id: bigint) => void;
}) {
  const [open, setOpen] = useState(false);
  const [productService, setProductService] = useState("");
  const [supplier, setSupplier] = useState("");
  const [projectName, setProjectName] = useState("");
  const [priceGross, setPriceGross] = useState("");
  const [priceNet, setPriceNet] = useState("");
  const [vatRate, setVatRate] = useState("23");
  const [orderDate, setOrderDate] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [note, setNote] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [colFilters, setColFilters] = useState({
    productService: "", supplier: "", project: "", orderDate: "",
    invoiceNumber: "", paidBy: "", note: "",
  });
  const setColFilter = (key: string, v: string) => setColFilters((prev) => ({ ...prev, [key]: v }));
  const [error, setError] = useState("");
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);

  const onGrossChange = (v: string) => {
    setPriceGross(v);
    const g = parseFloat(v);
    const rate = parseFloat(vatRate) || 0;
    if (!isNaN(g)) {
      setPriceNet((g / (1 + rate / 100)).toFixed(2));
    } else {
      setPriceNet("");
    }
  };

  const handleKeyDown = (idx: number) => (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      fieldRefs.current[idx + 1]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      fieldRefs.current[idx - 1]?.focus();
    }
  };

  const submit = async () => {
    const match = projects.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());
    if (!match) {
      setError("Nie znaleziono projektu o tej nazwie — utwórz go najpierw po lewej.");
      return;
    }
    setError("");
    await actor.createExpense(
      match.id,
      productService.trim(),
      supplier.trim(),
      "",
      [],
      [],
      [],
      priceGross ? [parseFloat(priceGross)] : [],
      priceNet ? [parseFloat(priceNet)] : [],
      orderDate.trim(),
      paidBy.trim(),
      invoiceNumber.trim(),
      "",
      note.trim(),
    );
    setProductService(""); setSupplier(""); setProjectName("");
    setPriceGross(""); setPriceNet(""); setOrderDate(""); setInvoiceNumber("");
    setPaidBy(""); setNote("");
    setOpen(false);
    onChange();
  };

  const projectNameById = (id: bigint) => projects.find((p) => p.id === id)?.name ?? "?";
  let visible = filterProject ? expenses.filter((e) => projectNameById(e.projectId) === filterProject) : expenses;
  if (statusFilter === "unpaid") visible = visible.filter((e) => !e.paid);
  if (statusFilter === "noinvoice") visible = visible.filter((e) => !e.hasInvoice);
  if (statusFilter === "unconfirmed") visible = visible.filter((e) => !e.confirmed);
  visible = visible.filter((e) => {
    const proj = projectNameById(e.projectId).toLowerCase();
    return (
      e.productService.toLowerCase().includes(colFilters.productService.toLowerCase()) &&
      e.supplier.toLowerCase().includes(colFilters.supplier.toLowerCase()) &&
      proj.includes(colFilters.project.toLowerCase()) &&
      e.orderDate.toLowerCase().includes(colFilters.orderDate.toLowerCase()) &&
      e.invoiceNumber.toLowerCase().includes(colFilters.invoiceNumber.toLowerCase()) &&
      e.paidBy.toLowerCase().includes(colFilters.paidBy.toLowerCase()) &&
      e.note.toLowerCase().includes(colFilters.note.toLowerCase())
    );
  });
  const sorted = [...visible].sort((a, b) => (a.orderDate < b.orderDate ? 1 : -1));
  const inputClass = "bg-[var(--bg-card)] border border-[var(--border-color)] px-2 py-1.5 rounded text-sm text-[var(--text-primary)] placeholder-gray-400";

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-[var(--text-primary)]">Wydatki {filterProject ? `— ${filterProject}` : ""}</h2>
        <div className="flex gap-2 items-center">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1 text-sm text-[var(--text-secondary)]">
            <option value="all">Wszystkie statusy</option>
            <option value="unpaid">Nieopłacone</option>
            <option value="noinvoice">Bez faktury</option>
            <option value="unconfirmed">Niepotwierdzone</option>
          </select>
          {canWrite && (
            <button onClick={() => setOpen(!open)} className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium">
              + Dodaj wydatek
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="bg-[var(--bg-page)] border border-[var(--border-color)] rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            <input ref={(el) => { fieldRefs.current[0] = el; }} onKeyDown={handleKeyDown(0)} value={productService} onChange={(e) => setProductService(e.target.value)} placeholder="Produkt/usługa" className={inputClass} />
            <input ref={(el) => { fieldRefs.current[1] = el; }} onKeyDown={handleKeyDown(1)} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Dostawca" className={inputClass} />
            <div>
              <input ref={(el) => { fieldRefs.current[2] = el; }} onKeyDown={handleKeyDown(2)} list="project-names" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Projekt (np. BAS004)" className={inputClass + " w-full"} />
              <datalist id="project-names">
                {projects.map((p) => <option key={String(p.id)} value={p.name} />)}
              </datalist>
            </div>
            <input ref={(el) => { fieldRefs.current[3] = el; }} onKeyDown={handleKeyDown(3)} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inputClass} />
            <input ref={(el) => { fieldRefs.current[4] = el; }} onKeyDown={handleKeyDown(4)} value={priceGross} onChange={(e) => onGrossChange(e.target.value)} placeholder="Cena brutto" type="number" className={inputClass} />
            <select value={vatRate} onChange={(e) => { setVatRate(e.target.value); onGrossChange(priceGross); }} className={inputClass}>
              <option value="23">VAT 23%</option>
              <option value="8">VAT 8%</option>
              <option value="5">VAT 5%</option>
              <option value="0">VAT 0%</option>
            </select>
            <input value={priceNet} onChange={(e) => setPriceNet(e.target.value)} placeholder="Cena netto" type="number" className={inputClass} />
            <input ref={(el) => { fieldRefs.current[5] = el; }} onKeyDown={handleKeyDown(5)} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Numer faktury" className={inputClass} />
            <input ref={(el) => { fieldRefs.current[6] = el; }} onKeyDown={handleKeyDown(6)} value={paidBy} onChange={(e) => setPaidBy(e.target.value)} placeholder="Kto płaci" className={inputClass} />
            <input ref={(el) => { fieldRefs.current[7] = el; }} onKeyDown={handleKeyDown(7)} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notatka" className={inputClass + " col-span-2"} />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={submit} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm">Dodaj</button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 border border-[var(--border-color)] text-[var(--text-secondary)] rounded text-sm">Anuluj</button>
          </div>
        </div>
      )}
      <div className="overflow-auto rounded border border-[var(--border-color)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-page)] sticky top-0">
            <tr className="text-left text-gray-500">
              <th className="p-2">Produkt</th>
              <th className="p-2">Dostawca</th>
              <th className="p-2">Projekt</th>
              <th className="p-2">Data</th>
              <th className="p-2 text-right">Brutto</th>
              <th className="p-2 text-right">Netto</th>
              <th className="p-2">Nr FV</th>
              <th className="p-2">Kto płaci</th>
              <th className="p-2">Notatka</th>
              <th className="p-2 text-center">Opł.</th>
              <th className="p-2 text-center">KSeF</th>
              <th className="p-2 text-center">FV</th>
              <th className="p-2 text-center">Potw.</th>
              <th className="p-2"></th>
            </tr>
            <tr className="bg-[var(--bg-card)]">
              <th className="p-1"><input value={colFilters.productService} onChange={(e) => setColFilter("productService", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.supplier} onChange={(e) => setColFilter("supplier", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.project} onChange={(e) => setColFilter("project", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.orderDate} onChange={(e) => setColFilter("orderDate", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"><input value={colFilters.invoiceNumber} onChange={(e) => setColFilter("invoiceNumber", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.paidBy} onChange={(e) => setColFilter("paidBy", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"><input value={colFilters.note} onChange={(e) => setColFilter("note", e.target.value)} placeholder="filtruj..." className="w-full border border-[var(--border-color)] rounded px-1 py-0.5 text-xs" /></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <ExpenseRow key={String(e.id)} expense={e} projectName={projectNameById(e.projectId)} projects={projects} actor={actor} onChange={onChange} onToggle={onToggle} canWrite={canWrite} ksefSent={ksefSentMap[String(e.id)] || false} onToggleKsef={onToggleKsef} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
