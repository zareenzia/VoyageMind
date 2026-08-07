import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth.tsx";

type Mode = "login" | "signup";

export function AuthPanel() {
  const { user, loading, signup, login, logout, claimedTrips, dismissClaimed } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Nothing is rendered until the session check settles. A signed-in user
  // seeing "Sign in" flash on every page load reads as having been logged out.
  if (loading) return <div className="h-9 w-20" aria-hidden />;

  const close = () => {
    setOpen(false);
    setError(null);
    setPassword("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === "signup" ? signup(email, password) : login(email, password));
      close();
      setEmail("");
    } catch (e) {
      // The server's message, verbatim — it is written to be read, and it
      // deliberately says the same thing for a wrong password as for an unknown
      // address.
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <div className="relative flex items-center gap-2">
        {claimedTrips !== null && claimedTrips > 0 && (
          <button
            onClick={dismissClaimed}
            className="hidden rounded-lg bg-terracotta/10 px-2.5 py-1 text-[11px] font-medium text-terracotta sm:block"
            title="Dismiss"
          >
            {claimedTrips} {claimedTrips === 1 ? "trip" : "trips"} added to your account
          </button>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg px-3 py-2 text-sm font-medium text-clay transition-colors hover:bg-sand hover:text-charcoal"
        >
          {user.email}
        </button>

        {open && (
          <>
            <button aria-label="Close" onClick={close} className="fixed inset-0 z-40 cursor-default" />
            <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-sand-dark bg-white p-3 shadow-xl shadow-charcoal/10">
              <p className="truncate px-1 text-sm text-charcoal">{user.email}</p>
              <p className="mt-0.5 px-1 text-[11px] text-clay">
                Signed in since {new Date(user.createdAt).toLocaleDateString()}
              </p>
              <button
                onClick={() => {
                  void logout();
                  close();
                }}
                className="mt-3 w-full rounded-lg border border-sand-dark px-3 py-2 text-sm font-medium text-charcoal hover:bg-sand"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg px-3 py-2 text-sm font-medium text-clay transition-colors hover:bg-sand hover:text-charcoal"
      >
        Sign in
      </button>

      {open && (
        <>
          <button aria-label="Close" onClick={close} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-sand-dark bg-white p-4 shadow-xl shadow-charcoal/10">
            <div className="mb-3 flex gap-1 rounded-lg bg-sand p-1">
              {(["login", "signup"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => {
                    setMode(value);
                    setError(null);
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mode === value ? "bg-white text-charcoal shadow-sm" : "text-clay hover:text-charcoal"
                  }`}
                >
                  {value === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-sand-dark px-3 py-2 text-sm text-charcoal outline-none focus:border-terracotta"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                className="w-full rounded-lg border border-sand-dark px-3 py-2 text-sm text-charcoal outline-none focus:border-terracotta"
              />

              {error && (
                <p className="rounded-lg bg-terracotta/5 px-3 py-2 text-xs text-terracotta">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-terracotta px-3 py-2 text-sm font-semibold text-white hover:bg-terracotta-dark disabled:opacity-60"
              >
                {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
              </button>
            </form>

            {/*
              Said plainly at the point of choosing a password, not buried.
              There is no email provider in Phase 1 (spec D9), so a lost password
              really is a lost account — implying otherwise would be the
              dishonest part.
            */}
            {mode === "signup" && (
              <p className="mt-3 border-t border-sand pt-3 text-[11px] leading-relaxed text-clay">
                There's no password reset yet — we can't send email. Save your password somewhere
                safe. Trips you've already planned in this browser will be added to your account.
              </p>
            )}
            {mode === "login" && (
              <p className="mt-3 border-t border-sand pt-3 text-[11px] leading-relaxed text-clay">
                You don't need an account to plan a trip. Signing in keeps your trips when you
                switch browsers.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
