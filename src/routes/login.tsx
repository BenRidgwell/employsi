import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import siteCss from "@/site/site.css?url";
import { Brand, Site } from "@/site/SiteChrome";
import { appGatedOn } from "@/lib/siteGate";
import { getSession } from "@/employsi/lib/followsFn";
import { signOut, startSignIn } from "@/employsi/lib/authClient";
import {
  getBillingState,
  startCheckout,
  type BillingState,
  type SubscriptionOffer,
} from "@/employsi/lib/billingFn";

type Mode = "login" | "create";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { mode?: "create" } =>
    s.mode === "create" ? { mode: "create" } : {},
  head: () => ({
    meta: [
      { title: "Log in — employsi" },
      { name: "description", content: "Sign in to employsi, or create an account." },
      // A doorway, not content: nothing here is worth a search result.
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: siteCss }],
  }),
  component: LoginPage,
});

const GoogleMark = () => (
  <svg width={20} height={20} viewBox="0 0 48 48" aria-hidden>
    <path
      fill="#EA4335"
      d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
    />
    <path
      fill="#FBBC05"
      d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8.1 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
    />
  </svg>
);

const LinkedInMark = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden>
    <rect width="24" height="24" rx="4" fill="#0A66C2" />
    <path
      fill="#fff"
      d="M6.9 9.6H4.4V19h2.5V9.6zM5.7 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19.6 13.8c0-2.8-1.5-4.4-3.9-4.4-1.4 0-2.4.7-2.9 1.5V9.6H10.3V19h2.5v-4.9c0-1.3.6-2.2 1.9-2.2 1.1 0 1.6.8 1.6 2.2V19h2.5v-5.2h.8z"
    />
  </svg>
);

/**
 * The left-hand film. Muted/inline are set on the element too: React does not
 * reliably serialise `muted` during SSR, and iOS will not autoplay without it.
 */
function Film() {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      v.pause();
      return;
    }
    void v.play().catch(() => {});
  }, []);
  return (
    <video
      ref={ref}
      src="/site/login.mp4"
      poster="/site/login-poster.jpg"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}

/**
 * THE WAITLIST, where sign-in is not open yet.
 *
 * On employsi.com.au the app and /api/auth are still closed (lib/siteGate.ts),
 * so "Continue with Google" there would start an OAuth round trip that ends in
 * a 302 back to the home page. Rather than offer a button that cannot work,
 * this page collects the email the old waitlist page did, through the same
 * form endpoint, so nothing about who signed up changes. Emptying
 * APP_ONLY_PATHS swaps this for the real buttons on the same deploy.
 */
function Waitlist() {
  const [email, setEmail] = useState("");
  // Bots fill every field they can see. A real person never touches this one,
  // so any value in it means the submit is automated and is dropped silently —
  // silently on purpose, because telling a bot it failed teaches it to retry.
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (status === "sending" || honeypot) return;
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setStatus("error");
      setError("Enter a valid email address.");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const r = await fetch("https://submit-form.com/GnhYzrssE", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: e, _source: "employsi waitlist" }),
      });
      // A 2xx is the only success; anything else must not read as one.
      if (!r.ok) throw new Error(String(r.status));
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <>
      <div>
        <h1>Get early access.</h1>
        <p className="sub">
          Accounts open here at launch. Leave your email and we&rsquo;ll let you know the moment
          they do.
        </p>
      </div>
      {status === "done" ? (
        <p className="ws-msg ok" style={{ marginTop: 32 }}>
          You&rsquo;re on the list. We&rsquo;ll be in touch at <strong>{email}</strong>.
        </p>
      ) : (
        <form className="ws-providers" onSubmit={submit} noValidate>
          <input
            className="ws-field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            autoComplete="email"
            aria-label="Email address"
            required
          />
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
          />
          <button className="ws-provider primary" type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Joining…" : "Join the waitlist"}
          </button>
          {status === "error" && <p className="ws-msg err">{error}</p>}
        </form>
      )}
      <p className="swap">
        Want to see it first? <Link to="/product">Take the product tour</Link>
      </p>
    </>
  );
}

