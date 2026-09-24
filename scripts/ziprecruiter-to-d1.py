#!/usr/bin/env python3
"""
ZipRecruiter (US + Canada) → the D1 job archive, one search per rostered company.

WHAT THIS IS. An aggregator walked once per employer, the same kind of feed as
SimplyHired and Indeed: it indexes agency-posted and third-party-posted ads a
company's own portal never shows. It is the first feed that covers the NORTH
AMERICAN end of the roster — the 246 companies plotted on a US or Canadian hub
(Houston, New York, Toronto, ...) — and ZipRecruiter only serves those two
countries, so every row it returns is a US or Canadian vacancy.

THE TRANSPORT IS JobSpy (speedyapply/JobSpy, MIT, `pip install python-jobspy`),
the package that recovered Indeed (see indeed-to-d1.py). Its ZipRecruiter
scraper does not load www.ziprecruiter.com search pages; it calls
api.ziprecruiter.com/jobs-app/jobs — the iOS app's API — with the app's own
headers, and pages by an opaque `continue` token.

THE ADDRESS IS THE WHOLE PROBLEM, AND UNLIKE INDEED IT IS NOT SOLVED BY JobSpy.
Measured 2026-09-24 from a plain datacentre address (this repo's sandbox,
egressing in IAD), python-jobspy 1.1.82:

    api.ziprecruiter.com/jobs-app/jobs   JobSpy's TLS client   403 "forbidden aa"
                                         plain requests        403 "forbidden cf-waf"
    api.ziprecruiter.com/jobs-app/event  plain requests        403 "forbidden cf-waf"
    www.ziprecruiter.com/jobs-search     plain requests        403, 5.8 KB
                                                               "Just a moment..."

Indeed's app API served that same kind of address happily; ZipRecruiter's WAF
refuses it on every host, before looking at the request. So this runs from a
GitHub Action through SCRAPE_PROXY (IPRoyal residential) with a US exit, and
refuses to start without one unless --direct says the machine running it is
itself residential.

AND THAT DOES NOT GET IN EITHER. Measured from a GitHub runner, 2026-09-24
(run 35967097119, dry): the runner's own address 5 of 5 refused with
"forbidden cf-waf", the IPRoyal US exit 15 of 15 refused with "forbidden aa".
The code changes with the address; the refusal does not — so the request
itself (JobSpy's hardcoded iOS-app identity) is the likelier target, though
that is not established. speedyapply/JobSpy#302 reports the same 403, open
since 2025-09-06 with no fix. The workflow is therefore dispatch-only; this
file is kept whole so a JobSpy fix, or another transport, is a re-test
rather than a rewrite.

WHAT IS DELIBERATELY NOT USED FROM JobSpy
  - `_get_descr`. For every job the API returns, JobSpy fetches the job's HTML
    page from www.ziprecruiter.com to read the full description. That is
    twenty extra requests per result page against the Cloudflare-fronted host
    that serves a challenge, and the archive stores no descriptions — skills
    are mapped from the TITLE, exactly as every other feed does. It would
    multiply the request count ~20x and the residential-bandwidth bill with it,
    for a field that is thrown away. It is replaced with a no-op.
  - `scrape()`. JobSpy pages until `results_wanted` regardless of what the
    pages contain, and keyword search returns plenty of rows that are not the
    employer. This file drives `_find_jobs_in_page` itself and stops as soon as
    a page contributes nothing that passes the gate.
  - Its error handling, which is where the danger is. On a 403 or a 429 JobSpy
    logs and returns an EMPTY page — the same value as an employer with no ads.
    That is the silent-truncation failure careerSites.ts has hit twice, so the
    session's GET is wrapped to record the real status, and a refused page is
    counted as a failure, never as an empty result.

All three reach into JobSpy internals, so the workflow PINS the version.
Upgrading it is a code change to re-check here, not a routine bump.

ATTRIBUTION — TWO GATES, BECAUSE A US BOARD AND AN AUSTRALIAN ROSTER DISAGREE
ABOUT WHAT A NAME MEANS. ZipRecruiter's `search` is a keyword query, so every
row is tested against the roster name before it may be filed under a company id.

  * Companies whose home is a US/Canadian hub use company_alias.company_matches,
    the gate the Indeed JobSpy walk uses (suffix-normalised, default-deny).
  * Everyone else — the ~790 Australian, Asian and European companies — is
    held to the EXACT roster name. A North American employer trading under the
    short form of an Australian brand is a different company far more often
    than the Australian firm is hiring in America. Named cases, all real US
    employers: `Redox` (Madison health-tech, not Redox Ltd the chemicals
    distributor), `SGH` (Simpson Gumpertz & Heger, not SGH Ltd), and the
    everyday words `Challenger`, `Perpetual`, `Zip`, `AMP`. Suffix-stripping
    would accept each of them. So a single-word roster name from outside North
    America is rejected outright, and a multi-word one must match in full.

Rows the strict gate rejects but the loose gate would have accepted are
REPORTED at the end of the run, never auto-accepted — "BHP" for BHP, "Macquarie"
for Macquarie Group. Confirm one against the employer and add it to
CONFIRMED_NA below; that is the whole mechanism, the same one ADVERTISER_ALIAS
uses. Failing towards missing coverage rather than invented coverage is the
direction this archive fails in.

HUBS ARE GATED ON STATE. hubFor matches place names, and North America reuses
ours: measured through scripts/map-hubs.ts on 2026-09-24,

    Perth, ON        -> perth         Melbourne, FL  -> melbourne
    Sydney, NS       -> sydney        London, ON     -> london
    Brisbane, CA     -> brisbane      Paris, TX      -> paris
    Vancouver, WA    -> perth         Bellevue, WA   -> perth   (the " wa," needle)
    Portland, ME     -> portland      Washington, PA -> washington

Every row here is North American, so a hub is only kept when it is a US or
Canadian hub AND the row's state or province is that hub's. Everything else
archives with a null hub, which is honest: the row still counts for the
company, it just is not pinned to a city it is not in.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     SCRAPE_PROXY (+ SCRAPE_PROXY_COUNTRY=us) — see http_fetch.scrape_proxy_url.
Run: python scripts/ziprecruiter-to-d1.py [--limit N] [--only id,id]
         [--max-pages N] [--page-delay S] [--hours-old H] [--na-only]
         [--dry-run] [--no-skills] [--direct]
"""
from __future__ import annotations
import datetime
import json
import os
import subprocess
import sys
import time
import unicodedata
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

