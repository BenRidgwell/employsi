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
# RE-PROBED 2026-09-26, ALL 37 REMAINING LISTED CARDS, ZERO RETURNED A FIGURE.
# Every company still without a headcount whose roster id carries a ticker was
# asked again — Catalyst Metals, Core Lithium, Perseus, Magnetite Mines, the
# REITs, the listed investment companies, all of them — and the aggregator has
# none. So the 82-not-carried figure below is not drift; it is still the answer.
# Do not walk that list a ticker at a time again.
#
# Two were then checked at the SOURCE with a browser rather than at the
# aggregator: Catalyst Metals publishes only Extractive Sector Transparency
# Measures Act filings, and Perseus Mining only quarterly reports. Neither
# carries a workforce figure.
#
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
    # THE AGGREGATOR HAD IT ALL ALONG; the map did not. Worth 56 on the
    # archived+live ranking and it was never asked for — 4,500 at 30 June 2026
    # against 3,900, span 1. Both are round because Mader's own FY26 report is
    # round ("over 4,500 employees across more than 685 locations"), so this is
    # the company's own precision, not the aggregator losing digits.
    'perth-mad': 'MAD',
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
    # 69 on the ranking, and another the headless browser reached — the investor
    # centre lists its reports in JavaScript.
    #
    # p44 "Gender composition by role as at 30 June 2026 (with headcounts)", whose
    # Total row reads "Total5 FY26: 3,423". A head count, stated as at a date.
    #
    # NO PRIOR YEAR, AND THE ARITHMETIC IS WHY. That table's FY25 line is a
    # CHANGE, not a level — "FY25: -626" — which would put FY25 at 4,049, while
    # the FY25 report's own prose says "we now have 4,043 employees". Six apart,
    # and nothing in either document reconciles them. Its gender columns do not
    # close either: 1,244 + 2,135 + 7 is 3,386, and the 30 people the page says
    # did not disclose leave 3,416 against a stated 3,423. So the total is taken
    # as stated and no comparison is built on top of it — the same call as
    # Brisbane Catholic Education, for the same reason.
    'nz-spark-new-zealand': dict(
        url='https://investors.sparknz.co.nz/FormBuilder/_Resource/_module/'
            'gXbeer80tkeL4nEaF-kwFA/doc/FY26_Annual_Report.pdf',
        needle='Gender composition by role as at 30 June 2026',
        find=r'Total\d?\s+FY26:\s+([\d,]+)',
        proof=r'as at 30 June 2026',
        asof='Jun 2026'),
    # 99 on the archived+live ranking, and the first company reached by driving a
    # HEADLESS BROWSER from this sandbox — its investor site renders its report
    # list in JavaScript, so nothing was in the HTML a plain fetch returns.
    #
    # p162 "Five year summary": header 2022 2023 2024 2025 2026, then
    # "People numbers" 7,375 6,564 7,141 7,506 7,629. The document states its
    # basis on p42 — "workforce by headcount as at 31 March 2026" — so this is a
    # head count at a 31 March balance date, not an FTE.
    #
    # CHECKED AGAINST THE DOCUMENT TWICE. The same page breaks the total down by
    # FUNCTION (969 + 4,726 + 1,568 + 366) and by REGION (3,897 + 2,724 + 408 +
    # 600), and both sum to 7,629. Two independent breakdowns agreeing is what
    # makes the fifth column the right one to read; the FY25 report's own series
    # ends 7,506, which is this one's fourth column, and corroborates it again.
    # 204 on the archived+live ranking — the largest card left in the gap with no
    # recorded reason, and the largest private employer among them.
    #
    # THE FIGURE IS A DENOMINATOR, NOT A WORKFORCE TABLE, and that is the only
    # place the report states it. p70, under Reportable conduct: "With a
    # workforce of 12,656 in 2025, the Thiess Group had a complaint report rate
    # of 1.11 per 100 workers compared with 1.41 in 2024." There is no people
    # table anywhere in the 82 pages — the data appendix carries emissions and
    # water, not headcount — and every other mention is rounded ("a workforce of
    # over 12,500", p9). So the precise number exists because a rate needed
    # dividing by it.
    #
    # NO PRIOR YEAR, AND THE TEMPTATION TO DERIVE ONE IS THE REASON TO SAY SO.
    # The same sentence gives 1.41 per 100 workers for 2024, and the page gives
    # this year's complaint count, so a 2024 workforce could be reconstructed
    # from a 2024 complaint count — which the report does not print. Anything
    # built from the rate alone would be a formula over a hash, not a source.
    #
    # IT IS THE GROUP, AND THE CARD IS THE GROUP'S ONLY CARD. The figure covers
    # Thiess plus MACA, Fleetco and the 88%-owned RTL; none of those three is a
    # roster company, so nothing here double counts, and no narrower figure is
    # published. Checked against cityRosters.ts 2026-09-27.
    #
    # A CALENDAR YEAR, NOT A FINANCIAL ONE — p3, "from 1 January 2025 to
    # 31 December 2025", which `doc_proof` holds the spec to.
    'priv-thiess': dict(
        url='https://thiess.com/uploads/Thiess-Group-2025-Sustainability-Report.pdf',
        needle='With a workforce of',
        find=r'With a workforce of ([\d,]+) in 2025, the Thiess Group',
        proof=r'per 100 workers compared with [\d.]+ in 2024',
        doc_proof=r'from 1 January 2025 to 31 December 2025',
        asof='Dec 2025'),
    'nz-fisher-and-paykel-healthcare': dict(
        url='https://resources.fphcare.com/content/fph-fy26-full-year-report.pdf',
        needle='PEOPLE NUMBERS',
        find=r'People numbers\d?\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)',
        col=5, prev_col=4,
        sums=[dict(what='the by-function rows',
                   labels=['Research and development', 'Manufacturing and operations',
                           'Sales, marketing and distribution',
                           'Management and administration'],
                   ncols=5, idx=4),
              dict(what='the by-region rows',
                   labels=['New Zealand', 'North America', 'Europe', 'Rest of World'],
                   ncols=5, idx=4)],
        proof=r'2022 2023 2024 2025 2026',
        span=1, asof='Mar 2026'),
}


