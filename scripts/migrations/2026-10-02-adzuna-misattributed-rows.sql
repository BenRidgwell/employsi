-- ════════════════════════════════════════════════════════════════════════════
-- Employsi D1 (employsi-jobs-archive, 1c5f3ffb-…) — remove the Adzuna rows the
-- advertiser gate now rejects.
--                      Prepared and RUN 2026-10-02 00:3x UTC, after the Worker
--                      carrying the widened gate was deployed (version
--                      1c055e94). Verified after: the backup table holds 881
--                      rows, `jobs` went from 103,441 Adzuna rows to 102,560,
--                      section 2 answers 0, and re-running the gate over every
--                      remaining Adzuna row rejects nothing. The backup table
--                      is still there — drop it once you are happy.
--
-- WHAT THESE ROWS ARE. Adzuna is searched once per company with the company's
-- name as a keyword phrase, so it returns every ad that MENTIONS the phrase —
-- and in Australia a company name is very often a place. The ads below were
-- placed by a contractor, caterer, tenant or partner ON the searched company's
-- premises and filed under the searched company:
--
--    113  sto                                    'SA Health'
--     63  priv-alto                              'Palo Alto Networks'
--     48  priv-uniting                           'SA Health'
--     28  uni-macquarie-university               'Singtel'
--     26  rrl                                    'AngloGold Ashanti'
--     17  sydney-sgp                             'Cotton On Group'
--     16  priv-cci                               'Brickworks'
--     16  sydney-cgf                             'Accor'
--     13  priv-melbourne-airport                 'Accor'
--     13  priv-qcoal                             'Thiess'
--     12  sto                                    'Programmed'
--     11  priv-perth-airport                     'Costco Wholesale'
--     10  priv-hcf                               'BAE Systems'
--      9  sydney-cgf                             'Amazon'
--      8  sydney-zip                             'Accor'
--      8  uni-murdoch-university                 'Opal HealthCare'
--      7  priv-peregrine                         'Airbus'
--      7  uni-deakin-university                  'Northeast Health Wangaratta'
--      6  bhp                                    'Compass Group'
--      6  priv-canberra-airport                  'Accor'
--
-- …and 258 more pairs of the same shape.
--
-- workers/jobs-cron/advertiser.ts rule 3 exists to stop exactly this, but its
-- roster index was built from the Adzuna search targets — Australia's listed,
-- private and university lines — so it could not recognise a GLOBAL employer.
-- It now indexes the full roster (src/employsi/data/companies.ts), the same
-- roster lib/dataQualityFn.ts has always audited against. Measured 2026-10-02
-- over every Adzuna row in the archive: the widened gate rejects 881 rows
-- across 278 advertiser/company pairs on 97 cards, and keeps 37,421.
-- Not one row changes the other way.
--
-- WHY DELETE AND NOT RE-ATTRIBUTE. The advertiser name says who placed the ad,
-- so re-pointing company_id at the matched roster line would often be right —
-- but not reliably: "at" matches AT&T, "Health" matches a WA health service,
-- "Green" matches Green Industries SA. Those are truncated names, not
-- employers, and asserting a card's coverage from a lexical match is the kind
-- of plausible-looking number this archive is built to avoid. The employers
-- that really placed these ads are covered by their own feeds where they have
-- one (Accor, Compass, Amazon, AECOM, Airbus, SA Health, Queensland Health all
-- do); where they do not — Costco (seattle-cost) is the one with any volume, at
-- 20 rows — the card reads the real zero rather than someone else's hiring.
--
-- DEPLOY THE CODE FIRST. Until the Worker carries the widened gate, tonight's
-- Adzuna tick writes these rows again: 47 of the 278 pairs, 103 rows, were
-- re-seen on 2026-10-01 or later. This script is idempotent, so a re-run after
-- the next tick sweeps anything written in between.
--
-- Run it with
--   npx wrangler d1 execute employsi-jobs-archive --remote \
--     --file scripts/migrations/2026-10-02-adzuna-misattributed-rows.sql
-- (D1 runs a --file as one batch; a failure part-way rolls the batch back.)
--
-- The pair list is a CTE rather than `JOIN (VALUES …) AS p(cid, adv)`: D1 does
-- not accept a column-alias list on a VALUES clause and answers
-- `near ")": syntax error`, which reads like a bad row rather than bad syntax.
--
-- Only `jobs` is touched. No other table carries a row per advertisement, and
-- company_id is not part of any primary key here, so there is nothing to
-- collide with.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. BACKUP — every row this script will delete, before it deletes it ─────
-- Restore = INSERT INTO jobs SELECT * FROM _bak_adzattr_20261002_jobs;
-- Drop it once the result is checked.

