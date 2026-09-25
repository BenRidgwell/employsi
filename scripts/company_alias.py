#!/usr/bin/env python3
"""Decide whether an employer name returned by a job board is the roster company
we searched for.

WHY THIS EXISTS. Indeed's `company:"X"` is a KEYWORD match on the employer
field, not an exact filter, so a company-scoped walk returns three kinds of row
mixed together. Measured 2026-09-16 over the full 395-company roster through
JobSpy (6,116 rows):

    exact company match     5,009  (81.9%)
    a DIFFERENT employer    1,102  (18.0%)
    blank company               5  ( 0.1%)

`indeed-to-d1.py` stamps `company_id` from the company being WALKED, not from
the row, so every one of those 1,102 rows would be filed on the roster
company's card. That is the "plausible figure that was invented" failure this
codebase is built around — `company:"Alto"` returns Palo Alto Networks, and
without a gate Palo Alto's vacancies become Alto's hiring.

NEITHER OBVIOUS RULE WORKS, which is the whole reason for the table below.

  Exact equality is too STRICT. The same 2026-09-16 walk: `Reece Group` comes
  back 100 rows of `Reece`, `PwC Australia` 100 of `PwC`, `Mater` 100 of
  `Mater Group`, `Macmahon Holdings` 91 of `Macmahon`. All are the employer we
  asked for, branded differently; exact matching bins 1,102 good rows.

  Substring is too LOOSE. `Alto` is inside `Palo Alto Networks`, `Built` inside
  `KOVA Built`, `AMP` inside `Culture Amp`. Those are four unrelated employers.

So the rule is: normalise away corporate suffixes, and keep an explicit table
for everything that survives. DEFAULT-DENY — a name this file has never seen is
dropped, not guessed at. A dropped row costs coverage; a wrongly kept one
corrupts a company's card, and only one of those is recoverable.
"""
from __future__ import annotations
import re

__all__ = ['norm', 'short_name', 'company_matches', 'fallback_safe',
           'ACCEPT_ALIAS', 'KNOWN_IMPOSTORS', 'FALLBACK_UNSAFE']


def norm(s: str) -> str:
    """Same shape as jobArchive.ts / indeed-to-d1.py's norm()."""
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


# Tokens stripped from the END of a name, repeatedly, to reduce a legal entity
# to its brand. TRAILING ONLY, and this list is deliberately short.
#
# "services" and "security" are NOT here, and must not be added: the roster's
# `Challenger` is the financial-services firm, and `Challenger Services Group`
# and `Challenger Security` are unrelated employers that would collapse onto it
# the moment either word became strippable. The same argument rules out most
# industry words — every token added here merges two names somewhere.
_TRAILING = {
    'group', 'holdings', 'holding', 'limited', 'ltd', 'pty', 'plc', 'inc',
    'incorporated', 'corporation', 'corp', 'company', 'companies', 'co', 'nl',
    'australia', 'australian', 'au',
    # Industry words that appear as a trailing qualifier on ASX names and are
    # dropped by the employer's own Indeed branding: `Iluka Resources` -> Iluka,
    # `Woodside Energy` -> Woodside, `Monadelphous Group` -> Monadelphous.
    'resources', 'energy',
}
# "the" is stripped from the FRONT only — `The GPT Group` vs `GPT Group`.
_LEADING = {'the'}


def short_name(s: str) -> str:
    """Normalised name with corporate suffixes peeled off.

    Returns '' when nothing survives, which never matches (see company_matches).
    """
    toks = norm(s).split()
    while toks and toks[0] in _LEADING:
        toks.pop(0)
    while toks and toks[-1] in _TRAILING:
        toks.pop()
    return ' '.join(toks)


# ── the curated table ────────────────────────────────────────────────────────
# Roster name -> employer names accepted for it, both normalised by norm().
#
# EVERY ENTRY WAS OBSERVED, not imagined: each one is a name Indeed actually
# returned for that roster company in the 2026-09-16 full-roster walk, that
# short_name() does NOT already resolve. Re-derive with the walk rather than
# adding names speculatively — an unused alias is a claim nobody has checked.
#
# Divisions and franchise sites of a roster company ARE that company hiring, so
# they are accepted. Tenants of its premises are not.
ACCEPT_ALIAS: dict[str, set[str]] = {
    # A RENAME, not a division, and the one case where adding a name without a
    # board walk behind it is right. Sayona Mining merged with Piedmont Lithium
    # in 2026 and became Elevra Lithium (ASX:SYA -> ASX:ELV; the OTC line is
    # still SYAXF). Job boards carry months of ads under the old name and every
    # one of them is this company hiring, so without this the rename would
    # quietly halve its vacancy count — the feeds would search the new name,
    # the gate would reject the old one, and the card would show a fall that
    # never happened.
    'elevra lithium': {'sayona mining', 'sayona', 'sayona lithium'},
    # NOT a rename of the business — only of our label for it. The roster
    # carried the registered entity, COGI Pty Ltd, until 2026-09-24; the shops
    # have always said Cotton On. So there are no old-name ads to rescue here,
    # unlike Elevra above. What this does is let an ad posted under the
    # trading name through to the record now named for the group.
    'cotton on group': {'cotton on'},
    # A RENAME, 2026-08-17: Hillgrove Resources became Kantra Copper
    # (ASX:HGO -> ASX:KAN). Months of ads sit under the old name and every one
    # is this company hiring, so without this the rename halves its count.
    'kantra copper': {'hillgrove resources', 'hillgrove'},
    # A RENAME, 2025: Anglo American Platinum demerged and became Valterra
    # Platinum (JSE:AMS -> JSE:VAL). Every archive row for this employer was
    # posted under the old name and every one is this company hiring.
    'valterra platinum': {'anglo american platinum', 'amplats'},
    # Divisions trading under their own name.
    'wesfarmers': {'wesfarmers health',
                   'wesfarmers chemicals energy fertilisers'},
    'adbri': {'adbri concrete', 'adbri cement', 'adbri masonry'},
    'viva energy': {'viva energy retail', 'viva energy retail australia'},
    'super retail group': {'super retail group distribution centre'},
    'hbf': {'hbf dental'},
    'midfield': {'midfield meat international'},
    'harris farm': {'harris farm markets'},
    'patterson cheney': {'patterson cheney cars and trucks'},
    'mort co': {'mort co group companies'},
    # A rebrand the suffix rule cannot see: the initialism differs from the
    # roster's full legal name.
    'bank of queensland': {'boq group'},
    # The Society is the employing entity; the school merely shares the saint's
    # name and is NOT accepted (see KNOWN_IMPOSTORS).
    'st vincent de paul': {'st vincent de paul society nsw'},
    # ARA Group's property arm. `Top Migration Australia` also came back for
    # this search and is unrelated.
    'ara': {'ara property services pty ltd'},
    # Franchise sites — the franchisee is the legal employer, but the vacancy is
    # genuinely this brand's. Consistent with how the roster treats the brand.
    'cash converters': {'cash converters theorify pty ltd'},
    'choices flooring': {'choices flooring mackay'},
    'anytime fitness': {'anytime fitness knox'},
}
ACCEPT_ALIAS = {k: {norm(v) for v in vs} for k, vs in ACCEPT_ALIAS.items()}


