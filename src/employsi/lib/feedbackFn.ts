import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { D1Like } from "./jobArchive";
import { getAuth, type AuthEnv } from "./auth";

/**
 * The feedback board, stored in D1.
 *
 * It used to be eight hand-written requests with invented authors ("Priya S.",
 * 128 votes) plus whatever the visitor typed, kept in their own localStorage.
 * That meant the board was fiction on first open, and anything a real person
 * posted was visible only to them — nobody else, including us, ever saw it. A
 * feedback board that nobody can read is not a feedback board.
 *
 * Now requests and votes live in the shared archive database, so a post is
 * durable, visible to everyone, and actually reaches us. The board starts EMPTY:
 * the first thing on it will be the first thing somebody asks for.
 *
 * ── Permission ─────────────────────────────────────────────────────────────
 * This USED to be a UI gate only: the client sent whatever email it liked and
 * the handlers took it, because the app's "sign in" was a name and an email
 * typed into a box. It is now a real one. The author of a post and the owner of
 * a vote come from the SESSION COOKIE (see lib/auth.ts) — the client cannot
 * supply an identity, so it cannot post or vote as anyone else.
 *
 * On top of that:
 *   • length and shape limits on everything stored;
 *   • one vote per user per request, enforced by the table's primary key;
 *   • a cap of five posts per user per day.
 */

export type FbStatus = "open" | "under-review" | "planned" | "shipped";

export interface FeedbackItem {
  id: string;
  title: string;
  author: string;
  status: FbStatus;
  /** Net score: sum of every account's ±1. */
  score: number;
  /** The asking account's own vote, when it has one. */
  mine?: 1 | -1;
  /** Posted by the asking account. */
  own?: boolean;
  created: string; // YYYY-MM-DD
}

const TITLE_MAX = 140;
const NAME_MAX = 60;
/** Requests one user may post in a day. */
const DAILY_POST_CAP = 5;

const STATUSES = new Set<FbStatus>(["open", "under-review", "planned", "shipped"]);

async function db(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null; // off-Worker (local SSR) — the board reads as empty
  }
}

/**
 * The signed-in user for this request, or null.
 *
 * `author_key` stays the lower-cased EMAIL rather than the user id, so posts
 * made before accounts existed still belong to whoever signs in with that
 * address — the board's history survives the migration instead of being
 * orphaned. The value now comes from the verified session, never the payload.
 */
async function currentUser(): Promise<{ key: string; name: string } | null> {
  try {
    const m = await import("cloudflare:workers");
    const e = (m?.env ?? null) as AuthEnv | null;
    if (!e) return null;
    const auth = getAuth(e);
    if (!auth) return null;
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const email = String(session?.user?.email || "")
      .trim()
      .toLowerCase();
    if (!email) return null;
    return {
      key: email.slice(0, 160),
      name: String(session?.user?.name || email.split("@")[0]),
    };
  } catch {
    return null;
  }
}

