# WA Government vacancies feed (`waGov.ts`)

The 62 Perth government agencies (ids `perth-gov-*`, see
[`data/perthGov.ts`](../../src/employsi/data/perthGov.ts)) don't get their live
vacancies from Adzuna/Muse — they're scraped from the official WA public-sector
board **https://search.jobs.wa.gov.au/jobs/search** and mapped to each agency by
its "Agency" (department) field. Every job's attributes are captured: title +
canonical URL, employment type, salary, classification level, occupation,
location and branch.

Runs on its own cron minute (`30 */6 * * *`) so its page fetches get a clean
subrequest budget. Each run:

- reads **page 1** for the authoritative per-agency live counts (the board's own
  `department` filter facet) and the grand total — always exact, one request;
- walks a **cursor window** of ~10 further pages (the board sits behind an AWS
  WAF that challenges bursts, so a run only reads a slice), advancing the cursor
  each run so the whole board is covered across a day;
- merges each agency's listings **by URL**, ageing out any not re-seen within 4
  days, so attribute coverage accumulates without keeping taken-down ads;
- writes `wagov:{id}` (`{ updated, count, jobs }`) consumed by the company card,
  appends the daily `roles:{id}` count history, and archives to D1 (`source =
  wa-gov`).

The company card reads it transparently: `openRolesFn` intercepts `perth-gov-*`
ids and serves `wagov:{id}`, so open-roles count, "where they're hiring", "skills
in demand" and the vacancy-history chart all run off the real WA feed.

Manual trigger (token-gated): `GET /run-wagov?token=CRON_TOKEN`.

---

# SEEK company feed (`seek.ts`)

SEEK (seek.com.au) is Australia's dominant board. For each AU company its search
API is pulled by **advertiser id** — one employer, **all** classifications (not
just IT, unlike the SeekSpider project this is derived from) — so a company's
entire live board flows in. Advertiser ids are resolved **offline** by exact
name match (`scripts/gen-seek-advertisers.py` → [`data/seekAdvertisers.ts`](../../src/employsi/data/seekAdvertisers.ts),
113/205 companies as of writing), so the Worker pulls by id in one request per
company with no live resolution.

SEEK is layered on TOP of Adzuna + The Muse inside `pullCompany` and
cross-checked by normalised title, so a role advertised on more than one board
is **counted once** — the same no-double-counting mechanism The Muse already
uses. Its results flow through the same KV write + D1 archive path (`source =
seek`) and skill index as every other source.

**SEEK does not run in the Worker.** Its Cloudflare front returns a 403
`challenge` page to requests originating from Cloudflare Workers (a
Cloudflare-to-Cloudflare fingerprint — confirmed via `/diag-seek?...&raw=1`),
so the in-Worker pull is gated off (`SEEK_VIA_WORKER`, default off) and
`fetchSeekCompanyJobs`/`seekAdvertisers` are kept only for that probe and a
possible future residential-proxy path.

Instead the SEEK feed runs from a **non-Cloudflare host** — a daily GitHub
Action ([`.github/workflows/seek-archive.yml`](../../.github/workflows/seek-archive.yml))
running [`scripts/seek-to-d1.py`](../../scripts/seek-to-d1.py). GitHub's runners
are ordinary IPs SEEK serves normally. The script scrapes each mapped company's
board (Python/urllib — SEEK also challenges bun's fetch fingerprint, but not
Python's), maps skills for parity via the worker's own taxonomy
([`scripts/map-skills.ts`](../../scripts/map-skills.ts)), drops any role already
archived for that company by another source, and upserts through the D1 HTTP API
with the same key as `jobArchive.ts`. It exits non-zero if >50% of companies
return zero (the block/degradation signal), so a blocked run shows red in
Actions.

Setup: add a repo secret `CLOUDFLARE_API_TOKEN` (D1 edit); optionally repo
variables `CF_ACCOUNT_ID` / `D1_DATABASE_ID` (else the script's defaults apply).
Regenerate the advertiser id map with `python scripts/gen-seek-advertisers.py`
(also from a non-Workers host). Worker-IP reachability probe (token-gated):
`GET /diag-seek?token=CRON_TOKEN&id=bhp` (add `&raw=1` for the upstream status).

---

# Indeed company feed (`tools/indeed-company-scraper` + `scripts/indeed-to-d1.py`)

Indeed sits behind **DataDome**, which 403-blocks datacenter/CI/Workers IPs, so
it can't run from the cron worker *or* a GitHub Action. Instead the Indeed feed
runs from a **residential machine on a schedule** (cron/launchd/Task Scheduler):
[`scripts/indeed-to-d1.py`](../../scripts/indeed-to-d1.py) drives the
[`tools/indeed-company-scraper`](../../tools/indeed-company-scraper) browser
across the company roster (each company's board, all locations), maps skills for
parity, drops roles already archived for that company by another source, and
upserts to D1 (`source = indeed`) with the same key + upsert as everything else.
See that tool's README for setup + scheduling. It's the only feed whose archive
step runs off-repo, because DataDome leaves no reliable server-side path.

---

# Historical job archive (Cloudflare D1)

Every listing pulled from **Adzuna, The Muse, Jooble, SEEK and Indeed** — the
first four by the daily `jobs-cron` worker / GitHub Action and the app's live
per-company fetch (`openRolesFn`), Indeed from a scheduled residential run —
is appended to a D1 (SQLite) database, deduped by a stable
`source|title|company|location` key, with `first_seen` / `last_seen` /
`seen_count` so listings accumulate into a queryable history rather than being
overwritten each run (which is all the KV snapshots do). Cross-**source** double
counting (the same role on SEEK and Adzuna) is prevented upstream in
`pullCompany` by the normalised-title check, before rows ever reach the archive.

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
