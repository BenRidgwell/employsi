import { getRequest } from "@tanstack/react-start/server";
import { getAuth, type AuthEnv } from "./auth";
import { roleForEmail, type Role } from "./roles";

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
    const session = await auth.api.getSession({ headers: getRequest().headers });
    return roleForEmail(e, session?.user?.email ? String(session.user.email) : null);
  } catch {
    return "user";
  }
}
