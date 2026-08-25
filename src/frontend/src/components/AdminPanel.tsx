import { useEffect, useState } from "react";
import { ModuleCheckboxes } from "./ModuleCheckboxes";
import { BackupExport } from "./BackupExport";
import { TrashView } from "./TrashView";
import { KsefInvoicesView } from "./KsefInvoicesView";
import { BackupImport } from "./BackupImport";
import { AiAgentConfigModule } from "./AiAgentConfigModule";

const ROLE_LABELS: Record<string, string> = { read: "Odczyt", write: "Zapis", admin: "Admin" };

function roleToVariant(role: string) {
  return { [role]: null };
}

function roleFromVariant(v: any): string {
  return Object.keys(v)[0];
}

export function AdminPanel({ actor }: { actor: any }) {
  const [codes, setCodes] = useState<any[]>([]);
  const [access, setAccess] = useState<any[]>([]);
  const [docEditors, setDocEditors] = useState<Set<string>>(new Set());
  const [newRole, setNewRole] = useState("write");
  const [lastCode, setLastCode] = useState("");
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [nameFilter, setNameFilter] = useState("");

  const reloadDisplayNames = async () => {
    if (!actor) return;
    const result = await actor.listPrincipalDisplayNames();
    const map: Record<string, string> = {};
    result.forEach(([p, name]: [any, string]) => { map[p.toString()] = name; });
    setDisplayNames(map);
  };

  const saveDisplayName = async (principal: any, name: string) => {
    await actor.setPrincipalDisplayName(principal, name);
    setDisplayNames((prev) => ({ ...prev, [principal.toString()]: name }));
  };

  const reload = async () => {
    if (!actor) return;
    const [c, a] = await Promise.all([
      actor.listInviteCodes(),
      actor.listAccessEntries(),
    ]);
    setCodes(c);
    setAccess(a);
    try {
      const de = await actor.listDocumentationEditors();
      setDocEditors(new Set(de.map(([p]: [any, boolean]) => p.toString())));
    } catch {
      // Non-critical — the doc-editor checkboxes just won't be
      // pre-checked yet; never let this block the rest of the panel.
    }
  };

  const toggleDocEditor = async (principal: any, allowed: boolean) => {
    try {
      await actor.setDocumentationEditor(principal, allowed);
      reload();
    } catch (e: any) {
      alert("Błąd zapisu uprawnienia: " + (e?.message || String(e)));
    }
  };

  useEffect(() => {
    reload();
    reloadDisplayNames();
  }, [actor]);

  const generateCode = async () => {
    const code = await actor.generateInviteCode(roleToVariant(newRole));
    setLastCode(code);
    reload();
  };

  const changeRole = async (principal: any, role: string) => {
    await actor.changeAccessRole(principal, roleToVariant(role));
    reload();
  };

  const revoke = async (principal: any) => {
    if (!confirm("Odwołać dostęp tej osobie?")) return;
    await actor.revokeAccess(principal);
    reload();
  };

  return (
    <div className="space-y-6">
      <AiAgentConfigModule actor={actor} />
      <KsefInvoicesView actor={actor} />
      <TrashView actor={actor} />
      <BackupExport actor={actor} />
      <BackupImport actor={actor} />
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold text-[var(--text-primary)]">Wygeneruj kod zaproszenia</h2>
        <div className="flex gap-2 items-center">
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm">
            <option value="read">Odczyt (Read)</option>
            <option value="write">Zapis (Write)</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={generateCode} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-medium">
            Wygeneruj kod
          </button>
          {lastCode && (
            <span className="font-mono text-sm bg-cyan-50 text-cyan-700 px-2 py-1 rounded">
              {lastCode}
            </span>
          )}
        </div>
        <div className="mobile-scroll-table overflow-auto max-h-48">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="p-1">Kod</th>
                <th className="p-1">Rola</th>
                <th className="p-1">Wykorzystany</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code} className="border-t border-[var(--border-color-light)]">
                  <td className="p-1 font-mono">{c.code}</td>
                  <td className="p-1">{ROLE_LABELS[roleFromVariant(c.role)]}</td>
                  <td className="p-1">{c.usedBy.length > 0 ? "Tak" : "Nie"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold text-[var(--text-primary)]">Lista dostępu</h2>
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Filtruj po nazwie..."
          className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm w-64"
        />
        <div className="mobile-scroll-table overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="p-2">Principal</th>
                <th className="p-2">Rola</th>
                <th className="p-2">Moduły</th>
                <th className="p-2" title="Osobne, węższe prawo — nie wystarczy sama rola Zapis">📖 Edycja dokumentacji</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {access
                .filter((a) => (displayNames[a.principal.toString()] || "").toLowerCase().includes(nameFilter.toLowerCase()))
                .map((a) => {
                const isAdminRole = roleFromVariant(a.role) === "admin";
                return (
                <tr key={a.principal.toString()} className={"border-t border-[var(--border-color-light)]" + (isAdminRole ? " bg-green-50" : "")}>
                  <td className="p-2">
                    <input
                      defaultValue={displayNames[a.principal.toString()] || ""}
                      placeholder="np. Iza, Bartek..."
                      onBlur={(e) => saveDisplayName(a.principal, e.target.value.trim())}
                      className="border border-[var(--border-color)] rounded px-1.5 py-1 text-sm w-36 mb-1"
                    />
                    <div className="font-mono text-[10px] text-[var(--text-secondary)] truncate max-w-[140px]" title={a.principal.toString()}>{a.principal.toString()}</div>
                  </td>
                  <td className="p-2">
                    <select
                      value={roleFromVariant(a.role)}
                      onChange={(e) => changeRole(a.principal, e.target.value)}
                      className={"border rounded px-1.5 py-1 text-sm " + (isAdminRole ? "border-green-500 bg-green-100 text-green-800 font-semibold" : "border-[var(--border-color)]")}
                    >
                      <option value="read">Odczyt</option>
                      <option value="write">Zapis</option>
                      <option value="admin">Admin</option>
                    </select>
                    {isAdminRole && <span className="ml-1 text-green-600 text-xs font-semibold">● Admin</span>}
                  </td>
                  <td className="p-2">
                    <ModuleCheckboxes principal={a.principal} actor={actor} />
                  </td>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={docEditors.has(a.principal.toString())}
                      onChange={(e) => toggleDocEditor(a.principal, e.target.checked)}
                    />
                  </td>
                  <td className="p-2">
                    <button onClick={() => revoke(a.principal)} className="text-red-500 text-sm">
                      Odwołaj
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
