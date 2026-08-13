import { useMemo } from "react";
import { isReleasedCompany, isReleasedPlace } from "../lib/markets";
import { useAppStore } from "../state/store";
import { COMPANIES } from "../data/companies";
import { searchCityFor } from "../data/mapboxGeo";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { describeSkills } from "../lib/describeSkills";
import { useOntologyReady } from "./useOntologyReady";

/**
 * The skills + companies + cities search, and what selecting a result does.
 *
 * Extracted from TopBar so the phone's persistent field (MobileSearch) and the
 * header flyout are the SAME search rather than two that drift. Both surfaces
 * are real and both are reachable at 680px, so a second copy of this would be
 * a second market gate to keep in step — and gating one of two doors is not
 * gating the door.
 */

export type SearchResult =
  | { kind: "company"; id: string; label: string; sub: string }
  | { kind: "city"; id: string; label: string; sub: string }
  | { kind: "skill"; id: string; label: string; sub: string };

export function useGlobalSearch() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const seesAllMarkets = useAppStore((s) => s.role) === "admin";
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const localCity = useAppStore((s) => s.localCity);
  const select = useAppStore((s) => s.select);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const ontologyReady = useOntologyReady();

  const results = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const companies: SearchResult[] = COMPANIES.filter(
      (c) =>
        (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)) &&
        (seesAllMarkets || isReleasedCompany(c.id)),
    )
      .slice(0, 6)
      .map((c) => ({ kind: "company", id: c.id, label: c.name, sub: c.ticker }));
    const cities: SearchResult[] = Object.entries(GLOBAL_HUB_LABEL)
      .filter(
        ([id, label]) => label.toLowerCase().includes(q) && (seesAllMarkets || isReleasedPlace(id)),
      )
      .slice(0, 6)
      .map(([id, label]) => ({ kind: "city", id, label, sub: "City" }));
    const direct = ALL_SKILLS.filter((sk) => sk.toLowerCase().includes(q));
    // Gated on the flag rather than relying on describeSkills' own empty
    // return, so the memo genuinely depends on it — the dependency is a
    // re-run trigger for when the ontology chunk lands, not decoration.
    const described = ontologyReady
      ? describeSkills(searchQuery).filter((sk) => !direct.includes(sk))
      : [];
    const skillRes: SearchResult[] = [...direct, ...described]
      .slice(0, 7)
      .map((sk) => ({ kind: "skill", id: sk, label: sk, sub: "Skill" }));
    return [...skillRes, ...companies, ...cities];
  }, [searchQuery, seesAllMarkets, ontologyReady]);

  /**
   * Act on a result. Returns true when the surface that owns it should close —
   * picking a skill deliberately keeps it open so further picks can stack,
   * and the map recolours behind.
   */
  const go = (r: SearchResult): boolean => {
    if (r.kind === "skill") {
      toggleSkillQuery(r.id);
      return false;
    }
    if (r.kind === "company") {
      // Head office from the globe; the nearest office in the region otherwise
      // — same rule as the main search bar (see searchCityFor).
      zoomInCity(searchCityFor(r.id, globalOut ? {} : { region: domesticRegion, near: localCity }));
      select(r.id);
    } else {
      zoomInCity(r.id);
    }
    setSearchQuery("");
    return true;
  };

  return { results, go };
}
