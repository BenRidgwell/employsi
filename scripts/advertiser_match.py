#!/usr/bin/env python3
"""Is an advertised job actually placed BY the company we searched for?

Every keyword-driven feed needs this and every one of them got it wrong in the
same way, so it lives in one place rather than three. Keyword search returns
anything mentioning the name, so the board's advertiser string has to agree
before a row can be filed under a company id.

WHAT WENT WRONG WITH THE OBVIOUS VERSION
Both the JobStreet and LinkedIn feeds used plain substring containment in
either direction. Measured against the live archive, that produced:

    'Indigo Shire Council'        filed under IGO   (a lithium miner)
    'ACCIONA'                     filed under CCI
    'Wiley'                       filed under EY
    'Parabellum International'    filed under ARA
    'RAAFA WA'                    filed under RAA
    'IGO Techonologies'           filed under IGO   (31 Manila roles)

Two separate faults. Substring matching lands INSIDE a word — "igo" in
"Indigo", "ey" in "Wiley" — so tokens have to be compared, never raw strings.
And accepting any number of extra words turns a short name into a wildcard.

THE ASYMMETRY THAT MATTERS
Which side is longer is not a symmetric question, and treating it as one is
what makes a correct rule look impossible:

  - The advertiser is SHORTER than the roster name ("Deloitte" for "Deloitte
    Touche Tohmatsu", "Qantas" for "Qantas Airways", "AGL" for "AGL Energy").
    A company abbreviating its own name is ordinary, and the roster's longer
    form is the thing we chose. Accept.
  - The advertiser is LONGER ("IGO Techonologies" for "IGO"). Extra words are
    how a DIFFERENT company collides with a short name, so they are only
    allowed when they are corporate form rather than a different business.

Both directions still require a whole-token prefix, so a partial word can never
match either way.

WHERE IT DELIBERATELY FAILS
A local subsidiary can trade under a name this rejects — Austal advertises its
Philippine yard as "Austal Ships", which is lexically indistinguishable from
the IGO case. Rather than widen CORPORATE_WORDS until it leaks again, callers
report near misses and confirmed ones are added to ADVERTISER_ALIAS. Failing
towards missing coverage rather than invented coverage is the direction this
archive should fail in.
"""
from __future__ import annotations
import re

# Words that may follow a company's name without making it a different company:
# corporate form, region, and the shared-services wording the Manila and Kuala
# Lumpur back-office entities are registered under.
CORPORATE_WORDS = {
    'group', 'groups', 'holdings', 'holding', 'ltd', 'limited', 'plc', 'pty',
    'inc', 'incorporated', 'corp', 'corporation', 'company', 'co', 'the',
    'international', 'global', 'shared', 'services', 'service', 'solutions',
    'operations', 'business', 'support', 'centre', 'center', 'and', 'of',
    'bank', 'banking', 'insurance', 'philippines', 'philippine', 'malaysia',
    'malaysian', 'australia', 'australian', 'asia', 'pacific', 'apac',
    'sdn', 'bhd', 'berhad', 'nv', 'sa', 'ag', 'llc', 'llp',
}

