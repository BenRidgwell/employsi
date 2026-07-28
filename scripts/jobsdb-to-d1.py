#!/usr/bin/env python3
"""
Scrape JobsDB Hong Kong (hk.jobsdb.com) for every company on the roster and
archive the results to the D1 jobs table, deduped — the Hong Kong counterpart of
scripts/indeed-to-d1.py and scripts/zhaopin-to-d1.py.

WHAT IT TALKS TO
JobsDB runs SEEK's platform, so it exposes SEEK's search API:

    GET https://hk.jobsdb.com/api/jobsearch/v5/search
        ?siteKey=HK-Main&sourcesystem=houston&keywords=<name>&pageSize=30&page=N

which returns JSON directly — no HTML parsing, no JS rendering. Each job carries
`title`, `companyName`, `advertiser.description`, `locations[].label`,
`listingDate`, `salaryLabel`, `workTypes` and an `id` that builds the ad URL.
(The older /api/chalice-search/v4/ path is gone — it 404s behind an anti-bot
page — so v5 is the one contract this depends on.)

WHY OXYLABS
The API answers a single curl fine, but this walks the whole roster daily from
CI, and SEEK-platform sites rate-limit datacentre IPs hard at that volume. So
every request goes through the shared Oxylabs client (scripts/oxylabs_client.py)
for the residential IP, throttling and backoff, exactly as the Indeed and Zhaopin
scrapers do. `--direct` bypasses it for local debugging, which is how the
contract above was verified.

WHY THE KEYWORD SEARCH IS POST-FILTERED
`keywords=` matches the whole ad, not the employer: "HSBC" returns 15,011 hits
because the word appears in unrelated descriptions. Only ads whose own
`companyName` / `advertiser.description` matches the company are kept, so a
mention in someone else's ad never becomes that company's vacancy.

WHAT TO EXPECT
Most of the roster is Australian and has no Hong Kong presence — BHP returns one
loose hit and zero real ones, Rio Tinto zero. Empty is the correct answer for
those, not a failure, and the run reports matched-vs-searched so a genuine
breakage (everything zero) is distinguishable from an accurate zero.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD.
Run: python scripts/jobsdb-to-d1.py [--only id1,id2] [--limit N]
                                    [--max-pages N] [--concurrency N] [--direct]
                                    [--dry-run]
"""
from __future__ import annotations
import datetime
import json
import os
import re
import subprocess
import sys
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

SOURCE = 'jobsdb-hk'
# Every ad on this board is in Hong Kong, which we plot as a hub.
HUB = 'hongkong'
SEARCH = 'https://hk.jobsdb.com/api/jobsearch/v5/search'
PAGE_SIZE = 30

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
LIMIT = int(_opt('--limit', 10**9))
MAX_PAGES = int(_opt('--max-pages', 5))
CONCURRENCY = int(_opt('--concurrency', 6))
DIRECT = '--direct' in args
DRY = '--dry-run' in args
NO_SKILLS = '--no-skills' in args

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


# ── company roster (id + name) ────────────────────────────────────────────────
def load_companies() -> list[tuple[str, str]]:
    """The listed roster plus the top-150 private names — the same two files the
    cron worker composes into AU_JOBS_TARGETS."""
    out: list[tuple[str, str]] = []
    seen = set()
    for rel in ('src/employsi/data/auJobsTargets.ts', 'src/employsi/data/topPrivateCompanies.ts'):
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        txt = open(path, encoding='utf-8').read()
        # Both files declare entries as `id: "x"` / `"id": "x"` followed by name.
        for cid, nm in re.findall(r'["\']?id["\']?:\s*["\']([^"\']+)["\'],\s*\n?\s*["\']?name["\']?:\s*["\']([^"\']+)["\']', txt):
            if cid in seen:
                continue
            seen.add(cid)
            out.append((cid, nm))
    return [(cid, nm) for cid, nm in out if not ONLY or cid in ONLY]