SOURCE = 'ziprecruiter'
CATEGORY = 'ZipRecruiter'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


LIMIT = int(_opt('--limit', 10 ** 9))
ONLY = set(_opt('--only', '').split(',')) if '--only' in args else None
# 20 rows a page (JobSpy's jobs_per_page, the API's own page size). Five pages
# is 100 ads, the same per-company ceiling the Indeed JobSpy walk uses — and the
# walk stops sooner whenever a page adds nothing that passes the gate.
MAX_PAGES = int(_opt('--max-pages', 5))
# Between pages of ONE company. JobSpy's own scrape() waits 5s; this is a
# little brisker because it pages far less often (see collect()).
PAGE_DELAY = float(_opt('--page-delay', 3))
HOURS_OLD = int(_opt('--hours-old', 0))
# Walk only the US/Canadian-home companies — the fast half, for a first probe.
NA_ONLY = '--na-only' in args
DRY = '--dry-run' in args
NO_SKILLS = '--no-skills' in args
# The machine running this is itself on a residential address (a hand-run from
# home). Without it, a missing SCRAPE_PROXY is refused rather than spending the
# run collecting 403s — the datacentre measurement is in the header.
DIRECT = '--direct' in args

if not TOKEN and not DRY:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

from company_alias import company_matches, fallback_safe, norm, short_name  # noqa: E402


