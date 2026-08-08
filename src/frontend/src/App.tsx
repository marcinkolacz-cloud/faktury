import { useEffect, useState } from "react";
import { AuthProvider, useAuthContext } from "./providers/AuthProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { useBackendActor } from "./lib/useBackend";
import { Dashboard } from "./components/Dashboard";
import { HomeScreen } from "./components/HomeScreen";
import { WarehouseModule } from "./components/WarehouseModule";
import { ProjectsModule } from "./components/ProjectsModule";
import { CalendarModule } from "./components/CalendarModule";
import { UploadProvider } from "./providers/UploadContext";
import { PublicTicketForm } from "./components/PublicTicketForm";
import { TicketStatusPage } from "./components/TicketStatusPage";
import { TicketsModule } from "./components/TicketsModule";
import { DriveModule } from "./components/DriveModule";
import { OrdersModule } from "./components/OrdersModule";
import { ContractsModule } from "./components/ContractsModule";
import { EmailSubscribersModule } from "./components/EmailSubscribersModule";
import { KsefTeamView } from "./components/KsefTeamView";
import { AdminPanel } from "./components/AdminPanel";
import { TopBar } from "./components/TopBar";
import { useBackendActor as useActor2 } from "./lib/useBackend";

const SECRET_PASSWORD = "kolacz1";

function AccessGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, login, loginWithGoogle, logout } = useAuthContext();
  const actor = useBackendActor();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [, setTypedBuffer] = useState("");
  const [, setTapCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState(0);

  const handleSecretTap = () => {
    const now = Date.now();
    setTapCount((prev) => {
      const withinWindow = now - lastTapTime < 3000;
      const next = withinWindow ? prev + 1 : 1;
      if (next >= 7) { setUnlocked(true); return 0; }
      return next;
    });
    setLastTapTime(now);
  };

  useEffect(() => {
    if (!actor || !isAuthenticated) return;
    let cancelled = false;
    actor.isCallerGranted().then((result: boolean) => {
      if (!cancelled) setGranted(result);
    });
    return () => { cancelled = true; };
  }, [actor, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated || unlocked) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key.length === 1) {
        setTypedBuffer((prev) => {
          const next = (prev + e.key).slice(-SECRET_PASSWORD.length);
          if (next === SECRET_PASSWORD) { setUnlocked(true); }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isAuthenticated, unlocked]);

  if (!isAuthenticated) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-cover bg-center"
        style={{ backgroundImage: "url(/login-background.png)" }}
      >
        <div className="space-y-3 w-80 bg-white/95 backdrop-blur border border-gray-200 rounded-lg p-6 shadow-lg">
          <h1 onClick={handleSecretTap} className="text-lg font-semibold text-gray-900 select-none cursor-pointer">Zaloguj się</h1>
          {unlocked && (
            <button onClick={login} className="w-full px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md font-medium transition-colors">
              Zaloguj się przez Internet Identity
            </button>
          )}
          <button onClick={loginWithGoogle} className="w-full flex items-center justify-center gap-3 px-5 py-2.5 border border-gray-300 bg-white text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.766 12.2764c0-.9175-.0824-1.7986-.2358-2.6432H12.24v5.0038h6.4738c-.2789 1.5046-1.1284 2.7789-2.4048 3.6288v3.0165h3.8894c2.2762-2.0958 3.5892-5.1832 3.5892-8.9059z"/>
              <path fill="#34A853" d="M12.24 24c3.24 0 5.9556-1.0743 7.9407-2.9074l-3.8894-3.0165c-1.0794.7233-2.4611 1.1516-4.0513 1.1516-3.1109 0-5.7461-2.1002-6.6852-4.9214H1.5223v3.0917C3.4995 21.3016 7.5245 24 12.24 24z"/>
              <path fill="#FBBC05" d="M5.5548 14.3062A7.2032 7.2032 0 0 1 5.1673 12c0-.8016.1382-1.5827.3875-2.3062V6.6021H1.5223A11.9973 11.9973 0 0 0 0 12c0 1.9403.4655 3.7735 1.2823 5.3979l4.2725-3.0917z"/>
              <path fill="#EA4335" d="M12.24 4.7729c1.7623 0 3.3477.6058 4.5942 1.7942l3.4463-3.4463C18.1902 1.1897 15.4746 0 12.24 0 7.5245 0 3.4995 2.6984 1.5223 6.6021l4.2725 3.0917C6.7239 6.8731 9.3591 4.7729 12.24 4.7729z"/>
            </svg>
            Zaloguj się przez Google
          </button>
        </div>
      </div>
    );
  }

  if (granted === null) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">Ładowanie...</div>;
  }

  if (!granted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="space-y-3 w-80 bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <p className="text-gray-700 text-sm">Wprowadź kod zaproszenia</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="bg-white border border-gray-300 px-3 py-2 w-full rounded text-gray-900"
            placeholder="np. ABCD1234"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            onClick={async () => {
              const ok = await actor.checkAccess(code);
              if (ok) { setGranted(true); } else { setError("Nieprawidłowy kod"); }
            }}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded w-full font-medium"
          >
            Aktywuj dostęp
          </button>
          <button
            onClick={logout}
            className="px-4 py-2 border border-gray-300 text-gray-500 rounded w-full text-sm hover:bg-gray-50"
          >
            Wyloguj / Przełącz konto
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function ModuleRouter() {
  const [module, setModule] = useState<string | null>(null);
  const actor = useActor2();

  if (module === null) {
    return <HomeScreen onSelectModule={setModule} />;
  }
  if (module === "admin") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
        <div className="max-w-[1600px] mx-auto p-6 space-y-6">
          <TopBar currentModule={module} onNavigate={setModule} onHome={() => setModule(null)} actor={actor} />
          <AdminPanel actor={actor} />
        </div>
      </div>
    );
  }
  if (module === "invoices") {
    return <Dashboard onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "warehouse") {
    return <WarehouseModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "projects") {
    return <ProjectsModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "calendar") {
    return <CalendarModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "tickets") {
    return <TicketsModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "drive") {
    return <DriveModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "orders") {
    return <OrdersModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "contracts") {
    return <ContractsModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  if (module === "ksef") {
    return <KsefTeamView onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} actor={actor} />;
  }
  if (module === "emailSubscribers") {
    return <EmailSubscribersModule onHome={() => setModule(null)} onNavigate={setModule} currentModule={module} />;
  }
  return (
    <div className="min-h-screen bg-[#0a0e14] flex flex-col items-center justify-center gap-4">
      <p className="text-gray-400">Ten moduł jest jeszcze w budowie.</p>
      <button onClick={() => setModule(null)} className="px-4 py-2 border border-gray-700 rounded text-gray-300 hover:bg-gray-800">
        Wróć do menu
      </button>
    </div>
  );
}

export default function App() {
  const isSupportSubdomain = window.location.hostname.startsWith("support.");
  if (window.location.pathname === "/zgloszenie" || (isSupportSubdomain && window.location.pathname === "/")) {
    return (
      <ThemeProvider>
        <PublicTicketForm />
      </ThemeProvider>
    );
  }
  if (window.location.pathname === "/status") {
    return (
      <ThemeProvider>
        <TicketStatusPage />
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <AuthProvider>
        <UploadProvider>
          <AccessGate>
            <ModuleRouter />
          </AccessGate>
        </UploadProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
