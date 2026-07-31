import type { CritiqueResult, DayPlan, Itinerary, ScheduledStop } from "@shared/schemas/index.ts";

/**
 * View-model helpers shared between CLI (pretty.ts) and this web renderer.
 * Same decisions: running total across per-person costs * travellers,
 * provisional date labeling, transit source emphasis, partial-total semantics.
 */

export function formatMoney(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function stopCost(stop: ScheduledStop, travellerCount: number): number {
  return stop.activity.cost_usd_per_person * travellerCount;
}

export function computeRunningTotals(itinerary: Itinerary, travellerCount: number): number[] {
  const totals: number[] = [];
  let running = 0;
  for (const day of itinerary.days) {
    for (const stop of day.stops) {
      running += stop.activity.cost_usd_per_person * travellerCount;
      totals.push(running);
    }
    if (day.lodging_cost_usd !== null) {
      running += day.lodging_cost_usd;
    }
  }
  return totals;
}

export function dateLabel(day: DayPlan, provisional: boolean): string {
  return provisional ? `${day.date} (provisional)` : day.date;
}

export function transitLabel(stop: ScheduledStop): string {
  if (stop.transit_minutes_from_previous > 0) {
    return `${stop.transit_minutes_from_previous} min transit (${stop.transit_source})`;
  }
  return "first stop";
}

export function totalLabel(itinerary: Itinerary): string {
  const amount = formatMoney(itinerary.estimated_total_usd);
  return itinerary.estimated_total_complete
    ? amount
    : `${amount} (partial — some costs not priced yet)`;
}

// --- React component ---

interface Props {
  itinerary: Itinerary;
  critique: CritiqueResult;
  travellerCount: number;
  revisionsUsed: number;
}

export function ItineraryView({ itinerary, critique, travellerCount, revisionsUsed }: Props) {
  let stopIndex = 0;
  const runningTotals = computeRunningTotals(itinerary, travellerCount);

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-charcoal-light">{itinerary.brief_summary}</p>

      <div className="stagger-children space-y-4">
        {itinerary.days.map((day, dayIdx) => (
          <DayCard key={dayIdx} day={day} dayNumber={dayIdx + 1} provisional={itinerary.dates_provisional}>
            {day.stops.map((stop) => {
              const currentIdx = stopIndex++;
              const total = runningTotals[currentIdx] ?? 0;
              return (
                <StopRow
                  key={`${stop.activity.osm_type}/${stop.activity.osm_id}`}
                  stop={stop}
                  travellerCount={travellerCount}
                  runningTotal={total}
                />
              );
            })}
            {day.lodging_cost_usd !== null ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-sand/80 px-3 py-2 text-xs text-clay">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 12V7M14 12V7M2 9h12M3 7V5a2 2 0 012-2h6a2 2 0 012 2v2" strokeLinecap="round" />
                </svg>
                Lodging: {formatMoney(day.lodging_cost_usd)}
              </div>
            ) : (
              <p className="mt-3 text-xs italic text-clay-light">Lodging: not priced yet</p>
            )}
            {day.notes && <p className="mt-2 text-xs italic text-clay">{day.notes}</p>}
          </DayCard>
        ))}
      </div>

      {/* Totals */}
      <div className="rounded-xl border border-sand-dark bg-white p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-charcoal">Estimated total</span>
          <span className="font-heading text-xl text-charcoal">{totalLabel(itinerary)}</span>
        </div>
        {itinerary.flights_cost_usd !== null && (
          <p className="mt-2 text-xs text-clay">Includes flights: {formatMoney(itinerary.flights_cost_usd)}</p>
        )}
        {!itinerary.estimated_total_complete && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber">
            <span>~</span> Some costs are estimated or not yet priced
          </p>
        )}
      </div>

      <CritiqueSection critique={critique} revisionsUsed={revisionsUsed} />
    </div>
  );
}

function DayCard({
  day,
  dayNumber,
  provisional,
  children,
}: {
  day: DayPlan;
  dayNumber: number;
  provisional: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-sand-dark bg-white p-5 transition-shadow hover:shadow-md hover:shadow-charcoal/5">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="font-heading text-lg text-charcoal">
          Day {dayNumber}
          <span className="ml-2 text-sm font-normal text-clay">— {day.base_city}</span>
        </h3>
        <span className="text-xs text-clay">
          {provisional && <span className="text-amber">~ </span>}
          {day.date}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
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
  const cost = stopCost(stop, travellerCount);
  const transitStyle = stop.transit_source === "routed" ? "border-moss"
    : stop.transit_source === "heuristic" ? "border-amber border-dashed"
    : "border-clay-light border-dotted";

  return (
    <div className={`border-l-2 ${transitStyle} pl-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CategoryIcon category={stop.activity.category} />
          <span className="text-sm font-medium text-charcoal">
            {stop.activity.name}
          </span>
        </div>
        <span className="shrink-0 text-xs font-mono text-clay">
          {stop.start}–{stop.end}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-xs text-clay">
        <span>{transitLabel(stop)}</span>
        {cost > 0 && (
          <span>
            {stop.activity.estimated && <span className="text-amber">~</span>}
            {formatMoney(cost)}
          </span>
        )}
        <span className="text-clay-light">running: {formatMoney(runningTotal)}</span>
      </div>
    </div>
  );
}

function CategoryIcon({ category }: { category: string }) {
  const icons: Record<string, string> = {
    waterfall: "💧",
    cave: "🕳️",
    viewpoint: "👁️",
    peak: "⛰️",
    monument: "🏛️",
    temple: "🛕",
    museum: "🏛️",
    market: "🏪",
    beach: "🏖️",
    lake: "🌊",
    garden: "🌿",
    bridge: "🌉",
    forest: "🌲",
  };
  const emoji = icons[category] || "📍";
  return <span className="text-xs" title={category}>{emoji}</span>;
}

function CritiqueSection({ critique, revisionsUsed }: { critique: CritiqueResult; revisionsUsed: number }) {
  return (
    <div className="rounded-xl border border-sand-dark bg-sand/50 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-charcoal">Quality review</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          critique.verdict === "pass" ? "bg-moss/10 text-moss" :
          critique.verdict === "infeasible" ? "bg-terracotta/10 text-terracotta" :
          "bg-amber/10 text-amber"
        }`}>
          {critique.verdict}
        </span>
      </div>
      {revisionsUsed > 0 && (
        <p className="mt-2 text-xs text-clay">Plan refined through {revisionsUsed} revision round{revisionsUsed > 1 ? "s" : ""}</p>
      )}
      {critique.hard_failures.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {critique.hard_failures.map((f, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-terracotta">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-terracotta/50" />
              <span><span className="font-mono">[{f.code}]</span> {f.message}</span>
            </p>
          ))}
        </div>
      )}
      {critique.soft_notes.length > 0 && (
        <div className="mt-3 space-y-1">
          {critique.soft_notes.map((n, i) => (
            <p key={i} className="text-xs text-clay">{n}</p>
          ))}
        </div>
      )}
      {critique.suggested_fixes.length > 0 && (
        <div className="mt-3 space-y-1">
          {critique.suggested_fixes.map((s, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-moss">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-moss/50" />
              {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
