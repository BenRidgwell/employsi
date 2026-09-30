#!/usr/bin/env python3
"""Where is each Queensland statutory body's annual report? Start with `tabled`.

    python3 scripts/qld-agency-probe.py tabled         # THE ROUTE THAT WORKS
    python3 scripts/qld-agency-probe.py read 5826T1901 # one paper's own figures
    python3 scripts/qld-agency-probe.py            # every stage, including the
    python3 scripts/qld-agency-probe.py qcaa       # superseded agency-host ones

ROUND FOUR FOUND THE ROUTE, AND IT WAS IN THIS FILE'S OWN MEASUREMENTS THE
WHOLE TIME. A Queensland statutory body's annual report must be TABLED IN THE
LEGISLATIVE ASSEMBLY, and Parliament serves the tabled copy to a plain urllib
fetch from this sandbox. Six cards were filed off it on 2026-09-30 — QCAA, the
Information Commissioner, EWOQ, QRIC, the Pharmacy Council and Stadiums
Queensland — none of whose own hosts will open here at all.

AND THE REASON IT TOOK FOUR ROUNDS IS THE MISTAKE THIS CODEBASE KEEPS MAKING: A
MEASUREMENT OF ONE URL WRITTEN DOWN AS A MEASUREMENT OF SOMETHING LARGER. The
table below already said

    documents.parliament.qld.gov.au   403   1,233 bytes

and that was read as "Parliament is blocked". It is a measurement of the wrong
host's bare root: the documents are on www.parliament.qld.gov.au under
/Work-of-the-Assembly/Tabled-Papers/docs/, and they serve fine. Two more traps
sit in the same place, both met on 2026-09-30:

  · the LISTING pages 403 urllib and render fine through the browser, so the
    search needs via_browser and the documents do not;
  · `curl -I` AND `curl` GET both answer 403 on a document URL that urllib
    downloads 2MB of PDF from. A HEAD is not a measurement of a GET, and reading
    it as one would have closed this route a second time.

The stages below it are kept because each records a real fact about a host, and
because three cards are still unfiled — but for FINDING a document they are
superseded. Ask Parliament first.

WHY THIS EXISTS. Nineteen Queensland cards carried some version of "no row names
it; statutory authority, outside the collection". That is a true statement about
the State of the Sector workbooks, which cover DEPARTMENTS, and it was never a
statement about the bodies: each publishes an annual report under Queensland's
annual-report requirements, which mandate a workforce section. Four of them have
since been read and three are filed (see AGENCY_REPORTS in gen-gov-workforce.py).

THE REST NEED A BROWSER, NOT JUST A RUNNER, AND ROUND ONE OF THIS PROBE PROVED
IT THE HARD WAY. It fetched with urllib only, and every host that answers 403
here answered 403 on the RUNNER too, with publications.qld.gov.au returning its
`202 and zero bytes` there as well. For about a minute that read as "the runner
is blocked, so the route out of South Australia does not work for Queensland".
It is nothing of the kind: the Queensland doorman is an AWS WAF JAVASCRIPT
challenge — the one this whole workflow drives a browser for — and a plain
urllib fetch from a runner can execute JavaScript exactly as well as one from
here, which is to say not at all. get() now falls back to gen-gov-workforce.py's
own fetch(), browser and all.

Measured 2026-09-29 from the authoring sandbox, plain:

    www.qcaa.qld.edu.au        403      5,644 bytes
    www.qleave.qld.gov.au      403      5,646
    www.qric.qld.gov.au        403      5,644
    www.ombudsman.qld.gov.au   403      1,139
    www.ewoq.com.au            403        371
    documents.parliament.qld.gov.au   403   1,233

and publications.qld.gov.au — the central portal that would list every one of
these documents at once — answers its HOMEPAGE with 200 and its /dataset SEARCH
with `202 and zero bytes`, which is the AWS WAF challenge shape this repo
already records for data.qld.gov.au. That challenge is the whole reason
gov-workforce.yml drives a browser, so the search belongs there rather than here.

WHAT IS BEING ASKED IS "WHERE IS THE DOCUMENT", NOT "HOW MANY PEOPLE". Every one
of these reports has a workforce section; what is missing is its URL, and four
rounds of the South Australian probe established that guessing a path measures
the guess. So this prints the links each site actually publishes, and the specs
get written against documents rather than against hope.

THREE OF THESE SITES ARE REACHABLE AND STILL DON'T LINK A REPORT FROM THEIR
ROOT — the Public Guardian, the Queensland Audit Office and Stadiums Queensland
— so they are here for their own reason: not a blocked host, a report filed
somewhere the root does not point at.
"""
import html as _html
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')

