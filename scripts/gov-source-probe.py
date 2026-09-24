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
    # ── Northern Territory and Tasmania ────────────────────────────────────
    # BOTH WERE RECORDED AS UNREACHABLE AND NEITHER IS. Measured from the
    # sandbox 2026-09-24, both answer HTTP 403 with `cf-mitigated: challenge`,
    # `server: cloudflare` and a 5.5 KB "Just a moment..." body. That is a
    # Cloudflare JavaScript challenge — the same KIND of doorman as
    # Queensland's AWS WAF, not an IP block and not a dead domain. The notes
    # this file used to carry ("the NT refuses a browser as well as a plain
    # request", "Tasmania's State Service domain no longer resolves") are both
    # wrong: dpac.tas.gov.au resolves and answers, it just refuses a script.
    #
    # So the question is no longer "is it reachable" but "does a real browser
    # clear it", which only a runner can answer.
    ('NT OCPE root', 'https://ocpe.nt.gov.au/'),
    ('NT gov root', 'https://nt.gov.au/'),
    # The NT publishes an annual workforce profile through the Office of the
    # Commissioner for Public Employment; the path is a guess and the root is
    # what settles it, so the root goes first. data.nt.gov.au is NOT here: it
    # is reachable (200) and was searched from the sandbox — three hits for
    # "workforce", none of them staffing.
    ('NT workforce page', 'https://ocpe.nt.gov.au/nt-public-sector/workforce-data'),

    ('TAS DPAC root', 'https://www.dpac.tas.gov.au/'),
    ('TAS State Service', 'https://www.dpac.tas.gov.au/divisions/state-service-management-office'),
    # Tasmanian Treasury answers 200 to a plain request, unlike every other
    # tas.gov.au host tried, and the Budget Papers carry agency FTE. Worth
    # knowing whether the data is reachable there even if DPAC stays shut.
    ('TAS Treasury', 'https://www.treasury.tas.gov.au/'),
    ('TAS Budget', 'https://www.treasury.tas.gov.au/budget-and-financial-management/budget'),
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
            plain_html = body.decode('utf-8', 'replace') if body else ''
            print(f'  plain   : {code}'
                  f'{f" ({len(body)} bytes, {len(links(plain_html))} links)" if body else ""}')
            # ALWAYS render, even on a 200. A single-page app answers 200 with
            # a shell and draws its links afterwards, so a plain fetch that
            # "worked" can still report nothing for a page full of reports.
            html = ''
            if True:
                try:
                    page = ctx.new_page()
                    r = page.goto(url, wait_until='domcontentloaded', timeout=60_000)
                    page.wait_for_timeout(2000)
                    html = page.content()
                    # A CLOUDFLARE CHALLENGE NEEDS LONGER THAN A PAGE LOAD.
                    # "Just a moment..." is the interstitial, not the site;
                    # reading content() at two seconds captures the doorman and
                    # reports a reachable host as having no links on it. Give
                    # it up to thirty seconds to hand over, and say which it
                    # was rather than leaving a 5 KB body looking like a site.
                    waited = 0
                    while 'Just a moment' in html and waited < 30_000:
                        page.wait_for_timeout(3000)
                        waited += 3000
                        html = page.content()
                    if 'Just a moment' in html:
                        print(f'  browser : STILL CHALLENGED after {waited / 1000:.0f}s '
                              f'({len(html)} bytes) — a browser alone does not clear this')
                        page.close()
                        continue
                    if waited:
                        print(f'  browser : cleared a Cloudflare challenge in {waited / 1000:.0f}s')
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
