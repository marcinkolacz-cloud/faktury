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
        "w-full flex items-center gap-2 px-3 py-2 text-sm rounded font-medium transition-colors text-left " +
        (currentModule === id ? "bg-cyan-600 text-white" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]")
      }
    >
      <span className="text-base leading-none shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col bg-[var(--bg-card)] border-r border-[var(--border-color)] overflow-y-auto overflow-x-hidden"
      style={{ width }}
    >
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[var(--border-color)]">
        <label className="flex items-center gap-2 cursor-pointer select-none" title="Zwiń/rozwiń menu">
          <input
            type="checkbox"
            checked={!collapsed}
            onChange={(e) => setCollapsed(!e.target.checked)}
            className="w-4 h-4 accent-cyan-600 shrink-0"
          />
          {!collapsed && <span className="text-xs text-[var(--text-secondary)]">Menu</span>}
        </label>
      </div>

      <div className="flex-1 flex flex-col gap-1 p-2">
        <NavBtn id="home" icon="🏠" label="Menu główne" onClick={onHome} />
        {isAdmin && <NavBtn id="admin" icon="🛡️" label="Admin" onClick={() => onNavigate("admin")} />}
        <div className="h-px bg-[var(--border-color)] my-1" />
        {GROUPS.map((g) => {
          const groupTabs = tabs.filter((t) => t.group === g);
          if (groupTabs.length === 0) return null;
          return (
            <div key={g} className="mt-1">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{g}</div>
              )}
              <div className="flex flex-col gap-1">
                {groupTabs.map((t) => (
                  <NavBtn key={t.id} id={t.id} icon={t.icon} label={t.label} onClick={() => onNavigate(t.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-2 border-t border-[var(--border-color)] flex flex-col gap-1">
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
  );
}
