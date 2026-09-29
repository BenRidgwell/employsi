import { useEffect, useRef, useState } from "react";
import type { LiveSkillTrend } from "@/employsi/lib/jobHistoryFn";
import { topMovers, useSkillMovers } from "./liveMarket";

/**
 * The two skills callouts drawn over the landing page's hero footage: one
 * rising series and one falling series draw in toward a marker each, a card
 * lands on each marker, both hold, both clear. A 7-second loop.
 *
 * A PORT OF THE "Callouts Overlay" DESIGN (skills-overlay.jsx, 2026-09-29):
 * its geometry, curves, timing, type and position, exactly — WITH ITS FIGURES
 * REPLACED. The design hard-codes "Project management +6%, A$148,000" and
 * "Autonomous haulage −2%, A$132,000". Here the two skills are the archive's
 * actual biggest riser and faller over the window the ticker shows, and the
 * salary is its advertised median where enough ads state one (the row is
 * dropped where not). With no movers at all nothing is drawn — the footage
 * and headline stand on their own. See liveMarket.ts.
 *
 * THE LINES ARE THE DESIGN'S, NOT A SERIES. They are illustrative curves — one
 * rising, one falling — and each only ever sits beside a card whose direction
 * matches it. An earlier version drew each skill's own daily vacancy count
 * here; it was replaced at the owner's request with the design's exact look,
 * so read the figure off the card, never the shape off the line.
 *
 * Geometry is authored in the design's 1920x1080 space and the whole stage is
 * scaled to the banner's width, so every number below is the design's own.
 */

const W = 1920;
const H = 1080;
const UP = "#57c78c"; // green-500 lifted for dark footage
const DOWN = "#e2695e"; // red-500 lifted for dark footage
const UP_CARD = "#2f8f63";
const DOWN_CARD = "#c4463b";
const X0 = 300;
const X1 = 1500;
const BASE = 800;
const RANGE = 440;
const N = 64;
// The callouts' anchor: the Callouts Overlay design's defaults (x, y1, y2).
const AX = 1300;
const AY_UP = 440;
const AY_DOWN = 640;
const MONO = "'JetBrains Mono', monospace";
// Scene cues (seconds): Draw 1.6, Rising 0.9, Falling 3.5, Out 1.
const CUE_RISING = 1.6;
const CUE_FALLING = 2.5;
const CUE_OUT = 6.0;
const LOOP = 7.0;

const easeOutCubic = (t: number) => --t * t * t + 1;
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const anim =
  (ease: (t: number) => number) =>
  (from: number, to: number, start: number, end: number) =>
  (t: number) =>
    t <= start ? from : t >= end ? to : from + (to - from) * ease((t - start) / (end - start));
const enter = anim(easeOutCubic);
const draw = anim(easeInOutSine);
const pop = anim(easeOutBack);

type Pt = { x: number; y: number };

const series = (fn: (t: number) => number): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    out.push({ x: X0 + t * (X1 - X0), y: BASE - fn(t) * RANGE });
  }
  return out;
};

const RISE = series(
  (t) =>
    0.42 + 0.44 * Math.pow(t, 0.92) + 0.03 * Math.sin(t * 17.3) + 0.018 * Math.sin(t * 33.1 + 1.2),
);

const FALL = series(
  (t) =>
    0.6 -
    0.3 * Math.pow(t, 1.06) +
    0.026 * Math.sin(t * 14.1 + 0.6) +
    0.014 * Math.sin(t * 29.4 + 2.1),
);

/** The design's `spark`: shrink a curve and move its last point onto (ex, ey). */
function spark(pts: Pt[], ex: number, ey: number): Pt[] {
  const last = pts[pts.length - 1];
  return pts.map((q) => ({ x: ex + (q.x - last.x) * 0.72, y: ey + (q.y - last.y) * 0.8 }));
}

const RISE_AT = spark(RISE, AX, AY_UP);
const FALL_AT = spark(FALL, AX, AY_DOWN);

function tip(pts: Pt[], p: number) {
  const f = Math.max(0, Math.min(1, p)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, i };
}

function pathTo(pts: Pt[], p: number) {
  const t = tip(pts, p);
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let j = 1; j <= t.i; j++) d += ` L ${pts[j].x.toFixed(1)} ${pts[j].y.toFixed(1)}`;
  return d + ` L ${t.x.toFixed(1)} ${t.y.toFixed(1)}`;
}

/** "+6%" as the design sets it; one decimal only when a whole number would read 0. */
const pct = (v: number) => {
  const a = Math.abs(v);
  return `${v >= 0 ? "+" : "−"}${a >= 0.5 ? Math.round(a) : a.toFixed(1)}%`;
};

const aud = (n: number) => `A$${(Math.round(n / 1000) * 1000).toLocaleString("en-AU")}`;