CREATE TABLE IF NOT EXISTS _bak_adzattr_20261002_jobs AS
  WITH p(cid, adv) AS (VALUES
    ('sto', 'SA Health'),  -- 113
    ('priv-alto', 'Palo Alto Networks'),  -- 63
    ('priv-uniting', 'SA Health'),  -- 48
    ('uni-macquarie-university', 'Singtel'),  -- 28
    ('rrl', 'AngloGold Ashanti'),  -- 26
    ('sydney-sgp', 'Cotton On Group'),  -- 17
    ('priv-cci', 'Brickworks'),  -- 16
    ('sydney-cgf', 'Accor'),  -- 16
    ('priv-melbourne-airport', 'Accor'),  -- 13
    ('priv-qcoal', 'Thiess'),  -- 13
    ('sto', 'Programmed'),  -- 12
    ('priv-perth-airport', 'Costco Wholesale'),  -- 11
    ('priv-hcf', 'BAE Systems'),  -- 10
    ('sydney-cgf', 'Amazon'),  -- 9
    ('sydney-zip', 'Accor'),  -- 8
    ('uni-murdoch-university', 'Opal HealthCare'),  -- 8
    ('priv-peregrine', 'Airbus'),  -- 7
    ('uni-deakin-university', 'Northeast Health Wangaratta'),  -- 7
    ('bhp', 'Compass Group'),  -- 6
    ('priv-canberra-airport', 'Accor'),  -- 6
    ('priv-cci', 'Avanade'),  -- 6
    ('priv-peregrine', 'Airbus Australia Pacific'),  -- 6
    ('priv-peregrine', 'Airbus Group Australia Pacific'),  -- 6
    ('priv-perth-airport', 'Costco'),  -- 6
    ('sydney-tpg', 'Bank of America'),  -- 6
    ('uni-university-of-new-england', 'Hunter New England Local Health District'),  -- 6
    ('priv-cci', 'Avanade Inc.'),  -- 5
    ('priv-pharmacare', 'Aspen Pharmacare'),  -- 5
    ('priv-uniting', 'South West Healthcare'),  -- 5
    ('s32', 'Bank of America'),  -- 5
    ('uni-james-cook-university', 'Queensland Health'),  -- 5
    ('uni-university-of-southern-queensland', 'AECOM'),  -- 5
    ('priv-afl', 'Accor'),  -- 4
    ('priv-loan-market', 'Mitsubishi UFJ Financial Group'),  -- 4
    ('priv-uniting', 'Compass Group'),  -- 4
    ('priv-uniting', 'Victorian Government'),  -- 4
    ('rrl', 'Regis Connect'),  -- 4
    ('sto', 'Halliburton'),  -- 4
    ('sydney-cgf', 'Amazon Web Services '),  -- 4
    ('sydney-coh', 'SA Health'),  -- 4
    ('uni-deakin-university', 'Barwon Health'),  -- 4
    ('uni-griffith-university', 'Opal HealthCare'),  -- 4
    ('uni-university-of-adelaide', 'SA Health'),  -- 4
    ('uni-university-of-newcastle', 'NSW Health'),  -- 4
    ('adelaide-eld', 'SA Health'),  -- 3
    ('brisbane-nxt', 'at'),  -- 3
    ('melbourne-mpl', 'Thiess'),  -- 3
    ('priv-cci', 'ASC'),  -- 3
    ('priv-cci', 'Brickworks Limited'),  -- 3
    ('priv-ey', 'Infosys Singapore & Australia'),  -- 3
    ('priv-hammondcare', 'NSW Health'),  -- 3
    ('priv-perth-airport', 'Costco AU'),  -- 3
    ('priv-perth-airport', 'EssilorLuxottica Group'),  -- 3
    ('priv-sydney-tools', 'Mader Group'),  -- 3
    ('priv-uniting', 'Bendigo Health'),  -- 3
    ('priv-uniting', 'Central Highlands Rural Health'),  -- 3
    ('priv-uniting', 'Department of Health - Queensland'),  -- 3
    ('priv-uniting', 'Queensland Health'),  -- 3
    ('shell', 'Amazon'),  -- 3
    ('shell', 'CITIC'),  -- 3
    ('uni-deakin-university', 'Bendigo Health'),  -- 3
    ('uni-deakin-university', 'South West Healthcare'),  -- 3
    ('uni-monash-university', 'Bendigo Health'),  -- 3
    ('uni-university-of-newcastle', 'Hunter New England Local Health District'),  -- 3
    ('uni-university-of-tasmania', 'Department of Health Tasmania'),  -- 3
    ('wds', 'Programmed'),  -- 3
    ('brisbane-tne', 'Department of Health'),  -- 2
    ('melbourne-jbh', 'Programmed AU'),  -- 2
    ('melbourne-jbh', 'Programmed Maintenance Services'),  -- 2
    ('melbourne-tah', 'at'),  -- 2
    ('mgt', 'Programmed'),  -- 2
    ('priv-alto', 'Lenovo'),  -- 2
    ('priv-ara', 'IBM'),  -- 2
    ('priv-ara', 'Infosys'),  -- 2
    ('priv-ausgrid', 'AECOM'),  -- 2
    ('priv-ausgrid', 'AECOM Australia Pty Ltd'),  -- 2
    ('priv-built', 'Netwealth'),  -- 2
    ('priv-built', 'Programmed AU'),  -- 2
    ('priv-cci', 'Centacare NENW'),  -- 2
    ('priv-cci', 'Learning Online Pty'),  -- 2
    ('priv-chemist-warehouse', 'Colgate-Palmolive'),  -- 2
    ('priv-gmhba', 'at'),  -- 2
    ('priv-hcf', 'Department of Defence'),  -- 2
    ('priv-mater', 'Compass Group'),  -- 2
    ('priv-melbourne-airport', 'Accor Hotels'),  -- 2
    ('priv-melbourne-airport', 'Programmed'),  -- 2
    ('priv-minterellison', 'at'),  -- 2
    ('priv-peregrine', 'Airbus Australia Pacific Limited'),  -- 2
    ('priv-peregrine', 'Department of Defence'),  -- 2
    ('priv-programmed', 'Amazon'),  -- 2
    ('priv-programmed', 'Bendigo Health'),  -- 2
    ('priv-raa', 'History Trust of South Australia'),  -- 2
    ('priv-san-remo', 'Programmed'),  -- 2
    ('priv-uniting', 'Austin Health'),  -- 2
    ('priv-uniting', 'Barwon Health'),  -- 2
    ('priv-uniting', 'Benalla Health'),  -- 2
    ('priv-uniting', 'NSW Health'),  -- 2
    ('priv-uniting', 'Northeast Health Wangaratta'),  -- 2
    ('priv-uniting', 'Western Health'),  -- 2
    ('rrl', 'Anglogold Ashanti Australia Limited'),  -- 2
    ('s32', 'Newmont Australia'),  -- 2
    ('shell', 'Amazon Web Services '),  -- 2
    ('shell', 'Goldman Sachs'),  -- 2
    ('sto', 'SA Health - Northern Adelaide Local Health Network'),  -- 2
    ('sydney-bsl', 'Programmed'),  -- 2
    ('sydney-cgf', 'Mastercard'),  -- 2
    ('sydney-mts', 'PepsiCo'),  -- 2
    ('sydney-rgn', 'Amazon'),  -- 2
    ('sydney-rgn', 'Bendigo Health'),  -- 2
    ('uni-charles-sturt-university', 'National Archives of Australia'),  -- 2
    ('uni-deakin-university', 'Victorian Government'),  -- 2
    ('uni-la-trobe-university', 'Barwon Health'),  -- 2
    ('uni-monash-university', 'Central Gippsland Health'),  -- 2
    ('uni-university-of-canberra', 'Compass Group'),  -- 2
    ('uni-university-of-south-australia', 'Department of Health'),  -- 2
    ('uni-university-of-southern-queensland', 'AECOM Australia Pty Ltd'),  -- 2
    ('uni-university-of-the-sunshine-coast', 'Queensland Health'),  -- 2
    ('uni-university-of-wollongong', 'Compass Group'),  -- 2
    ('adelaide-eld', 'AECOM'),  -- 1
    ('adelaide-eld', 'Amazon'),  -- 1
    ('bhp', 'AECOM'),  -- 1
    ('brisbane-azj', 'AECOM'),  -- 1
    ('brisbane-ctd', 'Bureau of Meteorology'),  -- 1
    ('brisbane-dtl', 'Department of Lands, Planning and Environment'),  -- 1
    ('brisbane-dtl', 'NT Police Force'),  -- 1
    ('brisbane-tne', 'Department of Veterans'' Affairs'),  -- 1
    ('brisbane-tne', 'Department of Water and Environmental Regulation WA'),  -- 1
    ('chevron', 'Accor'),  -- 1
    ('fmg', 'Programmed'),  -- 1
    ('melbourne-mpl', 'Accor'),  -- 1
    ('melbourne-mpl', 'Health'),  -- 1
    ('melbourne-twe', 'at'),  -- 1
    ('min', 'CSIRO'),  -- 1
    ('min', 'Department for Energy and Mining'),  -- 1
    ('min', 'First Quantum Minerals'),  -- 1
    ('min', 'Glencore Australia'),  -- 1
    ('min', 'Gold Fields'),  -- 1
    ('perth-imd', 'Programmed'),  -- 1
    ('perth-imd', 'Programmed GO'),  -- 1
    ('priv-alto', 'Intercontinental Exchange Holdings'),  -- 1
    ('priv-alto', 'Palo Alto Networks, Inc.'),  -- 1
    ('priv-ara', 'Boeing Defence Australia'),  -- 1
    ('priv-ara', 'Boeing RIV Site'),  -- 1
    ('priv-built', 'North Metropolitan TAFE'),  -- 1
    ('priv-built', 'Programmed Maintenance Services'),  -- 1
    ('priv-built', 'University of New South Wales'),  -- 1
    ('priv-canberra-airport', 'Australian Federal Police'),  -- 1
    ('priv-cci', 'NSW Department of Customer Service'),  -- 1
    ('priv-cci', 'ScionHealth'),  -- 1
    ('priv-cci', 'Westpac Group'),  -- 1
    ('priv-chemist-warehouse', 'Colgate'),  -- 1
    ('priv-chemist-warehouse', 'GSK'),  -- 1
    ('priv-defence-health', 'Airbus Australia Pacific'),  -- 1
    ('priv-ey', 'Caterpillar'),  -- 1
    ('priv-ey', 'Caterpillar, Inc.'),  -- 1
    ('priv-ey', 'Lenovo'),  -- 1
    ('priv-fdc', 'Accor'),  -- 1
    ('priv-fdc', 'Accor Global Reservation Centre'),  -- 1
    ('priv-fdc', 'Department for Education, South Australia'),  -- 1
    ('priv-hbf', 'VenuesWest'),  -- 1
    ('priv-hcf', 'BAE Systems Australia'),  -- 1
    ('priv-hcf', 'Komatsu'),  -- 1
    ('priv-leader-computers', 'Accor'),  -- 1
    ('priv-life-without-barriers', 'Goulburn'),  -- 1
    ('priv-manildra-group', 'Programmed'),  -- 1
    ('priv-melbourne-airport', 'ACCOR'),  -- 1
    ('priv-melbourne-airport', 'BP Australia'),  -- 1
    ('priv-melbourne-airport', 'Programmed Maintenance Services'),  -- 1
    ('priv-perth-airport', 'Compass Group'),  -- 1
    ('priv-perth-airport', 'SGS'),  -- 1
    ('priv-programmed', 'Fire and Rescue NSW'),  -- 1
    ('priv-programmed', 'Northrop Grumman'),  -- 1
    ('priv-programmed', 'RTX Corporation'),  -- 1
    ('priv-programmed', 'Victorian Government'),  -- 1
    ('priv-raa', 'Department for Education SA'),  -- 1
    ('priv-raa', 'First Quantum Minerals'),  -- 1
    ('priv-talent-international', 'Hitachi'),  -- 1
    ('priv-talent-international', 'Hitachi Rail'),  -- 1
    ('priv-tennis-australia', 'at'),  -- 1
    ('priv-united-petroleum', 'Department Mining and Energy'),  -- 1
    ('priv-united-petroleum', 'Victorian Government'),  -- 1
    ('priv-uniting', 'Albury Wodonga Health'),  -- 1
    ('priv-uniting', 'Bairnsdale Regional Health Service'),  -- 1
    ('priv-uniting', 'Central Highlands Rural Health Service'),  -- 1
    ('priv-uniting', 'Corryong Health'),  -- 1
    ('priv-uniting', 'Department of Health'),  -- 1
    ('priv-uniting', 'Department of Health Tasmania'),  -- 1
    ('priv-uniting', 'Department of Health to Queensland'),  -- 1
    ('priv-uniting', 'Department of Justice and Community Safety VIC'),  -- 1
    ('priv-uniting', 'Goulburn Valley Health'),  -- 1
    ('priv-uniting', 'Heathcote Health'),  -- 1
    ('priv-uniting', 'Hunter New England Local Health District'),  -- 1
    ('priv-uniting', 'Infosys'),  -- 1
    ('priv-uniting', 'NT Police Force'),  -- 1
    ('priv-uniting', 'Royal Melbourne Hospital'),  -- 1
    ('priv-uniting', 'SA Health - Southern Adelaide Local Health Network'),  -- 1
    ('priv-uniting', 'South Metropolitan Health Service'),  -- 1
    ('priv-uniting', 'South Metropolitan Health Service - Fiona Stanley Fremantle Hospitals Group'),  -- 1
    ('priv-uniting', 'Taronga Conservation Society Australia'),  -- 1
    ('priv-uniting', 'Victoria Police'),  -- 1
    ('rrl', 'AngloGold Ashanti Australia'),  -- 1
    ('rrl', 'Anglogold Ashanti'),  -- 1
    ('s32', 'AECOM'),  -- 1
    ('s32', 'AECOM Australia Pty Ltd'),  -- 1
    ('s32', 'Newmont Mining'),  -- 1
    ('shell', 'BYD Australia'),  -- 1
    ('shell', 'BYD Australia and New Zealand'),  -- 1
    ('shell', 'Honeywell'),  -- 1
    ('shell', 'Honeywell Technologies'),  -- 1
    ('shell', 'Lenovo'),  -- 1
    ('shell', 'Reserve Bank of Australia'),  -- 1
    ('sto', 'ABB'),  -- 1
    ('sto', 'Corrective Services NSW'),  -- 1
    ('sto', 'Programmed / PERSOLKELLY'),  -- 1
    ('sto', 'Programmed Maintenance Services'),  -- 1
    ('sto', 'Western Health'),  -- 1
    ('sydney-ald', 'Compass Group Australia'),  -- 1
    ('sydney-amp', 'Airbus'),  -- 1
    ('sydney-amp', 'Bank of America'),  -- 1
    ('sydney-amp', 'Veolia'),  -- 1
    ('sydney-amp', 'Wipro APAC'),  -- 1
    ('sydney-cgf', 'Anglo American'),  -- 1
    ('sydney-cgf', 'CSIRO'),  -- 1
    ('sydney-cgf', 'Compass'),  -- 1
    ('sydney-cgf', 'Compass Group'),  -- 1
    ('sydney-cgf', 'Department for Education, South Australia'),  -- 1
    ('sydney-cgf', 'Ecolab'),  -- 1
    ('sydney-cgf', 'Infosys Singapore & Australia'),  -- 1
    ('sydney-cgf', 'Procter & Gamble'),  -- 1
    ('sydney-cgf', 'Singtel'),  -- 1
    ('sydney-coh', 'Queensland Health'),  -- 1
    ('sydney-coh', 'SA Health - Flinders and Upper North Local Health Network'),  -- 1
    ('sydney-dow', 'at'),  -- 1
    ('sydney-mts', 'Colgate-Palmolive'),  -- 1
    ('sydney-ppt', 'Accor'),  -- 1
    ('sydney-ppt', 'Marriott International'),  -- 1
    ('sydney-rgn', 'Amgen'),  -- 1
    ('sydney-rgn', 'Barrick Gold Corporation'),  -- 1
    ('sydney-rgn', 'Hermès'),  -- 1
    ('sydney-rgn', 'Office of the Director of Public Prosecutions NSW'),  -- 1
    ('sydney-sgp', 'Cotton On'),  -- 1
    ('sydney-whc', 'Programmed'),  -- 1
    ('sydney-wow', 'Amazon Web Services'),  -- 1
    ('sydney-zip', 'Accor Apartments and Realty'),  -- 1
    ('sydney-zip', 'Department of Education Victoria'),  -- 1
    ('sydney-zip', 'Energy and Water Ombudsman Queensland'),  -- 1
    ('sydney-zip', 'Government schools'),  -- 1
    ('sydney-zip', 'Target Business Services'),  -- 1
    ('uni-australian-national-university', 'NSW Health'),  -- 1
    ('uni-bond-university', 'Department of Health - Queensland'),  -- 1
    ('uni-bond-university', 'Queensland Health'),  -- 1
    ('uni-charles-darwin-university', 'Department of Health'),  -- 1
    ('uni-charles-sturt-university', 'Albury Wodonga Health'),  -- 1
    ('uni-charles-sturt-university', 'NSW Health Pathology'),  -- 1
    ('uni-curtin-university', 'Department of Education, Western Australia'),  -- 1
    ('uni-deakin-university', 'Austin Health'),  -- 1
    ('uni-deakin-university', 'Central Gippsland Health'),  -- 1
    ('uni-deakin-university', 'Central Gippsland Health Service'),  -- 1
    ('uni-federation-university-australia', 'West Gippsland Healthcare Group'),  -- 1
    ('uni-flinders-university', 'SA Health'),  -- 1
    ('uni-james-cook-university', 'Department of Health - Queensland'),  -- 1
    ('uni-la-trobe-university', 'Albury Wodonga Health'),  -- 1
    ('uni-la-trobe-university', 'Austin Health'),  -- 1
    ('uni-la-trobe-university', 'Department of Education Victoria'),  -- 1
    ('uni-la-trobe-university', 'Government schools'),  -- 1
    ('uni-macquarie-university', 'Singtel Group'),  -- 1
    ('uni-monash-university', 'Bairnsdale Regional Health Service'),  -- 1
    ('uni-monash-university', 'Guzman y Gomez'),  -- 1
    ('uni-queensland-university-of-technology', 'CSIRO'),  -- 1
    ('uni-swinburne-university-of-technology', 'Government schools'),  -- 1
    ('uni-university-of-melbourne', 'Barwon Health'),  -- 1
    ('uni-university-of-melbourne', 'Peter MacCallum Cancer Centre'),  -- 1
    ('uni-university-of-new-england', 'NSW Health'),  -- 1
    ('uni-university-of-new-england', 'Nutrien'),  -- 1
    ('uni-university-of-new-england', 'Nutrien Ag Solutions - Australia'),  -- 1
    ('uni-university-of-newcastle', 'Department of Health'),  -- 1
    ('uni-university-of-queensland', 'Accor'),  -- 1
    ('uni-university-of-western-australia', 'Green')  -- 1

  )
  SELECT j.* FROM jobs j JOIN p ON j.company_id = p.cid AND j.company = p.adv
   WHERE j.source = 'adzuna';

