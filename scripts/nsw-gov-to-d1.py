#!/usr/bin/env python3
"""
Scrape the NSW public-sector jobs board (iworkfor.nsw.gov.au) and archive it to
the D1 jobs table, deduped — the NSW-Government counterpart of scripts/
sa-gov-to-d1.py. One pass scrapes every current vacancy across all agencies,
maps each to its nsw-gov-<slug> company id (from data/sydneyGov.ts), maps skills
via the worker taxonomy, and upserts through the D1 HTTP API using the same
source|title|company|location key as src/employsi/lib/jobArchive.ts.

Why a browser: iworkfor.nsw.gov.au sits behind Cloudflare's "Just a moment"
JS/anti-bot interstitial, which a plain HTTP client can't pass. A real headless
Chromium (Playwright) executes the challenge and reaches the server-rendered
results, so this runs on GitHub Actions (hosted, off your PC) like the SA board.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/nsw-gov-to-d1.py [--max-pages N] [--headful] [--solve]
                                       [--limit N] [--url URL]
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
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

# The public "browse all jobs" search on the NSW board.
DEFAULT_URL = ('https://iworkfor.nsw.gov.au/jobs/all-keywords/all-agencies/'
               'all-organisations-entities/all-categories/all-locations/all-worktypes')
SITE = 'https://iworkfor.nsw.gov.au'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 60))
HEADFUL = '--headful' in args
NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args
LIMIT = int(_opt('--limit', 10**9))
START_URL = _opt('--url', DEFAULT_URL)

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). (Not needed with --solve.)')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


CITIES = ['sydney', 'perth', 'adelaide', 'brisbane', 'melbourne']


def match_city(text: str):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    # NSW roles that aren't obviously another capital sit under Sydney.
    return 'sydney'


def slug(name: str) -> str:
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))


def nsw_gov_id(name: str) -> str:
    return 'nsw-gov-' + slug(name)


def load_agency_names() -> list[str]:
    txt = open(os.path.join(ROOT, 'src/employsi/data/sydneyGov.ts')).read()
    block = re.search(r'const NAMES:\s*string\[\]\s*=\s*\[(.*?)\];', txt, re.S)
    if not block:
        return []
    out = []
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'', block.group(1)):
        s = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(s.replace('\\"', '"').replace("\\'", "'"))
    return out


AGENCY_NAMES = load_agency_names()
AGENCY_BY_NORM = {norm(n): nsw_gov_id(n) for n in AGENCY_NAMES}
AGENCY_SORTED = sorted(AGENCY_NAMES, key=lambda n: len(n), reverse=True)


def agency_to_id(agency: str) -> tuple[str, str]:
    """(company_id, display_company) for a job's organisation text."""
    n = norm(agency)
    if not n:
        return 'nsw-gov', 'NSW Government'
    if n in AGENCY_BY_NORM:
        return AGENCY_BY_NORM[n], agency.strip()
    for name in AGENCY_SORTED:
        nn = norm(name)
        if nn and (nn in n or n in nn):
            return nsw_gov_id(name), agency.strip()
    return 'nsw-gov', agency.strip() or 'NSW Government'


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
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {e.read().decode("utf-8", "replace")[:300]}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def existing_titles_by_company() -> dict:
    out: dict = {}
    r = d1("SELECT DISTINCT company_id, title FROM jobs WHERE source != 'nsw-gov'", [])
    for x in (r[0]['results'] if r else []):
        out.setdefault(str(x.get('company_id') or ''), set()).add(norm(str(x.get('title') or '')))
    return out


def upsert(rows: list) -> int:
    written = 0
    for i in range(0, len(rows), 7):
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
            params.extend([*r, TODAY, TODAY])
        d1(sql, params)
        written += len(chunk)
    return written


def chromium_executable():
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    if base and os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f in ('chrome', 'chrome.exe', 'headless_shell'):
                    return os.path.join(root, f)
    return None


