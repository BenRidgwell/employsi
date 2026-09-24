#!/usr/bin/env python3
"""
Tests for scripts/talent_flows.py — the experience parser and move rules.

THE FIXTURES ARE SYNTHETIC. They are written in LinkedIn's experience-page
layout as the parser understands it, with invented people and titles, because
no real page has been captured from this repo yet (the sandbox cannot sign in
to LinkedIn). What they pin is the RULES — a group header is the line before a
duration-only summary, a side role is not a move, two employers starting in
the same month is not guessed between — so that calibrating the parser against
a real page later changes a rule deliberately, not by accident.

When `collect-talent-flows.py --inspect` shows a real layout, add it here with
the person's details replaced.

Run: python scripts/test_talent_flows.py
"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talent_flows import (  # noqa: E402
    Month, aggregate, clean_lines, company_links, moves_from, parse_experience,
    person_key,
)

failures = 0


def check(name, cond, detail=''):
    global failures
    if cond:
        print(f'  ok  {name}')
    else:
        failures += 1
        print(f'FAIL  {name}{" — " + str(detail) if detail else ""}')


REFS = [
    {'kind': 'company', 'url': '/company/bhp/', 'text': 'BHP'},
    {'kind': 'company', 'url': 'https://www.linkedin.com/company/riotinto/', 'text': 'Rio Tinto logo'},
    {'kind': 'company', 'url': '/company/woodside-energy/', 'text': 'Woodside Energy'},
    {'kind': 'person', 'url': '/in/someone/', 'text': 'Someone'},
]

# Every visible string doubled, as innerText gives it when LinkedIn renders a
# screen-reader copy next to the visible one.
SINGLE_ROLES = """Experience
Senior Geologist
Senior Geologist
BHP · Full-time
BHP · Full-time
Mar 2023 - Present · 1 yr 7 mos
Perth, Western Australia, Australia · On-site
Geologist
Rio Tinto · Full-time
Feb 2020 - Feb 2023 · 3 yrs 1 mo
Perth, Western Australia, Australia
Worked on exploration programmes.
…see more
Graduate Geologist
Acme Exploration Pty Ltd · Contract
Jan 2018 - Dec 2019 · 2 yrs
Show all 3 experiences
"""

GROUPED = """Experience
Woodside Energy
Full-time · 6 yrs 2 mos
Perth, Western Australia, Australia
Lead Engineer
Jan 2021 - Present · 3 yrs 9 mos
Senior Engineer
Full-time
Jan 2018 - Dec 2020 · 3 yrs
Engineer
BHP · Full-time
Mar 2014 - Nov 2017 · 3 yrs 9 mos
"""

SIDE_ROLE = """Experience
General Manager
BHP · Full-time
Jan 2015 - Present · 9 yrs
Non-Executive Director
Rio Tinto · Part-time
Jan 2019 - Jun 2021 · 2 yrs 6 mos
Chief Executive
Woodside Energy · Full-time
Aug 2021 - Present · 3 yrs
"""

UNKNOWN_EMPLOYER = """Experience
Analyst
Some Unlinked Firm
Jan 2019 - Dec 2020
"""

YEAR_ONLY = """Experience
Engineer
Rio Tinto · Full-time
2021 - Present
Engineer
BHP · Full-time
2016 - 2020
"""

AMBIGUOUS = """Experience
Consultant
Rio Tinto · Contract
Jan 2021 - Present
Engineer
Woodside Energy · Full-time
Jan 2021 - Present
Engineer
BHP · Full-time
Jan 2016 - Nov 2020
"""


def test_links():
    links = company_links(REFS)
    check('links: slug read from a relative url', links.get('bhp') == 'bhp')
    check('links: " logo" suffix stripped, absolute url read',
          links.get('rio tinto') == 'riotinto', links)
    check('links: person refs ignored', 'someone' not in links)
    check('links: dict-of-sections shape reads "experience"',
          company_links({'experience': REFS}).get('bhp') == 'bhp')


def test_clean():
    lines = clean_lines(SINGLE_ROLES)
    check('clean: doubled lines collapse', lines.count('Senior Geologist') == 1, lines[:4])
    check('clean: furniture dropped',
          not any(l.startswith(('Experience', 'Show all', '…see')) for l in lines), lines)


def test_single():
    r = parse_experience(SINGLE_ROLES, REFS)
    got = [(p.company, p.slug, p.title, p.start.iso(), p.end.iso() if p.end else None)
           for p in r.positions]
    check('single: three positions', len(got) == 3, got)
    check('single: current role', got[0] == ('BHP', 'bhp', 'Senior Geologist', '2023-03', None), got[0])
    check('single: prior role with its slug', got[1][:2] == ('Rio Tinto', 'riotinto'), got[1])
    check('single: unlinked employer kept by name, no slug',
          got[2][:2] == ('Acme Exploration Pty Ltd', None), got[2])
    m = moves_from(r.positions).moves
    pairs = [(x.from_ref, x.to_ref, x.month) for x in m]
    check('single: Rio Tinto -> BHP dated to the start month',
          ('li:riotinto', 'li:bhp', '2023-03') in pairs, pairs)
    check('single: unlinked employer moves carry a name ref',
          ('li-name:acme exploration pty ltd', 'li:riotinto', '2020-02') in pairs, pairs)
    check('single: exactly two moves', len(m) == 2, pairs)


def test_grouped():
    r = parse_experience(GROUPED, REFS)
    got = [(p.company, p.slug, p.title) for p in r.positions]
    check('grouped: roles under the header take its employer',
          got[:2] == [('Woodside Energy', 'woodside-energy', 'Lead Engineer'),
                      ('Woodside Energy', 'woodside-energy', 'Senior Engineer')], got)
    check('grouped: a later single role closes the group',
          got[2] == ('BHP', 'bhp', 'Engineer'), got)
    m = [(x.from_ref, x.to_ref, x.month) for x in moves_from(r.positions).moves]
    check('grouped: a promotion inside the employer is not a move',
          m == [('li:bhp', 'li:woodside-energy', '2018-01')], m)


def test_side_role():
    r = parse_experience(SIDE_ROLE, REFS)
    res = moves_from(r.positions)
    m = [(x.from_ref, x.to_ref) for x in res.moves]
    check('side role: a board seat ending is not a move', m == [], m)
    check('side role: the jobs still held are ongoing, not moves',
          res.skipped['ongoing'] == 2, res.skipped)


def test_unknown_employer():
    r = parse_experience(UNKNOWN_EMPLOYER, REFS)
    # The line above the range is a plain name with no link and no employment
    # type. It might be the employer; it might be a title inside a group whose
    # header scrolled away. It is not guessed.
    check('unknown: position dropped, not guessed', r.positions == [], r.positions)
    check('unknown: the drop is counted', r.dropped['no_employer'] == 1, r.dropped)


def test_year_only():
    r = parse_experience(YEAR_ONLY, REFS)
    check('year only: parsed as a bare year', r.positions[1].start == Month(2016, None))
    m = moves_from(r.positions).moves
    check('year only: the move exists but carries no month',
          [(x.from_ref, x.to_ref, x.month) for x in m] == [('li:bhp', 'li:riotinto', None)], m)
    check('year only: aggregate leaves it out of every window',
          aggregate(m, '2000-01', '2099-12') == [])


def test_ambiguous():
    res = moves_from(parse_experience(AMBIGUOUS, REFS).positions)
    check('ambiguous: two employers starting together is not guessed between',
          res.moves == [] and res.skipped['ambiguous'] == 1, (res.moves, res.skipped))


def test_boomerang():
    text = """Engineer
