import { useEffect, useRef, useState } from "react";

type Chapter = { id: number; title: string; contentHtml: string; order: number };

type TocEntry = { level: number; text: string; anchor: string };

// Parses a chapter's HTML, injects sequential numbering (N, N.1, N.1.1) into
// its h2/h3 headings plus a named anchor before each, and returns both the
// rewritten HTML and the flat list of TOC entries it produced. No COM/
// Interop needed — Word opens named <a> anchors as real, clickable
// bookmarks, so a plain link list acts as a working (if not
// auto-refreshing) table of contents.
function numberChapter(chapterIndex: number, title: string, contentHtml: string): { html: string; toc: TocEntry[] } {
  const doc = new DOMParser().parseFromString(`<div>${contentHtml}</div>`, "text/html");
  const container = doc.body.firstElementChild as HTMLElement;
  const chapterAnchor = `chapter${chapterIndex}`;
  const toc: TocEntry[] = [{ level: 1, text: `${chapterIndex}. ${title}`, anchor: chapterAnchor }];
  let h2 = 0;
  let h3 = 0;
  container.querySelectorAll("h2, h3").forEach((el) => {
    if (el.tagName === "H2") {
      h2 += 1;
      h3 = 0;
      const anchor = `${chapterAnchor}_h2_${h2}`;
      const num = `${chapterIndex}.${h2}`;
      el.innerHTML = `<a name="${anchor}"></a>${num}\u00A0${el.innerHTML}`;
      toc.push({ level: 2, text: `${num} ${el.textContent || ""}`, anchor });
    } else {
      h3 += 1;
      const anchor = `${chapterAnchor}_h3_${h2}_${h3}`;
      const num = `${chapterIndex}.${h2}.${h3}`;
      el.innerHTML = `<a name="${anchor}"></a>${num}\u00A0${el.innerHTML}`;
      toc.push({ level: 3, text: `${num} ${el.textContent || ""}`, anchor });
    }
  });
  const html = `<a name="${chapterAnchor}"></a><h1>${chapterIndex}. ${title}</h1>${container.innerHTML}`;
  return { html, toc };
}

function buildTocHtml(toc: TocEntry[]): string {
  const rows = toc
    .map((e) => `<p style="margin:2px 0 2px ${(e.level - 1) * 18}px; ${e.level === 1 ? "font-weight:bold;" : ""}"><a href="#${e.anchor}">${e.text}</a></p>`)
    .join("\n");
  return `<h1>Spis treści</h1>${rows}`;
}

