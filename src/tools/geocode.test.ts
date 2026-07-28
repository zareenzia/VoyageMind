import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNominatimRaw, GeocodeLookupError } from "./geocode.js";

// Recorded once from a live query for "Meghalaya, India" — see CLAUDE.md
// "No live network calls in tests."
const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "__fixtures__/nominatim-meghalaya.json"), "utf-8"),
);

function mockJsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("geocode — against the recorded Meghalaya fixture", () => {
  const originalFetch = global.fetch;
  let geo: typeof import("./geocode.js");
  let cacheDir: string;

  beforeEach(async () => {
    vi.resetModules();
    geo = await import("./geocode.js");
    cacheDir = await mkdtemp(path.join(tmpdir(), "voyagemind-geocode-test-"));
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("resolves centre, bbox (reordered from Nominatim's south/north/west/east array), and country", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(fixture)) as unknown as typeof fetch;

    const result = await geo.geocode("Meghalaya, India", cacheDir);

    expect(result.name).toBe("Meghalaya, India");
    expect(result.centre).toEqual({ lat: 25.5379432, lng: 91.2999102 });
    expect(result.bbox).toEqual({ south: 25.0306475, north: 26.1181651, west: 89.814444, east: 92.8027367 });
    expect(result.country).toBe("India");
    expect(result.osm_type).toBe("relation");
    expect(result.osm_id).toBe(2027521);
  });

  it("throws GeocodeNotFoundError rather than returning a guessed location", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse([])) as unknown as typeof fetch;

    await expect(geo.geocode("someplace that does not exist anywhere", cacheDir)).rejects.toThrow(
      geo.GeocodeNotFoundError, // must be the class from this same reimported instance, not the static import
    );
  });

  it("caches a successful lookup so a second identical query does not refetch", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(fixture)) as unknown as typeof fetch;

    await geo.geocode("Meghalaya, India", cacheDir);
    await geo.geocode("Meghalaya, India", cacheDir); // cache hit — no throttle wait

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("normalizes case and whitespace so they share one cache entry", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(fixture)) as unknown as typeof fetch;

    await geo.geocode("Meghalaya, India", cacheDir);
    await geo.geocode("  MEGHALAYA, INDIA  ", cacheDir);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("records a fetched_at timestamp inside the cache file", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(fixture)) as unknown as typeof fetch;

    await geo.geocode("Meghalaya, India", cacheDir);

    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    const entry = JSON.parse(await readFile(path.join(cacheDir, files[0]!), "utf-8"));
    expect(typeof entry.fetched_at).toBe("string");
    expect(new Date(entry.fetched_at).toString()).not.toBe("Invalid Date");
  });

  it(
    "does not cache a zero-result response, so a follow-up query retries rather than trusting a possibly-transient miss",
    async () => {
      global.fetch = vi.fn().mockResolvedValue(mockJsonResponse([])) as unknown as typeof fetch;

      await geo.geocode("somewhere ambiguous", cacheDir).catch(() => {});
      await geo.geocode("somewhere ambiguous", cacheDir).catch(() => {}); // real ~1s rate-limit wait here

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(await readdir(cacheDir)).toHaveLength(0);
    },
    3000,
  );
});

describe("fetchNominatimRaw — mocked fetch, never live network", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("does not retry a non-retryable error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const resultPromise = fetchNominatimRaw("fake query");
    const assertion = expect(resultPromise).rejects.toThrow(GeocodeLookupError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with backoff and succeeds on the next attempt", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests", headers: new Headers() })
      .mockResolvedValueOnce(mockJsonResponse(fixture)) as unknown as typeof fetch;

    const resultPromise = fetchNominatimRaw("fake query");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual(fixture);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
