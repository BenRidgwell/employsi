// Offline location → map-hub resolver, so the archive rows written by the
// GitHub-Action scrapers land on the SAME hub the jobs-cron worker would choose.
//
// WHY THIS EXISTS
// `hubFor` in workers/jobs-cron/careerSites.ts is a long, carefully ordered list
// of needles with real traps in it — Erskineville (Sydney) must be tested before
// Erskine (Perth), " wa," carries a comma because " wa" is inside "waikato", and
// bare "hamilton" is deliberately absent because 21 of 25 archived Hamiltons are
// not the New Zealand one. Re-implementing any of that in Python would drift,
// and the drift would be invisible: a row with the wrong hub still archives, it
// just appears in the wrong city.
//
// Reads {"locations": string[], "home": string|null} on stdin, writes a JSON
// array of (string|null), index-aligned, on stdout.
// Run: bun run scripts/map-hubs.ts < locations.json
import { hubFor, HOME_COUNTRY } from "../workers/jobs-cron/careerSites";

const chunks: Buffer[] = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    process.stderr.write("map-hubs: invalid JSON on stdin\n");
    process.exit(1);
  }
  let locations: string[] = [];
  let home: string | null = null;
  if (Array.isArray(raw)) {
    locations = raw as string[];
  } else if (raw && typeof raw === "object") {
    const o = raw as { locations?: string[]; home?: string | null };
    locations = o.locations ?? [];
    home = o.home ?? null;
  }
  const country = HOME_COUNTRY[home ?? ""] ?? /$^/;
  process.stdout.write(
    JSON.stringify(locations.map((l) => hubFor(String(l || ""), home, country))),
  );
});
