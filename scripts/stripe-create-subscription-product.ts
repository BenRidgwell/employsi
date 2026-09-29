/**
 * Create the subscription product and its monthly price in Stripe, for
 * Managed Payments, and print the price id to set as STRIPE_PRICE_ID.
 *
 *   STRIPE_SECRET_KEY=sk_test_… bun run scripts/stripe-create-subscription-product.ts
 *   STRIPE_SECRET_KEY=sk_test_… bun run scripts/stripe-create-subscription-product.ts \
 *       --amount 995 --currency aud --name "employsi subscription"
 *
 * Get the key from the Stripe Dashboard → Developers → API keys. Run it once
 * with a TEST key (for the preview Workers) and once with the LIVE key (for
 * production): test and live mode have separate products and price ids.
 *
 * WHAT IT CREATES, per the Managed Payments blueprint: a product with the
 * digital-goods tax code txcd_10103100 — Managed Payments only accepts
 * eligible tax codes, because Stripe is the merchant of record and remits the
 * tax — and a default recurring price. The defaults are the design's
 * "$9.95 / month" in AUD; override with the flags above. The login page reads
 * the amount back from Stripe, so whatever this creates is what it shows.
 *
 * IDEMPOTENT BY METADATA. The product is tagged employsi_plan=<plan>; a second
 * run finds it and prints its existing default price instead of creating a
 * duplicate. Pass --plan to create a different plan alongside.
 */
import { stripeRequest } from "../src/employsi/lib/stripeApi";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const key = process.env.STRIPE_SECRET_KEY || "";
if (!key.startsWith("sk_") && !key.startsWith("rk_")) {
  console.error("Set STRIPE_SECRET_KEY (Stripe Dashboard → Developers → API keys).");
  process.exit(1);
}

const plan = flag("plan", "basic");
const name = flag("name", "employsi subscription");
const currency = flag("currency", "aud").toLowerCase();
const amount = Number(flag("amount", "995"));
const interval = flag("interval", "month");
if (!Number.isInteger(amount) || amount <= 0) {
  console.error("--amount is in minor units (cents), e.g. 995 for $9.95.");
  process.exit(1);
}

type Product = { id: string; name: string; default_price?: string | { id: string } | null };
const priceId = (p: Product) =>
  typeof p.default_price === "string" ? p.default_price : (p.default_price?.id ?? null);

const mode = key.includes("_test_") ? "TEST" : "LIVE";
const existing = await stripeRequest<{ data: Product[] }>(key, "GET", "/v1/products/search", {
  query: `metadata['employsi_plan']:'${plan}' AND active:'true'`,
});
const found = existing.data[0];
if (found) {
  console.log(`[${mode}] product already exists: ${found.id} (${found.name})`);
  console.log(`STRIPE_PRICE_ID=${priceId(found)}`);
  process.exit(0);
}

const product = await stripeRequest<Product>(key, "POST", "/v1/products", {
  name,
  tax_code: "txcd_10103100",
  metadata: { employsi_plan: plan },
  default_price_data: {
    currency,
    unit_amount: amount,
    recurring: { interval },
  },
});
console.log(`[${mode}] created product ${product.id} (${product.name})`);
console.log(`STRIPE_PRICE_ID=${priceId(product)}`);
