import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type Anthropic from "@anthropic-ai/sdk";
import type { D1Like } from "./jobArchive";

/**
 * "Ask an analyst" as a conversation: Claude reads the question, decides which
 * of employsi's own queries answer it, and explains what comes back.
 *
 * THE MODEL NEVER SUPPLIES A FIGURE. It has two tools — the analyst's existing
 * archive/series pipeline (analystAnswer.answerQuestion) and the career
 * pathways card — and every number it may say has to be in what those tools
 * returned. That is instructed, and then CHECKED: `untraced` below compares
 * every figure in the reply against the tool results and the user's own words,
 * and a reply carrying a number from nowhere is not shown (the pane shows the
 * tool's own answer instead). A language model's typical failure is a
 * plausible figure it made up, which is the exact failure this codebase
 * exists to prevent, so it is caught mechanically rather than trusted away.
 *
 * THE TOOLS RUN IN THE BROWSER, and this function only runs the model. The
 * analyst pipeline reads the national series files, which are large generated
 * data the Worker bundle does not carry, and the pane already resolves scope,
 * sector and follow-ups against them. So one question is a short exchange:
 * this returns either the reply or the tool calls the model wants, the pane
 * runs them through the same path a typed question takes, and sends the
 * results back. Every exchange is one model call and is counted as one.
 *
 * COST IS CAPPED HERE, NOT TRUSTED TO THE CLIENT:
 *   - the cheapest model (Haiku 4.5, $1 / $5 per million tokens in / out);
 *   - MAX_TOKENS on every reply, and at most MAX_ROUNDS tool rounds per
 *     question — after that the model must answer with what it has;
 *   - a daily allowance of model calls per visitor AND for the whole site,
 *     counted atomically in D1. When either runs out, the pane falls back to
 *     the rule-based analyst, which costs nothing.
 * The Anthropic Console's monthly spend limit is the backstop behind all of
 * this, and the only one that cannot be got wrong in code.
 *
 * OFF WITHOUT A KEY. With no ANTHROPIC_API_KEY secret on the Worker this
 * returns `unavailable: disabled` and the pane behaves exactly as it did
 * before this file existed.
 */

export const LLM_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 700;
/** Tool rounds per question before the model must answer. */
const MAX_ROUNDS = 2;
/** Model calls per visitor per UTC day. A question is usually 2 or 3. */
const PER_VISITOR_DAILY = 45;
/**
 * Model calls for the whole site per UTC day. At Haiku's prices a call here
 * is roughly half a US cent (≈3k tokens in, ≈300 out), so this caps a day at
 * about $4 whatever the traffic.
 */
const SITE_DAILY = 800;
/** Longest question accepted, in characters. */
const MAX_QUESTION = 600;
/** Rough ceiling on the whole conversation sent back each call. */
const MAX_CONVERSATION_CHARS = 30_000;

/**
 * The conversation on the wire. Plain shapes rather than the SDK's own types,
 * because a server fn's arguments and result must be serialisable and the
 * SDK's block unions are wider than that; both tools take string inputs only.
 */
export type WireBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, string> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | WireBlock[];
}

export interface LlmToolCall {
  id: string;
  name: "employsi_data" | "career_pathway";
  input: Record<string, string>;
}

export type LlmStep =
  | { kind: "reply"; text: string; verified: boolean }
  | { kind: "tools"; content: WireBlock[]; calls: LlmToolCall[] }
  | { kind: "unavailable"; reason: "disabled" | "limit" | "error"; message?: string };

export interface LlmStepRequest {
  messages: LlmMessage[];
  /** What the pane is scoped to, so "here" and "this market" mean something. */
  context: { scope: string; sector?: string | null };
}

