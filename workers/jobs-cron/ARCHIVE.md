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

# JobStreet feeds — Malaysia and the Philippines (`scripts/jobstreet-to-d1.py`)

JobStreet is the dominant board in both markets, and it is what gives **Kuala
Lumpur** and **Manila** any vacancy coverage at all: the career-portal feeds
only see an employer's own site, and most of the roster's presence in those
countries is a shared-services or BPO entity that advertises on JobStreet
instead of running a local careers site.

**Why not in the Worker.** JobStreet is SEEK-owned and sits behind SEEK's front,
which 403-challenges requests originating from Cloudflare Workers — the same
block documented for the SEEK feed above. The JSON API is served normally to an
ordinary client, so both feeds run from GitHub Actions
([`jobstreet-archive.yml`](../../.github/workflows/jobstreet-archive.yml),
[`jobstreet-ph-archive.yml`](../../.github/workflows/jobstreet-ph-archive.yml))
and write through the D1 HTTP API.

**One script, two countries.** Both sites are the same codebase behind different
hostnames, so only the host, site key, locale, source name and hub map differ —
all of it in `SITES`, selected with `--country my|ph`. Everything downstream is
shared, so a Manila role is deduped and skill-mapped exactly as a KL one is.

Two things are load-bearing and easy to get wrong:

- **Separate sources per country** (`jobstreet` / `jobstreet-ph`). The dedup key
  leads with the source, so sharing one would let a Manila role and a KL role
  with the same title and employer collapse into a single row and lose a market.
- **No `where` parameter.** Passing SEEK's `All Australia` returns
  `totalCount 0` rather than an error, so a wrong value looks exactly like an
  employer with no local vacancies. Both workflows therefore **fail loudly** when
  not one company on the roster returns a vacancy — silence here means the API
  shape moved, not that the country stopped hiring.

**The advertiser filter is the honesty gate.** Keyword search returns anything
mentioning the name, so an ad is kept only when its advertiser really is the
company. The rule compares whole tokens and allows extra words only from a
corporate-qualifier list, which is what keeps `BHP Group` and `ANZ Global
Services and Operations` while rejecting `IGO Techonologies` — an unrelated
Philippine firm that a plain prefix test archived as IGO Ltd, the Western
Australian lithium miner, for 31 roles. A local subsidiary can legitimately
trade under a name the rule rejects (`Austal Ships`), so rejections that lead
with a roster name are **reported at the end of every run**; confirm one against
the employer, then add it to `ADVERTISER_ALIAS`.

---

# Wayback recovery of dead career sites (`scripts/wayback-to-d1.py`)

A **one-off backfill, not a feed.** It reads the Internet Archive's captures of
career sites that no longer exist and archives the advertisements that ran on
them. Nothing schedules it and nothing should: the corpus is closed.

First run recovered BHP's three retired hostnames:

| host | captures indexed | listing captures | era |
|---|---|---|---|
| `jobs.bhpbilliton.com` | 89,110 | 23,001 | 2002–2018 |
| `jobs.bhpbilliton.net` | 120 | 2 | 2004–2022 |
| `careers.bmacoal.com` | 28,877 | 13,586 | 2003–2008 |

**Why it reads listing pages and not job pages.** A `jobdetails.asp` capture
costs one fetch and yields one advertisement; a `searchresults.asp` capture
costs one fetch and yields twenty, with title, requisition reference, location
and closing date already in a table. There are ~36,000 listing captures against
~21,000 detail captures, so listings are both cheaper and richer. Detail pages
carry two extra fields — the CSG (business unit) and, on the later platform, an
explicit `Advertised:` date — which is the obvious next increment.

**Three layouts, because the hosts changed platform twice.** Each parser names
the capture it was verified against, in the script. The column order is *not*
the same on both hosts — bhpbilliton.com publishes `[Position, Location,
Applications Close]` and bmacoal publishes `[Position, Advertised, Applications
close]` — so the header row is read and the labels decide. A positional parser
files fourteen BMA ads at a place called "10 January 2006" and never errors.

**`jobSearch.asp` is the search form, not results.** It returns zero rows every
time on the `.com` host. Captures are ranked so the shapes that carry a results
table are fetched first; the form is a last resort because on bmacoal the same
filename *does* return results.

