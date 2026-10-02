#!/usr/bin/env python3
"""Build src/employsi/data/onetRoles.ts: each career-pathway rung mapped to an
O*NET occupation, with that occupation's core tasks and software.

    python scripts/gen-onet-roles.py <O*NET db text folder>
    python scripts/gen-onet-roles.py <folder> --review   # the table to review

Download: https://www.onetcenter.org/dl_files/database/db_31_0_text.zip
O*NET is (c) the U.S. Department of Labor, Employment and Training
Administration, licensed CC BY 4.0 — the card must credit it.

WHAT THIS IS AND IS NOT. The tasks and tools come from O*NET's US surveys of
people doing each occupation. They describe what the job typically involves;
they were NOT measured from our ads, and the card must say so rather than
present them beside our counts as if they were.

HOW A RUNG FINDS ITS OCCUPATION: the reviewed TABLE below, and nothing else.

The matcher here only SUGGESTS, for --review: it looks the rung's commonest
advertised titles up in O*NET's ~62,000 job titles (Job Titles + Sample of
Reported Titles), weighted by how many roles carried each, stripping a grade
prefix when the whole title has no match. Measured 2026-09-29 on the 510
rungs it reaches 71% of them — and a good third of those were wrong: "chief
people officer" landed on Probation Officers, "business development manager"
on Wind Energy Development Managers, "data analyst" on Survey Researchers,
"chief revenue officer" on Tax Examiners and Revenue Agents. That is why no
match reaches the data file without a human reading it first.

A rung the table has no entry for is left out and listed by --review and at
the end of every run, so a rung added to careerPathways.ts waits for a
decision rather than inheriting a guess. A rung O*NET has no honest
equivalent for is None, and the card shows nothing for it.
"""
import json
import re
import sys
from collections import defaultdict

ROOT = __file__.rsplit('/scripts/', 1)[0]
PATHWAYS = f'{ROOT}/src/employsi/data/careerPathways.ts'
OUT = f'{ROOT}/src/employsi/data/onetRoles.ts'
VERSION = '31.0'

TASKS_PER_OCC = 6
SOFTWARE_PER_OCC = 10

# Tried one at a time from the front of a title when the whole title has no
# match. Grade words only — never a word that changes the occupation.
MOD = re.compile(
    r'^(senior|snr|sr|lead|principal|chief|head of|acting|junior|jnr|jr|graduate|grad|trainee|'
    r'assistant|associate|deputy|interim|group|national|regional|executive|specialist|'
    r'experienced|qualified|casual|temporary|temp|contract|part time|full time)\s+'
)

# AU/UK spelling -> the US spelling O*NET files titles under.
SPELL = {
    'labour': 'labor', 'organisational': 'organizational', 'organisation': 'organization',
    'programme': 'program', 'centre': 'center', 'paediatric': 'pediatric',
    'anaesthetist': 'anesthesiologist', 'anaesthetic': 'anesthesia', 'haematology': 'hematology',
    'orthopaedic': 'orthopedic', 'licence': 'license', 'defence': 'defense',
    'behaviour': 'behavior', 'analyse': 'analyze', 'optimisation': 'optimization',
}

