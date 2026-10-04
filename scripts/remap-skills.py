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
# SKILLS THIS RUN IS ALLOWED TO REMOVE EVEN FROM A CONTEXT-MAPPING SOURCE.
#
# keeps_old() below refuses to shrink rows whose skills were built from text the
# archive does not store. That is right when a skill stops matching because the
# script cannot see the input that produced it — and WRONG when the taxonomy has
# deliberately excepted it. The script cannot tell those apart: it sees only the
# old set and the new one, never the reason.
#
# So the caller says. Excepting "site reliability" out of Fixed Plant Maintenance
# left 98 of 208 SRE rows still filed under mining, all of them from portal-* and
# mycareersfuture, because the union rule preserved the very attribution the
# except existed to remove. Naming the skill here removes it everywhere:
#
#   python3 scripts/remap-skills.py --like '%site reliability%' \
#           --allow-remove 'Fixed Plant Maintenance'
#
# Repeatable. Safe by default: without it nothing is ever taken off those rows.
ALLOW_REMOVE = {args[i + 1] for i, a in enumerate(args) if a == '--allow-remove'}

if not LIKE:
    sys.exit('--like is required (e.g. --like "%Principal%")')
if not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN is required (needs D1 edit).')


def d1(sql, params=None, _tries=6):
    """One D1 statement, with backoff.

    THE WRITE LOOP BELOW IS RATE-LIMITED AND USED NOT TO KNOW IT. A remap of
    ~3,800 rows issued ~3,800 requests and Cloudflare answered 429 partway
    through every one of five patterns on 2026-09-29, leaving 445 rows written
    and 3,355 not. The run reported nothing: the caller piped stdout through
    `tail`, so the shell saw tail's exit status and the traceback scrolled past.

    A 429 is not a failure to report and give up on, it is a rate to respect, so
    it is retried here rather than raised. 5xx is retried too — a D1 hiccup
    mid-remap leaves the archive half-rewritten, which is worse than slow.
    """
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    delay = 1.0
    for attempt in range(_tries):
        req = urllib.request.Request(API, data=body, headers={
            'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.loads(r.read().decode())
            if not j.get('success'):
                raise RuntimeError(j.get('errors'))
            return j['result'][0]['results']
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == _tries - 1:
                raise
            # Honour Retry-After when D1 sends one; it knows better than we do.
            wait = float(e.headers.get('Retry-After') or 0) or delay
            sys.stderr.write(f'  {e.code}; waiting {wait:.0f}s\n')
            time.sleep(wait)
            delay = min(delay * 2, 30)
        except urllib.error.URLError:
            if attempt == _tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 30)


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
# SOURCES WHOSE SKILLS CANNOT BE REPRODUCED FROM THE TITLE, and which this
# script must therefore never SHRINK.
#
# A remap re-runs skillsForText over the row's own title. That is faithful only
# where the scrape used the title alone. Six source families did not:
#
#   mycareersfuture  title + the ad's own skill tags
#   nt-gov           title + section
#   tas-gov          title + category
#   vic-gov          title + occupation
#   wa-gov           title + occupation
#   portal-*         title + the employer's sector (careerSites)
#
# NONE of that extra text is stored in the jobs table, so it cannot be replayed.
# A title-only remap of those rows deletes every skill that came from it — and
# mycareersfuture alone is 48,595 rows, the archive's second-largest source.
#
# So for these the write is a UNION: new skills are added, old ones kept.
# Everywhere else the row is replaced as before, which is what the original
# 'Principal' narrowing needed. Widening still reaches every row; only the
# deletions are held back, and only where a deletion would be an artefact of
# what this script cannot see rather than a decision the taxonomy made.
def keeps_old(source):
    return (source or '').startswith('portal-') or (source or '') in {
        'mycareersfuture', 'nt-gov', 'tas-gov', 'vic-gov', 'wa-gov',
    }

rows = d1('SELECT job_key, title, company, source, skills FROM jobs '
          'WHERE title LIKE ? LIMIT ?', [LIKE, LIMIT])
sys.stderr.write(f'{len(rows)} rows matching {LIKE!r}\n')

fresh = map_skills([r['title'] or '' for r in rows])
changed = []
for r, sk in zip(rows, fresh):
    try:
        old = json.loads(r['skills'] or '[]')
    except Exception:
        old = []
    new = sk
    if keeps_old(r.get('source')):
        # Union, order-stable: everything the row already had, plus anything
        # the current taxonomy now finds in the title — minus anything this run
        # was explicitly told it may remove.
        kept = [x for x in old if x not in ALLOW_REMOVE]
        new = kept + [x for x in sk if x not in kept]
    if sorted(map(str, old)) != sorted(map(str, new)):
        changed.append((r['job_key'], r['title'], r['company'], old, new))

sys.stderr.write(f'{len(changed)} rows would change\n')
for k, t, c, old, new in changed[:15]:
    sys.stderr.write(f'  {c or "-"} — {t}\n      {old} -> {new}\n')
if len(changed) > 15:
    sys.stderr.write(f'  … and {len(changed) - 15} more\n')

if DRY or not changed:
    sys.exit(0)

# ONE STATEMENT PER BATCH, not per row. The old loop sent an UPDATE for every
# changed row, which is how a 3,800-row remap became 3,800 requests and met the
# rate limit. A CASE over the batch's job_keys does the same writes in one
# statement, so the same remap is ~40 requests. The keys are bound as parameters
# rather than interpolated, so a title's quoting cannot reach the SQL.
# 33, MEASURED, NOT CHOSEN. Each row costs three bound parameters — the key and
# the value in the CASE, and the key again in the WHERE — and D1 refuses more
# than 100 per statement with "too many SQL variables: SQLITE_ERROR". 33 rows is
# 99. Measured 2026-09-29: 50 fails, 33 passes. Raising this without re-measuring
# turns every write into a 400.
BATCH = 33
done = 0
for i in range(0, len(changed), BATCH):
    chunk = changed[i:i + BATCH]
    cases = ' '.join('WHEN ? THEN ?' for _ in chunk)
    marks = ','.join('?' for _ in chunk)
    params = []
    for k, _t, _c, _old, new in chunk:
        params += [k, json.dumps(new) if new else None]
    params += [k for k, _t, _c, _old, _n in chunk]
    d1(f'UPDATE jobs SET skills = CASE job_key {cases} END WHERE job_key IN ({marks})', params)
    done += len(chunk)
    sys.stderr.write(f'  {done}/{len(changed)}\n')
sys.stderr.write(f'Updated {len(changed)} rows.\n')
