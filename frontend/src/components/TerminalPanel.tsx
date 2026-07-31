import type { RunEvent } from "@shared/schemas/index.ts";
import { ItineraryView } from "./ItineraryView.tsx";

interface Terminal {
  kind: "run_succeeded" | "run_infeasible" | "run_blocked" | "run_failed" | "connection_lost";
  event: RunEvent | null;
}

interface Props {
  terminal: Terminal;
  events: RunEvent[];
}

export function TerminalPanel({ terminal }: Props) {
  switch (terminal.kind) {
    case "run_succeeded":
      return <SucceededView event={terminal.event!} />;
    case "run_infeasible":
      return <InfeasibleView event={terminal.event!} />;
    case "run_blocked":
      return <BlockedView event={terminal.event!} />;
    case "run_failed":
      return <FailedView event={terminal.event!} />;
    case "connection_lost":
      return <ConnectionLostView />;
  }
}

function SucceededView({ event }: { event: RunEvent }) {
  if (event.kind !== "run_succeeded") return null;
  const { itinerary, critique, brief } = event.payload;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-green-200 bg-green-50 p-4">
        <p className="font-medium text-green-800">Trip planned successfully</p>
      </div>
      <ItineraryView
        itinerary={itinerary}
        critique={critique}
        travellerCount={brief.travellers.count}
        revisionsUsed={event.payload.revisions_used}
      />
    </div>
  );
}

function InfeasibleView({ event }: { event: RunEvent }) {
  if (event.kind !== "run_infeasible") return null;
  const { critique, itinerary, brief } = event.payload;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
        <p className="font-medium text-amber-800">Trip is infeasible</p>
        <p className="mt-1 text-sm text-amber-700">{itinerary.brief_summary}</p>
      </div>
      {critique.hard_failures.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">Hard failures:</p>
          <ul className="ml-4 list-disc space-y-1 text-sm text-gray-600">
            {critique.hard_failures.map((f, i) => (
              <li key={i}>[{f.code}] {f.message}</li>
            ))}
          </ul>
        </div>
      )}
      {critique.suggested_fixes.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">Suggested fixes:</p>
          <ul className="ml-4 list-disc space-y-1 text-sm text-gray-600">
            {critique.suggested_fixes.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <ItineraryView
        itinerary={itinerary}
        critique={critique}
        travellerCount={brief.travellers.count}
        revisionsUsed={event.payload.revisions_used}
      />
    </div>
  );
}

function BlockedView({ event }: { event: RunEvent }) {
  if (event.kind !== "run_blocked") return null;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
        <p className="font-medium text-blue-800">More information needed</p>
        <p className="mt-1 text-sm text-blue-700">{event.message}</p>
      </div>
      <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
        {event.open_questions.map((q, i) => (
          <div key={i} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">{q}</label>
            <input
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Your answer…"
            />
          </div>
        ))}
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Continue
        </button>
      </form>
    </div>
  );
}

function FailedView({ event }: { event: RunEvent }) {
  if (event.kind !== "run_failed") return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <p className="font-medium text-red-800">Something went wrong</p>
      <p className="mt-1 text-sm text-red-700">{event.message}</p>
      {event.stage && <p className="mt-1 text-xs text-red-500">Failed during: {event.stage}</p>}
    </div>
  );
}

function ConnectionLostView() {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <p className="font-medium text-gray-800">Connection lost</p>
      <p className="mt-1 text-sm text-gray-600">
        The connection to the server was lost and could not be restored. Please refresh the page to try again.
      </p>
    </div>
  );
}
