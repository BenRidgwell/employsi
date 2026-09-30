import { getRequest } from "@tanstack/react-start/server";
import { getAuth, type AuthEnv } from "./auth";
import { roleForEmail, type Role } from "./roles";
import { effectiveRole, personaCookieSet, personaHostAllowed } from "./persona";

/**
 * The caller's role for THIS request, re-derived from the session cookie.
 *
 * The one place any server function should ask. It was copied into two
 * handlers before this existed, and a third copy is how a guard quietly starts
 * disagreeing with the others.
 *
 * Never takes the role from the request body or a header. The client is told
 * its role so the UI can hide what it cannot use, but that value is editable
 * by whoever holds the browser — so anything that actually withholds data asks
 * the cookie again.
 *
 * ONE EXCEPTION, AND IT ONLY EVER NARROWS: an administrator on a preview host
 * can ask to be served as an end user (lib/persona.ts). That is applied HERE,
 * at the single point all 27 server-side role checks come through, so a
 * persona review sees the same data an end user would rather than the admin
 * data behind an end-user-looking UI — which would make the review worse than
 * useless. It cannot widen anything: the input to `effectiveRole` is already
 * the role derived from the provider-verified email, and no cookie value turns
 * a "user" into an "admin".
 *
 * Fails to "user" on any error. A broken auth binding should narrow what is
 * returned, never widen it.
 */
export async function callerRole(): Promise<Role> {
  try {
    const m = await import("cloudflare:workers");
    const e = (m?.env ?? null) as AuthEnv | null;
    if (!e) return "user";
    const auth = getAuth(e);
    if (!auth) return "user";
    const req = getRequest();
    const session = await auth.api.getSession({ headers: req.headers });
    const trueRole = roleForEmail(e, session?.user?.email ? String(session.user.email) : null);
    return effectiveRole(
      trueRole,
      personaCookieSet(req.headers.get("cookie")),
      personaHostAllowed(hostOf(req.url)),
    );
  } catch {
    return "user";
  }
}

/** The request's host, or null if the URL cannot be read. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
