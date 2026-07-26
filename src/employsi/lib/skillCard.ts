import { SKILL_CATEGORY } from "../data/skillsTaxonomy";
import { IVI_MONTHS } from "../data/iviSkillDemand";
import { LABOUR_EVENTS, type LabourEvent } from "../data/labourEvents";
import { demandPercentile, type DemandTone } from "./skillHeat";
import { demandAt, skillHistory, vacanciesAt } from "./marketHistory";

/**
 * The skill detail card, from `Employsi Skill Detail.html`.
 *
 * The design's defining move is that the card is SCRUBBABLE: a timeline runs
 * the length of the series and every figure on the card — the demand band, the
 * marker's position, open roles, the trend line and the summary — resolves at
 * whatever month the handle is on. Its mock fakes that by bending twelve
 * hand-drawn curves; here it is the real 243-month axis this app already
 * carries (Mar 2006 → May 2026, which is exactly the span the design labels its
 * timeline with), so scrubbing to 2009 shows what the statistical agencies
 * actually recorded in 2009.
 *
 * Two things the design shows that the data cannot follow back through time:
 *
 *  • Median salary. Advertised pay comes from the live ad archive, which is
 *    days old, not decades. Rather than bend today's figure along a curve as
 *    the mock does, the cell shows the live median only when the handle is at
 *    the present and reads "—" once you scrub away from it.
 *  • The event notes are editorial, not measured — see labourEvents.ts. They
 *    annotate the series; nothing on the card is derived from them.
 */

export interface SkillCard {
  skill: string;
  /** Which glyph to draw beside the name. */
  icon: string;
  levelLabel: string;
  tone: DemandTone;
  /** 0–100 position on the Low → High scale, at the scrubbed month. */
  percentile: number;
  /** Published vacancies at the scrubbed month, or null with no coverage. */
  openRoles: number | null;
  /** YYYY-MM the card is currently resolved to. */
  month: string;
  monthLabel: string;
  /** Change over the last 12 weeks (3 months of the series), as a %. */
  change: number | null;
  /** Line and its fill area, over the design's 240×64 box. */
  spark: string | null;
  sparkArea: string | null;
  /** The summary, split so the percentage can be coloured in the middle. */
  summaryLead: string;
  summaryPct: string;
  summaryTail: string;
  /** Whether the card is resolved to the newest month in the series. */
  atPresent: boolean;
  sources: string[];
  related: string[];
}

// The design's 240×64 box: the line lives between y=8 and y=54, and the fill
// closes at y=58 so it sits just clear of the bottom edge.
const SPARK_W = 240;
const SPARK_TOP = 54;
const SPARK_RANGE = 46;
const SPARK_BASE = 58;
const CHANGE_MONTHS = 3; // "over 12 weeks", on a monthly series

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const TIMELINE_SPAN = IVI_MONTHS.length - 1;
export const TIMELINE_LABEL = `Timeline · ${monthLabel(IVI_MONTHS[0])} – ${monthLabel(
  IVI_MONTHS[TIMELINE_SPAN],
)}`;

