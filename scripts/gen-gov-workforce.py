#!/usr/bin/env python3
"""Regenerate src/employsi/data/govWorkforceAu.ts — real public-sector headcount
by agency, for the jurisdictions that publish it as open data.

    python3 scripts/gen-gov-workforce.py            # all sources
    python3 scripts/gen-gov-workforce.py --only aps

WHY THIS EXISTS. 437 government agencies on the map had no workforce figure, so
their cards showed "no workforce figure collected". Western Australia was the
only jurisdiction wired, through src/employsi/data/perthGovWorkforce.ts — which
says AUTO-GENERATED but has no generator in this repo, so nobody could refresh
it. This file is that generator for everywhere else, and it is written so the
next jurisdiction is a SOURCES entry rather than a new script.

WHAT IS AND IS NOT HERE, measured 2026-09-24:

  * APS (federal) — data.gov.au, APSC "APS Employment Data". Table 2 carries
    agency headcount for TWO CONSECUTIVE Decembers in one sheet, which is
    exactly the shape the card wants. 45 of our 56 agencies match.
  * Victoria — discover.data.vic.gov.au, VPSC "Number of Employees by
    Organisation". One year per file, so two files are read and joined.
    59 of our 91 match.
  * Queensland — NOT AVAILABLE FROM A SCRIPT. The current State of the Sector
    workbooks (2024, 2025, 2026) are hosted on www.data.qld.gov.au, which
    answers `x-amzn-waf-action: challenge` and returns a JavaScript
    interstitial rather than the file. Everything the CKAN datastore will serve
    stops at March 2023. The older biannual profiles on forgov.qld.gov.au
    download fine, so it is the one host, not the jurisdiction.
  * New South Wales — NOT PUBLISHED per agency. data.nsw.gov.au carries the
    PSC's gender and diversity extract for 2006-2015; the Workforce Profile
    itself is a PDF report on psc.nsw.gov.au with no machine-readable
    per-agency headcount behind it.
  * SA, NT, TAS — not yet investigated.

AGENCY NAMES ARE MATCHED EXACTLY, after normalising case, punctuation and the
filler words. Fuzzy matching was tried and rejected: Victoria lists "Court
Services Victoria" once, while the roster carries the County, Magistrates' and
Children's Courts separately, so anything approximate writes one agency's 3,072
staff onto three different cards. Everything the exact match misses is ABSENT
rather than guessed — the same rule perthGovWorkforce.ts already states, and
the card renders an em dash for it.

ALIAS is the escape hatch, and every entry is a judgement someone can check.
"""
import functools
import collections
import glob, csv, io, json, re, sys, urllib.error, urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/govWorkforceAu.ts'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36'

# roster company name -> the name the SOURCE uses. Only where the two plainly
# describe one body; anything needing a leap is left out and stays absent.
# THE APS SIDE IS EXHAUSTED AT 45 OF 56, and the eleven that are missing are
# not a matching problem — they are not in the source at all, under any name.
# Measured 2026-09-24 against all 101 published agencies:
#
#     Australian Federal Police        Reserve Bank of Australia
#     ASIO                             APRA
#     Australian Signals Directorate   ASIC
#     CSIRO                            Australian Sports Commission
#     Geoscience Australia             IP Australia
#     Australian Space Agency
#
# The APS Employment Database covers APS Act employment. Most of these employ
# under their own legislation (the AFP Act, the Science Agency Act, the Reserve
# Bank Act) and several are corporate Commonwealth entities outside it
# entirely; the Space Agency is a branch of a department rather than an agency
# of its own. No alias can reach them, so they need their own annual reports or
# nothing. This is written down because "it must be in there under another
# name" is the natural next thought and it costs an afternoon.

ALIAS = {
    # APS: the roster keeps the department's formal name, the APSC sheet the
    # portfolio's.
    "Attorney-General's Department": "Attorney-General's",
    "Department of Infrastructure, Transport, Regional Development, Communications and the Arts":
        "Infrastructure, Transport, Regional Development, Communications, Sport and the Arts",
    "Fair Work Ombudsman": "Office of the Fair Work Ombudsman",
    # VIC: suffix-only differences on the same health service.
    "Goulburn Valley Health": "Goulburn Valley Health Services",
    "Central Gippsland Health": "Central Gippsland Health Service",
    # VIC: the roster's "Government schools" IS the teaching service — the
    # 90,091 teachers and school support staff the department employs, which
    # the VPSC reports under the department's name and separately from the
    # department's own 4,931 public servants. Both rows are real and they are
    # different workforces; this maps the schools card to the schools one.
    "Government schools": "Department of Education (teaching service and school support employees)",
    # VIC: A RENAME, NOW ESTABLISHED RATHER THAN GUESSED. This card sat in
    # NOT_IN_SOURCE with a reason that said exactly what it did not know — "the
    # source has 'Wage Inspectorate Victoria' (66) and nothing named Workforce
    # Inspectorate. Whether that is a rename is not established here, and a score
    # would have taken it — the AFL/AFL Sports Ready trap". It is a rename: Wage
    # Inspectorate Victoria became Workforce Inspectorate Victoria on 12 December
    # 2025, and vic.gov.au carries an "About Workforce Inspectorate" page for the
    # same body. So the caution was right and the answer is now evidence.
    #
    # THE FIGURE IS Jun 2024, EIGHTEEN MONTHS BEFORE THE RENAME, which the card's
    # own asof states — the same date every other Victorian card carries.
    #
    # `Labour Hire Licensing Authority` (101) IS A SEPARATE ROW IN THE SAME
    # SOURCE AND IS NOT ADDED. The December 2025 changes route labour-hire
    # reporting to the renamed body, which invites summing the two to 167 —
    # and whether that authority was folded in, or merely reports to it, is not
    # established here. That is the same caution that kept this card blank,
    # applied one level down rather than abandoned now that a match exists.
    "Workforce Inspectorate Victoria": "Wage Inspectorate Victoria",
    # ── New Zealand ────────────────────────────────────────────────────────
    # Te Kawa Mataaho writes the legal name; the roster writes what the job ads
    # say. Each was read off the two CSVs, not guessed.
    'Accident Compensation Corporation': 'ACC',
    'Civil Aviation Authority of NZ': 'Civil Aviation Authority of New Zealand',
    'NZ Police': 'New Zealand Police',
    'NZ Security Intelligence Service (NZSIS)': 'New Zealand Security Intelligence Service',
    'New Zealand Lotteries Commission': 'Lotto NZ',
    'New Zealand Transport Agency': 'NZ Transport Agency Waka Kotahi',
    'Public Service Commission Te Kawa Mataaho': 'Public Service Commission',
    'Statistics NZ': 'Statistics New Zealand',
    'Te Papa': 'Museum of New Zealand Te Papa Tongarewa',
    'Te Puni Kōkiri - Ministry of Māori Development': 'Ministry of Māori Development-Te Puni Kōkiri',
    # NOT aliased, because they are not in either file under any name, measured
    # 2026-09-24: the Reserve Bank of New Zealand (autonomous, outside the
    # Public Service), Transpower (a state-owned enterprise) and Victoria
    # University of Wellington (a tertiary institution). They need their own
    # annual reports or nothing.

    # ── Queensland ─────────────────────────────────────────────────────────
    # The roster carries the short name the ads use; the State of the Sector
    # workbook carries the formal one. Qualified by jurisdiction because four
    # of these names are generic enough to exist elsewhere — "Electoral
    # Commission" is also a New Zealand roster company, and it matches its own
    # source row without help.
    'qld:Legal Aid': 'Legal Aid Queensland',
    'qld:Public Trust Office': 'Public Trustee',
    'qld:Art Gallery': 'Queensland Art Gallery',
    'qld:State Library': 'State Library of Queensland',
    'qld:Electoral Commission': 'Electoral Commission Queensland',
    'qld:Inspector General Emergency Management':
        'Office of the Inspector-General of Emergency Management',

    # ── South Australia ────────────────────────────────────────────────────
    # SA HEALTH IS NOT AN EMPLOYER IN THE SOURCE, it is the brand over twelve
    # of them. The Workforce Information Report names the department, ten Local
    # Health Networks and the ambulance service separately and never writes "SA
    # Health", so the card for 666 live ads showed an em dash while fifty
    # thousand people sat in the same table under other names.
    #
    # Every member is listed rather than matched on a pattern, because the
    # table also contains SECTOR TOTALS — "General Government Sector" is
    # 116,540 and "Public Non-Financial Corporations Sector" 4,750 — and any
    # rule loose enough to gather the health networks could gather one of
    # those. A total is not an agency, and nothing here may ever sum one.
    # ── South Australia ────────────────────────────────────────────────
    # ONE SYSTEMATIC MISMATCH, NOT EIGHTEEN SEPARATE ONES: the roster writes
    # "SA" and the Workforce Information Report spells out "South Australian".
    # That is the whole of it for these, which is why they are grouped rather
    # than scattered through the table alphabetically.
    #
    # These were read off the RUNNER's own spare-row list, because South
    # Australia cannot be loaded from the authoring sandbox — its report is a
    # PDF behind a host that refuses this network, so the strings below are the
    # source's own output rather than anything guessed here. They are verified
    # by the next gov-workforce run: any one that is wrong reappears in that
    # list instead of matching, and the roster card stays blank rather than
    # taking a wrong figure.
    #
    # The four SECTOR TOTALS in that list — General Government Sector at
    # 116,540, Public Non-Financial Corporations, Public Financial
    # Corporations, Non-Budget Entity — are aggregates and must never be
    # matched to an agency. They stay unconsumed on purpose; the run printing
    # them is the check working, not a gap.
    'sa:SA Metropolitan Fire Service': 'South Australian Metropolitan Fire Service',
    'sa:SA Housing Trust': 'South Australian Housing Trust',
    'sa:SA Country Fire Service': 'South Australian Country Fire Service',
    'sa:SA Tourism Commission': 'South Australian Tourism Commission',
    'sa:Lifetime Support Authority of SA': 'Lifetime Support Authority of South Australia',
    'sa:SACE Board of SA': 'SACE Board of South Australia',
    'sa:SA Fire and Emergency Services Commission':
        'South Australian Fire and Emergency Services Commission',
    # "Services" plural in the source, singular on the card.
    'sa:SA State Emergency Service': 'South Australian State Emergency Services',
    'sa:Essential Services Commission of SA': 'Essential Services Commission of South Australia',
    'sa:State Theatre Company of SA': 'State Theatre Company of South Australia',
    'sa:Electoral Commission of SA': 'Electoral Commission of South Australia',
    # "South Australia", not "South Australian", in this one row.
    'sa:SA Arid Lands Landscape Board': 'South Australia Arid Lands Landscape Board',
    'sa:SA Motor Sport Board': 'South Australian Motor Sport Board',
    'sa:Carclew Youth Arts Centre': 'Carclew Youth Arts Centre Incorporated',
    'sa:SA Film Corporation': 'South Australian Film Corporation',
    'sa:State Opera SA': 'State Opera of South Australia',
    'sa:Office of the SA Productivity Commission':
        'Office of the South Australian Productivity Commission',
    # THE ONE HERE THAT IS NOT JUST AN ABBREVIATION. The card names the
    # Commissioner — the office-holder — and the source row is "Commission".
    # In South Australia that is one body under two spellings, and there is no
    # second candidate anywhere in the file, so this is a rename rather than
    # the near-name trap. Worth the note because it is the only one of the
    # eighteen a reader could not confirm from the two strings alone.
    'sa:Legal Profession Conduct Commissioner': 'Legal Profession Conduct Commission',

    # ── Western Australia ──────────────────────────────────────────────
    # The bulletin prefixes every health service with the portfolio — "WA
    # Health (South Metropolitan Health Service)" — and the roster carries the
    # service on its own. Eight of the fourteen here are that one prefix.
    #
    # The rest are ordinary variants, and one is a typo ON THE ROSTER rather
    # than in the source: the card reads "Ombudsman Western Australian". It is
    # aliased rather than corrected, because renaming a roster card changes a
    # company id and the archive keys ads to it; the alias is the cheap half.
    'perth:Child and Adolescent Health Service': 'WA Health (Child and Adolescent Health Service)',  # 7,290
    'perth:Department of Health': 'WA Health (Department of Health)',  # 1,598
    'perth:East Metropolitan Health Service': 'WA Health (East Metropolitan Health Service)',  # 11,536
    'perth:Health Support Services': 'WA Health (Health Support Services)',  # 2,984
    'perth:North Metropolitan Health Service': 'WA Health (North Metropolitan Health Service)',  # 14,397
    'perth:PathWest': 'WA Health (PathWest)',  # 2,612
    'perth:South Metropolitan Health Service': 'WA Health (South Metropolitan Health Service)',  # 16,036
    'perth:WA Country Health Service': 'WA Health (WA Country Health Service)',  # 12,644
    'perth:Department of Fire & Emergency Services': 'Department of Fire and Emergency Services',  # 2,012
    'perth:Legal Aid Western Australia': 'Legal Aid Commission of Western Australia',  # 582
    'perth:Main Roads WA': 'Main Roads Western Australia',  # 1,981
    'perth:Ombudsman Western Australian': 'Ombudsman Western Australia',  # 96
    'perth:Western Australia Police Force': 'Western Australia Police',  # 3,223
    'perth:WorkCover WA': 'WorkCover Western Australia',  # 151

    # ── Victoria ───────────────────────────────────────────────────────
    # THE VICTORIAN SOURCE HAD 208 SPARE ROWS AGAINST 38 UNFILLED CARDS, which
    # is not a jurisdiction missing a source — it is a jurisdiction whose rows
    # are named differently from the roster's. VPSC publishes the EMPLOYING
    # ENTITY: Bendigo Health files as Bendigo Health Care Group, WorkSafe as
    # the Victorian WorkCover Authority (its legal name), VicScreen as Film
    # Victoria (VicScreen is the trading name), the Ombudsman as the Office of
    # the Ombudsman Victoria.
    #
    # The portal was checked for a newer or finer file before any of this was
    # written, since that would have been the cheaper fix: VPSC Workforce Data
    # runs 2022, 2023, 2024 and stops. Jun 2024 IS the newest whole-of-sector
    # edition, so the loader was already reading the best available and the
    # remaining gap was never going to close by fetching something else.
    #
    # A DEPARTMENT ROW CARRIES ITS OWN DISCLOSURE IN BRACKETS, and the brackets
    # are part of the name — norm() keeps parentheses, so the roster's bare
    # "Department of Premier and Cabinet" cannot reach a row that spells out
    # what it includes. Those four are matched to the full string.
    #
    # THE (CEO) SPLIT IS A SOURCE CONVENTION, NOT A SECOND BODY. Several
    # agencies file as "X (excluding CEO)" plus "X (CEO)" at 1. Taking only
    # the first would report an agency one person short forever, so they are
    # summed like SA Health, under the same guard requiring both members in
    # both years. Victoria Police is the same shape at a different scale:
    # sworn officers and public servants are two rows of one force.
    'vic:Bendigo Health': 'Bendigo Health Care Group',  # 4,756
    'vic:Latrobe Regional Health': 'Latrobe Regional Hospital',  # 2,675
    'vic:Portable Long Service Authority': 'Portable Long Service Benefits Authority',  # 63
    'vic:Royal Botanic Gardens Victoria': 'Royal Botanic Gardens Board',  # 246
    'vic:Victorian Electoral Commission': 'Office of the Victorian Electoral Commissioner',  # 324
    'vic:Victorian Ombudsman': 'Office of the Ombudsman Victoria',  # 92
    'vic:WorkSafe': 'Victorian WorkCover Authority',  # 1,903
    'vic:Parliament of Victoria': 'Departments of Parliament',  # 357
    'vic:VicScreen': 'Film Victoria',  # 65
    'vic:Victorian Legal Services Board and Commissioner': 'Office of the Legal Services Commissioner',  # 201
    'vic:Department of Energy, Environment and Climate Action':
        'Department of Energy, Environment and Climate Action (includes Sustainability Victoria excluding CEO, Solar Victoria and the Office of the Commissioner for Environmental Sustainability)',  # 6,226
    'vic:Department of Justice and Community Safety':
        'Department of Justice and Community Safety (includes non-executive and non-forensic employees from Victorian Institute of Forensic Medicine)',  # 9,852
    'vic:Department of Premier and Cabinet':
        'Department of Premier and Cabinet (includes Yoorrook Justice Commission)',  # 651
    'vic:Department of Treasury and Finance':
        'Department of Treasury and Finance (includes State Revenue Office and Commission for Better Regulation)',  # 1,612
    'vic:Environment Protection Authority': [  # 752
        'Environment Protection Authority (excluding CEO)',  # 751
        'Environment Protection Authority (CEO)',  # 1
    ],
    'vic:Game Management Authority': [  # 30
        'Game Management Authority (excluding CEO)',  # 29
        'Game Management Authority (CEO)',  # 1
    ],
    'vic:Victorian Gambling and Casino Control Commission': [  # 198
        'Victorian Gambling and Casino Control Commission (excluding CEO)',  # 197
        'Victorian Gambling and Casino Control Commission (CEO)',  # 1
    ],
    'vic:Victoria Police': [  # 22,380
        'Victoria Police (Sworn Police and Protective Services Officers)',  # 18,031
        'Victoria Police (Public Service employees)',  # 4,349
    ],
    # ── Health New Zealand districts ───────────────────────────────────
    # The roster carries the district's full Te Whatu Ora name; Table 1 of the
    # quarterly report carries the bare district. Qualified with `nzhealth:`
    # because district names are ordinary words that recur — "Auckland" alone
    # would be reachable from any jurisdiction added later.
    'nzhealth:Health New Zealand - Te Whatu Ora Te Toka Tumai Auckland': 'Auckland',
    'nzhealth:Health New Zealand - Te Whatu Ora Counties Manukau': 'Counties Manukau',
    'nzhealth:Health New Zealand - Te Whatu Ora Waitemat\u0101': 'Waitemata',
    # ONE ROSTER CARD, TWO SOURCE ROWS. Health NZ runs Capital & Coast and Hutt
    # Valley as a single combined district and the roster names it that way;
    # the workforce table still reports the two payrolls separately. Summed, as
    # SA Health is, and the summing guard requires BOTH members present in BOTH
    # years, so a rename cannot silently halve it.
    #
    # The pair is also the evidence that the sum is the right unit: separately
    # the two read -9.5% and +4.6% over the year, which is staff moving between
    # them inside one district; together they are +1.3%.
    'nzhealth:Health New Zealand - Te Whatu Ora Capital, Coast & Hutt Valley': [
        'Capital & Coast',
        'Hutt Valley',
    ],
    'sa:SA Health': [
        'Department for Health and Wellbeing',
        'Central Adelaide Local Health Network',
        'Southern Adelaide Local Health Network',
        'Northern Adelaide Local Health Network',
        'Womens and Childrens Health Network',
        'Barossa Hills Fleurieu Local Health Network',
        'Yorke and Northern Local Health Network',
        'Riverland Mallee Coorong Local Health Network',
        'Limestone Coast Local Health Network',
        'Eyre and Far North Local Health Network',
        'Flinders and Upper North Local Health Network',
        'SA Ambulance Service',
    ],

    # ── Northern Territory ─────────────────────────────────────────────────
    # The roster uses the short form the ads use; OCPE writes the full name.
    # Qualified by jurisdiction out of the same caution that "Electoral
    # Commission" taught — "NT Police Force" is unique today and need not stay
    # so.
    'nt:NT Police Force': 'Northern Territory Police Force',
    'nt:NT Fire and Emergency Services': 'Northern Territory Fire & Emergency Services',
    # Batchelor Institute of Indigenous Tertiary Education is NOT aliased: it
    # is a tertiary institution and is in no row of the staffing table.
}


# A browser, opened once and shared, for the hosts that refuse a plain request.
# None until something needs it, so a run that touches only the open portals
# never starts Chromium.
_BROWSER = {'ctx': None, 'stop': None}


def _browser_ctx():
    from playwright.sync_api import sync_playwright
    if _BROWSER['ctx'] is None:
        pw = sync_playwright().start()
        _BROWSER['stop'] = pw.stop
        try:
            # PIN THE BROWSER PATH, because the pip playwright in the
            # authoring sandbox expects a NEWER build number than the image
            # carries and dies with "Executable doesn't exist ...
            # chromium_headless_shell-1243", telling you to run
            # `playwright install`. Do not: the environment sets
            # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD and the browser is already
            # there. Until this was pinned, Queensland, South Australia, the
            # NT and Tasmania all failed here with a message about a missing
            # browser, which reads as four blocked jurisdictions rather than
            # one wrong path.
            #
            # THIS DOES NOT MAKE THEM RUNNABLE IN THE SANDBOX, and it was
            # briefly written up as if it did. With the path pinned the browser
            # launches and the failure moves to the NEXT one:
            # ERR_CERT_AUTHORITY_INVALID, because the sandbox reaches the
            # network through a proxy whose CA Chromium does not trust.
            #
            # THAT IS FIXABLE, AND THIS COMMENT USED TO SAY IT WAS NOT. Adding
            # the session's proxy CA to Chromium's NSS store clears it — see
            # CLAUDE.md, which has the two commands. It is a trust
            # CONFIGURATION, not the --ignore-certificate-errors bypass this
            # comment was right to refuse. What is still true is that the fix is
            # per session, so these four stay runner-only here rather than
            # depending on a setup step nobody ran. On a runner the glob finds
            # whatever playwright installed, and an empty glob falls through to
            # the default launch.
            exe = next(iter(sorted(glob.glob(
                '/opt/pw-browsers/chromium-*/chrome-linux/chrome') + glob.glob(
                '/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell'),
                reverse=True)), None)
            b = pw.chromium.launch(args=['--no-sandbox'],
                                   **({'executable_path': exe} if exe else {}))
            _BROWSER['ctx'] = b.new_context(user_agent=UA, locale='en-AU')
        except Exception:
            # Leaving a half-started Playwright behind turns the next
            # jurisdiction's failure into "Sync API inside the asyncio loop",
            # which describes this function rather than the source that failed
            # — and that is the message someone would go and debug.
            close_browser()
            raise
    return _BROWSER['ctx']


def close_browser():
    if _BROWSER['stop']:
        _BROWSER['stop']()
        _BROWSER['ctx'], _BROWSER['stop'] = None, None


# WHAT A DOORMAN LOOKS LIKE, AND WHY ONE STRING WAS NOT ENOUGH.
#
# Every challenge wait in fetch() tested for Cloudflare's 'Just a moment' and
# nothing else, so a DIFFERENT interstitial was handed back to the caller as if
# it were the page. Measured 2026-09-28 on three ASX explorers — Core Lithium,
# Hillgrove/Kantra Copper and Magnetite Mines — all three sit behind a "Vercel
# Security Checkpoint", and all three came back as a rendered 31 KB document
# with zero PDF links. The probe reading them reported "0 pdfs, 0 annual", which
# reads exactly like a company that publishes no annual report.
#
# Two unrelated domains returning 31,312 and 31,316 bytes is what gave it away.
# A real site and a real absence do not agree to four significant figures.
#
# This is the same failure as the header assertion the line fallback skipped: a
# check that is present, looks thorough, and does not cover the case in front of
# it. Adding a name to this tuple is how the next doorman gets handled.
# 'Client Challenge' IS THE THIRD DOORMAN FOUND IN ONE DAY, on
# artgallery.nsw.gov.au — whose ROOT serves a normal 136 KB page while
# /about-us/corporate-information/annual-reports/ answers 3,036 bytes titled
# "Client Challenge". So a host can be half-open, and the tell is per-path.
#
# THREE TIMES IS A PATTERN AND THE LIST IS STILL THE MECHANISM. Each of these was
# found because a caller reported "no documents on this page" for a page that
# plainly has them, and each cost a probe. What they share is a tiny response
# whose <title> is not the site's — worth remembering if a fourth turns up,
# because a size-and-title heuristic would have caught all three without knowing
# any brand name.
#
# THE FOURTH TURNED UP, AND IT DEFEATS THE HEURISTIC THE PARAGRAPH ABOVE WAS
# PLEASED WITH. infratil.com answers every path — root included — with 16,512
# bytes from a SafeLine WAF: `server: Tengine`, an `sl-session` cookie, assets
# under /.safeline/, and `<title id="slg-title"></title>` EMPTY, filled in by
# script. So the tell that "would have caught all three without knowing any brand
# name" is a title this one does not have. The marker is the path instead.
#
# It is listed even though it arrives as HTTP 403, which `fetch` already raises
# on: a WAF configured to answer 200 with the same body is one setting away, and
# then the body is all there is to go on. Measured 2026-09-28 while looking for
# Infratil's FY2026 annual report.
CHALLENGE = ('Just a moment', 'Security Checkpoint', 'Checking your browser',
             'Attention Required!', 'challenge-platform', 'Client Challenge',
             '/.safeline/', 'slg-title')


def _challenged(html):
    """Is this an interstitial rather than the page asked for?"""
    return any(c in html for c in CHALLENGE)


def fetch(url, binary=False, via_browser=False, warm=None, expect=None, render=False):
    """GET, falling back to a real browser when the host refuses a plain one.

    TWO HOSTS HERE NEED IT, FOR DIFFERENT REASONS, and both were measured on a
    GitHub runner 2026-09-24:

      * www.data.qld.gov.au answers `x-amzn-waf-action: challenge` and returns
        a JavaScript interstitial. Not readable without executing it, from any
        network — the authoring sandbox and a runner get the same page.
      * vpsc.vic.gov.au answers HTTP 403 to a datacentre IP. It is perfectly
        readable from a developer machine and refuses the runner outright, so
        the generator worked locally and failed in CI on the same commit.

    browser-portals.yml documents exactly this split on job boards: reachable
    but not readable, versus readable but not reachable. One fallback covers
    both, because in each case the fix is to be a browser.

    `warm` is a page to load first, for a host that issues a cookie before it
    will serve the file. `expect="zip"` says the bytes must be a real workbook,
    which is how a WAF interstitial is caught — it answers 200 with HTML, so
    status alone does not reveal it. It is NOT inferred from `binary`: the
    Victorian 2023 release is a genuine CSV fetched as bytes, and inferring
    made the generator retry it through a browser it did not need.
    """
    if not via_browser:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                b = r.read()
            if not (expect == 'zip' and b[:2] != b'PK'):
                return b if binary else b.decode('utf-8-sig', 'replace')
            print(f'  (not a workbook, retrying through a browser: {url[:70]})', file=sys.stderr)
        except urllib.error.HTTPError as e:
            if e.code not in (401, 403, 405, 429, 503):
                raise
            print(f'  (HTTP {e.code}, retrying through a browser: {url[:70]})', file=sys.stderr)
        # A CONNECTION RESET IS A REFUSAL TOO, AND IT WAS NOT REACHING THE
        # FALLBACK. HTTPError was caught and URLError was not, so a host that
        # drops the connection instead of answering 403 propagated straight out
        # — and these hosts do both. Measured 2026-09-28: transport.nsw.gov.au
        # answered "[Errno 104] Connection reset by peer" on a run where the same
        # URL had served 8.3 MB through a warmed browser an hour earlier, so
        # Transport for NSW — the largest card on the NSW route — failed to
        # refresh with the one mechanism that can read it never being tried.
        # CLAUDE.md already records the reset signature for fire.nsw.gov.au and
        # for South Australia and Victoria; it is the same doorman, not a
        # different failure.
        #
        # This CANNOT swallow a real error: a URL that is simply wrong 404s,
        # which is an HTTPError with a code not in the list above and still
        # raises. What reaches here is a transport-level refusal, and the browser
        # is the answer to exactly that.
        except urllib.error.URLError as e:
            print(f'  ({e.reason}, retrying through a browser: {url[:70]})',
                  file=sys.stderr)

    ctx = _browser_ctx()
    if render:
        # RENDER, DO NOT REQUEST. Some pages build their list of documents in
        # JavaScript after load, so the raw response is a shell and a regex
        # over it finds nothing — which reads as a page with no links rather
        # than a page not yet drawn. ocpe.nt.gov.au's staffing-numbers page is
        # one: the probe saw fifty PDFs on it through page.content() while
        # fetch() saw none through ctx.request.
        page = ctx.new_page()
        try:
            if warm:
                page.goto(warm, wait_until='domcontentloaded', timeout=90_000)
                w = 0
                while _challenged(page.content()) and w < 30_000:
                    page.wait_for_timeout(3000)
                    w += 3000
            page.goto(url, wait_until='domcontentloaded', timeout=120_000)
            w = 0
            while _challenged(page.content()) and w < 30_000:
                page.wait_for_timeout(3000)
                w += 3000
            page.wait_for_timeout(2000)
            html = page.content()
            # A CHALLENGE PAGE IS NOT THE PAGE, AND RETURNING IT IS WORSE THAN
            # FAILING. This printed a reassuring "rendered 31,316 bytes" and
            # handed back a Vercel checkpoint, so the caller found no links and
            # reported a company with no annual report. Raising says what actually
            # happened; every caller that can tolerate it already catches.
            if _challenged(html):
                raise RuntimeError(
                    f'still behind an interstitial after {w // 1000}s '
                    f'({len(html):,} bytes) — {url[:70]} was not read')
            print(f'  (rendered {len(html):,} bytes from {url[:60]})', file=sys.stderr)
            return html
        finally:
            page.close()
    if warm:
        page = ctx.new_page()
        page.goto(warm, wait_until='domcontentloaded', timeout=90_000)
        page.wait_for_timeout(2500)   # a challenge runs after load
        # A CLOUDFLARE CHALLENGE NEEDS FAR LONGER THAN 2.5 SECONDS. Queensland's
        # AWS WAF hands over almost at once, so this wait was sized for it and
        # was never tested against a slower doorman. ocpe.nt.gov.au and
        # dpac.tas.gov.au take up to thirty, and warming that returns early
        # collects no cookie at all — which looks exactly like a host that
        # refuses browsers.
        w = 0
        while _challenged(page.content()) and w < 30_000:
            page.wait_for_timeout(3000)
            w += 3000
        if w:
            print(f'  (cleared a challenge on {warm[:50]} in {w // 1000}s)', file=sys.stderr)
        page.close()
    r = ctx.request.get(url, timeout=120_000)
    b = r.body()

    # A CHALLENGED RESPONSE MEANS THE WRONG CHANNEL, NOT A CLOSED DOOR.
    # ctx.request shares the cookie jar but not the browser's TLS and header
    # fingerprint, so Cloudflare re-challenges it inside a context that has
    # just cleared — 6 KB of "Just a moment" where a PDF was expected. A real
    # navigation carries the fingerprint the clearance was issued for. The
    # request path stays first because it is cheaper and is what Queensland
    # has always used; this is the fallback.
    if r.status != 200 or _challenged(b[:400].decode('utf-8', 'replace')):
        page = ctx.new_page()
        try:
            if binary:
                # Chromium DOWNLOADS a PDF rather than rendering it, and the
                # navigation aborts as it starts. That reads as a failure and
                # is a success into a file.
                with page.expect_download(timeout=120_000) as dl:
                    try:
                        page.goto(url, wait_until='domcontentloaded', timeout=20_000)
                    except Exception:                             # noqa: BLE001
                        pass
                path = dl.value.path()
                if path:
                    b = open(path, 'rb').read()
                    print(f'  (downloaded {len(b):,} bytes through a navigation)', file=sys.stderr)
                    return b
            else:
                resp = page.goto(url, wait_until='domcontentloaded', timeout=120_000)
                w = 0
                while _challenged(page.content()) and w < 30_000:
                    page.wait_for_timeout(3000)
                    w += 3000
                html = page.content()
                if not _challenged(html):
                    print(f'  (navigated instead of requested: {len(html):,} bytes)',
                          file=sys.stderr)
                    return html
                b = resp.body() if resp else b
        except Exception as e:                                    # noqa: BLE001
            print(f'  (navigation fallback failed: {type(e).__name__})', file=sys.stderr)
        finally:
            page.close()
    # Say what came back. A browser retry that still fails is otherwise an
    # empty result several frames away from its cause — Victoria returned zero
    # rows with no error at all, and the log said only "nothing loaded".
    if r.status != 200 or (expect == 'zip' and b[:2] != b'PK'):
        print(f'  (browser got HTTP {r.status}, {len(b)} bytes, starts {b[:24]!r})',
              file=sys.stderr)
    return b if binary else b.decode('utf-8-sig', 'replace')


