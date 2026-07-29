import { describe, expect, it } from "vitest";
import { combineBestMonths, pickProvisionalDates } from "./dates.js";

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
