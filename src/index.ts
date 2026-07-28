import { runIntake } from "./agents/intake.js";
import { AgentValidationError } from "./agents/run.js";

/**
 * Day 2 entry point: Intake only.
 *
 * Usage: npm run dev -- "5 days in Tokyo in October, two of us, about $4000"
 */
async function main() {
  const request = process.argv.slice(2).join(" ");
  if (!request) {
    console.error('Usage: npm run dev -- "your travel request"');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const brief = await runIntake({ request, today });

  console.log(JSON.stringify(brief, null, 2));

  if (brief.open_questions.length > 0) {
    console.log("\nIntake could not determine:");
    for (const question of brief.open_questions) console.log(`  - ${question}`);
  }
}

main().catch((error) => {
  if (error instanceof AgentValidationError) {
    console.error(error.message);
    console.error("\nWhat the model actually returned:\n" + error.raw);
  } else {
    console.error(error);
  }
  process.exit(1);
});
