# Historical job archive (Cloudflare D1)

Every listing pulled from **Adzuna, The Muse and Jooble** — by both the daily
`jobs-cron` worker and the app's live per-company fetch (`openRolesFn`) — is
appended to a D1 (SQLite) database, deduped by a stable
`source|title|company|location` key, with `first_seen` / `last_seen` /
`seen_count` so listings accumulate into a queryable history rather than being
overwritten each run (which is all the KV snapshots do).

Schema: [`migrations/0001_jobs_archive.sql`](migrations/0001_jobs_archive.sql).
Writer: [`src/employsi/lib/jobArchive.ts`](../../src/employsi/lib/jobArchive.ts).

The archive is **optional** — until the `JOBS_ARCHIVE` binding is present the
write calls are a no-op, so the pipeline runs unchanged. To turn it on:

## 1. Create the database (needs a token with D1 permissions)

```bash
wrangler d1 create employsi-jobs-archive
```

Copy the `database_id` it prints.

## 2. Apply the schema

```bash
wrangler d1 execute employsi-jobs-archive --remote \
  --file=workers/jobs-cron/migrations/0001_jobs_archive.sql
```

## 3. Bind it on every worker that writes to it

Add to `workers/jobs-cron/wrangler.jsonc` **and** the root `wrangler.jsonc`
(the app + mobile workers):

```jsonc
"d1_databases": [
  { "binding": "JOBS_ARCHIVE", "database_name": "employsi-jobs-archive", "database_id": "<database_id>" }
]
```

## 4. Redeploy

```bash
# cron
cd workers/jobs-cron && wrangler deploy
# app + mobile
bun run build
wrangler deploy --name benridgwell-globe-gazer-hr
wrangler deploy --name benridgwell-globe-gazer-hr-mobile
```

## Inspecting the archive

```bash
wrangler d1 execute employsi-jobs-archive --remote \
  --command "SELECT source, COUNT(*) FROM jobs GROUP BY source"
wrangler d1 execute employsi-jobs-archive --remote \
  --command "SELECT title, company, location, salary, first_seen, last_seen, seen_count \
             FROM jobs WHERE company_id='perth-bhp' ORDER BY last_seen DESC LIMIT 20"
```
