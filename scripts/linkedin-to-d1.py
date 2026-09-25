#!/usr/bin/env python3
"""
Scrape each company's LinkedIn jobs (via LinkedIn's guest jobs-search endpoint)
and archive them to the D1 jobs table, deduped — the LinkedIn counterpart of
scripts/indeed-to-d1.py and scripts/zhaopin-to-d1.py.

LinkedIn hard-blocks datacenter IPs, so this runs through the Oxylabs Web Scraper
API (residential IP + rendering server-side). Set OXYLABS_USERNAME /
OXYLABS_PASSWORD and it needs no browser at all — so it runs anywhere (GitHub
Actions, a Worker, your PC). Skills are mapped via the worker's own taxonomy
(scripts/map-skills.ts) for parity, any role already archived for that company by
another source is dropped (no cross-source duplicates), and rows are upserted
through the D1 HTTP API with the same source|title|company|location key + upsert
as src/employsi/lib/jobArchive.ts.

Transports:
  (default)  Oxylabs Web Scraper API. 401 on the account since 2026-08-28.
  --direct   the same guest endpoint fetched straight from whatever address
             runs it — no proxy, no credential, no per-record bill — by
             company id where scripts/linkedin_company_ids.json has one. See
             the block above guest_get() for what was measured.

Env:  OXYLABS_USERNAME, OXYLABS_PASSWORD  (residential fetch; not for --direct)
      CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run:  python scripts/linkedin-to-d1.py [--location Australia] [--only id1,id2]
                                       [--limit N] [--max-pages N] [--concurrency N]
                                       [--direct [--id-cap N] [--keyword-cap N]] [--solve]
"""
from __future__ import annotations
import json, os, re, subprocess, sys, threading, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'linkedin-company-scraper'))
sys.path.insert(0, HERE)  # oxylabs_client
try:
    import linkedin_company_scraper as li  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}).')

import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

# One advertiser test across every keyword-driven feed — see
# scripts/advertiser_match.py for why the rule is shaped the way it is.
sys.path.insert(0, HERE)
from advertiser_match import advertiser_matches  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney', 'canberra']

args = sys.argv[1:]

def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default

LOCATION = _opt('--location', 'Australia')
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 10))     # guest API returns 25 cards/page
VIA_DIRECT = '--direct' in args
# Oxylabs: keep ≤ your plan's limit. Direct: 5 is the measured shape (run #37)
# and is NOT a plan limit — every worker is another stream of requests from
# the same address, which is what LinkedIn rate-limits.
CONCURRENCY = int(_opt('--concurrency', 5 if VIA_DIRECT else 8))
# Cards per company. An id search holds only that employer's ads, so its cap
# is the endpoint's own (start < 1000). A keyword search is mostly OTHER
# advertisers, so walking it deep buys noise at ~4s a page.
DIRECT_ID_CAP = int(_opt('--id-cap', 1000))
DIRECT_KEYWORD_CAP = int(_opt('--keyword-cap', 100))
# Retry on the suffix-stripped name when the full name keeps fewer than this.
RETRY_BELOW = int(_opt('--retry-below', 10))
# Job pages opened per company to read the advertised pay the search fragment
# omits. One fetch per NEW listing, so a quiet day costs almost nothing; the cap
# stops a company that suddenly posts 200 roles from blowing the run's budget.
SALARY_BUDGET = int(_opt('--salary-budget', 40))
NO_SKILLS = '--no-skills' in args
# --solve: reachability check only (no D1 write, no token needed).
SOLVE = '--solve' in args

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
             '(Not needed with --solve, which skips the D1 write.)')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
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


# ── company roster (id + name) via scripts/roster.py ──────────────────────────
# id → sector, so upsert() can tell the taxonomy which industry a title belongs
# to. Filled by load_companies() from the UNFILTERED roster.
SECTOR_BY_ID: dict[str, str] = {}


