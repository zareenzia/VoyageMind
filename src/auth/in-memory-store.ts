import type { AuthStore, CreateUserResult, SessionRecord, UserRecord } from "./store.js";

/** Test fake for AuthStore. Never used in production — see NeonAuthStore. */
export class InMemoryAuthStore implements AuthStore {
  private readonly usersById = new Map<string, UserRecord>();
  private readonly userIdByEmail = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();

  async createUser(input: { id: string; email: string; passwordHash: string }): Promise<CreateUserResult> {
    // Single-threaded JS with no await between the check and the write, so this
    // is as atomic as the Neon store's ON CONFLICT — the contract case that
    // races two signups passes against both for real reasons, not by luck.
    if (this.userIdByEmail.has(input.email)) return { ok: false, reason: "email_taken" };

    const user: UserRecord = {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.usersById.set(user.id, user);
    this.userIdByEmail.set(user.email, user.id);
    return { ok: true, user };
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.userIdByEmail.get(email);
    return id ? (this.usersById.get(id) ?? null) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.usersById.get(id) ?? null;
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = this.usersById.get(id);
    if (!user) return false;
    this.usersById.delete(id);
    this.userIdByEmail.delete(user.email);
    // Mirrors the ON DELETE CASCADE in migration 0003 — a deleted user must not
    // leave live sessions behind in either implementation.
    await this.deleteSessionsForUser(id);
    return true;
  }

  async createSession(input: { tokenHash: string; userId: string; expiresAt: string }): Promise<void> {
    this.sessions.set(input.tokenHash, {
      tokenHash: input.tokenHash,
      userId: input.userId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    });
  }

  async findValidSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= now.getTime()) return null;
    return session;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    let removed = 0;
    for (const [hash, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(hash);
        removed++;
      }
    }
    return removed;
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    let removed = 0;
    for (const [hash, session] of this.sessions) {
      if (new Date(session.expiresAt).getTime() <= now.getTime()) {
        this.sessions.delete(hash);
        removed++;
      }
    }
    return removed;
  }
}
