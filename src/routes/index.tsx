import { createFileRoute } from "@tanstack/react-router";
import { EmploysiLockup } from "@/components/EmploysiLogo";
import { Ticker } from "@/components/Ticker";
import { ArrowUpRight } from "lucide-react";

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
          Join the waitlist <ArrowUpRight size={14} />
        </a>
      </div>
    </header>
  );
}

function Footer() {
  const cols = [
    ["Platform", ["Signals", "Compensation", "Movement", "Skills shift"]],
    ["Research", ["Work Index", "Reports", "Methodology", "Changelog"]],
    ["Company", ["About", "Careers", "Press", "Contact"]],
    ["Legal", ["Privacy", "Terms", "Security", "DPA"]],
  ] as const;
  return (
    <footer>
      <div className="mx-auto grid max-w-[1200px] gap-12 px-6 py-16 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-4">
          <EmploysiLockup size={26} />
          <p className="mt-5 max-w-xs text-sm text-ink-3">
            HR intelligence for the next decade of work. Built in Stockholm.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 lg:col-span-8 lg:grid-cols-4">
          {cols.map(([h, items]) => (
            <div key={h}>
              <div className="eyebrow">{h}</div>
              <ul className="mt-4 space-y-2">
                {items.map((i) => (
                  <li key={i}>
                    <a href="#" className="text-sm text-ink-2 hover:text-ink">
                      {i}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4 lg:px-10">
          <span>© 2026 Employsi AB</span>
          <span>Exploring the world of work</span>
        </section>
      </div>
    </footer>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background text-ink">
      <Ticker />
      <Nav />
      <Footer />
    </div>
  );
}
