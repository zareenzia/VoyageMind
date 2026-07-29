# VoyageMind — Project Log (Phase 0 Retrospective)

**Last updated:** 29 July 2026
**Status:** Phase 0 complete. Four agents (Intake, Guide, Itinerary, Critic) plus the
orchestrator, all evals passing, verified end-to-end against the spec's own headline example
(`npm run dev -- "4 days in Meghalaya, BDT 45,000"`). Phase 1 (persistence, frontend, Writer)
next.

---

## 1. What this project is

VoyageMind is a **multi-agent travel planner**. Instead of one AI doing everything, four
specialised agents each handle one job and pass structured data to the next one, with
deterministic code doing everything that isn't judgement.

Why not just one big prompt? Because a single agent asked to "plan a trip" has to
simultaneously interpret vague requests, look up real places, sequence activities
geographically, and check the budget. It will do all four badly and you cannot tell which
part failed. Splitting them means each agent has one job you can test in isolation — and,
as it turned out, means the arithmetic/geometry/sourcing that agent would have gotten wrong
can be pulled out into code entirely. §5 is the record of exactly which fields that applied to
and how each one was actually resolved.

### The pipeline, as built

```
User: "4 days in Meghalaya, BDT 45,000"
   |
   v
[Intake]      Free text -> TripBrief. 10/10 evals.
   |
   v
[Guide]       TripBrief -> Destination[]. Geocodes + queries OpenStreetMap per
   |          destination (parallel, capped). 3/3 evals.
   v
[Itinerary]   Destination[] + TripBrief -> Itinerary. Model proposes an ORDER;
   |          code attaches every date/time/transit-duration. 3/3 evals.
   v
[Critic]      Itinerary -> CritiqueResult. verdict is code-computed from
   |          checkItinerary(), never the model's call. 3/3 evals.
   |  <-- capped revision loop (orchestrator.ts), max 2 rounds -->
   v
Validated Itinerary + CritiqueResult, pretty-printed by the CLI.
```

Writer (`Itinerary` -> user-facing prose) is Phase 1, alongside the frontend it renders for —
see spec §7.1. Phase 0 ends at validated JSON, not prose.

---

## 2. Key concepts (skip if these are familiar)

**Agent SDK** — `@anthropic-ai/claude-agent-sdk`. Lets code send a prompt to Claude and get a
response back.

