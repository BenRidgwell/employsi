import { createFileRoute } from "@tanstack/react-router";
import { EmploysiLockup } from "@/components/EmploysiLogo";
import { Ticker } from "@/components/Ticker";
import { Showcase } from "@/components/Showcase";
import { ArrowUpRight, X } from "lucide-react";
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

function Nav() {
  return (
    <header className="sticky top-[42px] z-30 border-b border-hairline bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 lg:px-10">
        <EmploysiLockup size={26} />
        <a
          href="#"
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-ink-2"
        >
          About <ArrowUpRight size={14} />
        </a>
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
