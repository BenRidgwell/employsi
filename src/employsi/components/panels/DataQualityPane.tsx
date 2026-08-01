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

  const { data, isPending } = useQuery({
    queryKey: ["dataQuality"],
    queryFn: () => getDataQuality(),
    // The archive moves once a day; re-reading it on every open would scan the
    // whole table for nothing.
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: isAdmin,
  });

  return (
    <>
      {/* Same shell as the analyst card: a transparent scrim that closes on
          click, then a positioned card above it. Without the scrim + z-index
          this rendered underneath the map and the rail. */}
      <div className="panescrim" onClick={onClose} />
      <div className="dqpane" role="dialog" aria-label="Data quality">
        <div className="dqhd">
          <div className="dqhdtext">
            <span className="dqeyebrow">Admin</span>
            <span className="dqhdtitle">Data quality</span>
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
              <h3 className="dqh">Feed freshness</h3>
              <p className="dqnote">
                A feed that stops writing looks identical to a quiet market. Anything silent for{" "}
                {STALE_DAYS} days or more is flagged.
              </p>
              <table className="dqtable">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="dqnum">Live</th>
                    <th className="dqnum">Archived</th>
                    <th>Last write</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feeds.map((f) => (
                    <FeedRowView key={f.source} {...f} />
                  ))}
                </tbody>
              </table>
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
