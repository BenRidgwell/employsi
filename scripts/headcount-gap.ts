// Which AU/NZ roster companies still have NO filed workforce figure, and what
// each one would take to close.
//
// WHY A SCRIPT AND NOT A QUERY. The answer needs three things that only meet in
// TypeScript: the roster (assembled from eight files by companies.ts), the
// four-source merge in filedHeadcount(), and the live-ad count from D1. It was
// recomputed by hand for several rounds of this sweep and the classifications
// drifted — one pass ordered `headcount > 0` before `illustrative` while the
// card checks `illustrative` first, which mislabels every curated figure. The
// card's own function is the only correct answer to "what does the tile show",
// so this asks it rather than reimplementing it.
//
// Live ads need D1: CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID, CLOUDFLARE_API_TOKEN.
// Without them the ad column reads `-` and the company list is still correct --
// a `-` is not a zero, the same distinction check-skills.ts draws.
//
// Run: bun run scripts/headcount-gap.ts            # summary + routes
//      bun run scripts/headcount-gap.ts --csv      # the worklist, by archived + live
//      bun run scripts/headcount-gap.ts --route private
import { COMPANIES } from "../src/employsi/data/companies";
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { filedHeadcount } from "../src/employsi/lib/companyCard";
import { COMPANY_HEADCOUNT } from "../src/employsi/data/companyHeadcount";
import { GOV_HEADCOUNT } from "../src/employsi/data/perthGovWorkforce";
import { GOV_HEADCOUNT_AU } from "../src/employsi/data/govWorkforceAu";
import { WGEA_HEADCOUNT } from "../src/employsi/data/wgeaWorkforceAu";

const AU = ["sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "darwin", "hobart"];
const NZ = ["auckland", "wellington", "christchurch"];

const cityOf = new Map<string, string>();
for (const [city, entries] of Object.entries(CITY_COMPANIES))
  for (const e of entries as { id: string }[]) if (!cityOf.has(e.id)) cityOf.set(e.id, city);

type Row = {
  id: string;
  name: string;
  city: string;
  country: "AU" | "NZ";
  kind: string;
  source: string | null;
  ads: number | null;
  archived?: number;
  lastSeen?: string | null;
};

// What KIND of company this is, which decides which register could ever hold it.
//
// THESE ARE THE ROSTER'S OWN PREFIXES, NOT A GUESS AT THEM. Two of them are easy
// to get wrong and both were, in the first version of this script: Western
// Australia's agencies are `perth-gov-`, not `wa-gov-`, and `nz-` holds New
// Zealand GOVERNMENT bodies (Health NZ, the Reserve Bank, Transpower, Victoria
// University of Wellington) alongside NZX-listed companies. Misfiling either
// sends the next pass to a register that could never have held them — WGEA for a
// WA department, an annual report for a district health board.
const kindOf = (id: string) =>
  id.startsWith("aps-")
    ? "gov-aps"
    : id.startsWith("perth-gov-")
      ? "gov-wa"
      : /^(nsw|vic|qld|sa|nt|tas)-gov-/.test(id)
        ? `gov-${id.split("-")[0]}`
        : id.startsWith("nzgov-")
          ? "gov-nz"
          : id.startsWith("nz-")
            ? "nz"
            : id.startsWith("uni-")
              ? "university"
              : id.startsWith("priv-")
                ? "private"
                : "listed";

const sourceOf = (id: string) =>
  COMPANY_HEADCOUNT[id]
    ? "annual report"
    : GOV_HEADCOUNT[id]
      ? "gov bulletin"
      : GOV_HEADCOUNT_AU[id]
        ? "gov bulletin (AU)"
        : WGEA_HEADCOUNT[id]
          ? "WGEA"
          : null;

const all: Row[] = [];
for (const c of COMPANIES) {
  const city = cityOf.get(c.id);
  if (!city) continue;
  const country = AU.includes(city) ? "AU" : NZ.includes(city) ? "NZ" : null;
  if (!country) continue;
  all.push({
    id: c.id,
    name: c.name,
    city,
    country,
    kind: kindOf(c.id),
    source: sourceOf(c.id),
    ads: null,
  });
}

const filed = all.filter((r) => filedHeadcount(r.id) !== null);
const gap = all.filter((r) => filedHeadcount(r.id) === null);

// ---- live ads, per company_id, from D1 -------------------------------------
const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
const db = process.env.JOBS_ARCHIVE_DB_ID;
const tok = process.env.CLOUDFLARE_API_TOKEN;
if (acct && db && tok) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${db}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // THE WHOLE ARCHIVE, NOT JUST TODAY. A live count alone ranks the
        // worklist by who happens to be advertising this week, and several of
        // these employers advertise in bursts — Royal Melbourne Hospital has 54
        // archived rows and none live. `archived` is every row this company has
        // ever had, so it measures how much of the product's data leans on the
        // card; `live` stays the "is it advertising now" signal.
        sql: `SELECT company_id,
                     COUNT(*) archived,
                     SUM(CASE WHEN last_seen >= date('now','-1 day')
                              THEN 1 ELSE 0 END) live,
                     MAX(last_seen) last_seen
              FROM jobs GROUP BY company_id`,
      }),
    },
  );
  const j = (await res.json()) as {
    success: boolean;
    result?: {
      results: { company_id: string; archived: number; live: number; last_seen: string }[];
    }[];
    errors?: { message: string }[];
  };
  if (!j.success) {
    console.error("D1 query failed:", j.errors?.map((e) => e.message).join("; "));
  } else {
    const byId = new Map(j.result![0].results.map((r) => [r.company_id, r]));
    for (const r of all) {
      const d = byId.get(r.id);
      r.ads = d?.live ?? 0;
      r.archived = d?.archived ?? 0;
      r.lastSeen = d?.last_seen ?? null;
    }
  }
} else {
  console.error(
    "· live ads skipped — CLOUDFLARE_ACCOUNT_ID / JOBS_ARCHIVE_DB_ID / CLOUDFLARE_API_TOKEN not set",
  );
}

