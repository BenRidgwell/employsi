import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authAvailable, getAuth, type AuthEnv } from "./auth";
import { roleForEmail } from "./roles";
import {
  LIVE_STATUSES,
  billingDb,
  billingEnv,
  paymentsConfigured,
  recordCheckoutSession,
  subscriptionFor,
} from "./billing";
import { StripeError, stripeRequest } from "./stripeApi";

/**
 * The subscription offer and the caller's standing, for /login's Payment step.
 *
 * The PRICE IS READ FROM STRIPE, never written into the page. The design
 * showed "$9.95 / month"; what the visitor is charged is whatever
 * STRIPE_PRICE_ID says, and printing a constant beside it is how the two
 * drift apart. Memoised per isolate for an hour — a price change in Stripe
 * reaches the page within the hour, and the Payment step does not wait on a
 * Stripe round trip for every visitor.
 */
export interface SubscriptionOffer {
  productName: string;
  /** Minor units (cents). */
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
}

export interface BillingState {
  /** Stripe key and price are set on this Worker, so checkout can start. */
  payments: boolean;
  offer: SubscriptionOffer | null;
  signedIn: boolean;
  /** Stripe's subscription status for this user, or null if they have none. */
  status: string | null;
  /** status is one that grants access (active / trialing). */
  active: boolean;
  /** Unix seconds; the end of the period already paid for. */
  currentPeriodEnd: number | null;
  /** An administrator (ADMIN_EMAILS): passes the paywall without paying. */
  exempt: boolean;
}

/**
 * The signed-in Better Auth user, from this request's cookies.
 *
 * DELIBERATELY LOCAL AND UNEXPORTED — the same shape as followsFn's private
 * helper, not an import of it. This module is imported by /login, a client
 * route, and TanStack Start's import protection refuses any client bundle that
 * still reaches @tanstack/react-start/server. A module-level helper that only
 * server-function handlers call is stripped along with those handlers; an
 * EXPORTED one is kept, and failed the build (2026-09-29, deploy-preview run
 * 91) when followsFn's helper was exported for reuse here.
 */
