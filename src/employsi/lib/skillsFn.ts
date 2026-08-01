import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { marketVisible } from "./markets";
import { kvBinding, type KVLike } from "./kv";

// Reads the live skill-demand data the jobs-cron worker writes to KV:
//   • skillidx  — aggregate demand per skill, by company / sector / city
//   • jobs:{id} — a company's currently-advertised roles + their skills
// Both degrade to null/empty off-Worker or before the first cron run.

export interface SkillAgg {
  total: number;
  byCompany: Record<string, number>;
  bySector: Record<string, number>;
  byCity: Record<string, number>;
}
export interface SkillIndex {
  updated: string;
  totalJobs: number;
  skills: Record<string, SkillAgg>;
}
export interface AdvertisedJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string;
  city: string | null;
  skills: string[];
  salN?: number; // advertised salary midpoint (annualised), when the source states one
}
export interface CompanyJobs {
  updated: string;
  count: number;
  jobs: AdvertisedJob[];
}

async function getKV(): Promise<KVLike | null> {
  try {
    const m = await import("cloudflare:workers");
    return kvBinding(m?.env, "OPEN_ROLES_HISTORY");
  } catch {
    return null;
  }
}

export const getSkillIndex = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillIndex | null> => {
    const kv = await getKV();
    if (!kv) return null;
    try {
      const raw = await kv.get("skillidx");
      if (!raw) return null;
      const idx = JSON.parse(raw);
      return idx && idx.skills ? idx : null;
    } catch {
      return null;
    }
  },
);

export const getCompanyJobs = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<CompanyJobs | null> => {
    const kv = await getKV();
    if (!kv || !data.id) return null;
    // Unreleased market: withhold the data as well as the marker. Without this
    // the fade would be cosmetic — the id is guessable and the response would
    // still answer. See lib/markets.ts for why these are hidden rather than
    // unsupported.
    if (!marketVisible(await callerRole(), data.id, true)) return null;

    try {
      const raw = await kv.get(`jobs:${data.id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.jobs) ? parsed : null;
    } catch {
      return null;
    }
  });
