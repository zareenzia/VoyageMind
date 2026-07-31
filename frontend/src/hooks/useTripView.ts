import { useCallback, useState } from "react";
import type { TripReadResult } from "@shared/trips/store.ts";

export type TripViewState = { status: "loading" } | { status: "not_found" } | { status: "error"; message: string } | { status: "loaded"; result: TripReadResult };

/** Fetches a previously saved trip by id (GET /trips/:id) — distinct from
 * useRun, which drives a live SSE run. Used to open an entry from "my trips". */
export function useTripView() {
  const [state, setState] = useState<TripViewState | null>(null);

  const load = useCallback(async (id: string) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/trips/${id}`);
      if (res.status === 404) {
        setState({ status: "not_found" });
        return;
      }
      if (!res.ok) throw new Error(`GET /trips/${id} failed: ${res.status}`);
      const result = (await res.json()) as TripReadResult;
      setState({ status: "loaded", result });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load trip" });
    }
  }, []);

  const clear = useCallback(() => setState(null), []);

  return { state, load, clear };
}