function Callout({
  y,
  skill,
  dir,
  color,
  card,
  at,
  T,
  fade,
  below,
}: {
  y: number;
  skill: LiveSkillTrend;
  dir: 1 | -1;
  color: string;
  card: string;
  at: number;
  T: number;
  fade: number;
  below?: boolean;
}) {
  const x = AX;
  const o = enter(0, 1, at, at + 0.45)(T) * fade;
  const s = pop(0.92, 1, at, at + 0.62)(T);
  const dy = enter(below ? 16 : -16, 0, at, at + 0.5)(T);
  const leader = enter(0, 1, at - 0.1, at + 0.42)(T) * fade;
  const ph = Math.max(0, (T - at) % 1.7) / 1.7;
  const ringR = 16 + 36 * ph;
  const ringO = 0.5 * (1 - ph) * leader;
  const breathe = 1 + 0.1 * Math.sin((T - at) * 3.7);
  const stemTop = below ? y + 62 : y - 62;
  const anchor = below ? y + 14 : y - 14;
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ position: "absolute", inset: 0 }}
      >
        <line
          x1={x}
          y1={anchor}
          x2={x}
          y2={anchor + (stemTop - anchor) * leader}
          stroke={card}
          strokeWidth={4}
          strokeLinecap="round"
          opacity={leader}
        />
        <circle
          cx={x}
          cy={y}
          r={ringR}
          fill="none"
          stroke={color}
          strokeOpacity={ringO}
          strokeWidth={2}
        />
        <circle cx={x} cy={y} r={30 * leader * breathe} fill={color} fillOpacity={0.12 * leader} />
        <circle cx={x} cy={y} r={14 * leader} fill="#ffffff" />
        <circle cx={x} cy={y} r={7 * leader} fill={card} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: x - 208,
          top: stemTop + dy,
          opacity: o,
          transform: `translateY(${below ? 0 : -100}%) scale(${s})`,
          transformOrigin: below ? "78% 0%" : "78% 100%",
          background: card,
          borderRadius: 16,
          padding: "16px 22px 18px",
          width: 268,
          boxShadow: "0 18px 40px rgba(0,0,0,.38)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          color: "#fff",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 15,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,.78)",
            lineHeight: 1.3,
          }}
        >
          {skill.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width={18} height={16} viewBox="0 0 18 16" aria-hidden>
            <path d={dir > 0 ? "M9 1 L17 15 L1 15 Z" : "M9 15 L1 1 L17 1 Z"} fill="#ffffff" />
          </svg>
          <span
            style={{
              fontSize: 46,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1,
            }}
          >
            {pct(skill.v)}
          </span>
        </div>
        {skill.pay !== undefined && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              borderTop: "1px solid rgba(255,255,255,.22)",
              paddingTop: 10,
              marginTop: 2,
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 13,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.78)",
              }}
            >
              Median salary
            </span>
            <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500 }}>
              {aud(skill.pay)}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function useLoopTime(active: boolean): number {
  const [T, setT] = useState(5);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setT(5); // both cards landed, lines fully drawn, nothing moving
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      setT(((now - t0) / 1000) % LOOP);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return T;
}

export function HeroCallouts() {
  const { movers } = useSkillMovers();
  const { up, down } = movers ? topMovers(movers.rows) : { up: null, down: null };
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // Stop the 60fps loop once the banner has scrolled away.
    const io = new IntersectionObserver((es) => setOnScreen(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const has = !!(up || down);
  const T = useLoopTime(has && onScreen && scale > 0);
  const out = draw(1, 0, CUE_OUT, CUE_OUT + 0.6)(T);
  const pR = draw(0, 1, 0.05, CUE_RISING + 0.1)(T);
  const pF = draw(0, 1, 0.35, CUE_FALLING)(T);
  const rise = up ? RISE_AT : null;
  const fall = down ? FALL_AT : null;
  const x0 = RISE_AT[0].x;

  return (
    <div className="ws-callouts" ref={box} aria-hidden>
      {has && scale > 0 && movers && (
        <div className="stage" style={{ transform: `scale(${scale})` }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            style={{ position: "absolute", inset: 0, opacity: out }}
          >
            <defs>
              <linearGradient id="wsSpFade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                <stop offset="22%" stopColor="#fff" stopOpacity="1" />
                <stop offset="100%" stopColor="#fff" stopOpacity="1" />
              </linearGradient>
              <mask id="wsSpMask">
                <rect x={x0} y="0" width={AX - x0 + 20} height={H} fill="url(#wsSpFade)" />
              </mask>
              <filter id="wsSpGlow" x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="8" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g
              mask="url(#wsSpMask)"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              filter="url(#wsSpGlow)"
            >
              {fall && pF > 0.002 && <path d={pathTo(fall, pF)} stroke={DOWN} strokeWidth={4} />}
              {rise && pR > 0.002 && <path d={pathTo(rise, pR)} stroke={UP} strokeWidth={5} />}
              {fall && pF > 0.002 && pF < 0.999 && (
                <circle cx={tip(fall, pF).x} cy={tip(fall, pF).y} r={6} fill={DOWN} />
              )}
              {rise && pR > 0.002 && pR < 0.999 && (
                <circle cx={tip(rise, pR).x} cy={tip(rise, pR).y} r={7} fill={UP} />
              )}
            </g>
          </svg>
          {up && (
            <Callout
              y={AY_UP}
              skill={up}
              dir={1}
              color={UP}
              card={UP_CARD}
              at={CUE_RISING + 0.1}
              T={T}
              fade={out}
            />
          )}
          {down && (
            <Callout
              y={AY_DOWN}
              skill={down}
              dir={-1}
              color={DOWN}
              card={DOWN_CARD}
              at={CUE_FALLING}
              T={T}
              fade={out}
              below
            />
          )}
        </div>
      )}
    </div>
  );
}
