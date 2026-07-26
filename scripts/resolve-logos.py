#!/usr/bin/env python3
"""Resolve real primary domains for the entities whose logo would otherwise be
blank — the Perth WA government agencies and the Top-150 private companies — and
write them to src/employsi/data/resolvedDomains.ts.

Why: the card/marker logo is the Google favicon service keyed on each company's
`domain`. Listed companies carry hand-verified domains, so their logos show; the
gov agencies + private companies fall back to deriveDomain()'s name→'.com' guess,
which is usually wrong, so the favicon comes back as the blank default globe.

How (automatic + honest):
  • Private companies → Clearbit's autocomplete (name → real indexed domain),
    with query-simplification retries for the ones that miss first time.
  • WA gov agencies → Clearbit doesn't index them, so a curated *.wa.gov.au seed
    supplies the ones we're confident about.
  • EVERY candidate domain is then verified against the favicon service: we only
    keep it if its favicon differs from the known blank-globe default (so we never
    write a domain that would still show no logo, and never a wrong brand mark
    that at least happens to have *a* favicon is caught by name check first).

deriveDomain() consults the generated RESOLVED_DOMAINS (keyed by the same
normalised name it uses) before its heuristic, so logos populate automatically.

Usage: python3 scripts/resolve-logos.py
Re-run any time to refresh / extend coverage.
"""
from __future__ import annotations
import hashlib, json, re, sys, time, urllib.parse, urllib.request

ROOT = __file__.rsplit('/scripts/', 1)[0]
PRIV = f'{ROOT}/src/employsi/data/topPrivateCompanies.ts'
PGOV = f'{ROOT}/src/employsi/data/perthGov.ts'
OUT = f'{ROOT}/src/employsi/data/resolvedDomains.ts'

# The favicon md5 the service returns for a domain with no real favicon — the
# blank globe. Any candidate whose favicon matches this is treated as "no logo".
DEFAULT_FAVICON_MD5 = 'b8a0bf372c762e966cc99ede8682bc71'

UA = 'employsi-logo-resolver/1.0'


def norm_key(name: str) -> str:
    """Match deriveDomain()'s key: lowercase, drop (parentheticals), collapse ws."""
    return re.sub(r'\s+', ' ', re.sub(r'\([^)]*\)', '', name.lower())).strip()


def get(url: str, timeout=8):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clearbit(query: str):
    url = 'https://autocomplete.clearbit.com/v1/companies/suggest?query=' + urllib.parse.quote(query)
    for attempt in range(2):
        try:
            return json.loads(get(url).decode('utf-8', 'replace'))
        except Exception:
            time.sleep(1)
    return []


def favicon_md5(domain: str):
    url = f'https://www.google.com/s2/favicons?domain={domain}&sz=64'
    try:
        return hashlib.md5(get(url)).hexdigest()
    except Exception:
        return None


def has_real_favicon(domain: str) -> bool:
    m = favicon_md5(domain)
    return bool(m) and m != DEFAULT_FAVICON_MD5


AU_TLDS = ('.com.au', '.net.au', '.org.au', '.gov.au', '.edu.au', '.au')
GENERIC_TLDS = ('.com', '.net', '.org', '.co')
STOP = {'group', 'holdings', 'ltd', 'pty', 'limited', 'the', 'of', 'and', 'company',
        'co', 'australia', 'australian', 'au', 'services', 'international'}
# Foreign country-code TLDs an Australian company/agency won't be on — reject
# outright (this is what let ABN→abnamro.nl and AKD→akdeniz.edu.tr slip through).
FOREIGN = re.compile(r'\.(nl|tr|re|de|fr|cn|in|it|es|br|ru|pl|se|no|fi|dk|be|at|ch|jp|kr|za|mx|ar|nz|us|uk|ca|ie|edu\.[a-z]{2})$')


def name_match(name: str, dom: str) -> bool:
    stem = dom.split('.')[0].replace('-', '')
    toks = [t for t in re.findall(r'[a-z0-9]+', name.lower()) if t not in STOP and len(t) >= 2]
    if not toks:
        return False
    longest = max(toks, key=len)
    acro = ''.join(t[0] for t in toks)
    au = dom.endswith(AU_TLDS)
    # Short-acronym companies (no token ≥4): only trust an AU-TLD hit whose stem
    # is/*starts with* the acronym — foreign or generic .com matches are too risky.
    if len(longest) <= 3:
        return au and (stem == acro or stem.startswith(acro))
    # Otherwise the domain stem must contain the longest significant token …
    if longest not in stem:
        return False
    # … and be either an AU TLD or a plain generic (never a foreign ccTLD).
    return au or dom.endswith(GENERIC_TLDS)