const SYSTEM = `You are the analyst inside employsi, a labour-market intelligence app built on real job-vacancy data: ads crawled nightly from employer career sites, government job boards and job boards, plus the official national vacancy series (Jobs and Skills Australia, StatCan, MBIE, MRSD, ONS, Eurostat, BLS).

How you work:
- For ANY question about jobs, vacancies, hiring, demand, pay, skills, how long ads stay up, or how a market has changed, call the employsi_data tool. Write its question as one plain, self-contained sentence naming the place, company and skill, e.g. "What does nursing pay in Perth?" or "Which skills are most in demand in Sydney?". One measurement per call; call it more than once to compare places or skills.
- For questions about careers, progression, next roles or what a skill leads to, call career_pathway with a skill name.
- Every number you write must come from a tool result in this conversation, copied exactly as the tool wrote it (same rounding, same units). Never estimate, round differently, convert currencies, or add figures of your own. If the tools don't have it, say employsi doesn't measure that.
- You may give general career guidance that needs no figures (how to move into a role, what employers look for, how to read the data). Say plainly when something is general knowledge rather than employsi data.
- The data measures ADVERTISED vacancies, not jobs, hires or applicants. Use the method and limits text a tool returns when asked why, how or whether to trust a figure.
- Stay on work, careers, skills and the labour market. For anything else, say briefly that you only cover those and suggest a question you can answer.

Style: Australian English. Short and direct: two to five sentences, plain text, no markdown headings, no tables, no bullet lists unless comparing several items. Lead with the answer.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "employsi_data",
    description:
      "Query employsi's vacancy archive and the national vacancy series. Answers: how many vacancies are open (in a city, country, region or at a company, optionally for a skill) and which way that is moving; which skills employers ask for; what the ads disclose about pay, overall or for a skill, and which skills pay most; how long ads stay up; and long-run history since 2019 from the official series. Returns the answer text, its figures, its source, how it was measured and what it cannot tell you.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "One self-contained question in plain English naming the place/company/skill, e.g. 'How many nursing roles are open in Brisbane?'",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "career_pathway",
    description:
      "The career ladder for the job family that advertises a skill most in Australia: each role's stage, median advertised pay and live ads, core path and specialist lanes. Use for progression, 'what's next', and 'what does this skill lead to' questions.",
    input_schema: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          description: "A skill name, e.g. 'Human Resources', 'Nursing', 'Data Analytics'.",
        },
      },
      required: ["skill"],
      additionalProperties: false,
    },
    // Cache the system prompt and both tools as one prefix. Haiku caches only
    // past a minimum prefix length, so this may not engage; it costs nothing
    // when it does not.
    cache_control: { type: "ephemeral" },
  },
];

async function workerEnv(): Promise<Record<string, unknown> | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

let usageTable = false;
/**
 * Count one model call against today's allowances and report whether it fits.
 * The increment and the read are one statement, so two tabs racing cannot
 * both see the last free call. A visitor is a salted hash of their IP — the
 * address itself is never stored.
 */
async function withinAllowance(db: D1Like, visitor: string): Promise<boolean> {
  if (!usageTable) {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS llm_usage (
           day TEXT NOT NULL,
           who TEXT NOT NULL,   -- 'site' or a hashed visitor
           n   INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (day, who)
         )`,
      )
      .run();
    usageTable = true;
  }
  const day = new Date().toISOString().slice(0, 10);
  const bump = (who: string) =>
    db
      .prepare(
        `INSERT INTO llm_usage (day, who, n) VALUES (?, ?, 1)
           ON CONFLICT(day, who) DO UPDATE SET n = n + 1
         RETURNING n`,
      )
      .bind(day, who)
      .first();
  const [site, mine] = await Promise.all([bump("site"), bump(visitor)]);
  return Number(site?.n) <= SITE_DAILY && Number(mine?.n) <= PER_VISITOR_DAILY;
}

