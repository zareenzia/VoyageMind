# VoyageMind — Agent Architecture

AI travel planner. Five agents plus a deterministic tool layer, built on the Claude Agent SDK.

Full product spec: `docs/VOYAGEMIND_SPEC.md`. Setup history and debugging log:
`docs/PROJECT_LOG.md`. Read the spec before proposing architectural changes.

## Pipeline

```
Intake     free text          ->  TripBrief          [BUILT]
Guide      TripBrief          ->  Destination[]      (parallel, capped)   [BUILT]
Itinerary  Destination[]      ->  Itinerary
Critic     Itinerary          ->  CritiqueResult     (pass | revise | infeasible)
--------------------------------------------------------------  Phase 0 ends here
Writer     Itinerary          ->  user-facing plan                        [PHASE 1]
```

**Writer is Phase 1, not Phase 0** (decided 2026-07-28, see spec §7.1 and §11). Phase 0 ends
at a validated `Itinerary` JSON object, pretty-printed by the CLI — no prose formatting until
the frontend Writer's output is designed for actually exists.

The Critic can return work to the Itinerary agent. **Maximum 2 revision rounds**, enforced in
`orchestrator.ts`, never left to the model's discretion.

## Non-negotiable rules

1. **Schemas are the contract.** Every agent boundary is a Zod schema in `src/schemas/`.
   Agents return JSON only. `runAgent()` derives the JSON Schema from the Zod definition and
   injects it into the system prompt, so prompts cannot drift from schemas. A validation
   failure is a typed retry, not a crash.

2. **Agents are for judgement. Everything else is code.**
   A component gets a model call only if its job requires interpretation or synthesis under
   ambiguity. Fetching, summing, converting, sorting, filtering and looking up are code.
   - Budget arithmetic, distances, travel time, day feasibility -> `src/checks/`
   - Weather, places, lodging, transport, currency, visa, advisories -> `src/tools/`

   Do not propose a new agent without arguing why code cannot do the job. Five agents is the
   design, not a starting point to grow from.

3. **No agent calls an external API directly.** All network access goes through a thin
   wrapper in `src/tools/` so it can be mocked in evals, cached, and swapped.

4. **Every loop has a hard cap** traceable to `LIMITS` in `src/config.ts`. No unbounded
   retries, no model-decided iteration counts.

5. **Model routing is deliberate.** See `src/config.ts`. Intake and Guide use the fast model;
   Itinerary and Critic use the reasoning model. Do not upgrade an agent to a bigger model to
   compensate for a weak prompt.

6. **Evals gate changes.** `npm run eval` must not regress. Fix the prompt, not the eval,
   unless the eval is genuinely wrong — and say so explicitly if you think it is.

7. **Monolith until Phase 3.** No microservices, no message broker, no service extraction.
   Module boundaries inside `src/` mark the future seams; that is enough for now.

8. **Database is Postgres on Neon** (spec D6). Do not add a local Postgres container, a
   docker-compose file, or a separate vector database. `pgvector` on the same Neon instance
   covers Phase 2 RAG. Application queries use the pooled connection string (`DATABASE_URL`);
   migrations use the direct one (`DATABASE_URL_UNPOOLED`). Nothing before Phase 1 needs a
   database at all.

9. **Facts and estimates are different types of thing, and the code must know which is which.**

   A tool returns only what its source actually said. A tool that invents a plausible value is
   the worst failure mode in this system, because the fabrication becomes indistinguishable
   from data downstream.

   - `PlaceCandidate` holds sourced facts only: name, coordinates, address, category, source
     id, raw opening hours if present. No duration. No cost.
   - `Activity` may carry model-estimated values, and every estimated field must be marked in
     its `estimated` object.
   - When a value is unknown it is `null` plus a flag — never a confident guess, never `0`,
     never an empty string.

   The Critic weights estimated inputs differently from sourced ones. The UI labels them.
   Neither is possible if the distinction is lost at the tool boundary.

10. **External data: free and keyless first.**
    Current sources are OpenStreetMap Overpass (places) and Open-Meteo (weather) — no API key,
    no billing account. Do not introduce Google Places, Amadeus, or any provider requiring
    payment without asking first.

    Every network tool must: cache to disk (this data changes slowly), rate-limit itself to at
    most 1 request/second, send a descriptive `User-Agent` identifying VoyageMind, and back off
    on 429 and 5xx. Public Overpass instances are an overused shared resource; behave
    accordingly.

