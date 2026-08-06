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

Indeed 403-blocks datacenter/CI/Workers IPs, so it can't run from the cron
worker *or* a GitHub Action. Measured 2026-08-06 from a GitHub runner
(`probe-headless-ci`), with a real headless Chromium and the scraper's own
parser: **HTTP 403, 38 KB, zero rows, a Cloudflare interstitial**. Note the
mechanism — this file and the script both used to say DataDome, which is what
the block was in an earlier era; the wall is Cloudflare now. The conclusion is
unchanged and is now measured rather than remembered: a browser does not get in
from a datacentre address, because the address is what is being refused. Instead the Indeed feed
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

# Thirteen employer boards + SimplyHired, added 2026-08-03

## In the Worker (`careerSites.ts`, PORTAL_GROUPS groups 28-29)

Eleven feeds, 864 roles when probed. Five ran on platforms this file already
read; six needed a new one.

| Employer | Platform | Roles | Note |
|---|---|---|---|
| Endeavour Group | **attrax** (new) | 561 | Dan Murphy's / BWS store roles nationwide |
| Harvey Norman | **pageupclassic** (new) | 191 | 84% placed on a hub — see below |
| Ramelius Resources | jobadder | 24 | widget key `AU5_uf7oi7f5zhkevkmrualspwsjru` |
| Netwealth Group | **ashby** (new) | 23 | new roster company, `melbourne-nwl` |
| AGL Energy | workday | 19 | |
| Meridian Energy | smartrecruiters | 10 | company code `MeridianEnergy1` |
| Dexus | workday | 9 | |
| Whitehaven Coal | successfactors | 9 | its Queensland board; NSW is on Dayforce |
| Steadfast Group | **elmo** (new) | 8 | first ELMO Talent tenant |
| Capricorn Metals | **wprest** (new) | 6 | WordPress `job` post type |
| Perseus Mining | **wploop** (new) | 4 | Elementor loop, NOT the REST API |

Two of the new readers exist because the employer runs no ATS at all:

- **`wprest`** reads a WordPress custom post type through wp-json. Clean, and
  there is nothing else to read.
- **`wploop`** parses an Elementor loop off the page, and the distinction from
  `wprest` is the point. Perseus's `careers` category holds 8 posts, all
  `publish`, with identical meta — **the REST API cannot tell a live ad from a
  closed one**. The page renders 4, and those 4 are also the only ones carrying
  a Location. Reading the API would have over-reported by half.

**Harvey Norman's location problem, and how far it could honestly be solved.**
The listing's location cell is the STORE — "Osborne Park Complex", "Bondi
Junction Complex" — which no hub table can place, and suburb names cannot be
guessed at either (Springwood is in both Queensland and New South Wales). The
plain walk placed 20 of 191 roles, 10%.

The board's sidebar carries a Locations facet whose values ARE states, and
`/en/search/?location=<value>` honours it exactly — the "NSW – Sydney Metro
Area" facet says 29 and returns 29. But **the board rations faceted searches
and signals it with an empty result set rather than a 429**: measured three
times, the first six or seven facets returned their counts and every one after
returned zero. It is a quota, not a rate — 1s and 2.5s delays changed nothing,
and only a ~20s pause restored capacity — so retrying inside the walk does not
help. The fetcher therefore spends its allowance on the largest facets and then
reads the plain listing for the rest: every role is collected either way, and
84% end up with a mappable location instead of 10%.

## Off-Worker (GitHub Actions, via Oxylabs)

- **`scripts/dyno-to-d1.py`** — Dyno Nobel, 33 roles. The old SuccessFactors RCM
  portal (`career?company=IncitecPivot`), which server-renders no rows and pages
  by `juic.fire(…,"_next")`, so the walk clicks through. Bounded by the board's
  own "33 Jobs matched your search". dynonobel.com.au names the split itself:
  this tenant is Australia and Indonesia, and North America is a separate Taleo
  instance that is not read.
- **`scripts/whitehaven-dayforce-to-d1.py`** — Whitehaven's NSW board, 36 roles.
  Its search API exists (`GET` returns 405, so the path is right) but every
  `POST` returns a bare 403 behind Cloudflare from a datacentre IP, with browser
  headers, Origin, Referer and the portal's own session cookies. A Worker would
  fare worse. Rendered through a residential IP instead.
- **`scripts/simplyhired-to-d1.py`** — an aggregator walked once per rostered
  employer, so it catches agency-posted ads an employer's own portal never
  shows. Filtered through `scripts/advertiser_match.py`, because keyword search
  returns anything that mentions the name. **The location filter is deliberately
  empty**: the obvious URL to copy is a city search, which would have archived
  only the Perth slice of every national employer.

  Its salary coverage is thin and was measured rather than assumed — 1 of 20
  BHP rows carried a `salaryInfo`. It is still salary the employer portals do
  not publish, so it is taken where it is offered.

## Dyno Nobel's second board, and startup.jobs (added later the same day)

