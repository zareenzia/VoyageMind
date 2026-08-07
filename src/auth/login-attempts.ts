import { LIMITS } from "../config.js";

/**
 * The rule-4 cap on an attacker's loop: `LIMITS.maxLoginAttempts` failures per
 * email inside a sliding `LIMITS.loginAttemptWindowMinutes` window.
 *
 * In-process, not in Postgres, and that is a real limitation with a real
 * boundary. It costs nothing on the hot path and needs no write per failed
 * login, but it resets when the server restarts and it does not aggregate
 * across instances. Rule 7 (monolith until Phase 3) means there is exactly one
 * instance, and an attacker cannot restart it — so the weakness is bounded by
 * something already true of the deployment rather than by luck. Moving this to
 * a table is the right change at the same time as a second instance, not before.
 *
 * Keyed by email rather than IP: an IP is shared by everyone behind a NAT, so
 * blocking it locks out uninvolved people, and it is trivially rotated by the
 * attacker it is meant to stop.
 */
export class LoginAttemptTracker {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number = LIMITS.maxLoginAttempts,
    private readonly windowMs: number = LIMITS.loginAttemptWindowMinutes * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isBlocked(email: string): boolean {
    return this.recent(email).length >= this.max;
  }

  recordFailure(email: string): void {
    const recent = this.recent(email);
    recent.push(this.now());
    this.failures.set(email, recent);
  }

  /** Called on a successful login: the window is about failed attempts, and
   * leaving it populated would penalise someone who mistyped twice and then
   * got it right. */
  clear(email: string): void {
    this.failures.delete(email);
  }

  /** Timestamps still inside the window, with the expired ones dropped. Pruning
   * on read is what keeps the map from growing without bound — every entry is
   * either touched again (and pruned) or swept. */
  private recent(email: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.failures.get(email) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) this.failures.delete(email);
    else this.failures.set(email, kept);
    return kept;
  }

  /** Drops every email whose window has fully expired. Called from the server's
   * periodic sweep so addresses attacked once and abandoned don't accumulate. */
  sweep(): number {
    let removed = 0;
    for (const email of [...this.failures.keys()]) {
      if (this.recent(email).length === 0) removed++;
    }
    return removed;
  }
}
