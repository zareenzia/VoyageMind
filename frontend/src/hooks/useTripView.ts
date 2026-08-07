import { useCallback, useState } from "react";
import type { TripReadResult } from "@shared/trips/store.ts";
import { apiGetOrNull } from "../lib/api.ts";

export type TripViewState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: TripReadResult };

/**
 * Fetches a previously saved trip by id (GET /trips/:id) — distinct from
 * useRun, which drives a live SSE run. Used to open an entry from "my trips",
 * and to open a shared link (the share token rides along automatically; see
 * lib/api.ts).
 *
 * `not_found` covers both "no such trip" and "not yours" — the server refuses
 * to distinguish them, so the client cannot either, and the message shown to
 * the user must not imply it knows which one happened.
 */
export function useTripView() {
  const [state, setState] = useState<TripViewState | null>(null);

  const load = useCallback(async (id: string) => {
    setState({ status: "loading" });
    try {
      const result = await apiGetOrNull<TripReadResult>(`/trips/${id}`);
      setState(result ? { status: "loaded", result } : { status: "not_found" });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load trip" });
    }
  }, []);

  const clear = useCallback(() => setState(null), []);

  return { state, load, clear };
}
