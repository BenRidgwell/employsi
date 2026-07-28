// Offline title → canonical-skills mapper, so the SEEK archive rows written by
// scripts/seek-to-d1.py carry the SAME skills the jobs-cron worker would map
// (skillsForText, one taxonomy for every source). No network — pure text match.
//
// Reads a JSON array of strings on stdin, writes a JSON array of string[] on
// stdout, index-aligned. Run: bun run scripts/map-skills.ts < titles.json
import { skillsForText } from "../src/employsi/data/skillsTaxonomy";

const chunks: Buffer[] = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    process.stderr.write("map-skills: invalid JSON on stdin\n");
    process.exit(1);
  }
  // Two accepted shapes. A bare array keeps every existing caller working; the
  // object form carries the employer's industry, which some terms need to be
  // read correctly — "Principal" is a school principal in education and a
  // seniority grade everywhere else (see INDUSTRY_GATED in skillsTaxonomy).
  // Without a sector the matcher deliberately keeps its ungated behaviour, so
  // callers that genuinely don't know the employer lose nothing.
  let titles: string[] = [];
  let sector: string | undefined;
  let group: string | undefined;
  if (Array.isArray(raw)) {
    titles = raw as string[];
  } else if (raw && typeof raw === "object") {
    const o = raw as { titles?: string[]; sector?: string; group?: string };
    titles = o.titles ?? [];
    sector = o.sector;
    group = o.group;
  }
  const ctx = sector || group ? { sector, group } : undefined;
  const out = titles.map((t) => skillsForText(String(t || ""), undefined, ctx));
  process.stdout.write(JSON.stringify(out));
});
