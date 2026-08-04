import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runIntake } from "../src/agents/intake.js";
import { runGuide } from "../src/agents/research.js";
import { runItinerary } from "../src/agents/itinerary.js";
import { runCritic } from "../src/agents/critic.js";
import { runWriter } from "../src/agents/writer.js";

/**
 * Property-based evals, across every agent. We assert properties of the output,
 * not exact strings — exact-match assertions on model output are a treadmill.
 *
 * One case file per agent in evals/cases/, named after the suite (guide.json ->
 * the "guide" suite below). Run: npm run eval
 * Filter (matches case id, across all suites): npm run eval -- vague-warm
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Case {
  id: string;
  expect?: Record<string, unknown>;
  /** Some failure modes are correctly a thrown error, not a returned value —
   * e.g. Itinerary given a brief with no known trip length. Set this instead of
   * `expect` to assert the call throws (optionally checking the message). */
  expectThrow?: { message_includes?: string };
  why: string;
  [input: string]: unknown;
}

/** One entry per agent. `run` receives the case object minus id/expect/why. */
const SUITES: Record<string, { run: (input: Record<string, unknown>) => Promise<unknown> }> = {
  intake: { run: (input) => runIntake(input as unknown as Parameters<typeof runIntake>[0]) },
  guide: { run: (input) => runGuide(input as unknown as Parameters<typeof runGuide>[0]) },
  itinerary: { run: (input) => runItinerary(input as unknown as Parameters<typeof runItinerary>[0]) },
  critic: { run: (input) => runCritic(input as unknown as Parameters<typeof runCritic>[0]) },
  writer: { run: (input) => runWriter(input as unknown as Parameters<typeof runWriter>[0]) },
};

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function assertExpectation(output: unknown, key: string, expected: unknown): string | null {
  // "<field>_not_null" — field must be present
  if (key.endsWith("_not_null")) {
    const field = key.slice(0, -"_not_null".length);
    const actual = get(output, field);
    return actual !== null && actual !== undefined ? null : `${field} should not be null`;
  }

  // "<field>_min" — array must have at least N entries
  if (key.endsWith("_min")) {
    const field = key.slice(0, -"_min".length);
    const actual = get(output, field);
    if (!Array.isArray(actual)) return `${field} is not an array`;
    return actual.length >= (expected as number)
      ? null
      : `${field} has ${actual.length} entries, expected at least ${expected}`;
  }

  // "<field>_max" — array must have at most N entries
  if (key.endsWith("_max")) {
    const field = key.slice(0, -"_max".length);
    const actual = get(output, field);
    if (!Array.isArray(actual)) return `${field} is not an array`;
    return actual.length <= (expected as number)
      ? null
      : `${field} has ${actual.length} entries, expected at most ${expected}`;
  }

  // "<field>_include" — array must contain each expected item (case-insensitive substring)
  if (key.endsWith("_include")) {
    const field = key.slice(0, -"_include".length);
    const actual = get(output, field);
    if (!Array.isArray(actual)) return `${field} is not an array`;
    const haystack = actual.map((v) => String(v).toLowerCase());
    const missing = (expected as string[]).filter(
      (want) => !haystack.some((h) => h.includes(want.toLowerCase())),
    );
    return missing.length === 0 ? null : `${field} missing ${missing.join(", ")}`;
  }

  // "<field>_exclude" — array must not contain any of the given values (exact, e.g. month numbers)
  if (key.endsWith("_exclude")) {
    const field = key.slice(0, -"_exclude".length);
    const actual = get(output, field);
    if (!Array.isArray(actual)) return `${field} is not an array`;
    const present = (expected as unknown[]).filter((unwanted) =>
      actual.some((a) => JSON.stringify(a) === JSON.stringify(unwanted)),
    );
    return present.length === 0
      ? null
      : `${field} should not include ${present.map((v) => JSON.stringify(v)).join(", ")} but does (${JSON.stringify(actual)})`;
  }

  // exact match
  const actual = get(output, key);
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  return same ? null : `${key} = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}

async function main() {
  const filter = process.argv[2];
  const caseFiles = readdirSync(join(here, "cases")).filter((f) => f.endsWith(".json"));

  let passed = 0;
  let total = 0;
  const failures: string[] = [];

  for (const file of caseFiles) {
    const suiteName = file.replace(/\.json$/, "");
    const suite = SUITES[suiteName];
    if (!suite) {
      console.log(`  (skipping ${file} — no registered suite named "${suiteName}")`);
      continue;
    }

    const cases: Case[] = JSON.parse(readFileSync(join(here, "cases", file), "utf8"));
    const selected = filter ? cases.filter((c) => c.id.includes(filter)) : cases;

    for (const testCase of selected) {
      total++;
      process.stdout.write(`  [${suiteName}] ${testCase.id} ... `);
      const { id, expect, expectThrow, why, ...input } = testCase;
      try {
        const output = await suite.run(input);

        if (expectThrow) {
          console.log("FAIL");
          failures.push(`[${suiteName}] ${id}\n    expected a thrown error, got a result\n    why: ${why}`);
          continue;
        }

        const problems = Object.entries(expect ?? {})
          .map(([key, expectedValue]) => assertExpectation(output, key, expectedValue))
          .filter((p): p is string => p !== null);

        if (problems.length === 0) {
          console.log("pass");
          passed++;
        } else {
          console.log("FAIL");
          failures.push(`[${suiteName}] ${id}\n    ${problems.join("\n    ")}\n    why: ${why}`);
        }
      } catch (error) {
        const message = (error as Error).message;
        if (expectThrow) {
          const missing = expectThrow.message_includes && !message.includes(expectThrow.message_includes);
          if (missing) {
            console.log("FAIL");
            failures.push(
              `[${suiteName}] ${id}\n    threw, but message didn't include ` +
                `"${expectThrow.message_includes}": ${message}\n    why: ${why}`,
            );
          } else {
            console.log("pass");
            passed++;
          }
        } else {
          console.log("ERROR");
          failures.push(`[${suiteName}] ${id}\n    ${message}`);
        }
      }
    }
  }

  console.log(`\n${passed}/${total} passed`);
  if (failures.length > 0) {
    console.log(`\nFailures:\n\n${failures.join("\n\n")}`);
    process.exit(1);
  }
}

main();