/** "$9.95 AUD / month" — from the Stripe price, in the currency it charges. */
function priceLabel(o: SubscriptionOffer): string {
  const code = o.currency.toUpperCase();
  let amount: string;
  try {
    amount = new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).format(o.amount / 100);
  } catch {
    amount = (o.amount / 100).toFixed(2);
  }
  const every = o.intervalCount > 1 ? `every ${o.intervalCount} ${o.interval}s` : `/ ${o.interval}`;
  return `${amount} ${code} ${every}`;
}

const PER: Record<string, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** The design's two-step bar: Account, then Payment. */
function Steps({ at }: { at: 0 | 1 }) {
  return (
    <div className="ws-stepbar" aria-label={`Step ${at + 1} of 2`}>
      {["Account", "Payment"].map((label, i) => (
        <div key={label} className={i <= at ? "done" : ""}>
          <div className="bar" />
          <div className={`lbl${i === at ? " on" : ""}`}>{label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Step two of "Create account": review the subscription, then pay on Stripe.
 *
 * Every figure on the card is the Stripe price's own (getBillingState reads
 * it); none is typed into this page. Tax is not shown as a number because
 * Stripe works it out from the billing address on the checkout page — Managed
 * Payments makes Stripe the merchant of record — so the card says that instead
 * of printing a total that would be wrong for most visitors.
 */
function PaymentStep({ billing, onBack }: { billing: BillingState; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const offer = billing.offer;

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await startCheckout();
      if ("url" in r) {
        window.location.href = r.url;
        return; // leaving the page; keep the button disabled
      }
      if ("alreadyActive" in r) {
        window.location.href = "/app";
        return;
      }
      setError(r.error);
    } catch {
      setError("Could not start checkout. Please try again.");
    }
    setBusy(false);
  };

  return (
    <>
      <Steps at={1} />
      <div style={{ marginTop: 28 }}>
        <h1>Payment.</h1>
        <p className="sub">Review your subscription, then pay through Stripe.</p>
      </div>
      {billing.payments && offer ? (
        <div className="ws-providers" style={{ gap: 16 }}>
          <div className="ws-plan">
            <div className="row">
              <span className="name">{offer.productName}</span>
              <span className="price">{priceLabel(offer)}</span>
            </div>
            <div className="row muted">
              <span>
                Billed{" "}
                {offer.intervalCount > 1
                  ? `every ${offer.intervalCount} ${offer.interval}s`
                  : (PER[offer.interval] ?? `every ${offer.interval}`)}
              </span>
              <span>Cancel any time</span>
            </div>
            <div className="rule" />
            <div className="row">
              <span className="muted">Tax</span>
              <span className="muted">Calculated by Stripe at checkout</span>
            </div>
          </div>
          <button
            type="button"
            className="ws-provider primary"
            onClick={() => void pay()}
            disabled={busy}
          >
            <span>{busy ? "Opening Stripe…" : "Continue to Stripe"}</span>
            {!busy && <span aria-hidden>→</span>}
          </button>
          {error && <p className="ws-msg err">{error}</p>}
          <button type="button" className="ws-linkbtn" onClick={onBack}>
            Back
          </button>
        </div>
      ) : (
        <>
          {/* No key or no price on this Worker (or the price could not be
              read): say so, rather than a button that fails at Stripe. */}
          <p className="sub" style={{ marginTop: 32 }}>
            Subscriptions aren&rsquo;t set up on this deployment yet. You can still browse
            everything on the map.
          </p>
          <div className="ws-providers">
            <a className="ws-provider primary" href="/app">
              <span>Explore the map</span>
              <span aria-hidden>→</span>
            </a>
          </div>
        </>
      )}
      <p className="fine">
        You&rsquo;ll finish payment securely on Stripe, then come straight back to employsi.
      </p>
    </>
  );
}

function SignIn({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const {
    data: session,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ["session"],
    queryFn: () => getSession(),
    retry: false,
  });
  const { data: billing, isPending: billingPending } = useQuery({
    queryKey: ["billing"],
    queryFn: () => getBillingState(),
    retry: false,
    enabled: !!session?.user,
  });
  const providers = session?.providers ?? [];

  const skeleton = (
    <div className="ws-providers" aria-busy>
      <div className="ws-skeleton-btn" />
      <div className="ws-skeleton-btn" />
    </div>
  );
  if (isPending) return skeleton;

  if (session?.user) {
    if (billingPending) return skeleton;
    // Signed in and choosing "Create account" (or arriving back from the
    // sign-up redirect, which returns to ?mode=create): the Payment step,
    // unless they already subscribe.
    if (mode === "create" && billing && !billing.active) {
      return <PaymentStep billing={billing} onBack={() => setMode("login")} />;
    }
    return (
      <>
        <div>
          <h1>You&rsquo;re signed in.</h1>
          <p className="sub">
            Signed in as {session.user.name}
            {session.user.email && session.user.email !== session.user.name
              ? ` (${session.user.email})`
              : ""}
            .
          </p>
        </div>
        <div className="ws-providers">
          <a className="ws-provider primary" href="/app">
            <span>Open the map</span>
            <span aria-hidden>→</span>
          </a>
        </div>
        {billing?.active ? (
          <p className="fine">
            Subscription active
            {billing.currentPeriodEnd ? `, paid until ${fmtDate(billing.currentPeriodEnd)}` : ""}.
          </p>
        ) : billing?.payments ? (
          <p className="swap">
            No subscription yet.{" "}
            <button type="button" onClick={() => setMode("create")}>
              Start your subscription
            </button>
          </p>
        ) : null}
        <p className="swap">
          Not you?{" "}
          <button type="button" onClick={() => void signOut().finally(() => void refetch())}>
            Sign out
          </button>
        </p>
      </>
    );
  }

  const create = mode === "create";
  return (
    <>
      <div className="ws-tabs" role="tablist" aria-label="Account">
        {(["login", "create"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
          >
            {m === "login" ? "Log in" : "Create account"}
          </button>
        ))}
      </div>
      {create && (
        <div style={{ marginTop: 36 }}>
          <Steps at={0} />
        </div>
      )}
      <div style={{ marginTop: create ? 28 : 36 }}>
        <h1>{create ? "Create your account." : "Welcome back"}</h1>
        <p className="sub">
          {create
            ? "Sign up with Google or LinkedIn, then set up your subscription."
            : "Sign in to your employsi account."}
        </p>
      </div>
      {providers.length ? (
        <>
          <div className="ws-providers">
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                className="ws-provider"
                // Log in goes straight to the map. Create account comes back
                // here, signed in, for the Payment step.
                onClick={() => startSignIn(p, create ? "/login?mode=create" : "/app")}
              >
                {p === "google" ? <GoogleMark /> : <LinkedInMark />}
                <span>
                  {create ? "Sign up" : "Continue"} with {p === "google" ? "Google" : "LinkedIn"}
                </span>
              </button>
            ))}
          </div>
          <p className="fine">We only use your account to sign you in. No posts, no contacts.</p>
        </>
      ) : (
        // Better Auth is not configured on this deployment (see authAvailable).
        // Say so rather than offering a button that ends in a 503 — the same
        // rule the app's own sign-in panel follows.
        <>
          <p className="sub" style={{ marginTop: 32 }}>
            Sign-in isn&rsquo;t set up on this deployment yet. You can still browse everything on
            the map.
          </p>
          <div className="ws-providers">
            <a className="ws-provider primary" href="/app">
              <span>Explore the map</span>
              <span aria-hidden>→</span>
            </a>
          </div>
        </>
      )}
      <p className="swap">
        {create ? "Already have an account? " : "New to employsi? "}
        <button type="button" onClick={() => setMode(create ? "login" : "create")}>
          {create ? "Sign in" : "Create an account"}
        </button>
      </p>
    </>
  );
}

function LoginPage() {
  const { mode } = Route.useSearch();
  // Whether sign-in is open depends on the HOST, which only the browser knows
  // for certain here; decided after mount so SSR and hydration agree.
  const [gated, setGated] = useState<boolean | null>(null);
  useEffect(() => setGated(appGatedOn(window.location.hostname)), []);

  return (
    <Site>
      <main className="ws-auth">
        <div className="media">
          <Film />
          <div className="tint" />
          <div className="grad" />
          <Brand light />
          <div className="tagline">Explore the world of work.</div>
        </div>
        <div className="pane">
          <div className="form">
            {gated === null ? (
              <div className="ws-providers" aria-busy>
                <div className="ws-skeleton-btn" />
                <div className="ws-skeleton-btn" />
              </div>
            ) : gated ? (
              <Waitlist />
            ) : (
              <SignIn initial={mode === "create" ? "create" : "login"} />
            )}
          </div>
        </div>
      </main>
    </Site>
  );
}
