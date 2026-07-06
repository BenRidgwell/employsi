import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

// The Employsi map app is client-only: mapbox-gl touches `window`/`document`
// at module load, so it must never be imported or rendered during SSR.
// lazy() keeps the module out of the server bundle; the mounted gate ensures
// the first client render matches the server (empty) before hydration.
const EmploysiApp = lazy(() => import("@/employsi/App"));

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
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <EmploysiApp />
    </Suspense>
  );
}
