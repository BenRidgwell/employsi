/**
 * The career card's hotspot map background → src/employsi/data/careerLand.ts.
 *
 * The Career Pathway Card design draws Australia and New Zealand with d3 at
 * runtime: world-atlas 2.0.2 countries-110m, d3.geoMercator fitted so the
 * box [113°E, 44°S]–[179°E, 10.5°S] fills a 300×200 viewBox inset by 8px.
 * The app has neither d3 nor topojson as dependencies, and the outline never
 * changes, so this renders it once — same atlas, same fit — to an SVG path
 * string, and records the projection's three numbers so the card can place
 * city pins with plain arithmetic (see projectHotspot in careerLand.ts).
 *
 * Not a build dependency. Run by hand with the three packages installed
 * somewhere on NODE_PATH:
 *
 *   npm i --prefix /tmp/land d3-geo@3 topojson-client@3 world-atlas@2.0.2
 *   NODE_PATH=/tmp/land/node_modules node scripts/gen-career-land.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { geoMercator, geoPath } = require("d3-geo");
const { feature } = require("topojson-client");
const topo = require("world-atlas/countries-110m.json");

const W = 300;
const H = 200;
const proj = geoMercator().fitExtent(
  [
    [8, 8],
    [W - 8, H - 8],
  ],
  {
    type: "MultiPoint",
    coordinates: [
      [113, -44],
      [179, -10.5],
    ],
  },
);
const path = geoPath(proj).digits(1);

// Only the countries that reach into the frame — the design drew the whole
// world and let the viewBox clip it, which is ~100 KB of path nobody sees.
const pad = 20;
const d = feature(topo, topo.objects.countries)
  .features.filter((f) => {
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    return x1 > -pad && x0 < W + pad && y1 > -pad && y0 < H + pad;
  })
  .map((f) => path(f) || "")
  .join("");

const [tx, ty] = proj.translate();
const k = proj.scale();

writeFileSync(
  "src/employsi/data/careerLand.ts",
  `// GENERATED — do not edit by hand. Rewritten by scripts/gen-career-land.mjs
// from world-atlas 2.0.2 countries-110m, projected as the Career Pathway Card
// design does (Mercator fitted to 113°E 44°S – 179°E 10.5°S in a 300×200 box).

/** Land outline for the hotspot map, in the 300×200 viewBox. */
export const CAREER_LAND_PATH = ${JSON.stringify(d)};

/** d3.geoMercator's scale and translate for that fit. */
export const CAREER_LAND_PROJ = { k: ${k}, tx: ${tx}, ty: ${ty} };

/** [lon, lat] → [x, y] in the viewBox: d3.geoMercator's forward formula. */
export function projectHotspot(lon: number, lat: number): [number, number] {
  const { k, tx, ty } = CAREER_LAND_PROJ;
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  return [tx + k * l, ty - k * Math.log(Math.tan(Math.PI / 4 + p / 2))];
}
`,
);
console.log(`wrote careerLand.ts — path ${d.length} chars, k=${k.toFixed(2)}`);
