import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDataQuality } from "../../lib/dataQualityFn";
import { getEngagement, type Cohort } from "../../lib/engagementFn";
import { useAppStore } from "../../state/store";

/**
 * The admin console, built from `Admin_Panel.html`.
 *
 * Two tabs. DATA QUALITY is the archive's own health — feed freshness, unmapped
 * titles, attribution suspects — and existed before this design; it is restyled
 * to the design's cards here, not rewritten. USER ENGAGEMENT is new: leading
 * indicators, retention by signup cohort, lagging outcomes and time in app.
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

type SortKey = "source" | "kind" | "live" | "total" | "lastSeen";
type Tab = "data" | "engagement";

/**
 * Which way a column runs on its FIRST click.
 *
 * Not uniform, because the useful end differs by column. A count is being
 * scanned for the feed that has almost stopped writing, so it opens smallest
 * first; a date is being scanned for what ran most recently, so it opens
 * newest first. Clicking again reverses either.
 */
const FIRST_DIR: Record<SortKey, "asc" | "desc"> = {
  source: "asc",
  // Sorting by type is how you read the table by family — every government
  // board together, every career portal together — so it opens A-Z.
  kind: "asc",
  live: "asc",
  total: "asc",
  lastSeen: "desc",
};

function SortHead({
  col,
  label,
  numeric,
  sort,
  onSort,
}: {
  col: SortKey;
  label: string;
  numeric?: boolean;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === col;
  return (
    <th
      className={numeric ? "dqnum" : undefined}
      // Announces the sort to a screen reader rather than leaving the arrow as
      // the only signal, which is invisible to one.
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`dqsort${active ? " on" : ""}`}
        onClick={() => onSort(col)}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className="dqarrow" aria-hidden>
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function FeedRowView({
  source,
  kind,
  lastSeen,
  firstSeen,
  live,
  total,
  staleDays,
  historical,
}: {
  source: string;
  kind: string;
  lastSeen: string;
  firstSeen: string;
  live: number;
  total: number;
  staleDays: number;
  historical: boolean;
}) {
  // A closed corpus cannot be stale — see HISTORICAL_SOURCES. Flagging one
  // would put a red row on the panel permanently, and a warning that never
  // clears trains you to ignore the ones that matter.
  const stale = !historical && staleDays >= STALE_DAYS;
  return (
    <tr className={stale ? "dqstale" : undefined}>
      <td className="dqsrc">{source}</td>
      <td className="dqkind" title={kind}>
        {kind}
      </td>
      <td className="dqnum">{live.toLocaleString()}</td>
      <td className="dqnum dqmuted">{total.toLocaleString()}</td>
      <td className="dqwhen">
        {lastSeen || "never"}
        {stale && (
          <span className="dqflag" title="No write in the last two days">
            {staleDays >= 999 ? "no data" : `${staleDays}d silent`}
          </span>
        )}
        {historical && (
          <span
            className="dqhist"
            title="A finished backfill, not a live feed — it is not expected to write again"
          >
            historical {firstSeen.slice(0, 4)}–{lastSeen.slice(0, 4)}
          </span>
        )}
      </td>
    </tr>
  );
}

/** The design's KPI tile. `tone` marks a figure that is the bad direction. */
function Kpi({
  label,
  value,
  note,
  bad,
}: {
  label: string;
  value: string;
  note: string;
  bad?: boolean;
}) {
  return (
    <div className="dqkpi">
      <span className="dqkpilbl">{label}</span>
      <span className={`dqkpival${bad ? " bad" : ""}`}>{value}</span>
      <span className="dqkpinote">{note}</span>
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
  // Source A-Z to start: the table is also a checklist of every feed, and a
  // stable alphabetical order is what makes "is X still there" answerable at a
  // glance. Stale rows are flagged in colour regardless of sort, so the
  // actionable ones do not depend on ordering to be found.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "source",
    dir: "asc",
  });
  const onSort = (k: SortKey) =>
    setSort((cur) =>
      cur.key === k
        ? { key: k, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key: k, dir: FIRST_DIR[k] },
    );

  const { data, isPending } = useQuery({
    queryKey: ["dataQuality"],
    queryFn: () => getDataQuality(),
    // The archive moves once a day; re-reading it on every open would scan the
    // whole table for nothing.
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: isAdmin,
  });

  const { data: eng, isPending: engPending } = useQuery({
    queryKey: ["engagement", days],
    queryFn: () => getEngagement({ data: { days } }),
    // Events arrive continuously, so this is worth re-reading more often than
    // the archive — but not on every tab switch.
    staleTime: 2 * 60 * 1000,
    retry: false,
    enabled: isAdmin && tab === "engagement",
  });

  const feeds = useMemo(() => {
    const rows = [...(data?.feeds ?? [])];
    const mul = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sort.key === "source") return mul * a.source.localeCompare(b.source);
      // Type is a string, and the numeric branch below would subtract two of
      // them into NaN — which Array.sort treats as "equal" and silently leaves
      // the order untouched, so the column would look sorted and not be.
      // Ties fall back to source so the families read alphabetically inside.
      if (sort.key === "kind") {
        return mul * a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source);
      }
      if (sort.key === "lastSeen") {
        // ISO dates compare correctly as strings. A feed that has never
        // written sorts as the oldest possible, which is what it is.
        return mul * (a.lastSeen || "").localeCompare(b.lastSeen || "");
      }
      const d = a[sort.key] - b[sort.key];
      // Ties keep a predictable order rather than shuffling between renders.
      return d !== 0 ? mul * d : a.source.localeCompare(b.source);
    });
    return rows;
  }, [data?.feeds, sort]);

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

  const maxUnmapped = data?.unmapped?.[0]?.n ?? 1;
  const windowLabel = days === 1 ? "24 hours" : `${days} days`;

  return (
    <>
      {/* Same shell as the analyst card: a transparent scrim that closes on
          click, then a positioned card above it. Without the scrim + z-index
          this rendered underneath the map and the rail. */}
      <div className="panescrim" onClick={onClose} />
      <div className="dqpane" role="dialog" aria-label="Admin console">
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
            <p className="dqmsg">Reading the archive…</p>
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
                  value={`${silentCount} / ${liveFeeds}`}
                  note={
                    silentCount
                      ? "A silent feed reads as a quiet market."
                      : "Every source wrote in the last two days."
                  }
                  bad={silentCount > 0}
                />
                <Kpi
                  label="Unmapped 30d"
                  value={data.unmappedTotal.toLocaleString()}
                  note="Roles that matched no skill."
                />
                <Kpi
                  label="Attribution suspects"
                  value={data.attribution.length.toLocaleString()}
                  note="Two fault shapes only."
                />
              </div>

              <section className="dqcard">
                <div className="dqcardhd">
                  <div className="dqcardtext">
                    <span className="dqcardtitle">Feed freshness</span>
                    <span className="dqcardsub">
                      A feed that stops writing looks identical to a quiet market. Anything silent
                      for {STALE_DAYS} days or more is flagged.
                    </span>
                  </div>
                  {silentCount > 0 && <span className="dqflagchip">{silentCount} silent</span>}
                </div>
                <table className="dqtable">
                  <thead>
                    <tr>
                      <SortHead col="source" label="Source" sort={sort} onSort={onSort} />
                      <SortHead col="kind" label="Type" sort={sort} onSort={onSort} />
                      <SortHead col="live" label="Live" numeric sort={sort} onSort={onSort} />
                      <SortHead col="total" label="Archived" numeric sort={sort} onSort={onSort} />
                      <SortHead col="lastSeen" label="Last write" sort={sort} onSort={onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {feeds.map((f) => (
                      <FeedRowView key={f.source} {...f} />
                    ))}
                  </tbody>
                </table>
                <p className="dqcardfoot">
                  Showing {feeds.length} of {data.feeds.length} sources.
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
