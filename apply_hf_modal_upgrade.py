import sys, pathlib

path = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = path.read_text(encoding="utf-8")

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"BLAD: '{label}' wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
        sys.exit(1)
    return src.replace(old, new)

# KROK 1: typ + localStorage helpers + defaults
old1 = '''type HeaderFooterSettings = {
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
};'''
new1 = '''type HeaderFooterSettings = {
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
  headerTextEven: string;
  footerTextLeft: string;
  footerTextRight: string;
  enableHeader: boolean;
  enableFooter: boolean;
};

const HF_EXTRA_STORAGE_KEY = "faktury_doc_hf_extra_v1";

function loadHfExtras(): Pick<HeaderFooterSettings, "headerTextEven" | "footerTextLeft" | "footerTextRight" | "enableHeader" | "enableFooter"> {
  try {
    const raw = localStorage.getItem(HF_EXTRA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        headerTextEven: parsed.headerTextEven ?? "",
        footerTextLeft: parsed.footerTextLeft ?? "",
        footerTextRight: parsed.footerTextRight ?? "",
        enableHeader: parsed.enableHeader ?? true,
        enableFooter: parsed.enableFooter ?? true,
      };
    }
  } catch { /* fall back to defaults below */ }
  return { headerTextEven: "", footerTextLeft: "", footerTextRight: "", enableHeader: true, enableFooter: true };
}

function saveHfExtras(s: HeaderFooterSettings) {
  try {
    localStorage.setItem(HF_EXTRA_STORAGE_KEY, JSON.stringify({
      headerTextEven: s.headerTextEven,
      footerTextLeft: s.footerTextLeft,
      footerTextRight: s.footerTextRight,
      enableHeader: s.enableHeader,
      enableFooter: s.enableFooter,
    }));
  } catch { /* localStorage unavailable - extras just won't persist */ }
}

const DEFAULT_HF_SETTINGS: HeaderFooterSettings = {
  headerText: "",
  footerText: "Bartolini Air Simulation",
  logoDataUri: "",
  skipFirstPage: true,
  showPageNumbers: true,
  headerTextEven: "",
  footerTextLeft: "",
  footerTextRight: "",
  enableHeader: true,
  enableFooter: true,
};'''
src = rep(src, old1, new1, "KROK1 typ+defaults")

# KROK 2: load merge
old2 = '''    actor.getDocHeaderFooterSettings().then((res: any) => {
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
    }).catch(() => { /* fall back to defaults */ });'''
new2 = '''    actor.getDocHeaderFooterSettings().then((res: any) => {
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
        setHfSettings((prev) => ({ ...prev, ...extras }));
      }
    }).catch(() => { /* fall back to defaults */ });'''
src = rep(src, old2, new2, "KROK2 load merge")

# KROK 3: save extras
old3 = '''      setHfSettings(hfDraft);
      setShowSettings(false);
    } catch (e: any) {
      alert("Błąd zapisu ustawień: " + (e?.message || String(e)));
    }
  };'''
new3 = '''      setHfSettings(hfDraft);
      saveHfExtras(hfDraft);
      setShowSettings(false);
    } catch (e: any) {
      alert("Błąd zapisu ustawień: " + (e?.message || String(e)));
    }
  };'''
src = rep(src, old3, new3, "KROK3 save extras")

# KROK 4a: header/footer var declarations
old4a = '''    const headerHtml = hfSettings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`;
    const footerHtml = hfSettings.footerText.trim() || "Bartolini Air Simulation";
    const numbered = numberHeadingsForExport(await getChaptersForExport(), selectedForPrint);'''
new4a = '''    const headerHtml = hfSettings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`;
    const headerHtmlEven = hfSettings.headerTextEven.trim() || headerHtml;
    const footerHtml = hfSettings.footerText.trim() || "Bartolini Air Simulation";
    const footerLeftHtml = hfSettings.footerTextLeft.trim();
    const footerRightHtml = hfSettings.footerTextRight.trim();
    const numbered = numberHeadingsForExport(await getChaptersForExport(), selectedForPrint);'''
