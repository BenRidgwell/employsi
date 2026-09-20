#!/usr/bin/env python3
"""Australian Catholic University's PageUp board → D1, with a real browser.

WHY THIS IS NOT A careerSites.ts FEED. careers.acu.edu.au/en/listing/ fingerprints
as PageUp's CLASSIC theme and answers a plain GET with 200 and 140 KB — and no
rows. Measured 2026-09-20: the `search-results-content` shell is there, and in it
are 0 `job-link` anchors, 0 hrefs containing /job/, and no "no results" text
either. Run through fetchPageUpClassic the board returns 0 roles.

That is the dangerous shape, not a harmless one. An in-Worker feed would have
written nothing, every night, while the card read as an employer with no
vacancies — the Mater failure, which is why fetchPageUpClassic learned to split
on two themes in the first place. The rows are injected client-side, so reading
them needs a browser, and a browser is what careerSites.ts fetchers never have.

WHAT IS UNVERIFIED HERE, AND SAID PLAINLY. The PARSER below is verified: run with
--from-file against Deakin, UTAS and Charles Sturt — three live classic-theme
boards that DO serve their rows — it reads the same counts as the TypeScript
reader does. The RENDER is not: this sandbox has no usable Chromium (no browser
binary for browser_fetch, and no trust in the agent proxy's CA), so the first
scheduled run is the first thing that can say whether ACU's hydrated markup is
the same shape. That is the Avant precedent, and it is why the workflow step is
allowed to fail without failing the run.

NO ROW COUNT IS CLAIMED for the same reason. An empty pull is never written, so
a zero costs a look and nothing else.

  python scripts/acu-to-d1.py --dry                 # render, parse, write nothing
  python scripts/acu-to-d1.py --capture captures    # keep the rendered html
  python scripts/acu-to-d1.py --from-file page.html # parse a saved page, no browser
"""
from __future__ import annotations
import html as htmlmod
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import browser_fetch  # noqa: E402
import portal_archive as pa  # noqa: E402

SOURCE = 'portal-pu'
BOARD = 'https://careers.acu.edu.au/en/listing/'
COMPANY_ID = 'uni-australian-catholic-university'
COMPANY = 'Australian Catholic University'
SECTOR = 'Education'
# ACU's largest campus is North Sydney and its registered office is there. A row
# that names no campus belongs there rather than nowhere.
HOME_HUB = 'sydney'

args = sys.argv[1:]
DRY = pa.flag(args, '--dry')
NO_SKILLS = pa.flag(args, '--no-skills')
CAPTURE = pa.opt(args, '--capture')
FROM_FILE = pa.opt(args, '--from-file')
MAX_PAGES = int(pa.opt(args, '--max-pages', 8) or 8)
# Seconds to let the board's own request for its rows finish before capturing.
# The shell arrives immediately and the table fills after, so capturing too early
# reproduces exactly the empty result this script exists to avoid.
SETTLE_S = 6


def clean(s: str) -> str:
    return ' '.join(htmlmod.unescape(re.sub(r'<[^>]+>', ' ', s or '')).split())


def location_column(page_html: str) -> int:
    """Which cell holds the location, read off the header.

    TWO THINGS THIS HAS TO SURVIVE, both measured on live boards and both of
    which put a CLOSING DATE in the location column when they were missed:

      A HEADER INSIDE A SCRIPT. Charles Sturt's page carries JavaScript that
      builds a table, so the literal "<thead>" and "<th>" appear in a <script>
      before the real header. Scripts are stripped first.

      A PREFIXED HEADER. ACU's column is "Campus Location", not "Location", so a
      startsWith test misses it and the positional fallback takes the last cell —
      which on this theme is `Closes`. A startsWith match is still preferred, so
      a tenant with both a plain "Location" and some other *location* column
      keeps the plain one.
    """
    no_scripts = re.sub(r'<script\b[\s\S]*?</script>', '', page_html, flags=re.I)
    head = re.split(r'<thead[^>]*>', no_scripts, flags=re.I)
    if len(head) < 2:
        return -1
    cells = [clean(c).lower() for c in
             re.split(r'<th[^>]*>', re.split(r'</thead>', head[1], flags=re.I)[0])[1:]]
    for test in (lambda h: h.startswith('location'), lambda h: 'location' in h):
        for i, h in enumerate(cells):
            if test(h):
                return i
    return -1


ROW_LINK = re.compile(
    r'<a[^>]*class="job-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', re.I)


