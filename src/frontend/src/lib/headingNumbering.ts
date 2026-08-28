// Single source of truth for which heading titles are excluded from
// automatic numbering (the "Spis treści" / "Table of contents" chapter
// heading itself must never get a "1." prefix).
//
// This used to be defined twice, independently, and had already diverged:
//   - DocumentationModule.tsx (Word export / print numbering) used a regex
//     tolerant of the "ś" vs "s" variant: /^spis tre[śs]ci$/i
//   - DocumentationEditorTiptapPoC.tsx (live editor numbering) used a plain
//     EXCLUDED_TITLES.includes(text) exact-string check requiring the
//     diacritic — so a chapter titled "Spis tresci" (no diacritic) was
//     excluded from Word export numbering but NOT from live editor
//     numbering, producing visibly different numbers between the two.
// Both call sites now import this instead of keeping their own copy.
const TOC_TITLE_RE = /^table of contents$|^spis tre[śs]ci$/i;

export function isTocHeadingTitle(text: string): boolean {
  return TOC_TITLE_RE.test((text || "").trim());
}
