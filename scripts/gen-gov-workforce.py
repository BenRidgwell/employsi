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
import csv, io, json, re, sys, urllib.request

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


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        b = r.read()
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
        return {}, None
    _, asof, url = best
    wb = openpyxl.load_workbook(io.BytesIO(fetch(url, True)), read_only=True, data_only=True)
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
    return out, f'Dec {y_now}' if 'December' in asof else f'{asof.split()[-1]}'


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
        return {}, None
    now_y, prev_y = sorted(years, reverse=True)[:2]

    def read(url):
        raw = fetch(url, True)
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
    return {k: (a[k], b[k]) for k in a if k in b}, f'Jun {now_y}'


SOURCES = {
    'aps': ('APS (federal)', load_aps, 1),
    'vic': ('Victoria', load_vic, 1),
}


def main():
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]

    # The roster, read straight out of the app so the ids cannot drift.
    src = open(f'{ROOT}/src/employsi/data/companies.ts').read()
    data, meta = {}, []
    for key, (label, load, span) in SOURCES.items():
        if only and key != only:
            continue
        rows, asof = load()
        if not rows:
            print(f'  {label}: nothing loaded', file=sys.stderr)
            continue
        by_norm = {}
        for name, v in rows.items():
            by_norm.setdefault(norm(name), []).append((name, v))
        meta.append((label, asof, len(rows)))
        print(f'  {label}: {len(rows)} source rows, as at {asof}', file=sys.stderr)
        data[key] = (by_norm, asof, span)

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
        by_norm, asof, span = data[pre]
        want = norm(ALIAS.get(a['name'], a['name']))
        hit = by_norm.get(want)
        if not hit or len(hit) != 1:
            skipped += 1
            continue
        now, prev = hit[0][1]
        if now <= 0 or prev <= 0:
            skipped += 1
            continue
        out[a['id']] = {'now': now, 'prev': prev,
                        'yoy': round((now - prev) / prev * 100, 1),
                        'asof': asof, 'span': span}

    L = ['// GENERATED — do not edit by hand. Run scripts/gen-gov-workforce.py.',
         '// Real public-sector headcount by agency, for the jurisdictions that publish',
         '// it as open data. Western Australia is NOT here — it predates this generator',
         '// and still lives in perthGovWorkforce.ts; govHeadcount() merges the two.',
         '//',
         '// Sources, as at the run that produced this file:']
    for label, asof, n in meta:
        L.append(f'//   {label}: {n} agencies published, as at {asof}')
    L += ['//',
          '// An agency the source does not report is ABSENT, never zero — the card shows',
          '// an em dash and says no figure was collected. See the generator for which',
          '// jurisdictions are missing and why.',
          'import type { Headcount } from "./companyHeadcount";',
          'export const GOV_HEADCOUNT_AU: Record<string, Headcount> = {']
    for cid in sorted(out):
        v = out[cid]
        L.append(f"  {json.dumps(cid)}: {{ now: {v['now']}, prev: {v['prev']}, "
                 f"yoy: {v['yoy']}, asof: {json.dumps(v['asof'])}, span: {v['span']} }},")
    L += ['};', '']
    open(OUT, 'w').write('\n'.join(L))
    print(f'wrote {OUT} with {len(out)} agencies ({skipped} roster agencies unmatched)')


if __name__ == '__main__':
    main()
