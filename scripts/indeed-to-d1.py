#!/usr/bin/env python3
"""
Scrape each company's Indeed board (across all its locations) and archive it to
the D1 jobs table, deduped — the Indeed counterpart of scripts/seek-to-d1.py.

Meant to run from YOUR OWN machine on a schedule (cron / launchd / Task
Scheduler), NOT from CI/Workers: Indeed's DataDome hard-blocks datacenter IPs,
so only a residential connection reliably renders results. It drives the
tools/indeed-company-scraper browser (one warmed Chromium reused across all
companies), maps skills for parity via the worker's own taxonomy
(scripts/map-skills.ts), drops any role already archived for that company by
another source, and upserts through the D1 HTTP API with the same
source|title|company|location key + upsert as src/employsi/lib/jobArchive.ts.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python scripts/indeed-to-d1.py [--country au] [--only id1,id2] [--limit N]
                                     [--headful] [--proxy URL] [--max-pages N]

First time on a fresh machine:
    pip install playwright && playwright install chromium
"""
from __future__ import annotations
import json, os, random, re, subprocess, sys, time, datetime

# Make the Indeed scraper importable.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'indeed-company-scraper'))
try:
    import indeed_company_scraper as ind  # noqa: E402
    from playwright.sync_api import sync_playwright  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}). Run: pip install playwright && playwright install chromium')

import urllib.request  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney']

args = sys.argv[1:]

def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default

COUNTRY = _opt('--country', 'au')
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 20))
HEADFUL = '--headful' in args
PROXY = _opt('--proxy', None)
PROFILE = _opt('--profile', None)          # persistent browser dir (cookies survive)
STRICT = '--strict-company' in args
NO_SKILLS = '--no-skills' in args
# Jittered pacing so the traffic doesn't read as a fixed-interval bot.
MIN_DELAY = float(_opt('--min-delay', 8))   # seconds between companies (min)
MAX_DELAY = float(_opt('--max-delay', 25))  # seconds between companies (max)
PAGE_MIN = float(_opt('--page-min', 2))     # seconds between result pages (min)
PAGE_MAX = float(_opt('--page-max', 6))     # seconds between result pages (max)
# --solve: clear the DataDome wall / check reachability only — no D1 write, so no
# token needed. Pair with --headful to solve the human check by hand into a
# --profile; run it again without --headful to confirm the cached profile gets
# through (prints reachable/blocked per company).
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
    # Only OTHER sources — so an Indeed job that duplicates an Adzuna/SEEK/etc.
    # role is counted once, but Indeed's own previously-archived jobs re-upsert
    # and refresh their last_seen (keeping still-live roles "current").
    r = d1("SELECT DISTINCT title FROM jobs WHERE company_id = ? AND source != 'indeed'", [company_id])
    return {norm(str(x.get('title') or '')) for x in (r[0]['results'] if r else [])}


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['title'] for j in jobs]
    skills = map_skills(titles)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j.get('company') or company_id
        location = j.get('location') or ''
        key = job_key('indeed', j['title'], company or company_id, location)
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, 'indeed', j['title'], company or None, company_id,
                     match_city(location), location, j.get('country') or COUNTRY,
                     j.get('salary') or None, j.get('url') or '', j.get('date') or '',
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
    base = ind.COUNTRIES.get(COUNTRY)
    if not base:
        sys.exit(f'Unknown --country "{COUNTRY}". Options: {", ".join(ind.COUNTRIES)}')
    companies = load_companies()
    mode = 'SOLVE / reachability check — no D1 write' if SOLVE else 'Indeed -> D1'
    sys.stderr.write(f'{mode}: {len(companies)} company(ies) on {COUNTRY}.indeed '
                     f'({"HEADFUL" if HEADFUL else "headless"}'
                     f'{", profile=" + PROFILE if PROFILE else ""}).\n')
    if SOLVE and not HEADFUL:
        sys.stderr.write('  (headless: verifying the cached profile gets through. '
                         'Add --headful the first time to solve the wall by hand.)\n')

    total_fetch = total_new = blocked = done = 0
    consecutive_blocks = 0
    with sync_playwright() as p:
        session, page = ind.open_session(p, headful=HEADFUL, proxy=PROXY, profile=PROFILE)
        first = True
        for cid, name in companies:
            if done >= LIMIT:
                break
            if not first:
                time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))  # jittered gap between companies
            first = False
            jobs, was_blocked = ind.scrape_company(
                page, base, name, max_pages=MAX_PAGES, strict_company=STRICT, country=COUNTRY,
                page_delay=(PAGE_MIN, PAGE_MAX))
            if was_blocked:
                blocked += 1
                consecutive_blocks += 1
                sys.stderr.write(f'  {cid:16} BLOCKED\n')
                if consecutive_blocks >= 3:
                    sys.stderr.write('  3 consecutive blocks — stopping (DataDome is throttling this IP).\n')
                    break
                done += 1
                continue
            consecutive_blocks = 0
            total_fetch += len(jobs)
            if SOLVE:
                # No D1 — just report we got through the wall.
                sys.stderr.write(f'  {cid:16} {len(jobs):3} jobs · reachable ✓\n')
                done += 1
                continue
            if not jobs:
                sys.stderr.write(f'  {cid:16} 0 jobs\n')
                done += 1
                continue
            have = existing_titles(cid)
            fresh = [j for j in jobs if norm(j['title']) not in have]
            written = upsert(cid, fresh) if fresh else 0
            total_new += written
            sys.stderr.write(f'  {cid:16} {len(jobs):3} indeed · {written:3} new '
                             f'({len(jobs) - len(fresh)} already archived)\n')
            done += 1
        session.close()

    if SOLVE:
        ok = done - blocked
        sys.stderr.write(f'\n{"✓ Reachable" if ok and not blocked else ("Partially blocked" if ok else "✗ Blocked")}'
                         f' — {ok} reachable, {blocked} blocked. '
                         f'{"Cached to " + PROFILE if PROFILE else "Tip: add --profile <dir> to cache the solved session."}\n')
        return 2 if (companies and blocked >= done) else 0

    sys.stderr.write(f'\nDone. {total_fetch} Indeed listings fetched, {total_new} new rows '
                     f'archived, {blocked} companies blocked.\n')
    if companies and blocked > len(companies) * 0.5:
        sys.stderr.write('WARNING: over half blocked — Indeed is throttling this host.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
