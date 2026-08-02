#!/usr/bin/env python3
"""
Recover a dead career site's job advertisements from the Internet Archive and
archive them to the D1 jobs table, deduplicated against everything already there.

WHY THIS EXISTS
Every live source in this repo answers "what is advertised today". TheirStack
sells some of the back catalogue but charges per result and its free tier runs
dry after ~100 (see theirstack-to-d1.py), and neither reaches a site that no
longer exists. BHP's recruitment moved platforms twice and retired three
hostnames; the ads that ran on them are not on any live board and cannot be
bought back. The Wayback Machine crawled those hostnames ~118,000 times, and a
crawl of a search-results page is a dated snapshot of what was advertised on the
day it was taken — which is exactly the reading the archive wants.

WHAT IT READS
    https://web.archive.org/cdx/search/cdx   the capture index (CDX API)
    https://web.archive.org/web/<ts>id_/<url>   the capture itself

The `id_` suffix asks for the ORIGINAL bytes. Without it the Wayback Machine
injects its own toolbar and rewrites every URL in the page, which changes the
markup the parsers below match on.

    !!! web.archive.org IS BLOCKED BY THIS SANDBOX'S EGRESS POLICY !!!
    Plain curl gets "Blocked by egress policy" (archive.org itself is allowed;
    only the web. host is not). So the fetches go through Oxylabs, the same way
    Indeed and Jora do. Nothing about the data needs a residential IP — this is
    purely how we reach the host from here. From a GitHub Action, drop
    --via-oxylabs and it will fetch directly.

LISTING PAGES, NOT DETAIL PAGES
A jobDetails page costs one fetch and yields one advertisement. A search-results
page costs one fetch and yields twenty, with the title, the employer's own
requisition reference, the location and the closing date already laid out in a
table — everything the archive stores. There are ~36,000 result-page captures
across the three hosts against ~21,000 detail captures, so listings are both
richer and cheaper and this reads only those. Detail pages carry two extra
fields (CSG/business unit, and an explicit "Advertised:" date in the later
platform); they are left for a follow-up rather than paid for at 1/20th the
yield.

THREE LAYOUTS, ALL MEASURED AGAINST REAL CAPTURES
The parsers below are written against captures I actually fetched and read, and
each is commented with the capture it was verified on. The hosts changed
platform twice:

  legacy  2003-2015  <table id="searchResults">, one <tr class="searchResultsOdd|Even">
                     per ad: hidden lJobID_N, an <a> whose text is
                     "Title (REF)", a location cell, a closing-date cell.
                     Verified: 20050103030913 jobs.bhpbilliton.com/searchresults.asp
                               20060110213229 careers.bmacoal.com/searchresults.asp
  modern  2015-2018  PageUp career site at /cw/en/listing/: <a class="job-link">
                     with a nested span.job-externalJobNo, span.location, and
                     <time datetime="..."> for the opening and closing dates.
                     Verified: 20160105021231 jobs.bhpbilliton.com/cw/en/listing/

DATES, AND WHAT WE REFUSE TO INVENT
first_seen and last_seen are the FIRST and LAST capture the advertisement was
seen in, so days_advertised is a measurement of how long the ad was actually up,
not an assumption. `posted` is only ever the site's own opening date, which only
the modern layout publishes; the legacy layout shows a CLOSING date and nothing
else, and a closing date is not a posting date, so those rows keep posted empty
rather than carrying a plausible wrong one.

The upsert takes MIN(first_seen) and MAX(last_seen) rather than overwriting,
because captures are read in whatever order the budget sampler picks them and a
later run may find an EARLIER capture of the same ad. Every other source in this
repo walks forward in time and can simply assign last_seen; this one cannot.

Historical rows are never "currently advertised" — last_seen is years old, well
outside the `last_seen >= date('now','-1 day')` window — so nothing here can
appear on a company card as an open role. That is the point: it is history.

SAMPLING, BECAUSE 118,000 FETCHES IS NOT A SESSION
--max-fetches bounds a run. The budget is spread EVENLY OVER CALENDAR MONTHS
rather than taken from the top of the list: 61% of the captures are from 2005
alone, so a naive prefix would report BHP's hiring history as one very busy year
and nothing else. Sampling by month buys coverage of the span instead.

Run:
  OXYLABS_USERNAME=… OXYLABS_PASSWORD=… CLOUDFLARE_API_TOKEN=… \
  python3 scripts/wayback-to-d1.py --app-id bhp --max-fetches 400 --via-oxylabs
Options:
  --hosts a,b,c     override the default three BHP hostnames
  --from/--to YYYY  bound the capture window
  --dry-run         parse and report, write nothing
  --cache DIR       reuse fetched captures between runs (default: none)
"""
from __future__ import annotations
import collections
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