async function visitorKey(): Promise<string> {
  let ip = "unknown";
  try {
    const h = getRequest().headers;
    ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || ip;
  } catch {
    // Off-request (should not happen in a server fn): one shared bucket.
  }
  const bytes = new TextEncoder().encode(`employsi-llm|${ip}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A tool input reduced to its string fields, which is all either tool takes. */
function strings(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x.slice(0, 300);
  }
  return out;
}

/** Keep only the block types this exchange uses, with bounded text. */
function sanitise(messages: unknown): LlmMessage[] | null {
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) return null;
  const out: LlmMessage[] = [];
  let chars = 0;
  for (const m of messages as Array<{ role?: unknown; content?: unknown }>) {
    if (m.role !== "user" && m.role !== "assistant") return null;
    if (typeof m.content === "string") {
      chars += m.content.length;
      out.push({ role: m.role, content: m.content.slice(0, 4000) });
      continue;
    }
    if (!Array.isArray(m.content)) return null;
    const blocks: WireBlock[] = [];
    for (const b of m.content as Array<Record<string, unknown>>) {
      if (b.type === "text" && typeof b.text === "string") {
        chars += b.text.length;
        blocks.push({ type: "text", text: b.text.slice(0, 4000) });
      } else if (m.role === "assistant" && b.type === "tool_use" && typeof b.id === "string") {
        const input = strings(b.input);
        chars += JSON.stringify(input).length;
        blocks.push({ type: "tool_use", id: b.id, name: String(b.name), input });
      } else if (
        m.role === "user" &&
        b.type === "tool_result" &&
        typeof b.tool_use_id === "string"
      ) {
        const text = typeof b.content === "string" ? b.content.slice(0, 8000) : "";
        chars += text.length;
        blocks.push({ type: "tool_result", tool_use_id: b.tool_use_id, content: text });
      }
    }
    if (!blocks.length) return null;
    out.push({ role: m.role, content: blocks });
  }
  if (chars > MAX_CONVERSATION_CHARS || out[0].role !== "user") return null;
  return out;
}

/** Index of the message holding the user's latest typed question. */
function lastQuestionAt(messages: LlmMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (messages[i].role !== "user") continue;
    if (typeof c === "string" || c.some((b) => b.type === "text")) return i;
  }
  return 0;
}

// ── The figure check ─────────────────────────────────────────────────────────

/** Numbers in a text, as values, with a "K" / "M" suffix also read scaled. */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kKmM]\b)?/g)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    out.push(v);
    if (m[2]) out.push(v * (/k/i.test(m[2]) ? 1e3 : 1e6));
  }
  return out;
}

/**
 * Figures in the reply that no tool result and no user message contains.
 *
 * Single digits are skipped ("two roles", "3 cities" are not where a
 * fabricated statistic hides, and "top 5" is the user's own framing), and so
 * are plausible years. A figure matches when it equals a sourced value, or is
 * that value rounded to a whole number — the tools print "+6.4%" and a reply
 * saying "about 6%" is the same figure, not a new one.
 */
export function untraced(reply: string, sources: string[]): number[] {
  const known = new Set<number>();
  for (const s of sources) for (const v of numbersIn(s)) known.add(v);
  const ok = (v: number) => {
    if (known.has(v)) return true;
    for (const k of known) if (Math.round(k) === v || Math.round(k * 10) / 10 === v) return true;
    return false;
  };
  return numbersIn(reply).filter(
    (v) => v >= 10 && !(v >= 1990 && v <= 2040 && v % 1 === 0) && !ok(v),
  );
}

function sourcesOf(messages: LlmMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      if (m.role === "user") out.push(m.content);
      continue;
    }
    for (const b of m.content) {
      if (b.type === "tool_result" && typeof b.content === "string") out.push(b.content);
      else if (m.role === "user" && b.type === "text") out.push(b.text);
    }
  }
  return out;
}

// ── The step ─────────────────────────────────────────────────────────────────

export const analystLlmStep = createServerFn({ method: "POST" })
  .validator((d: LlmStepRequest) => d)
  .handler(async ({ data }): Promise<LlmStep> => {
    const env = await workerEnv();
    const key = typeof env?.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY : "";
    const db = (env?.JOBS_ARCHIVE as D1Like | undefined) ?? null;
    // No key, or no database to count against: off. Failing closed on the
    // counter is deliberate — an uncounted model is an uncapped bill.
    if (!key || !db) return { kind: "unavailable", reason: "disabled" };

    const messages = sanitise(data?.messages);
    if (!messages) return { kind: "unavailable", reason: "error" };
    const q = messages[lastQuestionAt(messages)];
    const qText =
      typeof q.content === "string"
        ? q.content
        : q.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    if (qText.length > MAX_QUESTION) {
      return {
        kind: "reply",
        text: `That's a long one — keep questions under ${MAX_QUESTION} characters and I'll take it.`,
        verified: true,
      };
    }

    try {
      if (!(await withinAllowance(db, await visitorKey()))) {
        return {
          kind: "unavailable",
          reason: "limit",
          message:
            "The conversational analyst has reached its limit for today, so I'm answering with the standard analyst instead. It resets at midnight UTC.",
        };
      }
    } catch {
      return { kind: "unavailable", reason: "disabled" };
    }

    // Rounds already spent on this question: each is an assistant turn after it.
    const rounds = messages
      .slice(lastQuestionAt(messages))
      .filter((m) => m.role === "assistant").length;
    const scope = String(data?.context?.scope ?? "").slice(0, 80);
    const sector = data?.context?.sector ? String(data.context.sector).slice(0, 60) : null;

    try {
      const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
      const client = new AnthropicClient({ apiKey: key, maxRetries: 1, timeout: 25_000 });
      const res = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          { type: "text", text: SYSTEM },
          {
            type: "text",
            text:
              `The analyst panel is currently scoped to ${scope || "the world"}` +
              (sector ? `, narrowed to the ${sector} sector` : "") +
              `. A question that names no place is about that scope.` +
              (rounds >= MAX_ROUNDS
                ? " You have used your tool calls for this question: answer now from the results above."
                : ""),
          },
        ],
        tools: TOOLS,
        // Past the round limit the model must answer; it cannot call again.
        tool_choice: rounds >= MAX_ROUNDS ? { type: "none" } : { type: "auto" },
        messages: messages as Anthropic.MessageParam[],
      });

      // The assistant turn is echoed back verbatim on the next call, so it
      // carries every tool_use the model made — answering only some of them
      // is a 400 — and the calls list is capped by dropping whole blocks.
      const content: WireBlock[] = [];
      const calls: LlmToolCall[] = [];
      for (const b of res.content) {
        if (b.type === "text") content.push({ type: "text", text: b.text });
        else if (b.type === "tool_use" && calls.length < 3) {
          const name = b.name === "career_pathway" ? "career_pathway" : "employsi_data";
          const input = strings(b.input);
          content.push({ type: "tool_use", id: b.id, name: b.name, input });
          calls.push({ id: b.id, name, input });
        }
      }
      if (res.stop_reason === "tool_use" && calls.length) return { kind: "tools", content, calls };

      const text = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      if (!text) return { kind: "unavailable", reason: "error" };
      return { kind: "reply", text, verified: untraced(text, sourcesOf(messages)).length === 0 };
    } catch {
      return { kind: "unavailable", reason: "error" };
    }
  });
