import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { marketVisible } from "./markets";
import type { D1Like } from "./jobArchive";
import {
  FLOW_MIN_MOVES,
  buildFlowView,
  monthSpan,
  summariseCompanyFlows,
  type CompanyFlows,
  type CountKind,
  type FlowMonthly,
  type FlowImport,
  type FlowRow,
  type FlowView,
} from "./flows";

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

// ── The talent-flow map view (design "Talent Flows 3D") ─────────────────────
//
// getTalentFlowView is what the view draws: one focus company's peers with
// inflow / outflow, from the newest current import, optionally for one skill
// (flow_skills, migration 0004). getTalentFlowSkills is what its skill search
// offers: only skills that clear FLOW_MIN_MOVES for some peer of the focus,
// so a search never lands on an empty map. Both return null or [] rather than
// placeholders, as getCompanyFlows does.

async function currentImport(db: D1Like, id: string): Promise<FlowImport | null> {
  return (
    (await db
      .prepare(
        `SELECT i.import_id, i.source, i.method, i.scope, i.delivered, i.top_n
           FROM flow_import i
          WHERE i.superseded_by IS NULL
            AND EXISTS (SELECT 1 FROM flow_sample s
                         WHERE s.import_id = i.import_id AND s.company_id = ?1)
          ORDER BY i.delivered DESC, i.loaded_at DESC
          LIMIT 1`,
      )
      .bind(id)
      .first<FlowImport>()) ?? null
  );
}

export const getTalentFlowView = createServerFn({ method: "GET" })
  .validator((data: { id: string; skill?: string | null }) => data)
  .handler(async ({ data }): Promise<FlowView | null> => {
    const id = (data.id || "").trim();
    const skill = (data.skill || "").trim() || null;
    if (!id) return null;
    if (!marketVisible(await callerRole(), id, true)) return null;
    const db = await getArchiveDb();
    if (!db) return null;
    try {
      const imp = await currentImport(db, id);
      if (!imp) return null;
      const sampleTable = skill ? "flow_skill_sample" : "flow_sample";
      const sampledRows =
        (
          await db
            .prepare(
              `SELECT company_id, SUM(profiles) AS n FROM ${sampleTable}
                WHERE import_id = ?1 AND company_id IS NOT NULL GROUP BY company_id`,
            )
            .bind(imp.import_id)
            .all<{ company_id: string; n: number }>()
        )?.results ?? [];
      const sampled = new Set(sampledRows.map((r) => r.company_id));
      const own = sampledRows.find((r) => r.company_id === id)?.n ?? null;
      const rows =
        (
          await (
            skill
              ? db
                  .prepare(
                    `SELECT from_ref, from_name, to_ref, to_name, from_id, to_id,
                          period_start, period_end, moves, count_kind
                     FROM flow_skills
                    WHERE import_id = ?1 AND skill = ?3 AND (from_id = ?2 OR to_id = ?2)`,
                  )
                  .bind(imp.import_id, id, skill)
              : db
                  .prepare(
                    `SELECT from_ref, from_name, to_ref, to_name, from_id, to_id,
                          period_start, period_end, moves, count_kind
                     FROM flows
                    WHERE import_id = ?1 AND (from_id = ?2 OR to_id = ?2)`,
                  )
                  .bind(imp.import_id, id)
          ).all<FlowRow>()
        )?.results ?? [];
      return buildFlowView(id, imp, rows, sampled, own, skill);
    } catch {
      return null; // tables not migrated reads the same as no data
    }
  });

export interface FlowSkill {
  skill: string;
  moves: number; // moves into the focus in roles matching the skill
  peers: number; // peers at or over FLOW_MIN_MOVES
}

export const getTalentFlowSkills = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<FlowSkill[]> => {
    const id = (data.id || "").trim();
    if (!id) return [];
    if (!marketVisible(await callerRole(), id, true)) return [];
    const db = await getArchiveDb();
    if (!db) return [];
    try {
      const imp = await currentImport(db, id);
      if (!imp) return [];
      return (
        (
          await db
            .prepare(
              `SELECT skill, SUM(moves) AS moves, SUM(moves >= ?3) AS peers
                 FROM (SELECT skill, from_id, SUM(moves) AS moves FROM flow_skills
                        WHERE import_id = ?1 AND to_id = ?2 AND from_id IS NOT NULL
                          AND from_id != ?2
                        GROUP BY skill, from_id)
                GROUP BY skill
               HAVING peers > 0
                ORDER BY moves DESC`,
            )
            .bind(imp.import_id, id, FLOW_MIN_MOVES)
            .all<FlowSkill>()
        )?.results ?? []
      );
    } catch {
      return [];
    }
  });

