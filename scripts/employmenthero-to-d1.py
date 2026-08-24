#!/usr/bin/env python3
"""
Scrape Employment Hero's public job board across all six of its markets and
archive the roles at rostered companies to D1.

This is a MARKET-WIDE feed, not a per-employer portal. It is the counterpart of
the Adzuna / SEEK / LinkedIn drivers: it sweeps the board, then keeps only the
rows whose advertiser matches a company on our roster. That is what makes it
cover "any company we add moving forward" without any per-company configuration
— the match runs against the live roster every night, so a company added to
auJobsTargets today is matched tomorrow.

Note the deliberate separation from the `employmenthero` platform in
careerSites.ts: that one reads ONE organisation's own board through its own
endpoint. This reads the whole market. They can both hold the same role and that
is fine — job_key dedupes them.

HOW THE BOARD IS REACHED, all measured 2026-08-24.

employmenthero.com is WordPress. Its job block calls a custom REST route which
PROXIES Employment Hero's own ATS API:

    GET /wp-admin/admin-ajax.php?action=eh_get_nonce      -> {"nonce": "..."}
    GET /wp-json/eh-api/v1/jobs?<query>   X-WP-Nonce: <nonce>
        -> proxied to https://ats-cdn.ehrocks.com/api/v2/career_page/jobs
        -> {"data": {"items": [...], "total_pages": N, "total_items": N}}

The nonce is issued to anonymous callers, so no account is involved. The ATS
host cannot be called directly — tried, 404 — so the WordPress route is the
address, and its error bodies are quoted through verbatim, which is how the
parameters below were established rather than guessed:

    sort         must be one of: relevance, date_posted
    date_posted  must be one of: 0, 1, 7, 30, 90     (days)
    page_index   required
    country_code AU | NZ | GB | SG | MY | CA
    item_per_page  100 works

THE RESULT WINDOW IS CAPPED AT 10 PAGES, and that is the constraint the whole
design turns on. `total_items` reports the true size — 22,010 across all markets
— but `total_pages` never exceeds 10, so ANY query reaches at most 1,000 rows no
matter how many it says exist. A naive full sweep would archive 1,000 of 22,010
and report success.

So each market is swept by RECENCY, with the widest window that still fits under
the cap. Measured totals:

    market   all      7 days   1 day
    AU       17,009    1,661     533
    NZ        1,029      136
    GB        2,034      243
    SG          178        1
    MY          424        4
    CA          995      275

Seven days everywhere except Australia, which only fits at one. The seven-day
window is not padding: it means a missed run is recovered by the next one rather
than losing a day's postings permanently. Australia has no such margin, so a
missed AU run loses that day — stated here because it is a real limitation of
this feed and not something to discover later from a gap in the archive.

WHAT IS NOT POSSIBLE, so nobody re-derives it:

  * There is no organisation filter. organisation, organisation_id and
    organisation_friendly_id are all accepted and all ignored.
  * `query` does NOT search the employer. It is full text over title and
    description: querying "Supporting Your Independence" — an organisation name
    taken straight out of this API — returns 2,267 rows and not one of them is
    that organisation's. So a per-company search, the obvious way to walk a
    roster, cannot work here. Matching happens after the sweep instead.
  * vendor_location_name DOES filter (AU/Perth = 702), which is the escape hatch
    if Australia's daily volume ever outgrows the cap: slice AU by location.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/employmenthero-to-d1.py [--dry-run] [--markets AU,NZ]
                                            [--window 7] [--limit N]
"""
from __future__ import annotations
import datetime
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

from advertiser_match import ADVERTISER_ALIAS, norm as adv_norm  # noqa: E402
from roster import load_roster  # noqa: E402

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SOURCE = 'employmenthero'
BASE = 'https://employmenthero.com'
JOBS = f'{BASE}/wp-json/eh-api/v1/jobs'
NONCE_URL = f'{BASE}/wp-admin/admin-ajax.php?action=eh_get_nonce'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0 Safari/537.36')

# The API's own ceiling — see the module docstring. Not a tuning knob.
MAX_PAGES = 10
PER_PAGE = 100
CAP = MAX_PAGES * PER_PAGE

# Widest recency window that fits under CAP, per market, measured 2026-08-24.
# A market whose volume outgrows its window is caught at runtime, not here.
MARKET_WINDOW = {'AU': 1, 'NZ': 7, 'GB': 7, 'SG': 7, 'MY': 7, 'CA': 7}

