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
import json
import os
import subprocess
import sys
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


def d1(sql, params=None):
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        j = json.loads(r.read().decode())
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


rows = d1('SELECT job_key, title, company, skills FROM jobs '
          'WHERE skills IS NOT NULL AND title LIKE ? LIMIT ?', [LIKE, LIMIT])
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

for i in range(0, len(changed), 20):
    for k, _t, _c, _old, new in changed[i:i + 20]:
        d1('UPDATE jobs SET skills = ? WHERE job_key = ?',
           [json.dumps(new) if new else None, k])
sys.stderr.write(f'Updated {len(changed)} rows.\n')
