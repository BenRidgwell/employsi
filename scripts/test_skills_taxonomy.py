#!/usr/bin/env python3
"""Tests for scripts/skills_taxonomy.py — the shared reader every whole-of-market
vacancy generator uses to turn RAW_SKILLS into (skill, terms).

These exist because a tokeniser bug here is invisible: it produces a plausible
dataset with the wrong numbers in it. The original failure emitted a bare ', '
term from a double-quoted entry, which then matched almost every occupation
title and inflated one skill across four countries' data at once. Nothing
crashed and nothing looked obviously wrong.

Run: python3 scripts/test_skills_taxonomy.py
"""
from __future__ import annotations
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skills_taxonomy import (  # noqa: E402
    TaxonomyError,
    load_excepts,
    load_skills,
    matcher,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL_TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'


def tax(body: str) -> str:
    """Write a throwaway taxonomy file with `body` as the RAW_SKILLS contents."""
    fd, path = tempfile.mkstemp(suffix='.ts')
    with os.fdopen(fd, 'w') as f:
        f.write('const RAW_SKILLS: SkillDef[] = [\n' + body + '\n];\n')
    return path


class ParsesQuoting(unittest.TestCase):
    def test_double_quoted_term_is_read_whole(self):
        """The bug: "teacher's aide" is double-quoted because it has an
        apostrophe. A single-quote-only tokeniser reads the apostrophe as a
        delimiter and emits the separator between terms as a term."""
        p = tax("""  { skill: 'Education Support', cat: 'Education', """
                """terms: ['teacher aide', "teacher's aide", 'learning support'] },""")
        (name, terms), = load_skills(p)
        self.assertEqual(name, 'Education Support')
        self.assertEqual(terms, ['teacher aide', "teacher's aide", 'learning support'])
        self.assertNotIn(', ', terms)
        os.unlink(p)

    def test_escaped_single_quote_survives(self):
        p = tax("""  { skill: 'Test', cat: 'X', terms: ['worker\\'s comp', 'safety'] },""")
        (_, terms), = load_skills(p)
        self.assertEqual(terms, ["worker's comp", 'safety'])
        os.unlink(p)

    def test_non_latin_terms_are_kept(self):
        """The Zhaopin defs are legitimately two characters long — the validator
        must not treat 'short' as 'bogus'."""
        p = tax("""  { skill: 'Nursing', cat: 'Health', terms: ['护士', '护理'] },""")
        (_, terms), = load_skills(p)
        self.assertEqual(terms, ['护士', '护理'])
        os.unlink(p)

    def test_trailing_space_terms_are_kept(self):
        """'hr ', 'ai ', 'hv ' are intentional word-boundary terms."""
        p = tax("""  { skill: 'Human Resources', cat: 'Corporate', terms: ['hr ', 'recruit'] },""")
        (_, terms), = load_skills(p)
        self.assertEqual(terms, ['hr ', 'recruit'])
        os.unlink(p)


class RejectsGarbage(unittest.TestCase):
    def test_punctuation_only_term_raises(self):
        p = tax("""  { skill: 'Bad', cat: 'X', terms: ['ok term', ', '] },""")
        with self.assertRaises(TaxonomyError) as cm:
            load_skills(p)
        self.assertIn('no letter or digit', str(cm.exception))
        os.unlink(p)

    def test_empty_taxonomy_raises(self):
        p = tax('')
        with self.assertRaises(TaxonomyError):
            load_skills(p)
        os.unlink(p)

    def test_missing_raw_skills_raises(self):
        fd, p = tempfile.mkstemp(suffix='.ts')
        os.write(fd, b'export const NOTHING = 1;\n')
        os.close(fd)
        with self.assertRaises(TaxonomyError):
            load_skills(p)
        os.unlink(p)


class MergesDuplicateSkills(unittest.TestCase):
    def test_same_name_defs_merge_into_one_entry(self):
        """RAW_SKILLS declares some skills twice (English + Chinese + US-SOC).
        Two entries would let one title score the same skill twice."""
        p = tax("""  { skill: 'Software Engineering', cat: 'Digital', terms: ['developer'] },
  { skill: 'Software Engineering', cat: 'Digital', terms: ['software engineer', 'developer'] },""")
        skills = load_skills(p)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0][1], ['developer', 'software engineer'])
        os.unlink(p)

    def test_matcher_returns_each_skill_once(self):
        p = tax("""  { skill: 'Driving & Transport', cat: 'Transport', terms: ['truck driver'] },
  { skill: 'Driving & Transport', cat: 'Transport', terms: ['heavy and tractor-trailer'] },""")
        m = matcher(p)
        # Both defs match this title; the skill must still be counted once.
        self.assertEqual(m('Heavy and Tractor-Trailer Truck Drivers'), ['Driving & Transport'])
        os.unlink(p)


