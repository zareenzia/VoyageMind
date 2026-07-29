# VoyageMind

### *Your Intelligent AI Travel Companion*

**Tagline:** *Plan smarter. Travel better.*

---

# 0. How to read this document

This is the specification Claude Code works from. It is deliberately opinionated: where a
choice exists, one option is picked and the reasoning recorded, because a spec that hedges
produces a codebase that hedges.

**§1–5** are the product vision — what VoyageMind is for.
**§6–10** are the technical design — what gets built and why.
**§11–13** are scope control — what gets built *first*, and what explicitly does not.

If you disagree with a decision in §6, change it there and note the date. Do not leave two
options alive in the document.

---

# 1. Vision

VoyageMind is an **AI-native travel planning platform** where several AI agents collaborate
to build a trip for one specific traveller.

It is **not** a booking platform.
It is **not** Google Maps.
It is **not** another TripAdvisor.

> The goal is an AI travel companion that understands the traveller, plans the trip,
> continuously improves it, and proactively assists before, during, and after the journey.

Traditional travel apps make the user search hotels, weather, transport and attractions
separately, then assemble the result in their head. VoyageMind does the assembly.

---

# 2. What makes this hard (and therefore worth building)

Stating this up front because it determines every design decision below.

1. **Travel data is real-time and gated.** Prices, availability and opening hours change
   daily. A model's training data cannot supply them. The quality ceiling of this product is
   set by the tool layer, not the AI layer.
2. **Feasibility is geometric and arithmetic.** "Does this day work" is a question about
   distance, opening hours and clock time. Models are bad at this and confidently so.
3. **Vagueness is the input format.** Real requests are "somewhere warm in December, maybe
   two grand". Turning that into a plan requires knowing what you *don't* know.
4. **Errors compound across agents.** One agent's plausible-but-wrong output becomes the
   next agent's premise. Without validated boundaries, the failure surfaces five steps later
   with no traceable cause.

Everything in §6 onward exists to address one of these four.

---

# 3. Project goals

This project demonstrates, in roughly this order of priority:

| Capability | Phase |
|---|---|
| Multi-agent AI with validated boundaries | 0 |
| Tool/function calling against real APIs | 0 |
| Automated evaluation of AI output | 0 |
| Agent orchestration | 1 |
| RAG over destination knowledge | 2 |
| Long-term memory and personalisation | 2 |
| Human approval workflow | 2 |
| MCP tool exposure | 3 |
| Event-driven architecture | 3 |
| Microservices | 3 |
| Production observability | 3 |

**The ordering is the point.** Kafka and microservices are listed last not because they are
unimportant but because they are the wrong problems to solve while the agent layer is
unproven. A distributed system of unreliable agents is harder to debug than a monolith of
unreliable agents, and it is not more impressive.

---

# 4. Target users

Solo travellers · Couples · Families · Students · Backpackers · Business travellers

**Primary persona for Phase 0:** a solo or couple traveller planning a 3–7 day regional trip
on a defined budget. Narrow deliberately. Family logistics and multi-city business itineraries
are harder and can wait.

---

# 5. Example user stories

**Story 1 — the core loop**
> "I have 4 days to visit Meghalaya with a budget of BDT 45,000."

VoyageMind produces transport options, a day-by-day itinerary, weather-aware scheduling,
hotel suggestions, and a cost estimate that adds up.

**Story 2 — personalisation**
> "I love photography."

Future plans favour sunrise viewpoints and schedule golden-hour timing.

**Story 3 — replanning**
> "My budget increased to 70,000."

The plan is revised, not regenerated from scratch — better lodging, an added destination.

**Story 4 — proactive assistance**
> Heavy rain forecast on day 3.

Outdoor activities swap to indoor, the user is notified, and the change is explained.

Stories 2–4 are Phase 2+. **Story 1 is Phase 0** and is the only one that matters right now.

---

# 6. Decisions

Each decision is dated and reversible. Change the entry, do not add a second option.

### D1 — Stack: TypeScript for the agent layer (2026-07-28)

