import { useEffect } from "react";

/**
 * Closes a card on a click outside it, WITHOUT a scrim.
 *
 * The cards used to close on a transparent full-screen .panescrim, and that
 * layer also swallowed every wheel and drag, so while a card was open the map
 * behind it could not be zoomed or panned (measured 2026-09-28 on the career
 * card: a role's heat could not be followed out to another layer). Here a
 * CLICK outside the card closes it — press and release without moving, as the
 * scrim's onClick did — while scrolling and panning reach the map.
 *
 * `own` is the card's selector. The rail, the mobile tab bar and the toast are
 * exempt, as they sat above the scrim: their buttons swap cards themselves.
 * `keepOn` adds more: a card that is used WHILE exploring the map (career
 * pathways — find where a role is advertised) passes the map and the company
 * card, so clicking a country, city or company does not close it.
 */
const EXEMPT = ".actionrail, .mobiletabbar, .toast";

export function useClickAway(
  active: boolean,
  close: () => void,
  own: string,
  keepOn?: string,
): void {
  useEffect(() => {
    if (!active) return;
    const sel = [own, EXEMPT, keepOn].filter(Boolean).join(", ");
    const exempt = (t: EventTarget | null) => t instanceof Element && !!t.closest(sel);
    let down: { x: number; y: number; outside: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, outside: !exempt(e.target) };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d?.outside || exempt(e.target)) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, [active, close, own, keepOn]);
}
