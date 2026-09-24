#!/usr/bin/env python3
"""Does South Australia's Workforce Information Report carry per-agency figures?

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
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
# Agencies from our own roster, to test whether the report names them at all.
WANT = ['SA Health', 'Department for Education', 'Department for Infrastructure',
        'South Australia Police', 'Department of Human Services',
        'Department for Child Protection', 'Department for Environment']


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    print(f'bytes   : {len(raw)}')
    if raw[:4] != b'%PDF':
        print(f'NOT A PDF — starts {raw[:40]!r}')
        return 1

    import pdfplumber
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        print(f'pages   : {len(pdf.pages)}')
        # The ONE question: is there a per-agency table whose columns are a
        # head count or an FTE, as opposed to graduates, separations, leave or
        # any of the other things this report breaks down by agency?
        WANTED_COL = re.compile(r'\b(fte|headcount|head count|employees|persons|number)\b', re.I)
        for i, page in enumerate(pdf.pages):
            for t in page.extract_tables() or []:
                if len(t) < 6:
                    continue
                head = ' | '.join('' if c is None else re.sub(r'\s+', ' ', str(c)).strip()
                                  for c in (t[0] or [])[:10])
                if 'agency' not in head.lower():
                    continue
                if not WANTED_COL.search(head):
                    print(f'  p{i+1:<4} SKIP  {head[:90]}')
                    continue
                print(f'\n===== p{i+1} CANDIDATE =====')
                print(f'  head: {head[:120]}')
                for row in t[1:9]:
                    cells = ['' if c is None else re.sub(r'\s+', ' ', str(c)).strip()
                             for c in row[:10]]
                    if any(cells):
                        print('   | ' + ' | '.join(c[:26] for c in cells))
    return 0


if __name__ == '__main__':
    sys.exit(main())