**`scripts/dyno-to-d1.py` now reads two boards**, both attributed to
`melbourne-dnl` under their own platform tag. The Americas one took finding: the
URL the Australian careers page links to (`tbe.taleo.net/CH11/…&cws=4`) is dead,
and dead in a way worth recording — *every* path under that Taleo pod returns
"undergoing maintenance", including one with a deliberately invented org code, so
the pod is gone rather than the tenant. The live board is linked from the US site
on a different pod entirely: `phh.tbe.taleo.net/phh02/…&cws=43`.

It is also not "North America". Measured: 143 requisitions — US 96, Canada 39,
Brazil 4, Chile 3, Mexico 1 — so the code calls it the Americas.

**The session is what keeps it out of the Worker.** Results come from POSTing the
search form, and the "next page" link the board hands back carries only a row
offset, no query. Fetching that link cold, without the JSESSIONID from the
search, returns a 1-byte body — the search state lives in the session, and
`getText` in careerSites.ts is stateless by design. The walk ends when the board
stops emitting `a.jscroll-next`, which is its own statement that there is no more.

Only 5 of the 143 place on a hub, and that is correct rather than a gap: the
locations are "US - CA - Mojave", "Canada - NB - Fredericton" — real places that
are not tracked cities. Falling them back to Melbourne because the employer is
Australian would put a Mojave blasting job on the Melbourne pin.

**`scripts/startupjobs-to-d1.py`** walks startup.jobs once per rostered employer.
Three things about that board are load-bearing:

1. **Its company filter does not filter.** `?companies=Pinterest` returns 200 and
   a normal-looking page carrying jobs from nineteen different companies —
   `?companies=Canva` returns the identical rows. It is just the unfiltered feed.
   What filters is `/company/<slug>`.
2. **Slugs are not derivable** ("general-assembly", but also "renttherunway" and
   "bookingcom"), and probing candidates costs a fetch per guess across 999
   companies. The board's own sitemap lists all 42,885 company pages in one
   un-proxied CDN request, turning resolution into an offline set lookup. 56 of
   the roster's 999 have a page.
3. **A slug match is a lead, not an identification.** `/company/igo` is "iGo" of
   Pennsylvania; `/company/redox` is a US healthcare-interoperability firm;
   `/company/compass` is the US real-estate brokerage; `/company/multiply` does
   Atlanta mortgage origination. `advertiser_matches` passes all four, because
   lexically the names ARE the same, and the page carries no website, no
   description, nothing to corroborate with. So attribution is by an explicit
   `CONFIRMED` map checked against each page's own roles and locations, and
   unconfirmed matches are printed with their evidence rather than written.
   First run: 16 employers confirmed, 1,324 roles; 5 advertising-but-unconfirmed
   reported.

And a parser trap worth knowing about on any Rails/Turbo board: **the results
list contains a Mustache template**. A company with nothing advertised still
renders one card-shaped block whose title is the literal `{{{highlighted_title}}}`,
and a first pass archived it as a vacancy for 28 employers that had no jobs at
all. robots.txt says so out loud. Any field still carrying braces is dropped.

## The hub bug these boards exposed

`hubFor` stopped falling back to the employer's home hub when a board published
NO location at all. The earlier fix that appends a trailing comma before
matching (so " wa," fires when the state is last) also made the emptiness test
`!l.trim()` permanently false — `l` for a blank location is `","`, which is
truthy. So "no location stated" resolved to no hub instead of the company's own
city, silently, for every board whose cards omit one: JobAdder rows, both
WordPress readers, Cornerstone. An unplaced row still archives — it just stops
appearing on the map, which is why nothing ever errored. Emptiness is now tested
on the original string.

## `scripts/map-hubs.ts`

New bridge, the counterpart of `map-skills.ts`. The Action scrapers need the
same location → hub answer the Worker would give, and `hubFor` is a long,
carefully ordered list with real traps in it (Erskineville before Erskine, " wa,"
carrying a comma, bare "hamilton" deliberately absent). Re-implementing it in
Python would drift, and the drift would be invisible: a row with the wrong hub
still archives, it just appears in the wrong city.

---

# Five more employer boards, 2026-08-03 (PORTAL_GROUPS groups 30-31)

All five run in the Worker. Four are on platforms this file already read; one
needed a new reader.

| Employer | Feed key | Platform | Roles | Note |
|---|---|---|---|---|
| Worley | `sydney-wor` | **eightfoldpcs** (new) | 1,113 | global board; only ~10 roles are in Australia |
| Downer Group | `sydney-dow` | oracle | 589 | EXFS pod, site `CareersAtDowner`; 90% placed |
| Cleanaway | `melbourne-cwy` | pageupclassic | 119 | PageUp instance 621; 100% placed |
| AMP | `sydney-amp` | oracle | 34 | ESOW pod, default `CX_1` |
| IGO | `igo` | pageupclassic | 0 | self-hosted; genuinely advertising nothing |

