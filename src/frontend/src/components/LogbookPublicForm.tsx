import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createPublicActor } from "../lib/publicActor";
import { useTheme } from "../providers/ThemeProvider";

type ActivityType = "szkolenie" | "komercyjne" | "techniczne";

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
  const { theme, toggleTheme } = useTheme();

  // --- Logowanie PIN-em ---
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [loginHoneypot, setLoginHoneypot] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [instructorEmail, setInstructorEmail] = useState("");
  const [view, setView] = useState<"form" | "history">("form");
  const [myHistory, setMyHistory] = useState<{ entry: any; device: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");

  const login = async () => {
    if (!email.trim() || pin.trim().length !== 6) {
      setLoginError("Podaj email (@bartoliniair.com) i 6-cyfrowy PIN.");
      return;
    }
    setLoggingIn(true);
    setLoginError("");
    try {
      const actor = await createPublicActor();
      const result = (await actor.loginLogbookInstructor(email.trim(), pin.trim(), loginHoneypot)) as [] | [string];
      if (result.length === 0) {
        setLoginError("Nieprawidłowy email lub PIN.");
      } else {
        setSessionToken(result[0]);
        setInstructorEmail(email.trim().toLowerCase());
        setPin("");
      }
    } catch (e: any) {
      setLoginError(String(e?.message || e).includes("Too many failed attempts")
        ? "Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut."
        : "Błąd logowania. Spróbuj ponownie.");
    }
    setLoggingIn(false);
  };

  // --- Wpis do dziennika ---
  const [entry, setEntry] = useState(emptyEntry);

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
    const durMin = sessionDurationMinutes(entry.godzRozpoczecia, entry.godzZakonczenia);
    if (baseMin === null || durMin === null) return;
    setEntry((prev) => ({ ...prev, licznikPoSesji: formatCounter(baseMin + durMin) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterBaseline, entry.godzRozpoczecia, entry.godzZakonczenia]);

  const loadHistory = async () => {
    if (!sessionToken) return;
    setHistoryLoading(true);
    const actor = await createPublicActor();
    const rows = (await actor.listMyLogbookEntries(sessionToken)) as [any, string][];
    setMyHistory(rows.map(([entry, device]) => ({ entry, device })));
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (view === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sessionToken]);

  const filteredHistory = myHistory.filter(({ entry: e }) => {
    if (historyFrom && e.dataText < historyFrom) return false;
    if (historyTo && e.dataText > historyTo) return false;
    return true;
  }).sort((a, b) => (a.entry.dataText < b.entry.dataText ? 1 : -1));

  const exportMyHistory = () => {
    const rows = filteredHistory.map(({ entry: e, device }) => ({
      Data: e.dataText,
      Urządzenie: device,
      Szkoleni: e.szkoleni,
      Rodzaj: Object.keys(e.rodzajAktywnosci || {})[0] || "",
      "Godz. rozpoczęcia": e.godzRozpoczecia,
      "Godz. zakończenia": e.godzZakonczenia,
      "Czas sesji": czasSesji(e.godzRozpoczecia, e.godzZakonczenia),
      Licznik: e.licznikPoSesji,
      Usterki: e.brakUsterek ? "Brak" : e.opisUsterki,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Moje wpisy");
    const range = (historyFrom || historyTo) ? `_${historyFrom || "poczatek"}_${historyTo || "koniec"}` : "";
    XLSX.writeFile(wb, `moj-dziennik${range}.xlsx`);
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
      setSubmitError("Wybierz urządzenie.");
      return;
    }
    if (!entry.instruktorName.trim()) {
      setSubmitError("Podaj imię i nazwisko instruktora / użytkownika.");
      return;
    }
    if (!entry.godzRozpoczecia || !entry.godzZakonczenia) {
      setSubmitError("Podaj godzinę rozpoczęcia i zakończenia sesji.");
      return;
    }
    if (!entry.licznikPoSesji.trim()) {
      setSubmitError("Podaj licznik po sesji.");
      return;
    }
    if (!entry.brakUsterek && !entry.opisUsterki.trim()) {
      setSubmitError("Opisz usterkę albo zaznacz „Brak usterek”.");
      return;
    }
    if (!sigDirty || !sigRef.current) {
      setSubmitError("Wymagany podpis instruktora.");
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
        setSubmitError("Nie udało się zapisać wpisu.");
      } else {
        setEntry({ ...emptyEntry, dataText: entry.dataText, deviceId: entry.deviceId });
        setCounterBaseline(entry.licznikPoSesji.trim());
        clearSignature();
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("Session expired") || msg.includes("Invalid session") || msg.includes("inactive")) {
        setSessionToken(null);
        setSubmitError("Sesja wygasła — zaloguj się ponownie.");
      } else if (msg.includes("Signature required")) {
        setSubmitError("Wymagany podpis instruktora.");
      } else {
        setSubmitError("Nie udało się zapisać wpisu. Spróbuj ponownie.");
      }
    }
    setSubmitting(false);
  };

  const logout = () => {
    setSessionToken(null);
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

  const cellInput = "w-full border-0 outline-none px-2 py-1.5 text-sm bg-transparent text-[#111]";
  const th = "border border-black/70 bg-gray-100 px-2 py-1 text-[10px] font-semibold text-black align-bottom";
  const td = "border border-black/70 p-0";

  // --- Ekran logowania ---
  if (!sessionToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cover bg-center p-6" style={{ backgroundImage: "url(/login-background.png)" }}>
        <div className="max-w-sm w-full bg-[var(--bg-card)]/95 rounded-lg p-6 shadow-lg space-y-3">
          <div className="flex justify-end"><ThemeToggle /></div>
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-9" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Dziennik użytkowania — logowanie</h1>
          <p className="text-xs text-[var(--text-muted)]">Zaloguj się firmowym adresem e-mail i PIN-em otrzymanym od administratora.</p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@bartoliniair.com" type="email" className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm" />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="PIN (6 cyfr)"
            inputMode="numeric"
            className="w-full border border-[var(--border-color)] rounded px-3 py-2 text-sm tracking-widest text-center font-mono"
          />
          <input value={loginHoneypot} onChange={(e) => setLoginHoneypot(e.target.value)} className="absolute opacity-0 pointer-events-none -z-10" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          {loginError && <p className="text-red-600 text-sm">{loginError}</p>}
          <button onClick={login} disabled={loggingIn} className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50">
            {loggingIn ? "Logowanie..." : "Zaloguj"}
          </button>
        </div>
      </div>
    );
  }

  // --- Formularz wpisu — siatka jak w papierowym dzienniku ---
  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white rounded-lg shadow-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{instructorEmail}</span>
            <ThemeToggle />
            <button onClick={logout} className="text-xs text-cyan-600 hover:underline">Wyloguj</button>
          </div>
        </div>
        <h1 className="text-center text-base font-bold text-black tracking-wide">
          DZIENNIK UŻYTKOWANIA URZĄDZENIA
        </h1>

        <div className="flex gap-2 border-b border-gray-300">
          <button
            onClick={() => setView("form")}
            className={"px-3 py-1.5 text-sm " + (view === "form" ? "border-b-2 border-cyan-600 text-cyan-600 font-medium" : "text-gray-500")}
          >
            Nowy wpis
          </button>
          <button
            onClick={() => setView("history")}
            className={"px-3 py-1.5 text-sm " + (view === "history" ? "border-b-2 border-cyan-600 text-cyan-600 font-medium" : "text-gray-500")}
          >
            Moja historia
          </button>
        </div>

        {view === "history" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <label className="flex flex-col text-xs text-gray-600">
                Od
                <input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col text-xs text-gray-600">
                Do
                <input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              {(historyFrom || historyTo) && (
                <button onClick={() => { setHistoryFrom(""); setHistoryTo(""); }} className="text-xs text-cyan-600 hover:underline mb-1.5">
                  Wyczyść filtry
                </button>
              )}
              <button onClick={exportMyHistory} className="ml-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium">
                📊 Eksportuj do Excel ({filteredHistory.length})
              </button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-gray-500 text-center py-6">Ładowanie...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-300">
                      <th className="py-2 pr-3">Data</th>
                      <th className="py-2 pr-3">Urządzenie</th>
                      <th className="py-2 pr-3">Szkoleni</th>
                      <th className="py-2 pr-3">Godz.</th>
                      <th className="py-2 pr-3">Czas</th>
                      <th className="py-2 pr-3">Licznik</th>
                      <th className="py-2 pr-3">Usterki</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(({ entry: e, device }) => (
                      <tr key={String(e.id)} className="border-b border-gray-200">
                        <td className="py-2 pr-3 whitespace-nowrap">{e.dataText}</td>
                        <td className="py-2 pr-3">{device}</td>
                        <td className="py-2 pr-3">{e.szkoleni || "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{e.godzRozpoczecia}–{e.godzZakonczenia}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{czasSesji(e.godzRozpoczecia, e.godzZakonczenia)}</td>
                        <td className="py-2 pr-3">{e.licznikPoSesji || "—"}</td>
                        <td className="py-2 pr-3">
                          {e.brakUsterek ? <span className="text-green-600">Brak</span> : <span className="text-amber-600">⚠ {e.opisUsterki}</span>}
                        </td>
                      </tr>
                    ))}
                    {filteredHistory.length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-gray-500">Brak wpisów.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === "form" && (
        <>
        <label className="block text-xs text-gray-600">
          Urządzenie
          <select
            value={entry.deviceId}
            onChange={(e) => onDeviceChange(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-2 text-sm mt-0.5"
          >
            <option value="">— wybierz urządzenie —</option>
            {deviceOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>

        <datalist id="logbook-name-suggestions">
          {nameSuggestions.map((n) => <option value={n} key={n} />)}
        </datalist>

        {savedFlash && (
          <div className="bg-green-50 border border-green-300 text-green-800 text-sm rounded px-3 py-2 text-center">
            ✔ Wpis zapisany. Formularz gotowy na kolejny wpis.
          </div>
        )}

        <table className="w-full border-collapse text-black">
          <thead>
            <tr>
              <th className={th}>Data</th>
              <th className={th + " w-36"}>Instruktor / użytkownik</th>
              <th className={th + " w-36"}>Szkoleni (jeżeli dotyczy)</th>
              <th className={th}>Rodzaj aktywności</th>
              <th className={th}>Godz. rozpoczęcia</th>
              <th className={th}>Godz. zakończenia</th>
              <th className={th}>Czas sesji</th>
              <th className={th}>Licznik po sesji</th>
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
                  onChange={(e) => setEntry({ ...entry, instruktorName: e.target.value })}
                  list="logbook-name-suggestions"
                  placeholder="Imię i nazwisko"
                  className={cellInput}
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
                      {r === "szkolenie" ? "Szkolenie" : r === "komercyjne" ? "Komerc." : "Techniczne"}
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
                  placeholder={entry.deviceId ? "np. 2455:50" : "wybierz urządzenie"}
                  className={cellInput}
                />
              </td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-black/70 rounded-sm p-2 space-y-2">
            <p className="text-[11px] font-semibold text-center border-b border-black/30 pb-1">Usterki</p>
            <label className="flex items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={entry.brakUsterek}
                onChange={(e) => setEntry({ ...entry, brakUsterek: e.target.checked, opisUsterki: e.target.checked ? "" : entry.opisUsterki })}
              />
              Brak usterek
            </label>
            {!entry.brakUsterek && (
              <div>
                <p className="text-[11px] text-gray-600">Opis usterki:</p>
                <textarea
                  value={entry.opisUsterki}
                  onChange={(e) => setEntry({ ...entry, opisUsterki: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            )}
            <div>
              <p className="text-[11px] text-gray-600 mb-1">Podpis instruktora:</p>
              <SignaturePad key={sigVersion} onDirtyChange={setSigDirty} padRef={sigRef} />
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-gray-400">podpis</span>
                <button type="button" onClick={clearSignature} className="text-[11px] text-cyan-600 hover:underline">Wyczyść podpis</button>
              </div>
            </div>
          </div>

          <div className="border border-black/70 rounded-sm p-2 opacity-60">
            <p className="text-[11px] font-semibold text-center border-b border-black/30 pb-1">Wpisy techniczne</p>
            <p className="text-[11px] text-gray-500 text-center mt-3">Wypełnia technik osobno.</p>
          </div>
        </div>

        <input value={submitHoneypot} onChange={(e) => setSubmitHoneypot(e.target.value)} className="absolute opacity-0 pointer-events-none -z-10" tabIndex={-1} autoComplete="off" aria-hidden="true" />

        {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
        <button onClick={submitEntry} disabled={submitting} className="w-full px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-semibold disabled:opacity-50">
          {submitting ? "Zapisywanie..." : "✔ Zatwierdź wpis"}
        </button>
        </>
        )}
      </div>
    </div>
  );
}
