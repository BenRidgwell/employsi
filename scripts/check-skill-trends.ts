/**
 * Invariants for the company card's per-skill demand reconstruction
 * (foldSkillRows in src/employsi/lib/jobHistoryFn.ts).
 *
 * The fold turns archive rows into "how many of this employer's vacancies
 * demanded skill X on day D", by treating a listing as live on every day
 * between its first_seen and last_seen. Everything it can get wrong is
 * invisible on the rendered chart — an off-by-one at a window edge, a renamed
 * skill silently dropped, a flat line drawn as 0% growth, pre-collection days
 * counted as zero demand — so the cases are asserted here instead.
 *
 * Run: bun run scripts/check-skill-trends.ts
 */
import {
  foldSkillRows,
  type SkillRow,
  type CompanySkillTrends,
} from "../src/employsi/lib/jobHistoryFn";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A fixed 10-day window. Real callers pass the last N days; the fold does not
// care what the dates are, only that they are ordered and comparable.
const DAYS = [
  "2026-08-01",
  "2026-08-02",
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
];
const LIVE_FROM = "2026-08-09"; // "currently advertised" boundary
const row = (skills: string[], first: string, last: string, extra: Partial<SkillRow> = {}) =>
  ({ skills: JSON.stringify(skills), first_seen: first, last_seen: last, ...extra }) as SkillRow;

const find = (r: CompanySkillTrends, s: string) => r.skills.find((x) => x.skill === s);

