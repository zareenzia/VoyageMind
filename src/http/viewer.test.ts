import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthStore } from "../auth/in-memory-store.js";
import { AuthService } from "../auth/service.js";
import type { Viewer } from "../trips/store.js";
import { readTripAs, resolveViewer } from "./viewer.js";

const PASSWORD = "a-long-enough-password";

function req(headers: Record<string, string | string[]> = {}): IncomingMessage {
  return { headers, socket: { encrypted: false } } as unknown as IncomingMessage;
}

describe("resolveViewer", () => {
  let auth: AuthService;

  beforeEach(() => {
    auth = new AuthService(new InMemoryAuthStore());
  });

  it("resolves to nothing when the request carries no identity at all", async () => {
    const viewer = await resolveViewer(req(), auth);
    expect(viewer.user).toBeNull();
    expect(viewer.owned).toBeNull();
    expect(viewer.ownerToken).toBeNull();
    expect(viewer.shareToken).toBeNull();
  });

  it("resolves an owner token header to an anonymous viewer", async () => {
    const viewer = await resolveViewer(req({ "x-owner-token": "tok-1" }), auth);
    expect(viewer.user).toBeNull();
    expect(viewer.owned).toEqual({ kind: "anonymous", ownerToken: "tok-1" });
    expect(viewer.ownerToken).toBe("tok-1");
  });

  it("resolves a valid session cookie to a user viewer", async () => {
    const signup = await auth.signup("traveller@example.test", PASSWORD);
    if (!signup.ok) throw new Error(signup.reason);

    const viewer = await resolveViewer(req({ cookie: `vm_session=${signup.session.token}` }), auth);
    expect(viewer.user?.email).toBe("traveller@example.test");
    expect(viewer.owned).toEqual({ kind: "user", userId: signup.user.id });
  });

  /**
   * The same rule the store enforces for a claimed trip: once signed in, the
   * browser's anonymous token stops deciding anything. If the owner token won
   * here instead, a signed-in user would keep reading and writing trips as their
   * old anonymous self.
   */
  it("prefers the session over an owner token sent alongside it", async () => {
    const signup = await auth.signup("traveller@example.test", PASSWORD);
    if (!signup.ok) throw new Error(signup.reason);

    const viewer = await resolveViewer(
      req({ cookie: `vm_session=${signup.session.token}`, "x-owner-token": "tok-1" }),
      auth,
    );
    expect(viewer.owned).toEqual({ kind: "user", userId: signup.user.id });
    // Still reported, because signup/login need it to claim this browser's trips.
    expect(viewer.ownerToken).toBe("tok-1");
  });

  it("falls back to the owner token when the session cookie is not valid", async () => {
    const viewer = await resolveViewer(req({ cookie: "vm_session=nonsense", "x-owner-token": "tok-1" }), auth);
    expect(viewer.user).toBeNull();
    expect(viewer.owned).toEqual({ kind: "anonymous", ownerToken: "tok-1" });
  });

  it("stops honouring a session after logout, without the owner token filling in", async () => {
    const signup = await auth.signup("traveller@example.test", PASSWORD);
    if (!signup.ok) throw new Error(signup.reason);
    await auth.logout(signup.session.token);

    const viewer = await resolveViewer(req({ cookie: `vm_session=${signup.session.token}` }), auth);
    expect(viewer.user).toBeNull();
    expect(viewer.owned).toBeNull();
  });

  it("picks up a share token header, and never treats it as an owned viewer", async () => {
    const viewer = await resolveViewer(req({ "x-share-token": "share-1" }), auth);
    expect(viewer.shareToken).toBe("share-1");
    expect(viewer.owned).toBeNull();
  });

  it("ignores blank and whitespace-only header values", async () => {
    const viewer = await resolveViewer(req({ "x-owner-token": "   ", "x-share-token": "" }), auth);
    expect(viewer.ownerToken).toBeNull();
    expect(viewer.shareToken).toBeNull();
    expect(viewer.owned).toBeNull();
  });
});

describe("readTripAs", () => {
  const owned: Viewer = { kind: "anonymous", ownerToken: "tok-1" };

  it("reads as the owned viewer when that succeeds, without trying the share token", async () => {
    const tried: Viewer[] = [];
    const result = await readTripAs(
      { user: null, owned, ownerToken: "tok-1", shareToken: "share-1" },
      async (v) => {
        tried.push(v);
        return "trip";
      },
    );

    expect(result).toBe("trip");
    expect(tried).toEqual([owned]);
  });

  /**
   * A signed-in user opening someone else's share link is ordinary: their own
   * viewer legitimately cannot see the trip, and refusing there would make share
   * links work only for signed-out browsers.
   */
  it("falls back to the share token when the owned viewer cannot see the trip", async () => {
    const tried: Viewer[] = [];
    const result = await readTripAs(
      { user: null, owned, ownerToken: "tok-1", shareToken: "share-1" },
      async (v) => {
        tried.push(v);
        return v.kind === "share" ? "trip" : null;
      },
    );

    expect(result).toBe("trip");
    expect(tried).toEqual([owned, { kind: "share", shareToken: "share-1" }]);
  });

  it("returns null when neither viewer can see it", async () => {
    const result = await readTripAs(
      { user: null, owned, ownerToken: "tok-1", shareToken: "share-1" },
      async () => null,
    );
    expect(result).toBeNull();
  });

  it("returns null without reading anything when the request carries no identity", async () => {
    let calls = 0;
    const result = await readTripAs({ user: null, owned: null, ownerToken: null, shareToken: null }, async () => {
      calls++;
      return "trip";
    });

    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it("uses only the share token when there is no owned viewer", async () => {
    const tried: Viewer[] = [];
    const result = await readTripAs(
      { user: null, owned: null, ownerToken: null, shareToken: "share-1" },
      async (v) => {
        tried.push(v);
        return "trip";
      },
    );

    expect(result).toBe("trip");
    expect(tried).toEqual([{ kind: "share", shareToken: "share-1" }]);
  });
});