def parse_page(page_html: str) -> list[dict]:
    """Rows from one classic-theme results page.

    Mirrors fetchPageUpClassic in workers/jobs-cron/careerSites.ts: the same two
    themes (a <tbody> of <tr>, or a <div> of .JobItemWP), the same header-driven
    location column, the same `job-link` anchor. Kept a separate implementation
    rather than shared because that one runs in a Worker and this one does not —
    but any fix to the column logic belongs in both, and the comment above says
    which measurements it has to keep passing.
    """
    parts = re.split(r'<(?:tbody|div) id="search-results-content">', page_html, flags=re.I)
    if len(parts) < 2:
        return []
    body = parts[1]
    is_div = bool(re.search(r'class="JobItemWP"', body, re.I))
    loc_col = location_column(page_html)
    out: list[dict] = []
    rows = (re.split(r'<div class="JobItemWP">', body, flags=re.I)[1:] if is_div
            else re.split(r'</tr>', body, flags=re.I))
    # DEDUPED BY HREF WITHIN THE PAGE, because this theme emits each job twice.
    # Measured 2026-09-20 against three live boards: without this the parser
    # returned exactly 2x the TypeScript reader's count every time — Deakin 32
    # against 16, UTAS 40 against 20, Charles Sturt 38 against 19. A doubled
    # count is not harmless here: job_key is title+company+location, so the pair
    # collapses on write and the archive looks right while every log line and
    # every completeness check this script prints reads double.
    seen_here: set[str] = set()
    for row in rows:
        m = ROW_LINK.search(row)
        if not m:
            continue
        title = clean(m.group(2))
        if not title:
            continue
        href = htmlmod.unescape(clean(m.group(1)))
        if href in seen_here:
            continue
        seen_here.add(href)
        if is_div:
            # The div theme LABELS its location rather than positioning it, and
            # has no <td> at all — a positional read here returns "".
            lm = (re.search(r'<span class="location">([\s\S]*?)</span>', row, re.I)
                  or re.search(r'<div class="JobLocationWP">([\s\S]*?)</div>', row, re.I))
            loc = clean(lm.group(1)) if lm else ''
        else:
            cells = [clean(c) for c in re.split(r'<td[^>]*>', row, flags=re.I)[1:]]
            loc = (cells[loc_col] if 0 <= loc_col < len(cells)
                   else (cells[-1] if cells else ''))
        out.append({
            'title': title,
            'url': href if href.startswith('http') else
                   'https://careers.acu.edu.au' + (href if href.startswith('/') else '/' + href),
            'location': loc,
            'category': 'Career portal',
            # The classic theme prints a CLOSING date and no opened one, as
            # Deakin's and Village Roadshow's do. Left empty rather than filled
            # with a date that means the opposite; the archive's own first_seen
            # carries the timing, and the upsert backfills posted if the board
            # ever starts printing one.
            'posted': '',
        })
    return out


def render(page: int) -> str | None:
    url = BOARD if page == 1 else f'{BOARD}?page={page}'
    return browser_fetch.render(url, [{'type': 'wait', 'wait_time_s': SETTLE_S}])


def main() -> int:
    if not DRY and not FROM_FILE and not pa.token():
        sys.exit('CLOUDFLARE_API_TOKEN is not set (needs D1 edit). Use --dry to skip the write.')

    jobs: list[dict] = []
    if FROM_FILE:
        # Parser-only path: no browser, no network, no write. This is how the
        # parser was checked against boards that serve their rows.
        rows = parse_page(open(FROM_FILE, encoding='utf-8', errors='replace').read())
        print(f'{FROM_FILE}: {len(rows)} rows')
        for r in rows[:5]:
            print(f'   {r["title"]}  |  {r["location"]}')
        return 0 if rows else 1

    seen: set[str] = set()
    for page in range(1, MAX_PAGES + 1):
        doc = render(page)
        if not doc:
            sys.stderr.write(f'  page {page}: the browser returned nothing\n')
            break
        if CAPTURE:
            os.makedirs(CAPTURE, exist_ok=True)
            with open(os.path.join(CAPTURE, f'acu-{page}.html'), 'w', encoding='utf-8') as fh:
                fh.write(doc)
        rows = [r for r in parse_page(doc) if r['url'] not in seen]
        if not rows:
            # END OF LIST, OR A CAPTURE THAT LANDED BEFORE THE ROWS ARRIVED —
            # and on this board those look identical, which is the whole reason
            # it is here. Page 1 returning nothing is reported as a failure
            # below; a later page is treated as the end of the walk.
            break
        seen.update(r['url'] for r in rows)
        jobs += rows
        print(f'  page {page}: {len(rows)} rows ({len(jobs)} so far)')

    if not jobs:
        sys.stderr.write(
            'ACU: the rendered board produced no rows. That is the expected failure here — '
            'the rows are client-side, so either the render did not settle (raise SETTLE_S) '
            'or the markup changed. It is NOT a statement that ACU has no vacancies.\n')
        return 1

    written, deduped = pa.archive(
        jobs, source=SOURCE, company_id=COMPANY_ID, company=COMPANY, sector=SECTOR,
        home_hub=HOME_HUB, skills=not NO_SKILLS, dry=DRY)
    print(f'collected {len(jobs)} listings, {deduped} distinct, '
          f'{"would write" if DRY else "wrote"} {written if not DRY else deduped}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