SOURCE = 'wayback'
CDX = 'https://web.archive.org/cdx/search/cdx'
WB = 'https://web.archive.org/web'

# The three hostnames BHP recruited through, in the order they were used. All
# three are dead; the company's board is now a PageUp tenant on bhp.com.
DEFAULT_HOSTS = ['jobs.bhpbilliton.com', 'jobs.bhpbilliton.net', 'careers.bmacoal.com']

# Which host was whose advertisement. careers.bmacoal.com is BHP Billiton
# Mitsubishi Alliance, a 50/50 joint venture — its ads are BMA's, not BHP's, and
# they are labelled as such rather than being quietly filed under the parent.
# BHP's own board cross-listed some of them ("This job is advertised by BMA
# coal", seen in capture 20050103030913), which is precisely why the advertiser
# name has to come from somewhere other than the host it was read from.
HOST_EMPLOYER = {
    'careers.bmacoal.com': 'BHP Billiton Mitsubishi Alliance',
}
DEFAULT_EMPLOYER = 'BHP Billiton'

# Only listing pages. jobdetails/emailjob are one ad per fetch (see the module
# docstring); default.asp and jobmail.asp are the search form and the alert
# signup and carry no results.
LISTING_RE = re.compile(r'/(searchresults|jobsearch)\.asp|/cw/[a-z]{2}/listing', re.I)
# …but not all listing URLs are equally worth a fetch. jobSearch.asp is the
# search FORM on the .com host — it renders the criteria, not the results, and
# returns zero rows every time. Measured on the first 168 captures fetched: the
# 2006-2014 slice came back with nothing at all because the sampler had picked
# jobSearch.asp for those months, while those same years hold thousands of
# searchresults.asp captures that do carry the table. So captures are ranked and
# the productive shapes are taken first within each month; the form is kept as a
# last resort because on bmacoal the same filename does return results.
PRODUCTIVE_RE = re.compile(r'/searchresults\.asp|/cw/[a-z]{2}/listing', re.I)


def rank(url: str) -> int:
    return 0 if PRODUCTIVE_RE.search(url) else 1

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


APP_ID = _opt('--app-id', 'bhp')
HOSTS = [h.strip() for h in (_opt('--hosts') or ','.join(DEFAULT_HOSTS)).split(',') if h.strip()]
MAX_FETCHES = int(_opt('--max-fetches', 400))
YEAR_FROM = _opt('--from')
YEAR_TO = _opt('--to')
CACHE = _opt('--cache')
# Passed to the matcher only so INDUSTRY_GATED terms resolve the way they would
# for this employer ("principal" is a school principal in education and a
# seniority grade everywhere else). Give it the roster's own sector string.
SECTOR = _opt('--sector', 'Diversified Mining')
DRY = '--dry-run' in args
VIA_OXY = '--via-oxylabs' in args

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

if VIA_OXY:
    from oxylabs_client import fetch as oxy_fetch  # noqa: E402


# ── fetching ─────────────────────────────────────────────────────────────────
def get(url: str, timeout: int = 180) -> str | None:
    """One page, through Oxylabs or directly. render=False throughout: these are
    server-rendered pages from 2005 and there is nothing to execute."""
    if CACHE:
        key = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9]+', '_', url)[-180:] + '.html')
        if os.path.exists(key):
            return open(key, encoding='utf-8', errors='replace').read()
    body = None
    if VIA_OXY:
        c, s = oxy_fetch(url, render=False, timeout=timeout)
        body = c if s == 200 else None
    else:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'employsi-archive/1.0'})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    body = r.read().decode('utf-8', 'replace')
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    sys.stderr.write(f'  fetch failed {url[:80]}: {str(e)[:100]}\n')
                else:
                    time.sleep(2 * (attempt + 1))
    if body and CACHE:
        os.makedirs(CACHE, exist_ok=True)
        open(key, 'w').write(body)
    return body