function wordExportHtml(deviceLabel: string, chapters: Chapter[]): string {
  const numbered = chapters.map((ch, i) => numberChapter(i + 1, ch.title, ch.contentHtml));
  const toc = numbered.flatMap((n) => n.toc);
  const body = numbered
    .map((n) => `${n.html}<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>`)
    .join("\n");
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name=ProgId content=Word.Document/>
<meta name=Generator content="Microsoft Word 15"/>
<!--[if gte mso 9]><xml>
 <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
</xml><![endif]-->
<style>
  body { font-family: Calibri, Arial, sans-serif; }
  h1 { color: #1a1a8c; font-size: 18pt; }
  h2 { font-size: 14pt; }
  h3 { font-size: 12pt; }
</style>
</head>
<body>
<h1 style="text-align:center;">Instrukcja obsługi — ${deviceLabel}</h1>
<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>
${buildTocHtml(toc)}
<br clear="all" style="mso-special-character:line-break;page-break-before:always"/>
${body}
</body></html>`;
}

export function DeviceManualPanel({ actor, deviceId, deviceLabel }: { actor: any; deviceId: number; deviceLabel: string }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);

  const reload = async () => {
    const rows = await actor.listDeviceManualChapters(deviceId);
    const mapped: Chapter[] = rows.map((r: any) => ({ id: Number(r.id), title: r.title, contentHtml: r.contentHtml, order: Number(r.order) }));
    setChapters(mapped);
    if (mapped.length && activeId === null) setActiveId(mapped[0].id);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [actor, deviceId]);

  const active = chapters.find((c) => c.id === activeId) || null;

  useEffect(() => {
    setEditMode(false);
    setDirty(false);
    if (editorRef.current && active) editorRef.current.innerHTML = active.contentHtml || "<p></p>";
  }, [activeId]);

  const addChapter = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const newId = await actor.createDeviceManualChapter(deviceId, title);
    setNewTitle("");
    await reload();
    setActiveId(Number(newId));
  };

  const deleteChapter = async (id: number) => {
    if (!confirm("Usunąć ten rozdział? Tego nie da się cofnąć.")) return;
    await actor.deleteDeviceManualChapter(id);
    if (activeId === id) setActiveId(null);
    reload();
  };

  const moveChapter = async (id: number, direction: "up" | "down") => {
    await actor.moveDeviceManualChapter(id, { [direction]: null });
    reload();
  };

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    setDirty(true);
  };

  const saveChapter = async () => {
    if (!active || !editorRef.current) return;
    const html = editorRef.current.innerHTML;
    await actor.updateDeviceManualChapter(active.id, active.title, html, "");
    setDirty(false);
    reload();
  };

  const exportWord = () => {
    const html = wordExportHtml(deviceLabel, chapters);
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Instrukcja_${deviceLabel.replace(/[^\w-]/g, "_")}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const numbered = chapters.map((ch, i) => numberChapter(i + 1, ch.title, ch.contentHtml));
    const toc = numbered.flatMap((n) => n.toc);
    const html = numbered.map((n) => `${n.html}<div style="page-break-after: always;"></div>`).join("\n");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Instrukcja — ${deviceLabel}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;} h1{color:#1a1a8c;} h2{font-size:14pt;} h3{font-size:12pt;} a{color:inherit;text-decoration:none;}</style>
      </head><body><h1 style="text-align:center;">Instrukcja obsługi — ${deviceLabel}</h1>
      <div style="page-break-after: always;"></div>
      ${buildTocHtml(toc)}
      <div style="page-break-after: always;"></div>
      ${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  if (loading) return <div className="text-xs text-[var(--text-secondary)]">Wczytywanie instrukcji…</div>;

  return (
    <div className="border border-[var(--border-color-light)] rounded-lg overflow-hidden mt-3">
      <div className="bg-[var(--bg-page)] px-3 py-2 border-b border-[var(--border-color-light)] flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">📖 Instrukcja obsługi</h3>
        <div className="flex gap-2">
          <button onClick={exportPdf} disabled={chapters.length === 0} className="text-xs px-2 py-1 rounded border border-[var(--border-color)] disabled:opacity-40">
            🖨 Eksportuj PDF
          </button>
          <button onClick={exportWord} disabled={chapters.length === 0} className="text-xs px-2 py-1 rounded border border-[var(--border-color)] disabled:opacity-40">
            📄 Eksportuj Word
          </button>
        </div>
      </div>

      <div className="flex" style={{ minHeight: 300 }}>
        <div className="w-48 shrink-0 border-r border-[var(--border-color-light)] bg-[var(--bg-page)] p-2 space-y-1">
          {chapters.map((ch) => (
            <div key={ch.id} className={"group flex items-center gap-1 rounded px-2 py-1.5 text-xs cursor-pointer " + (ch.id === activeId ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--bg-card)]")}>
              <span onClick={() => setActiveId(ch.id)} className="flex-1 truncate">{ch.title}</span>
              <button onClick={() => moveChapter(ch.id, "up")} className="opacity-0 group-hover:opacity-100 text-[10px]">↑</button>
              <button onClick={() => moveChapter(ch.id, "down")} className="opacity-0 group-hover:opacity-100 text-[10px]">↓</button>
              <button onClick={() => deleteChapter(ch.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-red-300">✕</button>
            </div>
          ))}
          <div className="flex gap-1 pt-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addChapter()}
              placeholder="+ Nowy rozdział"
              className="flex-1 min-w-0 border border-[var(--border-color)] rounded px-1.5 py-1 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          {!active ? (
            <div className="p-4 text-xs text-[var(--text-secondary)]">Wybierz rozdział z listy albo dodaj nowy.</div>
          ) : (
            <>
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color-light)] flex-wrap">
                <button onClick={() => setEditMode((m) => !m)} className="text-xs px-2 py-1 rounded border border-[var(--border-color)]">
                  {editMode ? "✏ Edytuję" : "✏ Edytuj"}
                </button>
                {editMode && (
                  <>
                    <span className="w-px h-4 bg-[var(--border-color-light)] mx-1" />
                    <button onClick={() => exec("bold")} className="text-xs w-7 h-7 font-bold rounded border border-[var(--border-color)]">B</button>
                    <button onClick={() => exec("italic")} className="text-xs w-7 h-7 italic rounded border border-[var(--border-color)]">I</button>
                    <button onClick={() => exec("formatBlock", "<h2>")} className="text-xs px-2 h-7 rounded border border-[var(--border-color)]">H2</button>
                    <button onClick={() => exec("formatBlock", "<h3>")} className="text-xs px-2 h-7 rounded border border-[var(--border-color)]">H3</button>
                    <button onClick={() => exec("formatBlock", "<p>")} className="text-xs px-2 h-7 rounded border border-[var(--border-color)]">P</button>
                    <button onClick={() => exec("insertUnorderedList")} className="text-xs px-2 h-7 rounded border border-[var(--border-color)]">• Lista</button>
                    <span className="w-px h-4 bg-[var(--border-color-light)] mx-1" />
                    <button
                      onClick={saveChapter}
                      disabled={!dirty}
                      className="text-xs px-3 h-7 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white"
                    >
                      💾 Zapisz
                    </button>
                  </>
                )}
              </div>
              <div
                ref={editorRef}
                contentEditable={editMode}
                onInput={() => setDirty(true)}
                suppressContentEditableWarning
                className="flex-1 p-4 text-sm overflow-auto outline-none"
                style={{ minHeight: 240 }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