**Decision:** Node.js + TypeScript, using the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`).

**Why:** a working Intake agent, schema layer, eval harness and feasibility checks already
exist in this stack and pass their tests. Rewriting proven code in Java to satisfy a stack
preference is the most expensive kind of premature decision.

**On the original Java 21 / Spring Boot / Spring AI plan:** it is a reasonable choice and
likely closer to your day-job strength. If demonstrating Spring competence is a primary goal,
the right move is *not* to rewrite the agent layer — it is to add Java platform services in
Phase 3 (User, Trip, Notification) and keep the AI Orchestrator as a Node service behind an
HTTP boundary. That is a legitimate polyglot microservice architecture and it demonstrates
both. Do not attempt it before Phase 3.

**On OpenAI Responses API vs Claude:** pick one provider. Two providers means two SDKs, two
billing accounts and two sets of prompt quirks for zero benefit. Current choice is Claude,
because the Agent SDK gives tool execution, subagents and session handling out of the box,
and because development can run on an existing Claude Code subscription rather than metered
API credit.

### D2 — Agents are for judgement; code is for everything else (2026-07-28)

A component is an **agent** only if its job requires interpretation, synthesis, or
judgement under ambiguity. If the job is "fetch X", "sum Y", or "look up Z", it is a
**tool** — plain code, no model call.

This collapses the original eleven agents into five. See §7.

**Why:** cost scales with agent count; correctness does not. Deterministic operations
implemented as model calls are slower, more expensive, and occasionally wrong in ways that
are hard to detect.

### D3 — Every agent boundary is a validated schema (2026-07-28)

All inter-agent data is JSON validated against a Zod schema in `src/schemas/`. Validation
failures retry with the error fed back, capped at 2 retries.

**Why:** this rule has already caught two real bugs during Phase 0 — an agent inventing its
own field names, and a currency gap in the schema design.

### D4 — Monolith first, services later (2026-07-28)

Phases 0–2 run as a single Node process with one Postgres database. Service extraction
happens in Phase 3, along the seams already marked in §9.

**Why:** you cannot draw correct service boundaries before you know how the system behaves.
Extracting services from a working monolith is a well-understood refactor. Guessing
boundaries up front and discovering them wrong is not.

### D5 — Scope: itinerary planning, not booking (2026-07-28)

VoyageMind recommends and schedules. It does not transact. Booking links point out to
providers.

**Why:** booking requires payment handling, provider contracts, cancellation policy, and
liability. It is a different product. This also removes the hardest data dependency —
real-time inventory — and makes the project achievable.

### D6 — Database: Postgres, hosted on Neon (2026-07-28)

**Decision:** Postgres remains the database. It is hosted on **Neon** (serverless Postgres)
rather than run locally in Docker.

To be precise about what this is and is not: Neon *is* Postgres — fully compatible, no fork,
no middleware layer. Schema, SQL, migrations, ORM choice and the `pgvector` plan for Phase 2
are all unchanged. This decision is about hosting, not about the database.

**Why Neon specifically:**
- **Two machines.** Development happens on an office PC and a personal PC. A hosted database
  means one connection string in each `.env` and identical data on both, with no local
  instance to keep in sync.
- **No Docker prerequisite.** Nothing to start before `npm run dev` works.
- **Branching.** Branches are instant copy-on-write clones. This gives a disposable database
  per eval run or per feature, which matters once evals start writing rows.
- **pgvector is supported**, so the Phase 2 RAG plan is unaffected.
- **Scale-to-zero.** An idle database costs essentially nothing, which suits a project that
  gets touched a few evenings a week.

**Practical notes for whoever implements Phase 1:**
- Two connection strings are issued. Use the **pooled** endpoint (hostname contains
  `-pooler`) for application queries; use the **direct** endpoint for migrations and admin
  tasks. Pooling is PgBouncer-based.
- `DATABASE_URL` goes in `.env`, which is gitignored. It is a credential — treat it like the
  API key.
- Connection strings require SSL. Most drivers handle this from the URL parameters.
- Watch for anything that holds a connection open permanently (health-check polling, a
  frontend refetch interval). Those defeat scale-to-zero and quietly keep the compute meter
  running.
- No superuser role, and extensions are limited to Neon's supported list. `pgvector` is on it;
  verify before depending on anything niche.

**Alternatives considered:** local Postgres in Docker (rejected — adds a prerequisite to every
test run and diverges between two machines), Supabase (a broader platform including auth and
storage; a reasonable choice, but the extra surface is not needed while §12 rules out most of
what it bundles).

---

# 7. Agents and tools

## 7.1 The five agents

Each has one job, a defined input schema, and a defined output schema.

### 1. Intake Agent ✅ BUILT
Free text → `TripBrief`.

Extracts destination, dates, party size, budget (amount + currency, never converted), pace,
interests, dietary needs, mobility needs, visa constraints. Records what it *cannot*
determine in `open_questions` rather than guessing.

*Not in the original spec, and its absence was a gap.* Without it, every downstream agent
re-interprets the raw user text and they disagree with each other.

### 2. Guide Agent
`TripBrief` → `Destination[]`

Researches candidate destinations and activities. Uses the Places tool and (Phase 2) RAG over
destination knowledge. Runs in parallel, one instance per candidate destination, capped by
`LIMITS.maxParallelResearch`.

Absorbs the original **Local Guide**, **Recommendation** and part of **Safety**.

### 3. Itinerary Agent
`Destination[]` + `TripBrief` → `Itinerary`

Sequences activities into days. Considers geography, opening hours, travel time, and pace.
Does not compute the numbers — it *proposes*, and the Critic verifies. Concretely: the
model's own output is an ORDER (day slot, base city, an ordered list of activity
`osm_type`/`osm_id` pairs) — no clock times at all. Code walks that order and attaches
`start`/`end`/`transit_minutes_from_previous` afterward. If the model can't state a time, it
can't state a wrong one — same discipline as the Guide agent never restating `centre`.

**`TripBrief.nights === null` is a hard stop, not a guess (decided 2026-07-29).** Building a
schedule requires knowing how many days it covers; inventing a length (even a "reasonable
default" like 3 nights) is fabricating a fact Intake should have caught. Phase 0's Itinerary
agent throws clearly when `nights` is null, naming what's missing. The durable fix belongs one
stage upstream: this should be an Intake `open_questions` entry that blocks the pipeline before
Itinerary is ever invoked, not something Itinerary discovers and works around. Revisit once
there's an orchestrator step (or human-approval flow, Phase 2) that can act on `open_questions`
before continuing — for now, throwing is the honest Phase 0 behaviour.

**No lodging or transport tool exists yet (Phase 0 limitation).** `DayPlan.lodging_cost_usd`
and `Itinerary.flights_cost_usd` are nullable for exactly this reason — there is nothing to
source a real figure from, and a model guess here would flow straight into the budget hard
failure as a fabrication laundered into a "hard" result. `computeTotalUsd` returns a total plus
an `estimated_total_complete` flag; the budget check still hard-fails when the *known* costs
alone already exceed the stated budget (costs are never negative, so that's sound even when
incomplete), and only downgrades to a note when the partial total looks fine but isn't the
whole picture.

### 4. Critic Agent
`Itinerary` → `CritiqueResult`

Two-part verdict:
- **Hard failures** from `src/checks/feasibility.ts` — deterministic, objective, computed in
  code. Over budget, impossible transit, venue closed that day, day too long.
- **Soft notes** from model judgement — dull sequencing, three museums in a row, nothing
  booked for the evening.

**`verdict` and `hard_failures` are code-computed, never the model's call (decided
2026-07-29).** `checkItinerary()` runs first; the model receives the itinerary and the
already-computed hard failures as context and produces only `soft_notes`/`suggested_fixes`.
Code sets `verdict` deterministically from `hard_failures.length`. Otherwise a model
eventually rationalizes `verdict: "pass"` on an over-budget plan that reads well, and that one
failure mode undoes the entire checks layer. The Critic agent itself is two-state
(`pass`/`revise`) — `infeasible` is not a model opinion or something Critic decides on its
own; it's `orchestrator.ts` relabelling a `revise` verdict once `maxRevisionRounds` is
exhausted with hard failures still outstanding, since round-counting is already that file's
job (see below).

Can return work to the Itinerary Agent. Hard cap of 2 revision rounds.

### 5. Writer Agent
`Itinerary` → user-facing plan

Formats the final output. Explains reasoning and surfaces open questions and assumptions.

**Phase 1, not Phase 0** (decided 2026-07-28). Phase 0 ends at a validated `Itinerary`
JSON object, pretty-printed by the CLI — see §11. Output formatting is a decision about a
rendering surface, and Phase 0 has no rendering surface yet beyond a terminal; designing
Writer's prose before the React frontend exists means designing it twice.

## 7.2 The tool layer — not agents

| Original "agent" | What it actually is | Where it lives |
|---|---|---|
| Budget Agent | Arithmetic | `src/checks/feasibility.ts` |
| Currency conversion | Lookup + division | `src/tools/currency.ts` ✅ BUILT |
| Weather Agent | API call | `src/tools/weather.ts` |
| Transportation Agent | API call + deterministic ranking | `src/tools/transport.ts` |
| Hotel Agent | API call + deterministic ranking | `src/tools/lodging.ts` |
| Visa Agent | Structured lookup (RAG in Phase 2) | `src/tools/visa.ts` |
| Safety Agent | API/feed lookup | `src/tools/advisories.ts` |
| Memory Agent | Database read/write | `src/memory/` |
| Distance / travel time | Haversine + routing API | `src/checks/feasibility.ts` ✅ BUILT |

**Ranking deserves a note.** "Rank hotels by rating, distance, price, amenities" is a
weighted sort — code, and better as code because the weights become tunable and explainable.
Where genuine judgement is needed ("which of these three suits a photographer?"), the Guide
Agent makes that call over an already-filtered shortlist. Filter with code, choose with a model.

## 7.3 Workflow

```
User request
     |
     v
