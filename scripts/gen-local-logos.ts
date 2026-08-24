// Generate src/employsi/data/localLogos.ts from whatever is in public/logos/.
//
// WHY A GENERATOR AND NOT A DIRECTORY READ
// The app is a static build served from a Worker; nothing in it can list a
// directory at runtime. So the folder has to be turned into a map at build
// time, and that map has to be committed alongside the images. Dropping a file
// in and forgetting this step is the one failure mode here, which is why the
// README says to commit both and why the generated file names the command.
//
// WHAT IT VALIDATES
//  * the filename is a real roster id — a typo'd id would produce a map entry
//    nothing ever looks up, which is silent and would read as "the logo didn't
//    work" rather than "the file is misnamed".
//  * no company has two files. Picking one by extension order would mean the
//    live badge depends on something invisible; erroring means you know.
//
// Run: bun run scripts/gen-local-logos.ts
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMPANIES } from "../src/employsi/data/companies";

const DIR = join(import.meta.dir ?? ".", "..", "public", "logos");
const OUT = join(import.meta.dir ?? ".", "..", "src", "employsi", "data", "localLogos.ts");
// avif is here because a supplied logo turned out to be one. Cloudflare serves
// assets by EXTENSION, so a file must be named for what it actually IS — an
// AVIF called .png goes out as image/png full of AVIF bytes. Renaming it to
// .avif is the fix, and that only works if the generator will pick it up;
// otherwise the file is silently dropped from the map instead, which is worse
// than the mislabelling it was meant to correct.
const EXT = /\.(png|jpg|jpeg|svg|webp|avif)$/i;

const ids = new Set((COMPANIES as { id: string }[]).map((c) => c.id));
const byId = new Map<string, string>();
const unknown: string[] = [];
const dupes: string[] = [];

for (const file of readdirSync(DIR).sort()) {
  if (!EXT.test(file)) continue;
  const id = file.replace(EXT, "");
  if (!ids.has(id)) {
    unknown.push(file);
    continue;
  }
  if (byId.has(id)) {
    dupes.push(`${byId.get(id)} and ${file}`);
    continue;
  }
  byId.set(id, file);
}

if (unknown.length) {
  console.error(
    `✗ Not a roster id, so nothing would ever read these:\n   ${unknown.join("\n   ")}`,
  );
  console.error("  See public/logos/README.md for how to look an id up.");
}
if (dupes.length) {
  console.error(`✗ Two files for one company:\n   ${dupes.join("\n   ")}`);
}
if (unknown.length || dupes.length) process.exit(1);

// The empty case is written as `{}` on one line rather than a blank body,
// because prettier (enforced through ESLint) rejects the blank one and this
// file is NOT in the generated-file ignore list — it is small and normally
// formatted, so linting it is a free check on the generator's own output.
//
// That check only stays free if the output is prettier-clean to begin with, and
// the FIRST long id broke it: "perth-gov-north-metropolitan-health-service"
// makes a 106-character line against a printWidth of 100, so `npm run lint`
// went red on a file nobody had edited. Prettier's own answer is to break after
// the key and indent the value four, which is what the long branch writes. The
// threshold is prettier's, read from .prettierrc — if that changes, this has to
// change with it.
const PRINT_WIDTH = 100;
const entry = (id: string, file: string) => {
  const key = `  ${JSON.stringify(id)}:`;
  const value = `"/logos/${file}",`;
  return `${key} ${value}`.length <= PRINT_WIDTH ? `${key} ${value}` : `${key}\n    ${value}`;
};
const body = byId.size ? "{\n" + [...byId].map(([id, f]) => entry(id, f)).join("\n") + "\n}" : "{}";

writeFileSync(
  OUT,
  `// GENERATED — do not edit by hand.
// Run: bun run scripts/gen-local-logos.ts
//
// Roster id -> a logo file committed under public/logos/. These are checked in
// rather than linked, so unlike every other badge source they cannot stop
// resolving when somebody else's server changes. companyLogo.ts reads this
// first, which makes dropping a file in the folder the way to override a wrong
// or low-quality badge without editing any data file.
export const LOCAL_LOGO: Record<string, string> = ${body};
`,
);

console.log(
  `Wrote ${byId.size} logo${byId.size === 1 ? "" : "s"} to src/employsi/data/localLogos.ts`,
);
