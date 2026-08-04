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
  return runAgentWith(collectText, opts);
}

/** How runAgent talks to the model. One implementation in production: collectText. */
export type Collect = (args: {
  systemPrompt: string;
  prompt: string;
  model: string;
  allowedTools: string[];
}) => Promise<string>;

/**
 * runAgent with the transport injected, so the retry loop is testable without a
 * network call or a live auth session.
 *
 * Deliberately a separate export rather than an optional field on RunOptions:
 * this function is the shared spine of all five agents, and a test-only option
 * on that type would be visible forever to anyone adding the sixth, who would
 * have to work out whether they were meant to pass it. Production calls
 * runAgent; only tests call this.
 */
export async function runAgentWith<T extends z.ZodTypeAny>(
  collect: Collect,
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
    const raw = await collect({
      systemPrompt,
      prompt,
      model: opts.model,
      allowedTools: opts.allowedTools ?? [],
    });

    const extracted = tryExtractJson(raw);
    if (!extracted.ok) {
      if (extracted.kind === "truncated") {
        // Logged so the question "is the retry masking a prose budget that's too
        // large?" is answerable from data rather than argued from first
        // principles. If one agent shows up here repeatedly, the fix is a
        // shorter output, not a bigger retry cap.
        console.warn(
          `[${opts.name}] response appears truncated on attempt ${attempt + 1} ` +
            `(${raw.length} chars): ${extracted.detail}`,
        );
      }

      lastError = new AgentValidationError(
        `[${opts.name}] output was not valid JSON (attempt ${attempt + 1}, ${extracted.kind}): ${extracted.detail}`,
        raw,
        null,
      );
      prompt = `${opts.prompt}\n\n${parseFeedback(extracted)}`;
      continue;
    }

    const parsed = opts.schema.safeParse(extracted.value);

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

  // Defensive: every failing path above sets lastError, but `throw undefined`
  // would be an unreadable way to find out that one didn't.
  throw (
    lastError ??
    new AgentValidationError(
      `[${opts.name}] exhausted ${LIMITS.maxSchemaRetries + 1} attempts without a usable response`,
      "",
      null,
    )
  );
}

/**
 * What to tell the model, by failure kind. A truncated response and an unescaped
 * quote need different corrections, and neither is a schema mismatch — sending
 * the schema-mismatch text for all three was part of why parse failures never
 * recovered.
 */
function parseFeedback(failure: Extract<ExtractResult, { ok: false }>): string {
  switch (failure.kind) {
    case "truncated":
      return (
        `Your previous response was not valid JSON — it appears to have been cut off ` +
        `before the end (${failure.detail}). That usually means the response ran too long. ` +
        `Return the same object, complete and shorter: keep every required property, and ` +
        `reduce the length of the longest text fields so the object finishes.`
      );
    case "syntax":
      return (
        `Your previous response was not valid JSON: ${failure.detail}. The most common cause ` +
        `is an unescaped double quote or a raw newline inside a string value — escape them as ` +
        `\\" and \\n. Return the corrected JSON object only.`
      );
    case "no-object":
      return (
        `Your previous response contained no JSON object at all. Return a single JSON object ` +
        `matching the schema, and nothing else — no prose, no explanation, no markdown fences.`
      );
  }
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
type ExtractResult =
  | { ok: true; value: unknown }
  | { ok: false; kind: "no-object" | "truncated" | "syntax"; detail: string };

/**
 * Total by construction: an unparseable response is a normal outcome to retry,
 * not an exception. It used to throw from two places — an unguarded fallback
 * JSON.parse and a "No JSON object found" throw — both of which escaped the
 * retry loop entirely, so parse failures got zero attempts where schema failures
 * got LIMITS.maxSchemaRetries.
 */
function tryExtractJson(raw: string): ExtractResult {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  try {
    // Valid-but-not-an-object responses (a bare array, null, "string", 42) parse
    // fine and deliberately fall through to schema validation, which reports
    // them far more precisely than any check here could.
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1) {
      return { ok: false, kind: "no-object", detail: "the response contained no JSON object" };
    }
    if (end <= start) {
      // An opening brace with no closing one: cut off rather than malformed.
      return { ok: false, kind: "truncated", detail: errorDetail(firstError) };
    }

    // TODO: this brace-span fallback is not sound. indexOf("{") to
    // lastIndexOf("}") over a response with prose around or between JSON can
    // splice together a span that was never one object, which then parses into
    // something schema-invalid — so the model gets told it broke the schema when
    // it actually wrapped valid JSON in commentary, and a retry is spent on a
    // self-inflicted wound. Narrowing it is a behaviour change (some responses
    // that currently squeak through would start failing), so it needs its own
    // look rather than riding along with the retry fix.
    const candidate = cleaned.slice(start, end + 1);
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (secondError) {
      return {
        ok: false,
        kind: looksTruncated(candidate) ? "truncated" : "syntax",
        detail: errorDetail(secondError),
      };
    }
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cheap structural guess at "ran out of room" versus "malformed". Never asserted
 * as fact to the model — the feedback says "appears to have been cut off",
 * because an unbalanced brace inside a string value would fool this.
 */
function looksTruncated(candidate: string): boolean {
  if (!candidate.trimEnd().endsWith("}")) return true;
  const opens = (candidate.match(/[{[]/g) ?? []).length;
  const closes = (candidate.match(/[}\]]/g) ?? []).length;
  return opens !== closes;
}
