# VoyageMind — Agent Architecture

AI travel planner. Five agents plus a deterministic tool layer, built on the Claude Agent SDK.

Full product spec: `docs/VOYAGEMIND_SPEC.md`. Build history, retrospective, and the five
blocked-fabrication cases: `docs/PROJECT_LOG.md`. Read the spec before proposing
architectural changes.

## Pipeline

```
Intake     free text          ->  TripBrief
Guide      TripBrief          ->  Destination[]      (parallel, capped)
Itinerary  Destination[]      ->  Itinerary
Critic     Itinerary          ->  CritiqueResult     (pass | revise | infeasible)
--------------------------------------------------------------  Phase 0 ends here
Writer     Itinerary          ->  user-facing plan                        [PHASE 1]
```

Writer is Phase 1, not Phase 0 (spec §7.1/§11) — no prose formatting until there's a
frontend for it to render. The Critic can return work to the Itinerary agent. **Maximum 2
revision rounds**, enforced in `orchestrator.ts`, never left to the model's discretion.

## Non-negotiable rules

1. **Schemas are the contract.** Every agent boundary is a Zod schema in `src/schemas/`.
   `runAgent()` derives the JSON Schema from the Zod definition and injects it into the
   system prompt, so prompts cannot drift from schemas. A validation failure is a typed
   retry, not a crash.
2. **Agents are for judgement. Everything else is code.** A component gets a model call only
   if its job requires interpretation or synthesis under ambiguity — fetching, summing,
   converting, sorting, filtering, dates, and geometry are code (`src/checks/`, `src/tools/`).
   Do not propose a new agent without arguing why code cannot do the job. Five agents is the
   design, not a starting point to grow from.
3. **No agent calls an external API directly.** All network access goes through a thin
   wrapper in `src/tools/` so it can be mocked in evals, cached, and swapped.
4. **Every loop has a hard cap** traceable to `LIMITS` in `src/config.ts`. No unbounded
   retries, no model-decided iteration counts.
5. **Model routing is deliberate.** See `src/config.ts`. Do not upgrade an agent to a bigger
   model to compensate for a weak prompt.
6. **Evals gate changes.** `npm run eval` must not regress. Fix the prompt, not the eval,
   unless the eval is genuinely wrong — and say so explicitly if you think it is.
7. **Monolith until Phase 3.** No microservices, no message broker, no service extraction.
8. **Database is Postgres on Neon** (spec D6). No local Postgres container, no
   docker-compose file, no separate vector database — `pgvector` on the same instance covers
   Phase 2 RAG. Pooled connection string (`DATABASE_URL`) for application queries, direct
   (`DATABASE_URL_UNPOOLED`) for migrations. Nothing before Phase 1 needs a database at all.
9. **Facts and estimates are different types of thing.** A tool returns only what its source
   actually said — inventing a plausible value is the worst failure mode in this system,
   because the fabrication becomes indistinguishable from real data downstream. Unknown is
   `null` plus a flag, never a guess, never `0`. See `docs/PROJECT_LOG.md` §5 for the five
   places this actually came up and what was built instead each time.
10. **External data: free and keyless first.** No provider requiring payment without asking
    first. Every network tool MUST follow the caching / rate-limit / User-Agent / backoff
    pattern already established in `src/tools/` — the detail lives in the code, the
    requirement lives here.
11. **The orchestrator emits progress events from day one.** Even for the CLI. The Phase 1
    frontend needs SSE to survive a 30–90s pipeline (measured, not estimated — see
    `docs/PROJECT_LOG.md` §9), and retrofitting event emission later means restructuring the
    orchestrator.
12. **`.describe()` strings are prompt text, not comments.** `runAgent()` injects the
    generated schema into every system prompt, after the prompt's own rules — the stronger
    position. A description that contradicts a prompt rule produces intermittent wrong
    answers with no typecheck error and no eval failure explaining why; state the same thing
    in both places, always. (This cost four rounds of flaky Intake evals.)
13. **Every agent gets a judgment schema** omitting fields that are sourced facts or
    code-computed — `DestinationJudgmentSchema`, `TripBriefJudgmentSchema`, the Critic's, the
    Itinerary agent's ordering-only output. If the model can't state a value, it can't state
    a wrong one.
