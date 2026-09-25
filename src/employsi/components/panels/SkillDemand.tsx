import { useEffect, useMemo, useRef, useState } from "react";
import { smoothPath } from "../../lib/chart";
import { HUB_LNGLAT, AU_CITY_LNGLAT } from "../../data/mapboxWorldGeo";
import { CITY_LABEL, GLOBAL_HUB_LABEL } from "../../data/geo";
import { WORLD_OUTLINE, worldProject } from "../../data/worldOutline";
import {
  centreOf,
  FRAME_ASPECT,
  frameFor,
  maxZoomFor,
  ZOOM_STEP,
  zoomFrame,
  type Spot,
} from "../../lib/hotspotFrame";
import { SKILL_PARENT } from "../../data/skillsTaxonomy";
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

/**
 * How hot a hub is, from 0 to 1, driving its colour, its blob and its opacity.
 *
 * THE DESIGN USES SHARE OF THE BUSIEST HUB ALONE, and on this data that paints
 * a single advertised role bright red. Measured over the live archive on
 * 2026-09-25, across the 15,941 company·skill·hub spots this map actually
 * plots: the MEDIAN spot is one ad, 78% of company·skill maps have a single
 * hub, and 56% of those hold exactly one ad. So the design's rule would show
 * the top of a LOW→HIGH ramp on roughly 44% of all maps, for one vacancy.
 * That is not a rare edge, it is the common case.
 *
 * So a hub has to be big BOTH ways: `min` of its share of the busiest hub and
 * of its own absolute volume. A lone hub can no longer carry the ramp on
 * relative share, because with one hub that share is always 1 and says
 * nothing; and a hub in a busy map still cools down if the whole map is thin.
 *
 * The absolute scale is the measured distribution, not a guess — the anchors
 * are its own percentiles, so each colour means roughly the same rarity
 * wherever it appears:
 *
 *     1 ad   0.00   green    the median spot
 *     4      0.12   yellow   p75 is 3
 *    10      0.33   orange   p95
 *    30      0.66   red      p99 is 29
 *   120      1.00            the top of the ramp; the busiest spot is 696
 */
