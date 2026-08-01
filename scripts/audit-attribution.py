#!/usr/bin/env python3
"""Archive rows whose advertiser has no relationship to the company they are filed under.

The standing audit behind the advertiser filters. Every keyword-driven feed
guesses which company an ad belongs to, and a wrong guess does not look wrong
on a card — it looks like demand. This groups the whole archive and re-tests
each group against the rule the feeds now use.

Report-only unless --purge. Groups by (source, company_id, company) and asks
whether the archived advertiser name plausibly IS the roster company. Three
verdicts:

  ok        token-prefix match either way, extras are corporate qualifiers
  loose     the roster name appears as a whole token run inside the advertiser
            (e.g. "Woolworths Group Ltd" for "Woolworths") — accepted
  SUBSTR    the roster name appears only INSIDE a word ("igo" in "Indigo") —
            this is the bug
  UNRELATED no relationship at all
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOKEN = os.environ['CLOUDFLARE_API_TOKEN']
API = ('https://api.cloudflare.com/client/v4/accounts/080a66721e2d85950d9d7dc939e08b76'
       '/d1/database/1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1/query')
PURGE = '--purge' in sys.argv[1:]

sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import advertiser_match as js


def d1(sql, params=None):
    b = json.dumps({'sql': sql, 'params': params or []}).encode()
    r = urllib.request.Request(API, data=b, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    j = json.loads(urllib.request.urlopen(r, timeout=90).read())
    if not j.get('success'):
        raise RuntimeError(j.get('errors'))
    return j['result'][0]['results']


p = subprocess.run(['bun', 'run', os.path.join(ROOT, 'scripts/roster.ts'), '--with-cities'],
                   capture_output=True, timeout=180, cwd=ROOT)
name_of = {c['id']: c['name'] for c in json.loads(p.stdout.decode())}

rows = d1("SELECT source, company_id, company, COUNT(*) AS n FROM jobs "
          "WHERE company_id IS NOT NULL AND company IS NOT NULL AND company <> '' "
          "GROUP BY source, company_id, company")


def verdict(adv, roster):
    a, n = js.norm(adv), js.norm(roster)
    if not a or not n:
        return 'UNRELATED'
    if js.advertiser_matches(adv, roster):
        return 'ok'
    # Whole-token run: the roster name's tokens appear consecutively in the
    # advertiser, on word boundaries. "Woolworths Group Ltd" for "Woolworths".
    if re.search(r'(?<![a-z0-9])' + re.escape(n) + r'(?![a-z0-9])', a):
        return 'loose'
    if n in a:  # inside a word: the Indigo/igo failure
        return 'SUBSTR'
    return 'UNRELATED'


buckets = {}
for r in rows:
    cid, adv, n, src = r['company_id'], r['company'], r['n'], r['source']
    roster = name_of.get(cid)
    v = 'NO-ROSTER-ID' if not roster else verdict(adv, roster)
    buckets.setdefault(v, []).append((src, cid, adv, roster, n))

for v in ('ok', 'loose', 'SUBSTR', 'UNRELATED', 'NO-ROSTER-ID'):
    g = buckets.get(v, [])
    print(f'{v:14} {len(g):5} groups  {sum(x[4] for x in g):7} rows')

print('\n--- SUBSTR (roster name only inside a word) ---')
for src, cid, adv, roster, n in sorted(buckets.get('SUBSTR', []), key=lambda x: -x[4]):
    print(f'  {n:5}  {src:14} {cid:26} {adv!r} != {roster!r}')

print('\n--- UNRELATED, top 60 by rows ---')
for src, cid, adv, roster, n in sorted(buckets.get('UNRELATED', []), key=lambda x: -x[4])[:60]:
    print(f'  {n:5}  {src:14} {cid:26} {adv!r} != {roster!r}')

if PURGE:
    targets = buckets.get('SUBSTR', [])
    done = 0
    for src, cid, adv, roster, n in targets:
        d1('DELETE FROM jobs WHERE source = ? AND company_id = ? AND company = ?',
           [src, cid, adv])
        done += n
    print(f'\nDeleted {done} rows across {len(targets)} groups.')
