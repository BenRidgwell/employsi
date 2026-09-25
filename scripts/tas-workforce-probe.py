#!/usr/bin/env python3
"""What the Tasmanian agency table's rows ACTUALLY look like, line by line.

    python3 scripts/tas-workforce-probe.py

WHY THIS EXISTS. load_tas() parses thirteen agencies summing to 20,418 against
the report's own Total row of 32,473 — 63%. The rows it returns each reconcile
across their four columns, so what is filed is right; what is missing is missing
in the PARSE, not in the source. Twelve thousand Tasmanian public servants are
in agencies it never reaches, and six roster cards are blank because of that.

It could not be fixed where the parser is written. dpac.tas.gov.au sits behind a
Cloudflare challenge that only a warmed browser clears, and the PDF answers a
connection reset to the authoring sandbox — so the document the regex is wrong
about is the one document that cannot be opened beside it. Six round trips
through CI is what the Northern Territory cost for the same reason.

So this prints the pages' raw lines with the current regex's verdict against
each one, and the job log carries it back. That channel is the whole point: the
generated file was already being printed and was simply buried too deep to
reach, and eighteen South Australian agencies sat verified-but-unlanded for a
day because of it.

Reports, never gates: it is wired with continue-on-error like every other probe
here, and prints rather than asserting.
"""
import importlib.util
import io
import re
import sys
from pathlib import Path

GEN = Path(__file__).with_name('gen-gov-workforce.py')

# The generator is a hyphenated script, so it cannot be imported by name. It
# guards its own main(), so loading it is side-effect free — that guard is
# worth re-checking if this ever starts doing something surprising.
_spec = importlib.util.spec_from_file_location('gen_gov_workforce', GEN)
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

# The row shape load_tas() looks for today, copied rather than imported because
# it lives inside the loader. If this probe is run after a fix, the two will
# disagree and that is the signal the fix landed.
ROW = re.compile(r'^\s*([A-Za-z][^0-9]{4,}?)\s+'
                 r'([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$')


def editions():
    found = []
    for src in (gen.TAS_SITEMAP, gen.TAS_SEARCH):
        page = gen.fetch(src, via_browser=True, warm=gen.TAS_WARM)
        hits = re.findall(
            r'(?:href="|<loc>\s*)([^"<\s]*State-Service-Workforce-Report[^"<\s]*\.pdf)',
            page, re.I)
        found += [u if u.startswith('http') else 'https://www.dpac.tas.gov.au' + u
                  for u in hits]
        if len(found) >= 4:
            break
    out = {}
    for u in dict.fromkeys(found):
        m = re.search(r'Number-(\d+)-(\d{4})', u, re.I)
        if m:
            out[(int(m.group(2)), int(m.group(1)))] = u
    return out


def main():
    import pdfplumber

    eds = editions()
    print(f'editions found : {sorted(eds)}')
    if not eds:
        print('NO EDITIONS — the sitemap/search shape has moved')
        return 0
    key = sorted(eds, reverse=True)[0]
    url = eds[key]
    print(f'reading        : {key} {url}')

    blob = gen.fetch(url, binary=True, via_browser=True, warm=gen.TAS_WARM)
    print(f'bytes          : {len(blob)}')
    if blob[:4] != b'%PDF':
        print(f'NOT A PDF — starts {blob[:40]!r}')
        return 0

    matched = unmatched = 0
    with pdfplumber.open(io.BytesIO(blob)) as pdf:
        print(f'pages          : {len(pdf.pages)}')
        for i, pg in enumerate(pdf.pages, 1):
            txt = pg.extract_text() or ''
            if 'Employees by Agency' not in txt:
                continue
            print(f'\n=== page {i} : Employees by Agency ===')
            for line in txt.split('\n'):
                m = ROW.match(line)
                if m:
                    n = [int(x.replace(',', '')) for x in m.groups()[1:]]
                    ok = sum(n[:3]) == n[3] and n[3] > 0
                    matched += ok
                    unmatched += not ok
                    tag = 'ROW ' if ok else 'SUM!'
                else:
                    # The interesting ones. A line that carries digits but does
                    # not match is a row the regex has the wrong shape for; a
                    # line with none is prose or a heading.
                    unmatched += bool(re.search(r'\d', line))
                    tag = 'NUM?' if re.search(r'\d', line) else '....'
                print(f'  {tag} |{line}|')

            # The words-only view of the same page. A name that wraps onto its
            # own line is invisible in the line dump above — it reads as prose
            # — but shows up here next to the numbers it belongs with.
            tbl = pg.extract_table()
            if tbl:
                print(f'  -- extract_table(): {len(tbl)} rows --')
                for r in tbl:
                    print(f'     {r}')

    print(f'\nreconciling rows: {matched}   lines with digits that did not: {unmatched}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
