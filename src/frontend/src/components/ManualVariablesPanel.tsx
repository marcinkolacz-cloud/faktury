import { useEffect, useRef, useState } from "react";
import { syncChapterToDrive, loadChapterContentFromDrive } from "../lib/documentationDriveSync";

type Chapter = { id: number; title: string; contentHtml: string; order: number };
type ManualVariable = { key: string; fieldLabel: string; currentValue: string };
// Dopasowanie znalezione w PRZEGLĄDARCE (prawdziwy DOM), nie na backendzie —
// index to pozycja w czystym tekście (textContent), nie w surowym HTML.
type DomMatch = { chapterId: number; chapterTitle: string; index: number; contextSnippet: string };

// Renderuje HTML w niewidocznym kontenerze i szuka needle w tekście widocznym
// dla użytkownika (przeglądarka poprawnie obsługuje encje, zagnieżdżone tagi,
// &nbsp; itd. — dużo solidniej niż ręczne stripowanie tagów w Motoko).
function findOccurrencesInHtml(html: string, needle: string): { index: number; contextSnippet: string }[] {
  if (!needle) return [];
  const container = document.createElement("div");
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let plain = "";
  let node: Node | null;
  while ((node = walker.nextNode())) plain += (node as Text).data;
  const results: { index: number; contextSnippet: string }[] = [];
  // Case-insensitive: dokładna wielkość liter w dokumencie może się różnić od
  // tego co operator wpisał w polu referencyjnym. toLowerCase() nie zmienia
  // długości dla zwykłych liter, więc indeksy nadal wskazują poprawnie w plain.
  const plainLower = plain.toLowerCase();
  const needleLower = needle.toLowerCase();
  let idx = plainLower.indexOf(needleLower);
  while (idx !== -1) {
    const ctxStart = Math.max(0, idx - 40);
    const ctxEnd = Math.min(plain.length, idx + needle.length + 40);
    results.push({ index: idx, contextSnippet: plain.slice(ctxStart, ctxEnd) });
    idx = plainLower.indexOf(needleLower, idx + 1);
  }
  return results;
}

// Podmienia wybrane wystąpienia (po indeksie w czystym tekście) w danym HTML
// przez Range API — działa poprawnie nawet gdy dopasowanie rozciąga się przez
// formatowanie (np. pogrubione jedno słowo w środku frazy). Zwraca nowy HTML.
function replaceOccurrencesInHtml(html: string, needle: string, newValue: string, indices: number[]): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const sortedDesc = [...indices].sort((a, b) => b - a);
  for (const pos of sortedDesc) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let plainLen = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node as Text;
      const tLen = t.data.length;
      if (startNode === null && pos < plainLen + tLen) {
        startNode = t;
        startOffset = pos - plainLen;
      }
      if (startNode !== null && endNode === null && pos + needle.length <= plainLen + tLen) {
        endNode = t;
        endOffset = pos + needle.length - plainLen;
        break;
      }
      plainLen += tLen;
    }
    if (!startNode || !endNode) continue;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    range.deleteContents();
    range.insertNode(document.createTextNode(newValue));
    container.normalize();
  }
  return container.innerHTML;
}

