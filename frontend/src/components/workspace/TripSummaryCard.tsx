import type { TripBrief } from "@shared/schemas/index.ts";

interface Props {
  brief: TripBrief;
}

export function TripSummaryCard({ brief }: Props) {
  return (
    <div className="rounded-xl border border-sand-dark bg-white p-5">
      <div className="mb-3 flex items-start justify-between">
        <h3 className="font-heading text-lg text-charcoal">Trip Overview</h3>
        {brief.flexible_dates && (
          <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber">
            Flexible dates
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Destinations */}
        <InfoCell
          label="Destinations"
          value={brief.destinations.length > 0 ? brief.destinations.join(", ") : brief.region_hint || "Not specified"}
        />

        {/* Duration */}
        <InfoCell
          label="Duration"
          value={brief.nights !== null ? `${brief.nights} night${brief.nights > 1 ? "s" : ""}` : "Not specified"}
        />

        {/* Travellers */}
        <InfoCell
          label="Travellers"
          value={`${brief.travellers.count} (${brief.travellers.adults} adult${brief.travellers.adults > 1 ? "s" : ""}${brief.travellers.children > 0 ? `, ${brief.travellers.children} child${brief.travellers.children > 1 ? "ren" : ""}` : ""})`}
        />

        {/* Budget */}
        <InfoCell
          label="Budget"
          value={
            brief.budget_amount !== null
              ? `${brief.budget_amount.toLocaleString()} ${brief.budget_currency || ""}${brief.budget_includes_flights ? " (incl. flights)" : ""}`
              : "Not specified"
          }
        />

        {/* Pace */}
        <InfoCell label="Pace" value={brief.pace} />

        {/* Dates */}
        <InfoCell
          label="Dates"
          value={
            brief.start_date && brief.end_date
              ? `${brief.start_date} → ${brief.end_date}`
              : brief.start_date
                ? `From ${brief.start_date}`
                : "Provisional"
          }
          provisional={!brief.start_date}
        />
      </div>

      {/* Interests */}
      {brief.interests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {brief.interests.map((interest) => (
            <span
              key={interest}
              className="rounded-full bg-sand px-2.5 py-0.5 text-[11px] font-medium text-clay"
            >
              {interest}
            </span>
          ))}
        </div>
      )}

      {/* Constraints */}
      {(brief.must_include.length > 0 || brief.must_avoid.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-sand-dark pt-3">
          {brief.must_include.map((item) => (
            <span key={item} className="rounded-full bg-moss/10 px-2 py-0.5 text-[10px] font-medium text-moss">
              + {item}
            </span>
          ))}
          {brief.must_avoid.map((item) => (
            <span key={item} className="rounded-full bg-terracotta/10 px-2 py-0.5 text-[10px] font-medium text-terracotta">
              − {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value, provisional }: { label: string; value: string; provisional?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-clay">{label}</p>
      <p className="mt-0.5 text-sm text-charcoal">
        {provisional && <span className="text-amber">~ </span>}
        {value}
      </p>
    </div>
  );
}