# A challenge answered with a 2xx is the failure this file exists for, so it is
# named rather than left to look like a page with no links on it. The Queensland
# one is an AWS WAF action and arrives as `202 with an empty body`, which no
# pattern can match — probe() checks the length instead.
CHALLENGE = ('Just a moment', 'Security Checkpoint', 'Checking your browser',
             'Attention Required!', 'challenge-platform', 'Client Challenge',
             'awsWafCoo', '/.safeline/', 'slg-title')

# live ads at 2026-09-29, for whoever picks this up next
SITES = {
    # ── STAGE ONE: WHERE IS THE DOCUMENT ────────────────────────────────────
    # Kept for the three hosts still unread, and as the re-check for the five
    # the browser opened on 2026-09-29. Each `ads` figure is live ads that day.
    'pubguardian':('https://www.publicguardian.qld.gov.au/', 2),
    'oir':        ('https://www.oir.qld.gov.au/our-role', 6),
    'oir-worksafe':('https://www.worksafe.qld.gov.au/about/careers/'
                   'people-and-careers', 0),
    'oic':        ('https://www.oic.qld.gov.au/', 1),
    'qao':        ('https://www.qao.qld.gov.au/', 0),
    'stadiums':   ('https://stadiums.qld.gov.au/', 0),
    'pharmcouncil':('https://www.health.qld.gov.au/system-governance/licences/pharmacy', 0),
}

# ── STAGE TWO: WHAT DOES THE DOCUMENT SAY ───────────────────────────────────
# The browser opened five of these hosts on the runner and none of them opens
# here, so the figures cannot be read where the spec is written. That is the
# South Australian and Tasmanian shape exactly: print the document's own
# workforce lines to the log, write the parser against them, and let CI re-read
# the document every run.
#
# `follow` PICKS THE LINK, IT DOES NOT GUESS A PATH. Stage one already printed
# what each listing page links; this takes the first href whose label or URL
# matches, which is the current year's report on every one of these pages.
# A probe that invented a filename would be measuring the guess again.
DOCS = {
    'qcaa':      ('https://www.qcaa.qld.edu.au/news-data/annual-report',
                  r'(?i)annual.report.*202[56]|202[56].*annual.report', 8),
    'qleave':    ('https://www.qleave.qld.gov.au/about-us/corporate-publications/'
                  'annual-report',
                  r'(?i)annual.report.*202[56]|202[56].*annual.report', 1),
    'qric':      ('https://www.qric.qld.gov.au/',
                  r'(?i)Annual-Report-2025', 1),
    'ombudsman': ('https://www.ombudsman.qld.gov.au/publications/annual-reports',
                  r'(?i)annual.report.*202[56]|202[56].*annual.report', 0),
    'ewoq':      ('https://www.ewoq.com.au/news-and-publications/publications/'
                  'annual-reports',
                  r'(?i)annual.report.*202[56]|202[56].*annual.report', 0),
    # NOT A CARD. This settles the PUBLIC GUARDIAN's, whose own report gives 372
    # people at 30 June 2025 — what is unknown is whether they are inside the
    # Department of Justice's 4,629. A department's workforce note is where that
    # is stated; DCCEEW's Table 7 note is the model.
    'doj':       ('https://www.publications.qld.gov.au/dataset/'
                  '2025-26-doj-annual-report', r'(?i)\.pdf|DoJ annual report', 0),
}

# What to print out of a document once it is open. The employee-expenses note is
# where Queensland Treasury's reporting requirements put the figure, so that
# wording is first; the rest catch a body that reports somewhere else.
DOC_PATS = [
    r'(?i)full[- ]?time equivalent employees',
    r'(?i)(head ?count|full[- ]time equivalent|\bFTE\b)[^.]{0,60}\d',
    r'(?i)(total )?(staffing|workforce|employees)[^.]{0,40}\d',
    r'(?i)\b\d[\d,]{1,5}(?:\.\d+)?\b[^.]{0,40}(?:staff|employees|FTE)\b',
    r'(?i)employed (a total of|by)',
    r'(?i)(establishment|approved workforce)[^.]{0,40}\d',
]

