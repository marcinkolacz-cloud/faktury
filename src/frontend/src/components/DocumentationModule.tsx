import { useEffect, useRef, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { setDriveActor } from "../lib/oneDriveConfig";
import { syncChapterToDrive, uploadChapterImage } from "../lib/documentationDriveSync";

// SECURITY / DESIGN NOTE: the Agent AI chat (FloatingAgentChat.tsx) is
// intentionally never given any tool referencing device manual/documentation
// functions (listDeviceManualChapters / update* / reorder* / delete*).
// There is no code path by which the chat can read or modify anything in
// this module — the only way content changes here is a human typing in
// this editor. Keep it that way: never add a documentation-related tool
// to FloatingAgentChat's TOOLS array.

type Chapter = { id: number; title: string; contentHtml: string; order: number };

// Numbering is intentionally NOT CSS counter()-based here anymore. CSS
// counter-reset/counter-increment only cascades reliably across perfectly
// flat sibling headings, and contentEditable output from the browser
// isn't always perfectly flat (Enter/formatBlock edge cases can nest
// things unexpectedly), which caused numbers to drift (e.g. showing
// "2.4" instead of "2.1"). applyLiveHeadingNumbers() below computes the
// same numbering as the proven-correct Word export (numberHeadingsForExport)
// via querySelectorAll, which is immune to nesting depth, and writes it
// into a data-num attribute that this CSS just displays verbatim.
const COUNTER_CSS = `
#doc-editor-content { font-family: Calibri, "Segoe UI", Arial, sans-serif; }
#doc-editor-content p, #doc-editor-content div, #doc-editor-content li { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #000; font-weight: bold; font-size: 10pt; }
#doc-editor-content ul { list-style: disc outside; padding-left: 24px; margin: 8px 0; }
#doc-editor-content ol { list-style: decimal outside; padding-left: 24px; margin: 8px 0; }
#doc-editor-content li { list-style: inherit; display: list-item; }
#doc-editor-content h1 { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 14pt; color: #000; font-weight: bold; margin: 18px 0 10px; }
#doc-editor-content h1::before { content: attr(data-num); }
#doc-editor-content h2 { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 12pt; color: #000; font-weight: bold; margin: 14px 0 8px; }
#doc-editor-content h2::before { content: attr(data-num); }
#doc-editor-content h3 { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #000; font-weight: bold; margin: 10px 0 6px; }
#doc-editor-content h3::before { content: attr(data-num); }
#doc-editor-content img { max-width: 100%; height: auto; }
#doc-editor-content .manual-page-break { border-top: 2px dashed #4fc3f7; text-align: center; color: #4fc3f7; font-size: 10px; margin: 16px 0; user-select: none; }
#doc-editor-content .manual-page-break::before { content: attr(data-label); }
#doc-editor-content table, #doc-editor-content td, #doc-editor-content th { border-color: var(--text-secondary) !important; }
#doc-editor-content td[style*="background:#eee"], #doc-editor-content th[style*="background:#eee"] { background: var(--bg-hover) !important; }
#doc-editor-content table td, #doc-editor-content table th { resize: both; overflow: hidden; }
#doc-editor-content .doc-comment-anchor { background: #fff3b0; border-bottom: 2px solid #e6b800; cursor: pointer; }
#doc-editor-content .doc-comment-anchor.doc-comment-active { background: #ffe066; }
`;
// Repair pre-existing table cells saved before the border-shorthand bug
// was fixed (see numberHeadingsForExport below for the full explanation):
// a border-width with no border-style renders no border at all.
function repairTableBorders(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
    if (cell.style.borderWidth && !cell.style.borderStyle) {
      cell.style.borderStyle = "solid";
    }
  });
}

function applyLiveHeadingNumbers(container: HTMLElement, h1Start: number) {
  let h1 = h1Start;
  let h2 = 0;
  let h3 = 0;
  container.querySelectorAll("h1, h2, h3").forEach((el) => {
    if (el.tagName === "H1") {
      h1 += 1; h2 = 0; h3 = 0;
      el.setAttribute("data-num", `${h1}. `);
    } else if (el.tagName === "H2") {
      h2 += 1; h3 = 0;
      el.setAttribute("data-num", `${h1}.${h2}. `);
    } else {
      h3 += 1;
      el.setAttribute("data-num", `${h1}.${h2}.${h3}. `);
    }
  });
}

function countTag(html: string, tag: string): number {
  return new DOMParser().parseFromString(html, "text/html").querySelectorAll(tag).length;
}

function h1OffsetBefore(chapters: Chapter[], activeIndex: number): number {
  let offset = 0;
  for (let i = 0; i < activeIndex; i++) offset += countTag(chapters[i].contentHtml, "h1");
  return offset;
}

// Injects literal numbers into h1/h2/h3 (Word's HTML import doesn't reliably
// render live CSS counters the way browsers do), continuing the count
// across chapter boundaries — mirrors the live on-screen numbering exactly.
function numberHeadingsForExport(chapters: Chapter[], includeIds?: Set<number>): { html: string }[] {
  let h1 = 0;
  let h2 = 0;
  let h3 = 0;
  const result: { html: string }[] = [];
  chapters.forEach((ch) => {
    const doc = new DOMParser().parseFromString(ch.contentHtml, "text/html");
    repairTableBorders(doc.body);
    doc.body.querySelectorAll("h1, h2, h3").forEach((el) => {
      if (el.tagName === "H1") {
        h1 += 1; h2 = 0; h3 = 0;
        el.innerHTML = `${h1}.\u00A0${el.innerHTML}`;
      } else if (el.tagName === "H2") {
        h2 += 1; h3 = 0;
        el.innerHTML = `${h1}.${h2}.\u00A0${el.innerHTML}`;
      } else {
        h3 += 1;
        el.innerHTML = `${h1}.${h2}.${h3}.\u00A0${el.innerHTML}`;
      }
    });
    // Number every chapter so ordinals stay correct even when some
    // chapters are unchecked for print — only OMIT the unchecked ones
    // from the output, never renumber as if they didn't exist.
    if (!includeIds || includeIds.has(ch.id)) {
      result.push({ html: doc.body.innerHTML });
    }
  });
  return result;
}

const PAGE_BREAK_CLASS = "manual-page-break";

// Walks a chapter's DOM (already heading-numbered) and produces docx
// elements. Deliberately supports only what the editor's toolbar can
// actually produce (h1/h2/h3/p/ul-li/b/i/img + our manual page-break
// marker) — this stays reliable rather than attempting to handle
// arbitrary pasted HTML.
function buildTocHtml(chapters: Chapter[], includeIds?: Set<number>): string {
  const rows: string[] = [];
  let h1 = 0, h2 = 0, h3 = 0;
  for (const ch of chapters) {
    const doc = new DOMParser().parseFromString(ch.contentHtml, "text/html");
    const include = !includeIds || includeIds.has(ch.id);
    doc.body.querySelectorAll("h1, h2, h3").forEach((el, idx) => {
      const anchor = `toc_${rows.length}_${idx}`;
      el.setAttribute("id", anchor);
      if (el.tagName === "H1") { h1 += 1; h2 = 0; h3 = 0; if (include) rows.push(`<p style="margin:2px 0;font-weight:bold;"><a href="#${anchor}">${h1}. ${el.textContent}</a></p>`); }
      else if (el.tagName === "H2") { h2 += 1; h3 = 0; if (include) rows.push(`<p style="margin:2px 0 2px 18px;"><a href="#${anchor}">${h1}.${h2}. ${el.textContent}</a></p>`); }
      else { h3 += 1; if (include) rows.push(`<p style="margin:2px 0 2px 36px;"><a href="#${anchor}">${h1}.${h2}.${h3}. ${el.textContent}</a></p>`); }
    });
  }
  return `<h1>Spis treści</h1>${rows.join("\n")}`;
}

type HeaderFooterSettings = {
  headerText: string;
  footerText: string;
  logoDataUri: string;
  skipFirstPage: boolean;
  showPageNumbers: boolean;
};

const DEFAULT_HF_SETTINGS: HeaderFooterSettings = {
  headerText: "",
  footerText: "Bartolini Air Simulation",
  logoDataUri: "",
  skipFirstPage: true,
  showPageNumbers: true,
};

