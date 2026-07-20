import { createFileRoute } from "@tanstack/react-router";
import { EmploysiLockup } from "@/components/EmploysiLogo";
import { Ticker } from "@/components/Ticker";
import { Showcase } from "@/components/Showcase";
import { ArrowUpRight } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ridgwellPhoto from "@/assets/ridgwell_photo.jpeg.asset.json";

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
      {open && mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />,
          document.body
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
        <div className="flex flex-col items-center px-5 pt-7 pb-6 text-center">
          <div className="mb-4 h-20 w-20 overflow-hidden rounded-full border-2 border-hairline bg-surface-2 shadow-sm">
            <img
              src={ridgwellPhoto.url}
              alt="Ben Ridgwell"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="space-y-2 text-center">
            <h2 className="text-lg font-bold tracking-tight text-ink">
              Hi, I'm Ben
            </h2>
            <p className="text-[13px] leading-relaxed text-ink-2">
              I'm a Director at a Big 4 consulting firm. I built Employsi to break down the
              barriers of HR data visibility — creating transparency for both employees and
              employers, akin to the way financial data is shared.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Nav() {
  return (
    <header className="sticky top-[42px] z-30 border-b border-hairline bg-background/80 backdrop-blur">
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
          <span>© 2026 Employsi AB</span>
          <span>Exploring the world of work</span>
        </div>
      </div>
    </footer>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background text-ink">
      <Ticker />
      <Nav />
      <Showcase />
      <Footer />
    </div>
  );
}
