import sys

PATH = "src/frontend/src/components/DocumentationEditorTiptapPoC.tsx"
with open(PATH, encoding="utf-8") as f:
    s = f.read()

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1), got {n}")
        sys.exit(1)
    return s.replace(old, new, 1)

# 1) factory - dodatkowy forceRef, ktory plugin wypelnia funkcja "schedule"
old_factory = '''function createSimplePaginationExtension(cfgRef: { current: HfPagCfg }) {
  return Extension.create({
    name: "simplePagination",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: SIMPLE_PAGE_BREAK_KEY,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, old) {
              const meta = tr.getMeta(SIMPLE_PAGE_BREAK_KEY);
              if (meta) return meta;
              return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
            },
          },
          props: {
            decorations(state) {
              return SIMPLE_PAGE_BREAK_KEY.getState(state);
            },
          },
          view(editorView) {
            let frame: number | null = null;
            const recompute = () => {
              frame = null;
              const decoSet = computeSimplePageBreaks(editorView, cfgRef.current);
              editorView.dispatch(editorView.state.tr.setMeta(SIMPLE_PAGE_BREAK_KEY, decoSet));
            };
            const schedule = () => {
              if (frame !== null) cancelAnimationFrame(frame);
              frame = requestAnimationFrame(recompute);
            };
            const onLoad = (e: Event) => {
              if ((e.target as HTMLElement)?.tagName === "IMG") schedule();
            };
            editorView.dom.addEventListener("load", onLoad, true);
            window.addEventListener("resize", schedule);
            schedule();
            return {
              update(view, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                if (frame !== null) cancelAnimationFrame(frame);
                editorView.dom.removeEventListener("load", onLoad, true);
                window.removeEventListener("resize", schedule);
              },
            };
          },
        }),
      ];
    },
  });
}'''

new_factory = '''function createSimplePaginationExtension(cfgRef: { current: HfPagCfg }, forceRecomputeRef: { current: (() => void) | null }) {
  return Extension.create({
    name: "simplePagination",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: SIMPLE_PAGE_BREAK_KEY,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, old) {
              const meta = tr.getMeta(SIMPLE_PAGE_BREAK_KEY);
              if (meta) return meta;
              return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
            },
          },
          props: {
            decorations(state) {
              return SIMPLE_PAGE_BREAK_KEY.getState(state);
            },
          },
          view(editorView) {
            let frame: number | null = null;
            const recompute = () => {
              frame = null;
              const decoSet = computeSimplePageBreaks(editorView, cfgRef.current);
              editorView.dispatch(editorView.state.tr.setMeta(SIMPLE_PAGE_BREAK_KEY, decoSet));
            };
            const schedule = () => {
              if (frame !== null) cancelAnimationFrame(frame);
              frame = requestAnimationFrame(recompute);
            };
            const onLoad = (e: Event) => {
              if ((e.target as HTMLElement)?.tagName === "IMG") schedule();
            };
            editorView.dom.addEventListener("load", onLoad, true);
            window.addEventListener("resize", schedule);
            forceRecomputeRef.current = schedule;
            schedule();
            return {
              update(view, prevState) {
                if (view.state.doc !== prevState.doc) schedule();
              },
              destroy() {
                if (frame !== null) cancelAnimationFrame(frame);
                editorView.dom.removeEventListener("load", onLoad, true);
                window.removeEventListener("resize", schedule);
                if (forceRecomputeRef.current === schedule) forceRecomputeRef.current = null;
              },
            };
          },
        }),
      ];
    },
  });
}'''

s = replace_once(s, old_factory, new_factory, "factory-forceref")

# 2) komponent: nowy ref + wywolanie w useEffect + przekazanie do fabryki
old_hook = '''  const hfConfigRef = useRef<HfPagCfg>({
    headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
    footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
    headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
  });
  useEffect(() => {
    hfConfigRef.current = {
      headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
      footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
      headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
    };
  }, [headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight, footerLeft, footerCenter, footerRight, enableHeader, enableFooter, headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage]);'''

new_hook = '''  const hfConfigRef = useRef<HfPagCfg>({
    headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
    footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
    headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
  });
  const forceRecomputeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    hfConfigRef.current = {
      headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight,
      footerLeft, footerCenter, footerRight, enableHeader, enableFooter,
      headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage,
    };
    // Zmiana ustawien nagl/stopki (modal) NIE jest zmiana editor.state.doc,
    // wiec silnik paginacji sam by tego nie przeliczyl - wymuszamy recompute.
    forceRecomputeRef.current?.();
  }, [headerLeft, headerCenter, headerRight, headerEvenLeft, headerEvenCenter, headerEvenRight, footerLeft, footerCenter, footerRight, enableHeader, enableFooter, headerHeightCm, footerHeightCm, headerFontSize, footerFontSize, headerBorder, footerBorder, skipFirstPage]);'''

s = replace_once(s, old_hook, new_hook, "hook-forceref")

# 3) wywolanie fabryki z nowym argumentem
s = replace_once(
    s,
    'createSimplePaginationExtension(hfConfigRef),',
    'createSimplePaginationExtension(hfConfigRef, forceRecomputeRef),',
    "call-factory",
)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK")
