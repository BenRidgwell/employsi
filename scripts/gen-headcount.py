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
import re, json, subprocess, sys, time, urllib.request

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
    # THE REASON THAT WAS HERE WAS A MEASUREMENT OF A URL, NOT OF A COMPANY.
    # It read "results-and-reports path 404s and no annual-report PDF appears in
    # its navigation" — and that path does 404, because the page is at
    # /about-us/investors/reports/annual-results-and-reports, which lists EVERY
    # annual report back to 2006 plus a Data Pack spreadsheet for each of the
    # last three years. Same shape as Victoria University of Wellington's old
    # entry: a dead URL written down as an absent document.
    #
    # FILED FROM THE DATA PACK RATHER THAN THE REPORT, deliberately — see
    # own_workbook() for why the report's own 1,056 is the wrong number. The
    # GRI 2-7 table gives FY26 1,050 and FY25 984, both reconciling exactly:
    # 7 + 78 + 4 + 853 + 108 = 1,050 and 7 + 47 + 6 + 812 + 112 = 984.
    #
    # WHAT THE FIGURE INCLUDES, from the pack's own notes: head count and not
    # FTE, sourced from PayGlobal at the end of the reporting period; casuals
    # in, board and contractors out; 47 of them work for Flux Federation New
    # Zealand. The 560 "workers who are not employees" — mostly contracted ICT
    # support — are correctly outside it.
    #
    # BOTH YEARS RECONCILE FROM ONE LIST OF LABELS, because the years are three
    # groups of the SAME row rather than three tables — FY26's "Casuals" cell is
    # rewritten as "Casual and contractor" where FY25 begins, on the same line.
    # The row is found by its FY26 label and each group is pinned to its year by
    # the column its label sits in.
    # AND THE SAME MISTAKE, WORDED DIFFERENTLY. This card's reason was "an SOE
    # that must report, but its sitemap of 86 KB holds no annual-report URL and
    # every guessed path 404s". The sitemap is 86 KB and no URL in it contains
    # the word "annual" — both true, and the conclusion does not follow. The
    # page is /our-work/investors/reports-and-reviews, it IS in that sitemap,
    # and it lists every report back to FY17. Searching for the word I expected
    # rather than the page that exists is the third instance of this shape in
    # this file, after Victoria University of Wellington and Meridian.
    #
    # p51, the Social metrics table: "Total Transpower employees (headcount)
    # number 1,113 1,080 969" under a header reading "Unit (up/down) 2025/26
    # 2024/25 2023/24". A head count, said to be one, with its years named.
    #
    # `proof` IS THAT HEADER AND THAT IS THE WHOLE GUARD. There is no component
    # breakdown on the page to reconcile against and no second statement of the
    # total anywhere in the document — p67's "Total employees earning $100,000+
    # 946" is a remuneration-band subtotal, not the workforce — so what stands
    # between a wrong column and the card is the assertion that the columns are
    # still 2025/26, 2024/25, 2023/24 in that order. When FY27 shifts them the
    # spec fails loudly instead of filing last year's figure under this year's
    # date.
    #
    # THE CONTROL SAYS THAT PLAINLY RATHER THAN FLATTERINGLY: with `col=2` the
    # spec files 1,080 without complaint, because nothing on the page contradicts
    # it. That is the limit of a table with no components, and `proof` is the
    # only reason `col=1` is the 2025/26 column rather than merely the first one.
    'nz-transpower-new-zealand-limited': dict(
        url='https://static.transpower.co.nz/public/uncontrolled_docs/'
            'Transpower%20Integrated%20Report%20FY26.pdf',
        needle='Workforce composition',
        find=r'Total Transpower employees \(headcount\) number '
             r'([\d,]+) ([\d,]+) ([\d,]+)',
        proof=r'Unit \(up/down\) 2025/26 2024/25 2023/24',
        col=1, prev_col=2,
        asof='Jun 2026', span=1),
    'nz-meridian-energy': dict(
        url='https://www.meridianenergy.co.nz/public/Investors/'
            'Reports-and-presentations/Annual-results-and-reports/2026/'
            'Meridian-Integrated-Report-Data-Pack-June-2026.xlsx',
        sheet='OUR PEOPLE',
        needle='Employees',
        proof=r'GRI 2-7',
        years=('FY26', 'FY25', 'FY24'),
        row='Total',
        comp=('Casuals', 'Fixed-term full time', 'Fixed-term part time',
              'Permanent full time', 'Permanent part time'),
        asof='Jun 2026', span=1),
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
    # ── The six NZX companies left in the gap, 2026-09-28 ─────────────────────
    #
    # WHY THEY WERE ALL STILL BLANK, and it is one fact rather than six: the
    # aggregator carries NZX companies under no path at all. The note above
    # NZ_VIA_ASX records the measurement — /quote/nzx/<TK>/ 404s, and so does
    # /quote/asx/<TK>/ for every NZ company except Xero, whose primary listing is
    # the ASX. So FCG, MFT, ATM, SKC, IFT and CNU were never reachable through
    # the route that fills 155 other cards, and their own reports are the source.
    #
    # FOUR OF THE SIX ARE FILED HERE. Infratil and Chorus are not, and each is
    # recorded in NO_FIGURE_PUBLISHED / FETCH-blocked notes below rather than
    # left looking unexamined.

    # THE FIGURE IS AN FTE, AND IT IS THE FIRST ONE IN THIS FILE. p62: "We
    # directly employ 11,721 people on a full-time equivalent basis, with 89.9%
    # of those based in New Zealand." The appendix on p236 heads the same total
    # "REGION REPORTING (FTE)" and reaches it three independent ways — by region
    # 10,536 + 887 + 298, permanent + temporary 11,472 + 249, and full-time +
    # part-time 11,364 + 357 — all three exactly 11,721. `unit='fte'` is what
    # keeps the tile from calling it a head count.
    #
    # NO PRIOR YEAR, AND THE REPORT ITSELF SAYS WHY. FY25 reads 16,215 against
    # this year's 11,721, which is a −27.7% that never happened: Fonterra sold
    # Mainland Group during FY26. The appendix note on p242 is explicit —
    # "employees of Mainland Group are included in FY24 and FY25 people reporting
    # but not in FY26 data taken as a snapshot on 31 July 2026 (after the
    # divestment had taken place)" — and adds that "comparative periods may not
    # be reported on a consistent basis". A publisher stating that its own
    # comparative is a different scope is the clearest possible case of the rule
    # against comparing two readings measured different ways.
    #
    # THAT SAME NOTE IS THE DATE. Nothing beside the prose figure dates it, and
    # the Co-op's balance date is 31 July, so `doc_proof` holds the spec to the
    # sentence that says 31 July 2026 — if a future report moves the snapshot,
    # the load fails rather than re-dating a figure.
    'nz-fonterra-co-operative-group': dict(
        url='https://view.publitas.com/8079/3380480/pdfs/'
            '22c762e4-da6e-4796-be8c-567b894b8a67.pdf',
        needle='We directly employ',
        find=r'We directly employ ([\d,]+) people on',
        proof=r'full-time equivalent basis',
        doc_proof=r'snapshot on 31 July 2026',
        unit='fte', asof='Jul 2026'),
    # A FULL TILE, because the report prints both years side by side. p13, the
    # operating-statistics spread, carries a TEAM NUMBERS panel headed "THIS YEAR
    # LAST YEAR": New Zealand 2,896 / 2,925, Australia 2,696 / 2,705, Europe
    # 3,079 / 3,083, Americas 1,693 / 1,872, Asia 475 / 545, Total Group 10,839 /
    # 11,130. Both columns reconcile exactly against their own five regions, and
    # `sums` asserts the first one, which is what ties column 1 to the figure
    # filed rather than trusting the header alone.
    #
    # THE 2.8% ON THE KEY-ACHIEVEMENTS PAGE IS NOT PEOPLE GROWTH. p4 sets "$5.38b
    # / 10,839" beside "Group Operating Revenue 2.8%" and the word "People", laid
    # out so the percentage reads as the change in the number next to it. It is
    # the revenue change; team numbers FELL 2.6% this year. Deriving a prior year
    # from it would have published a rise where the report states a fall, which is
    # why the prior year is read from the panel and not reconstructed.
    # THE REASON HERE WAS A MEASUREMENT OF A TRUNCATED URL, and it closed a card
    # that was reachable all along. It said api.nzx.com "serves it with an Akamai
    # 'Access Denied' 403 to this network, with a browser User-Agent and the
    # announcement page as referer alike" — and that was measured against
    #
    #     /public/announcement/478352/attachment/475174
    #
    # which is not the URL NZX publishes. The announcement page's own link carries
    # a trailing filename segment:
    #
    #     /public/announcement/478352/attachment/475174/478352-475174.pdf
    #
    # and THAT downloads 9,646,736 bytes of PDF to a plain urllib fetch, no
    # browser, no referer, no User-Agent games. Measured 2026-09-30. The 403 was
    # real and was about the path, not about the network — the fourth time in this
    # campaign that a measurement of one URL got written down as a measurement of
    # something larger, and the first time it cost a filing.
    #
    # THE ANNOUNCEMENT PAGE IS HOW TO GET THE REAL LINK: www.nzx.com/announcements/
    # <id> renders through the browser and lists every attachment with its full
    # URL. Guessing the path is what produced the old reason.
    #
    # WHAT IS FILED, AND WHY IT IS THE INFOGRAPHIC AND NOT THE ACCOUNTS. p14's
    # value-creation model states "745 employees (420 male | 325 female)" at
    # 30 June 2026, and 420 + 325 = 745, which `parts` asserts. The financial
    # statements have no employee total at all — only the Companies Act
    # remuneration brackets, exactly as at Fletcher Building — so there is no
    # better-placed figure to prefer.
    #
    # p6's "~750 EMPLOYEES NATIONWIDE" is the same workforce rounded, and is NOT
    # used: it cannot serve as `cross`, which demands equality.
    #
    # NO PRIOR YEAR, AND THE NUMBER THAT LOOKS LIKE ONE IS NOT ONE. p63 gives
    # "699 employees in KiwiSaver (30 June 2025: 712 employees)" — that is
    # SCHEME MEMBERSHIP, not the workforce, and 699 + 7 in the Government
    # Superannuation Fund is 706 against a head count of 745, so it does not even
    # cover everyone. Filing 712 as last year would invent a -4.4% out of a
    # KiwiSaver opt-in rate.
    # CONTROLS, 2026-09-30, run against a local copy of the same bytes because
    # own_report opens this 113-page 9.6 MB PDF three times per call:
    #
    #   as written                      -> 745, no prior year
    #   col=2 (male count as the total) -> REJECTED by `parts`: "components sum
    #                                      to 745 against the 420 stated beside
    #                                      them" — so `parts` does fire
    #   `proof` moved to ...2025        -> REJECTED
    #   `parts` removed                 -> still 745, as a removed guard on a
    #                                      correct parse must be; it is the col=2
    #                                      control above that earns it its place
    #   `doc_proof` moved to 2025       -> still 745, ACCEPTED
    #
    # THE LAST ONE IS NOT THE DEFECT IT LOOKS LIKE, and it is worth saying why
    # rather than "fixing" it. Substituting "year ended 30 June 2025" passes
    # because a 2026 annual report states its COMPARATIVE year too — every annual
    # report does. That control therefore proves the 2025 string is present; it
    # says nothing about whether asserting the 2026 one is useful, and it is: a
    # 2025-edition report, or one moved to a March balance date, would not carry
    # "for the year ended 30 June 2026" at all. `doc_proof` stays. (Contrast the
    # EPA spec in gen-gov-workforce.py, where `integers` was DELETED because it
    # genuinely could not fire.)
    'nz-chorus': dict(
        url='https://api.nzx.com/public/announcement/478352/attachment/'
            '475174/478352-475174.pdf',
        needle='How we create value',
        find=r'(\d[\d,]*) employees[^\n]*\n[^\n]*\((\d[\d,]*) male \| (\d[\d,]*) female\)',
        col=1, parts=(2, 3),
        proof=r'CHORUS FULL YEAR RESULTS 2026',
        doc_proof=r'for the year ended 30 June 2026',
        asof='Jun 2026'),

    'nz-mainfreight': dict(
        url='https://www.mainfreight.com/getcontentasset/'
            '9f6d081f-03d5-4e1d-a2be-992dd1ca826c/'
            'dfc3d011-8f63-43f6-9ed8-4b444333a1d0/'
            'mainfreight-2026-annual-report.pdf?language=en',
        needle='TEAM NUMBERS',
        find=r'Total Group ([\d,]+) ([\d,]+)',
        col=1, prev_col=2,
        sums=[dict(what='the five regional team numbers',
                   labels=['New Zealand', 'Australia', 'Europe', 'Americas', 'Asia'],
                   ncols=2, idx=0)],
        proof=r'THIS YEAR LAST YEAR',
        doc_proof=r'for the year ended 31 March 2026',
        span=1, asof='Mar 2026'),
    # p37 "Key metrics data": Gender (as at 30 June 2026) totals 694 team
    # members, and the same page reaches 694 twice more — by age (75 + 492 + 127)
    # and by tenure (353 + 189 + 152). Both are asserted, because the page also
    # carries a COHORT column whose four rows sum to 695: footnote 1 says the CEO
    # is counted as both a Director and an ELT member, so that column is the one
    # breakdown here that does not close, and a spec reading it would be one out.
    #
    # NO PRIOR YEAR, STATED BY THE PUBLISHER. Footnote 4 to that table: "The
    # year-on-year comparison is not directly comparable due to the acquisition of
    # a2 Pōkeno and the divestment of MVM in FY26." The variance columns beside
    # each row are percentage-point moves in the gender split, not changes in the
    # count, so nothing on the page offers a comparable level anyway.
    'nz-the-a2-milk-company': dict(
        url='https://assets-au-01.kc-usercontent.com/'
            'bca3e5d5-83bd-02bf-1c27-acb036630e5b/'
            '34913ff7-ef71-4f17-bdad-f8dc25ec4433/FY26%20Annual%20Report.pdf',
        needle='Key metrics data',
        find=r'Total (\d+) \d+ \d+% \d+ \d+%',
        sums=[dict(what='the three age bands',
                   labels=['Under 30', '30 to 50', 'Over 50'], ncols=1, idx=0),
              dict(what='the three tenure bands',
                   labels=['0–2 Years', '2–5 Years', '5+ Years'], ncols=1, idx=0)],
        proof=r'Gender \(as at 30 June 2026\)',
        asof='Jun 2026'),
    # TWO TOTALS ON ONE PAGE, AND THE SMALLER ONE IS THE TRAP. p24's diversity
    # snapshot gives "No. of employees 4,689 (FY25: 4,592)", footnoted as
    # including full-time, part-time and casual. Eleven lines below, the gender
    # composition table's own "Total workforce" row reads 2180 + 2458 = 4,638
    # (FY25: 4,513) — 51 fewer, because footnote 4 says that row excludes anyone
    # who identifies as gender diverse or declined to identify. Both are labelled
    # as of 30 June 2026 and either would look right on a card; only the first is
    # the workforce. The regex reads the snapshot row by its column shape — the
    # count, two percentages and two ages, with the FY25 line beneath it — so it
    # cannot drift onto the gender table.
    'nz-skycity-entertainment-group': dict(
        url='https://www.skycityentertainmentgroup.com/media/wombx0ml/'
            'skycity-annual-report-2026.pdf',
        needle='DIVERSITY SNAPSHOT',
        find=r'Oldest employee\n([\d,]+) [\d.]+% [\d.]+% \d+ years \d+ years\n'
             r'\(FY25: ([\d,]+)\)',
        col=1, prev_col=2,
        proof=r'workforce as of 30 June 2026',
        span=1, asof='Jun 2026'),
    # ── Three federal agencies the APS Employment Database cannot carry ───────
    #
    # THEY ARE NOT A MATCHING PROBLEM, WHICH IS THE NATURAL FIRST THOUGHT AND
    # COSTS AN AFTERNOON. gen-gov-workforce.py's ALIAS header records the
    # measurement against all 101 published APSC agencies: eleven roster cards
    # are absent under every spelling, because that sheet is an APS Act census
    # and these employ under their own statutes — the Australian Federal Police
    # Act, the Science and Industry Research Act, the Reserve Bank Act. No alias
    # can ever reach them, so their own annual reports are the only route, and
    # this is where the machinery for reading an annual report already lives.
    #
    # `filedHeadcount` CHECKS COMPANY_HEADCOUNT FIRST, so an `aps-` row here
    # fills the card the gov generator correctly cannot. The gov generator still
    # names each of them in NOT_IN_SOURCE, because "absent from the APSC census"
    # stays true and is the fact a future pass needs told.

    # p158, Table A.5 "Employee numbers by functional area – over 5 years":
    # 2024-25 head count 5,998 against 2023-24's 6,618. Its own components sum
    # to both exactly — 1,782 + 1,622 + 266 + 72 + 6 + 775 + 237 + 20 + 1,088 +
    # 130 for this year, and the 2023-24 column likewise — but `sums` CANNOT be
    # used here and the reason is the whole point of `cross` above: the table is
    # printed as two column groups on one page, so every component label appears
    # twice and each would match ambiguously. The check is the prose on p20
    # instead: "On 30 June 2025 we had 5,998 people employed (full-time
    # equivalent of 5,676)".
    #
    # THE HEAD COUNT IS TAKEN, NOT THE FTE, and the table prints both one line
    # apart — 5,998 against 5,675.88. The prose sentence names which is which,
    # which is also why it is the right cross-check rather than a decoration.
    'aps-csiro': dict(
        url='https://www.csiro.au/-/media/About/AnnualReport/Files/2024-25/'
            '25-00169_CORP_REPORT_AnnualReport2024-25_WEB_251022.pdf',
        needle='Employee numbers by functional area',
        find=r'FUNCTIONAL AREA 2023–24 %F 2023–24 2024–25 %F 2024–25[\s\S]*?'
             r'Total headcount ([\d,]+) [\d.]+ ([\d,]+) [\d.]+',
        col=2, prev_col=1,
        proof=r'Table A\.5: Employee numbers by functional area',
        cross=r'On 30 June 2025 we had ([\d,]+) people employed '
              r'\(full-time equivalent of [\d,]+\)',
        span=1, asof='Jun 2025'),
    # p144: "At 30 June 2025, we had 2,039 employees (excluding Note Printing
    # Australia Limited; Graph 3.2.1 and Table 3.2.1), equating to 2,000
    # full-time equivalent employees." Read from the prose because TABLE 3.2.1
    # IS PRINTED ROTATED — pdfplumber returns its header as one character per
    # line ("laicnaniF", "eliforP") and no usable rows at all, so there is no
    # table here to parse however the spec is written.
    #
    # `proof` PINS WHICH OF THE TWO NUMBERS IN THAT SENTENCE IS BEING FILED. It
    # gives a head count and an FTE eight words apart, 2,039 and 2,000, and the
    # clause naming the FTE is what shows 2,039 is not it.
    #
    # NO PRIOR YEAR, THOUGH THE SENTENCE ALMOST OFFERS ONE: it says the figure
    # "represents a 15 per cent increase in our workforce compared with 30 June
    # 2024". Dividing by 1.15 gives 1,773, and any value from 1,765 to 1,781
    # rounds to the same 15 per cent — a reconstruction whose last two digits
    # are invented. The graph beside it carries the series and prints no numbers.
    #
    # NOTE PRINTING AUSTRALIA IS OUTSIDE THE FIGURE, deliberately and by the
    # Bank's own wording. Its 304 permanent staff (p67) are a subsidiary the
    # roster does not carry, so nothing here is missing them twice over.
    'aps-reserve-bank-of-australia': dict(
        url='https://www.rba.gov.au/publications/annual-reports/rba/2025/pdf/'
            'rba-annual-report-2025.pdf',
        needle='At 30 June 2025, we had',
        find=r'At 30 June 2025, we had ([\d,]+) employees',
        proof=r'equating to [\d,]+ full-time equivalent',
        cross=r'As at 30 June 2025, we had ([\d,]+) staff',
        asof='Jun 2025'),
    # p125, Table B3 "Employees by sworn status, band level and gender, as at
    # 30 June 2025": a Total row of fourteen numbers ending 8,328. Cross-checked
    # against p64, "The AFP had 8,328 staff as at 30 June 2025", which then
    # breaks it into the same three subtotals the table prints — 3,578 police
    # officers, 838 protective service officers, 3,912 unsworn staff, summing to
    # 8,328 in both places.
    #
    # NO PRIOR YEAR, AND IT IS RECONSTRUCTIBLE, WHICH IS WHY THE OMISSION IS
    # WRITTEN DOWN RATHER THAN LEFT IMPLICIT. The appendix gives 2023-24 only
    # split in two — Table B6 ongoing and Table B7 non-ongoing — and this year's
    # B4 + B5 do sum to B3's total, so the construction is the report's own and
    # demonstrably sound. It needs a spec that can add two tables on different
    # pages, which this path cannot do yet; a figure with no delta is the honest
    # interim, not a guess.
    'aps-australian-federal-police': dict(
        url='https://www.afp.gov.au/sites/default/files/2025-10/'
            'AFPAnnualReport2024-25.pdf',
        needle='Employees by sworn status, band level and gender',
        find=r'\nTotal (?:[\d,]+ ){13}([\d,]+)',
        proof=r'band level and gender, as at 30 June 2025',
        cross=r'The AFP had ([\d,]+) staff as at 30 June 2025',
        asof='Jun 2025'),
    # p59, under "Workforce composition": "As at 30 June 2025, APRA had 897
    # employees on a permanent or fixed-term contract basis, compared with 870 at
    # the end of the 2024 financial year." Both years in one sentence on one
    # stated basis, which is the strongest shape any of these reports offers —
    # there is no cross-check because there is nothing independent to check
    # against: 897 appears exactly twice in 139 pages, here and inside a
    # prepayments figure of 6,897.
    #
    # THE BASIS CLAUSE IS IN `proof` BECAUSE IT IS THE SCOPE, NOT DECORATION.
    # Permanent or fixed-term excludes casuals and contractors, and the p60
    # tables that add to the same 897 — 718 ongoing plus 179 non-ongoing, both
    # headed "Employee statistics (by headcount)" — are the two categories the
    # clause names and nothing else. A report that later widened the sentence to
    # all engagement types would be a different measure at the same date.
    'aps-australian-prudential-regulation-authority': dict(
        url='https://www.apra.gov.au/system/files/2025-10/'
            'APRA%20Annual%20Report%202024-25.pdf',
        needle='Workforce composition',
        find=r'As at 30 June 2025, APRA had ([\d,]+) employees on a permanent or\s+'
             r'fixed-term contract basis,\s+compared with ([\d,]+) at the end of the '
             r'2024 financial year',
        col=1, prev_col=2,
        proof=r'on a permanent or\s+fixed-term contract basis',
        span=1, asof='Jun 2025'),
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
# Listed companies the AGGREGATOR HAS NO EMPLOYEE SERIES FOR, keyed so a pass can
# see the work was done. Every one was asked on 2026-09-26 and again in the run
# that added this table; the header above ASX records the same measurement in
# prose, and prose is exactly the problem — 20 of these 37 are not in the ticker
# map at all, so nothing anywhere said they had been tried, and every accounting
# of the gap has re-listed them as unexamined since.
#
# THIS IS NOT "no figure exists", AND THE DIFFERENCE MATTERS. It says the mirror
# that fills 155 other cards has nothing for these tickers, which is a fact about
# the mirror. Two were then checked at the source and are recorded properly in
# NO_FIGURE_PUBLISHED below (Catalyst Metals, Perseus Mining); the rest have not
# been read at their own reports and could still be filed that way.
#
# THIRTEEN OF THEM ARE THE SAME KIND OF ENTITY AND THAT IS THE NEXT THING TO
# CHECK, not a reason to write down yet. AFI, ARG, BWP, CIP, CLW, CQR, HDN, L1G,
# LSF, MXT, RGN, WAM and WLE are listed investment companies and REITs — trusts
# and managed vehicles whose staff, where there are any, are employed by a
# responsible entity or manager rather than by the listed entity. If that is what
# their reports say, the honest card for most of them is not a head count at all.
# Charter Hall Retail REIT was searched for the standard "does not have any
# employees" wording and it was not found in what a search returns, so the
# statement has to come from the documents themselves and none has been read.
AGGREGATOR_HAS_NO_SERIES = {
    # /quote/asx/<TK>/employees/ answers 404 for each of these — measured, not
    # assumed, in the run that wrote this file.
    'adelaide-ar3': None, 'adelaide-arg': None,
    'adelaide-axe': None, 'adelaide-bgd': None, 'adelaide-pro': None,
    'bmn': None, 'brisbane-dbi': None, 'cvn': None, 'cxo': None, 'del': None,
    'dyl': None, 'gor': None, 'hgo': None, 'jms': None, 'melbourne-afi': None,
    'melbourne-alx': None, 'melbourne-l1g': None, 'melbourne-lsf': None,
    'mgt': None, 'perth-bwp': None, 'perth-cyl': None, 'perth-pdi': None,
    'perth-rsg': None, 'perth-waf': None, 'pru': None, 'sgq': None,
    'stx': None, 'sw1': None, 'sydney-cip': None, 'sydney-clw': None,
    'sydney-cqr': None, 'sydney-hdn': None, 'sydney-mxt': None,
    'sydney-nic': None, 'sydney-rgn': None, 'sydney-wam': None,
    'sydney-wle': None,
}


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
    # THIS CARD HAD NO REASON AT ALL, and the fact that explains it was already
    # written down one file over. privateLogos.ts has carried, since the badge
    # pass, "nra.health.nz, which resolves to Health NZ: the alliance has been
    # absorbed into Te Whatu Ora" — measured, correct, and never copied to the
    # table that decides whether this card is a gap. So the headcount gap listed
    # it as an unexplained blank while the codebase knew the answer. Same defect
    # as a measurement of one URL written down as a measurement of something
    # larger: the finding existed, the place that needed it was empty.
    #
    # RE-MEASURED 2026-09-30 and the redirect is still there, two hops:
    # nra.health.nz -> 302 -> tewhatuora.govt.nz -> www.healthnz.govt.nz. (The
    # final host answers 403 to this network from CloudFront, which is not the
    # point — the LOCATION header is, and it arrives before the block.)
    #
    # NOT AN EMPLOYER, AND FILING ANYTHING HERE WOULD DOUBLE COUNT. The NRA was
    # the northern district health boards' shared-services agency; the 2022 health
    # reforms abolished the DHBs and folded it into Te Whatu Ora. Its people are
    # inside the four Te Whatu Ora district cards this repo already files —
    # Te Toka Tumai Auckland 11,473, Waitemata 8,724, Counties Manukau 8,651 and
    # Capital, Coast & Hutt Valley 9,251 at 31 March 2026.
    #
    # WORTH A ROSTER DECISION RATHER THAN A HEADCOUNT ONE: nzGov.ts records 14
    # roles observed under this name in the first full harvest, so it was
    # advertising as the NRA. If it still is, the ads are Te Whatu Ora's and this
    # card is a duplicate of a district rather than a company with no figure —
    # but retiring a roster card is not this file's call, so it is flagged here
    # rather than done.
    'nz-northern-regional-alliance-nra':
        'not an employer: the Northern Regional Alliance was the northern DHBs\' '
        'shared-services agency and the 2022 health reforms folded it into Te '
        'Whatu Ora. Its domain nra.health.nz 302s to tewhatuora.govt.nz '
        '(re-measured 2026-09-30), and its people are inside the four Te Whatu '
        'Ora district figures already filed — 11,473 + 8,724 + 8,651 + 9,251 at '
        '31 March 2026. A figure on this card would double count one of them',
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
        'annual report with a staff figure.\n\n'
        'THE SAME UNTRIED ROUTE AS INFRATIL, and here the case is stronger, '
        'because the obstacle was never a doorman: the browser gets in and the '
        'document is not there. Auckland Airport is NZX-listed (AIA), so its '
        'annual report is an NZX announcement whatever its own investor pages '
        'carry, and an NZX attachment downloads to a plain fetch when the URL '
        'keeps its trailing filename segment (see nz-chorus). The open step is '
        'the same: find the announcement id, which needs a way into the '
        'per-issuer listing that /companies/AIA/announcements is not',
    'nz-reserve-bank-of-new-zealand':
        'Cloudflare interstitial does NOT clear for this host even warmed, over '
        'twelve waits; rbnz.govt.nz also 403s a plain fetch on every path tried',
    # ── The two NZX companies the other four left behind, 2026-09-28 ──────────
    # BOTH REPORTS ARE KNOWN TO EXIST AND NEITHER IS READABLE FROM HERE, which is
    # a different fact from the rest of this list and is written as one.
    'nz-infratil':
        'infratil.com answers 403 to every path tried, root included — 16,512 '
        'bytes from a SafeLine WAF (server: Tengine, an sl-session cookie, assets '
        'under /.safeline/). That is a FOURTH interstitial beyond the three '
        'gen-gov-workforce.py records, and the only one whose <title> is empty, '
        'so the size-and-title tell those three share does not apply to it. The '
        'FY2026 annual report is published — infratil.com/for-investors/'
        'annual-reports/annual-report-2026/ is indexed — and the page holding it '
        'is behind the same 403.\n\n'
        'NOT RETRIED YET BY THE ROUTE THAT OPENED CHORUS, and it should be. '
        'Infratil is NZX-listed, so its FY2026 annual report is an NZX '
        'announcement, and api.nzx.com serves an attachment to a plain fetch '
        'once the URL carries its trailing filename segment — see the nz-chorus '
        'spec in OWN_REPORT, where that one missing segment was what a reason had '
        'recorded as the network being blocked. What is needed is the '
        'announcement id: www.nzx.com/announcements/<id> renders through the '
        'browser and lists every attachment with its full URL, but the '
        'per-issuer listing at /companies/INF/announcements does NOT exist '
        '(316 bytes, measured 2026-09-30) and the main /announcements page '
        'renders its table client-side with no anchors to walk. Infratil has a '
        'MARCH balance date, so its announcement is months back in that listing '
        'rather than on its first page. Finding the id is the open step, and the '
        'SafeLine 403 on its own site is no longer the reason to stop.\n\n'
        'AND api.nzx.com HAS NO REACHABLE LIST ENDPOINT — five candidates probed '
        '2026-09-30 and all five answer 403, INCLUDING '
        '/public/announcement/478352, the metadata for the one announcement whose '
        'attachment downloads fine. So the attachment path with its trailing '
        'filename is the only thing that host serves, and an id cannot be looked '
        'up there; it has to come from a rendered www.nzx.com announcement page. '
        'Recorded so the next attempt does not repeat the five probes',
    'nz-todd-corporation':
        'private, and its own site publishes no workforce figure. The one document '
        'it links — the 2025 Report on Sustainable Development, 46 pages — was '
        'downloaded and read and carries no group head count or FTE; its only '
        'people numbers are an event attendance ("More than 180 people") and a '
        'partnership anecdote. Note also that the roster domain todd.com is a '
        'PARKED PLACEHOLDER (832 bytes, "todd.com is almost here!"); the company '
        'is at todd.co.nz and toddcorporation.com',
    # THE THIRD OF THE FOUR WRONG-URL REASONS, AND THE ONLY ONE THAT SURVIVES
    # BEING CORRECTED. The old text — "site clears and renders, but no
    # annual-report PDF is reachable from its navigation" — was wrong in the
    # same way Meridian's and Transpower's were: /investors links
    # /investors/results-reports/annual-and-interim-reports/2026-full-year-results,
    # which carries "FY26 Integrated report and financial statements.pdf",
    # 17.7 MB and 143 pages. It downloaded and was read in full.
    #
    # WHAT IT PUBLISHES IS AN APPROXIMATION, which is why the card still stays
    # blank: p70 says the strategy is "supported by ~1,300 permanent employees"
    # and that is the ONLY workforce number in the document. The tilde is the
    # company's, not a rounding of mine, and "permanent" excludes fixed-term and
    # casual staff, so it is neither exact nor the whole workforce. Its GRI index
    # (p136) answers disclosure 2-7 Employees by pointing at p4, which carries no
    # number at all, and there is no data pack beside the report — the FY26
    # results page links a climate statement, a results presentation, a
    # governance document and the interim statements, and nothing else.
    #
    # SAME TREATMENT AS FLETCHER BUILDING AND CONTACT ENERGY, deliberately: all
    # three publish a "more than N" or "~N" and no exact total, and filing one
    # would put a marketing figure on a card next to figures that came from a
    # reconciled table. What changes here is that the reason now describes the
    # document instead of describing a URL I could not find.
    'nz-mercury-nz':
        'its FY26 Integrated Report was located, downloaded and read — 143 pages '
        'from /investors/results-reports/annual-and-interim-reports/'
        '2026-full-year-results — and the only workforce figure in it is p70\'s '
        '"supported by ~1,300 permanent employees". Approximate (the tilde is '
        'theirs) and permanent-only, so it is neither exact nor the whole '
        'workforce; its GRI 2-7 reference points at a page with no number, and '
        'there is no data pack beside the report',
    'nz-victoria-university-of-wellington':
        'its governance/annual-reports page renders with no PDF links at all. '
        'the 2025 annual report publishes NO workforce total. Re-checked '
        '2026-09-28 and the old reason here — "renders with no PDF links at '
        'all" — was wrong twice over. It was written against '
        'wgtn.ac.nz/about/governance/annual-reports, which 404s; the page that '
        'exists is /about/publications/annual-report, 105,714 bytes and '
        'unchallenged, linking a 5.6 MB 2025 annual report. THE DOCUMENT WAS '
        'THEN READ, all 86 pages: it gives staff only as percentages '
        '("proportion of academic staff who are Māori 6.8%") and a remuneration '
        'BAND table (142 employees on $140,000-$149,999), whose bands start at '
        '$100,000 and so cannot be summed to a workforce. Council members and '
        'Te Hiwa appear as 3 FTE and 10 FTE, which are committees. So the card '
        'stays blank on the substance, and it now says so from the document '
        'rather than from a dead URL',
    # ── Behind a VERCEL SECURITY CHECKPOINT, measured 2026-09-28 ──────────────
    # THESE THREE NEARLY GOT THE WRONG REASON. Their investor pages came back as
    # rendered 31 KB documents with zero PDF links, which reads exactly like a
    # small explorer that publishes no annual report — and 141 points of gap
    # would have been closed with a sentence that was false.
    #
    # Two unrelated domains returning 31,312 and 31,316 bytes is what gave it
    # away: a real site and a real absence do not agree to four significant
    # figures. Both were a "Vercel Security Checkpoint", which fetch() did not
    # recognise because every challenge wait in it tested for Cloudflare's
    # 'Just a moment' and nothing else. It now tests a tuple and RAISES rather
    # than handing an interstitial back as content.
    #
    # The checkpoint does not clear with patience: a warmed browser sat on it for
    # 80 seconds with the title unchanged, against the 30 s that clears
    # dpac.tas.gov.au and ocpe.nt.gov.au. A plain fetch gets HTTP 429 from these
    # hosts, not 403 — they are rate-limiting the network, not refusing the path.
    'cxo':
        'corelithium.com.au sits behind a Vercel Security Checkpoint this '
        'network cannot clear (80 s of warmed browser, title unchanged; plain '
        'fetch answers 429). Whether it publishes a workforce figure cannot be '
        'established from here — the aggregator has no employee series for CXO '
        'either',
    'hgo':
        'hillgroveresources.com.au — the Kantra Copper card — is behind the same '
        'Vercel checkpoint as Core Lithium, byte for byte the same interstitial. '
        'kantracopper.com.au answers 114 bytes',
    'mgt':
        'magnetitemines.com answers a connection reset to a plain fetch, which '
        'now reaches the browser fallback (that was a separate bug fixed the same '
        'day) and lands on an investor page of 2,676 bytes with no reports on it',
}


