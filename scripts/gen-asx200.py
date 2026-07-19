#!/usr/bin/env python3
"""Expand the AU city rosters + Adzuna cron targets to the full S&P/ASX 200.

Reads the ASX 200 constituents (code, company, GICS sector — scraped from
Wikipedia into asx200_rows.json), maps each to our sector group and to the AU
city its HQ sits in (curated below; foreign-domiciled ASX listings are skipped),
dedupes against the companies already in the app, and prints:
  1. TS roster rows to append to each AU city in cityRosters.ts, and
  2. a regenerated auJobsTargets.ts covering every AU company (hand-placed +
     every AU roster company) so the daily cron pulls each one's Adzuna feed.

City placement is best-effort from public HQ knowledge and easily corrected.
"""
import json, re, sys

ROOT = __file__.rsplit('/scripts/', 1)[0]
ROWS = sys.argv[1] if len(sys.argv) > 1 else 'asx200_rows.json'
CITY_ROSTERS_TS = f'{ROOT}/src/employsi/data/cityRosters.ts'
AU_TARGETS_TS = f'{ROOT}/src/employsi/data/auJobsTargets.ts'

GICS2GROUP = {
    'Information Technology': 'TMT', 'Communication Services': 'TMT',
    'Healthcare': 'HLT', 'Consumer Staples': 'CON', 'Consumer Discretionary': 'CON',
    'Materials': 'ENR', 'Energy': 'ENR', 'Financials': 'FIN', 'Real Estate': 'FIN',
    'Utilities': 'INF', 'Industrials': 'IND',
}
GROUP_FULL = {
    'FIN': 'Financial Services', 'TMT': 'Technology, Media and Telecommunications',
    'CON': 'Consumer and Retail', 'ENR': 'Energy & Natural Resources',
    'HLT': 'Healthcare and Life Sciences', 'IND': 'Industrial Manufacturing',
    'INF': 'Infrastructure and Government',
}

