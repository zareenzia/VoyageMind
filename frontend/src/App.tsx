import { useEffect, useState } from "react";
import type { RunEvent } from "@shared/schemas/index.ts";
import type { TripRecord } from "@shared/trips/store.ts";
import { useRun } from "./hooks/useRun.ts";
import { useTripView } from "./hooks/useTripView.ts";
import { Navbar } from "./components/Navbar.tsx";
import { HeroSection } from "./components/HeroSection.tsx";
import { RunRequestForm } from "./components/RunRequestForm.tsx";
import { RunProgress } from "./components/RunProgress2.tsx";
import { TerminalPanel } from "./components/TerminalPanel.tsx";
import { Footer } from "./components/Footer.tsx";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout.tsx";
import { LegacyTripView } from "./components/LegacyTripView.tsx";

function getRunIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("run");
}

function getTripIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("trip");
}

function setRunIdInUrl(runId: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete("trip");
  url.searchParams.set("run", runId);
  window.history.pushState({}, "", url.toString());
}

function setTripIdInUrl(tripId: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete("run");
  url.searchParams.set("trip", tripId);
  window.history.pushState({}, "", url.toString());
}

function clearRunIdFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("run");
  url.searchParams.delete("trip");
  window.history.pushState({}, "", url.toString());
}

/** A stored trip has no SSE envelope of its own — reconstruct the same
 * RunEvent shape WorkspaceLayout already knows how to render, so a saved
 * trip and a freshly-finished run share one view instead of two. */
function tripRecordToRunEvent(trip: TripRecord): RunEvent {
  const payload = {
    brief: trip.brief,
    destinations: trip.destinations,
    itinerary: trip.itinerary,
    critique: trip.critique,
    revisions_used: trip.revisionsUsed,
  };
  if (trip.status === "infeasible") {
    // No writer_output on this event kind at all — the Writer stage is gated on
    // a `pass`, so an infeasible trip never had prose to lose.
    return { kind: "run_infeasible", run_id: trip.id, seq: 0, timestamp: trip.createdAt, payload };
  }
  return {
    kind: "run_succeeded",
    run_id: trip.id,
    seq: 0,
    timestamp: trip.createdAt,
    // Carried through explicitly: leaving it off here silently dropped the prose
    // on every saved trip, which would have made persisting it (D8) pointless —
    // the whole reason to store rather than regenerate is that the traveller sees
    // the same words again.
    payload: { ...payload, writer_output: trip.writerOutput },
  };
}

type View = "home" | "planner";

export function App() {
  const { state, startRun, rejoinRun } = useRun();
  const tripView = useTripView();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");

  // Rejoin a live run, or open a saved trip, from the URL on mount.
  useEffect(() => {
    const existingRunId = getRunIdFromUrl();
    const existingTripId = getTripIdFromUrl();
    if (existingRunId && state.phase === "idle") {
      setView("planner");
      rejoinRun(existingRunId);
    } else if (existingTripId) {
      void tripView.load(existingTripId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (request: string) => {
    setError(null);
    try {
      const runId = await startRun(request);
      setRunIdInUrl(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run");
    }
  };

  const handleStartPlan = () => {
    tripView.clear();
    setView("planner");
    clearRunIdFromUrl();
  };

  const handleHome = () => {
    if (state.phase === "idle") {
      tripView.clear();
      setView("home");
      clearRunIdFromUrl();
    }
  };

  const handleSelectTrip = (id: string) => {
    setTripIdInUrl(id);
    void tripView.load(id);
  };

  const isRunning = state.phase === "running" || state.phase === "reconnecting" || state.phase === "terminal";

  // A saved trip, opened from "My Trips" or a shared /? trip=<id> link.
  if (tripView.state) {
    if (tripView.state.status === "loading") {
      return (
        <div className="flex min-h-screen flex-col bg-sand">
          <Navbar onHome={handleHome} onSelectTrip={handleSelectTrip} />
          <main className="flex flex-1 items-center justify-center">
            <p className="text-sm text-clay">Loading trip…</p>
          </main>
          <Footer />
        </div>
      );
    }

    if (tripView.state.status === "not_found" || tripView.state.status === "error") {
      return (
        <div className="flex min-h-screen flex-col bg-sand">
          <Navbar onHome={handleHome} onSelectTrip={handleSelectTrip} />
          <main className="mx-auto max-w-2xl flex-1 px-6 py-16 text-center">
            <p className="text-sm text-clay">
              {tripView.state.status === "not_found" ? "That trip no longer exists." : tripView.state.message}
            </p>
            <button
              onClick={handleStartPlan}
              className="mt-6 rounded-xl bg-terracotta px-6 py-2.5 text-sm font-semibold text-white hover:bg-terracotta-dark"
            >
              Plan a new trip
            </button>
          </main>
          <Footer />
        </div>
      );
    }

    const { result } = tripView.state;
    if (!result.ok) {
      return (
        <div className="flex min-h-screen flex-col bg-sand">
          <Navbar onHome={handleHome} onSelectTrip={handleSelectTrip} />
          <main className="flex-1">
            <LegacyTripView
              summary={result.summary}
              notice={result.notice}
              createdAt={result.createdAt}
              onNewTrip={handleStartPlan}
            />
          </main>
          <Footer />
        </div>
      );
    }

    return <WorkspaceLayout event={tripRecordToRunEvent(result.trip)} progress={state.progress} onNewTrip={handleStartPlan} />;
  }

  // Workspace view for succeeded/infeasible — full layout with sidebar, map, provenance
  if (
    state.phase === "terminal" &&
    state.terminal &&
    (state.terminal.kind === "run_succeeded" || state.terminal.kind === "run_infeasible") &&
    state.terminal.event
  ) {
    return (
      <WorkspaceLayout
        event={state.terminal.event}
        progress={state.progress}
        onNewTrip={handleStartPlan}
      />
    );
  }

  // Standard layout for idle, running, and error terminal states
  return (
    <div className="flex min-h-screen flex-col bg-sand">
      <Navbar onHome={handleHome} onSelectTrip={handleSelectTrip} />

      <main className="flex-1">
        {/* Hero + landing */}
        {view === "home" && !isRunning && (
          <div className="mx-auto max-w-5xl px-6">
            <HeroSection onStartPlan={handleStartPlan} />
          </div>
        )}

        {/* Planning view */}
        {(view === "planner" || isRunning) && (
          <div className="mx-auto max-w-3xl px-6 py-10">
            {state.phase === "idle" && (
              <div className="animate-fade-up">
                <div className="mb-8 text-center">
                  <h2 className="font-heading text-3xl text-charcoal">Where to next?</h2>
                  <p className="mt-2 text-sm text-clay">
                    Describe your trip — destinations, duration, budget, interests. Be specific.
                  </p>
                </div>
                <RunRequestForm onSubmit={handleSubmit} />
                {error && (
                  <div className="mt-4 animate-fade-up rounded-lg border border-terracotta/20 bg-terracotta/5 px-4 py-3 text-sm text-terracotta">
                    {error}
                  </div>
                )}
              </div>
            )}

            {(state.phase === "running" || state.phase === "reconnecting") && (
              <RunProgress progress={state.progress} reconnecting={state.phase === "reconnecting"} />
            )}

            {/* Non-workspace terminal states: blocked, failed, expired, connection_lost */}
            {state.phase === "terminal" && state.terminal &&
              state.terminal.kind !== "run_succeeded" && state.terminal.kind !== "run_infeasible" && (
              <TerminalPanel terminal={state.terminal} events={state.events} />
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
