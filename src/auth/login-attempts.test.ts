import { describe, expect, it } from "vitest";
import { LoginAttemptTracker } from "./login-attempts.js";

/** A controllable clock — the window is a time rule, and testing it against a
 * real one would mean either sleeping or asserting nothing. */
function trackerAt(start: number, max = 3, windowMs = 60_000) {
  let now = start;
  const tracker = new LoginAttemptTracker(max, windowMs, () => now);
  return { tracker, advance: (ms: number) => (now += ms) };
}

describe("LoginAttemptTracker", () => {
  it("allows attempts below the cap and blocks at it", () => {
    const { tracker } = trackerAt(1_000, 3);

    expect(tracker.isBlocked("a@example.test")).toBe(false);
    tracker.recordFailure("a@example.test");
    tracker.recordFailure("a@example.test");
    expect(tracker.isBlocked("a@example.test")).toBe(false);

    tracker.recordFailure("a@example.test");
    expect(tracker.isBlocked("a@example.test")).toBe(true);
  });

  it("blocks one email without blocking another", () => {
    const { tracker } = trackerAt(1_000, 2);
    tracker.recordFailure("a@example.test");
    tracker.recordFailure("a@example.test");

    expect(tracker.isBlocked("a@example.test")).toBe(true);
    expect(tracker.isBlocked("b@example.test")).toBe(false);
  });

  it("slides: failures outside the window stop counting", () => {
    const { tracker, advance } = trackerAt(1_000, 3, 60_000);
    tracker.recordFailure("a@example.test");
    tracker.recordFailure("a@example.test");
    tracker.recordFailure("a@example.test");
    expect(tracker.isBlocked("a@example.test")).toBe(true);

    advance(60_001);
    expect(tracker.isBlocked("a@example.test")).toBe(false);
  });

  it("slides partially rather than resetting wholesale", () => {
    const { tracker, advance } = trackerAt(1_000, 3, 60_000);
    tracker.recordFailure("a@example.test"); // t=1000
    advance(30_000);
    tracker.recordFailure("a@example.test"); // t=31000
    tracker.recordFailure("a@example.test"); // t=31000
    expect(tracker.isBlocked("a@example.test")).toBe(true);

    // The first failure ages out; the two at t=31000 do not.
    advance(30_001);
    expect(tracker.isBlocked("a@example.test")).toBe(false);
    tracker.recordFailure("a@example.test");
    expect(tracker.isBlocked("a@example.test")).toBe(true);
  });

  /** Someone who mistypes twice and then gets it right should not be carrying
   * a nearly-full window into their next login. */
  it("clears the window on a successful login", () => {
    const { tracker } = trackerAt(1_000, 3);
    tracker.recordFailure("a@example.test");
    tracker.recordFailure("a@example.test");

    tracker.clear("a@example.test");

    tracker.recordFailure("a@example.test");
    tracker.recordFailure("a@example.test");
    expect(tracker.isBlocked("a@example.test")).toBe(false);
  });

  /** The map is keyed by attacker-supplied strings, so it has to shed entries
   * or a login endpoint becomes a memory-growth primitive. */
  it("sweeps addresses whose windows have fully expired", () => {
    const { tracker, advance } = trackerAt(1_000, 3, 60_000);
    tracker.recordFailure("a@example.test");
    tracker.recordFailure("b@example.test");

    expect(tracker.sweep()).toBe(0);

    advance(60_001);
    expect(tracker.sweep()).toBe(2);
    expect(tracker.sweep()).toBe(0);
  });
});
