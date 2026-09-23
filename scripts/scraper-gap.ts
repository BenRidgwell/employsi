/**
 * Which roster employers advertise most, among those we have NO company-specific
 * scraper for?
 *
 * WHAT THIS ANSWERS. Every company-specific feed — a careerSites.ts SiteDef, or
 * one of the hand-written scripts/*-to-d1.py portals — was hand-measured against
 * a live ATS, so they can only ever be built a few at a time. This ranks the
 * employers still without one by how much they actually advertise, so the next
 * one built is the one that buys the most coverage rather than the one that came
 * to mind.
 *
 * WHAT COUNTS AS "COVERED", and why it is only these two things:
 *   - a SiteDef in workers/jobs-cron/careerSites.ts keyed to the company id
 *   - a scripts/*-to-d1.py driver with a single `COMPANY_ID` constant (the
 *     browser-rendered portals that cannot run in a Worker)
 * Both are read from the source rather than listed here, so a feed added
 * tomorrow drops out of this report on its own.
 *
 * WHOLE-BOARD FEEDS ARE COVERAGE TOO, and leaving them out made the first run of
 * this report wrong in the way that matters. Its top rows were Queensland
 * Health, Victoria's government schools and SA Health — every one of them read
 * completely, every day, by its state government board scraper. A government
 * board is one employer FAMILY and complete for it (dataQualityFn.sourceKind
 * says so), and uniroles.com.au is the same thing for the universities: "one
 * walk covers all of them at once". Nobody should build a Queensland Health ATS
 * integration, and a report whose headline says to is worse than none.
 *
 * So a company whose rows come from one of those boards is marked `gov` or
 * `uni` in the `via` column, and `--gaps` drops it. It is marked rather than
 * deleted because the two are different claims: covered by a board that reads
 * the whole family, versus covered by nothing.
 *
 * A SEEK advertiser id (seekAdvertisers.ts) is NOT counted as covered, and is
 * reported in its own column instead. It is company-specific — the SEEK pull
 * walks that employer's whole board by id — but it is one board rather than the
 * employer's own ATS, so it sees only what they chose to post there. It is the
 * single most useful thing to know when reading a row: an employer with no
 * portal AND no advertiser id is invisible except through keyword search.
 *
 * HOW THE ADS ARE COUNTED, which is the part that can mislead:
 *
 *   rows   raw archive rows. The literal "ads we hold". It DOUBLE COUNTS across
 *          sources — job_key is source|title|company|location, and Adzuna and
 *          Jora republish SEEK's and Indeed's listings, so one vacancy carried
 *          by three feeds is three rows.
 *   ads    distinct title+location. The same vacancy seen on three boards
 *          collapses to one, which is why this is what the table RANKS on.
 *   live   still advertised: last_seen >= yesterday, the same cut the company
 *          card's open-roles figure uses (openRolesFn.currentFromArchive).
 *
 * Rows are attributed by `company_id` only — exactly what the app renders a
 * company card from. An ad archived under a company name we never resolved to a
 * roster id is not this report's business; scripts/audit-attribution.py is.
 *
 * HISTORICAL_SOURCES are excluded. `wayback` is a closed corpus of ads from dead
 * career sites, 2003-2018; on the question this report asks — who is advertising
 * enough to be worth a scraper — those rows are not old data, they are the wrong
 * data. Measured previously on BHP: 95% of its rows, and a span wrong by 22 years.
 *
 * Needs CLOUDFLARE_API_TOKEN (D1 read) in the environment, never in the repo.
 *
 *   bun run scripts/scraper-gap.ts            # top 60
 *   bun run scripts/scraper-gap.ts --gaps     # hide the whole-board-covered ones
 *   bun run scripts/scraper-gap.ts --all      # every employer with an ad
 *   bun run scripts/scraper-gap.ts --top 200
 *   bun run scripts/scraper-gap.ts --csv      # id,name,... to stdout
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPANIES } from "../src/employsi/data/companies";
import { SITES } from "../workers/jobs-cron/careerSites";
import { SEEK_ADVERTISERS } from "../src/employsi/data/seekAdvertisers";
import { HISTORICAL_SOURCES } from "../src/employsi/lib/jobArchive";

const ACCOUNT = "080a66721e2d85950d9d7dc939e08b76";
const DATABASE = "1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1";

/**
 * openRolesFn.COMPANY_ID_ALIAS, read out of its source.
 *
 * It cannot be IMPORTED: openRolesFn pulls in @tanstack/react-start, which
 * needs react, and this script runs under bare bun in CI with no app deps. A
 * copy of the map here would be a silent liability instead — the app reads a
 * company's rows under its alias, so an alias this script does not know about
 * makes that company read as zero ads and top the "build a scraper next" list,
 * which is the one output that must not be wrong.
 *
 * So it is parsed, and a parse that finds NOTHING throws rather than returning
 * an empty map: the declaration is small and hand-written, so the only way to
 * find no pairs is that it was renamed or restructured, and continuing then
 * would quietly reintroduce exactly the failure above.
 */
