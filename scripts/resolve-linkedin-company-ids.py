#!/usr/bin/env python3
"""
Find each roster company's NUMERIC LinkedIn company id, so the JobSpy LinkedIn
walk can search by employer instead of by keyword.

WHY THE ID AND NOT THE NAME
LinkedIn's guest job search takes `f_C=<id>`, which returns only that company
page's own ads. The keyword walk it replaces was measured from a runner on
2026-09-24 across all 395 companies: 4,088 cards kept, 40,691 thrown away as a
different advertiser, and 165 companies with nothing — NAB, IAG and SEEK among
them. The same day `f_C=4509` returned 40 of 40 cards advertised by BHP, where
the keyword search had kept 40 of 100.

WHERE THE ID COMES FROM
A company's landing page (linkedin.com/company/<slug>/) is served without a
login, and its top card links to that page's own jobs as
`/jobs/<slug>-jobs-worldwide?f_C=<id>` — the exact parameter the search takes.
`urn:li:organization:<id>` on the same page is the fallback. If the two
disagree, or the fallback is ambiguous, nothing is stored.

THE PAGE HAS TO BE THIS COMPANY'S, and that is the part that can go wrong. A
slug guessed from a name belongs to whoever registered it: /woolworths is
Woolworths Holdings of South Africa. So every page passes the gates
resolve-linkedin-slugs.py uses — linkedin_slugs.attributed() (containment plus
REBRANDS, minus NOT_THIS_COMPANY) and its government jurisdiction check — AND
advertiser_matches(), the token-prefix rule the job feeds use. Containment by
itself would let a short roster name such as "Alto" take any page whose name
contains it.

Slugs are read from D1's `company_slugs` when CLOUDFLARE_API_TOKEN is set,
because those have already been confirmed; otherwise, and for companies not in
that table, it guesses with linkedin_slugs.slug_candidates().

OUTPUT: scripts/linkedin_company_ids.json, MERGED rather than rewritten, and
saved after every company. LinkedIn throttles company pages hard (the slug
resolver's volume probe was blocked at the fourth request from a plain CI
address), so a run that gets cut off keeps what it found, and a later run only
tries the companies that are missing. addressCountry is recorded with each id
so a foreign parent page stands out when someone reads the file.

Run:  python scripts/resolve-linkedin-company-ids.py [--only id1,id2]
                                                     [--limit N] [--retry]
      --retry  also re-try companies already in the file
"""
from __future__ import annotations
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import linkedin_slugs  # noqa: E402
from advertiser_match import advertiser_matches  # noqa: E402

OUT = os.path.join(HERE, 'linkedin_company_ids.json')
norm = linkedin_slugs.norm

# Roster companies whose own LinkedIn page is registered outside Australia and
# has been READ and confirmed to be them. Default-deny: add an id here only
# after looking at the page, as NOT_THIS_COMPANY's entries were.
FOREIGN_PAGE_OK: set[str] = set()
PAGE = 'https://www.linkedin.com/company/{slug}/'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
PAUSE = 4               # between page fetches
GIVE_UP_AFTER = 8       # consecutive fetch failures that mean we are blocked

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

args = sys.argv[1:]


