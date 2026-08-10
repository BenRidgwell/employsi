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
Run: python scripts/brightdata-to-d1.py --list-datasets
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
        # "Linkedin job listings information" — read off the account with
        # --list-datasets on 2026-08-10. Chosen from five LinkedIn datasets that
        # mention jobs because it is the exact analogue of the Indeed scraper
        # already working here ("Indeed job listings information"); the others
        # are `Linkedin jobs count` (counts, not postings), `Linkedin Company
        # with Jobs`, `LinkedIn profiles Jobs Listings` (profile-oriented) and
        # `Linkedin Jobs listing`. A dataset id is an identifier, not a
        # credential, so it belongs in the repo where it can be reviewed.
        'dataset': 'gd_lpfll7v5hcqtkxl6l',
        'discover_by': 'keyword',
        'input': lambda name: {'keyword': name, 'location': LOCATION},
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


def load_companies() -> list[tuple[str, str]]:
    from roster import load_roster
    rows = load_roster()
    SECTOR_BY_ID.update({c['id']: c.get('sector') or '' for c in rows})
    return [(c['id'], c['name']) for c in rows if not ONLY or c['id'] in ONLY]


# ── Bright Data ───────────────────────────────────────────────────────────────
def bd(method: str, path: str, body=None, params: str = '') -> dict | list:
    url = f'{BD_BASE}{path}' + (f'?{params}' if params else '')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': f'Bearer {BD_TOKEN}',
        'Content-Type': 'application/json',
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
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
                if e.code == 400 and 'validation' in detail.lower():
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
                     match_city(location), location, 'LinkedIn',
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
    all_companies = load_companies()
    companies = all_companies[OFFSET:OFFSET + LIMIT]
    if not companies:
        sys.exit(f'No companies in slice [{OFFSET}:{OFFSET + LIMIT}] of '
                 f'{len(all_companies)} — check --offset/--limit/--only.')
    span = (f'{OFFSET}-{OFFSET + len(companies) - 1} of {len(all_companies)}'
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
        sys.stderr.write('No records at all — that is a collection failure, not a '
                         'quiet job market. Nothing written.\n')
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
    for rec in records:
        title = pick(rec, 'title')
        if not title:
            continue
        advertiser = pick(rec, 'company')
        hit = next((cid for cid, name in companies
                    if advertiser and advertiser_matches(advertiser, name)), None)
        if not hit:
            unmatched += 1
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