def ckan_resource(api, dataset, match):
    """The first resource in `dataset` whose name contains `match`."""
    d = json.loads(fetch(f'{api}/package_show?id={dataset}'))['result']
    for r in d['resources']:
        if match.lower() in r['name'].lower():
            return r['url']
    return None


# Roster agencies the source CANNOT fill, with the measured reason.
#
# WHY THIS EXISTS. The unmatched list is a worklist, and a worklist that never
# shrinks stops being read. Every entry below was checked against the source
# rows by hand and cannot be closed by an alias, so leaving them printed as
# "no source row" invites the next pass to do the same search again and reach
# the same answer. A refusal is a claim and gets the same evidence as a match —
# the WGEA generator learned that when three of its refusals turned out to be
# wrong.
#
# Keyed like ALIAS, `jurisdiction:Roster Name`.
# A reason that applies to a WHOLE jurisdiction, used when no specific entry
# above covers the card.
#
# WHY NOT 57 IDENTICAL ENTRIES. New South Wales' remaining cards are almost all
# refused for the same structural fact — the source wired for NSW is a HEALTH
# annual report, so a non-health agency cannot be in it at any spelling — and
# writing that out once per card would be 57 copies of one sentence, which is
# how a table stops being read. Queensland's twenty-two are the opposite: each
# has its own reason (inside a named department, a statutory authority, an
# officer of the Parliament), so each is written out.
NOT_IN_SOURCE_JURISDICTION = {
    # THIS NOTE USED TO SAY THE PARSER WAS INCOMPLETE, AND IT WAS. It read
    # thirteen agencies summing to 20,418 against the report's own Total of
    # 32,473 — 63% — and six cards were blank for that reason rather than
    # because Tasmania withholds them. Fixed 2026-09-25: the table is read
    # with extract_tables() instead of a line regex, the newest edition is
    # used instead of the newest one with a year-earlier partner, and a
    # renamed agency keeps its row. All three reachable editions now parse to
    # 100% of their own stated Total, and four of those six cards filled.
    # The 0.95 self-check that caught it stays exactly where it is.
    'tas': 'the State Service Workforce Report covers AGENCIES of the '
           'Tasmanian State Service, and these two are not one. The report '
           "parses to 100% of its own stated Total — every agency it names is "
           'filed — so an absence here is the report not naming the body, not '
           'a parse losing it. Building Tasmania and Whole of Government '
           'Programs are neither departments nor listed authorities in it '
           'under any spelling',
    # RE-PROBED 2026-09-25 ACROSS FOUR SOURCES, AND HALF OF THIS NOTE WAS OUT
    # OF DATE. An earlier version said NSW "publishes no downloadable workforce
    # profile any more". It does. psc.nsw.gov.au has moved into nsw.gov.au and
    # /departments-and-agencies/premiers-department/reports-and-data/
    # workforce-profile-reports carries a PDF *and* an .xlsx for every year to
    # 2025, all reachable from here with no browser needed. What none of them
    # carries is an AGENCY. Measured, so that nobody spends another evening on
    # it:
    #
    #   data.nsw.gov.au CKAN         200. The only PSC workforce dataset is
    #                                "Gender and diversity Workforce Profile
    #                                data", 2006–2015. Nothing current.
    #   2025-additional-workforce-   200. 34 sheets. Every one by SERVICE or
    #     profile-data.xlsx          PORTFOLIO. Table 2.3 is the finest grain
    #                                there is.
    #   2025-workforce-profile-      200, 64 pages. Agency names appear ONLY in
    #     report.pdf                 prose — "Transport for NSW (−549 FTE)" —
    #                                and those are senior-executive deltas, not
    #                                workforce totals. Every table is portfolio.
    #   budget.nsw.gov.au open data  200. Twelve workbooks: budgeted financial
    #                                statements by SECTOR, plus performance and
    #                                wellbeing indicators. No workforce at all.
    #
    # So the grain claim below is the half that survived, and it is the half
    # that decides whether this closes. Sixty-three cards need sixty-three
    # annual reports; twelve agencies carry 82% of the route's live ads, which
    # is where that work should start if it is ever started.
    'nsw': "the source wired for NSW is the NSW HEALTH annual report appendix, "
           "which reports health organisations only — so a non-health agency "
           "cannot appear in it under any spelling. NSW's own Workforce Profile "
           "IS reachable and current — the 2025 workbook downloads from "
           "nsw.gov.au without a browser, re-checked 2026-09-25 — but its finest "
           "grain over 34 sheets is PORTFOLIO or SERVICE (Communities and "
           "Justice 55,041, Education 120,111, Transport 29,420), and a "
           "portfolio holds many agencies that each have their own card here. "
           "The one service row that IS a single agency, the NSW Police Force, "
           "is merged; the rest need their own annual reports. THE ONE INDEX "
           "THAT WOULD HOLD THEM ALL IS BLOCKED: every NSW agency tables its "
           "annual report in Parliament and parliament.nsw.gov.au/tp/files/ "
           "serves each as a PDF, which is the central list nsw.gov.au does not "
           "have — its sitemap carries 101 annual-report pages for about a dozen "
           "agencies. That host sits behind a Cloudflare interstitial this "
           "network cannot clear: measured 2026-09-27, a warmed browser still "
           "read \'Just a moment...\' after 120 seconds, ctx.request answered 403, "
           "and a download navigation timed out. So a found URL there is not a "
           "readable document from here, and the agency\'s OWN host is the route "
           "every time — which for Transport for NSW turned out to work once the "
           "search stopped going through the sitemap",
}

# THE WHOLE LIST WAS RE-CHECKED 2026-09-28, the same way the WGEA refusals were
# — and unlike those, it came back almost clean. That is worth recording so the
# next pass does not spend an afternoon re-running it.
#
# The method: for every card still blank in a jurisdiction, search that source's
# OWN row names for one CONTAINING the roster name, which neither norm() nor an
# exact lookup can do. Over Queensland's 38 rows against its 22 blank cards and
# Victoria's 261 against its 20, every hit was a coincidence of substring —
# "Racing Integrity Commission" against the Integrity Commissioner, "Royal
# Melbourne Hospital" against the Melbourne Recital Centre, "Victorian School
# Building Authority" against the Victorian Building Authority — and the four
# that looked real were already described correctly here:
#
#   Victorian Institute of Forensic Medicine   its row IS there and is half the
#                                              body; the reason already says so
#   State Revenue Office                       inside a DTF row that names it
#   Building and Plumbing Commission           created from the VBA after Jun 2024
#   Workforce Inspectorate Victoria            a rename, now established — moved
#                                              to ALIAS above
#
# So these reasons were written against the source rather than against one
# lookup, which is exactly what the WGEA list had not been. Three of those four
# would have been filed by a careless sweep, and each would have put one body's
# staff on another body's card.
NOT_IN_SOURCE = {
    # ── APS: read off the sheet itself, 2026-09-27 ────────────────────────────
    # WHY ALL FIVE AT ONCE. These are every gov-aps card left in the gap, and
    # none of them is a name-matching failure — which is what they looked like,
    # because the APSC sheet files agencies under short names and the roster
    # keeps formal ones, and that HAS been the answer before (`aps-` aliases
    # exist for exactly that). Dumping all 101 rows of Table 2 settles it: not
    # one of the five is present under any spelling, and the reason is the same
    # for each, so the honest record is five reasons naming the same structural
    # fact rather than five more aliases that could never match.
    #
    # TABLE 2 IS AN APS ACT CENSUS, NOT A LIST OF FEDERAL EMPLOYERS. It counts
    # people employed under the Public Service Act. An agency whose staff are
    # employed under its own statute is absent by construction and will stay
    # absent however the sheet is spelled — so the remaining route for those is
    # each agency's own annual report, not this source.
    'aps:Australian Signals Directorate':
        'employs its staff under the Intelligence Services Act, not the Public '
        'Service Act, so it is not in the APSC Table 2 census at all — checked '
        'against all 101 rows, which do carry the Office of National '
        'Intelligence (441) and the Inspector-General of Intelligence and '
        'Security (51), both of which ARE APS. Its own annual report is the '
        'only route left',
    'aps:Australian Security Intelligence Organisation':
        'employed under the ASIO Act rather than the Public Service Act, so it '
        'is absent from APSC Table 2 by construction, the same as the Australian '
        'Signals Directorate. Its own annual report is the only route left',
    'aps:Australian Securities and Investments Commission':
        'ASIC staff are employed under the ASIC Act, not the Public Service '
        'Act, so the APSC census does not cover them. Table 2 does carry the '
        'other Treasury-portfolio bodies that ARE APS — the ACCC (1,882), the '
        'ABS (3,791), the ATO (21,186) — which is what shows the absence is '
        'ASIC\'s employment basis and not a gap in the sheet',
    # THESE TWO ARE THE OPPOSITE PROBLEM: not absent, but already counted.
    'aps:Geoscience Australia':
        'INSIDE the Industry, Science and Resources figure (5,730), which is '
        "filed. Its people are APS employees of that department, and Table 2's "
        'only Industry-portfolio row of its own is the National Offshore '
        'Petroleum Safety and Environmental Management Authority (187). Filing '
        'it again would double count, the same call as National Parks and '
        'Wildlife Service inside DCCEEW',
    'aps:IP Australia':
        'INSIDE the Industry, Science and Resources figure (5,730) for the same '
        'reason as Geoscience Australia — a listed entity whose staff are that '
        "department's APS employees, with no row of its own in Table 2",
    # ── The last six of the eleven, written down 2026-09-28 ───────────────────
    # FOUR OF THESE CARDS ARE NOW FILLED, AND THE REASON STILL BELONGS HERE.
    # "Absent from APSC Table 2" stays true of all six however the card is
    # filled, and it is the fact that stops the next pass hunting for an alias.
    # What changed is the answer to "so what fills it": gen-headcount.py's
    # OWN_REPORT now reads four of these agencies' own annual reports, and
    # `filedHeadcount` checks COMPANY_HEADCOUNT before this file. Each reason
    # names its figure so the two generators can be seen to agree.
    'aps:Australian Federal Police':
        'employed under the Australian Federal Police Act, not the Public '
        'Service Act, so Table 2 cannot carry it. FILLED from its own annual '
        'report instead — 8,328 staff as at 30 June 2025, stated twice in the '
        'document (Table B3 and the prose on p64, which breaks the same total '
        'into 3,578 police officers, 838 protective service officers and 3,912 '
        'unsworn staff)',
    'aps:Reserve Bank of Australia':
        'employed under the Reserve Bank Act and outside the APS entirely, so '
        'it is not in Table 2 and never will be. FILLED from its own annual '
        'report — 2,039 employees at 30 June 2025, excluding Note Printing '
        'Australia, whose 304 staff the roster does not carry',
    'aps:CSIRO':
        'employed under the Science and Industry Research Act, so the APS Act '
        'census does not reach it. FILLED from its own annual report — 5,998 '
        'head count at 30 June 2025 against 6,618 the year before',
    'aps:Australian Prudential Regulation Authority':
        'employed under the APRA Act, the same basis as ASIC, so Table 2 is '
        'silent on it while carrying every Treasury-portfolio body that IS APS. '
        'FILLED from its own annual report — 897 employees on a permanent or '
        'fixed-term basis at 30 June 2025 against 870 a year earlier',
    # AND THESE TWO ARE STILL BLANK, for two different reasons.
    'aps:Australian Space Agency':
        'NOT AN AGENCY IN ITS OWN RIGHT — it is a branch of the Department of '
        'Industry, Science and Resources, so its people are inside that '
        "department's 5,730, which is filed. There is no separate annual report "
        'to read and filing a figure here would double count, the same call as '
        'Geoscience Australia and IP Australia in the same portfolio',
    'aps:Australian Sports Commission':
        'a corporate Commonwealth entity outside the APS Act, so absent from '
        'Table 2 like the others here. Its own annual report DOES carry staffing '
        'statistics and is not filed only because the PDF is served from an '
        'Azure blob URL carrying an expiring SAS signature — a spec pinned to '
        'that link would stop resolving within hours. The stable route is the '
        'transparency.gov.au publication, which renders the same appendix as '
        'HTML rather than as a PDF, and the report-reading path only reads PDFs',
    'nsw:Crown Solicitor\'s Office':
        'THE TABLE IS THERE AND HAS NO TOTAL, WHICH THIS PATH REFUSES TO SUPPLY. '
        'p15 of its 2024-25 report prints Table 5 "Employee headcount" by ANZSCO '
        'classification — Managers 9/9, Professionals 347/362, Technicians and '
        'Trades Workers 1/1, Clerical and Administrative Workers 165/194 — with no '
        'Total row, and no sentence anywhere in the 68 pages states one: 566 and '
        '522 appear nowhere in the document. The `from_components` path adds rows '
        'up only against an independent quantity the document itself states, '
        'because the risk it guards is a table that omits a group rather than one '
        'that adds up wrong, and nothing here can rule that out — ANZSCO has eight '
        'major groups and four are listed. So the sum (566 for 2024-25 against 522) '
        'is written down here rather than filed. THE CHECK THAT WOULD UNLOCK IT '
        'EXISTS IN THE DOCUMENT: Table 4 beside it is the same four rows as FTE '
        '(503.6 against 457.0), so a spec that summed both and required each head '
        'count to be at least its own FTE would catch a read that grabbed the wrong '
        'table. That is new machinery, not a spec, and it would serve every NSW '
        'agency that publishes both tables and no total. Its own caveat is worth '
        'carrying too: "The figures are estimates compiled from the Annual '
        'Workforce Profile, and do not include agency staff"',
    'nsw:Law Enforcement Conduct Commission':
        'A .pdf URL THAT SERVES A REACT PAGE, which is a new shape here and is '
        'why this is recorded rather than retried. lecc.nsw.gov.au lists '
        '/publications/annual-reports/law-enforcement-conduct-commission-annual-'
        'report-2023-24.pdf and that exact URL answers 200 with 297,563 bytes of '
        'HTML — <html data-reactroot> titled "Law Enforcement Conduct Commission '
        'Annual Report 2023-2024", a landing page for the file rather than the '
        'file. Retried with the listing page as referer and Accept: '
        'application/pdf, same HTML; the page carries no separate asset path to '
        'follow, only the .pdf URL that returns itself. Note also that 2024-25 is '
        'NOT published — the listing stops at 2023-24 — so even a readable file '
        'would be a year behind, which is fine here (DCJ already is) but is worth '
        'knowing before hunting for a current one',
    # ── Four NSW cards that are a filed department's own divisions ────────────
    # ALL FOUR WERE SETTLED FROM TWO DOCUMENTS ALREADY IN THIS TABLE, without a
    # single new fetch, and that is the point worth carrying forward: the reports
    # filed for the departments name their divisions and their personnel-services
    # clients, so several blank cards in a portfolio are answered by re-reading
    # the one report the portfolio's head already supplies. It is the Destination
    # NSW move, applied deliberately rather than stumbled on.
    'nsw:Revenue NSW':
        "INSIDE the Department of Customer Service figure, which is filed, and the "
        "very table that figure comes from prints its own row: p71, \"Division "
        "Full Time Equivalent (FTE) over time\", Revenue NSW 1,441.9 / 1,769.4 / "
        "1,776.1 / 1,819.4 against a Total of 7,651.9 at 19 June 2025. So a real, "
        "dated, precise figure exists for this card and filing it would put the "
        "same 1,819.4 FTE on two cards. p15's organisation chart carries Revenue "
        "NSW as one of the department's divisions, beside Digital.NSW and Fair "
        "Trading. The division figure is available if the roster ever stops "
        "carrying the department",
    'nsw:State Insurance Regulatory Authority':
        "INSIDE the same Department of Customer Service total, at 446.6 FTE on "
        "that same p71 table (446.2 the year before). It is a separate ENTITY "
        "rather than a division, and that does not change the answer: p151 lists "
        "it among the \"entities within the Customer Service Portfolio that are "
        "subject to personnel services agreements\", and p159 books $73.2 million "
        "of personnel services revenue from it — DCS employs its people and "
        "recharges the cost, so they are in the department's head count",
    'nsw:Create NSW':
        'INSIDE the Creative Industries, Tourism, Hospitality and Sport figure '
        '(1,019 head count at 19 June 2025), which is filed. p14 of that report '
        'lists the department\'s divisions and Create NSW is one of the five — '
        'Office of the Secretary, Create NSW, Hospitality and Racing, 24-Hour '
        'Screen and Sound, Corporate Services. Its employee-classification table '
        'is by classification rather than by division, so no separate figure for '
        'it is published; the department\'s is the only one there is',
    'nsw:Liquor & Gaming NSW':
        'INSIDE the same Creative Industries figure. It is an operating brand '
        'within that department\'s Hospitality and Racing division rather than a '
        'division in its own right — p36 and p42 report its work as the '
        "department's, and p14's list of portfolio agencies that publish "
        'SEPARATE annual reports names the Independent Liquor and Gaming '
        'Authority and the NSW Independent Casino Commission, both distinct '
        'bodies, and not L&GNSW. No figure for it alone is published anywhere in '
        'the report',
    # ── Two NSW bodies whose people are DCCEEW's, stated in two documents ─────
    # THE FILED DEPARTMENT'S OWN REPORT NAMES THEM. DCCEEW's 2024-25 volume 1,
    # p53 under "Personnel services and employment arrangements": "In 2024–25,
    # the department provided personnel services to the following entities:
    # Biodiversity Conservation Trust, Jenolan Caves Reserve Trust, Lord Howe
    # Island Board, Natural Resources Access Regulator, Taronga Conservation
    # Society Australia." DCCEEW's head count is filed, so a figure on either of
    # these cards puts the same people on two cards — the National Parks and
    # Wildlife Service call, and the Destination NSW call, on evidence rather
    # than on the shape of the cluster.
    #
    # WATERNSW IS DELIBERATELY NOT IN THAT LIST and it is the useful control.
    # p13 of the same report carries it as a related agency, and the
    # personnel-services list does not, which is what a state-owned corporation
    # employing its own staff looks like from the department's side. That is why
    # WaterNSW still needs its own report and is recorded below as blocked, while
    # these two need none.
    'nsw:Taronga Conservation Society Australia':
        "INSIDE the DCCEEW head count, which is filed, and Taronga's own report "
        'says so as plainly as the department\'s does: p109, "Since the '
        'Administrative Arrangement Order 2023, all employees are under the '
        'employment of DCCEEW, therefore salaries and wages, annual leave and '
        'on-costs are classified as personnel services expenses". Its impact '
        'pages do carry "1,044 total staff team members", in an infographic with '
        'no as-at date anywhere near it, so even taken alone it could not be '
        'filed — but the reason it is not filed is the double count',
    'nsw:Natural Resources Access Regulator':
        'INSIDE the DCCEEW head count, which is filed. Named in the same '
        'personnel-services list as Taronga on p53 of the department\'s 2024-25 '
        'report, so its people are DCCEEW employees. nrar.nsw.gov.au answers 403 '
        'to this network as well, but that is not the reason — a reachable report '
        'would still be reporting the same people',
    # ── Three NSW state-owned corporations behind one Cloudflare, 2026-09-28 ──
    # A CHALLENGE A WARMED BROWSER DOES NOT CLEAR, which is a different answer
    # from every other Cloudflare host here and the reason it is written down
    # rather than retried. The Northern Territory and Tasmania both sit behind
    # "Just a moment" and both hand over inside thirty seconds; these three do
    # not hand over at all. Measured with the wait raised to 180 SECONDS, six
    # times the generator's cap: Forestry Corporation 28,844 bytes still
    # challenged, Essential Energy 28,824 bytes still challenged. So raising the
    # shared cap would buy nothing and cost every other host six times the wait —
    # the cap stays at thirty.
    #
    # THREE UNRELATED DOMAINS AGREEING TO FOUR SIGNIFICANT FIGURES is the tell
    # the CHALLENGE comment describes, and here it is again: 28,696 / 28,737 /
    # 28,765 bytes on the first pass. One doorman, three hosts, and the useful
    # conclusion is about the exit IP rather than about any of them.
    #
    # WaterNSW is HALF-OPEN, and that is worth separating from the other two: its
    # ROOT clears in thirty seconds, and the request that follows for the report
    # under /documents/publications/ is answered 403 anyway — 5,972 bytes where a
    # PDF was expected, with the navigation fallback timing out. So the clearance
    # is real and does not extend to the file path, which is the Art Gallery's
    # per-path shape rather than a host that refuses browsers.
    #
    # All three reports are published and none was read. The remaining routes are
    # a different exit IP, or the tabled-papers copy on parliament.nsw.gov.au,
    # which is the host this file already records as closed.
    # ESSENTIAL ENERGY AND WATERNSW ARE NOW FILED — 3,939 and 1,151 — and their
    # entries here are comments for the usual reason: each measurement stands and
    # neither reason can print again. Essential Energy's own host answers 403 and
    # a warmed browser waited 180 s on its publications page with the content
    # still the interstitial at 28,824 bytes; WaterNSW is half-open, its root
    # clearing in 30 s while the report path is answered 403 inside that cleared
    # context at 5,972 bytes. Both cards were filled without their own hosts:
    # WaterNSW from the tabled copy through files.parliament.nsw.gov.au, and
    # Essential Energy from a campaign microsite, since its tabled copy is the
    # 2023-24 one. What was wrong in these reasons was only the last sentence of
    # Essential Energy's — "Nothing about whether it publishes a workforce figure
    # is established" — which was true of its own site and said as though it were
    # true of the company.
    # FORESTRY CORPORATION IS NOW FILED at 611, THROUGH THE TABLED COPY, and its
    # entry here is a comment because the measurement stands and the reason cannot
    # print: forestrycorporation.com.au answers the same Cloudflare challenge as
    # Essential Energy, byte for byte the same interstitial, and 180 s of warmed
    # browser does not clear it (28,844 bytes). Its own site is still closed. The
    # report reached the card from files.parliament.nsw.gov.au instead — which is
    # the route Essential Energy and WaterNSW should be tried on next.
    'tas:Whole of Government Programs':
        'A JOB-BOARD CATEGORY, NOT AN AGENCY, which is why no workforce figure '
        'can exist for it. jobs.tas.gov.au/agency/19 is titled "Whole of '
        "Government Programs\" — the roster's Tasmanian cards come from that "
        'board\'s agency list — and the State Service workforce report names '
        'seventeen agencies, every one of them a real department or authority, '
        'with nothing of this name among them. Roles advertised under it are '
        'employed by whichever agency runs the program, so their people are '
        'already inside one of the seventeen',
    # ── Probed 2026-09-27 with a headless browser ─────────────────────────────
    'sa:TAFE SA':
        'not reachable. Its own site answers 404 at every annual-report path '
        'tried, warmed browser included, and carries only credit-statement '
        'reports; the SA government host that would hold it 403s this network. '
        "TAFE SA is also not in the state's workforce report, which names "
        'departments and administrative units',
    'nzhealth:Northern Regional Alliance (NRA)':
        'ROUTED HERE DELIBERATELY so the run says so in the right place. Since '
        'September 2024 the Health NZ report folds NRA into a combined "National '
        'Payrolls" row with seven other agencies — its people are inside that '
        '4,614, not absent from it, and no row anywhere names NRA. Sent to the '
        'Public Service Commission instead it would read as the PSC having no '
        'answer, which is the wrong reason for the right outcome',
    # ── NSW: the rest of the top twelve, each tried 2026-09-25 ────────────────
    # Six NSW agencies now come from their own annual report (NSW_AGENCY_REPORTS).
    # These are the others among the twelve that carry 82% of the route's ads,
    # and each of these reasons is a measurement rather than "no source row", so
    # the next pass starts from what was already established.
    # ALREADY MEASURED, FROM A DOCUMENT READ FOR ANOTHER CARD. No probing needed:
    # the Creative Industries report filed on this route states it outright.
    'nsw:Destination NSW':
        "INSIDE the Creative Industries, Tourism, Hospitality and Sport figure "
        "(1,019), which is filed. Its p46 says so in as many words: \"As at 19 "
        "June 2025, Destination NSW had 177.8 full-time equivalent (FTE) staff "
        "which equates to a headcount of 187 staff (this number is already "
        "included in the department's total workforce figure)\", and p13 adds "
        "that it \"is a statutory body under the Destination NSW Act 2011 but is "
        "not a staff agency\" — its people are employed by the department. So a "
        "real, dated, precise figure exists for this card and filing it would put "
        "the same 187 people on two cards, which is the National Parks and "
        "Wildlife Service call inside DCCEEW. A separate figure is available if "
        "the roster ever stops carrying the department",
    'nsw:Museum of Applied Arts and Sciences':
        'its 2024-25 annual report exists and only the BLOCKED host has it. '
        'Measured 2026-09-28: parliament.nsw.gov.au/tp/files/192296 carries the '
        '"2024-25 Powerhouse Museum Annual Report", and that host cannot be read '
        'from here (120 s of warmed browser still on the interstitial). Its own '
        'site does not publish it — powerhouse.com.au/about renders 334,018 bytes '
        'unchallenged with no PDF at all and links nothing annual; /governance '
        'renders 433,385 bytes and holds exactly ONE PDF, which was opened and is '
        'a 2021 Indigenous Cultural and Intellectual Property protocol, not a '
        'report. maas.museum/about/annual-reports renders with no links and '
        'powerhouse.com.au/about/annual-reports 404s. So the document is real, '
        'its location is known, and no copy of it is reachable',
    'nsw:Sydney Trains':
        'its 2024-25 annual report downloads and BOTH volumes were read (72 + 80 '
        'pages, 2026-09-27): neither carries an employee-count table. The '
        'workforce section is percentages only — a diversity table against '
        'benchmarks — and the sole headcount-shaped number in either volume is '
        '"11,735 employees voted, 86 per cent of" in an enterprise-agreement '
        'ballot. THAT IS A TURNOUT, NOT A WORKFORCE, and dividing it by the 86% '
        'to get ~13,600 would be a figure this codebase invented from a rounded '
        'percentage. Its people are inside the Transport SERVICE row of the '
        'Workforce Profile (29,420 FTE for the whole portfolio), which is not '
        'this card. Worth recording that transport.nsw.gov.au IS readable '
        'through a warmed browser though it 403s a plain fetch — so the same '
        "route is open for Sydney Metro and NSW Trains, whose reports sit "
        'beside this one',
    'nsw:TAFE NSW':
        'no annual report reachable. tafensw.edu.au answers 404 at every '
        'annual-report path and its sitemap of 1,357 URLs contains the word '
        '"annual" zero times; the report is not on nsw.gov.au either',
    'nsw:Fire and Rescue NSW':
        'fire.nsw.gov.au REFUSES this network, and re-tested 2026-09-27 with a '
        'warmed browser it still does: the annual-reports page renders as 174 '
        'BYTES — not a page with no links, a page with no content — and the '
        'direct report path its own site publishes '
        '(__data/assets/pdf_file/0022/4936/annual_report_2024_25.pdf) answers '
        '5,818 bytes of 403 HTML through the browser, with the download '
        'navigation timing out. The report EXISTS, which is more than the '
        'earlier probe could say; it is tabled in Parliament, and that host is '
        'blocked too. Nothing here can open either copy',
    'nsw:NSW Rural Fire Service':
        'the same refusal as Fire and Rescue, measured 2026-09-27. Its '
        'annual-reports page renders through a warmed browser — 28,722 bytes, so '
        'the host is not refusing the page — and links NO document at all, by '
        'extension or by label. Its own direct report path '
        '(__data/assets/pdf_file/...) answers 403 HTML to the browser and times '
        'out on a download navigation, and admin.rfs.nsw.gov.au is unreachable '
        'through this proxy (502). The 2024-25 report is tabled in Parliament, '
        'whose host is blocked, so the document exists and no copy of it is '
        'reachable from here',
    # THIS CARD IS NOW FILED at 3,418 and its entry here is a comment for the
    # same reason DCJ's and the Department of Education's are: the measurement is
    # still true and the reason could never print again. It said "no annual report
    # on nsw.gov.au or planning.nsw.gov.au. The only 'annual-reports' page on
    # either is the Valuer General's, a different body". Both halves hold — the
    # report is on neither of those hosts. It is TABLED, and the file API on
    # files.parliament.nsw.gov.au serves it, which is the finding recorded beside
    # the spec. "Not on the agency's own sites" was read as "not reachable", and
    # that gap is the whole lesson.
    # Aboriginal Affairs NSW is a GROUP of the Premier's Department, which is now
    # filed at 1,072: p10 introduces it as one of the department's own areas and
    # the budget appendices carry it as "Major Activity Group 2: Aboriginal
    # Affairs", not as a separate entity. The department's report publishes no
    # figure for the group alone, so the only figure that exists is the one now
    # on the department's card, and putting it here too would double count.
    'nsw:Aboriginal Affairs NSW':
        "INSIDE the Premier's Department head count (1,072 at census 2025), which "
        'is filed. p10 of that report introduces Aboriginal Affairs NSW as one of '
        'the department\'s own areas and its budget appendices carry it as "Major '
        'Activity Group 2: Aboriginal Affairs" rather than as a separate entity. '
        'No figure for the group alone is published anywhere in the report — the '
        'only personnel-services client it names is the Aboriginal Languages '
        'Trust, which is a different body and not a roster card',
    'nsw:National Parks and Wildlife Service':
        'INSIDE the Department of Climate Change, Energy, the Environment and '
        'Water, whose 6,208 is filed. That report names its exclusions — '
        'Biodiversity Conservation Trust, Dams Safety NSW, Taronga, Energy '
        'Corporation of NSW, the EPA and Energy Security Corporation — and NPWS '
        'is not among them, so its people are in the 6,208 rather than absent '
        'from it. Filing it again would double count',
    # And the three DCCEEW names its note DOES exclude, which is why they are
    # separate cards with no figure rather than part of the 6,208.
    'nsw:Taronga Conservation Society Australia':
        "excluded by name from the DCCEEW annual report's workforce table, so "
        'it needs its own report',
    'nsw:NSW Environment Protection Authority':
        "excluded by name from the DCCEEW annual report's workforce table, so "
        'it needs its own report',
    'nsw:Energy Corporation of NSW':
        "excluded by name from the DCCEEW annual report's workforce table, so "
        'it needs its own report',
    # ── Western Australia: outside the PSM Act bulletin ────────────────────
    # Nine WA cards are absent from every edition, and the reason is the one
    # perthGovWorkforce.ts already stated at the top of the file it replaces:
    # the Public Sector Commission reports agencies under the Public Sector
    # Management Act, and government trading enterprises, Parliament-funded
    # bodies and statutory authorities outside it are not in the collection.
    # Checked against the 2025-26 sheet's 57 rows rather than assumed.
    'perth:Gold Corporation':
        'a government trading enterprise (the Perth Mint); no row in any '
        'edition of the bulletin',
    'perth:Pilbara Ports Authority':
        'a port authority, a GTE outside the PSM Act bulletin',
    'perth:Rottnest Island Authority':
        'a statutory authority outside the PSM Act bulletin',
    'perth:Perth Zoo':
        'the Zoological Parks Authority is outside the PSM Act bulletin',
    'perth:Western Australian Museum':
        'no row names it; the museum sits under the Arts and Culture Trust, '
        'which is itself absent from the bulletin',
    'perth:Arts and Culture Trust':
        'a statutory authority outside the PSM Act bulletin',
    'perth:Tourism Western Australia':
        'a statutory authority outside the PSM Act bulletin',
    'perth:Parliamentary Services Department':
        'Parliament-funded, and the bulletin covers the public sector under the '
        'PSM Act rather than the departments of Parliament',
    'perth:State Solicitors Office':
        'no row names it; its staff are inside the Department of Justice '
        '(8,578), where the State Solicitor sits — that parent is inference, '
        'since the bulletin separates no branch of any department',

    # ── New South Wales: what the PORTFOLIO grain costs ────────────────────
    # The jurisdiction-level reason below covers the rest. These six say
    # something sharper, because for them a real figure EXISTS and is being
    # declined rather than missing.
    'nsw:NSW Health':
        'the NSW Health Service is reported at 140,998 FTE, and it is declined: '
        'the Local Health Districts inside it hold their own cards here, twelve '
        'of them already filed, so putting the service total on this card would '
        'count the same people twice',
    # DCJ AND THE DEPARTMENT OF EDUCATION ARE NOW FILED from their own annual
    # reports, so their entries here could never print again and have been turned
    # into comments rather than left looking live. What they recorded is still
    # worth keeping, because it is a caution about the OTHER source: the
    # Communities and Justice PORTFOLIO is 55,041 FTE and is not the department —
    # Corrective Services, Youth Justice and Legal Aid sit inside it and are
    # separate cards here. Likewise the Education portfolio is 120,111 FTE and
    # the Teaching Service alone is 71,491; neither is the department.
    'nsw:Corrective Services NSW':
        'inside the Communities and Justice portfolio (55,041); no row reports '
        'it on its own',
    'nsw:Youth Justice NSW':
        'inside the Communities and Justice portfolio (55,041); no row reports '
        'it on its own',
    'nsw:Legal Aid NSW':
        'inside the Communities and Justice portfolio (55,041); no row reports '
        'it on its own',

    # ── Queensland: the source covers DEPARTMENTS, and little else ─────────
    #
    # Queensland is the opposite shape to Victoria and the contrast is the
    # whole finding. Victoria had 208 spare source rows against 38 blank cards,
    # so its answers were aliases. Queensland's State of the Sector data is 38
    # rows against 22 blank cards, and reading all 38 (2026-09-25) settles it:
    # they are the departments plus a short tail of agencies — Queensland
    # Health 119,625, Education 79,353, Police 19,132, down through Legal Aid
    # Queensland 816, the Art Gallery 301, the Museum 263, to the Integrity
    # Commissioner at 16.
    #
    # WHAT IS ABSENT IS A CATEGORY, NOT A NAME. Not one independent statutory
    # authority or officer of the Parliament appears in any of the 38 rows: no
    # Audit Office, no Ombudsman, no Crime and Corruption Commission, no
    # Stadiums Queensland, no QLeave. So "no row names it" here is not a
    # spelling problem an alias could fix, and no amount of re-reading the list
    # will produce one. Each entry below states that observation first, which
    # is what was measured; where a parent is named as well, that is the
    # inference and is marked as one.
    #
    # The five spare rows are spare because the ROSTER has no card for them —
    # Premier and Cabinet, the Museum, Human Rights, the Public Sector
    # Commission, the Norfolk Island Taskforce — so Queensland offers no alias
    # in either direction.

    # Inside a department, and the department is named in the source.
    'qld:Teach Queensland':
        "not an employer: it is the Department of Education's teacher "
        'recruitment brand, and its people are inside that department\'s 79,353. '
        'The largest single ad count in the whole gap, and there is no figure '
        'to file for it',
    'qld:Queensland Academy of Sport':
        'no row names it; it is a unit inside the Department of Sport, Racing '
        'and Olympic and Paralympic Games (370)',
    'qld:Queensland Ambulance Service':
        'no row names it. Its staff sit inside Queensland Health (119,625) — '
        'that part is inference, since the source separates neither the '
        'ambulance service nor any other clinical stream',

    # Independent statutory authorities. None of the 38 rows is one of these,
    # so the absence is the collection's scope rather than a naming mismatch.
    'qld:Queensland Building and Construction Commission':
        'no row names it, and no independent statutory authority appears in '
        'any of the 38 rows',
    'qld:Queensland Curriculum and Assessment Authority':
        'no row names it; statutory authority, outside the collection',
    'qld:Crime and Corruption Commission':
        'no row names it; independent statutory body, outside the collection',
    'qld:Cross River Rail Delivery Authority':
        'no row names it; statutory authority, outside the collection',
    'qld:Office of the Public Guardian':
        'no row names it; independent statutory office, outside the collection',
    'qld:QLeave':
        'no row names it; the portable long service leave authority is a '
        'statutory body, outside the collection',
    'qld:Queensland Racing Integrity Commission':
        'no row names it; statutory body, outside the collection',
    'qld:Health and Wellbeing Queensland':
        'no row names it; statutory body, outside the collection',
    'qld:National Injury Insurance Agency Queensland':
        'no row names it; statutory agency, outside the collection',
    'qld:Queensland Mental Health Commission':
        'no row names it; statutory body, outside the collection',
    'qld:Queensland Rural and Industry Development Authority':
        'no row names it; statutory authority, outside the collection',
    'qld:Energy and Water Ombudsman Queensland':
        'no row names it; statutory scheme, outside the collection',
    'qld:Stadiums Queensland':
        'no row names it; statutory authority, outside the collection',
    'qld:Queensland Pharmacy Business Ownership Council':
        'no row names it; statutory council, outside the collection',
    'qld:Office of Industrial Relations':
        'no row names it; an office inside a department rather than an agency '
        'reported in its own right. Which department is not established here — '
        'Queensland has moved it more than once — so no parent is named',

    # Officers of the Parliament, which is not part of the public service.
    'qld:Parliamentary Service':
        'no row names it; the Parliamentary Service is not part of the public '
        'service the collection covers',
    'qld:Queensland Audit Office':
        'no row names it; an officer of the Parliament, outside the collection',
    'qld:Office of the Queensland Ombudsman':
        'no row names it; an officer of the Parliament, outside the collection. '
        "The source's 'Office of the Health Ombudsman' (163) is a DIFFERENT "
        'body and must not be taken for it',
    'qld:Information Commissioner':
        'no row names it; an officer of the Parliament, outside the collection',

    # ── Victoria: inside a parent's row, and not separable ─────────────────
    # The source says so itself, in the parent row's own brackets.
    'vic:State Revenue Office':
        "inside 'Department of Treasury and Finance (includes State Revenue "
        "Office and Commission for Better Regulation)' — 1,612 covers both, and "
        "filing it here too would be the same people on two cards",
    'vic:Victorian Institute of Forensic Medicine':
        "split in two and only half is reachable: 47 executive and forensic "
        "employees have their own row, the rest are inside DJCS's 9,852 by that "
        "row's own wording. 47 would understate it, 9,852 is the department",
    'vic:Homes Victoria':
        'inside the Department of Families, Fairness and Housing (7,172); no row '
        'names Homes Victoria',
    'vic:VicGrid': 'inside DEECA (6,226); no row names VicGrid',
    'vic:Victorian School Building Authority':
        'inside the Department of Education; no row names the VSBA. The near '
        'name in the source, Victorian Building Authority (490), is the '
        'building-practitioner regulator and a different body entirely',

    # ── Victoria: one employer for many roster cards ───────────────────────
    # COURT SERVICES VICTORIA EMPLOYS EVERY VICTORIAN COURT'S STAFF — 3,072
    # plus 6 court CEOs — and no row separates the jurisdictions. The roster
    # holds five courts as five cards, so filing 3,078 would put one number on
    # five different cards. That is the double count already declined for NSW
    # Health's portfolios.
    'vic:Supreme Court': 'employed by Court Services Victoria (3,078); no row per court',
    'vic:County Court': 'employed by Court Services Victoria (3,078); no row per court',
    'vic:Magistrates Court': 'employed by Court Services Victoria (3,078); no row per court',
    "vic:Children's Court": 'employed by Court Services Victoria (3,078); no row per court',
    'vic:Victorian Civil and Administrative Tribunal (VCAT)':
        'employed by Court Services Victoria (3,078); no row per jurisdiction',

    # ── Victoria: did not exist when the file was measured ─────────────────
    # The newest VPSC edition is Jun 2024 and these are 2024-25 creations, so
    # their absence is a date, not a gap in coverage. They should appear of
    # their own accord in the first edition that postdates them.
    'vic:Social Services Regulator': 'created after Jun 2024, the newest VPSC edition',
    'vic:Building and Plumbing Commission': 'created after Jun 2024 (from the VBA)',
    'vic:Workplace Injury Commission': 'created after Jun 2024',
    'vic:Triple Zero Victoria':
        'created after Jun 2024; its predecessor ESTA has no row in the file either',
    'vic:Victorian Infrastructure Delivery Authority':
        'created after Jun 2024',
    'vic:Victorian Infrastructure Delivery Authority | Health':
        'created after Jun 2024',
    'vic:Victorian Infrastructure Delivery Authority | Rail':
        'created after Jun 2024',
    'vic:Victorian Infrastructure Delivery Authority | Roads':
        'created after Jun 2024',

    # ── Victoria: a near name that is NOT this body ────────────────────────
    'vic:Royal Melbourne Hospital':
        "the source's unit is 'Melbourne Health' (9,983), the health service "
        'that operates the hospital AND NorthWestern Mental Health. The roster '
        'card names the hospital, so this is the group-for-an-entity swap the '
        'WGEA generator refuses: the group is used only when the roster names it',
}


