import { useCallback, useEffect, useState } from "react";
import type { TripSummary } from "@shared/trips/store.ts";
import { getOwnerToken } from "../lib/ownerToken.ts";

export function useMyTrips() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/trips?owner_token=${encodeURIComponent(getOwnerToken())}`);
      if (!res.ok) throw new Error(`GET /trips failed: ${res.status}`);
      const data = (await res.json()) as { trips: TripSummary[] };
      setTrips(data.trips);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trips");
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/trips/${id}?owner_token=${encodeURIComponent(getOwnerToken())}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`DELETE /trips/${id} failed: ${res.status}`);
    setTrips((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { trips, loading, error, refresh, remove };
}
