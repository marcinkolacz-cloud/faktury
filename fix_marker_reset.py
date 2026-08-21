import pathlib
p = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = p.read_text(encoding="utf-8")

old = '''    Array.prototype.slice.call(content.children).forEach((child: HTMLElement) => {
      const h = child.getBoundingClientRect().height;
      if (cumulative > 0 && cumulative + h > PAGE_H) {
        markers.push((child.getBoundingClientRect().top - outerTop) / scale);
        cumulative = 0;
      }
      cumulative += h;
    });
    Array.prototype.slice.call(content.querySelectorAll(`.${PAGE_BREAK_CLASS}`)).forEach((m: HTMLElement) => {
      markers.push((m.getBoundingClientRect().top - outerTop) / scale);
    });'''

new = '''    Array.prototype.slice.call(content.children).forEach((child: HTMLElement) => {
      const containsBreak = child.classList.contains(PAGE_BREAK_CLASS) || !!child.querySelector(`.${PAGE_BREAK_CLASS}`);
      const h = child.getBoundingClientRect().height;
      if (cumulative > 0 && cumulative + h > PAGE_H) {
        markers.push((child.getBoundingClientRect().top - outerTop) / scale);
        cumulative = 0;
      }
      if (containsBreak) {
        const breakEls = child.classList.contains(PAGE_BREAK_CLASS) ? [child] : Array.prototype.slice.call(child.querySelectorAll(`.${PAGE_BREAK_CLASS}`));
        breakEls.forEach((b: HTMLElement) => {
          markers.push((b.getBoundingClientRect().top - outerTop) / scale);
        });
        cumulative = 0;
        return;
      }
      cumulative += h;
    });'''

n = src.count(old)
print("wystapien:", n)
if n == 1:
    src = src.replace(old, new)
    p.write_text(src, encoding="utf-8")
    print("OK")
