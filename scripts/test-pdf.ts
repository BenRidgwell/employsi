// Byte-level check of the exported chart's PDF wrapper.
import { jpegToPdf } from "../src/employsi/lib/chartExport";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const blob = jpegToPdf(jpeg, 100, 50);

const buf = Buffer.from(await blob.arrayBuffer());
const t = buf.toString("latin1");
const sx = /startxref\n(\d+)/.exec(t);
const offsets = [...t.matchAll(/\n(\d{10}) 00000 n /g)].map((r) => Number(r[1]));

const checks: [string, boolean][] = [
  ["%PDF header", t.startsWith("%PDF-1.4")],
  ["trailing %%EOF", t.trimEnd().endsWith("%%EOF")],
  [
    "startxref points at the xref table",
    !!sx && t.slice(Number(sx[1]), Number(sx[1]) + 4) === "xref",
  ],
  ["five object offsets", offsets.length === 5],
  [
    "each offset lands on 'N 0 obj'",
    offsets.every((o, i) => t.slice(o).startsWith(`${i + 1} 0 obj`)),
  ],
  ["jpeg bytes embedded verbatim", buf.includes(Buffer.from(jpeg))],
  ["image dimensions written", t.includes("/Width 100 /Height 50")],
  ["DCTDecode filter", t.includes("/Filter /DCTDecode")],
  ["stream length matches", t.includes(`/Length ${jpeg.length}`)],
];

let bad = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) bad++;
}
console.log(`\n${buf.length} bytes, ${bad} failure(s)`);
if (bad) process.exit(1);
