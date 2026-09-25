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
            # network through a proxy whose CA Chromium does not trust. That is
            # not worked around here — launching with certificate errors
            # ignored would turn off verification for every page the scraper
            # reads. These four stay runner-only, as gov-workforce.yml already
            # has them; what changes is that the error now names the real
            # blocker. On a runner the glob finds whatever playwright installed,
            # and an empty glob falls through to the default launch.
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
                while 'Just a moment' in page.content() and w < 30_000:
                    page.wait_for_timeout(3000)
                    w += 3000
            page.goto(url, wait_until='domcontentloaded', timeout=120_000)
            w = 0
            while 'Just a moment' in page.content() and w < 30_000:
                page.wait_for_timeout(3000)
                w += 3000
            page.wait_for_timeout(2000)
            html = page.content()
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
        while 'Just a moment' in page.content() and w < 30_000:
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
    if r.status != 200 or b[:200].find(b'Just a moment') >= 0:
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
                while 'Just a moment' in page.content() and w < 30_000:
                    page.wait_for_timeout(3000)
                    w += 3000
                html = page.content()
                if 'Just a moment' not in html:
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
NOT_IN_SOURCE = {
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
    'vic:Workforce Inspectorate Victoria':
        "the source has 'Wage Inspectorate Victoria' (66) and nothing named "
        'Workforce Inspectorate. Whether that is a rename is not established '
        'here, and a score would have taken it — the AFL/AFL Sports Ready trap',
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
        for k, v in re.findall(r'(\w+): ("(?:[^"]*)"|-?[\d.]+)', m.group(2)):
            body[k] = v.strip('"') if v.startswith('"') else float(v)
        rows[m.group(1)] = body
    meta = {}
    for m in re.finditer(r'^//   ([^:]+): (.+?)(?: — (?:refreshed|KEPT).*)?$', txt, re.M):
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
    # Urban Development reads "- - 323 338" — and those are skipped rather than
    # read as zero.
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
                if not prev_hc[0].isdigit() or not now_hc[0].isdigit():
                    continue                      # did not exist in one period
                out.setdefault(name, (int(now_hc.replace(',', '')),
                                      int(prev_hc.replace(',', ''))))
    return out, f'Jun {year}', 'headcount'


# ── New South Wales ─────────────────────────────────────────────────────────
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
    "Paid Headcount as at 30 June <year>", with columns Fixed-term, Permanent,
    Part 6 and Total. It is a HEAD COUNT, unlike the NT's FTE, and is marked so.

    TWO EDITIONS ARE FETCHED, because one holds a single date. The reports are
    numbered within a year — No. 1 is the December half, No. 2 the June half —
    so a June-to-June comparison is this year's No. 2 against last year's. A
    December edition is never compared with a June one: that is six months, and
    the whole point of `span` is that a change is only reported over the period
    it was actually measured.
    """
    import io as _io
    import pdfplumber

    # THE SITEMAP, NOT THE SEARCH PAGE. The search returned four reports and
    # only one of them was a June edition, so no year-on-year could be built
    # from it — not because Tasmania publishes one, but because a search page
    # shows what it feels like showing. The sitemap is the site's own list and
    # carries every edition it still serves.
    found = []
    for src, kind in ((TAS_SITEMAP, 'sitemap'), (TAS_SEARCH, 'search')):
        page = fetch(src, via_browser=True, warm=TAS_WARM)
        hits = re.findall(r'(?:href="|<loc>\s*)([^"<\s]*State-Service-Workforce-Report[^"<\s]*\.pdf)',
                          page, re.I)
        found += [u if u.startswith('http') else 'https://www.dpac.tas.gov.au' + u for u in hits]
        if len(found) >= 4:
            break
    editions = {}
    for u in dict.fromkeys(found):
        m = re.search(r'Number-(\d+)-(\d{4})', u, re.I)
        if m:
            editions[(int(m.group(2)), int(m.group(1)))] = u

    # PAIR LIKE WITH LIKE. No. 1 is the December half and No. 2 the June half,
    # so a pair must share a report number and be one year apart. Comparing a
    # December edition with a June one is six months wearing a year's label,
    # which is the whole reason `span` exists.
    pair = None
    for (yr, no) in sorted(editions, reverse=True):
        if (yr - 1, no) in editions:
            pair = ((yr, no), (yr - 1, no))
            break
    if not pair:
        raise RuntimeError(f'TAS: no two editions of the same number a year apart, '
                           f'found {sorted(editions)}')
    june = [pair[0], pair[1]]

    def agencies(url):
        blob = fetch(url, binary=True, via_browser=True, warm=TAS_WARM)
        out = {}
        with pdfplumber.open(_io.BytesIO(blob)) as pdf:
            for pg in pdf.pages:
                txt = pg.extract_text() or ''
                if 'Employees by Agency' not in txt:
                    continue
                for line in txt.split('\n'):
                    # "<name> <fixed> <permanent> <part6> <total>" — the TOTAL
                    # is the last number, and the three before it sum to it.
                    # Checking that sum is what tells a real row from a line of
                    # prose that happens to end in numbers.
                    m = re.match(r'^\s*([A-Za-z][^0-9]{4,}?)\s+'
                                 r'([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$', line)
                    if not m:
                        continue
                    name = m.group(1).strip()
                    n = [int(x.replace(',', '')) for x in m.groups()[1:]]
                    if sum(n[:3]) != n[3] or n[3] <= 0:
                        continue
                    out[name] = n[3]
        return out

    now_rows = agencies(editions[june[0]])
    prev_rows = agencies(editions[june[1]])
    if not now_rows:
        raise RuntimeError(f'TAS: parsed no agency rows from {editions[june[0]]}')
    span = june[0][0] - june[1][0]
    if span != 1:
        raise RuntimeError(f'TAS: editions are {span} years apart, not one '
                           f'({june[0]} vs {june[1]})')
    rows = {k: (v, prev_rows[k]) for k, v in now_rows.items()
            if prev_rows.get(k, 0) > 0}
    month = 'Jun' if june[0][1] == 2 else 'Dec'
    return rows, f'{month} {june[0][0]}', 'headcount'



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
    # A SEPARATE SOURCE FROM `nz` ON PURPOSE, not a few more rows on it. The
    # PSC publishes FTE and Health NZ publishes a head count, and one `unit`
    # is carried per source — merging them would label 11,473 people as FTE on
    # the card and put them in the same tile as figures they cannot be added
    # to. Same reason Queensland and NSW health are kept apart.
    'nzhealth': ('New Zealand health', load_healthnz, 1),
}


def main():
    only = None
    if '--only' in sys.argv:
        only = {k.strip() for k in sys.argv[sys.argv.index('--only') + 1].split(',') if k.strip()}

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
        if a['id'].startswith('aps-'):
            pre = 'aps'
        elif a['id'].startswith(('nz-health-new-zealand', 'nz-northern-regional-alliance')):
            # THE NORTHERN REGIONAL ALLIANCE IS DELIBERATELY SENT TO A SOURCE
            # THAT CANNOT FILL IT, so the run says so in the right place. Since
            # September 2024 the report folds NRA into a combined "National
            # Payrolls" row with seven other agencies — its people are in the
            # 4,614, not absent from it, and no row anywhere names NRA. Routed
            # to `nz` instead it would come back unmatched against the Public
            # Service Commission, which never covered it either and would read
            # as the wrong reason for the right answer.
            # Health NZ's districts go to their own source, which is a head
            # count where the PSC's is FTE. Routing them to `nz` would look up
            # names that are not in it and then label the miss as the PSC's.
            pre = 'nzhealth'
        elif a['id'].startswith('nz-'):
            pre = 'nz'
        else:
            pre = a['id'].split('-gov-')[0]
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
            prev = sum(x[1] for x in parts)
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
                why = NOT_IN_SOURCE.get(f"{pre}:{a['name']}")
                unmatched_roster[pre].append(
                    (a['name'], why or ('ambiguous' if hit else 'no source row')))
                skipped += 1
                continue
            now, prev = hit[0][1]
            consumed[pre].add(want)
        if now <= 0 or prev <= 0:
            unmatched_roster[pre].append((a['name'], f'not positive ({now}/{prev})'))
            skipped += 1
            continue
        rec = {'now': now, 'prev': prev,
               'yoy': round((now - prev) / prev * 100, 1),
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
        pre = 'aps' if cid.startswith('aps-') else cid.split('-gov-')[0]
        if pre not in data:          # not attempted this run — keep it
            out.setdefault(cid, rec)
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
        L.append(f"  {json.dumps(cid)}: {{ now: {int(v['now'])}, prev: {int(v['prev'])}, "
                 f"yoy: {v['yoy']}, asof: {json.dumps(v['asof'])}, span: {int(v['span'])}{unit} }},")
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
    for pre in sorted(data):
        by_norm = data[pre][0]
        spare = [(k, v[0][0], v[0][1][0]) for k, v in by_norm.items()
                 if k not in consumed[pre] and len(v) == 1]
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
