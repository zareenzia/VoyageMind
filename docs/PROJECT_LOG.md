# VoyageMind — Project Log

**Last updated:** 4 August 2026
**Status:** Phase 1 in progress. All five agents built and evaluated. Neon trip persistence
(D7/D8), React frontend with SSE run streaming and a rendered written plan, and the Writer
agent. Authentication is deliberately *not* built — see §8, where trying to build it as a side
effect cost a day.

Read §5 for the design lesson (five blocked fabrications) and §8 for the process one (a branch
that was reported done, never merged, and got reimplemented from scratch).

---

## 1. What this project is

VoyageMind is a **multi-agent travel planner**. Instead of one AI doing everything, five
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
Validated Itinerary + CritiqueResult
   |
   v
[Writer]      Itinerary + TripBrief -> user-facing prose. 5/5 evals. Runs ONLY on
              a `pass`, and its failure is swallowed — prose is presentational and
              last, so losing it must never turn a validated Itinerary into a
              failed run (runWriterStage).
```

Writer was Phase 1 by design, alongside the frontend it renders for — see spec §7.1. Phase 0
ended at validated JSON, not prose, so that prose never became the thing holding up a
correctness milestone.

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

## 7. Phase 1 — what's built

**Trip persistence (spec D7, D8).** Runs stay in-memory (`InMemoryRunStore`) for SSE replay; a
`trips` table gets one row on a payload-bearing terminal event, and none at all for
`run_blocked`/`run_failed` — there's no itinerary to store and the client already has the
message. Ownership is an anonymous client-generated token: a "my trips" filter, explicitly not
an access check, so `getTrip(id)` takes no token and any trip is readable by id like an unlisted
URL. Payloads are JSONB behind a `schema_version` gate — a mismatch, or a same-version parse
failure, degrades to a read-only summary instead of throwing. `TRIP_SCHEMA_VERSION` is
hand-bumped and hand-bumped constants drift, so a snapshot test hashes the stored schemas'
structural JSON Schema (descriptions stripped) and fails the build if a shape moves without the
constant moving too.

One contract (`store.contract.ts`) runs against both `InMemoryTripStore` (in `npm test`) and
`NeonTripStore` against real Neon (`npm run test:neon`, manual). One set of assertions, no
divergent fake — the alternative is green tests over a broken production path, which §8 turns
out to be partly about.

**Frontend + SSE.** A 30–90s pipeline with no feedback looks hung rather than slow (§11), which
is why the orchestrator emitted progress events from day one. The frontend attaches over SSE
with replay from `Last-Event-ID`, plus a sweep that marks a run abandoned after 5 minutes of
silence so a client fails cleanly instead of hanging on a dead connection. A saved trip is
converted into the same `RunEvent` shape a live run produces, so both render through one view.

**Writer.** The fifth agent, and the only one whose output is prose rather than data for a
downstream agent. What it took to make that prose honest is §8's second half.

---

## 8. 4 August 2026 — the branch that never merged

The most expensive day of the project so far, and none of it was a coding mistake.

### The failure

Phase 1's persistence work — migration, `TripStore`, the contract suite, `schema_version`, the
drift guard, `legacy-summary.ts` — was committed to a branch called `UI`, reported as done, and
**never merged to `main`**.

Everything that came after started from a `main` where none of it existed, correctly concluded
that persistence hadn't been built yet, and built it again from scratch. The reimplementation
was competent and typechecked. It also:

- dropped `schema_version`, `TRIP_SCHEMA_VERSION` and the drift-guard snapshot, so JSONB
  payloads became unversioned and ungated
- dropped `legacy-summary.ts`, so a schema change would render unvalidated data as if valid
  rather than degrading to a notice
- dropped `store.contract.ts` and both store implementations, replacing them with raw `getDb()`
  calls and **no tests at all**
- swapped `pg` for `@neondatabase/serverless` — the HTTP driver, meant for runtimes that can't
  hold a TCP connection, in a long-running `node:http` server. Its concrete cost: `INSERT` then
  `UPDATE` in `addTripVersion` as two independent round trips with no transaction, so a failure
  between them leaves a version row committed while `current_version` never advances
- added users, sessions, scrypt and JWTs, contradicting D7's anonymous owner token, plus a
  login screen the step brief had explicitly said not to build

It also produced a duplicate migration runner and a second, incompatible `trips` table that
could not coexist with the first in one database.

### Why "write D8 superseding D7" was the wrong fix

The obvious move was a spec entry retiring D7 in favour of accounts. That would have been
backfilled reasoning for a decision nobody took — the design didn't change, a branch went
missing. **A spec that records what happened cannot constrain what happens next**, and a
superseding entry written after the fact quietly converts a violated decision into an approved
one. Now CLAUDE.md rule 16.

### What was done instead

The unreviewed work was **preserved, not deleted** — it sits on `phase1-persistence-auth` in
two commits (Writer separated first so it stayed cherry-pickable), with the full reasoning in
the commit message, so the auth implementation survives as a starting point for a properly
reviewed auth step. The reviewed persistence was recovered from `UI`, rebased onto `main`, and
merged. Test count went 124 → 133 on the merge: recovering the branch *restored* nine tests
that the reimplementation had silently discarded.

Three rules came out of it: **15** (no auth without its own reviewed step — this was the second
time auth UI arrived attached to an unrelated task; `6f9d20b` is literally "remove premature
auth UI"), **16** (the spec is a review instrument, not a changelog), and a branch-hygiene
agreement: merge before starting the next task, and check `git log --oneline main..<branch>`
before building something that might already exist. "Reported as done" is not "on main".

It recurred the same day. Later, `main` was reported as merged and pushed when it was neither —
caught only by running `git merge-base --is-ancestor`, which is why that check is now written
down rather than remembered.

### The Writer review, and 3/3 passing by luck

The Writer agent was also built without review, so it was treated as a review rather than a
merge: cherry-picked to its own branch, and nothing merged until it had actually been run.

Its evals were reported as **3/3 passing**. They were, and it meant nothing:

1. `npm run eval -- writer` printed `0/0 passed` and **exited 0**. The filter matched case ids,
   never suite names, so "writer" selected nothing — a typo and a green run were
   indistinguishable, making rule 6 vacuous for any filtered invocation. A no-match filter now
   exits 1 and lists every suite and case id.
2. The three cases asserted only *shape* — `title_not_null`, `sections_min`,
   `practical_tips_min`. Nothing about fabrication or provenance. They could not have failed on
   the bug that was actually there.
3. Re-running the same suite unchanged produced a **different** result: one case ERRORed because
   `summary` exceeded its 800-character cap after three retries, while the prompt asked for
   "2-3 paragraphs". A live prompt/schema contradiction (rule 12), intermittent enough that the
   first run passed and looked like proof.

**The bug the shape tests couldn't see.** `estimated.hours` is not usually true — it is
*always* true, by construction: `research.ts` instructs the Guide agent to always set it,
because opening hours are estimated from the category and never sourced. So every clock time in
every itinerary is a guess. The Writer's prompt never mentioned the flag, and its own rule 1
example — *"If the itinerary says a place opens at 09:00, you say 09:00"* — directed the model
to restate that guess as fact, while rule 3 modelled "arrive by 9 AM" as house style. The prose
read as verified and dropped every provenance signal the rest of the system carries: the `~` in
`DayTimeline.tsx`, and `checkDay`'s "not verified (hours are estimated, not sourced)".

Fixed in both positions rule 12 requires, with evals that fail on the bug rather than on shape:
one case forbidding any unhedged clock time, and its mirror asserting that *sourced* hours may
still be stated precisely — without which the honest fix is to hedge everything
unconditionally, which throws away real information and is its own dishonesty. Measured:
**2/5 against the old prompt, 5/5 against the new one.**

Two more defects surfaced only by running things:

- **`runAgent` gave parse failures zero retries.** Malformed JSON escaped the retry loop as a
  raw `SyntaxError` while schema failures got `maxSchemaRetries` — and there were three escape
  paths, not one, because `extractJson` was called outside any `try`. Rule 1 says a validation
  failure is a typed retry, not a crash, and unparseable output is the most basic validation
  failure there is. It hits Writer hardest: long prose full of quotes and dashes.
- **The frontend build was broken on `main`, silently.** `npm run typecheck` only covered `src/`
  and `evals/`. `PipelineStage` had been hand-duplicated as a four-stage union in four frontend
  files, so adding the Writer stage invalidated every copy — rule 1 drift in exactly the
  direction "schemas are the contract" exists to prevent. Separately,
  `frontend/tsconfig.app.json` had no `"strict"`, and without `strictNullChecks` a
  boolean-literal discriminant doesn't narrow, so `if (!result.ok)` silently failed to select
  the branch. `typecheck` now runs both.

And the gap that mattered most: **the honesty fix reached nobody.** `writer_output` appeared
nowhere in `frontend/src`, so the prose and its `caveats` — added specifically so a reader is
*told* the hours aren't verified rather than left to infer it from hedging — existed only behind
a CLI flag no user runs. `tripRecordToRunEvent` also dropped `writer_output`, so every saved
trip would have rendered without prose, making D8's "store rather than regenerate" argument
moot. Both fixed; caveats render above the day narrative, because hedged wording only reads as
honesty if you already know why it's hedged.

### The through-line

Every failure this day was a **verification** failure, not a logic one. A branch reported done
without checking where. Tests that passed without asserting anything that could fail. A green
`typecheck` that didn't cover half the code. A suite whose filter silently selected nothing.
Each one produced a confident green signal over an unexamined path — which is the same failure
mode as §5's fabrications, one level up: a plausible-looking result that nothing distinguishes
from a real one.

---

## 9. Setup log — what broke and why (historical; environment/tooling issues from early setup)

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

## 10. Running it

```bash
npm run dev -- "4 days in Meghalaya, BDT 45,000"   # full pipeline, validated Itinerary JSON
npm run dev -- --pretty "..."                       # rendered itinerary + written plan
npm run server                                      # HTTP + SSE run streaming on :8787
npm run build --prefix frontend                     # tsc -b && vite build
npm run eval                                        # all five suites
npm run eval -- writer                              # one suite by name
npm run eval -- <case-id-substring>                 # or any case whose id matches
npm run test                                        # vitest — checks/, tools/, trips/, agents/
npm run typecheck                                   # server AND frontend, should print nothing
npm run migrate                                     # migrations/*.sql, needs DATABASE_URL_UNPOOLED
npm run test:neon                                   # TripStore contract vs real Neon, manual
```

A filter matching no cases **exits 1** and lists the available suites and case ids. It used to
print `0/0 passed` and exit 0, which made a typo indistinguishable from a green run — see §8.

`npm run typecheck` covers `frontend/` as well as `src/`. Until 2026-08-04 it didn't, and the
frontend build was broken on `main` for a day with nothing reporting it.

`npm run dev` prints progress events to stderr (stage/status/message) as the pipeline runs —
30-90 seconds is normal (measured: a single Overpass query over a full state's bounding box
alone took 43 seconds) — then the validated `Itinerary` JSON to stdout, followed by the
Critic's verdict, hard failures, notes, and suggested fixes. With `--pretty`, the Writer's plan
follows, ending with its caveats under "Before you go".

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

## 11. Cost and latency

**Measured, not assumed (2026-07-28):** a single Overpass query over a full state's bounding
box (~300km across, all categories) took 43 seconds, before any model call. With
`maxParallelResearch` at 4 and the Itinerary/Critic revision loop on top, the full pipeline is
comfortably 90s+ end to end — the concrete number behind the orchestrator's progress-event
requirement (rule 11) and the Phase 1 frontend's need for SSE, not an estimate.

Cache destination research aggressively — a region's attractions don't change weekly, and
every network tool in this project (`currency`, `places`, `geocode`, `elevation`) caches to
disk for exactly this reason. Current eval spend is one live run of five short suites (24 cases
across Intake/Guide/Itinerary/Critic/Writer); it grows with Guide's parallel fan-out and again
with however many revision rounds a given itinerary actually needs.

Worth knowing before iterating on the Writer: its evals are the cheapest to run but the easiest
to over-run. Getting the prompt right took four full suite runs, and two of them failed for
reasons unrelated to the change under test — a schema cap and an intermittent JSON parse error.
Budget for re-runs, and read which case failed rather than the pass count.

---

## 12. Working with Claude Code on this repo

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
