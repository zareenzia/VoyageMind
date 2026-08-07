import { randomUUID } from "node:crypto";
import { LIMITS } from "../config.js";
import { isPlausibleEmail, normalizeEmail } from "./email.js";
import { LoginAttemptTracker } from "./login-attempts.js";
import { hashPassword, spendDummyVerify, verifyPassword } from "./passwords.js";
import { hashSessionToken, newSessionToken } from "./session-tokens.js";
import { toPublicUser, type AuthStore, type PublicUser } from "./store.js";

export interface IssuedSession {
  /** The plaintext token. Goes into an httpOnly cookie and is never stored,
   * logged, or returned in a JSON body. */
  token: string;
  expiresAt: string;
}

export type SignupResult =
  | { ok: true; user: PublicUser; session: IssuedSession }
  | { ok: false; reason: "invalid_email" | "weak_password" | "email_taken" };

export type LoginResult =
  | { ok: true; user: PublicUser; session: IssuedSession }
  | { ok: false; reason: "invalid_credentials" | "too_many_attempts" };

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly attempts: LoginAttemptTracker = new LoginAttemptTracker(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async signup(rawEmail: string, password: string): Promise<SignupResult> {
    const email = normalizeEmail(rawEmail);
    if (!isPlausibleEmail(email)) return { ok: false, reason: "invalid_email" };
    if (password.length < LIMITS.minPasswordLength) return { ok: false, reason: "weak_password" };

    const created = await this.store.createUser({
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(password),
    });
    if (!created.ok) return { ok: false, reason: "email_taken" };

    return {
      ok: true,
      user: toPublicUser(created.user),
      session: await this.issueSession(created.user.id),
    };
  }

  /**
   * Both failure modes below return `invalid_credentials` and take the same
   * amount of scrypt work, whether or not the address has an account — D9's
   * identical-response rule. Returning a distinguishable answer here turns the
   * login form into an oracle for which addresses are registered, which is a
   * disclosure in its own right and the first step of a targeted attack.
   */
  async login(rawEmail: string, password: string): Promise<LoginResult> {
    const email = normalizeEmail(rawEmail);
    if (this.attempts.isBlocked(email)) return { ok: false, reason: "too_many_attempts" };

    const user = await this.store.findUserByEmail(email);
    // No user: still spend a scrypt verify, so the response time does not
    // separate "no account" from "wrong password".
    const matched = user ? await verifyPassword(password, user.passwordHash) : await spendDummyVerify(password);

    if (!user || !matched) {
      this.attempts.recordFailure(email);
      return { ok: false, reason: "invalid_credentials" };
    }

    this.attempts.clear(email);
    return { ok: true, user: toPublicUser(user), session: await this.issueSession(user.id) };
  }

  /** Resolves a cookie's plaintext token to a user, or null. Null covers
   * unknown, expired, and revoked alike — a caller has no legitimate use for
   * the distinction, and reporting it would leak whether a token was ever real. */
  async authenticate(token: string | null | undefined): Promise<PublicUser | null> {
    if (!token) return null;
    const session = await this.store.findValidSession(hashSessionToken(token), this.now());
    if (!session) return null;
    const user = await this.store.findUserById(session.userId);
    return user ? toPublicUser(user) : null;
  }

  async logout(token: string | null | undefined): Promise<void> {
    if (!token) return;
    await this.store.deleteSession(hashSessionToken(token));
  }

  /** "Log out everywhere" — the thing a JWT could not have done without a
   * denylist, and the concrete reason D9 chose server-side sessions. */
  async logoutEverywhere(userId: string): Promise<number> {
    return this.store.deleteSessionsForUser(userId);
  }

  async sweepExpiredSessions(): Promise<number> {
    this.attempts.sweep();
    return this.store.deleteExpiredSessions(this.now());
  }

  private async issueSession(userId: string): Promise<IssuedSession> {
    const token = newSessionToken();
    // Absolute, not sliding (LIMITS.sessionLifetimeDays): a stolen cookie has a
    // bounded life however actively it is used.
    const expiresAt = new Date(this.now().getTime() + LIMITS.sessionLifetimeDays * 86_400_000).toISOString();
    await this.store.createSession({ tokenHash: hashSessionToken(token), userId, expiresAt });
    return { token, expiresAt };
  }
}
