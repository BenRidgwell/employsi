// Offline title → canonical-skills mapper, so the SEEK archive rows written by
// scripts/seek-to-d1.py carry the SAME skills the jobs-cron worker would map
// (skillsForText, one taxonomy for every source). No network — pure text match.
//
// Reads a JSON array of strings on stdin, writes a JSON array of string[] on
// stdout, index-aligned. Run: bun run scripts/map-skills.ts < titles.json
import { skillsForText } from '../src/employsi/data/skillsTaxonomy';

const chunks: Buffer[] = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let titles: string[] = [];
  try {
    titles = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.stderr.write('map-skills: invalid JSON on stdin\n');
    process.exit(1);
  }
  const out = titles.map((t) => skillsForText(String(t || '')));
  process.stdout.write(JSON.stringify(out));
});
