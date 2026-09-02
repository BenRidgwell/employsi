#!/usr/bin/env python3
"""Job boards -> D1, through Bright Data's per-board Scraper APIs.

ONE SCRIPT, SEVERAL BOARDS, because the only thing that differs between them is
a dataset id, the shape of one search input and the names Bright Data gives its
columns. The walk, the attribution gate, the skills mapping and the D1 upsert
are the parts worth having once.

WHY EITHER BOARD IS HERE AT ALL — two different dead ends, same answer.

  linkedin  IPRoyal refuses a CONNECT tunnel to linkedin.com outright, so the
            target is never even asked:

                www.linkedin.com  REFUSED  HTTP/1.1 403 Forbidden
                                           X-Response-Origin: proxy-server

            That is the proxy answering, measured 2026-08-09 with a control host
            tunnelling fine in the same pass. Most residential providers
            blocklist the domain, so a cheaper proxy is not a plan.

  indeed    Three transports were measured against the real 354-company walk on
            2026-08-09 and all three returned a DataDome challenge on 432-442 KB
            of real Indeed: headless-shell on a rotating exit, real Chrome with
            stealth on a rotating exit, and headless-shell on a PINNED exit. Not
            the address, not the browser build. What DataDome refuses is the
            sustained walk. Oxylabs served it until the plan's quota ran out the
            same day, at which point the feed had no working transport at all.

WHAT THIS COSTS, AND WHY THAT SHAPE MATTERS
Billing is per RECORD RETURNED, not per request — a different shape from every
other source here, and the one most able to produce a surprise invoice. ~354
companies at ~20 live roles each is ~7,000 records a sweep: nightly is
~210k/month, weekly ~48k. Postings do not churn daily and the archive ages rows
out on last_seen, so weekly is the sane cadence and --max-records caps a run.

Bright Data gives 5,000 records/month free. Start there, with --probe.

NOTHING HERE HAS BEEN RUN AGAINST THE LIVE API. It is written from Bright Data's
published contract (POST /datasets/v3/trigger, GET /datasets/v3/progress/<id>,
GET /datasets/v3/snapshot/<id>) and this repo has no token to test with. So the
unknowns are made visible rather than assumed away:

  * --probe triggers, waits, downloads and REPORTS, writing nothing to D1.
  * The run prints a FIELD COVERAGE table over the records that actually arrive.
    Column names differ per board and are documented only partially, so every
    field is looked up under several plausible keys and its absence is REPORTED.
    If nothing carries a title under any known key the run dumps the first
    record's keys and stops — that means the response shape is not what this
    parser expects, and guessing further would be inventing data.
  * --input-json overrides the search input verbatim, so a shape copied from
    Bright Data's own playground needs no code change. A 4xx from the trigger
    exits with Bright Data's own message, which is usually the schema.

Env: BRIGHTDATA_API_TOKEN, optionally BRIGHTDATA_DATASET_ID (overrides the
     per-source default), CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID,
     D1_DATABASE_ID
TWO MODES, AND ONLY ONE OF THEM GROWS THE ARCHIVE.

  discovery (default)  Ask Bright Data which jobs an employer has, by keyword.
                       This is the sweep, and it is what finds new postings.
  --refresh            Re-scrape the URLs the archive already holds, through
                       the /scrape collect-by-URL endpoint. It keeps known rows
                       alive and CANNOT find a posting nobody has seen, so it
                       is a stopgap for a broken discovery path rather than a
                       substitute for one. Added 2026-09-02 because Indeed's
                       discovery stalled; see the note on REFRESH below.

Run: python scripts/brightdata-to-d1.py --list-datasets
     python scripts/brightdata-to-d1.py --source indeed --refresh --probe --limit 20
     python scripts/brightdata-to-d1.py --source indeed --probe --limit 20
     python scripts/brightdata-to-d1.py --source linkedin --max-records 50000
"""
from __future__ import annotations
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from advertiser_match import advertiser_matches  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

BD_TOKEN = os.environ.get('BRIGHTDATA_API_TOKEN', '')
BD_BASE = 'https://api.brightdata.com/datasets/v3'


def dataset_env(source: str) -> str:
    """The dataset id for one board, per-source first.

    ONE SHARED `BRIGHTDATA_DATASET_ID` CANNOT SERVE TWO SCHEDULED SOURCES. Each
    board is a different scraper with a different id, so a schedule collecting
    both Indeed and LinkedIn needs both ids present at once —
    BRIGHTDATA_DATASET_ID_INDEED and BRIGHTDATA_DATASET_ID_LINKEDIN. Whichever
    one happened to be in the shared variable would otherwise be used for BOTH,
    which does not fail loudly: it collects the wrong board's postings under the
    other board's source tag and bills for every record.

    Returns only the per-source variable. The SHARED name is deliberately not
    consulted here — see the resolution order below, where it ranks BELOW the
    known-good id in SOURCES. Consulting it first is what makes the silent
    mis-collection possible: with the shared variable holding Indeed's id, a
    LinkedIn run that simply has no per-source secret set would collect Indeed
    postings and file them under `linkedin`.
    """
    return os.environ.get(f'BRIGHTDATA_DATASET_ID_{source.upper()}', '')

CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney', 'canberra']

