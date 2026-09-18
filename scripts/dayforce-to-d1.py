#!/usr/bin/env python3
"""Dayforce candidate portals → the D1 job archive.

ONE DRIVER, A TABLE OF TENANTS. Dayforce serves every employer from the same
app at jobs.dayforcehcm.com/<locale>/<tenant>/<site>, so the walk and the parser
are identical and only the tenant and the roster company change. Uniting was
written first and EVT arrived a day later; a second copy of a 200-line walk is
how the two then drift apart, so the differences live in PORTALS below and
nothing else is duplicated.

(scripts/whitehaven-dayforce-to-d1.py is the same board type and predates this.
It still runs its own copy and could move here unchanged; it is left alone
rather than rewritten while it is working.)

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
The same wall Whitehaven's Dayforce board hit, re-measured on BOTH tenants
2026-09-18. The portal is a client-rendered app whose served HTML carries no
vacancies at all — 494 KB for Uniting and 472 KB for EVT, zero job cards in
either — and the list it fetches after hydration comes from

    POST https://jobs.dayforcehcm.com/api/geo/<tenant>/jobposting/search

which answers a plain server request with a bare 403 "Forbidden", with a browser
User-Agent and the portal's own Origin and Referer attached. Measured on both
tenants, so it is the platform and not one customer's setting. That is
Cloudflare bot management refusing a datacentre address, and a Cloudflare Worker
fares WORSE rather than better on a Cloudflare-to-Cloudflare fingerprint.

So the portal is RENDERED rather than called, exactly as
scripts/whitehaven-dayforce-to-d1.py does it, through a local headless Chromium
on an ordinary CI address. `--oxylabs` hands the same instruction list to the
Web Scraper API instead, for the day the plain address stops being enough.

DAYFORCE'S MARKUP IS PRODUCT-WIDE, NOT PER-TENANT — the `test-id` attributes
below are the ones the Whitehaven board serves — but that is a starting point
and not a measurement of THIS tenant, which is why `--capture` exists: it writes
the rendered document out so the selectors can be checked against the real
thing rather than believed. The first run of this feed was a capture.

PAGING is an Ant Design paginator with no URL parameter, so it is clicked. The
`ant-pagination-item-N` entries in the rendered page are the board's own
statement of how many pages there are; it prints no total anywhere else, so that
count is what bounds the walk.

CLICK `next`, NOT THE NUMBER — and this is the correction that matters, because
the obvious version was written first and silently lost a quarter of the board.
Whitehaven's feed clicks `.ant-pagination-item-N` directly, which is fine there:
its paginator is short enough to render every number. Uniting's is not. Measured
on the first CI run (2026-09-18), page 1 renders items [1, 2, 3, 4, 5, 8] — SIX
AND SEVEN ARE BEHIND THE ELLIPSIS AND DO NOT EXIST IN THE DOM — so those two
clicks could never land, and the walk collected pages 1-5 and 8: 140 roles of
the board's 190. It reported that as a successful run.

`.ant-pagination-next` is always present and always advances one page, so the
walk steps through the board one click at a time.

ONE BROWSER CONTEXT, HELD OPEN. The first fix rendered the portal afresh for
each page and clicked `next` N-1 times to get back to where it already was:
O(N^2) loads of a hydrated 700 KB app. Measured 2026-09-18 it DID work — 8
pages, 190 listings, 176 distinct, in 3m47s — so this is a scaling change and
not a repair. Eight pages cost 8 loads and 28 clicks that way; they cost one
load and 7 clicks this way, and the gap widens as the square of the page count.
That is what browser_fetch.Session.act exists for.

(An earlier version of this comment said the O(N^2) walk did not finish inside
the CI job. That was wrong — read off a GitHub API response that was serving a
stale in_progress status for a run that had already succeeded. The run is
35297576486 and its log is the measurement above.)

`--oxylabs` cannot do this: the Web Scraper API takes an instruction list and
hands back one document, with no session to hold. That path therefore keeps the
per-page form and stays O(N^2) — acceptable for an escape hatch that is not the
daily route, and stated here so nobody measures it and concludes the session
walk is slow.

AND THE LANDING IS VERIFIED. The paginator marks the current page
`<li title="N" class="… ant-pagination-item-active">`, so the walk reads back
where it actually is and refuses to file a page it did not reach. A click that
silently fails otherwise re-parses the page it is already on, and the archive's
dedup turns that into "fewer roles" rather than into an error. In a session walk
a failed click is worse than in a per-page one — every later page is off by one
— so the walk STOPS at the first page it cannot confirm rather than carrying on
and filing wrong pages under right numbers.

A RUN THAT FINDS NO CARDS EXITS NON-ZERO. An empty capture and a board with
nothing on it look identical, and both these employers advertise constantly —
the scraper-gap report had Uniting at 988 ads held and EVT at 826 — so zero is a
failure here, not a quiet day.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME / OXYLABS_PASSWORD (only with --oxylabs)
Run: python scripts/dayforce-to-d1.py --portal uniting|evt
                                      [--dry-run] [--max-pages N]
                                      [--capture DIR] [--oxylabs]
"""
from __future__ import annotations
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import browser_fetch  # noqa: E402
import portal_archive as pa  # noqa: E402