# ── attribution ──────────────────────────────────────────────────────────────
# The US and Canadian hubs, each with the states/provinces a row may carry to be
# placed on it. The hub list is cityCountry.ts's "us"/"ca" entries; a hub absent
# here simply never receives a ZipRecruiter row, which is the safe failure.
#
# Sets rather than one state because hubFor matches the CITY name, and the gate
# only has to stop a same-named city elsewhere — Portland ME, Washington PA,
# Charlotte MI. It is not a metro-area model, and must not grow into one: a
# Jersey City row is not placed on newyork here, because hubFor never names it.
NA_HUB_STATES: dict[str, set[str]] = {
    'toronto': {'ON'}, 'ottawa': {'ON'}, 'montreal': {'QC'},
    'vancouver': {'BC'}, 'calgary': {'AB'},
    'newyork': {'NY'}, 'houston': {'TX'}, 'dallas': {'TX'}, 'austin': {'TX'},
    'sanfrancisco': {'CA'}, 'sanjose': {'CA'}, 'losangeles': {'CA'},
    'sandiego': {'CA'}, 'seattle': {'WA'}, 'portland': {'OR'},
    'chicago': {'IL'}, 'denver': {'CO'}, 'boston': {'MA'}, 'atlanta': {'GA'},
    'minneapolis': {'MN'}, 'washington': {'DC'}, 'charlotte': {'NC'},
    'indianapolis': {'IN'}, 'cincinnati': {'OH'}, 'philadelphia': {'PA'},
    'bentonville': {'AR'}, 'omaha': {'NE'},
}

# Advertiser names confirmed to BE a non-North-American roster company hiring
# in the US or Canada. Roster name -> accepted board names, both norm()ed.
#
# EMPTY ON PURPOSE. Nothing here can be observed until the first run through
# the residential exit returns rows, and an unobserved alias is a claim nobody
# has checked. The end-of-run report lists every candidate; confirm each
# against the employer before adding it.
CONFIRMED_NA: dict[str, set[str]] = {}


def is_na_home(company: dict) -> bool:
    return any(c in NA_HUB_STATES for c in company.get('cities') or [])


def attribute(company: dict, board: str) -> str | None:
    """'keep' when `board` is this company hiring, 'review' when only the loose
    rule would have kept it (reported, not filed), else None."""
    name = company['name']
    if not (board or '').strip():
        return None
    if is_na_home(company):
        return 'keep' if company_matches(name, board) else None
    rn, bn = norm(name), norm(board)
    if bn in CONFIRMED_NA.get(rn, set()):
        return 'keep'
    if rn == bn and len(rn.split()) > 1:
        return 'keep'
    return 'review' if company_matches(name, board) else None


def _fold(s: str) -> str:
    """'Montréal' -> 'Montreal'. hubFor's needles are ASCII; measured, the
    accented spelling resolved to no hub at all."""
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()


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
    return _bridge('map-skills.ts', {'titles': titles, 'sector': sector},
                   [[] for _ in titles])


def map_hubs(jobs: list) -> list:
    """hubFor's answer, kept only when the row's state is that hub's state."""
    if not jobs:
        return []
    locs = [_fold(f"{j['city']}, {j['state']}, {j['country']}") for j in jobs]
    hubs = _bridge('map-hubs.ts', {'locations': locs, 'home': None},
                   [None for _ in jobs])
    return [h if h and j['state'] in NA_HUB_STATES.get(h, ()) else None
            for h, j in zip(hubs, jobs)]


