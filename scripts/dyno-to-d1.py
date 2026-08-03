#!/usr/bin/env python3
"""
Scrape Dyno Nobel's SuccessFactors career site and archive the roles to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
Same reason as Sandfire and Stockland: this is the OLD SuccessFactors RCM career
portal (`/career?company=…`), not the modern Recruiting Marketing theme that
`fetchSuccessFactors` reads. It server-renders no job rows at all — measured, a
plain fetch of the listing URL returns 196 KB carrying zero `career_job_req_id`
— and fetches its results over DWR after load. A Cloudflare Worker cannot render
a page, so this runs as a GitHub Action through Oxylabs.

WHICH BOARD, AND WHY THIS ONE
dynonobel.com.au/careers/opportunities/ links out to two ATSs and names which is
which: career4.successfactors.com/career?company=IncitecPivot for "Australia and
Indonesia", and a Taleo instance (tbe.taleo.net, org=DYNONOBEL) for North
America. The tenant is still called IncitecPivot because the SuccessFactors
instance predates the demerger. Only the AU/Indonesia board is read here — the
roster company is the Australian listing.

PAGING IS A CLICK, NOT A PARAMETER. The paginator is `juic.fire(…,"_next")`, so
there is no startrow to increment; the walk clicks "Next Page" and re-captures.
Verified 2026-08-03: page 2 returned ten requisition ids with zero overlap
against page 1. The board prints its own total ("33 Jobs matched your search"),
which bounds the walk instead of a short page.

LOCATION. Each row's note line is
`Requisition ID: <id> - Posted on <date> - <site> - <country> - <work type>`,
and the site is Dyno's own name for it: "AU Moranbah", "AU Christmas Creek",
"AU Brisbane HQ". Most are mine sites that no hub table lists, so the COUNTRY
cell is appended to the location before hub resolution — that is the board's own
statement that the role is in Australia, and it is what lets hubFor fall back to
the company's home hub rather than leaving the row unplaced. Nothing is invented:
where the site names a city ("AU Brisbane HQ") the row places on that city.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/dyno-to-d1.py [--max-pages N] [--dry-run]
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

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

# `portal-sf` is the SuccessFactors source tag careerSites.ts uses, so these rows
# dedupe against a Worker-collected SF row for the same requisition.
SOURCE = 'portal-sf'
COMPANY_ID = 'melbourne-dnl'
COMPANY = 'Dyno Nobel'
SECTOR = 'Explosives & Chemicals'
HOME_HUB = 'melbourne'
BASE = 'https://career4.successfactors.com'
TENANT = 'IncitecPivot'
LISTING = (f'{BASE}/career?company={TENANT}&career_ns=job_listing_summary'
           '&navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB')

args = sys.argv[1:]
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 8
DRY = '--dry-run' in args

# Seconds to let the RCM portal's DWR search settle before capturing, and again
# after each Next click. Eight is what the Sandfire scraper measured against the
# same platform; at six the capture lands on "Loading…" about one run in three.
SETTLE_S = 8

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── fetch + parse ─────────────────────────────────────────────────────────────
NEXT_CLICK = {'type': 'click',
              'selector': {'type': 'xpath', 'value': "(//a[@title='Next Page'])[1]"}}


def render(page: int) -> str | None:
    """Render the listing and click through to `page` (1-based)."""
    from oxylabs_client import fetch as oxy_fetch
    instructions: list[dict] = [{'type': 'wait', 'wait_time_s': SETTLE_S}]
    for _ in range(page - 1):
        instructions.append(NEXT_CLICK)
        instructions.append({'type': 'wait', 'wait_time_s': SETTLE_S})
    content, _ = oxy_fetch(LISTING, geo='Australia', render=True,
                           extra={'browser_instructions': instructions})
    return content


ROW_RE = re.compile(r'<tr class="jobResultItem">(.*?)</tr>', re.S)
TITLE_RE = re.compile(
    r'<a class="jobTitle"[^>]*href="([^"]*career_job_req_id=(\d+)[^"]*)"[^>]*>(.*?)</a>',
    re.S)
EM_RE = re.compile(r'<span class="jobContentEM">(.*?)</span>', re.S)
POSTED_RE = re.compile(r'Posted on\s*(\d{2})/(\d{2})/(\d{4})')
ADVERTISED_RE = re.compile(r'(\d[\d,]*)\s+Jobs?\s+matched')


def parse_page(page_html: str) -> list[dict]:
    out = []
    for row in ROW_RE.findall(page_html or ''):
        m = TITLE_RE.search(row)
        if not m:
            continue
        title = clean(m.group(3))
        if not title:
            continue
        # [requisition id, "Posted on dd/mm/yyyy", site, country, work type].
        # Read positionally because only the first two are self-describing, and
        # guarded by length because a tenant that drops a cell would otherwise
        # shift the country into the location.
        cells = [clean(c) for c in EM_RE.findall(row)]
        site = cells[2] if len(cells) > 2 else ''
        country = cells[3] if len(cells) > 3 else ''
        pm = POSTED_RE.search(row)
        out.append({
            'id': m.group(2),
            'title': title,
            'location': ', '.join([c for c in (site, country) if c]),
            'category': cells[4] if len(cells) > 4 else 'Career portal',
            # The href carries a session-bound _s.crb that is meaningless to
            # anyone else, so the stored link is the stable requisition URL.
            'url': (f'{BASE}/career?company={TENANT}&career_ns=job_listing'
                    f'&career_job_req_id={m.group(2)}&rcm_site_locale=en_GB'),
            'posted': f'{pm.group(3)}-{pm.group(2)}-{pm.group(1)}' if pm else '',
        })
    return out


def scrape() -> tuple[list[dict], int]:
    """Returns (rows, advertised_total). An empty list is the caller's signal to
    exit non-zero rather than write a false zero."""
    jobs: dict[str, dict] = {}
    advertised = 0
    for page in range(1, MAX_PAGES + 1):
        page_html = render(page)
        if not page_html:
            sys.stderr.write(f'  page {page}: no content from Oxylabs\n')
            break
        m = ADVERTISED_RE.search(re.sub(r'<[^>]+>', ' ', html.unescape(page_html)))
        if m:
            advertised = int(m.group(1).replace(',', ''))
        rows = parse_page(page_html)
        if not rows:
            sys.stderr.write(f'  page {page}: no job rows — stopping.\n')
            break
        new = [r for r in rows if r['id'] not in jobs]
        for r in rows:
            jobs[r['id']] = r
        sys.stderr.write(f'  page {page}: {len(rows)} rows ({len(new)} new), '
                         f'{len(jobs)} collected of {advertised or "?"}\n')
        # A page past the last one clamps back to the last page rather than
        # coming back empty, so "every row already seen" is the end-of-list
        # signal — the behaviour this platform's paginator shows everywhere.
        if not new:
            break
        if advertised and len(jobs) >= advertised:
            break
        time.sleep(1)
    return list(jobs.values()), advertised


# ── parity bridges to the worker's own taxonomy and hub table ─────────────────
def _bridge(script: str, payload, fallback):
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, script)],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=120, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  {script} failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  {script} error: {e}\n')
    return fallback


def map_skills(titles: list) -> list:
    if not titles:
        return []
    return _bridge('map-skills.ts', {'titles': titles, 'sector': SECTOR},
                   [[] for _ in titles])


def map_hubs(locations: list) -> list:
    if not locations:
        return []
    return _bridge('map-hubs.ts', {'locations': locations, 'home': HOME_HUB},
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


def upsert(jobs: list) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts, so a role already
    archived from another source refreshes rather than duplicating."""
    skills = map_skills([j['title'] for j in jobs])
    hubs = map_hubs([j['location'] for j in jobs])
    rows, seen = [], set()
    for j, sk, hub in zip(jobs, skills, hubs):
        key = job_key(SOURCE, j['title'], COMPANY, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], COMPANY, COMPANY_ID,
                     hub, j['location'], j['category'], None,
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
    sys.stderr.write(f'Dyno Nobel careers -> D1{", DRY RUN" if DRY else ""}\n')
    jobs, advertised = scrape()
    if not jobs:
        # ZERO is the "Loading…" capture or a theme change, not an empty board:
        # a 3,000-person explosives manufacturer with operations in five states
        # does not stop advertising. Writing nothing and exiting non-zero is the
        # only honest reading.
        sys.stderr.write(
            'No roles parsed. The SuccessFactors RCM portal returned no jobResultItem rows '
            '— either the render did not settle, or the listing URL changed.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed'
                     f'{f" of {advertised} advertised" if advertised else ""}.\n')
    if advertised and len(jobs) < advertised:
        sys.stderr.write(
            f'  note: board advertises {advertised} but serves {len(jobs)} across its pages; '
            'archiving what it served.\n')
    hubs = map_hubs([j['location'] for j in jobs])
    for j, hub in zip(jobs, hubs):
        sys.stderr.write(f'  - {j["title"][:46]:46s} | {j["location"][:30]:30s} '
                         f'| {hub or "unplaced"} | {j["posted"]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
