import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicUser } from "@shared/auth/store.ts";
import { apiGet, apiSend } from "../lib/api.ts";

interface AuthState {
  user: PublicUser | null;
  /** True until the first /auth/me settles. The UI must not render "Sign in"
   * during it: a signed-in user seeing a sign-in prompt flash on every page
   * load reads as having been logged out. */
  loading: boolean;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** How many anonymous trips the last sign-in attached to the account, so the
   * UI can say so once rather than leaving the list to change silently. */
  claimedTrips: number | null;
  dismissClaimed: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthResponse {
  user: PublicUser;
  claimedTrips: number;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimedTrips, setClaimedTrips] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { user: me } = await apiGet<{ user: PublicUser | null }>("/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        // A failed session check is not a failed page. Treat it as signed out —
        // every route still works anonymously, which is the whole point of the
        // owner token surviving alongside accounts.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const result = await apiSend<AuthResponse>("POST", "/auth/signup", { email, password });
    setUser(result.user);
    setClaimedTrips(result.claimedTrips);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiSend<AuthResponse>("POST", "/auth/login", { email, password });
    setUser(result.user);
    setClaimedTrips(result.claimedTrips);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiSend("POST", "/auth/logout");
    } finally {
      // Signed out locally even if the request failed: the server clears the
      // cookie on that path too, and leaving the UI showing an account the user
      // asked to leave is the worse outcome.
      setUser(null);
      setClaimedTrips(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signup, login, logout, claimedTrips, dismissClaimed: () => setClaimedTrips(null) }),
    [user, loading, signup, login, logout, claimedTrips],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside an AuthProvider");
  return context;
}
