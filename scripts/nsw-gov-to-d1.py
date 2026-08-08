#!/usr/bin/env python3
"""
Scrape the NSW public-sector jobs board (iworkfor.nsw.gov.au) and archive it to
the D1 jobs table, deduped — the NSW-Government counterpart of scripts/
sa-gov-to-d1.py.

WHY THIS READS AN API AND NOT THE PAGE
The board was rewritten as a client-rendered Next.js app. The HTML it serves now
contains ZERO job records and zero /job/ links: the results list is a client
component that fetches after hydration, and the only job-shaped content left in
the payload is the filter sidebar. Scraping that page had stopped producing
vacancies and started producing site chrome — "Accessibility", "Privacy and
security", "Job alerts", every region filter, every job-category label — 303 rows
of navigation archived as NSW vacancies. (The extractor hole that allowed it is
fixed separately, in jobs_extract.looks_like_job; this script no longer depends
on it.)

So this reads what the board's own browser client reads: a JSON search API.

    POST https://api.ad-core04.com/api/search/jobs
    Authorization: Bearer <token shipped in the site's JS bundle>
    {..., "PageNumber": 1, "PageSize": 500, "SortBy": "RelevanceDesc"}
    -> {"JobCount": 3699, "Jobs": {"$values": [{"Job": {...}}, ...]}}

That is strictly better than the old HTML scrape on every axis: it reports its
own total (so a short walk is detectable rather than silent), it needs no JS
render, and — the reason this matters for the archive — it carries salaries,
where the rendered cards carried none at all. Measured over the whole live board
(3,699 ads, 2026-08-03): 3,001 state a range and 2,918 of those (79% of the
board) survive the sanity check below and parse to annual AUD.

THE TOKEN IS DISCOVERED, NOT STORED. It is a long-lived OAuth-client bearer that
the site ships publicly to every browser in its JS bundle, so it is not a secret
of ours — but it is not ours to hard-code either, and it can rotate. Each run
reads it back out of the live bundle, so a rotation costs nothing.

That one step (and only that step) needed more than a plain request:
iworkfor.nsw.gov.au sits behind Cloudflare's "Just a moment" interstitial and
403s any datacentre IP, static /_next/ chunks included. api.ad-core04.com does
not, so the search calls themselves are plain HTTP and always were.

Since 2026-08-08 that step is a LOCAL HEADLESS RENDER rather than an Oxylabs
fetch. The challenge is at the HTTP layer, not the address: a real browser on an
ordinary runner clears it, measured twice (probe-headless-ci, 2026-08-08). The
page and its chunks share ONE browser context, because the clearance lives in
that context's cookies — see browser_fetch.Session.

Each vacancy maps to its nsw-gov-<slug> company id (from data/sydneyGov.ts),
maps skills via the worker taxonomy, and upserts through the D1 HTTP API using
the same source|title|company|location key as src/employsi/lib/jobArchive.ts.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID. Also
     OXYLABS_USERNAME / OXYLABS_PASSWORD, but ONLY with --oxylabs — by default
     the token discovery renders locally and no proxy is involved.
Run:  python3 scripts/nsw-gov-to-d1.py [--solve] [--limit N] [--page-size N]
                                       [--oxylabs]
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import urllib.request  # noqa: E402
try:
    import browser_fetch
    import oxylabs_client as oxy
    import jobs_extract as jx
except Exception as e:  # noqa: BLE001
    sys.exit(f'Missing helper module ({e}).')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'
TODAY = datetime.date.today().isoformat()

SITE = 'https://iworkfor.nsw.gov.au'
SEARCH_PAGE = SITE + '/jobs'

args = sys.argv[1:]


def _opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


NO_SKILLS = '--no-skills' in args
SOLVE = '--solve' in args
LIMIT = int(_opt('--limit', 10**9))
# 500 is measured against the live API: it returns a full 500 in ~4.5s, same as
# a page of 100, so the whole board is 8 calls rather than 37.
PAGE_SIZE = int(_opt('--page-size', 500))
MAX_PAGES = int(_opt('--max-pages', 40))

if not SOLVE and not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). (Not needed with --solve.)')


def norm(s: str) -> str:
    """The ARCHIVE's normaliser, character-for-character the same as the one in
    src/employsi/lib/jobArchive.ts.

    It exists to build job_key, and job_key is shared with every other source —
    an Adzuna or SEEK row for the same NSW vacancy dedupes against ours only if
    both sides normalise identically. So this function must not be "improved".
    It was, once: the roster-matching rewrites below were added here, every key
    containing "&" or "NSW" changed shape, and a single re-run inserted 638
    vacancies a second time instead of updating them.
    """
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def match_norm(s: str) -> str:
    """Agency text → the form the ROSTER is matched on. Never used for a key.

    Two rewrites happen before the non-alphanumerics are stripped, and both are
    there because the board and the roster spell the SAME body differently:

      &  ->  " and "     The board advertises "National Parks & Wildlife
                         Service"; the roster carries "National Parks and
                         Wildlife Service". Stripping the ampersand to a space
                         leaves "parks wildlife" against "parks and wildlife",
                         which is not a substring of the other in either
                         direction, so the agency went unplaced.
      NSW -> new south wales
                         The board writes "Art Gallery of NSW", the roster
                         "Art Gallery of New South Wales". Expanding rather than
                         contracting is the safe direction: contracting would
                         turn "New South Wales" into "nsw" everywhere and make
                         several short agency names collide.
    """
    s = (s or '').lower().replace('&', ' and ')
    s = re.sub(r'\bnsw\b', 'new south wales', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()[:120]


# Bodies the board advertises under a name that is not lexically reachable from
# the roster's, and that are not a second employer. Checked, not guessed:
# the Library Council of NSW is the State Library of NSW's own governing body
# and the entity its vacancies are posted by, so its ads are State Library ads.
# A second roster line would have put a second pin on the Sydney map for one
# library.
AGENCY_ALIAS = {
    'library council of new south wales': 'State Library of New South Wales',
}


def job_key(source, title, company, location):
    return '|'.join([source, norm(title), norm(company), norm(location)])[:400]


CITIES = ['sydney', 'perth', 'adelaide', 'brisbane', 'melbourne']


def match_city(text):
    t = (text or '').lower()
    for c in CITIES:
        if c in t:
            return c
    return 'sydney'


def slug(name):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', (name or '').lower()))


def nsw_gov_id(name):
    return 'nsw-gov-' + slug(name)


def load_agency_names():
    txt = open(os.path.join(ROOT, 'src/employsi/data/sydneyGov.ts')).read()
    block = re.search(r'const NAMES:\s*string\[\]\s*=\s*\[(.*?)\];', txt, re.S)
    if not block:
        return []
    body = block.group(1)
    # COMMENTS ARE STRIPPED FIRST, and that is not tidiness. This regex takes
    # every quoted string in the array body, so a comment that QUOTES an agency
    # name — which is the natural way to explain why a name is spelled the way
    # it is — silently became a roster entry. It happened: a note reading
    # 'already on this list as "Art Gallery of NSW"' added a phantom 84th agency
    # whose id was nsw-gov-art-gallery-of-nsw, so vacancies filed against it
    # pointed at a company the app does not have. Nothing errors when that
    # happens; the card is simply empty.
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'//[^\n]*', '', body)
    out = []
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'', body):
        s = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(s.replace('\\"', '"').replace("\\'", "'"))
    return out


AGENCY_NAMES = load_agency_names()
AGENCY_BY_NORM = {match_norm(n): nsw_gov_id(n) for n in AGENCY_NAMES}
AGENCY_SORTED = sorted(AGENCY_NAMES, key=lambda n: len(n), reverse=True)


def agency_to_id(agency):
    n = match_norm(agency)
    if not n:
        return 'nsw-gov', 'NSW Government'
    if n in AGENCY_ALIAS:
        n = match_norm(AGENCY_ALIAS[n])
    if n in AGENCY_BY_NORM:
        return AGENCY_BY_NORM[n], agency.strip()
    for name in AGENCY_SORTED:
        nn = match_norm(name)
        if nn and (nn in n or n in nn):
            return nsw_gov_id(name), agency.strip()
    return 'nsw-gov', agency.strip() or 'NSW Government'


def company_of(job):
    """(company_id, display name) for one vacancy.

    The API gives two names and they are a hierarchy: BusinessName is the
    employing entity ("Western NSW Local Health District", "Fire and Rescue
    NSW"), AgencyName the cluster above it ("Health", "Communities and
    Justice"). Measured over the whole live board (3,699 ads):

        BusinessName alone            2,075 placed, 1,624 unplaced (43%)
        …then the cluster as fallback 3,600 placed,    99 unplaced (2.7%)

    So the entity leads — it is the more specific answer and the roster carries
    47 of them — and the cluster catches the rest, which is a roll-up the board
    itself asserts rather than a guess of ours (the 174 Western NSW LHD ads
    really are NSW Health ads).

    The DISPLAY name stays the entity either way. Rolling the pin up to Health
    is right; telling the user that a Dubbo nursing role is advertised by
    "Health" is not.
    """
    entity = (job.get('BusinessName') or '').strip()
    cluster = (job.get('AgencyName') or '').strip()
    cid, name = agency_to_id(entity or cluster)
    if cid == 'nsw-gov' and cluster and cluster != entity:
        cid = agency_to_id(cluster)[0]
    return cid, entity or cluster or 'NSW Government'


def map_skills(titles):
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


def d1(sql, params):
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
            if attempt == 3:
                raise RuntimeError(f'D1 {e.code}: {e.read().decode("utf-8", "replace")[:300]}')
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def existing_titles_by_company():
    out = {}
    r = d1("SELECT DISTINCT company_id, title FROM jobs WHERE source != 'nsw-gov'", [])
    for x in (r[0]['results'] if r else []):
        out.setdefault(str(x.get('company_id') or ''), set()).add(norm(str(x.get('title') or '')))
    return out


def upsert(rows):
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


# ── the board's own search API ───────────────────────────────────────────────
# A JWT, and the API base it authenticates against, both sit as plain string
# literals in one of the site's JS chunks. The minifier renames the variables
# every build, so neither the variable names nor the chunk filename can be
# matched on — what is stable is the SHAPES: an https base ending in /api/, and a
# three-segment JWT. Pairing those two inside one chunk is what survives a
# rebuild.
API_BASE_RE = re.compile(r'"(https://[a-z0-9.\-]+/api/)"')
JWT_RE = re.compile(r'"(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,})"')
CHUNK_RE = re.compile(r'<script[^>]+src="(/_next/static/chunks/[^"]+\.js)"')


# Playwright on an ordinary runner by default; --oxylabs puts the proxy back.
#
# ONLY THIS STEP EVER NEEDED THE PROXY. The search calls against
# api.ad-core04.com are, and always were, plain HTTP. Oxylabs was bought for the
# one fetch that reads the bearer out of the site's own bundle, because
# iworkfor.nsw.gov.au sits behind Cloudflare's "Just a moment" and 403s a
# datacentre IP even for static /_next/ chunks.
#
# That wall is at the HTTP layer. A real browser on the same datacentre address
# clears it: measured twice from a hosted runner
# (.github/workflows/probe-headless-ci.yml, 2026-08-08), 40 and 42 /_next/
# chunk references on the jobs page. So the whole feed comes off the proxy for
# the cost of one page render a day.
VIA_OXYLABS = '--oxylabs' in sys.argv[1:]

SETTLE = [{'type': 'wait', 'wait_time_s': 10}]


def _discover_via_browser():
    """One browser context for the page AND its chunks.

    The chunks are fetched from inside the page rather than by navigating to
    them, so each request carries the clearance cookie the render just earned
    and comes back as raw JavaScript. Navigating to a .js URL would return a
    document that wraps it in <pre> with every quote entity-escaped, and
    JWT_RE — which matches on a quoted literal — would find nothing in it.
    """
    with browser_fetch.Session(locale='en-AU') as ses:
        page = ses.html(SEARCH_PAGE, SETTLE)
        if not page:
            sys.exit(f'Could not load {SEARCH_PAGE} in a browser.')
        chunks = list(dict.fromkeys(CHUNK_RE.findall(page)))
        if not chunks:
            jx.diagnose(page, 'jobs-page')
            sys.exit('No /_next/ chunks on the jobs page — the site was rebuilt '
                     'on a different stack.')
        sys.stderr.write(f'  scanning {len(chunks)} JS chunks for the API credentials…\n')
        for src in chunks:
            js = ses.text(SITE + src)
            if not js:
                continue
            base, tok = API_BASE_RE.search(js), JWT_RE.search(js)
            if base and tok:
                sys.stderr.write(f'    found in {src.rsplit("/", 1)[-1]} -> {base.group(1)}\n')
                return base.group(1), tok.group(1)
    sys.exit(f'Could not find the search API credentials in any of {len(chunks)} chunks.')


def discover_api():
    """(base_url, bearer) read out of the live bundle. Never stored in the repo."""
    if not VIA_OXYLABS:
        return _discover_via_browser()
    html, status = oxy.fetch(SEARCH_PAGE, geo='Australia', render=False)
    if not html:
        sys.exit(f'Could not load {SEARCH_PAGE} (status={status}).')
    chunks = list(dict.fromkeys(CHUNK_RE.findall(html)))
    if not chunks:
        jx.diagnose(html, 'jobs-page')
        sys.exit('No /_next/ chunks on the jobs page — the site was rebuilt on a different stack.')
    sys.stderr.write(f'  scanning {len(chunks)} JS chunks for the API credentials…\n')
    for src in chunks:
        js, _ = oxy.fetch(SITE + src, geo='Australia', render=False)
        if not js:
            continue
        base, tok = API_BASE_RE.search(js), JWT_RE.search(js)
        if base and tok:
            sys.stderr.write(f'    found in {src.rsplit("/", 1)[-1]} -> {base.group(1)}\n')
            return base.group(1), tok.group(1)
    sys.exit(f'Could not find the search API credentials in any of {len(chunks)} chunks.')


def search_page(base, bearer, page, size):
    body = {'Agencies': [], 'Branches': [], 'WorkTypes': [], 'RoleTypes': [],
            'SalaryRanges': [], 'Locations': [], 'SearchTerm': None,
            'ForManageJobs': False, 'IsInternalJob': False,
            'PageNumber': page, 'PageSize': size, 'SortBy': 'RelevanceDesc'}
    req = urllib.request.Request(base + 'search/jobs', data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + bearer,
        'Origin': SITE, 'Referer': SITE + '/'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            sys.stderr.write(f'  page {page}: {type(e).__name__}, retrying\n')
            time.sleep(2 ** attempt)


# SalaryType -> the phrase src/employsi/lib/salaryParse.ts reads a period from.
# An unknown type is passed through verbatim rather than assumed to be annual:
# guessing the period wrong is a 12x error on the ticker's median.
PERIOD = {'annually': 'per year', 'annual': 'per year', 'yearly': 'per year',
          'monthly': 'per month', 'fortnightly': 'per fortnight',
          'weekly': 'per week', 'daily': 'per day', 'hourly': 'an hour'}

# The floor src/employsi/lib/salaryParse.ts applies after conversion, repeated
# here so a figure that cannot be annual is never WRITTEN as annual rather than
# merely ignored on read.
#
# 83 of the board's 3,001 salaried ads are typed "Annually" and carry an HOURLY
# figure — "$37 - $43", "$23 - $35". The board is mislabelling them, and the
# distribution says so unambiguously: 80 of its annual lows sit under $100 and 3
# between $1,152 and $1,439, then there is NOTHING until $23,090, which is where
# real part-time annualised salaries start. We do not know whether those 83 mean
# an hour, a shift or a day, so they are stored as no salary at all rather than
# as a $37 annual wage.
MIN_ANNUAL = 5_000


def salary_text(job) -> str | None:
    """SalaryFrom/SalaryTo/SalaryType -> the advertised-range string we archive.

    0/0 means the ad did not state a salary — 19% of the board — and that is
    stored as nothing at all rather than as a zero.
    """
    try:
        lo = float(job.get('SalaryFrom') or 0)
        hi = float(job.get('SalaryTo') or 0)
    except (TypeError, ValueError):
        return None
    lo, hi = (lo, hi) if lo <= hi else (hi, lo)
    if hi <= 0:
        return None
    raw = (job.get('SalaryType') or '').strip()
    per = PERIOD.get(raw.lower(), raw.lower())
    if per == 'per year' and hi < MIN_ANNUAL:
        return None
    amounts = f'${lo:,.0f} - ${hi:,.0f}' if lo > 0 and lo != hi else f'${hi:,.0f}'
    return f'{amounts} {per}'.strip()


def location_of(job) -> str:
    vals = ((job.get('Location') or {}).get('$values')) or []
    names = [v.get('CombinedName') or v.get('Name') for v in vals if isinstance(v, dict)]
    names = [n for n in names if n]
    return ', '.join(dict.fromkeys(names)) or 'New South Wales'


def job_url(job) -> str:
    """The canonical detail URL, /job/<title-slug>-<id>.

    Verified live: /job/on-call-firefighter-ms3-079-ingleburn-585673 returns 200
    with the matching <title>. The API does not hand back a URL of its own — it
    has ApplyLink, which points at the agency's ATS, not at the board.
    """
    jid = job.get('ID')
    s = slug(job.get('Title') or '')
    return f'{SITE}/job/{s}-{jid}' if jid and s else ''


def fetch_all():
    base, bearer = discover_api()
    first = search_page(base, bearer, 1, PAGE_SIZE)
    total = int(first.get('JobCount') or 0)
    sys.stderr.write(f'  board reports {total} live vacancies\n')
    rows, seen = [], set()

    def take(payload):
        got = 0
        for wrap in ((payload.get('Jobs') or {}).get('$values') or []):
            j = wrap.get('Job') if isinstance(wrap, dict) else None
            if not isinstance(j, dict) or not j.get('ID') or not (j.get('Title') or '').strip():
                continue
            if j['ID'] in seen:
                continue
            seen.add(j['ID'])
            rows.append(j)
            got += 1
        return got

    take(first)
    # Bounded by the board's OWN total rather than by "a page came back empty",
    # which is the truncation trap careerSites.ts documents: a failed fetch and
    # the end of a list look identical.
    page = 1
    while len(rows) < total and page < MAX_PAGES:
        page += 1
        got = take(search_page(base, bearer, page, PAGE_SIZE))
        sys.stderr.write(f'  page {page}: +{got} (have {len(rows)}/{total})\n')
        if got == 0:
            break
    return rows, total


def main() -> int:
    if not AGENCY_NAMES:
        sys.exit('Could not parse agency names from src/employsi/data/sydneyGov.ts')
    # Only the --oxylabs path needs credentials. The default renders the token
    # discovery locally, so demanding them unconditionally would fail a run that
    # never intended to touch the proxy — which is exactly what it did on the
    # first migrated run.
    if VIA_OXYLABS and not (os.environ.get('OXYLABS_USERNAME')
                            and os.environ.get('OXYLABS_PASSWORD')):
        sys.exit('--oxylabs needs OXYLABS_USERNAME / OXYLABS_PASSWORD (Web Scraper API).')
    sys.stderr.write(f'NSW gov -> D1: {len(AGENCY_NAMES)} agencies in roster.\n')

    scraped, total = fetch_all()

    # FAIL LOUDLY RATHER THAN ARCHIVE NOTHING-SHAPED-LIKE-SOMETHING.
    # The previous version of this script had no such check, and when the board
    # stopped serving vacancies it archived 303 navigation links instead. A run
    # that cannot see the board must go red, not quietly write whatever it found.
    if not scraped:
        sys.stderr.write('FAIL: the search API returned no vacancies. Nothing written.\n')
        return 2
    if total and len(scraped) < total * 0.8:
        sys.stderr.write(f'FAIL: collected {len(scraped)} of {total} advertised. Nothing written.\n')
        return 2

    with_sal = sum(1 for j in scraped if salary_text(j))
    sys.stderr.write(f'  collected {len(scraped)}/{total}; {with_sal} carry a salary '
                     f'({100 * with_sal // max(1, len(scraped))}%)\n')
    if SOLVE:
        for j in scraped[:8]:
            sys.stderr.write(f'    · {(j.get("Title") or "")[:44]:44} | '
                             f'{(j.get("BusinessName") or j.get("AgencyName") or "")[:28]:28} | '
                             f'{location_of(j)[:22]:22} | {salary_text(j) or "-"}\n')
        return 0
    if LIMIT < len(scraped):
        scraped = scraped[:LIMIT]

    have = existing_titles_by_company()
    titles = [j['Title'] for j in scraped]
    skills = map_skills(titles)
    out, keyset = [], set()
    for j, sk in zip(scraped, skills):
        cid, company = company_of(j)
        if norm(j['Title']) in have.get(cid, set()):
            continue
        loc = location_of(j)
        key = job_key('nsw-gov', j['Title'], company or cid, loc)
        if key in keyset:
            continue
        keyset.add(key)
        out.append((key, 'nsw-gov', j['Title'], company or None, cid,
                    match_city(loc), loc, 'Government', salary_text(j), job_url(j),
                    jx.iso_date(j.get('PublishDate')), json.dumps(sk) if sk else None))
    written = upsert(out) if out else 0
    matched = sum(1 for r in out if r[4] != 'nsw-gov')
    sys.stderr.write(f'\nDone. {len(scraped)} vacancies, {written} rows archived '
                     f'({matched} to a specific agency, {written - matched} to the NSW-gov bucket).\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
