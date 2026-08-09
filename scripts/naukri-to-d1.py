#!/usr/bin/env python3
"""
Scrape Naukri (naukri.com) for every roster company in Mumbai and Bengaluru and
archive the results to the D1 jobs table, deduped.

WHAT IT TALKS TO
Naukri exposes a company-in-city search at a slug URL:

    https://www.naukri.com/<company-slug>-jobs-in-<city>

which is server-rendered and, importantly, already filtered to that employer —
a fetch for "infosys-jobs-in-bengaluru" comes back with 20 result tuples whose
company is Infosys on every one. Each result is a `srp-jobtuple-wrapper` div
carrying `data-job-id` plus `title`, `comp-name`, `locWdth` (locations),
`expwdth` (experience), a `sal-wrap` salary and `job-post-day` (a relative
"Posted N days ago"). Results are still post-filtered by company name, because
the slug is a search convenience and not a guarantee.

NOT the JSON API. Naukri's /jobapi/v3/search endpoint exists and returns the
same data more cleanly, but every call through Oxylabs came back 613 (their
internal error) with and without the appid/systemid headers it needs — so the
server-rendered page is the contract this depends on.

WHY OXYLABS
Naukri blocks datacentre IPs. Fetches go through the shared Oxylabs client for
the residential IP, throttling and backoff, with JS rendering on (the tuples are
present in the rendered HTML). `--direct` bypasses it for local debugging and is
expected to fail.

ROSTER
Runs over the roster INCLUDING the city-listed companies (roster.py's
with_cities), because the Mumbai and Bengaluru names — Reliance, TCS, HDFC Bank,
Infosys, Wipro and the rest — live in cityRosters.ts, not the Australian
rosters. Most of the ~995 names have no Indian presence, so a low match count is
the correct answer, not a failure.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD.
Run: python scripts/naukri-to-d1.py [--only id1,id2] [--limit N]
                                    [--max-pages N] [--concurrency N]
                                    [--india-only] [--direct] [--dry-run]

WHY THIS NO LONGER NEEDS OXYLABS (measured 2026-08-09, probe-headless-ci.py
--fingerprint, reproduced on two pinned IPRoyal exits):

    chromium-headless-shell   403 Akamai, 332-byte body
    real Chrome, headful under Xvfb, stealth patches   200, 20 job tuples

Same exit address, same request, minutes apart, with a control board returning
21 rows under BOTH profiles — so the exit was healthy for the baseline too and
the difference is not a luckier IP. Akamai was fingerprinting the BROWSER BUILD.
chromium-headless-shell is a stripped binary that is not Chrome: no proprietary
codecs, SwiftShader WebGL strings, no chrome.runtime.

So the address was never the thing being refused, and Oxylabs was being paid for
one. Set BROWSER_FETCH_CHANNEL=chrome and BROWSER_FETCH_STEALTH=1 (the workflow
does) and run it headful under xvfb-run.
"""
from __future__ import annotations
import datetime
import html
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
import browser_fetch  # noqa: E402
import http_fetch  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
SOURCE = 'naukri'
BASE = 'https://www.naukri.com'

# The two Indian hubs the app plots. The slug is Naukri's own city path segment.
CITIES = [('mumbai', 'mumbai'), ('bengaluru', 'bengaluru')]

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 2))
CONCURRENCY = int(_opt('--concurrency', 5))
# Walk only the companies actually plotted in Mumbai/Bengaluru. The full roster
# is ~995 names and almost none of the Australian ones advertise in India, so
# this is the sensible default for a daily run; drop it to sweep everything.
INDIA_ONLY = '--india-only' in args or '--only' not in args
DIRECT = '--direct' in args
DRY = '--dry-run' in args
# Real Chrome through SCRAPE_PROXY by default; --oxylabs restores the Web
# Scraper API. See the header for what the fingerprint is doing here.
VIA_OXYLABS = '--oxylabs' in args
SETTLE = int(_opt('--settle', 10))

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def slug(name: str) -> str:
    """"Tata Consultancy Services" -> "tata-consultancy-services"."""
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', (name or '').lower())).strip('-')