# THE PORTAL THAT WOULD ANSWER ALL OF THEM AT ONCE, asked here because the
# runner is where the WAF challenge can be executed. If this works, the per-site
# probes above become a fallback rather than the route.
PORTAL = ('https://www.publications.qld.gov.au/dataset?q=',
          ['annual report 2025-26', 'queensland curriculum annual report',
           'qleave annual report', 'racing integrity annual report'])


# THE BROWSER FETCH IS IMPORTED, NOT REIMPLEMENTED. gen-gov-workforce.py's
# fetch() already carries everything this needs — the pinned Chromium path, the
# four interstitial patterns, the challenge waits — and a second, weaker copy
# here would be a copy that goes stale the first time one of them is fixed.
# Loaded by path because the module name has hyphens; importing it runs the
# table definitions and nothing else, since its work is under __main__.
def _gen():
    import importlib.util
    import pathlib
    if _GEN['m'] is None:
        path = pathlib.Path(__file__).with_name('gen-gov-workforce.py')
        spec = importlib.util.spec_from_file_location('_gengov', path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _GEN['m'] = m
    return _GEN['m']


_GEN = {'m': None}


def get(url, timeout=90):
    """Plain fetch, then the browser if the plain one is turned away.

    ROUND ONE OF THIS PROBE USED urllib ONLY, AND ITS RESULT WAS MISREAD FOR
    ABOUT A MINUTE. Every host that answers 403 here answered 403 on the RUNNER
    too, and publications.qld.gov.au returned its `202 and zero bytes` there as
    well — which reads as "the runner is blocked, the way out of South Australia
    does not work for Queensland". It is not that. The Queensland doorman is an
    AWS WAF JavaScript challenge, and clearing it is the whole reason
    gov-workforce.yml drives a browser at all; a plain urllib fetch from a
    runner is no more able to execute JavaScript than one from here.
    """
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        if r.status == 200 and len(body) > 400:
            return r.status, body
        plain = (r.status, body)
    except urllib.error.HTTPError as e:
        plain = (e.code, b'')
    except Exception as e:                                        # noqa: BLE001
        plain = (None, f'{type(e).__name__}: {e}'.encode())

    try:
        html = _gen().fetch(url, via_browser=True, render=True)
        print(f'  (plain fetch gave {plain[0]}; retried through the browser)',
              flush=True)
        return 200, html.encode('utf-8', 'replace')
    except Exception as e:                                        # noqa: BLE001
        print(f'  (browser retry also failed: {type(e).__name__}: '
              f'{str(e)[:90]})', flush=True)
        return plain


def report_links(base, html):
    out, seen = [], set()
    for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S | re.I):
        href = urllib.parse.urljoin(base, m.group(1).replace('&amp;', '&'))
        lab = ' '.join(re.sub(r'<[^>]+>', ' ', m.group(2)).split())
        if not re.search(r'(?i)annual.?report|\.pdf', href + ' ' + lab):
            continue
        if href in seen:
            continue
        seen.add(href)
        out.append((href, lab))
    return out


def probe(key, url, ads):
    print(f'\n{"=" * 70}\n{key} ({ads} live ads): {url}', flush=True)
    st, body = get(url)
    if st != 200:
        print(f'  HTTP {st} — {body[:90].decode("utf-8", "replace")}', flush=True)
        return
    print(f'  HTTP {st}, {len(body):,} bytes', flush=True)
    if len(body) < 400:
        print('  A BODY TOO SHORT TO BE A PAGE — the WAF challenge, not the '
              'site, and the browser retry did not clear it either', flush=True)
        return
    html = body.decode('utf-8', 'replace')
    if any(c in html for c in CHALLENGE):
        print('  AN INTERSTITIAL, NOT THE PAGE — the runner is challenged too',
              flush=True)
        return
    hits = report_links(url, html)
    if not hits:
        print('  200 and NO annual-report link — a finding about this page, not '
              'about the body; try its publications or about section', flush=True)
    for href, lab in hits[:10]:
        print(f'    {href[:118]}  |{lab[:40]}|', flush=True)


