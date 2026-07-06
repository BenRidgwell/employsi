import { useAppStore } from '../../state/store';
import { buildPanel } from '../../lib/panel';

export function CompanyPanel() {
  const selectedId = useAppStore((s) => s.selectedId);
  const lastId = useAppStore((s) => s.lastId);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompare = useAppStore((s) => s.openCompare);

  const panel = buildPanel(lastId);
  const open = !!selectedId;

  return (
    <>
      <div className={`pbackdrop ${open ? 'open' : ''}`} onClick={closePanel} />
      <aside className={`panel ${open ? 'open' : ''}`}>
        <div className="pscroll">
          {panel && (
            <>
              <div className="phead">
                <div className="pbadge">{panel.ticker}</div>
                <div>
                  <div className="pname">{panel.name}</div>
                  <div className="psector">{panel.sector}</div>
                </div>
                <button className="pcompare" onClick={() => openCompare(panel.companyId)}>Compare</button>
                <button className="pclose" onClick={closePanel}>✕</button>
              </div>
              <div className="pnote">
                <i />
                {panel.note}
              </div>
              <div className="bigs">
                {panel.bigStats.map((s, i) => (
                  <div className="bigc" key={i}>
                    <div className="bigv">{s.value}</div>
                    <div className="bigl">{s.label}</div>
                    <div className={`bigsub ${s.subCls}`}>{s.sub}</div>
                  </div>
                ))}
              </div>
              <div className="sect">
                <div className="secth">
                  Workforce trend
                  <span>{panel.trendLabel}</span>
                </div>
                <div className="trendbox">
                  <svg className="trendsvg" viewBox="0 0 188 52" preserveAspectRatio="none">
                    <path d={panel.trendArea} fill="rgba(28,28,30,.12)" />
                    <path d={panel.trendLine} fill="none" stroke="#1c1c1e" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="subs">
                  {panel.subStats.map((s, i) => (
                    <div className="subc" key={i}>
                      <div className="subv">{s.value}</div>
                      <div className="subl">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sect">
                <div className="secth">{panel.skillsLabel}</div>
                <div className="skills">
                  {panel.skills.map((sk) => (
                    <span className="skill" key={sk}>{sk}</span>
                  ))}
                </div>
              </div>
              <div className="sect">
                <div className="secth">
                  Where they're hiring
                  <span>open roles by area</span>
                </div>
                <div className="roles">
                  {panel.roles.map((r) => (
                    <div className="role" key={r.title}>
                      <span className="rolet">{r.title}</span>
                      <span className="rolebar">
                        <span className="rolefill" style={{ width: r.pct }} />
                      </span>
                      <span className="rolec">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="cta">{panel.cta}</button>
              <div className="foot">Illustrative data · Perth metro · {panel.name}</div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
