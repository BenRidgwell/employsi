#!/usr/bin/env python3
"""
Scrape each company's Indeed board (across all its locations) and archive it to
the D1 jobs table, deduped — the Indeed counterpart of scripts/seek-to-d1.py.

Meant to run from YOUR OWN machine on a schedule (cron / launchd / Task
Scheduler), NOT from CI/Workers: Indeed 403-blocks datacenter IPs, so only a
residential connection reliably renders results.

WHAT RUNS IN CI: THE BROWSER, THROUGH SCRAPE_PROXY (IPRoyal residential).
Measured from a GitHub runner on 2026-08-09 by probe-headless-ci.py: headless
Chromium egressing through the IPRoyal exit loaded a live au.indeed.com search
and parse_search_html counted 16 rows. Reproduced on a second run. That is the
whole reason this moved — the address is what Indeed refuses, and a residential
address in a browser gets the page.

--oxylabs is still here, and still works, as the fallback for the day IPRoyal
stops getting through. The notes below are from when it was the default:

THE OXYLABS PATH IS NOT DEAD.
On 2026-08-04 it returned 613 on essentially every request and every company
came back with 0 jobs, which looked like Indeed had shut us out. Re-measured
2026-08-06 with the same credentials: 6 of 6 companies returned 200 with 12-16
parsed rows each. So that was a transient fault on Oxylabs' side, not a block —
and the run only looked permanent because it ground to the job cap instead of
saying so (see DEAD_AFTER, which now stops it in minutes).

The render request is dropped for the same reason: see the note at the fetch.

THAT IS MEASURED, NOT ASSUMED, AND A BROWSER DOES NOT FIX IT. Checked
2026-08-06 from a GitHub runner via probe-headless-ci: a real headless Chromium,
loading a live Indeed search and counting with this file's own
parse_search_html, got HTTP 403, 38 KB and zero rows behind a Cloudflare
interstitial. So running the Playwright path below on CI is not a fix for the
Oxylabs path being dead — both transports are refused from a datacentre
address, for the same reason, and the browser changes nothing about the address.
(The wall is Cloudflare; this docstring previously said DataDome, which is what
it was earlier. Recorded because the mechanism decides what a workaround would
even look like.) It drives the
tools/indeed-company-scraper browser (one warmed Chromium reused across all
companies), maps skills for parity via the worker's own taxonomy
(scripts/map-skills.ts), drops any role already archived for that company by
another source, and upserts through the D1 HTTP API with the same
source|title|company|location key + upsert as src/employsi/lib/jobArchive.ts.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python scripts/indeed-to-d1.py [--country au] [--only id1,id2] [--limit N]
                                     [--max-pages N] [--oxylabs] [--jobspy]
                                     [--nav [--headful] [--proxy URL]]

Transports. --jobspy is the odd one out and that is the point: it is the only
one that does NOT parse au.indeed.com search HTML, which is the surface every
other transport here has been refused at.

  --jobspy   the JobSpy package against apis.indeed.com's GraphQL API. No
             proxy, no browser, no credential. Measured 2026-09-16: the full
             395-company roster in 251s with zero failures. DISPATCH-ONLY until
             a GitHub runner has walked it — the measurement was taken from a
             sandbox, and the address is the untested half.

The other three all parse the same search HTML with parse_search_html:
  (default)  browser_fetch.nav_get through SCRAPE_PROXY, in real Chrome —
             a navigation per search page, which is what the probe measured.
             This is what CI runs.
  --oxylabs  the Web Scraper API. The fallback, unchanged.
  --nav      a warmed browser navigating page to page with jittered delays.
             What this file used to do; kept for hand-runs from a residential
             machine (--headful solves a wall once, --profile caches it), and
             too slow for the whole roster in CI.

First time on a fresh machine:
    pip install playwright && playwright install chromium
"""
from __future__ import annotations
import json, os, random, re, subprocess, sys, time, datetime

# Make the Indeed scraper importable.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'indeed-company-scraper'))
try:
    import indeed_company_scraper as ind  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}).')
# Playwright is only needed for the browser fallback; the Oxylabs path (env
# OXYLABS_USERNAME) runs without it. Import lazily so this works either way.
try:
    from playwright.sync_api import sync_playwright  # noqa: E402
except ImportError:
    sync_playwright = None

