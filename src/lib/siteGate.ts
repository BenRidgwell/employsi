/**
 * Which host serves what — shared by the Worker entry (src/server.ts) and the
 * marketing pages, so the two cannot disagree about whether sign-in is open.
 *
 * employsi.com.au is the public marketing site. The same Worker also serves
 * the map app, so pointing a domain at it would otherwise publish an unreleased
 * product on the address the product is about to be advertised at —
 * discoverable, linkable and indexable. The gate is HOST-BASED rather than a
 * removal, so nothing is lost: /app stays fully reachable on the workers.dev
 * URL, which is where it is developed and demoed from.
 *
 * This is a visibility gate on a marketing domain, NOT a security boundary, and
 * the difference matters if you are tempted to lean on it. The per-market data
 * gate in employsi/lib/markets.ts is the boundary; it runs server-side on every
 * archive read and is unaffected by which hostname asked.
 *
 * RELEASING THE APP is taking "/app" and "/api/auth" out of APP_ONLY_PATHS,
 * and nothing else. The login page reads `appGatedOn` below, so it switches
 * from the waitlist to the real sign-in buttons on the same deploy.
 *
 * RELEASED 2026-10-03. The app is public on employsi.com.au from that deploy:
 * sign-in and the Stripe paywall (appAccess.ts) are what stand in front of it
 * now, on every host alike. Putting "/app" back here re-closes the apex and
 * turns /login back into the waitlist.
 *
 * Pure and dependency-free on purpose: the client imports it too.
 */
export const MARKETING_APEX = "employsi.com.au";
export const MARKETING_WWW = "www.employsi.com.au";

/**
 * Paths that belong to the product rather than the marketing site.
 *
 * `/api/auth` is here because an open sign-up endpoint on a promoted domain is
 * surface with nothing behind it while the app is closed there: the marketing
 * pages resolve nothing through it (server functions resolve the caller's role
 * in-process through auth.api.getSession), so closing it costs them nothing.
 *
 * `/login` and `/product` are deliberately NOT here — they are marketing pages.
 * On a gated host /login shows the waitlist instead of sign-in buttons that
 * would start an OAuth round trip into a 302.
 */
//
// /mobile-frame STAYS CLOSED after the release: it is a desktop preview of the
// mobile layout for building it, not a page a visitor needs on the public
// domain. It remains reachable on the workers.dev hosts.
export const APP_ONLY_PATHS: readonly string[] = ["/mobile-frame"];

export function isAppOnlyPath(pathname: string): boolean {
  return APP_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * True when this host keeps the app (and so sign-in) closed. Only the apex
 * does; www is 301'd to the apex before anything renders, but it is listed so
 * a client that somehow sees it still reads the same answer.
 */
export function appGatedOn(host: string): boolean {
  const h = host.toLowerCase();
  if (h !== MARKETING_APEX && h !== MARKETING_WWW) return false;
  return APP_ONLY_PATHS.includes("/app");
}
