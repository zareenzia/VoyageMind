import { toTripReadResult, type TripReadResult, type TripRecordInput, type TripStore, type TripSummary } from "./store.js";

interface StoredRow extends TripRecordInput {
  createdAt: string;
}

/** Test fake for TripStore. Never used in production — see NeonTripStore. */
export class InMemoryTripStore implements TripStore {
  private readonly rows = new Map<string, StoredRow>();

  async saveTrip(input: TripRecordInput): Promise<void> {
    this.rows.set(input.id, { ...input, createdAt: new Date().toISOString() });
  }

  async getTrip(id: string): Promise<TripReadResult | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    return toTripReadResult(row);
  }

  async listTripsForOwner(ownerToken: string): Promise<TripSummary[]> {
    return Array.from(this.rows.values())
      .filter((row) => row.ownerToken === ownerToken)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ id: row.id, request: row.request, status: row.status, createdAt: row.createdAt }));
  }

  async deleteTrip(id: string, ownerToken: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.ownerToken !== ownerToken) return false;
    this.rows.delete(id);
    return true;
  }
}
