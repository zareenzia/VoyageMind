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

import type { DateExpression } from "../schemas/index.js";

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 0=Sunday..6=Saturday (JS Date.getUTCDay()) — MUST match the convention
 * checks/feasibility.ts uses for closed_days, or a weekday-dependent check
 * there would silently disagree with a date resolved here.
 */
function todayWeekday(today: string): number {
  return new Date(`${today}T00:00:00Z`).getUTCDay();
}

/**
 * "this"/"bare": soonest occurrence — today counts if today already is that
 * weekday. "next": soonest occurrence, then +7 more days if that occurrence
 * falls within the calendar week (Sun-Sat) containing today — i.e. "next
 * Friday" said on a Monday means the Friday of the FOLLOWING week, not the
 * one three days away. This is a documented convention, not a claim that it
 * matches every English speaker's intuition (the phrase is genuinely
 * ambiguous) — which is exactly why qualifier "next" also produces an
 * open_question stating the assumption.
 */
function resolveNextWeekday(
  today: string,
  weekday: number,
  qualifier: "this" | "next" | "bare",
): { date: string; openQuestion: string | null } {
  const current = todayWeekday(today);
  const daysToSoonest = (weekday - current + 7) % 7;
  const soonest = addDays(today, daysToSoonest);

  if (qualifier !== "next") return { date: soonest, openQuestion: null };

  const soonestIsWithinCurrentWeek = current + daysToSoonest <= 6;
  if (!soonestIsWithinCurrentWeek) return { date: soonest, openQuestion: null };

  const weekLater = addDays(soonest, 7);
  const name = WEEKDAY_NAMES[weekday];
  return {
    date: weekLater,
    openQuestion:
      `Interpreted "next ${name}" as ${weekLater} (the ${name} of the following week) rather ` +
      `than the sooner ${soonest} — confirm this is what was meant.`,
  };
}

export interface DateResolution {
  start_date: string | null;
  /** Only set for an ambiguous "next <weekday>" — see resolveNextWeekday. */
  open_question: string | null;
}

/**
 * The only place a DateExpression becomes a real date. month_only and
 * flexible_window deliberately resolve to null here, not a guessed day —
 * the day-within-month is inherently unknown either way, so resolving it now
 * would falsely mark the result as non-provisional later. The Itinerary agent
 * resolves those two kinds itself, via pickProvisionalDates, where the user's
 * stated month(s) can be weighed against (and checked for conflict with) the
 * destination's actual best_months.
 */
export function resolveDateExpression(expression: DateExpression, today: string): DateResolution {
  if (expression === null) return { start_date: null, open_question: null };

  if (expression.kind === "explicit") {
    return { start_date: expression.date, open_question: null };
  }

  if (expression.kind === "next_weekday") {
    const { date, openQuestion } = resolveNextWeekday(today, expression.weekday, expression.qualifier);
    return { start_date: date, open_question: openQuestion };
  }

  return { start_date: null, open_question: null }; // month_only / flexible_window
}

const PART_OF_MONTH_DAY: Record<"early" | "mid" | "late", number> = {
  early: 5,
  mid: 15,
  late: 25,
};

/**
 * Picks a start/end date when brief.start_date is null, informed by which
 * months are actually good for the trip (see combineBestMonths, or the user's
 * own stated month(s) via date_expression — see resolveDateExpression) rather
 * than an arbitrary "next month" — "next month" is wrong in a way that's easy
 * to miss: right now, for this project's own headline example, next month is
 * peak monsoon for Sohra, Meghalaya, which best_months is specifically
 * supposed to steer away from.
 *
 * Scans forward from the CURRENT month, not the next one — if today already
 * falls in a qualifying month, the answer is today (or the requested part of
 * that month, if it hasn't passed yet), with no artificial delay. If
 * bestMonths is empty (no signal at all), every month qualifies, which
 * reduces to the same "start now" behaviour rather than a second special case.
 *
 * `partOfMonth` ("early"/"mid"/"late" -> day 5/15/25) comes from a month_only
 * date_expression — e.g. "mid September" must not collapse to September 1st,
 * a two-week error the user was specifically trying to avoid by saying "mid".
 * If the resulting date has already passed this occurrence of the month
 * (today is past the requested day), the scan continues to the next
 * qualifying month rather than returning a date in the past.
 */
export function pickProvisionalDates(
  today: string,
  nights: number,
  bestMonths: number[],
  partOfMonth?: "early" | "mid" | "late",
): { start_date: string; end_date: string } {
  const effectiveMonths = bestMonths.length > 0 ? bestMonths : [...ALL_MONTHS];
  const [year, month] = today.split("-").map(Number) as [number, number, number];
  const dayOfMonth = partOfMonth ? PART_OF_MONTH_DAY[partOfMonth] : null;

  // Scan up to 24 months: a specific day-of-month can push a candidate that
  // would otherwise qualify into the past, requiring one more lap of the year.
  for (let offset = 0; offset < 24; offset++) {
    const zeroIndexed = month - 1 + offset;
    const candidateMonth = (zeroIndexed % 12) + 1;
    if (!effectiveMonths.includes(candidateMonth)) continue;

    const candidateYear = year + Math.floor(zeroIndexed / 12);
    const candidateDate =
      dayOfMonth !== null
        ? `${candidateYear}-${String(candidateMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`
        : offset === 0
          ? today
          : `${candidateYear}-${String(candidateMonth).padStart(2, "0")}-01`;

    // ISO dates compare correctly as plain strings.
    if (candidateDate >= today) {
      return { start_date: candidateDate, end_date: addDays(candidateDate, nights) };
    }
  }

  return { start_date: today, end_date: addDays(today, nights) }; // unreachable in practice
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
