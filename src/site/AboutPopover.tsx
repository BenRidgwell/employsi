import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
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

/**
 * "About" in the site nav. The design links it to "#" — there is no About page
 * yet — so it opens the founder card the waitlist page carried, rather than a
 * link to nowhere.
 */
export function AboutPopover() {
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
        <button type="button" className="ws-navlink">
          About
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
          {/* A new tab, so the visitor keeps their place on the site. */}
          <a
            href="https://www.linkedin.com/company/employsi/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-primary-foreground no-underline transition hover:bg-ink-2"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45Z"
              />
            </svg>
            Contact me
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