# Names that a looser rule WOULD have accepted and that are a different
# employer. Nothing reads this at runtime — default-deny already drops them —
# but test_company_alias.py asserts every one still fails, so a future
# "harmless" widening of _TRAILING or a switch to substring matching fails loudly
# instead of quietly repopulating the cards with other companies' vacancies.
KNOWN_IMPOSTORS: list[tuple[str, str]] = [
    ('Alto', 'Palo Alto Networks'),            # substring
    ('Alto', 'Alto Montessori'),
    ('Built', 'KOVA Built'),                   # substring
    ('Built', 'Built Environment Collective (BEC)'),
    ('AMP', 'Culture Amp'),                    # substring
    ('AMP', 'Amp Up Independent Living'),
    ('Challenger', 'Challenger Services Group'),   # _TRAILING widening
    ('Challenger', 'Challenger Security'),
    ('St Vincent de Paul', "St Vincent de Paul's School"),
    ('Uniting', 'Uniting Vic.Tas'),            # separate legal entities
    ('Uniting', 'Uniting Communities'),
    ('Uniting', 'Uniting Church in Australia'),
    ('Uniting', 'Uniting Country SA'),
    ('HammondCare', 'NSW Government'),         # the board's own mislabelling
    ('Calvary Health Care', 'NSW Government'),
    ('Melbourne Airport', 'Soul Origin Melbourne Airport T4'),   # tenants
    ('Melbourne Airport', 'Subway Restaurant - Spencer Street Docklands'),
    ('Stockland', 'Blooms The Chemist Stockland Baldivis'),
    ('Shell', 'Noblefuels Pty Ltd (shell denmark)'),
    ('Ampol', 'Boss Aus'),
    ('St John of God Health Care', 'Australasian College for Emergency Medicine'),
    ('ARA', 'Top Migration Australia'),
]


# Short names too generic to SEARCH on, even though they are correct.
#
# jobspy_collect() retries `company:"<short name>"` when the full roster name
# returns nothing, which is what recovers ANZ, Telstra, Qube and Monadelphous
# (558 rows over 14 companies, measured 2026-09-16). For these four it would
# instead invite an exact-name collision the gate cannot see: short_name()
# strips a trailing "energy", and an employer really does trade as each of the
# remainders — Soul Origin, Beach Hotel, Hugo Boss's BOSS, Strike Bowling.
# `norm('BOSS') == short_name('Boss Energy')`, so such a row would be accepted
# and filed as Boss Energy's hiring.
#
# None of the four was observed colliding — each returned zero or was dropped in
# the 2026-09-16 walk — so this is a guard against a trap that is reachable
# rather than a fix for an error that happened. The cost is that these four
# never get the fallback, which is the right side to fail on: they keep their
# exact-name results either way.
#
# Derived from the roster, not invented: these are every roster company whose
# short_name() is a single generic word. Re-run that check when the roster gains
# an employer whose name ends in a stripped suffix.
FALLBACK_UNSAFE = {'beach', 'boss', 'strike', 'origin'}


def fallback_safe(roster_name: str) -> bool:
    """Whether `company:"<short name>"` is safe to retry for this company."""
    s = short_name(roster_name)
    return bool(s) and s not in FALLBACK_UNSAFE


def company_matches(roster_name: str, board_name: str) -> bool:
    """True when `board_name` is `roster_name` hiring.

    A BLANK board name is False, not a free pass. Five rows in the measured
    walk carried an empty employer; upsert() falls back to the company_id for
    those, which would file an unattributed ad on the roster company's card on
    the strength of nothing at all.
    """
    if not (board_name or '').strip() or not (roster_name or '').strip():
        return False
    rn, bn = norm(roster_name), norm(board_name)
    if rn == bn:
        return True
    rs, bs = short_name(roster_name), short_name(board_name)
    if rs and rs == bs:
        return True
    return bn in ACCEPT_ALIAS.get(rs or rn, set()) or bn in ACCEPT_ALIAS.get(rn, set())
