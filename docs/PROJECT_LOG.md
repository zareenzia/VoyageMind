# VoyageMind — Project Documentation

**Last updated:** 28 July 2026
**Status:** Intake agent working, 10/10 evals expected. Data layer not started.

---

## 1. What this project is

VoyageMind is a **multi-agent travel planner**. Instead of one AI doing everything, several
specialised agents each handle one job and pass structured data to the next one.

Why not just one big prompt? Because a single agent asked to "plan a trip" has to
simultaneously interpret vague requests, look up real prices, sequence activities
geographically, and check the budget. It will do all four badly and you cannot tell which
part failed. Splitting them means each agent has one job you can test in isolation.

### The intended pipeline

```
User: "5 days in Tokyo in October, two of us, about $4000"
   |
   v
[Intake]      Turns free text into a structured TripBrief.       <-- BUILT
   |          No planning, no research. Just parsing.
   v
[Research]    Finds destinations and activities.                 <-- not built
   |          Runs several in parallel, one per candidate city.
   v
[Pricing]     Looks up real flight and hotel costs.              <-- not built
   |
   v
[Itinerary]   Sequences activities into days.                    <-- not built
   |
   v
[Critic]      Checks feasibility and budget. Can send work back. <-- not built
   |          Max 2 revision rounds.
   v
[Writer]      Formats the final plan for the user.               <-- not built
```

Only **Intake** exists today. That is intentional — see §6.

---

## 2. Key concepts (skip if these are familiar)

**Agent SDK** — `@anthropic-ai/claude-agent-sdk`. The library that lets your code send a
prompt to Claude and get a response back. It is the same engine Claude Code runs on, exposed
as a package you can build applications with.

