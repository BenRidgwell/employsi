import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getDataQuality,
  type FeedRow,
  type IngestBucket,
  type MatchRate,
} from "../../lib/dataQualityFn";
import { CRAWL_FAMILIES, nextForFamily, untilLabel } from "../../lib/crawlSchedule";
import { crawlTriggerAvailable, runCrawl } from "../../lib/runCrawlFn";
import { CardLoader } from "./CardLoader";
import { getEngagement, type Cohort } from "../../lib/engagementFn";
import { useAppStore } from "../../state/store";

/**
 * The admin console, built from `Admin_Panel.html` and restyled to
 * `Control_Room.html` on 2026-09-21.
 *
 * WHAT THE SECOND DESIGN CHANGED. It drops the sortable freshness TABLE for a
 * list of rows filtered to Silent / All — five sort columns replaced by the one
 * question the card is for. Three cards are new: ingest volume, skill match
 * rate, and scheduled crawls with a Run now trigger.
 *
 * The design's own SHELL is deliberately not used: it draws a centred overlay
 * up to 1400px, and this is a 940px pane sized to match What's trending, so the
 * three cards opening from the same rail are one surface rather than three. See
 * the .dqpane comment in global.css.
 *
 * EVERY FIGURE ON THOSE THREE IS QUERIED, NOT TAKEN FROM THE MOCKUP. The design
 * ships plausible numbers — 75,757 live, 92.1% matched, 919,552 mapped — and
 * none of them is in this code. Ingest volume and match rate are aggregates
 * added to dataQualityFn; the crawl times are computed from the Worker's real
 * cron expressions. A design's placeholder figure rendered as live data is the
 * exact failure this codebase keeps writing checks against.
 *
 * Two tabs. DATA QUALITY is the archive's own health — feed freshness, unmapped
 * titles, attribution suspects — and existed before either design. USER
 * ENGAGEMENT is leading indicators, retention by signup cohort, lagging
 * outcomes and time in app.
 *
 * Those four sections were the reason this went in two passes. Nothing in the
 * app recorded a search, a card opened or how long anyone stayed, so there was
 * no honest way to draw them — the archive knows about vacancies, and the auth
 * tables know when an account was created and when a token was issued, which
 * answers "did they authenticate", not "did they come back and use it". The
 * capture is migrations/0005_app_event.sql + lib/events.ts + lib/analytics.ts,
 * and this pane now reads it.
 *
 * WHAT THE READER IS TOLD, AND WHY
 * The capture is new, so for a while every engagement figure will be low for a
 * reason that has nothing to do with the product. A young table looks exactly
 * like a dead product, so the pane states when capture began and how many
 * events exist rather than letting a small number speak for itself. That is the
 * same discipline the data tab already applies to a silent feed.
 *
 * The range control (24h / 7d / 30d) changes the trailing window for Lagging,
 * Time in app and the KPI row — the three things a window can honestly change.
 * Leading indicators are weekly by definition and cohorts are keyed on signup
 * week; both say so on the card rather than appearing to respond to a control
 * they ignore.
 *
 * The server function refuses a non-admin outright, so this component is not
 * the gate. It only decides whether to ask.
 */

/** A feed silent this long is a problem rather than a slow day. */
const STALE_DAYS = 2;

type Tab = "data" | "engagement";

/**
 * The design's KPI tile. `bad` marks a figure that is the bad direction; `of`
 * is the quieter denominator in "9 / 90".
 */
function Kpi({
  label,
  value,
  of,
  note,
  bad,
}: {
  label: string;
  value: string;
  of?: string;
  note: string;
  bad?: boolean;
}) {
  return (
    <div className="dqkpi">
      <span className="dqkpilbl">{label}</span>
      <span className={`dqkpival${bad ? " bad" : ""}`}>
        {value}
        {of ? <span className="dqkpiof"> / {of}</span> : null}
      </span>
      <span className="dqkpinote">{note}</span>
    </div>
  );
}

