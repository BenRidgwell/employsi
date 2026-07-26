import { useEffect, useRef } from "react";
import { useAppStore } from "../state/store";
import { recordView } from "../lib/viewsFn";
import { COMPANIES, companyGroup } from "../data/companies";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { SKILL_CATEGORY } from "../data/skillsTaxonomy";

// Records real "most viewed" usage for the What's Trending pane: which
// companies, cities, regions and skills users actually explore. Fire-and-forget
// — a failed write never affects the UI. De-duped per session so holding on one
// view doesn't inflate its count on every re-render (each distinct view counts
// once until you move to a different one).

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const COMPANY_BY_ID = new Map(COMPANIES.map((c) => [c.id, c]));

function fire(input: Parameters<typeof recordView>[0]["data"]) {
  // Only in the browser; ignore any failure.
  if (typeof window === "undefined") return;
  recordView({ data: input }).catch(() => {});
}

export function useViewTracking() {
  const selectedId = useAppStore((s) => s.selectedId);
  const localCity = useAppStore((s) => s.localCity);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const searchQuery = useAppStore((s) => s.searchQuery);

  const last = useRef<Record<string, string>>({});
  const once = (slot: string, key: string, run: () => void) => {
    if (last.current[slot] === key) return;
    last.current[slot] = key;
    run();
  };

  // Company opened.
  useEffect(() => {
    if (!selectedId) return;
    const c = COMPANY_BY_ID.get(selectedId);
    if (!c) return;
    once("company", c.id, () =>
      fire({ kind: "company", ref: c.id, label: c.name, sub: companyGroup(c) }),
    );
  }, [selectedId]);

  // City entered (local layer).
  useEffect(() => {
    if (zoomedOut || !localCity) return;
    once("city", localCity, () =>
      fire({
        kind: "city",
        ref: localCity,
        label: GLOBAL_HUB_LABEL[localCity] || cap(localCity),
        sub: "City",
      }),
    );
  }, [localCity, zoomedOut]);

  // Region / continent viewed (domestic overview).
  useEffect(() => {
    if (!zoomedOut || globalOut || !domesticRegion) return;
    once("continent", domesticRegion, () =>
      fire({ kind: "continent", ref: domesticRegion, label: cap(domesticRegion), sub: "Region" }),
    );
  }, [domesticRegion, zoomedOut, globalOut]);

  // Skill searched (map coloured by demand). searchQuery doubles as the skill
  // filter; record it only when it exactly matches a canonical skill.
  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (!q) return;
    const match = Object.keys(SKILL_CATEGORY).find((s) => s.toLowerCase() === q.toLowerCase());
    if (!match) return;
    once("skill", match, () =>
      fire({ kind: "skill", ref: match, label: match, sub: SKILL_CATEGORY[match] || "Skill" }),
    );
  }, [searchQuery]);
}
