import { useEffect, type RefObject } from "react";

/**
 * The faint "globe" contours — meridian ellipses and latitude arcs — that the
 * product page draws under its dotted journey. Shared so the landing page can
 * carry the same backdrop without the path.
 */
export function drawContours(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.strokeStyle = "rgba(28,28,30,.06)";
  ctx.lineWidth = 1;
  for (let g = 1; g <= 5; g++) {
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.5, W * 0.18 * g, H * 0.9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let g = 1; g <= 7; g++) {
    ctx.beginPath();
    const y = (H * g) / 8;
    ctx.moveTo(0, y + 40);
    ctx.quadraticCurveTo(W / 2, y - 60, W, y + 40);
    ctx.stroke();
  }
}

/** Sizes `canvas` to `box` and draws the contours, redrawing on resize. */
export function useGlobeBackdrop(
  box: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const draw = () => {
      const W = el.offsetWidth;
      const H = el.offsetHeight;
      if (!W || !H) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawContours(ctx, W, H);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, canvas]);
}
