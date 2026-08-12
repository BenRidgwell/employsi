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

console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