# country_code -> the hub a role plots on when its own location does not resolve.
MARKET_HUB = {'AU': 'sydney', 'NZ': 'auckland', 'GB': 'london',
              'SG': 'singapore', 'MY': 'kualalumpur', 'CA': 'toronto'}

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


DRY = '--dry-run' in args
LIMIT = int(_opt('--limit', 10**9))
WINDOW_OVERRIDE = int(_opt('--window', 0)) or None
MARKETS = [m.strip().upper() for m in _opt('--markets', 'AU,NZ,GB,SG,MY,CA').split(',') if m.strip()]

if not DRY and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def strict_match(advertiser: str, name: str) -> bool:
    """A tighter advertiser test than the AU boards use, and deliberately so.

    advertiser_matches allows a SUBSET — "Woolworths" matches "Woolworths Group"
    — which is right on SEEK and Adzuna, where the advertiser space is close to
    our own roster's. It is wrong here. This board is global and dominated by
    small employers: 550 distinct advertisers in one sweep of six markets on
    2026-08-24, almost none of them companies we track.

    Under the loose rule that sweep produced exactly one match, and it was
    WRONG — a Yorkshire firm trading as plain "Sigma" matched our ASX-listed
    "Sigma Healthcare" and would have put a Normanton fulfilment role on an
    Australian pharmaceutical wholesaler's card. Across 22,010 adverts in six
    countries a one-word advertiser will collide with something eventually, and
    a wrong company on a card is the error this archive is least willing to
    make.

    So a match here must be an exact normalised equality, or an ALIAS somebody
    added on purpose. Subsets are refused. The cost is a miss when a rostered
    company advertises under a longer legal name; the alias map is where that
    gets fixed, deliberately and once.
    """
    if not advertiser or not name:
        return False
    a, n = adv_norm(advertiser), adv_norm(name)
    if a == n:
        return True
    if ADVERTISER_ALIAS.get(a) == n:
        return True
    # Everything below is a subset/fuzzy hit, which is what we are refusing —
    # kept as an explicit branch so the intent survives a future edit.
    return False


def job_key(source: str, title: str, company: str, location: str) -> str:
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


