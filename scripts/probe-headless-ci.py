#!/usr/bin/env python3
"""
Does a headless browser on a PLAIN CI address get these boards, or do they need
the residential IP too?

WHY THIS EXISTS
Four feeds go through Oxylabs with `render=True` plus browser instructions:
Stockland, Dyno Nobel and Sandfire (SAP SuccessFactors RCM) and Whitehaven
(Dayforce). Probed from a datacentre address they all return 200 and a
full-looking page — and ZERO rows under their own row regex, because the results
arrive from a later `juic.fire(…,"_next")` / Ant render rather than in the
served HTML.

That proves they need a BROWSER. It does not say whether they also need the
residential IP, and the difference decides how much of the Oxylabs bill a
self-hosted Playwright could remove on its own. The shell loading tells you
nothing either way, so the only way to settle it is to run a real headless
browser from an ordinary GitHub runner and count what comes back.

WHAT IT DOES
Drives Chromium through the same sequence the Oxylabs `browser_instructions`
describe — load, settle, and for the paged check, click through — then applies
each scraper's OWN row regex to the resulting DOM. Reusing the real regex is the
point: a bespoke "did it look right" check would pass on a page the actual
scraper cannot read.

Verdict per board:
    ROWS       rows found — a browser alone is enough, no residential IP needed
    NO ROWS    browser ran, page loaded, no rows — needs more than a browser
    BLOCKED    never got a usable page at all

Run: python3 scripts/probe-headless-ci.py [--headful] [--json out.json]
Needs: pip install playwright && playwright install chromium
"""
from __future__ import annotations
import json
import re
import sys
import traceback

# ── the four boards, with the settle/click behaviour their scrapers ask for ───
# `rows` is copied verbatim from each scraper so this measures the same thing
# the nightly run measures.
SF_ROWS = r'<tr class="jobResultItem">'
SF_TITLE = r'<a class="jobTitle"[^>]*href="[^"]*career_job_req_id=\d+'

BOARDS = [
    {
        'name': 'Stockland (SuccessFactors)',
        'script': 'scripts/stockland-to-d1.py',
        'url': ('https://career10.successfactors.com/career?company=stocklanddP2'
                '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH'),
        'settle': 6,
        'rows': SF_ROWS,
        'title': SF_TITLE,
        # The scrapers page by clicking this; we only need page 1 to answer the
        # question, but the selector is recorded so a follow-up can use it.
        'next': 'a.paginationItemLast, a[title="Next"]',
    },
    {
        'name': 'Dyno Nobel (SuccessFactors)',
        'script': 'scripts/dyno-to-d1.py',
        'url': ('https://career4.successfactors.com/career?company=IncitecPivot'
                '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH'
                '&rcm_site_locale=en_GB'),
        'settle': 8,
        'rows': SF_ROWS,
        'title': SF_TITLE,
        'next': 'a.paginationItemLast, a[title="Next"]',
    },
    {
        'name': 'Sandfire (SuccessFactors EU)',
        'script': 'scripts/sandfire-to-d1.py',
        'url': ('https://career55.sapsf.eu/career?company=minasdeagu'
                '&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH'
                '&rcm_site_locale=en_GB'),
        'settle': 8,
        'rows': SF_ROWS,
        'title': SF_TITLE,
        'next': 'a.paginationItemLast, a[title="Next"]',
    },
    {
        'name': 'Whitehaven (Dayforce)',
        'script': 'scripts/whitehaven-dayforce-to-d1.py',
        'url': 'https://jobs.dayforcehcm.com/en-AU/whitehavencoal/CANDIDATEPORTAL',
        'settle': 8,
        'rows': r'test-id="job-posting-card"',
        'title': r'test-id="job-title"',
        'next': '.ant-pagination-item-2 a',
    },
]

# A challenge page is not a board. Counting rows on one would report NO ROWS,
# which is the wrong diagnosis — "blocked" and "rendered but empty" need
# different fixes, so they are told apart explicitly.
#
# These are matched ONLY when the page yielded no rows. The first run of this
# probe reported "[Akamai deny]" against all three SuccessFactors boards and
# "[captcha / challenge]" against Dayforce while simultaneously finding 10, 10,
# 6 and 25 rows — the strings live in the pages' own JavaScript (error handling,
# an application-form captcha widget), not in a block page. Searching a fully
# rendered application for the words a block page uses will always find them
# somewhere. A block is a diagnosis for an EMPTY result, not an independent
# signal, so it is only asked about when there is an emptiness to explain.
BLOCK_MARKERS = [
    (r'Just a moment', 'Cloudflare interstitial'),
    (r'Access Denied', 'Akamai deny'),
    (r'captcha|challenge-platform', 'captcha / challenge'),
    (r'Request unsuccessful|Incapsula', 'Imperva'),
    (r'Pardon Our Interruption', 'DataDome'),
]

