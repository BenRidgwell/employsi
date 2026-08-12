"""Shared reader for src/employsi/data/skillsTaxonomy.ts.

Every whole-of-market vacancy generator that term-matches occupation titles
(AU IVI, UK ONS, EU Eurostat, US OEWS) needs the same (skill, terms) pairs. They
each used to carry their own copy of the parsing regex, which is how a silent
data bug survived in all of them at once:

    { skill: 'Education Support', …, terms: ['teacher aide', "teacher's aide", …] }

RAW_SKILLS is TypeScript, so a term containing an apostrophe is written with
DOUBLE quotes. A tokeniser that only understands single quotes reads the
apostrophe as an opening quote and resynchronises on the next one, emitting the
separator between two terms — a bare ', ' — as if it were a term. ', ' is a
substring of almost every occupation title ("Janitors and Cleaners, Except…",
"Office Clerks, General"), so Education Support absorbed most of the labour
market in every country that used the matcher.

So: one parser, and it validates. A term that contains no letter or digit cannot
be a real search term, and is far more likely to be a tokeniser artefact than an
intentional entry, so we refuse to return it — loudly, at generation time,
rather than quietly poisoning a dataset.
"""
from __future__ import annotations
import re

# Either a single- or double-quoted TS string literal, backslash escapes allowed.
_TERM = re.compile(r"""'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)\"""")
# skill/cat accept either quote style for the same reason terms do: which one
# RAW_SKILLS uses is Prettier's choice, not a meaningful property of the data —
# a repo-wide reformat flipped every string in this file from single to double
# quotes and silently emptied this parser (and with it every generated dataset).
# Trailing commas inside the entry are equally Prettier's business.
_STR = r"""(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")"""
# `except` is optional and comes after `terms` — see SkillDef in the .ts. It is
# captured here rather than skipped so the generators apply the SAME
# suppressions the app does; a negative rule honoured on one side only is worse
# than no negative rule at all, because the two then disagree silently.
_ENTRY = re.compile(
    r"\{\s*skill:\s*" + _STR + r"\s*,\s*cat:\s*" + _STR +
    r"\s*,\s*terms:\s*\[([^\]]*)\]\s*,?"
    r"(?:\s*except:\s*\[([^\]]*)\]\s*,?)?\s*\}"
)
# A usable term has at least one letter or digit. Latin, CJK and any other
# script all qualify; a run of punctuation and spaces does not.
_MEANINGFUL = re.compile(r'[^\W_]', re.UNICODE)
# How many entries the file DECLARES: one `skill:` key per entry. Compared with
# how many _ENTRY actually matched, so a shape this parser cannot read is an
# error rather than a silently short list. See _check_complete below.
_DECLARED = re.compile(r'(?:^|[{,\s])skill:\s*[\'"]')


class TaxonomyError(RuntimeError):
    pass


def _norm(s: str) -> str:
    """The .ts `norm`, character for character.

    This used to be a bare `.lower()`, and the difference was silent and
    one-directional: the app rewrote "&" to " and " before matching and this did
    not, so every term containing " and " — "food and beverage", "cafe and
    restaurant", "building and surveying", "training and development" — matched
    an ad the app placed and missed the same ad here. The generated
    whole-of-market datasets and the live archive therefore disagreed about the
    same title, which is the exact failure this module exists to prevent.
    """
    return re.sub(r'\s+', ' ', (s or '').lower().replace('&', ' and '))


def _unescape(s: str) -> str:
    return re.sub(r'\\(.)', r'\1', s)


def _strip_comments(src: str) -> str:
    """Remove // and /* */ comments, leaving string literals alone.

    _ENTRY matches `{` followed directly by `skill:`, so a comment written
    between the two makes the whole entry invisible to this parser. That is not
    hypothetical: "Data Engineering" and "Business Analysis" were each added to
    RAW_SKILLS with a comment above `skill:` explaining where the boundary with
    the neighbouring skill sits — the most natural place to put it — and every
    generated dataset then omitted both skills entirely. The app read them fine
    (TypeScript does not care), so the taxonomy and the whole-of-market series
    disagreed with nothing to show for it.

    Comments are stripped rather than tolerated in one specific position so
    they can also live INSIDE the terms array, which is where a note about a
    particular term belongs. Quote state is tracked because a comment marker
    inside a term is data, and an apostrophe inside a comment ("the agency's
    name") is not a quote — getting that backwards is how the sibling bug in
    this file's docstring corrupted every dataset at once.
    """
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
        elif c in '\'"`':
            quote = c
            out.append(c)
            i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def _check_complete(body: str, parsed: int) -> None:
    """Every declared entry must have been read, or the file has a shape this
    parser mis-reads and the generated datasets would be quietly incomplete."""
    declared = len(_DECLARED.findall(body))
    if declared != parsed:
        raise TaxonomyError(
            f'RAW_SKILLS declares {declared} entries but this parser read '
            f'{parsed}. The {declared - parsed} it could not read would be '
            f'missing from every generated dataset, so refusing rather than '
            f'returning a short list. Check for an entry whose terms array '
            f'contains a "]", or a key order other than skill/cat/terms.'
        )


