import { z } from "zod";

/**
 * The contracts between agents. Every handoff in the pipeline is one of these.
 * If you are adding an agent, add its schemas here FIRST.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const PaceSchema = z.enum(["relaxed", "moderate", "packed"]);

export const TravellerSchema = z.object({
  count: z.number().int().min(1).max(20),
  adults: z.number().int().min(1),
  children: z.number().int().min(0).default(0),
});

/**
 * Output of the Intake agent. This is the only structured representation of what
 * the user actually wants — everything downstream reads from it.
 *
 * Fields the user did not specify are null, never guessed. `open_questions` is how
 * Intake reports what it could not determine.
 */
export const TripBriefSchema = z.object({
  origin: z.string().nullable(),
  destinations: z.array(z.string()).describe("Named places, or [] if user was vague"),
  region_hint: z
      .string()
      .nullable()
      .describe(
          "Geographic hint ONLY when no place is named at all: 'somewhere warm', 'Southeast " +
          "Asia', 'anywhere in Europe'. If ANY place is named — including a whole country — " +
          "this is null and the place goes in destinations. A setting or landscape is NOT a " +
          "region hint: 'a beach in Thailand' -> destinations ['Thailand'], region_hint null, " +
          "interests ['beach'].",
      ),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  nights: z
      .number()
      .int()
      .min(1)
      .nullable()
      .describe(
          "Number of nights. CONVENTION: 'N days' means N-1 nights (a '5 day trip' is 4 " +
          "nights) — apply this exactly and add an open_question noting the assumption. " +
          "'N nights' is literal. 'a week' is 7. A single day is null, not 0. Null if not " +
          "determinable.",
      ),
  flexible_dates: z.boolean(),
  travellers: TravellerSchema,
  budget_amount: z
      .number()
      .positive()
      .nullable()
      .describe("The number the user said, in the currency they said it in. Never converted."),
  budget_currency: z
      .string()
      .length(3)
      .nullable()
      .describe(
          "ISO 4217 code, e.g. USD, GBP, EUR, BDT. Null in TWO cases: no budget was given at " +
          "all, OR an amount was given with no currency named (e.g. 'about 2 grand', " +
          "'around 5k'). Never guess a currency from the destination or from context. " +
          "Recording null and asking is correct; guessing is not.",
      ),
  budget_includes_flights: z.boolean(),
  pace: PaceSchema,
  interests: z
      .array(z.string())
      .describe(
          "What the user wants from the trip: activities (hiking, museums, nightlife, food) " +
          "AND desired settings or landscapes (beach, mountains, desert, city). If the user " +
          "describes a kind of place rather than naming one, it belongs here.",
      ),
  dietary: z.array(z.string()),
  mobility_needs: z.array(z.string()),
  visa_constraints: z.array(z.string()).describe("passport/nationality notes if mentioned"),
  must_include: z.array(z.string()),
  must_avoid: z.array(z.string()),
  open_questions: z
      .array(z.string())
      .describe("What Intake could not determine and a human should confirm"),
});
export type TripBrief = z.infer<typeof TripBriefSchema>;

export const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Which fields on an Activity are model-estimated rather than sourced fact.
 * `true` means "a model guessed this" — the Critic weights it accordingly and the
 * UI must label it. See CLAUDE.md rule 9.
 */
export const EstimatedFlagsSchema = z.object({
  duration: z.boolean(),
  cost: z.boolean(),
  hours: z.boolean(),
});
export type EstimatedFlags = z.infer<typeof EstimatedFlagsSchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  location: GeoPointSchema,
  address: z.string().nullable(),
  category: z.string(),
  duration_minutes: z.number().int().positive(),
  cost_usd_per_person: z.number().min(0),
  opens: z.string().nullable().describe("HH:MM local"),
  closes: z.string().nullable().describe("HH:MM local"),
  closed_days: z.array(z.number().int().min(0).max(6)).default([]),
  booking_required: z.boolean().default(false),
  notes: z.string().nullable(),
  osm_type: z
    .enum(["node", "way", "relation"])
    .describe(
      "Must be copied from one of the PlaceCandidates you were given — the type of " +
        "that exact candidate. Never a value you invented.",
    ),
  osm_id: z
    .number()
    .int()
    .describe(
      "Must be copied from one of the PlaceCandidates you were given — the id of " +
        "that exact candidate. Every Activity must trace back to a real candidate; " +
        "this is checked after you respond, and an id that doesn't match one you " +
        "were given fails validation.",
    ),
  estimated: EstimatedFlagsSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

/**
 * A tourist point of interest, normalized from OpenStreetMap tags. Category values
 * we currently query for — see src/tools/places.ts for the OSM tag mapping and the
 * precedence order used when an element matches more than one.
 */
export const PlaceCategorySchema = z.enum([
  "attraction",
  "museum",
  "gallery",
  "viewpoint",
  "artwork",
  "zoo",
  "theme_park",
  "aquarium",
  "picnic_site",
  "historic_site",
  "monument",
  "waterfall",
  "cave",
  "peak",
  "beach",
  "park",
  "garden",
  "nature_reserve",
]);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

/**
 * A fact as OpenStreetMap recorded it — never a model estimate. No duration, no
 * cost: those only exist once an Activity is built from this candidate, and even
 * then only under the `estimated` flags on ActivitySchema. See CLAUDE.md rule 9.
 */
