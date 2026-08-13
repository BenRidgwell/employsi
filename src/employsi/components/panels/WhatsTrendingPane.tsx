import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../../state/store";
import type { ViewedItem } from "../../data/trending";
import { getMarketSkillMovers, type MarketSkillMover } from "../../lib/jobHistoryFn";
import { MARKET_WINDOWS, DEFAULT_MARKET_WINDOW } from "../../lib/jobHistoryFn";
import { useSkillMarket } from "../../hooks/useRoleHistory";
import type { SkillMarket } from "../../lib/jobHistoryFn";
import { SkillMarketRows } from "./SkillMarketRows";
import { MarketHero } from "./MarketHero";
import {
  WORLD_SCOPE,
  scopeForCity,
  scopeForCountry,
  scopeForRegion,
  type ResolvedScope,
} from "../../lib/analystScope";
import { getMostViewed, type ViewedRow } from "../../lib/viewsFn";
import { CardLoader } from "./CardLoader";
import { CITY_CONTINENT } from "../../data/geo";
import { CITY_COUNTRY } from "../../data/mapboxWorldGeo";

function ViewedIcon({ kind }: { kind: ViewedItem["kind"] | "city" }) {
  const c = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "company")
    return (
      <svg viewBox="0 0 24 24">
        <path {...c} d="M5 21V6.5l6-2.5v17M11 9l6 2v10M4 21h16M8 8v.01M8 11v.01M8 14v.01" />
      </svg>
    );
  if (kind === "continent")
    return (
      <svg viewBox="0 0 24 24">
        <circle {...c} cx="12" cy="12" r="8.5" />
        <path {...c} d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" />
      </svg>
    );
  if (kind === "city")
    return (
      <svg viewBox="0 0 24 24">
        <path {...c} d="M12 21s6-5.3 6-10.2A6 6 0 0 0 6 10.8C6 15.7 12 21 12 21Z" />
        <circle {...c} cx="12" cy="10.6" r="2.2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24">
      <path {...c} d="M13 3 5 13h5l-1 8 8-11h-5l1-7Z" />
    </svg>
  );
}

