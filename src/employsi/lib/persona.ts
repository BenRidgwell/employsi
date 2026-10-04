import type { Role } from "./roles";

/**
 * "View as user" — an administrator's switch for reviewing the end-user product.
 *
 * An admin sees a different app: every market is live rather than faded, the
 * coming-soon card never opens, search and filters are unfiltered, and the
 * feedback board grows moderation controls. That makes the person best placed
 * to review the product the one person who cannot see it, and flipping
 * ADMIN_EMAILS to check is a secret edit plus a version promotion (see
 * CLAUDE.md) — slow enough that it does not get done.
 *
 * THE ONE PROPERTY THAT MAKES THIS SAFE: IT CAN ONLY EVER DOWNGRADE.
 *
 * The signal is an ordinary cookie the browser sets for itself. It is not
 * signed, and it does not need to be, because the only thing it can ask for is
 * FEWER permissions. `effectiveRole` takes the role the server already derived
 * from the provider-verified email and can turn "admin" into "user"; there is
 * no value of this cookie, on any deployment, that turns "user" into "admin".
 * A visitor who forges it gets the role they already had.
 *
 * So this deliberately does NOT follow the usual rule that the client is never
 * trusted about its role — that rule exists to stop a browser claiming MORE
 * than it is owed, and this claims less. Read `effectiveRole` before adding
 * anything here: if a future flag would ever widen what the caller sees, it
 * does not belong in this file, and it needs a signed value and a server-side
 * check rather than a cookie.
 *
 * PREVIEW ONLY, BY AN ALLOW-LIST. `personaHostAllowed` names the hosts where
 * the switch works at all, and it is an allow-list rather than "not
 * production" on purpose: a deny-list silently enables the switch on the next
 * host somebody adds. Today that is employsi-preview and employsi-site-preview;
 * employsi.com.au, benridgwell-globe-gazer-hr.workers.dev and the CI Worker all
 * fall outside it.
 *
 * Pure and dependency-free, like lib/siteGate.ts, because both the server
 * (sessionRole, followsFn) and the browser import it.
 */

/** The cookie the browser sets for itself. Value "user" means view as one. */
export const PERSONA_COOKIE = "employsi_view_as";

/** The only value that means anything. Anything else is ignored. */
export const PERSONA_USER = "user";

/**
 * Hosts where the switch is offered at all.
 *
 * TWO conditions, not one: the host must sit under `.employsi.workers.dev` AND
 * its first label must end in `-preview`. That is `employsi-preview` and
 * `employsi-site-preview`, and nothing else on the account —
 * `benridgwell-globe-gazer-hr`, its `-mobile` sibling, the CI `employsi`
 * Worker and `employsi.com.au` all fail one test or the other.
 *
 * THE DOMAIN HALF IS NOT REDUNDANT, though it looks it while this code only
 * ever runs on our own Workers. Without it the rule is "any host whose first
 * label ends in -preview", which `evil-preview.attacker.com` satisfies — a
 * pattern match wearing an allow-list's clothes. It costs nothing today and
 * stops the rule being wrong the moment this module is read anywhere its host
 * is not ours.
 *
 * localhost is the deliberate exception, so the switch works in `npm run dev`
 * where there is no production to protect.
 */
export function personaHostAllowed(host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase().split(":")[0];
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (!h.endsWith(".employsi.workers.dev")) return false;
  return h.split(".")[0].endsWith("-preview");
}

/**
 * Is "view as user" set in this Cookie header?
 *
 * Hand-parsed rather than pulled from a cookie library because this module is
 * shared with the browser bundle and the answer is one name.
 */
export function personaCookieSet(cookieHeader: string | null | undefined): boolean {
  const raw = cookieHeader ?? "";
  if (!raw) return false;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== PERSONA_COOKIE) continue;
    return decodeURIComponent(part.slice(i + 1).trim()) === PERSONA_USER;
  }
  return false;
}

/**
 * The role to actually serve this request.
 *
 * DOWNGRADE ONLY — see the header. `trueRole` is whatever the session's
 * provider-verified email resolved to, and this returns either that or
 * something narrower, never wider.
 */
export function effectiveRole(trueRole: Role, viewAsUser: boolean, hostAllowed: boolean): Role {
  if (trueRole !== "admin") return trueRole;
  return viewAsUser && hostAllowed ? "user" : "admin";
}

/** What the client needs to draw the switch. */
export interface PersonaState {
  /** This deployment offers the switch AND the caller is really an admin. */
  available: boolean;
  /** The switch is on: an admin is being served the end-user view. */
  viewingAsUser: boolean;
}

/**
 * Flip the switch in this browser, then reload.
 *
 * THE RELOAD IS THE POINT, not a convenience. The persona changes what the
 * SERVER returns — markets, alerts, company posts, the feedback board's
 * moderation rows — and those answers are spread across a react-query cache, a
 * zustand store and the route's own beforeLoad. Invalidating the right subset
 * is a list that would rot the first time someone adds a query; a reload
 * re-derives every one of them from the cookie in one step, which is the same
 * reason signOut reloads rather than clearing state by hand.
 *
 * Not httpOnly, because the browser is what sets it. Not Secure, so it works
 * on http://localhost in `npm run dev`; the cookie carries no secret and
 * grants nothing, so there is nothing to protect in transit. SameSite=Lax
 * keeps it off cross-site requests anyway.
 */
export function setViewAsUser(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = on
    ? `${PERSONA_COOKIE}=${PERSONA_USER}; path=/; max-age=86400; SameSite=Lax`
    : `${PERSONA_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  if (typeof window !== "undefined") window.location.reload();
}
