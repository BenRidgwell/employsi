import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

// Portals the hover callout to document.body in fixed, viewport-relative
// coordinates instead of leaving it absolutely positioned inside the chart
// box. The company card is a scrollable, clipped container, and the callout
// can need to render above the chart's own header row (e.g. scrubbing a
// high point near the top of the plotted range) — inside the card that row
// ends up painted over the callout, hiding it. Escaping to a body-level
// portal guarantees it always renders on top, unclipped.
//
// Escaping the card does not escape the VIEWPORT, though, so the callout is
// also measured and kept inside it: pushed back in from a left or right edge,
// and flipped below the point when there is no room above. Both need the
// rendered size, which is why this measures itself rather than guessing.

/** Vertical gap between the point and the callout. Keep in step with the
 *  transforms on .wttip / .wttipbelow in global.css. */
const GAP = 14;
/** Smallest gap left between the callout and a viewport edge. */
const EDGE = 8;
/** How far the .ccflag stem may slide from the callout's centre before it
 *  would leave the rounded body. */
const STEM_INSET = 14;

// useLayoutEffect warns when React renders on the server, and this app SSRs.
// The measurement only ever matters on the client — the callout returns null
// until it has a live chart box to measure against.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ChartTooltip({
  boxRef,
  leftPct,
  topPct,
  className,
  children,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  leftPct: number;
  topPct: number;
  /** Extra class for a per-chart variant, e.g. the company card's solid flag.
   *  The base .wttip look stays the default so the workforce and financial
   *  charts are unaffected. */
  className?: string;
  children: ReactNode;
}) {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // No dependency array: the callout's size changes as the scrub moves through
  // values of different widths. Re-measuring every render is safe because the
  // setter bails out when nothing moved, so this cannot loop.
  useIsoLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((s) =>
      Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5
        ? s
        : { w: r.width, h: r.height },
    );
  });

  const box = boxRef.current;
  if (!box) return null;
  const rect = box.getBoundingClientRect();
  const pointX = rect.left + (leftPct / 100) * rect.width;
  const pointY = rect.top + (topPct / 100) * rect.height;

  // On the very first frame the size is still 0, so every clamp below is a
  // no-op and the callout renders centred on the point — then settles once
  // the layout effect has measured it.
  const half = size.w / 2;
  const min = half + EDGE;
  const max = window.innerWidth - half - EDGE;
  // A callout wider than the viewport has no valid position; leave it on the
  // point rather than snapping it to a nonsense one.
  const left = max < min ? pointX : Math.min(Math.max(pointX, min), max);

  // Shifting the body must not take the stem off the point it marks, so the
  // stem moves the opposite way — bounded to stay within the rounded body.
  const room = Math.max(0, half - STEM_INSET);
  const stem = Math.max(-room, Math.min(room, pointX - left));

  // Flip under the point when the callout would clear the top of the viewport.
  const below = size.h > 0 && pointY - GAP - size.h < EDGE;

  return createPortal(
    <div
      ref={tipRef}
      className={`wttip wttipfixed${below ? " wttipbelow" : ""}${className ? " " + className : ""}`}
      style={{ left, top: pointY, "--wttip-stem": `${stem}px` } as CSSProperties}
    >
      {children}
    </div>,
    document.body,
  );
}
