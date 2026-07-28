/**
 * Places lookup. Wraps the Overpass API (OpenStreetMap) — free, keyless, no billing
 * account. See CLAUDE.md rule 10.
 *
 * Facts only. This file returns exactly what OSM tagged and nothing it did not:
 * no duration, no cost, no invented category. See CLAUDE.md rule 9 and
 * PlaceCandidateSchema in src/schemas/index.ts.
 *
 * TODO: opening_hours_raw is deliberately unparsed — OSM's opening_hours syntax
 * (https://wiki.openstreetmap.org/wiki/Key:opening_hours) is a small grammar of its
 * own. A deterministic parser belongs in src/checks/ once the Itinerary agent needs
 * structured hours, per CLAUDE.md rule 2 — not here, and not as a model's job.
 *
 * TODO: amenity=place_of_worship is deliberately excluded from CATEGORY_RULES for
 * now (monasteries and temples are a huge, noisy namespace). If a South Asian
 * destination comes back thin, this is the first tag to add — monasteries and
 * temples are major attractions across much of the region.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlaceCandidate, PlaceCategory } from "../schemas/index.js";
import { LIMITS } from "../config.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Overpass is a shared, overused public resource. Identify ourselves properly.
// TODO: replace with a real contact URL/email before this runs unattended — see
// https://wiki.openstreetmap.org/wiki/Overpass_API#Introduction for etiquette.
const USER_AGENT = "VoyageMind/0.1 (AI travel planner, dev use; contact: set in src/tools/places.ts)";

const DEFAULT_CACHE_DIR = path.resolve(".cache", "places");

const MIN_REQUEST_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlacesLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacesLookupError";
  }
}

export interface FindPlacesParams {
  lat: number;
  lng: number;
  radiusKm: number;
  categories: PlaceCategory[];
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface CategoryRule {
  key: string;
  values: string[];
  category: PlaceCategory;
}

/**
 * OSM tag -> PlaceCategory, in precedence order. When an element carries tags
 * matching more than one rule (e.g. tourism=attraction AND natural=waterfall), the
 * FIRST matching rule wins — earlier rows are more specific and take priority over
 * later, more generic ones. `tourism=attraction` is last: it is OSM's catch-all and
 * should only apply when nothing more specific matched.
 *
 * Row 1 covers both `natural=waterfall` and `waterway=waterfall`: OSM's waterfall
 * tagging is a genuinely unresolved split (the waterway=waterfall proposal was
 * superseded by natural=waterfall but never formally approved), and both remain in
 * active real-world use. Querying only one misses a large fraction of waterfalls.
 */
const CATEGORY_RULES: CategoryRule[] = [
  { key: "natural", values: ["waterfall"], category: "waterfall" },
  { key: "waterway", values: ["waterfall"], category: "waterfall" },
  { key: "natural", values: ["cave_entrance"], category: "cave" },
  { key: "natural", values: ["peak"], category: "peak" },
  { key: "natural", values: ["beach"], category: "beach" },
  { key: "historic", values: ["monument", "memorial"], category: "monument" },
  { key: "historic", values: ["castle", "fort", "ruins", "archaeological_site"], category: "historic_site" },
  { key: "tourism", values: ["viewpoint"], category: "viewpoint" },
  { key: "leisure", values: ["nature_reserve"], category: "nature_reserve" },
  { key: "leisure", values: ["garden"], category: "garden" },
  { key: "leisure", values: ["park"], category: "park" },
  { key: "tourism", values: ["museum"], category: "museum" },
  { key: "tourism", values: ["gallery"], category: "gallery" },
  { key: "tourism", values: ["artwork"], category: "artwork" },
  { key: "tourism", values: ["zoo"], category: "zoo" },
  { key: "tourism", values: ["theme_park"], category: "theme_park" },
  { key: "tourism", values: ["aquarium"], category: "aquarium" },
  { key: "tourism", values: ["picnic_site"], category: "picnic_site" },
  { key: "tourism", values: ["attraction"], category: "attraction" },
];

/** The Overpass QL query for a set of categories around a point. Deterministic —
 * same inputs always produce the same query string, which is also the cache key. */
