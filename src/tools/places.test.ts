import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOverpassQuery,
  fetchOverpassRaw,
  parseOverpassResponse,
  PlacesLookupError,
} from "./places.js";
import type { PlaceCategory } from "../schemas/index.js";

// Recorded once from a live query over Cherrapunji/Sohra, Meghalaya (20km radius,
// all categories) — see CLAUDE.md "No live network calls in tests." Real OSM data,
// including the real split between waterway=waterfall and tourism=attraction
// tagging that amendment (1) exists to catch: every waterfall in this sample is
// tagged waterway=waterfall, and none use natural=waterfall.
const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "__fixtures__/overpass-meghalaya.json"), "utf-8"),
);

const ALL_CATEGORIES: PlaceCategory[] = [
  "attraction", "museum", "gallery", "viewpoint", "artwork", "zoo", "theme_park",
  "aquarium", "picnic_site", "historic_site", "monument", "waterfall", "cave",
  "peak", "beach", "park", "garden", "nature_reserve",
];

describe("parseOverpassResponse — against the recorded Meghalaya fixture", () => {
  it("keeps exactly the named, categorised elements and counts the rest as dropped", () => {
    const { candidates, droppedUnnamed } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    expect(candidates).toHaveLength(88);
    expect(droppedUnnamed).toBe(85);
  });

  it("classifies a waterway=waterfall element as 'waterfall', not 'attraction', even though it also carries tourism=attraction", () => {
    // Nohkalikai Falls: node/3933644720 — tags are {name, tourism:"attraction", waterway:"waterfall", ...}.
    // No natural=waterfall exists anywhere in this real sample; without the
    // waterway=waterfall rule this place would not appear at all.
    const { candidates } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    const falls = candidates.find((c) => c.osm_id === 3933644720);
    expect(falls).toBeDefined();
    expect(falls?.category).toBe("waterfall");
    expect(falls?.name).toBe("Nohkalikai Falls");
    expect(falls?.osm_type).toBe("node");
    expect(falls?.location).toEqual({ lat: 25.2756548, lng: 91.6865847 });
  });

  it("passes wikidata and wikipedia through verbatim", () => {
    const { candidates } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    const falls = candidates.find((c) => c.osm_id === 3933644720);
    expect(falls?.wikidata).toBe("Q3631209");
    expect(falls?.wikipedia).toBe("en:Nohkalikai Falls");
  });

  it("resolves a way's location from `center`, since ways have no lat/lon of their own", () => {
    // Zingmaham Living Root Bridge: way/556878336, tags only carry name:en, not name.
    const { candidates } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    const bridge = candidates.find((c) => c.osm_id === 556878336);
    expect(bridge).toBeDefined();
    expect(bridge?.osm_type).toBe("way");
    expect(bridge?.category).toBe("attraction");
    expect(bridge?.name).toBe("Zingmaham Living Root Bridge");
    expect(bridge?.location).toEqual({ lat: 25.2065526, lng: 91.8977996 });
  });

  it("assembles an address from addr:* tags and passes opening_hours_raw through unparsed", () => {
    // Rit Mawksir Children's Park: way/935357235.
    const { candidates } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    const park = candidates.find((c) => c.osm_id === 935357235);
    expect(park).toBeDefined();
    expect(park?.category).toBe("park");
    expect(park?.address).toBe("Wahmawlyngdiar, Mawsynram, 793113");
    expect(park?.opening_hours_raw).toBe("sunrise-sunset");
  });

  it("drops elements with no name:en or name tag, and does not invent one", () => {
    // node/3700997996 is tourism=viewpoint with no name tag at all.
    const { candidates } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    expect(candidates.find((c) => c.osm_id === 3700997996)).toBeUndefined();
  });

  it("filters to only the requested categories, even when the response contains others", () => {
    const { candidates } = parseOverpassResponse(fixture, ["museum"]);
    expect(candidates).toEqual([]);
  });

  it("scores a place richer in notability signals higher than a minimally-tagged one", () => {
    // Nohkalikai Falls: node/3933644720 — 5 tags, including wikidata + wikipedia + tourism=attraction.
    // Trap Falls: node/5353534038 — only {name, waterway:"waterfall"}, no other signal.
    const { candidates } = parseOverpassResponse(fixture, ALL_CATEGORIES);
    const nohkalikai = candidates.find((c) => c.osm_id === 3933644720);
    const trapFalls = candidates.find((c) => c.osm_id === 5353534038);
    expect(nohkalikai).toBeDefined();
    expect(trapFalls).toBeDefined();
    expect(nohkalikai!.prominence).toBeGreaterThan(trapFalls!.prominence);
    expect(nohkalikai!.prominence).toBe(7.5); // 5 (wikidata/wikipedia) + 2 (attraction) + 5*0.1 (tag count)
    expect(trapFalls!.prominence).toBe(0.2); // 2 tags * 0.1, no other signal
  });
});

