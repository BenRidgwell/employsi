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
BD_DATASET = os.environ.get('BRIGHTDATA_DATASET_ID', '')
BD_BASE = 'https://api.brightdata.com/datasets/v3'

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
        'dataset': None,
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
        # Supplied by the operator 2026-08-09. NOT verified from here, and worth
        # confirming with --list-datasets before a paid run: every dataset id in
        # Bright Data's own documentation is `gd_`-prefixed and this one is
        # `sd_`. It may simply be a newer prefix — but "the id looked plausible"
        # is exactly the reasoning this field exists to avoid.
        'dataset': 'sd_msmsowmy2q27hoajjt',
        'discover_by': 'keyword',
        # `company:"Name"` is Indeed's own advertiser filter — the same query
        # scripts/indeed-to-d1.py builds in ind.search_url(). Plain keyword
        # search returns every ad that merely mentions the name.
        'input': lambda name: {'keyword': f'company:"{name}"',
                               'location': LOCATION, 'country': 'AU'},
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
LIMIT = int(_opt('--limit', 10 ** 9))
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

if not BD_TOKEN:
    sys.exit('BRIGHTDATA_API_TOKEN is required.')

if LIST_DATASETS:
    # GET /datasets/list returns every scraper id on the account. This is here
    # because the alternative to knowing the id is guessing it, and a wrong id
    # collects the wrong thing and bills for it.
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
    _hits = [d for d in _rows if isinstance(d, dict)]
    print(f'{len(_hits)} scrapers on this account:\n')
    for _d in sorted(_hits, key=lambda x: str(x.get('name', ''))):
        _name = str(_d.get('name', ''))
        _low = _name.lower()
        _mark = ('  <- ' + _w for _w in ('linkedin', 'indeed') if _w in _low)
        _mark = next(_mark, '')
        print(f"  {str(_d.get('id', '')):28} {_name[:60]}{_mark}")
    print('\nUse the JOBS scraper for a board — not profiles, not companies. '
          'Set BRIGHTDATA_DATASET_ID, or add it to SOURCES in this file.')
    raise SystemExit(0)

if WHICH not in SOURCES:
    sys.exit(f'--source must be one of: {", ".join(sorted(SOURCES))}')
CFG = SOURCES[WHICH]
SOURCE = CFG['source']
# The env var wins, so a dashboard change needs no commit.
BD_DATASET = BD_DATASET or CFG['dataset'] or ''
if not BD_DATASET:
    sys.exit(f'No dataset id for --source {WHICH}. Set BRIGHTDATA_DATASET_ID to the '
             f'scraper id from your Bright Data dashboard — run --list-datasets to '
             f'see them. It is deliberately not defaulted for this source: a wrong '
             f'id collects the wrong thing and bills you for it.')
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
            detail = e.read().decode('utf-8', 'replace')[:300]
            # 4xx is a contract problem — a wrong dataset id, a malformed body,
            # an unfunded account. Retrying it just spends time being wrong.
            if 400 <= e.code < 500:
                sys.exit(f'Bright Data {method} {path} -> HTTP {e.code}: {detail}')
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
    companies = load_companies()[:LIMIT]
    if not companies:
        sys.exit('No companies matched — check --only.')
    sys.stderr.write(
        f'{WHICH} via Bright Data -> D1: {len(companies)} companies, '
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
    sys.stderr.write('\n  field coverage across the returned records:\n')
    for f, n in sorted(coverage.items(), key=lambda kv: -kv[1]):
        pct = 100.0 * n / len(records)
        sys.stderr.write(f'    {f:10} {n:6}/{len(records)}  {pct:5.1f}%'
                         + ('   <- MISSING' if not n else '') + '\n')
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