**Worley is not on the Eightfold API the `eightfold` platform reads.** HSBC's
Eightfold site answers `/api/apply/v2/jobs`; jobs.worley.com returns
`{"message": "Not authorized for PCSX"}` for that path however it is called —
right domain, right Referer, a position id lifted from the page's own URL. The
page config names the product it is actually running: `configPath: "PCS>"`, whose
search lives at `/api/pcsx/search` and answers a plain unauthenticated request.
`domain=worley.com` is part of the endpoint because it is not derivable from the
host.

**The walk is bounded by the advertised total, not by a short page**, and this is
the one measurement in the batch that changed the code. Stopping at the first
page shorter than ten — what `pagedParallel` does — returned **1,070 rows on one
run and 1,084 on the next**, against a board reporting `count: 1116` both times.
The endpoint hands back fewer than ten rows mid-list often enough that "short
page" is not an end marker, and a dropped fetch is indistinguishable from one.
Reading `count` off the first response and walking that many pages returns 1,113
twice in a row (1,116 less three duplicate position ids). This is the same
silent-truncation trap the `careerSites.ts` header warns about, caught here only
because the board publishes a total to check against.

**Worley's 911 unplaced rows are correct.** The board is genuinely global —
Cameron LA, Abu Dhabi, Bogotá, Navi Mumbai, Calgary — and only about ten roles
sit in Australia. Falling the rest back to the Sydney home hub because the
employer is Australian would put Indian and Colombian jobs on the Sydney pin,
which is the same mistake the Dyno Nobel Americas board avoids.

**IGO is wired despite having nothing to fetch.** Its board renders "No results
found", not an error, and the platform is the same self-hosted PageUp classic
theme Cleanaway uses. A real zero is a real zero: the feed costs one request a
night and will start writing the day IGO advertises again. Nothing is written in
the meantime, so the card is not blanked either.

**Cleanaway is why `fetchPageUpClassic` reads its `<thead>`.** Harvey Norman's
table is `[Position, …, Location]` and the fetcher took the last cell; Cleanaway's
is `[Position, Location, Opened, Closes]`, so the same code read "31 Aug 2026" as
a location. The column is now found by its header. One Cleanaway ad lists three
sites at once ("Erskine Park NSW, Northgate QLD, Melbourne VIC") and lands on
whichever hub `hubFor` reaches first in its needle order rather than the first
one written — one row in 119, and not worth reordering a matcher every feed
shares.

Scheduling: Worley leads group 30 (`35 9 * * *`) alone, because 1,116 roles at a
fixed ten a page is ~112 requests. Downer, Cleanaway, AMP and IGO share group 31
(`45 9 * * *`) — 24, ~7, 2 and 1 requests respectively.

**AMP's first probe returned 0 and a retest a minute later returned 34.** The
Oracle pod rate-limits by serving an empty `requisitionList`, not an error. Which
is exactly the case `processPortals` is built for: an empty pull is never
written, so a throttled night leaves yesterday's rows in place instead of
emptying the card.

---

# a2 Milk, Telix and Sims, 2026-08-04 (PORTAL_GROUPS group 32)

Five feeds for three employers, 186 roles, all in the Worker on one tick
(`55 9 * * *`) — Greenhouse serves a whole board in a single call, a2 Milk is
one listing plus four job pages, and Sims is the only one that pages.

| Employer | Feed key | Platform | Roles | Placed |
|---|---|---|---|---|
| Sims Metal | `sydney-sgm` | successfactors | 105 | 26 |
| Telix (USA/CA) | `melbourne-tlx-us` | greenhouse | 46 | 4 |
| Telix (EMEA) | `melbourne-tlx-emea` | greenhouse | 18 | 0 |
| Telix (APAC) | `melbourne-tlx-apac` | greenhouse | 11 | 7 |
| The a2 Milk Company | `nz-the-a2-milk-company` | avature | 4 | 4 |

**Telix runs three boards, not one.** Its careers page is a switch between them
(`?region=telixus|telixapac|telixemea`), each a separate Greenhouse board. They
belong to one roster company, so they share `melbourne-tlx` and take distinct
`key`s — the same arrangement Transurban and BlueScope already use. Reading only
the board the page happens to load first would have captured 46 of 75 roles and
looked complete.

