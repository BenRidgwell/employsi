/**
 * Invariants for "Ask an analyst" follow-up handling.
 *
 * Run: bun run scripts/check-analyst-followups.ts
 *
 * WHAT THIS IS GUARDING. Follow-ups work by carrying the previous turn's query
 * and letting each new sentence overwrite only the parts it names. That is a
 * good mechanism and a fragile one: when scope resolution misfires, nothing
 * errors. The analyst simply answers a different question — about a different
 * company, in a different country — and every figure on screen still looks
 * plausible, because they are all real numbers about the wrong thing.
 *
 * So the cases below are mostly about what must NOT resolve.
 */
import {
  detectScope,
  scopeForCity,
  scopeForCountry,
  scopeForRegion,
  WORLD_SCOPE,
} from "../src/employsi/lib/analystScope";
import {
  describeQuery,
  followUpsFor,
  resolveTurn,
  type AnalystQuery,
} from "../src/employsi/lib/analystTurn";

let failures = 0;
const fail = (msg: string) => {
  console.error(`  FAIL  ${msg}`);
  failures++;
};

// ── 1. The sentences the feature exists to support ──────────────────────────
const RESOLVES: [string, string, string][] = [
  // question, expected kind, expected label
  ["What about Sydney?", "city", "Sydney"],
  ["what about BHP?", "company", "BHP"],
  ["same for Canada", "country", "Canada"],
  ["how about Perth instead", "city", "Perth"],
  ["and in New Zealand?", "country", "New Zealand"],
  ["show me that worldwide", "world", "Worldwide"],
];
console.log("resolving the follow-ups the feature is for:");
for (const [q, kind, label] of RESOLVES) {
  const got = detectScope(q, "perth");
  if (!got) fail(`${JSON.stringify(q)} resolved to nothing, expected ${kind} ${label}`);
  else if (got.kind !== kind || got.label !== label) {
    fail(`${JSON.stringify(q)} -> ${got.kind} ${got.label}, expected ${kind} ${label}`);
  } else console.log(`  ok    ${JSON.stringify(q)} -> ${got.kind} ${got.label}`);
}

// ── 2. THE TRAP. Substring matching over 1,508 company names ────────────────
// "What about Sydney?" contains "EY". Measured against the real roster before
// this resolver existed, using detectSkill's own `includes()` matching, that is
// exactly what it returned — the most likely follow-up in the feature, quietly
// answered about an accounting firm.
console.log("\nnot mistaking ordinary words for companies:");
const MUST_NOT_BE_COMPANY: string[] = [
  "What about Sydney?", // EY, inside "Sydn-ey"
  "which roles offer visa sponsorship", // Visa, the payments company
  "hmm what about pay", // HMM, the shipping line
  "Which skills are most in demand?",
  "How does pay compare against the wider market?",
  "and for nursing?",
];
for (const q of MUST_NOT_BE_COMPANY) {
  const got = detectScope(q, "perth");
  if (got?.kind === "company") fail(`${JSON.stringify(q)} resolved to company ${got.label}`);
  else
    console.log(`  ok    ${JSON.stringify(q)} -> ${got ? `${got.kind} ${got.label}` : "no scope"}`);
}

// ── 3. Naming nothing must keep the scope in play ───────────────────────────
// This is what makes "and for nursing?" stay where the user already was.
console.log("\nquestions that name no place resolve to nothing:");
const NO_SCOPE = [
  "and for nursing?",
  "Which skills take longest to fill?",
  "why?",
  "What do these roles pay?",
];
for (const q of NO_SCOPE) {
  const got = detectScope(q, "perth");
  if (got) fail(`${JSON.stringify(q)} resolved to ${got.kind} ${got.label}, expected nothing`);
  else console.log(`  ok    ${JSON.stringify(q)} -> no scope`);
}

