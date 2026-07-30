import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useBackendActor } from "../lib/useBackend";

const CHUNK_SIZE = 1_500_000;
const UPLOAD_CONCURRENCY = 4;

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
  uploadFiles: (fileList: FileList | File[], targetFolderId: bigint | null) => void;
  uploadFolderEntries: (entries: { file: File; relativePath: string }[], targetFolderId: bigint | null) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used within UploadProvider");
  return ctx;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const actor = useBackendActor();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastCompletedAt, setLastCompletedAt] = useState(0);
  const busyRef = useRef(false);

  const uploadOneFile = async (file: File, parentId: bigint | null) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const fileId = await actor.createFileUpload(
      file.name,
      file.type || "application/octet-stream",
      file.size,
      totalChunks,
      parentId === null ? [] : [parentId]
    );
    const chunkIndexes = Array.from({ length: totalChunks }, (_, i) => i);
    await runWithConcurrency(chunkIndexes, UPLOAD_CONCURRENCY, async (i) => {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
      await actor.uploadChunk(fileId, i, chunk);
    });
  };

  const uploadFiles = (fileList: FileList | File[], targetFolderId: bigint | null) => {
    const run = async () => {
      busyRef.current = true;
      setUploading(true);
      setProgress("Sprawdzam istniejące pliki...");
      const filesArr = Array.from(fileList);
      const contents = await actor.listFolderContents(targetFolderId === null ? [] : [targetFolderId]);
      const existingNames = new Set(contents.files.map((f: any) => f.name.toLowerCase()));
      const toUpload = filesArr.filter((f) => !existingNames.has(f.name.toLowerCase()));
      const skippedCount = filesArr.length - toUpload.length;
      const failed: string[] = [];
      let done = 0;
      await runWithConcurrency(toUpload, UPLOAD_CONCURRENCY, async (file) => {
        try {
          await uploadOneFile(file, targetFolderId);
        } catch (e) {
          failed.push(file.name);
        }
        done++;
        setProgress("Wgrano " + done + "/" + toUpload.length + (skippedCount ? " (pominięto duplikatów: " + skippedCount + ")" : "") + (failed.length ? " (błędy: " + failed.length + ")" : ""));
      });
      setProgress(failed.length > 0 ? "Nie udało się wgrać: " + failed.join(", ") : (skippedCount ? "Pominięto " + skippedCount + " duplikat(ów)." : "Gotowe."));
      setUploading(false);
      busyRef.current = false;
      setLastCompletedAt(Date.now());
    };
    run();
  };

  const uploadFolderEntries = (entries: { file: File; relativePath: string }[], targetFolderId: bigint | null) => {
    const run = async () => {
      busyRef.current = true;
      setUploading(true);
      const folderCache = new Map<string, bigint>();

      const resolveParent = async (relativePath: string): Promise<bigint | null> => {
        const parts = relativePath.split("/");
        const pathParts = parts.slice(0, -1);
        let parentId: bigint | null = targetFolderId;
        let cacheKey = String(targetFolderId);
        for (const part of pathParts) {
          cacheKey += "/" + part;
          if (folderCache.has(cacheKey)) {
            parentId = folderCache.get(cacheKey)!;
          } else {
            const newId = await actor.createFolder(part, parentId === null ? [] : [parentId]);
            folderCache.set(cacheKey, newId);
            parentId = newId;
          }
        }
        return parentId;
      };

      setProgress("Tworzę strukturę folderów...");
      const resolved: { file: File; parentId: bigint | null }[] = [];
      for (const { file, relativePath } of entries) {
        const parentId = await resolveParent(relativePath);
        resolved.push({ file, parentId });
      }

      setProgress("Sprawdzam istniejące pliki...");
      const existingNamesByParent = new Map<string, Set<string>>();
      const uniqueParentIds = Array.from(new Set(resolved.map((r) => String(r.parentId))));
      await Promise.all(
        uniqueParentIds.map(async (key) => {
          const pid = key === "null" ? null : BigInt(key);
          const contents = await actor.listFolderContents(pid === null ? [] : [pid]);
          existingNamesByParent.set(key, new Set(contents.files.map((f: any) => f.name.toLowerCase())));
        })
      );

      const toUpload = resolved.filter(({ file, parentId }) => {
        const key = String(parentId);
        const existing = existingNamesByParent.get(key);
        return !existing || !existing.has(file.name.toLowerCase());
      });
      const skippedCount = resolved.length - toUpload.length;

      const failed: string[] = [];
      let done = 0;
      await runWithConcurrency(toUpload, UPLOAD_CONCURRENCY, async ({ file, parentId }) => {
        try {
          await uploadOneFile(file, parentId);
        } catch (e) {
          failed.push(file.name);
        }
        done++;
        setProgress("Wgrano " + done + "/" + toUpload.length + (skippedCount ? " (pominięto duplikatów: " + skippedCount + ")" : "") + (failed.length ? " (błędy: " + failed.length + ")" : ""));
      });

      setProgress(failed.length > 0 ? "Nie udało się wgrać: " + failed.join(", ") : (skippedCount ? "Pominięto " + skippedCount + " duplikat(ów)." : "Gotowe."));
      setUploading(false);
      busyRef.current = false;
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
