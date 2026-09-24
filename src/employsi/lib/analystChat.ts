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

export type ChatIntent = "greeting" | "thanks" | "capabilities" | "method" | "more";

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
    re: /^(why|why is that|why though|how do you know( that)?|how (did|do) you (work that out|get that|know)|where (is|does) that (from|come from)|what('s| is) that based on|says who|source|sources|how was that measured|how is that measured|how (is|was) it measured)$/,
  },
  {
    kind: "more",
    re: /^(tell me more|more|more detail|more details|anything else|what else|go on|and|so what|explain|explain that|what do you mean|is (that|this) (good|bad|a lot|high|low)|is that reliable|how (reliable|confident) (is that|are you)|can i trust (that|it)|what('s| is) the catch|caveats?|limitations?)$/,
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
  // THE FIRST VERSION OF THIS SAID A ROLE ON TWO BOARDS COLLAPSES TO ONE ROW.
  // It does not. jobKey in jobArchive.ts puts the SOURCE first, so the same
  // role on SEEK and on Adzuna is two keys and two rows, and the answer is a
  // COUNT(*) over them. The claim came from CLAUDE.md, which said the same
  // thing and has been corrected. An explanation of method that has the method
  // backwards is worse than no explanation, so what it was hiding is now said
  // outright — here, and in LIMITS below where it belongs.
  volume:
    'I counted the ads themselves. Every vacancy the nightly crawl sees is a row in the archive, keyed on the board it came from plus the title, employer and location, so re-seeing the same ad tomorrow updates that row rather than adding another. "Open" means an ad the crawl still saw on the last day every feed had reported — not today, because today is still being collected and would read as a fall.',
  skills:
    "I read the skills out of the ad titles with the same matcher the rest of employsi uses, so a role maps the same way wherever it enters. The ranking is a count of live ads naming each skill, not a weighting or a score — if a skill is second, more employers wrote it down.",
  pay: 'Only from ads that actually state a salary. The archive stores whatever each board printed, which is a monthly range on one board and a banded string on another, so each is parsed to an annual figure tagged with its currency and anything unparseable is dropped rather than guessed at. I quote a median only when one currency dominates the sample, and I tell you how many of the live ads disclosed pay — usually a minority, because most boards publish "competitive" instead of a number.',
  duration:
    "From ads that have come DOWN, measured from the ad's own posted date to the day it stopped appearing. It needs at least 40 such ads before I'll quote a figure, and some boards — Indeed and the state government sites — publish no posted date at all, so a scope leaning on those stays thin. Read it as how long a vacancy stays advertised, not as time to fill: employsi sees ads, not hires, so an ad disappearing might mean filled, expired or withdrawn and I can't tell those apart.",
  history:
    "That one isn't from the ad archive at all — it's the national vacancy series, published monthly by the statistical agencies (Jobs and Skills Australia, StatCan, MRSD, MBIE, ONS, Eurostat, BLS). The archive only runs back to the day collection started, so asking it how a market has moved since 2019 would produce a confident answer about nothing. Anything long-run comes from the official series and anything about what is open right now comes from the archive, and I route on that rather than stretching either.",
};

/**
 * What each figure CANNOT tell you, and the question worth asking next.
 *
 * This is "tell me more", and it is deliberately not a longer version of the
 * method. Someone who has read how a number was built and asks for more is
 * asking how far to trust it — so this says what the measurement is blind to,
 * in the terms of the actual implementation, and then points at the next
 * question rather than trailing off.
 *
 * THE VOLUME ONE IS THE REASON THIS EXISTS IN THIS FORM. A count of live ads
 * double-counts a role advertised on two boards, because the source is part of
 * the key. That is a real limit of every volume figure this analyst gives, it
 * was written down nowhere the user could see it, and the explanation that
 * should have carried it said the opposite. Stating a limit plainly is the
 * cheapest honesty available; hiding it inside a method paragraph is not.
 *
 * Each entry ends with a question the router actually answers, so "tell me
 * more" always leaves somewhere to go.
 */
const LIMITS: Record<DataIntent, string> = {
  volume:
    "What it can't tell you: how many JOBS there are. One role advertised on two boards is two rows here, because the board is part of what makes an ad distinct, so a market whose employers post everywhere reads higher than one that posts once. It also only covers employers employsi crawls, and an ad staying up is not proof the job is still unfilled. Treat it as advertising activity, which is what it measures, and lean on the direction more than the level. Ask me which skills those ads name, or the same question about another city — the double-counting is roughly consistent between places, so comparisons hold up better than the raw number.",
  skills:
    "What it can't tell you: how hard a skill is to hire. The ranking counts ads that NAME the skill in their title, so a skill an employer wants but writes in the body instead is invisible to it, and a common word beats a rare and valuable one every time. A speciality is folded into the skill it narrows, so the rank you see is the family. Ask me how long ads naming those skills stay up — that gets closer to which ones employers struggle to fill.",
  pay: 'What it can\'t tell you: what people are paid. It is advertised pay, from the minority of ads that state any, and that minority is not a random sample — public-sector and award-covered roles publish bands as a matter of course while senior private roles publish "competitive", so a median over what is disclosed sits low against the real market. Whether a figure is base or package depends on who wrote the ad. Ask me how it compares against the wider market, which reads the same skew on both sides and so cancels most of it.',
  duration:
    "What it can't tell you: time to fill. It measures how long an ad stayed up, and an ad coming down might mean filled, expired, withdrawn or re-posted under a new title — employsi sees ads, not hires, and cannot tell those apart. It only sees runs that have FINISHED, so a long-running vacancy that is still open is not in the figure at all, which biases it short. Boards that publish no posted date drop out entirely. Ask me which skills are most in demand, and read the two together.",
  history:
    "What it can't tell you: anything about one employer. The national series is published per occupation and per area, so there is no company in it, and the agencies revise recent months as more returns come in. It is also a different dataset from every other answer here — official monthly counts against ads employsi crawled — so the two are not comparable figures and I do not subtract one from the other. Ask me what is open right now for the same place, and read them as two independent readings rather than one series.",
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

    case "more": {
      const intent = last?.intent;
      if (!intent || intent === "unknown" || !last?.answer) {
        return "There's nothing on screen to go deeper on yet. Ask me how many roles are open somewhere, what they pay, or which skills employers want, and I'll tell you both how the figure was built and what it can't tell you.";
      }
      return LIMITS[intent];
    }

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
