import type { D1Like } from "./jobArchive";
import { stripeRequest, verifyStripeSignature } from "./stripeApi";

/**
 * Subscriptions: which Better Auth user holds which Stripe customer and
 * subscription, and whether it is live.
 *
 * FLOW (Stripe Managed Payments, hosted Checkout):
 *   /login "Create account" → sign up with Google/LinkedIn (Better Auth)
 *   → the Payment step → startCheckout (billingFn.ts) creates a Checkout
 *     Session for STRIPE_PRICE_ID with managed_payments[enabled]=true, tagged
 *     with the user's id → the visitor pays on Stripe → /app
 *   → Stripe POSTs checkout.session.completed to /api/billing/webhook
 *     (mounted in src/server.ts) → the row below is written.
 * Later customer.subscription.updated / .deleted events keep `status` true.
 *
 * Managed Payments makes Stripe the merchant of record: it calculates and
 * remits sales tax / VAT / GST and handles fraud and customer transaction
 * support, which is why nothing here computes tax.
 *
 * ── Configuration (Worker secrets, per Worker) ─────────────────────────────
 *   STRIPE_SECRET_KEY       Stripe Dashboard → Developers → API keys
 *   STRIPE_PRICE_ID         the recurring price to sell (price_…), printed by
 *                           scripts/stripe-create-subscription-product.ts
 *   STRIPE_WEBHOOK_SECRET   whsec_… from the webhook endpoint for
 *                           {origin}/api/billing/webhook, subscribed to
 *                           checkout.session.completed,
 *                           customer.subscription.updated,
 *                           customer.subscription.deleted
 * Without the first two, the Payment step says payments are not set up rather
 * than offering a button that fails. Without the third, the webhook answers
 * 503 and Stripe retries it, so nothing is lost while it is being configured.
 *
 * WRITES THE SHARED D1. Every preview Worker binds the production database,
 * so a test checkout on a preview writes a real row here — keyed by the user
 * id of whoever signed in there. Use Stripe TEST keys on previews.
 */

export interface BillingEnv {
  JOBS_ARCHIVE?: unknown;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export async function billingEnv(): Promise<BillingEnv | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env ?? null) as BillingEnv | null;
  } catch {
    return null; // off-Worker (local SSR)
  }
}

export function billingDb(e: BillingEnv | null): D1Like | null {
  return (e?.JOBS_ARCHIVE as D1Like) ?? null;
}

/** Checkout can be offered: a key to call Stripe with and a price to sell. */
export function paymentsConfigured(e: BillingEnv | null): boolean {
  return !!e?.STRIPE_SECRET_KEY && !!e?.STRIPE_PRICE_ID;
}

/** Stripe subscription statuses that mean the subscriber has access. */
export const LIVE_STATUSES = new Set(["active", "trialing"]);

export interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
  /** Unix seconds; the end of the period already paid for. */
  current_period_end: number | null;
  updated_at: string;
}

