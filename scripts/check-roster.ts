// Roster ↔ scraper consistency check.
//
// WHY THIS EXISTS
// A company is not one record. Adding, renaming or removing one touches the
// roster AND every place a company id is keyed: the career-site definitions the
// cron worker walks, the SEEK advertiser ids, the city→company maps that decide
// where a marker is drawn. Nothing links those files, so the failure mode is
// always the same shape and always silent:
//
//   * a roster company with no feed          — a card that will never show a
//                                              vacancy, and reads as an employer
//                                              that simply is not hiring
//   * a feed with no roster company          — rows archived under a company_id
//                                              nothing can render, so the scrape
//                                              runs, costs money and is invisible
//   * a feed id that no longer exists        — the same, after a rename
//   * a company on no city map               — no marker, so it cannot be found
//                                              on the map at all
//
// Every one of those looks like an absence of DATA rather than an absence of
// WIRING, which is the specific confusion this repo exists to avoid. So the
// wiring is checked mechanically, and a mismatch is an error at build time
// rather than a quiet gap in a dataset months later.
//
// Run: bun run scripts/check-roster.ts        (exit 1 on any error)
//      bun run scripts/check-roster.ts --json
import { COMPANIES } from "../src/employsi/data/companies";
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { SEEK_ADVERTISERS } from "../src/employsi/data/seekAdvertisers";
import { SEEK_TRADING_NAMES } from "../src/employsi/data/seekTradingNames";
import { SITES as CAREER_SITES } from "../workers/jobs-cron/careerSites";
import { COMPANY_HEADCOUNT } from "../src/employsi/data/companyHeadcount";
import { GOV_HEADCOUNT_AU } from "../src/employsi/data/govWorkforceAu";
import { WGEA_HEADCOUNT } from "../src/employsi/data/wgeaWorkforceAu";

import { buildCompanyCard, filedHeadcount } from "../src/employsi/lib/companyCard";
import { buildCompareCard } from "../src/employsi/lib/compareCard";

/**
 * Companies whose dedicated feed is a GitHub Action rather than a Worker
 * fetcher, because their board needs a browser or a residential exit and so
 * cannot live in `careerSites.ts`. Without this list they read as "no dedicated
 * feed" here while in fact being scraped daily — a warning that is wrong is
 * worse than no warning, because it trains the reader to skim the list.
 *
 * Keep it in step with .github/workflows/*: one entry per company id that a
 * `scripts/*-to-d1.py` scraper writes rows for.
 */
const SCRIPT_FED: string[] = [
  "melbourne-nab", // nab-portal.yml
  "sydney-sgp", // browser-portals.yml — Stockland
  "nz-auckland-international-airport", // browser-portals.yml
  "brisbane-tne", // browser-portals.yml — TechnologyOne
  "sfr", // sandfire-portal.yml — Sandfire Resources
  "melbourne-dnl", // dyno-portal.yml — Dyno Nobel (SuccessFactors RCM)
];

interface Finding {
  level: "error" | "warn";
  kind: string;
  id: string;
  detail: string;
}

const findings: Finding[] = [];
const err = (kind: string, id: string, detail: string) =>
  findings.push({ level: "error", kind, id, detail });
const warn = (kind: string, id: string, detail: string) =>
  findings.push({ level: "warn", kind, id, detail });

const rosterIds = new Set(COMPANIES.map((c) => c.id));
const rosterName = new Map(COMPANIES.map((c) => [c.id, c.name]));

// ── 1. Every roster id is unique ────────────────────────────────────────────
// A duplicate id does not error anywhere: the later entry silently wins in some
// lookups and loses in others, so the same company renders two different ways.
{
  const seen = new Set<string>();
  for (const c of COMPANIES) {
    if (seen.has(c.id)) err("duplicate-roster-id", c.id, `"${c.name}" declared twice`);
    seen.add(c.id);
  }
}

// ── 2. Every career site points at a roster company ─────────────────────────
// A feed whose id is not in the roster still runs, still costs its page budget,
// and writes rows keyed to a company_id nothing can display.
for (const site of CAREER_SITES) {
  if (!rosterIds.has(site.id)) {
    err("feed-without-company", site.id, `careerSites "${site.name}" has no roster entry`);
    continue;
  }
  // A rename that updates only one side leaves the archive attributing rows to
  // an advertiser name the roster no longer uses, which then reads as a
  // mis-attribution in the admin console rather than as stale config.
  const rn = rosterName.get(site.id)!;
  if (rn.toLowerCase() !== site.name.toLowerCase()) {
    warn("name-drift", site.id, `roster "${rn}" vs careerSites "${site.name}"`);
  }
}

