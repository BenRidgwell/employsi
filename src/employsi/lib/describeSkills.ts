import { TASK_INDEX, ONTOLOGY_SKILLS } from '../data/skillOntology';

// Turn a free-text task / description into canonical skills, using the O*NET
// skill ontology (task → occupation → skill). The tokenizer here MUST match the
// one in scripts/gen-skill-ontology.py byte-for-byte, or the query words won't
// line up with the pre-built index keys.

const STOP = new Set(
  `a an the and or of to in for on with at by from as is are be been being this that these those it its
their his her our your my we you they he she i us them then than there here into over under out up down off
will would can could should may might must shall not no nor so such other others any all each both few more most
some many much very also both either neither per via within without across between about above below during
after before while when where which who whom whose what how why use used using uses including include includes
included based provide provides provided providing perform performs performed performing work works working
worked activities duty duties task tasks ensure ensures ensured ensuring determine determines identify identifies
maintain maintains prepare prepares develop develops operate operates conduct conducts new various related
appropriate necessary etc may due able make makes made take takes given follow follows following record records
report reports process processes procedure procedures general standard standards
required requires requiring order orders one two three`.split(/\s+/),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokens(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (w) => w.length >= 3 && !/^\d+$/.test(w),
  );
  const out: string[] = [];
  for (const w of words) {
    if (STOP.has(w)) continue;
    out.push(w);
    const s = stem(w);
    if (s !== w && s.length >= 4) out.push(s);
  }
  for (let i = 0; i < words.length - 1; i++) {
    if (!STOP.has(words[i]) && !STOP.has(words[i + 1])) out.push(words[i] + ' ' + words[i + 1]);
  }
  return out;
}

// Ranked canonical skill names most relevant to the described task/query.
export function describeSkills(query: string, n = 6): string[] {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  const acc = new Map<number, number>();
  for (const t of new Set(tokens(q))) {
    const e = TASK_INDEX[t];
    if (!e) continue;
    for (const [si, share] of e.s) acc.set(si, (acc.get(si) || 0) + e.w * share);
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([si]) => ONTOLOGY_SKILLS[si])
    .filter(Boolean);
}