# THE `source` TAG MATCHES THE EXISTING FEED FOR THAT BOARD, deliberately. These
# are different TRANSPORTS for the same publisher, and job_key dedupes on
# source|title|company|location — so a role seen by both the old scraper and
# this one refreshes a single row. A distinct tag like 'linkedin-bd' would
# double-count every shared listing until the stale variants aged out.
#
# `dataset` is the scraper id from the Bright Data dashboard. Where it is None
# it MUST be supplied, because a wrong id silently collects the wrong thing and
# bills for it. --list-datasets prints the ids on your account.
#
# `fields` maps our column to the keys that board might use. Several candidates
# each because Bright Data documents these only partially; the first non-empty
# one wins and the coverage table reports what was actually found.
SOURCES = {
    'linkedin': {
        'source': 'linkedin',
        # The board name, written to the archive's `category` column. That
        # column is free text and every source uses it differently — gov feeds
        # write "Government", the portals "Careerportal", Adzuna a real job
        # category — and for these two it is the board. It was HARDCODED to
        # 'LinkedIn' for both until 2026-09-02, which filed 1,886 Indeed rows
        # under LinkedIn. Cosmetic rather than load-bearing, but it is the kind
        # of wrong that gets believed later.
        'label': 'LinkedIn',
        # "Linkedin job listings information" — read off the account with
        # --list-datasets on 2026-08-10. Chosen from five LinkedIn datasets that
        # mention jobs because it is the exact analogue of the Indeed scraper
        # already working here ("Indeed job listings information"); the others
        # are `Linkedin jobs count` (counts, not postings), `Linkedin Company
        # with Jobs`, `LinkedIn profiles Jobs Listings` (profile-oriented) and
        # `Linkedin Jobs listing`. A dataset id is an identifier, not a
        # credential, so it belongs in the repo where it can be reviewed.
        'dataset': 'gd_lpfll7v5hcqtkxl6l',
        # THE EMPLOYER GOES IN `company`, NOT IN `keyword`, and getting that
        # wrong cost three empty runs.
        #
        # `keyword` was the obvious choice because Indeed's equivalent
        # (`keyword_search`) matches the employer. LinkedIn's does not: it
        # matches job TITLES and DESCRIPTIONS, so searching "Alkane Resources"
        # as a keyword legitimately finds nothing. Every request was valid and
        # every snapshot came back empty, which is the hardest kind of wrong —
        # nothing errors, so it reads as a quiet job market.
        #
        # The schema was not guessed. Posting a deliberately invalid field made
        # Bright Data echo the whole contract it accepts:
        #
        #   {"location":"", "keyword":"", "country":"", "time_range":"",
        #    "job_type":"", "experience_level":"", "remote":"", "company":"",
        #    "location_radius":""}
        #   errors: [["location", "Required field"]]
        #
        # which is where `company` came from, and why `location` is always sent.
        'discover_by': 'keyword',
        'input': lambda name: {'company': name,
                               'location': LOCATION,
                               'country': COUNTRY,
                               'keyword': ''},
        'fields': {
            'title': ('job_title', 'title', 'job_position'),
            'company': ('company_name', 'company', 'companyName'),
            'location': ('job_location', 'location', 'job_location_text'),
            'url': ('url', 'job_url', 'link'),
            'posted': ('job_posted_date', 'posted_date', 'date_posted', 'job_posted_time'),
            'salary': ('job_base_pay_range', 'salary', 'base_salary', 'compensation'),
        },
    },
    'indeed': {
        'source': 'indeed',
        'label': 'Indeed',
        # NO DEFAULT, and the reason is recorded because it cost a run.
        # `sd_msmsowmy2q27hoajjt` was supplied on 2026-08-09 and answered
        #
        #     POST /trigger -> HTTP 404: dataset does not exist
        #
        # Every dataset id in Bright Data's documentation is `gd_`-prefixed and
        # that one is `sd_`, which is why it shipped flagged as unverified
        # rather than trusted. `sd_` appears to identify a different resource
        # than the Web Scraper dataset this endpoint takes.
        #
        # A default that 404s is worse than none: it turns "you have not told me
        # which scraper" into "something is broken at Bright Data". Run
        # --list-datasets, which needs only the API token, and set
        # BRIGHTDATA_DATASET_ID to the Indeed *jobs* id it prints.
        #
        # RESOLVED: "Indeed job listings information", verified against the live
        # API on 2026-08-10 — 283 records over 20 companies, 112 rows written.
        'dataset': 'gd_l4dx9j9sscpvs7no2',
        'discover_by': 'keyword',
        # THE FIELD NAMES CAME FROM BRIGHT DATA, not from a fourth guess. Its
        # validation_error names them outright once the response is not
        # truncated:
        #
        #   ["keyword",       "This input should not contain a keyword field"]
        #   ["domain",        "Required field"]
        #   ["keyword_search","Required field"]
        #
        # So this scraper's search term is `keyword_search`, NOT `keyword` —
        # `keyword` belongs to a different discover mode and is rejected outright
        # — and `domain` is required rather than optional. au.indeed.com is the
        # Australian site; scripts/indeed-to-d1.py's COUNTRIES map calls it the
        # same thing.
        #
        # A PLAIN COMPANY NAME, not Indeed's `company:"Name"` operator. That was
        # tried and is not what this field takes; attribution is handled by
        # advertiser_matches() below, the same gate SimplyHired and Jora use.
        'input': lambda name: {'keyword_search': name,
                               'domain': 'au.indeed.com',
                               'location': LOCATION,
                               'country': 'AU'},
        'fields': {
            'title': ('job_title', 'title', 'jobtitle'),
            'company': ('company_name', 'company', 'companyName'),
            'location': ('location', 'job_location', 'formatted_location'),
            'url': ('url', 'job_link', 'link'),
            'posted': ('date_posted', 'job_posted_date', 'posted_date', 'date'),
            'salary': ('salary_formatted', 'salary', 'job_salary', 'compensation'),
        },
    },
}

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


LOCATION = _opt('--location', 'Australia')
# LinkedIn geo-resolves a search by country code as well as by the location
# string; Indeed's input carries its own `country`. Both default to AU.
COUNTRY = _opt('--country', 'AU')
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None