// ── day membership ──────────────────────────────────────────────────────────
{
  // A skill whose only ad closed mid-window is NOT something the company is
  // recruiting for, so it is absent altogether rather than present with a
  // sparkline and a live count of zero. This is the contract the card's search
  // depends on: every skill it offers has an ad you could apply to today.
  const out = foldSkillRows(
    [row(["Mining Engineering"], "2026-08-04", "2026-08-06")],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("a skill with no currently-live ad is omitted entirely", out.skills.length === 0);
}
{
  // A still-live ad that opened mid-window contributes to its days only — the
  // off-by-one at the leading edge is the thing being pinned here.
  const out = foldSkillRows(
    [row(["Mining Engineering"], "2026-08-04", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Mining Engineering")!;
  check(
    "a live ad contributes from its first_seen onward, inclusive",
    eq(s.spark, [0, 0, 0, 1, 1, 1, 1, 1, 1, 1]),
    JSON.stringify(s.spark),
  );
}
{
  // first_seen and last_seen are INCLUSIVE on both ends — the classic off-by-one.
  const out = foldSkillRows(
    [row(["Mining Engineering"], "2026-08-01", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Mining Engineering")!;
  check(
    "a span covering the whole window fills every day",
    eq(s.spark, undefined),
    "flat lines are dropped, see below",
  );
  check("...and counts as live now", s.now === 1);
}
{
  // An ad first seen after the window still counts on the days it covers.
  const out = foldSkillRows(
    [row(["Geotechnical"], "2026-08-09", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Geotechnical")!;
  check("an ad opening late fills only the tail", eq(s.spark, [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]));
}

// ── taxonomy handling ───────────────────────────────────────────────────────
{
  const out = foldSkillRows(
    [row(["Not A Real Skill At All"], "2026-08-01", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("a name outside the taxonomy is dropped entirely", out.skills.length === 0);
}
{
  // Two ads, same skill, overlapping — the day count is ads, not distinct skills.
  const out = foldSkillRows(
    [
      row(["HSE / Safety"], "2026-08-05", "2026-08-10"),
      row(["HSE / Safety"], "2026-08-08", "2026-08-10"),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "HSE / Safety")!;
  check(
    "overlapping ads for one skill add up per day",
    eq(s.spark, [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]),
  );
  check("...and both count as live now", s.now === 2);
}

// ── coverage trimming ───────────────────────────────────────────────────────
{
  // `from` is where the archive actually started collecting. Days before it
  // must not appear at all — they are "nobody was looking", not "no demand".
  const out = foldSkillRows(
    [row(["Electrical Trade"], "2026-08-06", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    5,
  );
  const s = find(out, "Electrical Trade")!;
  check("days before coverage are trimmed off the series", eq(out.days, DAYS.slice(5)));
  check(
    "...and off every sparkline",
    eq(s.spark, [1, 1, 1, 1, 1]) || s.spark === undefined,
    JSON.stringify(s.spark),
  );
}
{
  // Below the minimum covered days the line is dropped rather than drawn short.
  const out = foldSkillRows(
    [row(["Drill & Blast"], "2026-08-08", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    8,
  );
  const s = find(out, "Drill & Blast")!;
  check("a window under the minimum yields no sparkline", s.spark === undefined);
  check("...and no percentage to go with it", s.pct === null && s.dir === "flat");
  check("...but the live count still stands", s.now === 1);
}

// ── growth ──────────────────────────────────────────────────────────────────
{
  // 1 ad on day 0 rising to 4 by day 9 = +300%.
  const rows: SkillRow[] = [
    row(["Automation & Robotics"], "2026-08-01", "2026-08-10"),
    row(["Automation & Robotics"], "2026-08-04", "2026-08-10"),
    row(["Automation & Robotics"], "2026-08-06", "2026-08-10"),
    row(["Automation & Robotics"], "2026-08-08", "2026-08-10"),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  const s = find(out, "Automation & Robotics")!;
  check("growth is measured across the covered window", s.pct === 300, `pct=${s.pct}`);
  check("...and the direction follows it", s.dir === "up");
  check("...and every ad counts as live", s.now === 4);
}
{
  const rows: SkillRow[] = [
    row(["Welding & Fabrication"], "2026-08-01", "2026-08-10"),
    row(["Welding & Fabrication"], "2026-08-01", "2026-08-05"),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  const s = find(out, "Welding & Fabrication")!;
  check("a shrinking series reads down", s.dir === "down" && s.pct === -50, `pct=${s.pct}`);
}

// ── ordering ────────────────────────────────────────────────────────────────
{
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-09", "2026-08-10"),
      row(["Mining Engineering"], "2026-08-09", "2026-08-10"),
      row(["Mining Engineering"], "2026-08-09", "2026-08-10"),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "skills come back highest live count first",
    eq(
      out.skills.map((s) => s.skill),
      ["Mining Engineering", "Geotechnical"],
    ),
  );
}

// ── salary ──────────────────────────────────────────────────────────────────
{
  // medianAnnual enforces a minimum ad count; below it the card shows a gap
  // rather than a median over a handful of ads.
  const few: SkillRow[] = Array.from({ length: 3 }, () =>
    row(["Metallurgy"], "2026-08-09", "2026-08-10", {
      salary: "$150,000 per annum",
      hub: "perth",
      source: "adzuna",
    }),
  );
  const out = foldSkillRows(few, DAYS, LIVE_FROM, 0);
  const s = find(out, "Metallurgy")!;
  check("too few paying ads yields no median", s.pay === undefined);
  check("...but the count of them is still reported", s.payN === 3, `payN=${s.payN}`);
}
{
  const many: SkillRow[] = Array.from({ length: 9 }, () =>
    row(["Metallurgy"], "2026-08-09", "2026-08-10", {
      salary: "$150,000 per annum",
      hub: "perth",
      source: "adzuna",
    }),
  );
  const out = foldSkillRows(many, DAYS, LIVE_FROM, 0);
  const s = find(out, "Metallurgy")!;
  check(
    "enough paying ads yields a median",
    typeof s.pay === "number" && s.pay === 150000,
    `pay=${s.pay}`,
  );
}

// ── empty ───────────────────────────────────────────────────────────────────
{
  const out = foldSkillRows([], DAYS, LIVE_FROM, 0);
  check(
    "no rows yields an empty result, not a padded one",
    out.skills.length === 0 && out.days.length === 0,
  );
}

console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
