/**
 * Career pathways dataset → the Career Pathway Card's model.
 *
 * The card (design: "Career_Pathway_Card", 2026-09-25) draws one family's
 * ladder in one market: a core lane and lateral lanes of role cards, a search
 * that filters the map to a skill, and for the selected role a stat strip, a
 * demand sparkline and a hiring-hotspot map. The design shipped with sample
 * figures in its component; this is where each of them comes from instead.
 * Every number the card can show is a field on a PathwayMarket or PathwayNode,
 * i.e. a count over archive rows — nothing here computes a figure.
 *
 * Imports only types and RUNG_LABEL from the ladder, never the build: this runs
 * in the app, and the build pulls in the company roster.
 *
 * WHAT THE DESIGN ASKS FOR THAT THE ARCHIVE CANNOT GIVE, and what stands in:
 *
 *   TIME IN ROLE ("0–2 yrs") — no source. The archive holds ads, not careers:
 *     it never sees anyone in a role, let alone for how long, and the ads'
 *     experience requirements are in descriptions we do not store. Replaced
 *     by EMPLOYERS, the count of distinct employers advertising the rung.
 *   DAYS TO FILL — no source. An ad coming down is not a hire; it may have
 *     been filled, pulled or re-posted. Replaced by DAYS ADVERTISED, the median
 *     time ads stayed up (PathwayMarket.daysAdvertised), labelled as that.
 *   "% vs prior 30d" — the trend is over the span the feeds actually cover
 *     (PathwayMarket.trend.days), usually shorter than 30+30. The label carries
 *     the real span; never print "30d".
 *   80 weekly points — the series is daily, over at most the window (90 days)
 *     and usually less. The scrub label is in days.
 *   Skill-filtered chart and hotspots — only the AD COUNT is known per skill
 *     (skillLive). The design scaled the sparkline and hotspots to the skill's
 *     share; that would draw the rung's shape and call it the skill's. With a
 *     skill picked, the card's ad count follows it; the chart and hotspots stay
 *     the rung's, and `skillNote` says so.
 *   Branch-in edges ("LATERAL MOVE") — the design links the core lane to the
 *     lateral one. Nothing in the archive evidences that move, so a lateral
 *     lane here is a specialist track standing beside the core, joined to it
 *     only where the ladder says it converges (edge kind "converge"). Its
 *     eyebrow reads SPECIALIST, not LATERAL MOVE.
 *   Descriptions — written from the rung's own figures (employers, window,
 *     other titles), not editorial copy.
 */
import {
  RUNG_LABEL,
  type CareerPathways,
  type PathwayMarket,
  type PathwayNode,
  type Rung,
} from "./careerLadder";
import { skillsForText } from "../data/skillsTaxonomy";
import { AU_CITY_LNGLAT, HUB_LNGLAT, cityLabel } from "../data/mapboxWorldGeo";

// ── Display ──────────────────────────────────────────────────────────────────

/** Words that are acronyms in the ladder's canonical titles (measured over the
 *  top three titles of every rung, 2026-09-25), and a few that are not but
 *  would read wrong capitalised. */
const UPPER = new Set(
  (
    "hr hris it ict ai sap bim hse whs ohs vp svp avp rn en ea pa qa qc cio cfo cto ceo coo cmo " +
    "cpo cco ciso gm phd erp crm bi ui ux pmo apac emea gcp aws cnc cdl qs grc iam foi rfp mri emt " +
    "eoi fico abap itom gipa acip kpmg hsbc ghd cbd nsw qld wa nt sa act us uk nz au fp aps6"
  ).split(" "),
);
const LOWER = new Set("and of to in for the on at or with".split(" "));

