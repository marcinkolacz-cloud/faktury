import { useEffect, useState } from "react";
import { odList, odCreateFolder, odUploadFile, odDownloadUrl } from "../lib/oneDriveConfig";

interface DriveFolderPanelProps {
  path: string | null;
  basePath: string; // e.g. "Zamowienia", "Umowy", "Zgloszenia"
  defaultName: string; // suggested subfolder name when auto-creating
  canWrite: boolean;
  onLink: (path: string) => Promise<void>;
  onUnlink: () => Promise<void>;
}

export function DriveFolderPanel({ path, basePath, defaultName, canWrite, onLink, onUnlink }: DriveFolderPanelProps) {
  const [items, setItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [linking, setLinking] = useState(false);

  const loadItems = async () => {
    if (!path) return;
    setLoadingItems(true);
    try {
      const result = await odList(path);
      setItems(result.items || []);
    } catch {
      setItems([]);
    }
    setLoadingItems(false);
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const ensureBaseFolder = async () => {
    const listing = await odList("");
    const exists = (listing.items || []).some((i: any) => i.isFolder && i.name === basePath);
    if (!exists) await odCreateFolder("", basePath);
  };

  const createFolder = async () => {
    setCreating(true);
    try {
      await ensureBaseFolder();
      const result = await odCreateFolder(basePath, defaultName);
      await onLink(basePath + "/" + result.name);
    } catch (e: any) {
      alert("Nie udało się utworzyć folderu: " + String(e?.message || e));
    }
    setCreating(false);
  };

  const linkManual = async () => {
    if (!manualPath.trim()) return;
    setLinking(true);
    try {
      await onLink(manualPath.trim());
      setManualPath("");
    } catch (e: any) {
      alert("Nie udało się połączyć folderu: " + String(e?.message || e));
    }
    setLinking(false);
  };

  const uploadFile = async (file: File) => {
    if (!path) return;
    setUploading(true);
    try {
      await odUploadFile(path, file);
      await loadItems();
    } catch (e: any) {
      alert("Nie udało się wgrać pliku: " + String(e?.message || e));
    }
    setUploading(false);
  };

  const openFile = async (itemId: string) => {
    try {
      const result = await odDownloadUrl(itemId);
      window.open(result.downloadUrl, "_blank");
    } catch (e: any) {
      alert("Nie udało się otworzyć pliku: " + String(e?.message || e));
    }
  };

  if (!path) {
    return (
      <div className="bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-2 space-y-2">
        <p className="text-[10px] font-medium text-[var(--text-muted)]">Dokumenty (Bartolini Drive)</p>
        {canWrite ? (
          <div className="space-y-1.5">
            <button onClick={createFolder} disabled={creating} className="text-xs text-cyan-600 hover:underline disabled:opacity-50">
              {creating ? "Tworzenie..." : "📁 Utwórz folder na dokumenty"}
            </button>
            <div className="flex gap-2 items-center">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="lub wklej istniejącą ścieżkę np. Zamowienia/Nazwa"
                className="flex-1 border border-[var(--border-color)] rounded px-2 py-1 text-[10px]"
              />
              <button onClick={linkManual} disabled={linking || !manualPath.trim()} className="text-[10px] text-cyan-600 hover:underline disabled:opacity-40">
                Połącz
              </button>
            </div>
          </div>
        ) : (
          <span className="text-xs text-[var(--text-muted)] italic">brak</span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-page)] border border-[var(--border-color-light)] rounded p-2 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-[var(--text-muted)]">📁 {path}</p>
        {canWrite && (
          <button onClick={onUnlink} className="text-[10px] text-red-500 hover:underline">Odłącz</button>
        )}
      </div>
      {loadingItems ? (
        <p className="text-xs text-[var(--text-muted)]">Ładowanie...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Folder jest pusty.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="text-xs flex items-center justify-between">
              <span className="text-[var(--text-secondary)] truncate">{it.isFolder ? "📁" : "📄"} {it.name}</span>
              {!it.isFolder && (
                <button onClick={() => openFile(it.id)} className="text-cyan-600 hover:underline shrink-0 ml-2">Otwórz</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <label className="text-xs text-cyan-600 hover:underline cursor-pointer inline-block">
          {uploading ? "Wgrywanie..." : "+ Dodaj plik"}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