**a2 Milk is a second Avature shape, and the distinction is the point.**
Macquarie, Woolworths and Santos run Avature's search grid, whose result cards
carry a location cell that `avatureCells` addresses by index. a2 Milk runs
Avature's portal template: its cards are `[title, business unit, ref, posted
date]` and there is **no location on the listing at all**. There is no index
that could stand in for one — reading the cell before the date, which is what
the tenants without `avatureCells` do, would have written "Ref #410" as the
location for every role. The location exists only on each job's own page, in a
labelled field table, so those tenants set `avatureDetail` and are read from
there: Location, Date Published and Business Unit, one request per role. That
cost is why the flag is opt-in per site rather than the default.

A detail page that fails to fetch is **skipped, not archived with a blank
location** — a blank falls back to the employer's home hub, so the failure would
have quietly moved a Pokeno role onto whichever pin a2 Milk sits on rather than
losing it visibly.

**Sims' 79 unplaced rows are correct.** Its board is mostly US scrapyard towns —
Mays Landing NJ, Tabb VA, Monessen PA — real places the map does not plot.
Falling them back to Sydney because Sims is an Australian company would put a
Virginia labourer on the Sydney pin. The 105 matches the board's own
"Results 1 – 25 of 105", so the walk is complete rather than truncated.

**One needle added to `hubFor`: Fishers → Indianapolis.** Telix's US
manufacturing site is in Fishers, Indiana, an Indianapolis suburb the board
names on its own, and Indianapolis is a city the app plots. It was added the way
the Erskine Park needle was — by measuring first: not one row already in the
archive carried "fishers" in a location, so the needle can only match this
employer's Indiana roles rather than moving something already placed. Telix's
remaining unplaced rows are genuinely unplaceable: 35 are "USA- Remote", and the
rest are countries ("Belgium", "Switzerland", "Japan") or towns with no plotted
city. **Geneva was checked and deliberately left alone** — it is not a city this
app draws, so a needle for it would point at a hub that does not exist.

## The a2 Milk Company joins the roster

New company, `nz-the-a2-milk-company`, on the Auckland local layer at Level 10,
51 Shortland Street (geocoded, `[174.768234, -36.847109]`). Headcount is the
reported **511 at 30 June 2025, up 4.7%** on the prior year — the same
annual-report source the AU roster's headcounts use, not an estimate. Dual-listed
NZX ATM / ASX A2M; the NZ roster carries it under NZX, as it does every other
Auckland company.

---

# Cutting the Oxylabs dependency where the target never enforced it (2026-08-04)

Fourteen scripts route through `scripts/oxylabs_client.py`. Each was probed from
an ordinary datacentre address to establish which ones the residential IP is
actually buying something for. Two turned out not to need it at all, one had
already stopped using it without anyone updating the prose, and two had their
dependency confirmed.

| Target | Probed from a DC IP | Verdict |
|---|---|---|
| jobsdb | 200, full JSON; direct and proxied runs **identical** | direct now |
| jobs.govt.nz | direct and proxied returned the **same 518 roles, same failures** | direct now |
| iworkfor.sa.gov.au | already direct — dead import, stale docstring | cleaned up |
| apsjobs.gov.au | 200, Aura shell, **no jobs in it** | still needs render |
| careers.nab.com.au | Akamai `Access Denied` on every path, robots.txt included | still needs both |

**The measurement that mattered is the control run, not the probe.** A single
`curl` returning 200 proves very little — the interesting question is whether the
proxied run returns *more*. For jobsdb it returned byte-identical output (ANZ 2
of 22 scanned, one of three companies with HK ads). For jobs.govt.nz it returned
the same 518 roles **with the same two Wellington pages failing** — which is what
turned the diagnosis around: the "inconsistency" being blamed on the datacentre
IP was reproducible through a residential one, so it was never the IP.

## Dropping the proxy must not drop the pacing

The throttle, jitter and backoff lived inside `oxylabs_client.py`, so they only
applied to requests that went *through* Oxylabs. Every `--direct` path was a bare
`urlopen` with no retries and no spacing. Flipping the default would therefore
have quietly turned "stop paying a proxy" into "stop being polite" — and jobsdb
walks 355 companies six threads wide, which is exactly the shape a board
rate-limits.

So the policy moved to **`scripts/http_fetch.py`** and `oxylabs_client` now
imports it. Both transports share one clock: the throttle is process-global and
lock-guarded, so six worker threads fetching directly are spaced against each
other rather than each pacing itself, and a run mixing direct and proxied calls
is still one stream. `--oxylabs` on either script puts the proxy back with
nothing else to change.

## The bug the proxy was hiding

`jobs.govt.nz` serves **two link shapes in the same results table**:

```
legacy   jncustomsearch.viewFullSingle?in_organid=16563&in_jnCounter=226644015&…
modern   /jobs/MPI26-1936535          (permalink carrying the agency's own ref)
```

`LINK_RE` required `in_jnCounter=\d+`. Every job on a modern permalink therefore
matched nothing and was dropped by `if not a: continue` — silently, because a row
the parser cannot read is indistinguishable from a row that was never advertised.
Measured: page 0 of Wellington yielded **9 usable rows out of 20**, and the walk
as a whole collected **518 of 721 advertised roles (72%)** while reporting
success. Anchoring on the row's `<div class="position">` instead matches whatever
the href is:

|  | before | after |
|---|---|---|
| Auckland | 316 of 365 (87%) | 355 of 355 (100%) |
| Wellington | 202 of 356 (57%) | 349 of 351 (99%) |
| total parsed | 518 | **704** |

Absolutising the href needed widening too: a root-relative `/jobs/…` joined onto
`JOB_BASE` gives `…/jobtools//jobs/…`, which 404s — and the url is the dedup key,
so a broken one also splits one role into two rows over time.

**The reason this ran for months is that nothing failed.** So nzgov now carries
the same floor the NSW scraper has: collect at least 80% of the board's own
advertised total or exit non-zero having written nothing. The totals do move
between runs — Wellington reported 356, then 151, then 351 within an hour as the
board refreshed — so it is deliberately a floor rather than an equality test.

That is the general lesson worth keeping: **a proxy is a plausible explanation
for missing rows, which makes it a good place to hide a parser bug.** Before
attributing a shortfall to blocking, run the same walk both ways and compare.

## What is still on Oxylabs, and why

Seventeen workflows. Every target was probed from an ordinary datacentre address
on 2026-08-04; what follows is what each one actually needs, measured rather than
assumed.

**Blocked by IP — a plain request never gets the content**

| Target | From a DC IP |
|---|---|
| jora | 403 |
| gulftalent | 403 (Akamai, 400B "Access Denied") |
| glassdoor | 403 |
| indeed | 403 (DataDome) |
| iworkfor.nsw (bearer read only) | 403 |
| careers.aucklandairport.co.nz | 403 Cloudflare "Just a moment" |
| technology1.com | 403 Cloudflare "Just a moment" |
| simplyhired.com.au | 403 Cloudflare, robots.txt included |
| startup.jobs `/company/<slug>` | 403 Cloudflare |
| careers.nab.com.au | Akamai denies every path, robots.txt included |

**Blocked by rendering — the page loads, the data is not in it**

| Target | From a DC IP, no browser | With a headless browser on CI |
|---|---|---|
| Stockland (SuccessFactors) | 200 / 179KB, **0 `jobResultItem` rows** | **10 rows** |
| Dyno Nobel (SuccessFactors) | 200 / 264KB, **0 rows** | **10 rows** |
| Sandfire (SuccessFactors EU) | 200 / 202KB, **0 rows** | **6 rows** |
| Whitehaven (Dayforce) | 200 / 452KB, paginator but **0 cards**; API POST 403 | **25 rows, pages** |
| apsjobs.gov.au | 200, Aura shell, no vacancies | **15 rows** |
| naukri.com | 200, 0 job tuples | 403 Akamai — needs the IP too |
| zhaopin | 200, 2KB shell | 200 challenge page — needs the IP too |

Five of those seven serve their shell happily to a datacentre address, hand back
**zero rows under the scrapers' own parser**, and then work perfectly once a
browser is pointed at them from the same kind of address. What they needed was a
browser and nothing else.

### A headless browser on an ordinary GitHub runner gets five of the seven

Settled by measurement rather than argument:
`.github/workflows/probe-headless-ci.yml` runs `scripts/probe-headless-ci.py`,
which drives Chromium through the same load-and-settle sequence the Oxylabs
`browser_instructions` describe and then counts rows **the way each scraper
does** — its own row regex, or its actual parser where it uses one
(`jobs_extract.extract_jobs` for APS, `zhaopin.parse_search_html` for Zhaopin,
both of which read a payload rather than markup). Reusing the real parser is the
point: a marker appearing in the DOM is not the same claim as the scraper being
able to read a job out of it.

`ubuntu-latest`, no proxy, no credentials:

| Board | verdict | rows | paging |
|---|---|---|---|
| Stockland (SuccessFactors) | ROWS | 10 | — |
| Dyno Nobel (SuccessFactors) | ROWS | 10 | — |
| Sandfire (SuccessFactors EU) | ROWS | 6 | — |
| Whitehaven (Dayforce) | ROWS | 25 | **page 2 → 11 rows** |
| APS Jobs (Salesforce Aura) | ROWS | 15 | — |
| Naukri (Mumbai search) | **BLOCKED** | 0 | 403, 330B, Akamai deny |
| Zhaopin (Shanghai search) | **BLOCKED** | 0 | 200, 16KB challenge page |

So **five of the seven need a browser and nothing else** — including APS, whose
Aura hydration completes on a datacentre address given 12 seconds to settle.
Whitehaven's Ant paginator answers a click from CI too, which matters because a
board that renders page 1 and then refuses to page is only half solved. Those
five can move to Playwright on GitHub's own runners: no proxy, no hardware, no
self-hosted runner and so none of the fork-PR exposure below.

**Naukri and Zhaopin need the residential IP as well as the browser**, and they
fail in the two different ways worth telling apart: Naukri returns a hard Akamai
403 with a 330-byte body, while Zhaopin returns a perfectly ordinary 200 whose
16KB is a challenge page with no jobs in it. A run that only checked status codes
would have scored Zhaopin as a pass.

### The five are ported and verified end to end

`scripts/browser_fetch.py` executes the SAME instruction vocabulary Oxylabs'
`browser_instructions` used, so each scraper's port was an executor swap and its
instruction list is unchanged:

```
{'type': 'wait',  'wait_time_s': 8}
{'type': 'click', 'selector': {'type': 'css'|'xpath', 'value': …}}
```

`--oxylabs` on any of the five hands the identical list back to the proxy.

`verify-browser-scrapers.yml` runs all five in their no-write modes on a hosted
runner — a different question from the probe, which only asks whether a page
renders. This asks whether the SCRAPER still works: its paging, its parser, its
skills mapping. Measured 2026-08-04:

| Scraper | Result |
|---|---|
| Stockland | pages 1-3 × 10 rows, page 4 empty → stop. **30 of 32 advertised** |
| Dyno Nobel (SF) | pages 1-4, **33 of 33 advertised** |
| Dyno Nobel (Taleo Americas) | 150 roles — unchanged path, still a session walk |
| Sandfire | **6 of 6 advertised** |
| Whitehaven (Dayforce) | page 1/2 = 25, **page 2/2 = 11**, 36 total |
| APS Jobs | **15 vacancies** via job-cards; stopped at page 2 (0 new) |

Two of those lines are the ones that matter, because they are what a careless
port would have broken silently. Stockland's chained "Next Page" clicks still
walk three pages and still stop at the fourth. Whitehaven's Ant paginator still
answers a numbered-page click and returns a *different* eleven rows. A port that
rendered page 1 four times would have reported 40 rows and looked healthier than
the truth.

Deliberately not optimised while porting: each render still gets a fresh context
and re-navigates from the listing URL, so SuccessFactors paging stays quadratic
in clicks exactly as it was. Every one of these parsers assumes a full render of
the page it is looking at, and a port is the wrong place to change that.

**`browser-portals.yml` needed care.** It runs three scrapers and only Stockland
moved — Auckland Airport and TechnologyOne are Cloudflare-challenged from a
datacentre address, so they keep their Oxylabs credentials in the same file. A
first pass stripped the secrets from the whole workflow, which would have broken
both of them.

Note also that the block markers behaved correctly on this run: silent on all
five boards that had rows, firing only on the two that were empty. That is the
fix described below working as intended — the first run had reported blocks
against boards it had simultaneously read 10, 10, 6 and 25 rows from.

**One flaw in the first run, worth recording because it nearly inverted the
read.** The probe also scanned for block-page markers, and reported
"[Akamai deny]" against all three SuccessFactors boards and "[captcha /
challenge]" against Dayforce — while simultaneously finding 10, 10, 6 and 25
rows. The strings are in the pages' own JavaScript (error handling, an
application-form captcha widget), not in a block page. Searching a fully
rendered application for the words a block page uses will always find them
somewhere. A block is a **diagnosis for an empty result**, not an independent
signal, so the markers are now only consulted when the row count is zero.

