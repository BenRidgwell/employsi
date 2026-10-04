/**
 * Outbound email, for the handful of things the product needs to tell its
 * operator about. One sender, so there is one place that knows how mail leaves
 * this app.
 *
 * INERT UNTIL CONFIGURED, like the analyst's ANTHROPIC_API_KEY and Stripe's
 * keys: with no provider key and no recipient it returns false and does
 * nothing. That is what lets the feature it serves ship before the DNS and the
 * provider account exist, rather than waiting on them.
 *
 * THE RECIPIENT IS A SECRET, NOT A CONSTANT. This repository is public, so an
 * address written here would be published permanently — git history keeps it
 * after any later edit. Same reasoning as ADMIN_EMAILS in lib/roles.ts, and
 * the same mechanism: a Worker secret.
 *
 *   FEEDBACK_NOTIFY_TO   where operator notifications go
 *   RESEND_API_KEY       the provider key
 *   NOTIFY_FROM          the From address, on a domain the provider has verified
 *
 * BEFORE THIS CAN DELIVER TO employsi.com.au, THE DOMAIN'S DMARC HAS TO BE
 * SETTLED. Measured 2026-10-01: `v=DMARC1; p=reject; sp=reject; adkim=s;
 * aspf=s`. Strict alignment on both, with p=reject — so a message whose
 * Return-Path or DKIM d= is the provider's domain rather than exactly
 * employsi.com.au is REJECTED outright, not filed in spam. Either relax to
 * `adkim=r; aspf=r`, or configure a custom MAIL FROM and apex DKIM at the
 * provider. The send below is correct either way; the DNS is what decides
 * whether it arrives.
 *
 * Best effort by contract. Every caller treats a false as "not sent" and
 * carries on — a notification that fails must never fail the thing it was
 * reporting on.
 */

interface MailEnv {
  RESEND_API_KEY?: string;
  NOTIFY_FROM?: string;
  FEEDBACK_NOTIFY_TO?: string;
}

async function mailEnv(): Promise<MailEnv | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env ?? null) as MailEnv | null;
  } catch {
    return null; // off-Worker (local SSR)
  }
}

/** True when a provider key, a From and a recipient are all present. */
export function mailConfigured(e: MailEnv | null): boolean {
  return !!e?.RESEND_API_KEY && !!e.NOTIFY_FROM && !!e.FEEDBACK_NOTIFY_TO;
}

export interface Mail {
  subject: string;
  /** Plain text. No HTML: these are operator notes, not marketing. */
  text: string;
}

/**
 * Send one notification to the operator.
 *
 * Returns false — never throws — when it is not configured, when the provider
 * refuses, or when the request fails. Callers are fire-and-forget.
 */
export async function notifyOperator(mail: Mail): Promise<boolean> {
  const e = await mailEnv();
  if (!mailConfigured(e)) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${e!.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: e!.NOTIFY_FROM,
        to: [e!.FEEDBACK_NOTIFY_TO],
        subject: mail.subject,
        text: mail.text,
      }),
    });
    if (!res.ok) {
      // The body carries the provider's reason (unverified domain, bad key).
      // Logged rather than surfaced: nothing the visitor did is wrong.
      console.error("notifyOperator:", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("notifyOperator:", err);
    return false;
  }
}
