#!/usr/bin/env python3
"""
Scrape each company's LinkedIn jobs (via LinkedIn's guest jobs-search endpoint)
and archive them to the D1 jobs table, deduped — the LinkedIn counterpart of
scripts/indeed-to-d1.py and scripts/zhaopin-to-d1.py.

LinkedIn hard-blocks datacenter IPs, so this runs through the Oxylabs Web Scraper
API (residential IP + rendering server-side). Set OXYLABS_USERNAME /
OXYLABS_PASSWORD and it needs no browser at all — so it runs anywhere (GitHub
Actions, a Worker, your PC). Skills are mapped via the worker's own taxonomy
(scripts/map-skills.ts) for parity, any role already archived for that company by
another source is dropped (no cross-source duplicates), and rows are upserted
through the D1 HTTP API with the same source|title|company|location key + upsert
as src/employsi/lib/jobArchive.ts.

Env:  OXYLABS_USERNAME, OXYLABS_PASSWORD  (residential fetch)
      CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run:  python scripts/linkedin-to-d1.py [--location Australia] [--only id1,id2]
                                       [--limit N] [--max-pages N] [--concurrency N]
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'linkedin-company-scraper'))
sys.path.insert(0, HERE)  # oxylabs_client
try:
    import linkedin_company_scraper as li  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}).')

import urllib.request  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney', 'canberra']

args = sys.argv[1:]

def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default

LOCATION = _opt('--location', 'Australia')
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 10))     # guest API returns 25 cards/page
CONCURRENCY = int(_opt('--concurrency', 8))  # keep ≤ your Oxylabs plan's limit
NO_SKILLS = '--no-skills' in args
# --solve: reachability check only (no D1 write, no token needed).
SOLVE = '--solve' in args

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
             '(Not needed with --solve, which skips the D1 write.)')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def match_city(text: str):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    return None


# ── company roster (id + name) parsed from AU_JOBS_TARGETS ────────────────────
def load_companies() -> list[tuple[str, str]]:
    txt = open(os.path.join(ROOT, 'src/employsi/data/auJobsTargets.ts')).read()
    ids = re.findall(r'"id":\s*"([^"]+)"', txt)
    names = re.findall(r'"name":\s*"([^"]+)"', txt)
    pairs = list(zip(ids, names))
    return [(cid, nm) for cid, nm in pairs if not ONLY or cid in ONLY]


# ── skills parity via the worker's own taxonomy (offline bun helper) ──────────
def map_skills(titles: list) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode(), capture_output=True, timeout=120)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:160]}\n')
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


def existing_titles(company_id: str) -> set:
    # Only OTHER sources — so a LinkedIn job that duplicates an Adzuna/SEEK/Indeed
    # role is counted once, but LinkedIn's own previously-archived jobs re-upsert
    # and refresh their last_seen (keeping still-live roles "current").
    r = d1("SELECT DISTINCT title FROM jobs WHERE company_id = ? AND source != 'linkedin'", [company_id])
    return {norm(str(x.get('title') or '')) for x in (r[0]['results'] if r else [])}


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['title'] for j in jobs]
    skills = map_skills(titles)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or company_id
        location = j.get('location') or ''
        key = job_key('linkedin', j['title'], company or company_id, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'linkedin', j['title'], company or None, company_id,
                     match_city(location), location, 'LinkedIn',
                     None, j.get('url') or '', j.get('date') or '',
                     json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params/query
        chunk = rows[i:i + 7]
        values = ','.join(['(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'] * len(chunk))
        sql = (f'INSERT INTO jobs '
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


def main() -> int:
    if not os.environ.get('OXYLABS_USERNAME'):
        sys.exit('LinkedIn blocks datacenter IPs — set OXYLABS_USERNAME/OXYLABS_PASSWORD '
                 'to fetch via the Oxylabs Web Scraper API.')
    import oxylabs_client as oxy
    from concurrent.futures import ThreadPoolExecutor
    import threading

    companies = load_companies()
    sel = companies[:LIMIT] if LIMIT < len(companies) else companies
    geo = li.GEO_FOR.get(LOCATION, LOCATION)
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'LinkedIn -> D1'
    sys.stderr.write(f'{mode}: {len(sel)} company(ies) via Oxylabs '
                     f'(location="{LOCATION}", geo={geo}, concurrency={CONCURRENCY}) — no browser.\n')
    lock = threading.Lock()
    st = {'fetch': 0, 'new': 0, 'empty': 0, 'done': 0}

    def work(cid, name):
        jobs, seen = [], set()
        for pg in range(MAX_PAGES):
            content, _ = oxy.fetch(li.search_url(name, LOCATION, pg * li.PER_PAGE),
                                   geo=geo, render=True)
            if not content:
                break
            new = 0
            for j in li.parse_search_html(content):
                # LinkedIn's keyword search is fuzzy; keep only cards whose
                # company actually matches the target (drops recruiter noise).
                if j.get('company') and norm(name) not in norm(j['company']) \
                        and norm(j['company']) not in norm(name):
                    continue
                k = (norm(j['title']), norm(j.get('location', '')))
                if k in seen:
                    continue
                seen.add(k)
                jobs.append(j)
                new += 1
            if new == 0:  # page repeated / empty → end of results
                break
        if SOLVE:
            with lock:
                st['fetch'] += len(jobs); st['done'] += 1
            sys.stderr.write(f'  {cid:16} {len(jobs):3} jobs · reachable ✓\n')
            return
        if not jobs:
            with lock:
                st['empty'] += 1; st['done'] += 1
            sys.stderr.write(f'  {cid:16} 0 jobs\n')
            return
        have = existing_titles(cid)
        fresh = [j for j in jobs if norm(j['title']) not in have]
        written = upsert(cid, fresh) if fresh else 0
        with lock:
            st['fetch'] += len(jobs); st['new'] += written; st['done'] += 1
        sys.stderr.write(f'  {cid:16} {len(jobs):3} linkedin · {written:3} new '
                         f'({len(jobs) - len(fresh)} already archived)\n')

    with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as ex:
        list(ex.map(lambda cn: work(*cn), sel))

    if SOLVE:
        sys.stderr.write(f'\n✓ {st["done"]} companies reachable via Oxylabs.\n')
        return 0
    sys.stderr.write(f'\nDone (Oxylabs). {st["fetch"]} listings fetched, {st["new"]} new rows '
                     f'archived, {st["empty"]} companies with 0 jobs.\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
