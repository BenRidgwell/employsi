/**
 * The conversational analyst's figure check (untraced in analystLlmFn.ts).
 *
 * It is the one thing standing between a language model's made-up number and
 * the screen, and it fails silently in both directions: too strict and every
 * reply is swapped for the plain data answer, too loose and an invented figure
 * is shown under employsi's name. Neither would be visible in the app, so the
 * cases are asserted here.
 */
import { readFileSync } from "node:fs";
import { untraced } from "../src/employsi/lib/analystLlmFn";

const TOOL =
  "Answer: 1,234 live roles in Perth, up 6.4% on the week before. " +
  "Figures: Median pay = $140K; Live roles = 1,234 (+6.4%); Disclosed = 312 of 1,234 ads";

const CASES: { reply: string; passes: boolean; why: string }[] = [
  { reply: "There are 1,234 live roles in Perth, up 6.4%.", passes: true, why: "exact figures" },
  {
    reply: "About 1,234 roles, up roughly 6%.",
    passes: true,
    why: "a tool figure rounded to a whole",
  },
  {
    reply: "The median is $140K, or $140,000.",
    passes: true,
    why: "K and full forms of one value",
  },
  { reply: "312 of the ads disclosed pay.", passes: true, why: "a count the tool printed" },
  { reply: "Since 2019, the top 5 skills shifted.", passes: true, why: "years and single digits" },
  {
    reply: "There are about 1,300 roles.",
    passes: false,
    why: "a rounded figure the tool never gave",
  },
  { reply: "Pay is around $150K.", passes: false, why: "an invented salary" },
  {
    reply: "Roughly 45% of ads disclose pay.",
    passes: false,
    why: "a derived share the tool never gave",
  },
];

let failed = 0;
for (const c of CASES) {
  const bad = untraced(c.reply, [TOOL]);
  if ((bad.length === 0) !== c.passes) {
    failed++;
    console.error(`✗ ${c.why}: "${c.reply}" — untraced ${JSON.stringify(bad)}`);
  }
}
if (failed) {
  console.error(`\n${failed} figure-check case(s) failed.`);
  process.exit(1);
}
console.log(`✓ analyst figure check: ${CASES.length} cases hold.`);
// ── the visitor key is keyed, not merely hashed ──────────────────────────────
// llm_usage holds one row per visitor per day, and the visitor column used to be
// SHA-256 of a FIXED PUBLIC PREFIX plus the IP. An IP address is drawn from a
// space of 4.3 billion, so that is not concealment: anyone with the table could
// scan the space and recover every address in it. A hash only hides an input it
// cannot enumerate, which is why the secret has to do the work.
//
// Asserted against the SOURCE because visitorKey needs a request and a Worker
// env to run, and the property worth protecting is structural: an HMAC under a
// secret, the day inside the signed message, and no reintroduced bare digest.
{
  const src = readFileSync("src/employsi/lib/analystLlmFn.ts", "utf8");
  const vk = src.slice(src.indexOf("async function visitorKey"));
  const body = vk.slice(0, vk.indexOf("\n}\n") + 2);
  const bad: string[] = [];
  if (!/crypto\.subtle\.sign\(\s*"HMAC"/.test(body)) bad.push("visitorKey does not HMAC");
  if (!/importKey\([\s\S]*?"HMAC"/.test(body)) bad.push("no HMAC key is imported");
  if (/crypto\.subtle\.digest/.test(body))
    bad.push("visitorKey still calls crypto.subtle.digest — the bare-hash bug is back");
  if (!/LLM_VISITOR_SALT/.test(body)) bad.push("no LLM_VISITOR_SALT secret is read");
  if (!/\bllm\|\$\{day\}\|\$\{ip\}/.test(body))
    bad.push("the day is not inside the signed message, so keys link across dates");
  if (!/return "shared"/.test(body))
    bad.push("no shared-bucket fallback — a missing secret must not produce a weak key");
  // The fallback must come BEFORE any signing, or a missing salt would be signed
  // as the empty key rather than skipped.
  const iShared = body.indexOf('return "shared"');
  const iSign = body.indexOf("crypto.subtle.sign");
  if (iShared > 0 && iSign > 0 && iShared > iSign)
    bad.push("the shared-bucket fallback sits after signing");
  if (bad.length) {
    for (const b of bad) console.error(`✗ visitor key: ${b}`);
    process.exit(1);
  }
  console.log("✓ visitor key: HMAC under a Worker secret, day-scoped, safe fallback.");
}
