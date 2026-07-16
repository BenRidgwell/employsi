import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { buildPanel } from '../../lib/panel';
import { shareTrend, commodityBaskets } from '../../data/finance';
import { companySocial } from '../../data/social';
import { useBhpFeed } from '../../hooks/useBhpFeed';
import { TrendChart } from './TrendChart';
import { ShareChart } from './ShareChart';
import { NewsPanel } from './NewsPanel';
import { FabWrap } from './FabTooltip';

const RedditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="14" r="6.5" />
    <circle cx="8.6" cy="14.2" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.4" cy="14.2" r="1" fill="currentColor" stroke="none" />
    <path d="M9 17c.9.6 1.9.9 3 .9s2.1-.3 3-.9" />
    <path d="M12 7.5V4.5M12 4.5l2.4 1M17 9.2a1.6 1.6 0 1 0 0-3.2" />
  </svg>
);
const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M4 4l7 8.4L4.3 20h2.1l5.8-6.6 4.4 6.6H21l-7.3-9L20 4h-2.1l-5.3 6-4-6H4Z" />
  </svg>
);

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
  const live = isBhp ? !!feed : REAL_DATA_IDS.includes(lastId ?? '');

  const prices = useMemo(
    () => (feed && isBhp ? feed.sharePrice : panel ? shareTrend(panel.ticker, panel.trend) : []),
    [feed, isBhp, panel?.ticker, panel?.trend],
  );
  const commodities = useMemo(
    () => (feed && isBhp ? feed.commodities : commodityBaskets(panel ? panel.trend.length : 0)),
    [feed, isBhp, panel?.trend.length],
  );
  const social = useMemo(
    () =>
      feed && isBhp
        ? feed.social
        : panel
          ? companySocial(panel.companyId, panel.trend[panel.trend.length - 1] - panel.trend[0])
          : null,
    [feed, isBhp, panel?.companyId, panel?.trend],
  );

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
              </div>

              {prices.length > 0 && (
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

              {social && (
                <div className="sect">
                  <div className="secth">
                    Social sentiment
                    <span>Reddit &amp; X mentions</span>
                  </div>
                  <div className="subs">
                    <div className="subc">
                      <div className="subv"><RedditIcon /> {social.redditMentions.toLocaleString('en-US')}</div>
                      <div className="subl">Reddit mentions / wk</div>
                      <div className={`subd ${social.redditDelta >= 0 ? '' : 'neg'}`}>
                        {social.redditDelta >= 0 ? '+' : '−'}{Math.abs(social.redditDelta).toFixed(1)}% vs last week
                      </div>
                    </div>
                    <div className="subc">
                      <div className="subv"><XIcon /> {social.xMentions.toLocaleString('en-US')}</div>
                      <div className="subl">X mentions / wk</div>
                      <div className={`subd ${social.xDelta >= 0 ? '' : 'neg'}`}>
                        {social.xDelta >= 0 ? '+' : '−'}{Math.abs(social.xDelta).toFixed(1)}% vs last week
                      </div>
                    </div>
                  </div>
                  <div className="sentimentbar">
                    <span className="sentpos" style={{ width: `${social.positive}%` }} />
                    <span className="sentneu" style={{ width: `${social.neutral}%` }} />
                    <span className="sentneg" style={{ width: `${social.negative}%` }} />
                  </div>
                  <div className="sentlegend">
                    <span><i className="sentdot pos" />{social.positive}% positive</span>
                    <span><i className="sentdot neu" />{social.neutral}% neutral</span>
                    <span><i className="sentdot neg" />{social.negative}% negative</span>
                  </div>
                  <div className="sentnote">{social.summary}</div>
                </div>
              )}

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
            </>
          )}
        </div>
      </aside>
      {panel && <NewsPanel name={panel.name} sector={panel.sector} live={panel.news} />}
    </div>
  );
}
