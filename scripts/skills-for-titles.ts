// Title -> skills, one JSON line in, one JSON line out, using the app's own
// matcher (skillsForText), so a job title maps to the same skills here as it
// does in the Worker and the app. CLAUDE.md: one matcher, wherever a role
// enters.
//
// Driven by scripts/talent_flows.py (skills_of) as a long-lived child process:
// the collector writes a JSON string per line and reads a JSON array back.
// Titles go to this local process and nowhere else; only the skill names are
// kept by the caller.
//
// Run by hand:  echo '"Senior Geologist"' | bun run scripts/skills-for-titles.ts
import { createInterface } from "node:readline";
import { skillsForText } from "../src/employsi/data/skillsTaxonomy";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let title = "";
  try {
    title = String(JSON.parse(line) ?? "");
  } catch {
    title = "";
  }
  const skills = title.trim() ? [...new Set(skillsForText(title))].sort() : [];
  process.stdout.write(JSON.stringify(skills) + "\n");
});
