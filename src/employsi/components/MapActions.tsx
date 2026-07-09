import { useAppStore } from '../state/store';

// Two animated quick-action buttons that sit on the left rail, just above the
// layer guide, on the domestic and global (zoomed-out) map views.
export function MapActions() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const toggleBrief = useAppStore((s) => s.toggleBrief);
  const briefOpen = useAppStore((s) => s.briefOpen);
  if (!zoomedOut) return null;

  return (
    <div className="mapactions">
      <div className="marow">
        <button className="mabtn" type="button" aria-label="What's trending">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <g className="flameicon">
              <path d="M12 3c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.8.8-3 1.9-4.1C10.6 8.1 11.5 6.2 12 3Z" />
              <path className="flameember" d="M12 10.5c.8 1.3 1.6 2 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1.1.8-1.8 1.6-3.1Z" />
            </g>
          </svg>
        </button>
        <span className="malabel">What's trending</span>
      </div>

      <div className="marow">
        <button className={`mabtn ${briefOpen ? 'on' : ''}`} type="button" aria-label="Daily brief" onClick={toggleBrief}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {/* newspaper */}
            <path d="M4 5.6A1.1 1.1 0 0 1 5.1 4.5h7.3a1.1 1.1 0 0 1 1.1 1.1V15H5.1A1.1 1.1 0 0 1 4 13.9V5.6Z" />
            <path d="M6.4 7.6h4.8M6.4 10h4.8M6.4 12.4h3" />
            {/* coffee cup */}
            <path d="M13.6 15.4h4.6v1.6a2 2 0 0 1-2 2h-.6a2 2 0 0 1-2-2v-1.6Z" />
            <path d="M18.2 15.9h.5a1.1 1.1 0 0 1 0 2.2h-.2" />
            <g className="briefsteam">
              <path d="M15 14c.5-.6-.4-1.1 0-1.8" />
              <path d="M16.8 14c.5-.6-.4-1.1 0-1.8" />
            </g>
          </svg>
        </button>
        <span className="malabel">Daily brief</span>
      </div>
    </div>
  );
}
