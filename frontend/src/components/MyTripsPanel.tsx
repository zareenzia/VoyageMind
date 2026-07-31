import { useState } from "react";
import { useMyTrips } from "../hooks/useMyTrips.ts";

interface Props {
  onSelectTrip: (id: string) => void;
}

export function MyTripsPanel({ onSelectTrip }: Props) {
  const [open, setOpen] = useState(false);
  const { trips, loading, error, remove } = useMyTrips();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg px-3 py-2 text-sm font-medium text-clay transition-colors hover:bg-sand hover:text-charcoal"
      >
        My Trips{trips.length > 0 ? ` (${trips.length})` : ""}
      </button>

      {open && (
        <>
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-sand-dark bg-white p-2 shadow-xl shadow-charcoal/10">
            {loading && <p className="px-3 py-2 text-sm text-clay">Loading…</p>}
            {error && <p className="px-3 py-2 text-sm text-terracotta">{error}</p>}
            {!loading && !error && trips.length === 0 && (
              <p className="px-3 py-2 text-sm text-clay">No saved trips yet.</p>
            )}
            <ul className="max-h-80 overflow-y-auto">
              {trips.map((trip) => (
                <li
                  key={trip.id}
                  className="group flex items-center justify-between gap-2 rounded-lg px-1 hover:bg-sand"
                >
                  <button
                    onClick={() => {
                      onSelectTrip(trip.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 py-2 pl-2 text-left"
                  >
                    <p className="truncate text-sm text-charcoal">{trip.request}</p>
                    <p className="text-[11px] text-clay">
                      {trip.status === "infeasible" ? "Infeasible · " : ""}
                      {new Date(trip.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    onClick={() => void remove(trip.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-clay opacity-0 hover:bg-terracotta/10 hover:text-terracotta group-hover:opacity-100"
                    aria-label={`Delete trip: ${trip.request}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