args = sys.argv[1:]
HEADFUL = '--headful' in args
OUT = args[args.index('--json') + 1] if '--json' in args else None


def blocked_as(html: str) -> str | None:
    for pat, label in BLOCK_MARKERS:
        if re.search(pat, html, re.I):
            return label
    return None


def probe(pw, board: dict) -> dict:
    res = {'name': board['name'], 'script': board['script'], 'url': board['url']}
    browser = pw.chromium.launch(headless=not HEADFUL)
    try:
        ctx = browser.new_context(
            user_agent=('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/126.0.0.0 Safari/537.36'),
            viewport={'width': 1440, 'height': 900},
            locale='en-AU',
        )
        page = ctx.new_page()
        r = page.goto(board['url'], wait_until='domcontentloaded', timeout=90_000)
        res['status'] = r.status if r else None
        # The settle wait is what the Oxylabs instruction list does: these boards
        # fetch their rows AFTER load, so reading the DOM immediately is the same
        # mistake as reading the served HTML.
        page.wait_for_timeout(board['settle'] * 1000)
        html = page.content()
        res['bytes'] = len(html)
        res['rows'] = len(re.findall(board['rows'], html))
        res['titles'] = len(re.findall(board['title'], html))
        # Only when there is an emptiness to explain — see BLOCK_MARKERS.
        res['blocked_as'] = None if res['rows'] else blocked_as(html)

        # One paging click, to show the interaction the nightly run depends on
        # also works — a board that renders page 1 but refuses to page is only
        # half solved.
        res['page2_rows'] = None
        if res['rows']:
            try:
                el = page.query_selector(board['next'])
                if el:
                    el.click()
                    page.wait_for_timeout(board['settle'] * 1000)
                    res['page2_rows'] = len(re.findall(board['rows'], page.content()))
            except Exception as e:  # noqa: BLE001
                res['page2_error'] = str(e)[:120]
        ctx.close()
    except Exception as e:  # noqa: BLE001
        res['error'] = str(e)[:200]
        res['rows'] = 0
    finally:
        browser.close()

    if res.get('rows'):
        res['verdict'] = 'ROWS'
    elif res.get('blocked_as') or res.get('error'):
        res['verdict'] = 'BLOCKED'
    else:
        res['verdict'] = 'NO ROWS'
    return res


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('playwright not installed: pip install playwright && playwright install chromium')

    print('Headless Chromium from this runner, against the four render-gated boards.')
    print('Counting rows with each scraper\'s OWN regex.\n')
    out = []
    with sync_playwright() as pw:
        for b in BOARDS:
            try:
                r = probe(pw, b)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                r = {'name': b['name'], 'verdict': 'BLOCKED', 'error': 'probe crashed'}
            out.append(r)
            print(f"  {r['name']:32} {r['verdict']:8} "
                  f"status={r.get('status')} bytes={r.get('bytes')} "
                  f"rows={r.get('rows')} titles={r.get('titles')}"
                  + (f" page2_rows={r['page2_rows']}" if r.get('page2_rows') is not None else '')
                  + (f"  [{r['blocked_as']}]" if r.get('blocked_as') else '')
                  + (f"  err={r['error']}" if r.get('error') else ''))

    got = [r for r in out if r['verdict'] == 'ROWS']
    print(f"\n{len(got)} of {len(out)} boards returned rows to a headless browser "
          f"on a plain CI address.")
    if len(got) == len(out):
        print('=> A self-hosted Playwright would replace Oxylabs for all four. '
              'No residential IP needed.')
    elif got:
        print('=> Mixed: ' + ', '.join(r['name'] for r in got) + ' need only a browser; '
              'the rest need more.')
    else:
        print('=> None. These need the residential IP as well as the browser, '
              'so they stay on a proxy.')

    if OUT:
        with open(OUT, 'w') as f:
            json.dump(out, f, indent=2)
        print(f'wrote {OUT}')
    # Always exit 0: this is a measurement, and "they are blocked" is a real
    # result rather than a failure of the probe.
    return 0


if __name__ == '__main__':
    sys.exit(main())
