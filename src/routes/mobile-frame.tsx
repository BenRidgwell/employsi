import { createFileRoute } from "@tanstack/react-router";
import { MobileFramePreview } from "../components/MobileFramePreview";

// Standalone utility page (not part of the Employsi app itself): frames the
// live app inside a fixed-pixel phone viewport so a desktop browser renders it
// at true phone dimensions. On the mobile Worker this same view is also served
// at the root (see src/routes/index.tsx).
export const Route = createFileRoute("/mobile-frame")({
  head: () => ({
    meta: [{ title: "Mobile preview — Employsi" }],
  }),
  component: MobileFramePreview,
});
