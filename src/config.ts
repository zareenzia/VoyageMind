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
} as const;
