#!/usr/bin/env python3
"""Build src/employsi/data/skillOntology.ts from the O*NET database, so the
search bar can turn a free-text *task / description* into the relevant canonical
skills (e.g. "workforce planning" -> Human Resources).

Ontology chain: O*NET task statement / alternate title  ->  O*NET occupation
(SOC)  ->  our canonical skill (via the shared skillsTaxonomy terms). We invert
that into a compact word/phrase -> skill index the client can score a query
against.

Inputs (O*NET db text files, tab-separated) placed in a folder passed as argv[1]:
  Occupation Data.txt, Task Statements.txt, Alternate Titles.txt
Download: https://www.onetcenter.org/dl_files/database/db_29_1_text/
"""
import sys, re, json, math
from collections import defaultdict

ROOT = __file__.rsplit('/scripts/', 1)[0]
TAX = f'{ROOT}/src/employsi/data/skillsTaxonomy.ts'
OUT = f'{ROOT}/src/employsi/data/skillOntology.ts'

STOP = set("""a an the and or of to in for on with at by from as is are be been being this that these those it its
their his her our your my we you they he she i us them then than there here into over under out up down off
will would can could should may might must shall not no nor so such other others any all each both few more most
some many much very also both either neither per via within without across between about above below during
after before while when where which who whom whose what how why use used using uses including include includes
included based provide provides provided providing perform performs performed performing work works working
worked activities duty duties task tasks ensure ensures ensured ensuring determine determines identify identifies
maintain maintains prepare prepares develop develops operate operates conduct conducts new various related
appropriate necessary etc may due able make makes made take takes given follow follows following record records
report reports process processes procedure procedures general standard standards
required requires requiring order orders one two three""".split())


def stem(w):
    if len(w) > 5 and w.endswith('ing'):
        return w[:-3]
    if len(w) > 4 and w.endswith('ed'):
        return w[:-2]
    if len(w) > 3 and w.endswith('s') and not w.endswith('ss'):
        return w[:-1]
    return w


def load_skills():
    body = open(TAX).read().split('export const SKILLS', 1)[1].split('];', 1)[0]
    out = []
    for m in re.finditer(r"\{\s*skill:\s*'([^']+)',\s*cat:\s*'([^']+)',\s*terms:\s*\[([^\]]*)\]\s*\}", body):
        out.append((m.group(1), re.findall(r"'([^']*)'", m.group(3))))
    return out


