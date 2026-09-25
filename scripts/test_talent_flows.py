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
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talent_flows import (  # noqa: E402
    Month, aggregate, coverage_end, tail_counts, window_note, exclusion_report, clean_lines, company_links, moves_from, parse_experience,
    person_key, positions_from_brightdata,
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
          ('name:acme exploration pty ltd', 'li:riotinto', '2020-02') in pairs, pairs)
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


def test_acquisition():
    def mv(f, t, month):
        return {'from_ref': f, 'from_name': f, 'to_ref': t, 'to_name': t, 'month': month}
    moves = [
        mv('li:oz-minerals', 'li:bhp', '2020-10'),   # before the deal: a real hire
        mv('li:oz-minerals', 'li:bhp', '2023-04'),   # the month before completion
        mv('li:oz-minerals', 'li:bhp', '2023-05'),   # completion month: a transfer
        mv('li:oz-minerals', 'li:bhp', '2024-04'),   # a late profile update: still a transfer
        mv('li:bhp', 'li:oz-minerals', '2023-06'),   # the other way after completion
        mv('li:rio-tinto', 'li:bhp', '2023-05'),     # unrelated pair, same month
        mv('li:oz-minerals', 'li:rio-tinto', '2023-05'),  # the acquired firm, another buyer
    ]
    excluded = Counter()
    rows = {(r['from_ref'], r['to_ref']): r['moves']
            for r in aggregate(moves, '2020-01', '2026-12', excluded)}
    check('acquisition: moves before completion are hires',
          rows.get(('li:oz-minerals', 'li:bhp')) == 2, rows)
    check('acquisition: completion month and after are transfers, both ways',
          excluded == Counter({('acquisition', 'li:oz-minerals', 'li:bhp'): 2,
                               ('acquisition', 'li:bhp', 'li:oz-minerals'): 1}),
          excluded)
    check('acquisition: other pairs are untouched',
          rows.get(('li:rio-tinto', 'li:bhp')) == 1 and rows.get(('li:oz-minerals', 'li:rio-tinto')) == 1,
          rows)
    check('acquisition: no excluded counter is fine',
          aggregate(moves, '2020-01', '2026-12') == aggregate(moves, '2020-01', '2026-12', Counter()))
    rep = exclusion_report(excluded)['acquisition_transfers']
    check('acquisition: the export names what it removed and why',
          rep[0]['moves'] == 2 and 'li:bhp acquired li:oz-minerals' in rep[0]['reason']
          and 'bhp.com' in rep[0]['evidence'], rep)


def test_not_employers():
    def mv(f, fn, t, tn):
        return {'from_ref': f, 'from_name': fn, 'to_ref': t, 'to_name': tn, 'month': '2024-01'}
    moves = [
        mv('name:freelance', 'Freelance', 'li:bhp', 'BHP'),
        mv('li:rio-tinto', 'Rio Tinto', 'name:freelance', 'Freelance'),
        mv('name:self employed', 'Self-employed', 'li:bhp', 'BHP'),
        mv('li:hd-independent-consultant', 'Independent Consultant', 'li:bhp', 'BHP'),
        mv('name:', '-', 'li:bhp', 'BHP'),                     # "-" normalises to nothing
        mv('li:freelance-copywriter-x', 'Freelance copywriter/online editor', 'li:bhp', 'BHP'),
        mv('li:rio-tinto', 'Rio Tinto', 'li:bhp', 'BHP'),
    ]
    excluded = Counter()
    rows = {(r['from_ref'], r['to_ref']): r['moves']
            for r in aggregate(moves, '2024-01', '2024-01', excluded)}
    check('not employers: neither end of a freelance spell is a flow',
          ('name:freelance', 'li:bhp') not in rows and ('li:rio-tinto', 'name:freelance') not in rows,
          rows)
    check('not employers: nor X -> BHP invented across it',
          rows.get(('li:rio-tinto', 'li:bhp')) == 1, rows)
    check('not employers: matched by name whatever the ref',
          ('li:hd-independent-consultant', 'li:bhp') not in rows, rows)
    check('not employers: an empty ref never reaches the loader',
          not any('name:' in (f, t) for f, t in rows), rows)
    check('not employers: exact names only, a named freelance business stays',
          rows.get(('li:freelance-copywriter-x', 'li:bhp')) == 1, rows)
    rep = exclusion_report(excluded)['not_employers']
    check('not employers: the export counts each one removed',
          {r['name']: r['moves'] for r in rep} ==
          {'Freelance': 2, 'Self-employed': 1, 'Independent Consultant': 1, '-': 1}, rep)


