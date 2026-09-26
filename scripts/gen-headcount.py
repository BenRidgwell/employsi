#!/usr/bin/env python3
"""Regenerate src/employsi/data/companyHeadcount.ts — real workforce headcount
(current + prior reporting year) for the AU roster companies, sourced from each
company's annual report via stockanalysis.com (which refreshes once per year
after each filing). Static by design; there is no live HRIS/LinkedIn feed. The
year-on-year growth % is computed from now vs prev.

Usage: python3 scripts/gen-headcount.py
Only keeps figures dated in the last ~2 filing years so stale entries are
dropped rather than shown wrong. Companies not resolved keep their existing
fallback figure in the card (buildPanel).
"""
import re, json, time, urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/companyHeadcount.ts'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
MIN_YEAR = 2024

# company id -> ASX ticker, read by main() below.
#
# THIS MAP IS THE WHOLE REASON COVERAGE WAS SHORT. The fetch and the parse have
# always worked; they were only ever pointed at 45 companies, so 180 listed
# AU/NZ employers on the map had no filed headcount and their cards showed a
# curated number with no YoY, or nothing at all.
#
# Every id added on 2026-09-24 was VERIFIED FIRST against this file's own fetch
# and parse rather than assumed: 204 listed AU/NZ companies were probed, 114
# returned a figure dated MIN_YEAR or later, and only those 114 are here. The
# other 90 are deliberately absent and listed at the bottom of this comment, so
# the next person does not re-probe them one at a time.
#
# NOT ADDED, and why (measured 2026-09-24):
#   * 8 carried a figure older than MIN_YEAR, so the guard below would drop them
#     anyway and the entry would read as a mistake rather than a decision:
#     Lovisa (Jul 2023, and the largest of them by live ads), Bega Cheese,
#     Elders, Lendlease (2018), NextDC (2021), Nib, and two smaller.
#   * 82 are not carried at all — a 404 at the aggregator. That includes EVT,
#     ResMed, Evolution Mining, Adbri and Eagers Automotive.
#   * ALL 14 NZX COMPANIES 404. Xero, Spark, Fletcher Building, Auckland
#     Airport, Mainfreight and the rest. stockanalysis.com carries no NZ
#     listings at /quote/nzx/; /quote/nzse/ and /quote/nz/ also 404, and the
#     lowercase and /stocks/ forms redirect back to a 404. New Zealand needs a
#     different source, not another ticker.
#
# Arrow Energy and Jellinbah are private. BHP's employee vs total-workforce
# definition is ambiguous on the aggregator, so its figure comes from the table
# rather than the summary sentence (see parse_table).
ASX = {
    'adelaide-age': 'AGE', 'adelaide-c79': 'C79', 'adelaide-coe': 'COE', 'adelaide-tea': 'TEA',
    'alk': 'ALK', 'asb': 'ASB', 'beach': 'BPT', 'bhp': 'BHP', 'bmn': 'BMN', 'boe': 'BOE',
    'brisbane-alq': 'ALQ', 'brisbane-aqz': 'AQZ', 'brisbane-azj': 'AZJ', 'brisbane-boq': 'BOQ',
    'brisbane-crn': 'CRN', 'brisbane-ctd': 'CTD', 'brisbane-dtl': 'DTL', 'brisbane-elv': 'ELV',
    'brisbane-flt': 'FLT', 'brisbane-mp1': 'MP1', 'brisbane-nsr': 'NSR', 'brisbane-sul': 'SUL',
    'brisbane-sun': 'SUN', 'brisbane-tne': 'TNE', 'brisbane-vgn': 'VGN', 'ccv': 'CCV',
    'cmm': 'CMM', 'cvn': 'CVN', 'cxo': 'CXO', 'del': 'DEL', 'dyl': 'DYL', 'fmg': 'FMG',
    'gmd': 'GMD', 'gor': 'GOR', 'hgo': 'HGO', 'igo': 'IGO', 'ilu': 'ILU', 'jms': 'JMS',
    'ltr': 'LTR', 'mah': 'MAH', 'melbourne-4dx': '4DX', 'melbourne-ann': 'ANN',
    'melbourne-anz': 'ANZ', 'melbourne-ben': 'BEN', 'melbourne-car': 'CAR',
    'melbourne-col': 'COL', 'melbourne-cpu': 'CPU', 'melbourne-csl': 'CSL',
    'melbourne-cwy': 'CWY', 'melbourne-dnl': 'DNL', 'melbourne-hsn': 'HSN',
    'melbourne-jbh': 'JBH', 'melbourne-mpl': 'MPL', 'melbourne-msb': 'MSB',
    'melbourne-nab': 'NAB', 'melbourne-nwl': 'NWL', 'melbourne-ora': 'ORA',
    'melbourne-ori': 'ORI', 'melbourne-pme': 'PME', 'melbourne-pxa': 'PXA',
    'melbourne-rea': 'REA', 'melbourne-reg': 'REG', 'melbourne-reh': 'REH',
    'melbourne-sek': 'SEK', 'melbourne-tcl': 'TCL', 'melbourne-tlc': 'TLC',
    'melbourne-tls': 'TLS', 'melbourne-tlx': 'TLX', 'melbourne-twe': 'TWE',
    'melbourne-vcx': 'VCX', 'melbourne-vea': 'VEA', 'mgt': 'MGT', 'min': 'MIN', 'mmi': 'MMI',
    'mnd': 'MND', 'nhc': 'NHC', 'nst': 'NST', 'nwh': 'NWH', 'pdn': 'PDN', 'perth-drr': 'DRR',
    'perth-emr': 'EMR', 'perth-ggp': 'GGP', 'perth-imd': 'IMD', 'perth-lyc': 'LYC',
    'perth-prn': 'PRN', 'pls': 'PLS', 'pru': 'PRU', 'rio': 'RIO', 'rms': 'RMS', 'rrl': 'RRL',
    's32': 'S32', 'sfr': 'SFR', 'sgq': 'SGQ', 'smr': 'SMR', 'sto': 'STO', 'stx': 'STX',
    'sw1': 'SW1', 'swm': 'SWM', 'sydney-ald': 'ALD', 'sydney-all': 'ALL', 'sydney-amp': 'AMP',
    'sydney-apa': 'APA', 'sydney-asx': 'ASX', 'sydney-aub': 'AUB', 'sydney-brg': 'BRG',
    'sydney-bsl': 'BSL', 'sydney-bxb': 'BXB', 'sydney-cba': 'CBA', 'sydney-cgf': 'CGF',
    'sydney-coh': 'COH', 'sydney-dow': 'DOW', 'sydney-dro': 'DRO', 'sydney-dxs': 'DXS',
    'sydney-edv': 'EDV', 'sydney-eos': 'EOS', 'sydney-gmg': 'GMG', 'sydney-gqg': 'GQG',
    'sydney-gyg': 'GYG', 'sydney-hub': 'HUB', 'sydney-hvn': 'HVN', 'sydney-iag': 'IAG',
    'sydney-jhx': 'JHX', 'sydney-lnw': 'LNW', 'sydney-mff': 'MFF', 'sydney-mfg': 'MFG',
    'sydney-mgr': 'MGR', 'sydney-mqg': 'MQG', 'sydney-mts': 'MTS', 'sydney-org': 'ORG',
    'sydney-ppt': 'PPT', 'sydney-qan': 'QAN', 'sydney-qbe': 'QBE', 'sydney-qub': 'QUB',
    'sydney-rdx': 'RDX', 'sydney-rhc': 'RHC', 'sydney-rwc': 'RWC', 'sydney-scg': 'SCG',
    'sydney-sgh': 'SGH', 'sydney-sgm': 'SGM', 'sydney-shl': 'SHL', 'sydney-sol': 'SOL',
    'sydney-tpg': 'TPG', 'sydney-vnt': 'VNT', 'sydney-wbc': 'WBC', 'sydney-whc': 'WHC',
    'sydney-wor': 'WOR', 'sydney-wow': 'WOW', 'sydney-wtc': 'WTC', 'sydney-yal': 'YAL',
    'sydney-zip': 'ZIP', 'wds': 'WDS', 'wes': 'WES', 'wgx': 'WGX',
}
# THE ONE NEW ZEALAND COMPANY THE AGGREGATOR CARRIES, and it is carried under
# ASX rather than NZX. The comment above says "ALL 14 NZX COMPANIES 404", which
# was measured and is still true of the NZX path — /quote/nzx/XRO/ 404s today.
# But Xero's primary listing is the ASX, so /quote/asx/XRO/ answers 200 with a
# current figure, and it was never tried because the roster files Xero as NZ.
# Re-probed 2026-09-25: every other NZ company 404s on the ASX path too — FPH,
# AIA, SPK, MCY, FBU, SKC, A2M, IFT, MEL, CEN, CNU, MFT, FSF, all of them — so
# this is one company, not a route. Do not re-probe the list; do re-probe if a
# NZ company ever moves its primary listing.
NZ_VIA_ASX = {'nz-xero': 'XRO'}

