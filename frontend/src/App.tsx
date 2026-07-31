import { useEffect, useState } from "react";
import { useRun } from "./hooks/useRun.ts";
import { Navbar } from "./components/Navbar.tsx";
import { HeroSection } from "./components/HeroSection.tsx";
import { RunRequestForm } from "./components/RunRequestForm.tsx";
import { RunProgress } from "./components/RunProgress2.tsx";
import { TerminalPanel } from "./components/TerminalPanel.tsx";
import { Footer } from "./components/Footer.tsx";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout.tsx";

function getRunIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("run");
}

function setRunIdInUrl(runId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("run", runId);
  window.history.pushState({}, "", url.toString());
}

function clearRunIdFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("run");
  window.history.pushState({}, "", url.toString());
}

type View = "home" | "planner";

export function App() {
  const { state, startRun, rejoinRun } = useRun();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");

  // Rejoin run from URL on mount
  useEffect(() => {
    const existingRunId = getRunIdFromUrl();
    if (existingRunId && state.phase === "idle") {
      setView("planner");
      rejoinRun(existingRunId);
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
    setView("planner");
    clearRunIdFromUrl();
  };

  const handleHome = () => {
    if (state.phase === "idle") {
      setView("home");
      clearRunIdFromUrl();
    }
  };

  const isRunning = state.phase === "running" || state.phase === "reconnecting" || state.phase === "terminal";

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
      <Navbar onHome={handleHome} />

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