def own_workbook(cid, spec):
    """Read one company's own DATA PACK spreadsheet. -> a Headcount row, or raises.

    WHY A SECOND READER RATHER THAN A SECOND PDF SPEC. Meridian Energy publishes
    its GRI 2-7 employee table in an .xlsx "Integrated Report Data Pack" and NOT
    in the report itself: the report's only total is p45's "Total headcount
    remains unchanged at 1,056 (Board inclusive)", which counts the DIRECTORS
    alongside the staff. The data pack gives 1,050 with "This data also excludes
    the board and contractors" against it, three years deep, and its components
    reconcile in every one of them. Taking the PDF figure because a PDF reader
    already existed would have filed a number six too high on purpose.

    THE TWO AGREE ONCE THE BOARD IS ACCOUNTED FOR — 1,050 plus a six-member board
    is the 1,056 the report states — which is the cross-check that says the two
    documents describe the same workforce rather than two different ones.

    THE SHAPE THIS READS is a row of cells where each YEAR is a run of numbers
    introduced by a string: ['Total', 3, 499, 548, 1050, 'Total', 1, 446, 537,
    984, 'Total', 509, 553, 1062]. Splitting on "a string cell starts a new
    group" works whatever the label says, which matters because the component
    labels are NOT stable across years — FY26 writes "Casuals" where FY25 writes
    "Casual and contractor" — and it survives a year being added on the left.
    `years` pins which group is which, so a spec cannot silently read FY25 as
    FY26 when next year's pack shifts the columns along.
    """
    import io as _io
    import openpyxl

    req = urllib.request.Request(spec['url'], headers={'User-Agent': UA})
    blob = urllib.request.urlopen(req, timeout=120).read()
    if blob[:2] != b'PK':
        raise RuntimeError(f'{cid}: not an xlsx — starts {blob[:40]!r}')
    wb = openpyxl.load_workbook(_io.BytesIO(blob), data_only=True)
    if spec['sheet'] not in wb.sheetnames:
        raise RuntimeError(f'{cid}: no sheet {spec["sheet"]!r} — has {wb.sheetnames}')
    rows = [[c for c in r] for r in wb[spec['sheet']].iter_rows(values_only=True)]

    # THE TABLE IS FOUND BY ITS OWN CAPTION, not by a row number, because a data
    # pack gains and loses tables between editions and a fixed offset would read
    # whatever moved into place. `needle` is the caption and `proof` is the
    # standard reference beside it — both must be on the SAME row, so a spec
    # cannot anchor on the word "Employees" somewhere else in the sheet.
    start = None
    for i, r in enumerate(rows):
        text = ' | '.join(str(c) for c in r if c is not None)
        if spec['needle'] in text and re.search(spec['proof'], text):
            start = i
            break
    if start is None:
        raise RuntimeError(f'{cid}: no row carries {spec["needle"]!r} with '
                           f'{spec["proof"]!r} beside it')
    block = rows[start:start + spec.get('span_rows', 14)]

    # THE HEADER ROW PINS GROUP -> YEAR, BY COLUMN AND NOT BY COUNTING. Required
    # in order, so a pack that prepends a new year fails here rather than filing
    # last year's figure under this year's date; and the COLUMN each year sits
    # in is kept, because every row below repeats its own year labels at those
    # same columns and checking that is what makes group N genuinely year N.
    year_cols = None
    for r in block:
        at = {str(c).strip(): i for i, c in enumerate(r) if c is not None}
        if all(y in at for y in spec['years']):
            cols = [at[y] for y in spec['years']]
            if cols != sorted(cols):
                raise RuntimeError(f'{cid}: {list(spec["years"])} appear out of '
                                   f'order across the header — columns have moved')
            year_cols = cols
            break
    if year_cols is None:
        raise RuntimeError(f'{cid}: no header row carries all of {spec["years"]}')

    def groups(label):
        """The numeric runs of the row whose first NON-EMPTY cell is `label`.

        Not r[0]: this sheet indents every table by a column and pads each year
        group out to a fixed width, so a row is mostly None and the label sits
        at index 1. Reading position 0 finds nothing at all, which is how this
        failed the first time it was run.

        AND THE YEARS LIVE IN THE ROW, NOT IN SEPARATE ROWS. FY26, FY25 and FY24
        are three groups of the SAME line — ['Casuals', 4, 3, 7, 'Casual and
        contractor', 3, 4, 7, 'Casual and contractor', 5, 11, 16] — with the
        label rewritten in each. So a group starts wherever a string cell does,
        whatever it says, and the group is pinned to a year by the column that
        string sits in rather than by what it reads.
        """
        def first(r):
            return next((str(c).strip() for c in r if c is not None), None)
        hit = [r for r in block if first(r) == label]
        if len(hit) != 1:
            raise RuntimeError(f'{cid}: row {label!r} appears {len(hit)} times in '
                               f'the block, not once')
        out, cur = [], None
        for i, c in enumerate(hit[0]):
            if c is None:
                continue
            if isinstance(c, str):
                cur = []
                out.append((i, cur))
            elif cur is not None:
                cur.append(int(c))
        out = [(i, g) for i, g in out if g]
        if [i for i, _ in out] != year_cols:
            raise RuntimeError(f'{cid}: row {label!r} has its year groups at '
                               f'columns {[i for i, _ in out]} against the '
                               f'header\'s {year_cols}')
        return [g for _, g in out]

    take = spec.get('take', -1)
    tot = groups(spec['row'])
    now = tot[0][take]
    prev = tot[1][take] if len(tot) > 1 else None
    if now <= 0:
        raise RuntimeError(f'{cid}: parsed a non-positive figure ({now})')

    # RECONCILED IN BOTH YEARS, which is what makes `take` safe. A spec reading
    # the wrong column of a gender breakdown would still produce a plausible
    # number; it would not produce one its own components sum to. Both years
    # come from the SAME rows, so one list of labels does both.
    for gi, stated in ((0, now), (1, prev)):
        if stated is None or gi >= len(spec['years']):
            continue
        total = sum(groups(l)[gi][take] for l in spec['comp'])
        if total != stated:
            raise RuntimeError(f'{cid}: {spec["years"][gi]} components sum to '
                               f'{total:,} against a stated {stated:,} — the '
                               f'column or the rows are wrong')

    return {'now': now, 'prev': prev, 'asof': spec['asof'],
            'yr': int(re.search(r'(20\d\d)', spec['asof']).group(1)),
            'span': spec.get('span', 0) if prev else 0}


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

    # A SECOND STATEMENT OF THE SAME NUMBER, ELSEWHERE IN THE DOCUMENT, and the
    # reason it is a separate mechanism from `sums` is CSIRO. Its Table A.5 is
    # printed as two column groups on one page, five years then two, so every
    # component label — "Research scientists/engineers", "Technical services" —
    # appears TWICE on that page and `sums` refuses an ambiguous label. The
    # reconciliation that would have caught a wrong-column read was therefore
    # unavailable on the one table that most needed it: its two groups differ
    # only in which years they carry.
    #
    # So the check is made against the report's own prose instead. CSIRO p20:
    # "On 30 June 2025 we had 5,998 people employed (full-time equivalent of
    # 5,676)" — a dated sentence, on a different page, stating the figure the
    # table's last column must equal. A spec that read 2023-24 would land on
    # 6,618 and fail here rather than filing a figure a year stale.
    #
    # WHOLE-DOCUMENT, LIKE `doc_proof`, because the point is that it is somewhere
    # else; and EXACTLY ONCE, because two sentences stating different totals mean
    # the document does not agree with itself and neither is safe to file.
    if spec.get('cross'):
        with pdfplumber.open(_io.BytesIO(blob)) as pdf:
            whole = '\n'.join((pg.extract_text() or '') for pg in pdf.pages)
        found = list(re.finditer(spec['cross'], whole))
        if len(found) != 1:
            raise RuntimeError(f'{cid}: the cross-check {spec["cross"]!r} matched '
                               f'{len(found)} times in the document, not once')
        said = int(found[0].group(1).replace(',', ''))
        if said != now:
            raise RuntimeError(f'{cid}: the table gives {now:,} and the document '
                               f'states {said:,} for the same workforce — one of '
                               f'them is the wrong year or the wrong column')
    # COMPONENTS CAPTURED IN THE SAME MATCH, summed and checked against the
    # total. `sums` below finds each component by its own LABEL, which needs the
    # label to come before the number; Chorus prints the split the other way
    # round and on the next line — "745 employees" then "(420 male | 325
    # female)" — so there is no label to search for, only capture groups in the
    # one match. Same job as `sums`, different shape of page.
    #
    # IT IS THE ONLY ARITHMETIC GUARD CHORUS HAS. Its figure sits in an infographic
    # with no year columns and no second statement of the same number to point
    # `cross` at, so without this the spec would be asserting a regex and trusting
    # it. 420 + 325 = 745 is the document checking itself.
    if spec.get('parts'):
        total = sum(g(i) for i in spec['parts'])
        if total != now:
            raise RuntimeError(f'{cid}: the components captured alongside the total '
                               f'sum to {total:,} against the {now:,} stated beside '
                               f'them — the regex matched the wrong groups')

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
    row = {'now': now, 'prev': prev, 'asof': spec['asof'],
           'yr': int(re.search(r'(20\d\d)', spec['asof']).group(1)),
           'span': spec.get('span', 0) if prev else 0}
    if spec.get('unit'):
        row['unit'] = spec['unit']
    return row


