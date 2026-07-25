#!/usr/bin/env python3
"""
Scrape the NSW public-sector jobs board (iworkfor.nsw.gov.au) and archive it to
the D1 jobs table, deduped — the NSW-Government counterpart of scripts/
sa-gov-to-d1.py.

Why Oxylabs (not a plain browser): iworkfor.nsw.gov.au sits behind Cloudflare's
"Just a moment" interstitial, which persistently challenges datacenter IPs — a
headless Chromium on a GitHub runner never clears it (the first attempt rendered
0 rows for exactly this reason). Oxylabs' Web Scraper API fetches through a
residential IP with the Cloudflare challenge + JS render solved server-side and
returns the finished HTML, the same path the Indeed/LinkedIn scrapers use. So
this is a plain HTTP flow (no local browser) that runs fine on GitHub Actions.

One pass scrapes every current vacancy across all agencies, maps each to its
nsw-gov-<slug> company id (from data/sydneyGov.ts), maps skills via the worker
taxonomy, and upserts through the D1 HTTP API using the same
source|title|company|location key as src/employsi/lib/jobArchive.ts.

Env: OXYLABS_USERNAME, OXYLABS_PASSWORD (Web Scraper API), CLOUDFLARE_API_TOKEN
     (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/nsw-gov-to-d1.py [--max-pages N] [--solve] [--limit N]
"""
from __future__ import annotations
import html as htmllib
import json, os, re, subprocess, sys, time, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import urllib.request  # noqa: E402
try:
    import oxylabs_client as oxy
except Exception as e:  # noqa: BLE001
    sys.exit(f'Missing oxylabs_client ({e}).')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SITE = 'https://iworkfor.nsw.gov.au'
BASE = (SITE + '/jobs/all-keywords/all-agencies/all-organisations-entities/'
        'all-categories/all-locations/all-worktypes')

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 40))
NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args
LIMIT = int(_opt('--limit', 10**9))

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). (Not needed with --solve.)')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source, title, company, location):
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


CITIES = ['sydney', 'perth', 'adelaide', 'brisbane', 'melbourne']


def match_city(text):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    return 'sydney'


def slug(name):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))


def nsw_gov_id(name):
    return 'nsw-gov-' + slug(name)


def load_agency_names():
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


def agency_to_id(agency):
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


def map_skills(titles):
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


def d1(sql, params):
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


def existing_titles_by_company():
    out = {}
    r = d1("SELECT DISTINCT company_id, title FROM jobs WHERE source != 'nsw-gov'", [])
    for x in (r[0]['results'] if r else []):
        out.setdefault(str(x.get('company_id') or ''), set()).add(norm(str(x.get('title') or '')))
    return out


def upsert(rows):
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


TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')


def text_of(fragment):
    return WS.sub(' ', htmllib.unescape(TAG.sub(' ', fragment))).strip()


def parse_page(html: str):
    """Extract {title, url, agency, location} for every job card on the page.

    Tolerant: anchor on each /job/<id> link, then read the surrounding block's
    text (title = anchor text; organisation/location grabbed by label or by a
    class hint). Works on the server-rendered HTML Oxylabs returns."""
    rows = []
    seen = set()
    for m in re.finditer(r'<a\b[^>]*href="([^"]*?/job/(\d+)[^"]*)"[^>]*>(.*?)</a>', html, re.S | re.I):
        href, jid, inner = m.group(1), m.group(2), m.group(3)
        if jid in seen:
            continue
        title = text_of(inner)
        if not title or len(title) < 3:
            continue
        seen.add(jid)
        # window of HTML around the link → org/location
        s = max(0, m.start() - 1400)
        e = min(len(html), m.end() + 1400)
        block = text_of(html[s:e])
        def grab(labels):
            for lb in labels:
                g = re.search(lb + r'\s*[:\-]?\s*([^|\n]{2,70})', block, re.I)
                if g:
                    return g.group(1).strip()
            return ''
        agency = grab([r'organisation', r'organization', r'agency', r'department', r'cluster', r'employer'])
        loc = grab([r'location', r'region'])
        url = href if href.startswith('http') else SITE + href
        rows.append({'title': title, 'url': url, 'agency': agency, 'location': loc or 'New South Wales'})
    return rows