def rows(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        header = f.readline().rstrip('\n').split('\t')
        for line in f:
            cells = line.rstrip('\n').split('\t')
            if len(cells) >= len(header):
                yield dict(zip(header, cells))


# Tokenizer shared, byte-for-byte, with the TS query side (skillOntology query in
# GlobalSearch): lowercase, split on non-alnum, drop stopwords, keep unigrams
# (plus a light stem so "designing"→"design", "buildings"→"building") and
# adjacent bigrams.
def tokens(text):
    words = [w for w in re.split(r'[^a-z0-9]+', text.lower()) if len(w) >= 3 and not w.isdigit()]
    out = []
    for w in words:
        if w in STOP:
            continue
        out.append(w)
        s = stem(w)
        if s != w and len(s) >= 4:
            out.append(s)
    for i in range(len(words) - 1):
        if words[i] not in STOP and words[i + 1] not in STOP:
            out.append(words[i] + ' ' + words[i + 1])
    return out


def main(folder):
    skills = load_skills()
    names = [n for n, _ in skills]
    idx_of = {n: i for i, n in enumerate(names)}

    def skills_for(title):
        hay = ' ' + title.lower() + ' '
        return [n for (n, ts) in skills if any(t in hay for t in ts)]

    occ_title = {}
    for r in rows(f'{folder}/Occupation Data.txt'):
        occ_title[r['O*NET-SOC Code']] = r['Title']
    alts = defaultdict(list)
    for r in rows(f'{folder}/Alternate Titles.txt'):
        alts[r['O*NET-SOC Code']].append(r.get('Alternate Title', ''))

    # occupation -> canonical skills (title + alternate titles broaden the match)
    occ_skills = {}
    for soc, title in occ_title.items():
        s = skills_for(title)
        if not s:
            s = skills_for(title + ' ' + ' '.join(alts.get(soc, [])[:40]))
        if s:
            occ_skills[soc] = s
    print(f'occupations mapped to skills: {len(occ_skills)}/{len(occ_title)}')

    def entry(sc, w_base, min_share):
        total = sum(sc.values())
        ranked = sorted(sc.items(), key=lambda kv: -kv[1])
        top_share = ranked[0][1] / total
        if top_share < min_share:
            return None
        kept = [(idx_of[s], round(v / total, 3)) for s, v in ranked[:4] if v / total >= 0.08]
        if not kept:
            return None
        return {'w': round(w_base * top_share, 3), 's': kept}

    # Tier 1 — authoritative: each skill's own name + taxonomy terms. These map a
    # word straight to its skill with no task-text noise, so "welding", "nursing",
    # "cyber", "software" always resolve. Always included, regardless of the cap.
    seed = defaultdict(lambda: defaultdict(float))
    for name, terms in skills:
        for t in set(tokens(name)):
            seed[t][name] += 2.0
        for term in terms:
            for t in set(tokens(term)):
                seed[t][name] += 1.0

    # Tier 2 — descriptive: O*NET occupation titles / alt-titles / task text, so
    # a free-text *task* ("workforce planning", "caring for the elderly") resolves
    # even when its words aren't taxonomy terms. Titles count most; task text is
    # low-weighted so its volume can't drown the title signal.
    onet = defaultdict(lambda: defaultdict(float))
    ofreq = defaultdict(int)

    def addo(text, sk, mult):
        share = mult / len(sk)
        for t in set(tokens(text)):
            ofreq[t] += 1
            for s in sk:
                onet[t][s] += share

    for soc, s in occ_skills.items():
        addo(occ_title[soc], s, 3.0)
        for at in alts.get(soc, []):
            addo(at, s, 2.0)
    for r in rows(f'{folder}/Task Statements.txt'):
        sk = occ_skills.get(r['O*NET-SOC Code'])
        if sk:
            addo(r['Task'], sk, 0.4)

    index = {}
    for t, sc in seed.items():
        e = entry(sc, 1.0, 0.30)
        if e:
            index[t] = e

    CAP = 12000
    cands = []
    for t, sc in onet.items():
        if t in index or ofreq[t] < 3:
            continue
        e = entry(sc, 0.85, 0.28)
        if not e:
            continue
        useful = e['w'] * min(1.0, math.log10(ofreq[t] + 1) / 1.3)  # concentrated AND common enough to be typed
        cands.append((useful, t, e))
    cands.sort(key=lambda x: -x[0])
    for _, t, e in cands[: max(0, CAP - len(index))]:
        index[t] = e
    print(f'ontology tokens: {len(index)} ({len([1 for t in index if t in seed])} seed)')

    L = []
    L.append('// GENERATED — do not edit by hand. Run scripts/gen-skill-ontology.py.')
    L.append('// Source: O*NET 29.1 database (Occupation Data, Task Statements, Alternate')
    L.append('// Titles). Maps a free-text task / description to canonical skills so the')
    L.append('// search bar can resolve e.g. "workforce planning" -> Human Resources. Each')
    L.append('// entry is a word or bigram -> { w: token weight, s: [[skillIndex, share]] },')
    L.append('// where skillIndex points into ONTOLOGY_SKILLS (same names as the taxonomy).')
    L.append('')
    L.append('export const ONTOLOGY_SKILLS: string[] = ' + json.dumps(names) + ';')
    L.append('')
    L.append('export interface OntologyEntry { w: number; s: [number, number][]; }')
    L.append('export const TASK_INDEX: Record<string, OntologyEntry> = {')
    for t in sorted(index):
        e = index[t]
        s = ','.join(f'[{i},{w}]' for i, w in e['s'])
        L.append(f'  {json.dumps(t)}: {{ w: {e["w"]}, s: [{s}] }},')
    L.append('};')
    L.append('')
    open(OUT, 'w').write('\n'.join(L))
    print(f'wrote {OUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-skill-ontology.py path/to/onet_db_text_folder')
    main(sys.argv[1])
