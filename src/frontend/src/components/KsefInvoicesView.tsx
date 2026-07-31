import React, { useEffect, useState } from "react";
import { setKsefActor, ksefSetToken, ksefStatus, ksefTestAuth, ksefListInvoices, ksefGetInvoiceXml } from "../lib/ksefConfig";
import { renderReadableInvoiceHtml, printInvoiceHtml } from "../lib/ksefInvoicePreview";
import { odCreateFolder, odList, odUploadFile, setDriveActor } from "../lib/oneDriveConfig";

export function KsefInvoicesView({ actor }: { actor: any }) {
  const [configured, setConfigured] = useState(false);
  const [configuredNip, setConfiguredNip] = useState<string | null>(null);
  const [ksefTokenInput, setKsefTokenInput] = useState("");
  const [nipInput, setNipInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState("");
  const [pending, setPending] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [sharedMap, setSharedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (actor) {
      setKsefActor(actor);
      setDriveActor(actor);
      checkStatus();
      reloadPending();
    }
  }, [actor]);

  const checkStatus = async () => {
    const result = await ksefStatus();
    setConfigured(!!result.configured);
    setConfiguredNip(result.nip || null);
  };

  const reloadPending = async () => {
    const result = await actor.listPendingInvoices();
    setPending(result);
    const statuses = await actor.listSharedStatuses();
    const map: Record<string, boolean> = {};
    statuses.forEach(([id, isShared]: [string, boolean]) => { map[id] = isShared; });
    setSharedMap(map);
    setLoadingList(false);
  };

  const toggleShare = async (ksefNumber: string) => {
    await actor.toggleShareInvoiceToTeam(ksefNumber);
    setSharedMap((prev) => ({ ...prev, [ksefNumber]: !prev[ksefNumber] }));
  };

  const saveToken = async () => {
    if (!ksefTokenInput.trim() || !nipInput.trim()) return;
    await ksefSetToken(ksefTokenInput.trim(), nipInput.trim());
    setKsefTokenInput("");
    checkStatus();
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult("");
    const result = await ksefTestAuth();
    setTestResult(result.success ? "✅ Połączenie działa poprawnie." : "❌ Błąd: " + result.error);
    setTesting(false);
  };

  const fetchInvoices = async () => {
    setFetching(true);
    setFetchMessage("Pobieram listę faktur z KSeF...");
    try {
      const fromIso = fromDate + "T00:00:00Z";
      const toIso = toDate + "T23:59:59Z";
      const result = await ksefListInvoices(fromIso, toIso);
      if (result.error) {
        setFetchMessage("Błąd: " + JSON.stringify(result.detail || result.error));
        setFetching(false);
        return;
      }
      const items = (result.invoices || []).map((inv: any) => ({
        ksefNumber: inv.ksefNumber,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        sellerNip: inv.seller?.nip || "",
        sellerName: inv.seller?.name || "",
        netAmount: inv.netAmount || 0,
        grossAmount: inv.grossAmount || 0,
        vatAmount: inv.vatAmount || 0,
        currency: inv.currency || "PLN",
      }));
      const importedCount = await actor.importPendingInvoices(items);
      setFetchMessage("Pobrano " + items.length + " faktur, nowych: " + importedCount + ".");
      reloadPending();
    } catch (e: any) {
      setFetchMessage("Błąd: " + String(e?.message || e));
    }
    setFetching(false);
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDecided, setSelectedDecided] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [addingToWarehouse, setAddingToWarehouse] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, { name: string; quantity: number; unit: string }[]>>({});
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [readableHtml, setReadableHtml] = useState<string | null>(null);
  const [readableLoading, setReadableLoading] = useState(false);

  const showReadableInvoice = async (ksefNumber: string) => {
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

  const getElementsByLocalName = (root: Document | Element, localName: string): Element[] => {
    const all = root.getElementsByTagName("*");
    const result: Element[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === localName || all[i].tagName === localName) {
        result.push(all[i]);
      }
    }
    return result;
  };

  const getChildTextByLocalName = (row: Element, localName: string): string => {
    const found = getElementsByLocalName(row, localName);
    return found[0]?.textContent || "";
  };

  const parseInvoiceLines = (xmlText: string): { name: string; quantity: number; unit: string }[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const faRows = getElementsByLocalName(doc, "FaWiersz");
    if (faRows.length > 0) {
      return faRows.map((row) => ({
        name: getChildTextByLocalName(row, "P_7"),
        quantity: parseFloat(getChildTextByLocalName(row, "P_8B")) || 0,
        unit: getChildTextByLocalName(row, "P_8A"),
      }));
    }
    const zamowienieRows = getElementsByLocalName(doc, "ZamowienieWiersz");
    return zamowienieRows.map((row) => ({
      name: getChildTextByLocalName(row, "P_7Z"),
      quantity: parseFloat(getChildTextByLocalName(row, "P_8BZ")) || 0,
      unit: getChildTextByLocalName(row, "P_8AZ"),
    }));
  };

  const togglePreview = async (ksefNumber: string) => {
    if (expandedId === ksefNumber) {
      setExpandedId(null);
      return;
    }
    setExpandedId(ksefNumber);
    if (!previewCache[ksefNumber]) {
      setLoadingPreview(ksefNumber);
      try {
        const xmlText = await ksefGetInvoiceXml(ksefNumber);
        const lines = parseInvoiceLines(xmlText);
        setPreviewCache((prev) => ({ ...prev, [ksefNumber]: lines }));
      } catch (e: any) {
        alert("Nie udało się pobrać pozycji: " + String(e?.message || e));
      }
      setLoadingPreview(null);
    }
  };

  const ensureKsefFolder = async () => {
    const listing = await odList("");
    const exists = (listing.items || []).some((i: any) => i.isFolder && i.name === "Faktury KSeF");
    if (!exists) await odCreateFolder("", "Faktury KSeF");
  };

  const addToWarehouse = async (ksefNumber: string) => {
    const invoice = pending.find((p) => p.ksefNumber === ksefNumber);
    if (!invoice) return;
    setAddingToWarehouse(ksefNumber);
    try {
      const xmlText = await ksefGetInvoiceXml(ksefNumber);
      const lines = parseInvoiceLines(xmlText);
      if (lines.length === 0) {
        alert("Nie udało się wyodrębnić żadnych pozycji z tej faktury.");
        setAddingToWarehouse(null);
        return;
      }

      await ensureKsefFolder();
      const fileName = ksefNumber + ".xml";
      const file = new File([xmlText], fileName, { type: "application/xml" });
      await odUploadFile("Faktury KSeF", file);
      const folderListing = await odList("Faktury KSeF");
      const uploadedItem = (folderListing.items || []).find((i: any) => i.name === fileName);
      const link = uploadedItem?.webUrl || "";

      const note = "Faktura " + invoice.invoiceNumber + " — " + invoice.sellerName;
      for (const line of lines) {
        const itemId = await actor.createWarehouseItem(
          line.name, "", "", link, invoice.sellerName, ksefNumber, "Z faktur KSeF", false, false, false, "", note
        );
        await actor.recordStockMovement(itemId, { in: null }, line.quantity, [], "System KSeF", invoice.issueDate, note);
      }

      await actor.addInvoiceToWarehouse(ksefNumber, lines, link);
      reloadPending();
      alert("Dodano " + lines.length + " pozycji do magazynu.");
    } catch (e: any) {
      alert("Błąd: " + String(e?.message || e));
    }
    setAddingToWarehouse(null);
  };

  const rejectInvoice = async (ksefNumber: string) => {
    if (!confirm("Odrzucić tę fakturę (uznać za nieistotną dla magazynu)?")) return;
    await actor.rejectPendingInvoice(ksefNumber);
    reloadPending();
  };

  const toggleSelect = (ksefNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ksefNumber)) { next.delete(ksefNumber); } else { next.add(ksefNumber); }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === pendingOnly.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingOnly.map((i) => i.ksefNumber)));
    }
  };

  const bulkShare = async () => {
    setBulkProcessing(true);
    for (const ksefNumber of selected) {
      if (!sharedMap[ksefNumber]) await actor.toggleShareInvoiceToTeam(ksefNumber);
    }
    setSelected(new Set());
    reloadPending();
    setBulkProcessing(false);
  };

  const bulkReject = async () => {
    if (!confirm("Odrzucić zaznaczone " + selected.size + " faktur(y)?")) return;
    setBulkProcessing(true);
    for (const ksefNumber of selected) {
      await actor.rejectPendingInvoice(ksefNumber);
    }
    setSelected(new Set());
    reloadPending();
    setBulkProcessing(false);
  };

  const bulkAddToWarehouse = async () => {
    if (!confirm("Dodać zaznaczone " + selected.size + " faktur(y) do magazynu? Może to potrwać dłuższą chwilę.")) return;
    setBulkProcessing(true);
    for (const ksefNumber of selected) {
      await addToWarehouse(ksefNumber);
    }
    setSelected(new Set());
    setBulkProcessing(false);
  };

  const restoreRejected = async (ksefNumber: string) => {
    await actor.restoreRejectedInvoice(ksefNumber);
    reloadPending();
  };

  const permanentlyDelete = async (ksefNumber: string) => {
    if (!confirm("Usunąć tę fakturę trwale? Tej operacji nie można cofnąć.")) return;
    await actor.permanentlyDeletePendingInvoice(ksefNumber);
    reloadPending();
  };

  const toggleSelectDecided = (ksefNumber: string) => {
    setSelectedDecided((prev) => {
      const next = new Set(prev);
      if (next.has(ksefNumber)) { next.delete(ksefNumber); } else { next.add(ksefNumber); }
      return next;
    });
  };

  const toggleSelectAllDecided = () => {
    if (selectedDecided.size === decidedOnly.length) {
      setSelectedDecided(new Set());
    } else {
      setSelectedDecided(new Set(decidedOnly.map((i) => i.ksefNumber)));
    }
  };

  const bulkPermanentDeleteDecided = async () => {
    if (!confirm("Usunąć trwale zaznaczone " + selectedDecided.size + " faktur(y)? Tej operacji nie można cofnąć.")) return;
    setBulkProcessing(true);
    for (const ksefNumber of selectedDecided) {
      await actor.permanentlyDeletePendingInvoice(ksefNumber);
    }
    setSelectedDecided(new Set());
    reloadPending();
    setBulkProcessing(false);
  };

  const pendingOnly = pending.filter((p) => Object.keys(p.status)[0] !== "rejected");
  const decidedOnly = pending.filter((p) => Object.keys(p.status)[0] === "rejected");

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-4">
      <h2 className="font-semibold text-sm">📄 Faktury z KSeF (kwarantanna administratora)</h2>

      {!configured ? (
        <div className="space-y-2 bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-3">
          <p className="text-xs text-[var(--text-muted)]">Wklej token KSeF wygenerowany w portalu MCU (mcu.mf.gov.pl/web) oraz NIP firmy.</p>
          <input value={nipInput} onChange={(e) => setNipInput(e.target.value)} placeholder="NIP (np. 7282842652)" className="w-full text-sm border border-[var(--border-color)] bg-[var(--bg-card)] rounded px-2 py-1.5" />
          <textarea value={ksefTokenInput} onChange={(e) => setKsefTokenInput(e.target.value)} placeholder="Token KSeF" rows={2} className="w-full text-sm border border-[var(--border-color)] bg-[var(--bg-card)] rounded px-2 py-1.5 font-mono" />
          <button onClick={saveToken} disabled={!ksefTokenInput.trim() || !nipInput.trim()} className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50">Zapisz</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>✅ Skonfigurowano (NIP: {configuredNip})</span>
          <button onClick={testConnection} disabled={testing} className="text-cyan-600 hover:underline">{testing ? "Sprawdzam..." : "Testuj połączenie"}</button>
          <button onClick={() => setConfigured(false)} className="text-[var(--text-secondary)] hover:underline">Zmień token</button>
          {testResult && <span>{testResult}</span>}
        </div>
      )}

      {configured && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm" />
            <span className="text-xs text-[var(--text-muted)]">do</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm" />
            <button onClick={fetchInvoices} disabled={fetching} className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50">
              {fetching ? "Pobieram..." : "Pobierz nowe faktury"}
            </button>
          </div>
          {fetchMessage && <p className="text-xs text-[var(--text-muted)]">{fetchMessage}</p>}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase">Oczekujące na decyzję ({pendingOnly.length})</p>
        {loadingList ? (
          <p className="text-xs text-[var(--text-muted)]">Ładowanie...</p>
        ) : pendingOnly.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Brak faktur oczekujących.</p>
        ) : (
          <>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-800 rounded p-2 text-xs">
              <span>Zaznaczono: {selected.size}</span>
              <button onClick={bulkShare} disabled={bulkProcessing} className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50">Udostępnij</button>
              <button onClick={bulkAddToWarehouse} disabled={bulkProcessing} className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50">
                {bulkProcessing ? "Przetwarzam..." : "Do magazynu"}
              </button>
              <button onClick={bulkReject} disabled={bulkProcessing} className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50">Odrzuć</button>
              <button onClick={() => setSelected(new Set())} className="px-2 py-1 border border-[var(--border-color)] rounded">Anuluj</button>
            </div>
          )}
          <div className="overflow-auto max-h-[400px] border border-[var(--border-color-light)] rounded">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-hover)] sticky top-0">
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="p-2"><input type="checkbox" checked={selected.size === pendingOnly.length && pendingOnly.length > 0} onChange={toggleSelectAll} /></th>
                  <th className="p-2">Data</th>
                  <th className="p-2">Sprzedawca</th>
                  <th className="p-2">Nr faktury</th>
                  <th className="p-2 text-right">Brutto</th>
                  <th className="p-2 text-center">Udostępnione</th>
                  <th className="p-2 text-center">W magazynie</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {pendingOnly.map((inv) => (
                  <React.Fragment key={inv.ksefNumber}>
                  <tr className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                    <td className="p-2"><input type="checkbox" checked={selected.has(inv.ksefNumber)} onChange={() => toggleSelect(inv.ksefNumber)} /></td>
                    <td className="p-2">{inv.issueDate}</td>
                    <td className="p-2">{inv.sellerName} <span className="text-[var(--text-muted)]">({inv.sellerNip})</span></td>
                    <td className="p-2">{inv.invoiceNumber}</td>
                    <td className="p-2 text-right font-mono">{inv.grossAmount.toFixed(2)} {inv.currency}</td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!sharedMap[inv.ksefNumber]}
                        onChange={() => toggleShare(inv.ksefNumber)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                    </td>
                    <td className="p-2 text-center">
                      {Object.keys(inv.status)[0] === "addedToWarehouse" && <span className="text-emerald-600">✅</span>}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => togglePreview(inv.ksefNumber)} className="text-[var(--text-secondary)] hover:underline mr-2">
                        {expandedId === inv.ksefNumber ? "Zwiń" : "Pozycje"}
                      </button>
                      <button onClick={() => showReadableInvoice(inv.ksefNumber)} className="text-[var(--text-secondary)] hover:underline mr-2">📄 Podgląd</button>
                      {Object.keys(inv.status)[0] === "pending" && (
                        <button onClick={() => addToWarehouse(inv.ksefNumber)} disabled={addingToWarehouse === inv.ksefNumber} className="text-cyan-600 hover:underline mr-2 disabled:opacity-50">
                          {addingToWarehouse === inv.ksefNumber ? "Przetwarzam..." : "➡️ Do magazynu"}
                        </button>
                      )}
                      {Object.keys(inv.status)[0] === "pending" && (
                        <button onClick={() => rejectInvoice(inv.ksefNumber)} className="text-red-500 hover:underline">🗑️ Odrzuć</button>
                      )}
                    </td>
                  </tr>
                  {expandedId === inv.ksefNumber && (
                    <tr className="bg-[var(--bg-page)]">
                      <td colSpan={8} className="p-2">
                        {loadingPreview === inv.ksefNumber ? (
                          <p className="text-[10px] text-[var(--text-muted)]">Wczytuję pozycje...</p>
                        ) : (previewCache[inv.ksefNumber] || []).length === 0 ? (
                          <p className="text-[10px] text-[var(--text-muted)]">Brak pozycji lub nie udało się ich wczytać.</p>
                        ) : (
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="text-left text-[var(--text-muted)]">
                                <th className="p-1">Nazwa</th>
                                <th className="p-1 text-right">Ilość</th>
                                <th className="p-1">Jedn.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(previewCache[inv.ksefNumber] || []).map((line, idx) => (
                                <tr key={idx} className="border-t border-[var(--border-color-light)]">
                                  <td className="p-1">{line.name}</td>
                                  <td className="p-1 text-right font-mono">{line.quantity}</td>
                                  <td className="p-1">{line.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {decidedOnly.length > 0 && (
        <details className="text-xs">
          <summary className="text-[var(--text-muted)] cursor-pointer">Rozstrzygnięte ({decidedOnly.length})</summary>
          <div className="mt-1 space-y-1">
            <div className="flex items-center gap-2 px-2">
              <input type="checkbox" checked={selectedDecided.size === decidedOnly.length && decidedOnly.length > 0} onChange={toggleSelectAllDecided} />
              <span className="text-[var(--text-muted)]">Zaznacz wszystkie</span>
              {selectedDecided.size > 0 && (
                <button onClick={bulkPermanentDeleteDecided} disabled={bulkProcessing} className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50">
                  Usuń trwale zaznaczone ({selectedDecided.size})
                </button>
              )}
            </div>
            {decidedOnly.map((inv) => {
              const status = Object.keys(inv.status)[0];
              return (
              <div key={inv.ksefNumber} className="flex items-center justify-between px-2 py-1">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={selectedDecided.has(inv.ksefNumber)} onChange={() => toggleSelectDecided(inv.ksefNumber)} />
                  <span>{inv.sellerName} — {inv.invoiceNumber}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={status === "addedToWarehouse" ? "text-emerald-600" : "text-[var(--text-muted)]"}>
                    {status === "addedToWarehouse" ? "✅ Dodano do magazynu" : "🗑️ Odrzucono"}
                  </span>
                  {status === "rejected" && (
                    <button onClick={() => restoreRejected(inv.ksefNumber)} className="text-cyan-600 hover:underline">Przywróć</button>
                  )}
                  <button onClick={() => permanentlyDelete(inv.ksefNumber)} className="text-red-500 hover:underline">Usuń trwale</button>
                </div>
              </div>
              );
            })}
          </div>
        </details>
      )}
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
