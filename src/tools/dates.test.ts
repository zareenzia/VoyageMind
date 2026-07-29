import { describe, expect, it } from "vitest";
import { combineBestMonths, pickProvisionalDates, resolveDateExpression } from "./dates.js";

describe("pickProvisionalDates", () => {
  it("starts today when today's month already qualifies", () => {
    // 2026-07-29 -> month 7
    const result = pickProvisionalDates("2026-07-29", 3, [6, 7, 8]);
    expect(result.start_date).toBe("2026-07-29");
    expect(result.end_date).toBe("2026-08-01");
  });

  it("scans forward to the soonest qualifying month, skipping the wrong one", () => {
    // Today is July (peak monsoon for Sohra) — best_months excludes 6,7,8,9.
    // Soonest qualifying month is October.
    const result = pickProvisionalDates("2026-07-29", 3, [10, 11, 12, 1, 2, 3]);
    expect(result.start_date).toBe("2026-10-01");
    expect(result.end_date).toBe("2026-10-04");
  });

  it("wraps across a year boundary", () => {
    // Today is November; only January qualifies -> next calendar year.
    const result = pickProvisionalDates("2026-11-15", 2, [1]);
    expect(result.start_date).toBe("2027-01-01");
  });

  it("falls back to 'start now' when no best_months signal exists at all", () => {
    const result = pickProvisionalDates("2026-07-29", 3, []);
    expect(result.start_date).toBe("2026-07-29");
  });

  it("computes end_date as start_date + nights, regardless of month", () => {
    const result = pickProvisionalDates("2026-01-05", 6, [1]);
    expect(result.start_date).toBe("2026-01-05");
    expect(result.end_date).toBe("2026-01-11");
  });

  it("maps partOfMonth to day 5/15/25, not day 1 — 'mid September' must not collapse to Sept 1st", () => {
    const early = pickProvisionalDates("2026-07-29", 3, [9], "early");
    const mid = pickProvisionalDates("2026-07-29", 3, [9], "mid");
    const late = pickProvisionalDates("2026-07-29", 3, [9], "late");
    expect(early.start_date).toBe("2026-09-05");
    expect(mid.start_date).toBe("2026-09-15");
    expect(late.start_date).toBe("2026-09-25");
  });

  it("rolls forward a year when the requested part-of-month has already passed", () => {
    // Today is deep into September — "mid September" (the 15th) is already
    // behind us, so it must resolve to next year's mid-September, not the past.
    const result = pickProvisionalDates("2026-09-20", 3, [9], "mid");
    expect(result.start_date).toBe("2027-09-15");
  });

  it("does not roll forward when the requested part-of-month is still ahead this occurrence", () => {
    const result = pickProvisionalDates("2026-09-01", 3, [9], "mid");
    expect(result.start_date).toBe("2026-09-15");
  });
});

describe("resolveDateExpression", () => {
  const today = "2026-07-27"; // a Monday

  it("returns null with no open_question for a null expression", () => {
    expect(resolveDateExpression(null, today)).toEqual({ start_date: null, open_question: null });
  });

  it("passes an explicit date through unchanged", () => {
    const result = resolveDateExpression({ kind: "explicit", date: "2026-12-10" }, today);
    expect(result).toEqual({ start_date: "2026-12-10", open_question: null });
  });

  it("resolves 'this Saturday' to the soonest Saturday, no open_question", () => {
    const result = resolveDateExpression({ kind: "next_weekday", weekday: 6, qualifier: "this" }, today);
    expect(result).toEqual({ start_date: "2026-08-01", open_question: null });
  });

  it("resolves a bare weekday the same as 'this'", () => {
    const result = resolveDateExpression({ kind: "next_weekday", weekday: 6, qualifier: "bare" }, today);
    expect(result.start_date).toBe("2026-08-01");
    expect(result.open_question).toBeNull();
  });

  it("resolves 'next Saturday' to a week after the soonest occurrence, with an open_question", () => {
    // Monday 2026-07-27: soonest Saturday (2026-08-01) falls within the current
    // Sun-Sat week, so "next" pushes one week further per the documented convention.
    const result = resolveDateExpression({ kind: "next_weekday", weekday: 6, qualifier: "next" }, today);
    expect(result.start_date).toBe("2026-08-08");
    expect(result.open_question).toContain("next Saturday");
    expect(result.open_question).toContain("2026-08-08");
    expect(result.open_question).toContain("2026-08-01");
  });

  it("'next' agrees with 'this' (no open_question) when the soonest occurrence is already in a following week", () => {
    // Friday 2026-07-31: soonest Sunday is 2026-08-02, already past this week's
    // boundary, so "next Sunday" isn't ambiguous — it just means that Sunday.
    const friday = "2026-07-31";
    const result = resolveDateExpression({ kind: "next_weekday", weekday: 0, qualifier: "next" }, friday);
    expect(result.start_date).toBe("2026-08-02");
    expect(result.open_question).toBeNull();
  });

  it("leaves start_date null for month_only — the Itinerary stage resolves it with best_months awareness", () => {
    const result = resolveDateExpression({ kind: "month_only", month: 12, year: null, part_of_month: null }, today);
    expect(result).toEqual({ start_date: null, open_question: null });
  });

  it("leaves start_date null for flexible_window for the same reason", () => {
    const result = resolveDateExpression({ kind: "flexible_window", months: [3, 4, 5] }, today);
    expect(result).toEqual({ start_date: null, open_question: null });
  });
});

describe("combineBestMonths", () => {
  it("returns the single destination's months unchanged when there's only one", () => {
    const result = combineBestMonths([{ best_months: [10, 11, 12] }]);
    expect(result).toEqual({ months: [10, 11, 12], note: null });
  });

  it("intersects when destinations share some good months", () => {
    const result = combineBestMonths([
      { best_months: [10, 11, 12, 1, 2, 3] }, // Meghalaya-like
      { best_months: [3, 4, 5, 10, 11] }, // hypothetical second stop
    ]);
    expect(result.months).toEqual([3, 10, 11]);
    expect(result.note).toBeNull();
  });

  it("unions with a note when destinations share no common good month at all", () => {
    const result = combineBestMonths([
      { best_months: [12, 1, 2] },
      { best_months: [6, 7, 8] },
    ]);
    expect(result.months).toEqual([1, 2, 6, 7, 8, 12]);
    expect(result.note).not.toBeNull();
    expect(result.note).toContain("no common");
  });

  it("returns all months with no note when there are no destinations at all", () => {
    const result = combineBestMonths([]);
    expect(result.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.note).toBeNull();
  });
});
