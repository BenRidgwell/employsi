import { AU_STATE_PATHS, AU_LINE_PATHS } from '../../data/geoPaths';
import { CITY_XY, CITY_LABEL } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';

const PLANE_ROUTES = [
  { dur: '17s', begin: '0s', path: 'M27,147 Q50,68 115,19' },
  { dur: '21s', begin: '4s', path: 'M27,147 Q90,86 148,144' },
  { dur: '25s', begin: '9s', path: 'M27,147 Q140,96 228,178' },
];

function Plane({ dur, begin, path }: { dur: string; begin: string; path: string }) {
  return (
    <g className="plane3d">
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto" path={path} />
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur={dur} begin={begin} repeatCount="indefinite" />
      <ellipse className="planeshadow" cx="-0.6" cy="1.9" rx="2.4" ry="0.8" />
      <path className="planewing" d="M0.6,-3.1 L1.4,0 L0.6,3.1 L-0.5,1.1 L-0.5,-1.1 Z" />
      <path className="planebody" d="M3.3,0 L0.5,1 L-1.7,0.5 L-1.7,-0.5 L0.5,-1 Z" />
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

export function AustraliaMap({ cityHeat, heatDim, onZoomIn }: { cityHeat: Record<string, HeatDisc>; heatDim: string; onZoomIn: () => void }) {
  return (
    <svg className="aumap" viewBox="0 0 250 230">
      <defs>
        <filter id="cityblur" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="4" />
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

      <CityHeat cx={115} cy={19} heat={cityHeat.darwin} dim={heatDim} />
      <CityHeat cx={230} cy={116} heat={cityHeat.brisbane} dim={heatDim} />
      <CityHeat cx={228} cy={178} heat={cityHeat.sydney} dim={heatDim} />
      <CityHeat cx={196} cy={186} heat={cityHeat.melbourne} dim={heatDim} />
      <CityHeat cx={148} cy={144} heat={cityHeat.adelaide} dim={heatDim} />
      <CityHeat cx={27} cy={147} heat={cityHeat.perth} dim={heatDim} />

      <g className="aucity">
        <circle className="audot" cx={CITY_XY.darwin[0]} cy={CITY_XY.darwin[1]} r="3.2" />
        <text className="aumute" x="115" y="15" textAnchor="middle">{CITY_LABEL.darwin}</text>
      </g>
      <g className="aucity">
        <circle className="audot" cx={CITY_XY.brisbane[0]} cy={CITY_XY.brisbane[1]} r="3.2" />
        <text className="aumute" x="215" y="112" textAnchor="end">{CITY_LABEL.brisbane}</text>
      </g>
      <g className="aucity">
        <circle className="audot" cx={CITY_XY.sydney[0]} cy={CITY_XY.sydney[1]} r="3.2" />
        <text className="aumute" x="221" y="183" textAnchor="end">{CITY_LABEL.sydney}</text>
      </g>
      <g className="aucity">
        <circle className="audot" cx={CITY_XY.melbourne[0]} cy={CITY_XY.melbourne[1]} r="3.2" />
        <text className="aumute" x="196" y="199" textAnchor="middle">{CITY_LABEL.melbourne}</text>
      </g>
      <g className="aucity">
        <circle className="audot" cx={CITY_XY.adelaide[0]} cy={CITY_XY.adelaide[1]} r="3.2" />
        <text className="aumute" x="148" y="157" textAnchor="middle">{CITY_LABEL.adelaide}</text>
      </g>
      <g className="aucity hub" onClick={onZoomIn}>
        <circle className="auring" cx={27} cy={147} r="8" />
        <circle className="audot audothub" cx={27} cy={147} r="4.4" />
        <text className="aulabel" x="27" y="140" textAnchor="middle">Perth</text>
      </g>

      {PLANE_ROUTES.map((r, i) => (
        <Plane key={i} {...r} />
      ))}
    </svg>
  );
}