const HEAT_ANCHORS: [number, number][] = [
  [1, 0],
  [4, 0.12],
  [10, 0.33],
  [30, 0.66],
  [120, 1],
];
function absoluteHeat(n: number): number {
  if (n <= 1) return 0;
  const last = HEAT_ANCHORS[HEAT_ANCHORS.length - 1];
  if (n >= last[0]) return 1;
  for (let i = 1; i < HEAT_ANCHORS.length; i++) {
    const [x0, y0] = HEAT_ANCHORS[i - 1];
    const [x1, y1] = HEAT_ANCHORS[i];
    if (n <= x1) {
      // Interpolated in LOG space: the anchors are percentiles of a very
      // skewed distribution, and a linear read between 30 and 120 would make
      // every spot in that range look nearly identical.
      const f = (Math.log(n) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return y0 + f * (y1 - y0);
    }
  }
  return 1;
}
/** A hub is only hot if it leads its map AND has the volume to mean it. */
const heatOf = (n: number, max: number) => Math.min(n / max, absoluteHeat(n));

/**
 * The heat ramp, from the design: green below an eighth of the scale, then
 * yellow, orange and red.
 */
const heatColor = (t: number) =>
  t > 0.66
    ? "rgb(204,56,51)"
    : t > 0.33
      ? "rgb(242,140,46)"
      : t > 0.12
        ? "rgb(235,190,56)"
        : "rgb(56,160,110)";

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

function TopSkill({
  skills,
  ranks,
  kidsOf,
}: {
  skills: CompanySkillDemand[];
  ranks: SkillRanks;
  kidsOf: (skill: string) => CompanySkillDemand[];
}) {
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

      {/* The top skills are parents, so without this their specialities would
          have nowhere to appear at all — they are filtered out of the rows
          below precisely because they belong to a skill already on screen. */}
      <Specialities parent={s} kids={kidsOf(s.skill)} />

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
  const [hub, setHub] = useState<string | null>(null);
  const pickRef = useRef<HTMLDivElement | null>(null);
  // Zoom state is a multiple and a CENTRE, both in the base frame's own units,
  // rather than a second frame. One number and one point cannot fall out of
  // aspect with the container; a stored frame could.
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState<{ x: number; y: number } | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; panning: boolean } | null>(null);

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
  // A zoom belongs to the map it was made on. Switching skill in the picker, or
  // opening a different company's card, reframes on different hubs entirely, so
  // a carried-over centre would land on whatever happens to be at those
  // coordinates now — usually ocean, with the hubs off-screen and no sign of
  // why.
  useEffect(() => {
    setZoom(1);
    setCentre(null);
  }, [sel, plottable]);
  if (!entry || !frame) return null;

  const { skill, spots } = entry;
  const placed = spots.reduce((t, s) => t + s.n, 0);
  const max = Math.max(...spots.map((s) => s.n));
  const hovered = spots.find((sp) => sp.hub === hub) ?? null;
  // The blobs breathe via SMIL <animate>, which is how the design does it and
  // which CSS prefers-reduced-motion cannot switch off — the old halo was a CSS
  // animation and had a media query for exactly this. So the preference is read
  // here and the <animate> element is simply not rendered. Read on each render
  // rather than cached: this is cheap, and a setting changed mid-session should
  // take effect the next time the card opens.
  const stillness =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // What is actually drawn. `frame` is where the map opens and how far a pan may
  // go; `view` is the window on it. At zoom 1 they are the same box.
  const zMax = maxZoomFor(frame);
  const view = zoomFrame(frame, zoom, centre ?? centreOf(frame));
  // The design's radii and stroke are drawn against a 300-wide viewBox. This
  // one's viewBox is the view, which is whatever the hubs needed and then
  // whatever the user zoomed to, so every size taken from the design is
  // multiplied by this to arrive at the same apparent size on screen.
  //
  // IT IS THE VIEW'S WIDTH AND NOT THE FRAME'S, so the blobs hold their size in
  // PIXELS as the map zooms rather than in degrees. That is the behaviour a heat
  // layer has everywhere else — Mapbox's own heatmap-radius is in screen px —
  // and it is the whole point of the feature here: two hubs a hundred miles
  // apart share one blob at the default framing, and zooming in has to separate
  // them. Scaling the radius geographically would keep them welded together and
  // merely make the weld bigger.
  const k = view.w / 300;
  // Percentages are relative to the VIEW, not the world, so the overlays track
  // the zoom. The container is given the frame's aspect so `meet` fills it
  // exactly and there is no letterbox to correct for — and zoomFrame divides
  // both sides by the same number, so that aspect survives every zoom.
  const posOf = (sp: Spot) => ({
    left: `${((sp.x - view.x) / view.w) * 100}%`,
    top: `${((sp.y - view.y) / view.h) * 100}%`,
  });
  /** Move to a zoom about a point, keeping the result inside the base frame. */
  const zoomTo = (z: number, at?: { x: number; y: number }) => {
    const next = Math.max(1, Math.min(zMax, z));
    setZoom(next);
    // Storing the CLAMPED centre rather than the requested one is what makes a
    // pan reverse cleanly: without it, dragging into the edge banks up an offset
    // the map is ignoring, and the first drag back does nothing visible until
    // that debt is paid off.
    setCentre(next <= 1 ? null : centreOf(zoomFrame(frame, next, at ?? centre ?? centreOf(frame))));
  };
  /** A hub, brought close enough to read. Used by the dots and the ranked rows —
   *  the rows are the keyboard-reachable half of the same gesture. */
  const focusHub = (sp: Spot) => {
    setHub(sp.hub);
    zoomTo(Math.max(zoom, Math.min(zMax, 3)), { x: sp.x, y: sp.y });
  };
  /**
   * Drag to pan, in the view's units so a drag tracks the pointer exactly.
   *
   * Only while zoomed, and `touch-action` is left alone (see the CSS): a finger
   * on this map scrolls the card as it did before, because the map is 300px of
   * a card that scrolls and trapping the gesture there would be a worse bug than
   * the one this fixes. Touch reaches a hub by TAPPING it instead, which is the
   * same path as the click and also the only way to raise a tooltip without a
   * hover.
   */
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || e.pointerType === "touch") return;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, panning: false };
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const rect = mapRef.current?.getBoundingClientRect();
    if (!d || d.id !== e.pointerId || !rect) return;
    // THE CAPTURE IS TAKEN ON THE FIRST REAL MOVEMENT, NOT ON POINTERDOWN, and
    // the ordering is the whole reason clicking a hub still works while zoomed.
    // A pointer captured by this div retargets the pointerup to it, so the click
    // that follows is dispatched at the div rather than at the dot under the
    // finger — capturing up front would silently swallow every dot click on a
    // zoomed map. Taking it late also does the other half of the job: a drag
    // that ends over a dot does not click it.
    if (!d.panning) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 3) return;
      d.panning = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dx = ((e.clientX - d.x) / rect.width) * view.w;
    const dy = ((e.clientY - d.y) / rect.height) * view.h;
    d.x = e.clientX;
    d.y = e.clientY;
    const cur = centre ?? centreOf(frame);
    setCentre(centreOf(zoomFrame(frame, zoom, { x: cur.x - dx, y: cur.y - dy })));
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

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

      {/* The map, from the Hiring Hotspots design. The visual layer is the
          design's verbatim — ocean and land fills, the radial heat blobs under
          a colour-matrix filter, the white-ringed dots, the code badges, the
          hover card and the LOW/HIGH legend. What is NOT taken from it is the
          framing: the design hardcodes an Australia/New Zealand mercator, and
          this section has to frame whatever hubs the employer actually has,
          which can be Houston or Singapore. So the existing frame is kept and
          the design's sizes are scaled into it — see `k` below. */}
      <div
        className={`hspmap${zoom > 1 ? " hspmapz" : ""}`}
        ref={mapRef}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} aria-hidden>
          <defs>
            <radialGradient id="hspheatdot">
              <stop offset="0" stopColor="#000" stopOpacity="1" />
              <stop offset="0.45" stopColor="#000" stopOpacity="0.55" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            {/* Flattens each blob to its alpha, then reads that alpha through
                the ramp — so one grey gradient becomes green→yellow→orange→red
                and overlapping hubs compound into a hotter colour rather than
                a darker one. */}
            <filter
              id="hspheatcolor"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
              colorInterpolationFilters="sRGB"
            >
              <feColorMatrix type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0" />
              <feComponentTransfer>
                <feFuncR type="table" tableValues="0.20 0.30 0.62 0.98 0.95 0.80" />
                <feFuncG type="table" tableValues="0.70 0.75 0.82 0.78 0.45 0.22" />
                <feFuncB type="table" tableValues="0.50 0.45 0.35 0.22 0.18 0.20" />
                <feFuncA type="table" tableValues="0 0.42 0.58 0.68 0.76 0.82" />
              </feComponentTransfer>
            </filter>
          </defs>
          <rect x={view.x} y={view.y} width={view.w} height={view.h} className="hspsea" />
          <path className="hspland" d={WORLD_OUTLINE} strokeWidth={0.5 * k} />
          <g filter="url(#hspheatcolor)">
            {spots.map((sp, n) => {
              const t = heatOf(sp.n, max);
              const r = (12 + Math.sqrt(t) * 26) * k;
              return (
                <circle
                  key={sp.hub}
                  cx={sp.x}
                  cy={sp.y}
                  r={r}
                  fill="url(#hspheatdot)"
                  opacity={(0.35 + 0.65 * Math.sqrt(t)).toFixed(2)}
                >
                  {!stillness && (
                    // KEYED ON THE RADIUS. A running <animate> keeps driving `r`
                    // from the `values` it started with, so on a zoom the circle
                    // would settle back to its pre-zoom size the moment the
                    // animation looped. Keying it makes React replace the
                    // element, which restarts the animation at the new size.
                    <animate
                      key={r.toFixed(2)}
                      attributeName="r"
                      values={`${(r * 0.92).toFixed(2)};${(r * 1.12).toFixed(2)};${(r * 0.92).toFixed(2)}`}
                      dur={`${(3.4 - 1.2 * t).toFixed(2)}s`}
                      begin={`${(n * 0.3).toFixed(2)}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
                    />
                  )}
                </circle>
              );
            })}
          </g>
        </svg>

        {/* The dots are HTML, not SVG: anything under a moving viewBox scales
            with the zoom, so a tightly framed map would draw them several times
            the size of a wide one.
            THE DESIGN'S CODE BADGES ARE GONE, removed on request. They were
            drawn for the busiest four, and four is arbitrary in a way that
            shows: CSL's Melbourne carried one and its Hobart did not, which
            reads as a distinction the data is not making. A hub is now named by
            hovering it, and the three busiest are named again in the list
            below — so nothing is lost except the implication. */}
        {spots.map((sp) => {
          const t = heatOf(sp.n, max);
          return (
            <span
              key={sp.hub}
              className="hspdot"
              style={{ ...posOf(sp), background: heatColor(t), opacity: t < 0.08 ? 0.55 : 1 }}
              onMouseEnter={() => setHub(sp.hub)}
              onClick={() => focusHub(sp)}
            />
          );
        })}
        {hovered && (
          /* The design centres the card on the dot and stops there, which
             clips it against the card's edge on a hub near the frame's left or
             right. Rendered locally at three framings to check: London at 0.82
             across ran off. So the centring holds through the middle and gives
             way at the edges — the same flip the labels this replaced used. */
          <span
            className="hsptip"
            style={{
              ...posOf(hovered),
              transform: (() => {
                const f = (hovered.x - view.x) / view.w;
                if (f > 0.78) return "translate(-100%, 10px)";
                if (f < 0.22) return "translate(0, 10px)";
                return "translate(-50%, 10px)";
              })(),
            }}
          >
            <b>{hovered.label}</b>
            <em>
              {hovered.n.toLocaleString("en-US")} {hovered.n === 1 ? "AD" : "ADS"} ·{" "}
              {Math.round((hovered.n / placed) * 100)}%
            </em>
          </span>
        )}
        <span className="hspkey">
          <em>LOW</em>
          <i />
          <em>HIGH</em>
        </span>
        {/* Zoom. The default frame has to hold every hub an employer has, which
            for CSL is most of a hemisphere, and at that width two cities in the
            same state are one blob — so the map is honest about where the work
            is and useless for telling one hub from another. These, the hub
            clicks and the drag are the way out of that, and they are all one
            mechanism: they move the view within the frame the map opened on, so
            there is nowhere to get lost and the reset is always one press. */}
        {zMax > 1 && (
          <span className="hspzoom">
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= zMax - 0.001}
              onClick={() => zoomTo(zoom * ZOOM_STEP)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M12 6v12M6 12h12" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= 1.001}
              onClick={() => zoomTo(zoom / ZOOM_STEP)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M6 12h12" strokeLinecap="round" />
              </svg>
            </button>
            {zoom > 1.001 && (
              <button type="button" className="hspreset" onClick={() => zoomTo(1)}>
                RESET
              </button>
            )}
          </span>
        )}
      </div>

      {/* The design's ranked hubs. Three, because past that it stops being a
          reading of where the work is and becomes the same list the rows below
          already give. The percentage is of the ads ON THE MAP, which is what
          the coverage bar underneath then puts in proportion. */}
      <div className="hsprank">
        {/* A button, not a row: it zooms the map to its hub. That is the
            keyboard-reachable half of clicking a dot — a 9px dot is not a
            focusable target, and without this the zoom would be operable by
            mouse only past the first press of +. */}
        {spots.slice(0, 3).map((sp) => (
          <button
            key={sp.hub}
            type="button"
            className="hsprow"
            title={`Zoom to ${sp.label}`}
            onMouseEnter={() => setHub(sp.hub)}
            onMouseLeave={() => setHub(null)}
            onClick={() => focusHub(sp)}
          >
            <span className="hsprowname">{sp.label}</span>
            <span className="hsprowbar">
              <span style={{ width: `${Math.round((sp.n / max) * 100)}%` }} />
            </span>
            <span className="hsprowpct">{Math.round((sp.n / placed) * 100)}%</span>
          </button>
        ))}
      </div>

      <div className="hspfoot">
        <span className="hsptally">
          <b>{placed}</b> {placed === 1 ? "ad" : "ads"} <i>/</i> <b>{spots.length}</b>{" "}
          {spots.length === 1 ? "hub" : "hubs"}
        </span>
        {/* KEPT, though the design has no equivalent. Most archived ads record a
            country, or nothing. Without this bar the cluster reads as the whole
            employer, and the design's ranked percentages — which are shares of
            what is ON the map — would read as shares of everything. */}
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

// ── specialities ────────────────────────────────────────────────────────────

/**
 * The specialities of one skill, and — named, not implied — the ads that
 * declared none.
 *
 * A speciality is a SUBSET of the skill above it, never a sibling. Listed flat
 * they broke the card's arithmetic: Queensland Health's visible rows summed to
 * 973 against 891 live ads, because Midwifery's 46 were already inside
 * Nursing's 355. So they live here, under the skill they narrow, and nowhere
 * else.
 *
 * THE REMAINDER IS THE POINT OF THE HEADER LINE. 247 of those 355 nursing ads
 * said only "Registered Nurse", and that is a fact about how employers write
 * ads rather than a gap in the taxonomy. Leaving it out would invite the
 * reader to take the listed specialities for the whole picture — the same
 * reason the map states how much of the employer it can place, and the series
 * reports the span actually drawn.
 *
 * `specialised` is counted per ad upstream, so it is never the sum of the rows
 * below: one ad can name two specialities, and measured on the archive 82
 * nursing titles do.
 */
function Specialities({
  parent,
  kids,
}: {
  parent: CompanySkillDemand;
  kids: CompanySkillDemand[];
}) {
  const [open, setOpen] = useState(false);
  const named = parent.specialised ?? 0;
  if (!kids.length || !named) return null;
  const rest = parent.now - named;
  return (
    <div className={`spec${open ? " is-open" : ""}`}>
      <button type="button" className="specsum" onClick={() => setOpen((v) => !v)}>
        <span className="specchev" aria-hidden />
        <span className="specsumt">
          <b>{named}</b> of {parent.now} named a speciality
        </span>
      </button>
      {open && (
        <ul className="speclist">
          {kids.map((k) => (
            <li className="specrow" key={k.skill}>
              <span className="specname">{k.skill}</span>
              <span className="specn">{k.now}</span>
              <Delta pct={k.pct} className="specd" />
            </li>
          ))}
          {/* Last, and styled apart: it is the complement of the rows above,
              not another speciality. */}
          {rest > 0 && (
            <li className="specrow specrest">
              <span className="specname">No speciality named</span>
              <span className="specn">{rest}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ── the rest ────────────────────────────────────────────────────────────────

const SP_W = 88;
const SP_H = 26;

function AlsoAdvertised({
  skills,
  kidsOf,
}: {
  skills: CompanySkillDemand[];
  kidsOf: (skill: string) => CompanySkillDemand[];
}) {
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
              <Specialities parent={s} kids={kidsOf(s.skill)} />
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
  /**
   * Specialities come out of the flat list and go under the skill they narrow.
   *
   * They are subsets, so listing them alongside their parents both broke the
   * arithmetic — the visible rows summed to more live ads than the employer
   * has — and cost whole unrelated skills their place, because a speciality
   * took a row that Pharmacy needed. `trends.skills` is untouched: the fold is
   * right, it was the flat presentation that lied.
   */
  const { parents, kidsOf } = useMemo(() => {
    const byParent = new Map<string, CompanySkillDemand[]>();
    const parents: CompanySkillDemand[] = [];
    for (const s of trends.skills) {
      const p = SKILL_PARENT[s.skill];
      if (!p) parents.push(s);
      else (byParent.get(p) ?? byParent.set(p, []).get(p)!).push(s);
    }
    return { parents, kidsOf: (skill: string) => byParent.get(skill) ?? [] };
  }, [trends.skills]);

  const top = parents.slice(0, TOP_N);
  const rest = parents.slice(TOP_N);
  if (!top.length) return null;
  return (
    <>
      <TopSkill skills={top} ranks={ranks} kidsOf={kidsOf} />
      {/* The map keeps every skill, specialities included. It plots ONE at a
          time, so it cannot double-count, and "where are the midwifery jobs"
          is a better question than "where are the nursing jobs". */}
      <HotSpots skills={trends.skills} liveAds={trends.liveAds} companyHubs={trends.hubs} />
      <AlsoAdvertised skills={rest} kidsOf={kidsOf} />
    </>
  );
}
