import type { RunState } from "../hooks/useRun.ts";

type PipelineStage = "intake" | "guide" | "itinerary" | "critic";

const STAGE_LABELS: Record<PipelineStage, string> = {
  intake: "Reading request",
  guide: "Researching destinations",
  itinerary: "Building itinerary",
  critic: "Reviewing plan",
};

interface Props {
  progress: RunState["progress"];
  reconnecting: boolean;
}

function elapsed(startedAt: number | null): string {
  if (!startedAt) return "";
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  return `${seconds}s`;
}

export function RunProgress({ progress, reconnecting }: Props) {
  const stages: PipelineStage[] = ["intake", "guide", "itinerary", "critic"];
  const completedDestinations = progress.destinations.filter((d) => d.status === "completed").length;

  return (
    <div className="space-y-4">
      {reconnecting && (
        <p className="text-sm text-amber-600">Reconnecting…</p>
      )}

      <div className="text-xs text-gray-500">
        {progress.startedAt && <ElapsedTimer startedAt={progress.startedAt} />}
      </div>

      <ul className="space-y-2">
        {stages.map((stage) => {
          const status = progress.stageStatuses[stage];
          return (
            <li key={stage} className="flex items-center gap-2">
              <StatusDot status={status} />
              <span className={status === "started" ? "font-medium text-gray-900" : "text-gray-600"}>
                {STAGE_LABELS[stage]}
              </span>
              {stage === "guide" && status === "started" && progress.destinationTotal > 0 && (
                <span className="ml-2 text-xs text-gray-500">
                  {completedDestinations}/{progress.destinationTotal} destinations
                </span>
              )}
              {(stage === "itinerary" || stage === "critic") && progress.revisionRound > 0 && status === "started" && (
                <span className="ml-2 text-xs text-gray-500">
                  revision round {progress.revisionRound}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {progress.currentStage === "guide" && progress.destinations.length > 0 && (
        <div className="ml-6 space-y-1">
          {progress.destinations.map((d) => (
            <div key={d.name} className="flex items-center gap-2 text-sm text-gray-600">
              <StatusDot status={d.status} />
              <span>{d.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorClass =
    status === "completed" ? "bg-green-500" :
    status === "started" ? "bg-blue-500 animate-pulse" :
    status === "failed" ? "bg-red-500" :
    "bg-gray-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${colorClass}`} />;
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  // Simple elapsed display — re-renders via parent state changes (each SSE event triggers one)
  return <span>{elapsed(startedAt)} elapsed</span>;
}
