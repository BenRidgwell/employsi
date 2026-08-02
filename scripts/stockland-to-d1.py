#!/usr/bin/env python3
"""
Scrape Stockland's SuccessFactors career site and archive the roles to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
Every other SuccessFactors tenant on the roster (BHP, Woodside, ANZ, Origin …)
runs the modern Recruiting Marketing theme, which server-renders its job list —
so `fetchSuccessFactors` reads it with a plain GET. Stockland runs the OLD RCM
career portal instead, and that renders nothing server-side. Measured:

  * GET the listing URL, no JavaScript: 202 KB of page chrome, zero job rows.
    The body literally says "JavaScript is turned off in your web browser."
  * The search results arrive over DWR (`/xi/ajax/remoting`, the
    `careerJobSearchControllerProxy.search` method), whose request bodies are
    nested serialised objects — reimplementable, but brittle in a way a
    one-line theme change would break silently.
  * Through Oxylabs with rendering: the real list, 29 advertised.

So this runs rendered, off-Worker. A Cloudflare Worker cannot render a page.

WHAT IT TALKS TO

    GET https://career10.successfactors.com/career
        ?company=stocklanddP2&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH

The `_s.crb` CSRF token that appears in this URL when you copy it out of a
browser is NOT required — verified by fetching without it and getting the same
29-job list. It is deliberately not sent, because it is session-bound and
pasting a stale one would fail in a way that looks like an empty board.

PAGING IS CLICK-ONLY. Ten rows a page, three pages, and none of
`page`/`pageNum`/`startRow`/`jlsummary_page` changes what comes back — all six
were tried and all six returned page 1. The paginator is a JS control, so page
N is reached by clicking "Next Page" N-1 times in one rendered session. That
makes the walk quadratic in clicks, which is fine at three pages and is why
MAX_PAGES is deliberately low.

COLLECTED VS ADVERTISED
The board says "29 Jobs matched" and then serves 27 across its three pages
(10 + 10 + 7); page 4 clamps back to page 3. The 27 are what get archived and
the gap is reported, never back-filled — the same treatment Sonic HealthPlus's
Taleo board gets, where 22 are advertised and 18 served. A number nobody can
point at a row for is exactly what this codebase refuses to print.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/stockland-to-d1.py [--max-pages N] [--dry-run]
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

# Matches the roster: Stockland is ASX:SGP, plotted on Sydney.
# `portal-sf` is the SuccessFactors source tag used in careerSites.ts, so these
# rows dedupe against the Worker's SF rows on the shared job_key.
SOURCE = 'portal-sf'
COMPANY_ID = 'sydney-sgp'
COMPANY = 'Stockland'
SECTOR = 'Financial Services'
HOME_HUB = 'sydney'
BASE = 'https://career10.successfactors.com'
LISTING = (BASE + '/career?company=stocklanddP2'
           '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH')

args = sys.argv[1:]
# Three pages exist today. The cap is 6 so a genuine doubling of the board still
# completes, while a broken "Next" that never advances costs six renders, not
# forty — every extra page is another full browser render through Oxylabs.
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 6
DRY = '--dry-run' in args

# Seconds to let the RCM portal's DWR search settle before capturing, and again
# after each Next click. Six was measured against the live site; below that the
# capture can land on the "Updating…" state with no rows.
SETTLE_S = 6

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── hub mapping ───────────────────────────────────────────────────────────────
# Stockland does not print a city. It prints its own internal operating regions
# — the full observed vocabulary on 2026-08-02 was Sydney Metro (SMTR),
# Melbourne Metro (MMTR), Perth Metro (PMTR), Southern QLD (SQLD), Northern QLD
# (NQLD) and Western VIC (WVIC) — so the mapping is over THOSE strings, not over
# city names that never appear.
HUBS = [
    ('sydney', 'sydney'),
    ('melbourne', 'melbourne'),
    ('perth', 'perth'),
    ('adelaide', 'adelaide'),
    ('canberra', 'canberra'),
    ('brisbane', 'brisbane'),
    # State regions resolve to the capital, matching HUB_MATCH in careerSites.ts.
    ('qld', 'brisbane'),
    ('vic', 'melbourne'),
    ('nsw', 'sydney'),
    (' wa', 'perth'),
    (' sa', 'adelaide'),
]


def hub_for(loc: str) -> str:
    low = (loc or '').lower()
    for needle, hub in HUBS:
        if needle in low:
            return hub
    # Australia-only board, so an unrecognised region is still an Australian
    # role — falling back to the head office beats dropping it.
    return HOME_HUB


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


def parse_page(page_html: str) -> list[dict]:
    out = []
    for row in ROW_RE.findall(page_html or ''):
        m = TITLE_RE.search(row)
        if not m:
            continue
        title = clean(m.group(3))
        if not title:
            continue
        # The note line is a run of <span class="jobContentEM"> cells:
        #   [req id, "Posted on 31/07/2026", (state), employment type,
        #    job family, region]
        # Only the first two are positional; the region is reliably LAST, in its
        # own div. So the region is taken from the end and the date by pattern,
        # rather than by index — a tenant that adds a cell mid-list still parses.
        ems = [clean(x) for x in EM_RE.findall(row)]
        ems = [x for x in ems if x]
        loc = ems[-1] if ems else ''
        pm = POSTED_RE.search(row)
        posted = f'{pm.group(3)}-{pm.group(2)}-{pm.group(1)}' if pm else ''
        href = html.unescape(m.group(1))
        out.append({
            'id': m.group(2),
            'title': title,
            # The href carries a session-bound _s.crb that is meaningless to
            # anyone else, so the stored link is the stable requisition URL.
            'url': (f'{BASE}/career?company=stocklanddP2&career_ns=job_listing'
                    f'&career_job_req_id={m.group(2)}') if 'career_job_req_id' in href else href,
            'location': loc,
            'category': 'Career portal',
            'posted': posted,
        })
    return out


ADVERTISED_RE = re.compile(r'(\d[\d,]*)\s+Jobs matched')


def scrape() -> tuple[list[dict], int]:
    """Returns (rows, advertised_total). Raises nothing: an empty list is the
    caller's signal to exit non-zero rather than write a false zero."""
    jobs: dict[str, dict] = {}
    advertised = 0
    for page in range(1, MAX_PAGES + 1):
        page_html = render(page)
        if not page_html:
            sys.stderr.write(f'  page {page}: no content from Oxylabs\n')
            break
        m = ADVERTISED_RE.search(re.sub(r'<[^>]+>', '', html.unescape(page_html)))
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
        # A page past the last one CLAMPS to the last page rather than coming
        # back empty, so "every row already seen" is the end-of-list signal.
        # Testing for a short page instead would loop to MAX_PAGES re-reading
        # the final page every time.
        if not new:
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
    sys.stderr.write(f'Stockland careers -> D1{", DRY RUN" if DRY else ""}\n')
    jobs, advertised = scrape()
    if not jobs:
        # An empty pull means the render failed or the theme changed. It does
        # not mean Stockland stopped hiring, so it must not be written and must
        # not exit 0.
        sys.stderr.write(
            'No roles parsed. The SuccessFactors RCM portal returned no jobResultItem rows '
            '— either the render did not settle, or the result markup changed.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed'
                     f'{f" of {advertised} advertised" if advertised else ""}.\n')
    if advertised and len(jobs) < advertised:
        # Reported, not back-filled. Measured at 27 of 29 on 2026-08-02, stable
        # across repeat runs: the board's own counter exceeds what its paginator
        # will serve anonymously.
        sys.stderr.write(
            f'  note: board advertises {advertised} but serves {len(jobs)} across its pages; '
            'archiving what it served.\n')
    for j in jobs[:5]:
        sys.stderr.write(f'  - {j["title"][:56]} | {j["location"][:24]} | {j["posted"]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