def norm(s):
    """Case, punctuation and filler words only. PARENTHESES ARE KEPT, and that
    is deliberate: Victoria reports "Department of Education" (4,931 public
    servants) and "Department of Education (teaching service and school support
    employees)" (90,091 teachers) as two rows, because they are two different
    workforces. Stripping the bracket collapsed them into one key, the match
    then saw two candidates for it, and BOTH were dropped as ambiguous — which
    is the matcher behaving correctly on a question the normaliser had made
    unanswerable.

    "Department" goes, because the APSC sheet files a department under its
    portfolio ("Agriculture, Fisheries and Forestry") while the roster keeps
    the formal name ("Department of Agriculture, Fisheries and Forestry")."""
    s = re.sub(r'\b(the|and|of|department)\b', ' ', str(s).lower())
    return re.sub(r'[^a-z0-9]', '', s)



def read_existing():
    """The rows and the per-jurisdiction provenance already in the output file.

    A run that cannot reach a source keeps what is there rather than deleting
    it, so the file has to be read before it is written. Parsed with a regex
    rather than imported, because it is TypeScript and this is Python, and a
    shape it does not recognise is treated as no previous file at all — the
    worst case is a rewrite, which is what used to happen every time.
    """
    try:
        txt = open(OUT).read()
    except FileNotFoundError:
        return {}, {}
    rows = {}
    for m in re.finditer(r'^  "([^"]+)": \{ ([^}]*) \},', txt, re.M):
        body = {}
        # `null` HAS TO BE IN THIS ALTERNATION, and leaving it out was a real
        # crash rather than a tidiness point. A row with no prior reading is
        # written as `yoy: null` with `prev` omitted entirely — Tasmania's
        # eleven rows are all like that since its own prior edition stopped
        # being comparable. Parsing that back gave a dict with neither key, and
        # the emitter's v['prev'] raised KeyError on the next run that MERGED
        # Tasmania instead of loading it. Normalising both to None here is what
        # makes a prev-less row round-trip.
        for k, v in re.findall(r'(\w+): ("(?:[^"]*)"|null|-?[\d.]+)', m.group(2)):
            body[k] = (None if v == 'null'
                       else v.strip('"') if v.startswith('"')
                       else float(v))
        body.setdefault('prev', None)
        body.setdefault('yoy', None)
        rows[m.group(1)] = body
    # THE LABEL CANNOT BE `[^:]+`, BECAUSE TEN LABELS CONTAIN A COLON. It was,
    # and every NSW agency source — "NSW: Treasury", "NSW: Department of
    # Education" — parsed as the label "NSW" with the agency name pushed into the
    # line. Ten sources collapsed onto one key, the last one won, and since no
    # source is ever called plain "NSW" that key was never matched this run and
    # came back out as
    #
    #     //   NSW: Primary Industries and Regional Development: 1 agencies
    #          published as at Jun 2025 — KEPT, not refreshed this run
    #
    # beside that same source's own "refreshed today" line. Harmless to the
    # FIGURES — they are parsed separately — and corrosive to the one signal a
    # human reads to notice a source going quietly stale: South Australia's KEPT
    # line that run was real, and this noise sat next to it.
    #
    # The emitted line always begins with a count, so the label is everything up
    # to the last ": " before a digit. Non-greedy plus that anchor gets it.
    meta = {}
    for m in re.finditer(r'^//   (.+?): (\d+ .+?)(?: — (?:refreshed|KEPT).*)?$', txt, re.M):
        meta[m.group(1)] = m.group(2)
    return rows, meta


# ── APS ─────────────────────────────────────────────────────────────────────
def load_aps():
    """Table 2: agency by employment category, two Decembers in one sheet.

    The portfolio rows are the DEPARTMENT, not a portfolio total: the
    Attorney-General's row is 2,255 while its eleven sub-agency rows sum to
    4,553. So every row is one body and none of them nests.
    """
    import openpyxl
    api = 'https://data.gov.au/data/api/3/action'
    d = json.loads(fetch(f'{api}/package_search?q=APS+Employment+Data&rows=50'))['result']
    best = None
    for p in d['results']:
        m = re.match(r'APS Employment Data (\d{1,2} \w+ \d{4})', p['title'])
        if not m:
            continue
        for r in p['resources']:
            if 'xlsx' in (r.get('format') or '').lower():
                key = (int(m.group(1)[-4:]), 0 if 'June' in m.group(1) else 1)
                if not best or key > best[0]:
                    best = (key, m.group(1), r['url'])
                break
    if not best:
        return {}, None, 'headcount'
    _, asof, url = best
    wb = openpyxl.load_workbook(io.BytesIO(fetch(url, True, expect='zip')), read_only=True,
                                data_only=True)
    ws = wb['Table 2']
    hdr = [c for c in next(ws.iter_rows(min_row=4, max_row=4, values_only=True))]
    y_prev, y_now = str(hdr[5]).strip(), str(hdr[6]).strip()
    out = {}
    for row in ws.iter_rows(min_row=5, values_only=True):
        name = row[0]
        if not name or not str(name).strip():
            continue
        name = str(name).strip()
        if name.lower().startswith(('total', 'source', 'note', '(')):
            continue
        try:
            prev, now = int(float(str(row[5]).replace(',', ''))), int(float(str(row[6]).replace(',', '')))
        except (TypeError, ValueError):
            continue
        out[name.lstrip('- ').strip()] = (now, prev)
    return out, (f'Dec {y_now}' if 'December' in asof else asof.split()[-1]), 'headcount'