**Dates.** `first_seen`/`last_seen` are the first and last capture the ad was
seen in, so `days_advertised` measures how long it was actually up. `posted` is
only ever the site's own opening date — bmacoal's "Advertised" column and the
2015+ platform's `<time datetime>`. The legacy `.com` layout publishes a
**closing** date and nothing else, and a closing date is not a posting date, so
those rows keep `posted` empty rather than carrying a plausible wrong one.

The upsert takes `MIN(first_seen)`/`MAX(last_seen)` rather than assigning, because
captures are read in sampled order and a later run can discover an *earlier*
sighting of the same ad. Every other source here walks forward in time and can
simply assign `last_seen`; this one cannot.

**Two things it cannot do.**
1. Wayback cannot replay the POST that turns the page, so a capture normally
   shows only the first 20 of a longer board. The pages state their own total
   ("Displaying 1 to 20 of 63 jobs") and the run reports shown-vs-advertised
   from it, so the sample never reads as the whole.
2. `careers.bmacoal.com` has **no location column at all** — it advertises a
   date where the other host advertises a place. Those rows are archived
   unplaced rather than being assigned a location from the employer, so BMA
   history does not appear on the map.

**It is a closed corpus, so it is exempt from the freshness check.** `wayback`
is listed in `HISTORICAL_SOURCES` (`src/employsi/lib/dataQualityFn.ts`) and the
admin console tags it `historical 2002–2018` instead of flagging it red. Its
newest row is from 2018 because the hostnames died in 2018; left in the check it
would sit permanently silent and train the reader to ignore the panel.

**web.archive.org is blocked by this sandbox's egress policy** (archive.org
itself is not), so the fetches go through Oxylabs with `--via-oxylabs`. Nothing
about the data needs a residential IP. From a GitHub Action, drop the flag.

```bash
OXYLABS_USERNAME=… OXYLABS_PASSWORD=… CLOUDFLARE_API_TOKEN=… \
python3 scripts/wayback-to-d1.py --app-id bhp --max-fetches 600 --via-oxylabs \
  --cache /tmp/wbcache        # cache makes a re-run free
```

---

# Six career boards added 2026-08-03 (Qube, Mirvac, Mercury NZ, BGC, Bendigo, Sandfire)

Six employer boards were wired up in one batch. They split two ways, and **the
split is the interesting part**: five turned out to be readable without a
browser and belong in the Worker, and only one genuinely needs Oxylabs. The rule
that decided each one was: *fetch it unrendered first, read the site's own
bundle for the API it calls, and only reach for a browser when neither works.*

## In the Worker (`careerSites.ts`, PORTAL_GROUPS group 27, tick `5 9 * * *`)

| Company | Platform | Measured 2026-08-03 |
|---|---|---|
| Qube Holdings | PageUp Sites | 106 of 106 advertised, 4 pages |
| Bendigo & Adelaide Bank | SuccessFactors RMK search service | 81 of 81 (80 rows — see below) |
| Mirvac | Cornerstone OnDemand | 33 of 33 |
| Mercury NZ | SnapHire | 9, single page |
| BGC | JobAdder widget | 6, confirmed by the widget's own pager |

Three were only reachable after finding the right entry point, and each looked
like an empty board until then:

- **Qube.** The *rendered* page shows 30 jobs and the *unrendered* one shows all
  106 — rendering was actively worse, because the client-side script trims the
  list. The footer prints "Displaying 1 - 30 of **106** in total", so the walk is
  bounded by the board's own count rather than by a short page.
- **Mirvac.** `careers.mirvac.com` redirects to the residential sales site; the
  board is a Cornerstone tenant. Its 5 KB shell carries an anonymous bearer in
  `csod.context.token`, and with `Authorization: Bearer …` (the bare token and
  `csod-accessToken` both 401) `us.api.csod.com/rec-job-search/external/jobs`
  returns every role with structured city/state/country.
- **BGC.** The page embeds a JobAdder widget; the key is only in
  `_jaJobsSettings`, and the endpoint is JSONP. `pageNumber` is the paging
  parameter — `page` and `pageIndex` are accepted and silently ignored, which is
  the kind of knob that looks like it works because page 1 is a valid answer.

### Bendigo very nearly became a browser job, and shouldn't have

