#!/usr/bin/env python3
"""
Scrape NAB's own careers portal (careers.nab.com.au) and archive the roles to
the D1 jobs table — the one employer portal that cannot run inside the Worker.

WHY THIS ISN'T IN workers/jobs-cron/careerSites.ts
Every other employer portal on the roster is fetched by the cron Worker. NAB is
not, because careers.nab.com.au sits behind an AWS WAF that a Worker cannot get
through. Measured, not assumed:

  * From the Worker: zero roles, while every other site in the same tick
    returned hundreds.
  * From a plain datacentre IP: the first request returned the full page, and
    subsequent ones a 202 with an empty body — the WAF flags the address by
    reputation and volume, so a CI runner would be blocked within a page or two.
  * Through Oxylabs with rendering alone: the challenge page.
  * Through Oxylabs with rendering AND a browser wait: the real page, 30 cards.

So this runs through Oxylabs with a `wait` browser instruction, giving the WAF's
JavaScript the second or two it needs to settle before the HTML is captured.

WHAT IT TALKS TO
NAB runs Clinch. The job list is server-rendered at

    GET https://careers.nab.com.au/jobs/search?page=N

30 cards a page, each an <article class="...job-search-results-card-col"> whose
title anchor lives in <h3 class="...job-search-results-card-title">, with the
location(s) and category in job-component-* list items. There is no posting
date on the card, so the archive records the day the role was first seen rather
than inventing one.

If a run gets pages with no cards at all, the WAF won and the script exits
non-zero rather than quietly writing nothing — a silent zero here would read as
"NAB has no vacancies".

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD
Run: python scripts/nab-to-d1.py [--max-pages N] [--dry-run] [--direct]
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

# Matches workers/jobs-cron/careerSites.ts: the Clinch source tag, NAB's roster
# id, its home hub and its sector (which gates the skills taxonomy).
SOURCE = 'portal-cl'
COMPANY_ID = 'melbourne-nab'
COMPANY = 'National Australia Bank'
SECTOR = 'Financial Services'
HOME_HUB = 'melbourne'
BASE = 'https://careers.nab.com.au'
SEARCH = BASE + '/jobs/search'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

args = sys.argv[1:]
MAX_PAGES = int(args[args.index('--max-pages') + 1]) if '--max-pages' in args else 20
DRY = '--dry-run' in args
# --direct skips Oxylabs. Kept for local debugging only: the WAF serves a plain
# IP about one page before it starts returning empty 202s, so a --direct run is
# not a substitute for the real path.
DIRECT = '--direct' in args
# Seconds the headless browser waits after load, for the WAF's JS to settle.
# 12s was the value verified against the live site; below that the capture can
# still be the challenge page.
WAF_WAIT_S = 12

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── the same hub mapping the Worker portals use ───────────────────────────────
# NAB advertises as "VIC- Melbourne CBD", "NSW- Sydney CBD" and so on; a role
# that names no city we plot falls back to NAB's home rather than being dropped,
# because this portal is Australia-only.
HUBS = [
    ('perth', 'perth'), ('western australia', 'perth'), (' wa-', 'perth'),
    ('brisbane', 'brisbane'), ('queensland', 'brisbane'), ('qld-', 'brisbane'),
    ('melbourne', 'melbourne'), ('victoria', 'melbourne'), ('vic-', 'melbourne'),
    ('adelaide', 'adelaide'), ('south australia', 'adelaide'), ('sa-', 'adelaide'),
    ('canberra', 'canberra'), ('act-', 'canberra'),
    ('hobart', 'hobart'), ('tas-', 'hobart'),
    ('darwin', 'darwin'), ('nt-', 'darwin'),
    ('sydney', 'sydney'), ('new south wales', 'sydney'), ('nsw-', 'sydney'),
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
def get(url: str) -> str | None:
    if DIRECT:
        req = urllib.request.Request(url, headers={
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-AU,en;q=0.9',
        })
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=45) as r:
                    return r.read().decode('utf-8', 'replace')
            except Exception as e:
                if attempt == 3:
                    sys.stderr.write(f'  fetch failed: {url} -> {e}\n')
                    return None
                time.sleep(2 ** attempt)
        return None
    from oxylabs_client import fetch as oxy_fetch
    content, _ = oxy_fetch(
        url, geo='Australia', render=True,
        extra={'browser_instructions': [{'type': 'wait', 'wait_time_s': WAF_WAIT_S}]})
    return content


CARD_SPLIT = re.compile(r'job-search-results-card-col', re.I)
TITLE_RE = re.compile(
    r'<h3[^>]*job-search-results-card-title[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
    re.I | re.S)
# The value spans carry an id; the label span next to them ("Primary position
# location: ") carries class="job-attribute" instead. Keying off the id is what
# separates them — a generic "first span in the item" match reads the label, and
# the label is only present in the rendered page, so it passes a raw-HTML test
# and then silently fills every row with "Primary position location:".
LOC_RE = re.compile(r'id="location_icon_text_[^"]*"[^>]*>(.*?)</span>', re.I | re.S)
CAT_RE = re.compile(r'id="category_icon_text_[^"]*"[^>]*>(.*?)</span>', re.I | re.S)


def parse_page(page_html: str) -> list[dict]:
    out = []
    for card in CARD_SPLIT.split(page_html)[1:]:
        m = TITLE_RE.search(card)
        if not m:
            continue
        title = clean(m.group(2))
        if not title:
            continue
        href = clean(m.group(1))
        # A role can be advertised in several locations; each is its own
        # job-component-location item, so they are joined rather than dropped.
        locs = [clean(x) for x in LOC_RE.findall(card)]
        locs = [x for x in locs if x]
        cat = CAT_RE.search(card)
        out.append({
            'title': title,
            'url': href if href.startswith('http') else BASE + href,
            'location': ', '.join(locs),
            'category': clean(cat.group(1)) if cat else 'Career portal',
        })
    return out


# The WAF answers in three sizes, all with HTTP 200: ~3 KB when it wants
# JavaScript, ~60 KB for the challenge page with the site chrome around it, and
# ~290 KB for the real listing. The middle one is why this threshold is high —
# at 40 KB the challenge page passed as real and the run reported "end of
# results" on page 1.
REAL_PAGE_MIN_BYTES = 150_000
PAGE_ATTEMPTS = 4


def get_page(page: int) -> tuple[list[dict], bool]:
    """Returns (rows, blocked). `blocked` distinguishes "the WAF beat us on this
    page" from "this page is genuinely past the last result" — without it a
    single challenge mid-walk silently truncates the run and looks like NAB
    simply having fewer vacancies."""
    for attempt in range(PAGE_ATTEMPTS):
        page_html = get(f'{SEARCH}?page={page}')
        if page_html and len(page_html) >= REAL_PAGE_MIN_BYTES:
            return parse_page(page_html), False
        got = len(page_html) if page_html else 0
        sys.stderr.write(
            f'  page {page}: challenge response ({got} bytes), '
            f'attempt {attempt + 1}/{PAGE_ATTEMPTS}\n')
        time.sleep(3 * (attempt + 1))
    return [], True


def scrape() -> list[dict]:
    jobs, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        rows, blocked = get_page(page)
        if blocked:
            sys.stderr.write(f'  page {page}: blocked after {PAGE_ATTEMPTS} attempts; stopping.\n')
            break
        if not rows:
            sys.stderr.write(f'  page {page}: full page, no cards — end of results.\n')
            break
        added = 0
        for j in rows:
            k = j['url'] or j['title']
            if k in seen:
                continue
            seen.add(k)
            jobs.append(j)
            added += 1
        sys.stderr.write(f'  page {page}: {len(rows)} cards ({added} new)\n')
        if not added:
            break
    return jobs


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
    sys.stderr.write(
        f'NAB careers -> D1: {"DIRECT" if DIRECT else "via Oxylabs"}'
        f'{", DRY RUN" if DRY else ""}\n')
    jobs = scrape()
    if not jobs:
        # Never write an empty result and never call it a success: an empty pull
        # means the WAF blocked us, not that NAB has stopped hiring.
        sys.stderr.write(
            'No roles parsed. careers.nab.com.au served no job cards — either the AWS WAF '
            'challenge outlasted the browser wait, or the card markup changed.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed.\n')
    for j in jobs[:5]:
        sys.stderr.write(f'  - {j["title"][:60]} | {j["location"][:40]} | {j["category"][:24]}\n')
    if DRY:
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}/{COMPANY_ID}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
