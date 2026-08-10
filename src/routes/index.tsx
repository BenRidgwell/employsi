import { createFileRoute } from "@tanstack/react-router";
import { EmploysiLockup } from "@/components/EmploysiLogo";
import { Ticker } from "@/components/Ticker";
import { Showcase } from "@/components/Showcase";
import { ArrowUpRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
// The IMAGE, not the .asset.json sidecar beside it.
//
// That sidecar is Lovable's asset record, and the `url` it carries
// ("/__l5e/assets-v1/<uuid>/ridgwell_photo.jpeg") is served by Lovable's
// preview host — not by this Worker. On the deployed site it 404s and the About
// card showed a broken circle; the file was never even in the build output,
// because nothing imported the jpeg itself.
//
// Importing the file makes Vite fingerprint it and emit it under /assets/,
// which _headers already marks immutable, so it ships with the page and is
// cached forever. The sidecar is left in place for Lovable's own bookkeeping.
import ridgwellPhoto from "@/assets/ridgwell_photo.jpeg";

/** The one address this page wants to be found at. See the canonical link below. */
const CANONICAL_URL = "https://employsi.com.au/";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Employsi — Exploring the world of work" },
      {
        name: "description",
        content:
          "Employsi is the HR intelligence platform for understanding talent markets, compensation, and the shifting shape of work.",
      },
      { property: "og:title", content: "Employsi — Exploring the world of work" },
      {
        property: "og:description",
        content:
          "HR intelligence for understanding talent markets, compensation, and the shifting shape of work.",
      },
      { property: "og:url", content: CANONICAL_URL },
    ],
    links: [
      // ABSOLUTE, and hardcoded to the apex on purpose.
      //
      // This page is served on employsi.com.au and on the workers.dev URL, and
      // they are byte-identical. A search engine that finds both has to pick
      // one, and left to guess it can split the ranking across them or settle
      // on the workers.dev address — which is the development URL, not the one
      // being advertised. Naming the apex here makes every copy point at the
      // same original, whatever host served it.
      //
      // Deriving this from the request host would defeat the entire point: each
      // copy would declare itself canonical.
      { rel: "canonical", href: CANONICAL_URL },
    ],
  }),
  component: Landing,
});

function AboutPopover() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />,
          document.body,
        )}
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-ink-2 cursor-pointer">
          About <ArrowUpRight size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="z-50 w-72 rounded-3xl border-hairline bg-surface p-0 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.28)]"
      >
        {/* Left-aligned: the avatar sits on the same left edge the heading and
            body start from, so the card reads as one column rather than a
            centred stack. `items-start` is what places the avatar — it is a
            flex child, so text-align alone would not move it. */}
        <div className="flex flex-col items-start px-5 pt-7 pb-6 text-left">
          <div className="mb-4 h-20 w-20 overflow-hidden rounded-full border-2 border-hairline bg-surface-2 shadow-sm">
            <img
              src={ridgwellPhoto}
              alt="Ben Ridgwell"
              width={80}
              height={80}
              // The source is 800x800 for an 80px circle. Stating the box means
              // the browser decodes to the size it will actually paint, and
              // reserves the space before the file arrives so the card does not
              // reflow around it as it loads.
              className="h-full w-full object-cover"
            />
          </div>
          <div className="space-y-2 text-left">
            <h2 className="text-lg font-bold tracking-tight text-ink">Hi, I'm Ben</h2>
            <p className="text-[13px] leading-relaxed text-ink-2">
              I'm a Director at a Big 4 consulting firm specialising in HR analytics and workforce
              planning. I built employsi to break down the barriers of HR data visibility I commonly
              see across many organisations — creating transparency for all employees and employers,
              akin to the way financial data is shared.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 lg:px-10">
        <EmploysiLockup size={26} />
        <AboutPopover />
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer>
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4 lg:px-10">
          <span>© 2026 EMPLOYSI</span>
          <span>EXPLORE THE WORLD OF WORK</span>
        </div>
      </div>
    </footer>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background pb-[92px] text-ink">
      <Ticker />
      <Nav />
      <Showcase />
      <Footer />
    </div>
  );
}
