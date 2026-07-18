import { useAppStore } from '../state/store';

export function ZoomSlider() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const selectedId = useAppStore((s) => s.selectedId);
  const setZoomLevel = useAppStore((s) => s.setZoomLevel);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompanyLayer = useAppStore((s) => s.openCompanyLayer);

  // Four layers, deepest last. A company card open is the deepest ("company")
  // layer and takes precedence; otherwise zoomedOut/globalOut pick the map tier.
  const companyOpen = selectedId != null;
  const layer = companyOpen ? 'company' : !zoomedOut ? 'local' : globalOut ? 'global' : 'domestic';

  // Navigating to a map tier closes any open company card first.
  const goTo = (n: 0 | 1 | 2) => {
    if (companyOpen) closePanel();
    setZoomLevel(n);
  };

  return (
    <div className="zoomslider">
      <div className="zrow">
        <button className={`zstep ${layer === 'global' ? 'on' : ''}`} onClick={() => goTo(2)}>
          <svg className="zi-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
          </svg>
        </button>
        <span className="zlabel">Global</span>
      </div>
      <div className="ztrack" />
      <div className="zrow">
        <button className={`zstep ${layer === 'domestic' ? 'on' : ''}`} onClick={() => goTo(1)}>
          <svg className="zi-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
            <circle cx="12" cy="9" r="2.4" />
          </svg>
        </button>
        <span className="zlabel">Domestic</span>
      </div>
      <div className="ztrack" />
      <div className="zrow">
        <button className={`zstep ${layer === 'local' ? 'on' : ''}`} onClick={() => goTo(0)}>
          <svg className="zi-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <rect x="4" y="10" width="4" height="10" />
            <rect x="10" y="6" width="4" height="14" />
            <rect x="16" y="12" width="4" height="8" />
          </svg>
        </button>
        <span className="zlabel">Local</span>
      </div>
      <div className="ztrack" />
      <div className="zrow">
        <button className={`zstep ${layer === 'company' ? 'on' : ''}`} onClick={openCompanyLayer}>
          <svg className="zi-co" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
            <rect x="6" y="3" width="12" height="18" rx="1" />
            <path d="M9.5 7h1.5M13 7h1.5M9.5 11h1.5M13 11h1.5M9.5 15h1.5M13 15h1.5" />
            <path d="M10.5 21v-3h3v3" />
          </svg>
        </button>
        <span className="zlabel">Company</span>
      </div>
    </div>
  );
}