STOP = {'the', 'and', 'of', 'group', 'holdings', 'limited', 'ltd', 'pvt', 'private',
        'plc', 'inc', 'corporation', 'corp', 'company', 'co', 'india', 'indian'}


def matches_company(advertiser: str, roster_name: str) -> bool:
    """Whole-word token-subset match, same rule as the Jora and JobsDB drivers —
    substring matching is what lets a three-letter name match half the market."""
    a = set(norm(advertiser).split())
    r = [t for t in norm(roster_name).split() if t not in STOP]
    if not r:
        r = norm(roster_name).split()
    return bool(r) and set(r).issubset(a)


def posted_date(text: str) -> str:
    """'Few hours ago' / 'Posted 3 days ago' / '30+ days ago' -> ISO day."""
    t = (text or '').lower()
    d = datetime.date.today()
    if 'hour' in t or 'just now' in t or 'today' in t:
        return d.isoformat()
    m = re.search(r'(\d+)\s*\+?\s*(day|week|month)', t)
    if not m:
        return d.isoformat()
    mult = {'day': 1, 'week': 7, 'month': 30}[m.group(2)]
    return (d - datetime.timedelta(days=int(m.group(1)) * mult)).isoformat()


def get(url: str) -> str | None:
    if DIRECT:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            sys.stderr.write(f'  direct fetch failed (expected — Naukri blocks DC IPs): {e}\n')
            return None
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, _ = oxy_fetch(url, geo='India', render=True)
        return content
    return browser_fetch.nav_get(url, settle=SETTLE, locale='en-IN')


TUPLE_SPLIT = re.compile(r'srp-jobtuple-wrapper', re.I)
ID_RE = re.compile(r'data-job-id="([^"]+)"')
TITLE_RE = re.compile(r'class="[^"]*\btitle\b[^"]*"[^>]*>([^<]{2,120})', re.I)
COMP_RE = re.compile(r'comp-name[^>]*>([^<]{2,80})', re.I)
LOC_RE = re.compile(r'class="[^"]*locWdth[^"]*"[^>]*>([^<]{2,90})', re.I)
EXP_RE = re.compile(r'class="[^"]*expwdth[^"]*"[^>]*>([^<]{1,40})', re.I)
SAL_RE = re.compile(r'sal-wrap[\s\S]{0,240}?title="([^"]{2,60})"', re.I)
DAY_RE = re.compile(r'job-post-day[^>]*>([^<]{2,40})', re.I)
HREF_RE = re.compile(r'href="(https://www\.naukri\.com/job-listings-[^"]+)"')


def parse_page(page_html: str, hub: str) -> list[dict]:
    out = []
    for t in TUPLE_SPLIT.split(page_html)[1:]:
        t = t[:6000]
        title = TITLE_RE.search(t)
        if not title:
            continue
        title_s = clean(title.group(1))
        if not title_s:
            continue
        comp = COMP_RE.search(t)
        loc = LOC_RE.search(t)
        sal = SAL_RE.search(t)
        day = DAY_RE.search(t)
        href = HREF_RE.search(t)
        jid = ID_RE.search(t)
        sal_s = clean(sal.group(1)) if sal else None
        out.append({
            'title': title_s,
            'company': clean(comp.group(1)) if comp else '',
            'location': clean(loc.group(1)) if loc else hub.title(),
            'hub': hub,
            # "Not disclosed" is Naukri's placeholder for an unstated range;
            # storing it would look like a captured figure.
            'salary': sal_s if sal_s and 'not disclosed' not in sal_s.lower() else None,
            'url': href.group(1) if href else f'{BASE}/job-listings-{jid.group(1) if jid else ""}',
            'posted': posted_date(clean(day.group(1)) if day else ''),
            'category': clean(EXP_RE.search(t).group(1)) if EXP_RE.search(t) else 'Naukri',
        })
    return out


