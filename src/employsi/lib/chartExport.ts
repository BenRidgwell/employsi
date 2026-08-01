import type { AnalystChart } from "./analystFn";

/**
 * Exporting an analyst chart as PNG, JPEG or PDF.
 *
 * ── WHY THIS REDRAWS RATHER THAN SCREENSHOTS ───────────────────────────────
 * The obvious route is to rasterise the rendered DOM. It does not work here:
 * only two of the three chart kinds are a single <svg> — the small multiples
 * are a CSS grid of divs each containing their own sparkline — and rasterising
 * arbitrary HTML needs a library the size of the rest of this bundle.
 *
 * So the export is drawn from the chart DATA, with the same geometry the
 * on-screen renderer uses. That also makes the export a deliberate artefact
 * rather than a photograph of a viewport: it gets the employsi mark, a title,
 * the source line and the disclaimer at a fixed size, whatever the window was.
 *
 * ── WHY THE PDF IS HAND-WRITTEN ────────────────────────────────────────────
 * A single-page PDF wrapping one JPEG is about sixty lines and no dependency.
 * Pulling in a PDF library to draw one image would be the larger decision.
 */

const W = 1200;
const PAD = 48;
const HEAD = 96;
const FOOT = 88;
const INK = "#1c1c1e";
const MID = "#48484a";
const LIGHT = "#8e8e93";
const LINE = "#ededf0";
const MUTED = "#aeaeb2";

/**
 * The 2026 disclaimer carried on every exported chart.
 *
 * It names the source family rather than claiming the figures are ours, and it
 * says the thing a reader of a labour-market chart most needs to know: these
 * are advertised vacancies, which is not the same as hires.
 */
export const EXPORT_DISCLAIMER =
  "© 2026 employsi. Prepared from published labour-market statistics and advertised-vacancy data. " +
  "Advertised vacancies are not hires, and counts reflect what employers published, not total demand. " +
  "Provided for information only — not financial, employment or investment advice.";

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.fill();
}