/**
 * Ingest volume: rows that FIRST appeared in each month, split into still
 * advertised and since taken down.
 *
 * Heights are a share of the tallest month rather than an absolute scale, and
 * the axis is labelled from the same maximum, so the two cannot disagree. The
 * series arrives already clamped to the span the live feeds cover — see
 * dataQualityFn — because an unclamped version of this chart draws the archive
 * filling out and reads as a hiring surge.
 */
function IngestChart({ buckets }: { buckets: IngestBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.live + b.archived));
  // Round the axis top to something a person can read off.
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * 4;
  const tick = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  return (
    <div className="dqchart">
      <div className="dqchartax" aria-hidden>
        <span>{tick(top)}</span>
        <span>{tick(top * 0.75)}</span>
        <span>{tick(top * 0.5)}</span>
        <span>{tick(top * 0.25)}</span>
        <span>0</span>
      </div>
      <div
        className="dqchartplot"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))` }}
      >
        {buckets.map((b) => {
          const solo = b.live === 0 || b.archived === 0;
          return (
            <div key={b.month} className={`dqbarcol${solo ? " solo" : ""}`}>
              <div
                className="dqbararch"
                style={{ height: `${(b.archived / top) * 100}%` }}
                title={`${b.archived.toLocaleString()} archived`}
              />
              <div
                className="dqbarlive"
                style={{ height: `${(b.live / top) * 100}%` }}
                title={`${b.live.toLocaleString()} still advertised`}
              />
              <div className="dqbarlbl">{b.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Skill match rate, as the design's half-gauge. */
function MatchGauge({ match }: { match: MatchRate }) {
  // 251.3 is the arc's length; the offset is the unfilled remainder.
  const LEN = 251.3;
  const offset = LEN * (1 - Math.min(1, Math.max(0, match.pct / 100)));
  const dp = match.prevPct === null ? null : match.pct - match.prevPct;
  return (
    <>
      <div className="dqgauge">
        <svg viewBox="0 0 200 120" role="img" aria-label={`${match.pct.toFixed(1)} percent mapped`}>
          <path
            d="M20,110 A80,80 0 0 1 180,110"
            fill="none"
            stroke="var(--neutral-200)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M20,110 A80,80 0 0 1 180,110"
            fill="none"
            stroke="var(--neutral-900)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={LEN}
            strokeDashoffset={offset}
          />
          <text
            x="100"
            y="98"
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
            fontSize="34"
            fontWeight="600"
            fill="var(--text-primary)"
            letterSpacing="-1"
          >
            {match.pct.toFixed(1)}%
          </text>
        </svg>
      </div>
      <div className="dqgaugenote">
        {/* No comparison is drawn until a full prior window exists, rather than
            showing a swing measured off nothing. */}
        {dp === null
          ? "No prior 30-day window to compare against yet."
          : `${dp >= 0 ? "Up" : "Down"} ${Math.abs(dp).toFixed(1)} pts vs the 30 days before.`}
      </div>
      <div className="dqsplit">
        <div className="dqsplitcell">
          <span className="dqsplitlbl">Mapped</span>
          <span className="dqsplitval">{match.mapped.toLocaleString()}</span>
        </div>
        <div className="dqsplitcell">
          <span className="dqsplitlbl">Unmapped</span>
          <span className="dqsplitval">{match.unmapped.toLocaleString()}</span>
        </div>
      </div>
    </>
  );
}

/** The design's feed row. Replaces the sortable table. */
function FeedCard({ f }: { f: FeedRow }) {
  const stale = !f.historical && f.staleDays >= STALE_DAYS;
  return (
    <div className={`dqfeed${stale ? " silent" : ""}`}>
      <div className="dqfeedicon" aria-hidden>
        {f.source.slice(0, 2).toUpperCase()}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="dqfeedname">
          <span className="dqfeedsrc">{f.source}</span>
          <span className="dqfeedkind">{f.kind}</span>
        </div>
        <div className="dqfeedmeta">
          <span>{f.total.toLocaleString()} archived</span>
          <span>{f.live.toLocaleString()} live</span>
          <span>last write {f.lastSeen || "never"}</span>
        </div>
      </div>
      {f.historical ? (
        <span
          className="dqfeedpill hist"
          title="A finished backfill, not a live feed — it is not expected to write again"
        >
          historical {f.firstSeen.slice(0, 4)}–{f.lastSeen.slice(0, 4)}
        </span>
      ) : (
        <span className={`dqfeedpill${stale ? " bad" : ""}`}>
          {f.staleDays >= 999 ? "no data" : stale ? `${f.staleDays}d silent` : "current"}
        </span>
      )}
    </div>
  );
}

/** The design's inline bar sparkline. Heights are relative to the run's own max. */
function Spark({ series }: { series: number[] }) {
  const max = Math.max(1, ...series);
  return (
    <span className="dqspark" aria-hidden>
      {series.map((v, i) => (
        <span
          key={i}
          className="dqsparkbar"
          style={{ height: `${Math.round((v / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

function delta(d: number | null): { text: string; cls: string } {
  if (d === null) return { text: "—", cls: "flat" };
  if (d === 0) return { text: "0", cls: "flat" };
  return { text: `${d > 0 ? "+" : ""}${d.toLocaleString()}`, cls: d > 0 ? "up" : "down" };
}

function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

/** A retention cell: a share of its cohort, shaded by that share. */
function CohortCell({ size, value }: { size: number; value: number | null }) {
  if (value === null) return <span className="dqcell dim">·</span>;
  const pct = size ? Math.round((value / size) * 100) : 0;
  // Five steps rather than a gradient, so two cells that differ by a point do
  // not read as different and a reader is not asked to judge a colour ramp.
  const step = pct === 0 ? 0 : pct < 15 ? 1 : pct < 30 ? 2 : pct < 50 ? 3 : 4;
  return (
    <span className={`dqcell s${step}`} title={`${value} of ${size}`}>
      {pct}%
    </span>
  );
}

function CohortRow({ c }: { c: Cohort }) {
  return (
    <div className="dqcohortrow">
      <span className="dqcohortwk">{c.week}</span>
      <span className="dqcohortn">{c.size}</span>
      {c.cells.map((v, i) => (
        <CohortCell key={i} size={c.size} value={v} />
      ))}
    </div>
  );
}

export function DataQualityPane({ onClose }: { onClose: () => void }) {
  const isAdmin = useAppStore((s) => s.role) === "admin";
  const [tab, setTab] = useState<Tab>("data");
  const [days, setDays] = useState<1 | 7 | 30>(30);
  /**
   * Feed freshness opens on SILENT, not on the full list.
   *
   * The card answers one question — has anything stopped writing — and with
   * forty-odd sources the full list buries the two that matter. "All" is one
   * click away and is what the list was before the redesign.
   */
  const [feedView, setFeedView] = useState<"silent" | "all">("silent");
  const [feedsOpen, setFeedsOpen] = useState(false);
  // isFetching, not isPending: React Query keeps the archive read for ten
  // minutes, so a second open in the same session has data already and must NOT
  // flash a loader over content that is right there. The loader is for the
  // FIRST open, where there is nothing to show yet — same rule as What's
  // trending, and the same reason the two use one component.
  const {
    data,
    isPending,
    isFetching,
    refetch: refetchQuality,
  } = useQuery({
    queryKey: ["dataQuality"],
    queryFn: () => getDataQuality(),
    // The archive moves once a day; re-reading it on every open would scan the
    // whole table for nothing.
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: isAdmin,
  });

  const {
    data: eng,
    isPending: engPending,
    isFetching: engFetching,
  } = useQuery({
    queryKey: ["engagement", days],
    queryFn: () => getEngagement({ data: { days } }),
    // Events arrive continuously, so this is worth re-reading more often than
    // the archive — but not on every tab switch.
    staleTime: 2 * 60 * 1000,
    retry: false,
    enabled: isAdmin && tab === "engagement",
  });

  /**
   * The freshness rows, unordered here on purpose: `visibleFeeds` below applies
   * the only order this card wants — silent first, longest-silent first. The
   * sortable table this replaced let you re-order by five columns, which the
   * design drops in favour of a Silent / All filter.
   */
  const feeds = useMemo(() => [...(data?.feeds ?? [])], [data?.feeds]);

  // Silent feeds, counted off the SAME rows the table flags, so the chip and
  // the flags can never disagree — including the historical exemption.
  const silentCount = useMemo(
    () => (data?.feeds ?? []).filter((f) => !f.historical && f.staleDays >= STALE_DAYS).length,
    [data],
  );
  // The denominator has to drop with the numerator: "1 / 41" when one of those
  // 41 is a finished backfill overstates how many feeds are actually watched.
  const liveFeeds = useMemo(() => (data?.feeds ?? []).filter((f) => !f.historical).length, [data]);

  const liveTotal = useMemo(() => (data?.feeds ?? []).reduce((a, f) => a + f.live, 0), [data]);

  /** What the chosen view covers, silent-first so the actionable rows lead. */
  const visibleFeeds = useMemo(() => {
    const rows = feeds.filter((f) =>
      feedView === "all" ? true : !f.historical && f.staleDays >= STALE_DAYS,
    );
    return [...rows].sort((a, b) => {
      const as = !a.historical && a.staleDays >= STALE_DAYS ? 0 : 1;
      const bs = !b.historical && b.staleDays >= STALE_DAYS ? 0 : 1;
      return as - bs || b.staleDays - a.staleDays || a.source.localeCompare(b.source);
    });
  }, [feeds, feedView]);
  /** Collapsed to the design's short list until asked for the rest. */
  const FEED_PREVIEW = 6;
  const shownFeeds = feedsOpen ? visibleFeeds : visibleFeeds.slice(0, FEED_PREVIEW);
  const hiddenFeeds = visibleFeeds.length - shownFeeds.length;

  /**
   * Next firing per crawl family. Recomputed on each open rather than ticking:
   * the card is read, not watched, and a timer re-rendering the whole console
   * every minute to move one label is not worth the renders.
   */
  const crawls = useMemo(() => {
    const now = new Date();
    return CRAWL_FAMILIES.map((f) => {
      const at = nextForFamily(f, now);
      return { f, at, until: at ? untilLabel(at, now) : null };
    });
  }, []);

  /**
   * Whether this deployment can fire a crawl at all. Secrets are per-Worker, so
   * the answer differs between production and preview and cannot be assumed.
   */
  const { data: trigger } = useQuery({
    queryKey: ["crawlTrigger"],
    queryFn: () => crawlTriggerAvailable(),
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: isAdmin && tab === "data",
  });

  const [runs, setRuns] = useState<
    Record<string, { state: "running" | "done" | "error"; text: string }>
  >({});

  /**
   * Fire one family, after confirming.
   *
   * THE CONFIRM IS NOT DECORATION. This is the only control in the console that
   * writes, it writes to the production archive from whichever deployment is
   * serving the page, and the rest of this card is a read-only schedule — so
   * the button sits among things that do nothing. Naming the family and the
   * consequence makes an accidental press hard rather than one click away.
   */
  const fireCrawl = async (id: string, title: string) => {
    const f = CRAWL_FAMILIES.find((x) => x.id === id);
    const n = f?.endpoints.length ?? 1;
    const ok = window.confirm(
      `Run "${title}" now?\n\n` +
        `This fires ${n === 1 ? "one scrape" : `${n} scrapes`} immediately and writes the ` +
        `results to the LIVE archive — the same D1 the public site reads. It is safe to ` +
        `repeat (rows upsert on job_key) but it spends upstream API quota.`,
    );
    if (!ok) return;

    setRuns((r) => ({ ...r, [id]: { state: "running", text: "" } }));
    try {
      const res = await runCrawl({ data: { family: id } });
      const parts = res.steps.map(
        (s) =>
          `${s.path.replace("/run", "") || "shard"} ${s.ok ? "✓" : `✗ ${s.status}`} ${s.detail}`,
      );
      const secs = (res.ms / 1000).toFixed(1);
      setRuns((r) => ({
        ...r,
        [id]: {
          state: res.ok ? "done" : "error",
          // The failure reason is shown, not swallowed into "failed" — a 403
          // means the token is wrong, a timeout means the scrape is slow, and
          // those need different responses.
          text: res.error ? res.error : `${parts.join(" · ")} — ${secs}s`,
        },
      }));
      // The archive has changed, so the figures above are now stale. Refetching
      // is the point of having run it.
      if (res.ok) void refetchQuality();
    } catch (e) {
      setRuns((r) => ({
        ...r,
        [id]: { state: "error", text: (e as Error)?.message || "Run failed." },
      }));
    }
  };

  // Nothing to draw yet on this tab: the white loader covers the wait rather
  // than showing an empty card that reads as an empty archive.
  const firstLoad = tab === "data" ? !data && isFetching : !eng && engFetching;

  const maxUnmapped = data?.unmapped?.[0]?.n ?? 1;
  const windowLabel = days === 1 ? "24 hours" : `${days} days`;

  return (
    <>
      {/* Same shell as the analyst card: a transparent scrim that closes on
          click, then a positioned card above it. Without the scrim + z-index
          this rendered underneath the map and the rail. */}
      <div className="panescrim" onClick={onClose} />
      <div className="dqpane" role="dialog" aria-label="Admin console">
        {firstLoad && <CardLoader />}
        <div className="dqhd">
          <div className="dqhdtext">
            {/* The design's eyebrow carries the read time, because every figure
                below is a point-in-time read and a stale tab showing
                yesterday's counts as today's is the obvious way to be misled. */}
            <span className="dqeyebrow">Admin{data?.generated ? ` · ${data.generated}` : ""}</span>
            <span className="dqhdtitle">Control room</span>
          </div>
          <div className="dqhdctl">
            <div className="dqrange" role="group" aria-label="Window">
              {([1, 7, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`dqrangebtn${days === d ? " on" : ""}`}
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                >
                  {d === 1 ? "24h" : `${d}d`}
                </button>
              ))}
            </div>
            <button className="dqx" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="dqtabs" role="tablist">
          {(
            [
              { key: "data", label: "Data quality" },
              { key: "engagement", label: "User engagement" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`dqtab${tab === t.key ? " on" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!isAdmin ? (
          <p className="dqmsg">Not permitted.</p>
        ) : tab === "data" ? (
          isPending ? (
            <p className="dqmsg" aria-live="polite">
              Reading the archive…
            </p>
          ) : !data?.ok ? (
            <p className="dqmsg">{data?.error || "Couldn't read the archive."}</p>
          ) : (
            <div className="dqbody">
              <div className="dqkpis">
                <Kpi
                  label="Live vacancies"
                  value={liveTotal.toLocaleString()}
                  note={`Across ${data.feeds.length} sources.`}
                />
                <Kpi
                  label="Silent feeds"
                  value={String(silentCount)}
                  of={String(liveFeeds)}
                  note={
                    silentCount
                      ? `Silent ${STALE_DAYS} days or more.`
                      : "Every source wrote in the last two days."
                  }
                  bad={silentCount > 0}
                />
                <Kpi
                  label="Unmapped · 30d"
                  value={data.unmappedTotal.toLocaleString()}
                  note={`${(100 - data.match.pct).toFixed(1)}% matched no skill`}
                />
                <Kpi
                  label="Attribution suspects"
                  value={data.attribution.length.toLocaleString()}
                  note="Two fault shapes only."
                />
              </div>

              <div className="dqpair dqpairwide">
                <section className="dqcard">
                  <div className="dqcardhd">
                    <span className="dqcardtitle">Ingest volume</span>
                    <div className="dqlegend">
                      <span>
                        <span className="dqdot live" aria-hidden /> Live
                      </span>
                      <span>
                        <span className="dqdot arch" aria-hidden /> Archived
                      </span>
                    </div>
                  </div>
                  {data.ingest.length ? (
                    <>
                      <IngestChart buckets={data.ingest} />
                      {/* Said on the card, not in a comment: the series starts
                          where it does because of feed coverage, and a reader
                          who assumes it starts at the archive's beginning will
                          read the first bar as a collapse in hiring. */}
                      <p className="dqcardfoot">
                        By the month a role first appeared. Starts{" "}
                        {data.ingestFrom ? data.ingestFrom.slice(0, 7) : "at the archive's start"},
                        the first month every currently-writing feed covers — earlier months are
                        short because the archive was still filling out, not because hiring was.
                      </p>
                    </>
                  ) : (
                    <p className="dqmsg">Not enough coverage yet to draw a monthly series.</p>
                  )}
                </section>

                <section className="dqcard">
                  <div className="dqcardhd">
                    <span className="dqcardtitle">Skill match rate</span>
                    <span className="dqeyebrow">Last 30 days</span>
                  </div>
                  <MatchGauge match={data.match} />
                </section>
              </div>

              <section className="dqcard">
                <div className="dqcardhd">
                  <div className="dqcardtext">
                    <div className="dqfeedname">
                      <span className="dqcardtitle">Feed freshness</span>
                      {silentCount > 0 && <span className="dqflagchip">{silentCount} silent</span>}
                    </div>
                    <span className="dqcardsub">
                      A feed that stops writing looks identical to a quiet market. Anything silent
                      for {STALE_DAYS} days or more is flagged.
                    </span>
                  </div>
                  <div className="dqviews" role="group" aria-label="Which feeds to show">
                    {(
                      [
                        { key: "silent", label: "Silent" },
                        { key: "all", label: "All" },
                      ] as const
                    ).map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        className={`dqview${feedView === v.key ? " on" : ""}`}
                        aria-pressed={feedView === v.key}
                        onClick={() => setFeedView(v.key)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
                {shownFeeds.length ? (
                  <div className="dqfeeds">
                    {shownFeeds.map((f) => (
                      <FeedCard key={f.source} f={f} />
                    ))}
                  </div>
                ) : (
                  <p className="dqmsg">
                    {feedView === "silent"
                      ? "Every source wrote in the last two days."
                      : "No sources in the archive."}
                  </p>
                )}
                {hiddenFeeds > 0 && (
                  <button type="button" className="dqmore" onClick={() => setFeedsOpen(true)}>
                    Show {hiddenFeeds} more {hiddenFeeds === 1 ? "source" : "sources"}
                  </button>
                )}
                <p className="dqcardfoot">
                  Showing {shownFeeds.length} of {visibleFeeds.length}{" "}
                  {feedView === "silent" ? "silent" : ""} sources.
                </p>
              </section>

              <div className="dqpair">
                <section className="dqcard">
                  <div className="dqcardhd">
                    <div className="dqcardtext">
                      <span className="dqcardtitle">Unmapped titles</span>
                      <span className="dqcardsub">
                        {data.unmappedTotal.toLocaleString()} archived roles in the last 30 days
                        matched no skill at all. They count as vacancies but contribute to no demand
                        figure, so they are invisible exactly where they would matter.
                      </span>
                    </div>
                  </div>
                  {data.unmapped.length ? (
                    <ul className="dqlist">
                      {data.unmapped.map((u) => (
                        <li key={u.title}>
                          <span className="dqcount">{u.n}</span>
                          <span className="dqtitle">{u.title}</span>
                          <span className="dqbar" aria-hidden>
                            <span style={{ width: `${Math.round((u.n / maxUnmapped) * 100)}%` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dqmsg">Every recent role mapped to at least one skill.</p>
                  )}
                </section>

                <section className="dqcard">
                  <div className="dqcardhd">
                    <div className="dqcardtext">
                      <span className="dqcardtitle">Attribution suspects</span>
                      <span className="dqcardsub">
                        Advertisers that do not look like the company they are filed under. Most
                        mismatches are legitimate brands — CHEP is Brambles — so only the two shapes
                        that indicate a real fault are listed.
                      </span>
                    </div>
                  </div>
                  {data.attribution.length ? (
                    <ul className="dqlist">
                      {data.attribution.map((a) => (
                        <li key={`${a.source}|${a.companyId}|${a.advertiser}`}>
                          <span className="dqcount">{a.n}</span>
                          <span className="dqtitle">
                            <strong>{a.advertiser}</strong> filed under {a.companyId}{" "}
                            <span className="dqmuted">({a.rosterName})</span>
                            <span className="dqwhy">{a.reason}</span>
                          </span>
                          <span className="dqsrctag">{a.source}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dqmsg">No suspect attributions in the last 30 days.</p>
                  )}
                </section>
              </div>

              <section className="dqcard">
                <div className="dqcardtext">
                  <span className="dqcardtitle">Scheduled crawls</span>
                  <span className="dqcardsub">
                    When each family next fires, in UTC. A feed silent since before its last run has
                    stopped; one silent since after it simply has not run yet — running it early is
                    how you tell those apart without waiting for the tick.{" "}
                    <strong>Run now writes to the live archive</strong>, from this deployment and
                    every other, because the D1 binding is shared.
                  </span>
                </div>
                <div className="dqcrawls">
                  {crawls.map(({ f, at, until }) => {
                    const r = runs[f.id];
                    return (
                      <div key={f.id} className="dqcrawl">
                        <div className="dqcrawlicon" aria-hidden>
                          {f.crons.length}×
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="dqcrawltitle">{f.title}</div>
                          <div className="dqcrawlwhen">{f.covers}</div>
                          {/* The outcome replaces nothing — it is added below
                              the line, so the schedule stays readable while a
                              run is in flight and after it finishes. */}
                          {r && (
                            <div className={`dqrunout${r.state === "error" ? " bad" : ""}`}>
                              {r.state === "running"
                                ? `Running ${f.endpoints.length > 1 ? `${f.endpoints.length} scrapes` : "…"}`
                                : r.text}
                            </div>
                          )}
                        </div>
                        <div className="dqcrawlact">
                          <span className="dqcrawlnext">
                            {/* Suppressed rather than guessed when the
                                expression is one nextRun refuses to read. */}
                            {at
                              ? `${at.toISOString().slice(11, 16)} UTC · ${until}`
                              : "schedule unread"}
                          </span>
                          {trigger?.ok ? (
                            <button
                              type="button"
                              className="dqrun"
                              disabled={r?.state === "running"}
                              onClick={() => fireCrawl(f.id, f.title)}
                            >
                              {r?.state === "running" ? "Running…" : "Run now"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Not a dead button: when the token is missing the card says
                    why instead of offering one that always fails. */}
                {trigger && !trigger.ok && <p className="dqcardfoot">{trigger.reason}</p>}
              </section>

              <p className="dqfoot">Read from the live archive · {data.generated}</p>
            </div>
          )
        ) : engPending ? (
          <p className="dqmsg">Reading events…</p>
        ) : !eng?.ok ? (
          <p className="dqmsg">{eng?.error || "Couldn't read the event log."}</p>
        ) : (
          <div className="dqbody">
            {/* Said before any figure, not after: until the table has some
                history every number here is low for a reason that has nothing
                to do with the product. */}
            <p className="dqnote">
              {eng.events
                ? `${eng.events.toLocaleString()} events captured since ${eng.since}.`
                : "No events captured yet. Figures below will fill in as the app is used."}
            </p>

            <div className="dqkpis">
              <Kpi
                label={`Signed-in ${days === 1 ? "24h" : `${days}d`}`}
                value={(eng.lagging.find((l) => l.key === "users")?.value ?? 0).toLocaleString()}
                note={`Distinct accounts in the last ${windowLabel}.`}
              />
              <Kpi
                label="Median session"
                value={duration(eng.medianSessionMs)}
                note={
                  eng.medianSessionMs === null
                    ? "No completed sessions recorded yet."
                    : "Median, not mean — one long-open tab skews a mean."
                }
              />
              <Kpi
                label="New accounts"
                value={(eng.lagging.find((l) => l.key === "signups")?.value ?? 0).toLocaleString()}
                note={`Signed up in the last ${windowLabel}.`}
              />
              <Kpi
                label="Follows added"
                value={(eng.lagging.find((l) => l.key === "follows")?.value ?? 0).toLocaleString()}
                note="Companies and skills."
              />
            </div>

            <section className="dqcard">
              <div className="dqcardhd">
                <div className="dqcardtext">
                  <span className="dqcardtitle">Leading indicators</span>
                  <span className="dqcardsub">
                    Signed-in behaviour this week, against the eight weeks before it. Weekly by
                    definition, so the window control above does not change these.
                  </span>
                </div>
              </div>
              <div className="dqleading">
                {eng.leading.map((l) => {
                  const d = delta(l.delta);
                  return (
                    <div className="dqlead" key={l.key}>
                      <span className="dqleadlbl">{l.label}</span>
                      <span className="dqleadrow">
                        <span className="dqleadval">{l.value.toLocaleString()}</span>
                        <span className={`dqleaddelta ${d.cls}`}>{d.text}</span>
                      </span>
                      <Spark series={l.series} />
                      <span className="dqleadnote">{l.note}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="dqpair dqpairwide">
              <section className="dqcard">
                <div className="dqcardhd">
                  <div className="dqcardtext">
                    <span className="dqcardtitle">Retention by signup cohort</span>
                    <span className="dqcardsub">
                      Share of each signup week seen again in the weeks after. Measured from signup,
                      not from first activity — measuring from first activity quietly drops everyone
                      who signed up and never came back, which is the group this is about.
                    </span>
                  </div>
                </div>
                {eng.cohorts.length ? (
                  <div className="dqcohort">
                    <div className="dqcohorthd">
                      <span>Cohort</span>
                      <span className="dqcohortn">Size</span>
                      <span>W1</span>
                      <span>W2</span>
                      <span>W3</span>
                      <span>W4</span>
                      <span>W5</span>
                    </div>
                    {eng.cohorts.map((c) => (
                      <CohortRow key={c.week} c={c} />
                    ))}
                    <p className="dqcardfoot">A dot is a week that has not happened yet.</p>
                  </div>
                ) : (
                  <p className="dqmsg">No signups in the last twelve weeks.</p>
                )}
              </section>

              <div className="dqstack">
                <section className="dqcard">
                  <div className="dqcardhd">
                    <div className="dqcardtext">
                      <span className="dqcardtitle">Lagging</span>
                      <span className="dqcardsub">
                        Outcomes over the last {windowLabel}, against the {windowLabel} before.
                      </span>
                    </div>
                  </div>
                  {eng.lagging.map((g) => {
                    const d = delta(g.delta);
                    return (
                      <div className="dqlagrow" key={g.key}>
                        <span className="dqlagtext">
                          <span className="dqlaglbl">{g.label}</span>
                          <span className="dqlagnote">{g.note}</span>
                        </span>
                        <span className="dqlagvals">
                          <span className="dqlagval">{g.value.toLocaleString()}</span>
                          <span className={`dqleaddelta ${d.cls}`}>{d.text}</span>
                        </span>
                      </div>
                    );
                  })}
                </section>

                <section className="dqcard">
                  <div className="dqcardhd">
                    <div className="dqcardtext">
                      <span className="dqcardtitle">Time in app</span>
                      <span className="dqcardsub">
                        Session length over the last {windowLabel}. A session is closed out when the
                        tab is hidden or closed, so one left open overnight is capped rather than
                        counted.
                      </span>
                    </div>
                  </div>
                  {eng.timeBands.some((b) => b.sessions) ? (
                    <>
                      {eng.timeBands.map((b) => (
                        <div className="dqbandrow" key={b.band}>
                          <span className="dqband">{b.band}</span>
                          <span className="dqbandbar" aria-hidden>
                            <span style={{ width: `${b.pct}%` }} />
                          </span>
                          <span className="dqbandpct">{b.pct}%</span>
                        </div>
                      ))}
                      <p className="dqcardfoot">Median session {duration(eng.medianSessionMs)}.</p>
                    </>
                  ) : (
                    <p className="dqmsg">No completed sessions in this window yet.</p>
                  )}
                </section>
              </div>
            </div>

            <p className="dqfoot">Read from the event log · {eng.generated}</p>
          </div>
        )}
      </div>
    </>
  );
}