describe("parseOverpassResponse — synthetic edge cases not present in the recorded sample", () => {
  it("prefers name:en over name when both are present", () => {
    const response = {
      elements: [
        {
          type: "node" as const,
          id: 1,
          lat: 1,
          lon: 2,
          tags: { name: "местное имя", "name:en": "English Name", tourism: "museum" },
        },
      ],
    };
    const { candidates } = parseOverpassResponse(response, ["museum"]);
    expect(candidates[0]?.name).toBe("English Name");
  });

  it("ranks tourism=viewpoint above leisure=park (amendment 2)", () => {
    const response = {
      elements: [
        {
          type: "node" as const,
          id: 2,
          lat: 1,
          lon: 2,
          tags: { name: "Park Viewpoint", tourism: "viewpoint", leisure: "park" },
        },
      ],
    };
    const { candidates } = parseOverpassResponse(response, ["viewpoint", "park"]);
    expect(candidates[0]?.category).toBe("viewpoint");
  });

  it("ranks natural=waterfall above tourism=attraction", () => {
    const response = {
      elements: [
        {
          type: "node" as const,
          id: 3,
          lat: 1,
          lon: 2,
          tags: { name: "Some Falls", natural: "waterfall", tourism: "attraction" },
        },
      ],
    };
    const { candidates } = parseOverpassResponse(response, ["waterfall", "attraction"]);
    expect(candidates[0]?.category).toBe("waterfall");
  });

  it("never reformats opening_hours_raw, however irregular the syntax", () => {
    const raw = "Mo-Fr 09:00-12:00,13:00-17:00; Sa 09:00-13:00; Su,PH off";
    const response = {
      elements: [
        { type: "node" as const, id: 4, lat: 1, lon: 2, tags: { name: "X", tourism: "museum", opening_hours: raw } },
      ],
    };
    const { candidates } = parseOverpassResponse(response, ["museum"]);
    expect(candidates[0]?.opening_hours_raw).toBe(raw);
  });

  it("drops a way/relation with no `center` from the response, rather than guessing a location", () => {
    const response = {
      elements: [
        { type: "way" as const, id: 5, tags: { name: "No Center", tourism: "museum" } },
      ],
    };
    const { candidates, droppedUnnamed } = parseOverpassResponse(response, ["museum"]);
    expect(candidates).toEqual([]);
    expect(droppedUnnamed).toBe(0); // it had a name — dropped for a different reason
  });

  it("ignores elements whose tags match none of our categories, without counting them as dropped", () => {
    const response = {
      elements: [
        { type: "node" as const, id: 6, lat: 1, lon: 2, tags: { shop: "bakery" } },
      ],
    };
    const { candidates, droppedUnnamed } = parseOverpassResponse(response, ALL_CATEGORIES);
    expect(candidates).toEqual([]);
    expect(droppedUnnamed).toBe(0);
  });

  it("returns nothing for an empty response", () => {
    expect(parseOverpassResponse({ elements: [] }, ALL_CATEGORIES)).toEqual({
      candidates: [],
      droppedUnnamed: 0,
    });
  });
});

describe("buildOverpassQuery", () => {
  const base = { lat: 25.27, lng: 91.73, radiusKm: 10 };

  it("always requests `out center;`, since ways/relations have no lat/lon without it", () => {
    expect(buildOverpassQuery({ ...base, categories: ["museum"] })).toContain("out center;");
  });

  it("queries both natural=waterfall and waterway=waterfall for the 'waterfall' category", () => {
    const query = buildOverpassQuery({ ...base, categories: ["waterfall"] });
    expect(query).toContain(`["natural"="waterfall"]`);
    expect(query).toContain(`["waterway"="waterfall"]`);
    for (const elementType of ["node", "way", "relation"]) {
      expect(query).toContain(`${elementType}["natural"="waterfall"]`);
      expect(query).toContain(`${elementType}["waterway"="waterfall"]`);
    }
  });

  it("uses a sorted regex alternation for a key with multiple requested values", () => {
    const query = buildOverpassQuery({ ...base, categories: ["monument", "historic_site"] });
    expect(query).toContain(`["historic"~"^(archaeological_site|castle|fort|memorial|monument|ruins)$"]`);
  });

  it("produces an identical query regardless of the order categories were requested in", () => {
    const a = buildOverpassQuery({ ...base, categories: ["park", "museum", "waterfall"] });
    const b = buildOverpassQuery({ ...base, categories: ["waterfall", "museum", "park"] });
    expect(a).toBe(b);
  });

  it("converts radiusKm to meters in the around clause", () => {
    const query = buildOverpassQuery({ ...base, radiusKm: 2.5, categories: ["museum"] });
    expect(query).toContain("around:2500,25.27,91.73");
  });
});