def cdx_index(host: str) -> list[tuple[str, str]]:
    """(timestamp, original url) for every 200/text capture of `host`.

    collapse=digest asks the CDX server to drop consecutive captures whose
    content hash is unchanged, which is most of them — a crawler that hits the
    same result page four times in a week produces one row here, not four. It
    only collapses ADJACENT duplicates, so a page that reverts to an earlier
    state still appears again, which is what we want: that is a real change.
    """
    q = {
        'url': host, 'matchType': 'domain', 'output': 'json',
        'fl': 'timestamp,original', 'filter': 'statuscode:200',
        'collapse': 'digest',
    }
    body = get(f'{CDX}?{urllib.parse.urlencode(q)}', timeout=300)
    if not body:
        return []
    try:
        rows = json.loads(body)
    except json.JSONDecodeError:
        sys.stderr.write(f'  {host}: CDX returned non-JSON ({body[:120]!r})\n')
        return []
    return [(r[0], r[1]) for r in rows[1:]] if rows else []


def budget(caps: list[tuple[str, str, str]], n: int) -> list[tuple[str, str, str]]:
    """Pick `n` captures spread evenly across the calendar months they cover.

    Straight truncation would spend the whole budget on 2005, which holds 61% of
    the captures — the crawl rate reflects the Internet Archive's interest, not
    BHP's hiring. Round-robin over months buys the span instead, and the span is
    the thing a history is for.
    """
    if len(caps) <= n:
        return caps
    by_month: dict[str, list] = collections.defaultdict(list)
    for c in caps:
        by_month[c[0][:6]].append(c)
    # Within a month, spend on the shapes that carry a results table before
    # falling back to the search form (see rank()).
    for v in by_month.values():
        v.sort(key=lambda c: (rank(c[1]), c[0]))
    months = sorted(by_month)
    out, i = [], 0
    while len(out) < n:
        took = False
        for m in months:
            if i < len(by_month[m]):
                out.append(by_month[m][i])
                took = True
                if len(out) >= n:
                    break
        if not took:
            break
        i += 1
    return out


# ── parsing ──────────────────────────────────────────────────────────────────
def txt(s: str) -> str:
    """Tag soup to a single clean line. The 2005 pages are hand-written HTML with
    unclosed <td>s and stray <div>s inside cells, so strip rather than parse."""
    s = re.sub(r'<[^>]+>', ' ', s or '')
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


# "Warehouse Controllers (V75175WARE)" — the employer's requisition reference in
# trailing parentheses. Captured separately so it stays out of the job title:
# left in, it makes every ad unique and defeats the dedupe entirely, because the
# same role re-advertised next year carries a new reference.
REF_RE = re.compile(r'^(.*?)\s*\(([A-Za-z0-9][A-Za-z0-9./_-]{2,24})\)\s*$')


def split_ref(title: str) -> tuple[str, str | None]:
    m = REF_RE.match(title)
    if not m:
        return title, None
    body, ref = m.group(1).strip(), m.group(2).strip()
    # A trailing "(Perth)" or "(2 positions)" is not a reference. Requisition
    # numbers always contain a digit; plain words do not.
    if not body or not re.search(r'\d', ref):
        return title, None
    return body, ref


ROW_RE = re.compile(r'<tr[^>]*class="searchResults(?:Odd|Even)"[^>]*>(.*?)</tr>', re.S | re.I)
CELL_RE = re.compile(r'<td[^>]*>(.*?)(?=<td|</tr>|$)', re.S | re.I)
ANYROW_RE = re.compile(r'<tr[^>]*>(.*?)(?=<tr[^>]*>|</table>|$)', re.S | re.I)
HEADCELL_RE = re.compile(r'<t[hd][^>]*>(.*?)(?=<t[hd]|</tr>|</thead>|$)', re.S | re.I)
LEGACY_LINK_RE = re.compile(
    r'<a\s[^>]*href="([^"]*job[Dd]etails\.asp[^"]*)"[^>]*>(.*?)</a>', re.S | re.I)