US = {'chevron': 'CVX', 'perth-aa': 'AA', 'rio': 'RIO', 'shell': 'SHEL'}  # dual-listed / global majors (Alcoa is NYSE-only, Perth ops)

# ── Figures read from the company's OWN annual report ────────────────────────
#
# WHY A SECOND PATH AT ALL. The aggregator carries listed companies and nothing
# else, so the largest employers in the gap have no route through it however
# long the ticker map grows — the biggest of them is a Catholic school system.
# Their own annual reports are the source, and each is READ here rather than
# transcribed, so the figure on the card cannot drift from the document.
#
# EVERY SPEC CARRIES ITS OWN PROOF, and the proof is what makes this safe:
#   * `find` must match EXACTLY ONCE on the page it is sought on. A regex that
#     matches twice is ambiguous and raises rather than quietly taking the first.
#   * `proof` is the date the document itself states for that figure. If the
#     report is restyled and the date moves, the load fails instead of carrying
#     a number whose basis has changed underneath it.
#
# THE MIN_YEAR FLOOR DOES NOT APPLY HERE, deliberately, and the reason is not
# laziness. That floor exists because a stale figure from the AGGREGATOR means
# the aggregator failed to refresh — the company filed and the mirror did not.
# Here the staleness belongs to the publisher: Brisbane Catholic Education's
# most recent annual report is 2023 because it has not published since, which
# the card states as "Feb 2023" rather than implying currency. An em dash is
# not more honest than a dated figure; it is only less informative.
OWN_REPORT = {
    # THE LARGEST BLANK CARD IN THE WHOLE GAP: 1,268 archived ads and 555 live.
    #
    # NO PRIOR YEAR, AND THAT IS THE WHOLE POINT OF READING THE FOOTNOTES. The
    # 2023 report says "10,756 employees (headcount)" with footnote 4 — "Does
    # not include relief staff. Data as at State Census date (23/02/2023)". The
    # 2022 report says "12,500 employees (headcount)" and carries NO such
    # qualifier; its footnote 4 attaches to a different bullet entirely. So the
    # two are not the same measure, and 12,500 -> 10,756 would publish a −14%
    # that is mostly the relief-staff exclusion. That is the "never compare two
    # days measured different ways" rule, and it is why `prev` is absent.
    #
    # The website still says "more than 12,500 employees" today, which matches
    # the 2022 basis and is undated — so it cannot be filed either, and its
    # disagreement with the 2023 report is itself the evidence that the basis
    # changed rather than the workforce.
    'priv-brisbane-catholic-education': dict(
        url='https://www.bne.catholic.edu.au/ArticleDocuments/661/'
            '2023%20BCE%20Annual%20Report.pdf',
        needle='Our Employees',
        find=r'([\d,]+) employees \(headcount\)',
        proof=r'Data as at State Census date \(23/02/2023\)',
        asof='Feb 2023'),
}


