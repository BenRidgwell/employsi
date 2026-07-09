import { GLOBAL_LAND_PATHS } from '../../data/geoPaths';
import { GLOBAL_HUB_XY, GLOBAL_HUB_LABEL } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';

// Regional Asia view: the world land paths zoomed into the Asia region so both
// Singapore and Ganzhou are comfortably visible. Everything is mapped from the
// global 500x260 coordinate space into this same viewBox, so marker/heat sizes
// match the global map.
const SX0 = 340;
const SY0 = 101;
const SS = 500 / 150; // 3.3333 — source box 150 wide → full viewBox
const proj = (x: number, y: number): [number, number] => [(x - SX0) * SS, (y - SY0) * SS];
const LAND_T = `scale(${SS.toFixed(4)}) translate(${-SX0} ${-SY0})`;

const HUB_OFFSET: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  singapore: { dx: 0, dy: 16, anchor: 'middle' },
  ganzhou: { dx: 0, dy: -11, anchor: 'middle' },
};
const ASIA_HUBS = ['ganzhou', 'singapore'];

function HubHeat({ cx, cy, heat, dim }: { cx: number; cy: number; heat: HeatDisc; dim: string }) {
  return (
    <>
      <circle className={`auhalo ${dim}`} filter="url(#globeblur)" cx={cx} cy={cy} r={heat.haloR} style={{ fill: heat.color }} />
      <circle className={`aucore ${dim}`} filter="url(#globecore)" cx={cx} cy={cy} r={heat.r} style={{ fill: heat.color }} />
    </>
  );
}

export function AsiaMap({
  hubHeat,
  heatDim,
  onZoomInCity,
}: {
  hubHeat: Record<string, HeatDisc>;
  heatDim: string;
  onZoomInCity: (city: string) => void;
}) {
  return (
    <svg className="asiamap" viewBox="0 0 500 260">
      <defs>
        <pattern id="asiaOceanWave" width="18" height="11" patternUnits="userSpaceOnUse">
          <rect width="18" height="11" fill="#e2e5e9" />
          <path d="M0,6 Q4.5,2 9,6 T18,6" fill="none" stroke="#d3d7dc" strokeWidth="1.1" />
          <path d="M0,10 Q4.5,7 9,10 T18,10" fill="none" stroke="#d3d7dc" strokeWidth="0.8" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="500" height="260" fill="url(#asiaOceanWave)" />
      <g transform={LAND_T}>
        {GLOBAL_LAND_PATHS.map((d, i) => (
          <path key={i} className="globeland" d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      <text className="aucountry" x="70" y="40" textAnchor="start">ASIA</text>

      {ASIA_HUBS.map((id) => {
        const [cx, cy] = proj(...GLOBAL_HUB_XY[id]);
        return <HubHeat key={id} cx={cx} cy={cy} heat={hubHeat[id]} dim={heatDim} />;
      })}
      {ASIA_HUBS.map((id) => {
        const [cx, cy] = proj(...GLOBAL_HUB_XY[id]);
        const off = HUB_OFFSET[id];
        return (
          <g className="aucity hub" key={id} onClick={() => onZoomInCity(id)}>
            <circle className="auring" cx={cx} cy={cy} r="8" />
            <circle className="audot audothub" cx={cx} cy={cy} r="4.4" />
            <text className="aulabel" x={cx + off.dx} y={cy + off.dy} textAnchor={off.anchor}>
              {GLOBAL_HUB_LABEL[id]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
