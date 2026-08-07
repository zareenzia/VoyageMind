import { useCallback, useEffect, useState } from "react";
import type { TripSummary } from "@shared/trips/store.ts";
import { apiGet, apiSend } from "../lib/api.ts";
import { useAuth } from "./useAuth.tsx";

export function useMyTrips() {
  const { user, loading: authLoading } = useAuth();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ trips: TripSummary[] }>("/trips");
      setTrips(data.trips);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trips");
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await apiSend("DELETE", `/trips/${id}`);
    setTrips((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const rename = useCallback(async (id: string, title: string | null) => {
    await apiSend("PATCH", `/trips/${id}`, { title });
    // Mirrors the store's normalisation: a blank title clears the name rather
    // than storing an empty label, so the list must not show one either.
    const normalized = title === null || title.trim().length === 0 ? null : title.trim();
    setTrips((prev) => prev.map((t) => (t.id === id ? { ...t, title: normalized } : t)));
  }, []);

  const share = useCallback(async (id: string): Promise<string> => {
    const { shareToken } = await apiSend<{ shareToken: string }>("POST", `/trips/${id}/share`);
    setTrips((prev) => prev.map((t) => (t.id === id ? { ...t, shared: true } : t)));
    return shareToken;
  }, []);

  const unshare = useCallback(async (id: string) => {
    await apiSend("DELETE", `/trips/${id}/share`);
    setTrips((prev) => prev.map((t) => (t.id === id ? { ...t, shared: false } : t)));
  }, []);

  // Re-fetch whenever sign-in state settles or changes: signing in moves this
  // browser's anonymous trips onto the account, and signing out moves the list
  // back to whatever the owner token still holds. Waiting for authLoading
  // avoids one throwaway anonymous fetch on every page load.
  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [refresh, authLoading, user?.id]);

  return { trips, loading, error, refresh, remove, rename, share, unshare };
}
