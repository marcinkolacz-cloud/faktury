import { useEffect, useRef, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { setDriveActor, warmDriveToken } from "../lib/oneDriveConfig";
import { syncChapterToDrive, uploadChapterImage, loadChapterContentFromDrive, renameChapterOnDrive } from "../lib/documentationDriveSync";
import { isTocHeadingTitle } from "../lib/headingNumbering";
import { docContentCss } from "../lib/docContentStyle";
import { ManualVariablesPanel } from "./ManualVariablesPanel";
import { DocumentationEditorTiptapPoC } from "./DocumentationEditorTiptapPoC";

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
// "2.4" instead of "2.1"). Live numbering is written by Tiptap's own
// HeadingNumbering extension (real node attribute, immune to nesting
// depth) into a data-num attribute that this CSS just displays verbatim.
// COUNTER_CSS przeniesiony do lib/docContentStyle.ts (docContentCss) - jedno
// źródło współdzielone z żywym edytorem, żeby wygląd był klonem 1:1.
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
    // Pusty akapit (sam Enter, bez tekstu) w ProseMirror ma realną wysokość
    // (edytor wstawia niewidoczny "trailing break"), ale zapisane/wyeksportowane
    // <p></p> bez zawartości zapada się do 0px w zwykłym renderowaniu (podgląd,
    // Word, PDF) - stąd puste linie "znikają" tylko poza edytorem. Wymuszamy
    // <br> w naprawdę pustych blokach, żeby zajmowały tyle samo miejsca co
    // w żywym edytorze.
    doc.body.querySelectorAll("p, div, li").forEach((el) => {
      if (el.childNodes.length === 0) el.innerHTML = "<br>";
    });
    doc.body.querySelectorAll("h1, h2, h3").forEach((el) => {
      if (isTocHeadingTitle(el.textContent || "")) {
        return;
      }
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
  // Extra fields below are stored client-side only (localStorage), not
  // sent to the backend - adding them to the on-chain candid record would
  // require a Motoko stable-storage migration, which isn't worth it for
  // what's essentially display preferences. headerText/footerText above
  // double as "odd page header" / "center footer" for backward compat.
  headerTextEvenLeft: string;
  headerTextCenter: string;
  headerTextRight: string;
  headerTextEvenCenter: string;
  headerTextEvenRight: string;
  footerTextLeft: string;
  footerTextRight: string;
  enableHeader: boolean;
  enableFooter: boolean;
  headerHeightCm: number;
  footerHeightCm: number;
  headerFontSize: number;
  footerFontSize: number;
  headerBorder: boolean;
  footerBorder: boolean;
  headerAlign: "left" | "center" | "right";
};

const HF_EXTRA_STORAGE_KEY = "faktury_doc_hf_extra_v1";

type HfExtras = Pick<HeaderFooterSettings, "headerTextEvenLeft" | "headerTextCenter" | "headerTextRight" | "headerTextEvenCenter" | "headerTextEvenRight" | "footerTextLeft" | "footerTextRight" | "enableHeader" | "enableFooter" | "headerHeightCm" | "footerHeightCm" | "headerFontSize" | "footerFontSize" | "headerBorder" | "footerBorder" | "headerAlign">;

function loadHfExtras(): HfExtras {
  try {
    const raw = localStorage.getItem(HF_EXTRA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        headerTextEvenLeft: parsed.headerTextEvenLeft ?? parsed.headerTextEven ?? "",
        headerTextCenter: parsed.headerTextCenter ?? "",
        headerTextRight: parsed.headerTextRight ?? "",
        headerTextEvenCenter: parsed.headerTextEvenCenter ?? "",
        headerTextEvenRight: parsed.headerTextEvenRight ?? "",
        footerTextLeft: parsed.footerTextLeft ?? "",
        footerTextRight: parsed.footerTextRight ?? "",
        enableHeader: parsed.enableHeader ?? true,
        enableFooter: parsed.enableFooter ?? true,
        headerHeightCm: parsed.headerHeightCm ?? 3.75,
        footerHeightCm: parsed.footerHeightCm ?? 1.27,
        headerFontSize: parsed.headerFontSize ?? 9,
        footerFontSize: parsed.footerFontSize ?? 9,
        headerBorder: parsed.headerBorder ?? true,
        footerBorder: parsed.footerBorder ?? true,
        headerAlign: parsed.headerAlign ?? "left",
      };
    }
  } catch { /* fall back to defaults below */ }
  return { headerTextEvenLeft: "", headerTextCenter: "", headerTextRight: "", headerTextEvenCenter: "", headerTextEvenRight: "", footerTextLeft: "", footerTextRight: "", enableHeader: true, enableFooter: true, headerHeightCm: 3.75, footerHeightCm: 1.27, headerFontSize: 9, footerFontSize: 9, headerBorder: true, footerBorder: true, headerAlign: "left" };
}

function saveHfExtras(s: HeaderFooterSettings) {
  try {
    localStorage.setItem(HF_EXTRA_STORAGE_KEY, JSON.stringify({
      headerTextEvenLeft: s.headerTextEvenLeft,
      headerTextCenter: s.headerTextCenter,
      headerTextRight: s.headerTextRight,
      headerTextEvenCenter: s.headerTextEvenCenter,
      headerTextEvenRight: s.headerTextEvenRight,
      footerTextLeft: s.footerTextLeft,
      footerTextRight: s.footerTextRight,
      enableHeader: s.enableHeader,
      enableFooter: s.enableFooter,
      headerHeightCm: s.headerHeightCm,
      footerHeightCm: s.footerHeightCm,
      headerFontSize: s.headerFontSize,
      footerFontSize: s.footerFontSize,
      headerBorder: s.headerBorder,
      footerBorder: s.footerBorder,
      headerAlign: s.headerAlign,
    }));
  } catch { /* localStorage unavailable - extras just won't persist */ }
}

const DEFAULT_HF_SETTINGS: HeaderFooterSettings = {
  headerText: "",
  footerText: "Bartolini Air Simulation",
  logoDataUri: "",
  skipFirstPage: true,
  showPageNumbers: true,
  headerTextEvenLeft: "",
  headerTextCenter: "",
  headerTextRight: "",
  headerTextEvenCenter: "",
  headerTextEvenRight: "",
  footerTextLeft: "",
  footerTextRight: "",
  enableHeader: true,
  enableFooter: true,
  headerHeightCm: 3.75,
  footerHeightCm: 1.27,
  headerFontSize: 9,
  footerFontSize: 9,
  headerBorder: true,
  footerBorder: true,
  headerAlign: "left",
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
  const headerLeft = settings.headerText.trim().replace(/\n/g, "<br>");
  const headerCenter = settings.headerTextCenter.trim().replace(/\n/g, "<br>");
  const headerRight = settings.headerTextRight.trim().replace(/\n/g, "<br>");
  const footerText = settings.footerText.trim() || "Bartolini Air Simulation";
  const pageNumbers = settings.showPageNumbers
    ? ` — Strona <span style="mso-field-code:' PAGE '"> </span> z <span style="mso-field-code:' NUMPAGES '"> </span>`
    : "";
  const hBorder = settings.headerBorder ? "border-bottom:1px solid #ccc;" : "";
  const fBorder = settings.footerBorder ? "border-top:1px solid #ccc;" : "";

  const headerFooterHtml = `
<div style="mso-element:header;" id="h1">
  <table style="width:100%;border-collapse:collapse;margin:0;${hBorder}"><tr>
    <td style="padding-bottom:4px;font-size:${settings.headerFontSize}pt;color:#555;text-align:left;">${logoImg}${headerLeft}</td>
    <td style="padding-bottom:4px;font-size:${settings.headerFontSize}pt;color:#555;text-align:center;">${headerCenter}</td>
    <td style="padding-bottom:4px;font-size:${settings.headerFontSize}pt;color:#555;text-align:right;">${headerRight}</td>
  </tr></table>
</div>
<div style="mso-element:footer;" id="f1">
  <p style="margin:0;${fBorder}padding-top:4px;font-size:${settings.footerFontSize}pt;color:#555;text-align:center;">${footerText}${pageNumbers}</p>
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
    margin: ${settings.headerHeightCm}cm 1.27cm ${settings.footerHeightCm}cm 1.27cm;
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

// Compact icon-rail button used by the left action sidebar in the chapter
// editor — icon + tiny label stacked, active/disabled states, optional
// green dot badge (used to show "backup on-chain active").
function RailButton({ icon, label, onClick, active, disabled, title, badge }: {
  icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string; badge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      className={`relative flex flex-col items-center gap-1 w-16 py-2.5 rounded-lg text-[11px] leading-tight disabled:opacity-40 transition-all duration-100 active:scale-90 ${
        active
          ? "bg-[var(--accent)] text-white active:bg-[var(--accent)]/80"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] active:bg-[var(--accent)]/20"
      }`}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-center px-0.5">{label}</span>
      {badge && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-green-400" />}
    </button>
  );
}

export function DocumentationModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [books, setBooks] = useState<{ id: number; title: string; order: number }[]>([]);
  const [chapterBook, setChapterBook] = useState<Record<number, number>>({});
  const [expandedBooks, setExpandedBooks] = useState<Set<number>>(new Set());
  const [newChapterTitles, setNewChapterTitles] = useState<Record<number, string>>({});
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  // Kontekst książki jest zawsze pochodną aktywnego rozdziału — nie ma
  // osobnego "wybranego" stanu do synchronizowania (to był źródłem błędu
  // znikającej treści przy przełączaniu).
  const activeBookId = activeId !== null ? (chapterBook[activeId] ?? null) : null;
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { setLivePageCount(null); }, [activeId]);
  const [loading, setLoading] = useState(true);
  const [loadingChapterContent, setLoadingChapterContent] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);
  const [showChainVersion, setShowChainVersion] = useState(false);
  const showChainVersionRef = useRef(false);
  useEffect(() => { showChainVersionRef.current = showChainVersion; }, [showChainVersion]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [toolbarSlotEl, setToolbarSlotEl] = useState<HTMLDivElement | null>(null);
  const [livePageCount, setLivePageCount] = useState<number | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // 210mm in CSS px at the standard 96dpi reference used everywhere else
  // in this file (print preview, export) - must stay ONE authoritative
  // width so "Dopasuj do ekranu" only zooms (transform:scale), never
  // reflows text at a wider-than-A4 content width.
  const A4_WIDTH_PX = (210 * 96) / 25.4;
  useEffect(() => {
    if (!fitToScreen) {
      setZoomLevel(100);
      return;
    }
    const container = commentAreaRef.current;
    if (!container) return;
    const recalc = () => {
      const available = container.clientWidth - 48;
      const pct = Math.min(200, Math.max(30, Math.floor((available / A4_WIDTH_PX) * 100)));
      setZoomLevel(pct);
    };
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [fitToScreen]);
  const [dirty, setDirty] = useState(false);
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
  const [removeBackupConfirm, setRemoveBackupConfirm] = useState(false);
  const [removeBackupConfirmText, setRemoveBackupConfirmText] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [driveSyncFlash, setDriveSyncFlash] = useState(false);
  const [driveSyncError, setDriveSyncError] = useState("");
  // Guards silentReload/activeId-change re-fetches from clobbering a just-
  // saved chapter with a stale copy read back from OneDrive - Graph reads
  // right after a write aren't guaranteed immediately consistent, so a
  // poll landing in that window can overwrite fresh local content with the
  // old file for up to this many ms after our own successful save.
  const recentlySavedRef = useRef<{ id: number; until: number }>({ id: -1, until: 0 });
  const RECENT_SAVE_GUARD_MS = 20000;
  const [dragId, setDragId] = useState<number | null>(null);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [lockBusyMsg, setLockBusyMsg] = useState("");
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showVarsPanel, setShowVarsPanel] = useState(false);
  const previewGridView = false;
  const A4_USABLE_WIDTH_CM = 18.46; // 21cm - 1.27cm marginesy z każdej strony
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewPageCount, setPreviewPageCount] = useState<number | null>(null);
  const [paginationError, setPaginationError] = useState<string>("");
  // Which chapters are checked for "podgląd wydruku"/export. Defaults to
  // all-selected so behavior matches the previous always-everything
  // export; only truly NEW chapter ids get auto-added as selected, so a
  // user's manual unchecks survive the background 5s poll (which
  // recreates the chapters array with new object identities every tick).
  const [selectedForPrint, setSelectedForPrint] = useState<Set<number>>(new Set());
  const [chapterBackupFlags, setChapterBackupFlags] = useState<Record<number, boolean>>({});
  const [activeBackupLength, setActiveBackupLength] = useState<number | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const knownChapterIdsRef = useRef<Set<number>>(new Set());
  const chapterIdsKey = chapters.map((c) => c.id).sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!actor || deviceId === null) return;
    let cancelled = false;
    actor.getDeviceManualChapterBackupFlags(deviceId).then((rows: [number, boolean][]) => {
      if (cancelled) return;
      const map: Record<number, boolean> = {};
      for (const [id, en] of rows) map[id] = en;
      setChapterBackupFlags(map);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, deviceId, chapterIdsKey, showVarsPanel]);
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
  // Floating, draggable + resizable editor window (opens near-fullscreen
  // by default) - replaces the old fixed inset-0 fullscreen overlay so the
  // person can shrink/move it instead of always being locked to 100%.
  // Startuje tuż obok głównego lewego menu aplikacji (TopBar.tsx ustawia
  // document.body.style.paddingLeft na jego bieżącą szerokość - zwiniętą
  // lub rozwiniętą), więc nigdy go domyślnie nie zasłania.
  const getMainSidebarWidth = () => parseInt(document.body.style.paddingLeft || "64", 10) || 64;
  const computeDefaultEditWinRect = () => {
    const sidebarW = getMainSidebarWidth();
    const margin = 12;
    return {
      x: sidebarW + margin,
      y: margin,
      width: Math.max(400, window.innerWidth - sidebarW - margin * 2),
      height: Math.max(300, window.innerHeight - margin * 2),
    };
  };
  const [editWinRect, setEditWinRect] = useState(computeDefaultEditWinRect);
  const editDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onEditWinDragStart = (e: React.MouseEvent) => {
    editDragRef.current = { startX: e.clientX, startY: e.clientY, origX: editWinRect.x, origY: editWinRect.y };
    const onMove = (ev: MouseEvent) => {
      if (!editDragRef.current) return;
      const { startX, startY, origX, origY } = editDragRef.current;
      setEditWinRect((r) => {
        const minX = getMainSidebarWidth();
        const nx = Math.min(Math.max(minX, origX + (ev.clientX - startX)), window.innerWidth - 100);
        const ny = Math.min(Math.max(0, origY + (ev.clientY - startY)), window.innerHeight - 60);
        return { ...r, x: nx, y: ny };
      });
    };
    const onUp = () => {
      editDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const editResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const onEditWinResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    editResizeRef.current = { startX: e.clientX, startY: e.clientY, origW: editWinRect.width, origH: editWinRect.height };
    const onMove = (ev: MouseEvent) => {
      if (!editResizeRef.current) return;
      const { startX, startY, origW, origH } = editResizeRef.current;
      setEditWinRect((r) => ({
        ...r,
        width: Math.max(400, origW + (ev.clientX - startX)),
        height: Math.max(300, origH + (ev.clientY - startY)),
      }));
    };
    const onUp = () => {
      editResizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [hfWinRect, setHfWinRect] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth * 0.15)),
    y: Math.max(20, Math.round(window.innerHeight * 0.08)),
    width: Math.min(920, Math.round(window.innerWidth * 0.7)),
    height: Math.round(window.innerHeight * 0.8),
  }));
  const hfDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onHfWinDragStart = (e: React.MouseEvent) => {
    hfDragRef.current = { startX: e.clientX, startY: e.clientY, origX: hfWinRect.x, origY: hfWinRect.y };
    const onMove = (ev: MouseEvent) => {
      if (!hfDragRef.current) return;
      const { startX, startY, origX, origY } = hfDragRef.current;
      setHfWinRect((r) => {
        const nx = Math.min(Math.max(0, origX + (ev.clientX - startX)), window.innerWidth - 100);
        const ny = Math.min(Math.max(0, origY + (ev.clientY - startY)), window.innerHeight - 60);
        return { ...r, x: nx, y: ny };
      });
    };
    const onUp = () => {
      hfDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const hfResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const onHfWinResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    hfResizeRef.current = { startX: e.clientX, startY: e.clientY, origW: hfWinRect.width, origH: hfWinRect.height };
    const onMove = (ev: MouseEvent) => {
      if (!hfResizeRef.current) return;
      const { startX, startY, origW, origH } = hfResizeRef.current;
      setHfWinRect((r) => ({
        ...r,
        width: Math.max(420, origW + (ev.clientX - startX)),
        height: Math.max(320, origH + (ev.clientY - startY)),
      }));
    };
    const onUp = () => {
      hfResizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const { identity } = useAuthContext();
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [pollTicks, setPollTicks] = useState(0);
  const [pollError, setPollError] = useState<string>("");
  // Trzyma najświeższy HTML z Tiptap (edytor jest teraz komponentem
  // kontrolowanym z zewnątrz, nie ma już bezpośredniego DOM-u contentEditable
  // — saveChapter/eksport czytają stąd).
  const tiptapHtmlRef = useRef<string>("");
  const [tiptapRemountTick, setTiptapRemountTick] = useState(0);
  const savingRef = useRef(false);
  const commentAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actor) return;
    setDriveActor(actor);
    warmDriveToken();
    Promise.all([actor.listDevices(), actor.listDocFolders()]).then(([devRows, folderRows]: [any[], any[]]) => {
      const folderAsDevices = (folderRows || []).map((f: any) => ({
        id: 1000000000 + Number(f[0]),
        symbol: "📁 Folder",
        name: f[1],
        isFolder: true,
      }));
      const rows = [...devRows, ...folderAsDevices];
      setDevices(rows);
      if (rows.length && deviceId === null) setDeviceId(Number(rows[0].id));
    });
    actor.amIDocumentationEditor().then(setCanEdit).catch(() => setCanEdit(false));
    actor.listPrincipalDisplayNames().then((rows: any[]) => {
      const map: Record<string, string> = {};
      for (const [p, name] of rows) { map[p.toText()] = name; }
      setDisplayNames(map);
    }).catch(() => { /* not critical — falls back to raw principal text */ });
  }, [actor]);

  // Nagłówek/stopka są teraz per książka (nie globalne) — przeładuj przy
  // zmianie wybranej książki.
  useEffect(() => {
    if (!actor || activeBookId === null) return;
    actor.getBookHeaderFooterSettings(activeBookId).then((res: any) => {
      const s = res && res.length > 0 ? res[0] : null;
      const extras = loadHfExtras();
      if (s) {
        const loaded: HeaderFooterSettings = {
          headerText: s.headerText,
          footerText: s.footerText,
          logoDataUri: s.logoDataUri,
          skipFirstPage: s.skipFirstPage,
          showPageNumbers: s.showPageNumbers,
          ...extras,
        };
        setHfSettings(loaded);
      } else {
        setHfSettings((prev) => ({ ...prev, headerText: "", footerText: "Bartolini Air Simulation", logoDataUri: "", skipFirstPage: false, showPageNumbers: true, ...extras }));
      }
    }).catch(() => { /* fall back to defaults */ });
  }, [actor, activeBookId]);

  const fetchChapterContent = async (id: number): Promise<string> => {
    if (!showChainVersionRef.current) {
      try {
        const fromDrive = await loadChapterContentFromDrive(deviceLabel, id);
        if (fromDrive) return fromDrive;
      } catch { /* Drive niedostepny lub plik nie istnieje - fallback nizej */ }
    }
    const lenRes: any = await actor.getDeviceManualChapterContentLength(BigInt(id));
    const total = lenRes && lenRes.length ? Number(lenRes[0]) : 0;
    if (total === 0) return "";
    const CHUNK = 1_000_000;
    let result = "";
    for (let start = 0; start < total; start += CHUNK) {
      const chunkRes: any = await actor.getDeviceManualChapterContentChunk(BigInt(id), BigInt(start), BigInt(CHUNK));
      result += chunkRes && chunkRes.length ? chunkRes[0] : "";
    }
    return result;
  };

  const reload = async () => {
    if (deviceId === null) return;
    setLoading(true);
    const [rows, bookMap] = await Promise.all([
      actor.listDeviceManualChaptersMeta(deviceId),
      actor.getDeviceChapterBookMap(deviceId),
    ]);
    const bookMapObj: Record<number, number> = {};
    for (const [chId, bId] of bookMap) { bookMapObj[Number(chId)] = Number(bId); }
    setChapterBook(bookMapObj);
    setChapters((prev) => rows.map((r: any) => {
      const prevCh = prev.find((c) => c.id === Number(r.id));
      return { id: Number(r.id), title: r.title, contentHtml: prevCh ? prevCh.contentHtml : r.contentHtml, order: Number(r.order) };
    }));
    const mapped: Chapter[] = rows.map((r: any) => ({ id: Number(r.id), title: r.title, contentHtml: r.contentHtml, order: Number(r.order) }));
    const nextActive = mapped.find((c: any) => c.id === activeIdRef.current) ? activeIdRef.current : (mapped.length ? mapped[0].id : null);
    setActiveId(nextActive);
    if (nextActive !== null && bookMapObj[nextActive] !== undefined) {
      setExpandedBooks((prev) => new Set(prev).add(bookMapObj[nextActive]));
    }
    setLoading(false);
  };
  const silentReload = async () => {
    setPollTicks((n) => n + 1);
    if (deviceId === null) return;
    try {
      const [rows, bookMap] = await Promise.all([
        actor.listDeviceManualChaptersMeta(deviceId),
        actor.getDeviceChapterBookMap(deviceId),
      ]);
      const bookMapObj: Record<number, number> = {};
      for (const [chId, bId] of bookMap) { bookMapObj[Number(chId)] = Number(bId); }
      setChapterBook(bookMapObj);
      setChapters((prev) => rows.map((r: any) => {
        const prevCh = prev.find((c) => c.id === Number(r.id));
        return { id: Number(r.id), title: r.title, contentHtml: prevCh ? prevCh.contentHtml : r.contentHtml, order: Number(r.order) };
      }));
      const mapped = rows.map((r: any) => ({ id: Number(r.id), title: r.title, order: Number(r.order) }));
      const nextActive = mapped.find((c: any) => c.id === activeIdRef.current) ? activeIdRef.current : (mapped.length ? mapped[0].id : null);
      setActiveId(nextActive);
      if (nextActive !== null && !editMode && !(recentlySavedRef.current.id === nextActive && Date.now() < recentlySavedRef.current.until)) {
        const content = await fetchChapterContent(nextActive);
        setChapters((prev) => prev.map((c) => (c.id === nextActive ? { ...c, contentHtml: content } : c)));
      }
      setLastPolled(new Date());
      setPollError("");
    } catch (e: any) {
      setPollError(String(e?.message || e));
    }
    if (activeIdRef.current !== null && !editMode) {
      try {
        const lock = await actor.getEditLock(activeIdRef.current);
        setLockedBy(lock && lock.length > 0 ? lock[0].toText() : null);
      } catch { /* non-critical */ }
    }
  };
  const reloadBooks = async () => {
    if (deviceId === null || !actor) return;
    let rows: any[] = await actor.listBooks(deviceId);
    if (rows.length === 0) {
      await actor.ensureDefaultBook(deviceId);
      rows = await actor.listBooks(deviceId);
    }
    const mapped = rows.map((b: any) => ({ id: Number(b.id), title: b.title, order: Number(b.order) }));
    setBooks(mapped);
    if (mapped.length === 1) { setExpandedBooks(new Set([mapped[0].id])); }
  };
  useEffect(() => { reloadBooks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [actor, deviceId]);
  useEffect(() => { reload(); }, [actor, deviceId]);
  const selectedDevice = devices.find((d) => Number(d.id) === deviceId);
  const deviceLabel = selectedDevice ? `${selectedDevice.symbol} — ${selectedDevice.name}` : "";
  // Fetch full content on-demand when switching chapters (e.g. clicking
  // another chapter in the list) — chapters state only holds metadata
  // (title/order), contentHtml is loaded lazily per-chapter to avoid a
  // single oversized query call across a large documentation set.
  useEffect(() => {
    if (!actor || activeId === null || !deviceLabel) return;
    if (recentlySavedRef.current.id === activeId && Date.now() < recentlySavedRef.current.until) return;
    let cancelled = false;
    setLoadingChapterContent(true);
    fetchChapterContent(activeId).then((content) => {
      if (cancelled) return;
      setChapters((prev) => prev.map((c) => (c.id === activeId ? { ...c, contentHtml: content } : c)));
      setLoadingChapterContent(false);
    });
    return () => { cancelled = true; };
  }, [activeId, actor, deviceLabel]);
  // Re-fetch when the operator toggles "pokaż kopię z kanistra" so the
  // editor/preview reflects the newly-chosen source without switching
  // chapters.
  useEffect(() => {
    if (!actor || activeId === null || !deviceLabel) return;
    let cancelled = false;
    setLoadingChapterContent(true);
    fetchChapterContent(activeId).then((content) => {
      if (cancelled) return;
      setChapters((prev) => prev.map((c) => (c.id === activeId ? { ...c, contentHtml: content } : c)));
      setLoadingChapterContent(false);
    });
    return () => { cancelled = true; };
  }, [showChainVersion]);
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
        setEditWinRect(computeDefaultEditWinRect());
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
  const exitEditMode = async () => {
    if (dirty) {
      try { await saveChapter(true); } catch { /* saveChapter already surfaces its own error */ }
    }
    setEditMode(false);
    tiptapHtmlRef.current = "";
    if (activeId !== null) {
      actor.releaseEditLock(activeId).catch(() => {});
    }
  };
  // Switching the sidebar's active chapter remounts the Tiptap editor on
  // a new key - any not-yet-saved edits in tiptapHtmlRef would just be
  // discarded with no flush at all if we called setActiveId directly
  // while still editing. Route every chapter switch through here so it
  // behaves the same as clicking "Edytuj" to exit (flush, then switch).
  const switchActiveChapter = async (id: number) => {
    if (id === activeId) return;
    if (editMode && dirty) {
      try { await saveChapter(true); } catch { /* saveChapter already surfaces its own error */ }
    }
    if (editMode) {
      setEditMode(false);
      tiptapHtmlRef.current = "";
      if (activeId !== null) actor.releaseEditLock(activeId).catch(() => {});
    }
    setActiveId(id);
  };
  const [lockStolenBy, setLockStolenBy] = useState<string | null>(null);
  useEffect(() => {
    if (!editMode || activeId === null) return;
    setLockStolenBy(null);
    const myPrincipal = identity?.getPrincipal().toText();
    if (!myPrincipal) return;
    const check = () => {
      actor.heartbeatEditLock(activeId).catch(() => {});
      // Bezpiecznik na przypadek znaleziony w audycie: gdyby nasza blokada
      // wygasła (np. przez przerwę w sieci) i ktoś inny ją przejął, chcemy
      // to widzieć od razu zamiast po cichu dalej "edytować" i nadpisać
      // czyjeś zmiany przy kolejnym zapisie. Nazwa z listy z modułu admin
      // (listPrincipalDisplayNames), tak samo jak przy próbie wejścia
      // w edycję zajętego rozdziału. WYŁĄCZNIE informacyjne - nie blokuje
      // autozapisu (zrobienie tego wcześniej okazało się zbyt ryzykowne:
      // fałszywe wykrycie potrafiło całkowicie wyłączyć zapisywanie).
      actor.getEditLock(activeId).then((lock: any) => {
        const holderText = lock && lock.length > 0 ? lock[0].toText() : "";
        if (holderText && holderText !== myPrincipal) {
          setLockStolenBy(displayNames[holderText] || holderText);
        } else {
          setLockStolenBy(null);
        }
      }).catch(() => {});
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const h1Offset = activeIndex >= 0 ? h1OffsetBefore(chapters, activeIndex) : 0;

  useEffect(() => {
    if (!actor || !active) { setActiveBackupLength(null); return; }
    let cancelled = false;
    actor.getDeviceManualChapterContentLength(active.id).then((res: any) => {
      if (cancelled) return;
      setActiveBackupLength(res && res.length ? Number(res[0]) : 0);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, active && active.id, chapterBackupFlags[active ? active.id : -1]]);

  const createOrUpdateActiveBackup = async () => {
    if (!active) return;
    setBackupBusy(true);
    try {
      let full = "";
      try { full = await loadChapterContentFromDrive(deviceLabel, active.id); } catch { /* Drive niedostępny */ }
      if (!full) { alert("Nie udało się pobrać treści z OneDrive."); return; }
      if (!chapterBackupFlags[active.id]) {
        await actor.setChapterBackupEnabled(active.id, true);
        setChapterBackupFlags((m) => ({ ...m, [active.id]: true }));
      }
      await actor.saveChapterBackup(active.id, full);
      const res: any = await actor.getDeviceManualChapterContentLength(active.id);
      setActiveBackupLength(res && res.length ? Number(res[0]) : 0);
    } finally {
      setBackupBusy(false);
    }
  };
  const requestRemoveBackup = () => {
    if (!active) return;
    setRemoveBackupConfirm(true);
    setRemoveBackupConfirmText("");
  };
  const confirmRemoveBackup = async () => {
    if (!active || removeBackupConfirmText !== "DELETE") return;
    await actor.setChapterBackupEnabled(active.id, false);
    setChapterBackupFlags((m) => ({ ...m, [active.id]: false }));
    setActiveBackupLength(0);
    setRemoveBackupConfirm(false);
  };

  useEffect(() => {
    setEditMode(false);
    setDirty(false);
    tiptapHtmlRef.current = "";
  }, [activeId]);
  const addChapter = async (targetBookId: number) => {
    const title = (newChapterTitles[targetBookId] || "").trim();
    if (!title || deviceId === null) return;
    const newId = await actor.createDeviceManualChapter(deviceId, title, targetBookId);
    setNewChapterTitles((m) => ({ ...m, [targetBookId]: "" }));
    await reload();
    setActiveId(Number(newId));
  };

  const addBook = async () => {
    if (deviceId === null) return;
    const name = prompt("Nazwa nowej książki:");
    if (!name || !name.trim()) return;
    const newId = await actor.addBook(deviceId, name.trim());
    await reloadBooks();
    setExpandedBooks((prev) => new Set(prev).add(Number(newId)));
  };

  const renameBookById = async (book: { id: number; title: string }) => {
    const name = prompt("Nowa nazwa książki:", book.title);
    if (!name || !name.trim()) return;
    await actor.renameBook(book.id, name.trim());
    await reloadBooks();
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
    // Metadata-only write (title/order/timestamp) — never sends contentHtml
    // over ingress, which for large chapters (content now lives on Drive)
    // exceeds the IC message size limit and silently fails.
    await actor.updateDeviceManualChapterMeta(ch.id, title, "");
    reload();
    try {
      await renameChapterOnDrive(deviceLabel, ch.id, ch.order, title);
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

  const hfSettingsBeforeEditRef = useRef<HeaderFooterSettings | null>(null);
  const openSettings = () => {
    hfSettingsBeforeEditRef.current = hfSettings;
    setHfDraft(hfSettings);
    setShowSettings(true);
  };
  // Nagłówek/stopka mają się odświeżać na żywo w edytorze w trakcie
  // zmieniania ustawień w modalu, nie dopiero po kliknięciu "Zapisz" -
  // odzwierciedlamy draft na bieżąco w hfSettings (które napędza edytor
  // przez propsy); rzeczywisty zapis do kanistra nadal następuje tylko
  // w saveSettings().
  useEffect(() => {
    if (showSettings) setHfSettings(hfDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, hfDraft]);
  const closeSettingsWithoutSaving = () => {
    if (hfSettingsBeforeEditRef.current) setHfSettings(hfSettingsBeforeEditRef.current);
    setShowSettings(false);
  };

  const saveSettings = async () => {
    if (activeBookId === null) return;
    // Odświeżenie widoku (hfSettings napędza propsy edytora) następuje
    // OD RAZU, zanim skończy się wywołanie do kanistra (IC potrafi
    // odpowiadać z zauważalnym opóźnieniem) - wcześniej czekało na "await",
    // przez co po kliknięciu "Zapisz" wyglądało jakby nic się nie stało.
    setHfSettings(hfDraft);
    saveHfExtras(hfDraft);
    hfSettingsBeforeEditRef.current = hfDraft;
    setShowSettings(false);
    try {
      await actor.setBookHeaderFooterSettings(
        activeBookId,
        hfDraft.headerText,
        hfDraft.footerText,
        hfDraft.logoDataUri,
        hfDraft.skipFirstPage,
        hfDraft.showPageNumbers,
      );
    } catch (e: any) {
      alert("Błąd zapisu ustawień na serwerze (zmiana została zastosowana lokalnie, ale nie zapisana): " + (e?.message || String(e)));
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

  // Plain <table><tr><td> with inline border styles (not an external
  // stylesheet class) — this way the table survives verbatim through
  // every export path (Word HTML import, print preview, PDF/print)
  // without any special mso-tricks, since inline styles always carry
  // through DOM/innerHTML round-trips unchanged.
  const saveChapter = async (silent = false) => {
    if (!active) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
    // Strip the live-preview data-num attributes before persisting —
    // Tiptap's HeadingNumbering extension writes them as real node
    // attributes for live display, but they're recomputed fresh on every
    // load, so saved content should stay clean of them.
    const html = (tiptapHtmlRef.current || active.contentHtml || "").replace(/\s*data-num="[^"]*"/g, "");
    try {
      await syncChapterToDrive(deviceLabel, active.id, active.order, active.title, html);
    } catch (e: any) {
      setDriveSyncError("Nie udalo sie zapisac na Bartolini Drive: " + (e?.message || String(e)));
      setTimeout(() => setDriveSyncError(""), 5000);
      return;
    }
    await actor.updateDeviceManualChapterMeta(active.id, active.title, "");
    // Only clear `dirty` if nothing changed WHILE this save was in flight -
    // syncChapterToDrive is several sequential network round-trips, so if
    // the person kept typing during it, `html` here is already stale and
    // clearing dirty would silently drop those newer keystrokes (next
    // autosave tick would then see dirty=false and never send them).
    // Compare both sides WITHOUT data-num - tiptapHtmlRef.current still has
    // it (HeadingNumbering writes it live for on-screen display), `html`
    // had it stripped above, so comparing them directly never matched for
    // any document containing a heading - dirty was getting stuck true
    // forever even though the save itself succeeded every time.
    const currentStripped = (tiptapHtmlRef.current || "").replace(/\s*data-num="[^"]*"/g, "");
    if (currentStripped === html || !tiptapHtmlRef.current) setDirty(false);
    recentlySavedRef.current = { id: active.id, until: Date.now() + RECENT_SAVE_GUARD_MS };
    setChapters((prev) => prev.map((c) => (c.id === active.id ? { ...c, contentHtml: html } : c)));
    setLastSavedAt(new Date());
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
    if (!silent) {
      setDriveSyncFlash(true);
      setTimeout(() => setDriveSyncFlash(false), 1500);
    }
    } finally {
      savingRef.current = false;
    }
  };

  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // "Odśwież i zapisz": najpierw flushuje bieżące zmiany (jak zwykły
  // zapis), potem pobiera treść na nowo z OneDrive i remontuje edytor -
  // przydatne żeby ręcznie potwierdzić że to co widać zgadza się z tym co
  // faktycznie zostało zapisane (round-trip), zamiast ufać samemu stanowi
  // w pamięci przeglądarki.
  const [refreshingAndSaving, setRefreshingAndSaving] = useState(false);
  const refreshAndSave = async () => {
    if (!active || refreshingAndSaving) return;
    setRefreshingAndSaving(true);
    try {
    if (dirtyRef.current) {
      try { await saveChapter(true); } catch { /* saveChapter already surfaces its own error */ }
    }
    // OneDrive/Graph nie gwarantuje odczytu-zaraz-po-zapisie (ta sama
    // przyczyna co RECENT_SAVE_GUARD_MS przy silentReload) - krótki bufor
    // zmniejsza ryzyko, że ten "odśwież" pokaże starszą wersję niż to, co
    // właśnie zapisano.
    await new Promise((r) => setTimeout(r, 1500));
    const content = await fetchChapterContent(active.id);
    setChapters((prev) => prev.map((c) => (c.id === active.id ? { ...c, contentHtml: content } : c)));
    tiptapHtmlRef.current = "";
    setDirty(false);
    setTiptapRemountTick((t) => t + 1);
    } finally {
      setRefreshingAndSaving(false);
    }
  };

  // Auto-save: retries every 3s while dirty + enabled + edit mode on, not
  // just once on the dirty:false->true transition - a single failed save
  // (e.g. transient OneDrive/token error) used to leave `dirty` stuck true
  // forever with no further retry scheduled, silently losing edits.
  useEffect(() => {
    if (!autoSave || !editMode) return;
    const interval = window.setInterval(() => {
      if (dirtyRef.current && !savingRef.current) saveChapter(true);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [autoSave, editMode]);

  const getChaptersForExport = async (): Promise<Chapter[]> => {
    const liveHtml = active && tiptapHtmlRef.current ? tiptapHtmlRef.current.replace(/\s*data-num="[^"]*"/g, "") : null;
    let merged = chapters.map((c) => (active && liveHtml !== null && c.id === active.id ? { ...c, contentHtml: liveHtml } : c));
    const missing = merged.filter((c) => selectedForPrint.has(c.id) && !c.contentHtml);
    if (missing.length > 0) {
      const fetched = await Promise.all(missing.map((c) => fetchChapterContent(c.id)));
      merged = merged.map((c) => {
        const idx = missing.findIndex((m) => m.id === c.id);
        return idx >= 0 ? { ...c, contentHtml: fetched[idx] } : c;
      });
      setChapters(merged);
    }
    return merged;
  };

  const exportWord = async () => {
    try {
      const selected = chapters.filter((c) => selectedForPrint.has(c.id));
      if (selected.length === 0) { alert("Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej)."); return; }
      const html = await buildWordExportHtml(deviceLabel, await getChaptersForExport(), hfSettings, selectedForPrint);
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
  const buildChapterPreviewHtml = async (forPrint: boolean = false, gridView: boolean = false, selectedOverride?: Set<number>, chaptersOverride?: Chapter[], previewToken?: string): Promise<string> => {
    const selectedSet = selectedOverride || selectedForPrint;
    const selected = chapters.filter((c) => selectedSet.has(c.id));
    if (selected.length === 0) {
      return `<html><body style="font-family:Arial,sans-serif;padding:24px;color:#888;">
        Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej), żeby zobaczyć podgląd wydruku.
      </body></html>`;
    }
    const nl2br = (t: string) => t.replace(/\n/g, "<br>");
    const headerOddLeft = nl2br(hfSettings.headerText.trim());
    const headerOddCenter = nl2br(hfSettings.headerTextCenter.trim());
    const headerOddRight = nl2br(hfSettings.headerTextRight.trim());
    const headerEvenLeft = nl2br(hfSettings.headerTextEvenLeft.trim()) || headerOddLeft;
    const headerEvenCenter = nl2br(hfSettings.headerTextEvenCenter.trim()) || headerOddCenter;
    const headerEvenRight = nl2br(hfSettings.headerTextEvenRight.trim()) || headerOddRight;
    const footerHtml = hfSettings.footerText.trim() || "Bartolini Air Simulation";
    const footerLeftHtml = hfSettings.footerTextLeft.trim();
    const footerRightHtml = hfSettings.footerTextRight.trim();
    // chaptersOverride: caller already has fully-loaded chapter content in
    // hand (e.g. the single currently-active chapter in the read view) and
    // wants to skip getChaptersForExport()'s async "fetch missing content
    // from Drive" step entirely — that step is only needed for multi-
    // chapter export/print where some chapters may never have been opened.
    const numbered = numberHeadingsForExport(chaptersOverride || (await getChaptersForExport()), selectedSet);
    const body = numbered.map((n) => n.html).join(`<div class="${PAGE_BREAK_CLASS}"></div>`);
    // A4 usable content box in mm (must match .page-header/.page-footer
    // heights below): width 210 - 2*1.27cm margins, height 297 - header
    // (3.75cm) - footer (1.27cm).
    const CONTENT_W_MM = A4_USABLE_WIDTH_CM * 10;
    const headerHeightMm = hfSettings.headerHeightCm * 10;
    const footerHeightMm = hfSettings.footerHeightCm * 10;
    const CONTENT_H_MM = 297 - headerHeightMm - footerHeightMm;
    const MM_TO_PX = 96 / 25.4;
    const contentWidthPx = Math.round(CONTENT_W_MM * MM_TO_PX);
    // Live editor's .ProseMirror IS the sheet itself (794px = 210mm) with
    // padding:48px (=1.27cm) left/right and no further inner padding layer -
    // no separate "p-8" wrapper exists post-Tiptap-migration. Preview/PDF
    // must use the exact same usable width/height or text wraps differently
    // and pagination diverges from what the editor shows.
    const innerContentWidthPx = contentWidthPx;
    // Preview is a standalone iframe (no access to the app's own
    // stylesheet); docContentCss(".page-content") below supplies the same
    // font/table/list/comment rules the live editor uses under
    // "#doc-editor-content" (see lib/docContentStyle.ts), plus light-theme
    // fallback values for the CSS vars it references.
    const contentHeightPx = Math.round(CONTENT_H_MM * MM_TO_PX);
    return `<html><head><meta charset="utf-8"/><title>Podgląd wydruku</title>
      <style>
        @page { size: A4; margin: 0; }
        body{font-family:Arial,sans-serif;padding:0;margin:0;background:#888;}
        .sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;box-shadow:0 0 8px rgba(0,0,0,0.4);box-sizing:border-box;padding:${hfSettings.headerHeightCm}cm 1.27cm ${hfSettings.footerHeightCm}cm 1.27cm;position:relative;}
        #pages.pages-grid{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:center;gap:16px;}
        #pages.pages-grid .sheet{margin:0;}
        .page-header{position:absolute;top:0;left:1.27cm;right:1.27cm;height:${hfSettings.headerHeightCm}cm;box-sizing:border-box;padding:6px 0;font-size:${hfSettings.headerFontSize}pt;color:#555;${hfSettings.headerBorder ? "border-bottom:1px solid #ccc;" : ""}display:flex;align-items:flex-end;justify-content:space-between;}
        .page-header>span{flex:1;}
        .page-header>span:nth-child(2){text-align:center;}
        .page-header>span:nth-child(3){text-align:right;}
        .page-footer{position:absolute;left:1.27cm;right:1.27cm;bottom:0;height:${hfSettings.footerHeightCm}cm;box-sizing:border-box;padding:6px 0;font-size:${hfSettings.footerFontSize}pt;color:#555;${hfSettings.footerBorder ? "border-top:1px solid #ccc;" : ""}display:flex;align-items:center;justify-content:space-between;}
        .page-content{padding:0;box-sizing:border-box;max-width:900px;margin:0 auto;--text-secondary:#5c574d;--bg-hover:#efece3;}
        .page-number{position:absolute;left:1.27cm;right:1.27cm;bottom:6px;font-size:8pt;color:#999;text-align:center;}
        .${PAGE_BREAK_CLASS}{page-break-before:always;border:none;}
        ${forPrint ? "@page{size:A4;margin:0;} body{background:#fff;} .sheet{box-shadow:none;margin:0;} .sheet + .sheet{page-break-before:always;} .page-number{display:none;}" : ""}
        img{max-width:100%;}
        #measure{position:absolute;left:-99999px;top:0;width:${innerContentWidthPx}px;padding:0;max-width:none;visibility:hidden;--text-secondary:#5c574d;--bg-hover:#efece3;}
        ${docContentCss(".page-content")}
      </style>
      </head><body>
      <div id="measure" class="page-content">${body}</div>
      <div id="pages" class="${gridView ? "pages-grid" : ""}"></div>
      <script>
      (function(){
        // Small safety buffer (print mode only): without it, a page whose
        // JS-measured height lands within a fraction of a mm of the true
        // 297mm boundary can render a hair taller during Puppeteer's actual
        // print pass (sub-pixel/font-hinting rounding differs from the
        // screen measurement pass) - Chrome's print engine then silently
        // inserts an extra physical page instead of respecting the single
        // .sheet box. A few px of headroom prevents that ghost page.
        var __TOKEN__ = ${JSON.stringify(previewToken || null)};
        var PAGE_H = ${contentHeightPx};
        var measure = document.getElementById('measure');
        var pagesEl = document.getElementById('pages');
        var headerOddLeft = ${JSON.stringify(headerOddLeft)};
        var headerOddCenter = ${JSON.stringify(headerOddCenter)};
        var headerOddRight = ${JSON.stringify(headerOddRight)};
        var headerEvenLeft = ${JSON.stringify(headerEvenLeft)};
        var headerEvenCenter = ${JSON.stringify(headerEvenCenter)};
        var headerEvenRight = ${JSON.stringify(headerEvenRight)};
        var footerHtml = ${JSON.stringify(footerHtml)};
        var footerLeftHtml = ${JSON.stringify(footerLeftHtml)};
        var footerRightHtml = ${JSON.stringify(footerRightHtml)};
        var skipFirst = ${hfSettings.skipFirstPage ? "true" : "false"};
        var enableHeader = ${hfSettings.enableHeader ? "true" : "false"};
        var enableFooter = ${hfSettings.enableFooter ? "true" : "false"};
        var MIN_LEAD = 60; // px - avoid a lone heading stranded at page bottom

        function hoistToTop(node, container){
          while (node.parentNode !== container) {
            var parent = node.parentNode;
            var grandparent = parent.parentNode;
            var afterClone = parent.cloneNode(false);
            var sib = node.nextSibling;
            while (sib) { var next = sib.nextSibling; afterClone.appendChild(sib); sib = next; }
            grandparent.insertBefore(node, parent.nextSibling);
            if (afterClone.childNodes.length) grandparent.insertBefore(afterClone, node.nextSibling);
          }
        }
        function hoistPageBreaks(container){
          var markers = Array.prototype.slice.call(container.querySelectorAll('.${PAGE_BREAK_CLASS}'));
          markers.forEach(function(marker){ hoistToTop(marker, container); });
        }
        function paginate(){
          try {
            paginateInner();
          } catch (e) {
            // Cokolwiek poszlo nie tak w mierzeniu/paginacji - pokaz cala
            // tresc jako jedna nieformatowana "strone" zamiast pustego ekranu.
            pagesEl.innerHTML = '<div class="sheet"><div class="page-content">' + (measure ? measure.innerHTML : '') + '</div></div>';
            try { if (measure && measure.parentNode) measure.remove(); } catch (e2) {}
            try { parent.postMessage({ type: 'docPreviewPageCount', count: 1, error: String(e && e.message || e), token: __TOKEN__ }, '*'); } catch (e3) {}
          }
        }
        function paginateInner(){
          hoistPageBreaks(measure);
          function collectUnits(el){
            if (el.classList && el.classList.contains('${PAGE_BREAK_CLASS}')) return [el];
            var h = el.getBoundingClientRect().height;
            if (h <= PAGE_H || el.children.length === 0) return [el];
            var units = [];
            Array.prototype.slice.call(el.children).forEach(function(k){
              units = units.concat(collectUnits(k));
            });
            return units.length ? units : [el];
          }
          var units = [];
          Array.prototype.slice.call(measure.children).forEach(function(el){
            units = units.concat(collectUnits(el));
          });
          var pages = [];
          var current = [];
          var currentH = 0;
          function flush(){
            if (current.length) pages.push(current.map(function(el){ return el.outerHTML; }).join(''));
            current = []; currentH = 0;
          }
          units.forEach(function(el){
            if (el.classList && el.classList.contains('${PAGE_BREAK_CLASS}')) { flush(); return; }
            var h = el.getBoundingClientRect().height;
            var isHeading = /^H[1-4]$/.test(el.tagName);
            if (currentH > 0 && currentH + h > PAGE_H) {
              flush();
            } else if (isHeading && currentH > 0 && (PAGE_H - currentH) < (h + MIN_LEAD)) {
              flush();
            }
            current.push(el);
            currentH += h;
          });
          flush();
          if (pages.length === 0) pages = [''];
          pagesEl.innerHTML = pages.map(function(html, i){
            var isFirst = i === 0;
            var isOdd = (i + 1) % 2 === 1;
            var hideThisPage = isFirst && skipFirst;
            var showHeader = enableHeader && !hideThisPage;
            var showFooter = enableFooter && !hideThisPage;
            var thisHeaderHtml = '<span>' + (isOdd ? headerOddLeft : headerEvenLeft) + '</span><span>' + (isOdd ? headerOddCenter : headerEvenCenter) + '</span><span>' + (isOdd ? headerOddRight : headerEvenRight) + '</span>';
            var footerRowHtml = '<span>' + footerLeftHtml + '</span><span>' + footerHtml + '</span><span>' + footerRightHtml + '</span>';
            return '<div class="sheet">' +
              (showHeader ? '<div class="page-header">' + thisHeaderHtml + '</div>' : '') +
              '<div class="page-content">' + html + '</div>' +
              (showFooter ? '<div class="page-footer">' + footerRowHtml + '</div>' : '') +
              '<div class="page-number">Strona ' + (i + 1) + ' / ' + pages.length + '</div>' +
            '</div>';
          }).join('');
          measure.remove();
          // Okno ladowania miало znikac dopiero gdy tresc FAKTYCZNIE widac -
          // obrazki w pagesEl sa wstawiane od nowa (outerHTML -> innerHTML),
          // wiec przegladarka dekoduje je ponownie; bez tego czekania
          // postMessage("ready") szedl natychmiast, znikal spinner, a
          // strona jeszcze kilka sekund donaladowywala obrazki na oczach
          // uzytkownika.
          function notifyReady(){
            try { parent.postMessage({ type: 'docPreviewPageCount', count: pages.length, token: __TOKEN__ }, '*'); } catch (e) {}
          }
          var finalImgs = Array.prototype.slice.call(pagesEl.querySelectorAll('img'));
          if (finalImgs.length === 0) {
            requestAnimationFrame(notifyReady);
          } else {
            var remaining2 = finalImgs.length;
            finalImgs.forEach(function(img){
              if (img.complete) { remaining2--; if (remaining2 === 0) requestAnimationFrame(notifyReady); }
              else { img.onload = img.onerror = function(){ remaining2--; if (remaining2 === 0) requestAnimationFrame(notifyReady); }; }
            });
          }
        }

        function waitImagesThenPaginate(){
          var imgs = Array.prototype.slice.call(measure.querySelectorAll('img'));
          if (imgs.length === 0) { requestAnimationFrame(paginate); return; }
          var remaining = imgs.length;
          imgs.forEach(function(img){
            if (img.complete) { remaining--; if (remaining === 0) requestAnimationFrame(paginate); }
            else { img.onload = img.onerror = function(){ remaining--; if (remaining === 0) requestAnimationFrame(paginate); }; }
          });
        }
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(waitImagesThenPaginate);
        } else {
          waitImagesThenPaginate();
        }
      })();
      </script>
      </body></html>`;
  };
  const openPrintPreview = async () => {
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml(false, previewGridView, editMode && active ? new Set([active.id]) : undefined));
    setShowPrintPreview(true);
  };
  const refreshPrintPreview = async () => {
    setPreviewPageCount(null);
    setPreviewHtml(await buildChapterPreviewHtml(false, previewGridView, editMode && active ? new Set([active.id]) : undefined));
  };
  // Real, JS-measured live "2 pages side by side" view - reuses the exact
  // same pagination engine as Podgląd wydruku/eksport (accurate margins,
  // header/footer per page, hard A4 page boundaries), refreshed with a
  // short debounce while typing. Read-only (typing still happens in the
  // single contentEditable box above) - real per-page splitting across a
  // live contentEditable region is not feasible without risking caret/undo
  // breakage, so this renders alongside it instead of replacing it.
  // Tryb bez edycji ("Edytuj" nieaktywne): zamiast surowego, ciągłego
  // contentEditable z nakładkowym nagłówkiem/stopką (przybliżenie, które
  // nachodzi na treść na 2+ stronie), pokazujemy dokładnie ten sam,
  // realnie spaginowany HTML co w "Podgląd wydruku"/"2 strony".
  const [readViewHtml, setReadViewHtml] = useState("");
  const [readViewLoading, setReadViewLoading] = useState(false);
  const [readViewReady, setReadViewReady] = useState(false);
  const readViewIframeRef = useRef<HTMLIFrameElement>(null);
  // Ten sam <iframe> (ten sam DOM-element, to samo contentWindow) jest
  // wielokrotnie ponownie ladowany (nowy srcDoc) przy kazdej zmianie
  // rozdzialu/showChainVersion - samo sprawdzenie "e.source === iframe"
  // nie odroznia spoznionej wiadomosci z POPRZEDNIEGO zaladowania od
  // biezacego. Token generacji odrzuca spoznione wiadomosci ze starej
  // tresci, ktore inaczej przedwczesnie chowaly okno ladowania (ukazujac
  // na chwile pusta/nieukonczona strone, zanim realna tresc dojdzie).
  const readViewTokenRef = useRef<string | null>(null);
  // Token trzymany tez w stanie i uzyty jako React "key" na iframe: jesli
  // po powrocie z edycji swiezo zbudowany HTML wyjdzie BAJT W BAJT taki
  // sam jak poprzedni (np. wejscie w edycje i wyjscie bez zadnej zmiany),
  // samo ustawienie tego samego stringa w srcDoc NIC nie robi - przegladarka
  // nie przeladowuje iframe, wiec jego skrypt nigdy ponownie nie wysyla
  // postMessage("ready") i okno ladowania kreci sie w nieskonczonosc. Zmiana
  // "key" wymusza pelny remount iframe (a wiec i realny reload) za kazdym
  // razem, niezaleznie od tego czy tresc faktycznie sie zmienila.
  const [readViewToken, setReadViewToken] = useState<string | null>(null);
  // Inne podejście niż poprzednio: w tle NIGDY nie podmieniamy automatycznie
  // wyświetlanej treści (to właśnie powodowało, że okno podglądu potrafiło
  // zniknąć - remount iframe/spinner w trakcie cichego odpytywania - i nie
  // wracało). Zamiast tego cichy timer tylko WYKRYWA, że na Dysku jest
  // nowsza wersja i pokazuje nieinwazyjny banner; realny przeładunek treści
  // (z tym samym, sprawdzonym mechanizmem tokenu/spinnera co przy zmianie
  // rozdziału) następuje dopiero po kliknięciu przez operatora.
  const [newerVersionAvailable, setNewerVersionAvailable] = useState(false);
  const pendingNewerContentRef = useRef<string>("");
  useEffect(() => {
    setNewerVersionAvailable(false);
    pendingNewerContentRef.current = "";
    if (editMode || !active || !deviceLabel) return;
    const chapterId = active.id;
    const interval = window.setInterval(async () => {
      if (editMode) return;
      if (recentlySavedRef.current.id === chapterId && Date.now() < recentlySavedRef.current.until) return;
      try {
        const content = await fetchChapterContent(chapterId);
        // Porownanie z NAJSWIEZSZYM stanem (funkcyjny setChapters), nie z
        // "active" zamknietym w domknieciu tego efektu - to domkniecie bylo
        // nieaktualne (puste/stare contentHtml sprzed dociagniecia z Drive
        // przy pierwszym wejsciu w rozdzial), co falszywie pokazywalo baner
        // "nowsza wersja" od razu po otwarciu.
        if (!content) return;
        setChapters((prev) => {
          const cur = prev.find((c) => c.id === chapterId);
          if (cur && cur.contentHtml !== content) {
            pendingNewerContentRef.current = content;
            setNewerVersionAvailable(true);
          }
          return prev;
        });
      } catch { /* kolejna proba za 5s */ }
    }, 5000);
    return () => window.clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, active?.id, deviceLabel]);
  const applyNewerVersion = () => {
    if (!active || !pendingNewerContentRef.current) return;
    const content = pendingNewerContentRef.current;
    setChapters((prev) => prev.map((c) => (c.id === active.id ? { ...c, contentHtml: content } : c)));
    setNewerVersionAvailable(false);
    pendingNewerContentRef.current = "";
  };
  useEffect(() => {
    if (editMode) return;
    if (!active) { setReadViewHtml(""); return; }
    // Zanim tresc rozdzialu faktycznie doszla z Drive (fetchChapterContent w
    // osobnym efekcie po zmianie activeId), active.contentHtml bywa jeszcze
    // puste/nieaktualne - budowanie podgladu z tego dawalo widoczna PUSTA
    // kartke A4 juz po ~0.5s (bo pusta tresc paginuje sie natychmiast), a
    // prawdziwy tekst podmienial ja dopiero kilka sekund pozniej, gdy Drive
    // odpowie. Trzymaj spinner az contentHtml bedzie realnie zaladowane.
    if (loadingChapterContent) {
      setReadViewLoading(true);
      setReadViewReady(false);
      return;
    }
    let cancelled = false;
    setReadViewLoading(true);
    setReadViewReady(false);
    // Token dopiero PO zbudowaniu html - zmiana key+srcDoc w jednym kroku,
    // zamiast najpierw remontowac iframe ze STARA tresc (pod nowym key) a
    // dopiero potem podmieniac srcDoc. To pierwsze, zbedne przeladowanie
    // odpalalo dodatkowe onLoad na nieaktualnej tresci i mogło sprawiac
    // wrazenie "nie odswieza sie po wyjsciu z edycji".
    (async () => {
      const token = `${active.id}-${Date.now()}-${Math.random()}`;
      try {
        // gridView=false (nie true) - dokladnie to samo ulozenie co
        // "Podglad wydruku" (dziala poprawnie: osobne kartki A4 jedna pod
        // druga). Z gridView=true (flex-wrap) strony renderowaly sie jako
        // jeden ciagly, nieprzelamany scroll zamiast oddzielnych kartek.
        const html = await buildChapterPreviewHtml(false, false, new Set([active.id]), [active], token);
        if (!cancelled) {
          readViewTokenRef.current = token;
          setReadViewToken(token);
          setReadViewHtml(html);
        }
      } catch (err: any) {
        if (!cancelled) {
          readViewTokenRef.current = token;
          setReadViewToken(token);
          setReadViewReady(true);
          setPaginationError("Podgląd nie odświeżył się: " + (err?.message || String(err)));
        }
      } finally {
        if (!cancelled) setReadViewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, active?.id, active?.contentHtml, loadingChapterContent, hfSettings]);
  // Gotowość podglądu sterowana natywnym zdarzeniem onLoad iframe zamiast
  // postMessage+token - przeglądarka GWARANTUJE że load/error zawsze się
  // odpali dla aktualnej nawigacji tego konkretnego elementu, więc znika
  // cała klasa błędów "wiadomość nie doszła / doszła za późno / z innego
  // iframe" (poprzednie podejście z 8s failsafe tylko maskowało to, że
  // "ready" w ogóle nie przychodziło). docPreviewPageCount zostaje
  // wyłącznie do liczby stron / komunikatu błędu paginacji, nie do
  // odblokowania spinnera.
  // Gotowość podglądu: samo natywne onLoad odpalało się ZA WCZEŚNIE (po
  // ~0.5s) - to moment gdy przeglądarka skończy parsować początkowy
  // dokument, a wewnętrzny skrypt paginacji (fonts.ready + doczytanie
  // obrazków w #measure) jeszcze wtedy pracuje w tle, więc okno ładowania
  // znikało pokazując pusty/nieukończony #pages. Zamiast ufać samemu
  // onLoad, po nim odpytujemy DOM iframe'a (srcDoc = ten sam origin, więc
  // to bezpieczne, bez postMessage) aż div #pages faktycznie ma
  // wyrenderowane strony - dokładnie ten sam moment co paginateInner()
  // realnie wypełnia go treścią (linia z "pagesEl.innerHTML = ...").
  const handleReadViewIframeLoad = () => {
    const iframeEl = readViewIframeRef.current;
    if (!iframeEl) { setReadViewReady(true); return; }
    const startToken = readViewTokenRef.current;
    let tries = 0;
    const check = () => {
      if (readViewTokenRef.current !== startToken) return; // w miedzyczasie zaladowano juz kolejny rozdzial
      tries++;
      let ready = true;
      try {
        const doc = iframeEl.contentDocument;
        const pagesDiv = doc ? doc.getElementById("pages") : null;
        if (pagesDiv) ready = pagesDiv.children.length > 0;
      } catch { /* niedostepny DOM - pokaz mimo to */ }
      if (ready || tries >= 40) {
        setReadViewReady(true);
      } else {
        window.setTimeout(check, 150);
      }
    };
    check();
  };
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === "docPreviewPageCount") {
        setPreviewPageCount(e.data.count);
        setPaginationError(e.data.error || "");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);
  const PDF_WORKER_URL = "https://bartolini-pdf-export.marcinkolacz.workers.dev";
  const exportPdfV2 = async () => {
    const selected = chapters.filter((c) => selectedForPrint.has(c.id));
    if (selected.length === 0) { alert("Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej)."); return; }
    const html = await buildChapterPreviewHtml(true, false);
    try {
      const res = await fetch(PDF_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      if (!res.ok) throw new Error(`Worker HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Instrukcja - ${deviceLabel}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Błąd generowania PDF: ${e}`);
    }
  };
  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-4 space-y-4">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

        <div className="flex items-center gap-2.5 bg-[var(--bg-card)] border border-[var(--border-color)] px-4 py-3 rounded-2xl flex-wrap shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2 mr-1">
            <span className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center text-sm shrink-0">📖</span>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Dokumentacja</h1>
          </div>
          <button
            onClick={() => onNavigate("manual#documentation")}
            className="text-xs px-3 py-1.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            ❓ Pomoc
          </button>
          <span className="text-[10px] font-mono text-[var(--text-muted)] opacity-60">
            poll#{pollTicks} deviceId={String(deviceId)} editMode={String(editMode)}
            {lastPolled ? ` ok:${lastPolled.toLocaleTimeString()}` : " (brak)"}
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
            onChange={async (e) => {
              const next = e.target.value ? Number(e.target.value) : null;
              if (editMode && dirty) {
                try { await saveChapter(true); } catch { /* saveChapter already surfaces its own error */ }
              }
              if (editMode) {
                setEditMode(false);
                tiptapHtmlRef.current = "";
                if (activeId !== null) actor.releaseEditLock(activeId).catch(() => {});
              }
              setDeviceId(next);
            }}
            className="ml-2 bg-[var(--bg-page)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-sm"
          >
            {devices.map((d) => (
              <option key={String(d.id)} value={Number(d.id)}>{d.symbol} — {d.name}</option>
            ))}
          </select>
          <button
            onClick={async () => {
              const name = prompt("Nazwa nowego folderu:");
              if (!name || !name.trim() || !actor) return;
              const newId = await actor.addDocFolder(name.trim());
              const rows = [...devices, { id: 1000000000 + Number(newId), symbol: "📁 Folder", name: name.trim(), isFolder: true }];
              setDevices(rows);
              setDeviceId(1000000000 + Number(newId));
            }}
            className="ml-2 text-xs px-3 py-1.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            + Nowy folder
          </button>
          {books.length > 0 && (
            <button onClick={addBook} className="ml-2 text-xs px-3 py-1.5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium">+ Nowa książka</button>
          )}
          {savedFlash && <span className="text-xs text-emerald-400">💾 Zapisano</span>}
          {driveSyncFlash && <span className="text-xs text-[var(--accent-text)]">☁️ Zsynchronizowano z Bartolini Drive</span>}
          {driveSyncError && <span className="text-xs text-amber-400">{driveSyncError}</span>}
          <div className="ml-auto flex gap-2">
            <button onClick={exportPdfV2} disabled={chapters.length === 0} className="text-xs px-3 py-1.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40">
              🖨 Eksportuj PDF
            </button>
            <button onClick={exportWord} disabled={chapters.length === 0} className="text-xs px-3 py-1.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40">
              📄 Eksportuj Word
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[var(--text-muted)] p-6">Wczytywanie…</div>
        ) : (
          <div className="flex bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-[var(--shadow-card)]" style={{ height: "calc(100vh - 150px)" }}>
            <div className="w-72 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-page)] p-3 space-y-1 overflow-auto">
              {books.map((book) => {
                const bookChapters = chapters.filter((c) => chapterBook[c.id] === book.id);
                const isExpanded = expandedBooks.has(book.id);
                return (
                  <div key={book.id} className="mb-2">
                    <div className="group flex items-center gap-1 rounded-lg px-1 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                      <span
                        onClick={() => setExpandedBooks((prev) => {
                          const next = new Set(prev);
                          if (next.has(book.id)) { next.delete(book.id); } else { next.add(book.id); }
                          return next;
                        })}
                        className="cursor-pointer select-none flex-1 flex items-center gap-1"
                      >
                        <span className="text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                        📚 {book.title}
                        <span className="text-[10px] text-[var(--text-muted)] font-normal">({bookChapters.length})</span>
                      </span>
                      {canEdit && (
                        <button onClick={() => renameBookById(book)} title="Zmień nazwę książki" className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-muted)]">✏</button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="ml-3 space-y-1 mt-1">
                        {bookChapters.map((ch) => (
                          <div
                            key={ch.id}
                            draggable={canEdit}
                            onDragStart={() => canEdit && setDragId(ch.id)}
                            onDragOver={(e) => canEdit && e.preventDefault()}
                            onDrop={() => canEdit && handleDrop(ch.id)}
                            className={"group flex items-center gap-1 rounded-lg px-2 py-2 text-sm " + (canEdit ? "cursor-grab " : "") + (ch.id === activeId ? "bg-[var(--accent-light)] text-[var(--accent-text)] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]")}
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
                              <span onClick={() => switchActiveChapter(ch.id)} className="flex-1 truncate">
                                {ch.title}
                                {chapterBackupFlags[ch.id] && <span className="text-green-400 ml-1" title="Kopia backend aktywna">✓</span>}
                              </span>
                            )}
                            {canEdit && <button onClick={() => startRename(ch)} title="Zmień nazwę" className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-muted)]">✏</button>}
                            <button onClick={() => downloadChapter(ch)} title="Pobierz" className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-muted)]">⬇</button>
                            {canEdit && <button onClick={() => requestDelete(ch)} title="Usuń" className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400">✕</button>}
                          </div>
                        ))}
                        {canEdit && (
                          <div className="flex gap-1 pt-1">
                            <input
                              value={newChapterTitles[book.id] || ""}
                              onChange={(e) => setNewChapterTitles((m) => ({ ...m, [book.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && addChapter(book.id)}
                              placeholder="+ Nowy rozdział"
                              className="flex-1 min-w-0 bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)]"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {!canEdit && (
                <p className="text-[10px] text-amber-400 pt-3 leading-snug">
                  Nie masz uprawnienia do edycji dokumentacji — poproś administratora o nadanie go (osobno od zwykłej roli Zapis).
                </p>
              )}
              <p className="text-[10px] text-[var(--text-muted)] pt-2 leading-snug">
                Przeciągnij ⠿ żeby zmienić kolejność. Style „Heading 1/2/3” w edytorze same numerują się jako Rozdział / Podrozdział / Punkt.
              </p>
            </div>

            <div
              className={editMode ? "fixed z-[200] flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] overflow-hidden rounded-lg shadow-2xl border-2 border-[var(--accent)]" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] relative"}
              style={editMode ? { left: editWinRect.x, top: editWinRect.y, width: editWinRect.width, height: editWinRect.height } : undefined}
            >
              {editMode && canEdit && active && (
                <div
                  onMouseDown={onEditWinDragStart}
                  title="Przeciągnij, żeby przesunąć okno"
                  className="flex items-center gap-3 px-3 py-1.5 bg-[var(--accent)] text-white text-xs font-medium cursor-move select-none shrink-0 flex-wrap"
                >
                  <span className="text-sm leading-none">✥</span>
                  <span className="truncate">{active.title}</span>
                  <span className="ml-auto flex items-center gap-3 opacity-95 font-normal">
                    <span title="Liczba stron (na żywo, w edytorze)">📄 {livePageCount != null ? `${livePageCount} str.` : "licz…"}</span>
                    <span title="Kiedy ostatnio zapisano na Bartolini Drive">
                      💾 {dirty ? "niezapisane zmiany" : lastSavedAt ? `zapisano ${lastSavedAt.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "brak zapisu w tej sesji"}
                    </span>
                    <span title={chapterBackupFlags[active.id] ? "Ma kopię zapasową on-chain (w kanistrze)" : "Brak kopii zapasowej on-chain — tylko na OneDrive"}>
                      {chapterBackupFlags[active.id] ? "🛟 backup: tak" : "🛟 backup: nie"}
                    </span>
                  </span>
                </div>
              )}
              {editMode && canEdit && active && lockStolenBy && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white text-xs font-medium shrink-0">
                  <span>⚠️</span>
                  <span>Ten dokument edytuje teraz: <strong>{lockStolenBy}</strong> — jeśli oboje zapiszecie, jedna wersja nadpisze drugą. Ustalcie kto kończy edycję.</span>
                </div>
              )}
              <style>{docContentCss("#doc-editor-content")}</style>
              {!active ? (
                <div className="p-8 text-sm text-[var(--text-muted)] flex items-center justify-center">
                  {loading ? (
                    <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg">
                      <div className="w-8 h-8 rounded-full border-[3px] border-[var(--border-color)] border-t-[var(--accent)] animate-spin" />
                      <span className="text-green-600 font-semibold text-sm">Tekst się ładuje, proszę czekać…</span>
                    </div>
                  ) : (
                    chapters.length === 0 ? "Brak rozdziałów — dodaj pierwszy w panelu po lewej." : "Wybierz rozdział z listy."
                  )}
                </div>
              ) : (
                <>
                  <div className="flex-1 flex overflow-hidden">
                  <div className="w-14 shrink-0 flex flex-col items-center gap-1 py-3 border-r border-[var(--border-color)] bg-[var(--bg-card)] overflow-y-auto">
                    {canEdit ? (
                      <RailButton
                        icon="✏"
                        label={editMode ? "Edytuję" : "Edytuj"}
                        active={editMode}
                        onClick={() => (editMode ? exitEditMode() : tryEnterEditMode())}
                      />
                    ) : (
                      <div title="Tylko podgląd — brak uprawnienia do edycji dokumentacji" className="text-amber-600 text-lg py-2">🔒</div>
                    )}
                    {editMode && canEdit && (
                      <RailButton icon="💾" label="Zapisz" active={dirty} disabled={!dirty} onClick={() => saveChapter(false)} />
                    )}
                    {editMode && canEdit && (
                      <RailButton icon="🔄" label={refreshingAndSaving ? "Odświeżam…" : "Odśwież i zapisz"} disabled={refreshingAndSaving} title="Zapisz, potem pobierz treść na nowo z OneDrive" onClick={refreshAndSave} />
                    )}
                    <div className="w-8 h-px bg-[var(--border-color)] my-1" />
                    <RailButton icon="🖨" label="Podgląd" onClick={openPrintPreview} />
                    <RailButton
                      icon="🖥"
                      label="Dopasuj"
                      active={fitToScreen}
                      title="Dopasuj szerokość pola roboczego do szerokości ekranu"
                      onClick={() => setFitToScreen((v) => !v)}
                    />
                    <div className="flex flex-col items-center gap-0.5 w-12">
                      <button onClick={() => setZoomLevel((z) => Math.min(200, z + 10))} title="Powiększ" className="w-8 h-6 rounded text-xs border border-[var(--border-color)] transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90">＋</button>
                      <button onClick={() => setZoomLevel(100)} title="Resetuj powiększenie" className="text-[10px] text-[var(--text-secondary)]">{zoomLevel}%</button>
                      <button onClick={() => setZoomLevel((z) => Math.max(50, z - 10))} title="Pomniejsz" className="w-8 h-6 rounded text-xs border border-[var(--border-color)] transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90">－</button>
                    </div>
                    {editMode && canEdit && (
                      <>
                        <div className="w-8 h-px bg-[var(--border-color)] my-1" />
                        <RailButton icon="🔗" label="Zmienne" title="Zmienne referencyjne" onClick={() => setShowVarsPanel(true)} />
                        <RailButton icon="⚙️" label="Nagłówek" title="Nagłówek i stopka" onClick={openSettings} />
                        <RailButton icon={autoSave ? "☑️" : "⬜"} label="Auto-zapis" active={autoSave} title="Auto-zapis (3s)" onClick={() => setAutoSave((v) => !v)} />
                      </>
                    )}
                    {!editMode && canEdit && (
                      <>
                        <div className="w-8 h-px bg-[var(--border-color)] my-1" />
                        <RailButton
                          icon="🔒"
                          label={showChainVersion ? "Z kanistra" : "Kanister"}
                          active={showChainVersion}
                          title="Pokazuje treść zapisaną w kanistrze (kopia zapasowa), pomijając OneDrive — do weryfikacji backupu"
                          onClick={() => setShowChainVersion((v) => !v)}
                        />
                        <RailButton
                          icon="🛟"
                          label={chapterBackupFlags[active.id] ? "Aktualizuj" : "Backup"}
                          badge={!!chapterBackupFlags[active.id]}
                          disabled={backupBusy}
                          title={chapterBackupFlags[active.id] ? `Aktualizuj kopię onchain (obecnie: ${activeBackupLength ?? "?"} zn.)` : "Utwórz kopię onchain z aktualnej treści OneDrive"}
                          onClick={createOrUpdateActiveBackup}
                        />
                        {chapterBackupFlags[active.id] && (
                          <RailButton icon="🗑" label="Usuń kopię" onClick={requestRemoveBackup} />
                        )}
                      </>
                    )}
                  </div>
                  {editMode && canEdit && (
                    <div ref={setToolbarSlotEl} className="w-52 shrink-0 flex flex-col gap-1 py-3 px-2 border-r border-[var(--border-color)] bg-[var(--bg-card)] overflow-y-auto" />
                  )}
                  <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 flex overflow-hidden">
                  <div ref={commentAreaRef} className="relative overflow-auto bg-[var(--bg-page)] py-6 flex-1">
                  {!editMode && active && (
                    <>
                    {newerVersionAvailable && !readViewLoading && readViewReady && (
                      <div className="mx-auto mb-2 flex items-center justify-center" style={{ maxWidth: 900 }}>
                        <button
                          onClick={applyNewerVersion}
                          className="text-xs px-3 py-1.5 rounded-full bg-[var(--accent-light)] text-[var(--accent-text)] border border-[var(--accent)] hover:opacity-80"
                        >
                          🔄 Dostępna nowsza wersja (zmiana innego instruktora) — kliknij, aby odświeżyć
                        </button>
                      </div>
                    )}
                    {paginationError && (
                      <div className="text-xs text-red-500 font-mono text-center mb-1">BLAD PAGINACJI: {paginationError}</div>
                    )}
                    {(readViewLoading || !readViewReady) && (
                      <div className="mx-auto flex items-center justify-center py-16" style={{ maxWidth: 900 }}>
                        <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg">
                          <div className="w-8 h-8 rounded-full border-[3px] border-[var(--border-color)] border-t-[var(--accent)] animate-spin" />
                          <span className="text-green-600 font-semibold text-sm">Tekst się ładuje, proszę czekać…</span>
                        </div>
                      </div>
                    )}
                    <iframe key={readViewToken || "initial"} ref={readViewIframeRef} title="Podgląd rozdziału" srcDoc={readViewHtml} onLoad={handleReadViewIframeLoad} className="mx-auto block w-full" style={{ maxWidth: 900, minHeight: "calc(100vh - 200px)", border: "none", display: (readViewLoading || !readViewReady) ? "none" : "block" }} />
                    </>
                  )}
                  {editMode && canEdit && active && (
                    <div className="mx-auto" style={{ maxWidth: 900, transform: `scale(${zoomLevel / 100})`, transformOrigin: "top center" }}>
                      <DocumentationEditorTiptapPoC
                        key={`${active.id}-${tiptapRemountTick}`}
                        initialHtml={active.contentHtml || "<p></p>"}
                        onChangeHtml={(html) => { tiptapHtmlRef.current = html; setDirty(true); }}
                        onPageCountChange={setLivePageCount}
                        h1OffsetBefore={h1Offset}
                        headerLeft={hfSettings.headerText}
                        headerCenter={hfSettings.headerTextCenter}
                        headerRight={hfSettings.headerTextRight}
                        headerEvenLeft={hfSettings.headerTextEvenLeft}
                        headerEvenCenter={hfSettings.headerTextEvenCenter}
                        headerEvenRight={hfSettings.headerTextEvenRight}
                        footerLeft={hfSettings.footerTextLeft}
                        footerCenter={hfSettings.footerText}
                        footerRight={hfSettings.footerTextRight}
                        enableHeader={hfSettings.enableHeader}
                        enableFooter={hfSettings.enableFooter}
                        headerHeightCm={hfSettings.headerHeightCm}
                        footerHeightCm={hfSettings.footerHeightCm}
                        headerFontSize={hfSettings.headerFontSize}
                        footerFontSize={hfSettings.footerFontSize}
                        headerBorder={hfSettings.headerBorder}
                        footerBorder={hfSettings.footerBorder}
                        skipFirstPage={hfSettings.skipFirstPage}
                        showPageNumbers={hfSettings.showPageNumbers}
                        toolbarPortalEl={toolbarSlotEl}
                        onImageUpload={async (blob, filename) => {
                          const ext = filename.toLowerCase().endsWith(".png") ? "png" : "jpg";
                          return uploadChapterImage(deviceLabel, blob, ext);
                        }}
                      />
                    </div>
                  )}
                  </div>
                  </div>
                  </div>
                  </div>
                </>
              )}
              {editMode && (
                <div
                  onMouseDown={onEditWinResizeStart}
                  title="Przeciągnij, żeby zmienić rozmiar okna"
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-60 hover:opacity-100"
                  style={{ background: "linear-gradient(135deg, transparent 50%, var(--text-secondary) 50%)" }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[400]">
          <div
            className="absolute bg-[var(--bg-card)] text-[var(--text-primary)] rounded-lg shadow-2xl flex flex-col overflow-hidden"
            style={{ left: hfWinRect.x, top: hfWinRect.y, width: hfWinRect.width, height: hfWinRect.height }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              onMouseDown={onHfWinDragStart}
              className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-hover)] cursor-move shrink-0"
            >
              <h3 className="font-semibold text-[var(--accent-text)] text-sm">⚙️ Nagłówek i stopka dokumentu</h3>
              <button onClick={closeSettingsWithoutSaving} className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">✕</button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
            <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent-light)] p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p className="font-semibold text-[var(--accent-text)] mb-1">ⓘ Jak to działa</p>
              <p className="mb-1">
                Te ustawienia są wspólne dla <b>całej instrukcji tego urządzenia</b> (nie per rozdział) i identyczne w podglądzie wydruku,
                eksporcie PDF i eksporcie Word.
              </p>
              <p className="mb-1">
                Nagłówek ma osobne pola <b>Lewo / Środek / Prawo</b> dla stron <b>nieparzystych</b> i osobne dla <b>parzystych</b> —
                puste pole parzyste kopiuje treść z nieparzystego. Stopka jest wspólna dla wszystkich stron.
              </p>
              <p className="mb-1">
                Puste pole = brak tekstu w tym miejscu (bez automatycznego uzupełniania nazwą urządzenia).
              </p>
              <p>
                Jeśli którekolwiek z pól L/C/P zawiera więcej niż jedną linię, cały nagłówek/stopka wyrównuje się do góry zamiast
                do środka. „Numeruj strony" dodaje osobny licznik strony obok tekstu, niezależnie od jego treści.
                „Pomiń pierwszą stronę" wyłącza nagłówek i stopkę tylko na stronie 1.
              </p>
            </div>

            <div>
              <div className="text-xs text-[var(--text-secondary)] mb-1">Tekst nagłówka (puste pole = brak nagłówka)</div>
              <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">Strony nieparzyste</div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <label className="block text-xs text-[var(--text-secondary)]">
                  Lewo
                  <textarea rows={5}
                    value={hfDraft.headerText}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerText: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                    placeholder="np. Bartolini Air Simulation"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Środek
                  <textarea rows={5}
                    value={hfDraft.headerTextCenter}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerTextCenter: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Prawo
                  <textarea rows={5}
                    value={hfDraft.headerTextRight}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerTextRight: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">Strony parzyste (puste = jak nieparzyste)</div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-xs text-[var(--text-secondary)]">
                  Lewo
                  <textarea rows={5}
                    value={hfDraft.headerTextEvenLeft}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerTextEvenLeft: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Środek
                  <textarea rows={5}
                    value={hfDraft.headerTextEvenCenter}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerTextEvenCenter: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Prawo
                  <textarea rows={5}
                    value={hfDraft.headerTextEvenRight}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerTextEvenRight: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="text-xs text-[var(--text-secondary)] mb-1">Tekst stopki</div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-xs text-[var(--text-secondary)]">
                  Lewo
                  <textarea rows={5}
                    value={hfDraft.footerTextLeft}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerTextLeft: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Środek
                  <textarea rows={5}
                    value={hfDraft.footerText}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerText: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                    placeholder="Bartolini Air Simulation"
                  />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Prawo
                  <textarea rows={5}
                    value={hfDraft.footerTextRight}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerTextRight: e.target.value }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
              </div>
            </div>

            <div className="text-xs text-[var(--text-secondary)]">
              Logo w nagłówku
              <div className="flex items-center gap-2 mt-1">
                {hfDraft.logoDataUri ? (
                  <img src={hfDraft.logoDataUri} alt="logo" className="h-6" />
                ) : (
                  <span className="text-[10px] text-[var(--text-muted)]">domyślne logo Bartolini</span>
                )}
                <button onClick={() => hfLogoInputRef.current?.click()} className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Zmień…</button>
                {hfDraft.logoDataUri && (
                  <button onClick={() => setHfDraft((d) => ({ ...d, logoDataUri: "" }))} className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Przywróć domyślne</button>
                )}
              </div>
              <input ref={hfLogoInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onHfLogoSelected} />
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.enableHeader} onChange={(e) => setHfDraft((d) => ({ ...d, enableHeader: e.target.checked }))} />
              Pokaż nagłówek
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.enableFooter} onChange={(e) => setHfDraft((d) => ({ ...d, enableFooter: e.target.checked }))} />
              Pokaż stopkę
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.skipFirstPage} onChange={(e) => setHfDraft((d) => ({ ...d, skipFirstPage: e.target.checked }))} />
              Bez nagłówka/stopki na pierwszej stronie (stronie tytułowej)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.showPageNumbers} onChange={(e) => setHfDraft((d) => ({ ...d, showPageNumbers: e.target.checked }))} />
              Pokaż numerację stron w stopce (Word: prawdziwa, aktualizuje się automatycznie)
            </label>

            <div className="border-t border-[var(--border-color)] pt-3">
              <div className="text-xs font-semibold text-[var(--accent-text)] mb-2">Wymiary i wygląd</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-[var(--text-secondary)]">
                  Wysokość nagłówka (cm)
                  <input type="number" min={0.5} step={0.05} value={hfDraft.headerHeightCm}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerHeightCm: parseFloat(e.target.value) || 0.5 }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1" />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Wysokość stopki (cm)
                  <input type="number" min={0.5} step={0.05} value={hfDraft.footerHeightCm}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerHeightCm: parseFloat(e.target.value) || 0.5 }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1" />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Czcionka nagłówka (pt)
                  <input type="number" min={6} max={18} step={0.5} value={hfDraft.headerFontSize}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerFontSize: parseFloat(e.target.value) || 9 }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1" />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Czcionka stopki (pt)
                  <input type="number" min={6} max={18} step={0.5} value={hfDraft.footerFontSize}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerFontSize: parseFloat(e.target.value) || 9 }))}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs mt-2">
                <input type="checkbox" checked={hfDraft.headerBorder} onChange={(e) => setHfDraft((d) => ({ ...d, headerBorder: e.target.checked }))} />
                Linia pod nagłówkiem
              </label>
              <label className="flex items-center gap-2 text-xs mt-1">
                <input type="checkbox" checked={hfDraft.footerBorder} onChange={(e) => setHfDraft((d) => ({ ...d, footerBorder: e.target.checked }))} />
                Linia nad stopką
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeSettingsWithoutSaving} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Anuluj</button>
              <button onClick={saveSettings} className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white">Zapisz</button>
            </div>
            </div>
            <div
              onMouseDown={onHfWinResizeStart}
              title="Przeciągnij, żeby zmienić rozmiar okna"
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-60 hover:opacity-100"
              style={{ background: "linear-gradient(135deg, transparent 50%, #999 50%)" }}
            />
          </div>
        </div>
      )}


      {showPrintPreview && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center">
        <div
          className="bg-[var(--bg-card)] rounded-lg shadow-2xl border border-[var(--border-color)] w-[900px] max-w-[95vw] h-[85vh] flex flex-col overflow-hidden"
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] flex-wrap gap-2 select-none"
          >
            <h2 className="text-sm font-bold text-[var(--accent-text)]">
              Podglad wydruku - rozdzialy: {selectedForPrint.size}{previewPageCount != null ? ` — stron: ${previewPageCount}` : ""}
              {paginationError ? ` | BLAD PAGINACJI: ${paginationError}` : ""}
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={refreshPrintPreview} className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white">
                Odswiez
              </button>
              <button
                onClick={() => {
                  const w = window.open("", "_blank", "width=1000,height=900");
                  if (w) { w.document.write(previewHtml); w.document.close(); }
                }}
                className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)]"
                title="Otwiera podglad w osobnym oknie przegladarki - mozna je przeciagnac poza glowne okno, np. na drugi monitor"
              >
                ⇱ Otworz w oknie
              </button>
              <button onClick={() => setShowPrintPreview(false)} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)]">
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
        </div>
      )}
      {showVarsPanel && deviceId !== null && activeBookId !== null && (
        <ManualVariablesPanel
          actor={actor}
          bookId={activeBookId as number}
          deviceLabel={deviceLabel}
          chapters={chapters.filter((c) => chapterBook[c.id] === activeBookId)}
          onClose={() => setShowVarsPanel(false)}
          onChapterContentUpdated={(chapterId, newHtml) => {
            // Wstrzykujemy dokładnie tę treść, którą panel właśnie zapisał —
            // bez ponownego odczytu z Drive/backendu, który bywał podatny na
            // opóźnienie propagacji i potrafił na chwilę pokazać starą/pustą treść.
            setChapters((prev) => prev.map((c) => (c.id === chapterId ? { ...c, contentHtml: newHtml } : c)));
            // W trybie edycji normalnie NIE nadpisujemy bufora edytora (żeby
            // nie zgubić niezapisanej pracy) — ale jeśli nic nie jest jeszcze
            // napisane od ostatniego zapisu (!dirty), nadpisanie jest bezpieczne
            // i unika konieczności ręcznego wyjścia/wejścia w edycję.
            if (chapterId === activeIdRef.current && !dirty) {
              // Tiptap czyta initialHtml tylko raz przy montowaniu — wymuś
              // remount (key bump), żeby pokazać podmienioną treść bez
              // wychodzenia z trybu edycji.
              setTiptapRemountTick((t) => t + 1);
            }
          }}
        />
      )}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500]" onClick={() => setDeleteTarget(null)}>
          <div className="bg-[var(--bg-card)] text-[var(--text-primary)] rounded-lg p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-600">Usunąć rozdział?</h3>
            <p className="text-sm">
              Rozdział „<strong>{deleteTarget.title}</strong>” trafi do kosza administratora (odwracalne, ale wymaga admina żeby przywrócić).
            </p>
            <p className="text-xs text-[var(--text-secondary)]">Wpisz <strong>DELETE</strong> żeby potwierdzić:</p>
            <input
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
              className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm"
              placeholder="DELETE"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Anuluj</button>
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
      {removeBackupConfirm && active && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500]" onClick={() => setRemoveBackupConfirm(false)}>
          <div className="bg-[var(--bg-card)] text-[var(--text-primary)] rounded-lg p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-500">Usunąć kopię onchain?</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Kopia zapasowa rozdziału „<strong>{active.title}</strong>” zostanie usunięta z kanistra. Treść na OneDrive pozostaje bez zmian.
            </p>
            <p className="text-xs text-[var(--text-muted)]">Wpisz <strong>DELETE</strong> żeby potwierdzić:</p>
            <input
              autoFocus
              value={removeBackupConfirmText}
              onChange={(e) => setRemoveBackupConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmRemoveBackup()}
              className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm"
              placeholder="DELETE"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRemoveBackupConfirm(false)} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Anuluj</button>
              <button
                onClick={confirmRemoveBackup}
                disabled={removeBackupConfirmText !== "DELETE"}
                className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white"
              >
                Usuń kopię
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