# ---- The reviewed table -------------------------------------------------------
# family|track -> {rung: O*NET-SOC code, or None}. THIS IS THE MAPPING: the
# matcher only suggests (see --review). A rung missing from here is not shown,
# so a new rung appearing in careerPathways.ts waits for a human decision
# instead of inheriting a guess. Reviewed 2026-09-29 against O*NET 31.0.
#
# The rules the entries follow:
# - Where O*NET files the advertised title itself, that filing wins unless its
#   tasks misdescribe the job — "payroll manager" is O*NET's own entry under
#   Compensation and Benefits Managers, so it stays; "actuarial manager" is
#   filed under Financial Managers, whose tasks are about statements, not
#   actuarial work, so it is overridden to Actuaries.
# - None where the rung MIXES occupations (allied generalist is physio, OT,
#   speech and dietetics in one rung) or where the discipline is unknowable
#   from the title (lecturer, research fellow, graduate engineer, teacher). A
#   single occupation's tasks there would describe a quarter of the roles.
# - None where O*NET has no counterpart: workforce planning, general
#   insurance. The nearest-sounding US occupation is not a counterpart.
# - A senior rung with no management occupation of its own keeps its
#   specialist occupation; the card names the occupation, so that is visible.
TABLE: dict[str, dict[int, str | None]] = {
    # Human resources
    'hr|generalist': {1: '43-4161.00', 2: '13-1071.00', 3: '13-1071.00', 4: '11-3121.00',
                      5: '11-3121.00', 6: '11-3121.00'},
    # Rung 1 (ER/IR interns, graduates, a workplace-relations coordinator) keeps
    # the track's specialist occupation, as hr|hr-systems|1 and hr|learning|1 do:
    # the work is labour relations from the first rung, not HR administration.
    'hr|employee-relations': {1: '13-1075.00', 2: '13-1075.00', 3: '13-1075.00',
                              4: '11-3121.00', 5: '11-3121.00'},
    # O*NET files "HRIS analyst" under Human Resources Specialists itself.
    'hr|hr-systems': {1: '13-1071.00', 2: '13-1071.00', 3: '13-1071.00', 4: '11-3121.00'},
    'hr|learning': {1: '13-1151.00', 2: '13-1151.00', 3: '13-1151.00', 4: '11-3131.00',
                    5: '11-3131.00'},
    'hr|reward': {1: '13-1141.00', 2: '13-1141.00', 3: '13-1141.00', 4: '11-3111.00'},
    'hr|talent-acquisition': {1: '13-1071.00', 2: '13-1071.00', 3: '13-1071.00',
                              4: '11-3121.00', 5: '11-3121.00'},
    'hr|workforce': {1: None, 2: None, 3: None, 4: None, 5: None},
    'payroll|generalist': {1: '43-3051.00', 2: '43-3051.00', 3: '43-3051.00', 4: '11-3111.00',
                           5: '11-3111.00'},
    # Finance. Financial and Investment Analysts has analyst-written tasks only.
    'finance|generalist': {1: '43-3031.00', 2: '13-2011.00', 3: '13-2011.00', 4: '11-3031.00',
                           5: '11-3031.00', 6: '11-1011.00'},
    'finance|fpa': {1: '13-2051.00', 2: '13-2051.00', 3: '13-2051.00', 4: '11-3031.00',
                    5: '11-3031.00'},
    # An Australian tax accountant is an accountant, not a US Tax Preparer.
    'finance|tax': {1: '13-2011.00', 2: '13-2011.00', 3: '13-2011.00', 4: '11-3031.00',
                    5: '11-3031.00'},
    # "Treasury analyst" is also filed under Financial Examiners, which are
    # regulators; a corporate treasury is Treasurers and Controllers.
    'finance|treasury': {1: '13-2051.00', 2: '13-2051.00', 3: '13-2051.00', 4: '11-3031.01',
                         5: '11-3031.01'},
    # Nursing. An Australian "clinical nurse" is an experienced RN, not the US
    # advanced-practice Clinical Nurse Specialist.
    'nursing|generalist': {1: '29-2061.00', 2: '29-1141.00', 3: '29-1141.00', 4: '29-1171.00',
                           5: '11-9111.00'},
    'nursing|midwifery': {1: '29-1161.00', 2: '29-1161.00', 3: '29-1161.00', 4: '11-9111.00',
                          5: '11-9111.00', 6: '11-9111.00'},
    # Projects. "Project manager" is filed under Architectural and Engineering
    # Managers, which only fits engineering projects; SOC 13-1082 is the
    # general project occupation.
    'project|generalist': {1: '13-1082.00', 2: '13-1082.00', 3: '13-1082.00', 4: '13-1082.00',
                           5: '13-1082.00'},
    'project|controls': {2: '13-1082.00', 3: '13-1082.00', 4: '13-1082.00', 5: '13-1082.00'},
    # Technology. CTO, CIO and CISO are Computer and Information Systems
    # Managers in the BLS definitions, whatever the title list says.
    'software|generalist': {1: '15-1252.00', 2: '15-1252.00', 3: '15-1252.00', 4: '15-1252.00',
                            5: '11-3021.00', 6: '11-3021.00'},
    'technology|generalist': {1: '15-1232.00', 2: '15-1244.00', 3: '15-1244.00',
                              4: '11-3021.00', 5: '11-3021.00', 6: '11-3021.00'},
    'technology|security': {1: '15-1299.05', 2: '15-1299.05', 3: '15-1299.05', 4: '15-1299.05',
                            5: '11-3021.00', 6: '11-3021.00'},
    'technology|support': {1: '15-1232.00', 2: '15-1232.00', 3: '15-1232.00', 4: '11-3021.00'},
    'technology|architecture': {4: '15-1299.08'},
    'technology|enterprise-apps': {1: '15-1211.00', 2: '15-1211.00', 3: '15-1211.00',
                                   4: '11-3021.00', 5: '11-3021.00'},
    # Rung 6 is None: of its 12 roles a chief data officer and a data-governance
    # VP are data executives, but an SVP Communications and an SVP Clinical
    # Insights landed here on the word 'analytics'. The matcher suggested
    # Database Architects via 'chief data officer', which is not that job.
    'data|generalist': {1: '15-2051.01', 2: '15-2051.01', 3: '15-2051.01', 4: '11-3021.00',
                        5: '11-3021.00', 6: None},
    'data|engineering': {1: '15-1243.00', 2: '15-1243.00', 3: '15-1243.00', 4: '15-1243.00',
                         5: '11-3021.00'},
    'data|science': {1: '15-2051.00', 2: '15-2051.00', 3: '15-2051.00', 4: '15-2051.00',
                     5: '11-3021.00'},
    # O*NET files "business analyst" under Management Analysts and "product
    # manager" under Marketing Managers; both are its own entries.
    'product|generalist': {1: '13-1111.00', 2: '13-1111.00', 3: '13-1111.00', 4: '13-1111.00'},
    'product|product': {2: '13-1161.00', 3: '11-2021.00', 4: '11-2021.00', 5: '11-2021.00'},
    # Retail and sales
    'retail|generalist': {1: '41-2031.00', 2: '41-1011.00', 3: '41-1011.00', 4: '41-1011.00',
                          5: '11-1021.00'},
    # Rungs 3 and 4 (senior VM, assistant VM manager, VM manager) stay on the
    # display occupation: O*NET has no visual-merchandising management entry, and
    # First-Line Supervisors of Retail Sales Workers supervises selling, not
    # display. The matcher agreed on rung 3 via 'senior visual merchandiser'.
    'retail|visual-merchandising': {2: '27-1026.00', 3: '27-1026.00', 4: '27-1026.00'},
    'sales|generalist': {1: '41-4012.00', 2: '41-4012.00', 3: '41-4012.00', 4: '11-2022.00',
                         5: '11-2022.00', 6: '11-2022.00'},
    'sales|account-management': {1: '41-4012.00', 2: '41-4012.00', 3: '41-4012.00',
                                 4: '11-2022.00', 5: '11-2022.00'},
    'marketing|generalist': {1: '13-1161.00', 2: '13-1161.00', 3: '13-1161.00', 4: '11-2021.00',
                             5: '11-2021.00', 6: '11-2021.00'},
    'marketing|communications': {1: '27-3031.00', 2: '27-3031.00', 3: '27-3031.00',
                                 4: '11-2032.00', 5: '11-2032.00'},
    # Procurement and commercial
    'procurement|generalist': {1: '43-3061.00', 2: '13-1023.00', 3: '13-1023.00',
                               4: '11-3061.00', 5: '11-3061.00'},
    'procurement|buying': {1: '13-1022.00', 2: '13-1022.00', 3: '13-1022.00', 4: '11-3061.00'},
    'procurement|supply-chain': {1: '13-1081.00', 2: '13-1081.00', 3: '13-1081.00',
                                 4: '11-3071.04', 5: '11-3071.04'},
    'commercial|generalist': {1: '13-1023.00', 2: '13-1023.00', 3: '13-1023.00', 4: '13-1023.00',
                              5: None},
    'commercial|quantity-surveying': {1: '13-1051.00', 2: '13-1051.00', 3: '13-1051.00',
                                      4: '13-1051.00'},
    # Management consultants are O*NET's own entry under Management Analysts.
    # Rung 6 (SVP / VP strategy) keeps Management Analysts: the whole track is
    # that occupation and O*NET has no strategy-executive entry.
    'strategy|generalist': {1: '13-1111.00', 2: '13-1111.00', 3: '13-1111.00', 4: '13-1111.00',
                            5: '13-1111.00', 6: '13-1111.00'},
    # Rung 1 is strategy-consulting interns and graduate programmes — the same
    # occupation from the first rung, as strategy|generalist|1 already is.
    'strategy|consulting': {1: '13-1111.00', 2: '13-1111.00', 3: '13-1111.00',
                            4: '13-1111.00', 5: '13-1111.00'},
    'policy|generalist': {1: '19-3094.00', 2: '19-3094.00', 3: '19-3094.00', 4: '19-3094.00',
                          5: '19-3094.00'},
    # Stakeholder and government relations are PR occupations in the SOC.
    'community|generalist': {1: '27-3031.00', 2: '27-3031.00', 3: '27-3031.00', 4: '11-2032.00',
                             5: '11-2032.00'},
    'community|heritage': {1: '19-3091.00', 2: '19-3091.00', 3: '19-3091.00', 4: '19-3091.00'},
    # Risk, legal, insurance, banking
    'hse|generalist': {1: '19-5011.00', 2: '19-5011.00', 3: '19-5011.00', 4: '19-5011.00',
                       5: '19-5011.00'},
    'legal|generalist': {1: '23-2011.00', 2: '23-1011.00', 3: '23-1011.00', 4: '23-1011.00',
                         5: '23-1011.00'},
    'legal|in-house': {2: '23-1011.00', 3: '23-1011.00', 4: '23-1011.00', 5: '23-1011.00'},
    'risk|generalist': {1: '13-2054.00', 2: '13-2054.00', 3: '13-2054.00', 4: '11-9199.02',
                        5: '11-9199.02', 6: '11-9199.02'},
    'risk|compliance': {1: '13-1041.00', 2: '13-1041.00', 3: '13-1041.00', 4: '11-9199.02',
                        5: '11-9199.02', 6: '11-9199.02'},
    'risk|audit': {1: '13-2011.00', 2: '13-2011.00', 3: '13-2011.00', 4: '13-2011.00',
                   5: '13-2011.00'},
    'quality|generalist': {1: '51-9061.00', 2: '17-2112.00', 3: '17-2112.00', 4: '11-3051.01',
                           5: '11-3051.01'},
    'insurance|generalist': {1: None, 2: None, 3: None, 4: None, 5: None},
    'insurance|actuarial': {1: '15-2011.00', 2: '15-2011.00', 3: '15-2011.00', 4: '15-2011.00',
                            5: '15-2011.00'},
    'insurance|claims': {1: '43-9041.00', 2: '13-1031.00', 3: '13-1031.00', 4: '13-1031.00'},
    'insurance|underwriting': {1: '43-9041.00', 2: '13-2053.00', 3: '13-2053.00',
                               4: '13-2053.00', 5: '13-2053.00'},
    # Rung 4 is None for the reason rungs 3 and 5 are: it mixes branch managers
    # (whom O*NET files under Financial Managers) with transactional and health
    # banking relationship managers, who are sellers. 4 of 7 roles one way.
    'banking|generalist': {1: '43-3071.00', 2: '43-4141.00', 3: None, 4: None, 5: None},
    # Rungs 3 and 5 are the same advice work retitled (financial planner /
    # relationship manager; wealth advisor director). Financial Managers' tasks
    # are statements and treasury, so a director of advice is not one.
    'banking|advice': {1: '13-2052.00', 2: '13-2052.00', 3: '13-2052.00', 4: '13-2052.00',
                       5: '13-2052.00'},
    'banking|investment-banking': {2: '13-2051.00', 3: '13-2051.00', 4: '13-2051.00',
                                   5: '13-2051.00'},
    'banking|lending': {1: '43-4131.00', 2: '13-2072.00', 3: '13-2072.00', 4: '13-2072.00',
                        5: '13-2072.00'},
    # Business-banking relationship managers are lenders; "relationship
    # manager" is otherwise filed only under Public Relations Managers.
    'banking|relationship': {1: '43-4051.00', 2: '13-2072.00', 3: '13-2072.00',
                             4: '13-2072.00', 5: '13-2072.00'},
    # Property, records, creative
    'property|generalist': {1: '11-9141.00', 2: '11-9141.00', 3: '11-9141.00', 4: '11-9141.00'},
    'property|agency': {2: '41-9022.00', 4: '11-9141.00'},
    # Rung 3 is senior and managing valuers — the same appraisal occupation.
    'property|valuation': {2: '13-2023.00', 3: '13-2023.00'},
    'library|generalist': {1: '25-4031.00', 2: '25-4022.00', 3: '25-4022.00', 4: '25-4022.00'},
    'library|records': {1: '15-1299.03', 2: '15-1299.03', 3: '15-1299.03', 4: '15-1299.03'},
    'creative|generalist': {1: None, 2: None, 3: None, 4: '27-1011.00', 5: '27-1011.00'},
    'creative|media': {1: None, 2: None, 3: None, 4: '27-3042.00'},
    # Rung 3 is None for the reason rung 2 is: one senior portrait photographer
    # beside a 3D artist, a videographer, a footwear designer and a performer.
    # The matcher's Photographers would describe one role of five.
    'creative|performing': {2: None, 3: None, 4: '27-2012.00'},
    # Health. An Australian "medical scientist" works a diagnostic lab — US
    # Medical and Clinical Laboratory Technologists, not research Medical
    # Scientists.
    'medical|generalist': {2: '29-1229.02', 3: '29-1229.02', 4: '29-1215.00', 5: '11-9111.00',
                           6: '11-9111.00'},
    'allied|generalist': {1: None, 2: None, 3: None, 4: None, 5: None},
    'allied|imaging': {1: None, 2: '29-2034.00', 3: '29-2034.00', 4: '29-2034.00'},
    # Rung 4 is supervising scientists: the same laboratory occupation.
    'allied|pathology': {1: '31-9097.00', 2: '29-2011.00', 3: None, 4: '29-2011.00'},
    'allied|pharmacy': {1: '29-2052.00', 2: '29-1051.00', 3: '29-1051.00', 4: '29-1051.00',
                        5: '29-1051.00'},
    'dental|generalist': {1: '31-9091.00', 2: '29-1292.00', 3: '29-1021.00', 4: None,
                          5: '11-9111.00'},
    'care|generalist': {1: '31-1122.00', 2: '31-1122.00', 3: '11-9111.00', 4: '11-9111.00'},
    'care|mental-health': {1: '21-1093.00', 2: '19-3033.00', 3: '19-3033.00'},
    'care|social-work': {1: '21-1093.00', 2: '21-1023.00', 3: '21-1023.00', 4: '11-9151.00',
                         5: '11-9151.00'},
    'emergency|generalist': {1: None, 2: None, 3: '29-2043.00'},
    'emergency|justice': {2: '33-3012.00', 3: '33-1011.00', 4: '33-1011.00', 5: '33-1011.00'},
    'emergency|policing': {1: '33-3051.00', 2: '33-3051.00'},
    'emergency|security': {1: '33-9032.00', 2: '33-9032.00', 3: '33-1091.00', 4: '11-3013.01'},
    # Science. Environmental officers and advisors are Environmental
    # Scientists and Specialists; the compliance inspector entry is a regulator.
    'science|environmental': {1: '19-2041.00', 2: '19-2041.00', 3: '19-2041.00',
                              4: '19-2041.00'},
    'science|generalist': {1: None, 2: None, 3: None, 4: None, 5: '11-9121.00'},
    'science|research': {1: None, 2: None, 3: None, 4: None},
    'science|veterinary': {1: '29-2056.00', 2: '29-1131.00', 3: '29-2056.00', 4: '29-1131.00'},
    # Engineering and the built environment
    'engineering|generalist': {1: None, 2: None, 3: None, 4: None, 5: '11-9041.00'},
    'engineering|civil': {1: '17-2051.00', 2: '17-2051.00', 3: '17-2051.00', 4: '17-2051.00',
                          5: '11-9041.00'},
    'engineering|electrical': {1: '17-2071.00', 2: '17-2071.00', 3: '17-2071.00',
                               4: '17-2071.00', 5: '11-9041.00'},
    'engineering|mechanical': {1: '17-2141.00', 2: '17-2141.00', 3: '17-2141.00',
                               4: '17-2141.00', 5: '11-9041.00'},
    'engineering|mining': {1: '17-2151.00', 2: '17-2151.00', 3: '17-2151.00', 4: '17-2151.00'},
    'engineering|process': {1: '17-2041.00', 2: '17-2041.00', 3: '17-2041.00', 4: '17-2041.00'},
    'geoscience|generalist': {1: '19-4043.00', 2: '19-2042.00', 3: '19-2042.00',
                              4: '19-2042.00'},
    'geoscience|surveying': {1: '17-1022.00', 2: '17-1022.00', 3: '17-1022.00'},
    'architecture|generalist': {1: '17-1011.00', 2: '17-1011.00', 3: '17-1011.00',
                                4: '17-1011.00', 5: '17-1011.00'},
    'architecture|drafting': {1: '17-3011.00', 2: '17-3011.00', 3: '17-3011.00',
                              4: '17-3011.00'},
    'architecture|planning': {1: '19-3051.00', 2: '19-3051.00', 3: '19-3051.00',
                              4: '19-3051.00'},
    'construction|generalist': {2: '47-1011.00', 3: '47-1011.00', 4: '11-9021.00',
                                5: '11-9021.00'},
    # Trades. An Australian boilermaker fabricates and welds; the US
    # Boilermakers occupation builds boilers.
    'trades|generalist': {1: None, 2: None, 3: '47-1011.00', 4: '47-1011.00'},
    'trades|electrical': {1: '47-3013.00', 2: '47-2111.00', 3: '47-1011.00'},
    'trades|fabrication': {1: '51-4121.00', 2: '51-4121.00', 3: '51-1011.00'},
    'trades|mechanical': {1: '49-9041.00', 2: '49-9041.00', 3: '49-1011.00'},
    'operations|generalist': {1: None, 2: None, 3: '51-1011.00', 4: '11-3051.00'},
    'operations|mining': {1: '47-5044.00', 2: '47-5022.00', 3: '47-1011.00', 4: '11-1021.00'},
    'facilities|generalist': {1: '37-2011.00', 3: '37-1011.00', 4: '37-1011.00',
                              5: '37-1011.00'},
    # Rung 5 (head of / director of facilities) is still a Facilities Manager.
    'facilities|facilities': {1: '37-3011.00', 2: '11-3013.00', 3: '11-3013.00',
                              4: '11-3013.00', 5: '11-3013.00'},
    # Rung 5 (agriculture director) keeps rung 4's agricultural-manager filing.
    'agriculture|generalist': {1: '45-2093.00', 2: None, 3: '45-2093.00', 4: '11-9013.00',
                               5: '11-9013.00'},
    # Services
    'personal|fitness': {2: '39-9031.00', 3: '27-2022.00', 4: '11-9179.01'},
    'personal|generalist': {1: '39-5012.00', 2: '39-5012.00', 3: '39-5012.00',
                            4: '39-1022.00'},
    'hospitality|generalist': {1: '35-3023.01', 2: '35-1012.00', 3: '35-1012.00',
                               4: '11-9051.00', 5: '11-9051.00'},
    'hospitality|kitchen': {1: '35-2014.00', 2: '35-1011.00', 3: '35-1011.00', 4: '35-1011.00',
                            5: '35-1011.00'},
    'hospitality|food-trades': {1: '51-3011.00', 2: '51-3011.00', 3: '51-3011.00'},
    'education|generalist': {1: None, 2: None, 3: None, 4: '11-9032.00', 5: '11-9032.00'},
    'education|academic': {1: None, 2: None, 3: None, 4: None, 5: None},
    'education|early-childhood': {1: '39-9011.00', 2: '25-2011.00', 3: '11-9031.00',
                                  4: '11-9031.00'},
    'education|education-support': {1: '25-9042.00', 2: '25-9042.00', 4: '25-9042.00'},
    # Rung 5 (warehouse director, head of logistics) keeps rung 4's filing.
    'logistics|generalist': {1: '53-7062.00', 2: '13-1081.00', 3: '53-1043.00',
                             4: '11-3071.00', 5: '11-3071.00'},
    'logistics|driving': {1: '53-3033.00', 2: '53-3032.00', 3: '53-3032.00', 4: '11-3071.00'},
    'admin|generalist': {1: '43-6014.00', 2: '43-9061.00', 3: '43-9061.00', 4: '11-3012.00'},
    'admin|executive-assistant': {1: '43-6011.00', 2: '43-6011.00', 3: '43-6011.00',
                                  4: '43-6011.00'},
}


