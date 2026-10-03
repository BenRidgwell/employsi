import { authAvailable, type AuthEnv } from "./auth";
import { roleForEmail } from "./roles";
import {
  LIVE_STATUSES,
  billingDb,
  paymentsConfigured,
  recordCheckoutSession,
  stripeMode,
  subscriptionFor,
  type BillingEnv,
} from "./billing";

/**
 * Who may use the app — the ONE rule, shared by the /app page (getAppAccess in
 * billingFn.ts) and by every paid data server function (subscriberOnly in
 * subscriberOnly.ts). They used to be different things: the page was gated and
 * the data behind it answered anyone, so the paywall could be stepped around
 * by calling the functions directly. Keeping the rule in one place is what
 * stops the two drifting apart again.
 *
 * TWO GATES, IN ORDER, configured independently:
 *
 *  1. SIGN-IN, always, wherever Better Auth is configured (authAvailable).
 *  2. THE SUBSCRIPTION, wherever Stripe is configured on this Worker: an
 *     active/trialing subscription IN THIS WORKER'S STRIPE MODE (stripeMode —
 *     a test subscription from a preview never opens production).
 *
 * EACH GATE ONLY CLOSES WHERE IT CAN BE PASSED: gate 1 is skipped where
 * sign-in is not configured, gate 2 where payments are not. A Worker that
 * charges but cannot sign anyone in stays shut rather than open.
 * Administrators (ADMIN_EMAILS) skip gate 2, never gate 1.
 *
 * Takes the env and the already-resolved user, and touches no request state,
 * so it can be shared without dragging @tanstack/react-start/server into a
 * client bundle (see the note on sessionUser in billingFn.ts).
 */
export type AppAccess = { allowed: true } | { allowed: false; to: "signin" | "subscribe" };

export type AccessUser = { id: string; email: string } | null;

export async function accessFor(
  e: BillingEnv | null,
  user: AccessUser,
  checkoutSessionId?: string,
): Promise<AppAccess> {
  // Gate 1 — sign-in.
  if (!user) {
    if (authAvailable(e as AuthEnv | undefined)) return { allowed: false, to: "signin" };
    // No way to sign in here, but this Worker is set up to CHARGE: an anonymous
    // visitor is not let into a paid product because sign-in is half-configured.
    if (paymentsConfigured(e)) return { allowed: false, to: "signin" };
    // Neither gate can be passed and nothing is being sold.
    return { allowed: true };
  }

  // Gate 2 — the subscription, wherever it can be bought.
  if (!paymentsConfigured(e)) return { allowed: true };
  if (roleForEmail(e as never, user.email) === "admin") return { allowed: true };
  const db = billingDb(e);
  // Fail closed: if the table cannot be read, the answer is "subscribe", and
  // /login then shows the visitor their actual state.
  if (!db) return { allowed: false, to: "subscribe" };
  const row = await subscriptionFor(db, user.id, stripeMode(e)).catch(() => null);
  if (row?.status && LIVE_STATUSES.has(row.status)) return { allowed: true };
  // Just back from paying, ahead of the webhook: confirm with Stripe.
  if (checkoutSessionId) {
    const paid = await recordCheckoutSession(e!, db, checkoutSessionId, user.id).catch(() => false);
    if (paid) return { allowed: true };
  }
  return { allowed: false, to: "subscribe" };
}
