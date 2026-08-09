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
    { id: "invoices", title: "Rejestr Faktur", desc: "Zaliczki, wydatki, projekty" },
    { id: "projects", title: "Projekty", desc: "Koszty projektów — cały zespół" },
    { id: "calendar", title: "Kalendarz", desc: "Spotkania, wyjazdy, ważne daty, zadania" },
    { id: "warehouse", title: "Magazyn", desc: "Stany, przyjęcia, wydania do projektów" },
    { id: "tickets", title: "Zgłoszenia", desc: "System ticketów" },
    { id: "orders", title: "Zamówienia", desc: "Oczekujące dostawy, zaliczki, umowy zakupu" },
    { id: "contracts", title: "Umowy", desc: "Sprzedaż, lokal, internet i inne umowy" },
    { id: "ksef", title: "KSeF", desc: "Pobieranie faktur" },
    { id: "drive", title: "Bartolini Drive", desc: "Pliki, zdjęcia, dokumenty (OneDrive)" },
    { id: "emailSubscribers", title: "Powiadomienia e-mail", desc: "Lista adresatów pilnych powiadomień" },
    { id: "devices", title: "Rejestr urządzeń", desc: "Urządzenia klientów, gwarancje, support, historia zgłoszeń" },
    { id: "agent", title: "🤖 Agent AI", desc: "Konfiguracja zachowania i uprawnień agenta" },
  ];

  const visibleTiles = allowedModules === null ? [] : tiles.filter((t) => allowedModules.includes(t.id));
  const allTiles = allowedModules === null
    ? []
    : [...visibleTiles, { id: "manual", title: "📖 Instrukcja", desc: "Jak korzystać z poszczególnych modułów" }];

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-6">
      <div className="max-w-3xl w-full space-y-6">
        <div className="flex items-center gap-4 justify-center">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-10" />
        </div>
        {allowedModules === null ? (
          <p className="text-center text-gray-500">Ładowanie...</p>
        ) : visibleTiles.length === 0 ? (
          <p className="text-center text-gray-500">Brak dostępnych modułów. Skontaktuj się z administratorem.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {allTiles.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectModule(t.id)}
                className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-6 text-left shadow-sm hover:shadow-md hover:border-[var(--border-color)] transition-all"
              >
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t.title}</h2>
                <p className="text-sm text-gray-500 mt-1">{t.desc}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
