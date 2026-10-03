import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth, type AuthEnv } from "./auth";
import { roleForEmail } from "./roles";
import {
  LIVE_STATUSES,
  billingDb,
  billingEnv,
  paymentsConfigured,
  stripeMode,
  subscriptionFor,
} from "./billing";
import { accessFor, type AppAccess } from "./appAccess";
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
      const row = await subscriptionFor(db, user.id, stripeMode(e));
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
    // Same mode as this Worker's key, so a customer id from the other mode is
    // never sent to Stripe (it would not exist there, and checkout would fail).
    const row = db ? await subscriptionFor(db, user.id, stripeMode(e)).catch(() => null) : null;
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
 * Who may open /app, decided on the server. The rule itself is accessFor in
 * appAccess.ts — shared with subscriberOnly, which applies the same gates to
 * every paid data server function, so the page and its data cannot disagree.
 */
export type { AppAccess };

export const getAppAccess = createServerFn({ method: "GET" })
  // The Checkout Session id Stripe appends to the success URL, when arriving
  // straight from payment. Optional: every other visit sends nothing.
  .validator((data?: { checkoutSessionId?: string }) => data ?? {})
  .handler(async ({ data }): Promise<AppAccess> => {
    const e = await billingEnv();
    return accessFor(e, await sessionUser(), data?.checkoutSessionId);
  });