n4a = src.count(old4a)
if n4a == 0:
    # sync variant fallback (no await)
    old4a = old4a.replace("await getChaptersForExport()", "getChaptersForExport()")
    new4a = new4a.replace("await getChaptersForExport()", "getChaptersForExport()")
src = rep(src, old4a, new4a, "KROK4a header/footer vars")

# KROK 4b: footer CSS -> 3 cell flex
old4b = '.page-footer{position:absolute;left:1.27cm;right:1.27cm;bottom:0;box-sizing:border-box;padding:6px 0;font-size:9pt;color:#555;border-top:1px solid #ccc;text-align:center;}'
new4b = '.page-footer{position:absolute;left:1.27cm;right:1.27cm;bottom:0;box-sizing:border-box;padding:6px 0;font-size:9pt;color:#555;border-top:1px solid #ccc;display:flex;align-items:center;justify-content:space-between;}'
src = rep(src, old4b, new4b, "KROK4b footer CSS")

# KROK 4c: script vars
old4c = '''        var headerHtml = ${JSON.stringify(headerHtml)};
        var footerHtml = ${JSON.stringify(footerHtml)};
        var skipFirst = ${hfSettings.skipFirstPage ? "true" : "false"};'''
new4c = '''        var headerHtml = ${JSON.stringify(headerHtml)};
        var headerHtmlEven = ${JSON.stringify(headerHtmlEven)};
        var footerHtml = ${JSON.stringify(footerHtml)};
        var footerLeftHtml = ${JSON.stringify(footerLeftHtml)};
        var footerRightHtml = ${JSON.stringify(footerRightHtml)};
        var skipFirst = ${hfSettings.skipFirstPage ? "true" : "false"};
        var enableHeader = ${hfSettings.enableHeader ? "true" : "false"};
        var enableFooter = ${hfSettings.enableFooter ? "true" : "false"};'''
src = rep(src, old4c, new4c, "KROK4c script vars")

# KROK 4d: page building loop
old4d = '''          pagesEl.innerHTML = pages.map(function(html, i){
            var isFirst = i === 0;
            var showHF = !(isFirst && skipFirst);
            return '<div class="sheet">' +
              (showHF ? '<div class="page-header">' + headerHtml + '</div>' : '<div class="page-header" style="visibility:hidden"></div>') +
              '<div class="page-content">' + html + '</div>' +
              (showHF ? '<div class="page-footer">' + footerHtml + '</div>' : '<div class="page-footer" style="visibility:hidden"></div>') +
              '<div class="page-number">Strona ' + (i + 1) + ' / ' + pages.length + '</div>' +
            '</div>';
          }).join('');'''
new4d = '''          pagesEl.innerHTML = pages.map(function(html, i){
            var isFirst = i === 0;
            var isOdd = (i + 1) % 2 === 1;
            var hideThisPage = isFirst && skipFirst;
            var showHeader = enableHeader && !hideThisPage;
            var showFooter = enableFooter && !hideThisPage;
            var thisHeaderHtml = isOdd ? headerHtml : headerHtmlEven;
            var footerRowHtml = '<span>' + footerLeftHtml + '</span><span>' + footerHtml + '</span><span>' + footerRightHtml + '</span>';
            return '<div class="sheet">' +
              (showHeader ? '<div class="page-header">' + thisHeaderHtml + '</div>' : '') +
              '<div class="page-content">' + html + '</div>' +
              (showFooter ? '<div class="page-footer">' + footerRowHtml + '</div>' : '') +
              '<div class="page-number">Strona ' + (i + 1) + ' / ' + pages.length + '</div>' +
            '</div>';
          }).join('');'''
src = rep(src, old4d, new4d, "KROK4d page loop")

# KROK 5: editor overlay
old5 = '''                    >
                    <div
                      id="doc-editor-content"
                      ref={editorRef}
                      contentEditable={editMode && canEdit}'''
