/**
 * The conversational analyst's figure check (untraced in analystLlmFn.ts).
 *
 * It is the one thing standing between a language model's made-up number and
 * the screen, and it fails silently in both directions: too strict and every
 * reply is swapped for the plain data answer, too loose and an invented figure
 * is shown under employsi's name. Neither would be visible in the app, so the
 * cases are asserted here.
 */
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
