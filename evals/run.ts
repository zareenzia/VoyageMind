import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runIntake } from "../src/agents/intake.js";
import type { TripBrief } from "../src/schemas/index.js";

/**
 * Property-based evals. We assert properties of the output, not exact strings —
 * exact-match assertions on model output are a treadmill.
 *
 * Run: npm run eval
 * Filter: npm run eval -- vague-warm
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Case {
  id: string;
  today: string;
  request: string;
  expect: Record<string, unknown>;
  why: string;
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function assertExpectation(
  brief: TripBrief,
  key: string,
  expected: unknown,
): string | null {
  // "<field>_not_null" — field must be present
  if (key.endsWith("_not_null")) {
    const field = key.slice(0, -"_not_null".length);
    const actual = get(brief, field);
    return actual !== null && actual !== undefined
      ? null
      : `${field} should not be null`;
  }

  // "<field>_min" — array must have at least N entries
  if (key.endsWith("_min")) {
    const field = key.slice(0, -"_min".length);
    const actual = get(brief, field);
    if (!Array.isArray(actual)) return `${field} is not an array`;
    return actual.length >= (expected as number)
      ? null
      : `${field} has ${actual.length} entries, expected at least ${expected}`;
  }

  // "<field>_include" — array must contain each expected item (case-insensitive substring)
  if (key.endsWith("_include")) {
    const field = key.slice(0, -"_include".length);
    const actual = get(brief, field);
    if (!Array.isArray(actual)) return `${field} is not an array`;
    const haystack = actual.map((v) => String(v).toLowerCase());
    const missing = (expected as string[]).filter(
      (want) => !haystack.some((h) => h.includes(want.toLowerCase())),
    );
    return missing.length === 0 ? null : `${field} missing ${missing.join(", ")}`;
  }

  // exact match
  const actual = get(brief, key);
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  return same ? null : `${key} = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}

async function main() {
  const filter = process.argv[2];
  const cases: Case[] = JSON.parse(
    readFileSync(join(here, "cases", "intake.json"), "utf8"),
  );
  const selected = filter ? cases.filter((c) => c.id.includes(filter)) : cases;

  let passed = 0;
  const failures: string[] = [];

  for (const testCase of selected) {
    process.stdout.write(`  ${testCase.id} ... `);
    try {
      const brief = await runIntake({ request: testCase.request, today: testCase.today });
      const problems = Object.entries(testCase.expect)
        .map(([key, expected]) => assertExpectation(brief, key, expected))
        .filter((p): p is string => p !== null);

      if (problems.length === 0) {
        console.log("pass");
        passed++;
      } else {
        console.log("FAIL");
        failures.push(`${testCase.id}\n    ${problems.join("\n    ")}\n    why: ${testCase.why}`);
      }
    } catch (error) {
      console.log("ERROR");
      failures.push(`${testCase.id}\n    ${(error as Error).message}`);
    }
  }

  console.log(`\n${passed}/${selected.length} passed`);
  if (failures.length > 0) {
    console.log(`\nFailures:\n\n${failures.join("\n\n")}`);
    process.exit(1);
  }
}

main();
