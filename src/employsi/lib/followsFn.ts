import { createServerFn } from "@tanstack/react-start";
import { roleForEmail, type Role } from "./roles";
import { getRequest } from "@tanstack/react-start/server";
import type { D1Like } from "./jobArchive";
import { getAuth, authProviders, type AuthEnv } from "./auth";

/**
 * Followed companies and skills, and the one-time claim of what was already in
 * the browser.
 *
 * Follows used to live in localStorage against the placeholder account, which
 * meant they were per-browser: the same person on their phone saw none of them,
 * and clearing site data lost them. They now hang off a real user id.
 *
 * THE CLAIM. Anyone who used the app before today has follows in their browser
 * and no account to attach them to. Rather than stranding those, the first
 * sign-in offers to claim them: the client sends what it has, the server writes
 * any the account does not already hold, and localStorage is cleared. It is
 * idempotent (the table's primary key makes a re-run a no-op) and additive — it
 * never removes a follow the account already had, so claiming twice from two
 * browsers merges rather than overwrites.
 */

/**
 * The incoming request's headers, for the session cookie.
 *
 * Server functions in this version do not hand the Request to the handler, so
 * it comes from the ambient request context instead. Wrapped because a caller
 * outside a request (a build-time render) has none, and an empty Headers reads
 * as "signed out" rather than throwing.
 */
function requestHeaders(): Headers {
  try {
    return getRequest().headers;
  } catch {
    return new Headers();
  }
}

async function env(): Promise<AuthEnv | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env ?? null) as AuthEnv | null;
  } catch {
    return null; // off-Worker (local SSR)
  }
}

function db(e: AuthEnv | null): D1Like | null {
  return (e?.JOBS_ARCHIVE as D1Like) ?? null;
}

/** The signed-in user for this request, or null. The only source of identity. */
async function currentUser(
  headers: Headers,
): Promise<{ id: string; name: string; email: string; image?: string } | null> {
  const e = await env();
  if (!e) return null;
  const auth = getAuth(e);
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({ headers });
    const u = session?.user;
    if (!u?.id) return null;
    return {
      id: String(u.id),
      name: String(u.name || u.email || "You"),
      email: String(u.email || ""),
      image: u.image ? String(u.image) : undefined,
    };
  } catch {
    return null;
  }
}

export type { Role };

export interface SessionInfo {
  user: { id: string; name: string; email: string; image?: string } | null;
  /**
   * What this session may see. Resolved on the server from the session's
   * provider-verified email; the client is told so it can hide what it cannot
   * use, but every privileged call re-checks server-side (see lib/roles.ts).
   */
  role: Role;
  /** Which sign-in buttons this deployment can actually offer. */
  providers: ("google" | "linkedin")[];
  followedIds: string[];
  followedSkills: string[];
}

const SAFE_REF = /^[\w &+/'().-]{1,80}$/;

/**
 * Who is signed in, what this deployment supports, and their follows — in one
 * round trip, because the app needs all four to render its first frame and
 * three requests would mean three chances to flash the signed-out state.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionInfo> => {
    const e = await env();
    const providers = authProviders(e ?? undefined);
    const user = await currentUser(requestHeaders());
    if (!user) return { user: null, role: "user", providers, followedIds: [], followedSkills: [] };
    const role = roleForEmail(e ?? undefined, user.email);
    const d = db(e);
    if (!d) return { user, role, providers, followedIds: [], followedSkills: [] };
    try {
      const res = await d
        .prepare(`SELECT kind, ref FROM user_follow WHERE user_id = ?1`)
        .bind(user.id)
        .all();
      const ids: string[] = [];
      const skills: string[] = [];
      for (const r of res?.results ?? []) {
        const ref = String(r.ref || "");
        if (String(r.kind) === "company") ids.push(ref);
        else skills.push(ref);
      }
      return { user, role, providers, followedIds: ids, followedSkills: skills };
    } catch {
      return { user, role, providers, followedIds: [], followedSkills: [] };
    }
  },
);

export const setFollow = createServerFn({ method: "POST" })
  .validator((data: { kind: "company" | "skill"; ref: string; on: boolean }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const user = await currentUser(requestHeaders());
    if (!user) return { ok: false };
    const d = db(await env());
    if (!d) return { ok: false };
    const kind = data.kind === "skill" ? "skill" : "company";
    const ref = String(data.ref || "").trim();
    if (!SAFE_REF.test(ref)) return { ok: false };
    try {
      if (data.on) {
        await d
          .prepare(
            `INSERT INTO user_follow (user_id, kind, ref, created) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(user_id, kind, ref) DO NOTHING`,
          )
          .bind(user.id, kind, ref, new Date().toISOString().slice(0, 10))
          .run();
      } else {
        await d
          .prepare(`DELETE FROM user_follow WHERE user_id = ?1 AND kind = ?2 AND ref = ?3`)
          .bind(user.id, kind, ref)
          .run();
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

export interface ClaimResult {
  ok: boolean;
  /** How many were actually new to this account. */
  claimed: number;
}

/**
 * Attach follows already held in this browser to the signed-in account.
 *
 * Purely additive, and capped — a client can only ever hand over what a person
 * could plausibly have followed, so a malformed or hostile payload cannot fill
 * the table.
 */
export const claimLocalFollows = createServerFn({ method: "POST" })
  .validator((data: { companies: string[]; skills: string[] }) => data)
  .handler(async ({ data }): Promise<ClaimResult> => {
    const user = await currentUser(requestHeaders());
    if (!user) return { ok: false, claimed: 0 };
    const d = db(await env());
    if (!d) return { ok: false, claimed: 0 };
    const pairs: [string, string][] = [];
    for (const c of (data?.companies ?? []).slice(0, 500))
      if (SAFE_REF.test(String(c))) pairs.push(["company", String(c)]);
    for (const s of (data?.skills ?? []).slice(0, 500))
      if (SAFE_REF.test(String(s))) pairs.push(["skill", String(s)]);
    if (!pairs.length) return { ok: true, claimed: 0 };
    const day = new Date().toISOString().slice(0, 10);
    let claimed = 0;
    try {
      const had = await d
        .prepare(`SELECT kind, ref FROM user_follow WHERE user_id = ?1`)
        .bind(user.id)
        .all();
      const have = new Set((had?.results ?? []).map((r) => `${r.kind}|${r.ref}`));
      const stmts = [];
      for (const [kind, ref] of pairs) {
        if (have.has(`${kind}|${ref}`)) continue;
        claimed++;
        stmts.push(
          d
            .prepare(
              `INSERT INTO user_follow (user_id, kind, ref, created) VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(user_id, kind, ref) DO NOTHING`,
            )
            .bind(user.id, kind, ref, day),
        );
      }
      // One batch, so a browser with 200 follows is one round trip.
      if (stmts.length && typeof d.batch === "function") await d.batch(stmts);
      else for (const s of stmts) await s.run();
      return { ok: true, claimed };
    } catch {
      return { ok: false, claimed: 0 };
    }
  });
