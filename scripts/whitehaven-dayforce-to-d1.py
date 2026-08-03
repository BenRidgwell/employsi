#!/usr/bin/env python3
"""
Scrape Whitehaven Coal's Dayforce candidate portal and archive the roles to D1.

WHITEHAVEN ADVERTISES ON TWO BOARDS AND THIS IS THE SECOND ONE.
The other is a SuccessFactors Recruiting Marketing site
(careers.whitehavencoal.com.au) which the Worker reads in-process as
`sydney-whc-sf` — measured 2026-08-03: 9 roles, all Queensland. This one is the
Dayforce candidate portal, which carries the New South Wales operations
(Gunnedah, Maules Creek, Narrabri). Both write the same company id, and the
shared job_key means a role that somehow appeared on both would collapse to one
row rather than double-count.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
The portal is a client-rendered Next.js app whose HTML carries no vacancies at
all; the list is fetched after hydration from

    POST https://jobs.dayforcehcm.com/api/geo/<tenant>/jobposting/search

Reading that API directly is the obvious route and it does not work from a
server: measured 2026-08-03, the path exists (GET returns 405, so it is not a
typo) but every POST returns a bare 403 "Forbidden" behind Cloudflare — with a
browser User-Agent, with an Origin and Referer, and with the portal's own
session cookies attached. That is Cloudflare bot management refusing a
datacentre IP, and a Cloudflare Worker would fare worse rather than better
(SEEK already 403s this project on a Cloudflare-to-Cloudflare fingerprint).

So the portal is RENDERED through Oxylabs on a residential IP, which returns the
hydrated job list as ordinary HTML. Same shape as the NAB and Sandfire feeds.

PAGING is an Ant Design paginator with no URL parameter, so it is clicked. The
number of `ant-pagination-item-N` entries in the rendered page is the board's
own statement of how many pages there are, which bounds the walk — the board
prints no total anywhere else.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/whitehaven-dayforce-to-d1.py [--max-pages N] [--dry-run]
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

SOURCE = 'portal-dayforce'
COMPANY_ID = 'sydney-whc'
COMPANY = 'Whitehaven Coal'
SECTOR = 'Coal Mining'
HOME_HUB = 'sydney'
PORTAL = 'https://jobs.dayforcehcm.com/en-AU/whitehavencoal/CANDIDATEPORTAL'

args = sys.argv[1:]
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 10
DRY = '--dry-run' in args

# Seconds to let the portal hydrate and fetch its list before capturing, and
# again after each page click. Eight was enough on every capture taken while
# building this; the failure mode if it is not is an empty card list, which the
# guard in main() turns into a red run rather than a silent zero.
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
def render(page: int) -> str | None:
    """Render the portal and click through to `page` (1-based)."""
    from oxylabs_client import fetch as oxy_fetch
    instructions: list[dict] = [{'type': 'wait', 'wait_time_s': SETTLE_S}]
    if page > 1:
        # Click the numbered page rather than "next" repeatedly: Ant renders the
        # numbers as real anchors, and one click is one fewer render step to go
        # wrong than N-1 chained ones.
        instructions.append({
            'type': 'click',
            'selector': {'type': 'css', 'value': f'.ant-pagination-item-{page} a'},
        })
        instructions.append({'type': 'wait', 'wait_time_s': SETTLE_S})
    content, _ = oxy_fetch(PORTAL, geo='Australia', render=True,
                           extra={'browser_instructions': instructions}, timeout=300)
    return content


CARD_RE = re.compile(r'test-id="job-posting-card"\s+job-posting-id="(\d+)"(.*?)(?=test-id="job-posting-card"|$)', re.S)
TITLE_RE = re.compile(r'test-id="job-title"[^>]*>(.*?)</h2>', re.S)
LOC_RE = re.compile(r'test-id="job-location"[^>]*>(.*?)</div>', re.S)
POSTED_RE = re.compile(r'test-id="job-posted-date-expiry"[^>]*>(.*?)</div>', re.S)
PAGE_ITEM_RE = re.compile(r'class="ant-pagination-item ant-pagination-item-(\d+)')

MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
     'september', 'october', 'november', 'december'])}


def posted_iso(text: str) -> str:
    """"Posted Monday 3 August 2026 | Expires …" -> 2026-08-03.

    Only the POSTED half is read. The string carries an expiry date too, and
    letting that reach the archive's `posted` column is the exact confusion
    jobs_extract.iso_date exists to prevent."""
    m = re.search(r'Posted\s+\w+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', text or '')
    if not m:
        return ''
    mon = MONTHS.get(m.group(2).lower())
    return f'{m.group(3)}-{mon:02d}-{int(m.group(1)):02d}' if mon else ''


def parse_page(page_html: str) -> tuple[list[dict], int]:
    """(rows, pages the paginator advertises)."""
    out = []
    for jid, block in CARD_RE.findall(page_html or ''):
        t = TITLE_RE.search(block)
        if not t:
            continue
        title = clean(t.group(1))
        if not title:
            continue
        loc = LOC_RE.search(block)
        pos = POSTED_RE.search(block)
        out.append({
            'id': jid,
            'title': title,
            'location': clean(loc.group(1)) if loc else '',
            'url': f'{PORTAL}/jobs/{jid}',
            'posted': posted_iso(clean(pos.group(1)) if pos else ''),
            'category': 'Career portal',
        })
    pages = [int(n) for n in PAGE_ITEM_RE.findall(page_html or '')]
    return out, (max(pages) if pages else 1)


def scrape() -> list[dict]:
    jobs: dict[str, dict] = {}
    pages = 1
    page = 1
    while page <= min(pages, MAX_PAGES):
        page_html = render(page)
        if not page_html:
            sys.stderr.write(f'  page {page}: no content from Oxylabs\n')
            break
        rows, advertised_pages = parse_page(page_html)
        pages = max(pages, advertised_pages)
        if not rows:
            sys.stderr.write(f'  page {page}: no job cards — stopping.\n')
            break
        new = [r for r in rows if r['id'] not in jobs]
        for r in rows:
            jobs[r['id']] = r
        sys.stderr.write(f'  page {page}/{pages}: {len(rows)} cards ({len(new)} new), '
                         f'{len(jobs)} collected\n')
        # A click that did not land re-renders page 1, so "nothing new" past the
        # first page means the walk stopped moving rather than reached the end.
        if page > 1 and not new:
            sys.stderr.write('  page repeated — pagination click did not land; stopping.\n')
            break
        page += 1
        time.sleep(1)
    return list(jobs.values())


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
    return _bridge('map-skills.ts', {'titles': titles, 'sector': SECTOR},
                   [[] for _ in titles]) if titles else []


def map_hubs(locations: list) -> list:
    return _bridge('map-hubs.ts', {'locations': locations, 'home': HOME_HUB},
                   [None for _ in locations]) if locations else []


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
    sys.stderr.write(f'Whitehaven Coal (Dayforce) -> D1{", DRY RUN" if DRY else ""}\n')
    jobs = scrape()
    if not jobs:
        # ZERO is a render that did not settle or a theme change, not an empty
        # board: Whitehaven runs six mines across two states. Writing nothing
        # and exiting non-zero is the only honest reading — and it leaves
        # yesterday's rows in the archive to age out on their own.
        sys.stderr.write('No job cards parsed from the Dayforce portal. Nothing written.\n')
        return 1
    hubs = map_hubs([j['location'] for j in jobs])
    sys.stderr.write(f'{len(jobs)} roles parsed.\n')
    for j, hub in zip(jobs, hubs):
        sys.stderr.write(f'  - {j["title"][:46]:46s} | {j["location"][:32]:32s} '
                         f'| {hub or "unplaced"} | {j["posted"] or "-"}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