// Created lazily, like llm_usage (analystLlmFn.ts): no migration step exists
// in this repo, and CREATE ... IF NOT EXISTS is idempotent and cheap.
let tableReady = false;
async function ensureTable(db: D1Like): Promise<void> {
  if (tableReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS billing_subscription (
         user_id                TEXT PRIMARY KEY,  -- Better Auth user.id
         stripe_customer_id     TEXT,
         stripe_subscription_id TEXT,
         status                 TEXT,              -- Stripe's subscription status
         current_period_end     INTEGER,           -- unix seconds
         updated_at             TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS billing_subscription_sub
         ON billing_subscription (stripe_subscription_id)`,
    )
    .run();
  tableReady = true;
}

export async function subscriptionFor(db: D1Like, userId: string): Promise<SubscriptionRow | null> {
  await ensureTable(db);
  return await db
    .prepare(`SELECT * FROM billing_subscription WHERE user_id = ?1`)
    .bind(userId)
    .first<SubscriptionRow>();
}

async function upsertSubscription(
  db: D1Like,
  row: Omit<SubscriptionRow, "updated_at">,
): Promise<void> {
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO billing_subscription
         (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id     = COALESCE(excluded.stripe_customer_id, stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, stripe_subscription_id),
         status                 = COALESCE(excluded.status, status),
         current_period_end     = COALESCE(excluded.current_period_end, current_period_end),
         updated_at             = excluded.updated_at`,
    )
    .bind(
      row.user_id,
      row.stripe_customer_id,
      row.stripe_subscription_id,
      row.status,
      row.current_period_end,
      new Date().toISOString(),
    )
    .run();
}

type StripeSubscription = {
  id: string;
  status?: string;
  customer?: string | { id: string };
  metadata?: Record<string, string>;
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
};

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String(v.id) : null;

/**
 * The paid-through date. It moved from the subscription onto its items in the
 * 2025-03 API versions, and which shape arrives depends on the version the
 * webhook endpoint was created with — so both are read.
 */
function periodEnd(s: StripeSubscription): number | null {
  return s.current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null;
}

/** Record a subscription's current state against the user it belongs to. */
async function recordSubscription(
  db: D1Like,
  sub: StripeSubscription,
  userId: string | null,
): Promise<void> {
  let uid = userId || sub.metadata?.user_id || null;
  if (!uid) {
    // An event for a subscription created before metadata was attached, or
    // outside this app: find the owner by the id we stored at checkout.
    await ensureTable(db);
    const hit = await db
      .prepare(`SELECT user_id FROM billing_subscription WHERE stripe_subscription_id = ?1`)
      .bind(sub.id)
      .first<{ user_id: string }>();
    uid = hit?.user_id ?? null;
  }
  // Nothing to attach it to: not ours, or not yet linked. Acknowledged, not stored.
  if (!uid) return;
  await upsertSubscription(db, {
    user_id: uid,
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    status: sub.status ?? null,
    current_period_end: periodEnd(sub),
  });
}

/**
 * Record a just-completed Checkout Session straight from Stripe, without
 * waiting for its webhook.
 *
 * Checkout redirects the customer to /app the moment they pay; the
 * checkout.session.completed webhook is sent at about the same time and can
 * land a few seconds AFTER them. The /app paywall reads the table the webhook
 * writes, so without this a customer who had just paid could be bounced back
 * to the Payment step. The success URL carries the session id
 * ({CHECKOUT_SESSION_ID}); this fetches that session from Stripe and, if it is
 * complete and belongs to the signed-in user, writes the same row the webhook
 * would. The webhook still arrives and writes it again — same values, so the
 * two cannot disagree.
 *
 * Returns true only when the session is this user's and is complete.
 */
export async function recordCheckoutSession(
  e: BillingEnv,
  db: D1Like,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  if (!e.STRIPE_SECRET_KEY || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  const session = await stripeRequest<{
    status?: string;
    client_reference_id?: string | null;
    subscription?: unknown;
  }>(e.STRIPE_SECRET_KEY, "GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  // Someone else's session id in the URL proves nothing about this user.
  if (session.client_reference_id !== userId || session.status !== "complete") return false;
  const subId = idOf(session.subscription);
  if (!subId) return false;
  const sub = await stripeRequest<StripeSubscription>(
    e.STRIPE_SECRET_KEY,
    "GET",
    `/v1/subscriptions/${encodeURIComponent(subId)}`,
  );
  await recordSubscription(db, sub, userId);
  return !!sub.status && LIVE_STATUSES.has(sub.status);
}

/**
 * POST /api/billing/webhook. Takes the raw Request because the signature is
 * over the exact body bytes — this is why it is mounted in server.ts ahead of
 * the router, like /api/auth and /api/events, rather than as a server function.
 *
 * Answers 2xx only once the event is stored (or is one this app ignores), so
 * a D1 failure makes Stripe retry rather than silently losing a payment.
 */
export async function handleBillingWebhook(request: Request): Promise<Response> {
  const e = await billingEnv();
  const db = billingDb(e);
  if (!e?.STRIPE_WEBHOOK_SECRET || !e.STRIPE_SECRET_KEY || !db) {
    return Response.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503 },
    );
  }
  const payload = await request.text();
  const ok = await verifyStripeSignature(
    payload,
    request.headers.get("stripe-signature"),
    e.STRIPE_WEBHOOK_SECRET,
  );
  if (!ok) return Response.json({ error: "Bad signature." }, { status: 400 });

  const event = JSON.parse(payload) as {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const obj = event.data?.object ?? {};
  try {
    if (event.type === "checkout.session.completed") {
      // The session names the user (client_reference_id, set at checkout) and
      // the subscription it created; the subscription itself is fetched so the
      // stored status and period are Stripe's, not inferred from the session.
      const userId =
        (obj.client_reference_id as string | undefined) ||
        ((obj.metadata as Record<string, string> | undefined)?.user_id ?? null);
      const subId = idOf(obj.subscription);
      if (subId) {
        const sub = await stripeRequest<StripeSubscription>(
          e.STRIPE_SECRET_KEY,
          "GET",
          `/v1/subscriptions/${encodeURIComponent(subId)}`,
        );
        await recordSubscription(db, sub, userId || null);
      } else if (userId) {
        await upsertSubscription(db, {
          user_id: userId,
          stripe_customer_id: idOf(obj.customer),
          stripe_subscription_id: null,
          status: null,
          current_period_end: null,
        });
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.created"
    ) {
      await recordSubscription(db, obj as unknown as StripeSubscription, null);
    }
    return Response.json({ received: true });
  } catch (err) {
    console.error("billing webhook:", err);
    return Response.json({ error: "Could not record the event." }, { status: 500 });
  }
}