def diagnose(html: str, where: str):
    title = ''
    tm = re.search(r'<title[^>]*>(.*?)</title>', html or '', re.S | re.I)
    if tm:
        title = text_of(tm.group(1))[:80]
    n_job = len(re.findall(r'/job/\d+', html or ''))
    n_card = len(re.findall(r'class="[^"]*(?:card|result|job)[^"]*"', html or '', re.I))
    sys.stderr.write(f'  [diag {where}] len={len(html or "")} title={title!r} '
                     f'/job/={n_job} cardish={n_card}\n')
    # dump a snippet around the first "job" mention to reveal the structure
    idx = (html or '').lower().find('/job/')
    if idx < 0:
        idx = (html or '').lower().find('job')
    if idx >= 0:
        sys.stderr.write('  [diag snippet] ' + WS.sub(' ', (html[idx - 200:idx + 500] or ''))[:600] + '\n')


def page_url(pg: int) -> str:
    return BASE if pg <= 1 else f'{BASE}?page={pg}'


def main() -> int:
    if not AGENCY_NAMES:
        sys.exit('Could not parse agency names from src/employsi/data/sydneyGov.ts')
    if not (os.environ.get('OXYLABS_USERNAME') and os.environ.get('OXYLABS_PASSWORD')):
        sys.exit('OXYLABS_USERNAME / OXYLABS_PASSWORD required (Web Scraper API).')
    sys.stderr.write(f'NSW gov -> D1 via Oxylabs: {len(AGENCY_NAMES)} agencies in roster.\n')

    scraped, seen = [], set()
    for pg in range(1, MAX_PAGES + 1):
        url = page_url(pg)
        content, status = oxy.fetch(url, geo='Australia', render=True)
        if not content:
            sys.stderr.write(f'  page {pg}: no content (status={status})\n')
            if pg == 1:
                return 2
            break
        rows = parse_page(content)
        if not rows and pg == 1:
            diagnose(content, 'page1')
        new = 0
        for r in rows:
            k = (norm(r['title']), norm(r['agency']), norm(r['location']))
            if k in seen:
                continue
            seen.add(k)
            scraped.append(r)
            new += 1
        sys.stderr.write(f'  page {pg}: {len(rows)} rows ({new} new)\n')
        if new == 0:
            break

    sys.stderr.write(f'  rendered {len(scraped)} vacancies\n')
    if SOLVE:
        for r in scraped[:6]:
            sys.stderr.write(f'    · {r["title"][:46]:46} | {r["agency"][:30]}\n')
        return 0 if scraped else 2
    if not scraped:
        return 2
    if LIMIT < len(scraped):
        scraped = scraped[:LIMIT]

    have = existing_titles_by_company()
    titles = [r['title'] for r in scraped]
    skills = map_skills(titles)
    out, keyset = [], set()
    for r, sk in zip(scraped, skills):
        cid, company = agency_to_id(r.get('agency') or '')
        if norm(r['title']) in have.get(cid, set()):
            continue
        loc = r.get('location') or ''
        key = job_key('nsw-gov', r['title'], company or cid, loc)
        if key in keyset:
            continue
        keyset.add(key)
        out.append((key, 'nsw-gov', r['title'], company or None, cid,
                    match_city(loc), loc, 'Government', None, r.get('url') or '', '',
                    json.dumps(sk) if sk else None))
    written = upsert(out) if out else 0
    matched = sum(1 for r in out if r[4] != 'nsw-gov')
    sys.stderr.write(f'\nDone. {len(scraped)} vacancies, {written} new rows archived '
                     f'({matched} to a specific agency, {written - matched} to the NSW-gov bucket).\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
