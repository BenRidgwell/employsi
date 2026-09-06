import {
  Building2,
  Cpu,
  Factory,
  HeartPulse,
  Landmark,
  Pickaxe,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

/**
 * One Lucide glyph per sector group — the seven the supplied designs name, in
 * the order SECTOR_GROUPS declares them: pickaxe, landmark, cpu, shopping-bag,
 * factory, heart-pulse, building-2.
 *
 * SHARED BECAUSE TWO SURFACES DRAW THE SAME BADGE. The filter card's sector
 * picker and the company card's logo badge both mean "this employer is in that
 * group", and a company shown under a cpu in one place and a factory in the
 * other would be saying two different things about the same fact. It lived in
 * FilterPane until the company card needed it too.
 *
 * The designs draw these as CSS masks over a remote unpkg URL; these are the
 * same icons as components from the lucide-react already in package.json, so
 * there is no third-party request at render time and `currentColor` inherits
 * the surrounding foreground exactly as the mask did.
 *
 * Keyed on the FULL group name, which is what COMPANIES stores and what
 * companyGroup() returns — not the short label a card displays.
 */
export const SECTOR_ICON: Record<string, LucideIcon> = {
  "Energy & Natural Resources": Pickaxe,
  "Financial Services": Landmark,
  "Technology, Media and Telecommunications": Cpu,
  "Consumer and Retail": ShoppingBag,
  "Industrial Manufacturing": Factory,
  "Healthcare and Life Sciences": HeartPulse,
  "Infrastructure and Government": Building2,
};

/** The badge glyph for a group, falling back to the resources icon the roster
 *  itself defaults unlabelled companies to (see companyGroup). */
export function sectorIcon(group: string | undefined): LucideIcon {
  return (group && SECTOR_ICON[group]) || Pickaxe;
}