async function sessionUser(): Promise<{ id: string; email: string } | null> {
  const e = (await billingEnv()) as AuthEnv | null;
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

let offerMemo: { at: number; price: string; value: SubscriptionOffer } | null = null;
const OFFER_MEMO_MS = 60 * 60 * 1000;

async function readOffer(secretKey: string, priceId: string): Promise<SubscriptionOffer | null> {
  if (offerMemo && offerMemo.price === priceId && Date.now() - offerMemo.at < OFFER_MEMO_MS) {
    return offerMemo.value;
  }
  try {
    const p = await stripeRequest<{
      unit_amount?: number | null;
      currency?: string;
      recurring?: { interval?: string; interval_count?: number } | null;
      product?: { name?: string } | string;
    }>(secretKey, "GET", `/v1/prices/${encodeURIComponent(priceId)}`, {
      expand: ["product"],
    });
    // A price with no fixed amount (metered, customer-chosen) cannot be shown
    // as "$X / month", and this page will not guess one.
    if (typeof p.unit_amount !== "number" || !p.currency || !p.recurring?.interval) return null;
    const value: SubscriptionOffer = {
      productName: typeof p.product === "object" && p.product?.name ? p.product.name : "employsi",
      amount: p.unit_amount,
      currency: p.currency,
      interval: p.recurring.interval,
      intervalCount: p.recurring.interval_count ?? 1,
    };
    offerMemo = { at: Date.now(), price: priceId, value };
    return value;
  } catch (err) {
    console.error("billing offer:", err);
    return null;
  }
}

export const getBillingState = createServerFn({ method: "GET" }).handler(
  async (): Promise<BillingState> => {
    const e = await billingEnv();
    const payments = paymentsConfigured(e);
    const offer = payments ? await readOffer(e!.STRIPE_SECRET_KEY!, e!.STRIPE_PRICE_ID!) : null;
    const user = await sessionUser();
    const base: BillingState = {
      payments: payments && !!offer,
      offer,
      signedIn: !!user,
      status: null,
      active: false,
      currentPeriodEnd: null,
      exempt: !!user && roleForEmail(e as never, user.email) === "admin",
    };
    const db = billingDb(e);
    if (!user || !db) return base;
    try {
      const row = await subscriptionFor(db, user.id);
      return {
        ...base,
        status: row?.status ?? null,
        active: !!row?.status && LIVE_STATUSES.has(row.status),
        currentPeriodEnd: row?.current_period_end ?? null,
      };
    } catch {
      return base;
    }
  },
);

export type StartCheckoutResult = { url: string } | { alreadyActive: true } | { error: string };

/**
 * Create a Stripe Checkout Session for the signed-in user and return its
 * hosted URL. The page then navigates there.
 *
 * The parameters the Managed Payments blueprint requires, plus the ones that
 * tie the payment back to the Better Auth user:
 *  • client_reference_id + metadata.user_id on the session, and
 *    subscription_data.metadata.user_id on the subscription it creates — so
 *    checkout.session.completed and every later subscription event name the
 *    user without a lookup by email;
 *  • customer, when this user already has one from an earlier checkout, so a
 *    returning subscriber is not a second Stripe customer; otherwise
 *    customer_email, prefilled from their Google/LinkedIn address.
 */
export const startCheckout = createServerFn({ method: "POST" }).handler(
  async (): Promise<StartCheckoutResult> => {
    const e = await billingEnv();
    if (!paymentsConfigured(e)) {
      return { error: "Payments are not set up on this deployment yet." };
    }
    const user = await sessionUser();
    if (!user) return { error: "Sign in first, then continue to payment." };
    const db = billingDb(e);
    const row = db ? await subscriptionFor(db, user.id).catch(() => null) : null;
    if (row?.status && LIVE_STATUSES.has(row.status)) return { alreadyActive: true };

    // The origin the visitor is on, so a preview's checkout returns to the
    // preview and production's to production.
    let origin = "";
    try {
      origin = new URL(getRequest().url).origin;
    } catch {
      return { error: "Could not work out where to return you after payment." };
    }

    try {
      const session = await stripeRequest<{ id: string; url?: string | null }>(
        e!.STRIPE_SECRET_KEY!,
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "subscription",
          line_items: [{ price: e!.STRIPE_PRICE_ID!, quantity: 1 }],
          managed_payments: { enabled: true },
          // {CHECKOUT_SESSION_ID} is filled in by Stripe; the /app paywall uses
          // it to confirm the payment itself rather than race the webhook
          // (recordCheckoutSession in billing.ts).
          success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/login?mode=create`,
          client_reference_id: user.id,
          metadata: { user_id: user.id },
          subscription_data: { metadata: { user_id: user.id } },
          ...(row?.stripe_customer_id
            ? { customer: row.stripe_customer_id }
            : user.email
              ? { customer_email: user.email }
              : {}),
        },
      );
      if (!session.url) return { error: "Stripe did not return a checkout page." };
      return { url: session.url };
    } catch (err) {
      console.error("startCheckout:", err);
      return {
        error:
          err instanceof StripeError
            ? `Stripe refused the checkout: ${err.message}`
            : "Could not reach Stripe. Please try again.",
      };
    }
  },
);

/**
 * Who may open /app, decided on the server.
 *
 * TWO GATES, IN ORDER, and they are configured independently:
 *
 *  1. SIGN-IN, always. The app is for signed-in users only — every surface
 *     inside it (follows, alerts, the career goal, the feedback board) writes
 *     against an account, and the subscription model has no anonymous tier to
 *     serve. A signed-out visitor is sent to /login.
 *  2. THE SUBSCRIPTION, where Stripe is configured on this Worker. A signed-in
 *     visitor without a live subscription (active / trialing, per Stripe, as
 *     recorded by the webhook) goes to the Payment step — never subscribed,
 *     cancelled, or lapsed.
 *
 * Until 2026-09-30 there was only gate 2, and gate 1 rode along inside it: the
 * handler returned `allowed` outright when payments were not configured, so a
 * Worker without Stripe keys — the app preview, and production until its live
 * keys are set — let anonymous visitors all the way in. Requiring sign-in was
 * therefore a property of having set up BILLING, which is not what it should
 * depend on. The two are now asked separately, so the app is signed-in-only on
 * every deployment whether or not it can take money yet.
 *
 * EACH GATE ONLY CLOSES WHERE IT CAN BE PASSED. Gate 2 is skipped without
 * Stripe, as before. Gate 1 is skipped where Better Auth is not configured
 * (authAvailable) — on such a Worker there is no way to sign in, so requiring
 * it would lock the app with no door, and /login already says sign-in is not
 * configured rather than offering a button that 500s. That is the same rule
 * gate 2 follows, not an exemption: a gate nobody can pass is a wall.
 *
 * Administrators (ADMIN_EMAILS) skip gate 2, so the people running the product
 * can use it without paying. They do NOT skip gate 1 — an admin is still a
 * signed-in user, and there is no way to know they are one until they are.
 *
 * This gates the PAGE. The data server functions the map calls stay callable
 * without a session, as several of them already are from the public marketing
 * pages (the landing counters, the skills ticker).
 */
export type AppAccess = { allowed: true } | { allowed: false; to: "signin" | "subscribe" };

export const getAppAccess = createServerFn({ method: "GET" })
  // The Checkout Session id Stripe appends to the success URL, when arriving
  // straight from payment. Optional: every other visit sends nothing.
  .validator((data?: { checkoutSessionId?: string }) => data ?? {})
  .handler(async ({ data }): Promise<AppAccess> => {
    const e = await billingEnv();
    const user = await sessionUser();

    // Gate 1 — sign-in.
    if (!user) {
      // Wherever signing in is possible, it is required.
      if (authAvailable(e as AuthEnv | undefined)) return { allowed: false, to: "signin" };
      // Auth is not configured here, so there is no door — but if this Worker is
      // set up to CHARGE, an anonymous visitor is not let into a paid product
      // just because its sign-in is half-configured. /login says sign-in is not
      // configured on this deployment, which is the true answer and the one that
      // gets it fixed. This is also exactly what the old single gate did, so
      // this branch keeps a Stripe-configured Worker no more open than before.
      if (paymentsConfigured(e)) return { allowed: false, to: "signin" };
      // Neither gate can be passed and nothing is being sold: an unconfigured
      // deployment, which stays open as it always has.
      return { allowed: true };
    }

    // Gate 2 — the subscription, wherever it can be bought.
    if (!paymentsConfigured(e)) return { allowed: true };
    if (roleForEmail(e as never, user.email) === "admin") return { allowed: true };
    const db = billingDb(e);
    // The subscription table is the source of truth. If it cannot be read the
    // visitor is sent to /login, which will show them their actual state —
    // failing closed on a paywall, rather than open.
    if (!db) return { allowed: false, to: "subscribe" };
    const row = await subscriptionFor(db, user.id).catch(() => null);
    if (row?.status && LIVE_STATUSES.has(row.status)) return { allowed: true };
    // Just back from paying, ahead of the webhook: confirm with Stripe.
    const sid = data?.checkoutSessionId;
    if (sid) {
      const paid = await recordCheckoutSession(e!, db, sid, user.id).catch(() => false);
      if (paid) return { allowed: true };
    }
    return { allowed: false, to: "subscribe" };
  });
