import { useEffect, useState } from "react";
import { useRun } from "./hooks/useRun.ts";
import { RunRequestForm } from "./components/RunRequestForm.tsx";
import { RunProgress } from "./components/RunProgress.tsx";
import { TerminalPanel } from "./components/TerminalPanel.tsx";

function getRunIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("run");
}

function setRunIdInUrl(runId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("run", runId);
  window.history.pushState({}, "", url.toString());
}

export function App() {
  const { state, startRun, rejoinRun } = useRun();
  const [error, setError] = useState<string | null>(null);

  // On mount, check if there's a run_id in the URL to rejoin
  useEffect(() => {
    const existingRunId = getRunIdFromUrl();
    if (existingRunId && state.phase === "idle") {
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">VoyageMind</h1>

        {state.phase === "idle" && (
          <>
            <RunRequestForm onSubmit={handleSubmit} />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}

        {(state.phase === "running" || state.phase === "reconnecting") && (
          <RunProgress progress={state.progress} reconnecting={state.phase === "reconnecting"} />
        )}

        {state.phase === "terminal" && state.terminal && (
          <TerminalPanel terminal={state.terminal} events={state.events} />
        )}
      </div>
    </div>
  );
}
