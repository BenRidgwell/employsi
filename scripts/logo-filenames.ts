// The filename public/logos/ expects for every company on a city's map, and
// what that company's badge resolves to today without one.
//
// WHY THIS EXISTS
// The folder is keyed by roster id, and a roster id is not guessable from a
// company name — Alcoa is `perth-aa`, Cash Converters is `ccv`, Perth Airport
// is `priv-perth-airport`. A file named after the company instead of its id is
// the one failure mode the folder has: gen-local-logos.ts rejects it, but only
// after you have gone and found the image.
//
// It also prints what each badge falls back to now, because that is what
// decides whether adding a file is worth doing. A company already resolving to
// a supplied logo or the WA crest looks fine; one on the favicon service is a
// 16px image scraped off a website and is usually the reason a card looks wrong.
//
// Run: bun run scripts/logo-filenames.ts [city]   (default: perth)
//      bun run scripts/logo-filenames.ts perth --missing
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { COMPANIES } from "../src/employsi/data/companies";
import { LOCAL_LOGO } from "../src/employsi/data/localLogos";
import { PRIVATE_LOGO_URL } from "../src/employsi/data/privateLogos";
import { WA_GOV_LOGO_URL, WA_GOV_CREST_ID_SET } from "../src/employsi/data/waGovLogos";
import { LINKEDIN_LOGO } from "../src/employsi/data/linkedinLogos";

const args = process.argv.slice(2);
const city = args.find((a) => !a.startsWith("--")) ?? "perth";
const missingOnly = args.includes("--missing");

const byId = new Map((COMPANIES as { id: string; name: string }[]).map((c) => [c.id, c]));
const roster = (CITY_COMPANIES as Record<string, { id: string }[]>)[city];
if (!roster) {
  console.error(`No city "${city}". Known: ${Object.keys(CITY_COMPANIES).sort().join(", ")}`);
  process.exit(1);
}

type Row = { id: string; name: string; kind: string; source: string };
const rows: Row[] = roster.map(({ id }) => ({
  id,
  name: byId.get(id)?.name ?? "(not on the roster)",
  // "government", not "wa-gov": this script takes a CITY, so the same branch
  // labels sa-gov-*, vic-gov-*, qld-gov-*, aps-* and the rest. Calling every
  // one of them "wa-gov" printed "## wa-gov (76)" over a list of South
  // Australian agencies.
  kind: id.startsWith("priv-") ? "private" : /-gov-/.test(id) ? "government" : "listed",
  // Mirrors the order in src/employsi/lib/companyLogo.ts.
  source: LOCAL_LOGO[id]
    ? "local file"
    : PRIVATE_LOGO_URL[id] || WA_GOV_LOGO_URL[id]
      ? "supplied url"
      : WA_GOV_CREST_ID_SET.has(id)
        ? "WA crest"
        : LINKEDIN_LOGO[id]
          ? "LinkedIn"
          : "favicon service",
}));
rows.sort((a, b) => a.name.localeCompare(b.name));

const shown = missingOnly ? rows.filter((r) => r.source === "favicon service") : rows;
const tally = (k: string) => rows.filter((r) => r.source === k).length;
console.log(
  `${city}: ${rows.length} companies · local file ${tally("local file")} · ` +
    `supplied url ${tally("supplied url")} · WA crest ${tally("WA crest")} · ` +
    `LinkedIn ${tally("LinkedIn")} · favicon service ${tally("favicon service")}`,
);
for (const kind of ["listed", "private", "government"]) {
  const group = shown.filter((r) => r.kind === kind);
  if (!group.length) continue;
  console.log(`\n## ${kind} (${group.length})`);
  for (const r of group) {
    console.log(`${(r.id + ".png").padEnd(52)} ${r.name.padEnd(46)} ${r.source}`);
  }
}
