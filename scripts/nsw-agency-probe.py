#!/usr/bin/env python3
"""Find, and read, ONE NSW agency's annual report workforce table.

    python3 scripts/nsw-agency-probe.py                 # every agency below
    python3 scripts/nsw-agency-probe.py icare tag       # just these keys
    python3 scripts/nsw-agency-probe.py --url <pdf>     # read a PDF directly

WHY THIS EXISTS. NSW is the largest cluster left in the headcount gap — about
forty cards — and unlike every other jurisdiction it has no usable central
source. Its Workforce Profile is reachable and current but its finest grain
over 34 sheets is PORTFOLIO or SERVICE, and a portfolio holds many agencies
that each have a card here. So each card needs its own annual report, and the
expensive half of that is not parsing the table, it is FINDING the document.

THE OBVIOUS INDEX IS BLOCKED, WHICH IS WHY THIS WORKS AGENCY BY AGENCY. Every
NSW agency tables its annual report in Parliament and parliament.nsw.gov.au
serves each one as a PDF — the central list nsw.gov.au does not have, whose
sitemap carries 101 annual-report pages for about a dozen agencies. That host
sits behind a Cloudflare interstitial this network cannot clear: measured
2026-09-27, a warmed browser still read "Just a moment..." after 120 seconds,
ctx.request answered 403, and a download navigation timed out. A URL found
there is not a readable document from here.

AND A SITEMAP IS NOT AN INDEX EITHER, which cost the largest card in the route
a wrong entry in CLAUDE.md. Transport for NSW was recorded as publishing no
current annual report because transport.nsw.gov.au's sitemap — all 14,375 URLs
— does not name one. It does not: the report is a file under
/system/files/media/documents/2025/, and sitemaps list pages. The host also
403s a plain fetch and serves the same file happily to a warmed browser, so one
probe was answered by a WAF and the other by a page index, and neither was the
document. This probe therefore reads LISTING PAGES through the browser and
greps their links, which is the thing that actually finds these files.

What it prints per agency: which listing page answered, every annual-report PDF
linked from it, and — for the newest — every line and table row on the pages
that look like a workforce table, so a spec can be written against measured
text rather than a guess. Reports, never gates.
"""
import importlib.util
import io
import re
import sys
from pathlib import Path

GEN = Path(__file__).with_name('gen-gov-workforce.py')

# THE GENERATOR'S ARGUMENTS ARE NOT THIS PROBE'S, and conflating them cost a
# run: the import was handed `--only none` so anything argv-driven inside the
# generator would be inert, by ASSIGNING to sys.argv — which this probe then
# read back in main(), found neither `--url` nor an agency key in, and quietly
# swept every agency instead of the one asked for. The real arguments are taken
# before the import and put back after it.
ARGS = sys.argv[1:]
_spec = importlib.util.spec_from_file_location('gen_gov_workforce', GEN)
gen = importlib.util.module_from_spec(_spec)
_saved, sys.argv = sys.argv, [sys.argv[0], '--only', 'none']
try:
    _spec.loader.exec_module(gen)
finally:
    sys.argv = _saved

# One entry per agency still blank in the gap, with the listing pages worth
# trying and whether the host needs warming.
#
# THE LISTING PAGES ARE GUESSES AND THE PDF LINKS ARE NOT. Each `pages` entry is
# a path this probe tries and reports on; what is trustworthy is what came back.
# tag.nsw.gov.au proved the pattern that makes this cheap: an agency on the NSW
# Drupal platform serves its reports from /sites/default/files/noindex/<yyyy-mm>/
# and links them all from one page, so finding the page finds every year at once.
AGENCIES = {
    'tag': dict(
        name='NSW Trustee and Guardian', score=27,
        pages=['https://www.tag.nsw.gov.au/publications/annual-reports']),
    'rfs': dict(
        name='NSW Rural Fire Service', score=49, warm='https://www.rfs.nsw.gov.au/',
        pages=['https://www.rfs.nsw.gov.au/resources/publications/annual-reports',
               'https://admin.rfs.nsw.gov.au/resources/publications/annual-reports']),
    'frnsw': dict(
        name='Fire and Rescue NSW', score=86, warm='https://www.fire.nsw.gov.au/',
        pages=['https://www.fire.nsw.gov.au/about-us/publications/annual-reports']),
    'soh': dict(
        name='Sydney Opera House', score=23, warm='https://www.sydneyoperahouse.com/',
        pages=['https://www.sydneyoperahouse.com/about-us/how-we-work/'
               'governance-policies-and-corporate-information/annual-reports']),
    'ses': dict(
        name='NSW State Emergency Service', score=26, warm='https://www.ses.nsw.gov.au/',
        pages=['https://www.ses.nsw.gov.au/about-us/publications/']),
    'sport': dict(
        name='Office of Sport', score=26,
        pages=['https://www.sport.nsw.gov.au/corporate-information/annual-reports',
               'https://www.sport.nsw.gov.au/corporate-information-and-reporting']),
    # A DIRECT `url` FOR A REPORT ALREADY LOCATED, so the probe does not have to
    # re-derive it from a listing page. Service NSW serves its own file from
    # /system/files/, the same shape transport.nsw.gov.au uses and the same shape
    # no sitemap lists.
    'snsw': dict(
        name='Service NSW', score=15, warm='https://www.service.nsw.gov.au/',
        url='https://www.service.nsw.gov.au/system/files/2025-12/Annual-Report-2025-SNSW_0.pdf',
        pages=[]),
    'dps': dict(
        name='Department of Parliamentary Services', score=23,
        pages=['https://www.parliament.nsw.gov.au/about/Pages/annual-reports.aspx']),
    'ecnsw': dict(
        name='NSW Electoral Commission', score=17, warm='https://elections.nsw.gov.au/',
        pages=['https://elections.nsw.gov.au/about-us/reports/annual-reports']),
    'maas': dict(
        name='Museum of Applied Arts and Sciences', score=19,
        pages=['https://www.maas.museum/about/annual-reports/',
               'https://powerhouse.com.au/about/annual-reports']),
    'ausmus': dict(
        name='Australian Museum', score=14,
        pages=['https://australian.museum/about/organisation/annual-reports/']),
    'slnsw': dict(
        name='State Library of New South Wales', score=14,
        pages=['https://www.sl.nsw.gov.au/about/corporate-information/annual-reports']),
}

