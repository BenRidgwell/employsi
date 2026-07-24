#!/usr/bin/env python3
"""
Scrape the APS Jobs board (apsjobs.gov.au — federal / Commonwealth vacancies) and
archive it to the D1 jobs table, deduped — the federal counterpart of the state
gov scrapers.

Why a browser: apsjobs.gov.au is a Salesforce Aura site whose results are fetched
by a session-gated ApexAction and rendered client-side; a plain HTTP client gets
an empty "Guest user access is not allowed" shell (see tools/aps-jobs-scraper).
So it runs from YOUR OWN machine via Playwright, like the SA scraper.

One pass scrapes every current APS vacancy, maps each to its `aps-<slug>` agency
id (mapped ONLY against the federal roster — never a state gov id, so a federal
agency's jobs are never double-counted with WA/QLD/SA/VIC state agencies), maps
skills for parity via scripts/map-skills.ts, and upserts through the D1 HTTP API
with the same source|title|company|location key + upsert as
src/employsi/lib/jobArchive.ts. Jobs whose agency can't be matched are archived
under company_id 'aps-gov' (the federal bucket).

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
Run:  python3 scripts/aps-to-d1.py [--max-pages N] [--headful] [--profile DIR]
                                   [--no-skills] [--solve] [--limit N]

First time on a fresh machine:
    pip3 install playwright && python3 -m playwright install chromium
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'aps-jobs-scraper'))
try:
    import aps_jobs_scraper as aps  # noqa: E402
    from playwright.sync_api import sync_playwright  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing dependency ({e}). Run: pip3 install playwright && python3 -m playwright install chromium')

import urllib.request  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()
CITIES = ['canberra', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide']

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


MAX_PAGES = int(_opt('--max-pages', 40))
HEADFUL = '--headful' in args
PROFILE = _opt('--profile', None)
PROXY = _opt('--proxy', None)
NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args
LIMIT = int(_opt('--limit', 10**9))

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). '
             '(Not needed with --solve, which skips the D1 write.)')


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


# ── APS agency roster → aps-<slug> id (parsed from data/canberraGov.ts) ────────
def slug(name: str) -> str:
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))


def aps_id(name: str) -> str:
    return 'aps-' + slug(name)


def load_agencies() -> tuple[list[str], dict]:
    txt = open(os.path.join(ROOT, 'src/employsi/data/canberraGov.ts')).read()
    block = re.search(r'const AGENCIES:\s*AgencyEntry\[\]\s*=\s*\[(.*?)\];', txt, re.S)
    names, hubs = [], {}
    if block:
        for m in re.finditer(r'\[\s*("(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\')\s*(?:,\s*\'([^\']+)\')?\s*\]', block.group(1)):
            raw = m.group(1)[1:-1].replace('\\"', '"').replace("\\'", "'")
            names.append(raw)
            hubs[aps_id(raw)] = m.group(2) or 'canberra'
    return names, hubs


AGENCY_NAMES, AGENCY_HUB = load_agencies()
AGENCY_BY_NORM = {norm(n): aps_id(n) for n in AGENCY_NAMES}
AGENCY_SORTED = sorted(AGENCY_NAMES, key=lambda n: len(n), reverse=True)


def agency_to_id(agency: str) -> tuple[str, str]:
    """Map a job's agency text to an aps-* id ONLY (never a state gov id)."""
    n = norm(agency)
    if not n:
        return 'aps-gov', 'Australian Public Service'
    if n in AGENCY_BY_NORM:
        return AGENCY_BY_NORM[n], agency.strip()
    for name in AGENCY_SORTED:
        nn = norm(name)
        if nn and (nn in n or n in nn):
            return aps_id(name), agency.strip()
    return 'aps-gov', agency.strip() or 'Australian Public Service'


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
    out: dict = {}
    r = d1("SELECT DISTINCT company_id, title FROM jobs WHERE source != 'aps-gov'", [])
    for x in (r[0]['results'] if r else []):
        out.setdefault(str(x.get('company_id') or ''), set()).add(norm(str(x.get('title') or '')))
    return out


def build_rows(scraped: list, have: dict):
    out, seen, kept = [], set(), []
    titles = [r['t'] for r in scraped]
    skills = map_skills(titles)
    for r, sk in zip(scraped, skills):
        cid, company = agency_to_id(r.get('agency') or '')
        title = r['t']
        if norm(title) in have.get(cid, set()):
            continue
        location = r.get('loc') or ''
        hub = match_city(location) or AGENCY_HUB.get(cid, 'canberra')
        key = job_key('aps-gov', title, company or cid, location)
        if key in seen:
            continue
        seen.add(key)
        out.append((key, 'aps-gov', title, company or None, cid, hub, location or 'Australia',
                    'Government', r.get('salary') or None, r.get('url') or '',
                    r.get('close') or '', json.dumps(sk) if sk else None))
        kept.append(cid)
    return out, kept


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


def main() -> int:
    if not AGENCY_NAMES:
        sys.exit('Could not parse agencies from src/employsi/data/canberraGov.ts')
    sys.stderr.write(f'APS -> D1: {len(AGENCY_NAMES)} federal agencies in roster; '
                     f'{"SOLVE (no D1 write)" if SOLVE else "archiving"} '
                     f'({"HEADFUL" if HEADFUL else "headless"}'
                     f'{", profile=" + PROFILE if PROFILE else ""}).\n')
    with sync_playwright() as p:
        ctx, page = aps.open_session(p, headful=HEADFUL, proxy=PROXY, profile=PROFILE)
        scraped, blocked = aps.scrape(page, max_pages=MAX_PAGES)
        ctx.close()

    sys.stderr.write(f'  scraped {len(scraped)} vacancies{" (BLOCKED early)" if blocked else ""}\n')
    if SOLVE:
        for r in scraped[:5]:
            sys.stderr.write(f'    · {r.get("t","")[:48]:48} | {r.get("agency","")[:32]}\n')
        ok = len(scraped) > 0
        sys.stderr.write(f'\n{"✓ Reachable — Aura JSON captured" if ok else "✗ No jobs captured (blocked or the Aura shape changed)"}.\n')
        return 0 if ok else 2

    if not scraped:
        sys.stderr.write('No vacancies captured — nothing to archive. (Try --headful --solve to inspect.)\n')
        return 2
    if LIMIT < len(scraped):
        scraped = scraped[:LIMIT]
    have = existing_titles_by_company()
    rows, kept = build_rows(scraped, have)
    written = upsert(rows) if rows else 0
    matched = sum(1 for c in kept if c != 'aps-gov')
    sys.stderr.write(f'\nDone. {len(scraped)} vacancies scraped, {written} new rows archived '
                     f'({matched} attributed to a specific agency, {written - matched} to the APS bucket, '
                     f'{len(scraped) - len(rows)} already archived by another source).\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
