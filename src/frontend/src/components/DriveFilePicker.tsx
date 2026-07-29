import { useEffect, useState } from "react";

export function DriveFilePicker({ actor, onSelect, onClose }: { actor: any; onSelect: (fileId: bigint, name: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!actor) return;
    actor.listFiles().then((f: any[]) => {
      setFiles(f.filter((x) => x.contentType.startsWith("image/")));
      setLoading(false);
    });
  }, [actor]);

  const filtered = files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 w-full max-w-2xl max-h-[80vh] flex flex-col space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-primary)]">Wybierz zdjęcie z Dysku</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">✕</button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Szukaj zdjęcia..."
          className="border border-[var(--border-color)] bg-[var(--bg-page)] rounded px-2 py-1.5 text-sm"
        />
        <div className="overflow-auto grid grid-cols-3 sm:grid-cols-4 gap-2">
          {loading ? (
            <p className="text-[var(--text-muted)] col-span-full text-center py-4">Ładowanie...</p>
          ) : filtered.length === 0 ? (
            <p className="text-[var(--text-muted)] col-span-full text-center py-4">Brak zdjęć na Dysku.</p>
          ) : (
            filtered.map((f) => (
              <button
                key={String(f.id)}
                onClick={() => onSelect(f.id, f.name)}
                className="border border-[var(--border-color)] rounded p-2 hover:border-cyan-500 text-left space-y-1"
              >
                <div className="h-16 w-full bg-[var(--bg-hover)] rounded flex items-center justify-center text-[var(--text-muted)] text-xs">
                  📷
                </div>
                <p className="text-xs text-[var(--text-secondary)] truncate">{f.name}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