def pick_domain(name: str, results: list[dict]) -> str | None:
    """Best Clearbit hit for an Australian entity: foreign TLDs rejected, strong
    name match required, AU TLDs preferred, shortest stem as a tiebreak."""
    cands = [(r.get('domain') or '').lower() for r in results if r.get('domain')]
    cands = [d for d in cands if not FOREIGN.search(d) and name_match(name, d)]
    if not cands:
        return None
    cands.sort(key=lambda d: (not d.endswith(AU_TLDS), len(d)))
    return cands[0]


def resolve_private(name: str) -> str | None:
    # try the full name, then progressively simplified queries
    base = re.sub(r'\([^)]*\)', '', name).strip()
    variants = [base]
    trimmed = re.sub(r'\b(group|holdings|ltd|pty|limited|company|co|of wa|of western australia)\b', '',
                     base, flags=re.I).strip()
    trimmed = re.sub(r'\s+', ' ', trimmed)
    if trimmed and trimmed.lower() != base.lower():
        variants.append(trimmed)
    seen = set()
    for q in variants:
        if q.lower() in seen:
            continue
        seen.add(q.lower())
        # Trust the strict matcher (Clearbit only returns real, live domains); the
        # favicon round-trip per candidate was too slow and the matcher already
        # rejects foreign/wrong-brand hits. Seeds are still favicon-verified.
        dom = pick_domain(name, clearbit(q))
        if dom:
            return dom
    return None


# Curated WA government domains (Clearbit doesn't index gov agencies). Keyed by
# normalised agency name. Only the ones we're confident about — anything omitted
# stays logo-less rather than risk a wrong mark. Favicon-verified below.
WA_GOV_SEED = {
    'central regional tafe': 'centralregionaltafe.wa.edu.au',
    'chemcentre': 'chemcentre.wa.gov.au',
    'child and adolescent health service': 'cahs.health.wa.gov.au',
    'construction training fund': 'ctf.wa.gov.au',
    'corruption and crime commission': 'ccc.wa.gov.au',
    'department of biodiversity, conservation and attractions': 'dbca.wa.gov.au',
    'department of communities': 'wa.gov.au',
    'department of education': 'education.wa.gov.au',
    'department of fire & emergency services': 'dfes.wa.gov.au',
    'department of health': 'health.wa.gov.au',
    'department of justice': 'justice.wa.gov.au',
    'department of mines, petroleum and exploration': 'demirs.wa.gov.au',
    'department of planning, lands and heritage': 'dplh.wa.gov.au',
    'department of primary industries and regional development': 'dpird.wa.gov.au',
    'department of training and workforce development': 'dtwd.wa.gov.au',
    'department of the premier and cabinet': 'dpc.wa.gov.au',
    'department of transport and major infrastructure': 'transport.wa.gov.au',
    'department of treasury and finance': 'treasury.wa.gov.au',
    'department of water and environmental regulation': 'dwer.wa.gov.au',
    'main roads western australia': 'mainroads.wa.gov.au',
    'mental health commission': 'mhc.wa.gov.au',
    'north regional tafe': 'northregionaltafe.wa.edu.au',
    'legal practice board': 'lpbwa.org.au',
    'insurance commission of western australia': 'icwa.wa.gov.au',
    'landgate': 'landgate.wa.gov.au',
    'western australia police force': 'police.wa.gov.au',
    'public transport authority': 'pta.wa.gov.au',
    'water corporation': 'watercorporation.com.au',
}


