#!/usr/bin/env python3
"""Reconnaissance for a jurisdiction's workforce data, run on a GitHub runner.

WHY A SCRIPT AND NOT A SEARCH. Three of the remaining jurisdictions — South
Australia, the Northern Territory and Tasmania — answer HTTP 403 to the
authoring sandbox on every candidate host, so nothing about them can be
established from there: not whether the data exists, not what shape it is in,
not whether the 403 is a datacentre block or a real refusal. This runs where a
browser is available and reports what each host actually gives.

It answers three questions per host, in order, because each only matters if the
one before it did:

  1. Does a plain request work? (then no browser is needed at all)
  2. Does a browser work? (then it is a bot check, like Queensland's)
  3. What spreadsheet links are on the page? (so a parser has something to aim
     at rather than being written against a guess)

Nothing is parsed and nothing is written. The pattern is the one that paid for
itself on Queensland: a parser written from a 14-row preview of a sheet nobody
had opened was wrong in twelve of twenty-eight rows.

    python3 scripts/gov-source-probe.py
"""
import re, sys, urllib.error, urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')

# Candidate landing pages, newest-looking first. These are where each
# jurisdiction's workforce report is published; the CKAN portals were checked
# first and carry nothing per agency (SA publishes agency-by-agency self
# reports, NT's portal has no workforce data at all, and Tasmania has no
# reachable open-data portal).
TARGETS = [
    # SOUTH AUSTRALIA. publicsector.sa.gov.au answers 200 to a plain request
    # from a runner (measured 2026-09-24) and 403 to the authoring sandbox, so
    # it is that network rather than the host. These are the two pages its nav
    # points at for per-agency figures.
    ('SA  Workforce Information',
     'https://publicsector.sa.gov.au/about/Resources-and-Publications/Workforce-Information'),
    ('SA  State of the Sector',
     'https://publicsector.sa.gov.au/about/Resources-and-Publications/State-of-the-Sector'),

    # NORTHERN TERRITORY. ocpe.nt.gov.au answers 403 to a plain request AND to
    # a browser, so the doorman is not a bot check. These are the other places
    # the State of the Service report is published.
    ('NT  OCPE publications', 'https://ocpe.nt.gov.au/publications'),
    ('NT  nt.gov.au search', 'https://nt.gov.au/search?q=state+of+the+service+report'),
    ('NT  Treasury/DCM open data', 'https://data.nt.gov.au/dataset?q=public+sector'),

    # TASMANIA. stateservice.tas.gov.au does not resolve — the domain is gone.
    # dpac.tas.gov.au answers 403 to both. These are the survivors.
    ('TAS DPAC root', 'https://www.dpac.tas.gov.au'),
    ('TAS SSMO', 'https://www.dpac.tas.gov.au/divisions/state-service-management-office'),
    ('TAS Treasury workforce', 'https://www.treasury.tas.gov.au/publications'),
]



def plain(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except Exception as e:                                        # noqa: BLE001
        return f'{type(e).__name__}', b''


def links(html):
    out = []
    for m in re.finditer(r'href="([^"]+\.(?:xlsx|xls|csv|pdf))(?:\?[^"]*)?"', html, re.I):
        out.append(m.group(1))
    for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.{0,120}?)</a>', html, re.S | re.I):
        t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.group(2))).strip()
        if re.search(r'workforce|state of the (service|sector)|employee|headcount|excel|spreadsheet',
                     t, re.I):
            out.append(f'{t[:52]}  ->  {m.group(1)[:90]}')
    return out


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(user_agent=UA, locale='en-AU')
        for label, url in TARGETS:
            print(f'\n===== {label} =====')
            print(f'  {url}')
            code, body = plain(url)
            print(f'  plain   : {code}{f" ({len(body)} bytes)" if body else ""}')
            html = body.decode('utf-8', 'replace') if body else ''
            if not html:
                try:
                    page = ctx.new_page()
                    r = page.goto(url, wait_until='domcontentloaded', timeout=60_000)
                    page.wait_for_timeout(2000)
                    html = page.content()
                    print(f'  browser : {r.status if r else "?"} ({len(html)} bytes)')
                    page.close()
                except Exception as e:                            # noqa: BLE001
                    print(f'  browser : FAILED {type(e).__name__}: {str(e).splitlines()[0][:90]}')
                    continue
            found = links(html)
            if not found:
                print('  links   : none that look like workforce data')
            for l in dict.fromkeys(found):
                print(f'  link    : {l[:130]}')
        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
