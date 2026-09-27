import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { answerQuestion } from "./analystAnswer";
import { LIMITS, METHOD } from "./analystChat";
import type { AnalystAnswer } from "./analystFn";
import type { DataIntent } from "./analystIntent";
import type { ResolvedScope } from "./analystScope";
import { resolveTurn, type AnalystQuery } from "./analystTurn";

/**
 * The browser half of the conversational analyst (see analystLlmFn.ts for why
 * the tools run here). It drives one question to a reply: ask the model, run
 * whatever tools it calls through the analyst's own pipeline, send the
 * results back, repeat until it answers.
 *
 * A TOOL CALL IS ANSWERED EXACTLY AS A TYPED QUESTION WOULD BE: resolveTurn
 * then answerQuestion, against the pane's scope, sector and hubs. So the
 * model cannot reach data the rule-based analyst cannot, and a figure it
 * quotes is one the pane could have shown on its own.
 *
 * Returns null whenever the conversational path should step aside — no key on
 * this deployment, a failed call, the daily limit — and the pane answers the
 * question the old way. The rule-based analyst is the floor, not a mode.
 */

export type LlmMessage = import("./analystLlmFn").LlmMessage;
type WireBlock = import("./analystLlmFn").WireBlock;
type LlmToolCall = import("./analystLlmFn").LlmToolCall;

export interface LlmContext {
  scope: ResolvedScope;
  localCity?: string;
  sector?: string;
  companyIds?: string[];
}

export interface LlmTurnResult {
  text: string;
  /** The last data answer the model read, for the stats, chart and source. */
  answer?: AnalystAnswer;
  /** Its resolved query, so the pane's follow-up chips carry on from it. */
  query?: AnalystQuery;
  note?: string;
}

/** Off for the rest of the page once the server says there is no key. */
let disabled = false;
/** Tool rounds per question the client will run; the server caps it too. */
const MAX_STEPS = 4;
/** Messages of history carried into the next question. */
const KEEP = 16;

async function runData(
  question: string,
  ctx: LlmContext,
): Promise<{ text: string; answer?: AnalystAnswer; query?: AnalystQuery }> {
  const turn = resolveTurn(question, null, ctx.scope, ctx.localCity);
  if (turn.kind === "empty") {
    return {
      text: "employsi's data can't answer that question as worded. It answers: vacancies open and their trend, skills in demand, advertised pay (overall or by skill), how long ads stay up, and long-run history from the national series.",
    };
  }
  const q = turn.query;
  const answer = await answerQuestion(
    question,
    q.scope,
    q.scope.hubs,
    q.scope.country,
    ctx.sector,
    ctx.companyIds,
    { intent: q.intent, skill: q.skill, skillVia: q.skillVia, wantsAreas: q.wantsAreas },
  );
  const intent = (q.intent === "unknown" ? null : q.intent) as DataIntent | null;
  const lines = [
    `Scope: ${q.scope.label}${q.skill ? ` · skill: ${q.skill}` : ""}${ctx.sector ? ` · sector: ${ctx.sector}` : ""}`,
    `Answer: ${answer.text}`,
  ];
  if (answer.stats?.length) {
    lines.push(
      `Figures: ${answer.stats.map((s) => `${s.k} = ${s.v}${s.d ? ` (${s.d})` : ""}`).join("; ")}`,
    );
  }
  if (answer.bars?.length) {
    lines.push(`Breakdown: ${answer.bars.map((b) => `${b.name} = ${b.v}`).join("; ")}`);
  }
  if (answer.source) lines.push(`Source: ${answer.source}`);
  if (intent) lines.push(`How it was measured: ${METHOD[intent]}`, `Limits: ${LIMITS[intent]}`);
  return { text: lines.join("\n"), answer, query: q };
}

