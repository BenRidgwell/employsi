#!/usr/bin/env python3
"""Uniting's Dayforce candidate portal → the D1 job archive.

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
The same wall Whitehaven's Dayforce board hit, re-measured on this tenant
2026-09-18. The portal is a client-rendered app whose served HTML carries no
vacancies at all — 494 KB with zero job links — and the list it fetches after
hydration comes from

    POST https://jobs.dayforcehcm.com/api/geo/unitingaunsw/jobposting/search

which answers a plain server request with a bare 403 "Forbidden", with a browser
User-Agent and the portal's own Origin and Referer attached. That is Cloudflare
bot management refusing a datacentre address, and a Cloudflare Worker fares
WORSE rather than better on a Cloudflare-to-Cloudflare fingerprint.

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

A RUN THAT FINDS NO CARDS EXITS NON-ZERO. An empty capture and a board with
nothing on it look identical, and Uniting advertises constantly — the
scraper-gap report had it at 988 ads held — so zero is a failure here, not a
quiet day.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID,
     OXYLABS_USERNAME / OXYLABS_PASSWORD (only with --oxylabs)
Run: python scripts/uniting-dayforce-to-d1.py [--dry-run] [--max-pages N]
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
COMPANY_ID = 'priv-uniting'
COMPANY = 'Uniting'
SECTOR = 'Aged & community care'
HOME_HUB = 'sydney'
PORTAL = 'https://jobs.dayforcehcm.com/en-AU/unitingaunsw/UNITINGCCS'

args = sys.argv[1:]
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

CARD_RE = re.compile(
    r'test-id="job-posting-card"\s+job-posting-id="(\d+)"(.*?)(?=test-id="job-posting-card"|$)', re.S)
TITLE_RE = re.compile(r'test-id="job-title"[^>]*>(.*?)</h2>', re.S)
LOC_RE = re.compile(r'test-id="job-location"[^>]*>(.*?)</div>', re.S)
POSTED_RE = re.compile(r'test-id="job-posted-date-expiry"[^>]*>(.*?)</div>', re.S)
PAGE_ITEM_RE = re.compile(r'class="ant-pagination-item ant-pagination-item-(\d+)')

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


def render(page: int) -> str | None:
    """Render the portal and click through to `page` (1-based)."""
    instructions: list[dict] = [{'type': 'wait', 'wait_time_s': SETTLE_S}]
    if page > 1:
        # Click the numbered page rather than "next" repeatedly: Ant renders the
        # numbers as real anchors, and one click is one fewer render step to go
        # wrong than N-1 chained ones.
        instructions.append({
            'type': 'click',
            'selector': {'type': 'css', 'value': f'.ant-pagination-item-{page} a'},
        })
        instructions.append({'type': 'wait', 'wait_time_s': SETTLE_S})
    if VIA_OXYLABS:
        from oxylabs_client import fetch as oxy_fetch
        content, _ = oxy_fetch(PORTAL, geo='Australia', render=True,
                               extra={'browser_instructions': instructions}, timeout=300)
        return content
    return browser_fetch.render(PORTAL, instructions)


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
    path = os.path.join(CAPTURE, f'uniting-page{page}.html')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(doc)
    print(f'  captured {len(doc)} bytes -> {path}')


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit). Use --dry-run to skip the write.')

    first = render(1)
    capture(first, 1)
    jobs, pages = parse_page(first)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'Uniting Dayforce: page 1 has {len(jobs)} roles, paginator advertises {pages} pages')

    for p in range(2, pages + 1):
        doc = render(p)
        capture(doc, p)
        got, _ = parse_page(doc)
        if not got:
            sys.stderr.write(f'  page {p}: no cards\n')
            continue
        jobs += got
        print(f'  page {p}/{pages}: {len(jobs)} roles so far')

    if not jobs:
        # See the header: Uniting advertises constantly, so an empty walk is a
        # broken render, not an empty board.
        sys.stderr.write('Uniting: no job cards in the rendered portal — '
                         'selectors or render settled time need re-measuring\n')
        return 1

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} listings, {deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