// Animated trend-line icons for the real risers / fallers cards: an up-and-away
// line for risers, its mirror (down-and-away) for fallers. Both gently bob in
// their direction (see .moveico in global.css).
function MoveIcon({ dir }: { dir: "up" | "down" }) {
  const c = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (dir === "up") {
    return (
      <svg viewBox="0 0 24 24" className="moveico up">
        <path {...c} d="M4 15l5-5 3 3 6-7" />
        <path {...c} d="M14 6h5v5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="moveico down">
      <path {...c} d="M4 9l5 5 3-3 6 7" />
      <path {...c} d="M14 18h5v-5" />
    </svg>
  );
}

// Render a real skill risers/fallers card. Each row links to the skill heat map.
/**
 * Risers and fallers, in the dashboard's own idiom.
 *
 * Unchanged in substance — getMarketSkillMovers still measures mean daily live
 * vacancies against the prior window of the same length. What changed is that
 * these no longer sit alone: the priced rows above already establish that a
 * percentage on this pane is a DEMAND figure, so these can drop the long
 * caption that used to carry that job and show the movement itself.
 *
 * The pay figure is joined in from the market read, because a skill moving 30%
 * on $60k and one moving 30% on $160k are different news and the movers query
 * has never known what anything pays.
 */
/** $2,113,000,000 → "$2.11b". A magnitude, not an accountant's figure — the
 *  precision would imply a book that does not exist. */
function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}b`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

/**
 * What the archive could price in this market, stated before any price is shown.
 *
 * Three separate shortfalls, and they are not interchangeable:
 *
 *   priced/seen   skills in demand here that disclose enough pay to value. Perth
 *                 prices 23 of 100; showing 23 rows without saying so would read
 *                 as a market with 23 skills in it.
 *   days          the window drawn against the one requested. Collection began
 *                 2026-07-20, so a 30-day request currently draws about 9.
 *   unplaceable   priced ads carrying no hub. They can be valued but not placed,
 *                 so a worldwide index leaves them out — 9% of priced ads.
 */
function MarketCoverage({
  market,
  requested,
  loading,
}: {
  market: SkillMarket;
  requested: number;
  loading: boolean;
}) {
  const drawn = market.days.length;
  const short = drawn > 0 && drawn < requested;
  if (!drawn && !loading) return null;
  return (
    <div className="mktcov">
      <div className="mktcovnotes">
        <span>
          <b>{market.priced}</b> of {market.seen} skills priced
          {market.seen < market.taxonomy && ` · ${market.seen} of ${market.taxonomy} in demand`}
        </span>
        <span className={short ? "warn" : undefined}>
          {drawn ? `${drawn}-day window` : "no window"}
          {short && ` · ${requested} requested, ${drawn} collected`}
        </span>
        {market.unplaceable > 0 && (
          <span>
            <b>{market.unplaceable.toLocaleString("en-AU")}</b> priced ads carry no location, so
            they are left out of the worldwide index
          </span>
        )}
        {market.fxAsAt && <span>converted to AUD at rates as at {market.fxAsAt}</span>}
        {loading && <span className="dim">updating…</span>}
      </div>
    </div>
  );
}

function MoversCard({
  title,
  dir,
  rows,
  days,
  payOf,
  onSkill,
}: {
  title: string;
  dir: "up" | "down";
  rows: MarketSkillMover[];
  days: number;
  payOf: (skill: string) => number | null;
  onSkill: (skill: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <section className="mvr">
      <div className="ccsecth">
        <span className="cceyebrow">{title}</span>
        {/* The span rides in the eyebrow rather than a footer under both
            lists. It is not fixed — it is chosen from how much history the
            archive actually holds — so a percentage here means nothing
            without it. */}
        <span className="ccsecthsub">
          mean daily vacancies · {days}d vs prior {days}d
        </span>
      </div>
      <div className="mvrrows">
        {rows.map((m) => {
          const pay = payOf(m.skill);
          return (
            <button type="button" className="mvrrow" key={m.skill} onClick={() => onSkill(m.skill)}>
              <span className="mvrmain">
                <span className="mvrname">{m.skill}</span>
                <span className="mvrsub">
                  {m.cat} · {m.now} a day, from {m.prev}
                  {pay !== null && ` · $${Math.round(pay / 1000)}k median`}
                </span>
              </span>
              <span className={`mvrdelta ${dir}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                  <path
                    d={dir === "up" ? "M7 17 17 7M10.5 7H17v6.5" : "M7 7l10 10M10.5 17H17v-6.5"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {Math.abs(m.pct)}%
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WhatsTrendingPane() {
  const trendingOpen = useAppStore((s) => s.trendingOpen);
  const closeTrending = useAppStore((s) => s.closeTrending);
  const select = useAppStore((s) => s.select);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const setGlobalOut = useAppStore((s) => s.setGlobalOut);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const goDomestic = useAppStore((s) => s.goDomestic);

  // Open whenever toggled, on any layer — the mobile tab bar can trigger it from
  // the local view too, where the old `zoomedOut` gate left it silently closed.
  const open = trendingOpen;

  // WHICH AREA THE PANE IS ABOUT — the one the map is currently showing.
  //
  // The movers query used to take no scope at all, so the same worldwide
  // numbers appeared whether you were standing in Perth, over Australia, or out
  // at the globe. That is not a smaller version of the right answer, it is a
  // different question: Perth's own market can be cooling while the worldwide
  // total rises, and the pane would have shown the rise.
  //
  // The layer flags map straight onto scope — local city, domestic region, or
  // worldwide — using the same hub sets the analyst's scope chips resolve.
  const localCity = useAppStore((s) => s.localCity);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  /**
   * Places the reader can price. Built with the analyst's own resolvers rather
   * than a second set: the analyst already knows which hubs "Australia" means,
   * and two resolvers would eventually disagree about it.
   */
  const scopes = useMemo<ResolvedScope[]>(() => {
    const out: (ResolvedScope | null)[] = [];
    if (localCity) {
      out.push(scopeForCity(localCity));
      const cc = CITY_COUNTRY[localCity];
      if (cc) out.push(scopeForCountry(cc));
    }
    out.push(scopeForRegion(domesticRegion || CITY_CONTINENT[localCity]));
    out.push(WORLD_SCOPE);
    const seen = new Set<string>();
    return out
      .filter((x): x is ResolvedScope => !!x)
      .filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true)));
  }, [localCity, domesticRegion]);

  /**
   * The scope being priced. Held by value, not as an index: the chip row
   * rebuilds when the map moves, and an index would silently point at a
   * different place than the one whose figures are on screen.
   *
   * Null means "follow the map", which is what the pane did before it had a
   * control at all — so opening it still lands where the reader already is.
   */
  const [picked, setPicked] = useState<ResolvedScope | null>(null);
  const scope = picked ?? scopes[0] ?? WORLD_SCOPE;

  // Moving the map out from under an explicit pick invalidates it: the chips
  // rebuild around the new place and a figure still pinned to the old one would
  // be labelled with a scope the row no longer offers.
  useEffect(() => {
    setPicked(null);
  }, [localCity, domesticRegion]);

  // A skill priced in one market is not the same row in another, and its focus
  // should not survive the move.
  useEffect(() => {
    setPickedSkill(null);
  }, [scope.label]);

  const [windowDays, setWindowDays] = useState<number>(DEFAULT_MARKET_WINDOW);
  /** The skill the dashboard is focused on. Held here rather than in the rows,
   *  because step 5's hero chart reads the same selection. */
  const [pickedSkill, setPickedSkill] = useState<string | null>(null);
  const { market, loading: marketLoading } = useSkillMarket(
    scope.hubs,
    scope.label,
    windowDays,
    open,
  );

  // Real skill risers/fallers from the D1 archive, for THIS scope. Keyed on the
  // scope so moving between layers refetches rather than showing the last one's
  // answer. Only fetched once the pane is opened; refreshed a few times a day.
  const { data: movers, isFetching: moversFetching } = useQuery({
    queryKey: ["marketSkillMovers", scope.label, scope.hubs.join(",")],
    queryFn: () => getMarketSkillMovers({ data: scope }),
    enabled: open,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  const hasReal = !!movers && (movers.risers.length > 0 || movers.fallers.length > 0);

  // Real "Most viewed" — the companies / cities / regions / skills users
  // actually explore most (recorded via useViewTracking → D1). Falls back to
  // the static seed until any views have been recorded.
  const { data: viewed, isFetching: viewedFetching } = useQuery({
    queryKey: ["mostViewed"],
    queryFn: () => getMostViewed(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  const hasViews = !!viewed && viewed.length > 0;

  /**
   * The mark loader, over the pane, until BOTH reads have landed once.
   *
   * Only the FIRST open in a session shows it. React Query keeps both answers
   * for hours, so re-opening the pane renders them immediately and `data` is
   * already present — the condition below is false and nothing covers the card.
   * `isFetching` rather than `isPending` so a background refresh of an already
   * populated pane never throws the loader back up over readable content.
   *
   * Both queries are gated on `open`, so the first open is genuinely the first
   * time either runs. Covering the pane while they do is the honest alternative
   * to what this did before: render the static seeds instantly and swap them for
   * measured figures a moment later, which looks like the data changing.
   */
  const firstLoad = open && ((!movers && moversFetching) || (!viewed && viewedFetching));

  const activateViewedRow = (v: ViewedRow) => {
    if (v.kind === "company") select(v.ref);
    else if (v.kind === "city") {
      zoomInCity(v.ref);
      closeTrending();
    } else if (v.kind === "continent") {
      goDomestic(v.ref);
      closeTrending();
    } else if (v.kind === "skill") {
      toggleSkillQuery(v.ref);
      closeTrending();
    }
  };

  /** The market read already priced every skill in this scope, so the movers
   *  can borrow it rather than the server computing pay twice. */
  const payOf = useMemo(() => {
    const m = new Map(market.rows.map((r) => [r.skill, r.pay]));
    return (skill: string) => m.get(skill) ?? null;
  }, [market.rows]);

  const activateSkill = (skill: string) => {
    toggleSkillQuery(skill);
    closeTrending();
  };

  return (
    <>
      {open && <div className="panescrim" onClick={closeTrending} />}
      <aside className={`briefpane trendpane ${open ? "open" : ""}`} aria-hidden={!open}>
        {firstLoad && <CardLoader />}
        <div className="briefhead">
          <div className="briefmark">
            <svg
              className="trendmark"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <g className="flameicon">
                <path d="M12 3c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.8.8-3 1.9-4.1C10.6 8.1 11.5 6.2 12 3Z" />
                <path
                  className="flameember"
                  d="M12 10.5c.8 1.3 1.6 2 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1.1.8-1.8 1.6-3.1Z"
                />
              </g>
            </svg>
          </div>
          <div className="briefheadtxt">
            <div className="brieftitle">What's Trending</div>
            {/* Says what the number below it IS. The old copy read "Skill
                demand · month on month", which named neither the quantity nor
                the window: the pane shows advertised value, over whatever span
                the archive could cover. */}
            <div className="briefdate">Advertised value over the window</div>
          </div>
          <button className="briefclose" onClick={closeTrending} aria-label="Close">
            ✕
          </button>
        </div>

        {/* The scope every dollar figure on this pane depends on, and what the
            archive could actually price inside it. Both belong at the top: a
            price with no market is meaningless, and a coverage figure found
            after the numbers is a footnote nobody reads. */}
        <div className="mktbar">
          <div className="mktscopes" role="tablist" aria-label="Market">
            {scopes.map((sc) => (
              <button
                key={sc.label}
                role="tab"
                aria-selected={sc.label === scope.label}
                className={`mktscope ${sc.label === scope.label ? "on" : ""}`}
                onClick={() => setPicked(sc)}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>
        <div className="briefscroll">
          {/* The market's line, or one skill's when a row is picked. Above the
              rows it cross-filters with, so the selection and its effect are
              never separated by a scroll. */}
          <MarketHero
            market={market}
            skill={pickedSkill}
            onClear={() => setPickedSkill(null)}
            days={windowDays}
            onDays={setWindowDays}
          />
          <MarketCoverage market={market} requested={windowDays} loading={marketLoading} />
          <SkillMarketRows
            market={market}
            selected={pickedSkill}
            onPick={(sk) => setPickedSkill((cur) => (cur === sk ? null : sk))}
          />
          <div className="trendsnap">
            <div className="trendsnaphd">
              <span className="trendsnaptitle">Most viewed</span>
              <span className="trendsnapcap">What people are exploring now</span>
            </div>
            {hasViews ? (
              viewed!.slice(0, 3).map((v) => (
                <button
                  className="trendsnaprow"
                  key={`${v.kind}:${v.ref}`}
                  onClick={() => activateViewedRow(v)}
                >
                  <span className={`trendsnapic tv-${v.kind}`}>
                    <ViewedIcon kind={v.kind} />
                  </span>
                  <span className="trendsnapinfo">
                    <span className="trendsnaplabel">{v.label}</span>
                    <span className="trendsnapsub">{v.sub}</span>
                  </span>
                  <span className="trendsnapshare">
                    <b>{v.share}</b>
                    <span>of views</span>
                  </span>
                </button>
              ))
            ) : (
              // Was a hand-written seed reading "BHP 18% of views". Every other
              // figure on this pane is now measured, and one invented
              // percentage among them is worse than an empty state — it is
              // indistinguishable from the real ones.
              <div className="dataempty">No views recorded yet</div>
            )}
          </div>

          {hasReal && (
            <>
              <MoversCard
                title="Biggest risers"
                dir="up"
                rows={movers!.risers}
                days={movers!.windowDays}
                payOf={payOf}
                onSkill={activateSkill}
              />
              <MoversCard
                title="Biggest fallers"
                dir="down"
                rows={movers!.fallers}
                days={movers!.windowDays}
                payOf={payOf}
                onSkill={activateSkill}
              />
            </>
          )}
          {!hasReal && !moversFetching && market.rows.length > 0 && (
            <div className="brieffoot">
              No movers for {scope.label} yet — a skill needs enough daily vacancies in BOTH the
              recent window and the one before it before a change can be measured.
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
