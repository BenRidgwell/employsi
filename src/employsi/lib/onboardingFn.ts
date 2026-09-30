import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { D1Like } from "./jobArchive";
import { getAuth, type AuthEnv } from "./auth";

/**
 * Has this ACCOUNT seen the welcome card yet?
 *
 * The welcome card opens the guided tour, and it should appear exactly once —
 * on a person's first visit to the app — and never again.
 *
 * WHY THIS IS SERVER-SIDE AND NOT localStorage. "First login" is a property of
 * the ACCOUNT, and localStorage answers a different question: "has this
 * BROWSER seen it". Those disagree in both directions and both are wrong to
 * the user. Signing in on a phone after a week on a laptop would show the
 * welcome again to someone who has used the product for a week; and a genuinely
 * new account on a shared or previously-used browser would never see it at
 * all, which is the case the feature exists for. Clearing site data would also
 * silently reset it. One row per user answers the question that was asked.
 *
 * THE TABLE IS CREATED LAZILY, like llm_usage (analystLlmFn), views (viewsFn)
 * and billing_subscription (billing) — no migration, so a preview Worker and
 * production both grow it on first use rather than needing a deploy step that
 * can be forgotten.
 *
 * A row means SEEN. Absence means new, which makes the default for any failure
 * "do not show" rather than "show again": a read that throws returns seen, so a
 * broken binding cannot put the welcome card in front of someone on every load.
 * Missing a first-run card is a small loss; an un-dismissable one is not.
 */

async function db(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null; // off-Worker (local SSR)
  }
}

/** The signed-in user's id, from the session cookie and nothing else. */
async function currentUserId(): Promise<string | null> {
  try {
    const m = await import("cloudflare:workers");
    const e = (m?.env ?? null) as AuthEnv | null;
    if (!e) return null;
    const auth = getAuth(e);
    if (!auth) return null;
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const id = session?.user?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

async function ensureTable(d: D1Like): Promise<void> {
  await d
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_onboarding (
         user_id TEXT PRIMARY KEY,
         seen_at TEXT NOT NULL
       )`,
    )
    .run();
}

export interface OnboardingState {
  /** Show the welcome card: a signed-in account with no row yet. */
  welcome: boolean;
}

/** Nobody signed in, or anything went wrong: show nothing. */
const NONE: OnboardingState = { welcome: false };

export const getOnboarding = createServerFn({ method: "GET" }).handler(
  async (): Promise<OnboardingState> => {
    const userId = await currentUserId();
    if (!userId) return NONE;
    const d = await db();
    if (!d) return NONE;
    try {
      await ensureTable(d);
      const row = await d
        .prepare(`SELECT 1 AS seen FROM user_onboarding WHERE user_id = ?1`)
        .bind(userId)
        .first();
      return { welcome: !row };
    } catch {
      return NONE;
    }
  },
);

/**
 * Record that this account has seen the welcome card.
 *
 * Called by BOTH buttons — taking the tour and skipping it are equally "you
 * have been welcomed", and a card that came back because you skipped it would
 * be the more annoying of the two.
 *
 * INSERT OR IGNORE, so a double click or a retry cannot fail on the primary
 * key, and the FIRST timestamp is the one kept.
 */
export const markWelcomeSeen = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean }> => {
    const userId = await currentUserId();
    if (!userId) return { ok: false };
    const d = await db();
    if (!d) return { ok: false };
    try {
      await ensureTable(d);
      await d
        .prepare(`INSERT OR IGNORE INTO user_onboarding (user_id, seen_at) VALUES (?1, ?2)`)
        .bind(userId, new Date().toISOString())
        .run();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },
);
