import { getAuth, type AuthEnv } from "./auth";
import type { D1Like } from "./jobArchive";
import { roleForEmail } from "./roles";
import { MARKETING_APEX } from "@/lib/siteGate";

/**
 * Where product events land (migrations/0005_app_event.sql).
 *
 * THE CLIENT IS NOT TRUSTED WITH ANY OF THE THREE THINGS THAT MATTER.
 *
 *  who   — user_key comes from the session cookie on the request, read here. If
 *          the browser could name the user, one person could write another's
 *          activity and every retention figure on the admin console would be
 *          someone's to forge.
 *  when  — `at` and `day` are stamped server-side. Client clocks are wrong all
 *          the time (wrong timezone, wrong year, deliberately shifted), and
 *          every figure the console shows is a date bucket, so one bad clock
 *          would quietly move events into the wrong week forever.
 *  what  — only names on ALLOWED are stored. An open-ended event name is an
 *          open-ended column: it invites the next person to log a URL or a
 *          search string into a table meant to hold neither.
 *
 * `detail` is truncated hard and only ever carries a low-cardinality label the
 * app itself chose — a skill, a city, a sector. Search TEXT is never sent; see
 * lib/analytics.ts, which records that a search happened, not what was typed.
 *
 * This is a plain module rather than a server function because the browser
 * posts to it with `keepalive` while the page is unloading (that is the only
 * way a session's LENGTH gets recorded for someone who closes the tab, which is
 * most people). It is mounted at /api/events in src/server.ts, beside the auth
 * routes, for the same reason those are mounted there: it needs the raw Request.
 */

/** Every event this app records. Anything else is dropped without error. */
export const ALLOWED_EVENTS = [
  "session_start",
  "session_end",
  "search",
  "company_open",
  "skill_open",
  "city_open",
  "follow_add",
  "follow_remove",
  "panel_open",
  "panel_close",
  "mode_use",
] as const;

export type EventName = (typeof ALLOWED_EVENTS)[number];
const ALLOWED = new Set<string>(ALLOWED_EVENTS);

/** One batch cannot write more than this, however many the client queued. */
const MAX_BATCH = 40;
const MAX_DETAIL = 64;
/** Longer than this is a tab left open overnight, not a session. */
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;
/** The events whose `ms` is a real duration rather than 0. */
const DURATION_EVENTS = new Set<string>(["session_end", "panel_close", "mode_use"]);

export interface ClientEvent {
  name: string;
  detail?: string;
  sessionId?: string;
  anonKey?: string;
  /** DURATION_EVENTS only; 0 everywhere else. Clamped, because a browser can
   *  report anything and one forgotten tab would otherwise own the total. */
  ms?: number;
}

function clean(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** The signed-in caller's key, or "" — from the cookie, never from the body. */
async function callerKey(request: Request, env: unknown): Promise<string> {
  try {
    const auth = getAuth(env as AuthEnv);
    if (!auth) return "";
    const session = await auth.api.getSession({ headers: request.headers });
    const email = session?.user?.email ? String(session.user.email) : "";
    return email.trim().toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Write a batch. Returns how many rows landed.
 *
 * Never throws. A rejected write loses an event, which makes one admin figure
 * slightly low; throwing would break a page for a visitor over telemetry, which
 * is never a trade worth making.
 */
export async function writeEvents(
  request: Request,
  db: D1Like | null,
  env: unknown,
  events: ClientEvent[],
): Promise<number> {
  if (!db || !Array.isArray(events) || !events.length) return 0;

  // ONLY THE LIVE SITE, AND ONLY ITS END USERS, ARE RECORDED (2026-10-03).
  // Every preview Worker binds this same database, so without the host check
  // the owner's testing on a preview landed in production's Engagement tab;
  // and an administrator's own use of the product is not user behaviour. Both
  // were measured in the console the day the app was released — one "weekly
  // user" and 84 sessions, all of them the owner. Dropped here, before
  // anything is stored, rather than filtered at read time, so the table only
  // ever holds what the console is meant to describe.
  let host = "";
  try {
    host = new URL(request.url).hostname.toLowerCase();
  } catch {
    return 0;
  }
  if (host !== MARKETING_APEX) return 0;

  const at = new Date().toISOString();
  const day = at.slice(0, 10);
  const userKey = await callerKey(request, env);
  if (userKey && roleForEmail(env as AuthEnv, userKey) === "admin") return 0;

  const rows = events
    .slice(0, MAX_BATCH)
    .filter((e) => e && ALLOWED.has(e.name))
    .map((e) => ({
      name: e.name,
      detail: clean(e.detail, MAX_DETAIL),
      // A signed-in person is identified by their account; the device id is
      // dropped so the two cannot be joined back together afterwards.
      anonKey: userKey ? "" : clean(e.anonKey, 40),
      sessionId: clean(e.sessionId, 40),
      // `ms` is a DURATION and three events carry one now: how long a session
      // ran, how long a feature panel was open, and how long the app sat on the
      // supply or the demand side. Everything else stores 0.
      //
      // Clamped to the same ceiling for all three, because they fail the same
      // way: a tab left open overnight. A browser can report anything, and an
      // unclamped sum is one forgotten tab away from claiming a feature was
      // used for nine hours.
      ms: DURATION_EVENTS.has(e.name)
        ? Math.max(0, Math.min(MAX_SESSION_MS, Math.round(Number(e.ms) || 0)))
        : 0,
    }));
  if (!rows.length) return 0;

  try {
    const stmt = db.prepare(
      "INSERT INTO app_event (user_key, anon_key, session_id, name, detail, at, day, ms)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    await db.batch(
      rows.map((r) => stmt.bind(userKey, r.anonKey, r.sessionId, r.name, r.detail, at, day, r.ms)),
    );
    return rows.length;
  } catch {
    return 0;
  }
}

/** The /api/events route body: `{ events: [...] }`, anything else is ignored. */
export async function handleEventsRequest(request: Request, env: unknown): Promise<Response> {
  const ok = (n: number) =>
    new Response(JSON.stringify({ ok: true, wrote: n }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  try {
    const m = await import("cloudflare:workers");
    const cfEnv = (m?.env ?? {}) as Record<string, unknown>;
    const resolved = Object.keys(cfEnv).length ? cfEnv : ((env ?? {}) as Record<string, unknown>);
    const db = (resolved.JOBS_ARCHIVE as D1Like) ?? null;
    const body = (await request.json().catch(() => null)) as { events?: ClientEvent[] } | null;
    return ok(await writeEvents(request, db, resolved, body?.events ?? []));
  } catch {
    // 202 either way: the browser is unloading and has nothing to do with a
    // failure, and a non-2xx here would show up as a console error on a page
    // the person has already left.
    return ok(0);
  }
}