def rows(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        header = f.readline().rstrip('\n').split('\t')
        for line in f:
            cells = line.rstrip('\n').split('\t')
            if len(cells) >= len(header):
                yield dict(zip(header, cells))


def norm(t):
    t = t.lower().replace('&', ' and ')
    t = re.sub(r'\([^)]*\)', ' ', t)
    t = re.sub(r'[^a-z0-9 ]+', ' ', t)
    words = [SPELL.get(w, w) for w in t.split()]
    return ' '.join(words)


def load_nodes():
    out = []
    for line in open(PATHWAYS, encoding='utf-8'):
        s = line.strip().rstrip(',')
        if s.startswith('{"family"') and '"titles":' in s:
            n = json.loads(s)
            out.append(n)
    return out


def rung_id(n):
    return f"{n['family']}|{n['track']}|{n['rung']}"


def load_onet(d):
    occ = {r['O*NET-SOC Code']: r['Title'] for r in rows(f'{d}/Occupation Data.txt')}
    # title -> {code: weight}. One title is often filed under several
    # occupations ("financial analyst" sits under Statisticians too), so the
    # sources are ranked: the occupation's own name, then a title incumbents
    # reported, then O*NET's long alternate-title list.
    index = defaultdict(dict)

    def add(title, code, w):
        k = norm(title)
        index[k][code] = max(index[k].get(code, 0), w)

    for code, title in occ.items():
        add(title, code, 4)
        # "Human Resources Managers" is filed plural; ads are singular.
        add(re.sub(r's$', '', title), code, 4)
    for r in rows(f'{d}/Sample of Reported Titles.txt'):
        add(r['Reported Job Title'], r['O*NET-SOC Code'], 2)
    for r in rows(f'{d}/Job Titles.txt'):
        add(r['Job Title'], r['O*NET-SOC Code'], 1)

    # Core tasks, ranked by O*NET's importance rating. Twelve occupations —
    # Financial and Investment Analysts and Financial Risk Specialists among
    # them — carry analyst-written tasks with no survey ratings yet (Task Type
    # "n/a"); those keep O*NET's own order and a null score, rather than
    # leaving the rung blank. Supplemental tasks are never shown.
    by_occ = defaultdict(list)
    imp = {}
    for r in rows(f'{d}/Task Ratings.txt'):
        if r['Scale ID'] == 'IM':
            imp[(r['O*NET-SOC Code'], r['Task ID'])] = float(r['Data Value'])
    for r in rows(f'{d}/Task Statements.txt'):
        if r['Task Type'] == 'Supplemental':
            continue
        k = (r['O*NET-SOC Code'], r['Task ID'])
        by_occ[k[0]].append((imp.get(k), r['Task']))

    software = defaultdict(list)
    for r in rows(f'{d}/Software Skills.txt'):
        software[r['O*NET-SOC Code']].append(
            (r['Workplace Example'], r['Hot Technology'] == 'Y', r['In Demand'].strip() == 'Y')
        )
    zone = {r['O*NET-SOC Code']: int(r['Job Zone']) for r in rows(f'{d}/Job Zones.txt')}
    # O*NET's related occupations, in its own order. Only the two "Primary"
    # tiers: "Supplemental" reaches down to clerical support (HR Managers ->
    # HR Assistants), which is a list of adjacent jobs, not of directions.
    related = defaultdict(list)
    for r in rows(f'{d}/Related Occupations.txt'):
        if r['Relatedness Tier'].startswith('Primary'):
            related[r['O*NET-SOC Code']].append(r['Related O*NET-SOC Code'])
    return occ, index, by_occ, software, zone, related


def lookup(title, index):
    """SOC codes for a title, stripping grade prefixes until one matches."""
    t = norm(title)
    seen = set()
    while t and t not in seen:
        seen.add(t)
        if t in index:
            return index[t], t
        nt = MOD.sub('', t)
        if nt == t:
            break
        t = nt
    return {}, None


def auto_match(node, index, has_tasks):
    """The matcher's suggestion for a rung, for --review only."""
    votes = defaultdict(float)
    via = {}
    for title, n in node['titles']:
        codes, _ = lookup(title, index)
        codes = {c: w for c, w in codes.items() if c in has_tasks}
        if not codes:
            continue
        top = max(codes.values())
        best = [c for c, w in codes.items() if w == top]
        for c in best:
            votes[c] += n / len(best)
            via.setdefault(c, title)
    if not votes:
        return None, None
    best = max(votes, key=votes.get)
    return best, via[best]


def table_entry(rid):
    """(reviewed?, soc) for a rung id."""
    fam, track, rung = rid.split('|')
    row = TABLE.get(f'{fam}|{track}', {})
    return (int(rung) in row), row.get(int(rung))


def review(nodes, occ, index, has_tasks):
    """Every rung: the reviewed entry, the matcher's suggestion, the titles."""
    for n in nodes:
        rid = rung_id(n)
        reviewed, soc = table_entry(rid)
        sug, via = auto_match(n, index, has_tasks)
        mark = ('UNREVIEWED' if not reviewed else 'none' if soc is None
                else 'same' if soc == sug else 'override')
        print(f"{rid:34} {mark:10} {soc or '-':11} {occ.get(soc, '')[:34]:34} "
              f"| matcher {sug or '-'} {occ.get(sug, '')[:26]!r} via {via!r}")
        print(f"{'':34} titles: {'; '.join(t for t, _ in n['titles'][:4])[:120]}")


def main():
    d = sys.argv[1]
    nodes = load_nodes()
    occ, index, by_occ, software, zone, related = load_onet(d)
    has_tasks = set(by_occ)
    for lad, row in TABLE.items():
        for r, soc in row.items():
            if soc is not None and soc not in has_tasks:
                sys.exit(f'{lad}|{r}: {soc} has no tasks in O*NET {VERSION}')
    if '--review' in sys.argv:
        review(nodes, occ, index, has_tasks)
        return

    ids = {rung_id(n) for n in nodes}
    mapping, unreviewed = {}, []
    for rid in sorted(ids):
        reviewed, soc = table_entry(rid)
        if not reviewed:
            unreviewed.append(rid)
        elif soc:
            mapping[rid] = soc
    stale = sorted(
        f'{lad}|{r}' for lad, row in TABLE.items() for r in row if f'{lad}|{r}' not in ids
    )

    used = sorted(set(mapping.values()))
    spread = defaultdict(int)
    for rows_ in software.values():
        for w in {r[0] for r in rows_}:
            spread[w] += 1
    occs = {}
    for soc in used:
        tasks = sorted(by_occ[soc], key=lambda t: -(t[0] or 0))[:TASKS_PER_OCC]
        # Only the tools O*NET marks "In Demand" FOR THIS occupation — frequent
        # in US job postings for it. The rest of an occupation's list is long
        # and uneven (Registered Nurses lists a dental practice system and
        # Apache Spark), and "Hot Technology" is an economy-wide flag that says
        # nothing about this job. An occupation with no in-demand tools — most
        # hands-on and clinical work — gets an empty list, not a padded one.
        # Rarest first: every desk job lists Outlook, and alphabetical order
        # would fill a Data Scientist's list with the Office suite before
        # it reached Python.
        tools = sorted({w for w, _hot, dem in software.get(soc, []) if dem},
                       key=lambda w: (spread[w], w))
        occs[soc] = {
            'title': occ[soc],
            'zone': zone.get(soc),
            'tasks': [[t, None if s is None else round(s, 2)] for s, t in tasks],
            'software': tools[:SOFTWARE_PER_OCC],
        }

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(
            '// GENERATED — do not edit by hand. Rewritten by scripts/gen-onet-roles.py\n'
            f'// from the O*NET {VERSION} database.\n'
            '//\n'
            '// O*NET is (c) the U.S. Department of Labor, Employment and Training\n'
            '// Administration, used under CC BY 4.0. The tasks and software describe\n'
            '// the US occupation a rung maps to; they were NOT measured from our ads.\n'
            'import type { OnetOccupation } from "../lib/onet";\n\n'
            f'export const ONET_VERSION = "{VERSION}";\n\n'
            'export const ONET_OCCUPATIONS: Record<string, OnetOccupation> = {\n'
        )
        for soc in used:
            f.write(f'  {json.dumps(soc)}: {json.dumps(occs[soc], ensure_ascii=False)},\n')
        f.write('};\n\n/** family|track|rung -> O*NET-SOC code. Reviewed by hand; see the\n'
                ' *  TABLE in the generator. A rung absent here has no O*NET entry. */\n')
        f.write('export const ONET_ROLES: Record<string, string> = {\n')
        for n in nodes:
            rid = rung_id(n)
            if rid in mapping:
                f.write(f'  {json.dumps(rid)}: {json.dumps(mapping[rid])},\n')
        f.write('};\n\n/** Rungs reviewed and deliberately left without an occupation: their titles\n'
                ' *  span several occupations, or O*NET has no counterpart. */\n')
        f.write('export const ONET_NONE: string[] = [\n')
        for n in nodes:
            rid = rung_id(n)
            reviewed, soc = table_entry(rid)
            if reviewed and soc is None:
                f.write(f'  {json.dumps(rid)},\n')
        f.write('];\n')
        f.write('\n/** O*NET-SOC -> its related occupations (O*NET\'s two Primary tiers, in\n'
                ' *  O*NET\'s order), kept to occupations some rung maps to. What the\n'
                ' *  card\'s "Other directions" are drawn from. */\n')
        f.write('export const ONET_RELATED: Record<string, string[]> = {\n')
        for soc in used:
            rel = [r for r in related.get(soc, []) if r in occs and r != soc]
            if rel:
                f.write(f'  {json.dumps(soc)}: {json.dumps(rel)},\n')
        f.write('};\n')
    print(f'{len(nodes)} rungs: {len(mapping)} mapped to {len(used)} occupations, '
          f'{len(ids) - len(mapping) - len(unreviewed)} with no O*NET equivalent -> {OUT}')
    if unreviewed:
        print(f'UNREVIEWED, left out ({len(unreviewed)}): ' + ', '.join(unreviewed))
    if stale:
        print(f'table entries for rungs that no longer exist ({len(stale)}): ' + ', '.join(stale))

if __name__ == '__main__':
    main()
