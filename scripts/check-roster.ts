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
import { SITES as CAREER_SITES } from "../workers/jobs-cron/careerSites";

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
for (const id of Object.keys(SEEK_ADVERTISERS)) {
  if (!rosterIds.has(id)) {
    err("seek-without-company", id, "seekAdvertisers entry has no roster entry");
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
  const fed = new Set<string>([...CAREER_SITES.map((s) => s.id), ...Object.keys(SEEK_ADVERTISERS)]);
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

// ── report ──────────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ errors, warns }, null, 2));
} else {
  console.log(
    `Roster: ${COMPANIES.length} companies · ${CAREER_SITES.length} career sites · ` +
      `${Object.keys(SEEK_ADVERTISERS).length} SEEK advertisers`,
  );
  for (const f of errors) console.log(`  ERROR  ${f.kind.padEnd(24)} ${f.id}  — ${f.detail}`);
  for (const f of warns) console.log(`  warn   ${f.kind.padEnd(24)} ${f.id}  — ${f.detail}`);
  console.log(errors.length ? `\n${errors.length} error(s).` : "\nNo wiring errors.");
}

process.exit(errors.length ? 1 : 0);
