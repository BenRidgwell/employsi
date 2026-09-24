import type { CompanyFlows, FlowSide } from "../../lib/flows";

const ROWS = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;
}

function fmt(n: number): string {
  // Weighted counts can be fractional; a card showing "12.37 people" claims a
  // precision the weighting does not have.
  return Math.round(n).toLocaleString("en-AU");
}

function Side({ title, rows, max }: { title: string; rows: FlowSide[]; max: number }) {
  if (!rows.length) return null;
  return (
    <div className="cchiring">
      <div className="cchiremore">{title}</div>
      {rows.slice(0, ROWS).map((r) => (
        <div className="cchirerow" key={`${title}-${r.name}`}>
          <span className="cchirename">{r.name}</span>
          <span className="cchirebar">
            <span
              className="cchirefill"
              style={{ width: `${Math.max(4, (r.moves / max) * 100)}%` }}
            />
          </span>
          <span className="cchiren">{fmt(r.moves)}</span>
        </div>
      ))}
      {rows.length > ROWS && (
        <div className="cchiremore">
          +{rows.length - ROWS} more compan{rows.length - ROWS === 1 ? "y" : "ies"}
        </div>
      )}
    </div>
  );
}

/**
 * Company-to-company moves for one employer, from the newest loaded delivery.
 * Renders nothing without data — there is no placeholder state, by design
 * (docs/talent-flows-plan.md, "Before any real import is loaded: nothing").
 *
 * Every number carries what it rests on: the period summed, the source and
 * its method, what was held back under the minimum, and for a sampled source
 * how many profiles it came from. Without those lines a count reads as a
 * workforce total, which none of these sources is.
 */
export function TalentFlow({ flows }: { flows: CompanyFlows | null }) {
  if (!flows) return null;
  const max = Math.max(
    1,
    ...flows.gainedFrom.map((r) => r.moves),
    ...flows.lostTo.map((r) => r.moves),
  );
  const period =
    flows.period.start.slice(0, 7) === flows.period.end.slice(0, 7)
      ? monthLabel(flows.period.start)
      : `${monthLabel(flows.period.start)} – ${monthLabel(flows.period.end)}`;
  const nothingShown = !flows.gainedFrom.length && !flows.lostTo.length;
  const notes: string[] = [];
  if (flows.sampleProfiles != null) {
    notes.push(`Moves among ${fmt(flows.sampleProfiles)} sampled profiles, not a workforce total`);
  }
  if (flows.suppressed.pairs > 0) {
    notes.push(
      `${flows.suppressed.pairs} smaller flow${flows.suppressed.pairs === 1 ? "" : "s"} (${fmt(
        flows.suppressed.moves,
      )} moves) not shown`,
    );
  }
  if (flows.truncatedBySource != null)
    notes.push(`Source lists its top ${flows.truncatedBySource} only`);
  if (flows.countKind === "weighted") notes.push("Weighted for profile coverage");

  return (
    <>
      <div className="ccsecth">
        <span className="cceyebrow">Talent flow</span>
        <span className="ccsecthsub">{period}</span>
      </div>
      {nothingShown ? (
        <div className="dataempty">No flow large enough to show</div>
      ) : (
        <>
          <Side title="Gained people from" rows={flows.gainedFrom} max={max} />
          <Side title="Lost people to" rows={flows.lostTo} max={max} />
        </>
      )}
      <div className="cchiremore">
        {[...notes, `Source: ${flows.source} — ${flows.method}`].join(" · ")}
      </div>
    </>
  );
}
