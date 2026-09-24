import type { AnalystAnswer } from "./analystFn";
import type { AnalystIntent, DataIntent } from "./analystIntent";

/**
 * The turns that are conversation rather than questions — a greeting, a thank
 * you, "what can you do?", "why?".
 *
 * WHY THIS EXISTS AS A HELD-OUT LAYER RATHER THAN MORE ROUTER RULES. The
 * follow-up mechanism in analystTurn.ts reads a sentence without an intent as a
 * PATCH on the previous question, which is what makes "and Sydney?" work. Run
 * "thanks" through it and the same rule inherits intent, skill and scope and
 * silently re-runs the last analysis: measured 2026-09-24, "hi", "thanks",
 * "why?", "is that good?", "tell me more" and "ok" each re-answered a nursing
 * vacancy question nobody had re-asked. Every figure was real and none of them
 * was an answer to what was typed, which is the failure this codebase treats as
 * worse than saying nothing.
 *
 * So these are matched BEFORE the patch logic and never reach it. A chat turn
 * also leaves the carried query untouched — saying thanks must not move the
 * conversation, and "why?" is a question about the last answer, not a new one.
 *
 * MATCHING IS ANCHORED ON THE WHOLE SENTENCE, always. "hi" is inside "which",
 * "this" and "hiring"; "ta" is inside "data". A substring test here would eat
 * real questions, so every pattern below is ^…$ over the trimmed, depunctuated
 * sentence, and anything longer than a few words is by definition not one of
 * these.
 */

export type ChatIntent = "greeting" | "thanks" | "capabilities" | "method";

