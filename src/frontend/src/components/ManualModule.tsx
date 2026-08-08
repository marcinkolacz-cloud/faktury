import { useEffect, useMemo, useRef, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";

type Section = { id: string; title: string; icon: string; body: string[] };

const sections: Section[] = [
  {
    id: "invoices",
    icon: "🧾",
    title: "Rejestr Faktur",
    body: [
      "Główny rejestr wydatków firmy. Każdy wydatek ma: produkt/usługę, dostawcę, projekt (przypisanie kosztu do konkretnego projektu, np. BAS004), datę zamówienia, cenę brutto i netto (stawka VAT liczona automatycznie), numer faktury, osobę płacącą i notatkę.",
      "Trzy niezależne znaczniki statusu na każdym wierszu: „Opłacone” (czy firma zapłaciła dostawcy), „FV” (czy faktura fizycznie wpłynęła) i „Potwierdzone” (czy wpis został zweryfikowany). Klikasz je bezpośrednio w tabeli — nie trzeba otwierać edycji.",
      "Filtry statusu u góry (Wszystkie / Nieopłacone / Bez faktury / Niepotwierdzone) pozwalają szybko znaleźć wydatki wymagające działania. Filtry kolumnowe (pod nagłówkami tabeli) filtrują tekstowo po produkcie, dostawcy, projekcie itd.",
      "Formularz „+ Dodaj wydatek”: pola przechodzi się strzałkami/Tab, Enter w ostatnim polu zatwierdza. Stawka VAT (23/8/5/0%) automatycznie przelicza cenę netto z brutto.",
      "Checkbox „Poinformuj o wydatku mailem (szybszy zwrot kosztów)” — po zaznaczeniu wybierasz adresatów z listy Powiadomień e-mail; mail z podsumowaniem wydatku (produkt, kwota, kto zapłacił, nr faktury) idzie od razu po dodaniu. Przydatne, gdy pracownik zapłacił z własnej kieszeni.",
      "Osobno w tym samym widoku: Zaliczki (wpłaty zaliczkowe, z datą/kwotą/walutą/notatką) oraz zakładka Projekty pokazująca sumy kosztów per projekt.",
      "Import/Eksport Excel (przycisk w prawym górnym rogu) — eksportuje bieżące dane do .xlsx, import wczytuje plik i dopisuje tylko brakujące rekordy (rozpoznawane po kombinacji produkt+dostawca+data+cena), nic nie nadpisuje.",
      "Osobno: „Kopia zapasowa” w Adminie eksportuje/importuje WSZYSTKIE moduły naraz do jednego pliku JSON (patrz sekcja Admina) — to inny mechanizm niż import/eksport Excel tutaj, który dotyczy tylko wydatków i zaliczek.",
    ],
  },
  {
    id: "projects",
    icon: "📁",
    title: "Projekty",
    body: [
      "Lista projektów (np. BAS001, BAS004) i zsumowane koszty przypisane do każdego z nich — dane pochodzą z wydatków w Rejestrze Faktur, które mają ustawione pole „Projekt”.",
      "Nowy projekt można utworzyć wpisując jego nazwę bezpośrednio w polu „Projekt” przy dodawaniu wydatku w Rejestrze Faktur — system utworzy go automatycznie, jeśli jeszcze nie istnieje (podpowiedzi z listy istniejących projektów pojawiają się podczas wpisywania).",
      "Widok jest wspólny dla całego zespołu — każdy z dostępem do modułu widzi te same sumy kosztów, niezależnie kto dany wydatek dodał.",
    ],
  },
  {
    id: "calendar",
    icon: "📅",
    title: "Kalendarz",
    body: [
      "Cztery typy wydarzeń: spotkanie, wyjazd, ważna data, zadanie. Każde ma tytuł, opis, datę początkową i końcową (dla wydarzeń jednodniowych obie daty są takie same) oraz autora.",
      "Przy tworzeniu nowego wydarzenia checkbox „Ważne — wyślij powiadomienie mailem” odsłania listę adresatów z Powiadomień e-mail; mail z datą i opisem wychodzi natychmiast po zapisaniu wydarzenia.",
      "Do istniejącego wydarzenia można dopisywać notatki (przycisk „+ Notatka”, wymaga tytułu notatki). Przy każdej notatce jest osobny checkbox „Powiadom zespół mailem o tej informacji” z własną listą adresatów — działa niezależnie od powiadomienia przy tworzeniu wydarzenia.",
      "Wydarzenia mogą też powstawać automatycznie ze zgłoszeń (moduł Zgłoszenia → checkbox „Utwórz wydarzenie w kalendarzu”). Taki formularz ma osobne pole „Termin realizacji” (od–do), niezależne od daty samego zgłoszenia, i sprawdza kolizje: jeśli wybrany termin pokrywa się z innym wydarzeniem, pojawia się żółte ostrzeżenie z listą kolidujących wydarzeń, a przycisk zmienia się na „Utwórz mimo kolizji” — nic nie blokuje utworzenia, to tylko świadome ostrzeżenie.",
      "Wydarzenie powiązane ze zgłoszeniem widać w obu miejscach: w Zgłoszeniach jako link „📅 [tytuł wydarzenia]” z opcją „Odłącz”, a w Kalendarzu jako zwykłe wydarzenie typu „zadanie”.",
      "Do wydarzenia można też dołączać załączniki (pliki) — widoczne bezpośrednio przy wydarzeniu.",
    ],
  },
  {
    id: "warehouse",
    icon: "📦",
    title: "Magazyn",
    body: [
      "Karta magazynowa każdej pozycji: nazwa, opis części, model, link (np. do sklepu dostawcy), producent, numer seryjny, kategoria, lokalizacja przechowywania, notatka i bieżąca ilość na stanie.",
      "Dwa znaczniki zastosowania: „część zamienna” oraz do jakiego typu urządzenia pasuje (FNPT2 / Trainer) — ułatwia filtrowanie części pod konkretny model symulatora.",
      "Ruchy magazynowe (przyjęcia i wydania) zapisują: typ ruchu, ilość, datę, kto wykonał, opcjonalnie do jakiego projektu wydano część, oraz notatkę. Historia ruchów dla danej pozycji buduje pełny ślad audytowy stanu.",
      "Kategorie magazynowe porządkują pozycje (np. elektronika, mechanika, materiały eksploatacyjne) i pozwalają filtrować listę.",
    ],
  },
  {
    id: "tickets",
    icon: "🎫",
    title: "Zgłoszenia",
    body: [
      "System ticketów: klienci zgłaszają problem przez publiczny formularz (adres z linkiem, bez logowania), zespół odpowiada z poziomu tej zakładki. Każdy ticket ma status (nowe / w trakcie / zamknięte), dane klienta (imię, e-mail), temat i opis.",
      "Odpowiadając na zgłoszenie masz dwa niezależne checkboxy: „Notatka wewnętrzna” (odpowiedź NIE trafia do klienta, tylko zostaje w systemie jako wewnętrzny komentarz zespołu — przycisk zmienia się wtedy na „Zapisz notatkę”) oraz „Powiadom zespół mailem” (dodatkowe powiadomienie do wybranych adresów z listy Powiadomień e-mail, niezależne od tego czy odpowiedź idzie do klienta).",
      "Pole „Numer urządzenia” w danych zgłoszenia (np. BAS001, TRA002 — wpisywane przez klienta w formularzu lub uzupełniane przez zespół) automatycznie łączy zgłoszenie z kartą tego urządzenia w module Rejestr urządzeń — nie trzeba nic dodatkowo klikać, dopasowanie jest po dokładnym symbolu (wielkość liter nieistotna).",
      "Sekcja „Kalendarz i dysk” przy zgłoszeniu: checkbox „Utwórz wydarzenie w kalendarzu dla tego zgłoszenia” otwiera panel z osobnym terminem realizacji i sprawdzaniem kolizji (patrz sekcja Kalendarz). Można też połączyć zgłoszenie z już istniejącym wydarzeniem z listy rozwijanej, zamiast tworzyć nowe. Każde zgłoszenie ma też automatycznie tworzony folder na OneDrive na załączniki/zdjęcia od klienta.",
      "Zgłoszenia można archiwizować (znikają z głównego widoku, ale zostają w systemie) oraz przeglądać licznik nieprzeczytanych odpowiedzi po stronie klienta.",
    ],
  },
  {
    id: "orders",
    icon: "🛒",
    title: "Zamówienia",
    body: [
      "Osobny rejestr od Rejestru Faktur — dotyczy zamówień u dostawców, które są w trakcie realizacji (status: oczekujące / zrealizowane / anulowane), a nie już poniesionych wydatków.",
      "Każde zamówienie: nazwa, ilość, dostawca, kwota całkowita, kwota zaliczki wpłaconej, waluta, data, notatka. Ma też własny folder na dysku (OneDrive) na dokumenty zamówienia (potwierdzenie, faktura pro forma itp.).",
      "Zmiana statusu zamówienia (np. na „zrealizowane”) nie tworzy automatycznie wpisu w Rejestrze Faktur — to trzeba zrobić ręcznie po otrzymaniu faktury końcowej.",
    ],
  },
  {
    id: "contracts",
    icon: "📄",
    title: "Umowy",
    body: [
      "Rejestr umów firmy: sprzedaży, najmu lokalu, internetu i innych stałych zobowiązań. Każda umowa ma: tytuł, kategorię, kontrahenta, opis, datę zakończenia obowiązywania i własny folder na dysku (OneDrive) na skan/dokument umowy.",
      "Data zakończenia pozwala pilnować, kiedy umowa wygasa — warto sprawdzać cyklicznie, moduł nie wysyła jeszcze automatycznych przypomnień o zbliżającym się końcu umowy.",
    ],
  },
  {
    id: "ksef",
    icon: "🇵🇱",
    title: "KSeF",
    body: [
      "Integracja z Krajowym Systemem e-Faktur — automatyczne pobieranie faktur wystawionych na firmę bezpośrednio z systemu Ministerstwa Finansów, bez ręcznego wgrywania PDF-ów.",
      "Pobrane faktury mają numer KSeF, dane pozycji (linie faktury) i status udostępnienia. Udostępnienie faktury (np. do księgowości) generuje plik HTML z treścią faktury i wgrywa go automatycznie na OneDrive, a link do niego zostaje zapisany przy fakturze.",
      "Sortowanie po dacie działa poprawnie dla polskiego formatu DD.MM.RRRR (wewnętrznie przeliczane na RRRR-MM-DD do porównania) — jeśli data wygląda dziwnie posortowana, to raczej problem z formatem wejściowym z KSeF niż z samym sortowaniem.",
    ],
  },
  {
    id: "drive",
    icon: "☁️",
    title: "Bartolini Drive",
    body: [
      "Widok plików przechowywanych na OneDrive, zintegrowany z resztą systemu — Zgłoszenia, Zamówienia i Umowy mają automatycznie tworzone własne podfoldery, więc pliki powiązane z danym zgłoszeniem/zamówieniem/umową znajdziesz zarówno bezpośrednio w tym module, jak i w panelu bocznym danego rekordu.",
      "Upload zdjęć z publicznego formularza zgłoszenia (od klienta) trafia tu automatycznie, z anonimowym tokenem uploadu — klient nie potrzebuje konta ani logowania.",
    ],
  },
  {
    id: "emailSubscribers",
    icon: "✉️",
    title: "Powiadomienia e-mail",
    body: [
      "Centralna lista adresów e-mail, które mogą otrzymywać powiadomienia z systemu. Każdy adres ma nazwę (opcjonalnie) i checkbox „Pilne”.",
      "Checkbox „Pilne” decyduje, czy dany adres trafi na listę odbiorców przycisku „Wyślij pilne powiadomienie” w tym module (dowolny temat + treść, wysyłane do wszystkich zaznaczonych na raz).",
      "Ta sama lista (wszystkie adresy, nie tylko „Pilne”) jest wykorzystywana jako wybór odbiorców w trzech innych miejscach: przy odpowiedzi na zgłoszenie („Powiadom zespół mailem”), przy dodawaniu/edycji wydarzenia w kalendarzu i notatki do wydarzenia, oraz przy dodawaniu wydatku w Rejestrze Faktur — wszędzie tam wybierasz konkretne adresy z tej listy niezależnie od checkboxa „Pilne”.",
      "Wysyłka realizowana jest przez zewnętrzny serwis (Resend) poprzez Cloudflare Worker — jeśli mail nie dochodzi mimo braku błędu w interfejsie, sprawdź spam u odbiorcy lub zgłoś to do administratora systemu.",
    ],
  },
  {
    id: "devices",
    icon: "🛩️",
    title: "Rejestr urządzeń",
    body: [
      "Karty urządzeń klientów (symulatorów FNPT2, Trainerów itd.) z symbolem (np. BAS001, TRA001 — ten sam symbol co w polu „Numer urządzenia” zgłoszeń), nazwą, klientem, lokalizacją, uwagami, datą zakupu i gwarancji, pakietem support (np. Platinum/Standard) i osobą kontaktową.",
      "Pole „Total time flight” (nalot w godzinach:minutach, np. 995h:45min) pokazuje aktualny stan licznika nalotu urządzenia — jest to wartość nagłówkowa, aktualizowana automatycznie na podstawie ostatniego wpisu serwisowego (patrz niżej), a nie wpisywana ręcznie w karcie.",
      "Lista urządzeń pokazuje od razu: symbol, nazwę, klienta, lokalizację, liczbę powiązanych zgłoszeń, pakiet support oraz status gwarancji — czerwona plakietka „Gwarancja wygasła” lub żółta „Gwarancja wygasa wkrótce” (poniżej 30 dni do końca).",
      "Kliknięcie w urządzenie otwiera szczegóły z dwiema sekcjami: „Historia zgłoszeń” — automatyczna, dopasowana po dokładnym symbolu urządzenia w polu „Numer urządzenia” zgłoszenia (wielkość liter nieistotna, ale literówka w symbolu = brak dopasowania), z rozwijanymi szczegółami po kliknięciu w dane zgłoszenie (klient, status, opis, liczba odpowiedzi); oraz „Prace serwisowe” — wpisy wprowadzane ręcznie (data, opis wykonanej pracy, kto wykonał), całkowicie niezależne od systemu zgłoszeń — dla rutynowych przeglądów, które nie przechodziły przez formularz klienta.",
      "Każdy wpis serwisowy ma własne pole stanu nalotu (h:min) — wpisując nowy wpis serwisowy, wpisz aktualny odczyt licznika; automatycznie zaktualizuje to nagłówkową wartość „Total time flight” na karcie urządzenia.",
      "Urządzenia usunięte trafiają do kosza (nie znikają bezpowrotnie) — na razie bez osobnego widoku przywracania z poziomu interfejsu, w razie potrzeby przywrócenia skontaktuj się z administratorem.",
    ],
  },
];

function highlight(text: string) {
  const parts = text.split(/(„[^”]+”)/g);
  return parts.map((part, i) =>
    part.startsWith("„") && part.endsWith("”") ? (
      <span key={i} className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 font-medium text-[13px]">
        {part.slice(1, -1)}
      </span>
    ) : (
      part
    )
  );
}

export function ManualModule({ onHome, onNavigate, currentModule, initialAnchor }: {
  onHome: () => void; onNavigate: (m: string) => void; currentModule: string; initialAnchor?: string;
}) {
  const actor = useBackendActor();
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(initialAnchor ? [initialAnchor] : []));

  useEffect(() => {
    if (initialAnchor) {
      setOpenIds((prev) => new Set(prev).add(initialAnchor));
      setTimeout(() => refs.current[initialAnchor]?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }, [initialAnchor]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return sections;
    return sections.filter((s) => s.title.toLowerCase().includes(q) || s.body.some((p) => p.toLowerCase().includes(q)));
  }, [q]);

  useEffect(() => {
    if (q) setOpenIds(new Set(filtered.map((s) => s.id)));
  }, [q]);

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] p-3 sm:p-6 space-y-4">
      <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />

      <div className="max-w-4xl mx-auto flex gap-6">
        <div className="hidden md:block w-48 shrink-0 sticky top-4 self-start space-y-1">
          <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Spis treści</p>
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => { setOpenIds((prev) => new Set(prev).add(s.id)); refs.current[s.id]?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              className={
                "block w-full text-left px-2 py-1 text-xs rounded hover:bg-[var(--bg-card)] " +
                (initialAnchor === s.id ? "text-cyan-600 font-medium" : "text-[var(--text-secondary)]")
              }
            >
              {s.icon} {s.title}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Instrukcja obsługi</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Kliknij ❓ w dowolnym module, żeby przejść od razu do jego sekcji. Kliknij nagłówek sekcji, żeby ją rozwinąć/zwinąć.
            </p>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Szukaj (np. „gwarancja”, „powiadom”, „projekt”)..."
            className="w-full px-3 py-2 text-sm rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)]"
          />
          {q && filtered.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Brak wyników dla „{query}”.</p>
          )}

          <div className="space-y-3">
            {filtered.map((s) => {
              const isOpen = openIds.has(s.id);
              return (
                <div
                  key={s.id}
                  id={s.id}
                  ref={(el) => { refs.current[s.id] = el; }}
                  className={
                    "bg-[var(--bg-card)] border rounded-lg scroll-mt-4 overflow-hidden " +
                    (initialAnchor === s.id ? "border-cyan-500" : "border-[var(--border-color)]")
                  }
                >
                  <button
                    onClick={() => toggle(s.id)}
                    className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-[var(--bg-hover)]"
                  >
                    <h2 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <span>{s.icon}</span> {s.title}
                    </h2>
                    <span className="text-[var(--text-muted)] text-sm shrink-0">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  {isOpen && (
                    <ul className="px-4 pb-4 space-y-2 list-disc list-outside ml-4">
                      {s.body.map((p, i) => (
                        <li key={i} className="text-sm text-[var(--text-secondary)] leading-relaxed">{highlight(p)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
