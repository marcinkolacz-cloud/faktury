import { Fragment, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createPublicActor } from "../lib/publicActor";
import { useTheme } from "../providers/ThemeProvider";

type ActivityType = "szkolenie" | "komercyjne" | "techniczne";
type Lang = "pl" | "en";

const T = {
  pl: {
    loginTitle: "Dziennik użytkowania — logowanie",
    loginSubtitle: "Zaloguj się firmowym adresem e-mail i PIN-em otrzymanym od administratora.",
    pinPlaceholder: "PIN (6 cyfr)",
    loginBtn: "Zaloguj",
    loggingIn: "Logowanie...",
    loginErrorFill: "Podaj email (@bartoliniair.com) i 6-cyfrowy PIN.",
    loginErrorInvalid: "Nieprawidłowy email lub PIN.",
    loginErrorLockout: "Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.",
    loginErrorGeneric: "Błąd logowania. Spróbuj ponownie.",
    logout: "Wyloguj",
    headerTitle: "DZIENNIK UŻYTKOWANIA URZĄDZENIA",
    tabNew: "Nowy wpis",
    tabHistory: "Moja historia",
    histFrom: "Od",
    histTo: "Do",
    clearFilters: "Wyczyść filtry",
    devicesFilterLabel: "Urządzenia",
    selectAllDevices: "Zaznacz wszystkie",
    clearAllDevices: "Odznacz wszystkie",    exportExcel: "📊 Eksportuj do Excel",
    loadingHist: "Ładowanie...",
    colData: "Data",
    colDevice: "Urządzenie",
    colTrained: "Szkoleni",
    colHours: "Godz.",
    colDuration: "Czas",
    colCounter: "Licznik",
    colFaults: "Usterki",
    colActions: "Akcje",
    faultsNone: "Brak",
    editBtn: "✏ Popraw",
    reportedTicket: "✔ Zgłoszono (ticket #",
    reportCorrectionBtn: "🎫 Zgłoś korektę",
    editPanelTitle: "✏ Poprawka ostatniego wpisu (dopóki nikt nie doda kolejnego)",
    fieldDate: "Data",
    fieldTrained: "Szkoleni",
    fieldStart: "Godz. rozpoczęcia",
    fieldEnd: "Godz. zakończenia",
    fieldCounter: "Licznik po sesji",
    fieldType: "Rodzaj",
    typeTraining: "Szkolenie",
    typeCommercial: "Komerc.",
    typeTechnical: "Techniczne",
    noFaults: "Brak usterek",
    cancel: "Anuluj",
    saving: "Zapisywanie…",
    saveCorrection: "💾 Zapisz poprawkę",
    editNotAllowed: "Ten wpis nie jest już edytowalny — ktoś dodał nowszy wpis w dzienniku. Zgłoś korektę przyciskiem „🎫 Zgłoś korektę”.",
    editSaveFailed: "Nie udało się zapisać zmian.",
    correctionPanelTitle: "🎫 Zgłoś korektę tego wpisu",
    correctionPanelBody: "Ten wpis nie jest już ostatni w dzienniku, więc nie możesz go sam poprawić. Opisz, co jest błędne — zostanie utworzone zgłoszenie (ticket), które zobaczy admin.",
    correctionPlaceholder: "np. Godzina zakończenia powinna być 15:40, nie 15:20",
    sendCorrectionBtn: "Wyślij zgłoszenie",
    sending: "Wysyłanie…",
    noEntries: "Brak wpisów.",
    helpToggle: "❓ Jak wypełnić dziennik",
    collapse: "▲ zwiń",
    expand: "▼ rozwiń",
    help1Title: "1. Urządzenie i dane sesji",
    help1Body: "Wybierz urządzenie z listy — po wyborze pole „Licznik po sesji” samo podpowie startową wartość (dotychczasowy nalot urządzenia). Twoje imię i nazwisko uzupełnia się automatycznie po zalogowaniu (z rejestru instruktorów) — jeśli dotyczy, wpisz osoby szkolone. PIN do logowania dostajesz mailem automatycznie po dodaniu przez administratora lub po kliknięciu „Nie pamiętam PIN-u” na ekranie logowania (tylko dla już zarejestrowanych adresów).",
    help2Title: "2. Godziny i licznik",
    help2Body: "Podaj godzinę rozpoczęcia i zakończenia — „Czas sesji” wyliczy się sam. W polu „Licznik po sesji” wpisz łączny nalot urządzenia PO tej sesji (godziny:minuty, np. 2455:50), nie czas samej sesji — system doda go do poprzedniego stanu licznika automatycznie przy kolejnym wpisie.",
    help3Title: "3. Usterki",
    help3Body: "Zostaw zaznaczone „Brak usterek”, jeśli wszystko działało prawidłowo. Jeśli coś zauważyłeś — odznacz i krótko opisz usterkę w polu tekstowym, które się pojawi.",
    help4Title: "4. Podpis i zatwierdzenie",
    help4Body: "Podpisz się palcem lub rysikiem w polu podpisu — bez podpisu wpisu nie da się zatwierdzić. Pomyliłeś się? „Wyczyść podpis” i podpisz jeszcze raz. Na koniec kliknij „✔ Zatwierdź wpis” — po zapisaniu formularz sam się czyści pod kolejny wpis.",
    help5Title: "5. Poprawianie wpisów",
    help5Body: "W zakładce „Moja historia” możesz poprawić TYLKO swój ostatni wpis w całym dzienniku (dowolne urządzenie) — przycisk „✏ Popraw” pojawia się tylko przy nim. Jeśli ktokolwiek — na dowolnym urządzeniu — doda po Tobie nowy wpis, tracisz tę możliwość (to zabezpieczenie licznika nalotu). Wtedy zamiast „✏ Popraw” zobaczysz „🎫 Zgłoś korektę” — opisujesz błąd, powstaje zgłoszenie (ticket) do administratora, który poprawi wpis ręcznie.",
    deviceLabel: "Urządzenie",
    deviceSelectPlaceholder: "— wybierz urządzenie —",
    deviceWarning: "Najpierw wybierz urządzenie z listy powyżej — dopiero po wyborze pojawi się potwierdzenie i będzie można kontynuować wpis.",
    deviceConfirmPrefix: "Wpis dotyczy urządzenia:",
    deviceConfirmSuffix: " — sprawdź, czy to na pewno to urządzenie, zanim wypełnisz resztę formularza.",
    savedFlash: "✔ Wpis zapisany. Formularz gotowy na kolejny wpis.",
    tblInstructor: "Instruktor / użytkownik",
    tblTrainedIfAny: "Szkoleni (jeżeli dotyczy)",
    tblActivityType: "Rodzaj aktywności",
    tblStart: "Godz. rozpoczęcia",
    tblEnd: "Godz. zakończenia",
    tblSessionTime: "Czas sesji",
    tblCounterAfter: "Licznik po sesji",
    namePlaceholder: "Imię i nazwisko",
    counterPlaceholderNoDevice: "wybierz urządzenie",
    counterHint: "ⓘ stan licznika PO sesji, nie czas sesji",
    faultsBoxTitle: "Usterki",
    faultDescLabel: "Opis usterki:",
    signatureLabel: "Podpis instruktora:",
    signatureCaption: "podpis",
    clearSignatureBtn: "Wyczyść podpis",
    techBoxTitle: "Wpisy techniczne",
    techBoxBody: "Wypełnia technik osobno.",
    submitBtn: "✔ Zatwierdź wpis",
    submitting: "Zapisywanie...",
    errSelectDevice: "Wybierz urządzenie.",
    errName: "Podaj imię i nazwisko instruktora / użytkownika.",
    errTimes: "Podaj godzinę rozpoczęcia i zakończenia sesji.",
    errCounter: "Podaj licznik po sesji.",
    errFaultDesc: "Opisz usterkę albo zaznacz „Brak usterek”.",
    errSignature: "Wymagany podpis instruktora.",
    errSaveFailed: "Nie udało się zapisać wpisu.",
    errSessionExpired: "Sesja wygasła — zaloguj się ponownie.",
    errSaveRetry: "Nie udało się zapisać wpisu. Spróbuj ponownie.",
  },
  en: {
    loginTitle: "Usage logbook — sign in",
    loginSubtitle: "Sign in with your company email and the PIN provided by the administrator.",
    pinPlaceholder: "PIN (6 digits)",
    loginBtn: "Sign in",
    loggingIn: "Signing in...",
    loginErrorFill: "Enter your email (@bartoliniair.com) and 6-digit PIN.",
    loginErrorInvalid: "Invalid email or PIN.",
    loginErrorLockout: "Too many failed attempts. Try again in 15 minutes.",
    loginErrorGeneric: "Sign-in error. Please try again.",
    logout: "Sign out",
    headerTitle: "DEVICE USAGE LOGBOOK",
    tabNew: "New entry",
    tabHistory: "My history",
    histFrom: "From",
    histTo: "To",
    clearFilters: "Clear filters",
    devicesFilterLabel: "Devices",
    selectAllDevices: "Select all",
    clearAllDevices: "Clear all",
    exportExcel: "📊 Export to Excel",
    loadingHist: "Loading...",
    colData: "Date",
    colDevice: "Device",
    colTrained: "Trainees",
    colHours: "Hours",
    colDuration: "Duration",
    colCounter: "Counter",
    colFaults: "Faults",
    colActions: "Actions",
    faultsNone: "None",
    editBtn: "✏ Edit",
    reportedTicket: "✔ Reported (ticket #",
    reportCorrectionBtn: "🎫 Report correction",
    editPanelTitle: "✏ Editing your last entry (until someone adds a newer one)",
    fieldDate: "Date",
    fieldTrained: "Trainees",
    fieldStart: "Start time",
    fieldEnd: "End time",
    fieldCounter: "Counter after session",
    fieldType: "Type",
    typeTraining: "Training",
    typeCommercial: "Commercial",
    typeTechnical: "Technical",
    noFaults: "No faults",
    cancel: "Cancel",
    saving: "Saving…",
    saveCorrection: "💾 Save correction",
    editNotAllowed: "This entry can no longer be edited — someone added a newer entry to the logbook. Report a correction using the „🎫 Report correction” button.",
    editSaveFailed: "Failed to save the changes.",
    correctionPanelTitle: "🎫 Report a correction for this entry",
    correctionPanelBody: "This entry is no longer the last one in the logbook, so you can't edit it yourself. Describe what's wrong — a ticket will be created for the admin to review.",
    correctionPlaceholder: "e.g. End time should be 15:40, not 15:20",
    sendCorrectionBtn: "Send report",
    sending: "Sending…",
    noEntries: "No entries.",
    helpToggle: "❓ How to fill in the logbook",
    collapse: "▲ collapse",
    expand: "▼ expand",
    help1Title: "1. Device and session data",
    help1Body: "Select a device from the list — once selected, the „Counter after session” field will suggest a starting value (the device's current flight hours). Your name is filled in automatically after login (from the instructor registry) — enter trainees if applicable. Your login PIN is emailed to you automatically when an administrator adds you, or via „I forgot my PIN” on the login screen (registered addresses only).",
    help2Title: "2. Times and counter",
    help2Body: "Enter the start and end time — „Session duration” is calculated automatically. In „Counter after session”, enter the device's total flight time AFTER this session (hours:minutes, e.g. 2455:50), not the duration of this session — the system adds it to the previous counter value automatically on the next entry.",
    help3Title: "3. Faults",
    help3Body: "Leave „No faults” checked if everything worked correctly. If you noticed something — uncheck it and briefly describe the fault in the text field that appears.",
    help4Title: "4. Signature and submission",
    help4Body: "Sign with your finger or stylus in the signature field — an entry can't be confirmed without a signature. Made a mistake? Click „Clear signature” and sign again. Finally, click „✔ Confirm entry” — after saving, the form clears itself for the next entry.",
    help5Title: "5. Correcting entries",
    help5Body: "In „My history” you can only correct YOUR last entry in the whole logbook (any device) — the „✏ Edit” button only appears next to it. If anyone — on any device — adds a new entry after yours, you lose that ability (this protects the flight-hour counter chain). In that case you'll see „🎫 Report correction” instead — describe the mistake and a ticket is created for the administrator, who will fix the entry manually.",
    deviceLabel: "Device",
    deviceSelectPlaceholder: "— select a device —",
    deviceWarning: "First select a device from the list above — only after selecting it will a confirmation appear and you'll be able to continue the entry.",
    deviceConfirmPrefix: "This entry is for device:",
    deviceConfirmSuffix: " — double-check this is the right device before filling in the rest of the form.",
    savedFlash: "✔ Entry saved. Form ready for the next entry.",
    tblInstructor: "Instructor / user",
    tblTrainedIfAny: "Trainees (if applicable)",
    tblActivityType: "Activity type",
    tblStart: "Start time",
    tblEnd: "End time",
    tblSessionTime: "Session duration",
    tblCounterAfter: "Counter after session",
    namePlaceholder: "Full name",
    counterPlaceholderNoDevice: "select a device",
    counterHint: "ⓘ counter reading AFTER the session, not the session duration",
    faultsBoxTitle: "Faults",
    faultDescLabel: "Fault description:",
    signatureLabel: "Instructor's signature:",
    signatureCaption: "signature",
    clearSignatureBtn: "Clear signature",
    techBoxTitle: "Technical entries",
    techBoxBody: "Filled in separately by a technician.",
    submitBtn: "✔ Confirm entry",
    submitting: "Saving...",
    errSelectDevice: "Select a device.",
    errName: "Enter the instructor's / user's full name.",
    errTimes: "Enter the session start and end time.",
    errCounter: "Enter the counter reading after the session.",
    errFaultDesc: "Describe the fault or check „No faults”.",
    errSignature: "Instructor's signature is required.",
    errSaveFailed: "Failed to save the entry.",
    errSessionExpired: "Session expired — please sign in again.",
    errSaveRetry: "Failed to save the entry. Please try again.",
  },
} as const;