# ── skills parity via the worker's own taxonomy ───────────────────────────────
def map_skills(titles: list) -> list:
    # scripts/map-skills.ts takes a plain JSON array of titles and returns
    # index-aligned skill arrays, using the worker's own taxonomy — so a JobsDB
    # row carries exactly the skills the same title would get from any other
    # source.
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    try:
        payload = json.dumps(titles)
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=payload.encode(), capture_output=True, timeout=120)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:160]}\n')
    except Exception as e:
        sys.stderr.write(f'  map-skills error: {e}\n')
    return [[] for _ in titles]


# ── fetch ─────────────────────────────────────────────────────────────────────
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')


def search_url(keywords: str, page: int) -> str:
    q = urllib.parse.urlencode({
        'siteKey': 'HK-Main',
        'sourcesystem': 'houston',
        'keywords': keywords,
        'pageSize': PAGE_SIZE,
        'page': page,
    })
    return f'{SEARCH}?{q}'


def fetch_json(url: str) -> dict | None:
    """Through Oxylabs by default; --direct for local debugging."""
    if DIRECT:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception:
            return None
    import oxylabs_client as oxy
    # render=False: this is a JSON endpoint, so asking Oxylabs to run a browser
    # would only wrap the body in HTML and cost ~40s a call.
    content, status = oxy.fetch(url, geo='Hong Kong', render=False, timeout=90)
    if not content or (status and status >= 400):
        return None
    text = content if isinstance(content, str) else json.dumps(content)
    # A rendered/wrapped body arrives inside <pre>; unwrap before parsing.
    m = re.search(r'<pre[^>]*>([\s\S]*?)</pre>', text)
    if m:
        text = m.group(1)
    try:
        return json.loads(text)
    except Exception:
        return None


# Corporate suffixes that appear in a legal name but never in how an employer
# brands itself on a job board.
_SUFFIX = re.compile(
    r'\b(group holdings|group|holdings|limited|ltd|pty|plc|corporation|corp|inc|'
    r'incorporated|company|co|banking corporation|of australia|australia|'
    r'australian|international|worldwide|nl)\b', re.I)


def query_variants(name: str) -> list[str]:
    """Search terms to try for one company.

    The roster carries legal names — "ANZ Group Holdings", "Commonwealth Bank of
    Australia" — and JobsDB carries brands: "ANZ", "Commonwealth Bank". Searching
    the legal name alone returns nothing for exactly the employers most likely to
    be in Hong Kong, so each company is searched as its full name AND as a
    suffix-stripped short form, with the results unioned and then filtered on the
    advertiser as usual.
    """
    out = [name]
    short = _SUFFIX.sub(' ', name)
    short = re.sub(r'\s+', ' ', short).strip(' ,-&')
    if short and short.lower() != name.lower() and len(short) >= 2:
        out.append(short)
    return out


def category_of(job: dict) -> str:
    parts = []
    for c in (job.get('classifications') or []):
        top = (c.get('classification') or {}).get('description')
        sub = (c.get('subclassification') or {}).get('description')
        if top:
            parts.append(f'{top} / {sub}' if sub else top)
    return ', '.join(parts) or 'JobsDB'


def advertiser_of(job: dict) -> str:
    adv = (job.get('advertiser') or {}).get('description') or ''
    return f"{job.get('companyName') or ''} {adv}".strip()


def matches_company(job: dict, variants: list[str]) -> bool:
    """Keep only ads the company itself placed.

    Compared on WHOLE WORDS, not raw substrings: "ANZ" must appear as its own
    token in the advertiser, so "ANZ Bank" matches and "Danzig" does not — a
    short acronym inside a longer word is the obvious way this goes wrong. One
    side's tokens must be a subset of the other's, which is what lets "HSBC"
    match "HSBC Limited" and "Commonwealth Bank" match "Commonwealth Bank of
    Australia" while rejecting an unrelated employer that merely mentions them.
    """
    adv = set(norm(advertiser_of(job)).split())
    if not adv:
        return False
    for v in variants:
        vt = set(norm(v).split())
        if vt and (vt <= adv or adv <= vt):
            return True
    return False


