import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import siteCss from "@/site/site.css?url";
import { Brand, Site } from "@/site/SiteChrome";
import { appGatedOn } from "@/lib/siteGate";
import { getSession } from "@/employsi/lib/followsFn";
import { signOut, startSignIn } from "@/employsi/lib/authClient";

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
  const providers = session?.providers ?? [];

  if (isPending) {
    return (
      <div className="ws-providers" aria-busy>
        <div className="ws-skeleton-btn" />
        <div className="ws-skeleton-btn" />
      </div>
    );
  }

  if (session?.user) {
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
      <div style={{ marginTop: 36 }}>
        <h1>{create ? "Create your account." : "Welcome back"}</h1>
        <p className="sub">
          {create
            ? "Sign up with Google or LinkedIn. One click, no password to remember."
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
                // Straight into the map afterwards: /login is only the doorway.
                onClick={() => startSignIn(p, "/app")}
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
        // Neither provider's secrets are set on this deployment. Say so rather
        // than offering a button that ends in a 503 — the same rule the app's
        // own sign-in panel follows (employsi/components/SignInOptions.tsx).
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
