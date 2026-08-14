import type { PointerEventHandler } from "react";

// The grab bar at the top of a phone sheet: the visible affordance for the
// drag that useMobileSheet implements, and a tap target that steps between
// the two open positions for anyone who does not discover the drag.
//
// Hidden above 680px, where the panes are docked panels and there is nothing
// to drag.

interface Props {
  dragProps: {
    onPointerDown?: PointerEventHandler<HTMLElement>;
    onPointerMove?: PointerEventHandler<HTMLElement>;
    onPointerUp?: PointerEventHandler<HTMLElement>;
    onPointerCancel?: PointerEventHandler<HTMLElement>;
  };
  detent: "peek" | "full";
  onToggle: () => void;
}

export function MobileSheetHandle({ dragProps, detent, onToggle }: Props) {
  return (
    <div className="msheetgrab" {...dragProps}>
      <button
        type="button"
        className="msheetgrabbar"
        onClick={onToggle}
        aria-label={detent === "peek" ? "Expand" : "Collapse"}
        aria-expanded={detent === "full"}
      />
    </div>
  );
}
