import { isTocHeadingTitle } from "./headingNumbering";

// Jedno zrodlo prawdy dla wpisow spisu tresci - uzywane zarowno przez
// zywy edytor (klikalna lista, TocField node) jak i Podglad/PDF/eksport
// (buildChapterPreviewHtml). H1/H2/H3 dostaja standardowy numer "N.M.K"
// (tak samo jak numberHeadingsForExport w DocumentationModule.tsx, ta sama
// logika liczenia ciaglego przez rozdzialy) - H4 ("Sekcja", patrz
// SECTION_STYLE w DocumentationEditorTiptapPoC.tsx) NIE dostaje numeru,
// pokazuje tylko wpisany tekst, bo z definicji jest POZA numeracja
// h1/h2/h3. Naglowek samego spisu tresci ("Spis tresci") jest pomijany,
// zeby nie linkowac sam do siebie.
export type TocEntry = {
  level: 1 | 2 | 3 | 4;
  number: string | null;
  text: string;
  chapterId: number;
  headingIndex: number; // ktory to z kolei h1..h4 w tym rozdziale (0-based)
};

export function buildTocEntries(
  chapters: { id: number; contentHtml: string }[],
  includeIds?: Set<number>
): TocEntry[] {
  let h1 = 0, h2 = 0, h3 = 0;
  const entries: TocEntry[] = [];
  chapters.forEach((ch) => {
    const doc = new DOMParser().parseFromString(ch.contentHtml || "", "text/html");
    const include = !includeIds || includeIds.has(ch.id);
    let headingIndex = -1;
    doc.body.querySelectorAll("h1, h2, h3, h4").forEach((el) => {
      headingIndex += 1;
      const text = (el.textContent || "").trim();
      if (!text || isTocHeadingTitle(text)) return;
      const tag = el.tagName;
      let number: string | null = null;
      if (tag === "H1") { h1 += 1; h2 = 0; h3 = 0; number = `${h1}.`; }
      else if (tag === "H2") { h2 += 1; h3 = 0; number = `${h1}.${h2}.`; }
      else if (tag === "H3") { h3 += 1; number = `${h1}.${h2}.${h3}.`; }
      if (!include) return;
      const level = (tag === "H1" ? 1 : tag === "H2" ? 2 : tag === "H3" ? 3 : 4) as 1 | 2 | 3 | 4;
      entries.push({ level, number, text, chapterId: ch.id, headingIndex });
    });
  });
  return entries;
}

const LEVEL_INDENT_PX = 20;

// Wspolny wyglad wpisu spisu tresci (uzywany zarowno przez zywy DOM w
// edytorze jak i przez string-owy HTML w Podgladzie/PDF) - bez numeru
// strony (na razie), sama hierarchia wciec + numer (H1-H3) / sam tekst
// (H4/Sekcja).
export function tocEntryHtml(entry: TocEntry): string {
  const numHtml = entry.number ? `<span class="doc-toc-num">${entry.number}\u00A0</span>` : "";
  const weight = entry.level <= 1 ? "font-weight:bold;" : "";
  const upper = entry.level === 4 ? "text-transform:uppercase;letter-spacing:0.5px;" : "";
  return `<div class="doc-toc-entry" data-toc-chapter="${entry.chapterId}" data-toc-heading-index="${entry.headingIndex}" style="padding-left:${(entry.level - 1) * LEVEL_INDENT_PX}px;${weight}${upper}">${numHtml}${entry.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
}

export function buildTocListHtml(entries: TocEntry[]): string {
  if (entries.length === 0) {
    return `<div class="doc-toc-empty">(brak nagłówków do wypisania)</div>`;
  }
  return entries.map(tocEntryHtml).join("");
}
