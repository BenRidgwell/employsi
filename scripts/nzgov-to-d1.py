#!/usr/bin/env python3
"""
Scrape New Zealand government jobs (jobs.govt.nz) for Auckland and Wellington
and archive them to the D1 jobs table — the NZ counterpart of the Australian
state-government scrapers.

WHAT IT TALKS TO
jobs.govt.nz runs Peoplescout's "jobtools" search. It is server-rendered and
takes plain GET parameters:

    GET /jobtools/jncustomsearch.searchResults
        ?in_organid=16563&in_jobDate=All&in_location="Auckland"&in_pg=<rowOffset>

`in_organid=16563` is the all-of-government portal id (it is the id the site's
own homepage links to). `in_pg` is a ROW offset, not a page number — the site's
pagination JS sets it to 0, 20, 40… — and 20 rows come back a page. The header
reports "Results 1 to 20 of N", which is what bounds the walk.

Each result row is a `<tr>` with `<td class="job_title">` holding the job link
(`viewFullSingle?...in_jnCounter=<id>`), then a `<div>at <Agency></div>` and a
`<div class="highlight <Employment Type>">`, plus `<td class="job_location">`,
`<td class="job_listed">` (DD-Mon-YYYY) and `<td class="job_closing">`.

WHY ONLY AUCKLAND AND WELLINGTON
The whole board is ~1,860 roles across all of New Zealand, but the app only
plots Auckland and Wellington, so those are the two locations scraped. Archiving
roles we cannot place on any hub would inflate market-wide counts with rows no
view can show.

WHY OXYLABS
The site is behind a filter that answers a datacentre IP inconsistently, so
fetches go through the shared Oxylabs client for the residential IP, throttling
and backoff. `--direct` bypasses it for local debugging.

`--agencies` prints the distinct agency names and their role counts instead of
writing anything — that is how src/employsi/data/nzGov.ts was built, and how it
should be refreshed when machinery-of-government changes rename agencies.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD.
Run: python scripts/nzgov-to-d1.py [--max-pages N] [--direct] [--dry-run]
                                   [--agencies]
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
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'nz-gov'
BASE = 'https://jobs.govt.nz/jobtools/jncustomsearch.searchResults'
JOB_BASE = 'https://jobs.govt.nz/jobtools/'
ORG_ID = 16563
PAGE_ROWS = 20

# The two hubs the app plots in New Zealand. The site's location facet values
# are quoted strings, which is how its own form submits them.
LOCATIONS = [('"Auckland"', 'auckland'), ('"Wellington"', 'wellington')]

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 40))
DIRECT = '--direct' in args
DRY = '--dry-run' in args
AGENCIES_ONLY = '--agencies' in args

if not (DRY or AGENCIES_ONLY) and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def agency_id(name: str) -> str:
    """Stable app id for an agency, e.g. 'nz-oranga-tamariki'."""
    slug = re.sub(r'[^a-z0-9]+', '-', (name or '').lower()).strip('-')
    return ('nz-' + slug)[:60]


def get(url: str) -> str | None:
    if DIRECT:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            sys.stderr.write(f'  direct fetch failed: {e}\n')
            return None
    from oxylabs_client import fetch as oxy_fetch
    # No JS rendering: the results are server-rendered, so a headless browser
    # returns exactly the same 20 rows for ~7x the time (measured: 2.8s vs
    # 19.4s a page). Over ~35 pages that is the difference between a two-minute
    # run and a twelve-minute one.
    content, _ = oxy_fetch(url, geo='New Zealand', render=False)
    return content


ROW_RE = re.compile(r'<tr>\s*<td class="job_title">(.*?)</tr>', re.S | re.I)
# in_jnCounter is not always the last query parameter — when a location facet is
# applied the site appends in_location after it — so the href capture must run
# to the closing quote rather than stopping at the counter's digits.
LINK_RE = re.compile(r'<a href="([^"]*in_jnCounter=\d+[^"]*)"[^>]*>(.*?)</a>', re.S | re.I)
AGENCY_RE = re.compile(r'<div>\s*at\s*(.*?)</div>', re.S | re.I)
TYPE_RE = re.compile(r'<div class="highlight ([^"]*)"', re.I)
LOC_RE = re.compile(r'<td class="job_location">(.*?)</td>', re.S | re.I)
LISTED_RE = re.compile(r'<td class="job_listed">(.*?)</td>', re.S | re.I)
COUNT_RE = re.compile(r'Results\s+\d+\s+to\s+\d+\s+of\s+(\d+)', re.I)


def parse_page(page_html: str, hub: str) -> list[dict]:
    out = []
    for block in ROW_RE.findall(page_html):
        a = LINK_RE.search(block)
        if not a:
            continue
        title = clean(a.group(2))
        if not title:
            continue
        agency = AGENCY_RE.search(block)
        typ = TYPE_RE.search(block)
        loc = LOC_RE.search(block)
        listed = LISTED_RE.search(block)
        href = html.unescape(a.group(1))
        out.append({
            'title': title,
            # The agency name uses an en-dash separator on some entries
            # ("Health New Zealand - Te Whatu Ora Lakes"); it is kept verbatim
            # so the roster and the archive agree on one spelling.
            'agency': clean(agency.group(1)) if agency else '',
            'location': clean(loc.group(1)) if loc else '',
            'hub': hub,
            'category': clean(typ.group(1)).strip() if typ else 'NZ Government',
            'url': href if href.startswith('http') else JOB_BASE + href,
            'posted': iso_date(clean(listed.group(1)) if listed else ''),
        })
    return out


def iso_date(s: str) -> str:
    """'28-Jul-2026' → '2026-07-28'."""
    try:
        return datetime.datetime.strptime(s.strip(), '%d-%b-%Y').date().isoformat()
    except Exception:
        return TODAY


def scrape() -> list[dict]:
    jobs, seen = [], set()
    for facet, hub in LOCATIONS:
        total, misses = None, 0
        for page in range(MAX_PAGES):
            q = urllib.parse.urlencode({
                'in_organid': ORG_ID, 'in_jobDate': 'All',
                'in_location': facet, 'in_pg': page * PAGE_ROWS})
            # Retry a page that comes back empty before treating it as a miss:
            # the upstream returns an occasional bodyless 200 that a second
            # request usually satisfies.
            rows, page_html = [], None
            for attempt in range(3):
                page_html = get(f'{BASE}?{q}')
                rows = parse_page(page_html, hub) if page_html else []
                if rows:
                    break
                time.sleep(2 * (attempt + 1))
            if page_html and total is None:
                m = COUNT_RE.search(page_html)
                total = int(m.group(1)) if m else None
                sys.stderr.write(f'  {hub}: {total if total is not None else "?"} roles advertised\n')
            if not rows:
                # A page that fails or comes back empty is NOT the end of the
                # walk. The upstream is flaky enough that a single miss used to
                # abandon the rest of a city — Wellington reported 324 roles and
                # returned 15 — so the walk skips the page, and only gives up
                # after several consecutive misses or once the reported total is
                # covered.
                misses += 1
                sys.stderr.write(f'  {hub}: page {page} empty/failed ({misses} in a row)\n')
                if misses >= 3:
                    break
                if total is not None and (page + 1) * PAGE_ROWS >= total:
                    break
                continue
            misses = 0
            for j in rows:
                k = j['url']
                if k in seen:
                    continue
                seen.add(k)
                jobs.append(j)
            if total is not None and (page + 1) * PAGE_ROWS >= total:
                break
        got = sum(1 for j in jobs if j['hub'] == hub)
        sys.stderr.write(f'  {hub}: {got} roles collected'
                         f'{f" of {total} advertised" if total else ""}\n')
    return jobs


def map_skills(titles: list) -> list:
    if not titles:
        return []
    try:
        p = subprocess.run(
            ['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
            # Government is the industry that licenses the gated terms, so a
            # "Principal Adviser" here really is a principal-grade role and a
            # school principal really is education leadership.
            input=json.dumps({'titles': titles, 'sector': 'Government'}).encode(),
            capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
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
    """Same key + upsert as src/employsi/lib/jobArchive.ts. Each role is
    attributed to its own agency, so an agency card shows its own vacancies."""
    skills = map_skills([j['title'] for j in jobs])
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        agency = j['agency'] or 'NZ Government'
        key = job_key(SOURCE, j['title'], agency, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], agency, agency_id(agency),
                     j['hub'], j['location'], j['category'], None,
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
        f'NZ Government jobs -> D1: {"DIRECT" if DIRECT else "via Oxylabs"}'
        f'{", DRY RUN" if DRY else ""}{", AGENCIES ONLY" if AGENCIES_ONLY else ""}\n')
    jobs = scrape()
    if not jobs:
        # An empty board across BOTH cities means the search contract changed or
        # we were blocked, not that the NZ public service stopped hiring.
        sys.stderr.write('No roles parsed for either city — treating as a failure.\n')
        return 1
    sys.stderr.write(f'{len(jobs)} roles parsed.\n')

    if AGENCIES_ONLY:
        counts: dict[tuple[str, str], int] = {}
        for j in jobs:
            counts[(j['agency'], j['hub'])] = counts.get((j['agency'], j['hub']), 0) + 1
        print(json.dumps(
            [{'id': agency_id(a), 'name': a, 'city': c, 'roles': n}
             for (a, c), n in sorted(counts.items(), key=lambda kv: -kv[1]) if a],
            indent=1))
        return 0

    if DRY:
        for j in jobs[:8]:
            sys.stderr.write(f'  {j["posted"]} | {j["title"][:48]:<50}| {j["agency"][:34]:<36}| '
                             f'{j["hub"]}\n')
        return 0
    n = upsert(jobs)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
