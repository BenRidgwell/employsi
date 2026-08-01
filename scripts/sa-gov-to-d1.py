#!/usr/bin/env python3
"""
Scrape the South Australian public-sector jobs board (iworkfor.sa.gov.au) and
archive it to the D1 jobs table, deduped — the SA-Government counterpart of what
the jobs-cron worker does for the WA board, and of scripts/seek-to-d1.py /
scripts/indeed-to-d1.py.

Why Oxylabs: iworkfor.sa.gov.au runs a BigRedSky ATS whose result table is
rendered ENTIRELY client-side — there is no server-rendered results page, no
RSS/JSON feed, and a dead "JavaScript required" noscript fallback. A headless
Chromium on a GitHub runner rendered 0 rows (the datacenter IP is bot-blocked).
Oxylabs' Web Scraper API fetches through a residential IP and executes the page's
JS server-side, returning the finished DOM, so this is now a plain HTTP flow with
no browser — the same path Indeed/LinkedIn/NSW/APS use, and it runs unattended on
GitHub Actions.

One pass scrapes EVERY current vacancy across all agencies (the report carries an
"Agency"/"Department" column), maps each job to its sa-gov-<slug> company id, maps
skills for parity via the worker's own taxonomy (scripts/map-skills.ts), and
upserts through the D1 HTTP API with the same source|title|company|location key +
upsert as src/employsi/lib/jobArchive.ts. Jobs whose agency can't be matched to a
roster agency are archived under company_id 'sa-gov' (the sector bucket) so the
count still lands, just not attributed to one card.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/sa-gov-to-d1.py [--max-pages N] [--no-skills] [--solve]
                                      [--limit N] [--url URL]
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime

import http.cookiejar  # noqa: E402
import io  # noqa: E402
import random  # noqa: E402
import html as htmllib  # noqa: E402
import urllib.request  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    import oxylabs_client as oxy  # noqa: E402
    import jobs_extract as jx  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing helper module ({e}).')
ROOT = os.path.dirname(HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
# `or default` (not the get() default) so an empty env var falls back to the
# baked-in id instead of clobbering it with an empty string.
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

# The public "browse all jobs" report on the SA board. Any /jb/page/<token> that
# lands on the search+results view works; this is the one the app links to.
SITE = 'https://www.iworkfor.sa.gov.au'
DEFAULT_URL = ('https://www.iworkfor.sa.gov.au/jb/page/'
               'S1FBZG43TXBhNG84MENJV0tIQ0xqajlNdmNjVTM1dEdRS3M1emgrNzd1cz0=')

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 40))
NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args          # render + report row count only, no D1 write
LIMIT = int(_opt('--limit', 10**9))
START_URL = _opt('--url', DEFAULT_URL)

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
             '(Not needed with --solve, which skips the D1 write.)')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


CITIES = ['adelaide', 'perth', 'brisbane', 'melbourne', 'sydney']


def match_city(text: str):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    return None


# ── SA gov agency roster → sa-gov-<slug> id (mirrors data/adelaideGov.ts) ──────
def slug(name: str) -> str:
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))


def sa_gov_id(name: str) -> str:
    return 'sa-gov-' + slug(name)


def load_agency_names() -> list[str]:
    txt = open(os.path.join(ROOT, 'src/employsi/data/adelaideGov.ts')).read()
    # names live in the NAMES: string[] = [ '...', ... ] block
    block = re.search(r'const NAMES:\s*string\[\]\s*=\s*\[(.*?)\];', txt, re.S)
    if not block:
        return []
    # entries are single- OR double-quoted (e.g. "Attorney-General's Department"
    # uses double quotes because of the apostrophe).
    out = []
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'', block.group(1)):
        s = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(s.replace('\\"', '"').replace("\\'", "'"))
    return out


AGENCY_NAMES = load_agency_names()
# normalised agency name -> id, for mapping a job's "Agency" column back to a card
AGENCY_BY_NORM = {norm(n): sa_gov_id(n) for n in AGENCY_NAMES}
# also index by a few common shortenings so e.g. "SA Police" matches "South
# Australia Police". Longest normalised names first so specific wins.
AGENCY_SORTED = sorted(AGENCY_NAMES, key=lambda n: len(n), reverse=True)


def agency_to_id(agency: str) -> tuple[str, str]:
    """Return (company_id, display_company) for a job's agency-column text."""
    n = norm(agency)
    if not n:
        return 'sa-gov', 'SA Government'
    if n in AGENCY_BY_NORM:
        return AGENCY_BY_NORM[n], agency.strip()
    # substring either way (roster name inside the column text or vice versa)
    for name in AGENCY_SORTED:
        nn = norm(name)
        if nn and (nn in n or n in nn):
            return sa_gov_id(name), agency.strip()
    return 'sa-gov', agency.strip() or 'SA Government'


