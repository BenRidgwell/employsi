#!/usr/bin/env python3
"""
Scrape Auckland Airport's careers board and archive the roles to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
The markup needs no JavaScript — the rendered and unrendered HTML are identical,
five job tiles either way — so a Worker could parse it happily. What a Worker
cannot do is reach it: careers.aucklandairport.co.nz answers a plain datacentre
request with HTTP 403 and a 5.7 KB challenge page. Through Oxylabs on a New
Zealand IP the same URL returns 200 and the full listing, with `render` off.

So this runs off-Worker, but unrendered — it is the cheapest call that works,
and asking for a browser render we do not need would just cost more and add a
failure mode.

WHAT IT TALKS TO
The site is WordPress running the WPJobBoard plugin, server-rendering tiles:

    <div class="wpjb-job-tile ...">
      <a href="https://careers.aucklandairport.co.nz/job/<slug>/">
        <div class="wpjb-job-tile__title">…</div>
        <div class="wpjb-job-tile__company">…</div>
        <div class="wpjb-job-tile__job-type">…</div>
        <div class="wpjb-job-tile__location">…</div>

THE COUNTS ON THE PAGE ARE NOT VACANCY COUNTS. The sidebar advertises "Jobs by
Category — Commercial (18) … Operations (60)" summing to 134, and "Jobs by Type
— Full-time (128)". Those are historical totals, not live roles: the Operations
category page that claims 60 serves four tiles, and the union of all eight
category pages is the same five roles the index shows. Verified by collecting
every category and deduping — 5 unique. Anything that reported 134 here would be
reporting an archive count as current demand.

PAGING DOESN'T EXIST HERE, and it is worth being explicit about why the obvious
knob is ignored: `?results=N` looks like a page size or page index and is
neither — results=1, 2, 3, 20 and the bare URL all return the identical five
tiles, as do ?wpjb-page=2, ?pagination=2 and /jobs/page/2/. With five live roles
there is nothing to page. So the index and every category page are fetched and
unioned, which both covers the whole board and self-checks: if the index ever
starts truncating, the categories still find the rest.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD (only with --oxylabs; the default
     renders locally in a headless Chromium and needs no proxy)
Run: python scripts/aucklandairport-to-d1.py [--dry-run]
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

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

# Matches src/employsi/data/nzCompanies.ts: nzId("Auckland International
# Airport"). `portal-wpjb` is a new source tag — no other feed runs WPJobBoard.
SOURCE = 'portal-wpjb'
COMPANY_ID = 'nz-auckland-international-airport'
COMPANY = 'Auckland International Airport'
SECTOR = 'Airports & Aviation'
HOME_HUB = 'auckland'
BASE = 'https://careers.aucklandairport.co.nz'

# The eight categories the board publishes, read off the index's own nav on
# 2026-08-02. Fetching each is what proves the index is not truncating.
CATEGORIES = ['commercial', 'customer', 'digital', 'finance', 'infrastructure',
              'operations', 'risk-corporate-services', 'strategic-planning']

args = sys.argv[1:]
DRY = '--dry-run' in args

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── fetch + parse ─────────────────────────────────────────────────────────────
# Playwright on an ordinary runner by default; --oxylabs puts the proxy back.
#
# THE WALL IS AT THE HTTP LAYER, NOT THE ADDRESS. A plain datacentre request
# gets 403 and a Cloudflare challenge, which is what the residential exit was
# bought to avoid. But a REAL BROWSER on that same datacentre address clears the
# challenge: measured twice from a hosted runner
# (.github/workflows/probe-headless-ci.yml, 2026-08-08) at 56 job tiles both
# times. So the proxy was paying for a browser we can run ourselves — the same
# conclusion Stockland reached, arrived at from the opposite direction.
#
# The page needs no JavaScript to carry its jobs (verified identical rendered
# and not), so the browser is here only to satisfy the challenge.
VIA_OXYLABS = '--oxylabs' in args

SETTLE = [{'type': 'wait', 'wait_time_s': 6}]


def get(path: str) -> str | None:
    url = BASE + path
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, status = oxy_fetch(url, geo='New Zealand', render=False)
        if status and status != 200:
            sys.stderr.write(f'  {path}: status {status}\n')
        return content
    return browser_fetch.render(url, SETTLE, locale='en-NZ')


TILE_RE = re.compile(r'<div class="wpjb-job-tile[^"]*">\s*<a href="([^"]+)"(.*?)</a>', re.S)
POSTED_RE = re.compile(r'Posted:\s*([0-9]{1,2}\s+\w+\s+[0-9]{4})')
MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july',
     'august', 'september', 'october', 'november', 'december'])}


def field(block: str, name: str) -> str:
    m = re.search(r'wpjb-job-tile__' + name + r'">\s*(.*?)\s*</div>', block, re.S)
    return clean(m.group(1)) if m else ''


def iso_posted(block: str) -> str:
    m = POSTED_RE.search(clean(block))
    if not m:
        return ''
    try:
        d, mon, y = m.group(1).split()
        return f'{int(y):04d}-{MONTHS[mon.lower()]:02d}-{int(d):02d}'
    except Exception:
        return ''


def parse(page_html: str) -> list[dict]:
    out = []
    for url, block in TILE_RE.findall(page_html or ''):
        title = field(block, 'title')
        if not title:
            continue
        out.append({
            'url': url,
            'title': title,
            # Every role so far reads "Auckland International Airport"; the tile
            # is the source of truth rather than the home hub, so a role posted
            # elsewhere is recorded where it actually is.
            'location': field(block, 'location') or 'Auckland',
            'category': field(block, 'job-type') or 'Career portal',
            'posted': iso_posted(block),
        })
    return out


def scrape() -> list[dict]:
    jobs: dict[str, dict] = {}
    pages = [('/jobs/', 'index')] + [(f'/jobs/category/{c}/', c) for c in CATEGORIES]
    reached = 0
    for path, label in pages:
        page_html = get(path)
        if page_html is None:
            sys.stderr.write(f'  {label}: no content\n')
            continue
        reached += 1
        rows = parse(page_html)
        new = [r for r in rows if r['url'] not in jobs]
        for r in rows:
            jobs[r['url']] = r
        sys.stderr.write(f'  {label:26s} {len(rows):3d} tiles ({len(new)} new)\n')
        time.sleep(0.5)
    if not reached:
        sys.stderr.write('  every page failed to fetch\n')
    return list(jobs.values())


# ── skills parity via the worker's own taxonomy ───────────────────────────────
def map_skills(titles: list) -> list:
    if not titles:
        return []
    try:
        p = subprocess.run(
            ['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
            input=json.dumps({'titles': titles, 'sector': SECTOR}).encode(),
            capture_output=True, timeout=120, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


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


def upsert(jobs: list) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts, so a role already
    archived from another source refreshes rather than duplicating."""
    skills = map_skills([j['title'] for j in jobs])
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        key = job_key(SOURCE, j['title'], COMPANY, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], COMPANY, COMPANY_ID,
                     HOME_HUB, j['location'], j['category'], None,
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
    sys.stderr.write(f'Auckland Airport careers -> D1{", DRY RUN" if DRY else ""}\n')
    jobs = scrape()
    if not jobs:
        # This board legitimately runs small — five roles is a normal day — but
        # ZERO across the index AND all eight categories is the 403 challenge,
        # not an empty board. Writing nothing and exiting non-zero is the only
        # honest reading.
        sys.stderr.write(
            'No roles parsed from the index or any category. That is the Cloudflare challenge '
            'or a markup change, not an empty board.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} unique roles.\n')
    for j in jobs:
        sys.stderr.write(f'  - {j["title"][:52]:52s} | {j["category"][:12]:12s} | {j["posted"]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
