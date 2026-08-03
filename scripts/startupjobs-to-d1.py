#!/usr/bin/env python3
"""
startup.jobs → the D1 job archive, one company page per rostered employer.

WHY THIS BOARD AT ALL
It indexes roles that never reach an ASX employer's own careers site: startup
and scale-up hiring, and the offshore engineering and product teams the big
listed companies run under separate brands. Same role as the SimplyHired feed —
an aggregator alongside the authoritative career portals — but a different
corner of the market.

THE COMPANY FILTER ON THE SEARCH FORM DOES NOT FILTER, and that is the trap this
scraper is built around. `startup.jobs/?companies=Pinterest` returns HTTP 200
and a normal-looking results page — carrying jobs from NINETEEN different
companies, because it is simply the unfiltered feed. Measured: `?companies=Canva`
returns the identical 20 rows. Using it would have archived random startups'
vacancies under our roster's company ids and every one of them would have looked
plausible.

What DOES filter is the company page: `startup.jobs/company/<slug>`. Measured on
the same day, `/company/pinterest` returns 20 jobs and exactly one company.

RESOLVING THE SLUG WITHOUT GUESSING. The slugs are not derivable — the board
writes "general-assembly" but also "renttherunway" and "bookingcom", so a single
rule is wrong for some employer whichever rule you pick, and probing candidates
costs a fetch per guess across a 999-company roster. It does not have to: the
board publishes every company page in its sitemap
(cdn.startup.jobs/sitemaps/startupjobs/companies.xml.gz, 42,885 entries), which
is one un-proxied request and turns slug resolution into an offline set lookup.
Measured 2026-08-03: 56 of the roster's 999 companies have a page.

AND THE SLUG IS STILL NOT PROOF — the advertiser test cannot save this one.
Matching lands on short names, and on this board those names belong to somebody
else. Checked, page by page, 2026-08-03:

    /company/igo      "iGo", Pennsylvania, in-house marketing roles
                      -> NOT IGO Ltd, the Perth lithium miner
    /company/redox    "Redox", healthcare interoperability engineering
                      -> NOT Redox Ltd, the Australian chemicals distributor
    /company/compass  "Compass", US "Agent Experience Manager" roles
                      -> NOT Compass Group, the UK caterer
    /company/multiply "Multiply", Atlanta mortgage origination
                      -> NOT Multiply Group, the Abu Dhabi investor

advertiser_matches() passes every one of those, because lexically the names ARE
the same. There is no corroborating field to fall back on either: the company
page carries no employer website, no description, nothing but "X is hiring".

So attribution is by an explicit CONFIRMED list, the same shape as
ADVERTISER_ALIAS. A slug match is only archived when the pair has been checked
against the page's own roles and locations; every other match is REPORTED with
its evidence at the end of the run so it can be confirmed deliberately. Failing
towards missing coverage rather than invented coverage is the direction this
archive should fail in.

THE BOARD SHIPS A MUSTACHE TEMPLATE INSIDE THE RESULTS LIST. A company page with
no live jobs still renders one card-shaped block whose title is the literal
string `{{{highlighted_title}}}`, and a first pass archived it as a vacancy for
28 employers — 28 companies that in fact had nothing advertised. robots.txt says
so out loud ("Disallow: URLs found in <template>'s such as
/company/{{{company_slug}}}"). Any field still carrying braces is dropped.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME, OXYLABS_PASSWORD (the site 403s a datacentre IP; no JS
     render is needed, so the fetches are the cheap non-rendering kind)
Run: python scripts/startupjobs-to-d1.py [--limit N] [--only id,id]
                                         [--max-pages N] [--dry-run]
"""
from __future__ import annotations
import datetime
import gzip
import html as htmllib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'startupjobs'
SITE = 'https://startup.jobs'
SITEMAP = 'https://cdn.startup.jobs/sitemaps/startupjobs/companies.xml.gz'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


LIMIT = int(_opt('--limit', 10 ** 9))
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
MAX_PAGES = int(_opt('--max-pages', 10))
DRY = '--dry-run' in args
NO_SKILLS = '--no-skills' in args

if not TOKEN and not DRY:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

from advertiser_match import advertiser_matches, near_miss, norm  # noqa: E402

# startup.jobs slug -> the roster company it has been CONFIRMED to be, by reading
# the page's own roles and locations. Not derived, not guessed: see the module
# note above for the four checked cases where the same name is a different firm.
# A slug match that is not in here is reported, never archived.
CONFIRMED = {
    # Australian listings, corroborated by the board's own location facets.
    'seek': 'SEEK Limited',            # australia / bangkok / kuala-lumpur — SEEK's actual markets
    'pexa': 'Pexa Group',              # australia / melbourne / united-kingdom — PEXA's footprint
    'nextdc': 'NextDC',                # australia / malaysia / melbourne
    'chrysos': 'Chrysos Corporation',  # australia
    'vgw': 'VGW Holdings',             # US states — VGW's sweepstakes business is US-facing
    # Distinctive full names with no competing firm on the board.
    'dropbox': 'Dropbox',
    'instacart': 'Instacart',
    'lyft': 'Lyft',
    'pinterest': 'Pinterest',
    'twilio': 'Twilio',
    'salesforce': 'Salesforce',
    'cloudflare': 'Cloudflare',
    'gilead-sciences': 'Gilead Sciences',
    'intuit': 'Intuit',
    'toast': 'Toast',
    'conagra-brands': 'Conagra Brands',
}


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def load_roster() -> list:
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'roster.ts'), '--with-cities'],
                       capture_output=True, timeout=180, cwd=ROOT)
    if p.returncode != 0:
        sys.stderr.write(f'roster.ts failed: {p.stderr.decode()[:300]}\n')
        return []
    return json.loads(p.stdout.decode('utf-8'))