new5 = '''                    >
                    {hfSettings.enableHeader && (
                      <div
                        className="absolute top-0 left-[1.27cm] right-[1.27cm] h-[3.75cm] box-border pointer-events-none select-none flex items-end pb-1.5 text-[9pt] text-[#888] border-b border-[#ccc]"
                        title="Nagłówek — edytuj przez ⚙️ Nagłówek/stopka"
                      >
                        {hfSettings.headerText.trim() || `${deviceLabel} — Instrukcja obsługi`}
                      </div>
                    )}
                    {hfSettings.enableFooter && (
                      <div
                        className="absolute bottom-0 left-[1.27cm] right-[1.27cm] box-border pointer-events-none select-none flex items-center justify-between pt-1.5 text-[9pt] text-[#888] border-t border-[#ccc]"
                        title="Stopka — edytuj przez ⚙️ Nagłówek/stopka"
                      >
                        <span>{hfSettings.footerTextLeft}</span>
                        <span>{hfSettings.footerText || "Bartolini Air Simulation"}</span>
                        <span>{hfSettings.footerTextRight}</span>
                      </div>
                    )}
                    <div
                      id="doc-editor-content"
                      ref={editorRef}
                      contentEditable={editMode && canEdit}'''
src = rep(src, old5, new5, "KROK5 editor overlay")

# KROK 6a: widen modal + split header row
old6a = '''          <div className="bg-white text-[#1a1a1a] rounded-lg p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
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
            </label>'''
new6a = '''          <div className="bg-white text-[#1a1a1a] rounded-lg p-5 w-full max-w-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[#1a1a8c]">⚙️ Nagłówek i stopka dokumentu</h3>
            <p className="text-xs text-[#666]">Te ustawienia są wspólne dla wszystkich eksportowanych instrukcji (Word i PDF).</p>

            <div>
              <div className="text-xs text-[#666] mb-1">Tekst nagłówka (pusty = domyślnie nazwa urządzenia)</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-[#666]">
                  Strony nieparzyste
                  <input
                    value={hfDraft.headerText}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerText: e.target.value }))}
                    className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                    placeholder="np. Bartolini Air Simulation"
                  />
                </label>
                <label className="block text-xs text-[#666]">
                  Strony parzyste
                  <input
                    value={hfDraft.headerTextEven}
                    onChange={(e) => setHfDraft((d) => ({ ...d, headerTextEven: e.target.value }))}
                    className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                    placeholder="puste = jak nieparzyste"
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="text-xs text-[#666] mb-1">Tekst stopki</div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-xs text-[#666]">
                  Lewo
                  <input
                    value={hfDraft.footerTextLeft}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerTextLeft: e.target.value }))}
                    className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
                <label className="block text-xs text-[#666]">
                  Środek
                  <input
                    value={hfDraft.footerText}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerText: e.target.value }))}
                    className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                    placeholder="Bartolini Air Simulation"
                  />
                </label>
                <label className="block text-xs text-[#666]">
                  Prawo
                  <input
                    value={hfDraft.footerTextRight}
                    onChange={(e) => setHfDraft((d) => ({ ...d, footerTextRight: e.target.value }))}
                    className="w-full border border-[#ccc] rounded px-2 py-1.5 text-sm mt-1"
                  />
                </label>
              </div>
            </div>'''
src = rep(src, old6a, new6a, "KROK6a modal header/footer rows")

# KROK 6b: checkboxes
old6b = '''            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.skipFirstPage} onChange={(e) => setHfDraft((d) => ({ ...d, skipFirstPage: e.target.checked }))} />'''
new6b = '''            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.enableHeader} onChange={(e) => setHfDraft((d) => ({ ...d, enableHeader: e.target.checked }))} />
              Pokaż nagłówek
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.enableFooter} onChange={(e) => setHfDraft((d) => ({ ...d, enableFooter: e.target.checked }))} />
              Pokaż stopkę
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={hfDraft.skipFirstPage} onChange={(e) => setHfDraft((d) => ({ ...d, skipFirstPage: e.target.checked }))} />'''
src = rep(src, old6b, new6b, "KROK6b checkboxes")

path.write_text(src, encoding="utf-8")
print("OK - wszystkie 8 krokow zapisanych.")