export const PlaceCandidateSchema = z.object({
  source: z.enum(["osm"]).describe("Where this fact came from. Always 'osm' today."),
  osm_type: z.enum(["node", "way", "relation"]),
  osm_id: z.number().int(),
  name: z.string(),
  category: PlaceCategorySchema,
  location: GeoPointSchema,
  address: z
    .string()
    .nullable()
    .describe("Assembled from addr:* tags if present, else null. Never invented."),
  opening_hours_raw: z
    .string()
    .nullable()
    .describe(
      "The OSM 'opening_hours' tag verbatim, e.g. 'Mo-Fr 09:00-17:00; Sa off'. This is " +
        "raw OSM opening_hours syntax — copy it exactly, do not interpret, summarize, " +
        "translate, or reformat it into HH:MM. Null if the source has no opening_hours tag.",
    ),
  wikidata: z.string().nullable().describe("OSM 'wikidata' tag verbatim (e.g. 'Q12345'), or null."),
  wikipedia: z
    .string()
    .nullable()
    .describe("OSM 'wikipedia' tag verbatim (e.g. 'en:Cherrapunji'), or null."),
  prominence: z
    .number()
    .min(0)
    .describe(
      "A deterministic notability score computed from OSM tag signals — see " +
        "PROMINENCE_WEIGHTS in src/tools/places.ts. Not itself a sourced fact about the " +
        "place; a ranking signal only. Higher means more likely a genuine highlight. " +
        "findPlaces sorts by this but never filters on it — low scores can still be " +
        "useful filler for a quiet afternoon.",
    ),
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;

export const DestinationSchema = z.object({
  name: z.string(),
  country: z.string(),
  centre: GeoPointSchema,
  why_it_fits: z.string().max(400),
  // TODO: this is model judgement for now, per CLAUDE.md rule 6 that's a stopgap,
  // not a destination — climate has real data (Open-Meteo's historical endpoint)
  // and should eventually drive this instead of model recall. Recall gets the
  // facts right and the recommendation backwards: a model asked when to visit
  // Sohra, Meghalaya (one of the wettest places on Earth) may report its monsoon
  // season accurately while still recommending it for a sightseeing trip.
  best_months: z
    .array(z.number().int().min(1).max(12))
    .describe(
      "Months good for VISITING and doing things outdoors, not just months the " +
        "destination is 'in season' by some other measure. A place's wettest, " +
        "stormiest, or most extreme months are usually bad recommendations even if " +
        "locals or tourism boards talk about them positively.",
    ),
  activities: z.array(ActivitySchema),
});
export type Destination = z.infer<typeof DestinationSchema>;

/**
 * What the Guide agent's model call actually produces. `name`, `country`, and
 * `centre` are sourced facts (from the TripBrief and geocode.ts) known before the
 * model is ever called — asking the model to reproduce them would be asking it to
 * copy data it already has, for no benefit and a small risk it "helpfully"
 * changes something. See CLAUDE.md rules 2 and 9.
 */
export const DestinationJudgmentSchema = DestinationSchema.omit({
  name: true,
  country: true,
  centre: true,
});
export type DestinationJudgment = z.infer<typeof DestinationJudgmentSchema>;

/**
 * Never "estimated" the way EstimatedFlagsSchema means it — this is never a
 * model guess, always code-computed. What it distinguishes is which KIND of
 * code computed it: real routing (not built yet), the elevation-tiered
 * heuristic in checks/feasibility.ts, or "unknown" when even the heuristic's
 * input (elevation) was unavailable and the number is a flat-tier placeholder
 * that must not be trusted as a hard fact. See estimateTransitMinutes.
 */
export const TransitSourceSchema = z.enum(["routed", "heuristic", "unknown"]);
export type TransitSource = z.infer<typeof TransitSourceSchema>;

export const ScheduledStopSchema = z.object({
  activity: ActivitySchema,
  start: z.string().describe("HH:MM local"),
  end: z.string().describe("HH:MM local"),
  transit_minutes_from_previous: z.number().int().min(0),
  transit_source: TransitSourceSchema,
});
export type ScheduledStop = z.infer<typeof ScheduledStopSchema>;

export const DayPlanSchema = z.object({
  date: isoDate,
  base_city: z.string(),
  stops: z.array(ScheduledStopSchema),
  lodging_cost_usd: z.number().min(0),
  notes: z.string().nullable(),
});
export type DayPlan = z.infer<typeof DayPlanSchema>;

export const ItinerarySchema = z.object({
  brief_summary: z.string().max(600),
  days: z.array(DayPlanSchema).min(1),
  flights_cost_usd: z.number().min(0),
  estimated_total_usd: z
      .number()
      .min(0)
      .describe("Computed in src/checks/, never by a model. Present here for convenience only."),
});
export type Itinerary = z.infer<typeof ItinerarySchema>;

/** Output of the Critic. Deterministic checks + model judgement, merged. */
export const CritiqueResultSchema = z.object({
  verdict: z.enum(["pass", "revise", "infeasible"]),
  hard_failures: z.array(z.string()).describe("From src/checks/ — objective, not opinion"),
  soft_notes: z.array(z.string()).describe("Model judgement: dull day, bad sequencing, etc."),
  suggested_fixes: z.array(z.string()),
});
export type CritiqueResult = z.infer<typeof CritiqueResultSchema>;