def _limit(v) -> int:
    """--limit accepts 'all' (or 0, or empty) for the whole roster.

    Spelling "every company" as a number large enough to exceed the roster is
    the kind of thing that silently becomes wrong when the roster grows past the
    number someone picked. 'all' cannot rot.
    """
    s = str(v).strip().lower()
    return 10 ** 9 if s in ('all', '', '0') else int(s)


LIMIT = _limit(_opt('--limit', 'all'))
# Where in the roster this run starts. With --limit it makes a chunk, so a
# roster too big for one job can be swept by several.
OFFSET = int(_opt('--offset', 0) or 0)
# THE COST GUARD. Per-record billing means a roster change or a hiring spree
# turns into money without anyone deciding to spend it. The run refuses to keep
# records past this and says so.
MAX_RECORDS = int(_opt('--max-records', 20000))
POLL_S = int(_opt('--poll', 20))
TIMEOUT_MIN = int(_opt('--timeout-min', 45))
PROBE = '--probe' in args
# --list-datasets: print every scraper id on the account and stop. Needs only
# the API token, and is the answer to "where do I get the dataset id".
LIST_DATASETS = '--list-datasets' in args
NO_SKILLS = '--no-skills' in args
WHICH = _opt('--source', '')
# --input-json '<json>': replace the generated search input entirely. Bright
# Data's playground shows the exact shape each scraper wants; this pastes it in
# without a code change, which beats another round of guessing at a schema.
INPUT_JSON = _opt('--input-json')
# --grep: narrow --list-datasets. Defaults to job-board words; 'all' disables.
GREP = _opt('--grep')

# --refresh: RE-SCRAPE THE URLS THIS SOURCE ALREADY HAS, instead of discovering
# new ones. A different Bright Data endpoint (/scrape, collect-by-URL) and a
# different question.
#
# WHY IT EXISTS. Indeed's discovery path stopped completing on 2026-08-29: five
# consecutive snapshots — four at 90 companies, one at 20 — were accepted,
# reported `running`, and never reached `ready`, including one left for the full
# 300 minutes. LinkedIn collected normally throughout on the same account,
# token and code, so it is the Indeed dataset's discover_new path rather than
# the account. Chunk size was ruled out by the 20-company probe on 2026-09-02.
#
# WHAT IT CANNOT DO, WHICH MATTERS MORE THAN WHAT IT CAN. Collect-by-URL takes
# job pages you already know about; it cannot find a posting you have never
# seen. So this REFRESHES the archive and cannot GROW it: run it alone and
# Indeed becomes self-referential, re-confirming a set that only shrinks as ads
# expire, until the feed is measuring its own history. It is a stopgap that
# keeps 6,153 known rows alive while discovery is broken — NOT a replacement
# for the sweep, and the moment discovery works again the sweep is what matters.
#
# It is cheap in the way that matters: billing is per record returned, and this
# returns at most one record per URL asked for, which is a number chosen here
# rather than discovered by a crawl.
REFRESH = '--refresh' in args
# How far back to reach for URLs worth re-checking. An ad this source has not
# seen in months is almost certainly down, and asking for it bills a record to
# learn nothing.
REFRESH_DAYS = int(_opt('--refresh-days', 45))
# URLs per /scrape call. Unmeasured — the shape came from a working request
# carrying four. Kept modest so a rejection costs one small call rather than the
# whole run, and so a slow response stays inside the timeout below.
REFRESH_BATCH = int(_opt('--refresh-batch', 50))
# THE COST GUARD FOR THIS MODE, and it needs its own because --limit means
# something different here. For discovery --limit counts COMPANIES and 'all' is
# bounded by the roster at 395. For a refresh it counts URLS, and the archive
# holds 6,153 Indeed rows inside the default window — so the same 'all' that is
# a safe default over there asks for fifteen times the roster in billable
# records over here, and MAX_RECORDS at 20,000 would not stop it.
#
# So an unbounded --limit is capped, loudly, and going past it has to be asked
# for. 1,500 is roughly a quarter of the archive: enough that a run is worth
# doing, small enough that nobody discovers the cost on an invoice.
REFRESH_MAX_URLS = int(_opt('--refresh-max-urls', 1500))

if not BD_TOKEN:
    sys.exit('BRIGHTDATA_API_TOKEN is required.')

if LIST_DATASETS:
    # GET /datasets/list returns every dataset the account can see, which on a
    # real account is the whole marketplace — ~1,900 entries of "test dataset -
    # ignore", tiktok posts and speedtest.net. A dump that size does not answer
    # "which id do I use", so it is FILTERED by default. --grep all shows
    # everything; --grep <terms> narrows to your own words.
    import urllib.request as _u
    _req = _u.Request('https://api.brightdata.com/datasets/list',
                      headers={'Authorization': f'Bearer {BD_TOKEN}'})
    try:
        with _u.urlopen(_req, timeout=60) as _r:
            _rows = json.loads(_r.read().decode())
    except Exception as _e:  # noqa: BLE001
        sys.exit(f'Could not list datasets: {_e}')
    if isinstance(_rows, dict):
        _rows = _rows.get('datasets') or _rows.get('data') or []
    _all = [d for d in _rows if isinstance(d, dict)]
    _terms = [t.strip().lower() for t in (GREP or 'indeed,linkedin,job,seek,glassdoor'
                                          ).split(',') if t.strip()]
    _show = _all if _terms == ['all'] else [
        d for d in _all if any(t in str(d.get('name', '')).lower() for t in _terms)]
    print(f'{len(_show)} of {len(_all)} datasets match {_terms}:\n')
    for _d in sorted(_show, key=lambda x: str(x.get('name', ''))):
        print(f"  {str(_d.get('id', '')):28} {str(_d.get('name', ''))[:70]}")
    if not _show:
        print('  (nothing matched — try --grep all, or --grep with your own terms)')
    print('\nPick the JOBS scraper for the board you want — not profiles, not '
          'companies — and set BRIGHTDATA_DATASET_ID to its id.')
    raise SystemExit(0)

