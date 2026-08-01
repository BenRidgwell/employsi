#!/usr/bin/env python3
"""JobStreet -> the D1 job archive. Malaysia and the Philippines.

WHY THIS EXISTS
The career-portal feeds cover an employer's own site. JobStreet is the dominant
board in both markets, so it carries the roles a company advertises there
whether or not it runs a local careers site — which is how Kuala Lumpur and
Manila get vacancy coverage at all. It is the regional counterpart to the SEEK
feed, and it is built the same way for the same reason.

ONE SCRIPT, TWO COUNTRIES
Both sites are the same SEEK codebase behind different hostnames, so the only
country-specific things are in SITES below: the host, the site key, the locale,
the archive source name and the hub map. Everything downstream — the advertiser
filter, the dedup key, the skills mapping, the D1 upsert — is shared, so a
Philippine role is classified and deduped exactly as a Malaysian one is. Select
with --country; it defaults to Malaysia so existing callers are unaffected.

WHY IT RUNS AS A GITHUB ACTION, NOT IN THE WORKER
JobStreet is SEEK-owned and shares SEEK's front. jobstreet.com/jobs returns
403 to this environment, and SEEK's Cloudflare front already 403-challenges
requests originating from Cloudflare Workers (see workers/jobs-cron/ARCHIVE.md).
The JSON API below is served to an ordinary client, so this runs from a GitHub
runner exactly as scripts/seek-to-d1.py does, and writes the same rows through
the D1 HTTP API.

THE API
  GET https://<host>/api/jobsearch/v5/search
      ?siteKey=<key>&locale=<locale>&sourcesystem=houston&keywords=<name>
      &page=N&pageSize=100
Same v5 shape SEEK serves. Two things differ from the AU call and both matter:
  - the site key and locale are per country;
  - there is NO `where`. Passing SEEK's 'All Australia' returns totalCount 0
    rather than an error, so a wrong `where` looks exactly like an employer with
    no local vacancies. Omitting it searches the whole country.

MATCHING COMPANIES
There are no local advertiser ids to search by, so this searches by company
NAME and then keeps only rows whose advertiser matches that name. Keyword search
alone is not enough: searching "BHP" also returns a Malayan Flour Mills listing
that merely mentions it. The advertiser filter is what makes the result a claim
about the employer rather than about the words in an ad.

Usage:  python3 scripts/jobstreet-to-d1.py [--country my|ph]
                                           [--limit N] [--only id,id] [--dry-run]
"""
from __future__ import annotations
import datetime
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
PAGE_SIZE = 100
MAX_PAGES = 3
HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = datetime.date.today().isoformat()

# Everything that differs between the two JobStreet markets.
#
# `hubs` maps a location string to a city on the map. A role outside those
# cities is still archived, with its real location text and no hub — it belongs
# to the country's coverage even though it has no pin of its own. That is why
# Penang and Cebu are absent rather than forced onto the capital.
SITES = {
    'my': {
        'label': 'Malaysia',
        'host': 'my.jobstreet.com',
        'siteKey': 'MY-Main',
        'locale': 'en-MY',
        'source': 'jobstreet',
        'hubs': {'kuala lumpur': 'kualalumpur'},
    },
    'ph': {
        'label': 'Philippines',
        'host': 'ph.jobstreet.com',
        'siteKey': 'PH-Main',
        'locale': 'en-PH',
        # A separate source from Malaysia's. The dedup key starts with the
        # source, so sharing one would let a Manila role and a KL role with the
        # same title and employer collapse into a single archive row and lose a
        # market.
        'source': 'jobstreet-ph',
        # Measured against the live board, not assumed: sampled 8 searches and
        # counted the location labels. EVERY National Capital Region label
        # carries the ", Metro Manila" suffix — including the ones that name a
        # district rather than a city, "Bonifacio Global City, Metro Manila",
        # "Ortigas, Metro Manila", "Alabang, Metro Manila", "Cubao, Metro
        # Manila", "Eastwood, Metro Manila". So one needle catches the whole of
        # Metro Manila and there is no list of seventeen city names to keep in
        # step. The bare 'manila' entry is for a label that names the city with
        # no region after it.
        #
        # Everything outside the NCR — Cebu, Clark/Pampanga, Laguna, Davao,
        # Iloilo — deliberately gets no hub. Manila is the only Philippine city
        # on the map, and putting a Cebu role on it would be an invented
        # location.
        'hubs': {'metro manila': 'manila', 'manila': 'manila'},
    },
}

args = sys.argv[1:]
COUNTRY = args[args.index('--country') + 1].lower() if '--country' in args else 'my'
if COUNTRY not in SITES:
    sys.exit(f'--country must be one of {", ".join(SITES)}')
SITE = SITES[COUNTRY]
JS_API = f'https://{SITE["host"]}/api/jobsearch/v5/search'
JOB_URL = f'https://{SITE["host"]}/job/'
SOURCE = SITE['source']
HUBS = SITE['hubs']
LABEL = SITE['label']

LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else 10 ** 9
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
DRY = '--dry-run' in args
NO_SKILLS = '--no-skills' in args

if not TOKEN and not DRY:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit).')


# ── dedup key, identical to src/employsi/lib/jobArchive.ts ────────────────────
def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def match_hub(text: str):
    t = (text or '').lower()
    for needle, hub in HUBS.items():
        if needle in t:
            return hub
    return None


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', ' ', s or '')).strip()


# ── roster: read from the TypeScript, never regexed out of it ─────────────────
def load_roster() -> list:
    """Every company on the roster, including the international city rosters.

    --with-cities is the difference between 355 companies and ~995, and it is
    required here. The AU-only roster does not contain HSBC (it is a London
    listing), and HSBC is the single largest Malaysian employer we track: 85
    live JobStreet listings against BHP's 6. Walking the AU roster alone would
    have produced a working scraper that quietly missed most of the market.
    """
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'roster.ts'), '--with-cities'],
                       capture_output=True, timeout=180)
    if p.returncode != 0:
        sys.stderr.write(f'roster.ts failed: {p.stderr.decode()[:300]}\n')
        return []
    return json.loads(p.stdout.decode('utf-8'))


# ── JobStreet read ────────────────────────────────────────────────────────────
def js_get(params: dict):
    url = f'{JS_API}?{urlencode(params)}'
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get('Retry-After') if e.headers else None
                delay = float(ra) if ra and str(ra).strip().isdigit() else \
                    min(45, random.uniform(0, (2 ** attempt) * 2.5))
                time.sleep(delay)
                continue
            return None
        except Exception:
            time.sleep(min(45, random.uniform(0, (2 ** attempt) * 2.5)))
    return None


# Words that may follow a company's name without making it a different company.
# An advertiser is accepted when the ONLY thing it adds to the roster name is
# words from this set — corporate form, region, and the shared-services wording
# the Manila and KL back-office entities are registered under.
CORPORATE_WORDS = {
    'group', 'groups', 'holdings', 'holding', 'ltd', 'limited', 'plc', 'pty',
    'inc', 'incorporated', 'corp', 'corporation', 'company', 'co', 'the',
    'international', 'global', 'shared', 'services', 'service', 'solutions',
    'operations', 'business', 'support', 'centre', 'center', 'and', 'of',
    'bank', 'banking', 'insurance', 'philippines', 'philippine', 'malaysia',
    'malaysian', 'australia', 'australian', 'asia', 'pacific', 'apac',
    'sdn', 'bhd', 'berhad', 'nv', 'sa', 'ag', 'llc', 'llp',
}


# Advertiser names that ARE a roster company, where the extra words are a
# trading name rather than a corporate qualifier. Each one has been checked
# against the employer — these are not guesses, and the run's near-miss report
# is how a new one gets found.
ADVERTISER_ALIAS = {
    # Austal's shipbuilding entity, and the name its Philippine yard at
    # Balamban advertises under.
    'austal ships': 'austal',
}


def advertiser_matches(advertiser: str, name: str) -> bool:
    """Is this ad actually placed BY the company we searched for?

    Keyword search returns anything mentioning the name, so the advertiser has
    to agree. The board's wording is rarely the roster's exact wording — the
    roster says "BHP" where an ad is placed by "BHP Group" — so some slack is
    needed. But the slack has to be bounded, and the obvious version of it is
    wrong in two ways that were both measured on the live board:

      - Plain string containment matches ACROSS a word. "BHP" is a prefix of
        "BHPX", so a substring test would accept an unrelated employer whose
        name merely starts with the same letters. Comparing token lists means a
        partial word can never match.
      - Accepting ANY extra words turns a short name into a wildcard. Searching
        the roster's "IGO" (a Western Australian lithium miner) returned 31
        Philippine roles, every one of them advertised by "IGO Techonologies"
        or "Igo Digital High Technology" — unrelated companies that would have
        been archived under IGO's company id and shown on its card as Manila
        vacancies. Requiring the extra words to be corporate qualifiers keeps
        "BHP Group" and "ANZ Global Services and Operations" while rejecting
        those two.
    """
    a, n = norm(advertiser).split(), norm(name).split()
    if not a or not n:
        return False
    if a == n or ADVERTISER_ALIAS.get(' '.join(a)) == ' '.join(n):
        return True
    long_, short_ = (a, n) if len(a) >= len(n) else (n, a)
    if long_[:len(short_)] != short_:
        return False
    return all(w in CORPORATE_WORDS for w in long_[len(short_):])


def near_miss(advertiser: str, name: str) -> bool:
    """Rejected, but shares the roster name's leading words.

    These are the only rejections worth a human look. A local subsidiary can
    trade under a name whose extra word is not a corporate qualifier — Austal
    advertises its Philippine yard as "Austal Ships" — and that is
    indistinguishable, lexically, from the "IGO Techonologies" case. So the
    rule stays strict and the near misses get REPORTED at the end of a run
    rather than guessed at. Confirm one against the employer, then add it to
    ADVERTISER_ALIAS; until then it is left out, which is the honest direction
    to fail in.
    """
    a, n = norm(advertiser).split(), norm(name).split()
    if not a or not n or advertiser_matches(advertiser, name):
        return False
    long_, short_ = (a, n) if len(a) >= len(n) else (n, a)
    return long_[:len(short_)] == short_