# ── Victoria ────────────────────────────────────────────────────────────────
def load_vic():
    """VPSC "Number of Employees by Organisation" — one year per file, so the
    two most recent releases are read and joined on the organisation name."""
    import openpyxl
    api = 'https://discover.data.vic.gov.au/api/3/action'
    d = json.loads(fetch(f'{api}/package_search?q=VPSC+Workforce+Data&rows=30'))['result']
    years = {}
    for p in d['results']:
        m = re.match(r'VPSC Workforce Data (\d{4})', p['title'].strip())
        if not m:
            continue
        for r in p['resources']:
            if 'by organisation' in r['name'].lower():
                years[int(m.group(1))] = r['url']
                break
    if len(years) < 2:
        return {}, None, 'headcount'
    now_y, prev_y = sorted(years, reverse=True)[:2]

    def read(url):
        # Warmed at the site root: if the 403 is a bot check rather than an IP
        # block, the cookie it wants is set by visiting a page first.
        raw = fetch(url, True, warm='https://vpsc.vic.gov.au/')
        rows = {}
        if raw[:2] == b'PK':
            wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            ws = wb[wb.sheetnames[0]]
            it = ([c for c in r] for r in ws.iter_rows(min_row=3, values_only=True))
        else:
            it = ([r.get('Employing organisation'), None, None,
                   next((v for k, v in r.items() if k and 'headcount' in k.lower()), None)]
                  for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig', 'replace'))))
        for r in it:
            if not r or not r[0]:
                continue
            try:
                rows[str(r[0]).strip()] = int(float(str(r[3]).replace(',', '')))
            except (TypeError, ValueError, IndexError):
                continue
        return rows

    a, b = read(years[now_y]), read(years[prev_y])
    if not a or not b:
        print(f'  Victoria: parsed {len(a)} rows for {now_y}, {len(b)} for {prev_y}',
              file=sys.stderr)
    return {k: (a[k], b[k]) for k in a if k in b}, f'Jun {now_y}', 'headcount'


# ── Queensland ──────────────────────────────────────────────────────────────
def load_qld():
    """State of the Sector workbook, sheet "5. Agency" — Total FTE by agency.

    TWO THINGS ABOUT THIS SOURCE ARE DIFFERENT FROM EVERY OTHER ONE HERE.

    It needs a browser. www.data.qld.gov.au answers a plain request for the
    file with `x-amzn-waf-action: challenge` and 2,027 bytes of
    `window.awsWafCoo…`. Measured 2026-09-24 from the authoring sandbox AND
    from a GitHub runner: both get the same interstitial, so it was never an IP
    block and moving the fetch alone changes nothing. A real browser clears it
    with no human step — see .github/workflows/qld-workforce.yml, which is the
    only way this loader runs.

    It reports FTE, NOT HEADCOUNT. Every agency-level figure in the workbook is
    a full-time equivalent; the one head count in all seventeen sheets is a
    tenure distribution with no agency breakdown. FTE is systematically lower
    than a head count, so the rows are marked `fte` and the card labels the
    tile "Workforce FTE" rather than putting two measurements under one word.
    """
    import openpyxl

    api = 'https://data.qld.gov.au/api/3/action'
    dataset = 'queensland-public-service-workforce-quarterly-profile'
    pkg = json.loads(fetch(f'{api}/package_show?id={dataset}'))['result']
    cands = [x for x in pkg['resources']
             if 'state of the sector' in x['name'].lower()
             and (x.get('format') or '').lower() in ('xlsx', 'xls')]
    if not cands:
        return {}, None, 'headcount'
    cands.sort(key=lambda x: (re.search(r'(20\d\d)', x['name']) or ['', '0'])[1], reverse=True)
    url = cands[0]['url']

    # The dataset page is loaded first: the challenge runs there and leaves the
    # aws-waf-token the file download is checked against.
    raw = fetch(url, binary=True, via_browser=True, expect='zip',
                warm=f'https://www.data.qld.gov.au/dataset/{dataset}')
    if raw[:2] != b'PK':
        print('  Queensland: still challenged — no workbook', file=sys.stderr)
        return {}, None, 'headcount'

    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb['5. Agency']
    head = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    # Column headers are real dates (2022-03-01 … 2026-03-01), newest last.
    cols = [(i, c) for i, c in enumerate(head) if hasattr(c, 'year')]
    if len(cols) < 2:
        return {}, None, 'headcount'
    (i_prev, d_prev), (i_now, d_now) = cols[-2], cols[-1]
    # THE SHEET HOLDS MORE THAN ONE TABLE and the read has to stop at the end
    # of the first. Row 80 starts "Number of FTE by Gender and Agency", whose
    # columns are Woman/Man/Non-binary per year rather than a year per column,
    # and reading its rows against this header's offsets is what reported
    # Queensland Health at 837 -> 91,258 FTE, a 10,803% rise. Every agency in
    # both tables was overwritten by its gender row.
    #
    # Anchored on the sheet's own terminator rather than on blank lines: the
    # first table contains single blank rows (between the budget agencies, the
    # other entities and the Norfolk Island row) and "Whole of sector total" is
    # the line that actually ends it.
    out = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = row[0]
        if not name or not str(name).strip():
            continue
        name = str(name).strip()
        if name.lower().startswith('whole of sector'):
            break
        # Sub-totals are not agencies and would match nothing, but they are
        # skipped explicitly so a roster entry could never collide with one.
        if name.lower().startswith(('sector sub-total', 'total', 'source', 'note',
                                    'agencies shaded')):
            continue
        try:
            now, prev = float(row[i_now]), float(row[i_prev])
        except (TypeError, ValueError, IndexError):
            continue
        # A machinery-of-government change shows as 0 in the years before the
        # agency existed — seven of the fourteen departments read 0 until 2025.
        # That is not a workforce that grew from nothing, so it is skipped
        # rather than reported as infinite growth.
        if now <= 0 or prev <= 0:
            continue
        # First mention wins. The Norfolk Island Taskforce is listed twice with
        # identical figures; a later table would otherwise overwrite a real row.
        out.setdefault(name, (round(now), round(prev)))
    asof = f'Mar {d_now.year}'
    if (d_now.year - d_prev.year) != 1:
        print(f'  Queensland: readings are {d_now.year - d_prev.year} years apart', file=sys.stderr)
    return out, asof, 'fte'


# ── South Australia ─────────────────────────────────────────────────────────
#
# THE WHOLE JURISDICTION IS CLOSED TO THE AUTHORING SANDBOX, not just this
# source's host, and that is worth knowing before spending an afternoon on a
# South Australian card. Measured 2026-09-29 with a WARMED BROWSER, which is the
# fallback that clears the Northern Territory and Tasmania:
#
#     publicsector.sa.gov.au   still challenged after 30 s   28,768 bytes
#     agd.sa.gov.au            still challenged after 30 s   28,994 bytes
#     safework.sa.gov.au       still challenged after 30 s   28,756 bytes
#
# One Cloudflare configuration, three hosts, and the same interstitial size as
# the three NSW state-owned corporations recorded in NOT_IN_SOURCE (28,696 to
# 28,844) — so this is a property of the exit IP rather than of any of them, and
# 180 seconds was already shown not to help on the NSW three.
#
# WHAT THAT MEANS FOR THE TEN SOUTH AUSTRALIAN CARDS STILL BLANK. Each would be
# answered by its own agency's annual report or by a statement in the Attorney-
# General's Department's, and none of those documents can be fetched from here.
# The route is the GitHub runner, where this loader already works — the workflow
# has SA probe steps for exactly this reason — so a probe step that fetches a
# couple of SA agency reports and prints what it finds is the next move, not
# another attempt from this machine.
def load_sa():
    """OCPSE Workforce Information Report — per-agency FTE and HEADCOUNT.

    PDF ONLY. Every edition from 2012 to 2025 is a PDF and there is no
    spreadsheet at any of them, so this is the one source here that is read out
    of a document rather than a data file. South Australia's CKAN portal was
    checked first and carries agency-by-agency self reports, not a consolidated
    table.

    READ FROM THE TEXT LAYER, NOT FROM extract_tables(). The tables come back
    with agency names cut off mid-word — "Department for Correctional Servic",
    "Barossa Hills Fleurieu Local Healt" — and a truncated name cannot be
    matched exactly, which is the only thing keeping a figure on the right
    agency. The text layer carries them in full:

        Department for Correctional Services 1,959 2,057 2,024 2,132

    Four trailing numbers, in the order the section header gives them: FTE and
    headcount for the earlier June, then FTE and headcount for the later one.
    HEADCOUNT is taken, so South Australia counts people like everywhere else
    and unlike Queensland.

    The four-number shape is also what bounds the read. The report breaks a
    dozen other things down by agency — graduates and trainees carry five
    numbers, separations two — so they cannot match, and the running header is
    checked as well so a stray line cannot wander in.
    """
    import pdfplumber

    page = fetch('https://publicsector.sa.gov.au/about/Resources-and-Publications/'
                 'Workforce-Information')
    links = re.findall(r'href="([^"]*?(\d{4})-Workforce-Information-Report\.pdf)"', page)
    if not links:
        return {}, None, 'headcount'
    url, year = max(links, key=lambda x: x[1])
    if url.startswith('/'):
        url = 'https://publicsector.sa.gov.au' + url
    raw = fetch(url, binary=True)
    if raw[:4] != b'%PDF':
        print('  South Australia: not a PDF', file=sys.stderr)
        return {}, None, 'headcount'

    # "Name  a  b  c  d", where each of the four is a number or an em/hyphen
    # dash. A dash means the agency did not exist in that period — Housing and
    # Urban Development reads "- - 323 338" — and a dash is never read as zero.
    #
    # A DASH IN THE EARLIER PAIR NO LONGER DROPS THE ROW, and this loader
    # dropping it is why two of South Australia's fourteen departments looked
    # absent from a report that names them. Housing and Urban Development and
    # State Development were both created on 1 July 2024, so the June 2024
    # columns are dashes and the June 2025 columns are real — and the row was
    # skipped whole, which reads from the outside exactly like a source that
    # does not carry the agency. It was nearly written down as one: the 98 rows
    # this loader returned were dumped precisely to explain those two cards, and
    # the explanation would have been a refusal naming a fact about the PDF that
    # is not true of it.
    #
    # `prev` MAY BE None ALL THE WAY THROUGH — main() has supported it since
    # Western Australia restructured its departments, and the card shows the
    # figure with no delta. This loader predates that support and kept the
    # stricter rule after it arrived. The dash is still never a zero and a dash
    # in the LATER pair still drops the row, because that is an agency with no
    # current reading at all.
    ROW = re.compile(r'^(.{4,80}?)\s+([\d,]+|[-–])\s+([\d,]+|[-–])\s+([\d,]+|[-–])\s+([\d,]+|[-–])$')
    SECTION = 'FULL-TIME EQUIVALENT AND TOTAL WORKFORCE HEADCOUNT'
    out = {}
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        for pg in pdf.pages:
            txt = pg.extract_text() or ''
            if SECTION not in txt:
                continue
            for line in txt.splitlines():
                m = ROW.match(line.strip())
                if not m:
                    continue
                name = m.group(1).strip()
                if name.upper() != name.lower() and name.isupper():
                    continue                      # a header row, not an agency
                prev_hc, now_hc = m.group(3), m.group(5)
                if not now_hc[0].isdigit():
                    continue                      # no reading for the later June
                out.setdefault(name, (int(now_hc.replace(',', '')),
                                      int(prev_hc.replace(',', ''))
                                      if prev_hc[0].isdigit() else None))
    return out, f'Jun {year}', 'headcount'


# ── New South Wales ─────────────────────────────────────────────────────────
def _nsw_police_fte():
    """(now, prev, year) FTE for the NSW Police Force, from the Workforce Profile.

    Returns None rather than raising: this is one card, and it must never take
    down the twelve health organisations the appendix supplies.

    The report is linked from the Premier's Department page — the same one
    load_nsw's docstring records finding through nsw.gov.au's sitemap index, and
    it answers a plain request with a browser User-Agent. The service table is
    "name  prev  now  change  pct", so the CHANGE COLUMN RECONCILES the other
    two, and that is asserted: a column order that flips would otherwise report
    a fall as a rise with both numbers still real.
    """
    import pdfplumber
    page = 'https://www.nsw.gov.au/departments-and-agencies/premiers-department/reports-and-data/workforce-profile-reports'
    try:
        html = fetch(page).decode('utf-8', 'replace') if isinstance(fetch(page), bytes) else fetch(page)
    except Exception as e:                                        # noqa: BLE001
        print(f'  New South Wales: profile page unreachable ({type(e).__name__})', file=sys.stderr)
        return None
    m = re.findall(r'href="([^"]*?(\d{4})-workforce-profile-report\.pdf)"', html, re.I)
    if not m:
        print('  New South Wales: no workforce-profile PDF linked', file=sys.stderr)
        return None
    url, year = max(m, key=lambda x: int(x[1]))
    if url.startswith('/'):
        url = 'https://www.nsw.gov.au' + url
    try:
        raw = fetch(url, binary=True)
        import io as _io
        with pdfplumber.open(_io.BytesIO(raw)) as pdf:
            for pg in pdf.pages[:20]:
                for line in (pg.extract_text() or '').split('\n'):
                    mm = re.match(r'^NSW Police Force\s+([\d,]+)\s+([\d,]+)\s+'
                                  r'([\u2212+-]?[\d,]+)\s', line.strip())
                    if not mm:
                        continue
                    prev = int(mm.group(1).replace(',', ''))
                    now = int(mm.group(2).replace(',', ''))
                    chg = int(mm.group(3).replace(',', '').replace('\u2212', '-').replace('+', ''))
                    # TOLERANCE OF ONE, AND IT IS NEEDED. Measured 2026-09-25:
                    # the row reads 20,106 -> 19,513 with a change of −592,
                    # while the difference of those two is 593. Each column is
                    # rounded from a fractional FTE on its own, so the published
                    # change is not obliged to equal the difference of the
                    # published values, and an exact test rejects a perfectly
                    # good row. The guard still does its job: were the columns
                    # transposed, now − prev would be +593 against a stated
                    # −592, out by 1,185.
                    if abs((now - prev) - chg) > 1:
                        print(f'  New South Wales: police row does not reconcile '
                              f'({prev} -> {now} against {chg}) — not merged', file=sys.stderr)
                        return None
                    return now, prev, int(year)
    except Exception as e:                                        # noqa: BLE001
        print(f'  New South Wales: profile PDF unreadable ({type(e).__name__})', file=sys.stderr)
        return None
    print('  New South Wales: no NSW Police Force row in the profile', file=sys.stderr)
    return None


def load_wa():
    """WA Public Sector Commission "State of the Sector" bulletin — headcount.

    WESTERN AUSTRALIA WAS THE ONLY JURISDICTION WITH NO LOADER. Its figures
    lived in src/employsi/data/perthGovWorkforce.ts, whose header says
    AUTO-GENERATED while no script in this repo produces it — 47 rows entered
    by hand from the 2021-22 to 2024-25 bulletins. So WA could not be
    refreshed, and was not: measured 2026-09-25, a 2025-26 edition had been on
    the same page since September and the repo was a year behind it.

    THAT STALENESS WAS READING AS A GAP. Sixteen WA cards were blank, and the
    obvious conclusion — statutory bodies the bulletin does not cover — was
    right about nine of them and wrong about seven. Western Australia
    restructured its departments in 2025, and the 2025-26 bulletin names the
    new ones: Transport and Major Infrastructure 2,145, Housing and Works
    2,362, Local Government Industry Regulation and Safety 1,652, Creative
    Industries Tourism and Sport 1,590, Mines Petroleum and Exploration 536,
    Energy and Economic Diversification 520, and MyLeave 39. Nothing was
    missing; the source had moved on and this had not.

    EIGHT ROWS HAVE NO PRIOR YEAR AND MUST NOT BE GIVEN ONE. The 2024-25
    edition reports the OLD structure — Energy Mines Industry Regulation and
    Safety, Jobs Tourism Science and Innovation, Transport, Treasury, Finance,
    Local Government Sport and Cultural Industries — and the 2025-26
    workbook's "5 year comparison" sheet is whole-of-sector only (headcount
    158,004 to 187,450, no agency breakdown). The new departments were
    assembled from parts of the old, so no old row IS any one of them, and
    summing predecessors would turn a machinery-of-government decision into a
    headcount change. Those rows carry `prev = None` and a null `yoy`.

    Department of Treasury and Finance is the clearest case for that rule: the
    hand-made file had it at 1,587, which is about Treasury plus Finance added
    together, while the 2025-26 bulletin reports the merged department at 815.
    Whether that is a real fall or functions moving elsewhere is not something
    this file can tell, so it states the figure and no change at all.

    The bulletin is an .xlsx and the sheet is "Workforce": agency name in the
    first column, headcount in the second, FTE in the third. HEADCOUNT is taken
    — the file it supersedes is a head count, and the column is labelled as an
    annual average of quarterly unique individuals.
    """
    import openpyxl

    coll = ('https://www.wa.gov.au/government/document-collections/'
            'state-of-the-wa-government-sector-workforce-statistical-bulletins')
    html = fetch(coll)
    if isinstance(html, bytes):
        html = html.decode('utf-8', 'replace')
    # sots_statistical_bulletin_2025-26_0.xlsx — the trailing _0 is Drupal's,
    # so the year is matched rather than the whole filename.
    found = {}
    for href, yr in re.findall(
            r'href="([^"]*sots_statistical_bulletin_(\d{4})-\d{2}[^"]*\.xlsx?)"', html, re.I):
        found.setdefault(int(yr), href if href.startswith('http')
                         else 'https://www.wa.gov.au' + href)
    if len(found) < 2:
        print(f'  Western Australia: {len(found)} bulletins linked, need two',
              file=sys.stderr)
        return {}, None, 'headcount'
    now_y, prev_y = sorted(found, reverse=True)[:2]

    def sheet(url):
        raw = fetch(url, binary=True)
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        if 'Workforce' not in wb.sheetnames:
            raise RuntimeError(f'{url}: no Workforce sheet')
        rows = {}
        for r in wb['Workforce'].iter_rows(values_only=True):
            if not r or not r[0] or not isinstance(r[1], (int, float)):
                continue
            name = str(r[0]).strip()
            # THE SECTOR TOTAL IS NOT AN AGENCY. 187,450 against the largest
            # real row of 65,098 — the same aggregate trap as South Australia's
            # General Government Sector.
            if name == 'WA Public Sector':
                continue
            rows[name] = int(r[1])
        # Under forty rows means the sheet moved, not that the sector shrank.
        if len(rows) < 40:
            raise RuntimeError(f'{url}: only {len(rows)} agency rows parsed')
        return rows

    now, prev = sheet(found[now_y]), sheet(found[prev_y])
    return ({k: (v, prev.get(k)) for k, v in now.items()},
            f'{now_y}-{str(now_y + 1)[2:]}', 'headcount')


def load_nsw():
    """NSW Health annual report appendix — staffing by health organisation.

    NEW SOUTH WALES PUBLISHES A WORKFORCE PROFILE AND IT HAS NO AGENCY IN IT.
    That distinction matters, because this docstring used to say the profile was
    no longer published and gave the wrong reason — that the PSC's page carried
    no data and its links were drawn in JavaScript. The page is real, reachable
    and machine-readable. It is at

        nsw.gov.au/departments-and-agencies/premiers-department/
                   reports-and-data/workforce-profile-reports

    which is under the Premier's Department rather than the Public Service
    Commission, and no path I guessed reached it — nsw.gov.au's sitemap index
    did, in one request, out of 33,017 URLs. Same lesson as the Northern
    Territory: ask a site for its map before inventing paths.

    It serves a PDF report and an "additional data" workbook for every year from
    2020 to 2025, and the 2025 workbook has 34 sheets. Measured 2026-09-25,
    reading all of them and all 64 pages of the report: THE FINEST GRANULARITY
    IS PORTFOLIO.

        Table 2.2  by SERVICE   Public Service 84,780 · NSW Health Service
                                140,998 · NSW Police Force 19,513 · Teaching ·
                                Transport · Other Crown · State-owned
        Table 2.3  by PORTFOLIO Communities and Justice 55,041 · Education
                                120,111 · Customer Service 11,237 · Planning
                                4,613 · Premier and Cabinet 3,091 · …

    Neither is an agency. A portfolio is a group of departments and agencies
    under one Secretary, and the roster holds the sub-agencies as their own
    cards — Corrective Services, Youth Justice and Legal Aid all sit inside
    Communities and Justice. Filing 55,041 against the Department of Communities
    and Justice would attribute its whole portfolio to it while its children
    carry their own rows, which is the double count declined for NSW Health.

    INDIVIDUAL ENTITIES APPEAR ONLY IN PROSE, AND ONLY AS CHANGES: "Sydney Water
    Corporation increased by 361 FTE (+10.5%)". A level can be derived from
    those two numbers, and deliberately is not. 361/0.105 is arithmetic over a
    percentage rounded to one decimal place, which puts the answer inside a band
    about forty FTE wide, and the result would be a figure no row anywhere
    states. The rule in CLAUDE.md is that a number on a card came from a row.

    So the 64 non-health NSW agencies need 64 annual reports, and that is the
    honest size of the remaining job rather than a source waiting to be found.
    data.nsw.gov.au is not it either: its per-agency workforce extract is the
    PSC's 2006-2015 gender and diversity file, and every dataset it returns for
    "full time equivalent" is school ENROLMENTS.

    What IS published is the health side, which is where the value was anyway:
    13 Local Health Districts carry 1,667 of New South Wales' 2,561 live ads.
    The NSW Health annual report's appendix gives each organisation a table —

        Hunter New England Local Health District
        Treasury group June 2022 June 2023 June 2024 June 2025
        Medical 1,662 1,710 1,803 1,896
        ...
        Total 12,884 13,407 13,752 14,117

    — four consecutive Junes, so the last two are a year apart.

    FIVE ROWS USED TO COME OUT NAMED AFTER A PAGE, not an organisation: "NSW
    Health Annual Report 2024-25 Page 372" and four like it, carrying real
    figures. This docstring said it cost nothing — "every one of them is a
    Local Health District the roster does not carry ... the twelve health
    organisations the roster DOES carry all parse correctly". THAT WAS WRONG,
    and wrong in the most expensive way available here.

    The appendix has TWO sections over the same organisations, and they are
    not the same measurement:

        Appendix 2, "Workforce statistics / Full time equivalent" — 4 years,
            June 2022-2025, the FTE tables, from p16.
        "Headcount / Number of staff in headcount employed in the NSW public
            health system." — 2 years, June 2024-2025, from p30.

    A table crossing a page break repeats its "Treasury group ..." header at
    the top of the next page, where the line before it is the page footer
    rather than a name. So that table's FTE total was filed under a page
    number — and the organisation's real name was then still free when the
    HEADCOUNT section reached it, and took the head count instead. The parser
    walks both sections and keeps the first hit per name, so the two bugs
    combined to swap the MEASURE on exactly those organisations whose FTE
    table happened to straddle a page.

    Measured 2026-09-25, that reached two live roster cards:

        South Western Sydney LHD   15,233 head count where the FTE is 12,965
                                   — an 18% overstatement
        NSW Ambulance               7,677 head count where the FTE is 7,509

    Both read "Workforce FTE". Fixed on both sides: a repeated header carries
    the organisation across the break instead of naming the table after the
    page, and only the FTE section is recorded, because `fte` is what this
    loader returns. 33 parsed rows become 27 — five page names and one
    head-count-only spelling of Health Education Training Institute go, and
    nothing the roster carries is lost.

    IT IS FTE, NOT HEADCOUNT, and the data says so as well as the document:
    small organisations report "Medical 0.6 0.6 0.6 0.6" and "Nursing 1.0 0.3
    1.0 1.0". You cannot have 0.6 of a person. Marked `fte` accordingly, so
    these tiles read "Workforce FTE" like Queensland's and are never added to
    or compared with a head count — which is precisely the guarantee the bug
    above was quietly breaking.

    The FIRST pages a search finds are activity statistics — admitted
    episodes, occupancy, emergency presentations — which name the same
    districts and carry bigger numbers. Those are not staffing, and taking
    them for it would put a district's patient count on its card.
    """
    import pdfplumber

    year = __import__('datetime').date.today().year
    raw = None
    for y in (year, year - 1):
        url = f'https://www.health.nsw.gov.au/annualreport/Publications/{y}/appendix.pdf'
        try:
            b = fetch(url, binary=True)
        except Exception:                                         # noqa: BLE001
            continue
        if b[:4] == b'%PDF':
            raw = b
            break
    if raw is None:
        print('  New South Wales: no appendix PDF', file=sys.stderr)
        return {}, None, 'headcount'

    HEADER = re.compile(r'^Treasury group((?:\s+\w+\s+20\d\d)+)\s*$')
    TOTAL = re.compile(r'^Total\s+((?:[\d,.]+\s+){2,})?([\d,.]+)\s+([\d,.]+)\s*$')
    # The running header/footer the appendix repeats on every page. It is the
    # line that used to be taken for an organisation name.
    RUNNING = re.compile(r'Annual Report|^Page\s+\d+$|^\d+$')

    def is_heading(t):
        return bool(t) and len(t) > 8 and not RUNNING.search(t)

    out, asof = {}, None
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        pending = None            # the organisation this table belongs to
        last_org = None           # the last real heading, for continuations
        prev_line = ''
        in_fte = False
        for page in pdf.pages:
            for line in (page.extract_text() or '').splitlines():
                line = line.strip()
                # WHICH OF THE TWO SECTIONS ARE WE IN. Appendix 2 opens with
                # "Full time equivalent" and the head-count section with
                # "Headcount", each on a line of its own.
                if line == 'Full time equivalent':
                    in_fte = True
                elif line == 'Headcount':
                    in_fte = False
                m = HEADER.match(line)
                if m:
                    years = re.findall(r'(\w+)\s+(20\d\d)', m.group(1))
                    if len(years) >= 2:
                        # A TABLE THAT CROSSES A PAGE BREAK REPEATS THIS
                        # HEADER, and the line before it is then the page
                        # footer rather than a name. Carry the organisation
                        # across instead of naming the table after the page.
                        if is_heading(prev_line):
                            pending = last_org = prev_line
                        else:
                            pending = last_org
                        if pending:
                            asof = f'{years[-1][0][:3]} {years[-1][1]}'
                    prev_line = line
                    continue
                t = TOTAL.match(line)
                if t and pending:
                    try:
                        now = float(t.group(3).replace(',', ''))
                        prev = float(t.group(2).replace(',', ''))
                    except ValueError:
                        pending, prev_line = None, line
                        continue
                    if in_fte and now > 0 and prev > 0:
                        out.setdefault(pending, (round(now), round(prev)))
                    pending = None
                prev_line = line

    # TWO GUARDS, BOTH FOR FAILURES THAT ARE SILENT IN THE WRONG DIRECTION.
    #
    # A page name among the keys means the continuation handling has stopped
    # working. That never produces an error on its own — the row simply goes
    # unmatched, and the organisation it belonged to then takes whatever the
    # HEADCOUNT section offers, which is how an 18% overstatement sat on South
    # Western Sydney's card reading "Workforce FTE".
    # ── ONE ROW FROM A SECOND NSW DOCUMENT ─────────────────────────────────
    #
    # The health appendix cannot hold a non-health agency, so 63 of NSW's 64
    # blank cards are refusals (see NOT_IN_SOURCE). Exactly one is not, and it
    # is worth the extra fetch.
    #
    # The Workforce Profile's service table gives, in one row, both years:
    #
    #     NSW Police Force  20,106  19,513  −592  −2.9
    #
    # WHY THIS ONE AND NOTHING ELSE IN THAT TABLE. Every other row is either an
    # aggregate over agencies — Public Service 84,780, other Crown services
    # 51,838, the sector totals — or a service whose members hold their own
    # roster cards, which is the double count declined for NSW Health's
    # 140,998. The NSW Police Force is a single organisation, the roster has one
    # card for it, and nothing else on the roster sits inside it: the Law
    # Enforcement Conduct Commission is independent oversight, not part of the
    # force. So the service row IS the agency here.
    #
    # Same unit and same date as the appendix — FTE at 30 June — which is what
    # lets it join those rows rather than needing a source of its own. Both are
    # asserted below rather than assumed.
    police = _nsw_police_fte()
    if police:
        now_p, prev_p, yr = police
        if asof and asof.endswith(str(yr)):
            out.setdefault('NSW Police Force', (now_p, prev_p))
        else:
            print(f'  New South Wales: profile is {yr}, appendix is {asof} — '
                  f'NSW Police Force not merged', file=sys.stderr)

    stray = [k for k in out if RUNNING.search(k)]
    if stray:
        raise RuntimeError(f'NSW: {len(stray)} tables named after a page, not an '
                           f'organisation: {stray[:3]}')
    # And if the "Full time equivalent" caption is ever reworded, in_fte stays
    # False for the whole document and this returns nothing. Empty is handled
    # safely upstream (previous rows are kept and the run says so), but it
    # would read as an unreachable source rather than a renamed heading.
    if not out:
        raise RuntimeError('NSW: no FTE rows — has the "Full time equivalent" '
                           'section caption changed?')
    return out, asof, 'fte'


# ── New Zealand ─────────────────────────────────────────────────────────────
NZ_BASE = 'https://www.publicservice.govt.nz/assets'
NZ_FILES = (
    # Public Service departments, and the Crown entities beside them. Two files
    # because Te Kawa Mataaho publishes them as two, with the same columns.
    f'{NZ_BASE}/Departmental-FTE-changes-v2.csv',
    f'{NZ_BASE}/Crown-entity-FTE-changes-v3.csv',
)


def load_nz():
    """Te Kawa Mataaho Public Service Commission — FTE by agency.

    NEW ZEALAND WAS RECORDED HERE AS HAVING NO SOURCE AND THAT WAS WRONG. The
    earlier probe called publicservice.govt.nz unreachable; measured 2026-09-24
    it answers 200 to a plain request, and the two CSVs below download without
    a browser. What IS bot-protected is catalogue.data.govt.nz, whose CKAN API
    returns an Imperva interstitial ("Pardon Our Interruption") instead of
    JSON — so the open-data portal is the blocked route and the agency's own
    site is not. Going through the portal first is what produced the false
    negative.

    The files are linked from
    /data/workforce-data/public-sector-composition/workforce-size, and that
    path is worth keeping: the obvious guesses (/research-and-data,
    /resources/workforce-data) 404, and the real one is only in the site's own
    navigation.

    IT IS FTE, NOT HEADCOUNT, and the data says so rather than the heading:
    the Cancer Control Agency reports 57.4 and the year change as -1.4305. So
    the rows are marked `fte`, the card labels those tiles "Workforce FTE", and
    they are never added to or compared with a head count — the same treatment
    Queensland and NSW Health already get.

    THE NEWEST COLUMN IS NOT USED, deliberately. Each file carries FTE at 30
    June 2024, 30 June 2025 and 31 March 2026. March 2026 is the freshest
    figure and is nine months from June 2025, not a year; reporting that
    difference as a year-on-year would be measuring the gap between two
    different points in the cycle. June to June is a year, so the pair is June
    2025 against June 2024 and `asof` says June 2025.

    Health New Zealand's districts are NOT in either file — they are Crown
    entities of a kind these files do not enumerate, and they carry a third of
    New Zealand's live ads. That is a separate source and is not solved here.
    """
    import csv as _csv
    rows, asof = {}, None
    for url in NZ_FILES:
        raw = fetch(url).lstrip('\ufeff')
        rdr = _csv.DictReader(io.StringIO(raw))
        cols = rdr.fieldnames or []

        # Find the two June columns by their year rather than by position, so a
        # new edition that adds a quarter shifts nothing silently. If either is
        # missing the loader fails loudly instead of filing a wrong pair.
        def june(year):
            for c in cols:
                if re.search(rf'30\s*June\s*{year}', c or '', re.I):
                    return c
            return None
        name_col = cols[0] if cols else None
        c_now, c_prev = june(2025), june(2024)
        if not (name_col and c_now and c_prev):
            raise RuntimeError(f'NZ: expected June 2025 and June 2024 columns, got {cols}')
        asof = 'Jun 2025'

        for r in rdr:
            name = (r.get(name_col) or '').strip()
            if not name or name.lower().startswith(('total', 'note', 'source')):
                continue
            try:
                now = float(str(r[c_now]).replace(',', '').strip())
                prev = float(str(r[c_prev]).replace(',', '').strip())
            except (TypeError, ValueError):
                continue
            if now <= 0 or prev <= 0:
                continue
            # An agency in both files would be double-filed; measured
            # 2026-09-24 there is no overlap, and first-wins keeps it that way
            # rather than letting the second silently replace the first.
            rows.setdefault(name, (int(round(now)), int(round(prev))))
    return rows, asof, 'fte'



# ── Northern Territory ──────────────────────────────────────────────────────
NT_INDEX = 'https://ocpe.nt.gov.au/workforce-planning/staffing-numbers'
NT_WARM = 'https://ocpe.nt.gov.au/'


def _nt_rows(page):
    """Agency -> (newest quarter, the same quarter a year earlier), one page.

    THE CURRENT LAYOUT IS NOT THE ONE THE ARCHIVE SHOWS. A 2018 edition of this
    report carries five quarterly columns — June, September, December, March,
    June — and reading one of those is what the first two versions of this
    function were written against. The June 2026 edition carries THREE value
    columns and two change columns, measured off the page:

        2025@299   2025@349   2026@389   change@491
        Attorney General's Department  603@302  591@345  594@394   3@455  -9@502

    So the columns are found by x-position against a measured boundary rather
    than by counting: every figure sits left of about x=430 and every change
    sits right of it. The first value column and the last are a year apart —
    June 2025 and June 2026 — which is what makes a year-on-year possible from
    one document, and is the only property of the old layout that survived.

    THE THOUSANDS SEPARATOR IS A SPACE and cannot be undone by looking at the
    text: "1 512" is one number and "619 620" is two, and both are a short
    group followed by a group of three. Position separates them, because the
    halves of "1 512" sit inside one column. Words closer than four points are
    the same number.

    A LINE WITHOUT A NAME IS NOT A ROW. Several numeric lines carry no agency
    at all — sub-totals and wrapped continuations — and taking them produced
    three rows out of twenty-five, each attached to whatever name happened to
    lead. A row needs its own name.
    """
    CHANGE_COL_X = 430        # measured: values <= 430, change columns beyond
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)

    # CLUSTER A ROW BY PROXIMITY, NOT BY A BUCKET. Rounding `top` into fixed
    # bins splits a row whenever it straddles a boundary, and a name sitting a
    # point above its own figures lands in the bin above them. That is what
    # produced numeric lines with no agency on them: the figures were orphaned
    # from the name they belong to, and both halves were then discarded. The
    # dump made it visible — "37@307 37@350 34@400" with no name, directly
    # above a line that was nothing but a name.
    rows_by_top = []
    for w in sorted(words, key=lambda w: w['top']):
        if rows_by_top and abs(w['top'] - rows_by_top[-1][0]) <= 4:
            rows_by_top[-1][1].append(w)
        else:
            rows_by_top.append((w['top'], [w]))
    out = {}
    for _, ws in rows_by_top:
        ws.sort(key=lambda w: w['x0'])
        name_parts, cols, cur, last_x1 = [], [], [], None
        for w in ws:
            t, x = w['text'], w['x0']
            if not re.fullmatch(r'[\d,]+', t):
                if not cols and not cur and x < CHANGE_COL_X:
                    name_parts.append(t)
                continue
            if x >= CHANGE_COL_X:          # a change column, not a figure
                continue
            if cur and last_x1 is not None and x - last_x1 > 4:
                cols.append(''.join(cur))
                cur = []
            cur.append(t.replace(',', ''))
            last_x1 = w['x1']
        if cur:
            cols.append(''.join(cur))
        name = ' '.join(name_parts).strip(' ^*.')
        vals = [int(c) for c in cols if c.isdigit()]
        # A name of one short word is a header fragment, not a department.
        if len(name) < 6 or len(vals) < 2 or not re.search(r'[A-Za-z]{3}', name):
            continue
        now, prev = vals[-1], vals[0]
        if now > 0 and prev > 0:
            out[name] = (now, prev)
    return out


def load_nt():
    """NT Office of the Commissioner for Public Employment — quarterly FTE.

    THE NT WAS RECORDED AS HAVING NO SOURCE. It has published quarterly
    staffing numbers since 2013, at /workforce-planning/staffing-numbers.

    Finding it took six rounds and the lesson is worth more than the data:
    ocpe.nt.gov.au answers a plain request with a Cloudflare challenge, and
    round one had a real browser sit on it for thirty seconds without clearing,
    which read as a host that could not be entered. It can — the challenge is
    intermittent, and warming the origin once per browser context clears it.
    Then every deep path I invented 404'd, five of them, until the host was
    simply asked for its own sitemap: 520 URLs, and the answer was in it. ASK
    FOR THE SITEMAP FIRST.

    ONE DOCUMENT HOLDS THE WHOLE COMPARISON, which is unusually kind. Each
    quarterly PDF carries five quarters — June, September, December, March,
    June — so the first and last columns are the same quarter a year apart and
    no second fetch is needed. That also removes the risk the WGEA generator
    hit, where two documents could be built on different bases.

    IT IS FTE: the page says "Measured as Full Time Equivalent" in its header.
    """
    import io as _io
    import pdfplumber

    page = fetch(NT_INDEX, via_browser=True, warm=NT_WARM, render=True)
    pdfs = re.findall(r'href="([^"]+\.pdf)"', page, re.I)
    pdfs = [u for u in pdfs if re.search(r'staffing|quarter|fte', u, re.I)]
    pdfs = [u if u.startswith('http') else 'https://ocpe.nt.gov.au' + u for u in pdfs]
    if not pdfs:
        raise RuntimeError('NT: no quarterly staffing PDFs linked on ' + NT_INDEX)

    # NEWEST BY THE DATE IN THE FILENAME, never by the URL. The files live
    # under /__data/assets/pdf_file/<dir>/<id>/ and those numbers do not sort
    # chronologically; the probe read a 2018 edition while reporting it had
    # taken the newest, for exactly this reason.
    MONTH = {m: i for i, m in enumerate(
        ['january', 'february', 'march', 'april', 'may', 'june', 'july',
         'august', 'september', 'october', 'november', 'december'], 1)}

    def when(u):
        name = u.rsplit('/', 1)[-1].lower()
        y = re.search(r'(20\d\d)', name)
        mth = next((v for k, v in MONTH.items() if k in name), 0)
        return (int(y.group(1)) if y else 0, mth)

    newest = max(pdfs, key=when)
    year, month = when(newest)
    if year < 2024:
        raise RuntimeError(f'NT: newest staffing PDF looks stale ({newest})')

    blob = fetch(newest, binary=True, via_browser=True, warm=NT_WARM)
    rows = {}
    with pdfplumber.open(_io.BytesIO(blob)) as pdf:
        for pg in pdf.pages:
            rows.update(_nt_rows(pg))
        # A THIN RESULT IS A FAILURE TOO, and the first version only reported
        # an empty one. Three rows came back from a table of about twenty-five
        # and nothing said so: the run looked like a success and filed three
        # agencies. The Territory has more departments than that, so anything
        # under fifteen is treated as a broken parse rather than a small
        # government.
        if len(rows) < 15:
            print(f'  NT: only {len(rows)} rows parsed — dumping geometry',
                  file=sys.stderr)
            pg = pdf.pages[0]
            ws = pg.extract_words(keep_blank_chars=False)
            byline = {}
            for w in ws:
                byline.setdefault(round(w['top'] / 3), []).append(w)
            shown = 0
            for _, lw in sorted(byline.items()):
                lw.sort(key=lambda w: w['x0'])
                if not any(re.fullmatch(r'[\d,]+', w['text']) for w in lw):
                    continue
                gaps = [f"{w['text']}@{w['x0']:.0f}" for w in lw[:14]]
                print(f'    NT words | {" ".join(gaps)}', file=sys.stderr)
                shown += 1
                if shown >= 8:
                    break
            raise RuntimeError(f'NT: parsed {len(rows)} agency rows from {newest}')
    asof = f'{list(MONTH)[month - 1][:3].title()} {year}' if month else str(year)
    return rows, asof, 'fte'


# ── Tasmania ────────────────────────────────────────────────────────────────
TAS_SEARCH = 'https://www.dpac.tas.gov.au/search?query=workforce+report'
TAS_SITEMAP = 'https://www.dpac.tas.gov.au/sitemap.xml'
TAS_WARM = 'https://www.dpac.tas.gov.au/'


def load_tas():
    """Tasmanian State Service Workforce Report — paid headcount by agency.

    TASMANIA WAS RECORDED AS "the State Service domain no longer resolves".
    dpac.tas.gov.au resolves, answers a warmed browser with 200, and publishes
    this report twice a year. The claim was wrong in all three parts.

    The agency table is "Employees by Agency and Employment Category", headed
    "Paid Headcount as at <date>", with columns Fixed-term, Permanent, Part 6
    and Total. It is a HEAD COUNT, unlike the NT's FTE, and is marked so. The
    page also carries an FTE table over the same agencies, which is why the
    two are separated by whether their totals are integers.

    AN EDITION'S NUMBER IS NOT ITS DATE, and reading it as one was a live bug.
    Reports are numbered within the year they are PUBLISHED: No. 2 of a year is
    that year's June half, but No. 1 is the DECEMBER HALF OF THE YEAR BEFORE.
    Measured 2026-09-25 across every reachable No. 1 — Number-1-2023 states
    "as at 31 December 2022" and Number-1-2022 states "as at 30 December 2021"
    — so deriving December-of-the-file's-year dated seven live cards a year
    later than the reading they showed. The date is now read off the document's
    own heading and nothing is derived from the file name.

    TWO EDITIONS ARE FETCHED WHERE A PRIOR EXISTS, never across the halves: a
    No. 1 against a No. 2 is six months wearing a year's label, and `span` only
    means anything if a change is reported over the period it was measured. But
    a missing prior is NOT a reason to fall back to an older pair that has one.
    That rule alone had Tasmania filing December 2022 while a June 2024 edition
    sat unread. `prev` is optional and `yoy` is None without it.
    """
    import io as _io
    import pdfplumber

    # BOTH LISTS, NEITHER TRUSTED ALONE. This used to stop as soon as the
    # sitemap had four hits, on the reasoning that the sitemap is the site's
    # own list and the search page "shows what it feels like showing".
    # Measured 2026-09-25 on the runner, the sitemap returned ZERO report
    # links and the search page returned all four — so the preference was
    # backwards that day, and an early break on either one is a coin toss.
    # Merge them and let the edition list be as long as the site allows.
    found = []
    for src in (TAS_SITEMAP, TAS_SEARCH):
        try:
            page = fetch(src, via_browser=True, warm=TAS_WARM)
        except Exception:
            continue
        hits = re.findall(r'(?:href="|<loc>\s*)([^"<\s]*State-Service-Workforce-Report[^"<\s]*\.pdf)',
                          page, re.I)
        found += [u if u.startswith('http') else 'https://www.dpac.tas.gov.au' + u for u in hits]
    editions = {}
    for u in dict.fromkeys(found):
        m = re.search(r'Number-(\d+)-(\d{4})', u, re.I)
        if m:
            editions.setdefault((int(m.group(2)), int(m.group(1))), u)
    if not editions:
        raise RuntimeError('TAS: no State Service Workforce Report editions found '
                           'on the sitemap or the search page')

    # THE NEWEST EDITION, WITH A PRIOR IF ONE EXISTS — not the newest edition
    # that HAS a prior. That distinction was costing four years.
    #
    # Only four editions are reachable (Number 1 of 2021, 2022 and 2023, and
    # Number 2 of 2024), and a pair must share a report number: No. 1 is the
    # December half and No. 2 the June half, so pairing across them is six
    # months wearing a year's label. Requiring a pair therefore rejected the
    # June 2024 edition — the only No. 2 there is — and fell back to No. 1 of
    # 2023, which carries DECEMBER 2022. Measured 2026-09-25: the cards were
    # filing data three and a half years old in order to carry a YoY.
    #
    # A missing prior is not a reason to file older data. `prev` is optional
    # and `yoy` is None where there is nothing to compare against — the same
    # shape Western Australia's bulletin needed — so the newest edition is
    # used either way and the comparison is simply absent when it cannot be
    # made honestly.
    now_key = sorted(editions, reverse=True)[0]
    prev_key = (now_key[0] - 1, now_key[1])
    if prev_key not in editions:
        prev_key = None

    MONTHS = {'january': 'Jan', 'february': 'Feb', 'march': 'Mar', 'april': 'Apr',
              'may': 'May', 'june': 'Jun', 'july': 'Jul', 'august': 'Aug',
              'september': 'Sep', 'october': 'Oct', 'november': 'Nov',
              'december': 'Dec'}

    def agencies(url):
        """-> ({agency: paid headcount}, 'Mon YYYY' the report states)."""
        blob = fetch(url, binary=True, via_browser=True, warm=TAS_WARM)
        out, asof = {}, None
        with pdfplumber.open(_io.BytesIO(blob)) as pdf:
            for pg in pdf.pages:
                txt = pg.extract_text() or ''
                if 'Employees by Agency' not in txt:
                    continue

                # THE DATE IS READ OFF THE DOCUMENT, NOT OFF THE FILE NAME,
                # and that is a correction rather than a tidy-up. The old code
                # derived it from the edition number — No. 2 meant June of the
                # file's year, anything else meant December of it — and the
                # second half of that is wrong. Measured 2026-09-25 across all
                # three reachable No. 1 editions, each carries the PREVIOUS
                # December: Number-1-2023 says "as at 31 December 2022" and
                # Number-1-2022 says "as at 30 December 2021". So seven live
                # Tasmanian cards were dated a year later than the reading they
                # showed. A report published in a year is not a report about it.
                m = re.search(r'Paid Headcount as at\s+\d{1,2}\s+([A-Za-z]+)\s+(\d{4})', txt)
                if m and m.group(1).lower() in MONTHS:
                    asof = f'{MONTHS[m.group(1).lower()]} {m.group(2)}'

                # extract_tables(), NOT a regex over extract_text(). The line
                # form loses exactly the rows that matter: a long agency name
                # WRAPS, and the regex then reads "Department of Natural
                # Resources and Environment" where the previous edition says
                # "...and Environment Tasmania" — a different key, so the
                # agency silently drops out of the year-on-year join. A cell
                # of "-" (the Public Trustee's Part 6, Dec 2021) kills a row
                # the same way. The table form keeps the wrapped name whole,
                # as "...Environment\nTasmania", and is why this reads
                # seventeen agencies where the regex read thirteen.
                #
                # PLURAL, because the page carries a head-count table AND an
                # FTE table over the same agencies. They are told apart by
                # their values — a head count is an integer, an FTE is not —
                # rather than by position, since reading the wrong one would
                # put one quantity under the other's label. That is the exact
                # bug two NSW cards carried.
                for tab in pg.extract_tables():
                    rows = [[c for c in r if c not in (None, '')] for r in tab]
                    body = [r for r in rows if len(r) == 5 and r[0] != 'Agency']
                    if not body or any('.' in r[4] for r in body):
                        continue                      # header-only, or the FTE table
                    for r in body:
                        name = ' '.join(r[0].split())
                        nums = []
                        for cell in r[1:]:
                            cell = cell.strip()
                            nums.append(0 if cell == '-' else
                                        int(cell.replace(',', '')) if
                                        re.fullmatch(r'[\d,]+', cell) else None)
                        if None in nums or nums[3] <= 0:
                            continue
                        # The row states its own total, so it can check itself.
                        if sum(nums[:3]) != nums[3]:
                            continue
                        out[name] = nums[3]

        # THE REPORT STATES ITS OWN TOTAL, SO THE PARSE CAN CHECK ITSELF.
        # Under 95% warns and under half raises: every row returned is sound —
        # each one's four columns reconcile — so failing would throw away good
        # cards to protest missing ones, which are blank either way. Below half
        # the shape has moved rather than drifted. This is the Northern
        # Territory's "under fifteen rows is a failure" lesson in the stronger
        # form this report allows: the document says what it should sum to.
        total = out.pop('Total', None)
        if total:
            got = sum(out.values())
            if got < total * 0.5:
                raise RuntimeError(f'TAS: parsed {got:,} of a stated {total:,} '
                                   f'({got / total:.0%}) — the table shape has moved')
            if got < total * 0.95:
                print(f'  Tasmania: INCOMPLETE — {len(out)} agencies summing to {got:,} '
                      f'against the report\'s own Total of {total:,} ({got / total:.0%}). '
                      f'{total - got:,} employees are in agencies this parse does not '
                      f'reach; their cards stay blank.', file=sys.stderr)
        if not asof:
            raise RuntimeError(f'TAS: no "Paid Headcount as at <date>" heading in {url} '
                               f'— the report has been restyled and the date it '
                               f'carries can no longer be read off it')
        return out, asof

    now_rows, asof = agencies(editions[now_key])
    if not now_rows:
        raise RuntimeError(f'TAS: parsed no agency rows from {editions[now_key]}')
    prev_rows = {}
    if prev_key:
        prev_rows, prev_asof = agencies(editions[prev_key])
        if prev_asof == asof:
            raise RuntimeError(f'TAS: {now_key} and {prev_key} both state {asof} — '
                               f'they are the same reading, not a year apart')

    # A RENAME IS NOT A CHANGE, AND TASMANIA RENAMES. Between the December 2021
    # and December 2022 reports, Education became "Department for Education,
    # Children and Young People", Communities Tasmania disappeared, Homes
    # Tasmania appeared and TasTAFE left the State Service. The old join
    # required a prior reading under the SAME NAME and dropped everything else,
    # so the largest agency after Health was filed as absent.
    #
    # Keep the row, and leave `prev` unset where no prior reading exists under
    # that name. An invented comparison across a machinery-of-government change
    # would be worse than no comparison: the WGEA parser refuses one for the
    # same reason where a corporate group gains or loses a member.
    rows = {k: (v, prev_rows.get(k) or None) for k, v in now_rows.items()}
    return rows, asof, 'headcount'



