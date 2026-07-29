/**
 * Date CONSTRUCTION, deliberately kept out of checks/feasibility.ts — that file
 * is the validation layer ("is this plan sound"). This one produces values;
 * mixing the two means the file that gates the pipeline starts manufacturing the
 * inputs it later checks, which is exactly the kind of coupling that gets
 * confusing at the worst moment.
 *
 * No network, no I/O — pure date arithmetic. Lives in tools/ anyway: it's a
 * utility module the Itinerary agent's surrounding code calls, not a check.
 */

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Picks a start/end date when brief.start_date is null, informed by which
 * months are actually good for the trip (see combineBestMonths) rather than an
 * arbitrary "next month" — "next month" is wrong in a way that's easy to miss:
 * right now, for this project's own headline example, next month is peak
 * monsoon for Sohra, Meghalaya, which best_months is specifically supposed to
 * steer away from.
 *
 * Scans forward from the CURRENT month, not the next one — if today already
 * falls in a qualifying month, the answer is today, with no artificial delay.
 * If bestMonths is empty (no signal at all), every month qualifies, which
 * reduces to the same "start now" behaviour rather than a second special case.
 */
export function pickProvisionalDates(
  today: string,
  nights: number,
  bestMonths: number[],
): { start_date: string; end_date: string } {
  const effectiveMonths = bestMonths.length > 0 ? bestMonths : [...ALL_MONTHS];
  const [year, month] = today.split("-").map(Number) as [number, number, number];

  let startDate = today;
  for (let offset = 0; offset < 12; offset++) {
    const zeroIndexed = month - 1 + offset;
    const candidateMonth = (zeroIndexed % 12) + 1;
    if (effectiveMonths.includes(candidateMonth)) {
      if (offset > 0) {
        const candidateYear = year + Math.floor(zeroIndexed / 12);
        startDate = `${candidateYear}-${String(candidateMonth).padStart(2, "0")}-01`;
      }
      break;
    }
  }

  return { start_date: startDate, end_date: addDays(startDate, nights) };
}

export interface CombinedBestMonths {
  months: number[];
  /** Set only when destinations share no common good month at all — see the
   * union fallback below. Surfaced as Itinerary.construction_notes. */
  note: string | null;
}

/**
 * A multi-destination trip (Barcelona then Lisbon) may have destinations whose
 * best_months disagree. Rule: intersect first — a month good for everywhere
 * beats a month good for only one stop. If the intersection is empty, union
 * instead (some months are at least good for part of the trip) and say so,
 * rather than silently defaulting to the first destination's months.
 */
export function combineBestMonths(destinations: { best_months: number[] }[]): CombinedBestMonths {
  if (destinations.length === 0) return { months: [...ALL_MONTHS], note: null };
  if (destinations.length === 1) return { months: destinations[0]!.best_months, note: null };

  const sets = destinations.map((d) => new Set(d.best_months));
  const intersection = [...sets[0]!].filter((m) => sets.every((s) => s.has(m))).sort((a, b) => a - b);
  if (intersection.length > 0) return { months: intersection, note: null };

  const union = [...new Set(destinations.flatMap((d) => d.best_months))].sort((a, b) => a - b);
  return {
    months: union,
    note:
      "These destinations share no common best_months — the months shown are the union of " +
      "each destination's individually, not a window that suits all of them equally.",
  };
}
