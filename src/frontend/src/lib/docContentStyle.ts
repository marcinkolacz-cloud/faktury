// JEDNO źródło wyglądu treści dokumentu (Calibri, rozmiary p/h1/h2/h3,
// listy, tabele, komentarze, interlinia). Używane przez:
//  - żywy edytor (DocumentationEditorTiptapPoC.tsx, scope "#doc-editor-content")
//  - podgląd/PDF (DocumentationModule.tsx buildChapterPreviewHtml, scope ".page-content")
// Wcześniej te dwa miejsca miały każde swoją kopię (COUNTER_CSS vs
// previewCounterCss) i po migracji na Tiptap "#doc-editor-content" przestał
// być podpięty w edytorze w ogóle, więc żywy edytor renderował się na
// domyślnych stylach przeglądarki zamiast na tym wyglądzie - stąd rozjazd
// wysokości akapitów między edytorem a podglądem. Trzymanie tego w jednym
// miejscu ma to uniemożliwić na przyszłość.
export const DOC_CONTENT_LINE_HEIGHT = 1.625;

export function docContentCss(selector: string): string {
  return `
${selector} { font-family: Calibri, "Segoe UI", Arial, sans-serif; line-height: ${DOC_CONTENT_LINE_HEIGHT}; }
${selector} p, ${selector} div, ${selector} li { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #000; font-weight: normal; font-size: 10pt; margin: 0; }
${selector} ul { list-style: disc outside; padding-left: 24px; margin: 0; }
${selector} ol { list-style: decimal outside; padding-left: 24px; margin: 0; }
${selector} li { list-style: inherit; display: list-item; }
${selector} h1 { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 28pt; color: #000; font-weight: bold; margin: 18px 0 10px; }
${selector} h1::before { content: attr(data-num); }
${selector} h2 { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 18pt; color: #000; font-weight: bold; margin: 14px 0 8px; }
${selector} h2::before { content: attr(data-num); }
${selector} h3 { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 14pt; color: #000; font-weight: bold; margin: 10px 0 6px; }
${selector} h3::before { content: attr(data-num); }
${selector} img { max-width: 100%; height: auto; }
${selector} .manual-page-break { border-top: 2px dashed #4fc3f7; text-align: center; color: #4fc3f7; font-size: 10px; margin: 16px 0; user-select: none; }
${selector} .manual-page-break::before { content: attr(data-label); }
${selector} table { border-collapse: collapse; }
${selector} table, ${selector} td, ${selector} th { border-style: solid !important; border-width: 1px !important; border-color: var(--text-secondary) !important; }
${selector} td[style*="background:#eee"], ${selector} th[style*="background:#eee"] { background: var(--bg-hover) !important; }
${selector} table td, ${selector} table th { resize: both; overflow: hidden; }
${selector} .doc-comment-anchor { background: #fff3b0; border-bottom: 2px solid #e6b800; cursor: pointer; }
${selector} .doc-comment-anchor.doc-comment-active { background: #ffe066; }
`;
}
