import type { AnalystIntent } from "./analystIntent";
import { detectIntent, detectSkill } from "./analystIntent";
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
  const explicitSkill = detectSkill(question);
  const explicitScope = detectScope(question, localCity);
  const isNewQuestion = explicitIntent !== "unknown";
  const inherited: TurnResult["inherited"] = [];

  // Intent: a sentence without one keeps the question it is following up on.
  let intent = explicitIntent;
  if (!isNewQuestion && prev) {
    intent = prev.intent;
    inherited.push("intent");
  }

  // Skill: inherited only by a pivot, for the reason in the header.
  let skill = explicitSkill;
  if (!explicitSkill && !isNewQuestion && prev?.skill) {
    skill = prev.skill;
    inherited.push("skill");
  }

  // Scope: the sentence wins over everything, which is the decision taken for
  // this feature — naming a place moves the analysis AND the chip. Otherwise it
  // stays where the analysis already was, and only falls back to the chip row on
  // the first turn.
  let scope = explicitScope;
  if (!scope) {
    scope = prev?.scope ?? fallbackScope;
    if (prev) inherited.push("scope");
  }

  return {
    query: {
      intent,
      skill,
      scope,
      // An area split is a property of how THIS sentence was phrased, so it is
      // never inherited: "across cities" then "what about pay?" is a question
      // about pay in the current scope, not a per-city pay breakdown nobody
      // asked for.
      wantsAreas: wantsAreas(question),
    },
    inherited,
    isNewQuestion,
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
): FollowUp[] {
  const out: FollowUp[] = [];

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

  return out.slice(0, 4);
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
  return [q.skill, q.scope.label].filter(Boolean).join(" · ");
}
