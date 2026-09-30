import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAppStore } from "../../state/store";
import { getCareerCard, searchCareerSkills } from "../../lib/careerPathwaysFn";
import type { CardNode, CareerCardModel } from "../../lib/careerCard";
import { CAREER_LAND_PATH, projectHotspot } from "../../data/careerLand";
import { HEAT_RAMP_FLOOR, heatGradientCss, heatRgb } from "../../lib/heatRamp";
import { IconClose } from "../ActionIcons";
import { CardLoader } from "./CardLoader";
import { FollowGlyph } from "../GlobalSearch";
import { SKILL_PARENT, searchSkillMatches } from "../../data/skillsTaxonomy";
import { describeSkills } from "../../lib/describeSkills";
import { demandLevel } from "../../lib/skillHeat";
import { useOntologyReady } from "../../hooks/useOntologyReady";
import { useDraggablePane } from "../../hooks/useDraggablePane";
import { useClickAway } from "../../hooks/useClickAway";
import { onetForRole, onetUrl } from "../../lib/onet";
import { SKILL_ICONS, skillIcon } from "../../lib/skillCard";

/**
 * The Career Pathway Card, built from `Career_Pathway_Card.html` (2026-09-25).
 *
 * The markup and styles are the design's, element for element — sizes,
 * fonts, colours, the dotted map, the heat filter's colour table. What changed
 * is only what the design faked, and each change is the adapter's
 * (lib/careerCard.ts), where the reasons are written down:
 *
 *   • every figure comes from the pathways dataset, through getCareerCard;
 *   • TIME IN ROLE → EMPLOYERS and DAYS TO FILL → DAYS ADVERTISED, because an
 *     archive of ads holds neither a tenure nor a hire;
 *   • the trend carries the span it was measured over ("−17% · 49D"), and the
 *     sparkline is daily, scrubbed by date;
 *   • the map shows the core path, plus the ONE specialism a searched skill
 *     opens (laneForSkill) — never a "lateral move" the data cannot evidence;
 *   • with a skill picked only the ad count follows it ("live ads with
 *     skill"); the chart and the hotspots stay the role's;
 *   • the search is the central search bar's, not the design's pill — see
 *     CareerSearch.
 *
 * Two additions the design has no place for, both because it is a page and
 * this is a pane over the map: a close button, and the scrim behind it.
 */

// ── Design constants ─────────────────────────────────────────────────────────

const PX = 240;
const CW = 168;
const CH = 96;
const ROW0 = 34;
/** Space under the last lane for the edge labels that hang below the cards. */
const LABEL_ROOM = 52;
/** How far below the cards' bottom edge an edge label starts. */
const LABEL_DROP = 14;
// 160, not the design's 142: the skill label on each step now hangs BELOW the
// cards (see the edge labels), and a two-line one needs the room before the
// next lane's heading.
const ROWH = 160;
const INK = "var(--neutral-900,#1c1c1e)";

const MONA = "'Mona Sans Variable','Mona Sans',system-ui,sans-serif";
const INTER = "'Inter',system-ui,sans-serif";
const EYEBROW: CSSProperties = {
  font: `500 11px/1 ${INTER}`,
  letterSpacing: ".08em",
  color: "var(--text-tertiary,#8e8e93)",
};
const TILE_LABEL: CSSProperties = {
  font: `500 10px/1 ${INTER}`,
  letterSpacing: ".08em",
  color: "var(--text-tertiary,#8e8e93)",
};
const TILE_VALUE: CSSProperties = {
  font: `600 16px/1 ${INTER}`,
  fontVariantNumeric: "tabular-nums",
};

const num = (n: number) => n.toLocaleString("en-US");
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })
    .toUpperCase();

/** The design's smoothed sparkline: Catmull-Rom through every day's count. */
function sparkPath(counts: number[]) {
  const N = counts.length;
  const lo = Math.min(...counts);
  const hi = Math.max(...counts);
  const r = hi - lo || 1;
  const ys = counts.map((v) => 10 + (1 - (v - lo) / r) * 50);
  const X = (i: number) => (i / (N - 1)) * 288;
  let line = `M0 ${ys[0].toFixed(1)}`;
  for (let i = 0; i < N - 1; i++) {
    const y0 = ys[Math.max(0, i - 1)];
    const y1 = ys[i];
    const y2 = ys[i + 1];
    const y3 = ys[Math.min(N - 1, i + 2)];
    const dx = X(1) / 6;
    line += ` C${(X(i) + dx).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)} ${(X(i + 1) - dx).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)} ${X(i + 1).toFixed(1)} ${y2.toFixed(1)}`;
  }
  return { N, ys, line, area: `${line} L288 72 L0 72 Z` };
}

type Placed = CardNode & { x: number; y: number };

/**
 * A role card's demand glow, on the globe's heat legend (lib/heatRamp).
 *
 * RELATIVE to the map shown: `ads / max` over the roles drawn, with the ads
 * the card itself prints (live ads, or live ads naming the searched skill).
 * The busiest role is the top of the ramp and the thinnest the bottom, the
 * way the hotspot map beside it scales its cities — so it answers "where on
 * this ladder is the demand", not "is this a busy job" in absolute terms,
 * which is a different question with a different denominator.
 *
 * A role with no live ads gets no glow at all: a real zero stays zero, and a
 * faint green would read as "some demand".
 */
function glowStyle(ads: number, max: number): CSSProperties & { "--cpglow": string } {
  if (!(ads > 0) || !(max > 0)) return { "--cpglow": "0 0 0 0 transparent" };
  const t = ads / max;
  const [r, g, b] = heatRgb(HEAT_RAMP_FLOOR + t * (1 - HEAT_RAMP_FLOOR));
  const c = (a: number) => `rgba(${r},${g},${b},${a.toFixed(2)})`;
  // The card itself stays white — the demand is the halo BEHIND it, not a
  // tint on it (the first version washed the card's background and edge, and
  // read as a coloured card rather than a lit one). A wide soft spread plus a
  // tighter inner ring, both scaling with t, so the busiest role is visibly
  // lit and the thinnest only faintly.
  return {
    "--cpglow": `0 0 26px 3px ${c(0.3 + 0.45 * t)}, 0 0 9px 0 ${c(0.22 + 0.33 * t)}`,
  };
}

// ── The card ─────────────────────────────────────────────────────────────────

export function CareerPathwaysPane() {
  const open = useAppStore((s) => s.careerOpen);
  const close = useAppStore((s) => s.closeCareer);
  const dragRef = useDraggablePane<HTMLDivElement>(open);

  // Click-away without a scrim, so the map behind stays zoomable.
  // The map and the company card do not close it: the card is used WHILE
  // exploring — pick a role, then find the country, city and company
  // advertising it. Close is the ✕, the rail button, Esc or another pane.
  useClickAway(open, close, ".cppane", ".mapframe, .cc");

  if (!open) return null;
  return (
    <div className="cppane" role="dialog" aria-label="Career pathways" ref={dragRef}>
      <CareerCard onClose={close} />
    </div>
  );
}

/**
 * How long the opening loader holds at least, every time the card opens.
 *
 * The What's Trending pane's CardLoader, used the same way — laid over the
 * whole card — but with a floor. The model is cached for 30 minutes, so after
 * the first open the data is there instantly and the loader would flash for a
 * frame or not appear at all, while the map underneath is still panning to the
 * selected role. 1.2 s shows the mark's sweep and the first stage label, and
 * covers that pan. A slow fetch keeps it up for as long as the fetch takes.
 */
const OPEN_LOADER_MS = 1200;