def load_companies() -> list[tuple[str, str]]:
    """The FULL roster — listed plus the Top-150 private — via scripts/roster.py.

    This used to regex auJobsTargets.ts, which meant it walked 205 companies and
    silently skipped the 150 private ones: that roster is built at module load
    (`RAW.map(buildPrivate)`), so its ids and names are not in the source text.
    roster.py runs the TypeScript instead, and raises rather than falling back —
    a short roster that looks like a successful run is the bug being fixed."""
    from roster import load_roster
    rows = load_roster()
    # Sectors come off the UNFILTERED roster so the map is complete no matter
    # what --only narrows the walk to.
    SECTOR_BY_ID.update({c['id']: c.get('sector') or '' for c in rows})
    return [(c['id'], c['name']) for c in rows if not ONLY or c['id'] in ONLY]


# ── skills parity via the worker's own taxonomy (offline bun helper) ──────────
def map_skills(titles: list, sector: str | None = None) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    # The object form is only sent when a sector is known; map-skills.ts accepts
    # a bare array too, so an unknown sector keeps the ungated behaviour.
    payload = {'titles': titles, 'sector': sector} if sector else titles
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(payload).encode(), capture_output=True, timeout=120)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:160]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── D1 HTTP API ───────────────────────────────────────────────────────────────
def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                j = json.loads(r.read().decode())
                if j.get('success'):
                    return j['result']
                raise RuntimeError(str(j.get('errors')))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def enrich_salaries(jobs: list, oxy, geo: str) -> int:
    """Fill in each new job's advertised pay from its LinkedIn job page.

    The guest search fragment carries no pay whatsoever (see
    salary_from_detail), so without this the source is permanently 0% salary —
    which is what the archive showed for all 777 rows.

    Only jobs that are NEW to the archive are enriched, so the cost is one extra
    Oxylabs fetch per genuinely-new listing rather than per listing seen, and
    --salary-budget caps it regardless. Set --salary-budget 0 to skip entirely.
    """
    if SALARY_BUDGET <= 0 or not jobs:
        return 0
    todo = [j for j in jobs if j.get('url')][:SALARY_BUDGET]
    priced = 0
    for j in todo:
        try:
            body, _ = oxy.fetch(j['url'], geo=geo, render=False)
        except Exception:  # noqa: BLE001 — one bad page must not fail the company
            continue
        sal = li.salary_from_detail(body or '')
        if sal:
            j['salary'] = sal
            priced += 1
    return priced


# ── the direct transport (LinkedIn's guest jobs-search API, no proxy) ────────
# WHY THIS REPLACES BRIGHT DATA. LinkedIn has been collected by
# brightdata-archive.yml since 2026-08-29: per-record billing, so fortnightly.
# This reads the same guest endpoint this file's Oxylabs path reads, directly
# from whatever address runs it, and parses it with the same
# parse_search_html().
#
# MEASURED FROM A HOSTED RUNNER 2026-09-24 (linkedin-archive run #37, through
# JobSpy): all 395 companies answered in 75.5 min, no 429, no authwall. The
# sandbox, by contrast, was throttled after ~30 companies in one session. So
# the address question is answered for a runner, and the walk still treats a
# refusal as a failure rather than as an employer with no jobs.
#
# WHY NOT JOBSPY, which is what that run used. Its LinkedIn pager advances
# `start` by the running TOTAL of cards instead of the page size — 0, 10, 30,
# 60 … — so it skips a page more each time. Measured 2026-09-24: f_C=4509
# walked by hand in steps of 10 holds 91 BHP ads; JobSpy returned 40. Anything
# past the second page was being undercounted, which is every large employer.
# It also rebuilds the location from parts and blanks any it cannot split —
# "Greater Melbourne Area" came back '' — which gives a different job_key from
# the row Bright Data wrote for the same ad: 173 of the 2,890 matching titles
# on run #37. parse_search_html() keeps the location as the card prints it.
#
# BY COMPANY ID WHERE WE HAVE ONE. `f_C=<id>` returns only that company page's
# ads; scripts/linkedin_company_ids.json holds the ids, each confirmed by
# scripts/resolve-linkedin-company-ids.py. The keyword search is the fallback
# for companies not resolved yet, and it is what run #37 measured: 40,691 cards
# thrown away as another advertiser against 4,088 kept.
IDS_FILE = os.path.join(HERE, 'linkedin_company_ids.json')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
GUEST_PAGE = 10          # cards per guest page when fetched directly (measured)
GUEST_MAX_START = 1000   # the endpoint returns nothing past this


