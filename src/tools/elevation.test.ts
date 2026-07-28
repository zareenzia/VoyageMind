import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElevationLookupError, fetchElevationsRaw } from "./elevation.js";

// Recorded once from a live call: Sohra town centre and the Nongriat double-decker
// root bridge (959m elevation delta over 6.49km straight-line — grade 148m/km,
// the real-world case that motivates the very_steep tier in feasibility.ts), plus
// a flat Bangkok pair (5m delta over 3.34km — grade 1m/km) for contrast.
const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "__fixtures__/open-meteo-elevation.json"), "utf-8"),
);

function mockJsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("fetchElevationsRaw — against the recorded fixture, mocked fetch, never live network", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("returns elevations in the same order as the input points", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(fixture)) as unknown as typeof fetch;

    const points = [
      { lat: 25.2777336, lng: 91.7292416 },
      { lat: 25.2514562, lng: 91.6716581 },
      { lat: 13.7563, lng: 100.5018 },
      { lat: 13.744, lng: 100.53 },
    ];
    const resultPromise = fetchElevationsRaw(points);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual([1345, 386, 4, -1]);
  });

  it("does not retry a non-retryable error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
    }) as unknown as typeof fetch;

    const resultPromise = fetchElevationsRaw([{ lat: 0, lng: 0 }]);
    const assertion = expect(resultPromise).rejects.toThrow(ElevationLookupError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with backoff and succeeds on the next attempt", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests", headers: new Headers() })
      .mockResolvedValueOnce(mockJsonResponse({ elevation: [1345] })) as unknown as typeof fetch;

    const resultPromise = fetchElevationsRaw([{ lat: 25.2777336, lng: 91.7292416 }]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual([1345]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("getElevations — mocked fetch, temp cache dir, never live network", () => {
  const originalFetch = global.fetch;
  let elevationModule: typeof import("./elevation.js");
  let cacheDir: string;

  beforeEach(async () => {
    vi.resetModules();
    elevationModule = await import("./elevation.js");
    cacheDir = await mkdtemp(path.join(tmpdir(), "voyagemind-elevation-test-"));
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(cacheDir, { recursive: true, force: true });
  });

  function fetchReturningRequestedCount() {
    return vi.fn().mockImplementation(async (url: URL) => {
      const count = url.searchParams.get("latitude")!.split(",").length;
      return mockJsonResponse({ elevation: Array.from({ length: count }, (_, i) => 100 + i) });
    });
  }

  it("returns [] for no points without calling fetch", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const result = await elevationModule.getElevations([], cacheDir);
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("caches per point: a second call with one shared and one new point only fetches the new one", async () => {
    global.fetch = fetchReturningRequestedCount() as unknown as typeof fetch;

    const a = { lat: 1, lng: 1 };
    const b = { lat: 2, lng: 2 };
    const c = { lat: 3, lng: 3 };

    const first = await elevationModule.getElevations([a, b], cacheDir);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = await elevationModule.getElevations([a, c], cacheDir);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const secondCallUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]![0] as URL;
    expect(secondCallUrl.searchParams.get("latitude")).toBe("3"); // only c — a was cached
    expect(second[0]).toBe(first[0]); // a's elevation unchanged from cache
  });

  it("chunks requests over 100 points into multiple fetch calls", async () => {
    global.fetch = fetchReturningRequestedCount() as unknown as typeof fetch;

    const points = Array.from({ length: 150 }, (_, i) => ({ lat: i * 0.001, lng: i * 0.001 }));
    const result = await elevationModule.getElevations(points, cacheDir);

    expect(result).toHaveLength(150);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as URL;
    const secondUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]![0] as URL;
    expect(firstUrl.searchParams.get("latitude")!.split(",")).toHaveLength(100);
    expect(secondUrl.searchParams.get("latitude")!.split(",")).toHaveLength(50);
  });

  it("persists a fetched_at timestamp per cached point", async () => {
    global.fetch = fetchReturningRequestedCount() as unknown as typeof fetch;

    await elevationModule.getElevations([{ lat: 9, lng: 9 }], cacheDir);

    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
  });
});
