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
/**
 * Recompute EVERY row rather than only the unkeyed ones.
 *
 * Needed whenever roleKey's definition changes: rows keyed under the old rule
 * keep the old value, so the same role sits under two keys and the
 * double-counting this column exists to remove comes back for exactly the rows
 * the change was meant to fix. Used when the CJK branch was added — under the
 * ASCII-only rule a mixed-script title had its Japanese half deleted, so
 * "サウンドプログラマー / Sound Programmer" keyed as "sound programmer".
 */
const REKEY = argv.includes("--rekey");
const LIMIT = Number(argv[argv.indexOf("--limit") + 1]) || Infinity;
/**
 * Rows read, and rows written, per round trip.
 *
 * ONE UPDATE PER REQUEST DOES NOT FINISH. The first version of this sent a
 * statement per row; measured against the live archive that is 726,428
 * requests, which at any realistic latency is days. The D1 REST API accepts
 * several statements in one `sql` string (verified against the live database:
 * "SELECT 1; SELECT 2;" returns two result sets), so a page is read in one
 * request and written in one more.
 */
const PAGE = 500;

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

  const WHERE = REKEY ? "1 = 1" : "role_key IS NULL OR role_key = ''";
  const pending = Number((await sql(`SELECT COUNT(*) AS n FROM jobs WHERE ${WHERE}`))[0]?.n ?? 0);
  console.log(`${pending.toLocaleString()} rows to ${REKEY ? "recompute" : "fill"}`);
  if (!pending || DRY) {
    if (DRY) console.log("--dry: nothing written");
    return;
  }

  /**
   * A SQLite string literal. Doubling the single quote is the whole of it —
   * SQLite has no backslash escape inside a string, so there is no second
   * sequence to handle. Inlined rather than bound because a request carrying
   * several hundred statements cannot sensibly share one positional parameter
   * list, and the values are a key this script just computed (lowercase
   * alphanumerics, spaces and pipes) plus a job_key already in the table.
   */
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

  let done = 0;
  let skipped = 0;
  let unchanged = 0;
  const started = Date.now();
  for (;;) {
    if (done + skipped + unchanged >= LIMIT) break;
    // In rekey mode every row already has a key, so "still unkeyed" cannot
    // page through them — it walks by OFFSET instead, which is stable here
    // because an update never changes whether a row matches `1 = 1`.
    const rows = await sql(
      `SELECT job_key, role_key, company_id, company, hub, location, title FROM jobs
        WHERE ${WHERE} LIMIT ?1${REKEY ? " OFFSET ?2" : ""}`,
      REKEY ? [PAGE, done + skipped + unchanged] : [PAGE],
    );
    if (!rows.length) break;
    const stmts: string[] = [];
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
      const jk = str(r.job_key);
      const want = k || jk;
      // Only write what actually moves. In rekey mode almost every row is
      // already correct, and an UPDATE for each would spend the whole run
      // rewriting values that already hold.
      if (!REKEY || str(r.role_key) !== want) {
        stmts.push(`UPDATE jobs SET role_key = ${lit(want)} WHERE job_key = ${lit(jk)};`);
        if (k) done++;
        else skipped++;
      } else {
        unchanged++;
      }
    }
    if (stmts.length) await sql(stmts.join("\n"));
    const n = done + skipped + unchanged;
    const rate = n / Math.max(1, (Date.now() - started) / 1000);
    console.log(
      `  ${n.toLocaleString()} / ${pending.toLocaleString()} · ${Math.round(rate)}/s` +
        ` · ~${Math.round((pending - n) / Math.max(rate, 0.01) / 60)} min left`,
    );
  }

  const left = Number(
    (await sql("SELECT COUNT(*) AS n FROM jobs WHERE role_key IS NULL OR role_key = ''"))[0]?.n ??
      0,
  );
  /**
   * The overstatement, measured ONLY over rows that have a key.
   *
   * COUNT(DISTINCT role_key) ignores NULLs in SQLite, so dividing the whole
   * table by it mid-backfill compares every row against the keyed handful: the
   * first test slice printed "726,948 rows describing 4,270 distinct roles —
   * rows overstate roles by 16925%", which is not a fact about the archive, it
   * is a fact about how far the backfill had got. Both sides of the ratio are
   * now the same population.
   */
  const keyed = Number(
    (await sql("SELECT COUNT(*) AS n FROM jobs WHERE role_key IS NOT NULL AND role_key <> ''"))[0]
      ?.n ?? 0,
  );
  const roles = Number(
    (
      await sql(
        "SELECT COUNT(DISTINCT role_key) AS n FROM jobs WHERE role_key IS NOT NULL AND role_key <> ''",
      )
    )[0]?.n ?? 0,
  );
  const all = Number((await sql("SELECT COUNT(*) AS n FROM jobs"))[0]?.n ?? 0);
  console.log(
    `\n${REKEY ? "rewrote" : "filled"} ${done.toLocaleString()}` +
      ` (${skipped.toLocaleString()} had no title` +
      (REKEY ? `, ${unchanged.toLocaleString()} already correct)` : ")"),
  );
  console.log(`${left.toLocaleString()} of ${all.toLocaleString()} rows still unfilled`);
  if (keyed) {
    console.log(
      `keyed so far: ${keyed.toLocaleString()} rows describing ${roles.toLocaleString()} distinct roles` +
        ` — rows overstate roles by ${Math.round((keyed / Math.max(roles, 1) - 1) * 100)}%` +
        (left ? " (over the keyed rows only — run to completion for the archive's figure)" : ""),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
