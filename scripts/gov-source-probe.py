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
    # ── Round two: ask the sites where their own workforce pages are ───────
    # Round one settled the doorman and killed two false claims. Measured on a
    # runner 2026-09-24:
    #
    #   ocpe.nt.gov.au     STILL CHALLENGED after 30s — a browser does NOT
    #                      clear this one. It is the only host in this repo
    #                      that a real Chromium cannot get into.
    #   nt.gov.au          browser 200. Clears.
    #   dpac.tas.gov.au    browser 200. Clears. It has not "stopped resolving".
    #   treasury.tas.gov.au  plain 200, no browser needed.
    #
    # What round one did NOT settle is where the workforce report lives, because
    # every deep path was a guess and all three 404'd. Guessing again is the
    # mistake the universities round already paid for, so this round asks each
    # site for its own map instead. A sitemap is a plain list of every URL the
    # site admits to having; grepping it for "workforce" is the difference
    # between knowing and guessing.
    ('NT sitemap', 'https://nt.gov.au/sitemap.xml'),
    ('TAS DPAC sitemap', 'https://www.dpac.tas.gov.au/sitemap.xml'),
    ('TAS gov sitemap', 'https://www.tas.gov.au/sitemap.xml'),
    # The State Service Commissioner publishes Tasmania's workforce report and
    # has its own site, which has never been tried.
    ('TAS Service Commissioner', 'https://www.statred.tas.gov.au/'),
    ('TAS SSC', 'https://www.stateservice.tas.gov.au/'),
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
            # A SITEMAP IS XML, not a page of anchors, so `links` finds
            # nothing in one however good it is. Match <loc> entries too, and
            # report the count so an empty result is distinguishable from a
            # sitemap that simply has no workforce page in it.
            locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', html, re.I)
            if locs:
                hits = [u for u in locs if re.search(
                    r'workforce|state[-_ ]of[-_ ]the[-_ ](service|sector)|employment|'
                    r'staffing|profile|commissioner', u, re.I)]
                print(f'  sitemap : {len(locs)} urls, {len(hits)} look relevant')
                for u in dict.fromkeys(hits)[:25] if False else list(dict.fromkeys(hits))[:25]:
                    print(f'  url     : {u[:120]}')
                if not hits:
                    for u in locs[:12]:
                        print(f'  sample  : {u[:120]}')
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