def test_same_employer():
    def mv(f, fn, t, tn, month='2024-01'):
        return {'from_ref': f, 'from_name': fn, 'to_ref': t, 'to_name': tn, 'month': month}
    moves = [
        mv('li:bhp-billiton-nickel-west-pty-ltd', 'BHP Billiton Nickel West Pty Ltd', 'li:bhp', 'BHP'),
        mv('name:bhp', 'BHP', 'li:bhp', 'BHP'),                        # name-matched BHP -> BHP
        mv('li:bhp', 'BHP', 'name:bhp olympic dam', 'BHP Olympic Dam'),  # the other way
        mv('li:rio-tinto', 'Rio Tinto', 'name:bhp mitsubishi alliance', 'BHP Mitsubishi Alliance'),
        mv('li:rio-tinto', 'Rio Tinto', 'li:bhp', 'BHP'),
        mv('name:bhp contracting through chandler macleod', 'BHP (Contracting through Chandler Macleod)',
           'li:bhp', 'BHP'),                                           # an agency label: a hire
        mv('li:oz-minerals', 'OZ Minerals', 'name:oz minerals bhp', 'OZ Minerals/BHP', '2023-05'),
    ]
    excluded = Counter()
    rows = {(r['from_ref'], r['to_ref']): r for r in aggregate(moves, '2020-01', '2026-12', excluded)}
    check('same employer: a move between two of its own pages is not a move',
          not any(f == t for f, t in rows) and
          not any('nickel-west' in f or f == 'name:bhp' for f, _ in rows), rows)
    check('same employer: a hire into a subsidiary is a hire into the employer',
          rows[('li:rio-tinto', 'li:bhp')]['moves'] == 2 and
          rows[('li:rio-tinto', 'li:bhp')]['to_name'] == 'BHP', rows)
    check('same employer: an agency label is left as its own source',
          ('name:bhp contracting through chandler macleod', 'li:bhp') in rows, rows)
    check('same employer: an alias still meets the acquisition rule',
          excluded[('acquisition', 'li:oz-minerals', 'li:bhp')] == 1, excluded)
    rep = exclusion_report(excluded)
    check('same employer: the export counts what it dropped and what it merged',
          sum(r['moves'] for r in rep['same_employer']) == 3 and
          {r['ref']: r['moves'] for r in rep['merged_into_employer']} ==
          {'name:bhp mitsubishi alliance': 1}, rep)


def test_second_seed_lists():
    excluded = Counter()
    def mv(f, fn, t='li:fortescue', tn='Fortescue'):
        return {'from_ref': f, 'from_name': fn, 'to_ref': t, 'to_name': tn, 'month': '2024-01'}
    rows = {(r['from_ref'], r['to_ref']): r['moves'] for r in aggregate([
        mv('name:fmg', 'FMG'), mv('li:fortescue-metals-group-ltd-cloud-break', 'Fortescue Metals Group LTD, Cloud Break'),
        mv('name:workpac fmg', 'WorkPac- FMG'),
        mv('name:various', 'Various'), mv('name:n a', 'N/A'),
        mv('li:independent-metallurgical-operations-imo-', 'Independent Metallurgical Operations (IMO)'),
        mv('li:bhp', 'BHP', 'name:fortescue metals group', 'Fortescue Metals Group'),
    ], '2024-01', '2024-01', excluded)}
    check('fortescue: its own pages are not a source of its hires',
          not any(f in ('name:fmg', 'li:fortescue-metals-group-ltd-cloud-break') for f, _ in rows), rows)
    check('fortescue: an agency label stays a source',
          rows.get(('name:workpac fmg', 'li:fortescue')) == 1, rows)
    check('fortescue: a hire into one of its pages is a hire into it',
          rows.get(('li:bhp', 'li:fortescue')) == 1, rows)
    check('non-employers: the second seed\'s labels are dropped, a real firm is not',
          ('name:various', 'li:fortescue') not in rows and ('name:n a', 'li:fortescue') not in rows
          and rows.get(('li:independent-metallurgical-operations-imo-', 'li:fortescue')) == 1, rows)


