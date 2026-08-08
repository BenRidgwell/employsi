#!/usr/bin/env python3
"""
Find the LinkedIn vanity slug for companies that do not have one yet.

WHY SEPARATE FROM linkedin-posts-to-d1.py
That script resolves slugs, but only as a side effect of collecting posts, and
only for the companies it walks — the 355-company AU roster. The Perth map holds
144 entities, 63 of them WA government agencies it never visits, so most of the
map could never acquire a slug no matter how often the nightly job ran. This
walks whatever you point it at and does nothing but resolve.

IT REUSES THE SAME RULES, LITERALLY
slug_candidates() and the attribution gate are exec'd out of
linkedin-posts-to-d1.py rather than copied, the way scripts/test_rosters.py
reads a scraper's parsing layer. Copying them would let the two drift, and the
one that matters is the gate: a slug guessed from a company name resolves to
whoever owns it, so every page fetched must NAME the company we asked for before
the slug is stored. That is the same fault class as the advertiser bug that
filed 31 Manila roles under IGO.

WHAT IT COSTS
Up to five candidates per company, one page each, and LinkedIn throttles a
repeat visitor quickly — the volume probe was blocked at the fourth request from
a plain CI address. So it is slow on purpose, it stops early on a run of
consecutive failures rather than hammering a door that has closed, and it BANKS
each slug as it finds it. A run that gets cut off keeps what it resolved.

Nothing here writes a slug it did not confirm. A company that does not resolve
is reported with the reason — no page, page belongs to someone else, or the
fetch failed — because those need opposite fixes.

Needs: CLOUDFLARE_API_TOKEN (D1 read+write), and a host LinkedIn will serve.

Run:  python scripts/resolve-linkedin-slugs.py [--city perth] [--only id1,id2]
                                               [--limit N] [--dry-run]
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
PAGE = 'https://www.linkedin.com/company/{slug}/'
PAUSE = 5                # between page fetches
GIVE_UP_AFTER = 12       # consecutive fetch failures that mean we are blocked

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

args = sys.argv[1:]


def opt(flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


ONLY_CITY = opt('--city')
ONLY_IDS = set(opt('--only').split(',')) if '--only' in args else None
LIMIT = int(opt('--limit', 10 ** 9))
DRY = '--dry-run' in args


def borrow_from_posts_scraper():
    """slug_candidates / attributed / parse_posts, from the scraper itself.

    Everything above `def d1(` is the rule layer — candidates, normalisation,
    the rebrand list and the gate — and it has no side effects, which is why it
    can be exec'd. The scraper parses argv and needs a token at import, so it
    cannot simply be imported even if its filename allowed it.
    """
    src = open(os.path.join(HERE, 'linkedin-posts-to-d1.py'), encoding='utf-8').read()
    head = src.split('def d1(')[0]
    # __file__ has to be present: the scraper's head computes HERE/ROOT from it.
    ns: dict = {'__name__': '_linkedin_rules', '__file__': os.path.join(HERE, 'linkedin-posts-to-d1.py'),
                're': re, 'os': os, 'sys': sys}
    exec(compile(head, 'linkedin-posts-to-d1.py', 'exec'), ns)  # noqa: S102 — our own source
    missing = [n for n in ('slug_candidates', 'attributed', 'parse_posts') if n not in ns]
    if missing:
        raise RuntimeError(f'linkedin-posts-to-d1.py no longer defines {missing} above d1()')
    return ns


def d1(sql: str, params: list | None = None):
    if not TOKEN:
        sys.exit('CLOUDFLARE_API_TOKEN is required (D1 read + write).')
    body = json.dumps({'sql': sql, 'params': params or []}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        raise RuntimeError(str(j.get('errors'))[:300])
    return j['result'][0]['results']


def roster() -> list[dict]:
    """{id, name, domain, city} for everything plotted, government included."""
    ts = '''
import { COMPANIES } from "../src/employsi/data/companies";
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
const cityOf = new Map<string, string>();
for (const [city, list] of Object.entries(CITY_COMPANIES as Record<string, { id: string }[]>)) {
  for (const c of list) if (!cityOf.has(c.id)) cityOf.set(c.id, city);
}
process.stdout.write(JSON.stringify(COMPANIES.map((c) => ({
  id: c.id, name: c.name, domain: (c as { domain?: string }).domain ?? "",
  city: cityOf.get(c.id) ?? "",
}))));
'''
    tmp = os.path.join(HERE, '_roster_tmp.ts')
    open(tmp, 'w').write(ts)
    try:
        p = subprocess.run(['bun', 'run', tmp], capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode != 0:
            raise RuntimeError(f'roster dump failed: {p.stderr.decode()[:300]}')
        return json.loads(p.stdout.decode())
    finally:
        os.remove(tmp)


# THE NAME GATE IS NOT ENOUGH FOR GOVERNMENT.
#
# The attribution gate asks "does this page name the company we asked for", and
# for a government agency the answer is yes for every state at once. Measured
# 2026-08-08 on the first Perth run: /department-of-education is VICTORIA'S
# (vic.gov.au/education, 115,081 followers) and /department-of-justice is
# TASMANIA'S (addressRegion "Tasmania"), and both sailed through the gate
# because their names are byte-identical to Western Australia's.
#
# So a government page must also place itself in the RIGHT jurisdiction — which
# the roster id already states: every government id is prefixed with its own
# (vic-gov-, nsw-gov-, sa-gov-, qld-gov-, nt-gov-, tas-gov-, and Perth's
# perth-gov- for WA). Two signals off the page: the structured addressRegion,
# and the agency's own description, since these bodies name their state
# constantly. A positive for the right state with no other state contradicting
# it is what passes.
#
# Getting this per-state matters more than it looks. A WA-only rule would have
# rejected every South Australian and Northern Territory agency as "not WA" —
# 76 of Adelaide's 112 entities and all 23 of Darwin's are government.
JURISDICTIONS: dict[str, tuple[str, str]] = {
    # id prefix -> (label, regex of that state's own names/domains)
    'perth-gov-': ('Western Australia', r'western australia|\bWA\b|wa\.gov\.au|perth'),
    'sa-gov-': ('South Australia', r'south australia|\bSA\b|sa\.gov\.au|adelaide'),
    'nt-gov-': ('Northern Territory', r'northern territory|\bNT\b|nt\.gov\.au|darwin'),
    'vic-gov-': ('Victoria', r'victoria|\bVIC\b|vic\.gov\.au|melbourne'),
    'nsw-gov-': ('New South Wales', r'new south wales|\bNSW\b|nsw\.gov\.au|sydney'),
    'qld-gov-': ('Queensland', r'queensland|\bQLD\b|qld\.gov\.au|brisbane'),
    'tas-gov-': ('Tasmania', r'tasmania|\bTAS\b|tas\.gov\.au|hobart'),
}
# What each state calls its own government, for the contradiction test. A page
# that names ANOTHER state's government is that state's, whatever else it says.
CLAIMS = {
    'Western Australia': r'western australian government|wa\.gov\.au',
    'South Australia': r'south australian government|sa\.gov\.au',
    'Northern Territory': r'northern territory government|nt\.gov\.au',
    'Victoria': r'victorian government|vic\.gov\.au',
    'New South Wales': r'new south wales government|nsw government|nsw\.gov\.au',
    'Queensland': r'queensland government|qld\.gov\.au',
    'Tasmania': r'tasmanian government|tas\.gov\.au',
}


def jurisdiction_ok(company_id: str, html: str) -> tuple[bool, str]:
    """(passes, why not). Only government ids are held to this."""
    hit = next(((p, v) for p, v in JURISDICTIONS.items() if company_id.startswith(p)), None)
    if not hit:
        if '-gov-' in company_id:
            # A government id whose state we cannot name must not be waved
            # through: that is how the Victorian department got in.
            return False, 'government id with no known jurisdiction prefix'
        return True, ''
    _prefix, (want, pattern) = hit
    region = (re.search(r'"addressRegion"\s*:\s*"([^"]*)"', html) or [None, ''])[1]
    desc = (re.search(r'<meta name="description" content="([^"]{0,600})', html) or [None, ''])[1]
    blob = f'{region} {desc}'
    for state, claim in CLAIMS.items():
        if state != want and re.search(claim, blob, re.I):
            return False, f'page is {state}, not {want}'
    if not re.search(pattern, blob, re.I):
        return False, f'page never places itself in {want} (region "{region[:24]}")'
    return True, ''


def fetch(slug: str) -> str | None:
    try:
        req = urllib.request.Request(PAGE.format(slug=slug), headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return '' if e.code == 404 else None   # '' = no such page, None = blocked/failed
    except Exception:
        return None


def main() -> int:
    rules = borrow_from_posts_scraper()
    have = {r['company_id'] for r in d1('SELECT company_id FROM company_slugs')}
    rows = roster()
    if ONLY_CITY:
        rows = [r for r in rows if r['city'] == ONLY_CITY]
    if ONLY_IDS:
        rows = [r for r in rows if r['id'] in ONLY_IDS]
    # Counted BEFORE --limit truncates, or a --limit 3 run reports 141 of 144
    # as "already resolved" when the real figure is 130.
    unresolved = [r for r in rows if r['id'] not in have]
    todo = unresolved[:LIMIT]
    sys.stderr.write(f'{len(rows)} plotted{" on " + ONLY_CITY if ONLY_CITY else ""} · '
                     f'{len(rows) - len(unresolved)} already resolved · '
                     f'{len(unresolved)} without a slug · {len(todo)} to try now\n')

    resolved, misses, fails = 0, [], 0
    for i, c in enumerate(todo):
        cands = rules['slug_candidates'](c['name'], c['domain'])
        sys.stderr.write(f'[{i + 1}/{len(todo)}] {c["id"]} ({c["name"][:34]})... ')
        got = None
        why = 'no candidate resolved'
        # A rejection that SAW a real page ("/x is Victoria's") is worth far
        # more than a later candidate's 404, and the loop would otherwise
        # overwrite it with whichever reason happened to come last. So a weak
        # reason never replaces a strong one.
        WEAK = ('no candidate resolved', 'no such page', 'fetch failed',
                'page served no actor name')

        def note(reason: str) -> str:
            return reason if why in WEAK else why
        for slug in cands:
            html = fetch(slug)
            time.sleep(PAUSE)
            if html is None:
                fails += 1
                why = note('fetch failed')
                if fails >= GIVE_UP_AFTER:
                    sys.stderr.write('\nStopping: too many consecutive failures — '
                                     'LinkedIn has almost certainly started refusing this '
                                     'address. Everything resolved so far is saved.\n')
                    _report(resolved, misses, todo)
                    return 0
                continue
            fails = 0
            if not html:
                why = note('no such page')
                continue
            actor, _posts = rules['parse_posts'](html)
            if not actor:
                why = note('page served no actor name')
                continue
            if not rules['attributed'](c['id'], c['name'], actor):
                why = note(f'/{slug} is "{actor[:34]}", not this company')
                continue
            ok, bad = jurisdiction_ok(c['id'], html)
            if not ok:
                why = note(f'/{slug} {bad}')
                continue
            got = (slug, actor)
            break
        if not got:
            misses.append(f'{c["id"]}: {why}')
            sys.stderr.write(why + '\n')
            continue
        slug, actor = got
        if not DRY:
            d1('''INSERT INTO company_slugs (company_id, slug, actor, confirmed)
                  VALUES (?, ?, ?, date('now'))
                  ON CONFLICT(company_id) DO UPDATE SET
                    slug = excluded.slug, actor = excluded.actor,
                    confirmed = excluded.confirmed''', [c['id'], slug, actor])
        resolved += 1
        sys.stderr.write(f'/{slug} = "{actor[:40]}"{"  (dry run)" if DRY else "  SAVED"}\n')
    _report(resolved, misses, todo)
    return 0


def _report(resolved: int, misses: list[str], todo: list[dict]) -> None:
    sys.stderr.write(f'\n{resolved} resolved, {len(misses)} unresolved of {len(todo)} tried.\n')
    for m in misses:
        sys.stderr.write(f'  {m}\n')
    if resolved and not DRY:
        sys.stderr.write('\nNow run: CLOUDFLARE_API_TOKEN=… python scripts/gen-linkedin-logos.py\n')


if __name__ == '__main__':
    raise SystemExit(main())