def load_company_ids() -> dict:
    try:
        with open(IDS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


class Blocked(Exception):
    """LinkedIn or the network refused a page after retries."""


def guest_get(params: dict) -> str:
    """One guest search page. 429/999/5xx and network errors back off and
    retry; still failing raises Blocked — never returns '' for a refusal,
    because '' is how the walk recognises the real end of a list."""
    from urllib.parse import urlencode
    url = f'{li.GUEST_SEARCH}?{urlencode(params)}'
    last = ''
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}'
        except Exception as e:  # noqa: BLE001
            last = f'{type(e).__name__}: {e}'[:120]
        time.sleep(10 * 2 ** attempt)
    raise Blocked(last)


def guest_walk(params: dict, cap: int) -> list:
    """Every card for one search, paged in steps of what the page returned.

    THE END OF A LIST IS A SHORT PAGE, and a refusal is not one. A page of
    fewer than GUEST_PAGE cards ends the walk; an EMPTY page after a full one
    is checked once more before it is believed, because careerSites.ts's
    pagedParallel has twice truncated a portal by trusting a single empty.
    Refusals raise Blocked out of guest_get and are never read as an end."""
    import random
    jobs, urls, start, empties = [], set(), 0, 0
    while start < GUEST_MAX_START and len(jobs) < cap:
        html = guest_get({**params, 'start': start})
        n = len(set(re.findall(r'jobPosting:(\d+)', html)))
        if n == 0:
            empties += 1
            if start == 0 or empties >= 2:
                break
            start += GUEST_PAGE
            time.sleep(random.uniform(3, 6))
            continue
        empties = 0
        for j in li.parse_search_html(html):
            if j.get('url') and j['url'] in urls:
                continue
            urls.add(j.get('url'))
            jobs.append(j)
        if n < GUEST_PAGE:
            break
        start += n
        time.sleep(random.uniform(3, 6))
    return jobs[:cap]


def direct_collect(cid: str, name: str, ids: dict) -> tuple[list, int, str, str]:
    """(jobs, dropped, error, mode) for one company.

    mode is 'id' or 'keyword'. error non-empty means the walk was cut short;
    `jobs` then holds what arrived before it, which is real and still written."""
    from company_alias import short_name, fallback_safe
    entry = ids.get(cid)
    page = (entry or {}).get('page', '')

    def ours(board: str) -> bool:
        # A blank advertiser is dropped even on an id search: upsert() would
        # file it under the walked company on the strength of nothing.
        if not board:
            return False
        if page and norm(board) == norm(page):
            return True
        return advertiser_matches(board, name) or bool(page and advertiser_matches(board, page))

    def gate(cards):
        kept = [j for j in cards if (j.get('title') or '').strip() and ours(j.get('company', ''))]
        return kept, len(cards) - len(kept)

    try:
        if entry and entry.get('ids'):
            cards = guest_walk({'location': LOCATION,
                                'f_C': ','.join(str(i) for i in entry['ids'])}, DIRECT_ID_CAP)
            jobs, dropped = gate(cards)
            return jobs, dropped, '', 'id'
        jobs, dropped = gate(guest_walk({'keywords': f'"{name}"', 'location': LOCATION},
                                        DIRECT_KEYWORD_CAP))
        # "Woodside Energy" quoted: 100 cards, 1 of them Woodside's (2026-09-24).
        # Retry on the suffix-stripped name when the result is thin, with the
        # Indeed walk's FALLBACK_UNSAFE exclusions. Merged by URL.
        short = short_name(name)
        if len(jobs) < RETRY_BELOW and short and short != norm(name) and fallback_safe(name):
            more, more_dropped = gate(guest_walk({'keywords': f'"{short}"', 'location': LOCATION},
                                                 DIRECT_KEYWORD_CAP))
            have = {j.get('url') for j in jobs}
            jobs += [j for j in more if j.get('url') not in have]
            dropped += more_dropped
        return jobs, dropped, '', 'keyword'
    except Blocked as e:
        return [], 0, str(e), 'id' if entry else 'keyword'


