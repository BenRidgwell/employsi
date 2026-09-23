import { ALL_SKILLS, SKILL_CATEGORY, SKILL_CHILDREN, SKILL_PARENT } from "../data/skillsTaxonomy";
import { IVI_MONTHS } from "../data/iviSkillDemand";
import { LABOUR_EVENTS, type LabourEvent } from "../data/labourEvents";
import { demandLevel, demandPercentile, type DemandTone } from "./skillHeat";
import type { SkillIndex } from "./skillsFn";
import type { SkillArchiveTrend } from "./jobHistoryFn";
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
  /**
   * What the chip row is offering, because the chips cannot say it themselves.
   *
   * "Specialities" are PARTS of the skill on the card; "Related" are
   * ALTERNATIVES to it; "Part of" is the one chip that goes back up. Those are
   * three different relationships and they used to share one heading, which
   * was survivable only while a speciality could not appear here at all.
   */
  relatedLabel: string;
  /**
   * The span the card's figures cover, when it is NOT the scrubbable agency
   * timeline — i.e. a speciality, whose numbers come from our own archive.
   *
   * Null on a broad skill, which has the 243-month axis and a handle to drag
   * along it. A speciality gets the label and no handle, because there is
   * nothing honest to scrub: its series is the ~50 days we have collected, and
   * a control that moved a 20-year timeline while the card underneath it did
   * not change would be a control that silently does nothing.
   */
  spanLabel: string | null;
  /** What produced the figures: "agency" for the published vacancy series,
   *  "archive" for our own collected listings. The card labels itself from
   *  this rather than the reader having to infer it from the shape. */
  basis: "agency" | "archive";
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

/**
 * How many chips the row carries.
 *
 * Six, matching the search list's own cap, so the two surfaces offer a skill's
 * specialities at the same depth — typing "nursing" and opening Nursing should
 * not disagree about how many of its specialities are worth naming. The design
 * draws four; four was kept while this row held category neighbours, where a
 * fifth and sixth alternative add little. A parent's own specialities are the
 * drill-down, and Nursing has eleven, so four hid most of them behind nothing.
 *
 * It applies to the sibling row too. Keeping one cap means the row is the same
 * length whichever kind of chip it holds, which is the point of the two rows
 * reading as one design.
 */
const RELATED_N = 6;

/**
 * The rest of this skill's taxonomy category, strongest first — the fallback
 * when a skill has no specialities of its own.
 *
 * SKILL_CATEGORY covers specialities too (parseStoredSkills uses it as the
 * membership test for an archived name), so this filters to ALL_SKILLS. A
 * skill's own children do not belong in a row of ALTERNATIVES; they are parts
 * of it, and they now have a row of their own — see specialitiesOf.
 */
function categorySiblings(skill: string): string[] {
  const cat = SKILL_CATEGORY[skill];
  if (!cat) return [];
  return ALL_SKILLS.filter((s) => s !== skill && SKILL_CATEGORY[s] === cat)
    .sort((a, b) => demandPercentile(b, true, null) - demandPercentile(a, true, null))
    .slice(0, RELATED_N);
}

/**
 * A broad skill's own specialities, busiest first.
 *
 * THIS USED TO BE FORBIDDEN, AND THE COMMENT SAYING SO IS WORTH KEEPING. It
 * read: "reading SKILL_CATEGORY directly put a skill's OWN specialities in its
 * related list — Nursing suggested Midwifery and Aged Care Nursing as things to
 * look at next, which are not alternatives to nursing but parts of it. Worse,
 * none of them have a demand series to open, so every such suggestion led to an
 * empty card."
 *
 * Both halves were right at the time. Only the second has stopped being true:
 * a speciality now opens a card with a count, a line and a heat map, all from
 * the archive. The first half never stopped being true, and it is the reason
 * this is a SEPARATE row with its own label rather than more chips in
 * "Related" — a reader has to be able to tell "part of this" from "instead of
 * this", and an unlabelled chip cannot say which it is.
 *
 * ORDERED BY THE INDEX, NOT THE ARCHIVE FOLD. Ranking all of a parent's
 * children by the fold would be one D1 scan each — eleven for Nursing — to
 * decide the order of four chips. The index is one KV read already in hand,
 * and ordering is a ranking rather than a figure the card prints, the same
 * argument that keeps the demand band on the index. The counts themselves are
 * never shown here.
 *
 * A speciality the index has never seen is DROPPED rather than ranked last: it
 * would open a card that says nothing has been collected yet, which is a dead
 * end offered as a suggestion. All 122 carry live rows today (measured
 * 2026-09-23), so this drops nothing now and stays correct if one goes quiet.
 * If it were to empty the row completely the caller falls back to the siblings.
 */
