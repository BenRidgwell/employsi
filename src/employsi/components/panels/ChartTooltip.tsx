import { createPortal } from 'react-dom';
import type { ReactNode, RefObject } from 'react';

// Portals the hover callout to document.body in fixed, viewport-relative
// coordinates instead of leaving it absolutely positioned inside the chart
// box. The company card is a scrollable, clipped container, and the callout
// can need to render above the chart's own header row (e.g. scrubbing a
// high point near the top of the plotted range) — inside the card that row
// ends up painted over the callout, hiding it. Escaping to a body-level
// portal guarantees it always renders on top, unclipped.
export function ChartTooltip({
  boxRef,
  leftPct,
  topPct,
  children,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  leftPct: number;
  topPct: number;
  children: ReactNode;
}) {
  const box = boxRef.current;
  if (!box) return null;
  const rect = box.getBoundingClientRect();
  const left = rect.left + (leftPct / 100) * rect.width;
  const top = rect.top + (topPct / 100) * rect.height;
  return createPortal(
    <div className="wttip wttipfixed" style={{ left, top }}>
      {children}
    </div>,
    document.body,
  );
}
