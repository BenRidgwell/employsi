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
    # BOTH SOURCES, NO EARLY BREAK — unlike load_tas(), deliberately. The loader
    # stops once the sitemap has four hits, which is enough to build SOME pair
    # and is why it settled on December 2023 while a June 2024 edition existed.
    # Whether a June 2023 edition is reachable at all is the question this probe
    # is asking, so it cannot use a search that stops early.
    out = {}
    for src, label in ((gen.TAS_SITEMAP, 'sitemap'), (gen.TAS_SEARCH, 'search')):
        try:
            page = gen.fetch(src, via_browser=True, warm=gen.TAS_WARM)
        except Exception as e:                      # reports, never gates
            print(f'  {label}: FAILED {e!r}')
            continue
        hits = re.findall(
            r'(?:href="|<loc>\s*)([^"<\s]*State-Service-Workforce-Report[^"<\s]*\.pdf)',
            page, re.I)
        urls = [u if u.startswith('http') else 'https://www.dpac.tas.gov.au' + u
                for u in dict.fromkeys(hits)]
        got = []
        for u in urls:
            m = re.search(r'Number-(\d+)-(\d{4})', u, re.I)
            if m:
                k = (int(m.group(2)), int(m.group(1)))
                got.append(k)
                out.setdefault(k, u)
        print(f'  {label}: {len(urls)} pdf links, editions {sorted(set(got))}')
    return out


def main():
    import pdfplumber

    eds = editions()
    print(f'\nall editions   : {sorted(eds)}')
    if not eds:
        print('NO EDITIONS — the sitemap/search shape has moved')
        return 0

    # What load_tas() would pair today: same report NUMBER, one year apart.
    # No. 1 is the December half and No. 2 the June half, so a pair must share
    # the number — that rule is right and is not what is being questioned here.
    pair = None
    for (yr, no) in sorted(eds, reverse=True):
        if (yr - 1, no) in eds:
            pair = ((yr, no), (yr - 1, no))
            break
    print(f'loader would pair: {pair}')
    newest = sorted(eds, reverse=True)[0]
    print(f'newest edition   : {newest}')

    # The newest FIRST, because if it parses and the pair does not, the answer
    # is about WHICH editions are reachable rather than about the regex.
    want = [newest] + [k for k in (pair or ()) if k != newest]
    for key in want:
        dump(pdfplumber, key, eds[key])
    return 0


def compact(row):
    """pdfplumber pads a merged-cell row with None and ''. Drop them."""
    return [c for c in row if c not in (None, '')]


def dump(pdfplumber, key, url):
    import io as _io
    print(f'\n########## edition {key} ##########')
    print(url)
    try:
        blob = gen.fetch(url, binary=True, via_browser=True, warm=gen.TAS_WARM)
    except Exception as e:
        print(f'  FETCH FAILED {e!r}')
        return
    print(f'bytes          : {len(blob)}')
    if blob[:4] != b'%PDF':
        print(f'NOT A PDF — starts {blob[:40]!r}')
        return

    matched = badline = 0
    with pdfplumber.open(_io.BytesIO(blob)) as pdf:
        print(f'pages          : {len(pdf.pages)}')
        for i, pg in enumerate(pdf.pages, 1):
            txt = pg.extract_text() or ''
            if 'Employees by Agency' not in txt:
                continue
            print(f'\n=== page {i} : lines ===')
            for line in txt.split('\n'):
                m = ROW.match(line)
                if m:
                    n = [int(x.replace(',', '')) for x in m.groups()[1:]]
                    ok = sum(n[:3]) == n[3] and n[3] > 0
                    matched += ok
                    tag = 'ROW ' if ok else 'SUM!'
                else:
                    badline += bool(re.search(r'\d', line))
                    tag = 'NUM?' if re.search(r'\d', line) else '....'
                print(f'  {tag} |{line}|')

            # EVERY table on the page, not just the first. The page carries a
            # head-count table AND an FTE one over the same agencies, and they
            # are told apart by their values: a head count is an integer and an
            # FTE is not. Reading the wrong one would relabel the quantity,
            # which is the exact bug NSW Health had.
            tabs = pg.extract_tables()
            print(f'  -- extract_tables(): {len(tabs)} table(s) --')
            for t, tab in enumerate(tabs):
                rows = [compact(r) for r in tab]
                dec = sum('.' in (r[-1] or '') for r in rows if len(r) > 1)
                print(f'     [table {t}] {len(rows)} rows, {dec} with a decimal total')
                for r in rows:
                    print(f'        {r}')

    print(f'\nedition {key}: reconciling line-rows {matched}, '
          f'lines with digits that did not {badline}')


if __name__ == '__main__':
    sys.exit(main())
