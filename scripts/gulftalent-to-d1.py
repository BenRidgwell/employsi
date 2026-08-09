#!/usr/bin/env python3
"""
Scrape GulfTalent (gulftalent.com) for Dubai roles and archive them to the D1
jobs table, deduped.

WHAT IT TALKS TO
GulfTalent's search page is an Angular app, but it is backed by a JSON endpoint:

    GET https://www.gulftalent.com/api/jobs/search?limit=<n>&offset=<n>

returning {"positions": [...], "total_results": N}. Each position carries
`title`, `company_name`, `location`, `posted_date`, `link`,
`industry_name_standard` and a `minSalary`/`maxSalary`/`salaryCurrency` band.

Two things about that endpoint, both established by testing it rather than
assumed:

  * `limit` and `offset` work and page properly (limit=50 returns 50 distinct
    ids; offset=5 returns the next five). `page` is ignored.
  * The `city` / `country` parameters are ACCEPTED AND IGNORED on this form — a
    request pinned to Dubai still comes back with Riyadh, Doha and Manama roles.
    The app's own UI sends them as `filters[city]=…`, but that bracketed form
    fails through Oxylabs every time. So the city filter is applied HERE, on
    each row's own location, which is the honest way round: we only keep rows
    that actually say Dubai rather than trusting a filter that does nothing.

WHY OXYLABS
The API is behind Akamai and returns 403 "Access Denied" to a datacentre IP.
Requests go through the shared Oxylabs client for the residential IP, throttling
and backoff. No JS rendering is needed — it is a plain JSON endpoint.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD.
Run: python scripts/gulftalent-to-d1.py [--max-pages N] [--dry-run] [--direct]

WHY THIS NO LONGER NEEDS OXYLABS (measured 2026-08-09, probe-headless-ci.py
--fingerprint, reproduced three times including on two pinned IPRoyal exits):

    chromium-headless-shell   403 Akamai "Access Denied", ~310-byte body
    real Chrome, headful under Xvfb, stealth patches   200, 50 positions

Byte-identical at 124,120 on every passing run, and a control board returned 21
rows under BOTH profiles in the confirming run — so the exit was healthy for the
baseline too and this is not a luckier IP. Akamai was fingerprinting the BROWSER
BUILD, not the address, and Oxylabs was being paid for an address that was never
the thing being refused.

Set BROWSER_FETCH_CHANNEL=chrome and BROWSER_FETCH_STEALTH=1 (the workflow does)
and run it headful under xvfb-run.
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
import browser_fetch  # noqa: E402
import http_fetch  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'gulftalent'
HUB = 'dubai'
BASE = 'https://www.gulftalent.com'
ENDPOINT = BASE + '/api/jobs/search'
PAGE = 50

args = sys.argv[1:]
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 40
DRY = '--dry-run' in args
DIRECT = '--direct' in args
# Real Chrome through SCRAPE_PROXY by default; --oxylabs restores the Web
# Scraper API. See the header for what the fingerprint is doing here.
VIA_OXYLABS = '--oxylabs' in args
SETTLE = int(args[args.index('--settle') + 1] if '--settle' in args else 3)

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

# A row is Dubai's when its own location says so. GulfTalent writes it as
# "Dubai, UAE"; the bare "UAE" rows are country-only and cannot be placed on a
# city, so they are left out rather than assigned to Dubai by assumption.
DUBAI_RE = re.compile(r'\bdubai\b', re.I)


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def iso_day(s: str) -> str:
    """'2026-07-08T00:00:00-05:00' -> '2026-07-08'."""
    m = re.match(r'(\d{4}-\d{2}-\d{2})', s or '')
    return m.group(1) if m else TODAY


def salary_text(j: dict) -> str | None:
    """The advertised band, only when GulfTalent actually publishes it.

    isSalaryPublic == "0" means the employer supplied a range for its own
    filtering but did not agree to show it, so it is not ours to print."""
    if str(j.get('isSalaryPublic') or '0') != '1':
        return None
    lo, hi = j.get('minSalary'), j.get('maxSalary')
    cur = (j.get('salaryCurrency') or '').strip()
    try:
        lo_n, hi_n = int(float(lo)), int(float(hi))
    except (TypeError, ValueError):
        return None
    if lo_n <= 0:
        return None
    band = f'{lo_n:,}' if lo_n == hi_n else f'{lo_n:,}–{hi_n:,}'
    return f'{cur} {band}'.strip()


def get(url: str) -> str | None:
    if DIRECT:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            sys.stderr.write(f'  direct fetch failed (expected — Akamai blocks DC IPs): {e}\n')
            return None
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, _ = oxy_fetch(url, geo='United Arab Emirates', render=False)
        return content
    # json_get, not nav_get: this endpoint returns JSON, and navigating a
    # browser to JSON hands back a <pre> document with entity-escaped quotes
    # that json.loads below cannot read. json_get returns the rendered TEXT,
    # which is the original payload.
    return browser_fetch.json_get(url, settle=SETTLE, locale='en-AE')


def scrape() -> list[dict]:
    out, seen = [], set()
    total = None
    for page in range(MAX_PAGES):
        q = urllib.parse.urlencode({'limit': PAGE, 'offset': page * PAGE})
        body = get(f'{ENDPOINT}?{q}')
        if not body or not body.strip().startswith('{'):
            sys.stderr.write(f'  page {page}: no JSON, stopping\n')
            break
        try:
            d = json.loads(body)
        except Exception:
            break
        pos = d.get('positions') or []
        if total is None:
            total = d.get('total_results')
            sys.stderr.write(f'  {total} positions advertised board-wide\n')
        if not pos:
            break
        kept = 0
        for j in pos:
            loc = (j.get('location') or '').strip()
            if not DUBAI_RE.search(loc):
                continue
            title = (j.get('title') or '').strip()
            if not title:
                continue
            company = (j.get('company_name') or '').strip()
            key = job_key(SOURCE, title, company, loc)
            if key in seen:
                continue
            seen.add(key)
            link = (j.get('link') or '').strip()
            out.append({
                'title': title,
                'company': company,
                'location': loc,
                'salary': salary_text(j),
                'url': link if link.startswith('http') else BASE + link,
                'posted': iso_day(str(j.get('posted_date') or '')),
                'category': (j.get('industry_name_standard') or '').strip() or 'GulfTalent',
            })
            kept += 1
        sys.stderr.write(f'  page {page}: {len(pos)} rows, {kept} in Dubai\n')
        if len(pos) < PAGE:
            break
    return out


def map_skills(titles: list) -> list:
    if not titles:
        return []
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode(),
                           capture_output=True, timeout=180, cwd=ROOT)
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


def upsert(jobs: list) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts.

    These are board-wide Dubai roles rather than one employer's, so company_id
    is null — the row still counts toward the Dubai hub's market view without
    being attributed to a company we have not matched."""
    skills = map_skills([j['title'] for j in jobs])
    rows = []
    for j, sk in zip(jobs, skills):
        rows.append((job_key(SOURCE, j['title'], j['company'], j['location']),
                     SOURCE, j['title'], j['company'] or None, None,
                     HUB, j['location'], j['category'], j['salary'],
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
    sys.stderr.write(
        f'GulfTalent (Dubai) -> D1: {"DIRECT" if DIRECT else "via Oxylabs" if VIA_OXYLABS else f"real Chrome via {http_fetch.proxy_label()}"}'
        f'{", DRY RUN" if DRY else ""}\n')
    jobs = scrape()
    if not jobs:
        sys.stderr.write('No Dubai roles parsed — treating as a failure.\n')
        return 1
    with_sal = sum(1 for j in jobs if j['salary'])
    sys.stderr.write(f'{len(jobs)} Dubai roles ({with_sal} with a published salary).\n')
    for j in jobs[:6]:
        sys.stderr.write(f'  {j["posted"]} | {j["title"][:44]:<46}| {j["company"][:24]:<26}| '
                         f'{j["salary"] or "-"}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
