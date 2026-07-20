# google-jobs-scraper

Extracts live listings from **Google Jobs** — the aggregator Google builds from
LinkedIn, Indeed, SEEK, company career pages and more — capturing the fields the
Adzuna / The Muse feeds don't expose, notably **salary** and **posted via
[platform]**.

Based on Oxylabs' guide: <https://github.com/oxylabs/how-to-scrape-google-jobs>.

Per listing it pulls:

| Field | Notes |
| --- | --- |
| Job title | |
| Company name | |
| Job location | |
| Job posted via [platform] | e.g. "via LinkedIn", "via SEEK" |
| Job listing date | e.g. "3 days ago" |
| Salary | when the listing states one |
| (URL) | the listing's share link — handy for de-duping / linking |

## Why two methods

Google renders the jobs widget with JavaScript and blocks datacenter/CI IPs, so
it can't be fetched with a plain HTTP request. Two ways around that:

### 1. Oxylabs Web Scraper API — `oxylabs_google_jobs.py` (recommended)

Renders and parses the page server-side, returning all seven fields reliably
from any host. Needs a (free-trial) Oxylabs Web Scraper API account.

```bash
pip install -r requirements.txt
export OXYLABS_USERNAME=... OXYLABS_PASSWORD=...
python oxylabs_google_jobs.py "data engineer" \
    --country au \
    --geo "Perth,Western Australia,Australia" \
    --out jobs.csv
```

The XPath field selectors live in `PARSING_INSTRUCTIONS` — the one place to
update if Google reshuffles its markup.

### 2. Free Playwright method — `free_google_jobs.py` (no credentials)

Drives a real Chromium to the widget and reads the cards directly. No API cost,
but it must run from a residential IP Google will serve — from a datacenter/CI
IP (including this app's Cloudflare Workers) Google shows a consent/CAPTCHA wall
and returns nothing. `salary`/`date` can be sparser since some fields only
appear after a listing is opened.

```bash
pip install -r requirements.txt
playwright install chromium
python free_google_jobs.py "data engineer" --country au --out jobs.csv
# add --headful to clear a consent wall by hand the first time
```

Or via the Makefile: `make install`, then `make scrape QUERY="data engineer"`.

## Wiring it into Employsi

The app's live vacancy pipeline (Adzuna + The Muse, in `src/employsi/lib/
openRolesFn.ts` and `workers/jobs-cron/`) can take Google Jobs as an additional
source. Because Google blocks the Workers' datacenter IPs, that path must use
the **Oxylabs API** (an ordinary HTTPS call a Worker can make). Add
`OXYLABS_USERNAME` / `OXYLABS_PASSWORD` as Worker secrets and the same
`PARSING_INSTRUCTIONS` payload used here can run from the cron worker to enrich
each company's roles with salary + source-platform. Left un-wired until
credentials are provided, exactly like the Jooble hub feed.

## Requirements

Python ≥ 3.9. `requests` for the API method; `playwright` for the free method.
