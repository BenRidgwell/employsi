#!/usr/bin/env node
/**
 * Draws the skyline behind the intro loader, once, into
 * public/assets/intro-skyline.svg.
 *
 *   node scripts/gen-intro-skyline.js
 *
 * WHY A FILE AND NOT A DATA URI. The design builds this in the page and hands
 * the result to an <img> as `data:image/svg+xml;utf8,` + encodeURIComponent(...).
 * That is right for a single-file design canvas and wrong on the boot path: the
 * markup is 113KB before encoding and about 140KB after it, inlined into the
 * document on every load, uncacheable, and built by ~250 shape calls while the
 * app is trying to start. As a file it is 11KB over the wire and cached from
 * then on.
 *
 * NOTHING IS LOST BY MOVING IT, because the drawing is deterministic: the PRNG
 * is seeded (seed = 7) and nothing reads the clock or the viewport, so this
 * writes the same bytes the page would have built. Change the generator and
 * re-run it; do not hand-edit the SVG.
 *
 * The body below is the design's buildSkyline(), reformatted by prettier and
 * otherwise untouched — verified by regenerating and comparing the SVG's hash.
 */

import { writeFileSync } from "node:fs";
function buildSkyline() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
  const W = 2868,
    G = 708;
  let out = [];
  const rect = (x, y, w, h, f, extra = "") =>
    out.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${f}" ${extra}/>`,
    );
  const poly = (pts, f) =>
    out.push(
      `<polygon points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" fill="${f}"/>`,
    );
  const win = (x, y, w, h, p) => rect(x, y, w, h, `url(#${p})`);
  const needle = (cx, top, h, w, f) => {
    poly(
      [
        [cx - w / 2, top + h],
        [cx, top],
        [cx + w / 2, top + h],
      ],
      f,
    );
    rect(cx - 1.2, top - h * 0.45, 2.4, h * 0.45, f);
  };
  const mullions = (x, y, w, h, gap, f) => {
    for (let mx = x + gap; mx < x + w - 2; mx += gap) rect(mx, y, 1.6, h, f);
  };
  const shade = (x, y, w, h) => {
    rect(x + w * 0.74, y, w * 0.26, h, "url(#lf)");
    rect(x, y, w * 0.07, h, "url(#df)");
    rect(x, y, w, 3, "rgba(255,255,255,.3)");
    rect(x + w * 0.74, y, 1.2, h, "rgba(255,255,255,.28)");
  };
  const lit = (x, y, w, h) => rect(x, y, w, h, rnd() < 0.5 ? "url(#l1)" : "url(#l2)");
  const sheen = (x, y, w, h) =>
    poly(
      [
        [x + w * 0.42, y],
        [x + w * 0.62, y],
        [x + w * 0.28, y + h],
        [x + w * 0.08, y + h],
      ],
      "rgba(255,255,255,.07)",
    );
  const roof = (x, y, w, f) => {
    const n = ri(1, 3);
    for (let i = 0; i < n; i++) {
      const bw = ri(8, Math.max(9, w * 0.25)),
        bh = ri(6, 18),
        bx = x + ri(2, Math.max(3, w - bw - 2));
      rect(bx, y - bh, bw, bh, f);
    }
    if (rnd() < 0.5) {
      const ax = x + ri(4, Math.max(5, w - 6)),
        ah = ri(22, 60);
      rect(ax, y - ah, 1.6, ah, f);
      rect(ax - 3, y - ah * 0.7, 7.6, 2, f);
    }
    if (rnd() < 0.3) {
      const tx = x + ri(4, Math.max(5, w - 16));
      rect(tx, y - 16, 12, 12, f, 'rx="2"');
      rect(tx + 2, y - 4, 8, 4, f);
    }
  };
  const floors = (x, y, w, h, gap, f) => {
    for (let my = y + gap; my < y + h - 2; my += gap) rect(x, my, w, 1.4, f);
  };
  // back layer — pale, low detail
  for (let x = -20; x < W; x += ri(38, 92)) {
    const h = ri(90, 300),
      w = ri(40, 110);
    rect(x, G - h, w, h, "#dedee2");
    win(x, G - h, w, h, "wb");
    if (rnd() < 0.3) rect(x + w * 0.3, G - h - 14, w * 0.4, 14, "#d6d6db");
  }
  // mid layer
  for (let x = 0; x < W; x += ri(70, 160)) {
    const h = ri(180, 420),
      w = ri(50, 130);
    const f = rnd() < 0.5 ? "#c2c2c7" : "#b8b8bd";
    rect(x, G - h, w, h, f);
    win(x, G - h, w, h, "wm");
    floors(x, G - h, w, h, 18, "rgba(0,0,0,.05)");
    shade(x, G - h, w, h);
    lit(x, G - h, w, h);
    if (rnd() < 0.4) rect(x + w * 0.25, G - h - ri(10, 30), w * 0.5, ri(10, 30), f);
    else roof(x, G - h, w, f);
    if (rnd() < 0.3) {
      const nh = ri(40, 90);
      needle(x + w / 2, G - h - nh, nh, 6, f);
    }
  }
  // hero layer
  const ink = ["#6c6c72", "#5e5e63", "#48484a", "#3a3a3c"];
  const deco = (x, w, h) => {
    const f = "#48484a";
    let cx = x + w / 2,
      y = G - h,
      tw = w;
    const tiers = [
      [1, 0.55],
      [0.78, 0.22],
      [0.56, 0.13],
      [0.36, 0.1],
    ];
    let top = G;
    tiers.forEach(([tr, hr]) => {
      const tw2 = w * tr,
        th = h * hr;
      top -= th;
      rect(cx - tw2 / 2, top, tw2, th, f);
      win(cx - tw2 / 2, top, tw2, th, "wd");
      mullions(cx - tw2 / 2, top, tw2, th, tw2 / 5, "rgba(255,255,255,.08)");
      shade(cx - tw2 / 2, top, tw2, th);
      lit(cx - tw2 / 2, top, tw2, th);
      rect(cx - tw2 / 2 - 3, top, tw2 + 6, 4, "#5e5e63");
    });
    rect(cx - w * 0.18, top - 34, w * 0.36, 34, f);
    win(cx - w * 0.18, top - 34, w * 0.36, 34, "wd");
    needle(cx, top - 34 - 120, 120, w * 0.16, f);
  };
  const glass = (x, w, h) => {
    const f = "#5e5e63";
    rect(x, G - h, w, h, f);
    win(x, G - h, w, h, "wg");
    mullions(x, G - h, w, h, w / 6, "rgba(255,255,255,.12)");
    shade(x, G - h, w, h);
    sheen(x, G - h, w, h);
    lit(x, G - h, w, h);
    rect(x, G - h, w, 26, "#6c6c72");
    rect(x + 4, G - h - 22, w - 8, 22, "#48484a");
    mullions(x + 4, G - h - 22, w - 8, 22, 14, "rgba(255,255,255,.35)");
    rect(x + w * 0.3, G - h - 34, 4, 12, "#2c2c2e");
    rect(x + w * 0.7, G - h - 34, 4, 12, "#2c2c2e");
  };
  const pyramid = (x, w, h) => {
    const f = "#6c6c72";
    rect(x, G - h, w, h, f);
    win(x, G - h, w, h, "wg");
    mullions(x, G - h, w, h, w / 7, "rgba(255,255,255,.1)");
    shade(x, G - h, w, h);
    sheen(x, G - h, w, h);
    lit(x, G - h, w, h);
    const cx = x + w / 2,
      rh = w * 0.75;
    poly(
      [
        [x, G - h],
        [cx, G - h - rh],
        [x + w, G - h],
        [x + w - 8, G - h + 30],
        [x + 8, G - h + 30],
      ],
      "#48484a",
    );
    poly(
      [
        [cx, G - h - rh],
        [x + w, G - h],
        [x + w - 8, G - h + 30],
        [cx, G - h + 30],
      ],
      "#6c6c72",
    );
    poly(
      [
        [x + w * 0.2, G - h - rh * 0.27],
        [cx, G - h - rh],
        [x + w * 0.8, G - h - rh * 0.27],
        [cx, G - h - rh * 0.1],
      ],
      "#8e8e93",
    );
    needle(cx, G - h - rh - 90, 90, 10, "#2c2c2e");
  };
  const sail = (x, w, h) => {
    const f = "#5e5e63";
    poly(
      [
        [x, G],
        [x, G - h * 0.55],
        [x + w * 0.38, G - h],
        [x + w, G - h * 0.82],
        [x + w, G],
      ],
      f,
    );
    poly(
      [
        [x + w * 0.38, G - h],
        [x + w, G - h * 0.82],
        [x + w, G],
      ],
      "#7c7c82",
    );
    win(x, G - h, w, h, "wg");
    poly(
      [
        [x, G - h * 0.55],
        [x + w * 0.38, G - h],
        [x + w, G - h * 0.82],
        [x + w, G - h * 0.74],
        [x + w * 0.38, G - h * 0.93],
        [x, G - h * 0.48],
      ],
      "#a7a7ad",
    );
    mullions(x, G - h, w, h, w / 9, "rgba(255,255,255,.1)");
    sheen(x, G - h * 0.8, w, h * 0.8);
    needle(x + w * 0.38, G - h - 110, 110, 8, "#2c2c2e");
    const ey = G - h + h * 0.18 * ((0.78 - 0.38) / 0.62);
    needle(x + w * 0.78, ey - 60, 60, 6, "#2c2c2e");
  };
  const twin = (x, w, h) => {
    const f = "#6c6c72",
      tw = w * 0.42;
    [x, x + w - tw].forEach((bx, i) => {
      const bh = h - i * 40;
      rect(bx, G - bh, tw, bh, f);
      win(bx, G - bh, tw, bh, "wd");
      shade(bx, G - bh, tw, bh);
      lit(bx, G - bh, tw, bh);
      rect(bx + tw * 0.2, G - bh - 20, tw * 0.6, 20, f);
      needle(bx + tw / 2, G - bh - 120, 100, tw * 0.3, f);
    });
    rect(x + tw, G - h * 0.55, w - 2 * tw, h * 0.55, "#5e5e63");
    win(x + tw, G - h * 0.55, w - 2 * tw, h * 0.55, "wd");
  };
  const stepped = (x, w, h) => {
    const f = "#48484a";
    rect(x, G - h, w, h, f);
    win(x, G - h, w, h, "wd");
    floors(x, G - h, w, h, 16, "rgba(255,255,255,.06)");
    shade(x, G - h, w, h);
    lit(x, G - h, w, h);
    rect(x + w * 0.12, G - h - 18, w * 0.76, 18, f);
    rect(x + w * 0.3, G - h - 34, w * 0.4, 16, f);
    rect(x + w * 0.44, G - h - 60, w * 0.12, 26, "#6c6c72");
  };
  const drum = (x, w, h) => {
    const f = "#6c6c72";
    rect(x, G - h, w, h, f, 'rx="14"');
    win(x, G - h, w, h, "wg");
    mullions(x, G - h, w, h, w / 8, "rgba(255,255,255,.14)");
    sheen(x, G - h, w, h);
    rect(x + w * 0.6, G - h, w * 0.4, h, "rgba(255,255,255,.14)", 'rx="14"');
    rect(x, G - h, w * 0.12, h, "rgba(0,0,0,.14)", 'rx="12"');
    rect(x + w * 0.1, G - h - 12, w * 0.8, 12, "#5e5e63", 'rx="6"');
  };
  const plain = (x, w, h, f) => {
    rect(x, G - h, w, h, f);
    win(x, G - h, w, h, "wd");
    floors(x, G - h, w, h, 17, "rgba(255,255,255,.05)");
    shade(x, G - h, w, h);
    lit(x, G - h, w, h);
    roof(x, G - h, w, f);
  };
  plain(80, 110, 200, ink[0]);
  plain(250, 150, 300, ink[1]);
  plain(470, 130, 250, ink[0]);
  glass(620, 120, 280);
  twin(760, 150, 340);
  deco(900, 220, 420);
  plain(1120, 90, 320, ink[2]);
  glass(1220, 210, 470);
  plain(1420, 140, 330, ink[0]);
  pyramid(1560, 190, 300);
  plain(1760, 150, 290, ink[1]);
  sail(1950, 210, 400);
  plain(2170, 130, 270, ink[0]);
  stepped(2320, 180, 340);
  plain(2500, 100, 240, ink[1]);
  drum(2640, 150, 280);
  plain(2790, 120, 250, ink[0]);
  // foreground low rooftops
  for (let x = -10; x < W; x += ri(60, 140)) {
    const h = ri(40, 130),
      w = ri(60, 160);
    rect(x, G - h, w, h, "#3a3a3c");
    win(x, G - h, w, h, "wd");
    shade(x, G - h, w, h);
    lit(x, G - h, w, h);
    if (rnd() < 0.6) roof(x, G - h, w, "#3a3a3c");
  }
  const litPat = (id) => {
    let r = "";
    for (let i = 0; i < 6; i++)
      r += `<rect x="${ri(0, 9) * 12 + 3.5}" y="${ri(0, 7) * 16 + 4}" width="5" height="8" fill="rgba(255,255,255,${(0.3 + rnd() * 0.3).toFixed(2)})"/>`;
    return `<pattern id="${id}" width="120" height="128" patternUnits="userSpaceOnUse">${r}</pattern>`;
  };
  const pat = (id, w, h, rw, rh, o) =>
    `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"><rect x="${(w - rw) / 2}" y="${(h - rh) / 2}" width="${rw}" height="${rh}" fill="rgba(255,255,255,${o})"/></pattern>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${G}" width="${W}" height="${G}"><defs>${pat("wb", 12, 16, 5, 7, 0.35)}${pat("wm", 14, 18, 6, 8, 0.3)}${pat("wd", 12, 16, 5, 8, 0.16)}${pat("wg", 10, 12, 8, 9, 0.1)}<linearGradient id="lf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></linearGradient><linearGradient id="df" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".26"/></linearGradient>${litPat("l1")}${litPat("l2")}<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".45"/></linearGradient></defs>${out.join("")}<rect x="0" y="${G * 0.55}" width="${W}" height="${G * 0.45}" fill="url(#haze)"/></svg>`;
}

const out = "public/assets/intro-skyline.svg";
const svg = buildSkyline();
writeFileSync(out, svg);
console.log(`wrote ${out} — ${svg.length} bytes`);