describe("fetchOverpassRaw — mocked fetch, never live network", () => {
  const originalFetch = global.fetch;

  // The module keeps its rate-limiter state (lastRequestAt / requestQueue) as
  // singletons, same as it would in production. Reimporting a fresh module
  // instance per test isolates that state instead of leaking a queued wait — or
  // a stuck promise from a torn-down fake clock — into the next test.
  let places: typeof import("./places.js");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    places = await import("./places.js");
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("returns the parsed JSON body on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    }) as unknown as typeof fetch;

    const resultPromise = places.fetchOverpassRaw("fake query");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ elements: [] });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const resultPromise = places.fetchOverpassRaw("fake query");
    const assertion = expect(resultPromise).rejects.toThrow(places.PlacesLookupError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with backoff and succeeds on the next attempt", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests", headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [] }) }) as unknown as typeof fetch;

    const resultPromise = places.fetchOverpassRaw("fake query");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ elements: [] });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("findPlaces — mocked fetch, temp cache dir, never live network", () => {
  // Real timers, deliberately: the rate-limit wait here interleaves with real fs
  // I/O (the cache read/write), and racing vi.runAllTimersAsync() against that
  // real I/O is flaky — the timer for the *next* throttled call sometimes isn't
  // scheduled yet when the flush runs, so it never fires. Real timers cost this
  // block one genuine ~1s wait (see the last test) but are actually reliable.
  const originalFetch = global.fetch;
  let places: typeof import("./places.js");
  let cacheDir: string;

  beforeEach(async () => {
    vi.resetModules();
    places = await import("./places.js");
    cacheDir = await mkdtemp(path.join(tmpdir(), "voyagemind-places-test-"));
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(cacheDir, { recursive: true, force: true });
  });

  const params = {
    lat: 25.27,
    lng: 91.73,
    radiusKm: 10,
    categories: ["waterfall", "attraction"] as PlaceCategory[],
  };

  function mockElementsResponse(elements: Array<Record<string, unknown>>) {
    return { ok: true, json: async () => ({ elements }) };
  }

  it("sorts results by prominence, descending", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockElementsResponse([
        { type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Plain Falls", waterway: "waterfall" } },
        {
          type: "node",
          id: 2,
          lat: 2,
          lon: 2,
          tags: { name: "Famous Falls", waterway: "waterfall", tourism: "attraction", wikidata: "Q1" },
        },
      ]),
    ) as unknown as typeof fetch;

    const result = await places.findPlaces(params, cacheDir);

    expect(result.map((c) => c.name)).toEqual(["Famous Falls", "Plain Falls"]);
  });

  it("caches a non-empty response so a second identical call does not refetch", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockElementsResponse([{ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "X", waterway: "waterfall" } }]),
    ) as unknown as typeof fetch;

    await places.findPlaces(params, cacheDir);
    const result = await places.findPlaces(params, cacheDir); // cache hit — no throttle wait

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it("records a fetched_at timestamp inside the cache file", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockElementsResponse([{ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "X", waterway: "waterfall" } }]),
    ) as unknown as typeof fetch;

    await places.findPlaces(params, cacheDir);

    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    const entry = JSON.parse(await readFile(path.join(cacheDir, files[0]!), "utf-8"));
    expect(typeof entry.fetched_at).toBe("string");
    expect(new Date(entry.fetched_at).toString()).not.toBe("Invalid Date");
  });

  it(
    "does not cache an empty response, so a follow-up call retries rather than trusting a possibly-transient zero",
    async () => {
      global.fetch = vi.fn().mockResolvedValue(mockElementsResponse([])) as unknown as typeof fetch;

      await places.findPlaces(params, cacheDir);
      await places.findPlaces(params, cacheDir); // real ~1s rate-limit wait here — see block comment above

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(await readdir(cacheDir)).toHaveLength(0);
    },
    3000,
  );
});
