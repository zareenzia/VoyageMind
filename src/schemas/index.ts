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
    .describe("e.g. 'somewhere warm', 'Southeast Asia' — when no destination is named"),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  nights: z.number().int().min(1).nullable(),
  flexible_dates: z.boolean(),
  travellers: TravellerSchema,
  budget_total_usd: z.number().positive().nullable(),
  budget_includes_flights: z.boolean(),
  pace: PaceSchema,
  interests: z.array(z.string()).describe("food, hiking, museums, nightlife, ..."),
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
});
export type Activity = z.infer<typeof ActivitySchema>;

export const DestinationSchema = z.object({
  name: z.string(),
  country: z.string(),
  centre: GeoPointSchema,
  why_it_fits: z.string().max(400),
  best_months: z.array(z.number().int().min(1).max(12)),
  activities: z.array(ActivitySchema),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const ScheduledStopSchema = z.object({
  activity: ActivitySchema,
  start: z.string().describe("HH:MM local"),
  end: z.string().describe("HH:MM local"),
  transit_minutes_from_previous: z.number().int().min(0),
});

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
