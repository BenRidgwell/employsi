import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import siteCss from "@/site/site.css?url";
import { ClosingCta, ShotStack, Site, SiteFooter, SiteNav } from "@/site/SiteChrome";

const TITLE = "Product — employsi";
const DESCRIPTION =
  "Search a skill and follow its demand from countries to cities to the employers advertising it right now — or see where the people who have it already are.";

export const Route = createFileRoute("/product")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "https://employsi.com.au/product" },
    ],
    links: [
      { rel: "stylesheet", href: siteCss },
      { rel: "canonical", href: "https://employsi.com.au/product" },
    ],
  }),
  component: ProductPage,
});

type Side = "demand" | "supply";
type Shot = { src: string; alt: string };
type Step = { tag: string; title: string; body: string; shots: Shot[] };

const GLOBE_STACK: Shot[] = [
  { src: "/site/shot-globe-demand.jpg", alt: "employsi app — skill demand on the live globe" },
  {
    src: "/site/shot-mining-engineering.jpg",
    alt: "employsi app — mining engineering demand across Australian cities",
  },
  {
    src: "/site/shot-perth-project-managers.jpg",
    alt: "employsi app — Perth local view of employers hiring project managers",
  },
  {
    src: "/site/shot-nab-profile.jpg",
    alt: "employsi app — National Australia Bank employer profile, Melbourne local view",
  },
];

const JOURNEYS: Record<Side, { headline: string; steps: Step[] }> = {
  demand: {
    headline: "Know what skills are in demand. From the whole world, down to a single street.",
    steps: [
      {
        tag: "Global to local",
        title: "From the whole world, down to a single street.",
        body: "Search a skill and follow its demand from countries, to cities, to the employers advertising it right now, with live ad counts and week-on-week change at every level.",
        shots: GLOBE_STACK,
      },
      {
        tag: "What’s trending",
        title: "See what’s rising and falling, right now.",
        body: "Track the advertised value of a market, the skills with the most live ads, and the biggest risers and fallers over 7, 14 or 30 days, for a city, a country or worldwide.",
        shots: [
          {
            src: "/site/shot-whats-trending.jpg",
            alt: "employsi app — What’s Trending: advertised value, top skills, biggest risers and fallers in Australia",
          },
        ],
      },
      {
        tag: "Ask an analyst",
        title: "Ask the market a question.",
        body: "Ask about vacancies, pay or hiring speed in plain language. Every answer is a query over employsi’s HR intelligence dataset, with the source shown.",
        shots: [
          {
            src: "/site/shot-ask-analyst.jpg",
            alt: "employsi app — Ask an analyst: which skills are most in demand in New Zealand healthcare",
          },
        ],
      },
    ],
  },
  supply: {
    headline: "See where skills are hired from, and where they go.",
    steps: [
      {
        tag: "Employer profiles",
        title: "Know who you’re up against.",
        body: "Open any employer for open roles, top skills, headcount and 60-day vacancy trends.",
        shots: [
          {
            src: "/site/shot-afl-profile.jpg",
            alt: "employsi app — AFL employer profile, Melbourne",
          },
        ],
      },
      {
        tag: "Talent flows",
        title: "Follow where talent moves.",
        body: "See which companies an employer hires from and loses people to, and how those flows change over time.",
        shots: [
          {
            src: "/site/shot-rio-tinto-flows.jpg",
            alt: "employsi app — where Rio Tinto hires from, Perth local view",
          },
        ],
      },
      {
        tag: "Career pathways",
        title: "Map the next step in your career.",
        body: "Trace the roles a skill leads to, with the pay and live demand at each stage.",
        shots: [
          {
            src: "/site/shot-hr-pathways.jpg",
            alt: "employsi app — career pathways for HR roles across Australia",
          },
        ],
      },
    ],
  },
};

// Arrow glyphs from the design's Supply / Demand toggle.
const SupplyIcon = () => (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M15 9l-6 6" />
    <path d="M15 15H9V9" />
  </svg>
);
const DemandIcon = () => (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9 15l6-6" />
    <path d="M9 9h6v6" />
  </svg>
);

type Dot = { x: number; y: number; t: number; f: number };

/**
 * The dotted "path" drawn behind the journey: a band of dots along a spline
 * that lights up as the reader scrolls down it, over faint contour lines. A
 * direct port of the design's buildPath/drawPath; the only change is that the
 * text column's right edge is measured rather than assumed to be 516px, so it
 * still clears the copy when the column narrows.
 */
