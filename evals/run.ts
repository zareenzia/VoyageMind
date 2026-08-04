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

/** Every piece of model-written prose in a WriterOutput, concatenated. */
function proseOf(output: unknown): string {
  const o = output as {
    title?: unknown;
    summary?: unknown;
    sections?: { heading?: unknown; body?: unknown }[];
    practical_tips?: unknown[];
    caveats?: unknown[];
  };
  const parts: string[] = [];
  for (const v of [o?.title, o?.summary]) if (typeof v === "string") parts.push(v);
  for (const s of Array.isArray(o?.sections) ? o.sections : []) {
    for (const v of [s?.heading, s?.body]) if (typeof v === "string") parts.push(v);
  }
  for (const list of [o?.practical_tips, o?.caveats]) {
    for (const t of Array.isArray(list) ? list : []) parts.push(String(t));
  }
  return parts.join("\n");
}

/**
 * Clock times the itinerary actually SOURCED — activities with
 * `estimated.hours === false`. Those may legitimately be stated precisely; a
 * blanket ban on precision would teach the model to hedge unconditionally,
 * which loses real information and is its own kind of dishonesty.
 */
function sourcedClockTimes(input: unknown): { canonical: Set<string>; hours: Set<number> } {
  const canonical = new Set<string>();
  const hours = new Set<number>();
  const itinerary = (input as { itinerary?: { days?: unknown[] } })?.itinerary;
  for (const day of Array.isArray(itinerary?.days) ? itinerary.days : []) {
    const stops = (day as { stops?: unknown[] })?.stops;
    for (const stop of Array.isArray(stops) ? stops : []) {
      const activity = (stop as { activity?: Record<string, unknown> })?.activity;
      const estimated = activity?.["estimated"] as { hours?: unknown } | undefined;
      if (estimated?.hours === false) {
        for (const key of ["opens", "closes"]) {
          const value = activity?.[key];
          const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
          if (match) {
            canonical.add(`${Number(match[1])}:${match[2]}`);
            hours.add(Number(match[1]));
          }
        }
      }
    }
  }
  return { canonical, hours };
}

function assertExpectation(
  output: unknown,
  key: string,
  expected: unknown,
  input: Record<string, unknown>,
): string | null {
  // "prose_no_unhedged_estimated_times" — no precise clock time may appear in
  // prose unless the itinerary actually sourced it. Guide always sets
  // estimated.hours = true (src/agents/research.ts), so in practice every
  // opens/closes in a real itinerary is a guess, and "the market opens at
  // 10:00" reads as verified fact while dropping every provenance signal the
  // rest of the system carries. Deliberately blunt: a false positive here
  // costs one reworded sentence, a false negative ships a fabrication that is
  // indistinguishable from real data downstream (CLAUDE.md rule 9).
  if (key === "prose_no_unhedged_estimated_times") {
    const prose = proseOf(output);
    const allowed = sourcedClockTimes(input);
    const problems: string[] = [];

    // Compared canonically ("09:00" and "9:00" are the same time), or an
    // exemption silently stops applying the moment the model drops a zero.
    for (const match of prose.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
      const canonical = `${Number(match[1])}:${match[2]}`;
      if (!allowed.canonical.has(canonical)) problems.push(`precise time "${match[0]}"`);
    }
    // "opens at 9" — unhedged by construction; a hedged form reads "opens
    // around 9", which puts a word between "at" and the digit. Honours the
    // same sourced exemption, including the bare-hour form ("opens at 6").
    for (const match of prose.matchAll(/\b(opens?|closes?)\s+at\s+(\d{1,2})(?::(\d{2}))?\b/gi)) {
      const isSourced = match[3]
        ? allowed.canonical.has(`${Number(match[2])}:${match[3]}`)
        : allowed.hours.has(Number(match[2]));
      if (!isSourced) problems.push(`unhedged phrasing "${match[0]}"`);
    }

    if (problems.length === 0) return null;
    const unique = [...new Set(problems)];
    return (
      `prose states ${unique.join(", ")} as fact, but the itinerary's hours are estimated` +
      (allowed.canonical.size > 0
        ? ` (sourced and therefore allowed: ${[...allowed.canonical].join(", ")})`
        : "")
    );
  }

  // "prose_excludes" — none of these strings may appear. Used as a fabrication
  // trap: plausible nearby places that are NOT in the input itinerary.
  if (key === "prose_excludes") {
    const prose = proseOf(output).toLowerCase();
    const found = (expected as string[]).filter((name) => prose.includes(name.toLowerCase()));
    return found.length === 0
      ? null
      : `prose mentions ${found.join(", ")}, which is not in the input itinerary`;
  }

  // "prose_includes_any" — at least one of these must appear.
  if (key === "prose_includes_any") {
    const prose = proseOf(output).toLowerCase();
    const hit = (expected as string[]).some((v) => prose.includes(v.toLowerCase()));
    return hit ? null : `prose contains none of: ${(expected as string[]).join(", ")}`;
  }

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

  // Load every suite up front, so a filter that matches nothing can report what
  // WAS available instead of printing "0/0 passed" and exiting 0.
  const loaded: { suiteName: string; cases: Case[] }[] = [];
  for (const file of caseFiles) {
    const suiteName = file.replace(/\.json$/, "");
    if (!SUITES[suiteName]) {
      console.log(`  (skipping ${file} — no registered suite named "${suiteName}")`);
      continue;
    }
    loaded.push({ suiteName, cases: JSON.parse(readFileSync(join(here, "cases", file), "utf8")) });
  }

  // A bare suite name is the obvious thing to type (`npm run eval -- writer`),
  // so it's accepted alongside case-id substrings. An exact suite match wins;
  // anything else is matched against case ids across all suites.
  const isSuiteFilter = filter !== undefined && loaded.some((s) => s.suiteName === filter);
  const selection = loaded.map(({ suiteName, cases }) => ({
    suiteName,
    cases:
      filter === undefined
        ? cases
        : isSuiteFilter
          ? suiteName === filter
            ? cases
            : []
          : cases.filter((c) => c.id.includes(filter)),
  }));

  // Rule 6 says evals gate changes. A filter that selects nothing used to print
  // "0/0 passed" and exit 0, which makes a typo indistinguishable from a green
  // run — in CI that silently gates nothing at all. Fail loudly instead.
  const selectedCount = selection.reduce((n, s) => n + s.cases.length, 0);
  if (selectedCount === 0) {
    const reason =
      filter === undefined
        ? "No eval cases found at all."
        : `No eval cases matched "${filter}".`;
    console.error(`\n${reason}\n`);
    console.error(`Filter by suite name: ${loaded.map((s) => s.suiteName).join(", ")}`);
    console.error(`\nOr by case id (substring match):`);
    for (const { suiteName, cases } of loaded) {
      console.error(`  ${suiteName}: ${cases.map((c) => c.id).join(", ")}`);
    }
    process.exit(1);
  }

  let passed = 0;
  let total = 0;
  const failures: string[] = [];

  for (const { suiteName, cases: selected } of selection) {
    const suite = SUITES[suiteName]!;

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
          .map(([key, expectedValue]) => assertExpectation(output, key, expectedValue, input))
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
