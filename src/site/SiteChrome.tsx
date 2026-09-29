import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LiveSkillTrend } from "@/employsi/lib/jobHistoryFn";
import { fmtPay } from "@/employsi/lib/salaryParse";
import { AboutPopover } from "./AboutPopover";
import { PrivacyPopover } from "./PrivacyPopover";
import { fmtChange, useCountUp, useLandingStats, useSkillMovers } from "./liveMarket";

/** The page wrapper every marketing route renders inside. See site.css. */
export function Site({ children }: { children: ReactNode }) {
  return <div className="ws">{children}</div>;
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="ws-brand" style={light ? { color: "#fff" } : undefined}>
      <img src={light ? "/site/mark-light.svg" : "/site/mark.svg"} alt="" width={24} height={24} />
      <span>employsi</span>
    </Link>
  );
}

export function SiteNav({ current }: { current?: "product" }) {
  return (
    <header className="ws-nav">
      <Brand />
      <nav className="ws-navlinks" aria-label="Site">
        <Link
          to="/product"
          className="ws-navlink"
          aria-current={current === "product" ? "page" : undefined}
        >
          Product
        </Link>
        <AboutPopover />
        <Link to="/login" className="ws-navcta">
          Log in
        </Link>
      </nav>
    </header>
  );
}

const SOCIAL = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/employsi/",
    path: "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45Z",
  },
  {
    label: "X",
    href: "https://x.com/employsi",
    path: "M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z",
  },
];

export function SiteFooter() {
  return (
    <footer className="ws-footer">
      <div className="mark">
        <img src="/site/mark.svg" alt="" width={18} height={18} />
        <span className="ws-eyebrow">© 2026 employsi</span>
        <span className="ws-eyebrow ws-footer-abn">ABN 59 964 624 290</span>
        <span className="ws-footer-social">
          {SOCIAL.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`employsi on ${l.label}`}
              title={l.label}
            >
              <svg width={15} height={15} viewBox="0 0 24 24" aria-hidden>
                <path fill="currentColor" d={l.path} />
              </svg>
            </a>
          ))}
        </span>
      </div>
      <nav aria-label="Footer">
        <PrivacyPopover />
      </nav>
    </footer>
  );
}

/**
 * A fanned stack of app screenshots that cycles front-to-back every four
 * seconds. `fan` is which way the back cards step: "right" fans up and to the
 * right (a stack on the right of the page), "left" mirrors it.
 */
export function ShotStack({
  shots,
  fan,
  period = 4000,
}: {
  shots: { src: string; alt: string }[];
  fan: "right" | "left";
  period?: number;
}) {
  const [front, setFront] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setFront((f) => (f + 1) % shots.length), period);
    return () => clearInterval(id);
  }, [shots.length, period]);

  const dx = fan === "right" ? 1 : -1;
  const N = shots.length;
  return (
    <>
      {shots.map((s, n) => {
        // 0 = front, 1 = middle, 2 = back, 3+ = parked behind the back card.
        const k = (n - front + N) % N;
        const step = Math.min(k, 2);
        const style = {
          transformOrigin: fan === "right" ? "100% 0%" : "0% 0%",
          transform: `translate(${dx * 28 * step}px, ${-28 * step}px) scale(${1 - 0.05 * step})`,
          opacity: k === 0 ? 1 : k === 1 ? 0.72 : k === 2 ? 0.42 : 0,
          zIndex: Math.max(0, 3 - k),
        };
        return (
          <div key={s.src} className="ws-shot" style={style} aria-hidden={k !== 0}>
            <img src={s.src} alt={s.alt} loading="lazy" decoding="async" />
          </div>
        );
      })}
    </>
  );
}

/**
 * Daily live-vacancy counts → points on the design's 64x20 sparkline.
 *
 * Null when there is nothing honest to draw (no series, one point, or a flat
 * line); the row then renders without one. The design's rows drew a seeded
 * random walk, which is exactly the thing a sparkline must never be — the
 * shape IS the information.
 */
