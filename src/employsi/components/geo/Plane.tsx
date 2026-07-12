// Decorative 3D-ish airliner that flies along an SVG motion path. Shared by the
// Australia view and the other continents' domestic views. `scale` lets a map
// with a larger viewBox (the region maps are 500-wide vs Australia's 250) draw
// the plane at a matching on-screen size.
export function Plane({ dur, begin, path, scale = 1 }: { dur: string; begin: string; path: string; scale?: number }) {
  return (
    <g className="plane3d" opacity={0} style={{ pointerEvents: 'none' }}>
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto" path={path} />
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur={dur} begin={begin} repeatCount="indefinite" />
      <g transform={scale === 1 ? undefined : `scale(${scale})`}>
        <ellipse className="planeshadow" cx="-0.3" cy="2" rx="3.1" ry="0.9" />
        <path
          className="planewing"
          d="M0.8,-0.35 L-1.9,-2.8 L-2.4,-2.62 L-0.5,-0.35 L-0.5,0.35 L-2.4,2.62 L-1.9,2.8 L0.8,0.35 Z"
        />
        <path
          className="planetail"
          d="M-2.5,-0.28 L-3.35,-1.2 L-3.62,-1.1 L-2.9,-0.28 L-2.9,0.28 L-3.62,1.1 L-3.35,1.2 L-2.5,0.28 Z"
        />
        <path
          className="planebody"
          d="M3.5,0 C3.5,-0.34 3.1,-0.46 2.3,-0.47 L-2.9,-0.38 C-3.35,-0.37 -3.55,-0.2 -3.55,0 C-3.55,0.2 -3.35,0.37 -2.9,0.38 L2.3,0.47 C3.1,0.46 3.5,0.34 3.5,0 Z"
        />
      </g>
    </g>
  );
}