// ── 3. Every SEEK advertiser id points at a roster company ──────────────────
// Seeded with the generated map so a trading name that collides with an
// already-resolved advertiser is caught as well as one that collides with
// another trading name.
const seekAdvertiserOwner = new Map<string, string>(
  Object.entries(SEEK_ADVERTISERS).map(([id, a]) => [a.advertiserId, id]),
);
for (const id of Object.keys(SEEK_ADVERTISERS)) {
  if (!rosterIds.has(id)) {
    err("seek-without-company", id, "seekAdvertisers entry has no roster entry");
  }
}
// The hand-written half of the map. A typo'd company id here is worse than a
// missing feed: the ads are pulled and then filed against an id nothing reads,
// so the board looks scraped and the card stays empty.
for (const [id, list] of Object.entries(SEEK_TRADING_NAMES)) {
  if (!rosterIds.has(id)) {
    err("seek-trading-name-without-company", id, "seekTradingNames entry has no roster entry");
  }
  // An advertiser id repeated across two companies would credit one employer
  // with the other's hiring — the failure mode that file's header warns about.
  for (const adv of list) {
    const owner = seekAdvertiserOwner.get(adv.advertiserId);
    if (owner && owner !== id) {
      err("seek-advertiser-shared", adv.advertiserId, `claimed by both ${owner} and ${id}`);
    }
    seekAdvertiserOwner.set(adv.advertiserId, id);
  }
}

// ── 4. Every roster company is drawn somewhere ──────────────────────────────
// A company on no city map has no marker, so it exists in search and in the
// archive but cannot be found on the map — the one place this product is for.
{
  const placed = new Set<string>();
  for (const list of Object.values(CITY_COMPANIES)) {
    for (const c of list) placed.add(c.id);
  }
  for (const c of COMPANIES) {
    if (!placed.has(c.id)) err("company-not-on-any-map", c.id, `"${c.name}" has no city marker`);
  }
  // …and nothing is drawn that the roster does not know about.
  for (const id of placed) {
    if (!rosterIds.has(id))
      err("marker-without-company", id, "city map marker has no roster entry");
  }
}

// ── 5. Every roster company has a live feed, or is knowingly without one ────
// This is a WARNING, not an error: plenty of companies are covered by the
// market-wide boards (Adzuna, SEEK, Indeed) rather than their own portal, and
// that is a legitimate state. It is reported so the list is a deliberate one
// rather than an accident nobody has looked at.
{
  const fed = new Set<string>([
    ...CAREER_SITES.map((s) => s.id),
    ...Object.keys(SEEK_ADVERTISERS),
    ...Object.keys(SEEK_TRADING_NAMES),
    ...SCRIPT_FED,
  ]);
  const without = COMPANIES.filter((c) => !fed.has(c.id));
  if (without.length) {
    warn(
      "no-dedicated-feed",
      `${without.length} companies`,
      `rely on market-wide boards only: ${without
        .slice(0, 8)
        .map((c) => c.id)
        .join(", ")}${without.length > 8 ? ", …" : ""}`,
    );
  }
}

// Scheduling — SITES ↔ PORTAL_GROUPS ↔ PORTAL_TICKS ↔ crons — is NOT checked
// here. scripts/check-portal-ticks.ts already owns that chain in full, and runs
// in CI on every change to the three files involved. Two checkers over one
// invariant is worse than one: they drift, disagree, and each becomes a reason
// to ignore the other. This file owns the roster side; that one owns scheduling.