# A line worth showing: it names people and carries a number, or it is a table
# caption. Deliberately wide — the point is to see what the document says, and a
# heading this probe filtered out is a spec that cannot be written.
PEOPLE = re.compile(r'(?i)\b(employees?|officers|staff|workforce|head ?count|'
                    r'full[- ]time equivalent|\bFTE\b|positions)\b')
NUMBER = re.compile(r'\d')
CAPTION = re.compile(r'(?i)^(table|figure)\s*\d*\s*[:.]?')


def pdfs_on(url, warm=None):
    """Every PDF linked from a listing page, rendered through a browser."""
    try:
        html = gen.fetch(url, warm=warm, render=True)
    except Exception as e:                      # a 404 here is information, not a crash
        return None, f'{type(e).__name__}: {str(e)[:120]}'
    # `.pdf` IS NOT WHERE THESE FILES ALWAYS LIVE. The Sydney Opera House serves
    # every annual report from a media CDN with no extension in the path —
    # sydneyoperahouse.api.collaboro.com/media/annual-report-2025 is 8.7 MB of
    # %PDF-1.5 — so an extension-only grep found zero links and the card was one
    # sentence away from being recorded as "publishes no annual report". Links
    # whose path SAYS annual report are collected too; read_report() judges by
    # content type, so a false positive here costs a fetch and nothing else.
    links = sorted(set(re.findall(r'(?:href|src)="([^"]*\.pdf[^"]*)"', html)))
    labelled = sorted(set(l for l in re.findall(r'href="([^"]+)"', html)
                          if re.search(r'(?i)annual[-_ ]?report', l)
                          and not l.lower().endswith(('.html', '.htm', '/'))
                          and '.pdf' not in l.lower()))
    return links + labelled, None


def read_report(url, warm=None):
    """Print every workforce-looking line and table row in one report."""
    import pdfplumber
    blob = gen.fetch(url, binary=True, warm=warm)
    if blob[:4] != b'%PDF':
        print(f'    not a PDF ({len(blob):,} bytes, starts {blob[:40]!r}) — '
              f'probably this host redirecting the path to a landing page')
        return False
    print(f'    {len(blob):,} bytes')
    with pdfplumber.open(io.BytesIO(blob)) as pdf:
        print(f'    {len(pdf.pages)} pages')
        for i, pg in enumerate(pdf.pages):
            txt = pg.extract_text() or ''
            lines = [l for l in txt.split('\n')
                     if (PEOPLE.search(l) and NUMBER.search(l)) or CAPTION.match(l.strip())]
            if not lines:
                continue
            # A page qualifies on a CAPTION alone, because the caption is what a
            # spec's `needle` is written against and it often carries no digits.
            if not any(PEOPLE.search(l) and NUMBER.search(l) for l in lines):
                continue
            print(f'    ── p{i + 1}')
            for l in lines[:14]:
                print(f'       {l[:150]}')
            for tab in pg.extract_tables():
                for row in tab:
                    joined = ' | '.join(str(c).replace('\n', ' ') for c in row if c)
                    if PEOPLE.search(joined) or re.search(r'^\s*Total', joined):
                        print(f'       T: {joined[:170]}')
    return True


