import { GLOBAL_LAND_PATHS } from '../../data/geoPaths';
import { GLOBAL_HUB_XY, GLOBAL_HUB_LABEL, cityMatchesSectors } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';
import type { SpikePoint } from '../../lib/heat';
import { SpikeField } from './SpikeField';

// Shrink the geography + markers slightly within the feathered frame so the
// map isn't tight to the soft edges (ocean still fills to the border).
const GEO_SCALE = 'translate(250 130) scale(0.93) translate(-250 -130)';

// Decorative shipping arcs between hubs (endpoints follow GLOBAL_HUB_XY).
const TANKER_ROUTES = [
  { dur: '26s', begin: '0s', path: 'M435,223 Q430,188 414,162' }, // Perth → Singapore
  { dur: '31s', begin: '6s', path: 'M435,223 Q360,248 282,212' }, // Perth → Johannesburg
  { dur: '34s', begin: '13s', path: 'M66,110 Q150,135 232,59' }, // Houston → London (over the Atlantic)
];

// Continent labels placed roughly over each landmass (same projected fit).
const CONTINENT_LABELS: { label: string; x: number; y: number }[] = [
  { label: 'NORTH AMERICA', x: 72, y: 56 },
  { label: 'SOUTH AMERICA', x: 132, y: 205 },
  { label: 'EUROPE', x: 250, y: 42 },
  { label: 'AFRICA', x: 262, y: 150 },
  { label: 'ASIA', x: 432, y: 92 },
  { label: 'AUSTRALIA', x: 474, y: 188 },
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
// Every hub is a clickable city that opens its own local layer.
const CITY_LABEL_OFFSET: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  perth: { dx: 0, dy: -8, anchor: 'middle' },
  adelaide: { dx: 0, dy: 12, anchor: 'middle' },
  brisbane: { dx: -6, dy: -8, anchor: 'end' },
  sydney: { dx: 6, dy: 11, anchor: 'start' },
  santiago: { dx: 0, dy: -9, anchor: 'middle' },
  toronto: { dx: 0, dy: -9, anchor: 'middle' },
  johannesburg: { dx: 0, dy: -9, anchor: 'middle' },
  london: { dx: -9, dy: 0, anchor: 'end' },
  houston: { dx: -8, dy: 3, anchor: 'end' },
  singapore: { dx: 8, dy: 3, anchor: 'start' },
  denver: { dx: 0, dy: -9, anchor: 'middle' },
  ganzhou: { dx: 8, dy: 3, anchor: 'start' },
  lubumbashi: { dx: 8, dy: 3, anchor: 'start' },
  // Finance-only hubs — offsets chosen to clear the nearby resources hubs.
  newyork: { dx: 8, dy: 4, anchor: 'start' },
  sanfrancisco: { dx: 0, dy: 13, anchor: 'middle' },
  chicago: { dx: -8, dy: 3, anchor: 'end' },
  tokyo: { dx: -8, dy: 3, anchor: 'end' },
  zurich: { dx: 9, dy: -2, anchor: 'start' },
  geneva: { dx: 0, dy: 14, anchor: 'middle' },
  dubai: { dx: 0, dy: 13, anchor: 'middle' },
  hongkong: { dx: 8, dy: 6, anchor: 'start' },
};

// Continent labels that navigate to a regional domestic view when clicked.
const CONTINENT_CLICK: Record<string, string> = {
  AUSTRALIA: 'australia',
  ASIA: 'asia',
  'NORTH AMERICA': 'northamerica',
  'SOUTH AMERICA': 'southamerica',
  EUROPE: 'europe',
  AFRICA: 'africa',
};

// Percentage position of a hub on the root <svg>, accounting for the inner
// GEO_SCALE transform applied to the land/hub group — used as the CSS
// transform-origin so the "zoom into this city" animation scales from the
// hub's actual on-screen spot.
export function globeHubOrigin(hubId: string): string {
  const [x, y] = GLOBAL_HUB_XY[hubId] || [250, 130];
  const gx = 250 + (x - 250) * 0.93;
  const gy = 130 + (y - 130) * 0.93;
  return `${((gx / 500) * 100).toFixed(1)}% ${((gy / 260) * 100).toFixed(1)}%`;
}