def get_json(url: str, headers: dict | None = None, tries: int = 4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')[:400]
            # The WordPress route answers 400 for BOTH a bad parameter and an
            # upstream timeout, quoting the ATS error either way. They need
            # opposite handling: a bad parameter will fail identically forever,
            # while a timeout is transient and cost a real page — measured
            # 2026-08-24, AU page 6 died on "cURL error 28 ... 5000
            # milliseconds" and the walk stopped at 500 of 533. Retrying only
            # the timeout keeps a genuine 400 loud.
            transient = 'cURL error' in body or 'timed out' in body
            sys.stderr.write(f'  HTTP {e.code} for {url[:100]}'
                             f'{" (transient, retrying)" if transient and attempt < tries - 1 else ""}\n'
                             f'    {body[:200]}\n')
            if not transient and (e.code < 500 or attempt == tries - 1):
                return None
            if attempt == tries - 1:
                return None
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1:
                sys.stderr.write(f'  fetch failed for {url[:110]}: {str(e)[:120]}\n')
                return None
        time.sleep(attempt + 1)
    return None


def get_nonce() -> str:
    j = get_json(NONCE_URL)
    return (j or {}).get('nonce', '')


def fetch_market(cc: str, window: int, nonce: str) -> tuple[list[dict], int]:
    """Every advertised role in one market's recency window. (rows, total_items)."""
    out: list[dict] = []
    seen: set[str] = set()
    total = 0
    for page in range(1, MAX_PAGES + 1):
        q = urllib.parse.urlencode({
            'sort': 'date_posted', 'date_posted': window, 'country_code': cc,
            'page_index': page, 'item_per_page': PER_PAGE,
        })
        j = get_json(f'{JOBS}?{q}', {'X-WP-Nonce': nonce})
        data = (j or {}).get('data') or {}
        items = data.get('items') or []
        if page == 1:
            total = int(data.get('total_items') or 0)
        if not items:
            break
        for it in items:
            # friendly_id is the board's own per-advert id; two employers can
            # advertise the same title on the same day.
            key = str(it.get('friendly_id') or it.get('id') or '')
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            out.append(it)
        if page >= int(data.get('total_pages') or 1):
            break
    return out, total


def to_row(it: dict, cc: str, company: str, company_id: str) -> dict:
    salary = ''
    lo, hi = it.get('salary_min'), it.get('salary_max')
    cur = it.get('salary_currency') or ''
    if lo or hi:
        rate = it.get('salary_rate_name') or ''
        span = ' - '.join(str(x) for x in (lo, hi) if x)
        salary = ' '.join(x for x in (cur, span, rate) if x).strip()
    posted = str(it.get('created_at') or '')[:10]
    fid = it.get('friendly_id') or ''
    return {
        'title': (it.get('title') or '').strip(),
        'company': company,
        'company_id': company_id,
        'location': (it.get('vendor_location_name') or '').strip(),
        'hub': MARKET_HUB.get(cc, 'sydney'),
        'category': (it.get('employment_type_name') or '').strip() or 'Employment Hero',
        'salary': salary,
        'url': f'{BASE}/jobs/position/{fid}/' if fid else f'{BASE}/jobs/',
        'posted': posted if re.match(r'^\d{4}-\d{2}-\d{2}$', posted) else '',
    }


def map_skills(titles: list) -> list:
    if not titles:
        return []
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                           input=json.dumps(titles).encode(),
                           capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode == 0:
            return json.loads(p.stdout.decode())
        sys.stderr.write(f'  map-skills failed: {p.stderr.decode()[:200]}\n')
    except Exception as e:  # noqa: BLE001
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
            detail = e.read().decode('utf-8', 'replace')[:300]
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {detail}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def upsert(rows: list) -> int:
    skills = map_skills([r['title'] for r in rows])
    packed, seen = [], set()
    for r, sk in zip(rows, skills):
        key = job_key(SOURCE, r['title'], r['company'], r['location'])
        if key in seen:
            continue
        seen.add(key)
        packed.append((key, SOURCE, r['title'], r['company'], r['company_id'],
                       r['hub'], r['location'], r['category'], r['salary'] or None,
                       r['url'], r['posted'] or None, json.dumps(sk) if sk else None))
    written = 0
    for i in range(0, len(packed), 7):  # D1 caps ~100 bound params a query
        chunk = packed[i:i + 7]
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
    if LIMIT < len(roster):
        roster = roster[:LIMIT]
    sys.stderr.write(f'Employment Hero -> D1{", DRY RUN" if DRY else ""}: '
                     f'{len(roster)} rostered companies, markets {",".join(MARKETS)}\n')

    nonce = get_nonce()
    if not nonce:
        sys.stderr.write('Could not obtain a nonce from admin-ajax — the board is unreachable '
                         'or the WordPress route moved. Nothing written.\n')
        return 1

    matched: list[dict] = []
    swept = 0
    truncated: list[str] = []
    for cc in MARKETS:
        window = WINDOW_OVERRIDE or MARKET_WINDOW.get(cc, 7)
        items, total = fetch_market(cc, window, nonce)
        swept += len(items)
        # The cap is silent by design — total_items keeps reporting the true
        # size while total_pages quietly stops at 10 — so it is named here.
        if total > CAP:
            truncated.append(f'{cc} ({total} in {window}d, reachable {CAP})')
        hits = 0
        for it in items:
            adv = (it.get('organisation_name') or '').strip()
            if not adv:
                continue
            for c in roster:
                if strict_match(adv, c['name']):
                    matched.append(to_row(it, cc, c['name'], c['id']))
                    hits += 1
                    break
        sys.stderr.write(f'  {cc}: {len(items):>4} advertised in {window}d '
                         f'(board says {total}) -> {hits} at rostered companies\n')

    if truncated:
        sys.stderr.write(
            '\n! The 10-page cap truncated these markets — rows exist that this run could not '
            'reach:\n    ' + '\n    '.join(truncated) +
            '\n  Narrow the window, or slice by vendor_location_name (see the module '
            'docstring).\n')

    sys.stderr.write(f'\n{swept} roles swept, {len(matched)} at rostered companies.\n')
    for r in matched[:8]:
        sys.stderr.write(f'  - {r["title"][:40]:42} | {r["company"][:24]:26} | {r["location"][:26]}\n')

    if not swept:
        sys.stderr.write('Not one role returned across every market. That is the board '
                         'refusing us or the route changing, not an empty market. '
                         'Nothing written.\n')
        return 2
    if DRY:
        return 0
    if not matched:
        # A real possibility and NOT a failure: this board is dominated by small
        # employers, and on a quiet day none of them is ours. The sweep above
        # proves the feed itself works.
        sys.stderr.write('No rostered company advertised in this window — nothing to write.\n')
        return 0
    n = upsert(matched)
    sys.stderr.write(f'{n} rows upserted to D1 as {SOURCE}.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
