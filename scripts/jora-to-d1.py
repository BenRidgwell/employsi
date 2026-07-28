#!/usr/bin/env python3
"""
Scrape Jora (au.jora.com) for every company on the roster and archive the
results to the D1 jobs table, deduped — the Australian counterpart of
scripts/jobsdb-to-d1.py and scripts/indeed-to-d1.py.

WHAT IT TALKS TO
Jora's search results are server-rendered at

    GET https://au.jora.com/j?q=<company>&l=Australia&p=<page>

Each result is a `<div class="job-card result ...">` carrying a
`data-braze-job-panel-view` attribute whose JSON already holds the fields we
want — `job_title`, `company_name`, `location`, `job_id` — so the title and
employer are read out of structured data rather than scraped out of markup that
changes with every design tweak. The posted date is a relative string
("Posted 24h ago") in `.job-listed-date`, and the salary, when Jora shows one,
is a `$…` badge in the card body.

WHY OXYLABS
Jora 403s plain datacentre requests outright. Every fetch goes through the
shared Oxylabs client (scripts/oxylabs_client.py) for the residential IP,
throttling and backoff, exactly as the Indeed, Zhaopin and JobsDB scrapers do.
`--direct` bypasses it for local debugging and is expected to fail.

WHY THE KEYWORD SEARCH IS POST-FILTERED
`q=` matches the whole ad, not the employer, so a search for "BHP" returns
hundreds of ads that merely mention BHP. Only ads whose own `company_name`
matches the roster company are kept, and the match is whole-word token-subset
(not substring) so "ANZ" cannot match "Danzig" and "ABN" cannot match an
Australian Business Number mentioned in someone else's ad.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD.
Run: python scripts/jora-to-d1.py [--only id1,id2] [--limit N]
                                  [--max-pages N] [--concurrency N]
                                  [--direct] [--dry-run]
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
SOURCE = 'jora'
BASE = 'https://au.jora.com'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 3))
CONCURRENCY = int(_opt('--concurrency', 6))
DIRECT = '--direct' in args
DRY = '--dry-run' in args

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── text helpers ──────────────────────────────────────────────────────────────
def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# Corporate suffixes Jora's advertisers drop ("ANZ Group Holdings" advertises as
# "ANZ"), so the roster's legal name is also searched in its brand form.
SUFFIXES = re.compile(
    r'\b(group holdings|holdings|group|limited|ltd|pty|plc|corporation|corp|company|'
    r'co|inc|nl|australia|australian|international|global|services)\b', re.I)


def query_variants(name: str) -> list[str]:
    out = [name]
    brand = SUFFIXES.sub(' ', name)
    brand = re.sub(r'\s+', ' ', brand).strip(' ,.&-')
    if brand and brand.lower() != name.lower() and len(brand) >= 2:
        out.append(brand)
    return out


STOP = {'the', 'and', 'of', 'group', 'holdings', 'limited', 'ltd', 'pty', 'plc', 'inc',
        'corporation', 'corp', 'company', 'co', 'australia', 'australian', 'nl'}


def matches_company(advertiser: str, roster_name: str) -> bool:
    """Whole-word token-subset match.

    Substring matching is what produces the classic false positives — "ABN"
    inside "ABN 12 345 678 901", "ANZ" inside "Danzig" — so the advertiser's
    tokens have to CONTAIN the roster name's significant tokens as whole words.
    """
    a = set(norm(advertiser).split())
    r = [t for t in norm(roster_name).split() if t not in STOP]
    if not r:
        r = norm(roster_name).split()
    return bool(r) and set(r).issubset(a)


# ── relative dates ────────────────────────────────────────────────────────────
def posted_date(text: str) -> str:
    """'Posted 24h ago' / 'Posted 3d ago' / 'Posted 30+ days ago' → ISO day."""
    t = (text or '').lower()
    d = datetime.date.today()
    m = re.search(r'(\d+)\s*\+?\s*(h|hour|d|day|w|week|m|month)', t)
    if not m:
        return d.isoformat()
    n, unit = int(m.group(1)), m.group(2)
    days = {'h': 0, 'hour': 0, 'd': 1, 'day': 1, 'w': 7, 'week': 7, 'm': 30, 'month': 30}[unit]
    return (d - datetime.timedelta(days=n * days)).isoformat()


# ── fetch ─────────────────────────────────────────────────────────────────────
def get(url: str) -> str | None:
    if DIRECT:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            sys.stderr.write(f'  direct fetch failed (expected — Jora 403s): {e}\n')
            return None
    from oxylabs_client import fetch as oxy_fetch
    content, _ = oxy_fetch(url, geo='Australia', render=True)
    return content


CARD_SPLIT = re.compile(r'class="job-card result', re.I)
PANEL_RE = re.compile(r'data-braze-job-panel-view="([^"]+)"')
DATE_RE = re.compile(r'job-listed-date[^>]*>([^<]{2,40})', re.I)
SALARY_RE = re.compile(r'(\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:per|p/?)\s*\w+)?)')


def parse_page(page_html: str) -> list[dict]:
    out = []
    for card in CARD_SPLIT.split(page_html)[1:]:
        m = PANEL_RE.search(card)
        if not m:
            continue
        try:
            panel = json.loads(html.unescape(m.group(1)))
        except Exception:
            continue
        title = (panel.get('job_title') or '').strip()
        if not title:
            continue
        jid = (panel.get('job_id') or '').strip()
        dm = DATE_RE.search(card)
        sm = SALARY_RE.search(re.sub(r'<[^>]+>', ' ', card[:3000]))
        out.append({
            'title': title,
            'company': (panel.get('company_name') or '').strip(),
            'location': (panel.get('location') or '').strip(),
            'url': f'{BASE}/job/{jid}' if jid else f'{BASE}/j',
            'posted': posted_date(clean(dm.group(1)) if dm else ''),
            'salary': clean(sm.group(1)) if sm else None,
            'category': 'Jora',
        })
    return out


def scrape_company(company_id: str, name: str) -> tuple[list, int]:
    """Returns (matching jobs, ads seen)."""
    jobs, seen_keys, seen_ads = [], set(), 0
    for q in query_variants(name):
        for page in range(1, MAX_PAGES + 1):
            url = f'{BASE}/j?q={urllib.parse.quote(q)}&l=Australia&p={page}'
            page_html = get(url)
            if not page_html:
                break
            rows = parse_page(page_html)
            if not rows:
                break
            seen_ads += len(rows)
            for j in rows:
                if not matches_company(j['company'], name):
                    continue
                k = job_key(SOURCE, j['title'], j['company'], j['location'])
                if k in seen_keys:
                    continue
                seen_keys.add(k)
                jobs.append(j)
            if len(rows) < 10:  # a short page is the last page
                break
    return jobs, seen_ads


# ── company roster ────────────────────────────────────────────────────────────
def load_companies() -> list[dict]:
    """The full roster — listed plus the Top-150 private — via scripts/roster.py,
    which RUNS the TypeScript rather than regexing it. The private roster is
    generated at module load, so a regex over the source sees none of it."""
    from roster import load_roster
    return load_roster(only=ONLY, limit=None if LIMIT >= 10**9 else LIMIT)


def map_skills(titles: list, sector: str | None = None) -> list:
    if not titles:
        return []
    payload = {'titles': titles, 'sector': sector} if sector else titles
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=120, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:160]}\n')
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


# Jora is Australia-wide; a role's own location text decides the hub.
HUBS = [('perth', 'perth'), ('western australia', 'perth'),
        ('brisbane', 'brisbane'), ('queensland', 'brisbane'),
        ('melbourne', 'melbourne'), ('victoria', 'melbourne'),
        ('adelaide', 'adelaide'), ('south australia', 'adelaide'),
        ('canberra', 'canberra'), ('sydney', 'sydney'), ('new south wales', 'sydney')]


def hub_for(loc: str) -> str | None:
    low = (loc or '').lower()
    for needle, hub in HUBS:
        if needle in low:
            return hub
    return None


def upsert(company_id: str, jobs: list, sector: str | None = None) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts, so a role already
    archived from another source refreshes rather than duplicating."""
    skills = map_skills([j['title'] for j in jobs], sector)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        key = job_key(SOURCE, j['title'], j['company'] or company_id, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], j['company'] or None, company_id,
                     hub_for(j['location']), j['location'], j['category'], j['salary'],
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
               'salary = COALESCE(jobs.salary, excluded.salary), '
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
    companies = load_companies()
    if not companies:
        sys.exit('No companies matched — check --only.')
    sys.stderr.write(
        f'Jora AU -> D1: {len(companies)} companies, '
        f'{"DIRECT" if DIRECT else "via Oxylabs"}{", DRY RUN" if DRY else ""}.\n')

    from concurrent.futures import ThreadPoolExecutor
    results: dict[str, tuple[list, int]] = {}
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(scrape_company, c['id'], c['name']): c for c in companies}
        for f in futures:
            c = futures[f]
            try:
                results[c['id']] = f.result()
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f'  {c["id"]}: {e}\n')
                results[c['id']] = ([], 0)

    matched = {k: v for k, v in results.items() if v[0]}
    total_ads = sum(v[1] for v in results.values())
    sys.stderr.write(
        f'{len(matched)}/{len(companies)} companies matched; '
        f'{sum(len(v[0]) for v in matched.values())} ads kept of {total_ads} seen.\n')
    if not matched:
        # Every company returning nothing means the search contract changed or
        # we were blocked — not that the whole roster stopped hiring.
        sys.stderr.write('Nothing matched across the entire roster — treating as a failure.\n')
        return 1
    if DRY:
        for cid, (jobs, _) in list(matched.items())[:8]:
            sys.stderr.write(f'  {cid}: {len(jobs)} e.g. "{jobs[0]["title"][:50]}" '
                             f'@ {jobs[0]["location"][:26]} sal={jobs[0]["salary"]}\n')
        return 0
    sector_by_id = {c['id']: (c.get('sector') or '') for c in companies}
    written = 0
    for cid, (jobs, _) in matched.items():
        written += upsert(cid, jobs, sector_by_id.get(cid))
    sys.stderr.write(f'{written} rows upserted to D1 as {SOURCE}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
