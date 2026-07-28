import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { LIMITS } from "../config.js";

export class AgentValidationError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = "AgentValidationError";
  }
}

export interface RunOptions<T extends z.ZodTypeAny> {
  /** Agent name, used in logs and cost tracking. */
  name: string;
  systemPrompt: string;
  prompt: string;
  schema: T;
  model: string;
  /** Default [] — most agents in this pipeline need no tools. */
  allowedTools?: string[];
  /**
   * Runs once schema validation has already passed. Return a message describing
   * the problem to reject the output and retry — fed back to the model exactly
   * like a schema failure, against the same maxSchemaRetries cap — or return null
   * to accept. For business rules a Zod shape can't express, e.g. "every id in
   * this array must reference something you were given."
   */
  validate?: (data: z.infer<T>) => string | null;
}

/**
 * Runs one agent turn and returns validated, typed output.
 *
 * Every agent in this project goes through here. That guarantees:
 *   - JSON-only output enforced by system prompt AND by parse
 *   - schema validation at the boundary (CLAUDE.md rule 1)
 *   - a capped retry that feeds the validation error back to the model
 */
export async function runAgent<T extends z.ZodTypeAny>(
  opts: RunOptions<T>,
): Promise<z.infer<T>> {
  // Generate the contract from the schema itself so the prompt can never drift
  // out of sync with src/schemas/. `io: "input"` describes what the model must
  // send, before Zod applies defaults.
  const jsonSchema = z.toJSONSchema(opts.schema, { io: "input" });

  const systemPrompt =
    `${opts.systemPrompt}\n\n` +
    `## Required output schema\n\n` +
    `Your response must be a single JSON object valid against this JSON Schema:\n\n` +
    `${JSON.stringify(jsonSchema, null, 2)}\n\n` +
    `Every property is required. Use null for unknown values where the schema permits ` +
    `null, and [] for unknown arrays. Never use an empty string "" to mean "unknown". ` +
    `Do not add properties that are not in the schema. Do not rename or restructure ` +
    `properties. Output the JSON object only — no prose, no markdown fences.`;

  let prompt = opts.prompt;
  let lastError: AgentValidationError | undefined;

  for (let attempt = 0; attempt <= LIMITS.maxSchemaRetries; attempt++) {
    const raw = await collectText({
      systemPrompt,
      prompt,
      model: opts.model,
      allowedTools: opts.allowedTools ?? [],
    });

    const json = extractJson(raw);
    const parsed = opts.schema.safeParse(json);

    if (parsed.success) {
      const problem = opts.validate?.(parsed.data) ?? null;
      if (!problem) return parsed.data;

      lastError = new AgentValidationError(
        `[${opts.name}] output failed validation (attempt ${attempt + 1}): ${problem}`,
        raw,
        null,
      );
      prompt =
        `${opts.prompt}\n\n` +
        `Your previous response failed validation:\n\n${problem}\n\n` +
        `Fix exactly this and return the corrected JSON object only.`;
      continue;
    }

    lastError = new AgentValidationError(
      `[${opts.name}] output failed schema validation (attempt ${attempt + 1}):\n` +
        z.prettifyError(parsed.error),
      raw,
      parsed.error.issues,
    );

    // Feed the failure back rather than blindly re-rolling.
    prompt =
      `${opts.prompt}\n\n` +
      `Your previous response failed schema validation:\n\n` +
      `${z.prettifyError(parsed.error)}\n\n` +
      `Fix exactly these problems and return the corrected JSON object only.`;
  }

  throw lastError;
}

async function collectText(args: {
  systemPrompt: string;
  prompt: string;
  model: string;
  allowedTools: string[];
}): Promise<string> {
  let text = "";

  for await (const message of query({
    prompt: args.prompt,
    options: {
      systemPrompt: args.systemPrompt,
      model: args.model,
      allowedTools: args.allowedTools,
      // Do not inherit ~/.claude or project settings — agents in production must be
      // reproducible and must not pick up a developer's local config.
      settingSources: [],
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") text += block.text;
      }
    }
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error(`Agent run ended with: ${message.subtype}`);
    }
  }

  return text;
}

/** Models sometimes wrap JSON in fences or add a preamble despite instructions. */
function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new AgentValidationError("No JSON object found in response", raw, null);
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}
