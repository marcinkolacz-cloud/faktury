import { useEffect, useRef, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { setDriveActor, warmDriveToken } from "../lib/oneDriveConfig";
import { syncChapterToDrive, uploadChapterImage, loadChapterContentFromDrive, renameChapterOnDrive } from "../lib/documentationDriveSync";
import { convertDocxToHtml } from "../lib/docxImport";
import { ManualVariablesPanel } from "./ManualVariablesPanel";

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
#doc-editor-content p, #doc-editor-content div, #doc-editor-content li { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #000; font-weight: normal; font-size: 10pt; margin: 0; }
#doc-editor-content ul { list-style: disc outside; padding-left: 24px; margin: 0; }
#doc-editor-content ol { list-style: decimal outside; padding-left: 24px; margin: 0; }
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
    if (/^table of contents$|^spis tre[śs]ci$/i.test((el.textContent || "").trim())) {
      el.removeAttribute("data-num");
      return;
    }
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
      if (/^table of contents$|^spis tre[śs]ci$/i.test((el.textContent || "").trim())) {
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
  const headerLeft = (settings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`).replace(/\n/g, "<br>");
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
  const [loading, setLoading] = useState(true);
  const [loadingChapterContent, setLoadingChapterContent] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);
  const [twoPageView, setTwoPageView] = useState(false);
  useEffect(() => {
    if (editMode) setTwoPageView(true);
  }, [editMode]);
  const [showChainVersion, setShowChainVersion] = useState(false);
  const showChainVersionRef = useRef(false);
  useEffect(() => { showChainVersionRef.current = showChainVersion; }, [showChainVersion]);
  const [twoPageHtml, setTwoPageHtml] = useState("");
  const twoPageIframeRef = useRef<HTMLIFrameElement | null>(null);
  const twoPageScrollRef = useRef(0);
  const twoPageCaretFractionRef = useRef<number | null>(null);
  const [twoPageTick, setTwoPageTick] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  // 210mm in CSS px at the standard 96dpi reference used everywhere else
  // in this file (print preview, export) - must stay ONE authoritative
  // width so "Dopasuj do ekranu" only zooms (transform:scale), never
  // reflows text at a wider-than-A4 content width.
  const A4_WIDTH_PX = (210 * 96) / 25.4;
  // Wysokość A4 w tych samych CSS px co A4_WIDTH_PX (96dpi) — używana do
  // policzenia ile "wirtualnych" stron zajmuje bieżąca treść w ciągłym
  // widoku (bez klikania "2 strony"), żeby powtórzyć nagłówek/stopkę na
  // każdej z nich zamiast tylko raz na górze/dole całego dokumentu.
  const A4_HEIGHT_PX = (297 * 96) / 25.4;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [contentHeightPx, setContentHeightPx] = useState(0);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentHeightPx(el.scrollHeight));
    ro.observe(el);
    setContentHeightPx(el.scrollHeight);
    return () => ro.disconnect();
  }, [activeId, editMode]);
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
  const [imageUploading, setImageUploading] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [lockBusyMsg, setLockBusyMsg] = useState("");
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showVarsPanel, setShowVarsPanel] = useState(false);
  const previewGridView = false;
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableDraft, setTableDraft] = useState({ rows: 3, cols: 3, headerRow: false, colWidthCm: "", rowHeightCm: "" });
  const A4_USABLE_WIDTH_CM = 18.46; // 21cm - 1.27cm marginesy z każdej strony
  const tableInsertRangeRef = useRef<Range | null>(null);
  const [showPlainPasteModal, setShowPlainPasteModal] = useState(false);
  const [plainPasteText, setPlainPasteText] = useState("");
  const plainPasteRangeRef = useRef<Range | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewPageCount, setPreviewPageCount] = useState<number | null>(null);
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
  const [editWinRect, setEditWinRect] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth * 0.02)),
    y: Math.max(20, Math.round(window.innerHeight * 0.03)),
    width: Math.round(window.innerWidth * 0.96),
    height: Math.round(window.innerHeight * 0.94),
  }));
  const editDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onEditWinDragStart = (e: React.MouseEvent) => {
    editDragRef.current = { startX: e.clientX, startY: e.clientY, origX: editWinRect.x, origY: editWinRect.y };
    const onMove = (ev: MouseEvent) => {
      if (!editDragRef.current) return;
      const { startX, startY, origX, origY } = editDragRef.current;
      setEditWinRect((r) => {
        const nx = Math.min(Math.max(0, origX + (ev.clientX - startX)), window.innerWidth - 100);
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
  useAuthContext();
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [pollTicks, setPollTicks] = useState(0);
  const [pollError, setPollError] = useState<string>("");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [pageMarkers, setPageMarkers] = useState<number[]>([]);

  // Visual guide only: shows roughly where a physical A4 page would end,
  // using the same content-height budget as the print preview/PDF engine.
  // Read-only measurement (getBoundingClientRect) - never mutates the
  // editable DOM, unlike the preview's hoistPageBreaks (which is safe
  // there only because it operates on a disposable, hidden clone).
  const recomputePageMarkers = () => {
    const content = editorRef.current;
    if (!content || !editMode) { setPageMarkers([]); return; }
    const outer = content.parentElement;
    if (!outer) { setPageMarkers([]); return; }
    const CONTENT_H_MM = 297 - 37.5 - 12.7;
    const MM_TO_PX = 96 / 25.4;
    const INNER_PAD_PX = 32;
    const PAGE_H_BASE = Math.round(CONTENT_H_MM * MM_TO_PX) - INNER_PAD_PX * 2;
    const scale = zoomLevel / 100;
    const PAGE_H = PAGE_H_BASE * scale;
    const outerTop = outer.getBoundingClientRect().top;
    const markers: number[] = [];
    let cumulative = 0;
    // Word-pasted content is often deeply nested (div > div > div ...),
    // so a single top-level child can span several physical pages.
    // Recurse into any unit taller than one page until we reach pieces
    // that fit, so breaks can land inside nested wrappers too.
    const collectUnits = (el: HTMLElement): HTMLElement[] => {
      if (el.classList.contains(PAGE_BREAK_CLASS)) return [el];
      const h = el.getBoundingClientRect().height;
      if (h <= PAGE_H || el.children.length === 0) return [el];
      let units: HTMLElement[] = [];
      Array.prototype.slice.call(el.children).forEach((k: HTMLElement) => {
        units = units.concat(collectUnits(k));
      });
      return units.length ? units : [el];
    };
    let units: HTMLElement[] = [];
    Array.prototype.slice.call(content.children).forEach((child: HTMLElement) => {
      units = units.concat(collectUnits(child));
    });
    units.forEach((unit: HTMLElement) => {
      const containsBreak = unit.classList.contains(PAGE_BREAK_CLASS) || !!unit.querySelector(`.${PAGE_BREAK_CLASS}`);
      const h = unit.getBoundingClientRect().height;
      if (cumulative > 0 && cumulative + h > PAGE_H) {
        markers.push((unit.getBoundingClientRect().top - outerTop) / scale);
        cumulative = 0;
      }
      if (containsBreak) {
        const breakEls = unit.classList.contains(PAGE_BREAK_CLASS) ? [unit] : Array.prototype.slice.call(unit.querySelectorAll(`.${PAGE_BREAK_CLASS}`));
        breakEls.forEach((b: HTMLElement) => {
          markers.push((b.getBoundingClientRect().top - outerTop) / scale);
        });
        cumulative = 0;
        return;
      }
      cumulative += h;
    });
    setPageMarkers(markers);
  };

  useEffect(() => {
    const content = editorRef.current;
    if (!content || !editMode) { setPageMarkers([]); return; }
    let raf = 0;
    const scheduleRecompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recomputePageMarkers);
    };
    scheduleRecompute();
    const observer = new MutationObserver(scheduleRecompute);
    observer.observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
    content.addEventListener("input", scheduleRecompute);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      content.removeEventListener("input", scheduleRecompute);
    };
  }, [editMode, zoomLevel]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const wordImportInputRef = useRef<HTMLInputElement | null>(null);
  const [wordImporting, setWordImporting] = useState(false);
  const autoSaveTimer = useRef<number | null>(null);
  const savingRef = useRef(false);
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
      if (nextActive !== null && !editMode) {
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
    let cancelled = false;
    setLoadingChapterContent(true);
    fetchChapterContent(activeId).then((content) => {
      if (cancelled) return;
      setChapters((prev) => prev.map((c) => (c.id === activeId ? { ...c, contentHtml: content } : c)));
      if (!editMode && editorRef.current && activeIdRef.current === activeId) {
        editorRef.current.innerHTML = content || "<p></p>";
      }
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
      if (!editMode && editorRef.current && activeIdRef.current === activeId) {
        editorRef.current.innerHTML = content || "<p></p>";
      }
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

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    setDirty(true);
  };

  // execCommand("justifyLeft") w niektórych przeglądarkach potrafi nie
  // usunąć zaszytego inline text-align:center (np. z wklejonego Worda) -
  // stąd czasem tylko "justifyFull" wizualnie "naprawiał" to efektem
  // ubocznym. Ta funkcja ustawia wyrównanie wprost na blokach zaznaczenia,
  // z !important, więc zawsze wygrywa niezależnie od tego co tam już było.
  const setAlignment = (align: "left" | "center" | "right" | "justify") => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? (range.startContainer as HTMLElement) : range.startContainer.parentElement;
    const endEl = range.endContainer.nodeType === 1 ? (range.endContainer as HTMLElement) : range.endContainer.parentElement;
    const isBlock = (el: HTMLElement) => ["P", "DIV", "H1", "H2", "H3", "H4", "LI"].includes(el.tagName);
    const findBlock = (el: HTMLElement | null): HTMLElement | null => {
      while (el && el !== editorRef.current) {
        if (isBlock(el)) return el;
        el = el.parentElement;
      }
      return null;
    };
    const startBlock = findBlock(startEl);
    const endBlock = findBlock(endEl);
    const blocks = new Set<HTMLElement>();
    if (startBlock) blocks.add(startBlock);
    if (endBlock) blocks.add(endBlock);
    if (startBlock && endBlock && startBlock !== endBlock) {
      // Zaznaczenie obejmuje kilka bloków - dodaj wszystkie pomiędzy nimi.
      let node: Node | null = startBlock;
      while (node && node !== endBlock) {
        node = node.nextSibling;
        if (node instanceof HTMLElement && isBlock(node)) blocks.add(node);
      }
    }
    if (blocks.size === 0 && startBlock) blocks.add(startBlock);
    blocks.forEach((el) => el.style.setProperty("text-align", align, "important"));
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

  // Przewija już załadowany iframe podglądu "2 strony" do miejsca kursora,
  // natychmiast — bez czekania na przebudowę/przeładowanie treści (samo
  // przestawienie kursora, bez zmiany tekstu, generuje identyczny HTML co
  // poprzednio, więc iframe się nie przeładowuje i tick nic nie daje).
  const scrollTwoPageToCaret = () => {
    if (!twoPageView) return;
    const win = twoPageIframeRef.current?.contentWindow;
    if (!win || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchorEl = sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as HTMLElement) : sel.anchorNode.parentElement) : null;
    if (!anchorEl || !editorRef.current.contains(anchorEl)) return;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    const editorTop = editorRef.current.getBoundingClientRect().top;
    const scrollTop = commentAreaRef.current?.scrollTop || 0;
    const caretOffset = rect.top - editorTop + scrollTop;
    const total = editorRef.current.scrollHeight || 1;
    const fraction = Math.max(0, Math.min(1, caretOffset / total));
    try {
      const totalHeight = win.document.documentElement.scrollHeight;
      win.scrollTo({ top: fraction * totalHeight, behavior: "smooth" });
    } catch {
      // iframe jeszcze nie załadowany / cross-origin - nic nie robimy
    }
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
    scrollTwoPageToCaret();
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
    if (activeBookId === null) return;
    try {
      await actor.setBookHeaderFooterSettings(
        activeBookId,
        hfDraft.headerText,
        hfDraft.footerText,
        hfDraft.logoDataUri,
        hfDraft.skipFirstPage,
        hfDraft.showPageNumbers,
      );
      setHfSettings(hfDraft);
      saveHfExtras(hfDraft);
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
    doc.body.innerHTML = doc.body.innerHTML.replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0");
    doc.body.querySelectorAll<HTMLElement>("td, th").forEach((el) => {
      el.style.borderWidth = "1px";
      el.style.borderStyle = "solid";
      el.style.borderColor = "#000";
    });
    return doc.body.innerHTML;
  };

  // "Wklej czysty tekst" — otwiera modal z <textarea>. Wklejenie do
  // zwykłego <textarea> samo w sobie odrzuca cały HTML ze schowka (Word
  // zostawia tam tylko czysty tekst), więc to najprostszy pewny sposób na
  // pozbycie się stylów/klas/nagłówków Worda bez próby ich "czyszczenia"
  // z HTML. Każda linia trafia do dokumentu jako osobny akapit <p> w
  // standardowym stylu "Normal" (bez dodatkowych klas/inline-style).
  const openPlainPasteModal = () => {
    const sel0 = window.getSelection();
    plainPasteRangeRef.current = sel0 && sel0.rangeCount > 0 ? sel0.getRangeAt(0).cloneRange() : null;
    setPlainPasteText("");
    setShowPlainPasteModal(true);
  };
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const insertPlainPasteText = () => {
    const lines = plainPasteText.split(/\r\n|\r|\n/);
    const html = lines.map((l) => `<p>${l.trim() ? escapeHtml(l) : "<br>"}</p>`).join("");
    const savedRange = plainPasteRangeRef.current;
    const sel1 = window.getSelection();
    if (savedRange) {
      sel1?.removeAllRanges();
      sel1?.addRange(savedRange);
    }
    // Restore the selection BEFORE focusing: focusing a contenteditable with
    // no active selection resets the caret to the very start of the document,
    // which is what caused the "jumps back to the beginning" bug.
    editorRef.current?.focus({ preventScroll: true });
    document.execCommand("insertHTML", false, html);
    // Bring the freshly inserted text into view (insertHTML doesn't auto-scroll).
    const sel2 = window.getSelection();
    if (sel2 && sel2.rangeCount > 0) {
      const node = sel2.getRangeAt(0).startContainer;
      const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
      el?.scrollIntoView({ block: "center" });
    }
    setDirty(true);
    setShowPlainPasteModal(false);
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
  const insertWordDoc = () => wordImportInputRef.current?.click();
  const onWordFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      alert("Tylko pliki .docx (nie stare .doc).");
      return;
    }
    setWordImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const html = await convertDocxToHtml(arrayBuffer);
      const sanitized = sanitizePastedHtml(html);
      const sel0 = window.getSelection();
      const anchorEl = sel0 && sel0.anchorNode
        ? (sel0.anchorNode.nodeType === 1 ? (sel0.anchorNode as HTMLElement) : sel0.anchorNode.parentElement)
        : null;
      if (anchorEl && anchorEl.closest("table") && editorRef.current?.contains(anchorEl)) {
        alert("Ustaw kursor poza tabelą i spróbuj ponownie.");
        return;
      }
      editorRef.current?.focus();
      document.execCommand("insertHTML", false, sanitized);
      setDirty(true);
    } catch (err: any) {
      alert("Nie udało się zaimportować pliku: " + String(err?.message || err));
    } finally {
      setWordImporting(false);
    }
  };

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
    if (savingRef.current) return;
    savingRef.current = true;
    try {
    // Strip the live-preview data-num attributes before persisting —
    // they're recomputed fresh on every load/render (see
    // applyLiveHeadingNumbers), so saved content should stay clean of
    // them to avoid staleness and keep the stored HTML minimal.
    const html = editorRef.current.innerHTML.replace(/\s*data-num="[^"]*"/g, "");
    try {
      await syncChapterToDrive(deviceLabel, active.id, active.order, active.title, html);
    } catch (e: any) {
      setDriveSyncError("Nie udalo sie zapisac na Bartolini Drive: " + (e?.message || String(e)));
      setTimeout(() => setDriveSyncError(""), 5000);
      return;
    }
    await actor.updateDeviceManualChapterMeta(active.id, active.title, "");
    setDirty(false);
    setChapters((prev) => prev.map((c) => (c.id === active.id ? { ...c, contentHtml: html } : c)));
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

  // Auto-save: 3s after the last edit, only while enabled + edit mode on.
  useEffect(() => {
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    if (!autoSave || !dirty || !editMode) return;
    autoSaveTimer.current = window.setTimeout(() => { saveChapter(true); }, 3000);
    return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
  }, [dirty, autoSave, editMode]);

  const getChaptersForExport = async (): Promise<Chapter[]> => {
    const liveHtml = active && editorRef.current ? editorRef.current.innerHTML.replace(/\s*data-num="[^"]*"/g, "") : null;
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
  const buildChapterPreviewHtml = async (forPrint: boolean = false, gridView: boolean = false, selectedOverride?: Set<number>): Promise<string> => {
    const selectedSet = selectedOverride || selectedForPrint;
    const selected = chapters.filter((c) => selectedSet.has(c.id));
    if (selected.length === 0) {
      return `<html><body style="font-family:Arial,sans-serif;padding:24px;color:#888;">
        Zaznacz przynajmniej jeden rozdział (checkbox na liście po lewej), żeby zobaczyć podgląd wydruku.
      </body></html>`;
    }
    const nl2br = (t: string) => t.replace(/\n/g, "<br>");
    const headerOddLeft = nl2br(hfSettings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`);
    const headerOddCenter = nl2br(hfSettings.headerTextCenter.trim());
    const headerOddRight = nl2br(hfSettings.headerTextRight.trim());
    const headerEvenLeft = nl2br(hfSettings.headerTextEvenLeft.trim()) || headerOddLeft;
    const headerEvenCenter = nl2br(hfSettings.headerTextEvenCenter.trim()) || headerOddCenter;
    const headerEvenRight = nl2br(hfSettings.headerTextEvenRight.trim()) || headerOddRight;
    const footerHtml = hfSettings.footerText.trim() || "Bartolini Air Simulation";
    const footerLeftHtml = hfSettings.footerTextLeft.trim();
    const footerRightHtml = hfSettings.footerTextRight.trim();
    const numbered = numberHeadingsForExport(await getChaptersForExport(), selectedSet);
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
    // #doc-editor-content itself adds Tailwind "p-8" (32px all sides) on
    // top of the outer .sheet padding above - the actual usable width/
    // height for content is the outer box minus this inner padding too.
    const INNER_PAD_PX = 32;
    const innerContentWidthPx = contentWidthPx - INNER_PAD_PX * 2;
    // The preview is a standalone iframe (no access to the app's own
    // stylesheet), but chapter HTML relies on COUNTER_CSS's rules (font,
    // default bold weight, table border/background via CSS vars, list
    // styles, comment highlight) which live under "#doc-editor-content"
    // in the real editor. Re-scope that same CSS onto ".page-content" and
    // supply light-theme fallback values for the vars it references, so
    // tables/lists/fonts/colors render the same as in the editor.
    const previewCounterCss = COUNTER_CSS.replace(/#doc-editor-content/g, ".page-content");
    const contentHeightPx = Math.round(CONTENT_H_MM * MM_TO_PX) - INNER_PAD_PX * 2;
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
        .page-content{padding:32px;line-height:1.625;font-size:15px;box-sizing:border-box;max-width:900px;margin:0 auto;--text-secondary:#5c574d;--bg-hover:#efece3;}
        .page-number{position:absolute;left:1.27cm;right:1.27cm;bottom:-16px;font-size:8pt;color:#999;text-align:center;}
        .${PAGE_BREAK_CLASS}{page-break-before:always;border:none;}
        ${forPrint ? "@page{size:A4;margin:0;} body{background:#fff;} .sheet{box-shadow:none;margin:0;} .sheet + .sheet{page-break-before:always;} .page-number{display:none;}" : ""}
        img{max-width:100%;}
        #measure{position:absolute;left:-99999px;top:0;width:${innerContentWidthPx}px;padding:0;max-width:none;visibility:hidden;--text-secondary:#5c574d;--bg-hover:#efece3;}
        ${previewCounterCss}
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
          try { parent.postMessage({ type: 'docPreviewPageCount', count: pages.length }, '*'); } catch (e) {}
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
  useEffect(() => {
    if (!twoPageView || !active) { setTwoPageHtml(""); return; }
    let cancelled = false;
    const run = async () => {
      const win = twoPageIframeRef.current?.contentWindow;
      if (win) twoPageScrollRef.current = win.scrollY;
      // Pozycja kursora jako ułamek (0..1) całkowitej wysokości treści -
      // przybliżenie, bo edytor (ciągły) i podgląd (spaginowany, z
      // nagłówkami/stopkami) mają inną wysokość, ale wystarcza żeby
      // podgląd "podążał" za miejscem edycji zamiast zostawać w miejscu.
      twoPageCaretFractionRef.current = null;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current) {
        const range = sel.getRangeAt(0);
        const anchorEl = sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as HTMLElement) : sel.anchorNode.parentElement) : null;
        if (anchorEl && editorRef.current.contains(anchorEl)) {
          const rects = range.getClientRects();
          const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
          const editorTop = editorRef.current.getBoundingClientRect().top;
          const scrollTop = commentAreaRef.current?.scrollTop || 0;
          const caretOffset = rect.top - editorTop + scrollTop;
          const total = editorRef.current.scrollHeight || 1;
          twoPageCaretFractionRef.current = Math.max(0, Math.min(1, caretOffset / total));
        }
      }
      const html = await buildChapterPreviewHtml(false, true, new Set([active.id]));
      if (!cancelled) setTwoPageHtml(html);
    };
    const t = setTimeout(run, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [twoPageView, editMode, active, twoPageTick]);
  // Tryb bez edycji ("Edytuj" nieaktywne): zamiast surowego, ciągłego
  // contentEditable z nakładkowym nagłówkiem/stopką (przybliżenie, które
  // nachodzi na treść na 2+ stronie), pokazujemy dokładnie ten sam,
  // realnie spaginowany HTML co w "Podgląd wydruku"/"2 strony".
  const [readViewHtml, setReadViewHtml] = useState("");
  useEffect(() => {
    if (editMode || !active) { setReadViewHtml(""); return; }
    let cancelled = false;
    (async () => {
      const html = await buildChapterPreviewHtml(false, true, new Set([active.id]));
      if (!cancelled) setReadViewHtml(html);
    })();
    return () => { cancelled = true; };
  }, [editMode, active]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === "docPreviewPageCount") {
        setPreviewPageCount(e.data.count);
        const win = twoPageIframeRef.current?.contentWindow;
        if (win && e.source === win) {
          const fraction = twoPageCaretFractionRef.current;
          if (fraction !== null) {
            const totalHeight = win.document.documentElement.scrollHeight;
            win.scrollTo(0, fraction * totalHeight);
          } else {
            win.scrollTo(0, twoPageScrollRef.current);
          }
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
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
            onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : null)}
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
                              <span onClick={() => setActiveId(ch.id)} className="flex-1 truncate">
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
              className={editMode ? "fixed inset-0 z-[200] flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] overflow-hidden" : "flex-1 flex flex-col bg-[var(--bg-card)] text-[var(--text-primary)] relative"}
            >
              <style>{COUNTER_CSS}</style>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onImageSelected} />
              <input ref={wordImportInputRef} type="file" accept=".docx" className="hidden" onChange={onWordFileSelected} />
              {!active ? (
                <div className="p-8 text-sm text-[var(--text-muted)]">
                  {chapters.length === 0 ? "Brak rozdziałów — dodaj pierwszy w panelu po lewej." : "Wybierz rozdział z listy."}
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
                    <div className="w-8 h-px bg-[var(--border-color)] my-1" />
                    <RailButton icon="🖨" label="Podgląd" onClick={openPrintPreview} />
                    <RailButton
                      icon="🖥"
                      label="Dopasuj"
                      active={fitToScreen}
                      title="Dopasuj szerokość pola roboczego do szerokości ekranu"
                      onClick={() => setFitToScreen((v) => !v)}
                    />
                    <RailButton icon="📖" label="2 strony" active={twoPageView} title="Podgląd podziału na strony" onClick={() => setTwoPageView((v) => !v)} />
                    <div className="flex flex-col items-center gap-0.5 w-12">
                      <button onClick={() => setZoomLevel((z) => Math.min(200, z + 10))} title="Powiększ" className="w-8 h-6 rounded text-xs border border-[var(--border-color)] transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90">＋</button>
                      <button onClick={() => setZoomLevel(100)} title="Resetuj powiększenie" className="text-[10px] text-[var(--text-secondary)]">{zoomLevel}%</button>
                      <button onClick={() => setZoomLevel((z) => Math.max(50, z - 10))} title="Pomniejsz" className="w-8 h-6 rounded text-xs border border-[var(--border-color)] transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90">－</button>
                    </div>
                    {editMode && canEdit && (
                      <>
                        <div className="w-8 h-px bg-[var(--border-color)] my-1" />
                        <RailButton icon="🔗" label="Zmienne" title="Zmienne referencyjne" onClick={() => setShowVarsPanel(true)} />
                        <RailButton icon="🧹" label="Wklej tekst" title="Wklej jako zwykły tekst (bez formatowania Worda)" onClick={openPlainPasteModal} />
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
                  <div className="flex-1 flex flex-col overflow-hidden">
                  {editMode && canEdit && (
                    <div
                      className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-color)] flex-wrap bg-[var(--bg-card)]"
                      onMouseDown={onEditWinDragStart}
                      style={{ cursor: "move" }}
                    >
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value === "<h4>") applySectionStyle();
                            else if (e.target.value) exec("formatBlock", e.target.value);
                            e.target.value = "";
                          }}
                          className="text-xs h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] px-1 transition-colors hover:border-[var(--accent)]"
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
                          className="text-xs h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] px-1 transition-colors hover:border-[var(--accent)]"
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
                        <button onClick={() => exec("bold")} className="text-xs w-8 h-8 font-bold rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">B</button>
                        <button onClick={() => exec("italic")} className="text-xs w-8 h-8 italic rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">I</button>
                        <button onClick={() => exec("insertUnorderedList")} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">• Lista</button>
                        <button onClick={() => setAlignment("left")} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">⬛L</button>
                        <button onClick={() => setAlignment("center")} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">⬛C</button>
                        <button onClick={() => setAlignment("right")} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">⬛R</button>
                        <button onClick={() => setAlignment("justify")} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">⬛J</button>
                        <span className="w-px h-5 bg-[#ccc] mx-1" />
                        <button onClick={insertImage} disabled={imageUploading} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20 disabled:opacity-50">
                          {imageUploading ? "⏳ Przesyłam na Drive…" : "🖼 Obraz"}
                        </button>
                        <button onClick={insertPageBreak} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">⏎ Podział strony</button>
                        <button onClick={insertTable} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">🔲 Tabela</button>
                        <button onClick={insertWordDoc} disabled={wordImporting} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20 disabled:opacity-50">
                          {wordImporting ? "Importuję…" : "📄 Import z Worda"}
                        </button>
                        <button onClick={addComment} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">💬 Komentarz</button>
                        {selectedTableEl && (
                          <>
                            <span className="w-px h-5 bg-[#ccc] mx-1" />
                            <button onClick={addTableRow} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">+Wiersz</button>
                            <button onClick={removeTableRow} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">-Wiersz</button>
                            <button onClick={addTableColumn} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">+Kolumna</button>
                            <button onClick={removeTableColumn} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">-Kolumna</button>
                            <button onClick={openResizeTable} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20">📐 Rozmiar</button>
                            <button onClick={deleteTable} className="text-xs px-2 h-8 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm transition-all duration-100 hover:border-[var(--accent)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-90 active:bg-[var(--accent)]/20 text-red-600">🗑 Usuń tabelę</button>
                          </>
                        )}
                        <span className="text-[10px] text-[var(--text-muted)]">(albo przeciągnij plik na edytor)</span>
                    </div>
                  )}
                  <div className="flex-1 flex overflow-hidden">
                  <div ref={commentAreaRef} className={"relative overflow-auto bg-[var(--bg-page)] py-6 " + ((twoPageView && editMode) ? "w-1/2 shrink-0 border-r border-[var(--border-color)]" : "flex-1")}>
                  {!editMode && active && (
                    <iframe title="Podgląd rozdziału" srcDoc={readViewHtml} className="mx-auto block w-full" style={{ maxWidth: 900, minHeight: "calc(100vh - 200px)", border: "none" }} />
                  )}
                    <div
                      ref={pageRef}
                      className={"mx-auto bg-[var(--paper-bg)] text-black shadow-lg relative " + (!editMode ? "hidden" : "")}
                      style={{
                        width: "210mm",
                        maxWidth: "210mm",
                        minHeight: "297mm",
                        boxSizing: "border-box",
                        padding: `${hfSettings.headerHeightCm}cm 1.27cm ${hfSettings.footerHeightCm}cm 1.27cm`,
                        transform: `scale(${zoomLevel / 100})`,
                        transformOrigin: "top center",
                      }}
                    >
                    {loadingChapterContent && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-card)]/80 text-sm text-[var(--text-muted)]">
                        Ładowanie treści rozdziału…
                      </div>
                    )}
                    {Array.from({ length: Math.max(1, Math.ceil(contentHeightPx / A4_HEIGHT_PX)) - 1 }).map((_, pageIdx) => (
                      <div
                        key={pageIdx}
                        className="absolute left-0 right-0 box-border pointer-events-none select-none text-center"
                        style={{ top: (pageIdx + 1) * A4_HEIGHT_PX - 10 }}
                        title="Tu fizycznie kończy się strona A4 (przybliżenie - patrz dokładny podgląd po prawej)"
                      >
                        <div className="border-t-2 border-dashed border-[#4fc3f7]" />
                        <span className="inline-block -mt-2.5 px-2 bg-[var(--paper-bg)] text-[10px] text-[#4fc3f7]">
                          — koniec strony {pageIdx + 1} —
                        </span>
                      </div>
                    ))}
                    <div
                      id="doc-editor-content"
                      ref={editorRef}
                      contentEditable={editMode && canEdit}
                      onFocus={() => {
                        // Wymusza <p> jako tag przy Enter (nie <div>/inny),
                        // żeby akapit wpisany Enterem miał te same,
                        // jednakowe odstępy co akapit wklejony przez
                        // "Wklej tekst" (ta sama reguła CSS margin:0 wyżej).
                        try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {}
                      }}
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
                        if (twoPageView) setTwoPageTick((t) => t + 1);
                      }}
                      onClick={onEditorClick}
                      onKeyUp={(e) => {
                        // Nawigacja klawiaturą (strzałki/Home/End/PgUp/PgDn)
                        // też przesuwa kursor bez zmiany treści.
                        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
                          scrollTwoPageToCaret();
                        }
                      }}
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
                    {pageMarkers.map((y, i) => (
                      <div
                        key={i}
                        className="absolute left-0 right-0 h-[5px] bg-[#888] pointer-events-none select-none"
                        style={{ top: y }}
                        title="Koniec fizycznej strony A4"
                      />
                    ))}
                    </div>
                    {selectedImg && imgToolbarPos && editMode && canEdit && (
                      <div
                        className="absolute flex items-center gap-1 bg-[#1a1a2e] rounded shadow-lg px-1.5 py-1 z-10"
                        style={{ top: Math.max(imgToolbarPos.top, 0), left: imgToolbarPos.left }}
                      >
                        <button onClick={() => alignImage("left")} title="Wyrównaj do lewej, tekst opływa z prawej" className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[var(--text-secondary)]">⬅</button>
                        <button onClick={() => alignImage("center")} title="Wyśrodkuj" className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[var(--text-secondary)]">⬛</button>
                        <button onClick={() => alignImage("right")} title="Wyrównaj do prawej, tekst opływa z lewej" className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[var(--text-secondary)]">➡</button>
                        <span className="w-px h-4 bg-[#555] mx-0.5" />
                        <button onClick={() => resizeImage(25)} className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[var(--text-secondary)]">25%</button>
                        <button onClick={() => resizeImage(50)} className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[var(--text-secondary)]">50%</button>
                        <button onClick={() => resizeImage(100)} className="text-[10px] px-1.5 py-0.5 rounded border border-[#555] text-[var(--text-secondary)]">100%</button>
                        <span className="w-px h-4 bg-[#555] mx-0.5" />
                        <button onClick={removeSelectedImage} title="Usuń obraz" className="text-[10px] px-1.5 py-0.5 rounded border border-red-400 text-red-400">✕</button>
                      </div>
                    )}
                    {selectedImg && handlePos && editMode && canEdit && (
                      <div
                        onMouseDown={startResizeDrag}
                        title="Przeciągnij, żeby zmienić rozmiar"
                        className="absolute w-4 h-4 rounded-full bg-[var(--accent)] border-2 border-white shadow z-10 cursor-nwse-resize"
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
                            className="w-full text-xs p-1.5 rounded border border-amber-300 bg-white text-[var(--text-secondary)]"
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
                  {twoPageView && editMode && (
                    <div className="w-1/2 shrink-0 overflow-auto bg-[#888] flex flex-col">
                      <div className="text-[10px] text-white bg-[#555] px-3 py-1.5">📖 Podgląd podziału na strony{editMode ? " (odśwież. co 0,5s po edycji)" : ""}</div>
                      <iframe
                        ref={twoPageIframeRef}
                        title="Podgląd stron"
                        srcDoc={twoPageHtml}
                        className="flex-1 w-full"
                        style={{ border: "none" }}
                      />
                    </div>
                  )}
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
        <div className="fixed inset-0 z-[400]" onClick={() => setShowSettings(false)}>
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
              <button onClick={() => setShowSettings(false)} className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">✕</button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
            <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent-light)] p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p className="font-semibold text-[var(--accent-text)] mb-1">ⓘ Jak to działa</p>
              <p className="mb-1">
                Te ustawienia są wspólne dla <b>całej instrukcji tego urządzenia</b> (nie per rozdział) i identyczne w podglądzie wydruku,
                eksporcie PDF i eksporcie Word.
              </p>
              <p>
                Nagłówek ma osobne pola <b>Lewo / Środek / Prawo</b> dla stron <b>nieparzystych</b> i osobne dla <b>parzystych</b> —
                puste pole parzyste kopiuje treść z nieparzystego. Stopka jest wspólna dla wszystkich stron.
              </p>
            </div>

            <div>
              <div className="text-xs text-[var(--text-secondary)] mb-1">Tekst nagłówka (pusty = domyślnie nazwa urządzenia)</div>
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
              <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Anuluj</button>
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

      {showTableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowTableModal(false)}>
          <div className="bg-[var(--bg-card)] text-[var(--text-primary)] rounded-lg p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--accent-text)]">🔲 {tableModalMode === "resize" ? "Zmień rozmiar tabeli" : "Wstaw tabelę"}</h3>
            <label className="block text-xs text-[var(--text-secondary)]">
              Liczba wierszy
              <input
                type="number" min={1} max={30}
                value={tableDraft.rows}
                onChange={(e) => setTableDraft((d) => ({ ...d, rows: parseInt(e.target.value, 10) || 1 }))}
                className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
              />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
              Liczba kolumn
              <input
                type="number" min={1} max={12}
                value={tableDraft.cols}
                onChange={(e) => setTableDraft((d) => ({ ...d, cols: parseInt(e.target.value, 10) || 1 }))}
                className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
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
            <label className="block text-xs text-[var(--text-secondary)]">
              Szerokość kolumny (cm, puste = auto)
              <input
                type="number" min={0} step={0.1}
                value={tableDraft.colWidthCm}
                onChange={(e) => setTableDraft((d) => ({ ...d, colWidthCm: e.target.value }))}
                className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
                placeholder="np. 10"
              />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
              Wysokość wiersza (cm, puste = auto)
              <input
                type="number" min={0} step={0.1}
                value={tableDraft.rowHeightCm}
                onChange={(e) => setTableDraft((d) => ({ ...d, rowHeightCm: e.target.value }))}
                className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm mt-1"
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
              <button onClick={() => setShowTableModal(false)} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Anuluj</button>
              <button onClick={confirmInsertTable} className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white">{tableModalMode === "resize" ? "Zastosuj" : "Wstaw"}</button>
            </div>
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
            if (chapterId === activeIdRef.current && !dirty && editorRef.current) {
              editorRef.current.innerHTML = newHtml || "<p></p>";
              repairTableBorders(editorRef.current);
              applyLiveHeadingNumbers(editorRef.current, h1Offset);
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
      {showPlainPasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500]" onClick={() => setShowPlainPasteModal(false)}>
          <div className="bg-[var(--bg-card)] text-[var(--text-primary)] rounded-lg p-5 w-full max-w-3xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">🧹 Wklej jako zwykły tekst</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Wklej tekst poniżej (Ctrl+V) — cały format Worda zostanie odrzucony, każda linia trafi do dokumentu jako zwykły akapit "Normal".
            </p>
            <textarea
              autoFocus
              value={plainPasteText}
              onChange={(e) => setPlainPasteText(e.target.value)}
              rows={22}
              className="w-full border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] rounded px-2 py-1.5 text-sm font-mono resize-y"
              style={{ minHeight: "60vh" }}
              placeholder="Wklej tutaj..."
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowPlainPasteModal(false)} className="px-3 py-1.5 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)]">Anuluj</button>
              <button
                onClick={insertPlainPasteText}
                disabled={!plainPasteText.trim()}
                className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white"
              >
                Wstaw jako Normal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