def own_report(cid, spec):
    """Read one company's own annual report. -> a Headcount row, or raises."""
    import io as _io
    import pdfplumber

    req = urllib.request.Request(spec['url'], headers={'User-Agent': UA})
    blob = urllib.request.urlopen(req, timeout=90).read()
    if blob[:4] != b'%PDF':
        raise RuntimeError(f'{cid}: not a PDF — starts {blob[:40]!r}')

    with pdfplumber.open(_io.BytesIO(blob)) as pdf:
        pages = [t for t in (pg.extract_text() or '' for pg in pdf.pages)
                 if spec['needle'] in t]
    if not pages:
        raise RuntimeError(f'{cid}: no page contains {spec["needle"]!r}')
    hits = [m for t in pages for m in re.finditer(spec['find'], t)]
    if len(hits) != 1:
        raise RuntimeError(f'{cid}: {spec["find"]!r} matched {len(hits)} times, not once '
                           f'— ambiguous, so nothing is filed')
    if not any(re.search(spec['proof'], t) for t in pages):
        raise RuntimeError(f'{cid}: the page no longer states {spec["proof"]!r}, so '
                           f'{spec["asof"]} can no longer be shown to be its date')
    now = int(hits[0].group(1).replace(',', ''))
    if now <= 0:
        raise RuntimeError(f'{cid}: parsed a non-positive figure ({now})')
    prev = spec.get('prev')
    return {'now': now, 'prev': prev, 'asof': spec['asof'],
            'yr': int(re.search(r'(20\d\d)', spec['asof']).group(1)),
            'span': spec.get('span', 0) if prev else 0}


