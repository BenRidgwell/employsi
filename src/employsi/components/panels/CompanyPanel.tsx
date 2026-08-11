import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../state/store";
import { buildPanel } from "../../lib/panel";
import { buildCompanyCard, TREND_UP, TREND_DOWN } from "../../lib/companyCard";
import { COMPANIES } from "../../data/companies";
import { COMPANY_HEADCOUNT } from "../../data/companyHeadcount";
import { GOV_HEADCOUNT, GOV_WORKFORCE } from "../../data/perthGovWorkforce";
import { NZ_GOV_IDS } from "../../data/nzGov";
import { useBhpFeed } from "../../hooks/useBhpFeed";
import { useShareSeries } from "../../hooks/useShareSeries";
import { useCompanyStats } from "../../hooks/useCompanyStats";
import { useOpenRoles } from "../../hooks/useOpenRoles";
import { useRolesHistory } from "../../hooks/useRolesHistory";
import { useCompanyJobs } from "../../hooks/useSkillData";
import {
  useVacancyTrend,
  useCompanySkillTrends,
  useSkillMarketRanks,
} from "../../hooks/useRoleHistory";
import { cityForCompany } from "../../data/mapboxGeo";
import { CITY_COUNTRY, COUNTRY_MEMBERS } from "../../data/mapboxWorldGeo";
import { marketForCity } from "../../data/cityMarket";
import { NewsPanel } from "./NewsPanel";
import { CardLoader } from "./CardLoader";
import { ChartTooltip } from "./ChartTooltip";
import { SkillDemand } from "./SkillDemand";

type CardTab = "Overview" | "Skills" | "Hiring";

// NZ public-sector agency ids. Matched as a set rather than by prefix because
// the NZ private roster (data/nzCompanies.ts) shares the `nz-` prefix.
const NZ_GOV_ID_SET = new Set(NZ_GOV_IDS);

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

