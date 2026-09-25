import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { marketVisible } from "./markets";
import { kvBinding } from "./kv";
import type { CareerPathways } from "./careerLadder";
import {
  careerCard,
  familyForSkill,
  popularSkills,
  searchSkills,
  skillDemand,
  type CareerCardModel,
} from "./careerCard";

/**
 * The Career Pathway Card's data: the adapter's model for one family, built on
 * the server so the pathways dataset (~1 MB) never ships to the browser.
 *
 * Source, in order:
 *   1. KV `careerpaths`, written nightly by the scraper Worker's 52 23 * * *
 *      tick (see careerPathwaysBuild);
 *   2. the generated src/employsi/data/careerPathways.ts, until that tick has
 *      run once — the Worker is not deployed with it yet. Same builder, same
 *      shape, just older; `source` says which one answered.
 *
 * ONE MARKET for now: Australia. The hotspot map's projection is the design's
 * own AU/NZ frame (data/careerLand.ts), and pinning another market's cities on
 * it would put Singapore in the Timor Sea. The model itself is per-country
 * already (careerCard's `country`), so a second market is a frame and a
 * picker, not a data change.
 */

export const CAREER_COUNTRY = "au";

/** Parsed once per isolate and reused for this long. The KV value changes once
 *  a night, and parsing a megabyte per request is the cost worth avoiding. */
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; p: CareerPathways; source: "kv" | "bundled" } | null = null;

async function pathways(): Promise<{ p: CareerPathways; source: "kv" | "bundled" }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  let next: typeof cache = null;
  try {
    const m = await import("cloudflare:workers");
    const kv = kvBinding(m?.env, "OPEN_ROLES_HISTORY");
    const { CAREER_PATHWAYS_KV_KEY } = await import("./careerPathwaysBuild");
    const raw = kv ? await kv.get(CAREER_PATHWAYS_KV_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as CareerPathways) : null;
    // A KV value written before the card's fields existed has no `markets`;
    // the bundled file does, so it wins until the tick rewrites the key.
    if (parsed?.nodes?.length && parsed.nodes.every((n) => n.markets))
      next = { at: Date.now(), p: parsed, source: "kv" };
  } catch {
    // Off-Worker (vite dev) or no binding: fall through to the bundled file.
  }
  if (!next) {
    const { CAREER_PATHWAYS } = await import("../data/careerPathways");
    next = { at: Date.now(), p: CAREER_PATHWAYS, source: "bundled" };
  }
  cache = next;
  return next;
}

export interface CareerCardResponse {
  model: CareerCardModel | null;
  /** The market's most-advertised skills — the chips before anything is typed. */
  popular: string[];
  /** Every skill on any rung in the market, A–Z — the chips filter this as you type. */
  skills: string[];
  source: "kv" | "bundled";
  generated: string;
}

/**
 * One family's map. With a skill, the family is the one advertising it most
 * (familyForSkill) and the model carries that skill's specialism lane.
 */
export const getCareerCard = createServerFn({ method: "GET" })
  .validator((data: { family?: string | null; skill?: string | null }) => data)
  .handler(async ({ data }): Promise<CareerCardResponse | null> => {
    if (!marketVisible(await callerRole(), CAREER_COUNTRY)) return null;
    const { p, source } = await pathways();
    const skill = data.skill || null;
    const family =
      (skill && familyForSkill(p, CAREER_COUNTRY, skill, data.family ?? undefined)) ||
      data.family ||
      "hr";
    return {
      model: careerCard(p, family, CAREER_COUNTRY, skill),
      popular: popularSkills(p, CAREER_COUNTRY),
      skills: [...skillDemand(p, CAREER_COUNTRY).keys()].sort(),
      source,
      generated: p.generated,
    };
  });

/**
 * The search box's "describe it in your own words": names first, then what the
 * taxonomy's matcher reads out of the words (searchSkills). Server-side
 * because skillsForText carries the whole taxonomy.
 */
export const searchCareerSkills = createServerFn({ method: "GET" })
  .validator((data: { q: string }) => data)
  .handler(async ({ data }): Promise<string[]> => {
    if (!marketVisible(await callerRole(), CAREER_COUNTRY)) return [];
    const { p } = await pathways();
    return searchSkills(p, CAREER_COUNTRY, String(data.q || "").slice(0, 200));
  });