function clean(s: string, max: number): string {
  // Control characters collapse into the whitespace run rather than being
  // stored, so a pasted newline or a stray \x07 cannot change how a title
  // renders on the board. Written as a scan rather than a regex because the
  // literal character class would put raw control bytes in the source.
  let out = "";
  for (const ch of s || "") out += ch.codePointAt(0)! < 0x20 ? " " : ch;
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every request, best-scoring first, with the asking account's own vote marked.
 *
 * `email` identifies the caller only so their existing votes and posts can be
 * shown back to them — it is not a credential.
 */
export const getFeedback = createServerFn({ method: "GET" }).handler(
  async (): Promise<FeedbackItem[]> => {
    const d = await db();
    if (!d) return [];
    const key = (await currentUser())?.key ?? "";
    try {
      const res = await d
        .prepare(
          `SELECT f.id, f.title, f.author, f.status, f.created, f.author_key,
                  COALESCE(SUM(v.dir), 0) AS score,
                  MAX(CASE WHEN v.voter = ?1 THEN v.dir END) AS mine
             FROM feedback f
             LEFT JOIN feedback_votes v ON v.item_id = f.id
            GROUP BY f.id
            ORDER BY score DESC, f.created DESC
            LIMIT 200`,
        )
        .bind(key)
        .all();
      return (res?.results ?? []).map((r) => {
        const status = String(r.status || "open") as FbStatus;
        const mine = Number(r.mine);
        return {
          id: String(r.id),
          title: String(r.title || ""),
          author: String(r.author || "Someone"),
          status: STATUSES.has(status) ? status : "open",
          score: Number(r.score) || 0,
          mine: mine === 1 || mine === -1 ? (mine as 1 | -1) : undefined,
          own: !!key && String(r.author_key) === key,
          created: String(r.created || ""),
        };
      });
    } catch {
      return [];
    }
  },
);

export interface PostResult {
  ok: boolean;
  /** Why it was refused, for the board to show. Empty on success. */
  error?: string;
}

/** Post a request. The author is the signed-in user; the client sends only text. */
export const postFeedback = createServerFn({ method: "POST" })
  .validator((data: { title: string }) => data)
  .handler(async ({ data }): Promise<PostResult> => {
    const d = await db();
    if (!d) return { ok: false, error: "The board is unavailable right now." };
    const me = await currentUser();
    if (!me) return { ok: false, error: "Sign in to post a request." };
    const key = me.key;
    const title = clean(data?.title || "", TITLE_MAX);
    if (title.length < 4) return { ok: false, error: "Say a little more than that." };
    const author = clean(me.name, NAME_MAX) || key.split("@")[0] || "Someone";
    try {
      // One account cannot flood the board. Not a security control — see the
      // note at the top — but it stops an accidental double-post and the
      // obvious nuisance case.
      const mine = await d
        .prepare(`SELECT COUNT(*) AS n FROM feedback WHERE author_key = ?1 AND created = ?2`)
        .bind(key, today())
        .first();
      if ((Number(mine?.n) || 0) >= DAILY_POST_CAP)
        return { ok: false, error: "That's enough for one day — try again tomorrow." };

      // Same account, same request text: treat as a repeat rather than a
      // duplicate row.
      const dup = await d
        .prepare(`SELECT id FROM feedback WHERE author_key = ?1 AND lower(title) = lower(?2)`)
        .bind(key, title)
        .first();
      if (dup?.id) return { ok: true };

      const id = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await d
        .prepare(
          `INSERT INTO feedback (id, title, author, author_key, status, created)
           VALUES (?1, ?2, ?3, ?4, 'open', ?5)`,
        )
        .bind(id, title, author, key, today())
        .run();
      // The author implicitly backs their own request, which is also what makes
      // a brand-new post sort above the un-voted ones.
      await d
        .prepare(
          `INSERT INTO feedback_votes (item_id, voter, dir, created) VALUES (?1, ?2, 1, ?3)
           ON CONFLICT(item_id, voter) DO NOTHING`,
        )
        .bind(id, key, today())
        .run();
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't save that — try again." };
    }
  });

/**
 * Vote on a request. One vote per account per request; sending the same
 * direction again clears it, which is what makes the arrows a toggle.
 */
export const voteFeedback = createServerFn({ method: "POST" })
  .validator((data: { id: string; dir: 1 | -1 }) => data)
  .handler(async ({ data }): Promise<PostResult> => {
    const d = await db();
    if (!d) return { ok: false, error: "The board is unavailable right now." };
    const key = (await currentUser())?.key;
    if (!key) return { ok: false, error: "Sign in to vote." };
    const id = clean(data?.id || "", 40);
    const dir = data?.dir === 1 ? 1 : data?.dir === -1 ? -1 : 0;
    if (!id || !dir) return { ok: false, error: "" };
    try {
      const cur = await d
        .prepare(`SELECT dir FROM feedback_votes WHERE item_id = ?1 AND voter = ?2`)
        .bind(id, key)
        .first();
      if (Number(cur?.dir) === dir) {
        await d
          .prepare(`DELETE FROM feedback_votes WHERE item_id = ?1 AND voter = ?2`)
          .bind(id, key)
          .run();
      } else {
        await d
          .prepare(
            `INSERT INTO feedback_votes (item_id, voter, dir, created) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(item_id, voter) DO UPDATE SET dir = ?3`,
          )
          .bind(id, key, dir, today())
          .run();
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't record that — try again." };
    }
  });
