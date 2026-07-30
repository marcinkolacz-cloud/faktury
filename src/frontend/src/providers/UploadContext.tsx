import { createContext, useContext, useState, type ReactNode } from "react";
import { odList, odCreateFolder, odUploadFile } from "../lib/oneDriveConfig";

const UPLOAD_CONCURRENCY = 3;

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

interface UploadContextValue {
  uploading: boolean;
  progress: string;
  lastCompletedAt: number;
  uploadFiles: (fileList: FileList | File[], targetPath: string) => void;
  uploadFolderEntries: (entries: { file: File; relativePath: string }[], targetPath: string) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used within UploadProvider");
  return ctx;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastCompletedAt, setLastCompletedAt] = useState(0);

  const uploadFiles = (fileList: FileList | File[], targetPath: string) => {
    const run = async () => {
      setUploading(true);
      setProgress("Sprawdzam istniejące pliki...");
      const filesArr = Array.from(fileList);
      const listing = await odList(targetPath);
      const existingNames = new Set((listing.items || []).map((i: any) => i.name.toLowerCase()));
      const toUpload = filesArr.filter((f) => !existingNames.has(f.name.toLowerCase()));
      const skippedCount = filesArr.length - toUpload.length;
      const failed: string[] = [];
      let done = 0;
      await runWithConcurrency(toUpload, UPLOAD_CONCURRENCY, async (file) => {
        try {
          await odUploadFile(targetPath, file);
        } catch (e) {
          failed.push(file.name);
        }
        done++;
        setProgress("Wgrano " + done + "/" + toUpload.length + (skippedCount ? " (pominięto duplikatów: " + skippedCount + ")" : "") + (failed.length ? " (błędy: " + failed.length + ")" : ""));
      });
      setProgress(failed.length > 0 ? "Nie udało się wgrać: " + failed.join(", ") : (skippedCount ? "Pominięto " + skippedCount + " duplikat(ów)." : "Gotowe."));
      setUploading(false);
      setLastCompletedAt(Date.now());
    };
    run();
  };

  const uploadFolderEntries = (entries: { file: File; relativePath: string }[], targetPath: string) => {
    const run = async () => {
      setUploading(true);
      setProgress("Tworzę strukturę folderów...");
      const folderCache = new Set<string>();

      const resolveParentPath = async (relativePath: string): Promise<string> => {
        const parts = relativePath.split("/");
        const pathParts = parts.slice(0, -1);
        let currentPath = targetPath;
        for (const part of pathParts) {
          const nextPath = currentPath ? currentPath + "/" + part : part;
          if (!folderCache.has(nextPath)) {
            await odCreateFolder(currentPath, part);
            folderCache.add(nextPath);
          }
          currentPath = nextPath;
        }
        return currentPath;
      };

      const resolved: { file: File; parentPath: string }[] = [];
      for (const { file, relativePath } of entries) {
        const parentPath = await resolveParentPath(relativePath);
        resolved.push({ file, parentPath });
      }

      setProgress("Sprawdzam istniejące pliki...");
      const existingByPath = new Map<string, Set<string>>();
      const uniquePaths = Array.from(new Set(resolved.map((r) => r.parentPath)));
      await Promise.all(
        uniquePaths.map(async (path) => {
          const listing = await odList(path);
          existingByPath.set(path, new Set((listing.items || []).map((i: any) => i.name.toLowerCase())));
        })
      );

      const toUpload = resolved.filter(({ file, parentPath }) => {
        const existing = existingByPath.get(parentPath);
        return !existing || !existing.has(file.name.toLowerCase());
      });
      const skippedCount = resolved.length - toUpload.length;

      const failed: string[] = [];
      let done = 0;
      await runWithConcurrency(toUpload, UPLOAD_CONCURRENCY, async ({ file, parentPath }) => {
        try {
          await odUploadFile(parentPath, file);
        } catch (e) {
          failed.push(file.name);
        }
        done++;
        setProgress("Wgrano " + done + "/" + toUpload.length + (skippedCount ? " (pominięto duplikatów: " + skippedCount + ")" : "") + (failed.length ? " (błędy: " + failed.length + ")" : ""));
      });

      setProgress(failed.length > 0 ? "Nie udało się wgrać: " + failed.join(", ") : (skippedCount ? "Pominięto " + skippedCount + " duplikat(ów)." : "Gotowe."));
      setUploading(false);
      setLastCompletedAt(Date.now());
    };
    run();
  };

  return (
    <UploadContext.Provider value={{ uploading, progress, lastCompletedAt, uploadFiles, uploadFolderEntries }}>
      {children}
      {uploading && (
        <div className="fixed bottom-4 right-4 z-50 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-lg p-3 max-w-xs text-sm text-[var(--text-primary)]">
          <p className="font-medium">📤 Wgrywanie na Dysk...</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">{progress}</p>
        </div>
      )}
    </UploadContext.Provider>
  );
}
