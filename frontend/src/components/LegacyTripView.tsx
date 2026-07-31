import type { LegacyTripSummary } from "@shared/trips/legacy-summary.ts";

interface Props {
  summary: LegacyTripSummary;
  notice: string;
  createdAt: string;
  onNewTrip: () => void;
}

/**
 * Rendered instead of the full workspace whenever a stored trip's
 * schema_version doesn't match the schemas' current shape. Only fields
 * extractLegacySummary could safely pull from the raw row — never the
 * timeline, map, or provenance panel, which all assume a validated
 * Itinerary. See docs/VOYAGEMIND_SPEC.md D7.
 */
export function LegacyTripView({ summary, notice, createdAt, onNewTrip }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-xl border border-amber/30 bg-amber/5 p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-amber">{notice}</p>
        <h2 className="mt-2 font-heading text-2xl text-charcoal">{summary.request}</h2>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-clay">Destinations</dt>
            <dd className="mt-0.5 text-charcoal">
              {summary.destinationNames.length > 0 ? summary.destinationNames.join(", ") : "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-clay">Dates</dt>
            <dd className="mt-0.5 text-charcoal">
              {summary.startDate && summary.endDate ? `${summary.startDate} → ${summary.endDate}` : "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-clay">Days</dt>
            <dd className="mt-0.5 text-charcoal">{summary.dayCount ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-clay">Saved</dt>
            <dd className="mt-0.5 text-charcoal">{new Date(createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>

      <button
        onClick={onNewTrip}
        className="mt-6 rounded-xl bg-terracotta px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-terracotta-dark"
      >
        Plan a new trip
      </button>
    </div>
  );
}