# Curated HQ city per ASX 200 code (syd/mel/per/bne/adl). Codes absent here are
# foreign-domiciled (NZ/US/PNG/etc.) and skipped from the AU city maps.
HQ = {
    '4DX': 'mel', 'AFI': 'mel', 'AGL': 'syd', 'ALD': 'syd', 'ALK': 'per', 'ALL': 'syd',
    'ALQ': 'bne', 'ALX': 'mel', 'AMC': 'mel', 'AMP': 'syd', 'ANN': 'mel', 'ANZ': 'mel',
    'APA': 'syd', 'APE': 'bne', 'ARB': 'mel', 'ARG': 'adl', 'ASB': 'per', 'ASK': 'syd',
    'ASX': 'syd', 'AUB': 'syd', 'AZJ': 'bne', 'BEN': 'mel', 'BGA': 'syd', 'BGL': 'per',
    'BHP': 'mel', 'BOQ': 'bne', 'BPT': 'adl', 'BRG': 'syd', 'BSL': 'syd', 'BWP': 'per',
    'BXB': 'syd', 'CAR': 'mel', 'CBA': 'syd', 'CDA': 'adl', 'CGF': 'syd', 'CHC': 'syd',
    'CIP': 'syd', 'CLW': 'syd', 'CMM': 'per', 'COH': 'syd', 'COL': 'mel', 'CPU': 'mel',
    'CQR': 'syd', 'CSL': 'mel', 'CTD': 'bne', 'CWY': 'mel', 'CYL': 'per', 'DBI': 'bne',
    'DNL': 'mel', 'DOW': 'syd', 'DRO': 'syd', 'DRR': 'per', 'DXS': 'syd', 'DYL': 'per',
    'EDV': 'syd', 'EMR': 'per', 'EOS': 'syd', 'EVN': 'syd', 'EVT': 'syd', 'FLT': 'bne',
    'FMG': 'per', 'GDG': 'mel', 'GGP': 'per', 'GMD': 'per', 'GMG': 'syd', 'GPT': 'syd',
    'HDN': 'syd', 'HUB': 'syd', 'HVN': 'syd', 'IAG': 'syd', 'IFL': 'mel', 'IGO': 'per',
    'ILU': 'per', 'IMD': 'per', 'JBH': 'mel', 'L1G': 'mel', 'LLC': 'syd', 'LOV': 'mel',
    'LSF': 'mel', 'LTR': 'per', 'LYC': 'per', 'MFF': 'syd', 'MFG': 'syd', 'MGR': 'syd',
    'MIN': 'per', 'MND': 'per', 'MPL': 'mel', 'MQG': 'syd', 'MSB': 'mel', 'MTS': 'syd',
    'MXT': 'syd', 'NAB': 'mel', 'NHC': 'bne', 'NHF': 'syd', 'NIC': 'syd', 'NSR': 'bne',
    'NST': 'per', 'NXT': 'bne', 'OBM': 'per', 'ORA': 'mel', 'ORG': 'syd', 'ORI': 'mel',
    'PDI': 'per', 'PDN': 'per', 'PLS': 'per', 'PME': 'mel', 'PMV': 'mel', 'PNI': 'syd',
    'PPT': 'syd', 'PRN': 'per', 'PRU': 'per', 'PXA': 'mel', 'QAN': 'syd', 'QBE': 'syd',
    'QUB': 'syd', 'RDX': 'syd', 'REA': 'mel', 'REG': 'mel', 'REH': 'mel', 'RGN': 'syd',
    'RHC': 'syd', 'RIO': 'mel', 'RMS': 'per', 'RRL': 'per', 'RSG': 'per', 'RWC': 'syd',
    'S32': 'per', 'SCG': 'syd', 'SDF': 'syd', 'SEK': 'mel', 'SFR': 'per', 'SGH': 'syd',
    'SGM': 'syd', 'SGP': 'syd', 'SHL': 'syd', 'SIG': 'mel', 'SMR': 'bne', 'SOL': 'syd',
    'STO': 'adl', 'SUL': 'bne', 'SUN': 'bne', 'TAH': 'mel', 'TCL': 'mel', 'TLC': 'mel',
    'TLS': 'mel', 'TLX': 'mel', 'TNE': 'bne', 'TPG': 'syd', 'TWE': 'mel', 'VAU': 'per',
    'VCX': 'mel', 'VEA': 'mel', 'VGN': 'bne', 'VNT': 'syd', 'WAF': 'per', 'WAM': 'syd',
    'WBC': 'syd', 'WDS': 'per', 'WES': 'per', 'WGX': 'per', 'WHC': 'syd', 'WLE': 'syd',
    'WOR': 'syd', 'WOW': 'syd', 'WTC': 'syd', 'YAL': 'syd', 'ZIP': 'syd',
}
CITYNAME = {'syd': 'sydney', 'mel': 'melbourne', 'per': 'perth', 'bne': 'brisbane', 'adl': 'adelaide'}


def parse_existing_rosters():
    """Existing roster tickers per AU city (to dedupe + regenerate targets)."""
    txt = open(CITY_ROSTERS_TS).read()
    out = {}
    for city in ('adelaide', 'melbourne', 'sydney', 'brisbane', 'perth'):
        m = re.search(city + r':\s*\{\s*exchange:[^\[]*\[(.*?)\]\s*,?\s*\}', txt, re.S)
        rows = []
        if m:
            for e in re.finditer(r"\[\s*'([^']+)',\s*'((?:[^'\\]|\\.)*)',\s*([A-Z]{3})", m.group(1)):
                rows.append((e.group(1), e.group(2).replace("\\'", "'"), e.group(3)))
        out[city] = rows
    return out


