import type { DayPlan, Itinerary, ScheduledStop } from "@shared/schemas/index.ts";

interface Props {
  itinerary: Itinerary;
  travellerCount: number;
  expandedDay: number | null;
  onExpandDay: (dayIndex: number | null) => void;
}

export function DayTimeline({ itinerary, travellerCount, expandedDay, onExpandDay }: Props) {
  // Pre-compute running totals for all stops
  const runningTotals: number[] = [];
  let running = 0;
  for (const day of itinerary.days) {
    for (const stop of day.stops) {
      running += stop.activity.cost_usd_per_person * travellerCount;
      runningTotals.push(running);
    }
    if (day.lodging_cost_usd !== null) {
      running += day.lodging_cost_usd;
    }
  }

  let globalIndex = 0;

  return (
    <div className="space-y-2">
      {itinerary.days.map((day, idx) => {
        const dayStartIdx = globalIndex;
        const dayCost = day.stops.reduce(
          (sum, s) => sum + s.activity.cost_usd_per_person * travellerCount, 0
        );
        const isExpanded = expandedDay === idx;

        const card = (
          <DayCard
            key={idx}
            day={day}
            dayNumber={idx + 1}
            dayCost={dayCost}
            provisional={itinerary.dates_provisional}
            expanded={isExpanded}
            onToggle={() => onExpandDay(isExpanded ? null : idx)}
          >
            {day.stops.map((stop, stopIdx) => (
              <StopRow
                key={`${stop.activity.osm_type}/${stop.activity.osm_id}`}
                stop={stop}
                travellerCount={travellerCount}
                runningTotal={runningTotals[dayStartIdx + stopIdx]}
              />
            ))}
            <DayFooter day={day} />
          </DayCard>
        );

        globalIndex += day.stops.length;
        return card;
      })}
    </div>
  );
}

function DayCard({
  day,
  dayNumber,
  dayCost,
  provisional,
  expanded,
  onToggle,
  children,
}: {
  day: DayPlan;
  dayNumber: number;
  dayCost: number;
  provisional: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-sand-dark bg-white transition-shadow hover:shadow-sm">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-terracotta/10 text-xs font-bold text-terracotta">
            {dayNumber}
          </span>
          <div>
            <span className="text-sm font-medium text-charcoal">{day.base_city}</span>
            <span className="ml-2 text-xs text-clay">
              {provisional && "~ "}{day.date}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-clay">{day.stops.length} stops</span>
          {dayCost > 0 && (
            <span className="text-xs font-mono text-clay">${dayCost.toFixed(0)}</span>
          )}
          <svg
            viewBox="0 0 16 16"
            className={`h-4 w-4 text-clay transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="animate-fade-up border-t border-sand-dark px-4 py-3 space-y-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

function StopRow({
  stop,
  travellerCount,
  runningTotal,
}: {
  stop: ScheduledStop;
  travellerCount: number;
  runningTotal: number;
}) {
  const cost = stop.activity.cost_usd_per_person * travellerCount;
  const transitStyle =
    stop.transit_source === "routed" ? "border-moss" :
    stop.transit_source === "heuristic" ? "border-amber border-dashed" :
    "border-clay-light border-dotted";

  return (
    <div className={`border-l-2 ${transitStyle} pl-3.5`}>
      {/* Transit line */}
      {stop.transit_minutes_from_previous > 0 && (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] text-clay">
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 2v8M3 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            {stop.transit_minutes_from_previous} min
            {stop.transit_source === "heuristic" && " ~"}
            {stop.transit_source === "unknown" && " (unverified)"}
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CategoryGlyph category={stop.activity.category} />
          <span className="text-sm font-medium text-charcoal">{stop.activity.name}</span>
        </div>
        <span className="shrink-0 text-[11px] font-mono text-clay">{stop.start}–{stop.end}</span>
      </div>

      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 pl-6 text-[11px] text-clay">
        {stop.activity.duration_minutes > 0 && (
          <span>
            {stop.activity.estimated.duration && "~"}{stop.activity.duration_minutes} min
          </span>
        )}
        {cost > 0 && (
          <span>
            {stop.activity.estimated.cost && "~"}${cost.toFixed(2)}
          </span>
        )}
        <span className="text-clay-light">running: ${runningTotal.toFixed(2)}</span>
        {stop.activity.opens && stop.activity.closes && (
          <span>
            {stop.activity.estimated.hours && "~"}open {stop.activity.opens}–{stop.activity.closes}
          </span>
        )}
      </div>
    </div>
  );
}

function DayFooter({ day }: { day: DayPlan }) {
  return (
    <div className="mt-2 border-t border-sand-dark/50 pt-2 space-y-1">
      {day.lodging_cost_usd !== null ? (
        <p className="flex items-center gap-1.5 text-xs text-clay">
          <span>🛏️</span> Lodging: ${day.lodging_cost_usd.toFixed(2)}
        </p>
      ) : (
        <p className="text-xs italic text-clay-light">Lodging cost unavailable</p>
      )}
      {day.notes && <p className="text-xs italic text-clay">{day.notes}</p>}
    </div>
  );
}

function CategoryGlyph({ category }: { category: string }) {
  const glyphs: Record<string, string> = {
    waterfall: "💧", cave: "🕳️", viewpoint: "👁️", peak: "⛰️",
    monument: "🏛️", museum: "🏛️", beach: "🏖️", park: "🌿",
    garden: "🌿", nature_reserve: "🌲", historic_site: "🏰",
    attraction: "⭐", gallery: "🖼️", zoo: "🦁", theme_park: "🎢",
    aquarium: "🐠", picnic_site: "🧺", artwork: "🎨",
  };
  return <span className="text-xs" title={category}>{glyphs[category] || "📍"}</span>;
}