SENT = re.compile(
    r'had ([\d,]+) employees as of ([A-Za-z0-9, ]+?)\. The number of employees '
    r'(?:(increased|decreased) by ([\d,]+) or (-?[\d.]+)%|(did not change|remained))', re.I)


FETCH_FAILED = {}          # url -> why, for the run report


def fetch(url):
    """The page, or '' — and a reason recorded when '' means a failure.

    `except Exception: return ''` HID A REAL FAILURE BEHIND A REAL ANSWER. A
    timeout, a 403, a reset and a company the aggregator does not cover all
    produced the same empty string, which parse() turns into None, which main()
    treats as "no data for this company" — and main() builds its dict from
    scratch, so the row is simply dropped and the card goes blank.

    Measured 2026-09-28: in one pass BHP returned 90,625 bytes and Rio Tinto
    returned 0, seconds apart. Rio Tinto is filed at 56,865 and is not a
    coverage gap; that run would have deleted it. One retry is cheap against a
    host being fetched 155 times in a row, and what survives a retry is recorded
    rather than swallowed.
    """
    err = None
    for attempt in (1, 2):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers={'User-Agent': UA}),
                timeout=25).read().decode('utf-8', 'replace')
        except Exception as e:                                    # noqa: BLE001
            err = f'{type(e).__name__}: {e}'
            if attempt == 1:
                time.sleep(3)
    FETCH_FAILED[url] = err
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


