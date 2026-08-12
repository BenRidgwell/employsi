#!/usr/bin/env python3
"""Re-map archived rows' skills through the CURRENT taxonomy.

WHY THIS IS NEEDED AT ALL
Each row freezes its skills as JSON at scrape time. That is deliberate — it is
what lets a card show what a role was tagged as on the day it was advertised —
but it means a taxonomy FIX does not reach rows already written. They keep the
old answer until they age out, and on a card that looks like real demand.

The case this was written for: "Principal" was being read as a school
principal outside education, so "Principal Cost Management" at BHP carried
Education Leadership. Fixing the matcher corrected new rows and left 317 old
ones asserting education demand at miners, banks and transport agencies.

WHAT IT DOES NOT DO
It never invents a skill. It recomputes skillsForText for the row's own title
and writes THAT, so a row can only end up with what the current taxonomy says
about the text already in the archive. A row whose skills do not change is not
written at all.

Usage:
  python3 scripts/remap-skills.py --like '%Principal%' [--dry-run]
  python3 scripts/remap-skills.py --like '%' --limit 500
"""
from __future__ import annotations
import http.client
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

args = sys.argv[1:]
LIKE = args[args.index('--like') + 1] if '--like' in args else None
LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else 10 ** 9
DRY = '--dry-run' in args

if not LIKE:
    sys.exit('--like is required (e.g. --like "%Principal%")')
if not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit).')


def d1(sql, params=None, _tries=5):
    """One D1 query, retried on transient transport failures.

    A full remap is tens of thousands of statements over one HTTP API, and the
    far end WILL drop a connection somewhere in that many. Without a retry the
    whole run dies wherever that happens and leaves the archive half-remapped:
    measured on 2026-08-12, a run died after roughly 70 of 16,620 updates with
    `RemoteDisconnected` and reported exit 1 having silently applied those 70.

    Only transport-level failures and 429/5xx are retried. A D1 error in the
    response body (bad SQL, constraint) is not transient and raises at once.
    """
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    delay = 1.0
    for attempt in range(_tries):
        try:
            req = urllib.request.Request(API, data=body, headers={
                'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == _tries - 1:
                raise
        except (urllib.error.URLError, http.client.HTTPException, OSError):
            if attempt == _tries - 1:
                raise
        time.sleep(delay)
        delay *= 2
    if not j.get('success'):
        raise RuntimeError(j.get('errors'))
    return j['result'][0]['results']


def map_skills(titles):
    """The worker's own matcher, so a remap cannot disagree with a fresh scrape."""
    p = subprocess.run(['bun', 'run', os.path.join(HERE, 'map-skills.ts')],
                       input=json.dumps(titles).encode(), capture_output=True, timeout=300)
    if p.returncode != 0:
        sys.exit(f'map-skills failed: {p.stderr.decode()[:300]}')
    return json.loads(p.stdout.decode())


# UNMAPPED ROWS ARE INCLUDED, and excluding them was this script's biggest
# blind spot. The filter used to be `skills IS NOT NULL`, which sounds like it
# skips rows with nothing to correct — but an unmapped row stores NULL, not an
# empty array, so the clause excluded EVERY row that the matcher had never
# placed. Measured 2026-08-09: 48,594 of the archive's 131,430 rows carry NULL
# and 0 carry '[]'. Those are precisely the rows a widened taxonomy is meant to
# rescue, so a remap after adding terms reached none of them: adding "project
# officer" and "sales exec" changed 333 rows and left 362 untouched, all of them
# the ones the change was made for.
#
# The script also WRITES NULL when a row maps to nothing, so it was manufacturing
# rows it could never revisit.
rows = d1('SELECT job_key, title, company, skills FROM jobs '
          'WHERE title LIKE ? LIMIT ?', [LIKE, LIMIT])
sys.stderr.write(f'{len(rows)} rows matching {LIKE!r}\n')

fresh = map_skills([r['title'] or '' for r in rows])
changed = []
for r, sk in zip(rows, fresh):
    try:
        old = json.loads(r['skills'] or '[]')
    except Exception:
        old = []
    if sorted(map(str, old)) != sorted(sk):
        changed.append((r['job_key'], r['title'], r['company'], old, sk))

sys.stderr.write(f'{len(changed)} rows would change\n')
for k, t, c, old, new in changed[:15]:
    sys.stderr.write(f'  {c or "-"} — {t}\n      {old} -> {new}\n')
if len(changed) > 15:
    sys.stderr.write(f'  … and {len(changed) - 15} more\n')

if DRY or not changed:
    sys.exit(0)

# One statement per CHUNK, not per row. The loop here used to be
#
#     for i in range(0, len(changed), 20):
#         for k, ... in changed[i:i + 20]:
#             d1('UPDATE jobs SET skills = ? WHERE job_key = ?', ...)
#
# where the outer range() looks like batching and does nothing at all — the
# inner loop still issued one HTTP request per row. A whole-archive remap was
# therefore ~16,600 sequential round trips, which is both slow and the reason a
# single dropped connection could kill a run 70 rows in.
#
# A CASE over job_key updates the whole chunk in one statement, so the same
# remap is a few hundred requests. CHUNK is bounded by D1's parameter limit
# (100 bound variables per statement): each row costs two parameters in the
# CASE plus one in the IN list, so 25 rows is 75 and stays clear of it.
CHUNK = 25
done = 0
for i in range(0, len(changed), CHUNK):
    batch = changed[i:i + CHUNK]
    when, params = [], []
    for k, _t, _c, _old, new in batch:
        when.append('WHEN ? THEN ?')
        params += [k, json.dumps(new) if new else None]
    params += [k for k, _t, _c, _old, _n in batch]
    d1(f'UPDATE jobs SET skills = CASE job_key {" ".join(when)} END '
       f'WHERE job_key IN ({",".join("?" * len(batch))})', params)
    done += len(batch)
    if done % 2000 < CHUNK:
        sys.stderr.write(f'  … {done}/{len(changed)}\n')
sys.stderr.write(f'Updated {len(changed)} rows.\n')
