import { useEffect, useRef } from "react";
import { useAppStore } from "../state/store";
import { recordView } from "../lib/viewsFn";
import { track } from "../lib/analytics";
import { COMPANIES, companyGroup } from "../data/companies";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { SKILL_CATEGORY } from "../data/skillsTaxonomy";

// Records real "most viewed" usage for the What's Trending pane: which
// companies, cities, regions and skills users actually explore. Fire-and-forget
// — a failed write never affects the UI. De-duped per session so holding on one
// view doesn't inflate its count on every re-render (each distinct view counts
// once until you move to a different one).
//
// The same effects also emit product events (lib/analytics.ts) for the admin
// console's engagement tab. Two sinks, one set of triggers, on purpose: they
// answer different questions — views are a public leaderboard of WHAT is
// popular, events are an internal record of HOW MUCH the product is used — but
// they must agree about when something was opened. Instrumenting them
// separately is how a "companies opened" figure starts disagreeing with the
// leaderboard beside it.

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
    once("company", c.id, () => {
      fire({ kind: "company", ref: c.id, label: c.name, sub: companyGroup(c) });
      track("company_open", c.id);
    });
  }, [selectedId]);

  // City entered (local layer).
  useEffect(() => {
    if (zoomedOut || !localCity) return;
    once("city", localCity, () => {
      fire({
        kind: "city",
        ref: localCity,
        label: GLOBAL_HUB_LABEL[localCity] || cap(localCity),
        sub: "City",
      });
      track("city_open", localCity);
    });
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
    once("skill", match, () => {
      fire({ kind: "skill", ref: match, label: match, sub: SKILL_CATEGORY[match] || "Skill" });
      track("skill_open", match);
    });
  }, [searchQuery]);

  // A search RAN. The query itself is never sent — see lib/analytics.ts. This
  // fires on any non-empty query, not just one that matches a canonical skill,
  // because "how much are people searching" and "which skills are popular" are
  // different questions and only the second one needs the term.
  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (q.length < 2) return;
    const t = setTimeout(() => track("search"), 700);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Follows added and removed, from the length of the two lists rather than by
  // wrapping the store actions: a follow can also arrive from the server when
  // an account signs in and claims what was followed while signed out, and that
  // is a real follow that the action wrappers would never have seen.
  const followedIds = useAppStore((s) => s.followedIds);
  const followedSkills = useAppStore((s) => s.followedSkills);
  const prevFollows = useRef<{ ids: string[]; skills: string[] } | null>(null);
  useEffect(() => {
    const prev = prevFollows.current;
    prevFollows.current = { ids: followedIds, skills: followedSkills };
    // The first render is the persisted set being restored, not a new follow.
    if (!prev) return;
    const diff = (before: string[], after: string[], kind: string) => {
      const had = new Set(before);
      const has = new Set(after);
      for (const x of after) if (!had.has(x)) track("follow_add", `${kind}:${x}`);
      for (const x of before) if (!has.has(x)) track("follow_remove", `${kind}:${x}`);
    };
    diff(prev.ids, followedIds, "company");
    diff(prev.skills, followedSkills, "skill");
  }, [followedIds, followedSkills]);
}
