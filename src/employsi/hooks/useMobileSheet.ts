import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
type Phase = "closed" | "entering" | "open" | "exiting";

/** Must match the transition below, so the pane unmounts as the slide ends. */
const EXIT_MS = 300;

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
   * THE ENTRANCE AND EXIT — the sheet rises from below and sinks back, rather
   * than appearing and vanishing at peek.
   *
   * Neither can be a CSS animation. The detent is driven by an inline
   * transform, and an animation outranks an inline style in the cascade, so
   * animating `transform` here pins the sheet wherever the last keyframe says
   * and no drag can move it afterwards (that exact bug shipped once already).
   * Both are TRANSITIONS between two inline values instead.
   *
   * `translateY(100%)` is the far end because it needs no measurement — 100%
   * of the element's own height is exactly "fully below its own box", whatever
   * that height turns out to be.
   *
   * The sheet outlives `open` by one animation, so it needs its own phase.
   *
   *   closed → entering → open → exiting → closed
   *
   * `exiting` is the reason this is a phase and not a boolean: on the way out
   * the pane has to STAY MOUNTED while it slides back down, and the store flag
   * that owns it has already gone false. `visible` below is what the panes
   * render on instead — Analyst and Filter return null on it, and Trending
   * (which never unmounts) keeps its `.open` class from it, so its opacity
   * holds until the slide finishes rather than blinking out at the start.
   */
  const [phase, setPhase] = useState<Phase>("closed");

  useEffect(() => {
    if (!enabled) {
      // Desktop has no entrance to play; the phase just mirrors the flag so
      // `visible` stays exactly as truthful as `open`.
      setPhase(open ? "open" : "closed");
      return;
    }
    // Re-opening part-way through an exit restarts the entrance, rather than
    // stranding the sheet mid-slide.
    setPhase((p) => (open ? "entering" : p === "closed" ? "closed" : "exiting"));
  }, [enabled, open]);

  // entering → open, once the start value has been painted and the height is
  // known. Two frames: the browser must paint `translateY(100%)` before the
  // resting offset can transition from it.
  useEffect(() => {
    if (!enabled || phase !== "entering" || height <= 0) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase("open"));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [enabled, phase, height]);

  // exiting → closed, once the slide has had time to run. A timer rather than
  // `transitionend`: that event does not fire if the sheet is already at the
  // position it is animating to, which would leave the pane mounted for good.
  useEffect(() => {
    if (phase !== "exiting") return;
    const id = window.setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  const visible = enabled ? phase !== "closed" : open;

  /**
   * The sheet's own height, measured rather than assumed — peek is
   * `height - PEEK_HEIGHT`, so nothing can be positioned without it.
   *
   * KEYED ON `phase`, NOT `open`. Analyst and Filter render nothing until
   * `visible` is true, and `visible` only becomes true once the phase has
   * moved to `entering` — one render AFTER `open` flipped. An effect keyed on
   * `open` therefore ran while the pane was still unmounted, measured a null
   * ref as 0, and never ran again: height stayed 0, the promotion to `open`
   * below waits on a real height, and both sheets sat in `entering` at
   * `translateY(100%)` for as long as they were "open". Trending hid the bug
   * completely, because it never unmounts and so always had a node to measure.
   *
   * Layout effect rather than effect: measuring after paint means one frame
   * drawn at the wrong offset.
   */
  useLayoutEffect(() => {
    if (!enabled || phase === "closed") return;
    const measure = () => setHeight(ref.current?.offsetHeight ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, phase]);

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

  /**
   * The resting offset. Deliberately NOT gated on `open`.
   *
   * It used to read `enabled && open ? offsetFor(detent) : 0`, which put a
   * hole in the exit: on the single render where `open` has gone false but
   * the phase has not yet caught up to `exiting`, that ternary collapsed to
   * 0 — the FULL position — so the sheet snapped up to full height and was
   * unmounted before the slide could start. `offset` is only ever read while
   * the phase is "open", so it has no business consulting `open` itself.
   */
  const offset = drag ?? offsetFor(detent);

  return {
    enabled,
    detent,
    /** Render the pane while this is true — it stays true through the exit. */
    visible,
    dragging: drag !== null,
    /**
     * Spread onto the pane's root element.
     *
     * NOTHING IS WRITTEN WHILE CLOSED. Trending's pane stays mounted when it
     * is shut — it hides itself with `opacity: 0` on `.briefpane:not(.open)`
     * rather than unmounting, unlike Analyst and Filter which return null. An
     * inline `transform: translateY(0)` on a closed pane is the FULL position,
     * so it parked the closed card over the map; leaving the style off hands
     * the closed state back to the CSS that owns it.
     */
    sheetProps:
      enabled && visible
        ? {
            ref,
            style: {
              // At rest only while genuinely open; below its own box both
              // before the entrance and during the exit.
              transform: phase === "open" ? `translateY(${offset}px)` : "translateY(100%)",
              // `entering` is the one phase with no transition: that first
              // value has to be PAINTED, not animated to, or the entrance has
              // nothing to travel from. `exiting` keeps it — that IS the slide.
              transition:
                drag !== null || phase === "entering"
                  ? "none"
                  : `transform ${EXIT_MS}ms cubic-bezier(0.32,0.72,0,1)`,
            } as React.CSSProperties,
            "data-detent": detent,
            "data-phase": phase,
          }
        : { ref },
    /** Spread onto the grab handle and the sheet header — chrome, never the
     *  scrolling body, so the body's own scrolling is untouched. */
    dragProps: enabled ? { onPointerDown } : {},
    /** Tap the handle to step between the two open positions. */
    toggleDetent: () => setDetent((d) => (d === "peek" ? "full" : "peek")),
  };
}
