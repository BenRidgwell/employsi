/**
 * The career card's figures — PathwayBuilder.market and lib/careerCard.ts.
 *
 * WHY THIS EXISTS. Every figure the card draws beyond the ladder — the daily
 * demand line, its trend, days advertised, the hotspots — is a series over the
 * archive, and a series over the archive is where this codebase's worst bugs
 * have lived: a line that climbs because a feed arrived, a fall that is a day
 * still being collected, one role counted once per board. None of them would
 * look wrong on the card. So the rules are asserted here, on synthetic rows
 * whose right answer is known, and the adapter's invariants on the real data.
 *
 * Run: bun run scripts/check-career-card.ts
 */
import {
  PathwayBuilder,
  MIN_NODE_ROLES,
  addDays,
  type PathwayRow,
} from "../src/employsi/lib/careerPathwaysBuild";
import type { CareerPathways, PathwayMarket } from "../src/employsi/lib/careerLadder";
import {
  careerCard,
  displayTitle,
  familyForSkill,
  pctLabel,
  searchSkills,
} from "../src/employsi/lib/careerCard";
import { CAREER_PATHWAYS } from "../src/employsi/data/careerPathways";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    failed++;
    console.error(`✗ ${name}`, detail === undefined ? "" : detail);
  }
}

// ── Synthetic archive ────────────────────────────────────────────────────────

const FROM = "2026-06-01";
const END = "2026-07-30"; // the archive's newest day
let rid = 0;
function row(
  title: string,
  employer: string,
  source: string,
  first: string,
  last: string,
  extra: Partial<PathwayRow> = {},
): PathwayRow {
  return {
    rid: ++rid,
    title,
    company: employer,
    company_id: employer,
    hub: "sydney",
    source,
    salary: null,
    skills: null,
    first_seen: first,
    last_seen: last,
    ...extra,
  };
}

function build(rows: PathwayRow[]): CareerPathways {
  const b = new PathwayBuilder(addDays(END, -1));
  for (const r of rows) b.add(r);
  return b.finish({ from: FROM, to: END }).pathways;
}
function market(p: CareerPathways, rung: number): PathwayMarket {
  const n = p.nodes.find((x) => x.family === "hr" && x.track === "generalist" && x.rung === rung);
  if (!n?.markets.au) throw new Error(`no hr/generalist/${rung} market in the fixture`);
  return n.markets.au;
}
const at = (m: PathwayMarket, day: string) => {
  const s = m.series!;
  const i = Math.round((Date.parse(day) - Date.parse(s.from)) / 864e5);
  return s.counts[i];
};

// 1. Counting. HR Advisor (rung 2): 50 roles on feed "a" all window; one of
//    them ALSO on feed "b" over the same days; one role that feed "a" carried
//    06-01..06-10 and feed "b" re-listed 06-20..06-30.
{
  const rows: PathwayRow[] = [];
  for (let i = 0; i < 50; i++) rows.push(row("HR Advisor", `e${i}`, "a", FROM, END));
  rows.push(row("HR Advisor", "e0", "b", "2026-06-20", "2026-07-10"));
  rows.push(row("HR Advisor", "gap", "a", FROM, "2026-06-10"));
  rows.push(row("HR Advisor", "gap", "b", "2026-06-20", "2026-06-30"));
  const m = market(build(rows), 2);
  check("series exists over the covered window", !!m.series, m);
  check(
    "feed b (2 of 53 rows) is outvoted — the series starts at the window",
    m.series?.from === FROM,
    m.series?.from,
  );
  check(
    "a role carried by two boards counts once",
    at(m, "2026-07-05") === 50,
    at(m, "2026-07-05"),
  );
  check("a lapsed role counts while it is up", at(m, "2026-06-05") === 51, at(m, "2026-06-05"));
  check("…and not in the gap", at(m, "2026-06-15") === 50, at(m, "2026-06-15"));
  check("…and again once re-listed", at(m, "2026-06-25") === 51, at(m, "2026-06-25"));
  check(
    "the series ends the day before the archive's newest",
    m.series?.to === addDays(END, -1),
    m.series?.to,
  );
  // Older half (06-01..06-29) averages 50.69 with the lapsed role, the newer
  // half 50.00 — −1.4%, rounded. Means of halves, not first-vs-last day.
  check("the trend is the change between the halves' means", m.trend?.pct === -1, m.trend);
  check(
    "the trend reports the span actually drawn",
    m.trend?.days === m.series?.counts.length,
    m.trend,
  );
  check("live counts the roles still up", m.live === 50, m.live);
}

