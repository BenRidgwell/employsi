import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { marketVisible } from "./markets";
import type { D1Like } from "./jobArchive";
import { summariseCompanyFlows, type CompanyFlows, type FlowImport, type FlowRow } from "./flows";

// Reads talent flows (Cloudflare D1, written by scripts/flows-to-d1.py) for
// the company card. Every display rule lives in flows.ts; this only picks the
// import and fetches its rows.
//
// Null — and so no section on the card — when the tables have not been
// migrated, when nothing has been loaded, or when no current import mentions
// the company. There is no placeholder: until a real delivery is loaded the
// feature does not exist on the page.

async function getArchiveDb(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

export const getCompanyFlows = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<CompanyFlows | null> => {
    const id = (data.id || "").trim();
    if (!id) return null;
    // Same withholding as the rest of the card for unreleased markets.
    if (!marketVisible(await callerRole(), id, true)) return null;
    const db = await getArchiveDb();
    if (!db) return null;
    try {
      // The newest current delivery that mentions this company. One import
      // only: two sources are never summed, and when several exist the card
      // shows the latest rather than a blend.
      const imp = await db
        .prepare(
          `SELECT i.import_id, i.source, i.method, i.scope, i.delivered, i.top_n
             FROM flow_import i
            WHERE i.superseded_by IS NULL
              AND EXISTS (SELECT 1 FROM flows f
                           WHERE f.import_id = i.import_id
                             AND (f.from_id = ?1 OR f.to_id = ?1))
            ORDER BY i.delivered DESC, i.loaded_at DESC
            LIMIT 1`,
        )
        .bind(id)
        .first<FlowImport>();
      if (!imp) return null;
      const rows =
        (
          await db
            .prepare(
              `SELECT from_ref, from_name, to_ref, to_name, from_id, to_id,
                      period_start, period_end, moves, count_kind
                 FROM flows
                WHERE import_id = ?1 AND (from_id = ?2 OR to_id = ?2)`,
            )
            .bind(imp.import_id, id)
            .all<FlowRow>()
        )?.results ?? [];
      const sample = await db
        .prepare(
          `SELECT SUM(profiles) AS n FROM flow_sample WHERE import_id = ?1 AND company_id = ?2`,
        )
        .bind(imp.import_id, id)
        .first<{ n: number | null }>();
      return summariseCompanyFlows(id, imp, rows, sample?.n ?? null);
    } catch {
      // Tables not migrated yet reads the same as no data: no section.
      return null;
    }
  });
