#!/usr/bin/env python3
"""
Scrape TechnologyOne's careers board and archive the roles to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
Same shape as Auckland Airport: readable, but not reachable. The vacancies are
plain server-rendered HTML — a `<table class="vacancies">` sitting in the page
source, identical with and without JavaScript (verified: 34 rows either way) —
but a plain datacentre request gets HTTP 403 and a 5.7 KB challenge page. It
needs a residential exit, not a browser, so it is fetched UNRENDERED.

A note on how this was nearly missed: the first pass concluded the page had no
jobs, because it searched the HTML for links matching /job|vacanc|position/.
Every apply link points at TechnologyOne's own ERP —

    https://tne.t1cloud.com/T1Default/CiAnywhere/Web/TNE/Public/Function/
      $ORG.REC.EXAPN.WIZ/RECRUIT_EXT?suite=CES&token=<uuid>

— which contains "RECRUIT", not "job". The rows were there the whole time. Hence
this parser keys off the table markup, not off what the URLs happen to spell.

THE BOARD IS ONE PAGE. The table carries `data-pagecount="20"` and a
`pagination` class, but that is CLIENT-side paging over rows that are all
already in the HTML — all 34 are present in a single fetch. There is nothing to
walk, and adding a page loop would just re-read the same rows.

LOCATIONS ARE STATE LISTS, not cities. A role reads "Queensland", or
"Queensland, Victoria, New South Wales, New Zealand" when it is open in several.
Only the FIRST is used to place the role: a vacancy open in seven states is one
vacancy, and copying it onto seven maps would multiply the count sevenfold.
Four roles list no location at all and fall back to the Brisbane head office.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/technologyone-to-d1.py [--dry-run]
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

# Matches the roster: TechnologyOne is ASX:TNE, head office Brisbane.
# `portal-t1` — no other feed runs this board.
SOURCE = 'portal-t1'
COMPANY_ID = 'brisbane-tne'
COMPANY = 'TechnologyOne'
SECTOR = 'Technology, Media and Telecommunications'
HOME_HUB = 'brisbane'
# technologyonecorp.com redirects here; this is the current domain.
LISTING = 'https://www.technology1.com/company/life-at-techone/join-the-team'

args = sys.argv[1:]
DRY = '--dry-run' in args

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── hub mapping ───────────────────────────────────────────────────────────────
# The board names STATES, so the mapping is over states, plus New Zealand, which
# it lists as a location in its own right.
HUBS = [
    ('queensland', 'brisbane'),
    ('new south wales', 'sydney'),
    ('victoria', 'melbourne'),
    ('western australia', 'perth'),
    ('south australia', 'adelaide'),
    ('australian capital territory', 'canberra'),
    ('new zealand', 'auckland'),
    # Tasmania and the Northern Territory appear on multi-state roles but have
    # no hub of their own (Hobart and Darwin are deliberately not markers), so
    # they are absent here and fall through to the head office.
]


def hub_for(loc: str) -> str:
    low = (loc or '').lower()
    for needle, hub in HUBS:
        if needle in low:
            return hub
    return HOME_HUB


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── fetch + parse ─────────────────────────────────────────────────────────────
# Playwright on an ordinary runner by default; --oxylabs puts the proxy back.
# Same finding as Auckland Airport: the 403 a datacentre request gets is a
# Cloudflare challenge at the HTTP layer, and a real browser on that same
# address clears it — measured twice from a hosted runner
# (.github/workflows/probe-headless-ci.yml, 2026-08-08) at 37 rows both times.
VIA_OXYLABS = '--oxylabs' in args

SETTLE = [{'type': 'wait', 'wait_time_s': 8}]


def get() -> str | None:
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, status = oxy_fetch(LISTING, geo='Australia', render=False)
        if status and status != 200:
            sys.stderr.write(f'  listing returned status {status}\n')
        return content
    return browser_fetch.render(LISTING, SETTLE, locale='en-AU')


ROW_RE = re.compile(r'<tr data-referrals="[^"]*">(.*?)</tr>', re.S)
CELL_RE = re.compile(r'<td[^>]*>(.*?)</td>', re.S)
HREF_RE = re.compile(r'<a[^>]*href="([^"]+)"', re.S)

# The served HTML suffixes every state with a bare " WL" — "Queensland WL",
# "Western Australia WL, New South Wales WL, …". It is an internal marker, and
# the page's OWN JavaScript strips it before display: the rendered DOM reads
# "Queensland". So this removes exactly that token and nothing else, which
# reproduces what TechnologyOne actually publishes rather than guessing at an
# abbreviation. Anchored per comma-separated segment and to the whole token, so
# a real place ending in those letters is untouched.
WL_RE = re.compile(r'\s+WL\b')


def tidy_location(s: str) -> str:
    return re.sub(r'\s*,\s*', ', ', WL_RE.sub('', s or '')).strip().strip(',').strip()


def parse(page_html: str) -> list[dict]:
    out, seen = [], set()
    for row in ROW_RE.findall(page_html or ''):
        cells = CELL_RE.findall(row)
        if len(cells) < 3:
            continue
        title = clean(cells[0])
        if not title:
            continue
        href = HREF_RE.search(cells[0])
        url = html.unescape(href.group(1)) if href else LISTING
        # First state only — see the module docstring on multi-state roles.
        loc_full = tidy_location(clean(cells[2]))
        loc = loc_full.split(',')[0].strip()
        key = (title, loc_full)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            'title': title,
            'url': url,
            # The full list is kept as the location text so the card shows every
            # state the role is open in; only the placement uses the first.
            'location': loc_full or 'Brisbane',
            'hub': hub_for(loc or loc_full),
            'category': clean(cells[1]) or 'Career portal',
        })
    return out


def scrape() -> list[dict]:
    page_html = get()
    if not page_html:
        return []
    rows = parse(page_html)
    sys.stderr.write(f'  listing: {len(rows)} rows ({len(page_html)} bytes)\n')
    return rows


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
        # The board publishes no posting date, so first_seen is the honest
        # stand-in — inventing one would put a date on a row nothing supports.
        rows.append((key, SOURCE, j['title'], COMPANY, COMPANY_ID,
                     j['hub'], j['location'], j['category'], None,
                     j['url'], TODAY, json.dumps(sk) if sk else None))
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
    sys.stderr.write(f'TechnologyOne careers -> D1{", DRY RUN" if DRY else ""}\n')
    jobs = scrape()
    if not jobs:
        # Zero means the 403 challenge won or the table markup changed. It does
        # not mean TechnologyOne stopped hiring, so nothing is written and the
        # run fails loudly.
        sys.stderr.write(
            'No roles parsed. The vacancies table returned no rows — either the Cloudflare '
            'challenge blocked the fetch, or the table markup changed.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed.\n')
    for j in jobs[:5]:
        sys.stderr.write(f'  - {j["title"][:46]:46s} | {j["hub"]:10s} | {j["location"][:34]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
