import {
  canReadTrip,
  isTripOwner,
  toTripReadResult,
  type TripReadResult,
  type TripRecordInput,
  type TripStore,
  type TripSummary,
  type Viewer,
} from "./store.js";

interface StoredRow extends TripRecordInput {
  title: string | null;
  shareToken: string | null;
  createdAt: string;
}

/** Trims a title and collapses anything blank to null — clearing a name and
 * never setting one are the same state, so "   " is not a storable label. */
function normalizeTitle(title: string | null): string | null {
  if (title === null) return null;
  const trimmed = title.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Test fake for TripStore. Never used in production — see NeonTripStore. */
export class InMemoryTripStore implements TripStore {
  private readonly rows = new Map<string, StoredRow>();

  async saveTrip(input: TripRecordInput): Promise<void> {
    this.rows.set(input.id, {
      ...input,
      title: null,
      shareToken: null,
      createdAt: new Date().toISOString(),
    });
  }

  async getTrip(id: string, viewer: Viewer): Promise<TripReadResult | null> {
    const row = this.rows.get(id);
    // Same answer for "no such trip" and "not yours" — see TripStore.getTrip.
    if (!row || !canReadTrip(row, viewer)) return null;
    return toTripReadResult({ ...row, isOwner: isTripOwner(row, viewer) });
  }

  async listTrips(viewer: Viewer): Promise<TripSummary[]> {
    // A share token grants one trip, not a listing.
    if (viewer.kind === "share") return [];
    return Array.from(this.rows.values())
      .filter((row) => isTripOwner(row, viewer))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({
        id: row.id,
        request: row.request,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        shared: row.shareToken !== null,
      }));
  }

  async deleteTrip(id: string, viewer: Viewer): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !isTripOwner(row, viewer)) return false;
    this.rows.delete(id);
    return true;
  }

  async renameTrip(id: string, viewer: Viewer, title: string | null): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !isTripOwner(row, viewer)) return false;
    row.title = normalizeTitle(title);
    return true;
  }

  async setShareToken(id: string, viewer: Viewer, shareToken: string | null): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !isTripOwner(row, viewer)) return false;
    row.shareToken = shareToken;
    return true;
  }

  async claimTrips(ownerToken: string, userId: string): Promise<number> {
    let claimed = 0;
    for (const row of this.rows.values()) {
      // `userId === null` is what stops a replayed token from taking a trip
      // that already belongs to an account.
      if (row.ownerToken === ownerToken && row.userId === null) {
        row.userId = userId;
        claimed++;
      }
    }
    return claimed;
  }
}