def scrape_company(cid: str, name: str) -> tuple[list, int]:
    """Returns (matching jobs, total ads scanned)."""
    jobs, scanned, seen = [], 0, set()
    variants = query_variants(name)
    for term in variants:
      for page in range(1, MAX_PAGES + 1):
          d = fetch_json(search_url(term, page))
          if not d:
              break
          rows = d.get('data') or []
          if not rows:
              break
          scanned += len(rows)
          for j in rows:
              if not matches_company(j, variants):
                  continue
              jid = str(j.get('id') or '')
              if not jid or jid in seen:
                  continue
              seen.add(jid)
              locs = [l.get('label') for l in (j.get('locations') or []) if l.get('label')]
              jobs.append({
                  'title': (j.get('title') or '').strip(),
                  'company': (j.get('companyName') or advertiser_of(j)).strip(),
                  'location': ', '.join(locs) or 'Hong Kong',
                  'salary': (j.get('salaryLabel') or '').strip() or None,
                  'url': f'https://hk.jobsdb.com/job/{jid}',
                  'posted': (j.get('listingDate') or '')[:10],
                  # The board's own taxonomy sits a level down, under
                  # `classification`, with a `subclassification` beside it —
                  # "Banking & Financial Services / Banking - Retail/Branch".
                  # That is the functional area the card groups roles by.
                  'category': category_of(j),
              })
          if len(rows) < PAGE_SIZE:
              break
    return jobs, scanned


# ── D1 ────────────────────────────────────────────────────────────────────────
def d1(sql: str, params: list):
    body = json.dumps({'sql': sql, 'params': params}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    import time
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


def upsert(company_id: str, jobs: list) -> int:
    """Same key + upsert as src/employsi/lib/jobArchive.ts, so a role already
    archived from another source refreshes rather than duplicating."""
    skills = map_skills([j['title'] for j in jobs])
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        key = job_key(SOURCE, j['title'], j['company'] or company_id, j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], j['company'] or None, company_id,
                     HUB, j['location'], j['category'], j['salary'],
                     j['url'], j['posted'], json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(rows), 7):  # D1 caps ~100 bound params/query
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
    companies = load_companies()[:LIMIT]
    if not companies:
        sys.exit('No companies matched — check --only.')
    sys.stderr.write(
        f'JobsDB HK -> D1: {len(companies)} companies, '
        f'{"DIRECT" if DIRECT else "via Oxylabs"}{", DRY RUN" if DRY else ""}.\n')

    from concurrent.futures import ThreadPoolExecutor
    results: dict[str, tuple[list, int]] = {}
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(scrape_company, cid, nm): (cid, nm) for cid, nm in companies}
        for f in futures:
            cid, nm = futures[f]
            try:
                results[cid] = f.result()
            except Exception as e:
                sys.stderr.write(f'  {nm}: error {e}\n')
                results[cid] = ([], 0)

    total_jobs = total_written = with_jobs = 0
    for cid, nm in companies:
        jobs, scanned = results.get(cid, ([], 0))
        if not jobs:
            continue
        with_jobs += 1
        total_jobs += len(jobs)
        sys.stderr.write(f'  {nm}: {len(jobs)} of {scanned} scanned\n')
        if not DRY:
            total_written += upsert(cid, jobs)

    sys.stderr.write(
        f'Done: {with_jobs}/{len(companies)} companies had Hong Kong ads, '
        f'{total_jobs} matched, {total_written} written.\n')
    # An entirely empty run across the whole roster is more likely a broken
    # contract than a real market state, so it exits non-zero for CI to catch.
    if with_jobs == 0 and len(companies) > 20:
        sys.stderr.write('No company matched anywhere — check the v5 search contract.\n')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
