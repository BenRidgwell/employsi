import type {
  TASK_INDEX as TaskIndex,
  ONTOLOGY_SKILLS as OntologySkills,
} from "../data/skillOntology";

// The O*NET ontology is 720KB — by a wide margin the largest single thing the
// app ships, and it is used by exactly one feature: turning a free-text query
// into candidate skills. Statically importing it put all 720KB on the boot path
// for every visitor, including the ones who never type in the search box.
//
// So it is loaded on demand. The public API stays SYNCHRONOUS, because both
// call sites use it inside a useMemo and making it async would spread promises
// through the search's render path for no user-visible gain. Instead:
//
//   • before the data arrives, describeSkills returns [] — search still works,
//     it just falls back to direct name matches, which is what it does for
//     short queries anyway;
//   • the first call kicks off the fetch;
//   • useOntologyReady() lets a component re-run its memo once it lands.
//
// The degraded window is one network round trip on the first keystroke, and
// it degrades to "fewer suggestions", never to a wrong answer.
type Ontology = { TASK_INDEX: typeof TaskIndex; ONTOLOGY_SKILLS: typeof OntologySkills };

let onto: Ontology | null = null;
let pending: Promise<Ontology> | null = null;
const waiters = new Set<() => void>();

export function loadOntology(): Promise<Ontology> {
  if (onto) return Promise.resolve(onto);
  if (!pending) {
    pending = import("../data/skillOntology").then((m) => {
      onto = { TASK_INDEX: m.TASK_INDEX, ONTOLOGY_SKILLS: m.ONTOLOGY_SKILLS };
      for (const w of waiters) w();
      waiters.clear();
      return onto;
    });
  }
  return pending;
}

/** True once the ontology is in memory; triggers the load on first use. */
export function onOntologyReady(cb: () => void): () => void {
  if (onto) return () => {};
  waiters.add(cb);
  void loadOntology();
  return () => waiters.delete(cb);
}

export function ontologyLoaded(): boolean {
  return !!onto;
}

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
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
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
    if (!STOP.has(words[i]) && !STOP.has(words[i + 1])) out.push(words[i] + " " + words[i + 1]);
  }
  return out;
}

// Ranked canonical skill names most relevant to the described task/query.
export function describeSkills(query: string, n = 6): string[] {
  const q = (query || "").trim();
  if (q.length < 3) return [];
  // Not loaded yet: start the fetch and return nothing this pass. Callers that
  // want the result to appear when it lands subscribe via onOntologyReady.
  if (!onto) {
    void loadOntology();
    return [];
  }
  const acc = new Map<number, number>();
  for (const t of new Set(tokens(q))) {
    // hasOwn, NOT a truthiness check on the lookup. TASK_INDEX is a plain
    // object literal, so `TASK_INDEX["constructor"]` answers with the inherited
    // Object.prototype member for any token it does not hold — an object, so
    // truthy, with no `s` on it, and the destructuring loop below then throws
    // on the whole query. Every token here is lowercased and stripped of
    // non-alphanumerics, which rules out `toString` and `__proto__` but not
    // `constructor`, an ordinary word someone can type into a search box.
    // The generator also refuses to emit these names (PROTO_KEYS), so this
    // guard is what makes the search safe rather than what makes it correct.
    if (!Object.hasOwn(onto.TASK_INDEX, t)) continue;
    const e = onto.TASK_INDEX[t];
    if (!e) continue;
    for (const [si, share] of e.s) acc.set(si, (acc.get(si) || 0) + e.w * share);
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([si]) => onto!.ONTOLOGY_SKILLS[si])
    .filter(Boolean);
}