# Advertiser names that ARE a roster company, where the extra words are a
# trading name rather than a corporate qualifier. Each has been checked against
# the employer — these are not guesses, and the near-miss report is how a new
# one gets found.
ADVERTISER_ALIAS = {
    # Austal's shipbuilding entity, and the name its Philippine yard at
    # Balamban advertises under.
    'austal ships': 'austal',
    # BHP's own advertiser string on SimplyHired for a minority of its ads —
    # the same requisitions appear under the bare "BHP" on the rest of the
    # board, so this is BHP advertising under its operating name, not a
    # different firm. Found by the near-miss report on the first run.
    'bhp mining': 'bhp',
    # Zip Co Limited, with the spaces lost by the board rather than by us.
    'zipcolimited': 'zip',
    # Norco Co-operative Limited is Norco Co-op; "co op" and "co operative"
    # differ only in how the hyphen normalises.
    'norco co operative limited': 'norco co op',
    # Seven Group Holdings is a conglomerate whose operating businesses each
    # advertise under their own brand, never under "SGH". Without these, a
    # WesTrac or Coates ad is correctly REJECTED as not-SGH by the token rule
    # and the roles simply never reach the group's card.
    #
    # NOTE these only decide ATTRIBUTION — whether an ad already in hand counts
    # as SGH. They do not cause the ads to be found: the keyword feeds search
    # the roster name, and searching "SGH" does not return Boral. Surfacing the
    # subsidiaries needs their names added to the feed's query list as well.
    'boral': 'sgh',
    'boral limited': 'sgh',
    'westrac': 'sgh',
    'coates': 'sgh',
    'coates hire': 'sgh',
    'allight': 'sgh',
    'allight sykes': 'sgh',
    'sgh energy': 'sgh',
    'seven group holdings': 'sgh',
    # Swift Holdings Investments trades as Autoleague, and its dealerships
    # advertise under that name rather than the holding entity's. Without this
    # the token rule correctly rejects an Autoleague ad as not-Swift, and the
    # roles never reach the card. The other half — making the feeds search for
    # "Autoleague" at all — is EXTRA_QUERIES in
    # workers/jobs-cron/companyQueries.ts.
    # The lookup is exact on the normalised token string, so a corporate suffix
    # is a miss — which is why 'boral' and 'boral limited' are both listed
    # above. Same here.
    'autoleague': 'swift holdings investments',
    'autoleague pty ltd': 'swift holdings investments',
    'autoleague australia': 'swift holdings investments',
    # Perenti is a mining-services group whose people are all employed by its
    # brands; its own advertiser record has served 0 ads every time it has been
    # checked. Confirmed against Perenti's own "our businesses" listing:
    #   contract mining   Barminco, AUMS (African Underground Mining Services)
    #   drilling services Ausdrill, DDH1, Strike Drilling, Swick, Ranger
    #   mining services   BTP
    # Ranger, Supply Direct and Logistics Direct are listed for attribution even
    # though they had no SEEK advertiser when this was written — an ad can still
    # reach us under those names from Indeed, Jora or LinkedIn.
    'barminco': 'perenti',
    'barminco pty ltd': 'perenti',
    'aums': 'perenti',
    'african underground mining services': 'perenti',
    'ausdrill': 'perenti',
    'ausdrill limited': 'perenti',
    'ddh1': 'perenti',
    'ddh1 drilling': 'perenti',
    'ddh1 drilling pty ltd': 'perenti',
    # "Strike Drilling" is NOT Strike Energy (ASX:STX, also on the roster). The
    # token rule already keeps them apart — ['strike','drilling'] does not
    # prefix-match ['strike','energy'] — and this alias is an exact lookup, so
    # it cannot reach the other company either.
    'strike drilling': 'perenti',
    'swick': 'perenti',
    'swick mining services': 'perenti',
    'ranger drilling': 'perenti',
    'btp': 'perenti',
    'btp group': 'perenti',
    'supply direct': 'perenti',
    'logistics direct': 'perenti',
    # Alkane Resources advertises under its two producing mines and never under
    # the corporate name. Costerfield (gold-antimony, Victoria) came with the
    # Mandalay Resources merger completed 2025-08-05; Tomingley (gold, NSW) is
    # the original Alkane operation.
    'costerfield': 'alkane resources',
    'costerfield operations': 'alkane resources',
    'tomingley': 'alkane resources',
    'tomingley gold': 'alkane resources',
    'tomingley gold operations': 'alkane resources',
    # Seven West Media hires under its mastheads and its network brand. The bare
    # "Seven" needs no alias — it is shorter than the roster name and prefixes
    # it, so the token rule accepts it already, and "Seven Miles Coffee
    # Roasters" is correctly rejected by that same rule.
    'west australian newspapers': 'seven west media',
    'west australian newspapers limited': 'seven west media',
    'the west australian': 'seven west media',
    # Catalyst Metals advertises through the operating entity for its Plutonic
    # gold mine in WA rather than the listed parent.
    'catalyst plutonic': 'catalyst metals',
    'catalyst plutonic pty ltd': 'catalyst metals',
}


def norm(s: str) -> str:
    """Normalisation shared with the D1 dedup key (src/employsi/lib/jobArchive.ts)."""
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()[:120]


def advertiser_matches(advertiser: str, name: str) -> bool:
    a, n = norm(advertiser).split(), norm(name).split()
    if not a or not n:
        return False
    if a == n or ADVERTISER_ALIAS.get(' '.join(a)) == ' '.join(n):
        return True
    long_, short_ = (a, n) if len(a) >= len(n) else (n, a)
    if long_[:len(short_)] != short_:
        return False
    if len(a) < len(n):
        # Advertiser is a shortened form of the roster name. Ordinary.
        return True
    return all(w in CORPORATE_WORDS for w in long_[len(short_):])


def near_miss(advertiser: str, name: str) -> bool:
    """Rejected, but shares the roster name's leading tokens — worth a look."""
    a, n = norm(advertiser).split(), norm(name).split()
    if not a or not n or advertiser_matches(advertiser, name):
        return False
    long_, short_ = (a, n) if len(a) >= len(n) else (n, a)
    return long_[:len(short_)] == short_