// 2. Feed arrival. HR Manager (rung 4): 10 roles on "a" from the start, 10 on
//    "c" whose first row is 07-01. Before 07-01 the rung is missing half its
//    feeds, and a line drawn over it would double at c's arrival.
{
  const rows: PathwayRow[] = [];
  for (let i = 0; i < 10; i++) rows.push(row("HR Manager", `m${i}`, "a", FROM, END));
  for (let i = 0; i < 10; i++) rows.push(row("HR Manager", `n${i}`, "c", "2026-07-01", END));
  const m = market(build(rows), 4);
  check(
    "the series starts when the feeds had arrived",
    m.series?.from === "2026-07-01",
    m.series?.from,
  );
  check("so it does not draw the arrival as hiring", m.trend?.pct === 0, m.trend);
}

// 3. The end. HR Business Partner (rung 3): half its rows on a feed whose
//    newest pull is 07-25. The days after are that feed not having run, not
//    ads coming down — but the step back is capped at MAX_STEP_BACK_DAYS (3).
{
  const rows: PathwayRow[] = [];
  for (let i = 0; i < 10; i++) rows.push(row("HR Business Partner", `p${i}`, "a", FROM, END));
  for (let i = 0; i < 10; i++)
    rows.push(row("HR Business Partner", `q${i}`, "d", FROM, "2026-07-25"));
  const m = market(build(rows), 3);
  check(
    "the end steps back to the covered day, at most 3 days",
    m.series?.to === "2026-07-26",
    m.series?.to,
  );
}

// 4. Too short to draw. HR Coordinator (rung 1): every feed arrives 07-20, so
//    the covered span is 10 days — under SERIES_MIN_DAYS.
{
  const rows: PathwayRow[] = [];
  for (let i = 0; i < 8; i++) rows.push(row("HR Coordinator", `c${i}`, "a", "2026-07-20", END));
  const m = market(build(rows), 1);
  check("under SERIES_MIN_DAYS covered days: no series", m.series === null, m.series);
  check("…and so no trend", m.trend === null, m.trend);
}

// 5. A thin older half. 5 roles, only one open in the first half: the trend
//    would be +400% on four ads.
{
  const rows: PathwayRow[] = [];
  rows.push(row("HR Advisor", "t0", "a", FROM, END));
  for (let i = 1; i < 5; i++) rows.push(row("HR Advisor", `t${i}`, "a", "2026-07-10", END));
  const m = market(build(rows), 2);
  check(`older half under ${MIN_NODE_ROLES} roles: no trend`, m.trend === null, m.trend);
}

// 6. Days advertised. Closed roles opened inside the covered span count;
//    live ones and one opened before the span do not (their length is not
//    known). Durations 3..10 → median 6.5 → 7 (rounded mean of the middle two).
{
  const rows: PathwayRow[] = [];
  for (let i = 0; i < 10; i++) rows.push(row("HR Manager", `l${i}`, "a", FROM, END)); // live
  for (let d = 3; d <= 10; d++)
    rows.push(row("HR Manager", `x${d}`, "a", "2026-07-01", addDays("2026-07-01", d - 1)));
  const m = market(build(rows), 4);
  check(
    "median over closed ads only",
    m.daysAdvertised.median === 7 && m.daysAdvertised.n === 8,
    m.daysAdvertised,
  );

  rows.pop(); // 7 closed ads
  const m2 = market(build(rows), 4);
  check("under 8 closed ads: no median", m2.daysAdvertised.median === null, m2.daysAdvertised);
}

// 7. Hotspots and per-skill counts, on live roles only.
{
  const rows: PathwayRow[] = [];
  for (let i = 0; i < 6; i++)
    rows.push(row("HR Advisor", `s${i}`, "a", FROM, END, { skills: '["Human Resources"]' }));
  for (let i = 0; i < 3; i++)
    rows.push(
      row("HR Advisor", `m${i}`, "a", FROM, END, {
        hub: "melbourne",
        skills: '["Human Resources"]',
      }),
    );
  rows.push(
    row("HR Advisor", "gone", "a", FROM, "2026-07-01", {
      hub: "perth",
      skills: '["Human Resources"]',
    }),
  );
  const m = market(build(rows), 2);
  check(
    "hubs count live roles, commonest first",
    JSON.stringify(m.hubs) === '[["sydney",6],["melbourne",3]]',
    m.hubs,
  );
  check("skillLive counts live roles", m.skillLive["Human Resources"] === 9, m.skillLive);
}

// ── The adapter, on the real dataset ─────────────────────────────────────────

check(
  "displayTitle keeps acronyms",
  displayTitle("senior hr business partner") === "Senior HR Business Partner",
);
check(
  "displayTitle keeps small words small",
  displayTitle("head of people and culture") === "Head of People and Culture",
);
check(
  "pctLabel uses a real minus",
  pctLabel(-6) === "−6%" && pctLabel(14) === "+14%" && pctLabel(0) === "0%",
);

