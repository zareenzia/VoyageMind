import { useState } from "react";
import type { RunEvent } from "@shared/schemas/index.ts";
import type { RunState } from "../../hooks/useRun.ts";
import { WorkspaceHeader } from "./WorkspaceHeader.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TripSummaryCard } from "./TripSummaryCard.tsx";
import { DayTimeline } from "./DayTimeline.tsx";
import { CritiquePanel } from "./CritiquePanel.tsx";
import { MapPanel } from "./MapPanel.tsx";
import { ProvenancePanel } from "./ProvenancePanel.tsx";
import { PlanNarrative } from "./PlanNarrative.tsx";

interface Props {
  event: RunEvent;
  progress: RunState["progress"];
  onNewTrip: () => void;
}

export function WorkspaceLayout({ event, progress, onNewTrip }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedDay, setExpandedDay] = useState<number | null>(0);

  // Extract payload — works for both run_succeeded and run_infeasible
  if (event.kind !== "run_succeeded" && event.kind !== "run_infeasible") return null;
  const { itinerary, critique, brief } = event.payload;
  const revisionsUsed = event.payload.revisions_used;
  const travellerCount = brief.travellers.count;
  // Only run_succeeded carries prose: the Writer stage is gated on a `pass`
  // verdict, so run_infeasible has no writer_output field at all.
  const writerOutput = event.kind === "run_succeeded" ? event.payload.writer_output : null;

  return (
    <div className="flex h-screen flex-col bg-sand">
      <WorkspaceHeader
        onNewTrip={onNewTrip}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarOpen={sidebarOpen}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNewTrip={onNewTrip}
          progress={progress}
        />

        {/* Main workspace */}
        <main className="flex-1 overflow-y-auto p-4 xl:p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {/* Trip summary */}
            <TripSummaryCard brief={brief} />

            {/* Itinerary summary line */}
            <div className="rounded-xl border border-sand-dark bg-white px-5 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-charcoal-light">{itinerary.brief_summary}</p>
                <div className="ml-4 shrink-0 text-right">
                  <p className="font-heading text-lg text-charcoal">
                    ${itinerary.estimated_total_usd.toFixed(2)}
                  </p>
                  {!itinerary.estimated_total_complete && (
                    <p className="text-[10px] text-amber">~ partial total</p>
                  )}
                </div>
              </div>
              {itinerary.flights_cost_usd !== null && (
                <p className="mt-1 text-xs text-clay">Includes flights: ${itinerary.flights_cost_usd.toFixed(2)}</p>
              )}
              {itinerary.flights_cost_usd === null && brief.budget_includes_flights && (
                <p className="mt-1 text-xs italic text-clay-light">Flight costs unavailable</p>
              )}
            </div>

            {/* The written plan, with its caveats above the day narrative */}
            <PlanNarrative writerOutput={writerOutput} verdictWasPass={critique.verdict === "pass"} />

            {/* Day-by-day timeline */}
            <div>
              <h3 className="mb-2 font-heading text-lg text-charcoal">Day-by-Day</h3>
              <DayTimeline
                itinerary={itinerary}
                travellerCount={travellerCount}
                expandedDay={expandedDay}
                onExpandDay={setExpandedDay}
              />
            </div>

            {/* Critique */}
            <CritiquePanel critique={critique} revisionsUsed={revisionsUsed} />
          </div>
        </main>

        {/* Right rail */}
        <aside className="hidden w-80 shrink-0 space-y-4 overflow-y-auto border-l border-sand-dark p-4 xl:block">
          <MapPanel itinerary={itinerary} highlightDay={expandedDay} />
          <ProvenancePanel itinerary={itinerary} />
        </aside>
      </div>

      {/* Right rail content stacks below main on smaller screens */}
      <div className="border-t border-sand-dark p-4 xl:hidden">
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          <MapPanel itinerary={itinerary} highlightDay={expandedDay} />
          <ProvenancePanel itinerary={itinerary} />
        </div>
      </div>
    </div>
  );
}