def load_skills(path: str) -> list[tuple[str, list[str]]]:
    """[(skill, terms)] from RAW_SKILLS, for term-matching occupation titles.

    Terms only. `except` phrases are returned by load_excepts() and applied by
    matcher(); a caller that wants raw terms (there is one: the override
    validation in gen-ivi-skill-demand.py) has no use for them.

    Same-named defs are MERGED into one entry, exactly as the TypeScript SKILLS
    export does. RAW_SKILLS declares a skill more than once on purpose — an
    English def plus a Chinese one for Zhaopin, plus a US-SOC one for OEWS — and
    a matcher that returned both would count a title twice for a single skill
    whenever two of those defs happened to match it.

    Raises TaxonomyError if any term is punctuation/whitespace only, which means
    the file has drifted into a shape this parser mis-reads.
    """
    src = open(path).read()
    if 'RAW_SKILLS' not in src:
        raise TaxonomyError(f'RAW_SKILLS not found in {path}')
    body = _strip_comments(src.split('RAW_SKILLS', 1)[1]).split('];', 1)[0]

    merged: dict[str, list[str]] = {}
    bad: list[tuple[str, str]] = []
    entries = 0
    for m in _ENTRY.finditer(body):
        entries += 1
        skill = _unescape(m.group(1) or m.group(2))
        terms = [_unescape(a or b) for a, b in _TERM.findall(m.group(5))]
        for t in terms:
            if not _MEANINGFUL.search(t):
                bad.append((skill, t))
        seen = merged.setdefault(skill, [])
        seen.extend(t for t in terms if t not in seen)
    out = list(merged.items())
    if bad:
        detail = ', '.join(f'{s}: {t!r}' for s, t in bad[:8])
        raise TaxonomyError(
            f'{len(bad)} term(s) in {path} contain no letter or digit — the '
            f'taxonomy is being mis-tokenised, and matching on them would pull '
            f'in unrelated occupations. Offenders: {detail}'
        )
    if not out:
        raise TaxonomyError(f'No skill entries parsed from {path}')
    _check_complete(body, entries)
    return out


def load_categories(path: str) -> list[tuple[str, str]]:
    """[(skill, cat)] for the generators that map by category rather than term
    (Canada / Singapore / New Zealand).

    DEDUPED, first declaration wins — the same rule the TypeScript SKILLS export
    applies. RAW_SKILLS declares a skill more than once on purpose (an English
    def plus a Chinese one for Zhaopin, plus a US-SOC one for OEWS), and these
    three generators split a coarse occupation group across the skills mapped to
    it. A skill listed twice would take two shares of its group, so its number
    would come out roughly double for no reason but how many vocabularies happen
    to describe it.
    """
    src = open(path).read()
    body = _strip_comments(src.split('RAW_SKILLS', 1)[1]).split('];', 1)[0]
    seen: dict[str, str] = {}
    for m in re.finditer(r"\{\s*skill:\s*" + _STR + r"\s*,\s*cat:\s*" + _STR, body):
        skill = _unescape(m.group(1) or m.group(2))
        if skill not in seen:
            seen[skill] = _unescape(m.group(3) or m.group(4))
    if not seen:
        raise TaxonomyError(f'No skill/cat pairs parsed from {path}')
    return list(seen.items())


def load_excepts(path: str) -> dict[str, list[str]]:
    """{skill: [phrase, …]} — titles a skill must not claim, from its `except`.

    Merged the same way terms are, because a skill declared in two vocabularies
    must not claim a title that either declaration disowns.
    """
    src = open(path).read()
    body = _strip_comments(src.split('RAW_SKILLS', 1)[1]).split('];', 1)[0]
    out: dict[str, list[str]] = {}
    for m in _ENTRY.finditer(body):
        skill = _unescape(m.group(1) or m.group(2))
        raw = m.group(6)
        if not raw:
            continue
        got = out.setdefault(skill, [])
        for a, b in _TERM.findall(raw):
            t = _unescape(a or b)
            if t and t not in got:
                got.append(t)
    return out


def matcher(path: str):
    """Return match(label) -> [skill, …], memoised. Titles repeat heavily across
    areas and years, so caching turns the inner loop into a dict lookup.

    An `except` phrase suppresses its skill for that label outright, before the
    terms are consulted — it is a statement about the TITLE, so term evidence
    cannot outvote it. Same rule and same order as skillsForText in the .ts.
    """
    skills = load_skills(path)
    excepts = load_excepts(path)
    memo: dict[str, list[str]] = {}
    term_re: dict[str, re.Pattern] = {}

    def matches(hay: str, term: str) -> bool:
        r = term_re.get(term)
        if r is None:
            # Mirrors termMatches in the .ts exactly: a term that STARTS with an
            # alphanumeric may not begin mid-word, so "cook" does not fire on
            # "recook"; a term starting with punctuation ("/hr") has no such
            # guard, because there is no word to be inside.
            r = term_re[term] = re.compile(
                (r'(?<![a-z0-9])' if term[:1].isalnum() else '') + re.escape(term))
        return r.search(hay) is not None

    def match(label: str) -> list[str]:
        if label not in memo:
            hay = ' ' + _norm(label) + ' '
            memo[label] = [
                n for (n, ts) in skills
                if not any(x in hay for x in excepts.get(n, ()))
                and any(matches(hay, t) for t in ts)
            ]
        return memo[label]

    return match
