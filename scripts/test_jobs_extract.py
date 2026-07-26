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
check('SA: strategy is dom-anchors', how == 'dom-anchors', how)
if rows:
    r0 = rows[0]
    check('SA: title from anchor', r0['t'] == 'Clinical Nurse Consultant', r0['t'])
    check('SA: agency mined from block', 'SA Health' in r0['agency'], r0['agency'])
    check('SA: location mined from block', 'Adelaide' in r0['loc'], r0['loc'])
    check('SA: url absolutised', r0['url'].startswith('https://www.iworkfor.sa.gov.au/jb/job/'), r0['url'])

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

print()
if FAILS:
    print(f'{len(FAILS)} FAILED: {FAILS}')
    raise SystemExit(1)
print('All jobs_extract tests passed.')
