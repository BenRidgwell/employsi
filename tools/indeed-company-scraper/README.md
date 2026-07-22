# indeed-company-scraper

Every **Indeed** listing for a **single company**, across **all the locations**
it's currently recruiting in — with a per-location breakdown.

Repurposed from **[Eben001/IndeedJobScraper](https://github.com/Eben001/IndeedJobScraper)**,
which drives a stealth browser to Indeed's search results for a given **job
position + location** and emails a CSV. This tool keeps that project's core — a
real browser rendering Indeed's `job_seen_beacon` result cards, parsed with the
same resilient selectors — but repurposes it:

| | Original IndeedJobScraper | This tool |
| --- | --- | --- |
| **Query** | `q=<position>&l=<location>` | `q=company:"<Company>"`, **no location** |
| **Scope** | one position in one location | one **company across every location** |
| **Output** | emails a CSV | writes CSV + JSON, prints a per-location summary |
| **Driver** | Selenium + selenium-stealth + undetected-chromedriver | Playwright + Chromium (+ stealth init script) |

## How it works

Indeed supports a `company:"Name"` search operator. Searching that with the
location field left empty returns the employer's **entire** live board, wherever
they're hiring. The tool renders each results page in a real (stealth-tuned)
Chromium, parses the `job_seen_beacon` cards (title, company, **location**,
posted date, salary snippet, apply URL), paginates, de-dupes by Indeed job id,
and reports how the roles break down by location.

```bash
pip install -r requirements.txt
playwright install chromium        # once, on a normal machine

# Every BHP listing on Indeed AU, all locations -> CSV + JSON
python indeed_company_scraper.py "BHP" --json

# A different Indeed country site
python indeed_company_scraper.py "Canva" --country us

# Scope to a single city
python indeed_company_scraper.py "Fortescue" --location "Perth WA"

# Watch the browser (useful to clear a wall by hand the first time)
python indeed_company_scraper.py "Woodside" --headful

# Drop recruiter noise — keep only cards whose company name matches
python indeed_company_scraper.py "BHP" --strict-company
```

`--country`: `au us uk ca nz sg ie de fr za ae in jp`. Run
`python indeed_company_scraper.py --help` for every flag.

## Output

One row per listing → `indeed_<company>_<country>.csv` (override with `--out`;
add `--json` for a matching `.json`):

| Field | Notes |
| --- | --- |
| `job_id`, `url` | Indeed job key + its `/viewjob` link |
| `title` | |
| `company` | the advertiser as Indeed shows it |
| `location` | **the point of a company-wide pull** — every city/region |
| `date` | "Posted / Employer active" text |
| `salary` | when the card states one (best-effort) |
| `country` | `au` / `us` / … |

The run prints a **by-location breakdown** and the total to stderr.

## Where to run it — important

Indeed sits behind **DataDome**, which hard-blocks datacenter / CI / Cloudflare-
Workers IPs — a plain request returns **HTTP 403** (verified from a datacenter
host). So, like the reference project and like
[`tools/seek-company-scraper`](../seek-company-scraper):

* Run it **manually, from a residential IP**. From a datacenter/CI IP the page
  is a DataDome wall — the scraper **detects that wall**, saves a screenshot
  (`indeed_blocked_p*.png`) and tells you, rather than returning silent zeros.
* If you still hit a wall on a residential connection, run **`--headful`** (solve
  the check once) or point **`--proxy`** at a residential proxy.
* **Do not** wire it into the app's Cloudflare Workers — those datacenter IPs are
  exactly what DataDome blocks, and it would breach Indeed's terms. It's kept
  deliberately standalone.

The scraper is polite by default (realistic UA + locale/timezone, a stealth init
script, ~1.5 s between pages). Keep it that way.

## Store & dedupe into D1 — scheduled from your own PC

Because Indeed only serves a residential IP, the "archive to D1" step runs from
**your machine on a schedule** (not CI/Workers, which SEEK uses). The orchestrator
[`scripts/indeed-to-d1.py`](../../scripts/indeed-to-d1.py) drives this scraper
across your company roster in one warmed browser and upserts the results into the
same D1 archive as every other source (`source = "indeed"`).

**What it does per run:** scrape each company's board (all locations) → map skills
for parity via the worker's taxonomy (`scripts/map-skills.ts`) → **drop any role
already archived for that company by another source** (cross-checked by
normalised title, so a job also on Adzuna/SEEK is counted once) → upsert with the
same `source|title|company|location` key + first/last-seen bump as every other
feed. Re-runs refresh `last_seen` instead of duplicating.

### One-time setup

```bash
pip install playwright && playwright install chromium
# Keep your D1 token out of the crontab — put it in repo/.env.indeed (gitignored):
echo 'CLOUDFLARE_API_TOKEN=<a token with D1 edit>' > .env.indeed
```

### Run it

```bash
# Scope to the companies you care about (browser scraping is slow — don't do all
# 205 nightly), across every location they're hiring in:
python scripts/indeed-to-d1.py --only bhp,fmg,wes,woodside

# Whole AU roster (long; more likely to trip DataDome — run less often):
python scripts/indeed-to-d1.py

# If a wall appears, run visible once to clear it, or use a residential proxy:
python scripts/indeed-to-d1.py --only bhp --headful
python scripts/indeed-to-d1.py --only bhp --proxy http://user:pass@residential:port
```

It stops itself after 3 consecutive DataDome blocks (the IP is being throttled)
and exits non-zero if >50% of companies were blocked, so a scheduled run fails
loudly rather than silently archiving nothing.

### Schedule it

Use the wrapper [`scripts/indeed-to-d1.sh`](../../scripts/indeed-to-d1.sh) (sets
the working dir, loads `.env.indeed`, logs to `~/indeed-archive.log`).

**macOS / Linux — cron** (`crontab -e`):
```cron
# 6am daily, your key companies
0 6 * * * /path/to/repo/scripts/indeed-to-d1.sh --only bhp,fmg,wes,woodside
```

**macOS — launchd** (survives sleep better than cron on a laptop): create
`~/Library/LaunchAgents/com.employsi.indeed.plist` with `ProgramArguments`
pointing at `scripts/indeed-to-d1.sh` and a `StartCalendarInterval` of `Hour 6`,
then `launchctl load` it.

**Windows — Task Scheduler**: create a daily task whose action runs
`wsl /path/to/repo/scripts/indeed-to-d1.sh --only …` (via WSL), or `python.exe
scripts\indeed-to-d1.py --only …` with `CLOUDFLARE_API_TOKEN` set in the task's
environment.

Inspect what landed:
```bash
wrangler d1 execute employsi-jobs-archive --remote \
  --command "SELECT source, COUNT(*) FROM jobs GROUP BY source"
```

## Relation to the SEEK feed

This mirrors [`tools/seek-company-scraper`](../seek-company-scraper) +
[`scripts/seek-to-d1.py`](../../scripts/seek-to-d1.py). The one difference is
**where the archive step runs**: SEEK's API answers Python/curl from any host, so
it archives from a GitHub Action; Indeed's DataDome blocks non-residential IPs, so
its archive step (`scripts/indeed-to-d1.py`) runs from your own machine on a
schedule instead. The D1 table, dedupe key and skill mapping are identical.

## Requirements

Python ≥ 3.10, `playwright`, and a Chromium (via `playwright install chromium`,
or a pre-provisioned one found automatically at `/opt/pw-browsers` /
`$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).
