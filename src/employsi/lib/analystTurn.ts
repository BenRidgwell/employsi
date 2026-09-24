import type { AnalystIntent } from "./analystIntent";
import {
  detectIntent,
  detectIntents,
  detectSkillMatch,
  INTENT_LABEL,
  INTENT_QUESTION,
  type DataIntent,
} from "./analystIntent";
import { detectScope, type ResolvedScope } from "./analystScope";

/**
 * Carrying an analysis between turns, so "what about Sydney?" means something.
 *
 * THE WHOLE MECHANISM IS ONE RULE: a turn is a PATCH, not a question. Each
 * sentence is read for what it explicitly names, and everything it does not
 * name is inherited from the turn before. "What about Sydney?" names a scope and
 * nothing else, so it re-asks the previous question about a new place. That one
 * rule covers every pivot the feature needs — skill, company, city, country —
 * without a special case per dimension.
 *
 * WHY A NEW QUESTION MUST NOT INHERIT A SKILL. The tempting version of this
 * inherits every unnamed field always, and it is wrong in a way that is hard to
 * spot. Ask "how does Software Engineering pay?", then ask "which skills are
 * most in demand?" — a market-wide question. Inheriting the skill silently
 * narrows it back to Software Engineering and answers a question about one
 * skill as though it were about all of them.
 *
 * So the two cases are told apart by whether the sentence carries its own
 * INTENT. A sentence with an intent is a new question and starts fresh on skill;
 * a sentence without one is a pivot and keeps what came before. Scope is the
 * exception and inherits in both cases, because "which skills are most in
 * demand?" asked while looking at Perth is still about Perth.
 */

export interface AnalystQuery {
  intent: AnalystIntent;
  skill: string | null;
  /**
   * The speciality the question named, when it named one instead of the broad
   * skill in `skill`. Carried so the ANSWER can say it analysed the skill the
   * speciality narrows — see detectSkillMatch. Inherited with `skill`, never
   * apart from it, or a pivot would keep a "via" from a question two turns ago.
   */
  skillVia: string | null;
  scope: ResolvedScope;
  wantsAreas: boolean;
}

export interface TurnResult {
  query: AnalystQuery;
  /**
   * Which fields came from the previous turn rather than this sentence.
   *
   * The pane shows these. That is not decoration: analystIntent.ts states the
   * design principle this feature is built on — "a transparent rule the user can
   * predict is the right mechanism" — and carried state is, by its nature, the
   * opposite. Naming what was inherited is what keeps it predictable.
   */
  inherited: ("intent" | "skill" | "scope")[];
  /** True when the sentence carried its own intent, i.e. started a new thread. */
  isNewQuestion: boolean;
  /**
   * What kind of turn this is, and the reason the third one exists.
   *
   * A patch has to patch SOMETHING. The original rule was "no intent means
   * follow-up", which made every unrecognised sentence inherit the whole
   * previous query and re-run it: "tell me more", "which of those is biggest?",
   * "is that good?" and "ok" all silently re-answered the last question with
   * real figures about something nobody had asked again. Measured 2026-09-24.
   *
   * So a follow-up now has to NAME a dimension — a place, a skill, or an area
   * split. A sentence that names nothing and carries no intent is "empty": it
   * was not understood, and the honest response is to say so rather than to
   * serve the previous answer twice. Greetings and "why?" never get this far;
   * analystChat.ts holds them out before this runs.
   */
  kind: "question" | "pivot" | "empty";
  /**
   * A second intent the sentence also asked for, answered by offering it rather
   * than by welding two differently-measured halves into one paragraph. See
   * detectIntents.
   */
  alsoAsked: DataIntent | null;
}

/**
 * "…across cities", "…by region", "where is it strongest" — the same subject
 * split by area rather than read against the market. Lifted verbatim from
 * analystAnswer.ts so the two cannot drift; see the note there.
 */
export function wantsAreas(question: string): boolean {
  return /\b(across|compare|between|by (city|cities|region|state)|where)\b/i.test(question);
}

export function resolveTurn(
  question: string,
  prev: AnalystQuery | null,
  fallbackScope: ResolvedScope,
  localCity?: string,
): TurnResult {
  const explicitIntent = detectIntent(question);
  const explicitMatch = detectSkillMatch(question);
  const explicitSkill = explicitMatch?.skill ?? null;
  const explicitScope = detectScope(question, localCity);
  const isNewQuestion = explicitIntent !== "unknown";
  const inherited: TurnResult["inherited"] = [];
  const splitsByArea = wantsAreas(question);

  // A patch with nothing to patch is not a follow-up — see TurnResult.kind.
  // Asked with no previous turn it is simply an unrecognised question, which
  // reaches the same place: the fallback, rather than a fabricated subject.
  const namesSomething = !!explicitScope || !!explicitSkill || splitsByArea;
  const kind: TurnResult["kind"] = isNewQuestion
    ? "question"
    : prev && namesSomething
      ? "pivot"
      : "empty";

  // Intent: a sentence without one keeps the question it is following up on.
  // Only a pivot does — an empty turn inherits nothing, because the answer it
  // would produce is one nobody asked for.
  let intent = explicitIntent;
  if (kind === "pivot" && prev) {
    intent = prev.intent;
    inherited.push("intent");
  }

  // Skill: inherited only by a pivot, for the reason in the header.
  let skill = explicitSkill;
  let skillVia = explicitMatch?.via ?? null;
  if (!explicitSkill && kind === "pivot" && prev?.skill) {
    skill = prev.skill;
    skillVia = prev.skillVia;
    inherited.push("skill");
  }

  // Scope: the sentence wins over everything, which is the decision taken for
  // this feature — naming a place moves the analysis AND the chip. Otherwise it
  // stays where the analysis already was, and only falls back to the chip row on
  // the first turn.
  let scope = explicitScope;
  if (!scope) {
    scope = prev?.scope ?? fallbackScope;
    // An empty turn produces no answer, so it carried nothing INTO one. The
    // field still has to hold a scope to satisfy the type, and the caller
    // discards the whole query, but recording it as inherited would have this
    // turn claim a provenance it never used.
    if (prev && kind !== "empty") inherited.push("scope");
  }

  const asked = detectIntents(question);
  return {
    query: {
      intent,
      skill,
      skillVia,
      scope,
      // An area split is a property of how THIS sentence was phrased, so it is
      // never inherited: "across cities" then "what about pay?" is a question
      // about pay in the current scope, not a per-city pay breakdown nobody
      // asked for.
      wantsAreas: splitsByArea,
    },
    inherited,
    isNewQuestion,
    kind,
    alsoAsked: asked.find((i) => i !== intent) ?? null,
  };
}

