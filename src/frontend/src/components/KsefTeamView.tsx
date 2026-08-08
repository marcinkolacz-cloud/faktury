import React, { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { renderReadableInvoiceHtml, printInvoiceHtml } from "../lib/ksefInvoicePreview";
import { setKsefActor } from "../lib/ksefConfig";
import { odDownloadFileBlob, setDriveActor } from "../lib/oneDriveConfig";
import { InfoTip } from "./InfoTip";

export function KsefTeamView({ onHome, onNavigate, currentModule, actor }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string; actor: any }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, { items: any[]; link: string }>>({});
  const [colFilters, setColFilters] = useState({ date: "", seller: "", invoiceNumber: "" });
  const [readableHtml, setReadableHtml] = useState<string | null>(null);
  const [readableLoading, setReadableLoading] = useState(false);

  const showReadableInvoice = async (ksefNumber: string) => {
    if (ksefNumber.startsWith("MANUAL-")) {
      const details = await actor.getInvoiceDetails(ksefNumber);
      const itemId = details[1]?.[0] || "";
      if (!itemId) {
        alert("Ta faktura nie ma dołączonego dokumentu.");
        return;
      }
      if (itemId.startsWith("http")) {
        window.open(itemId, "_blank");
        return;
      }
      const win = window.open("", "_blank");
      try {
        const blob = await odDownloadFileBlob(itemId);
        const blobUrl = URL.createObjectURL(blob);
        if (win) win.location.href = blobUrl;
      } catch (e: any) {
        if (win) win.close();
        alert("Nie udało się pobrać dokumentu z Dysku: " + String(e?.message || e));
      }
      return;
    }
    setReadableLoading(true);
    setReadableHtml("");
    try {
      const html = await renderReadableInvoiceHtml(ksefNumber);
      setReadableHtml(html);
    } catch (e: any) {
      setReadableHtml("<p>Nie udało się wygenerować podglądu: " + String(e?.message || e) + "</p>");
    }
    setReadableLoading(false);
  };

  const toggleDetails = async (ksefNumber: string) => {
    if (expandedId === ksefNumber) {
      setExpandedId(null);
      return;
    }
    setExpandedId(ksefNumber);
    if (!detailsCache[ksefNumber]) {
      const [items, link] = await actor.getInvoiceDetails(ksefNumber);
      setDetailsCache((prev) => ({ ...prev, [ksefNumber]: { items: items[0] || [], link: link[0] || "" } }));
    }
  };

  useEffect(() => {
    if (actor) {
      setDriveActor(actor);
      setKsefActor(actor);
      actor.listSharedInvoices().then((result: any) => {
        setInvoices(result);
        setLoading(false);
      });
    }
  }, [actor]);

  const formatDate = (d: string) => {
    if (!d) return "";
    const parts = d.split("-");
    if (parts.length !== 3) return d;
    return parts[2] + "." + parts[1] + "." + parts[0];
  };

  const rankMap = new Map<string, number>();
  [...invoices].sort((a, b) => Number(a.importedAt - b.importedAt)).forEach((inv, i) => rankMap.set(inv.ksefNumber, i + 1));

  const filteredInvoices = invoices
    .filter((i) => i.issueDate.toLowerCase().includes(colFilters.date.toLowerCase()))
    .filter((i) => (i.sellerName + " " + i.sellerNip).toLowerCase().includes(colFilters.seller.toLowerCase()))
    .filter((i) => i.invoiceNumber.toLowerCase().includes(colFilters.invoiceNumber.toLowerCase()))
    .sort((a, b) => (a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : Number(b.importedAt - a.importedAt)));

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-[var(--text-muted)]">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1200px] mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4 pb-2">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">KSeF — Faktury zakupowe</h1>
          <InfoTip text="Automatyczne pobieranie faktur z Krajowego Systemu e-Faktur. Udostępnienie faktury generuje plik HTML i wgrywa go na OneDrive, a link zapisuje się przy fakturze." />
        </div>
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4">
            <div className="mobile-scroll-table overflow-auto rounded border border-[var(--border-color)]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-hover)] sticky top-0">
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="p-2 w-8">Lp.</th>
                    <th className="p-2">Data</th>
                    <th className="p-2">Sprzedawca</th>
                    <th className="p-2">Nr faktury</th>
                    <th className="p-2 text-right">Netto</th>
                    <th className="p-2 text-right">Brutto</th>
                    <th className="p-2"></th>
                  </tr>
                  <tr className="bg-[var(--bg-card)]">
                    <th className="p-1"></th>
                    <th className="p-1"><input value={colFilters.date} onChange={(e) => setColFilters((f) => ({ ...f, date: e.target.value }))} placeholder="szukaj..." className="w-full text-[10px] font-normal border border-[var(--border-color)] rounded px-1 py-0.5" /></th>
                    <th className="p-1"><input value={colFilters.seller} onChange={(e) => setColFilters((f) => ({ ...f, seller: e.target.value }))} placeholder="szukaj..." className="w-full text-[10px] font-normal border border-[var(--border-color)] rounded px-1 py-0.5" /></th>
                    <th className="p-1"><input value={colFilters.invoiceNumber} onChange={(e) => setColFilters((f) => ({ ...f, invoiceNumber: e.target.value }))} placeholder="szukaj..." className="w-full text-[10px] font-normal border border-[var(--border-color)] rounded px-1 py-0.5" /></th>
                    <th className="p-1"></th>
                    <th className="p-1"></th>
                    <th className="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-sm text-[var(--text-muted)] py-4">Brak udostępnionych faktur (lub brak wyników dla podanych filtrów).</td>
                    </tr>
                  )}
                  {filteredInvoices.map((inv, idx) => (
                    <React.Fragment key={inv.ksefNumber}>
                    <tr className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                      <td className="p-2 text-gray-400">{rankMap.get(inv.ksefNumber) || idx + 1}</td>
                      <td className="p-2">{formatDate(inv.issueDate)}</td>
                      <td className="p-2">{inv.sellerName} <span className="text-[var(--text-muted)]">({inv.sellerNip})</span></td>
                      <td className="p-2">{inv.invoiceNumber}</td>
                      <td className="p-2 text-right font-mono">{inv.netAmount.toFixed(2)} {inv.currency}</td>
                      <td className="p-2 text-right font-mono">{inv.grossAmount.toFixed(2)} {inv.currency}</td>
                      <td className="p-2">
                        <button onClick={() => toggleDetails(inv.ksefNumber)} className="text-cyan-600 hover:underline text-[10px] mr-2">
                          {expandedId === inv.ksefNumber ? "Zwiń" : "Pozycje"}
                        </button>
                        <button onClick={() => showReadableInvoice(inv.ksefNumber)} className="text-cyan-600 hover:underline text-[10px]">📄 Podgląd</button>
                      </td>
                    </tr>
                    {expandedId === inv.ksefNumber && (
                      <tr className="bg-[var(--bg-page)]">
                        <td colSpan={7} className="p-2">
                          {!detailsCache[inv.ksefNumber] ? (
                            <p className="text-[10px] text-[var(--text-muted)]">Ładowanie...</p>
                          ) : (
                            <>
                              {detailsCache[inv.ksefNumber].items.length > 0 && (
                                <table className="w-full text-[10px] mb-2">
                                  <thead>
                                    <tr className="text-left text-[var(--text-muted)]">
                                      <th className="p-1">Nazwa</th>
                                      <th className="p-1 text-right">Ilość</th>
                                      <th className="p-1">Jedn.</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailsCache[inv.ksefNumber].items.map((line: any, idx: number) => (
                                      <tr key={idx} className="border-t border-[var(--border-color-light)]">
                                        <td className="p-1">{line.name}</td>
                                        <td className="p-1 text-right font-mono">{line.quantity}</td>
                                        <td className="p-1">{line.unit}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}

                            </>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
        </div>
      </div>
      {readableHtml !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setReadableHtml(null)}>
          <div className="bg-white rounded-lg w-full h-full max-w-4xl overflow-auto shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-white">
              <span className="font-medium text-sm text-gray-800">Podgląd faktury</span>
              <div className="flex items-center gap-2">
                <button onClick={() => printInvoiceHtml(readableHtml || "")} className="text-cyan-600 hover:underline text-sm">🖨️ Zapisz jako / Drukuj</button>
                <button onClick={() => setReadableHtml(null)} className="text-gray-600 hover:text-gray-900 text-xl leading-none px-2">✕</button>
              </div>
            </div>
            {readableLoading ? (
              <p className="p-4 text-sm text-gray-500">Generuję podgląd...</p>
            ) : (
              <div className="p-4" dangerouslySetInnerHTML={{ __html: readableHtml }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
