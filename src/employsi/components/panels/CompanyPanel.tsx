import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../state/store";
import { buildPanel } from "../../lib/panel";
import { buildCompanyCard, TREND_UP, TREND_DOWN } from "../../lib/companyCard";
import { COMPANIES } from "../../data/companies";
import { COMPANY_HEADCOUNT } from "../../data/companyHeadcount";
import { GOV_HEADCOUNT, GOV_WORKFORCE } from "../../data/perthGovWorkforce";
import { useBhpFeed } from "../../hooks/useBhpFeed";
import { useShareSeries } from "../../hooks/useShareSeries";
import { useCompanyStats } from "../../hooks/useCompanyStats";
import { useOpenRoles } from "../../hooks/useOpenRoles";
import { useRolesHistory } from "../../hooks/useRolesHistory";
import { useCompanyJobs } from "../../hooks/useSkillData";
import { useVacancyTrend, useSkillTrends } from "../../hooks/useRoleHistory";
import { cityForCompany } from "../../data/mapboxGeo";
import { marketForCity } from "../../data/cityMarket";
import { NewsPanel } from "./NewsPanel";

type CardTab = "Overview" | "Skills" | "Hiring";

// "2026-07-20" → "20 Jul 2026" for the vacancy-history header.
function fmtDay(iso: string): string {
  const t = Date.parse((iso || "") + "T00:00:00Z");
  if (Number.isNaN(t)) return iso || "";
  return new Date(t).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const CompareIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 4H4v13M4 4l4 4M16 20h4V7M20 20l-4-4" />
  </svg>
);
const FollowIcon = ({ on }: { on: boolean }) =>
  on ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
  >
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

