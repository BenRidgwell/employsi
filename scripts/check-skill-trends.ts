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
  alternateBySign,
  foldSkillRows,
  foldSkillMarket,
  foldSkillRanks,
  roleKeyByCompanyTitle,
  type SkillRow,
  type MarketRow,
  type RankRow,
  type CompanySkillTrends,
} from "../src/employsi/lib/jobHistoryFn";
import { REGION_HUBS, REGION_LABEL } from "../src/employsi/data/mapboxWorldGeo";
import {
  centreOf,
  FRAME_ASPECT,
  FRAME_FLOOR,
  frameFor,
  maxZoomFor,
  zoomFrame,
} from "../src/employsi/lib/hotspotFrame";
import { LABOUR_EVENTS } from "../src/employsi/data/labourEvents";
import { monthsBetween } from "../src/employsi/lib/jobHistoryFn";
import { demandByCompanyAt } from "../src/employsi/lib/skillHeat";
import { IVI_MONTHS } from "../src/employsi/data/iviSkillDemand";
import {
  TIMELINE_LABEL,
  TIMELINE_SPAN,
  eventIndex,
  monthLabel,
} from "../src/employsi/lib/skillCard";
import {
  ALL_SKILLS,
  SKILL_CATEGORY,
  SKILL_PARENT,
  SKILL_CHILDREN,
  dropRedundantKin,
  searchSkillMatches,
  withParent,
} from "../src/employsi/data/skillsTaxonomy";
import { buildSkillCard, TIMELINE_SPAN } from "../src/employsi/lib/skillCard";
import { activeSkill } from "../src/employsi/lib/skillHeat";

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

/**
 * A full-window ad in an unrelated skill, from the same (unnamed) feed.
 *
 * The fold trims every series back to the day the employer's feeds had actually
 * arrived — otherwise a feed switching on mid-window draws its own arrival as a
 * hiring surge (see feedStart). A case built from ONE short-lived ad therefore
 * looks like a feed that started on that ad's first day, and the window
 * collapses to it, which is right in production and useless in a test that is
 * pinning day-membership at the leading edge.
 *
 * Including this makes the fixture say what those cases mean: the feed covered
 * the whole window, and the ad under test is what moved within it. A different
 * skill, so the series being asserted on is untouched.
 */
const ANCHOR = row(["Administration & Office Support"], DAYS[0], DAYS[DAYS.length - 1]);

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
    [ANCHOR, row(["Mining Engineering"], "2026-08-04", "2026-08-10")],
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
    [ANCHOR, row(["Geotechnical"], "2026-08-09", "2026-08-10")],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Geotechnical")!;
  check("an ad opening late fills only the tail", eq(s.spark, [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]));
}

