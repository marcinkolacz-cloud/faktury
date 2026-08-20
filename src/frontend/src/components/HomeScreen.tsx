import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";

export function HomeScreen({ onSelectModule }: { onSelectModule: (m: string) => void }) {
  const actor = useBackendActor();
  const [allowedModules, setAllowedModules] = useState<string[] | null>(null);

  useEffect(() => {
    if (!actor) return;
    actor.getMyModules().then(setAllowedModules);
  }, [actor]);

  const tiles = [
    { id: "invoices", icon: "🧾", title: "Rejestr Faktur", desc: "Zaliczki, wydatki, projekty" },
    { id: "projects", icon: "📁", title: "Projekty", desc: "Koszty projektów — cały zespół" },
    { id: "calendar", icon: "📅", title: "Kalendarz", desc: "Spotkania, wyjazdy, ważne daty, zadania" },
    { id: "warehouse", icon: "📦", title: "Magazyn", desc: "Stany, przyjęcia, wydania do projektów" },
    { id: "tickets", icon: "🎫", title: "Zgłoszenia", desc: "System ticketów" },
    { id: "orders", icon: "🛒", title: "Zamówienia", desc: "Oczekujące dostawy, zaliczki, umowy zakupu" },
    { id: "contracts", icon: "📄", title: "Umowy", desc: "Sprzedaż, lokal, internet i inne umowy" },
    { id: "ksef", icon: "🇵🇱", title: "KSeF", desc: "Pobieranie faktur" },
    { id: "drive", icon: "☁️", title: "Bartolini Drive", desc: "Pliki, zdjęcia, dokumenty (OneDrive)" },
    { id: "emailSubscribers", icon: "✉️", title: "Powiadomienia e-mail", desc: "Lista adresatów pilnych powiadomień" },
    { id: "devices", icon: "🛩️", title: "Rejestr urządzeń", desc: "Urządzenia klientów, gwarancje, support" },
    { id: "documentation", icon: "📖", title: "Dokumentacja", desc: "Instrukcje obsługi urządzeń (pełnoekranowy edytor)" },
    { id: "agent", icon: "🤖", title: "Agent AI", desc: "Szablony budowy, harmonogramy, czat" },
  ];

  const visibleTiles = allowedModules === null ? [] : tiles.filter((t) => allowedModules.includes(t.id === "documentation" ? "devices" : t.id));
  const allTiles = allowedModules === null
    ? []
    : [...visibleTiles, { id: "manual", icon: "📖", title: "Instrukcja", desc: "Jak korzystać z poszczególnych modułów" }];

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-6">
      <div className="max-w-5xl w-full space-y-6">
        <div className="flex items-center gap-4 justify-center">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-10" />
        </div>
        {allowedModules === null ? (
          <p className="text-center text-gray-500">Ładowanie...</p>
        ) : visibleTiles.length === 0 ? (
          <p className="text-center text-gray-500">Brak dostępnych modułów. Skontaktuj się z administratorem.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {allTiles.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectModule(t.id)}
                className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-4 text-left shadow-sm hover:shadow-md hover:border-cyan-400 hover:-translate-y-0.5 transition-all flex flex-col gap-1"
              >
                <span className="text-2xl leading-none">{t.icon}</span>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">{t.title}</h2>
                <p className="text-xs text-gray-500 leading-snug line-clamp-2">{t.desc}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
