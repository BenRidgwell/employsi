#!/usr/bin/env python3
"""LinkedIn company-slug and post-attribution rules.

WHY THIS IS ITS OWN MODULE
These rules used to live inside scripts/linkedin-posts-to-d1.py, and
scripts/resolve-linkedin-slugs.py reached them by reading that file's source,
splitting it on the literal string `def d1(` and exec'ing the half above. That
worked, and it encoded a contract no reader of either file could see: move one
function below the D1 helper and the slug resolver stops working, with a
RuntimeError naming a function that is still perfectly well defined.

The nightly post scrape was dropped on 2026-08-09 (LinkedIn authwalls a hosted
runner on request one — 0 posts in 100 requests — so it only ever ran through
Oxylabs). The rules outlived it: scripts/gen-linkedin-logos.py and
scripts/resolve-linkedin-slugs.py both still need them to work out which
LinkedIn page belongs to which rostered employer.

WHAT IS HERE
  slug_candidates(name, domain)     ordered guesses at a company's LinkedIn slug
  attributed(id, name, actor)       does this page actually belong to that
                                    employer? The gate that stops a page being
                                    filed under the wrong company — the same
                                    class of bug as the advertiser match that
                                    filed 31 Manila roles under IGO
  parse_posts(html)                 (actor name, posts) from a company page
  posted_at(activity_id)            a post's timestamp, out of its snowflake id
  text_of / norm / unescape_all     shared text handling

Nothing here touches the network or D1, which is what makes it importable.
"""
from __future__ import annotations
import datetime as dt
import html as htmllib
import re


PAGE = 'https://www.linkedin.com/company/{slug}/'
TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')

# LinkedIn snowflake: the low 22 bits are a sequence, the rest are epoch ms.
ACTIVITY_EPOCH_SHIFT = 22


def text_of(fragment: str) -> str:
    return WS.sub(' ', htmllib.unescape(TAG.sub(' ', fragment or ''))).strip()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def posted_at(activity_id: str) -> str:
    """Absolute publish time from the activity id. '' when it doesn't decode."""
    try:
        ms = int(activity_id) >> ACTIVITY_EPOCH_SHIFT
    except (TypeError, ValueError):
        return ''
    # Sanity-bound it: a snowflake from the wrong field would land in 1970 or
    # the far future, and a bad date is worse than no date.
    if not (1_400_000_000_000 <= ms <= 4_000_000_000_000):
        return ''
    return (dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc)
            .replace(microsecond=0, tzinfo=None).isoformat() + 'Z')


# Corporate tails that a LinkedIn page carries or drops with no pattern to it.
# Measured on the roster: "New Hope Group" is /new-hope-group and keeps its
# tail, "Mineral Resources" is /mineral-resources-limited and gains one it does
# not use in its own name. So both directions get offered.
CORP_TAIL = (
    'group', 'limited', 'ltd', 'holdings', 'corporation', 'corp', 'plc',
    'inc', 'company', 'australia', 'australasia', 'international', 'services',
)


def _slugify(s: str) -> str:
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', (s or '').lower())).strip('-')


def slug_candidates(name: str, domain: str) -> list[str]:
    """Plausible LinkedIn vanity slugs, most likely first.

    Only ever used to LOOK; whatever is fetched is then checked against the
    company name before anything is stored, so a wrong guess costs a request
    rather than a wrong row.

    Every rule here is GENERAL. Hardcoding "commbank" for Commonwealth Bank
    would raise the resolution rate by exactly one and teach the code nothing;
    the per-company answers belong in company_slugs, which records what the
    attribution gate actually confirmed."""
    out: list[str] = []
    d = (domain or '').strip().lower()
    if d:
        host = d.split('/')[0].replace('www.', '')
        first = host.split('.')[0]
        if first:
            out.append(first)

    # "&" is a word, and norm() deletes it: "Bendigo & Adelaide Bank" becomes
    # "bendigo adelaide bank", when the page is bendigo-and-adelaide-bank.
    n = re.sub(r'\s*&\s*', ' and ', name or '')
    # "CAR Group (carsales.com)" — the parenthetical is our own disambiguator,
    # never part of the name the company registered on LinkedIn.
    n = re.sub(r'\s*\([^)]*\)', '', n)

    base = _slugify(n)
    if base:
        out.append(base)
        words = base.split('-')
        if len(words) > 1 and words[-1] in CORP_TAIL:
            # Dropping the tail can strand the preposition that introduced it —
            # "commonwealth-bank-of-australia" would become
            # "commonwealth-bank-of", which is not a name anyone registers.
            words = words[:-1]
            while len(words) > 1 and words[-1] in ('of', 'the', 'and', 'for'):
                words = words[:-1]
            out.append('-'.join(words))
        else:
            out.append(base + '-limited')
        out.append(base.replace('-', ''))
        # The un-expanded "&" form, for the pages that did drop the word.
        plain = _slugify(re.sub(r'\s*\([^)]*\)', '', name or ''))
        if plain and plain != base:
            out.append(plain)

    seen, uniq = set(), []
    for s in out:
        s = re.sub(r'[^a-z0-9-]', '', s)
        if s and s not in seen:
            seen.add(s)
            uniq.append(s)
    # Five, not three: an unresolved company is the expensive case either way,
    # and a company that resolves once is cached and costs one request after
    # that. Measured 2026-08-05: three candidates resolved 31 of 73.
    return uniq[:5]



