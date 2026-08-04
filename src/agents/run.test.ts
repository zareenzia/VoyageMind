import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LIMITS } from "../config.js";
import { AgentValidationError, runAgentWith, type Collect } from "./run.js";

/**
 * The first tests this module has had. They exist because a malformed-JSON
 * response used to escape the retry loop entirely as a raw SyntaxError, while a
 * schema failure got LIMITS.maxSchemaRetries attempts — CLAUDE.md rule 1 says a
 * validation failure is a typed retry, not a crash, and unparseable output is
 * the most basic validation failure there is.
 *
 * Everything goes through runAgentWith with a scripted transport: no network, no
 * auth session, and the exact number of attempts is observable.
 */

const Schema = z.object({ title: z.string(), count: z.number() });
const VALID = JSON.stringify({ title: "ok", count: 1 });

/** Returns each scripted response in turn, and records how many were consumed. */
function scripted(responses: string[]): { collect: Collect; calls: () => number } {
  let index = 0;
  return {
    collect: async () => {
      const response = responses[Math.min(index, responses.length - 1)]!;
      index++;
      return response;
    },
    calls: () => index,
  };
}

function run(collect: Collect) {
  return runAgentWith(collect, {
    name: "test",
    systemPrompt: "You are a test agent.",
    prompt: "Produce the object.",
    schema: Schema,
    model: "test-model",
  });
}

const TOTAL_ATTEMPTS = LIMITS.maxSchemaRetries + 1;

describe("runAgentWith — malformed JSON is a retry, not a crash", () => {
  // The bug: a truncated response died here as a raw SyntaxError from the
  // unguarded fallback JSON.parse, with zero retries.
  it("retries a truncated response and succeeds when the next attempt is valid", async () => {
    const truncated = `{"title": "a long piece of prose that got cut off mid-`;
    const { collect, calls } = scripted([truncated, VALID]);

    await expect(run(collect)).resolves.toEqual({ title: "ok", count: 1 });
    expect(calls()).toBe(2);
  });

  it("throws AgentValidationError, not SyntaxError, once the cap is exhausted", async () => {
    const { collect, calls } = scripted([`{"title": "cut off mid-`]);

    await expect(run(collect)).rejects.toThrow(AgentValidationError);
    expect(calls()).toBe(TOTAL_ATTEMPTS);
  });

  it("retries an unescaped quote inside a string value", async () => {
    const badQuote = `{"title": "she said "hello" loudly", "count": 1}`;
    const { collect, calls } = scripted([badQuote, VALID]);

    await expect(run(collect)).resolves.toEqual({ title: "ok", count: 1 });
    expect(calls()).toBe(2);
  });

  // Previously threw AgentValidationError but still from outside the loop, so it
  // also got zero retries — fixing only the unguarded parse would have missed it.
  it("retries a response containing no JSON object at all", async () => {
    const { collect, calls } = scripted(["I'm sorry, I can't help with that.", VALID]);

    await expect(run(collect)).resolves.toEqual({ title: "ok", count: 1 });
    expect(calls()).toBe(2);
  });

  it("shares one cap with schema failures rather than adding a second budget", async () => {
    // Mixed failure kinds must not buy extra attempts between them.
    const { collect, calls } = scripted([
      `{"title": "cut off`, // parse failure
      JSON.stringify({ title: "ok" }), // schema failure (count missing)
      `not json at all`, // parse failure
      VALID, // would succeed, but the cap is already spent
    ]);

    await expect(run(collect)).rejects.toThrow(AgentValidationError);
    expect(calls()).toBe(TOTAL_ATTEMPTS);
  });
});

describe("runAgentWith — feedback tells the model what actually went wrong", () => {
  async function promptOnRetry(first: string): Promise<string> {
    let second = "";
    let index = 0;
    const collect: Collect = async ({ prompt }) => {
      if (index++ === 0) return first;
      second = prompt;
      return VALID;
    };
    await run(collect);
    return second;
  }

  it("tells a truncated response to shorten, without asserting truncation as fact", async () => {
    const retry = await promptOnRetry(`{"title": "a very long summary that ran out of room`);
    expect(retry).toMatch(/appears to have been cut off|appears truncated/i);
    expect(retry).toMatch(/shorter|reduce/i);
    // The heuristic can be wrong, so the wording must stay hedged.
    expect(retry).not.toMatch(/your response was truncated\./i);
  });

  it("points a balanced-but-malformed response at escaping", async () => {
    const retry = await promptOnRetry(`{"title": "she said "hi"", "count": 1}`);
    expect(retry).toMatch(/escap/i);
  });

  it("tells a response with no JSON object to return one", async () => {
    const retry = await promptOnRetry("Sure! Here's what I'd suggest instead.");
    expect(retry).toMatch(/no JSON object|single JSON object/i);
  });

  it("still reports schema problems as schema problems", async () => {
    const retry = await promptOnRetry(JSON.stringify({ title: "ok" }));
    expect(retry).toMatch(/schema/i);
    expect(retry).toMatch(/count/);
  });
});

describe("runAgentWith — valid JSON that isn't an object", () => {
  /**
   * These parse fine, so extraction succeeds and the failure lands on the schema
   * rather than the parse path. Asserted explicitly because the resulting message
   * ("expected object, received array") is confusing enough to be worth pinning:
   * the answer to "which path does it take" is the schema path, deliberately.
   */
  for (const [label, response] of [
    ["a bare array", "[1, 2, 3]"],
    ["null", "null"],
    ["a quoted string", `"just a string"`],
    ["a number", "42"],
  ] as const) {
    it(`treats ${label} as a schema failure and retries`, async () => {
      const { collect, calls } = scripted([response, VALID]);
      await expect(run(collect)).resolves.toEqual({ title: "ok", count: 1 });
      expect(calls()).toBe(2);
    });
  }

  it("reports the schema path, not the parse path, for a bare array", async () => {
    let second = "";
    let index = 0;
    const collect: Collect = async ({ prompt }) => {
      if (index++ === 0) return "[1, 2, 3]";
      second = prompt;
      return VALID;
    };
    await run(collect);
    expect(second).toMatch(/schema/i);
  });
});
