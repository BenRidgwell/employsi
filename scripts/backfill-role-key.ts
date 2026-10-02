/**
 * Fill `jobs.role_key` on rows archived before the column existed.
 *
 * WHY A BACKFILL AT ALL. The column is written on every insert AND on every
 * re-seen row (archiveJobs sets it with COALESCE), so anything still being
 * advertised fills itself in within a night or two. What needs this script is
 * the dormant half of the archive: roles that closed before the column
 * existed, which nothing will touch again and which every historical count —
 * the vacancy chart, a month the analyst reaches back to — still reads.
 *
 * UNTIL IT RUNS, COUNTS ARE EXACTLY WHAT THEY WERE. ROLE_COUNT_SQL falls back
 * to `job_key` for a row with no role_key, and job_key is unique per row, so
 * an un-backfilled row counts once — the old behaviour. Numbers move to the
 * deduped ones as this lands, rather than breaking in between. That is why it
 * is safe to deploy the readers first and run this afterwards.
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID and CLOUDFLARE_API_TOKEN.
 *
 *   bun run scripts/backfill-role-key.ts            # the whole archive
 *   bun run scripts/backfill-role-key.ts --dry      # count, write nothing
 *   bun run scripts/backfill-role-key.ts --limit 50000
 *
 * Idempotent: it only touches rows where role_key IS NULL OR role_key = '',
 * so a second run after a completed one does nothing. Safe to stop and resume
 * — progress is the rows already written, not a cursor held in memory.
 */

import { roleKey } from "../src/employsi/lib/roleKey";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB = process.env.JOBS_ARCHIVE_DB_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT || !DB || !TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}

const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`;
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const LIMIT = Number(argv[argv.indexOf("--limit") + 1]) || Infinity;
/** D1 caps bound parameters per statement; two per row plus headroom. */
const BATCH = 40;

type Row = Record<string, unknown>;

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql: query, params }),
  });
  const j = (await r.json()) as {
    success?: boolean;
    errors?: unknown;
    result?: { results?: Row[] }[];
  };
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results ?? [];
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

async function main() {
  // The column is created by the Worker on its first archive write. Creating
  // it here too means the backfill can run against a database the Worker has
  // not written to since the deploy.
  try {
    await sql("ALTER TABLE jobs ADD COLUMN role_key TEXT");
    console.log("added jobs.role_key");
  } catch {
    console.log("jobs.role_key already present");
  }
  try {
    await sql("CREATE INDEX IF NOT EXISTS idx_jobs_role_key ON jobs(role_key)");
  } catch {
    console.log("could not create the index — counts are still correct, just slower");
  }

  const pending = Number(
    (await sql("SELECT COUNT(*) AS n FROM jobs WHERE role_key IS NULL OR role_key = ''"))[0]?.n ??
      0,
  );
  console.log(`${pending.toLocaleString()} rows to fill`);
  if (!pending || DRY) {
    if (DRY) console.log("--dry: nothing written");
    return;
  }

  let done = 0;
  let skipped = 0;
  for (;;) {
    if (done + skipped >= LIMIT) break;
    const rows = await sql(
      `SELECT job_key, company_id, company, hub, location, title FROM jobs
        WHERE role_key IS NULL OR role_key = '' LIMIT ?1`,
      [BATCH],
    );
    if (!rows.length) break;
    const writes: Promise<unknown>[] = [];
    for (const r of rows) {
      const k = roleKey(
        str(r.company_id),
        str(r.company),
        str(r.hub),
        str(r.location),
        str(r.title),
      );
      // A row with no usable title gets a key of "". Writing that would leave
      // it matching the `role_key = ''` filter forever and the loop would
      // never terminate, so it is given its own job_key instead — which is
      // exactly what ROLE_COUNT_SQL falls back to anyway, so the count is
      // unchanged and the row stops being re-read.
      writes.push(
        sql("UPDATE jobs SET role_key = ?1 WHERE job_key = ?2", [
          k || str(r.job_key),
          str(r.job_key),
        ]),
      );
      if (k) done++;
      else skipped++;
    }
    await Promise.all(writes);
    if ((done + skipped) % 1000 < BATCH) {
      console.log(`  ${(done + skipped).toLocaleString()} / ${pending.toLocaleString()}`);
    }
  }

  const left = Number(
    (await sql("SELECT COUNT(*) AS n FROM jobs WHERE role_key IS NULL OR role_key = ''"))[0]?.n ??
      0,
  );
  const roles = Number((await sql("SELECT COUNT(DISTINCT role_key) AS n FROM jobs"))[0]?.n ?? 0);
  const all = Number((await sql("SELECT COUNT(*) AS n FROM jobs"))[0]?.n ?? 0);
  console.log(`\nfilled ${done.toLocaleString()} (${skipped.toLocaleString()} had no title)`);
  console.log(`${left.toLocaleString()} still unfilled`);
  console.log(
    `archive: ${all.toLocaleString()} rows describing ${roles.toLocaleString()} distinct roles` +
      (all
        ? ` — rows overstate roles by ${Math.round((all / Math.max(roles, 1) - 1) * 100)}%`
        : ""),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
