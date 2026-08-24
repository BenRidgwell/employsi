import { useMemo, useState } from "react";
import { smoothPath } from "../../lib/chart";
import type { SkillMarket, SkillMarketRow } from "../../lib/jobHistoryFn";

/** Rows before the list says what it left out. */
const ROWS_SHOWN = 12;

/**
 * What the list is ordered by.
 *
 * THERE IS NO "VALUE" SORT, though value is the index the hero is built on.
 * Measured against production on 2026-08-12, ordering by price x volume was
 * very nearly ordering by volume — Kendall tau 0.83 (Perth), 0.87 (Australia),
 * 0.82 (worldwide), with 8 to 10 of the twelve visible rows shared. It could
 * hardly be otherwise: volume spans 1 to 3,744 ads while median pay spans a
 * factor of 2.3 to 4.4, so the salary term barely perturbs the order.
 *
 * What difference it did make was the wrong difference. Value is null for an
 * unpriced skill, so a value sort put every one of them last: for Perth that
 * demoted 72 of 92 skills in demand for a reason that has nothing to do with
 * demand, and the visible list stopped being the market's biggest skills. A
 * third chip that mostly reproduces this one and misleads where it doesn't is
 * worse than two that each answer a question.
 */
type SortKey = "salary" | "volume";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "volume", label: "Volume" },
  { key: "salary", label: "Salary" },
];
const SP_W = 96;
const SP_H = 26;

/** 98000 → "$98k". A magnitude: the median of a few hundred advertised figures
 *  does not support dollars and cents, and printing them would imply it does. */
function payLabel(v: number): string {
  return v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
}

function spark(vals: number[]) {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.3;
  const a = lo - pad;
  const b = hi + pad;
  const pts: [number, number][] = vals.map((v, i) => [
    (i / Math.max(1, vals.length - 1)) * (SP_W - 2) + 1,
    SP_H - 2 - ((v - a) / (b - a)) * (SP_H - 5),
  ]);
  const line = smoothPath(pts);
  return { line, area: `${line} L ${SP_W} ${SP_H} L 0 ${SP_H} Z` };
}

/**
 * One skill's demand: the line and the percentage TOGETHER, because they are
 * the same measurement.
 *
 * This placement is load-bearing. Put the percentage on the right beside the
 * salary — where a stock row would put it — and it reads as the price moving,
 * which on this data it never does: median advertised salary shifted 0.0% for
 * Teaching and 0.8% for Leadership over ten days. The line is vacancies, the
 * percentage is vacancies, and the price sits apart from both.
 */
function Demand({ row }: { row: SkillMarketRow }) {
  const g = row.spark && row.spark.length > 1 ? spark(row.spark) : null;
  const dir = row.dir;
  return (
    <div className="smkdemand">
      {g ? (
        <svg
          className={`smkspark ${dir}`}
          viewBox={`0 0 ${SP_W} ${SP_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="smksparkarea" d={g.area} />
          <path className="smksparkline" d={g.line} />
        </svg>
      ) : (
        // A flat or too-short series draws nothing rather than a straight line
        // implying a measurement that was not made.
        <span className="smksparknone" aria-hidden="true" />
      )}
      {row.pct === null ? (
        <span className="smkpct none">—</span>
      ) : (
        <span className={`smkpct ${dir}`}>
          {row.pct > 0 ? "+" : row.pct < 0 ? "−" : ""}
          {Math.abs(row.pct).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

/**
 * Every skill in the market, priced.
 *
 * Unpriced skills are NOT filtered out. 42 of Australia's 97 skills in demand
 * disclose too little pay to value, and dropping them would turn a market of 97
 * skills into one of 55 without saying so. They keep their row, their demand and
 * their line; only the price column is empty, which is the fact.
 */
export function SkillMarketRows({
  market,
  selected,
  onPick,
}: {
  market: SkillMarket;
  selected: string | null;
  onPick: (skill: string) => void;
}) {
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("volume");
  const [all, setAll] = useState(false);

  const cats = useMemo(() => market.categories.map((c) => c.cat), [market.categories]);
  const rows = useMemo(() => {
    const base = cat ? market.rows.filter((r) => r.cat === cat) : market.rows;
    // Copy before sorting: market.rows is the query's cached array, and sorting
    // it in place would reorder the hero's view of the same data.
    return [...base].sort((x, y) => {
      if (sort === "salary") {
        // Unpriced skills go last rather than sorting as zero. They are not the
        // cheapest thing in the market, they are the things it cannot price.
        if (x.pay === null && y.pay === null) return y.now - x.now;
        if (x.pay === null) return 1;
        if (y.pay === null) return -1;
        return y.pay - x.pay || y.now - x.now;
      }
      // Volume, and on a tie the better-paid of the two — but a tie between an
      // unpriced skill and a priced one is not an argument for demoting it, so
      // it only breaks ties, it never reorders.
      return y.now - x.now || (y.pay ?? 0) - (x.pay ?? 0);
    });
  }, [market.rows, cat, sort]);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  const unpriced = rows.filter((r) => r.pay === null).length;

  if (!market.rows.length) return null;

  return (
    <section className="smk">
      <div className="ccsecth">
        <span className="cceyebrow">Skills</span>
        <div className="smksorts" role="tablist" aria-label="Sort by">
          {SORTS.map((o) => (
            <button
              type="button"
              key={o.key}
              role="tab"
              aria-selected={sort === o.key}
              className={`smksort ${sort === o.key ? "on" : ""}`}
              onClick={() => setSort(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {cats.length > 1 && (
        <div className="smkcats">
          <button
            type="button"
            className={`smkcat ${cat === null ? "on" : ""}`}
            onClick={() => setCat(null)}
          >
            All
          </button>
          {cats.map((c) => (
            <button
              type="button"
              key={c}
              className={`smkcat ${cat === c ? "on" : ""}`}
              onClick={() => setCat(cat === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="smkrows">
        {shown.map((r) => (
          <button
            type="button"
            key={r.skill}
            className={`smkrow ${selected === r.skill ? "on" : ""}`}
            aria-pressed={selected === r.skill}
            onClick={() => onPick(r.skill)}
          >
            <span className="smkmain">
              <span className="smkname">{r.skill}</span>
              <span className="smksub">
                {r.cat} · {r.now.toLocaleString("en-AU")} live
                {r.now === 1 ? " ad" : " ads"}
              </span>
            </span>
            <Demand row={r} />
            <span className="smkpay">
              {r.pay === null ? (
                <>
                  <span className="smkpayv none">—</span>
                  <span className="smkpayl">no pay disclosed</span>
                </>
              ) : (
                <>
                  <span className="smkpayv">{payLabel(r.pay)}</span>
                  {/* The sample, always. A median over 8 ads and one over 1,400
                      are both "the median" and should not look alike. */}
                  <span className="smkpayl">
                    median · {r.payN.toLocaleString("en-AU")}
                    {r.payMarkets > 1 && ` · ${r.payMarkets} mkts`}
                  </span>
                </>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="smkfoot">
        {rows.length > ROWS_SHOWN && (
          <button type="button" className="smkmore" onClick={() => setAll((v) => !v)}>
            {all ? "show fewer" : `+${rows.length - ROWS_SHOWN} more`}
          </button>
        )}
        {unpriced > 0 && (
          <span className="smkfootnote">
            {unpriced} of {rows.length} in demand here disclose too little pay to value
          </span>
        )}
      </div>
    </section>
  );
}
