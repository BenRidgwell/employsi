import { GLOBAL_LAND_PATHS } from '../../data/geoPaths';
import { GLOBAL_HUB_XY, GLOBAL_HUB_LABEL } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';

// Decorative shipping arcs between hubs (endpoints follow GLOBAL_HUB_XY).
const TANKER_ROUTES = [
  { dur: '26s', begin: '0s', path: 'M435,223 Q430,188 414,162' }, // Perth → Singapore
  { dur: '31s', begin: '6s', path: 'M435,223 Q360,248 282,212' }, // Perth → Johannesburg
  { dur: '34s', begin: '13s', path: 'M66,110 Q150,135 232,59' }, // Houston → London (over the Atlantic)
];

// Country labels placed at real country centroids projected with the same fit.
const COUNTRY_LABELS: { label: string; x: number; y: number }[] = [
  { label: 'CHILE', x: 92, y: 250 },
  { label: 'CANADA', x: 40.2, y: 45.4 },
  { label: 'SOUTH AFRICA', x: 274, y: 230 },
  { label: 'UNITED KINGDOM', x: 224, y: 44 },
  { label: 'UNITED STATES', x: 105, y: 92 },
  { label: 'AUSTRALIA', x: 474, y: 190 },
];

function Tanker({ dur, begin, path }: { dur: string; begin: string; path: string }) {
  return (
    <g className="tanker3d" opacity={0}>
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto" path={path} />
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.92;1" dur={dur} begin={begin} repeatCount="indefinite" />
      <path className="tankerwake" d="M-4.4,0.5 Q-8,1.1 -12,0.6" />
      <path className="tankerwake" d="M-4.4,-0.5 Q-8,-1.1 -12,-0.6" />
      <path className="tankerhull" d="M4.4,0 L3.2,1 L-3.8,1 L-4.4,0 L-3.8,-1 L3.2,-1 Z" />
      <rect className="tankerdeck" x="-3.2" y="-0.6" width="2.4" height="1.2" rx="0.2" />
    </g>
  );
}

function HubHeat({ cx, cy, heat, dim }: { cx: number; cy: number; heat: HeatDisc; dim: string }) {
  return (
    <>
      <circle className={`auhalo ${dim}`} filter="url(#globeblur)" cx={cx} cy={cy} r={heat.haloR} style={{ fill: heat.color }} />
      <circle className={`aucore ${dim}`} filter="url(#globecore)" cx={cx} cy={cy} r={heat.r} style={{ fill: heat.color }} />
    </>
  );
}

// Label offsets from each hub dot (dot positions come from GLOBAL_HUB_XY).
const CITY_LABEL_OFFSET: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  santiago: { dx: 0, dy: -9, anchor: 'middle' },
  toronto: { dx: 0, dy: -9, anchor: 'middle' },
  johannesburg: { dx: 0, dy: -9, anchor: 'middle' },
  london: { dx: 0, dy: 14, anchor: 'middle' },
  houston: { dx: -8, dy: 3, anchor: 'end' },
  singapore: { dx: 8, dy: 3, anchor: 'start' },
};

export function GlobeMap({ hubHeat, heatDim, onZoomIn }: { hubHeat: Record<string, HeatDisc>; heatDim: string; onZoomIn: () => void }) {
  const nonPerthHubs = Object.keys(GLOBAL_HUB_XY).filter((id) => id !== 'perth');
  return (
    <svg className="globemap" viewBox="0 0 500 260">
      <defs>
        <pattern id="globeOceanWave" width="18" height="11" patternUnits="userSpaceOnUse">
          <rect width="18" height="11" fill="#e2e5e9" />
          <path d="M0,6 Q4.5,2 9,6 T18,6" fill="none" stroke="#d3d7dc" strokeWidth="1.1" />
          <path d="M0,10 Q4.5,7 9,10 T18,10" fill="none" stroke="#d3d7dc" strokeWidth="0.8" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
        <radialGradient id="globeOceanFade" cx="50%" cy="50%" r="58%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="55%" stopColor="#fff" stopOpacity="1" />
          <stop offset="82%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="globeOceanMask">
          <rect x="0" y="0" width="500" height="260" fill="url(#globeOceanFade)" />
        </mask>
        <filter id="globeblur" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="globecore" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      <g mask="url(#globeOceanMask)">
        <rect x="-80" y="-60" width="660" height="380" fill="url(#globeOceanWave)" />
        {GLOBAL_LAND_PATHS.map((d, i) => (
          <path key={i} className="globeland" d={d} />
        ))}
      </g>

      {nonPerthHubs.map((id) => {
        const [cx, cy] = GLOBAL_HUB_XY[id];
        return <HubHeat key={id} cx={cx} cy={cy} heat={hubHeat[id]} dim={heatDim} />;
      })}
      <HubHeat cx={GLOBAL_HUB_XY.perth[0]} cy={GLOBAL_HUB_XY.perth[1]} heat={hubHeat.perth} dim={heatDim} />

      {nonPerthHubs.map((id) => {
        const [cx, cy] = GLOBAL_HUB_XY[id];
        const off = CITY_LABEL_OFFSET[id];
        return (
          <g className="aucity" key={id}>
            <circle className="audot" cx={cx} cy={cy} r="3.2" />
            <text className="aumute" x={cx + off.dx} y={cy + off.dy} textAnchor={off.anchor}>{GLOBAL_HUB_LABEL[id]}</text>
          </g>
        );
      })}
      {COUNTRY_LABELS.map((c) => (
        <text key={c.label} className="aucountry" x={c.x} y={c.y} textAnchor="middle">{c.label}</text>
      ))}

      <g className="aucity hub" onClick={onZoomIn}>
        <circle className="auring" cx={GLOBAL_HUB_XY.perth[0]} cy={GLOBAL_HUB_XY.perth[1]} r="8" />
        <circle className="audot audothub" cx={GLOBAL_HUB_XY.perth[0]} cy={GLOBAL_HUB_XY.perth[1]} r="4.4" />
        <text className="aulabel" x={GLOBAL_HUB_XY.perth[0]} y={GLOBAL_HUB_XY.perth[1] - 7} textAnchor="middle">Perth</text>
      </g>

      {TANKER_ROUTES.map((r, i) => (
        <Tanker key={i} {...r} />
      ))}
    </svg>
  );
}