function specialitiesOf(skill: string, idx: SkillIndex | null): string[] {
  const kids = SKILL_CHILDREN[skill] ?? [];
  if (!kids.length) return [];
  const seen = (s: string) => idx?.skills[s]?.total ?? 0;
  // Before the index lands nothing is known about any of them, so the taxonomy
  // order stands rather than an arbitrary one produced by sorting all-zeroes.
  const ranked = idx
    ? kids.filter((s) => seen(s) > 0).sort((a, b) => seen(b) - seen(a) || a.localeCompare(b))
    : [...kids];
  return ranked.slice(0, RELATED_N);
}

/** A short, unambiguous day label — "3 Aug" — for the archive span line. */
function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTH_SHORT[Number(m) - 1] ?? m}`;
}

/**
 * A SPECIALITY IS ANSWERED FROM OUR OWN COLLECTION, AND SAYS SO.
 *
 * The broad-skill card below is built from the statistical agencies' vacancy
 * series. No agency publishes one for a speciality, so this card is built from
 * the archive instead — the listings employsi has collected, folded into
 * vacancies by getSkillTrend and reconstructed day by day.
 *
 * The two are NOT blended, and the copy names which one is speaking. A count
 * of what we collected and a national series an agency published are different
 * measurements, and a card that averaged them or silently swapped between them
 * would be the kind of number this codebase keeps having to take back out.
 *
 * WHAT CHANGED, AND WHY IT IS NOW A LINE RATHER THAN A BLANK. This card used to
 * return `change: null, spark: null` and explain in the copy that there was no
 * trend line because there was no series. That was true of the AGENCY data and
 * false of ours: the archive has held first_seen/last_seen per row since the
 * day it was written, and the company card has drawn per-skill sparklines off
 * exactly those columns all along. The speciality was blank because nothing
 * had asked the archive, not because the archive could not answer.
 *
 * TWO NUMBERS ON THIS CARD COME FROM DIFFERENT PLACES, deliberately:
 *
 *  • `openRoles` and the line are BOTH the archive fold, so the figure and the
 *    right-hand end of the line are the same measurement. They have to be:
 *    the index counts ROWS and the fold counts VACANCIES, and one role carried
 *    by four feeds is four of the first and one of the second.
 *  • The band and the marker are still the live index, because they answer a
 *    different question — where this speciality RANKS among the other 121 —
 *    and the index is the only source that holds all of them at once (one KV
 *    read, against 122 archive scans). A rank and a count can differ in method
 *    without either being wrong; two counts cannot.
 *
 * Until the archive query lands, `openRoles` is null and the cell reads "—",
 * the same way the median-salary cell already waits for its own query. Showing
 * the index's row count first and then swapping it for the fold's vacancy
 * count would visibly move the number by ~20% for no reason the reader could
 * see.
 */
function buildSpecialityCard(
  skill: string,
  mi: number,
  idx: SkillIndex | null,
  trend: SkillArchiveTrend | null,
): SkillCard {
  const parent = SKILL_PARENT[skill];
  const badge = demandLevel(skill, true, idx, "volume");
  const now = trend?.now ?? null;
  const days = trend?.days ?? [];
  const series = trend?.series ?? null;
  const change = trend?.pct ?? null;

  // The same 240×64 box the broad card draws into, over the whole covered
  // window — there is no handle here, so there is no partial slice to take.
  const spark = series ? sparkPaths(series, 0, series.length - 1) : null;

  const up = change !== null && change >= 0.35;
  const down = change !== null && change <= -0.35;
  const roles = now === null ? "" : `${now.toLocaleString("en-US")} advertised roles`;
  // The span ACTUALLY DRAWN, never the one requested — the fold trims to the
  // days collection ran and the feeds carrying this skill had arrived, so it
  // is routinely shorter than the window asked for.
  const spanLabel = days.length
    ? `Collected · ${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}`
    : null;

  let summaryLead: string;
  let summaryPct = "";
  let summaryTail = "";
  if (now === null) {
    summaryLead = `${skill} is a speciality within ${parent}. Nothing carrying it has been collected yet, so there is no figure to show.`;
  } else if (change === null) {
    // Either too few days covered to measure a move, or too few ads to claim
    // one. Both are real answers; neither is a number.
    summaryLead = `${roles} carry ${skill}, a speciality within ${parent}.`;
    summaryTail = days.length
      ? ` Counted from the listings employsi collects — no statistical agency publishes a series at this level. Too few days collected so far to measure a move.`
      : ` Counted from the listings employsi collects — no statistical agency publishes a series at this level.`;
  } else {
    summaryLead = up
      ? "Collected roles are up "
      : down
        ? "Collected roles are down "
        : "Collected roles are flat, ";
    summaryPct = `${up ? "+" : down ? "−" : "±"}${Math.abs(change).toFixed(1)}%`;
    summaryTail = ` over the ${days.length} days collected — ${roles} carrying ${skill}, a speciality within ${parent}. Counted from employsi's own listings, not an agency series.`;
  }

  return {
    skill,
    icon: CATEGORY_ICON[SKILL_CATEGORY[parent] ?? SKILL_CATEGORY[skill] ?? ""] ?? "code",
    levelLabel: badge.label,
    tone: badge.tone,
    percentile: demandPercentile(skill, true, idx, "volume"),
    openRoles: now,
    month: IVI_MONTHS[mi],
    monthLabel: monthLabel(IVI_MONTHS[mi]),
    change,
    spark: spark?.line ?? null,
    sparkArea: spark?.area ?? null,
    summaryLead,
    summaryPct,
    summaryTail,
    atPresent: true,
    sources: now === null ? [] : ["employsi collected listings"],
    related: parent ? [parent] : [],
    // The one chip here is the way back UP, not a sideways suggestion.
    relatedLabel: "Part of",
    spanLabel,
    basis: "archive",
  };
}

