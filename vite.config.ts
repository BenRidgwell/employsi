// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * FAIL THE BUILD WHEN THE MAP HAS NO TOKEN.
 *
 * `mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN` is inlined at
 * BUILD time (WorldMapbox.tsx, PerthMapbox.tsx). Build without the variable set
 * and Vite substitutes `void 0`: the bundle is valid, the build is green, every
 * asset serves 200 — and the map throws on mount, so the whole route renders
 * the "This page didn't load" boundary.
 *
 * That is exactly what happened on 2026-08-08. A build made in an environment
 * with no .env was deployed over a working one, and nothing anywhere reported a
 * problem until someone opened the page. There is no runtime fallback to add:
 * the value is compiled in, so the only place to catch it is here.
 *
 * Dev is deliberately left alone — you can work on everything except the map
 * without a token, and blocking that would be its own kind of wrong.
 */
function requireMapboxToken(): void {
  if (process.env.NODE_ENV === "development") return;
  const token = (process.env.VITE_MAPBOX_TOKEN ?? "").trim();
  if (token) return;
  throw new Error(
    "VITE_MAPBOX_TOKEN is not set, so this build would ship a map with no access " +
      "token: it would look fine until the page is opened, then fail to render. " +
      "Copy .env.example to .env and fill in the token (see " +
      "https://account.mapbox.com/access-tokens/), or set it in the build " +
      "environment. Refusing to build.",
  );
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      {
        name: "employsi-require-mapbox-token",
        apply: "build",
        config: requireMapboxToken,
      },
    ],
  },
});