-- Expect 881.
SELECT COUNT(*) AS backed_up FROM _bak_adzattr_20261002_jobs;


-- ── 1. DELETE them from `jobs` ──────────────────────────────────────────────
-- One statement per pair rather than a join, so a line can be read, checked and
-- commented out on its own. Expected row counts are beside each.

DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='SA Health';  -- 113
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-alto' AND company='Palo Alto Networks';  -- 63
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='SA Health';  -- 48
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-macquarie-university' AND company='Singtel';  -- 28
DELETE FROM jobs WHERE source='adzuna' AND company_id='rrl' AND company='AngloGold Ashanti';  -- 26
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-sgp' AND company='Cotton On Group';  -- 17
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Brickworks';  -- 16
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Accor';  -- 16
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-melbourne-airport' AND company='Accor';  -- 13
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-qcoal' AND company='Thiess';  -- 13
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='Programmed';  -- 12
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-perth-airport' AND company='Costco Wholesale';  -- 11
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-hcf' AND company='BAE Systems';  -- 10
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Amazon';  -- 9
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-zip' AND company='Accor';  -- 8
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-murdoch-university' AND company='Opal HealthCare';  -- 8
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-peregrine' AND company='Airbus';  -- 7
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Northeast Health Wangaratta';  -- 7
DELETE FROM jobs WHERE source='adzuna' AND company_id='bhp' AND company='Compass Group';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-canberra-airport' AND company='Accor';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Avanade';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-peregrine' AND company='Airbus Australia Pacific';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-peregrine' AND company='Airbus Group Australia Pacific';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-perth-airport' AND company='Costco';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-tpg' AND company='Bank of America';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-new-england' AND company='Hunter New England Local Health District';  -- 6
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Avanade Inc.';  -- 5
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-pharmacare' AND company='Aspen Pharmacare';  -- 5
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='South West Healthcare';  -- 5
DELETE FROM jobs WHERE source='adzuna' AND company_id='s32' AND company='Bank of America';  -- 5
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-james-cook-university' AND company='Queensland Health';  -- 5
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-southern-queensland' AND company='AECOM';  -- 5
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-afl' AND company='Accor';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-loan-market' AND company='Mitsubishi UFJ Financial Group';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Compass Group';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Victorian Government';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='rrl' AND company='Regis Connect';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='Halliburton';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Amazon Web Services ';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-coh' AND company='SA Health';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Barwon Health';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-griffith-university' AND company='Opal HealthCare';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-adelaide' AND company='SA Health';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-newcastle' AND company='NSW Health';  -- 4
DELETE FROM jobs WHERE source='adzuna' AND company_id='adelaide-eld' AND company='SA Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-nxt' AND company='at';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-mpl' AND company='Thiess';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='ASC';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Brickworks Limited';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ey' AND company='Infosys Singapore & Australia';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-hammondcare' AND company='NSW Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-perth-airport' AND company='Costco AU';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-perth-airport' AND company='EssilorLuxottica Group';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-sydney-tools' AND company='Mader Group';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Bendigo Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Central Highlands Rural Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Department of Health - Queensland';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Queensland Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Amazon';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='CITIC';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Bendigo Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='South West Healthcare';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-monash-university' AND company='Bendigo Health';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-newcastle' AND company='Hunter New England Local Health District';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-tasmania' AND company='Department of Health Tasmania';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='wds' AND company='Programmed';  -- 3
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-tne' AND company='Department of Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-jbh' AND company='Programmed AU';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-jbh' AND company='Programmed Maintenance Services';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-tah' AND company='at';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='mgt' AND company='Programmed';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-alto' AND company='Lenovo';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ara' AND company='IBM';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ara' AND company='Infosys';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ausgrid' AND company='AECOM';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ausgrid' AND company='AECOM Australia Pty Ltd';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-built' AND company='Netwealth';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-built' AND company='Programmed AU';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Centacare NENW';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Learning Online Pty';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-chemist-warehouse' AND company='Colgate-Palmolive';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-gmhba' AND company='at';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-hcf' AND company='Department of Defence';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-mater' AND company='Compass Group';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-melbourne-airport' AND company='Accor Hotels';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-melbourne-airport' AND company='Programmed';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-minterellison' AND company='at';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-peregrine' AND company='Airbus Australia Pacific Limited';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-peregrine' AND company='Department of Defence';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-programmed' AND company='Amazon';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-programmed' AND company='Bendigo Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-raa' AND company='History Trust of South Australia';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-san-remo' AND company='Programmed';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Austin Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Barwon Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Benalla Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='NSW Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Northeast Health Wangaratta';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Western Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='rrl' AND company='Anglogold Ashanti Australia Limited';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='s32' AND company='Newmont Australia';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Amazon Web Services ';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Goldman Sachs';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='SA Health - Northern Adelaide Local Health Network';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-bsl' AND company='Programmed';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Mastercard';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-mts' AND company='PepsiCo';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-rgn' AND company='Amazon';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-rgn' AND company='Bendigo Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-charles-sturt-university' AND company='National Archives of Australia';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Victorian Government';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-la-trobe-university' AND company='Barwon Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-monash-university' AND company='Central Gippsland Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-canberra' AND company='Compass Group';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-south-australia' AND company='Department of Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-southern-queensland' AND company='AECOM Australia Pty Ltd';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-the-sunshine-coast' AND company='Queensland Health';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-wollongong' AND company='Compass Group';  -- 2
DELETE FROM jobs WHERE source='adzuna' AND company_id='adelaide-eld' AND company='AECOM';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='adelaide-eld' AND company='Amazon';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='bhp' AND company='AECOM';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-azj' AND company='AECOM';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-ctd' AND company='Bureau of Meteorology';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-dtl' AND company='Department of Lands, Planning and Environment';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-dtl' AND company='NT Police Force';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-tne' AND company='Department of Veterans'' Affairs';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='brisbane-tne' AND company='Department of Water and Environmental Regulation WA';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='chevron' AND company='Accor';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='fmg' AND company='Programmed';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-mpl' AND company='Accor';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-mpl' AND company='Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='melbourne-twe' AND company='at';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='min' AND company='CSIRO';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='min' AND company='Department for Energy and Mining';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='min' AND company='First Quantum Minerals';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='min' AND company='Glencore Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='min' AND company='Gold Fields';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='perth-imd' AND company='Programmed';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='perth-imd' AND company='Programmed GO';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-alto' AND company='Intercontinental Exchange Holdings';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-alto' AND company='Palo Alto Networks, Inc.';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ara' AND company='Boeing Defence Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ara' AND company='Boeing RIV Site';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-built' AND company='North Metropolitan TAFE';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-built' AND company='Programmed Maintenance Services';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-built' AND company='University of New South Wales';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-canberra-airport' AND company='Australian Federal Police';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='NSW Department of Customer Service';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='ScionHealth';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-cci' AND company='Westpac Group';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-chemist-warehouse' AND company='Colgate';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-chemist-warehouse' AND company='GSK';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-defence-health' AND company='Airbus Australia Pacific';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ey' AND company='Caterpillar';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ey' AND company='Caterpillar, Inc.';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-ey' AND company='Lenovo';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-fdc' AND company='Accor';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-fdc' AND company='Accor Global Reservation Centre';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-fdc' AND company='Department for Education, South Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-hbf' AND company='VenuesWest';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-hcf' AND company='BAE Systems Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-hcf' AND company='Komatsu';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-leader-computers' AND company='Accor';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-life-without-barriers' AND company='Goulburn';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-manildra-group' AND company='Programmed';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-melbourne-airport' AND company='ACCOR';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-melbourne-airport' AND company='BP Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-melbourne-airport' AND company='Programmed Maintenance Services';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-perth-airport' AND company='Compass Group';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-perth-airport' AND company='SGS';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-programmed' AND company='Fire and Rescue NSW';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-programmed' AND company='Northrop Grumman';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-programmed' AND company='RTX Corporation';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-programmed' AND company='Victorian Government';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-raa' AND company='Department for Education SA';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-raa' AND company='First Quantum Minerals';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-talent-international' AND company='Hitachi';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-talent-international' AND company='Hitachi Rail';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-tennis-australia' AND company='at';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-united-petroleum' AND company='Department Mining and Energy';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-united-petroleum' AND company='Victorian Government';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Albury Wodonga Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Bairnsdale Regional Health Service';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Central Highlands Rural Health Service';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Corryong Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Department of Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Department of Health Tasmania';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Department of Health to Queensland';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Department of Justice and Community Safety VIC';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Goulburn Valley Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Heathcote Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Hunter New England Local Health District';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Infosys';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='NT Police Force';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Royal Melbourne Hospital';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='SA Health - Southern Adelaide Local Health Network';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='South Metropolitan Health Service';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='South Metropolitan Health Service - Fiona Stanley Fremantle Hospitals Group';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Taronga Conservation Society Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='priv-uniting' AND company='Victoria Police';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='rrl' AND company='AngloGold Ashanti Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='rrl' AND company='Anglogold Ashanti';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='s32' AND company='AECOM';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='s32' AND company='AECOM Australia Pty Ltd';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='s32' AND company='Newmont Mining';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='BYD Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='BYD Australia and New Zealand';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Honeywell';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Honeywell Technologies';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Lenovo';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='shell' AND company='Reserve Bank of Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='ABB';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='Corrective Services NSW';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='Programmed / PERSOLKELLY';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='Programmed Maintenance Services';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sto' AND company='Western Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-ald' AND company='Compass Group Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-amp' AND company='Airbus';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-amp' AND company='Bank of America';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-amp' AND company='Veolia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-amp' AND company='Wipro APAC';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Anglo American';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='CSIRO';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Compass';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Compass Group';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Department for Education, South Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Ecolab';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Infosys Singapore & Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Procter & Gamble';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-cgf' AND company='Singtel';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-coh' AND company='Queensland Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-coh' AND company='SA Health - Flinders and Upper North Local Health Network';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-dow' AND company='at';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-mts' AND company='Colgate-Palmolive';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-ppt' AND company='Accor';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-ppt' AND company='Marriott International';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-rgn' AND company='Amgen';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-rgn' AND company='Barrick Gold Corporation';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-rgn' AND company='Hermès';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-rgn' AND company='Office of the Director of Public Prosecutions NSW';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-sgp' AND company='Cotton On';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-whc' AND company='Programmed';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-wow' AND company='Amazon Web Services';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-zip' AND company='Accor Apartments and Realty';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-zip' AND company='Department of Education Victoria';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-zip' AND company='Energy and Water Ombudsman Queensland';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-zip' AND company='Government schools';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='sydney-zip' AND company='Target Business Services';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-australian-national-university' AND company='NSW Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-bond-university' AND company='Department of Health - Queensland';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-bond-university' AND company='Queensland Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-charles-darwin-university' AND company='Department of Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-charles-sturt-university' AND company='Albury Wodonga Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-charles-sturt-university' AND company='NSW Health Pathology';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-curtin-university' AND company='Department of Education, Western Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Austin Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Central Gippsland Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-deakin-university' AND company='Central Gippsland Health Service';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-federation-university-australia' AND company='West Gippsland Healthcare Group';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-flinders-university' AND company='SA Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-james-cook-university' AND company='Department of Health - Queensland';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-la-trobe-university' AND company='Albury Wodonga Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-la-trobe-university' AND company='Austin Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-la-trobe-university' AND company='Department of Education Victoria';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-la-trobe-university' AND company='Government schools';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-macquarie-university' AND company='Singtel Group';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-monash-university' AND company='Bairnsdale Regional Health Service';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-monash-university' AND company='Guzman y Gomez';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-queensland-university-of-technology' AND company='CSIRO';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-swinburne-university-of-technology' AND company='Government schools';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-melbourne' AND company='Barwon Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-melbourne' AND company='Peter MacCallum Cancer Centre';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-new-england' AND company='NSW Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-new-england' AND company='Nutrien';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-new-england' AND company='Nutrien Ag Solutions - Australia';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-newcastle' AND company='Department of Health';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-queensland' AND company='Accor';  -- 1
DELETE FROM jobs WHERE source='adzuna' AND company_id='uni-university-of-western-australia' AND company='Green';  -- 1

