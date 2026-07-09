import { useAppStore } from '../state/store';

export function ZoomSlider() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const setZoomLevel = useAppStore((s) => s.setZoomLevel);

  const level = globalOut ? 2 : zoomedOut ? 1 : 0;

  return (
    <div className="zoomslider">
      <div className="zrow">
        <button className={`zstep ${level === 2 ? 'on' : ''}`} onClick={() => setZoomLevel(2)}>
          <svg className="zi-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
          </svg>
        </button>
        <span className="zlabel">Global</span>
      </div>
      <div className="ztrack" />
      <div className="zrow">
        <button className={`zstep ${level === 1 ? 'on' : ''}`} onClick={() => setZoomLevel(1)}>
          <svg className="zi-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
            <circle cx="12" cy="9" r="2.4" />
          </svg>
        </button>
        <span className="zlabel">Domestic</span>
      </div>
      <div className="ztrack" />
      <div className="zrow">
        <button className={`zstep ${level === 0 ? 'on' : ''}`} onClick={() => setZoomLevel(0)}>
          <svg className="zi-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <rect x="4" y="10" width="4" height="10" />
            <rect x="10" y="6" width="4" height="14" />
            <rect x="16" y="12" width="4" height="8" />
          </svg>
        </button>
        <span className="zlabel">Local</span>
      </div>
    </div>
  );
}
