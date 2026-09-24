#!/usr/bin/env python3
"""ziprecruiter-to-d1.py — attribution, hub placement, salary, and the JobSpy
internals it depends on.

WHY A FIXTURE AND NOT A LIVE CALL. ZipRecruiter refuses every datacentre
address (the script's header has the measurement), so CI cannot reach it. What
CI CAN check is everything around the transport, and the transport's contract:
this drives JobSpy's own `_find_jobs_in_page` and `_process_job` with a page
shaped like the api.ziprecruiter.com response JobSpy parses, through a fake
session. If a python-jobspy bump renames a field or a method the script reads,
this fails here instead of the nightly run archiving nothing.

Each wrong answer below is invisible in the app — a Madison health-tech
startup's vacancies would just appear as Redox Ltd's hiring, a Perth, Ontario
role on the Perth pin — so the reasoning is asserted, not the output eyeballed.

Run: python scripts/test_ziprecruiter.py   (needs bun for the hub/salary checks)
"""
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0], '--dry-run', '--no-skills']

spec = importlib.util.spec_from_file_location('zr', os.path.join(HERE, 'ziprecruiter-to-d1.py'))
zr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zr)

fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        fails.append(msg)


HOU = {'id': 'houston-cop', 'name': 'ConocoPhillips', 'cities': ['houston']}
NYC = {'id': 'newyork-x', 'name': 'Example Holdings Inc.', 'cities': ['newyork']}
REDOX = {'id': 'rdx', 'name': 'Redox', 'cities': ['sydney']}
SGH = {'id': 'sgh', 'name': 'SGH', 'cities': ['perth']}
MQG = {'id': 'mqg', 'name': 'Macquarie Group', 'cities': ['sydney']}
BHP = {'id': 'bhp', 'name': 'BHP', 'cities': ['perth']}

# ── 1. attribution ───────────────────────────────────────────────────────────
check(zr.attribute(HOU, 'ConocoPhillips') == 'keep', 'NA company, exact name')
check(zr.attribute(NYC, 'Example') == 'keep', 'NA company, suffix-stripped (loose gate)')
check(zr.attribute(HOU, 'Phillips 66') is None, 'NA company, different employer')
check(zr.attribute(HOU, '') is None, 'blank advertiser is never kept')
# The named US collisions: a single-word non-NA roster name never files a row.
check(zr.attribute(REDOX, 'Redox') == 'review', 'Redox (Madison health-tech) held for review')
check(zr.attribute(SGH, 'SGH') == 'review', 'SGH (Simpson Gumpertz & Heger) held for review')
check(zr.attribute(BHP, 'BHP') == 'review', 'single-word BHP held until confirmed')
# Multi-word non-NA: full name files, the short form is only reported.
check(zr.attribute(MQG, 'Macquarie Group') == 'keep', 'non-NA full multi-word name')
check(zr.attribute(MQG, 'Macquarie') == 'review', 'non-NA short form is review, not keep')
check(zr.attribute(MQG, 'Macquarie Consulting LLC') is None, 'unrelated firm is dropped')
zr.CONFIRMED_NA['bhp'] = {'bhp'}
check(zr.attribute(BHP, 'BHP') == 'keep', 'CONFIRMED_NA is what admits a reviewed name')
zr.CONFIRMED_NA.clear()
check(zr.CONFIRMED_NA == {}, 'CONFIRMED_NA ships empty — every entry must be observed')

# The North American line of a doubly-rostered employer wins on this board.
roster = [{'id': 'chevron', 'name': 'Chevron', 'cities': ['perth']},
          {'id': 'houston-cvx', 'name': 'Chevron', 'cities': ['houston']},
          {'id': 'bhp', 'name': 'BHP', 'cities': ['perth']}]
ids = [c['id'] for c in zr.targets_from(roster)]
check(ids == ['houston-cvx', 'bhp'], f'duplicate employer resolves to its NA line: {ids}')

# ── 2. JobSpy contract, through a fake session ───────────────────────────────
API_PAGE = {'continue': 'tok-2', 'jobs': [
    {'listing_key': 'k1', 'name': 'Drilling Engineer',
     'hiring_company': {'name': 'ConocoPhillips'}, 'job_city': 'Houston',
     'job_state': 'TX', 'job_country': 'US', 'employment_type': 'full_time',
     'posted_time': '2026-09-20T10:00:00Z', 'compensation_interval': 'annual',
     'compensation_min': 120000, 'compensation_max': 150000,
     'compensation_currency': 'USD', 'job_description': '<p>x</p>'},
    {'listing_key': 'k2', 'name': 'Operator', 'hiring_company': {'name': 'ConocoPhillips'},
     'job_city': 'Perth', 'job_state': 'ON', 'job_country': 'CA',
     'employment_type': 'part_time', 'posted_time': '2026-09-21T10:00:00Z',
     'compensation_interval': 'hourly', 'compensation_min': 31, 'compensation_max': 31},
    {'listing_key': 'k3', 'name': 'Analyst', 'hiring_company': {'name': 'Phillips 66'},
     'job_city': 'Houston', 'job_state': 'TX', 'job_country': 'US',
     'employment_type': 'full_time', 'posted_time': '2026-09-22T10:00:00Z'},
]}


class FakeResp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body
        self.text = json.dumps(body) if isinstance(body, dict) else body
        self.ok = 200 <= status < 400

    def json(self):
        return self._body


def fake_session(status, body):
    calls = []

    def get(url, *a, **k):
        calls.append((url, k.get('params')))
        return FakeResp(status, body)
    return get, calls


