/**
 * Who is an administrator, and the guard that enforces it.
 *
 * THE ROLE IS DECIDED ON THE SERVER, ALWAYS.
 * The client is told its role so the UI can hide what it cannot use, but that
 * is a convenience, not a control. Anyone can edit the value the browser
 * holds, so every privileged operation calls `requireAdmin` on the server and
 * re-derives the role from the session cookie. Hiding a button is presentation;
 * refusing the call is the security boundary. If you add an admin action, the
 * guard goes in the server function — never only in the component.
 *
 * WHY AN ENV VAR AND NOT A CONSTANT
 * ADMIN_EMAILS is a Worker variable, comma-separated. This repository is
 * public, so a hardcoded address would publish a personal email permanently —
 * git history keeps it even after a later edit. It also means adding or
 * removing an administrator is a `wrangler secret put`, not a code change and
 * a deploy.
 *
 * UNSET MEANS NOBODY. An empty or missing ADMIN_EMAILS grants nothing, so a
 * misconfigured deploy fails closed: the app runs with everyone as an end
 * user, rather than opening the admin surface to all comers.
 */

export interface RoleEnv {
  /** Comma-separated admin emails. Unset = no administrators. */
  ADMIN_EMAILS?: string;
}

export type Role = "admin" | "user";

/** The configured administrators, normalised for comparison. */
function adminEmails(env: RoleEnv | undefined): Set<string> {
  const raw = env?.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The role for a signed-in email.
 *
 * The email comes from the OAuth provider via the session, not from anything
 * the client sent, which is what makes matching on it safe: Google and
 * LinkedIn have both verified the address before it reaches us, and the
 * session cookie is signed. A self-asserted email would not be safe to match
 * on and this function must never be handed one.
 */
export function roleForEmail(env: RoleEnv | undefined, email: string | null | undefined): Role {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "user";
  return adminEmails(env).has(e) ? "admin" : "user";
}

/** True when at least one administrator is configured for this deployment. */
export function adminConfigured(env: RoleEnv | undefined): boolean {
  return adminEmails(env).size > 0;
}

/**
 * Refuse anything that is not an administrator.
 *
 * Returns null when allowed, or the reason to hand back to the caller. Callers
 * should treat a non-null result as final and do no work — including reads.
 */
export function denyIfNotAdmin(role: Role): string | null {
  return role === "admin" ? null : "Not permitted.";
}