const emptyEntry = {
  dataText: new Date().toISOString().slice(0, 10),
  deviceId: "",
  instruktorName: "",
  szkoleni: "",
  rodzajAktywnosci: "szkolenie" as ActivityType,
  godzRozpoczecia: "",
  godzZakonczenia: "",
  licznikPoSesji: "",
  brakUsterek: true,
  opisUsterki: "",
};

function sessionDurationMinutes(start: string, end: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60; // sesja przechodząca przez północ
  return minutes;
}

function czasSesji(start: string, end: string): string {
  const minutes = sessionDurationMinutes(start, end);
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Licznik urządzenia w formacie "H:MM" — godziny nieograniczone (np. "2455:50"),
// bo to sumaryczny nalot urządzenia, nie zegar dobowy.
function parseCounter(v: string): number | null {
  const m = v.trim().match(/^(\d+):(\d{1,2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function formatCounter(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return String(h) + ":" + String(m).padStart(2, "0");
}

// Podpis odręczny — canvas z obsługą pointer events (działa z piórem/rysikiem
// na tablecie, dotykiem i myszą). Eksportowany jako PNG data URL dopiero przy
// zapisie (submit), żeby nie generować base64 przy każdym pociągnięciu.
// Native <input type="time"> renders with AM/PM on some OS/browser locale
// settings, which is confusing for logging session start/end across
// midnight. Two plain <select> elements guarantee a 24h HH:MM value
// regardless of the device's locale.
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
function TimeSelect24({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value.includes(":") ? value.split(":") : ["", ""];
  return (
    <div className="flex items-center gap-1">
      <select
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m || "00"}`)}
        className="border-0 outline-none bg-transparent text-sm text-[#111] px-1 py-1.5"
      >
        <option value="">--</option>
        {HOURS_24.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <span className="text-[#111]">:</span>
      <select
        value={m}
        onChange={(e) => onChange(`${h || "00"}:${e.target.value}`)}
        className="border-0 outline-none bg-transparent text-sm text-[#111] px-1 py-1.5"
      >
        <option value="">--</option>
        {MINUTES_60.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}

function SignaturePad({ onDirtyChange, padRef }: { onDirtyChange: (dirty: boolean) => void; padRef: React.RefObject<HTMLCanvasElement | null> }) {
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = padRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    canvas.width = cssWidth * ratio;
    canvas.height = cssHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = padRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = padRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = padRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty.current) { dirty.current = true; onDirtyChange(true); }
  };

  const end = () => { drawing.current = false; };

  return (
    <canvas
      ref={padRef}
      className="w-full h-28 rounded border border-[var(--border-color)] bg-white touch-none"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
    />
  );
}

export function LogbookPublicForm() {
  const [showHelp, setShowHelp] = useState(false);
  const [lang, setLang] = useState<Lang>("pl");
  const t = T[lang];
  const { theme, toggleTheme } = useTheme();

  // --- Logowanie PIN-em ---
  const [email, setEmail] = useState(() => localStorage.getItem("logbookEmail") || "");
  const [rememberEmail, setRememberEmail] = useState(() => localStorage.getItem("logbookEmail") !== null);
  const [pin, setPin] = useState("");
  const [loginHoneypot, setLoginHoneypot] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStatus, setForgotStatus] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const requestPinReset = async () => {
    if (!email.trim()) { setForgotStatus("Podaj adres e-mail."); return; }
    setForgotLoading(true);
    setForgotStatus("");
    try {
      const actor = await createPublicActor();
      const result = (await actor.requestLogbookPinReset(email.trim(), loginHoneypot)) as [] | [[string, string]];
      if (result.length) {
        const [pin, token] = result[0];
        try {
          await fetch("https://bartolini-ticket-email.marcinkolacz.workers.dev", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({
              to: email.trim(),
              subject: "Nowy PIN do Dziennika użytkowania",
              message: "Twój nowy PIN: " + pin + "\n\nStary PIN już nie działa.",
            }),
          });
        } catch { /* email best-effort */ }
      }
    } catch { /* nie ujawniamy czy e-mail istnieje w bazie */ }
    setForgotStatus("Jeśli ten adres jest zarejestrowany, wysłaliśmy na niego nowy PIN.");
    setForgotLoading(false);
  };
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [instructorEmail, setInstructorEmail] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [view, setView] = useState<"form" | "history">("form");
  const [myHistory, setMyHistory] = useState<{ entry: any; device: string; editable: boolean; linkedTicket: number | null }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");

  const login = async () => {
    if (!email.trim() || pin.trim().length !== 6) {
      setLoginError(t.loginErrorFill);
      return;
    }
    setLoggingIn(true);
    setLoginError("");
    try {
      const actor = await createPublicActor();
      const result = (await actor.loginLogbookInstructor(email.trim(), pin.trim(), loginHoneypot)) as [] | [string];
      if (result.length === 0) {
        setLoginError(t.loginErrorInvalid);
      } else {
        setSessionToken(result[0]);
        setInstructorEmail(email.trim().toLowerCase());
        if (rememberEmail) { localStorage.setItem("logbookEmail", email.trim().toLowerCase()); } else { localStorage.removeItem("logbookEmail"); }
        setInstructorName(email.trim());
        setPin("");
        // Próba podmiany na prawdziwe imię/nazwisko z rejestru instruktorów —
        // działa "w tle": jeśli się nie uda z jakiegokolwiek powodu, pole
        // zostaje przy e-mailu (patrz setInstructorName wyżej), formularz
        // nadal działa. Serwer i tak zapisuje wpis pod prawdziwym imieniem
        // z rejestru niezależnie od tego, co pokazuje to pole.
        actor.logbookMyName(result[0]).then((n: unknown) => {
          const arr = n as [] | [string];
          if (arr.length && arr[0].trim()) setInstructorName(arr[0]);
        }).catch(() => {});
      }
    } catch (e: any) {
      setLoginError(String(e?.message || e).includes("Too many failed attempts")
        ? t.loginErrorLockout
        : t.loginErrorGeneric);
    }
    setLoggingIn(false);
  };

  // --- Wpis do dziennika ---
  const [entry, setEntry] = useState(emptyEntry);

  useEffect(() => {
    if (instructorName) setEntry((prev) => ({ ...prev, instruktorName: instructorName }));
  }, [instructorName]);

  // --- Urządzenia, podpowiedzi nazwisk, bazowy licznik ---
  const [deviceOptions, setDeviceOptions] = useState<{ id: string; label: string }[]>([]);
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [counterBaseline, setCounterBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    (async () => {
      const actor = await createPublicActor();
      const [devs, sugg] = await Promise.all([
        actor.listDevicesForLogbook(sessionToken) as Promise<[bigint, string][]>,
        actor.listLogbookNameSuggestions(sessionToken) as Promise<string[]>,
      ]);
      setDeviceOptions(devs.map(([id, label]) => ({ id: String(id), label })));
      setNameSuggestions(Array.from(new Set(sugg)));
    })();
  }, [sessionToken]);

  const onDeviceChange = async (idStr: string) => {
    setEntry((prev) => ({ ...prev, deviceId: idStr, licznikPoSesji: "" }));
    setCounterBaseline(null);
    if (!idStr || !sessionToken) return;
    const actor = await createPublicActor();
    const result = (await actor.getLastLogbookCounterForDevice(sessionToken, BigInt(idStr))) as [] | [string];
    setCounterBaseline(result.length ? result[0] : null);
  };

  useEffect(() => {
    if (counterBaseline === null) return; // brak wcześniejszych wpisów dla urządzenia — licznik wpisujemy ręcznie
    const baseMin = parseCounter(counterBaseline);
    if (baseMin === null) return;
    const durMin = sessionDurationMinutes(entry.godzRozpoczecia, entry.godzZakonczenia);
    // Pokaż od razu bazowy licznik urządzenia zaraz po jego wyborze (zanim
    // podane są obie godziny) - potem, gdy obie godziny są uzupełnione,
    // dolicz czas sesji do tej bazy.
    setEntry((prev) => ({ ...prev, licznikPoSesji: formatCounter(baseMin + (durMin ?? 0)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterBaseline, entry.godzRozpoczecia, entry.godzZakonczenia]);

  const loadHistory = async () => {
    if (!sessionToken) return;
    setHistoryLoading(true);
    const actor = await createPublicActor();
    const rows = (await actor.listMyLogbookEntries(sessionToken)) as [any, string, boolean, [] | [bigint]][];
    setMyHistory(rows.map(([entry, device, editable, linkedTicket]) => ({
      entry,
      device,
      editable,
      linkedTicket: linkedTicket.length ? Number(linkedTicket[0]) : null,
    })));
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (view === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sessionToken]);

  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const historyDevices = Array.from(new Set(myHistory.map((h) => h.device))).sort();
  useEffect(() => {
    setSelectedDevices(new Set(historyDevices));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myHistory.length]);
  const toggleDevice = (dev: string) => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(dev)) next.delete(dev); else next.add(dev);
      return next;
    });
  };

  const filteredHistory = myHistory.filter(({ entry: e, device }) => {
    if (historyFrom && e.dataText < historyFrom) return false;
    if (historyTo && e.dataText > historyTo) return false;
    if (!selectedDevices.has(device)) return false;
    return true;
  }).sort((a, b) => (a.entry.dataText < b.entry.dataText ? 1 : -1));

  // --- Edycja globalnie ostatniego wpisu / zgłoszenie korekty ticketem ---
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<any>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [correctionOpenId, setCorrectionOpenId] = useState<number | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionSending, setCorrectionSending] = useState(false);
  const [correctionSentId, setCorrectionSentId] = useState<number | null>(null);

  const startEdit = (e: any) => {
    setEditingId(Number(e.id));
    setEditDraft({
      dataText: e.dataText,
      szkoleni: e.szkoleni,
      rodzajAktywnosci: Object.keys(e.rodzajAktywnosci || {})[0] || "szkolenie",
      godzRozpoczecia: e.godzRozpoczecia,
      godzZakonczenia: e.godzZakonczenia,
      licznikPoSesji: e.licznikPoSesji,
      brakUsterek: e.brakUsterek,
      opisUsterki: e.opisUsterki,
    });
    setEditError("");
  };

  const saveEdit = async () => {
    if (editingId === null || !sessionToken || !editDraft) return;
    setEditSaving(true);
    setEditError("");
    try {
      const actor = await createPublicActor();
      await actor.updateMyLogbookEntry(
        sessionToken,
        BigInt(editingId),
        editDraft.dataText,
        editDraft.szkoleni,
        { [editDraft.rodzajAktywnosci]: null },
        editDraft.godzRozpoczecia,
        editDraft.godzZakonczenia,
        editDraft.licznikPoSesji,
        editDraft.brakUsterek,
        editDraft.opisUsterki,
      );
      setEditingId(null);
      setEditDraft(null);
      loadHistory();
    } catch (e: any) {
      setEditError(String(e?.message || e).includes("nie jest już edytowalny")
        ? t.editNotAllowed
        : t.editSaveFailed);
    }
    setEditSaving(false);
  };

  const sendCorrection = async (entryId: number) => {
    if (!sessionToken || !correctionText.trim()) return;
    setCorrectionSending(true);
    try {
      const actor = await createPublicActor();
      await actor.submitLogbookCorrectionTicket(sessionToken, BigInt(entryId), correctionText.trim(), "");
      setCorrectionOpenId(null);
      setCorrectionText("");
      setCorrectionSentId(entryId);
      loadHistory();
    } catch {
      // błąd zostaje pokazany przez brak setCorrectionSentId — pole formularza zostaje otwarte do ponowienia
    }
    setCorrectionSending(false);
  };

  const exportMyHistory = () => {
    const rows = filteredHistory.map(({ entry: e, device }) => ({
      [t.colData]: e.dataText,
      [t.colDevice]: device,
      [t.colTrained]: e.szkoleni,
      [t.fieldType]: Object.keys(e.rodzajAktywnosci || {})[0] || "",
      [t.tblStart]: e.godzRozpoczecia,
      [t.tblEnd]: e.godzZakonczenia,
      [t.tblSessionTime]: czasSesji(e.godzRozpoczecia, e.godzZakonczenia),
      [t.colCounter]: e.licznikPoSesji,
      [t.colFaults]: e.brakUsterek ? t.faultsNone : e.opisUsterki,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), lang === "pl" ? "Moje wpisy" : "My entries");
    const range = (historyFrom || historyTo) ? `_${historyFrom || "poczatek"}_${historyTo || "koniec"}` : "";
    XLSX.writeFile(wb, `${lang === "pl" ? "moj-dziennik" : "my-logbook"}${range}.xlsx`);
  };


  // --- Podpis i wysyłka ---
  const [sigDirty, setSigDirty] = useState(false);
  const [sigVersion, setSigVersion] = useState(0); // wymusza remount canvasu przy czyszczeniu
  const sigRef = useRef<HTMLCanvasElement>(null);
  const [submitHoneypot, setSubmitHoneypot] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const clearSignature = () => {
    setSigDirty(false);
    setSigVersion((v) => v + 1);
  };

  const submitEntry = async () => {
    if (!entry.deviceId) {
      setSubmitError(t.errSelectDevice);
      return;
    }
    if (!entry.instruktorName.trim()) {
      setSubmitError(t.errName);
      return;
    }
    if (!entry.godzRozpoczecia || !entry.godzZakonczenia) {
      setSubmitError(t.errTimes);
      return;
    }
    if (!entry.licznikPoSesji.trim()) {
      setSubmitError(t.errCounter);
      return;
    }
    if (!entry.brakUsterek && !entry.opisUsterki.trim()) {
      setSubmitError(t.errFaultDesc);
      return;
    }
    if (!sigDirty || !sigRef.current) {
      setSubmitError(t.errSignature);
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const podpisDataUrl = sigRef.current.toDataURL("image/png");
      const actor = await createPublicActor();
      const rodzaj = { [entry.rodzajAktywnosci]: null };
      const ok = await actor.submitLogbookEntry(
        sessionToken,
        BigInt(entry.deviceId),
        entry.dataText,
        entry.instruktorName.trim(),
        entry.szkoleni.trim(),
        rodzaj,
        entry.godzRozpoczecia,
        entry.godzZakonczenia,
        entry.licznikPoSesji.trim(),
        entry.brakUsterek,
        entry.brakUsterek ? "" : entry.opisUsterki.trim(),
        podpisDataUrl,
        submitHoneypot,
      );
      if (!ok) {
        setSubmitError(t.errSaveFailed);
      } else {
        setEntry({ ...emptyEntry, dataText: entry.dataText, deviceId: entry.deviceId, instruktorName: instructorName || entry.instruktorName });
        setCounterBaseline(entry.licznikPoSesji.trim());
        clearSignature();
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("Session expired") || msg.includes("Invalid session") || msg.includes("inactive")) {
        setSessionToken(null);
        setSubmitError(t.errSessionExpired);
      } else if (msg.includes("Signature required")) {
        setSubmitError(t.errSignature);
      } else {
        setSubmitError(t.errSaveRetry);
      }
    }
    setSubmitting(false);
  };

  const logout = () => {
    setSessionToken(null);
    setInstructorName("");
    setEntry(emptyEntry);
    setCounterBaseline(null);
    setDeviceOptions([]);
    setView("form");
    clearSignature();
  };

  const ThemeToggle = () => (
    <button onClick={toggleTheme} className="px-2 py-0.5 text-xs border border-[var(--border-color)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );

  const LangToggle = () => (
    <div className="flex border border-[var(--border-color)] rounded overflow-hidden text-xs">
      <button onClick={() => setLang("pl")} className={"px-2 py-0.5 " + (lang === "pl" ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)]")}>PL</button>
      <button onClick={() => setLang("en")} className={"px-2 py-0.5 " + (lang === "en" ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)]")}>EN</button>
    </div>
  );

  const cellInput = "w-full border-0 outline-none px-2 py-1.5 text-sm bg-transparent text-[#111]";
  const th = "border border-black/70 bg-gray-100 px-2 py-1 text-[10px] font-semibold text-black align-bottom";
  const td = "border border-black/70 p-0";

  // --- Ekran logowania ---
  if (!sessionToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cover bg-center p-6" style={{ backgroundImage: "url(/login-background.png)" }}>
        <div className="max-w-sm w-full bg-[var(--bg-card)]/95 rounded-lg p-6 shadow-lg space-y-3">
          <div className="flex justify-end gap-2"><LangToggle /><ThemeToggle /></div>
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-9" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t.loginTitle}</h1>
          <p className="text-xs text-[var(--text-muted)]">{t.loginSubtitle}</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@bartoliniair.com" type="email" className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={rememberEmail} onChange={(e) => setRememberEmail(e.target.checked)} />
            Zapamiętaj e-mail
          </label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={t.pinPlaceholder}
            inputMode="numeric"
            className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm tracking-widest text-center font-mono"
          />
          <input value={loginHoneypot} onChange={(e) => setLoginHoneypot(e.target.value)} className="absolute opacity-0 pointer-events-none -z-10" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          {loginError && <p className="text-red-600 text-sm">{loginError}</p>}
          <button onClick={login} disabled={loggingIn} className="w-full px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded font-medium disabled:opacity-50">
            {loggingIn ? t.loggingIn : t.loginBtn}
          </button>
          {!forgotMode && (
            <button onClick={() => { setForgotMode(true); setForgotStatus(""); }} className="w-full text-xs text-[var(--accent)] hover:underline">
              Nie pamiętam PIN-u
            </button>
          )}
          {forgotMode && (
            <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
              <p className="text-xs text-[var(--text-muted)]">Podaj swój zarejestrowany adres e-mail powyżej i kliknij poniżej — wyślemy nowy PIN.</p>
              <button onClick={requestPinReset} disabled={forgotLoading} className="w-full px-4 py-2 border border-[var(--accent)] text-[var(--accent)] rounded font-medium disabled:opacity-50">
                {forgotLoading ? "Wysyłanie..." : "Wyślij nowy PIN na maila"}
              </button>
              {forgotStatus && <p className="text-xs text-[var(--text-secondary)] text-center">{forgotStatus}</p>}
              <button onClick={() => setForgotMode(false)} className="w-full text-xs text-[var(--text-muted)] hover:underline">Wróć do logowania</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Formularz wpisu — siatka jak w papierowym dzienniku ---
  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4">
      <div className="max-w-5xl w-full bg-[var(--bg-card)] rounded-lg shadow-lg p-3 sm:p-6 space-y-3">
        <div className="flex justify-between items-center">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">{instructorEmail}</span>
            <LangToggle />
            <ThemeToggle />
            <button onClick={logout} className="text-xs text-[var(--accent)] hover:underline">{t.logout}</button>
          </div>
        </div>
        <h1 className="text-center text-base font-bold text-[var(--text-primary)] tracking-wide">
          {t.headerTitle}
        </h1>

        <div className="flex gap-2 border-b border-[var(--border-color)]">
          <button
            onClick={() => setView("form")}
            className={"px-3 py-1.5 text-sm " + (view === "form" ? "border-b-2 border-[var(--accent)] text-[var(--accent)] font-medium" : "text-[var(--text-muted)]")}
          >
            {t.tabNew}
          </button>
          <button
            onClick={() => setView("history")}
            className={"px-3 py-1.5 text-sm " + (view === "history" ? "border-b-2 border-[var(--accent)] text-[var(--accent)] font-medium" : "text-[var(--text-muted)]")}
          >
            {t.tabHistory}
          </button>
        </div>

        {view === "history" && (
          <div className="space-y-3">
            {historyDevices.length > 1 && (
              <div className="rounded-md border border-[var(--border-color)] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">{t.devicesFilterLabel}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedDevices(new Set(historyDevices))} className="text-[11px] text-[var(--accent)] hover:underline">{t.selectAllDevices}</button>
                    <button onClick={() => setSelectedDevices(new Set())} className="text-[11px] text-[var(--accent)] hover:underline">{t.clearAllDevices}</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {historyDevices.map((dev) => {
                    const checked = selectedDevices.has(dev);
                    return (
                      <label key={dev} className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
                        <input type="checkbox" checked={checked} onChange={() => toggleDevice(dev)} />
                        {dev}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <label className="flex flex-col text-xs text-[var(--text-muted)]">
                {t.histFrom}
                <input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]" />
              </label>
              <label className="flex flex-col text-xs text-[var(--text-muted)]">
                {t.histTo}
                <input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} className="border border-[var(--border-color)] rounded px-2 py-1.5 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]" />
              </label>
              {(historyFrom || historyTo) && (
                <button onClick={() => { setHistoryFrom(""); setHistoryTo(""); }} className="text-xs text-[var(--accent)] hover:underline mb-1.5">
                  {t.clearFilters}
                </button>
              )}
              <button onClick={exportMyHistory} className="ml-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium">
                {t.exportExcel} ({filteredHistory.length})
              </button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-6">{t.loadingHist}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                      <th className="py-2 pr-3">{t.colData}</th>
                      <th className="py-2 pr-3">{t.colDevice}</th>
                      <th className="py-2 pr-3">{t.colTrained}</th>
                      <th className="py-2 pr-3">{t.colHours}</th>
                      <th className="py-2 pr-3">{t.colDuration}</th>
                      <th className="py-2 pr-3">{t.colCounter}</th>
                      <th className="py-2 pr-3">{t.colFaults}</th>
                      <th className="py-2 pr-3 w-40">{t.colActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(({ entry: e, device, editable, linkedTicket }) => {
                      const id = Number(e.id);
                      const isEditingRow = editingId === id;
                      return (
                      <Fragment key={String(e.id)}>
                      <tr className="border-b border-[var(--border-color)] text-[var(--text-primary)]">
                        <td className="py-2 pr-3 whitespace-nowrap">{e.dataText}</td>
                        <td className="py-2 pr-3">{device}</td>
                        <td className="py-2 pr-3">{e.szkoleni || "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{e.godzRozpoczecia}–{e.godzZakonczenia}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{czasSesji(e.godzRozpoczecia, e.godzZakonczenia)}</td>
                        <td className="py-2 pr-3">{e.licznikPoSesji || "—"}</td>
                        <td className="py-2 pr-3">
                          {e.brakUsterek ? <span className="text-green-600">{t.faultsNone}</span> : <span className="text-amber-600">⚠ {e.opisUsterki}</span>}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {editable ? (
                            <button onClick={() => startEdit(e)} className="text-xs px-2 py-1 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white">
                              {t.editBtn}
                            </button>
                          ) : linkedTicket !== null || correctionSentId === id ? (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400">{t.reportedTicket}{linkedTicket ?? "?"})</span>
                          ) : (
                            <button onClick={() => { setCorrectionOpenId(id); setCorrectionText(""); }} className="text-xs px-2 py-1 rounded border border-amber-500 text-amber-600 dark:text-amber-400">
                              {t.reportCorrectionBtn}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditingRow && editDraft && (
                        <tr className="border-b border-[var(--border-color)] bg-[var(--accent-hover)]/5">
                          <td colSpan={8} className="p-3">
                            <div className="rounded-md border border-[var(--accent-hover)]/40 bg-[var(--bg-card)] p-3 space-y-2">
                              <p className="text-xs font-semibold text-[var(--accent-hover)] dark:text-[var(--accent-text)]">{t.editPanelTitle}</p>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <label className="text-xs text-[var(--text-muted)]">{t.fieldDate}
                                  <input type="date" value={editDraft.dataText} onChange={(ev) => setEditDraft({ ...editDraft, dataText: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)]" />
                                </label>
                                <label className="text-xs text-[var(--text-muted)]">{t.fieldTrained}
                                  <input value={editDraft.szkoleni} onChange={(ev) => setEditDraft({ ...editDraft, szkoleni: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)]" />
                                </label>
                                <label className="text-xs text-[var(--text-muted)]">{t.fieldStart}
                                  <input value={editDraft.godzRozpoczecia} onChange={(ev) => setEditDraft({ ...editDraft, godzRozpoczecia: ev.target.value })} placeholder="HH:MM" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)]" />
                                </label>
                                <label className="text-xs text-[var(--text-muted)]">{t.fieldEnd}
                                  <input value={editDraft.godzZakonczenia} onChange={(ev) => setEditDraft({ ...editDraft, godzZakonczenia: ev.target.value })} placeholder="HH:MM" className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)]" />
                                </label>
                                <label className="text-xs text-[var(--text-muted)]">{t.fieldCounter}
                                  <input value={editDraft.licznikPoSesji} onChange={(ev) => setEditDraft({ ...editDraft, licznikPoSesji: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)]" />
                                </label>
                                <label className="text-xs text-[var(--text-muted)] col-span-2 sm:col-span-1">{t.fieldType}
                                  <select value={editDraft.rodzajAktywnosci} onChange={(ev) => setEditDraft({ ...editDraft, rodzajAktywnosci: ev.target.value })} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)]">
                                    <option value="szkolenie">{t.typeTraining}</option>
                                    <option value="komercyjne">{t.typeCommercial}</option>
                                    <option value="techniczne">{t.typeTechnical}</option>
                                  </select>
                                </label>
                              </div>
                              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                <input type="checkbox" checked={editDraft.brakUsterek} onChange={(ev) => setEditDraft({ ...editDraft, brakUsterek: ev.target.checked, opisUsterki: ev.target.checked ? "" : editDraft.opisUsterki })} />
                                {t.noFaults}
                              </label>
                              {!editDraft.brakUsterek && (
                                <textarea value={editDraft.opisUsterki} onChange={(ev) => setEditDraft({ ...editDraft, opisUsterki: ev.target.value })} rows={2} className="w-full border border-[var(--border-color)] rounded px-2 py-1 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]" />
                              )}
                              {editError && <p className="text-xs text-red-500">{editError}</p>}
                              <div className="flex justify-end gap-2">
                                <button onClick={() => { setEditingId(null); setEditDraft(null); }} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)]">{t.cancel}</button>
                                <button onClick={saveEdit} disabled={editSaving} className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white disabled:opacity-50">
                                  {editSaving ? t.saving : t.saveCorrection}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {correctionOpenId === id && (
                        <tr className="border-b border-[var(--border-color)] bg-amber-500/5">
                          <td colSpan={8} className="p-3">
                            <div className="rounded-md border border-amber-500/40 bg-[var(--bg-card)] p-3 space-y-2">
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{t.correctionPanelTitle}</p>
                              <p className="text-xs text-[var(--text-secondary)]">{t.correctionPanelBody}</p>
                              <textarea value={correctionText} onChange={(ev) => setCorrectionText(ev.target.value)} rows={3} placeholder={t.correctionPlaceholder} className="w-full border border-[var(--border-color)] rounded px-2 py-1.5 text-sm bg-[var(--bg-page)] text-[var(--text-primary)]" />
                              <div className="flex justify-end gap-2">
                                <button onClick={() => setCorrectionOpenId(null)} className="text-xs px-3 py-1.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)]">{t.cancel}</button>
                                <button onClick={() => sendCorrection(id)} disabled={correctionSending || !correctionText.trim()} className="text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
                                  {correctionSending ? t.sending : t.sendCorrectionBtn}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                    {filteredHistory.length === 0 && (
                      <tr><td colSpan={8} className="py-6 text-center text-[var(--text-muted)]">{t.noEntries}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === "form" && (
        <>
        <div className="border border-[var(--accent-hover)]/30 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-[var(--accent-hover)]/10 hover:bg-[var(--accent-hover)]/20 text-left"
          >
            <span className="text-sm font-medium text-[var(--accent-hover)] dark:text-[var(--accent-text)]">{t.helpToggle}</span>
            <span className="text-[var(--accent)] text-xs shrink-0">{showHelp ? t.collapse : t.expand}</span>
          </button>
          {showHelp && (
            <div className="p-3 space-y-2 bg-[var(--bg-card)]">
              <div className="rounded-md border border-[var(--accent-hover)]/30 bg-[var(--accent-hover)]/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-[var(--accent-hover)] dark:text-[var(--accent-text)] mb-1">{t.help1Title}</p>
                <p>{t.help1Body}</p>
              </div>
              <div className="rounded-md border border-[var(--accent-hover)]/30 bg-[var(--accent-hover)]/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-[var(--accent-hover)] dark:text-[var(--accent-text)] mb-1">{t.help2Title}</p>
                <p>{t.help2Body}</p>
              </div>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">{t.help3Title}</p>
                <p>{t.help3Body}</p>
              </div>
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">{t.help4Title}</p>
                <p>{t.help4Body}</p>
              </div>
              <div className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 p-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="font-semibold text-fuchsia-700 dark:text-fuchsia-400 mb-1">{t.help5Title}</p>
                <p>{t.help5Body}</p>
              </div>
            </div>
          )}
        </div>

        <label className="block text-xs text-[var(--text-muted)]">
          {t.deviceLabel}
          <select
            value={entry.deviceId}
            onChange={(e) => onDeviceChange(e.target.value)}
            className={
              "w-full border rounded px-2 py-2 text-sm mt-0.5 bg-[var(--bg-page)] text-[var(--text-primary)] " +
              (entry.deviceId ? "border-[var(--border-color)]" : "border-red-400 bg-red-500/10")
            }
          >
            <option value="">{t.deviceSelectPlaceholder}</option>
            {deviceOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>

        {!entry.deviceId && (
          <div className="rounded-md border-2 border-red-400 bg-red-500/10 p-3 flex items-center gap-2">
            <span className="text-xl shrink-0">⚠</span>
            <p className="text-sm text-red-700 dark:text-red-400 font-medium">
              {t.deviceWarning}
            </p>
          </div>
        )}
        {entry.deviceId && (
          <div className="rounded-md border-2 border-emerald-500 bg-emerald-500/10 p-3 flex items-center gap-2">
            <span className="text-xl shrink-0">✔</span>
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              {t.deviceConfirmPrefix} <span className="font-bold text-base">{deviceOptions.find((d) => d.id === entry.deviceId)?.label}</span>
              {t.deviceConfirmSuffix}
            </p>
          </div>
        )}

        <datalist id="logbook-name-suggestions">
          {nameSuggestions.map((n) => <option value={n} key={n} />)}
        </datalist>

        {savedFlash && (
          <div className="bg-green-50 border border-green-300 text-green-800 text-sm rounded px-3 py-2 text-center">
            {t.savedFlash}
          </div>
        )}

        <div className="bg-white rounded-sm p-2 sm:p-3 space-y-3">
        <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full min-w-[720px] sm:min-w-0 border-collapse text-black">
          <thead>
            <tr>
              <th className={th}>{t.colData}</th>
              <th className={th + " w-36"}>{t.tblInstructor}</th>
              <th className={th + " w-36"}>{t.tblTrainedIfAny}</th>
              <th className={th}>{t.tblActivityType}</th>
              <th className={th}>{t.tblStart}</th>
              <th className={th}>{t.tblEnd}</th>
              <th className={th}>{t.tblSessionTime}</th>
              <th className={th}>{t.tblCounterAfter}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>
                <input type="date" value={entry.dataText} onChange={(e) => setEntry({ ...entry, dataText: e.target.value })} className={cellInput} />
              </td>
              <td className={td}>
                <input
                  value={entry.instruktorName}
                  readOnly
                  disabled
                  title={lang === "pl" ? "Wpis zawsze podpisujesz swoim własnym kontem — nie da się wpisać innej osoby." : "Entries are always logged under your own account — you can't enter someone else's name here."}
                  className={cellInput + " bg-gray-100 cursor-not-allowed"}
                />
              </td>
              <td className={td}>
                <input
                  value={entry.szkoleni}
                  onChange={(e) => setEntry({ ...entry, szkoleni: e.target.value })}
                  list="logbook-name-suggestions"
                  className={cellInput}
                />
              </td>
              <td className={td + " p-1.5"}>
                <div className="flex flex-col gap-0.5 text-[11px]">
                  {(["szkolenie", "komercyjne", "techniczne"] as ActivityType[]).map((r) => (
                    <label key={r} className="flex items-center gap-1">
                      <input type="radio" name="rodzaj" checked={entry.rodzajAktywnosci === r} onChange={() => setEntry({ ...entry, rodzajAktywnosci: r })} />
                      {r === "szkolenie" ? t.typeTraining : r === "komercyjne" ? t.typeCommercial : t.typeTechnical}
                    </label>
                  ))}
                </div>
              </td>
              <td className={td}>
                <TimeSelect24 value={entry.godzRozpoczecia} onChange={(v) => setEntry({ ...entry, godzRozpoczecia: v })} />
              </td>
              <td className={td}>
                <TimeSelect24 value={entry.godzZakonczenia} onChange={(v) => setEntry({ ...entry, godzZakonczenia: v })} />
              </td>
              <td className={td + " px-2 py-1.5 text-sm text-center text-gray-700"}>{czasSesji(entry.godzRozpoczecia, entry.godzZakonczenia)}</td>
              <td className={td}>
                <input
                  value={entry.licznikPoSesji}
                  onChange={(e) => setEntry({ ...entry, licznikPoSesji: e.target.value })}
                  placeholder={entry.deviceId ? "np. 2455:50" : t.counterPlaceholderNoDevice}
                  className={cellInput}
                />
                <p className="text-[10px] text-[var(--accent-hover)] mt-0.5">{t.counterHint}</p>
              </td>
            </tr>
          </tbody>
        </table>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-black/70 rounded-sm p-2 space-y-2">
            <p className="text-[11px] font-semibold text-center border-b border-black/30 pb-1">{t.faultsBoxTitle}</p>
            <label className="flex items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={entry.brakUsterek}
                onChange={(e) => setEntry({ ...entry, brakUsterek: e.target.checked, opisUsterki: e.target.checked ? "" : entry.opisUsterki })}
              />
              {t.noFaults}
            </label>
            {!entry.brakUsterek && (
              <div>
                <p className="text-[11px] text-gray-600">{t.faultDescLabel}</p>
                <textarea
                  value={entry.opisUsterki}
                  onChange={(e) => setEntry({ ...entry, opisUsterki: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-black"
                />
              </div>
            )}
            <div>
              <p className="text-[11px] text-gray-600 mb-1">{t.signatureLabel}</p>
              <SignaturePad key={sigVersion} onDirtyChange={setSigDirty} padRef={sigRef} />
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-gray-400">{t.signatureCaption}</span>
                <button type="button" onClick={clearSignature} className="text-[11px] text-[var(--accent)] hover:underline">{t.clearSignatureBtn}</button>
              </div>
            </div>
          </div>

          <div className="border border-black/70 rounded-sm p-2 opacity-60">
            <p className="text-[11px] font-semibold text-center border-b border-black/30 pb-1">{t.techBoxTitle}</p>
            <p className="text-[11px] text-gray-500 text-center mt-3">{t.techBoxBody}</p>
          </div>
        </div>
        </div>

        <input value={submitHoneypot} onChange={(e) => setSubmitHoneypot(e.target.value)} className="absolute opacity-0 pointer-events-none -z-10" tabIndex={-1} autoComplete="off" aria-hidden="true" />

        {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
        <button onClick={submitEntry} disabled={submitting} className="w-full px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded font-semibold disabled:opacity-50">
          {submitting ? t.submitting : t.submitBtn}
        </button>
        </>
        )}
      </div>
    </div>
  );
}