-- ── 2. CHECK — every pair must now be gone ─────────────────────────────────
-- Expect 0.
WITH p(cid, adv) AS (VALUES
    ('sto', 'SA Health'),  -- 113
    ('priv-alto', 'Palo Alto Networks'),  -- 63
    ('priv-uniting', 'SA Health'),  -- 48
    ('uni-macquarie-university', 'Singtel'),  -- 28
    ('rrl', 'AngloGold Ashanti'),  -- 26
    ('sydney-sgp', 'Cotton On Group'),  -- 17
    ('priv-cci', 'Brickworks'),  -- 16
    ('sydney-cgf', 'Accor'),  -- 16
    ('priv-melbourne-airport', 'Accor'),  -- 13
    ('priv-qcoal', 'Thiess'),  -- 13
    ('sto', 'Programmed'),  -- 12
    ('priv-perth-airport', 'Costco Wholesale'),  -- 11
    ('priv-hcf', 'BAE Systems'),  -- 10
    ('sydney-cgf', 'Amazon'),  -- 9
    ('sydney-zip', 'Accor'),  -- 8
    ('uni-murdoch-university', 'Opal HealthCare'),  -- 8
    ('priv-peregrine', 'Airbus'),  -- 7
    ('uni-deakin-university', 'Northeast Health Wangaratta'),  -- 7
    ('bhp', 'Compass Group'),  -- 6
    ('priv-canberra-airport', 'Accor'),  -- 6
    ('priv-cci', 'Avanade'),  -- 6
    ('priv-peregrine', 'Airbus Australia Pacific'),  -- 6
    ('priv-peregrine', 'Airbus Group Australia Pacific'),  -- 6
    ('priv-perth-airport', 'Costco'),  -- 6
    ('sydney-tpg', 'Bank of America'),  -- 6
    ('uni-university-of-new-england', 'Hunter New England Local Health District'),  -- 6
    ('priv-cci', 'Avanade Inc.'),  -- 5
    ('priv-pharmacare', 'Aspen Pharmacare'),  -- 5
    ('priv-uniting', 'South West Healthcare'),  -- 5
    ('s32', 'Bank of America'),  -- 5
    ('uni-james-cook-university', 'Queensland Health'),  -- 5
    ('uni-university-of-southern-queensland', 'AECOM'),  -- 5
    ('priv-afl', 'Accor'),  -- 4
    ('priv-loan-market', 'Mitsubishi UFJ Financial Group'),  -- 4
    ('priv-uniting', 'Compass Group'),  -- 4
    ('priv-uniting', 'Victorian Government'),  -- 4
    ('rrl', 'Regis Connect'),  -- 4
    ('sto', 'Halliburton'),  -- 4
    ('sydney-cgf', 'Amazon Web Services '),  -- 4
    ('sydney-coh', 'SA Health'),  -- 4
    ('uni-deakin-university', 'Barwon Health'),  -- 4
    ('uni-griffith-university', 'Opal HealthCare'),  -- 4
    ('uni-university-of-adelaide', 'SA Health'),  -- 4
    ('uni-university-of-newcastle', 'NSW Health'),  -- 4
    ('adelaide-eld', 'SA Health'),  -- 3
    ('brisbane-nxt', 'at'),  -- 3
    ('melbourne-mpl', 'Thiess'),  -- 3
    ('priv-cci', 'ASC'),  -- 3
    ('priv-cci', 'Brickworks Limited'),  -- 3
    ('priv-ey', 'Infosys Singapore & Australia'),  -- 3
    ('priv-hammondcare', 'NSW Health'),  -- 3
    ('priv-perth-airport', 'Costco AU'),  -- 3
    ('priv-perth-airport', 'EssilorLuxottica Group'),  -- 3
    ('priv-sydney-tools', 'Mader Group'),  -- 3
    ('priv-uniting', 'Bendigo Health'),  -- 3
    ('priv-uniting', 'Central Highlands Rural Health'),  -- 3
    ('priv-uniting', 'Department of Health - Queensland'),  -- 3
    ('priv-uniting', 'Queensland Health'),  -- 3
    ('shell', 'Amazon'),  -- 3
    ('shell', 'CITIC'),  -- 3
    ('uni-deakin-university', 'Bendigo Health'),  -- 3
    ('uni-deakin-university', 'South West Healthcare'),  -- 3
    ('uni-monash-university', 'Bendigo Health'),  -- 3
    ('uni-university-of-newcastle', 'Hunter New England Local Health District'),  -- 3
    ('uni-university-of-tasmania', 'Department of Health Tasmania'),  -- 3
    ('wds', 'Programmed'),  -- 3
    ('brisbane-tne', 'Department of Health'),  -- 2
    ('melbourne-jbh', 'Programmed AU'),  -- 2
    ('melbourne-jbh', 'Programmed Maintenance Services'),  -- 2
    ('melbourne-tah', 'at'),  -- 2
    ('mgt', 'Programmed'),  -- 2
    ('priv-alto', 'Lenovo'),  -- 2
    ('priv-ara', 'IBM'),  -- 2
    ('priv-ara', 'Infosys'),  -- 2
    ('priv-ausgrid', 'AECOM'),  -- 2
    ('priv-ausgrid', 'AECOM Australia Pty Ltd'),  -- 2
    ('priv-built', 'Netwealth'),  -- 2
    ('priv-built', 'Programmed AU'),  -- 2
    ('priv-cci', 'Centacare NENW'),  -- 2
    ('priv-cci', 'Learning Online Pty'),  -- 2
    ('priv-chemist-warehouse', 'Colgate-Palmolive'),  -- 2
    ('priv-gmhba', 'at'),  -- 2
    ('priv-hcf', 'Department of Defence'),  -- 2
    ('priv-mater', 'Compass Group'),  -- 2
    ('priv-melbourne-airport', 'Accor Hotels'),  -- 2
    ('priv-melbourne-airport', 'Programmed'),  -- 2
    ('priv-minterellison', 'at'),  -- 2
    ('priv-peregrine', 'Airbus Australia Pacific Limited'),  -- 2
    ('priv-peregrine', 'Department of Defence'),  -- 2
    ('priv-programmed', 'Amazon'),  -- 2
    ('priv-programmed', 'Bendigo Health'),  -- 2
    ('priv-raa', 'History Trust of South Australia'),  -- 2
    ('priv-san-remo', 'Programmed'),  -- 2
    ('priv-uniting', 'Austin Health'),  -- 2
    ('priv-uniting', 'Barwon Health'),  -- 2
    ('priv-uniting', 'Benalla Health'),  -- 2
    ('priv-uniting', 'NSW Health'),  -- 2
    ('priv-uniting', 'Northeast Health Wangaratta'),  -- 2
    ('priv-uniting', 'Western Health'),  -- 2
    ('rrl', 'Anglogold Ashanti Australia Limited'),  -- 2
    ('s32', 'Newmont Australia'),  -- 2
    ('shell', 'Amazon Web Services '),  -- 2
    ('shell', 'Goldman Sachs'),  -- 2
    ('sto', 'SA Health - Northern Adelaide Local Health Network'),  -- 2
    ('sydney-bsl', 'Programmed'),  -- 2
    ('sydney-cgf', 'Mastercard'),  -- 2
    ('sydney-mts', 'PepsiCo'),  -- 2
    ('sydney-rgn', 'Amazon'),  -- 2
    ('sydney-rgn', 'Bendigo Health'),  -- 2
    ('uni-charles-sturt-university', 'National Archives of Australia'),  -- 2
    ('uni-deakin-university', 'Victorian Government'),  -- 2
    ('uni-la-trobe-university', 'Barwon Health'),  -- 2
    ('uni-monash-university', 'Central Gippsland Health'),  -- 2
    ('uni-university-of-canberra', 'Compass Group'),  -- 2
    ('uni-university-of-south-australia', 'Department of Health'),  -- 2
    ('uni-university-of-southern-queensland', 'AECOM Australia Pty Ltd'),  -- 2
    ('uni-university-of-the-sunshine-coast', 'Queensland Health'),  -- 2
    ('uni-university-of-wollongong', 'Compass Group'),  -- 2
    ('adelaide-eld', 'AECOM'),  -- 1
    ('adelaide-eld', 'Amazon'),  -- 1
    ('bhp', 'AECOM'),  -- 1
    ('brisbane-azj', 'AECOM'),  -- 1
    ('brisbane-ctd', 'Bureau of Meteorology'),  -- 1
    ('brisbane-dtl', 'Department of Lands, Planning and Environment'),  -- 1
    ('brisbane-dtl', 'NT Police Force'),  -- 1
    ('brisbane-tne', 'Department of Veterans'' Affairs'),  -- 1
    ('brisbane-tne', 'Department of Water and Environmental Regulation WA'),  -- 1
    ('chevron', 'Accor'),  -- 1
    ('fmg', 'Programmed'),  -- 1
    ('melbourne-mpl', 'Accor'),  -- 1
    ('melbourne-mpl', 'Health'),  -- 1
    ('melbourne-twe', 'at'),  -- 1
    ('min', 'CSIRO'),  -- 1
    ('min', 'Department for Energy and Mining'),  -- 1
    ('min', 'First Quantum Minerals'),  -- 1
    ('min', 'Glencore Australia'),  -- 1
    ('min', 'Gold Fields'),  -- 1
    ('perth-imd', 'Programmed'),  -- 1
    ('perth-imd', 'Programmed GO'),  -- 1
    ('priv-alto', 'Intercontinental Exchange Holdings'),  -- 1
    ('priv-alto', 'Palo Alto Networks, Inc.'),  -- 1
    ('priv-ara', 'Boeing Defence Australia'),  -- 1
    ('priv-ara', 'Boeing RIV Site'),  -- 1
    ('priv-built', 'North Metropolitan TAFE'),  -- 1
    ('priv-built', 'Programmed Maintenance Services'),  -- 1
    ('priv-built', 'University of New South Wales'),  -- 1
    ('priv-canberra-airport', 'Australian Federal Police'),  -- 1
    ('priv-cci', 'NSW Department of Customer Service'),  -- 1
    ('priv-cci', 'ScionHealth'),  -- 1
    ('priv-cci', 'Westpac Group'),  -- 1
    ('priv-chemist-warehouse', 'Colgate'),  -- 1
    ('priv-chemist-warehouse', 'GSK'),  -- 1
    ('priv-defence-health', 'Airbus Australia Pacific'),  -- 1
    ('priv-ey', 'Caterpillar'),  -- 1
    ('priv-ey', 'Caterpillar, Inc.'),  -- 1
    ('priv-ey', 'Lenovo'),  -- 1
    ('priv-fdc', 'Accor'),  -- 1
    ('priv-fdc', 'Accor Global Reservation Centre'),  -- 1
    ('priv-fdc', 'Department for Education, South Australia'),  -- 1
    ('priv-hbf', 'VenuesWest'),  -- 1
    ('priv-hcf', 'BAE Systems Australia'),  -- 1
    ('priv-hcf', 'Komatsu'),  -- 1
    ('priv-leader-computers', 'Accor'),  -- 1
    ('priv-life-without-barriers', 'Goulburn'),  -- 1
    ('priv-manildra-group', 'Programmed'),  -- 1
    ('priv-melbourne-airport', 'ACCOR'),  -- 1
    ('priv-melbourne-airport', 'BP Australia'),  -- 1
    ('priv-melbourne-airport', 'Programmed Maintenance Services'),  -- 1
    ('priv-perth-airport', 'Compass Group'),  -- 1
    ('priv-perth-airport', 'SGS'),  -- 1
    ('priv-programmed', 'Fire and Rescue NSW'),  -- 1
    ('priv-programmed', 'Northrop Grumman'),  -- 1
    ('priv-programmed', 'RTX Corporation'),  -- 1
    ('priv-programmed', 'Victorian Government'),  -- 1
    ('priv-raa', 'Department for Education SA'),  -- 1
    ('priv-raa', 'First Quantum Minerals'),  -- 1
    ('priv-talent-international', 'Hitachi'),  -- 1
    ('priv-talent-international', 'Hitachi Rail'),  -- 1
    ('priv-tennis-australia', 'at'),  -- 1
    ('priv-united-petroleum', 'Department Mining and Energy'),  -- 1
    ('priv-united-petroleum', 'Victorian Government'),  -- 1
    ('priv-uniting', 'Albury Wodonga Health'),  -- 1
    ('priv-uniting', 'Bairnsdale Regional Health Service'),  -- 1
    ('priv-uniting', 'Central Highlands Rural Health Service'),  -- 1
    ('priv-uniting', 'Corryong Health'),  -- 1
    ('priv-uniting', 'Department of Health'),  -- 1
    ('priv-uniting', 'Department of Health Tasmania'),  -- 1
    ('priv-uniting', 'Department of Health to Queensland'),  -- 1
    ('priv-uniting', 'Department of Justice and Community Safety VIC'),  -- 1
    ('priv-uniting', 'Goulburn Valley Health'),  -- 1
    ('priv-uniting', 'Heathcote Health'),  -- 1
    ('priv-uniting', 'Hunter New England Local Health District'),  -- 1
    ('priv-uniting', 'Infosys'),  -- 1
    ('priv-uniting', 'NT Police Force'),  -- 1
    ('priv-uniting', 'Royal Melbourne Hospital'),  -- 1
    ('priv-uniting', 'SA Health - Southern Adelaide Local Health Network'),  -- 1
    ('priv-uniting', 'South Metropolitan Health Service'),  -- 1
    ('priv-uniting', 'South Metropolitan Health Service - Fiona Stanley Fremantle Hospitals Group'),  -- 1
    ('priv-uniting', 'Taronga Conservation Society Australia'),  -- 1
    ('priv-uniting', 'Victoria Police'),  -- 1
    ('rrl', 'AngloGold Ashanti Australia'),  -- 1
    ('rrl', 'Anglogold Ashanti'),  -- 1
    ('s32', 'AECOM'),  -- 1
    ('s32', 'AECOM Australia Pty Ltd'),  -- 1
    ('s32', 'Newmont Mining'),  -- 1
    ('shell', 'BYD Australia'),  -- 1
    ('shell', 'BYD Australia and New Zealand'),  -- 1
    ('shell', 'Honeywell'),  -- 1
    ('shell', 'Honeywell Technologies'),  -- 1
    ('shell', 'Lenovo'),  -- 1
    ('shell', 'Reserve Bank of Australia'),  -- 1
    ('sto', 'ABB'),  -- 1
    ('sto', 'Corrective Services NSW'),  -- 1
    ('sto', 'Programmed / PERSOLKELLY'),  -- 1
    ('sto', 'Programmed Maintenance Services'),  -- 1
    ('sto', 'Western Health'),  -- 1
    ('sydney-ald', 'Compass Group Australia'),  -- 1
    ('sydney-amp', 'Airbus'),  -- 1
    ('sydney-amp', 'Bank of America'),  -- 1
    ('sydney-amp', 'Veolia'),  -- 1
    ('sydney-amp', 'Wipro APAC'),  -- 1
    ('sydney-cgf', 'Anglo American'),  -- 1
    ('sydney-cgf', 'CSIRO'),  -- 1
    ('sydney-cgf', 'Compass'),  -- 1
    ('sydney-cgf', 'Compass Group'),  -- 1
    ('sydney-cgf', 'Department for Education, South Australia'),  -- 1
    ('sydney-cgf', 'Ecolab'),  -- 1
    ('sydney-cgf', 'Infosys Singapore & Australia'),  -- 1
    ('sydney-cgf', 'Procter & Gamble'),  -- 1
    ('sydney-cgf', 'Singtel'),  -- 1
    ('sydney-coh', 'Queensland Health'),  -- 1
    ('sydney-coh', 'SA Health - Flinders and Upper North Local Health Network'),  -- 1
    ('sydney-dow', 'at'),  -- 1
    ('sydney-mts', 'Colgate-Palmolive'),  -- 1
    ('sydney-ppt', 'Accor'),  -- 1
    ('sydney-ppt', 'Marriott International'),  -- 1
    ('sydney-rgn', 'Amgen'),  -- 1
    ('sydney-rgn', 'Barrick Gold Corporation'),  -- 1
    ('sydney-rgn', 'Hermès'),  -- 1
    ('sydney-rgn', 'Office of the Director of Public Prosecutions NSW'),  -- 1
    ('sydney-sgp', 'Cotton On'),  -- 1
    ('sydney-whc', 'Programmed'),  -- 1
    ('sydney-wow', 'Amazon Web Services'),  -- 1
    ('sydney-zip', 'Accor Apartments and Realty'),  -- 1
    ('sydney-zip', 'Department of Education Victoria'),  -- 1
    ('sydney-zip', 'Energy and Water Ombudsman Queensland'),  -- 1
    ('sydney-zip', 'Government schools'),  -- 1
    ('sydney-zip', 'Target Business Services'),  -- 1
    ('uni-australian-national-university', 'NSW Health'),  -- 1
    ('uni-bond-university', 'Department of Health - Queensland'),  -- 1
    ('uni-bond-university', 'Queensland Health'),  -- 1
    ('uni-charles-darwin-university', 'Department of Health'),  -- 1
    ('uni-charles-sturt-university', 'Albury Wodonga Health'),  -- 1
    ('uni-charles-sturt-university', 'NSW Health Pathology'),  -- 1
    ('uni-curtin-university', 'Department of Education, Western Australia'),  -- 1
    ('uni-deakin-university', 'Austin Health'),  -- 1
    ('uni-deakin-university', 'Central Gippsland Health'),  -- 1
    ('uni-deakin-university', 'Central Gippsland Health Service'),  -- 1
    ('uni-federation-university-australia', 'West Gippsland Healthcare Group'),  -- 1
    ('uni-flinders-university', 'SA Health'),  -- 1
    ('uni-james-cook-university', 'Department of Health - Queensland'),  -- 1
    ('uni-la-trobe-university', 'Albury Wodonga Health'),  -- 1
    ('uni-la-trobe-university', 'Austin Health'),  -- 1
    ('uni-la-trobe-university', 'Department of Education Victoria'),  -- 1
    ('uni-la-trobe-university', 'Government schools'),  -- 1
    ('uni-macquarie-university', 'Singtel Group'),  -- 1
    ('uni-monash-university', 'Bairnsdale Regional Health Service'),  -- 1
    ('uni-monash-university', 'Guzman y Gomez'),  -- 1
    ('uni-queensland-university-of-technology', 'CSIRO'),  -- 1
    ('uni-swinburne-university-of-technology', 'Government schools'),  -- 1
    ('uni-university-of-melbourne', 'Barwon Health'),  -- 1
    ('uni-university-of-melbourne', 'Peter MacCallum Cancer Centre'),  -- 1
    ('uni-university-of-new-england', 'NSW Health'),  -- 1
    ('uni-university-of-new-england', 'Nutrien'),  -- 1
    ('uni-university-of-new-england', 'Nutrien Ag Solutions - Australia'),  -- 1
    ('uni-university-of-newcastle', 'Department of Health'),  -- 1
    ('uni-university-of-queensland', 'Accor'),  -- 1
    ('uni-university-of-western-australia', 'Green')  -- 1

)
SELECT COUNT(*) AS still_there FROM jobs j
  JOIN p ON j.company_id = p.cid AND j.company = p.adv
 WHERE j.source = 'adzuna';
