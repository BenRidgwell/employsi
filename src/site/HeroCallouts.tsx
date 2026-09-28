import { useEffect, useRef, useState } from "react";
import type { LiveSkillTrend } from "@/employsi/lib/jobHistoryFn";
import { fmtChange, topMovers, useSkillMovers } from "./liveMarket";

/**
 * The two skills callouts drawn over the landing page's hero footage: one
 * rising series and one falling series draw in toward a marker each, a card
 * lands on each marker, both hold, both clear. A 7-second loop.
 *
 * PORTED FROM THE DESIGN'S skills-overlay.jsx, WITH ITS DATA REPLACED. The
 * design hard-codes "Project management +6%, A$148,000" and "Autonomous
 * haulage −2%, A$132,000", and draws both lines from sine-wave formulas. Here
 * the two skills are the archive's actual biggest riser and faller over the
 * window the ticker shows, each line is that skill's own daily count of live
 * vacancies, and the salary is its advertised median where enough ads state
 * one. A skill whose series is too short to draw gets its card without a line;
 * with no movers at all, nothing is drawn — the footage and headline stand on
 * their own. See liveMarket.ts.
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
// The callouts' anchor, as the landing design places them.
const AX = 1680;
const AY_UP = 480;
const AY_DOWN = 680;
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

/**
 * A real daily series → N points across the design's chart box, then moved so
 * its last point lands on the callout's anchor (the design's `spark`). Each
 * series is scaled to its own range: the lines show direction and shape, and
 * the card beside each states the actual figure.
 */
function seriesPoints(hist: number[] | undefined, ax: number, ay: number): Pt[] | null {
  if (!hist || hist.length < 3) return null;
  const min = Math.min(...hist);
  const max = Math.max(...hist);
  if (max === min) return null;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const f = (i / (N - 1)) * (hist.length - 1);
    const j = Math.min(hist.length - 2, Math.floor(f));
    const v = hist[j] + (hist[j + 1] - hist[j]) * (f - j);
    const n = 0.3 + 0.56 * ((v - min) / (max - min));
    pts.push({ x: X0 + (i / (N - 1)) * (X1 - X0), y: BASE - n * RANGE });
  }
  const last = pts[N - 1];
  return pts.map((q) => ({ x: ax + (q.x - last.x) * 0.72, y: ay + (q.y - last.y) * 0.8 }));
}

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

const aud = (n: number) => `A$${(Math.round(n / 1000) * 1000).toLocaleString("en-AU")}`;

function Callout({
  y,
  skill,
  windowShort,
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
  windowShort: string;
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
            fontFamily: "var(--ws-label)",
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
            {fmtChange(skill.v)}
          </span>
          {/* What the percentage is — demand, over this window — so it can
              never be read as a pay rise. */}
          <span
            style={{
              alignSelf: "flex-end",
              fontFamily: "var(--ws-label)",
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.78)",
              paddingBottom: 4,
            }}
          >
            demand · {windowShort}
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
                fontFamily: "var(--ws-label)",
                fontSize: 13,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.78)",
              }}
            >
              Median salary
            </span>
            <span style={{ fontFamily: "var(--ws-label)", fontSize: 20, fontWeight: 500 }}>
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
  const rise = up ? seriesPoints(up.spark, AX, AY_UP) : null;
  const fall = down ? seriesPoints(down.spark, AX, AY_DOWN) : null;
  const x0 = (rise ?? fall)?.[0].x ?? X0;

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
              windowShort={movers.short}
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
              windowShort={movers.short}
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
