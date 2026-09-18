#!/usr/bin/env python3
"""company_alias.py — the employer-attribution gate.

WHAT THIS GUARDS. Every pair below was OBSERVED in the full 395-company roster
walk of 2026-09-16 (JobSpy -> Indeed, 6,116 rows). The gate decides which of
them get filed on a roster company's card, and a wrong decision is invisible in
the app: Palo Alto Networks' vacancies would simply appear as Alto's hiring,
with a plausible number attached. Same class as check-skill-trends.ts — assert
the reasoning, because the output looks fine either way.

Run: python scripts/test_company_alias.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from company_alias import (  # noqa: E402
    ACCEPT_ALIAS, FALLBACK_UNSAFE, KNOWN_IMPOSTORS, company_matches,
    fallback_safe, norm, short_name,
)

fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        fails.append(msg)


# ── 1. suffix normalisation alone resolves these ─────────────────────────────
# Measured pairs where the employer is plainly the same and short_name() gets
# there with no table entry. If a future edit to _TRAILING breaks one of these,
# that company silently loses its whole Indeed feed (Reece and PwC were 100
# rows each) while the run still reports success.
SUFFIX_ONLY = [
    ('Reece Group', 'Reece'), ('PwC Australia', 'PwC'), ('Mater', 'Mater Group'),
    ('Macmahon Holdings', 'Macmahon'), ('Aurecon', 'Aurecon Group'),
    ('Woolworths Group', 'Woolworths Group Limited'), ('Built', 'Built Holdings'),
    ('HCF', 'HCF (Australia)'), ('Tabcorp', 'TabCorp Holdings'),
    ('Teys Australia', 'Teys'), ('NRW Holdings', 'NRW'),
    ('Viva Energy', 'VIVA ENERGY AUSTRALIA'), ('Georgiou', 'Georgiou Group'),
    ('Craig Mostyn', 'Craig Mostyn & Co Pty Ltd'), ('Midfield', 'The Midfield Group'),
    ('PharmaCare', 'Pharmacare group'), ('GPT Group', 'The GPT Group'),
    ('Fitness and Lifestyle', 'Fitness and Lifestyle Group'), ('Nib', 'NIB Group'),
    ('Pexa Group', 'PEXA'), ('ARB Corporation', 'ARB Corporation Ltd'),
    ('Perenti', 'Perenti Group'), ('Meriton', 'Meriton Group'),
    ('Perfection Fresh', 'PERFECTION FRESH AUSTRALIA'),
    ('Delorean Corporation', 'DeLorean'), ('JB Hi-Fi', 'JB Hi-Fi Australia'),
    ('Codan', 'Codan Limited'), ('Turosi', 'TUROSI PTY LTD'),
    ('Sarah Group', 'Sarah Group Holdings'),
]
for roster, board in SUFFIX_ONLY:
    check(company_matches(roster, board),
          f'suffix rule should accept {roster!r} <- {board!r}')

# The roster name must match a row carrying it verbatim, always.
for roster, _ in SUFFIX_ONLY:
    check(company_matches(roster, roster), f'{roster!r} should match itself')


# ── 2. the curated table ─────────────────────────────────────────────────────
CURATED = [
    ('Wesfarmers', 'Wesfarmers Health'),
    ('Wesfarmers', 'Wesfarmers Chemicals, Energy & Fertilisers'),
    ('Bank of Queensland', 'BOQ Group'),
    ('St Vincent de Paul', 'St Vincent de Paul Society NSW'),
    ('Adbri', 'Adbri Concrete'), ('Adbri', 'Adbri Cement'), ('Adbri', 'Adbri Masonry'),
    ('Viva Energy', 'Viva Energy Retail'), ('Viva Energy', 'VIVA Energy Retail Australia'),
    ('Patterson Cheney', 'Patterson Cheney Cars and Trucks'),
    ('Harris Farm', 'Harris Farm Markets'),
    ('Super Retail Group', 'Super Retail Group Distribution Centre'),
    ('HBF', 'HBF Dental'), ('Midfield', 'Midfield Meat International'),
    ('ARA', 'ARA Property Services PTY LTD'), ('Mort & Co', 'Mort & Co Group Companies'),
    ('Cash Converters', 'Cash Converters (THEORIFY PTY LTD)'),
    ('Choices Flooring', 'Choices Flooring Mackay'),
    ('Anytime Fitness', 'Anytime Fitness Knox'),
]
for roster, board in CURATED:
    check(company_matches(roster, board),
          f'curated table should accept {roster!r} <- {board!r}')


# ── 3. the impostors, which is the half that matters ─────────────────────────
for roster, board in KNOWN_IMPOSTORS:
    check(not company_matches(roster, board),
          f'{board!r} is NOT {roster!r} and must be dropped')

# Substring matching in either direction is what produced most of those, so
# assert the property rather than only the instances.
check(not company_matches('Alto', 'Palo Alto Networks Australia'),
      'substring containment must never be sufficient')
check(not company_matches('Built', 'Rebuilt Homes'),
      'substring containment must never be sufficient (prefix)')


# ── 4. a blank employer is not a free pass ───────────────────────────────────
# Five rows in the measured walk had an empty company. upsert() falls back to
# the company_id, so accepting these files an unattributed ad on a real card.
for blank in ('', '   ', None):
    check(not company_matches('Reece Group', blank),
          f'blank board name {blank!r} must not match')
    check(not company_matches(blank, 'Reece'),
          f'blank roster name {blank!r} must not match')


# ── 5. the table itself stays honest ─────────────────────────────────────────
# Keys are matched against short_name(roster) or norm(roster), so a key that is
# neither shape can never fire — it would look like curation that does nothing.
for key in ACCEPT_ALIAS:
    check(key == norm(key), f'ACCEPT_ALIAS key {key!r} is not normalised')
for key, vals in ACCEPT_ALIAS.items():
    for v in vals:
        check(v == norm(v), f'ACCEPT_ALIAS value {v!r} under {key!r} is not normalised')
        check(v != key, f'ACCEPT_ALIAS entry {key!r} -> {v!r} is redundant (exact match)')

# Every curated pair must reach its entry through one of those two key shapes.
for roster, board in CURATED:
    key = short_name(roster) or norm(roster)
    check(key in ACCEPT_ALIAS or company_matches(roster, board),
          f'no ACCEPT_ALIAS key reachable for {roster!r}')

# short_name must never empty out a real name — that would match nothing.
for roster, _ in SUFFIX_ONLY + CURATED:
    check(short_name(roster) != '', f'short_name({roster!r}) collapsed to empty')

# The two industry words in _TRAILING are the riskiest entries; pin what they
# must NOT merge.
check(not company_matches('Beach Energy', 'Beach Hotel'), 'energy-strip over-merged')
check(not company_matches('Boss Energy', 'Boss Aus'), 'energy-strip over-merged')
check(not company_matches('Alkane Resources', 'Alkane Solutions'), 'resources-strip over-merged')


# ── 6. the short-name fallback ───────────────────────────────────────────────
# jobspy_collect() retries on short_name() when the full roster name returns
# nothing. Measured 2026-09-16: that recovers 558 rows over 14 companies, and
# every one of these is a company it recovered — losing the rule silently drops
# ANZ, Telstra, Qube and Monadelphous to zero while the run still reports green.
FALLBACK_RECOVERED = [
    ('Iluka Resources', 'Iluka'), ('Monadelphous Group', 'Monadelphous'),
    ('Woodside Energy', 'Woodside'), ('Qube Holdings', 'Qube'),
    ('Yancoal Australia', 'Yancoal'), ('CSL Limited', 'CSL'),
    ('ANZ Group Holdings', 'ANZ'), ('Telstra Group', 'Telstra'),
    ('Transurban Group', 'Transurban'), ('VGW Holdings', 'VGW'),
    ('Virgin Australia Holdings', 'Virgin Australia'),
    ('Greatland Resources', 'Greatland Corporation'),
    ('Salvation Army Australia', 'The Salvation Army'),
    ('Flight Centre Travel Group', 'Flight Centre Travel Group'),
]
for roster, board in FALLBACK_RECOVERED:
    check(company_matches(roster, board),
          f'fallback recovery {roster!r} <- {board!r} must still be accepted')
    check(short_name(roster) != norm(roster) or roster == board,
          f'{roster!r} should have a distinct short name for the fallback to fire')

# The four names the fallback must NOT be attempted on, and why: an unrelated
# employer trades under each remainder, and it would match exactly.
for generic in ('Beach Energy', 'Boss Energy', 'Strike Energy', 'Origin Energy'):
    check(not fallback_safe(generic),
          f'{generic!r} must not get the short-name fallback')
# The collision the guard prevents is real — assert the gate alone would NOT
# have caught it, so nobody removes the guard believing the gate suffices.
check(company_matches('Boss Energy', 'BOSS'),
      'the gate accepts a bare "BOSS" — which is exactly why fallback_safe exists')
for ok_name in ('ANZ Group Holdings', 'Telstra Group', 'Qube Holdings',
                'Monadelphous Group', 'Iluka Resources'):
    check(fallback_safe(ok_name), f'{ok_name!r} needs the fallback to return rows')
for g in FALLBACK_UNSAFE:
    check(g == norm(g), f'FALLBACK_UNSAFE entry {g!r} is not normalised')
    check(len(g.split()) == 1, f'FALLBACK_UNSAFE entry {g!r} should be a single token')


if fails:
    print(f'FAIL — {len(fails)} assertion(s):')
    for f in fails:
        print(f'  - {f}')
    sys.exit(1)
n = (len(SUFFIX_ONLY) * 2 + len(CURATED) + len(KNOWN_IMPOSTORS)
     + len(FALLBACK_RECOVERED))
print(f'ok — company_alias gate: {n} measured pairs, '
      f'{len(KNOWN_IMPOSTORS)} impostors rejected, '
      f'{len(FALLBACK_RECOVERED)} fallback recoveries held, table consistent.')
