/**
 * Framing the company card's hiring-hotspot map.
 *
 * Lifted out of the component so it can be asserted: this is pure geometry over
 * projected coordinates, with no React in it, and the invariant it has to hold
 * is not visible on screen until exactly the wrong employer opens the card.
 */
import { WORLD_W, WORLD_H } from "../data/worldOutline";

export interface Spot {
  hub: string;
  label: string;
  n: number;
  x: number;
  y: number;
}

/** Smallest span the frame will zoom to, in viewBox units. One hub has no
 *  extent of its own, and without a floor the frame collapses onto it and the
 *  coastline behind becomes an unreadable smear. ~40 units is a country. */
export const FRAME_MIN = 40;
/** Breathing room around the spots, as a share of the framed span. Labels sit
 *  beside their dot and need somewhere to go. */
export const FRAME_PAD = 0.38;
/** The frame's shape. Fixed so the card does not change height when the picker
 *  moves between a one-city skill and a worldwide one. */
export const FRAME_ASPECT = 1.5;

/**
 * Frame the map on the data.
 *
 * The whole world is the wrong view for most employers: BHP's placeable ads sit
 * in four Australian cities and Manila, so a global projection spends nearly
 * all of its area on empty ocean. The path and the projection are unchanged —
 * only the viewBox moves, which costs nothing and keeps every coordinate
 * comparable with the app's other maps.
 */
export function frameFor(spots: Spot[]): { x: number; y: number; w: number; h: number } {
  const xs = spots.map((s) => s.x);
  const ys = spots.map((s) => s.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const padX = Math.max((maxX - minX) * FRAME_PAD, FRAME_MIN / 2);
  const padY = Math.max((maxY - minY) * FRAME_PAD, FRAME_MIN / 2);
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;
  let w = maxX - minX;
  let h = maxY - minY;
  // Grow the short side rather than the long one, so framing never crops a hub.
  if (w / h < FRAME_ASPECT) {
    const want = h * FRAME_ASPECT;
    minX -= (want - w) / 2;
    w = want;
  } else {
    const want = w / FRAME_ASPECT;
    minY -= (want - h) / 2;
    h = want;
  }
  // Keep the frame on the map — by MOVING it, never by resizing it.
  //
  // THIS USED TO SNAP w TO WORLD_W AND h TO WORLD_H, which quietly threw away
  // the aspect the lines above had just established. The world is 360 × 170,
  // an aspect of 2.12; the box it is drawn in is 3/2. So an employer hiring on
  // two continents produced a 2.12 frame inside a 1.50 box, the SVG's default
  // xMidYMid meet letterboxed it, and the two layers of this map stopped
  // agreeing: the blobs are SVG and scale with the viewBox, the dots are HTML
  // and are positioned against the CONTAINER, so every dot slid away from its
  // own heat. The grey bands above and below the sea were the same letterbox.
  //
  // A frame larger than the world is not a problem to solve: the sea simply
  // continues past the coastline, which is what an ocean does, and every hub
  // stays in view. So the size is left alone and only the position moves.
  minX = w <= WORLD_W ? Math.max(0, Math.min(minX, WORLD_W - w)) : (WORLD_W - w) / 2;
  minY = h <= WORLD_H ? Math.max(0, Math.min(minY, WORLD_H - h)) : (WORLD_H - h) / 2;
  return { x: minX, y: minY, w, h };
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Each press of + or −. */
export const ZOOM_STEP = 2;
/**
 * The narrowest span a zoom will show, in viewBox units — roughly a metro area.
 * The cap is expressed as a SPAN rather than as a multiple because the frames
 * differ by an order of magnitude: CSL's is most of the world and BHP's Mining
 * is one country, so a fixed "up to 8×" would be far too little on one and would
 * zoom past the coastline into a flat blue field on the other.
 */
export const FRAME_FLOOR = 12;
/** Never more than this, whatever the arithmetic says — a guard for a frame so
 *  wide that the floor above would allow an absurd multiple. */
export const ZOOM_CAP = 16;

/** The most this frame may be zoomed. 1 when it is already at the floor. */
export function maxZoomFor(base: Frame): number {
  return Math.max(1, Math.min(ZOOM_CAP, base.w / FRAME_FLOOR));
}

export function centreOf(f: Frame): { x: number; y: number } {
  return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
}

/**
 * The frame actually drawn: the base frame, zoomed by `zoom` about `centre`.
 *
 * TWO INVARIANTS, AND BOTH ARE LOAD-BEARING RATHER THAN TIDY.
 *
 * It divides both sides by the same zoom, so the ASPECT IS EXACTLY THE BASE'S.
 * The map draws its heat in SVG against the viewBox and its dots in HTML against
 * the container; those two agree only while the frame's aspect matches the
 * container's, and an aspect that drifted once already slid every dot off its
 * own blob (see the note in frameFor). A zoom that changed the shape of the
 * frame would reintroduce that bug interactively, on a map that looked right
 * when it opened.
 *
 * And the result is CONTAINED IN THE BASE FRAME: panning stops where the
 * default view stops. That is a deliberate limit rather than an omission — the
 * base frame is padded around the hubs, so its edge is already past the last
 * one, and letting a pan continue past it only offers featureless ocean with no
 * way back except the reset.
 */
export function zoomFrame(base: Frame, zoom: number, centre: { x: number; y: number }): Frame {
  const z = Math.max(1, Math.min(maxZoomFor(base), zoom));
  const w = base.w / z;
  const h = base.h / z;
  return {
    x: Math.max(base.x, Math.min(centre.x - w / 2, base.x + base.w - w)),
    y: Math.max(base.y, Math.min(centre.y - h / 2, base.y + base.h - h)),
    w,
    h,
  };
}
