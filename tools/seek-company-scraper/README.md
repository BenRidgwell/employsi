# seek-company-scraper

Every open **SEEK** listing for a **single company**, across all supported
regions — mining roles, HR, finance, trades, apprenticeships, the lot.

Repurposed from **[qinscode/SeekSpider](https://github.com/qinscode/SeekSpider)**,
which crawls seek.com.au for **IT** jobs by iterating the *Information &
Communication Technology* classification and its sub-classifications. This tool
keeps that project's core discovery — SEEK's undocumented but public search API
at `/api/jobsearch/v5/search` — but repurposes it in two ways:

| | Original SeekSpider | This tool |
| --- | --- | --- |
| **Filter** | `classification=6281` (IT) + subclasses | `advertiserid=<company>` — one employer |
| **Job types** | IT only | **all** classifications |
| **Scope** | Australian cities | every SEEK site (AU + NZ), all regions |
| **Stack** | Scrapy + Plombery + PostgreSQL/Supabase + AI post-processing | one stdlib + `requests` script, CSV/JSON out |

## How it works

SEEK filters jobs by `advertiserid` — a per-employer id — with **no**
classification filter, so a single query returns a company's *entire* live
board. Advertiser ids aren't published, so the tool first **resolves** a company
name to its id on each site (a keyword search, then a match on the advertiser's
own name), then pages through every listing under that id. `where="All
<Country>"` sweeps every region in one pass, and each job carries its own
location, so you get a per-region breakdown for free.

```bash
pip install -r requirements.txt

# All of Fortescue's AU listings, every job type, every region -> CSV + JSON
python seek_company_scraper.py "Fortescue" --json

# A different SEEK site
python seek_company_scraper.py "Fonterra" --site nz

# Both sites at once
python seek_company_scraper.py "Fortescue" --all-sites

# Scope to one city
python seek_company_scraper.py "BHP" --region Perth

# You already know the advertiser id — skip resolution
python seek_company_scraper.py "" --advertiser-id 61981911

# Just resolve the company -> advertiser id(s), don't scrape
python seek_company_scraper.py "Woodside" --list-advertisers
```

Run `python seek_company_scraper.py --help` for every flag.

## Output

One row per listing, written to `seek_<company>.csv` (override with `--out`; add
`--json` for a matching `.json`):

| Field | Notes |
| --- | --- |
| `job_id`, `url` | SEEK listing id and its page link |
| `title` | |
| `company`, `advertiser_id` | the resolved employer |
| `classification`, `subclassification` | full SEEK taxonomy — **not** just IT |
| `work_type` | e.g. Full time / Contract |
| `salary` | when the listing states one |
| `location`, `region` | city label + broader region from the location hierarchy |
| `site` | `au` / `nz` |
| `posted_date` | ISO listing date |

The run also prints a breakdown by classification and by region to stderr.

## Regions

Named regions live in `regions.py`, repurposed 1:1 from the original
SeekSpider's `AUSTRALIAN_REGIONS` (Perth, Sydney, Melbourne, Brisbane, Gold
Coast, Adelaide, Canberra, Hobart, Darwin) plus a whole-of-country default and
the NZ equivalents (Auckland, Wellington, Christchurch). Each SEEK country site
is one entry in `SITES` — add more of SEEK's network there and they become
available to `--site` / `--all-sites`.

## Where to run it — important

SEEK's terms prohibit automated access, and it fronts the site with Cloudflare
that blocks many datacenter/CI IP ranges. The search API often answers, but
sustained traffic and detail pages get challenged. So, like
[`tools/google-jobs-scraper`](../google-jobs-scraper):

* Run it **manually, from a residential IP**, for your own analysis.
* **Do not** wire it into the app's Cloudflare Workers cron — those run from
  datacenter IPs SEEK blocks, and it would breach SEEK's terms. It's kept
  deliberately standalone and un-wired.

The script is polite by default (realistic browser User-Agent, ~1.2s between
requests, exponential backoff on 403/429/503). Keep it that way.

## Wiring it into Employsi (if you ever do)

The app's live-vacancy pipeline (Adzuna + The Muse, in
`src/employsi/lib/openRolesFn.ts` and `workers/jobs-cron/`) keys everything on
company. This tool's CSV is already company-keyed, so a company's SEEK board
could enrich its card's open-roles / salary / skills — but only via an
intermediary you run yourself off the Workers' datacenter IPs (same constraint
as the Google Jobs and Jooble feeds). Left un-wired until that path exists.
