#!/usr/bin/env python3
"""Offline tests for the snapshot download retry in scripts/brightdata-to-d1.py.

WHAT THIS GUARDS. `ready` is not the same as servable. On 2026-09-21 a snapshot
that had collected 10,117 records reported ready, answered an empty list three
seconds later, and the run exited 1 having written nothing — then returned all
10,117 when re-downloaded by hand the next day. A snapshot costs real money to
collect, so a download that gives up on the first empty answer throws away a
paid-for result and reports it as a collection failure.

The retry has two halves and both matter:

  - it must RETRY when the snapshot is known to hold records, or the paid
    collection is lost;
  - it must NOT retry when Bright Data says the snapshot is empty, or a genuine
    zero-record failure takes three extra minutes to report every time.

Telling those apart depends on reading the record count out of the progress
body, which is why advertised_records() is asserted here too — including that it
returns None rather than 0 when the count is absent. A fabricated zero would
turn "we could not tell" into "there is nothing", which is the confusion that
cost a day.

No network: `bd` is stubbed and every sleep is neutralised.

Run: python3 scripts/test_brightdata_download.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The module runs argument parsing and a credential check at import. --probe
# keeps it from requiring a Cloudflare token; the Bright Data token only has to
# be non-empty because every call through it is stubbed below.
sys.argv = ['brightdata-to-d1.py', '--source', 'linkedin', '--probe']
os.environ.setdefault('BRIGHTDATA_API_TOKEN', 'test-token-not-used')
os.environ.setdefault('BRIGHTDATA_DATASET_ID_LINKEDIN', 'gd_test')

_spec = importlib.util.spec_from_file_location(
    'bd_to_d1', os.path.join(HERE, 'brightdata-to-d1.py'))
bd_to_d1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bd_to_d1)

FAILS = []


def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ') + name
          + (f'  — {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


# Nothing here should ever actually wait.
bd_to_d1.time.sleep = lambda _s: None

ROW = {'job_title': 'Engineer', 'company_name': 'Beach Energy'}


def stub(responses):
    """Serve `responses` in order, recording how many times bd() was called."""
    calls = []

    def _bd(method, path, body=None, params='', timeout=120):
        calls.append(path)
        return responses[min(len(calls) - 1, len(responses) - 1)]

    bd_to_d1.bd = _bd
    return calls


# ── advertised_records: read the count, or admit it cannot ───────────────────
print('\nadvertised_records reads the count, and reports absence as None:')
ar = bd_to_d1.advertised_records
check('plain "records"', ar({'records': 10117}) == 10117)
check('"record_count" alias', ar({'record_count': 42}) == 42)
check('digit string coerced', ar({'records': '873'}) == 873)
check('a real zero is zero, not None', ar({'records': 0}) == 0)
check('absent -> None, NOT 0', ar({'status': 'ready'}) is None,
      f'got {ar({"status": "ready"})!r}')
check('empty body -> None', ar({}) is None)
# True == 1 in Python, so a bool would sail through an int check and invent a
# record count of one out of a flag.
check('a bool is not a count', ar({'records': True}) is None,
      f'got {ar({"records": True})!r}')


# ── the retry itself ─────────────────────────────────────────────────────────
print('\ndownload retries an empty answer when records are known to exist:')
calls = stub([[], [], [ROW, ROW, ROW]])
rows = bd_to_d1.download('sd_test', {'status': 'ready', 'records': 10117})
check('recovers after two empty answers', len(rows) == 3, f'got {len(rows)}')
check('called /snapshot three times', len(calls) == 3, f'got {len(calls)}')

print('\ndownload does NOT retry a snapshot Bright Data says is empty:')
calls = stub([[], [], [ROW]])
rows = bd_to_d1.download('sd_test', {'status': 'ready', 'records': 0})
check('returns empty immediately', rows == [])
check('never called /snapshot at all', len(calls) == 0, f'got {len(calls)}')

print('\nwith no count available it retries anyway — the case we cannot judge:')
calls = stub([[], [ROW]])
rows = bd_to_d1.download('sd_test', {'status': 'ready'})
check('recovers on the second try', len(rows) == 1, f'got {len(rows)}')
check('called /snapshot twice', len(calls) == 2, f'got {len(calls)}')

print('\na persistently empty download gives up, bounded:')
calls = stub([[]])
rows = bd_to_d1.download('sd_test', {'status': 'ready', 'records': 500})
check('returns empty rather than hanging', rows == [])
check('tries exactly 1 + len(EMPTY_RETRY_WAITS) times',
      len(calls) == 1 + len(bd_to_d1.EMPTY_RETRY_WAITS), f'got {len(calls)}')

print('\nthe dict-wrapped shapes Bright Data also answers with:')
calls = stub([{'data': [ROW, ROW]}])
check('unwraps {"data": [...]}', len(bd_to_d1.download('sd_test', {})) == 2)
calls = stub([{'results': [ROW]}])
check('unwraps {"results": [...]}', len(bd_to_d1.download('sd_test', {})) == 1)
calls = stub([[ROW, 'not-a-dict', None, ROW]])
check('drops non-dict entries', len(bd_to_d1.download('sd_test', {})) == 2)

print('\nno first-attempt delay — a healthy snapshot is not slowed down:')
waits = []
bd_to_d1.time.sleep = lambda s: waits.append(s)
stub([[ROW]])
bd_to_d1.download('sd_test', {'records': 5})
check('healthy download sleeps zero times', waits == [], f'slept {waits}')

if FAILS:
    print(f'\n{len(FAILS)} check(s) failed.')
    sys.exit(1)
print('\nBright Data download retry OK.')
