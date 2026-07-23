#!/usr/bin/env python3
"""
Scrape the South Australian public-sector jobs board (iworkfor.sa.gov.au) and
archive it to the D1 jobs table, deduped — the SA-Government counterpart of what
the jobs-cron worker does for the WA board, and of scripts/seek-to-d1.py /
scripts/indeed-to-d1.py.

Why a browser (not a no-browser HTTP flow like WA gov): iworkfor.sa.gov.au runs a
BigRedSky ATS whose result table is rendered ENTIRELY client-side. Reverse-
engineering established there is no server-rendered results page, no RSS/JSON
feed, and a dead "JavaScript required" noscript fallback — the search POST only
stores session state and 302-redirects to a page whose `#report` div is an empty
placeholder that JavaScript fills in. So the only reliable way to read the
listings is to let a real browser render them. This runs from YOUR OWN machine on
a schedule (cron / launchd / Task Scheduler), like the Indeed scraper.

One pass scrapes EVERY current vacancy across all agencies (the report carries an
"Agency"/"Department" column), maps each job to its sa-gov-<slug> company id, maps
skills for parity via the worker's own taxonomy (scripts/map-skills.ts), and
upserts through the D1 HTTP API with the same source|title|company|location key +
upsert as src/employsi/lib/jobArchive.ts. Jobs whose agency can't be matched to a
roster agency are archived under company_id 'sa-gov' (the sector bucket) so the
count still lands, just not attributed to one card.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/sa-gov-to-d1.py [--max-pages N] [--headful] [--no-skills]
                                      [--solve] [--limit N] [--url URL]

First time on a fresh machine:
    pip3 install playwright && python3 -m playwright install chromium
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime

try:
    from playwright.sync_api import sync_playwright
except ImportError as e:
    sys.exit(f'Missing dependency ({e}). Run: pip3 install playwright && python3 -m playwright install chromium')

import urllib.request  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
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
DEFAULT_URL = ('https://www.iworkfor.sa.gov.au/jb/page/'
               'S1FBZG43TXBhNG84MENJV0tIQ0xqajlNdmNjVTM1dEdRS3M1emgrNzd1cz0=')

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 40))
HEADFUL = '--headful' in args
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


# ── browser render of the BigRedSky report ────────────────────────────────────
def chromium_executable():
    # Honour a pre-provisioned Chromium if present (matches indeed scraper).
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    if base and os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f in ('chrome', 'chrome.exe', 'headless_shell'):
                    return os.path.join(root, f)
    return None


# Extract every rendered result row as {title, agency, location, salary, closing,
# url}, driven by the report's own header cells so it survives column re-ordering.
EXTRACT_JS = r"""
() => {
  const tbl = document.querySelector('#brs_report_table_16')
           || document.querySelector('#brs_report_table_140')
           || document.querySelector('#report table');
  if (!tbl) return {ready:false, rows:[]};
  const norm = s => (s||'').replace(/\s+/g,' ').trim();
  // header labels -> column index
  const headCells = Array.from(tbl.querySelectorAll('tr'))
      .map(tr => Array.from(tr.querySelectorAll('td.reportheading, th')))
      .find(a => a.length) || [];
  const heads = headCells.map(c => norm(c.textContent).toLowerCase());
  const find = (...keys) => {
    for (let i=0;i<heads.length;i++) for (const k of keys) if (heads[i].includes(k)) return i;
    return -1;
  };
  const iTitle = find('title','position','role','vacancy','job');
  const iAgency = find('agency','department','organisation','organization','employer');
  const iLoc = find('location','region','suburb');
  const iSal = find('salary','remuneration','classification');
  const iClose = find('closing','close date','closes');
  const rows = [];
  const trs = tbl.querySelectorAll('tr.oddrow, tr.evenrow, tbody > tr');
  trs.forEach(tr => {
    if (tr.querySelector('td.reportheading, th')) return; // header
    const tds = Array.from(tr.querySelectorAll('td'));
    if (!tds.length) return;
    const cell = i => (i>=0 && i<tds.length) ? norm(tds[i].textContent) : '';
    const a = tr.querySelector('a[href]');
    const title = cell(iTitle) || (a ? norm(a.textContent) : '');
    if (!title) return;
    rows.push({
      title,
      agency: cell(iAgency),
      location: cell(iLoc),
      salary: cell(iSal),
      closing: cell(iClose),
      url: a ? a.href : '',
    });
  });
  return {ready:true, rows, heads};
}
"""

# Advance to the next page of results, if a pagination control exists. Returns
# true if it clicked something (caller then re-extracts), false if last page.
NEXT_JS = r"""
() => {
  const scope = document.querySelector('#report') || document;
  const cands = Array.from(scope.querySelectorAll('a, button'));
  const enabled = e => !e.hasAttribute('disabled')
      && e.getAttribute('aria-disabled') !== 'true'
      && !(e.className || '').toLowerCase().includes('disabl');
  const isNext = e => {
    const t = (e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return t === 'next' || t === '>' || t === '»' || t === 'next page' || t.startsWith('next ');
  };
  const el = cands.find(e => isNext(e) && enabled(e));
  if (el) { el.click(); return true; }
  return false;
}
"""


def scrape(page) -> list:
    """Render + paginate the report, returning a flat list of row dicts."""
    all_rows, seen = [], set()
    # wait for the JS-rendered report table to appear
    for sel in ('#brs_report_table_16', '#brs_report_table_140', '#report table'):
        try:
            page.wait_for_selector(sel, timeout=25000)
            break
        except Exception:
            continue
    for pageno in range(1, MAX_PAGES + 1):
        try:
            page.wait_for_timeout(1200)
            data = page.evaluate(EXTRACT_JS)
        except Exception as e:
            sys.stderr.write(f'  extract error p{pageno}: {e}\n')
            break
        rows = data.get('rows') if isinstance(data, dict) else []
        new = 0
        for r in rows or []:
            k = (norm(r.get('title')), norm(r.get('agency')), norm(r.get('location')))
            if k in seen:
                continue
            seen.add(k)
            all_rows.append(r)
            new += 1
        sys.stderr.write(f'  page {pageno}: {len(rows or [])} rows ({new} new)\n')
        if new == 0 and pageno > 1:
            break
        try:
            advanced = page.evaluate(NEXT_JS)
        except Exception:
            advanced = False
        if not advanced:
            break
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
                    r.get('salary') or None, r.get('url') or '', r.get('closing') or '',
                    json.dumps(sk) if sk else None))
        kept.append(cid)
    return out, kept


def main() -> int:
    if not AGENCY_NAMES:
        sys.exit('Could not parse agency names from src/employsi/data/adelaideGov.ts')
    sys.stderr.write(f'SA gov -> D1: {len(AGENCY_NAMES)} agencies in roster; '
                     f'{"SOLVE (no D1 write)" if SOLVE else "archiving"} '
                     f'({"HEADFUL" if HEADFUL else "headless"}).\n')
    exe = chromium_executable()
    with sync_playwright() as p:
        launch = {'headless': not HEADFUL}
        if exe:
            launch['executable_path'] = exe
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(
            user_agent=('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'),
            viewport={'width': 1400, 'height': 1000}, locale='en-AU')
        page = ctx.new_page()
        sys.stderr.write(f'  loading {START_URL}\n')
        page.goto(START_URL, wait_until='domcontentloaded', timeout=45000)
        scraped = scrape(page)
        browser.close()

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
                         '(Try --headful --solve to see what the page shows.)\n')
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