# ── skills parity via the worker's own taxonomy (offline bun helper) ──────────
def map_skills(titles: list) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode(), capture_output=True, timeout=180)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── D1 HTTP API ───────────────────────────────────────────────────────────────
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


def existing_titles_by_company() -> dict:
    # Per company_id, the set of normalised titles already archived from OTHER
    # sources — so an SA-gov job that duplicates an Adzuna/Muse role is counted
    # once, but sa-gov's own previously-archived jobs re-upsert and refresh their
    # last_seen (keeping still-live roles "current").
    out: dict = {}
    r = d1("SELECT DISTINCT company_id, title FROM jobs WHERE source != 'sa-gov'", [])
    for x in (r[0]['results'] if r else []):
        out.setdefault(str(x.get('company_id') or ''), set()).add(norm(str(x.get('title') or '')))
    return out


def upsert(rows: list) -> int:
    """rows: list of the 12-tuple archive rows (job_key first)."""
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params/query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = ('INSERT INTO jobs '
               '(job_key, source, title, company, company_id, hub, location, category, salary, url, posted, skills, first_seen, last_seen, seen_count) '
               f'VALUES {values} '
               'ON CONFLICT(job_key) DO UPDATE SET '
               'last_seen = excluded.last_seen, seen_count = seen_count + 1, '
               "salary = COALESCE(jobs.salary, excluded.salary), "
               "url = COALESCE(NULLIF(jobs.url, ''), excluded.url), "
               "posted = COALESCE(NULLIF(jobs.posted, ''), excluded.posted), "
               'skills = COALESCE(jobs.skills, excluded.skills)')
        params = []
        for r in chunk:
            params.extend([*r, TODAY, TODAY])  # first_seen, last_seen
        d1(sql, params)
        written += len(chunk)
    return written


# ── BigRedSky search flow (reverse-engineered from the live board) ────────────
# The board is NOT IP-blocked and needs no browser — the earlier "0 rows" runs
# happened because we were reading the SEARCH FORM page, which never contains
# results. Verified live, the real flow is:
#   1. GET the start URL   → session cookie (NRJobBoardID) + a `jobboard_token`
#                            (note: the token is single-quoted in the markup).
#   2. POST page.php?pageID=842&windowUID=0 as multipart/form-data with
#      action=Search (capital S — the Search button sets exactly that) and
#      Start=<offset>. THIS is what returns the populated report; the response
#      grows ~231KB → ~304KB and gains the real brs_report_table_* tables.
#   3. Read table `brs_report_table_16`, whose header row gives the columns:
#      Job Title | Reference No | Posting Date | Expiry Date | Agency |
#      Classification | Salary | Location.
#   4. Paginate with Start += 20 (verified page size) until no new titles.
REPORT_POST = 'https://www.iworkfor.sa.gov.au/jb/page.php?pageID=842&windowUID=0'
PAGE_SIZE = 20
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124 Safari/537.36')

_TAG = re.compile(r'<[^>]+>')
_WS = re.compile(r'\s+')


def _cell_text(fragment: str) -> str:
    return _WS.sub(' ', htmllib.unescape(_TAG.sub(' ', fragment or ''))).strip()


def _report_rows(html: str) -> list:
    """Parse brs_report_table_16 into dicts keyed by its own header labels."""
    i = html.find('id="brs_report_table_16"')
    if i < 0:
        i = html.find('id="brs_report_table_140"')
    if i < 0:
        return []
    table = html[i:html.find('</table>', i)]
    heads: list = []
    out = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S | re.I):
        if 'reportheading' in tr:
            heads = [_cell_text(c) for c in
                     re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S | re.I)]
            continue
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S | re.I)
        if len(tds) < 4:
            continue
        vals = [_cell_text(c) for c in tds]
        rec = {heads[k].lower(): vals[k] for k in range(min(len(heads), len(vals)))}
        title = rec.get('job title', '')
        if not title:
            continue
        href = re.search(r'href="([^"]+)"', tr)
        url = href.group(1) if href else ''
        if url.startswith('/'):
            url = SITE + url
        out.append({
            'title': title,
            'agency': rec.get('agency', ''),
            'location': rec.get('location', ''),
            'salary': rec.get('salary', ''),
            # The report carries BOTH dates. `posted` means the day the ad went
            # up, so it takes Posting Date; the expiry is kept separate and is
            # not stored, because there is no column for it and it was
            # previously being written into `posted` — which is how 1,106 SA
            # rows ended up holding a d/m/Y CLOSING date in a column every
            # other feed fills with an ISO posting date.
            'posted': jx.iso_date(rec.get('posting date', '')),
            'closing': rec.get('expiry date', ''),
            'url': url,
        })
    return out