# Extract every result card: title + its /job/<id> url, plus the organisation and
# location text sitting alongside it. Driven tolerantly (the NSW board wraps each
# job in a card, but class names change) — anchor on the /job/ link, then read
# the surrounding card's labelled fields, falling back to positional text.
EXTRACT_JS = r"""
() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const anchors = Array.from(document.querySelectorAll('a[href*="/job/"]'));
  const seen = new Set();
  const rows = [];
  for (const a of anchors) {
    const href = a.href;
    const title = norm(a.textContent);
    if (!title || title.length < 3) continue;
    // one card per job url
    const idm = href.match(/\/job\/(\d+)/);
    const key = idm ? idm[1] : href;
    if (seen.has(key)) continue;
    // climb to the nearest card-ish container
    let card = a;
    for (let i = 0; i < 6 && card.parentElement; i++) {
      card = card.parentElement;
      const cls = (card.className || '').toString().toLowerCase();
      if (cls.includes('card') || cls.includes('result') || cls.includes('job') || card.tagName === 'ARTICLE' || card.tagName === 'LI') break;
    }
    const txt = norm(card.innerText || card.textContent);
    const grab = (labels) => {
      for (const lb of labels) {
        const re = new RegExp(lb + '\\s*[:\\-]?\\s*([^\\n|]+)', 'i');
        const m = txt.match(re);
        if (m) return norm(m[1]).slice(0, 80);
      }
      return '';
    };
    let org = grab(['organisation', 'organization', 'agency', 'department', 'employer', 'cluster']);
    let loc = grab(['location', 'region']);
    // fallback: an element whose class hints at org/location
    if (!org) {
      const el = card.querySelector('[class*="organisation" i],[class*="agency" i],[class*="department" i],[class*="employer" i]');
      if (el) org = norm(el.textContent).slice(0, 80);
    }
    if (!loc) {
      const el = card.querySelector('[class*="location" i],[class*="region" i]');
      if (el) loc = norm(el.textContent).slice(0, 80);
    }
    seen.add(key);
    rows.push({ title, url: href, agency: org, location: loc || 'New South Wales' });
  }
  return { count: anchors.length, rows };
}
"""

NEXT_JS = r"""
() => {
  const enabled = e => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true'
      && !(e.className || '').toLowerCase().includes('disabl');
  const isNext = e => {
    const t = (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g,' ').trim().toLowerCase();
    return t === 'next' || t === '>' || t === '»' || t === 'next page' || t.startsWith('next ') || t === 'go to next page';
  };
  const el = Array.from(document.querySelectorAll('a, button')).find(e => isNext(e) && enabled(e));
  if (el) { el.scrollIntoView(); el.click(); return true; }
  return false;
}
"""


def clear_cloudflare(page):
    """Wait for Cloudflare's 'Just a moment' interstitial to resolve."""
    for _ in range(8):
        title = (page.title() or '').lower()
        if 'just a moment' not in title and 'attention required' not in title:
            return True
        page.wait_for_timeout(3000)
    return 'just a moment' not in (page.title() or '').lower()


def scrape(page) -> list:
    all_rows, seen = [], set()
    clear_cloudflare(page)
    try:
        page.wait_for_selector('a[href*="/job/"]', timeout=30000)
    except Exception:
        pass
    for pageno in range(1, MAX_PAGES + 1):
        page.wait_for_timeout(1200)
        try:
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
    for r, sk in zip(scraped, skills):
        cid, company = agency_to_id(r.get('agency') or '')
        title = r['title']
        if norm(title) in have.get(cid, set()):
            continue
        location = r.get('location') or ''
        key = job_key('nsw-gov', title, company or cid, location)
        if key in seen:
            continue
        seen.add(key)
        out.append((key, 'nsw-gov', title, company or None, cid,
                    match_city(location), location, 'Government',
                    None, r.get('url') or '', '', json.dumps(sk) if sk else None))
    return out


def main() -> int:
    if not AGENCY_NAMES:
        sys.exit('Could not parse agency names from src/employsi/data/sydneyGov.ts')
    sys.stderr.write(f'NSW gov -> D1: {len(AGENCY_NAMES)} agencies in roster; '
                     f'{"SOLVE (no D1 write)" if SOLVE else "archiving"} '
                     f'({"HEADFUL" if HEADFUL else "headless"}).\n')
    exe = chromium_executable()
    with sync_playwright() as p:
        launch = {'headless': not HEADFUL, 'args': ['--disable-blink-features=AutomationControlled']}
        if exe:
            launch['executable_path'] = exe
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(
            user_agent=('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'),
            viewport={'width': 1440, 'height': 1000}, locale='en-AU')
        page = ctx.new_page()
        sys.stderr.write(f'  loading {START_URL}\n')
        page.goto(START_URL, wait_until='domcontentloaded', timeout=60000)
        scraped = scrape(page)
        browser.close()

    sys.stderr.write(f'  rendered {len(scraped)} vacancies\n')
    if SOLVE:
        for r in scraped[:6]:
            sys.stderr.write(f'    · {r.get("title","")[:46]:46} | {r.get("agency","")[:30]}\n')
        ok = len(scraped) > 0
        sys.stderr.write(f'\n{"OK — board rendered" if ok else "No rows (site changed / still challenged)"}.\n')
        return 0 if ok else 2

    if not scraped:
        sys.stderr.write('No rows rendered — nothing to archive. (Try --headful --solve.)\n')
        return 2
    if LIMIT < len(scraped):
        scraped = scraped[:LIMIT]
    have = existing_titles_by_company()
    rows = build_rows(scraped, have)
    written = upsert(rows) if rows else 0
    matched = sum(1 for r in rows if r[4] != 'nsw-gov')
    sys.stderr.write(f'\nDone. {len(scraped)} vacancies rendered, {written} new rows archived '
                     f'({matched} attributed to a specific agency, {written - matched} to the '
                     f'NSW-gov bucket).\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