const PATTERNS: { kind: ChatIntent; re: RegExp }[] = [
  {
    kind: "greeting",
    re: /^(hi|hey|hello|yo|hiya|howdy|good (morning|afternoon|evening)|g'day|gday)( there| analyst)?$/,
  },
  {
    kind: "thanks",
    re: /^(thanks|thank you|thanks a lot|thanks so much|ty|cheers|ta|nice|great|perfect|lovely|brilliant|awesome|cool|ok|okay|got it|understood|makes sense|good stuff)( then| thanks)?$/,
  },
  {
    kind: "capabilities",
    re: /^(help|what can you (do|answer|tell me)|what do you (do|know)|who are you|what are you|what should i ask|what questions can i ask|how (do|does) (this|it) work|what is this)$/,
  },
  {
    kind: "method",
    re: /^(why|why is that|why though|how do you know( that)?|how (did|do) you (work that out|get that|know)|where (is|does) that (from|come from)|what('s| is) that based on|says who|source|sources|tell me more|more detail|explain|explain that|what do you mean|how was that measured|how is that measured|is that good|is that a lot|is that reliable|how confident are you)$/,
  },
];

/**
 * The chat turn a sentence is, or null when it is a real question.
 *
 * Punctuation and case are stripped first so "Why?" and "why" are one pattern
 * rather than two, but nothing else is normalised — a sentence that has to be
 * rewritten to match is a sentence that should fall through to the router.
 */
export function detectChat(question: string): ChatIntent | null {
  const s = question
    .toLowerCase()
    .replace(/[!?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.split(" ").length > 7) return null;
  for (const p of PATTERNS) if (p.re.test(s)) return p.kind;
  return null;
}

/**
 * How each kind of figure is arrived at, in the words of the code that arrives
 * at it.
 *
 * These are the answer to "why?", and they are worth more than a generic line
 * about the archive because each intent is computed a genuinely different way —
 * two of them do not even read the same dataset. Every claim here is one the
 * code makes: the 40-ad floor is MIN_DURATION_ADS, the currency rule is in
 * parsePay, the completed-day rule is coverageDay, and the split between the
 * archive and the national series is the routing in analystAnswer.ts.
 *
 * KEEP THESE HONEST ABOUT WHAT THEY CANNOT SEE. The duration one says employsi
 * watches ads rather than hires because that distinction is the whole caveat,
 * and an explanation that drops it is worse than no explanation — the user came
 * here asking how far to trust the number.
 */
const METHOD: Record<DataIntent, string> = {
  volume:
    'I counted the ads themselves. Every vacancy the nightly crawl has seen is one row in the archive, keyed on source, title, employer and location, so the same role on two boards collapses to one row rather than counting twice. "Open" means an ad the crawl still saw on the last day every feed had reported — not today, because today is still being collected and would read as a fall.',
  skills:
    "I read the skills out of the ad titles with the same matcher the rest of employsi uses, so a role maps the same way wherever it enters. The ranking is a count of live ads naming each skill, not a weighting or a score — if a skill is second, more employers wrote it down.",
  pay: 'Only from ads that actually state a salary. The archive stores whatever each board printed, which is a monthly range on one board and a banded string on another, so each is parsed to an annual figure tagged with its currency and anything unparseable is dropped rather than guessed at. I quote a median only when one currency dominates the sample, and I tell you how many of the live ads disclosed pay — usually a minority, because most boards publish "competitive" instead of a number.',
  duration:
    "From ads that have come DOWN, measured from the ad's own posted date to the day it stopped appearing. It needs at least 40 such ads before I'll quote a figure, and some boards — Indeed and the state government sites — publish no posted date at all, so a scope leaning on those stays thin. Read it as how long a vacancy stays advertised, not as time to fill: employsi sees ads, not hires, so an ad disappearing might mean filled, expired or withdrawn and I can't tell those apart.",
  history:
    "That one isn't from the ad archive at all — it's the national vacancy series, published monthly by the statistical agencies (Jobs and Skills Australia, StatCan, MRSD, MBIE, ONS, Eurostat, BLS). The archive only runs back to the day collection started, so asking it how a market has moved since 2019 would produce a confident answer about nothing. Anything long-run comes from the official series and anything about what is open right now comes from the archive, and I route on that rather than stretching either.",
};

/**
 * WHY "WHY?" IS ANSWERED FROM THE LAST ANSWER RATHER THAN RE-QUERIED. It is a
 * question about a figure already on screen. Running the archive again could
 * return a different number — the crawl lands between turns — and explaining
 * one number while displaying another is the exact shape of bug this pane is
 * built to avoid.
 */
export function chatReply(
  kind: ChatIntent,
  last?: { answer?: AnalystAnswer; intent?: AnalystIntent } | null,
): string {
  switch (kind) {
    case "greeting":
      return "Hello. I read employsi's vacancy archive — ask me how many roles are open somewhere, which way demand is moving, what the ads disclose about pay, or which skills employers are asking for. Name a city, country or company and I'll answer about that one.";

    case "thanks":
      return last?.answer
        ? "Any time. Ask a follow-up if you want it cut another way — naming just a place moves the same question there."
        : "Any time. Ask away whenever you're ready.";

    case "capabilities":
      return "Five things, all of them queries over real rows. How many vacancies are open in a place or at a company, and which way that is moving. Which skills employers are asking for. What the ads disclose about pay, where enough of them disclose anything. How long ads stay up. And how a market has moved over years, which comes from the national statistical series rather than the ad archive. Ask \"why?\" after any answer and I'll tell you how it was measured. I can't tell you about applicants, fill rates or how contested a market is — employsi sees ads, not hires.";

    case "method": {
      const intent = last?.intent;
      if (!intent || intent === "unknown" || !last?.answer) {
        return "Nothing to explain yet — ask me something first and I'll tell you exactly how the figure was arrived at.";
      }
      const how = METHOD[intent];
      // The source line is already computed and already on screen under the
      // answer; repeating it here puts the window and the row count in the
      // sentence that explains them rather than a caption away from it.
      return last.answer.source ? `${how}\n\nFor that answer: ${last.answer.source}.` : how;
    }
  }
}
