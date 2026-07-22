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

## Relation to the SEEK feed

This mirrors [`tools/seek-company-scraper`](../seek-company-scraper) — a
standalone, company-level board scraper. Unlike SEEK (whose search API answers
Python/curl from ordinary hosts, so it also has a D1 archive pipeline in
`scripts/seek-to-d1.py`), Indeed's DataDome blocks non-residential IPs outright,
so a scheduled CI/Workers archive path is not reliable. If you want Indeed in the
D1 archive, run this tool on a residential host and push its CSV up the same way
`scripts/seek-to-d1.py` writes SEEK rows.

## Requirements

Python ≥ 3.10, `playwright`, and a Chromium (via `playwright install chromium`,
or a pre-provisioned one found automatically at `/opt/pw-browsers` /
`$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).
