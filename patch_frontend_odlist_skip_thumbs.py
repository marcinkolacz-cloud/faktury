import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''export async function odList(path: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/list?path=" + encodeURIComponent(path), { headers: await authHeaders() });
  return resp.json();
}'''
new = '''export async function odList(path: string, skipThumbs: boolean = false) {
  const qs = "/list?path=" + encodeURIComponent(path) + (skipThumbs ? "&thumbs=0" : "");
  const resp = await fetch(ONEDRIVE_WORKER_URL + qs, { headers: await authHeaders() });
  return resp.json();
}'''
assert old in src, "marker odList nie znaleziony - plik zmienil sie od podgladu"
src = src.replace(old, new, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK - patched", path)
