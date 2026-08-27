import { useEffect, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { ImportExport } from "./ImportExport";

const EXPANDED_W = 220;
const COLLAPSED_W = 64;

type Tab = { id: string; label: string; icon: string; group: string };

const GROUPS = ["Główne", "Operacje", "Dokumenty", "Narzędzia"];

const ALL_TABS: Tab[] = [
  { id: "invoices", label: "Rejestr Faktur", icon: "🧾", group: "Główne" },
  { id: "projects", label: "Projekty", icon: "📁", group: "Główne" },
  { id: "calendar", label: "Kalendarz", icon: "📅", group: "Operacje" },
  { id: "warehouse", label: "Magazyn", icon: "📦", group: "Operacje" },
  { id: "tickets", label: "Zgłoszenia", icon: "🎫", group: "Operacje" },
  { id: "orders", label: "Zamówienia", icon: "🛒", group: "Operacje" },
  { id: "contracts", label: "Umowy", icon: "📄", group: "Operacje" },
  { id: "ksef", label: "KSeF", icon: "🧮", group: "Operacje" },
  { id: "drive", label: "Bartolini Drive", icon: "☁️", group: "Dokumenty" },
  { id: "documentation", label: "Dokumentacja", icon: "📖", group: "Dokumenty" },
  { id: "logbook", label: "Dziennik", icon: "📘", group: "Dokumenty" },
  { id: "devices", label: "Urządzenia", icon: "🖥️", group: "Narzędzia" },
  { id: "emailSubscribers", label: "Powiadomienia", icon: "🔔", group: "Narzędzia" },
  { id: "agent", label: "Agent AI", icon: "🤖", group: "Narzędzia" },
];

export function TopBar({ currentModule, onNavigate, onHome, actor, expenses, payments, projects, onDataChange }: {
  currentModule: string;
  onNavigate: (m: string) => void;
  onHome: () => void;
  actor: any;
  expenses?: any[];
  payments?: any[];
  projects?: any[];
  onDataChange?: () => void;
}) {
  const { logout, identity } = useAuthContext();
  const principalText = identity ? identity.getPrincipal().toText() : "";
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");

  useEffect(() => {
    if (!actor) return;
    actor.isCallerAdmin().then(setIsAdmin);
    actor.getMyModules().then(setAllowedModules);
  }, [actor]);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
    const w = collapsed ? COLLAPSED_W : EXPANDED_W;
    document.body.style.paddingLeft = w + "px";
    document.body.style.transition = "padding-left 0.15s ease";
    return () => {
      document.body.style.paddingLeft = "";
    };
  }, [collapsed]);

  const tabs = ALL_TABS.filter((t) => allowedModules.includes(t.id === "documentation" ? "devices" : t.id));
  tabs.push({ id: "manual", label: "Instrukcja", icon: "📚", group: "Narzędzia" });

  const width = collapsed ? COLLAPSED_W : EXPANDED_W;

  const NavBtn = ({ id, icon, label, onClick }: { id: string; icon: string; label: string; onClick: () => void }) => (
    <button
      key={id}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={
        "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-lg font-medium transition-colors text-left " +
        (currentModule === id
          ? "bg-[var(--accent-light)] text-[var(--accent-text)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]")
      }
    >
      <span className="text-base leading-none shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  return (
    <>
    <div
      className="fixed top-1 right-2 z-50 text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-card)] px-1.5 py-0.5 rounded border border-[var(--border-color)] select-none pointer-events-none"
      title={"Build: " + __BUILD_HASH__ + " · " + __BUILD_TIME__}
    >
      v.{__BUILD_HASH__}
    </div>
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col bg-[var(--bg-card)] border-r border-[var(--border-color)] overflow-y-auto overflow-x-hidden"
      style={{ width }}
    >
      <div className="px-3 py-4 border-b border-[var(--border-color)]">
        <button onClick={onHome} className="w-full flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white text-base shrink-0">🧾</div>
          {!collapsed && (
            <div className="text-left min-w-0">
              <div className="text-sm font-bold text-[var(--text-primary)] leading-tight truncate">Open<span className="text-[var(--accent)]">SaaS</span></div>
              <div className="text-[10px] text-[var(--text-muted)] leading-tight truncate">Bartolini Air Simulation</div>
            </div>
          )}
        </button>
        <label className="flex items-center gap-2 cursor-pointer select-none mt-3" title="Zwiń/rozwiń menu">
          <input
            type="checkbox"
            checked={!collapsed}
            onChange={(e) => setCollapsed(!e.target.checked)}
            className="w-3.5 h-3.5 accent-[var(--accent)] shrink-0"
          />
          {!collapsed && <span className="text-[11px] text-[var(--text-muted)]">Rozwinięte menu</span>}
        </label>
      </div>

      <div className="flex-1 flex flex-col gap-1 p-2.5">
        <NavBtn id="home" icon="🏠" label="Menu główne" onClick={onHome} />
        {isAdmin && <NavBtn id="admin" icon="🛡️" label="Admin" onClick={() => onNavigate("admin")} />}
        <div className="h-px bg-[var(--border-color)] my-2" />
        {GROUPS.map((g) => {
          const groupTabs = tabs.filter((t) => t.group === g);
          if (groupTabs.length === 0) return null;
          return (
            <div key={g} className="mt-2">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{g}</div>
              )}
              <div className="flex flex-col gap-0.5">
                {groupTabs.map((t) => (
                  <NavBtn key={t.id} id={t.id} icon={t.icon} label={t.label} onClick={() => onNavigate(t.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-2.5 border-t border-[var(--border-color)] flex flex-col gap-0.5">
        {expenses && payments && projects && onDataChange && (
          <div className={collapsed ? "flex justify-center" : ""}>
            <ImportExport expenses={expenses} payments={payments} projects={projects} actor={actor} onChange={onDataChange} />
          </div>
        )}
        <NavBtn
          id="help"
          icon="❓"
          label="Pomoc"
          onClick={() => onNavigate(currentModule && currentModule !== "manual" ? "manual#" + currentModule : "manual")}
        />
        <NavBtn id="theme" icon={theme === "dark" ? "☀️" : "🌙"} label={theme === "dark" ? "Jasny motyw" : "Ciemny motyw"} onClick={toggleTheme} />
        {principalText && !collapsed && (
          <span className="font-mono text-[10px] text-[var(--text-muted)] px-3" title={principalText}>
            {principalText.slice(0, 5)}...{principalText.slice(-3)}
          </span>
        )}
        <NavBtn id="logout" icon="🚪" label="Wyloguj" onClick={logout} />
      </div>
    </aside>
    </>
  );
}