[Intake Agent]  ---------> TripBrief  (+ open_questions)
     |
     v
[Guide Agent] x N in parallel  <--- Places / Weather / Advisories tools
     |
     v
   Destination[]
     |
     v
[Itinerary Agent]  <--- Lodging / Transport tools
     |
     v
  Itinerary  ------------------+
     |                         |
     v                         |
[Critic Agent]                 | max 2 rounds
     |  <--- feasibility.ts    |
     |      (deterministic)    |
     +--- revise -------------+
     |
     v  pass
=================================  Phase 0 ends here — validated Itinerary
[Writer Agent]                     JSON, pretty-printed by the CLI. Writer
     |                              and human review are Phase 1, alongside
     v                              the frontend Writer's output is for.
Human review  ---> Save trip
```

---

# 8. Data model

Defined in `src/schemas/index.ts` as Zod schemas. These are the contracts; they are the
source of truth for the whole system.

| Schema | Purpose | Status |
|---|---|---|
| `TripBrief` | Structured user intent | ✅ Built |
| `Activity` | A single thing to do, with location, hours, cost, duration | ✅ Built |
| `Destination` | A place plus its candidate activities | ✅ Built |
| `DayPlan` | One day of scheduled stops | ✅ Built |
| `Itinerary` | The full plan | ✅ Built |
| `CritiqueResult` | Verdict plus hard failures and soft notes | ✅ Built |
| `TravellerProfile` | Long-term memory | Phase 2 |
| `TripRecord` | Persisted trip with version history | Phase 1 |

Persistence: **PostgreSQL on Neon** (see D6). Enable the `pgvector` extension in Phase 2 for
RAG rather than running a separate vector database — one fewer moving part, and adequate at
this scale.

Connection is via `DATABASE_URL` in `.env`, using Neon's pooled endpoint for application
queries and the direct endpoint for migrations.

---

# 9. Architecture

## Phase 0–2: modular monolith

```
        React frontend  (Phase 1)
               |
          HTTP / SSE
               |
     +---------------------+
     |   Node + TypeScript |
     |                     |
     |  orchestrator.ts    |
     |  agents/            |
     |  tools/             |
     |  checks/            |
     |  memory/            |
     +---------------------+
               |
      Postgres on Neon
        (+ pgvector, Phase 2)