def scrape_company(company_id: str, name: str) -> tuple[list, int]:
    jobs, seen, ads = [], set(), 0
    for city_slug, hub in CITIES:
        for page in range(1, MAX_PAGES + 1):
            # Naukri paginates the slug search with a trailing "-<n>".
            url = f'{BASE}/{slug(name)}-jobs-in-{city_slug}'
            if page > 1:
                url += f'-{page}'
            page_html = get(url)
            if not page_html:
                break
            rows = parse_page(page_html, hub)
            if not rows:
                break
            ads += len(rows)
            added = 0
            for j in rows:
                if not matches_company(j['company'], name):
                    continue
                k = job_key(SOURCE, j['title'], j['company'], j['location'])
                if k in seen:
                    continue
                seen.add(k)
                jobs.append(j)
                added += 1
            if len(rows) < 20:  # a short page is the last page
                break
            if not added and page > 1:
                break
    return jobs, ads


def load_companies() -> list[dict]:
    """The roster INCLUDING city-listed companies — the Indian names live only
    in cityRosters.ts, so the default 355-company roster would miss all of
    them."""
    from roster import load_roster
    rows = load_roster(only=ONLY, limit=None if LIMIT >= 10**9 else LIMIT, with_cities=True)
    if INDIA_ONLY and not ONLY:
        rows = [r for r in rows if r['id'].startswith(('mumbai-', 'bengaluru-'))]
    return rows


def map_skills(titles: list, sector: str | None = None) -> list:
    if not titles:
        return []
    payload = {'titles': titles, 'sector': sector} if sector else titles
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=120, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:160]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


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


def upsert(company_id: str, jobs: list, sector: str | None = None) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts."""
    skills = map_skills([j['title'] for j in jobs], sector)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        key = job_key(SOURCE, j['title'], j['company'] or company_id, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], j['company'] or None, company_id,
                     j['hub'], j['location'], j['category'], j['salary'],
                     j['url'], j['posted'], json.dumps(sk) if sk else None))
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
    companies = load_companies()
    if not companies:
        sys.exit('No companies matched — check --only / --india-only.')
    sys.stderr.write(
        f'Naukri (Mumbai + Bengaluru) -> D1: {len(companies)} companies, '
        f'{"DIRECT" if DIRECT else "via Oxylabs" if VIA_OXYLABS else f"real Chrome via {http_fetch.proxy_label()}"}'
        f'{", DRY RUN" if DRY else ""}.\n')

    from concurrent.futures import ThreadPoolExecutor
    results: dict[str, tuple[list, int]] = {}
    # ONE WORKER on the browser path. Playwright's sync API must be driven from
    # the thread that created it, so CONCURRENCY only applies to the Oxylabs and
    # direct transports. 12 companies x 2 cities x 2 pages is 48 requests; that
    # is minutes single-threaded, not hours.
    workers = CONCURRENCY if (VIA_OXYLABS or DIRECT) else 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(scrape_company, c['id'], c['name']): c for c in companies}
        for f in futures:
            c = futures[f]
            try:
                results[c['id']] = f.result()
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f'  {c["id"]}: {e}\n')
                results[c['id']] = ([], 0)

    matched = {k: v for k, v in results.items() if v[0]}
    kept = sum(len(v[0]) for v in matched.values())
    sys.stderr.write(
        f'{len(matched)}/{len(companies)} companies matched; '
        f'{kept} ads kept of {sum(v[1] for v in results.values())} seen.\n')
    if not matched:
        sys.stderr.write('Nothing matched at all — treating as a failure.\n')
        return 1
    if DRY:
        for cid, (jobs, _) in list(matched.items())[:10]:
            j = jobs[0]
            sys.stderr.write(f'  {cid}: {len(jobs)} e.g. "{j["title"][:44]}" '
                             f'@ {j["location"][:26]} [{j["hub"]}] sal={j["salary"]}\n')
        return 0
    sector_by_id = {c['id']: (c.get('sector') or '') for c in companies}
    written = 0
    for cid, (jobs, _) in matched.items():
        written += upsert(cid, jobs, sector_by_id.get(cid))
    sys.stderr.write(f'{written} rows upserted to D1 as {SOURCE}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
