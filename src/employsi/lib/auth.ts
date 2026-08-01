import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";

/**
 * Real authentication, replacing the placeholder that shipped until now.
 *
 * WHAT WAS THERE BEFORE. `signIn(email)` in the store set a name and an email in
 * the browser. No password, no verification, no session, no user record — a
 * "signed-in" visitor was one who had typed an email address. Every gate built
 * on it (follow a company, post to the feedback board) was therefore a UI
 * convention, not a permission, and the feedback handlers said so in their own
 * comments rather than implying otherwise.
 *
 * WHAT THIS IS. Better Auth, self-hosted in this same Worker, with users,
 * sessions and OAuth accounts in the D1 database the app already uses. Nothing
 * leaves Cloudflare, there is no per-user cost, and there is no third party
 * holding the user table.
 *
 * Sign-in is Google and LinkedIn only — no passwords, so there is nothing to
 * reset, nothing to leak, and no verification mail to send. LinkedIn is the one
 * that matters for an HR-intelligence product: it is the account this audience
 * already has, and it is where their professional identity lives.
 *
 * ── Configuration ──────────────────────────────────────────────────────────
 * Worker secrets (wrangler secret put NAME):
 *   BETTER_AUTH_SECRET       32+ random bytes; signs session cookies
 *   BETTER_AUTH_URL          the deployed origin, e.g. https://employsi.com
 *   GOOGLE_CLIENT_ID         Google Cloud console → Credentials → OAuth client
 *   GOOGLE_CLIENT_SECRET
 *   LINKEDIN_CLIENT_ID       LinkedIn developer portal → app → Auth
 *   LINKEDIN_CLIENT_SECRET
 *
 * Redirect URLs to register with each provider:
 *   {BETTER_AUTH_URL}/api/auth/callback/google
 *   {BETTER_AUTH_URL}/api/auth/callback/linkedin
 *
 * WITHOUT THOSE SECRETS the app still runs: authAvailable() returns false, the
 * sign-in panel says so instead of offering a button that cannot work, and
 * every account-gated action stays gated. A half-configured auth provider that
 * throws on the first click would be worse than one that admits it is not set
 * up yet.
 */

export interface AuthEnv {
  JOBS_ARCHIVE?: unknown;
  /** Comma-separated administrator emails — see lib/roles.ts. Unset = none. */
  ADMIN_EMAILS?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
}

type Auth = ReturnType<typeof buildAuth>;

// One instance per isolate. The D1 binding and the secrets are fixed for the
// life of the isolate, so rebuilding this per request would just re-do the
// same work — but it cannot be built at module scope either, because the
// bindings do not exist until the first request arrives.
let cached: Auth | null = null;
let cachedFor: unknown = null;

/** True when every secret the configured providers need is present. */
export function authAvailable(env: AuthEnv | undefined): boolean {
  if (!env?.JOBS_ARCHIVE || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) return false;
  const google = !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
  const linkedin = !!env.LINKEDIN_CLIENT_ID && !!env.LINKEDIN_CLIENT_SECRET;
  return google || linkedin;
}

/** Which sign-in buttons to offer, so the panel never shows one that 500s. */
export function authProviders(env: AuthEnv | undefined): ("google" | "linkedin")[] {
  const out: ("google" | "linkedin")[] = [];
  if (env?.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  if (env?.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) out.push("linkedin");
  return out;
}

/** Build the instance for a given environment. Exported only via getAuth. */
function buildAuth(env: AuthEnv) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
    socialProviders.linkedin = {
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
    };
  }
  return betterAuth({
    // Same D1 database as the vacancy archive and the feedback board, so a
    // user's posts and their identity are one join away rather than one
    // network hop.
    database: {
      dialect: new D1Dialect({ database: env.JOBS_ARCHIVE as never }),
      type: "sqlite" as const,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    // No email+password: the only ways in are the OAuth providers below, so
    // there is no password hash in the database to protect or to leak.
    emailAndPassword: { enabled: false },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // slide the expiry at most once a day
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Same person, same email, arriving via Google having first used LinkedIn:
    // link the second provider to the existing user rather than creating a
    // duplicate account. Restricted to the two providers we configure, both of
    // which verify the address themselves — this is only safe because of that.
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google", "linkedin"] },
    },
    advanced: {
      // The app is served from one origin, so a strict same-site cookie is
      // free protection.
      defaultCookieAttributes: { sameSite: "lax" as const, secure: true, httpOnly: true },
    },
  });
}

export function getAuth(env: AuthEnv): Auth | null {
  if (!authAvailable(env)) return null;
  if (cached && cachedFor === env.JOBS_ARCHIVE) return cached;
  cached = buildAuth(env);
  cachedFor = env.JOBS_ARCHIVE;
  return cached;
}