# Companies whose OWN report was found and read, and which does not carry a total
# workforce figure. Recorded because "not filed" and "checked, and the document
# does not say" are different facts, and only the second one stops the next pass
# repeating the hunt. Printed at the end of a run so it stays visible.
#
# THE COMMON SHAPE IS AN UNDATED WEBSITE NUMBER. Several of these publish a staff
# count on an About page — Fletcher Building "more than 9,000 people", Linfox
# "24,000+ People", Contact Energy "more than 1,200 people" — with no as-at date
# anywhere near it. `asof` is not optional in Headcount, and dating a marketing
# page to whenever it was last edited would be inventing the one fact that makes
# a figure worth showing.
NO_FIGURE_PUBLISHED = {
    # Checked at the SOURCE with a browser after the aggregator returned nothing
    # for all 37 remaining listed cards.
    'perth-cyl':
        'its own site publishes only Extractive Sector Transparency Measures Act '
        'filings — payments to governments, not people — and no annual report '
        'carrying a workforce figure',
    'pru':
        'its own site publishes quarterly reports only; none carries a workforce '
        'figure',
    'nz-fletcher-building':
        'annual report FOUND and read — the browser located '
        'assets/4-investor-centre/annual-reports/2026-annual-report.pdf, which a '
        'plain fetch cannot reach because the investor pages render in JS. 81 '
        'pages of financial statements with no total employee count in them; the '
        'only staff disclosure is the Companies Act one, how many employees earn '
        'over $100k in $10,000 brackets. Website says "more than 9,000 people", '
        'undated',
    'nz-contact-energy':
        'the 2026 Integrated Report downloaded and scanned: no total headcount or '
        'FTE stated anywhere in 138 pages. Website says "more than 1,200 people", '
        'undated',
    'priv-linfox':
        'private, no annual report. Its homepage says "24,000+ People" across Asia '
        'Pacific, undated',
    'nz-auckland-international-airport':
        'behind a Cloudflare interstitial that a WARMED browser does clear — but '
        'its investor pages then carry only meeting notices and a PwC summary, no '
        'annual report with a staff figure',
    'nz-reserve-bank-of-new-zealand':
        'Cloudflare interstitial does NOT clear for this host even warmed, over '
        'twelve waits; rbnz.govt.nz also 403s a plain fetch on every path tried',
    'nz-mercury-nz':
        'site clears and renders, but no annual-report PDF is reachable from its '
        'navigation',
    'nz-meridian-energy':
        'results-and-reports path 404s and no annual-report PDF appears in its '
        'navigation',
    'nz-transpower-new-zealand-limited':
        'an SOE that must report, but its sitemap of 86 KB holds no annual-report '
        'URL and every guessed path 404s',
    'nz-victoria-university-of-wellington':
        'its governance/annual-reports page renders with no PDF links at all',
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

    # AN OPTIONAL WHOLE-DOCUMENT ASSERTION, for a report whose PERIOD is stated
    # in its front matter rather than beside the number. Thiess publishes a
    # CALENDAR-year sustainability report and says so once, on p3: "from
    # 1 January 2025 to 31 December 2025". Nothing on the page carrying the
    # figure repeats it, so `proof` — which only ever sees the needle's pages —
    # cannot reach it, and without this the spec would be asserting the sentence
    # and assuming the year. A sustainability report moving to a June balance
    # date would then shift every figure in it by six months in silence.
    if spec.get('doc_proof'):
        with pdfplumber.open(_io.BytesIO(blob)) as pdf:
            whole = '\n'.join((pg.extract_text() or '') for pg in pdf.pages)
        if not re.search(spec['doc_proof'], whole):
            raise RuntimeError(f'{cid}: the report no longer states '
                               f'{spec["doc_proof"]!r} anywhere, so its reporting '
                               f'period can no longer be shown to end {spec["asof"]}')
    def g(i):
        return int(hits[0].group(i).replace(',', ''))

    now = g(spec.get('col', 1))
    if now <= 0:
        raise RuntimeError(f'{cid}: parsed a non-positive figure ({now})')
    prev = spec.get('prev')
    if spec.get('prev_col'):
        prev = g(spec['prev_col'])

    # A COMPONENT RECONCILIATION, where the document gives one. Fisher & Paykel
    # publishes its head count broken down TWICE — by function and by region —
    # and both breakdowns sum to the same total, so the parse can be checked
    # against the document twice over rather than trusted. `labels` names the
    # rows, `ncols` how many year columns each carries and `idx` which of them
    # the figure was taken from, so a spec that reads the wrong COLUMN fails
    # here even though its regex matched cleanly.
    for part in spec.get('sums', []):
        total = 0
        for label in part['labels']:
            pat = re.escape(label) + r'((?:\s+[\d,]+){%d})(?:\s|$)' % part['ncols']
            found = [m for t in pages for m in re.finditer(pat, t)]
            if len(found) != 1:
                raise RuntimeError(f'{cid}: component {label!r} matched '
                                   f'{len(found)} times, not once')
            nums = re.findall(r'[\d,]+', found[0].group(1))
            total += int(nums[part['idx']].replace(',', ''))
        if total != now:
            raise RuntimeError(f'{cid}: {part["what"]} sum to {total:,} against a '
                               f'stated {now:,} — the column or the rows are wrong')
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
    if NO_FIGURE_PUBLISHED:
        print(f'\n{len(NO_FIGURE_PUBLISHED)} companies whose own report was READ and '
              f'carries no total workforce figure:')
        for cid in sorted(NO_FIGURE_PUBLISHED):
            print(f'  {cid}: {NO_FIGURE_PUBLISHED[cid]}')


if __name__ == '__main__':
    main()
