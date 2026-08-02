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
  | "duration" // how long ads stay up, by skill
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
  // Before competition, which owns "how hard" and "fill rate": "time to fill"
  // and "hardest to fill" are duration questions and would otherwise be
  // swallowed by the funnel-data answer that has to decline them.
  {
    intent: "duration",
    match: [
      "time to fill",
      "time-to-fill",
      "hard to fill",
      "hardest to fill",
      "longest to fill",
      "take longest",
      "takes longest",
      "slow to fill",
      "quick to fill",
      "how long",
      "days to fill",
      "stay open",
      "stay up",
      "linger",
      "sit unfilled",
      "unfilled",
      "vacancy duration",
      "advertis",
    ],
  },
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
//
// The last three exist to reach the chart shapes added from
// `Analyst_Chart_Outputs`, because a chart nobody can find is not a feature:
//
//   • "…against the wider market" and any named skill → the indexed pair (1a)
//   • "…across cities" → the per-area small multiples (1d)
//   • "Which categories are growing…" → the growth scatter (1c)
//
// They are worded as the router actually matches them (see RULES above and
// `wantsAreas` in analystAnswer.ts) so clicking one is guaranteed to land on
// the shape it advertises. The two that name a skill name SOFTWARE ENGINEERING
// and NURSING specifically: detectSkill needs an exact taxonomy name, and those
// two are published in all 56 covered areas, so neither prompt can land on a
// scope that has no series for it.
/**
 * The prompt row's four topics, each opening a menu of three questions.
 *
 * From the design, which groups the questions rather than laying eight of them
 * flat. Every question here was run through detectIntent before being listed —
 * all twelve classify to a real intent, none to "unknown", so no menu entry can
 * lead to "I didn't understand that". Adding one means checking the same thing.
 */
export const PROMPT_TOPICS: { label: string; questions: string[] }[] = [
  {
    label: "Hiring trend",
    questions: [
      "How is hiring trending?",
      "How has demand changed since 2019?",
      "Which categories are growing fastest over five years?",
    ],
  },
  {
    label: "Pay",
    questions: [
      "What do these roles pay?",
      "How does pay compare against the wider market?",
      "Which roles pay the biggest premium?",
    ],
  },
  {
    label: "Top skills",
    questions: [
      "Which skills are rising fastest?",
      "Which skills are most in demand?",
      "Which skills take longest to fill?",
    ],
  },
  {
    label: "Competition",
    questions: [
      "How competitive is it for candidates?",
      "How many applicants per role?",
      "How does Nursing demand compare across cities?",
    ],
  },
];

/**
 * The flat list PROMPT_TOPICS replaced. Retained only as the canonical set of
 * questions this router is known to answer — it is what new topic entries are
 * checked against, and it has no UI reading it.
 */
export const SUGGESTED_PROMPTS = [
  "How is hiring trending?",
  "What do these roles pay?",
  "Which skills are most in demand?",
  "Which skills take longest to fill?",
  "How has demand changed since 2019?",
  "Which categories are growing fastest over five years?",
  "How does Nursing demand compare across cities?",
  "Show Software Engineering demand against the wider market",
];