# ── ZipRecruiter through JobSpy ──────────────────────────────────────────────
class Transport:
    """One JobSpy ZipRecruiter session, with the HTTP status made visible."""

    def __init__(self, proxy: str | None):
        from jobspy.ziprecruiter import ZipRecruiter
        # Version drift guard: these are the internals this file relies on. A
        # renamed method should stop the run with a reason, not degrade it into
        # a walk that finds nothing.
        for attr in ('_find_jobs_in_page', '_get_descr'):
            if not hasattr(ZipRecruiter, attr):
                sys.exit(f'jobspy.ZipRecruiter has no {attr} — the pinned '
                         f'python-jobspy version changed. See this file\'s header.')
        self.proxy = proxy
        self.last_status: int | None = None
        self.last_body = ''
        self._cls = ZipRecruiter
        self._open()

    def _open(self):
        # JobSpy logs every refused page itself, response body and all; this
        # file reports the same refusal once, per company, with the status.
        import logging
        logging.getLogger('JobSpy:ZipRecruiter').setLevel(logging.CRITICAL)
        z = self._cls(proxies=self.proxy)
        # No description fetch — see the header.
        z._get_descr = lambda url: (None, None)
        z.session.get = self._watch(z.session.get)
        z.delay = 0
        self.z = z

    def _watch(self, orig_get):
        """Wrap the session's GET so the status JobSpy swallows is kept."""
        def get(*a, **k):
            self.last_status, self.last_body = None, ''
            r = orig_get(*a, **k)
            self.last_status = r.status_code
            if not 200 <= r.status_code < 400:
                # The WAF names itself in the body ("forbidden aa" from the
                # app-API rule, "forbidden cf-waf" from the edge), which is the
                # one clue to WHICH wall refused us.
                self.last_body = ' '.join((r.text or '')[:120].split())
            return r
        return get

    def reset(self):
        """A fresh session over a new connection. On a rotating residential
        exit that is also a new address."""
        self._open()

    def page(self, term: str, token: str | None) -> tuple[list, str | None, int | None]:
        """(JobPosts, next token, HTTP status). Status None = the request threw."""
        from jobspy.model import Site, ScraperInput
        si = ScraperInput(site_type=[Site.ZIP_RECRUITER], search_term=term,
                          results_wanted=20,
                          hours_old=HOURS_OLD or None,
                          description_format=None)
        self.last_status = None
        # Fresh per company page walk: JobSpy skips any listing it has seen in
        # this session, and a row REJECTED for one company must still be
        # visible to the next company it might belong to.
        if token is None:
            self.z.seen_urls = set()
        self.z.scraper_input = si
        try:
            jobs, nxt = self.z._find_jobs_in_page(si, token)
        except Exception as e:  # noqa: BLE001
            # JobSpy catches a failed REQUEST, but not a 200 that is not the
            # JSON it expects (a challenge page) or a listing missing a field it
            # indexes (`posted_time`). Either would otherwise escape and end the
            # whole walk; it is one unreadable page, so it is reported as one.
            self.last_body = f'unreadable page: {type(e).__name__}: {str(e)[:80]}'
            return [], None, None
        return jobs, (nxt or None), self.last_status


def _salary(comp, country: str) -> str | None:
    """"USD 85,000 - 110,000 per year", or None when the ad states no amount.

    The currency is ALWAYS written out. ZipRecruiter spans two countries, so it
    cannot go in salaryParse.ts's COUNTRY_BY_SOURCE, and a row off every hub
    would otherwise have no way to say whether "$85,000" is US or Canadian.
    When the API omits the currency, the country the ad is posted in supplies
    it — the same inference salaryParse makes from a hub. No amount, no string.
    """
    if comp is None:
        return None
    lo, hi = comp.min_amount, comp.max_amount
    ok = [v for v in (lo, hi) if v is not None and float(v) > 0]
    if not ok:
        return None
    cur = (comp.currency or '').strip().upper() or {'US': 'USD', 'CA': 'CAD'}.get(country, '')
    if not cur:
        return None
    per = getattr(comp.interval, 'value', comp.interval) or ''
    per = {'yearly': 'year', 'monthly': 'month', 'weekly': 'week',
           'daily': 'day', 'hourly': 'hour'}.get(str(per), '')
    amt = (f'{float(lo):,.0f} - {float(hi):,.0f}' if len(ok) == 2 and lo != hi
           else f'{float(ok[0]):,.0f}')
    return ' '.join(x for x in (cur, amt, f'per {per}' if per else '') if x)


def _row(p) -> dict | None:
    title = (p.title or '').strip()
    if not title:
        return None
    loc = p.location
    country = getattr(loc.country, 'name', '') if loc else ''
    country = {'USA': 'US', 'CANADA': 'CA'}.get(country, '')
    return {
        'title': title,
        'board': (p.company_name or '').strip(),
        'city': (loc.city or '').strip() if loc else '',
        'state': (loc.state or '').strip().upper() if loc else '',
        'country': country,
        'location': loc.display_location() if loc else '',
        'salary': _salary(p.compensation, country),
        'url': p.job_url or '',
        'posted': p.date_posted.isoformat() if p.date_posted else '',
    }