// ── 6. No company card prints a workforce figure it does not have ───────────
// The card has three honest states for headcount and one dishonest one, and
// the dishonest one is invisible: a figure of 0 renders as "0", which reads as
// a measurement rather than a gap.
//
// `Company.headcount` is 0 where it means UNKNOWN. buildGovAgency and its
// SA / VIC / QLD / APS counterparts set it deliberately — their own comments
// say "the card shows no fabricated workforce numbers for it" — and the
// university and health records do the same. That intent lives in five data
// files and was enforced in none: buildCompanyCard keyed its suppression on
// `illustrative` alone, so 483 records with a real 0 took the branch that
// prints the number. Queensland Health, SA Health and 41 universities showed
// "Headcount 0 · not disclosed · estimated". buildCompareCard had the same
// hole and laid "0" and "+0.0%" beside a real employer's real figures.
//
// So the invariant is asserted over EVERY company rather than trusted to the
// builders: a record that is not illustrative and not covered by a filed
// source must carry a positive headcount, or be one the card suppresses. This
// runs the real card, because the bug was in the renderer and not in the data —
// every one of those 483 records was exactly what its builder intended.
{
  const filed = (id: string) => !!filedHeadcount(id);
  const bad: string[] = [];
  for (const c of COMPANIES) {
    // filedHeadcount, not an inline merge — the sources and the span default
    // are resolved in one place and this checker has to read the same one the
    // card does, or it checks a card nobody renders. The inline version
    // already disagreed with the card once, over exactly that default.
    const hc = filedHeadcount(c.id);
    const card = buildCompanyCard({
      company: c,
      openRoles: null,
      headcount: hc,
      vacancies: [],
      skillCounts: {},
      roleCounts: {},
    });
    const tile = card.stats.find((s) => s.icon === "headcount");
    if (!tile) {
      err("headcount tile missing", c.id, c.name);
      continue;
    }
    // The only figures a card may print are a filed one or a curated positive
    // one. Anything else has to be the em dash.
    const printsFigure = tile.value !== "—";
    if (printsFigure && !filed(c.id) && !(c.headcount > 0)) bad.push(`${c.id} (${tile.value})`);
    // A change is only ever honest beside a filed figure — it is the one
    // number on this tile that needs two reporting years behind it.
    if (tile.delta && !filed(c.id)) err("headcount YoY unfiled", c.id, c.name);
    // AND THE NOTE BESIDE IT MUST NAME THE REAL SPAN. The aggregator skips
    // years for some companies, so its two newest rows are not always a year
    // apart: Qantas runs Jun 2026, Jun 2023, and reported +60.0% "YoY" for a
    // three-year change. Measured 2026-09-24, 11 of 137 were not a year apart,
    // the worst Capricorn Metals at +1,325% over seven.
    if (tile.delta && hc) {
      const want = hc.span === 1 ? "YoY" : `over ${hc.span} years`;
      if (tile.deltaNote !== want)
        err("headcount span mislabelled", c.id, `says "${tile.deltaNote}", span is ${hc.span}`);
    }
  }
  if (bad.length)
    err(
      "headcount printed as 0",
      `${bad.length} companies`,
      `${bad.slice(0, 6).join(", ")}${bad.length > 6 ? ", …" : ""} — a headcount of 0 means unknown; the card must show "—"`,
    );
}

// A change with no span behind it is not a change anyone can read, so it is
// not printed at all. `yoy` is null exactly where the generator could not
// establish the gap between the two readings.
{
  for (const [id, h] of Object.entries(COMPANY_HEADCOUNT)) {
    if (h.yoy !== null && !(h.span >= 1))
      err("headcount change without a span", id, `yoy ${h.yoy} over span ${h.span}`);
    if (h.yoy === null && h.span >= 1)
      err("headcount span without a change", id, `span ${h.span} but yoy null`);
  }
}

// ── gov workforce: a figure must belong to exactly one agency ───────────────
//
// The jurisdictions publish a row per employing BODY, and the roster does not
// always agree with them about where the boundaries are. Victoria reports
// "Court Services Victoria" once; the roster carries the County, Magistrates'
// and Children's Courts separately. It reports Victoria Police as two rows,
// sworn and public-service. Matching approximately would have written one
// agency's staff onto three cards, or half an agency's onto one — so the
// generator matches exactly and drops anything ambiguous, and this is the
// assertion that the dropping actually happened.
//
// Checked by VALUE, because that is the shape of the damage: two agencies in
// one jurisdiction reporting the identical headcount and prior year is either
// a real coincidence or one row copied across two bodies, and it is worth a
// look either way.
{
  const seen = new Map<string, string[]>();
  for (const [id, h] of Object.entries(GOV_HEADCOUNT_AU)) {
    const juris = id.startsWith("aps-") ? "aps" : id.split("-gov-")[0];
    const key = `${juris}|${h.now}|${h.prev}`;
    seen.set(key, [...(seen.get(key) ?? []), id]);
  }
  for (const [key, ids] of seen) {
    if (ids.length > 1)
      err(
        "one gov figure on several agencies",
        `${ids.length} agencies`,
        `${ids.join(", ")} all report ${key.split("|")[1]} — one source row matched more than one body?`,
      );
  }
  // An agency the source does not report is absent, never zero.
  for (const [id, h] of Object.entries(GOV_HEADCOUNT_AU))
    if (!(h.now > 0) || !(h.prev > 0))
      err("gov headcount not positive", id, `now ${h.now}, prev ${h.prev}`);

  // A PUBLIC-SECTOR AGENCY DOES NOT GROW OR SHRINK BY 200% IN A YEAR, and a
  // figure that says it did is a parse fault wearing a number.
  //
  // This is the assertion that would have caught the Queensland sheet. "5.
  // Agency" holds a second table — FTE by gender, with Woman/Man/Non-binary
  // columns instead of a year per column — and reading its rows against the
  // first table's offsets reported Queensland Health at 837 -> 91,258, a
  // 10,803% rise, and Education at +59,629%. Thirteen of twenty-eight rows
  // were nonsense and every one of them would have rendered as a confident
  // percentage on a card.
  //
  // The ceiling is deliberately loose. Real moves this large exist — the
  // Australian Electoral Commission halves between federal elections — and the
  // point is not to police the data but to catch a column that slipped. A
  // genuine agency that doubles gets an entry in the generator's ALIAS notes
  // and a line here; nothing else should ever need one.
  const ABSURD_PCT = 200;
  for (const [id, h] of Object.entries(GOV_HEADCOUNT_AU))
    if (h.yoy !== null && Math.abs(h.yoy) > ABSURD_PCT)
      err(
        "gov headcount moved absurdly",
        id,
        `${h.prev} -> ${h.now} is ${h.yoy}% over ${h.span}y — a parse fault reads like this`,
      );
}