export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTH_SHORT[Number(m) - 1] ?? m} ${y}`;
}

/** Where an event sits on the timeline, as a 0–1 fraction, or null if off-axis. */
export function eventPosition(e: LabourEvent): number | null {
  const iso = `${e.year}-${String(e.month + 1).padStart(2, "0")}`;
  const i = IVI_MONTHS.indexOf(iso);
  return i < 0 ? null : i / TIMELINE_SPAN;
}

export function eventIndex(e: LabourEvent): number {
  const iso = `${e.year}-${String(e.month + 1).padStart(2, "0")}`;
  return IVI_MONTHS.indexOf(iso);
}

/**
 * The most recent event at or before the scrubbed month, or null when the
 * handle sits before the first one.
 *
 * The design's mock falls back to the earliest event in that case, which dates
 * the panel in the FUTURE relative to the handle — scrubbing to Mar 2007 showed
 * "Aug 2007, Credit crunch begins". Returning null instead lets the card simply
 * not show an event panel until there is one to show.
 */
export function eventFor(monthIndex: number): LabourEvent | null {
  let cur: LabourEvent | null = null;
  for (const e of LABOUR_EVENTS) {
    const i = eventIndex(e);
    if (i >= 0 && i <= monthIndex) cur = e;
  }
  return cur;
}

// Category → the design's icon set. Its twelve mock skills map to nine glyphs;
// the taxonomy has 27 categories, so each is routed to the closest of them.
const CATEGORY_ICON: Record<string, string> = {
  Digital: "code",
  Science: "data",
  Engineering: "factory",
  Manufacturing: "factory",
  Trades: "factory",
  Mining: "factory",
  Energy: "cloud",
  Construction: "factory",
  "Built Environment": "design",
  Property: "design",
  Creative: "design",
  Health: "health",
  Care: "health",
  Personal: "health",
  Financial: "finance",
  Sales: "finance",
  Corporate: "finance",
  Admin: "code",
  Education: "shield",
  "Public Sector": "shield",
  Community: "shield",
  Safety: "shield",
  Transport: "cloud",
  Agriculture: "factory",
  Hospitality: "health",
  Cleaning: "factory",
  Sector: "code",
};

export const SKILL_ICONS: Record<string, string[]> = {
  cloud: ["M7 18h9a4 4 0 0 0 .6-7.96A6 6 0 0 0 5.3 11.2 3.5 3.5 0 0 0 6.5 18Z"],
  code: ["M8.5 8.5 5 12l3.5 3.5", "M15.5 8.5 19 12l-3.5 3.5", "M13.6 5.4 10.4 18.6"],
  data: [
    "M4 6.5c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5-8-1.1-8-2.5Z",
    "M4 6.5v11c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-11",
    "M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5",
  ],
  shield: ["M12 3.2l7 2.8v5.6c0 4.2-2.9 7.3-7 8.4-4.1-1.1-7-4.2-7-8.4V6Z", "M9.2 12.2l2 2 3.6-3.8"],
  health: ["M9.5 3.5h5v5h5v5h-5v5h-5v-5h-5v-5h5Z"],
  design: ["M4.5 19.5l4.2-1.1L18.4 8.9a2.2 2.2 0 0 0-3.1-3.1L5.6 15.3Z", "M13.8 7.4l2.9 2.9"],
  factory: ["M4 20h16", "M6 20V9.5l4.8 2.8V9.5l4.8 2.8V6.4L20 8.6V20"],
  finance: ["M4 4.5v15h15.5", "M7.5 15.5l3.6-4.4 3 2.2 4.4-5.6"],
};

/**
 * The trend line: the series from its start up to the scrubbed month, so the
 * shape grows as the handle moves rather than being reseeded like the mock's.
 * Returns the stroke path and the closed area beneath it.
 */
function sparkPaths(
  series: number[],
  from: number,
  to: number,
): { line: string; area: string } | null {
  const pts = series.slice(from, to + 1);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  if (hi === lo) return null;
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * SPARK_W;
    const y = SPARK_TOP - ((v - lo) / (hi - lo)) * SPARK_RANGE;
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `M0 ${SPARK_BASE} L${coords
    .map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" L")} L${SPARK_W} ${SPARK_BASE} Z`;
  return { line, area };
}

/** Related skills: the rest of this skill's taxonomy category, strongest first. */
function relatedSkills(skill: string): string[] {
  const cat = SKILL_CATEGORY[skill];
  if (!cat) return [];
  return Object.entries(SKILL_CATEGORY)
    .filter(([s, c]) => c === cat && s !== skill)
    .map(([s]) => s)
    .sort((a, b) => demandPercentile(b, true, null) - demandPercentile(a, true, null))
    .slice(0, 4);
}

export function buildSkillCard(skill: string, monthIndex: number): SkillCard {
  const mi = Math.max(0, Math.min(TIMELINE_SPAN, Math.round(monthIndex)));
  const atPresent = mi === TIMELINE_SPAN;
  const history = skillHistory(skill, []);
  const at = demandAt(skill, mi);

  const now = at?.vacancies ?? null;
  const before = vacanciesAt(skill, mi - CHANGE_MONTHS);
  const change =
    now !== null && before !== null && before > 0 && mi >= CHANGE_MONTHS
      ? ((now - before) / before) * 100
      : null;

  const up = change !== null && change >= 0.35;
  const down = change !== null && change <= -0.35;
  const roles = now === null ? "" : `${Math.round(now).toLocaleString("en-US")} roles live`;

  let summaryLead = "";
  let summaryPct = "";
  let summaryTail = "";
  if (change === null) {
    summaryLead =
      now === null
        ? `No statistical agency in employsi publishes a vacancy series for ${skill}, so there is no history to trend.`
        : `${roles} in ${monthLabel(IVI_MONTHS[mi])}, with too little history before it to measure a move.`;
  } else {
    summaryLead = up ? "Openings are up " : down ? "Openings are down " : "Openings are flat, ";
    summaryPct = `${up ? "+" : down ? "−" : "±"}${Math.abs(change).toFixed(1)}%`;
    summaryTail = up
      ? ` over 12 weeks — ${roles}.`
      : down
        ? ` over 12 weeks — down to ${roles}.`
        : ` over 12 weeks — ${roles}, within a point of the quarter before.`;
  }

  const spark = history ? sparkPaths(history.series, history.from, mi) : null;

  return {
    skill,
    icon: CATEGORY_ICON[SKILL_CATEGORY[skill] ?? ""] ?? "code",
    levelLabel:
      at?.level === "hi" ? "High demand" : at?.level === "mid" ? "Moderate demand" : "Low demand",
    tone: at?.level ?? "lo",
    percentile: at?.percentile ?? 0,
    openRoles: now,
    month: IVI_MONTHS[mi],
    monthLabel: monthLabel(IVI_MONTHS[mi]),
    change,
    spark: spark?.line ?? null,
    sparkArea: spark?.area ?? null,
    summaryLead,
    summaryPct,
    summaryTail,
    atPresent,
    sources: history?.sources ?? [],
    related: relatedSkills(skill),
  };
}
