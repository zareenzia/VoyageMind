export interface UserRecord {
  id: string;
  /** Already normalised (src/auth/email.ts) — the store never normalises. */
  email: string;
  passwordHash: string;
  createdAt: string;
}

/** What a caller may know about the signed-in user. Never carries passwordHash. */
export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export type CreateUserResult = { ok: true; user: UserRecord } | { ok: false; reason: "email_taken" };

export interface AuthStore {
  /**
   * Must be atomic against a concurrent signup with the same email — two
   * requests racing here is the ordinary case, not an exotic one, and a
   * check-then-insert would let both through. Returns `email_taken` rather
   * than throwing: a duplicate address is an expected user error on a signup
   * form, not an exceptional condition.
   */
  createUser(input: { id: string; email: string; passwordHash: string }): Promise<CreateUserResult>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  /**
   * No route exposes this. It exists so the contract suite can clean up after
   * a run against a real Neon branch, and as the primitive a reviewed
   * account-deletion step would build on — D9 decided accounts, not their
   * removal. Sessions and trips both cascade from `users.id`, so deleting a
   * user takes their trips with them; that is the schema's decision
   * (migration 0003), stated here because it is not obvious from the call.
   */
  deleteUser(id: string): Promise<boolean>;

  createSession(input: { tokenHash: string; userId: string; expiresAt: string }): Promise<void>;
  /**
   * Returns null for an unknown hash AND for one whose expires_at has passed.
   * Expiry is enforced on read, not only by the sweep, so a session is dead the
   * moment it expires rather than whenever the sweep next happens to run.
   */
  findValidSession(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Every session for one user — what "log out everywhere" and account
   * deletion both need. Returns the number removed. */
  deleteSessionsForUser(userId: string): Promise<number>;
  /** Reclaims rows already dead by findValidSession's reckoning. */
  deleteExpiredSessions(now: Date): Promise<number>;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}