/** "senior hr business partner" → "Senior HR Business Partner". */
export function displayTitle(canonical: string): string {
  return canonical
    .split(" ")
    .map((w, i) =>
      UPPER.has(w)
        ? w.toUpperCase()
        : i && LOWER.has(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/** Three-letter pin codes. Airport codes where a city has a well-known one —
 *  the design's own convention (SYD, BNE, AKL) — else the first three letters. */
const CITY_CODE: Record<string, string> = {
  sydney: "SYD",
  melbourne: "MEL",
  brisbane: "BNE",
  perth: "PER",
  adelaide: "ADL",
  canberra: "CBR",
  darwin: "DRW",
  hobart: "HBA",
  auckland: "AKL",
  wellington: "WLG",
  singapore: "SIN",
  kualalumpur: "KUL",
  manila: "MNL",
  hongkong: "HKG",
};
const cityCode = (hub: string) => CITY_CODE[hub] ?? hub.slice(0, 3).toUpperCase();

let regionNames: Intl.DisplayNames | null = null;
export function countryName(cc: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(cc.toUpperCase()) ?? cc.toUpperCase();
  } catch {
    return cc.toUpperCase();
  }
}

/** Pay is stored in AUD for every market (annualAud), so outside Australia
 *  the currency is named rather than left as a bare "$". */
export function payLabel(aud: number | null, country: string): string {
  if (aud == null) return "—";
  return `${country === "au" ? "$" : "A$"}${Math.round(aud / 1000)}K`;
}

const num = (n: number) => n.toLocaleString("en-US");

/** "+14%", "−6%", "0%" — the design's typographic minus. */
export function pctLabel(pct: number): string {
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

// ── Model ────────────────────────────────────────────────────────────────────

export interface CardHub {
  id: string;
  name: string;
  code: string;
  lon: number;
  lat: number;
  /** Live roles in this city. */
  n: number;
}

export interface CardNode {
  /** "family|track|rung" — stable across rebuilds, for goal/current state. */
  id: string;
  track: string;
  rung: Rung;
  /** Column = rung − 1, so a rung too thin to publish is an empty column and
   *  every lane lines up by seniority. Row 0 is the core lane. */
  col: number;
  row: number;
  /** Index of the same lane's node one rung down, or null. The design's
   *  prev / arrow-left; there is no cross-lane parent (see file header). */
  parent: number | null;
  lat: boolean;
  title: string;
  /** Other common titles for the rung, display-cased. */
  alsoTitled: string[];
  desc: string;
  /** "STAGE 3 OF 6 · SENIOR / PARTNER" or "SPECIALIST · TALENT ACQUISITION". */
  stageOf: string;
  /** Median advertised pay, AUD, and the ads behind it. Null below 8 ads. */
  pay: number | null;
  payN: number;
  payLabel: string;
  /** Live roles in this market. */
  ads: number;
  employers: number;
  /** Median days ads stayed up; null below 8 closed ads. */
  daysAdvertised: number | null;
  daysAdvertisedN: number;
  trend: { pct: number; days: number; label: string; up: boolean } | null;
  series: { from: string; to: string; counts: number[] } | null;
  hubs: CardHub[];
  /** The rung's listed skills, commonest first. */
  skills: string[];
  /** Live roles carrying each listed skill. */
  skillLive: Record<string, number>;
}

export interface CardEdge {
  from: number;
  to: number;
  kind: "step" | "converge";
  /** The skill most gained on the step, or null — the design's edge label. */
  label: string | null;
  /** Destination ÷ origin median pay in this market, where both exist. */
  payStep: number | null;
  sharedEmployers: number;
}

export interface CareerCardModel {
  family: string;
  familyLabel: string;
  country: string;
  countryName: string;
  window: { from: string; to: string };
  nodes: CardNode[];
  edges: CardEdge[];
  lanes: { row: number; text: string }[];
  /** Skills listed on any rung of this map, A–Z. */
  skills: string[];
}

const trackLabel = (p: CareerPathways, family: string, track: string) =>
  p.families.find((f) => f.id === family)?.tracks.find((t) => t.id === track)?.label ?? track;

function describe(n: PathwayNode, m: PathwayMarket, country: string, days: number): string {
  const others = n.titles
    .slice(1, 3)
    .map(([t]) => displayTitle(t))
    .filter(Boolean);
  const also = others.length ? ` Also advertised as ${others.join(" and ")}.` : "";
  return (
    `Advertised by ${num(m.employers)} employer${m.employers === 1 ? "" : "s"} in ` +
    `${countryName(country)} over the last ${days} days.${also}`
  );
}

/**
 * The specialist lane a searched skill opens: the family's non-core track with
 * the most live roles asking for it in this market. Null when no specialism
 * asks for it — or when the core path itself lists it: every HR specialism
 * also carries "Human Resources", and opening Talent Acquisition for that
 * search would be picking one of six by volume, not by the skill.
 */
export function laneForSkill(
  p: CareerPathways,
  family: string,
  country: string,
  skill: string,
  core: string,
): string | null {
  const inFamily = p.nodes.filter((n) => n.family === family);
  if (inFamily.some((n) => n.track === core && n.skills.some(([s]) => s === skill))) return null;
  const by = new Map<string, number>();
  for (const n of inFamily) {
    if (n.track === core) continue;
    const v = n.markets[country]?.skillLive[skill];
    if (v) by.set(n.track, (by.get(n.track) ?? 0) + v);
  }
  let best: string | null = null;
  for (const [t, v] of by) if (!best || v > (by.get(best) ?? 0)) best = t;
  return best;
}

/**
 * One family's ladder in one market, in the shape the card renders. Null when
 * the market has no published rung in the family.
 *
 * TWO LANES AT MOST: the core path, plus the one specialism that best matches
 * the searched skill (laneForSkill). HR has seven tracks, and the card's map is
 * 300px tall — every lane at once put most of them off-screen until dragged.
 * With no skill searched, or one no specialism asks for, only the core shows.
 */
export function careerCard(
  p: CareerPathways,
  family: string,
  country: string,
  skill?: string | null,
): CareerCardModel | null {
  const fam = p.families.find((f) => f.id === family);
  if (!fam) return null;
  const all = p.nodes.filter((n) => n.family === family && n.markets[country]);
  if (!all.length) return null;

  // The core is the generalist ladder; if it has no rung in this market, the
  // first track (in the family's own order) that does.
  const tracks = fam.tracks.map((t) => t.id).filter((t) => all.some((n) => n.track === t));
  const core = tracks[0];
  const lateral = skill ? laneForSkill(p, family, country, skill, core) : null;
  const order = lateral ? [core, lateral] : [core];
  const here = all.filter((n) => order.includes(n.track));
  const rowOf = new Map(order.map((t, i) => [t, i]));

  const days = Math.round((Date.parse(p.window.to) - Date.parse(p.window.from)) / 864e5) + 1;
  const sorted = [...here].sort(
    (a, b) => (rowOf.get(a.track) ?? 0) - (rowOf.get(b.track) ?? 0) || a.rung - b.rung,
  );
  const index = new Map(sorted.map((n, i) => [`${n.track}|${n.rung}`, i]));

  const nodes: CardNode[] = sorted.map((n) => {
    const m = n.markets[country];
    const row = rowOf.get(n.track) ?? 0;
    const pay = n.pay[country];
    const t = m.trend;
    return {
      id: `${n.family}|${n.track}|${n.rung}`,
      track: n.track,
      rung: n.rung,
      col: n.rung - 1,
      row,
      parent: index.get(`${n.track}|${n.rung - 1}`) ?? null,
      lat: row > 0,
      title: displayTitle(n.titles[0]?.[0] ?? RUNG_LABEL[n.rung]),
      alsoTitled: n.titles.slice(1, 4).map(([x]) => displayTitle(x)),
      desc: describe(n, m, country, days),
      stageOf:
        row === 0
          ? `STAGE ${n.rung} OF 6 · ${RUNG_LABEL[n.rung].toUpperCase()}`
          : `SPECIALIST · ${trackLabel(p, family, n.track).toUpperCase()}`,
      pay: pay?.median ?? null,
      payN: pay?.n ?? 0,
      payLabel: payLabel(pay?.median ?? null, country),
      ads: m.live,
      employers: m.employers,
      daysAdvertised: m.daysAdvertised.median,
      daysAdvertisedN: m.daysAdvertised.n,
      trend: t ? { ...t, label: pctLabel(t.pct), up: t.pct >= 0 } : null,
      // Already null below SERIES_MIN_DAYS covered days — the build decides.
      series: m.series,
      hubs: m.hubs.flatMap(([id, count]) => {
        const ll = AU_CITY_LNGLAT[id] ?? HUB_LNGLAT[id];
        return ll
          ? [{ id, name: cityLabel(id), code: cityCode(id), lon: ll[0], lat: ll[1], n: count }]
          : [];
      }),
      skills: n.skills.map(([s]) => s),
      skillLive: m.skillLive,
    };
  });

  const edges: CardEdge[] = [];
  for (const e of p.edges) {
    if (e.family !== family) continue;
    const from = index.get(`${e.from.track}|${e.from.rung}`);
    const to = index.get(`${e.to.track}|${e.to.rung}`);
    if (from == null || to == null) continue;
    edges.push({
      from,
      to,
      kind: e.kind,
      label: e.skillsToGain[0]?.[0] ?? null,
      payStep: e.payStep[country] ?? null,
      sharedEmployers: e.sharedEmployers,
    });
  }

  const skills = [...new Set(nodes.flatMap((n) => n.skills))].sort();
  return {
    family,
    familyLabel: fam.label,
    country,
    countryName: countryName(country),
    window: p.window,
    nodes,
    edges,
    lanes: order.map((t, row) => ({
      row,
      text:
        row === 0
          ? `CORE PATH · ${fam.label.toUpperCase()}`
          : `SPECIALIST · ${trackLabel(p, family, t).toUpperCase()}`,
    })),
    skills,
  };
}

// ── Skill search ─────────────────────────────────────────────────────────────

/** Live roles carrying each skill across every rung in the market. A role sits
 *  on exactly one rung, so the sum does not double count. */
export function skillDemand(p: CareerPathways, country: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of p.nodes) {
    const m = n.markets[country];
    if (!m) continue;
    for (const [s, v] of Object.entries(m.skillLive)) out.set(s, (out.get(s) ?? 0) + v);
  }
  return out;
}

/** The chips shown before anything is typed: the market's most-advertised
 *  skills, not a hand-picked list. */
export function popularSkills(p: CareerPathways, country: string, n = 8): string[] {
  return [...skillDemand(p, country).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([s]) => s);
}

/**
 * The search box: "by name, or describe it in your own words". A name match
 * on the market's skills first, then whatever the taxonomy's matcher reads
 * out of the words — the same skillsForText that tags every ad, so "I look
 * after payroll" finds what an ad saying so would have been tagged with.
 */
export function searchSkills(p: CareerPathways, country: string, q: string, n = 10): string[] {
  const text = q.trim().toLowerCase();
  if (!text) return popularSkills(p, country, n);
  const demand = skillDemand(p, country);
  const byName = [...demand.keys()].filter((s) => s.toLowerCase().includes(text));
  const byWords = skillsForText(q).filter((s) => demand.has(s));
  return [...new Set([...byName, ...byWords])]
    .sort((a, b) => (demand.get(b) ?? 0) - (demand.get(a) ?? 0))
    .slice(0, n);
}

/**
 * Which family a picked skill opens: the one with the most live roles asking
 * for it in this market (the design took the one with the most rungs listing
 * it, which lets a family with three thin rungs outrank one with two busy
 * ones). Ties keep the family already on screen.
 */
export function familyForSkill(
  p: CareerPathways,
  country: string,
  skill: string,
  current?: string,
): string | null {
  const by = new Map<string, number>();
  for (const n of p.nodes) {
    const v = n.markets[country]?.skillLive[skill];
    if (v) by.set(n.family, (by.get(n.family) ?? 0) + v);
  }
  let best: string | null = null;
  for (const f of p.families.map((x) => x.id)) {
    const v = by.get(f) ?? 0;
    if (!v) continue;
    const b = best ? (by.get(best) ?? 0) : -1;
    if (v > b || (v === b && f === current)) best = f;
  }
  return best;
}

/** The note under the search box once a skill is picked. */
export function skillNote(model: CareerCardModel, skill: string): string {
  const k = model.nodes.filter((n) => n.skills.includes(skill)).length;
  return (
    `${k} role${k === 1 ? "" : "s"} on this map ask${k === 1 ? "s" : ""} for ${skill}. ` +
    `Ad counts show the ads that name it; the chart and hotspots cover every ad for the role.`
  );
}
