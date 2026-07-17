import { createFileRoute } from "@tanstack/react-router";
import { EmploysiLockup } from "@/components/EmploysiLogo";
import { Ticker } from "@/components/Ticker";
import { Showcase } from "@/components/Showcase";
import { ArrowUpRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

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

function AboutModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-ink-2 cursor-pointer">
          About <ArrowUpRight size={14} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm gap-6 rounded-3xl border-hairline bg-surface p-0 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col items-center px-8 pt-10 pb-8 text-center">
          <div className="mb-6 h-28 w-28 overflow-hidden rounded-full border-2 border-hairline bg-surface-2 shadow-sm">
            {/* Replace the src below with your portrait photo once uploaded */}
            <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-ink-3">
              BR
            </div>
          </div>
          <DialogHeader className="space-y-3 text-center">
            <DialogTitle className="text-2xl font-bold tracking-tight text-ink">
              Hi, I'm Ben
            </DialogTitle>
            <DialogDescription className="text-[15px] leading-relaxed text-ink-2">
              I'm a Director at a Big 4 consulting firm. I built Employsi to break down the
              barriers of HR data visibility — creating transparency for both employees and
              employers, akin to the way financial data is shared.
            </DialogDescription>
          </DialogHeader>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Nav() {
  return (
    <header className="sticky top-[42px] z-30 border-b border-hairline bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 lg:px-10">
        <EmploysiLockup size={26} />
        <AboutModal />
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