BHP · Full-time
Jan 2022 - Present
Engineer
Rio Tinto · Full-time
Jan 2019 - Dec 2021
Graduate
BHP · Full-time
Jan 2016 - Dec 2018
"""
    m = [(x.from_ref, x.to_ref) for x in moves_from(parse_experience(text, REFS).positions).moves]
    check('boomerang: leaving and returning are two moves',
          m == [('li:bhp', 'li:riotinto'), ('li:riotinto', 'li:bhp')], m)


def test_aggregate():
    moves = [
        {'from_ref': 'li:bhp', 'from_name': 'BHP', 'to_ref': 'li:riotinto', 'to_name': 'Rio Tinto', 'month': '2025-03'},
        {'from_ref': 'li:bhp', 'from_name': 'BHP Group', 'to_ref': 'li:riotinto', 'to_name': 'Rio Tinto', 'month': '2025-12'},
        {'from_ref': 'li:bhp', 'from_name': 'BHP', 'to_ref': 'li:riotinto', 'to_name': 'Rio Tinto', 'month': '2026-01'},
    ]
    rows = aggregate(moves, '2025-01', '2025-12')
    check('aggregate: window is inclusive at both ends, excludes after',
          len(rows) == 1 and rows[0]['moves'] == 2, rows)
    check('aggregate: most common name wins', rows[0]['from_name'] == 'BHP', rows)
    check('aggregate: period is whole months',
          (rows[0]['period_start'], rows[0]['period_end']) == ('2025-01-01', '2025-12-31'), rows)
    check('aggregate: february in a leap year',
          aggregate(moves[:1], '2024-02', '2024-02') == [] and
          aggregate([dict(moves[0], month='2024-02')], '2024-02', '2024-02')[0]['period_end'] == '2024-02-29')
    check('aggregate: count kind is sampled', rows[0]['count_kind'] == 'sampled')


def test_person_key():
    a = person_key('Jane-Doe', b'salt')
    check('person key: case and url form do not matter',
          a == person_key('https://www.linkedin.com/in/jane-doe/', b'salt'))
    check('person key: salt changes it', a != person_key('jane-doe', b'other'))
    try:
        person_key('jane-doe', b'')
        check('person key: empty salt refused', False)
    except ValueError:
        check('person key: empty salt refused', True)


for t in [test_links, test_clean, test_single, test_grouped, test_side_role,
          test_unknown_employer, test_year_only, test_ambiguous, test_boomerang,
          test_aggregate, test_person_key]:
    t()

if failures:
    print(f'\n{failures} failure(s)')
    sys.exit(1)
print('\nall talent-flow parser checks passed')