async function runPathway(skillIn: string): Promise<string> {
  const want = skillIn.trim().toLowerCase();
  const skill = ALL_SKILLS.find((s) => s.toLowerCase() === want);
  if (!skill) {
    const near = ALL_SKILLS.filter((s) => s.toLowerCase().includes(want.split(" ")[0] ?? "")).slice(
      0,
      6,
    );
    return `"${skillIn}" isn't a skill in employsi's taxonomy.${near.length ? ` Close matches: ${near.join(", ")}.` : ""}`;
  }
  const { getCareerCard } = await import("./careerPathwaysFn");
  const res = await getCareerCard({ data: { skill } });
  const m = res?.model;
  if (!m) return `No career pathway is published for ${skill} in Australia yet.`;
  const roles = m.nodes.map(
    (n) =>
      `${n.title} — ${n.stageOf}; median pay ${n.payLabel}; ${n.ads} live ads; ${n.employers} employers`,
  );
  return [
    `Career pathway for ${skill}: the ${m.familyLabel} family in ${m.countryName}, ads from ${m.window.from} to ${m.window.to}.`,
    ...roles,
    "Pay is the median advertised salary where at least 8 ads disclosed one; '—' means too few did.",
  ].join("\n");
}

/** Run one tool call the way a typed question is answered. Never throws. */
export async function runTool(
  c: Pick<LlmToolCall, "name" | "input">,
  ctx: LlmContext,
): Promise<{ text: string; answer?: AnalystAnswer; query?: AnalystQuery }> {
  try {
    if (c.name === "career_pathway") return { text: await runPathway(c.input.skill ?? "") };
    return await runData(c.input.question ?? "", ctx);
  } catch {
    return { text: "That query failed. Say it couldn't be answered right now; do not guess." };
  }
}

export async function runLlmTurn(
  history: LlmMessage[],
  question: string,
  ctx: LlmContext,
): Promise<{ result: LlmTurnResult; history: LlmMessage[] } | { fallback: string | null }> {
  if (disabled) return { fallback: null };
  const { analystLlmStep } = await import("./analystLlmFn");
  const messages: LlmMessage[] = [...history, { role: "user", content: question }];
  let answer: AnalystAnswer | undefined;
  let query: AnalystQuery | undefined;

  for (let i = 0; i < MAX_STEPS; i++) {
    const step = await analystLlmStep({
      data: { messages, context: { scope: ctx.scope.label, sector: ctx.sector ?? null } },
    }).catch(() => null);
    if (!step || step.kind === "unavailable") {
      if (step?.reason === "disabled") disabled = true;
      return { fallback: step?.kind === "unavailable" ? (step.message ?? null) : null };
    }
    if (step.kind === "tools") {
      messages.push({ role: "assistant", content: step.content });
      const ran = await Promise.all(step.calls.map((c) => runTool(c, ctx)));
      for (const r of ran) {
        if (r.answer) {
          answer = r.answer;
          query = r.query;
        }
      }
      const results: WireBlock[] = ran.map((r, k) => ({
        type: "tool_result",
        tool_use_id: step.calls[k].id,
        content: r.text,
      }));
      messages.push({ role: "user", content: results });
      continue;
    }

    // A reply. When it carries a figure no tool returned, it is not shown:
    // the data answer it was built from is, which says the same thing with
    // numbers that came from a row.
    if (!step.verified) {
      return {
        result: answer
          ? {
              text: answer.text,
              answer,
              query,
              note: "Showing the data answer directly — the conversational reply quoted a figure I couldn't trace to the data.",
            }
          : {
              text: "I can only give figures that come from employsi's data, and I couldn't back that one up. Ask me about vacancies, pay, skills in demand or how long ads stay up somewhere, and I'll answer from the archive.",
            },
        history: trim([...messages, { role: "assistant", content: answer?.text ?? "…" }]),
      };
    }
    messages.push({ role: "assistant", content: step.text });
    return { result: { text: step.text, answer, query }, history: trim(messages) };
  }
  return { fallback: null };
}

/**
 * The last KEEP messages, starting at a typed question so the history never
 * opens on a tool result whose call was trimmed away (the API rejects that).
 */
function trim(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length <= KEEP) return messages;
  const tail = messages.slice(-KEEP);
  const start = tail.findIndex((m) => m.role === "user" && typeof m.content === "string");
  return start >= 0 ? tail.slice(start) : [];
}