def key_continuity(cid: str, jobs: list) -> tuple[int, int, list]:
    """(same key, same title different key, examples) against the archive's
    existing LinkedIn rows for this company.

    Switching transport under the same `source` only refreshes history if the
    new rows produce the SAME job_key as Bright Data's. A title that matches
    while the key does not means the location or advertiser is formatted
    differently — and every such role would be counted twice until the old row
    ages out. This measures that before anything is written."""
    r = d1("SELECT title, company, location FROM jobs WHERE company_id = ? "
           "AND source = 'linkedin' AND last_seen >= date('now','-45 day')", [cid])
    rows = r[0]['results'] if r else []
    keys = {job_key('linkedin', x['title'] or '', x['company'] or cid,
                    x['location'] or '') for x in rows}
    by_title = {norm(x['title'] or ''): x for x in rows}
    same = drift = 0
    examples = []
    for j in jobs:
        if job_key('linkedin', j['title'], j.get('company') or cid,
                   j.get('location') or '') in keys:
            same += 1
        elif norm(j['title']) in by_title:
            drift += 1
            old = by_title[norm(j['title'])]
            if len(examples) < 2:
                examples.append(f'{j.get("company")!r}/{j.get("location")!r} vs '
                                f'archived {old["company"]!r}/{old["location"]!r}')
    return same, drift, examples


def main_direct() -> int:
    from concurrent.futures import ThreadPoolExecutor

    ids = load_company_ids()
    companies = load_companies()
    sel = companies[:LIMIT] if LIMIT < len(companies) else companies
    with_id = sum(1 for cid, _ in sel if ids.get(cid, {}).get('ids'))
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'LinkedIn -> D1'
    sys.stderr.write(f'{mode}: {len(sel)} company(ies) via the guest API directly '
                     f'(location="{LOCATION}", concurrency={CONCURRENCY}) — no proxy. '
                     f'{with_id} searched by company id, {len(sel) - with_id} by keyword.\n')
    if SOLVE and TOKEN:
        sys.stderr.write('  CLOUDFLARE_API_TOKEN is set, so each company also reports '
                         'job_key continuity with the archived LinkedIn rows (read-only).\n')
    lock = threading.Lock()
    st = {'fetch': 0, 'new': 0, 'empty': 0, 'done': 0, 'dropped': 0, 'blocked': 0,
          'same': 0, 'drift': 0, 'id_jobs': 0, 'kw_jobs': 0, 'capped': 0}
    blocked_log: list[str] = []
    t0 = time.time()

    def work(cid, name):
        t = time.time()
        jobs, dropped, err, how = direct_collect(cid, name, ids)
        secs = time.time() - t
        cont = ''
        if SOLVE:
            if TOKEN and jobs:
                same, drift, ex = key_continuity(cid, jobs)
                cont = f' · {same} same key, {drift} title-only' + (
                    f' e.g. {ex[0]}' if ex else '')
                with lock:
                    st['same'] += same; st['drift'] += drift
            written, fresh_n = 0, len(jobs)
        elif jobs:
            have = existing_titles(cid)
            fresh = [j for j in jobs if norm(j['title']) not in have]
            written = upsert(cid, fresh) if fresh else 0
            fresh_n = len(fresh)
        else:
            written, fresh_n = 0, 0
        cap = DIRECT_ID_CAP if how == 'id' else DIRECT_KEYWORD_CAP
        with lock:
            st['fetch'] += len(jobs); st['new'] += written; st['done'] += 1
            st['dropped'] += dropped; st['empty'] += not jobs
            st['id_jobs' if how == 'id' else 'kw_jobs'] += len(jobs)
            st['capped'] += len(jobs) >= cap
            if err:
                st['blocked'] += 1
                blocked_log.append(f'{cid}: {err}')
        tail = ('' if SOLVE else
                f' · {written:3} upserted ({len(jobs) - fresh_n} only on another board)')
        flag = f' · BLOCKED: {err}' if err else ''
        sys.stderr.write(f'  {cid:16} {how:7} {len(jobs):3} kept, {dropped:3} other advertisers'
                         f'{tail}{cont} · {secs:.0f}s{flag}\n')

    with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as ex:
        list(ex.map(lambda cn: work(*cn), sel))

    mins = (time.time() - t0) / 60
    sys.stderr.write(f'\nDone (direct, {mins:.1f} min). {st["done"]} companies, '
                     f'{st["fetch"]} listings kept ({st["id_jobs"]} by id, {st["kw_jobs"]} by '
                     f'keyword), {st["dropped"]} dropped as another advertiser, {st["empty"]} '
                     f'with 0 kept, {st["capped"]} at the per-company cap, {st["blocked"]} cut '
                     f'short by LinkedIn or the network.\n')
    if SOLVE:
        sys.stderr.write('Nothing written (--solve).\n')
        if TOKEN:
            sys.stderr.write(
                f'Key continuity vs archived LinkedIn rows: {st["same"]} same job_key, '
                f'{st["drift"]} same title under a DIFFERENT key. The second number is '
                f'what a switch would double-count until the old rows age out.\n')
    else:
        sys.stderr.write(f'{st["new"]} rows upserted.\n')
    for line in blocked_log[:20]:
        sys.stderr.write(f'  blocked  {line}\n')

    # Same wipeout rule as the Oxylabs path below: not ONE listing across the
    # roster is the transport, never the labour market.
    if sel and not st['fetch']:
        sys.stderr.write(f'\nFAILED: {len(sel)} companies walked and not one listing kept. '
                         f'That is LinkedIn refusing this address (see the BLOCKED lines) '
                         f'or parse_search_html() no longer matching the page.\n')
        return 2
    # A BLOCK IS NOT A QUIET EMPLOYER. One stray refusal in a 395-company walk
    # is noise; a tenth of the roster cut short is LinkedIn throttling this
    # address, and the run must say so rather than write a thin archive green.
    if st['blocked'] * 10 >= len(sel):
        sys.stderr.write(f'\nFAILED: {st["blocked"]} of {len(sel)} companies were cut short '
                         f'by LinkedIn or the network. Lower --concurrency before trusting '
                         f'a schedule to this.\n')
        return 3
    return 0