function companyIdAlias(root: string): Record<string, string> {
  const src = readFileSync(join(root, "src/employsi/lib/openRolesFn.ts"), "utf8");
  const block = /COMPANY_ID_ALIAS[^=]*=\s*\{([^}]*)\}/.exec(src);
  const out: Record<string, string> = {};
  for (const m of (block?.[1] ?? "").matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) {
    out[m[1]] = m[2];
  }
  if (!Object.keys(out).length) {
    throw new Error(
      "COMPANY_ID_ALIAS could not be read from src/employsi/lib/openRolesFn.ts — " +
        "it was renamed or restructured. Fix companyIdAlias() before trusting this report.",
    );
  }
  return out;
}

/**
 * Company ids owned by a hand-written driver in scripts/.
 *
 * Read out of the source, not listed, for the same reason the SiteDef ids are:
 * a list here would be one more thing to update when a portal is added, and the
 * cost of forgetting is a report that tells you to build a scraper that exists.
 *
 * TWO FORMS, AND READING ONLY THE FIRST PUT SEVEN COVERED EMPLOYERS AT THE TOP
 * OF THIS REPORT. The note here used to say that `^COMPANY_ID = '…'` was the
 * convention every driver follows, and that "a driver that covers MANY
 * companies reads its ids from the roster and so has no such constant, which is
 * exactly the distinction wanted here". That is true of the whole-family
 * drivers it was written for, and there is a third kind it did not account for:
 * a driver covering a FIXED, NAMED handful of employers, choosing one per run
 * from a CFG dict.
 *
 *   dayforce-to-d1.py  COMPANY_ID, COMPANY = CFG['company_id'], CFG['company']
 *   compass-to-d1.py   COMPANY_ID = CFG['company_id']
 *
 * Neither line carries a quoted id, so neither matched, so all seven employers
 * they cover — Uniting, EVT, Avant Mutual, CMV Group, Compass Group, Built and
 * BMD Group — read as gaps. Between them that was 4,762 ads, and the top five
 * rows of the report: the loudest recommendation it made was to build five
 * scrapers that run nightly and were writing rows that same day. Exactly the
 * failure the alias note above describes, from a different direction.
 *
 * So the ids are taken from the constant AND from every `'company_id': '…'`
 * literal in the file. A driver that genuinely reads its ids from the roster
 * still has neither, so the distinction the original note wanted is intact.
 */
function scriptPortalIds(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".py")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    const one = /^COMPANY_ID = ['"]([^'"]+)['"]/m.exec(src);
    if (one) out.set(one[1], f);
    for (const m of src.matchAll(/['"]company_id['"]\s*:\s*['"]([^'"]+)['"]/g)) {
      if (!out.has(m[1])) out.set(m[1], f);
    }
  }
  return out;
}

interface StatRow {
  company_id: string;
  rows_all: number;
  ads: number;
  rows_live: number;
  ads_live: number;
  first_seen: string;
  last_seen: string;
  sources: string;
}

const SQL = `
SELECT company_id,
       COUNT(*)                                                   AS rows_all,
       COUNT(DISTINCT lower(title) || '|' || lower(COALESCE(location,''))) AS ads,
       SUM(CASE WHEN last_seen >= date('now','-1 day') THEN 1 ELSE 0 END)  AS rows_live,
       COUNT(DISTINCT CASE WHEN last_seen >= date('now','-1 day')
                           THEN lower(title) || '|' || lower(COALESCE(location,'')) END) AS ads_live,
       MIN(first_seen) AS first_seen,
       MAX(last_seen)  AS last_seen,
       group_concat(DISTINCT source) AS sources
  FROM jobs
 WHERE company_id IS NOT NULL AND company_id <> ''
   AND COALESCE(source,'') NOT IN (${[...HISTORICAL_SOURCES].map((s) => `'${s}'`).join(",")})
 GROUP BY company_id`;

async function query(token: string): Promise<StatRow[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: SQL }),
  });
  const body = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: { results: StatRow[] }[];
  };
  if (!res.ok || !body.success) {
    console.error(
      "D1 query failed:",
      res.status,
      JSON.stringify(body.errors ?? body).slice(0, 400),
    );
    process.exit(1);
  }
  return body.result?.[0]?.results ?? [];
}

/**
 * Feeds that read a whole employer FAMILY to completion, so a company they
 * carry needs no integration of its own.
 *
 * Both tests come from what the feeds already are, not from a list of company
 * ids: `*-gov` is dataQualityFn.sourceKind's own rule for a government board,
 * and uniroles is the universities' shared board (see uniroles-archive.yml —
 * one walk covers all of them). Anything else is a market, not a family.
 */
