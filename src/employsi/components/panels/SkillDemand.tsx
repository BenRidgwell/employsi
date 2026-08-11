import { useEffect, useMemo, useRef, useState } from "react";
import { smoothPath } from "../../lib/chart";
import { HUB_LNGLAT, AU_CITY_LNGLAT } from "../../data/mapboxWorldGeo";
import { CITY_LABEL, GLOBAL_HUB_LABEL } from "../../data/geo";
import { WORLD_OUTLINE, WORLD_W, WORLD_H, worldProject } from "../../data/worldOutline";
import type { CompanySkillDemand, CompanySkillTrends, SkillRanks } from "../../lib/jobHistoryFn";

// The company card's skills section, built on getCompanySkillTrends +
// getSkillMarketRanks. Three parts, in the order a reader needs them:
//
//   1. the top skill, at size, with a picker for the next two
//   2. where its live ads actually are
//   3. everything else, one row each with its own line
//
// Everything here is archive-derived. Where the archive cannot support a
// figure the figure is absent rather than softened — a skill with too short a
// window gets a count and no percentage, a map with nothing placeable is not
// offered, and the map always states how much of the picture it is showing.

/** Top skills offered by the picker. Beyond three the control stops being a
 *  glance and starts being a list; the rest are rows below. */
const TOP_N = 3;
/** Rows shown before the "more" toggle. BHP alone returns 41 skills and the
 *  full tail turns a card section into a spreadsheet — the long end is one or
 *  two ads apiece and is what the toggle is for. */
const ROWS_SHOWN = 8;

const HUB_COORD: Record<string, [number, number]> = { ...HUB_LNGLAT, ...AU_CITY_LNGLAT };
const hubLabel = (hub: string) => CITY_LABEL[hub] || GLOBAL_HUB_LABEL[hub] || hub;

const pctText = (pct: number) => {
  const abs = Math.abs(pct);
  return (
    (pct >= 0 ? "+" : "−") +
    abs.toLocaleString("en-AU", {
      minimumFractionDigits: abs >= 100 ? 0 : 1,
      maximumFractionDigits: abs >= 100 ? 0 : 1,
    }) +
    "%"
  );
};

/** A change, with its direction. Three states kept apart on purpose: nothing at
 *  all when the archive cannot support a figure, a bare zero when the count was
 *  measured and did not move, and a figure with a caret when it did. A 0.0%
 *  wearing an up caret asserts growth nobody measured. */