# key -> (label, loader, span in years). The loader returns (rows, asof, unit);
# `unit` is "headcount" everywhere but Queensland, which publishes only FTE.
def load_healthnz():
    """Health New Zealand — employed headcount by District.

    HEALTH NZ IS NOT IN THE PUBLIC SERVICE COMMISSION DATA, and could never
    have been: it is a Crown entity, and its DISTRICTS are operational units
    inside it rather than public-service departments, so no PSC workforce row
    names one under any spelling. load_nz() closing 26 NZ agencies therefore
    said nothing about these five, and reading their absence there as "no
    source" would have been the same mistake this file has already made about
    three whole jurisdictions.

    THE SECOND HALF OF WHY THEY WERE NEVER FILED IS IN main(), NOT HERE. The
    roster query asked for `sector === "Government"` and these five carry
    sector "Healthcare", so the generator never considered them at all — no
    unmatched-roster line, no spare source row, nothing. A source that is
    never asked about looks exactly like a source that has no answer.

    THE HOST MOVED AND THE OLD ONE LIES ABOUT IT. tewhatuora.govt.nz 301s to
    healthnz.govt.nz on the apex, but its content tree answers 200 to ANY path
    with the homepage — /robots.txt, /sitemap.xml and /sitemap.xml.gz all
    return the same 676 KB of HTML. So a sitemap fetch there succeeds, parses
    to zero <loc> entries, and reads as a site with no sitemap rather than as
    the wrong host. healthnz.govt.nz/robots.txt is 706 bytes of text/plain and
    names the real sitemap, which is an index of five children over 4,479 URLs.

    A PLAIN curl IS REFUSED AND THAT IS ABOUT THE USER-AGENT, NOT A WAF. The
    first request here came back as a CloudFront "Request blocked" 403 and was
    briefly written down as an AWS WAF block of the same family as the NT's
    Cloudflare challenge. It is not: the identical URL answers 200 to urllib
    with a browser User-Agent, no cookie, no warming and no browser. Worth
    keeping straight, because the remedy for the two is completely different
    and the expensive one was nearly reached for first.

    THE FIGURE IS THE `Employed` COLUMN OF TABLE 1, which is the report's own
    headline: page 7 says "Total employees 92,356" and that is what Employed
    sums to. The `Total` column adds 8,305 "Others" — staff on parental leave
    and those with no employment-status code — whom the report itself excludes
    from every other table. It is a HEAD COUNT of distinct employees, not FTE,
    unlike New Zealand's PSC data and Queensland's, so it is marked as one.

    THE PAIR IS Q3 AGAINST Q3, both snapshots at 31 March. The quarters are
    the natural unit here and comparing Q3 to the previous Q4 would measure
    nine months of a cycle as if it were a year — the same error load_nz()
    avoids by refusing the March column and pairing June to June.

    Both editions must carry National Payrolls: the report says its totals are
    "not directly comparable to those in the previous District Quarterly
    reports, as data from Non-District agencies has been incorporated since
    September 2024". Q3 2024/25 is March 2025 and so is safely after that, but
    the check is asserted rather than assumed, because an earlier edition
    silently lacking the row would understate the prior year and print growth
    that is really a change of scope.
    """
    import pdfplumber

    ROW = re.compile(r"^([A-Za-z][A-Za-z&'\u2019 \-]*?)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)%$")

    def quarterly(page_url):
        """The newest Q3 PDF linked from one publications page."""
        html = fetch(page_url)
        pdfs = re.findall(r'href="([^"]+\.pdf)(?:\?[^"]*)?"', html, re.I)
        q3 = [u for u in pdfs if re.search(r'q(uarter)?[-_ ]?(3|three)', u, re.I)]
        if not q3:
            raise RuntimeError(f'no quarter-three PDF linked from {page_url}')
        return q3[0]

    def table1(pdf_url):
        """Table 1 rows as {district: employed}, chosen by row count.

        THE PAGE IS FOUND BY WHICH ONE PARSES, not by its heading. Matching on
        "Distribution of employment types" lands on the contents page, which
        carries the heading and no data, and the first version of this did
        exactly that and reported zero rows for both years.
        """
        import io as _io
        body = fetch(pdf_url, binary=True)
        best, page_no = {}, None
        with pdfplumber.open(_io.BytesIO(body)) as pdf:
            for pg in pdf.pages:
                rows = {}
                for line in (pg.extract_text() or '').split('\n'):
                    m = ROW.match(line.strip())
                    if m:
                        rows[m.group(1).strip()] = int(m.group(2).replace(',', ''))
                if len(rows) > len(best):
                    best, page_no = rows, pg.page_number
        # UNDER FIFTEEN ROWS IS A FAILURE, NOT A SMALL TABLE. There are 21
        # districts plus a Total; the Northern Territory taught this the
        # expensive way, parsing 3 rows of 25 and reporting it as a success.
        if len(best) < 15:
            raise RuntimeError(f'{pdf_url}: only {len(best)} rows parsed (page {page_no})')
        if 'National Payrolls' not in best:
            raise RuntimeError(f'{pdf_url}: no National Payrolls row — pre-Sept-2024 scope')
        best.pop('Total', None)
        return best

    now = table1(quarterly(
        'https://www.healthnz.govt.nz/publications/employed-workforce-quarterly-reports-2025-26'))
    prev = table1(quarterly(
        'https://www.healthnz.govt.nz/publications/employed-workforce-quarterly-reports-2024-25'))

    rows = {}
    for d, v in now.items():
        if d in prev:
            rows[d] = (v, prev[d])
    return rows, '31 March 2026', 'headcount'


