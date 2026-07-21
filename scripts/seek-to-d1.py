#!/usr/bin/env python3
"""
Scrape every mapped AU company's SEEK board and archive it to the D1 jobs table
— the SEEK counterpart of what the jobs-cron worker does for Adzuna/Muse/Jooble,
run from a NON-Cloudflare host because SEEK's Cloudflare front 403-challenges
Cloudflare Workers (see workers/jobs-cron/ARCHIVE.md).

Why Python (not the worker's TS via bun): SEEK's Cloudflare also challenges
bun's fetch TLS fingerprint, but serves Python/requests (OpenSSL, like curl)
normally. So the network read is done here; skills are mapped for parity by
shelling to the worker's own taxonomy (scripts/map-skills.ts via bun), and rows
are written through the D1 HTTP API with the same source|title|company|location
dedup key + upsert as src/employsi/lib/jobArchive.ts.

No double counting across sources: before archiving a company's SEEK jobs we
read that company's already-archived titles (any source) from D1 and drop any
SEEK role whose normalised title already exists — the cross-board check
pullCompany applies to The Muse.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python scripts/seek-to-d1.py [--limit N] [--only id1,id2] [--no-skills]
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime
from urllib.parse import urlencode
import urllib.request

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID', '080a66721e2d85950d9d7dc939e08b76')
DB = os.environ.get('D1_DATABASE_ID', '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1')
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

SEEK_API = 'https://www.seek.com.au/api/jobsearch/v5/search'
JOB_URL = 'https://www.seek.com.au/job/'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
PAGE_SIZE = 100
MAX_PAGES = 3
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney']
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TODAY = datetime.date.today().isoformat()

args = sys.argv[1:]
LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else 10**9
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
NO_SKILLS = '--no-skills' in args

if not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit).')


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


# ── SEEK advertiser map (parsed from the generated TS) ────────────────────────
def load_advertisers() -> dict:
    txt = open(os.path.join(ROOT, 'src/employsi/data/seekAdvertisers.ts')).read()
    out = {}
    for m in re.finditer(r"'([^']+)':\s*\{\s*advertiserId:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)'\s*\}", txt):
        out[m.group(1)] = {'advertiserId': m.group(2), 'name': m.group(3).replace("\\'", "'")}
    return out


# ── SEEK read (Python/requests-class client SEEK serves) ──────────────────────
def seek_get(params: dict):
    url = f'{SEEK_API}?{urlencode(params)}'
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    return json.loads(r.read().decode('utf-8'))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def fetch_company(advertiser_id: str, name: str) -> list:
    out, seen = [], set()
    total_pages = 1
    page = 1
    while page <= total_pages and page <= MAX_PAGES:
        data = seek_get({
            'siteKey': 'AU-Main', 'sourcesystem': 'houston', 'where': 'All Australia',
            'advertiserid': advertiser_id, 'page': page, 'pageSize': PAGE_SIZE, 'locale': 'en-AU',
        })
        if not data:
            break
        if page == 1:
            total = int(data.get('totalCount') or 0)
            total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
        jobs = data.get('data') or []
        if not jobs:
            break
        for j in jobs:
            jid = str(j.get('id') or '')
            if jid in seen:
                continue
            seen.add(jid)
            title = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', ' ', j.get('title') or '')).strip()
            if not title:
                continue
            cls = (j.get('classifications') or [{}])[0]
            cat = ((cls.get('classification') or {}).get('description') or '')
            loc = ((j.get('locations') or [{}])[0].get('label') or '')
            co = (j.get('companyName') or (j.get('advertiser') or {}).get('description') or name)
            out.append({
                't': title, 'loc': loc, 'cat': cat,
                'url': JOB_URL + jid if jid else '',
                'created': str(j.get('listingDate') or '')[:10],
                'city': match_city(loc) or match_city(title),
                'co': co, 'sal': (j.get('salaryLabel') or '').strip() or None,
            })
        page += 1
        time.sleep(1.2)
    return out


# ── skills parity via the worker's own taxonomy (offline bun helper) ──────────
def map_skills(titles: list) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode('utf-8'),
                           capture_output=True, timeout=120)
        if p.returncode == 0:
            return json.loads(p.stdout.decode('utf-8'))
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── D1 HTTP API ───────────────────────────────────────────────────────────────
def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode('utf-8')
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                j = json.loads(r.read().decode('utf-8'))
                if j.get('success'):
                    return j['result']
                raise RuntimeError(str(j.get('errors')))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:400]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
            time.sleep(1.0 * (attempt + 1))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.0 * (attempt + 1))


def existing_titles(company_id: str) -> set:
    r = d1('SELECT DISTINCT title FROM jobs WHERE company_id = ?', [company_id])
    return {norm(str(x.get('title') or '')) for x in (r[0]['results'] if r else [])}


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['t'] for j in jobs]
    skills = map_skills(titles)
    rows = []
    seen = set()
    for j, sk in zip(jobs, skills):
        company = j['co'] or company_id
        key = job_key('seek', j['t'], company or company_id, j['loc'] or j['city'] or '')
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'seek', j['t'], company or None, company_id, j['city'],
                     j['loc'] or '', j['cat'] or '', j['sal'], j['url'] or '',
                     j['created'] or '', json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):
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
    advertisers = load_advertisers()
    ids = [cid for cid in advertisers if not ONLY or cid in ONLY]
    sys.stderr.write(f'SEEK -> D1: {len(ids)} mapped companies.\n')
    total_fetch = total_new = blocked = done = 0
    for cid in ids:
        if done >= LIMIT:
            break
        adv = advertisers[cid]
        jobs = fetch_company(adv['advertiserId'], adv['name'])
        if not jobs:
            blocked += 1
            sys.stderr.write(f'  {cid:16} 0 jobs\n')
            done += 1
            continue
        total_fetch += len(jobs)
        have = existing_titles(cid)
        fresh = [j for j in jobs if norm(j['t']) not in have]
        written = upsert(cid, fresh) if fresh else 0
        total_new += written
        sys.stderr.write(f'  {cid:16} {len(jobs):3} seek · {written:3} new '
                         f'({len(jobs) - len(fresh)} already archived)\n')
        done += 1
    sys.stderr.write(f'\nDone. {total_fetch} SEEK listings fetched, {total_new} new rows '
                     f'archived, {blocked} companies returned 0.\n')
    if ids and blocked > len(ids) * 0.5:
        sys.stderr.write('WARNING: over half returned 0 — SEEK may be blocking this host.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