function Delta({ pct, className }: { pct: number | null; className: string }) {
  if (pct === null) return null;
  if (pct === 0) return <span className={className}>0.0%</span>;
  const up = pct > 0;
  return (
    <span className={`${className} ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {pctText(pct)}
    </span>
  );
}

/** Project a series into a path plus its closing area, over a given box. */
function seriesPaths(vals: number[], w: number, top: number, bot: number, base: number) {
  const n = vals.length;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.35;
  const a = lo - pad;
  const b = hi + pad;
  const pts: [number, number][] = vals.map((v, i) => [
    (i / Math.max(1, n - 1)) * (w - 4) + 2,
    bot - ((v - a) / (b - a)) * (bot - top),
  ]);
  const line = smoothPath(pts);
  return { pts, line, area: `${line} L ${w} ${base} L 0 ${base} Z` };
}

// ── the top skill ───────────────────────────────────────────────────────────

const TS_W = 400;
const TS_TOP = 40;
const TS_BOT = 122;
const TS_BASE = 150;
/** Tallest a new-postings bar may draw, in viewBox units. Deliberately short:
 *  the bars are context under the line, not a second chart competing with it. */
const TS_BAR_MAX = 46;

function TopSkill({ skills, ranks }: { skills: CompanySkillDemand[]; ranks: SkillRanks }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef<HTMLDivElement | null>(null);

  // A different company may have fewer skills than the one before it, so the
  // selection is clamped rather than trusted across a re-render.
  const sel = Math.min(i, skills.length - 1);
  const s = skills[sel];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!pickRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const geom = useMemo(() => {
    if (!s?.spark || s.spark.length < 2) return null;
    return seriesPaths(s.spark, TS_W, TS_TOP, TS_BOT, TS_BASE);
  }, [s]);

  if (!s) return null;
  const up = (s.pct ?? 0) >= 0;
  const rank = ranks[s.skill];
  const bars = s.newSpark ?? [];
  const barMax = Math.max(1, ...bars);
  const at = hover != null && s.spark ? hover : null;

  return (
    <section className={`tsk ${up ? "up" : "down"}`}>
      <div className="tskhd">
        <span className="cceyebrow">Top skill</span>
        {skills.length > 1 && (
          <div className="tskpick" ref={pickRef}>
            <button
              type="button"
              className="tskbtn"
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <span>{s.skill}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {open && (
              <div className="tskmenu" role="listbox">
                {skills.map((o, k) => (
                  <button
                    key={o.skill}
                    type="button"
                    role="option"
                    aria-selected={k === sel}
                    className="tskopt"
                    onClick={() => {
                      setI(k);
                      setOpen(false);
                    }}
                  >
                    <span className="tskoptr">{k + 1}</span>
                    <span className="tskoptn">{o.skill}</span>
                    <span className="tskoptv">{o.now}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="tskval">
        <span className="tskv">{s.now.toLocaleString("en-AU")}</span>
        <span className="tskvsub">live ads</span>
        {/* Absent, not zero, when the archive cannot support a change. */}
        <Delta pct={s.pct} className="ccdelta" />
        {s.spark && s.spark.length > 1 && (
          <span className="tskwin">last {s.spark.length} days</span>
        )}
      </div>

      <div className="tskmeta">
        <span className="tskcat">{s.cat}</span>
        {/* Rank across every employer in the archive, not just this one. It is
            what makes the count above legible: the same figure means one thing
            for a skill ranked 4th nationally and another for one ranked 54th. */}
        {rank && (
          <span className="tskranks">
            {rank.localRank !== null && (
              <span className="tskrank">
                Local <b>#{rank.localRank}</b>/{rank.localOf}
              </span>
            )}
            {rank.globalRank !== null && (
              <span className="tskrank">
                World <b>#{rank.globalRank}</b>/{rank.globalOf}
              </span>
            )}
          </span>
        )}
      </div>

      {geom && (
        <div
          className="tskplot"
          ref={plotRef}
          onMouseMove={(e) => {
            const n = s.spark?.length ?? 0;
            if (n < 2) return;
            const r = e.currentTarget.getBoundingClientRect();
            const f = (e.clientX - r.left) / r.width;
            setHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {/* The clip is on a wrapper around the SVG alone: on the plot it cuts
              off the readout, on the card it cuts off the open picker. */}
          <div className="tskclip">
            <svg viewBox={`0 0 ${TS_W} ${TS_BASE}`} preserveAspectRatio="none" fill="none">
              <defs>
                <linearGradient id="tsk-fade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="currentColor" stopOpacity=".34" />
                  <stop offset=".55" stopColor="currentColor" stopOpacity=".12" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* New postings that day, under ads live that day. Two different
                  measures off the same rows, not one drawn twice. */}
              {bars.map((v, k) => {
                const bw = ((TS_W - 4) / Math.max(1, bars.length)) * 0.46;
                const h = (v / barMax) * TS_BAR_MAX;
                const x = (k / Math.max(1, bars.length - 1)) * (TS_W - 4) + 2;
                return (
                  <rect
                    key={k}
                    className="tskbar"
                    x={x - bw / 2}
                    y={TS_BASE - h}
                    width={bw}
                    height={h}
                    rx={Math.min(3, bw / 2)}
                  />
                );
              })}
              <path d={geom.area} fill="url(#tsk-fade)" />
              <path
                d={geom.line}
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {at !== null && (
                <line
                  className="tskguide"
                  x1={geom.pts[at][0]}
                  x2={geom.pts[at][0]}
                  y1={20}
                  y2={TS_BASE}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
          {at !== null && (
            <>
              <span
                className="tskdot"
                style={{
                  left: `${(geom.pts[at][0] / TS_W) * 100}%`,
                  top: `${(geom.pts[at][1] / TS_BASE) * 100}%`,
                }}
              />
              <span
                className="tsktip"
                style={{
                  left: `${(geom.pts[at][0] / TS_W) * 100}%`,
                  top: `${(geom.pts[at][1] / TS_BASE) * 100}%`,
                }}
              >
                {s.spark?.[at]} live · {bars[at] ?? 0} new
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── hot spots ───────────────────────────────────────────────────────────────

interface Spot {
  hub: string;
  label: string;
  n: number;
  x: number;
  y: number;
}

/** Smallest span the frame will zoom to, in viewBox units. One hub has no
 *  extent of its own, and without a floor the frame collapses onto it and the
 *  coastline behind becomes an unreadable smear. ~40 units is a country. */
const FRAME_MIN = 40;
/** Breathing room around the spots, as a share of the framed span. Labels sit
 *  beside their dot and need somewhere to go. */
const FRAME_PAD = 0.38;
/** The frame's shape. Fixed so the card does not change height when the picker
 *  moves between a one-city skill and a worldwide one. */
const FRAME_ASPECT = 1.5;

/**
 * Frame the map on the data.
 *
 * The whole world is the wrong view for most employers: BHP's placeable ads sit
 * in four Australian cities and Manila, so a global projection spends nearly
 * all of its area on empty ocean. The path and the projection are unchanged —
 * only the viewBox moves, which costs nothing and keeps every coordinate
 * comparable with the app's other maps.
 */
function frameFor(spots: Spot[]): { x: number; y: number; w: number; h: number } {
  const xs = spots.map((s) => s.x);
  const ys = spots.map((s) => s.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const padX = Math.max((maxX - minX) * FRAME_PAD, FRAME_MIN / 2);
  const padY = Math.max((maxY - minY) * FRAME_PAD, FRAME_MIN / 2);
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;
  let w = maxX - minX;
  let h = maxY - minY;
  // Grow the short side rather than the long one, so framing never crops a hub.
  if (w / h < FRAME_ASPECT) {
    const want = h * FRAME_ASPECT;
    minX -= (want - w) / 2;
    w = want;
  } else {
    const want = w / FRAME_ASPECT;
    minY -= (want - h) / 2;
    h = want;
  }
  // Keep the frame on the map. Shift before clamping, so a frame that runs off
  // an edge slides back in at full size instead of being squashed against it.
  if (w > WORLD_W) {
    minX = 0;
    w = WORLD_W;
  } else minX = Math.max(0, Math.min(minX, WORLD_W - w));
  if (h > WORLD_H) {
    minY = 0;
    h = WORLD_H;
  } else minY = Math.max(0, Math.min(minY, WORLD_H - h));
  return { x: minX, y: minY, w, h };
}

function HotSpots({
  skills,
  liveAds,
  companyHubs,
}: {
  skills: CompanySkillDemand[];
  liveAds: number;
  companyHubs: { hub: string; n: number }[];
}) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement | null>(null);

  // Only skills with somewhere to plot. A skill whose ads all carry a country
  // rather than a city has nothing to put on a map, and offering it would open
  // an empty one.
  const plottable = useMemo(
    () =>
      skills
        .map((s) => ({
          skill: s,
          spots: s.hubs
            .filter((h) => HUB_COORD[h.hub])
            .map((h) => {
              const [x, y] = worldProject(HUB_COORD[h.hub][0], HUB_COORD[h.hub][1]);
              return { hub: h.hub, label: hubLabel(h.hub), n: h.n, x, y } as Spot;
            }),
        }))
        .filter((e) => e.spots.length > 0)
        .sort(
          (a, b) => b.spots.reduce((t, s) => t + s.n, 0) - a.spots.reduce((t, s) => t + s.n, 0),
        ),
    [skills],
  );

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!pickRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Company-wide coverage, from ads counted once each rather than once per
  // skill. It is the honest denominator for "how much of this employer is on
  // the map", and it does not move as the picker does.
  const located = useMemo(
    () => companyHubs.filter((h) => HUB_COORD[h.hub]).reduce((t, h) => t + h.n, 0),
    [companyHubs],
  );

  const sel = Math.min(i, Math.max(0, plottable.length - 1));
  const entry = plottable[sel];
  const frame = useMemo(() => (entry ? frameFor(entry.spots) : null), [entry]);
  if (!entry || !frame) return null;

  const { skill, spots } = entry;
  const placed = spots.reduce((t, s) => t + s.n, 0);
  const max = Math.max(...spots.map((s) => s.n));
  // Percentages are relative to the FRAME, not the world, so the overlays track
  // the zoom. The container is given the frame's aspect so `meet` fills it
  // exactly and there is no letterbox to correct for.
  const posOf = (sp: Spot) => ({
    left: `${((sp.x - frame.x) / frame.w) * 100}%`,
    top: `${((sp.y - frame.y) / frame.h) * 100}%`,
  });

  return (
    <section className="hsp">
      <div className="tskhd">
        <span className="cceyebrow">Where they hire it</span>
        {plottable.length > 1 && (
          <div className="tskpick" ref={pickRef}>
            <button
              type="button"
              className="tskbtn"
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <span>{skill.skill}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {open && (
              <div className="tskmenu" role="listbox">
                {plottable.map((o, k) => (
                  <button
                    key={o.skill.skill}
                    type="button"
                    role="option"
                    aria-selected={k === sel}
                    className="tskopt"
                    onClick={() => {
                      setI(k);
                      setOpen(false);
                    }}
                  >
                    <span className="tskoptn">{o.skill.skill}</span>
                    <span className="tskoptv">{o.spots.reduce((t, s) => t + s.n, 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hspmap" style={{ aspectRatio: `${FRAME_ASPECT}` }}>
        <svg viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} aria-hidden>
          <path className="hspland" d={WORLD_OUTLINE} />
        </svg>
        {/* Markers and labels are HTML: text placed in SVG under a moving
            viewBox scales with the zoom, so a tightly framed map would render
            its labels at several times the size of a wide one. */}
        {spots.map((sp) => {
          // AREA tracks the count. Scaling the radius would exaggerate a busy
          // hub by its square.
          const size = 22 + Math.sqrt(sp.n / max) * 22;
          // Labels sit right of the dot, and flip to the left in the right-hand
          // third where they would otherwise run off the card.
          const right = (sp.x - frame.x) / frame.w > 0.62;
          return (
            <span key={sp.hub} className="hspspot" style={posOf(sp)}>
              <span className="hsphalo" style={{ width: size, height: size }} />
              <span className="hspcore" />
              <span
                className={`hsplabel ${right ? "left" : ""}`}
                style={{ [right ? "right" : "left"]: size / 2 + 8 }}
              >
                <b>{sp.label}</b>
                <em>
                  {sp.n} {sp.n === 1 ? "ad" : "ads"}
                </em>
              </span>
            </span>
          );
        })}
      </div>

      <div className="hspfoot">
        <span className="hsptally">
          <b>{placed}</b> {placed === 1 ? "ad" : "ads"} <i>/</i> <b>{spots.length}</b>{" "}
          {spots.length === 1 ? "hub" : "hubs"}
        </span>
        {/* Most archived ads record a country, or nothing. The bar is the point:
            without it the cluster reads as the whole employer. */}
        {liveAds > 0 && (
          <span className="hspcov">
            <span className="hspbar">
              <span className="hspbarfill" style={{ width: `${(located / liveAds) * 100}%` }} />
            </span>
            <em>
              {located} / {liveAds} located
            </em>
          </span>
        )}
      </div>
    </section>
  );
}

// ── the rest ────────────────────────────────────────────────────────────────

const SP_W = 88;
const SP_H = 26;

function AlsoAdvertised({ skills }: { skills: CompanySkillDemand[] }) {
  const [all, setAll] = useState(false);
  if (!skills.length) return null;
  const shown = all ? skills : skills.slice(0, ROWS_SHOWN);
  const rest = skills.length - shown.length;
  return (
    <section className="alsk">
      <div className="ccsecth">
        <span className="cceyebrow">Also advertised</span>
        <span className="ccsecthsub">live count · trend</span>
      </div>
      <div className="alskrows">
        {shown.map((s) => {
          const up = (s.pct ?? 0) >= 0;
          const g =
            s.spark && s.spark.length > 1 ? seriesPaths(s.spark, SP_W, 3, SP_H - 3, SP_H) : null;
          return (
            <div className="alskrow" key={s.skill}>
              <div className="alskmain">
                <span className="alskname">{s.skill}</span>
                <span className="alskcat">{s.cat}</span>
              </div>
              {/* No line rather than a stub when the archive is too young for
                  one — the row still carries its count. */}
              {g ? (
                <svg
                  className={`alspark ${up ? "up" : "down"}`}
                  viewBox={`0 0 ${SP_W} ${SP_H}`}
                  preserveAspectRatio="none"
                  fill="none"
                  aria-hidden
                >
                  <defs>
                    <linearGradient
                      id={`alsp-${s.skill.replace(/\W+/g, "")}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0" stopColor="currentColor" stopOpacity=".26" />
                      <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={g.area} fill={`url(#alsp-${s.skill.replace(/\W+/g, "")})`} />
                  <path
                    d={g.line}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : (
                <span className="alsparknone" />
              )}
              <div className="alskval">
                <span className="alskn">{s.now}</span>
                <Delta pct={s.pct} className="alskd" />
              </div>
            </div>
          );
        })}
      </div>
      {/* The count is named rather than the list just stopping: a section that
          silently ends reads as the complete one. */}
      {(rest > 0 || all) && (
        <button
          type="button"
          className="ccchip ccchipmore alskmore"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "show fewer" : `+${rest} more`}
        </button>
      )}
    </section>
  );
}

export function SkillDemand({ trends, ranks }: { trends: CompanySkillTrends; ranks: SkillRanks }) {
  const top = trends.skills.slice(0, TOP_N);
  const rest = trends.skills.slice(TOP_N);
  if (!top.length) return null;
  return (
    <>
      <TopSkill skills={top} ranks={ranks} />
      <HotSpots skills={trends.skills} liveAds={trends.liveAds} companyHubs={trends.hubs} />
      <AlsoAdvertised skills={rest} />
    </>
  );
}