11. **The orchestrator emits progress events from day one.**
    Even for the CLI. Each agent boundary publishes an event. The Phase 1 frontend needs SSE
    to survive a 30–90 second pipeline, and retrofitting event emission means restructuring the
    orchestrator. Build it as an event emitter that the CLI happens to render as text.

## Testing

- **No live network calls in tests.** Record a real API response once, save it as a fixture,
  test against the fixture. Tests must pass offline.
- Deterministic code in `src/checks/` and `src/tools/` gets ordinary unit tests (vitest).
- Agents get **evals**, not unit tests — property assertions in `evals/cases/`, never
  exact-string matching on model output.
- Every new agent ships with at least 3 eval cases, one of them adversarial (empty,
  contradictory, or impossible input).

## Environment

- **Windows is the primary dev machine** (Git Bash and PowerShell). npm scripts must work on
  both Windows and POSIX. No inline `VAR=value cmd` prefixes, no `rm -rf`, no shell built-ins
  that differ across shells. Use cross-platform Node instead.
- Env vars load via `--env-file=.env` in the npm scripts. **Do not add `dotenv`** — Node
  handles this natively.
- Auth currently runs on a Claude Code OAuth session, not an API key. `ANTHROPIC_API_KEY` is
  commented out in `.env` deliberately. An empty value breaks auth; commented out is correct.

## Commands

```bash
npm run dev -- "your request"   # run the pipeline from the CLI
npm run eval                    # full eval suite
npm run eval -- <case-id>       # single case
npm run test                    # unit tests (vitest)
npm run typecheck               # tsc --noEmit
```

## Current state

**Built:** schemas for the whole pipeline · `runAgent` (validation, capped retry,
schema-derived prompts, plus an optional post-schema `validate` hook for business
rules like provenance) · Intake agent at 10/10 evals · Guide agent at 3/3 evals ·
`checks/feasibility.ts` (budget, day feasibility, terrain-tiered transit-time
estimate) · `tools/currency.ts`, `tools/places.ts`, `tools/geocode.ts`,
`tools/elevation.ts`

**Phase 0, in order:**
1. ~~`PlaceCandidate` schema + `estimated` flags on `ActivitySchema`~~ — done.
2. ~~`tools/places.ts` — Overpass wrapper~~ — done, plus `tools/geocode.ts` (Nominatim:
   bbox/centre/country) which turned out to be a prerequisite.
3. ~~Guide agent~~ — done, 3/3 evals.
4. **Itinerary and Critic** ← next — build as a pair; they only make sense together.
5. `orchestrator.ts` — last, once the agents it coordinates each pass their evals.

**Phase 0 is done when** `npm run dev -- "4 days in Meghalaya, BDT 45,000"` produces a
feasible **validated `Itinerary` JSON object, pretty-printed by the CLI**, with estimated
values correctly marked. Writer's prose formatting is Phase 1 — see the Pipeline section
above.

**Stubs:** `src/agents/{itinerary,critic}.ts` are placeholders. `src/agents/research.ts`
is no longer a stub — it's the Guide agent (the filename is a holdover; see the file's
own header comment).

## Things not to do

- Do not add an agent without its schemas existing first.
- Do not let a tool return a value its source did not provide.
- Do not let an agent return prose where a schema is expected.
- Do not add a retry or revision loop without a numeric cap.
- Do not write `orchestrator.ts` before the agents are individually passing evals.
- Do not add `dotenv`, a Postgres container, or a paid API provider.
- Do not write npm scripts that only work on POSIX shells.
- Do not commit anything from `.env`.
- Do not widen a subagent's tool permissions in `.claude/agents/` without stating why.
- Do not introduce a second AI provider or an abstraction layer over providers.

## How to work with me on this repo

When something fails, diagnose before editing. Read the failing eval case, read the relevant
prompt, and state what you think is wrong and why — then wait. A wrong theory is cheap to
correct; a wrong change is not.

For any task touching schemas or adding a tool, propose the schema and wait for approval
before implementing. Schema shape determines everything downstream and is the cheapest thing
in the project to get right early.

When adding a tool, write it deterministic and testable first, with a clear TODO where live
data will replace placeholders. `src/tools/currency.ts` is the reference implementation.