14. **Value plus a provenance flag is the standard shape for anything estimated** —
    `estimated`, `transit_source`, `dates_provisional`, `estimated_total_complete`. New
    estimated values follow it.
15. **No authentication, user accounts, or session handling without its own reviewed step.**
    Not as a side effect of persistence, a frontend task, or anything else — propose it, get
    it approved, build it alone. This has now gone wrong twice: `6f9d20b` is literally
    "remove premature auth UI," and the users/sessions/scrypt/JWT reimplementation preserved
    on `phase1-persistence-auth` arrived attached to a persistence step that explicitly said
    not to build a login screen. It is the one area where a silent failure leaks another
    user's data, so it does not get built in passing. Until that step happens, ownership is
    spec D7's anonymous owner token — a "my trips" filter, explicitly **not** an access check.
16. **The spec is a review instrument, not a changelog.** A `D<n>` entry records a decision
    when it is *taken*, with dated reasoning, so it can constrain what gets built next. Never
    write one to describe or legitimise code that already exists. A spec that records what
    happened cannot constrain anything, and a superseding entry backfilled after the fact
    quietly converts a violated decision into an approved one. If code contradicts a
    committed decision, that is a revert-or-approve conversation, not a documentation task.

## Branch hygiene

**Merge to main before starting the next task.** A branch that isn't merged is invisible to
everything that comes after it — including the next session, which reads main, correctly
concludes the work isn't there, and builds it again. That is exactly how the reviewed
`TripStore` came to be reimplemented from scratch, bringing a duplicate migration runner and
a second, incompatible `trips` table with it.

**Before building something that might already exist, check.** `git branch -a -v` and
`git log --oneline main..<branch>` cost nothing and answer the question "step N is done"
doesn't: done *where*. "Reported as done" is not "on main" — when reporting work complete,
say which branch it landed on.

## Testing

- **No live network calls in tests.** Record a real API response once, save it as a fixture.
- Deterministic code (`src/checks/`, `src/tools/`) gets ordinary unit tests (vitest).
- Agents get **evals** — property assertions in `evals/cases/`, never exact-string matching.
- Every new agent ships with at least 3 eval cases, one adversarial (empty, contradictory, or
  impossible input).

## Environment

- **Windows is the primary dev machine.** npm scripts must work on both Windows and POSIX —
  no inline `VAR=value cmd`, no `rm -rf`, no shell built-ins that differ across shells.
- Env vars load via `--env-file=.env`. **Do not add `dotenv`.**
- Auth runs on a Claude Code OAuth session, not an API key — `ANTHROPIC_API_KEY` stays
  commented out in `.env` on purpose; an empty value breaks auth, commented out is correct.

## Commands

```bash
npm run dev -- "your request"   # run the pipeline from the CLI
npm run eval                    # full eval suite
npm run eval -- <case-id>       # single case
npm run test                    # unit tests (vitest)
npm run typecheck               # tsc --noEmit
```

## Current state

Phase 0 complete (2026-07-29) — all four agents built and evaluated, orchestrator wired,
verified end-to-end. What was built, in what order, and why: `docs/PROJECT_LOG.md`. Next:
Phase 1 (Neon persistence, React frontend + SSE, Writer agent).

## Things not to do

- Do not add an agent without its schemas existing first.
- Do not let a tool return a value its source did not provide.
- Do not let an agent return prose where a schema is expected.
- Do not add a retry or revision loop without a numeric cap.
- Do not add `dotenv`, a Postgres container, or a paid API provider.
- Do not commit anything from `.env`.
- Do not widen a subagent's tool permissions in `.claude/agents/` without stating why.
- Do not introduce a second AI provider or an abstraction layer over providers.

## How to work with me on this repo

When something fails, diagnose before editing. Read the failing eval case, read the relevant
prompt, and state what you think is wrong and why — then wait. A wrong theory is cheap to
correct; a wrong change is not.

For any task touching schemas or adding a tool, propose the schema and wait for approval
before implementing — write it deterministic and testable first, with a clear TODO where
live data will replace placeholders. `src/tools/currency.ts` is the reference implementation.
