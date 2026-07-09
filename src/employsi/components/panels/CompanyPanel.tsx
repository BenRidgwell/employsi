import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { buildPanel } from '../../lib/panel';
import { TrendChart } from './TrendChart';

function CompanyLogo({ domain, ticker }: { domain: string; ticker: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="pbadge">
      {failed ? (
        <span className="pbadgetxt">{ticker}</span>
      ) : (
        <img className="pbadgeimg" src={`https://logo.clearbit.com/${domain}?size=104`} alt={ticker} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

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
                <CompanyLogo domain={panel.domain} ticker={panel.ticker} />
                <div>
                  <div className="pname">{panel.name}</div>
                  <div className="psector">{panel.sector}</div>
                </div>
                <button className="pcompare" onClick={() => openCompare(panel.companyId)}>Compare</button>
                <button className="pclose" onClick={closePanel}>✕</button>
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
                <TrendChart trend={panel.trend} headcount={panel.headcount} />
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
