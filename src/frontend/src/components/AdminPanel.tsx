import { useEffect, useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import { ModuleCheckboxes } from "./ModuleCheckboxes";
import { BackupExport } from "./BackupExport";
import { TrashView } from "./TrashView";
import { KsefInvoicesView } from "./KsefInvoicesView";
import { BackupImport } from "./BackupImport";
import { AiAgentConfigModule } from "./AiAgentConfigModule";

const ROLE_LABELS: Record<string, string> = { read: "Odczyt", write: "Zapis", admin: "Admin" };
const AGENT_PWD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

function roleToVariant(role: string) {
  return { [role]: null };
}

function roleFromVariant(v: any): string {
  return Object.keys(v)[0];
}

function generateStrongPassword(length = 24): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let pwd = "";
  for (let i = 0; i < arr.length; i++) pwd += AGENT_PWD_CHARS[arr[i] % AGENT_PWD_CHARS.length];
  return pwd;
}

export function AdminPanel({ actor }: { actor: any }) {
  const [codes, setCodes] = useState<any[]>([]);
  const [access, setAccess] = useState<any[]>([]);
  const [newRole, setNewRole] = useState("write");
  const [lastCode, setLastCode] = useState("");
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});

  // --- AI agent config password generator (mirrors invite-code UI) ---
  const [agentTarget, setAgentTarget] = useState(""); // "" = manual entry
  const [agentTargetManual, setAgentTargetManual] = useState("");
  const [agentPassword, setAgentPassword] = useState("");
  const [agentPasswordSavedFor, setAgentPasswordSavedFor] = useState<string | null>(null);
  const [agentError, setAgentError] = useState("");

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

  const labelForPrincipal = (p: string) => {
    const name = displayNames[p];
    return name ? `${name} (${p.slice(0, 8)}…)` : `${p.slice(0, 12)}…`;
  };

  const generateAgentPassword = () => {
    setAgentPassword(generateStrongPassword());
    setAgentPasswordSavedFor(null);
    setAgentError("");
  };

  const saveAgentPassword = async () => {
    setAgentError("");
    const targetText = agentTarget || agentTargetManual.trim();
    if (!targetText) { setAgentError("Wybierz lub wpisz principal."); return; }
    if (!agentPassword) { setAgentError("Najpierw wygeneruj hasło."); return; }
    let principal: any;
    try {
      principal = Principal.fromText(targetText);
    } catch {
      setAgentError("Nieprawidłowy principal.");
      return;
    }
    try {
      await actor.setAgentConfigPassword(principal, agentPassword);
      setAgentPasswordSavedFor(targetText);
    } catch (e: any) {
      setAgentError("Błąd zapisu: " + (e?.message || String(e)));
    }
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
        <h2 className="font-semibold text-[var(--text-primary)]">Hasło konfiguracji Agenta AI</h2>
        <p className="text-xs text-[var(--text-secondary)]">
          Ustaw lub zresetuj hasło wymagane do zmiany zachowania agenta (osobne od hasła logowania).
          Wybierz osobę z listy dostępu albo wklej principal ręcznie.
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={agentTarget}
            onChange={(e) => setAgentTarget(e.target.value)}
            className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm min-w-[180px]"
          >
            <option value="">— wpisz principal ręcznie —</option>
            {access.map((a) => (
              <option key={a.principal.toString()} value={a.principal.toString()}>
                {labelForPrincipal(a.principal.toString())}
              </option>
            ))}
          </select>
          {!agentTarget && (
            <input
              value={agentTargetManual}
              onChange={(e) => setAgentTargetManual(e.target.value)}
              placeholder="principal (xxxxx-xxxxx-...)"
              className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm font-mono w-64"
            />
          )}
          <button onClick={generateAgentPassword} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-medium">
            Generuj hasło
          </button>
        </div>

        {agentPassword && (
          <div className="flex gap-2 items-center flex-wrap">
            <input
              readOnly
              value={agentPassword}
              className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm font-mono w-64"
            />
            <button
              onClick={() => navigator.clipboard.writeText(agentPassword)}
              className="px-2 py-1.5 text-xs rounded border border-[var(--border-color)]"
            >
              Kopiuj
            </button>
            <button
              onClick={saveAgentPassword}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Zapisz dla wybranej osoby
            </button>
          </div>
        )}
        {agentPassword && (
          <p className="text-xs text-amber-600">
            Zapisz to hasło teraz i przekaż osobie bezpiecznym kanałem — nie da się go później odczytać, tylko wygenerować nowe.
          </p>
        )}
        {agentPasswordSavedFor && (
          <div className="text-sm text-green-600">
            Zapisano hasło dla {labelForPrincipal(agentPasswordSavedFor)}.
          </div>
        )}
        {agentError && <div className="text-sm text-red-500">{agentError}</div>}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
        <h2 className="font-semibold text-[var(--text-primary)]">Lista dostępu</h2>
        <div className="mobile-scroll-table overflow-auto max-h-64">
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