def opt(flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


ONLY = set(opt('--only').split(',')) if '--only' in args else None
LIMIT = int(opt('--limit', 10 ** 9))
RETRY = '--retry' in args


def known_slugs() -> dict[str, str]:
    """company_id -> slug already confirmed in D1. Empty without a token."""
    if not TOKEN:
        return {}
    body = json.dumps({'sql': 'SELECT company_id, slug FROM company_slugs', 'params': []}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        raise RuntimeError(str(j.get('errors'))[:300])
    return {x['company_id']: x['slug'] for x in j['result'][0]['results']}


def roster() -> list[dict]:
    """The job roster (roster.py, what linkedin-to-d1.py walks), plus each
    company's domain from COMPANIES — the first slug candidate is built from it."""
    from roster import load_roster
    rows = load_roster()
    ts = ('import { COMPANIES } from "../src/employsi/data/companies";\n'
          'process.stdout.write(JSON.stringify(Object.fromEntries(COMPANIES.map('
          '(c) => [c.id, (c as { domain?: string }).domain ?? ""]))));\n')
    tmp = os.path.join(HERE, '_domains_tmp.ts')
    open(tmp, 'w').write(ts)
    try:
        p = subprocess.run(['bun', 'run', tmp], capture_output=True, timeout=180, cwd=ROOT)
        if p.returncode != 0:
            raise RuntimeError(f'domain dump failed: {p.stderr.decode()[:300]}')
        domains = json.loads(p.stdout.decode())
    finally:
        os.remove(tmp)
    return [{'id': c['id'], 'name': c['name'], 'domain': domains.get(c['id'], '')}
            for c in rows]


def fetch(slug: str) -> str | None:
    try:
        req = urllib.request.Request(PAGE.format(slug=slug), headers={
            'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
        with urllib.request.urlopen(req, timeout=45) as r:
            html = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return '' if e.code == 404 else None   # '' = no such page, None = blocked/failed
    except Exception:
        return None
    # An authwall is a 200 carrying a sign-in page, not the company. That is a
    # block, not an absent page, and must count toward GIVE_UP_AFTER.
    if 'authwall' in html[:5000].lower() or '/login' in html[:3000]:
        return None
    return html


def page_id(html: str) -> tuple[int | None, str]:
    """(numeric id, why not). The page's own organization urn — and nothing
    when the page carries several.

    NOT the top card's jobs link, which was the first choice until it was
    measured. On 2026-09-24 /woolworths-group's link carried f_C=31409 and its
    urn 295257; one guest search each returned ten cards of BIG W and ten of
    Woolworths Group. /national-australia-bank: 3728278 returned nothing, the
    urn 2357 returned ten NAB cards. The link can point at an affiliate's
    jobs. It is used only when the page has no urn at all."""
    urns = set(re.findall(r'urn(?::|%3A)li(?::|%3A)organization(?::|%3A)(\d+)', html))
    if len(urns) == 1:
        return int(next(iter(urns))), ''
    if urns:
        return None, f'several organization urns {sorted(urns)}'
    cta = set(re.findall(r'[?&](?:amp;)?f_C=(\d+)', html))
    if len(cta) == 1:
        return int(next(iter(cta))), ''
    return None, 'no id on the page' if not cta else f'no urn and several f_C {sorted(cta)}'


SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'


def search_advertisers(lid: int) -> list[str] | None:
    """Advertisers on the first page of an f_C search in Australia; None = failed."""
    q = urllib.parse.urlencode({'location': 'Australia', 'f_C': lid, 'start': 0})
    try:
        req = urllib.request.Request(f'{SEARCH}?{q}', headers={
            'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
        with urllib.request.urlopen(req, timeout=45) as r:
            html = r.read().decode('utf-8', 'replace')
    except Exception:
        return None
    return [linkedin_slugs.unescape_all(a).strip() for a in re.findall(
        r'base-search-card__subtitle">\s*<a[^>]*>\s*([^<]+?)\s*<', html)]


def load() -> dict:
    try:
        with open(OUT) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(data: dict) -> None:
    tmp = OUT + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(dict(sorted(data.items())), f, indent=1, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, OUT)


def main() -> int:
    data = load()
    slugs = known_slugs()
    rows = [r for r in roster() if not ONLY or r['id'] in ONLY]
    todo = [r for r in rows if RETRY or r['id'] not in data][:LIMIT]
    sys.stderr.write(f'{len(rows)} companies · {sum(r["id"] in data for r in rows)} already '
                     f'in {os.path.basename(OUT)} · {len(slugs)} confirmed slugs from D1 · '
                     f'{len(todo)} to try\n')
    today = datetime.date.today().isoformat()
    found, misses, fails = 0, [], 0
    for i, c in enumerate(todo):
        cands = linkedin_slugs.slug_candidates(c['name'], c['domain'])
        if c['id'] in slugs:
            cands = [slugs[c['id']]] + [s for s in cands if s != slugs[c['id']]]
        sys.stderr.write(f'[{i + 1}/{len(todo)}] {c["id"]} ({c["name"][:34]})... ')
        got, why = None, 'no candidate resolved'
        for slug in cands:
            html = fetch(slug)
            time.sleep(PAUSE)
            if html is None:
                fails += 1
                why = 'fetch failed or authwalled'
                if fails >= GIVE_UP_AFTER:
                    sys.stderr.write(f'\nStopping: {fails} consecutive failures — LinkedIn '
                                     f'is refusing this address. {found} saved this run.\n')
                    _report(found, misses)
                    return 3
                continue
            fails = 0
            if not html:
                continue
            actor, _src = linkedin_slugs.page_actor(html)
            if not actor:
                why = f'/{slug} served no name'
                continue
            renamed = linkedin_slugs.norm(actor) in linkedin_slugs.REBRANDS.get(c['id'], ())
            if not linkedin_slugs.attributed(c['id'], c['name'], actor) or not (
                    renamed or advertiser_matches(actor, c['name'])):
                why = f'/{slug} is "{actor[:40]}"'
                continue
            ok, bad = _jurisdiction_ok(c['id'], html)
            if not ok:
                why = f'/{slug} {bad}'
                continue
            # AN AUSTRALIAN ROSTER GETS AUSTRALIAN PAGES. Measured on the first
            # run, 2026-09-24: /woodside is "Woodside", registered in India, and
            # /alto is "Alto", registered in Britain. Both pass every name gate —
            # Woodside Energy's brand IS Woodside — and both would have filed
            # another company's hiring on the card. A blank country is let
            # through to the search check below, which is the stronger test.
            country = (re.search(r'"addressCountry"\s*:\s*"([^"]*)"', html) or [None, ''])[1]
            if country and country != 'AU' and c['id'] not in FOREIGN_PAGE_OK:
                why = f'/{slug} is "{actor[:30]}", registered in {country}'
                continue
            lid, bad = page_id(html)
            if lid is None:
                why = f'/{slug} {bad}'
                continue
            # THE ID HAS TO RETURN THIS COMPANY'S ADS, checked by asking. This
            # is what caught the BIG W id on Woolworths' page; a page gate can
            # only say the page is right, not that the number is.
            ads = search_advertisers(lid)
            time.sleep(PAUSE)
            if ads is None:
                why = f'/{slug} = {lid}, but the check search failed'
                continue
            ours = [a for a in ads if norm(a) in (norm(actor), norm(c['name']))
                    or advertiser_matches(a, c['name']) or advertiser_matches(a, actor)]
            if ads and len(ours) * 2 < len(ads):
                why = (f'/{slug} = {lid}, but its search returns '
                       f'{sorted(set(ads) - set(ours))[:3]}')
                continue
            # NO COUNTRY AND NO ADS IS NOTHING CONFIRMED. The first full run
            # took /beach-energy-limited, "BEACH ENERGY LIMITED" in capitals, no
            # addressCountry, zero cards: the shape of a page LinkedIn generated
            # from a registry, not one the company runs. Its id would search an
            # empty page forever and read as "Beach posts nothing".
            if not country and not ads:
                why = f'/{slug} = {lid} has no country and no ads — unclaimed page?'
                continue
            got = {'ids': [lid], 'slug': slug, 'page': actor, 'country': country,
                   'cards': len(ads), 'confirmed': today}
            break
        if not got:
            misses.append(f'{c["id"]}: {why}')
            sys.stderr.write(why + '\n')
            continue
        data[c['id']] = got
        save(data)
        found += 1
        sys.stderr.write(f'/{got["slug"]} = {got["ids"][0]} "{got["page"][:30]}" '
                         f'{got["country"]} · {got["cards"]} cards on the check\n')
    _report(found, misses)
    return 0


def _jurisdiction_ok(company_id: str, html: str) -> tuple[bool, str]:
    # The government check lives in resolve-linkedin-slugs.py, whose hyphenated
    # name cannot be imported; load it by path rather than copy it, so the
    # measured cases it encodes (/department-of-education is Victoria's) stay
    # in one place.
    global _slug_resolver
    if '_slug_resolver' not in globals():
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'resolve_linkedin_slugs', os.path.join(HERE, 'resolve-linkedin-slugs.py'))
        mod = importlib.util.module_from_spec(spec)
        saved = sys.argv
        sys.argv = [sys.argv[0]]   # its module-level flag parsing reads argv
        try:
            spec.loader.exec_module(mod)
        finally:
            sys.argv = saved
        _slug_resolver = mod
    return _slug_resolver.jurisdiction_ok(company_id, html)


def _report(found: int, misses: list[str]) -> None:
    sys.stderr.write(f'\n{found} resolved this run, {len(misses)} unresolved.\n')
    for m in misses:
        sys.stderr.write(f'  {m}\n')


if __name__ == '__main__':
    raise SystemExit(main())