**Schema** — a machine-readable definition of what a piece of data must look like. We use
[Zod](https://zod.dev) for this. A schema says "a TripBrief must have a `destinations` field
which is an array of strings, and a `nights` field which is a number or null."

**Validation** — checking real data against a schema. If an agent returns something that
does not match, we catch it immediately rather than letting broken data flow downstream.

**Eval** — an automated test for AI output. Unlike a normal unit test, you cannot check for
an exact string, because model output varies. So you check *properties*: "did it extract
2 travellers?", "did it avoid inventing a destination?"

**Agent boundary** — the handoff point between two agents. Every boundary in this project has
a schema. That is the single most important design decision in the codebase.

---

## 3. Architectural rules

These live in `../CLAUDE.md` at the repo root, which Claude Code reads automatically at the
start of every session. That is what keeps AI-assisted edits consistent with the design
instead of drifting.

### Rule 1 — Schemas are the contract

Every agent returns JSON validated against a Zod schema in `src/schemas/index.ts`. No agent
returns prose. No agent returns an untyped object.

*Why:* without this, an agent renames a field, the next agent silently reads `undefined`,
and you debug for an hour with no error message. You saw this happen in §5.

### Rule 2 — No agent does arithmetic or geometry

Budget totals, distances, travel times, currency conversion, "does this fit in a day" — all
of it lives in `src/checks/` and `src/tools/` as plain TypeScript.

*Why:* a language model will produce a number that looks right and is wrong. Asked to convert
£3000 to dollars it will use a rate from its training data and give you a plausible figure
that is months out of date. Code with a real rate cannot do that.

### Rule 3 — No agent calls an external API directly

All network access goes through a wrapper in `src/tools/`.

*Why:* so it can be mocked in evals, cached, and swapped out without touching agent code.

### Rule 4 — Every loop has a hard cap

Retries, revisions, parallel fan-out — all capped by numbers in `src/config.ts`.

*Why:* two agents disagreeing with each other will argue until your credit runs out.

### Rule 5 — Model routing is deliberate

Cheap fast model for extraction and lookup. Reasoning model for planning and critique.

*Why:* cost. A multi-agent system can burn several times the tokens of a single chat, and
most of the work does not need the expensive model.

---

## 4. What exists, file by file

```
VoyageMind/
├── CLAUDE.md                    Architectural rules. Claude Code reads this automatically.
├── README.md                    Setup instructions and build order.
├── package.json                 Dependencies and npm scripts.
├── tsconfig.json                TypeScript config (strict mode on).
├── .env                         Your API key. Never committed.
├── .env.example                 Template showing what keys are needed. Committed.
├── .gitignore                   Keeps .env and node_modules out of git.
│
├── .claude/agents/              Subagents that help you DEVELOP (not part of the app)
│   ├── schema-guardian.md         Read-only reviewer. Checks code follows the rules above.
│   └── eval-runner.md             Runs evals and explains failures.
│
├── src/
│   ├── index.ts                 Entry point. `npm run dev -- "your request"`
│   ├── config.ts                Model routing and all the hard caps.
│   │
│   ├── schemas/index.ts         ALL agent contracts. The most important file in the repo.
│   │                            TripBrief, Destination, Activity, DayPlan, Itinerary,
│   │                            CritiqueResult.
│   │
│   ├── agents/
│   │   ├── run.ts               Shared runner. Every agent goes through this.
│   │   ├── intake.ts            BUILT. Free text -> TripBrief.
│   │   ├── research.ts          Stub.
│   │   ├── itinerary.ts         Stub.
│   │   └── critic.ts            Stub.
│   │
│   ├── checks/feasibility.ts    Deterministic checks: budget, transit time, opening
│   │                            hours, distance between stops, date ranges.
│   │
│   └── tools/currency.ts        BUILT. Currency conversion with placeholder rates.
│                                First entry in the tools layer.
│
└── evals/
    ├── cases/intake.json        10 test cases with property assertions.
    └── run.ts                   Eval runner.
```

### The two files worth actually reading

**`src/schemas/index.ts`** defines what data flows between agents. Change this and everything
downstream changes with it. Start here when you want to understand the system.

**`src/agents/run.ts`** is the shared plumbing every agent uses. It does four things:

1. Takes a Zod schema and converts it to JSON Schema (`z.toJSONSchema`), then injects that
   into the system prompt. **This means the prompt can never drift out of sync with the
   schema.** Add a field to `TripBriefSchema` and Intake's prompt updates automatically.
2. Calls the model.
3. Strips markdown fences and parses the JSON.
4. Validates against the schema. On failure, it feeds the validation error *back* to the
   model and retries, up to `LIMITS.maxSchemaRetries`.

---

## 5. Setup log — what broke and why

Worth keeping. Most of these will recur on your personal machine.

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | `git remote add <url>` gave a usage dump | Command needs a *name* and a URL | `git remote add origin <url>` |
| 2 | `npm install` failed with ERESOLVE | I pinned zod v3; the Agent SDK needs zod v4 | `"zod": "^4.0.0"` |
| 3 | `tsc not recognized` | Cascade from #2 — devDependencies never installed | Fixed itself once install worked |
| 4 | 5 typecheck errors in `feasibility.ts` | `noUncheckedIndexedAccess` flags `day.stops[i-1]` as possibly undefined | Hoisted into a checked local variable |
| 5 | esbuild postinstall blocked | npm 11 blocks postinstall scripts by default | `npm approve-scripts esbuild` |
| 6 | `OAuth session expired` | **Nothing in the scaffold loaded `.env`** — Node does not do this automatically | Added `--env-file=.env` to the npm scripts |
| 7 | `Credit balance is too low` | API key valid, Console workspace has $0 | Switched to the OAuth session from the VS Code extension |
| 8 | Schema validation failed 3x | **The prompt never told the model the schema**, so it invented one | Generate JSON Schema from Zod, inject into prompt |
| 9 | `multi-city` eval failed | Schema had only `budget_total_usd`; user said £3000 | Split into `budget_amount` + `budget_currency` |

**#8 and #9 are the interesting ones.**

In #8, the model returned `{destination: "Tokyo", duration_days: 5}` — sensible-looking, and
completely incompatible with the schema. It had no way to know the real field names. Without
schema validation, `brief.destinations` would have been `undefined` three agents later.

In #9, the eval caught a hole in the *design*, not the prompt. Given £3000, the model
correctly refused to invent an exchange rate and returned null. The schema simply had nowhere
to record "3000 pounds". This is exactly what evals are for.

---

## 6. Why the build order is what it is

The orchestrator is deliberately not written yet, and neither are five of the six agents.

The temptation with multi-agent systems is to build the coordination layer first, because it
is the interesting part. That produces a system where agents hand unreliable output to each
other and no single component is trustworthy. Debugging it means debugging six things at once.

Building one agent to completion — schema, prompt, evals, all passing — establishes the
pattern. Every subsequent agent is then a variation on something proven.

### Current milestone: DONE
- [x] Repo, git, dependencies, auth
- [x] Schemas for the full pipeline
- [x] Shared runner with validation and retry
- [x] Intake agent
- [x] Eval harness, 10 cases
- [x] Deterministic feasibility checks
- [x] First tool (`currency.ts`)

### Next milestone: the data layer
This is the part with no AI in it, and it is the part that decides whether the project ships.

A travel planner is only as good as its access to real places, prices, and availability.
Options to investigate:

- **Places/POIs:** Google Places API, or OpenStreetMap/Overpass (free, messier data)
- **Flights/hotels:** Amadeus self-service tier is the usual starting point
- **Weather, visa rules, general research:** web search

If real inventory proves hard to get, narrow the scope: an **itinerary** planner (what to do,
in what order, how long between things) is still a real product and drops the hardest
dependency. Do not let this decision drift.

### After that
1. Research agent — uses the tools, returns `Destination[]`, runs in parallel
2. Itinerary + Critic — build as a pair, they only make sense together
3. Orchestrator — by then it is wiring, not design

---

## 7. Running it

```bash
npm run dev -- "5 days in Tokyo in October, two of us, about 4000 dollars"
npm run eval                    # all 10 cases
npm run eval -- multi-city      # one case
npm run typecheck               # tsc, should print nothing
```

### Working across two machines

Everything transfers through git except `.env`, which is correct — each machine
authenticates separately. `git pull` before you start, `git push` before you stop.

On the personal machine:
```bash
git clone https://github.com/zareenzia/VoyageMind.git
cd VoyageMind
npm install
npm approve-scripts esbuild
cp .env.example .env
```

**Do not copy the office API key to the personal machine.** It belongs to an employer's
Console workspace.

### Auth, current state

Running on the OAuth session from the VS Code Claude Code extension, not the API key
(that workspace has $0 balance). This is fine for development. It will expire periodically
and produce an opaque auth error — see §5 #7 so you recognise it fast.

For anything unattended or user-facing, this needs proper API billing with a spend cap.

---

## 8. Working with Claude Code on this repo

Open the VS Code integrated terminal in `D:\VoyageMind` and run `claude`. It reads
`../CLAUDE.md` automatically, so it starts with the architecture already in context.

Useful openers:

> Read CLAUDE.md, then use the schema-guardian subagent to review the current code.

> Add a Places tool in src/tools/ following the pattern in currency.ts. Wrapper only,
> no agent code yet.

> npm run eval is failing on <case-id>. Read the case, read the intake prompt, and tell me
> what is wrong before changing anything.

That last pattern — asking for diagnosis before edits — is worth making a habit. It is much
easier to catch a wrong theory than to unpick a wrong change.

---

## 9. Cost

Multi-agent systems fan out, and fan-out multiplies token spend. Roughly 7x a single-threaded
session is a reasonable planning assumption for subagent-heavy workflows.

Current spend is negligible: one eval run is ten short prompts on the fast model. The cost
grows when Research starts running in parallel across candidate destinations, and again if
the Critic loop is uncapped — which is why `LIMITS.maxRevisionRounds` exists.

Cache destination research aggressively. Kyoto's attractions do not change weekly.