**Schema** — a machine-readable definition of what a piece of data must look like ([Zod](https://zod.dev)).
A schema says "a TripBrief must have a `destinations` field which is an array of strings."

**Judgment schema** — a pattern used four times over (Guide, Itinerary, Critic, Intake): the
model's own output schema OMITS any field that's a sourced fact or a computed value, even
when that field appears on the final merged object. `DestinationJudgmentSchema` has no
`centre`; `ItineraryJudgmentSchema` has no clock times at all; `CritiqueJudgmentSchema` has no
`verdict`; `TripBriefJudgmentSchema` has no `start_date`. If the model can't state a field, it
can't state a wrong one — see §5 for why this kept coming up.

**Validation** — checking real data against a schema, catching broken data at the boundary
instead of three agents later.

**Eval** — a property-based test for AI output ("did it extract 2 travellers?", "did it avoid
inventing a destination?"), never an exact-string match, since model output varies.

**Agent boundary** — the handoff point between two agents, always schema-validated. The
single most important design decision in the codebase.

---

## 3. Architectural rules

These live in `../CLAUDE.md`, which Claude Code reads automatically every session. Full
rationale and current wording live there — this is a pointer, not a duplicate, since keeping
the same rule written out in two places is exactly the kind of drift this project has spent
effort eliminating.

Briefly: schemas are the contract (rule 1); agents are for judgement, code is for everything
else — arithmetic, geometry, dates (rule 2); no agent touches an external API directly (rule
3); every loop has a hard numeric cap (rule 4); model routing is deliberate, cheap model for
extraction, reasoning model for planning/critique (rule 5); evals gate every change (rule 6);
facts and estimates are different types of thing and the code has to know which is which
(rule 9) — §5 below is that rule in practice, five times over.

---

## 4. What was built, and in what order

Not the originally-planned order — the actual one, which surfaced dependencies the plan
didn't anticipate (`geocode.ts` turned out to be a prerequisite for `places.ts`'s bbox query;
`elevation.ts` turned out to be a prerequisite for a defensible transit-time estimate).

1. **Schemas + shared agent runner** (`agents/run.ts`) — schema-derived prompts, capped
   validation retry. Every agent since has gone through this unchanged, except for one
   addition: an optional post-schema `validate` hook (added when Guide needed to reject
   fabricated place references), reusing the same retry loop for business-rule failures, not
   just shape failures.
2. **Intake**, 10/10 evals.
3. **The tool layer**: `currency.ts` (reference implementation — deterministic, disk-cached,
   a clear TODO where a live rate replaces the placeholder table) · `places.ts` (Overpass) ·
   `geocode.ts` (Nominatim) · `elevation.ts` (Open-Meteo) · `dates.ts` (pure date
   construction, deliberately kept out of `checks/` — see §3's rule 2 note). All four network
   tools follow the same discipline: disk cache, 1 req/s, descriptive User-Agent, backoff on
   429/5xx.
4. **Guide**, 3/3 evals. First use of the "judgment schema" pattern and the `validate` hook.
5. **`checks/feasibility.ts`** extended with `estimateTransitMinutes` (elevation-tiered) and
   partial-total budget handling, ahead of Itinerary needing them.
6. **Itinerary + Critic**, built as a pair, 3/3 evals each — Itinerary's output is a bare
   ordering; Critic's verdict is code-computed from `checkItinerary()`.
7. **`orchestrator.ts`** — last, once every agent it coordinates passed its own evals. Progress
   events, capped Guide fan-out, the capped revision loop, `infeasible` applied here (never
   the Critic's own call, since round-counting was already this file's job).
8. **The date-arithmetic fix** — the last rule-2 violation, found via a flaky eval rather than
   a design review. See §5, case 4.

---

## 5. The five blocked-fabrication cases

This is the part worth actually reading. Five times, a schema needed a field with no
legitimate source, and the design treated that as a blocker to solve deliberately rather than
a gap for a model to quietly fill. Each one, if filled by a plausible-looking guess instead,
would have been indistinguishable from real data downstream — which is the specific failure
mode CLAUDE.md rule 9 exists to name and prevent.

### Case 1 — `budget_currency` from "around 2 grand"

**The gap:** a budget figure with no stated currency. "2 grand" is a number, not a number in a
currency.

**The wrong fix:** guess USD (or worse, guess the destination's local currency — conflating
"the traveller's money" with "where they're going," a different kind of wrong). Either way,
a confident-looking budget that might be off by the exchange rate.

**What we did:** `budget_currency: z.string().length(3).nullable()`, explicitly null when the
text doesn't name one, with an `open_questions` entry. Conversion — once a currency IS known —
happens in `tools/currency.ts` with a real rate table (currently a placeholder with a TODO,
never the model doing arithmetic in its head).

### Case 2 — coordinates from `destinations: ["Meghalaya"]`

**The gap:** Guide needs real lat/lng to query Overpass; a destination NAME isn't a
coordinate.

**The wrong fix:** ask the model for the coordinates directly. A model asked for Meghalaya's
centre produces a plausible-looking pair that's wrong by tens of kilometres — and the
resulting bug is silent, since nothing about a slightly-wrong coordinate looks wrong.

**What we did:** `tools/geocode.ts` (Nominatim) — a real, sourced centre point AND a bounding
box, not just a point. The bbox mattered concretely: a 20km radius around Meghalaya's
centroid would have missed Sohra, which is where essentially all the real candidates turned
out to be.

### Case 3 — `transit_minutes_from_previous` with no routing source

**The gap:** `ScheduledStopSchema` requires a transit duration between every pair of stops.
No routing API is in scope for Phase 0 (OSRM's public demo has no availability guarantee;
self-hosting is out of scope).

**The wrong fix, considered and rejected:** a flat haversine-distance/fixed-speed constant —
badly wrong for hill terrain (20km of Meghalaya hill road is closer to 90 minutes than 20).
Also rejected: a formula that LOOKS road-aware (sampling OSM `highway=*` tags "along the
route") without real routing underneath — worse than an honest constant, because it gets
trusted more while being no more accurate ("along the route" presupposes a route, which is
exactly what's missing).

**What we did:** `estimateTransitMinutes` — three terrain tiers (flat/hilly/very_steep) chosen
from a real, sourced signal: elevation delta between two stops (Open-Meteo, batched, cached
permanently), not fabricated road-class awareness. `transit_source: "unknown"` when even
elevation is unavailable, which downgrades the relevant hard checks (`IMPOSSIBLE_TRANSIT`,
`TOO_MUCH_TRANSIT`, `DAY_TOO_LONG`) to notes rather than trusting a guessed number as fact.

Verified against real data before finalizing the tiers: Sohra to the Nongriat double-decker
root bridge is a measured 959m elevation drop over 6.49km straight-line (148m/km) — done on
foot down thousands of steps, not a road at all. A two-tier model would have priced that as a
20-minute hill-road drive; the third tier exists specifically because that's the kind of
optimistic wrong answer that makes "hard failure" meaningless, and it would have hit a real,
already-selected activity.

### Case 4 — `DayPlan.date` from a brief with no dates

**The gap:** Story 1 itself — "4 days in Meghalaya, BDT 45,000" — gives no explicit dates.
`DayPlan.date` is a required calendar date, and `checkDay` derives a weekday from it for
`closed_days` checks.

**The wrong fix:** silently default to "next month." Demonstrably wrong for this project's own
example: at the time this was fixed, "next month" was September — peak monsoon for Sohra,
exactly the season `best_months` exists to steer away from.

**What we did:** `Itinerary.dates_provisional` + `tools/dates.ts` (`pickProvisionalDates` /
`combineBestMonths`), informed by the Guide agent's own `best_months` rather than an arbitrary
offset, with `CLOSED_THAT_DAY` downgraded to a note (not a hard failure) whenever the date is
provisional — the weekday itself is notional, not just unverifiable.

This surfaced a twin violation of the same rule, one layer up: Intake was ALSO resolving
relative dates ("this Saturday", "next weekend") by inference, which is date arithmetic done
by a model — and it failed exactly the way rule 2 predicts: silently, plausibly,
intermittently. One eval case ("this Saturday" -> a Friday, not a Saturday) flaked across
reruns before this was traced to its actual cause. Fixed with `date_expression`, a structured
field (`explicit` / `next_weekday` + a this/next/bare qualifier / `month_only` +
`part_of_month` / `flexible_window`) that the model states and `tools/dates.ts` resolves
deterministically against `today`. The model names what the text said; it never computes a
date.

### Case 5 — lodging and flight costs with no tool behind them

**The gap:** `DayPlan.lodging_cost_usd` and `Itinerary.flights_cost_usd` were required numbers
in the schema from before Phase 0's tool-building work even started, and no lodging or
transport tool exists yet.

**The wrong fix:** let the model estimate them. The fabrication would flow straight into
`computeTotalUsd` and become part of the `OVER_BUDGET` hard-failure check — a guess laundered
into a "hard," supposedly-objective result.

**What we did:** made both nullable. `computeTotalUsd` returns `{ total_usd, complete }`, and
`checkBudget` still hard-fails when the KNOWN costs alone already exceed the stated budget
(sound even when incomplete, since every cost term is non-negative — the real total can only
be larger), downgrading to a note only when the partial total looks fine but isn't the whole
picture. `Itinerary.estimated_total_complete` carries this distinction downstream.

---

## 6. Empirical findings (matter when a second region is added)

Two facts, measured rather than assumed, that shaped `tools/places.ts`'s OSM tag mapping —
recorded here because they won't be re-discovered by reading the code, and a second region
will need the same kind of check, not an assumption that Meghalaya's tagging generalizes.

**`waterway=waterfall`, not `natural=waterfall`.** OSM's waterfall tagging is a genuinely
unresolved split (the `waterway=waterfall` proposal was superseded by `natural=waterfall` but
never formally approved) — both remain in real-world use. Empirically, in the full Meghalaya
sample, **every single waterfall was tagged `waterway=waterfall`; none used
`natural=waterfall`.** Querying only the "correct" successor tag would have returned zero
waterfalls for the region containing Nohkalikai Falls, the Seven Sisters, and Wei Sawdong.

**Roughly half of matched OSM elements have no name and get dropped.** Two independent
samples agreed closely: an initial 20km-radius query around Sohra dropped 85/173 elements
(49%) for lacking a `name`/`name:en` tag; a later full-state query dropped 202/414 (49%). The
drop itself is correct (`PlaceCandidate` can't invent a name, and an unnamed place can't
appear in an itinerary), but the rate is concentrated almost entirely in `waterfall` and
`viewpoint` categories — minor unnamed cascades and trailside viewpoints a surveyor tagged for
hydrology/geography reasons, not `attraction`, which was 23/24 named. A second region with
different mapper conventions could show a very different distribution; this isn't a constant
to assume, it's a number worth re-measuring.

---

## 7. Setup log — what broke and why (historical; environment/tooling issues from early setup)

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | `git remote add <url>` gave a usage dump | Command needs a *name* and a URL | `git remote add origin <url>` |
| 2 | `npm install` failed with ERESOLVE | Pinned zod v3; the Agent SDK needs zod v4 | `"zod": "^4.0.0"` |
| 3 | `tsc not recognized` | Cascade from #2 — devDependencies never installed | Fixed itself once install worked |
| 4 | 5 typecheck errors in `feasibility.ts` | `noUncheckedIndexedAccess` flags `day.stops[i-1]` as possibly undefined | Hoisted into a checked local variable |
| 5 | esbuild postinstall blocked | npm 11 blocks postinstall scripts by default | `npm approve-scripts esbuild` |
| 6 | `OAuth session expired` | Nothing in the scaffold loaded `.env` — Node doesn't do this automatically | Added `--env-file=.env` to the npm scripts |
| 7 | `Credit balance is too low` | API key valid, Console workspace has $0 | Switched to the OAuth session from the VS Code extension |
| 8 | Schema validation failed 3x | The prompt never told the model the schema, so it invented one | Generate JSON Schema from Zod, inject into prompt |
| 9 | `multi-city` eval failed | Schema had only `budget_total_usd`; user said £3000 | Split into `budget_amount` + `budget_currency` |

**#8 and #9 were the interesting ones** — #8 is why `runAgent` derives every prompt's schema
section from Zod rather than hand-written text; #9 is the first instance of what §5 is a
whole document of: an eval catching a hole in the *design*, not the prompt.

---

## 8. Running it

```bash
npm run dev -- "4 days in Meghalaya, BDT 45,000"   # full pipeline, validated Itinerary JSON
npm run eval                                        # all suites (Intake/Guide/Itinerary/Critic)
npm run eval -- <case-id-substring>                 # filter to matching cases, any suite
npm run test                                        # vitest — checks/ and tools/ unit tests
npm run typecheck                                   # tsc, should print nothing
```

`npm run dev` prints progress events to stderr (stage/status/message) as the pipeline runs —
30-90 seconds is normal (measured: a single Overpass query over a full state's bounding box
alone took 43 seconds) — then the validated `Itinerary` JSON to stdout, followed by the
Critic's verdict, hard failures, notes, and suggested fixes.

### Working across two machines

Everything transfers through git except `.env` — each machine authenticates separately.
`git pull` before starting, `git push` before stopping.

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

Running on the OAuth session from the VS Code Claude Code extension, not the API key (that
workspace has $0 balance). Fine for development; expires periodically with an opaque auth
error (see #7 above). Anything unattended or user-facing needs proper API billing with a
spend cap before it runs.

---

## 9. Cost and latency

**Measured, not assumed (2026-07-28):** a single Overpass query over a full state's bounding
box (~300km across, all categories) took 43 seconds, before any model call. With
`maxParallelResearch` at 4 and the Itinerary/Critic revision loop on top, the full pipeline is
comfortably 90s+ end to end — the concrete number behind the orchestrator's progress-event
requirement (rule 11) and the Phase 1 frontend's need for SSE, not an estimate.

Cache destination research aggressively — a region's attractions don't change weekly, and
every network tool in this project (`currency`, `places`, `geocode`, `elevation`) caches to
disk for exactly this reason. Current eval spend is one live run of four short suites
(19 cases total across Intake/Guide/Itinerary/Critic); it grows with Guide's parallel fan-out
and again with however many revision rounds a given itinerary actually needs.

---

## 10. Working with Claude Code on this repo

Open the VS Code integrated terminal in `D:\VoyageMind` and run `claude`. It reads
`../CLAUDE.md` automatically.

Useful openers:

> npm run eval is failing on <case-id>. Read the case, read the relevant prompt, and tell me
> what's wrong before changing anything.

> Add a <name> tool in src/tools/ following the pattern in currency.ts/places.ts. Wrapper
> only, no agent code yet — propose the schema first.

Diagnosis before edits is worth making a habit regardless of who or what is doing the editing.
It's much easier to catch a wrong theory than to unpick a wrong change — §5 exists because
that habit was applied to design gaps, not just bugs.