```

Single process, single database. Module boundaries inside `src/` are drawn along the seams
we would eventually split on.

## Phase 3: extraction

Split along boundaries that have proven real:

- **AI Orchestrator** (Node) — agents, tools, orchestration
- **Trip Service** — trips, itineraries, versions
- **User Service** — auth, profile, preferences, memory
- **Notification Service** — weather alerts, reminders

Event bus at this point, and **RabbitMQ before Kafka** unless you specifically want Kafka
operational experience. Kafka's guarantees are not required by this workload and its
operational burden is significant for one developer.

Java/Spring Boot is a reasonable choice for the platform services if D1's note applies.

---

# 10. Cost model

Non-negotiable constraints, encoded in `src/config.ts`:

| Control | Value | Reason |
|---|---|---|
| `maxRevisionRounds` | 2 | Critic and Itinerary can otherwise argue indefinitely |
| `maxSchemaRetries` | 2 | Bounded recovery from malformed output |
| `maxParallelResearch` | 4 | Main fan-out multiplier |
| Model routing | fast for Intake/Guide, reasoning for Itinerary/Critic | Most work does not need the expensive model |

Cache destination research aggressively — a city's attractions do not change weekly.
Subagent-heavy workflows can run several times the token cost of a single-threaded session;
the five-agent design in §7 exists partly to keep that multiplier survivable.

**Measured latency (2026-07-28):** a single Overpass query over the full Meghalaya bounding
box (~300km across, all categories) took **43 seconds**, before any model call. With
`maxParallelResearch` at 4, one Guide call alone is comfortably in double-digit seconds once
its own model turn is added, and the full pipeline — N parallel Guides, then Itinerary, then
up to 2 Critic/Itinerary revision rounds — is **comfortably 90s+ end to end**. This is the
concrete number behind CLAUDE.md's orchestrator rule ("the orchestrator emits progress events
from day one"): a 30–90 second wait with no feedback is not a UI polish question, it's the
difference between a working product and one that looks hung. The Phase 1 frontend's need for
SSE streaming rests on this measurement, not an estimate.

**Development is currently running on a Claude Code subscription session, not metered API
credit.** Before anything runs unattended or serves a second user, this needs a proper API
key with a spend cap.

---

# 11. Phases

### Phase 0 — Walking skeleton ← YOU ARE HERE
One vertical slice, working end to end, for one hardcoded destination type.

Four agents, not five — Writer is Phase 1 (decided 2026-07-28, see §7.1). Phase 0's
"user-facing" output is validated JSON, pretty-printed by the CLI; there is no prose
formatting step until there's a frontend for Writer to format for.

- [x] Schemas for the full pipeline
- [x] Shared agent runner with validation and capped retry
- [x] Intake Agent, 10/10 evals
- [x] Deterministic feasibility checks
- [x] Currency tool
- [x] Places tool — real API, real data (Overpass, geocode.ts for bbox/centre/country)
- [x] Guide Agent, 3/3 evals
- [ ] **Itinerary Agent** ← next, built as a pair with Critic
- [ ] Critic Agent
- [ ] Orchestrator wiring Intake, Guide, Itinerary, and Critic together
- [ ] CLI produces a real, feasible 4-day Meghalaya itinerary as validated JSON

**Done when:** Story 1 works from the command line, printing validated `Itinerary` JSON.
No UI, no database, no auth, no prose formatting.

### Phase 1 — Product
- Neon Postgres persistence, trip versions, migrations
- React frontend, streaming progress
- **Writer Agent** — `Itinerary` → user-facing plan, built alongside the frontend it renders
  for (moved from the Phase 0 agent list — see §7.1)
- Auth and user accounts
- Trip CRUD, save, revisit

### Phase 2 — Intelligence
- RAG over destination guides via pgvector
- `TravellerProfile` long-term memory feeding Intake and Guide
- Replanning (Story 3) — revise an existing plan rather than regenerate
- Human approval workflow before saving or exporting

### Phase 3 — Production architecture
- Service extraction along §9 boundaries
- Event bus, weather-triggered replanning (Story 4)
- MCP tool exposure
- Observability: OpenTelemetry, Langfuse for LLM traces, Prometheus/Grafana

### Phase 4 — Advanced
Collaborative planning, offline itineraries, post-trip journal, MCP expansion.

---

# 12. Non-goals

Written down so they stop being tempting.

- **Booking or payment.** See D5.
- **Real-time inventory.** Prices are estimates, clearly labelled as such.
- **Every country.** Pick 2–3 regions with good data coverage and do them well.
- **Mobile apps.** Responsive web only.
- **Multi-provider AI abstraction.** One provider. Swap later if needed; do not abstract now.
- **Microservices before Phase 3.** See D4.

---

# 13. Working agreements

**Evals gate changes.** `npm run eval` before every commit. A regression blocks the change
even if types pass.

**Schema before agent.** New agent → its input and output schemas go into
`src/schemas/index.ts` first. Prompts derive their contract from the schema automatically, so
they cannot drift.

**One agent at a time, to completion.** Schema, prompt, evals passing, committed. Then the
next. The orchestrator is written *after* the agents it orchestrates, not before.

**Diagnosis before edits.** When something fails, ask Claude Code what is wrong before asking
it to fix anything. Catching a wrong theory is cheaper than unpicking a wrong change.

**Commit with the eval count.** `"Guide agent 8/10 — fails on multi-city"`. When something
regresses six agents later, that history is how you find it.
