import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { buildPanel } from '../../lib/panel';
import { TrendChart } from './TrendChart';
import { NewsPanel } from './NewsPanel';

const CompareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 4H4v13M4 4l4 4M16 20h4V7M20 20l-4-4" />
  </svg>
);
const FollowIcon = ({ on }: { on: boolean }) =>
  on ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

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

function RoleSearch({ options, value, onChange }: { options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="rolesearch">
      <button className={`prole ${value ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.6" y2="16.6" />
        </svg>
        <span className="prolelbl">{value || 'Search a role in this company'}</span>
        {value && (
          <span
            className="proleclear"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              setOpen(false);
            }}
          >
            ✕
          </span>
        )}
      </button>
      {open && (
        <div className="roledrop">
          <input className="roleinput" placeholder="Search roles…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="rolechips">
            {filtered.map((o) => (
              <button
                key={o}
                className={`rolechip ${value === o ? 'on' : ''}`}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                  setQ('');
                }}
              >
                {o}
              </button>
            ))}
            {filtered.length === 0 && <div className="rolenone">No roles match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ pct, max = 100 }: { pct: number; max?: number }) {
  return (
    <div className="dbar">
      <div className="dbarfill" style={{ width: `${Math.min(100, (pct / max) * 100)}%` }} />
    </div>
  );
}

export function CompanyPanel() {
  const selectedId = useAppStore((s) => s.selectedId);
  const lastId = useAppStore((s) => s.lastId);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompare = useAppStore((s) => s.openCompare);
  const followedIds = useAppStore((s) => s.followedIds);
  const toggleFollow = useAppStore((s) => s.toggleFollow);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);

  // Reset the role focus whenever a different company is opened.
  useEffect(() => setRoleFilter(null), [lastId]);

  const panel = buildPanel(lastId, roleFilter);
  const open = !!selectedId;
  const following = panel ? followedIds.includes(panel.companyId) : false;

  return (
    <div className={`cardstage ${open ? 'open' : ''}`}>
      <aside className={`panel ${open ? 'open' : ''}`}>
        <div className="pscroll">
          {panel && (
            <>
              <div className="phead">
                <CompanyLogo domain={panel.domain} ticker={panel.ticker} />
                <div className="pheadmain">
                  <div className="pname">{panel.name}</div>
                  <div className="psector">{panel.sector}</div>
                </div>
                <div className="pactions">
                  <div className="pfabwrap">
                    <span className="pfablbl">Compare</span>
                    <button className="pfab" onClick={() => openCompare(panel.companyId)} aria-label="Compare">
                      <span className="pfabic"><CompareIcon /></span>
                    </button>
                  </div>
                  <div className="pfabwrap">
                    <span className="pfablbl">{following ? 'Following' : 'Follow'}</span>
                    <button className={`pfab ${following ? 'on' : ''}`} onClick={() => toggleFollow(panel.companyId)} aria-label="Follow">
                      <span className="pfabic"><FollowIcon on={following} /></span>
                    </button>
                  </div>
                  <div className="pfabwrap">
                    <span className="pfablbl">Close</span>
                    <button className="pfab" onClick={closePanel} aria-label="Close">
                      <span className="pfabic"><CloseIcon /></span>
                    </button>
                  </div>
                </div>
              </div>

              <RoleSearch options={panel.roleOptions} value={roleFilter} onChange={setRoleFilter} />

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
                <TrendChart trend={panel.trend} headcount={panel.headcount} revPerEmp={panel.revPerEmp} ebitdaPerEmp={panel.ebitdaPerEmp} />
                <div className="subs">
                  {panel.subStats.map((s, i) => (
                    <div className="subc" key={i}>
                      <div className="subv">{s.value}</div>
                      <div className="subl">{s.label}</div>
                      {s.sub && <div className={`subd ${s.subCls || ''}`}>{s.sub}</div>}
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

              <div className="sect">
                <div className="secth">
                  Gender &amp; pay gap
                  <span>workforce mix</span>
                </div>
                <div className="genderbar">
                  <div className="genderf" style={{ width: `${panel.diversity.femalePct}%` }}>{panel.diversity.femalePct}% women</div>
                  <div className="genderm">{100 - panel.diversity.femalePct}% men</div>
                </div>
                <div className="paygap">
                  <div>
                    <span className="paygapv">{panel.diversity.payGap.toFixed(1)}%</span>
                    <span className="paygapl">median gender pay gap</span>
                  </div>
                  <span className={`paygapbench ${panel.diversity.payGap <= panel.diversity.payGapBench ? 'good' : 'bad'}`}>
                    {panel.diversity.payGap <= panel.diversity.payGapBench ? '▼' : '▲'} vs {panel.diversity.payGapBench.toFixed(1)}% industry
                  </span>
                </div>
              </div>

              <div className="sect">
                <div className="secth">
                  Women in leadership
                  <span>target vs actual</span>
                </div>
                <div className="progtrack">
                  <div className="progfill" style={{ width: `${panel.diversity.womenLeadActual}%` }} />
                  <div className="progtarget" style={{ left: `${panel.diversity.womenLeadTarget}%` }} />
                </div>
                <div className="progrow">
                  <span><b>{panel.diversity.womenLeadActual}%</b> actual</span>
                  <span className="progtl">target {panel.diversity.womenLeadTarget}%</span>
                </div>
              </div>

              <div className="sect">
                <div className="secth">
                  Indigenous employment
                  <span>vs {panel.diversity.indigenousBench.toFixed(1)}% parity</span>
                </div>
                <Bar pct={panel.diversity.indigenousPct} max={12} />
                <div className="progrow">
                  <span><b>{panel.diversity.indigenousPct.toFixed(1)}%</b> of workforce</span>
                  <span className={`progtl ${panel.diversity.indigenousPct >= panel.diversity.indigenousBench ? 'good' : ''}`}>
                    parity {panel.diversity.indigenousBench.toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="sect">
                <div className="secth">
                  Recent layoffs
                  <span>last 12 months</span>
                </div>
                {panel.layoffs ? (
                  <div className="layoff">
                    <div className="layoffhead">
                      <b>{panel.layoffs.period}</b>
                      <span className="layoffpct">{panel.layoffs.pct.toFixed(1)}% · {panel.layoffs.roles.toLocaleString('en-US')} roles</span>
                    </div>
                    <div className="layoffnote">{panel.layoffs.note}</div>
                  </div>
                ) : (
                  <div className="layoffnone">No major layoffs reported in the last 12 months.</div>
                )}
              </div>

              <div className="foot">Illustrative data · Perth metro · {panel.name}</div>
            </>
          )}
        </div>
      </aside>
      {panel && <NewsPanel name={panel.name} sector={panel.sector} />}
    </div>
  );
}
