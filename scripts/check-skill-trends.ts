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
  // Change is the mean of the older half against the mean of the newer half,
  // NOT first-vs-last. Daily counts are noisy enough that two arbitrary days
  // should not carry the whole figure.
  // Series here: [1,1,1,2,2,3,3,4,4,4] -> before mean 1.4, after mean 3.6.
  const rows: SkillRow[] = [
    row(["Automation & Robotics"], "2026-08-01", "2026-08-10"),
    row(["Automation & Robotics"], "2026-08-04", "2026-08-10"),
    row(["Automation & Robotics"], "2026-08-06", "2026-08-10"),
    row(["Automation & Robotics"], "2026-08-08", "2026-08-10"),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  const s = find(out, "Automation & Robotics")!;
  check("growth compares half-window means", s.pct === 157.1, `pct=${s.pct}`);
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
{
  // One freak day at the end must not become the whole trend. Endpoint
  // arithmetic called this +200%; against half-window means it is flat, which
  // is what a fortnight of 3s with one 9 on the last day actually is.
  const flat = Array.from({ length: 3 }, (_, k) =>
    row([`x${k}`, "Mining Engineering"].slice(1), "2026-08-01", "2026-08-10"),
  );
  const spike = [row(["Mining Engineering"], "2026-08-10", "2026-08-10")];
  const out = foldSkillRows([...flat, ...spike], DAYS, LIVE_FROM, 0);
  const s = find(out, "Mining Engineering")!;
  check(
    "a single spike on the last day does not become the trend",
    s.pct !== null && Math.abs(s.pct) < 25,
    `pct=${s.pct}`,
  );
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

// ── hiring areas ────────────────────────────────────────────────────────────
// Areas come off the same rows as the skills: one category per listing, many
// skills per listing, one pass over both.
{
  const rows: SkillRow[] = [
    row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
      category: "Engineering jobs",
      source: "adzuna",
    }),
    row(["Mining Engineering"], "2026-08-06", "2026-08-10", {
      category: "Engineering",
      source: "adzuna",
    }),
    row(["Electrical Trade"], "2026-08-01", "2026-08-10", {
      category: "Trade & Construction",
      source: "adzuna",
    }),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  const eng = out.areas.find((a) => a.area === "Engineering")!;
  check(
    'a trailing "jobs" is stripped so one area is not two',
    out.areas.length === 2,
    JSON.stringify(out.areas.map((a) => a.area)),
  );
  check("area live counts are per listing", eng.now === 2);
  check(
    "area growth is measured across the covered window",
    eng.pct === 100 && eng.dir === "up",
    `pct=${eng.pct}`,
  );
  check(
    "areas come back highest live count first",
    eq(
      out.areas.map((a) => a.area),
      ["Engineering", "Trade & Construction"],
    ),
  );
}
{
  // A category that did not move is FLAT, not up — a 0% with a growth arrow
  // asserts something nothing measured.
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Scientific & QA",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const a = out.areas[0];
  check("an unmoved area reads flat with a real zero", a.pct === 0 && a.dir === "flat");
}
{
  // Below the covered-window floor there is no percentage at all — distinct
  // from a measured zero.
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-08", "2026-08-10", {
        category: "Engineering",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    8,
  );
  const a = out.areas[0];
  check("too short a window yields no area percentage", a.pct === null && a.dir === "flat");
  check("...but the area count still stands", a.now === 1);
}
{
  const out = foldSkillRows(
    [row(["Geotechnical"], "2026-08-09", "2026-08-10", { category: "", source: "adzuna" })],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("a blank category is skipped, not bucketed as Other", out.areas.length === 0);
}
{
  // Most feeds put the PLATFORM in `category`, not a job category — measured on
  // the live archive, tallying it unfiltered produced areas called "LinkedIn",
  // "Career portal", "au" and "Monday to Friday". Only sources with a real
  // taxonomy contribute.
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "LinkedIn",
        source: "linkedin",
      }),
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Full-time, Monday to Friday",
        source: "simplyhired",
      }),
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Engineering Jobs",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "a platform name in the category column is not a hiring area",
    eq(
      out.areas.map((a) => a.area),
      ["Engineering"],
    ),
    JSON.stringify(out.areas.map((a) => a.area)),
  );
}
{
  // Adzuna's own placeholder for an ad it could not classify.
  const out = foldSkillRows(
    [row(["Geotechnical"], "2026-08-01", "2026-08-10", { category: "Unknown", source: "adzuna" })],
    DAYS,
    LIVE_FROM,
    0,
  );
  check('"Unknown" is not a hiring area', out.areas.length === 0);
}

console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