def fetch_company(name: str, misses: set) -> list:
    out, seen = [], set()
    total_pages, page = 1, 1
    while page <= total_pages and page <= MAX_PAGES:
        data = js_get({
            'siteKey': SITE['siteKey'], 'locale': SITE['locale'],
            'sourcesystem': 'houston',
            'keywords': name, 'page': page, 'pageSize': PAGE_SIZE,
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
            advertiser = (j.get('companyName')
                          or (j.get('advertiser') or {}).get('description') or '')
            if not advertiser_matches(advertiser, name):
                if near_miss(advertiser, name):
                    misses.add(f'{advertiser}  (searching {name})')
                continue
            jid = str(j.get('id') or '')
            if jid in seen:
                continue
            seen.add(jid)
            title = clean(j.get('title') or '')
            if not title:
                continue
            cls = (j.get('classifications') or [{}])[0]
            cat = (cls.get('classification') or {}).get('description') or ''
            loc = ((j.get('locations') or [{}])[0].get('label') or '')
            out.append({
                't': title, 'loc': loc, 'cat': cat,
                'url': JOB_URL + jid if jid else '',
                'created': str(j.get('listingDate') or '')[:10],
                'hub': match_hub(loc) or match_hub(title),
                'co': advertiser or name,
                'sal': (j.get('salaryLabel') or '').strip() or None,
            })
        page += 1
        time.sleep(random.uniform(1.0, 2.0))
    return out


# ── skills parity via the worker's own taxonomy ───────────────────────────────
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


def upsert(company_id: str, jobs: list) -> int:
    titles = [j['t'] for j in jobs]
    skills = map_skills(titles)
    rows, seen = [], set()
    for j, sk in zip(jobs, skills):
        company = j['co'] or company_id
        key = job_key(SOURCE, j['t'], company, j['loc'] or j['hub'] or '')
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['t'], company or None, company_id, j['hub'],
                     j['loc'] or '', j['cat'] or '', j['sal'], j['url'] or '',
                     j['created'] or '', json.dumps(sk) if sk else None))
    if DRY:
        return len(rows)
    written = 0
    for i in range(0, len(rows), 7):
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
    roster = load_roster()
    if not roster:
        # An empty roster is never a real state of the world — it means
        # roster.ts moved or stopped running. Reporting "0 archived" and exiting
        # 0 is exactly how a broken feed hides for days.
        sys.stderr.write('No roster loaded from scripts/roster.ts — treating as failure.\n')
        return 1
    # One walk per EMPLOYER, not per roster line. The roster carries a company
    # once per listing, so HSBC appears as both london-hsba and hongkong-00005
    # (one issuer, two exchanges) — walking both would archive the same
    # Malaysian vacancies under two company ids and double-count them in every
    # market total. First id wins, which matches how COMPANY_ID_ALIAS already
    # resolves the pair when the app reads them back.
    by_name, targets = {}, []
    for c in roster:
        if ONLY and c['id'] not in ONLY:
            continue
        k = norm(c['name'])
        if k in by_name:
            continue
        by_name[k] = c['id']
        targets.append(c)
    targets = targets[:LIMIT]
    sys.stderr.write(f'JobStreet {COUNTRY.upper()} -> D1: {len(targets)} roster companies.\n')

    total_found = total_written = with_jobs = 0
    misses: set = set()
    for n, c in enumerate(targets, 1):
        try:
            jobs = fetch_company(c['name'], misses)
        except Exception as e:
            sys.stderr.write(f'  [{n}/{len(targets)}] {c["name"]}: fetch error {e}\n')
            continue
        if not jobs:
            continue
        with_jobs += 1
        total_found += len(jobs)
        w = upsert(c['id'], jobs)
        total_written += w
        sys.stderr.write(f'  [{n}/{len(targets)}] {c["name"]}: {len(jobs)} roles -> {w}\n')

    sys.stderr.write(f'Done. {with_jobs} companies with {LABEL} vacancies, '
                     f'{total_found} roles found, {total_written} archived.\n')
    if misses:
        sys.stderr.write(
            f'\nAdvertisers rejected that lead with a roster name ({len(misses)}). '
            'Each is either a local subsidiary we are missing or an unrelated '
            'company we correctly refused; confirm before adding to '
            'ADVERTISER_ALIAS:\n')
        for m in sorted(misses):
            sys.stderr.write(f'  {m}\n')
    # A run that finds nothing at all across the whole roster means the API
    # shape or the site key changed, not that the country stopped hiring — the
    # `where` parameter alone was enough to return a silent zero. Fail loudly.
    if with_jobs == 0:
        sys.stderr.write(f'No company returned a single {LABEL} vacancy — '
                         'treating as a broken feed rather than an empty market.\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
