import { AuthClient } from "@icp-sdk/auth/client";
import type { Identity } from "@icp-sdk/core/agent";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface AuthContextValue {
  identity: Identity | undefined;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  const [identity, setIdentity] = useState<Identity | undefined>(undefined);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const client = new AuthClient();
    setAuthClient(client);
    if (client.isAuthenticated()) {
      client.getIdentity().then(setIdentity).finally(() => setIsInitializing(false));
    } else {
      setIsInitializing(false);
    }
  }, []);

  const login = async () => {
    if (!authClient) return;
    const id = await authClient.signIn();
    setIdentity(id);
  };

  const logout = async () => {
    if (!authClient) return;
    await authClient.signOut();
    setIdentity(undefined);
  };

  const isAuthenticated = !!identity && !identity.getPrincipal().isAnonymous();

  return (
    <AuthContext.Provider value={{ identity, isAuthenticated, isInitializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
