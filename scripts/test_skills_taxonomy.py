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
from skills_taxonomy import TaxonomyError, load_skills, matcher  # noqa: E402

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
