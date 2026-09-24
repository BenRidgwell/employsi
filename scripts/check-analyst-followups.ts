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
import { readFileSync } from "node:fs";

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
import {
  detectIntent,
  detectSkillMatch,
  INTENT_LABEL,
  INTENT_QUESTION,
  PROMPT_TOPICS,
  SUGGESTED_PROMPTS,
} from "../src/employsi/lib/analystIntent";
import { chatReply, detectChat } from "../src/employsi/lib/analystChat";
import { answerQuestion } from "../src/employsi/lib/analystAnswer";

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
  // Three kinds of chip now share this row and they make different promises, so
  // each is checked against its own. An intent chip is the one that had to be
  // added here rather than waved through: it must NOT move the scope, or "Pay"
  // would quietly answer about somewhere else while reading like a filter.
  const INTENT_LABELS = new Set(Object.values(INTENT_LABEL));
  for (const f of ups) {
    // Ask the chip's own question and check it lands where the chip said.
    const turn = resolveTurn(f.question, base.query, alternatives[0], "perth");
    if (INTENT_LABELS.has(f.label)) {
      const want = Object.entries(INTENT_LABEL).find(([, l]) => l === f.label)?.[0];
      if (turn.query.intent !== want) {
        fail(
          `chip ${JSON.stringify(f.label)} asks ${JSON.stringify(f.question)} -> intent ${turn.query.intent}, expected ${want}`,
        );
      } else if (turn.query.scope.label !== base.query.scope.label) {
        fail(`chip ${JSON.stringify(f.label)} moved the scope to ${turn.query.scope.label}`);
      } else
        console.log(
          `  ok    ${f.label.padEnd(14)} -> intent ${turn.query.intent}, still ${turn.query.scope.label}`,
        );
    } else if (f.label === "Across cities") {
      console.log(`  ok    ${f.label.padEnd(14)} -> area split`);
    } else if (turn.query.scope.label !== f.label) {
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

// ── a question naming a speciality ──────────────────────────────────────────
//
// The long-run answers come from the statistical agencies' vacancy series, and
// those are per broad occupation — skillHistory("Midwifery") is null, as it is
// for all 122 specialities. Naming one used to be ignored outright: the word
// was dropped and a market-wide answer came back. It now resolves to the skill
// the speciality narrows, WHICH IS ONLY ACCEPTABLE BECAUSE THE ANSWER SAYS SO.
// The disclosure is the thing under test here; routing without it would be
// changing the subject quietly.
{
  const before = failures;
  const m = detectSkillMatch("how is midwifery demand trending?");
  if (m?.skill !== "Nursing" || m?.via !== "Midwifery") {
    fail(`a speciality did not resolve to its parent — got ${JSON.stringify(m)}`);
  }
  const direct = detectSkillMatch("how is nursing demand trending?");
  if (direct?.skill !== "Nursing" || direct?.via !== null) {
    fail(`naming a broad skill was answered by way of a speciality — ${JSON.stringify(direct)}`);
  }
  // Longest wins, so the more specific reading is taken.
  const longer = detectSkillMatch("aged care nursing trend");
  if (longer?.via !== "Aged Care Nursing") {
    fail(`longest match did not win — got ${JSON.stringify(longer)}`);
  }
  if (failures === before) console.log("  ok    a speciality resolves to the skill it narrows");
}
{
  const before = failures;
  const t1 = resolveTurn("how is midwifery demand trending?", null, WORLD_SCOPE);
  if (t1.query.skill !== "Nursing" || t1.query.skillVia !== "Midwifery") {
    fail("the turn did not carry the speciality");
  }
  if (!describeQuery(t1.query).includes("Midwifery")) {
    fail(`the chip dropped the speciality — "${describeQuery(t1.query)}"`);
  }
  // Inherited WITH the skill, never apart from it.
  const t2 = resolveTurn("and across cities?", t1.query, WORLD_SCOPE);
  if (t2.query.skillVia !== "Midwifery") fail("a follow-up lost the speciality");
  // A new question naming the broad skill must not keep the old speciality.
  const t3 = resolveTurn("how is nursing demand trending?", t1.query, WORLD_SCOPE);
  if (t3.query.skillVia !== null) fail(`a pivot kept a stale via — ${t3.query.skillVia}`);
  if (failures === before) {
    console.log("  ok    it is inherited with the skill, and cleared by a pivot");
  }
}
{
  const before = failures;
  // The answer itself, on the static series path — no D1 needed.
  const q = "how is midwifery demand trending?";
  const t = resolveTurn(q, null, WORLD_SCOPE);
  const a = await answerQuestion(
    q,
    t.query.scope,
    t.query.scope.hubs,
    t.query.scope.country,
    undefined,
    undefined,
    {
      intent: t.query.intent,
      skill: t.query.skill,
      skillVia: t.query.skillVia,
      wantsAreas: t.query.wantsAreas,
    },
  );
  if (!a.text.includes("Midwifery") || !a.text.includes("Nursing")) {
    fail(`the answer did not name both the speciality and the skill:\n    ${a.text.slice(0, 160)}`);
  }
  // Said BEFORE any figure, because it changes what every figure is about.
  const said = a.text.indexOf("speciality within");
  const firstNumber = a.text.search(/\d/);
  if (said < 0 || (firstNumber >= 0 && said > firstNumber)) {
    fail("the disclosure did not come before the first number");
  }
  const plain = "how is nursing demand trending?";
  const tp = resolveTurn(plain, null, WORLD_SCOPE);
  const ap = await answerQuestion(
    plain,
    tp.query.scope,
    tp.query.scope.hubs,
    tp.query.scope.country,
    undefined,
    undefined,
    {
      intent: tp.query.intent,
      skill: tp.query.skill,
      skillVia: tp.query.skillVia,
      wantsAreas: tp.query.wantsAreas,
    },
  );
  if (ap.text.includes("speciality within")) {
    fail("a question naming the broad skill was given the speciality disclosure");
  }
  if (failures === before) {
    console.log("  ok    the answer says which skill it read, before any figure");
    console.log("  ok    ...and a direct question is left alone");
  }
}

// ── the analyst's two skill rankings must not double-count ──────────────────
//
// Both live inside createServerFn bodies and cannot be called from here, so
// this reads the source instead. A source check is the weaker kind and is used
// deliberately: the failure it guards against is a control being silently
// opted out of — someone adds a third ranking, or rewrites one of these two,
// and the top five quietly starts listing a speciality beside the skill it
// narrows again. Nothing about that renders wrong; the bars just add up to
// more ads than the scope holds. The rule itself is asserted behaviourally in
// check-skill-trends.ts; what is asserted here is that the analyst applies it.
{
  const before = failures;
  const src = readFileSync(new URL("../src/employsi/lib/analystFn.ts", import.meta.url), "utf8");
  // Targeted at the two maps that are KEYED BY SKILL — `now` in the skills
  // fold and `bySkill` in the duration fold. Matching on "a ranking" instead
  // was tried and caught the salary-by-currency one too, which has nothing to
  // do with the taxonomy; naming the two maps keeps the guard honest about
  // what it covers.
  // EVERY occurrence, not the first. This used indexOf, and when the pay-by-skill
  // ranking was added on 2026-09-24 it introduced a second `Object.entries(
  // bySkill)` EARLIER in the file than the one this was written for — so the
  // guard silently moved to the new site and stopped checking the old one. A
  // guard that quietly changes what it guards is worse than one that fails.
  const SKILL_MAPS = ["Object.entries(now)", "Object.entries(bySkill)"];
  let ranked = 0;
  for (const needle of SKILL_MAPS) {
    let at = src.indexOf(needle);
    if (at < 0) {
      fail(`analystFn no longer contains ${needle} — this guard needs rewriting`);
      continue;
    }
    while (at >= 0) {
      // Sites that only COUNT are not rankings and have nothing to dedupe; a
      // ranking is one that sorts by the value it is about to present.
      const site = src.slice(at, at + 600);
      const isRanking = site.includes(".sort(") && !site.includes("[0];");
      if (isRanking) {
        ranked++;
        // The dedupe wraps the ranking, so it sits just before the map is read.
        if (!src.slice(Math.max(0, at - 420), at).includes("dropRedundantKin(")) {
          const line = src.slice(0, at).split("\n").length;
          fail(`the ranking over ${needle} at analystFn.ts:${line} does not drop specialities`);
        }
      }
      at = src.indexOf(needle, at + 1);
    }
  }
  if (ranked < 3) {
    fail(`expected at least 3 skill rankings in analystFn, found ${ranked}`);
  }
  if (!src.includes("withParent(")) {
    fail("analystFn no longer labels a speciality with the skill it narrows");
  }
  if (failures === before) {
    console.log(`  ok    all ${ranked} skill rankings drop a speciality whose parent is listed`);
    console.log("  ok    ...and label any speciality that survives");
  }
}

// ── 9. The chat layer must not eat real questions ───────────────────────────
// detectChat runs BEFORE the router, so anything it claims never reaches the
// archive at all. That makes a false positive silent and total: the question
// is not answered wrongly, it is not answered. Every question the product
// itself offers is asserted to fall through.
console.log("\nthe chat layer leaves real questions alone:");
{
  const before = failures;
  const REAL = [
    ...SUGGESTED_PROMPTS,
    ...PROMPT_TOPICS.flatMap((t) => t.questions),
    ...Object.values(INTENT_QUESTION),
    // The shapes most likely to collide with the anchored patterns: short, and
    // carrying a chat word inside a real word ("hi" in "hiring", "ta" in
    // "data", "source" as a question about one).
    "hiring?",
    "what is hiring like",
    "data?",
    "pay",
    "skills",
    "nursing",
    "what about Sydney?",
    "and pay?",
  ];
  for (const q of REAL) {
    const got = detectChat(q);
    if (got) fail(`detectChat swallowed ${JSON.stringify(q)} as ${got}`);
  }
  if (failures === before)
    console.log(`  ok    ${REAL.length} real questions fall through to the router`);
}

console.log("\nconversation is recognised as conversation:");
{
  const before = failures;
  const CHAT: [string, string][] = [
    ["hi", "greeting"],
    ["Hello", "greeting"],
    ["good morning", "greeting"],
    ["thanks", "thanks"],
    ["thank you", "thanks"],
    ["ok", "thanks"],
    ["what can you do?", "capabilities"],
    ["who are you", "capabilities"],
    ["help", "capabilities"],
    ["why?", "method"],
    ["how do you know that?", "method"],
    ["where does that come from?", "method"],
    ["tell me more", "more"],
    ["what else?", "more"],
    ["is that good?", "more"],
    ["what's the catch?", "more"],
    ["caveats", "more"],
  ];
  for (const [q, want] of CHAT) {
    const got = detectChat(q);
    if (got !== want)
      fail(`detectChat(${JSON.stringify(q)}) -> ${got ?? "null"}, expected ${want}`);
  }
  if (failures === before)
    console.log(`  ok    ${CHAT.length} conversational turns held out of the router`);
}

// ── 9b. "why?" and "tell me more" must not be the same answer ───────────────
// They are two different questions. "why?" is how the figure was built;
// "tell me more" is how far to trust it. Answering both with one paragraph
// makes the second turn a dead end, which is what it was until 2026-09-24.
// Every LIMITS entry is also asserted to hand off somewhere — a caveat that
// stops without a next question leaves the user holding a doubt and no move.
console.log('\n"why?" and "tell me more" say different things:');
{
  const before = failures;
  const answer = { text: "", source: "employsi vacancy archive · Perth" } as never;
  for (const intent of Object.keys(INTENT_QUESTION) as (keyof typeof INTENT_QUESTION)[]) {
    const why = chatReply("method", { answer, intent });
    const more = chatReply("more", { answer, intent });
    if (why === more) fail(`${intent}: "why?" and "tell me more" return the same text`);
    if (!more || more.length < 80) fail(`${intent}: "tell me more" has nothing to say`);
    // Not "ends with ?" — several of these close on the reason the suggestion
    // helps, which reads better than a bare question. What must be there is the
    // handoff itself, in the second half of the text so it is a way out rather
    // than an aside.
    const at = more.indexOf("Ask me");
    if (at < 0) fail(`${intent}: "tell me more" never says what to ask next`);
    else if (at < more.length * 0.4) {
      fail(`${intent}: the next question is buried at ${Math.round((at / more.length) * 100)}% in`);
    }
  }
  // With nothing on screen both still answer, and still differ.
  if (chatReply("method", null) === chatReply("more", null)) {
    fail("with no answer on screen the two replies are identical");
  }
  if (failures === before) {
    console.log(
      `  ok    ${Object.keys(INTENT_QUESTION).length} intents give distinct method and limits`,
    );
    console.log("  ok    ...every limit ends with a question the router answers");
  }
}

// ── 9c. A pay question must land on the pay shape it asked for ──────────────
// THE BUG: "which skills pay the most?" matched the `pay` rule and was answered
// with ONE median for the whole location. Correct arithmetic, wrong question,
// and indistinguishable from a right answer on screen. The rule ordering that
// fixes it is the only thing keeping the two apart, so both sides are asserted.
console.log("\npay questions split between the level and the ranking:");
{
  const before = failures;
  const RANKING = [
    "Which skills pay the most?",
    "which skill pays the most",
    "what pays the most",
    "what pays best in perth",
    "highest paying skills",
    "best paid skills here",
    "Which roles pay the biggest premium?",
    "which skills pay the most in mining",
    "lowest paying skills",
  ];
  for (const q of RANKING) {
    const got = detectIntent(q);
    if (got !== "payBySkill") fail(`${JSON.stringify(q)} -> ${got}, expected payBySkill`);
  }
  // ...and the questions about the LEVEL must not be dragged into the ranking.
  const LEVEL = [
    "What do these roles pay?",
    "How does pay compare against the wider market?",
    "what is the median salary",
    "what does nursing pay",
    "average wage here",
  ];
  for (const q of LEVEL) {
    const got = detectIntent(q);
    if (got !== "pay") fail(`${JSON.stringify(q)} -> ${got}, expected pay`);
  }
  // Neither may steal a question that is not about pay at all.
  for (const q of ["Which skills are most in demand?", "Which skills take longest to fill?"]) {
    const got = detectIntent(q);
    if (got === "pay" || got === "payBySkill") fail(`${JSON.stringify(q)} -> ${got}`);
  }
  if (failures === before) {
    console.log(`  ok    ${RANKING.length} ranking questions -> payBySkill`);
    console.log(
      `  ok    ${LEVEL.length} level questions -> pay, and neither steals a demand question`,
    );
  }
}

// ── 10. A sentence that names nothing must NOT re-answer ────────────────────
// THE BUG THIS EXISTS FOR, measured 2026-09-24: "no intent means follow-up"
// made every unrecognised sentence inherit the whole previous query and re-run
// it. Real figures, right sources, answering a question nobody asked again.
console.log("\nunrecognised sentences do not re-run the last query:");
{
  const before = failures;
  const first = resolveTurn("How is hiring trending?", null, PERTH, "perth");
  const EMPTY = [
    "tell me more",
    "which of those is biggest?",
    "show me that as a chart",
    "hmm",
    "the mining sector",
  ];
  for (const q of EMPTY) {
    const turn = resolveTurn(q, first.query, PERTH, "perth");
    if (turn.kind !== "empty") {
      fail(`${JSON.stringify(q)} -> kind ${turn.kind} (${turn.query.intent}), expected empty`);
    }
    if (turn.inherited.length) {
      fail(
        `${JSON.stringify(q)} inherited ${turn.inherited.join(",")} — an empty turn inherits nothing`,
      );
    }
  }
  // ...while a sentence that names something is still a pivot.
  for (const q of ["and Sydney?", "and for Nursing?", "across cities"]) {
    const turn = resolveTurn(q, first.query, PERTH, "perth");
    if (turn.kind !== "pivot") fail(`${JSON.stringify(q)} -> kind ${turn.kind}, expected pivot`);
  }
  if (failures === before)
    console.log("  ok    empty turns inherit nothing; naming a dimension still pivots");
}

// ── 11. Intent chips route to the intent they advertise ─────────────────────
// Same standard as the scope chips in section 8: a chip reading "Pay" that
// routes to volume produces a real answer to a question nobody asked.
console.log("\nintent follow-ups route to their own intent:");
{
  const before = failures;
  for (const [intent, question] of Object.entries(INTENT_QUESTION)) {
    const got = detectIntent(question);
    if (got !== intent) fail(`${JSON.stringify(question)} -> ${got}, filed under ${intent}`);
    if (detectScope(question, "perth"))
      fail(
        `${JSON.stringify(question)} names a place; a chip must inherit the scope it is asked in`,
      );
    if (detectSkillMatch(question))
      fail(`${JSON.stringify(question)} names a skill; a chip must not narrow the analysis`);
    if (!INTENT_LABEL[intent as keyof typeof INTENT_LABEL]) fail(`${intent} has no chip label`);
  }
  if (failures === before)
    console.log(
      `  ok    ${Object.keys(INTENT_QUESTION).length} intent chips round-trip, name no place and no skill`,
    );
}

// ── 12. A two-part question answers one half and offers the other ───────────
console.log("\ntwo-part questions offer the half they did not answer:");
{
  const before = failures;
  const turn = resolveTurn("How is nursing trending and what does it pay?", null, PERTH, "perth");
  if (!turn.alsoAsked) fail("a two-part question reported no second intent");
  if (turn.alsoAsked === turn.query.intent) fail("the second intent repeats the answered one");
  const chips = followUpsFor(turn.query, [], "perth", turn.alsoAsked);
  if (!chips.some((c) => turn.alsoAsked && c.question === INTENT_QUESTION[turn.alsoAsked])) {
    fail(
      `the unanswered half was not offered: ${chips.map((c) => c.label).join(", ") || "no chips"}`,
    );
  }
  // A single-intent question must not invent a second one.
  const single = resolveTurn("Which skills are most in demand?", null, PERTH, "perth");
  if (single.alsoAsked) fail(`a single question reported alsoAsked=${single.alsoAsked}`);
  if (failures === before)
    console.log("  ok    the unanswered half is offered, and single questions report none");
}

console.log(failures ? `\n${failures} failure(s).` : "\nAll analyst follow-up checks passed.");
process.exit(failures ? 1 : 0);
