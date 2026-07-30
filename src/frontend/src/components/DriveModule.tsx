import { useEffect, useRef, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { useUpload } from "../providers/UploadContext";
import { TopBar } from "./TopBar";
import { DriveThumbnail } from "./DriveThumbnail";

export function DriveModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const { uploading, progress, lastCompletedAt, uploadFiles: uploadFilesGlobal, uploadFolderEntries } = useUpload();
  const [downloadProgress, setDownloadProgress] = useState("");
  const [folders, setFolders] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<{ id: bigint | null; name: string }[]>([{ id: null, name: "Dysk" }]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>("read");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const setFolderInputRef = (el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "true");
      el.setAttribute("directory", "true");
    }
  };

  const currentFolderId = breadcrumb[breadcrumb.length - 1].id;
  const reloadTokenRef = useRef(0);

  const reload = async () => {
    if (!actor) return;
    const myToken = ++reloadTokenRef.current;
    const contents = await actor.listFolderContents(currentFolderId === null ? [] : [currentFolderId]);
    if (myToken !== reloadTokenRef.current) return;
    setFolders(contents.folders);
    setFiles(contents.files);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    if (actor) {
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
    }
  }, [actor, currentFolderId]);

  useEffect(() => {
    if (!actor) return;
    const interval = setInterval(() => { reload(); }, 3000);
    return () => clearInterval(interval);
  }, [actor, currentFolderId]);

  useEffect(() => {
    if (lastCompletedAt > 0) reload();
  }, [lastCompletedAt]);

  const canWrite = myRole === "write" || myRole === "admin";

  const openFolder = (folder: any) => {
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
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
    await actor.createFolder(name.trim(), currentFolderId === null ? [] : [currentFolderId]);
    reload();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    uploadFilesGlobal(e.target.files, currentFolderId);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const entries = Array.from(selected).map((file) => ({
      file,
      relativePath: (file as any).webkitRelativePath || file.name,
    }));
    uploadFolderEntries(entries, currentFolderId);
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
    const items = e.dataTransfer.items;
    if (items && items.length > 0 && "webkitGetAsEntry" in items[0]) {
      const entries: { file: File; relativePath: string }[] = [];
      const topEntries = Array.from(items)
        .map((item) => (item as any).webkitGetAsEntry())
        .filter((entry) => entry !== null);
      for (const entry of topEntries) {
        const found = await readEntry(entry, "");
        entries.push(...found);
      }
      uploadFolderEntries(entries, currentFolderId);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFilesGlobal(e.dataTransfer.files, currentFolderId);
    }
  };

  const downloadFile = async (f: any) => {
    setDownloadProgress("Pobieram " + f.name + "...");
    const parts: Uint8Array[] = [];
    for (let i = 0; i < Number(f.totalChunks); i++) {
      const chunk = await actor.getChunk(f.id, i);
      if (chunk && chunk.length > 0) parts.push(new Uint8Array(chunk[0]));
    }
    setDownloadProgress("");
    const blob = new Blob(parts as BlobPart[], { type: f.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeFile = async (id: bigint) => {
    if (!confirm("Usunąć ten plik?")) return;
    await actor.deleteFile(id);
    reload();
  };

  const removeFolder = async (folder: any) => {
    const contents = await actor.listFolderContents([folder.id]);
    if (contents.folders.length > 0 || contents.files.length > 0) {
      alert("Folder nie jest pusty. Usuń najpierw jego zawartość.");
      return;
    }
    if (!confirm("Usunąć folder \"" + folder.name + "\"?")) return;
    await actor.deleteFolder(folder.id);
    reload();
  };

  const runSearch = async (q: string) => {
    setSearch(q);
    if (!q.trim()) { setSearchResults(null); return; }
    const all = await actor.listFiles();
    const matches = all.filter((f: any) => f.name.toLowerCase().includes(q.toLowerCase()));
    setSearchResults(matches);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const formatDate = (ns: bigint) => {
    const ms = Number(ns) / 1_000_000;
    return new Date(ms).toLocaleDateString("pl-PL", { year: "numeric", month: "short", day: "numeric" });
  };

  const toggleFileSelect = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const toggleFolderSelect = (id: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
  };

  const bulkDelete = async () => {
    const total = selectedFiles.size + selectedFolders.size;
    if (total === 0) return;
    const nonEmptyFolders: string[] = [];
    for (const id of selectedFolders) {
      const contents = await actor.listFolderContents([BigInt(id)]);
      if (contents.folders.length > 0 || contents.files.length > 0) {
        const f = folders.find((fo: any) => String(fo.id) === id);
        nonEmptyFolders.push(f ? f.name : id);
      }
    }
    if (nonEmptyFolders.length > 0) {
      alert("Te foldery nie są puste i nie zostaną usunięte: " + nonEmptyFolders.join(", ") + ". Usuń najpierw ich zawartość.");
      return;
    }
    if (!confirm("Usunąć zaznaczone " + total + " element(y/ów)?")) return;
    for (const id of selectedFiles) {
      await actor.deleteFile(BigInt(id));
    }
    for (const id of selectedFolders) {
      await actor.deleteFolder(BigInt(id));
    }
    clearSelection();
    reload();
  };

  const bulkMove = async () => {
    const total = selectedFiles.size + selectedFolders.size;
    if (total === 0) return;
    const targetName = prompt("Podaj nazwę folderu docelowego (musi już istnieć w tym samym miejscu, albo wpisz pusto dla katalogu głównego bieżącego poziomu):");
    if (targetName === null) return;
    let targetId: bigint | null = null;
    if (targetName.trim()) {
      const target = folders.find((f) => f.name.toLowerCase() === targetName.trim().toLowerCase());
      if (!target) {
        alert("Nie znaleziono folderu o tej nazwie w bieżącym widoku.");
        return;
      }
      targetId = target.id;
    }
    for (const id of selectedFiles) {
      await actor.moveFile(BigInt(id), targetId === null ? [] : [targetId]);
    }
    for (const id of selectedFolders) {
      await actor.moveFolder(BigInt(id), targetId === null ? [] : [targetId]);
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
        <div className="flex items-center gap-4 pb-2">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Dysk</h1>
        </div>
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <div
          className={"bg-[var(--bg-card)] border rounded-lg p-4 space-y-3 " + (dragActive ? "border-cyan-500 border-2" : "border-[var(--border-color)]")}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >

          <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)] flex-wrap">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
                <button onClick={() => goToBreadcrumb(i)} className="hover:text-cyan-500 hover:underline">
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
            {canWrite && (
              <>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50">
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
          {(selectedFiles.size + selectedFolders.size) > 0 && (
            <div className="flex items-center gap-2 bg-cyan-950/20 border border-cyan-800 rounded p-2 text-sm">
              <span>Zaznaczono: {selectedFiles.size + selectedFolders.size}</span>
              <button onClick={bulkMove} className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs">Przenieś</button>
              <button onClick={bulkDelete} className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs">Usuń</button>
              <button onClick={clearSelection} className="px-2 py-1 border border-[var(--border-color)] rounded text-xs">Anuluj zaznaczenie</button>
            </div>
          )}
          <div className="overflow-auto rounded border border-[var(--border-color)] max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-hover)] sticky top-0">
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="p-2 w-8">
                    {canWrite && (folders.length > 0 || files.length > 0) && (
                      <input
                        type="checkbox"
                        checked={selectedFiles.size + selectedFolders.size > 0 && selectedFiles.size === files.length && selectedFolders.size === folders.length}
                        onChange={() => {
                          const allSelected = selectedFiles.size === files.length && selectedFolders.size === folders.length && (files.length + folders.length) > 0;
                          if (allSelected) {
                            clearSelection();
                          } else {
                            setSelectedFiles(new Set(files.map((f: any) => String(f.id))));
                            setSelectedFolders(new Set(folders.map((f: any) => String(f.id))));
                          }
                        }}
                      />
                    )}
                  </th>
                  <th className="p-2 w-14"></th>
                  <th className="p-2">Nazwa</th>
                  <th className="p-2">Typ</th>
                  <th className="p-2 text-right">Rozmiar</th>
                  <th className="p-2">Data</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {searchResults !== null ? (
                  searchResults.length === 0 ? (
                    <tr><td colSpan={7} className="p-4 text-center text-[var(--text-muted)]">Brak wyników.</td></tr>
                  ) : (
                    searchResults.map((f) => (
                      <tr key={String(f.id)} className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                        <td className="p-2"></td>
                        <td className="p-2">
                          {f.contentType.startsWith("image/") && <DriveThumbnail link={"drive:" + String(f.id)} actor={actor} />}
                        </td>
                        <td className="p-2">{f.name}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{f.contentType}</td>
                        <td className="p-2 text-right font-mono">{formatSize(Number(f.size))}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{formatDate(f.createdAt)}</td>
                        <td className="p-2 whitespace-nowrap">
                          <button onClick={() => downloadFile(f)} className="text-cyan-600 hover:text-cyan-500 text-xs mr-2">Pobierz</button>
                          {canWrite && <button onClick={() => removeFile(f.id)} className="text-red-500 hover:text-red-400 text-xs">✕</button>}
                        </td>
                      </tr>
                    ))
                  )
                ) : folders.length === 0 && files.length === 0 ? (
                  <tr><td colSpan={7} className="p-4 text-center text-[var(--text-muted)]">Ten folder jest pusty. Przeciągnij tu pliki, żeby je wgrać.</td></tr>
                ) : (
                  <>
                    {folders.map((f) => (
                      <tr key={"folder-" + String(f.id)} className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                        <td className="p-2">
                          {canWrite && <input type="checkbox" checked={selectedFolders.has(String(f.id))} onChange={() => toggleFolderSelect(String(f.id))} />}
                        </td>
                        <td className="p-2">
                          <button onClick={() => openFolder(f)} className="hover:text-cyan-500 hover:underline flex items-center gap-1">
                            📁 {f.name}
                          </button>
                        </td>
                        <td className="p-2 text-[var(--text-secondary)]">Folder</td>
                        <td className="p-2 text-right font-mono text-[var(--text-muted)]">—</td>
                        <td className="p-2 text-[var(--text-secondary)]">{formatDate(f.createdAt)}</td>
                        <td className="p-2 whitespace-nowrap">
                          {canWrite && <button onClick={() => removeFolder(f)} className="text-red-500 hover:text-red-400 text-xs">✕</button>}
                        </td>
                      </tr>
                    ))}
                    {files.map((f) => (
                      <tr key={"file-" + String(f.id)} className="border-t border-[var(--border-color-light)] hover:bg-[var(--bg-hover)]">
                        <td className="p-2">
                          {canWrite && <input type="checkbox" checked={selectedFiles.has(String(f.id))} onChange={() => toggleFileSelect(String(f.id))} />}
                        </td>
                        <td className="p-2">
                          {f.contentType.startsWith("image/") && <DriveThumbnail link={"drive:" + String(f.id)} actor={actor} />}
                        </td>
                        <td className="p-2">{f.name}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{f.contentType}</td>
                        <td className="p-2 text-right font-mono">{formatSize(Number(f.size))}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{formatDate(f.createdAt)}</td>
                        <td className="p-2 whitespace-nowrap">
                          <button onClick={() => downloadFile(f)} className="text-cyan-600 hover:text-cyan-500 text-xs mr-2">Pobierz</button>
                          {canWrite && <button onClick={() => removeFile(f.id)} className="text-red-500 hover:text-red-400 text-xs">✕</button>}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
