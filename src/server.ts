import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { MARKETING_APEX, MARKETING_WWW, isAppOnlyPath } from "./lib/siteGate";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// THE PUBLIC MARKETING DOMAIN, and which of this Worker's paths it keeps
// closed, live in lib/siteGate.ts — the login page reads the same module to
// decide between sign-in buttons and the waitlist, so the two cannot drift.
// RELEASING THE APP is emptying APP_ONLY_PATHS there, and nothing else.

/**
 * robots.txt, which has to differ by hostname — so it is served here rather
 * than dropped in public/, where one file would answer for every host.
 *
 * The marketing site is deployed on employsi.com.au AND on the workers.dev URL,
 * and they are the same pages. Left alone, a search engine finds both, has to guess
 * which is canonical, and splits the ranking between them. The canonical tag on
 * the landing route names the apex as the real one; this stops the workers.dev
 * copy being crawled at all, which is the belt to that braces.
 *
 * It is deliberately NOT a blanket disallow on non-apex hosts only in spirit:
 * the workers.dev URL is where the app is developed and demoed, and keeping it
 * out of the index is wanted there too.
 *
 * `/_serverFn/` is disallowed on the apex because those are RPC endpoints for
 * the page's own fetches — they answer JSON to a correctly-formed call and 500
 * to a bare GET, so a crawler spending budget on them gets nothing either way.
 */
function robotsTxt(host: string): string {
  if (host !== MARKETING_APEX) {
    return "# Not the canonical host — see https://employsi.com.au\nUser-agent: *\nDisallow: /\n";
  }
  return ["User-agent: *", "Allow: /", "Disallow: /_serverFn/", ""].join("\n");
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Authentication is handled BEFORE the app entry, not inside it.
      //
      // Better Auth needs the raw Request and returns a raw Response (OAuth
      // redirects, Set-Cookie on the session, the callback exchange), none of
      // which fits a server function's JSON-in/JSON-out shape. Mounting it here
      // also means the auth routes never enter the router, so a signed-out
      // visitor hitting a callback URL cannot end up rendering the app shell
      // mid-redirect.
      const url = new URL(request.url);
      const host = url.hostname.toLowerCase();

      // HTTPS only on the public domain.
      //
      // A Worker Custom Domain answers on both schemes, and this one was
      // measured serving the full waitlist over plain http — 200, 14,596
      // bytes, no redirect. The form itself posts to an https endpoint either
      // way, so nothing was travelling in the clear, but a public page asking
      // for an email address over http is the kind of thing browsers have
      // started marking and people are right to distrust.
      //
      // The better home for this is the zone's "Always Use HTTPS" setting,
      // which acts at the edge before a request ever reaches a Worker. This is
      // here because the deploy credentials are account-scoped and cannot
      // touch zone settings; it is correct on its own and harmless if that
      // setting is switched on later, since the edge would then redirect first
      // and this would simply stop being reached.
      if (url.protocol === "http:" && (host === MARKETING_APEX || host === MARKETING_WWW)) {
        url.protocol = "https:";
        return Response.redirect(url.toString(), 301);
      }

      // One canonical hostname. 301 because it is permanent — www is an alias
      // for the apex and always will be — and because a cached redirect is the
      // point: a visitor who typed www should stop paying for the hop.
      if (host === MARKETING_WWW) {
        url.hostname = MARKETING_APEX;
        return Response.redirect(url.toString(), 301);
      }

      // 302, NOT 301. This gate comes off when the app is released, and a 301
      // is cached by browsers indefinitely — every visitor who hit /app while
      // it was closed would keep being bounced to the waitlist long after it
      // opened, with nothing on the server able to undo it. A temporary
      // condition gets a temporary redirect.
      if (host === MARKETING_APEX && isAppOnlyPath(url.pathname)) {
        return Response.redirect(new URL("/", url).toString(), 302);
      }

      // After the host redirects, so a crawler asking www for robots.txt is
      // sent to the apex's copy rather than being answered twice.
      if (url.pathname === "/robots.txt") {
        return new Response(robotsTxt(host), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            // Short: this is the file to be able to change quickly if the
            // wrong thing turns out to be indexed.
            "cache-control": "public, max-age=300",
          },
        });
      }

      if (url.pathname.startsWith("/api/auth/")) {
        let auth;
        try {
          const { getAuth } = await import("./employsi/lib/auth");
          // Bindings and secrets come from `cloudflare:workers`, NOT from this
          // handler's `env` argument. Under nitro's cloudflare preset that
          // argument arrives EMPTY — measured: Object.keys(env) is [] here
          // while cloudflare:workers exposes JOBS_ARCHIVE, BETTER_AUTH_SECRET
          // and the four OAuth secrets. Reading the argument made
          // authAvailable() false on a fully configured deployment, so every
          // sign-in returned "Sign-in is not configured" with all six secrets
          // set. feedbackFn and followsFn already resolve env this way; this
          // was the one place that did not.
          const m = await import("cloudflare:workers");
          const cfEnv = (m?.env ?? {}) as Record<string, unknown>;
          auth = getAuth((Object.keys(cfEnv).length ? cfEnv : (env ?? {})) as never);
        } catch (e) {
          console.error("auth init:", e);
          return new Response(
            JSON.stringify({ error: `auth init: ${String((e as Error)?.message || e)}` }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        if (!auth) {
          // Not configured. A clear 503 beats a stack trace: the sign-in panel
          // already hides the buttons in this state, so reaching here means a
          // stale tab or a direct hit.
          return new Response(
            JSON.stringify({ error: "Sign-in is not configured on this deployment." }),
            { status: 503, headers: { "content-type": "application/json" } },
          );
        }
        try {
          return await auth.handler(request);
        } catch (e) {
          // An API route must fail as JSON, not as the app's HTML error page:
          // the caller here is fetch(), and an HTML body turns a diagnosable
          // fault into "unexpected token <". The message is safe to return —
          // it names the failure, never a secret.
          console.error("auth handler:", e);
          return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      // Product events, posted by the browser with `keepalive` (and by
      // sendBeacon on unload). Mounted here for the same reason auth is: the
      // unload flush is the only way a session's LENGTH is ever recorded, and
      // it needs a plain endpoint taking a raw Request — a server function's
      // JSON-in/JSON-out client cannot set `keepalive` and cannot be reached by
      // sendBeacon at all. See employsi/lib/events.ts.
      if (url.pathname === "/api/events" && request.method === "POST") {
        const { handleEventsRequest } = await import("./employsi/lib/events");
        return await handleEventsRequest(request, env);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
