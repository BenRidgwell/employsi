#!/usr/bin/env python3
"""Real workforce figures from the ACNC register, for roster cards that are
registered charities.

WHY A FIFTH SOURCE. Every other source here reaches a KIND of employer: an
annual report reaches listed companies, WGEA reaches non-public-sector employers
with 100+ Australian staff, the state bulletins reach public servants. A
charity that is none of those falls through all of them — and the Australian
Charities and Not-for-profits Commission collects exactly the figure needed,
annually, from all 54,000 of them, and publishes it on data.gov.au.

MATCHING IS BY ABN AND ONLY BY ABN, which is the whole safety property of this
file. A name search over 54,000 charities is a machine for producing confident
nonsense: asked for the gap's companies it offered "The Roman Catholic Trust
Corporation For The Diocese Of Rockhampton" for Walker Corporation, "The
Corporation Of The Diocesan Synod Of Northern Queensland" for Teach Queensland
and "Milk Crate Theatre" for The a2 Milk Company — each a real charity with a
real staff count, none of them the card. So nothing is scored. Every entry below
is one ABN that was looked up and read.

THE AS-AT DATE COMES FROM EACH CHARITY'S OWN REPORTING PERIOD, not from the
dataset's year, and that is not a detail. The 2024 Annual Information Statement
holds Legal Aid NSW's year to 30 June 2024 and Nan Tien Institute's year to
31 December 2024 — six months apart in the same file. Labelling both "2024"
would put one of them half a year wrong, so `fin report to` is read per row.

THE PRIOR YEAR IS MATCHED BY ABN IN THE PREVIOUS DATASET, so both readings are
the same charity answering the same question a year apart. A charity absent from
the earlier file gets no `prev` and no `yoy` rather than a comparison against
something else.

FTE, NOT THE HEAD-COUNT COLUMNS. The register carries both: three head-count
columns (full time, part time, casual) and one "total full time equivalent
staff". The FTE is a single figure the charity stated; the head count would be a
sum this script computed, and the two answer different questions. Rows are
marked `fte` so the card labels them "Workforce FTE" rather than putting two
measurements under one word — the same rule Queensland and the NSW health
appendix follow.

Run: python3 scripts/gen-acnc-workforce.py
"""
import csv
import json
import os
import re
import sys
import urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/acncWorkforce.ts'
CACHE = os.environ.get('ACNC_CACHE') or os.path.join(ROOT, '.acnc-cache')
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')

# The newest Annual Information Statement dataset, and the one before it for the
# comparison. Resource ids rather than a search, so a run cannot silently pick up
# a different year's file.
FILES = [
    ('2024', 'https://data.gov.au/data/dataset/276ec1bc-4971-461c-88bc-be9f3c99a0f8/'
             'resource/710630ea-1202-4bbb-95f7-3973a972ddf8/download/datadotgov_ais24.csv'),
    ('2023', 'https://data.gov.au/data/dataset/ff6905d6-9d5d-4ef1-8478-72b833864fb7/'
             'resource/2b0fb746-57c5-4523-bb4c-74b7b78279d9/download/datadotgov_ais23.csv'),
]

# Roster company id -> (ABN, the charity name the register uses).
#
# THE NAME IS HERE TO BE CHECKED AGAINST, NOT TO MATCH ON. The load fails if the
# ABN's row no longer carries this name, because an ABN being reassigned or a
# charity being absorbed would otherwise file a different organisation's staff
# under this card without a word.
ACNC = {
    # Legal Aid NSW is the Legal Aid Commission of NSW, established under the
    # Legal Aid Commission Act 1979. NOT inside the Communities and Justice
    # figure already filed: that department's own report lists the related
    # entities it includes — the Aboriginal Housing Office, NSW Land and Housing
    # Corporation and the Teacher Housing Authority — and Legal Aid is not among
    # them. Same portfolio, different agency, so this is not a double count.
    'nsw-gov-legal-aid-nsw': ('81173463438', 'Legal Aid Commission Of NSW'),
    # Nan Tien Institute closes the "under the WGEA threshold" route. It was
    # refused there on the reasoning that the Act reaches employers with 100+
    # Australian staff and this one has fewer — which the register now confirms
    # rather than assumes: 13 full time, 7 part time, 16 FTE.
    'uni-nan-tien-institute': ('80139338819', 'Nan Tien Institute Limited'),
}