def test_rio_tinto_lists():
    def mv(f, fn, t='li:rio-tinto', tn='Rio Tinto', month='2024-01'):
        return {'from_ref': f, 'from_name': fn, 'to_ref': t, 'to_name': tn, 'month': month}
    excluded = Counter()
    rows = {(r['from_ref'], r['to_ref']): r['moves'] for r in aggregate([
        mv('name:hamersley iron', 'Hamersley Iron'), mv('name:rio tinto coal australia', 'Rio Tinto Coal Australia'),
        mv('li:queensland-alumina-ltd', 'Queensland Alumina Limited'),
        mv('li:arcadiumlithium', 'Arcadium Lithium', month='2025-03'),
        mv('li:allkemltd', 'Allkem Limited', month='2023-11'),
        mv('li:arcadiumlithium', 'Arcadium Lithium', 'li:fortescue', 'Fortescue', month='2025-06'),
    ], '2020-01', '2026-12', excluded)}
    check('rio tinto: its own and old names are not a source of its hires',
          not any(f in ('name:hamersley iron', 'name:rio tinto coal australia') for f, _ in rows), rows)
    check('rio tinto: a joint venture that employs its own staff stays a source',
          rows.get(('li:queensland-alumina-ltd', 'li:rio-tinto')) == 1, rows)
    check('rio tinto: Arcadium after completion is a transfer, Allkem before it a hire',
          ('li:arcadiumlithium', 'li:rio-tinto') not in rows and
          rows.get(('li:allkemltd', 'li:rio-tinto')) == 1, rows)
    check('rio tinto: the acquisition rule touches no other buyer',
          rows.get(('li:arcadiumlithium', 'li:fortescue')) == 1, rows)


def test_window_end():
    counts = {'2025-06': 30, '2025-07': 26, '2025-08': 26, '2025-09': 23, '2025-10': 13}
    check('window end: the last month the data covers, not the cap',
          coverage_end(counts, '2026-06') == '2025-10')
    check('window end: never later than the cap',
          coverage_end(counts, '2025-08') == '2025-08')
    check('window end: one stray later profile does not move it',
          coverage_end(dict(counts, **{'2026-03': 1}), '2026-06') == '2025-10')
    check('window end: a gap in the run is skipped past',
          coverage_end({'2025-01': 5, '2025-02': 5, '2025-03': 5, '2025-05': 2, '2025-06': 1},
                       '2026-06') == '2025-03')
    check('window end: a year boundary counts as consecutive',
          coverage_end({'2024-11': 1, '2024-12': 1, '2025-01': 1}, '2026-06') == '2025-01')
    check('window end: nothing covered is None, not a guess',
          coverage_end({'2025-01': 3}, '2026-06') is None and coverage_end({}, '2026-06') is None)
    check('window end: the tail is reported oldest first, zero where empty',
          list(tail_counts(counts, '2025-10', 6).items()) ==
          [('2025-05', 0), ('2025-06', 30), ('2025-07', 26), ('2025-08', 26), ('2025-09', 23), ('2025-10', 13)])
    check('window end: the note says when the data stops short of the cap',
          'not at 2026-06' in window_note('2025-10', '2026-06') and
          'not at' not in window_note('2026-06', '2026-06'))


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


# Bright Data LinkedIn profile records. BD_SAMPLE is the `experience` of the
# one real profile in Bright Data's published sample output
# (brightdata/linkedin-scraper-python, examples/sample_output.json, read
# 2026-09-24) — a public figure's public roles, copied verbatim. The other
# records are synthetic, in the same shape.
BD_SAMPLE = [
    {"title": "Chairman and CEO", "location": "Greater Seattle Area", "description_html": None,
     "start_date": "Feb 2014", "end_date": "Present", "company": "Microsoft",
     "company_id": "microsoft", "url": "https://www.linkedin.com/company/microsoft",
     "company_logo_url": None},
    {"title": "Member Board Of Trustees", "description_html": None, "start_date": "2018",
     "end_date": "Present", "company": "University of Chicago",
     "url": "https://www.linkedin.com/school/uchicago/", "company_logo_url": None},
    {"title": "Board Member", "description_html": None, "start_date": "2017", "end_date": "2024",
     "company": "Starbucks", "company_id": "starbucks",
     "url": "https://www.linkedin.com/company/starbucks", "company_logo_url": None},
    {"title": "Chairman", "description_html": None, "start_date": "2021", "end_date": "2023",
     "company": "The Business Council U.S.", "company_id": "the-business-council-us",
     "url": "https://www.linkedin.com/company/the-business-council-us", "company_logo_url": None},
    {"title": "Board Member", "description_html": None, "start_date": "2016", "end_date": "2022",
     "company": "Fred Hutch", "company_id": "fredhutch",
     "url": "https://www.linkedin.com/company/fredhutch", "company_logo_url": None},
]


