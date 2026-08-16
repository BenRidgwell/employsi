#!/usr/bin/env python3
"""
Scrape the APS Jobs board (apsjobs.gov.au — federal / Commonwealth vacancies) and
archive it to the D1 jobs table, deduped — the federal counterpart of the state
gov scrapers.

Why a browser: apsjobs.gov.au is a Salesforce Aura site whose results are fetched
by a session-gated ApexAction and rendered client-side, so a plain HTTP client
gets an empty "Guest user access is not allowed" shell.

This used to go through Oxylabs, on the record that "a headless Chromium on a
GitHub runner doesn't help either — the datacenter IP is bot-blocked and the run
scraped 0 vacancies". That was re-tested on 2026-08-04
(.github/workflows/probe-headless-ci.yml) and is not what happens: headless
Chromium on ubuntu-latest read 15 vacancies out of this board through the same
`jobs_extract` path used below.

The difference is the settle time. Aura hydrates in two steps, and the earlier
attempt read the DOM too early — which returns the shell, i.e. exactly what a
block looks like. Twelve seconds is enough; see SETTLE_S. So the residential IP
was paying for a browser we can run ourselves, and this now drives a local
Chromium. `--oxylabs` restores the proxy path unchanged.

One pass scrapes every current APS vacancy, maps each to its `aps-<slug>` agency
id (mapped ONLY against the federal roster — never a state gov id, so a federal
agency's jobs are never double-counted with WA/QLD/SA/VIC state agencies), maps
skills for parity via scripts/map-skills.ts, and upserts through the D1 HTTP API
with the same source|title|company|location key + upsert as
src/employsi/lib/jobArchive.ts. Jobs whose agency can't be matched are archived
under company_id 'aps-gov' (the federal bucket).

Needs: pip install playwright && python -m playwright install chromium
Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID.
     OXYLABS_USERNAME / OXYLABS_PASSWORD only if --oxylabs is passed.
Run:  python3 scripts/aps-to-d1.py [--max-pages N] [--no-skills] [--solve]
                                   [--limit N] [--oxylabs]
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import browser_fetch  # noqa: E402
try:
    import oxylabs_client as oxy  # noqa: E402
    import jobs_extract as jx  # noqa: E402
except ImportError as e:
    sys.exit(f'Missing helper module ({e}).')

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
NO_SKILLS = '--no-skills' in args
# Playwright by default; --oxylabs sends the same render request to the Web
# Scraper API instead. See render() below.
VIA_OXYLABS = '--oxylabs' in args
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


# ── APS agency roster → aps-<slug> id (RUN from data/canberraGov.ts) ──────────
def slug(name: str) -> str:
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))


def aps_id(name: str) -> str:
    return 'aps-' + slug(name)


def load_agencies() -> tuple[list[str], dict]:
    """Every federal agency, via scripts/aps-roster.ts — never a regex.

    This read the TypeScript with a regex until 2026-08-16, and the regex only
    accepted a hub override in SINGLE quotes:

        (?:,\\s*'([^']+)')?\\s*\\]

    Prettier writes the file with DOUBLE quotes, so ["Reserve Bank of Australia",
    "sydney"] did not match at all and the entry was dropped — not logged, not
    counted, just absent. The loader returned 49 agencies where canberraGov.ts
    declares 56, and the seven lost were exactly the seven that carry a hub
    because they are not in Canberra: ASIC, APRA, the RBA, the Bureau of
    Meteorology, ARPANSA, the Australian Space Agency and the AIFS. Their
    vacancies could never be attributed, because their names were not in the
    table being matched against.

    scripts/roster.py exists to end this exact failure elsewhere in the tree; it
    raises rather than falling back, on the reasoning that a short roster which
    looks like a successful run is the bug. Same rule here.
    """
    try:
        p = subprocess.run(['bun', 'run', os.path.join(HERE, 'aps-roster.ts')],
                           capture_output=True, timeout=120, cwd=ROOT)
    except FileNotFoundError as e:
        raise RuntimeError(
            'bun is required to read the APS agency roster '
            '(canberraGov.ts derives ids and hubs at module load, so it cannot '
            'be read from source). Install bun: https://bun.sh') from e
    if p.returncode != 0:
        raise RuntimeError(f'APS roster dump failed: {p.stderr.decode()[:300]}')
    rows = json.loads(p.stdout.decode())
    if not isinstance(rows, list) or not rows:
        raise RuntimeError('APS roster dump was empty')
    return [r['name'] for r in rows], {r['id']: r['hub'] for r in rows}


AGENCY_NAMES, AGENCY_HUB = load_agencies()
AGENCY_BY_NORM = {norm(n): aps_id(n) for n in AGENCY_NAMES}
AGENCY_CANON = {norm(n): n for n in AGENCY_NAMES}


def _agency_keys() -> list[tuple[str, str]]:
    """Normalised text a job's agency field may carry → the canonical agency.

    Two keys per agency, longest first so the specific wins:

      "department of employment and workplace relations"   the name as declared
      "of employment and workplace relations"              decapitated

    The decapitated key exists because the board's own text does not always
    survive extraction with its leading word intact — see agency_to_id below.
    """
    keys: list[tuple[str, str]] = []
    for name in AGENCY_NAMES:
        n = norm(name)
        keys.append((n, name))
        headless = re.match(r'^department\s+(.+)$', n)
        if headless:
            keys.append((headless.group(1), name))
    keys.sort(key=lambda k: -len(k[0]))
    return keys


AGENCY_KEYS = _agency_keys()


def agency_to_id(agency: str) -> tuple[str, str]:
    """Map a job's agency text to an aps-* id ONLY (never a state gov id).

    THE TEXT ARRIVES WITH THE JOB TITLE STUCK TO IT, and often without its first
    word. Both come from jobs_extract's block mining: the APS board renders the
    agency and the title as sibling elements, `text_of` flattens them into one
    run, and the field grab then took a fixed 70 characters. Measured against the
    230 rows this had put in the unattributed bucket by 2026-08-16:

        "of Foreign Affairs and Trade Assistant Director, Fraud and Sanctions C"
        "of Finance Senior Drupal Developer $ 101,355 to $ 123,702 Opportunity"

    So an equality test — which is all this did, plus a substring rule that could
    not fire on strings shaped like these — bucketed essentially everything. Two
    of 232 rows reached a real agency, and both were CSIRO, the one agency whose
    name is a single token with nothing in front of it.

    Matching is therefore EXACT, then LONGEST PREFIX, and nothing looser. Prefix
    is not a guess at the shape: the corruption only ever appends (the title
    follows the agency), so what survives is always the head of the string.
    Measured over those 230 rows, prefix matching recovers 39 of the 68 distinct
    strings and every recovery is correct; a substring pass on top recovered no
    additional string, so it is deliberately absent rather than kept as a
    safety net — a rule that adds no true positives can only add false ones,
    and filing a vacancy under the wrong employer is the error this archive is
    least willing to make.

    The 29 that stay in the bucket carry no agency text at all ("Senior Cloud
    Engineer $ 123,193 to ..."), or name a Commonwealth employer that is not in
    canberraGov.ts — Parliamentary Services, the House of Representatives, ANSTO
    and NEMA all appear in the live data and are not in the roster's 56.

    Returns the CANONICAL name, not the text that was matched, so the archive
    stops storing 70-character fragments as employer names.
    """
    n = norm(agency)
    if not n:
        return 'aps-gov', 'Australian Public Service'
    if n in AGENCY_BY_NORM:
        return AGENCY_BY_NORM[n], AGENCY_CANON[n]
    for key, name in AGENCY_KEYS:
        if key and n.startswith(key + ' '):
            return aps_id(name), name
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
                    # `posted` is the day the ad went up. APS cards advertise a
                    # CLOSING date and nothing else, so when the extractor finds
                    # no posting date this stays EMPTY rather than falling back
                    # to the close — which is what put "Date 09 Aug 2026" into
                    # the column on 84 rows.
                    r.get('posted') or '', json.dumps(sk) if sk else None))
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


SEARCH_URL = 'https://www.apsjobs.gov.au/s/job-search?offset={offset}'
PAGE_SIZE = 20  # APS board's own page size; offsets step by this


# Seconds to let Aura hydrate before reading the DOM. Twelve, not eight:
# measured on a GitHub runner, the results arrive in two steps and eight was not
# always enough — a short settle reads the shell and reports a healthy board with
# nothing on it.
SETTLE_S = 12

# The Aura endpoint the board's results arrive on. Matched loosely because the
# query string carries a per-session token; the path is the stable part.
AURA_URL_RE = r'/aura\?|sfsites/aura'

# Only describe responses big enough to plausibly BE the board. The framework
# chatter on this page is 1.6–9KB a piece; the ApexAction payloads are 114KB and
# 1.78MB, so this reports the candidates and stays quiet about the beacons.
SHAPE_MIN_BYTES = 50_000


def render(url: str) -> tuple[str | None, list[tuple[str, str]]]:
    """Rendered page plus any Aura responses, as (html, [(url, body), ...]).

    APS needs JavaScript executed and, measured 2026-08-04, nothing else: a
    headless Chromium on an ordinary GitHub runner read 15 vacancies out of this
    board through the same `jobs_extract` path used below. The residential IP was
    paying for a browser we can run ourselves.

    The Oxylabs path returns no captures — it fetches a rendered document, not a
    session — so `--oxylabs` keeps the DOM behaviour it always had.
    """
    if VIA_OXYLABS:
        content, status = oxy.fetch(url, geo='Australia', render=True)
        if not content:
            sys.stderr.write(f'  (oxylabs status={status})\n')
        return content, []
    return browser_fetch.render_capturing(
        url, AURA_URL_RE, [{'type': 'wait', 'wait_time_s': SETTLE_S}])


def scrape_board(max_pages: int):
    """Walk the APS board, reading the Aura RESPONSES rather than the cards.

    WHY THE RESPONSE AND NOT THE PAGE. This board is a Salesforce Aura app: the
    results arrive on a session-gated endpoint as JSON and are rendered
    client-side. Reading `page.content()` therefore reads the rendered cards,
    where the agency, title and salary have been flattened into one run of text —
    and recovering them from that is what filed 230 of 232 archived rows under a
    fragment of a job ad. The response carries `Agency__c` as its own field, which
    is the shape test_jobs_extract.py has always covered.

    So each page is now read twice and the better answer wins: the captured JSON
    if it yields rows, the DOM otherwise. That ordering is deliberate rather than
    a preference — a page that renders cards without the capture firing still
    works exactly as it did, so this cannot be worse than what it replaces.

    Every run says which path produced its rows and what the capture saw, because
    the failure being fixed here was silent: a scraper mining the wrong thing
    looks identical to one mining the right thing until you read the rows.
    """
    scraped, seen = [], set()
    for pg in range(max_pages):
        url = SEARCH_URL.format(offset=pg * PAGE_SIZE)
        content, captured = render(url)
        if not content:
            sys.stderr.write(f'  page {pg + 1}: no content\n')
            break

        # What the capture actually caught, named on every run. Without this the
        # difference between "no Aura traffic", "traffic with no jobs in it" and
        # "traffic we failed to parse" is invisible from a CI log.
        json_rows: list[dict] = []
        for cap_url, body in captured:
            got = jx.jobs_from_json_text(body)
            # The board states its own total. Reported because the gap between it
            # and what we collect IS the under-collection: measured 2026-08-16 the
            # payload said jobListingCount 608 while the walk returned 15 and the
            # whole archive held 232 rows for the entire APS.
            if pg == 0:
                total = re.search(r'"jobListingCount"\s*:\s*(\d+)', body)
                if total:
                    sys.stderr.write(
                        f'    [aura] board advertises {total.group(1)} vacancies '
                        f'({len(got)} in this response)\n')
            if pg == 0:
                tail = cap_url.split('/')[-1][:48]
                sys.stderr.write(
                    f'    [aura] {len(body):>7} bytes  {len(got):>3} job-like  …{tail}\n')
                # A big response that yields nothing is the interesting case: the
                # capture is plainly working (measured 2026-08-16, three
                # ApexAction bodies at 1.78MB each) and the parser still finds no
                # jobs, which is either the wrong schema or not JSON at all. The
                # opening bytes and the key histogram separate those two, and
                # neither needs 1.78MB in the log to see.
                if not got and len(body) >= SHAPE_MIN_BYTES:
                    sys.stderr.write(f'      {jx.json_shape(body)}\n')
            json_rows.extend(got)
        if pg == 0 and not captured:
            sys.stderr.write(f'    [aura] no response matched {AURA_URL_RE}\n')

        dom_rows, how = jx.extract_jobs(content, r'job-details', 'https://www.apsjobs.gov.au')
        if json_rows:
            rows, how = json_rows, 'aura-json'
        else:
            rows = dom_rows
        if not rows and pg == 0:
            jx.diagnose(content, 'aps-page1')

        new = 0
        for r in rows:
            key = (r['t'].lower(), (r.get('id') or ''), (r.get('loc') or '').lower())
            if key in seen:
                continue
            seen.add(key)
            scraped.append(r)
            new += 1
        sys.stderr.write(
            f'  page {pg + 1}: {len(rows)} rows ({new} new) via {how}'
            f'{f" [dom would give {len(dom_rows)}]" if json_rows else ""}\n')
        if new == 0:
            break
    return scraped


# Below this share of scraped vacancies reaching a named agency, the run is
# reporting a board it cannot actually read, and says so instead of exiting 0.
#
# Nothing asserted this until 2026-08-16, and that is the whole reason the
# attribution bug survived: the feed wrote rows every night, the workflow went
# green every night, and 230 of its 232 rows were filed under a 70-character
# fragment of a job ad. A scraper that returns garbage looks exactly like a
# scraper that works, right up until someone opens an agency card.
#
# The floor is deliberately far below what a healthy run produces (measured over
# the archive's own strings, prefix matching alone resolves ~57% of the distinct
# employer strings, and more by row because Defence and Finance advertise most)
# so ordinary variation in what the board is advertising cannot trip it. It is a
# collapse detector, not a quality target. MIN_SAMPLE keeps a genuinely quiet
# board — a long weekend, a short first page — from failing on three rows.
MIN_ATTRIBUTED_SHARE = 0.25
# Five, not twenty. Twenty was set from the archive's 232 stored rows without
# checking what one RUN actually returns — and measured on 2026-08-16 the board
# yields 15 vacancies, so the floor sat above the entire sample and the guard
# could never fire. It duly reported "attribution: 0/15 (0%)" and exited 0,
# which is precisely the silent-green failure it was added to end.
MIN_SAMPLE = 5


def main() -> int:
    if VIA_OXYLABS and not (os.environ.get('OXYLABS_USERNAME')
                            and os.environ.get('OXYLABS_PASSWORD')):
        sys.exit('--oxylabs needs OXYLABS_USERNAME / OXYLABS_PASSWORD.')
    sys.stderr.write(f'APS -> D1 via {"Oxylabs" if VIA_OXYLABS else "local browser"}: '
                     f'{len(AGENCY_NAMES)} federal agencies in roster; '
                     f'{"SOLVE (no D1 write)" if SOLVE else "archiving"}.\n')
    scraped = scrape_board(MAX_PAGES)

    sys.stderr.write(f'  scraped {len(scraped)} vacancies\n')
    if SOLVE:
        for r in scraped[:5]:
            sys.stderr.write(f'    · {r.get("t","")[:48]:48} | {r.get("agency","")[:32]}\n')
        ok = len(scraped) > 0
        sys.stderr.write(f'\n{"✓ Reachable — Aura JSON captured" if ok else "✗ No jobs captured (blocked or the Aura shape changed)"}.\n')
        return 0 if ok else 2

    if not scraped:
        sys.stderr.write('No vacancies captured — nothing to archive. (Run with --solve to inspect; check the [diag] line above.)\n')
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

    # Attribution health over EVERY vacancy read this run, not just the new rows:
    # on a quiet day almost everything is a re-seen ad, so a ratio over `kept`
    # alone would be computed from a handful of rows and swing wildly.
    seen_ids = [agency_to_id(r.get('agency') or '')[0] for r in scraped]
    named = sum(1 for c in seen_ids if c != 'aps-gov')
    share = named / len(seen_ids) if seen_ids else 0.0
    sys.stderr.write(f'  attribution: {named}/{len(seen_ids)} '
                     f'({share:.0%}) of scraped vacancies reached a named agency.\n')
    if len(seen_ids) >= MIN_SAMPLE and share < MIN_ATTRIBUTED_SHARE:
        sys.stderr.write(
            f'\n✗ Only {share:.0%} of {len(seen_ids)} vacancies could be attributed to an '
            f'agency (floor {MIN_ATTRIBUTED_SHARE:.0%}). The rows are archived, but almost all of '
            f'them are in the generic aps-gov bucket, so the agency cards will read empty. '
            f'This is what a changed board layout looks like — run with --solve and compare the '
            f'agency column against the live page.\n')
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