import urllib.request  # noqa: E402
from urllib.parse import urlsplit  # noqa: E402
import browser_fetch  # noqa: E402
import http_fetch  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney']

args = sys.argv[1:]

def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default

COUNTRY = _opt('--country', 'au')
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 20))
# Parallel Oxylabs requests (its realtime render is ~40s/page, so the whole
# 205-company roster is only daily-feasible with concurrency). Keep ≤ your
# Oxylabs plan's concurrency limit.
CONCURRENCY = int(_opt('--concurrency', 8))
# How many companies may complete with ZERO listings between them before the
# walk is treated as refused rather than quiet. 25 is comfortably more than
# the longest run of genuinely empty employers on this roster, and small
# enough that a refused run fails in minutes instead of at the 3-hour cap.
DEAD_AFTER = int(_opt('--dead-after', 25))
HEADFUL = '--headful' in args
PROXY = _opt('--proxy', None)
# The transport. Oxylabs is now OPT-IN rather than "whenever the credentials
# happen to be in the environment": which exit a run used has to be visible in
# the command line, because it is the first thing you need to know when a run
# comes back with zero rows.
VIA_OXYLABS = '--oxylabs' in args
# --jobspy: the JobSpy package (MIT, `pip install python-jobspy`), which does
# NOT parse au.indeed.com search HTML at all — it posts to apis.indeed.com's
# GraphQL endpoint, Indeed's own app API. That is why it is worth a fourth
# transport after three were measured dead: DataDome and Cloudflare guard the
# search HTML, and this never asks for it. See the block above jobspy_collect().
VIA_JOBSPY = '--jobspy' in args
# Per-company result ceiling. 100 is JobSpy's natural page size and was what the
# 2026-09-16 roster measurement used; the walk stops at the cursor's end anyway,
# so this only binds for the largest employers.
JOBSPY_RESULTS = int(_opt('--results', 100))
# --hours-old N: ask Indeed for postings newer than N hours. Left OFF by default
# — the archive is append-only and dedupes on job_key, so a full pull refreshes
# last_seen on still-live roles, which is what keeps "currently advertised"
# honest. A narrow window would let a live ad age out while it is still up.
HOURS_OLD = int(_opt('--hours-old', 0))
# --nav drives a warmed browser through page.goto() per search page, with the
# jittered delays below. It was the only browser path; it is now opt-in, because
# it cannot finish this roster inside a hosted runner's ceiling.
NAV = '--nav' in args
# One-off wait for Cloudflare's challenge on the first navigation.
SETTLE = int(_opt('--settle', 8))
# --proxy-list <file-or-url>: rotate through a proxy pool, moving to the next
# working proxy whenever the current IP gets blocked (see scripts/proxy_pool.py).
# Overrides --proxy. Works with the iplocate free list or a paid residential one.
PROXY_LIST = _opt('--proxy-list', None)
PROFILE = _opt('--profile', None)          # persistent browser dir (cookies survive)
STRICT = '--strict-company' in args
NO_SKILLS = '--no-skills' in args
# Jittered pacing so the traffic doesn't read as a fixed-interval bot.
MIN_DELAY = float(_opt('--min-delay', 8))   # seconds between companies (min)
MAX_DELAY = float(_opt('--max-delay', 25))  # seconds between companies (max)
PAGE_MIN = float(_opt('--page-min', 2))     # seconds between result pages (min)
PAGE_MAX = float(_opt('--page-max', 6))     # seconds between result pages (max)
# --solve: clear the DataDome wall / check reachability only — no D1 write, so no
# token needed. Pair with --headful to solve the human check by hand into a
# --profile; run it again without --headful to confirm the cached profile gets
# through (prints reachable/blocked per company).
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