SENT = re.compile(
    r'had ([\d,]+) employees as of ([A-Za-z0-9, ]+?)\. The number of employees '
    r'(?:(increased|decreased) by ([\d,]+) or (-?[\d.]+)%|(did not change|remained))', re.I)


def fetch(url):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}),
                                      timeout=25).read().decode('utf-8', 'replace')
    except Exception:
        return ''


def parse_table(h):
    """Fallback: read the page's own Date/Employees table.

    Not every company page carries the "had N employees as of ..." summary
    sentence (BHP's does not), but they all render the historical table. Reading
    it directly keeps the generator working for those companies instead of
    silently skipping them — which is what left BHP out of COMPANY_HEADCOUNT and
    sent its card to the synthetic feed."""
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', h, re.S):
        cells = [re.sub(r'<[^>]+>', '', c).strip()
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S)]
        if len(cells) < 2:
            continue
        ym = re.search(r'(20\d\d)', cells[0])
        num = re.fullmatch(r'[\d,]+', cells[1] or '')
        if ym and num:
            rows.append((int(ym.group(1)), cells[0], int(cells[1].replace(',', ''))))
    if len(rows) < 2:
        return None
    rows.sort(key=lambda r: r[0], reverse=True)
    (yr, asof, cur), (pyr, _, prev) = rows[0], rows[1]
    # THE TWO NEWEST ROWS ARE NOT NECESSARILY CONSECUTIVE YEARS, and calling
    # their difference "YoY" is how Qantas came out at +60.0%. Its table runs
    # Jun 2026, Jun 2023, Jun 2022 — the aggregator simply has no 2024 or 2025
    # row — so 20,000 -> 32,000 is a THREE-year change. Measured 2026-09-24.
    # The span travels with the figure so the card can name it.
    return {'now': cur, 'prev': prev, 'asof': asof, 'yr': yr, 'span': yr - pyr}


def parse(h):
    m = SENT.search(h)
    if not m:
        return parse_table(h)
    cur = int(m.group(1).replace(',', ''))
    asof = m.group(2).strip()
    ym = re.search(r'20\d\d', asof)
    yr = int(ym.group(0)) if ym else 0
    if m.group(3):
        delta = int(m.group(4).replace(',', ''))
        prev = cur + delta if m.group(3).lower() == 'decreased' else cur - delta
    else:
        prev = cur
    # The SENTENCE never says over what period it changed, so the span is read
    # off the table on the same page — the only place the two dates appear. A
    # page with no readable table leaves span 0, which main() treats as unknown
    # and reports as a plain count with no change at all.
    t = parse_table(h)
    span = t['span'] if t and t.get('span') else 0
    return {'now': cur, 'prev': prev, 'asof': asof, 'yr': yr, 'span': span}


def short(asof):
    m = re.match(r'([A-Za-z]+)\s+\d+,\s*(20\d\d)', asof)
    return f'{m.group(1)[:3]} {m.group(2)}' if m else asof


