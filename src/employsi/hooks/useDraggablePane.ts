import { useEffect, useRef } from "react";

/**
 * Lets the user drag a card (the analyst, career pathways, talent flows,
 * what's trending) around the screen by its title strip.
 *
 * THE STRIP, NOT A HANDLE ELEMENT. Each card builds its header differently —
 * a class on one, inline styles on another — so rather than thread a handle
 * ref through four layouts, a drag starts anywhere in the top HANDLE_PX of the
 * card that is not itself interactive. Buttons, inputs, links and anything
 * marked role=button/slider keep their own behaviour, so the close button, the
 * search box and the scope chips work exactly as before.
 *
 * MOVED WITH `translate`, NOT `transform`. The cards open with a keyframe
 * (emppop) or a transition that animates `transform`, and a keyframe with
 * fill-mode `both` keeps its last frame applied — an inline transform would be
 * overwritten by it. The individual `translate` property composes with
 * `transform` instead of competing with it.
 *
 * Closing is untouched: click-away scrims and other buttons close the card as
 * before, and the offset is dropped when it closes, so a card always reopens
 * where the layout puts it. A drag that moved suppresses the click it would
 * otherwise end in, so letting go over a role card does not select it.
 */

const HANDLE_PX = 64;
/** How much of the card must stay on screen, so it can always be grabbed back. */
const KEEP_PX = 80;
const INTERACTIVE =
  "button, a, input, textarea, select, label, [role=button], [role=slider], [contenteditable]";

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
    let drag: {
      id: number;
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      moved: boolean;
    } | null = null;

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
    const hover = (e: PointerEvent) => {
      if (!drag) el.style.cursor = inHandle(e) ? "grab" : "";
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !inHandle(e)) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
      // No text selection while dragging a title.
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return hover(e);
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      // Clamp against the card's untranslated box so part of it stays on screen.
      const r = el.getBoundingClientRect();
      const bx = r.left - x;
      const by = r.top - y;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      x = Math.min(vw - KEEP_PX - bx, Math.max(KEEP_PX - r.width - bx, drag.ox + dx));
      y = Math.min(vh - KEEP_PX - by, Math.max(-by, drag.oy + dy));
      el.style.translate = `${x}px ${y}px`;
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      el.style.cursor = "grab";
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (moved) {
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", hover);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", hover);
      // Closed: the next opening starts where the layout puts it.
      el.style.translate = "";
      el.style.cursor = "";
    };
  }, [active, key]);

  return ref;
}