It is SuccessFactors on the UI5/React "NES" theme, which server-renders nothing
— 138 KB of chrome and zero `/job/` links against 81 advertised — and `startrow`
is accepted and ignored, so its paginator is click-only. A rendered
click-through was written, and it worked, at nine browser renders and 36 clicks
a run. Then reading `j2w.searchManager.min.js` showed the page's own code
posting to `/services/recruiting/v1/jobs` with
`{keywords, locale, location, pageNumber, sortBy}` and getting structured JSON
back. **Read the bundle before you reach for a browser.**

**Its pager overlaps, and that is not a rendering artefact.** The service
honours neither `sortBy: "recent"` nor any page-size parameter (eight spellings
tried, all returned 10), so with an empty query every row ties on relevance and
the tie-break differs per query execution: two identical requests seconds apart
shared only 5 of 10 ids on page 1. A single nine-page walk therefore collects a
*sample* — measured 66 of 81 through the browser and 72 of 81 through the API.
The fetcher repeats the walk until the count reaches the board's own
`totalJobs` or a pass adds nothing; measured, pass 1 collected 61 and pass 2
completed it. This is affordable only because it is JSON — the same fix through
a browser would have been 20 renders.

**81 fetched lands as 80 archived rows, and that is correct.** Requisitions 1680
and 1682 are both "Engineering Manager" in the same two locations, so they share
a `job_key` and collapse — the archive keys on
`source|title|company|location` by design, and two openings for the same role in
the same place are indistinguishable under it. Recorded here so a future reader
counting 80 against the board's 81 does not go looking for a dropped row.

## Off-Worker, rendered (`.github/workflows/sandfire-portal.yml`)

- **Sandfire Resources** — the OLD SuccessFactors RCM portal on the EU
  datacentre, tenant `minasdeagu` (MATSA). The URL sandfire.com.au links to
  renders a permanent "Loading…"; the list lives at
  `career_ns=job_listing_summary`, and `rcm_site_locale=en_GB` has to be pinned
  or the tenant answers in Spanish. 5 of 5 advertised. Same platform as
  Stockland, and the same reason it cannot run in a Worker.

**Sandfire publishes no location, and nothing is invented to fill the gap.**
Every row's note line ends in an empty span and the detail page has no location
field either — "Perth" appears there only inside the company blurb. So
`location` is written empty, the hub falls back to the company's own city, and
the only rows that get a real location are the ones whose *title* names a
Sandfire project site ("… - Kalkaroo" → Kalkaroo, South Australia → Adelaide).

**Sandfire's Spanish board does not exist**, which was checked rather than
assumed. `empleo.sandfirematsa.es` is an Instapage landing page carrying two
TalentClue links, neither of which is a vacancy — one is a "Conoce nuestras
ofertas" button and the other an internships procedure — and the TalentClue
tenant behind them 404s every list path. Nothing is written for Spain.

## The hub-matching fix these boards forced

Qube advertises in Broome, Albany, Rockingham and North Fremantle, all written
`"<town>, WA"` with nothing after the state. `HUB_MATCH` deliberately spells the
Australian state codes with a trailing comma (`" wa,"`, `" nt,"`, `" vic,"`)
because the bare forms are substrings of ordinary words — `" wa"` is inside
`" waikato"` and `" warsaw"` — so a state that merely came *last* never matched
and the role went unplaced. `hubFor` now appends a comma before testing, which
can only ever add matches.

Diffed against the 10,354 distinct locations already in the archive: **414
changed, all of them fixes** — 226 Victorian, 162 Western Australian and 10
Northern Territory locations that had no hub now have one, plus "Portland VIC"
which had been resolving to Portland, Oregon. The one regression this exposed,
`"Seattle, WA"` landing on Perth, is why `["seattle", "seattle"]` is now tested
ahead of the WA block.

Bendigo's branch network then found the rest of the hole: **South Australia, the
ACT and Tasmania had no abbreviation needles at all**, and Tasmania had no
needles of any kind — Hobart is a tracked hub with its own tas-gov feed, but
tas-gov sets the hub itself and never consults this table, so the gap was
invisible exactly as Darwin's was. Adding them changed a further **317
locations, again all fixes**: 208 South Australian, 75 Tasmanian and 32 ACT
locations that had no hub now have one, and "TAS - South Launceston - 299-301
Wellington Street" stopped resolving to Wellington, New Zealand.