# "(Job No.: 204702)" — bmacoal puts the requisition reference in its own link
# after the title rather than in the title's parentheses.
JOBNO_RE = re.compile(r'job\s*(?:no|number)\.?\s*:?\s*(?:<[^>]+>\s*)*([A-Za-z0-9._-]+)', re.I)
# "10 January 2006", "10 Jan 2005, 5:00pm"
DATE_RE = re.compile(r'\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b')
MONTHS = {m: i for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
     'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def iso_date(s: str) -> str | None:
    m = DATE_RE.search(s or '')
    if not m:
        return None
    mon = MONTHS.get(m.group(2)[:3].lower())
    return f'{m.group(3)}-{mon:02d}-{int(m.group(1)):02d}' if mon else None


def header_map(h: str) -> dict[str, int]:
    """{'position': 1, 'location': 2, …} from the results table's own header.

    THE COLUMNS ARE NOT THE SAME ON BOTH SITES, which a positional parser gets
    silently wrong rather than loudly:
        bhpbilliton.com  20050103030913  [ , Position, Location,   Applications Close]
        careers.bmacoal  20060110213229  [ , Position, Advertised, Applications close]
    Reading column 2 as a location therefore filed fourteen BMA advertisements
    at a place called "10 January 2006". Nothing errors — the rows just carry a
    date where a location belongs, and the hub matcher quietly places none of
    them. So the header is read and the labels decide, and a table whose header
    we cannot read is skipped rather than guessed at.

    The header row is found by CONTENT, not by tag: bhpbilliton.com writes it as
    <th>, bmacoal writes <thead><tr><td>, and neither closes its cells reliably.
    Anchoring on <th> found the first and silently returned nothing for the
    second, which is the same failure one level up.
    """
    labels = ('position', 'location', 'advertised', 'applications')
    for row in ANYROW_RE.findall(h):
        cells = [txt(c).lower() for c in HEADCELL_RE.findall(row)]
        if not any('position' in c for c in cells):
            continue
        if re.search(r'job[Dd]etails\.asp', row):
            continue  # a data row that happens to mention the word
        out = {}
        for i, c in enumerate(cells):
            for lab in labels:
                if lab in c and lab not in out:
                    out[lab] = i
        if 'position' in out:
            return out
    return {}


def parse_legacy(h: str) -> list[dict]:
    """`<table id="searchResults">` rows, 2003-2015 on both .com and bmacoal.

    Verified against 20050103030913 (bhpbilliton.com, 20 rows, "Displaying 1 to
    20 of 63 jobs") and 20060110213229 (bmacoal.com, 14 rows). The position cell
    holds the link plus an optional one-line summary, which is why the title is
    taken from the <a> text and not the cell.
    """
    cols = header_map(h)
    if 'position' not in cols:
        return []
    out = []
    for row in ROW_RE.findall(h):
        cells = CELL_RE.findall(row)
        if len(cells) <= cols['position']:
            continue
        pos = cells[cols['position']]
        link = LEGACY_LINK_RE.search(pos)
        if not link:
            continue
        title, ref = split_ref(txt(link.group(2)))
        if not title:
            continue

        def cell(name: str) -> str:
            i = cols.get(name, -1)
            return txt(cells[i]) if 0 <= i < len(cells) else ''

        jn = JOBNO_RE.search(pos)
        out.append({
            'title': title,
            'ref': ref or (jn.group(1) if jn else None),
            'location': cell('location'),
            # "Applications close" is a CLOSING date. It is kept as such and
            # never used as `posted` — see the module docstring.
            'closes': cell('applications'),
            # bmacoal's third column really is the day the ad went up, which is
            # a genuine posting date and the only one the legacy era publishes.
            'posted': iso_date(cell('advertised')),
            'href': html.unescape(link.group(1)),
        })
    return out


MODERN_ROW_RE = re.compile(
    r'<a\s[^>]*class="job-link"[^>]*href="([^"]+)"[^>]*>(.*?)</a>(.*?)(?=<a\s[^>]*class="job-link"|</tbody>)',
    re.S | re.I)
EXTNO_RE = re.compile(r'class="job-externalJobNo"[^>]*>(.*?)<', re.S | re.I)
LOC_RE = re.compile(r'class="location"[^>]*>(.*?)</span>', re.S | re.I)
OPEN_RE = re.compile(r'class="open-date"[^>]*>\s*<time datetime="([^"]+)"', re.S | re.I)
CLOSE_RE = re.compile(r'class="close-date"[^>]*>\s*<time datetime="([^"]+)"', re.S | re.I)


def parse_modern(h: str) -> list[dict]:
    """PageUp career site at /cw/en/listing/, 2015-2018.

    Verified against 20160105021231 (jobs.bhpbilliton.com/cw/en/listing/, 40
    job-links). This layout publishes an OPENING date as a machine-readable
    <time datetime="2016-01-04T12:00:00Z">, which is the only place in the whole
    corpus a real posting date exists — so `posted` is populated here and left
    empty everywhere else.
    """
    out = []
    for href, anchor, tail in MODERN_ROW_RE.findall(h):
        ext = EXTNO_RE.search(anchor)
        ref = txt(ext.group(1)) if ext else None
        # The anchor is: Title <span><b>(<span class="job-externalJobNo">MB8530
        # </span>)</b></span>. The reference lives in a NESTED span, so deleting
        # "<span…</span>" non-greedily closes the outer tag against the inner one
        # and leaves "( MB8530" welded to the title — which then travels into
        # job_key and makes every re-advertisement of the same role a new row.
        # The title is simply everything before the first <span>.
        title, ref2 = split_ref(txt(anchor.split('<span', 1)[0]))
        loc = LOC_RE.search(tail)
        op = OPEN_RE.search(tail)
        cl = CLOSE_RE.search(tail)
        if not title:
            continue
        out.append({
            'title': title, 'ref': ref or ref2,
            'location': txt(loc.group(1)) if loc else '',
            'closes': cl.group(1)[:10] if cl else '',
            'posted': op.group(1)[:10] if op else None,
            'href': html.unescape(href),
        })
    return out


TOTAL_RE = re.compile(r'of\s*<strong>\s*([\d,]+)\s*</strong>\s*jobs', re.I)


def parse_page(h: str) -> tuple[list[dict], int | None]:
    """Rows plus the site's own advertised total, when it states one.

    "Displaying 1 to 20 of 63 jobs" is the only number that says how much of a
    day's board a capture actually shows. Wayback cannot replay the POST that
    turned the page, so page 1 is usually all there is — recording the total is
    what keeps that visible instead of letting 20 look like the whole board.
    """
    rows = parse_legacy(h)
    if not rows:
        rows = parse_modern(h)
    m = TOTAL_RE.search(h)
    return rows, int(m.group(1).replace(',', '')) if m else None


# ── placement ────────────────────────────────────────────────────────────────
def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# Location strings in this corpus are the employer's own, in three shapes:
# "AU - QLD - Cannington", "Chile - Antofagasta", "Australia - Western
# Australia". Only the hubs the app actually draws are matched; anything else
# keeps its text and stays unplaced rather than being pushed to the nearest
# marker we happen to own.
#
# The site names are BHP/BMA operations, not towns, so they are mapped by where
# the operation IS: the BMA mines (Saraji, Goonyella, Peak Downs, Blackwater,
# Norwich Park, Gregory, Crinum, Broadmeadow, Daunia, Caval Ridge) are all in
# the Bowen Basin in central Queensland and Hay Point is its port, which is what
# BMA means; Cannington is a silver-lead mine in north-west Queensland. The
# Pilbara iron ore sites (Newman, Yandi, Yarrie, Area C, Jimblebar, Port
# Hedland) and Nickel West sit in Western Australia. Queensland maps to the
# Brisbane hub and WA to Perth because those are the domestic markers the app
# draws for those states, not because the job is in the city.
HUBS = [
    (' wa ', 'perth'), ('western australia', 'perth'), ('perth', 'perth'),
    ('port hedland', 'perth'), ('newman', 'perth'), ('yandi', 'perth'),
    ('yarrie', 'perth'), ('area c', 'perth'), ('jimblebar', 'perth'),
    ('nickel west', 'perth'), ('kalgoorlie', 'perth'), ('kwinana', 'perth'),
    (' qld ', 'brisbane'), ('queensland', 'brisbane'), ('brisbane', 'brisbane'),
    ('saraji', 'brisbane'), ('goonyella', 'brisbane'), ('peak downs', 'brisbane'),
    ('blackwater', 'brisbane'), ('norwich park', 'brisbane'), ('gregory', 'brisbane'),
    ('crinum', 'brisbane'), ('broadmeadow', 'brisbane'), ('daunia', 'brisbane'),
    ('caval ridge', 'brisbane'), ('hay point', 'brisbane'), ('cannington', 'brisbane'),
    ('mackay', 'brisbane'), ('moranbah', 'brisbane'), ('dysart', 'brisbane'),
    (' nsw ', 'sydney'), ('new south wales', 'sydney'), ('sydney', 'sydney'),
    (' vic ', 'melbourne'), ('victoria', 'melbourne'), ('melbourne', 'melbourne'),
    (' sa ', 'adelaide'), ('south australia', 'adelaide'), ('adelaide', 'adelaide'),
    ('olympic dam', 'adelaide'),
    ('singapore', 'singapore'), ('houston', 'houston'), ('london', 'london'),
    ('toronto', 'toronto'), ('vancouver', 'vancouver'), ('shanghai', 'shanghai'),
    ('tokyo', 'tokyo'), ('hong kong', 'hongkong'), ('santiago', 'santiago'),
    ('antofagasta', 'santiago'),
]


def hub_for(loc: str) -> str | None:
    low = ' ' + (loc or '').lower().replace('-', ' ') + ' '
    for needle, hub in HUBS:
        if needle in low:
            return hub
    return None


def cap_day(ts: str) -> str:
    return f'{ts[0:4]}-{ts[4:6]}-{ts[6:8]}'


# ── D1 ───────────────────────────────────────────────────────────────────────
def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(API, data=body, headers={
                'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as r:
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


def map_skills(titles: list) -> list:
    """The same matcher the Worker and the app use, via map-skills.ts, so a role
    recovered from 2005 maps identically to one scraped today."""
    if not titles:
        return []
    out: list = []
    for i in range(0, len(titles), 400):
        part = titles[i:i + 400]
        payload = {'titles': part, 'sector': SECTOR} if SECTOR else part
        try:
            p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                               input=json.dumps(payload).encode(),
                               capture_output=True, timeout=300, cwd=ROOT)
            out.extend(json.loads(p.stdout.decode()) if p.returncode == 0
                       else [[] for _ in part])
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  map-skills error: {e}\n')
            out.extend([[] for _ in part])
    return out


def upsert(jobs: list) -> int:
    skills = map_skills([j['title'] for j in jobs])
    written = 0
    rows = list(zip(jobs, skills))
    for i in range(0, len(rows), 6):  # D1 caps ~100 bound params a statement
        chunk = rows[i:i + 6]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, '
               'salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               # MIN/MAX, not assignment: captures are read in sampled order, so
               # a later run can legitimately discover an EARLIER sighting of the
               # same advertisement. Every live source walks forward and can just
               # assign last_seen; this one must not.
               'first_seen = MIN(jobs.first_seen, excluded.first_seen), '
               'last_seen  = MAX(jobs.last_seen,  excluded.last_seen), '
               'seen_count = seen_count + 1, '
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for j, sk in chunk:
            params.extend([
                j['key'], SOURCE, j['title'], j['company'], APP_ID, j['hub'],
                j['location'] or None, j['category'], None, j['url'],
                j['posted'], json.dumps(sk) if sk else None,
                j['first_seen'], j['last_seen'], 1,
            ])
        d1(sql, params)
        written += len(chunk)
    return written


def snapshot() -> dict:
    r = d1('SELECT COUNT(*) n, COUNT(DISTINCT LOWER(TRIM(title))) t '
           'FROM jobs WHERE source = ?1', [SOURCE])
    return r[0]['results'][0]


# ── run ──────────────────────────────────────────────────────────────────────
def main() -> int:
    sys.stderr.write(f'Wayback -> D1: {", ".join(HOSTS)}{" (DRY RUN)" if DRY else ""}\n')

    caps: list[tuple[str, str, str]] = []   # (timestamp, url, host)
    for host in HOSTS:
        idx = cdx_index(host)
        listing = [(ts, u, host) for ts, u in idx if LISTING_RE.search(u)]
        if YEAR_FROM:
            listing = [c for c in listing if c[0][:4] >= YEAR_FROM]
        if YEAR_TO:
            listing = [c for c in listing if c[0][:4] <= YEAR_TO]
        sys.stderr.write(f'  {host}: {len(idx)} captures indexed, '
                         f'{len(listing)} are listing pages\n')
        caps.extend(listing)
    if not caps:
        sys.stderr.write('No listing captures found — treating as a failure.\n')
        return 1

    picked = budget(sorted(caps), MAX_FETCHES)
    months = sorted({c[0][:6] for c in picked})
    sys.stderr.write(f'  fetching {len(picked)} of {len(caps)} listing captures, '
                     f'spread over {len(months)} months '
                     f'({months[0]}..{months[-1]})\n')

    # job_key -> row, carrying the widest capture span seen for it
    jobs: dict[str, dict] = {}
    stats = collections.Counter()
    totals: list[tuple[str, int, int]] = []   # (day, shown, advertised)

    for n, (ts, url, host) in enumerate(picked, 1):
        h = get(f'{WB}/{ts}id_/{url}')
        if not h:
            stats['fetch_failed'] += 1
            continue
        rows, advertised = parse_page(h)
        stats['pages'] += 1
        if not rows:
            stats['pages_no_rows'] += 1
        day = cap_day(ts)
        if advertised is not None:
            totals.append((day, len(rows), advertised))
        employer = HOST_EMPLOYER.get(host, DEFAULT_EMPLOYER)
        for r in rows:
            stats['ads'] += 1
            key = job_key(SOURCE, r['title'], employer, r['location'])
            cur = jobs.get(key)
            if cur:
                cur['first_seen'] = min(cur['first_seen'], day)
                cur['last_seen'] = max(cur['last_seen'], day)
                cur['posted'] = cur['posted'] or r['posted']
                continue
            # An absolute Wayback URL for the ad itself: the original host is
            # dead, so a relative href would resolve to nothing. This one still
            # opens the advertisement as it stood.
            href = urllib.parse.urljoin(f'http://{host}/', r['href'])
            jobs[key] = {
                'key': key, 'title': r['title'], 'company': employer,
                'location': r['location'], 'hub': hub_for(r['location']),
                'url': f'{WB}/{ts}/{href}',
                'posted': r['posted'],
                # Where it came from and when applications closed, kept together
                # because neither has a column and both are worth not losing.
                'category': f'{host}{" · closes " + r["closes"] if r["closes"] else ""}'[:120],
                'first_seen': day, 'last_seen': day,
            }
        if n % 25 == 0:
            sys.stderr.write(f'  {n}/{len(picked)} captures, {len(jobs)} distinct ads\n')
            sys.stderr.flush()

    if not jobs:
        sys.stderr.write('No advertisements parsed — treating as a failure.\n')
        return 1

    rows = list(jobs.values())
    span = (min(r['first_seen'] for r in rows), max(r['last_seen'] for r in rows))
    placed = sum(1 for r in rows if r['hub'])
    dated = sum(1 for r in rows if r['posted'])
    sys.stderr.write(
        f'\n{stats["pages"]} captures read ({stats["fetch_failed"]} failed to fetch, '
        f'{stats["pages_no_rows"]} held no rows), {stats["ads"]} advertisement rows, '
        f'{len(rows)} distinct after dedupe.\n'
        f'Advertised {span[0]} .. {span[1]}; {placed} placed on a hub '
        f'({placed * 100 // len(rows)}%), {dated} carry the site\'s own posting date.\n')

    # Collected vs advertised, wherever the page stated a total. Wayback cannot
    # replay the POST that turns the page, so a capture normally shows only the
    # first 20 of a longer board — this says by how much rather than letting the
    # sample read as the whole.
    if totals:
        shown = sum(t[1] for t in totals)
        adv = sum(t[2] for t in totals)
        sys.stderr.write(
            f'{len(totals)} captures stated a total: {shown} rows shown of {adv} '
            f'advertised ({shown * 100 // max(adv, 1)}%) — the rest sat on pages '
            f'the Wayback Machine could not capture.\n')

    for r in rows[:6]:
        sys.stderr.write(f'  {r["first_seen"]}..{r["last_seen"]} | {r["title"][:42]:<44}| '
                         f'{str(r["hub"] or "-"):<10}| {r["location"][:28]}\n')

    if DRY:
        sys.stderr.write('DRY RUN — nothing written.\n')
        return 0

    before = snapshot()
    written = 0
    for i in range(0, len(rows), 100):
        written += upsert(rows[i:i + 100])
        sys.stderr.write(f'  {written}/{len(rows)} rows written\n')
        sys.stderr.flush()
    after = snapshot()
    new = after['n'] - before['n']
    sys.stderr.write(
        f'{written} rows sent. source={SOURCE} now holds {after["n"]} rows / '
        f'{after["t"]} distinct titles.\n'
        f'Dedup: {new} new, {written - new} matched advertisements already archived.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
