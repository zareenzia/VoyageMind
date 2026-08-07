/**
 * Deliberate model routing. Cheap+fast for extraction and lookup, reasoning model
 * for planning and critique. Changing these is a cost decision — measure before you do.
 *
 * Verify current model IDs at https://docs.claude.com/en/docs/about-claude/models
 */
export const MODELS = {
  /** Intake, Research, Pricing — extraction and lookup, low judgement. */
  fast: process.env.MODEL_FAST ?? "claude-haiku-4-5-20251001",
  /** Itinerary, Critic — sequencing and judgement. */
  reasoning: process.env.MODEL_REASONING ?? "claude-sonnet-5",
} as const;

export const LIMITS = {
  /** Hard cap on Critic -> Itinerary revision rounds. Never model-decided. */
  maxRevisionRounds: 2,
  /** Retries when an agent returns output that fails schema validation. */
  maxSchemaRetries: 2,
  /** Parallel Research agents. Raise carefully — this is your main cost multiplier. */
  maxParallelResearch: 4,
  /** Retries for a tool call hitting a transient upstream failure (429/5xx). */
  maxToolRetries: 3,
  /** Max PlaceCandidates handed to the Guide agent per destination, sorted by
   * prominence and truncated from the bottom. A whole-region query can return
   * dozens of named places (Sohra alone returned 88) — passing all of them with
   * full tags is context the fast model doesn't need to do its job well. */
  candidatesPerDestination: 40,
  /** Retain finished run events for SSE replay before evicting from memory. */
  runRetentionMinutes: 10,
  /** A non-terminal run with no event for this long is abandoned: the sweep
   * emits a retryable run_failed so the client gets a real terminal state
   * instead of an open stream. 5 min is comfortably above the longest
   * realistic stage gap (~3 min for the Critic). */
  runAbandonedMinutes: 5,
  /** Hard-stop in-memory run retention, even if terminal event never arrived.
   * Safety net only — the abandoned sweep should fire first. */
  runAbsoluteMaxMinutes: 30,
  /** Failed logins allowed per email inside loginAttemptWindowMinutes before
   * the address is refused outright. Rule 4 applies to an attacker's loop the
   * same as to ours. Counted per email rather than per IP: an IP is shared by
   * everyone behind a NAT and trivially rotated by an attacker, so it locks out
   * the wrong people and stops the wrong ones. */
  maxLoginAttempts: 10,
  /** Sliding window for maxLoginAttempts. */
  loginAttemptWindowMinutes: 15,
  /** How long a session cookie stays valid. Absolute, not sliding: a session is
   * not extended by use, so a stolen cookie has a bounded life no matter how
   * actively it is used. */
  sessionLifetimeDays: 30,
  /** Longest accepted trip title. A label, not a document — and an unbounded
   * user-supplied string on a row anyone can create is a storage-growth
   * primitive. */
  maxTripTitleLength: 120,
  /** Minimum password length accepted at signup. Length is the only rule —
   * composition rules ("one symbol, one digit") measurably push people toward
   * shorter, more predictable passwords, which is the opposite of the goal. */
  minPasswordLength: 10,
} as const;