export function GlobeMap({
  hubHeat,
  heatDim,
  onZoomInCity,
  onContinent,
  ambientSpikes,
  hubSpikes,
  activeSectors,
  zoomOrigin,
}: {
  hubHeat: Record<string, HeatDisc>;
  heatDim: string;
  onZoomInCity: (city: string) => void;
  onContinent: (region: string) => void;
  ambientSpikes: SpikePoint[];
  hubSpikes: SpikePoint[];
  activeSectors: string[];
  zoomOrigin: string;
}) {
  // Only show hubs carrying a selected sector (all of them when no filter).
  const allHubs = Object.keys(GLOBAL_HUB_XY).filter((id) => cityMatchesSectors(id, activeSectors));
  const nonPerthHubs = allHubs.filter((id) => id !== 'perth');
  const showPerth = allHubs.includes('perth');
  return (
    <svg className="globemap" viewBox="0 0 500 260" style={{ transformOrigin: zoomOrigin }}>
      <defs>
        <pattern id="globeOceanWave" width="18" height="11" patternUnits="userSpaceOnUse">
          <rect width="18" height="11" fill="#e2e5e9" />
          <path d="M0,6 Q4.5,2 9,6 T18,6" fill="none" stroke="#d3d7dc" strokeWidth="1.1" />
          <path d="M0,10 Q4.5,7 9,10 T18,10" fill="none" stroke="#d3d7dc" strokeWidth="0.8" />
          <path d="M0,3 Q4.5,1 9,3 T18,3" fill="none" stroke="#dde0e5" strokeWidth="0.55" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
        {/* Larger, slower swell layered over the fine ripple for a two-frequency,
            more textured sea surface instead of one flat repeating tile. */}
        <pattern id="globeOceanSwell" width="52" height="31" patternUnits="userSpaceOnUse">
          <path d="M0,16 Q13,6 26,16 T52,16" fill="none" stroke="#cfd3d9" strokeWidth="1.3" />
          <path d="M0,26 Q13,19 26,26 T52,26" fill="none" stroke="#d6d9de" strokeWidth="0.9" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="52 -9" dur="16s" repeatCount="indefinite" />
        </pattern>
        <filter id="globeCoastGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.3" />
        </filter>
        <filter id="globeEdgeFeather" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6 4" />
        </filter>
        <mask id="globeOceanMask">
          <rect x="32" y="7" width="450" height="246" rx="10" fill="#fff" filter="url(#globeEdgeFeather)" />
        </mask>
        {/* Land is feathered in tighter on the left/right than the ocean so the
            dateline-cut boundary segments (Alaska's west edge, eastern Russia,
            the New Zealand sliver past Tasmania) dissolve into the water instead
            of rendering as hard vertical lines. */}
        <mask id="globeLandMask">
          <rect x="30" y="4" width="456" height="252" rx="12" fill="#fff" filter="url(#globeEdgeFeather)" />
        </mask>
        <filter id="globeblur" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="globecore" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <filter id="globeheatblur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>
      <g mask="url(#globeOceanMask)">
        <rect x="-80" y="-60" width="660" height="380" fill="url(#globeOceanWave)" />
        <rect className="auoceanswell" x="-80" y="-60" width="660" height="380" fill="url(#globeOceanSwell)" />
      </g>
      <g mask="url(#globeLandMask)">
        <g transform={GEO_SCALE}>
          {/* Soft shallow-water halo hugging the coastline, matching the
              domestic views' treatment. */}
          <g className="coastglow" filter="url(#globeCoastGlow)">
            {GLOBAL_LAND_PATHS.map((d, i) => (
              <path key={`glow-${i}`} d={d} />
            ))}
          </g>
          {GLOBAL_LAND_PATHS.map((d, i) => (
            <path key={i} className="globeland" d={d} />
          ))}
        </g>
      </g>

      <g transform={GEO_SCALE}>
        <SpikeField ambient={ambientSpikes} hubs={hubSpikes} blurId="globeheatblur" />

        {nonPerthHubs.map((id) => {
          const [cx, cy] = GLOBAL_HUB_XY[id];
          return <HubHeat key={id} cx={cx} cy={cy} heat={hubHeat[id]} dim={heatDim} />;
        })}
        {showPerth && <HubHeat cx={GLOBAL_HUB_XY.perth[0]} cy={GLOBAL_HUB_XY.perth[1]} heat={hubHeat.perth} dim={heatDim} />}

        {CONTINENT_LABELS.map((c) => {
          const region = CONTINENT_CLICK[c.label];
          if (region) {
            const hw = c.label.length * 4 + 16;
            return (
              <g key={c.label} className="aucountryclick" onClick={() => onContinent(region)}>
                <rect x={c.x - hw} y={c.y - 11} width={hw * 2} height={16} fill="transparent" pointerEvents="all" />
                <text className="aucountry" x={c.x} y={c.y} textAnchor="middle">{c.label}</text>
              </g>
            );
          }
          return <text key={c.label} className="aucountry" x={c.x} y={c.y} textAnchor="middle">{c.label}</text>;
        })}

        {allHubs.map((id) => {
          const [cx, cy] = GLOBAL_HUB_XY[id];
          const off = CITY_LABEL_OFFSET[id] || { dx: 0, dy: -9, anchor: 'middle' as const };
          return (
            <g className="aucity hub" key={id} data-city={id} onClick={() => onZoomInCity(id)}>
              {/* Generous invisible hit target — the visible dot is small, so this
                  keeps every hub (Ganzhou especially, sitting close to the ASIA
                  label) reliably clickable regardless of dot size. */}
              <circle className="hubhit" cx={cx} cy={cy} r="12" fill="transparent" pointerEvents="all" />
              <circle className="auring" cx={cx} cy={cy} r="6.2" />
              <circle className="audot audothub" cx={cx} cy={cy} r="3.6" />
              <text className="aulabel" x={cx + off.dx} y={cy + off.dy} textAnchor={off.anchor}>{GLOBAL_HUB_LABEL[id]}</text>
            </g>
          );
        })}

        {TANKER_ROUTES.map((r, i) => (
          <Tanker key={i} {...r} />
        ))}
      </g>
    </svg>
  );
}
