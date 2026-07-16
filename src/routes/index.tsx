import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Employsi — Perth Labour Map" },
      {
        name: "description",
        content:
          "Employsi is the HR intelligence platform for understanding talent markets, compensation, and the shifting shape of work.",
      },
      { property: "og:title", content: "Employsi — Perth Labour Map" },
      {
        property: "og:description",
        content:
          "HR intelligence for understanding talent markets, compensation, and the shifting shape of work.",
      },
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
