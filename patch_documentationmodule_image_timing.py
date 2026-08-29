import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 1. mark start/end of the FIRST image wait (measure -> paginate)
old1 = '''        function waitImagesThenPaginate(){
          var imgs = Array.prototype.slice.call(measure.querySelectorAll('img'));
          if (imgs.length === 0) { requestAnimationFrame(paginate); return; }
          var remaining = imgs.length;
          imgs.forEach(function(img){
            if (img.complete) { remaining--; if (remaining === 0) requestAnimationFrame(paginate); }
            else { img.onload = img.onerror = function(){ remaining--; if (remaining === 0) requestAnimationFrame(paginate); }; }
          });
        }'''
new1 = '''        function waitImagesThenPaginate(){
          var imgs = Array.prototype.slice.call(measure.querySelectorAll('img'));
          try { parent.postMessage({ type: 'docPreviewTiming', label: 'images1-start-' + imgs.length, token: __TOKEN__ }, '*'); } catch (e) {}
          if (imgs.length === 0) { requestAnimationFrame(paginate); return; }
          var remaining = imgs.length;
          imgs.forEach(function(img){
            if (img.complete) { remaining--; if (remaining === 0) { try { parent.postMessage({ type: 'docPreviewTiming', label: 'images1-done', token: __TOKEN__ }, '*'); } catch (e) {} requestAnimationFrame(paginate); } }
            else { img.onload = img.onerror = function(){ remaining--; if (remaining === 0) { try { parent.postMessage({ type: 'docPreviewTiming', label: 'images1-done', token: __TOKEN__ }, '*'); } catch (e) {} requestAnimationFrame(paginate); } }; }
          });
        }'''
assert old1 in src, "marker waitImagesThenPaginate nie znaleziony"
src = src.replace(old1, new1, 1)

# 2. mark start/end of the SECOND image wait (finalImgs -> notifyReady)
old2 = '''          var finalImgs = Array.prototype.slice.call(pagesEl.querySelectorAll('img'));
          if (finalImgs.length === 0) {
            requestAnimationFrame(notifyReady);
          } else {
            var remaining2 = finalImgs.length;
            finalImgs.forEach(function(img){
              if (img.complete) { remaining2--; if (remaining2 === 0) requestAnimationFrame(notifyReady); }
              else { img.onload = img.onerror = function(){ remaining2--; if (remaining2 === 0) requestAnimationFrame(notifyReady); }; }
            });
          }'''
new2 = '''          var finalImgs = Array.prototype.slice.call(pagesEl.querySelectorAll('img'));
          try { parent.postMessage({ type: 'docPreviewTiming', label: 'images2-start-' + finalImgs.length, token: __TOKEN__ }, '*'); } catch (e) {}
          if (finalImgs.length === 0) {
            requestAnimationFrame(notifyReady);
          } else {
            var remaining2 = finalImgs.length;
            finalImgs.forEach(function(img){
              if (img.complete) { remaining2--; if (remaining2 === 0) { try { parent.postMessage({ type: 'docPreviewTiming', label: 'images2-done', token: __TOKEN__ }, '*'); } catch (e) {} requestAnimationFrame(notifyReady); } }
              else { img.onload = img.onerror = function(){ remaining2--; if (remaining2 === 0) { try { parent.postMessage({ type: 'docPreviewTiming', label: 'images2-done', token: __TOKEN__ }, '*'); } catch (e) {} requestAnimationFrame(notifyReady); } }; }
            });
          }'''
assert old2 in src, "marker finalImgs nie znaleziony"
src = src.replace(old2, new2, 1)

# 3. extend parent onMsg handler to record these into driveTiming + refresh panel
old3 = '''    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === "docPreviewPageCount") {
        setPreviewPageCount(e.data.count);
        setPaginationError(e.data.error || "");
      }
    };'''
new3 = '''    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === "docPreviewPageCount") {
        setPreviewPageCount(e.data.count);
        setPaginationError(e.data.error || "");
      }
      if (e.data && e.data.type === "docPreviewTiming") {
        driveMark(String(e.data.label));
        setDriveTimingInfo(driveTimingSummary());
      }
    };'''
assert old3 in src, "marker onMsg nie znaleziony"
src = src.replace(old3, new3, 1)

# 4. import driveMark alongside driveTimingSummary
old4 = 'import { driveTimingSummary } from "../lib/driveTiming";'
new4 = 'import { driveTimingSummary, driveMark } from "../lib/driveTiming";'
assert old4 in src, "marker import driveTiming nie znaleziony"
src = src.replace(old4, new4, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK - patched", path)
