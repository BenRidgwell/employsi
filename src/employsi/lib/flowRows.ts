import { COMPANIES, type Company } from "../data/companies";
import type { FlowView } from "./flows";

// The rows the talent-flow card lists and the arcs the map draws, from one
// function, so a row and its arc can never disagree on a count or a colour.

const COMPANY_BY_ID: Record<string, Company> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));

export const FLOW_BANDS = { LOW: "#2f9467", MOD: "#b8862b", HIGH: "#c4473e" } as const;
const OTHER = "#8e8e93";

export interface FlowRowVM {
  id: string | null; // null = the "Other companies" row
  code: string;
  name: string;
  n: number;
  color: string;
}

/** The rows a mode lists, biggest first, coloured by thirds of the largest
 *  (the design's rule), with the "other" remainder last. Exported so the map
 *  colours its arcs with exactly the same bands. */
export function flowRows(v: FlowView, mode: "in" | "out" | "net"): FlowRowVM[] {
  const nameOf = (id: string, fallback: string) => COMPANY_BY_ID[id]?.name ?? fallback;
  const codeOf = (id: string, name: string) =>
    COMPANY_BY_ID[id]?.ticker?.slice(0, 4) ?? name.slice(0, 3).toUpperCase();
  const base = v.peers
    .map((p) => {
      const n =
        mode === "in" ? p.in : mode === "out" ? (p.out ?? 0) : p.out === null ? 0 : p.in - p.out;
      // Net needs BOTH sides over the floor: a side under it reads 0 here,
      // and 0 is not what was measured.
      const measured =
        mode === "in" ? p.in > 0 : mode === "out" ? p.out !== null : p.out !== null && p.in > 0;
      return { id: p.companyId, name: nameOf(p.companyId, p.name), n, measured };
    })
    .filter((r) => r.measured && r.n !== 0)
    .sort((a, b) => Math.abs(b.n) - Math.abs(a.n));
  const max = Math.max(1, ...base.map((r) => Math.abs(r.n)));
  const band = (n: number) => {
    const t = Math.abs(n) / max;
    return t < 1 / 3 ? FLOW_BANDS.LOW : t < 2 / 3 ? FLOW_BANDS.MOD : FLOW_BANDS.HIGH;
  };
  const rows: FlowRowVM[] = base.map((r) => ({
    id: r.id,
    code: codeOf(r.id, r.name),
    name: r.name,
    n: r.n,
    color: band(r.n),
  }));
  const rest = mode === "in" ? v.other.in : mode === "out" ? v.other.out : null;
  if (rest && rest.moves > 0) {
    rows.push({
      id: null,
      code: "···",
      name: `Other companies (${rest.companies.toLocaleString("en-AU")})`,
      n: rest.moves,
      color: OTHER,
    });
  }
  return rows;
}
