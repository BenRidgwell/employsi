import { AU_STATE_PATHS, AU_LINE_PATHS } from '../../data/geoPaths';
import { CITY_XY, CITY_LABEL, cityMatchesSectors } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';
import type { SpikePoint } from '../../lib/heat';
import { SpikeField } from './SpikeField';
import { Plane } from './Plane';

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
  { id: 'melbourne', dx: 0, dy: 13, anchor: 'middle' },
  { id: 'hobart', dx: 7, dy: 3, anchor: 'start' },
];

// Hub-styled cities (like Perth) — clickable to zoom into their own local
// layer, but without the cursor tap-guide animation that Perth carries.
// Sydney is a hub too (it's a global finance hub with its own local view).
const HUB_CITIES: { id: string; labelDy: number; local: string }[] = [
  { id: 'adelaide', labelDy: -7, local: 'adelaide' },
  { id: 'brisbane', labelDy: -7, local: 'brisbane' },
  { id: 'sydney', labelDy: -7, local: 'sydney' },
];

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
  onZoomInCity,
  zoomOrigin,
  ambientSpikes,
  hubSpikes,
  activeSectors,
}: {
  cityHeat: Record<string, HeatDisc>;
  heatDim: string;
  onZoomInCity: (city: string) => void;
  zoomOrigin: string;
  ambientSpikes: SpikePoint[];
  hubSpikes: SpikePoint[];
  activeSectors: string[];
}) {
  // Only show cities carrying a selected sector (all of them when no filter).
  const cityMarkers = CITY_MARKERS.filter((c) => cityMatchesSectors(c.id, activeSectors));
  const hubCities = HUB_CITIES.filter((c) => cityMatchesSectors(c.id, activeSectors));
  const showPerth = cityMatchesSectors('perth', activeSectors);
  return (
    <svg className="aumap" viewBox="0 0 250 230" style={{ transformOrigin: zoomOrigin }}>
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
          <path d="M0,3 Q4.5,1 9,3 T18,3" fill="none" stroke="#dde0e5" strokeWidth="0.55" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
        {/* Larger, slower swell layered over the fine ripple for a two-frequency,
            more textured sea surface instead of one flat repeating tile. */}
        <pattern id="oceanSwell" width="52" height="31" patternUnits="userSpaceOnUse" patternTransform="translate(0,0)">
          <path d="M0,16 Q13,6 26,16 T52,16" fill="none" stroke="#cfd3d9" strokeWidth="1.3" />
          <path d="M0,26 Q13,19 26,26 T52,26" fill="none" stroke="#d6d9de" strokeWidth="0.9" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="52 -9" dur="16s" repeatCount="indefinite" />
        </pattern>
        <radialGradient id="oceanFade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="62%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="oceanMask">
          <rect x="-60" y="-60" width="370" height="350" fill="url(#oceanFade)" />
        </mask>
        <filter id="coastGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.3" />
        </filter>
      </defs>
      <rect className="auocean" x="-60" y="-60" width="370" height="350" fill="url(#oceanWave)" mask="url(#oceanMask)" />
      <rect className="auoceanswell" x="-60" y="-60" width="370" height="350" fill="url(#oceanSwell)" mask="url(#oceanMask)" />

      {/* Soft shallow-water halo hugging the coastline — drawn under the crisp
          land fill so only the seaward half of the blur peeks out, tracing the
          shape of the continent instead of leaving a flat, edgeless coast. */}
      <g className="coastglow" filter="url(#coastGlow)">
        {Object.entries(AU_STATE_PATHS).map(([id, d]) => (
          <path key={`glow-${id}`} d={d} />
        ))}
      </g>

      {Object.entries(AU_STATE_PATHS).map(([id, d]) => (
        <path key={id} className="auland" id={id} d={d} />
      ))}
      {Object.entries(AU_LINE_PATHS).map(([id, d]) => (
        <path key={id} className="auline" id={id} d={d} />
      ))}

      <SpikeField ambient={ambientSpikes} hubs={hubSpikes} blurId="auheatblur" />

      {cityMarkers.map(({ id }) => (
        <CityHeat key={`heat-${id}`} cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} heat={cityHeat[id]} dim={heatDim} />
      ))}
      {showPerth && <CityHeat cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} heat={cityHeat.perth} dim={heatDim} />}
      {hubCities.map(({ id }) => (
        <CityHeat key={`heat-${id}`} cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} heat={cityHeat[id]} dim={heatDim} />
      ))}

      {cityMarkers.map(({ id, dx, dy, anchor }) => (
        <g className="aucity" key={id}>
          <circle className="audot" cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} r="3.2" />
          <text className="aumute" x={CITY_XY[id][0] + dx} y={CITY_XY[id][1] + dy} textAnchor={anchor}>
            {CITY_LABEL[id]}
          </text>
        </g>
      ))}

      {hubCities.map(({ id, labelDy, local }) => (
        <g className="aucity hub" key={id} data-city={local} onClick={() => onZoomInCity(local)}>
          <circle className="auring" cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} r="8" />
          <circle className="audot audothub" cx={CITY_XY[id][0]} cy={CITY_XY[id][1]} r="4.4" />
          <text className="aulabel" x={CITY_XY[id][0]} y={CITY_XY[id][1] + labelDy} textAnchor="middle">
            {CITY_LABEL[id]}
          </text>
        </g>
      ))}
      {showPerth && (
        <g className="aucity hub" data-city="perth" onClick={() => onZoomInCity('perth')}>
          <circle className="auring" cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} r="8" />
          <circle className="audot audothub" cx={CITY_XY.perth[0]} cy={CITY_XY.perth[1]} r="4.4" />
          <text className="aulabel" x={CITY_XY.perth[0]} y={CITY_XY.perth[1] - 7} textAnchor="middle">
            Perth
          </text>
        </g>
      )}

      {PLANE_ROUTES.map((r, i) => (
        <Plane key={i} {...r} />
      ))}
    </svg>
  );
}
