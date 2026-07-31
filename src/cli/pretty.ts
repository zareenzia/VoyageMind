import type { CritiqueResult, Itinerary, ScheduledStop } from "../schemas/index.js";

const money = (usd: number) => `$${usd.toFixed(2)}`;

// Mirrors computeTotalUsd's components (src/checks/feasibility.ts) so the last
// "running total" printed always matches itinerary.estimated_total_usd exactly.
function formatStop(stop: ScheduledStop, travellerCount: number, runningTotal: number): string {
  const transit =
    stop.transit_minutes_from_previous > 0
      ? `${stop.transit_minutes_from_previous} min transit (${stop.transit_source})`
      : "first stop";
  const cost = stop.activity.cost_usd_per_person * travellerCount;
  return (
    `    ${stop.start}-${stop.end}  ${stop.activity.name}\n` +
    `        ${transit} | ${money(cost)} | running total: ${money(runningTotal)}`
  );
}

/** Plain-text rendering of an Itinerary for CLI debugging — see --pretty in src/index.ts. */
export function formatItineraryPretty(
  itinerary: Itinerary,
  critique: CritiqueResult,
  travellerCount: number,
  revisionsUsed: number,
): string {
  const lines: string[] = [itinerary.brief_summary, ""];
  let runningTotal = 0;

  itinerary.days.forEach((day, i) => {
    const dateLabel = itinerary.dates_provisional ? `${day.date} (provisional)` : day.date;
    lines.push(`Day ${i + 1} — ${dateLabel} — ${day.base_city}`);
    for (const stop of day.stops) {
      runningTotal += stop.activity.cost_usd_per_person * travellerCount;
      lines.push(formatStop(stop, travellerCount, runningTotal));
    }
    if (day.lodging_cost_usd !== null) {
      runningTotal += day.lodging_cost_usd;
      lines.push(`    Lodging: ${money(day.lodging_cost_usd)} | running total: ${money(runningTotal)}`);
    } else {
      lines.push("    Lodging: not priced yet");
    }
    if (day.notes) lines.push(`    Note: ${day.notes}`);
    lines.push("");
  });

  if (itinerary.flights_cost_usd !== null) {
    runningTotal += itinerary.flights_cost_usd;
    lines.push(`Flights: ${money(itinerary.flights_cost_usd)}`);
  }
  lines.push(
    `Estimated total: ${money(itinerary.estimated_total_usd)}` +
      (itinerary.estimated_total_complete ? "" : " (partial — some costs not priced yet)"),
  );
  lines.push("");

  lines.push(`Critic verdict: ${critique.verdict} (${revisionsUsed} revision round(s) used)`);
  if (critique.hard_failures.length > 0) {
    lines.push("Hard failures:");
    for (const f of critique.hard_failures) lines.push(`  - [${f.code}] ${f.message}`);
  }
  if (critique.soft_notes.length > 0) {
    lines.push("Notes:");
    for (const n of critique.soft_notes) lines.push(`  - ${n}`);
  }
  if (critique.suggested_fixes.length > 0) {
    lines.push("Suggested fixes:");
    for (const s of critique.suggested_fixes) lines.push(`  - ${s}`);
  }

  return lines.join("\n");
}