function sparkPoints(hist: number[] | undefined): string | null {
  const h = hist?.slice(-14);
  if (!h || h.length < 2) return null;
  const min = Math.min(...h);
  const max = Math.max(...h);
  if (max === min) return null;
  return h
    .map((v, i) => {
      const x = (i / (h.length - 1)) * 62 + 1;
      const y = 18 - ((v - min) / (max - min)) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const tone = (v: number) =>
  v >= 0.15 ? "var(--ws-up)" : v <= -0.15 ? "var(--ws-down)" : "var(--ws-flat)";

function TickerRows({ rows }: { rows: LiveSkillTrend[] }) {
  return (
    <>
      {rows.map((r) => {
        const pts = sparkPoints(r.spark);
        const c = tone(r.v);
        return (
          <div className="row" key={r.name}>
            <span className="name">{r.name}</span>
            {pts && (
              <svg width={64} height={20} viewBox="0 0 64 20" aria-hidden>
                <polyline
                  points={pts}
                  fill="none"
                  stroke={c}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {r.pay !== undefined && (
              <span
                className="pay"
                title="Median annual salary advertised across the live Australian vacancies demanding this skill"
              >
                {fmtPay(r.pay)}
              </span>
            )}
            <span className="chg" style={{ color: c }}>
              {r.v >= 0 ? "↑" : "↓"} {fmtChange(r.v)}
              {/* Names what the percentage measures. Beside a dollar figure it
                  otherwise reads as a change in PAY, which it is not — it is
                  the change in how many live vacancies ask for the skill. */}
              <small>demand</small>
            </span>
          </div>
        );
      })}
    </>
  );
}

/** "Skills in demand" — real movers from the job archive, as a marquee. */
export function SkillsTicker() {
  const { movers, loading } = useSkillMovers();
  const rows = movers?.rows ?? [];
  return (
    <div className="ws-ticker" data-screen-label="Skills ticker">
      <div className="chip">
        <span className="dot" />
        <span>Skills in demand</span>
        {movers && (
          <>
            <span className="sep" />
            <span className="win">{movers.label}</span>
          </>
        )}
      </div>
      <div className="lane">
        {loading ? (
          <div className="track" style={{ animation: "none" }} aria-hidden>
            {[96, 132, 110, 148, 120, 104].map((w, i) => (
              <div className="row" key={i}>
                <span className="skel" style={{ width: w }} />
              </div>
            ))}
          </div>
        ) : rows.length ? (
          <div
            className="track"
            // ~40px/s, the design's marquee speed, whatever the row count.
            style={{ ["--ws-marquee-s" as string]: `${Math.max(30, rows.length * 8)}s` }}
          >
            {/* Twice: the keyframe runs 0 → −50%, so the copy makes the wrap seamless. */}
            <TickerRows rows={rows} />
            <TickerRows rows={rows} />
          </div>
        ) : (
          <div className="note">
            Not enough archive history yet to measure how demand is moving.
          </div>
        )}
      </div>
    </div>
  );
}

const STAT_KEYS = ["vacancies", "employers", "countries", "cities"] as const;
const STAT_LABEL: Record<(typeof STAT_KEYS)[number], string> = {
  vacancies: "Vacancies tracked live",
  employers: "Employers tracked",
  countries: "Countries tracked",
  cities: "Cities tracked",
};

/** The dark closing panel: headline, CTAs, live coverage counters, ticker. */
export function ClosingCta() {
  const { data: stats, isPending } = useLandingStats();
  const { ref, values } = useCountUp(stats, STAT_KEYS);
  return (
    <section className="ws-closing" data-screen-label="Closing CTA">
      <div className="panel">
        <div className="head">
          <h2 className="ws-display lg">Whether you're hiring or hunting, see the market first.</h2>
          <p className="ws-lede">
            Know which skills are in demand, who's hiring and what it pays, before everyone else
            does.
          </p>
          <div className="ctas">
            <Link to="/login" search={{ mode: "create" }} className="ws-btn light">
              Get started
            </Link>
            <Link to="/login" className="ws-btn ghost">
              Log in
            </Link>
          </div>
        </div>
        <div className="ws-stats" ref={ref}>
          {STAT_KEYS.map((k) => (
            <div className="ws-stat" key={k}>
              {/* "—" while loading AND when the archive could not be read:
                  suppressed, never a stand-in number. */}
              <div className="n">{values[k] ?? (isPending ? " " : "—")}</div>
              <div className="l">{STAT_LABEL[k]}</div>
            </div>
          ))}
        </div>
        <SkillsTicker />
      </div>
    </section>
  );
}
