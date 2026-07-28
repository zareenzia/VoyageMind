# VoyageMind

A multi-agent travel itinerary planner on the Claude Agent SDK.

## Setup

```bash
npm install
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm run typecheck
npm run dev -- "5 days in Tokyo in October, two of us, about \$4000"
npm run eval
```

## What's here

| Path | State |
|---|---|
| `CLAUDE.md` | The architectural contract. Read this first. |
| `src/schemas/index.ts` | All agent boundary types. Complete. |
| `src/agents/run.ts` | Shared runner: JSON extraction, schema validation, capped retry. Complete. |
| `src/agents/intake.ts` | Intake agent. Complete. |
| `src/checks/feasibility.ts` | Budget, transit, opening-hours, distance checks. Complete. |
| `evals/` | 10 property-based intake cases + runner. Complete. |
| `src/agents/{research,itinerary,critic}.ts` | Stubs. |
| `src/tools/` | Empty. This is your real week-one problem. |
| `src/orchestrator.ts` | Deliberately absent. Write it fourth, not first. |

## Build order

1. **Verify Intake.** `npm run eval` should get most cases passing. Where it fails, fix the
   system prompt in `src/agents/intake.ts` — not the eval, unless the eval is genuinely wrong.
2. **Data layer.** Get one real travel API returning real results through `src/tools/`.
   Everything downstream is blocked on this and it is the part with no AI in it.
3. **Research agent.** Uses the tools, returns `Destination[]`. Run several in parallel,
   capped by `LIMITS.maxParallelResearch`.
4. **Itinerary + Critic together.** They only make sense as a pair. The Critic calls
   `checkItinerary()` for hard failures and adds model judgement as soft notes.
5. **Orchestrator.** Now it's a wiring job rather than a design problem.

## Cost notes

Fan-out is the cost driver. `MODELS.fast` handles Intake, Research and Pricing;
`MODELS.reasoning` handles Itinerary and Critic. Cache destination research — a city's
attractions don't change weekly. `LIMITS.maxRevisionRounds` exists so the Critic and the
Itinerary agent cannot argue indefinitely on your card.

## Dev-side subagents

`.claude/agents/` contains two read-mostly helpers Claude Code will delegate to:
`schema-guardian` (enforces the contracts in CLAUDE.md) and `eval-runner`. Both are
deliberately narrow. Widen their tools only when you have a reason.
