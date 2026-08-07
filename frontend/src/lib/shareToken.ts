const SHARE_PARAM = "share";

/**
 * A share link is `/?trip=<id>&share=<token>`. The token stays in the URL
 * rather than being exchanged for anything: it IS the credential, and the
 * person holding the link is exactly the person meant to have it.
 *
 * It is read from the URL on every request rather than cached, so closing the
 * shared trip stops sending it — a share token must not follow the user around
 * the app after they navigate away.
 */
export function getShareTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(SHARE_PARAM);
}

export function buildShareUrl(tripId: string, shareToken: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("trip", tripId);
  url.searchParams.set(SHARE_PARAM, shareToken);
  return url.toString();
}