def grab(url):
    """Download once and keep it. These files are ~37 MB each."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.rsplit('/', 1)[-1])
    if not os.path.exists(path):
        print(f'  fetching {os.path.basename(path)} …', file=sys.stderr)
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=600) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def rows_for(path, abns):
    """The register rows for the ABNs wanted, and nothing else in memory."""
    out = {}
    with open(path, encoding='utf-8-sig', errors='replace') as f:
        for r in csv.DictReader(f):
            abn = (r.get('abn') or '').strip()
            if abn in abns:
                out[abn] = r
    return out


def fte(row):
    v = (row.get('total full time equivalent staff') or '').strip()
    return float(v) if re.fullmatch(r'\d+(?:\.\d+)?', v) else None


MONTH = {1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun',
         7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec'}


def asof_of(row):
    """'Jun 2024' from the charity's own reporting period end."""
    m = re.fullmatch(r'(\d{2})/(\d{2})/(\d{4})', (row.get('fin report to') or '').strip())
    if not m:
        return None
    return f'{MONTH[int(m.group(2))]} {m.group(3)}'


def main():
    abns = {abn for abn, _ in ACNC.values()}
    loaded = [(year, rows_for(grab(url), abns)) for year, url in FILES]
    (newest_year, newest), (prior_year, prior) = loaded[0], loaded[1]

    out, problems = {}, []
    for cid, (abn, expect) in sorted(ACNC.items()):
        row = newest.get(abn)
        if not row:
            problems.append(f'{cid}: ABN {abn} is not in the {newest_year} register')
            continue
        got = (row.get('charity name') or '').strip()
        if got.lower() != expect.lower():
            problems.append(f'{cid}: ABN {abn} now reads {got!r}, not {expect!r} — '
                            f'the ABN may have been reassigned, so nothing is filed')
            continue
        now, asof = fte(row), asof_of(row)
        if now is None or not now > 0:
            problems.append(f'{cid}: no positive FTE in the {newest_year} register')
            continue
        if not asof:
            problems.append(f'{cid}: no readable reporting period end')
            continue

        # THE PRIOR READING MUST BE A DIFFERENT PERIOD, not just a different
        # file. A charity that lodged late can appear in two datasets with one
        # reporting period, and calling that a year-on-year would report a
        # change of zero over no time at all.
        prev, span = None, 0
        p = prior.get(abn)
        if p and (p.get('charity name') or '').strip().lower() == expect.lower():
            pf, pa = fte(p), asof_of(p)
            if pf and pf > 0 and pa and pa != asof:
                prev, span = pf, 1
        rec = {'now': now, 'prev': prev, 'asof': asof, 'span': span,
               'yoy': None if not prev else round((now - prev) / prev * 100, 1)}
        out[cid] = rec
        tail = '' if prev is None else f' (prev {prev:,.2f}, {rec["yoy"]:+.1f}%)'
        print(f'  {cid}: {now:,.2f} FTE as at {asof}{tail}', file=sys.stderr)

    for p in problems:
        print(f'  PROBLEM {p}', file=sys.stderr)
    if not out:
        raise SystemExit('ACNC: nothing resolved — refusing to write an empty file')

    L = ['// GENERATED — do not edit by hand. Run scripts/gen-acnc-workforce.py.',
         '// Workforce FTE from the ACNC Annual Information Statement register, for',
         '// roster cards that are registered charities and are reached by none of the',
         '// other sources — not listed, not in WGEA, not a public servant.',
         '//',
         '// Matched by ABN ONLY. A name search over 54,000 charities offers a real',
         '// staff count for the wrong organisation every time, so every entry in the',
         '// generator is one ABN that was looked up and read, and the load fails if',
         "// that ABN's registered name ever changes.",
         '//',
         '// `asof` is each charity\'s OWN reporting period end, never the dataset year:',
         '// the 2024 file holds a year to 30 June for one of these and a year to',
         '// 31 December for the other.',
         '//',
         '// FTE, because the register states it. Its three head-count columns would',
         '// have to be summed here, and a sum of this script is not a figure the',
         '// charity reported.',
         'import type { Headcount } from "./companyHeadcount";',
         'export const ACNC_HEADCOUNT: Record<string, Headcount> = {']
    for cid in sorted(out):
        v = out[cid]
        prev_s = '' if not v['prev'] else f"prev: {v['prev']}, "
        yoy_s = 'null' if v['yoy'] is None else v['yoy']
        L.append(f'  {json.dumps(cid)}: {{ now: {v["now"]}, {prev_s}yoy: {yoy_s}, '
                 f'asof: {json.dumps(v["asof"])}, span: {v["span"]}, unit: "fte" }},')
    L += ['};', '']
    open(OUT, 'w').write('\n'.join(L))
    print(f'wrote {OUT} with {len(out)} charities')


if __name__ == '__main__':
    main()