New Zealand needed the same treatment: Mercury's nine roles are all in the
central North Island, so `waikato`, `rotorua`, `taupō`, `tauranga` and
`new plymouth` map to Auckland as the nearest plotted hub. A bare `hamilton`
deliberately does **not** — of the 25 archived locations containing it, only
four are the New Zealand city and the rest are Hamilton in NSW, QLD, VIC, Ohio,
New Jersey, Manhattan and Hamilton Hill in Perth.

---

# Re-mapping the archive onto the current taxonomy (2026-08-03)

Every row's `skills` column is frozen as JSON at the moment it is written, and
the upsert does `skills = COALESCE(jobs.skills, excluded.skills)` — it never
overwrites. So a taxonomy fix reaches new rows only, and the archive slowly
fills with the verdicts of older, cruder matchers. Re-mapping is how that is
paid off, and it is worth writing down how to do it without making things worse.

## Reproduce each source's INPUT, not just its title

The single thing that makes this dangerous is that **sources do not all map on
the title alone**:

| Source | Mapped on | Reproducible from the archive? |
|---|---|---|
| career portals | title + employer sector | yes — `company_id` → sector |
| SEEK, Adzuna, Jora, Indeed, qld-gov … | title | yes |
| wa-gov, vic-gov, tas-gov | title + occupation | yes — occupation IS the `category` column |
| **nt-gov** | title + agency section | **no** — section is not stored |
| **mycareersfuture** | title + the board's own skill tags | **no** — tags are not stored |

Re-mapping the last two on the title alone reads as a catastrophe and isn't one:
it would have stripped skills from **7,134 of 9,578** mycareersfuture rows and 80
of 368 nt-gov rows. That is the method losing the input, not the taxonomy
changing its mind, so **both sources are excluded** from the re-map. If they ever
need re-mapping, store the extra field first.

**An excluded source still needs targeted fixes.** Excluding them from the
wholesale re-map is not the same as leaving them wrong: the AWS wage-supplement
false positive is concentrated in Singapore titles, which is exactly
mycareersfuture, so 45 of its rows still read "Cloud & DevOps" on a kitchen
crew. Those were corrected surgically — remove the one skill the fix is about,
where the title carries the benefits-list shape and no other cloud evidence,
and leave every other skill alone. A removal you can name is safe on a source
whose input you cannot reproduce; a recompute is not.

## What the re-map actually changed

74,165 rows considered, **6,573 updated**: 4,427 rewritten, 2,016 that had no
skills and now have some, and 130 cleared. The clears and losses are dominated by
a single family of old bugs — terms matching in the MIDDLE of a word, which the
`termMatches` word-boundary fix later stopped:

- `Contractor` → *actor* → Creative & Performing Arts
- `Authority`, `Authorization` → *author* → Journalism & Media
- `Unaccredited`, `Accreditation` → *credit* → Banking & Lending
- `District Manager` → *ict manager* → IT & Systems
- `Enterprise`, `Perpetual` → *erp* → IT & Systems
- `Hyundai` → *ai* → Data Science & Machine Learning
- `Wesfarmers` → *farm* → Agriculture & Farming
- `Telecommunications` → *comms* → Marketing & Comms

## The re-map is also how you find gaps

Word-boundary matching has a documented cost: a stem buried inside a compound no
longer matches. Re-mapping surfaces those as rows that lose a correct skill and
gain nothing, which is a much better detector than reading the term list. Four
were found and fixed this way — `paralegal`, `neuropsycholog`, the singular
`system administrator` (plus database and network), and
`geoscientist`/`hydrochemist`/`microbiolog`.

**Fix the gaps before writing, not after.** Run the re-map, list what each source
would lose, and only stamp it across the archive once every remaining loss is a
correction you can name.

One gap is recorded and NOT fixed: the Chinese term list covers 生产/物流/司机 and
their neighbours but not 骑手 (delivery rider), 保洁/家政 (cleaning) or 质检/品控
(quality control), so 29 Zhaopin rows re-map to no skill. Their previous values
were not better — a Meituan rider was filed under Manufacturing & Production and
a cleaner under Human Resources — so an empty list is the honest reading until
the terms are added.

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
