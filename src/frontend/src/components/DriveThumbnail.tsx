import { useEffect, useState } from "react";

export function DriveThumbnail({ link, actor }: { link: string; actor: any }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      if (!link.startsWith("drive:") || !actor) return;
      const fileId = link.slice("drive:".length);
      try {
        const metaResult = await actor.getFileMeta(BigInt(fileId));
        if (metaResult.length === 0) { setError(true); return; }
        const meta = metaResult[0];
        if (!meta.contentType.startsWith("image/")) { setError(true); return; }
        const parts: Uint8Array[] = [];
        for (let i = 0; i < Number(meta.totalChunks); i++) {
          const chunk = await actor.getChunk(meta.id, i);
          if (chunk && chunk.length > 0) parts.push(new Uint8Array(chunk[0]));
        }
        const blob = new Blob(parts as BlobPart[], { type: meta.contentType });
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [link, actor]);

  if (error) return <span className="text-gray-300 text-xs">błąd</span>;
  if (!url) return <span className="text-[var(--text-muted)] text-xs">...</span>;
  return (
    <>
      <img
        src={url}
        alt="miniatura"
        onClick={() => setEnlarged(true)}
        className="h-10 w-10 object-cover rounded cursor-pointer hover:opacity-80"
      />
      {enlarged && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6"
          onClick={() => setEnlarged(false)}
        >
          <img src={url} alt="podgląd" className="max-w-full max-h-full rounded shadow-lg" />
        </div>
      )}
    </>
  );
}
