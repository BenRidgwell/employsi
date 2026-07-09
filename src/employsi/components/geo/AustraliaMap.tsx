import { AU_STATE_PATHS, AU_LINE_PATHS } from '../../data/geoPaths';
import { CITY_XY, CITY_LABEL } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';
import type { SpikePoint } from '../../lib/heat';
import { SpikeField } from './SpikeField';

// Decorative FIFO flight arcs out of Perth (29.4,140.5) to the eastern cities.
const PLANE_ROUTES = [
  { dur: '17s', begin: '0s', path: 'M29,140 Q58,58 112,24' }, // → Darwin
  { dur: '21s', begin: '4s', path: 'M29,140 Q120,92 223,153' }, // → Sydney
  { dur: '25s', begin: '9s', path: 'M29,140 Q110,150 189,180' }, // → Melbourne
];

// Non-hub cities rendered from the shared CITY_XY source, with a small label
// offset/anchor so the name clears the marker and the map edge.
const CITY_MARKERS: { id: string; dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }[] = [
  { id: 'darwin', dx: 0, dy: -7, anchor: 'middle' },
  { id: 'brisbane', dx: -7, dy: 1, anchor: 'end' },
  { id: 'sydney', dx: -7, dy: 1, anchor: 'end' },
  { id: 'melbourne', dx: 0, dy: 13, anchor: 'middle' },
  { id: 'adelaide', dx: 0, dy: 13, anchor: 'middle' },
  { id: 'hobart', dx: 7, dy: 3, anchor: 'start' },
];

function Plane({ dur, begin, path }: { dur: string; begin: string; path: string }) {
  return (
    <g className="plane3d" opacity={0}>
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto" path={path} />
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur={dur} begin={begin} repeatCount="indefinite" />
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
  );
}

function CityHeat({ cx, cy, heat, dim }: { cx: number; cy: number; heat: HeatDisc; dim: string }) {
  return (
    <>
      <circle className={`auhalo ${dim}`} filter="url(#cityblur)" cx={cx} cy={cy} r={heat.haloR} style={{ fill: heat.color }} />
      <circle className={`aucore ${dim}`} filter="url(#citycore)" cx={cx} cy={cy} r={heat.r} style={{ fill: heat.color }} />
    </>
  );
}

export function AustraliaMap({
  cityHeat,
  heatDim,
  onZoomIn,
  ambientSpikes,
  hubSpikes,
}: {
  cityHeat: Record<string, HeatDisc>;
  heatDim: string;
  onZoomIn: () => void;
  ambientSpikes: SpikePoint[];
  hubSpikes: SpikePoint[];
}) {
  return (
    <svg className="aumap" viewBox="0 0 250 230">
      <defs>
        <filter id="cityblur" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="auheatblur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <filter id="citycore" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <pattern id="oceanWave" width="18" height="11" patternUnits="userSpaceOnUse" patternTransform="translate(0,0)">
          <rect width="18" height="11" fill="#e2e5e9" />
          <path d="M0,6 Q4.5,2 9,6 T18,6" fill="none" stroke="#d3d7dc" strokeWidth="1.1" />
          <path d="M0,10 Q4.5,7 9,10 T18,10" fill="none" stroke="#d3d7dc" strokeWidth="0.8" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
        <radialGradient id="oceanFade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="62%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="oceanMask">
          <rect x="-60" y="-60" width="370" height="350" fill="url(#oceanFade)" />
        </mask>
      </defs>
      <rect className="auocean" x="-60" y="-60" width="370" height="350" fill="url(#oceanWave)" mask="url(#oceanMask)" />

      {Object.entries(AU_STATE_PATHS).map(([id, d]) => (
        <path key={id} className="auland" id={id} d={d} />
      ))}
      {Object.entries(AU_LINE_PATHS).map(([id, d]) => (
        <path key={id} className="auline" id={id} d={d} />
      ))}

      <SpikeField ambient={ambientSpikes} hubs={hubSpikes} blurId="auheatblur" />

      {CITY_MARKERS.map(({ id }) => (
        <CityHeat key={`heat-${id}`} cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} heat={cityHeat[id]} dim={heatDim} />
      ))}
      <CityHeat cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} heat={cityHeat.perth} dim={heatDim} />

      {CITY_MARKERS.map(({ id, dx, dy, anchor }) => (
        <g className="aucity" key={id}>
          <circle className="audot" cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} r="3.2" />
          <text className="aumute" x={CITY_XY[id][0] + dx} y={CITY_XY[id][1] + dy} textAnchor={anchor}>
            {CITY_LABEL[id]}
          </text>
        </g>
      ))}
      <g className="aucity hub" onClick={onZoomIn}>
        <circle className="auring" cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} r="8" />
        <circle className="audot audothub" cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} r="4.4" />
        <text className="aulabel" x={CITY_XY.perth[0]} y={CITY_XY.perth[1] - 7} textAnchor="middle">
          Perth
        </text>
      </g>

      {/* "Click here" affordance guiding the user to zoom into Perth. */}
      <g className="perthtap">
        <circle className="perthtapripple" cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} r="3" />
        <g transform={`translate(${CITY_XY.perth[0] + 2.4}, ${CITY_XY.perth[1] + 2.4})`}>
          <g className="perthtaphand">
            <path
              className="perthtappointer"
              transform="scale(0.8)"
              d="M0,0 L0,13 L3.3,9.7 L5.7,15 L7.4,14.2 L5.1,9 L9,8.7 Z"
            />
          </g>
        </g>
      </g>

      {PLANE_ROUTES.map((r, i) => (
        <Plane key={i} {...r} />
      ))}
    </svg>
  );
}
