import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAppAccess } from "@/employsi/lib/billingFn";
import { lazy, Suspense, useEffect, useState } from "react";
import { MobileFramePreview } from "@/components/MobileFramePreview";

// The Employsi map app is client-only: mapbox-gl touches `window`/`document`
// at module load, so it must never be imported or rendered during SSR.
// lazy() keeps the module out of the server bundle; the mounted gate ensures
// the first client render matches the server (empty) before hydration.
const EmploysiApp = lazy(() => import("@/employsi/App"));

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
      { title: "Employsi map — the live labour-market globe" },
      {
        name: "description",
        content:
          "Zoom from the globe to a single employer: live job-vacancy and skill-demand data on an interactive 3D labour-market map.",
      },
      { property: "og:title", content: "Employsi map — the live labour-market globe" },
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

  if (!mounted) return null;
  if (framed) return <MobileFramePreview />;

  return (
    <Suspense fallback={null}>
      <EmploysiApp />
    </Suspense>
  );
}