export function buildOverpassQuery(params: FindPlacesParams): string {
  const requested = new Set(params.categories);
  const rulesToQuery = CATEGORY_RULES.filter((rule) => requested.has(rule.category));

  const valuesByKey = new Map<string, Set<string>>();
  for (const rule of rulesToQuery) {
    const values = valuesByKey.get(rule.key) ?? new Set<string>();
    for (const value of rule.values) values.add(value);
    valuesByKey.set(rule.key, values);
  }

  const radiusMeters = Math.round(params.radiusKm * 1000);
  const around = `around:${radiusMeters},${params.lat},${params.lng}`;

  const clauses: string[] = [];
  for (const [key, values] of valuesByKey) {
    const sortedValues = [...values].sort();
    const match =
      sortedValues.length === 1 ? `="${sortedValues[0]}"` : `~"^(${sortedValues.join("|")})$"`;
    for (const elementType of ["node", "way", "relation"] as const) {
      clauses.push(`  ${elementType}["${key}"${match}](${around});`);
    }
  }

  return `[out:json][timeout:25];\n(\n${clauses.join("\n")}\n);\nout center;`;
}

function classify(tags: Record<string, string>): PlaceCategory | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.values.includes(tags[rule.key] ?? "")) return rule.category;
  }
  return null;
}

function resolveName(tags: Record<string, string>): string | null {
  return tags["name:en"] ?? tags["name"] ?? null;
}

function resolveLocation(element: OverpassElement): { lat: number; lng: number } | null {
  if (element.type === "node") {
    return element.lat !== undefined && element.lon !== undefined
      ? { lat: element.lat, lng: element.lon }
      : null;
  }
  // Ways and relations have no lat/lon of their own — only `out center;` adds one.
  return element.center ? { lat: element.center.lat, lng: element.center.lon } : null;
}

function assembleAddress(tags: Record<string, string>): string | null {
  const line1 = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const parts = [line1, tags["addr:city"] ?? tags["addr:place"], tags["addr:postcode"]].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Weights for the deterministic prominence score. Tunable and explainable — change
 * a number here rather than re-deriving the formula. Every signal is something a
 * mapper chose to add, used only to rank candidates; it is not itself a sourced
 * fact (CLAUDE.md rule 9), and findPlaces sorts by it but never filters on it — a
 * low-prominence place may still be exactly the filler the Itinerary agent wants
 * for a quiet afternoon.
 */
const PROMINENCE_WEIGHTS = {
  /** Wikidata/Wikipedia presence is the strongest notability signal available. */
  wikidataOrWikipedia: 5,
  /** A mapper explicitly judged this a destination, not just a mapped feature. */
  tourismAttraction: 2,
  height: 1,
  website: 1,
  description: 1,
  wikimediaCommons: 1,
  /** Weak proxy: places with more tags tend to have had more mapper attention. */
  perTag: 0.1,
} as const;

function computeProminence(tags: Record<string, string>): number {
  let score = 0;
  if (tags["wikidata"] || tags["wikipedia"]) score += PROMINENCE_WEIGHTS.wikidataOrWikipedia;
  if (tags["tourism"] === "attraction") score += PROMINENCE_WEIGHTS.tourismAttraction;
  if (tags["height"]) score += PROMINENCE_WEIGHTS.height;
  if (tags["website"]) score += PROMINENCE_WEIGHTS.website;
  if (tags["description"]) score += PROMINENCE_WEIGHTS.description;
  if (tags["wikimedia_commons"]) score += PROMINENCE_WEIGHTS.wikimediaCommons;
  score += Object.keys(tags).length * PROMINENCE_WEIGHTS.perTag;
  return Math.round(score * 100) / 100;
}

export interface ParsedPlaces {
  candidates: PlaceCandidate[];
  /** Elements with no name:en/name tag — dropped, since an unnamed place cannot
   * appear in an itinerary. Log this: if it's most of the result set, the tag list
   * in CATEGORY_RULES needs revisiting, not the drop logic. */
  droppedUnnamed: number;
}

/** Pure — no network, no cache, no filesystem. Safe to test against a fixture. */
export function parseOverpassResponse(
  response: OverpassResponse,
  categories: PlaceCategory[],
): ParsedPlaces {
  const requested = new Set(categories);
  const candidates: PlaceCandidate[] = [];
  let droppedUnnamed = 0;

  for (const element of response.elements) {
    const tags = element.tags ?? {};
    const category = classify(tags);
    if (!category || !requested.has(category)) continue;

    const name = resolveName(tags);
    if (!name) {
      droppedUnnamed++;
      continue;
    }

    const location = resolveLocation(element);
    if (!location) continue; // defensive: a way/relation with no `center` from Overpass

    candidates.push({
      source: "osm",
      osm_type: element.type,
      osm_id: element.id,
      name,
      category,
      location,
      address: assembleAddress(tags),
      opening_hours_raw: tags["opening_hours"] ?? null,
      wikidata: tags["wikidata"] ?? null,
      wikipedia: tags["wikipedia"] ?? null,
      prominence: computeProminence(tags),
    });
  }

  return { candidates, droppedUnnamed };
}

// --- Network + rate limiting + cache ---------------------------------------

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

/** Serializes all Overpass requests to at most 1/second, in call order. */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    const waitMs = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();
    return task();
  });
  // Chain unconditionally so one failed request doesn't wedge the queue; the
  // failure still propagates to whoever awaits `scheduled`.
  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