# Confident AU domains for the short-acronym private companies where Clearbit
# fuzzy-matches an unrelated global brand (favicon-verified below, so a wrong one
# with no favicon is dropped rather than shown).
AU_PRIVATE_SEED = {
    'visy': 'visy.com.au', 'hcf': 'hcf.com.au', 'ghd': 'ghd.com', 'ateco': 'ateco.com.au',
    'ey': 'ey.com', 'racq': 'racq.com.au', 'built': 'built.com.au', 'kpmg': 'kpmg.com.au',
    'hbf': 'hbf.com.au', 'mater': 'mater.org.au', 'abn': 'abngroup.com.au', 'afl': 'afl.com.au',
    'ara': 'aragroup.com.au', 'bgc': 'bgc.com.au', 'racv': 'racv.com.au', 'raa': 'raa.com.au',
    'akd': 'akd.com.au', 'gmhba': 'gmhba.com.au', 'qcoal': 'qcoal.com.au', 'visy': 'visy.com.au',
    'hancock prospecting': 'hancockprospecting.com.au', 'cbh group': 'cbh.com.au',
    'perron group': 'perrongroup.com.au', 'rac of wa': 'rac.com.au',
    'st john of god health care': 'sjog.org.au', 'georgiou': 'georgiou.com.au',
    'perth airport': 'perthairport.com.au', 'craig mostyn': 'craigmostyn.com.au',
    'john hughes group': 'johnhughes.com.au', 'perron': 'perrongroup.com.au',
}


def load_private_names():
    tp = open(PRIV).read()
    m = re.search(r'const RAW: Raw\[\] = \[(.*?)\n\];', tp, re.S)
    body = m.group(1) if m else ''
    # entries: ['Name', 'city', revK, chg]
    return [m.group(1).replace("\\'", "'")
            for m in re.finditer(r"\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'[^']+'\s*,\s*[\d.]+", body)]


def load_perth_gov_names():
    pg = open(PGOV).read()
    block = pg.split('const NAMES', 1)[1].split('];', 1)[0]
    return [ (a or b) for a, b in re.findall(r"'([^']+)'|\"([^\"]+)\"", block) ]


def main():
    privates = load_private_names()
    govs = load_perth_gov_names()
    resolved: dict[str, str] = {}
    unresolved_priv, unresolved_gov = [], []

    print(f'Resolving {len(privates)} private companies (seed + Clearbit)…', file=sys.stderr)
    for i, name in enumerate(privates, 1):
        k = norm_key(name)
        dom = AU_PRIVATE_SEED.get(k)
        if dom and not has_real_favicon(dom):
            dom = None
        if not dom:
            dom = resolve_private(name)
        if dom:
            resolved[k] = dom
        else:
            unresolved_priv.append(name)
        if i % 10 == 0:
            print(f'  …{i}/{len(privates)}', file=sys.stderr)
        time.sleep(0.2)

    print(f'Applying curated WA gov seed for {len(govs)} agencies…', file=sys.stderr)
    for name in govs:
        k = norm_key(name)
        dom = WA_GOV_SEED.get(k)  # curated only — Clearbit doesn't index gov well
        if dom and has_real_favicon(dom):
            resolved[k] = dom
        else:
            unresolved_gov.append(name)

    keys = sorted(resolved)
    L = ['// GENERATED — do not edit by hand. Run scripts/resolve-logos.py.',
         '// Real primary domains for the Perth gov agencies + Top-150 private companies,',
         '// resolved via Clearbit (private) + a curated WA gov seed, each favicon-verified',
         '// against the blank-globe default. deriveDomain() consults this before its',
         '// name→domain heuristic so the card/marker logos populate automatically.',
         '// Keyed by the normalised company name (deriveDomain’s key).',
         '',
         'export const RESOLVED_DOMAINS: Record<string, string> = {']
    for k in keys:
        L.append(f'  {json.dumps(k)}: {json.dumps(resolved[k])},')
    L.append('};')
    open(OUT, 'w').write('\n'.join(L) + '\n')

    print(f'\nResolved {len(resolved)} domains '
          f'({len(privates)-len(unresolved_priv)}/{len(privates)} private, '
          f'{len(govs)-len(unresolved_gov)}/{len(govs)} gov) -> {OUT}', file=sys.stderr)
    if unresolved_priv:
        print('Unresolved private (no confident domain / no favicon):', file=sys.stderr)
        for n in unresolved_priv:
            print(f'  · {n}', file=sys.stderr)
    if unresolved_gov:
        print('Unresolved gov:', file=sys.stderr)
        for n in unresolved_gov:
            print(f'  · {n}', file=sys.stderr)


if __name__ == '__main__':
    main()
