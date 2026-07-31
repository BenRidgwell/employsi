import { createAuthClient } from "better-auth/react";

/**
 * Browser side of Better Auth.
 *
 * No baseURL: the auth routes are mounted on this same origin (see
 * src/server.ts), so the client's default — same-origin `/api/auth` — is
 * already right, and hard-coding an origin here is how a preview deployment
 * ends up redirecting people to production.
 */
export const authClient = createAuthClient({ basePath: "/api/auth" });

export const { useSession, signIn, signOut } = authClient;

/** Start an OAuth sign-in, returning to the page the user was already on. */
export function startSignIn(provider: "google" | "linkedin"): void {
  void authClient.signIn.social({
    provider,
    callbackURL: typeof window === "undefined" ? "/" : window.location.pathname,
  });
}