def main():
    args = ARGS
    if '--url' in args:
        read_report(args[args.index('--url') + 1])
        return
    keys = [a for a in args if a in AGENCIES] or list(AGENCIES)
    for key in keys:
        spec = AGENCIES[key]
        print(f'\n===== {key}: {spec["name"]}  ({spec["score"]} on the ranking)')
        if spec.get('url'):
            print(f'  reading (known url) {spec["url"][:120]}')
            try:
                read_report(spec['url'], spec.get('warm'))
            except Exception as e:
                print(f'    FAILED {type(e).__name__}: {str(e)[:140]}')
            continue
        found = []
        for page in spec['pages']:
            links, err = pdfs_on(page, spec.get('warm'))
            if err:
                print(f'  {page[:90]} -> {err}')
                continue
            annual = [l for l in links if re.search(r'(?i)annual', l)]
            print(f'  {page[:90]} -> {len(links)} pdfs, {len(annual)} annual')
            for l in annual[:8]:
                print(f'      {l[:140]}')
            found += annual
        newest = [l for l in found if re.search(r'2024[-_ ]?25|2024[-_]2025|24[-_]25', l)]
        if not newest:
            print('  no 2024-25 report among the links — nothing to read')
            continue

        # A LISTING PAGE CARRIES OTHER BODIES' REPORTS, and taking the first
        # 2024-25 link read the wrong one in silence. sport.nsw.gov.au publishes
        # forty annual reports going back to 1997 and hosts its portfolio's as
        # well: the first 2024-25 match by sort order is
        # CSA-Annual-Report-2024-2025.pdf, the COMBAT SPORTS AUTHORITY — a
        # fifteen-page document that parses perfectly and is not this agency.
        # Nothing about the read would have looked wrong.
        #
        # So every candidate is printed, and one whose filename carries a word
        # from the agency's own name is preferred. When none does the first is
        # still read, because a report named "annual_report_2024_25.pdf" on the
        # agency's own host is usually right — but the list above it is what a
        # human checks.
        # MATCH THE INITIALISM AS WELL AS THE WORDS, because these files are named
        # by initialism far more often than not. The three 2024-25 reports on the
        # Office of Sport's page are CSA-Annual-Report-2024-2025.pdf (Combat
        # Sports Authority), OoS-Annual-Report-2024-25.pdf and
        # SSVA-Annual-Report-2024-2025.pdf (State Sporting Venues Authority) —
        # so a word match on "sport" finds NONE of them and the sort order hands
        # back the Combat Sports Authority.
        words = [w.lower() for w in re.findall(r'[A-Za-z]{4,}', spec['name'])
                 if w.lower() not in ('department', 'office', 'service', 'services',
                                      'authority', 'commission', 'south', 'wales')]
        initials = ''.join(w[0] for w in spec['name'].split() if w[:1].isalpha()).lower()
        named = [l for l in newest
                 if any(w in l.lower() for w in words)
                 or (len(initials) >= 3
                     and re.search(rf'(?<![a-z]){re.escape(initials)}(?![a-z])',
                                   l.rsplit('/', 1)[-1].lower()))]
        if len(newest) > 1:
            print(f'  {len(newest)} candidates for 2024-25 — CHECK THIS LIST, a '
                  f"listing page carries other bodies' reports too:")
            for l in newest:
                mark = '  <- name matches the agency' if l in named else ''
                print(f'      {l[:130]}{mark}')
        url = (named or newest)[0]
        if url.startswith('/'):
            # AN AGENCY SUB-DOMAIN LISTS THE FILES AND DOES NOT SERVE THEM, and
            # it does not 404 when you ask — which is the part that wastes an
            # afternoon. tag.nsw.gov.au links
            # /sites/default/files/noindex/2025-12/nsw-trustee-guardian-annual-report-2024-25.pdf
            # and answers that path with HTTP 200 and 185 KB of its own landing
            # page, having redirected to
            # nsw.gov.au/departments-and-agencies/trustee-guardian. The same
            # path on www.nsw.gov.au is 10 MB of application/pdf. A probe that
            # checked the status code would call the first one a success.
            #
            # So the agency host is tried first (some do serve their own files)
            # and www.nsw.gov.au second, and what decides is the CONTENT TYPE,
            # never the status.
            host = re.match(r'https?://[^/]+', spec['pages'][0]).group(0)
            candidates = [host + url, 'https://www.nsw.gov.au' + url]
        else:
            candidates = [url]
        for cand in candidates:
            print(f'  reading {cand[:130]}')
            try:
                if read_report(cand, spec.get('warm')):
                    break
            except Exception as e:
                print(f'    FAILED {type(e).__name__}: {str(e)[:140]}')


if __name__ == '__main__':
    main()
