import { useMemo, useState } from "react";
import { useAppStore } from "../../state/store";
import { COMPANIES } from "../../data/companies";
import { buildCompareCard, peersFor, type BenchKey } from "../../lib/compareCard";
import { useVacancyTrend } from "../../hooks/useRoleHistory";

/**
 * The compare view, from `Employsi Compare View.html`.
 *
 * One employer against a peer and a benchmark, through a skill lens: the
 * head-to-head metric bars on the left, an indexed vacancy trend and a
 * percentile marker on the right, then the skill mix and three takeaways.
 *
 * What the design asks for that we don't hold — time to hire, and the
 * benchmark's own daily vacancy line — is omitted rather than filled; see
 * lib/compareCard.ts for why in each case.
 */

const ExportIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 15.5V4.5" />
    <polyline points="7.5 11 12 15.5 16.5 11" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export function ComparePanel() {
  const compareOpen = useAppStore((s) => s.compareOpen);
  const compareA = useAppStore((s) => s.compareA);
  const compareB = useAppStore((s) => s.compareB);
  const setCompareB = useAppStore((s) => s.setCompareB);
  const closeCompare = useAppStore((s) => s.closeCompare);
  const skillIndex = useAppStore((s) => s.skillIndex);

  const [bench, setBench] = useState<BenchKey>("sector");
  const [lens, setLens] = useState<string | null>(null);

  const a = useMemo(() => COMPANIES.find((c) => c.id === compareA) ?? null, [compareA]);
  // The peer defaults to the nearest comparable employer rather than making the
  // user pick before the view has anything in it.
  const bId = compareB ?? (a ? (peersFor(a)[0]?.id ?? null) : null);
  const b = useMemo(() => COMPANIES.find((c) => c.id === bId) ?? null, [bId]);

  const aTrend = useVacancyTrend(a?.id, compareOpen && !!a);
  const bTrend = useVacancyTrend(b?.id, compareOpen && !!b);

  const card = useMemo(
    () => (a ? buildCompareCard({ a, b, bench, lens, index: skillIndex, aTrend, bTrend }) : null),
    [a, b, bench, lens, skillIndex, aTrend, bTrend],
  );

  return (
    <>
      <div className={`pbackdrop ${compareOpen ? "open" : ""}`} onClick={closeCompare} />
      <aside className={`cmp ${compareOpen ? "open" : ""}`}>
        {card && (
          <div className="cmpscroll">
            <div className="cmphead">
              <div className="cmpheadmain">
                <span className="cceyebrow">
                  Compare
                  {card.trend.axis.length
                    ? ` · ${card.trend.axis[0]} – ${card.trend.axis[card.trend.axis.length - 1]}`
                    : ""}
                </span>
                <span className="cmptitle">
                  {card.a.name}
                  {card.b ? ` vs ${card.b.name}` : ""}
                </span>
              </div>
              <div className="cmpheadactions">
                <button
                  className="cmpexport"
                  onClick={() => window.print()}
                  title="Print or save this comparison as a PDF"
                >
                  <ExportIcon />
                  Export
                </button>
                <button className="ccbtn ccbtn-close" onClick={closeCompare} aria-label="Close">
                  <span className="cctip">Close</span>
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                  >
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="cmpbar">
              <div className="cmpsubject">
                <span className="cmpsubjectmark">{card.a.ticker}</span>
                <span className="cmpsubjectname">{card.a.name}</span>
              </div>
              <span className="cmpvs">vs</span>
              <div className="cmpseg">
                {card.peers.map((p) => (
                  <button
                    key={p.id}
                    className={`cmpsegbtn ${p.sel ? "on" : ""}`}
                    onClick={() => setCompareB(p.id)}
                  >
                    <span className="cmpsegdot" />
                    {p.name}
                  </button>
                ))}
              </div>
              <span className="cmpspacer" />
              <div className="cmpbench">
                <span className="cceyebrow">Benchmark</span>
                <div className="cmpseg">
                  {card.benchmarks.map((bm) => (
                    <button
                      key={bm.key}
                      className={`cmpsegbtn ${bm.sel ? "on" : ""}`}
                      onClick={() => setBench(bm.key as BenchKey)}
                    >
                      {bm.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {card.skillLens.length > 0 && (
              <div className="cmplensrow">
                <span className="cceyebrow">Skill lens</span>
                <div className="cmplens">
                  {card.skillLens.map((s) => (
                    <button
                      key={s}
                      className={`cmplensbtn ${s === card.lens ? "on" : ""}`}
                      onClick={() => setLens(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="cmpkey">
              <span className="cmpkeyitem">
                <span className="cmpkeyswatch a" />
                {card.a.name}
              </span>
              {card.b && (
                <span className="cmpkeyitem">
                  <span className="cmpkeyswatch b" />
                  {card.b.name}
                </span>
              )}
              <span className="cmpkeyitem">
                <span className="cmpkeyswatch bench" />
                {card.benchLabel} benchmark
              </span>
            </div>

            <div className="cmpgrid">
              <div className="cmpcol">
                <span className="cceyebrow">Head to head · dashed line marks benchmark</span>
                <div className="cmpmetrics">
                  {card.metrics.map((m) => (
                    <div className="cmpmetric" key={m.name}>
                      <div className="cmpmetrichd">
                        <span className="cmpmetricname">{m.name}</span>
                        <span className="cmpmetricvals">
                          <span className="cmpmetrica">{m.aLabel}</span>
                          <span className="cmpmetricb">{m.bLabel}</span>
                          <span className={`cmpgap ${m.tone}`}>{m.gap}</span>
                        </span>
                      </div>
                      <div className="cmpbars">
                        {m.signed ? (
                          <>
                            <span className="cmptrack">
                              <span
                                className="cmpfill a signed"
                                style={{ left: m.aFrom, width: m.aWide }}
                              />
                            </span>
                            <span className="cmptrack">
                              <span
                                className="cmpfill b signed"
                                style={{ left: m.bFrom, width: m.bWide }}
                              />
                            </span>
                            <span className="cmpzero" style={{ left: m.zeroPct }} />
                          </>
                        ) : (
                          <>
                            <span className="cmptrack">
                              <span className="cmpfill a" style={{ width: m.aPct }} />
                            </span>
                            <span className="cmptrack">
                              <span className="cmpfill b" style={{ width: m.bPct }} />
                            </span>
                          </>
                        )}
                        {m.benchPct && (
                          <span className="cmpbenchmark" style={{ left: m.benchPct }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="cmpcol">
                <div className="cmptrend">
                  <div className="ccsecth">
                    <span className="cceyebrow">Vacancies · indexed</span>
                    {card.lens && <span className="ccsecthsub">{card.lens}</span>}
                  </div>
                  {card.trend.note ? (
                    <div className="dataempty">{card.trend.note}</div>
                  ) : (
                    <>
                      <div className="ccplot">
                        <svg viewBox="0 0 420 150" preserveAspectRatio="none" fill="none">
                          <defs>
                            <linearGradient id="cmp-fade" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0" stopColor="#1c1c1e" stopOpacity=".14" />
                              <stop offset="1" stopColor="#1c1c1e" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {card.trend.area && <path d={card.trend.area} fill="url(#cmp-fade)" />}
                          {card.trend.b && (
                            <path
                              d={card.trend.b.path}
                              stroke="#b4b4ba"
                              strokeWidth="2"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          )}
                          {card.trend.a && (
                            <path
                              d={card.trend.a.path}
                              stroke="#1c1c1e"
                              strokeWidth="2.2"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          )}
                        </svg>
                        <span className="cmptrendpills">
                          {card.trend.a && (
                            <span className={`ccdelta ${card.trend.a.up ? "up" : "down"}`}>
                              {card.a.ticker} {card.trend.a.delta}
                            </span>
                          )}
                          {card.trend.b && card.b && (
                            <span className={`ccdelta ${card.trend.b.up ? "up" : "down"}`}>
                              {card.b.ticker} {card.trend.b.delta}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="ccaxis">
                        {card.trend.axis.map((t, i) => (
                          <span key={i}>{t}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {card.percentile && (
                  <div className="cmppctl">
                    <span className="cceyebrow">
                      {card.lens} demand · percentile vs {card.benchLabel}
                    </span>
                    <div className="cmppctltrack">
                      <span className="cmppctlrail" />
                      {card.percentile.bPct && (
                        <span className="cmppctlb" style={{ left: card.percentile.bPct }} />
                      )}
                      <span className="cmppctla" style={{ left: card.percentile.aPct }}>
                        <span className="cmppctltag">{card.percentile.aLabel}</span>
                        <span className="cmppctlstem" />
                      </span>
                    </div>
                    <p className="cmppctlnote">{card.percentile.note}</p>
                  </div>
                )}
              </div>
            </div>

            {card.mix.length > 0 && (
              <div className="cmpmix">
                <div className="ccsecth">
                  <span className="cceyebrow">Skill mix · share of live ads</span>
                  <span className="ccsecthsub">{card.benchLabel} average shown dashed</span>
                </div>
                <div className="cmpmixgrid">
                  {card.mix.map((m) => (
                    <div className="cmpmixrow" key={m.name}>
                      <div className="cmpmetrichd">
                        <span className="cmpmetricname">{m.name}</span>
                        <span className="cmpmetricvals">
                          <span className="cmpmetrica">{m.aLabel}</span>
                          <span className="cmpmetricb">{m.bLabel}</span>
                        </span>
                      </div>
                      <div className="cmpbars tight">
                        <span className="cmptrack">
                          <span className="cmpfill a" style={{ width: m.aPct }} />
                        </span>
                        <span className="cmptrack">
                          <span className="cmpfill b" style={{ width: m.bPct }} />
                        </span>
                        <span className="cmpbenchmark" style={{ left: m.benchPct }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {card.takeaways.length > 0 && (
              <div className="cmptake">
                <span className="cceyebrow">What stands out</span>
                {card.takeaways.map((t) => (
                  <div className="cmptakerow" key={t.tag + t.text.slice(0, 12)}>
                    <span className={`cmptaketag ${t.tone}`}>{t.tag}</span>
                    <span className="cmptaketext">{t.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