// ── The timeline (flow_months, migration 0005) ───────────────────────────────
//
// getTalentFlowMonths hands the card one focus's moves by month, compact, so
// its scrubber can rebuild the view for any window without a round trip per
// step (viewForWindow in flows.ts). Null when the current import carries no
// monthly rows — the card then shows the whole period only, as before.

const MONTH_KIND_PREFERENCE: CountKind[] = ["weighted", "observed", "sampled"];

export const getTalentFlowMonths = createServerFn({ method: "GET" })
  .validator((data: { id: string; skill?: string | null }) => data)
  .handler(async ({ data }): Promise<FlowMonthly | null> => {
    const id = (data.id || "").trim();
    const skill = (data.skill || "").trim() || null;
    if (!id) return null;
    if (!marketVisible(await callerRole(), id, true)) return null;
    const db = await getArchiveDb();
    if (!db) return null;
    try {
      const imp = await currentImport(db, id);
      if (!imp) return null;
      const span = await db
        .prepare(
          `SELECT MIN(period_start) AS a, MAX(period_end) AS b FROM flows WHERE import_id = ?1`,
        )
        .bind(imp.import_id)
        .first<{ a: string | null; b: string | null }>();
      if (!span?.a || !span.b) return null;
      const rows =
        (
          await db
            .prepare(
              `SELECT from_ref, from_name, to_ref, to_name, from_id, to_id, month, moves, count_kind
                 FROM flow_months
                WHERE import_id = ?1 AND skill = ?3 AND (from_id = ?2 OR to_id = ?2)`,
            )
            .bind(imp.import_id, id, skill ?? "")
            .all<{
              from_ref: string;
              from_name: string;
              to_ref: string;
              to_name: string;
              from_id: string | null;
              to_id: string | null;
              month: string;
              moves: number;
              count_kind: CountKind;
            }>()
        )?.results ?? [];
      if (!rows.length) return null;
      const countKind = MONTH_KIND_PREFERENCE.find((k) => rows.some((r) => r.count_kind === k));
      if (!countKind) return null;

      const sampleTable = skill ? "flow_skill_sample" : "flow_sample";
      const sampledRows =
        (
          await db
            .prepare(
              `SELECT company_id, SUM(profiles) AS n FROM ${sampleTable}
                WHERE import_id = ?1 AND company_id IS NOT NULL GROUP BY company_id`,
            )
            .bind(imp.import_id)
            .all<{ company_id: string; n: number }>()
        )?.results ?? [];

      const months = monthSpan(span.a.slice(0, 7), span.b.slice(0, 7));
      const mIndex = new Map(months.map((m, i) => [m, i] as const));
      const parties: FlowMonthly["parties"] = [];
      const pIndex = new Map<string, number>();
      const cells: FlowMonthly["cells"] = [];
      let focusName = "";
      for (const r of rows) {
        if (r.count_kind !== countKind || r.from_id === r.to_id) continue;
        const mi = mIndex.get(r.month);
        if (mi === undefined) continue;
        const inbound = r.to_id === id;
        if (!focusName) focusName = inbound ? r.to_name : r.from_name;
        const ref = inbound ? r.from_ref : r.to_ref;
        let pi = pIndex.get(ref);
        if (pi === undefined) {
          pi = parties.length;
          pIndex.set(ref, pi);
          parties.push({
            ref,
            name: inbound ? r.from_name : r.to_name,
            id: inbound ? r.from_id : r.to_id,
          });
        }
        cells.push([pi, mi, inbound ? 0 : 1, r.moves]);
      }
      return {
        imp,
        skill,
        countKind,
        focusName,
        sampled: sampledRows.map((r) => r.company_id),
        sampleProfiles: sampledRows.find((r) => r.company_id === id)?.n ?? null,
        months,
        parties,
        cells,
      };
    } catch {
      return null; // 0005 not applied reads the same as no monthly rows
    }
  });