# ── the walk ─────────────────────────────────────────────────────────────────
# RECOVERING FROM A REFUSED SESSION, BOUNDED — the SimplyHired pattern, for the
# same reason: a dead session stays dead, and only a new connection can help.
# Two resets at most, because a site-wide block must still end the run red
# rather than be retried into the job timeout.
_BLOCK_STREAK = 0
_RESETS = 0
_RESET_AFTER = 5
_MAX_RESETS = 2


class Refused(Exception):
    pass


def fetch(tx: Transport, term: str, token: str | None):
    global _BLOCK_STREAK, _RESETS
    for attempt in range(2):
        jobs, nxt, status = tx.page(term, token)
        if status is not None and 200 <= status < 400:
            _BLOCK_STREAK = 0
            return jobs, nxt
        if status == 429 and attempt == 0:
            time.sleep(30)
            continue
        break
    _BLOCK_STREAK += 1
    if _BLOCK_STREAK >= _RESET_AFTER and _RESETS < _MAX_RESETS:
        _RESETS += 1
        sys.stderr.write(f'  {_BLOCK_STREAK} refused pages in a row — dropping the '
                         f'session and reconnecting (reset {_RESETS} of {_MAX_RESETS}).\n')
        tx.reset()
        _BLOCK_STREAK = 0
    raise Refused((f'HTTP {status} {tx.last_body}' if status
                   else tx.last_body or 'request failed').strip())


def collect(tx: Transport, company: dict) -> tuple[list, dict]:
    """(rows filed under this company, {board name: count} held for review)."""
    rows: dict[str, dict] = {}
    review: dict[str, int] = {}

    def walk(term: str) -> None:
        token = None
        for page in range(1, MAX_PAGES + 1):
            if page > 1:
                time.sleep(PAGE_DELAY)
                try:
                    posts, token = fetch(tx, term, token)
                except Refused as e:
                    # The pages already read are real ads; keep them. Only a
                    # refused FIRST page makes the company a failure.
                    sys.stderr.write(f'  {company["name"][:34]}: page {page} refused '
                                     f'({e}), keeping {len(rows)} row(s)\n')
                    return
            else:
                posts, token = fetch(tx, term, token)
            kept = 0
            for p in posts:
                r = _row(p)
                if not r:
                    continue
                verdict = attribute(company, r['board'])
                if verdict == 'keep':
                    if r['url'] not in rows:
                        kept += 1
                    rows[r['url']] = r
                elif verdict == 'review':
                    review[r['board']] = review.get(r['board'], 0) + 1
            # A page that adds nothing past the gate ends the walk. This ASSUMES
            # relevance ranking puts an employer's own ads ahead of ads merely
            # mentioning it. NOT yet measured on this board. If the first runs show employers capped at one page while
            # the board clearly holds more, this is the line to revisit.
            if not token or not kept:
                return

    walk(company['name'])
    # The Indeed walk's fallback: a roster name carrying a suffix can miss its
    # own employer. Only for North American companies — for the rest the strict
    # gate would reject whatever the short name finds.
    short = short_name(company['name'])
    if (not rows and is_na_home(company) and short and short != norm(company['name'])
            and fallback_safe(company['name'])):
        walk(short)
    return list(rows.values()), review


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


def job_key(title: str, company: str, location: str) -> str:
    """Identical to src/employsi/lib/jobArchive.ts."""
    return '|'.join([SOURCE, norm(title)[:120], norm(company)[:120],
                     norm(location)[:120]])[:400]


