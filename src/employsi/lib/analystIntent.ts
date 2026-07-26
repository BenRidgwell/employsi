import { ALL_SKILLS } from "../data/skillsTaxonomy";

/**
 * Question classification for "Ask an analyst", shared by the client pane and
 * the server-side archive query so the two can never disagree about what a
 * question was asking.
 *
 * The design's mock matches on keyword lists (ANSWERS[].match) and that is kept
 * — this is a deterministic router over real datasets, not a language model, so
 * a transparent rule the user can predict is the right mechanism.
 */

export type AnalystIntent =
  | "history" // long-run official statistics
  | "pay"
  | "skills"
  | "competition"
  | "volume"
  | "unknown";

// Ordered most-specific first: "what do these skills pay" must land on pay, and
// "how has demand changed since 2019" on history rather than volume.
const RULES: { intent: AnalystIntent; match: string[] }[] = [
  {
    intent: "history",
    match: [
      "history",
      "historical",
      "over time",
      "long run",
      "long-run",
      "since 2",
      "last decade",
      "ten years",
      "5 year",
      "five year",
      "year on year",
      "year-on-year",
      "yoy",
      "peak",
      "pre-covid",
      "before covid",
      "recover",
    ],
  },
  { intent: "pay", match: ["salary", "salaries", "pay", "paid", "compensation", "wage", "$"] },
  {
    intent: "competition",
    match: ["compet", "applicant", "how hard", "candidate", "contested", "crowded", "fill rate"],
  },
  {
    intent: "skills",
    match: ["skill", "capabilit", "hiring for", "what are they hiring", "occupation"],
  },
  {
    intent: "volume",
    match: [
      "hiring",
      "vacanc",
      "open role",
      "opening",
      "demand",
      "trend",
      "how many",
      "growth",
      "grow",
    ],
  },
];

export function detectIntent(question: string): AnalystIntent {
  const lower = (question || "").toLowerCase();
  return RULES.find((r) => r.match.some((m) => lower.includes(m)))?.intent ?? "unknown";
}

/**
 * The canonical skill a question is about, if any.
 *
 * Matching is exact containment of a taxonomy name, longest first, so
 * "education leadership" isn't swallowed by "education". Returns null when the
 * question is about a market rather than a skill; the caller then answers at
 * market level instead of picking one.
 *
 * The obvious next step — falling back to describeSkills(), the fuzzy mapper
 * behind the search box — is deliberately NOT taken. It is built to turn a
 * short query into candidate skills, so fed a whole sentence it finds a match
 * in almost anything: "which skills are most in demand?" came back as
 * "Teaching & Education", which would have answered a market-wide question with
 * one arbitrary skill's history. A question that doesn't name a skill should
 * fall through to the market-level answer, not to a lucky guess.
 */
export function detectSkill(question: string): string | null {
  const lower = (question || "").toLowerCase().trim();
  if (!lower) return null;
  let best: string | null = null;
  for (const s of ALL_SKILLS) {
    if (lower.includes(s.toLowerCase()) && (!best || s.length > best.length)) best = s;
  }
  return best;
}

// The design's four suggested prompts, rewritten to match what this analyst can
// actually answer — a suggestion that leads to "I can't tell you that" is worse
// than no suggestion.
export const SUGGESTED_PROMPTS = [
  "How is hiring trending?",
  "What do these roles pay?",
  "Which skills are most in demand?",
  "How has demand changed since 2019?",
];
