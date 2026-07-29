import { askAnalyst, type AnalystAnswer, type AnalystBar, type AnalystScope } from "./analystFn";
import { detectIntent, detectSkill } from "./analystIntent";
import {
  HISTORY_SPAN,
  hasCoverage,
  moversInScope,
  skillHistory,
  topSkillsInScope,
} from "./marketHistory";
import { skillsForSector } from "./analystSector";

/**
 * Routes a question to whichever dataset can actually answer it.
 *
 * employsi holds two very different things:
 *
 *  • the D1 vacancy archive — every ad seen by the daily crawl, so it knows
 *    what is open RIGHT NOW, who is advertising, and what the ads disclose, but
 *    only back to the day collection started;
 *  • the national vacancy series — Jobs and Skills Australia, StatCan, MRSD,
 *    MBIE, ONS, Eurostat and BLS — which are monthly, authoritative and run
 *    back to 2006, but are published per occupation and area, not per ad.
 *
 * A question about how a market has MOVED belongs to the second; a question
 * about what is open today belongs to the first. Sending a "how has demand
 * changed since 2019" question to a six-day archive would produce a confident
 * answer about nothing, so the routing is explicit rather than best-effort.
 */

const fmtPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");

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

/** A skill's long-run history in this scope, as the design's answer shape. */
function skillHistoryAnswer(skill: string, keys: string[], label: string): AnalystAnswer | null {
  const h = skillHistory(skill, keys);
  if (!h) return null;

  const stats = [
    { k: `Vacancies · ${h.latestMonth}`, v: fmtNum(h.latest) },
    {
      k: "Year on year",
      v: h.yoy === null ? "—" : fmtPct(h.yoy),
      down: h.yoy !== null && h.yoy < 0,
    },
    {
      k: "vs 5 years",
      v: h.fiveYear === null ? "—" : fmtPct(h.fiveYear),
      down: h.fiveYear !== null && h.fiveYear < 0,
    },
  ];

  const max = h.byKey[0]?.v ?? 1;
  const bars: AnalystBar[] = h.byKey.slice(0, 5).map((r) => ({
    name: r.label,
    pct: Math.round((r.v / max) * 100),
    v: fmtNum(r.v),
  }));

  const parts: string[] = [
    `Published vacancies for ${skill} across ${label} stand at ${fmtNum(h.latest)} in ${monthName(h.latestMonth)}.`,
  ];
  if (h.yoy !== null) {
    parts.push(
      `That's ${h.yoy >= 0 ? "up" : "down"} ${Math.abs(h.yoy).toFixed(1)}% on a year earlier`,
    );
    if (h.fiveYear !== null) {
      parts.push(`and ${fmtPct(h.fiveYear)} against five years ago.`);
    } else {
      parts.push("— the series doesn't run far enough back here for a five-year read.");
    }
  }
  if (h.peak && h.peak.month !== h.latestMonth) {
    const offPeak = ((h.latest - h.peak.v) / h.peak.v) * 100;
    parts.push(
      `The series peaked at ${fmtNum(h.peak.v)} in ${monthName(h.peak.month)}, so demand now sits ${Math.abs(offPeak).toFixed(0)}% ${offPeak < 0 ? "below" : "above"} that high.`,
    );
  }

  return {
    intent: "history",
    text: parts.join(" ").replace(/\s+—/g, " —"),
    stats,
    bars,
    source: `${h.sources.join(" · ")} · monthly, ${HISTORY_SPAN}`,
  };
}