### The posts feed cannot finish, and therefore never writes

Re-running `linkedin-posts-archive` after the lockfile fix got the scraper
running properly for the first time in a while — and showed it cannot succeed at
the current roster size. From the run of 2026-08-04:

```
1503 companies to try
  [20/1503]  posts=129 resolved=13 unresolved=7
  [40/1503]  posts=214 resolved=23 unresolved=17
  [80/1503]  posts=413 resolved=43 unresolved=37
  [100/1503] posts=519 resolved=54 unresolved=46
```

**100 companies in 42 minutes.** The full walk is therefore about ten and a half
hours against a 60-minute job timeout. And the D1 write happens once, after the
whole walk — `rows` accumulates in memory and the INSERT loop runs only when the
last company is done. So the job times out mid-walk, writes nothing, and the
519 posts it had already collected are discarded.

That is why `company_posts` still holds 50 rows across 5 companies, dated
2026-08-01: the table has never been filled by this workflow, only seeded.

**The scraping itself is fine.** It resolves companies correctly and rejects
wrong slugs with real reasoning — `/igo` is "BNI La Roche-sur-Yon Porte du
Littoral", `/dyno-nobel` is the "Institute of Makers of Explosives",
`/national-australia-bank` is a different page from NAB's. That identity check is
doing exactly its job. The problem is throughput and persistence, not accuracy.