# ── NSW agencies, one annual report at a time ────────────────────────────────
#
# WHY THIS IS NOT ONE LOADER. NSW's Workforce Profile stops at PORTFOLIO — the
# note in NOT_IN_SOURCE_JURISDICTION records all four sources probed and what
# each carries — so the only place a NSW agency's own number exists is its own
# annual report. Sixty-three cards therefore need sixty-three documents, and
# twelve agencies carry 82% of the route's live ads.
#
# EACH REPORT IS REGISTERED AS ITS OWN SOURCE, which is not a workaround but
# the honest shape: a loader returns one `asof` and one `unit`, and these
# agencies genuinely disagree about both. NESA and Customer Service publish
# FTE; Climate Change, Communities and Justice and Primary Industries publish a
# head count. DCJ's newest report is 2023-24 while the rest are 2024-25. Forcing
# them into one loader would mean one date and one unit over five documents that
# share neither, which is the NSW-Health mislabel waiting to happen again.
#
# NOTHING HERE IS A TYPED-IN FIGURE. Every run re-reads the document and every
# spec carries the reconciliation that proves the parse: the component rows are
# summed and must equal the Total row the report prints for itself, column by
# column, and a date string must be found on the page or the load fails. A
# report that gets restyled breaks loudly instead of going stale quietly.
NSW_AGENCY_REPORTS = {
    # 184 live ads, the largest single card in the NSW route.
    # p55 "Table 5 Number of FTE officers and employees by gender": the Totals
    # row is eight numbers, 2023-24 then 2024-25, each F/M/X/Total. The prose
    # above it says "As at 30 June 2025, the overall number of staff was 733
    # full-time equivalent (FTE) positions", which is the Total it reconciles to.
    'nsw-nesa': dict(
        label='NSW: Education Standards Authority',
        agency='NSW Education Standards Authority',
        agency_id='nsw-gov-nsw-education-standards-authority',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-11/'
            'nesa-annual-report-2024-2025.pdf',
        needle='Number of FTE officers and employees',
        total=r'^Totals\b',
        ncols=8, now_i=7, prev_i=3, sums=[(0, 1, 2, 3), (4, 5, 6, 7)],
        proof=r'As at 30 June 2025',
        unit='fte', asof='Jun 2025'),
    # 128 live ads. p73 "Table 1: Number of DCJ employees by employment
    # category by year", three years 2021-22 / 2022-23 / 2023-24. Its own prose:
    # "As of 20 June 2024, the department had 25,643 ... staff". 2024-25 is not
    # published yet, so this card is correctly a year behind the others.
    'nsw-dcj': dict(
        label='NSW: Communities and Justice',
        agency='Department of Communities and Justice',
        agency_id='nsw-gov-department-of-communities-and-justice',
        url='https://www.dcj.nsw.gov.au/content/dam/dcj/dcj-website/documents/'
            'resource-centre/annual-reports/dcj-2023-24-annual-report-volume-1.pdf',
        needle='Number of DCJ employees by employment category',
        total=r'^Total\b',
        comp=r'^(?:Ongoing|Temporary|Senior Executives|Casual|Others)\b\d*',
        ncols=3, now_i=2, prev_i=1,
        proof=r'As of 20 June\s+2024',
        unit='headcount', asof='Jun 2024'),
    # 52 live ads. p71 "Division Full Time Equivalent (FTE) over time", four
    # census columns whose dates the notes give as 23 Jun 2022, 22 Jun 2023,
    # 20 Jun 2024 and 19 Jun 2025.
    #
    # NO COMPONENT SUM IS POSSIBLE HERE and that is a property of the table, not
    # a shortcut: divisions come and go, so most rows carry two or three numbers
    # against four columns and which years they land in cannot be read off the
    # line. The header row is asserted instead, because the risk this check
    # exists to catch is taking the wrong COLUMN, and a header that still reads
    # "2022 2023 2024 2025" is what rules that out.
    'nsw-dcs': dict(
        label='NSW: Customer Service',
        agency='Department of Customer Service',
        agency_id='nsw-gov-department-of-customer-service',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-12/'
            'department-of-customer-service-annual-report-2024-2025.pdf',
        needle='Full Time Equivalent (FTE) over time',
        total=r'^Total\d*',
        ncols=4, now_i=3, prev_i=2,
        proof=r'2022\s*1?\s*2023\s*1?\s*2024\s*1?\s*2025',
        unit='fte', asof='Jun 2025'),
    # 30 live ads. p83 "Table 7 Number of employees and officers in head count
    # and full time equivalent (FTE)": head count 2023-24, head count 2024-25,
    # FTE 2024-25. THE HEAD COUNT COLUMNS ARE TAKEN, not the FTE one — it is the
    # only quantity the report gives for both years, so it is the only one a
    # year-on-year can be built from without comparing two different measures.
    'nsw-dcceew': dict(
        label='NSW: Climate Change, Energy, the Environment and Water',
        agency='Department of Climate Change, Energy, the Environment and Water',
        agency_id='nsw-gov-department-of-climate-change-energy-the-environment-and-water',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-11/'
            'dcceew-annual-report-2024-25-volume-1-250362.pdf',
        needle='Number of employees and officers in head count',
        total=r'^Total\b',
        comp=r'^(?:Ongoing|Temporary|Casual|Executive)\*?\s',
        ncols=3, now_i=1, prev_i=0, sums=[(0,), (1,)],
        proof=r'19 June 2025',
        unit='headcount', asof='Jun 2025'),
    # 39 on the archived+live ranking. p88 "Table 4: Number of employees by
    # employment category by year", three years, and its own prose above it says
    # "As at 30 June 2025, RA employed 488 ongoing and temporary employees".
    # Every column reconciles: 240, 361, 488.
    'nsw-ra': dict(
        label='NSW: Reconstruction Authority',
        agency='NSW Reconstruction Authority',
        agency_id='nsw-gov-nsw-reconstruction-authority',
        url='https://www.nsw.gov.au/sites/default/files/2026-01/'
            'nsw-reconstruction-authority-annual-report-2024-25.pdf',
        needle='Number of employees by employment category by year',
        total=r'^Total\b',
        comp=r'^(?:Ongoing|Temporary|Senior Executives|Casual|Others)\b',
        ncols=3, now_i=2, prev_i=1, sums=[(0,), (1,), (2,)],
        proof=r'As at 30 June 2025',
        unit='headcount', asof='Jun 2025'),
    # 44 on the ranking. p55 "Table 6. Number of full-time equivalent staff
    # employed" — NINE year columns, 2017 to 2025, and a SINGLE data row. So
    # there is nothing to reconcile against, and the header is asserted instead:
    # the table is rejected unless its header still ends "June 2024 June 2025",
    # which is the only thing that proves which column is being read. Excludes
    # casual staff, per its own Note 2.
    'nsw-lls': dict(
        label='NSW: Local Land Services',
        agency='Local Land Services',
        agency_id='nsw-gov-local-land-services',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-12/'
            'local-land-services-annual-report-2024-25.pdf',
        needle='Number of full-time equivalent staff employed',
        total=r'^Number of full-time equivalent staff',
        ncols=9, now_i=8, prev_i=7,
        header=r'Year ending.*June 2024 June 2025',
        proof=r'Workforce Profile Report 2025',
        unit='fte', asof='Jun 2025'),
    # 23 live ads but by far the largest workforce here — this is the department
    # that operates every NSW public school, so its own figure includes teachers.
    #
    # p26 PRINTS TWO FOUR-COLUMN TABLES SIDE BY SIDE: "Full-time equivalent
    # staff, 2022 to 2025" totalling 107,979 and "Staff active headcount, 2022
    # to 2025" totalling 136,841. Taking whichever pdfplumber returned first
    # would file one as the other and nothing would notice. Only the FTE table
    # reconciles — the head count deliberately does not, because somebody
    # counted as both a teacher and support staff appears once in the total and
    # twice above it — so requiring ALL FOUR columns to sum is what chooses it.
    # extract_text() is no help at all here: the two tables interleave into
    # "Total 228 2 162 224 1 156 Total 102,631 107,108 107,949 107,979".
    'nsw-doe': dict(
        label='NSW: Department of Education',
        agency='Department of Education',
        agency_id='nsw-gov-department-of-education',
        url='https://education.nsw.gov.au/content/dam/main-education/en/home/'
            'about-us/strategies-and-reports/annual-reports/DoE_Annual_Report_2024-25.pdf',
        needle='Full-time equivalent staff',
        total=r'^Total\b',
        comp=r'^(?:Teachers|Educational support|Corporate and educational support)',
        ncols=4, now_i=3, prev_i=2, sums=[(0,), (1,), (2,), (3,)], tol=1.5,
        proof=r'as at 30 June each year',
        unit='fte', asof='Jun 2025'),
    # 25 live ads. p62 "Table 27 Number of officers and employees by category
    # 2024-25", two columns.
    #
    # NO PRIOR YEAR, DELIBERATELY. The 2024 column is DRNSW — the Department of
    # Regional NSW — and the 2025 column is DPIRD, which absorbed Primary
    # Industries. They are not the same department, so the change between them
    # is a machinery-of-government event rather than hiring, and `prev` is left
    # unset exactly as it is for Tasmania's renamed agencies.
    # 52 on the archived+live ranking, and the largest NSW card whose report the
    # last pass could not find: it is not on nsw.gov.au and not on the Parliament
    # tabled-papers host (Cloudflare challenge, see the note below), but icare
    # publishes it itself through Sitecore's CDN.
    #
    # p69 "Headcount ... with a breakdown by classification of employment,
    # compared to the previous year": Category | 30 June 25 | 30 June 2024, and
    # Total 1,850 / 1,879.
    #
    # THE REPORT CONTRADICTS ITSELF ON THE PRIOR YEAR AND THE COMPONENTS SETTLE
    # IT. p82's work-health-and-safety table gives "Number of employees (by
    # headcount) 1,850 1,979" — a hundred above p69 for FY24, agreeing on FY25.
    # p69's own rows sum to 1,879 exactly (1 + 8 + 59 + 1,811), so p69 is the
    # table and p82 has a transposed digit. Reconciliation as a DISCRIMINATOR
    # again, which is the same job it does for Education's two side-by-side
    # tables — except that here the losing number is not another measure of the
    # workforce, it is simply wrong.
    #
    # `tol` IS FOR THE CURRENT COLUMN, NOT THE PRIOR ONE. The 2025 rows sum to
    # 1,851 against a stated 1,850, and the table says why in its own footnote:
    # "One general manager contingent worker captured in this table". So the
    # off-by-one is a real property of the document, as Education's is, and the
    # tolerance is sized to admit exactly that and nothing wider — p82's
    # hundred-person disagreement is still rejected by a mile.
    'nsw-icare': dict(
        label='NSW: icare',
        agency='icare NSW',
        agency_id='nsw-gov-icare-nsw',
        url='https://edge.sitecorecloud.io/insuranceanf0c2-xmcprodf24d-xmprod74a5-5eb4/'
            'media/icare/unique-media/about-us/annual-report/media-files/files/'
            'download-module/icare-annual-report-2024-25.pdf',
        needle='This table shows the number of employees in headcount',
        total=r'^Total\b',
        comp=r'^(?:Chief Executive|Group Executive Team|Executives|Non-executives)',
        ncols=2, now_i=0, prev_i=1, sums=[(0,), (1,)], tol=1.5,
        proof=r'30 June 25\s+30 June 2024',
        unit='headcount', asof='Jun 2025'),
    # 37 on the archived+live ranking, and it WAS on nsw.gov.au all along — the
    # last pass looked for it under the Premier's Department route and recorded
    # "no workforce table" for that department, which is true of that document
    # and says nothing about this one. Treasury's own library page lists twenty
    # years of reports; only the newest is under a 2025-12 path.
    #
    # p96 "Table 4: Full-time equivalent (FTEs) per group", columns 2022-23 /
    # 2023-24 / 2024-25, total row "FTE 1,256.1 782.8 786.9". The prose above it
    # states the reading outright: "On 19 June 2025 NSW Treasury had 786.9
    # full-time equivalent (FTE) staff. This equates to a headcount of 829
    # staff." The FTE is taken rather than the 829 because only the FTE has a
    # prior year on the same basis.
    #
    # NO COMPONENT SUM, FOR THE SAME REASON AS CUSTOMER SERVICE. Half the group
    # rows carry N/A in one or two columns — EnergyCo and Energy, Climate Change
    # and Sustainability left Treasury, Procurement Reform and Banking was
    # created in August 2024 — so a row's numbers cannot be mapped to columns by
    # position, and summing only the rows that do carry three gives 639.2
    # against 786.9. The table says so itself: "Due to internal structural
    # changes to Treasury Groups, divisional FTE comparisons cannot be
    # accurately mapped." The header is asserted instead, which is what rules
    # out reading the wrong COLUMN — the risk the sum was there to catch.
    #
    # 2022-23 IS DELIBERATELY NOT THE COMPARATOR. 1,256.1 -> 782.8 is EnergyCo
    # and the energy group leaving, not 473 people going; taking the two newest
    # columns keeps the comparison inside one Treasury.
    # 844 on the archived+live ranking — THE LARGEST CARD IN THE NSW ROUTE, and
    # this file recorded it as having no current annual report. That was wrong,
    # and the way it was wrong is the lesson: the last pass searched
    # transport.nsw.gov.au's SITEMAP, all 14,375 URLs of it, and concluded the
    # report does not exist. A sitemap lists PAGES. This report is a file under
    # /system/files/media/documents/2025/ and is not in the sitemap at all —
    # neither is Sydney Trains', which is beside it. "Absent from the sitemap"
    # is evidence about the sitemap.
    #
    # The host also 403s a plain fetch and reads fine through a warmed browser,
    # so the earlier probe was answered by a WAF on one attempt and by a page
    # index on the other; neither was the document.
    #
    # THE FTE TABLE IS TAKEN AND THE HEAD COUNT IS REFUSED, ON THE FOOTNOTES.
    # p93 prints both. Table 29, "Total employee headcount by salary band", runs
    # 15,273 / 15,531 / 15,607 — and its footnote 1 hangs on the 2024-25 column
    # ONLY: "Excludes cadets (40), casuals (253) and contractors/labour hire."
    # The two earlier columns carry no such marker, so 15,531 -> 15,607 is a
    # +0.5% across a basis change worth at least 293 people and an unstated
    # number of contractors. Its <$50,000 band falling 1,352 -> 77 in one year
    # is that change showing.
    #
    # Table 30, "Total employee FTE by salary band", carries the footnote on BOTH
    # its columns — so 14,437.76 -> 14,506.25 is like for like, and it is the
    # only pair in the document that is. `header` asserts exactly that: both
    # year labels must still carry the footnote digit, so an edition that drops
    # it from one year fails here instead of quietly comparing two bases.
    #
    # THE ROW SUMS ARE THE RECONCILIATION, NOT THE COLUMN SUMS, because
    # pdfplumber glues some salary-band cells together ("34.00 44.00" arrives as
    # one cell, and stripping non-digits from it yields 3444 — a number that
    # never existed). The Total row extracts cleanly, and Female + Male = Total
    # holds in each of its two year groups, which is what proves the columns are
    # where the spec thinks they are.
    'nsw-tfnsw': dict(
        label='NSW: Transport for NSW',
        agency='Transport for NSW',
        agency_id='nsw-gov-transport-for-nsw',
        url='https://www.transport.nsw.gov.au/system/files/media/documents/2025/'
            'transport-for-nsw-annual-report-2024%E2%80%9325-volume-1.pdf',
        warm='https://www.transport.nsw.gov.au/',
        needle='Total employee FTE by salary band',
        total=r'^Total\b',
        ncols=6, now_i=5, prev_i=2, sums=[(0, 1, 2), (3, 4, 5)],
        header=r'Annual salary\s+2023.241\s+2024.251',
        proof=r'Excludes cadets, casuals and contractors/labour hire',
        unit='fte', asof='Jun 2025'),
    # 45 on the archived+live ranking, and on nsw.gov.au all along — linked from
    # the department's "resources" page, which is why the last pass missed it.
    # That pass searched the sitemap, whose only dciths annual-report entries are
    # Liquor & Gaming's and State Records', two other bodies. A sitemap is not an
    # index of files; grepping the listing page is what finds these.
    #
    # p45 PRINTS NO TOTAL ROW AT ALL, which is why this is the first spec with
    # `from_components`. "Employee classification 2024 2025" runs four rows —
    # senior executive 73/71, ongoing 812/858, temporary 86/85, trainee 5/5 —
    # and stops. The 2025 column sums to 1,019, which is exactly the head count
    # the sentence above it states: "As at 19 June 2025, the department had 977.2
    # full-time equivalent (FTE) staff, equating to a headcount of 1,019 staff."
    # So the sum is checked against an independent figure rather than against
    # itself, and 2024 sums to 976 on the same four rows.
    #
    # THE HEAD COUNT IS TAKEN, NOT THE 977.2 FTE, because the FTE has no prior
    # year anywhere in the document while the classification table gives both.
    #
    # DESTINATION NSW IS INSIDE IT AND SAYS SO. p46: its 177.8 FTE / 187
    # headcount "is already included in the department's total workforce figure",
    # because its people are employed by the department — so nothing here double
    # counts, and Destination NSW holds no card of its own. Overseas employees
    # are excluded by the table's own note (22 in 2024, 23 in 2025).
    'nsw-dciths': dict(
        label='NSW: Creative Industries, Tourism, Hospitality and Sport',
        agency='Department of Creative Industries, Tourism, Hospitality and Sport',
        agency_id='nsw-gov-department-of-creative-industries-tourism-hospitality-and-sport',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-11/'
            'dciths-annual-report-2024-2025.pdf',
        needle='Employee classification',
        comp=r'^(?:Public service senior executive|Ongoing employee|'
             r'Temporary employee|Trainee/graduate)\b',
        from_components=True, min_rows=4,
        stated=r'equating to a headcount of\s+([\d,]+) staff',
        ncols=2, now_i=1, prev_i=0,
        proof=r'As at 19 June 2025, the department had',
        unit='headcount', asof='Jun 2025'),
    # 27 on the ranking. ITS OWN HOST LISTS THE FILE AND DOES NOT SERVE IT —
    # tag.nsw.gov.au links this exact path and answers it with HTTP 200 and
    # 185 KB of its own landing page, having redirected to
    # nsw.gov.au/departments-and-agencies/trustee-guardian. The same path on
    # www.nsw.gov.au is 10 MB of application/pdf. A probe that trusted the status
    # code would have recorded this card as read and found no table in a web page.
    #
    # p70 "Table 7: Full-time equivalent staff and headcount at 30 June 2025",
    # four columns — 2024 FTE, 2024 Headcount, 2025 FTE, 2025 Headcount — and a
    # Total row of 680.3 / 720 / 685.18 / 728. The head count columns are taken
    # because both years are there in both measures and a head count is the
    # plainer quantity; either choice is internally consistent here.
    #
    # NO COMPONENT SUM: pdfplumber glues the classification rows ("Temporary
    # employees 39 43" arrives with two of its four numbers), so the header is
    # asserted instead — and with four columns alternating measure and year, the
    # header IS the whole proof of which one was read. Footnote 13 dates it: "This
    # data is current as of 19 June 2025, the end of the last pay period for
    # 2024-25."
    'nsw-tag': dict(
        label='NSW: Trustee and Guardian',
        agency='NSW Trustee and Guardian',
        agency_id='nsw-gov-nsw-trustee-and-guardian',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-12/'
            'nsw-trustee-guardian-annual-report-2024-25.pdf',
        needle='Full-time equivalent staff and headcount',
        total=r'^Total\b',
        ncols=4, now_i=3, prev_i=1,
        header=r'2024 FTE\s+2024 Headcount\s+2025 FTE\s+2025 Headcount',
        proof=r'current as of 19 June 2025',
        unit='headcount', asof='Jun 2025'),
    # 15 on the ranking, and it was nearly recorded as a refusal. A scan for a
    # people-word beside a thousands-scale number found nothing but a senior
    # executive table, and "Service NSW publishes only senior executives" was
    # written down before the contents page turned out to list four workforce
    # tables further in. The filter was the problem, not the document.
    #
    # NOT INSIDE CUSTOMER SERVICE, CHECKED RATHER THAN ASSUMED. Service NSW is an
    # executive agency related to DCS, so the obvious call was to refuse it as
    # already counted there — but the DCS report's own "Division FTE over time"
    # table names its twenty-two divisions and Service NSW is not one of them, so
    # its people are NOT in the 7,651.9 and this card is not a double count.
    #
    # p67 "Table 27: Size of agency (Headcount)", 2023 / 2024 / 2025 plus a
    # published change: non-casual head count 5,213 / 4,868 / 4,036 and -17.1%.
    # The NON-CASUAL row is taken because it is the same basis in all three
    # years, while the plain head-count row above it gives 5,253 for 2023 and
    # then repeats the non-casual figure for 2025 — 4,036 — although Table 11 on
    # p50 counts 37 casuals that year. One of those two rows is wrong about 2025
    # and it is not the one that agrees with everything else.
    #
    # Table 28 repeats 5,213 / 4,868 / 4,036 independently as the denominator of
    # its survey response rate, and Table 11's totals including casuals (5,253 /
    # 4,911 / 4,073) sit exactly 40 / 43 / 37 above them — the casual column in
    # each year. Three tables agreeing is why this pair is safe to compare.
    # 26 on the ranking. THE PROBE READ THE WRONG DOCUMENT FIRST and nothing
    # about it looked wrong: sport.nsw.gov.au lists forty annual reports back to
    # 1997 and hosts its portfolio's as well, so the first 2024-25 match by sort
    # order is CSA-Annual-Report-2024-2025.pdf — the Combat Sports Authority, a
    # fifteen-page document that parses perfectly and is not this agency. The
    # right file is OoS-Annual-Report-2024-25.pdf, named by initialism like its
    # two neighbours, which is why the probe now matches on that too.
    #
    # AN ANNUAL AVERAGE, NOT A CENSUS-DATE COUNT — the only figure here that is.
    # p48 "TABLE 11: Number of full-time equivalent staff in Office of Sport
    # (annual average)": 372 / 404 / 404 / 405 over 2021/22 to 2024/25. Every
    # other NSW card on this route is a head count or FTE at the June census
    # date; this one is averaged across the year, because that is the only
    # workforce figure the report publishes. It includes 36 FTE of casuals.
    #
    # THE PAGE CONTRADICTS ITSELF BY ONE AND THE TABLE WINS. Its prose says "The
    # annual average number of full-time equivalent (FTE) staff across the Office
    # of Sport was 406 in 2024/2025", against the table's 405. Table 12 breaks
    # the same year down by division — 19 + 62 + 263 + 61 — and sums to 405, and
    # prints its own TOTAL row of 372 / 404 / 404 / 405, identical to Table 11.
    # So 405 is corroborated twice and 406 is corroborated by nothing. `stated`
    # is deliberately NOT used here: it would match the prose and refuse the run
    # over the document's own typo.
    #
    # `comp` POINTS AT THE OTHER TABLE ON PURPOSE. Matching Table 12's TOTAL and
    # requiring it to equal Table 11's row is a cross-table agreement check —
    # two independently printed series that must not diverge — which is stronger
    # than anything Table 11 alone can offer. Its division rows cannot be summed
    # directly: pdfplumber puts a wrapped label on its own line, so "Centres,
    # Venues and / 231 255 269 263 / Regions" has its numbers on a line with no
    # label at all.
    # 23 on the ranking, and it was one sentence away from being recorded as
    # "publishes no annual report". The probe greps listing pages for `\.pdf` and
    # found NONE here — not because the reports are absent but because the Opera
    # House serves them from a media CDN with no extension in the path:
    # sydneyoperahouse.api.collaboro.com/media/annual-report-2025 is 8.7 MB of
    # %PDF-1.5. A refusal written from that probe run would have been false, and
    # the probe now looks for the label as well as the extension.
    #
    # p94 "Five-year comparison of staff as at 30 June 2025", columns FY25 FY24
    # FY23 FY22 FY21 — NEWEST FIRST, which no other report on this route does, so
    # now_i is 0 and the header assertion is what proves it. A spec that assumed
    # the usual oldest-first order would file FY21's 499.77 as this year's figure
    # and look perfectly reasonable doing it.
    #
    # THE FTE IS TAKEN AND NO HEAD COUNT IS DERIVED, because the document's two
    # accounts of its head count disagree. Its prose says "headcount increased by
    # 10 (one per cent) to 1052 in FY25", which puts FY24 at 1,042 — while the
    # table's own permanent + non-permanent rows give 574 + 478 = 1,052 for FY25
    # and 559 + 480 = 1,039 for FY24, a rise of 13. The FY25 figure is solid
    # either way (574 ongoing + 98 temporary + 380 casuals = 1,052 exactly) but
    # its comparator is not, and a change of 10 against a change of 13 is the
    # NSW Police lesson again. The total-FTE row is printed for both years and
    # needs no arithmetic at all: 669.56 against 667.64.
    #
    # ONE ROUNDING NOTE, recorded because it looks like a parse fault and is not.
    # FY25's components sum exactly (513.88 + 155.68 = 669.56) and FY24's do not
    # (499.94 + 167.99 = 667.93 against a stated 667.64, out by 0.29). That is in
    # the document; it is why no component sum is asserted here.
    # 22 on the archived+live ranking. p43 "Table 11: Staff numbers as at 30 June
    # 2025", whose PRIOR YEAR IS IN BRACKETS ON EVERY CELL — "The numbers in
    # brackets are as at 30 June 2024 for comparison" — so one line carries both
    # readings and the Total row parses as six numbers rather than three:
    #
    #     Total 108 (140) 71 (96) 179 (236)
    #
    # 179 against 236, a fall of 24% the report explains itself: funding
    # constraints, a restructure announced in the reporting year, and temporary
    # contracts expiring after the 2024 local government elections.
    #
    # THE ROW SUMS ARE EXACT AND THE COLUMN SUMS ARE NOT, so both are asserted and
    # the tolerance is sized for the second. Female + Male = Total holds in each
    # year (108 + 71 = 179, 140 + 96 = 236), while the 2025 category column sums
    # to 178 against a stated 179 — the male column is out by one in the document
    # and the total carries it. The 2024 column is exact. Same one-off shape as
    # icare and the Office of Sport.
    #
    # THIS IS THE PERMANENT WORKFORCE AND THE CARD SHOULD NOT BE READ AS MORE.
    # The table counts only staff engaged under the Government Sector Employment
    # Act, and the page above it says "over 20,000 additional staff required at
    # statewide elections" plus contractors. It also excludes the Public Office
    # Holder, the Statutory Authority's members, the Audit and Risk Committee,
    # secondments out and long-term leave. 179 is the standing organisation.
    # 14 on the ranking. p68 PRINTS AN FTE TABLE AND A HEAD COUNT TABLE WITH
    # IDENTICAL ROW LABELS — managers, professionals, technicians, right down the
    # occupational classification — so `^Total` would have matched the FTE table's
    # row first and filed 271.4 as a head count. Two things stop that: pdfplumber
    # separates the two tables, and TWO INDEPENDENT CHECKS each exclude the wrong
    # one. Their total rows are named differently — "Total (non-casual)" is the
    # FTE one, the head count one is exactly "Total", which `^Total$` matches and
    # the other cannot — and the header assertion rejects any table not headed
    # "Headcount 2024 Headcount 2025".
    #
    # THE HEADER IS THE ONE DOING THE WORK, measured rather than assumed: loosened
    # to `^Total` this spec still returns 329, because the FTE table is thrown out
    # on its header before its total row is ever read. Its components would
    # otherwise have passed — they sum to 275.3 against a stated 275.1, inside the
    # default tolerance — so reconciliation alone would NOT have caught it. The
    # `$` is the second line of defence, not the first.
    #
    # Components sum EXACTLY in both years — 21+170+51+3+79+11 = 335 and
    # 22+168+50+3+78+8 = 329 — while the FTE table's 2024 column is out by 0.2.
    # That is another reason to take the head count here.
    #
    # AN ANNUAL AVERAGE, like the Office of Sport and unlike every census-date
    # card: the table's own note says "Average annual headcount shows data
    # averaged over the" reporting period. Non-casual only, per the FTE table's
    # label; the prose on p25 gives 271 FTE, which is the other table's 271.4.
    # 30 on the ranking, and the report took finding: the SES publishes it under
    # /sites/default/files/document/, and my three guessed listing paths all 404'd
    # before a search turned up the file.
    #
    # p24 "Representation of employees by level compared with the two previous
    # years" — three years wide, Total/Women/Racial-ethno-religious-minority in
    # each, so the Totals row is NINE numbers: 628 351 37 | 691 382 41 | 498 382
    # 28. All three year columns reconcile EXACTLY against the seven grade rows
    # (50+117+173+142+96+37+13 = 628, and likewise 691 and 498), which is as
    # strong as this route gets.
    #
    # THE GRADE LABELS ARE ON THE WRONG LINES, so `comp` matches the SALARY BAND
    # instead. pdfplumber emits "$67,975 - $73,902 50 30 3 49 31 2 44 27 2" and
    # then "Grade 1/2" on the line after it, so a pattern anchored on the grade
    # name matches a line with no numbers on it at all.
    #
    # `stated` CROSS-CHECKS AGAINST THE NOTE, which prints the figure a second
    # time: "Total staff for 2024-25 is inclusive of a Full Time Employees (628).
    # This is inclusive of ongoing, temporary and casual staff." So the column and
    # the prose have to agree, and the same page's senior-executive Totals row
    # cannot be taken by mistake — it carries six numbers, not nine.
    #
    # THIS IS PAID STAFF AND THE SES IS MOSTLY VOLUNTEERS. 628 is the employed
    # workforce; the volunteer membership is reported separately and grew 6.4%
    # over the same year. A card reading 628 is not the size of the NSW SES as the
    # public meets it, and that is the honest figure for an EMPLOYER card.
    # 18 on the ranking, and the fourth of six listing paths I guessed to 404 or
    # reset before a search found the real one. ombo.nsw.gov.au answers a
    # connection reset to a plain fetch and serves its reports from a separate CMS
    # asset host, cmsassets.ombo.nsw.gov.au.
    #
    # p65 states it in PROSE and nowhere in a table: "As at 30 June 2025, our
    # workforce consisted of 259 people (250.1 full-time equivalent staff levels)."
    # So the total row here is a sentence, and both numbers come off it — the head
    # count is taken and the FTE is the second.
    #
    # NO PRIOR YEAR, DELIBERATELY. p81 carries "FTE 233.6 250.1" as the denominator
    # of a workers-compensation rate, which would give a two-year FTE comparison —
    # but its column labels were not established, and a 7% change built on an
    # assumed column order is the failure this file keeps recording. The head count
    # has no comparator stated anywhere, so the card shows a level and no change.
    #
    # The basis is asserted rather than the number: staff "employed under the
    # provisions of the Government Sector Employment Act 2013", which is the same
    # scope the Electoral Commission's table uses.
    # 13 on the ranking, and the only card on this route filed from a 2023-24
    # document — because MULTICULTURAL NSW PUBLISHED NO ANNUAL REPORT FOR 2024-25.
    # Its own annual-reports page lists nine reports up to 2023-24 and then an
    # "Annual Information Statement 2024-25", which NSW allows a smaller agency to
    # file instead. That statement was read, all 45 pages: it carries People
    # Matter survey percentages and employee-related EXPENSES and no staff count
    # anywhere, so the 2023-24 report is the newest document with a figure in it.
    #
    # p26 "Staffing 2020–21 2021–22 2022–23 2023–24" over one row, "Number of
    # employees 67 79 105 118". Four consecutive years, so 105 -> 118 is a real
    # one-year change.
    #
    # THE $243,000-PER-HEAD PUZZLE IS WHY THIS WAS CHECKED TWICE AND WHY THE
    # CAVEAT IS HERE. Employee-related expenses are $28.6 million against 118
    # people, which is implausible for an agency and is exactly the shape of a
    # number that turns out to be counting something else. It is not: the page
    # names the "Crown Employees (Interpreters and Translators, Multicultural NSW)
    # Award 2021", so Multicultural NSW pays a panel of interpreters and
    # translators per assignment who are not in the 118. The 118 is its ongoing
    # staff, the same kind of understatement the SES has with volunteers and the
    # Electoral Commission with election casuals.
    # 16 on the ranking, and reaching it needed the THIRD interstitial of the day
    # to be recognised first. artgallery.nsw.gov.au is HALF OPEN: its root serves a
    # normal 136 KB page, while /about-us/corporate-information/annual-reports/
    # answers 3,036 bytes titled "Client Challenge". So the listing page cannot be
    # read — but its files sit on a datocms CDN that is wide open, and the 2023-24
    # report downloads from there without a browser.
    #
    # 2024-25 IS NOT REACHABLE AND 2023-24 IS, so this card is a year behind, like
    # Communities and Justice and Multicultural NSW. The newest report exists only
    # on parliament.nsw.gov.au; the CDN filenames are opaque timestamps
    # (1732502590-agnswannualreport23-24.pdf) and cannot be guessed forward.
    #
    # p82 "Staff profile": eight classification rows over four years, and the
    # components reconcile in THREE COLUMNS EXACTLY — 413, 492, 572 — with the
    # newest out by 0.6 because senior executives are carried as 7.4, a fractional
    # FTE inside a head count table. `tol` is 1.0 for that and nothing wider — at
    # 0.1 the spec is refused with "column 3 components sum to 582.4 against a
    # stated Total of 583.0", which is the slack being real rather than assumed.
    #
    # AND BECAUSE ALL FOUR COLUMNS RECONCILE, THE HEADER IS WHAT PICKS THE YEAR.
    # Pointed at the oldest column this spec returns 413 and passes every sum, so
    # reconciliation cannot tell 2020-21 from 2023-24 here. Same division of labour
    # the State Library spec turned out to have.
    #
    # THE BASIS IS NOT A CENSUS DATE AND THAT MATTERS FOR COMPARING CARDS. The
    # table's own note: "Total headcount and effective full-time staff number
    # figures refer to the number of employees PAID DURING THE FINANCIAL YEAR." So
    # 583 counts everyone who drew pay across the year, churn included, where every
    # other NSW card here is a head count on one June day. The report offers no
    # census figure at all — its other row, effective full-time 385, carries the
    # same cumulative basis — so the caveat cannot be avoided by picking the other
    # number, only stated. The head count is taken because it is the row the eight
    # components actually add up to.
    'nsw-agnsw': dict(
        label='NSW: Art Gallery of NSW',
        agency='Art Gallery of New South Wales',
        agency_id='nsw-gov-art-gallery-of-new-south-wales',
        url='https://www.datocms-assets.com/42890/1732502590-agnswannualreport23-24.pdf',
        needle='Staff profile',
        # NO `$` ANCHORS HERE, UNLIKE THE STATE LIBRARY SPEC, and the difference is
        # which path can read the page. pdfplumber extracts the Library's two
        # tables, so its labels arrive as exactly "Total" and `^Total$` both matches
        # and discriminates. It extracts NOTHING from this page, so only the line
        # fallback is available — and there the text is "Total 413 492 572 583",
        # which `^Total$` cannot match at all. A lookahead keeps the numbers
        # unconsumed while still excluding the two decoys on the same page: "Totals
        # 3 5 2.4 5" has no space after Total, and "Total headcount and effective
        # full-time staff number figures refer to..." is followed by a word.
        total=r'^Total(?=\s+\d)',
        comp=r'^(?:Administration and clerical staff|Conservators|'
             r'Curators and registrars|Education officers|General division staff|'
             r'Librarians and archivists|Security staff|'
             r'Public service senior executives)\b',
        ncols=4, now_i=3, prev_i=2, sums=[(0,), (1,), (2,), (3,)], tol=1.0,
        header=r'Classification\s+2020.21\s+2021.22\s+2022.23\s+2023.24',
        proof=r'refer to the number of employees paid during the financial year',
        unit='headcount', asof='Jun 2024'),
    'nsw-mnsw': dict(
        label='NSW: Multicultural NSW',
        agency='Multicultural NSW',
        agency_id='nsw-gov-multicultural-nsw',
        url='https://multicultural.nsw.gov.au/wp-content/uploads/2024/11/'
            'Multicultural-NSW-Annual-Report-2023-24.pdf',
        needle='Number of employees',
        total=r'^Number of employees\b',
        ncols=4, now_i=3, prev_i=2,
        header=r'Staffing\s+2020\s*.\s*21.*2023\s*.\s*24',
        proof=r'2023-24 Financial Year',
        unit='headcount', asof='Jun 2024'),
    'nsw-ombo': dict(
        label='NSW: Ombudsman',
        agency='NSW Ombudsman',
        agency_id='nsw-gov-nsw-ombudsman',
        url='https://cmsassets.ombo.nsw.gov.au/assets/Reports/'
            'NSW-Ombudsman-Annual-Report-2024-25.pdf',
        warm='https://www.ombo.nsw.gov.au/',
        needle='our workforce consisted of',
        total=r'^As at 30 June 2025, our workforce consisted of',
        ncols=2, now_i=0, prev_i=None,
        proof=r'employed under the provisions of the Government Sector Employment Act',
        unit='headcount', asof='Jun 2025'),
    'nsw-ses': dict(
        label='NSW: State Emergency Service',
        agency='NSW State Emergency Service',
        agency_id='nsw-gov-nsw-state-emergency-service',
        url='https://www.ses.nsw.gov.au/sites/default/files/document/'
            'nsw-ses-annual-report-2024-2025.pdf',
        warm='https://www.ses.nsw.gov.au/',
        needle='Representation of employees by level compared with the two previous years',
        total=r'^Totals\b',
        comp=r'^(?:\$[\d,]+ - \$[\d,]+|Above A & C Grade 12)',
        ncols=9, now_i=0, prev_i=3, sums=[(0,), (3,), (6,)],
        stated=r'Full Time Employees \(([\d,]+)\)',
        proof=r'Total staff for 2024-25 is inclusive of',
        unit='headcount', asof='Jun 2025'),
    'nsw-slnsw': dict(
        label='NSW: State Library',
        agency='State Library of New South Wales',
        agency_id='nsw-gov-state-library-of-new-south-wales',
        url='https://www.sl.nsw.gov.au/sites/default/files/2025-11/annual_report_24-25.pdf',
        needle='AVERAGE HEADCOUNT',
        total=r'^Total$',
        comp=r'^(?:managers|professionals|technicians and trades workers|'
             r'community and personal service workers|'
             r'clerical and administrative workers|sales workers)$',
        ncols=2, now_i=1, prev_i=0, sums=[(0,), (1,)],
        header=r'Headcount 2024\s+Headcount 2025',
        proof=r'Average annual headcount shows data averaged',
        unit='headcount', asof='Jun 2025'),
    # 14 on the ranking. p76 Table A.1 "Staff profile": three years of head count
    # at 30 June — 310 / 319 / 347 — and the prose beside it states the newest
    # outright: "As at 30 June 2025 the Australian Museum employed 347 staff, with
    # a full time equivalent (FTE) of 287.72." `stated` holds the parse to that
    # sentence, so the column and the prose have to agree.
    #
    # THE HEADER ROW IS GARBLED AND STILL USABLE. pdfplumber interleaves the table
    # caption into it — "S in t a c f l f a h ss e i a fi d c c a o ti u o n n t
    # FY2022-23 FY2023-24 FY2024-25" — because a neighbouring table is typeset
    # beside it. The year labels survive intact, which is all the assertion needs.
    'nsw-ausmus': dict(
        label='NSW: Australian Museum',
        agency='Australian Museum',
        agency_id='nsw-gov-australian-museum',
        url='https://media.australian.museum/media/dd/documents/'
            'Australian_Museum_Annual_Report_24-25.2601b86.pdf',
        needle='headcount at 30 June',
        total=r'^Staff \(headcount at 30 June\)',
        ncols=3, now_i=2, prev_i=1,
        # ANCHORED ON THE TAIL OF THE SENTENCE, NOT ITS HEAD, because the page
        # typesets two text columns and pdfplumber interleaves them: "the
        # Australian Museum employed" is followed on the SAME line by "The AM has
        # strengthened its commitment to serving", and "347 staff, with a full
        # time equivalent" begins the next. A pattern reading forward from
        # "employed" matches nothing; one reading back from "staff, with a full
        # time equivalent" is unaffected by where the line breaks fall.
        stated=r'([\d,]+) staff, with a full time equivalent',
        header=r'FY2022-23\s+FY2023-24\s+FY2024-25',
        proof=r'As at 30 June 2025 the Australian Museum employed',
        unit='headcount', asof='Jun 2025'),
    'nsw-ecnsw': dict(
        label='NSW: Electoral Commission',
        agency='NSW Electoral Commission',
        agency_id='nsw-gov-nsw-electoral-commission',
        url='https://elections.nsw.gov.au/getmedia/f9303618-790c-4cd3-9e56-0b396a842617/'
            'nswec-2024-25-annual-report-acc.pdf',
        warm='https://elections.nsw.gov.au/',
        needle='Staff numbers as at 30 June 2025',
        total=r'^Total\b',
        comp=r'^(?:Senior executives \(equivalent\)\*?|Ongoing officers|Temporary officers)',
        ncols=6, now_i=4, prev_i=5,
        sums=[(0, 2, 4), (1, 3, 5), (4,), (5,)], tol=1.5,
        header=r'Staff category\s+Female\s+Male\s+Total',
        proof=r'numbers in brackets are as at 30 June 2024',
        unit='headcount', asof='Jun 2025'),
    'nsw-soh': dict(
        label='NSW: Sydney Opera House',
        agency='Sydney Opera House',
        agency_id='nsw-gov-sydney-opera-house',
        url='https://sydneyoperahouse.api.collaboro.com/media/annual-report-2025',
        needle='Five-year comparison of staff',
        total=r'^Total full-time equivalent',
        ncols=5, now_i=0, prev_i=1,
        header=r'FY25\s+FY24\s+FY23\s+FY22\s+FY21',
        proof=r'as at 30 June 2025',
        unit='fte', asof='Jun 2025'),
    'nsw-sport': dict(
        label='NSW: Office of Sport',
        agency='Office of Sport',
        agency_id='nsw-gov-office-of-sport',
        url='https://www.sport.nsw.gov.au/sites/default/files/2025-11/'
            'OoS-Annual-Report-2024-25.pdf',
        needle='full-time equivalent staff in Office of Sport (annual average)',
        total=r'^Office of Sport\b',
        comp=r'^TOTAL\b',
        ncols=4, now_i=3, prev_i=2, sums=[(2,), (3,)],
        header=r'2021/2022\s+2022/2023\s+2023/2024\s+2024/2025',
        proof=r'annual average number of full-time equivalent',
        unit='fte', asof='Jun 2025'),
    'nsw-snsw': dict(
        label='NSW: Service NSW',
        agency='Service NSW',
        agency_id='nsw-gov-service-nsw',
        url='https://www.service.nsw.gov.au/system/files/2025-12/'
            'Annual-Report-2025-SNSW_0.pdf',
        warm='https://www.service.nsw.gov.au/',
        needle='Size of agency (Headcount)',
        total=r'^Non-casual Headcount at Census Date',
        ncols=4, now_i=2, prev_i=1, change_i=3,
        header=r'2023\s+2024\s+2025\s+% Change 2024 to 2025',
        proof=r'census date 19 June 2025|Census Date',
        unit='headcount', asof='Jun 2025'),
    'nsw-treasury': dict(
        label='NSW: Treasury',
        agency='NSW Treasury',
        agency_id='nsw-gov-nsw-treasury',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-12/'
            'nsw-treasury-annual-report-2024-25.pdf',
        needle='Full-time equivalent (FTEs) per group',
        total=r'^FTE\b',
        ncols=3, now_i=2, prev_i=1,
        header=r'Group\s+2022.23\s+2023.24\s+2024.25',
        proof=r'On 19 June 2025 NSW Treasury had',
        unit='fte', asof='Jun 2025'),
    'nsw-dpird': dict(
        label='NSW: Primary Industries and Regional Development',
        agency='Department of Primary Industries and Regional Development',
        agency_id='nsw-gov-department-of-primary-industries-and-regional-development',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-11/'
            'dpird-annual-report-2024-25.pdf',
        needle='Number of officers and employees by',
        total=r'^Total\b',
        comp=r'^(?:Permanent|Temporary|Senior executive|Casual)[a-z\- ]*',
        ncols=2, now_i=1, prev_i=None, sums=[(0,), (1,)],
        proof=r'June\s*\n?\s*2025|DPIRD June 2025',
        unit='headcount', asof='Jun 2025'),
    # ── State-owned corporations, 2026-09-28 ─────────────────────────────────
    # A DIFFERENT SHAPE FROM THE DEPARTMENTS ABOVE, and it is the reason these
    # were never reachable through `nsw`: the Workforce Profile covers the public
    # service, and a state-owned corporation employs its own staff outside it.
    # So there is no row to alias to and never was — only each corporation's own
    # annual report, which is what this table already knows how to read.

    # p86 prints TWO workforce tables one under the other and the wrong one is
    # the one with more years in it. "Workforce numbers – full-time equivalent,
    # 2020–21 to 2024–25" carries five columns and a Total of 3,967; "Workforce
    # numbers – headcount, 2023–24 to 2024–25" carries two and a Total of 4,011.
    # `ncols=2` is what separates them — the FTE rows have five numbers each and
    # cannot qualify — and it is doing real work, because both tables reconcile
    # against their own components and so `_reconciles` alone could not choose.
    # The head count is taken, as everywhere else here that publishes both.
    #
    # BOTH COLUMNS ARE ASSERTED: 3,623 + 242 + 146 is 4,011 and 3,225 + 151 + 154
    # is 3,530, exactly. Footnote 1 to the page dates them — "Staff numbers at
    # 30 June 2025".
    'nsw-sydwater': dict(
        label='NSW: Sydney Water',
        agency='Sydney Water',
        agency_id='nsw-gov-sydney-water',
        url='https://www.sydneywater.com.au/content/dam/sydneywater/documents/'
            'sydney-water-annual-report-2024-25.pdf',
        needle='Workforce numbers – headcount',
        total=r'^Total\b',
        comp=r'^Headcount – (?:permanent|temporary|part time)',
        ncols=2, now_i=1, prev_i=0, sums=[(0,), (1,)],
        proof=r'Workforce numbers – headcount, 2023–24 to 2024–25',
        unit='headcount', asof='Jun 2025'),
    # p45 "Workforce profile": Headcount 2025 2024 — NEWEST COLUMN FIRST, which
    # is the opposite of every NSW department above and the reason `now_i` is 0
    # here. Getting that backwards would report a fall of 8 as a rise of 8 with
    # both numbers real, which is the NSW Police column-order lesson.
    #
    # THE PAGE CARRIES THREE Total ROWS OF TWO NUMBERS: 568/560 under the gender
    # rows, 568/560 again under the employment-type rows, and 551/545 under a
    # Full time equivalent heading. `comp` names the gender rows alone so the FTE
    # table cannot reconcile against them, and `stated` is the page's own prose —
    # "We have 568 employees working across eight divisions" — which is the
    # independent quantity that rules out filing 551 as a head count.
    'nsw-huntwater': dict(
        label='NSW: Hunter Water',
        agency='Hunter Water',
        agency_id='nsw-gov-hunter-water',
        url='https://www.hunterwater.com.au/documents/assets/src/uploads/'
            'documents/Annual-Reports-Past-Reports/Annual-report-2024-25.pdf',
        needle='Workforce profile',
        total=r'^Total\b',
        comp=r'^(?:Males|Females|Non-binary)\b',
        ncols=2, now_i=0, prev_i=1, sums=[(0,), (1,)],
        stated=r'We have ([\d,]+) employees',
        proof=r'Headcount 2025 2024',
        unit='headcount', asof='Jun 2025'),
    # THE FIRST HTML REPORT IN THIS TABLE, and the reason the `html` branch above
    # exists. The Audit Office publishes /annual-report/annual-report-2024-25 as
    # a page; the PDFs linked from it are appendices one to nine, so a spec
    # pointed at any of them would be reading a fragment.
    #
    # ITS "Our people" section states all four numbers in ONE sentence: "the
    # number of full-time equivalent employees at 30 June 2025 was 348, higher
    # than 337 last year and the employee headcount was 359, higher than 346 last
    # year." The head count is taken, and taking it needs no judgement about
    # column order because the sentence names each figure — which is exactly why
    # the html branch demands both years in one match.
    #
    # `stated` IS NOT USED AND CANNOT BE. The page's overview panel gives "348
    # full-time equivalent employees at 30 June 2025", which is the FTE, so a
    # cross-check against it would fail against a head count that is perfectly
    # correct. The sentence is the source and the FTE beside it is the decoy.
    'nsw-audit': dict(
        label='NSW: Audit Office',
        agency='Audit Office of New South Wales',
        agency_id='nsw-gov-audit-office-of-new-south-wales',
        url='https://www.audit.nsw.gov.au/annual-report/annual-report-2024-25',
        html=True,
        find=r'employee headcount was ([\d,]+), higher than ([\d,]+) last year',
        now_g=1, prev_g=2,
        proof=r'full.time equivalent employees at 30 June 2025 was [\d,]+',
        unit='headcount', asof='Jun 2025'),
    # p118, the Workforce Diversity appendix every NSW agency files: "1. Size of
    # agency (headcount) 2023 2024 2025 / Non-casual Headcount as Census Date
    # 956 970 1,089". The published change beside it is 12.3%, and 1,089 against
    # 970 is 12.27%, so the pair reads correctly — but it is NOT wired as
    # `change_i`, which reads a fourth column in the SAME row. Here the change is
    # its own row, so the header assertion is the column guard instead.
    #
    # THAT CHANGE ROW IS ALSO A TRAP AND THE LOOKAHEAD IS WHY. Its label is
    # "Non-casual Headcount as Census Date (year on year %)" — a PREFIX of the
    # figure row's label, carrying three numbers exactly like it, so a bare
    # `^Non-casual Headcount as Census Date` matches both and the later match
    # wins. That would have filed 12.3 as a workforce. The lookahead refuses any
    # continuation into a bracket.
    #
    # IT DOES NOT DOUBLE COUNT DCJ, whose 25,643 is also filed. The page names
    # the split itself — "Portfolio: Communities and Justice / Reporting Entity:
    # Office of the Director of Public Prosecutions" — so the ODPP files its own
    # appendix as its own reporting entity, and the department's figure is the
    # department's employees.
    'nsw-odpp': dict(
        label='NSW: Director of Public Prosecutions',
        agency='Office of the Director of Public Prosecutions',
        agency_id='nsw-gov-office-of-the-director-of-public-prosecutions',
        url='https://www.odpp.nsw.gov.au/sites/default/files/2025-11/'
            'ODPP_Annual_Report_2024-2025.pdf',
        needle='Size of agency (headcount)',
        total=r'^Non-casual Headcount as Census Date(?!\s*\()',
        ncols=3, now_i=2, prev_i=1,
        header=r'2023\s+2024\s+2025',
        proof=r'Size of agency \(headcount\)',
        unit='headcount', asof='Jun 2025'),
    # p93 "Classification by full-time equivalent and headcount": four number
    # columns — FTE and head count for 2023-24, then FTE and head count for
    # 2024-25 — and a Total row of 354.58 / 456.00 / 350.08 / 483.00. The head
    # count is column 3.
    #
    # NO COMPONENT SUM IS POSSIBLE AND THE REASON IS IN THE TABLE, not a
    # shortcut. Two classifications exist in only one of the two years: Car
    # Drivers reads "1.71 2.00 – –" and Chief Guide, Historic Houses Trust reads
    # "– – 4.56 9.00". Both carry two numbers against four columns, so `ncols=4`
    # cannot admit them, and a column sum over what is left comes to 474 against
    # a stated 483 and 454 against 456 — off by exactly those two rows. A `sums`
    # check here would reject a correct parse. The header is asserted instead,
    # and it is worth being exact about what that does and does not buy. It
    # proves the table's column ORDER is still FTE, Headcount, FTE, Headcount, so
    # index 3 is still a head count and an edition that reordered the pairs fails
    # here. It does NOT catch a spec that simply names the wrong index — measured:
    # now_i=2 files 350.08, a perfectly clean parse of the FTE column. That one is
    # caught by having read the table, which is why the figures are written above.
    #
    # NOT INSIDE ANY FILED DEPARTMENT, unlike Taronga. Its people come from a
    # staff agency too — p170, "The staff agency provides personnel services to
    # MHNSW and State Records Authority NSW" — but that agency is MHNSW's OWN,
    # not a department's, and p14 of the Creative Industries report lists Museums
    # of History NSW among the portfolio agencies that publish SEPARATE annual
    # reports rather than among its five divisions. So this 483 is nobody else's.
    'nsw-mhnsw': dict(
        label='NSW: Museums of History',
        agency='Museums of History NSW',
        agency_id='nsw-gov-museums-of-history-nsw',
        url='https://cdn.sanity.io/files/zl9du87e/production/'
            '4d8c3cbc3fb090bb54e4880bc7670389fc81b8d4.pdf',
        needle='Classification by full-time equivalent and headcount',
        total=r'^Total\b',
        ncols=4, now_i=3, prev_i=1,
        header=r'Classification\s+FTE\s+Headcount\s+FTE\s+Headcount',
        proof=r'census data as at 20 June 2024 and 19 June 2025',
        unit='headcount', asof='Jun 2025'),
    # ── The Premier's cluster, 2026-09-29 ────────────────────────────────────
    # AND THE PREMIER'S DEPARTMENT ENTRY IN NOT_IN_SOURCE WAS WRONG. It said the
    # report "carries no workforce table under any heading the other six use" and
    # that "the only full-time-equivalent figure in it is 262,900, which is the
    # whole NSW public sector". The 262,900 is real and is on p17 — but p47
    # carries "Staff profile by employment category", four columns of census head
    # count and FTE, with a Total of 1,072. So the reason was a measurement of a
    # search, not of the document, and it has been removed rather than left to
    # keep a card blank against a table that was there all along.
    #
    # BOTH REPORTS ARE ON nsw.gov.au AND THE SEARCH THAT FOUND THEM RETURNED
    # parliament.nsw.gov.au FIRST — the tabled-papers host this file records as
    # closed. Each department also publishes its own copy under
    # /sites/default/files/noindex/2025-11/, which is the same path six specs
    # above already use. Worth remembering before writing off a NSW report as
    # unreachable because the first link to it is on the blocked host.

    # p33 "Staff profile by employment category": census head count 237 -> 297,
    # census FTE 215.9 -> 271.3. Both head-count columns reconcile exactly
    # (33 + 220 + 44 and 34 + 187 + 16), and the senior-executive table above it
    # has a Total row too — seven numbers wide, so `ncols=4` cannot admit it.
    #
    # `sums` PROVES THE ROWS; THE HEADER PROVES WHICH PAIR. All four columns
    # reconcile against their own components, the FTE pair included, so a spec
    # reading indices 2 and 3 would sum correctly and file 271.3 — measured. What
    # rules that out is `header`: "Census headcount Census FTE" in that order, so
    # indices 0 and 1 are the head count and an edition that swapped the pairs
    # fails here. Naming the right index is what reading the table is for.
    #
    # NO PRIOR YEAR, AND THE TABLE DOES NOT SAY WHY — ANOTHER PAGE DOES. 237 to
    # 297 is +25.3% and the first version of this spec published it. p84, section
    # 6.3 "Machinery of Government costs/benefits": "Women NSW transferred to The
    # Cabinet Office on 1 July 2024." So the later column counts a function the
    # earlier one does not, and the rise is a transfer rather than hiring. The
    # staff-profile table carries no note about it, which is the whole lesson
    # here: the Premier's Department's equivalent table DOES footnote its own
    # machinery-of-government change, so finding none beside the numbers is not
    # evidence there was none. The report has to be read past the table.
    'nsw-tco': dict(
        label='NSW: The Cabinet Office',
        agency='The Cabinet Office',
        agency_id='nsw-gov-the-cabinet-office',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-11/'
            'the-cabinet-office-annual-report-2024-25.pdf',
        needle='Staff profile by employment category',
        total=r'^Total\b',
        comp=r'^(?:Public Service Senior Executive|Ongoing employee|'
             r'Temporary employee)s?\b',
        ncols=4, now_i=1, prev_i=None, sums=[(0,), (1,)],
        header=r'Census headcount\s+Census FTE',
        proof=r'2025 Workforce Profile Data',
        unit='headcount', asof='Jun 2025'),
    # p47, the same table shape: census head count 686 -> 1,072, reconciling both
    # years exactly (77 + 856 + 136 + 3, and 50 + 535 + 100 + 1).
    #
    # NO PRIOR YEAR, AND THE NOTE UNDER THE TABLE IS WHY. "Machinery of
    # Government changes effective 1 July 2024 included Investment NSW, Office of
    # the Public Service Commissioner, Office of the Chief Scientist & Engineer,
    # and Regional Coordination becoming part of the Premier's Department." So
    # 686 -> 1,072 is +56% and not one person of it is hiring — four bodies moved
    # in. The prior column is still READ, because `sums` reconciles it and that is
    # what proves the head-count pair is where the spec thinks it is; it is simply
    # not published as a comparator.
    'nsw-premiers': dict(
        label="NSW: Premier's Department",
        agency="Premier's Department",
        agency_id='nsw-gov-premier-s-department',
        url='https://www.nsw.gov.au/sites/default/files/noindex/2025-11/'
            'premiers-department-annual-report-2024-25_0.pdf',
        needle='Staff profile by employment category',
        total=r'^Total\b',
        comp=r'^(?:Public Service Senior Executives|Ongoing employees|'
             r'Temporary employees|Statutory appointees)\b',
        ncols=4, now_i=1, prev_i=None, sums=[(0,), (1,)],
        header=r'Census headcount\s+Census FTE',
        proof=r'2025 Workforce Profile Data',
        unit='headcount', asof='Jun 2025'),
    # ── AND THE TABLED-PAPERS HOST IS NOT CLOSED. IT HAS A FILE API. ─────────
    # This file has recorded NSW Parliament's tabled-papers host as unreachable
    # for weeks, and that is true of exactly one hostname. Measured 2026-09-29 on
    # the same document, seconds apart:
    #
    #   www.parliament.nsw.gov.au/tp/files/192117/<name>.pdf            403, 6,437 B
    #   files.parliament.nsw.gov.au/fileapi/ParlFiles/GetArtifact/
    #       <name>.pdf?serverRelativeUrl=%2Ftp%2Ffiles%2F192117%2F<name+with+pluses>
    #                                                          200, 5,966,343 B, %PDF
    #
    # Same file, same parliament, one hostname refused and the other served it.
    # "The host is closed" was a measurement of www and was written down as a
    # measurement of the institution — the same shape as the sitemap that lists
    # pages, and as the Premier's Department table that was there all along.
    #
    # THE URL IS BUILDABLE FROM THE www ONE: take the /tp/files/<id>/<name>.pdf a
    # search returns, put <name> percent-encoded after GetArtifact/, and repeat it
    # in serverRelativeUrl with spaces as PLUS signs rather than %20. Both halves
    # are required; the id alone 404s with a 64-byte "File" body, which is how a
    # guessed filename announces itself.
    #
    # WHAT IT OPENS. Every NSW agency that only tables its report — the two below,
    # and on the evidence of these two also the Independent Commission Against
    # Corruption, IPART, Landcom, the Department of Parliamentary Services and the
    # three state-owned corporations whose own hosts refuse this network. Those are
    # not yet filed, and their NOT_IN_SOURCE reasons stand as written about their
    # OWN hosts; this route is the next thing to try on each.

    # p47, Table 13 "Number (based on headcount) of officers and employees by
    # category": 2024-25 first, then 2023-24 — NEWEST COLUMN FIRST, so `now_i` is
    # 0. Both columns reconcile exactly (2,703 + 509 + 0 + 206 and 2,485 + 624 + 1
    # + 206), and Table 12 above it is the FTE version whose Total reads 2925 /
    # 2951.2, which is why `comp` and the header are both pinned.
    #
    # THE PRIOR YEAR IS COMPARABLE HERE AND THE FOOTNOTE IS WHY IT LOOKS LIKE IT
    # MIGHT NOT BE. Footnote 4: "Data for 2022-23 represents Department of Planning
    # and Environment, while the 2024 and 2025 data represent Department of
    # Planning, Housing, and Infrastructure following Machinery of Government
    # changes." The machinery change lands between 2022-23 and 2023-24, and
    # 2022-23 is not in this table — so the two columns that are in it are the
    # same department.
    #
    # AND FOOTNOTE 5 SETTLES PROPERTY AND DEVELOPMENT NSW BELOW: the numbers
    # "exclude employees in ... Property and Development NSW ...", among eleven
    # bodies. So the 170 on that card is not inside this 3,418 and both can be
    # filed — which is the opposite of the Taronga and Destination NSW calls, on
    # the department's own statement rather than on the shape of the cluster.
    'nsw-dphi': dict(
        label='NSW: Planning, Housing and Infrastructure',
        agency='Department of Planning, Housing and Infrastructure',
        agency_id='nsw-gov-department-of-planning-housing-and-infrastructure',
        url='https://files.parliament.nsw.gov.au/fileapi/ParlFiles/GetArtifact/'
            'Department%20of%20Planning%20Housing%20and%20Infrastructure%20Annual'
            '%20Report%202024-25%20-%20Volume%201.pdf?serverRelativeUrl='
            '%2Ftp%2Ffiles%2F192117%2FDepartment+of+Planning+Housing+and+'
            'Infrastructure+Annual+Report+2024-25+-+Volume+1.pdf',
        needle='based on headcount) of officers and employees by category',
        total=r'^Total\b',
        comp=r'^(?:Ongoing|Temporary|Casual|Executive)\b',
        ncols=2, now_i=0, prev_i=1, sums=[(0,), (1,)],
        integers=True,
        header=r'Category\s+2024-25\s+2023-24',
        proof=r'based on headcount\) of officers and employees by category',
        unit='headcount', asof='Jun 2025'),
    # p11 of the 2023-24 report, "Number of officers and employees by category
    # with previous year comparison": 170 / 154 / 130 across 2023-2024, 2022-2023
    # and 2021-2022, all three reconciling (125 + 21 + 24, 114 + 16 + 24, 99 + 10
    # + 21). A year behind because the 2024-25 edition is tabled but not indexed
    # anywhere a search reaches, and the guessed filenames 404 — the same call as
    # DCJ, whose card is also a year behind its peers.
    #
    # PDNSW EMPLOYS NOBODY, AND FILING IT IS STILL RIGHT. p30: "Under the Act,
    # PDNSW is unable to employ staff. However, to enable it to exercise its
    # functions, PDNSW can obtain personnel services from Government agencies",
    # and p33 names the provider as DPHI. Normally that is the Taronga case and
    # the card stays blank — but DPHI's own footnote 5 EXCLUDES Property and
    # Development NSW from its published numbers, so these 170 people are on no
    # other card and nothing double counts.
    #
    # NO PRIOR YEAR, BECAUSE THE PAGE CONTRADICTS ITSELF ABOUT WHICH COLUMNS
    # SHARE A BASIS. The header marks "2023-2024* 2022-2023*" and the note says
    # "2021-2022 & 2022-2023 headcounts exclude Hunter & Central Coast
    # Corporation, Sydney Olympic Park Authority, Water Asset Management
    # Corporation and Valuation General NSW". The asterisks and the sentence name
    # different pairs, so which two columns are like for like cannot be read off
    # the page, and a +10.4% built on the wrong pair would be a membership change.
    # The prior column is still summed, which is what proves the parse.
    'nsw-pdnsw': dict(
        label='NSW: Property and Development NSW',
        agency='Property and Development NSW',
        agency_id='nsw-gov-property-and-development-nsw',
        url='https://files.parliament.nsw.gov.au/fileapi/ParlFiles/GetArtifact/'
            'PDNSW%20Annual%20Report%202023-24.pdf?serverRelativeUrl='
            '%2Ftp%2Ffiles%2F189915%2FPDNSW+Annual+Report+2023-24.pdf',
        needle='Number of officers and employees by category',
        total=r'^Total\b',
        comp=r'^(?:Ongoing|Temporary|Executive)\b',
        ncols=3, now_i=0, prev_i=None, sums=[(0,), (1,), (2,)],
        header=r'2023-2024\*?\s+2022-2023\*?\s+2021-2022',
        proof=r'Headcount data reported at end of reporting period',
        unit='headcount', asof='Jun 2024'),
    # ── The two state-owned corporations the file API was meant to reach ─────
    # Both NOT_IN_SOURCE entries stand as written, because both measurements are
    # still true: essentialenergy.com.au and waternsw.com.au are behind a
    # Cloudflare challenge this exit IP cannot clear, 180 seconds of warmed browser
    # included. Neither card needed its own host in the end.

    # ESSENTIAL ENERGY'S TABLED COPY IS THE 2023-24 ONE and the current report is
    # on a CAMPAIGN MICROSITE — eear25.bwdstrategic.com, an agency host, 24 MB and
    # unchallenged. That is the URL here, with its risk stated: a microsite is a
    # marketing asset with no reason to outlive the campaign, so this spec is more
    # likely than any other in this table to 404 one day. It fails loudly when it
    # does, and the tabled 2024-25 copy is the replacement to look for.
    #
    # p130, TABLE A3 "Number of officers and employees by category – headcount":
    # five years of M/F pairs, 30 June 2021 to 30 June 2025, Total row ending
    # 3,112 / 827. There is NO grand total column, so `now_cols` sums the pair —
    # 3,939 for 2025 against 3,681 for 2024.
    #
    # TABLE A2 DIRECTLY ABOVE IT IS THE FTE VERSION, identical in shape and, this
    # time, identical in kind: every value in both tables is a whole number, so
    # `integers` cannot separate them any more than `header` can. Only the captions
    # differ, and only in their last word — "(FTE)1" against "headcount1" — which
    # is what `after` anchors on.
    #
    # THE CONTROL SAYS SOMETHING DIFFERENT FROM WHAT I EXPECTED AND IT IS WORTH
    # RECORDING AS MEASURED. Dropping `after` does not quietly file the FTE: the
    # line fallback then sees BOTH tables' Executive Leadership Team and
    # Non-executives rows, collects four components against one Total, and the
    # column reconciliation rejects it — "column 0 components sum to 5,037.0
    # against a stated Total of 2,517.0". So on this page `sums` is the thing
    # standing between a wrong number and the card, and `after` is what makes a
    # parse possible at all. Forestry Corporation is the opposite case, where the
    # fallback finds exactly one usable row set and `after` alone decides which.
    #
    # THE FIGURE EXCLUDES A FEW PEOPLE AND THE REPORT SAYS SO: footnote 1, "A
    # small number of employees (<0.2% of total workforce) did not identify as
    # male or female. These employees have been excluded from the gender"
    # breakdown. Under eight people on this base, excluded identically in both
    # years, so the comparison holds and the level is a floor rather than a guess.
    'nsw-essential': dict(
        label='NSW: Essential Energy',
        agency='Essential Energy',
        agency_id='nsw-gov-essential-energy',
        url='https://eear25.bwdstrategic.com/pdf/'
            'Essential-Energy_Annual-Report_2024-25.pdf',
        needle='by category – headcount',
        after=r'headcount1$',
        total=r'^Total\b',
        comp=r'^(?:Executive Leadership Team|Non-executives)\b',
        ncols=10, now_cols=[8, 9], prev_cols=[6, 7], prev_i=None,
        sums=[(i,) for i in range(10)],
        header=r'Gender\s+M\s+F',
        proof=r'30 JUNE 2021 30 JUNE 2022 30 JUNE 2023 30 JUNE 2024 30 JUNE 2025',
        unit='headcount', asof='Jun 2025'),
    # p26: "On 30 June | 2023-24 | 2024-25", Total employees 1078 -> 1151, with
    # Permanent, Term and Casual reconciling against both (1,041 + 93 + 17 and
    # 988 + 69 + 21). `comp` deliberately excludes the Aboriginal and Torres
    # Strait Islander row directly beneath the total — it is a SUBSET of the
    # workforce, not a category of it, and adding it in would make every column
    # miss by its own value.
    #
    # `integers` IS SET THOUGH NOTHING ON THIS PAGE CURRENTLY NEEDS IT: the FTE
    # figures are in an "Employee FTEs" row (1026.6 / 1113.6) that is neither the
    # total nor a component, so it cannot be reached today. If a restyle ever
    # promoted it, the decimals would fail here rather than land on the card.
    'nsw-waternsw': dict(
        label='NSW: WaterNSW',
        agency='WaterNSW',
        agency_id='nsw-gov-waternsw',
        url='https://files.parliament.nsw.gov.au/fileapi/ParlFiles/GetArtifact/'
            'Attachment%20C1%20-%20WaterNSW%20Annual%20Report%202024-2025.pdf'
            '?serverRelativeUrl=%2Ftp%2Ffiles%2F192122%2FAttachment+C1+-+'
            'WaterNSW+Annual+Report+2024-2025.pdf',
        needle='Employee FTEs',
        total=r'^Total employees\b',
        comp=r'^Number of employees\s*[–-]\s*(?:Permanent|Term|Casual)\b',
        ncols=2, now_i=1, prev_i=0, sums=[(0,), (1,)],
        integers=True,
        header=r'On 30 June\s+2023-24\s+2024-25',
        proof=r'On 30 June\s+2023-24\s+2024-25',
        unit='headcount', asof='Jun 2025'),
    # ITS OWN HOST REFUSES THIS NETWORK TOO — icac.nsw.gov.au answers 403 behind a
    # Cloudflare challenge — and the tabled copy does not. A YEAR BEHIND, because
    # the 2023-24 report is the one a search reaches; the same call as DCJ.
    #
    # THE PROSE FIGURE IS AN AVERAGE FTE AND WOULD HAVE BEEN THE WRONG ONE. p62,
    # under the heading "Number of officers and employees by category and compared
    # to the prior year": "In 2023–24, the Commission employed an average of 150
    # people, compared to 120 in 2022–23." Both numbers, both years, and it reads
    # like the answer — but the table it introduces is Table 22, "AVERAGE full-time
    # equivalent (FTE) employees by division", whose rows are 2.8, 3.0, 24.0, 59.2.
    # So 150 is an average FTE and 120 is last year's, and a spec that took the
    # sentence would have put an averaged FTE on a head-count tile.
    #
    # THE HEAD COUNT IS TABLE 24, the standard NSW diversity table: "Workforce
    # Diversity Actual Staff Numbers (Non-casual Headcount at Census Date) – 2024",
    # Total row 151. Its gender columns reconcile against it — 70 men + 81 women +
    # 0 unspecified — and that row sum is the guard, because this table's HEADER is
    # rendered mirrored by pdfplumber ("neM", "nemoW", "redneg defiicepsnU") and
    # cannot be asserted on. No prior year: the diversity table covers one census.
    'nsw-icac': dict(
        label='NSW: ICAC',
        agency='Independent Commission Against Corruption',
        agency_id='nsw-gov-independent-commission-against-corruption',
        url='https://files.parliament.nsw.gov.au/fileapi/ParlFiles/GetArtifact/'
            'NSW%20ICAC%20Annual%20Report%202023-24.pdf?serverRelativeUrl='
            '%2Ftp%2Ffiles%2F189674%2FNSW+ICAC+Annual+Report+2023-24.pdf',
        needle='Non-casual Headcount at Census Date',
        total=r'^Total\b',
        ncols=10, now_i=0, prev_i=None, sums=[(2, 3, 4, 0)],
        proof=r'Non-casual Headcount at Census Date\) – 2024',
        unit='headcount', asof='Jun 2024'),
    # ITS OWN HOST REFUSES THIS NETWORK AND THE TABLED COPY DOES NOT — the
    # finding above, applied. NOT_IN_SOURCE still carries the measurement that
    # forestrycorporation.com.au sits behind a Cloudflare challenge 180 seconds of
    # warmed browser cannot clear, because that is true and worth knowing; this
    # spec is the way round it.
    #
    # p30 prints "Employee numbers – trend (full-time equivalent)" and "Employee
    # numbers – trend (head count)" one under the other, TRANSPOSED against every
    # other table here: the rows are years and the Total is a COLUMN. So the "total
    # row" the machinery looks for is the year row — 2025** gives 387 flexible, 224
    # rostered, 611 total — and `sums` asserts that those two categories add to it.
    #
    # NO PRIOR YEAR, BECAUSE IT IS A DIFFERENT ROW RATHER THAN A DIFFERENT COLUMN.
    # 2024 reads 397 / 226 / 623 immediately above, so the figure exists and this
    # path cannot reach two rows at once. Worth recording rather than leaving
    # implicit: a transposed table is the one shape where prev is unavailable for a
    # mechanical reason and not an editorial one.
    #
    # `after` EXISTS FOR THIS PAGE. The FTE table is identical to the head-count
    # table in every respect the other selectors can see — same header, same two
    # year rows, three numbers each, and both integral (378 + 219 = 597 against
    # 387 + 224 = 611) — so `integers` cannot separate them and `header` matches
    # both. The captions are page text, not table rows, so the table is chosen by
    # sitting below the one word only its own caption carries.
    #
    # ITS REGEX HAS TO MATCH A WORD AND A LINE, because `after` constrains both
    # paths and they look at different things: the table path tests it against
    # each extracted WORD, the line fallback against each LINE. The first attempt
    # here was r'^count\)$', which matches the word and not the line "Employee
    # numbers – trend (head count)" — so the table path anchored correctly and the
    # fallback refused outright. r'count\)$' satisfies both and still matches
    # nothing else on the page.
    #
    # THE DATE IS THE FOOTNOTE, NOT THE YEAR LABEL: "**At final full pay period 15
    # June 2025", which is what `proof` holds it to.
    'nsw-forestry': dict(
        label='NSW: Forestry Corporation',
        agency='Forestry Corporation of NSW',
        agency_id='nsw-gov-forestry-corporation-of-nsw',
        url='https://files.parliament.nsw.gov.au/fileapi/ParlFiles/GetArtifact/'
            'forestry-corporation-nsw-annual-report-2024-25.pdf?serverRelativeUrl='
            '%2Ftp%2Ffiles%2F192061%2Fforestry-corporation-nsw-annual-report-'
            '2024-25.pdf',
        needle='Employee numbers – trend (head count)',
        after=r'count\)$',
        total=r'^2025',
        ncols=3, now_i=2, prev_i=None, sums=[(0, 1, 2)],
        header=r'Year ended 30 June\s+Flexible',
        proof=r'At final full pay period 15 June 2025',
        unit='headcount', asof='Jun 2025'),
    # NSW TRAINS IS NSW TrainLink, and that is why it looked like it had no
    # report. transport.nsw.gov.au's "NSW Trains Annual Reports" page links
    # documents titled "NSW TrainLink Annual Report" — one statutory corporation,
    # two names — and the file sits beside Transport for NSW's and Sydney Trains'
    # under /system/files/media/documents/2025/, not in the sitemap, exactly as
    # the note on the TfNSW spec above records. The two listing paths that would
    # name it both render as 29 KB not-found pages through a warmed browser, so
    # the route was the filename, not the index.
    #
    # p57, Table 9 "Total employee headcount by salary band": three years of
    # Female / Male / Total, ending 307 / 498 / 805. `sums` asserts F + M = Total
    # in each of the three year groups, which is what proves the columns are
    # where the spec thinks they are; Table 10 beside it is the FTE version with
    # six columns, so `ncols=9` cannot reach it.
    #
    # NO PRIOR YEAR, AND THE REPORT STATES THE REASON IN ONE SENTENCE. 2,252 ->
    # 805 is −64%, and p10 footnote 2 says: "The reduction in employees and
    # operating budget since 2023–24 is due to the transfer of intercity
    # operations and about 1450 staff from NSW Trains to Sydney Trains." 2,252
    # minus 1,450 is 802 against a reported 805, so the fall is the transfer and
    # nothing else. A card showing −64% would have been reporting a machinery
    # change as a collapse in hiring.
    'nsw-trains': dict(
        label='NSW: NSW Trains',
        agency='NSW Trains',
        agency_id='nsw-gov-nsw-trains',
        url='https://www.transport.nsw.gov.au/system/files/media/documents/2025/'
            'nsw-trainlink-annual-report-2024%E2%80%9325-volume-1.pdf',
        warm='https://www.transport.nsw.gov.au/',
        needle='Total employee headcount by salary band',
        total=r'^Total\b',
        ncols=9, now_i=8, prev_i=None,
        sums=[(0, 1, 2), (3, 4, 5), (6, 7, 8)],
        header=r'F\s+M\s+Total\s+F\s+M\s+Total\s+F\s+M\s+Total',
        proof=r'Annual salary\s+2022.23\s+2023.24\s+2024.25',
        unit='headcount', asof='Jun 2025'),
}