# ── the JobSpy transport (apis.indeed.com GraphQL) ───────────────────────────
# WHY A FOURTH TRANSPORT EXISTS, and why it is not a fourth flavour of the three
# that failed. Every transport in this file's history — oxylabs, the browser,
# --nav — fetches an au.indeed.com SEARCH PAGE and hands it to
# parse_search_html. That host is what DataDome challenges, and the matrix in
# .github/workflows/indeed-archive.yml closes it: real Chrome, headful, stealth,
# sticky exit, Australian exit, all challenged on request one.
#
# JobSpy does not load that page. It POSTs to apis.indeed.com/graphql, Indeed's
# app API, with a cursor-paged jobSearch query. Different host, different wall.
#
# MEASURED 2026-09-16 FROM A PLAIN DATACENTRE ADDRESS — no proxy, no unblocker,
# no browser, no credential:
#
#   the full 395-company roster   251s, 0 failures, 6,116 rows
#   BHP alone                     25 rows, dated within 2 days
#
# Compare Bright Data's measured 0.50 min/company (~3h for the roster) and its
# per-record bill, which is what forced that sweep to fortnightly. This is
# daily-affordable because it is free and four minutes long.
#
# THE ADDRESS IS THE OPEN QUESTION, NOT THE PARSER. That measurement was taken
# from a sandbox, not from a GitHub runner, and this repo has been burned once
# by exactly that gap: Indeed was moved off Oxylabs on a single probe that did
# not survive the 354-company walk. Hence `transport: jobspy` is dispatch-only
# until a runner has walked the roster. Do not schedule it on this comment.
_JOBSPY_COUNTRY = {'au': 'Australia', 'nz': 'New Zealand', 'uk': 'UK',
                   'gb': 'UK', 'us': 'USA', 'ca': 'Canada', 'sg': 'Singapore',
                   'in': 'India', 'ph': 'Philippines', 'hk': 'Hong Kong'}


def jobspy_collect(cid: str, name: str) -> list:
    """Company-scoped Indeed pull, gated so only `name`'s own ads come back.

    Two things here are not optional, and both are about attribution rather
    than transport:

    THE FALLBACK. `company:"X"` is a keyword match, so a roster name carrying a
    corporate suffix can miss its own employer entirely. Measured 2026-09-16:
    `company:"Monadelphous Group"` returned 0 and `company:"Monadelphous"` 100;
    `"Iluka Resources"` 0 and `"Iluka"` 18; `"Woodside Energy"` 0. 207 of 395
    companies returned nothing on the roster name, and that is substantially
    this, not absence from Indeed. So a zero retries on the short name.

    Dropping the quotes is NOT the fallback and must not become it: unquoted
    `Pilbara Minerals` free-texts the description and returned Acciona and
    Cockburn Cement.

    THE GATE. Widening the query widens what comes back, so every row is
    checked against company_alias.company_matches before it can be filed. 18.0%
    of the measured 6,116 rows were a different employer, and upsert() stamps
    company_id from the company being WALKED — so an ungated row becomes that
    company's hiring on the card, with no visible sign it is wrong.
    """
    from jobspy import scrape_jobs
    from company_alias import company_matches, fallback_safe, short_name

    country = _JOBSPY_COUNTRY.get(COUNTRY)
    if not country:
        sys.exit(f'--jobspy has no country_indeed mapping for "{COUNTRY}". '
                 f'Known: {", ".join(sorted(_JOBSPY_COUNTRY))}.')

    def pull(term: str):
        kw = dict(site_name=['indeed'], search_term=term, location=country,
                  country_indeed=country, results_wanted=JOBSPY_RESULTS,
                  description_format='markdown', verbose=0)
        if HOURS_OLD:
            kw['hours_old'] = HOURS_OLD
        return scrape_jobs(**kw)

    df = pull(f'company:"{name}"')
    short = short_name(name)
    # fallback_safe() withholds the retry from the four roster names whose short
    # form is a generic word another employer trades under — see FALLBACK_UNSAFE.
    if not len(df) and short != norm(name) and fallback_safe(name):
        df = pull(f'company:"{short}"')

    jobs, dropped = [], 0
    for r in df.to_dict('records') if len(df) else []:
        title = str(r.get('title') or '').strip()
        board = str(r.get('company') or '').strip()
        if not title:
            continue
        # DEFAULT-DENY. A name the gate has not seen is dropped rather than
        # guessed at — a dropped row costs coverage, a wrongly kept one puts
        # another employer's vacancies on this company's card.
        if not company_matches(name, board):
            dropped += 1
            continue
        posted = r.get('date_posted')
        jobs.append({
            'title': title,
            'company': board,
            'location': str(r.get('location') or '').strip(),
            'salary': _jobspy_salary(r),
            'url': str(r.get('job_url') or '').strip(),
            'date': '' if posted is None or str(posted) == 'NaT' else str(posted)[:10],
            'country': COUNTRY,
        })
    if dropped:
        sys.stderr.write(f'  [{cid}] dropped {dropped} row(s) advertised by a '
                         f'different employer\n')
    return jobs


