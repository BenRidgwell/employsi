#!/usr/bin/env python3
"""
Scrape Bendigo & Adelaide Bank's careers board and archive the roles to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
careers.bendigobank.com.au IS SuccessFactors, but not the theme
`fetchSuccessFactors` reads. BHP, Woodside, ANZ and the rest run the Recruiting
Marketing theme, which server-renders `<tr class="data-row">` or
`<div class="job-tile-cell">` and needs no JavaScript. Bendigo runs the newer
UI5/React "NES" theme, which server-renders nothing. Measured:

  * GET /search/?q=&startrow=0 unrendered: 138 KB, zero `/job/` links, no
    `data-row`, no `job-tile-cell`.
  * The same URL rendered: 81 advertised, ten job cards.
  * /viewalljobs/ — the path the shell itself references, and the obvious way
    to skip paging — returns the same page chrome with zero rows both rendered
    and not. It is a dead route on this tenant.

So this runs rendered, off-Worker. A Cloudflare Worker cannot render a page.

(The bendigoadelaide.com.au host is a red herring worth naming: careers.
bendigoadelaide.com.au does not resolve, and the corporate site's careers page
links out to bendigobank.com.au. Only the retail brand's host serves the board.)

PAGING IS CLICK-ONLY, the same trap the Stockland portal sets in a different
theme. `startrow` looks like it works because page 1 is a valid answer: with
startrow=10 and startrow=70 the rendered page is byte-for-byte page 1, the same
ten ids and the same "job posting 1 of 81". So page N is reached by clicking
`[data-testid="goToNextPageBtn"]` N-1 times inside one rendered session, which
makes the walk quadratic in clicks — nine pages is 36 — and is why MAX_PAGES
stays low.

THE CLASS NAMES ARE HASHED (`JobsList_jobCardTitle__pRNjw`) and change whenever
SAP rebuilds the bundle, so every field is read off its `data-testid` instead.
The footer is a run of label/value span pairs — Job ID, Business Unit, Category,
Employment Type, Employee Class, Posted On, Closing Date — and Category is
missing on some cards, so they are read as a dictionary by label rather than by
position.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/bendigo-to-d1.py [--max-pages N] [--dry-run]
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

# `portal-sf` is the SuccessFactors source tag used in careerSites.ts, so these
# rows dedupe against the Worker's SF rows on the shared job_key.
SOURCE = 'portal-sf'
COMPANY_ID = 'melbourne-ben'
COMPANY = 'Bendigo & Adelaide Bank'
SECTOR = 'Financial Services'
HOME_HUB = 'melbourne'
BASE = 'https://careers.bendigobank.com.au'
LISTING = f'{BASE}/search/?q=&startrow=0'

args = sys.argv[1:]
# 81 roles at ten a page is nine. 14 leaves room for the board to grow by half
# before the bound bites, and the walk stops on the advertised total first.
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 14
DRY = '--dry-run' in args

# Seconds for the first render, and after each Next click. Measured: the list is
# redrawn client-side from an XHR, so 4s after a click is enough (verified —
# page 2 came back with ten new ids and "job posting 11 of 81"), while the
# initial load needs longer because the whole bundle boots first.
SETTLE_S = 7
CLICK_SETTLE_S = 4

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── hub mapping ───────────────────────────────────────────────────────────────
# Locations read "Hamilton, VIC, AUS, 3300" — town, state, country, postcode.
# This is a branch network, so most towns are regional and only the state is
# reliably mappable; the state is therefore what the list is over. Specific
# before general so a capital city beats its state.
HUBS = [
    ('melbourne', 'melbourne'),
    ('sydney', 'sydney'),
    ('brisbane', 'brisbane'),
    ('adelaide', 'adelaide'),
    ('perth', 'perth'),
    ('canberra', 'canberra'),
    ('darwin', 'darwin'),
    ('hobart', 'hobart'),
    # State codes. These appear comma-delimited, so the comma is part of the
    # needle — without it "VIC" would also match inside a town name.
    (' vic,', 'melbourne'),
    (' nsw,', 'sydney'),
    (' qld,', 'brisbane'),
    (' sa,', 'adelaide'),
    (' wa,', 'perth'),
    (' act,', 'canberra'),
    (' nt,', 'darwin'),
    (' tas,', 'hobart'),
]


def hub_for(loc: str) -> str:
    # A trailing comma so a state code that ends the string still matches, the
    # same fix careerSites.ts's hubFor carries.
    low = (loc or '').lower() + ','
    for needle, hub in HUBS:
        if needle in low:
            return hub
    # Australia-only board, so an unrecognised town is still an Australian role
    # — falling back to the head office beats dropping it.
    return HOME_HUB


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── fetch + parse ─────────────────────────────────────────────────────────────
NEXT_CLICK = {'type': 'click',
              'selector': {'type': 'css', 'value': '[data-testid="goToNextPageBtn"]'}}


def render(page: int) -> str | None:
    """Render the listing and click through to `page` (1-based)."""
    from oxylabs_client import fetch as oxy_fetch
    instructions: list[dict] = [{'type': 'wait', 'wait_time_s': SETTLE_S}]
    for _ in range(page - 1):
        instructions.append(NEXT_CLICK)
        instructions.append({'type': 'wait', 'wait_time_s': CLICK_SETTLE_S})
    content, _ = oxy_fetch(LISTING, geo='Australia', render=True,
                           extra={'browser_instructions': instructions})
    return content


TITLE_RE = re.compile(
    r'href="(/job/[^"]*?/(\d+)-[A-Za-z_]+)"[^>]*data-testid="jobCardTitle_\d+"[^>]*>(.*?)</a>',
    re.S)
# The anchor's attribute order is not guaranteed across builds, so the testid is
# also accepted before the href.
TITLE_ALT_RE = re.compile(
    r'data-testid="jobCardTitle_\d+"[^>]*href="(/job/[^"]*?/(\d+)-[A-Za-z_]+)"[^>]*>(.*?)</a>',
    re.S)
LOC_RE = re.compile(r'data-testid="jobCardLocation"[^>]*>(.*?)</div>', re.S)
PAIR_RE = re.compile(
    r'jobCardFooterLabel[^>]*>(.*?)</span>\s*<span[^>]*jobCardFooterValue[^>]*>(.*?)</span>',
    re.S)
ADVERTISED_RE = re.compile(r'job posting \d+ of (\d+)')
DATE_RE = re.compile(r'^(\d{2})/(\d{2})/(\d{4})$')


def parse_page(page_html: str) -> list[dict]:
    out = []
    for card in re.split(r'<li[^>]*data-testid="jobCard"', page_html or '')[1:]:
        m = TITLE_RE.search(card) or TITLE_ALT_RE.search(card)
        if not m:
            continue
        title = clean(m.group(3))
        if not title:
            continue
        fields = {clean(k): clean(v) for k, v in PAIR_RE.findall(card)}
        loc = LOC_RE.search(card)
        # dd/mm/yyyy on this tenant — reordered explicitly rather than handed to
        # a parser that would read it as the US ordering.
        posted, d = '', DATE_RE.match(fields.get('Posted On', ''))
        if d:
            posted = f'{d.group(3)}-{d.group(2)}-{d.group(1)}'
        out.append({
            'id': m.group(2),
            'title': title,
            'url': BASE + m.group(1),
            'location': clean(loc.group(1)) if loc else '',
            'category': ' — '.join(
                x for x in (fields.get('Category'), fields.get('Business Unit'),
                            fields.get('Employment Type')) if x) or 'Career portal',
            'posted': posted,
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
        m = ADVERTISED_RE.search(page_html)
        if m:
            advertised = int(m.group(1))
        rows = parse_page(page_html)
        if not rows:
            sys.stderr.write(f'  page {page}: no job cards — stopping.\n')
            break
        new = [r for r in rows if r['id'] not in jobs]
        for r in rows:
            jobs[r['id']] = r
        sys.stderr.write(f'  page {page}: {len(rows)} cards ({len(new)} new), '
                         f'{len(jobs)} collected of {advertised or "?"}\n')
        # "Every row already seen" is the end-of-list signal: the Next button
        # disables on the last page, so a further click leaves the list where it
        # is rather than returning an empty one.
        if not new:
            break
        if advertised and len(jobs) >= advertised:
            break
        time.sleep(1)
    return list(jobs.values()), advertised


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
                     hub_for(j['location']), j['location'], j['category'], None,
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
    sys.stderr.write(f'Bendigo & Adelaide Bank careers -> D1{", DRY RUN" if DRY else ""}\n')
    jobs, advertised = scrape()
    if not jobs:
        # An empty pull means the render failed or the theme changed. It does
        # not mean the bank stopped hiring, so it must not be written and must
        # not exit 0.
        sys.stderr.write(
            'No roles parsed. The board returned no jobCard elements — either the render did '
            'not settle, or the card markup changed.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed'
                     f'{f" of {advertised} advertised" if advertised else ""}.\n')
    if advertised and len(jobs) < advertised:
        # Reported, not back-filled — the same treatment Stockland's board gets,
        # where 29 are advertised and 27 served.
        sys.stderr.write(
            f'  note: board advertises {advertised} but serves {len(jobs)} across its pages; '
            'archiving what it served.\n')
    for j in jobs[:6]:
        sys.stderr.write(f'  - {j["title"][:50]:50s} | {j["location"][:26]:26s} '
                         f'| {hub_for(j["location"]):9s} | {j["posted"]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