def read_existing():
    """The rows already in the generated file, so a run cannot silently lose one.

    gen-gov-workforce.py has had this for a while and this generator never did,
    which is the whole reason a flaky fetch could delete a card. Same idea, same
    reason: what a run failed to READ is not the same as what the source stopped
    REPORTING, and only the first should ever be kept.
    """
    try:
        txt = open(OUT, encoding='utf-8').read()
    except OSError:
        return {}
    rows = {}
    for m in re.finditer(r"^  '([^']+)': \{ (.+?) \},?$", txt, re.M):
        body = {}
        # THE EMITTER WRITES STRINGS IN SINGLE QUOTES — `asof: 'Jun 2026'` — so a
        # double-quote-only pattern parsed every row and silently dropped its
        # DATE, which the emitter then needs back. Both quotes are accepted.
        for k, v in re.findall(r'''(\w+): ("[^"]*"|'[^']*'|null|-?[\d.]+)''', m.group(2)):
            body[k] = (None if v == 'null'
                       else v[1:-1] if v[:1] in '"\''
                       else float(v))
        if 'now' in body and body.get('asof'):
            rows[m.group(1)] = body
    return rows


def stray_keys():
    """Warn about a recorded reason whose key is not a roster company id.

    A KEY THAT NAMES NO CARD IS COMPLETELY SILENT, which is why this exists and
    why gen-gov-workforce.py has had the same guard for a while: the lookup
    misses, the card falls back to no figure, and the reason someone measured and
    wrote down is never printed or matched by anything. The table then looks
    maintained while saying nothing.

    IT CAUGHT ONE THE HOUR IT WAS WRITTEN. AGGREGATOR_HAS_NO_SERIES was typed
    from a list of 38 ids and one of them, 'adelaide-afi', does not exist —
    the Australian Foundation Investment Company is 'melbourne-afi', which was
    also in the table. So the file carried a dead entry and a live one for the
    same company and nothing could have said so.

    Prints rather than raises, and skips quietly when bun is unavailable: this is
    a hygiene check on comments, not a reason to fail a run that has 151 real
    figures in it.
    """
    try:
        ids = set(json.loads(subprocess.run(
            ['bun', '-e', 'import { COMPANIES } from "./src/employsi/data/companies";'
                          'console.log(JSON.stringify(COMPANIES.map(c => c.id)));'],
            cwd=ROOT, capture_output=True, text=True, check=True, timeout=120).stdout))
    except Exception as e:                                        # noqa: BLE001
        print(f'\n  (roster id check skipped: {type(e).__name__})', file=sys.stderr)
        return
    for name, table in (('OWN_REPORT', OWN_REPORT),
                        ('NO_FIGURE_PUBLISHED', NO_FIGURE_PUBLISHED),
                        ('AGGREGATOR_HAS_NO_SERIES', AGGREGATOR_HAS_NO_SERIES)):
        bad = sorted(k for k in table if k not in ids)
        if bad:
            print(f'\n  {name}: {len(bad)} key(s) name no roster company — the '
                  f'entry is dead and will never print or match:', file=sys.stderr)
            for k in bad:
                print(f'      {k}', file=sys.stderr)