# ── slug resolution ───────────────────────────────────────────────────────────
def load_slugs() -> set:
    """Every company page the board publishes. One un-proxied CDN request."""
    ua = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')
    try:
        with urllib.request.urlopen(
                urllib.request.Request(SITEMAP, headers={'User-Agent': ua}), timeout=120) as r:
            raw = r.read()
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        return set(re.findall(r'<loc>https://startup\.jobs/company/([^<]+)</loc>',
                              raw.decode('utf-8', 'replace')))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'sitemap fetch failed: {e}\n')
        return set()


# Corporate form is dropped before slugging because the board does not carry it
# ("SEEK Limited" is /company/seek), but the undropped forms are tried too — a
# company whose legal suffix IS part of its brand would otherwise be missed.
CORP_TAIL = re.compile(
    r'\b(ltd|limited|plc|pty|inc|incorporated|corporation|corp|group|holdings|company)\b')


def slug_candidates(name: str) -> list:
    """The slug shapes the board actually uses, in order of specificity.

    Both the hyphenated and the run-together forms are needed: the board writes
    "general-assembly" but also "renttherunway" and "bookingcom", so neither
    rule alone reaches every company.
    """
    trimmed = CORP_TAIL.sub('', (name or '').lower().replace('&', ' and '))
    out = []
    for base in (trimmed, (name or '').lower()):
        out.append(re.sub(r'[^a-z0-9]+', '-', base).strip('-'))
        out.append(re.sub(r'[^a-z0-9]+', '', base))
    return [s for s in dict.fromkeys(out) if len(s) > 1]


# ── board read ────────────────────────────────────────────────────────────────
CARD = re.compile(
    r'data-post-template-target="title"[^>]*href="(/[^"]+)"(.*?)'
    r'data-post-template-target="apply"', re.S)
CARD_TITLE = re.compile(r'<div class="sm:truncate">(.*?)</div>', re.S)
CARD_COMPANY = re.compile(r'data-post-template-target="companyName"[^>]*>(.*?)</', re.S)
CARD_LOC = re.compile(r'data-post-template-target="location"[^>]*>\s*<a[^>]*>(.*?)</a>', re.S)
CARD_TIME = re.compile(r'<time datetime="(\d{4}-\d{2}-\d{2})')
PAGE_H1 = re.compile(r'<h1[^>]*>(.*?)</h1>', re.S)


def fetch(url: str) -> str | None:
    from oxylabs_client import fetch as oxy_fetch
    content, _ = oxy_fetch(url, geo='United States', render=False, timeout=200)
    return content


def collect(slug: str, name: str, gate: bool = True) -> tuple[list, str, set]:
    """(rows advertised by this company, the page's own <h1>, near misses)."""
    rows: dict[str, dict] = {}
    misses: set = set()
    heading = ''
    for page in range(1, MAX_PAGES + 1):
        url = f'{SITE}/company/{slug}' + (f'?page={page}' if page > 1 else '')
        page_html = fetch(url)
        if not page_html:
            break
        # A slug that does not exist answers 404 with the site's own shell, which
        # Oxylabs returns as ordinary content — so "no cards" is the only signal
        # that the page is not a company page, and it is treated as "not on the
        # board" rather than as an error.
        if page == 1:
            h1 = PAGE_H1.search(page_html)
            heading = clean(h1.group(1)) if h1 else ''
        found = 0
        for href, body, in ((m.group(1), m.group(2)) for m in CARD.finditer(page_html)):
            t = CARD_TITLE.search(body)
            title = clean(t.group(1)) if t else ''
            # The Mustache template inside the results list is card-shaped and
            # always present, so a company with nothing advertised still yields
            # one "job" titled {{{highlighted_title}}}. Braces anywhere in the
            # title mean the row is the template, not a vacancy.
            if not title or '{{' in title or '}}' in title:
                continue
            found += 1
            advertiser = clean((CARD_COMPANY.search(body) or [None, ''])[1]) if \
                CARD_COMPANY.search(body) else heading
            if gate and not advertiser_matches(advertiser or heading, name):
                if near_miss(advertiser or heading, name):
                    misses.add(advertiser or heading)
                continue
            loc = CARD_LOC.search(body)
            when = CARD_TIME.search(body)
            rows[href] = {
                'title': title,
                'location': clean(loc.group(1)) if loc else '',
                'url': SITE + href,
                'posted': when.group(1) if when else '',
                'category': 'Job board',
            }
        if not found:
            break
        time.sleep(0.4)
    return list(rows.values()), heading, misses