def parse_handplaced():
    """The hand-placed AU_JOBS_TARGETS (id/name/sector/group/cities) to preserve."""
    txt = open(AU_TARGETS_TS).read()
    body = txt.split('AU_JOBS_TARGETS: JobsTarget[] = [', 1)[1]
    return json.loads('[' + body.split('];', 1)[0] + ']')


def main():
    rows = json.load(open(ROWS))[1:]
    existing_rosters = parse_existing_rosters()
    handplaced = parse_handplaced()
    # tickers already represented (roster tickers + hand-placed, incl id-as-ticker)
    have = set()
    for city, lst in existing_rosters.items():
        for tk, _, _ in lst:
            have.add(tk.upper())
    hp_tickers = {'ALK', 'AOW', 'ASB', 'BPT', 'BHP', 'BMN', 'BOE', 'CCV', 'CMM', 'CVN', 'CXO',
                  'DEG', 'DEL', 'DYL', 'FMG', 'GMD', 'GOR', 'HGO', 'IGO', 'ILU', 'JMS', 'LTR',
                  'MAH', 'MGT', 'MIN', 'MMI', 'MND', 'NHC', 'NST', 'NWH', 'PDN', 'PLS', 'PRU',
                  'RIO', 'RMS', 'RRL', 'S32', 'SFR', 'SGQ', 'SMR', 'STO', 'STX', 'SW1', 'SWM',
                  'WDS', 'WES', 'WGX'}
    have |= hp_tickers

    new_by_city = {c: [] for c in CITYNAME.values()}
    skipped = 0
    for code, name, sector, *_ in rows:
        code = code.strip()
        grp = GICS2GROUP.get(sector)
        city = HQ.get(code)
        if not grp or not city:
            skipped += 1
            continue
        if code.upper() in have:
            continue
        new_by_city[CITYNAME[city]].append((code, name.strip(), grp))
        have.add(code.upper())

    # 1) roster rows to append per AU city
    print('=== NEW ROSTER ROWS (append to cityRosters.ts) ===')
    for city in ('perth', 'adelaide', 'brisbane', 'melbourne', 'sydney'):
        rowsc = new_by_city[city]
        if not rowsc:
            continue
        print(f'\n--- {city} (+{len(rowsc)}) ---')
        for tk, nm, g in rowsc:
            print(f"      ['{tk}', {json.dumps(nm)}, {g}],")

    # 2) regenerate auJobsTargets = hand-placed + ALL AU roster companies
    def rid(city, tk):
        return re.sub(r'[^a-z0-9-]', '', f'{city}-{tk}'.lower())
    targets = list(handplaced)
    seen = {t['id'] for t in targets}
    all_rosters = {c: list(existing_rosters[c]) for c in CITYNAME.values()}
    for city in CITYNAME.values():
        for tk, nm, g in new_by_city[city]:
            all_rosters[city].append((tk, nm, g))
    for city, lst in all_rosters.items():
        for tk, nm, g in lst:
            i = rid(city, tk)
            if i in seen:
                continue
            seen.add(i)
            targets.append({'id': i, 'name': nm, 'sector': GROUP_FULL[g], 'group': GROUP_FULL[g], 'cities': [city]})

    L = ['// AUTO-GENERATED — Australian companies targeted by the live jobs pipeline.',
         '// Hand-placed resources names + every AU city-roster company (now the full',
         '// S&P/ASX 200 mapped to its HQ city). Each drives the daily Adzuna pull.',
         '// Regenerate with scripts/gen-asx200.py.',
         'export interface JobsTarget { id: string; name: string; sector: string; group: string; cities: string[]; }',
         'export const AU_JOBS_TARGETS: JobsTarget[] = ' + json.dumps(targets, indent=2) + ';', '']
    open(AU_TARGETS_TS, 'w').write('\n'.join(L))
    print(f'\n=== auJobsTargets regenerated: {len(targets)} targets ===')
    print(f'new companies added: {sum(len(v) for v in new_by_city.values())}, skipped (foreign/unmapped): {skipped}')


if __name__ == '__main__':
    main()
