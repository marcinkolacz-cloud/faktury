import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''async function listFolderCached(path: string): Promise<any[]> {
  const cached = folderListCache.get(path);
  if (cached && Date.now() < cached.expiry) return cached.items;
  const listing = await odList(path);
  const items = listing.items || [];
  folderListCache.set(path, { items, expiry: Date.now() + FOLDER_LIST_TTL_MS });
  return items;
}'''
new = '''async function listFolderCached(path: string): Promise<any[]> {
  const cached = folderListCache.get(path);
  if (cached && Date.now() < cached.expiry) return cached.items;
  // Listing rozdzialow/plikow tekstowych nie potrzebuje miniatur -
  // pomija Graph-side $expand=thumbnails (patrz oneDriveConfig.odList).
  const listing = await odList(path, true);
  const items = listing.items || [];
  folderListCache.set(path, { items, expiry: Date.now() + FOLDER_LIST_TTL_MS });
  return items;
}'''
assert old in src, "marker listFolderCached nie znaleziony - plik zmienil sie od podgladu"
src = src.replace(old, new, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK - patched", path)
