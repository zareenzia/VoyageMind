import type { RunEvent } from "@shared/schemas/index.ts";
import { ItineraryView } from "./ItineraryView.tsx";

interface Terminal {
  kind: "run_succeeded" | "run_infeasible" | "run_blocked" | "run_failed" | "connection_lost" | "run_expired";
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
    case "run_expired":
      return <RunExpiredView />;
  }
}

function SucceededView({ event }: { event: RunEvent }) {
  if (event.kind !== "run_succeeded") return null;
  const { itinerary, critique, brief } = event.payload;
  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-center gap-3 rounded-xl border border-moss/20 bg-moss/5 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-moss/10">
          <svg viewBox="0 0 20 20" className="h-5 w-5 text-moss" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 10l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p className="font-heading text-lg text-charcoal">Trip planned successfully</p>
          <p className="text-sm text-clay">Your itinerary is ready</p>
        </div>
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
    <div className="animate-fade-up space-y-6">
      <div className="rounded-xl border border-amber/20 bg-amber/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber/10">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-amber" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 5v5M10 14h.01" strokeLinecap="round" />
              <circle cx="10" cy="10" r="8" />
            </svg>
          </div>
          <div>
            <p className="font-heading text-lg text-charcoal">This trip isn't feasible</p>
            <p className="text-sm text-clay">{itinerary.brief_summary}</p>
          </div>
        </div>
      </div>

      {critique.hard_failures.length > 0 && (
        <div className="rounded-xl border border-terracotta/15 bg-terracotta/5 p-5">
          <p className="mb-3 text-sm font-semibold text-terracotta">What went wrong</p>
          <ul className="space-y-2">
            {critique.hard_failures.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-terracotta/50" />
                <span><span className="font-mono text-xs text-clay">[{f.code}]</span> {f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {critique.suggested_fixes.length > 0 && (
        <div className="rounded-xl border border-moss/15 bg-moss/5 p-5">
          <p className="mb-3 text-sm font-semibold text-moss">Try instead</p>
          <ul className="space-y-2">
            {critique.suggested_fixes.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-moss/50" />
                {s}
              </li>
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
    <div className="animate-fade-up">
      <div className="rounded-2xl border border-ocean/15 bg-white p-8 shadow-lg shadow-ocean/5">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-ocean/10">
            <svg viewBox="0 0 20 20" className="h-6 w-6 text-ocean" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="10" cy="10" r="8" />
              <path d="M10 6v4M10 13h.01" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="font-heading text-xl text-charcoal">A few more details needed</h3>
          <p className="mt-1 text-sm text-clay">{event.message}</p>
        </div>

        <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
          {event.open_questions.map((q, i) => (
            <div key={i}>
              <label className="mb-2 block text-sm font-medium text-charcoal">{q}</label>
              <input
                type="text"
                className="w-full rounded-lg border border-sand-dark bg-sand/40 px-4 py-3 text-sm text-charcoal placeholder:text-clay-light focus:border-ocean focus:outline-none focus:ring-2 focus:ring-ocean/20 transition-all"
                placeholder="Your answer…"
              />
            </div>
          ))}
          <button
            type="submit"
            className="w-full rounded-xl bg-ocean px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-ocean-light hover:shadow-lg hover:shadow-ocean/20"
          >
            Continue planning
          </button>
        </form>
      </div>
    </div>
  );
}

function FailedView({ event }: { event: RunEvent }) {
  if (event.kind !== "run_failed") return null;
  return (
    <div className="animate-fade-up">
      <div className="rounded-xl border border-terracotta/20 bg-terracotta/5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-terracotta/10">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-terracotta" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="font-heading text-lg text-charcoal">Something went wrong</p>
            <p className="mt-1 text-sm text-charcoal-light">{event.message}</p>
            {event.stage && (
              <p className="mt-2 inline-block rounded-md bg-sand px-2 py-0.5 text-xs font-mono text-clay">
                Failed during: {event.stage}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 rounded-lg border border-terracotta/30 px-4 py-2 text-sm font-medium text-terracotta transition-colors hover:bg-terracotta/10"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function ConnectionLostView() {
  return (
    <div className="animate-fade-up">
      <div className="rounded-xl border border-sand-dark bg-white p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sand-dark">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-clay" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l12 12M7 3a8 8 0 0111 1M5 7a5 5 0 017 0M8 10a2 2 0 013 0" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="font-heading text-lg text-charcoal">Connection lost</p>
            <p className="mt-1 text-sm text-charcoal-light">
              The connection to the server couldn't be restored. Your run may still be completing in the background.
            </p>
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 rounded-lg border border-charcoal/20 px-4 py-2 text-sm font-medium text-charcoal transition-colors hover:bg-sand-dark"
        >
          Refresh page
        </button>
      </div>
    </div>
  );
}

function RunExpiredView() {
  const handleStartFresh = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("run");
    window.location.href = url.toString();
  };

  return (
    <div className="animate-fade-up">
      <div className="rounded-xl border border-sand-dark bg-white p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sand-dark">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-clay" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="10" cy="10" r="8" />
              <path d="M10 5v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="font-heading text-lg text-charcoal">Run no longer available</p>
            <p className="mt-1 text-sm text-charcoal-light">
              This run has expired or the server restarted. Completed plans are kept for 10 minutes.
            </p>
          </div>
        </div>
        <button
          onClick={handleStartFresh}
          className="mt-5 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-dark"
        >
          Start a new plan
        </button>
      </div>
    </div>
  );
}
