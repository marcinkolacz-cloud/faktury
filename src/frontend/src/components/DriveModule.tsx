import { useEffect, useRef, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { useUpload } from "../providers/UploadContext";
import JSZip from "jszip";
import { odList, odCreateFolder, odDownloadUrl, odDelete, odSearch, odRename, odShare, odPermissions, odMove, odPreview, setDriveActor } from "../lib/oneDriveConfig";

async function collectFilesRecursive(basePath: string, relPrefix: string): Promise<{ name: string; id: string }[]> {
  const listing = await odList(basePath);
  const out: { name: string; id: string }[] = [];
  for (const it of listing.items || []) {
    const rel = relPrefix + it.name;
    if (it.isFolder) {
      const sub = await collectFilesRecursive(basePath ? basePath + "/" + it.name : it.name, rel + "/");
      out.push(...sub);
    } else {
      out.push({ name: rel, id: it.id });
    }
  }
  return out;
}
import { TopBar } from "./TopBar";

export function DriveModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const { uploading, progress, lastCompletedAt, uploadFiles: uploadFilesGlobal, uploadFolderEntries } = useUpload();
  const [items, setItems] = useState<any[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<{ path: string; name: string }[]>([{ path: "", name: "Dysk" }]);
  const [loading, setLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState("");
  const [myRole, setMyRole] = useState<string>("read");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<string>(() => localStorage.getItem("drive_view_mode") || "tiles");
  const [detailsItem, setDetailsItem] = useState<any>(null);
  const [detailsPerms, setDetailsPerms] = useState<any[]>([]);
  const [tileMenuId, setTileMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reloadTokenRef = useRef(0);

  const setFolderInputRef = (el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "true");
      el.setAttribute("directory", "true");
    }
  };

  const currentPath = breadcrumb[breadcrumb.length - 1].path;

  const reload = async () => {
    const myToken = ++reloadTokenRef.current;
    const result = await odList(currentPath);
    if (myToken !== reloadTokenRef.current) return;
    setItems(result.items || []);
    setLoading(false);
  };

  useEffect(() => {
    if (actor) {
      setDriveActor(actor);
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
      reload();
    }
  }, [actor, currentPath]);

  useEffect(() => {
    const interval = setInterval(() => { reload(); }, 5000);
    return () => clearInterval(interval);
  }, [currentPath]);

  useEffect(() => {
    if (lastCompletedAt > 0) reload();
  }, [lastCompletedAt]);

  useEffect(() => {
    if (!tileMenuId) return;
    const closeMenu = () => setTileMenuId(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [tileMenuId]);

  const canWrite = myRole === "write" || myRole === "admin";

  const openFolder = (item: any) => {
    const newPath = currentPath ? currentPath + "/" + item.name : item.name;
    setBreadcrumb((prev) => [...prev, { path: newPath, name: item.name }]);
    setSearchResults(null);
    setSearch("");
  };

  const goToBreadcrumb = (index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    setSearchResults(null);
    setSearch("");
  };

  const createNewFolder = async () => {
    const name = prompt("Nazwa nowego folderu:");
    if (!name || !name.trim()) return;
    await odCreateFolder(currentPath, name.trim());
    reload();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    uploadFilesGlobal(e.target.files, currentPath);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;
    const entries = Array.from(selectedFiles).map((file) => ({
      file,
      relativePath: (file as any).webkitRelativePath || file.name,
    }));
    uploadFolderEntries(entries, currentPath);
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const readEntry = (entry: any, path: string): Promise<{ file: File; relativePath: string }[]> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file: File) => {
          resolve([{ file, relativePath: path + file.name }]);
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const allEntries: any[] = [];
        const readBatch = () => {
          reader.readEntries(async (batch: any[]) => {
            if (batch.length === 0) {
              const results = await Promise.all(
                allEntries.map((child) => readEntry(child, path + entry.name + "/"))
              );
              resolve(results.flat());
            } else {
              allEntries.push(...batch);
              readBatch();
            }
          });
        };
        readBatch();
      } else {
        resolve([]);
      }
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const dtItems = e.dataTransfer.items;
    if (dtItems && dtItems.length > 0 && "webkitGetAsEntry" in dtItems[0]) {
      const entries: { file: File; relativePath: string }[] = [];
      const topEntries = Array.from(dtItems)
        .map((item) => (item as any).webkitGetAsEntry())
        .filter((entry) => entry !== null);
      for (const entry of topEntries) {
        const found = await readEntry(entry, "");
        entries.push(...found);
      }
      uploadFolderEntries(entries, currentPath);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFilesGlobal(e.dataTransfer.files, currentPath);
    }
  };

  const previewFile = async (item: any) => {
    const result = await odPreview(item.id);
    if (result.url) {
      setPreviewUrl(result.url);
      setPreviewName(item.name);
    } else {
      downloadFile(item);
    }
  };

  const downloadFile = async (item: any) => {
    setDownloadProgress("Pobieram " + item.name + "...");
    const result = await odDownloadUrl(item.id);
    if (result.downloadUrl) {
      const a = document.createElement("a");
      a.href = result.downloadUrl;
      a.download = item.name;
      a.click();
    }
    setDownloadProgress("");
  };

  const downloadAsZip = async (rootItems: { id: string; name: string; isFolder: boolean }[], zipName: string) => {
    setDownloadProgress("Przygotowuję listę plików...");
    const zip = new JSZip();
    let allFiles: { name: string; id: string }[] = [];
    for (const it of rootItems) {
      if (it.isFolder) {
        const files = await collectFilesRecursive(currentPath ? currentPath + "/" + it.name : it.name, it.name + "/");
        allFiles.push(...files);
      } else {
        allFiles.push({ name: it.name, id: it.id });
      }
    }
    let done = 0;
    for (const f of allFiles) {
      setDownloadProgress("Pobieram " + (done + 1) + "/" + allFiles.length + ": " + f.name);
      const result = await odDownloadUrl(f.id);
      if (result.downloadUrl) {
        const resp = await fetch(result.downloadUrl);
        const blob = await resp.blob();
        zip.file(f.name, blob);
      }
      done++;
    }
    setDownloadProgress("Pakuję archiwum ZIP...");
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName + ".zip";
    a.click();
    URL.revokeObjectURL(url);
    setDownloadProgress("");
  };

  const downloadFolder = (item: any) => downloadAsZip([item], item.name);

  const bulkDownload = async () => {
    const matched = items.filter((i) => selected.has(i.id));
    if (matched.length === 0) return;
    await downloadAsZip(matched, "Bartolini-Drive-eksport");
  };

  const removeItem = async (item: any) => {
    if (!confirm((item.isFolder ? "Usunąć folder" : "Usunąć plik") + " \"" + item.name + "\"?")) return;
    await odDelete(item.id);
    reload();
  };

  const runSearch = async (q: string) => {
    setSearch(q);
    if (!q.trim()) { setSearchResults(null); return; }
    const result = await odSearch(q);
    setSearchResults(result.items || []);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const formatDate = (iso: string) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("pl-PL", { year: "numeric", month: "short", day: "numeric" });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const changeViewMode = (mode: string) => {
    setViewMode(mode);
    localStorage.setItem("drive_view_mode", mode);
  };

  const renameItem = async (item: any) => {
    const newName = prompt("Nowa nazwa:", item.name);
    if (!newName || !newName.trim() || newName === item.name) return;
    await odRename(item.id, newName.trim());
    reload();
  };

  const isOfficeFile = (name: string) => /\.(docx?|xlsx?|pptx?)$/i.test(name);

  const editFile = async (item: any) => {
    const result = await odShare(item.id, "edit");
    if (result.url) {
      window.open(result.url, "_blank");
    } else {
      alert("Nie udało się otworzyć edycji.");
    }
  };

  const shareItem = async (item: any) => {
    const result = await odShare(item.id, "edit");
    if (result.url) {
      await navigator.clipboard.writeText(result.url).catch(() => {});
      alert("Link skopiowany do schowka:\n" + result.url);
    } else {
      alert("Nie udało się utworzyć linku.");
    }
  };

  const moveItem = async (item: any) => {
    const targetName = prompt("Nazwa folderu docelowego (musi być widoczny w bieżącym widoku):");
    if (!targetName || !targetName.trim()) return;
    const target = items.find((i) => i.isFolder && i.name.toLowerCase() === targetName.trim().toLowerCase());
    if (!target) {
      alert("Nie znaleziono takiego folderu w bieżącym widoku.");
      return;
    }
    await odMove(item.id, target.id);
    reload();
  };

  const showDetails = async (item: any) => {
    setDetailsItem(item);
    setDetailsPerms([]);
    const result = await odPermissions(item.id);
    setDetailsPerms(result.permissions || []);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm("Usunąć zaznaczone " + selected.size + " element(y/ów)?")) return;
    for (const id of selected) {
      await odDelete(id);
    }
    clearSelection();
    reload();
  };

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-[var(--text-muted)]">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <div
          className={"bg-[var(--bg-card)] border rounded-lg p-4 space-y-3 " + (dragActive ? "border-[var(--accent-hover)] border-2" : "border-[var(--border-color)]")}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)] flex-wrap">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
                <button onClick={() => goToBreadcrumb(i)} className="hover:text-[var(--accent-hover)] hover:underline">
                  {b.name}
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={(e) => runSearch(e.target.value)}
              placeholder="Szukaj plików..."
              className="flex-1 min-w-[180px] border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm"
            />
            <select value={viewMode} onChange={(e) => changeViewMode(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm text-[var(--text-secondary)]">
              <option value="list">Lista</option>
              <option value="compact">Lista kompaktowa</option>
              <option value="tiles">Kafelki</option>
            </select>
            {canWrite && (
              <>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="px-3 py-1.5 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded font-medium disabled:opacity-50">
                  + Wgraj pliki
                </button>
                <input ref={setFolderInputRef} type="file" multiple className="hidden" onChange={handleFolderSelect} />
                <button onClick={() => folderInputRef.current?.click()} disabled={uploading} className="px-3 py-1.5 text-sm border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50">
                  + Wgraj folder
                </button>
                <button onClick={createNewFolder} className="px-3 py-1.5 text-sm border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
                  + Nowy folder
                </button>
              </>
            )}
          </div>
          {downloadProgress && <p className="text-xs text-[var(--text-muted)]">{downloadProgress}</p>}
          {progress && uploading && <p className="text-xs text-[var(--text-muted)]">{progress}</p>}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-[var(--accent-hover)]/10 border border-[var(--accent-text)] rounded p-2 text-sm">
              <span>Zaznaczono: {selected.size}</span>
              <button onClick={bulkDownload} className="px-2 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded text-xs">Pobierz (ZIP)</button>
              <button onClick={bulkDelete} className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs">Usuń</button>
              <button onClick={clearSelection} className="px-2 py-1 border border-[var(--border-color)] rounded text-xs">Anuluj zaznaczenie</button>
            </div>
          )}
          {searchResults !== null ? (
            <div className="mobile-scroll-table overflow-auto rounded border border-[var(--border-color)] max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-hover)] sticky top-0">
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="p-2 w-8">Lp.</th>
                    <th className="p-2 w-8"></th>
                    <th className="p-2">Nazwa</th>
                    <th className="p-2 text-right">Rozmiar</th>
                    <th className="p-2">Data</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.length === 0 ? (
                    <tr><td colSpan={6} className="p-4 text-center text-[var(--text-muted)]">Brak wyników.</td></tr>
                  ) : (
                    searchResults.map((f, idx) => (
                      <tr key={f.id} className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                        <td className="p-2 text-gray-400">{idx + 1}</td>
                        <td className="p-2"></td>
                        <td className="p-2">{f.name}</td>
                        <td className="p-2 text-right font-mono">{formatSize(f.size)}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{formatDate(f.lastModified)}</td>
                        <td className="p-2 whitespace-nowrap">
                          <button onClick={() => downloadFile(f)} className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-xs mr-2">Pobierz</button>
                          {canWrite && <button onClick={() => removeItem(f)} className="text-red-500 hover:text-red-400 text-xs">✕</button>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : viewMode === "tiles" ? (
            items.length === 0 ? (
              <p className="p-4 text-center text-sm text-[var(--text-muted)]">Ten folder jest pusty. Przeciągnij tu pliki, żeby je wgrać.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-[600px] overflow-auto p-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => (item.isFolder ? openFolder(item) : isOfficeFile(item.name) ? editFile(item) : previewFile(item))}
                    className="border border-[var(--border-color)] rounded-lg p-3 flex flex-col items-center gap-1 text-center hover:bg-[var(--bg-hover)] cursor-pointer"
                  >
                    {!item.isFolder && item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt={item.name} className="w-16 h-16 object-cover rounded" />
                    ) : (
                      <span className="text-3xl">{item.isFolder ? "📁" : "📄"}</span>
                    )}
                    <span className="text-xs truncate w-full" title={item.name}>{item.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{item.isFolder ? "—" : formatSize(item.size)}</span>
                    <div className="relative mt-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          if (tileMenuId === item.id) {
                            setTileMenuId(null);
                          } else {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setMenuPos({ x: rect.left + rect.width / 2, y: rect.top });
                            setTileMenuId(item.id);
                          }
                        }}
                        className="text-lg font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded px-3 py-0.5"
                      >⋯</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="mobile-scroll-table overflow-auto rounded border border-[var(--border-color)] max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-hover)] sticky top-0">
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className={viewMode === "compact" ? "p-1 w-8" : "p-2 w-8"}>Lp.</th>
                    <th className={viewMode === "compact" ? "p-1 w-8" : "p-2 w-8"}></th>
                    <th className={viewMode === "compact" ? "p-1" : "p-2"}>Nazwa</th>
                    <th className={(viewMode === "compact" ? "p-1" : "p-2") + " text-right"}>Rozmiar</th>
                    {viewMode !== "compact" && <th className="p-2">Data</th>}
                    <th className={viewMode === "compact" ? "p-1" : "p-2"}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={viewMode === "compact" ? 5 : 6} className="p-4 text-center text-[var(--text-muted)]">Ten folder jest pusty. Przeciągnij tu pliki, żeby je wgrać.</td></tr>
                  ) : (
                    items.map((item, idx) => {
                      const cell = viewMode === "compact" ? "p-1" : "p-2";
                      return (
                        <tr key={item.id} className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                      <td className={cell + " text-gray-400"}>{idx + 1}</td>
                      <td className={cell}>
                        {canWrite && <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} />}
                      </td>
                      <td className={cell}>
                        {item.isFolder ? (
                          <button onClick={() => openFolder(item)} className="hover:text-[var(--accent-hover)] hover:underline flex items-center gap-1">
                            📁 {item.name}
                          </button>
                        ) : (
                          <button onClick={() => (isOfficeFile(item.name) ? editFile(item) : previewFile(item))} className="hover:text-[var(--accent-hover)] hover:underline flex items-center gap-1">
                            📄 {item.name}
                          </button>
                        )}
                      </td>
                      <td className={cell + " text-right font-mono text-[var(--text-muted)]"}>{item.isFolder ? "—" : formatSize(item.size)}</td>
                      {viewMode !== "compact" && <td className="p-2 text-[var(--text-secondary)]">{formatDate(item.lastModified)}</td>}
                      <td className={cell + " whitespace-nowrap"}>
                        <button onClick={() => (item.isFolder ? downloadFolder(item) : downloadFile(item))} className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-xs mr-2">Pobierz</button>
                        {canWrite && !item.isFolder && isOfficeFile(item.name) && <button onClick={() => editFile(item)} className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-xs mr-2">Edytuj online</button>}
                        {canWrite && <button onClick={() => shareItem(item)} className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-xs mr-2">Udostępnij</button>}
                        {canWrite && viewMode !== "compact" && <button onClick={() => renameItem(item)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs mr-2">Zmień nazwę</button>}
                        {canWrite && viewMode !== "compact" && <button onClick={() => moveItem(item)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs mr-2">Przenieś</button>}
                        <button onClick={() => showDetails(item)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs mr-2">Szczegóły</button>
                        {canWrite && <button onClick={() => removeItem(item)} className="text-red-500 hover:text-red-400 text-xs">✕</button>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {tileMenuId && menuPos && (() => {
        const menuItem = items.find((i) => i.id === tileMenuId);
        if (!menuItem) return null;
        return (
          <div
            className="fixed z-50 bg-[var(--bg-card)] border border-[var(--border-color)] rounded shadow-lg py-1 flex flex-col whitespace-nowrap"
            style={{ left: menuPos.x, top: menuPos.y, transform: "translate(-50%, -100%)" }}
          >
            <button onClick={() => { setTileMenuId(null); menuItem.isFolder ? downloadFolder(menuItem) : downloadFile(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--accent)]">Pobierz</button>
            {canWrite && !menuItem.isFolder && isOfficeFile(menuItem.name) && <button onClick={() => { setTileMenuId(null); editFile(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--accent)]">Edytuj online</button>}
            {canWrite && <button onClick={() => { setTileMenuId(null); shareItem(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--accent)]">Udostępnij</button>}
            {canWrite && <button onClick={() => { setTileMenuId(null); renameItem(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">Zmień nazwę</button>}
            {canWrite && <button onClick={() => { setTileMenuId(null); moveItem(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">Przenieś</button>}
            <button onClick={() => { setTileMenuId(null); showDetails(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">Szczegóły</button>
            {canWrite && <button onClick={() => { setTileMenuId(null); removeItem(menuItem); }} className="text-xs text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-red-500">✕ Usuń</button>}
          </div>
        );
      })()}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setPreviewUrl(null)}>
          <div className="bg-[var(--bg-card)] rounded-lg w-full h-full max-w-5xl flex flex-col shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
              <span className="font-medium text-sm text-[var(--text-primary)] truncate">{previewName}</span>
              <button onClick={() => setPreviewUrl(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl leading-none px-2">✕</button>
            </div>
            <iframe src={previewUrl} className="flex-1 w-full rounded-b-lg" title={previewName} />
          </div>
        </div>
      )}
      {detailsItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDetailsItem(null)}>
          <div className="bg-[var(--bg-card)] rounded-lg p-5 max-w-md w-full space-y-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-[var(--text-primary)]">{detailsItem.name}</h2>
            <p className="text-xs text-[var(--text-muted)]">Rozmiar: {detailsItem.isFolder ? "—" : formatSize(detailsItem.size)}</p>
            <p className="text-xs text-[var(--text-muted)]">Ostatnia zmiana: {formatDate(detailsItem.lastModified)}</p>
            <div>
              <p className="text-xs font-medium text-[var(--text-muted)] mb-1">Dostęp:</p>
              {detailsPerms.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">Tylko Ty (brak udostępnień).</p>
              ) : (
                <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                  {detailsPerms.map((p, i) => (
                    <li key={i}>
                      {p.grantedTo ? p.grantedTo : (p.type === "edit" ? "Link do edycji" : p.type === "view" ? "Link do podglądu" : "Nieznany")}
                      {p.roles.length > 0 && " (" + p.roles.join(", ") + ")"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setDetailsItem(null)} className="px-3 py-1.5 text-sm border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
