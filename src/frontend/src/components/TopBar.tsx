import { useEffect, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { ImportExport } from "./ImportExport";

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

  useEffect(() => {
    if (!actor) return;
    actor.isCallerAdmin().then(setIsAdmin);
    actor.getMyModules().then(setAllowedModules);
  }, [actor]);

  const tabs = [
    { id: "invoices", label: "Rejestr Faktur" },
    { id: "projects", label: "Projekty" },
    { id: "calendar", label: "Kalendarz" },
    { id: "warehouse", label: "Magazyn" },
    { id: "tickets", label: "Zgłoszenia" },
    { id: "orders", label: "Zamówienia" },
    { id: "contracts", label: "Umowy" },
    { id: "ksef", label: "KSeF" },
    { id: "drive", label: "Bartolini Drive" },
    { id: "emailSubscribers", label: "Powiadomienia" },
    { id: "devices", label: "Urządzenia" },
  ].filter((t) => allowedModules.includes(t.id));

  return (
    <div className="flex items-center justify-between flex-wrap gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-2 sm:p-3">
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        {isAdmin && (
          <button
            onClick={() => onNavigate("admin")}
            className={
              "px-2.5 py-2 sm:px-3 sm:py-1.5 text-sm rounded font-medium transition-colors " +
              (currentModule === "admin" ? "bg-cyan-600 text-white" : "border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]")
            }
          >
            Admin
          </button>
        )}
        <button onClick={onHome} className="px-2.5 py-2 sm:px-3 sm:py-1.5 text-sm border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
          Menu główne
        </button>
        <div className="w-px h-6 bg-[var(--bg-hover)] mx-1 hidden sm:block" />
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onNavigate(t.id)}
            className={
              "px-2.5 py-2 sm:px-3 sm:py-1.5 text-sm rounded font-medium transition-colors " +
              (currentModule === t.id ? "bg-cyan-600 text-white" : "border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        {expenses && payments && projects && onDataChange && (
          <ImportExport expenses={expenses} payments={payments} projects={projects} actor={actor} onChange={onDataChange} />
        )}
        <button onClick={toggleTheme} className="px-2.5 py-2 sm:px-3 sm:py-1.5 text-sm border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        {principalText && (
          <span className="font-mono text-[10px] text-[var(--text-muted)] hidden sm:inline" title={principalText}>
            {principalText.slice(0, 5)}...{principalText.slice(-3)}
          </span>
        )}
        <button onClick={logout} className="px-2.5 py-2 sm:px-3 sm:py-1.5 text-sm border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
          Wyloguj
        </button>
      </div>
    </div>
  );
}