def main():
    data = {}
    for cid, tk in {**ASX, **NZ_VIA_ASX}.items():
        r = parse(fetch(f'https://stockanalysis.com/quote/asx/{tk}/employees/'))
        if (not r or r['yr'] < MIN_YEAR) and cid in US:
            r2 = parse(fetch(f'https://stockanalysis.com/stocks/{US[cid]}/employees/'))
            if r2 and r2['yr'] >= MIN_YEAR:
                r = r2
        if r and r['yr'] >= MIN_YEAR:
            data[cid] = r
        time.sleep(0.25)
    for cid, tk in US.items():
        if data.get(cid):
            continue
        r = parse(fetch(f'https://stockanalysis.com/stocks/{tk}/employees/'))
        if r and r['yr'] >= MIN_YEAR:
            data[cid] = r
        time.sleep(0.25)

    # The company's OWN annual report, for employers the aggregator cannot
    # reach at all. Read last so an aggregator row always wins — the aggregator
    # refreshes yearly on its own, and a spec here is pinned to one document.
    #
    # A FAILURE HERE IS REPORTED AND DOES NOT STOP THE RUN, because the rest of
    # the file is 138 companies that have nothing to do with this one document.
    # It is not silent either: the reason is printed, and the row is simply
    # absent, which the gap script will show as a card that went back to blank.
    for cid, spec in OWN_REPORT.items():
        if cid in data:
            continue
        try:
            data[cid] = own_report(cid, spec)
            print(f'  own report: {cid} -> {data[cid]["now"]:,} as at {spec["asof"]}')
        except Exception as e:                                    # noqa: BLE001
            print(f'  own report FAILED for {cid}: {type(e).__name__}: {e}')

    L = [
        '// GENERATED — do not edit by hand. Run scripts/gen-headcount.py.',
        "// Real workforce headcount for the current + prior reporting year, sourced",
        "// from each company's annual report — via stockanalysis.com for listed",
        '// companies, and read straight out of the report itself for employers the',
        '// aggregator does not carry at all. Static by design — there is no live HRIS/',
        '// LinkedIn feed — with the year-on-year growth % computed from now vs prev.',
        '//',
        '// `span` is the YEARS BETWEEN the two readings, and it is not always 1.',
        '// The aggregator skips years for some companies — Qantas runs Jun 2026,',
        '// Jun 2023, Jun 2022 — so its two newest rows are three years apart and',
        "// calling their difference year-on-year reported +60.0%. `yoy` is null",
        '// where the span could not be established at all; where it is known the',
        '// card names it rather than assuming a year.',
        'export interface Headcount {',
        '  now: number;',
        '  /**',
        '   * The earlier reading. OPTIONAL, because some sources have no',
        '   * comparator to give: Western Australia restructured its',
        '   * departments in 2025, so the 2025-26 workforce bulletin reports a',
        '   * Department of Transport and Major Infrastructure that the 2024-25',
        '   * edition has never heard of — it was assembled that year out of',
        '   * parts of two others. Absent means "no prior reading exists",',
        '   * which is why it is absent rather than 0: a 0 would be a reading',
        '   * of nobody, and every consumer here treats 0 as unknown already.',
        '   * `yoy` is null alongside it and the card shows no delta.',
        '   */',
        '  prev?: number;',
        '  /** Change from `prev` to `now`, over `span` years. Null when unknown. */',
        '  yoy: number | null;',
        '  asof: string;',
        '  /** Years between the two readings. 0 when the source did not say. */',
        '  span: number;',
        '  /**',
        '   * What the figure COUNTS. Listed companies and most public-sector',
        '   * bulletins report people; Queensland publishes only full-time',
        '   * equivalents at agency level, and FTE is systematically lower than a',
        '   * head count because a part-timer is a fraction of one. The card',
        '   * labels the tile from this rather than calling both "Headcount".',
        '   */',
        "  unit?: \"headcount\" | \"fte\";",
        '}',
        'export const COMPANY_HEADCOUNT: Record<string, Headcount> = {',
    ]
    for cid in sorted(data):
        v = data[cid]
        span = v.get('span') or 0
        yoy = (round((v['now'] - v['prev']) / v['prev'] * 100, 1)
               if v.get('prev') and span else None)
        yoy_s = 'null' if yoy is None else str(yoy)
        # prev is OMITTED rather than written as None when there is no prior
        # reading — `prev: None` is not TypeScript, and a 0 would be a reading of
        # nobody. The interface above already declares it optional for exactly
        # this case; the own-report path is the first thing here to use it.
        prev_s = '' if not v.get('prev') else f"prev: {v['prev']}, "
        L.append(f"  {cid!r}: {{ now: {v['now']}, {prev_s}yoy: {yoy_s}, "
                 f"asof: {short(v['asof'])!r}, span: {span} }},")
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    print(f'wrote {OUT} with {len(data)} companies')


if __name__ == '__main__':
    main()
