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
} as const;