def main():
    data = {}
    existing = read_existing()
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
            data[cid] = (own_workbook(cid, spec) if spec.get('sheet')
                         else own_report(cid, spec))
            print(f'  own report: {cid} -> {data[cid]["now"]:,} as at {spec["asof"]}')
        except Exception as e:                                    # noqa: BLE001
            print(f'  own report FAILED for {cid}: {type(e).__name__}: {e}')

    # A ROW THIS RUN DID NOT PRODUCE IS KEPT, NOT DROPPED — and the run says
    # which, because for this source "nothing came back" is far more often a
    # flaky fetch than a company that stopped being covered. Dropping it silently
    # is how a filed card goes blank with nothing to read about it.
    kept = sorted(cid for cid in existing if cid not in data)
    if kept:
        failed_for = {c for c in kept
                      if any(f'/{ (ASX.get(c) or NZ_VIA_ASX.get(c) or US.get(c) or "?") }/' in u
                             for u in FETCH_FAILED)}
        print(f'\n  KEPT {len(kept)} row(s) the fetch did not return this run '
              f'(the previous reading stands):', file=sys.stderr)
        for cid in kept:
            was = existing[cid]
            why = 'the fetch FAILED' if cid in failed_for else 'the page had no usable table'
            print(f'      {cid}  (was {int(was["now"]):,} as at {was.get("asof")}) — {why}',
                  file=sys.stderr)
        for cid in kept:
            data[cid] = {k: v for k, v in existing[cid].items()}
            data[cid]['now'] = int(existing[cid]['now'])
            if existing[cid].get('prev') is not None:
                data[cid]['prev'] = int(existing[cid]['prev'])
            data[cid]['span'] = int(existing[cid].get('span') or 0)
    if FETCH_FAILED:
        print(f'\n  {len(FETCH_FAILED)} fetch(es) failed outright this run:', file=sys.stderr)
        for u, why in list(FETCH_FAILED.items())[:12]:
            print(f'      {u.rsplit("/quote/", 1)[-1][:40]}  {why[:70]}', file=sys.stderr)

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
        # `unit` IS WRITTEN ONLY WHERE THE DOCUMENT SAID FTE, and the default is
        # the honest one: everything the aggregator carries is a head count, and
        # every row here was a head count until Fonterra. Its appendix is headed
        # "REGION REPORTING (FTE)" and its prose says "11,721 people on a
        # full-time equivalent basis" — filing that with no unit would have put an
        # FTE on a tile labelled Headcount, which is the same mislabelling the
        # Queensland bulletin already forced this field to exist for.
        unit_s = '' if not v.get('unit') else f", unit: {v['unit']!r}"
        L.append(f"  {cid!r}: {{ now: {v['now']}, {prev_s}yoy: {yoy_s}, "
                 f"asof: {short(v['asof'])!r}, span: {span}{unit_s} }},")
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    print(f'wrote {OUT} with {len(data)} companies')
    if NO_FIGURE_PUBLISHED:
        print(f'\n{len(NO_FIGURE_PUBLISHED)} companies whose own report was READ and '
              f'carries no total workforce figure:')
        for cid in sorted(NO_FIGURE_PUBLISHED):
            print(f'  {cid}: {NO_FIGURE_PUBLISHED[cid]}')
    if AGGREGATOR_HAS_NO_SERIES:
        # Printed as a COUNT, not a list. Thirty-seven ids is a screen of noise
        # every run, and the useful question is whether the number moved.
        print(f'\n{len(AGGREGATOR_HAS_NO_SERIES)} listed cards the aggregator '
              f'carries no employee series for (see the table in this script for '
              f'which, and for the REIT/LIC pattern among them)')
    stray_keys()


if __name__ == '__main__':
    main()
