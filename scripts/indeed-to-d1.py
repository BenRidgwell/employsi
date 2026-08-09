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
                                     [--max-pages N] [--oxylabs]
                                     [--nav [--headful] [--proxy URL]]

Transports, all three parsing the same search HTML with parse_search_html:
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
        if VIA_OXYLABS:
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
        exit_name = 'Oxylabs' if VIA_OXYLABS else f'the browser ({http_fetch.proxy_label()})'
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
                f'boards. On --oxylabs check the 613s above (that is Oxylabs '
                f'failing to load the page); on the browser path check for a '
                f'Cloudflare interstitial, which means the exit is burnt. '
                f'Nothing written.\n')
            return 2
        sys.stderr.write(f'\nDone (via {exit_name}). {st["fetch"]} listings fetched, '
                         f'{st["new"]} new rows archived, {st["empty"]} companies with 0 jobs.\n')
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