/** One rate-limited Overpass call with capped backoff on 429/5xx. No caching. */
export async function fetchOverpassRaw(query: string): Promise<OverpassResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = await throttled(() =>
      fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "text/plain",
        },
        body: query,
      }),
    );

    if (response.ok) return (await response.json()) as OverpassResponse;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= LIMITS.maxToolRetries) {
      throw new PlacesLookupError(
        `Overpass request failed: ${response.status} ${response.statusText}`,
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 2 ** attempt * 1000;
    await sleep(backoffMs);
  }
}

function cacheKeyFor(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

interface CacheEntry {
  /** When this was actually fetched from Overpass. There is no TTL (OSM data
   * changes slowly — CLAUDE.md rule 10), so this exists purely so a stale-looking
   * result can be diagnosed later. Delete the file by hand to force a refetch. */
  fetched_at: string;
  response: OverpassResponse;
}

async function readCache(key: string, cacheDir: string): Promise<OverpassResponse | null> {
  try {
    const raw = await readFile(path.join(cacheDir, `${key}.json`), "utf-8");
    return (JSON.parse(raw) as CacheEntry).response;
  } catch {
    return null;
  }
}

async function writeCache(key: string, response: OverpassResponse, cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const entry: CacheEntry = { fetched_at: new Date().toISOString(), response };
  await writeFile(path.join(cacheDir, `${key}.json`), JSON.stringify(entry), "utf-8");
}

/** OSM data changes slowly (CLAUDE.md rule 10) — cached indefinitely, no TTL.
 * Delete a query's cache file by hand if it specifically needs a refresh.
 *
 * A response with zero elements is never cached. Overpass returning 200 with no
 * elements is indistinguishable, from here, between "this area genuinely has none
 * of these categories" and a transient degraded response from an overloaded public
 * instance — and caching the second case with no TTL would look like permanent
 * data loss for that region. */
async function fetchOverpassCached(query: string, cacheDir: string): Promise<OverpassResponse> {
  const key = cacheKeyFor(query);
  const cached = await readCache(key, cacheDir);
  if (cached) return cached;

  const fresh = await fetchOverpassRaw(query);
  if (fresh.elements.length > 0) await writeCache(key, fresh, cacheDir);
  return fresh;
}

export async function findPlaces(
  params: FindPlacesParams,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<PlaceCandidate[]> {
  const query = buildOverpassQuery(params);
  const response = await fetchOverpassCached(query, cacheDir);
  const { candidates, droppedUnnamed } = parseOverpassResponse(response, params.categories);

  if (droppedUnnamed > 0) {
    console.error(
      `[places] dropped ${droppedUnnamed}/${response.elements.length} unnamed element(s) ` +
        `for categories [${params.categories.join(", ")}] near (${params.lat}, ${params.lng}).`,
    );
  }

  return candidates.sort((a, b) => b.prominence - a.prominence);
}
