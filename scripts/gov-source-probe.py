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
import os, re, sys, urllib.error, urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')

# Candidate landing pages, newest-looking first. These are where each
# jurisdiction's workforce report is published; the CKAN portals were checked
# first and carry nothing per agency (SA publishes agency-by-agency self
# reports, NT's portal has no workforce data at all, and Tasmania has no
# reachable open-data portal).
TARGETS = [
    # ── Round seven: NEW ZEALAND HEALTH ────────────────────────────────────
    # Four Health NZ districts and the Northern Regional Alliance are 334 of
    # the 657 live ads still in the NZ gap, and the Public Service Commission
    # source that closed 26 NZ agencies cannot hold them: Health New Zealand is
    # a Crown entity and its DISTRICTS are operational units inside it, not
    # public-service departments, so they appear in no PSC workforce row under
    # any name.
    #
    # tewhatuora.govt.nz now 301s to healthnz.govt.nz, and healthnz.govt.nz
    # answers a plain curl with a CloudFront "Request blocked" 403 — an AWS WAF
    # fingerprint refusal, NOT an unreachable host. That is the same shape the
    # NT and Tasmania turned out to be, where a warmed browser cleared it, so
    # the sitemap is asked for through the browser and warmed first.
    ('HealthNZ sitemap', 'https://www.healthnz.govt.nz/sitemap.xml',
     'https://www.healthnz.govt.nz/'),
    ('HealthNZ publications', 'https://www.healthnz.govt.nz/publications/',
     'https://www.healthnz.govt.nz/'),
    # The old domain's own sitemap, in case the redirect is only on the apex and
    # the content tree still answers.
    ('TeWhatuOra sitemap', 'https://www.tewhatuora.govt.nz/sitemap.xml',
     'https://www.tewhatuora.govt.nz/'),
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


def dump_pdf(ctx, url, warm):
    """Download a PDF through a warmed browser and print what a parser will see.

    The reports are behind the same Cloudflare challenge as the pages, so
    urllib cannot have them; a browser request inside a cleared context can.
    """
    try:
        import pdfplumber
    except ImportError:
        print('  pdf     : pdfplumber not installed here')
        return
    page = ctx.new_page()
    try:
        page.goto(warm, wait_until='domcontentloaded', timeout=60_000)
        w = 0
        while 'Just a moment' in page.content() and w < 30_000:
            page.wait_for_timeout(3000)
            w += 3000
        # NAVIGATE TO THE PDF; do not ask for it through the API request
        # context. page.request shares the cookie jar but not the browser's
        # TLS and header fingerprint, so Cloudflare challenged it again and
        # returned 6 KB of "Just a moment" where a PDF was expected — inside a
        # context that had just cleared. The navigation carries the whole
        # fingerprint and is what the clearance was issued for.
        # CHROMIUM DOWNLOADS A PDF, IT DOES NOT RENDER ONE. page.goto raised
        # "Download is starting" and the navigation never resolved, which
        # reads as the fetch failing when it is actually succeeding into a
        # file. Catch the download and read it off disk.
        with page.expect_download(timeout=120_000) as dl:
            try:
                page.goto(url, wait_until='domcontentloaded', timeout=15_000)
            except Exception:                                     # noqa: BLE001
                pass                       # the navigation aborts into a download
        path = dl.value.path()
        body = open(path, 'rb').read() if path else b''
        print(f'  pdf     : {len(body):,} bytes downloaded')
        if not body.startswith(b'%PDF'):
            print(f'  pdf     : not a PDF ({body[:40]!r})')
            return
        import io as _io
        with pdfplumber.open(_io.BytesIO(body)) as pdf:
            print(f'  pdf     : {len(pdf.pages)} pages')
            for n, pg in enumerate(pdf.pages, 1):
                txt = pg.extract_text() or ''
                if not re.search(r'\bagency|\bdepartment|FTE|head ?count', txt, re.I):
                    continue
                if not re.search(r'\d{3,}', txt):
                    continue
                print(f'\n  ===== page {n} =====')
                for line in txt.split('\n')[:16]:
                    print(f'    {line[:110]}')
                if n > 40:
                    break
    except Exception as e:                                        # noqa: BLE001
        print(f'  pdf     : FAILED {type(e).__name__}: {str(e).splitlines()[0][:90]}')
    finally:
        page.close()


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        # PIN THE BROWSER PATH. The sandbox ships Chromium under
        # /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH), but the pip playwright
        # here expects a NEWER build number than the image carries and dies with
        # "Executable doesn't exist ... chromium_headless_shell-1243", telling
        # you to run `playwright install`. Do not: the environment pins
        # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD and the browser is already present.
        # Point at the one on disk instead.
        exe = next((c for c in (
            '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
            '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
        ) if os.path.exists(c)), None)
        browser = p.chromium.launch(args=['--no-sandbox'],
                                    **({'executable_path': exe} if exe else {}))
        ctx = browser.new_context(user_agent=UA, locale='en-AU')
        warmed = set()
        for label, url, warm in TARGETS:
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
                    # WARM THE ORIGIN FIRST, once per context. The clearance
                    # cookie is what makes the second request cheap; without it
                    # every path is a cold first request and is challenged on
                    # its own.
                    if warm and warm not in warmed:
                        page.goto(warm, wait_until='domcontentloaded', timeout=60_000)
                        w = 0
                        while 'Just a moment' in page.content() and w < 30_000:
                            page.wait_for_timeout(3000)
                            w += 3000
                        warmed.add(warm)
                        print(f'  warm    : {warm[:60]} '
                              f'({"cleared in %ds" % (w / 1000) if w else "no challenge"})')
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
            pdfs = []
            for l in dict.fromkeys(found):
                print(f'  link    : {l[:130]}')
                m = re.match(r'(https?://\S+\.pdf)', l, re.I)
                if m and re.search(r'workforce|state.of.the.service|staffing|profile',
                                   m.group(1), re.I):
                    pdfs.append(m.group(1))
            # NEWEST EDITION BY THE YEAR IN THE FILENAME, not by the URL.
            # Sorting the URLs read the 2022 report: they are served from
            # /__data/assets/pdf_file/<dir>/<id>/, and 0025/509317 (2022) sorts
            # above 0023/509306 (2024) because the directory number leads.
            # The year is in the name and nowhere else that matters.
            def edition(u):
                m = re.search(r'Number-(\d+)-(\d{4})', u, re.I)
                return (int(m.group(2)), int(m.group(1))) if m else (0, 0)
            for u in sorted(set(pdfs), key=edition, reverse=True)[:1]:
                print(f'  reading : {u[:120]}')
                dump_pdf(ctx, u, warm)
        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