if WHICH not in SOURCES:
    sys.exit(f'--source must be one of: {", ".join(sorted(SOURCES))}')
CFG = SOURCES[WHICH]
SOURCE = CFG['source']
# RESOLUTION ORDER, AND THE SHARED VARIABLE RANKS LAST ON PURPOSE.
#   1. BRIGHTDATA_DATASET_ID_<SOURCE> — per-board override, no commit needed.
#   2. SOURCES[...]['dataset']        — the id verified against the live API.
#   3. BRIGHTDATA_DATASET_ID          — legacy shared name, single-source setups.
# Putting (3) above (2) is what allows a board with no per-source secret to
# quietly collect a DIFFERENT board's postings under its own source tag, which
# no error would ever surface.
BD_DATASET = dataset_env(WHICH) or CFG['dataset'] or \
    os.environ.get('BRIGHTDATA_DATASET_ID', '')
if not BD_DATASET:
    sys.exit(f'No dataset id for --source {WHICH}. Set '
             f'BRIGHTDATA_DATASET_ID_{WHICH.upper()} (or BRIGHTDATA_DATASET_ID) to '
             f'the scraper id from your Bright Data dashboard — run --list-datasets '
             f'to see them. It is deliberately not defaulted for this source: a '
             f'wrong id collects the wrong thing and bills you for it.')
if not PROBE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --probe to skip the write.')
# --probe waives the token for discovery because that path only WRITES to D1.
# --refresh also READS from it — the URLs to re-scrape are the archive's own —
# so probing a refresh without a token dies inside d1() with an auth error that
# looks like Cloudflare being down rather than a missing argument.
if REFRESH and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required for --refresh even with --probe: '
             'the URLs to re-scrape are read from D1.')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def match_city(text: str):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    return None


SECTOR_BY_ID: dict[str, str] = {}

# COMPANIES THAT DESTROY THE BATCH THEY TRAVEL IN, per board.
#
# One employer here does not merely return nothing for itself — it makes the
# WHOLE snapshot come back empty, taking the other 89 companies in the chunk
# with it. Bright Data reports the snapshot `ready` and serves an empty file, so
# there is no error anywhere to read.
#
# HOW HANSEN YUNCKEN WAS PROVEN, 2026-08-11. Its chunk returned 0 records twice,
# including once with nothing else running, so it was not the concurrency fault
# fixed in the workflow the same night. Bisecting the 90-company chunk down to 3
# and then pairing each suspect against a known-good anchor (Beach Energy, which
# returns exactly 1 ad) isolated it:
#
#     [Beach Energy, Data#3]                 -> 33 records  (1 + 32)
#     [Beach Energy, QCoal]                  ->  1 record   (1 + 0, simply quiet)
#     [Beach Energy, Herbert Smith Freehills]-> 29 records  (1 + 28)
#     [Beach Energy, Hansen Yuncken]         ->  0 records  <- anchor destroyed
#
# The anchor surviving in three cases and dying in the fourth is what makes this
# an identification rather than a guess. Note QCoal: it returns nothing for
# itself and harms nothing — a real zero, which the archive should record as
# zero. The two look identical in a chunk log and are completely different.
#
# THE COMPANY STAYS ON THE ROSTER. It keeps its pin, its card and every other
# feed; only this board cannot search it. Dropping a real employer to satisfy a
# scraper would put a hole in the map to tidy up a log.
#
# To re-test one, pair it with the anchor through --input-json and see whether
# the anchor's single ad survives. If Bright Data fixes its end, delete the
# entry — nothing else needs changing.
QUARANTINE: dict[str, dict[str, str]] = {
    'linkedin': {
        'priv-hansen-yuncken': 'zeroes any snapshot it is included in '
                               '(measured 2026-08-11, anchor test above)',
    },
}


def load_companies() -> list[tuple[str, str]]:
    from roster import load_roster
    rows = load_roster()
    SECTOR_BY_ID.update({c['id']: c.get('sector') or '' for c in rows})
    return [(c['id'], c['name']) for c in rows if not ONLY or c['id'] in ONLY]


