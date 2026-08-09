/**
 * Check the landing page's four counters against the live archive.
 *
 * WHY THIS EXISTS
 * The sandbox this repo is usually worked in cannot open the deployed page —
 * Chromium has no route to remote hosts through the proxy — so "it deployed,
 * therefore the numbers are right" is not a claim anyone can make from here.
 * This pulls the same rows getLandingStats pulls and runs the SAME exported
 * aggregation over them, so the figures can be checked without a browser.
 *
 * It reads D1 through the Cloudflare HTTP API rather than a binding, the way
 * the scripts/*-to-d1.py feeds do. Needs CLOUDFLARE_API_TOKEN in the
 * environment (never in the repo).
 *
 *   npx tsx scripts/check-landing-stats.ts
 *
 * Prints the public (released-markets-only) figures the page will show, the
 * admin figures beside them, and the raw row count they were counted from, so
 * a suspicious number can be traced to whether it was the query or the gate.
 */
import {
  aggregateLandingStats,
  STATS_SQL,
  type StatsRow,
} from "../src/employsi/lib/landingStatsFn";

const ACCOUNT = "080a66721e2d85950d9d7dc939e08b76";
const DATABASE = "1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1";

const day = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error("CLOUDFLARE_API_TOKEN is not set.");
    process.exit(2);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: STATS_SQL.replace("?1", "?"), params: [day(1)] }),
  });
  const body = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: { results: StatsRow[] }[];
  };
  if (!res.ok || !body.success) {
    console.error(
      "D1 query failed:",
      res.status,
      JSON.stringify(body.errors ?? body).slice(0, 400),
    );
    process.exit(1);
  }
  const rows = body.result?.[0]?.results ?? [];
  const pub = aggregateLandingStats(rows, false);
  const admin = aggregateLandingStats(rows, true);
  console.log(`rows returned (grouped)      ${rows.length.toLocaleString("en-US")}`);
  console.log(`window                       last_seen >= ${day(1)}`);
  console.log("");
  console.log("                             PUBLIC (what the page shows)   ADMIN (all markets)");
  const line = (k: keyof typeof pub, label: string) =>
    console.log(
      `${label.padEnd(28)} ${String(pub[k]).padStart(12)}                  ${String(admin[k]).padStart(10)}`,
    );
  line("vacancies", "Vacancies tracked live");
  line("employers", "Employers tracked");
  line("countries", "Countries tracked");
  line("cities", "Cities tracked");
  // A zero vacancy count is reported as a failure here even though the page
  // prints it honestly: on a working archive it means the feed broke, and a
  // checking script exists to make that loud.
  if (pub.vacancies === 0) {
    console.error("\nVacancies counted 0 — the archive read returned nothing usable.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