SOURCE = 'portal-dayforce'

# Tenant + roster company. `portal` is the candidate site, `tenant` only appears
# in the search API this driver deliberately does not use (it 403s) and is kept
# because it is what a future reader will check first.
PORTALS = {
    'uniting': {
        'portal': 'https://jobs.dayforcehcm.com/en-AU/unitingaunsw/UNITINGCCS',
        'tenant': 'unitingaunsw',
        'company_id': 'priv-uniting',
        'company': 'Uniting',
        'sector': 'Aged & community care',
        'home_hub': 'sydney',
    },
    'evt': {
        'portal': 'https://jobs.dayforcehcm.com/en-AU/evtelevate/EVT',
        'tenant': 'evtelevate',
        'company_id': 'sydney-evt',
        'company': 'EVT',
        # Hotels (Rydges, QT, Atura), cinemas (Event, Moonlight) and Thredbo.
        # The roster files EVT under Technology, Media & Telecom because of the
        # cinema arm; the sector string here feeds the SKILLS matcher, so it
        # names the work rather than the listing classification.
        'sector': 'Hospitality & entertainment',
        'home_hub': 'sydney',
    },
}

args = sys.argv[1:]
PORTAL_KEY = pa.opt(args, '--portal')
if PORTAL_KEY not in PORTALS:
    sys.exit(f'--portal must be one of: {", ".join(sorted(PORTALS))}')
CFG = PORTALS[PORTAL_KEY]
PORTAL = CFG['portal']
COMPANY_ID, COMPANY = CFG['company_id'], CFG['company']
SECTOR, HOME_HUB = CFG['sector'], CFG['home_hub']

DRY = pa.flag(args, '--dry-run') or pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
VIA_OXYLABS = pa.flag(args, '--oxylabs')
MAX_PAGES = int(pa.opt(args, '--max-pages', 0) or 0)
CAPTURE = pa.opt(args, '--capture')

# Seconds to let the portal hydrate and fetch its list before capturing, and
# again after each page click. Whitehaven's board settles inside eight on every
# capture taken while that feed was built; the failure mode if it is not enough
# is an empty card list, which main() turns into a red run rather than a zero.
SETTLE_S = 8
CLICK_SETTLE_S = 5

CARD_RE = re.compile(
    r'test-id="job-posting-card"\s+job-posting-id="(\d+)"(.*?)(?=test-id="job-posting-card"|$)', re.S)
TITLE_RE = re.compile(r'test-id="job-title"[^>]*>(.*?)</h2>', re.S)
LOC_RE = re.compile(r'test-id="job-location"[^>]*>(.*?)</div>', re.S)
POSTED_RE = re.compile(r'test-id="job-posted-date-expiry"[^>]*>(.*?)</div>', re.S)
PAGE_ITEM_RE = re.compile(r'class="ant-pagination-item ant-pagination-item-(\d+)')
ACTIVE_RE = re.compile(r'<li title="(\d+)" class="[^"]*ant-pagination-item-active')

MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
     'september', 'october', 'november', 'december'])}


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def posted_iso(text: str) -> str:
    """"Posted Monday 3 August 2026 | Expires …" -> 2026-08-03.

    Only the POSTED half is read. The string carries an expiry date too, and
    letting that reach the archive's `posted` column is the exact confusion
    jobs_extract.iso_date exists to prevent.
    """
    m = re.search(r'Posted\s+\w+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', text or '')
    if not m:
        return ''
    mon = MONTHS.get(m.group(2).lower())
    return f'{m.group(3)}-{mon:02d}-{int(m.group(1)):02d}' if mon else ''


