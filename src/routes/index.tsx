import { createFileRoute } from "@tanstack/react-router";
import { EmploysiLockup, EmploysiMark } from "@/components/EmploysiLogo";
import { Ticker } from "@/components/Ticker";
import { ArrowUpRight, ArrowRight } from "lucide-react";

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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 lg:px-10">
        <EmploysiLockup size={26} />
        <nav className="hidden items-center gap-8 md:flex">
          {["Platform", "Signals", "Research", "Customers", "Pricing"].map((l) => (
            <a key={l} href="#" className="text-sm text-ink-2 transition hover:text-ink">
              {l}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href="#" className="hidden text-sm text-ink-2 transition hover:text-ink sm:inline">
            Sign in
          </a>
          <a
            href="#"
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-ink-2"
          >
            Request access <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-[1200px] px-6 pb-24 pt-20 lg:px-10 lg:pt-28">
        <div className="grid items-end gap-14 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Eyebrow>HR Intelligence · v4.2</Eyebrow>
            <h1 className="mt-6 text-[clamp(48px,7vw,96px)] font-semibold leading-[0.95] tracking-[-0.035em] text-ink">
              Exploring the
              <br />
              world of work.
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
              Employsi turns labor market noise into structured signal — so people
              teams can plan headcount, benchmark pay, and read the shape of work
              with the same rigor as finance reads markets.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a
                href="#"
                className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-ink-2"
              >
                Request access <ArrowRight size={15} />
              </a>
              <a
                href="#"
                className="inline-flex items-center gap-2 rounded-full border border-hairline px-5 py-3 text-sm font-medium text-ink transition hover:bg-surface-2"
              >
                Read the 2026 Work Index
              </a>
            </div>
          </div>

          <div className="lg:col-span-5">
            <HeroPanel />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroPanel() {
  const bars = [
    { label: "Software Eng.", value: 96, delta: "+4.1%" },
    { label: "Data & ML", value: 88, delta: "+11.2%" },
    { label: "Design", value: 62, delta: "−1.8%" },
    { label: "Product", value: 74, delta: "+2.9%" },
    { label: "Operations", value: 48, delta: "+0.4%" },
    { label: "Go-to-market", value: 81, delta: "+6.7%" },
  ];
  return (
    <div className="rounded-[22px] border border-hairline bg-surface-2 p-6">
      <div className="flex items-center justify-between">
        <Eyebrow>Live signal · Q3 demand index</Eyebrow>
        <span className="font-mono text-[11px] text-ink-3">UPDATED 04:12 UTC</span>
      </div>
      <div className="mt-6 space-y-4">
        {bars.map((b) => (
          <div key={b.label} className="grid grid-cols-12 items-center gap-3">
            <span className="col-span-4 text-sm text-ink-2">{b.label}</span>
            <div className="col-span-6 h-2 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full bg-ink"
                style={{ width: `${b.value}%` }}
              />
            </div>
            <span className="col-span-2 text-right font-mono text-[11px] text-ink-3">
              {b.delta}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4">
          12,408 roles · 31 markets
        </span>
        <a href="#" className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline">
          Open dashboard <ArrowUpRight size={12} />
        </a>
      </div>
    </div>
  );
}

function LogoStrip() {
  const names = ["northwind", "atlas labs", "monoco", "kestrel", "fieldwork", "halcyon"];
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-[1200px] px-6 py-10 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4">
          <span className="eyebrow">Trusted by people teams at</span>
          <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
            {names.map((n) => (
              <span
                key={n}
                className="text-base font-semibold tracking-[-0.02em] text-ink-3"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  const items = [
    {
      kpi: "01",
      title: "Talent supply",
      body: "Map candidate availability across 31 markets with weekly granularity. See where roles unlock and where they choke.",
    },
    {
      kpi: "02",
      title: "Compensation",
      body: "Benchmark pay against verified offers — not surveys. Cuts include level, equity band, remote premium and tenure.",
    },
    {
      kpi: "03",
      title: "Movement",
      body: "Track flows between companies, sectors, and geographies. Spot churn risk and emerging hiring corridors early.",
    },
    {
      kpi: "04",
      title: "Skills shift",
      body: "Watch the half-life of skills compress. Inform reskilling roadmaps with longitudinal demand curves.",
    },
  ];
  return (
    <section id="signals" className="border-b border-hairline">
      <div className="mx-auto max-w-[1200px] px-6 py-24 lg:px-10 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Eyebrow>The platform</Eyebrow>
            <h2 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.025em] text-ink lg:text-5xl">
              Four lenses on the labor market.
            </h2>
            <p className="mt-6 max-w-sm text-ink-2">
              Each signal is built from first-party data, validated weekly, and
              wired into the same workspace your team already uses.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:col-span-8">
            {items.map((it) => (
              <div key={it.kpi} className="bg-background p-8">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] text-ink-3">{it.kpi}</span>
                  <EmploysiMark size={18} />
                </div>
                <h3 className="mt-8 text-xl font-semibold tracking-[-0.015em] text-ink">
                  {it.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{it.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function IndexSection() {
  const rows = [
    ["AI Research Engineer", "Bay Area", "$412k", "+18.4%", "Scarce"],
    ["Staff Product Designer", "Remote · EU", "€168k", "+3.1%", "Balanced"],
    ["RevOps Lead", "New York", "$214k", "+6.7%", "Balanced"],
    ["Platform Engineer", "London", "£148k", "+9.2%", "Tight"],
    ["People Partner", "Berlin", "€112k", "−0.8%", "Surplus"],
  ];
  return (
    <section className="border-b border-hairline bg-ink text-primary-foreground">
      <div className="mx-auto max-w-[1200px] px-6 py-24 lg:px-10 lg:py-32">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow" style={{ color: "rgba(255,255,255,0.55)" }}>
              The Work Index
            </span>
            <h2 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.025em] lg:text-5xl">
              A common language for how work is changing.
            </h2>
          </div>
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5"
          >
            Download Q3 report <ArrowUpRight size={14} />
          </a>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-white/10">
          <div className="grid grid-cols-12 border-b border-white/10 bg-white/[0.03] px-6 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">
            <span className="col-span-4">Role</span>
            <span className="col-span-3">Market</span>
            <span className="col-span-2">Median TC</span>
            <span className="col-span-2">YoY</span>
            <span className="col-span-1 text-right">Supply</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-12 items-center border-b border-white/5 px-6 py-4 text-sm last:border-0"
            >
              <span className="col-span-4 font-medium">{r[0]}</span>
              <span className="col-span-3 text-white/70">{r[1]}</span>
              <span className="col-span-2 font-mono text-white/85">{r[2]}</span>
              <span className="col-span-2 font-mono text-white/70">{r[3]}</span>
              <span className="col-span-1 text-right text-white/85">{r[4]}</span>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-3">
          {[
            ["3.2M", "Roles tracked"],
            ["94", "Industries covered"],
            ["Weekly", "Signal refresh"],
          ].map(([k, v]) => (
            <div key={v} className="bg-ink p-8">
              <div className="text-4xl font-semibold tracking-[-0.025em]">{k}</div>
              <div className="mt-2 text-sm text-white/60">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Quote() {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-[1100px] px-6 py-24 lg:px-10 lg:py-32">
        <Eyebrow>Field note</Eyebrow>
        <blockquote className="mt-6 text-3xl font-medium leading-[1.2] tracking-[-0.015em] text-ink lg:text-[40px]">
          “Employsi gave our planning cycle the same rhythm as our financial close.
          We stopped guessing about the talent market and started forecasting it.”
        </blockquote>
        <div className="mt-10 flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-surface-2" />
          <div>
            <div className="text-sm font-medium text-ink">Maren Holloway</div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
              VP People · Northwind
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-[1200px] px-6 py-24 lg:px-10 lg:py-32">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <Eyebrow>Get access</Eyebrow>
            <h2 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.025em] text-ink lg:text-6xl">
              Plan headcount with the
              <br />
              same confidence as revenue.
            </h2>
          </div>
          <div className="lg:col-span-4">
            <form className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="work@company.com"
                className="rounded-full border border-hairline bg-background px-5 py-3 text-sm placeholder:text-ink-3 focus:border-ink focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-ink-2"
              >
                Request access <ArrowRight size={15} />
              </button>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4">
                SOC 2 Type II · GDPR · ISO 27001
              </span>
            </form>
          </div>
        </div>
      </div>
    </section>
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
        </div>
      </div>
    </footer>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background text-ink">
      <Nav />
      <main>
        <Hero />
        <LogoStrip />
        <Pillars />
        <IndexSection />
        <Quote />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
