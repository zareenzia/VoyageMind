import { useState, type FormEvent } from "react";
import type { TripSummary } from "@shared/trips/store.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useMyTrips } from "../hooks/useMyTrips.ts";
import { buildShareUrl } from "../lib/shareToken.ts";

interface Props {
  onSelectTrip: (id: string) => void;
}

export function MyTripsPanel({ onSelectTrip }: Props) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { trips, loading, error, remove, rename, share, unshare } = useMyTrips();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<{ id: string; url: string; copied: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setActionError(null);
    try {
      await work();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

  const handleShare = (trip: TripSummary) =>
    run(async () => {
      const token = await share(trip.id);
      const url = buildShareUrl(trip.id, token);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Clipboard access needs a secure context and user permission; showing
        // the link to copy by hand is a working fallback, not an error.
      }
      setShareUrl({ id: trip.id, url, copied });
    });

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
          <div className="absolute right-0 z-50 mt-2 w-96 rounded-xl border border-sand-dark bg-white p-2 shadow-xl shadow-charcoal/10">
            {loading && <p className="px-3 py-2 text-sm text-clay">Loading…</p>}
            {error && <p className="px-3 py-2 text-sm text-terracotta">{error}</p>}
            {actionError && <p className="px-3 py-2 text-sm text-terracotta">{actionError}</p>}
            {!loading && !error && trips.length === 0 && (
              <p className="px-3 py-2 text-sm text-clay">No saved trips yet.</p>
            )}

            <ul className="max-h-96 overflow-y-auto">
              {trips.map((trip) => (
                <li key={trip.id} className="group rounded-lg px-1 hover:bg-sand">
                  {renaming === trip.id ? (
                    <RenameForm
                      initial={trip.title ?? ""}
                      onCancel={() => setRenaming(null)}
                      onSubmit={(title) =>
                        run(async () => {
                          await rename(trip.id, title);
                          setRenaming(null);
                        })
                      }
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onSelectTrip(trip.id);
                          setOpen(false);
                        }}
                        className="min-w-0 w-full py-2 pl-2 text-left"
                      >
                        {/* A renamed trip keeps its original request underneath:
                            the title is a label, not a replacement for what was
                            actually asked for. */}
                        <p className="truncate text-sm text-charcoal">{trip.title ?? trip.request}</p>
                        <p className="truncate text-[11px] text-clay">
                          {trip.status === "infeasible" ? "Infeasible · " : ""}
                          {new Date(trip.createdAt).toLocaleDateString()}
                          {trip.shared ? " · Shared" : ""}
                          {trip.title ? ` · ${trip.request}` : ""}
                        </p>
                      </button>

                      <div className="flex gap-1 pb-1.5 pl-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <RowAction onClick={() => setRenaming(trip.id)}>Rename</RowAction>
                        {trip.shared ? (
                          <RowAction
                            onClick={() =>
                              run(async () => {
                                await unshare(trip.id);
                                setShareUrl(null);
                              })
                            }
                          >
                            Stop sharing
                          </RowAction>
                        ) : (
                          <RowAction onClick={() => void handleShare(trip)}>Share</RowAction>
                        )}
                        <RowAction danger onClick={() => void run(() => remove(trip.id))}>
                          Delete
                        </RowAction>
                      </div>

                      {shareUrl?.id === trip.id && (
                        <div className="mb-1.5 ml-1 mr-1 rounded-lg bg-sand-dark/40 px-2 py-1.5">
                          <p className="text-[11px] font-medium text-charcoal">
                            {shareUrl.copied ? "Link copied" : "Copy this link"}
                          </p>
                          <input
                            readOnly
                            value={shareUrl.url}
                            onFocus={(e) => e.currentTarget.select()}
                            className="mt-1 w-full rounded border border-sand-dark bg-white px-1.5 py-1 text-[11px] text-clay"
                          />
                          <p className="mt-1 text-[10px] leading-snug text-clay">
                            Anyone with this link can read the trip. "Stop sharing" makes it stop
                            working.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>

            {/*
              The device-bound warning is the concrete defect accounts were built
              to fix (spec D9), so it is stated where it bites: this list lives in
              one browser until there is an account behind it.
            */}
            {!user && trips.length > 0 && (
              <p className="mt-1 border-t border-sand px-3 py-2 text-[11px] leading-relaxed text-clay">
                These trips are saved to this browser only. Sign in to keep them if you clear your
                browser data or switch devices.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RowAction({
  children,
  onClick,
  danger,
}: {
  children: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
        danger ? "text-clay hover:bg-terracotta/10 hover:text-terracotta" : "text-clay hover:bg-white hover:text-charcoal"
      }`}
    >
      {children}
    </button>
  );
}

function RenameForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (title: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Blank clears the name rather than storing an empty label — the same rule
    // the store applies, stated here so the two cannot disagree.
    onSubmit(value.trim().length === 0 ? null : value);
  };

  return (
    <form onSubmit={submit} className="flex gap-1 p-1.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Name this trip"
        maxLength={120}
        className="min-w-0 flex-1 rounded-lg border border-sand-dark px-2 py-1 text-sm text-charcoal outline-none focus:border-terracotta"
      />
      <button type="submit" className="rounded-lg bg-terracotta px-2.5 py-1 text-xs font-semibold text-white">
        Save
      </button>
      <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-xs text-clay hover:text-charcoal">
        Cancel
      </button>
    </form>
  );
}