/**
 * The first open on each PAGE LOAD starts on "Start with a skill"
 * (`Career_Pathway_Placeholder.html`) rather than on a family's map picked for
 * the reader. The first skill searched ends it until the page is reloaded;
 * later opens go straight to the map.
 *
 * In memory, deliberately. It was sessionStorage until 2026-09-28, which
 * outlived reloads for as long as the tab stayed open — so once anyone had
 * searched in a tab, the placeholder never came back there, and it read as
 * gone. A reload is now a fresh start.
 */
let careerStartedThisLoad = false;
const careerStarted = () => careerStartedThisLoad;
function markCareerStarted(): void {
  careerStartedThisLoad = true;
}

function CareerCard({ onClose }: { onClose: () => void }) {
  const uid = useId().replace(/:/g, "");
  // CareerCard mounts on every open (CareerPathwaysPane renders nothing while
  // closed), so this runs once per opening.
  // Opened from the profile's "View pathway": start on that role's family,
  // with its lane beside the core if it is a specialism, and select it.
  const [focus] = useState(() => useAppStore.getState().takeCareerFocus());
  // A goal link is a destination, so it skips the placeholder.
  const [started, setStarted] = useState(() => !!focus || careerStarted());
  // The loader runs when the map is first shown: on open, or — from the
  // placeholder — when the first skill is searched. The placeholder itself is
  // static and has nothing to wait for.
  const [holding, setHolding] = useState(started);
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(() => setHolding(false), OPEN_LOADER_MS);
    return () => clearTimeout(t);
  }, [holding]);
  const [family, setFamily] = useState(() => focus?.split("|")[0] || "hr");
  const [skill, setSkill] = useState<string | null>(null);
  const [lane, setLane] = useState<string | null>(() => focus?.split("|")[1] || null);

  const { data, isPlaceholderData } = useQuery({
    // With a skill, the server picks the family (the one advertising it most),
    // so the family is only a tie-break hint and not part of the key.
    queryKey: ["careerCard", skill ? "" : family, skill, skill ? null : lane],
    queryFn: () => getCareerCard({ data: { family, skill, lane } }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const model: CareerCardModel | null = data?.model ?? null;
  // Clearing a skill returns to the family it opened, not to the one before.
  useEffect(() => {
    if (model) setFamily(model.family);
  }, [model]);

  // Selection is held by node id, not index: a skill search swaps the model
  // (a lane appears or goes), and an index would then point at another role.
  const [selId, setSelId] = useState<string | null>(focus);
  /** The ladder's entry rung — the first role on the core path. Not the
   *  reader's own role; nothing here knows that. */
  const [entryId, setEntryId] = useState<string | null>(null);
  // The goal is the account's, not the card's: set here, shown on the profile
  // (AccountButton), and still marked here next time. Signed out, setting one
  // opens the sign-in sheet and it is saved on return (store.requestCareerGoal).
  const goalId = useAppStore((s) => s.careerGoal);
  const requestCareerGoal = useAppStore((s) => s.requestCareerGoal);
  const setRoleFocus = useAppStore((s) => s.setRoleFocus);
  const [pop, setPop] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hub, setHub] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [z, setZ] = useState(1);
  const [anim, setAnim] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(
    null,
  );
  const dragged = useRef(false);

  const jumpTo = useRef<string | null>(null);
  const focusRole = (o: CardNode) =>
    setRoleFocus({
      id: o.id,
      title: o.title,
      companies: Object.fromEntries(o.companies.map(([id, ads]) => [id, ads])),
      cities: Object.fromEntries(o.hubs.map((h) => [h.id, h.n])),
      byCity: Object.fromEntries(
        Object.entries(o.companiesByCity).map(([hub, cs]) => [hub, Object.fromEntries(cs)]),
      ),
    });

  const nodes: Placed[] = useMemo(
    () => (model?.nodes ?? []).map((n) => ({ ...n, x: 24 + n.col * PX, y: ROW0 + n.row * ROWH })),
    [model],
  );
  const lanes = model?.lanes.length ?? 1;
  const idx = (id: string | null) => (id ? nodes.findIndex((n) => n.id === id) : -1);

  const center = useCallback(
    (i: number) => {
      const el = mapRef.current;
      const nd = nodes[i];
      if (!el || !nd) return;
      const H = ROW0 + (lanes - 1) * ROWH + CH + LABEL_ROOM;
      const h = el.clientHeight;
      const want = h / 2 - (nd.y + CH / 2) * z;
      const y = H * z <= h ? (h - H * z) / 2 : Math.max(h - H * z, Math.min(0, want));
      setAnim(true);
      setPan({ x: el.clientWidth / 2 - (nd.x + CW / 2) * z, y });
    },
    [nodes, lanes, z],
  );

  // A new model (first load, or a skill picked / cleared). Keep the selection
  // if the role is still on the map; otherwise the design's rules — the first
  // role asking for the skill above the ENTRY RUNG, or the core's second rung.
  //
  // The entry rung is the first role on the core path, and it is exactly that:
  // where this ladder starts. It carried a "YOU" badge until 2026-09-26, which
  // made it look like the reader's own position — see the note at the node.
  // Removing the badge leaves the rung doing its real job, which is giving the
  // "above here" below something to be above.
  useEffect(() => {
    if (!nodes.length) return;
    const core = nodes.filter((n) => n.row === 0);
    const entry = idx(entryId) >= 0 ? entryId : (core[0]?.id ?? nodes[0].id);
    if (entry !== entryId) setEntryId(entry);
    let sel = idx(selId) >= 0 ? selId : null;
    if (skill) {
      const entryRung = nodes[idx(entry)]?.rung ?? 0;
      const hits = nodes.filter((n) => n.skills.includes(skill));
      sel = (hits.find((n) => n.rung > entryRung) ?? hits[0])?.id ?? sel;
    }
    sel ??= core[Math.min(1, core.length - 1)]?.id ?? nodes[0].id;
    setSelId(sel);
    // Arrived by an "Other directions" pick: that role is the reader's choice,
    // so the map behind the card follows it as it does a click.
    if (jumpTo.current && sel === jumpTo.current) {
      jumpTo.current = null;
      focusRole(nodes[idx(sel)]);
    }
    const t = setTimeout(() => center(idx(sel)), 60);
    return () => clearTimeout(t);
    // Deliberately only on a new model: selection changes centre themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  if (!started) {
    return (
      <CareerPlaceholder
        skills={data?.skills ?? []}
        onClose={onClose}
        onPick={(k) => {
          markCareerStarted();
          setStarted(true);
          setHolding(true);
          setLane(null);
          setSkill(k);
        }}
      />
    );
  }

  if (!data) {
    return (
      <div className="cpcard cploading">
        <CardLoader />
        <div style={{ padding: 24, display: "flex", justifyContent: "space-between" }}>
          <span style={{ font: `600 24px/1.2 ${MONA}`, letterSpacing: "-0.025em" }}>
            Career pathways
          </span>
          <button type="button" className="paneclose" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
      </div>
    );
  }

  const sel = Math.max(0, idx(selId));
  const goal = idx(goalId);
  const n = nodes[sel];
  const sk = skill;
  const adsFor = (o: CardNode) => (sk ? (o.skillLive[sk] ?? 0) : o.ads);
  // The busiest role on the map shown — the top of its glow scale.
  const maxAds = Math.max(0, ...nodes.map(adsFor));

  const go = (i: number | null | undefined) => {
    if (i == null || i < 0 || !nodes[i]) return;
    setSelId(nodes[i].id);
    setScrub(null);
    center(i);
    // Picking a role heats the map behind the card by that role, as a skill
    // search does, on whichever layer is showing (see store.roleFocus). Only
    // on a pick: the card's own opening selection is not the reader's choice.
    focusRole(nodes[i]);
  };
  const nextOf = (i: number) => {
    const kid = nodes.findIndex((o) => o.parent === i);
    return kid >= 0 ? kid : model?.edges.find((e) => e.from === i)?.to;
  };

  const pickSkill = (k: string) => {
    if (k === skill) return clearSkill();
    setPop(false);
    setScrub(null);
    // The server resolves the family that advertises the skill most; the
    // model effect above then selects and centres.
    setLane(null);
    setSkill(k);
  };
  const clearSkill = () => {
    setSkill(null);
    setPop(false);
  };
  /** Open a role on another ladder — an "Other directions" pick. The same
   *  family and lane already on the map is just a selection; anything else
   *  loads that ladder (with the role's lane beside the core) and the model
   *  effect selects it and heats the map for it. */
  const jump = (id: string) => {
    const here = idx(id);
    if (here >= 0) return go(here);
    const [f, track] = id.split("|");
    jumpTo.current = id;
    setPop(false);
    setScrub(null);
    setSkill(null);
    setEntryId(null);
    setFamily(f);
    setLane(track);
    setSelId(id);
  };

  if (!model || !n) {
    return (
      <div className="cpcard">
        <div style={{ padding: 24 }}>No career pathway data for this market yet.</div>
      </div>
    );
  }

  // Route highlight: the selected role's own lane, back to its first rung.
  const route = new Set<number>();
  for (let k: number | null = sel; k != null; k = nodes[k].parent) route.add(k);

  const edges = model.edges.map((e) => {
    const p = nodes[e.from];
    const o = nodes[e.to];
    const on = route.has(e.to) && route.has(e.from);
    let d: string;
    let lx: number;
    let ly: number;
    if (p.row === o.row) {
      const cy = o.y + CH / 2;
      d = `M${p.x + CW} ${cy} H${o.x}`;
      lx = (p.x + CW + o.x) / 2;
      ly = cy;
    } else {
      // Converge: a specialism rejoins the core from below.
      const sy = p.y + CH / 2;
      const tx = o.x + CW / 2;
      d = `M${p.x + CW} ${sy} H${tx - 12} Q${tx} ${sy} ${tx} ${sy - 12} V${o.y + CH}`;
      lx = (p.x + CW + tx - 12) / 2;
      ly = sy;
    }
    return {
      key: `${e.from}-${e.to}`,
      d,
      lx,
      ly,
      label: e.label ?? "",
      stroke: on ? INK : "var(--neutral-300,#c7c7cc)",
      w: on ? 2 : 1.5,
      labelColor: on ? "var(--text-primary,#1c1c1e)" : "var(--text-tertiary,#8e8e93)",
      // The segment runs through the cards' vertical middle, so their bottom
      // edge is CH/2 below it.
      labelTop: ly + CH / 2 + LABEL_DROP,
    };
  });

  const maxCol = Math.max(...nodes.map((o) => o.col));
  const cWn = 48 + maxCol * PX + CW;
  const cHn = ROW0 + (lanes - 1) * ROWH + CH + LABEL_ROOM;

  const sr = n.series ? sparkPath(n.series.counts) : null;
  const up = n.trend ? n.trend.up : true;
  const sparkStroke = !n.trend
    ? "var(--neutral-500,#8e8e93)"
    : up
      ? "var(--status-success-fg)"
      : "var(--status-danger-fg)";
  const trendColor = !n.trend
    ? "var(--text-tertiary,#8e8e93)"
    : up
      ? "var(--status-success-fg)"
      : "var(--status-danger-fg)";
  const N = sr ? sr.N : 1;
  const k = Math.min(N - 1, scrub ?? N - 1);
  const dayAt =
    sr && n.series
      ? new Date(Date.parse(`${n.series.from}T00:00:00Z`) + k * 864e5).toISOString().slice(0, 10)
      : null;
  const scrubVal =
    sr && n.series && !sk
      ? `${num(n.series.counts[k])} ads`
      : `${num(adsFor(n))} ${sk ? "live ads with skill" : "live ads"}`;
  const scrubLabel =
    sr && dayAt ? (k === N - 1 ? `AS AT ${dayLabel(dayAt)}` : dayLabel(dayAt)) : "";

  const list = n.hubs;
  const max = list[0]?.n || 1;
  const tot = list.reduce((a, h) => a + h.n, 0) || 1;
  const hubs = list.map((h, i) => {
    const [x, y] = projectHotspot(h.lon, h.lat);
    const t = h.n / max;
    const r = 12 + Math.sqrt(t) * 26;
    return {
      ...h,
      x,
      y,
      left: `${x / 3}%`,
      top: `${y / 2}%`,
      color:
        t > 0.66
          ? "rgb(204,56,51)"
          : t > 0.33
            ? "rgb(242,140,46)"
            : t > 0.12
              ? "rgb(235,190,56)"
              : "rgb(56,160,110)",
      fade: t < 0.08 ? 0.55 : 1,
      halo: r,
      heat: (0.35 + 0.65 * Math.sqrt(t)).toFixed(2),
      haloVals: `${(r * 0.92).toFixed(1)};${(r * 1.12).toFixed(1)};${(r * 0.92).toFixed(1)}`,
      dur: `${(3.4 - 1.2 * t).toFixed(2)}s`,
      delay: `${(i * 0.3).toFixed(2)}s`,
    };
  });
  const hv = hubs.find((h) => h.name === hub);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const o = nodes[sel];
    if (e.key === "ArrowLeft") go(o.parent);
    if (e.key === "ArrowRight") go(nextOf(sel));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const d = e.key === "ArrowDown" ? 1 : -1;
      const t = nodes.findIndex((x) => x.col === o.col && x.row === o.row + d);
      if (t >= 0) {
        e.preventDefault();
        go(t);
      }
    }
  };

  const zoomBy = (f: number) => {
    const el = mapRef.current;
    if (!el) return;
    const z2 = Math.max(0.55, Math.min(1.3, +(z * f).toFixed(2)));
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setZ(z2);
    setAnim(true);
    setPan({ x: cx - ((cx - pan.x) * z2) / z, y: cy - ((cy - pan.y) * z2) / z });
  };

  const iconBtn: CSSProperties = {
    all: "unset",
    cursor: "pointer",
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fff",
  };
  const stepBtn: CSSProperties = {
    all: "unset",
    cursor: "pointer",
    width: 32,
    height: 32,
    borderRadius: 999,
    border: "1px solid var(--border-default,#d1d1d6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div className="cpcard" tabIndex={0} onKeyDown={onKey}>
      {/* Also while the first skill's map is still the previous model held
          as placeholder data, so it never flashes the default family. */}
      {(holding || isPlaceholderData) && <CardLoader />}
      <div style={{ padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ font: `600 24px/1.2 ${MONA}`, letterSpacing: "-0.025em" }}>
            Career pathways
          </span>
          <button type="button" className="paneclose" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <CareerSearch skills={data.skills} selected={sk} onPick={pickSkill} onClear={clearSkill} />
      </div>

      <div style={{ padding: "20px 24px 0" }}>
        <div
          ref={mapRef}
          onClick={() => !dragged.current && pop && setPop(false)}
          onPointerDown={(e) => {
            if (e.button) return;
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          }}
          onPointerMove={(e) => {
            const g = drag.current;
            if (!g || !e.buttons) return;
            const dx = e.clientX - g.x;
            const dy = e.clientY - g.y;
            if (!g.moved && Math.hypot(dx, dy) < 4) return;
            g.moved = true;
            setAnim(false);
            setDragging(true);
            setPan({ x: g.px + dx, y: g.py + dy });
          }}
          onPointerUp={() => endDrag()}
          onPointerLeave={() => endDrag()}
          style={{
            position: "relative",
            height: 300,
            borderRadius: 14,
            overflow: "hidden",
            backgroundColor: "var(--surface-subtle,#f4f4f5)",
            backgroundImage: "radial-gradient(circle, rgba(28,28,30,.13) 1px, transparent 1.3px)",
            backgroundSize: "16px 16px",
            border: "1px solid var(--border-subtle,#e5e5ea)",
            cursor: dragging ? "grabbing" : "grab",
            touchAction: "none",
            userSelect: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: cWn,
              height: cHn,
              transformOrigin: "0 0",
              transform: `translate(${pan.x.toFixed(1)}px, ${pan.y.toFixed(1)}px) scale(${z})`,
              transition: anim ? "transform 360ms cubic-bezier(.2,0,0,1)" : "none",
            }}
          >
            {model.lanes.map((l) => (
              <span
                key={l.row}
                style={{
                  position: "absolute",
                  left: 24,
                  top: ROW0 + l.row * ROWH - 20,
                  font: `500 10px/1 ${INTER}`,
                  letterSpacing: ".1em",
                  color: "var(--text-tertiary,#8e8e93)",
                  whiteSpace: "nowrap",
                }}
              >
                {l.text}
              </span>
            ))}
            <svg
              width={cWn}
              height={cHn}
              style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
            >
              {edges.map((g) => (
                <g key={g.key}>
                  <path
                    d={g.d}
                    fill="none"
                    style={{ stroke: g.stroke, transition: "stroke 200ms" }}
                    strokeWidth={g.w}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {g.label && (
                    // The label hangs under the cards; this ties it back up to
                    // the step it names.
                    <line
                      x1={g.lx}
                      y1={g.ly + 4}
                      x2={g.lx}
                      y2={g.labelTop - 4}
                      style={{ stroke: g.stroke, transition: "stroke 200ms" }}
                      strokeWidth="1"
                    />
                  )}
                  <circle
                    cx={g.lx}
                    cy={g.ly}
                    r="4"
                    style={{ fill: "#fff", stroke: g.stroke, transition: "stroke 200ms" }}
                    strokeWidth="1.5"
                  />
                </g>
              ))}
            </svg>
            {edges.map((g) => (
              <span
                key={g.key}
                // BELOW the two cards, centred on the gap, with a line up to
                // the step's dot. It used to sit in the 72px gap itself, where
                // the cards (drawn later) covered its ends and a two-word skill
                // read "Leadership &…". Hanging it under the cards gives it
                // PX − CW + 32 = 104px — wide enough that the longest labels
                // take two lines — while keeping clear of the "Set as goal?"
                // button, which sits under the selected card's middle.
                style={{
                  position: "absolute",
                  zIndex: 1,
                  left: g.lx,
                  top: g.labelTop,
                  width: PX - CW + 32,
                  transform: "translateX(-50%)",
                  textAlign: "center",
                  font: `500 10px/1.2 ${INTER}`,
                  color: g.labelColor,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                  pointerEvents: "none",
                }}
              >
                {g.label}
              </span>
            ))}
            {nodes.map((o, i) => {
              const isSel = i === sel;
              const isGoal = i === goal;
              // NO "YOU" BADGE. It used to sit on the ladder's entry rung, and
              // it was a claim about the reader that nothing in this product
              // knows: there is no profile, no stated role, no signal of where
              // anyone is in their own career. It read as personalised and was
              // the first core role of whatever map the skill opened, the same
              // for every visitor. GOAL stays — the reader sets that themselves.
              const tags: string[] = [];
              if (isGoal) tags.push("GOAL");
              return (
                <button
                  key={o.id}
                  type="button"
                  className="cpnode"
                  aria-label={o.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragged.current) return;
                    go(i);
                    setPop(true);
                  }}
                  style={{
                    left: o.x,
                    top: o.y,
                    border: isGoal
                      ? `1.5px dashed ${INK}`
                      : "1px solid var(--border-subtle,#e5e5ea)",
                    ...glowStyle(adsFor(o), maxAds),
                    boxShadow: isSel
                      ? `0 0 0 2px ${INK}, var(--shadow-md), var(--cpglow)`
                      : "var(--shadow-xs), var(--cpglow)",
                    opacity: sk && !o.skills.includes(sk) ? 0.4 : 1,
                  }}
                >
                  <span style={{ display: "flex", gap: 4, height: 17, alignItems: "center" }}>
                    {tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          font: `600 9px/1 ${INTER}`,
                          letterSpacing: ".08em",
                          padding: "4px 6px",
                          borderRadius: 999,
                          background: "var(--surface-sunken,#ebebef)",
                          color: "var(--text-primary,#1c1c1e)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                  <span
                    style={{
                      font: `600 13px/1.25 ${MONA}`,
                      letterSpacing: "-0.01em",
                      color: "var(--text-primary,#1c1c1e)",
                      textWrap: "balance",
                    }}
                  >
                    {o.title}
                  </span>
                  <span
                    style={{
                      marginTop: "auto",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 6,
                      font: `500 11px/1 ${INTER}`,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--text-tertiary,#8e8e93)",
                    }}
                  >
                    <span style={{ color: "var(--text-secondary,#636366)" }}>{o.payLabel}</span>
                    <span>{`${num(adsFor(o))} ads`}</span>
                  </span>
                </button>
              );
            })}
            {n.moves.length > 0 && <MoveBranch key={n.id} node={n} onPick={jump} />}
            {pop && (
              <div
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  zIndex: 5,
                  left: n.x + CW / 2,
                  top: n.row === 0 ? n.y + CH + 10 : n.y - 10,
                  transform: n.row === 0 ? "translateX(-50%)" : "translate(-50%, -100%)",
                  boxSizing: "border-box",
                  padding: 6,
                  display: "flex",
                  background: "#fff",
                  borderRadius: 14,
                  border: "1px solid var(--border-subtle,#e5e5ea)",
                  boxShadow: "var(--shadow-lg)",
                  cursor: "default",
                }}
              >
                <button
                  type="button"
                  className="cpgoal"
                  onClick={() => requestCareerGoal(goal === sel ? null : n.id, n.title)}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {goal === sel && (
                      <span key={`tick-${n.id}`} className="cptick">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M5 12.5l4.5 4.5L19 7.5"
                            stroke="#fff"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray="22"
                          />
                        </svg>
                      </span>
                    )}
                    <span>{goal === sel ? "Goal set" : "Set as goal?"}</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              display: "flex",
              gap: 6,
              pointerEvents: "none",
            }}
          >
            <span
              className="cpdraghint"
              style={{
                padding: "5px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,.85)",
                font: `500 9px/1 ${INTER}`,
                letterSpacing: ".1em",
                color: "var(--text-tertiary,#8e8e93)",
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              DRAG TO EXPLORE
            </span>
            {/* The key to the cards' glow: the globe's own heat legend. Labelled
              DEMAND, but measured in ads — live ads relative to the busiest
              role on this map (or, with a skill searched, the ads naming it);
              see glowStyle. The label changed, the measure did not. */}
            <span
              style={{
                padding: "5px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,.85)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  font: `500 9px/1 ${INTER}`,
                  letterSpacing: ".08em",
                  color: "var(--text-tertiary,#8e8e93)",
                }}
              >
                {sk ? "SKILL DEMAND" : "DEMAND"}
              </span>
              <span
                style={{
                  font: `500 9px/1 ${INTER}`,
                  letterSpacing: ".08em",
                  color: "var(--text-secondary,#636366)",
                }}
              >
                LOW
              </span>
              <span
                style={{ width: 56, height: 5, borderRadius: 999, background: heatGradientCss() }}
              />
              <span
                style={{
                  font: `500 9px/1 ${INTER}`,
                  letterSpacing: ".08em",
                  color: "var(--text-secondary,#636366)",
                }}
              >
                HIGH
              </span>
            </span>
          </div>
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              right: 10,
              bottom: 10,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              background: "var(--border-subtle,#e5e5ea)",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <button
              type="button"
              className="cphover"
              aria-label="Zoom in"
              style={iconBtn}
              onClick={() => zoomBy(1.18)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              className="cphover"
              aria-label="Zoom out"
              style={iconBtn}
              onClick={() => zoomBy(1 / 1.18)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              className="cphover"
              aria-label="Centre on selected role"
              style={iconBtn}
              onClick={() => center(sel)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3" />
                <path d="M12 19v3" />
                <path d="M2 12h3" />
                <path d="M19 12h3" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span style={EYEBROW}>{n.stageOf}</span>
            <span style={{ font: `600 22px/1.2 ${MONA}`, letterSpacing: "-0.02em" }}>
              {n.title}
            </span>
            <span
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                color: "var(--text-secondary,#636366)",
                textWrap: "pretty",
              }}
            >
              {n.desc}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4, flex: "none" }}>
            <button
              type="button"
              className="cphover"
              aria-label="Previous stage"
              style={stepBtn}
              onClick={() => go(n.parent)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="cphover"
              aria-label="Next stage"
              style={stepBtn}
              onClick={() => go(nextOf(sel))}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>

        <div
          className="cpstats"
          style={{
            display: "grid",
            gap: 1,
            background: "var(--border-subtle,#e5e5ea)",
            border: "1px solid var(--border-subtle,#e5e5ea)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {[
            ["MEDIAN PAY", n.payLabel],
            ["EMPLOYERS", num(n.employers)],
            ["DAYS ADVERTISED", n.daysAdvertised != null ? `${n.daysAdvertised} days` : "—"],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                background: "var(--surface-page,#fff)",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span style={TILE_LABEL}>{label}</span>
              <span style={TILE_VALUE}>{value}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                // Wraps, unlike the design's row: "27 live ads with skill" plus
                // a trend that names its span ("−20% · 40D") plus the date is
                // wider than a 300px column, and nowrap ran it into the
                // hotspot heading beside it.
                flexWrap: "wrap",
                rowGap: 6,
                columnGap: 12,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={TILE_VALUE}>{scrubVal}</span>
                <span
                  style={{
                    font: `500 12px/1 ${INTER}`,
                    fontVariantNumeric: "tabular-nums",
                    color: trendColor,
                  }}
                >
                  {n.trend
                    ? `${n.trend.label} · ${n.trend.days}D`
                    : n.series
                      ? "TOO THIN FOR A TREND"
                      : ""}
                </span>
              </span>
              <span style={{ ...EYEBROW, letterSpacing: ".06em" }}>
                {scrubLabel || "NO COVERED SERIES"}
              </span>
            </div>
            <div
              onMouseMove={(e) => {
                if (!sr) return;
                const r = e.currentTarget.getBoundingClientRect();
                setScrub(
                  Math.round(
                    Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width * 0.96))) * (N - 1),
                  ),
                );
              }}
              onMouseLeave={() => setScrub(null)}
              style={{ position: "relative", flex: 1, minHeight: 110, cursor: "crosshair" }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 300 72"
                preserveAspectRatio="none"
                style={{ display: "block" }}
              >
                <defs>
                  <linearGradient id={`sparkgrad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" style={{ stopColor: sparkStroke, stopOpacity: 0.38 }} />
                    <stop offset="1" style={{ stopColor: sparkStroke, stopOpacity: 0 }} />
                  </linearGradient>
                </defs>
                {sr && (
                  <>
                    <path d={sr.area} fill={`url(#sparkgrad-${uid})`} stroke="none" />
                    <path
                      d={sr.line}
                      fill="none"
                      style={{ stroke: sparkStroke }}
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
              </svg>
              {sr && scrub == null && (
                <>
                  <span
                    style={{
                      position: "absolute",
                      width: 28,
                      height: 28,
                      margin: "-14px 0 0 -14px",
                      borderRadius: 999,
                      background: sparkStroke,
                      opacity: 0.2,
                      left: "96%",
                      top: `${(sr.ys[N - 1] / 72) * 100}%`,
                      pointerEvents: "none",
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      width: 14,
                      height: 14,
                      margin: "-7px 0 0 -7px",
                      borderRadius: 999,
                      background: sparkStroke,
                      border: "3px solid #fff",
                      boxSizing: "border-box",
                      left: "96%",
                      top: `${(sr.ys[N - 1] / 72) * 100}%`,
                      pointerEvents: "none",
                    }}
                  />
                </>
              )}
              {sr && scrub != null && (
                <>
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: "var(--border-strong,#aeaeb2)",
                      left: `${(k / Math.max(1, N - 1)) * 96}%`,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      width: 14,
                      height: 14,
                      margin: "-7px 0 0 -7px",
                      borderRadius: 999,
                      background: sparkStroke,
                      border: "3px solid #fff",
                      boxSizing: "border-box",
                      boxShadow: "0 0 0 7px var(--surface-page,#fff)",
                      left: `${(k / Math.max(1, N - 1)) * 96}%`,
                      top: `${(sr.ys[k] / 72) * 100}%`,
                    }}
                  />
                  {/* The Trending card's tooltip (.tsktip), so every chart in
                      the app labels a point the same way. The series is the
                      ROLE's ads per day, even with a skill searched — the
                      archive has no per-skill daily series for a rung — so
                      the label says "ads", never "with skill". */}
                  <span
                    className={`tsktip${k / Math.max(1, N - 1) > 0.8 ? " end" : k / Math.max(1, N - 1) < 0.2 ? " start" : ""}`}
                    style={{
                      left: `${(k / Math.max(1, N - 1)) * 96}%`,
                      top: `${(sr.ys[k] / 72) * 100}%`,
                    }}
                  >
                    {`${num(n.series!.counts[k])} ads · ${dayAt ? dayLabel(dayAt) : ""}`}
                  </span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span style={EYEBROW}>HIRING HOTSPOTS · LIVE ADS</span>
              <span style={{ ...EYEBROW, letterSpacing: ".06em" }}>
                {`${list.length} ${list.length === 1 ? "CITY" : "CITIES"}`}
              </span>
            </div>
            <div
              onMouseLeave={() => setHub(null)}
              style={{
                position: "relative",
                aspectRatio: "3/2",
                background: "var(--surface-subtle,#f4f4f5)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <svg viewBox="0 0 300 200" width="100%" height="100%" style={{ display: "block" }}>
                <defs>
                  <radialGradient id={`heatdot-${uid}`}>
                    <stop offset="0" stopColor="#000" stopOpacity="1" />
                    <stop offset="0.45" stopColor="#000" stopOpacity="0.55" />
                    <stop offset="1" stopColor="#000" stopOpacity="0" />
                  </radialGradient>
                  <filter
                    id={`heatcolor-${uid}`}
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                    colorInterpolationFilters="sRGB"
                  >
                    <feColorMatrix
                      type="matrix"
                      values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0"
                    />
                    <feComponentTransfer>
                      <feFuncR type="table" tableValues="0.20 0.30 0.62 0.98 0.95 0.80" />
                      <feFuncG type="table" tableValues="0.70 0.75 0.82 0.78 0.45 0.22" />
                      <feFuncB type="table" tableValues="0.50 0.45 0.35 0.22 0.18 0.20" />
                      <feFuncA type="table" tableValues="0 0.42 0.58 0.68 0.76 0.82" />
                    </feComponentTransfer>
                  </filter>
                </defs>
                <rect width="300" height="200" style={{ fill: "oklch(0.9 0.045 225)" }} />
                <path
                  d={CAREER_LAND_PATH}
                  style={{
                    fill: "oklch(0.975 0.018 135)",
                    stroke: "oklch(0.86 0.04 180)",
                    strokeWidth: 0.5,
                  }}
                />
                <g filter={`url(#heatcolor-${uid})`}>
                  {hubs.map((c) => (
                    <circle
                      key={c.id}
                      cx={c.x}
                      cy={c.y}
                      r={c.halo}
                      fill={`url(#heatdot-${uid})`}
                      opacity={c.heat}
                    >
                      <animate
                        attributeName="r"
                        values={c.haloVals}
                        dur={c.dur}
                        begin={c.delay}
                        repeatCount="indefinite"
                        calcMode="spline"
                        keyTimes="0;0.5;1"
                        keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
                      />
                    </circle>
                  ))}
                </g>
              </svg>
              {hubs.map((c) => (
                <span
                  key={c.id}
                  onMouseEnter={() => setHub(c.name)}
                  style={{
                    position: "absolute",
                    left: c.left,
                    top: c.top,
                    width: 9,
                    height: 9,
                    margin: "-4.5px 0 0 -4.5px",
                    borderRadius: 999,
                    boxSizing: "border-box",
                    border: "2px solid #fff",
                    background: c.color,
                    boxShadow: "0 1px 2px rgba(28,28,30,.3)",
                    opacity: c.fade,
                    cursor: "pointer",
                  }}
                />
              ))}
              {hubs.slice(0, 4).map((c) => (
                <span
                  key={c.id}
                  onMouseEnter={() => setHub(c.name)}
                  style={{
                    position: "absolute",
                    left: c.left,
                    top: c.top,
                    transform: "translate(-50%,-100%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    cursor: "pointer",
                    paddingBottom: 4,
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      background: "#fff",
                      boxShadow: `0 1px 3px rgba(28,28,30,.22), 0 0 0 ${hub === c.name ? "2px" : "0px"} var(--neutral-900,#1c1c1e)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: `600 8.5px/1 ${INTER}`,
                      letterSpacing: ".02em",
                      color: "var(--text-primary,#1c1c1e)",
                    }}
                  >
                    {c.code}
                  </span>
                  <span
                    style={{
                      width: 1.5,
                      height: 7,
                      background: "#fff",
                      boxShadow: "0 1px 1px rgba(28,28,30,.2)",
                    }}
                  />
                </span>
              ))}
              {hv && (
                <span
                  style={{
                    position: "absolute",
                    zIndex: 2,
                    pointerEvents: "none",
                    left: hv.left,
                    top: hv.top,
                    // Kept inside the map, which clips (overflow hidden): a
                    // city near the left edge anchors the callout's left side
                    // to its dot, one near the right its right side, and one
                    // in the bottom quarter opens upwards. Centred-below cut
                    // Perth's in half.
                    transform: `translate(${hv.x < 75 ? "-14px" : hv.x > 225 ? "calc(-100% + 14px)" : "-50%"}, ${hv.y > 150 ? "calc(-100% - 10px)" : "10px"})`,
                    background: "var(--neutral-900,#1c1c1e)",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    whiteSpace: "nowrap",
                    boxShadow: "var(--shadow-md)",
                  }}
                >
                  <span style={{ font: `600 12px/1 ${MONA}` }}>{hv.name}</span>
                  <span
                    style={{ font: `500 10px/1 ${INTER}`, letterSpacing: ".06em", opacity: 0.75 }}
                  >
                    {`${num(hv.n)} ADS · ${Math.round((hv.n / tot) * 100)}%`}
                  </span>
                </span>
              )}
              <span
                style={{
                  position: "absolute",
                  left: 10,
                  bottom: 10,
                  padding: "5px 7px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,.8)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    font: `500 9px/1 ${INTER}`,
                    letterSpacing: ".08em",
                    color: "var(--text-secondary,#636366)",
                  }}
                >
                  LOW
                </span>
                <span
                  style={{
                    width: 56,
                    height: 5,
                    borderRadius: 999,
                    background:
                      "linear-gradient(90deg, rgb(77,191,128), rgb(250,199,56), rgb(242,115,46), rgb(204,56,51))",
                  }}
                />
                <span
                  style={{
                    font: `500 9px/1 ${INTER}`,
                    letterSpacing: ".08em",
                    color: "var(--text-secondary,#636366)",
                  }}
                >
                  HIGH
                </span>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.slice(0, 3).map((h) => (
                <div
                  key={h.id}
                  onMouseEnter={() => setHub(h.name)}
                  onMouseLeave={() => setHub(null)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px minmax(0,1fr) 44px",
                    alignItems: "center",
                    gap: 8,
                    cursor: "default",
                  }}
                >
                  <span
                    style={{ font: `500 12px/1 ${MONA}`, color: "var(--text-primary,#1c1c1e)" }}
                  >
                    {h.name}
                  </span>
                  <span
                    style={{
                      height: 4,
                      borderRadius: 999,
                      background: "var(--neutral-200,#e5e5ea)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        borderRadius: 999,
                        background: "var(--neutral-900,#1c1c1e)",
                        width: `${Math.round((h.n / max) * 100)}%`,
                      }}
                    />
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      font: `500 11px/1 ${INTER}`,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--text-secondary,#636366)",
                    }}
                  >
                    {`${Math.round((h.n / tot) * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <OnetSection id={n.id} />
      </div>
    </div>
  );

  function endDrag() {
    const g = drag.current;
    drag.current = null;
    if (g && g.moved) {
      dragged.current = true;
      setTimeout(() => {
        dragged.current = false;
      }, 0);
    }
    if (dragging) setDragging(false);
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * The card's skill search, built from the CENTRAL search bar rather than the
 * design's pill (GlobalSearch): the same pill, lens-and-handle icon, clear ×
 * and Search button; the same dropdown of skills as you type, each with its
 * demand badge (demandLevel — "HIGH", "LOW · WITHIN RISK & COMPLIANCE") and a
 * Follow button. One search behaviour in the product, not two. No chips under
 * it: the design's row of popular skills was removed once the dropdown could
 * do the finding.
 *
 * What differs is only what a result can open. The suggestions are the
 * central bar's own matches — searchSkillMatches by name, then describeSkills
 * for "describe it in your own words" — kept to the skills that sit on some
 * career map in this market, so nothing offered here opens an empty card.
 * Enter with nothing matched asks the server (searchCareerSkills), which reads
 * the words with the taxonomy matcher the ads were tagged with.
 */
// ── The first-open placeholder ───────────────────────────────────────────────

/** A faded role card on the ghost map. */
/**
 * "Other directions", drawn on the map: a small pill of icons centred on the
 * selected card's edge, one per role on ANOTHER ladder it relates to
 * (careerCard.careerMoves). It sits on the edge the "Set as goal?" button does
 * not use — the top on the core lane, the bottom below it.
 *
 * The figures live in the hover card, not on the map. The link is O*NET's and
 * the overlap and shared-employer counts are ours; nothing on it says people
 * make the move — the archive holds ads, not careers. The visible caveat line
 * was removed at the user's request 2026-09-30; each icon's accessible label
 * still carries it.
 */
function MoveBranch({ node, onPick }: { node: Placed; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = node.row === 0;
  const m = hover != null ? node.moves[hover] : null;
  return (
    <div
      className={`cpbranch${top ? "" : " below"}${m ? " tipping" : ""}`}
      style={{ left: node.x + CW / 2, top: top ? node.y : node.y + CH }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseLeave={() => setHover(null)}
    >
      <span className="cpbranchlbl" title="Other paths: related roles on other ladders">
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor">
          <path d="M6 20V9a5 5 0 0 1 5-5h7" />
          <path d="M15 1l3 3-3 3" />
          <path d="M6 13a5 5 0 0 1 5-5h2" />
        </svg>
      </span>
      {node.moves.map((mv, i) => (
        <button
          key={mv.id}
          type="button"
          className={`cpbranchbtn${hover === i ? " on" : ""}`}
          aria-label={`${mv.title}, ${mv.where}. ${Math.round(mv.overlap * 100)}% skills shared. Related occupation per O*NET, not a tracked career move.`}
          onMouseEnter={() => setHover(i)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          onClick={() => onPick(mv.id)}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor">
            {(
              SKILL_ICONS[skillIcon(mv.skill ?? "", mv.skill ? SKILL_PARENT[mv.skill] : null)] ?? []
            ).map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </button>
      ))}
      {m && (
        <div className={`cpbranchtip${top ? "" : " up"}`} role="tooltip">
          <span className="cpbranchtitle">{m.title}</span>
          <span className="cpbranchwhere">{`${m.where} · ${m.stage}`}</span>
          <span className="cpbranchfigs">
            {`${Math.round(m.overlap * 100)}% skills shared · `}
            {m.sharedEmployers
              ? `${m.sharedEmployers} employer${m.sharedEmployers === 1 ? "" : "s"} hire both`
              : "no shared employers on the map"}
            {m.payLabel === "—" ? "" : ` · ${m.payLabel} median`}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * What the role typically involves, from the O*NET occupation it was mapped
 * to. Kept visibly apart from everything above it: those figures are counts
 * over our ads, and this is O*NET's description of a US occupation — so it
 * names the occupation, links to it, and carries the CC BY credit.
 */
function OnetSection({ id }: { id: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["onet", id],
    queryFn: () => onetForRole(id),
    staleTime: Infinity,
  });
  const [allTasks, setAllTasks] = useState(false);
  useEffect(() => setAllTasks(false), [id]);
  if (isPending) return null;

  // THE CREDIT IS A LICENCE CONDITION, NOT DECORATION (see lib/onet.ts): O*NET
  // is CC BY 4.0, which requires naming the creator and the licence wherever
  // the content travels. So the card's O*NET wording was cut down rather than
  // removed — the job-zone sentence and the "describes the US occupation this
  // role maps to" explanation are gone, and this one line stays.
  //
  // It absorbs the occupation link the header used to carry: "O*NET 31.0" now
  // points at the specific occupation, which keeps CC BY's link-to-the-material
  // while removing a second visible element from the card.
  const credit = (
    <span className="cponetcredit">
      <a href={onetUrl(data?.soc ?? "")} target="_blank" rel="noreferrer">
        {"O*NET "}
        {data?.version ?? ""}
      </a>
      {" · U.S. Dept. of Labor/ETA · "}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
        CC BY 4.0
      </a>
    </span>
  );
  if (!data) {
    return (
      <section className="cponet" aria-label="Tasks and tools">
        <div className="cponethead">
          <span style={EYEBROW}>TASKS &amp; TOOLS</span>
        </div>
        <p className="cponetnone">
          No single O*NET occupation matches this role closely enough to describe it — the titles it
          covers span several occupations, or none has a US counterpart.
        </p>
      </section>
    );
  }
  const o = data.occupation;
  const tasks = allTasks ? o.tasks : o.tasks.slice(0, 3);
  return (
    <section className="cponet" aria-label="Tasks and tools">
      {/* The occupation's name used to sit here as "O*NET: Human Resources
          Specialists". Removed — it repeated in the credit line's link, and on
          a card of measured figures a second proper noun read as another
          heading rather than as a source. */}
      <div className="cponethead">
        <span style={EYEBROW}>TASKS &amp; TOOLS</span>
      </div>
      <ul className="cponettasks">
        {tasks.map(([t]) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {o.tasks.length > 3 && (
        <button type="button" className="cponetmore" onClick={() => setAllTasks((v) => !v)}>
          {allTasks ? "Fewer tasks" : `All ${o.tasks.length} core tasks`}
        </button>
      )}
      {o.software.length > 0 && (
        <div className="cponetsw">
          <span style={TILE_LABEL}>SOFTWARE IN DEMAND IN US JOB POSTINGS</span>
          <div className="cponetchips">
            {o.software.map((w) => (
              <span key={w} className="cponetchip">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="cponetnote">{credit}</p>
    </section>
  );
}

function GhostNode({ left, top, a, b }: { left: number; top: number; a: string; b: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: 168,
        height: 96,
        boxSizing: "border-box",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "rgba(255,255,255,.7)",
        borderRadius: 12,
        border: "1px solid var(--border-subtle,#e5e5ea)",
      }}
    >
      <span style={{ height: 8, width: a, borderRadius: 4, background: "#ebebef" }} />
      <span style={{ height: 8, width: b, borderRadius: 4, background: "#ebebef" }} />
      <span
        style={{
          marginTop: "auto",
          height: 6,
          width: "30%",
          borderRadius: 4,
          background: "#f2f2f5",
        }}
      />
    </div>
  );
}

const SearchGlyph = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const FEATURES: { title: string; sub: string; icon: React.ReactNode }[] = [
  {
    title: "Pathway map",
    sub: "Roles that use the skill, and the steps between them",
    icon: (
      <>
        <rect x="3" y="4" width="6" height="5" rx="1.5" />
        <rect x="15" y="4" width="6" height="5" rx="1.5" />
        <rect x="15" y="15" width="6" height="5" rx="1.5" />
        <path d="M9 6.5h6" />
        <path d="M6 9v6.5a1 1 0 0 0 1 1h8" />
      </>
    ),
  },
  {
    title: "Demand",
    sub: "Live job ads, pay and days to fill for each role",
    icon: (
      <>
        <path d="M3 17l5-5 4 4 8-8" />
        <path d="M15 8h5v5" />
      </>
    ),
  },
  {
    title: "Hiring hotspots",
    sub: "The cities hiring for it most",
    icon: (
      <>
        <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </>
    ),
  },
];

/**
 * "Start with a skill" — `Career_Pathway_Placeholder.html`, as drawn: the
 * card's own header and search, a ghost pathway map behind the prompt, and
 * what the card will show once a skill is picked. The search is the card's
 * real one (CareerSearch), so picking a skill here is exactly picking one on
 * the map. The close button is the one addition; the pane needs a way out.
 */
function CareerPlaceholder({
  skills,
  onPick,
  onClose,
}: {
  skills: string[];
  onPick: (skill: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="cpcard">
      <div style={{ padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ font: `600 24px/1.2 ${MONA}`, letterSpacing: "-0.025em" }}>
            Career pathways
          </span>
          <button type="button" className="paneclose" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <CareerSearch skills={skills} selected={null} onPick={onPick} onClear={() => undefined} />
      </div>

      <div style={{ padding: "20px 24px 0" }}>
        <div
          style={{
            position: "relative",
            height: 300,
            borderRadius: 14,
            overflow: "hidden",
            backgroundColor: "var(--surface-subtle,#f4f4f5)",
            backgroundImage: "radial-gradient(circle, rgba(28,28,30,.13) 1px, transparent 1.3px)",
            backgroundSize: "16px 16px",
            border: "1px solid var(--border-subtle,#e5e5ea)",
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 632 300"
            preserveAspectRatio="xMidYMid slice"
            style={{ position: "absolute", inset: 0, display: "block" }}
            aria-hidden
          >
            <path
              d="M152 88 H232 M400 88 H480"
              fill="none"
              stroke="#d1d1d6"
              strokeWidth="1.5"
              strokeDasharray="4 5"
              strokeLinecap="round"
            />
            <path
              d="M316 136 V200 Q316 212 328 212 H400"
              fill="none"
              stroke="#d1d1d6"
              strokeWidth="1.5"
              strokeDasharray="4 5"
              strokeLinecap="round"
            />
          </svg>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: "calc(50% - 316px)",
              top: 40,
              width: 632,
              height: 260,
              pointerEvents: "none",
            }}
          >
            <GhostNode left={-16} top={0} a="70%" b="45%" />
            <GhostNode left={232} top={0} a="62%" b="40%" />
            <GhostNode left={480} top={0} a="66%" b="48%" />
            <GhostNode left={400} top={124} a="58%" b="38%" />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background:
                "radial-gradient(ellipse 60% 70% at 50% 55%, rgba(244,244,245,.96) 30%, rgba(244,244,245,0) 100%)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                maxWidth: 320,
                textAlign: "center",
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  background: "#1c1c1e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  boxShadow: "var(--shadow-md)",
                }}
              >
                <SearchGlyph size={18} />
              </span>
              <span style={{ font: `600 17px/1.25 ${MONA}`, letterSpacing: "-0.015em" }}>
                Start with a skill
              </span>
              <span
                style={{
                  font: `400 14px/1.5 ${INTER}`,
                  color: "var(--text-secondary,#636366)",
                  textWrap: "pretty",
                }}
              >
                Search for a skill you have or want to build. We’ll map the roles that use it and
                where they lead.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 24px 24px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            borderRadius: 14,
            background: "#fafafa",
            border: "1px solid var(--border-subtle,#e5e5ea)",
          }}
        >
          {FEATURES.map((f) => (
            <span
              key={f.title}
              style={{
                display: "grid",
                gridTemplateColumns: "28px minmax(0,1fr)",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "#1c1c1e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {f.icon}
                </svg>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ font: `600 13px/1.2 ${MONA}` }}>{f.title}</span>
                <span style={{ font: `400 12.5px/1.4 ${INTER}`, color: "#8e8e93" }}>{f.sub}</span>
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CareerSearch({
  skills,
  selected,
  onPick,
  onClear,
}: {
  skills: string[];
  selected: string | null;
  onPick: (skill: string) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState(selected ?? "");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [missed, setMissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const globalOut = useAppStore((s) => s.globalOut);
  const skillIndex = useAppStore((s) => s.skillIndex);
  const demandMode = useAppStore((s) => s.demandMode);
  const followedSkills = useAppStore((s) => s.followedSkills);
  const requestFollowSkill = useAppStore((s) => s.requestFollowSkill);
  const ontologyReady = useOntologyReady();

  // The field shows the picked skill, as the central bar does.
  useEffect(() => setText(selected ?? ""), [selected]);
  // Opened from the rail, the card is where the user is about to type.
  useEffect(() => inputRef.current?.focus(), []);

  const q = text.trim().toLowerCase();
  const onMap = useMemo(() => new Set(skills), [skills]);
  const results = useMemo(() => {
    if (!q || (selected && q === selected.toLowerCase())) return [];
    const matches = searchSkillMatches(q).filter((m) => onMap.has(m.skill));
    const direct = matches.map((m) => m.skill);
    const parentOf = new Map(matches.filter((m) => m.parent).map((m) => [m.skill, m.parent!]));
    const described = ontologyReady
      ? describeSkills(text).filter((sk) => onMap.has(sk) && !direct.includes(sk))
      : [];
    return [...direct, ...described].slice(0, 7).map((sk) => {
      const badge = demandLevel(sk, globalOut, skillIndex, demandMode);
      const parent = parentOf.get(sk) ?? SKILL_PARENT[sk];
      return {
        skill: sk,
        sub: parent ? `${badge.label} · within ${parent}` : badge.label,
        tone: badge.tone,
      };
    });
  }, [q, text, selected, onMap, ontologyReady, globalOut, skillIndex, demandMode]);

  const pick = (sk: string) => {
    setMissed(false);
    setActive(0);
    onPick(sk);
    inputRef.current?.blur();
  };
  const submit = async () => {
    if (!q) return;
    if (results[0]) return pick(results[Math.min(active, results.length - 1)].skill);
    const hits = await searchCareerSkills({ data: { q: text } });
    if (hits[0]) pick(hits[0]);
    else setMissed(true);
  };
  const clear = () => {
    setText("");
    setMissed(false);
    if (selected) onClear();
    inputRef.current?.focus();
  };

  const skillActive = !!selected && q === selected.toLowerCase();
  const showSuggest = focused && !!q && !skillActive && !missed;

  return (
    <div className="cpsearchwrap">
      <div className={`gsearchbar ${focused ? "on" : ""}`}>
        <svg
          className="gsicon"
          viewBox="0 0 24 24"
          width={19}
          height={19}
          fill="none"
          stroke="currentColor"
          aria-hidden
        >
          <circle className="gsiconlens" cx="11" cy="11" r="6.4" />
          <line className="gsiconhandle" x1="15.8" y1="15.8" x2="20" y2="20" />
        </svg>
        <input
          ref={inputRef}
          className="gsearchinput"
          placeholder="Search a skill by name, or describe it in your own words"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setMissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 160)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (text) clear();
              else inputRef.current?.blur();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {text && (
          <button
            className="gsearchclear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="Clear search"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
        <button
          className="gsearchgo"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void submit()}
        >
          Search
        </button>
      </div>

      {showSuggest && (
        <div className="gsearchresults">
          {results.length > 0 ? (
            results.map((r, i) => {
              const followed = followedSkills.includes(r.skill);
              return (
                <div
                  key={r.skill}
                  className={`gsresult gsresult-skill ${i === active ? "on" : ""}`}
                  onMouseEnter={() => setActive(i)}
                >
                  <button
                    className="gsrmain"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r.skill)}
                  >
                    <span className="gsrlabel">{r.skill}</span>
                    <span className={`gsrlevel dmd-${r.tone}`}>{r.sub.replace(" demand", "")}</span>
                  </button>
                  <button
                    className={`gsrfollow ${followed ? "on" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestFollowSkill(r.skill);
                    }}
                  >
                    <FollowGlyph on={followed} />
                    {followed ? "Following" : "Follow"}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="gsrempty">
              No skill on a career map matches “{text.trim()}” — press Search to read it as a
              description
            </div>
          )}
        </div>
      )}

      {missed && (
        <div className="gsnomatch">
          No career pathway for that yet. Try a nearby skill, or describe the work differently.
        </div>
      )}
    </div>
  );
}
