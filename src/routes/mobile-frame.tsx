import { createFileRoute } from "@tanstack/react-router";
import { MobileFramePreview } from "../components/MobileFramePreview";

// Standalone utility page (not part of the Employsi app itself): frames the
// live app inside a fixed-pixel phone viewport so a desktop browser renders it
// at true phone dimensions.
//
// Reachable on ANY host, which is the point of keeping it: /app only shows the
// frame when the hostname matches "-mobile", so this is how you get a phone
// preview off a version-upload URL or the preview Worker without deploying to
// the mobile Worker at all. ("/" is the waitlist everywhere and never shows
// this — an earlier note here claimed the mobile Worker served it at the root.)
export const Route = createFileRoute("/mobile-frame")({
  head: () => ({
    meta: [{ title: "Mobile preview — Employsi" }],
  }),
  component: MobileFramePreview,
});
