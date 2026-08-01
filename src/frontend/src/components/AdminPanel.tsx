import { useEffect, useState } from "react";
import { ModuleCheckboxes } from "./ModuleCheckboxes";
import { BackupExport } from "./BackupExport";
import { TrashView } from "./TrashView";
import { KsefInvoicesView } from "./KsefInvoicesView";
import { BackupImport } from "./BackupImport";

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
  const [newRole, setNewRole] = useState("write");
  const [lastCode, setLastCode] = useState("");
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});

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
        <div className="overflow-auto max-h-48">
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
        <div className="overflow-auto max-h-64">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="p-1">Principal</th>
                <th className="p-1">Rola</th>
                <th className="p-1">Moduły</th>
                <th className="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {access.map((a) => (
                <tr key={a.principal.toString()} className="border-t border-[var(--border-color-light)]">
                  <td className="p-1">
                    <input
                      defaultValue={displayNames[a.principal.toString()] || ""}
                      placeholder="np. Iza, Bartek..."
                      onBlur={(e) => saveDisplayName(a.principal, e.target.value.trim())}
                      className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs w-24 mb-1"
                    />
                    <div className="font-mono text-[9px] text-[var(--text-secondary)] truncate max-w-[100px]" title={a.principal.toString()}>{a.principal.toString()}</div>
                  </td>
                  <td className="p-1">
                    <select
                      value={roleFromVariant(a.role)}
                      onChange={(e) => changeRole(a.principal, e.target.value)}
                      className="border border-[var(--border-color)] rounded px-1 py-0.5 text-xs"
                    >
                      <option value="read">Odczyt</option>
                      <option value="write">Zapis</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <ModuleCheckboxes principal={a.principal} actor={actor} />
                  </td>
                  <td className="p-1">
                    <button onClick={() => revoke(a.principal)} className="text-red-500 text-xs">
                      Odwołaj
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
