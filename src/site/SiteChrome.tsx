import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LiveSkillTrend } from "@/employsi/lib/jobHistoryFn";
import { fmtPay } from "@/employsi/lib/salaryParse";
import { AboutPopover } from "./AboutPopover";
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

export function SiteFooter() {
  return (
    <footer className="ws-footer">
      <div className="mark">
        <img src="/site/mark.svg" alt="" width={18} height={18} />
        <span className="ws-eyebrow">© 2026 employsi</span>
      </div>
      {/* The design links a privacy policy at /privacy. No such page exists
          yet, so it is left out rather than shipped as a 404. */}
      <nav aria-label="Footer">
        <Link to="/product" className="ws-eyebrow">
          Product
        </Link>
        <Link to="/login" className="ws-eyebrow">
          Log in
        </Link>
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
              Access now for free
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