# ── parity bridges to the worker's own taxonomy and hub table ─────────────────
def _bridge(script: str, payload, fallback):
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, script)],
                           input=json.dumps(payload).encode(),
                           capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  {script} failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'  {script} error: {e}\n')
    return fallback


def map_skills(titles: list, sector: str) -> list:
    if NO_SKILLS or not titles:
        return [[] for _ in titles]
    return _bridge('map-skills.ts', {'titles': titles, 'sector': sector}, [[] for _ in titles])


def map_hubs(locations: list, home) -> list:
    if not locations:
        return []
    return _bridge('map-hubs.ts', {'locations': locations, 'home': home},
                   [None for _ in locations])


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


def upsert(company: dict, jobs: list) -> int:
    skills = map_skills([j['title'] for j in jobs], company.get('sector') or '')
    home = (company.get('cities') or [None])[0]
    hubs = map_hubs([j['location'] for j in jobs], home)
    rows, seen = [], set()
    for j, sk, hub in zip(jobs, skills, hubs):
        key = job_key(SOURCE, j['title'], company['name'], j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], company['name'], company['id'],
                     hub, j['location'], j['category'], None,
                     j['url'], j['posted'] or TODAY, json.dumps(sk) if sk else None))
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
        sys.stderr.write('No roster loaded from scripts/roster.ts — treating as failure.\n')
        return 1
    slugs = load_slugs()
    if not slugs:
        # The sitemap is one request and the whole walk depends on it. An empty
        # set is the CDN failing, not a board with no companies, and matching
        # nothing would report a clean run that archived nothing.
        sys.stderr.write('Company sitemap empty or unreachable — treating as failure.\n')
        return 1
    sys.stderr.write(f'startup.jobs: {len(slugs)} company pages in the sitemap.\n')

    by_name, targets = {}, []
    for c in roster:
        if ONLY and c['id'] not in ONLY:
            continue
        k = norm(c['name'])
        if k in by_name:
            continue
        by_name[k] = c['id']
        hit = next((s for s in slug_candidates(c['name']) if s in slugs), None)
        if hit:
            targets.append((c, hit))
    targets = targets[:LIMIT]
    sys.stderr.write(f'{len(targets)} of {len(by_name)} roster employers have a page'
                     f'{", DRY RUN" if DRY else ""}.\n')

    total_rows, with_ads = 0, 0
    unconfirmed: list = []
    all_misses: dict = {}
    for i, (c, slug) in enumerate(targets, 1):
        # THE GATE. A slug match is a lead, not an identification — see the
        # module note. Anything not confirmed is measured and reported, never
        # written, so a wrong pair costs coverage rather than correctness.
        if CONFIRMED.get(slug) != c['name']:
            try:
                jobs, heading, _ = collect(slug, c['name'], gate=False)
            except Exception:  # noqa: BLE001
                jobs, heading = [], ''
            if jobs:
                unconfirmed.append((c['name'], slug, heading, len(jobs),
                                    [j['title'] for j in jobs[:2]],
                                    sorted({j['location'] for j in jobs if j['location']})[:3]))
            continue
        try:
            jobs, heading, misses = collect(slug, c['name'])
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f'  [{i}/{len(targets)}] {c["name"]}: FAILED ({e})\n')
            continue
        if misses:
            all_misses[c['name']] = misses
        if not jobs:
            continue
        with_ads += 1
        sys.stderr.write(f'  [{i}/{len(targets)}] {c["name"][:30]:30s} /company/{slug[:22]:22s} '
                         f'{len(jobs):>3} roles (page says "{heading[:22]}")\n')
        total_rows += len(jobs) if DRY else upsert(c, jobs)

    sys.stderr.write(f'\n{with_ads} employers advertising, {total_rows} rows '
                     f'{"parsed" if DRY else "archived"}.\n')
    if unconfirmed:
        sys.stderr.write(
            f'\n{len(unconfirmed)} slug matches are ADVERTISING BUT UNCONFIRMED — nothing was\n'
            'written for these. Read the evidence and add the real ones to CONFIRMED:\n')
        for roster, slug, heading, n, titles, locs in sorted(unconfirmed):
            sys.stderr.write(f'  {roster[:26]:26} /company/{slug[:20]:20} says "{heading[:18]}" '
                             f'{n:>3} roles  {locs}  {titles}\n')
    if all_misses:
        sys.stderr.write('Near misses to confirm before adding to ADVERTISER_ALIAS:\n')
        for name, adv in sorted(all_misses.items())[:40]:
            sys.stderr.write(f'  {name}  <-  {", ".join(sorted(adv))[:110]}\n')
    # Employers with a page but no live ads is a NORMAL state on this board — a
    # listed company can sit there for months without hiring — so zero rows is
    # only a failure when nothing at all came back across every page.
    if targets and not with_ads:
        sys.stderr.write('No employer returned a single role — treating as failure.\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
