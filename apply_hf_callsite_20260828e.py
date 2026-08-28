import sys

PATH = "src/frontend/src/components/DocumentationModule.tsx"
with open(PATH, encoding="utf-8") as f:
    s = f.read()

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1), got {n}")
        sys.exit(1)
    return s.replace(old, new, 1)

old = '''                        headerLeft={hfSettings.headerText || `${deviceLabel} — Instrukcja obsługi`}
                        headerCenter={hfSettings.headerTextCenter}
                        headerRight={hfSettings.headerTextRight}
                        footerLeft={hfSettings.footerTextLeft}
                        footerCenter={hfSettings.footerText}
                        footerRight={hfSettings.footerTextRight}'''

new = '''                        headerLeft={hfSettings.headerText || `${deviceLabel} — Instrukcja obsługi`}
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
                        skipFirstPage={hfSettings.skipFirstPage}'''

s = replace_once(s, old, new, "callsite-hf")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK")
