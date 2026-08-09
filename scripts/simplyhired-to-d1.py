#!/usr/bin/env python3
"""
SimplyHired Australia → the D1 job archive, one search per rostered company.

WHY A WHOLE-ROSTER BOARD RATHER THAN A CAREER PORTAL
The career-portal feeds read one employer's own board and are authoritative for
that employer. This is the other kind of source: an aggregator that indexes
agency-posted and third-party-posted ads a company's own portal never shows. It
is walked the same way the JobStreet and LinkedIn feeds are — by NAME, once per
employer — because SimplyHired has no advertiser ids to search by.

MATCHING COMPANIES IS THE WHOLE RISK. Keyword search returns anything that
mentions the name: searching "BHP" returns rows advertised by "BHP Mining" (the
employer) and would happily return an unrelated firm whose ad merely says BHP.
Every row is therefore tested against the roster name with
scripts/advertiser_match.py — the shared rule written after plain containment
filed "Indigo Shire Council" under IGO and "Wiley" under EY. Rows that fail the
test are dropped, and NEAR misses are reported at the end of the run so a real
subsidiary can be confirmed and added to ADVERTISER_ALIAS rather than the rule
being loosened.

WHY A RESIDENTIAL EXIT. simplyhired.com.au 403s a datacentre IP outright
(measured: a plain request returns 403 with a 5.8 KB challenge body), so it
cannot run in the Worker. The address is the whole problem — it needs no JS
render, because the search page ships its results as a Next.js `__NEXT_DATA__`
payload.

The exit is now IPRoyal via SCRAPE_PROXY rather than Oxylabs. Measured from a
GitHub runner on 2026-08-09 (probe-headless-ci.py, reproduced on a second run):
headless Chromium through the IPRoyal exit loaded the live BHP search and
counted 21 `"jobKey"` rows. A PLAIN urllib request through the same exit did
NOT — 1 of 12 boards answered that way — so the browser is doing real work here
beyond carrying the address: it clears the Cloudflare challenge once, and
raw_get then fetches each search page as `fetch()` from inside the cleared page,
which returns the SERVER's bytes rather than a serialised DOM. That matters:
`__NEXT_DATA__` is parsed out of the raw body.

--oxylabs still selects the Web Scraper API, unchanged, for the day IPRoyal
stops getting through.

WHAT THE PAYLOAD GIVES, and why it is worth having: title, the ADVERTISER, a
location with a state, a posting timestamp, and `salaryInfo` — an advertised
salary string, which most employer portals do not publish at all. `resultCount`
is the board's own total, so the walk is bounded by it rather than by a short
page, and paging is by the opaque cursors the payload hands out.

THE LOCATION FILTER IS DELIBERATELY EMPTY. The obvious URL to copy is a city
search (`&l=Perth+WA`), and it is the wrong one: it would archive only the Perth
slice of every national employer. `l=` unset searches the whole country.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     SCRAPE_PROXY (the residential exit; the default transport),
     OXYLABS_USERNAME / OXYLABS_PASSWORD only with --oxylabs.
Run: python scripts/simplyhired-to-d1.py [--limit N] [--only id,id]
                                         [--max-pages N] [--dry-run] [--oxylabs]
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
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'simplyhired'
SITE = 'https://www.simplyhired.com.au'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


LIMIT = int(_opt('--limit', 10 ** 9))
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
MAX_PAGES = int(_opt('--max-pages', 5))
DRY = '--dry-run' in args
# Browser + SCRAPE_PROXY by default; --oxylabs puts the Web Scraper API back.
VIA_OXYLABS = '--oxylabs' in args
# The one-off wait for Cloudflare's challenge on the first navigation. 8s is
# what the probe that measured this feed used; below that the clearance cookie
# is not always set and every page after it comes back as the challenge.
SETTLE = int(_opt('--settle', 8))
NO_SKILLS = '--no-skills' in args

if not TOKEN and not DRY:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

import browser_fetch  # noqa: E402
import http_fetch  # noqa: E402
from advertiser_match import advertiser_matches, near_miss, norm  # noqa: E402


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def load_roster() -> list:
    """Every company on the roster, including the international city rosters.

    --with-cities is what makes this ~999 companies rather than the 355 AU-only
    ones. A London or Auckland listing can still advertise in Australia, and
    SimplyHired indexes those ads; walking the AU roster alone would miss them.
    """
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'roster.ts'), '--with-cities'],
                       capture_output=True, timeout=180, cwd=ROOT)
    if p.returncode != 0:
        sys.stderr.write(f'roster.ts failed: {p.stderr.decode()[:300]}\n')
        return []
    return json.loads(p.stdout.decode('utf-8'))


# ── SimplyHired read ──────────────────────────────────────────────────────────
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def page_props(html: str) -> dict:
    m = NEXT_DATA_RE.search(html or '')
    if not m:
        return {}
    try:
        return json.loads(m.group(1))['props']['pageProps']
    except Exception:  # noqa: BLE001
        return {}


def search(name: str, cursor: str | None) -> dict:
    q = urllib.parse.urlencode({'q': name, 'l': ''})
    url = f'{SITE}/search?{q}' + (f'&cursor={urllib.parse.quote(cursor)}' if cursor else '')
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, _ = oxy_fetch(url, geo='Australia', render=False, timeout=200)
    else:
        content = browser_fetch.raw_get(url, settle=SETTLE, locale='en-AU')
    return page_props(content)


def posted_iso(ms) -> str:
    """`dateOnIndeed` is epoch MILLISECONDS. Seconds would date every ad to 1970
    and the archive would happily store it, so the magnitude is checked."""
    try:
        v = int(ms)
    except (TypeError, ValueError):
        return ''
    if v < 10 ** 11:
        return ''
    return datetime.datetime.utcfromtimestamp(v / 1000).date().isoformat()


def collect(name: str) -> tuple[list[dict], int, list[str]]:
    """(rows advertised BY this company, board total for the query, near misses)."""
    rows: dict[str, dict] = {}
    misses: set[str] = set()
    total = 0
    cursor = None
    for page in range(1, MAX_PAGES + 1):
        pp = search(name, cursor)
        jobs = pp.get('jobs') or []
        if not jobs:
            break
        total = int(pp.get('resultCount') or total)
        for j in jobs:
            advertiser = (j.get('company') or '').strip()
            title = (j.get('title') or '').strip()
            key = j.get('jobKey')
            if not title or not key:
                continue
            if not advertiser_matches(advertiser, name):
                if near_miss(advertiser, name):
                    misses.add(advertiser)
                continue
            rows[key] = {
                'title': title,
                'company': advertiser,
                'location': (j.get('location') or '').strip(),
                'salary': (j.get('salaryInfo') or '').strip() or None,
                'url': SITE + (j.get('botUrl') or f'/job/{key}'),
                'posted': posted_iso(j.get('dateOnIndeed')),
                'category': ', '.join(j.get('jobTypes') or []) or 'Job board',
            }
        cursors = pp.get('pageCursors') or {}
        cursor = cursors.get(str(page + 1))
        if not cursor:
            break
        time.sleep(0.5)
    return list(rows.values()), total, sorted(misses)


# ── parity bridges to the worker's own taxonomy and hub table ─────────────────
def _bridge(script: str, payload, fallback):
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, script)],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  {script} failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  {script} error: {e}\n')
    return fallback


def map_skills(titles: list, sector: str) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    return _bridge('map-skills.ts', {'titles': titles, 'sector': sector},
                   [[] for _ in titles])


def map_hubs(locations: list, home: str | None) -> list:
    if not locations:
        return []
    return _bridge('map-hubs.ts', {'locations': locations, 'home': home},
                   [None for _ in locations])


# ── D1 ────────────────────────────────────────────────────────────────────────
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


def upsert(company: dict, jobs: list) -> int:
    skills = map_skills([j['title'] for j in jobs], company.get('sector') or '')
    home = (company.get('cities') or [None])[0]
    hubs = map_hubs([j['location'] for j in jobs], home)
    rows, seen = [], set()
    for j, sk, hub in zip(jobs, skills, hubs):
        key = job_key(SOURCE, j['title'], company['name'], j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], company['name'], company['id'],
                     hub, j['location'], j['category'], j['salary'],
                     j['url'], j['posted'] or TODAY, json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params a query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, '
               'salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               'salary = COALESCE(jobs.salary, excluded.salary), '
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
    roster = load_roster()
    if not roster:
        # An empty roster is never a real state of the world — it means
        # roster.ts moved or stopped running. Reporting "0 archived" and exiting
        # 0 is exactly how a broken feed hides for days.
        sys.stderr.write('No roster loaded from scripts/roster.ts — treating as failure.\n')
        return 1

    # One walk per EMPLOYER, not per roster line: the roster carries a company
    # once per listing, so a dual-listed issuer would otherwise be searched
    # twice and archive the same ads under two ids. First id wins, which is how
    # COMPANY_ID_ALIAS already resolves the pair when the app reads them back.
    by_name, targets = {}, []
    for c in roster:
        if ONLY and c['id'] not in ONLY:
            continue
        k = norm(c['name'])
        if k in by_name:
            continue
        by_name[k] = c['id']
        targets.append(c)
    targets = targets[:LIMIT]

    sys.stderr.write(f'SimplyHired AU -> D1: {len(targets)} employers · '
                     f'{"via Oxylabs" if VIA_OXYLABS else f"browser via {http_fetch.proxy_label()}"}'
                     f'{", DRY RUN" if DRY else ""}\n')
    total_rows = 0
    with_ads = 0
    all_misses: dict[str, set] = {}
    failures = 0
    for i, c in enumerate(targets, 1):
        try:
            jobs, board_total, misses = collect(c['name'])
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  [{i}/{len(targets)}] {c["name"]}: FAILED ({e})\n')
            failures += 1
            continue
        if misses:
            all_misses[c['name']] = set(misses)
        if not jobs:
            continue
        with_ads += 1
        sal = sum(1 for j in jobs if j['salary'])
        sys.stderr.write(f'  [{i}/{len(targets)}] {c["name"][:34]:34s} '
                         f'{len(jobs):>3} of {board_total:>4} matched, {sal:>3} with salary\n')
        if DRY:
            total_rows += len(jobs)
            continue
        total_rows += upsert(c, jobs)

    sys.stderr.write(f'\n{with_ads} employers advertising, {total_rows} rows '
                     f'{"parsed" if DRY else "archived"}.\n')
    if all_misses:
        # Reported, never auto-accepted: a rejection that leads with a roster
        # name is either a real subsidiary (add it to ADVERTISER_ALIAS) or the
        # collision the rule exists to stop.
        sys.stderr.write('Near misses to confirm before adding to ADVERTISER_ALIAS:\n')
        for name, adv in sorted(all_misses.items())[:40]:
            sys.stderr.write(f'  {name}  <-  {", ".join(sorted(adv))[:110]}\n')
    # A whole roster returning nothing is the board blocking us, not a market
    # with no vacancies — exit non-zero so the run goes red instead of quietly
    # writing nothing.
    if not total_rows:
        sys.stderr.write('No rows matched across the entire roster — treating as failure.\n')
        return 1
    if failures > len(targets) // 4:
        sys.stderr.write(f'{failures} of {len(targets)} searches failed — degraded run.\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