def existing_titles(company_id: str) -> set:
    """Titles to SKIP: held by another source and not already by LinkedIn.

    A LinkedIn job that would only duplicate an Adzuna/SEEK/Indeed role is not
    added, but every title LinkedIn already holds for this company re-upserts
    and refreshes its last_seen, keeping still-live roles "current".

    The second half is what the query used to miss. It read titles from other
    sources only, so a title held by BOTH LinkedIn and, say, SEEK was skipped
    too — and LinkedIn's own row for it was never refreshed. Measured on the
    first direct write, 2026-09-25 (linkedin-archive run #39): 10,030 listings
    kept, 9,402 skipped as "already archived elsewhere", 622 written, while the
    solve the day before had found 6,846 of those listings already archived
    under LinkedIn's own job_key. Those rows would have aged out of "currently
    advertised" while LinkedIn was still carrying the ad."""
    r = d1("SELECT DISTINCT title, source = 'linkedin' AS own FROM jobs WHERE company_id = ?",
           [company_id])
    rows = r[0]['results'] if r else []
    other = {norm(str(x.get('title') or '')) for x in rows if not x.get('own')}
    ours = {norm(str(x.get('title') or '')) for x in rows if x.get('own')}
    return other - ours


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['title'] for j in jobs]
    # The employer's industry rides along so seniority words in a title
    # are read correctly (see INDUSTRY_GATED in skillsTaxonomy.ts).
    skills = map_skills(titles, SECTOR_BY_ID.get(company_id))
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or company_id
        location = j.get('location') or ''
        key = job_key('linkedin', j['title'], company or company_id, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'linkedin', j['title'], company or None, company_id,
                     match_city(location), location, 'LinkedIn',
                     j.get('salary') or None, j.get('url') or '', j.get('date') or '',
                     json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params/query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = (f'INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "salary = COALESCE(jobs.salary, excluded.salary), "
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])  # first_seen, last_seen
        d1(sql, params)
        written += len(chunk)
    return written