// The badge image. The URL is resolved once in lib/companyLogo.ts and carried
// on the card, so this only has to render it and handle the failure — a logo
// file verified months ago can stop resolving, and initials beat a broken
// image.
function CompanyLogo({ src, ticker }: { src: string; ticker: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="pbadge">
      {failed ? (
        <span className="pbadgetxt">{ticker}</span>
      ) : (
        <img className="pbadgeimg" src={src} alt={ticker} onError={() => setFailed(true)} />
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
  const pick = (o: string) => {
    onChange(o);
    setOpen(false);
  };
  return (
    <div className="rolesearch">
      {/* Same pill as the header's skill search — same height, radius, raised
          surface and magnifier gesture — so the card's search doesn't read as a
          different control from the one above the map. */}
      <button
        className={`prole ${value ? "picked" : ""} ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          className="gsicon"
          viewBox="0 0 24 24"
          width={19}
          height={19}
          fill="none"
          stroke="currentColor"
          aria-hidden
        >
          <circle className="gsiconlens" cx="11" cy="11" r="6.4" />
          <line className="gsiconhandle" x1="15.8" y1="15.8" x2="20" y2="20" />
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
        // The whole live list, no second search box: the pill above IS the
        // control, and typing to narrow a list you can already see in full was
        // an extra step for nothing. Titles are one line each, clipped with an
        // ellipsis rather than wrapped, so every card is the same height and
        // the grid stays a grid; the full title is on the tooltip.
        <div className="roledrop">
          <div className="rolechips">
            {options.map((o) => (
              <button
                key={o}
                className={`rolechip ${value === o ? "on" : ""}`}
                onClick={() => pick(o)}
                title={o}
              >
                {o}
              </button>
            ))}
            {options.length === 0 && <div className="rolenone">No live vacancies</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Direction glyph for a hiring area's change. Only the ARROW is coloured: six
// coloured percentages stacked in a column read as six alerts, one arrow each
// reads as a direction. A measured zero gets the figure and no arrow, which is
// distinct from having no comparable window at all — that case renders nothing.
function AreaTrend({ pct }: { pct: number }) {
  if (pct === 0) return <span className="cchiretr">0.0%</span>;
  const up = pct > 0;
  return (
    <span className={`cchiretr ${up ? "up" : "down"}`}>
      {Math.abs(pct).toFixed(1)}%
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
        <path
          d={up ? "M7 17 17 7M10.5 7H17v6.5" : "M7 7l10 10M10.5 17H17v-6.5"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
  // Whether the skills section is showing everything past the first six.
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Scrubbed point on the vacancies chart (null = not hovering).
  const [chartIdx, setChartIdx] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
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
    setSkillsOpen(false);
    setChartIdx(null);
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
  // Live market data (daily + quarterly closes, 52-week range) fetched on the
  // Worker from Yahoo Finance for whatever ticker resolves. This is what draws
  // the card's share-price line.
  //
  // NB: fetched for EVERY public company, BHP included. These two calls used to
  // be skipped for BHP because its own live feed carried a share series and the
  // old chart read that instead — but that series is quarterly, and the card's
  // chart overlays share price on a DAILY vacancy axis, so the feed cannot fill
  // it. Leaving the guard in place is what left BHP with no line while Rio Tinto
  // had one.
  const liveShare = useShareSeries(panel?.ticker ?? null, panel?.exchange, open);
  // Live fundamentals (real headcount, revenue/EBITDA per employee) fetched on
  // the Worker from Yahoo Finance. Same reasoning: the card reads these
  // directly, so BHP should not be the one company excluded from them.
  const liveStats = useCompanyStats(panel?.ticker ?? null, panel?.exchange, open);
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
  // Daily "live vacancies" movement series derived from the D1 archive. Used for
  // WA government agencies — their live count comes from the scraped board, not
  // Adzuna, so their vacancy chart is built from the stored history instead of
  // the forward-built KV snapshots the private companies use.
  const vacancyTrend = useVacancyTrend(panel?.companyId, open && !roleFilter);
  // Per-skill demand from the D1 archive: a daily series, a change, a median,
  // the hubs the live ads sit in. What the skills section is built from.
  const skillTrends = useCompanySkillTrends(panel?.companyId, open);
  // "Local" for the rank chips is the company's OWN country, not a fixed
  // Australia — a London or Houston card should rank its skills against the
  // market it sits in. Resolved from the same city the rest of the card uses.
  const localHubs = useMemo(() => {
    const city = lastId ? cityForCompany(lastId, localCity) : localCity;
    const country = CITY_COUNTRY[city];
    return country ? (COUNTRY_MEMBERS[country] ?? [city]) : [city];
  }, [lastId, localCity]);
  const skillRanks = useSkillMarketRanks(localHubs, open && skillTrends.skills.length > 0);
  // Board category -> 14-day change, for the hiring bars. Keyed on the same
  // tidied name the bars carry ("Engineering", not "Engineering Jobs").
  const areaTrend = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of skillTrends.areas) if (a.pct !== null) m.set(a.area, a.pct);
    return m;
  }, [skillTrends.areas]);
  const jobSample = useMemo(
    () => (liveRoles?.jobs?.length ? liveRoles.jobs : (companyJobs?.jobs ?? null)),
    [liveRoles, companyJobs],
  );
  // The roles the company is ACTUALLY advertising right now, for the card's role
  // search. culture.ts carries a hand-written roleOptions list per company, but
  // it is illustrative, it is only present for the companies someone wrote one
  // for (every other card offered an empty dropdown), and it has no relationship
  // to what is open today. The live vacancy sample does, so it takes precedence
  // and the hand-written list is only the fallback.
  //
  // Titles are deduped case-insensitively (the same ad appears on more than one
  // board) and sorted, keeping the first spelling seen.
  const liveRoleTitles = useMemo(() => {
    if (!jobSample?.length) return null;
    const byKey = new Map<string, string>();
    for (const j of jobSample) {
      const t = (j.t || "").trim();
      if (!t) continue;
      const k = t.toLowerCase().replace(/\s+/g, " ");
      if (!byKey.has(k)) byKey.set(k, t);
    }
    const list = [...byKey.values()].sort((a, b) => a.localeCompare(b));
    return list.length ? list : null;
  }, [jobSample]);

  // The live vacancies behind the selected role, so the role-focused figures can
  // be counted rather than invented (see bigStats below).
  const roleJobs = useMemo(() => {
    if (!roleFilter || !jobSample?.length) return null;
    const want = roleFilter.toLowerCase().replace(/\s+/g, " ");
    const hits = jobSample.filter(
      (j) => (j.t || "").trim().toLowerCase().replace(/\s+/g, " ") === want,
    );
    return hits.length ? hits : null;
  }, [roleFilter, jobSample]);

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
      panel.companyId.startsWith("nsw-gov-") ||
      // NZ agencies share the `nz-` prefix with the NZ private roster, so they
      // are matched by id rather than prefix.
      NZ_GOV_ID_SET.has(panel.companyId));
  // Real PSC workforce record for a gov agency (present only for agencies the
  // PSC reports). When absent, the agency's headcount is genuinely unknown and
  // the workforce chart / headcount stat are suppressed rather than faked.
  const govWf = panel && isGov ? GOV_WORKFORCE[panel.companyId] : undefined;
  // Median salary is real only when derived from live advertised salaries.
  const salaryReal = !!medianPay;
  // Real headcount (annual report / gov bulletin / live feed), not the
  // illustrative per-company figure.
  const headcountReal = !!panel && panel.headcountReal;
  // Show the workforce-trend chart only when the headcount behind it is real.
  const showWorkforce = headcountReal && !!panel && panel.trend.length >= 2;
  const bigStats = useMemo(() => {
    if (!panel) return [];
    if (roleFilter) {
      // Role-focused figures, COUNTED from the live ads for that exact role.
      //
      // buildPanel derives these from a hash of the role title — a deterministic
      // invention, which was tolerable while the role list was itself an
      // illustrative hand-written one, but is not once the list is real live
      // vacancies: picking a genuine open role and being shown a made-up count
      // and salary for it is worse than showing nothing. Where the role came
      // from live ads we count instead, and where a figure is not advertised we
      // say so rather than filling the space.
      if (!roleJobs) return panel.bigStats;
      const sals = roleJobs
        .map((j) => j.salN)
        .filter((n): n is number => typeof n === "number" && n > 0)
        .sort((a, b) => a - b);
      const m = Math.floor(sals.length / 2);
      const med = sals.length
        ? sals.length % 2
          ? sals[m]
          : Math.round((sals[m - 1] + sals[m]) / 2)
        : null;
      const share = jobSample?.length
        ? Math.round((roleJobs.length / jobSample.length) * 100)
        : null;
      return [
        {
          value: roleJobs.length.toLocaleString("en-US"),
          label: "Open roles",
          sub: roleFilter,
          subCls: "",
        },
        {
          value: med ? (med >= 1000 ? `$${Math.round(med / 1000)}k` : `$${Math.round(med)}`) : "—",
          label: "Median salary",
          sub: med
            ? `median · ${sals.length} live ad${sals.length === 1 ? "" : "s"}`
            : "not advertised",
          subCls: "",
        },
        // Not "demand YoY": the archive does not go back a year, so a
        // year-on-year figure for one role would have to be manufactured. This
        // is the same ads, expressed as a share of everything they have open.
        {
          value: share === null ? "—" : `${share}%`,
          label: "Share of vacancies",
          sub: share === null ? "no live ads" : "of this employer's live ads",
          subCls: "",
        },
      ];
    }
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
  }, [panel, roleFilter, roleJobs, jobSample, rolesChecking, liveRoles, medianPay, headcountReal]);

  // Sub-stats: "Biggest hiring area" is real only from live job ads, and falls
  // back to a dash otherwise so the card never shows an illustrative figure.
  const subStats = useMemo(() => {
    if (!panel) return [];
    return panel.subStats.map((s) => {
      if (s.label === "Biggest hiring area") {
        const top = liveHiring && liveHiring.length ? liveHiring[0].title : null;
        return { ...s, value: top ?? "—", sub: top ? "from live job ads" : undefined };
      }
      return s;
    });
  }, [panel, liveHiring]);

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
      medianPay,
      skillCounts,
      roleCounts,
    });
  }, [company, liveRoles, vacancySeries, liveShare, revPerEmp, medianPay, skillCounts, roleCounts]);

  // The card holds a loading frame until the fetches it actually renders have
  // settled: the live vacancy count (the multi-second one), and the job sample
  // the skills and hiring tabs are built from. The share series is deliberately
  // NOT in here — it only decorates the chart's second line, so waiting on it
  // would hold the whole card back for a detail, and it fades in on arrival.
  const cardLoading = open && (!card || rolesChecking);

  // The news column tucks behind the company card, which then slides right
  // into the space it left. The choice is a PREFERENCE and lives in the store,
  // so it carries across every company opened afterwards and survives a reload.
  // It used to be local state reset on each selection, on the reasoning that a
  // card opening with the news hidden looks like a company with no coverage —
  // but the tucked panel still shows its spine, so the state stays visible and
  // one click away, and re-tucking it on every single company was worse.
  const newsCollapsed = useAppStore((s) => s.newsCollapsed);
  const toggleNewsCollapsed = useAppStore((s) => s.toggleNewsCollapsed);

  return (
    <div className={`cardstage ${open ? "open" : ""}${newsCollapsed ? " newstucked" : ""}`}>
      <aside className={`cc ${open ? "open" : ""}`}>
        {cardLoading && <CardLoader tone="light" />}
        {card && panel && (
          <>
            <div className="cchead">
              <span className="ccmark">
                <CompanyLogo src={card.logo} ticker={panel.ticker} />
              </span>
              <div className="ccheadmain">
                <span className="ccname">{card.name}</span>
                <span className="ccmeta">
                  <span className="ccsector">{card.sector}</span>
                  {/* Private companies have no ticker, so the field is empty —
                      rendering it anyway leaves a stray separator dot after the
                      sector. */}
                  {card.ticker ? <span className="ccticker">{card.ticker}</span> : null}
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

            {/* Keyed on the open company so the control REMOUNTS per card.
                Its open/closed state and typed query live inside it, and the
                component keeps its place in the tree when you switch cards, so
                without this a search left open on one company was still open —
                and still highlighted — on the next one you opened. The key also
                changes to "" as the card closes, which is what returns the pill
                to its static state rather than leaving it lit. */}
            <RoleSearch
              key={selectedId ?? ""}
              options={liveRoleTitles ?? panel.roleOptions}
              value={roleFilter}
              onChange={setRoleFilter}
            />

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
                      {/* Headline block, left-aligned above the plot: eyebrow,
                          the live vacancy count with its change pill inline,
                          then the second series as a quieter line beneath.
                          These used to float inside the plot as four absolutely
                          positioned boxes, which sat on top of the line itself
                          whenever a series ran near the top or bottom of the
                          band. */}
                      <div className="ccreadout">
                        <span className="cceyebrow">Vacancies · {card.chart.label}</span>
                        <span className="ccreadv">
                          {card.chart.vacancies.latest}
                          <span className={`ccdelta ${card.chart.vacancies.up ? "up" : "down"}`}>
                            {card.chart.vacancies.up ? "▲" : "▼"} {card.chart.vacancies.delta}
                          </span>
                        </span>
                        {card.chart.second && (
                          <span className="ccreadsub">
                            <i className="cclegline alt" />
                            {card.chart.second.latest}
                            <em>{card.chart.second.label.toLowerCase()}</em>
                            <span className={`ccsubd ${card.chart.second.up ? "up" : "down"}`}>
                              {card.chart.second.up ? "▲" : "▼"} {card.chart.second.delta}
                            </span>
                          </span>
                        )}
                      </div>

                      <div
                        className="ccplot"
                        ref={plotRef}
                        onMouseMove={(e) => {
                          const n = card.chart?.days.length ?? 0;
                          if (n < 2) return;
                          const r = e.currentTarget.getBoundingClientRect();
                          const f = (e.clientX - r.left) / r.width;
                          setChartIdx(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
                        }}
                        onMouseLeave={() => setChartIdx(null)}
                      >
                        <svg viewBox="0 0 400 150" preserveAspectRatio="none" fill="none">
                          <defs>
                            <linearGradient id="cc-fade" x1="0" y1="0" x2="0" y2="1">
                              {/* The design leads with the fill, not the stroke:
                                  saturated at the curve and washing out to
                                  nothing at the floor. */}
                              <stop
                                offset="0"
                                stopColor={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                                stopOpacity=".42"
                              />
                              <stop
                                offset=".5"
                                stopColor={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                                stopOpacity=".14"
                              />
                              <stop
                                offset="1"
                                stopColor={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                                stopOpacity="0"
                              />
                            </linearGradient>
                          </defs>
                          <path d={card.chart.area} fill="url(#cc-fade)" />
                          {card.chart.second && (
                            <path
                              className="ccline2"
                              d={card.chart.second.path}
                              strokeWidth="1.8"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <path
                            d={card.chart.vacancies.path}
                            stroke={card.chart.vacancies.up ? TREND_UP : TREND_DOWN}
                            strokeWidth="2.25"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          {chartIdx != null && card.chart.vacPts[chartIdx] && (
                            <line
                              className="ccscrubline"
                              x1={card.chart.vacPts[chartIdx][0]}
                              x2={card.chart.vacPts[chartIdx][0]}
                              y1="6"
                              y2="140"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </svg>

                        {/* Markers are HTML, not SVG: the plot stretches with
                            preserveAspectRatio="none", which would squash an
                            SVG circle into an ellipse. */}
                        {chartIdx == null && card.chart.vacPts.length > 0 && (
                          <span
                            className={`ccnow ${card.chart.vacancies.up ? "up" : "down"}`}
                            style={{
                              left: `${(card.chart.vacPts[card.chart.vacPts.length - 1][0] / 400) * 100}%`,
                              top: `${(card.chart.vacPts[card.chart.vacPts.length - 1][1] / 150) * 100}%`,
                            }}
                          />
                        )}

                        {chartIdx != null && card.chart.days[chartIdx] && (
                          <>
                            {card.chart.secondPts?.[chartIdx] && (
                              <span
                                className="ccdot alt"
                                style={{
                                  left: `${(card.chart.secondPts[chartIdx][0] / 400) * 100}%`,
                                  top: `${(card.chart.secondPts[chartIdx][1] / 150) * 100}%`,
                                }}
                              />
                            )}
                            {card.chart.vacPts[chartIdx] && (
                              <span
                                className={`ccdot ${card.chart.vacancies.up ? "up" : "down"}`}
                                style={{
                                  left: `${(card.chart.vacPts[chartIdx][0] / 400) * 100}%`,
                                  top: `${(card.chart.vacPts[chartIdx][1] / 150) * 100}%`,
                                }}
                              />
                            )}
                            {/* Anchored to whichever series is higher at this
                                day, so the flag's stem lands on a marker and
                                the card never covers the other line. */}
                            <ChartTooltip
                              boxRef={plotRef}
                              className="ccflag"
                              leftPct={(card.chart.vacPts[chartIdx][0] / 400) * 100}
                              topPct={
                                (Math.min(
                                  card.chart.vacPts[chartIdx][1],
                                  card.chart.secondPts?.[chartIdx]?.[1] ?? Infinity,
                                ) /
                                  150) *
                                100
                              }
                            >
                              <div className="wttiplabel">{fmtDay(card.chart.days[chartIdx])}</div>
                              {/* .ccsw, not the shared .wtsw: those swatches are
                                  coloured for the workforce/financial charts
                                  (ink primary, green second) and this chart
                                  inverts that — its primary line carries the
                                  trend colour and its second line is ink, so
                                  .wtsw labelled each row with the other row's
                                  colour. */}
                              <div className="wttiprow">
                                <i className={`ccsw ${card.chart.vacancies.up ? "up" : "down"}`} />
                                <b>{card.chart.vacValues[chartIdx]?.toLocaleString("en-AU")}</b>
                                <span>Vacancies</span>
                              </div>
                              {card.chart.secondValues && card.chart.second && (
                                <div className="wttiprow">
                                  <i className="ccsw alt" />
                                  <b>{card.chart.secondValues[chartIdx]?.toFixed(2)}</b>
                                  <span>{card.chart.second.label}</span>
                                </div>
                              )}
                            </ChartTooltip>
                          </>
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
                </div>
              )}

              {tab === "Skills" && (
                <div className="ccpane">
                  {/* Archive-backed section: the top skill at size with its
                      market rank, where its live ads sit, and the rest as rows
                      with their own line. Falls back to the flat chips below
                      when the archive holds nothing for this company yet — a
                      card opened on a company first queried today should still
                      show what it is advertising for. */}
                  {skillTrends.skills.length > 0 && (
                    <SkillDemand trends={skillTrends} ranks={skillRanks} />
                  )}
                  {skillTrends.skills.length === 0 && (
                    <>
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
                          {skillsOpen &&
                            card.restSkills.map((s) => (
                              <span className="ccchip" key={s.name}>
                                {s.name}
                                <span className="ccchipn">{s.n}</span>
                              </span>
                            ))}
                          {card.moreSkills > 0 && (
                            <button
                              type="button"
                              className="ccchip ccchipmore"
                              aria-expanded={skillsOpen}
                              onClick={() => setSkillsOpen((v) => !v)}
                            >
                              {skillsOpen ? "show fewer" : `+${card.moreSkills} more`}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="dataempty">No live job ads</div>
                      )}
                    </>
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
                      {card.hiring.map((h) => {
                        // Change over the archive's own window, matched on the
                        // board category the bar is labelled with. Absent when
                        // the archive cannot support one — the bar still reads.
                        const t = areaTrend.get(h.name);
                        return (
                          <div className="cchirerow" key={h.name}>
                            <span className="cchirename">{h.name}</span>
                            <span className="cchirebar">
                              <span className="cchirefill" style={{ width: h.pct }} />
                            </span>
                            <span className="cchireval">
                              <span className="cchiren">{h.n}</span>
                              {t !== undefined && <AreaTrend pct={t} />}
                            </span>
                          </div>
                        );
                      })}
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
          companyId={panel.companyId}
          live={panel.news}
          collapsed={newsCollapsed}
          onToggleCollapse={toggleNewsCollapsed}
          loading={cardLoading}
        />
      )}
    </div>
  );
}