/** The employsi mark, drawn from the same four rects as EmploysiMark. */
function drawMark(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size / 120;
  const bar = (bx: number, by: number, bw: number, bh: number, fill: string) => {
    c.fillStyle = fill;
    roundRect(c, x + bx * s, y + by * s, bw * s, bh * s, 7.5 * s);
  };
  bar(24, 24, 15, 72, INK);
  bar(24, 24, 40, 15, LIGHT);
  bar(24, 52.5, 55, 15, MID);
  bar(24, 81, 72, 15, INK);
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (c.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function monthTick(iso: string): string {
  const [y, m] = iso.split("-");
  const names = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${names[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

function drawLine(
  c: CanvasRenderingContext2D,
  chart: Extract<AnalystChart, { kind: "line" }>,
  top: number,
  h: number,
) {
  const L = PAD + 56;
  const R = W - PAD;
  const T = top + 34;
  const B = top + h - 46;

  const all = chart.series.flatMap((s) => s.points);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 10;
  const min = lo - pad;
  const max = hi + pad;
  const n = chart.months.length;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (R - L);
  const y = (v: number) => B - ((v - min) / (max - min || 1)) * (B - T);

  c.strokeStyle = "#f4f4f5";
  c.lineWidth = 1;
  c.font = "500 15px ui-monospace, Menlo, monospace";
  c.fillStyle = LIGHT;
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    const yy = Math.round(y(v)) + 0.5;
    c.beginPath();
    c.moveTo(L, yy);
    c.lineTo(R, yy);
    c.stroke();
    c.textAlign = "right";
    c.fillText(String(Math.round(v)), L - 12, yy + 5);
  }

  for (const s of chart.series) {
    c.strokeStyle = s.tone === "ink" ? INK : MUTED;
    c.lineWidth = s.tone === "ink" ? 3 : 2.4;
    c.setLineDash(s.tone === "ink" ? [] : [7, 6]);
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    s.points.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
    c.stroke();
  }
  c.setLineDash([]);

  const step = Math.max(1, Math.floor((n - 1) / 5));
  c.textAlign = "center";
  c.fillStyle = LIGHT;
  for (let i = 0; i < n; i += step) c.fillText(monthTick(chart.months[i]), x(i), B + 30);
  if ((n - 1) % step) c.fillText(monthTick(chart.months[n - 1]), x(n - 1), B + 30);

  // Legend, top-left of the plot: solid ink is the subject, dashed grey the
  // series it is read against — the design's rule, restated on the export
  // because an exported chart travels without its caption.
  let lx = L;
  c.font = "500 15px ui-sans-serif, system-ui, sans-serif";
  for (const s of chart.series) {
    c.strokeStyle = s.tone === "ink" ? INK : MUTED;
    c.lineWidth = s.tone === "ink" ? 3 : 2.4;
    c.setLineDash(s.tone === "ink" ? [] : [6, 5]);
    c.beginPath();
    c.moveTo(lx, top + 14);
    c.lineTo(lx + 26, top + 14);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = s.tone === "ink" ? INK : LIGHT;
    c.textAlign = "left";
    c.fillText(s.label, lx + 34, top + 19);
    lx += 34 + c.measureText(s.label).width + 30;
  }
}

function drawScatter(
  c: CanvasRenderingContext2D,
  chart: Extract<AnalystChart, { kind: "scatter" }>,
  top: number,
  h: number,
) {
  const L = PAD + 64;
  const R = W - PAD;
  const T = top + 30;
  const B = top + h - 52;
  const xs = chart.points.map((p) => p.x);
  const ys = chart.points.map((p) => p.y);
  const x0 = Math.min(0, ...xs) - (Math.max(0, ...xs) - Math.min(0, ...xs)) * 0.18 - 2;
  const x1 = Math.max(0, ...xs) + (Math.max(0, ...xs) - Math.min(0, ...xs)) * 0.18 + 2;
  const y0 = Math.min(0, ...ys) - (Math.max(0, ...ys) - Math.min(0, ...ys)) * 0.18 - 2;
  const y1 = Math.max(0, ...ys) + (Math.max(0, ...ys) - Math.min(0, ...ys)) * 0.18 + 2;
  const px = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (R - L);
  const py = (v: number) => B - ((v - y0) / (y1 - y0 || 1)) * (B - T);
  const wMax = Math.max(...chart.points.map((p) => p.w));

  c.strokeStyle = "#d8d8dc";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(L, py(0));
  c.lineTo(R, py(0));
  c.moveTo(px(0), T);
  c.lineTo(px(0), B);
  c.stroke();

  for (const p of chart.points) {
    const cx = px(p.x);
    const cy = py(p.y);
    const r = 12 + Math.sqrt(p.w / wMax) * 34;
    const grew = p.x >= 0;
    c.globalAlpha = grew ? 0.12 : 0.14;
    c.fillStyle = grew ? INK : LIGHT;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(cx, cy, 6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = grew ? INK : MID;
    c.font = "600 16px ui-sans-serif, system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText(p.label, cx, cy - r - 12);
  }

  c.font = "500 15px ui-monospace, Menlo, monospace";
  c.fillStyle = LIGHT;
  c.textAlign = "right";
  c.fillText(`${Math.round(y1)}%`, L - 12, py(y1) + 14);
  c.fillText("0%", L - 12, py(0) + 5);
  c.fillText(`${Math.round(y0)}%`, L - 12, py(y0) - 6);
  c.textAlign = "center";
  c.fillText(chart.xLabel, (L + R) / 2, B + 38);
}

function drawMultiples(
  c: CanvasRenderingContext2D,
  chart: Extract<AnalystChart, { kind: "multiples" }>,
  top: number,
  h: number,
) {
  const cols = 2;
  const gap = 20;
  const cw = (W - PAD * 2 - gap) / cols;
  const ch = (h - gap) / Math.ceil(chart.panels.length / cols);
  chart.panels.forEach((p, i) => {
    const gx = PAD + (i % cols) * (cw + gap);
    const gy = top + Math.floor(i / cols) * (ch + gap);
    c.fillStyle = "#ffffff";
    c.strokeStyle = LINE;
    c.lineWidth = 1;
    roundRect(c, gx, gy, cw, ch, 14);
    c.strokeRect(gx + 0.5, gy + 0.5, cw - 1, ch - 1);

    c.fillStyle = INK;
    c.font = "600 18px ui-sans-serif, system-ui, sans-serif";
    c.textAlign = "left";
    c.fillText(p.name, gx + 18, gy + 30);
    c.font = "600 15px ui-monospace, Menlo, monospace";
    c.fillStyle = p.down ? "#97332b" : "#1f6a48";
    c.textAlign = "right";
    c.fillText(p.delta, gx + cw - 18, gy + 30);

    const lo = Math.min(...p.points);
    const hi = Math.max(...p.points);
    const pl = gx + 18;
    const pr = gx + cw - 18;
    const pt = gy + 48;
    const pb = gy + ch - 34;
    c.strokeStyle = INK;
    c.lineWidth = 2.6;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    p.points.forEach((v, k) => {
      const xx = pl + (k / Math.max(1, p.points.length - 1)) * (pr - pl);
      const yy = pb - ((v - lo) / (hi - lo || 1)) * (pb - pt);
      if (k) c.lineTo(xx, yy);
      else c.moveTo(xx, yy);
    });
    c.stroke();

    c.fillStyle = LIGHT;
    c.font = "500 13px ui-monospace, Menlo, monospace";
    c.textAlign = "left";
    c.fillText(p.note.toUpperCase(), gx + 18, gy + ch - 14);
  });
}

/** Draw the whole export sheet: mark, title, chart, source, disclaimer. */
export function renderChartSheet(
  chart: AnalystChart,
  title: string,
  source?: string,
): HTMLCanvasElement {
  const body = chart.kind === "multiples" ? 200 * Math.ceil(chart.panels.length / 2) + 40 : 460;
  const H = HEAD + body + FOOT;
  const dpr = 2; // export at 2x so it stays crisp in a slide or a document
  const cv = document.createElement("canvas");
  cv.width = W * dpr;
  cv.height = H * dpr;
  const c = cv.getContext("2d");
  if (!c) return cv;
  c.scale(dpr, dpr);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, H);
  c.textBaseline = "alphabetic";

  drawMark(c, PAD, 28, 40);
  c.fillStyle = INK;
  c.font = "600 26px ui-sans-serif, system-ui, sans-serif";
  c.textAlign = "left";
  c.fillText("employsi", PAD + 48, 58);

  c.fillStyle = MID;
  c.font = "500 18px ui-sans-serif, system-ui, sans-serif";
  const t = wrap(c, title, W - PAD * 2);
  t.slice(0, 2).forEach((ln, i) => c.fillText(ln, PAD, HEAD - 12 + i * 24));

  const top = HEAD + (t.length > 1 ? 24 : 8);
  if (chart.kind === "line") drawLine(c, chart, top, body - 20);
  else if (chart.kind === "scatter") drawScatter(c, chart, top, body - 20);
  else drawMultiples(c, chart, top, body - 20);

  // Footer: hairline, then the source and the disclaimer.
  const fy = H - FOOT + 12;
  c.strokeStyle = LINE;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(PAD, fy);
  c.lineTo(W - PAD, fy);
  c.stroke();

  let ly = fy + 20;
  if (source) {
    c.fillStyle = MID;
    c.font = "500 13px ui-sans-serif, system-ui, sans-serif";
    wrap(c, source, W - PAD * 2)
      .slice(0, 1)
      .forEach((ln) => c.fillText(ln, PAD, ly));
    ly += 18;
  }
  c.fillStyle = LIGHT;
  c.font = "400 11.5px ui-sans-serif, system-ui, sans-serif";
  wrap(c, EXPORT_DISCLAIMER, W - PAD * 2)
    .slice(0, 3)
    .forEach((ln, i) => c.fillText(ln, PAD, ly + i * 15));

  return cv;
}

export type ExportFormat = "png" | "jpeg" | "pdf";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously races the download in
  // Safari, which reads the URL after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Minimal single-page PDF wrapping one JPEG. No dependency.
 *
 * Exported so scripts/test-pdf.ts can check the byte assembly: a wrong xref
 * table produces a file every reader rejects, and that is the one part of the
 * export nobody can eyeball.
 */
export function jpegToPdf(jpeg: Uint8Array, w: number, h: number): Blob {
  const enc = new TextEncoder();
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (p: string | Uint8Array) => {
    parts.push(p);
    len += typeof p === "string" ? p.length : p.length;
  };
  const obj = (body: string, stream?: Uint8Array) => {
    offsets.push(len);
    push(body);
    if (stream) {
      push(stream);
      push("\nendstream\nendobj\n");
    }
  };

  push("%PDF-1.4\n");
  obj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  obj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  obj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );
  obj(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpeg.length} >>\nstream\n`,
    jpeg,
  );
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  obj(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  const xref = len;
  let table = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) table += `${String(o).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  // `.slice()` on the typed arrays narrows ArrayBufferLike to ArrayBuffer,
  // which is what BlobPart wants; without it TS refuses on the SharedArrayBuffer
  // case, which cannot arise here but is in the type.
  const bytes: BlobPart[] = parts.map((p) =>
    typeof p === "string" ? enc.encode(p).slice() : p.slice(),
  );
  return new Blob(bytes, { type: "application/pdf" });
}

export async function exportChart(
  chart: AnalystChart,
  title: string,
  source: string | undefined,
  format: ExportFormat,
): Promise<void> {
  const cv = renderChartSheet(chart, title, source);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug =
    (title || "chart")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "chart";
  const name = `employsi-${slug}-${stamp}`;

  const blobOf = (type: string, q?: number) =>
    new Promise<Blob | null>((res) => cv.toBlob(res, type, q));

  if (format === "png") {
    const b = await blobOf("image/png");
    if (b) download(b, `${name}.png`);
    return;
  }
  if (format === "jpeg") {
    const b = await blobOf("image/jpeg", 0.94);
    if (b) download(b, `${name}.jpg`);
    return;
  }
  // PDF: the page is the sheet at its CSS size, with the 2x bitmap scaled into
  // it, so text stays sharp when the reader zooms.
  const b = await blobOf("image/jpeg", 0.94);
  if (!b) return;
  const buf = new Uint8Array(await b.arrayBuffer());
  download(jpegToPdf(buf, cv.width, cv.height), `${name}.pdf`);
}
