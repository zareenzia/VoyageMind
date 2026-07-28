/**
 * Forward geocoding via Nominatim (OpenStreetMap's own geocoder) — free, keyless.
 * Resolves a place name to a sourced centre point, bounding box, and country. A
 * model asked for a region's coordinates produces plausible numbers that are
 * wrong by tens of kilometres; this is code precisely so that can't happen. See
 * CLAUDE.md rules 2 and 3.
 *
 * The bounding box matters as much as the centre point: a large region (a whole
 * state, say) is not well represented by "centre + a sensible radius" — a radius
 * search around the centroid can miss the one town where everything actually is.
 * findPlaces() has a bbox query mode for exactly this reason.
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * is strict about heavy use: at most 1 req/s, identify the client, cache
 * aggressively. Same tool discipline as places.ts — disk cache (no TTL, place
 * names don't move), 1 req/s, descriptive User-Agent, backoff on 429/5xx.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LIMITS } from "../config.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// TODO: replace with a real contact URL/email before this runs unattended — see
// the Nominatim usage policy linked above.
const USER_AGENT = "VoyageMind/0.1 (AI travel planner, dev use; contact: set in src/tools/geocode.ts)";

const DEFAULT_CACHE_DIR = path.resolve(".cache", "geocode");

const MIN_REQUEST_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeocodeNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`No geocoding result for "${query}"`);
    this.name = "GeocodeNotFoundError";
  }
}

export class GeocodeLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodeLookupError";
  }
}

export interface GeoBoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface GeocodeResult {
  /** Nominatim's own display name for what it resolved the query to — useful for
   * confirming "Meghalaya" resolved to the state and not, say, a street of the
   * same name somewhere else. */
  name: string;
  centre: { lat: number; lng: number };
  bbox: GeoBoundingBox;
  /** From Nominatim's address breakdown. Null if it genuinely didn't return one —
   * never guessed. */
  country: string | null;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
}

interface NominatimResult {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  // Nominatim's own order: [south, north, west, east], each a string.
  boundingbox: [string, string, string, string];
  address?: { country?: string };
}

// --- Network + rate limiting + cache (mirrors src/tools/places.ts) ---------

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

/** Serializes all Nominatim requests to at most 1/second, in call order. */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    const waitMs = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();
    return task();
  });
  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

/** One rate-limited Nominatim call with capped backoff on 429/5xx. No caching. */
export async function fetchNominatimRaw(query: string): Promise<NominatimResult[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");

  for (let attempt = 0; ; attempt++) {
    const response = await throttled(() =>
      fetch(url, { headers: { "User-Agent": USER_AGENT } }),
    );

    if (response.ok) return (await response.json()) as NominatimResult[];

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= LIMITS.maxToolRetries) {
      throw new GeocodeLookupError(
        `Nominatim request failed: ${response.status} ${response.statusText}`,
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 2 ** attempt * 1000;
    await sleep(backoffMs);
  }
}

function cacheKeyFor(query: string): string {
  // Normalized so "Meghalaya" and " meghalaya " share a cache entry.
  return createHash("sha256").update(query.trim().toLowerCase()).digest("hex");
}

interface CacheEntry {
  /** No TTL — place names and their boundaries don't move. Exists purely so a
   * stale-looking result can be diagnosed later. */
  fetched_at: string;
  results: NominatimResult[];
}

async function readCache(key: string, cacheDir: string): Promise<NominatimResult[] | null> {
  try {
    const raw = await readFile(path.join(cacheDir, `${key}.json`), "utf-8");
    return (JSON.parse(raw) as CacheEntry).results;
  } catch {
    return null;
  }
}

async function writeCache(key: string, results: NominatimResult[], cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const entry: CacheEntry = { fetched_at: new Date().toISOString(), results };
  await writeFile(path.join(cacheDir, `${key}.json`), JSON.stringify(entry), "utf-8");
}

/** Never caches a zero-result response — that's as likely to be a transient
 * Nominatim hiccup as a genuinely nonexistent place, and with no TTL that
 * mistake would look like permanent data loss. Same reasoning as places.ts. */
async function fetchNominatimCached(query: string, cacheDir: string): Promise<NominatimResult[]> {
  const key = cacheKeyFor(query);
  const cached = await readCache(key, cacheDir);
  if (cached) return cached;

  const fresh = await fetchNominatimRaw(query);
  if (fresh.length > 0) await writeCache(key, fresh, cacheDir);
  return fresh;
}

function toGeocodeResult(result: NominatimResult): GeocodeResult {
  const [south, north, west, east] = result.boundingbox.map(Number) as [number, number, number, number];
  return {
    name: result.display_name,
    centre: { lat: Number(result.lat), lng: Number(result.lon) },
    bbox: { south, north, west, east },
    country: result.address?.country ?? null,
    osm_type: result.osm_type,
    osm_id: result.osm_id,
  };
}

export async function geocode(
  query: string,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<GeocodeResult> {
  const results = await fetchNominatimCached(query, cacheDir);
  if (results.length === 0) throw new GeocodeNotFoundError(query);
  return toGeocodeResult(results[0]!);
}
