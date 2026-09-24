#!/usr/bin/env python3
"""Does a PDF report carry per-agency workforce figures?

    python3 scripts/sa-workforce-probe.py [url] [firstPage-lastPage]

Written for South Australia and generalised when New South Wales turned out to
need the same question asked. Prints the pages that name several of the bodies
we care about AND carry numbers, so a table can be told from prose.

The only remaining question about SA. Its Office of the Commissioner for Public
Sector Employment publishes the report annually and — measured 2026-09-24 —
publishes it as a PDF and nothing else: every year from 2012 to 2025 is a PDF
link and there is no spreadsheet at any of them.

PDF table extraction is brittle and annual, so it is only worth building if the
table is actually in there. This dumps the pages that mention agencies so that
can be decided on evidence rather than on hope.

    python3 scripts/sa-workforce-probe.py
"""
import io, re, sys, urllib.request

URL = ('https://publicsector.sa.gov.au/__data/assets/pdf_file/0020/1205462/'
       '2025-Workforce-Information-Report.pdf')
if len(sys.argv) > 1:
    URL = sys.argv[1]
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
# Agencies from our own roster, to test whether the report names them at all.
WANT = ['SA Health', 'Department for Education', 'Department for Infrastructure',
        'South Australia Police', 'Department of Human Services',
        'Department for Child Protection', 'Department for Environment',
        # NSW Local Health Districts, which carry 1,667 of New South Wales'
        # 2,561 live ads — two thirds of the jurisdiction's value.
        'Nepean Blue Mountains', 'Hunter New England', 'South Eastern Sydney',
        'Northern Sydney', 'South Western Sydney', 'Western Sydney',
        'Illawarra Shoalhaven', 'Mid North Coast']


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    print(f'bytes   : {len(raw)}')
    if raw[:4] != b'%PDF':
        print(f'NOT A PDF — starts {raw[:40]!r}')
        return 1

    import pdfplumber
    pages = None
    if len(sys.argv) > 2:
        a, b = sys.argv[2].split('-')
        pages = range(int(a) - 1, int(b))
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        print(f'pages   : {len(pdf.pages)}')
        if pages is not None:
            # A RANGE, IN FULL. The NSW Health appendix carries a staffing
            # table per organisation — Medical, Nursing, Allied health, four
            # years to June 2025 — but a table is only usable if the body it
            # belongs to can be read off the page. That heading is what this
            # prints.
            for i in pages:
                if i >= len(pdf.pages):
                    break
                print(f'\n===== page {i+1} =====')
                for line in (pdf.pages[i].extract_text() or '').splitlines()[:30]:
                    print(f'  {line[:116]}')
            return 0
        NUMS = re.compile(r'(?:\b[\d,]{3,}\b.*){2,}')
        for i, page in enumerate(pdf.pages):
            txt = page.extract_text() or ''
            named = [w for w in WANT if w.lower() in txt.lower()]
            if len(named) < 2:
                continue
            lines = [l for l in txt.splitlines() if NUMS.search(l)]
            if not lines:
                continue
            print(f'\n===== page {i+1} — names {named[:4]} =====')
            for l in lines[:14]:
                print(f'  {l[:118]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