class RealTaxonomy(unittest.TestCase):
    """Guards against the specific mis-matches that reached generated data."""

    @classmethod
    def setUpClass(cls):
        # staticmethod: a plain function on a class would be bound and receive self.
        cls.match = staticmethod(matcher(REAL_TAX))
        cls.skills = load_skills(REAL_TAX)

    def test_parses_and_validates(self):
        # ~98 canonical skills after same-name defs merge (123 raw defs).
        self.assertGreater(len(self.skills), 90)

    def test_skill_names_are_unique(self):
        names = [n for n, _ in self.skills]
        self.assertEqual(len(names), len(set(names)))

    def test_truck_driver_is_not_a_performing_artist(self):
        """'actor' is a substring of 'tractor'."""
        hits = self.match('Heavy and Tractor-Trailer Truck Drivers')
        self.assertNotIn('Creative & Performing Arts', hits)
        self.assertIn('Driving & Transport', hits)

    def test_credit_authorizer_is_not_a_journalist(self):
        """'author' is a substring of 'authorizer'."""
        self.assertNotIn('Journalism & Media',
                         self.match('Credit Authorizers, Checkers, and Clerks'))

    def test_real_arts_titles_still_match(self):
        for title in ('Actors', 'Actors, Dancers and Other Entertainers'):
            self.assertIn('Creative & Performing Arts', self.match(title), title)
        self.assertIn('Journalism & Media', self.match('Writers and Authors'))

    def test_generic_office_titles_do_not_match_everything(self):
        """The regression that started this: these matched Education Support."""
        for title in ('Janitors and Cleaners, Except Maids and Housekeeping Cleaners',
                      'Laborers and Freight, Stock, and Material Movers, Hand'):
            self.assertNotIn('Education Support', self.match(title), title)

    def test_us_soc_titles_map_to_existing_skills(self):
        cases = {
            'Retail Salespersons': 'Retail & Customer Service',
            'Cashiers': 'Retail & Customer Service',
            'Stockers and Order Fillers': 'Warehousing & Logistics',
            'First-Line Supervisors of Retail Sales Workers': 'Leadership & Coordination',
            'Information Security Analysts': 'Cybersecurity',
            'Computer User Support Specialists': 'IT & Systems',
            'Financial Managers': 'Finance & Accounting',
            'Software Developers': 'Software Engineering',
            'Registered Nurses': 'Nursing',
        }
        for title, skill in cases.items():
            self.assertIn(skill, self.match(title), title)

    def test_entry_with_a_comment_above_skill_is_still_read(self):
        """A comment between `{` and `skill:` used to hide the whole entry.

        Both skills below were added to RAW_SKILLS that way, and the result was
        not an error: every generator quietly produced datasets with no Data
        Engineering and no Business Analysis in them at all, while the app —
        which parses the same file as TypeScript — showed both. Nothing pointed
        at the parser, because a short list looks exactly like a taxonomy that
        never had those skills.
        """
        names = {n for n, _ in load_skills(REAL_TAX)}
        for skill in ('Data Engineering', 'Business Analysis'):
            self.assertIn(skill, names, f'{skill} lost to a comment before `skill:`')

    def test_agency_occupation_titles_reach_the_right_skill(self):
        """The published unit-group titles, which is all a release contains.

        No classification says "data engineer" or "business analyst", so
        matching only the ad-side vocabulary left both skills with no
        whole-of-market reading in any country.
        """
        cases = [
            # ANZSCO (JSA IVI, and NZ, which shares the classification)
            ('ICT Business and Systems Analysts', 'Business Analysis'),
            ('Database and Systems Administrators, and ICT Security Specialists',
             'Data Engineering'),
            # US SOC (BLS OEWS)
            ('Computer Systems Analysts', 'Business Analysis'),
            ('Database Administrators', 'Data Engineering'),
            ('Database Architects', 'Data Engineering'),
            # ISCO-08 (Eurostat, and PSOC which follows it)
            ('Database and network professionals', 'Data Engineering'),
            # PSOC 4-digit, from the Philippine ISLE tables. Both of these were
            # found mapping WRONG rather than merely missing: "Database
            # Designers and Administrators" was landing in office support and
            # nowhere else, and "Systems Analysts" — ISCO 2511, where business
            # analysts live — carried no Business Analysis at all.
            ('Database Designers and Administrators', 'Data Engineering'),
            ('Systems Analysts', 'Business Analysis'),
            # UK SOC 2020 — matches on the ad-side term, no extra needed
            ('IT business analysts, architects and systems designers', 'Business Analysis'),
        ]
        for title, skill in cases:
            self.assertIn(skill, self.match(title), title)

    def test_agency_terms_do_not_widen_beyond_their_occupation(self):
        """The new terms are published titles, so they must not catch adjacent
        occupations that belong to other skills."""
        for title in ('Computer Network Professionals',
                      'Software and Applications Programmers',
                      'Management and Organisation Analysts'):
            self.assertNotIn('Data Engineering', self.match(title), title)
            self.assertNotIn('Business Analysis', self.match(title), title)

    def test_except_suppresses_the_ict_administrator(self):
        """"administrator" is right for the office kind and wrong for the ICT one.

        Measured on the live archive: 525 ads in 90 days contain "administrator"
        and only 64 are database/systems administrators, so deleting the term to
        fix those 64 would have cost the other 461. The `except` list on
        Administration & Office Support separates them by the word BEFORE the
        match, which no positive term can do.
        """
        for title in ('Database and Systems Administrators, and ICT Security Specialists',
                      'Database administrators and web content technicians',
                      'Database Designers and Administrators',
                      'Senior Systems Administrator',
                      'Database Administrator'):
            self.assertNotIn('Administration & Office Support', self.match(title), title)
        # …and the office kind is untouched.
        for title in ('Site Administrator', 'Office Administrator', 'Sales administrators',
                      'Data entry administrators', 'Contract, Program and Project Administrators'):
            self.assertIn('Administration & Office Support', self.match(title), title)

    def test_hr_the_licence_and_hr_the_department_are_separated(self):
        """"HR" names a truck licence and an hourly rate as well as a department.

        Measured on the live archive: the matcher tagged 2875 ads Human
        Resources over 90 days and 692 of them were not HR at all — Heavy Rigid
        licence ads ("HR Driver" was the commonest HR title in the archive at 39
        ads), pay rates ("$49/hr"), and talent pools wrapping some other
        occupation entirely. Deleting the terms was not available: "hr " is the
        only thing matching "HR Business Partner", and bare "talent" carries
        "Senior Director, Global Talent".
        """
        for title in ('HR Driver', 'HR Truck Driver', 'MR/HR Truck Driver (Civil)',
                      'Warehouse Storeperson - HR Forklift', 'Local - HR Driver - Kalgoorlie',
                      '$24/hr Bonuses Driving in Sunnyvale!',
                      'Respiratory Therapist (RT) - up to $49/hr',
                      'EOI Talent Community: Mechanical Fitters',
                      'Dragline Operators | Saraji | BMA | Talent Pool',
                      'Visy Workforce - Multi-Site Electrician'):
            self.assertNotIn('Human Resources', self.match(title), title)
        # …and the department is untouched.
        for title in ('HR Business Partner', 'HR Advisor', 'HR Manager', 'Human Resources Advisor',
                      'Talent Acquisition Specialist', 'Senior Director, Global Talent',
                      'Workforce Planner', 'People and Culture Business Partner',
                      'Employee Relations Advisor'):
            self.assertIn('Human Resources', self.match(title), title)

    def test_hr_licence_ads_still_reach_the_skill_they_are(self):
        """Suppressing HR must not leave a driving ad with no skill at all."""
        self.assertIn('Driving & Transport', self.match('HR Truck Driver'))
        self.assertIn('Driving & Transport', self.match('HR Driver'))
        self.assertIn('Warehousing & Logistics',
                      self.match('Warehouse Storeperson - HR Forklift'))

    def test_hr_except_does_not_touch_the_agency_occupations(self):
        """The whole-of-market series feed published unit-group titles through
        this same matcher, so an except written against AD titles must not move
        a national number."""
        for title in ('Human Resource Managers', 'Human Resource Professionals',
                      'Human Resource Advisers', 'Human Resource Clerks',
                      'Training and Development Professionals', 'Recruitment Consultants',
                      'Human Resources Specialists'):
            self.assertIn('Human Resources', self.match(title), title)
        for title in ('Truck Drivers', 'Truck Drivers, Heavy and Tractor-Trailer',
                      'Heavy Truck and Tractor-Trailer Drivers'):
            self.assertIn('Driving & Transport', self.match(title), title)
            self.assertNotIn('Human Resources', self.match(title), title)

    def test_excepts_are_read_at_all(self):
        """A negative rule the reader silently ignores is worse than none: the
        app would apply it and the generated datasets would not."""
        ex = load_excepts(REAL_TAX)
        self.assertIn('Administration & Office Support', ex)
        self.assertIn('database administrator', ex['Administration & Office Support'])

    def test_an_entry_with_except_still_parses_completely(self):
        """`except` sits after `terms`; a reader that cannot see it would drop
        the whole entry, which is the failure this file exists to prevent."""
        names = {n for n, _ in load_skills(REAL_TAX)}
        self.assertIn('Administration & Office Support', names)

    def test_anzsco_and_ons_titles_still_map(self):
        """The US additions must not have disturbed the original sources."""
        cases = {
            'Mining Engineers': 'Mining Engineering',
            'Metal Fitters and Machinists': 'Mechanical Fitting',
            'Education Aides': 'Teaching & Education',
            'Contract, Program and Project Administrators': 'Project Management',
        }
        for title, skill in cases.items():
            self.assertIn(skill, self.match(title), title)


if __name__ == '__main__':
    unittest.main(verbosity=2)
