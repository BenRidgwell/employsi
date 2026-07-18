import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { buildPanel } from '../../lib/panel';
import { shareTrend, commodityBaskets } from '../../data/finance';
import { useBhpFeed } from '../../hooks/useBhpFeed';
import { useShareSeries } from '../../hooks/useShareSeries';
import { useCompanyStats } from '../../hooks/useCompanyStats';
import { useOpenRoles } from '../../hooks/useOpenRoles';
import { useRolesHistory } from '../../hooks/useRolesHistory';
import { useCompanyJobs } from '../../hooks/useSkillData';
import { CITY_COMPANIES } from '../../data/mapboxGeo';
import { TrendChart } from './TrendChart';
import { ShareChart } from './ShareChart';
import { RolesHistoryChart } from './RolesHistoryChart';
import { NewsPanel } from './NewsPanel';
import { FabWrap } from './FabTooltip';

// Companies plotted in an Australian city — the live "open roles" feed
// (ATS/Adzuna) is Australia-scoped, so it's only fetched for these.
const AU_CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney'];
const AU_COMPANY_IDS = new Set(AU_CITIES.flatMap((c) => (CITY_COMPANIES[c] || []).map((x) => x.id)));

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

// Clearbit's public logo API has been discontinued (hotlinked requests now
// fail outright), so this fetches each company's real brand icon via
// Google's favicon service instead, which is still live. Falls back to the
// ticker text only if even that request errors.
function CompanyLogo({ domain, ticker }: { domain: string; ticker: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="pbadge">
      {failed ? (
        <span className="pbadgetxt">{ticker}</span>
      ) : (
        <img
          className="pbadgeimg"
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
          alt={ticker}
          onError={() => setFailed(true)}
        />
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

export function CompanyPanel() {
  const selectedId = useAppStore((s) => s.selectedId);
  const lastId = useAppStore((s) => s.lastId);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompare = useAppStore((s) => s.openCompare);
  const followedIds = useAppStore((s) => s.followedIds);
  const account = useAppStore((s) => s.account);
  const requestFollow = useAppStore((s) => s.requestFollow);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const zoomingIn = useAppStore((s) => s.zoomingIn);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Leaving the local city layer (zooming/scrolling out to the domestic or
  // global overview) fades the open company card away — clearing selectedId
  // lets the panel run its normal close transition. Guarded by !zoomingIn so
  // opening a company via search (which is mid-zoom-in, still zoomedOut) never
  // instantly closes the card it just opened.
  useEffect(() => {
    if (zoomedOut && !zoomingIn && useAppStore.getState().selectedId) closePanel();
  }, [zoomedOut, zoomingIn, closePanel]);

  // Reset the role focus and scroll position whenever the panel opens on a
  // company — keyed on selectedId (not lastId) so reopening the *same*
  // company after closing still resets: lastId keeps its old value across a
  // close, so it wouldn't otherwise change on that null -> id transition.
  useEffect(() => {
    if (!selectedId) return;
    setRoleFilter(null);
    scrollRef.current?.scrollTo(0, 0);
  }, [selectedId]);

  const open = !!selectedId;
  // BHP is the pilot for real-time data: poll its live feed while the card is
  // open and overlay it onto the panel; every other company stays illustrative.
  const isBhp = lastId === 'bhp';
  const feed = useBhpFeed(isBhp && open);

  const panel = buildPanel(lastId, roleFilter, isBhp ? feed : undefined);
  // Following is an account-scoped action: only reflect the saved state when
  // signed in, so the button reads "Follow" (→ prompts sign-up) when there's no
  // account to save it to.
  const following = !!account && !!panel && followedIds.includes(panel.companyId);
  // Companies wired with real data show the LIVE badge. BHP additionally polls
  // a real-time feed (so it waits for the first poll); the rest carry real
  // static figures (financial ratios, 52-week share ranges) and dated news, so
  // they're live as soon as the card opens. This now covers every listed Perth
  // resources name in the map.
  const REAL_DATA_IDS = [
    'bhp', 'rio', 'fmg', 's32', 'wds', 'sto', 'chevron', 'sfr',
    'igo', 'min', 'pls', 'ltr', 'ilu', 'nst',
  ];
  // Live market data (real quarterly closes + 52-week range) fetched on the
  // Worker from Yahoo Finance for whatever ticker resolves. When it's present
  // the share chart plots the real series and the card counts as live.
  const liveShare = useShareSeries(panel?.ticker ?? null, panel?.exchange, open && !isBhp);
  // Live fundamentals (real headcount, revenue/EBITDA per employee) fetched on
  // the Worker from Yahoo Finance. When present they overlay the illustrative
  // figures in the workforce chart and mark the card as live.
  const liveStats = useCompanyStats(panel?.ticker ?? null, panel?.exchange, open && !isBhp);
  // Live "open roles" count for Australian companies (employer ATS feed →
  // Adzuna on the Worker). Company-wide, so only fetched when no role filter is
  // narrowing the card to a single role.
  const isAU = !!lastId && AU_COMPANY_IDS.has(lastId);
  const liveRoles = useOpenRoles(panel?.name ?? null, panel?.companyId, open && isAU && !roleFilter);
  // Stored daily history of the live vacancy count, charted below the stats.
  const rolesHistory = useRolesHistory(panel?.companyId, open && isAU && !roleFilter);
  // Real advertised roles + their mapped skills, from the jobs pipeline.
  const companyJobs = useCompanyJobs(panel?.companyId, open && isAU && !roleFilter);
  // Rank the company's real in-demand skills by how many live roles mention
  // them; falls back to the illustrative skill chips when no jobs are stored.
  const liveSkills = useMemo(() => {
    if (!companyJobs?.jobs?.length) return null;
    const counts = new Map<string, number>();
    for (const j of companyJobs.jobs) for (const sk of j.skills) counts.set(sk, (counts.get(sk) || 0) + 1);
    if (!counts.size) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([sk]) => sk);
  }, [companyJobs]);
  const live = isBhp ? !!feed : REAL_DATA_IDS.includes(lastId ?? '') || !!liveShare || !!liveStats || !!liveRoles;

  const headcount = liveStats?.headcount || panel?.headcount || 0;
  const revPerEmp = liveStats?.revPerEmp || panel?.revPerEmp || 0;
  const ebitdaPerEmp = liveStats?.ebitdaPerEmp || panel?.ebitdaPerEmp || 0;

  // Overlay the real Australian open-roles count onto the headline stat when
  // the live feed resolves; otherwise the card keeps its illustrative figure.
  const bigStats = useMemo(() => {
    if (!panel) return [];
    if (!liveRoles) return panel.bigStats;
    return panel.bigStats.map((s) =>
      s.label === 'Open roles'
        ? { ...s, value: liveRoles.count.toLocaleString('en-US'), sub: '' }
        : s,
    );
  }, [panel, liveRoles]);

  const prices = useMemo(
    () =>
      feed && isBhp
        ? feed.sharePrice
        : liveShare
          ? liveShare.series
          : panel
            ? shareTrend(panel.ticker, panel.trend)
            : [],
    [feed, isBhp, liveShare, panel?.ticker, panel?.trend],
  );
  const commodities = useMemo(
    () => (feed && isBhp ? feed.commodities : commodityBaskets(panel ? panel.trend.length : 0)),
    [feed, isBhp, panel?.trend.length],
  );
  // The Financial-trends chart (share price + commodity baskets) is only
  // meaningful for resources companies, so it's limited to that sector group.
  const isResources = panel?.group === 'Energy & Natural Resources';

  return (
    <div className={`cardstage ${open ? 'open' : ''}`}>
      <aside className={`panel ${open ? 'open' : ''}`}>
        <div className="pscroll" ref={scrollRef}>
          {panel && (
            <>
              <div className="phead">
                <CompanyLogo domain={panel.domain} ticker={panel.ticker} />
                <div className="pheadmain">
                  <div className="pname">
                    {panel.name}
                    {live && <span className="plive"><i />LIVE</span>}
                  </div>
                  <div className="psector">{panel.sector}</div>
                </div>
                <div className="pactions">
                  <FabWrap label="Compare">
                    <button className="pfab" onClick={() => openCompare(panel.companyId)} aria-label="Compare">
                      <span className="pfabic"><CompareIcon /></span>
                    </button>
                  </FabWrap>
                  <FabWrap label={following ? 'Following' : 'Follow'}>
                    <button className={`pfab ${following ? 'on' : ''}`} onClick={() => requestFollow(panel.companyId)} aria-label="Follow">
                      <span className="pfabic"><FollowIcon on={following} /></span>
                    </button>
                  </FabWrap>
                  <FabWrap label="Close">
                    <button className="pfab" onClick={closePanel} aria-label="Close">
                      <span className="pfabic"><CloseIcon /></span>
                    </button>
                  </FabWrap>
                </div>
              </div>

              <RoleSearch options={panel.roleOptions} value={roleFilter} onChange={setRoleFilter} />

              <div className="bigs">
                {bigStats.map((s, i) => (
                  <div className="bigc" key={i}>
                    <div className="bigv">{s.value}</div>
                    <div className="bigl">{s.label}</div>
                    <div className={`bigsub ${s.subCls}`}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {isAU && !roleFilter && liveRoles && (
                <div className="sect">
                  <RolesHistoryChart points={rolesHistory} current={liveRoles.count} />
                </div>
              )}

              <div className="sect">
                <TrendChart trend={panel.trend} headcount={headcount} revPerEmp={revPerEmp} ebitdaPerEmp={ebitdaPerEmp} />
              </div>

              {isResources && prices.length > 0 && (
                <div className="sect">
                  <ShareChart ticker={panel.ticker} prices={prices} commodities={commodities} />
                </div>
              )}

              <div className="sect">
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
                <div className="secth">
                  {liveSkills ? 'Skills in demand' : panel.skillsLabel}
                  {liveSkills && <span>from live job ads</span>}
                </div>
                <div className="skills">
                  {(liveSkills ?? panel.skills).map((sk) => (
                    <span className="skill" key={sk}>{sk}</span>
                  ))}
                </div>
              </div>

              {companyJobs && companyJobs.jobs.length > 0 && (
                <div className="sect">
                  <div className="secth">
                    Advertised roles
                    <span>{companyJobs.count.toLocaleString('en-US')} live · sampled</span>
                  </div>
                  <div className="jobslist">
                    {companyJobs.jobs.slice(0, 12).map((j, i) => (
                      <a
                        className="jobrow"
                        key={`${j.t}-${i}`}
                        href={j.url || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="jobt">{j.t}</span>
                        <span className="jobmeta">
                          {j.loc && <span className="jobloc">{j.loc}</span>}
                          {j.skills.slice(0, 3).map((sk) => (
                            <span className="jobskill" key={sk}>{sk}</span>
                          ))}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

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
            </>
          )}
        </div>
      </aside>
      {panel && <NewsPanel name={panel.name} sector={panel.sector} ticker={panel.ticker} live={panel.news} />}
    </div>
  );
}