def _bd(company, slug, start, end, title='Engineer'):
    e = {'title': title, 'company': company, 'start_date': start, 'end_date': end,
         'url': f'https://www.linkedin.com/company/{slug}' if slug else None}
    if slug:
        e['company_id'] = slug
    return e


def test_bd_sample():
    r = positions_from_brightdata({'experience': BD_SAMPLE})
    got = [(p.company, p.slug, p.start, p.end) for p in r.positions]
    check('bd sample: the school entry is dropped and counted', r.dropped['school'] == 1, dict(r.dropped))
    check('bd sample: four employer entries kept', len(got) == 4, got)
    check('bd sample: "Feb 2014" to Present',
          got[0] == ('Microsoft', 'microsoft', Month(2014, 2), None), got[0])
    check('bd sample: bare years stay bare', got[1][2:] == (Month(2017, None), Month(2024, None)), got[1])
    m = moves_from(r.positions)
    check('bd sample: board seats and chair roles produce no move', m.moves == [], m.moves)


def test_bd_moves():
    r = positions_from_brightdata({'experience': [
        _bd('BHP', 'bhp', 'Mar 2023', 'Present', 'Senior Geologist'),
        _bd('Rio Tinto', 'riotinto', 'Feb 2020', 'Feb 2023'),
        _bd('Acme Drilling', None, 'Jan 2018', 'Dec 2019'),
    ]})
    m = [(x.from_ref, x.to_ref, x.month) for x in moves_from(r.positions).moves]
    check('bd: moves use the same rules and refs as the other sources',
          m == [('name:acme drilling', 'li:riotinto', '2020-02'),
                ('li:riotinto', 'li:bhp', '2023-03')], m)


def test_bd_refusals():
    r = positions_from_brightdata({'experience': [
        _bd('', 'x', 'Jan 2020', 'Present'),
        _bd('No Start', 'ns', None, 'Present'),
        _bd('Blank End', 'be', 'Jan 2019', ''),
        _bd('Odd End', 'oe', 'Jan 2019', 'sometime'),
        'not a dict',
    ]})
    check('bd: nothing usable, nothing guessed', r.positions == [], r.positions)
    check('bd: every refusal counted by reason',
          r.dropped == {'no_employer': 1, 'no_start_date': 1, 'unreadable_end_date': 2},
          dict(r.dropped))


def test_bd_grouped():
    r = positions_from_brightdata({'experience': [
        {'company': 'Woodside Energy', 'company_id': 'woodside-energy',
         'url': 'https://www.linkedin.com/company/woodside-energy',
         'positions': [
             {'title': 'Lead Engineer', 'start_date': 'Jan 2021', 'end_date': 'Present'},
             {'title': 'Engineer', 'start_date': 'Jan 2018', 'end_date': 'Dec 2020'}]},
        _bd('BHP', 'bhp', 'Mar 2014', 'Nov 2017'),
    ]})
    m = [(x.from_ref, x.to_ref, x.month) for x in moves_from(r.positions).moves]
    check('bd grouped: roles inherit the employer; a promotion is not a move',
          len(r.positions) == 3 and m == [('li:bhp', 'li:woodside-energy', '2018-01')], (r.positions, m))


def test_bd_empty():
    r = positions_from_brightdata({'experience': None})
    check('bd: no experience is no positions, not an error', r.positions == [] and not r.dropped)


for t in [test_links, test_clean, test_single, test_grouped, test_side_role,
          test_unknown_employer, test_year_only, test_ambiguous, test_boomerang,
          test_aggregate, test_acquisition, test_not_employers, test_same_employer, test_second_seed_lists, test_rio_tinto_lists, test_window_end, test_person_key, test_bd_sample, test_bd_moves,
          test_bd_refusals, test_bd_grouped, test_bd_empty]:
    t()

if failures:
    print(f'\n{failures} failure(s)')
    sys.exit(1)
print('\nall talent-flow parser checks passed')