# Roster id -> its own source key. THE SAME MOVE AS `nzhealth` BELOW and for the
# same reason: these five have their own date and their own unit, so routing
# them to `nsw` would look up names the NSW Health appendix never held and then
# report the miss as the appendix's fault.
NSW_AGENCY_ROUTE = {v['agency_id']: k for k, v in NSW_AGENCY_REPORTS.items()}


def jurisdiction_of(cid):
    """Which SOURCE KEY a roster company id gets its figure from.

    ONE FUNCTION, CALLED TWICE, and it has to be. The matching loop and the
    merge loop each used to derive this themselves, and the merge's version was
    the simpler of the two: `cid.split('-gov-')[0]`. That was survivable until
    six NSW agencies started coming from their own annual reports — their ids
    are still `nsw-gov-…`, so the merge read them as belonging to `nsw` and a
    run that refreshed the NSW Health appendix DELETED all six. Measured
    2026-09-25: `--only nsw` wrote 343 agencies where the file had 349, and
    nothing failed.

    That is the exact failure the merge exists to prevent — one machine's run
    deleting what another machine's run filed — so the derivation cannot live in
    two places.
    """
    if cid in NSW_AGENCY_ROUTE:
        # Its figure comes from the agency's OWN annual report. Routed here
        # rather than to `nsw`, which is the NSW Health appendix and could never
        # name a non-health agency.
        return NSW_AGENCY_ROUTE[cid]
    if cid.startswith('aps-'):
        return 'aps'
    # `aps-` and `nz-` have no `-gov-` segment, so the split would return the
    # whole id and match no jurisdiction.
    if cid.startswith(('nz-health-new-zealand', 'nz-northern-regional-alliance')):
        # THE NORTHERN REGIONAL ALLIANCE IS DELIBERATELY SENT TO A SOURCE THAT
        # CANNOT FILL IT, so the run says so in the right place. Since September
        # 2024 the report folds NRA into a combined "National Payrolls" row with
        # seven other agencies — its people are in the 4,614, not absent from it.
        # Routed to `nz` instead it would come back unmatched against the Public
        # Service Commission, which never covered it either, and would read as
        # the wrong reason for the right answer. Health NZ's districts go to
        # their own source, which is a head count where the PSC's is FTE.
        return 'nzhealth'
    if cid.startswith('nz-'):
        return 'nz'
    return cid.split('-gov-')[0]


def _num(s):
    return float(s.replace(',', ''))


def _reconciles(spec, total, comps):
    """Why this parse does NOT add up, or None if it does.

    Returns a reason rather than raising, because it is also the DISCRIMINATOR
    between two tables on one page. The Department of Education prints "Full-time
    equivalent staff, 2022 to 2025" and "Staff active headcount, 2022 to 2025"
    side by side, both with a four-number Total row: 107,979 and 136,841. Taking
    whichever pdfplumber happened to return first would file one of them for the
    other with nothing to notice it. Only the FTE table's components sum to its
    own total — the head count deliberately does not, since a person counted as
    both a teacher and support staff appears once in the total and twice above it
    — so "the table that proves itself" picks the right one on evidence.
    """
    # A TOLERANCE, AND ONE SPEC NEEDS MORE THAN THE DEFAULT. Measured
    # 2026-09-25 on the Department of Education: three FTE components rounded to
    # whole numbers against a total rounded the same way, and the 2023 column
    # sums to 107,107 against a stated 107,108. One out. The other three columns
    # are exact. This is the NSW Police row's lesson again — a published change
    # of −592 beside a difference of 593 — so the tolerance is declared per spec
    # and stays small enough that the WRONG table is still rejected: the head
    # count beside it is out by 588, not by one.
    tol = spec.get('tol', 0.6)
    for cols in spec.get('sums', []):
        if len(cols) == 1:                      # a column, summed down the rows
            c = cols[0]
            if not comps:
                return f'no component rows to sum for column {c}'
            got = sum(r[c] for r in comps)
            if abs(got - total[c]) > tol:
                return (f'column {c} components sum to {got:,.1f} against a stated '
                        f'Total of {total[c]:,.1f}')
        else:                                   # a row, summed across to its total
            *parts, tot = cols
            got = sum(total[i] for i in parts)
            if abs(got - total[tot]) > tol:
                return (f'{parts} sum to {got:,.1f} against {total[tot]:,.1f} in the '
                        f'same row')
    return None


