# VoyageMind — Agent Architecture

Multi-agent travel itinerary planner built on the Claude Agent SDK.

## Pipeline

```
Intake     → vague user request  ->  validated TripBrief
Research   → TripBrief           ->  Destination[]        (parallel, one per candidate)
Pricing    → Destination[]       ->  PricedOption[]       (tool calls, minimal reasoning)
Itinerary  → PricedOption        ->  Itinerary
Critic     → Itinerary           ->  CritiqueResult       (pass | revise with reasons)
Writer     → Itinerary           ->  final prose output
```

The Critic can send work back to Itinerary. **Maximum 2 revision rounds**, enforced in
`orchestrator.ts`, never left to the model's discretion.

## Non-negotiable rules

1. **Schemas are the contract.** Every agent boundary is a Zod schema in `src/schemas/`.
   Agents return JSON only. Parse and validate at every handoff. A validation failure is a
   typed retry, not a thrown crash.

2. **No agent does arithmetic or geometry.** Budget totals, travel times, distance between
   stops, "does this fit in a day" — all live in `src/checks/` as plain TypeScript functions.
   The Critic calls them. Models are for judgement, code is for math.

3. **No agent calls an external API directly.** All external access goes through a thin
   wrapper in `src/tools/` so it can be mocked in evals and cached.

4. **Every change runs the evals.** `npm run eval`. A regression in the eval suite blocks
   the change, even if the unit tests pass.

5. **Model routing is deliberate.** See `src/config.ts`. Research and Pricing use the cheap
   fast model. Itinerary and Critic use the reasoning model. Do not "upgrade" an agent to a
   bigger model to fix a bad prompt.

## Commands

```bash
npm run dev            # run the orchestrator against a sample request
npm run test           # unit tests (vitest)
npm run eval           # full eval suite against evals/cases/
npm run typecheck      # tsc --noEmit
```

## Things not to do

- Do not add a new agent without first adding its input and output schema.
- Do not let an agent return prose where a schema is expected — no "here's the JSON:" preamble.
- Do not add retry loops without a hard iteration cap.
- Do not commit anything from `.env`. Real API keys never enter the repo or the eval fixtures.
- Do not widen a subagent's tool permissions in `.claude/agents/` without saying why in the PR.

## Current status

Intake agent implemented. Research onward are stubs. Build them one at a time, each with
passing evals before starting the next.