def drop_quarantined(companies: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Remove this board's batch-destroying companies from an ALREADY-SLICED list.

    DELIBERATELY AFTER SLICING. Filtering before would renumber the roster, so
    --offset 90 would no longer mean the same 90 companies it meant last run and
    the four chunks would quietly stop tiling the roster — a company could fall
    down the gap between two chunks and simply never be collected again.
    """
    banned = QUARANTINE.get(WHICH, {})
    if not banned:
        return companies
    kept = [(cid, name) for cid, name in companies if cid not in banned]
    for cid, name in companies:
        if cid in banned:
            sys.stderr.write(
                f'  SKIPPING {name} ({cid}) on {WHICH}: {banned[cid]}.\n'
                f'    It stays on the roster and in every other feed; this board '
                f'alone cannot search it.\n')
    return kept


# ── Bright Data ───────────────────────────────────────────────────────────────
def bd(method: str, path: str, body=None, params: str = '',
       timeout: int = 120) -> dict | list:
    url = f'{BD_BASE}{path}' + (f'?{params}' if params else '')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': f'Bearer {BD_TOKEN}',
        'Content-Type': 'application/json',
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode('utf-8', 'replace')
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            # 1200, not 300. A validation_error carries an "errors" array that
            # names the offending KEY, and it sits at the END of the body —
            # after the echoed input line. Truncating at 300 cut it off at
            # exactly `"errors":[["key`, which is the one part of the response
            # worth having. Measured 2026-08-10: two runs were spent guessing at
            # a schema Bright Data had already described in a string this
            # function was throwing away.
            detail = e.read().decode('utf-8', 'replace')[:1200]
            # 4xx is a contract problem — a wrong dataset id, a malformed body,
            # an unfunded account. Retrying it just spends time being wrong.
            if 400 <= e.code < 500:
                hint = ''
                # AN ACCOUNT-STATE ERROR IS NOT A REQUEST ERROR, and reading it
                # as one wastes hours. "Customer is not active" arrives as a
                # plain HTTP 400 alongside genuine validation failures, so it
                # looks like a bad payload. On 2026-08-10 it appeared minutes
                # after a LinkedIn probe returned an EMPTY snapshot from an
                # accepted trigger — and that empty result was read as a wrong
                # search shape, which sent the next run chasing a schema bug
                # that did not exist. Nothing about the request can fix this.
                if 'not active' in detail.lower() or 'suspend' in detail.lower():
                    hint = ('\n  THIS IS THE ACCOUNT, NOT THE REQUEST. Bright Data '
                            'is refusing to collect for this customer at all — '
                            'usually billing, a spent allowance or a suspended '
                            'plan. No dataset id, search shape or --input-json '
                            'will change it, and an empty snapshot returned '
                            'around the same time probably means this too rather '
                            'than a query that matched nothing. Check the Bright '
                            'Data dashboard before changing any code here.')
                elif e.code == 400 and 'validation' in detail.lower():
                    hint = ('\n  Bright Data echoes the shape it wanted in "line" '
                            'above. Copy that, edit the values, and pass it back '
                            'with --input-json to test a fix without a code change.')
                if e.code == 404 and 'dataset' in detail.lower():
                    hint = (f'\n  The dataset id ({BD_DATASET}) is not one this '
                            f'endpoint knows. Run:\n'
                            f'    python scripts/brightdata-to-d1.py --list-datasets\n'
                            f'  and set BRIGHTDATA_DATASET_ID to the {WHICH} JOBS '
                            f'scraper id it prints.')
                sys.exit(f'Bright Data {method} {path} -> HTTP {e.code}: {detail}{hint}')
            if attempt == 3:
                sys.exit(f'Bright Data {method} {path} -> HTTP {e.code} after 4 tries: {detail}')
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                sys.exit(f'Bright Data {method} {path} failed after 4 tries: {e}')
        time.sleep(2 ** attempt)
    return {}


def trigger(companies: list[tuple[str, str]]) -> str:
    """Start one discover collection for the whole roster."""
    if INPUT_JSON:
        inputs = json.loads(INPUT_JSON)
        if isinstance(inputs, dict):
            inputs = [inputs]
        sys.stderr.write(f'  using --input-json verbatim ({len(inputs)} input(s))\n')
    else:
        inputs = [CFG['input'](name) for _cid, name in companies]
    params = (f'dataset_id={BD_DATASET}&type=discover_new'
              f'&discover_by={CFG["discover_by"]}'
              f'&format=json&include_errors=true')
    res = bd('POST', '/trigger', inputs, params)
    sid = (res or {}).get('snapshot_id') or (res or {}).get('id')
    if not sid:
        sys.exit(f'No snapshot_id in the trigger response: {str(res)[:300]}')
    return sid


def wait_ready(snapshot_id: str) -> None:
    deadline = time.time() + TIMEOUT_MIN * 60
    last = ''
    while time.time() < deadline:
        res = bd('GET', f'/progress/{snapshot_id}')
        status = (res or {}).get('status', '')
        if status != last:
            sys.stderr.write(f'  snapshot {snapshot_id}: {status}\n')
            last = status
        if status == 'ready':
            return
        if status == 'failed':
            sys.exit(f'Bright Data reports the collection FAILED: {str(res)[:300]}')
        time.sleep(POLL_S)
    sys.exit(f'Snapshot {snapshot_id} not ready after {TIMEOUT_MIN} minutes. '
             f'It may still finish — re-download it with --snapshot {snapshot_id}.')


def download(snapshot_id: str) -> list[dict]:
    res = bd('GET', f'/snapshot/{snapshot_id}', params='format=json')
    if isinstance(res, dict):
        res = res.get('data') or res.get('results') or []
    return [r for r in res if isinstance(r, dict)]


# ── record -> row ─────────────────────────────────────────────────────────────
# Column names differ per board and Bright Data documents them only partially,
# so each field is looked up under several plausible names and its absence is
# REPORTED rather than filled in. A missing salary must stay missing: this
# archive's rule is that a number on a card came from a row.
FIELDS = CFG['fields']


def pick(rec: dict, field: str) -> str:
    for k in FIELDS[field]:
        v = rec.get(k)
        if isinstance(v, dict):
            v = v.get('text') or v.get('value') or ''
        if isinstance(v, list):
            v = ', '.join(str(x) for x in v if x)
        if v not in (None, '', []):
            return str(v).strip()
    return ''


def iso_date(s: str) -> str:
    """A real ISO date or ''. NEVER today's date as a stand-in — an ad dated the
    day we happened to scrape it is a fabricated posting date, and the card
    shows posting dates."""
    s = (s or '').strip()
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return m.group(0)
    try:
        return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).date().isoformat()
    except Exception:  # noqa: BLE001
        return ''


def map_skills(titles: list, sector: str | None = None) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        p = subprocess.run(
            ['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
            input=json.dumps({'titles': titles, 'sector': sector or ''}).encode(),
            capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read().decode())
                if j.get('success'):
                    return j['result']
                raise RuntimeError(str(j.get('errors'))[:200])
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            sys.stderr.write(f'  D1 retry {attempt + 1}: {str(e)[:120]}\n')
            time.sleep(2 ** attempt)


JK_RE = re.compile(r'[?&]jk=([0-9A-Za-z]+)')


def known_urls() -> list[tuple[str, str, str]]:
    """(jk, url, company_id) for postings this source already holds.

    THE ATTRIBUTION IS ALREADY DECIDED, which is the quiet advantage of this
    path over discovery. Every URL here came from a row that was matched to a
    rostered employer when it was first archived, so the refresh carries the
    company_id forward and never re-runs advertiser_matches(). A keyword search
    has to guess which employer an ad belongs to; a re-scrape does not.

    Ordered most-recently-seen first so a --limit smaller than the archive
    spends the budget on the ads most likely to still be up.
    """
    want = LIMIT
    if want > REFRESH_MAX_URLS:
        if LIMIT < 10 ** 9:
            sys.stderr.write(
                f'  --limit {LIMIT} is above the {REFRESH_MAX_URLS}-URL cost guard; '
                f'raise --refresh-max-urls to mean it.\n')
        else:
            sys.stderr.write(
                f'  --limit is unbounded, which for a refresh means every URL in the '
                f'window.\n  Capped at {REFRESH_MAX_URLS} — pass --refresh-max-urls '
                f'to spend more.\n')
        want = REFRESH_MAX_URLS
    res = d1(
        "SELECT url, company_id FROM jobs "
        "WHERE source = ?1 AND url LIKE '%jk=%' AND company_id IS NOT NULL "
        "AND last_seen >= date('now', ?2) "
        "ORDER BY last_seen DESC, first_seen DESC LIMIT ?3",
        [SOURCE, f'-{REFRESH_DAYS} day', want])
    rows = (res[0] if isinstance(res, list) else res).get('results') or []
    out, seen = [], set()
    for r in rows:
        url = (r.get('url') or '').strip()
        m = JK_RE.search(url)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        out.append((m.group(1), url, r['company_id']))
    return out


def scrape_urls(urls: list[str]) -> list[dict]:
    """Collect-by-URL: one /scrape call for a batch of known job pages.

    A DIFFERENT ENDPOINT FROM THE REST OF THIS FILE. Discovery posts to
    /trigger and then polls /progress until a snapshot is ready; /scrape takes
    the URLs directly. That is the whole reason this path is worth having while
    discovery is stalling — it does not go near the machinery that is broken.
    The response has been seen as a plain list of records; a snapshot_id is
    handled too rather than assumed away, because the API is documented only
    partially and a large batch may well be made asynchronous.
    """
    body = {'input': [{'url': u} for u in urls], 'limit_per_input': None}
    params = f'dataset_id={BD_DATASET}&notify=false&include_errors=true'
    # Generous next to bd()'s default: this call does the collecting itself
    # rather than handing back a snapshot to poll for.
    res = bd('POST', '/scrape', body, params, timeout=600)
    if isinstance(res, dict):
        sid = res.get('snapshot_id') or res.get('id')
        if sid:
            sys.stderr.write(f'  /scrape returned snapshot {sid}; polling it\n')
            wait_ready(sid)
            return download(sid)
        # include_errors=true means a per-URL failure arrives as data, not as a
        # non-2xx. Report it rather than counting it as "no ads".
        if res.get('error') or res.get('errors'):
            sys.stderr.write(f'  /scrape error: {str(res)[:300]}\n')
        return []
    return [r for r in res if isinstance(r, dict)]


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['title'] for j in jobs]
    skills = map_skills(titles, SECTOR_BY_ID.get(company_id))
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or company_id
        location = j.get('location') or ''
        key = job_key(SOURCE, j['title'], company, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], company or None, company_id,
                     match_city(location), location, CFG.get('label', SOURCE),
                     j.get('salary') or None, j.get('url') or '', j.get('posted') or '',
                     json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, '
               'salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "salary = COALESCE(jobs.salary, excluded.salary), "
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def refresh() -> int:
    """Re-scrape known URLs and refresh what the archive already holds."""
    known = known_urls()
    if not known:
        sys.stderr.write(
            f'No {SOURCE} rows with a job URL seen in the last {REFRESH_DAYS} days.\n'
            'There is nothing to refresh — this mode cannot find postings the\n'
            'archive has never seen. Discovery is what does that.\n')
        return 1
    sys.stderr.write(
        f'{WHICH} REFRESH via Bright Data -> D1: {len(known)} known URLs, seen in the '
        f'last {REFRESH_DAYS} days, {REFRESH_BATCH} per call, dataset {BD_DATASET}, '
        f'cap {MAX_RECORDS} records{", PROBE (no write)" if PROBE else ""}.\n'
        '  This REFRESHES the archive and cannot grow it; see --refresh in the header.\n')

    by_jk = {jk: cid for jk, _u, cid in known}
    records: list[dict] = []
    for i in range(0, len(known), REFRESH_BATCH):
        batch = known[i:i + REFRESH_BATCH]
        got = scrape_urls([u for _jk, u, _c in batch])
        records.extend(got)
        sys.stderr.write(f'  [{i:>5}-{i + len(batch) - 1:<5}] {len(got):>4} records\n')
        if len(records) >= MAX_RECORDS:
            sys.stderr.write(f'  reached --max-records {MAX_RECORDS}; stopping early.\n')
            break

    if not records:
        sys.stderr.write(
            '\nNo records from any batch. Nothing written.\n'
            '  This is NOT the discovery stall — /scrape is a different endpoint and\n'
            '  does not use snapshots. Check the dataset accepts collect-by-URL, and\n'
            '  that the URLs are still the shape it wants (jk= job pages).\n')
        return 1

    # BACK TO THE EMPLOYER BY jk, not by advertiser name. The row these URLs
    # came from already carries company_id, so a re-scrape does not re-litigate
    # attribution and cannot silently re-file an ad under a different employer.
    by_company: dict[str, list] = {}
    unmatched = 0
    for rec in records:
        title = pick(rec, 'title')
        m = JK_RE.search(pick(rec, 'url') or '')
        cid = by_jk.get(m.group(1)) if m else None
        if not title or not cid:
            unmatched += 1
            continue
        by_company.setdefault(cid, []).append({
            'title': title,
            'company': pick(rec, 'company'),
            'location': pick(rec, 'location'),
            'url': pick(rec, 'url'),
            'posted': iso_date(pick(rec, 'posted')),
            'salary': pick(rec, 'salary') or None,
        })

    kept = sum(len(v) for v in by_company.values())
    sys.stderr.write(
        f'\n  {kept} ads refreshed across {len(by_company)} employers; '
        f'{unmatched} records carried no title or no matching jk.\n'
        f'  {len(known) - kept} of the {len(known)} URLs asked for returned nothing — '
        f'those ads are most likely down,\n  and they are left alone to age out '
        f'rather than being marked live.\n')
    if PROBE:
        for cid, jobs in sorted(by_company.items())[:10]:
            j = jobs[0]
            sys.stderr.write(f'    {cid:24} {len(jobs):3} | {j["title"][:44]:44} | '
                             f'{j["location"][:22]:22} | {j["posted"] or "-":10}\n')
        sys.stderr.write('\nPROBE: nothing written.\n')
        return 0
    if not kept:
        return 1

    total = 0
    for cid, jobs in sorted(by_company.items()):
        total += upsert(cid, jobs)
    sys.stderr.write(f'\n{total} rows upserted to D1 as {SOURCE} (refresh).\n')
    return 0


def main() -> int:
    # --offset SLICES THE ROSTER SO A SWEEP CAN BE SPLIT ACROSS RUNS.
    #
    # Measured on 2026-08-10: 20 companies took 28m41s, and 3 and 6 companies
    # took 2m23s and 9m47s — about 1.4 min per company once past the small
    # cases. The roster is 354, so one sweep is ~8.5 HOURS and a GitHub hosted
    # runner is capped at 6. A whole-roster run in one job cannot finish.
    #
    # Worse, it fails to nothing: the snapshot is downloaded only once Bright
    # Data reports it ready, so a timeout means the records were collected and
    # BILLED but no row reaches D1. Chunking is what makes full coverage
    # affordable to actually land.
    if REFRESH:
        return refresh() or 0

    all_companies = load_companies()
    companies = drop_quarantined(all_companies[OFFSET:OFFSET + LIMIT])
    if not companies:
        sys.exit(f'No companies in slice [{OFFSET}:{OFFSET + LIMIT}] of '
                 f'{len(all_companies)} — check --offset/--limit/--only.')
    # The span is the SLICE asked for, not the count left after quarantine —
    # those differ once a company is dropped, and labelling the slice by its
    # surviving length prints a range that never existed (a 267..269 slice with
    # 268 quarantined reported itself as "267-268").
    span_end = min(OFFSET + LIMIT, len(all_companies)) - 1
    span = (f'{OFFSET}-{span_end} of {len(all_companies)}'
            if OFFSET or len(companies) < len(all_companies) else 'whole roster')
    sys.stderr.write(
        f'{WHICH} via Bright Data -> D1: {len(companies)} companies [{span}], '
        f'location="{LOCATION}", dataset {BD_DATASET}, cap {MAX_RECORDS} records'
        f'{", PROBE (no write)" if PROBE else ""}.\n')

    snap = _opt('--snapshot')
    if not snap:
        snap = trigger(companies)
        sys.stderr.write(f'  triggered snapshot {snap}\n')
    wait_ready(snap)
    records = download(snap)
    sys.stderr.write(f'  {len(records)} records returned.\n')
    if not records:
        first, last = companies[0][1], companies[-1][1]
        sys.stderr.write(
            'No records at all — that is a collection failure, not a quiet job '
            'market. Nothing written.\n\n'
            '  TWO CAUSES HAVE DONE THIS, and they need opposite responses.\n\n'
            '  1. Another snapshot was open on the account. Measured 2026-08-11:\n'
            '     three chunks triggered together returned 0, 0 and 870 records,\n'
            '     and a slice that returned 0 alongside them returned 1,908 when\n'
            '     re-run by itself. If anything else was collecting, just re-run\n'
            '     this chunk on its own before believing the data is at fault.\n\n'
            '  2. One company in the batch zeroes the whole snapshot. Bisect this\n'
            '     slice by halving --limit, then confirm the single suspect by\n'
            '     pairing it with a company known to return ads:\n\n'
            '       --probe --input-json \'[{"company":"Beach Energy","location":'
            '"Australia","country":"AU","keyword":""},\n'
            '                              {"company":"<SUSPECT>","location":'
            '"Australia","country":"AU","keyword":""}]\'\n\n'
            '     Beach Energy returns exactly 1 ad. If that 1 survives, the\n'
            '     suspect is merely quiet and is not the cause; if the pair\n'
            '     returns 0, the suspect destroyed the batch — add it to\n'
            '     QUARANTINE with the measurement. Do NOT drop it from the\n'
            '     roster: it belongs on the map either way.\n\n'
            f'  This slice was [{OFFSET}:{OFFSET + LIMIT}], {len(companies)} '
            f'companies, {first} .. {last}.\n')
        return 1

    # WHICH FIELDS ACTUALLY ARRIVED. Bright Data documents six and the card
    # needs eight; this is the table that says whether the other two exist,
    # rather than a hopeful mapping that silently yields empty columns.
    coverage = {f: sum(1 for r in records if pick(r, f)) for f in FIELDS}
    # PRESENT-BUT-EMPTY IS A DIFFERENT FAULT FROM ABSENT, and the two demand
    # opposite fixes. A key the dataset never returns means the mapping is
    # wrong; a key it returns as null on every record means the advertisers did
    # not post that value and no mapping change will conjure it. Counting only
    # non-empty values cannot tell them apart, so the key presence is counted
    # separately — salary read 0/50 on the first Indeed probe and the coverage
    # table alone could not say which of the two had happened.
    present = {f: sum(1 for r in records if any(k in r for k in FIELDS[f]))
               for f in FIELDS}
    sys.stderr.write('\n  field coverage across the returned records:\n')
    for f, n in sorted(coverage.items(), key=lambda kv: -kv[1]):
        pct = 100.0 * n / len(records)
        if n:
            note = ''
        elif present[f]:
            note = f'   <- key returned on {present[f]}, always empty (not posted)'
        else:
            note = '   <- KEY ABSENT: mapping is wrong'
        sys.stderr.write(f'    {f:10} {n:6}/{len(records)}  {pct:5.1f}%{note}\n')

    # Any key the payload carries that looks like pay and we are NOT reading.
    # This is how a renamed field gets caught instead of silently emptying a
    # column the company card displays.
    known = {k for ks in FIELDS.values() for k in ks}
    seen: dict[str, int] = {}
    for r in records:
        for k, v in r.items():
            if k in known or v in (None, '', [], {}):
                continue
            if re.search(r'salary|pay|wage|compensation|remuneration', k, re.I):
                seen[k] = seen.get(k, 0) + 1
    if seen:
        sys.stderr.write('\n  pay-like keys present in the payload but NOT mapped:\n')
        for k, n in sorted(seen.items(), key=lambda kv: -kv[1]):
            ex = next((str(r[k])[:60] for r in records if r.get(k)), '')
            sys.stderr.write(f'    {k:28} {n:4}/{len(records)}  e.g. {ex}\n')
    if not coverage['title']:
        sys.stderr.write('\nNo record carried a title under any known key. The response '
                         'shape is not what this parser expects — print a record and fix '
                         'FIELDS before trusting anything else here.\n')
        sys.stderr.write(f'  first record keys: {sorted(records[0].keys())}\n')
        return 1

    if len(records) > MAX_RECORDS:
        sys.stderr.write(f'\n  {len(records)} records exceeds --max-records {MAX_RECORDS}; '
                         f'keeping the first {MAX_RECORDS}. Raise the cap deliberately.\n')
        records = records[:MAX_RECORDS]

    # THE SAME ATTRIBUTION GATE THE OTHER KEYWORD FEEDS USE. A keyword search
    # returns anything mentioning the name, so every record is tested against
    # the roster name before it is filed under that employer.
    by_company: dict[str, list] = {}
    unmatched = 0
    # WHO GOT DROPPED. "N dropped as another advertiser" is the right default —
    # a keyword search really does return other employers — but it cannot
    # distinguish "correctly rejected a recruiter" from "our roster spells this
    # employer's name the way it was spelled before a merger". Counting the
    # rejected names makes that answerable from the log instead of from a
    # separate investigation; 2026-08-11 it is how Herbert Smith Freehills was
    # found losing all 28 of its ads.
    dropped_names: dict[str, int] = {}
    for rec in records:
        title = pick(rec, 'title')
        if not title:
            continue
        advertiser = pick(rec, 'company')
        hit = next((cid for cid, name in companies
                    if advertiser and advertiser_matches(advertiser, name)), None)
        if not hit:
            unmatched += 1
            if advertiser:
                dropped_names[advertiser] = dropped_names.get(advertiser, 0) + 1
            continue
        by_company.setdefault(hit, []).append({
            'title': title,
            'company': advertiser,
            'location': pick(rec, 'location'),
            'url': pick(rec, 'url'),
            'posted': iso_date(pick(rec, 'posted')),
            'salary': pick(rec, 'salary') or None,
        })

    kept = sum(len(v) for v in by_company.values())
    sys.stderr.write(f'\n  {kept} ads kept for {len(by_company)} employers; '
                     f'{unmatched} dropped as another advertiser.\n')
    # Only the heavy hitters, and only when the drop rate is high enough to be
    # worth a look. A healthy run drops a long tail of one-off recruiters, and
    # printing those every night would train everyone to skim past this.
    if unmatched and unmatched >= max(5, kept // 4):
        top = sorted(dropped_names.items(), key=lambda kv: -kv[1])[:8]
        sys.stderr.write(
            '    most-dropped advertisers (a searched employer appearing here '
            'means the roster\n    spells its name differently, not that it is '
            'someone else):\n')
        for name, n in top:
            sys.stderr.write(f'      {n:5}  {name[:66]}\n')
    if PROBE:
        for cid, jobs in sorted(by_company.items())[:10]:
            j = jobs[0]
            sys.stderr.write(f'    {cid:24} {len(jobs):3} | {j["title"][:44]:44} | '
                             f'{j["location"][:22]:22} | {j["posted"] or "-":10} | '
                             f'{j["salary"] or "-"}\n')
        sys.stderr.write('\nPROBE: nothing written. Read the coverage table above — in '
                         'particular whether posted and salary arrived, since the card '
                         'shows both — then re-run without --probe.\n')
        return 0
    if not kept:
        sys.stderr.write('Records came back but none matched a rostered employer. That is '
                         'the keyword or the gate, not the market. Nothing written.\n')
        return 1

    total = 0
    for cid, jobs in sorted(by_company.items()):
        n = upsert(cid, jobs)
        total += n
        sys.stderr.write(f'  {cid:24} {n:3} rows\n')
    sys.stderr.write(f'\n{total} rows upserted to D1 as {SOURCE}.\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
