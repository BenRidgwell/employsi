import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth, type AuthEnv } from "./auth";
import { billingEnv } from "./billing";
import { accessFor, type AccessUser, type AppAccess } from "./appAccess";

/**
 * Server-function middleware: the paid data answers only callers the /app
 * paywall would let in. Attach with `.middleware([subscriberOnly])`.
 *
 * WHY. Until 2026-10-03 the paywall gated the /app PAGE and nothing else — the
 * thirty-odd server functions behind the map answered any request, so anyone
 * who read the page's network calls could have the paid product without
 * paying, and anonymous callers could spend the AI analyst's site-wide daily
 * allowance out from under subscribers. Every data function the app calls now
 * carries this, and it applies exactly the page's rule (accessFor in
 * appAccess.ts) so the two cannot disagree.
 *
 * DELIBERATELY NOT ON:
 *   - getLandingStats, getLiveSkillTrends — the marketing pages' counters,
 *     ticker and hero callouts, shown to every visitor by design;
 *   - billingFn and followsFn.getSession — the login and payment flow itself;
 *   - functions that already require a session or an admin (follows, alerts,
 *     feedback, onboarding, crawls, engagement, data quality).
 *
 * The decision is memoised per isolate for a minute per user, so a map that
 * fires dozens of calls does not do a subscription read for each. A cancelled
 * subscription therefore loses data access within a minute, not instantly —
 * the page itself re-checks on every load. The session read is already cheap:
 * Better Auth's cookie cache (auth.ts) answers it without D1.
 *
 * Throws on refusal. The client sees a failed query, which is the honest state
 * for a caller the app would never have shown.
 */
const MEMO_MS = 60 * 1000;
const MEMO_MAX = 2000;
const memo = new Map<string, { at: number; access: AppAccess }>();

// Unexported on purpose — see sessionUser in billingFn.ts for why a helper that
// reaches @tanstack/react-start/server must stay private to the server code.
async function requestUser(e: AuthEnv | null): Promise<AccessUser> {
  const auth = e ? getAuth(e) : null;
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const u = session?.user;
    return u?.id ? { id: String(u.id), email: String(u.email || "") } : null;
  } catch {
    return null;
  }
}

export const subscriberOnly = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const e = await billingEnv();
  const user = await requestUser(e as AuthEnv | null);
  const key = user?.id ?? "";
  const hit = memo.get(key);
  let access: AppAccess;
  if (hit && Date.now() - hit.at < MEMO_MS) {
    access = hit.access;
  } else {
    access = await accessFor(e, user);
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, { at: Date.now(), access });
  }
  if (!access.allowed) {
    throw new Error(
      access.to === "signin"
        ? "Sign in to use employsi."
        : "An active employsi subscription is required.",
    );
  }
  return next();
});
