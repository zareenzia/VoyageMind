import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CritiqueResultSchema,
  DestinationSchema,
  ItinerarySchema,
  TripBriefSchema,
  WriterOutputSchema,
} from "./index.js";

/**
 * TRIP_SCHEMA_VERSION (src/schemas/index.ts) is bumped by hand, and hand-bumped
 * constants drift — CLAUDE.md's own stale sections and the SSE projection
 * mismatch are two prior cases of exactly this. This test hashes the structural
 * shape (never `.describe()` text, which changes constantly and doesn't affect
 * parseability) of every schema stored under that version. If the hash moves,
 * this test fails until someone either bumps TRIP_SCHEMA_VERSION or confirms the
 * change is parse-compatible and updates the snapshot deliberately.
 */

function stripNonStructural(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripNonStructural);
  }
  if (node !== null && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" || key === "$schema") continue;
      result[key] = stripNonStructural(value);
    }
    return result;
  }
  return node;
}

function structuralHash(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema);
  const stripped = stripNonStructural(jsonSchema);
  return createHash("sha256").update(JSON.stringify(stripped)).digest("hex");
}

describe("trip payload schema stability", () => {
  it("TripBriefSchema structural shape matches the last acknowledged version", () => {
    expect(structuralHash(TripBriefSchema)).toMatchSnapshot();
  });

  it("DestinationSchema (array) structural shape matches the last acknowledged version", () => {
    expect(structuralHash(z.array(DestinationSchema))).toMatchSnapshot();
  });

  it("ItinerarySchema structural shape matches the last acknowledged version", () => {
    expect(structuralHash(ItinerarySchema)).toMatchSnapshot();
  });

  it("CritiqueResultSchema structural shape matches the last acknowledged version", () => {
    expect(structuralHash(CritiqueResultSchema)).toMatchSnapshot();
  });

  // Brought under the guard by D8, when writer_output joined the stored payload.
  // It is nullable in the column and in TripPayloadSchema, so its ARRIVAL needed
  // no version bump — but a later change to its shape can still break parsing of
  // rows that do carry prose, which is exactly what this guard is for.
  it("WriterOutputSchema structural shape matches the last acknowledged version", () => {
    expect(structuralHash(WriterOutputSchema)).toMatchSnapshot();
  });
});