tx = zr.Transport.__new__(zr.Transport)
tx.proxy, tx.last_status, tx.last_body = None, None, ''
from jobspy.ziprecruiter import ZipRecruiter  # noqa: E402
tx._cls = ZipRecruiter
ZipRecruiter._get_cookies = lambda self: None     # no network in a test
tx._open()
get, calls = fake_session(200, API_PAGE)
tx.z.session.get = tx._watch(get)     # the same wrapper _open() installs
posts, nxt, status = tx.page('ConocoPhillips', None)
check(status == 200, f'status is captured: {status}')
check(nxt == 'tok-2', f'continue token is passed through: {nxt}')
check(len(posts) == 3, f'three listings parsed: {len(posts)}')
check(len(calls) == 1, f'ONE request per page — no description fetch: {len(calls)} calls')
check(calls and calls[0][1].get('search') == 'ConocoPhillips',
      f'search term reaches the API: {calls[0][1] if calls else None}')
rows = [zr._row(p) for p in posts]
r1, r2, r3 = rows
check(r1['board'] == 'ConocoPhillips' and r1['state'] == 'TX' and r1['country'] == 'US',
      f'structured location read: {r1}')
check(r1['location'] == 'Houston, TX, USA', f'display location: {r1["location"]}')
check(r1['posted'] == '2026-09-20', f'posted date: {r1["posted"]}')
check(r1['url'].endswith('lvk=k1'), f'job url: {r1["url"]}')
check(r1['salary'] == 'USD 120,000 - 150,000 per year', f'annual salary: {r1["salary"]}')
check(r2['salary'] == 'CAD 31 per hour', f'currency inferred from country: {r2["salary"]}')
check(r3['salary'] is None, 'no amount, no salary string')

# A refused page is a failure, never an empty result.
get403, _ = fake_session(403, '{"error_code":"forbidden aa"}')
tx.z.session.get = tx._watch(get403)
try:
    zr.fetch(tx, 'x', None)
    check(False, 'a 403 must raise Refused, not return an empty page')
except zr.Refused as e:
    check('403' in str(e) and 'forbidden aa' in str(e),
          f'the refusal names the status and the WAF: {e}')

# A 200 that is not the API's JSON — a challenge page served with a success
# status — must also be a refusal, not an exception that ends the whole walk.


class ChallengeResp(FakeResp):
    def json(self):
        raise ValueError('Expecting value: line 1 column 1 (char 0)')


tx.z.session.get = tx._watch(lambda *a, **k: ChallengeResp(200, '<html>Just a moment...</html>'))
try:
    zr.fetch(tx, 'x', None)
    check(False, 'a non-JSON 200 must raise Refused')
except zr.Refused as e:
    check('unreadable page' in str(e), f'a non-JSON 200 is reported as unreadable: {e}')
except Exception as e:  # noqa: BLE001
    check(False, f'a non-JSON 200 escaped as {type(e).__name__} — it would end the run')

# ── 3. hubs: the North American collisions ───────────────────────────────────
try:
    subprocess.run(['bun', '--version'], capture_output=True, check=True)
    have_bun = True
except Exception:  # noqa: BLE001
    have_bun = False
    fails.append('bun is required for the hub and salary checks')

if have_bun:
    def job(city, state, country='US'):
        return {'city': city, 'state': state, 'country': country}
    cases = [
        (job('Houston', 'TX'), 'houston'),
        (job('Toronto', 'ON', 'CA'), 'toronto'),
        (job('Montréal', 'QC', 'CA'), 'montreal'),     # accent folded
        (job('Seattle', 'WA'), 'seattle'),
        (job('Washington', 'DC'), 'washington'),
        (job('Perth', 'ON', 'CA'), None),              # hubFor says perth
        (job('Sydney', 'NS', 'CA'), None),             # hubFor says sydney
        (job('Melbourne', 'FL'), None),                # hubFor says melbourne
        (job('London', 'ON', 'CA'), None),             # hubFor says london
        (job('Vancouver', 'WA'), None),                # hubFor says perth (" wa,")
        (job('Bellevue', 'WA'), None),                 # hubFor says perth (" wa,")
        (job('Portland', 'ME'), None),                 # not Portland, OR
        (job('Washington', 'PA'), None),               # not DC
    ]
    got = zr.map_hubs([c for c, _ in cases])
    for (c, want), h in zip(cases, got):
        check(h == want, f'hub for {c["city"]}, {c["state"]}: want {want}, got {h}')

    # The strings this writes must be readable by the app's salary parser, in
    # the right currency, without a hub (the case COUNTRY_BY_SOURCE can't cover).
    probe = ("import {annualAud} from './src/employsi/lib/salaryParse';"
             "const rows = JSON.parse(process.argv[1]);"
             "console.log(JSON.stringify(rows.map(s => annualAud({salary: s, hub: null, source: 'ziprecruiter'}))));")
    p = subprocess.run(['bun', '-e', probe, json.dumps([r1['salary'], r2['salary']])],
                       capture_output=True, text=True, cwd=ROOT)
    vals = json.loads(p.stdout.strip() or '[null,null]')
    check(vals[0] is not None and vals[0] > 150000,
          f'USD annual band parses (and converts up to AUD): {vals[0]}')
    check(vals[1] is not None and 50000 < vals[1] < 150000,
          f'CAD hourly rate annualises: {vals[1]}')

if fails:
    print(f'FAIL ({len(fails)}):')
    for f in fails:
        print('  -', f)
    sys.exit(1)
print('ziprecruiter: all checks pass')