def active_page(doc: str) -> int | None:
    """Which page the rendered paginator says it is on."""
    m = ACTIVE_RE.search(doc or '')
    return int(m.group(1)) if m else None


# One click of the pager, then long enough for the card list to re-render in
# place. Shorter than the initial settle: this is not a page load with hydration
# behind it.
NEXT_STEP: list[dict] = [
    {'type': 'click', 'selector': {'type': 'css', 'value': '.ant-pagination-next'}},
    {'type': 'wait', 'wait_time_s': CLICK_SETTLE_S},
]


def render_oxylabs(page: int) -> str | None:
    """The escape hatch: one rendered document per page, O(N^2) over the walk.

    See the header — the Web Scraper API has no session to hold, so reaching
    page N means replaying the whole click chain from a fresh load."""
    from oxylabs_client import fetch as oxy_fetch
    instructions: list[dict] = [{'type': 'wait', 'wait_time_s': SETTLE_S}]
    for _ in range(page - 1):
        instructions += NEXT_STEP
    content, _ = oxy_fetch(PORTAL, geo='Australia', render=True,
                           extra={'browser_instructions': instructions}, timeout=300)
    return content


def parse_page(doc: str) -> tuple[list[dict], int]:
    """(rows, pages the paginator advertises)."""
    out = []
    for jid, block in CARD_RE.findall(doc or ''):
        t = TITLE_RE.search(block)
        if not t:
            continue
        title = clean(t.group(1))
        if not title:
            continue
        loc = LOC_RE.search(block)
        pos = POSTED_RE.search(block)
        out.append({
            'title': title,
            'location': clean(loc.group(1)) if loc else '',
            'url': f'{PORTAL}/jobs/{jid}',
            'posted': posted_iso(clean(pos.group(1))) if pos else '',
        })
    pages = [int(n) for n in PAGE_ITEM_RE.findall(doc or '')]
    return out, max(pages) if pages else 1


def capture(doc: str, page: int) -> None:
    if not CAPTURE or not doc:
        return
    os.makedirs(CAPTURE, exist_ok=True)
    path = os.path.join(CAPTURE, f'{PORTAL_KEY}-page{page}.html')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(doc)
    print(f'  captured {len(doc)} bytes -> {path}')


def walk(next_page) -> tuple[list[dict], list[int], int]:
    """Read the board. `next_page(p)` returns page p's HTML, or None.

    Returns (rows, pages advertised but not collected, pages advertised).
    """
    first = next_page(1)
    capture(first, 1)
    jobs, pages = parse_page(first)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'{COMPANY} Dayforce: page 1 has {len(jobs)} roles, paginator advertises {pages} pages')

    missed: list[int] = []
    for p in range(2, pages + 1):
        doc = next_page(p)
        capture(doc, p)
        landed = active_page(doc)
        got, _ = parse_page(doc)
        if landed != p or not got:
            why = (f'paginator reports page {landed}' if landed != p else 'no cards')
            sys.stderr.write(f'  page {p}: {why} — not filed, stopping the walk\n')
            # STOP, do not continue. In a session walk the pager's position is
            # the walk's only state: once a click has failed we are on an
            # unknown page, and every later read would file the wrong rows under
            # the right page number. The remaining pages are reported as missed.
            missed = list(range(p, pages + 1))
            break
        jobs += got
        print(f'  page {p}/{pages}: {len(jobs)} roles so far')
    return jobs, missed, pages


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

    if VIA_OXYLABS:
        jobs, missed, pages = walk(render_oxylabs)
    else:
        # ONE context for the whole walk — see the header. `html()` loads the
        # board; every page after that is a click on the page already open.
        with browser_fetch.Session(timeout_s=90) as session:
            jobs, missed, pages = walk(
                lambda p: (session.html(PORTAL, [{'type': 'wait', 'wait_time_s': SETTLE_S}])
                           if p == 1 else session.act(NEXT_STEP)))

    if not jobs:
        # See the header: both these employers advertise constantly, so an
        # empty walk is a broken render, not an empty board.
        sys.stderr.write(f'{COMPANY}: no job cards in the rendered portal — '
                         'selectors or render settled time need re-measuring\n')
        return 1

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} listings from {pages - len(missed)}/{pages} pages, '
          f'{deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    if missed:
        # Rows are written first — a partial board is better than none — but the
        # run goes red, because "8 pages advertised, 6 collected" is exactly the
        # shape of failure that otherwise passes for a quiet week.
        sys.stderr.write(f'pages advertised but not collected: {missed}\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
