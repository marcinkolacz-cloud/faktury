import { useEffect, useState } from "react";

type FieldKind = "bool" | "text" | "number" | "textarea";
type Field = { key: string; label: string; kind: FieldKind; hint?: string };

const FIELDS: Field[] = [
  { key: "search_priority_enabled", label: "Wymuś priorytetowe źródło wyszukiwania komponentów", kind: "bool" },
  { key: "search_priority_site", label: "Priorytetowa strona (np. allegro.pl)", kind: "text" },
  { key: "max_auto_price_pln", label: "Maks. cena PLN bez potwierdzenia", kind: "number" },
  { key: "agent_tone", label: "Ton komunikacji agenta", kind: "text" },
  {
    key: "agent_system_instructions",
    label: "Instrukcje ogólne agenta",
    kind: "textarea",
    hint: "Główne zasady działania — priorytety, czego unikać, jak się przedstawiać, co wolno robić automatycznie.",
  },
  {
    key: "agent_purchasing_instructions",
    label: "Zasady wyszukiwania i zakupu komponentów",
    kind: "textarea",
    hint: "Preferowane sklepy, jak dobierać zamienniki dla przestarzałych podzespołów, jakie parametry są krytyczne.",
  },
  {
    key: "agent_project_template_instructions",
    label: "Szablon projektu (np. BAS00X) — typowa lista zakupów",
    kind: "textarea",
    hint: "Kategorie komponentów, które powtarzają się w każdym projekcie tego typu, i na co zwracać uwagę przy nowym.",
  },
  {
    key: "agent_escalation_instructions",
    label: "Kiedy agent ma pytać zamiast działać samodzielnie",
    kind: "textarea",
    hint: "Np. przy zamówieniach powyżej progu cenowego, przy niejednoznacznym zamienniku, przy braku daty produkcji.",
  },
];

function encodeValue(kind: FieldKind, raw: string): any {
  if (kind === "bool") return { bool: raw === "true" };
  if (kind === "number") return { number: parseFloat(raw) || 0 };
  return { text: raw };
}

function decodeValue(v: any): string {
  if ("bool" in v) return String(v.bool);
  if ("number" in v) return String(v.number);
  return v.text ?? "";
}