export function ManualVariablesPanel({
  actor,
  deviceId,
  deviceLabel,
  chapters,
  onClose,
  onChapterContentUpdated,
}: {
  actor: any;
  deviceId: number;
  deviceLabel: string;
  chapters: Chapter[];
  onClose: () => void;
  onChapterContentUpdated: (chapterId: number, newHtml: string) => void;
}) {
  const [vars, setVars] = useState<ManualVariable[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // key -> "nowa wartość" input
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [backupEnabled, setBackupEnabled] = useState<Record<number, boolean>>({});
  const [backupLengths, setBackupLengths] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<{ key: string; searchText: string; newValue: string; matches: DomMatch[]; picked: Set<number>; chapterHtml: Record<number, string>; queueRest: ManualVariable[] } | null>(null);
  const [tab, setTab] = useState<"vars" | "backup">("vars");

  const [rect, setRect] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth * 0.15)),
    y: Math.max(20, Math.round(window.innerHeight * 0.1)),
    width: Math.round(window.innerWidth * 0.7),
    height: Math.round(window.innerHeight * 0.75),
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.x, origY: rect.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const { startX, startY, origX, origY } = dragRef.current;
      setRect((r) => ({ ...r, x: Math.max(0, origX + (ev.clientX - startX)), y: Math.max(0, origY + (ev.clientY - startY)) }));
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const onResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: rect.width, origH: rect.height };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const { startX, startY, origW, origH } = resizeRef.current;
      setRect((r) => ({ ...r, width: Math.max(500, origW + (ev.clientX - startX)), height: Math.max(300, origH + (ev.clientY - startY)) }));
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const reloadVars = async () => {
    const rows = await actor.getDeviceManualVariables(deviceId);
    setVars(rows);
    setDirty(false);
  };
  const reloadBackupFlags = async () => {
    const entries = await Promise.all(chapters.map(async (ch) => [ch.id, await actor.getChapterBackupEnabled(ch.id)] as const));
    const map: Record<number, boolean> = {};
    for (const [id, en] of entries) map[id] = en;
    setBackupEnabled(map);
  };
  const reloadBackupLengths = async () => {
    const entries = await Promise.all(chapters.map(async (ch) => {
      const res: any = await actor.getDeviceManualChapterContentLength(ch.id);
      const len = res && res.length ? Number(res[0]) : 0;
      return [ch.id, len] as const;
    }));
    const map: Record<number, number> = {};
    for (const [id, len] of entries) map[id] = len;
    setBackupLengths(map);
  };
  useEffect(() => { reloadVars(); reloadBackupFlags(); reloadBackupLengths(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [deviceId, chapters.length]);

  const saveList = async () => {
    setBusy("save-list");
    try {
      await actor.setDeviceManualVariables(deviceId, vars);
      setDirty(false);
    } finally {
      setBusy("");
    }
  };

  const addRow = () => {
    let key = "pole_1";
    let n = vars.length + 1;
    const existing = new Set(vars.map((v) => v.key));
    while (existing.has(key)) { n += 1; key = `pole_${n}`; }
    setVars((v) => [...v, { key, fieldLabel: "Nowe pole", currentValue: "" }]);
    setDirty(true);
  };
  const removeRow = (key: string) => {
    setVars((v) => v.filter((x) => x.key !== key));
    setSelected((s) => { const n = new Set(s); n.delete(key); return n; });
    setDirty(true);
  };
  const updateLabel = (key: string, fieldLabel: string) => { setVars((v) => v.map((x) => (x.key === key ? { ...x, fieldLabel } : x))); setDirty(true); };
  const updateCurrent = (key: string, currentValue: string) => { setVars((v) => v.map((x) => (x.key === key ? { ...x, currentValue } : x))); setDirty(true); };

  const toggleSelected = (key: string, checked: boolean) => {
    setSelected((s) => { const n = new Set(s); if (checked) n.add(key); else n.delete(key); return n; });
  };

  // Kolejka wstawiania — przetwarza zaznaczone wiersze jeden po drugim.
  // Przy wielu trafieniach zatrzymuje się na modalu konfliktu i wznawia po decyzji operatora.
  const processQueue = (queue: ManualVariable[]) => {
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    doInsert(next, rest);
  };

  // Backup on-chain to tylko kopia zapasowa — OneDrive jest prawdziwym źródłem
  // czytanym przez edytor/podgląd/eksport PDF. Bez tego kroku podmiana byłaby
  // niewidoczna wszędzie poza tym panelem. Best-effort: błąd Drive nie cofa
  // już zapisanej zmiany w backendzie, tylko informuje operatora.
  const syncChangedChaptersToDrive = async (updated: [number, string][]) => {
    for (const [chapterId, newHtml] of updated) {
      const ch = chapters.find((c) => c.id === chapterId);
      if (!ch) continue;
      try {
        await syncChapterToDrive(deviceLabel, ch.id, ch.order, ch.title, newHtml);
      } catch (e: any) {
        alert(`Zapisano w backendzie, ale nie udało się zsynchronizować rozdziału „${ch.title}” z OneDrive: ${e?.message || e}. Otwórz i zapisz ten rozdział ręcznie w edytorze.`);
      }
    }
  };

  const doInsert = async (v: ManualVariable, queueRest: ManualVariable[] = []) => {
    const newValue = drafts[v.key] ?? "";
    if (!v.currentValue || !newValue) { processQueue(queueRest); return; }
    setBusy(v.key);
    try {
      // Zapisz całą listę PRZED wyszukiwaniem/podmianą — inaczej reloadVars()
      // niżej nadpisze niezapisane lokalnie wiersze (w tym puste/niekompletne).
      if (dirty) { await actor.setDeviceManualVariables(deviceId, vars); setDirty(false); }

      // Szukamy lokalnie (prawdziwy DOM przeglądarki) w każdym zbackupowanym
      // rozdziale — dużo solidniejsze niż wyszukiwanie w surowym HTML na backendzie.
      const backedUpChapters = chapters.filter((ch) => backupEnabled[ch.id]);
      const chapterHtml: Record<number, string> = {};
      const allMatches: DomMatch[] = [];
      for (const ch of backedUpChapters) {
        const res: any = await actor.getDeviceManualChapterContent(ch.id);
        const html: string = res && res.length ? res[0] : "";
        chapterHtml[ch.id] = html;
        for (const m of findOccurrencesInHtml(html, v.currentValue)) {
          allMatches.push({ chapterId: ch.id, chapterTitle: ch.title, index: m.index, contextSnippet: m.contextSnippet });
        }
      }

      if (allMatches.length === 0) {
        alert(`Nie znaleziono „${v.currentValue}” w rozdziałach z aktywnym backupem — sprawdź zakładkę „Backup rozdziałów”.`);
        processQueue(queueRest);
      } else if (allMatches.length === 1) {
        const m = allMatches[0];
        const newHtml = replaceOccurrencesInHtml(chapterHtml[m.chapterId], v.currentValue, newValue, [m.index]);
        await actor.applyManualVariableReplaceContents(deviceId, v.key, newValue, [[m.chapterId, newHtml]]);
        await syncChangedChaptersToDrive([[m.chapterId, newHtml]]);
        setDrafts((d) => ({ ...d, [v.key]: "" }));
        setSelected((s) => { const n = new Set(s); n.delete(v.key); return n; });
        await reloadVars();
        onChapterContentUpdated(m.chapterId, newHtml);
        processQueue(queueRest);
      } else {
        setConflict({ key: v.key, searchText: v.currentValue, newValue, matches: allMatches, picked: new Set(allMatches.map((_, i) => i)), chapterHtml, queueRest });
      }
    } finally {
      setBusy("");
    }
  };

  const insertSelected = () => {
    const items = vars.filter((v) => selected.has(v.key) && v.currentValue && (drafts[v.key] ?? ""));
    processQueue(items);
  };

  const confirmConflict = async () => {
    if (!conflict) return;
    const picked = conflict.matches.filter((_, i) => conflict.picked.has(i));
    setBusy(conflict.key);
    try {
      if (dirty) { await actor.setDeviceManualVariables(deviceId, vars); setDirty(false); }
      if (picked.length > 0) {
        const byChapter: Record<number, number[]> = {};
        for (const m of picked) { (byChapter[m.chapterId] ??= []).push(m.index); };
        const updatedChapters: [number, string][] = Object.entries(byChapter).map(([chapterIdStr, indices]) => {
          const chapterId = Number(chapterIdStr);
          const newHtml = replaceOccurrencesInHtml(conflict.chapterHtml[chapterId], conflict.searchText, conflict.newValue, indices);
          return [chapterId, newHtml];
        });
        await actor.applyManualVariableReplaceContents(deviceId, conflict.key, conflict.newValue, updatedChapters);
        await syncChangedChaptersToDrive(updatedChapters);
        setDrafts((d) => ({ ...d, [conflict.key]: "" }));
        setSelected((s) => { const n = new Set(s); n.delete(conflict.key); return n; });
        await reloadVars();
        for (const [chapterId, newHtml] of updatedChapters) onChapterContentUpdated(chapterId, newHtml);
      }
      const rest = conflict.queueRest;
      setConflict(null);
      processQueue(rest);
    } finally {
      setBusy("");
    }
  };

  const toggleBackup = async (ch: Chapter, enabled: boolean) => {
    await actor.setChapterBackupEnabled(ch.id, enabled);
    setBackupEnabled((m) => ({ ...m, [ch.id]: enabled }));
  };
  const saveBackup = async (ch: Chapter) => {
    setBusy(`backup-${ch.id}`);
    try {
      // Backup ma odzwierciedlać to co NAPRAWDĘ jest w dokumencie — a to żyje
      // w OneDrive (edytor tam zapisuje), nie w backendzie. Pobranie z backendu
      // dawałoby starą treść, jeśli backend nie był ostatnio aktualizowany.
      let full = "";
      try {
        full = await loadChapterContentFromDrive(deviceLabel, ch.id);
      } catch { /* Drive niedostępny - fallback niżej */ }
      if (!full) {
        const res: any = await actor.getDeviceManualChapterContent(ch.id);
        full = res && res.length ? res[0] : ch.contentHtml;
      }
      await actor.saveChapterBackup(ch.id, full);
      await reloadBackupLengths();
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={{ position: "fixed", left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: 350 }} className="pointer-events-none">
      <div
        className="bg-[var(--bg-card)] rounded-lg shadow-2xl border border-[var(--border-color)] flex flex-col overflow-hidden w-full h-full pointer-events-auto"
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] select-none cursor-move"
          onMouseDown={onDragStart}
        >
          <h2 className="text-sm font-bold text-[#4fc3f7]">🔗 Zmienne referencyjne dokumentu</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setTab("vars")} className={"text-xs px-3 py-1.5 rounded border " + (tab === "vars" ? "bg-cyan-600 text-white border-cyan-600" : "border-[#666] text-[var(--text-secondary)]")}>Referencje</button>
            <button onClick={() => setTab("backup")} className={"text-xs px-3 py-1.5 rounded border " + (tab === "backup" ? "bg-cyan-600 text-white border-cyan-600" : "border-[#666] text-[var(--text-secondary)]")}>Backup rozdziałów</button>
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-[#666] text-[var(--text-secondary)]">Zamknij</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {tab === "vars" ? (
            <>
              <div className="mb-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-cyan-600 dark:text-cyan-400 mb-1">ⓘ Jak to działa</p>
                <p className="mb-1">
                  To narzędzie nie jest częścią dokumentu — nie jest drukowane ani widoczne w podglądzie/eksporcie.
                  W kolumnie <b>Aktualna wartość</b> wpisz tekst dokładnie tak, jak wygląda teraz w dokumencie
                  (wielkość liter nieistotna, reszta musi się zgadzać). W <b>Nowa wartość</b> wpisz, na co ma zostać podmieniony.
                </p>
                <p className="mb-1">
                  Kliknij <b>Wstaw</b> przy wierszu albo zaznacz kilka i <b>Wstaw zaznaczone</b>. Jeśli tekst wystąpi więcej niż raz,
                  pojawi się lista wystąpień do ręcznego wyboru, które podmienić.
                </p>
                <p className="text-cyan-700 dark:text-cyan-300 font-medium">
                  ⚡ Po udanej podmianie „Nowa wartość” automatycznie wskakuje do kolumny „Aktualna wartość” i staje się nowym punktem
                  odniesienia — kolejna podmiana tej samej zmiennej działa już na niej, bez przepisywania.
                </p>
                <p className="mt-1">
                  Wyszukiwanie działa tylko na rozdziałach z włączonym backupem (zakładka „Backup” obok) — reszta nie zostanie sprawdzona.
                  Edycje etykiet/wartości zapisz osobno przyciskiem „💾 Zapisz listę”.
                </p>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={saveList} disabled={!dirty || busy === "save-list"} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white">
                  {busy === "save-list" ? "Zapisywanie…" : "💾 Zapisz listę"}
                </button>
                <button onClick={insertSelected} disabled={selected.size === 0} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white">
                  Wstaw zaznaczone ({selected.size})
                </button>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-2">Etykieta</th>
                    <th className="py-2 pr-2">Aktualna wartość</th>
                    <th className="py-2 pr-2">Nowa wartość</th>
                    <th className="py-2 pr-2 w-24">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {vars.map((v) => (
                    <tr key={v.key} className="border-b border-[var(--border-color)]">
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" checked={selected.has(v.key)} onChange={(e) => toggleSelected(v.key, e.target.checked)} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input value={v.fieldLabel} onChange={(e) => updateLabel(v.key, e.target.value)} className="w-full bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-2 py-1" />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input value={v.currentValue} onChange={(e) => updateCurrent(v.key, e.target.value)} className="w-full bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-2 py-1" />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={drafts[v.key] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [v.key]: e.target.value }))}
                          placeholder="nowa wartość…"
                          className="w-full bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-2 py-1"
                        />
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <button
                          onClick={() => doInsert(v)}
                          disabled={busy === v.key || !v.currentValue || !(drafts[v.key] ?? "")}
                          className="text-[11px] px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white mr-1"
                        >
                          {busy === v.key ? "…" : "Wstaw"}
                        </button>
                        <button onClick={() => removeRow(v.key)} className="text-[11px] px-2 py-1 rounded border border-red-500 text-red-400">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={addRow} className="mt-3 text-xs px-3 py-1.5 rounded border border-[#ccc]">+ Dodaj pole</button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">
                Wyszukiwanie zmiennych działa tylko na rozdziałach z aktywną kopią backend. OneDrive pozostaje wersją ostateczną — backup nadpisuje jedną wersję, bez historii.
              </p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                    <th className="py-2 pr-2">Rozdział</th>
                    <th className="py-2 pr-2 w-28">Backup</th>
                    <th className="py-2 pr-2 w-24">Długość</th>
                    <th className="py-2 pr-2 w-40">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {chapters.map((ch) => (
                    <tr key={ch.id} className="border-b border-[var(--border-color)]">
                      <td className="py-1.5 pr-2">{ch.title}</td>
                      <td className="py-1.5 pr-2">
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={!!backupEnabled[ch.id]} onChange={(e) => toggleBackup(ch, e.target.checked)} />
                          {backupEnabled[ch.id] && <span className="text-green-400">✓</span>}
                        </label>
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--text-muted)]">
                        {backupLengths[ch.id] !== undefined ? `${backupLengths[ch.id]} zn.` : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <button
                          onClick={() => saveBackup(ch)}
                          disabled={!backupEnabled[ch.id] || busy === `backup-${ch.id}`}
                          className="text-[11px] px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white"
                        >
                          {busy === `backup-${ch.id}` ? "…" : "Zapisz kopię backend"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div
          onMouseDown={onResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ background: "linear-gradient(135deg, transparent 50%, #666 50%)" }}
        />
      </div>

      {conflict && (
        <div className="fixed inset-0 z-[400] bg-black/60 flex items-center justify-center" onClick={() => setConflict(null)}>
          <div className="bg-[var(--bg-card)] rounded-lg shadow-2xl border border-[var(--border-color)] w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-[var(--border-color)]">
              <h3 className="text-sm font-bold text-amber-400">Znaleziono {conflict.matches.length} wystąpień „{conflict.searchText}” — wybierz które podmienić</h3>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {conflict.matches.map((m, i) => (
                <label key={i} className="flex items-start gap-2 text-xs border border-[var(--border-color)] rounded px-2 py-2">
                  <input
                    type="checkbox"
                    checked={conflict.picked.has(i)}
                    onChange={(e) => {
                      setConflict((c) => {
                        if (!c) return c;
                        const picked = new Set(c.picked);
                        if (e.target.checked) picked.add(i); else picked.delete(i);
                        return { ...c, picked };
                      });
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-[#4fc3f7] font-semibold">{m.chapterTitle}</span>
                    <br />
                    <span className="text-[var(--text-muted)]">…{m.contextSnippet}…</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
              <button onClick={() => setConflict(null)} className="text-xs px-3 py-1.5 rounded border border-[#ccc]">Anuluj</button>
              <button onClick={confirmConflict} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white">Podmień zaznaczone</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