function useJourneyPath(
  section: React.RefObject<HTMLDivElement | null>,
  canvas: React.RefObject<HTMLCanvasElement | null>,
  textCol: React.RefObject<HTMLDivElement | null>,
) {
  const dots = useRef<Dot[]>([]);
  const geom = useRef({ W: 0, H: 0, dpr: 1 });
  const prog = useRef(0);

  const paint = useCallback(
    (p: number) => {
      prog.current = p;
      const cv = canvas.current;
      if (!cv || !dots.current.length) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const { W, H, dpr } = geom.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(28,28,30,.06)";
      ctx.lineWidth = 1;
      for (let g = 1; g <= 5; g++) {
        ctx.beginPath();
        ctx.ellipse(W * 0.5, H * 0.5, W * 0.18 * g, H * 0.9, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let g = 1; g <= 7; g++) {
        ctx.beginPath();
        const y = (H * g) / 8;
        ctx.moveTo(0, y + 40);
        ctx.quadraticCurveTo(W / 2, y - 60, W, y + 40);
        ctx.stroke();
      }
      for (const d of dots.current) {
        const on = d.t <= p;
        const near = Math.max(0, 1 - Math.abs(d.t - p) / 0.025);
        const a = on ? 0.1 + 0.42 * d.f + 0.3 * near : 0.035 + 0.05 * d.f;
        const s = (on ? 2 + 2.4 * d.f : 1.6 + 1.2 * d.f) + near * 1.5;
        ctx.fillStyle = `rgba(28,28,30,${a.toFixed(3)})`;
        ctx.fillRect(d.x - s / 2, d.y - s / 2, s, s);
      }
    },
    [canvas],
  );

  const build = useCallback(() => {
    const sec = section.current;
    const cv = canvas.current;
    if (!sec || !cv) return;
    const W = sec.offsetWidth;
    const H = sec.offsetHeight;
    if (!W || !H || getComputedStyle(cv).display === "none") return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    geom.current = { W, H, dpr };
    const ctrl = [
      [0.64, 0],
      [0.92, 0.1],
      [0.56, 0.24],
      [0.46, 0.36],
      [0.62, 0.5],
      [0.92, 0.62],
      [0.66, 0.76],
      [0.48, 0.88],
      [0.6, 1],
    ].map(([x, y]) => [x * W, y * H]);
    const cr = (p0: number[], p1: number[], p2: number[], p3: number[], t: number) => {
      const t2 = t * t;
      const t3 = t2 * t;
      return [0, 1].map(
        (i) =>
          0.5 *
          (2 * p1[i] +
            (-p0[i] + p2[i]) * t +
            (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
            (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3),
      );
    };
    const pts: number[][] = [];
    for (let s = 0; s < ctrl.length - 1; s++) {
      const p0 = ctrl[Math.max(0, s - 1)];
      const p3 = ctrl[Math.min(ctrl.length - 1, s + 2)];
      for (let k = 0; k < 80; k++) pts.push(cr(p0, ctrl[s], ctrl[s + 1], p3, k / 80));
    }
    pts.push(ctrl[ctrl.length - 1]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const step = 11;
    const out: Dot[] = [];
    let seed = 11;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const secLeft = sec.getBoundingClientRect().left;
    const textEdge = textCol.current
      ? textCol.current.getBoundingClientRect().right - secLeft + 36
      : 516;
    let i = 0;
    for (let d = 0; d <= L; d += step) {
      while (i < cum.length - 2 && cum[i + 1] < d) i++;
      const f = (d - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
      const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      let tx = pts[i + 1][0] - pts[i][0];
      let ty = pts[i + 1][1] - pts[i][1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      for (let k = -9; k <= 9; k++) {
        const fall = 1 - Math.abs(k) / 10;
        if (rnd() > Math.pow(fall, 1.4) * 1.05) continue;
        const dx = x - ty * k * step;
        const dy = y + tx * k * step;
        if (dx < textEdge) continue;
        const edgeFade = Math.min(1, (dx - textEdge) / 60);
        out.push({ x: dx, y: dy, t: d / L, f: fall * edgeFade });
      }
    }
    dots.current = out;
    paint(prog.current);
  }, [section, canvas, textCol, paint]);

  return { build, paint };
}

function ProductPage() {
  const [side, setSide] = useState<Side>("demand");
  const [active, setActive] = useState(0);
  const journey = useRef<HTMLDivElement | null>(null);
  const stepsCol = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const progBar = useRef<HTMLDivElement | null>(null);
  const { build, paint } = useJourneyPath(journey, canvas, stepsCol);
  const { headline, steps } = JOURNEYS[side];

  // Which step is under the middle of the viewport, how far along the steps
  // the reader is (the progress bar), and how far down the section (the path).
  const onScroll = useCallback(() => {
    const col = stepsCol.current;
    const sec = journey.current;
    if (!col || !sec) return;
    const els = col.querySelectorAll<HTMLElement>("[data-step]");
    if (!els.length) return;
    const mid = window.innerHeight * 0.5;
    let on = 0;
    els.forEach((el, n) => {
      if (el.getBoundingClientRect().top < mid) on = n;
    });
    const first = els[0].getBoundingClientRect();
    const last = els[els.length - 1].getBoundingClientRect();
    const span = last.top + last.height / 2 - (first.top + first.height / 2);
    const p = Math.max(0, Math.min(1, (mid - (first.top + first.height / 2)) / span));
    if (progBar.current) progBar.current.style.width = `${(p * 100).toFixed(2)}%`;
    const sr = sec.getBoundingClientRect();
    paint(Math.max(0, Math.min(1, (mid - sr.top) / sr.height)));
    setActive(on);
  }, [paint]);

  useEffect(() => {
    build();
    onScroll();
    const ro = new ResizeObserver(() => {
      build();
      onScroll();
    });
    if (journey.current) ro.observe(journey.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [build, onScroll]);

  // A side switch swaps the steps under the same scroll position.
  useEffect(() => onScroll(), [side, onScroll]);

  const pick = (s: Side) => {
    if (s === side) return;
    setSide(s);
    setActive(0);
    // If the reader is already partway down the journey, bring them back to
    // its top so the new side starts at step one.
    const sec = journey.current;
    if (sec && sec.getBoundingClientRect().top < 0) {
      window.scrollTo({
        top: window.scrollY + sec.getBoundingClientRect().top - 240,
        behavior: "smooth",
      });
    }
  };

  return (
    <Site>
      <SiteNav current="product" />
      <main>
        <section className="ws-intro" data-screen-label="Journey intro">
          <h1 className="ws-display lg">{headline}</h1>
          <div className="ws-sides" role="group" aria-label="Market side">
            <button type="button" aria-pressed={side === "supply"} onClick={() => pick("supply")}>
              <SupplyIcon />
              <span>Supply</span>
            </button>
            <button type="button" aria-pressed={side === "demand"} onClick={() => pick("demand")}>
              <DemandIcon />
              <span>Demand</span>
            </button>
          </div>
        </section>

        <section className="ws-journey" ref={journey} data-screen-label="Journey">
          <canvas ref={canvas} aria-hidden />
          <div className="ws-steps" ref={stepsCol}>
            {steps.map((s, n) => (
              <div
                key={`${side}-${n}`}
                data-step={n}
                className={`ws-step${n === active ? " on" : ""}`}
              >
                <div className="ws-eyebrow kicker">
                  <b>{String(n + 1).padStart(2, "0")}</b>
                  <i />
                  <span className="tag">{s.tag}</span>
                </div>
                <h2 className="ws-display md">{s.title}</h2>
                <p className="ws-lede">{s.body}</p>
                {/* Phones only (see site.css): the sticky viewer is hidden there. */}
                <img
                  className="inline-shot"
                  src={s.shots[0].src}
                  alt={s.shots[0].alt}
                  loading="lazy"
                />
              </div>
            ))}
          </div>

          <div className="ws-viewer" aria-hidden>
            <div className="ws-frames">
              {steps.map((s, n) => {
                const d = n - active;
                const style = {
                  opacity: d === 0 ? 1 : 0,
                  transform:
                    d === 0
                      ? "translateY(0px) scale(1)"
                      : d < 0
                        ? "translateY(-40px) scale(.96)"
                        : "translateY(40px) scale(.96)",
                };
                return s.shots.length > 1 ? (
                  <div key={`${side}-${n}`} className="ws-frame" style={style}>
                    <div className="fan">
                      <ShotStack shots={s.shots} fan="right" />
                    </div>
                  </div>
                ) : (
                  <div key={`${side}-${n}`} className="ws-frame single" style={style}>
                    <img src={s.shots[0].src} alt="" loading="lazy" />
                  </div>
                );
              })}
            </div>
            <div className="ws-progress">
              <div className="bar">
                <div ref={progBar} />
              </div>
              <div className="labels">
                {steps.map((s, n) => (
                  <span
                    key={s.tag}
                    className={`${n <= active ? "done" : ""}${n === active ? " on" : ""}`}
                  >
                    {s.tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="ws-caps" data-screen-label="Capabilities">
          <h2 className="ws-display md">Built for both sides of the market.</h2>
          <div className="grid">
            <div className="ws-cap">
              <div className="ws-eyebrow">Supply and demand</div>
              <h3>Switch sides in one tap.</h3>
              <p>
                Toggle between where a skill is wanted and where the people who have it already are.
              </p>
            </div>
            <div className="ws-cap">
              <div className="ws-eyebrow">Timeline</div>
              <h3>Twenty years of history.</h3>
              <p>
                Scrub back to 2006 to see how demand for a skill has shifted, and what drove it.
              </p>
            </div>
            <div className="ws-cap">
              <div className="ws-eyebrow">Search</div>
              <h3>Ask in your own words.</h3>
              <p>
                Search by skill name or describe it in plain language, employsi finds the match.
              </p>
            </div>
          </div>
        </section>

        <ClosingCta />
      </main>
      <SiteFooter />
    </Site>
  );
}