export function AiAgentConfigModule({ actor, onUnlockedChange }: { actor: any; onUnlockedChange?: (u: boolean) => void }) {
  // null = not yet confirmed either way. Rendering never blocks on this —
  // the password field is the default view regardless, so a slow or
  // failed check never leaves the user staring at a spinner.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [values, setValues] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<any[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    onUnlockedChange?.(unlocked);
  }, [unlocked]);

  const reload = async () => {
    const [entries, log] = await Promise.all([actor.listAgentConfig(), actor.getAgentConfigAuditLog()]);
    const map: Record<string, string> = {};
    entries.forEach((e: any) => { map[e.key] = decodeValue(e.value); });
    setValues(map);
    setAudit([...log].sort((a: any, b: any) => Number(b.timestamp) - Number(a.timestamp)));
  };

  useEffect(() => {
    if (!actor) return;
    let cancelled = false;

    actor.hasAgentConfigPassword()
      .then((has: boolean) => { if (!cancelled) setHasPassword(has); })
      .catch(() => { /* leave hasPassword null — password field stays the default */ });

    actor.isAgentConfigUnlocked()
      .then(async (isUnlocked: boolean) => {
        if (cancelled || !isUnlocked) return;
        setUnlocked(true);
        await reload();
      })
      .catch(() => { /* not unlocked yet — password field stays visible, harmless */ });

    return () => { cancelled = true; };
  }, [actor]);

  const unlock = async () => {
    setUnlockError("");
    setUnlocking(true);
    try {
      const ok = await actor.verifyAgentConfigPasswordOnly(passwordInput);
      if (!ok) {
        setUnlockError("Błędne hasło konfiguracji agenta.");
        return;
      }
      setPasswordInput("");
      setUnlocked(true);
      await reload();
    } catch (e: any) {
      setUnlockError("Błąd: " + (e?.message || String(e)));
    } finally {
      setUnlocking(false);
    }
  };

  const lock = async () => {
    try { await actor.lockAgentConfigForMe(); } catch { /* ignore */ }
    setUnlocked(false);
  };

  const saveField = async (field: Field, raw: string) => {
    setSaveError("");
    try {
      await actor.setAgentConfigValue(field.key, encodeValue(field.kind, raw));
      reload();
    } catch (e: any) {
      setSaveError("Zapis nieudany — konto mogło zostać zablokowane. Odblokuj panel ponownie.");
      setUnlocked(false);
    }
  };

  const header = <h2 className="font-semibold text-[var(--text-primary)]">🤖 Agent AI</h2>;

  if (unlocked) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-4 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          {header}
          <div className="flex gap-3">
            <button onClick={() => setShowAudit((s) => !s)} className="text-xs text-[var(--accent)] hover:underline">
              {showAudit ? "Ukryj historię zmian" : "Historia zmian"}
            </button>
            <button onClick={lock} className="text-xs text-[var(--text-secondary)] hover:underline">
              Zablokuj konto
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {FIELDS.map((f) => (
            <ConfigRow
              key={f.key}
              field={f}
              value={values[f.key] ?? (f.kind === "bool" ? "false" : "")}
              onSave={(raw) => saveField(f, raw)}
            />
          ))}
        </div>

        {saveError && <div className="text-xs text-red-500">{saveError}</div>}

        {showAudit && (
          <div className="mobile-scroll-table overflow-auto max-h-48 border-t border-[var(--border-color-light)] pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="p-1">Kiedy</th>
                  <th className="p-1">Pole</th>
                  <th className="p-1">Stara wartość</th>
                  <th className="p-1">Nowa wartość</th>
                  <th className="p-1">Kto</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={i} className="border-t border-[var(--border-color-light)]">
                    <td className="p-1 whitespace-nowrap">{new Date(Number(a.timestamp) / 1_000_000).toLocaleString("pl-PL")}</td>
                    <td className="p-1">{a.key}</td>
                    <td className="p-1 max-w-[160px] truncate" title={a.oldValue?.[0] ?? ""}>{a.oldValue?.[0] ?? "—"}</td>
                    <td className="p-1 max-w-[160px] truncate" title={a.newValue}>{a.newValue}</td>
                    <td className="p-1 font-mono text-[9px]">{a.principal.toString().slice(0, 10)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (hasPassword === false) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm space-y-2 text-sm text-[var(--text-secondary)]">
        {header}
        <div>
          Nie masz jeszcze ustawionego hasła konfiguracji agenta. Poproś administratora o jego wygenerowanie
          (panel admina → „Hasło konfiguracji Agenta AI”).
        </div>
      </div>
    );
  }

  // Default view: password field. Shown immediately, and stays shown even
  // if the background checks above are slow, fail, or the account simply
  // doesn't have a password confirmed yet — never a bare loading state.
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 space-y-3 shadow-sm">
      {header}
      <p className="text-xs text-[var(--text-secondary)]">
        Zmiana zachowania agenta wymaga osobnego hasła konfiguracji (innego niż hasło logowania).
      </p>
      <div className="flex gap-2 items-center flex-wrap">
        <input
          type="password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
          placeholder="Hasło konfiguracji agenta"
          className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm w-64"
          autoFocus
        />
        <button
          onClick={unlock}
          disabled={unlocking || !passwordInput}
          className="px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded text-sm font-medium"
        >
          {unlocking ? "Sprawdzam…" : "Odblokuj"}
        </button>
      </div>
      {unlockError && <div className="text-xs text-red-500">{unlockError}</div>}
    </div>
  );
}

function ConfigRow({ field, value, onSave }: { field: Field; value: string; onSave: (raw: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const dirty = local !== value;

  if (field.kind === "textarea") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-primary)]">{field.label}</label>
          {dirty && (
            <button onClick={() => onSave(local)} className="px-2 py-1 text-xs rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white">
              Zapisz
            </button>
          )}
        </div>
        {field.hint && <p className="text-xs text-[var(--text-secondary)]">{field.hint}</p>}
        <textarea
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          rows={6}
          className="w-full border border-[var(--border-color)] rounded px-2 py-1.5 text-sm font-mono"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-sm text-[var(--text-primary)]">{field.label}</label>
      {field.kind === "bool" ? (
        <input type="checkbox" checked={local === "true"} onChange={(e) => setLocal(String(e.target.checked))} />
      ) : (
        <input
          type={field.kind === "number" ? "number" : "text"}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="border border-[var(--border-color)] rounded px-2 py-1 text-sm w-40"
        />
      )}
      {dirty && (
        <button onClick={() => onSave(local)} className="px-2 py-1 text-xs rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white">
          Zapisz
        </button>
      )}
    </div>
  );
}
