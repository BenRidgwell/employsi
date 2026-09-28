import { useEffect, useRef } from "react";

/**
 * Lets the user move a card (the analyst, career pathways, talent flows,
 * what's trending) around the screen by its title strip, and resize it
 * smaller from its right edge, bottom edge or bottom-right grip.
 *
 * MOVING — THE STRIP, NOT A HANDLE ELEMENT. Each card builds its header
 * differently — a class on one, inline styles on another — so rather than
 * thread a handle ref through four layouts, a move starts anywhere in the top
 * HANDLE_PX of the card that is not itself interactive. Buttons, inputs, links
 * and anything marked role=button/slider keep their own behaviour, so the
 * close button, the search box and the scope chips work exactly as before.
 *
 * MOVED WITH `translate`, NOT `transform`. The cards open with a keyframe
 * (emppop) or a transition that animates `transform`, and a keyframe with
 * fill-mode `both` keeps its last frame applied — an inline transform would be
 * overwritten by it. The individual `translate` property composes with
 * `transform` instead of competing with it.
 *
 * RESIZING — THE DESIGNED SIZE IS THE CEILING. A card can be made narrower or
 * shorter, never larger than its layout makes it: each card's width, height
 * and max-height were chosen for its content, and a card stretched past them
 * would only add empty space. The content adapts through CSS container
 * queries on the cards (global.css, "Resizable cards"), not through anything
 * here — this only sets the box.
 *
 * THE GRIP IS A FIXED ELEMENT OUTSIDE THE CARD. Career pathways and talent
 * flows scroll as a whole, so a grip placed inside them would scroll away
 * with the content; it is appended to <body> and kept on the card's corner.
 * The right edge is not a resize zone on a card that scrolls, because that is
 * where its scrollbar is.
 *
 * Closing is untouched: click-away and other buttons close the card as before,
 * and the offset and size are dropped when it closes, so a card always
 * reopens as the layout draws it. A move or resize suppresses the click it
 * would otherwise end in, so letting go over a role card does not select it.
 */

const HANDLE_PX = 64;
/** How much of the card must stay on screen, so it can always be grabbed back. */
const KEEP_PX = 80;
/** Width of the resize zone along the right and bottom edges. */
const EDGE_PX = 7;
const MIN_W = 300;
const MIN_H = 240;
const INTERACTIVE =
  "button, a, input, textarea, select, label, [role=button], [role=slider], [contenteditable]";

