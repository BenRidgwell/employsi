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
import { detectScope } from "../src/employsi/lib/analystScope";

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

console.log(failures ? `\n${failures} failure(s).` : "\nAll analyst follow-up checks passed.");
process.exit(failures ? 1 : 0);
