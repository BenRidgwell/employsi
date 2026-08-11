import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { OG_IMAGE_URL, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT } from "../lib/site";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // The FALLBACK head. Both real routes set their own (index.tsx and
      // mobile-frame.tsx), so what this actually covers is the not-found and
      // error-boundary render, plus any route added later that forgets to.
      // Worded to match index.tsx so the product never introduces a second name
      // for itself on an error page.
      { title: "employsi - explore the world of work" },
      {
        name: "description",
        content:
          "Employsi is the HR intelligence platform for understanding talent markets, compensation, and the shifting shape of work.",
      },
      { name: "author", content: "Employsi" },
      { property: "og:title", content: "employsi - explore the world of work" },
      {
        property: "og:description",
        content:
          "HR intelligence for understanding talent markets, compensation, and the shifting shape of work.",
      },
      { property: "og:type", content: "website" },
      // twitter:card without twitter:site is valid — the card renders from the
      // og: tags. The scaffold's "@Lovable" was the generator's handle, not
      // ours, and there is no Employsi account to put in its place, so the tag
      // is dropped rather than filled with a guess that would attribute the
      // product to whoever happens to own that handle.
      //
      // summary_large_image, not summary: `summary` is the small square-thumb
      // card, and it CROPS a 1.91:1 image to a square — the headline on
      // og-image.png would lose both ends. The large card is the one shaped for
      // the image that exists.
      { name: "twitter:card", content: "summary_large_image" },

      // The social card, set on the ROOT so every route inherits one. A route
      // that overrides og:title without remembering og:image would otherwise
      // ship a titled link with no picture.
      { property: "og:site_name", content: "Employsi" },
      // en_AU, underscore: og:locale takes the POSIX form, while the html lang
      // attribute below takes the hyphenated BCP-47 form. Same locale, two
      // spellings, and neither validator accepts the other's.
      { property: "og:locale", content: "en_AU" },
      { property: "og:image", content: OG_IMAGE_URL },
      // Dimensions let a scraper reserve the right box on first render instead
      // of fetching the file to measure it — Facebook in particular shows a
      // blank card on the very first share without them.
      { property: "og:image:width", content: OG_IMAGE_WIDTH },
      { property: "og:image:height", content: OG_IMAGE_HEIGHT },
      { property: "og:image:type", content: "image/png" },
      {
        property: "og:image:alt",
        content: "Employsi — explore the world of work",
      },

      // `index, follow` is what a crawler assumes anyway; it is here for
      // max-image-preview:large, which is what actually permits Google to show
      // the full-width thumbnail rather than a 100px one. Without the
      // directive the og:image above is allowed to be shown only as a
      // thumbnail in search and Discover.
      { name: "robots", content: "index, follow, max-image-preview:large" },

      // The ink the brand is drawn in. Tints the browser UI on Android Chrome
      // and the title bar on installed PWAs; matches --ink / #1c1c1e.
      { name: "theme-color", content: "#1c1c1e" },
    ],
    links: [
      // Transparent SVG mark, tracking the browser's light/dark chrome. Listed
      // before the stylesheet so the tab icon resolves early.
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/@fontsource-variable/mona-sans/index.css",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // en-AU, not en. The product is an Australian labour-market map on a
    // .com.au, its copy is spelled in Australian English ("labour"), and this
    // attribute is the only place the document states which English it is in.
    // Hyphenated BCP-47 here; og:locale above wants the underscore form.
    <html lang="en-AU">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