def upsert(company: dict, jobs: list) -> int:
    skills = map_skills([j['title'] for j in jobs], company.get('sector') or '')
    hubs = map_hubs(jobs)
    rows, seen = [], set()
    for j, sk, hub in zip(jobs, skills, hubs):
        key = job_key(j['title'], company['name'], j['location'])
        if key in seen:
            continue
        seen.add(key)
        rows.append((key, SOURCE, j['title'], company['name'], company['id'],
                     hub, j['location'], CATEGORY, j['salary'],
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


def targets_from(roster: list) -> list:
    """One walk per EMPLOYER, preferring its North American roster line.

    The roster carries eight employers twice. SimplyHired keeps the first line,
    which is right for an Australian board; on this board it would file
    Chevron's US hiring under the Perth pin's `chevron` rather than Houston's
    `houston-cvx`. So North American lines sort first, then roster order.
    """
    order = sorted(range(len(roster)), key=lambda i: (not is_na_home(roster[i]), i))
    seen, out = set(), []
    for i in order:
        c = roster[i]
        if ONLY and c['id'] not in ONLY:
            continue
        if NA_ONLY and not is_na_home(c):
            continue
        k = norm(c['name'])
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out[:LIMIT]


def main() -> int:
    import http_fetch
    from roster import load_roster

    proxy = http_fetch.scrape_proxy_url() or None
    if not proxy and not DIRECT:
        sys.stderr.write(
            'SCRAPE_PROXY is not set. ZipRecruiter 403s a datacentre address on '
            'every host (measured, see the header), so this would only collect '
            'refusals.\nPass --direct if this machine is itself residential.\n')
        return 1

    # An empty roster raises in load_roster rather than returning [] — a short
    # roster that looks like a successful run is the failure that guards against.
    targets = targets_from(load_roster(with_cities=True))
    na = sum(1 for c in targets if is_na_home(c))
    sys.stderr.write(f'ZipRecruiter -> D1: {len(targets)} employers ({na} North American) '
                     f'· via {http_fetch.proxy_label() if proxy else "this address (--direct)"}'
                     f'{", DRY RUN" if DRY else ""}\n')

    tx = Transport(proxy)
    total_rows = with_ads = failures = 0
    review: dict[str, dict] = {}
    states: dict[str, int] = {}
    for i, c in enumerate(targets, 1):
        try:
            jobs, held = collect(tx, c)
        except Refused as e:
            failures += 1
            sys.stderr.write(f'  [{i}/{len(targets)}] {c["name"][:34]}: REFUSED ({e})\n')
            # A block that has spent its resets will refuse everything after it.
            # Stop now rather than log the rest of the roster as refusals.
            if _RESETS >= _MAX_RESETS and _BLOCK_STREAK >= _RESET_AFTER:
                sys.stderr.write('  Still refused after every reset — stopping the walk.\n')
                break
            continue
        if held:
            review[c['name']] = held
        if not jobs:
            continue
        with_ads += 1
        for j in jobs:
            states[j['state'] or '?'] = states.get(j['state'] or '?', 0) + 1
        sal = sum(1 for j in jobs if j['salary'])
        sys.stderr.write(f'  [{i}/{len(targets)}] {c["name"][:34]:34s} '
                         f'{len(jobs):>3} kept, {sal:>3} with salary\n')
        total_rows += len(jobs) if DRY else upsert(c, jobs)

    sys.stderr.write(f'\n{with_ads} employers advertising, {total_rows} rows '
                     f'{"parsed" if DRY else "archived"}, {failures} refused.\n')
    if states:
        # Printed because it answers the open question in the workflow header:
        # with no location parameter, does the API search the whole country or
        # the exit's own metro? A national employer's rows landing in one or
        # two states would be the second.
        top = sorted(states.items(), key=lambda kv: -kv[1])[:12]
        sys.stderr.write(f'Rows span {len(states)} states/provinces: '
                         + ', '.join(f'{s} {n}' for s, n in top) + '\n')
    if review:
        # Reported, never auto-accepted — see CONFIRMED_NA.
        sys.stderr.write('\nHeld for review — the loose gate would have filed these. '
                         'Confirm against the employer, then add to CONFIRMED_NA:\n')
        ranked = sorted(review.items(), key=lambda kv: -sum(kv[1].values()))
        for name, boards in ranked[:40]:
            shown = ', '.join(f'{b} ({n})' for b, n in sorted(boards.items(), key=lambda kv: -kv[1]))
            sys.stderr.write(f'  {name[:32]:32s} <- {shown[:110]}\n')

    # Nothing kept across the whole roster is the board refusing us, not a
    # continent with no vacancies — go red rather than quietly write nothing.
    if not total_rows:
        sys.stderr.write('No rows kept across the entire roster — treating as failure.\n')
        return 1
    if failures > len(targets) // 4:
        sys.stderr.write(f'{failures} of {len(targets)} searches refused — degraded run.\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