def doc_probe(key, url, pat, ads):
    """Follow one listing page to its report, then print what the report says."""
    print(f'\n{"=" * 70}\nDOC {key} ({ads} live ads): {url}', flush=True)
    st, body = get(url)
    if st != 200 or len(body) < 400:
        print(f'  HTTP {st}, {len(body):,} bytes — no listing page, no document',
              flush=True)
        return
    html = body.decode('utf-8', 'replace')
    hit = next(((h, l) for h, l in report_links(url, html)
                if re.search(pat, h + ' ' + l)), None)
    if hit is None:
        print(f'  the page opened and NO link matches {pat!r} — a finding about '
              f'the page; stage one printed what it does link', flush=True)
        return
    href, lab = hit
    print(f'  -> {href[:120]}  |{lab[:40]}|', flush=True)
    st2, doc = get(href, timeout=180)
    print(f'     HTTP {st2}, {len(doc):,} bytes, starts {doc[:8]!r}', flush=True)
    if doc[:4] != b'%PDF':
        # A resource PAGE rather than the file — one more hop, the same way.
        if st2 == 200 and len(doc) > 400:
            inner = next(((h, l) for h, l in report_links(
                href, doc.decode('utf-8', 'replace')) if h.lower().endswith('.pdf')), None)
            if inner:
                print(f'     -> {inner[0][:118]}', flush=True)
                st2, doc = get(inner[0], timeout=180)
                print(f'        HTTP {st2}, {len(doc):,} bytes', flush=True)
    if doc[:4] != b'%PDF':
        print('     NOT A PDF — nothing to read', flush=True)
        return
    import io as _io
    import pdfplumber
    with pdfplumber.open(_io.BytesIO(doc)) as pdf:
        print(f'     {len(pdf.pages)} pages', flush=True)
        n = 0
        for i, pg in enumerate(pdf.pages, 1):
            for line in (pg.extract_text() or '').split('\n'):
                if len(line) > 200 or not any(re.search(q, line) for q in DOC_PATS):
                    continue
                print(f'     p{i:>3} {line[:190]}', flush=True)
                n += 1
                if n > 22:
                    print('     … 22 lines is enough to write a spec from', flush=True)
                    return
        if not n:
            print('     opened and NOT ONE line matches — a finding about the '
                  'document, not the body', flush=True)


# ── STAGE THREE: PARLIAMENT, WHICH IS THE ONE THAT WORKS ────────────────────
# The search page ignores `SearchText` and its date range and honours `page`, 25
# papers to a page, newest first. Ten pages cached 246 papers on 2026-09-30,
# which reached back past every Queensland annual report tabled since late
# August. The listing needs the browser; the documents do not.
TABLED_SEARCH = ('https://www.parliament.qld.gov.au/Work-of-the-Assembly/'
                 'Tabled-Papers/search?page=%d')
TABLED_DOC = ('https://www.parliament.qld.gov.au/Work-of-the-Assembly/'
              'Tabled-Papers/docs/%s/%s.pdf')

# The cards this is for: every remaining Queensland NOT_IN_SOURCE entry that
# could have a report of its own, as a pattern against a tabled paper's title.
# `ads` is live ads at 2026-09-29. Filing one means deleting its line.
WANTED = [
    ('Queensland Ombudsman',        r'(?i)^Queensland Ombudsman', 0),
    ('Queensland Audit Office',     r'(?i)^Queensland Audit Office', 0),
    ('Office of Industrial Relations',
                                    r'(?i)Office of Industrial Relations', 6),
    # QLeave administers THREE schemes and tables a report for each, which is
    # three statutory authorities and one staff body. Summing them would file
    # the same people up to three times, so read all three before filing any.
    ('QLeave',                      r'(?i)Portable Long Service Leave', 1),
    # NOT CARDS THEMSELVES — each settles a double-count question a card is
    # waiting on. The Academy of Sport reports 122.3 FTE of its own and spent
    # 2025-26 "transitioning to a statutory body", so whether it is still inside
    # the Department of Sport's 370 is what its department's note decides; the
    # Public Guardian's 372 may sit inside the Department of Justice's 4,629.
    ('Dept of Sport (for the Academy of Sport)',
                                    r'(?i)^Department of Sport, Racing', 0),
    ('Dept of Justice (for the Public Guardian)',
                                    r'(?i)^Department of Justice', 0),
]