// The same 0 reaches the COMPARE card by a different path, so it is asserted
// separately rather than assumed to follow. `MetricDef.of` returns
// `number | null` and buildCompareCard drops any metric either side cannot
// answer; the headcount and growth metrics simply never returned null.
{
  const unknown = COMPANIES.find(
    (c) => !c.illustrative && !filedHeadcount(c.id) && !(c.headcount > 0),
  );
  const known = COMPANIES.find((c) => !!filedHeadcount(c.id));
  if (unknown && known) {
    const cmp = buildCompareCard({
      a: unknown,
      b: known,
      pop: COMPANIES.slice(0, 200),
      aTrend: [],
      bTrend: [],
      aJobs: [],
      bJobs: [],
    });
    for (const name of ["Headcount", "Headcount growth · YoY"]) {
      if (cmp.metrics.some((m) => m.name === name))
        err(
          "compare shows unknown headcount",
          unknown.id,
          `"${name}" is compared against ${known.id} although ${unknown.id} has no headcount`,
        );
    }
  }
}

// ── WGEA headcount ──────────────────────────────────────────────────────────
// data/wgeaWorkforceAu.ts is generated from the WGEA register and every failure
// below renders as a confident figure on a card rather than as an absence,
// which is the only reason any of it is asserted mechanically.
{
  const wgea = Object.entries(WGEA_HEADCOUNT);

  // A KEY THAT IS NOT A ROSTER COMPANY FILES A FIGURE ONTO NOTHING. The keys
  // are the roster's own ids, printed by scripts/dump-roster.ts and read back
  // by the generator, so a drift here means the dump and the roster disagree.
  // Nothing downstream notices: `filedHeadcount` returns undefined for an id no
  // company has and the card falls back to "no workforce figure collected", so
  // the company looks unsourced while the row looks filed.
  for (const [id] of wgea)
    if (!rosterIds.has(id)) err("wgea key is not a company", id, "no roster company has this id");

  // A company the register does not report is absent, never zero.
  for (const [id, h] of wgea)
    if (!(h.now > 0)) err("wgea headcount not positive", id, `now ${h.now}`);

  // WGEA COUNTS HEADS, and the tile's label is chosen from `unit`. An `fte` row
  // here would put a full-time-equivalent under the word "Headcount".
  for (const [id, h] of wgea)
    if (h.unit !== "headcount")
      err("wgea unit is not headcount", id, `unit ${String(h.unit)} — WGEA reports heads`);

  // A SPAN OF 0 AND A CHANGE ARE CONTRADICTORY. `span: 0` is how the generator
  // records that there is no comparable prior reading — the company appears in
  // only one file, or its corporate group gained or lost a member so the two
  // totals cover different employers, or the newest reading was a fragment and
  // the prior year was used instead. The card reads `yoy === null` to print an
  // em dash and `span` to label the period, so the two have to agree.
  for (const [id, h] of wgea) {
    if (h.span === 0 && h.yoy !== null)
      err("wgea change with no span", id, `yoy ${h.yoy} over span 0 — no comparable prior reading`);
    if (h.span > 0 && h.yoy === null)
      err("wgea span with no change", id, `span ${h.span} but yoy null`);
  }

  // A COMPANY DOES NOT TRIPLE IN A YEAR. Same ceiling and reasoning as the gov
  // check above: this does not police the data, it catches a sum that picked up
  // rows belonging to something else. The nearest real risk is a subsidiary —
  // 'RMIT ONLINE PTY LTD' and 'RMIT TRAINING PTY LTD' sit beside 'Royal
  // Melbourne Institute Of Technology' in the same file — so a rule that ever
  // started matching on substrings would land here.
  const ABSURD_PCT_WGEA = 200;
  for (const [id, h] of wgea)
    if (h.yoy !== null && Math.abs(h.yoy) > ABSURD_PCT_WGEA)
      err(
        "wgea headcount moved absurdly",
        id,
        `${h.prev} -> ${h.now} is ${h.yoy}% over ${h.span}y — a subsidiary in the sum reads like this`,
      );

  // Below that ceiling, a large move is usually real and occasionally is not,
  // and the difference cannot be settled mechanically — Whitehaven's +124% is
  // the Daunia and Blackwater mines it bought from BHP, while Lovisa's +117%
  // has one employer on both sides and no acquisition behind it. So these are
  // listed rather than failed, and are the rows to look at first after a
  // refresh.
  const EYEBALL_PCT = 50;
  for (const [id, h] of wgea)
    if (h.yoy !== null && Math.abs(h.yoy) > EYEBALL_PCT && Math.abs(h.yoy) <= ABSURD_PCT_WGEA)
      warn(
        "wgea moved a lot",
        id,
        `${h.prev} -> ${h.now} is ${h.yoy}% — real, or a group that changed shape?`,
      );

  // ONE REGISTER ENTRY ON SEVERAL COMPANIES is either an ALIAS pointing two
  // roster names at one employer — which would file the same number twice and
  // read as two companies that happen to be identical — or a company the
  // roster holds twice. Measured 2026-09-24 it is the second: `smr` and
  // `brisbane-smr` are both Stanmore Resources, so both correctly carry
  // STANMORE RESOURCES LIMITED's 782. That is a roster duplicate rather than a
  // matching fault, so this warns instead of failing; a NEW pair appearing
  // after an ALIAS edit is the case to look at.
  const byFigure = new Map<string, string[]>();
  for (const [id, h] of wgea) {
    const k = `${h.now}|${h.prev}|${h.asof}`;
    byFigure.set(k, [...(byFigure.get(k) ?? []), id]);
  }
  for (const [k, ids] of byFigure)
    if (ids.length > 1)
      warn(
        "one wgea figure on several companies",
        ids.join(", "),
        `all report ${k.split("|")[0]} — the same employer twice on the roster, or one ALIAS matching twice?`,
      );

  // WGEA MUST NOT DISPLACE AN ANNUAL REPORT. This guards the ORDER in
  // filedHeadcount and it is the one failure here with no visible symptom.
  // WGEA counts AUSTRALIAN employees only; an annual report counts the group
  // worldwide. For a multinational the two differ by most of the company — Rio
  // Tinto is 26,419 here against roughly 60,000 filed — so a lookup preferring
  // WGEA would quietly reissue it as its Australian headcount: a real number,
  // from a real filing, describing a different organisation. The generator
  // emits rows for companies that already have an annual report precisely so
  // this has real overlapping keys to test rather than passing vacuously.
  let overlaps = 0;
  for (const [id, h] of wgea) {
    const own = COMPANY_HEADCOUNT[id] ?? GOV_HEADCOUNT_AU[id];
    if (!own) continue;
    overlaps++;
    const got = filedHeadcount(id);
    if (got && got.now !== own.now)
      err(
        "wgea displaced a filed figure",
        id,
        `filedHeadcount returns ${got.now} but the annual-report/gov source says ${own.now} — ` +
          `WGEA (${h.now}, Australia only) must be merged last`,
      );
  }
  if (overlaps < 20)
    warn(
      "wgea overlap too small to test",
      `${overlaps} keys`,
      "the merge-order assertion needs companies present in both sources to mean anything",
    );
}

// ── report ──────────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ errors, warns }, null, 2));
} else {
  console.log(
    `Roster: ${COMPANIES.length} companies · ${CAREER_SITES.length} career sites · ` +
      `${Object.keys(SEEK_ADVERTISERS).length} SEEK advertisers ` +
      `(+${Object.values(SEEK_TRADING_NAMES).flat().length} trading names)`,
  );
  for (const f of errors) console.log(`  ERROR  ${f.kind.padEnd(24)} ${f.id}  — ${f.detail}`);
  for (const f of warns) console.log(`  warn   ${f.kind.padEnd(24)} ${f.id}  — ${f.detail}`);
  console.log(errors.length ? `\n${errors.length} error(s).` : "\nNo wiring errors.");
}

process.exit(errors.length ? 1 : 0);
