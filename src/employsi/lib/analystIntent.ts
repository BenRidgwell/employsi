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
  // This block used to have to sit ABOVE a "competition" rule that owned "how
  // hard" and "fill rate", because "time to fill" and "hardest to fill" are
  // duration questions and were otherwise swallowed by it. That rule is gone
  // (2026-08-06), so the conflict is gone with it — kept in place because the
  // order is still correct, not because it is still load-bearing.
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

// Questions the archive CANNOT answer, held out before the rules run.
//
// Removing the "competition" intent was not enough on its own. "How many
// applicants per role?" then matched the volume rule on "how many" and would
// have been answered with a count of open roles — an applicant question given a
// vacancy number, which is worse than declining it, because it looks like an
// answer. Anything asking about applicants, fill rates or how contested a market
// is now resolves to "unknown" and gets the fallback, which says what the
// archive does hold.
//
// Note "hard to fill" and its variants are NOT here: those are duration
// questions the archive genuinely answers from how long ads stay up.
const NOT_HELD = ["applicant", "fill rate", "compet", "contested", "crowded", "how hard"];

export function detectIntent(question: string): AnalystIntent {
  const lower = (question || "").toLowerCase();
  if (NOT_HELD.some((m) => lower.includes(m))) return "unknown";
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
 * The prompt row's three topics, each opening a menu of three questions.
 *
 * From the design, which groups the questions rather than laying them flat.
 * Every question here was run through detectIntent before being listed — all
 * nine classify to a real intent, none to "unknown", so no menu entry can lead
 * to "I didn't understand that". Adding one means checking the same thing.
 *
 * A fourth topic, "Competition", was removed on request 2026-08-06, and so was
 * the intent behind it — the router no longer classifies or answers those
 * questions at all, and they now fall to "unknown" like anything else outside
 * what the archive holds.
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
