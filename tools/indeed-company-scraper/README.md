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

### Avoiding throttling (DataDome)

Indeed blocks on IP reputation + fingerprint. Four levers, most effective first:

1. **Residential / rotating proxy** — the biggest lever. `--proxy
   http://user:pass@host:port` routes through a trusted home IP (rotating
   providers give a fresh one per session). This is what keeps you unblocked at
   real volume.
2. **Persistent profile** — `--profile <dir>` stores cookies between runs, so a
   DataDome challenge you clear **once** stays trusted on later scheduled runs.
   Use `--solve` to clear/verify the wall **without a Cloudflare token** (it skips
   the D1 write):
   ```bash
   # 1) solve the human check by hand, once, into a profile (visible browser, no token):
   python scripts/indeed-to-d1.py --only bhp --solve --headful --profile ~/.indeed-profile
   # 2) confirm the cached profile now gets through headless (still no token):
   python scripts/indeed-to-d1.py --only bhp --solve --profile ~/.indeed-profile
   # 3) real archive runs reuse that profile (these DO need the D1 token):
   python scripts/indeed-to-d1.py --profile ~/.indeed-profile --only …
   ```
3. **Jittered pacing** (on by default) — randomised gaps: `--min-delay/--max-delay`
   seconds between companies (default 8–25) and `--page-min/--page-max` between
   result pages (default 2–6). Widen them to look more human:
   `--min-delay 20 --max-delay 60`.
4. **Batch across days** — spread the 205 so each night is light (see the crontab
   set below).

### Schedule it

Use the wrapper [`scripts/indeed-to-d1.sh`](../../scripts/indeed-to-d1.sh) (sets
the working dir, loads `.env.indeed`, logs to `~/indeed-archive.log`). All flags
pass straight through.

**macOS / Linux — cron** (`crontab -e`), a **day-split** set so each 6am run is
~30–70 companies through a warmed persistent profile (swap `$HOME/globe-gazer-hr`
for your clone path):
```cron
# Resources (50) — Mon
0 6 * * 1 $HOME/globe-gazer-hr/scripts/indeed-to-d1.sh --profile $HOME/.indeed-profile --only alk,aow,asb,beach,bhp,bmn,boe,ccv,chevron,cmm,cvn,cxo,deg,del,dyl,fmg,gmd,gor,hgo,igo,ilu,jellinbah,jms,ltr,mah,mgt,min,mmi,mnd,nhc,nst,nwh,pdn,pls,pru,rio,rms,rrl,s32,sfr,sgq,shell,smr,sto,stx,sw1,swm,wds,wes,wgx
# Sydney (69) — Tue
0 6 * * 2 $HOME/globe-gazer-hr/scripts/indeed-to-d1.sh --profile $HOME/.indeed-profile --only sydney-cba,sydney-mqg,sydney-wbc,sydney-gmg,sydney-wow,sydney-scg,sydney-qan,sydney-bxb,sydney-shl,sydney-coh,sydney-asx,sydney-wtc,sydney-sgp,sydney-dxs,sydney-ald,sydney-agl,sydney-all,sydney-amp,sydney-apa,sydney-ask,sydney-aub,sydney-bga,sydney-brg,sydney-bsl,sydney-cgf,sydney-chc,sydney-cip,sydney-clw,sydney-cqr,sydney-dow,sydney-dro,sydney-edv,sydney-eos,sydney-evn,sydney-evt,sydney-gpt,sydney-hdn,sydney-hub,sydney-hvn,sydney-iag,sydney-llc,sydney-mff,sydney-mfg,sydney-mgr,sydney-mts,sydney-mxt,sydney-nhf,sydney-nic,sydney-org,sydney-pni,sydney-ppt,sydney-qbe,sydney-qub,sydney-rdx,sydney-rgn,sydney-rhc,sydney-rwc,sydney-sdf,sydney-sgh,sydney-sgm,sydney-sol,sydney-tpg,sydney-vnt,sydney-wam,sydney-whc,sydney-wle,sydney-wor,sydney-yal,sydney-zip
# Melbourne (42) — Wed
0 6 * * 3 $HOME/globe-gazer-hr/scripts/indeed-to-d1.sh --profile $HOME/.indeed-profile --only melbourne-csl,melbourne-nab,melbourne-anz,melbourne-tls,melbourne-col,melbourne-tcl,melbourne-rea,melbourne-cpu,melbourne-vcx,melbourne-sek,melbourne-car,melbourne-ori,melbourne-hsn,melbourne-4dx,melbourne-afi,melbourne-alx,melbourne-amc,melbourne-ann,melbourne-arb,melbourne-ben,melbourne-cwy,melbourne-dnl,melbourne-gdg,melbourne-ifl,melbourne-jbh,melbourne-l1g,melbourne-lov,melbourne-lsf,melbourne-mpl,melbourne-msb,melbourne-ora,melbourne-pme,melbourne-pmv,melbourne-pxa,melbourne-reg,melbourne-reh,melbourne-sig,melbourne-tah,melbourne-tlc,melbourne-tlx,melbourne-twe,melbourne-vea
# Perth (14) + Brisbane (18) — Thu
0 6 * * 4 $HOME/globe-gazer-hr/scripts/indeed-to-d1.sh --profile $HOME/.indeed-profile --only perth-bgl,perth-bwp,perth-cyl,perth-drr,perth-emr,perth-ggp,perth-imd,perth-lyc,perth-obm,perth-pdi,perth-prn,perth-rsg,perth-vau,perth-waf,brisbane-sun,brisbane-nsr,brisbane-boq,brisbane-ctd,brisbane-flt,brisbane-sul,brisbane-alq,brisbane-smr,brisbane-crn,brisbane-sya,brisbane-dtl,brisbane-aqz,brisbane-ape,brisbane-azj,brisbane-dbi,brisbane-nxt,brisbane-tne,brisbane-vgn
# Adelaide (12) — Fri
0 6 * * 5 $HOME/globe-gazer-hr/scripts/indeed-to-d1.sh --profile $HOME/.indeed-profile --only adelaide-eld,adelaide-arg,adelaide-abc,adelaide-coe,adelaide-c79,adelaide-tea,adelaide-pro,adelaide-axe,adelaide-ar3,adelaide-age,adelaide-bgd,adelaide-cda
```
(Solve the wall once first: `python scripts/indeed-to-d1.py --only bhp --headful
--profile $HOME/.indeed-profile`.)

**macOS — launchd** (survives sleep better than cron on a laptop): create
`~/Library/LaunchAgents/com.employsi.indeed.plist` with `ProgramArguments`
pointing at `scripts/indeed-to-d1.sh` (+ its flags) and a `StartCalendarInterval`,
then `launchctl load` it.

**Windows — Task Scheduler**: create a task whose action runs
`wsl /path/to/repo/scripts/indeed-to-d1.sh --profile … --only …` (via WSL), or
`python.exe scripts\indeed-to-d1.py --only …` with `CLOUDFLARE_API_TOKEN` set in
the task's environment.

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
