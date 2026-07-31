import { AgentValidationError } from "./agents/run.js";
import { formatItineraryPretty } from "./cli/pretty.js";
import { PipelineBlockedError, runPipeline, type ProgressEvent } from "./orchestrator.js";

/**
 * CLI entry point: the full pipeline, Intake through the Critic revision loop.
 * Phase 0 ends here — a validated Itinerary + CritiqueResult, pretty-printed.
 * Writer (user-facing prose) is Phase 1, alongside the frontend it's for.
 *
 * Usage: npm run dev -- "5 days in Tokyo in October, two of us, about $4000"
 *        npm run dev -- --pretty "5 days in Tokyo in October, two of us, about $4000"
 */
async function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes("--pretty");
  const request = args.filter((a) => a !== "--pretty").join(" ");
  if (!request) {
    console.error('Usage: npm run dev -- [--pretty] "your travel request"');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const { events, result } = runPipeline(request, today);

  events.on("progress", (event: ProgressEvent) => {
    const marker = event.status === "failed" ? "!!" : event.status === "started" ? ".." : "ok";
    console.error(`[${marker}] ${event.stage}: ${event.message}`);
  });

  const { brief, itinerary, critique, revisionsUsed } = await result;

  if (pretty) {
    console.log(formatItineraryPretty(itinerary, critique, brief.travellers.count, revisionsUsed));
    return;
  }

  console.log(JSON.stringify(itinerary, null, 2));

  console.log(`\nVerdict: ${critique.verdict} (${revisionsUsed} revision round(s) used)`);
  if (critique.hard_failures.length > 0) {
    console.log("\nHard failures:");
    for (const f of critique.hard_failures) console.log(`  - [${f.code}] ${f.message}`);
  }
  if (critique.soft_notes.length > 0) {
    console.log("\nNotes:");
    for (const n of critique.soft_notes) console.log(`  - ${n}`);
  }
  if (critique.suggested_fixes.length > 0) {
    console.log("\nSuggested fixes:");
    for (const s of critique.suggested_fixes) console.log(`  - ${s}`);
  }
}

main().catch((error) => {
  if (error instanceof PipelineBlockedError) {
    console.error(error.message);
  } else if (error instanceof AgentValidationError) {
    console.error(error.message);
    console.error("\nWhat the model actually returned:\n" + error.raw);
  } else {
    console.error(error);
  }
  process.exit(1);
});