async function fetchLogoDataUri(): Promise<string | null> {
  try {
    const resp = await fetch("/bartolini-logo.png");
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Word's own HTML importer handles arbitrary inline CSS (colors,
// backgrounds, padding, borders...) far better than any hand-written
// converter ever will — a custom DOM→docx-library mapper is a permanent
// game of whack-a-mole against whatever styling a document happens to use.
// This keeps chapter content as raw HTML (Word renders it directly) and
// only builds the header/footer/TOC scaffolding around it.
//
// If the header/footer only appears on the first page after opening: open
// the View tab in Word and switch to "Print Layout" — Word sometimes opens
// HTML-saved documents in Web Layout, which doesn't paginate at all, so
// repeating headers/footers only appear to show up once. They're stored
// correctly either way; Print Layout is just what actually shows them.
async function buildWordExportHtml(deviceLabel: string, chapters: Chapter[], settings: HeaderFooterSettings, includeIds?: Set<number>): Promise<string> {
  const numbered = numberHeadingsForExport(chapters, includeIds);
  const toc = buildTocHtml(chapters, includeIds);
  // Word's HTML-to-doc importer doesn't reliably honor generic CSS
  // page-break-before on a <div> (that only works in real browsers, e.g.
  // exportPdf/print preview) — the only trick Word's importer reliably
  // respects is a <br> with mso-special-character:line-break plus
  // page-break-before:always. So any manual page-break markers the user
  // inserted mid-chapter must be swapped for that exact marker here, with
  // the (empty, unstyled) div itself removed entirely.
  const msoBreak = '<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>';
  const manualBreakRe = new RegExp('<div class="' + PAGE_BREAK_CLASS + '"[^>]*></div>', 'g');
  const body = numbered.map((n) => `${n.html.replace(manualBreakRe, msoBreak)}${msoBreak}`).join("\n");

  const logo = settings.logoDataUri || (await fetchLogoDataUri());
  const logoImg = logo ? `<img src="${logo}" height="24" style="vertical-align:middle;margin-right:8px;"/>` : "";
  const headerText = settings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`;
  const footerText = settings.footerText.trim() || "Bartolini Air Simulation";
  const pageNumbers = settings.showPageNumbers
    ? ` — Strona <span style="mso-field-code:' PAGE '"> </span> z <span style="mso-field-code:' NUMPAGES '"> </span>`
    : "";

  const headerFooterHtml = `
<div style="mso-element:header;" id="h1">
  <p style="margin:0;border-bottom:1px solid #ccc;padding-bottom:4px;font-size:9pt;color:#555;">${logoImg}${headerText}</p>
</div>
<div style="mso-element:footer;" id="f1">
  <p style="margin:0;border-top:1px solid #ccc;padding-top:4px;font-size:9pt;color:#555;text-align:center;">${footerText}${pageNumbers}</p>
</div>`;

  const titlePageHtml = `<h1 style="text-align:center;">Instrukcja obsługi — ${deviceLabel}</h1>`;

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name=ProgId content=Word.Document/>
<meta name=Generator content="Microsoft Word 15"/>
<!--[if gte mso 9]><xml>
 <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
</xml><![endif]-->
<style>
  @page Section1 {
    size: 21cm 29.7cm;
    mso-page-orientation: portrait;
    margin: 3.75cm 1.27cm 1.27cm 1.27cm;
    mso-header-margin: 1.27cm;
    mso-footer-margin: 1.27cm;
    mso-header: h1;
    mso-footer: f1;
    mso-page-numbers: 1;
  }
  div.Section1 { page: Section1; }
  body { font-family: Calibri, Arial, sans-serif; }
  h1 { color: #1a1a8c; font-size: 18pt; }
  h2 { font-size: 14pt; }
  h3 { font-size: 12pt; }
</style>
</head>
<body>
${settings.skipFirstPage ? `
${titlePageHtml}
<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>
${headerFooterHtml}
<div class="Section1">
${toc}
<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>
${body}
</div>` : `
${headerFooterHtml}
<div class="Section1">
${titlePageHtml}
<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>
${toc}
<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>
${body}
</div>`}
</body></html>`;
}

export function DocumentationModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [dirty, setDirty] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [autoSave, setAutoSave] = useState(true);
  const [hfSettings, setHfSettings] = useState<HeaderFooterSettings>(DEFAULT_HF_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [hfDraft, setHfDraft] = useState<HeaderFooterSettings>(DEFAULT_HF_SETTINGS);
  const hfLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [driveSyncFlash, setDriveSyncFlash] = useState(false);
  const [driveSyncError, setDriveSyncError] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [lockBusyMsg, setLockBusyMsg] = useState("");
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableDraft, setTableDraft] = useState({ rows: 3, cols: 3, headerRow: false, colWidthCm: "", rowHeightCm: "" });
  const A4_USABLE_WIDTH_CM = 18.46; // 21cm - 1.27cm marginesy z każdej strony
  const tableInsertRangeRef = useRef<Range | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  // Which chapters are checked for "podgląd wydruku"/export. Defaults to
  // all-selected so behavior matches the previous always-everything
  // export; only truly NEW chapter ids get auto-added as selected, so a
  // user's manual unchecks survive the background 5s poll (which
  // recreates the chapters array with new object identities every tick).
  const [selectedForPrint, setSelectedForPrint] = useState<Set<number>>(new Set());
  const knownChapterIdsRef = useRef<Set<number>>(new Set());
  const chapterIdsKey = chapters.map((c) => c.id).sort((a, b) => a - b).join(",");
  useEffect(() => {
    const currentIds = new Set(chapters.map((c) => c.id));
    setSelectedForPrint((prev) => {
      const next = new Set(prev);
      for (const id of Array.from(next)) { if (!currentIds.has(id)) next.delete(id); }
      for (const id of currentIds) { if (!knownChapterIdsRef.current.has(id)) next.add(id); }
      return next;
    });
    knownChapterIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdsKey]);
  const toggleSelectedForPrint = (id: number) => {
    setSelectedForPrint((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [previewPos, setPreviewPos] = useState({ x: 80, y: 60 });
  const previewDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onPreviewDragStart = (e: React.MouseEvent) => {
    previewDragRef.current = { startX: e.clientX, startY: e.clientY, origX: previewPos.x, origY: previewPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!previewDragRef.current) return;
      const { startX, startY, origX, origY } = previewDragRef.current;
      setPreviewPos({ x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) });
    };
    const onUp = () => {
      previewDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useAuthContext();
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [pollTicks, setPollTicks] = useState(0);
  const [pollError, setPollError] = useState<string>("");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [selectedTableEl, setSelectedTableEl] = useState<HTMLTableElement | null>(null);
  const [tableModalMode, setTableModalMode] = useState<"insert" | "resize">("insert");
  const commentAreaRef = useRef<HTMLDivElement>(null);
  const commentAnchorElRef = useRef<HTMLElement | null>(null);
  const [commentPopup, setCommentPopup] = useState<{ top: number; left: number; lineWidth: number; draft: string } | null>(null);
  const [imgToolbarPos, setImgToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [handlePos, setHandlePos] = useState<{ top: number; left: number } | null>(null);
  const resizingRef = useRef<{ startX: number; startWidth: number; aspect: number } | null>(null);
  const draggedImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!actor) return;
    setDriveActor(actor);
    actor.listDevices().then((rows: any[]) => {
      setDevices(rows);
      if (rows.length && deviceId === null) setDeviceId(Number(rows[0].id));
    });
    actor.amIDocumentationEditor().then(setCanEdit).catch(() => setCanEdit(false));
    actor.listPrincipalDisplayNames().then((rows: any[]) => {
      const map: Record<string, string> = {};
      for (const [p, name] of rows) { map[p.toText()] = name; }
      setDisplayNames(map);
    }).catch(() => { /* not critical — falls back to raw principal text */ });
    actor.getDocHeaderFooterSettings().then((res: any) => {
      const s = res && res.length > 0 ? res[0] : null;
      if (s) {
        const loaded: HeaderFooterSettings = {
          headerText: s.headerText,
          footerText: s.footerText,
          logoDataUri: s.logoDataUri,
          skipFirstPage: s.skipFirstPage,
          showPageNumbers: s.showPageNumbers,
        };
        setHfSettings(loaded);
      }
    }).catch(() => { /* fall back to defaults */ });
  }, [actor]);

  const reload = async () => {
    if (deviceId === null) return;
    setLoading(true);
    const rows = await actor.listDeviceManualChapters(deviceId);
    const mapped: Chapter[] = rows.map((r: any) => ({ id: Number(r.id), title: r.title, contentHtml: r.contentHtml, order: Number(r.order) }));
    setChapters(mapped);
    setActiveId((prev) => (mapped.find((c) => c.id === prev) ? prev : mapped.length ? mapped[0].id : null));
    setLoading(false);
  };

  // Silent variant used by the background poll: fetches the same data but
  // never touches `loading`, so it doesn't flash/hide the currently
  // rendered content the way the initial reload() does.
  const silentReload = async () => {
    setPollTicks((n) => n + 1);
    if (deviceId === null) return;
    try {
      const rows = await actor.listDeviceManualChapters(deviceId);
      const mapped: Chapter[] = rows.map((r: any) => ({ id: Number(r.id), title: r.title, contentHtml: r.contentHtml, order: Number(r.order) }));
      setChapters(mapped);
      setActiveId((prev) => (mapped.find((c) => c.id === prev) ? prev : mapped.length ? mapped[0].id : null));
      setLastPolled(new Date());
      setPollError("");
    } catch (e: any) {
      setPollError(String(e?.message || e));
    }
    if (activeId !== null && !editMode) {
      try {
        const lock = await actor.getEditLock(activeId);
        setLockedBy(lock && lock.length > 0 ? lock[0].toText() : null);
      } catch { /* non-critical */ }
    }
  };
  useEffect(() => { reload(); }, [actor, deviceId]);
  // Poll for changes made by other staff members so they show up without
  // requiring a manual F5. Cheap: listDeviceManualChapters is a query call
  // (no consensus round, no HTTP outcalls). Skipped while actively editing
  // so it never clobbers unsaved local edits in the editor.
  useEffect(() => {
    if (deviceId === null) return;
    const interval = setInterval(() => {
      if (editMode) return;
      silentReload();
    }, 5000);
    return () => clearInterval(interval);
  }, [actor, deviceId, editMode]);

  const tryEnterEditMode = async () => {
    if (activeId === null) return;
    setLockBusyMsg("");
    try {
      const got = await actor.acquireEditLock(activeId);
      if (got) {
        setLockedBy(null);
        setEditMode(true);
      } else {
        const lock = await actor.getEditLock(activeId);
        const holderText = lock && lock.length > 0 ? lock[0].toText() : "";
        const holderName = displayNames[holderText] || holderText;
        setLockedBy(holderText || null);
        setLockBusyMsg("Ten rozdzial jest wlasnie edytowany przez: " + (holderName || "innego uzytkownika"));
      }
    } catch (e) {
      setLockBusyMsg("Nie udalo sie sprawdzic blokady edycji: " + String((e as any)?.message || e));
    }
  };
  const exitEditMode = () => {
    setEditMode(false);
    if (activeId !== null) {
      actor.releaseEditLock(activeId).catch(() => {});
    }
  };
  useEffect(() => {
    if (!editMode || activeId === null) return;
    const interval = setInterval(() => {
      actor.heartbeatEditLock(activeId).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [actor, activeId, editMode]);
  useEffect(() => {
    return () => {
      if (editMode && activeId !== null) {
        actor.releaseEditLock(activeId).catch(() => {});
      }
    };
  }, [activeId, deviceId]);
  const activeIndex = chapters.findIndex((c) => c.id === activeId);
  const active = activeIndex >= 0 ? chapters[activeIndex] : null;
  const selectedDevice = devices.find((d) => Number(d.id) === deviceId);
  const deviceLabel = selectedDevice ? `${selectedDevice.symbol} — ${selectedDevice.name}` : "";
  const h1Offset = activeIndex >= 0 ? h1OffsetBefore(chapters, activeIndex) : 0;

  useEffect(() => {
    setEditMode(false);
    setDirty(false);
    setSelectedImg(null);
    setImgToolbarPos(null);
    setHandlePos(null);
    if (editorRef.current) {
      editorRef.current.innerHTML = active?.contentHtml || "<p></p>";
      repairTableBorders(editorRef.current);
      applyLiveHeadingNumbers(editorRef.current, h1Offset);
    }
  }, [activeId]);
  // Keep the read-only view in sync with background poll updates (e.g. a
  // coworker saved the chapter while we're just looking at it, not
  // editing). Intentionally scoped to !editMode: while actively editing,
  // the lock guarantees nobody else can be writing, and we must never
  // overwrite the user's own in-progress unsaved keystrokes.
  useEffect(() => {
    if (editMode) return;
    if (editorRef.current) {
      editorRef.current.innerHTML = active?.contentHtml || "<p></p>";
      repairTableBorders(editorRef.current);
      applyLiveHeadingNumbers(editorRef.current, h1Offset);
    }
  }, [active?.contentHtml, editMode]);

  const addChapter = async () => {
    const title = newTitle.trim();
    if (!title || deviceId === null) return;
    const newId = await actor.createDeviceManualChapter(deviceId, title);
    setNewTitle("");
    await reload();
    setActiveId(Number(newId));
  };

  const requestDelete = (ch: Chapter) => {
    setDeleteTarget(ch);
    setDeleteConfirmText("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteConfirmText !== "DELETE") return;
    await actor.trashDeviceManualChapter(deleteTarget.id);
    setDeleteTarget(null);
    reload();
  };

  const startRename = (ch: Chapter) => {
    setRenamingId(ch.id);
    setRenameValue(ch.title);
  };

  const confirmRename = async (ch: Chapter) => {
    const title = renameValue.trim() || ch.title;
    setRenamingId(null);
    await actor.updateDeviceManualChapter(ch.id, title, ch.contentHtml, "");
    reload();
    try {
      await syncChapterToDrive(deviceLabel, ch.id, ch.order, title, ch.contentHtml);
    } catch { /* best-effort — the rename itself already succeeded */ }
  };

  const downloadChapter = (ch: Chapter) => {
    const html = `<html><head><meta charset="utf-8"><title>${ch.title}</title></head><body>${ch.contentHtml}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ch.title.replace(/[^\w\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDrop = async (targetId: number) => {
    if (dragId === null || dragId === targetId) { setDragId(null); return; }
    const ids = chapters.map((c) => c.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    setDragId(null);
    setChapters((prev) => ids.map((id) => prev.find((c) => c.id === id)!).map((c, i) => ({ ...c, order: i })));
    if (deviceId !== null) await actor.reorderDeviceManualChapters(deviceId, ids);
  };

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    setDirty(true);
  };

  // Sekcja = h4, celowo POZA numberHeadingsForExport/applyLiveHeadingNumbers
  // (liczą tylko h1/h2/h3) — nienumerowana etykieta pisana ręcznie,
  // wizualnie nad Rozdziałem. Styl inline (nie w COUNTER_CSS), żeby
  // przetrwał identycznie w edytorze, podglądzie, PDF i Word.
  const SECTION_STYLE = "display:block;font-family:Calibri, 'Segoe UI', Arial, sans-serif;font-size:20pt;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#000;border-bottom:3px solid #1a1a8c;margin:32px 0 16px;padding-bottom:6px;";
  const applySectionStyle = () => {
    document.execCommand("formatBlock", false, "<h4>");
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const el = (node instanceof Element ? node : node?.parentElement)?.closest("h4") as HTMLElement | null;
    if (el) el.setAttribute("style", SECTION_STYLE);
    editorRef.current?.focus();
    setDirty(true);
  };

  // Enable the browser's own corner-drag resize handles for images inside
  // the editable region — without this, <img> tags inserted via
  // execCommand("insertImage", ...) have no way to be resized at all.
  useEffect(() => {
    if (editMode) {
      try { document.execCommand("enableObjectResizing", false, "true" as any); } catch { /* unsupported in this browser, ignore */ }
    }
  }, [editMode]);

  const syncOverlayPositions = (img: HTMLImageElement) => {
    const editorRect = editorRef.current!.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    setImgToolbarPos({ top: imgRect.top - editorRect.top - 36, left: imgRect.left - editorRect.left });
    setHandlePos({ top: imgRect.bottom - editorRect.top - 8, left: imgRect.right - editorRect.left - 8 });
  };

  const syncCommentPopupPos = (anchorEl: HTMLElement) => {
    const container = commentAreaRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const top = anchorRect.top - containerRect.top + container.scrollTop;
    const left = anchorRect.right - containerRect.left;
    const popupWidth = 260;
    const lineWidth = Math.max(container.clientWidth - popupWidth - 24 - left, 20);
    setCommentPopup((p) => (p ? { ...p, top, left, lineWidth } : p));
  };

  const onEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      setSelectedImg(img);
      syncOverlayPositions(img);
    } else {
      setSelectedImg(null);
      setImgToolbarPos(null);
      setHandlePos(null);
    }
    setSelectedTableEl(target.closest("table") as HTMLTableElement | null);
    const commentEl = target.closest(".doc-comment-anchor") as HTMLElement | null;
    if (commentEl && editorRef.current?.contains(commentEl)) {
      commentAnchorElRef.current = commentEl;
      const draft = commentEl.getAttribute("data-comment-text") || "";
      setCommentPopup({ top: 0, left: 0, lineWidth: 0, draft });
      requestAnimationFrame(() => syncCommentPopupPos(commentEl));
    } else {
      commentAnchorElRef.current = null;
      setCommentPopup(null);
    }
  };

  const addComment = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      alert("Zaznacz fragment tekstu, żeby dodać komentarz.");
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editorRef.current?.contains(range.commonAncestorContainer)) return;
    const span = document.createElement("span");
    span.className = "doc-comment-anchor";
    span.setAttribute("data-comment-id", `c${Date.now()}`);
    span.setAttribute("data-comment-text", "");
    try {
      range.surroundContents(span);
    } catch {
      // Zaznaczenie przecina granicę elementów (np. pogrubienie w środku)
      // — surroundContents wymaga jednego spójnego węzła, więc wycinamy
      // zawartość i owijamy ją ręcznie.
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    commentAnchorElRef.current = span;
    setCommentPopup({ top: 0, left: 0, lineWidth: 0, draft: "" });
    requestAnimationFrame(() => syncCommentPopupPos(span));
    setDirty(true);
  };

  const saveCommentDraft = (text: string) => {
    if (!commentAnchorElRef.current) return;
    commentAnchorElRef.current.setAttribute("data-comment-text", text);
    setDirty(true);
  };

  const deleteComment = () => {
    const anchor = commentAnchorElRef.current;
    if (!anchor) return;
    const parent = anchor.parentNode;
    while (anchor.firstChild) parent?.insertBefore(anchor.firstChild, anchor);
    anchor.remove();
    commentAnchorElRef.current = null;
    setCommentPopup(null);
    setDirty(true);
  };

  useEffect(() => {
    editorRef.current?.querySelectorAll(".doc-comment-anchor.doc-comment-active").forEach((el) => el.classList.remove("doc-comment-active"));
    if (commentPopup && commentAnchorElRef.current) commentAnchorElRef.current.classList.add("doc-comment-active");
  }, [commentPopup]);

  // Images are draggable by default in browsers, but relying on the
  // browser's own internal contenteditable drag-and-drop to relocate them
  // is inconsistent across Chrome/Firefox/Edge. Handling it ourselves —
  // remember which <img> started the drag, then explicitly move that same
  // DOM node to wherever the cursor drops — works everywhere the same way.
  const onEditorDragStart = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      draggedImgRef.current = target as HTMLImageElement;
      e.dataTransfer.setData("text/plain", "internal-image-move");
      e.dataTransfer.effectAllowed = "move";
    }
  };

  const onEditorDragEnd = () => {
    draggedImgRef.current = null;
  };

  const alignImage = (align: "left" | "center" | "right") => {
    if (!selectedImg) return;
    selectedImg.style.display = "block";
    if (align === "left") { selectedImg.style.float = "left"; selectedImg.style.margin = "0 12px 8px 0"; }
    else if (align === "right") { selectedImg.style.float = "right"; selectedImg.style.margin = "0 0 8px 12px"; }
    else { selectedImg.style.float = "none"; selectedImg.style.margin = "8px auto"; }
    setDirty(true);
    requestAnimationFrame(() => syncOverlayPositions(selectedImg));
  };

  const resizeImage = (percent: number) => {
    if (!selectedImg) return;
    const naturalW = selectedImg.naturalWidth || 500;
    selectedImg.style.width = `${Math.round((naturalW * percent) / 100)}px`;
    selectedImg.style.height = "auto";
    setDirty(true);
    requestAnimationFrame(() => syncOverlayPositions(selectedImg));
  };

  // Real-time drag-to-resize from the corner handle — updates the image
  // width on every mousemove frame (not just on drop), so it visually
  // tracks the cursor smoothly instead of jumping between fixed steps.
  const startResizeDrag = (e: React.MouseEvent) => {
    if (!selectedImg) return;
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = selectedImg.getBoundingClientRect().width;
    const currentHeight = selectedImg.getBoundingClientRect().height || 1;
    resizingRef.current = { startX: e.clientX, startWidth: currentWidth, aspect: currentWidth / currentHeight };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current || !selectedImg) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(40, Math.round(resizingRef.current.startWidth + delta));
      selectedImg.style.width = `${newWidth}px`;
      selectedImg.style.height = "auto";
      syncOverlayPositions(selectedImg);
    };
    const onUp = () => {
      resizingRef.current = null;
      setDirty(true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const removeSelectedImage = () => {
    if (!selectedImg) return;
    selectedImg.remove();
    setSelectedImg(null);
    setImgToolbarPos(null);
    setHandlePos(null);
    setDirty(true);
  };

  const openSettings = () => {
    setHfDraft(hfSettings);
    setShowSettings(true);
  };

  const saveSettings = async () => {
    try {
      await actor.setDocHeaderFooterSettings(
        hfDraft.headerText,
        hfDraft.footerText,
        hfDraft.logoDataUri,
        hfDraft.skipFirstPage,
        hfDraft.showPageNumbers,
      );
      setHfSettings(hfDraft);
      setShowSettings(false);
    } catch (e: any) {
      alert("Błąd zapisu ustawień: " + (e?.message || String(e)));
    }
  };

  const onHfLogoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !/^image\/(jpeg|png)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => setHfDraft((d) => ({ ...d, logoDataUri: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const insertPageBreak = () => {
    if (!editMode) return;
    document.execCommand(
      "insertHTML",
      false,
      `<div class="${PAGE_BREAK_CLASS}" contenteditable="false" data-label="— Podział strony —"></div><p><br></p>`,
    );
    editorRef.current?.focus();
    setDirty(true);
  };

  // Pasted content (e.g. tables copied from Word/Excel) carries its own
  // inline background-color styles from the source app. Word/Excel
  // default table/cell backgrounds are white, which is invisible against
  // our white print-preview/export page — so on paste we strip any
  // white/near-white background so pasted tables stay visible everywhere
  // they're rendered (editor, preview, PDF, Word export).
  const sanitizePastedHtml = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const isWhiteish = (val: string) => {
      const v = val.trim().toLowerCase();
      if (!v) return false;
      if (v === "white" || v === "#fff" || v === "#ffffff") return true;
      const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return +m[1] >= 245 && +m[2] >= 245 && +m[3] >= 245;
      return false;
    };
    doc.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (el.style && el.style.backgroundColor && isWhiteish(el.style.backgroundColor)) {
        el.style.removeProperty("background-color");
        el.style.removeProperty("background");
      }
      if (el.hasAttribute("bgcolor") && isWhiteish(el.getAttribute("bgcolor") || "")) {
        el.removeAttribute("bgcolor");
      }
    });
    // Pasted tables (Word/Excel) carry their own border color/width — often
    // very light gray, invisible on a white page. Force the same plain
    // solid black border every editor-inserted table uses, so pasted
    // tables stay visible everywhere (editor, print preview, PDF, Word
    // export) regardless of the source app's styling.
    doc.body.querySelectorAll<HTMLElement>("td, th").forEach((el) => {
      el.style.borderWidth = "1px";
      el.style.borderStyle = "solid";
      el.style.borderColor = "#000";
    });
    return doc.body.innerHTML;
  };

  const onEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData("text/html");
    if (!html) return; // let default plain-text paste behave normally
    const sanitized = sanitizePastedHtml(html);
    // Same nested-table guard as the toolbar button: pasting a table while
    // the cursor sits inside an existing table cell would nest it and
    // break rendering everywhere.
    if (/<table[\s>]/i.test(sanitized)) {
      const sel0 = window.getSelection();
      const anchorEl = sel0 && sel0.anchorNode
        ? (sel0.anchorNode.nodeType === 1 ? (sel0.anchorNode as HTMLElement) : sel0.anchorNode.parentElement)
        : null;
      if (anchorEl && anchorEl.closest("table") && editorRef.current?.contains(anchorEl)) {
        e.preventDefault();
        alert("Wklejona treść zawiera tabelę, a kursor jest wewnątrz innej tabeli. Ustaw kursor poza tabelą i spróbuj ponownie.");
        return;
      }
    }
    e.preventDefault();
    document.execCommand("insertHTML", false, sanitized);
    setDirty(true);
  };

  // Plain <table><tr><td> with inline border styles (not an external
  // stylesheet class) — this way the table survives verbatim through
  // every export path (Word HTML import, print preview, PDF/print)
  // without any special mso-tricks, since inline styles always carry
  // through DOM/innerHTML round-trips unchanged.
  const TABLE_CELL_STYLE = "border-width:1px;border-style:solid;border-color:#000;padding:6px 8px;min-width:60px;vertical-align:top;";

  const insertTable = () => {
    // window.prompt() steals focus and can lose the editor selection —
    // same issue already solved for image insertion. Save the current
    // Range BEFORE the modal opens, restore it right before inserting,
    // otherwise the table can render on-screen but land outside the
    // actual editor DOM node (looks fine visually, silently vanishes on
    // save/export since it was never really part of editorRef).
    const sel0 = window.getSelection();
    // Refuse to insert a table with the cursor already inside another
    // table — execCommand insertHTML would drop it straight into that
    // cell, producing an invalid nested table that renders as a broken
    // overlapping grid everywhere (editor, preview, Word).
    const anchorEl = sel0 && sel0.anchorNode
      ? (sel0.anchorNode.nodeType === 1 ? (sel0.anchorNode as HTMLElement) : sel0.anchorNode.parentElement)
      : null;
    if (anchorEl && anchorEl.closest("table") && editorRef.current?.contains(anchorEl)) {
      alert("Nie można wstawić tabeli wewnątrz innej tabeli. Ustaw kursor poza tabelą (np. w akapicie pod nią) i spróbuj ponownie.");
      return;
    }
    tableInsertRangeRef.current = sel0 && sel0.rangeCount > 0 ? sel0.getRangeAt(0).cloneRange() : null;
    setTableModalMode("insert");
    setTableDraft({ rows: 3, cols: 3, headerRow: false, colWidthCm: "", rowHeightCm: "" });
    setShowTableModal(true);
  };

  // Opens the same modal pre-filled with the currently selected table's
  // dimensions, so rows/cols/width/height can be changed on an existing
  // table instead of only at creation time.
  const openResizeTable = () => {
    if (!selectedTableEl) return;
    const rows = selectedTableEl.rows.length;
    const cols = rows > 0 ? selectedTableEl.rows[0].cells.length : 1;
    setTableModalMode("resize");
    setTableDraft({ rows, cols, headerRow: false, colWidthCm: "", rowHeightCm: "" });
    setShowTableModal(true);
  };

  const addTableRow = () => {
    if (!selectedTableEl) return;
    const lastRow = selectedTableEl.rows[selectedTableEl.rows.length - 1];
    const cols = lastRow ? lastRow.cells.length : 1;
    const tr = document.createElement("tr");
    for (let i = 0; i < cols; i++) {
      const td = document.createElement("td");
      td.setAttribute("style", TABLE_CELL_STYLE);
      td.innerHTML = "&nbsp;";
      tr.appendChild(td);
    }
    selectedTableEl.querySelector("tbody")?.appendChild(tr) || selectedTableEl.appendChild(tr);
    setDirty(true);
  };

  const removeTableRow = () => {
    if (!selectedTableEl || selectedTableEl.rows.length <= 1) return;
    selectedTableEl.rows[selectedTableEl.rows.length - 1].remove();
    setDirty(true);
  };

  const addTableColumn = () => {
    if (!selectedTableEl) return;
    Array.from(selectedTableEl.rows).forEach((row) => {
      const td = document.createElement("td");
      td.setAttribute("style", TABLE_CELL_STYLE);
      td.innerHTML = "&nbsp;";
      row.appendChild(td);
    });
    setDirty(true);
  };

  const removeTableColumn = () => {
    if (!selectedTableEl) return;
    const rows = Array.from(selectedTableEl.rows);
    if (rows.some((r) => r.cells.length <= 1)) return;
    rows.forEach((row) => row.cells[row.cells.length - 1].remove());
    setDirty(true);
  };

  const deleteTable = () => {
    if (!selectedTableEl) return;
    selectedTableEl.remove();
    setSelectedTableEl(null);
    setDirty(true);
  };

  const confirmInsertTable = () => {
    const colWidth = parseFloat(tableDraft.colWidthCm);
    const rowHeight = parseFloat(tableDraft.rowHeightCm);
    const hasColWidth = !isNaN(colWidth) && colWidth > 0;
    const hasRowHeight = !isNaN(rowHeight) && rowHeight > 0;

    if (tableModalMode === "resize" && selectedTableEl) {
      // Adjust row/column count first, then apply width/height to every
      // cell uniformly — same behavior as at creation time, just applied
      // to an already-inserted table.
      const targetRows = Math.max(1, Math.min(30, tableDraft.rows || 1));
      const targetCols = Math.max(1, Math.min(12, tableDraft.cols || 1));
      while (selectedTableEl.rows.length < targetRows) addTableRow();
      while (selectedTableEl.rows.length > targetRows) removeTableRow();
      while ((selectedTableEl.rows[0]?.cells.length || 0) < targetCols) addTableColumn();
      while ((selectedTableEl.rows[0]?.cells.length || 0) > targetCols) removeTableColumn();
      if (hasColWidth || hasRowHeight) {
        Array.from(selectedTableEl.querySelectorAll<HTMLElement>("td, th")).forEach((cell) => {
          if (hasColWidth) { cell.style.removeProperty("min-width"); cell.style.width = `${colWidth}cm`; }
          if (hasRowHeight) cell.style.height = `${rowHeight}cm`;
        });
        if (hasColWidth) {
          selectedTableEl.style.width = `${(colWidth * targetCols).toFixed(2)}cm`;
          selectedTableEl.style.tableLayout = "fixed";
        }
      }
      setDirty(true);
      setShowTableModal(false);
      return;
    }

    const rows = Math.max(1, Math.min(30, tableDraft.rows || 3));
    const cols = Math.max(1, Math.min(12, tableDraft.cols || 3));
    // Border is solid black, plain inline styles only (no resize/overflow
    // tricks) — Word's HTML-to-doc importer can silently drop an entire
    // table if a cell has overflow:auto (treats it as an unsupported
    // scrollable region), so this must stay minimal to survive every
    // export path (Word, print preview, PDF).
    const cellStyle = `border-width:1px;border-style:solid;border-color:#000;padding:6px 8px;${hasColWidth ? `width:${colWidth}cm;` : "min-width:60px;"}${hasRowHeight ? `height:${rowHeight}cm;` : ""}vertical-align:top;`;
    const headerCellStyle = cellStyle + "background:#eee;font-weight:bold;";
    const rowsHtml = Array.from({ length: rows }, (_, r) =>
      `<tr>${Array.from({ length: cols }, () => `<td style="${r === 0 && tableDraft.headerRow ? headerCellStyle : cellStyle}">&nbsp;</td>`).join("")}</tr>`
    ).join("");
    const tableWidthStyle = hasColWidth ? `width:${(colWidth * cols).toFixed(2)}cm;table-layout:fixed;` : "width:100%;";
    const tableHtml = `<table style="border-collapse:collapse;${tableWidthStyle}margin:12px 0;"><tbody>${rowsHtml}</tbody></table><p><br></p>`;
    editorRef.current?.focus();
    const savedRange = tableInsertRangeRef.current;
    if (savedRange) {
      const sel1 = window.getSelection();
      sel1?.removeAllRanges();
      sel1?.addRange(savedRange);
    }
    document.execCommand("insertHTML", false, tableHtml);
    setDirty(true);
    setShowTableModal(false);
  };
  const insertImage = () => imageInputRef.current?.click();

  const placeCaretAtPoint = (x: number, y: number) => {
    const anyDoc = document as any;
    let range: Range | null = null;
    if (anyDoc.caretRangeFromPoint) {
      range = anyDoc.caretRangeFromPoint(x, y);
    } else if (anyDoc.caretPositionFromPoint) {
      const pos = anyDoc.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    editorRef.current?.focus();
  };

  const insertImageFile = async (file: File) => {
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      alert("Tylko pliki JPG lub PNG.");
      return;
    }
    if (!selectedDevice) {
      alert("Wybierz najpierw urządzenie.");
      return;
    }
    // The upload takes a few network round-trips (folder check, numbering,
    // upload, share link) — capture exactly where the caret was NOW, so
    // the image lands there even if focus/selection changes meanwhile.
    const sel = window.getSelection();
    const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

    setImageUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Nie udało się odczytać pliku."));
        reader.readAsDataURL(file);
      });

      const { blob } = await new Promise<{ blob: Blob }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // Downscale large images client-side before upload.
          const maxWidth = 1400;
          let { width, height } = img;
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (b) => (b ? resolve({ blob: b }) : reject(new Error("Nie udało się przetworzyć obrazka."))),
            file.type === "image/png" ? "image/png" : "image/jpeg",
            0.85,
          );
        };
        img.onerror = () => reject(new Error("Nie udało się wczytać obrazka."));
        img.src = dataUrl;
      });

      const extension = file.type === "image/png" ? "png" : "jpg";
      const url = await uploadChapterImage(deviceLabel, blob, extension);

      if (savedRange) {
        const sel2 = window.getSelection();
        sel2?.removeAllRanges();
        sel2?.addRange(savedRange);
      }
      editorRef.current?.focus();
      document.execCommand("insertImage", false, url);
      setDirty(true);
    } catch (e: any) {
      alert("Nie udało się wstawić obrazka: " + (e?.message || String(e)));
    } finally {
      setImageUploading(false);
    }
  };

  const onImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    insertImageFile(file);
  };

  const saveChapter = async (silent = false) => {
    if (!active || !editorRef.current) return;
    // Strip the live-preview data-num attributes before persisting —
    // they're recomputed fresh on every load/render (see
    // applyLiveHeadingNumbers), so saved content should stay clean of
    // them to avoid staleness and keep the stored HTML minimal.
    const html = editorRef.current.innerHTML.replace(/\s*data-num="[^"]*"/g, "");
    const CHUNK_SIZE = 1_000_000;
    if (html.length > CHUNK_SIZE) {
      await actor.beginChapterUpload(active.id);
      for (let i = 0; i < html.length; i += CHUNK_SIZE) {
        await actor.appendChapterChunk(active.id, html.slice(i, i + CHUNK_SIZE));
      }
      await actor.commitChapterUpload(active.id, active.title, "");
    } else {
      await actor.updateDeviceManualChapter(active.id, active.title, html, "");
    }
    setDirty(false);
    setChapters((prev) => prev.map((c) => (c.id === active.id ? { ...c, contentHtml: html } : c)));
    if (silent) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    } else {
      // Manual "💾 Zapisz" click only — the silent 3s auto-save doesn't
      // push to Drive on every keystroke pause, just the canister.
      try {
        await syncChapterToDrive(deviceLabel, active.id, active.order, active.title, html);
        setDriveSyncFlash(true);
        setTimeout(() => setDriveSyncFlash(false), 1500);
      } catch (e: any) {
        setDriveSyncError("Nie udało się zsynchronizować z Bartolini Drive: " + (e?.message || String(e)));
        setTimeout(() => setDriveSyncError(""), 5000);
      }
    }
  };

  // Auto-save: 3s after the last edit, only while enabled + edit mode on.
  useEffect(() => {
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    if (!autoSave || !dirty || !editMode) return;
    autoSaveTimer.current = window.setTimeout(() => { saveChapter(true); }, 3000);
    return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
  }, [dirty, autoSave, editMode]);

  const getChaptersForExport = (): Chapter[] => {
    if (!active || !editorRef.current) return chapters;
    const liveHtml = editorRef.current.innerHTML.replace(/\s*data-num="[^"]*"/g, "");
    return chapters.map((c) => (c.id === active.id ? { ...c, contentHtml: liveHtml } : c));
  };

  const exportWord = async () => {
    try {
      const selected = chapters.filter((c) => selectedForPrint.has(c.id));
      if (selected.length === 0) { alert("Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej)."); return; }
      const html = await buildWordExportHtml(deviceLabel, getChaptersForExport(), hfSettings, selectedForPrint);
      const blob = new Blob(["\ufeff", html], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Instrukcja_${deviceLabel.replace(/[^\w-]/g, "_")}.doc`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Eksport do Worda nie powiódł się: " + (e?.message || String(e)));
    }
  };

  // Builds a standalone print-style HTML snapshot of just the currently
  // active chapter (header + this chapter's content + footer), for the
  // "print preview" modal. Reuses the same header/footer/pagination CSS
  // as exportPdf(), but scoped to one chapter and rendered into an
  // iframe instead of a new window, so it can be pinned open on a second
  // monitor and refreshed on demand.
  // Print preview now mirrors the checkbox selection in the sidebar
  // (selectedForPrint), not just the single active chapter — it's meant
  // to be an exact preview of what exportWord()/exportPdf() will
  // produce, so it must use the same chapter set and the same
  // numberHeadingsForExport() numbering as Word.
  const buildChapterPreviewHtml = (): string => {
    const selected = chapters.filter((c) => selectedForPrint.has(c.id));
    if (selected.length === 0) {
      return `<html><body style="font-family:Arial,sans-serif;padding:24px;color:#888;">
        Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej), żeby zobaczyć podgląd wydruku.
      </body></html>`;
    }
    const headerHtml = hfSettings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`;
    const footerHtml = hfSettings.footerText.trim() || "Bartolini Air Simulation";
    const numbered = numberHeadingsForExport(getChaptersForExport(), selectedForPrint);
    const body = numbered.map((n) => n.html).join(`<div class="${PAGE_BREAK_CLASS}"></div>`);
    return `<html><head><meta charset="utf-8"/><title>Podgląd wydruku</title>
      <style>
        @page { size: A4; margin: 0; }
        body{font-family:Arial,sans-serif;padding:0;margin:0;background:#888;}
        .sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;box-shadow:0 0 8px rgba(0,0,0,0.4);box-sizing:border-box;}
        .page-header{font-size:9pt;color:#555;border-bottom:1px solid #ccc;padding:6px 24px;height:3.75cm;box-sizing:border-box;display:flex;align-items:flex-end;}
        .page-footer{font-size:9pt;color:#555;border-top:1px solid #ccc;padding:6px 24px;height:1.27cm;box-sizing:border-box;text-align:center;}
        .page-content{padding:0 1.27cm;min-height:calc(297mm - 3.75cm - 1.27cm);}
        .${PAGE_BREAK_CLASS}{page-break-before:always;border:none;}
        h1{color:#1a1a8c;}
        img{max-width:100%;}
      </style>
      </head><body>
      <div class="sheet">
        ${hfSettings.skipFirstPage ? "" : `<div class="page-header">${headerHtml}</div>`}
        <div class="page-content" id="doc">${body}</div>
        <div class="page-footer">${footerHtml}</div>
      </div>
      </body></html>`;
  };
  const openPrintPreview = () => {
    setPreviewHtml(buildChapterPreviewHtml());
    setShowPrintPreview(true);
  };
  const refreshPrintPreview = () => {
    setPreviewHtml(buildChapterPreviewHtml());
  };
  const exportPdf = () => {
    const selected = chapters.filter((c) => selectedForPrint.has(c.id));
    if (selected.length === 0) { alert("Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej)."); return; }
    // Numbering via numberHeadingsForExport (same as Word/print preview),
    // not CSS counters — see buildChapterPreviewHtml for why.
    const numbered = numberHeadingsForExport(getChaptersForExport(), selectedForPrint);
    const body = numbered.map((n) => n.html).join(`<div class="${PAGE_BREAK_CLASS}"></div>`);
    const headerHtml = hfSettings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`;
    const footerHtml = hfSettings.footerText.trim() || "Bartolini Air Simulation";
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Instrukcja — ${deviceLabel}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:0;}
        .page-header{font-size:9pt;color:#555;border-bottom:1px solid #ccc;padding:6px 24px;}
        .page-footer{font-size:9pt;color:#555;border-top:1px solid #ccc;padding:6px 24px;text-align:center;}
        .page-content{padding:0 24px;}
        #doc h1{color:#1a1a8c;}
        img{max-width:100%;}
        .${PAGE_BREAK_CLASS}{page-break-before:always;border:none;}
        @media print { .no-print { display:none; } }
      </style>
      </head><body>
      ${hfSettings.skipFirstPage ? "" : `<div class="page-header">${headerHtml}</div>`}
      <div class="page-content"><h1 style="text-align:center;">Instrukcja obsługi — ${deviceLabel}</h1></div>
      ${hfSettings.skipFirstPage ? "" : `<div class="page-footer">${footerHtml}</div>`}
      <div class="${PAGE_BREAK_CLASS}"></div>
      <div class="page-header">${headerHtml}</div>
      <div class="page-content" id="doc">${body}</div>
      <div class="page-footer">${footerHtml}</div>
      <p class="no-print" style="padding:16px;color:#888;font-size:11px;">
        Wskazówka: w oknie drukowania włącz „Nagłówki i stopki” żeby przeglądarka dodała numerację stron.
      </p>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-4 space-y-4">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

        <div className="flex items-center gap-3 bg-[var(--bg-card)] border-b-2 border-cyan-600 px-4 py-3 rounded-t-lg flex-wrap">
          <h1 className="text-lg font-bold text-cyan-600">📖 Dokumentacja</h1>
          <span className="text-[10px] text-[#f0c040]">
            DEBUG poll#{pollTicks} deviceId={String(deviceId)} editMode={String(editMode)}
            {lastPolled ? ` ostatni sukces: ${lastPolled.toLocaleTimeString()}` : " (brak sukcesu)"}
            {pollError ? ` BLAD: ${pollError}` : ""}
          </span>
          {lockedBy && !editMode && (
            <span className="text-xs text-amber-500 font-semibold">
              Edytuje: {displayNames[lockedBy] || lockedBy}
            </span>
          )}
          {lockBusyMsg && (
            <span className="text-xs text-red-400">
              {lockBusyMsg}
            </span>
          )}
          <select
            value={deviceId ?? ""}
            onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : null)}
            className="ml-2 bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-color)] rounded px-3 py-1.5 text-sm"
          >
            {devices.map((d) => (
              <option key={String(d.id)} value={Number(d.id)}>{d.symbol} — {d.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] ml-2">
            <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
            Auto-zapis (3s)
          </label>
          {savedFlash && <span className="text-xs text-emerald-400">💾 Zapisano</span>}
          {driveSyncFlash && <span className="text-xs text-cyan-400">☁️ Zsynchronizowano z Bartolini Drive</span>}
          {driveSyncError && <span className="text-xs text-amber-400">{driveSyncError}</span>}
          <div className="ml-auto flex gap-2">
            {canEdit && (
              <button onClick={openSettings} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] hover:border-cyan-600">
                ⚙️ Nagłówek/stopka
              </button>
            )}
            <button onClick={exportPdf} disabled={chapters.length === 0} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] hover:border-cyan-600 disabled:opacity-40">
              🖨 Eksportuj PDF
            </button>
            <button onClick={exportWord} disabled={chapters.length === 0} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] hover:border-cyan-600 disabled:opacity-40">
              📄 Eksportuj Word
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[var(--text-muted)] p-6">Wczytywanie…</div>
        ) : (
          <div className="flex bg-[var(--bg-card)] rounded-b-lg overflow-hidden" style={{ height: "calc(100vh - 220px)" }}>
            <div className="w-72 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-page)] p-3 space-y-1 overflow-auto">
              {chapters.map((ch) => (
                <div
                  key={ch.id}
                  draggable={canEdit}
                  onDragStart={() => canEdit && setDragId(ch.id)}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={() => canEdit && handleDrop(ch.id)}
                  className={"group flex items-center gap-1 rounded px-2 py-2 text-sm " + (canEdit ? "cursor-grab " : "") + (ch.id === activeId ? "bg-[#263238] text-[#4fc3f7]" : "hover:bg-[#1a2733]")}
                >
                  <span className="text-[var(--text-muted)] text-xs">{canEdit ? "⠿" : ""}</span>
                  <input
                    type="checkbox"
                    checked={selectedForPrint.has(ch.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelectedForPrint(ch.id); }}
                    onClick={(e) => e.stopPropagation()}
                    title="Uwzględnij w podglądzie wydruku i eksporcie"
                    className="shrink-0"
                  />
                  {renamingId === ch.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => confirmRename(ch)}
                      onKeyDown={(e) => e.key === "Enter" && confirmRename(ch)}
                      className="flex-1 min-w-0 bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-1 text-xs text-[var(--text-primary)]"
                    />
                  ) : (
                    <span onClick={() => setActiveId(ch.id)} className="flex-1 truncate">{ch.title}</span>
                  )}
                  {canEdit && <button onClick={() => startRename(ch)} title="Zmień nazwę" className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-muted)]">✏</button>}
                  <button onClick={() => downloadChapter(ch)} title="Pobierz" className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-muted)]">⬇</button>
                  {canEdit && <button onClick={() => requestDelete(ch)} title="Usuń" className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400">✕</button>}
                </div>
              ))}
              {canEdit && (
                <div className="flex gap-1 pt-3">
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addChapter()}
                    placeholder="+ Nowy rozdział"
                    className="flex-1 min-w-0 bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
              )}
              {!canEdit && (
                <p className="text-[10px] text-amber-400 pt-3 leading-snug">
                  Nie masz uprawnienia do edycji dokumentacji — poproś administratora o nadanie go (osobno od zwykłej roli Zapis).
                </p>
              )}
              <p className="text-[10px] text-[var(--text-muted)] pt-2 leading-snug">
                Przeciągnij ⠿ żeby zmienić kolejność. Style „Heading 1/2/3” w edytorze same numerują się jako Rozdział / Podrozdział / Punkt.
              </p>
            </div>

            <div className="flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)]">
              <style>{COUNTER_CSS}</style>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onImageSelected} />
              {!active ? (
                <div className="p-8 text-sm text-[var(--text-muted)]">
                  {chapters.length === 0 ? "Brak rozdziałów — dodaj pierwszy w panelu po lewej." : "Wybierz rozdział z listy."}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)] flex-wrap bg-[var(--bg-hover)]">
                    {canEdit ? (
                      <button onClick={() => (editMode ? exitEditMode() : tryEnterEditMode())} className="text-xs px-3 py-1.5 rounded border border-[#ccc]">
                        {editMode ? "✏ Edytuję" : "✏ Edytuj"}
                      </button>
                    ) : (
                      <span className="text-xs text-amber-600">🔒 Tylko podgląd — brak uprawnienia do edycji dokumentacji</span>
                    )}
                    <button onClick={openPrintPreview} className="text-xs px-3 py-1.5 rounded border border-[#ccc]">
                      🖨 Podgląd wydruku
                    </button>
                    <span className="w-px h-5 bg-[#ccc] mx-1" />
                    <button
                      onClick={() => setFitToScreen((v) => !v)}
                      title="Dopasuj szerokość pola roboczego do szerokości ekranu"
                      className={`text-xs px-3 py-1.5 rounded border ${fitToScreen ? "bg-cyan-600 text-white border-cyan-600" : "border-[#ccc]"}`}
                    >
                      🖥 Dopasuj do ekranu
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setZoomLevel((z) => Math.max(50, z - 10))} title="Pomniejsz" className="text-xs w-7 h-8 rounded border border-[#ccc]">－</button>
                      <button onClick={() => setZoomLevel(100)} title="Resetuj powiększenie" className="text-xs px-1.5 h-8 rounded border border-[#ccc] min-w-[44px]">{zoomLevel}%</button>
                      <button onClick={() => setZoomLevel((z) => Math.min(200, z + 10))} title="Powiększ" className="text-xs w-7 h-8 rounded border border-[#ccc]">＋</button>
                    </div>
                    {editMode && canEdit && (
                      <>
                        <span className="w-px h-5 bg-[#ccc] mx-1" />
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value === "<h4>") applySectionStyle();
                            else if (e.target.value) exec("formatBlock", e.target.value);
                            e.target.value = "";
                          }}
                          className="text-xs h-8 rounded border border-[#ccc] px-1"
                        >
                          <option value="" disabled>Styl</option>
                          <option value="<p>">Normal</option>
                          <option value="<h4>">Sekcja (bez numeracji, nad rozdziałem)</option>
                          <option value="<h1>">Heading 1 — Rozdział</option>
                          <option value="<h2>">Heading 2 — Podrozdział</option>
                          <option value="<h3>">Heading 3 — Punkt</option>
                        </select>
                        <select
                          defaultValue=""
                          onChange={(e) => { if (e.target.value) exec("fontSize", e.target.value); e.target.value = ""; }}
                          className="text-xs h-8 rounded border border-[#ccc] px-1"
                          title="Wielkość czcionki"
                        >
                          <option value="" disabled>Rozmiar</option>
                          <option value="1">Bardzo mała (10px)</option>
                          <option value="2">Mała (13px)</option>
                          <option value="3">Normalna (16px)</option>
                          <option value="4">Duża (18px)</option>
                          <option value="5">Większa (24px)</option>
                          <option value="6">Duża+ (32px)</option>
                          <option value="7">Bardzo duża (48px)</option>
                        </select>
                        <button onClick={() => exec("bold")} className="text-xs w-8 h-8 font-bold rounded border border-[#ccc]">B</button>
                        <button onClick={() => exec("italic")} className="text-xs w-8 h-8 italic rounded border border-[#ccc]">I</button>
                        <button onClick={() => exec("insertUnorderedList")} className="text-xs px-2 h-8 rounded border border-[#ccc]">• Lista</button>
                        <button onClick={() => exec("justifyLeft")} className="text-xs px-2 h-8 rounded border border-[#ccc]">⬛L</button>
                        <button onClick={() => exec("justifyCenter")} className="text-xs px-2 h-8 rounded border border-[#ccc]">⬛C</button>
                        <button onClick={() => exec("justifyRight")} className="text-xs px-2 h-8 rounded border border-[#ccc]">⬛R</button>
                        <span className="w-px h-5 bg-[#ccc] mx-1" />
                        <button onClick={insertImage} disabled={imageUploading} className="text-xs px-2 h-8 rounded border border-[#ccc] disabled:opacity-50">
                          {imageUploading ? "⏳ Przesyłam na Drive…" : "🖼 Obraz"}
                        </button>
                        <button onClick={insertPageBreak} className="text-xs px-2 h-8 rounded border border-[#ccc]">⏎ Podział strony</button>
                        <button onClick={insertTable} className="text-xs px-2 h-8 rounded border border-[#ccc]">🔲 Tabela</button>
                        <button onClick={addComment} className="text-xs px-2 h-8 rounded border border-[#ccc]">💬 Komentarz</button>
                        {selectedTableEl && (
                          <>
                            <span className="w-px h-5 bg-[#ccc] mx-1" />
                            <button onClick={addTableRow} className="text-xs px-2 h-8 rounded border border-[#ccc]">+Wiersz</button>
                            <button onClick={removeTableRow} className="text-xs px-2 h-8 rounded border border-[#ccc]">-Wiersz</button>
                            <button onClick={addTableColumn} className="text-xs px-2 h-8 rounded border border-[#ccc]">+Kolumna</button>
                            <button onClick={removeTableColumn} className="text-xs px-2 h-8 rounded border border-[#ccc]">-Kolumna</button>
                            <button onClick={openResizeTable} className="text-xs px-2 h-8 rounded border border-[#ccc]">📐 Rozmiar</button>
                            <button onClick={deleteTable} className="text-xs px-2 h-8 rounded border border-[#ccc] text-red-600">🗑 Usuń tabelę</button>
                          </>
                        )}
                        <span className="text-[10px] text-[#999]">(albo przeciągnij plik na edytor)</span>
                        <span className="w-px h-5 bg-[#ccc] mx-1" />
                        <button
                          onClick={() => saveChapter(false)}
                          disabled={!dirty}
                          className="text-xs px-4 h-8 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-medium"
                        >
                          💾 Zapisz
                        </button>
                      </>
                    )}
                  </div>
                  <div ref={commentAreaRef} className="flex-1 relative overflow-auto bg-[var(--bg-page)] py-6">
                    <div
                      className="mx-auto bg-[var(--bg-card)] text-[var(--text-primary)] shadow-lg relative"
                      style={{
                        width: fitToScreen ? "100%" : "210mm",
                        maxWidth: fitToScreen ? "1600px" : "210mm",
                        minHeight: "297mm",
                        boxSizing: "border-box",
                        padding: "3.75cm 1.27cm 1.27cm 1.27cm",
                        transform: `scale(${zoomLevel / 100})`,
                        transformOrigin: "top center",
                      }}
                    >
                    <div
                      id="doc-editor-content"
                      ref={editorRef}
                      contentEditable={editMode && canEdit}
                      onKeyDown={(e) => {
                        // Browsers move focus to the next tabbable element
                        // on Tab by default, which is useless inside a
                        // contentEditable body — capture it and insert an
                        // indent (Shift+Tab removes one level) instead.
                        if (e.key !== "Tab") return;
                        e.preventDefault();
                        if (e.shiftKey) {
                          document.execCommand("outdent");
                        } else {
                          document.execCommand("insertHTML", false, "&emsp;");
                        }
                        setDirty(true);
                      }}
                      onInput={() => {
                        setDirty(true);
                        if (editorRef.current) applyLiveHeadingNumbers(editorRef.current, h1Offset);
                      }}
                      onClick={onEditorClick}
                      onPaste={onEditorPaste}
                      onDragStart={onEditorDragStart}
                      onDragEnd={onEditorDragEnd}
                      onDragOver={(e) => { if (editMode && canEdit) e.preventDefault(); }}
                      onDrop={(e) => {
                        if (!editMode || !canEdit) return;
                        e.preventDefault();
                        if (draggedImgRef.current) {
                          const img = draggedImgRef.current;
                          draggedImgRef.current = null;
                          placeCaretAtPoint(e.clientX, e.clientY);
                          const sel = window.getSelection();
                          if (sel && sel.rangeCount > 0) {
                            const range = sel.getRangeAt(0);
                            img.remove();
                            range.insertNode(img);
                            range.collapse(false);
                          }
                          setSelectedImg(img);
                          syncOverlayPositions(img);
                          setDirty(true);
                          return;
                        }
                        const file = e.dataTransfer.files?.[0];
                        if (!file) return;
                        placeCaretAtPoint(e.clientX, e.clientY);
                        insertImageFile(file);
                      }}
                      suppressContentEditableWarning
                      className="p-8 text-[15px] leading-relaxed outline-none"
                      style={{ maxWidth: 900, margin: "0 auto", width: "100%", ["--h1-offset" as any]: h1Offset }}
                    />
                    </div>
                    {selectedImg && imgToolbarPos && editMode && canEdit && (
                      <div
                        className="absolute flex items-center gap-1 bg-[#1a1a2e] rounded shadow-lg px-1.5 py-1 z-10"
                        style={{ top: Math.max(imgToolbarPos.top, 0), left: imgToolbarPos.left }}
                      >
                        <button onClick={() => alignImage("left")} title="Wyrównaj do lewej, tekst opływa z prawej" className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[#e0e0e0]">⬅</button>
                        <button onClick={() => alignImage("center")} title="Wyśrodkuj" className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[#e0e0e0]">⬛</button>
                        <button onClick={() => alignImage("right")} title="Wyrównaj do prawej, tekst opływa z lewej" className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[#e0e0e0]">➡</button>
                        <span className="w-px h-4 bg-[#555] mx-0.5" />
                        <button onClick={() => resizeImage(25)} className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[#e0e0e0]">25%</button>
                        <button onClick={() => resizeImage(50)} className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[#e0e0e0]">50%</button>
                        <button onClick={() => resizeImage(100)} className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[#e0e0e0]">100%</button>
                        <span className="w-px h-4 bg-[#555] mx-0.5" />
                        <button onClick={removeSelectedImage} title="Usuń obraz" className="text-[10px] px-1.5 py-0.5 rounded border border-red-400 text-red-400">✕</button>
                      </div>
                    )}
                    {selectedImg && handlePos && editMode && canEdit && (
                      <div
                        onMouseDown={startResizeDrag}
                        title="Przeciągnij, żeby zmienić rozmiar"
                        className="absolute w-4 h-4 rounded-full bg-cyan-500 border-2 border-white shadow z-10 cursor-nwse-resize"
                        style={{ top: handlePos.top, left: handlePos.left }}
                      />
                    )}
                    {commentPopup && (
                      <>
                        <div className="absolute h-px bg-amber-500 z-10 pointer-events-none" style={{ top: commentPopup.top, left: commentPopup.left, width: commentPopup.lineWidth }} />
                        <div
                          className="absolute z-20 rounded-lg shadow-xl p-3 border-2"
                          style={{ top: Math.max(commentPopup.top - 20, 0), right: 12, width: 260, background: "#fff8e1", borderColor: "#e6b800" }}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold text-amber-800">💬 Komentarz</span>
                            <button onClick={() => { commentAnchorElRef.current = null; setCommentPopup(null); }} className="text-[11px] text-amber-800">✕</button>
                          </div>
                          <textarea
                            value={commentPopup.draft}
                            onChange={(e) => setCommentPopup((p) => (p ? { ...p, draft: e.target.value } : p))}
                            onBlur={(e) => saveCommentDraft(e.target.value)}
                            rows={3}
                            disabled={!editMode || !canEdit}
                            className="w-full text-xs p-1.5 rounded border border-amber-300 bg-white text-[#333]"
                            placeholder="Wpisz komentarz…"
                          />
                          {editMode && canEdit && (
                            <div className="flex justify-end gap-1 mt-1.5">
                              <button onClick={deleteComment} className="text-[10px] px-2 py-1 rounded border border-red-300 text-red-500">Usuń komentarz</button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-white text-[#1a1a1a] rounded-lg p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[#1a1a8c]">⚙️ Nagłówek i stopka dokumentu</h3>
            <p className="text-xs text-[#666]">Te ustawienia są wspólne dla wszystkich eksportowanych instrukcji (Word i PDF).</p>

            <label className="block text-xs text-[#666]">
              Tekst nagłówka (pusty = domyślnie nazwa urządzenia)
              <input
                value={hfDraft.headerText}
                onChange={(e) => setHfDraft((d) => ({ ...d, headerText: e.target.value }))}
                className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                placeholder="np. Bartolini Air Simulation — Dokumentacja techniczna"
              />
            </label>

            <label className="block text-xs text-[#666]">
              Tekst stopki
              <input
                value={hfDraft.footerText}
                onChange={(e) => setHfDraft((d) => ({ ...d, footerText: e.target.value }))}
                className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                placeholder="Bartolini Air Simulation"
              />
            </label>

            <div className="text-xs text-[#666]">
              Logo w nagłówku
              <div className="flex items-center gap-2 mt-1">
                {hfDraft.logoDataUri ? (
                  <img src={hfDraft.logoDataUri} alt="logo" className="h-6" />
                ) : (
                  <span className="text-[10px] text-[#999]">domyślne logo Bartolini</span>
                )}
                <button onClick={() => hfLogoInputRef.current?.click()} className="text-xs px-2 py-1 rounded border border-[#ccc]">Zmień…</button>
                {hfDraft.logoDataUri && (
                  <button onClick={() => setHfDraft((d) => ({ ...d, logoDataUri: "" }))} className="text-xs px-2 py-1 rounded border border-[#ccc]">Przywróć domyślne</button>
                )}
              </div>
              <input ref={hfLogoInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onHfLogoSelected} />
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.skipFirstPage} onChange={(e) => setHfDraft((d) => ({ ...d, skipFirstPage: e.target.checked }))} />
              Bez nagłówka/stopki na pierwszej stronie (stronie tytułowej)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.showPageNumbers} onChange={(e) => setHfDraft((d) => ({ ...d, showPageNumbers: e.target.checked }))} />
              Pokaż numerację stron w stopce (Word: prawdziwa, aktualizuje się automatycznie)
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 text-sm rounded border border-[#ccc]">Anuluj</button>
              <button onClick={saveSettings} className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-500 text-white">Zapisz</button>
            </div>
          </div>
        </div>
      )}

      {showTableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTableModal(false)}>
          <div className="bg-white text-[#1a1a1a] rounded-lg p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[#1a1a8c]">🔲 {tableModalMode === "resize" ? "Zmień rozmiar tabeli" : "Wstaw tabelę"}</h3>
            <label className="block text-xs text-[#666]">
              Liczba wierszy
              <input
                type="number" min={1} max={30}
                value={tableDraft.rows}
                onChange={(e) => setTableDraft((d) => ({ ...d, rows: parseInt(e.target.value, 10) || 1 }))}
                className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
              />
            </label>
            <label className="block text-xs text-[#666]">
              Liczba kolumn
              <input
                type="number" min={1} max={12}
                value={tableDraft.cols}
                onChange={(e) => setTableDraft((d) => ({ ...d, cols: parseInt(e.target.value, 10) || 1 }))}
                className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={tableDraft.headerRow}
                onChange={(e) => setTableDraft((d) => ({ ...d, headerRow: e.target.checked }))}
              />
              Pierwszy wiersz jako nagłówek (pogrubiony, wyszarzone tło)
            </label>
            <label className="block text-xs text-[#666]">
              Szerokość kolumny (cm, puste = auto)
              <input
                type="number" min={0} step={0.1}
                value={tableDraft.colWidthCm}
                onChange={(e) => setTableDraft((d) => ({ ...d, colWidthCm: e.target.value }))}
                className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                placeholder="np. 10"
              />
            </label>
            <label className="block text-xs text-[#666]">
              Wysokość wiersza (cm, puste = auto)
              <input
                type="number" min={0} step={0.1}
                value={tableDraft.rowHeightCm}
                onChange={(e) => setTableDraft((d) => ({ ...d, rowHeightCm: e.target.value }))}
                className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                placeholder="np. 1.5"
              />
            </label>
            {(() => {
              const w = parseFloat(tableDraft.colWidthCm);
              if (isNaN(w) || w <= 0) return null;
              const total = w * tableDraft.cols;
              if (total <= A4_USABLE_WIDTH_CM) return null;
              return (
                <p className="text-xs text-red-600">
                  ⚠️ Tabela za szeroka na A4: {total.toFixed(1)} cm (dostępne ~{A4_USABLE_WIDTH_CM} cm).
                </p>
              );
            })()}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowTableModal(false)} className="px-3 py-1.5 text-sm rounded border border-[#ccc]">Anuluj</button>
              <button onClick={confirmInsertTable} className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-500 text-white">{tableModalMode === "resize" ? "Zastosuj" : "Wstaw"}</button>
            </div>
          </div>
        </div>
      )}

      {showPrintPreview && (
        // Floating, draggable window instead of a centered blocking
        // overlay — no backdrop, so the editor underneath stays usable
        // while this is pinned open (e.g. dragged to a second monitor).
        <div
          className="fixed z-50 bg-[var(--bg-card)] rounded-lg shadow-2xl border border-[var(--border-color)] w-[900px] max-w-[95vw] h-[85vh] flex flex-col overflow-hidden"
          style={{ left: previewPos.x, top: previewPos.y }}
        >
          <div
            onMouseDown={onPreviewDragStart}
            className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] flex-wrap gap-2 cursor-move select-none"
          >
            <h2 className="text-sm font-bold text-[#4fc3f7]">Podglad wydruku - zaznaczone rozdzialy: {selectedForPrint.size}</h2>
            <div className="flex items-center gap-2">
              <button onClick={refreshPrintPreview} className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white">
                Odswiez
              </button>
              <button onClick={() => setShowPrintPreview(false)} className="text-xs px-3 py-1.5 rounded border border-[#666] text-[#e0e0e0]">
                Zamknij
              </button>
            </div>
          </div>
          <iframe
            title="Podglad wydruku"
            srcDoc={previewHtml}
            className="flex-1 w-full bg-[#888]"
            style={{ border: "none" }}
          />
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white text-[#1a1a1a] rounded-lg p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-600">Usunąć rozdział?</h3>
            <p className="text-sm">
              Rozdział „<strong>{deleteTarget.title}</strong>” trafi do kosza administratora (odwracalne, ale wymaga admina żeby przywrócić).
            </p>
            <p className="text-xs text-[#666]">Wpisz <strong>DELETE</strong> żeby potwierdzić:</p>
            <input
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
              className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm"
              placeholder="DELETE"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-sm rounded border border-[#ccc]">Anuluj</button>
              <button
                onClick={confirmDelete}
                disabled={deleteConfirmText !== "DELETE"}
                className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white"
              >
                Usuń do kosza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