const adsOf = (r: Row) => (r.ads === null ? 0 : r.ads);
const scoreOf = (r: Row) => (r.archived ?? 0) + adsOf(r);
const sum = (rows: Row[]) => rows.reduce((a, b) => a + adsOf(b), 0);

if (process.argv.includes("--csv")) {
  // SORTED BY archived + live, WHICH DOUBLE-WEIGHTS WHAT IS ADVERTISING NOW.
  // A live row is also an archived row, so the sum counts it twice on purpose:
  // between two employers with the same history, the one still hiring is the one
  // whose blank card is being read today.
  console.log("company_id,name,city,country,kind,live_ads,archived_ads,score,last_seen");
  for (const r of [...gap].sort((a, b) => scoreOf(b) - scoreOf(a)))
    console.log(
      [
        r.id,
        `"${r.name.replace(/"/g, '""')}"`,
        r.city,
        r.country,
        r.kind,
        adsOf(r),
        r.archived ?? 0,
        scoreOf(r),
        r.lastSeen ?? "",
      ].join(","),
    );
} else {
  const wanted = process.argv.includes("--route")
    ? process.argv[process.argv.indexOf("--route") + 1]
    : null;
  console.log(`AU/NZ roster companies : ${all.length}`);
  console.log(`  filed                : ${filed.length}`);
  console.log(
    `  NO figure            : ${gap.length}   (${sum(gap).toLocaleString("en-AU")} live ads)`,
  );
  console.log();
  console.log("filed, by source:");
  for (const s of ["annual report", "gov bulletin", "gov bulletin (AU)", "WGEA"]) {
    const n = filed.filter((r) => r.source === s).length;
    console.log(`  ${s.padEnd(20)} ${String(n).padStart(4)}`);
  }
  console.log();
  console.log("the gap, by kind of company:");
  const kinds = [...new Set(gap.map((r) => r.kind))].sort(
    (a, b) => sum(gap.filter((r) => r.kind === b)) - sum(gap.filter((r) => r.kind === a)),
  );
  for (const k of kinds) {
    const rows = gap.filter((r) => r.kind === k);
    console.log(
      `  ${k.padEnd(14)} ${String(rows.length).padStart(4)} companies  ${String(sum(rows).toLocaleString("en-AU")).padStart(7)} live ads`,
    );
  }
  if (wanted) {
    console.log();
    console.log(`--- ${wanted}, by live ads ---`);
    for (const r of gap
      .filter((r) => r.kind === wanted || r.kind.startsWith(wanted))
      .sort((a, b) => adsOf(b) - adsOf(a)))
      console.log(`  ${String(r.ads ?? "-").padStart(5)}  ${r.name}  [${r.id}]`);
  }
}
