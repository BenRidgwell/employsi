import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { D1Like } from "./jobArchive";
import { getAuth, type AuthEnv } from "./auth";

/**
 * "Notify me when it's live" on the coming-soon card.
 *
 * This exists so the button is not a lie. A control that says it will tell you
 * something has to actually record who asked — otherwise it is a placebo that
 * spends the user's trust for a nicer-looking modal, which is the same class of
 * fault as a card showing an invented figure.
 *
 * So: the request is stored in D1, keyed on the account and the place, and when
 * a market is released the rows for that place are the list to contact.
 *
 * The identity comes from the SESSION COOKIE, never the payload — the same rule
 * the feedback board follows. That also means an anonymous visitor cannot
 * register interest, because there would be no address to notify; the card
 * sends them to sign in instead of storing a row that could never be acted on.
 */

async function db(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null; // off-Worker (local SSR)
  }
}

async function currentUserKey(): Promise<string | null> {
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
    return email ? email.slice(0, 160) : null;
  } catch {
    return null;
  }
}

export interface NotifyResult {
  ok: boolean;
  /** Set when it was refused, for the card to show verbatim. */
  error?: string;
  /** True when this account had already registered for this place. */
  already?: boolean;
}

/** Places one account may register interest in. Stops a script filling the table. */
const PLACE_CAP = 60;

export const notifyMarket = createServerFn({ method: "POST" })
  .validator((data: { place: string; label?: string }) => data)
  .handler(async ({ data }): Promise<NotifyResult> => {
    const place = String(data?.place || "")
      .trim()
      .slice(0, 60);
    if (!place) return { ok: false, error: "Nothing to register interest in." };

    const d = await db();
    if (!d) return { ok: false, error: "Couldn't reach the server — try again shortly." };
    const key = await currentUserKey();
    if (!key) return { ok: false, error: "Sign in and we'll let you know." };

    try {
      const seen = await d
        .prepare(`SELECT 1 AS hit FROM market_interest WHERE user_key = ?1 AND place = ?2`)
        .bind(key, place)
        .first();
      if (seen) return { ok: true, already: true };

      const mine = await d
        .prepare(`SELECT COUNT(*) AS n FROM market_interest WHERE user_key = ?1`)
        .bind(key)
        .first();
      if ((Number(mine?.n) || 0) >= PLACE_CAP) {
        return { ok: false, error: "That's every market we have — you're on all of them." };
      }

      await d
        .prepare(
          `INSERT INTO market_interest (user_key, place, label, created)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_key, place) DO NOTHING`,
        )
        .bind(key, place, String(data?.label || "").slice(0, 120), new Date().toISOString())
        .run();
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't save that — try again shortly." };
    }
  });