def scrape() -> list:
    """Run the search and page through the report. Plain HTTP, no browser."""
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [('User-Agent', UA)]

    sys.stderr.write(f'  loading {START_URL}\n')
    try:
        form = op.open(START_URL, timeout=45).read().decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  could not load the search form: {e}\n')
        return []
    tm = re.search(r"""name=["']jobboard_token["']\s+value=["']([^"']*)["']""", form)
    token = tm.group(1) if tm else ''
    if not token:
        sys.stderr.write('  WARNING: no jobboard_token found — the form may have changed\n')
        jx.diagnose(form, 'sa-form')

    def fetch(start: int):
        fields = [('Advert[ID]', ''), ('saveTo[1]', 'Advert'), ('Advert[Data]', ''),
                  ('action', 'Search'), ('jobboard_token', token), ('Start', str(start)),
                  ('orderByCol', '0'), ('orderByAscDesc', ''), ('saveTo[2]', 'Advert')]
        boundary = '----employsi' + '0' * 8
        buf = io.BytesIO()
        for k, v in fields:
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        buf.write(f'--{boundary}--\r\n'.encode())
        req = urllib.request.Request(REPORT_POST, data=buf.getvalue(), headers={
            'User-Agent': UA, 'Referer': START_URL,
            'Content-Type': f'multipart/form-data; boundary={boundary}'})
        for attempt in range(3):
            try:
                return op.open(req, timeout=60).read().decode('utf-8', 'replace')
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    sys.stderr.write(f'  search POST failed at Start={start}: {e}\n')
                    return ''
                time.sleep(min(30, random.uniform(0, (2 ** attempt) * 3)))
        return ''

    all_rows, seen = [], set()
    for page in range(MAX_PAGES):
        html = fetch(page * PAGE_SIZE)
        if not html:
            break
        rows = _report_rows(html)
        if not rows and page == 0:
            jx.diagnose(html, 'sa-results')
        new = 0
        for r in rows:
            k = (norm(r['title']), norm(r['agency']), norm(r['location']))
            if k in seen:
                continue
            seen.add(k)
            all_rows.append(r)
            new += 1
        sys.stderr.write(f'  page {page + 1} (Start={page * PAGE_SIZE}): {len(rows)} rows ({new} new)\n')
        if new == 0:
            break
        # Be a polite guest: pace the walk with jitter.
        time.sleep(random.uniform(1.0, 2.0))
    return all_rows



def build_rows(scraped: list, have: dict):
    out, seen = [], set()
    titles = [r['title'] for r in scraped]
    skills = map_skills(titles)
    kept = []
    for r, sk in zip(scraped, skills):
        cid, company = agency_to_id(r.get('agency') or '')
        title = r['title']
        # skip if this exact role already archived for this company by another src
        if norm(title) in have.get(cid, set()):
            continue
        location = r.get('location') or ''
        key = job_key('sa-gov', title, company or cid, location)
        if key in seen:
            continue
        seen.add(key)
        out.append((key, 'sa-gov', title, company or None, cid,
                    match_city(location), location, 'Government',
                    r.get('salary') or None, r.get('url') or '', r.get('posted') or '',
                    json.dumps(sk) if sk else None))
        kept.append(cid)
    return out, kept


def main() -> int:
    if not AGENCY_NAMES:
        sys.exit('Could not parse agency names from src/employsi/data/adelaideGov.ts')
    sys.stderr.write(f'SA gov -> D1: {len(AGENCY_NAMES)} agencies in roster; '
                     f'{"SOLVE (no D1 write)" if SOLVE else "archiving"}.\n')
    scraped = scrape()

    sys.stderr.write(f'  rendered {len(scraped)} vacancies\n')
    if SOLVE:
        sample = scraped[:5]
        for r in sample:
            sys.stderr.write(f'    · {r.get("title","")[:48]:48} | {r.get("agency","")[:32]}\n')
        ok = len(scraped) > 0
        sys.stderr.write(f'\n{"✓ Reachable — report rendered" if ok else "✗ No rows rendered (site changed or blocked)"}.\n')
        return 0 if ok else 2

    if not scraped:
        sys.stderr.write('No rows rendered — nothing to archive. '
                         '(Run with --solve; check the [diag] line above.)\n')
        return 2

    if LIMIT < len(scraped):
        scraped = scraped[:LIMIT]
    have = existing_titles_by_company()
    rows, kept = build_rows(scraped, have)
    written = upsert(rows) if rows else 0
    matched = sum(1 for c in kept if c != 'sa-gov')
    sys.stderr.write(f'\nDone. {len(scraped)} vacancies rendered, {written} new rows archived '
                     f'({matched} attributed to a specific agency, '
                     f'{written - matched} to the SA-gov bucket, '
                     f'{len(scraped) - len(rows)} already archived by another source).\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
