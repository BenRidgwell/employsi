#!/usr/bin/env python3
"""
Scrape Sandfire Resources' SuccessFactors career site and archive the roles to D1.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
Same reason as Stockland: this is the OLD SuccessFactors RCM career portal
(`/career?company=…`), not the modern Recruiting Marketing theme that
`fetchSuccessFactors` reads. It server-renders no job rows at all and fetches
its results over DWR after load, so it needs a real browser, and a Cloudflare
Worker cannot render a page.

RENDERED LOCALLY, NOT THROUGH A PROXY. This used Oxylabs' render=True purely for
the browser — never for a residential IP. Measured 2026-08-04 on ubuntu-latest
(.github/workflows/probe-headless-ci.yml), a headless Chromium on an ordinary CI
address reads this board fine, so it now drives a local Playwright through the
SAME instruction list (see scripts/browser_fetch.py). `--oxylabs` hands that list
back to the proxy unchanged.

FINDING THE LISTING WAS THE WHOLE DIFFICULTY. The URL sandfire.com.au links to
is the portal's landing page, and rendering THAT returns a permanent "Loading…"
with zero rows however long you wait — which reads exactly like a broken
scraper. The listing is a different `career_ns`:

    GET https://career55.sapsf.eu/career
        ?company=minasdeagu&career_ns=job_listing_summary
        &navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB

`company=minasdeagu` is Minas de Aguas Teñidas — the MATSA subsidiary — because
Sandfire runs one SuccessFactors tenant out of the EU datacentre for the whole
group. That is also why `rcm_site_locale=en_GB` is not optional: without it the
same tenant serves the page in Spanish, and the "Jobs matched" counter this
script reads becomes "empleos".

THE BOARD PUBLISHES NO LOCATION. Measured 2026-08-03: every row's note line is
`Requisition ID: <id> - Posted on <date> - <empty span>`, and the job detail
page has no location field either — "Perth" appears there only inside the
boilerplate company blurb, which is about the head office and not about the
role. So `location` is written EMPTY rather than guessed. The hub falls back to
the company's own city so the roles still count somewhere, except where the
title names one of Sandfire's own project sites, which is the board's own text
and not an inference:

    "Early Career Project Geologist - Kalkaroo"  →  Kalkaroo, South Australia

SPAIN HAS NO FEED, and this was checked rather than assumed.
https://empleo.sandfirematsa.es/ is an Instapage landing page, not a job board:
it carries two TalentClue links and neither is a vacancy — one is a generic
"Conoce nuestras ofertas" button and the other an internships procedure. The
TalentClue tenant behind them (matsamining/sandfirematsa) serves 404 for every
list path and its one reachable form is titled "trabaja con nosotros", the
open-application form. There is nothing there to archive, so nothing is
written; if MATSA starts advertising, this is the URL to re-probe.

PAGING. Five roles today, on one page, and the portal renders no "Next Page"
anchor at all. The walk is still written as a click-through — Stockland's
paginator on the identical platform is click-only, and this tenant will grow
the same control the moment it exceeds a page — but MAX_PAGES is low because
every extra page is another full browser render.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/sandfire-to-d1.py [--max-pages N] [--dry-run]
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

# `portal-sf` is the SuccessFactors source tag used in careerSites.ts, so these
# rows dedupe against the Worker's SF rows on the shared job_key.
SOURCE = 'portal-sf'
COMPANY_ID = 'sfr'
COMPANY = 'Sandfire Resources'
SECTOR = 'Copper & Base Metals'
HOME_HUB = 'perth'
BASE = 'https://career55.sapsf.eu'
TENANT = 'minasdeagu'
LISTING = (f'{BASE}/career?company={TENANT}&career_ns=job_listing_summary'
           '&navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB')

args = sys.argv[1:]
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 4
# Playwright by default; --oxylabs sends the same instruction list to the Web
# Scraper API instead. Measured 2026-08-04: this board renders for a headless
# browser on an ordinary CI address, so the proxy was paying for a browser we
# can run ourselves. See scripts/browser_fetch.py.
VIA_OXYLABS = '--oxylabs' in args
DRY = '--dry-run' in args

# Seconds to let the RCM portal's DWR search settle before capturing, and again
# after each Next click. Eight was measured against this tenant: at six the
# capture still landed on "Loading…" about one run in three.
SETTLE_S = 8

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── location, only where the board actually names one ─────────────────────────
# Sandfire's own project sites, as the titles spell them. Kalkaroo is the
# Kalkaroo Copper-Gold Project in South Australia (the Havilah joint venture);
# Motheo is in Botswana and MATSA in Huelva, Spain — neither is a hub we plot,
# so those resolve to no hub rather than to Perth, which is the same treatment
# careerSites.ts gives a foreign role on an Australian employer's board.
SITES = [
    ('kalkaroo', 'Kalkaroo, South Australia', 'adelaide'),
    ('motheo', 'Motheo, Botswana', None),
    ('matsa', 'MATSA, Huelva, Spain', None),
    ('degrussa', 'DeGrussa, Western Australia', 'perth'),
]


def site_for(title: str) -> tuple[str, str | None]:
    """(location, hub) read off the title, else ('', head-office hub).

    The empty string is deliberate: an empty location is honest about a board
    that publishes none, where writing "Perth" would put a fact in the archive
    that no row anywhere supports."""
    low = (title or '').lower()
    for needle, loc, hub in SITES:
        if needle in low:
            return loc, hub
    return '', HOME_HUB


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
    """Render the listing and click through to `page` (1-based).

    The instruction list is unchanged from when this went through Oxylabs — only
    the executor moved. Chaining a click per page rather than jumping is
    deliberate: SuccessFactors renders no page control that takes an index, so
    "page 4" is only reachable as three Next clicks from a fresh load."""
    instructions: list[dict] = [{'type': 'wait', 'wait_time_s': SETTLE_S}]
    for _ in range(page - 1):
        instructions.append(NEXT_CLICK)
        instructions.append({'type': 'wait', 'wait_time_s': SETTLE_S})
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, _ = oxy_fetch(LISTING, geo='Australia', render=True,
                               extra={'browser_instructions': instructions})
        return content
    return browser_fetch.render(LISTING, instructions)


ROW_RE = re.compile(r'<tr class="jobResultItem">(.*?)</tr>', re.S)
TITLE_RE = re.compile(
    r'<a class="jobTitle"[^>]*href="([^"]*career_job_req_id=(\d+)[^"]*)"[^>]*>(.*?)</a>',
    re.S)
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
        pm = POSTED_RE.search(row)
        out.append({
            'id': m.group(2),
            'title': title,
            # The href carries a session-bound _s.crb that is meaningless to
            # anyone else, so the stored link is the stable requisition URL.
            'url': (f'{BASE}/career?company={TENANT}&career_ns=job_listing'
                    f'&career_job_req_id={m.group(2)}&rcm_site_locale=en_GB'),
            'category': 'Career portal',
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
        # signal — the same behaviour Stockland's paginator shows.
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
        loc, hub = site_for(j['title'])
        key = job_key(SOURCE, j['title'], COMPANY, loc)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], COMPANY, COMPANY_ID,
                     hub, loc, j['category'], None,
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
    sys.stderr.write(f'Sandfire Resources careers -> D1{", DRY RUN" if DRY else ""}\n')
    jobs, advertised = scrape()
    if not jobs:
        # This board runs genuinely small — five roles is a normal day for a
        # 1,050-person miner — but ZERO is the "Loading…" capture or a theme
        # change, not an empty board. Writing nothing and exiting non-zero is
        # the only honest reading.
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
    for j in jobs:
        loc, hub = site_for(j['title'])
        sys.stderr.write(f'  - {j["title"][:52]:52s} | {loc or "(no location published)":28s} '
                         f'| {hub or "unplaced"} | {j["posted"]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
