import type { PipelineStage } from "@shared/schemas/index.ts";
import type { RunState } from "../hooks/useRun.ts";
import { useEffect, useState } from "react";

// Keyed by the schema's PipelineStage rather than a local copy of the union —
// the copy went stale when the Writer stage was added and nothing caught it.
const STAGES: { key: PipelineStage; label: string; description: string }[] = [
  { key: "intake", label: "Reading", description: "Understanding your request" },
  { key: "guide", label: "Researching", description: "Exploring destinations" },
  { key: "itinerary", label: "Planning", description: "Building your itinerary" },
  { key: "critic", label: "Reviewing", description: "Checking feasibility" },
  { key: "writer", label: "Writing", description: "Writing up your plan" },
];

interface Props {
  progress: RunState["progress"];
  reconnecting: boolean;
}

export function RunProgress({ progress, reconnecting }: Props) {
  const completedDestinations = progress.destinations.filter((d) => d.status === "completed").length;
  const failedDestinations = progress.destinations.filter((d) => d.status === "failed").length;

  return (
    <div className="animate-fade-up">
      {reconnecting && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-4 py-2 text-sm text-amber">
          Reconnecting to your run…
        </div>
      )}

      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="font-heading text-2xl text-charcoal">Planning your trip</h2>
        {progress.startedAt && <ElapsedTimer startedAt={progress.startedAt} />}
      </div>

      <div className="relative ml-4">
        {/* Vertical connector line */}
        <div className="absolute top-0 bottom-0 left-3 w-px bg-sand-dark" />

        <div className="space-y-6">
          {STAGES.map((stage, idx) => {
            const status = progress.stageStatuses[stage.key];
            const isActive = status === "started";
            const isComplete = status === "completed";
            const isFailed = status === "failed";
            const isPending = status === "pending";

            return (
              <div
                key={stage.key}
                className={`relative pl-10 transition-opacity duration-300 ${isPending ? "opacity-40" : "opacity-100"}`}
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {/* Node dot */}
                <div className="absolute left-0 top-0.5">
                  <StageDot status={status} />
                </div>

                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-sm font-semibold ${isActive ? "text-terracotta" : isComplete ? "text-moss" : isFailed ? "text-red-600" : "text-charcoal-light"}`}>
                      {stage.label}
                    </span>
                    {isActive && (
                      <span className="text-xs text-clay">{stage.description}</span>
                    )}
                    {isComplete && (
                      <span className="text-xs text-moss">done</span>
                    )}
                  </div>

                  {/* Guide destination detail */}
                  {stage.key === "guide" && (isActive || isComplete) && progress.destinationTotal > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {progress.destinations.map((d) => (
                        <DestinationCard key={d.name} name={d.name} status={d.status} />
                      ))}
                      {isActive && completedDestinations < progress.destinationTotal && (
                        <p className="mt-1 text-xs text-clay">
                          {completedDestinations}/{progress.destinationTotal} destinations researched
                          {failedDestinations > 0 && ` · ${failedDestinations} failed`}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Revision loop detail */}
                  {(stage.key === "itinerary" || stage.key === "critic") && progress.revisionRound > 0 && isActive && (
                    <RevisionIndicator round={progress.revisionRound} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StageDot({ status }: { status: string }) {
  if (status === "started") {
    return (
      <span className="flex h-6 w-6 items-center justify-center">
        <span className="animate-pulse-warm h-3 w-3 rounded-full bg-terracotta" />
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="flex h-6 w-6 items-center justify-center">
        <svg className="h-4 w-4 text-moss" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5 L6.5 12 L13 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-6 w-6 items-center justify-center">
        <span className="h-3 w-3 rounded-full bg-red-500" />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-clay-light" />
    </span>
  );
}

function DestinationCard({ name, status }: { name: string; status: string }) {
  return (
    <div className={`animate-fade-up flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
      status === "completed" ? "border-moss/30 bg-moss/5 text-moss" :
      status === "failed" ? "border-red-300/30 bg-red-50 text-red-700" :
      "border-terracotta/20 bg-terracotta/5 text-terracotta"
    }`}>
      {status === "started" && <span className="animate-pulse-warm h-1.5 w-1.5 rounded-full bg-terracotta" />}
      {status === "completed" && (
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5 L6.5 12 L13 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {status === "failed" && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
      <span>{name}</span>
    </div>
  );
}

function RevisionIndicator({ round }: { round: number }) {
  return (
    <div className="animate-fade-up mt-2 flex items-center gap-2 rounded-md border border-amber/30 bg-amber/5 px-3 py-1.5 text-xs text-amber">
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4" strokeLinecap="round" />
        <path d="M12 2.5 12.5 4 11 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Refining the plan — revision {round} of 2</span>
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const display = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <span className="font-mono text-xs text-clay">{display}</span>
  );
}