Three things are wrong and they compound:

1. **It walks 1,503 companies** — the whole `COMPANIES` list, government agencies
   included, most of which have no company page worth reading. The other roster
   walkers use `load_roster()` (355) or `with_cities` (995).
2. **The write is all-or-nothing at the end**, so any interruption costs the
   entire run rather than the tail of it.
3. **Nothing is sharded across days**, unlike the news ticks or the Woolworths
   portal, both of which split precisely because one invocation could not finish.

Fixing (2) alone would make every run bank its progress. Fixing (1) and (3)
together would let a full pass complete. Until then this feed is red every night
whether or not `npm ci` works.

---

**The one lead that did not survive being tested**

`linkedin-posts-to-d1.py` reads company POST feeds, not the jobs API, and
`linkedin.com/company/<slug>/` answered on four consecutive slugs (BHP, Rio
Tinto, Woodside, Fortescue) with 60 posts each, real post text and **zero
authwall markers**. That was recorded here as a lead rather than a result,
because four requests is not the several hundred the nightly walk makes.

Tested properly (`.github/workflows/probe-linkedin-volume.yml`, 100 requests
from ubuntu-latest, outcomes bucketed by request number):

| requests | posts | authwall | error |
|---|---|---|---|
| 1-25 | **0** | 14 | 11 |
| 26-50 | **0** | 11 | 14 |
| 51-75 | **0** | 8 | 17 |
| 76-100 | **0** | 12 | 13 |