// ── one role, many feeds ────────────────────────────────────────────────────
//
// `job_key` is `source|title|company|location`, so the archive dedupes WITHIN a
// feed only: one vacancy posted to four boards is four rows, and the boards
// disagree about the location string enough that nothing else collapses them.
// Measured on the live archive 2026-09-07, Rio Tinto's card read "Construction
// Management — 30 live ads" over 13 real roles; roster-wide, 28,275 rows stood
// for 20,412 vacancies. The vacancy chart has folded by normalised title since
// it was written; this fold did not, so the line and the count beside it were
// measuring different things.
//
// Rows carry titles here, unlike everywhere else in this file — the cases above
// leave the column unset, which keeps every one of them its own vacancy.
{
  const four = ["indeed", "jora", "adzuna", "seek"].map((source) =>
    row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
      title: "Construction Manager",
      source,
      hub: "perth",
    }),
  );
  const out = foldSkillRows(four, DAYS, LIVE_FROM, 0);
  const s = find(out, "Mining Engineering")!;
  check("one role on four feeds is one live ad", out.liveAds === 1, `liveAds=${out.liveAds}`);
  check("...and one unit of skill demand", s.now === 1, `now=${s.now}`);
  check(
    "...and one hot spot, not four",
    eq(out.hubs, [{ hub: "perth", n: 1 }]),
    JSON.stringify(out.hubs),
  );
}
{
  // Punctuation and case are exactly what the feeds disagree about.
  const out = foldSkillRows(
    [
      row(["Metallurgy"], "2026-08-01", "2026-08-10", { title: "Senior Metallurgist" }),
      row(["Metallurgy"], "2026-08-01", "2026-08-10", { title: "senior  metallurgist" }),
      row(["Metallurgy"], "2026-08-01", "2026-08-10", { title: "Senior Metallurgist!" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("titles differing only in case or punctuation are one role", out.liveAds === 1);
}
{
  const out = foldSkillRows(
    [
      row(["Metallurgy"], "2026-08-01", "2026-08-10", { title: "Senior Metallurgist" }),
      row(["Metallurgy"], "2026-08-01", "2026-08-10", { title: "Junior Metallurgist" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("genuinely different titles stay two roles", out.liveAds === 2, `${out.liveAds}`);
}
{
  // Feeds see the same vacancy over different stretches. The role was open
  // across the union of them, and every feed's spans are kept — so a gap NO
  // feed covered stays a gap, rather than being bridged by a min/max span.
  //
  // One anchor PER FEED, because feedStart trims the window to the last feed
  // to arrive and here the two feeds' geotech rows begin eight days apart —
  // without them the window collapses to the tail and there is no gap left to
  // assert on.
  const out = foldSkillRows(
    [
      row(["Administration & Office Support"], DAYS[0], DAYS[9], {
        title: "Site Admin",
        source: "jora",
      }),
      row(["Administration & Office Support"], DAYS[0], DAYS[9], {
        title: "Rosters Clerk",
        source: "seek",
      }),
      row(["Geotechnical"], "2026-08-01", "2026-08-02", { title: "Geotech Lead", source: "jora" }),
      row(["Geotechnical"], "2026-08-09", "2026-08-10", { title: "Geotech Lead", source: "seek" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Geotechnical")!;
  check(
    "a role's days are the union of its feeds' spans, gap included",
    eq(s.spark, [1, 1, 0, 0, 0, 0, 0, 0, 1, 1]),
    JSON.stringify(s.spark),
  );
  check("...and it is one live ad, not two", s.now === 1, `now=${s.now}`);
}
{
  // One feed's copy of an ad mentions a skill the other's does not. The
  // vacancy asked for both, so the union is what it demanded.
  const out = foldSkillRows(
    [
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        title: "Mine Planner",
        source: "jora",
      }),
      row(["Metallurgy"], "2026-08-01", "2026-08-10", { title: "Mine Planner", source: "seek" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("a role demands the union of its feeds' skills", out.skills.length === 2);
  check("...and is still one ad", out.liveAds === 1, `liveAds=${out.liveAds}`);
}
{
  // A board that stopped refreshing does not close a vacancy the others still
  // advertise — the role is live if ANY feed still carries it.
  const out = foldSkillRows(
    [
      ANCHOR,
      row(["Geotechnical"], "2026-08-01", "2026-08-04", { title: "Geotech Lead", source: "jora" }),
      row(["Geotechnical"], "2026-08-01", "2026-08-10", { title: "Geotech Lead", source: "seek" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("a role one stale feed dropped is still live", find(out, "Geotechnical")?.now === 1);
}
{
  // Feeds label the same vacancy with different locations — that IS the reason
  // the rows do not collapse in the archive. The role is counted once, under
  // the location most of its feeds gave it.
  const hub = (h: string, source: string) =>
    row(["Mining Engineering"], "2026-08-09", "2026-08-10", {
      title: "Shift Super",
      hub: h,
      source,
    });
  const out = foldSkillRows(
    [hub("perth", "jora"), hub("perth", "seek"), hub("adelaide", "indeed")],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "a role sits in one hub, the one most of its feeds named",
    eq(out.hubs, [{ hub: "perth", n: 1 }]),
    JSON.stringify(out.hubs),
  );
}
{
  // The feed-arrival guard reads RAW rows on purpose: it answers "when did this
  // feed start covering this employer, and how much does it carry". Folding it
  // by title would make a feed's weight the number of roles it shares with the
  // others, and a late feed could then veto — or fail to trim — the window on
  // the wrong evidence. Here one feed joined on day 6 carrying most of the
  // rows, and the window must still start there even though every one of its
  // rows duplicates a role another feed already had.
  const dup = (t: string, first: string, source: string) =>
    row(["Mining Engineering"], first, "2026-08-10", { title: t, source });
  const out = foldSkillRows(
    [
      dup("Role A", "2026-08-01", "jora"),
      dup("Role B", "2026-08-06", "seek"),
      dup("Role C", "2026-08-06", "seek"),
      dup("Role D", "2026-08-06", "seek"),
      dup("Role B", "2026-08-06", "jora"),
      dup("Role C", "2026-08-06", "jora"),
      dup("Role D", "2026-08-06", "jora"),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "feed arrival is still measured on raw rows, so the window trims to the late feed",
    eq(out.days, DAYS.slice(5)),
    JSON.stringify(out.days),
  );
  check("...over four roles, not seven rows", out.liveAds === 4, `liveAds=${out.liveAds}`);
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
      ANCHOR,
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
  // Four ads down to two. Volume matters: under SKILL_MIN_VOLUME the fold
  // reports no percentage at all, which is the point of the floor.
  const rows: SkillRow[] = [
    row(["Welding & Fabrication"], "2026-08-01", "2026-08-10"),
    row(["Welding & Fabrication"], "2026-08-01", "2026-08-10"),
    row(["Welding & Fabrication"], "2026-08-01", "2026-08-05"),
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
  check("area live counts are per listing", eng.now === 3);
  check(
    "area growth compares half-window means",
    eng.pct === 200 && eng.dir === "up",
    `pct=${eng.pct}`,
  );
  check(
    "areas come back highest live count first",
    eq(
      out.areas.map((a) => a.area),
      ["Engineering", "Trades & Construction"],
    ),
  );
}
{
  // A category that did not move is FLAT, not up — a 0% with a growth arrow
  // asserts something nothing measured.
  const out = foldSkillRows(
    Array.from({ length: 3 }, () =>
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Scientific & QA",
        source: "adzuna",
      }),
    ),
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

// ── hot spots ───────────────────────────────────────────────────────────────
{
  const out = foldSkillRows(
    [
      row(["Mining Engineering"], "2026-08-09", "2026-08-10", { hub: "perth" }),
      row(["Mining Engineering"], "2026-08-09", "2026-08-10", { hub: "perth" }),
      row(["Mining Engineering"], "2026-08-09", "2026-08-10", { hub: "adelaide" }),
      row(["Mining Engineering"], "2026-08-09", "2026-08-10", { hub: "" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Mining Engineering")!;
  check(
    "hot spots are counted per hub, busiest first",
    eq(s.hubs, [
      { hub: "perth", n: 2 },
      { hub: "adelaide", n: 1 },
    ]),
    JSON.stringify(s.hubs),
  );
  check("an ad with no hub is counted, not dropped", s.hubless === 1);
  check(
    "...and the two together account for every live ad",
    s.hubs.reduce((t, h) => t + h.n, 0) + s.hubless === s.now,
  );
}
{
  // A hub only counts while the ad is live: the map answers "where are they
  // hiring this now", not "where have they ever".
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-01", "2026-08-05", { hub: "brisbane" }),
      row(["Geotechnical"], "2026-08-09", "2026-08-10", { hub: "perth" }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Geotechnical")!;
  check(
    "a hub whose ads have all closed is not a hot spot",
    eq(s.hubs, [{ hub: "perth", n: 1 }]),
    JSON.stringify(s.hubs),
  );
}

// ── volume floor ────────────────────────────────────────────────────────────
{
  // One ad appearing is +100% and means nothing. Measured on the live archive,
  // the untrimmed tail reported Geotechnical at +1,500% (0 -> 3 ads) next to a
  // real +7%, which makes the two read as the same kind of fact.
  const out = foldSkillRows(
    [
      ANCHOR,
      row(["Geotechnical"], "2026-08-07", "2026-08-10"),
      row(["Geotechnical"], "2026-08-09", "2026-08-10"),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const s = find(out, "Geotechnical")!;
  check("a skill too thin to trend reports no percentage", s.pct === null, `pct=${s.pct}`);
  check("...but keeps its count and its line", s.now === 2 && !!s.spark);
}
{
  // Three on the busiest day clears the floor.
  const rows: SkillRow[] = [
    row(["Mining Engineering"], "2026-08-01", "2026-08-10"),
    row(["Mining Engineering"], "2026-08-05", "2026-08-10"),
    row(["Mining Engineering"], "2026-08-07", "2026-08-10"),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  check("a skill with enough volume still trends", find(out, "Mining Engineering")!.pct !== null);
}

// ── the two taxonomies meet in one vocabulary ───────────────────────────────
{
  // SEEK and Adzuna name the same work differently. Left unmapped they would
  // arrive as two areas splitting one count between them.
  const out = foldSkillRows(
    [
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        category: "Engineering",
        source: "seek",
      }),
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        category: "Engineering Jobs",
        source: "adzuna",
      }),
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        category: "Engineering",
        source: "seek",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "SEEK and Adzuna fold into one area, not two",
    eq(
      out.areas.map((a) => `${a.area}:${a.now}`),
      ["Engineering:3"],
    ),
    JSON.stringify(out.areas.map((a) => `${a.area}:${a.now}`)),
  );
}
{
  // SEEK's largest category on this roster has no Adzuna equivalent, which is
  // why the target vocabulary is a third one rather than Adzuna's.
  const out = foldSkillRows(
    [
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        category: "Mining, Resources & Energy",
        source: "seek",
      }),
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        category: "Energy, Oil & Gas Jobs",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "SEEK's mining bucket and Adzuna's energy one share a canonical area",
    eq(
      out.areas.map((a) => a.area),
      ["Mining, Resources & Energy"],
    ),
    JSON.stringify(out.areas.map((a) => a.area)),
  );
}
{
  // SEEK bundles manufacturing with transport; Adzuna splits them. The bundle
  // wins, because splitting SEEK's one into Adzuna's two would be a guess.
  const out = foldSkillRows(
    [
      row(["Mechanical Fitting"], "2026-08-01", "2026-08-10", {
        category: "Manufacturing, Transport & Logistics",
        source: "seek",
      }),
      row(["Mechanical Fitting"], "2026-08-01", "2026-08-10", {
        category: "Logistics & Warehouse Jobs",
        source: "adzuna",
      }),
      row(["Mechanical Fitting"], "2026-08-01", "2026-08-10", {
        category: "Manufacturing Jobs",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "the coarser grain wins where the taxonomies disagree",
    eq(
      out.areas.map((a) => `${a.area}:${a.now}`),
      ["Manufacturing, Transport & Logistics:3"],
    ),
    JSON.stringify(out.areas.map((a) => `${a.area}:${a.now}`)),
  );
}
{
  // Adzuna publishes its French-market categories in French. Same categories.
  const out = foldSkillRows(
    [
      row(["HSE / Safety"], "2026-08-01", "2026-08-10", {
        category: "Emplois Soins de santé et infirmiers",
        source: "adzuna",
      }),
      row(["HSE / Safety"], "2026-08-01", "2026-08-10", {
        category: "Healthcare & Nursing Jobs",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "a category published in French is the same area",
    eq(
      out.areas.map((a) => `${a.area}:${a.now}`),
      ["Healthcare & Medical:2"],
    ),
    JSON.stringify(out.areas.map((a) => `${a.area}:${a.now}`)),
  );
}
{
  // A working pattern is not a part of a business.
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Part time Jobs",
        source: "adzuna",
      }),
      row(["Geotechnical"], "2026-08-01", "2026-08-10", { category: "Unknown", source: "adzuna" }),
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Other/General Jobs",
        source: "adzuna",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "a working pattern or seniority band is not an area",
    out.areas.length === 0,
    JSON.stringify(out.areas),
  );
}
{
  // A board category nobody has mapped is dropped, not turned into a bar.
  const out = foldSkillRows(
    [
      row(["Geotechnical"], "2026-08-01", "2026-08-10", {
        category: "Underwater Basket Weaving",
        source: "seek",
      }),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  check("an unmapped board category is left unclassified", out.areas.length === 0);
}

// ── a feed that joined late ─────────────────────────────────────────────────
{
  // Adzuna has covered this employer all window; SEEK's rows all begin on day
  // 8. The areas SEEK carries climb from nothing — as collection, not hiring.
  // Measured live when SEEK was added: Mater's Healthcare & Medical came out at
  // +996% over a fortnight in which nothing much happened.
  const rows: SkillRow[] = [
    ...Array.from({ length: 4 }, () =>
      row(["HSE / Safety"], "2026-08-01", "2026-08-10", {
        category: "Healthcare & Nursing Jobs",
        source: "adzuna",
      }),
    ),
    ...Array.from({ length: 20 }, () =>
      row(["HSE / Safety"], "2026-08-08", "2026-08-10", {
        category: "Healthcare & Medical",
        source: "seek",
      }),
    ),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  const a = out.areas[0];
  check("a late-joining feed still contributes its ads", a.now === 24, `now=${a.now}`);
  check("...but no trend is reported over its ramp", a.pct === null, `pct=${a.pct}`);
}
{
  // The guard must not punish an employer whose feeds all covered the window.
  const rows: SkillRow[] = Array.from({ length: 4 }, (_, k) =>
    row(["Mining Engineering"], "2026-08-01", k < 2 ? "2026-08-05" : "2026-08-10", {
      category: "Engineering Jobs",
      source: "adzuna",
    }),
  );
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  check(
    "one feed present throughout still trends",
    out.areas[0].pct !== null,
    `pct=${out.areas[0]?.pct}`,
  );
}

// ── feed coverage: where a SERIES can honestly start ────────────────────────
// Not the same question as `from`. That is the day the ARCHIVE began; this is
// the day THIS EMPLOYER was essentially fully covered. Feeds arrive on their
// own schedules, and until the last of them is on, the daily count climbs
// because the archive is filling out. Measured on production 2026-08-12, BHP's
// ten feeds first appear across 07-16 to 08-03 and its live-on-day count runs
// 11 -> 105 -> 215 -> 375 -> 452 over that stretch; folded across 30 days its
// top skill reported +347.6%.
{
  // Two feeds. The big one runs throughout, the other switches on at day 6 —
  // so the days before that are missing a third of the picture and the series
  // must not start there.
  const rows: SkillRow[] = [
    ...Array.from({ length: 6 }, () =>
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", { source: "adzuna" }),
    ),
    ...Array.from({ length: 4 }, () =>
      row(["Mining Engineering"], "2026-08-06", "2026-08-10", { source: "seek" }),
    ),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  check(
    "a series starts where the late feed arrived, not where the archive did",
    eq(out.days, DAYS.slice(5)),
    JSON.stringify(out.days),
  );
  const s = find(out, "Mining Engineering")!;
  check(
    "...and the sparkline is trimmed to match",
    s.spark === undefined || s.spark.length === out.days.length,
    `spark=${s.spark?.length} days=${out.days.length}`,
  );
  check("...while every live ad still counts", s.now === 10, `now=${s.now}`);
}
{
  // The whole point of weighting. A feed carrying 2 of 42 ads that only shows
  // up on the last day must NOT collapse the window to one day — `sourceStart`
  // is the oldest row a feed still has, so a small fast-churn feed always looks
  // like it just started.
  const rows: SkillRow[] = [
    ...Array.from({ length: 40 }, () =>
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", { source: "adzuna" }),
    ),
    ...Array.from({ length: 2 }, () =>
      row(["Mining Engineering"], "2026-08-10", "2026-08-10", { source: "jora" }),
    ),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  check(
    "a feed under the coverage target cannot veto the window",
    eq(out.days, DAYS),
    JSON.stringify(out.days),
  );
}
{
  // ...and the coverage trim still wins where it is the later of the two. A
  // guard that replaced `from` instead of flooring it would resurrect
  // pre-collection days.
  const rows: SkillRow[] = Array.from({ length: 4 }, () =>
    row(["Mining Engineering"], "2026-08-01", "2026-08-10", { source: "adzuna" }),
  );
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 4);
  check(
    "the archive-wide coverage start is a floor, never overridden",
    eq(out.days, DAYS.slice(4)),
    JSON.stringify(out.days),
  );
}
{
  // Areas rest on a subset of the feeds, so their own window can differ — but
  // never start earlier than the point the employer was covered at all.
  const rows: SkillRow[] = [
    ...Array.from({ length: 20 }, () =>
      row(["Mining Engineering"], "2026-08-01", "2026-08-10", {
        source: "adzuna",
        category: "Engineering Jobs",
      }),
    ),
    ...Array.from({ length: 20 }, () =>
      row(["Mining Engineering"], "2026-08-04", "2026-08-10", { source: "portal-sf" }),
    ),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  check(
    "areaDays never exceeds the days the employer was covered for",
    out.areaDays <= out.days.length,
    `areaDays=${out.areaDays} days=${out.days.length}`,
  );
  check("areaDays is reported for the bars' heading", out.areaDays === out.days.length);
}
{
  // newSpark is index-aligned with spark. It used to be sized to the ALREADY
  // trimmed series and then trimmed again, so it came up short — and empty once
  // the window outran the archive by more than half.
  const rows: SkillRow[] = [
    row(["Mining Engineering"], "2026-08-01", "2026-08-10", { source: "adzuna" }),
    row(["Mining Engineering"], "2026-08-05", "2026-08-10", { source: "adzuna" }),
    row(["Mining Engineering"], "2026-08-07", "2026-08-10", { source: "adzuna" }),
    // No new ads of its own, so it takes the zero-filled fallback path.
    row(["Electrical Trade"], "2026-07-20", "2026-08-10", { source: "adzuna" }),
    row(["Electrical Trade"], "2026-07-21", "2026-08-09", { source: "adzuna" }),
    row(["Electrical Trade"], "2026-07-22", "2026-08-06", { source: "adzuna" }),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 3);
  for (const s of out.skills) {
    if (!s.spark) continue;
    check(
      `newSpark aligns with spark for ${s.skill}`,
      s.newSpark?.length === s.spark.length,
      `new=${s.newSpark?.length} spark=${s.spark.length}`,
    );
  }
}

// ── specialities, and the ads that named none ───────────────────────────────
//
// The card lists a speciality under the skill it narrows, and reports how many
// of that skill's ads named one at all. `specialised` is what that line rests
// on, and it must be counted PER AD: one ad can carry two specialities, so
// summing the children would put the named share above the ads it came from.
{
  const t = (title: string, skills: string[]) =>
    row(skills, DAYS[0], DAYS[9], { title, source: "seek" });
  const out = foldSkillRows(
    [
      t("Registered Nurse A", ["Nursing"]),
      t("Registered Nurse B", ["Nursing"]),
      t("Registered Midwife", ["Nursing", "Midwifery"]),
      // One ad, two specialities — the case that makes summing wrong.
      t("Nurse Practitioner - Emergency Department", [
        "Nursing",
        "Nurse Practitioner",
        "Emergency Nursing",
      ]),
    ],
    DAYS,
    LIVE_FROM,
    0,
  );
  const nursing = find(out, "Nursing")!;
  check("the parent still counts every one of its ads", nursing.now === 4, `${nursing.now}`);
  check(
    "specialised counts ADS, not specialities",
    nursing.specialised === 2,
    `${nursing.specialised} (the three child rows sum to 3)`,
  );
  const kids = out.skills.filter((s) => s.skill !== "Nursing");
  check(
    "...and the children really do sum to more",
    kids.reduce((a, k) => a + k.now, 0) === 3,
    `${kids.reduce((a, k) => a + k.now, 0)}`,
  );
  check(
    "the remainder is the parent's ads that named nothing",
    nursing.now - nursing.specialised! === 2,
    `${nursing.now - nursing.specialised!}`,
  );
}
{
  // A skill with no specialities advertised says nothing about specialisation,
  // rather than reporting zero — which would read as a finding about the
  // employer instead of silence about the taxonomy.
  const out = foldSkillRows(
    [row(["Pharmacy"], DAYS[0], DAYS[9], { title: "Pharmacist", source: "seek" })],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "a skill with no speciality advertised reports none",
    find(out, "Pharmacy")!.specialised === undefined,
  );
}
{
  // A speciality on an ad whose parent is NOT stored cannot contribute: the
  // figure is "of this skill's ads", so it needs the skill to be there.
  const out = foldSkillRows(
    [row(["Midwifery"], DAYS[0], DAYS[9], { title: "Registered Midwife", source: "seek" })],
    DAYS,
    LIVE_FROM,
    0,
  );
  check(
    "an orphaned speciality does not invent a parent figure",
    find(out, "Nursing") === undefined && find(out, "Midwifery")!.specialised === undefined,
  );
}

// ── the skills market ───────────────────────────────────────────────────────
// foldSkillMarket prices each skill by median advertised salary and multiplies
// by live vacancies. Three quantities that must not blur: price is near-static,
// volume moves, value is the product. Everything asserted here is invisible on
// a rendered ticker — a wrong price still looks like a price.

const MK = (
  skills: string[],
  first: string,
  last: string,
  extra: Partial<MarketRow> = {},
): MarketRow => ({ skills: JSON.stringify(skills), first_seen: first, last_seen: last, ...extra });
const AS_OF = DAYS[DAYS.length - 1];
const COUNTRY: Record<string, string> = {
  perth: "au",
  sydney: "au",
  singapore: "sg",
  manila: "ph",
};
const mkOpts = (worldwide: boolean) => ({
  worldwide,
  scope: "Test",
  fxAsAt: "2026-08-03",
  countryOf: (h: string) => COUNTRY[h] ?? "",
});
// A feed present across the whole window, so the coverage trim does not fire.
const MK_ANCHOR = Array.from({ length: 3 }, () =>
  MK(["Administration & Office Support"], DAYS[0], AS_OF, {
    source: "adzuna",
    hub: "perth",
    salary: "90000",
  }),
);

{
  // Eight priced ads at one figure: the median is that figure, and value is it
  // times the live count. The 8-ad floor is salaryParse.MIN_ADS.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 8 }, () =>
      MK(["Mining Engineering"], DAYS[0], AS_OF, {
        source: "adzuna",
        hub: "perth",
        salary: "150000",
      }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  const r = m.rows.find((x) => x.skill === "Mining Engineering")!;
  check("a priced skill takes the median of its ads", r.pay === 150000, `pay=${r.pay}`);
  check("...over the ads it actually has", r.payN === 8, `n=${r.payN}`);
  check(
    "value is price x live vacancies",
    r.value === 150000 * r.now,
    `${r.value} vs ${150000 * r.now}`,
  );
  check("a scoped read counts as one market", r.payMarkets === 1, `${r.payMarkets}`);
}
{
  // Under the floor: demand is real, the price is not reportable. The row must
  // survive — a skill being hired for without disclosed pay is a fact.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 7 }, () =>
      MK(["Geology"], DAYS[0], AS_OF, { source: "adzuna", hub: "perth", salary: "150000" }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  const r = m.rows.find((x) => x.skill === "Geology");
  check("a thin skill stays in the list", !!r, "row missing");
  check("...with no price", r?.pay === null, `pay=${r?.pay}`);
  check("...and a NULL value, never zero", r?.value === null, `value=${r?.value}`);
  check("...but its demand still counts", r?.now === 7, `now=${r?.now}`);
  // ALL_SKILLS.length rather than a literal. This read `=== 100` and broke the
  // moment a skill was added (Strategy, 2026-09-25) — a check that fails for
  // the taxonomy GROWING is a check nobody can trust, because the failure says
  // nothing about the thing it names. What it means to assert is that the header
  // reports the taxonomy's size, so it asks the taxonomy.
  check(
    "coverage header counts priced of seen",
    m.priced < m.seen && m.taxonomy === ALL_SKILLS.length,
    `taxonomy=${m.taxonomy}, ALL_SKILLS=${ALL_SKILLS.length}`,
  );
}
{
  // The worldwide construction, built from the shape that actually caused the
  // problem: a high-volume low-wage market against a smaller expensive one.
  // Pooled, production put Financial at $8k on exactly this.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 40 }, () =>
      MK(["Banking & Lending"], DAYS[0], AS_OF, {
        source: "jobstreet-ph",
        hub: "manila",
        salary: "₱25,000 per month",
      }),
    ),
    ...Array.from({ length: 8 }, () =>
      MK(["Banking & Lending"], DAYS[0], AS_OF, {
        source: "seek",
        hub: "sydney",
        salary: "A$150,000",
      }),
    ),
  ];
  const pooled = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  const world = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(true));
  const p = pooled.rows.find((x) => x.skill === "Banking & Lending")!;
  const w = world.rows.find((x) => x.skill === "Banking & Lending")!;
  check("pooled lets the busiest market win", p.pay === 6959, `pay=${p.pay}`);
  check("worldwide gives each market one vote", w.pay === 78480, `pay=${w.pay}`);
  check("...and reports how many voted", w.payMarkets === 2, `${w.payMarkets}`);
  check(
    "both rest on the same ad count",
    p.payN === w.payN && p.payN === 48,
    `${p.payN}/${w.payN}`,
  );
  check("the two constructions really do disagree here", p.pay !== w.pay);
}
{
  // Hubless ads can be valued but not placed, so they cannot join a market
  // vote. 9% of the archive's priced ads are in this state, led by sa-gov,
  // jobstreet-ph and linkedin.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 8 }, () =>
      MK(["Banking & Lending"], DAYS[0], AS_OF, {
        source: "jobstreet-ph",
        hub: null,
        salary: "₱25,000 per month",
      }),
    ),
    ...Array.from({ length: 8 }, () =>
      MK(["Banking & Lending"], DAYS[0], AS_OF, {
        source: "seek",
        hub: "sydney",
        salary: "A$150,000",
      }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(true));
  const r = m.rows.find((x) => x.skill === "Banking & Lending")!;
  check("unplaceable ads are counted", m.unplaceable === 8, `${m.unplaceable}`);
  check(
    "...and kept out of the worldwide vote",
    r.pay === 150000 && r.payMarkets === 1,
    `pay=${r.pay} mkt=${r.payMarkets}`,
  );
  check("...while still counting toward the sample", r.payN === 16, `n=${r.payN}`);
}
{
  // Categories: constituent counts are the disclosure that stops a one-skill
  // index reading like a broad one.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 8 }, () =>
      MK(["Mining Engineering"], DAYS[0], AS_OF, {
        source: "adzuna",
        hub: "perth",
        salary: "100000",
      }),
    ),
    ...Array.from({ length: 4 }, () =>
      MK(["Geology"], DAYS[0], AS_OF, { source: "adzuna", hub: "perth", salary: "100000" }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  const mining = m.categories.find((c) => c.cat === "Mining")!;
  check("a category counts every constituent skill", mining.skills === 2, `${mining.skills}`);
  check("...and how many of them carry a price", mining.priced === 1, `${mining.priced}`);
  check(
    "category value sums only its priced skills",
    mining.value ===
      m.rows
        .filter((r) => r.cat === "Mining" && r.value !== null)
        .reduce((t, r) => t + (r.value ?? 0), 0),
  );
  check("category demand counts all of them", mining.now === 12, `${mining.now}`);
}
{
  // The ramp guard. Before it, a 30-day window over a 24-day archive opened at
  // $0.0m and every category reported between +387% and +869%.
  const rows: MarketRow[] = [
    ...Array.from({ length: 10 }, () =>
      MK(["Mining Engineering"], DAYS[0], AS_OF, {
        source: "adzuna",
        hub: "perth",
        salary: "100000",
      }),
    ),
    // A feed carrying a third of the scope, switching on at day 6.
    ...Array.from({ length: 6 }, () =>
      MK(["Mining Engineering"], DAYS[5], AS_OF, {
        source: "seek",
        hub: "perth",
        salary: "100000",
      }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  check(
    "the window starts where the late feed arrived",
    eq(m.days, DAYS.slice(5)),
    JSON.stringify(m.days),
  );
  check("the value series matches the trimmed window", m.valueSeries.length === m.days.length);
  check("...and never opens at zero", m.valueSeries[0] > 0, `${m.valueSeries[0]}`);
  const r = m.rows.find((x) => x.skill === "Mining Engineering")!;
  check("sparklines are trimmed with it", !r.spark || r.spark.length === m.days.length);
}
{
  // Price is measured on ads live at the reference day, not everything the
  // window ever held — otherwise a closed ad keeps pricing a market it left.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 8 }, () =>
      MK(["Mining Engineering"], DAYS[0], DAYS[2], {
        source: "adzuna",
        hub: "perth",
        salary: "999000",
      }),
    ),
    ...Array.from({ length: 8 }, () =>
      MK(["Mining Engineering"], DAYS[0], AS_OF, {
        source: "adzuna",
        hub: "perth",
        salary: "100000",
      }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  const r = m.rows.find((x) => x.skill === "Mining Engineering")!;
  check("closed ads do not price a live market", r.pay === 100000, `pay=${r.pay}`);
  check("...nor count toward live demand", r.now === 8, `now=${r.now}`);
}
{
  // Total value is the sum of the rows, and the series ends on it.
  const rows: MarketRow[] = [
    ...MK_ANCHOR,
    ...Array.from({ length: 8 }, () =>
      MK(["Mining Engineering"], DAYS[0], AS_OF, {
        source: "adzuna",
        hub: "perth",
        salary: "100000",
      }),
    ),
  ];
  const m = foldSkillMarket(rows, DAYS, AS_OF, mkOpts(false));
  const sum = m.rows.reduce((t, r) => t + (r.value ?? 0), 0);
  check(
    "total value is the sum of the priced rows",
    m.totalValue === sum,
    `${m.totalValue} vs ${sum}`,
  );
  check(
    "the value series ends on the total",
    m.valueSeries[m.valueSeries.length - 1] === m.totalValue,
    `${m.valueSeries[m.valueSeries.length - 1]} vs ${m.totalValue}`,
  );
}
{
  const m = foldSkillMarket([], DAYS, AS_OF, mkOpts(false));
  check(
    "an empty market returns empty, not a shape full of zeros",
    m.rows.length === 0 && m.days.length === 0,
  );
}

// ── market ranks ────────────────────────────────────────────────────────────
//
// The rank printed beside a skill on the company card ("Local #4/96"). It is
// read next to that card's OWN live-ad count, so the two have to agree about
// what an ad is: the fold counts vacancies — company_id plus normalised title —
// not archive rows. Duplication does not cancel out of a ranking either, since
// it is the overlap between whichever feeds cover the employers hiring for that
// skill, which differs skill by skill.
{
  const rr = (
    company: string,
    title: string,
    skills: string[],
    hub: string,
    extra: Partial<RankRow> = {},
  ) =>
    ({
      company_id: company,
      title,
      skills: JSON.stringify(skills),
      hub,
      ...extra,
    }) as RankRow;
  const PERTH = new Set(["perth"]);

  {
    const out = foldSkillRanks(
      [
        rr("rio", "Construction Manager", ["Mining Engineering"], "perth"),
        rr("rio", "construction manager", ["Mining Engineering"], "perth"),
        rr("rio", "Construction Manager!", ["Mining Engineering"], "bayswater"),
        rr("bhp", "Geologist", ["Geotechnical"], "perth"),
      ],
      PERTH,
      true,
    );
    check(
      "one role on three feeds is one ad in the market count",
      out["Mining Engineering"]?.globalAds === 1,
      `globalAds=${out["Mining Engineering"]?.globalAds}`,
    );
    check(
      "...so it does not outrank a genuinely equal skill",
      out["Mining Engineering"].globalRank === 1 && out["Geotechnical"].globalRank === 1,
      `${out["Mining Engineering"].globalRank} vs ${out["Geotechnical"].globalRank}`,
    );
  }
  {
    // Two employers advertising the same job title are two vacancies. Only the
    // company+title pair folds.
    const out = foldSkillRanks(
      [
        rr("rio", "Geologist", ["Geotechnical"], "perth"),
        rr("bhp", "Geologist", ["Geotechnical"], "perth"),
      ],
      PERTH,
      true,
    );
    check("the same title at two employers is two ads", out["Geotechnical"].globalAds === 2);
  }
  {
    // Rows the archive could not attribute to a roster employer each stay their
    // own vacancy — two identically-titled ones are as likely to be two
    // employers as one, and counting twice beats merging strangers.
    const out = foldSkillRanks(
      [
        rr("", "Registered Nurse", ["Nursing"], "perth"),
        rr("", "Registered Nurse", ["Nursing"], "perth"),
      ],
      PERTH,
      true,
    );
    check("unattributed rows are not folded into each other", out["Nursing"].globalAds === 2);
  }
  {
    // The local count is over the same vacancies, placed in the hub most of
    // their feeds named — the choice the company card's hot spots make.
    const out = foldSkillRanks(
      [
        rr("rio", "Shift Super", ["Mining Engineering"], "perth"),
        rr("rio", "Shift Super", ["Mining Engineering"], "perth"),
        rr("rio", "Shift Super", ["Mining Engineering"], "adelaide"),
        rr("bhp", "Plant Op", ["Mining Engineering"], "adelaide"),
      ],
      PERTH,
      true,
    );
    const s = out["Mining Engineering"];
    check("a folded vacancy counts once locally", s.localAds === 1, `localAds=${s.localAds}`);
    check("...and once globally alongside the other employer's", s.globalAds === 2);
  }
  {
    // Feeds disagree about the union of skills on one ad, the same way they do
    // on the company card.
    const out = foldSkillRanks(
      [
        rr("rio", "Mine Planner", ["Mining Engineering"], "perth"),
        rr("rio", "Mine Planner", ["Metallurgy"], "perth"),
      ],
      PERTH,
      true,
    );
    check(
      "a vacancy demands the union of its feeds' skills",
      out["Mining Engineering"]?.globalAds === 1 && out["Metallurgy"]?.globalAds === 1,
    );
  }
  {
    // The release gate still runs PER ROW, before folding, so an ad carried in
    // both a released market and an unreleased one counts through its released
    // rows rather than being decided by whichever hub happened to win.
    const seen = foldSkillRanks(
      [
        rr("", "Data Engineer", ["Data Engineering"], "london"),
        rr("", "Data Engineer", ["Data Engineering"], "london"),
      ],
      PERTH,
      false,
    );
    check(
      "an unreleased market is withheld from a non-admin",
      seen["Data Engineering"] === undefined,
    );
    const admin = foldSkillRanks(
      [rr("", "Data Engineer", ["Data Engineering"], "london")],
      PERTH,
      true,
    );
    check("...and visible to an admin", admin["Data Engineering"]?.globalAds === 1);
  }
  {
    check(
      "an empty market ranks nothing",
      Object.keys(foldSkillRanks([], PERTH, true)).length === 0,
    );
  }
  // ── ranked among peers, not among the whole taxonomy ──────────────────────
  //
  // A speciality is a subset of its parent, so ranking the two together gave a
  // number that was wrong twice: the child could never beat the parent that
  // contains it, and every broad skill's "of N" grew each time a speciality was
  // added — a worse-looking rank for the same market, caused by taxonomy work
  // rather than by hiring.
  {
    // Distinct company+title per row, so every row is its own vacancy and the
    // counts below are the ad counts they look like.
    let id = 0;
    const mk = (n: number, sk: string[]): RankRow[] =>
      Array.from({ length: n }, () => ({
        company_id: `c${id}`,
        title: `t${id++}`,
        skills: JSON.stringify(sk),
        hub: "perth",
      }));
    const out = foldSkillRanks(
      [
        ...mk(60, ["Nursing", "Midwifery"]),
        ...mk(40, ["Nursing", "Critical Care Nursing"]),
        ...mk(25, ["Nursing", "Emergency Nursing"]),
        ...mk(25, ["Nursing", "Renal Nursing"]),
        ...mk(90, ["Nursing"]),
        ...mk(70, ["Allied Health", "Physiotherapy"]),
        ...mk(50, ["Pharmacy"]),
      ],
      PERTH,
      true,
    );
    check(
      "a broad skill is ranked only against broad skills",
      out["Nursing"].globalRank === 1 && out["Nursing"].globalOf === 3,
      `#${out["Nursing"].globalRank} of ${out["Nursing"].globalOf} (want #1 of 3)`,
    );
    check(
      "...so specialities do not inflate its denominator",
      out["Pharmacy"].globalOf === 3,
      `${out["Pharmacy"].globalOf}`,
    );
    check(
      "a speciality is ranked against its SIBLINGS",
      out["Midwifery"].globalRank === 1 && out["Midwifery"].globalOf === 4,
      `#${out["Midwifery"].globalRank} of ${out["Midwifery"].globalOf} (want #1 of 4)`,
    );
    check(
      "...never against the parent that contains it",
      out["Midwifery"].globalAds < out["Nursing"].globalAds &&
        out["Midwifery"].globalRank === 1 &&
        out["Nursing"].globalRank === 1,
      "both are first, each in its own cohort",
    );
    check(
      "...and a tie inside a cohort shares a rank",
      out["Emergency Nursing"].globalRank === 3 && out["Renal Nursing"].globalRank === 3,
      `${out["Emergency Nursing"].globalRank} / ${out["Renal Nursing"].globalRank}`,
    );
    check(
      "a lone speciality has no rank, because nothing was compared",
      out["Physiotherapy"].globalRank === null && out["Physiotherapy"].globalOf === 1,
      `#${out["Physiotherapy"].globalRank} of ${out["Physiotherapy"].globalOf}`,
    );
    check(
      "...but its ad count is still reported",
      out["Physiotherapy"].globalAds === 70,
      `${out["Physiotherapy"].globalAds}`,
    );
  }
}

// ── how specialities are presented ──────────────────────────────────────────
//
// The company card NESTS a speciality under the skill it narrows. The ticker
// and the market movers are flat and cannot, so they drop a speciality whose
// parent is in the same list — otherwise one movement is reported twice and
// the reader is invited to add the two rows together. None of this fails
// visibly: the lists still render, they just quietly say a thing that is not
// true, which is the class of bug every other check here exists for.
console.log("\nspecialities in the flat lists:");
{
  const kin = (names: string[]) => dropRedundantKin(names, (n) => n);
  const child = Object.keys(SKILL_PARENT)[0];
  const parent = SKILL_PARENT[child];
  check(
    "a speciality is dropped when the skill it narrows is in the same list",
    eq(kin([parent, child, "Pharmacy"]), [parent, "Pharmacy"]),
    kin([parent, child, "Pharmacy"]).join(", "),
  );
  check(
    "...and kept when it is not, since nothing is double-counted",
    eq(kin([child, "Pharmacy"]), [child, "Pharmacy"]),
    kin([child, "Pharmacy"]).join(", "),
  );
  check(
    "order survives, so a caller may filter before it slices to a top N",
    eq(kin(["Pharmacy", "Dental", parent]), ["Pharmacy", "Dental", parent]),
  );
  check(
    "a speciality that does appear is labelled with the skill it narrows",
    withParent(child) === `${parent} · ${child}` && withParent(parent) === parent,
    withParent(child),
  );
}

console.log("\nsearching for a speciality:");
{
  // THESE THREE CHECKS USED TO ASSERT THE OPPOSITE, and they were right to
  // until the archive could answer for a speciality. They read: a speciality
  // resolves to the skill it narrows; every result is a broad skill, never a
  // speciality; a direct hit is not answered by way of one of its own
  // specialities. The reason was that no statistical agency publishes a
  // vacancy series below the 100 broad skills, so a speciality result would
  // have opened an empty card.
  //
  // It is now answered from our own collection instead — skillsForText writes
  // specialities onto the rows it matches, recomputeIndex aggregates them, and
  // buildSkillCard builds a speciality card from that index while saying so.
  // So the assertions invert, and what they guard is the new promise: that a
  // speciality is a result in its own right and still names what it narrows.
  const child = "Midwifery";
  const m = searchSkillMatches(child);
  check(
    "a speciality is a result in its own right",
    m.length === 1 && m[0].skill === child && m[0].parent === SKILL_PARENT[child],
    JSON.stringify(m),
  );
  check(
    "every result is a broad skill or a speciality that names its parent",
    ["nurs", "care", "data", "eng", "a"].every((q) =>
      searchSkillMatches(q).every(
        (r) =>
          (ALL_SKILLS.includes(r.skill) && !r.parent) ||
          (SKILL_PARENT[r.skill] !== undefined && r.parent === SKILL_PARENT[r.skill]),
      ),
    ),
  );
  check(
    // Ordering is the whole of the answer here: typing the broad skill must
    // still put the broad skill first, or "nursing" buries Nursing under its
    // own eight specialities.
    "a direct hit on a broad skill ranks before its specialities",
    searchSkillMatches("nursing")[0]?.skill === "Nursing" &&
      searchSkillMatches("nursing")
        .slice(1)
        .every((r) => r.parent === "Nursing"),
    JSON.stringify(searchSkillMatches("nursing").map((r) => r.skill)),
  );
  check(
    "no skill is offered twice",
    ["a", "e", "man", "care"].every((q) => {
      const r = searchSkillMatches(q).map((x) => x.skill);
      return new Set(r).size === r.length;
    }),
  );
}

console.log("\nwhat a skill card offers next:");
{
  // SKILL_CATEGORY covers specialities too, so reading it directly put a
  // skill's OWN specialities in its related list — Nursing suggesting
  // Midwifery, which is part of nursing rather than an alternative to it, and
  // which opens an empty card.
  const related = (skill: string) =>
    ALL_SKILLS.filter((x) => x !== skill && SKILL_CATEGORY[x] === SKILL_CATEGORY[skill]);
  check(
    "a skill never suggests one of its own specialities",
    ALL_SKILLS.every((s) => !related(s).some((r) => SKILL_PARENT[r] === s)),
  );
  check(
    "and never suggests a speciality of any other skill",
    ALL_SKILLS.every((s) => related(s).every((r) => !(r in SKILL_PARENT))),
  );
}

{
  // ── the ticker's riser/faller interleave ────────────────────────────────
  // Order only, and invisible when it breaks: the marquee still shows sixteen
  // correct rows, it just shows them in a block of red and then a block of
  // green, which reads as "everything is falling" for several seconds. The
  // sort above it CLAIMED to interleave from the day the ticker was written
  // and never did, which is exactly how long a wrong order can survive
  // unasserted.
  const v = (n: number) => ({ v: n });
  const signs = (xs: { v: number }[]) => xs.map((x) => (x.v > 0 ? "+" : "-")).join("");
  const longestRun = (s: string) => Math.max(0, ...(s.match(/(.)\1*/g) ?? []).map((r) => r.length));

  const grouped = [-9, -8, -7, -6, 5, 4, 3, 2].map(v);
  check(
    "a block of fallers then risers comes back alternating",
    longestRun(signs(alternateBySign(grouped, (t) => t.v))) === 1,
  );
  check(
    "and leads with the side the ranking led with",
    signs(alternateBySign(grouped, (t) => t.v))[0] === "-",
  );
  check(
    "a ranking led by a riser still leads with one",
    signs(alternateBySign([9, 8, -7, -6].map(v), (t) => t.v))[0] === "+",
  );

  // SELECTION MUST SURVIVE THE REORDER. Dropping or duplicating a row here
  // would change what the ticker reports, not just its order — and the whole
  // point of interleaving after the cut is that it cannot.
  const lopsided = [9, 8, 7, 6, 5, 4, -3, -2].map(v);
  const out = alternateBySign(lopsided, (t) => t.v);
  check(
    "no row is added or lost when the sides are uneven",
    out.length === lopsided.length && lopsided.every((x) => out.includes(x)),
  );
  check(
    "the short side is spread through the front, not appended",
    signs(out).slice(0, 4) === "+-+-",
  );
  check(
    "an all-one-sign ranking is returned untouched",
    signs(alternateBySign([9, 8, 7].map(v), (t) => t.v)) === "+++",
  );
}

// ── a speciality's own trend line ───────────────────────────────────────────
//
// A speciality has no agency series, so its card's line and its count come
// from the archive instead (getSkillTrend -> foldSkillRows, keyed archive-wide
// by roleKeyByCompanyTitle). Everything below is invisible on the rendered
// card: a line drawn from the wrong fold still looks like a line, and a count
// merged across employers still looks like a number.
{
  // THE REASON THE ARCHIVE-WIDE KEY EXISTS. Two employers advertising the same
  // title are two vacancies. The per-company default folds them into one,
  // which is right inside one company and catastrophic across the archive:
  // measured on the live archive 2026-09-23, the 307 rows carrying Talent
  // Acquisition held 234 distinct titles, so title-only folding would have
  // merged 73 rows belonging to different employers.
  const rows = [
    row(["Talent Acquisition"], DAYS[0], DAYS[9], { title: "Talent Partner", company_id: "bhp" }),
    row(["Talent Acquisition"], DAYS[0], DAYS[9], { title: "Talent Partner", company_id: "nab" }),
  ];
  const wide = foldSkillRows(rows, DAYS, LIVE_FROM, 0, roleKeyByCompanyTitle);
  const naive = foldSkillRows(rows, DAYS, LIVE_FROM, 0);
  check(
    "the archive-wide key keeps two employers' identical titles apart",
    find(wide, "Talent Acquisition")!.now === 2,
    `got ${find(wide, "Talent Acquisition")!.now}`,
  );
  check(
    "...and the per-company default still folds them, as a company card needs",
    find(naive, "Talent Acquisition")!.now === 1,
    `got ${find(naive, "Talent Acquisition")!.now}`,
  );
}
{
  // Within ONE employer the archive-wide key must still fold the feeds — that
  // is the whole measurement behind normRoleTitle, and losing it would put the
  // 18% row duplication straight back into the count.
  const rows = [
    row(["Talent Acquisition"], DAYS[0], DAYS[9], {
      title: "Talent Partner",
      company_id: "bhp",
      source: "adzuna",
    }),
    row(["Talent Acquisition"], DAYS[0], DAYS[9], {
      title: "talent  partner!",
      company_id: "bhp",
      source: "seek",
    }),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0, roleKeyByCompanyTitle);
  check(
    "...while two feeds on ONE employer's role still fold to one vacancy",
    find(out, "Talent Acquisition")!.now === 1,
  );
}
{
  // An unattributed row is its own vacancy. The archive's hub samples carry no
  // company_id, and two identically-titled ones are as likely to be two
  // hospitals as one hospital on two boards — so counting twice beats merging
  // strangers. Same rule foldSkillRanks already applies.
  const rows = [
    row(["Midwifery"], DAYS[0], DAYS[9], { title: "Registered Midwife" }),
    row(["Midwifery"], DAYS[0], DAYS[9], { title: "Registered Midwife" }),
  ];
  const out = foldSkillRows(rows, DAYS, LIVE_FROM, 0, roleKeyByCompanyTitle);
  check(
    "two rows with no company_id stay two vacancies, not one",
    find(out, "Midwifery")!.now === 2,
    `got ${find(out, "Midwifery")!.now}`,
  );
}
{
  // The card's figure and the right-hand end of its line must be ONE
  // measurement. buildSpecialityCard takes `now` and the series from the same
  // fold precisely so they cannot drift; the index total it used to show is a
  // count of ROWS and would sit ~20% above the line it was printed against.
  const trend = {
    days: DAYS.slice(0, 4),
    now: 42,
    series: [39, 40, 41, 42],
    pct: 7.7,
    hubs: [{ hub: "perth", n: 42 }],
    hubless: 0,
  };
  const card = buildSkillCard("Talent Acquisition", TIMELINE_SPAN, null, trend);
  check(
    "the speciality card's open-roles figure is the fold's, not the index's",
    card.openRoles === 42,
  );
  check("...and it draws a line from the same fold", !!card.spark && !!card.sparkArea);
  check("...and reports the change the fold measured", card.change === 7.7);
  check(
    "...and names the span it DREW, not the one requested",
    card.spanLabel === "Collected · 1 Aug – 4 Aug",
    String(card.spanLabel),
  );
  check("...and marks itself as archive-sourced", card.basis === "archive");
}
{
  // BEFORE THE QUERY LANDS THERE IS NO NUMBER. Falling back to the live index
  // here is what the fold was brought in to stop: the card would print a row
  // count, then swap it for a vacancy count when the trend arrived, and the
  // figure would visibly move for no reason a reader could see.
  //
  // THE INDEX IS POPULATED IN THIS FIXTURE, deliberately. Passing null made
  // the case pass against a card that DID fall back — there was simply nothing
  // to fall back to — so it asserted nothing. Checked by reinstating the
  // fallback and watching this fail.
  const idx = {
    updated: "2026-09-23",
    totalJobs: 1,
    skills: {
      "Talent Acquisition": { total: 307, byCompany: {}, bySector: {}, byCity: { perth: 307 } },
    },
  };
  const card = buildSkillCard("Talent Acquisition", TIMELINE_SPAN, idx, null);
  check("...and does not fall back to the index's row count", card.openRoles !== 307);
  check("a speciality with no archive answer shows no count", card.openRoles === null);
  check("...and no line", card.spark === null && card.sparkArea === null);
  check("...and no span label", card.spanLabel === null);
  check(
    "...and says so rather than showing a zero",
    card.summaryLead.includes("no figure to show"),
    card.summaryLead,
  );
}
{
  // A BROAD SKILL IS UNTOUCHED BY ANY OF THIS. It keeps the agencies' series,
  // the scrubbable 243-month axis and no span line — the trend argument is
  // ignored outright rather than blended in.
  const card = buildSkillCard("Human Resources", TIMELINE_SPAN, null, {
    days: DAYS,
    now: 999999,
    series: [1, 2, 3],
    pct: 500,
    hubs: [],
    hubless: 0,
  });
  check("a broad skill ignores the archive trend entirely", card.openRoles !== 999999);
  check("...and keeps the scrubbable timeline", card.spanLabel === null);
  check("...and is still agency-sourced", card.basis === "agency");
}
{
  // The map has to be able to colour by a speciality, or the search opens a
  // card and leaves the globe on salary — which reads as the search failing.
  // This was ALL_SKILLS (broad only) until specialities got their own card.
  check(
    "a speciality resolves as the map's active skill",
    activeSkill("talent acquisition") === "Talent Acquisition",
  );
  check("...case-insensitively, like a broad skill", activeSkill("MIDWIFERY") === "Midwifery");
  check("...and a broad skill still does", activeSkill("nursing") === "Nursing");
  check("...while a non-skill still resolves to nothing", activeSkill("BHP") === null);
}

// ── the chip row: specialities, siblings, or the way back up ────────────────
//
// Three different relationships share one row, and only the heading tells them
// apart. A chip that says "Midwifery" cannot say whether it is part of the
// skill on the card or an alternative to it — which is exactly why specialities
// were kept out of this row until they had cards of their own.
{
  const idx = {
    updated: "2026-09-23",
    totalJobs: 0,
    skills: Object.fromEntries(
      // ALL ELEVEN of Nursing's specialities, descending. The first version
      // stocked five, which cannot reach a cap of six — so the cap assertion
      // passed on the list simply being short. Every child is present here, so
      // the slice is the only thing that can hold the row to six.
      [
        ["Midwifery", 382],
        ["Perioperative Nursing", 150],
        ["Critical Care Nursing", 120],
        ["Emergency Nursing", 90],
        ["Surgical Nursing", 75],
        ["Paediatric Nursing", 60],
        ["Oncology & Palliative Nursing", 55],
        ["Nurse Practitioner", 50],
        ["Aged Care Nursing", 40],
        ["Nurse Education", 30],
        ["Renal Nursing", 20],
      ].map(([s, n]) => [s, { total: n, byCompany: {}, bySector: {}, byCity: {} }]),
    ),
  };
  const card = buildSkillCard("Nursing", TIMELINE_SPAN, idx as never);
  check(
    "a parent offers its own specialities, not its category neighbours",
    card.related.every((s) => SKILL_PARENT[s] === "Nursing"),
    card.related.join(", "),
  );
  check(
    "...busiest first, from the index",
    card.related[0] === "Midwifery" && card.related[1] === "Perioperative Nursing",
    card.related.join(", "),
  );
  check(
    "...under a heading that says they are PARTS of it",
    card.relatedLabel === "Specialities",
    card.relatedLabel,
  );
  check(
    "...and capped, so eleven children do not become eleven chips",
    card.related.length === 6,
    `${card.related.length} chips`,
  );
}
{
  // THE HALF OF THE OLD RULE THAT STILL HOLDS. A speciality the index has never
  // seen opens a card that says nothing has been collected, so it is dropped
  // rather than ranked last — a dead end is not a suggestion. With the index
  // loaded and every child unseen, the row falls back to the siblings rather
  // than going empty.
  const idx = { updated: "2026-09-23", totalJobs: 0, skills: {} };
  const card = buildSkillCard("Nursing", TIMELINE_SPAN, idx as never);
  check(
    "a parent whose specialities are all unseen falls back to siblings",
    card.related.length > 0 && card.related.every((s) => !SKILL_PARENT[s]),
    card.related.join(", "),
  );
  check("...under the heading those have always had", card.relatedLabel === "Related");
}
{
  // 59 of the 100 broad skills have no children at all. They must keep exactly
  // the row they had, or this change quietly empties more than half the cards.
  //
  // THE FIXTURE ASSERTS ITS OWN PREMISE. The first version of this case used
  // Data Analytics, which has a speciality (Business Intelligence) — so it was
  // testing the branch above under the wrong name and failed immediately. The
  // guard below turns that into a clear message rather than a confusing one if
  // Mining Engineering ever gains a child.
  check(
    "the childless-skill fixture is actually childless",
    (SKILL_CHILDREN["Mining Engineering"] ?? []).length === 0,
  );
  const card = buildSkillCard("Mining Engineering", TIMELINE_SPAN, null);
  check(
    "a broad skill with no specialities keeps its category siblings",
    card.related.length > 0 && card.related.every((s) => !SKILL_PARENT[s]),
    card.related.join(", "),
  );
  check("...still labelled Related", card.relatedLabel === "Related");
}
{
  // The one chip on a speciality card goes back UP. Labelling it "Related"
  // would offer the whole it is a slice of as an alternative to itself.
  const card = buildSkillCard("Midwifery", TIMELINE_SPAN, null);
  check("a speciality points at its parent", eq(card.related, ["Nursing"]));
  check("...labelled as the thing it is part of", card.relatedLabel === "Part of");
}
{
  // A PARENT MUST NEVER OFFER ITSELF, and a speciality must never appear in a
  // sibling row. Both are one-line slips that read as plausible chips.
  for (const s of ["Nursing", "Human Resources", "Software Engineering", "Data Analytics"]) {
    const card = buildSkillCard(s, TIMELINE_SPAN, null);
    check(`${s}: never suggests itself`, !card.related.includes(s));
  }
}

// ── the hotspot map's frame ─────────────────────────────────────────────────
// THE BUG THIS EXISTS FOR, shipped 2026-09-25 and reported from a CSL card.
// The map draws its heat blobs in SVG, against the viewBox, and its dots in
// HTML, against the container. Those two agree only while the frame's aspect
// equals the container's — and the clamp that kept the frame on the world was
// snapping w to WORLD_W and h to WORLD_H, which for anyone hiring on two
// continents produced a 2.12 frame in a 1.50 box. The SVG letterboxed, and
// every dot slid away from its own heat.
//
// Nothing on screen says so unless you know what the dots are meant to line up
// with, and it only happens for some spreads of hubs, so it is asserted here.
// ── the ticker's scope ──────────────────────────────────────────────────────
// The "Skills in demand" strip is worldwide on the globe and region-scoped on a
// domestic view, and it NAMES the place it is describing. Two ways that can go
// wrong without anything looking broken:
//
//   · a region with no hubs would scope to nothing and read as "no history
//     here", which is a data claim rather than a missing entry;
//   · a region with no LABEL would print its raw id — "northamerica" — as the
//     place the figures describe.
//
// Both are one line of data away at all times, because the regions are declared
// by deriving REGION_HUBS from CITY_CONTINENT and the labels are written out by
// hand beside it.
console.log("\nevery domestic region the ticker can scope to is nameable:");
{
  const regions = Object.keys(REGION_HUBS);
  check("there are regions at all", regions.length > 0, `${regions.length}`);
  for (const r of regions) {
    check(`${r}: has hubs`, (REGION_HUBS[r]?.length ?? 0) > 0, `${REGION_HUBS[r]?.length ?? 0}`);
    check(`${r}: has a display label`, !!REGION_LABEL[r], REGION_LABEL[r] ?? "(none)");
  }
  // And nothing is labelled that is not a region — a stale label is a place the
  // strip can never name, which is the harmless half, but it is also how the
  // two lists start drifting.
  const stray = Object.keys(REGION_LABEL).filter((r) => !REGION_HUBS[r]);
  check("no label without a region", stray.length === 0, stray.join(", "));
}

console.log("\nthe hotspot frame keeps its aspect, whatever it has to frame:");
{
  const spot = (x: number, y: number) => ({ hub: `${x},${y}`, label: "", n: 1, x, y });
  const CASES: [string, { x: number; y: number }[]][] = [
    ["one hub", [spot(120, 60)]],
    ["two Australian cities", [spot(305, 118), spot(312, 121)]],
    [
      "CSL: six US hubs and Melbourne",
      [
        spot(75, 62),
        spot(72, 66),
        spot(82, 60),
        spot(84, 58),
        spot(92, 56),
        spot(60, 50),
        spot(311, 120),
      ],
    ],
    ["opposite corners of the world", [spot(1, 1), spot(359, 169)]],
    ["wider than the world", [spot(0, 84), spot(360, 86)]],
    ["taller than the world", [spot(180, 0), spot(181, 170)]],
    ["hard against the left edge", [spot(0, 0), spot(4, 4)]],
    ["hard against the bottom right", [spot(356, 166), spot(360, 170)]],
  ];
  for (const [name, spots] of CASES) {
    const f = frameFor(spots as never);
    const aspect = f.w / f.h;
    check(
      `${name}: keeps the box's aspect`,
      Math.abs(aspect - FRAME_ASPECT) < 1e-9,
      `${aspect.toFixed(4)} vs ${FRAME_ASPECT}`,
    );
    // ...and every hub it was given has to be inside it, or the map is drawn
    // without a city it claims to be showing.
    const outside = spots.filter(
      (sp) => sp.x < f.x || sp.x > f.x + f.w || sp.y < f.y || sp.y > f.y + f.h,
    );
    check(`${name}: encloses every hub`, outside.length === 0, `${outside.length} outside`);

    // THE SAME BUG, NOW REACHABLE BY HAND. The map zooms, so the frame the SVG
    // is drawn with is no longer the one this function returned — it is
    // zoomFrame's, recomputed on every press of +, every dot click and every
    // pixel of a drag. If any of those can produce a box of a different shape,
    // the dots come off the heat exactly as they did in September, except that
    // the map looks right when it opens and only breaks once touched.
    //
    // And the pan has to stay inside the base frame: that is what makes the
    // reset button a complete way back, and what stops a drag wandering into an
    // ocean with no hub in sight.
    const cMax = maxZoomFor(f);
    const skew: string[] = [];
    const escaped: string[] = [];
    for (const z of [1, 1.5, 2, 4, 9, cMax, cMax * 4]) {
      // Every corner and then some, so the clamp is exercised on both axes at
      // once rather than only where a centred zoom would land.
      for (const [cx, cy] of [
        [f.x + f.w / 2, f.y + f.h / 2],
        [f.x, f.y],
        [f.x + f.w, f.y + f.h],
        [f.x - f.w, f.y + f.h * 2],
        [spots[0].x, spots[0].y],
      ]) {
        const v = zoomFrame(f, z, { x: cx, y: cy });
        const at = `${z.toFixed(1)}× @${cx.toFixed(0)},${cy.toFixed(0)}`;
        if (Math.abs(v.w / v.h - FRAME_ASPECT) >= 1e-9)
          skew.push(`${at} -> ${(v.w / v.h).toFixed(4)}`);
        if (
          v.x < f.x - 1e-9 ||
          v.y < f.y - 1e-9 ||
          v.x + v.w > f.x + f.w + 1e-9 ||
          v.y + v.h > f.y + f.h + 1e-9
        )
          escaped.push(`${at} -> ${[v.x, v.y, v.w, v.h].map((n) => n.toFixed(1)).join(" ")}`);
      }
    }
    // One line per case rather than per probe: 35 zoom/centre pairs per framing
    // is a useful net and an unreadable report.
    check(`${name}: every zoom keeps the box's aspect`, skew.length === 0, skew.join("; "));
    check(`${name}: every zoom stays inside the frame`, escaped.length === 0, escaped.join("; "));
    // Zoom 1 is the frame itself, so a map nobody has touched is drawn exactly
    // as it was before the zoom existed.
    const at1 = zoomFrame(f, 1, centreOf(f));
    check(
      `${name}: zoom 1 is the untouched frame`,
      ["x", "y", "w", "h"].every(
        (p) =>
          Math.abs(
            (at1 as never as Record<string, number>)[p] - (f as never as Record<string, number>)[p],
          ) < 1e-9,
      ),
    );
    // Never past the floor: a zoom that kept going would leave a flat blue
    // field, the coastline off-screen and the dot with nothing to sit against.
    const tight = zoomFrame(f, 1e6, centreOf(f));
    check(
      `${name}: never zooms past the floor`,
      tight.w >= FRAME_FLOOR - 1e-9,
      `${tight.w.toFixed(2)} < ${FRAME_FLOOR}`,
    );
  }
}

// ── the skill card's timeline ───────────────────────────────────────────────
// THE BUG: "Present day" was a typed date. It was right when it was written and
// the vacancy series then gained two months, so the header read "MAR 2006 – JUL
// 2026", the handle sat on Jul 2026, and the panel under it was badged MAY
// 2026. Nothing errored; the label had been left behind by its own data.
console.log("\nthe timeline's present-day event sits on the series' last month:");
{
  const last = IVI_MONTHS[IVI_MONTHS.length - 1];
  const present = LABOUR_EVENTS.find((e) => e.title === "Present day");
  check("the present-day event exists", !!present, "not found in LABOUR_EVENTS");
  if (present) {
    const iso = `${present.year}-${String(present.month + 1).padStart(2, "0")}`;
    check(`present day is ${last}`, iso === last, `event says ${iso}`);
    // It must also be ON the axis and at its end, which is what makes the
    // handle and the badge agree rather than merely reading alike.
    check(
      "...and lands on the last tick of the timeline",
      eventIndex(present) === TIMELINE_SPAN,
      `index ${eventIndex(present)} of ${TIMELINE_SPAN}`,
    );
    check(
      "...and the header's end month is the same month",
      TIMELINE_LABEL.endsWith(monthLabel(last)),
      TIMELINE_LABEL,
    );
  }
  // Every other event is a historical fact and must stay on the axis, or its
  // tick silently disappears from the track.
  const off = LABOUR_EVENTS.filter((e) => eventIndex(e) < 0).map((e) => e.title);
  check("every event falls inside the series", off.length === 0, off.join(", "));
}

// ── the skill map's pins following the timeline ─────────────────────────────
// The card scrubs 245 months and the LOCAL map's company pins now follow it.
// The archive can only name employers from 2026-07 on, so the fallback is the
// thing to guard: outside the covered span the pins must HOLD at the live
// index, never empty out. An empty map reads as a market nobody was hiring in.
console.log("\ncompany pins follow the timeline only where the archive reaches:");
{
  const idx = {
    updated: "",
    totalJobs: 0,
    skills: { Strategy: { total: 9, byCompany: { live: 9 }, bySector: {}, byCity: {} } },
  } as never;
  const months = {
    months: ["2026-07", "2026-08"],
    byMonth: { "2026-07": { a: 3, b: 1 }, "2026-08": {} },
  };
  const at = (m: string) => demandByCompanyAt(idx, months, "Strategy", m);
  check("a covered month uses that month's employers", eq(at("2026-07").demand, { a: 3, b: 1 }));
  check("...and says it is dated", at("2026-07").dated === true);
  // The one case where lighting nothing is the truth.
  check("a covered month with no ads is a real zero", eq(at("2026-08").demand, {}));
  check("...and is still dated", at("2026-08").dated === true);
  check("an uncovered month HOLDS the live index", eq(at("2014-03").demand, { live: 9 }));
  check("...and says it is NOT dated", at("2014-03").dated === false);
  check(
    "no month data at all holds too",
    eq(demandByCompanyAt(idx, null, "Strategy", "2026-07").demand, { live: 9 }),
  );

  // The month walk behind all of it. December is where this kind of thing
  // breaks, and a reversed pair must return nothing rather than spin.
  check(
    "months span a year boundary",
    eq(monthsBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]),
  );
  check("one month is one month", eq(monthsBetween("2026-07", "2026-07"), ["2026-07"]));
  check("a reversed span is empty, not endless", eq(monthsBetween("2026-09", "2026-07"), []));
}

console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