def main() -> int:
    if VIA_DIRECT:
        return main_direct()
    if not os.environ.get('OXYLABS_USERNAME'):
        sys.exit('LinkedIn blocks datacenter IPs — set OXYLABS_USERNAME/OXYLABS_PASSWORD '
                 'to fetch via the Oxylabs Web Scraper API.')
    import oxylabs_client as oxy
    from concurrent.futures import ThreadPoolExecutor

    companies = load_companies()
    sel = companies[:LIMIT] if LIMIT < len(companies) else companies
    geo = li.GEO_FOR.get(LOCATION, LOCATION)
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'LinkedIn -> D1'
    sys.stderr.write(f'{mode}: {len(sel)} company(ies) via Oxylabs '
                     f'(location="{LOCATION}", geo={geo}, concurrency={CONCURRENCY}) — no browser.\n')
    lock = threading.Lock()
    st = {'fetch': 0, 'new': 0, 'empty': 0, 'done': 0, 'priced': 0}

    def work(cid, name):
        jobs, seen = [], set()
        for pg in range(MAX_PAGES):
            content, _ = oxy.fetch(li.search_url(name, LOCATION, pg * li.PER_PAGE),
                                   geo=geo, render=True)
            if not content:
                break
            new = 0
            for j in li.parse_search_html(content):
                # LinkedIn's keyword search is fuzzy; keep only cards whose
                # company actually matches the target (drops recruiter noise).
                #
                # This was substring containment in either direction, which
                # matches INSIDE a word: it filed "Indigo Shire Council" under
                # IGO, "ACCIONA" under CCI and "Wiley" under EY. The shared
                # test compares whole tokens, so a partial word cannot match.
                if j.get('company') and not advertiser_matches(j['company'], name):
                    continue
                k = (norm(j['title']), norm(j.get('location', '')))
                if k in seen:
                    continue
                seen.add(k)
                jobs.append(j)
                new += 1
            if new == 0:  # page repeated / empty → end of results
                break
        if SOLVE:
            with lock:
                st['fetch'] += len(jobs); st['done'] += 1
            sys.stderr.write(f'  {cid:16} {len(jobs):3} jobs · reachable ✓\n')
            return
        if not jobs:
            with lock:
                st['empty'] += 1; st['done'] += 1
            sys.stderr.write(f'  {cid:16} 0 jobs\n')
            return
        have = existing_titles(cid)
        fresh = [j for j in jobs if norm(j['title']) not in have]
        priced = enrich_salaries(fresh, oxy, geo)
        written = upsert(cid, fresh) if fresh else 0
        with lock:
            st['fetch'] += len(jobs); st['new'] += written
            st['priced'] += priced; st['done'] += 1
        sys.stderr.write(f'  {cid:16} {len(jobs):3} linkedin · {written:3} new '
                         f'({len(jobs) - len(fresh)} already archived, {priced} priced)\n')

    with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as ex:
        list(ex.map(lambda cn: work(*cn), sel))

    if SOLVE:
        sys.stderr.write(f'\n✓ {st["done"]} companies reachable via Oxylabs.\n')
        return 0
    sys.stderr.write(f'\nDone (Oxylabs). {st["fetch"]} listings fetched, {st["new"]} new rows '
                     f'archived, {st["empty"]} companies with 0 jobs.\n')

    # A TOTAL WIPEOUT IS A FAILURE, and this was the one Oxylabs driver that did
    # not say so. Measured 2026-08-18 through 2026-08-20: three consecutive runs
    # printed "0 listings fetched, 0 new rows archived, 395 companies with 0
    # jobs", exited 0, and were reported green — while every request underneath
    # returned HTTP 429, the Oxylabs plan quota. Nothing wrote for four days and
    # the workflow history said everything was fine.
    #
    # zhaopin-to-d1.py and indeed-to-d1.py both already fail on exactly this
    # shape. The asymmetry was the bug: three sources sharing one proxy account,
    # and only two of them able to report it running out.
    #
    # The condition is deliberately "not ONE listing across every company", not
    # a threshold. Individual companies legitimately have nothing advertised —
    # `empty` is a normal figure and always has been — but 395 of 395 returning
    # nothing is the account or the endpoint, never the labour market.
    if sel and not st['fetch']:
        sys.stderr.write(
            f'\nFAILED: {len(sel)} companies walked and not one listing fetched. That is the '
            f'fetch path failing, not LinkedIn having no jobs — an HTTP 429 above is the '
            f'Oxylabs plan quota rather than LinkedIn refusing us. Nothing written.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