// ── 4. Most specific wins, as decided ───────────────────────────────────────
console.log("\nnarrowest scope wins when a sentence names two:");
{
  const got = detectScope("how is BHP hiring in Perth?", "perth");
  if (got?.kind !== "company") {
    fail(`"BHP in Perth" -> ${got?.kind ?? "nothing"} ${got?.label ?? ""}, expected company`);
  } else console.log(`  ok    "BHP in Perth" -> ${got.kind} ${got.label}`);
}

// ── 5. Every resolved scope must carry archive rows ─────────────────────────
// A scope with no hubs answers every question with "nothing here", which reads
// as a quiet market rather than as a resolver bug.
console.log("\nresolved scopes carry hubs:");
{
  // Counted locally: gating this line on the GLOBAL failure count meant an
  // unrelated failure above silently suppressed this section's result, so a
  // passing check looked like a skipped one.
  const before = failures;
  for (const [q] of RESOLVES) {
    const got = detectScope(q, "perth");
    if (got && got.kind !== "world" && got.hubs.length === 0) {
      fail(`${JSON.stringify(q)} -> ${got.label} with no hubs`);
    }
  }
  if (failures === before) console.log("  ok    every resolved scope has hubs (world excepted)");
}

// ── 6. Turn sequences: what a follow-up actually inherits ───────────────────
// Single sentences are not the feature. These are.
console.log("\ncarrying an analysis across turns:");
const PERTH = scopeForCity("perth")!;

interface Step {
  q: string;
  intent: string;
  skill: string | null;
  scope: string;
}
const SEQUENCES: { name: string; steps: Step[] }[] = [
  {
    name: "pivot the place, keep the question",
    steps: [
      { q: "Which skills are most in demand?", intent: "skills", skill: null, scope: "Perth" },
      { q: "What about Sydney?", intent: "skills", skill: null, scope: "Sydney" },
      { q: "and Canada?", intent: "skills", skill: null, scope: "Canada" },
    ],
  },
  {
    name: "pivot the skill, keep the question and the place",
    steps: [
      { q: "How is hiring trending?", intent: "volume", skill: null, scope: "Perth" },
      { q: "What about Sydney?", intent: "volume", skill: null, scope: "Sydney" },
      { q: "and for Nursing?", intent: "volume", skill: "Nursing", scope: "Sydney" },
    ],
  },
  {
    name: "pivot to a company",
    steps: [
      { q: "What do these roles pay?", intent: "pay", skill: null, scope: "Perth" },
      { q: "what about BHP?", intent: "pay", skill: null, scope: "BHP" },
    ],
  },
  {
    name: "A NEW QUESTION MUST DROP THE OLD SKILL",
    // The failure this guards: inherit-everything-always would answer a
    // market-wide question about one skill, silently, with real figures.
    steps: [
      {
        q: "How does Software Engineering pay?",
        intent: "pay",
        skill: "Software Engineering",
        scope: "Perth",
      },
      { q: "Which skills are most in demand?", intent: "skills", skill: null, scope: "Perth" },
    ],
  },
  {
    name: "a new question still keeps the place",
    steps: [
      { q: "What about Sydney?", intent: "unknown", skill: null, scope: "Sydney" },
      { q: "Which skills take longest to fill?", intent: "duration", skill: null, scope: "Sydney" },
    ],
  },
];

for (const seq of SEQUENCES) {
  let carried: AnalystQuery | null = null;
  const before = failures;
  for (const step of seq.steps) {
    const turn = resolveTurn(step.q, carried, PERTH, "perth");
    carried = turn.query;
    const got = `${turn.query.intent}/${turn.query.skill ?? "—"}/${turn.query.scope.label}`;
    const want = `${step.intent}/${step.skill ?? "—"}/${step.scope}`;
    if (got !== want) fail(`${seq.name}: ${JSON.stringify(step.q)} -> ${got}, expected ${want}`);
  }
  if (failures === before) console.log(`  ok    ${seq.name}`);
}