type Op =
  | { kind: "move"; id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | {
      kind: "size";
      id: number;
      sx: number;
      sy: number;
      w: number;
      h: number;
      right: boolean;
      bottom: boolean;
      moved: boolean;
    };

/**
 * `key` re-attaches when a card swaps the element it renders (talent flows
 * shows a different <aside> for its home screen and a picked building).
 */
export function useDraggablePane<T extends HTMLElement>(active: boolean, key?: string) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let x = 0;
    let y = 0;
    let op: Op | null = null;

    // The ceiling: the card as its layout draws it. offsetWidth/Height ignore
    // the opening animation's scale, so a mid-animation read is still exact.
    // Height takes the larger of the drawn height and a CSS max-height, so a
    // card that opens short (career pathways while loading) can still be
    // resized back up to its full designed height.
    const cs = getComputedStyle(el);
    const maxW = el.offsetWidth;
    const maxH = Math.max(el.offsetHeight, parseFloat(cs.maxHeight) || 0);

    // Phones get the cards as full-width sheets (global.css, max-width 680px),
    // where there is nothing to resize them into: no grip, no resize edges.
    const sizable = window.matchMedia("(min-width: 681px)").matches;

    const grip = document.createElement("div");
    grip.className = "panegrip";
    grip.setAttribute("aria-hidden", "true");
    grip.style.zIndex = String((parseInt(cs.zIndex, 10) || 49) + 1);
    if (sizable) document.body.appendChild(grip);
    const placeGrip = () => {
      const r = el.getBoundingClientRect();
      grip.style.left = `${r.right - 18}px`;
      grip.style.top = `${r.bottom - 18}px`;
    };
    placeGrip();
    // Re-placed once the opening animation settles, and on any window resize.
    const settle = window.setTimeout(placeGrip, 320);
    const ro = new ResizeObserver(placeGrip);
    ro.observe(el);
    window.addEventListener("resize", placeGrip);

    const scrolls = () => el.scrollHeight > el.clientHeight + 1;
    const edgeOf = (e: PointerEvent) => {
      if (!sizable) return null;
      const r = el.getBoundingClientRect();
      const right = !scrolls() && r.right - e.clientX <= EDGE_PX;
      const bottom = r.bottom - e.clientY <= EDGE_PX;
      return right || bottom ? { right, bottom } : null;
    };
    const inHandle = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return (
        // Measured in content, not on screen: a card that scrolls as a whole
        // (career pathways, talent flows) must not turn whatever has scrolled
        // under its top edge — the chart's scrubber, say — into a handle.
        e.clientY - r.top + el.scrollTop <= HANDLE_PX &&
        !(e.target instanceof Element && e.target.closest(INTERACTIVE))
      );
    };
    const cursorFor = (edge: { right: boolean; bottom: boolean }) =>
      edge.right && edge.bottom ? "nwse-resize" : edge.right ? "ew-resize" : "ns-resize";
    const hover = (e: PointerEvent) => {
      if (op) return;
      const edge = edgeOf(e);
      el.style.cursor = edge ? cursorFor(edge) : inHandle(e) ? "grab" : "";
    };

    const begin = (e: PointerEvent, next: Op, target: HTMLElement) => {
      op = next;
      target.setPointerCapture(e.pointerId);
      // No text selection while dragging.
      e.preventDefault();
    };
    const downCard = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const edge = edgeOf(e);
      if (edge) {
        const base = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
        begin(e, { kind: "size", ...base, w: el.offsetWidth, h: el.offsetHeight, ...edge }, el);
        return;
      }
      if (!inHandle(e)) return;
      begin(
        e,
        { kind: "move", id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false },
        el,
      );
      el.style.cursor = "grabbing";
    };
    const downGrip = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const base = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
      begin(
        e,
        { kind: "size", ...base, w: el.offsetWidth, h: el.offsetHeight, right: true, bottom: true },
        grip,
      );
    };

    const move = (e: PointerEvent) => {
      if (!op || e.pointerId !== op.id) {
        if (e.currentTarget === el) hover(e);
        return;
      }
      const dx = e.clientX - op.sx;
      const dy = e.clientY - op.sy;
      if (!op.moved && Math.hypot(dx, dy) < 3) return;
      op.moved = true;
      if (op.kind === "size") {
        if (op.right)
          el.style.width = `${Math.round(Math.min(maxW, Math.max(MIN_W, op.w + dx)))}px`;
        if (op.bottom) {
          el.style.height = `${Math.round(Math.min(maxH, Math.max(MIN_H, op.h + dy)))}px`;
          // A card pinned top AND bottom (talent flows) takes its height from
          // those; an explicit height only holds once the bottom is released.
          el.style.bottom = "auto";
        }
        placeGrip();
        return;
      }
      // Clamp against the card's untranslated box so part of it stays on screen.
      const r = el.getBoundingClientRect();
      const bx = r.left - x;
      const by = r.top - y;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      x = Math.min(vw - KEEP_PX - bx, Math.max(KEEP_PX - r.width - bx, op.ox + dx));
      y = Math.min(vh - KEEP_PX - by, Math.max(-by, op.oy + dy));
      el.style.translate = `${x}px ${y}px`;
      placeGrip();
    };
    const up = (e: PointerEvent) => {
      if (!op || e.pointerId !== op.id) return;
      const moved = op.moved;
      const kind = op.kind;
      op = null;
      const t = e.currentTarget as HTMLElement;
      if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId);
      el.style.cursor = kind === "move" ? "grab" : "";
      if (moved) {
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };

    el.addEventListener("pointerdown", downCard);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", hover);
    grip.addEventListener("pointerdown", downGrip);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", downCard);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", hover);
      window.removeEventListener("resize", placeGrip);
      window.clearTimeout(settle);
      ro.disconnect();
      grip.remove();
      // Closed: the next opening is drawn by the layout again.
      el.style.translate = "";
      el.style.cursor = "";
      el.style.width = "";
      el.style.height = "";
      el.style.bottom = "";
    };
  }, [active, key]);

  return ref;
}
