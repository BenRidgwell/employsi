import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Wraps a circular header action button (Compare/Follow/Close) and shows its
// hover label via a body-level portal instead of a CSS-only absolutely
// positioned tooltip. The card is a rounded, overflow:hidden, scrollable
// container, and these buttons sit right at its top edge — a label anchored
// above them pokes past the card's own rounded corner and gets clipped
// instead of floating cleanly above the button (matches the ChartTooltip fix
// for the trend-chart hover callouts).
export function FabWrap({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const rect = hover ? ref.current?.getBoundingClientRect() : null;
  return (
    <div className="pfabwrap" ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {children}
      {rect &&
        createPortal(
          <span className="pfablbl pfablblfixed" style={{ left: rect.left + rect.width / 2, top: rect.top }}>
            {label}
          </span>,
          document.body,
        )}
    </div>
  );
}