export interface FollowUp {
  /** What the chip reads. */
  label: string;
  /** The sentence it asks — a real question, put through the same router. */
  question: string;
}

/**
 * Follow-ups worth offering after an answer, so the capability is discoverable.
 *
 * Nobody guesses that a deterministic router takes "what about Sydney?". The
 * design already solves the same problem for opening questions — PROMPT_TOPICS
 * exists because a question the analyst cannot answer is worse than no
 * suggestion — and these are that idea applied to the second turn.
 *
 * EVERY SUGGESTION IS ROUND-TRIPPED BEFORE IT IS OFFERED. A chip that reads
 * "Australia" but resolves somewhere else is worse than no chip, and that is a
 * real case rather than a hypothetical: the region chip and the country are both
 * labelled "Australia", and detectScope resolves the sentence to the COUNTRY,
 * because country is the more specific kind. So a suggestion is only returned
 * when asking its own question lands on the scope it claims — anything that does
 * not round-trip is dropped rather than shown and quietly disobeyed.
 */
export function followUpsFor(
  current: AnalystQuery,
  alternatives: ResolvedScope[],
  localCity?: string,
  /**
   * A second intent the sentence asked for. Offered FIRST when present, because
   * it is the half of their own question that has not been answered yet — every
   * other chip here is a suggestion, and that one is a debt.
   */
  alsoAsked?: DataIntent | null,
): FollowUp[] {
  const out: FollowUp[] = [];

  /**
   * Ask the same subject a different way. These are what makes the pane feel
   * like a conversation rather than a search box — the scope chips move the
   * question sideways, and these move it to the next thing you would want to
   * know about the place you are already looking at.
   *
   * Round-tripped through detectIntent exactly as the scope chips are round-
   * tripped through detectScope: a chip that says "Pay" and routes to volume is
   * the same bug as a chip that says "Australia" and lands on the region.
   */
  const intents: DataIntent[] = [];
  if (alsoAsked && alsoAsked !== current.intent) intents.push(alsoAsked);
  // A short ladder rather than all four: the interesting next question after a
  // count is what they pay, after pay which skills, and so on. Offering every
  // intent every time turns the row into a menu and buries the scope pivots.
  const NEXT: Record<AnalystIntent, DataIntent[]> = {
    volume: ["pay", "skills"],
    // After a demand ranking the question is which of those skills pays, which
    // is the per-skill split rather than the scope median.
    skills: ["payBySkill", "duration"],
    // And after the scope median, which skills carry the premium over it.
    pay: ["payBySkill", "skills"],
    payBySkill: ["pay", "skills"],
    duration: ["skills", "payBySkill"],
    history: ["volume", "skills"],
    unknown: [],
  };
  for (const i of NEXT[current.intent] ?? []) {
    if (i !== current.intent && !intents.includes(i)) intents.push(i);
  }
  for (const i of intents.slice(0, 2)) {
    const question = INTENT_QUESTION[i];
    if (detectIntent(question) !== i) continue;
    out.push({ label: INTENT_LABEL[i], question });
  }

  for (const alt of alternatives) {
    if (alt.kind === current.scope.kind && alt.id === current.scope.id) continue;
    const question = `What about ${alt.label}?`;
    const landed = detectScope(question, localCity);
    if (!landed || landed.kind !== alt.kind || landed.id !== alt.id) continue;
    out.push({ label: alt.label, question });
  }

  // The area split, but only where there is a subject to split and it is not
  // already what is on screen.
  if (current.skill && !current.wantsAreas) {
    out.push({
      label: "Across cities",
      question: `How does ${current.skill} compare across cities?`,
    });
  }

  return out.slice(0, 5);
}

/**
 * A short, human description of what the analyst is about to answer, for the
 * pane to show above an answer that inherited anything.
 *
 * Only rendered when something WAS inherited — labelling every answer with its
 * own scope would be noise, but an answer that quietly changed subject needs to
 * say so.
 */
export function describeQuery(q: AnalystQuery): string {
  // The speciality is named in the chip too. The user typed "midwifery" and
  // the analysis is of Nursing; a chip reading only "Nursing" looks like the
  // word was ignored.
  const subject = q.skill && q.skillVia ? `${q.skill} · via ${q.skillVia}` : q.skill;
  return [subject, q.scope.label].filter(Boolean).join(" · ");
}