// ── 7. An inherited turn must be able to say what it is about ───────────────
// Carried state steering real figures has to be visible; see TurnResult.inherited.
console.log("\ninherited turns are labelled:");
{
  const before = failures;
  const first = resolveTurn("How is hiring trending?", null, PERTH, "perth");
  if (first.inherited.length) fail("the first turn inherited something");
  const next = resolveTurn("What about Sydney?", first.query, PERTH, "perth");
  if (!next.inherited.includes("intent")) fail("a bare pivot did not record the inherited intent");
  if (describeQuery(next.query) !== "Sydney") {
    fail(`describeQuery -> ${JSON.stringify(describeQuery(next.query))}, expected "Sydney"`);
  }
  const withSkill = resolveTurn("and for Nursing?", next.query, PERTH, "perth");
  if (describeQuery(withSkill.query) !== "Nursing · Sydney") {
    fail(`describeQuery -> ${JSON.stringify(describeQuery(withSkill.query))}`);
  }
  if (failures === before) console.log("  ok    first turn inherits nothing; pivots are labelled");
}

// ── 8. Suggested follow-ups must do what their label says ───────────────────
// PROMPT_TOPICS exists because a suggestion leading to "I can't answer that" is
// worse than no suggestion. Same standard here, with a sharper edge: a chip
// reading "Australia" that silently answers about somewhere else is worse than
// a chip that fails, because the answer looks right.
console.log("\nsuggested follow-ups resolve to what they claim:");
{
  const before = failures;
  const alternatives = [
    scopeForCity("perth")!,
    scopeForCity("sydney")!,
    scopeForCountry("au")!,
    scopeForRegion("australia")!,
    WORLD_SCOPE,
  ];
  const base = resolveTurn("Which skills are most in demand?", null, alternatives[0], "perth");
  const ups = followUpsFor(base.query, alternatives, "perth");
  if (!ups.length) fail("no follow-ups offered at all");
  for (const f of ups) {
    // Ask the chip's own question and check it lands where the chip said.
    const turn = resolveTurn(f.question, base.query, alternatives[0], "perth");
    if (turn.query.scope.label !== f.label && f.label !== "Across cities") {
      fail(
        `chip ${JSON.stringify(f.label)} asks ${JSON.stringify(f.question)} -> ${turn.query.scope.label}`,
      );
    } else console.log(`  ok    ${f.label.padEnd(14)} -> ${turn.query.scope.label}`);
  }
  // Never offer a pivot to where the analysis already is.
  if (ups.some((f) => f.label === base.query.scope.label)) {
    fail("offered a pivot to the scope already in play");
  }
  // The region chip and the country share the label "Australia", and the
  // sentence resolves to the COUNTRY. Whichever of the two survives, exactly
  // one must — offering both would put two identical chips side by side that
  // do different things.
  if (ups.filter((f) => f.label === "Australia").length > 1) {
    fail("two chips both labelled Australia");
  }
  if (failures === before) console.log("  ok    every offered pivot round-trips");
}

// ── 9. A skill in play offers the area split, and only then ─────────────────
console.log("\nthe area split is offered only when there is a subject to split:");
{
  const before = failures;
  const perth = scopeForCity("perth")!;
  const noSkill = resolveTurn("How is hiring trending?", null, perth, "perth");
  if (followUpsFor(noSkill.query, [perth], "perth").some((f) => f.label === "Across cities")) {
    fail("offered an area split with no skill in play");
  }
  const withSkill = resolveTurn("and for Nursing?", noSkill.query, perth, "perth");
  if (!followUpsFor(withSkill.query, [perth], "perth").some((f) => f.label === "Across cities")) {
    fail("no area split offered with a skill in play");
  }
  if (failures === before) console.log("  ok    offered with a skill, withheld without one");
}

console.log(failures ? `\n${failures} failure(s).` : "\nAll analyst follow-up checks passed.");
process.exit(failures ? 1 : 0);
