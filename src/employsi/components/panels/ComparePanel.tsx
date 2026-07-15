import { useAppStore } from '../../state/store';
import { buildCompareRadar } from '../../lib/radar';
import { COMPANIES } from '../../data/companies';

export function ComparePanel() {
  const compareOpen = useAppStore((s) => s.compareOpen);
  const compareA = useAppStore((s) => s.compareA);
  const compareB = useAppStore((s) => s.compareB);
  const setCompareA = useAppStore((s) => s.setCompareA);
  const setCompareB = useAppStore((s) => s.setCompareB);
  const closeCompare = useAppStore((s) => s.closeCompare);

  const data = compareOpen ? buildCompareRadar(compareA, compareB) : null;

  return (
    <>
      <div className={`pbackdrop ${compareOpen ? 'open' : ''}`} onClick={closeCompare} />
      <aside className={`cxpanel ${compareOpen ? 'open' : ''}`}>
        <button className="cxclose" onClick={closeCompare} aria-label="Close">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="cxscroll">
          <div className="cxhead">
            <div className="cxtitle">Compare employers</div>
          </div>
          {data && (
            <>
              <div className="cxselectors">
                <div className="cxsel">
                  <span className="cxswatch cxswatch-a" />
                  <select className="cxselect" value={compareA ?? ''} onChange={(e) => setCompareA(e.target.value)}>
                    {COMPANIES.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <span className="cxvs">vs</span>
                <div className="cxsel">
                  <span className="cxswatch cxswatch-b" />
                  <select className="cxselect" value={compareB ?? ''} onChange={(e) => setCompareB(e.target.value)}>
                    {COMPANIES.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="cxradarwrap">
                <div className="cxradarstack">
                  <svg className="cxradar" viewBox="0 0 200 208">
                    {data.axes.map((ax, i) => (
                      <path key={i} d={ax.line} stroke="var(--line)" strokeWidth={1} />
                    ))}
                    <polygon points={data.aPoly} className="cxpoly-a" />
                    <polygon points={data.bPoly} className="cxpoly-b" />
                    {data.pointsA.map((p, i) => (
                      <circle key={i} cx={p.cx} cy={p.cy} r={2.6} className="cxdot-a" />
                    ))}
                    {data.pointsB.map((p, i) => (
                      <circle key={i} cx={p.cx} cy={p.cy} r={2.6} className="cxdot-b" />
                    ))}
                  </svg>
                  {data.axes.map((ax, i) => (
                    <span key={i} className="cxaxislabel" style={{ left: `${ax.leftPct}%`, top: `${ax.topPct}%` }}>
                      {ax.label}
                    </span>
                  ))}
                  {data.pointsA.map((p, i) => (
                    <span key={i} className="cxvallabel cxvallabel-a" style={{ left: `${p.leftPct}%`, top: `${p.topPct}%` }}>
                      {p.val}
                    </span>
                  ))}
                  {data.pointsB.map((p, i) => (
                    <span key={i} className="cxvallabel cxvallabel-b" style={{ left: `${p.leftPct}%`, top: `${p.topPct}%` }}>
                      {p.val}
                    </span>
                  ))}
                </div>
              </div>
              <div className="cxlegend">
                <div className="cxlegitem">
                  <span className="cxswatch cxswatch-a" />
                  {data.aTicker} · {data.aName}
                </div>
                <div className="cxlegitem">
                  <span className="cxswatch cxswatch-b" />
                  {data.bTicker} · {data.bName}
                </div>
              </div>
              <div className="cxrows">
                {data.rows.map((r, i) => (
                  <div className="cxrow" key={i}>
                    <span className="cxrowa">{r.a}</span>
                    <span className="cxrowlabel">{r.label}</span>
                    <span className="cxrowb">{r.b}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
