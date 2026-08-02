import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDataQuality } from "../../lib/dataQualityFn";
import { useAppStore } from "../../state/store";

// The archive's own health, for administrators.
//
// Everything here already existed — scraper-health runs nightly in CI,
// audit-attribution.py and check-skills.ts run by hand — but only ever in a
// terminal. That is the wrong place for it: the whole reason those checks
// exist is that a broken feed looks exactly like an honest quiet market, and
// the person deciding whether to trust a number on a card was the one person
// who could not see the answer.
//
// The server function refuses a non-admin outright, so this component is not
// the gate. It only decides whether to ask.

/** A feed silent this long is a problem rather than a slow day. */
const STALE_DAYS = 2;

type SortKey = "source" | "live" | "total" | "lastSeen";

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
          {active ? (sort.dir === "asc" ? "\u2191" : "\u2193") : "\u2195"}
        </span>
      </button>
    </th>
  );
}

function FeedRowView({
  source,
  lastSeen,
  live,
  total,
  staleDays,
}: {
  source: string;
  lastSeen: string;
  live: number;
  total: number;
  staleDays: number;
}) {
  const stale = staleDays >= STALE_DAYS;
  return (
    <tr className={stale ? "dqstale" : undefined}>
      <td className="dqsrc">{source}</td>
      <td className="dqnum">{live.toLocaleString()}</td>
      <td className="dqnum dqmuted">{total.toLocaleString()}</td>
      <td className="dqwhen">
        {lastSeen || "never"}
        {stale && (
          <span className="dqflag" title="No write in the last two days">
            {staleDays >= 999 ? "no data" : `${staleDays}d silent`}
          </span>
        )}
      </td>
    </tr>
  );
}

export function DataQualityPane({ onClose }: { onClose: () => void }) {
  const isAdmin = useAppStore((s) => s.role) === "admin";
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

  const feeds = useMemo(() => {
    const rows = [...(data?.feeds ?? [])];
    const mul = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sort.key === "source") return mul * a.source.localeCompare(b.source);
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
  // the flags can never disagree.
  const silentCount = useMemo(
    () => (data?.feeds ?? []).filter((f) => f.staleDays >= STALE_DAYS).length,
    [data],
  );

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
                below is a point-in-time read of the archive and a stale tab
                showing yesterday's counts as today's is the obvious way to be
                misled by this card. */}
            <span className="dqeyebrow">Admin{data?.generated ? ` · ${data.generated}` : ""}</span>
            <span className="dqhdtitle">Control room</span>
          </div>
          <button className="dqx" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!isAdmin ? (
          <p className="dqmsg">Not permitted.</p>
        ) : isPending ? (
          <p className="dqmsg">Reading the archive…</p>
        ) : !data?.ok ? (
          <p className="dqmsg">{data?.error || "Couldn't read the archive."}</p>
        ) : (
          <div className="dqbody">
            <section className="dqsec">
              <div className="dqhrow">
                <h3 className="dqh">Feed freshness</h3>
                {/* The count, not just the flags in the rows: a silent feed is
                    the one thing on this card that is always worth acting on,
                    and it should be readable without scanning 24 rows. */}
                {silentCount > 0 && <span className="dqflagchip">{silentCount} silent</span>}
              </div>
              <p className="dqnote">
                A feed that stops writing looks identical to a quiet market. Anything silent for{" "}
                {STALE_DAYS} days or more is flagged.
              </p>
              <table className="dqtable">
                <thead>
                  <tr>
                    <SortHead col="source" label="Source" sort={sort} onSort={onSort} />
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
              <p className="dqcount2">
                Showing {feeds.length} of {data.feeds.length} sources.
              </p>
            </section>

            <section className="dqsec">
              <h3 className="dqh">Unmapped titles</h3>
              <p className="dqnote">
                {data.unmappedTotal.toLocaleString()} archived roles in the last 30 days matched no
                skill at all. They are counted as vacancies but contribute to no demand figure, so
                they are invisible exactly where they would matter. The recurring ones are the ones
                worth a taxonomy term.
              </p>
              {data.unmapped.length ? (
                <ul className="dqlist">
                  {data.unmapped.map((u) => (
                    <li key={u.title}>
                      <span className="dqcount">{u.n}</span>
                      <span className="dqtitle">{u.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dqmsg">Every recent role mapped to at least one skill.</p>
              )}
            </section>

            <section className="dqsec">
              <h3 className="dqh">Attribution suspects</h3>
              <p className="dqnote">
                Rows whose advertiser does not look like the company they are filed under. Most
                mismatches are legitimate brands — CHEP is Brambles — so only the two shapes that
                indicate a real fault are listed: a roster name matching only inside a word, and an
                advertiser that is a different roster company.
              </p>
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

            <p className="dqfoot">Read from the live archive · {data.generated}</p>
          </div>
        )}
      </div>
    </>
  );
}
