import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The phone sheet's drag behaviour: a Google-Maps-style card with three
 * positions rather than one.
 *
 *   closed  →  peek (a snapshot, map still readable)  →  full
 *
 * Swipe up from peek to fill the screen; swipe down from full to return to
 * peek; swipe down again from peek to dismiss. Tapping the tab still opens
 * and closes it outright, and the handle is a button that steps between the
 * two open positions — so the drag is the nice way to do this, never the only
 * way.
 *
 * WHY A HOOK AND NOT A WRAPPER COMPONENT. Trending, Analyst and Filter each
 * own their root element and the CSS that positions it. Wrapping them would
 * add a DOM level between the pane and those rules and quietly break the
 * geometry; spreading props onto the roots they already render does not.
 *
 * PHONES ONLY. Above 680px the panes are docked panels with no drag affordance
 * at all: `enabled` is false, no listener is attached and no transform is
 * written.
 */

export type Detent = "peek" | "full";

/** How much of the sheet the peek position leaves on screen, in px. */
const PEEK_HEIGHT = 224;
/** Past this speed (px/ms) a flick wins over whichever position is nearest. */
const FLICK = 0.45;
/** Ignore sub-pixel jitter so a tap on the handle is never read as a drag. */
const DRAG_SLOP = 3;

interface Options {
  open: boolean;
  onClose: () => void;
}

export function useMobileSheet({ open, onClose }: Options) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [detent, setDetent] = useState<Detent>("peek");
  const [drag, setDrag] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 680px)");
    const sync = () => setEnabled(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Every fresh open starts at peek — the whole point of the position is that
  // it is what you get before asking for more.
  useEffect(() => {
    if (open) setDetent("peek");
  }, [open]);

  /**
   * The sheet's own height, measured rather than assumed.
   *
   * It has to be held in state: on the first render after opening,
   * `ref.current` is still null, so an offset computed then comes out 0 —
   * which is the FULL position. Every sheet opened filling the screen and
   * only fell back to peek if something else happened to re-render it.
   */
  useEffect(() => {
    if (!enabled || !open) return;
    const measure = () => setHeight(ref.current?.offsetHeight ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, open]);

  const offsetFor = useCallback(
    (d: Detent) => {
      const h = ref.current?.offsetHeight || height;
      return d === "full" ? 0 : Math.max(0, h - PEEK_HEIGHT);
    },
    [height],
  );

  /**
   * What the in-flight gesture needs to read, refreshed every render.
   *
   * The move/up handlers live on `window` for the life of one drag (see
   * onPointerDown), so they are closures created once at pointerdown. Reading
   * `detent`/`drag` directly out of that closure would pin them to their
   * values at the moment the finger landed. This ref is how they see now.
   */
  const latest = useRef({ detent, drag, offsetFor, onClose });
  latest.current = { detent, drag, offsetFor, onClose };

  /**
   * WINDOW LISTENERS, NOT POINTER CAPTURE.
   *
   * The obvious implementation puts onPointerMove/onPointerUp on the same
   * element as onPointerDown and calls setPointerCapture so the events keep
   * coming once the finger leaves that element. Measured here, that loses the
   * gesture after a single move: the capture does not survive the re-render
   * that the first setDrag triggers, and every later event goes to whatever
   * is under the pointer instead. The sheet moved 30px and stopped.
   *
   * Binding to window for the duration of the drag has no such dependency —
   * it is the same reason drag implementations have used document-level
   * listeners since long before pointer capture existed.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!enabled || !open) return;
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startOffset = latest.current.drag ?? latest.current.offsetFor(latest.current.detent);
    let active = false;
    let lastY = startY;
    let lastT = e.timeStamp;
    let velocity = 0;
    let offset = startOffset;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dy = ev.clientY - startY;
      if (!active) {
        if (Math.abs(dy) < DRAG_SLOP) return;
        active = true;
      }
      const dt = ev.timeStamp - lastT;
      if (dt > 0) velocity = (ev.clientY - lastY) / dt;
      lastY = ev.clientY;
      lastT = ev.timeStamp;

      const h = ref.current?.offsetHeight || 0;
      const next = startOffset + dy;
      // Rubber-band past the top: there is nothing above "full" to reach.
      offset = next < 0 ? Math.max(next / 4, -40) : Math.min(next, h || next);
      setDrag(offset);
      // Stops the page itself scrolling under a drag that is ours.
      if (ev.cancelable) ev.preventDefault();
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      // Never moved: leave it be, so a tap on the handle stays a tap.
      if (!active) return;

      // SWALLOW THE CLICK THIS DRAG IS ABOUT TO PRODUCE.
      //
      // The handle is a button (tapping it steps between the two positions),
      // and a drag that starts on it still ends in a click — so every
      // successful drag was immediately undone by the toggle that click
      // fired. Measured: the sheet reached `full`, then the click flipped it
      // straight back to `peek`, which read exactly like the drag not working.
      // `once` takes the listener off after it eats that click; the timeout
      // is there for the drag that ends without producing one.
      const swallow = (ce: Event) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 400);

      const { offsetFor: off, onClose: close } = latest.current;
      const peekOffset = off("peek");
      const h = ref.current?.offsetHeight || 0;

      // A flick beats proximity: it says where the user is going, not where
      // they happened to let go.
      if (velocity > FLICK) {
        if (latest.current.detent === "full" && offset < peekOffset + PEEK_HEIGHT / 2) {
          setDetent("peek");
        } else {
          close();
        }
        return;
      }
      if (velocity < -FLICK) {
        setDetent("full");
        return;
      }

      // Otherwise snap to whichever of the three positions is nearest.
      const stops: Array<{ d: Detent | "closed"; y: number }> = [
        { d: "full", y: 0 },
        { d: "peek", y: peekOffset },
        { d: "closed", y: h },
      ];
      const nearest = stops.reduce((a, b) =>
        Math.abs(b.y - offset) < Math.abs(a.y - offset) ? b : a,
      );
      if (nearest.d === "closed") close();
      else setDetent(nearest.d);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const offset = drag ?? (enabled && open ? offsetFor(detent) : 0);

  return {
    enabled,
    detent,
    dragging: drag !== null,
    /** Spread onto the pane's root element. */
    sheetProps: enabled
      ? {
          ref,
          style: {
            transform: `translateY(${offset}px)`,
            transition: drag !== null ? "none" : "transform 320ms cubic-bezier(0.32,0.72,0,1)",
          } as React.CSSProperties,
          "data-detent": detent,
        }
      : { ref },
    /** Spread onto the grab handle and the sheet header — chrome, never the
     *  scrolling body, so the body's own scrolling is untouched. */
    dragProps: enabled ? { onPointerDown } : {},
    /** Tap the handle to step between the two open positions. */
    toggleDetent: () => setDetent((d) => (d === "peek" ? "full" : "peek")),
  };
}
