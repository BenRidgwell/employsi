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
import csv, io, json, re, sys, urllib.error, urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
OUT = f'{ROOT}/src/employsi/data/govWorkforceAu.ts'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36'

# roster company name -> the name the SOURCE uses. Only where the two plainly
# describe one body; anything needing a leap is left out and stays absent.
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
            b = pw.chromium.launch(args=['--no-sandbox'])
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


def fetch(url, binary=False, via_browser=False, warm=None, expect=None):
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
    if warm:
        page = ctx.new_page()
        page.goto(warm, wait_until='domcontentloaded', timeout=90_000)
        page.wait_for_timeout(2500)   # a challenge runs after load
        page.close()
    r = ctx.request.get(url, timeout=120_000)
    b = r.body()
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
    out = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = row[0]
        if not name or not str(name).strip():
            continue
        name = str(name).strip()
        if name.lower().startswith(('total', 'whole of', 'source', 'note')):
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
        out[name] = (round(now), round(prev))
    asof = f'Mar {d_now.year}'
    if (d_now.year - d_prev.year) != 1:
        print(f'  Queensland: readings are {d_now.year - d_prev.year} years apart', file=sys.stderr)
    return out, asof, 'fte'


# key -> (label, loader, span in years). The loader returns (rows, asof, unit);
# `unit` is "headcount" everywhere but Queensland, which publishes only FTE.
SOURCES = {
    'aps': ('APS (federal)', load_aps, 1),
    'vic': ('Victoria', load_vic, 1),
    # Runs only where a browser is available — see the loader and
    # .github/workflows/qld-workforce.yml.
    'qld': ('Queensland', load_qld, 1),
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
console.log(JSON.stringify(COMPANIES.filter(c => c.sector === "Government")
  .map(c => ({ id: c.id, name: c.name }))));'''],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout)

    out, skipped = {}, 0
    for a in agencies:
        pre = 'aps' if a['id'].startswith('aps-') else a['id'].split('-gov-')[0]
        if pre not in data:
            continue
        by_norm, asof, span, unit = data[pre]
        want = norm(ALIAS.get(a['name'], a['name']))
        hit = by_norm.get(want)
        if not hit or len(hit) != 1:
            skipped += 1
            continue
        now, prev = hit[0][1]
        if now <= 0 or prev <= 0:
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
    print(f'wrote {OUT} with {len(out)} agencies ({skipped} roster agencies unmatched)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main() or 0)
    finally:
        close_browser()