def unescape_all(s: str) -> str:
    """Unescape until it stops changing.

    LinkedIn DOUBLE-ENCODES an ampersand in this attribute: the raw page carries
    `&amp;amp;`, so a single unescape leaves `&amp;` and King & Wood Mallesons
    reads as "King &amp; Wood Mallesons". norm() then turns that into
    "king amp wood mallesons", the attribution gate finds no containment either
    way, and a correctly-resolved page is thrown out as somebody else's.
    Measured 2026-08-05."""
    for _ in range(3):
        out = htmllib.unescape(s)
        if out == s:
            return out
        s = out
    return s


# Companies whose LinkedIn page carries a name the gate cannot derive from the
# roster's, because the company renamed. Keyed by roster id and holding the
# NORMALISED actor name, so each entry authorises exactly one page for exactly
# one company.
#
# WHY THIS IS A LIST AND NOT A RULE. The obvious loosening — accept when the two
# names share a distinctive token — was tested against the rejections this feed
# actually produced, and it admits the impostors along with the rebrands:
#
#   Bega Cheese          -> "Bega Group"                   share "bega"
#   Swift Networks Group -> "Swift TV"                     share "swift"
#   Steadfast Group      -> "The Steadfast Security Group" share "steadfast"
#
# The first is the same company renamed; the other two are different companies
# that happen to start with the same word. They are structurally identical, so
# no similarity measure over the names can separate them — only knowing which
# company actually renamed can, and that is a fact per company, checked once.
#
# The cost of being wrong here is filing somebody else's posts under an employer
# and showing them on its card as its own, which is the failure this whole gate
# exists to prevent. So entries are added only after confirming the rename, and
# a new one appears in the run log as a "wrong-company" line naming both sides.
REBRANDS: dict[str, tuple[str, ...]] = {
    # Bega Cheese Limited trades as Bega Group; the roster still carries the
    # older name. Page name measured 2026-08-05: "Bega Group".
    'sydney-bga': ('bega group',),
    # Opal Aged Care rebranded to Opal HealthCare.
    'priv-opal-aged-care': ('opal healthcare',),
    # Not a rename at all — the roster's "Drake Supermarkets" is missing the
    # company's own plural. Kept here rather than edited into the roster because
    # that name is also the key for news and job matching, and moving it is a
    # bigger change than this feed should make on its own.
    'priv-drake-supermarkets': ('drakes supermarkets',),
    # ── added 2026-08-08, from the Perth slug-resolution run ──────────────────
    # Each was rejected as a "wrong-company" line, then read before being added.
    # NAB is the bank's own page (707k followers, addressRegion Victoria); the
    # roster carries the legal name and LinkedIn carries the brand.
    'melbourne-nab': ('nab',),
    # "PDI Gold (Predictive Discovery) is building West African's leading gold
    # producer" — its own page says both names, addressRegion WA.
    'perth-pdi': ('pdi gold',),
    # "Legal Aid WA is the public face of the Legal Aid Commission of Western
    # Australia", addressRegion Western Australia.
    'perth-gov-legal-aid-western-australia': ('legal aid wa',),
    # DELIBERATELY ABSENT, and worth recording because it looks like the three
    # above: /dplh was rejected for the Department of Planning, Lands and
    # Heritage, and DPLH is exactly that department's acronym. The page is a
    # family-owned HONG KONG MANUFACTURER founded in 1971. An acronym rule would
    # have taken it, which is the argument for this being a list restated.
}


def attributed(company_id: str, company_name: str, actor: str) -> bool:
    """Does this page belong to this company?

    Containment on normalised names, plus the confirmed renames above."""
    an, cn = norm(actor), norm(company_name)
    if not an or not cn:
        return False
    if an in cn or cn in an:
        return True
    return an in REBRANDS.get(company_id, ())


def parse_posts(html: str) -> tuple[str, list[dict]]:
    """(actor name, posts) from a company landing page."""
    actor = ''
    m = re.search(r'aria-label="View organization page for ([^"]+)"', html)
    if m:
        actor = unescape_all(m.group(1)).strip()

    posts: list[dict] = []
    # Each card starts at its activity urn; slice to the next one so text and
    # images cannot bleed across cards.
    marks = [mm.start() for mm in re.finditer(r'data-activity-urn="urn:li:activity:\d+"', html)]
    for i, start in enumerate(marks):
        end = marks[i + 1] if i + 1 < len(marks) else min(len(html), start + 20000)
        card = html[start:end]
        aid = re.search(r'data-activity-urn="urn:li:activity:(\d+)"', card)
        if not aid:
            continue
        activity = aid.group(1)

        body = ''
        bm = re.search(r'main-feed-activity-card__commentary[^>]*>(.*?)</p>', card, re.S)
        if bm:
            body = text_of(bm.group(1))
        if not body:
            continue  # a card with no words is a reshare stub, not a post

        # The permalink appears just BEFORE the card (it wraps it), so look back.
        link = ''
        lm = re.search(r'href="(https://[a-z.]*linkedin\.com/posts/[^"?]+)',
                       html[max(0, start - 1200):start])
        if lm:
            link = lm.group(1)
        if not link:
            link = f'https://www.linkedin.com/feed/update/urn:li:activity:{activity}/'

        image = ''
        im = re.search(r'data-delayed-url="(https://media\.licdn\.com/[^"]+)"', card)
        if im:
            u = htmllib.unescape(im.group(1))
            # The actor's own logo appears on every card; it is not post media.
            if 'company-logo' not in u:
                image = u

        posts.append({
            'activity': activity,
            'body': body,
            'url': link,
            'image': image,
            'posted': posted_at(activity),
        })
    return actor, posts
