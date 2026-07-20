import { useEffect, useState } from "react";
import { AuthProvider, useAuthContext } from "./providers/AuthProvider";
import { useBackendActor } from "./lib/useBackend";
import { Dashboard } from "./components/Dashboard";

function AccessGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, login } = useAuthContext();
  const actor = useBackendActor();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!actor || !isAuthenticated) return;
    actor.isCallerGranted().then(setGranted);
  }, [actor, isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <button onClick={login} className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md font-medium transition-colors">
          Zaloguj się przez Internet Identity
        </button>
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
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <AccessGate>
        <Dashboard />
      </AccessGate>
    </AuthProvider>
  );
}