const P = CAREER_PATHWAYS;
let maps = 0;
for (const f of P.families) {
  for (const cc of ["au", "sg", "us", "nz"]) {
    const m = careerCard(P, f.id, cc);
    if (!m) continue;
    maps++;
    const where = `${f.id}/${cc}`;
    for (const [i, n] of m.nodes.entries()) {
      check(`${where}: col is rung − 1`, n.col === n.rung - 1, n);
      if (n.parent != null) {
        const p = m.nodes[n.parent];
        check(
          `${where}: parent is the same lane, one rung down`,
          p.row === n.row && p.rung === n.rung - 1,
          [p.id, n.id],
        );
      }
      check(
        `${where}: pay label is — exactly when no median`,
        (n.pay == null) === (n.payLabel === "—"),
        n,
      );
      check(
        `${where}: trend spans the series drawn`,
        !n.trend || n.trend.days === n.series?.counts.length,
        n.id,
      );
      check(
        `${where}: series ends inside the window`,
        !n.series || n.series.to < P.window.to,
        n.series,
      );
      check(`${where}: title is never blank`, !!n.title.trim(), n.id);
      check(
        `${where}: nodes are indexed by lane then rung`,
        i === 0 ||
          m.nodes[i - 1].row < n.row ||
          (m.nodes[i - 1].row === n.row && m.nodes[i - 1].rung < n.rung),
        n.id,
      );
    }
    for (const e of m.edges) {
      const a = m.nodes[e.from];
      const b = m.nodes[e.to];
      if (e.kind === "step")
        check(
          `${where}: a step joins adjacent rungs in one lane`,
          a.row === b.row && b.rung === a.rung + 1,
          [a.id, b.id],
        );
      else
        check(
          `${where}: a converge edge joins a specialist lane to the core`,
          a.row > 0 && b.row === 0 && b.rung === a.rung + 1,
          [a.id, b.id],
        );
    }
  }
}
check("the adapter produced maps", maps > 50, maps);

const hr = careerCard(P, "hr", "au");
check("with no skill searched, only the core lane shows", hr?.lanes.length === 1, hr?.lanes);
// Two lanes at most, and the second is the specialism with the most live
// roles asking for the skill.
for (const f of P.families)
  for (const s of searchSkills(P, "au", "", 40)) {
    const m = careerCard(P, f.id, "au", s);
    if (!m) continue;
    check(`${f.id} + ${s}: at most two lanes`, m.lanes.length <= 2, m.lanes);
    if (m.lanes.length === 2) {
      const lane = m.nodes.find((n) => n.row === 1)!.track;
      const live = (t: string) =>
        P.nodes
          .filter((n) => n.family === f.id && n.track === t)
          .reduce((a, n) => a + (n.markets.au?.skillLive[s] ?? 0), 0);
      const core = m.nodes.find((n) => n.row === 0)!.track;
      const rivals = P.families
        .find((x) => x.id === f.id)!
        .tracks.filter((t) => t.id !== core && t.id !== lane);
      check(
        `${f.id} + ${s}: the lane shown asks for the skill most`,
        live(lane) > 0 && rivals.every((t) => live(t.id) <= live(lane)),
        lane,
      );
      check(
        `${f.id} + ${s}: a specialism opens only for a skill the core does not list`,
        !P.nodes.some(
          (n) => n.family === f.id && n.track === core && n.skills.some(([x]) => x === s),
        ),
        s,
      );
    }
  }
const ta = careerCard(P, "hr", "au", "Talent Acquisition");
check(
  "searching Talent Acquisition opens that lane beside the core",
  ta?.lanes.length === 2 && ta.nodes.some((n) => n.track === "talent-acquisition"),
  ta?.lanes,
);
const hrOnly = careerCard(P, "hr", "au", "Human Resources");
check("a skill the core lists opens no specialism", hrOnly?.lanes.length === 1, hrOnly?.lanes);
check(
  "HR in Australia has a core lane",
  hr?.lanes[0]?.text.startsWith("CORE PATH") === true,
  hr?.lanes,
);
check(
  "searching by description finds payroll",
  searchSkills(P, "au", "I run the pays and do the payroll").some((s) => /payroll/i.test(s)),
  searchSkills(P, "au", "I run the pays and do the payroll"),
);
const hrSkill = "Human Resources";
check(
  "a skill opens the family that advertises it most",
  familyForSkill(P, "au", hrSkill) === "hr",
  familyForSkill(P, "au", hrSkill),
);

if (failed) {
  console.error(`\n${failed} career-card check(s) failed.`);
  process.exit(1);
}
console.log(
  `✓ career card: builder rules hold on synthetic rows; ${maps} family × market maps are well-formed.`,
);