**Zero posts, from the very first bucket.** Not a cliff — it never worked at
all. Roughly half the requests were authwalled and the rest failed at the
transport, which is the same refusal wearing two hats.

The four-slug success was an artefact of where it was measured. Those probes ran
from the dev sandbox, which egresses through an agent proxy, and the note
recording them said so: *"this sandbox egresses via the agent proxy … a 403 here
is solid evidence; a 200 is weak evidence."* That caveat turned out to be the
whole story. LinkedIn authwalls a GitHub runner on request one.

Worth keeping as a method note: **a positive result from an unrepresentative
vantage point is worth less than nothing**, because it invites work that the
real environment will reject. The probe that settled it cost one runner-minute
and disagreed with the lead completely.

**One case that is already half-free.** `startup.jobs` challenges its company
pages but publishes all 42,885 of them in a sitemap on `cdn.startup.jobs`, which
answered a plain request with 7MB. The script already fetches that un-proxied;
only the per-company page fetches need the proxy.

Note what Oxylabs is really selling the first group: **rotation**, not "an IP in
a house". A single residential address walking 355 companies nightly on LinkedIn
or Indeed will be flagged harder than a rotating pool, so the roster-wide feeds
are the ones a self-hosted runner will struggle with; the single-board walks it
would handle comfortably.

**And this repository is PUBLIC**, which rules out the obvious shape of that
plan. A self-hosted runner on a public repo will execute workflow code from fork
pull requests on whatever machine it runs on — so "put a Pi on the home
connection and label it `residential`" is not a safe default here. If that route
is taken it needs, at minimum, the runner confined to a network segment with
nothing else on it and `pull_request` events kept off it entirely.

Which is why the browser-only five are the half to take first: they run on
GitHub's own hosted runners, so they need no proxy, no hardware and no
self-hosted runner at all — and therefore raise none of this.

**Where that leaves the seventeen:**

| Group | Count | State |
|---|---|---|
| Browser only | 5 | **Ported and verified.** Playwright on hosted runners, no proxy, no hardware. |
| Residential IP (± browser) | 11 | jora, gulftalent, glassdoor, indeed, linkedin-jobs, nsw-gov bearer, Auckland Airport, TechnologyOne, SimplyHired, startup.jobs company pages, NAB — plus naukri and zhaopin, measured into this group |
| Residential IP — **measured**, not assumed | +1 | linkedin-posts: 0 posts in 100 requests from a hosted runner, authwalled from the first |

Counting workflows rather than scrapers, the surface went **17 → 13**, not 17 →
12: `browser-portals.yml` still carries the credentials because two of the three
scrapers in it (Auckland Airport, TechnologyOne) still need them. Four workflows
dropped Oxylabs outright — sandfire-portal, dyno-portal, whitehaven-dayforce,
aps-archive.

Five scrapers came off the proxy and needed no purchase of any kind. What remains
is the genuinely hard half: twelve targets that refuse a datacentre address
outright, with no remaining candidates for a free escape — the last one,
linkedin-posts, was tested and failed.

---

# NSW Government feed (`scripts/nsw-gov-to-d1.py`) — and the 303 rows that weren't jobs

**What went wrong.** iworkfor.nsw.gov.au was rewritten as a client-rendered
Next.js app. Its HTML now contains no vacancies and no `/job/` links at all: the
results list is a client component that fetches after hydration, and the only
job-shaped content left in the served payload is the filter sidebar.

The scraper did not notice. It parsed the page, found *something*, and archived
it. All 303 `nsw-gov` rows in the archive were site chrome — "NSW Government",
"Accessibility", "Privacy and security", "How search works", "Job alerts", every
region filter ("Sydney Region", "Regional NSW") and every job-category label
("Aboriginal Health", "Accounting and Financial", "Ambulance Services"…). Zero of
the 303 had a job URL. The nightly run went green every time.

**Two independent defects, both now fixed:**

1. `jobs_extract.looks_like_job` accepted `{id, name}` as a vacancy — `name` is a
   title key and a bare `id` was accepted as corroboration, so *every enumerable
   thing* in a JSON payload qualified. A generic title now needs real
   corroboration (organisation, location, salary, closing date, or a
   job-*specific* reference); a bare `id` is not corroboration, because
   everything has one. Pinned by fixtures copied verbatim from the live payload.
2. The scraper had no floor. It now exits non-zero, writing nothing, if the
   board yields no vacancies or fewer than 80% of the total the board itself
   advertises. **A source that has stopped working must go red, not quiet** —
   this is the same rule as "an empty portal pull is never written".

**How it reads the board now.** The JSON search API its own browser client calls:

```
POST https://api.ad-core04.com/api/search/jobs
Authorization: Bearer <token from the site's JS bundle>
{..., "PageNumber": 1, "PageSize": 500, "SortBy": "RelevanceDesc"}
-> {"JobCount": 3699, "Jobs": {"$values": [{"Job": {...}}, ...]}}
```

Better than the HTML on every axis: it reports its own total (so a short walk is
detectable rather than silent), needs no JS render, and eight calls cover the
board in ~90s.

- **The bearer is discovered, never stored.** It is a long-lived OAuth-client
  token the site ships publicly to every browser, so it is not a secret of ours —
  but it is not ours to hard-code either, and it can rotate. Each run reads it
  back out of the live bundle by *shape* (an https base ending `/api/`, plus a
  three-segment JWT, in the same chunk), because the minifier renames every
  variable and rehashes every filename on each build.
- **Oxylabs is used for that one step only.** iworkfor.nsw.gov.au 403s any
  datacenter IP, static `/_next/` chunks included; `api.ad-core04.com` does not,
  so the search calls themselves are plain HTTP.
- **Salaries.** 3,001 of 3,699 ads state a range, and 2,918 (79% of the board)
  survive the sanity check and parse to annual AUD — where the rendered cards
  carried none at all. The check matters: 83 ads are typed `Annually` and carry
  an hourly figure ("$37 - $43"). The board's own distribution proves it — 80
  annual lows under $100, three between $1,152 and $1,439, then nothing until
  $23,090, where real part-time annualised salaries start. Those 83 are stored as
  **no salary**, not as a $37 annual wage.
- **Agency mapping** uses the board's own hierarchy: `BusinessName` is the
  employing entity ("Western NSW Local Health District"), `AgencyName` the
  cluster above it ("Health"). Entity first (more specific, and the roster
  carries 47 of them), cluster as fallback — 2,075 placed → 3,600 placed, leaving
  99 (2.7%) in the generic bucket. The **display** name stays the entity either
  way: rolling the map pin up to NSW Health is right, telling the user a Dubbo
  nursing role is advertised by "Health" is not.

---

# Wayback recovery of dead career sites (`scripts/wayback-to-d1.py`)

A **one-off backfill, not a feed.** It reads the Internet Archive's captures of
career sites that no longer exist and archives the advertisements that ran on
them. Nothing schedules it and nothing should: the corpus is closed.

One tool, several dead sites: `--app-id` picks a profile from `SITES` and is also
the roster company id the rows are archived against. Two are configured — `bhp`
and `rio`.

## Rio Tinto (`--app-id rio`, added 2026-08-03)

Rio Tinto ran two regional job sites on one platform and retired both when
recruitment moved to a single global Workday tenant. The archive holds
**jobs.riotinto.ca** (2011–2014) and **jobs.riotinto.com.au** (2012). Recovered:
**539 distinct advertisements**, spanning 2011-10-29 to 2014-10-30, ~61% placed
on a hub.

**Detail pages, not listings — the opposite of BHP, and not a choice.** Rio
Tinto's `/browse/search` pages are an 18 KB shell that loaded results over AJAX,
and the Wayback Machine has no XHR responses to replay: a 2012 capture of
`jobs.riotinto.com.au/browse/search` carries **zero** job links. The ads survive
only as `/browse/jobs/<slug>-<REF>` detail pages, one per fetch. That is
affordable only because there are 539 of them rather than BHP's tens of
thousands, and it is what the profile's `per_page` flag selects.

**One fetch per advertisement, not per capture.** For a detail-page site a
distinct URL *is* a distinct ad, so only one capture of each is fetched — the
other captures still widen that ad's first/last-seen span, they just cost
nothing. (On BHP every capture is a different day's whole board, so there is
nothing to collapse.)

**Keying the parser on the hidden `city_name` input cost a fifth of the corpus.**
The 2012 template carries `city_name`/`state_name` as hidden inputs; the 2011
Canadian one does not, and puts the place only in `li.timezone`. Measured before
the fix: 104 of 536 captures "held no rows" while their `<title>` plainly named a
real ad ("Planner, condition monitoring", capture 20111020034236). The hidden
pair is still preferred where it exists — it is the more specific answer, city
*and* state — with `li.timezone` as the fallback.

Two smaller traps, both measured: the **title is the last `<h1>`**, because both
templates open with a site-header `<h1>` ("Join our team") and taking the first
would have filed every Rio Tinto ad under that one title; and the Australian site
appends the requisition reference after a **dash** rather than in parentheses, so
`split_ref` (written for BHP's `Title (REF)`) leaves it in place. A reference is
a token with no lowercase letters and a digit, which keeps "Procurement
Specialist - Kitimat Modernization" intact while stripping "Technical Officer -
PIL0086W".

Neither site publishes a posting date anywhere on the page, so `posted` stays
empty and the dates come from the capture timestamps — the same rule the BHP
legacy layout follows, for the same reason.

## BHP (`--app-id bhp`)

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
