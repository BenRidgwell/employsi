#!/usr/bin/env python3
"""Offline tests for scripts/jobs_extract.py against fixtures shaped like each
board's real rendering (NSW Next.js flight payload, APS Salesforce Aura action
payload, SA BigRedSky DOM table), plus negative cases.

Run: python3 scripts/test_jobs_extract.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobs_extract as jx  # noqa: E402

FAILS = []


def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ') + name + (f'  — {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


# ── NSW: Next.js flight payload (self.__next_f.push) ─────────────────────────
nsw_payload = {
    "jobs": [
        {"jobId": "123456", "jobTitle": "Senior Policy Officer",
         "organisation": "Department of Customer Service", "location": "Sydney",
         "salaryRange": "$120,859 - $133,183", "closingDate": "2026-08-14",
         "url": "/job/123456/senior-policy-officer"},
        {"jobId": "123457", "jobTitle": "Registered Nurse - Emergency",
         "organisation": "NSW Health", "location": "Newcastle",
         "closingDate": "2026-08-20"},
    ],
    "facets": [{"name": "Sydney", "count": 812}],   # must NOT be picked up
}
esc = json.dumps(json.dumps(nsw_payload))  # escaped JS string, as Next.js ships it
NSW_HTML = f'<!doctype html><html><head><title>Jobs</title></head><body>' \
           f'<script>self.__next_f.push([1,{esc}])</script></body></html>'

rows, how = jx.extract_jobs(NSW_HTML, r'/job/\d+', 'https://iworkfor.nsw.gov.au')
check('NSW: extracts from Next.js flight payload', len(rows) == 2, f'got {len(rows)} via {how}')
check('NSW: strategy is embedded-json', how == 'embedded-json', how)
if rows:
    titles = sorted(r['t'] for r in rows)
    check('NSW: titles correct', titles == ['Registered Nurse - Emergency', 'Senior Policy Officer'], str(titles))
    r0 = next((r for r in rows if r['t'] == 'Senior Policy Officer'), {})
    check('NSW: organisation mapped', r0.get('agency') == 'Department of Customer Service', r0.get('agency'))
    check('NSW: location mapped', r0.get('loc') == 'Sydney', r0.get('loc'))
    check('NSW: salary mapped', r0.get('salary', '').startswith('$120,859'), r0.get('salary'))
check('NSW: facet entry not treated as a job',
      all('812' not in str(r) for r in rows))

# ── APS: Salesforce Aura action payload ──────────────────────────────────────
aura = {"actions": [{"returnValue": {"jobs": [
    {"Id": "a0X5G000004", "Name": "APS 6 Data Analyst",
     "Agency__c": "Australian Bureau of Statistics", "Location__c": "Canberra ACT",
     "Salary__c": "$95,000 - $108,000", "CloseDate__c": "2026-08-30"},
    {"Id": "a0X5G000005", "Name": "EL1 Assistant Director, Cyber",
     "Agency__c": "Australian Signals Directorate", "Location__c": "Canberra ACT"},
]}}]}
APS_HTML = f'<html><head><title>APS Jobs</title></head><body>' \
           f'<script type="application/json">{json.dumps(aura)}</script></body></html>'
rows, how = jx.extract_jobs(APS_HTML, r'job-details', 'https://www.apsjobs.gov.au')
check('APS: extracts from Aura payload', len(rows) == 2, f'got {len(rows)} via {how}')
if rows:
    r0 = next((r for r in rows if 'Data Analyst' in r['t']), {})
    check('APS: title from Name', r0.get('t') == 'APS 6 Data Analyst', r0.get('t'))
    check('APS: agency from Agency__c', 'Bureau of Statistics' in r0.get('agency', ''), r0.get('agency'))
    check('APS: location from Location__c', 'Canberra' in r0.get('loc', ''), r0.get('loc'))

# ── SA: BigRedSky server/DOM-rendered rows (anchor fallback) ─────────────────
SA_HTML = '''<html><head><title>I Work for SA</title></head><body>
<table><tr><td>
  <a href="/jb/job/12345">Clinical Nurse Consultant</a>
  <div>Agency: SA Health</div><div>Location: Adelaide CBD</div>
  <div>Salary: $110,000</div><div>Closing: 2026-08-11</div>
</td></tr><tr><td>
  <a href="/jb/job/12346">Project Manager, Infrastructure</a>
  <div>Agency: Department for Infrastructure and Transport</div><div>Location: Adelaide</div>
</td></tr></table></body></html>'''
rows, how = jx.extract_jobs(SA_HTML, r'/jb/job/\d+', 'https://www.iworkfor.sa.gov.au')
check('SA: extracts via DOM anchors', len(rows) == 2, f'got {len(rows)} via {how}')
check('SA: resolved by a structural strategy', how in ('job-cards', 'dom-anchors'), how)
if rows:
    r0 = rows[0]
    check('SA: title from anchor', r0['t'] == 'Clinical Nurse Consultant', r0['t'])
    check('SA: agency mined from block', 'SA Health' in r0['agency'], r0['agency'])
    check('SA: location mined from block', 'Adelaide' in r0['loc'], r0['loc'])
    check('SA: url absolutised', r0['url'].startswith('https://www.iworkfor.sa.gov.au/jb/job/'), r0['url'])


# ── NSW: the REAL DOM (verbatim from the 2026-07-26 Actions diag snippet) ────
# iworkfor.nsw.gov.au is Ant Design + React SSR. Each card renders SEVERAL
# anchors to the same job, and the href is /job/<slug>-<id> — NOT /job/<digits>,
# which is why the original `/job/\d+` regex matched zero on a 1.1MB page.
# The anchor's own text is the ORGANISATION; the job title only appears in the
# aria-label ("Organization: <org> for <title>"), so a naive anchor parse would
# have archived the org as the job title.
NSW_REAL = (
    '<div class="ant-flex css-1ucs4t3 ant-flex-align-stretch ant-flex-vertical">'
    '<a aria-label="Organization: Agriculture and Biosecurity for Administration '
    'Coordinator (Wagga Wagga Agricultural Institute)" '
    'href="/job/administration-coordinator-wagga-wagga-agricultural-institute-591328">'
    '<span class="search-job-card__organization">Agriculture and Biosecurity</span></a>'
    '<a aria-label="Location: Wagga Wagga for Administration Coordinator '
    '(Wagga Wagga Agricultural Institute)" '
    'href="/job/administration-coordinator-wagga-wagga-agricultural-institute-591328">'
    '<span class="search-job-card__location">Wagga Wagga</span></a>'
    '</div>'
    '<div class="ant-flex css-1ucs4t3">'
    '<a aria-label="Organization: NSW Health for Registered Nurse" '
    'href="/job/registered-nurse-591400">'
    '<span class="search-job-card__organization">NSW Health</span></a>'
    '</div>'
)
rows, how = jx.extract_jobs(NSW_REAL, r'/job/[\w-]+', 'https://iworkfor.nsw.gov.au')
check('NSW-real: two distinct jobs (anchors grouped by href)', len(rows) == 2, f'got {len(rows)} via {how}')
if len(rows) == 2:
    r0 = rows[0]
    check('NSW-real: TITLE from aria-label (not the org anchor text)',
          r0['t'] == 'Administration Coordinator (Wagga Wagga Agricultural Institute)', r0['t'])
    check('NSW-real: organisation captured', r0['agency'] == 'Agriculture and Biosecurity', r0['agency'])
    check('NSW-real: location captured', r0['loc'] == 'Wagga Wagga', r0['loc'])
    check('NSW-real: numeric id from slug tail', r0['id'] == '591328', r0['id'])
    check('NSW-real: url absolutised', r0['url'] == 'https://iworkfor.nsw.gov.au/job/administration-coordinator-wagga-wagga-agricultural-institute-591328', r0['url'])
    check('NSW-real: second job parsed', rows[1]['t'] == 'Registered Nurse' and rows[1]['agency'] == 'NSW Health',
          f"{rows[1]['t']} / {rows[1]['agency']}")
# the old pattern must be shown to fail, so this regression stays pinned
old_rows, _ = jx.extract_jobs(NSW_REAL, r'/job/\d+', 'https://iworkfor.nsw.gov.au')
check('NSW-real: old /job/<digits> pattern finds nothing (the original bug)', len(old_rows) == 0, str(len(old_rows)))

# ── negative: a page with no jobs must yield nothing (not garbage) ───────────
EMPTY = '<html><head><title>Just a moment...</title></head><body>' \
        '<script>window.cf = {"name":"challenge","id":"x"}</script>' \
        '<a href="/about">About us</a><a href="/contact">Contact</a></body></html>'
rows, how = jx.extract_jobs(EMPTY, r'/job/\d+', 'https://example.gov.au')
check('Empty/challenge page yields no jobs', len(rows) == 0, f'got {len(rows)} via {how}: {rows[:2]}')

# ── negative: nav/menu JSON must not be mistaken for jobs ───────────────────
NAV = '<html><body><script type="application/json">' + json.dumps(
    {"nav": [{"name": "Home", "href": "/"}, {"name": "Search jobs", "href": "/jobs"}]}
) + '</script></body></html>'
rows, _ = jx.extract_jobs(NAV, r'/job/\d+')
check('Nav items are not jobs', len(rows) == 0, str(rows))

# ── negative: {id, name} is NOT a job — the bug that archived 303 nav links ──
# Verbatim shapes from the live iworkfor.nsw.gov.au flight payload (2026-08-03).
# Every one of these was archived as an NSW vacancy, because "name" is a title
# key and "id" was accepted as corroboration, so every enumerable thing in the
# payload qualified. Nothing here has an organisation, a location, a salary or a
# job-specific reference — which is exactly what tells them apart from an ad.
CHROME = '<html><body><script type="application/json">' + json.dumps({
    "menu": [
        {"id": 3, "name": "NSW Government", "href": "https://www.nsw.gov.au/"},
        {"id": 4, "name": "Accessibility", "href": "accessibility"},
        {"id": 5, "name": "Privacy and security", "href": "privacy"},
        {"id": 8, "name": "Job alerts", "href": "/dashboard?tab=job-alerts"},
    ],
    "locationFacets": [
        {"id": 5432, "name": "Sydney Region"},
        {"id": 5431, "name": "Regional NSW"},
    ],
    "categoryFacets": [
        {"id": 16251, "name": "Aboriginal Health"},
        {"id": 10336, "name": "Accounting and Financial"},
    ],
}) + '</script></body></html>'
rows, how = jx.extract_jobs(CHROME, r'/job/[a-z0-9][\w-]*', 'https://iworkfor.nsw.gov.au')
check('Nav links and filter facets are not jobs', len(rows) == 0,
      f'got {len(rows)} via {how}: {[r["t"] for r in rows][:6]}')

# …and the tightening must not cost us a real job that only has a generic title.
# One corroborating field is still enough, and a job-specific id counts where a
# bare "id" does not.
REAL = '<html><body><script type="application/json">' + json.dumps({"r": [
    {"id": 585673, "name": "On-Call Firefighter - MS3", "location": "Sydney - South"},
    {"id": 585674, "title": "Registered Nurse", "agency": "NSW Health"},
    {"id": 585675, "title": "Project Officer", "jobReference": "REQ123456"},
    {"id": 585676, "jobTitle": "Senior Policy Officer"},
]}) + '</script></body></html>'
rows, _ = jx.extract_jobs(REAL, r'/job/[a-z0-9][\w-]*')
check('a generic title with ONE real corroborating field is still a job',
      len(rows) == 4, f'got {len(rows)}: {[r["t"] for r in rows]}')

# ── diagnose() must not raise on any input ──────────────────────────────────
import io  # noqa: E402
for sample in (NSW_HTML, APS_HTML, SA_HTML, EMPTY, '', None):
    buf = io.StringIO()
    try:
        jx.diagnose(sample, 'test', buf)
        ok = True
    except Exception as e:  # noqa: BLE001
        ok = False
        print('   diagnose raised:', e)
    if not ok:
        check('diagnose robust', False)
        break
else:
    check('diagnose robust on all inputs (incl. empty/None)', True)


# ── posted-date normalisation ───────────────────────────────────────────────
# `posted` is documented as YYYY-MM-DD. SA was writing an Australian d/m/Y
# CLOSING date into it and APS the literal "Date 09 Aug 2026", so these assert
# both halves of the fix: real dates normalise, and anything else becomes ''
# rather than a guess.
DATE_CASES = [
    ('2026-08-09', '2026-08-09'),          # already ISO
    ('2026-08-09T14:22:00Z', '2026-08-09'),  # ISO with a time
    ('09/08/2026', '2026-08-09'),          # SA: day-first, as every AU board writes
    ('9-8-2026', '2026-08-09'),
    ('9/8/26', '2026-08-09'),              # two-digit year
    ('09 Aug 2026', '2026-08-09'),
    ('9 August 2026', '2026-08-09'),
    ('Aug 9, 2026', '2026-08-09'),
    ('Date 09 Aug 2026', '2026-08-09'),    # APS: the label the regex swallowed
    ('Closing Date: 09/08/2026', '2026-08-09'),
    ('Posted: 3 March 2026', '2026-03-03'),
    ('', ''),                              # nothing stated
    (None, ''),
    ('Ongoing', ''),                       # free text is NOT a date
    ('Competitive', ''),
    ('31/13/2026', ''),                    # impossible month is rejected
    ('09/08/1200', ''),                    # out of range year
]
for raw, want in DATE_CASES:
    got = jx.iso_date(raw)
    check(f'iso_date({raw!r}) -> {want!r}', got == want, f'got {got!r}')

# The whole point: a closing date must never end up in `posted`. The extractor
# keeps them in separate fields, and only `posted` is normalised.
CLOSE_ONLY = {'jobTitle': 'Senior Analyst', 'agency': 'Services Australia',
              'closingDate': '09/08/2026'}
j = jx.job_from(CLOSE_ONLY)
check('close date does not leak into posted', j['posted'] == '' and j['close'] == '09/08/2026',
      str(j))
BOTH = {'jobTitle': 'Senior Analyst', 'agency': 'Services Australia',
        'postingDate': '01/08/2026', 'closingDate': '09/08/2026'}
j = jx.job_from(BOTH)
check('posting date is taken and normalised', j['posted'] == '2026-08-01', str(j))


print()
if FAILS:
    print(f'{len(FAILS)} FAILED: {FAILS}')
    raise SystemExit(1)
print('All jobs_extract tests passed.')