export function buildSkillCard(
  skill: string,
  monthIndex: number,
  idx: SkillIndex | null = null,
  trend: SkillArchiveTrend | null = null,
): SkillCard {
  if (SKILL_PARENT[skill])
    return buildSpecialityCard(
      skill,
      Math.max(0, Math.min(TIMELINE_SPAN, Math.round(monthIndex))),
      idx,
      trend,
    );
  const mi = Math.max(0, Math.min(TIMELINE_SPAN, Math.round(monthIndex)));
  const atPresent = mi === TIMELINE_SPAN;
  const specialities = specialitiesOf(skill, idx);
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
    // A skill's OWN specialities lead, where it has any the archive has seen:
    // from a parent card the useful next click is almost always down into the
    // work rather than sideways to a neighbour. Category siblings remain the
    // answer for the 59 broad skills with no children, under the heading they
    // always had.
    //
    // The row can still come out EMPTY, and did before this change too: four
    // skills — Real Estate & Property, Architecture & Planning, Manufacturing
    // & Production, Agriculture & Farming — are the sole member of their
    // category AND have no specialities, so there is genuinely nothing to
    // offer. The renderer drops the row rather than printing a heading over
    // nothing. Suppressing beats inventing a neighbour.
    //
    // A parent with FEWER specialities than the cap shows just those — Retail
    // Operations offers one chip. Topping the row up with siblings would put
    // "part of this" and "instead of this" under one heading, which is the
    // confusion the label split exists to prevent.
    related: specialities.length ? specialities : categorySiblings(skill),
    relatedLabel: specialities.length ? "Specialities" : "Related",
    // The broad card keeps the scrubbable 243-month axis, so it labels itself
    // from TIMELINE_LABEL and needs no span line of its own.
    spanLabel: null,
    basis: "agency",
  };
}
