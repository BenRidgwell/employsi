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
_ENTRY = re.compile(
    r"\{\s*skill:\s*'((?:[^'\\]|\\.)*)',\s*cat:\s*'((?:[^'\\]|\\.)*)',"
    r"\s*terms:\s*\[([^\]]*)\]\s*\}"
)
# A usable term has at least one letter or digit. Latin, CJK and any other
# script all qualify; a run of punctuation and spaces does not.
_MEANINGFUL = re.compile(r'[^\W_]', re.UNICODE)


class TaxonomyError(RuntimeError):
    pass


def _unescape(s: str) -> str:
    return re.sub(r'\\(.)', r'\1', s)


def load_skills(path: str) -> list[tuple[str, list[str]]]:
    """[(skill, terms)] from RAW_SKILLS, for term-matching occupation titles.

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
    body = src.split('RAW_SKILLS', 1)[1].split('];', 1)[0]

    merged: dict[str, list[str]] = {}
    bad: list[tuple[str, str]] = []
    for m in _ENTRY.finditer(body):
        skill = _unescape(m.group(1))
        terms = [_unescape(a or b) for a, b in _TERM.findall(m.group(3))]
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
    return out


def load_categories(path: str) -> list[tuple[str, str]]:
    """[(skill, cat)] for the generators that map by category rather than term
    (Canada / Singapore / New Zealand)."""
    src = open(path).read()
    body = src.split('RAW_SKILLS', 1)[1].split('];', 1)[0]
    return [
        (_unescape(m.group(1)), _unescape(m.group(2)))
        for m in re.finditer(
            r"\{\s*skill:\s*'((?:[^'\\]|\\.)*)',\s*cat:\s*'((?:[^'\\]|\\.)*)',", body
        )
    ]


def matcher(path: str):
    """Return match(label) -> [skill, …], memoised. Titles repeat heavily across
    areas and years, so caching turns the inner loop into a dict lookup."""
    skills = load_skills(path)
    memo: dict[str, list[str]] = {}

    def match(label: str) -> list[str]:
        if label not in memo:
            hay = ' ' + (label or '').lower() + ' '
            memo[label] = [n for (n, ts) in skills if any(t in hay for t in ts)]
        return memo[label]

    return match