function wholeBoard(sources: string): "gov" | "uni" | "" {
  const list = sources.split(",").filter(Boolean);
  if (list.some((s) => s.endsWith("-gov"))) return "gov";
  if (list.includes("uniroles")) return "uni";
  return "";
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error("CLOUDFLARE_API_TOKEN is not set.");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const csv = args.includes("--csv");
  const gapsOnly = args.includes("--gaps");
  const topArg = args.indexOf("--top");
  const limit = args.includes("--all")
    ? Infinity
    : topArg >= 0
      ? Number(args[topArg + 1]) || 60
      : 60;

  const here = import.meta.dir ?? __dirname;
  const alias = companyIdAlias(join(here, ".."));
  const drivers = scriptPortalIds(here);
  const portals = new Map<string, string>();
  for (const s of SITES) portals.set(s.id, `careerSites:${s.key ?? s.id}`);
  for (const [id, f] of drivers) if (!portals.has(id)) portals.set(id, `scripts/${f}`);

  const stats = new Map<string, StatRow>();
  for (const r of await query(token)) stats.set(r.company_id, r);

  // The ALIAS APPLIES TO BOTH SIDES, and the first run of this report proved
  // why. It was applied only to the row lookup, so HSBC came top of the list at
  // 3,809 ads — reading london-hsba's rows, which the london-hsba SiteDef had
  // put there, under hongkong-00005, which matched no SiteDef. The report's
  // single loudest recommendation was to build a feed that already existed and
  // was working. An alias means the two ids are one company; a coverage test
  // that ignores it splits that company in half.
  const covered = (id: string) => portals.has(id) || portals.has(alias[id] ?? id);
  const gap = COMPANIES.filter((c) => !covered(c.id)).map((c) => {
    const s = stats.get(alias[c.id] ?? c.id);
    const sources = s?.sources ?? "";
    return {
      id: c.id,
      name: c.name,
      ticker: c.ticker,
      group: c.group ?? "",
      seek: SEEK_ADVERTISERS[c.id] ? "seek" : "",
      rows: s?.rows_all ?? 0,
      ads: s?.ads ?? 0,
      live: s?.ads_live ?? 0,
      liveRows: s?.rows_live ?? 0,
      first: s?.first_seen ?? "",
      last: s?.last_seen ?? "",
      sources,
      // A portal-* row under a company with no SiteDef of its own is not a gap,
      // it is a WIRING question — some portal is filing rows here. Surfaced
      // rather than resolved: the roster check owns that chain.
      via: wholeBoard(sources) || (/(^|,)portal-/.test(sources) ? "portal!" : ""),
    };
  });
  gap.sort((a, b) => b.ads - a.ads || b.live - a.live || a.name.localeCompare(b.name));
  const boardCovered = gap.filter((r) => r.via === "gov" || r.via === "uni").length;
  const withAds = gap
    .filter((r) => r.ads > 0)
    .filter((r) => !(gapsOnly && (r.via === "gov" || r.via === "uni")));

  if (csv) {
    console.log(
      "rank,id,name,ticker,group,ads,live,rows,seek_advertiser,covered_by_board," +
        "first_seen,last_seen,sources",
    );
    withAds.forEach((r, i) =>
      console.log(
        [
          i + 1,
          r.id,
          `"${r.name.replace(/"/g, '""')}"`,
          r.ticker,
          `"${r.group}"`,
          r.ads,
          r.live,
          r.rows,
          r.seek ? "yes" : "no",
          r.via,
          r.first,
          r.last,
          `"${r.sources}"`,
        ].join(","),
      ),
    );
    return;
  }

  console.log(
    `roster ${COMPANIES.length} companies · ${portals.size} have a company-specific scraper ` +
      `(${SITES.length} careerSites feeds + ${drivers.size} scripts/ drivers)`,
  );
  console.log(
    `${gap.length} without one · ${gap.filter((r) => r.ads > 0).length} of those have at least ` +
      `one archived ad · ${boardCovered} of those are read completely by a whole-employer-family ` +
      `board (--gaps hides them)`,
  );
  console.log(
    "\nads  = distinct title+location (one vacancy on three boards counts once)\n" +
      "live = of those, still advertised (last_seen >= yesterday)\n" +
      "rows = raw archive rows, which double count across republishing feeds\n" +
      "seek = we already pull this employer's whole SEEK board by advertiser id\n" +
      "via  = gov/uni: a board already reads this employer family to completion, so this is\n" +
      "       not a gap. portal!: a portal-* feed files rows here with no SiteDef of its own\n",
  );
  const head = `${"#".padStart(4)}  ${"ads".padStart(6)} ${"live".padStart(5)} ${"rows".padStart(7)}  ${"seek".padEnd(4)} ${"via".padEnd(7)} ${"id".padEnd(30)} ${"company".padEnd(40)} sources`;
  console.log(head);
  console.log("-".repeat(head.length));
  withAds.slice(0, limit === Infinity ? withAds.length : limit).forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${String(r.ads).padStart(6)} ${String(r.live).padStart(5)} ` +
        `${String(r.rows).padStart(7)}  ${r.seek.padEnd(4)} ${r.via.padEnd(7)} ${r.id.padEnd(30)} ` +
        `${r.name.slice(0, 40).padEnd(40)} ${r.sources}`,
    );
  });
  if (limit !== Infinity && withAds.length > limit) {
    console.log(
      `\n… ${withAds.length - limit} more with ads; --all for every row, --csv for the file.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
