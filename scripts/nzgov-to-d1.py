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

WHY THIS USES OXYLABS AGAIN
It was moved to a direct fetch on 2026-08-04, on the measurement that a direct
walk and an Oxylabs walk returned the SAME 518 roles with the same two failing
Wellington pages. That measurement was real but taken from the WRONG PLACE: the
dev sandbox, which egresses through an agent proxy. The very first scheduled run
on the new path — 2026-08-04 21:24, from a GitHub runner — timed out on every
single request and collected nothing:

    direct fetch failed for https://jobs.govt.nz/... <urlopen error timed out>
    wellington: 0 roles collected
    No roles parsed for either city — treating as a failure.

The same URL answers this sandbox in under a second. So the proxy is buying
something after all, just not the thing it was credited with: not consistency,
but an exit address jobs.govt.nz will actually serve. Oxylabs is the default
again and `--direct` is the escape hatch.

THE LESSON, because it will come up again: "works from the sandbox" is not
evidence about a GitHub runner. A transport change has to be proved from the
place the job actually runs.

The throttle and backoff apply either way — that policy lives in
scripts/http_fetch.py and covers the direct path too.

`--agencies` prints the distinct agency names and their role counts instead of
writing anything — that is how src/employsi/data/nzGov.ts was built, and how it
should be refreshed when machinery-of-government changes rename agencies.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
     OXYLABS_USERNAME / OXYLABS_PASSWORD unless --direct is passed.
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
import browser_fetch  # noqa: E402
import http_fetch  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'nz-gov'
BASE = 'https://jobs.govt.nz/jobtools/jncustomsearch.searchResults'
JOB_BASE = 'https://jobs.govt.nz/jobtools/'
SITE_BASE = 'https://jobs.govt.nz'
ORG_ID = 16563
PAGE_ROWS = 20

# The two hubs the app plots in New Zealand. The site's location facet values
# are quoted strings, which is how its own form submits them.
LOCATIONS = [('"Auckland"', 'auckland'), ('"Wellington"', 'wellington')]

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 40))
# A BROWSER on an ordinary runner is the default now. Three transports exist
# and the history behind that is worth keeping, because two of them have been
# wrong here:
#
#   --oxylabs  the proxy. Was the default after a direct run regressed.
#   --direct   plain HTTP through http_fetch. Was made the default on
#              2026-08-04 from a SANDBOX probe, and then timed out on every
#              request from the first real GitHub runner. That is the mistake
#              this file exists to not repeat.
#   (default)  headless Chromium on the runner. Measured twice from a hosted
#              runner (.github/workflows/probe-headless-ci.yml, 2026-08-08):
#              HTTP 200 and 20 rows on Auckland page 1 both times — from the
#              environment the feed actually runs in, not from a sandbox.
#
# The browser costs about 7x the wall time of a direct fetch (measured 19.4s a
# page against 2.8s), so ~35 pages is roughly twelve minutes rather than two.
# That is the price of the transport that is measured to work. --direct may
# well work now too and is a page-one experiment away from being known, but a
# feed that has already regressed once on an unverified transport change is not
# the place to save ten minutes on a guess.
VIA_OXYLABS = '--oxylabs' in args
VIA_DIRECT = '--direct' in args
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


SETTLE = [{'type': 'wait', 'wait_time_s': 5}]


def get(url: str) -> str | None:
    if VIA_DIRECT:
        # http_fetch, not a bare urlopen: it carries the same throttle and
        # backoff the proxy client applied, so going direct did not also mean
        # going unpaced.
        text, _ = http_fetch.get(url, timeout=45)
        return text
    if VIA_OXYLABS:
        # No JS rendering on this path: the results are server-rendered, so the
        # proxy only ever needed to supply the address.
        content, _ = __import__('oxylabs_client').fetch(
            url, geo='New Zealand', render=False)
        return content
    return browser_fetch.render(url, SETTLE, locale='en-NZ')


ROW_RE = re.compile(r'<tr>\s*<td class="job_title">(.*?)</tr>', re.S | re.I)
# The link is found by its POSITION in the row, not by the shape of its href.
#
# The board serves two link shapes side by side in the same result table:
#
#   legacy   jncustomsearch.viewFullSingle?in_organid=16563&in_jnCounter=226644015&…
#   modern   /jobs/MPI26-1936535        (a permalink carrying the agency's own ref)
#
# The old pattern required `in_jnCounter=\d+`, so every job on a modern
# permalink was skipped by the `if not a: continue` below — silently, because a
# row that yields no link is indistinguishable from a row that was never there.
# Measured 2026-08-04: 203 of 721 advertised roles (28%) were being dropped this
# way, and page 0 of Wellington produced 9 usable rows out of 20. It read as the
# board "answering inconsistently", which is what put this scraper on a
# residential proxy that was never the cure.
#
# Anchoring on `<div class="position">` matches whatever the href is, so a third
# shape appearing later costs nothing. The href runs to the closing quote
# because a legacy link appends in_location AFTER the counter.
LINK_RE = re.compile(
    r'<div class="position"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S | re.I)
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
            # Three shapes to absolutise, not one: an absolute URL, a modern
            # ROOT-relative permalink ("/jobs/MPI26-1936535") and a legacy
            # path-relative link ("jncustomsearch.viewFullSingle?…"). Joining
            # the root-relative one onto JOB_BASE would produce
            # ".../jobtools//jobs/…", which is a 404 — and the url is the dedup
            # key, so a broken one also silently splits a role into two rows.
            'url': (href if href.startswith('http')
                    else SITE_BASE + href if href.startswith('/')
                    else JOB_BASE + href),
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
    coverage: list[str] = []
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
        # A shortfall against the board's OWN total is a failure, not a result.
        #
        # This is the check that would have caught the LINK_RE bug on the day it
        # started: the walk was returning 87% of Auckland and 57% of Wellington
        # and reporting both cheerfully, because a row the parser cannot read is
        # indistinguishable from a row that was never advertised. The same rule
        # the NSW scraper applies — collect at least 80% of what the board says
        # it has, or write nothing and go red.
        #
        # The totals do move between runs (measured: Wellington reported 356,
        # then 151, then 351 within an hour, as the board refreshes), so this is
        # deliberately a floor and not an equality test.
        if total and got < total * 0.8:
            coverage.append(f'{hub}: {got} of {total}')
    if coverage:
        sys.exit('FAIL: short of the board\'s own advertised total — '
                 + '; '.join(coverage) + '. Nothing written.')
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
        f'NZ Government jobs -> D1: {"via Oxylabs" if VIA_OXYLABS else "direct" if VIA_DIRECT else "browser"}'
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
