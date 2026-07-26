import { SKILL_CATEGORY } from "../data/skillsTaxonomy";
import { demandLevel, demandPercentile, type DemandTone } from "./skillHeat";
import { skillHistory } from "./marketHistory";
import type { SkillIndex } from "./skillsFn";

/**
 * The skill result card behind `Employsi Skill Search.html`.
 *
 * The design's mock backs this card with a 24-row table of invented figures —
 * a score out of 100, a posting count, applicants per role, a median salary and
 * a sine-wave sparkline. Everything here is measured instead:
 *
 *  • the demand band and the marker's position come from the same distribution
 *    the heat map buckets on, so "High demand" on the card and a red city on
 *    the map are the same statement;
 *  • open roles and the sparkline come from the national vacancy series, which
 *    is a real monthly history rather than a generated curve;
 *  • related skills are the rest of the skill's own taxonomy category, ranked by
 *    demand, not a keyword overlap between made-up tag lists.
 *
 * The one figure with no honest source is the design's "Applicants / role".
 * employsi holds advertised vacancies, not application funnels — the same gap
 * the analyst pane reports — so that cell carries the skill's year-on-year
 * change instead, which is real and belongs on a demand card anyway.
 */

export interface SkillCard {
  skill: string;
  /** "Indexed skill" when the query names it exactly, else "Closest match". */
  matchNote: string;
  levelLabel: string;
  tone: DemandTone;
  /** 0–100 position on the Low → High scale. */
  percentile: number;
  /** Latest-month published vacancies, or null where no agency covers it. */
  openRoles: number | null;
  latestMonth: string | null;
  yoy: number | null;
  /** SVG path over the design's 200×44 box, from the real monthly series. */
  spark: string | null;
  summary: string;
  sources: string[];
  related: string[];
}

const SPARK_W = 200;
const SPARK_H = 44;
// The last five years of the monthly series — enough to show a shape without
// compressing a decade into 200px.
const SPARK_MONTHS = 60;

function sparkPath(series: number[], from: number): string | null {
  const start = Math.max(from, series.length - SPARK_MONTHS);
  const pts = series.slice(start);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  if (hi === lo) return null;
  return pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * (SPARK_W - 4) + 2;
      const y = SPARK_H - 4 - ((v - lo) / (hi - lo)) * (SPARK_H - 8);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function monthName(iso: string): string {
  const [y, m] = iso.split("-");
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

/**
 * Related skills: the rest of this skill's taxonomy category, ranked by demand
 * so the strongest neighbours come first.
 */
function relatedSkills(skill: string, global: boolean, idx: SkillIndex | null): string[] {
  const cat = SKILL_CATEGORY[skill];
  if (!cat) return [];
  return Object.entries(SKILL_CATEGORY)
    .filter(([s, c]) => c === cat && s !== skill)
    .map(([s]) => s)
    .sort((a, b) => demandPercentile(b, global, idx) - demandPercentile(a, global, idx))
    .slice(0, 4);
}

export function buildSkillCard(
  skill: string,
  query: string,
  global: boolean,
  idx: SkillIndex | null,
): SkillCard {
  const badge = demandLevel(skill, global, idx);
  const percentile = demandPercentile(skill, global, idx);
  const history = skillHistory(skill, []);

  const yoy = history?.yoy ?? null;

  const parts: string[] = [];
  if (history) {
    const level = `${history.latest.toLocaleString("en-US")} published vacancies in ${monthName(history.latestMonth)}`;
    // The percentage already says which way it is going, so the direction word
    // is only used when there is no year-on-year figure to state.
    if (yoy === null) {
      parts.push(`${level}, with no published history yet to trend it against.`);
    } else {
      parts.push(
        `${level}, ${yoy >= 0 ? "up" : "down"} ${Math.abs(yoy).toFixed(1)}% year on year.`,
      );
    }
    if (history.peak && history.peak.month !== history.latestMonth) {
      const off = ((history.latest - history.peak.v) / history.peak.v) * 100;
      parts.push(
        `That is ${Math.abs(off).toFixed(0)}% ${off < 0 ? "below" : "above"} the series peak in ${monthName(history.peak.month)}.`,
      );
    }
  } else {
    parts.push(
      `No statistical agency in employsi publishes a vacancy series for ${skill}, so its demand band comes from the live index rather than official counts.`,
    );
  }

  return {
    skill,
    matchNote:
      query.trim().toLowerCase() === skill.toLowerCase() ? "Indexed skill" : "Closest match",
    levelLabel: badge.label,
    tone: badge.tone,
    percentile,
    openRoles: history?.latest ?? null,
    latestMonth: history?.latestMonth ?? null,
    yoy,
    spark: history ? sparkPath(history.series, history.from) : null,
    summary: parts.join(" ").replace(" .", "."),
    sources: history?.sources ?? [],
    related: relatedSkills(skill, global, idx),
  };
}
