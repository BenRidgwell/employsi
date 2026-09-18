#!/usr/bin/env python3
"""Compass Group Australia's PageUp board → the D1 job archive.

WHY THIS IS NOT IN workers/jobs-cron/careerSites.ts
A bot quota, and the way it fails is the whole reason this file has a header.
The board is server-rendered and needs no browser — a plain GET returns 374 KB
with 20 job cards. Then it stops. Measured 2026-09-18: the first requests from a
fresh address were served normally, and after a few dozen EVERY request came
back HTTP 202 with a 2.4 KB bot-check stub — twelve for twelve, with identical
headers, no 429 and no Retry-After.

202 IS THE DANGEROUS PART. It is a 2xx, so every "did the request succeed?" test
in this repo says yes; the stub then parses to zero job cards, the walk treats
that as the end of the list, and the feed reports an employer with no vacancies.
It is why getText in careerSites.ts now treats 202 as a retry rather than as
content, and why this driver checks the status explicitly instead of trusting
the parse.

A 33-page walk from a Cloudflare Worker would spend its allowance immediately
and on every tick. A GitHub runner is a different address with a fresh one, once
a day — which is the same reasoning that put the uniroles walk here.

THE BOARD, measured before this parser was written:

    GET https://careers.compass-group.com.au/jobs/search?page=N
    20 <article> cards a page, and a footer reading
    "Displaying <b>1&nbsp;-&nbsp;20</b> of <b>644</b> in total"

The walk is bounded by that advertised total, not by a short page: a challenged
page and the end of the list both look like zero cards, and this repo has been
truncated by that confusion twice.

COMPASS GROUP plc IS PLOTTED ON LONDON and this is its AUSTRALIAN arm. The roles
are genuinely Compass Group's and the hub matcher places them in Australian
cities, so this is a real feed and a partial view of a global employer rather
than a wrong one. A UK or global board would be a second feed, not a replacement.

Env: CLOUDFLARE_API_TOKEN (D1 edit), CF_ACCOUNT_ID, D1_DATABASE_ID
Run: python scripts/compass-to-d1.py [--dry] [--max-pages N] [--no-skills]
"""
from __future__ import annotations
import html as htmllib
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import portal_archive as pa  # noqa: E402

# `portal-pu`, matching SOURCE_TAG.pageupsites in careerSites.ts — beside Qube's
# rows rather than a per-employer source.
SOURCE = 'portal-pu'
COMPANY_ID = 'london-cpg'
COMPANY = 'Compass Group'
SECTOR = 'Food & support services'
HOME_HUB = 'sydney'   # the AU arm; London would misplace every unmatched role
BOARD = 'https://careers.compass-group.com.au/jobs/search'
PER_PAGE = 20         # the board's own page size
PAUSE_S = 1.5         # unhurried on purpose: the allowance is what breaks first

args = sys.argv[1:]
DRY = pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
MAX_PAGES = int(pa.opt(args, '--max-pages', 0) or 0)

TOTAL_RE = re.compile(r'of\s*<b>\s*([\d,]+)\s*</b>\s*in total', re.I)
TITLE_RE = re.compile(
    r'job-search-results-card-title"?>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S | re.I)


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def field(card: str, name: str) -> str:
    m = re.search(rf'job-component-{name}"[\s\S]*?<span[^>]*>([\s\S]*?)</span>', card, re.I)
    return clean(m.group(1)) if m else ''


def fetch(page: int) -> tuple[str | None, int]:
    """(html, status). A 202 is returned as (None, 202) so the caller can say so."""
    req = urllib.request.Request(f'{BOARD}?page={page}', headers={
        'User-Agent': pa.UA,
        'Accept': 'text/html,application/xhtml+xml',
    })
    last = 0
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                last = r.status
                body = r.read().decode('utf-8', 'replace')
                # See the header: 202 is the bot check, and it is a 2xx.
                if r.status == 202 or 'job-search-results-card-title' not in body:
                    time.sleep((attempt + 1) * 3)
                    continue
                return body, r.status
        except urllib.error.HTTPError as e:
            last = e.code
            time.sleep((attempt + 1) * 2)
        except Exception:  # noqa: BLE001
            time.sleep((attempt + 1) * 2)
    return None, last


def rows_from(doc: str) -> list[dict]:
    out = []
    for card in re.split(r'<article\b', doc)[1:]:
        m = TITLE_RE.search(card)
        if not m:
            continue
        title = clean(m.group(2))
        if not title:
            continue
        opening = field(card, 'opening-on').replace('Opening on:', '').strip()
        out.append({
            'title': title,
            'location': field(card, 'location'),
            'url': clean(m.group(1)),
            'posted': opening or pa.TODAY,
        })
    return out


def main() -> int:
    if not DRY and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is not set (needs D1 edit). Use --dry to skip the write.')

    first, status = fetch(1)
    if not first:
        # Loud and specific: this is the expected failure for this board, and
        # "no roles" must never be how it is reported.
        sys.stderr.write(
            f'Compass: page 1 never returned job cards (last status {status}). '
            'A 202 here is the bot check — this runner address has spent its allowance.\n')
        return 1

    m = TOTAL_RE.search(first)
    total = int(m.group(1).replace(',', '')) if m else 0
    if not total:
        sys.stderr.write('Compass: the board printed no "in total" count — markup changed?\n')
        return 1

    pages = -(-total // PER_PAGE)
    if MAX_PAGES:
        pages = min(pages, MAX_PAGES)
    print(f'Compass Group AU: {total} roles advertised, {pages} pages of {PER_PAGE}')

    jobs = rows_from(first)
    missed = []
    for p in range(2, pages + 1):
        time.sleep(PAUSE_S)
        doc, st = fetch(p)
        if not doc:
            missed.append((p, st))
            continue
        jobs += rows_from(doc)
        if p % 10 == 0:
            print(f'  page {p}/{pages}: {len(jobs)} roles so far')

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} listings, {deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    if missed:
        sys.stderr.write(f'pages that never returned cards (page, last status): {missed}\n')

    if not MAX_PAGES and len(jobs) < total * 0.9:
        sys.stderr.write(f'collected {len(jobs)} of {total} advertised — walk is incomplete\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
