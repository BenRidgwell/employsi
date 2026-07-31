import { useAppStore } from "../state/store";
import { startSignIn } from "../lib/authClient";

/**
 * The sign-in choices, shared by the search-pill panel and the account button.
 *
 * Two providers, no form. The email/password form these panels used to show was
 * theatre — it accepted any password, verified nothing and created no user — so
 * replacing it with real OAuth removes fields rather than adding them.
 *
 * The buttons offered are whatever the DEPLOYMENT can actually complete: the
 * server reports which provider secrets are present (see lib/followsFn.ts), and
 * a provider without them is not shown at all. A button that starts a redirect
 * and lands on a 503 is worse than one that was never there.
 */

const GoogleMark = () => (
  <svg viewBox="0 0 18 18" width={17} height={17} aria-hidden>
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.33A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.94a9 9 0 0 0 0 8.1l3.03-2.33Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .94 4.95l3.03 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
    />
  </svg>
);

const LinkedInMark = () => (
  <svg viewBox="0 0 24 24" width={17} height={17} aria-hidden>
    <path
      fill="#0A66C2"
      d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"
    />
  </svg>
);

const LABEL: Record<string, string> = {
  google: "Continue with Google",
  linkedin: "Continue with LinkedIn",
};

export function SignInOptions({ compact = false }: { compact?: boolean }) {
  const providers = useAppStore((s) => s.authProviders);

  if (!providers.length) {
    // Nothing configured on this deployment. Say so plainly — a visitor who
    // cannot sign in should know it is us, not them.
    return (
      <p className="authnote">
        Sign-in isn&rsquo;t set up on this deployment yet. You can browse everything on the map;
        following companies and posting to the feedback board need an account.
      </p>
    );
  }

  return (
    <div className={`authoptions${compact ? " compact" : ""}`}>
      {providers.map((p) => (
        <button key={p} type="button" className="authprovider" onClick={() => startSignIn(p)}>
          {p === "google" ? <GoogleMark /> : <LinkedInMark />}
          <span>{LABEL[p]}</span>
        </button>
      ))}
      <p className="authfine">
        We only read your name, email and profile picture — enough to save what you follow.
      </p>
    </div>
  );
}
