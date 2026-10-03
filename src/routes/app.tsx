import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAppAccess } from "@/employsi/lib/billingFn";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { MobileFramePreview } from "@/components/MobileFramePreview";
import { AppBootError, AppBootLoader } from "@/components/AppBootLoader";

// The Employsi map app is client-only: mapbox-gl touches `window`/`document`
// at module load, so it must never be imported or rendered during SSR.
// lazy() keeps the module out of the server bundle; the mounted gate ensures
// the first client render matches the server (the boot loader) before
// hydration.
//
// ONE RETRY, AFTER A PAUSE. This import is ~1.3MB over the wire and a single
// dropped request is enough to lose it. React's lazy() caches the REJECTED
// promise, so without this a momentary blip is permanent for the life of the
// page — the boundary below would be the only way out of a transient failure.
// The pause matters: an immediate retry tends to meet the same bad second.
// A second failure is left to the boundary rather than retried again, because
// the usual cause of that is a chunk that is genuinely gone (a page held open
// across a release), which no number of retries can fetch.
const EmploysiApp = lazy(() =>
  import("@/employsi/App").catch(
    () =>
      new Promise<typeof import("@/employsi/App")>((res, rej) => {
        setTimeout(() => import("@/employsi/App").then(res, rej), 1200);
      }),
  ),
);

/**
 * The app chunk's failures, caught.
 *
 * A rejected lazy() import throws during render, and with no boundary React
 * unmounts the whole tree — a white page, no console error, forever. That is
 * indistinguishable from a slow load, and both were reported as the app not
 * loading. A class component because error boundaries have no hook form.
 */
class AppBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error ? <AppBootError error={this.state.error} /> : this.props.children;
  }
}

// The mobile Worker (…-mobile.workers.dev) serves the app framed inside a phone
// mockup at true phone dimensions, so stakeholders can preview the mobile
// layout from a desktop. Detected by hostname on the client (the app is
// client-only anyway); "?app=1" forces the raw app so the frame's own iframe
// doesn't recursively re-embed the frame.
function useMobileFrameHost(): boolean {
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("app")) return;
    if (/-mobile\b/.test(window.location.hostname)) setFramed(true);
  }, []);
  return framed;
}

export const Route = createFileRoute("/app")({
  // THE GATE — see getAppAccess in employsi/lib/billingFn.ts. Two checks:
  // signed in (always, wherever sign-in is configured) and subscribed (only
  // where Stripe is). Runs on the server for a first load, so a gated visitor
  // gets a redirect rather than the app shell, and again on client-side
  // navigation.
  //
  // THE APP BEHIND THIS IS WRITTEN FOR A SIGNED-IN USER and has no signed-out
  // state to fall back on — the in-app sign-in prompts were retired once this
  // gate became unconditional (2026-09-30). So this is not merely a redirect
  // for tidiness: it is what makes the components' assumption true.
  beforeLoad: async ({ location }) => {
    const sid = (location.search as Record<string, unknown>).session_id;
    const access = await getAppAccess({
      data: typeof sid === "string" ? { checkoutSessionId: sid } : {},
    });
    if (!access.allowed) {
      throw redirect({
        to: "/login",
        search: access.to === "subscribe" ? { mode: "create" } : {},
      });
    }
  },
  head: () => ({
    meta: [
      // The browser tab reads just "Employsi" inside the app (owner's call,
      // 2026-10-03). Deploy checks match this EXACT title to tell the app from
      // the marketing pages — change deploy-preview.yml and
      // deploy-production.yml with it.
      { title: "Employsi" },
      {
        name: "description",
        content:
          "Zoom from the globe to a single employer: live job-vacancy and skill-demand data on an interactive 3D labour-market map.",
      },
      // The link-preview headline when /app is shared (owner's wording, 2026-10-03).
      { property: "og:title", content: "Employsi - explore the world of work." },
      {
        property: "og:description",
        content:
          "Zoom from the globe to a single employer: live job-vacancy and skill-demand data on an interactive 3D labour-market map.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MapPage,
});

function MapPage() {
  const [mounted, setMounted] = useState(false);
  const framed = useMobileFrameHost();
  useEffect(() => setMounted(true), []);

  // Both of these windows used to render `null`, so the page was blank from the
  // first byte until the app chunk had downloaded AND parsed. The loader covers
  // both, and because this branch also runs on the server it is in the SSR HTML
  // — the first paint rather than something React has to boot to show.
  if (!mounted) return <AppBootLoader />;
  if (framed) return <MobileFramePreview />;

  return (
    <AppBoundary>
      <Suspense fallback={<AppBootLoader />}>
        <EmploysiApp />
      </Suspense>
    </AppBoundary>
  );
}