def tabled_probe(pages=10):
    """Walk the tabled-papers listing and name the paper id for each open card."""
    seen = {}
    for page in range(1, pages + 1):
        st, body = get(TABLED_SEARCH % page)
        if st != 200 or len(body) < 400:
            print(f'  page {page}: HTTP {st}, {len(body):,} bytes — stopping',
                  flush=True)
            break
        before = len(seen)
        for m in re.finditer(r'<a href="docs/([^/]+)/[^"]+\.pdf" target="_blank">'
                             r'(.*?)</a>', body.decode('utf-8', 'replace'), re.S):
            # UNESCAPED, or the same paper is listed twice: the rendered DOM
            # gives one anchor with a literal em dash and one with `&#x2014;`,
            # and they are two different dict keys for one document.
            lab = _html.unescape(' '.join(re.sub(r'<[^>]+>', ' ', m.group(2)).split()))
            seen.setdefault(re.sub(r'^\d+T\d+ - ', '', lab), m.group(1))
        print(f'  page {page}: {len(seen) - before} new, {len(seen)} papers',
              flush=True)
        if len(seen) == before:
            break
    print(f'\n{len(seen)} papers listed. For each open card:', flush=True)
    for name, pat, ads in WANTED:
        hits = [(v, k) for k, v in sorted(seen.items()) if re.search(pat, k)]
        if not hits:
            print(f'  {name} ({ads} ads): NOT TABLED YET — not blocked, not '
                  f'published. Nothing to read.', flush=True)
        for tid, title in hits[:4]:
            print(f'  {name} ({ads} ads): {tid}  {title[:78]}', flush=True)
            print(f'      read it:  python3 {__file__.split("/")[-1]} read {tid}',
                  flush=True)


def read_paper(tid):
    """One tabled paper -> its own workforce lines, page-numbered."""
    url = TABLED_DOC % (tid, tid.lower())
    print(f'\n{"=" * 70}\n{tid}: {url}', flush=True)
    st, doc = get(url, timeout=180)
    print(f'  HTTP {st}, {len(doc):,} bytes, starts {doc[:8]!r}', flush=True)
    if doc[:4] != b'%PDF':
        print('  NOT A PDF — check the id against a `tabled` listing', flush=True)
        return
    import io as _io
    import pdfplumber
    with pdfplumber.open(_io.BytesIO(doc)) as pdf:
        print(f'  {len(pdf.pages)} pages', flush=True)
        n = 0
        for i, pg in enumerate(pdf.pages, 1):
            for line in (pg.extract_text() or '').split('\n'):
                if len(line) > 200 or not re.search(r'\d', line):
                    continue
                if not any(re.search(q, line) for q in DOC_PATS):
                    continue
                print(f'  p{i:>3} {line.strip()[:180]}', flush=True)
                n += 1
                if n > 30:
                    print('  … 30 lines is enough to write a spec from', flush=True)
                    return
        if not n:
            print('  opened and NOT ONE line matches — a finding about the '
                  'document, not the body', flush=True)


def main():
    want = [a for a in sys.argv[1:] if not a.startswith('-')]
    # `read <ID>` and `tabled` come first because they are the route; everything
    # after them is the superseded agency-host walk.
    if want and want[0] == 'read':
        for tid in want[1:]:
            read_paper(tid)
        return
    if not want or 'tabled' in want:
        tabled_probe()
        if want:
            return
    for key, (url, ads) in SITES.items():
        if want and key not in want:
            continue
        probe(key, url, ads)
    for key, (url, pat, ads) in DOCS.items():
        if want and key not in want:
            continue
        doc_probe(key, url, pat, ads)
    if want and 'portal' not in want:
        return
    base, queries = PORTAL
    for q in queries:
        probe(f'portal:{q}', base + urllib.parse.quote(q), 0)


if __name__ == '__main__':
    main()
