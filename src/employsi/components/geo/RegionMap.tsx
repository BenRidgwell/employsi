import { GLOBAL_LAND_PATHS } from '../../data/geoPaths';
import { GLOBAL_HUB_XY, GLOBAL_HUB_LABEL } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';
import type { SpikePoint } from '../../lib/heat';
import { SpikeField } from './SpikeField';

// Generic regional domestic view: the world land paths zoomed into a region so
// its hubs are comfortably visible, mapped into the same 500x260 space as the
// global map so marker/heat sizes match. Water fills the whole screen and the
// coastlines use the same weight as the Australia view.

type Anchor = 'start' | 'middle' | 'end';
interface RegionCfg {
  hubs: string[];
  x0: number;
  y0: number;
  w: number; // source-box width (height derived from the 500:260 aspect)
  label: string;
  labelX: number;
  labelY: number;
  offsets: Record<string, { dx: number; dy: number; anchor: Anchor }>;
}

const REGIONS: Record<string, RegionCfg> = {
  asia: {
    hubs: ['ganzhou', 'singapore'],
    x0: 340,
    y0: 101,
    w: 150,
    label: 'ASIA',
    labelX: 70,
    labelY: 40,
    offsets: {
      singapore: { dx: 0, dy: 16, anchor: 'middle' },
      ganzhou: { dx: 0, dy: -11, anchor: 'middle' },
    },
  },
  northamerica: {
    hubs: ['denver', 'toronto', 'houston'],
    x0: 20,
    y0: 66,
    w: 110,
    label: 'NORTH AMERICA',
    labelX: 250,
    labelY: 34,
    offsets: {
      denver: { dx: 0, dy: 16, anchor: 'middle' },
      toronto: { dx: 0, dy: -11, anchor: 'middle' },
      houston: { dx: -8, dy: 4, anchor: 'end' },
    },
  },
  africa: {
    hubs: ['lubumbashi', 'johannesburg'],
    x0: 220,
    y0: 150,
    w: 130,
    label: 'AFRICA',
    labelX: 250,
    labelY: 38,
    offsets: {
      lubumbashi: { dx: 0, dy: -11, anchor: 'middle' },
      johannesburg: { dx: 0, dy: -11, anchor: 'middle' },
    },
  },
  europe: {
    hubs: ['london'],
    x0: 190,
    y0: 35,
    w: 100,
    label: 'EUROPE',
    labelX: 250,
    labelY: 36,
    offsets: {
      london: { dx: 0, dy: -12, anchor: 'middle' },
    },
  },
  southamerica: {
    hubs: ['santiago'],
    x0: 55,
    y0: 165,
    w: 140,
    label: 'SOUTH AMERICA',
    labelX: 250,
    labelY: 34,
    offsets: {
      santiago: { dx: 0, dy: -12, anchor: 'middle' },
    },
  },
};

function HubHeat({ cx, cy, heat, dim }: { cx: number; cy: number; heat: HeatDisc; dim: string }) {
  return (
    <>
      <circle className={`auhalo ${dim}`} filter="url(#globeblur)" cx={cx} cy={cy} r={heat.haloR} style={{ fill: heat.color }} />
      <circle className={`aucore ${dim}`} filter="url(#globecore)" cx={cx} cy={cy} r={heat.r} style={{ fill: heat.color }} />
    </>
  );
}

export function RegionMap({
  region,
  hubHeat,
  heatDim,
  onZoomInCity,
  hubSpikes,
  ambientSpikes,
}: {
  region: string;
  hubHeat: Record<string, HeatDisc>;
  heatDim: string;
  onZoomInCity: (city: string) => void;
  hubSpikes: SpikePoint[];
  ambientSpikes: SpikePoint[];
}) {
  const cfg = REGIONS[region] || REGIONS.asia;
  const s = 500 / cfg.w;
  const proj = (x: number, y: number): [number, number] => [(x - cfg.x0) * s, (y - cfg.y0) * s];
  const landT = `scale(${s.toFixed(4)}) translate(${-cfg.x0} ${-cfg.y0})`;
  // Project the global-coordinate skill spikes into this region's view.
  const projSpike = (sp: SpikePoint): SpikePoint => ({ ...sp, cx: (sp.cx - cfg.x0) * s, cy: (sp.cy - cfg.y0) * s });

  return (
    <svg className="regionmap" viewBox="0 0 500 260">
      <defs>
        <pattern id="regionOceanWave" width="18" height="11" patternUnits="userSpaceOnUse">
          <rect width="18" height="11" fill="#e2e5e9" />
          <path d="M0,6 Q4.5,2 9,6 T18,6" fill="none" stroke="#d3d7dc" strokeWidth="1.1" />
          <path d="M0,10 Q4.5,7 9,10 T18,10" fill="none" stroke="#d3d7dc" strokeWidth="0.8" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
      </defs>
      {/* Oversized ocean so the water animation fills the whole screen. */}
      <rect x="-1000" y="-800" width="2500" height="1860" fill="url(#regionOceanWave)" />
      <g transform={landT}>
        {GLOBAL_LAND_PATHS.map((d, i) => (
          <path key={i} className="regionland" d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      <SpikeField ambient={ambientSpikes.map(projSpike)} hubs={hubSpikes.map(projSpike)} blurId="globeheatblur" />

      <text className="aucountry" x={cfg.labelX} y={cfg.labelY} textAnchor="middle">{cfg.label}</text>

      {cfg.hubs.map((id) => {
        const [cx, cy] = proj(...GLOBAL_HUB_XY[id]);
        return <HubHeat key={id} cx={cx} cy={cy} heat={hubHeat[id]} dim={heatDim} />;
      })}
      {cfg.hubs.map((id) => {
        const [cx, cy] = proj(...GLOBAL_HUB_XY[id]);
        const off = cfg.offsets[id];
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
