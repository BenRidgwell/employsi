/**
 * The smallest Stripe client this app needs: form-encoded REST calls over
 * fetch, and webhook signature verification over WebCrypto.
 *
 * WHY NOT THE stripe PACKAGE. Two endpoints and one signature check do not
 * justify a dependency in a Cloudflare Worker bundle, and the one API feature
 * this is for — Managed Payments on Checkout — is a PREVIEW API version the
 * SDK's typed params do not describe, so every call would need casting
 * anyway. Stripe's REST surface is stable, form-encoded and documented; this
 * file is the whole of the integration's wire format.
 *
 * Pure: no Worker, request or session imports, so a script can use it too
 * (scripts/stripe-create-subscription-product.ts).
 */

/**
 * The API version Managed Payments requires, from the integration blueprint:
 * "use 2026-02-25.preview or above as your version header". Set per request
 * rather than account-wide, so nothing else on the account changes version.
 */
export const STRIPE_API_VERSION = "2026-02-25.preview";

type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

/**
 * Stripe's form encoding: nested objects and arrays become bracketed keys,
 * e.g. { line_items: [{ price: "p", quantity: 1 }] } →
 * line_items[0][price]=p&line_items[0][quantity]=1. Null/undefined are left
 * out rather than sent as empty strings, which Stripe reads as "unset".
 */
export function stripeForm(params: Record<string, Param>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (key: string, v: Param) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(`${key}[${k}]`, x);
    else out.append(key, String(v));
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** One Stripe API call. Throws StripeError with Stripe's own message on a non-2xx. */
export async function stripeRequest<T = Record<string, unknown>>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, Param> = {},
): Promise<T> {
  const body = stripeForm(params);
  const url = `https://api.stripe.com${path}${method === "GET" && [...body].length ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
  };
  if (!res.ok) {
    throw new StripeError(
      json.error?.message || `Stripe ${res.status}`,
      res.status,
      json.error?.code,
    );
  }
  return json as T;
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Equal-time string compare, so a forged signature cannot be found byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Verify a Stripe-Signature header against the RAW request body, the scheme
 * Stripe documents for webhooks: the header is `t=<unix>,v1=<hex>[,v1=…]`,
 * and each v1 is HMAC-SHA256(secret, `${t}.${body}`). Any matching v1 passes
 * (Stripe sends several while a secret is being rolled). Rejects a timestamp
 * more than `toleranceSec` from now, which is what stops a captured event
 * being replayed later.
 *
 * The body must be the exact bytes Stripe sent — parse the JSON only after
 * this returns true.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s.trim());
    if (k === "t") t = v;
    else if (k === "v1" && v) sigs.push(v);
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || !sigs.length) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)),
  );
  return sigs.some((s) => safeEqual(s, mac));
}
