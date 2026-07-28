/**
 * Elevation lookup via Open-Meteo — free, keyless. Used as a cheap, sourced proxy
 * for terrain difficulty between two points (see estimateTransitMinutes in
 * src/checks/feasibility.ts) — not because elevation alone fully describes a
 * route, but because it's real data a flat speed assumption doesn't have.
 *
 * Same tool discipline as places.ts/geocode.ts: disk cache — permanent, elevation
 * is geology and does not change — 1 req/s, descriptive User-Agent, backoff on
 * 429/5xx.
 *
 * Cached per POINT, not per request batch: a coordinate looked up once, in any
 * combination with any other points, is never fetched again. Batching by request
 * is purely a network-efficiency detail (see MAX_COORDINATES_PER_REQUEST) and
 * must not become part of the cache key.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LIMITS } from "../config.js";

const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

// TODO: replace with a real contact URL/email before this runs unattended.
const USER_AGENT = "VoyageMind/0.1 (AI travel planner, dev use; contact: set in src/tools/elevation.ts)";

const DEFAULT_CACHE_DIR = path.resolve(".cache", "elevation");

const MIN_REQUEST_INTERVAL_MS = 1000;

// Open-Meteo's documented limit: "Up to 100 coordinates can be requested at once."
const MAX_COORDINATES_PER_REQUEST = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ElevationLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElevationLookupError";
  }
}

interface GeoPoint {
  lat: number;
  lng: number;
}

// --- Network + rate limiting (mirrors places.ts / geocode.ts) --------------

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

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

/** One rate-limited Open-Meteo call for up to MAX_COORDINATES_PER_REQUEST points,
 * with capped backoff on 429/5xx. No caching. Order of results matches `points`. */
export async function fetchElevationsRaw(points: GeoPoint[]): Promise<number[]> {
  const url = new URL(ELEVATION_URL);
  url.searchParams.set("latitude", points.map((p) => p.lat).join(","));
  url.searchParams.set("longitude", points.map((p) => p.lng).join(","));

  for (let attempt = 0; ; attempt++) {
    const response = await throttled(() => fetch(url, { headers: { "User-Agent": USER_AGENT } }));

    if (response.ok) {
      const body = (await response.json()) as { elevation: number[] };
      return body.elevation;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= LIMITS.maxToolRetries) {
      throw new ElevationLookupError(
        `Open-Meteo elevation request failed: ${response.status} ${response.statusText}`,
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 2 ** attempt * 1000;
    await sleep(backoffMs);
  }
}

function cacheKeyFor(point: GeoPoint): string {
  // Fixed precision so cache keys are stable regardless of float noise.
  return createHash("sha256").update(`${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).digest("hex");
}

interface CacheEntry {
  fetched_at: string;
  elevation_m: number;
}

async function readPointCache(key: string, cacheDir: string): Promise<number | null> {
  try {
    const raw = await readFile(path.join(cacheDir, `${key}.json`), "utf-8");
    return (JSON.parse(raw) as CacheEntry).elevation_m;
  } catch {
    return null;
  }
}

async function writePointCache(key: string, elevationM: number, cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const entry: CacheEntry = { fetched_at: new Date().toISOString(), elevation_m: elevationM };
  await writeFile(path.join(cacheDir, `${key}.json`), JSON.stringify(entry), "utf-8");
}

/**
 * Elevation in metres for each point, in order. Cache hits cost nothing; misses
 * are batched up to MAX_COORDINATES_PER_REQUEST per request, chunked as needed.
 */
export async function getElevations(
  points: GeoPoint[],
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<number[]> {
  if (points.length === 0) return [];

  const keys = points.map(cacheKeyFor);
  const results: (number | null)[] = [];
  for (const key of keys) {
    results.push(await readPointCache(key, cacheDir));
  }

  const missingIndices = results.reduce<number[]>((acc, value, i) => {
    if (value === null) acc.push(i);
    return acc;
  }, []);

  for (let i = 0; i < missingIndices.length; i += MAX_COORDINATES_PER_REQUEST) {
    const batchIndices = missingIndices.slice(i, i + MAX_COORDINATES_PER_REQUEST);
    const batchPoints = batchIndices.map((idx) => points[idx]!);
    const fresh = await fetchElevationsRaw(batchPoints);

    for (let j = 0; j < batchIndices.length; j++) {
      const idx = batchIndices[j]!;
      results[idx] = fresh[j]!;
      await writePointCache(keys[idx]!, fresh[j]!, cacheDir);
    }
  }

  return results as number[];
}