function RoleSearch({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="rolesearch">
      <button className={`prole ${value ? "on" : ""}`} onClick={() => setOpen((o) => !o)}>
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.6" y2="16.6" />
        </svg>
        <span className="prolelbl">{value || "Search a role in this company"}</span>
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
          <input
            className="roleinput"
            placeholder="Search roles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="rolechips">
            {filtered.map((o) => (
              <button
                key={o}
                className={`rolechip ${value === o ? "on" : ""}`}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                  setQ("");
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
  const isBhp = lastId === "bhp";
  const feed = useBhpFeed(isBhp && open);

  const panel = buildPanel(lastId, roleFilter, isBhp ? feed : undefined);
  // Following is an account-scoped action: only reflect the saved state when
  // signed in, so the button reads "Follow" (→ prompts sign-up) when there's no
  // account to save it to.
  const following = !!account && !!panel && followedIds.includes(panel.companyId);
  // Live market data (real quarterly closes + 52-week range) fetched on the
  // Worker from Yahoo Finance for whatever ticker resolves. When it's present
  // the share chart plots the real series and the card counts as live.
  const liveShare = useShareSeries(panel?.ticker ?? null, panel?.exchange, open && !isBhp);
  // Live fundamentals (real headcount, revenue/EBITDA per employee) fetched on
  // the Worker from Yahoo Finance. When present they overlay the illustrative
  // figures in the workforce chart and mark the card as live.
  const liveStats = useCompanyStats(panel?.ticker ?? null, panel?.exchange, open && !isBhp);
  // Live "open roles" for the company, scoped to its own job market (Adzuna for
  // the company's country + The Muse), so it works for every company wherever
  // it's plotted — Perth, London, Houston, Singapore, Tokyo, … Fetched when the
  // card is open and no role filter is narrowing it to a single role.
  const localCity = useAppStore((s) => s.localCity);
  const market = useMemo(
    () => marketForCity(lastId ? cityForCompany(lastId, localCity) : localCity),
    [lastId, localCity],
  );
  const marketArg = useMemo(
    () => ({ country: market.country, where: market.where, region: market.region.source }),
    [market],
  );
  const liveEnabled = open && !!panel && !roleFilter;
  const { roles: liveRoles, settled: rolesSettled } = useOpenRoles(
    panel?.name ?? null,
    panel?.companyId,
    marketArg,
    liveEnabled,
  );
  // Stored daily history of the live vacancy count, charted below the stats
  // (built forward by the jobs-cron; empty for a company not yet snapshotted).
  const rolesHistory = useRolesHistory(panel?.companyId, liveEnabled);
  // Advertised-role sample: the live Adzuna + The Muse jobs from the open-roles
  // fetch, falling back to the jobs-cron's stored sample (AU companies) when the
  // live fetch hasn't resolved yet.
  const companyJobs = useCompanyJobs(panel?.companyId, liveEnabled);
  // Historical role archive (D1): which roles this company has advertised over
  // time and how long each has been open. Builds forward from when archiving
  // began, so it fills out over the following days/weeks.
  // Top skill increases / decreases from historical vacancy analysis (D1) —
  // shown in place of the old "where they're hiring" role list.
  const skillTrends = useSkillTrends(panel?.companyId, open && !roleFilter);
  // Daily "live vacancies" movement series derived from the D1 archive. Used for
  // WA government agencies — their live count comes from the scraped board, not
  // Adzuna, so their vacancy chart is built from the stored history instead of
  // the forward-built KV snapshots the private companies use.
  const vacancyTrend = useVacancyTrend(panel?.companyId, open && !roleFilter);
  const jobSample = useMemo(
    () => (liveRoles?.jobs?.length ? liveRoles.jobs : (companyJobs?.jobs ?? null)),
    [liveRoles, companyJobs],
  );
  // Rank the company's real in-demand skills by how many live roles mention
  // them; falls back to the illustrative skill chips when no jobs are stored.
  const liveSkills = useMemo(() => {
    if (!jobSample?.length) return null;
    const counts = new Map<string, number>();
    for (const j of jobSample) for (const sk of j.skills) counts.set(sk, (counts.get(sk) || 0) + 1);
    if (!counts.size) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([sk]) => sk);
  }, [jobSample]);
  // "Where they're hiring": the real advertised roles grouped by functional
  // area (the job-board category, e.g. "Engineering", "IT", "Trade &
  // Construction"), counted from the live Adzuna + The Muse job sample. Falls
  // back to the illustrative breakdown only when no live jobs are stored.
  const liveHiring = useMemo(() => {
    if (!jobSample?.length) return null;
    const counts = new Map<string, number>();
    const salaries = new Map<string, number[]>(); // per-area advertised salary midpoints
    for (const j of jobSample) {
      const area = (j.cat || "").replace(/\s*jobs?$/i, "").trim() || "Other";
      counts.set(area, (counts.get(area) || 0) + 1);
      if (typeof j.salN === "number" && j.salN > 0) {
        const arr = salaries.get(area) || [];
        arr.push(j.salN);
        salaries.set(area, arr);
      }
    }
    if (!counts.size) return null;
    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    };
    const fmtK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const mx = Math.max(...ranked.map(([, c]) => c));
    return ranked.map(([title, count]) => {
      const sals = salaries.get(title);
      return {
        title,
        count,
        pct: Math.round((count / mx) * 100) + "%",
        pay: sals && sals.length ? fmtK(median(sals)) : null,
      };
    });
  }, [jobSample]);
  // Company-wide median advertised salary across the live roles that state one.
  const medianPay = useMemo(() => {
    if (!jobSample?.length) return null;
    const vals = jobSample
      .map((j) => j.salN)
      .filter((n): n is number => typeof n === "number" && n > 0)
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    const m = Math.floor(vals.length / 2);
    const med = vals.length % 2 ? vals[m] : Math.round((vals[m - 1] + vals[m]) / 2);
    return {
      text: med >= 1000 ? `$${Math.round(med / 1000)}k` : `$${Math.round(med)}`,
      n: vals.length,
    };
  }, [jobSample]);

  // Headcount is deliberately NOT taken from the live market feed — there's no
  // live HRIS/LinkedIn API, so we use a static figure sourced from the company's
  // latest annual report (and the prior year, for the YoY growth %). Revenue /
  // EBITDA per employee still overlay from the live feed when present.
  const headcount = panel?.headcount || 0;
  const revPerEmp = liveStats?.revPerEmp || panel?.revPerEmp || 0;
  const ebitdaPerEmp = liveStats?.ebitdaPerEmp || panel?.ebitdaPerEmp || 0;

  // Open roles is directly the live vacancy count for the company's market
  // (Adzuna for its country + The Muse). The headline is driven entirely by that
  // feed: once the check settles it shows the real count, or 0 when there are no
  // live vacancies — never an illustrative figure. The illustrative number is
  // only shown briefly while the check is still in flight, or while a role
  // filter narrows the card to a single role.
  // The live-vacancy check is still in flight (card just opened). While it is,
  // the Open roles / "where they're hiring" / "skills in demand" areas must not
  // fall back to the illustrative figures — the user should see the live
  // vacancies view first, not the old view flashing before it refreshes.
  const rolesChecking = liveEnabled && !rolesSettled && !liveRoles;
  // Government agencies (private, scraped public-sector feeds — WA via the WA
  // jobs board, SA via iworkfor.sa.gov.au). Their card shows the live vacancy
  // graph off the archived board data instead of the private-sector layout.
  const isGov =
    !!panel &&
    (panel.companyId.startsWith("perth-gov-") ||
      panel.companyId.startsWith("sa-gov-") ||
      panel.companyId.startsWith("vic-gov-") ||
      panel.companyId.startsWith("qld-gov-") ||
      panel.companyId.startsWith("aps-") ||
      panel.companyId.startsWith("nt-gov-") ||
      panel.companyId.startsWith("tas-gov-") ||
      panel.companyId.startsWith("nsw-gov-"));
  // Real PSC workforce record for a gov agency (present only for agencies the
  // PSC reports). When absent, the agency's headcount is genuinely unknown and
  // the workforce chart / headcount stat are suppressed rather than faked.
  const govWf = panel && isGov ? GOV_WORKFORCE[panel.companyId] : undefined;
  // Only BHP currently has a live culture feed (Glassdoor, diversity, layoffs);
  // for every other company those are illustrative, so we show them as gaps
  // (0 / not reported) rather than fabricated numbers.
  const cultureReal = isBhp && !!feed;
  // Median salary is real only when derived from live advertised salaries.
  const salaryReal = !!medianPay;
  // Real headcount (annual report / gov bulletin / live feed), not the
  // illustrative per-company figure.
  const headcountReal = !!panel && panel.headcountReal;
  // Show the workforce-trend chart only when the headcount behind it is real.
  const showWorkforce = headcountReal && !!panel && panel.trend.length >= 2;
  const bigStats = useMemo(() => {
    if (!panel) return [];
    if (roleFilter) return panel.bigStats;
    return panel.bigStats.map((s) => {
      if (s.label === "Open roles") {
        if (rolesChecking) return { ...s, value: "···", sub: "checking live ads…", subCls: "" };
        const count = liveRoles ? liveRoles.count : 0;
        // Neutral subheading — the count is a deduped union across every source,
        // so we don't name individual boards (Adzuna / SEEK / …).
        return {
          ...s,
          value: count.toLocaleString("en-US"),
          sub: count > 0 ? "current vacancies" : "no live vacancies",
        };
      }
      if (s.label === "Median salary") {
        // Real median only from live advertised salaries; otherwise a 0 gap.
        return medianPay
          ? { ...s, value: medianPay.text, sub: `median · ${medianPay.n} live ads`, subCls: "" }
          : { ...s, value: "$0", sub: "no live salary data", subCls: "" };
      }
      if (s.label === "Headcount YoY") {
        // Real only from an annual report / gov bulletin; else show the gap.
        return headcountReal ? s : { ...s, value: "—", sub: "not reported", subCls: "" };
      }
      return s;
    });
  }, [panel, roleFilter, rolesChecking, liveRoles, medianPay, headcountReal]);

  // Sub-stats: Glassdoor is real only for the live-feed company; "Biggest
  // hiring area" is real only from live job ads. Both fall back to a 0 / dash
  // gap otherwise so the card never shows an illustrative figure.
  const subStats = useMemo(() => {
    if (!panel) return [];
    return panel.subStats.map((s) => {
      if (s.label === "Glassdoor rating") {
        return cultureReal ? s : { ...s, value: "0.0 ★", sub: "no data", subCls: "" };
      }
      if (s.label === "Biggest hiring area") {
        const top = liveHiring && liveHiring.length ? liveHiring[0].title : null;
        return { ...s, value: top ?? "—", sub: top ? "from live job ads" : undefined };
      }
      return s;
    });
  }, [panel, cultureReal, liveHiring]);

  // Share price is real only from the live feed (BHP) or the live Yahoo series;
  // the illustrative shareTrend fallback is dropped so the chart only appears
  // with real prices. Commodity baskets are real only for the live-feed company.
  const prices = useMemo(
    () => (feed && isBhp ? feed.sharePrice : liveShare ? liveShare.series : []),
    [feed, isBhp, liveShare],
  );
  const commodities = useMemo(() => (feed && isBhp ? feed.commodities : undefined), [feed, isBhp]);
  // The Financial-trends chart (share price + commodity baskets) is only
  // meaningful for mining / resources companies, so it's limited to that sector
  // group — every other company (public or government) never shows it.
  const isResources = panel?.group === "Energy & Natural Resources";

  // The design's card is one scroll body behind three tabs, so the sections
  // that used to stack down a single column are now grouped: headline stats,
  // chart and facts on Overview; the skill chips on Skills; the role areas on
  // Hiring. Reset to Overview whenever the card opens on a new company.
  const [tab, setTab] = useState<CardTab>("Overview");
  useEffect(() => {
    if (selectedId) setTab("Overview");
  }, [selectedId]);

  // Skill → live-ad count, and role area → live-ad count, from the same job
  // sample the old chips and bars were built from.
  const skillCounts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!jobSample?.length) return out;
    for (const j of jobSample) for (const sk of j.skills) out[sk] = (out[sk] || 0) + 1;
    return out;
  }, [jobSample]);
  const roleCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const h of liveHiring ?? []) out[h.title] = h.count;
    return out;
  }, [liveHiring]);

  // The vacancy series behind the chart: the D1 archive where the company has
  // one, else the forward-built KV snapshots.
  const vacancySeries = vacancyTrend.length >= 2 ? vacancyTrend : rolesHistory;

  const company = useMemo(() => COMPANIES.find((c) => c.id === lastId) ?? null, [lastId]);
  const card = useMemo(() => {
    if (!company) return null;
    const hcRec = COMPANY_HEADCOUNT[company.id] ?? GOV_HEADCOUNT[company.id];
    return buildCompanyCard({
      company,
      openRoles: liveRoles ? liveRoles.count : null,
      headcount: hcRec ? { now: hcRec.now, yoy: hcRec.yoy, asof: hcRec.asof } : null,
      vacancies: vacancySeries,
      share: liveShare ?? null,
      revPerEmp,
      // Only the live culture feed carries a rating this company actually has;
      // everything else would be an industry average wearing its name.
      glassdoor: cultureReal && feed ? { score: feed.glassdoor, reviews: null } : null,
      skillCounts,
      roleCounts,
    });
  }, [
    company,
    liveRoles,
    vacancySeries,
    liveShare,
    revPerEmp,
    cultureReal,
    feed,
    skillCounts,
    roleCounts,
  ]);

  return (
    <div className={`cardstage ${open ? "open" : ""}`}>
      <aside className={`cc ${open ? "open" : ""}`}>
        {card && panel && (
          <>
            <div className="cchead">
              <span className="ccmark">
                <CompanyLogo domain={panel.domain} ticker={panel.ticker} />
              </span>
              <div className="ccheadmain">
                <span className="ccname">{card.name}</span>
                <span className="ccmeta">
                  <span className="ccsector">{card.sector}</span>
                  <span className="ccticker">{card.ticker}</span>
                </span>
              </div>
              <div className="ccactions">
                <button
                  className="ccbtn ccbtn-compare"
                  onClick={() => openCompare(card.id)}
                  aria-label="Compare"
                >
                  <span className="cctip">Compare</span>
                  <CompareIcon />
                </button>
                <button
                  className={`ccbtn ccbtn-follow ${following ? "on" : ""}`}
                  onClick={() => requestFollow(card.id)}
                  aria-label="Follow"
                >
                  <span className="cctip">{following ? "Following" : "Follow"}</span>
                  <FollowIcon on={following} />
                </button>
                <button className="ccbtn ccbtn-close" onClick={closePanel} aria-label="Close">
                  <span className="cctip">Close</span>
                  <CloseIcon />
                </button>
              </div>
            </div>

            <RoleSearch options={panel.roleOptions} value={roleFilter} onChange={setRoleFilter} />

            <div className="cctabs">
              {(["Overview", "Skills", "Hiring"] as CardTab[]).map((t) => (
                <button
                  key={t}
                  className={`cctab ${tab === t ? "on" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="ccbody" ref={scrollRef}>
              {tab === "Overview" && (
                <div className="ccpane">
                  <div className="ccstats">
                    {card.stats.map((s) => (
                      <div className="ccstat" key={s.label}>
                        <span className="ccstatv">
                          {s.value}
                          {s.delta && (
                            <span className={`ccstatd ${s.deltaUp ? "up" : "down"}`}>
                              {s.delta}
                            </span>
                          )}
                        </span>
                        <span className="ccstatl">{s.label}</span>
                        {s.sub && <span className="ccstatsub">{s.sub}</span>}
                      </div>
                    ))}
                  </div>

                  {card.chart ? (
                    <div className="ccchart">
                      <div className="ccchartend">
                        <span className="cceyebrow">{card.chart.label}</span>
                        <div className="cclegend">
                          <span className="cclegitem">
                            <span
                              className={`cclegline ${card.chart.vacancies.up ? "up" : "down"}`}
                            />
                            Vacancies
                          </span>
                          {card.chart.second && (
                            <span className="cclegitem">
                              <span className="cclegline dash" />
                              {card.chart.second.label}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="ccplot">
                        <svg viewBox="0 0 400 150" preserveAspectRatio="none" fill="none">
                          <defs>
                            <linearGradient id="cc-fade" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="0"
                                stopColor={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                                stopOpacity=".18"
                              />
                              <stop
                                offset="1"
                                stopColor={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                                stopOpacity="0"
                              />
                            </linearGradient>
                          </defs>
                          <path d={card.chart.area} fill="url(#cc-fade)" />
                          <path
                            d={card.chart.vacancies.path}
                            stroke={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                          {card.chart.second && (
                            <path
                              d={card.chart.second.path}
                              stroke="#8e8e93"
                              strokeWidth="1.8"
                              strokeDasharray="5 4"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          )}
                        </svg>
                        <span className="cccallout left">
                          <span className="cccalloutv">{card.chart.vacancies.latest}</span>
                          <span className="cccalloutl">Vacancies</span>
                        </span>
                        {card.chart.second && (
                          <span className="cccallout right">
                            <span className="cccalloutv">{card.chart.second.latest}</span>
                            <span className="cccalloutl">{card.chart.second.label}</span>
                          </span>
                        )}
                        <span className={`ccdelta left ${card.chart.vacancies.up ? "up" : "down"}`}>
                          {card.chart.vacancies.delta}
                        </span>
                        {card.chart.second && (
                          <span className={`ccdelta right ${card.chart.second.up ? "up" : "down"}`}>
                            {card.chart.second.delta}
                          </span>
                        )}
                      </div>

                      <div className="ccaxis">
                        {card.chart.axis.map((t, i) => (
                          <span key={i}>{t}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    card.chartNote && <div className="dataempty">{card.chartNote}</div>
                  )}

                  {card.facts.length > 0 && (
                    <div className="ccfacts">
                      {card.facts.map((f) => (
                        <div className="ccfact" key={f.k}>
                          <span className="ccfactk">{f.k}</span>
                          <span className="ccfactv">{f.v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {card.rating != null && (
                    <div className="ccrating">
                      <span className="ccratingscore">
                        {card.rating.score}
                        <span className="ccratingof">/ 5</span>
                      </span>
                      <span className="ccratingmain">
                        <span className="ccstars">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <svg key={i} viewBox="0 0 24 24" width="13" height="13">
                              <path
                                d="M12 3.6l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 10l6-.8z"
                                fill={i <= (card.rating?.value ?? 0) ? "#1c1c1e" : "#d8d8dc"}
                              />
                            </svg>
                          ))}
                        </span>
                        <span className="ccratingmeta">{card.rating.meta}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {tab === "Skills" && (
                <div className="ccpane">
                  <div className="ccsecth">
                    <span className="cceyebrow">Skills in demand</span>
                    <span className="ccsecthsub">
                      {rolesChecking && !card.skills.length
                        ? "checking live ads…"
                        : `from ${card.stats[0].value} live ads`}
                    </span>
                  </div>
                  {card.skills.length ? (
                    <div className="ccchips">
                      {card.skills.map((s) => (
                        <span className="ccchip" key={s.name}>
                          {s.name}
                          <span className="ccchipn">{s.n}</span>
                        </span>
                      ))}
                      {card.moreSkills > 0 && (
                        <span className="ccchip ccchipmore">+{card.moreSkills} more</span>
                      )}
                    </div>
                  ) : (
                    <div className="dataempty">No live job ads</div>
                  )}
                </div>
              )}

              {tab === "Hiring" && (
                <div className="ccpane">
                  <div className="ccsecth">
                    <span className="cceyebrow">Where they&rsquo;re hiring</span>
                    <span className="ccsecthsub">{card.hiringWindow ?? "share of live ads"}</span>
                  </div>
                  {card.hiring.length ? (
                    <div className="cchiring">
                      {card.hiring.map((h) => (
                        <div className="cchirerow" key={h.name}>
                          <span className="cchirename">{h.name}</span>
                          <span className="cchirebar">
                            <span className="cchirefill" style={{ width: h.pct }} />
                          </span>
                          <span className="cchiren">{h.n}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="dataempty">No live job ads</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
      {panel && (
        <NewsPanel
          key={panel.companyId}
          name={panel.name}
          sector={panel.sector}
          ticker={panel.ticker}
          live={panel.news}
        />
      )}
    </div>
  );
}
