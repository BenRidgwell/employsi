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
import { readFileSync } from "node:fs";
import { SITES as CAREER_SITES, PORTAL_GROUPS } from "../workers/jobs-cron/careerSites";

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

// ── 6. Every career site is actually SCHEDULED ──────────────────────────────
// A site in SITES but in no PORTAL_GROUPS slice never fetches, and nothing
// errors — the run simply walks a list that does not include it. Thirteen feeds
// sat idle that way, and one more was orphaned by renaming a site id without
// touching the group that named it (`cba` -> `sydney-cba`).
//
// This checks the two files it can reach. PORTAL_TICKS (index.ts) and `crons`
// (wrangler.jsonc) must move with them: a GROUP with no tick is the same
// silent failure one level up, and is checked below by count.
{
  const grouped = new Set(PORTAL_GROUPS.flat());
  const keys = CAREER_SITES.map((s) => s.key ?? s.id);
  for (const k of keys) {
    if (!grouped.has(k)) err("feed-not-scheduled", k, "in SITES but in no PORTAL_GROUPS slice");
  }
  for (const g of grouped) {
    if (!keys.includes(g)) err("group-without-feed", g, "PORTAL_GROUPS names a site that is gone");
  }
}

// ── 7. Every group has a tick, and every tick has a cron ────────────────────
// The chain a portal feed depends on is four links long, in three files:
//
//   SITES → PORTAL_GROUPS → PORTAL_TICKS (index.ts) → crons (wrangler.jsonc)
//
// and a break at ANY link fails silently. Section 6 covers the first two. These
// are the other two, and each has already gone wrong once:
//
//   group with no tick   twenty-five boards were added to SITES and
//                        PORTAL_GROUPS but never to PORTAL_TICKS, so they had
//                        nothing to run on and fetched zero times.
//   tick with no cron    a tick keyed on a minute the Worker is not scheduled
//                        for is never delivered.
//   duplicate tick key   JavaScript takes the LAST definition of a repeated
//                        object key without complaining, so one of the two
//                        groups silently stops running. Hit twice while fixing
//                        this exact area.
//   duplicate cron       Cloudflare REJECTS the deploy ("duplicate cron
//                        found"), so this one is loud — but it is cheaper to
//                        catch here than after a failed push.
//
// index.ts imports Worker-only bindings, so both files are read as TEXT rather
// than imported. That is a deliberate trade: a regex over a literal is cruder
// than a real parse, but it needs no Worker runtime, and the shapes it reads
// are simple object literals and a string array.
{
  const src = readFileSync(new URL("../workers/jobs-cron/index.ts", import.meta.url), "utf8");
  const wrangler = readFileSync(
    new URL("../workers/jobs-cron/wrangler.jsonc", import.meta.url),
    "utf8",
  );
  const table = (name: string): [string, number][] => {
    const i = src.indexOf(`const ${name}`);
    if (i < 0) return [];
    return [...src.slice(i, src.indexOf("\n};", i)).matchAll(/"([^"]+)":\s*(\d+)/g)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
  };
  const portalTicks = table("PORTAL_TICKS");
  const newsTicks = table("NEWS_TICKS");
  const cronArr = wrangler.match(/"crons":\s*\[(.*?)\]/s)?.[1] ?? "";
  const crons = [...cronArr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  if (!portalTicks.length) err("ticks-unreadable", "PORTAL_TICKS", "found no entries in index.ts");
  if (!crons.length) err("crons-unreadable", "wrangler.jsonc", "found no crons array");

  const dupes = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

  for (const d of dupes([...portalTicks, ...newsTicks].map(([c]) => c))) {
    err("duplicate-tick", d, "declared twice — the later one silently wins");
  }
  for (const d of dupes(crons))
    err("duplicate-cron", d, "listed twice — Cloudflare rejects the deploy");

  const tickIdx = new Set(portalTicks.map(([, i]) => i));
  PORTAL_GROUPS.forEach((g, i) => {
    if (!tickIdx.has(i)) {
      err("group-without-tick", `group ${i}`, `${g.length} site(s) with no cron minute to run on`);
    }
  });
  for (const [, i] of portalTicks) {
    if (i >= PORTAL_GROUPS.length) {
      err("tick-without-group", `index ${i}`, "PORTAL_TICKS points past the end of PORTAL_GROUPS");
    }
  }
  const cronSet = new Set(crons);
  for (const [c] of [...portalTicks, ...newsTicks]) {
    if (!cronSet.has(c)) err("tick-without-cron", c, "no such minute in wrangler.jsonc crons");
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
