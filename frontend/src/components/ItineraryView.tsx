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
      <p className="text-sm text-gray-700">{itinerary.brief_summary}</p>

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
            <p className="mt-2 text-xs text-gray-500">
              Lodging: {formatMoney(day.lodging_cost_usd)}
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-400 italic">Lodging: not priced yet</p>
          )}
          {day.notes && <p className="mt-1 text-xs text-gray-500 italic">{day.notes}</p>}
        </DayCard>
      ))}

      <div className="border-t border-gray-200 pt-4">
        {itinerary.flights_cost_usd !== null && (
          <p className="text-sm text-gray-700">Flights: {formatMoney(itinerary.flights_cost_usd)}</p>
        )}
        <p className="text-sm font-medium text-gray-900">Estimated total: {totalLabel(itinerary)}</p>
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
    <div className="rounded-md border border-gray-200 p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-800">
        Day {dayNumber} — {dateLabel(day, provisional)} — {day.base_city}
      </h3>
      <div className="space-y-2">{children}</div>
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
  return (
    <div className="border-l-2 border-blue-200 pl-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-800">
          {stop.start}–{stop.end} {stop.activity.name}
        </span>
      </div>
      <div className="mt-0.5 flex gap-3 text-xs text-gray-500">
        <span>{transitLabel(stop)}</span>
        <span>{formatMoney(cost)}</span>
        <span>total: {formatMoney(runningTotal)}</span>
      </div>
    </div>
  );
}

function CritiqueSection({ critique, revisionsUsed }: { critique: CritiqueResult; revisionsUsed: number }) {
  return (
    <div className="space-y-2 border-t border-gray-200 pt-4">
      <p className="text-sm font-medium text-gray-800">
        Critic verdict: {critique.verdict} ({revisionsUsed} revision round(s) used)
      </p>
      {critique.hard_failures.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-700">Hard failures:</p>
          <ul className="ml-4 list-disc text-xs text-red-600">
            {critique.hard_failures.map((f, i) => (
              <li key={i}>[{f.code}] {f.message}</li>
            ))}
          </ul>
        </div>
      )}
      {critique.soft_notes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600">Notes:</p>
          <ul className="ml-4 list-disc text-xs text-gray-500">
            {critique.soft_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {critique.suggested_fixes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600">Suggested fixes:</p>
          <ul className="ml-4 list-disc text-xs text-gray-500">
            {critique.suggested_fixes.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
