import sys, pathlib

path = pathlib.Path("src/frontend/src/components/DocumentationModule.tsx")
src = path.read_text(encoding="utf-8")

if "hoistPageBreaks" in src:
    print("INFO: poprawka juz obecna - nic nie zmieniam.")
    sys.exit(0)

old = "        function paginate(){\n          var children = Array.prototype.slice.call(measure.children);"
new = """        function hoistToTop(node, container){
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
          var children = Array.prototype.slice.call(measure.children);"""

n = src.count(old)
if n != 1:
    print(f"BLAD: wystapien={n} (oczekiwano 1) - nic nie zmieniam.")
    sys.exit(1)

src = src.replace(old, new)
path.write_text(src, encoding="utf-8")
print("OK - zapisano zmiany.")