def _nsw_agency(spec):
    """One NSW agency annual report -> ({agency: (now, prev)}, asof, unit).

    The spec's regexes were each measured against the live document and are
    commented with the page they were read off. This re-reads it every run.
    """
    import io as _io
    import pdfplumber

    # ── `html`: AN AGENCY WHOSE ANNUAL REPORT IS A WEB PAGE, NOT A PDF ───────
    # The Audit Office of New South Wales publishes its report as HTML —
    # /annual-report/annual-report-2024-25 is the report, and the PDFs beside it
    # are appendices. Everything below assumes a PDF and raises "not a PDF" on
    # such a host, which reads as a broken link rather than as a different
    # format, and that is what this branch is for.
    #
    # IT IS DELIBERATELY STRICTER THAN THE TABLE PATH, NOT LOOSER. There are no
    # rulings to find a table by and no components to reconcile, so the one thing
    # standing between a number and a card is the regex — and so the spec must
    # capture BOTH years in ONE match. That is what makes a column-order mistake
    # impossible here: there are no columns, only the document's own sentence
    # saying which figure is which year. `proof` is still asserted, and the match
    # must be unique, for the same reasons as everywhere else.
    if spec.get('html'):
        page = fetch(spec['url'], warm=spec.get('warm'),
                     via_browser=bool(spec.get('render')), render=bool(spec.get('render')))
        text = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', ' ', page, flags=re.S | re.I)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = (text.replace('&nbsp;', ' ').replace('&amp;', '&')
                    .replace('&#8217;', "'").replace('&rsquo;', "'")
                    .replace('‑', '-').replace('–', '-'))
        text = ' '.join(text.split())
        if not re.search(spec['proof'], text):
            raise RuntimeError(f"{spec['label']}: the page no longer says "
                               f"{spec['proof']!r}, so {spec['asof']} cannot be shown "
                               f"to be its date")
        hits = list(re.finditer(spec['find'], text))
        if len(hits) != 1:
            raise RuntimeError(f"{spec['label']}: {spec['find']!r} matched "
                               f"{len(hits)} times, not once — ambiguous, nothing filed")
        now = _num(hits[0].group(spec.get('now_g', 1)))
        prev = (_num(hits[0].group(spec['prev_g']))
                if spec.get('prev_g') else None)
        if now <= 0 or (prev is not None and prev <= 0):
            raise RuntimeError(f"{spec['label']}: parsed {now}/{prev}")
        return {spec['agency']: (now, prev)}, spec['asof'], spec['unit']

    # `warm` FOR A HOST THAT 403s A PLAIN FETCH. transport.nsw.gov.au refuses
    # urllib outright and serves the same file to a browser that has loaded its
    # root first; every other report here needs nothing.
    blob = fetch(spec['url'], binary=True, warm=spec.get('warm'))
    if blob[:4] != b'%PDF':
        raise RuntimeError(f"{spec['label']}: not a PDF — starts {blob[:40]!r}")

    total, comps, proved, rejected, stated = None, [], False, [], None

    def cells(row):
        """A compacted table row -> (label, [numbers]) if its cells are numeric."""
        vals = [c for c in row if c not in (None, '')]
        if not vals:
            return None, []
        label = ' '.join(str(vals[0]).split())
        nums = []
        for c in vals[1:]:
            t = re.sub(r'[^\d.,]', '', str(c))
            if re.fullmatch(r'\d[\d,]*(?:\.\d+)?', t):
                nums.append(_num(t))
        return label, nums

    with pdfplumber.open(_io.BytesIO(blob)) as pdf:
        for pg in pdf.pages:
            txt = pg.extract_text() or ''
            if spec['needle'] not in txt:
                continue
            if re.search(spec['proof'], txt):
                proved = True
            # A TOTAL THE DOCUMENT STATES IN PROSE RATHER THAN PRINTING IN THE
            # TABLE. Creative Industries' classification table has four rows and
            # no Total line at all; the number is in the sentence above it, "the
            # department had 977.2 full-time equivalent (FTE) staff, equating to
            # a headcount of 1,019 staff". Captured here because it is the thing
            # the summed components get checked against.
            if spec.get('stated') and stated is None:
                m = re.search(spec['stated'], txt)
                if m:
                    stated = _num(m.group(1))

            # TABLES FIRST, LINES ONLY IF THEY YIELD NOTHING. Two of these pages
            # print two tables side by side, and extract_text() then interleaves
            # them: DPIRD's "Senior executive part-time 9 6" comes out glued to
            # the end of a footnote, and "Temporary part-time 93 87" appears
            # TWICE, which would silently double a component. The table form
            # keeps each table's own rows and is the same answer Tasmania needed.
            # `after`: PICK THE TABLE BY THE HEADING ABOVE IT, when nothing
            # inside it can tell it from its neighbour. Forestry Corporation
            # prints "Employee numbers – trend (full-time equivalent)" and
            # "Employee numbers – trend (head count)" one under the other and the
            # two tables are IDENTICAL in every respect the other selectors can
            # see: same "Year ended 30 June Flexible* Rostered* Total" header,
            # same two year rows, three numbers each, and both sets integral
            # (378 + 219 = 597 and 387 + 224 = 611), so `integers` cannot
            # separate them either. The captions are page TEXT rather than table
            # rows, so the only way in is position: find where the caption sits
            # and ignore every table above it.
            #
            # `find_tables()` RATHER THAN `extract_tables()`, because only the
            # former carries a bbox. It is used ONLY when `after` is set, so the
            # thirty specs that do not ask for it keep the code path they were
            # each measured against.
            # `after` IS MATCHED AGAINST SINGLE WORDS AND MUST HIT EXACTLY ONCE,
            # so the spec has to name the part of the caption that is unique to
            # it. Forestry's two captions differ only in their last words —
            # "(full-time equivalent)" against "(head count)" — so the spec says
            # r'^count\)$' and nothing else on the page can answer to it. A
            # regex that matched twice would be choosing a caption by luck.
            tables = pg.extract_tables()
            if spec.get('after'):
                tops = [w['top'] for w in pg.extract_words()
                        if re.search(spec['after'], w['text'])]
                if len(tops) != 1:
                    rejected.append(
                        f'{spec["after"]!r} matched {len(tops)} words on the page, '
                        f'not one — the table below it cannot be located')
                    tables = []
                else:
                    tables = [t.extract() for t in pg.find_tables()
                              if t.bbox[1] > tops[0]]
            for tab in tables:
                t_row, c_rows = None, []
                for row in tab:
                    label, nums = cells(row)
                    if len(nums) != spec['ncols']:
                        continue
                    # `.get`, BECAUSE A SPEC NEED NOT HAVE A TOTAL ROW. The
                    # `from_components` specs have none to match — Creative
                    # Industries' table simply stops after its four rows.
                    if spec.get('total') and re.match(spec['total'], label):
                        t_row = nums
                    elif spec.get('comp') and re.match(spec['comp'], label):
                        c_rows.append(nums)
                # NO TOTAL ROW, SO THE COMPONENTS ARE THE TOTAL — and the
                # prose is what proves it. Creative Industries prints
                # "Employee classification 2024 2025" over four rows and stops:
                # 73/71 senior executive, 812/858 ongoing, 86/85 temporary, 5/5
                # trainee. The 2025 column sums to 1,019, which is exactly the
                # head count its own text states, and 2024 sums to 976.
                #
                # THIS IS NOT THE USUAL RECONCILIATION AND MUST NOT BE MISTAKEN
                # FOR IT. Everywhere else the components are checked against a
                # total the document printed, and disagreement means the parse
                # is wrong. Here the sum IS the figure, so checking it against
                # itself would prove nothing — `stated` is the independent
                # quantity, and without a match the run refuses rather than
                # filing an unverified sum. `min_rows` stops one stray numeric
                # line becoming a workforce.
                if spec.get('from_components') and not t_row:
                    if len(c_rows) >= spec.get('min_rows', 3):
                        t_row = [sum(r[i] for r in c_rows) for i in range(spec['ncols'])]
                    else:
                        rejected.append(f'only {len(c_rows)} component rows, '
                                        f'below the {spec.get("min_rows", 3)} this '
                                        f'spec requires to add them up')
                if not t_row or not (c_rows or not spec.get('comp')):
                    continue
                # AN OPTIONAL HEADER ASSERTION, for a table with ONE data row and
                # so nothing to reconcile against. Local Land Services prints nine
                # year columns and a single FTE row: the only thing that can prove
                # the last column is June 2025 is the header itself, so the spec
                # names it and the table is rejected if it no longer reads that way.
                if spec.get('header'):
                    joined = [' '.join(' '.join(str(c).split())
                                       for c in row if c not in (None, ''))
                              for row in tab]
                    if not any(re.search(spec['header'], j) for j in joined):
                        rejected.append(f'no header row matching {spec["header"]!r}')
                        continue
                # `integers`: A HEAD COUNT IS WHOLE PEOPLE AND AN FTE IS NOT,
                # and on one page that is the only thing telling two tables apart.
                # The Department of Planning, Housing and Infrastructure prints
                # Table 12 (FTE) directly above Table 13 (head count) and they are
                # STRUCTURALLY IDENTICAL — same "Category 2024-25 2023-24" header,
                # same Ongoing/Temporary/Casual/Executive rows, same column count.
                # `ncols` cannot separate them, `header` matches both, and the FTE
                # table reconciles against its own components, so the first table
                # won and the spec filed 2,925 where 3,418 was the answer. It did
                # not fail; it produced a plausible number, which is the shape this
                # codebase exists to refuse.
                #
                # EVERY NUMBER IS CHECKED, NOT JUST THE TOTAL, because this
                # document's FTE total happens to be printed whole ("2925") while
                # its components carry the decimals (2,413.3, 326.6, 185.05). A
                # guard reading the total alone would have passed the wrong table.
                if spec.get('integers'):
                    vals = [v for row in [t_row, *c_rows] for v in row]
                    fracs = [v for v in vals if abs(v - round(v)) > 1e-9]
                    if fracs:
                        rejected.append(
                            f'{len(fracs)} non-integer value(s) in a table this spec '
                            f'declares a head count (e.g. {fracs[0]}) — an FTE table')
                        continue
                why = _reconciles(spec, t_row, c_rows)
                if why:
                    rejected.append(why)
                    continue          # a table that does not add up is not the one
                total, comps = t_row, c_rows
                break

            # The fallback, for a table pdfplumber cannot see as one — Customer
            # Service's "FTE over time" has no ruling lines and comes back as
            # text only. Numbers are taken AFTER the row prefix, never over the
            # whole line: its total reads "Total15 5,986.8 …" and counting the
            # footnote 15 made a four-column row look like five.
            #
            # AND THE HEADER ASSERTION APPLIES HERE TOO. It did not, and that is
            # a guard that looked present and was not: the check above lives
            # inside the table loop, so a spec whose table stops being one falls
            # through to these lines and reads them with NO proof of which column
            # it took. Customer Service and Local Land Services have the header
            # as their ONLY protection — neither can reconcile, by a property of
            # its table — so for those two the fallback was the whole guard
            # missing. Caught 2026-09-27 by a negative control that pointed a
            # spec at a header the document does not contain and got a figure
            # back anyway.
            if total is None and spec.get('header') and not re.search(spec['header'], txt):
                rejected.append(f'page text carries no header matching '
                                f'{spec["header"]!r}, so the line fallback is '
                                f'refused as well')
            elif total is None:
                # `after` CONSTRAINS THIS PATH TOO, and leaving it out of it was a
                # guard that looked present and was not — the same failure as the
                # header assertion above, one option later. Forestry Corporation's
                # head-count table comes back from find_tables() with its Flexible
                # and Rostered cells empty, so only the Total survives, `ncols=3`
                # never matches and the run falls through to here — where the FIRST
                # line starting "2025" belongs to the FTE table above the caption.
                # Measured: it filed 597 where 611 was the answer, with `after` set
                # and apparently working. Slicing the text at the caption is what
                # makes the option mean the same thing in both paths.
                lines = txt.split('\n')
                if spec.get('after'):
                    at = next((n for n, l in enumerate(lines)
                               if re.search(spec['after'], l)), None)
                    if at is None:
                        rejected.append(f'no line matching {spec["after"]!r}, so the '
                                        f'line fallback cannot be anchored either')
                        lines = []
                    else:
                        lines = lines[at + 1:]
                for line in lines:
                    for which in ('total', 'comp'):
                        pat = spec.get(which)
                        if not pat or (which == 'total' and total is not None):
                            continue
                        m = re.match(pat, line)
                        if not m:
                            continue
                        nums = re.findall(r'\d[\d,]*(?:\.\d+)?', line[m.end():])
                        if len(nums) != spec['ncols']:
                            continue
                        if which == 'total':
                            total = [_num(x) for x in nums]
                        else:
                            comps.append([_num(x) for x in nums])
                        break

            # AND THE SYNTHESIS HAS TO HAPPEN AFTER BOTH PATHS, not just the
            # table one. Creative Industries' page is exactly the case: its
            # "table" comes back from extract_tables() as a lone header row
            # ['Employee classification', '2024', '2025'] with no data rows at
            # all, so the four classification rows are only ever reached as
            # TEXT. Synthesising in the table loop alone found zero components
            # and reported the report restyled.
            if spec.get('from_components') and total is None:
                if len(comps) >= spec.get('min_rows', 3):
                    total = [sum(r[i] for r in comps) for i in range(spec['ncols'])]
                elif comps:
                    rejected.append(f'only {len(comps)} component lines, below the '
                                    f'{spec.get("min_rows", 3)} this spec requires '
                                    f'to add them up')
            if total:
                break

    if not total or len(total) != spec['ncols']:
        extra = f"; tables rejected for not adding up: {rejected}" if rejected else ''
        raise RuntimeError(f"{spec['label']}: no Total row of {spec['ncols']} numbers "
                           f"on a page containing {spec['needle']!r} — the report has "
                           f"been restyled{extra}")
    why = _reconciles(spec, total, comps)
    if why:
        raise RuntimeError(f"{spec['label']}: {why}")
    # A PERCENTAGE CHANGE THE DOCUMENT PUBLISHES, TURNED INTO THE GUARD.
    # Service NSW's "Size of agency (Headcount)" row reads
    #
    #     Non-casual Headcount at Census Date 5213 4868 4036 -17.1%
    #
    # so the trailing change parses as a FOURTH number and the spec has to
    # declare ncols=4 — which is the Customer Service footnote trap again, where
    # "Total15" made a four-column row look like five. Here the extra number is
    # not noise: it is the agency's own arithmetic over the two columns being
    # read, so requiring it to match turns the liability into the strongest check
    # available. A spec that took the wrong pair fails even though its regex
    # matched cleanly and its column count was right.
    if spec.get('change_i') is not None:
        now, prev = total[spec['now_i']], total[spec['prev_i']]
        want = total[spec['change_i']]
        got = abs((now - prev) / prev * 100)
        if abs(got - want) > spec.get('change_tol', 0.15):
            raise RuntimeError(f"{spec['label']}: columns {spec['prev_i']} and "
                               f"{spec['now_i']} ({prev:,.0f} -> {now:,.0f}) are a "
                               f"{got:.1f}% change, against the {want:.1f}% the table "
                               f"publishes beside them — the wrong pair was read")
    if spec.get('stated'):
        if stated is None:
            raise RuntimeError(f"{spec['label']}: the page no longer states a total "
                               f"matching {spec['stated']!r}, and this spec adds its "
                               f"own components up — so there is nothing left to "
                               f"check the sum against")
        got = total[spec['now_i']]
        if abs(got - stated) > spec.get('tol', 0.6):
            raise RuntimeError(f"{spec['label']}: components sum to {got:,.1f} "
                               f"against the {stated:,.1f} the document states in "
                               f"prose — the rows or the column are wrong")
    if not proved:
        raise RuntimeError(f"{spec['label']}: the page no longer carries "
                           f"{spec['proof']!r}, so the column the figure is read "
                           f"from can no longer be shown to be {spec['asof']}")

    # `now_cols` / `prev_cols`: A TOTAL SPLIT ACROSS COLUMNS WITH NO TOTAL COLUMN.
    # Essential Energy reports its workforce by gender and by year and prints no
    # grand total: its head-count Total row is M 3,112 and F 827 for 30 June 2025,
    # and the figure is their sum. `now_i` names one column and there is no one
    # column to name, so the spec names the set. Everything else — the component
    # reconciliation, the caption anchor, the proof — is unchanged; this only
    # decides which of the reconciled columns the card takes.
    now = (sum(total[i] for i in spec['now_cols']) if spec.get('now_cols')
           else total[spec['now_i']])
    prev = (sum(total[i] for i in spec['prev_cols']) if spec.get('prev_cols')
            else None if spec.get('prev_i') is None else total[spec['prev_i']])
    if not now > 0:
        raise RuntimeError(f"{spec['label']}: parsed a non-positive now ({now})")
    return {spec['agency']: (now, prev)}, spec['asof'], spec['unit']


SOURCES = {
    'aps': ('APS (federal)', load_aps, 1),
    'vic': ('Victoria', load_vic, 1),
    # Runs only where a browser is available — see the loader and
    # .github/workflows/qld-workforce.yml.
    'qld': ('Queensland', load_qld, 1),
    # PDF, so it needs pdfplumber. Reachable from a developer machine and from
    # the runner alike — the authoring sandbox's 403 is its own network.
    'sa': ('South Australia', load_sa, 1),
    # PDF too, and FTE like Queensland — see the loader.
    'nsw': ('New South Wales', load_nsw, 1),
    # Plain CSV, no browser needed. FTE, and June-to-June — see the loader.
    'nz': ('New Zealand', load_nz, 1),
    # Both sit behind a Cloudflare challenge that a WARMED browser clears, so
    # both run only where Playwright does. See the loaders for how each was
    # found, which took six rounds and is the more useful half of the story.
    'nt': ('Northern Territory', load_nt, 1),
    'tas': ('Tasmania', load_tas, 1),
    # ONE ENTRY PER NSW ANNUAL REPORT, built from NSW_AGENCY_REPORTS above.
    # Each is its own source because each has its own date and its own unit —
    # see the comment on that table. functools.partial rather than a closure in
    # a loop, so every entry does not end up bound to the last spec.
    **{k: (v['label'], functools.partial(_nsw_agency, v), 1)
       for k, v in NSW_AGENCY_REPORTS.items()},
    # A SEPARATE SOURCE FROM `nz` ON PURPOSE, not a few more rows on it. The
    # PSC publishes FTE and Health NZ publishes a head count, and one `unit`
    # is carried per source — merging them would label 11,473 people as FTE on
    # the card and put them in the same tile as figures they cannot be added
    # to. Same reason Queensland and NSW health are kept apart.
    'nzhealth': ('New Zealand health', load_healthnz, 1),
    # KEYED 'perth', NOT 'wa', because main() derives the jurisdiction from the
    # roster id and Western Australia's agencies are `perth-gov-…`. The label is
    # the state; the key has to match the ids.
    'perth': ('Western Australia', load_wa, 1),
}


def main():
    only = None
    if '--only' in sys.argv:
        only = {k.strip() for k in sys.argv[sys.argv.index('--only') + 1].split(',') if k.strip()}

    # --dump-source qld[,sa,…] prints EVERY row a source parsed, not just the
    # ones that matched nothing.
    #
    # WHY THAT IS A DIFFERENT LIST AND WHY IT IS NEEDED. The unmatched report
    # answers "what could an alias point at", which is the right question when
    # a jurisdiction has spare rows. Queensland has the opposite shape — 22
    # blank cards against 5 spare rows — so every remaining answer is a
    # refusal, and a refusal has to name what the body sits INSIDE. That name
    # is in the rows that DID match, which nothing printed.
    dump = set()
    if '--dump-source' in sys.argv:
        dump = {k.strip() for k in sys.argv[sys.argv.index('--dump-source') + 1].split(',')
                if k.strip()}

    # The roster, read straight out of the app so the ids cannot drift.
    data, meta, failed = {}, [], []
    for key, (label, load, span) in SOURCES.items():
        if only and key not in only:
            continue
        try:
            rows, asof, unit = load()
        except Exception as e:                                    # noqa: BLE001
            rows, asof, unit = {}, None, 'headcount'
            print(f'  {label}: FAILED — {type(e).__name__}: {str(e).splitlines()[0][:120]}',
                  file=sys.stderr)
        if not rows:
            failed.append(label)
            print(f'  {label}: nothing loaded', file=sys.stderr)
            continue
        by_norm = {}
        for name, v in rows.items():
            by_norm.setdefault(norm(name), []).append((name, v))
        meta.append((label, asof, len(rows), unit))
        print(f'  {label}: {len(rows)} source rows, as at {asof} ({unit})', file=sys.stderr)
        data[key] = (by_norm, asof, span, unit)

    # Match against the roster's government agencies.
    import subprocess
    agencies = json.loads(subprocess.run(
        ['bun', '-e', '''
import { COMPANIES } from "./src/employsi/data/companies";
console.log(JSON.stringify(COMPANIES.filter(c =>
    c.sector === "Government" ||
    // HEALTH NZ'S FIVE CARRY sector "Healthcare", NOT "Government", and asking
    // only for Government is why they were never even candidates: no match, no
    // unmatched-roster line, no spare source row. They are Crown-entity
    // districts, so they belong here whatever the sector field says. Scoped to
    // `nz-` so it cannot pull in a private hospital.
    (c.id.startsWith("nz-") && c.sector === "Healthcare"))
  .map(c => ({ id: c.id, name: c.name }))));'''],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout)

    # EVERY NOT_IN_SOURCE KEY MUST NAME A REAL ROSTER CARD, because a key that
    # does not is silent: the lookup misses, the agency falls back to "no
    # source row", and the reason someone measured and wrote down is simply
    # never printed. The table then looks maintained while saying nothing — the
    # same shape as a guard that cannot fire. A rename on the roster breaks
    # these the same way, and this is what says so.
    roster_keys = set()
    for a in agencies:
        if a['id'].startswith('aps-'):
            roster_keys.add(f"aps:{a['name']}")
        elif a['id'].startswith('nz-'):
            roster_keys.add(f"nz:{a['name']}")
            roster_keys.add(f"nzhealth:{a['name']}")
        elif '-gov-' in a['id']:
            roster_keys.add(f"{a['id'].split('-gov-')[0]}:{a['name']}")
    stray_reasons = sorted(k for k in NOT_IN_SOURCE if k not in roster_keys)
    if stray_reasons:
        print(f'\n  NOT_IN_SOURCE: {len(stray_reasons)} entries name no roster card '
              f'(renamed, or a typo — the reason will never print):', file=sys.stderr)
        for k in stray_reasons:
            print(f'      {k}', file=sys.stderr)
    # AND THE OPPOSITE STALENESS: A REASON FOR A CARD THAT IS NOW FILLED. Less
    # dangerous than a stray key, since nothing is hidden, but it misleads the
    # next reader into thinking a card is blank when a spec has since been written
    # for it. Three had accumulated by 2026-09-29 — the Premier's Department,
    # whose entry ALSO claimed a workforce table the report does carry, and DCJ
    # and the Department of Education, both filed from their own reports. Checked
    # after the merge, so a jurisdiction kept from a previous run counts too.
    # Keyed the same way as roster_keys above, New Zealand included: a partial
    # guard is the shape this file keeps getting caught by, so it covers every
    # prefix a reason can use rather than only the two that had stale entries.
    reason_key = {}
    for a in agencies:
        if a['id'].startswith('aps-'):
            reason_key[f"aps:{a['name']}"] = a['id']
        elif a['id'].startswith('nz-'):
            reason_key[f"nz:{a['name']}"] = a['id']
            reason_key[f"nzhealth:{a['name']}"] = a['id']
        elif '-gov-' in a['id']:
            reason_key[f"{a['id'].split('-gov-')[0]}:{a['name']}"] = a['id']

    out, skipped = {}, 0
    # BOTH SIDES OF A FAILED MATCH ARE REPORTED, because only one of them was
    # visible and it is the less useful one. The run said "N roster agencies
    # unmatched" and stopped there, so nothing ever showed that Victoria
    # publishes 261 agencies while 53 are filed — 208 source rows parsed,
    # carried through the whole run and silently dropped, against 38 Victorian
    # cards reading "no workforce figure collected". The two lists are the
    # working material for an ALIAS entry: one names what the card wants, the
    # other names what the source actually called it.
    unmatched_roster = collections.defaultdict(list)
    consumed = collections.defaultdict(set)
    summed = []
    for a in agencies:
        # `aps-` and `nz-` have no `-gov-` segment, so the split would return
        # the whole id and match no jurisdiction.
        pre = jurisdiction_of(a['id'])
        if pre not in data:
            continue
        by_norm, asof, span, unit = data[pre]
        # AN ALIAS KEY MAY BE QUALIFIED BY JURISDICTION, and one has to be.
        # The table was keyed by roster name alone, and roster names repeat:
        # "Electoral Commission" is both `qld-gov-electoral-commission` and
        # `nz-electoral-commission`. Queensland's needs an alias (the source
        # calls it "Electoral Commission Queensland") and New Zealand's matches
        # on its own name, so a bare-name entry would fix one by breaking the
        # other — silently, since both would still produce a figure. `qld:Name`
        # wins over `Name`, so a qualified entry is reachable and a bare one
        # stays the default.
        spec = ALIAS.get(f"{pre}:{a['name']}", ALIAS.get(a['name'], a['name']))

        # A VALUE MAY BE A LIST, WHICH IS SUMMED. Some roster entries are a
        # portfolio the source reports in pieces: "SA Health" is the public
        # brand for the Department for Health and Wellbeing, ten Local Health
        # Networks and the ambulance service, and no row is called SA Health.
        # Summing is only honest when the SAME members are present in BOTH
        # years — otherwise the change is the membership, not hiring, which is
        # the trap the WGEA generator hit with corporate groups. A member
        # missing from either year fails the whole entry rather than quietly
        # summing what is left.
        if isinstance(spec, (list, tuple)):
            parts, bad = [], []
            for member in spec:
                h = by_norm.get(norm(member))
                if not h or len(h) != 1:
                    bad.append(member)
                else:
                    parts.append(h[0][1])
            if bad:
                unmatched_roster[pre].append(
                    (a['name'], f'summed entry missing {len(bad)} of {len(spec)}: {bad[:3]}'))
                skipped += 1
                continue
            now = sum(x[0] for x in parts)
            # A MEMBER WITH NO PRIOR READING MAKES THE WHOLE PRIOR SUM UNUSABLE,
            # not smaller. Summing the members that do have one would compare a
            # group of N against a group of N-1 and report the missing member as
            # growth — the membership-change trap this block already refuses when
            # a member is absent outright. South Australia can now produce a
            # member with prev None (a department created between the two Junes),
            # so this is reachable rather than theoretical, and the alternative
            # was a TypeError taking down every jurisdiction in the run.
            prev = (None if any(x[1] is None for x in parts)
                    else sum(x[1] for x in parts))
            for member in spec:
                consumed[pre].add(norm(member))
            summed.append((a['id'], len(parts), now))
        else:
            want = norm(spec)
            hit = by_norm.get(want)
            if not hit or len(hit) != 1:
                # A RECORDED REASON BEATS "no source row". Without it the
                # same name gets researched again every pass and reaches the
                # same answer; with it the list separates what is still worth
                # looking for from what has already been settled.
                # A JURISDICTION-WIDE REASON IS PRINTED ONCE, not once per
                # card. The first version of this put the whole paragraph
                # against all 57 New South Wales cards, which is 57 copies of
                # one sentence — precisely the unreadable list the reasons were
                # added to replace.
                why = NOT_IN_SOURCE.get(f"{pre}:{a['name']}")
                if not why and pre in NOT_IN_SOURCE_JURISDICTION:
                    why = '(see the note under this list)'
                unmatched_roster[pre].append(
                    (a['name'], why or ('ambiguous' if hit else 'no source row')))
                skipped += 1
                continue
            now, prev = hit[0][1]
            consumed[pre].add(want)
        # A ROW MAY HAVE NO PRIOR YEAR, AND THAT IS NOT THE SAME AS A BAD ONE.
        # Western Australia restructured its departments in 2025: the 2025-26
        # bulletin reports a Department of Transport and Major Infrastructure
        # that the 2024-25 one has never heard of, because it was assembled
        # from parts of two others. There IS no comparator, and inventing one —
        # summing the predecessors, or reusing `now` — would manufacture a
        # change out of a machinery-of-government decision. So `prev` may be
        # None, `yoy` is then null, and the card shows the figure with no delta,
        # which is the behaviour headcountFor already has for an unknown span.
        if now <= 0 or (prev is not None and prev <= 0):
            unmatched_roster[pre].append((a['name'], f'not positive ({now}/{prev})'))
            skipped += 1
            continue
        rec = {'now': now, 'prev': prev,
               'yoy': None if prev is None else round((now - prev) / prev * 100, 1),
               'asof': asof, 'span': span}
        if unit != 'headcount':
            rec['unit'] = unit
        out[a['id']] = rec

    # NO SOURCE CAN BE FETCHED FROM EVERY ENVIRONMENT, so the file is MERGED
    # rather than rewritten. Measured 2026-09-24, and the two are opposites:
    #
    #   Queensland needs a browser and only runs on the GitHub runner, because
    #   the authoring sandbox has no Chromium that reaches the internet.
    #   Victoria answers HTTP 403 to a datacentre IP — through a browser too,
    #   13 KB of HTML — and only runs from a developer machine.
    #
    # A wholesale rewrite therefore cannot ever hold both: whichever machine
    # ran last would delete the other's jurisdictions, and every one of those
    # cards would go back to "no workforce figure collected" with nothing to
    # say why. So a run updates the jurisdictions it actually loaded and keeps
    # the rest exactly as they were.
    #
    # KEEPING ROWS IS ONLY HONEST IF STALENESS IS VISIBLE, so the header
    # records when each jurisdiction was last refreshed, and rows that were
    # kept rather than re-fetched say so.
    prev_rows, prev_meta = read_existing()
    for cid, rec in prev_rows.items():
        if jurisdiction_of(cid) not in data:   # not attempted this run — keep it
            out.setdefault(cid, rec)

    # A CARD THAT LOSES A FIGURE IT ALREADY HAD GETS SAID OUT LOUD.
    #
    # THE OBVIOUS GUARD HERE DOES NOT WORK, and writing it first is how that was
    # found. It compared each dropped row against jurisdiction_of(cid) to ask
    # whether its source had been loaded — but that is the function the bug was
    # IN, so the check inherited the blind spot and passed happily while six
    # cards vanished. A guard derived from the thing it guards cannot catch it.
    #
    # This asks a question with no derivation in it instead: did a row that had
    # a figure come out of this run without one? Measured 2026-09-25, `--only
    # nsw` did exactly that to six NSW agencies — routed to the NSW Health
    # appendix, correctly absent from it, dropped — and the run reported 343
    # agencies with no hint that six cards had gone back to an em dash.
    #
    # It PRINTS rather than raises, because a source genuinely dropping an
    # agency is legitimate and looks identical from here. The workflow reprints
    # the diagnosis last, so this lands where it will be read.
    lost = sorted(cid for cid in prev_rows if cid not in out)
    if lost:
        print(f'\n  LOST A FIGURE IT ALREADY HAD — {len(lost)} card(s). Either the '
              f'source stopped reporting them, or they were looked up in the wrong '
              f'source:', file=sys.stderr)
        for cid in lost[:20]:
            had = prev_rows[cid]
            print(f'      {cid}  (was {int(had["now"]):,} as at {had.get("asof")})',
                  file=sys.stderr)

    filled_reasons = sorted(k for k, cid in reason_key.items()
                            if k in NOT_IN_SOURCE and cid in out)
    if filled_reasons:
        print(f'\n  NOT_IN_SOURCE: {len(filled_reasons)} entries describe a card '
              f'that now HAS a figure — the reason is stale and never prints:',
              file=sys.stderr)
        for k in filled_reasons:
            print(f'      {k}  (filed: {out[reason_key[k]]["now"]:,})', file=sys.stderr)

    kept = [(lbl, m) for lbl, m in prev_meta.items() if lbl not in {x[0] for x in meta}]
    if failed:
        print(f'  not refreshed this run: {", ".join(failed)} '
              f'(previous rows kept)', file=sys.stderr)

    L = ['// GENERATED — do not edit by hand. Run scripts/gen-gov-workforce.py.',
         '// Real public-sector headcount by agency, for the jurisdictions that publish',
         '// it as open data. Western Australia is NOT here — it predates this generator',
         '// and still lives in perthGovWorkforce.ts; govHeadcount() merges the two.',
         '//',
         '// Sources, as at the run that produced this file:']
    today = __import__('datetime').date.today().isoformat()
    for label, asof, n, unit in meta:
        what = 'agencies published' if unit == 'headcount' else 'agencies published, as FTE not headcount,'
        L.append(f'//   {label}: {n} {what} as at {asof} — refreshed {today}')
    for label, line in kept:
        L.append(f'//   {label}: {line} — KEPT, not refreshed this run')
    L += ['//',
          '// An agency the source does not report is ABSENT, never zero — the card shows',
          '// an em dash and says no figure was collected. See the generator for which',
          '// jurisdictions are missing and why.',
          'import type { Headcount } from "./companyHeadcount";',
          'export const GOV_HEADCOUNT_AU: Record<string, Headcount> = {']
    for cid in sorted(out):
        v = out[cid]
        unit = f", unit: {json.dumps(v['unit'])}" if v.get('unit') else ''
        # prev is OMITTED rather than zeroed when there is no prior year. A 0
        # would read as a real reading of nobody, and check-roster's
        # "not positive" assertion would fire on a row that is perfectly good.
        prev_part = '' if v.get('prev') is None else f"prev: {int(v['prev'])}, "
        yoy_part = 'null' if v.get('yoy') is None else v['yoy']
        L.append(f"  {json.dumps(cid)}: {{ now: {int(v['now'])}, {prev_part}"
                 f"yoy: {yoy_part}, asof: {json.dumps(v['asof'])}, span: {int(v['span'])}{unit} }},")
    L += ['};', '']
    open(OUT, 'w').write('\n'.join(L))
    if summed:
        print(f'\n  summed from several source rows ({len(summed)}):', file=sys.stderr)
        for cid, n, total in summed:
            print(f'      {cid:44s} {n} rows -> {total:,}', file=sys.stderr)

    # The two lists, newest jurisdictions first. Kept on stderr with the rest of
    # the run's diagnostics so a CI log carries them.
    for pre in sorted(unmatched_roster):
        rows = unmatched_roster[pre]
        print(f'\n  {pre}: {len(rows)} roster agencies WITHOUT a figure:', file=sys.stderr)
        for name, why in sorted(rows):
            print(f'      {name[:62]:64s} {why}', file=sys.stderr)
        note = NOT_IN_SOURCE_JURISDICTION.get(pre)
        if note and any(w == '(see the note under this list)' for _n, w in rows):
            print(f'\n      NOTE for {pre}: {note}', file=sys.stderr)
    for pre in sorted(data):
        by_norm = data[pre][0]
        spare = [(k, v[0][0], v[0][1][0]) for k, v in by_norm.items()
                 if k not in consumed[pre] and len(v) == 1]

        # THE FULL SOURCE LIST, WHERE THE ANSWER IS A REFUSAL RATHER THAN AN
        # ALIAS — printed without being asked for, because the jurisdictions
        # that need it are exactly the ones that cannot ask.
        #
        # The spare list answers "what could an ALIAS point at". That is the
        # right question when a jurisdiction has rows to spare: Victoria had
        # 208 of them against 38 blank cards, and reading that list closed 18.
        # Queensland is the other shape — 22 blank cards against 5 spare rows —
        # so its remaining answers are refusals, and a refusal has to name what
        # the body sits INSIDE. That name is in the rows that DID match, which
        # the spare list by definition excludes.
        #
        # More unmatched cards than spare rows is that shape, so it triggers
        # the dump. `--dump-source` stays as an explicit override; this is what
        # makes it reachable on a branch, since workflow_dispatch inputs are
        # validated against the DEFAULT branch's copy of the workflow and a
        # newly-added input is silently dropped until it is merged.
        # TWO TRIGGERS, AND THE SECOND ONE IS WHY TASMANIA GETS ONE. More
        # unmatched cards than spare rows is the refusal shape. But a
        # jurisdiction can also have barely any spare rows in ABSOLUTE terms —
        # Tasmania has 6 cards blank against 7 spare, which passes the first
        # test and still leaves the spare list unable to answer anything,
        # because seven rows is not where a missing department is hiding. When
        # almost nothing is spare, the whole list is the only useful view.
        if (pre in dump
                or len(unmatched_roster.get(pre, [])) > len(spare)
                or (unmatched_roster.get(pre) and len(spare) < 15)):
            print(f'\n  {pre}: ALL {len(by_norm)} source rows, largest first '
                  f'({len(unmatched_roster.get(pre, []))} cards unmatched vs '
                  f'{len(spare)} spare rows):', file=sys.stderr)
            allrows = sorted(((v[0][0], v[0][1][0]) for v in by_norm.values()),
                             key=lambda x: -x[1])
            for nm, n in allrows:
                print(f'      {n:>8,}  {nm[:70]}', file=sys.stderr)

        if not spare:
            continue
        spare.sort(key=lambda x: -x[2])
        print(f'\n  {pre}: {len(spare)} SOURCE rows matched to nothing '
              f'(largest first — these are what an ALIAS points at):', file=sys.stderr)
        for _k, orig, n in spare[:40]:
            print(f'      {n:>8,}  {orig[:62]}', file=sys.stderr)
        if len(spare) > 40:
            print(f'      … and {len(spare) - 40} more', file=sys.stderr)

    print(f'wrote {OUT} with {len(out)} agencies ({skipped} roster agencies unmatched)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main() or 0)
    finally:
        close_browser()
