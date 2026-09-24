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
        hits = []
        for i, page in enumerate(pdf.pages):
            txt = page.extract_text() or ''
            named = [w for w in WANT if w.lower() in txt.lower()]
            tables = page.extract_tables() or []
            if named or tables:
                hits.append((i + 1, named, len(tables)))
        print(f'pages naming a roster agency or holding a table: {len(hits)}')
        for pno, named, ntab in hits[:25]:
            print(f'  p{pno:<4} tables={ntab:<3} names={named}')

        # The most promising page in full, so the table's real shape is visible.
        best = max(hits, key=lambda h: (len(h[1]), h[2]), default=None)
        if best:
            pno = best[0]
            print(f'\n===== page {pno} tables =====')
            for t in pdf.pages[pno - 1].extract_tables() or []:
                for row in t[:30]:
                    cells = ['' if c is None else re.sub(r'\s+', ' ', str(c)).strip()
                             for c in row[:8]]
                    if any(cells):
                        print('  | ' + ' | '.join(c[:30] for c in cells))
                print('  ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
