import { MODELS } from "../config.js";
import { TripBriefSchema, type TripBrief } from "../schemas/index.js";
import { runAgent } from "./run.js";

const SYSTEM_PROMPT = `You are the Intake agent in a travel planning pipeline.

Your only job is to convert a free-text travel request into a structured TripBrief.
You do not plan, recommend, or research. Downstream agents do that.

RULES

1. Extract only what the user actually said or clearly implied. Never invent a
   destination, date, or budget. If it was not stated, the field is null (or an empty
   array), and you add a line to open_questions.

2. Reasonable inference IS allowed where it is unambiguous:
   - "next weekend" with today's date given -> concrete dates
   - "me and my wife" -> 2 adults
   - "around two grand" -> 2000
   Anything requiring a guess about preference is NOT inference. Put it in open_questions.

3. pace: infer from language. "see everything", "cram it in" -> packed.
   "chill", "beach and books" -> relaxed. Default to moderate when unclear.

4. budget_includes_flights: true only if the user indicates the figure is all-in.
   Default false and flag it in open_questions if a budget was given but unclear.

5. Flag genuine blockers in open_questions, not trivia. Missing origin airport,
   an impossible date range, or a budget that cannot cover the stated trip are
   blockers. Not knowing which museum they prefer is not.

OUTPUT

Return a single JSON object matching the TripBrief schema. No markdown, no code
fences, no explanation before or after. JSON only.`;

export interface IntakeInput {
  request: string;
  /** Passed explicitly so relative dates resolve deterministically in evals. */
  today: string;
  /** Optional, e.g. "user's passport: Bangladesh" — affects visa_constraints. */
  knownContext?: string;
}

export async function runIntake(input: IntakeInput): Promise<TripBrief> {
  const prompt = [
    `Today's date is ${input.today}.`,
    input.knownContext ? `Known context: ${input.knownContext}` : null,
    ``,
    `Travel request:`,
    `"""`,
    input.request,
    `"""`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return runAgent({
    name: "intake",
    systemPrompt: SYSTEM_PROMPT,
    prompt,
    schema: TripBriefSchema,
    model: MODELS.fast,
    allowedTools: [],
  });
}