def _jobspy_salary(r: dict) -> str:
    """A salary string only when the board actually stated one.

    Indeed leaves these null on most Australian ads, and an invented midpoint or
    a formatted "None" would be a fabricated number on a card — the one thing
    this codebase does not do. No amounts, no string.
    """
    lo, hi = r.get('min_amount'), r.get('max_amount')
    def ok(v):
        return v is not None and str(v) not in ('nan', 'NaT', '') and float(v) > 0
    if not (ok(lo) or ok(hi)):
        return ''
    cur = str(r.get('currency') or '').strip()
    per = str(r.get('interval') or '').strip()
    amt = (f'{float(lo):,.0f} - {float(hi):,.0f}' if ok(lo) and ok(hi)
           else f'{float(lo if ok(lo) else hi):,.0f}')
    return ' '.join(x for x in (cur, amt, f'per {per}' if per else '') if x)


def existing_titles(company_id: str) -> set:
    # Only OTHER sources — so an Indeed job that duplicates an Adzuna/SEEK/etc.
    # role is counted once, but Indeed's own previously-archived jobs re-upsert
    # and refresh their last_seen (keeping still-live roles "current").
    r = d1("SELECT DISTINCT title FROM jobs WHERE company_id = ? AND source != 'indeed'", [company_id])
    return {norm(str(x.get('title') or '')) for x in (r[0]['results'] if r else [])}


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['title'] for j in jobs]
    # The employer's industry rides along so seniority words in a title
    # are read correctly (see INDUSTRY_GATED in skillsTaxonomy.ts).
    skills = map_skills(titles, SECTOR_BY_ID.get(company_id))
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or company_id
        location = j.get('location') or ''
        key = job_key('indeed', j['title'], company or company_id, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'indeed', j['title'], company or None, company_id,
                     match_city(location), location, j.get('country') or COUNTRY,
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
    base = ind.COUNTRIES.get(COUNTRY)
    if not base:
        sys.exit(f'Unknown --country "{COUNTRY}". Options: {", ".join(ind.COUNTRIES)}')
    companies = load_companies()
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'Indeed -> D1'
    sys.stderr.write(f'{mode}: {len(companies)} company(ies) on {COUNTRY}.indeed '
                     f'({"HEADFUL" if HEADFUL else "headless"}'
                     f'{", profile=" + PROFILE if PROFILE else ""}).\n')
    if SOLVE and not HEADFUL:
        sys.stderr.write('  (headless: verifying the cached profile gets through. '
                         'Add --headful the first time to solve the wall by hand.)\n')

    # ── the SEARCH-HTML walk ─────────────────────────────────────────────────
    # Fetch each search page's HTML and parse it with parse_search_html. Two
    # transports fill in the fetch; the walk around them is identical, which is
    # the point — the parsing, the dedupe, the DEAD_AFTER guard and the D1 write
    # are the same code whichever exit the bytes came through.
    #
    #   default    browser_fetch.nav_get through SCRAPE_PROXY, in real Chrome
    #              under Xvfb with the stealth patches. A navigation per search
    #              page — the sequence probe-headless-ci actually measured.
    #   --oxylabs  the Web Scraper API, which supplies the address and the
    #              bypass together.
    #
    # The alternative below (--nav) drives a warmed browser through goto() with
    # jittered human-ish delays. It is the right shape for a hand-run from a
    # residential machine, and the wrong one for CI: 355 companies at 8-25s
    # apiece plus a navigation per page does not fit in a runner's six hours.
    if VIA_OXYLABS or not NAV:
        from concurrent.futures import ThreadPoolExecutor
        import threading
        geo = ind.GEO_FOR.get(COUNTRY)
        sel = companies[:LIMIT] if LIMIT < len(companies) else companies
        if VIA_JOBSPY:
            try:
                import jobspy  # noqa: F401
            except ImportError:
                sys.exit('--jobspy needs the JobSpy package: pip install python-jobspy')
            # ONE WORKER, deliberately. The 2026-09-16 roster measurement was
            # sequential and took 251s for 395 companies, so there is nothing to
            # buy with concurrency — and a rate limit is the one failure mode
            # that measurement did NOT exercise. Parallelising on the strength
            # of a sequential result is the mistake this file already made once
            # with a single probe request.
            fetch_search = None
            workers = 1
            sys.stderr.write(f'  via JobSpy -> apis.indeed.com GraphQL '
                             f'(country={COUNTRY}, sequential) — {len(sel)} companies, '
                             f'no proxy, no browser.\n')
        elif VIA_OXYLABS:
            if not os.environ.get('OXYLABS_USERNAME'):
                sys.exit('--oxylabs needs OXYLABS_USERNAME / OXYLABS_PASSWORD.')
            import oxylabs_client as oxy
            fetch_search = lambda u: oxy.fetch(u, geo=geo, render=False)[0]  # noqa: E731
            workers = max(1, CONCURRENCY)
            sys.stderr.write(f'  via Oxylabs Web Scraper API (geo={geo}, concurrency={workers}) '
                             f'— {len(sel)} companies, no browser.\n')
        else:
            # nav_get, NOT raw_get. probe-headless-ci measured page.goto() and
            # counted 16 rows with parse_search_html; raw_get pulls each page
            # with fetch() from inside a cleared context, which is a transport
            # the probe never exercised. startup.jobs was ported onto that same
            # assumption on the same day and answered every in-page fetch with a
            # Cloudflare 403 while navigation worked fine. Same measurement, same
            # mistake — caught here before it ran.
            fetch_search = lambda u: browser_fetch.nav_get(u, settle=SETTLE, locale='en-AU')  # noqa: E731
            # ONE worker, not CONCURRENCY. Playwright's sync API must be driven
            # from the thread that created it, so the pool below is a pool of
            # one here. Jora's browser path has the same constraint and the same
            # answer; it is fast enough because the challenge is cleared once
            # and the pages after it are fetches, not navigations.
            workers = 1
            sys.stderr.write(f'  browser via {http_fetch.proxy_label()} — {len(sel)} companies, '
                             f'single-threaded.\n')
        lock = threading.Lock()
        st = {'fetch': 0, 'new': 0, 'empty': 0, 'done': 0, 'reach': 0,
              'dead': False, 'diagnosed': False}

        def work(cid, name):
            # STOP EARLY WHEN THE FEED IS DEAD RATHER THAN SLOW. Measured
            # 2026-08-04: Oxylabs returned 613 ("faulted") on essentially every
            # Indeed request, each one retried with backoff, and every company
            # came back with 0 jobs. The run ground on for the full three-hour
            # job cap and was cancelled — which reads in the run list as a
            # timeout, not as "Indeed is refusing us", and writes nothing either
            # way. Once DEAD_AFTER companies have completed and NOT ONE listing
            # has been fetched, that is the target refusing the whole walk, not
            # a run of quiet employers.
            if st['dead']:
                return
            jobs, seen = [], set()
            if VIA_JOBSPY:
                jobs = jobspy_collect(cid, name)
            else:
                for pg in range(MAX_PAGES):
                    # NO RENDER. Indeed server-renders its result cards, so the
                    # headless browser Oxylabs runs for render='html' produces the
                    # same page for more work. Measured 2026-08-06 on the BHP
                    # search: rendered 1,132,577 bytes and unrendered 1,144,483,
                    # and parse_search_html returned the SAME 16 jobs from each,
                    # first row identical.
                    #
                    # That matters beyond the time saved, because it is the 613s.
                    # 613 is Oxylabs' own "faulted" code — its worker could not
                    # complete the fetch — and the render step is the most failure
                    # prone thing in that pipeline. Asking for a browser we do not
                    # need is asking for the failure we were getting. Measured the
                    # same day, unrendered: 6 of 6 companies returned 200 with
                    # 12-16 rows each, 35-82s apiece.
                    content = fetch_search(ind.search_url(base, name, '', pg * 10))
                    if not content:
                        break
                    # SAY WHY THE FIRST EMPTY PAGE WAS EMPTY. A page that renders
                    # and parses to nothing is indistinguishable in this loop from a
                    # quiet employer, and the run-level DEAD_AFTER abort tells you
                    # only that it happened 25 times. One line naming the size and
                    # the challenge, once, is the difference between "Indeed refused
                    # the run" and knowing WHICH refusal.
                    if not jobs and pg == 0:
                        with lock:
                            first = not st['diagnosed']
                            st['diagnosed'] = True
                        if first and not ind.parse_search_html(content, base):
                            why = next((lbl for pat, lbl in browser_fetch.BLOCK_MARKERS
                                        if re.search(pat, content, re.I)), '')
                            sys.stderr.write(
                                f'  [{cid}] page 1 parsed 0 rows from {len(content)} bytes'
                                + (f' [{why}]' if why else ' (no challenge marker — the '
                                   'markup may have changed)') + '\n')
                    new = 0
                    for j in ind.parse_search_html(content, base):
                        k = (norm(j['title']), norm(j.get('location', '')))
                        if k in seen:
                            continue
                        seen.add(k)
                        jobs.append(j)
                        new += 1
                    if new == 0:  # page repeated / empty → end of results
                        break
            if SOLVE:
                # ROWS, NOT A COMPLETED CALL. This printed "reachable ✓" for any
                # company that finished the loop, so a run where every fetch
                # died — connection reset, challenge page, dead proxy — reported
                # a clean tick on zero listings and exited 0. That is the check
                # reporting on itself rather than on Indeed.
                with lock:
                    st['fetch'] += len(jobs); st['done'] += 1
                    if jobs:
                        st['reach'] += 1
                sys.stderr.write(f'  {cid:16} {len(jobs):3} jobs · '
                                 f'{"reachable ✓" if jobs else "NOTHING"}\n')
                return
            if not jobs:
                with lock:
                    st['empty'] += 1; st['done'] += 1
                    if st['done'] >= DEAD_AFTER and st['fetch'] == 0:
                        st['dead'] = True
                sys.stderr.write(f'  {cid:16} 0 jobs\n')
                return
            have = existing_titles(cid)
            fresh = [j for j in jobs if norm(j['title']) not in have]
            written = upsert(cid, fresh) if fresh else 0
            with lock:
                st['fetch'] += len(jobs); st['new'] += written; st['done'] += 1
            sys.stderr.write(f'  {cid:16} {len(jobs):3} indeed · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')

        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(lambda cn: work(*cn), sel))
        exit_name = ('JobSpy (apis.indeed.com GraphQL)' if VIA_JOBSPY
                     else 'Oxylabs' if VIA_OXYLABS
                     else f'the browser ({http_fetch.proxy_label()})')
        if SOLVE:
            sys.stderr.write(f'\n{st["reach"]} of {st["done"]} companies returned listings '
                             f'via {exit_name} ({st["fetch"]} in total).\n')
            # Nothing anywhere is a refused exit, not a roster of quiet
            # employers — every company on this roster advertises somewhere.
            return 0 if st['reach'] else 2
        if st['dead']:
            sys.stderr.write(
                f'\nABORTED: {st["done"]} companies walked and not one listing '
                f'fetched. Indeed is refusing the whole run, not returning empty '
                f'boards. On --jobspy that means the GraphQL API refused this '
                f'address (the walk itself cannot 0 out — it has no wall to hit) '
                f'or the hardcoded app key in the package has been rotated; '
                f'on --oxylabs check the 613s above (that is Oxylabs '
                f'failing to load the page); on the browser path check for a '
                f'Cloudflare interstitial, which means the exit is burnt. '
                f'Nothing written.\n')
            return 2
        sys.stderr.write(f'\nDone (via {exit_name}). {st["fetch"]} listings fetched, '
                         f'{st["new"]} new rows archived, {st["empty"]} companies with 0 jobs.\n')
        # ZERO LISTINGS IS A FAILURE WHATEVER THE WALK LENGTH. DEAD_AFTER exists
        # to stop a doomed run early, not to decide whether it worked — and
        # because it needs 25 completed companies, a shorter walk sailed past it
        # and returned 0. Measured 2026-08-09: a five-company run fetched
        # nothing, printed "0 listings fetched" and exited GREEN. Every company
        # on this roster advertises somewhere, so a walk that fetched nothing
        # was refused, and a refused feed must go red.
        if sel and not st['fetch']:
            sys.stderr.write(
                f'FAILED: {st["done"]} companies walked and not one listing fetched. '
                f'See the page-1 diagnostic above for whether that was a challenge, '
                f'a moved layout or an empty response.\n')
            return 2
        return 0

    if sync_playwright is None:
        sys.exit('No browser: install Playwright, or pass --oxylabs (with '
                 'OXYLABS_USERNAME / OXYLABS_PASSWORD) to use the Web Scraper API path.')

    # Optional proxy pool: pick an initial working proxy, rotate on repeated blocks.
    rotator = proxy = open_resilient = None
    if PROXY_LIST:
        try:
            from proxy_pool import rotator_from, open_resilient
            rotator = rotator_from(PROXY_LIST, base.rstrip('/') + '/', timeout=8.0)
            proxy = rotator.next_working()
            sys.stderr.write(f'  starting with proxy {proxy}\n' if proxy
                             else '  no working proxy in the pool — running direct.\n')
        except Exception as e:
            sys.stderr.write(f'  proxy pool error ({e}) — running direct.\n')
    else:
        # SCRAPE_PROXY is the default exit, split into Playwright's
        # {server, username, password} — Chromium ignores credentials embedded
        # in the server URL, so passing the raw URL 407s every request. An
        # explicit --proxy still wins, and no proxy at all still runs direct
        # (which is how this is used from a residential machine by hand).
        proxy = PROXY or browser_fetch.proxy_from_env()
        # Host:port only — a residential proxy URL carries a password.
        where = urlsplit(PROXY).netloc.rsplit('@', 1)[-1] if PROXY else http_fetch.proxy_label()
        sys.stderr.write(f'  browser exit: {where}\n')

    total_fetch = total_new = blocked = done = 0
    consecutive_blocks = 0
    with sync_playwright() as p:
        open_fn = lambda pr: ind.open_session(p, headful=HEADFUL, proxy=pr, profile=PROFILE)
        if open_resilient:
            proxy, session, page = open_resilient(open_fn, rotator, proxy)
        else:
            session, page = open_fn(proxy)
        first = True
        for cid, name in companies:
            if done >= LIMIT:
                break
            if not first:
                time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))  # jittered gap between companies
            first = False
            jobs, was_blocked = ind.scrape_company(
                page, base, name, max_pages=MAX_PAGES, strict_company=STRICT, country=COUNTRY,
                page_delay=(PAGE_MIN, PAGE_MAX))
            if was_blocked:
                blocked += 1
                consecutive_blocks += 1
                sys.stderr.write(f'  {cid:16} BLOCKED\n')
                if consecutive_blocks >= 3:
                    # Rotate to the next working proxy and relaunch, if we have a pool.
                    nxt = rotator.next_working() if rotator else None
                    if nxt:
                        sys.stderr.write(f'  rotating proxy → {nxt}\n')
                        try:
                            session.close()
                        except Exception:
                            pass
                        proxy, session, page = open_resilient(open_fn, rotator, nxt)
                        consecutive_blocks = 0
                        continue  # retry this company on the new proxy
                    sys.stderr.write('  3 consecutive blocks and no more proxies — stopping.\n')
                    break
                done += 1
                continue
            consecutive_blocks = 0
            total_fetch += len(jobs)
            if SOLVE:
                # No D1 — just report we got through the wall.
                sys.stderr.write(f'  {cid:16} {len(jobs):3} jobs · reachable ✓\n')
                done += 1
                continue
            if not jobs:
                sys.stderr.write(f'  {cid:16} 0 jobs\n')
                done += 1
                continue
            have = existing_titles(cid)
            fresh = [j for j in jobs if norm(j['title']) not in have]
            written = upsert(cid, fresh) if fresh else 0
            total_new += written
            sys.stderr.write(f'  {cid:16} {len(jobs):3} indeed · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')
            done += 1
        session.close()

    if SOLVE:
        ok = done - blocked
        sys.stderr.write(f'\n{"✓ Reachable" if ok and not blocked else ("Partially blocked" if ok else "✗ Blocked")}'
                         f' — {ok} reachable, {blocked} blocked. '
                         f'{"Cached to " + PROFILE if PROFILE else "Tip: add --profile <dir> to cache the solved session."}\n')
        return 2 if (companies and blocked >= done) else 0

    sys.stderr.write(f'\nDone. {total_fetch} Indeed listings fetched, {total_new} new rows '
                     f'archived, {blocked} companies blocked.\n')
    if companies and blocked > len(companies) * 0.5:
        sys.stderr.write('WARNING: over half blocked — Indeed is throttling this host.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