/** Market-level history when the question doesn't name a skill. */
function marketHistoryAnswer(
  keys: string[],
  label: string,
  sector?: string,
  only?: Set<string>,
): AnalystAnswer | null {
  const top = topSkillsInScope(keys, 5, only);
  if (!top.length) return null;
  const movers = moversInScope(keys, 4, only);

  const max = top[0].latest || 1;
  const bars: AnalystBar[] = top.map((r) => ({
    name: r.skill,
    pct: Math.round((r.latest / max) * 100),
    v: r.yoy === null ? fmtNum(r.latest) : `${fmtNum(r.latest)} · ${fmtPct(r.yoy)}`,
    down: r.yoy !== null && r.yoy < 0,
  }));

  const risers = movers.filter((m) => (m.yoy ?? 0) > 0).slice(0, 2);
  const fallers = movers.filter((m) => (m.yoy ?? 0) < 0).slice(0, 2);
  const moverText = [
    risers.length
      ? `Fastest growing year on year: ${risers.map((r) => `${r.skill} (${fmtPct(r.yoy!)})`).join(", ")}.`
      : "",
    fallers.length
      ? `Falling hardest: ${fallers.map((r) => `${r.skill} (${fmtPct(r.yoy!)})`).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sources = skillHistory(top[0].skill, keys)?.sources ?? [];

  // The distinction matters: these series are published per occupation, so a
  // sector filter here selects the occupations that sector hires, not the
  // employers in it. Saying so is the difference between a figure the user can
  // rely on and one they will misread.
  const lead = sector
    ? `Across ${label}, among the occupations ${sector} hires, the largest published vacancy categories are`
    : `Across ${label}, the largest published vacancy categories are`;

  return {
    intent: "history",
    text: `${lead} ${top
      .slice(0, 3)
      .map((r) => r.skill)
      .join(", ")}. ${moverText}`.trim(),
    stats: [
      { k: "Top category", v: fmtNum(top[0].latest) },
      {
        k: "Its year on year",
        v: top[0].yoy === null ? "—" : fmtPct(top[0].yoy),
        down: top[0].yoy !== null && top[0].yoy < 0,
      },
      { k: "Areas covered", v: String(keys.filter((k) => skillHistory(top[0].skill, [k])).length) },
    ],
    bars,
    source:
      `${sources.join(" · ")} · monthly, ${HISTORY_SPAN}` +
      (sector ? ` · narrowed to ${sector} occupations` : ""),
  };
}

export async function answerQuestion(
  question: string,
  scope: AnalystScope,
  hubs: string[],
  country?: string,
  sector?: string,
  companyIds?: string[],
): Promise<AnalystAnswer> {
  const intent = detectIntent(question);
  const skill = detectSkill(question);
  const covered = hasCoverage(hubs);

  // Long-run questions, and any question about a NAMED skill's demand, are
  // answered from the official series — the archive cannot see past its own
  // start date, and a skill-level trend is exactly what these series publish.
  const wantsHistory =
    intent === "history" || (!!skill && (intent === "volume" || intent === "skills"));

  // A sector narrows the national series to the occupations that sector hires
  // (see lib/analystSector.ts). It does not apply when the question already
  // names one skill — that IS the narrowing.
  const sectorSkills = sector ? skillsForSector(sector) : undefined;

  if (wantsHistory && covered) {
    const answer = skill
      ? skillHistoryAnswer(skill, hubs, scope.label)
      : marketHistoryAnswer(hubs, scope.label, sector, sectorSkills);
    if (answer) return answer;
    if (!skill && sector) {
      // The scope publishes series, but none for this sector's occupations.
      return {
        intent: "history",
        text: `No statistical agency covering ${scope.label} publishes a vacancy series for the occupations ${sector} hires, so I can't give you its long-run history there. These series are per occupation rather than per employer, so a sector with no matching occupation series simply isn't in them. Ask me what's open right now instead, or set the sector back to all sectors.`,
        source: `National vacancy series · ${HISTORY_SPAN}`,
      };
    }
    if (skill) {
      // The scope has series, but not for this skill — say which, rather than
      // silently answering a different question.
      return {
        intent: "history",
        text: `No statistical agency covering ${scope.label} publishes a vacancy series for ${skill}, so I can't give you its history there. I can still tell you what's live in the ad archive right now, or you can widen the scope.`,
        source: `National vacancy series · ${HISTORY_SPAN}`,
      };
    }
  }

  if (intent === "history" && !covered) {
    return {
      intent: "history",
      text: `${scope.label} has no published vacancy series in employsi — the long-run statistics we carry cover Australia, Canada, New Zealand, Singapore, the UK, the EU and the US. For anywhere else I'm limited to the live ad archive, which only goes back to when collection started. Ask me what's open right now instead, or switch the scope.`,
      source: `National vacancy series · ${HISTORY_SPAN}`,
    };
  }

  // Everything else is a question about the live market: what is open, who is
  // advertising, what the ads say. That is the archive's job.
  return askAnalyst({ data: { question, scope, hubs, country, sector, companyIds } });
}
